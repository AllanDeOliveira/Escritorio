import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const express = require('express');
const router = require('./userRoutes');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');

const EMAIL = '__test_userroutes__@jvo.adv.br';
const ADMIN = '__test_userroutes_admin__@jvo.adv.br';
const NOVO = '__test_userroutes_novo__@jvo.adv.br';
const SENHA = 'senha-atual-123';
const cookies = {};
const ids = {};

let server;
let base;

const req = (method, path, body, quem = 'membro') =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(quem ? { cookie: cookies[quem] } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('userRoutes (integração)', () => {
  beforeAll(async () => {
    for (const [quem, email, role] of [['membro', EMAIL, 'member'], ['admin', ADMIN, 'admin']]) {
      const u = await prisma.user.upsert({
        where: { email },
        update: { areas: [], role, ativo: true, passwordHash: await auth.hashSenha(SENHA) },
        create: { email, name: quem === 'membro' ? 'Tester Áreas' : 'Tester Admin', role, passwordHash: await auth.hashSenha(SENHA) },
      });
      ids[quem] = u.id;
      cookies[quem] = `${auth.COOKIE}=${await auth.criarSessao(u.id)}`;
    }
    const app = express();
    app.use(express.json());
    app.use('/api/users', router); // montado sem middleware, como no index.js
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [EMAIL, ADMIN, NOVO] } } });
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/users sem sessão → 401 (cada rota exige usuário)', async () => {
    expect((await req('GET', '/api/users', undefined, null)).status).toBe(401);
  });

  it('GET /api/users lista a equipe sem dado sensível (nada de hash de senha)', async () => {
    const d = await (await req('GET', '/api/users')).json();
    const eu = d.users.find((u) => u.email === EMAIL);
    expect(Object.keys(eu).sort()).toEqual(['ativo', 'email', 'id', 'name', 'noQuadro']);
  });

  it('PUT /me/areas salva sem duplicar; área desconhecida → 400 e nada muda', async () => {
    expect((await (await req('PUT', '/api/users/me/areas', { areas: ['bancario', 'fazenda', 'bancario'] })).json()).areas).toEqual(['bancario', 'fazenda']);
    const r = await req('PUT', '/api/users/me/areas', { areas: ['bancario', 'criminal'] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('criminal');
    expect((await prisma.user.findUnique({ where: { email: EMAIL } })).areas).toEqual(['bancario', 'fazenda']);
  });

  it('PUT /me troca o nome de exibição (sem devolver o hash)', async () => {
    const d = await (await req('PUT', '/api/users/me', { name: '  Novo Nome  ' })).json();
    expect(d.user.name).toBe('Novo Nome');
    expect(d.user).not.toHaveProperty('passwordHash');
  });

  it('PUT /me/senha: exige a senha atual e o mínimo de 8 caracteres', async () => {
    expect((await req('PUT', '/api/users/me/senha', { atual: 'errada', nova: 'nova-senha-123' })).status).toBe(400);
    expect((await req('PUT', '/api/users/me/senha', { atual: SENHA, nova: 'curta' })).status).toBe(400);
    expect((await req('PUT', '/api/users/me/senha', { atual: SENHA, nova: 'nova-senha-123' })).status).toBe(200);
    const u = await prisma.user.findUnique({ where: { email: EMAIL } });
    expect(await auth.verificarSenha(u.passwordHash, 'nova-senha-123')).toBe(true);
    // a sessão de quem trocou continua valendo
    expect((await req('GET', '/api/users')).status).toBe(200);
  });

  it('POST /api/users: membro → 403; admin cria com senha (o hash não volta na resposta)', async () => {
    expect((await req('POST', '/api/users', { email: NOVO, name: 'Novo', senha: 'inicial-123' })).status).toBe(403);
    expect((await req('POST', '/api/users', { email: NOVO, name: 'Novo', senha: 'curta' }, 'admin')).status).toBe(400);
    const r = await req('POST', '/api/users', { email: NOVO, name: 'Novo', senha: 'inicial-123' }, 'admin');
    expect(r.status).toBe(201);
    expect((await r.json()).user).not.toHaveProperty('passwordHash');
    const u = await prisma.user.findUnique({ where: { email: NOVO } });
    expect(await auth.verificarSenha(u.passwordHash, 'inicial-123')).toBe(true);
  });

  it('token do robô: aparece uma vez só, a lista não traz o hash, só o dono revoga', async () => {
    const r = await req('POST', '/api/users/me/tokens-robo');
    expect(r.status).toBe(201);
    const { token, id } = await r.json();
    expect(token).toMatch(/^jvo_robo_/);
    expect((await auth.usuarioDoTokenRobo(token)).email).toBe(EMAIL);
    const lista = (await (await req('GET', '/api/users/me/tokens-robo')).json()).tokens;
    expect(lista.find((t) => t.id === id)).not.toHaveProperty('hash');
    expect(JSON.stringify(lista)).not.toContain(token);
    expect((await req('DELETE', `/api/users/me/tokens-robo/${id}`, undefined, 'admin')).status).toBe(404); // de outro usuário
    expect((await req('DELETE', `/api/users/me/tokens-robo/${id}`)).status).toBe(204);
    expect(await auth.usuarioDoTokenRobo(token)).toBeNull();
  });

  it('admin desativa um membro: a sessão dele cai na hora; não pode desativar a si mesmo', async () => {
    expect((await req('PUT', `/api/users/${ids.admin}/ativo`, { ativo: false }, 'admin')).status).toBe(400);
    expect((await req('PUT', `/api/users/${ids.membro}/ativo`, { ativo: false }, 'admin')).status).toBe(200);
    expect((await req('GET', '/api/users')).status).toBe(401);
    expect(await prisma.sessao.count({ where: { userId: ids.membro } })).toBe(0);
  });
});
