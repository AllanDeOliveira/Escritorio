import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireUser } = require('./requireUser');
const prisma = require('../infra/prismaClient');

const MEMBER_EMAIL = '__test_requireuser_member__@example.com';

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

describe('requireUser middleware', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email: MEMBER_EMAIL },
      update: { role: 'member' },
      create: { email: MEMBER_EMAIL, role: 'member' },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: MEMBER_EMAIL } });
    await prisma.$disconnect();
  });

  it('rejects with 401 when no x-user-email header is sent', async () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;

    await requireUser(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 403 when the email does not belong to a known user', async () => {
    const req = { headers: { 'x-user-email': '__nobody_requireuser__@example.com' } };
    const res = mockRes();
    let nextCalled = false;

    await requireUser(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('calls next() for a regular (non-admin) member and attaches req.currentUser', async () => {
    const req = { headers: { 'x-user-email': MEMBER_EMAIL } };
    const res = mockRes();
    let nextCalled = false;

    await requireUser(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.currentUser?.email).toBe(MEMBER_EMAIL);
  });
});
