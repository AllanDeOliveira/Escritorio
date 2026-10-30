import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// robo-pje/credenciais.js: proteção de dados do Windows (DPAPI) — só existe no Windows
describe.skipIf(process.platform !== 'win32')('robo-pje: credenciais protegidas pelo Windows', () => {
  const { proteger, abrir } = require('../../../robo-pje/credenciais');

  it('cifra e decifra de volta exatamente (acento e espaço inclusos); o cifrado não contém o segredo', () => {
    const segredo = 'Senha do Certificado ç 1@';
    const cifrado = proteger(segredo);
    expect(cifrado).not.toContain('Senha');
    expect(cifrado).not.toContain(Buffer.from(segredo).toString('base64'));
    expect(abrir(cifrado)).toBe(segredo);
  });

  it('cifrado adulterado não abre', () => {
    const cifrado = proteger('abc');
    expect(() => abrir(`${cifrado.slice(0, -8)}00000000`)).toThrow();
  });
});
