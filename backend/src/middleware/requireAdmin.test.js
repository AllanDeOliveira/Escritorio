import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireAdmin } = require('./requireAdmin');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');

const ADMIN_EMAIL = '__test_admin__@jvo.adv.br';
const MEMBER_EMAIL = '__test_member__@jvo.adv.br';
const tokens = {};
const comCookie = (t) => ({ headers: { cookie: `${auth.COOKIE}=${t}` } });

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const rodar = async (req) => {
  const res = mockRes();
  let nextCalled = false;
  await requireAdmin(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

describe('requireAdmin middleware', () => {
  beforeAll(async () => {
    for (const [email, role] of [[ADMIN_EMAIL, 'admin'], [MEMBER_EMAIL, 'member']]) {
      const u = await prisma.user.upsert({ where: { email }, update: { role, ativo: true }, create: { email, role } });
      tokens[role] = await auth.criarSessao(u.id);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, MEMBER_EMAIL] } } });
    await prisma.$disconnect();
  });

  it('401 sem sessão', async () => {
    const { res, nextCalled } = await rodar({ headers: {} });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('403 para membro logado que não é admin', async () => {
    const { res, nextCalled } = await rodar(comCookie(tokens.member));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('admin: next() com req.adminUser', async () => {
    const req = comCookie(tokens.admin);
    const { nextCalled } = await rodar(req);
    expect(nextCalled).toBe(true);
    expect(req.adminUser?.email).toBe(ADMIN_EMAIL);
  });
});
