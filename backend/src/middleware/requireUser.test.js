import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireUser } = require('./requireUser');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');

const MEMBER_EMAIL = '__test_requireuser_member__@jvo.adv.br';
let userId;
let token;
const comCookie = (t) => ({ headers: { cookie: `${auth.COOKIE}=${t}` } });

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const rodar = async (req) => {
  const res = mockRes();
  let nextCalled = false;
  await requireUser(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

describe('requireUser middleware (sessão em cookie)', () => {
  beforeAll(async () => {
    ({ id: userId } = await prisma.user.upsert({
      where: { email: MEMBER_EMAIL },
      update: { role: 'member', ativo: true },
      create: { email: MEMBER_EMAIL, role: 'member' },
    }));
    token = await auth.criarSessao(userId);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: MEMBER_EMAIL } }); // sessões caem em cascata
    await prisma.$disconnect();
  });

  it('401 sem cookie de sessão', async () => {
    const { res, nextCalled } = await rodar({ headers: {} });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('401 com token inventado', async () => {
    const { res, nextCalled } = await rodar(comCookie('token-falso'));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('ignora um x-user-email forjado (401 sem sessão)', async () => {
    const { res } = await rodar({ headers: { 'x-user-email': MEMBER_EMAIL } });
    expect(res.statusCode).toBe(401);
  });

  it('sessão válida: next() e req.currentUser', async () => {
    const req = comCookie(token);
    const { nextCalled } = await rodar(req);
    expect(nextCalled).toBe(true);
    expect(req.currentUser?.email).toBe(MEMBER_EMAIL);
  });

  it('usuário desativado: 401 mesmo com sessão válida', async () => {
    await prisma.user.update({ where: { id: userId }, data: { ativo: false } });
    const { res } = await rodar(comCookie(token));
    expect(res.statusCode).toBe(401);
    await prisma.user.update({ where: { id: userId }, data: { ativo: true } });
  });

  it('sessão expirada: 401', async () => {
    await prisma.sessao.update({ where: { id: auth.idDoToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const { res } = await rodar(comCookie(token));
    expect(res.statusCode).toBe(401);
  });
});
