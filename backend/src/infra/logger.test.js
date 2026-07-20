import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('logger (structured logging via pino)', () => {
  const originalLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    delete require.cache[require.resolve('./logger')];
  });

  afterEach(() => {
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
    delete require.cache[require.resolve('./logger')];
  });

  it('exposes the standard pino logging methods used across the codebase', () => {
    const logger = require('./logger');

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    // Sanity that this is really a pino instance, not a console shim
    expect(typeof logger.child).toBe('function');
  });

  it('defaults to "info" level when LOG_LEVEL is not set', () => {
    delete process.env.LOG_LEVEL;
    delete require.cache[require.resolve('./logger')];

    const logger = require('./logger');

    expect(logger.level).toBe('info');
  });

  it('honors LOG_LEVEL from the environment', () => {
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('./logger')];

    const logger = require('./logger');

    expect(logger.level).toBe('debug');
  });

  it('does not throw when logging with interpolation args, matching call sites like logger.error(msg, err)', () => {
    const logger = require('./logger');

    expect(() => logger.info('some message')).not.toThrow();
    expect(() => logger.error('failed:', new Error('boom'))).not.toThrow();
    expect(() => logger.warn('careful:', { detail: 'x' })).not.toThrow();
  });
});
