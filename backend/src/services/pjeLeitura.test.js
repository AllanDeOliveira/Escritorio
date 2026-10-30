import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import path from 'path';

const require = createRequire(import.meta.url);
const { loginCertificado } = require('./pjeSso');

const BACKEND = path.join(__dirname, '..', '..');

describe('pjeLeitura roda no PC, longe do banco', () => {
  it('não carrega prisma nem nada do banco (sem DATABASE_URL)', () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const r = spawnSync(process.execPath, ['-e',
      "require('./src/services/pjeLeitura'); console.log(Object.keys(require.cache).filter((k) => /prismaClient|@prisma|[\\\\/]infra[\\\\/]/.test(k)).join(',') || 'LIMPO')"],
    { cwd: BACKEND, env, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('LIMPO');
  });
});

describe('loginCertificado sem credenciais', () => {
  it('falha com mensagem clara e não procura o certificado no .env', async () => {
    const antes = { path: process.env.MNI_CERT_PATH, senha: process.env.MNI_CERT_SENHA };
    process.env.MNI_CERT_PATH = 'C:\\nao\\existe.pfx';
    process.env.MNI_CERT_SENHA = 'x';
    try {
      await expect(loginCertificado({ pjeUrl: 'https://exemplo.invalid/pje' })).rejects.toThrow(/Credenciais do certificado não informadas/);
    } finally {
      // process.env só guarda texto: atribuir undefined gravaria "undefined"
      for (const [k, v] of [['MNI_CERT_PATH', antes.path], ['MNI_CERT_SENHA', antes.senha]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
