import { describe, it, expect } from 'vitest';
import {
  agruparIntimacoes, chaveAto, tipoBucket, mesAtual, nomeMes, areaDireito, AREAS, colunasPorArea, tribunaisPresentes, buscaMatch, formatarNumeroCnj,
  relativeLabel, nomeProprio, iniciais, cargaPorPessoa,
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

  // Trechos reais do cabeçalho de partes do teor (DJEN)
  it('banco como PARTE no teor → bancário', () => {
    const civel = { nomeClasse: 'PROCEDIMENTO COMUM CíVEL', orgao: '2ª VARA CÍVEL DE CÁCERES', tribunal: 'TJMT' };
    expect(areaDireito(int({ ...civel, texto: 'DECISÃO Processo: 1013291-78.2025.8.11.0006. AUTOR: EMILIA DE CAMPOS ARRUDA REQUERIDO: BANCO AGIBANK S.A Visto.' }))).toBe('bancario');
    expect(areaDireito(int({ nomeClasse: 'CUMPRIMENTO DE SENTENçA', orgao: 'VARA ÚNICA DE RIO BRANCO', tribunal: 'TJMT', texto: 'PROCESSO N. 1000673-36.2020.8.11.0052 EXEQUENTE: JOSE SEVERINO DA SILVA EXECUTADO: BANCO AGIBANK S.A SENTENÇA' }))).toBe('bancario');
    // CEF na Justiça Federal: bancário vence a regra "TRF → previdenciário"
    expect(areaDireito(int({ nomeClasse: 'RECURSO INOMINADO CíVEL', orgao: '3ª Relatoria da 1ª Turma Recursal da SJMT', tribunal: 'TRF1', texto: 'RECORRENTE: SINDALVA MARTINS DE OLIVEIRA Advogado do(a) RECORRENTE: JESUS VIEIRA DE OLIVEIRA - MT9309-A RECORRIDO: CAIXA ECONOMICA FEDERAL - CEF' }))).toBe('bancario');
  });

  it('banco apenas CITADO no corpo não vira bancário', () => {
    expect(areaDireito(int({ nomeClasse: 'CUMPRIMENTO DE SENTENçA CONTRA A FAZENDA PúBLICA', orgao: '1ª VARA ESP. DA FAZENDA PÚBLICA DE CUIABÁ', tribunal: 'TJMT', texto: 'EXEQUENTE: MARIA DA SILVA EXECUTADO: ESTADO DE MATO GROSSO. Expeça-se alvará para depósito na conta do Banco do Brasil.' }))).toBe('fazenda');
    expect(areaDireito(int({ nomeClasse: 'PROCEDIMENTO COMUM CíVEL', orgao: '2ª VARA CÍVEL DE CÁCERES', tribunal: 'TJMT', texto: 'Tema nº 1.414/STJ, que versa sobre a validade dos contratos de cartão de crédito consignado (RCM)' }))).toBe('civel');
  });

  it('só procura a parte no cabeçalho (início do teor)', () => {
    const texto = `${'x'.repeat(3000)} REQUERIDO: BANCO BRADESCO S.A.`;
    expect(areaDireito(int({ nomeClasse: 'PROCEDIMENTO COMUM CíVEL', tribunal: 'TJMT', texto }))).toBe('civel');
  });

  it('trabalhista vence bancário (banco como reclamado na Justiça do Trabalho)', () => {
    expect(areaDireito(int({ tribunal: 'TRT23', nomeClasse: 'AçãO TRABALHISTA - RITO ORDINáRIO', texto: 'RECLAMANTE: JOAO RECLAMADO: BANCO DO BRASIL SA' }))).toBe('trabalhista');
  });

  it('mantém as mesmas seis áreas do backend (sem criminal)', () => {
    expect(AREAS.map(a => a.key)).toEqual(['fazenda', 'previdenciario', 'bancario', 'trabalhista', 'civel', 'outras']);
  });
});

describe('colunasPorArea (quadro "Organizar por: Área")', () => {
  it('só as áreas presentes no recorte, na ordem fixa de AREAS', () => {
    expect(colunasPorArea(['civel', 'fazenda', 'civel', 'bancario']).map(c => c.key)).toEqual(['fazenda', 'bancario', 'civel']);
  });

  it('usa o rótulo da área como título da coluna', () => {
    expect(colunasPorArea(['previdenciario'])).toEqual([{ key: 'previdenciario', label: 'Previdenciário' }]);
  });

  it('recorte vazio → nenhuma coluna', () => {
    expect(colunasPorArea([])).toEqual([]);
  });
});

describe('tribunaisPresentes (filtro e colunas por tribunal)', () => {
  it('um item por tribunal presente, do mais frequente ao menos', () => {
    expect(tribunaisPresentes(['TJMT', 'TRF1', 'TJMT', 'TRT23', 'TRF1', 'TJMT'])).toEqual([
      { key: 'TJMT', label: 'TJMT', n: 3 },
      { key: 'TRF1', label: 'TRF1', n: 2 },
      { key: 'TRT23', label: 'TRT23', n: 1 },
    ]);
  });

  it('empate em ordem alfabética', () => {
    expect(tribunaisPresentes(['TJSP', 'STJ']).map(t => t.key)).toEqual(['STJ', 'TJSP']);
  });

  it('tribunal vazio vira "Sem tribunal" (nunca some da contagem)', () => {
    expect(tribunaisPresentes([null, '', 'TJMT'])).toEqual([
      { key: 'SEM', label: 'Sem tribunal', n: 2 },
      { key: 'TJMT', label: 'TJMT', n: 1 },
    ]);
  });

  it('recorte vazio → nenhum tribunal', () => {
    expect(tribunaisPresentes([])).toEqual([]);
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

describe('relativeLabel', () => {
  it('não finge precisão em data absurda (o prazo com ano 2406 da planilha)', () => {
    expect(relativeLabel(138583)).toBe('data suspeita');
    expect(relativeLabel(-138583)).toBe('data suspeita');
    // faixa normal intacta
    expect(relativeLabel(30)).toBe('em 30 dias');
    expect(relativeLabel(0)).toBe('vence hoje');
    expect(relativeLabel(-2)).toBe('atrasado 2 dias');
  });
});

describe('nomeProprio', () => {
  it('capitaliza nomes em CAIXA ALTA do DJEN com partículas em minúsculas', () => {
    expect(nomeProprio('MARIA APARECIDA DO ESPIRITO SANTO')).toBe('Maria Aparecida do Espirito Santo');
    expect(nomeProprio('CUMPRIMENTO DE SENTENÇA CONTRA A FAZENDA PÚBLICA')).toBe('Cumprimento de Sentença Contra A Fazenda Pública');
    expect(nomeProprio('DA SILVA')).toBe('Da Silva'); // partícula inicial mantém maiúscula
    expect(nomeProprio(null)).toBe('');
  });
});

describe('distribuição', () => {
  it('iniciais ignoram partículas e aceitam e-mail', () => {
    expect(iniciais('Mariana Rocha')).toBe('MR');
    expect(iniciais('João Vitor de Oliveira')).toBe('JO');
    expect(iniciais('joao@x.com')).toBe('J');
    expect(iniciais('')).toBe('?');
  });

  it('carga conta abertos e vencidos por pessoa, sem concluídos nem sem responsável', () => {
    const c = cargaPorPessoa([
      { responsibleId: 'a', bucket: 'vencido' },
      { responsibleId: 'a', bucket: 'hoje' },
      { responsibleId: 'a', bucket: 'concluido' },
      { responsibleId: null, bucket: 'vencido' },
    ]);
    expect(c.get('a')).toEqual({ abertos: 2, vencidos: 1 });
    expect(c.size).toBe(1);
  });
});
