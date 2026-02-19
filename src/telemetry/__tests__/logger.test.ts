import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logDebug, logError, logInfo, logWarning } from '../logger.js';

let originalVerbose: string | undefined;
let originalLevel: string | undefined;
let originalNoTelemetry: string | undefined;
let originalLocalOnly: string | undefined;

beforeEach(() => {
  originalVerbose = process.env.LIBRARIAN_VERBOSE;
  originalLevel = process.env.LIBRARIAN_LOG_LEVEL;
  originalNoTelemetry = process.env.LIBRARIAN_NO_TELEMETRY;
  originalLocalOnly = process.env.LIBRARIAN_LOCAL_ONLY;
  // Ensure logs are emitted for the "does log" assertions.
  process.env.LIBRARIAN_LOG_LEVEL = 'debug';
  delete process.env.LIBRARIAN_VERBOSE;
  delete process.env.LIBRARIAN_NO_TELEMETRY;
  delete process.env.LIBRARIAN_LOCAL_ONLY;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (typeof originalVerbose === 'string') process.env.LIBRARIAN_VERBOSE = originalVerbose;
  else delete process.env.LIBRARIAN_VERBOSE;
  if (typeof originalLevel === 'string') process.env.LIBRARIAN_LOG_LEVEL = originalLevel;
  else delete process.env.LIBRARIAN_LOG_LEVEL;
  if (typeof originalNoTelemetry === 'string') process.env.LIBRARIAN_NO_TELEMETRY = originalNoTelemetry;
  else delete process.env.LIBRARIAN_NO_TELEMETRY;
  if (typeof originalLocalOnly === 'string') process.env.LIBRARIAN_LOCAL_ONLY = originalLocalOnly;
  else delete process.env.LIBRARIAN_LOCAL_ONLY;
});

describe('telemetry logger', () => {
  const cases = [
    { fn: logInfo, level: 'info' as const, method: 'error' as const },
    { fn: logWarning, level: 'warn' as const, method: 'warn' as const },
    { fn: logError, level: 'error' as const, method: 'error' as const },
    { fn: logDebug, level: 'debug' as const, method: 'error' as const },
  ];

  for (const { fn, level, method } of cases) {
    it(`logs message only for ${level} when context is undefined`, () => {
      const spy = vi.spyOn(console, method).mockImplementation(() => {});

      fn('hello');

      expect(spy).toHaveBeenCalledWith('hello');
    });

    it(`logs message only for ${level} when context is empty`, () => {
      const spy = vi.spyOn(console, method).mockImplementation(() => {});

      fn('hello', {});

      expect(spy).toHaveBeenCalledWith('hello');
    });

    it(`logs message and context for ${level} when context has keys`, () => {
      const spy = vi.spyOn(console, method).mockImplementation(() => {});
      const context = { requestId: 'req-123' };

      fn('hello', context);

      expect(spy).toHaveBeenCalledWith('hello', context);
    });
  }

  it('suppresses info/debug logs by default when not verbose', () => {
    delete process.env.LIBRARIAN_LOG_LEVEL;
    delete process.env.LIBRARIAN_VERBOSE;

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logInfo('hello');
    logDebug('hello');

    expect(spy).not.toHaveBeenCalled();
  });

  it('emits info logs when verbose flag is enabled', () => {
    delete process.env.LIBRARIAN_LOG_LEVEL;
    process.env.LIBRARIAN_VERBOSE = '1';

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logInfo('hello');
    expect(spy).toHaveBeenCalledWith('hello');
  });

  it('suppresses all telemetry when no-telemetry is enabled', () => {
    process.env.LIBRARIAN_NO_TELEMETRY = '1';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logWarning('warn');
    logError('error');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('suppresses telemetry in local-only mode', () => {
    process.env.LIBRARIAN_LOCAL_ONLY = '1';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logInfo('hello');

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
