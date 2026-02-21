/**
 * @fileoverview LiBrainian error hierarchy
 *
 * Replaces string errors like 'unverified_by_trace(provider_unavailable): ...'
 * with typed, structured errors.
 */

// ============================================================================
// ERROR JSON TYPE
// ============================================================================

export interface ErrorJSON {
  code: string;
  message: string;
  retryable: boolean;
  timestamp: number;
  stack?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// BASE ERROR
// ============================================================================

export abstract class LiBrainianError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly timestamp = Date.now();

  toJSON(): ErrorJSON {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}

// ============================================================================
// STORAGE ERRORS
// ============================================================================

export type StorageOperation = 'read' | 'write' | 'delete' | 'lock' | 'migrate' | 'query';

export class StorageError extends LiBrainianError {
  readonly code = 'STORAGE_ERROR';

  constructor(
    readonly operation: StorageOperation,
    readonly retryable: boolean,
    message: string,
    readonly cause?: Error,
  ) {
    super(`Storage ${operation} failed: ${message}`);
    this.name = 'StorageError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        operation: this.operation,
        cause: this.cause?.message,
      },
    };
  }
}

// ============================================================================
// PROVIDER ERRORS
// ============================================================================

export type ProviderType = 'claude' | 'codex' | 'local';
export type ProviderErrorReason =
  | 'timeout'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'auth_failed'
  | 'network_error'
  | 'invalid_response'
  | 'unavailable'
  | 'circuit_open';

export class ProviderError extends LiBrainianError {
  readonly code = 'PROVIDER_ERROR';

  constructor(
    readonly provider: ProviderType,
    readonly reason: ProviderErrorReason,
    readonly retryable: boolean,
    message: string,
  ) {
    super(`Provider ${provider} ${reason}: ${message}`);
    this.name = 'ProviderError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        provider: this.provider,
        reason: this.reason,
      },
    };
  }
}

// ============================================================================
// EXTRACTION ERRORS
// ============================================================================

export type ExtractionPhase = 'parse' | 'transform' | 'validate' | 'store' | 'embed';

export class ExtractionError extends LiBrainianError {
  readonly code = 'EXTRACTION_ERROR';

  constructor(
    readonly extractor: string,
    readonly phase: ExtractionPhase,
    readonly retryable: boolean,
    message: string,
    readonly filePath?: string,
  ) {
    super(`Extraction ${extractor} failed at ${phase}: ${message}`);
    this.name = 'ExtractionError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        extractor: this.extractor,
        phase: this.phase,
        filePath: this.filePath,
      },
    };
  }
}

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

export class ValidationError extends LiBrainianError {
  readonly code = 'VALIDATION_ERROR';
  readonly retryable = false;

  constructor(
    readonly field: string,
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Validation failed for ${field}: expected ${expected}, got ${received}`);
    this.name = 'ValidationError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        field: this.field,
        expected: this.expected,
        received: this.received,
      },
    };
  }
}

// ============================================================================
// QUERY ERRORS
// ============================================================================

export type QueryPhase = 'parse' | 'retrieve' | 'rank' | 'synthesize' | 'format';

export class QueryError extends LiBrainianError {
  readonly code = 'QUERY_ERROR';

  constructor(
    readonly phase: QueryPhase,
    readonly retryable: boolean,
    message: string,
    readonly queryId?: string,
  ) {
    super(`Query failed at ${phase}: ${message}`);
    this.name = 'QueryError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        phase: this.phase,
        queryId: this.queryId,
      },
    };
  }
}

// ============================================================================
// EMBEDDING ERRORS
// ============================================================================

export class EmbeddingError extends LiBrainianError {
  readonly code = 'EMBEDDING_ERROR';

  constructor(
    readonly model: string,
    readonly retryable: boolean,
    message: string,
    readonly inputLength?: number,
  ) {
    super(`Embedding with ${model} failed: ${message}`);
    this.name = 'EmbeddingError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        model: this.model,
        inputLength: this.inputLength,
      },
    };
  }
}

// ============================================================================
// DISCOVERY ERRORS
// ============================================================================

export class DiscoveryError extends LiBrainianError {
  readonly code = 'DISCOVERY_ERROR';

  constructor(
    readonly discoverer: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(`Discovery ${discoverer} failed: ${message}`);
    this.name = 'DiscoveryError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        discoverer: this.discoverer,
      },
    };
  }
}

// ============================================================================
// TRANSACTION ERRORS
// ============================================================================

export class TransactionError extends LiBrainianError {
  readonly code = 'TRANSACTION_ERROR';
  readonly retryable = false;

  constructor(
    readonly transactionName: string,
    readonly cause: Error,
  ) {
    super(`Transaction ${transactionName} failed: ${cause.message}`);
    this.name = 'TransactionError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        transactionName: this.transactionName,
        cause: this.cause.message,
      },
    };
  }
}

// ============================================================================
// SCHEMA ERRORS
// ============================================================================

export class SchemaError extends LiBrainianError {
  readonly code = 'SCHEMA_ERROR';
  readonly retryable = false;

  constructor(
    readonly schemaType: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`Schema version mismatch for ${schemaType}: expected v${expectedVersion}, got v${actualVersion}`);
    this.name = 'SchemaError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        schemaType: this.schemaType,
        expectedVersion: this.expectedVersion,
        actualVersion: this.actualVersion,
      },
    };
  }
}

// ============================================================================
// CONFIGURATION ERRORS
// ============================================================================

export class ConfigurationError extends LiBrainianError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly retryable = false;

  constructor(
    readonly configKey: string,
    message: string,
  ) {
    super(`Configuration error for ${configKey}: ${message}`);
    this.name = 'ConfigurationError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        configKey: this.configKey,
      },
    };
  }
}

// ============================================================================
// EXECUTION ERRORS
// ============================================================================

export type ExecutionFailureReason =
  | 'timeout'
  | 'max_retries'
  | 'circuit_open'
  | 'cancelled'
  | 'resource_exhausted';

export class ExecutionError extends LiBrainianError {
  readonly code = 'EXECUTION_ERROR';

  constructor(
    readonly reason: ExecutionFailureReason,
    message: string,
    readonly retryable: boolean = false,
  ) {
    super(`Execution failed (${reason}): ${message}`);
    this.name = 'ExecutionError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        reason: this.reason,
      },
    };
  }
}

// ============================================================================
// PARSE ERRORS
// ============================================================================

export class ParseError extends LiBrainianError {
  readonly code = 'PARSE_ERROR';
  readonly retryable = false;

  constructor(
    readonly format: string,
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(`Failed to parse ${format}: ${message}`);
    this.name = 'ParseError';
  }

  toJSON(): ErrorJSON {
    return {
      ...super.toJSON(),
      details: {
        format: this.format,
        line: this.line,
        column: this.column,
      },
    };
  }
}

// ============================================================================
// ERROR TYPE GUARDS
// ============================================================================

export function isLiBrainianError(error: unknown): error is LiBrainianError {
  return error instanceof LiBrainianError;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof LiBrainianError) {
    return error.retryable;
  }

  // Network errors are generally retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('socket hang up') ||
      message.includes('network')
    );
  }

  return false;
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

// ============================================================================
// ERROR FACTORY
// ============================================================================

export const Errors = {
  storage: (operation: StorageOperation, message: string, retryable = false, cause?: Error) =>
    new StorageError(operation, retryable, message, cause),

  provider: (provider: ProviderType, reason: ProviderErrorReason, message: string, retryable = true) =>
    new ProviderError(provider, reason, retryable, message),

  extraction: (extractor: string, phase: ExtractionPhase, message: string, retryable = false, filePath?: string) =>
    new ExtractionError(extractor, phase, retryable, message, filePath),

  validation: (field: string, expected: string, received: string) =>
    new ValidationError(field, expected, received),

  query: (phase: QueryPhase, message: string, retryable = false, queryId?: string) =>
    new QueryError(phase, retryable, message, queryId),

  embedding: (model: string, message: string, retryable = true, inputLength?: number) =>
    new EmbeddingError(model, retryable, message, inputLength),

  discovery: (discoverer: string, message: string, retryable = false) =>
    new DiscoveryError(discoverer, retryable, message),

  transaction: (name: string, cause: Error) =>
    new TransactionError(name, cause),

  schema: (type: string, expected: number, actual: number) =>
    new SchemaError(type, expected, actual),

  config: (key: string, message: string) =>
    new ConfigurationError(key, message),

  execution: (reason: ExecutionFailureReason, message: string, retryable = false) =>
    new ExecutionError(reason, message, retryable),

  parse: (format: string, message: string, line?: number, column?: number) =>
    new ParseError(format, message, line, column),
};
