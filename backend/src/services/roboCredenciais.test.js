import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

  it('login por CPF + senha: salva e carrega de volta; CPF e senha não ficam legíveis no arquivo', () => {
    // Em processo separado com APPDATA temporário: nunca toca no robo.json de verdade deste PC
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
    try {
      const modulo = path.join(__dirname, '..', '..', '..', 'robo-pje', 'credenciais.js').replace(/\\/g, '/');
      const cfg = { servidor: 'https://central.exemplo', tipo: 'senha', token: 'jvo_robo_x', cpf: '12345678909', senha: 'Senh@ Ç 9', segredoTotp: 'GEZDGNBV' };
      const r = spawnSync(process.execPath, ['-e',
        `const c = require('${modulo}'); c.salvar(${JSON.stringify(cfg)}); console.log(JSON.stringify(c.carregar()))`],
      { env: { ...process.env, APPDATA: tmp }, encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(JSON.parse(r.stdout)).toMatchObject(cfg);
      const arquivo = fs.readFileSync(path.join(tmp, 'CentralJVO', 'robo.json'), 'utf8');
      for (const segredo of ['12345678909', 'Senh@', 'jvo_robo_x', 'GEZDGNBV']) expect(arquivo).not.toContain(segredo);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('cifrado adulterado não abre', () => {
    const cifrado = proteger('abc');
    expect(() => abrir(`${cifrado.slice(0, -8)}00000000`)).toThrow();
  });
});
