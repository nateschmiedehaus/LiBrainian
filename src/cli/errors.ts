/**
 * @fileoverview Structured error contracts for agent recovery
 *
 * Provides machine-readable error envelopes that agents can parse programmatically
 * without brittle string parsing. Includes error codes, retryability hints, and
 * recovery suggestions.
 */

import { sanitizeTraceMarkerMessage } from './user_messages.js';

// ============================================================================
// Error Envelope Types
// ============================================================================

/**
 * Structured error envelope for programmatic error handling by agents.
 * All CLI errors should be convertible to this format.
 */
export interface ErrorEnvelope {
  /** Machine-readable error code (e.g., 'ENOINDEX', 'EQUERY_TIMEOUT') */
  code: string;
  /** Human-readable description */
  message: string;
  /** Can the agent retry this operation? */
  retryable: boolean;
  /** Suggested recovery actions for agents */
  recoveryHints: string[];
  /** Additional context for debugging */
  context?: ErrorContext;
}

/**
 * Additional context attached to error envelopes
 */
export interface ErrorContext {
  /** Entity ID that caused the error */
  entityId?: string;
  /** File path involved in the error */
  filePath?: string;
  /** Operation that failed */
  operation?: string;
  /** Timestamp of the error */
  timestamp?: string;
  /** Suggested wait time before retry (milliseconds) */
  retryAfterMs?: number;
  /** Additional structured data */
  [key: string]: unknown;
}

// ============================================================================
// Standard Error Codes
// ============================================================================

/**
 * Standard error codes with descriptions.
 * Agents can match on code strings for programmatic handling.
 */
export const ErrorCodes = {
  // Storage errors
  ENOINDEX: 'No index found. Run `librarian bootstrap` first.',
  ESTALE_INDEX: 'Index is stale. Consider re-bootstrapping.',
  ESTORAGE_CORRUPT: 'Storage is corrupted. Run `librarian bootstrap --force`.',
  ESTORAGE_LOCKED: 'Storage is locked by another process.',

  // Query errors
  EQUERY_TIMEOUT: 'Query timed out.',
  EQUERY_INVALID: 'Invalid query parameters.',
  EQUERY_EMPTY: 'Query returned no results.',
  EQUERY_FAILED: 'Query execution failed.',

  // Provider errors
  EPROVIDER_UNAVAILABLE: 'LLM provider unavailable.',
  EPROVIDER_QUOTA: 'LLM provider quota exceeded.',
  EPROVIDER_AUTH: 'LLM provider authentication failed.',
  EPROVIDER_RATE_LIMIT: 'LLM provider rate limited.',
  EPROVIDER_MODEL_UNAVAILABLE: 'Requested model is unavailable.',

  // Bootstrap errors
  EBOOTSTRAP_REQUIRED: 'Bootstrap required before this operation.',
  EBOOTSTRAP_FAILED: 'Bootstrap process failed.',
  EPREFLIGHT_FAILED: 'Pre-flight checks failed.',

  // Validation errors
  EINVALID_ARGUMENT: 'Invalid argument provided.',
  EENTITY_NOT_FOUND: 'Requested entity not found.',
  EFILE_NOT_FOUND: 'File not found.',
  EFILE_OUTSIDE_WORKSPACE: 'File is outside the workspace.',

  // General errors
  EUNKNOWN: 'Unknown error occurred.',
  EINTERNAL: 'Internal error.',
  ETIMEOUT: 'Operation timed out.',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

// ============================================================================
// Error Metadata
// ============================================================================

/**
 * Metadata for each error code including retryability and recovery hints
 */
export const ErrorMetadata: Record<ErrorCode, { retryable: boolean; recoveryHints: string[] }> = {
  // Storage errors
  ENOINDEX: {
    retryable: false,
    recoveryHints: [
      'Run `librarian bootstrap` to create the index',
      'Ensure you are in the correct workspace directory',
    ],
  },
  ESTALE_INDEX: {
    retryable: false,
    recoveryHints: [
      'Run `librarian bootstrap` to refresh the index',
      'Run `librarian watch` to keep index up-to-date automatically',
    ],
  },
  ESTORAGE_CORRUPT: {
    retryable: false,
    recoveryHints: [
      'Run `librarian bootstrap --force` to rebuild the index',
      'Check disk space and permissions',
    ],
  },
  ESTORAGE_LOCKED: {
    retryable: true,
    recoveryHints: [
      'Wait for the other process to complete',
      'Check for zombie librarian processes',
      'Remove lock file if process crashed: .librarian/librarian.lock',
    ],
  },

  // Query errors
  EQUERY_TIMEOUT: {
    retryable: true,
    recoveryHints: [
      'Retry with a lower depth level (e.g., --depth L0)',
      'Simplify the query intent',
      'Check provider latency with `librarian check-providers`',
    ],
  },
  EQUERY_INVALID: {
    retryable: false,
    recoveryHints: [
      'Check query syntax with `librarian help query`',
      'Ensure depth level is one of: L0, L1, L2, L3',
    ],
  },
  EQUERY_EMPTY: {
    retryable: false,
    recoveryHints: [
      'Try a broader query',
      'Check if the codebase has been indexed with `librarian status`',
      'Increase depth level for more results',
    ],
  },
  EQUERY_FAILED: {
    retryable: true,
    recoveryHints: [
      'Check `librarian status` for index health',
      'Verify provider availability with `librarian check-providers`',
    ],
  },

  // Provider errors
  EPROVIDER_UNAVAILABLE: {
    retryable: true,
    recoveryHints: [
      'Run `librarian check-providers` to diagnose',
      'Check network connectivity',
      'Verify API credentials are set correctly',
    ],
  },
  EPROVIDER_QUOTA: {
    retryable: true,
    recoveryHints: [
      'Wait for quota to reset',
      'Use a different provider with --llm-provider',
      'Reduce query depth to minimize token usage',
    ],
  },
  EPROVIDER_AUTH: {
    retryable: false,
    recoveryHints: [
      'Check API key environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY)',
      'Verify credentials are valid and not expired',
      'Run `librarian check-providers` for detailed diagnostics',
    ],
  },
  EPROVIDER_RATE_LIMIT: {
    retryable: true,
    recoveryHints: [
      'Wait before retrying (see retryAfterMs in context)',
      'Reduce request frequency',
      'Use a different provider temporarily',
    ],
  },
  EPROVIDER_MODEL_UNAVAILABLE: {
    retryable: false,
    recoveryHints: [
      'Check model availability with `librarian check-providers`',
      'Use a different model with --llm-model',
      'Verify model name spelling',
    ],
  },

  // Bootstrap errors
  EBOOTSTRAP_REQUIRED: {
    retryable: false,
    recoveryHints: [
      'Run `librarian bootstrap` first',
      'Use `librarian bootstrap --force` if previous bootstrap failed',
    ],
  },
  EBOOTSTRAP_FAILED: {
    retryable: true,
    recoveryHints: [
      'Check `librarian status` for details',
      'Run `librarian bootstrap --force` to retry',
      'Verify provider availability with `librarian check-providers`',
    ],
  },
  EPREFLIGHT_FAILED: {
    retryable: false,
    recoveryHints: [
      'Review the preflight check failures listed above',
      'Fix configuration issues before retrying bootstrap',
    ],
  },

  // Validation errors
  EINVALID_ARGUMENT: {
    retryable: false,
    recoveryHints: [
      'Run `librarian help <command>` for usage information',
      'Check argument types and formats',
    ],
  },
  EENTITY_NOT_FOUND: {
    retryable: false,
    recoveryHints: [
      'Run `librarian status` to see available entities',
      'Check entity name spelling',
      'Ensure the entity has been indexed',
    ],
  },
  EFILE_NOT_FOUND: {
    retryable: false,
    recoveryHints: [
      'Verify the file path exists',
      'Check for typos in the file path',
      'Use absolute paths to avoid ambiguity',
    ],
  },
  EFILE_OUTSIDE_WORKSPACE: {
    retryable: false,
    recoveryHints: [
      'Ensure the file is within the workspace directory',
      'Use --workspace to specify a different workspace',
    ],
  },

  // General errors
  EUNKNOWN: {
    retryable: true,
    recoveryHints: [
      'Check `librarian status` for system health',
      'Review error details for more information',
      'Report persistent issues to maintainers',
    ],
  },
  EINTERNAL: {
    retryable: true,
    recoveryHints: [
      'This is likely a bug - please report it',
      'Try `librarian bootstrap --force` to reset state',
    ],
  },
  ETIMEOUT: {
    retryable: true,
    recoveryHints: [
      'Retry the operation',
      'Check network connectivity',
      'Check provider status with `librarian check-providers`',
    ],
  },
};

// ============================================================================
// Exit Codes
// ============================================================================

/**
 * Map error codes to exit codes for CLI
 */
export const ExitCodes: Partial<Record<ErrorCode, number>> = {
  // Storage errors: 10-19
  ENOINDEX: 10,
  ESTALE_INDEX: 11,
  ESTORAGE_CORRUPT: 12,
  ESTORAGE_LOCKED: 13,

  // Query errors: 20-29
  EQUERY_TIMEOUT: 20,
  EQUERY_INVALID: 21,
  EQUERY_EMPTY: 22,
  EQUERY_FAILED: 23,

  // Provider errors: 30-39
  EPROVIDER_UNAVAILABLE: 30,
  EPROVIDER_QUOTA: 31,
  EPROVIDER_AUTH: 32,
  EPROVIDER_RATE_LIMIT: 33,
  EPROVIDER_MODEL_UNAVAILABLE: 34,

  // Bootstrap errors: 40-49
  EBOOTSTRAP_REQUIRED: 40,
  EBOOTSTRAP_FAILED: 41,
  EPREFLIGHT_FAILED: 42,

  // Validation errors: 50-59
  EINVALID_ARGUMENT: 50,
  EENTITY_NOT_FOUND: 51,
  EFILE_NOT_FOUND: 52,
  EFILE_OUTSIDE_WORKSPACE: 53,

  // General errors: 1 (default)
  EUNKNOWN: 1,
  EINTERNAL: 2,
  ETIMEOUT: 3,
};

// ============================================================================
// CliError Class
// ============================================================================

/**
 * Legacy CLI error codes for backward compatibility
 */
export type CliErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'NOT_BOOTSTRAPPED'
  | 'BOOTSTRAP_FAILED'
  | 'INSUFFICIENT_EMBEDDING_COVERAGE'
  | 'QUERY_FAILED'
  | 'ENTITY_NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'STORAGE_ERROR'
  | 'INVALID_ARGUMENT'
  | 'TIMEOUT'
  | 'PREFLIGHT_FAILED'
  | 'INDEX_FAILED';

/**
 * Map legacy error codes to new error codes
 */
const LegacyCodeMap: Record<CliErrorCode, ErrorCode> = {
  PROVIDER_UNAVAILABLE: 'EPROVIDER_UNAVAILABLE',
  NOT_BOOTSTRAPPED: 'ENOINDEX',
  BOOTSTRAP_FAILED: 'EBOOTSTRAP_FAILED',
  INSUFFICIENT_EMBEDDING_COVERAGE: 'EQUERY_INVALID',
  QUERY_FAILED: 'EQUERY_FAILED',
  ENTITY_NOT_FOUND: 'EENTITY_NOT_FOUND',
  VALIDATION_FAILED: 'EINVALID_ARGUMENT',
  STORAGE_ERROR: 'ESTORAGE_CORRUPT',
  INVALID_ARGUMENT: 'EINVALID_ARGUMENT',
  TIMEOUT: 'ETIMEOUT',
  PREFLIGHT_FAILED: 'EPREFLIGHT_FAILED',
  INDEX_FAILED: 'EBOOTSTRAP_FAILED',
};

/**
 * Legacy error suggestions for backward compatibility
 */
export const ERROR_SUGGESTIONS: Record<CliErrorCode, string> = {
  PROVIDER_UNAVAILABLE: 'Run `librarian check-providers` to diagnose provider issues.',
  NOT_BOOTSTRAPPED: 'Run `librarian bootstrap` first to initialize the knowledge index.',
  BOOTSTRAP_FAILED: 'Check provider availability with `librarian check-providers` and ensure files are valid.',
  INSUFFICIENT_EMBEDDING_COVERAGE: 'Run `librarian embed --fix` and retry once embedding coverage is at least 80%.',
  QUERY_FAILED: 'Try a simpler query or check `librarian status` for index health.',
  ENTITY_NOT_FOUND: 'Run `librarian status` to see available modules and functions.',
  VALIDATION_FAILED: 'Check the file path and ensure it exists in the workspace.',
  STORAGE_ERROR: 'Run `librarian bootstrap --force` to reinitialize the storage.',
  INVALID_ARGUMENT: 'Run `librarian help <command>` for usage information.',
  TIMEOUT: 'The operation timed out. Try again or increase the timeout with --timeout.',
  PREFLIGHT_FAILED: 'Fix the issues listed above before running bootstrap.',
  INDEX_FAILED: 'Check provider availability with `librarian check-providers` and ensure files are valid.',
};

/**
 * CLI Error class with structured error support
 */
export class CliError extends Error {
  /** New-style error code */
  public readonly errorCode: ErrorCode;

  constructor(
    message: string,
    public readonly code: CliErrorCode,
    public readonly suggestion?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CliError';
    this.errorCode = LegacyCodeMap[code];
  }

  /**
   * Convert to structured ErrorEnvelope
   */
  toEnvelope(): ErrorEnvelope {
    const metadata = ErrorMetadata[this.errorCode];
    return {
      code: this.errorCode,
      message: this.message,
      retryable: metadata.retryable,
      recoveryHints: metadata.recoveryHints,
      context: {
        timestamp: new Date().toISOString(),
        operation: this.details?.operation as string | undefined,
        ...this.details,
      },
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a CliError with suggestion from ERROR_SUGGESTIONS
 */
export function createError(
  code: CliErrorCode,
  message: string,
  details?: Record<string, unknown>,
): CliError {
  return new CliError(message, code, ERROR_SUGGESTIONS[code], details);
}

/**
 * Create a structured ErrorEnvelope directly
 */
export function createErrorEnvelope(
  code: ErrorCode,
  message: string,
  options?: Partial<Omit<ErrorEnvelope, 'code' | 'message'>>,
): ErrorEnvelope {
  const metadata = ErrorMetadata[code] ?? ErrorMetadata.EUNKNOWN;
  return {
    code,
    message,
    retryable: options?.retryable ?? metadata.retryable,
    recoveryHints: options?.recoveryHints ?? metadata.recoveryHints,
    context: {
      timestamp: new Date().toISOString(),
      ...options?.context,
    },
  };
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: ErrorEnvelope): boolean {
  return error.retryable;
}

/**
 * Get exit code for an error
 */
export function getExitCode(error: ErrorEnvelope): number {
  return ExitCodes[error.code as ErrorCode] ?? 1;
}

/**
 * Classify an unknown error into a structured ErrorEnvelope
 */
export function classifyError(error: unknown): ErrorEnvelope {
  // Already an ErrorEnvelope
  if (isErrorEnvelope(error)) {
    return error;
  }

  // CliError
  if (error instanceof CliError) {
    return error.toEnvelope();
  }

  // Standard Error
  if (error instanceof Error) {
    const rawMessage = error.message;
    const errorCode = inferErrorCodeFromMessage(rawMessage);
    const message = sanitizeTraceMarkerMessage(rawMessage);
    return createErrorEnvelope(errorCode, message, {
      context: {
        originalError: error.name,
        stack: error.stack,
      },
    });
  }

  // Unknown
  return createErrorEnvelope('EUNKNOWN', String(error));
}

/**
 * Type guard for ErrorEnvelope
 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.code === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.retryable === 'boolean' &&
    Array.isArray(obj.recoveryHints)
  );
}

/**
 * Infer error code from error message patterns
 */
function inferErrorCodeFromMessage(message: string): ErrorCode {
  const lowerMessage = message.toLowerCase();

  // Provider errors
  if (lowerMessage.includes('provider_unavailable') || lowerMessage.includes('provider unavailable')) {
    return 'EPROVIDER_UNAVAILABLE';
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('rate_limit') || lowerMessage.includes('429')) {
    return 'EPROVIDER_RATE_LIMIT';
  }
  if (lowerMessage.includes('quota') || lowerMessage.includes('exceeded')) {
    return 'EPROVIDER_QUOTA';
  }
  if (lowerMessage.includes('unauthorized') || lowerMessage.includes('authentication') || lowerMessage.includes('401')) {
    return 'EPROVIDER_AUTH';
  }
  if (lowerMessage.includes('model') && (lowerMessage.includes('not found') || lowerMessage.includes('unavailable'))) {
    return 'EPROVIDER_MODEL_UNAVAILABLE';
  }

  // Storage errors
  if (lowerMessage.includes('not bootstrapped') || lowerMessage.includes('no existing librarian data')) {
    return 'ENOINDEX';
  }
  if (lowerMessage.includes('stale') || lowerMessage.includes('outdated')) {
    return 'ESTALE_INDEX';
  }
  if (lowerMessage.includes('locked') || lowerMessage.includes('busy')) {
    return 'ESTORAGE_LOCKED';
  }
  if (lowerMessage.includes('corrupt') || lowerMessage.includes('malformed')) {
    return 'ESTORAGE_CORRUPT';
  }

  // Query errors
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return 'EQUERY_TIMEOUT';
  }
  if (lowerMessage.includes('invalid') && lowerMessage.includes('query')) {
    return 'EQUERY_INVALID';
  }

  // File errors
  if (lowerMessage.includes('enoent') || lowerMessage.includes('file not found')) {
    return 'EFILE_NOT_FOUND';
  }
  if (lowerMessage.includes('outside workspace') || lowerMessage.includes('outside the workspace')) {
    return 'EFILE_OUTSIDE_WORKSPACE';
  }

  // Validation errors
  if (lowerMessage.includes('invalid') || lowerMessage.includes('argument')) {
    return 'EINVALID_ARGUMENT';
  }
  if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
    return 'EENTITY_NOT_FOUND';
  }

  // Bootstrap errors
  if (lowerMessage.includes('bootstrap') && lowerMessage.includes('fail')) {
    return 'EBOOTSTRAP_FAILED';
  }
  if (lowerMessage.includes('preflight')) {
    return 'EPREFLIGHT_FAILED';
  }

  return 'EUNKNOWN';
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format error for human-readable output
 */
export function formatError(error: unknown): string {
  if (error instanceof CliError) {
    return `Error [${error.errorCode}]: ${error.message}`;
  }
  if (error instanceof Error) {
    // Check for common error patterns and suggest solutions
    const message = error.message;

    if (message.includes('unverified_by_trace(provider_unavailable)')) {
      return `Error [EPROVIDER_UNAVAILABLE]: Provider unavailable.\n\nSuggestion: ${ERROR_SUGGESTIONS.PROVIDER_UNAVAILABLE}`;
    }

    if (message.includes('not bootstrapped') || message.includes('No existing librarian data')) {
      return `Error [ENOINDEX]: Librarian not initialized.\n\nSuggestion: ${ERROR_SUGGESTIONS.NOT_BOOTSTRAPPED}`;
    }

    if (message.includes('ENOENT')) {
      return `Error [EFILE_NOT_FOUND]: File or directory not found: ${message}`;
    }

    return `Error: ${sanitizeTraceMarkerMessage(message)}`;
  }
  return `Error: ${String(error)}`;
}

/**
 * Format error for human-readable output with recovery hints
 */
export function formatErrorWithHints(envelope: ErrorEnvelope): string {
  const lines: string[] = [
    `Error [${envelope.code}]: ${sanitizeTraceMarkerMessage(envelope.message)}`,
    '',
  ];

  if (envelope.retryable) {
    lines.push('This error is retryable.');
    if (envelope.context?.retryAfterMs) {
      lines.push(`Suggested wait time: ${envelope.context.retryAfterMs}ms`);
    }
    lines.push('');
  }

  if (envelope.recoveryHints.length > 0) {
    lines.push('Recovery suggestions:');
    for (const hint of envelope.recoveryHints) {
      lines.push(`  - ${hint}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format error envelope for JSON output
 */
export function formatErrorJson(envelope: ErrorEnvelope): string {
  return JSON.stringify({ error: envelope }, null, 2);
}

/**
 * Suggest similar successful queries based on recent query history
 */
export function suggestSimilarQueries(failedQuery: string, _recentQueries: string[]): string[] {
  // Simple keyword-based suggestions
  const keywords = failedQuery.toLowerCase().split(/\s+/);
  const suggestions: string[] = [];

  // Common query patterns
  const patterns = [
    { trigger: 'how', template: 'How does <topic> work?' },
    { trigger: 'what', template: 'What is the purpose of <topic>?' },
    { trigger: 'where', template: 'Where is <topic> defined?' },
    { trigger: 'find', template: 'Find all uses of <topic>' },
    { trigger: 'show', template: 'Show the implementation of <topic>' },
  ];

  for (const pattern of patterns) {
    if (keywords.includes(pattern.trigger)) {
      const topic = keywords.filter((k) => k !== pattern.trigger).join(' ');
      if (topic) {
        suggestions.push(pattern.template.replace('<topic>', topic));
      }
    }
  }

  return suggestions.slice(0, 3);
}
