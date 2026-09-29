import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const router = require('./userRoutes');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');
// Stub do Firebase: o "token" é o próprio e-mail; 'nao-verificado:' simula e-mail não verificado.
auth.verificarToken = async (t) => {
  if (t === 'invalido') throw new Error('token inválido');
  const naoVerif = t.startsWith('nao-verificado:');
  return { email: naoVerif ? t.slice(15) : t, email_verified: !naoVerif };
};
const bearer = (email) => ({ authorization: `Bearer ${email}` });

const EMAIL = '__test_userroutes__@jvo.adv.br';

let server;
let base;

const req = (method, path, body, email = EMAIL) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(email ? bearer(email) : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('userRoutes — equipe e minhas áreas (integração)', () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { email: EMAIL }, update: { areas: [] }, create: { email: EMAIL, name: 'Tester Áreas' } });
    const app = express();
    app.use(express.json());
    app.use('/api/users', router); // montado sem middleware, como no index.js
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/users sem identificação → 401 (a rota exige usuário mesmo com o router aberto)', async () => {
    const r = await req('GET', '/api/users', undefined, null);
    expect(r.status).toBe(401);
  });

  it('GET /api/users lista a equipe só com id, nome, e-mail e noQuadro', async () => {
    const d = await (await req('GET', '/api/users')).json();
    expect(d.success).toBe(true);
    const eu = d.users.find((u) => u.email === EMAIL);
    expect(Object.keys(eu).sort()).toEqual(['email', 'id', 'name', 'noQuadro']);
    expect(eu.name).toBe('Tester Áreas');
  });

  it('PUT /api/users/me/areas salva as áreas sem duplicar', async () => {
    const r = await req('PUT', '/api/users/me/areas', { areas: ['bancario', 'fazenda', 'bancario'] });
    expect(r.status).toBe(200);
    expect((await r.json()).areas).toEqual(['bancario', 'fazenda']);
    const u = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(u.areas).toEqual(['bancario', 'fazenda']);
  });

  it('PUT /api/users/me/areas com área desconhecida → 400 listando a inválida, nada muda', async () => {
    const r = await req('PUT', '/api/users/me/areas', { areas: ['bancario', 'criminal'] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('criminal');
    const u = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(u.areas).toEqual(['bancario', 'fazenda']);
  });

  it('PUT /api/users/me/areas sem lista → 400', async () => {
    const r = await req('PUT', '/api/users/me/areas', { areas: 'bancario' });
    expect(r.status).toBe(400);
  });

  it('POST /api/users/sync sem token → 401 e não cria ninguém', async () => {
    const intruso = '__test_intruso__@jvo.adv.br';
    const r = await fetch(`${base}/api/users/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: intruso }),
    });
    expect(r.status).toBe(401);
    expect(await prisma.user.findUnique({ where: { email: intruso } })).toBeNull();
  });

  it('POST /api/users/sync de fora do domínio → 403', async () => {
    const r = await req('POST', '/api/users/sync', {}, 'intruso@gmail.com');
    expect(r.status).toBe(403);
  });

  it('POST /api/users/sync usa o e-mail do token, não o do corpo', async () => {
    const outro = '__test_outro__@jvo.adv.br';
    const d = await (await req('POST', '/api/users/sync', { email: outro })).json();
    expect(d.user.email).toBe(EMAIL);
    expect(await prisma.user.findUnique({ where: { email: outro } })).toBeNull();
  });
});
