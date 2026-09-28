import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { totp } = require('./pjeSso');

describe('totp', () => {
    // Vetores da RFC 6238 (SHA-1, segredo "12345678901234567890"), últimos 6 dígitos
    const segredo = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    it('bate com a RFC 6238', () => {
        expect(totp(segredo, 59000)).toBe('287082');
        expect(totp(segredo, 1111111109000)).toBe('081804');
        expect(totp(segredo, 2000000000000)).toBe('279037');
    });

    it('aceita espaços/minúsculas e rejeita chave inválida', () => {
        expect(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59000)).toBe('287082');
        expect(() => totp('não-base32!', 0)).toThrow();
    });
});
