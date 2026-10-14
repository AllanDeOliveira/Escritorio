import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseBusca, buscaToWhere } = require('./buscaIntimacoes');

const where = (q) => buscaToWhere(parseBusca(q));

describe('buscaIntimacoes', () => {
  it('filtros, negação, OU na mesma chave, texto e aspas', () => {
    expect(where('tribunal:TJMT tribunal:TRF1 -status:descartada "prazo de 15" recurso')).toEqual({
      AND: [
        { OR: [
          { tribunal: { contains: 'TJMT', mode: 'insensitive' } },
          { tribunal: { contains: 'TRF1', mode: 'insensitive' } },
        ] },
        { NOT: { status: 'DESCARTADA' } },
        { texto: { contains: 'prazo de 15', mode: 'insensitive' } },
        { texto: { contains: 'recurso', mode: 'insensitive' } },
      ],
    });
  });

  it('valor entre aspas na chave e chave desconhecida vira texto', () => {
    expect(where('cliente:"João \\"Silva\\"" http://x.com')).toEqual({
      AND: [
        { OR: [{ clienteExtraido: { contains: 'João "Silva"', mode: 'insensitive' } }] },
        { texto: { contains: 'http://x.com', mode: 'insensitive' } },
      ],
    });
  });

  it('datas: depois/antes/em viram faixa; data inválida vira texto', () => {
    expect(where('depois:2026-05-01 antes:10/05/2026')).toEqual({
      AND: [{ dataDisponibilizacao: { gte: new Date(2026, 4, 2), lt: new Date(2026, 4, 10) } }],
    });
    expect(where('em:2026-05-01')).toEqual({
      AND: [{ dataDisponibilizacao: { gte: new Date(2026, 4, 1), lt: new Date(2026, 4, 2) } }],
    });
    expect(where('antes:ontem').AND[0]).toEqual({ texto: { contains: 'antes:ontem', mode: 'insensitive' } });
  });

  it('busca vazia não filtra', () => {
    expect(where('')).toEqual({});
    expect(where(undefined)).toEqual({});
  });
});
