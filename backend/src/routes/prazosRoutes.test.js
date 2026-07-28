import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseImportDate } = require('./prazosRoutes');

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
