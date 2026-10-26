import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const router = require('./authRoutes');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');

const EMAIL = '__test_login__@jvo.adv.br';
const SENHA = 'senha-de-teste-123';
let server;
let base;

const login = (email, senha) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }),
});
const cookieDe = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

describe('login próprio (integração)', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: EMAIL },
      update: { passwordHash: await auth.hashSenha(SENHA), ativo: true },
      create: { email: EMAIL, name: 'Tester Login', passwordHash: await auth.hashSenha(SENHA) },
    });
    const app = express();
    app.use(express.json());
    app.use('/api/auth', router);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => { router.limites.porIp.clear(); router.limites.falhas.clear(); });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('senha errada e e-mail inexistente: 401 com a mesma mensagem (não revela quem existe)', async () => {
    const a = await login(EMAIL, 'errada');
    const b = await login('__ninguem__@jvo.adv.br', 'errada');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect((await a.json()).error).toBe((await b.json()).error);
  });

  it('senha certa: cookie httpOnly + SameSite e o usuário sem o hash da senha', async () => {
    const r = await login(` ${EMAIL.toUpperCase()} `, SENHA); // e-mail sem diferenciar maiúsculas/espaços
    expect(r.status).toBe(200);
    const sc = r.headers.get('set-cookie');
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    const d = await r.json();
    expect(d.user.email).toBe(EMAIL);
    expect(d.user).not.toHaveProperty('passwordHash');
  });

  it('/me com o cookie responde o usuário; depois do logout o mesmo cookie não vale', async () => {
    const cookie = cookieDe(await login(EMAIL, SENHA));
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).user).not.toHaveProperty('passwordHash');
    expect((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } })).status).toBe(204);
    expect((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status).toBe(401);
  });

  it('usuário desativado não entra (403), mesmo com a senha certa', async () => {
    await prisma.user.update({ where: { email: EMAIL }, data: { ativo: false } });
    expect((await login(EMAIL, SENHA)).status).toBe(403);
    await prisma.user.update({ where: { email: EMAIL }, data: { ativo: true } });
  });

  it('10 senhas erradas seguidas travam aquele e-mail por 15 min, mesmo com a senha certa depois', async () => {
    for (let i = 0; i < 10; i++) await login(EMAIL, 'errada');
    router.limites.porIp.clear(); // isola a trava por e-mail da trava por IP
    const r = await login(EMAIL, SENHA);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toContain('este usuário');
  });

  it('mais de 10 tentativas por minuto do mesmo IP: 429, trocando de e-mail ou não', async () => {
    for (let i = 0; i < 10; i++) await login(`__rot${i}__@jvo.adv.br`, 'x');
    const r = await login('__rot_final__@jvo.adv.br', 'x');
    expect(r.status).toBe(429);
    expect((await r.json()).error).toContain('minuto');
  });
});
