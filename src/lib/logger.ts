type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const isProduction = process.env.NODE_ENV === 'production';

function writeLog(level: LogLevel, scope: string, args: unknown[]): void {
  if (isProduction) return;

  const prefix = `[${level}] [${scope}]`;
  if (level === 'ERROR') {
    console.error(prefix, ...args);
    return;
  }
  if (level === 'WARN') {
    console.warn(prefix, ...args);
    return;
  }
  console.info(prefix, ...args);
}

/**
 * Create a scoped logger that is muted in production.
 */
export function createLogger(scope: string): {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
} {
  return {
    info: (...args: unknown[]) => writeLog('INFO', scope, args),
    warn: (...args: unknown[]) => writeLog('WARN', scope, args),
    error: (...args: unknown[]) => writeLog('ERROR', scope, args),
  };
}
