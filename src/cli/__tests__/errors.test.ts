/**
 * @fileoverview Tests for structured error contracts
 *
 * Validates that the error system provides:
 * 1. Machine-readable error codes
 * 2. Accurate retryability hints
 * 3. Correct error classification from messages
 * 4. Proper JSON serialization for agent consumption
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorEnvelope,
  ErrorCodes,
  ErrorMetadata,
  ExitCodes,
  CliError,
  createError,
  createErrorEnvelope,
  classifyError,
  isRetryableError,
  getExitCode,
  isErrorEnvelope,
  formatError,
  formatErrorWithHints,
  formatErrorJson,
  type ErrorCode,
} from '../errors.js';

describe('ErrorEnvelope', () => {
  describe('createErrorEnvelope', () => {
    it('should create envelope with all required fields', () => {
      const envelope = createErrorEnvelope('ENOINDEX', 'Index not found');

      expect(envelope.code).toBe('ENOINDEX');
      expect(envelope.message).toBe('Index not found');
      expect(typeof envelope.retryable).toBe('boolean');
      expect(Array.isArray(envelope.recoveryHints)).toBe(true);
      expect(envelope.context?.timestamp).toBeDefined();
    });

    it('should use default metadata from ErrorMetadata', () => {
      const envelope = createErrorEnvelope('EPROVIDER_RATE_LIMIT', 'Rate limited');

      expect(envelope.retryable).toBe(true); // Rate limit errors are retryable
      expect(envelope.recoveryHints.length).toBeGreaterThan(0);
    });

    it('should allow overriding default values', () => {
      const envelope = createErrorEnvelope('ENOINDEX', 'Custom message', {
        retryable: true, // Override: ENOINDEX is normally not retryable
        recoveryHints: ['Custom hint'],
        context: { filePath: '/some/path' },
      });

      expect(envelope.retryable).toBe(true);
      expect(envelope.recoveryHints).toEqual(['Custom hint']);
      expect(envelope.context?.filePath).toBe('/some/path');
    });

    it('should include timestamp in context', () => {
      const before = Date.now();
      const envelope = createErrorEnvelope('EUNKNOWN', 'Test');
      const after = Date.now();

      const timestamp = new Date(envelope.context?.timestamp as string).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isErrorEnvelope', () => {
    it('should return true for valid envelopes', () => {
      const envelope: ErrorEnvelope = {
        code: 'ENOINDEX',
        message: 'Test',
        retryable: false,
        recoveryHints: [],
      };
      expect(isErrorEnvelope(envelope)).toBe(true);
    });

    it('should return false for invalid objects', () => {
      expect(isErrorEnvelope(null)).toBe(false);
      expect(isErrorEnvelope(undefined)).toBe(false);
      expect(isErrorEnvelope({})).toBe(false);
      expect(isErrorEnvelope({ code: 'X' })).toBe(false);
      expect(isErrorEnvelope({ code: 'X', message: 'Y' })).toBe(false);
      expect(isErrorEnvelope({ code: 'X', message: 'Y', retryable: true })).toBe(false);
    });

    it('should return true when recoveryHints is present', () => {
      expect(isErrorEnvelope({
        code: 'X',
        message: 'Y',
        retryable: true,
        recoveryHints: [],
      })).toBe(true);
    });
  });
});

describe('ErrorCodes', () => {
  it('should have descriptions for all error codes', () => {
    const codes = Object.keys(ErrorCodes) as ErrorCode[];
    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      expect(typeof ErrorCodes[code]).toBe('string');
      expect(ErrorCodes[code].length).toBeGreaterThan(0);
    }
  });

  it('should have metadata for all error codes', () => {
    const codes = Object.keys(ErrorCodes) as ErrorCode[];

    for (const code of codes) {
      const metadata = ErrorMetadata[code];
      expect(metadata).toBeDefined();
      expect(typeof metadata.retryable).toBe('boolean');
      expect(Array.isArray(metadata.recoveryHints)).toBe(true);
      expect(metadata.recoveryHints.length).toBeGreaterThan(0);
    }
  });

  it('should have exit codes for critical errors', () => {
    // Check that important errors have exit codes
    expect(ExitCodes.ENOINDEX).toBeDefined();
    expect(ExitCodes.EPROVIDER_UNAVAILABLE).toBeDefined();
    expect(ExitCodes.EINVALID_ARGUMENT).toBeDefined();
  });
});

describe('CliError', () => {
  it('should create error with legacy code', () => {
    const error = new CliError('Test message', 'NOT_BOOTSTRAPPED', 'Run bootstrap');

    expect(error.message).toBe('Test message');
    expect(error.code).toBe('NOT_BOOTSTRAPPED');
    expect(error.suggestion).toBe('Run bootstrap');
    expect(error.errorCode).toBe('ENOINDEX'); // Mapped from legacy code
  });

  it('should convert to ErrorEnvelope', () => {
    const error = new CliError('Provider is down', 'PROVIDER_UNAVAILABLE', 'Check providers', {
      provider: 'openai',
    });

    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('EPROVIDER_UNAVAILABLE');
    expect(envelope.message).toBe('Provider is down');
    expect(envelope.retryable).toBe(true);
    expect(envelope.recoveryHints.length).toBeGreaterThan(0);
    expect(envelope.context?.provider).toBe('openai');
  });

  it('should preserve details in envelope context', () => {
    const error = createError('QUERY_FAILED', 'Query timeout', {
      queryId: '123',
      duration: 5000,
    });

    const envelope = error.toEnvelope();

    expect(envelope.context?.queryId).toBe('123');
    expect(envelope.context?.duration).toBe(5000);
  });
});

describe('classifyError', () => {
  it('should pass through ErrorEnvelope unchanged', () => {
    const original: ErrorEnvelope = {
      code: 'ENOINDEX',
      message: 'Test',
      retryable: false,
      recoveryHints: ['hint'],
    };

    const classified = classifyError(original);
    expect(classified).toEqual(original);
  });

  it('should convert CliError to envelope', () => {
    const error = new CliError('Test', 'NOT_BOOTSTRAPPED');
    const envelope = classifyError(error);

    expect(envelope.code).toBe('ENOINDEX');
    expect(envelope.message).toBe('Test');
  });

  it('should classify standard Error by message content', () => {
    const testCases: Array<{ message: string; expectedCode: string }> = [
      { message: 'Provider unavailable', expectedCode: 'EPROVIDER_UNAVAILABLE' },
      { message: 'Rate limit exceeded with 429', expectedCode: 'EPROVIDER_RATE_LIMIT' },
      { message: 'Quota exceeded', expectedCode: 'EPROVIDER_QUOTA' },
      { message: 'Unauthorized access', expectedCode: 'EPROVIDER_AUTH' },
      { message: 'Model claude-unknown not found', expectedCode: 'EPROVIDER_MODEL_UNAVAILABLE' },
      { message: 'Not bootstrapped yet', expectedCode: 'ENOINDEX' },
      { message: 'Index is stale', expectedCode: 'ESTALE_INDEX' },
      { message: 'Database locked', expectedCode: 'ESTORAGE_LOCKED' },
      { message: 'Storage corrupt', expectedCode: 'ESTORAGE_CORRUPT' },
      { message: 'Query timed out', expectedCode: 'EQUERY_TIMEOUT' },
      { message: 'ENOENT: file not found', expectedCode: 'EFILE_NOT_FOUND' },
      { message: 'File is outside workspace', expectedCode: 'EFILE_OUTSIDE_WORKSPACE' },
      { message: 'Invalid argument provided', expectedCode: 'EINVALID_ARGUMENT' },
      { message: 'Bootstrap failed with error', expectedCode: 'EBOOTSTRAP_FAILED' },
      { message: 'Preflight check failed', expectedCode: 'EPREFLIGHT_FAILED' },
    ];

    for (const { message, expectedCode } of testCases) {
      const error = new Error(message);
      const envelope = classifyError(error);
      expect(envelope.code).toBe(expectedCode);
    }
  });

  it('sanitizes unverified trace markers in classified messages', () => {
    const envelope = classifyError(
      new Error('unverified_by_trace(provider_unavailable): Embedding provider unavailable')
    );

    expect(envelope.code).toBe('EPROVIDER_UNAVAILABLE');
    expect(envelope.message).toBe('Embedding provider unavailable');
    expect(envelope.message).not.toContain('unverified_by_trace');
  });

  it('should classify unknown errors as EUNKNOWN', () => {
    const error = new Error('Some completely unknown error');
    const envelope = classifyError(error);

    expect(envelope.code).toBe('EUNKNOWN');
    expect(envelope.retryable).toBe(true);
  });

  it('should handle non-Error values', () => {
    const envelope = classifyError('string error');
    expect(envelope.code).toBe('EUNKNOWN');
    expect(envelope.message).toBe('string error');

    const envelope2 = classifyError(123);
    expect(envelope2.message).toBe('123');

    const envelope3 = classifyError({ custom: 'object' });
    expect(envelope3.code).toBe('EUNKNOWN');
  });
});

describe('isRetryableError', () => {
  it('should return true for retryable errors', () => {
    const retryableErrors: ErrorCode[] = [
      'EPROVIDER_UNAVAILABLE',
      'EPROVIDER_QUOTA',
      'EPROVIDER_RATE_LIMIT',
      'EQUERY_TIMEOUT',
      'ESTORAGE_LOCKED',
      'EUNKNOWN',
    ];

    for (const code of retryableErrors) {
      const envelope = createErrorEnvelope(code, 'Test');
      expect(isRetryableError(envelope)).toBe(true);
    }
  });

  it('should return false for non-retryable errors', () => {
    const nonRetryableErrors: ErrorCode[] = [
      'ENOINDEX',
      'EINVALID_ARGUMENT',
      'EPROVIDER_AUTH',
      'EFILE_NOT_FOUND',
    ];

    for (const code of nonRetryableErrors) {
      const envelope = createErrorEnvelope(code, 'Test');
      expect(isRetryableError(envelope)).toBe(false);
    }
  });
});

describe('getExitCode', () => {
  it('should return specific exit codes for known errors', () => {
    expect(getExitCode(createErrorEnvelope('ENOINDEX', 'Test'))).toBe(10);
    expect(getExitCode(createErrorEnvelope('EPROVIDER_UNAVAILABLE', 'Test'))).toBe(30);
    expect(getExitCode(createErrorEnvelope('EINVALID_ARGUMENT', 'Test'))).toBe(50);
  });

  it('should return 1 for unknown error codes', () => {
    const envelope: ErrorEnvelope = {
      code: 'CUSTOM_ERROR',
      message: 'Test',
      retryable: false,
      recoveryHints: [],
    };
    expect(getExitCode(envelope)).toBe(1);
  });
});

describe('formatError', () => {
  it('should format CliError with error code', () => {
    const error = new CliError('Test message', 'NOT_BOOTSTRAPPED');
    const formatted = formatError(error);

    expect(formatted).toContain('ENOINDEX');
    expect(formatted).toContain('Test message');
  });

  it('should detect provider unavailable pattern', () => {
    const error = new Error('unverified_by_trace(provider_unavailable)');
    const formatted = formatError(error);

    expect(formatted).toContain('EPROVIDER_UNAVAILABLE');
  });

  it('should detect not bootstrapped pattern', () => {
    const error = new Error('not bootstrapped');
    const formatted = formatError(error);

    expect(formatted).toContain('ENOINDEX');
  });

  it('should detect ENOENT pattern', () => {
    const error = new Error('ENOENT: no such file');
    const formatted = formatError(error);

    expect(formatted).toContain('EFILE_NOT_FOUND');
  });
});

describe('formatErrorWithHints', () => {
  it('should include recovery hints', () => {
    const envelope = createErrorEnvelope('ENOINDEX', 'Index not found');
    const formatted = formatErrorWithHints(envelope);

    expect(formatted).toContain('ENOINDEX');
    expect(formatted).toContain('Index not found');
    expect(formatted).toContain('Recovery suggestions:');
    expect(formatted).toContain('librarian bootstrap');
  });

  it('should indicate retryability', () => {
    const retryableEnvelope = createErrorEnvelope('EPROVIDER_RATE_LIMIT', 'Rate limited');
    const formatted = formatErrorWithHints(retryableEnvelope);

    expect(formatted).toContain('retryable');
  });

  it('should include retry wait time when provided', () => {
    const envelope = createErrorEnvelope('EPROVIDER_RATE_LIMIT', 'Rate limited', {
      context: { retryAfterMs: 5000 },
    });
    const formatted = formatErrorWithHints(envelope);

    expect(formatted).toContain('5000ms');
  });

  it('sanitizes unverified trace marker text in formatted output', () => {
    const formatted = formatErrorWithHints(createErrorEnvelope(
      'EPROVIDER_UNAVAILABLE',
      'unverified_by_trace(provider_unavailable): Embedding provider unavailable',
    ));

    expect(formatted).toContain('Embedding provider unavailable');
    expect(formatted).not.toContain('unverified_by_trace');
  });
});

describe('formatErrorJson', () => {
  it('should output valid JSON with error wrapper', () => {
    const envelope = createErrorEnvelope('ENOINDEX', 'Test');
    const json = formatErrorJson(envelope);

    const parsed = JSON.parse(json);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe('ENOINDEX');
    expect(parsed.error.message).toBe('Test');
  });

  it('should include all envelope fields', () => {
    const envelope = createErrorEnvelope('EPROVIDER_UNAVAILABLE', 'Provider down', {
      context: { provider: 'openai', retryAfterMs: 1000 },
    });
    const json = formatErrorJson(envelope);

    const parsed = JSON.parse(json);
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.recoveryHints).toBeDefined();
    expect(parsed.error.context.provider).toBe('openai');
    expect(parsed.error.context.retryAfterMs).toBe(1000);
  });

  it('should be parseable by agents', () => {
    // Simulate agent parsing error response
    const envelope = createErrorEnvelope('EQUERY_TIMEOUT', 'Query timed out');
    const json = formatErrorJson(envelope);

    const parsed = JSON.parse(json);

    // Agent can check error type
    expect(parsed.error.code).toBe('EQUERY_TIMEOUT');

    // Agent can decide whether to retry
    expect(parsed.error.retryable).toBe(true);

    // Agent can read recovery hints
    expect(Array.isArray(parsed.error.recoveryHints)).toBe(true);
  });
});

describe('Error Recovery Scenarios', () => {
  it('should provide actionable hints for bootstrap errors', () => {
    const envelope = classifyError(new Error('Not bootstrapped'));

    expect(envelope.code).toBe('ENOINDEX');
    expect(envelope.recoveryHints.some(h => h.includes('bootstrap'))).toBe(true);
  });

  it('should provide actionable hints for provider errors', () => {
    const envelope = classifyError(new Error('Provider unavailable'));

    expect(envelope.code).toBe('EPROVIDER_UNAVAILABLE');
    expect(envelope.recoveryHints.some(h => h.includes('check-providers'))).toBe(true);
  });

  it('should provide wait time hint for rate limit errors', () => {
    const envelope = createErrorEnvelope('EPROVIDER_RATE_LIMIT', 'Rate limited', {
      context: { retryAfterMs: 60000 },
    });

    expect(envelope.retryable).toBe(true);
    expect(envelope.context?.retryAfterMs).toBe(60000);
    expect(envelope.recoveryHints.some(h => h.includes('Wait'))).toBe(true);
  });

  it('should help agents distinguish authentication from availability', () => {
    const authError = classifyError(new Error('Unauthorized: invalid API key'));
    const availError = classifyError(new Error('Provider unavailable'));

    // Auth errors are not retryable - need credential fix
    expect(authError.code).toBe('EPROVIDER_AUTH');
    expect(authError.retryable).toBe(false);

    // Availability errors are retryable - transient issue
    expect(availError.code).toBe('EPROVIDER_UNAVAILABLE');
    expect(availError.retryable).toBe(true);
  });
});
