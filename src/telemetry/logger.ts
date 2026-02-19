import { isTelemetryDisabled } from '../utils/runtime_controls.js';
type LogContext = Record<string, unknown>;

type LoggerFn = (message: string, context?: LogContext) => void;

function shouldEmit(level: 'info' | 'warn' | 'error' | 'debug'): boolean {
  if (isTelemetryDisabled()) {
    return false;
  }

  const weights: Record<typeof level, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  const envLevel = String(process.env.LIBRARIAN_LOG_LEVEL ?? '').toLowerCase().trim();
  if (envLevel === 'silent' || envLevel === 'none' || envLevel === 'off' || envLevel === 'quiet') {
    return false;
  }
  const threshold = envLevel in weights
    ? (weights as Record<string, number>)[envLevel]!
    : (process.env.LIBRARIAN_VERBOSE === '1' ? weights.info : weights.warn);

  return weights[level] >= threshold;
}

const emit = (level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: LogContext): void => {
  if (!shouldEmit(level)) return;

  // IMPORTANT: This library is used in CLI contexts where stdout is reserved for
  // machine-readable output (e.g. `--json`). Keep all logs on stderr to avoid
  // corrupting JSON output streams.
  const logger = level === 'warn' ? console.warn : console.error;
  if (context && Object.keys(context).length > 0) {
    logger(message, context);
    return;
  }
  logger(message);
};

export const logInfo: LoggerFn = (message, context) => emit('info', message, context);
export const logWarning: LoggerFn = (message, context) => emit('warn', message, context);
export const logError: LoggerFn = (message, context) => emit('error', message, context);
export const logDebug: LoggerFn = (message, context) => emit('debug', message, context);
