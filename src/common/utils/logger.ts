type LogLevel = 'error' | 'warn' | 'info' | 'debug';

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase().padEnd(5),
    message,
    ...meta,
  });

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};
