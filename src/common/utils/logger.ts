/**
 * FlowKey — Logger
 *
 * Structured logging with level and format driven by config.
 * In production: JSON output (machine-readable, structured for CloudWatch).
 * In development: pretty-printed output.
 *
 * CRITICAL: Never log secrets, tokens, PINs, passcodes, NIN, BVN, or
 * bank account numbers. The caller is responsible for sanitizing log data
 * before passing it here.
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getActiveLevel(): LogLevel {
  const env = process.env['LOG_LEVEL'] ?? 'info';
  if (env in LEVELS) return env as LogLevel;
  return 'info';
}

function getFormat(): 'json' | 'pretty' {
  return process.env['LOG_FORMAT'] === 'json' ? 'json' : 'pretty';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] <= LEVELS[getActiveLevel()];
}

function formatJson(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

function formatPretty(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const levelPad = level.toUpperCase().padEnd(5);
  const base = `[${ts}] ${levelPad} ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base}\n${JSON.stringify(meta, null, 2)}`;
  }
  return base;
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const output =
    getFormat() === 'json' ? formatJson(level, message, meta) : formatPretty(level, message, meta);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    // info and debug go to stdout
    // eslint-disable-next-line no-console
    console.log(output);
  }
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>): void => log('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>): void => log('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>): void => log('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>): void => log('debug', message, meta),
};
