/**
 * @fileoverview Error Boundaries for LiBrainian
 *
 * Provides comprehensive error handling:
 * - Error classification and normalization
 * - Safe error exposure (no sensitive data leaks)
 * - Error recovery strategies
 * - Structured error responses
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/** Error severity levels */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Error categories */
export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'resource_not_found'
  | 'conflict'
  | 'timeout'
  | 'internal'
  | 'external_service'
  | 'configuration';

/** Structured error */
export interface LiBrainianError {
  /** Error code */
  code: string;

  /** User-safe message */
  message: string;

  /** Error category */
  category: ErrorCategory;

  /** Severity level */
  severity: ErrorSeverity;

  /** HTTP status code equivalent */
  statusCode: number;

  /** Additional details (safe for exposure) */
  details?: Record<string, unknown>;

  /** Recovery suggestions */
  suggestions?: string[];

  /** Whether error is retryable */
  retryable: boolean;

  /** Retry delay in milliseconds (if retryable) */
  retryDelayMs?: number;

  /** Timestamp */
  timestamp: string;

  /** Request/trace ID (if available) */
  traceId?: string;
}

/** Error handler options */
export interface ErrorHandlerOptions {
  /** Include stack traces (development only) */
  includeStack?: boolean;

  /** Custom error transformer */
  transform?: (error: unknown) => LiBrainianError;

  /** Error callback */
  onError?: (error: LiBrainianError, original: unknown) => void;

  /** Sensitive field patterns to redact */
  sensitivePatterns?: RegExp[];
}

/** Error boundary context */
export interface ErrorBoundaryContext {
  /** Operation name */
  operation: string;

  /** Client/session ID */
  clientId?: string;

  /** Workspace path */
  workspace?: string;

  /** Additional context */
  context?: Record<string, unknown>;
}

// ============================================================================
// ERROR DEFINITIONS
// ============================================================================

/** Standard error codes */
export const ERROR_CODES = {
  // Validation errors (400)
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  VALUE_OUT_OF_RANGE: 'VALUE_OUT_OF_RANGE',
  PATH_TRAVERSAL_ATTEMPT: 'PATH_TRAVERSAL_ATTEMPT',

  // Authentication errors (401)
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_INVALID: 'SESSION_INVALID',

  // Authorization errors (403)
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  SCOPE_INSUFFICIENT: 'SCOPE_INSUFFICIENT',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  WORKSPACE_ACCESS_DENIED: 'WORKSPACE_ACCESS_DENIED',

  // Not found errors (404)
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FUNCTION_NOT_FOUND: 'FUNCTION_NOT_FOUND',

  // Conflict errors (409)
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Rate limit errors (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  CIRCUIT_BREAKER_OPEN: 'CIRCUIT_BREAKER_OPEN',

  // Internal errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INDEX_CORRUPTION: 'INDEX_CORRUPTION',

  // External service errors (502/503)
  EMBEDDING_SERVICE_ERROR: 'EMBEDDING_SERVICE_ERROR',
  EXTERNAL_SERVICE_UNAVAILABLE: 'EXTERNAL_SERVICE_UNAVAILABLE',
  SERVICE_TIMEOUT: 'SERVICE_TIMEOUT',

  // Configuration errors (500)
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  MISSING_CONFIGURATION: 'MISSING_CONFIGURATION',
} as const;

/** HTTP status codes for error categories */
const CATEGORY_STATUS_CODES: Record<ErrorCategory, number> = {
  validation: 400,
  authentication: 401,
  authorization: 403,
  resource_not_found: 404,
  conflict: 409,
  rate_limit: 429,
  timeout: 504,
  internal: 500,
  external_service: 502,
  configuration: 500,
};

/** Error severity by category */
const CATEGORY_SEVERITY: Record<ErrorCategory, ErrorSeverity> = {
  validation: 'low',
  authentication: 'medium',
  authorization: 'medium',
  resource_not_found: 'low',
  conflict: 'medium',
  rate_limit: 'low',
  timeout: 'medium',
  internal: 'high',
  external_service: 'high',
  configuration: 'critical',
};

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Base error class for LiBrainian errors.
 */
export class LiBrainianErrorBase extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  readonly suggestions?: string[];
  readonly retryable: boolean;
  readonly retryDelayMs?: number;
  readonly timestamp: string;
  readonly traceId?: string;

  constructor(
    message: string,
    code: string,
    category: ErrorCategory,
    options: {
      details?: Record<string, unknown>;
      suggestions?: string[];
      retryable?: boolean;
      retryDelayMs?: number;
      traceId?: string;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'LiBrainianError';
    this.code = code;
    this.category = category;
    this.severity = CATEGORY_SEVERITY[category];
    this.statusCode = CATEGORY_STATUS_CODES[category];
    this.details = options.details;
    this.suggestions = options.suggestions;
    this.retryable = options.retryable ?? false;
    this.retryDelayMs = options.retryDelayMs;
    this.timestamp = new Date().toISOString();
    this.traceId = options.traceId;

    if (options.cause) {
      // ES2022 cause property
      (this as Error & { cause?: Error }).cause = options.cause;
    }

    // Capture stack trace
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert to LiBrainianError format.
   */
  toJSON(): LiBrainianError {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      severity: this.severity,
      statusCode: this.statusCode,
      details: this.details,
      suggestions: this.suggestions,
      retryable: this.retryable,
      retryDelayMs: this.retryDelayMs,
      timestamp: this.timestamp,
      traceId: this.traceId,
    };
  }
}

/**
 * Validation error.
 */
export class ValidationError extends LiBrainianErrorBase {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ERROR_CODES.INVALID_INPUT, 'validation', {
      details,
      suggestions: ['Check input format and try again'],
    });
    this.name = 'ValidationError';
  }
}

/**
 * Authentication error.
 */
export class AuthenticationError extends LiBrainianErrorBase {
  constructor(message: string, code: string = ERROR_CODES.AUTHENTICATION_REQUIRED) {
    super(message, code, 'authentication', {
      suggestions: ['Provide valid authentication credentials'],
    });
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error.
 */
export class AuthorizationError extends LiBrainianErrorBase {
  constructor(message: string, code: string = ERROR_CODES.PERMISSION_DENIED) {
    super(message, code, 'authorization', {
      suggestions: ['Request additional permissions or contact administrator'],
    });
    this.name = 'AuthorizationError';
  }
}

/**
 * Not found error.
 */
export class NotFoundError extends LiBrainianErrorBase {
  constructor(resource: string, identifier?: string) {
    super(
      identifier ? `${resource} '${identifier}' not found` : `${resource} not found`,
      ERROR_CODES.RESOURCE_NOT_FOUND,
      'resource_not_found'
    );
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limit error.
 */
export class RateLimitError extends LiBrainianErrorBase {
  constructor(retryAfterMs: number) {
    super('Rate limit exceeded', ERROR_CODES.RATE_LIMIT_EXCEEDED, 'rate_limit', {
      retryable: true,
      retryDelayMs: retryAfterMs,
      details: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
      suggestions: ['Wait before retrying', 'Reduce request frequency'],
    });
    this.name = 'RateLimitError';
  }
}

/**
 * Internal error (safe for external exposure).
 */
export class InternalError extends LiBrainianErrorBase {
  constructor(traceId?: string) {
    super('An internal error occurred', ERROR_CODES.INTERNAL_ERROR, 'internal', {
      traceId,
      suggestions: ['Try again later', 'Contact support if problem persists'],
    });
    this.name = 'InternalError';
  }
}

// ============================================================================
// ERROR NORMALIZATION
// ============================================================================

/** Default sensitive patterns */
const DEFAULT_SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,
  /api[_-]?key/i,
  /private/i,
];

/**
 * Normalize any error to LiBrainianError format.
 */
export function normalizeError(
  error: unknown,
  options: ErrorHandlerOptions = {}
): LiBrainianError {
  // Already a LiBrainianError
  if (error instanceof LiBrainianErrorBase) {
    return error.toJSON();
  }

  // Custom transformer
  if (options.transform) {
    return options.transform(error);
  }

  // Standard Error
  if (error instanceof Error) {
    // Check for known error types
    const normalized = classifyError(error);
    return normalized;
  }

  // Unknown error type
  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    category: 'internal',
    severity: 'high',
    statusCode: 500,
    retryable: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Classify a standard error.
 */
function classifyError(error: Error): LiBrainianError {
  const message = error.message.toLowerCase();

  // Timeout
  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      code: ERROR_CODES.SERVICE_TIMEOUT,
      message: 'Operation timed out',
      category: 'timeout',
      severity: 'medium',
      statusCode: 504,
      retryable: true,
      retryDelayMs: 1000,
      suggestions: ['Try again', 'Consider a simpler query'],
      timestamp: new Date().toISOString(),
    };
  }

  // Not found
  if (message.includes('not found') || message.includes('does not exist')) {
    return {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: redactSensitiveInfo(error.message),
      category: 'resource_not_found',
      severity: 'low',
      statusCode: 404,
      retryable: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Permission
  if (message.includes('permission') || message.includes('access denied')) {
    return {
      code: ERROR_CODES.PERMISSION_DENIED,
      message: 'Access denied',
      category: 'authorization',
      severity: 'medium',
      statusCode: 403,
      retryable: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Connection/network
  if (message.includes('connection') || message.includes('network') || message.includes('econnrefused')) {
    return {
      code: ERROR_CODES.EXTERNAL_SERVICE_UNAVAILABLE,
      message: 'Service temporarily unavailable',
      category: 'external_service',
      severity: 'high',
      statusCode: 503,
      retryable: true,
      retryDelayMs: 5000,
      suggestions: ['Try again in a few moments'],
      timestamp: new Date().toISOString(),
    };
  }

  // Default to internal error (redact message)
  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'An internal error occurred',
    category: 'internal',
    severity: 'high',
    statusCode: 500,
    retryable: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Redact sensitive information from error messages.
 */
function redactSensitiveInfo(
  message: string,
  patterns: RegExp[] = DEFAULT_SENSITIVE_PATTERNS
): string {
  let redacted = message;

  for (const pattern of patterns) {
    // Redact values following sensitive keys
    redacted = redacted.replace(
      new RegExp(`(${pattern.source})[=:][^\\s,;]+`, 'gi'),
      '$1=[REDACTED]'
    );
  }

  // Redact file paths that might contain sensitive info
  redacted = redacted.replace(/\/home\/[^/]+/g, '/home/[USER]');
  redacted = redacted.replace(/\/Users\/[^/]+/g, '/Users/[USER]');
  redacted = redacted.replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\[USER]');

  return redacted;
}

// ============================================================================
// ERROR BOUNDARY
// ============================================================================

/**
 * Error boundary for async operations.
 */
export async function withErrorBoundary<T>(
  operation: () => Promise<T>,
  context: ErrorBoundaryContext,
  options: ErrorHandlerOptions = {}
): Promise<{ success: true; result: T } | { success: false; error: LiBrainianError }> {
  try {
    const result = await operation();
    return { success: true, result };
  } catch (error) {
    const normalized = normalizeError(error, options);

    // Add context
    normalized.details = {
      ...normalized.details,
      operation: context.operation,
      workspace: context.workspace,
    };

    // Call error callback
    options.onError?.(normalized, error);

    return { success: false, error: normalized };
  }
}

/**
 * Error boundary for sync operations.
 */
export function withErrorBoundarySync<T>(
  operation: () => T,
  context: ErrorBoundaryContext,
  options: ErrorHandlerOptions = {}
): { success: true; result: T } | { success: false; error: LiBrainianError } {
  try {
    const result = operation();
    return { success: true, result };
  } catch (error) {
    const normalized = normalizeError(error, options);

    normalized.details = {
      ...normalized.details,
      operation: context.operation,
      workspace: context.workspace,
    };

    options.onError?.(normalized, error);

    return { success: false, error: normalized };
  }
}

// ============================================================================
// ERROR RESPONSE HELPERS
// ============================================================================

/**
 * Format error for API response.
 */
export function formatErrorResponse(error: LiBrainianError): {
  error: LiBrainianError;
  statusCode: number;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};

  if (error.retryable && error.retryDelayMs) {
    headers['Retry-After'] = String(Math.ceil(error.retryDelayMs / 1000));
  }

  if (error.traceId) {
    headers['X-Trace-Id'] = error.traceId;
  }

  return {
    error,
    statusCode: error.statusCode,
    headers,
  };
}

/**
 * Create error from code.
 */
export function createError(
  code: keyof typeof ERROR_CODES,
  message?: string,
  details?: Record<string, unknown>
): LiBrainianErrorBase {
  const categoryMap: Record<string, ErrorCategory> = {
    INVALID_INPUT: 'validation',
    MISSING_REQUIRED_FIELD: 'validation',
    INVALID_FORMAT: 'validation',
    VALUE_OUT_OF_RANGE: 'validation',
    PATH_TRAVERSAL_ATTEMPT: 'validation',
    AUTHENTICATION_REQUIRED: 'authentication',
    INVALID_TOKEN: 'authentication',
    TOKEN_EXPIRED: 'authentication',
    SESSION_INVALID: 'authentication',
    PERMISSION_DENIED: 'authorization',
    SCOPE_INSUFFICIENT: 'authorization',
    CONSENT_REQUIRED: 'authorization',
    WORKSPACE_ACCESS_DENIED: 'authorization',
    RESOURCE_NOT_FOUND: 'resource_not_found',
    WORKSPACE_NOT_FOUND: 'resource_not_found',
    FILE_NOT_FOUND: 'resource_not_found',
    FUNCTION_NOT_FOUND: 'resource_not_found',
    RESOURCE_CONFLICT: 'conflict',
    CONCURRENT_MODIFICATION: 'conflict',
    ALREADY_EXISTS: 'conflict',
    RATE_LIMIT_EXCEEDED: 'rate_limit',
    QUOTA_EXCEEDED: 'rate_limit',
    CIRCUIT_BREAKER_OPEN: 'rate_limit',
    INTERNAL_ERROR: 'internal',
    DATABASE_ERROR: 'internal',
    INDEX_CORRUPTION: 'internal',
    EMBEDDING_SERVICE_ERROR: 'external_service',
    EXTERNAL_SERVICE_UNAVAILABLE: 'external_service',
    SERVICE_TIMEOUT: 'timeout',
    CONFIGURATION_ERROR: 'configuration',
    MISSING_CONFIGURATION: 'configuration',
  };

  const category = categoryMap[code] || 'internal';
  const defaultMessages: Record<string, string> = {
    INVALID_INPUT: 'Invalid input provided',
    MISSING_REQUIRED_FIELD: 'Required field is missing',
    AUTHENTICATION_REQUIRED: 'Authentication is required',
    PERMISSION_DENIED: 'Permission denied',
    RESOURCE_NOT_FOUND: 'Resource not found',
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
    INTERNAL_ERROR: 'An internal error occurred',
  };

  return new LiBrainianErrorBase(
    message || defaultMessages[code] || 'An error occurred',
    ERROR_CODES[code],
    category,
    { details }
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  redactSensitiveInfo,
  classifyError,
  DEFAULT_SENSITIVE_PATTERNS,
};
