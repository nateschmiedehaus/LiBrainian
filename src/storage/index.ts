/**
 * @fileoverview Storage module exports
 */

export type {
  LibrarianStorage,
  StorageCapabilities,
  StorageSlices,
  StorageLifecycle,
  MetadataStorage,
  KnowledgeStorage,
  ChecksumStorage,
  EmbeddingStorage,
  QueryCacheStorage,
  GraphCacheStorage,
  EvolutionStorage,
  EvidenceStorage,
  ConfidenceStorage,
  GraphStorage,
  IngestionStorage,
  TestMappingStorage,
  CommitStorage,
  OwnershipStorage,
  UniversalKnowledgeStorage,
  AssessmentStorage,
  GitAnalysisStorage,
  CloneStorage,
  DebtStorage,
  FaultLocalizationStorage,
  MaintenanceStorage,
  StorageBackend,
  StorageFactory,
  ConcurrencyContract,
  TransactionConflictStrategy,
  IndexChangeEvent,
  IndexChangeEventType,
  IndexChangeQueryOptions,
  EvidenceVerificationOptions,
  EvidenceVerificationSummary,
  GraphEdge,
  GraphEdgeQueryOptions,
  QueryOptions,
  ContextPackQueryOptions,
  SimilaritySearchOptions,
  SimilarityResult,
  TransactionContext,
  IngestionQueryOptions,
  StorageStats,
  EmbeddableEntityType,
  // Argument Edge Types (Toulmin-IBIS Research)
  ArgumentEdgeType,
  ArgumentEntityType,
  ArgumentEdge,
  ArgumentEdgeMetadata,
  ArgumentEdgeQueryOptions,
} from './types.js';

// Argument Edge Helper Functions and Constants
export {
  ARGUMENT_EDGE_TYPES,
  ARGUMENT_ENTITY_TYPES,
  isArgumentEdgeType,
  isArgumentEntityType,
  isArgumentEdge,
  getArgumentEdges,
  groupArgumentEdgesByType,
  createArgumentEdge,
  isConflictEdge,
  isSupportEdge,
  isDecisionChainEdge,
} from './types.js';

export {
  SqliteLibrarianStorage,
  createSqliteStorage,
  createStorageFromBackend,
} from './sqlite_storage.js';
export {
  attemptStorageRecovery,
  isRecoverableStorageError,
} from './storage_recovery.js';

export { createStorageSlices } from './slices.js';
export {
  withinTransaction,
  TransactionConflictError,
  DEFAULT_CONCURRENCY_CONTRACT,
  isTransactionConflictError,
} from './transactions.js';

export type {
  FileStaleStatus,
  StalenessStats,
  StalenessCheckOptions,
} from './staleness.js';

export {
  StalenessTracker,
  createStalenessTracker,
} from './staleness.js';

// Content-Hash Based Caching
export type {
  ContentCacheEntry,
  CacheStats,
  ContentCacheOptions,
  ContentCache,
} from './content_cache.js';

export {
  computeContentHash,
  SqliteContentCache,
  InMemoryContentCache,
  createContentCache,
  createInMemoryContentCache,
} from './content_cache.js';

// Vector Index with HNSW Support
export type {
  VectorIndexItem,
  VectorIndexConfig,
  VectorIndexEntityType,
  HNSWConfig,
} from './vector_index.js';

export {
  VectorIndex,
  HNSWIndex,
  DEFAULT_HNSW_CONFIG,
  HNSW_AUTO_THRESHOLD,
} from './vector_index.js';
