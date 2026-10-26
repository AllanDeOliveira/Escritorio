import { describe, it, expect } from 'vitest';
import {
  tipoBucket, areaDireito, AREAS, buscaMatch,
  relativeLabel, iniciais, ordenarPorPrioridade, cardSemDono, caminhoPje, jurisdicaoDe,
  type Intimacao,
} from './PrazosTab';

const base: Intimacao = { id: 'x', status: 'NOVA' };
const int = (over: Partial<Intimacao>): Intimacao => ({ ...base, ...over });

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

describe('distribuição', () => {
  it('iniciais ignoram partículas e aceitam e-mail', () => {
    expect(iniciais('Mariana Rocha')).toBe('MR');
    expect(iniciais('João Vitor de Oliveira')).toBe('JO');
    expect(iniciais('joao@x.com')).toBe('J');
    expect(iniciais('')).toBe('?');
  });
});

describe('ordenarPorPrioridade', () => {
  it('Alta, Média, Baixa e sem prioridade por último, mantendo a ordem dentro da faixa', () => {
    const ps = [{ id: 1, prioridade: null }, { id: 2, prioridade: 'BAIXA' }, { id: 3, prioridade: 'ALTA' }, { id: 4, prioridade: 'ALTA' }, { id: 5, prioridade: 'MEDIA' }];
    expect(ordenarPorPrioridade(ps).map(p => p.id)).toEqual([3, 4, 5, 2, 1]);
  });
});

describe('cardSemDono', () => {
  const trt = { responsibleId: null, responsibleName: null, bucket: 'triagem', intimacoes: [{ tribunal: 'TRT23' }] };

  it('sem dono e da minha área → sim; de outra área → não; sem área cadastrada vê todos', () => {
    expect(cardSemDono(trt, ['trabalhista'])).toBe(true);
    expect(cardSemDono(trt, ['bancario'])).toBe(false);
    expect(cardSemDono(trt, [])).toBe(true);
  });

  it('card do robô do PJe (sem intimação) classifica pelo expediente', () => {
    const trf = { responsibleId: null, responsibleName: null, bucket: 'semana', origemPje: { tribunal: 'TRF1' } };
    expect(cardSemDono(trf, ['previdenciario'])).toBe(true);
    expect(cardSemDono(trf, ['trabalhista'])).toBe(false);
  });

  it('com dono (id ou nome livre) ou concluído nunca é "sem dono"', () => {
    expect(cardSemDono({ ...trt, responsibleId: 'u1' }, [])).toBe(false);
    expect(cardSemDono({ ...trt, responsibleName: 'Fulano' }, [])).toBe(false);
    expect(cardSemDono({ ...trt, bucket: 'concluido' }, [])).toBe(false);
  });
});

describe('caminhoPje', () => {
  it('aba › jurisdição › caixa; sem caixa nomeada vira "Caixa de entrada"', () => {
    expect(caminhoPje({ situacao: 'Apenas pendentes de resposta', jurisdicao: 'BARRA DO BUGRES', caixa: 'Processos [Previdenciários Regime Geral Previdência Social [INSS]' }))
      .toBe('Apenas pendentes de resposta › BARRA DO BUGRES › Processos [Previdenciários Regime Geral Previdência Social [INSS]');
    expect(caminhoPje({ situacao: 'Sem prazo', jurisdicao: 'CÁCERES', caixa: null })).toBe('Sem prazo › CÁCERES › Caixa de entrada');
  });

  it('expediente lido antes do caminho existir: nada', () => {
    expect(caminhoPje({ situacao: null })).toBeNull();
    expect(caminhoPje(null)).toBeNull();
  });
});

describe('jurisdicaoDe', () => {
  it('usa a jurisdição do PJe quando o expediente traz', () => {
    expect(jurisdicaoDe('3ª VARA ESP. DA FAZENDA PÚBLICA DE CUIABÁ', 'TJMT', 'Cuiabá Cível')).toBe('CUIABÁ CÍVEL');
  });

  it('deriva a jurisdição do órgão do DJEN (TJMT), igual ao Painel do PJe', () => {
    const casos: [string, string][] = [
      ['3ª VARA CÍVEL DE CÁCERES', 'CÁCERES'],
      ['1ª VARA CÍVEL DE CÁCERES - FAMÍLIA E SUCESSÕES', 'CÁCERES'],
      ['4ª VARA CÍVEL DE CÁCERES - FAZENDA PÚBLICA', 'CÁCERES'],
      ['JUIZADOS ESPECIAIS DE CÁCERES', 'CÁCERES JUIZADOS'],
      ['3ª VARA ESP. DA FAZENDA PÚBLICA DE CUIABÁ', 'CUIABÁ CÍVEL'],
      ['JUIZADO ESPECIAL DA FAZENDA PÚBLICA DE CUIABÁ', 'CUIABÁ JUIZADOS'],
      ['3º JUIZADO ESPECIAL CÍVEL DE CUIABÁ', 'CUIABÁ JUIZADOS'],
      ['JUIZADO ESPECIAL CRIMINAL E FAZENDÁRIO DE VÁRZEA GRANDE', 'VÁRZEA GRANDE JUIZADOS'],
      ['VARA ÚNICA DE STO ANTÔNIO DO LEVERGER', 'STO ANTÔNIO DO LEVERGER'],
      ["1ª VARA DE MIRASSOL D'OESTE", "MIRASSOL D'OESTE"],
      ['NÚCLEO DE JUSTIÇA DIGITAL DOS JUIZADOS ESPECIAIS CÍVEIS', 'NÚCLEO DE JUSTIÇA DIGITAL DOS JUIZADOS ESPECIAIS'],
      ['Primeira Turma Recursal', 'TURMA RECURSAL ÚNICA'],
      ['Quarta Câmara de Direito Privado', 'TJMT - 2º GRAU'],
      ['Vice-Presidência', 'TJMT - 2º GRAU'],
    ];
    casos.forEach(([orgao, esperado]) => expect(jurisdicaoDe(orgao, 'TJMT')).toBe(esperado));
  });

  it('TRF1 segue os nomes do PJe federal', () => {
    expect(jurisdicaoDe('Juizado Especial Cível e Criminal Adjunto à 2ª Vara Federal da SSJ de Cáceres-MT', 'TRF1')).toBe('SUBSEÇÃO JUDICIÁRIA DE CÁCERES-MT');
    expect(jurisdicaoDe('3ª Relatoria da 1ª Turma Recursal da SJMT', 'TRF1')).toBe('TURMA RECURSAL DOS JUIZADOS ESPECIAIS FEDERAIS DA SJMT');
    expect(jurisdicaoDe('2ª Relatoria da 5ª Turma 4.0 - adjunta à 3ª Turma Recursal da Bahia', 'TRF1')).toBe('NÚCLEOS DE JUSTIÇA 4.0 (TRF1)');
    expect(jurisdicaoDe('Núcleos de Justiça 4.0', 'TRF1 2º GRAU', 'Núcleos de Justiça 4.0')).toBe('NÚCLEOS DE JUSTIÇA 4.0 (TRF1)');
    expect(jurisdicaoDe('x', 'TJMT', 'Núcleos de Justiça 4.0')).toBe('NÚCLEOS DE JUSTIÇA 4.0');
    expect(jurisdicaoDe('8ª Vara Federal de Juizado Especial Cível da SJMT', 'TRF1')).toBe('SEÇÃO JUDICIÁRIA DE MATO GROSSO');
    expect(jurisdicaoDe('Juizado Especial Cível Adjunto à 1ª Vara Federal da SSJ de Rondonópolis-MT', 'TRF1')).toBe('SUBSEÇÃO JUDICIÁRIA DE RONDONÓPOLIS-MT');
    expect(jurisdicaoDe('Gab. 05 - DESEMBARGADOR FEDERAL RUI GONÇALVES', 'TRF1')).toBe('TRIBUNAL REGIONAL FEDERAL DA 1ª REGIÃO');
  });

  it('TRT23 leva sufixo (não soma com a comarca do TJMT); outros tribunais mantêm o órgão', () => {
    expect(jurisdicaoDe('VARA DO TRABALHO DE CÁCERES', 'TRT23')).toBe('CÁCERES (TRT23)');
    expect(jurisdicaoDe('2ª VARA DO TRABALHO DE CUIABÁ', 'TRT23')).toBe('CUIABÁ (TRT23)');
    expect(jurisdicaoDe('Gabinete da Desembargadora X - 1ª Turma', 'TRT23')).toBe('1ª TURMA (TRT23)');
    expect(jurisdicaoDe('2ª Turma', 'TRT23')).toBe('2ª TURMA (TRT23)');
    expect(jurisdicaoDe('OJC de Análise de Recurso', 'TRT23')).toBe('OJC DE ANÁLISE DE RECURSO (TRT23)');
    expect(jurisdicaoDe("VARA DO TRABALHO DE MIRASSOL D'OESTE", 'TRT23')).toBe('MIRASSOL D OESTE (TRT23)');
    expect(jurisdicaoDe('SPF COORDENADORIA DE PROCESSAMENTO DE FEITOS DE DIREITO PRIVADO', 'STJ')).toBe('STJ');
    expect(jurisdicaoDe('Gabinete do Ministro X', 'STF')).toBe('STF');
    expect(jurisdicaoDe('VARA FEDERAL DE X', 'TRF3')).toBe('VARA FEDERAL DE X');
    expect(jurisdicaoDe(null, 'TJMT')).toBe('SEM');
  });
});
