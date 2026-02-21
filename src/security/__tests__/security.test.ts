/**
 * @fileoverview Tests for Security Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  // Sanitization
  sanitizePath,
  isPathSafe,
  sanitizeString,
  sanitizeQuery,
  sanitizeObject,
  escapeRegex,
  escapeShell,
  checkSizeLimit,
  DEFAULT_PATH_OPTIONS,
  DEFAULT_SIZE_LIMITS,

  // Rate limiting
  RateLimiter,
  CircuitBreaker,
  CompositeRateLimiter,
  createRateLimiter,
  createCircuitBreaker,
  createDefaultRateLimiter,

  // Error handling
  LiBrainianErrorBase,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  InternalError,
  normalizeError,
  withErrorBoundary,
  withErrorBoundarySync,
  formatErrorResponse,
  createError,
  ERROR_CODES,

  // Configuration
  createSecureConfig,
  applySecurityChecks,
  DEFAULT_SECURE_CONFIG,
} from '../index.js';

// ============================================================================
// SANITIZATION TESTS
// ============================================================================

describe('Path Sanitization', () => {
  describe('sanitizePath', () => {
    it('should accept valid relative paths', () => {
      const result = sanitizePath('src/index.ts');
      expect(result.valid).toBe(true);
      expect(result.value).toBeDefined();
    });

    it('should reject directory traversal attempts', () => {
      const result = sanitizePath('../../../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('BLOCKED_PATTERN');
    });

    it('should reject null byte injection', () => {
      const result = sanitizePath('file.txt\x00.exe');
      expect(result.valid).toBe(false);
    });

    it('should reject variable expansion attempts', () => {
      const result = sanitizePath('${HOME}/secrets');
      expect(result.valid).toBe(false);
    });

    it('should reject command substitution attempts', () => {
      const result = sanitizePath('$(whoami)/file');
      expect(result.valid).toBe(false);
    });

    it('should reject backtick execution', () => {
      const result = sanitizePath('`rm -rf`/file');
      expect(result.valid).toBe(false);
    });

    it('should reject absolute paths when not allowed', () => {
      const result = sanitizePath('/home/user/file.txt', { allowAbsolute: false });
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('ABSOLUTE_PATH_NOT_ALLOWED');
    });

    it('should accept absolute paths when allowed', () => {
      const result = sanitizePath('/home/user/file.txt', { allowAbsolute: true });
      expect(result.valid).toBe(true);
    });

    it('should enforce path length limits', () => {
      const longPath = 'a'.repeat(5000);
      const result = sanitizePath(longPath, { maxLength: 4096 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('PATH_TOO_LONG');
    });

    it('should validate against base directory', () => {
      const result = sanitizePath('subdir/file.txt', {
        baseDir: '/workspace',
        allowAbsolute: true,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject paths escaping base directory', () => {
      const result = sanitizePath('../outside/file.txt', {
        baseDir: '/workspace',
        allowAbsolute: true,
      });
      expect(result.valid).toBe(false);
    });

    it('should validate file extensions', () => {
      const result = sanitizePath('file.exe', {
        allowedExtensions: ['.ts', '.js'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_EXTENSION');
    });

    it('should accept allowed extensions', () => {
      const result = sanitizePath('file.ts', {
        allowedExtensions: ['.ts', '.js'],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject non-string input', () => {
      const result = sanitizePath(123 as unknown);
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_TYPE');
    });
  });

  describe('isPathSafe', () => {
    it('should return true for safe paths', () => {
      expect(isPathSafe('src/file.ts')).toBe(true);
    });

    it('should return false for unsafe paths', () => {
      expect(isPathSafe('../etc/passwd')).toBe(false);
    });
  });
});

describe('String Sanitization', () => {
  describe('sanitizeString', () => {
    it('should trim whitespace by default', () => {
      const result = sanitizeString('  hello  ');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello');
    });

    it('should normalize whitespace', () => {
      const result = sanitizeString('hello   world');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello world');
    });

    it('should strip HTML tags', () => {
      const result = sanitizeString('<script>alert("xss")</script>hello');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('alert("xss")hello');
    });

    it('should enforce maximum length', () => {
      const result = sanitizeString('hello world', { maxLength: 5 });
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should enforce minimum length', () => {
      const result = sanitizeString('hi', { minLength: 5 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('TOO_SHORT');
    });

    it('should reject non-string input', () => {
      const result = sanitizeString(123 as unknown);
      expect(result.valid).toBe(false);
    });

    it('should apply lowercase transformation', () => {
      const result = sanitizeString('HELLO', { lowercase: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello');
    });
  });

  describe('escapeRegex', () => {
    it('should escape regex special characters', () => {
      expect(escapeRegex('test.*')).toBe('test\\.\\*');
      expect(escapeRegex('(a|b)')).toBe('\\(a\\|b\\)');
      expect(escapeRegex('[a-z]')).toBe('\\[a-z\\]');
    });
  });

  describe('escapeShell', () => {
    it('should escape for safe shell usage', () => {
      expect(escapeShell("file's name")).toBe("'file'\\''s name'");
      expect(escapeShell('simple')).toBe("'simple'");
    });
  });
});

describe('Query Sanitization', () => {
  describe('sanitizeQuery', () => {
    it('should accept valid queries', () => {
      const result = sanitizeQuery('How does authentication work?');
      expect(result.valid).toBe(true);
    });

    it('should trim and normalize whitespace', () => {
      const result = sanitizeQuery('  query   with   spaces  ');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('query with spaces');
    });

    it('should remove null bytes', () => {
      const result = sanitizeQuery('query\x00with\x00nulls');
      expect(result.valid).toBe(true);
      expect(result.value).not.toContain('\x00');
    });

    it('should enforce length limits', () => {
      const longQuery = 'a'.repeat(6000);
      const result = sanitizeQuery(longQuery, { maxQueryLength: 5000 });
      expect(result.valid).toBe(true);
      expect(result.value!.length).toBe(5000);
    });

    it('should block dangerous regex patterns when configured', () => {
      const result = sanitizeQuery('(?=.*)', { blockRegexPatterns: true });
      expect(result.valid).toBe(false);
    });
  });
});

describe('Object Sanitization', () => {
  describe('sanitizeObject', () => {
    it('should validate required fields', () => {
      const result = sanitizeObject(
        { name: 'test' },
        {
          properties: { name: { type: 'string' } },
          required: ['name', 'id'],
        }
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true);
    });

    it('should validate field types', () => {
      const result = sanitizeObject(
        { count: 'not a number' },
        {
          properties: { count: { type: 'number' } },
        }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('TYPE_MISMATCH');
    });

    it('should apply field constraints', () => {
      const result = sanitizeObject(
        { count: 150 },
        {
          properties: { count: { type: 'number', maximum: 100 } },
        }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('ABOVE_MAXIMUM');
    });

    it('should validate enum values', () => {
      const result = sanitizeObject(
        { status: 'invalid' },
        {
          properties: { status: { type: 'string', enum: ['active', 'inactive'] } },
        }
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('INVALID_ENUM');
    });

    it('should apply default values', () => {
      const result = sanitizeObject(
        {},
        {
          properties: { count: { type: 'number', default: 10 } },
        }
      );
      expect(result.valid).toBe(true);
      expect((result.value as Record<string, number>).count).toBe(10);
    });

    it('should warn about unknown fields', () => {
      const result = sanitizeObject(
        { known: 'value', unknown: 'value' },
        {
          properties: { known: { type: 'string' } },
          additionalProperties: false,
        }
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('unknown'))).toBe(true);
    });
  });
});

describe('Size Limits', () => {
  describe('checkSizeLimit', () => {
    it('should accept values within limit', () => {
      const result = checkSizeLimit(1000, 2000, 'File');
      expect(result.valid).toBe(true);
    });

    it('should reject values exceeding limit', () => {
      const result = checkSizeLimit(3000, 2000, 'File');
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('SIZE_LIMIT_EXCEEDED');
    });
  });
});

// ============================================================================
// RATE LIMITING TESTS
// ============================================================================

describe('Rate Limiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createRateLimiter({
      maxRequests: 5,
      windowMs: 1000,
      slidingWindow: true,
    });
  });

  afterEach(() => {
    limiter.stop();
  });

  describe('basic rate limiting', () => {
    it('should allow requests within limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('client1').allowed).toBe(true);
      }
    });

    it('should reject requests exceeding limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.consume('client1');
      }
      expect(limiter.check('client1').allowed).toBe(false);
    });

    it('should track remaining requests', () => {
      limiter.consume('client1');
      limiter.consume('client1');
      const result = limiter.check('client1');
      expect(result.remaining).toBe(2); // 5 - 2 - 1 (current check)
    });

    it('should isolate different clients', () => {
      for (let i = 0; i < 5; i++) {
        limiter.consume('client1');
      }
      expect(limiter.check('client1').allowed).toBe(false);
      expect(limiter.check('client2').allowed).toBe(true);
    });

    it('should skip whitelisted keys', () => {
      const skipLimiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 1000,
        skipKeys: new Set(['admin']),
      });

      skipLimiter.consume('admin');
      skipLimiter.consume('admin');
      expect(skipLimiter.check('admin').allowed).toBe(true);

      skipLimiter.stop();
    });
  });

  describe('operation costs', () => {
    it('should apply operation costs', () => {
      const costLimiter = createRateLimiter({
        maxRequests: 10,
        windowMs: 1000,
        burstCapacity: 10,
        tokensPerSecond: 0, // Disable token refill for predictable test
        operationCosts: { expensive: 5, cheap: 1 },
      });

      // Expensive operations should exhaust limit faster
      costLimiter.consume('client1', 'expensive'); // costs 5
      costLimiter.consume('client1', 'expensive'); // costs 5, total = 10

      // Should be at or over limit now
      const result = costLimiter.check('client1');
      expect(result.allowed).toBe(false);

      costLimiter.stop();
    });
  });

  describe('reset', () => {
    it('should reset client rate limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.consume('client1');
      }
      expect(limiter.check('client1').allowed).toBe(false);

      limiter.reset('client1');
      expect(limiter.check('client1').allowed).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should track statistics', () => {
      limiter.consume('client1');
      limiter.consume('client2');
      limiter.consume('client1');

      const stats = limiter.getStats();
      expect(stats.totalKeys).toBe(2);
      expect(stats.totalRequests).toBe(3);
    });
  });
});

describe('Circuit Breaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = createCircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      openDurationMs: 100,
      failureWindowMs: 1000,
    });
  });

  describe('state transitions', () => {
    it('should start in closed state', () => {
      expect(breaker.getStatus().state).toBe('closed');
      expect(breaker.canExecute()).toBe(true);
    });

    it('should open after failure threshold', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getStatus().state).toBe('open');
      expect(breaker.canExecute()).toBe(false);
    });

    it('should transition to half-open after timeout', async () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getStatus().state).toBe('open');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getStatus().state).toBe('half-open');
    });

    it('should close after success threshold in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(breaker.getStatus().state).toBe('closed');
    });

    it('should reopen on failure in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      breaker.recordFailure();

      expect(breaker.getStatus().state).toBe('open');
    });
  });

  describe('reset', () => {
    it('should reset to closed state', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure();
      }
      expect(breaker.getStatus().state).toBe('open');

      breaker.reset();
      expect(breaker.getStatus().state).toBe('closed');
    });
  });
});

describe('Composite Rate Limiter', () => {
  let composite: CompositeRateLimiter;

  beforeEach(() => {
    composite = new CompositeRateLimiter();
    composite.addLimiter('short', { maxRequests: 5, windowMs: 1000 });
    composite.addLimiter('long', { maxRequests: 10, windowMs: 5000 });
    composite.addCircuitBreaker('main', { failureThreshold: 3 });
  });

  afterEach(() => {
    composite.stop();
  });

  it('should enforce multiple limits', () => {
    // Exhaust short limit
    for (let i = 0; i < 5; i++) {
      composite.check('client1');
    }

    const result = composite.check('client1');
    expect(result.allowed).toBe(false);
  });

  it('should check circuit breaker', () => {
    composite.recordFailure();
    composite.recordFailure();
    composite.recordFailure();

    const result = composite.check('client1');
    expect(result.allowed).toBe(false);
    expect(result.circuitOpen).toBe(true);
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Classes', () => {
  describe('LiBrainianErrorBase', () => {
    it('should create error with all properties', () => {
      const error = new LiBrainianErrorBase(
        'Test error',
        'TEST_ERROR',
        'validation',
        {
          details: { field: 'test' },
          suggestions: ['Try again'],
          retryable: true,
          retryDelayMs: 1000,
        }
      );

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.category).toBe('validation');
      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(true);
    });

    it('should convert to JSON', () => {
      const error = new LiBrainianErrorBase('Test', 'TEST', 'internal');
      const json = error.toJSON();

      expect(json.code).toBe('TEST');
      expect(json.message).toBe('Test');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should have correct category and status', () => {
      const error = new ValidationError('Invalid input');
      expect(error.category).toBe('validation');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('AuthenticationError', () => {
    it('should have correct category and status', () => {
      const error = new AuthenticationError('Invalid token');
      expect(error.category).toBe('authentication');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('AuthorizationError', () => {
    it('should have correct category and status', () => {
      const error = new AuthorizationError('Permission denied');
      expect(error.category).toBe('authorization');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('NotFoundError', () => {
    it('should format message correctly', () => {
      const error = new NotFoundError('File', '/path/to/file');
      expect(error.message).toBe("File '/path/to/file' not found");
      expect(error.statusCode).toBe(404);
    });
  });

  describe('RateLimitError', () => {
    it('should be retryable', () => {
      const error = new RateLimitError(5000);
      expect(error.retryable).toBe(true);
      expect(error.retryDelayMs).toBe(5000);
      expect(error.statusCode).toBe(429);
    });
  });

  describe('InternalError', () => {
    it('should hide internal details', () => {
      const error = new InternalError('trace-123');
      expect(error.message).toBe('An internal error occurred');
      expect(error.traceId).toBe('trace-123');
    });
  });
});

describe('Error Normalization', () => {
  describe('normalizeError', () => {
    it('should pass through LiBrainianErrorBase', () => {
      const error = new ValidationError('Test');
      const normalized = normalizeError(error);

      expect(normalized.code).toBe(ERROR_CODES.INVALID_INPUT);
    });

    it('should classify timeout errors', () => {
      const error = new Error('Connection timed out');
      const normalized = normalizeError(error);

      expect(normalized.category).toBe('timeout');
      expect(normalized.retryable).toBe(true);
    });

    it('should classify not found errors', () => {
      const error = new Error('File not found');
      const normalized = normalizeError(error);

      expect(normalized.category).toBe('resource_not_found');
    });

    it('should classify permission errors', () => {
      const error = new Error('Permission denied');
      const normalized = normalizeError(error);

      expect(normalized.category).toBe('authorization');
    });

    it('should classify network errors', () => {
      const error = new Error('ECONNREFUSED');
      const normalized = normalizeError(error);

      expect(normalized.category).toBe('external_service');
      expect(normalized.retryable).toBe(true);
    });

    it('should handle unknown errors safely', () => {
      const normalized = normalizeError('string error');

      expect(normalized.category).toBe('internal');
      expect(normalized.message).toBe('An unexpected error occurred');
    });
  });
});

describe('Error Boundary', () => {
  describe('withErrorBoundary', () => {
    it('should return success result', async () => {
      const result = await withErrorBoundary(
        async () => 'success',
        { operation: 'test' }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toBe('success');
      }
    });

    it('should catch and normalize errors', async () => {
      const result = await withErrorBoundary(
        async () => {
          throw new Error('Test error');
        },
        { operation: 'test' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.category).toBe('internal');
      }
    });

    it('should call onError callback', async () => {
      let capturedError: unknown;

      await withErrorBoundary(
        async () => {
          throw new Error('Test');
        },
        { operation: 'test' },
        {
          onError: (error, original) => {
            capturedError = original;
          },
        }
      );

      expect(capturedError).toBeInstanceOf(Error);
    });
  });

  describe('withErrorBoundarySync', () => {
    it('should return success result', () => {
      const result = withErrorBoundarySync(
        () => 'success',
        { operation: 'test' }
      );

      expect(result.success).toBe(true);
    });

    it('should catch synchronous errors', () => {
      const result = withErrorBoundarySync(
        () => {
          throw new Error('Test');
        },
        { operation: 'test' }
      );

      expect(result.success).toBe(false);
    });
  });
});

describe('Error Response Formatting', () => {
  describe('formatErrorResponse', () => {
    it('should include status code', () => {
      const error = new ValidationError('Test').toJSON();
      const response = formatErrorResponse(error);

      expect(response.statusCode).toBe(400);
    });

    it('should include Retry-After header for retryable errors', () => {
      const error = new RateLimitError(5000).toJSON();
      const response = formatErrorResponse(error);

      expect(response.headers['Retry-After']).toBe('5');
    });

    it('should include trace ID header', () => {
      const error = new InternalError('trace-123').toJSON();
      const response = formatErrorResponse(error);

      expect(response.headers['X-Trace-Id']).toBe('trace-123');
    });
  });

  describe('createError', () => {
    it('should create error from code', () => {
      const error = createError('INVALID_INPUT', 'Custom message');

      expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
      expect(error.message).toBe('Custom message');
      expect(error.category).toBe('validation');
    });

    it('should use default message if not provided', () => {
      const error = createError('PERMISSION_DENIED');

      expect(error.message).toBe('Permission denied');
    });
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('Secure Configuration', () => {
  describe('createSecureConfig', () => {
    it('should return defaults without overrides', () => {
      const config = createSecureConfig();

      expect(config.path.allowAbsolute).toBe(false);
      expect(config.rateLimit.enabled).toBe(true);
    });

    it('should merge overrides', () => {
      const config = createSecureConfig({
        path: { allowAbsolute: true },
        rateLimit: { maxRequestsPerMinute: 200 },
      });

      expect(config.path.allowAbsolute).toBe(true);
      expect(config.rateLimit.maxRequestsPerMinute).toBe(200);
      // Default values should be preserved
      expect(config.path.maxLength).toBe(DEFAULT_SECURE_CONFIG.path.maxLength);
    });
  });
});

describe('Security Checks', () => {
  describe('applySecurityChecks', () => {
    it('should allow valid requests', () => {
      const result = applySecurityChecks({
        path: 'src/file.ts',
        query: 'How does auth work?',
      });

      expect(result.allowed).toBe(true);
    });

    it('should reject invalid paths', () => {
      const result = applySecurityChecks({
        path: '../../../etc/passwd',
      });

      expect(result.allowed).toBe(false);
      expect(result.error?.code).toBe(ERROR_CODES.PATH_TRAVERSAL_ATTEMPT);
    });

    it('should apply rate limiting', () => {
      const rateLimiter = createDefaultRateLimiter();

      // Exhaust rate limit
      for (let i = 0; i < 25; i++) {
        applySecurityChecks({ clientId: 'test' }, rateLimiter);
      }

      const result = applySecurityChecks({ clientId: 'test' }, rateLimiter);
      expect(result.allowed).toBe(false);

      rateLimiter.stop();
    });
  });
});
