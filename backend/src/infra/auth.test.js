import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const auth = require('./auth');

describe('senha (scrypt)', () => {
  it('confere a senha certa e recusa a errada; o hash não contém a senha', async () => {
    const h = await auth.hashSenha('correta-123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correta-123');
    expect(await auth.verificarSenha(h, 'correta-123')).toBe(true);
    expect(await auth.verificarSenha(h, 'errada-123')).toBe(false);
  });

  it('mesma senha gera hashes diferentes (sal aleatório)', async () => {
    expect(await auth.hashSenha('igual-123')).not.toBe(await auth.hashSenha('igual-123'));
  });

  it('hash ausente ou corrompido nunca autentica', async () => {
    expect(await auth.verificarSenha(null, 'x')).toBe(false);
    expect(await auth.verificarSenha('', 'x')).toBe(false);
    expect(await auth.verificarSenha('scrypt$1$2$3$zz$zz', 'x')).toBe(false);
  });
});

describe('lerCookie', () => {
  it('acha o cookie da sessão entre outros', () => {
    expect(auth.lerCookie({ headers: { cookie: `a=1; ${auth.COOKIE}=abc%2Bd; b=2` } })).toBe('abc+d');
    expect(auth.lerCookie({ headers: { cookie: 'a=1' } })).toBeNull();
    expect(auth.lerCookie({ headers: {} })).toBeNull();
  });
});
