import { describe, it, expect } from 'vitest';
import {
  agruparIntimacoes, chaveAto, tipoBucket, mesAtual, nomeMes, areaDireito, AREAS, buscaMatch, formatarNumeroCnj,
  type Intimacao,
} from './PrazosTab';

const base: Intimacao = { id: 'x', status: 'NOVA' };
const int = (over: Partial<Intimacao>): Intimacao => ({ ...base, ...over });

describe('agruparIntimacoes / chaveAto', () => {
  it('agrupa cópias do mesmo ato (processo+data+texto idênticos)', () => {
    const a1 = int({ id: 'a1', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-06T00:00:00', texto: 'TXT' });
    const a2 = int({ id: 'a2', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-06T00:00:00', texto: 'TXT' });
    const grupos = agruparIntimacoes([a1, a2]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ids).toEqual(['a1', 'a2']);
    expect(grupos[0].membros).toHaveLength(2);
  });

  it('NÃO agrupa processos distintos com o mesmo teor genérico (regressão do bug do alvará)', () => {
    const texto = 'Intimação das partes acerca da expedição do alvará eletrônico de pagamento.';
    const a = int({ id: 'a', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-06T00:00:00', texto });
    const b = int({ id: 'b', numeroProcesso: 'P2', dataDisponibilizacao: '2026-07-06T00:00:00', texto });
    expect(agruparIntimacoes([a, b])).toHaveLength(2);
    expect(chaveAto(a)).not.toBe(chaveAto(b));
  });

  it('NÃO agrupa o mesmo ato republicado em data diferente', () => {
    const a = int({ id: 'a', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-01T00:00:00', texto: 'TXT' });
    const b = int({ id: 'b', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-02T00:00:00', texto: 'TXT' });
    expect(agruparIntimacoes([a, b])).toHaveLength(2);
  });

  it('sem texto, usa o id como chave (nunca agrupa por acidente)', () => {
    const a = int({ id: 'a', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-06T00:00:00', texto: null });
    const b = int({ id: 'b', numeroProcesso: 'P1', dataDisponibilizacao: '2026-07-06T00:00:00', texto: null });
    expect(agruparIntimacoes([a, b])).toHaveLength(2);
  });
});

describe('tipoBucket', () => {
  it('classifica os tipos reais do DJEN nas colunas certas', () => {
    expect(tipoBucket(int({ tipoDocumento: 'Sentença' }))).toBe('sentenca');
    expect(tipoBucket(int({ tipoDocumento: 'Decisão' }))).toBe('decisao');
    expect(tipoBucket(int({ tipoDocumento: 'Decisão de suspensão' }))).toBe('decisao');
    expect(tipoBucket(int({ tipoDocumento: 'Despacho' }))).toBe('despacho');
    expect(tipoBucket(int({ tipoDocumento: 'Intimação' }))).toBe('intimacao');
    expect(tipoBucket(int({ tipoDocumento: 'Intimação de pauta' }))).toBe('intimacao');
    expect(tipoBucket(int({ tipoDocumento: 'Notificação' }))).toBe('intimacao');
    expect(tipoBucket(int({ tipoDocumento: 'Certidão' }))).toBe('outros');
    expect(tipoBucket(int({ tipoDocumento: 'Distribuição' }))).toBe('outros');
  });

  it('cai para tipoComunicacao quando tipoDocumento falta, e "outros" quando ambos faltam', () => {
    expect(tipoBucket(int({ tipoDocumento: null, tipoComunicacao: 'Intimação' }))).toBe('intimacao');
    expect(tipoBucket(int({ tipoDocumento: null, tipoComunicacao: null }))).toBe('outros');
  });
});

describe('areaDireito (espelho das regras do backend)', () => {
  it('classifica as combinações reais do DJEN', () => {
    expect(areaDireito(int({ tribunal: 'TRT23', nomeClasse: 'RECURSO ORDINáRIO TRABALHISTA' }))).toBe('trabalhista');
    expect(areaDireito(int({ orgao: 'VARA ESPECIALIZADA EM DIREITO BANCÁRIO DE CUIABÁ', tribunal: 'TJMT' }))).toBe('bancario');
    expect(areaDireito(int({ orgao: '3ª Relatoria da 1ª Turma Recursal da SJMT', tribunal: 'TRF1' }))).toBe('previdenciario');
    expect(areaDireito(int({ tribunal: 'TRF1', nomeClasse: 'CUMPRIMENTO DE SENTENçA CONTRA A FAZENDA PúBLICA' }))).toBe('previdenciario');
    expect(areaDireito(int({ nomeClasse: 'CUMPRIMENTO DE SENTENçA CONTRA A FAZENDA PúBLICA', orgao: 'JUIZADOS ESPECIAIS DE CÁCERES', tribunal: 'TJMT' }))).toBe('fazenda');
    // vara mista (dois assuntos) — o escritório não atende criminal
    expect(areaDireito(int({ nomeClasse: 'CUMPRIMENTO DE SENTENçA CONTRA A FAZENDA PúBLICA', orgao: 'JUIZADO ESPECIAL CRIMINAL E FAZENDÁRIO DE VÁRZEA GRANDE', tribunal: 'TJMT' }))).toBe('fazenda');
    expect(areaDireito(int({ nomeClasse: 'PROCEDIMENTO COMUM CíVEL', orgao: '2ª VARA CÍVEL DE CÁCERES', tribunal: 'TJMT' }))).toBe('civel');
    expect(areaDireito(int({}))).toBe('outras');
  });

  it('mantém as mesmas seis áreas do backend (sem criminal)', () => {
    expect(AREAS.map(a => a.key)).toEqual(['fazenda', 'previdenciario', 'bancario', 'trabalhista', 'civel', 'outras']);
  });
});

describe('buscaMatch', () => {
  const alvo = int({ numeroProcesso: '1124491-82.2025.8.11.0041', clienteExtraido: 'MARIA APARECIDA DA SILVA' });

  it('acha pelo número completo, com ou sem pontuação', () => {
    expect(buscaMatch(alvo, '1124491-82.2025.8.11.0041')).toBe(true);
    expect(buscaMatch(alvo, '11244918220258110041')).toBe(true);
  });

  it('acha por fragmento do número (só o sequencial)', () => {
    expect(buscaMatch(alvo, '1124491')).toBe(true);
    expect(buscaMatch(alvo, '1124491-82')).toBe(true);
  });

  it('acha pelo nome do cliente, sem diferenciar maiúsculas', () => {
    expect(buscaMatch(alvo, 'maria aparecida')).toBe(true);
  });

  it('não acha número de outro processo', () => {
    expect(buscaMatch(alvo, '9999999')).toBe(false);
    expect(buscaMatch(alvo, 'JOSE GOMES')).toBe(false);
  });

  it('termo vazio casa com tudo (sem filtro)', () => {
    expect(buscaMatch(alvo, '')).toBe(true);
    expect(buscaMatch(alvo, '   ')).toBe(true);
  });

  it('processo nulo só casa por cliente', () => {
    const semProc = int({ numeroProcesso: null, clienteExtraido: 'JOSE GOMES' });
    expect(buscaMatch(semProc, 'jose')).toBe(true);
    expect(buscaMatch(semProc, '123')).toBe(false);
  });
});

describe('formatarNumeroCnj', () => {
  it('aplica a máscara CNJ em números de 20 dígitos (formato do MNI)', () => {
    expect(formatarNumeroCnj('10787986920238110001')).toBe('1078798-69.2023.8.11.0001');
    expect(formatarNumeroCnj('00453966920158110041')).toBe('0045396-69.2015.8.11.0041');
  });
  it('devolve como veio quando não tem 20 dígitos', () => {
    expect(formatarNumeroCnj('1078798-69.2023.8.11.0001')).toBe('1078798-69.2023.8.11.0001');
    expect(formatarNumeroCnj('123')).toBe('123');
    expect(formatarNumeroCnj(null)).toBe('');
  });
});

describe('filtro de mês', () => {
  it('mesAtual devolve YYYY-MM', () => {
    expect(mesAtual()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('nomeMes formata em pt-BR com inicial maiúscula', () => {
    expect(nomeMes('2026-07')).toBe('Julho de 2026');
    expect(nomeMes('2026-12')).toBe('Dezembro de 2026');
  });
});
