import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pascoa, feriadosNacionais, ehDiaUtil, calcularPrazo, dataCienciaTacita, dataPublicacaoDjen } = require('./prazoCpc');

describe('feriados', () => {
    it('calcula a Páscoa', () => {
        expect(pascoa(2024)).toBe('2024-03-31');
        expect(pascoa(2025)).toBe('2025-04-20');
        expect(pascoa(2026)).toBe('2026-04-05');
    });

    it('inclui Carnaval, Sexta-feira Santa e Corpus Christi', () => {
        const f = feriadosNacionais(2026);
        ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20'].forEach((d) => expect(f.has(d)).toBe(true));
    });

    it('fim de semana, feriado, recesso e extras não são dias úteis', () => {
        expect(ehDiaUtil('2026-09-28')).toBe(true);
        expect(ehDiaUtil('2026-10-03')).toBe(false); // sábado
        expect(ehDiaUtil('2026-10-12')).toBe(false); // N. Sra. Aparecida
        expect(ehDiaUtil('2026-12-21')).toBe(false); // recesso
        expect(ehDiaUtil('2027-01-20')).toBe(false); // recesso (inclusive)
        expect(ehDiaUtil('2027-01-21')).toBe(true);
        expect(ehDiaUtil('2026-09-29', ['2026-09-29'])).toBe(false);
    });
});

describe('calcularPrazo', () => {
    it('15 dias úteis pulando feriado', () => {
        expect(calcularPrazo({ inicio: '2026-09-28', dias: 15 })).toBe('2026-10-20');
    });

    it('atravessa o recesso', () => {
        expect(calcularPrazo({ inicio: '2026-12-18', dias: 5 })).toBe('2027-01-27');
    });

    it('prazo em dobro e suspensão do tribunal', () => {
        expect(calcularPrazo({ inicio: '2026-09-28', dias: 5, dobro: true })).toBe('2026-10-13');
        expect(calcularPrazo({ inicio: '2026-09-28', dias: 5, extras: ['2026-09-30'] })).toBe('2026-10-06');
    });

    it('aceita datetime ISO e rejeita entrada inválida', () => {
        expect(calcularPrazo({ inicio: '2026-09-28T17:45:00', dias: 1 })).toBe('2026-09-29');
        expect(() => calcularPrazo({ inicio: '2026-09-28', dias: 0 })).toThrow();
    });
});

describe('termo inicial', () => {
    it('ciência tácita em 10 dias corridos, prorrogada se não útil', () => {
        expect(dataCienciaTacita('2026-09-28')).toBe('2026-10-08');
        expect(dataCienciaTacita('2026-10-02')).toBe('2026-10-13'); // 12/10 feriado
    });

    it('DJEN: publicação no 1º dia útil após a disponibilização', () => {
        const pub = dataPublicacaoDjen('2026-04-02'); // quinta antes da Sexta Santa
        expect(pub).toBe('2026-04-06');
        expect(calcularPrazo({ inicio: pub, dias: 5 })).toBe('2026-04-13');
    });
});
