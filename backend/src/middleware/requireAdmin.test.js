import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { requireAdmin } = require('./requireAdmin');
const prisma = require('../infra/prismaClient');

const ADMIN_EMAIL = '__test_admin__@example.com';
const MEMBER_EMAIL = '__test_member__@example.com';

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

  it('rejects with 401 when no x-user-email header is sent', async () => {
    const req = { headers: {} };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects with 403 when the email does not belong to a known user', async () => {
    const req = { headers: { 'x-user-email': '__nobody__@example.com' } };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('rejects with 403 when the user exists but role is not admin', async () => {
    const req = { headers: { 'x-user-email': MEMBER_EMAIL } };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('calls next() and attaches req.adminUser when role is admin', async () => {
    const req = { headers: { 'x-user-email': ADMIN_EMAIL } };
    const res = mockRes();
    let nextCalled = false;

    await requireAdmin(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(req.adminUser?.email).toBe(ADMIN_EMAIL);
  });
});
