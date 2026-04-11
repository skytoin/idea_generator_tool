import pino from 'pino';

/**
 * Select the pino log level based on NODE_ENV. Vitest sets NODE_ENV=test
 * so unit tests default to 'silent' and keep output clean; production
 * drops info logs and only surfaces warnings and errors; everything else
 * (dev) gets info. Exported for use by child loggers across the
 * codebase, e.g. logger.child({scanner: 'tech_scout'}).
 */
const level =
  process.env.NODE_ENV === 'test'
    ? 'silent'
    : process.env.NODE_ENV === 'production'
      ? 'warn'
      : 'info';

/**
 * Shared structured logger. Outputs JSON to stdout in dev/prod and is
 * silent during vitest runs. Callers create child loggers scoped by
 * component so every log line carries the scanner / adapter name.
 */
export const logger = pino({ level });
