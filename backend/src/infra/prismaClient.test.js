import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('prismaClient singleton (legacy Express process)', () => {
  beforeEach(() => {
    delete global.prisma;
    delete require.cache[require.resolve('./prismaClient')];
  });

  it('is a real Prisma Client exposing the app models', () => {
    const prisma = require('./prismaClient');

    expect(typeof prisma.user.findMany).toBe('function');
    expect(typeof prisma.intimacao.findMany).toBe('function');
    expect(typeof prisma.prazo.create).toBe('function');
  });

  it('sets global.prisma so all legacy require() sites resolve to one pool', () => {
    const prisma = require('./prismaClient');

    expect(global.prisma).toBe(prisma);
  });

  it('returns the same instance to every consumer, mimicking index.js + routes/*.js', () => {
    const fromIndex = require('./prismaClient');
    const fromPrazosRoutes = require('./prismaClient');
    const fromIntimacoesRoutes = require('./prismaClient');

    expect(fromPrazosRoutes).toBe(fromIndex);
    expect(fromIntimacoesRoutes).toBe(fromIndex);
  });

  it('reuses a pre-existing global.prisma instead of opening a second connection pool', () => {
    const { PrismaClient } = require('@prisma/client');
    const preExisting = new PrismaClient();
    global.prisma = preExisting;

    const loaded = require('./prismaClient');

    expect(loaded).toBe(preExisting);
  });
});
