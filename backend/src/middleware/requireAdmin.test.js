import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireAdmin } = require('./requireAdmin');
const prisma = require('../infra/prismaClient');
const auth = require('../infra/auth');
// Stub do Firebase: o "token" é o próprio e-mail; 'nao-verificado:' simula e-mail não verificado.
auth.verificarToken = async (t) => {
  if (t === 'invalido') throw new Error('token inválido');
  const naoVerif = t.startsWith('nao-verificado:');
  return { email: naoVerif ? t.slice(15) : t, email_verified: !naoVerif };
};
const bearer = (email) => ({ authorization: `Bearer ${email}` });

const ADMIN_EMAIL = '__test_admin__@jvo.adv.br';
const MEMBER_EMAIL = '__test_member__@jvo.adv.br';

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

describe('requireAdmin middleware', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { role: 'admin' },
      create: { email: ADMIN_EMAIL, role: 'admin' },
    });
    await prisma.user.upsert({
      where: { email: MEMBER_EMAIL },
      update: { role: 'member' },
      create: { email: MEMBER_EMAIL, role: 'member' },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, MEMBER_EMAIL] } } });
    await prisma.$disconnect();
  });

  it('rejects with 401 when no Bearer token is sent', async () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 403 when the email does not belong to a known user', async () => {
    const req = { headers: bearer('__nobody__@jvo.adv.br') };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('rejects with 403 when the user exists but role is not admin', async () => {
    const req = { headers: bearer(MEMBER_EMAIL) };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('calls next() and attaches req.adminUser when role is admin', async () => {
    const req = { headers: bearer(ADMIN_EMAIL) };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.adminUser?.email).toBe(ADMIN_EMAIL);
  });

  it('ignores a forged x-user-email header (401 without token)', async () => {
    const req = { headers: { 'x-user-email': 'alguem@jvo.adv.br' } };
    const res = mockRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 401 when the token is invalid', async () => {
    const req = { headers: bearer('invalido') };
    const res = mockRes();
    await requireAdmin(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 403 a valid token from outside the office domain', async () => {
    const req = { headers: bearer('intruso@gmail.com') };
    const res = mockRes();
    let nextCalled = false;
    await requireAdmin(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('rejects with 403 an office e-mail that is not verified', async () => {
    const req = { headers: bearer('nao-verificado:x@jvo.adv.br') };
    const res = mockRes();
    await requireAdmin(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });
});
