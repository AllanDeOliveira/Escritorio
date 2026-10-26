import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseImportDate, enrich, statusAoReabrir } = require('./prazosRoutes');

describe('statusAoReabrir (Desfazer / arrastar de volta)', () => {
  const dia = (d) => new Date(2026, 9, d);

  it('card do DJEN que nunca teve data: a data é a publicação → volta para A_CONFIRMAR', () => {
    expect(statusAoReabrir({ fatalDate: dia(5) }, [], [{ dataDisponibilizacao: dia(5) }])).toBe('A_CONFIRMAR');
  });

  it('card do DJEN com data confirmada à mão → PENDENTE', () => {
    expect(statusAoReabrir({ fatalDate: dia(28) }, [], [{ dataDisponibilizacao: dia(5) }])).toBe('PENDENTE');
  });

  it('card do PJe: data limite do PJe → PENDENTE; expediente sem data limite (piso = expedição) → A_CONFIRMAR', () => {
    expect(statusAoReabrir({ fatalDate: dia(27) }, [{ dataLimite: dia(27), dataExpedicao: dia(10) }], [])).toBe('PENDENTE');
    expect(statusAoReabrir({ fatalDate: dia(10) }, [{ dataLimite: null, dataExpedicao: new Date(2026, 9, 10, 17, 35) }], [])).toBe('A_CONFIRMAR');
  });

  it('card manual (sem DJEN nem PJe) → PENDENTE', () => {
    expect(statusAoReabrir({ fatalDate: dia(5) }, [], [])).toBe('PENDENTE');
  });
});

describe('parseImportDate', () => {
  it('rejeita ano fora de faixa e mantém os formatos reais da planilha', () => {
    // O bug de origem: a célula "2406" (24/06 sem a barra) virava o ANO 2406.
    expect(parseImportDate('2406')).toBeNull();
    expect(parseImportDate('31/12/2406')).toBeNull();
    expect(parseImportDate('lixo')).toBeNull();
    expect(parseImportDate('')).toBeNull();

    expect(parseImportDate('15/07/2026').getFullYear()).toBe(2026);
    expect(parseImportDate('15/07/26').getFullYear()).toBe(2026);
    expect(parseImportDate('2026-07-15').getMonth()).toBe(6); // meia-noite LOCAL
  });
});

describe('enrich', () => {
  it('A_CONFIRMAR cai no bucket triagem mesmo com a data-piso no passado (não é "vencido")', () => {
    const p = enrich({ status: 'A_CONFIRMAR', fatalDate: new Date(2000, 0, 1) });
    expect(p.bucket).toBe('triagem');
    expect(p.daysUntilFatal).toBeLessThan(0);
  });

  it('vencido até 2 dias fica na coluna; mais antigo sai do quadro (vencidoAntigo)', () => {
    const haDias = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
    expect(enrich({ status: 'PENDENTE', fatalDate: haDias(1) }).bucket).toBe('vencido');
    expect(enrich({ status: 'PENDENTE', fatalDate: haDias(2) }).bucket).toBe('vencido');
    expect(enrich({ status: 'PENDENTE', fatalDate: haDias(3) }).bucket).toBe('vencidoAntigo');
    expect(enrich({ status: 'PENDENTE', fatalDate: haDias(3) }).computedStatus).toBe('VENCIDO');
  });
});
