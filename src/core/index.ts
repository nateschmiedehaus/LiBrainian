/**
 * @fileoverview Core librarian infrastructure
 *
 * Exports Result types, errors, contracts, events, and provenance
 * for use throughout the librarian.
 *
 * ARCHITECTURAL ALIGNMENT:
 * - Result type: Explicit error handling (MF5 No Silent Fallbacks)
 * - Events: Record-and-Replay support (Two Dominating Principles)
 * - Provenance: Determinism tracking (Determinism Requirements)
 * - Contracts: Type safety (MF7 Type Safety Absolute)
 */

// Result types and helpers
export {
  type Result,
  Ok,
  Err,
  safeAsync,
  safeSync,
  mapResult,
  flatMapResult,
  mapError,
  unwrap,
  unwrapOr,
  isOk,
  isErr,
  combineResults,
  combineResultsAll,
  safeUnlink,
  safeReadFile,
  safeWriteFile,
  safeMkdir,
  safeStat,
  safeReaddir,
  safeJsonParse,
  safeJsonStringify,
  withTimeout,
  withRetry,
} from './result.js';

// Error types
export {
  type ErrorJSON,
  LibrarianError,
  StorageError,
  type StorageOperation,
  ProviderError,
  type ProviderType,
  type ProviderErrorReason,
  ExtractionError,
  type ExtractionPhase,
  ValidationError,
  QueryError,
  type QueryPhase,
  EmbeddingError,
  DiscoveryError,
  TransactionError,
  SchemaError,
  ConfigurationError,
  ExecutionError,
  type ExecutionFailureReason,
  ParseError,
  isLibrarianError,
  isRetryableError,
  isStorageError,
  isProviderError,
  isValidationError,
  Errors,
} from './errors.js';

// Contracts and branded types
export {
  type EntityId,
  type EmbeddingId,
  type FilePath,
  type Timestamp,
  type ContentHash,
  type EntityType,
  createEntityId,
  parseEntityId,
  createFilePath,
  unsafeFilePath,
  createTimestamp,
  now,
  createEmbeddingId,
  createContentHash,
  createContentHashSync,
  type ValidatedEmbedding,
  createValidatedEmbedding,
  type SchemaType,
  type Versioned,
  wrapVersioned,
  unwrapVersioned,
  getSchemaVersion,
  isEntityId,
  isFilePath,
  isTimestamp,
  type DeepPartial,
  type RequireFields,
  type OptionalFields,
  type ResultValue,
  type ResultError,
} from './contracts.js';

// Event bus for Record-and-Replay
export {
  type Event,
  type EventMeta,
  type FileIndexedEvent,
  type QueryExecutedEvent,
  type ExtractionCompletedEvent,
  type BootstrapStartedEvent,
  type BootstrapCompletedEvent,
  type KnowledgeUpdatedEvent,
  type LibrarianEvent,
  type EventHandler,
  type EventSubscription,
  type EventBus,
  type EventBusMode,
  type EventFilter,
  type EventLog,
  InMemoryEventBus,
  createEventBus,
  createEvent,
} from './events.js';

// Determinism provenance for reproducible indexing
export {
  type OperationType,
  type DeterminismProvenance,
  type ProvenanceConfig,
  type ProvenanceOutputs,
  type LLMCall,
  ProvenanceBuilder,
  type VerificationResult,
  verifyProvenance,
  isDeterminismProvenance,
  createProvenanceBuilder,
} from './provenance.js';

// File:line range resolution for function-level mapping
export {
  type FunctionId,
  type FileLineRange,
  type RangeSource,
  type ResolvedRange,
  type FunctionRangeMapper,
  type FunctionRangeMapperDeps,
  createFunctionRangeMapper,
} from './function_range_mapper.js';
