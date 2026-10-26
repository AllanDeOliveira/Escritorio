import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';

const require = createRequire(import.meta.url);
const prisma = require('./prismaClient');
const auth = require('./auth');

// Roda o scripts/criar-admin.js de verdade, com o que seria digitado no terminal.
const EMAIL = '__test_criaradmin__@jvo.adv.br';
const BACKEND = path.join(__dirname, '..', '..');

function rodar(entrada) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/criar-admin.js', EMAIL, 'Teste', 'Admin'], { cwd: BACKEND });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
    p.on('close', (code) => resolve({ code, saida }));
    p.stdin.end(entrada);
  });
}

describe('npm run criar-admin', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
  });

  it('grava exatamente a senha digitada (espaço e acento inclusos), sem mostrá-la na tela', async () => {
    const senha = 'Senha Teste ç1';
    const { code, saida } = await rodar(`${senha}\n${senha}\n`);
    expect(code).toBe(0);
    expect(saida).not.toContain(senha);
    const u = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(u).toMatchObject({ name: 'Teste Admin', role: 'admin', ativo: true });
    expect(await auth.verificarSenha(u.passwordHash, senha)).toBe(true);
    expect(await auth.verificarSenha(u.passwordHash, 'Senha Teste c1')).toBe(false);
  });

  it('senhas diferentes ou curtas: erro e nada muda', async () => {
    const antes = (await prisma.user.findUnique({ where: { email: EMAIL } })).passwordHash;
    expect((await rodar('outra-senha-1\noutra-senha-2\n')).code).toBe(1);
    expect((await rodar('curta\ncurta\n')).code).toBe(1);
    expect((await prisma.user.findUnique({ where: { email: EMAIL } })).passwordHash).toBe(antes);
  });
});
