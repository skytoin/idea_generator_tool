import { describe, it, expect } from 'vitest';
import { logger } from '../../../lib/utils/logger';

describe('logger', () => {
  it('is a pino logger instance (duck-type check)', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('has level silent when NODE_ENV === test (vitest default)', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(logger.level).toBe('silent');
  });

  it('child logger inherits the same methods', () => {
    const child = logger.child({ scanner: 'tech_scout' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.child).toBe('function');
  });
});
