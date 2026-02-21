/**
 * @fileoverview Security Module for LiBrainian
 *
 * Provides comprehensive security capabilities:
 * - Input sanitization and validation
 * - Rate limiting with circuit breakers
 * - Error boundaries with safe error exposure
 * - Secure configuration defaults
 *
 * @packageDocumentation
 */

import { sanitizePath, sanitizeQuery } from './sanitization.js';
import { type CompositeRateLimiter } from './rate_limiter.js';
import { ERROR_CODES, type LiBrainianError } from './error_boundary.js';

// Sanitization
export {
  // Types
  type SanitizationResult,
  type SanitizationError,
  type PathSanitizationOptions,
  type StringSanitizationOptions,
  type QuerySanitizationOptions,
  type ObjectSchema,
  type FieldSchema,
  type SizeLimits,

  // Defaults
  DEFAULT_PATH_OPTIONS,
  DEFAULT_STRING_OPTIONS,
  DEFAULT_QUERY_OPTIONS,
  DEFAULT_SIZE_LIMITS,

  // Path sanitization
  sanitizePath,
  isPathSafe,

  // String sanitization
  sanitizeString,
  escapeRegex,
  escapeShell,
  removeControlChars,

  // Query sanitization
  sanitizeQuery,

  // Object sanitization
  sanitizeObject,

  // Size checking
  checkSizeLimit,
} from './sanitization.js';

// Rate limiting
export {
  // Types
  type RateLimiterConfig,
  type RateLimitResult,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStatus,

  // Defaults
  DEFAULT_RATE_LIMITER_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,

  // Classes
  RateLimiter,
  CircuitBreaker,
  CompositeRateLimiter,

  // Factories
  createRateLimiter,
  createCircuitBreaker,
  createDefaultRateLimiter,
} from './rate_limiter.js';

// Error handling
export {
  // Types
  type ErrorSeverity,
  type ErrorCategory,
  type LiBrainianError,
  type ErrorHandlerOptions,
  type ErrorBoundaryContext,

  // Constants
  ERROR_CODES,

  // Classes
  LiBrainianErrorBase,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  InternalError,

  // Functions
  normalizeError,
  withErrorBoundary,
  withErrorBoundarySync,
  formatErrorResponse,
  createError,
  redactSensitiveInfo,
  DEFAULT_SENSITIVE_PATTERNS,
} from './error_boundary.js';

// ============================================================================
// SECURE CONFIGURATION
// ============================================================================

/** Secure default configuration */
export interface SecureConfig {
  /** Path sanitization options */
  path: {
    allowAbsolute: boolean;
    allowSymlinks: boolean;
    maxLength: number;
    blockedExtensions: string[];
  };

  /** Rate limiting */
  rateLimit: {
    enabled: boolean;
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
    burstCapacity: number;
  };

  /** Size limits */
  size: {
    maxFileSize: number;
    maxRequestSize: number;
    maxQueryLength: number;
    maxResultCount: number;
  };

  /** Error handling */
  errors: {
    exposeDetails: boolean;
    includeStack: boolean;
    redactSensitive: boolean;
  };

  /** Session */
  session: {
    maxAge: number;
    renewalThreshold: number;
    maxSessionsPerClient: number;
  };
}

/** Default secure configuration */
export const DEFAULT_SECURE_CONFIG: SecureConfig = {
  path: {
    allowAbsolute: false,
    allowSymlinks: false,
    maxLength: 4096,
    blockedExtensions: ['.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.ps1'],
  },
  rateLimit: {
    enabled: true,
    maxRequestsPerMinute: 100,
    maxRequestsPerHour: 1000,
    burstCapacity: 20,
  },
  size: {
    maxFileSize: 10 * 1024 * 1024,     // 10 MB
    maxRequestSize: 50 * 1024 * 1024,  // 50 MB
    maxQueryLength: 5000,
    maxResultCount: 100,
  },
  errors: {
    exposeDetails: false,
    includeStack: false,
    redactSensitive: true,
  },
  session: {
    maxAge: 24 * 60 * 60 * 1000,       // 24 hours
    renewalThreshold: 60 * 60 * 1000,  // 1 hour
    maxSessionsPerClient: 10,
  },
};

/** Config overrides type - allows partial nested objects */
export interface SecureConfigOverrides {
  path?: Partial<SecureConfig['path']>;
  rateLimit?: Partial<SecureConfig['rateLimit']>;
  size?: Partial<SecureConfig['size']>;
  errors?: Partial<SecureConfig['errors']>;
  session?: Partial<SecureConfig['session']>;
}

/**
 * Create a secure configuration.
 */
export function createSecureConfig(
  overrides: SecureConfigOverrides = {}
): SecureConfig {
  return {
    ...DEFAULT_SECURE_CONFIG,
    ...overrides,
    path: { ...DEFAULT_SECURE_CONFIG.path, ...overrides.path },
    rateLimit: { ...DEFAULT_SECURE_CONFIG.rateLimit, ...overrides.rateLimit },
    size: { ...DEFAULT_SECURE_CONFIG.size, ...overrides.size },
    errors: { ...DEFAULT_SECURE_CONFIG.errors, ...overrides.errors },
    session: { ...DEFAULT_SECURE_CONFIG.session, ...overrides.session },
  };
}

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

/** Security middleware result */
export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  error?: LiBrainianError;
}

/**
 * Apply all security checks to a request.
 */
export function applySecurityChecks(
  input: {
    path?: string;
    query?: string;
    clientId?: string;
    operation?: string;
  },
  rateLimiter?: CompositeRateLimiter,
  config: SecureConfig = DEFAULT_SECURE_CONFIG
): SecurityCheckResult {
  // Path validation
  if (input.path) {
    const pathResult = sanitizePath(input.path, {
      allowAbsolute: config.path.allowAbsolute,
      allowSymlinks: config.path.allowSymlinks,
      maxLength: config.path.maxLength,
    });

    if (!pathResult.valid) {
      return {
        allowed: false,
        reason: 'Invalid path',
        error: {
          code: ERROR_CODES.PATH_TRAVERSAL_ATTEMPT,
          message: pathResult.errors[0]?.message || 'Invalid path',
          category: 'validation',
          severity: 'medium',
          statusCode: 400,
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  // Query validation
  if (input.query) {
    const queryResult = sanitizeQuery(input.query, {
      maxQueryLength: config.size.maxQueryLength,
    });

    if (!queryResult.valid) {
      return {
        allowed: false,
        reason: 'Invalid query',
        error: {
          code: ERROR_CODES.INVALID_INPUT,
          message: queryResult.errors[0]?.message || 'Invalid query',
          category: 'validation',
          severity: 'low',
          statusCode: 400,
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  // Rate limiting
  if (rateLimiter && config.rateLimit.enabled && input.clientId) {
    const rateLimitResult = rateLimiter.check(input.clientId, input.operation);

    if (!rateLimitResult.allowed) {
      return {
        allowed: false,
        reason: rateLimitResult.circuitOpen ? 'Circuit breaker open' : 'Rate limit exceeded',
        error: {
          code: rateLimitResult.circuitOpen
            ? ERROR_CODES.CIRCUIT_BREAKER_OPEN
            : ERROR_CODES.RATE_LIMIT_EXCEEDED,
          message: rateLimitResult.circuitOpen
            ? 'Service temporarily unavailable'
            : 'Rate limit exceeded',
          category: 'rate_limit',
          severity: 'low',
          statusCode: 429,
          retryable: true,
          retryDelayMs: rateLimitResult.resetMs,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  return { allowed: true };
}

