import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('Prisma singleton sharing across module systems', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('./prismaClient')];
    // @ts-expect-error - test-only cleanup of the shared global before each run
    delete global.prisma;
  });

  it('CJS prismaClient.js and TS prisma.ts resolve to the same instance in-process', async () => {
    // Mirrors production: index.js (CJS, Express) requires ./dist/worker/worker.js
    // (compiled from these TS files) in the same Node process when RENDER=true.
    const cjsPrisma = require('./prismaClient');
    const { prisma: tsPrisma } = await import('./prisma');

    expect(tsPrisma).toBe(cjsPrisma);
  });
});
