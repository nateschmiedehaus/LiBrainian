/**
 * @fileoverview Storage interface for Librarian
 *
 * This abstraction allows the librarian to use different storage backends:
 * - SQLite (default, embedded)
 * - PostgreSQL (for larger deployments)
 * - In-memory (for testing)
 */

import type {
  LibrarianVersion,
  LibrarianMetadata,
  FunctionKnowledge,
  ModuleKnowledge,
  FileKnowledge,
  DirectoryKnowledge,
  GraphEdge,
  GraphEdgeType,
  GraphEntityType,
  ContextPack,
  IndexingResult,
  BootstrapReport,
  SearchFilter,
} from '../types.js';
import type { IngestionItem } from '../ingest/types.js';
import type { GraphMetricsEntry } from '../graphs/metrics.js';
import type { CochangeEdge } from '../graphs/temporal_graph.js';
import type { EvidenceEntry, EvidenceRef } from '../api/evidence.js';
import type { FlashAssessment } from '../knowledge/extractors/flash_assessments.js';

// Re-export types needed by knowledge modules
export type { FunctionKnowledge, ModuleKnowledge, FileKnowledge, DirectoryKnowledge } from '../types.js';
export type { GraphEdge, GraphEdgeType, GraphEntityType } from '../types.js';

// ============================================================================
// STORAGE INTERFACE
// ============================================================================

export interface StorageCapabilities {
  core: {
    getFunctions: true;
    getFiles: true;
    getContextPacks: true;
  };
  optional: {
    graphMetrics: boolean;
    multiVectors: boolean;
    embeddings: boolean;
    episodes: boolean;
    verificationPlans: boolean;
  };
  versions: {
    schema: number;
    api: number;
  };
}

export interface EvidenceVerificationOptions {
  limit?: number;
  force?: boolean;
}

export interface EvidenceVerificationSummary {
  totalEntries: number;
  scannedEntries: number;
  staleCount: number;
  unverifiedCount: number;
  oldestUnverifiedAt?: string;
  verifiedAt: string;
}

/**
 * Abstract storage interface for librarian data.
 * Implementations must be transactional and handle concurrent access.
 */
export interface LibrarianStorage {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  isInitialized(): boolean;
  getCapabilities(): StorageCapabilities;

  // Metadata
  getMetadata(): Promise<LibrarianMetadata | null>;
  setMetadata(metadata: LibrarianMetadata): Promise<void>;
  getState(key: string): Promise<string | null>;
  setState(key: string, value: string): Promise<void>;

  // Version management
  getVersion(): Promise<LibrarianVersion | null>;
  setVersion(version: LibrarianVersion): Promise<void>;

  // Function knowledge
  getFunctions(options?: QueryOptions): Promise<FunctionKnowledge[]>;
  getFunction(id: string): Promise<FunctionKnowledge | null>;
  getFunctionByPath(filePath: string, name: string): Promise<FunctionKnowledge | null>;
  getFunctionsByPath(filePath: string): Promise<FunctionKnowledge[]>;
  getFunctionsByName(name: string): Promise<FunctionKnowledge[]>;
  upsertFunction(fn: FunctionKnowledge): Promise<void>;
  upsertFunctions(fns: FunctionKnowledge[]): Promise<void>;
  deleteFunction(id: string): Promise<void>;
  deleteFunctionsByPath(filePath: string): Promise<void>;

  // Module knowledge
  getModules(options?: QueryOptions): Promise<ModuleKnowledge[]>;
  getModule(id: string): Promise<ModuleKnowledge | null>;
  getModuleByPath(path: string): Promise<ModuleKnowledge | null>;
  upsertModule(mod: ModuleKnowledge): Promise<void>;
  deleteModule(id: string): Promise<void>;

  // File knowledge (file-level understanding)
  getFiles(options?: FileQueryOptions): Promise<FileKnowledge[]>;
  getFile(id: string): Promise<FileKnowledge | null>;
  getFileByPath(path: string): Promise<FileKnowledge | null>;
  getFilesByDirectory(directoryPath: string): Promise<FileKnowledge[]>;
  upsertFile(file: FileKnowledge): Promise<void>;
  upsertFiles(files: FileKnowledge[]): Promise<void>;
  deleteFile(id: string): Promise<void>;
  deleteFileByPath(path: string): Promise<void>;

  // Directory knowledge (directory-level understanding)
  getDirectories(options?: DirectoryQueryOptions): Promise<DirectoryKnowledge[]>;
  getDirectory(id: string): Promise<DirectoryKnowledge | null>;
  getDirectoryByPath(path: string): Promise<DirectoryKnowledge | null>;
  getSubdirectories(parentPath: string): Promise<DirectoryKnowledge[]>;
  upsertDirectory(dir: DirectoryKnowledge): Promise<void>;
  upsertDirectories(dirs: DirectoryKnowledge[]): Promise<void>;
  deleteDirectory(id: string): Promise<void>;
  deleteDirectoryByPath(path: string): Promise<void>;

  // Context packs
  getContextPacks(options?: ContextPackQueryOptions): Promise<ContextPack[]>;
  getContextPack(packId: string): Promise<ContextPack | null>;
  getContextPackForTarget(targetId: string, packType: string): Promise<ContextPack | null>;
  findByIntentAndScope(intentType: string, scope: string, options?: ContextPackSeedLookupOptions): Promise<ContextPack[]>;
  findByProvenance(provenance: string, options?: ContextPackSeedLookupOptions): Promise<ContextPack[]>;
  upsertContextPack(pack: ContextPack): Promise<void>;
  invalidateContextPacks(triggerPath: string): Promise<number>;
  deleteContextPack(packId: string): Promise<void>;
  recordContextPackAccess(packId: string, outcome?: 'success' | 'failure'): Promise<void>;

  // File checksums (incremental indexing)
  getFileChecksum(filePath: string): Promise<string | null>;
  setFileChecksum(filePath: string, checksum: string, updatedAt?: string): Promise<void>;
  deleteFileChecksum(filePath: string): Promise<void>;

  // Embeddings (separate for performance)
  getEmbedding(entityId: string): Promise<Float32Array | null>;
  setEmbedding(entityId: string, embedding: Float32Array, metadata: EmbeddingMetadata): Promise<void>;
  findSimilarByEmbedding(
    embedding: Float32Array,
    options: SimilaritySearchOptions
  ): Promise<SimilaritySearchResponse>;
  getMultiVector(entityId: string, entityType?: 'function' | 'module'): Promise<MultiVectorRecord | null>;
  getMultiVectors(options?: MultiVectorQueryOptions): Promise<MultiVectorRecord[]>;
  upsertMultiVector(record: MultiVectorRecord): Promise<void>;

  /**
   * Clear embeddings that don't match the expected dimension.
   * Used for auto-recovery when embedding model changes.
   * @param expectedDimension - The expected embedding dimension (e.g., 384 for sentence-transformers)
   * @returns Number of embeddings deleted
   */
  clearMismatchedEmbeddings(expectedDimension: number): Promise<number>;

  /**
   * Get embedding statistics for diagnostics.
   * @returns Counts of embeddings by dimension
   */
  getEmbeddingStats(): Promise<{ dimension: number; count: number }[]>;

  // Dependency invalidation (for cascading file change propagation)
  /**
   * Invalidate cached query results for a file.
   * Called when a file's dependencies change.
   */
  invalidateCache(filePath: string): Promise<number>;
  /**
   * Invalidate embeddings for entities in a file.
   * Called when a file's content or dependencies change.
   */
  invalidateEmbeddings(filePath: string): Promise<number>;
  /**
   * Get files that import the given file (reverse dependencies).
   * Used for cascading invalidation.
   */
  getReverseDependencies(filePath: string): Promise<string[]>;

  // Query cache (persistent) - REQUIRED for all storage backends
  getQueryCacheEntry(queryHash: string): Promise<QueryCacheEntry | null>;
  upsertQueryCacheEntry(entry: QueryCacheEntry): Promise<void>;
  recordQueryCacheAccess(queryHash: string): Promise<void>;
  pruneQueryCache(options: QueryCachePruneOptions): Promise<number>;
  appendRetrievalConfidenceLog(entry: RetrievalConfidenceLogEntry): Promise<void>;
  getRetrievalConfidenceLogs(options?: RetrievalConfidenceLogQueryOptions): Promise<RetrievalConfidenceLogEntry[]>;
  getRetrievalStrategyRewards?(intentType?: string): Promise<RetrievalStrategyReward[]>;
  recordRetrievalStrategySelection?(selection: RetrievalStrategySelection): Promise<void>;
  getRetrievalStrategySelection?(queryId: string): Promise<RetrievalStrategySelection | null>;
  applyRetrievalStrategyFeedback?(
    queryId: string,
    wasHelpful: boolean,
    outcome?: 'success' | 'failure' | 'partial'
  ): Promise<RetrievalStrategyReward | null>;
  getRetrievalStrategySelections?(options?: RetrievalStrategySelectionQueryOptions): Promise<RetrievalStrategySelection[]>;
  recordQueryAccessLogs?(entries: QueryAccessLogEntry[]): Promise<void>;
  getQueryAccessLogs?(options?: QueryAccessLogQueryOptions): Promise<QueryAccessLogEntry[]>;
  getExplorationSuggestions?(options?: ExplorationSuggestionQueryOptions): Promise<ExplorationSuggestion[]>;

  // Evolution outcomes (for learning/adaptation) - REQUIRED for self-evolution
  recordEvolutionOutcome(outcome: EvolutionOutcome): Promise<void>;
  getEvolutionOutcomes(options?: EvolutionOutcomeQueryOptions): Promise<EvolutionOutcome[]>;

  // Learned context (for relevance engine adaptation)
  recordLearnedMissing(context: string, taskId: string): Promise<void>;
  getLearnedMissing(): Promise<LearnedMissingContext[]>;
  clearLearnedMissing(context: string): Promise<void>;

  // Quality score history (for trend tracking)
  recordQualityScore(score: Omit<QualityScoreHistory, 'id' | 'recordedAt'>): Promise<void>;
  getQualityScoreHistory(limit?: number): Promise<QualityScoreHistory[]>;

  // Graph edges (call/import)
  upsertGraphEdges(edges: GraphEdge[]): Promise<void>;
  deleteGraphEdgesForSource(sourceFile: string): Promise<void>;
  getGraphEdges(options?: GraphEdgeQueryOptions): Promise<GraphEdge[]>;

  // Ingestion items
  getIngestionItem(id: string): Promise<IngestionItem | null>;
  getIngestionItems(options?: IngestionQueryOptions): Promise<IngestionItem[]>;
  upsertIngestionItem(item: IngestionItem): Promise<void>;
  deleteIngestionItem(id: string): Promise<void>;

  // Indexing history
  recordIndexingResult(result: IndexingResult): Promise<void>;
  getLastIndexingResult(): Promise<IndexingResult | null>;

  // Bootstrap history
  recordBootstrapReport(report: BootstrapReport): Promise<void>;
  getLastBootstrapReport(): Promise<BootstrapReport | null>;

  // Confidence updates
  updateConfidence(
    entityId: string,
    entityType: 'function' | 'module' | 'context_pack',
    delta: number,
    reason: string
  ): Promise<void>;
  applyTimeDecay(decayRate: number): Promise<number>; // Returns count of updated entities

  // Bulk operations
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
  getIndexCoordinationVersion(): Promise<number>;
  getIndexChangeEvents(options?: IndexChangeQueryOptions): Promise<IndexChangeEvent[]>;
  vacuum(): Promise<void>;
  getStats(): Promise<StorageStats>;

  // Graph metrics (centrality, community detection)
  setGraphMetrics(entries: GraphMetricsEntry[]): Promise<void>;
  getGraphMetrics(options?: GraphMetricsQueryOptions): Promise<GraphMetricsEntry[]>;
  deleteGraphMetrics(): Promise<void>;

  // Cochange edges (temporal coupling)
  storeCochangeEdges(edges: CochangeEdge[], computedAt?: string): Promise<void>;
  getCochangeEdges(options?: CochangeQueryOptions): Promise<CochangeEdge[]>;
  getCochangeEdgeCount(): Promise<number>;
  deleteCochangeEdges(): Promise<void>;

  // Evidence (supporting claims for knowledge)
  setEvidence(entries: EvidenceEntry[]): Promise<void>;
  getEvidenceForTarget(entityId: string, entityType: 'function' | 'module'): Promise<EvidenceRef[]>;
  deleteEvidence(entityId: string, entityType: 'function' | 'module'): Promise<void>;
  getEvidenceVerificationSummary?(options?: EvidenceVerificationOptions): Promise<EvidenceVerificationSummary>;
  exportEvidenceMarkdown?(outputPath?: string): Promise<string>;

  // Confidence events (audit trail)
  getConfidenceEvents(options?: ConfidenceEventQueryOptions): Promise<ConfidenceEvent[]>;
  countConfidenceUpdates(entityId: string, entityType: 'function' | 'module' | 'context_pack', sinceIso: string, deltaFilter?: 'any' | 'negative' | 'positive'): Promise<number>;

  // Test mappings (test-to-code relationships)
  getTestMapping(id: string): Promise<TestMapping | null>;
  getTestMappings(options?: TestMappingQueryOptions): Promise<TestMapping[]>;
  getTestMappingsByTestPath(testPath: string): Promise<TestMapping[]>;
  getTestMappingsBySourcePath(sourcePath: string): Promise<TestMapping[]>;
  upsertTestMapping(mapping: Omit<TestMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<TestMapping>;
  deleteTestMapping(id: string): Promise<void>;
  deleteTestMappingsByTestPath(testPath: string): Promise<number>;

  // Commits (git history with semantic categorization)
  getCommit(id: string): Promise<LibrarianCommit | null>;
  getCommitBySha(sha: string): Promise<LibrarianCommit | null>;
  getCommits(options?: CommitQueryOptions): Promise<LibrarianCommit[]>;
  upsertCommit(commit: Omit<LibrarianCommit, 'id' | 'createdAt'>): Promise<LibrarianCommit>;
  deleteCommit(id: string): Promise<void>;
  deleteCommitBySha(sha: string): Promise<void>;

  // Ownership (DOA scores with recency)
  getOwnership(id: string): Promise<FileOwnership | null>;
  getOwnershipByFilePath(filePath: string): Promise<FileOwnership[]>;
  getOwnershipByAuthor(author: string): Promise<FileOwnership[]>;
  getOwnerships(options?: OwnershipQueryOptions): Promise<FileOwnership[]>;
  upsertOwnership(ownership: Omit<FileOwnership, 'id' | 'createdAt'>): Promise<FileOwnership>;
  deleteOwnership(id: string): Promise<void>;
  deleteOwnershipByFilePath(filePath: string): Promise<number>;

  // Universal Knowledge (comprehensive per-entity knowledge records)
  getUniversalKnowledge(id: string): Promise<UniversalKnowledgeRecord | null>;
  getUniversalKnowledgeByFile(filePath: string): Promise<UniversalKnowledgeRecord[]>;
  getUniversalKnowledgeByKind(kind: string): Promise<UniversalKnowledgeRecord[]>;
  queryUniversalKnowledge(options: UniversalKnowledgeQueryOptions): Promise<UniversalKnowledgeRecord[]>;
  upsertUniversalKnowledge(knowledge: UniversalKnowledgeRecord): Promise<void>;
  upsertUniversalKnowledgeBatch(records: UniversalKnowledgeRecord[]): Promise<void>;
  deleteUniversalKnowledge(id: string): Promise<void>;
  deleteUniversalKnowledgeByFile(filePath: string): Promise<number>;
  searchUniversalKnowledgeBySimilarity(
    embedding: Float32Array,
    options: UniversalKnowledgeSimilarityOptions
  ): Promise<UniversalKnowledgeSimilarityResult[]>;

  // Flash assessments (at-a-glance health checks)
  getAssessment(entityId: string): Promise<FlashAssessment | null>;
  getAssessmentByPath(path: string): Promise<FlashAssessment | null>;
  getAssessments(options?: AssessmentQueryOptions): Promise<FlashAssessment[]>;
  upsertAssessment(assessment: FlashAssessment): Promise<void>;
  upsertAssessments(assessments: FlashAssessment[]): Promise<void>;
  deleteAssessment(entityId: string): Promise<void>;
  deleteAssessmentByPath(path: string): Promise<void>;

  // ========================================================================
  // ADVANCED ANALYSIS (Migration 010)
  // ========================================================================

  // Strongly Connected Components
  getSCCEntries(options?: SCCQueryOptions): Promise<SCCEntry[]>;
  getSCCByEntity(entityId: string, entityType: SCCEntry['entityType']): Promise<SCCEntry | null>;
  upsertSCCEntries(entries: SCCEntry[]): Promise<void>;
  deleteSCCEntries(): Promise<void>;

  // Control Flow Graph
  getCFGEdges(options?: CFGQueryOptions): Promise<CFGEdge[]>;
  getCFGForFunction(functionId: string): Promise<CFGEdge[]>;
  upsertCFGEdges(edges: CFGEdge[]): Promise<void>;
  deleteCFGEdgesForFunction(functionId: string): Promise<void>;

  // Bayesian Confidence
  getBayesianConfidence(entityId: string, entityType: BayesianConfidence['entityType']): Promise<BayesianConfidence | null>;
  getBayesianConfidences(options?: BayesianConfidenceQueryOptions): Promise<BayesianConfidence[]>;
  upsertBayesianConfidence(entry: BayesianConfidence): Promise<void>;
  updateBayesianConfidence(entityId: string, entityType: BayesianConfidence['entityType'], success: boolean): Promise<void>;

  // Stability Metrics
  getStabilityMetrics(entityId: string, entityType: string): Promise<StabilityMetrics | null>;
  getStabilityMetricsList(options?: StabilityQueryOptions): Promise<StabilityMetrics[]>;
  upsertStabilityMetrics(metrics: StabilityMetrics): Promise<void>;

  // Feedback Loops
  getFeedbackLoop(loopId: string): Promise<FeedbackLoop | null>;
  getFeedbackLoops(options?: FeedbackLoopQueryOptions): Promise<FeedbackLoop[]>;
  upsertFeedbackLoop(loop: FeedbackLoop): Promise<void>;
  resolveFeedbackLoop(loopId: string, resolutionMethod: string): Promise<void>;

  // Graph Analysis Cache
  getGraphCacheEntry(cacheKey: string): Promise<GraphCacheEntry | null>;
  upsertGraphCacheEntry(entry: GraphCacheEntry): Promise<void>;
  pruneExpiredGraphCache(): Promise<number>;

  // ========================================================================
  // ADVANCED LIBRARY FEATURES (Migration 011)
  // ========================================================================

  // Git Blame (line-level ownership)
  getBlameEntries(options?: BlameQueryOptions): Promise<BlameEntry[]>;
  getBlameForFile(filePath: string): Promise<BlameEntry[]>;
  getBlameStats(filePath: string): Promise<BlameStats | null>;
  upsertBlameEntries(entries: BlameEntry[]): Promise<void>;
  deleteBlameForFile(filePath: string): Promise<number>;

  // Git Diff (semantic change tracking)
  getDiffRecords(options?: DiffQueryOptions): Promise<DiffRecord[]>;
  getDiffForCommit(commitHash: string): Promise<DiffRecord[]>;
  upsertDiffRecords(records: DiffRecord[]): Promise<void>;
  deleteDiffForCommit(commitHash: string): Promise<number>;

  // Git Reflog (branch history)
  getReflogEntries(options?: ReflogQueryOptions): Promise<ReflogEntry[]>;
  upsertReflogEntries(entries: ReflogEntry[]): Promise<void>;
  deleteReflogEntries(beforeTimestamp: string): Promise<number>;

  // Code Clones
  getCloneEntries(options?: CloneQueryOptions): Promise<CloneEntry[]>;
  getClonesByEntity(entityId: string): Promise<CloneEntry[]>;
  getCloneClusters(): Promise<CloneCluster[]>;
  upsertCloneEntries(entries: CloneEntry[]): Promise<void>;
  deleteCloneEntries(): Promise<number>;

  // Technical Debt
  getDebtMetrics(options?: DebtQueryOptions): Promise<DebtMetrics[]>;
  getDebtForEntity(entityId: string, entityType: DebtMetrics['entityType']): Promise<DebtMetrics | null>;
  getDebtHotspots(limit?: number): Promise<DebtHotspot[]>;
  upsertDebtMetrics(metrics: DebtMetrics[]): Promise<void>;
  deleteDebtMetrics(entityId: string): Promise<void>;

  // Knowledge Graph
  getKnowledgeEdges(options?: KnowledgeEdgeQueryOptions): Promise<KnowledgeGraphEdge[]>;
  getKnowledgeEdgesFrom(sourceId: string): Promise<KnowledgeGraphEdge[]>;
  getKnowledgeEdgesTo(targetId: string): Promise<KnowledgeGraphEdge[]>;
  getKnowledgeSubgraph(rootId: string, depth: number, edgeTypes?: KnowledgeEdgeType[]): Promise<KnowledgeSubgraph>;
  upsertKnowledgeEdges(edges: KnowledgeGraphEdge[]): Promise<void>;
  deleteKnowledgeEdge(id: string): Promise<void>;
  deleteKnowledgeEdgesForEntity(entityId: string): Promise<number>;

  // Fault Localization
  getFaultLocalizations(options?: FaultLocalizationQueryOptions): Promise<FaultLocalization[]>;
  upsertFaultLocalization(localization: FaultLocalization): Promise<void>;
  deleteFaultLocalization(id: string): Promise<void>;
}

// ============================================================================
// STORAGE SLICE INTERFACES
// ============================================================================

export type StorageLifecycle = Pick<LibrarianStorage, 'initialize' | 'close' | 'isInitialized' | 'getCapabilities'>;

export type MetadataStorage = Pick<
  LibrarianStorage,
  'getMetadata' | 'setMetadata' | 'getState' | 'setState' | 'getVersion' | 'setVersion'
>;

export type KnowledgeStorage = Pick<
  LibrarianStorage,
  | 'getFunctions'
  | 'getFunction'
  | 'getFunctionByPath'
  | 'getFunctionsByPath'
  | 'upsertFunction'
  | 'upsertFunctions'
  | 'deleteFunction'
  | 'deleteFunctionsByPath'
  | 'getModules'
  | 'getModule'
  | 'getModuleByPath'
  | 'upsertModule'
  | 'deleteModule'
  | 'getFiles'
  | 'getFile'
  | 'getFileByPath'
  | 'getFilesByDirectory'
  | 'upsertFile'
  | 'upsertFiles'
  | 'deleteFile'
  | 'deleteFileByPath'
  | 'getDirectories'
  | 'getDirectory'
  | 'getDirectoryByPath'
  | 'getSubdirectories'
  | 'upsertDirectory'
  | 'upsertDirectories'
  | 'deleteDirectory'
  | 'deleteDirectoryByPath'
  | 'getContextPacks'
  | 'getContextPack'
  | 'getContextPackForTarget'
  | 'findByIntentAndScope'
  | 'findByProvenance'
  | 'upsertContextPack'
  | 'invalidateContextPacks'
  | 'deleteContextPack'
  | 'recordContextPackAccess'
>;

export type ChecksumStorage = Pick<
  LibrarianStorage,
  'getFileChecksum' | 'setFileChecksum' | 'deleteFileChecksum'
>;

export type EmbeddingStorage = Pick<
  LibrarianStorage,
  'getEmbedding' | 'setEmbedding' | 'findSimilarByEmbedding' | 'getMultiVector' | 'getMultiVectors' | 'upsertMultiVector' | 'clearMismatchedEmbeddings' | 'getEmbeddingStats'
>;

export type QueryCacheStorage = Pick<
  LibrarianStorage,
  'getQueryCacheEntry' | 'upsertQueryCacheEntry' | 'recordQueryCacheAccess' | 'pruneQueryCache'
>;

export type GraphCacheStorage = Pick<
  LibrarianStorage,
  'getGraphCacheEntry' | 'upsertGraphCacheEntry' | 'pruneExpiredGraphCache'
>;

export type EvolutionStorage = Pick<
  LibrarianStorage,
  | 'recordEvolutionOutcome'
  | 'getEvolutionOutcomes'
  | 'recordLearnedMissing'
  | 'getLearnedMissing'
  | 'clearLearnedMissing'
  | 'recordQualityScore'
  | 'getQualityScoreHistory'
>;

export type EvidenceStorage = Pick<
  LibrarianStorage,
  'setEvidence' | 'getEvidenceForTarget' | 'deleteEvidence' | 'getEvidenceVerificationSummary' | 'exportEvidenceMarkdown'
>;

export type ConfidenceStorage = Pick<
  LibrarianStorage,
  | 'updateConfidence'
  | 'applyTimeDecay'
  | 'getConfidenceEvents'
  | 'countConfidenceUpdates'
  | 'getBayesianConfidence'
  | 'getBayesianConfidences'
  | 'upsertBayesianConfidence'
  | 'updateBayesianConfidence'
>;

export type GraphStorage = Pick<
  LibrarianStorage,
  | 'upsertGraphEdges'
  | 'deleteGraphEdgesForSource'
  | 'getGraphEdges'
  | 'setGraphMetrics'
  | 'getGraphMetrics'
  | 'deleteGraphMetrics'
  | 'storeCochangeEdges'
  | 'getCochangeEdges'
  | 'getCochangeEdgeCount'
  | 'deleteCochangeEdges'
  | 'getKnowledgeEdges'
  | 'getKnowledgeEdgesFrom'
  | 'getKnowledgeEdgesTo'
  | 'getKnowledgeSubgraph'
  | 'upsertKnowledgeEdges'
  | 'deleteKnowledgeEdge'
  | 'deleteKnowledgeEdgesForEntity'
  | 'getSCCEntries'
  | 'getSCCByEntity'
  | 'upsertSCCEntries'
  | 'deleteSCCEntries'
  | 'getCFGEdges'
  | 'getCFGForFunction'
  | 'upsertCFGEdges'
  | 'deleteCFGEdgesForFunction'
>;

export type IngestionStorage = Pick<
  LibrarianStorage,
  | 'getIngestionItem'
  | 'getIngestionItems'
  | 'upsertIngestionItem'
  | 'deleteIngestionItem'
  | 'recordIndexingResult'
  | 'getLastIndexingResult'
  | 'recordBootstrapReport'
  | 'getLastBootstrapReport'
>;

export type TestMappingStorage = Pick<
  LibrarianStorage,
  | 'getTestMapping'
  | 'getTestMappings'
  | 'getTestMappingsByTestPath'
  | 'getTestMappingsBySourcePath'
  | 'upsertTestMapping'
  | 'deleteTestMapping'
  | 'deleteTestMappingsByTestPath'
>;

export type CommitStorage = Pick<
  LibrarianStorage,
  | 'getCommit'
  | 'getCommitBySha'
  | 'getCommits'
  | 'upsertCommit'
  | 'deleteCommit'
  | 'deleteCommitBySha'
>;

export type OwnershipStorage = Pick<
  LibrarianStorage,
  | 'getOwnership'
  | 'getOwnershipByFilePath'
  | 'getOwnershipByAuthor'
  | 'getOwnerships'
  | 'upsertOwnership'
  | 'deleteOwnership'
  | 'deleteOwnershipByFilePath'
>;

export type UniversalKnowledgeStorage = Pick<
  LibrarianStorage,
  | 'getUniversalKnowledge'
  | 'getUniversalKnowledgeByFile'
  | 'getUniversalKnowledgeByKind'
  | 'queryUniversalKnowledge'
  | 'upsertUniversalKnowledge'
  | 'upsertUniversalKnowledgeBatch'
  | 'deleteUniversalKnowledge'
  | 'deleteUniversalKnowledgeByFile'
  | 'searchUniversalKnowledgeBySimilarity'
>;

export type AssessmentStorage = Pick<
  LibrarianStorage,
  | 'getAssessment'
  | 'getAssessmentByPath'
  | 'getAssessments'
  | 'upsertAssessment'
  | 'upsertAssessments'
  | 'deleteAssessment'
  | 'deleteAssessmentByPath'
>;

export type GitAnalysisStorage = Pick<
  LibrarianStorage,
  | 'getBlameEntries'
  | 'getBlameForFile'
  | 'getBlameStats'
  | 'upsertBlameEntries'
  | 'deleteBlameForFile'
  | 'getDiffRecords'
  | 'getDiffForCommit'
  | 'upsertDiffRecords'
  | 'deleteDiffForCommit'
  | 'getReflogEntries'
  | 'upsertReflogEntries'
  | 'deleteReflogEntries'
>;

export type CloneStorage = Pick<
  LibrarianStorage,
  'getCloneEntries' | 'getClonesByEntity' | 'getCloneClusters' | 'upsertCloneEntries' | 'deleteCloneEntries'
>;

export type DebtStorage = Pick<
  LibrarianStorage,
  | 'getDebtMetrics'
  | 'getDebtForEntity'
  | 'getDebtHotspots'
  | 'upsertDebtMetrics'
  | 'deleteDebtMetrics'
>;

export type FaultLocalizationStorage = Pick<
  LibrarianStorage,
  'getFaultLocalizations' | 'upsertFaultLocalization' | 'deleteFaultLocalization'
>;

export type MaintenanceStorage = Pick<LibrarianStorage, 'transaction' | 'getStats' | 'vacuum'>;

export interface StorageSlices {
  lifecycle: StorageLifecycle;
  metadata: MetadataStorage;
  knowledge: KnowledgeStorage;
  checksums: ChecksumStorage;
  embeddings: EmbeddingStorage;
  cache: QueryCacheStorage;
  graphCache: GraphCacheStorage;
  learning: EvolutionStorage;
  evidence: EvidenceStorage;
  confidence: ConfidenceStorage;
  graph: GraphStorage;
  ingestion: IngestionStorage;
  tests: TestMappingStorage;
  commits: CommitStorage;
  ownership: OwnershipStorage;
  universalKnowledge: UniversalKnowledgeStorage;
  assessments: AssessmentStorage;
  git: GitAnalysisStorage;
  clones: CloneStorage;
  debt: DebtStorage;
  faults: FaultLocalizationStorage;
  maintenance: MaintenanceStorage;
  raw: LibrarianStorage;
}

// ============================================================================
// QUERY OPTIONS
// ============================================================================

export interface QueryOptions {
  limit?: number;
  offset?: number;
  minConfidence?: number;
  orderBy?: 'confidence' | 'accessCount' | 'lastAccessed' | 'name';
  orderDirection?: 'asc' | 'desc';
  isPure?: boolean;
}

export interface ContextPackQueryOptions extends QueryOptions {
  packType?: string;
  targetId?: string;
  includeInvalidated?: boolean;
  relatedFile?: string;
  relatedFilesAny?: string[];
  relatedFilePrefix?: string;
  language?: string;
  excludeTests?: boolean;
}

export interface ContextPackSeedLookupOptions {
  includeInvalidated?: boolean;
  limit?: number;
}

/**
 * Entity types that can be embedded and searched semantically.
 * - function: Code functions with extracted purpose/behavior
 * - module: Code modules with aggregated understanding
 * - document: Documentation files (AGENTS.md, README.md, docs/*.md)
 */
export type EmbeddableEntityType = 'function' | 'module' | 'document';

export interface SimilaritySearchOptions {
  limit: number;
  minSimilarity: number;
  entityTypes?: EmbeddableEntityType[];
  filter?: SearchFilter;
  /**
   * If true, automatically clear mismatched embeddings and return degraded results
   * instead of throwing an error when all embeddings have wrong dimensions.
   * The cleared embeddings will be regenerated on next indexing.
   */
  autoRecoverDimensionMismatch?: boolean;
}

export interface SimilarityResult {
  entityId: string;
  entityType: EmbeddableEntityType;
  similarity: number;
}

/**
 * Response type for similarity search operations.
 * Includes a degraded flag to indicate when results may be incomplete
 * due to infrastructure issues (empty vector index, dimension mismatch, etc.)
 */
export interface SimilaritySearchResponse {
  results: SimilarityResult[];
  /** Whether the search was performed in a degraded state */
  degraded: boolean;
  /** Reason for degradation if degraded is true */
  degradedReason?: 'vector_index_empty' | 'vector_index_null' | 'dimension_mismatch' | 'fallback_to_brute_force' | 'auto_recovered_dimension_mismatch';
  /** Number of mismatched embeddings that were cleared during auto-recovery */
  clearedMismatchedCount?: number;
}

export interface GraphEdgeQueryOptions {
  sourceFiles?: string[];
  fromIds?: string[];
  toIds?: string[];
  /**
   * Legacy singular filter alias.
   * Prefer `edgeTypes` for new callsites.
   */
  edgeType?: GraphEdgeType;
  edgeTypes?: GraphEdgeType[];
  fromTypes?: GraphEntityType[];
  toTypes?: GraphEntityType[];
  limit?: number;
}

export interface EmbeddingMetadata {
  modelId: string;
  generatedAt?: string;
  tokenCount?: number;
  entityType?: EmbeddableEntityType;
}

export interface MultiVectorPayload {
  filePath: string;
  // PURPOSE-ONLY vector: embeds ONLY the extracted purpose statement
  // This is the primary signal for "what does X do?" queries
  purpose?: number[];
  purposeInput?: string;
  // SEMANTIC vector: embeds purpose + code (legacy, still useful for implementation search)
  semantic?: number[];
  semanticInput?: string;
  structural?: number[];
  structuralInput?: string;
  dependency?: number[];
  dependencyInput?: string;
  usage?: number[];
  usageInput?: string;
  llmPurpose?: string;
  lastUpdated: number;
  modelId: string;
}

export interface MultiVectorRecord {
  entityId: string;
  entityType: 'function' | 'module';
  payload: MultiVectorPayload;
  modelId: string;
  generatedAt: string;
  tokenCount: number;
}

export interface MultiVectorQueryOptions {
  entityIds?: string[];
  entityType?: 'function' | 'module';
  limit?: number;
}

export interface IngestionQueryOptions {
  sourceType?: string;
  limit?: number;
  orderBy?: 'ingested_at' | 'source_type';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// FILE & DIRECTORY QUERY OPTIONS
// ============================================================================

export interface FileQueryOptions {
  limit?: number;
  offset?: number;
  minConfidence?: number;
  category?: 'code' | 'config' | 'docs' | 'test' | 'data' | 'schema' | 'other';
  extension?: string;
  directory?: string;               // Filter by parent directory
  hasTests?: boolean;
  complexity?: 'low' | 'medium' | 'high';
  orderBy?: 'name' | 'confidence' | 'lastIndexed' | 'lineCount' | 'complexity';
  orderDirection?: 'asc' | 'desc';
}

export interface DirectoryQueryOptions {
  limit?: number;
  offset?: number;
  minConfidence?: number;
  role?: 'feature' | 'layer' | 'utility' | 'config' | 'tests' | 'docs' | 'root' | 'other';
  parent?: string;                  // Filter by parent directory
  minDepth?: number;
  maxDepth?: number;
  hasReadme?: boolean;
  hasIndex?: boolean;
  hasTests?: boolean;
  orderBy?: 'name' | 'confidence' | 'lastIndexed' | 'depth' | 'totalFiles';
  orderDirection?: 'asc' | 'desc';
}

export interface AssessmentQueryOptions {
  limit?: number;
  offset?: number;
  entityType?: 'file' | 'directory';
  overallHealth?: 'healthy' | 'needs-attention' | 'at-risk' | 'critical';
  minHealthScore?: number;
  maxHealthScore?: number;
  hasFindingsWithSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  orderBy?: 'healthScore' | 'assessedAt' | 'entityPath';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// TRANSACTION CONTEXT
// ============================================================================

export interface TransactionContext {
  /**
   * Transaction-scoped write API.
   *
   * - All operations are executed inside a storage backend transaction.
   * - If the transaction callback throws or rejects, all writes performed
   *   via this context are rolled back (no partial commits).
   * - Calls may be made in any order; repeated writes to the same entity
   *   are last-write-wins within the transaction.
   * - Nested transactions are not supported; do not call `transaction`
   *   from inside a transaction callback.
   * - Isolation/conflict behavior is backend-defined; use
   *   `withinTransaction` + `ConcurrencyContract` to declare retry policy.
   */
  upsertFunction(fn: FunctionKnowledge): Promise<void>;
  upsertModule(mod: ModuleKnowledge): Promise<void>;
  upsertContextPack(pack: ContextPack): Promise<void>;
  upsertIngestionItem(item: IngestionItem): Promise<void>;
  upsertTestMapping(mapping: Omit<TestMapping, 'id' | 'createdAt' | 'updatedAt'>): Promise<TestMapping>;
  upsertCommit(commit: Omit<LibrarianCommit, 'id' | 'createdAt'>): Promise<LibrarianCommit>;
  upsertOwnership(ownership: Omit<FileOwnership, 'id' | 'createdAt'>): Promise<FileOwnership>;
  setEmbedding(entityId: string, embedding: Float32Array, metadata: EmbeddingMetadata): Promise<void>;
  upsertMultiVector(record: MultiVectorRecord): Promise<void>;
  deleteFunction(id: string): Promise<void>;
  deleteFunctionsByPath(filePath: string): Promise<void>;
  deleteModule(id: string): Promise<void>;
  upsertFile?(file: FileKnowledge): Promise<void>;
  upsertFiles?(files: FileKnowledge[]): Promise<void>;
  upsertDirectory?(dir: DirectoryKnowledge): Promise<void>;
  upsertDirectories?(dirs: DirectoryKnowledge[]): Promise<void>;
  upsertAssessment?(assessment: FlashAssessment): Promise<void>;
  upsertAssessments?(assessments: FlashAssessment[]): Promise<void>;
  deleteFileByPath(path: string): Promise<void>;
  deleteUniversalKnowledgeByFile(filePath: string): Promise<number>;
  deleteContextPack(packId: string): Promise<void>;
  invalidateContextPacks(triggerPath: string): Promise<number>;
  upsertGraphEdges(edges: GraphEdge[]): Promise<void>;
  deleteGraphEdgesForSource(sourceFile: string): Promise<void>;
  setFileChecksum(filePath: string, checksum: string, updatedAt?: string): Promise<void>;
}

export type TransactionConflictStrategy = 'retry' | 'fail' | 'merge';

export interface ConcurrencyContract {
  readIsolation: 'snapshot' | 'read_committed';
  conflictDetection: 'optimistic' | 'pessimistic';
  onConflict: TransactionConflictStrategy;
  maxRetries: number;
}

export type IndexChangeEventType =
  | 'function_updated'
  | 'file_added'
  | 'file_removed';

export interface IndexChangeEvent {
  id: string;
  type: IndexChangeEventType;
  path: string;
  version: number;
  timestamp: string;
}

export interface IndexChangeQueryOptions {
  sinceVersion?: number;
  paths?: string[];
  limit?: number;
}

// ============================================================================
// STORAGE STATS
// ============================================================================

export interface StorageStats {
  totalFunctions: number;
  totalModules: number;
  totalContextPacks: number;
  totalEmbeddings: number;
  storageSizeBytes: number;
  lastVacuum: Date | null;
  averageConfidence: number;
  cacheHitRate: number;
}

// ========================================================================
// QUERY CACHE
// ========================================================================

export interface QueryCacheEntry {
  queryHash: string;
  queryParams: string;
  response: string;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
}

export interface QueryCachePruneOptions {
  maxEntries: number;
  maxAgeMs: number;
}

export interface RetrievalConfidenceLogEntry {
  queryHash: string;
  confidenceScore: number;
  retrievalEntropy: number;
  returnedPackIds: string[];
  timestamp: string;
  intent?: string;
  fromDepth?: string;
  toDepth?: string;
  escalationReason?: string;
  attempt?: number;
  maxEscalationDepth?: number;
  routedStrategy?: string;
}

export interface RetrievalConfidenceLogQueryOptions {
  queryHash?: string;
  limit?: number;
}

export interface RetrievalStrategyReward {
  strategyId: string;
  intentType: string;
  successCount: number;
  failureCount: number;
  lastUpdated: string;
}

export interface RetrievalStrategySelection {
  queryId: string;
  strategyId: string;
  intentType: string;
  createdAt: string;
  feedbackOutcome?: 'success' | 'failure' | 'partial';
  feedbackRecordedAt?: string;
}

export interface RetrievalStrategySelectionQueryOptions {
  intentType?: string;
  limit?: number;
}

export interface QueryAccessLogEntry {
  entityId: string;
  entityType: 'function' | 'module';
  lastQueriedAt: string;
  queryCount: number;
}

export interface QueryAccessLogQueryOptions {
  entityType?: 'function' | 'module';
  limit?: number;
}

export interface ExplorationSuggestion {
  entityId: string;
  entityType: 'function' | 'module';
  centralityScore: number;
  queryCount: number;
  explorationValue: number;
  lastQueriedAt?: string;
  dependentCount?: number;
  rationale: string;
}

export interface ExplorationSuggestionQueryOptions {
  entityType?: 'function' | 'module';
  limit?: number;
}

// ============================================================================
// EVOLUTION OUTCOMES (for learning/adaptation)
// ============================================================================

/**
 * Records the outcome of a task for learning purposes.
 * Used by the self-evolution system to track agent performance and patterns.
 */
export interface EvolutionOutcome {
  taskId: string;
  taskType: string;
  agentId: string;
  success: boolean;
  durationMs: number;
  qualityScore: number;
  filesChanged: string[];
  testsAdded: number;
  testsPass: boolean;
  context: {
    librarianContextUsed: boolean;
    contextPackCount: number;
    decomposed: boolean;
  };
  timestamp: Date;
}

export interface EvolutionOutcomeQueryOptions {
  agentId?: string;
  taskType?: string;
  success?: boolean;
  timeRange?: { start: Date; end: Date };
  limit?: number;
  orderBy?: 'timestamp' | 'qualityScore' | 'durationMs';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Represents context that was missing and caused a task failure.
 * Used by the RelevanceEngine to learn from failures and improve context selection.
 */
export interface LearnedMissingContext {
  context: string;
  taskId: string;
  recordedAt: Date;
}

/**
 * Historical quality score entry for trend tracking.
 */
export interface QualityScoreHistory {
  id: string;
  overall: number;
  maintainability: number;
  testability: number;
  readability: number;
  complexity: number;
  recordedAt: Date;
}

// ============================================================================
// TEST MAPPING
// ============================================================================

/**
 * Represents a test-to-code relationship.
 * Used to track which tests cover which source files.
 */
export interface TestMapping {
  id: string;
  testPath: string;
  sourcePath: string;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestMappingQueryOptions {
  testPath?: string;
  sourcePath?: string;
  minConfidence?: number;
  limit?: number;
}

// ============================================================================
// COMMITS
// ============================================================================

/**
 * Git commit with semantic categorization.
 * Used for understanding project history and change patterns.
 */
export interface LibrarianCommit {
  id: string;
  sha: string;
  message: string;
  author: string;
  category: string;
  filesChanged: string[];
  createdAt: Date;
}

export interface CommitQueryOptions {
  sha?: string;
  author?: string;
  category?: string;
  limit?: number;
  orderBy?: 'created_at';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// OWNERSHIP
// ============================================================================

/**
 * Degree of Authorship (DOA) scores with recency.
 * Used for identifying code owners and expertise.
 */
export interface FileOwnership {
  id: string;
  filePath: string;
  author: string;
  score: number;
  lastModified: Date;
  createdAt: Date;
}

export interface OwnershipQueryOptions {
  filePath?: string;
  author?: string;
  minScore?: number;
  limit?: number;
  orderBy?: 'score' | 'last_modified';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// GRAPH METRICS
// ============================================================================

export interface GraphMetricsQueryOptions {
  entityIds?: string[];
  entityType?: 'function' | 'module';
  minPagerank?: number;
  limit?: number;
}

// ============================================================================
// COCHANGE
// ============================================================================

export interface CochangeQueryOptions {
  fileA?: string;
  fileB?: string;
  minStrength?: number;
  limit?: number;
  orderBy?: 'strength' | 'change_count';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// CONFIDENCE EVENTS
// ============================================================================

export interface ConfidenceEvent {
  id: string;
  entityId: string;
  entityType: 'function' | 'module' | 'context_pack';
  delta: number;
  updatedAt: Date;
  reason: string | null;
}

export interface ConfidenceEventQueryOptions {
  entityId?: string;
  entityType?: 'function' | 'module' | 'context_pack';
  sinceIso?: string;
  deltaFilter?: 'any' | 'negative' | 'positive';
  limit?: number;
  orderBy?: 'updated_at';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// STORAGE BACKEND (for custom implementations)
// ============================================================================

export interface StorageBackend {
  type: 'sqlite' | 'postgres' | 'memory';
  connectionString?: string;
  options?: Record<string, unknown>;
}

/**
 * Factory function type for creating storage instances.
 */
export type StorageFactory = (backend: StorageBackend) => Promise<LibrarianStorage>;

// ============================================================================
// UNIVERSAL KNOWLEDGE STORAGE
// ============================================================================

/**
 * Storage record for UniversalKnowledge.
 * The full knowledge object is stored as JSON, with key fields extracted for indexing.
 */
export interface UniversalKnowledgeRecord {
  id: string;                        // Unique identifier (hash-based)
  kind: string;                      // Entity type (function, class, module, etc.)
  name: string;                      // Canonical name
  qualifiedName: string;             // Full path including namespace
  file: string;                      // File path for the entity
  line: number;                      // Start line

  // Full knowledge record (stored as JSON)
  knowledge: string;                 // JSON-serialized UniversalKnowledge

  // Extracted fields for indexing/filtering
  purposeSummary?: string;           // semantics.purpose.summary
  maintainabilityIndex?: number;     // quality.maintainability.index
  riskScore?: number;                // security.riskScore.overall
  testCoverage?: number;             // quality.coverage.statement
  cyclomaticComplexity?: number;     // quality.complexity.cyclomatic
  cognitiveComplexity?: string;      // semantics.complexity.cognitive

  // Embedding for similarity search
  embedding?: Float32Array;          // Semantic vector (384-dim)

  // Meta
  confidence: number;                // meta.confidence.overall
  generatedAt: string;               // ISO timestamp
  validUntil?: string;               // When this becomes stale
  hash: string;                      // Content hash for change detection
}

export interface UniversalKnowledgeQueryOptions {
  kind?: string;
  file?: string;
  minConfidence?: number;
  minMaintainability?: number;
  maxRisk?: number;
  minCoverage?: number;
  maxComplexity?: number;
  searchText?: string;               // Full-text search in purposeSummary
  filePrefix?: string;               // Prefix match on file path
  limit?: number;
  offset?: number;
  orderBy?: 'confidence' | 'maintainability' | 'risk' | 'coverage' | 'complexity' | 'name';
  orderDirection?: 'asc' | 'desc';
}

export interface UniversalKnowledgeSimilarityOptions {
  limit: number;
  minSimilarity: number;
  kinds?: string[];                  // Filter by entity kinds
  files?: string[];                  // Filter by files
}

export interface UniversalKnowledgeSimilarityResult {
  id: string;
  name: string;
  file: string;
  kind: string;
  similarity: number;                // Cosine similarity 0-1
  purposeSummary?: string;
}

// ============================================================================
// ADVANCED ANALYSIS TYPES (Migration 010)
// ============================================================================

/**
 * Strongly Connected Component membership.
 * Enables cycle detection and dependency analysis.
 */
export interface SCCEntry {
  componentId: number;
  entityId: string;
  entityType: 'function' | 'module' | 'file';
  isRoot: boolean;
  componentSize: number;
  computedAt: string;
}

export interface SCCQueryOptions {
  componentId?: number;
  entityType?: 'function' | 'module' | 'file';
  minSize?: number;
  onlyRoots?: boolean;
  limit?: number;
}

/**
 * Control Flow Graph edge within a function.
 * Enables control flow analysis for complexity and reachability.
 */
export interface CFGEdge {
  functionId: string;
  fromBlock: number;
  toBlock: number;
  edgeType: 'sequential' | 'branch_true' | 'branch_false' | 'loop_back' | 'exception';
  condition?: string;
  sourceLine?: number;
  confidence: number;
}

export interface CFGQueryOptions {
  functionId?: string;
  edgeType?: CFGEdge['edgeType'];
  limit?: number;
}

/**
 * Bayesian confidence tracking using Beta-Binomial conjugate priors.
 * Provides proper uncertainty quantification for knowledge confidence.
 *
 * Mean = alpha / (alpha + beta)
 * Variance = alpha*beta / ((alpha+beta)^2 * (alpha+beta+1))
 */
export interface BayesianConfidence {
  entityId: string;
  entityType: 'function' | 'module' | 'context_pack' | 'file' | 'directory';
  priorAlpha: number;       // Beta distribution alpha (successes + 1)
  priorBeta: number;        // Beta distribution beta (failures + 1)
  posteriorAlpha: number;
  posteriorBeta: number;
  observationCount: number;
  lastObservation?: string;
  computedAt: string;
}

export interface BayesianConfidenceQueryOptions {
  entityType?: BayesianConfidence['entityType'];
  minObservations?: number;
  limit?: number;
}

/**
 * Stability metrics for confidence time-series analysis.
 * Enables prediction and anomaly detection.
 */
export interface StabilityMetrics {
  entityId: string;
  entityType: string;
  volatility: number;           // Standard deviation of confidence changes
  trend: number;                // Slope of linear regression
  meanReversionRate?: number;   // Speed of reversion to mean
  halfLifeDays?: number;        // Time for confidence to decay 50%
  seasonalityPeriodDays?: number;
  lastChangeDelta?: number;
  computedAt: string;
  windowDays: number;
}

export interface StabilityQueryOptions {
  entityType?: string;
  minVolatility?: number;
  maxVolatility?: number;
  trendDirection?: 'increasing' | 'decreasing' | 'stable';
  limit?: number;
}

/**
 * Feedback loop detection result.
 * Identifies cycles in dependency/data flow graphs.
 */
export interface FeedbackLoop {
  loopId: string;
  loopType: 'circular_import' | 'mutual_recursion' | 'state_cycle' | 'data_flow_cycle';
  entities: string[];           // Entity IDs in the loop
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  isStable: boolean;            // true = converges, false = diverges/unknown
  cycleLength: number;
  detectedAt: string;
  resolvedAt?: string;
  resolutionMethod?: string;
}

export interface FeedbackLoopQueryOptions {
  loopType?: FeedbackLoop['loopType'];
  severity?: FeedbackLoop['severity'];
  unresolvedOnly?: boolean;
  limit?: number;
}

/**
 * Graph analysis cache entry.
 * Caches expensive computations with TTL.
 */
export interface GraphCacheEntry {
  cacheKey: string;
  analysisType: string;
  result: string;               // JSON-serialized result
  nodeCount: number;
  edgeCount: number;
  computationMs: number;
  computedAt: string;
  expiresAt: string;
}

// ============================================================================
// ADVANCED LIBRARY FEATURES (Migration 011)
// Based on 2025-2026 software engineering research
// ============================================================================

/**
 * Git blame entry for line-level code ownership.
 * Enables "who knows this code?" queries and expertise identification.
 *
 * Based on: git blame --line-porcelain
 */
export interface BlameEntry {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  author: string;
  authorEmail: string;
  commitHash: string;
  commitDate: string;
  originalLine?: number;          // Line in original commit
  indexedAt: string;
}

export interface BlameQueryOptions {
  filePath?: string;
  author?: string;
  commitHash?: string;
  lineRange?: { start: number; end: number };
  limit?: number;
  orderBy?: 'line_start' | 'commit_date';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Aggregated blame statistics per file.
 */
export interface BlameStats {
  filePath: string;
  totalLines: number;
  authorsByLines: Record<string, number>;  // author -> lines owned
  expertiseByAuthor: Record<string, number>;  // author -> ownership percentage
  lastModified: string;
  topContributor: string;
}

/**
 * Git diff record for semantic change tracking.
 * Categorizes changes as structural, behavioral, or cosmetic.
 *
 * Based on: git show --format="" --unified=3
 */
export interface DiffRecord {
  id: string;
  commitHash: string;
  filePath: string;
  additions: number;
  deletions: number;
  hunkCount: number;
  hunks: DiffHunk[];
  changeCategory: 'structural' | 'behavioral' | 'cosmetic' | 'mixed';
  complexity: number;             // change_lines / context_lines
  impactScore: number;            // Estimated impact 0-1
  indexedAt: string;
}

export interface DiffHunk {
  startLine: number;
  length: number;
  changeType: 'add' | 'modify' | 'delete';
  contextBefore?: string;
  contextAfter?: string;
}

export interface DiffQueryOptions {
  commitHash?: string;
  filePath?: string;
  changeCategory?: DiffRecord['changeCategory'];
  minComplexity?: number;
  minImpact?: number;
  limit?: number;
  orderBy?: 'complexity' | 'impact_score' | 'indexed_at';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Git reflog entry for branch history and workflow tracking.
 * Captures reverted changes, rebases, and development patterns.
 *
 * Based on: git reflog --format="%H %gd %gs"
 */
export interface ReflogEntry {
  id: string;
  refName: string;
  commitHash: string;
  action: 'commit' | 'rebase' | 'reset' | 'merge' | 'checkout' | 'cherry-pick' | 'revert' | 'pull' | 'other';
  previousCommit?: string;
  timestamp: string;
  message: string;
  author?: string;
  indexedAt: string;
}

export interface ReflogQueryOptions {
  refName?: string;
  action?: ReflogEntry['action'];
  commitHash?: string;
  author?: string;
  sinceTimestamp?: string;
  limit?: number;
  orderBy?: 'timestamp';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Code clone detection entry.
 * Identifies duplicate/similar code for refactoring opportunities.
 *
 * Clone types (based on research):
 * - exact: Identical code (Type-1)
 * - type1: Identical except whitespace/comments
 * - type2: Syntactically identical, different identifiers
 * - type3: Similar with modifications
 * - semantic: Different syntax, same behavior (Type-4)
 */
export interface CloneEntry {
  cloneGroupId: number;
  entityId1: string;
  entityId2: string;
  entityType: 'function' | 'module' | 'file' | 'block';
  similarity: number;             // 0-1 cosine similarity
  cloneType: 'exact' | 'type1' | 'type2' | 'type3' | 'semantic';
  sharedLines?: number;
  sharedTokens?: number;
  refactoringPotential: number;   // 0-1 how beneficial to refactor
  computedAt: string;
}

export interface CloneQueryOptions {
  cloneGroupId?: number;
  entityId?: string;
  entityType?: CloneEntry['entityType'];
  cloneType?: CloneEntry['cloneType'];
  minSimilarity?: number;
  minRefactoringPotential?: number;
  limit?: number;
  orderBy?: 'similarity' | 'refactoring_potential' | 'computed_at';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Clone cluster for grouping related clones.
 */
export interface CloneCluster {
  clusterId: number;
  cloneType: CloneEntry['cloneType'];
  memberCount: number;
  avgSimilarity: number;
  totalDuplicatedLines: number;
  refactoringEffort: 'trivial' | 'easy' | 'moderate' | 'hard';
  suggestedAction: 'extract_function' | 'extract_class' | 'create_utility' | 'use_template' | 'ignore';
}

/**
 * Technical debt metrics per entity.
 * Aggregates multiple debt signals for prioritization.
 *
 * Based on 2025-2026 research on technical debt prediction:
 * - Social Network Analysis metrics
 * - Code churn correlation with defects
 * - Design flaw + churn vulnerability prediction
 */
export interface DebtMetrics {
  entityId: string;
  entityType: 'function' | 'module' | 'file' | 'directory';
  totalDebt: number;              // 0-100 aggregate score

  // Individual debt categories
  complexityDebt: number;         // Cyclomatic/cognitive complexity > threshold
  duplicationDebt: number;        // From clone analysis
  couplingDebt: number;           // High instability + high concreteness
  coverageDebt: number;           // Low test coverage
  architectureDebt: number;       // Layer violations, circular deps
  churnDebt: number;              // High churn + low stability
  documentationDebt: number;      // Missing/stale docs
  securityDebt: number;           // Unpatched vulnerabilities

  // Trend tracking
  trend: 'improving' | 'stable' | 'degrading';
  trendDelta: number;             // Change from last computation
  velocityPerDay: number;         // Rate of debt accumulation

  // Impact analysis
  estimatedFixHours: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  recommendations: string[];

  // Bayesian integration
  confidenceAlpha: number;
  confidenceBeta: number;

  computedAt: string;
}

export interface DebtQueryOptions {
  entityId?: string;
  entityType?: DebtMetrics['entityType'];
  trend?: DebtMetrics['trend'];
  priority?: DebtMetrics['priority'];
  minDebt?: number;
  maxDebt?: number;
  limit?: number;
  orderBy?: 'total_debt' | 'priority' | 'estimated_fix_hours' | 'computed_at';
  orderDirection?: 'asc' | 'desc';
}

/**
 * Debt hotspot for visualization and prioritization.
 */
export interface DebtHotspot {
  entityId: string;
  entityType: DebtMetrics['entityType'];
  path: string;
  totalDebt: number;
  dominantCategory: keyof Omit<DebtMetrics, 'entityId' | 'entityType' | 'totalDebt' | 'trend' | 'trendDelta' | 'velocityPerDay' | 'estimatedFixHours' | 'priority' | 'recommendations' | 'confidenceAlpha' | 'confidenceBeta' | 'computedAt'>;
  impactRadius: number;           // How many entities affected
  fixComplexity: 'trivial' | 'easy' | 'moderate' | 'hard' | 'epic';
}

/**
 * Knowledge graph edge connecting code entities.
 * Enables graph-based queries and analysis.
 *
 * Based on 2025-2026 research:
 * - Code knowledge graphs with 95%+ semantic alignment
 * - Outperform vector retrieval baselines
 */
export interface KnowledgeGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType:
    | 'function'
    | 'module'
    | 'file'
    | 'directory'
    | 'class'
    | 'interface'
    | 'endpoint'
    | 'graphql_type'
    | 'graphql_operation'
    | 'commit'
    | 'author';
  targetType:
    | 'function'
    | 'module'
    | 'file'
    | 'directory'
    | 'class'
    | 'interface'
    | 'endpoint'
    | 'graphql_type'
    | 'graphql_operation'
    | 'commit'
    | 'author';
  edgeType: KnowledgeEdgeType;
  weight: number;                 // 0-1 strength
  confidence: number;             // 0-1 how certain
  metadata: Record<string, unknown>;
  computedAt: string;
  validUntil?: string;
}

export type KnowledgeEdgeType =
  | 'imports'           // A imports B
  | 'calls'             // A calls B
  | 'extends'           // A extends B
  | 'implements'        // A implements B
  | 'implements_endpoint' // Function implements REST endpoint
  | 'calls_endpoint'    // Function transitively calls endpoint handler
  | 'returns_schema'    // Endpoint/operation returns schema/type
  | 'graphql_resolves'  // Function resolves GraphQL operation
  | 'clone_of'          // A is clone of B
  | 'debt_related'      // A and B share debt
  | 'authored_by'       // Code authored by person
  | 'reviewed_by'       // Code reviewed by person
  | 'evolved_from'      // A evolved from B (refactoring)
  | 'co_changed'        // A and B frequently change together
  | 'tests'             // Test tests code
  | 'documents'         // Doc documents code
  | 'depends_on'        // Runtime dependency
  | 'similar_to'        // Semantic similarity
  | 'part_of';          // Hierarchical containment

export interface KnowledgeEdgeQueryOptions {
  sourceId?: string;
  targetId?: string;
  sourceType?: KnowledgeGraphEdge['sourceType'];
  targetType?: KnowledgeGraphEdge['targetType'];
  edgeType?: KnowledgeEdgeType;
  minWeight?: number;
  minConfidence?: number;
  limit?: number;
  orderBy?: 'weight' | 'confidence' | 'computed_at';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// ARGUMENT EDGES (Toulmin-IBIS Research)
// Based on: docs/research/ARGUMENTATION-STRUCTURES-FOR-CODE-REASONING.md
// ============================================================================

/**
 * Argument edge types for representing reasoning chains in codebases.
 *
 * These edge types enable capturing the *rationale* behind code connections,
 * architectural decisions, and design choices.
 *
 * Taxonomy based on three formal argumentation frameworks:
 * - Toulmin Model: claim-warrant-backing structure
 * - AAF/ASPIC+: attack/support semantics with defeasible reasoning
 * - IBIS: issue-position-argument deliberation
 */
export type ArgumentEdgeType =
  // Toulmin-inspired (reasoning structure)
  | 'supports'            // Evidence/grounds for a claim
  | 'warrants'            // Reasoning principle justifying inference
  | 'qualifies'           // Limits scope/confidence

  // AAF/ASPIC+-inspired (conflict resolution)
  | 'contradicts'         // Mutual exclusion
  | 'undermines'          // Attacks a premise
  | 'rebuts'              // Provides defeating condition

  // ADR/IBIS-inspired (decision chains)
  | 'supersedes'          // Replaces previous decision
  | 'depends_on_decision'; // Requires another decision

/**
 * Extended entity types for argument graph nodes.
 * These represent the conceptual entities in architectural reasoning.
 */
export type ArgumentEntityType =
  | 'decision'      // ADR or architectural decision
  | 'constraint'    // Technical/business constraint
  | 'assumption'    // Validated or unvalidated assumption
  | 'alternative'   // Considered but rejected approach
  | 'tradeoff'      // Gained/sacrificed pair
  | 'risk'          // Accepted risk
  | 'evidence'      // Supporting evidence
  | 'principle';    // Design principle or pattern

/**
 * Metadata specific to argument edges.
 * Captures Toulmin components, ASPIC+ rule types, and evidence linkage.
 */
export interface ArgumentEdgeMetadata {
  // Toulmin components
  /** For 'warrants': source/authority of the reasoning principle */
  warrantSource?: string;
  /** For 'qualifies': condition under which the qualification applies */
  qualifierCondition?: string;
  /** For 'rebuts': condition that triggers the rebuttal */
  rebuttalCondition?: string;

  // ASPIC+ components
  /** Whether the rule is strict (deductive) or defeasible (presumptive) */
  ruleType?: 'strict' | 'defeasible';
  /** 0-1 priority level in conflict resolution */
  preferenceLevel?: number;

  // Relationship metadata
  /** 0-1 confidence in the relationship */
  strength?: number;
  /** Links to evidence entries */
  evidenceRefs?: string[];

  // Temporal validity
  /** ISO timestamp when this argument became valid */
  validFrom?: string;
  /** ISO timestamp when this argument expires/was superseded */
  validUntil?: string;

  // Provenance
  /** Source of this argument edge */
  extractedFrom?: 'adr' | 'comment' | 'commit' | 'llm_inference' | 'manual';

  // Additional context
  /** Reason for contradiction or rejection (for 'contradicts' edges) */
  reason?: string;
  /** Reason for supersession (for 'supersedes' edges) */
  supersessionReason?: string;
  /** Mitigation strategy (for 'rebuts' edges from risks) */
  mitigation?: string;
  /** File path where this relationship was detected */
  filePath?: string;
}

/**
 * An argument edge in the knowledge graph.
 *
 * Extends KnowledgeGraphEdge with argument-specific semantics and metadata.
 * Used to represent reasoning chains, decision rationale, and architectural
 * justifications.
 *
 * @example
 * ```typescript
 * // Evidence supports a decision
 * const edge: ArgumentEdge = {
 *   id: 'arg-001',
 *   sourceId: 'benchmark-2024',
 *   targetId: 'adr-015-redis-cache',
 *   sourceType: 'evidence',
 *   targetType: 'decision',
 *   type: 'supports',
 *   weight: 0.9,
 *   confidence: 0.95,
 *   metadata: {
 *     strength: 0.9,
 *     extractedFrom: 'adr'
 *   },
 *   computedAt: '2024-01-15T10:00:00Z'
 * };
 * ```
 */
export interface ArgumentEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType: ArgumentEntityType | KnowledgeGraphEdge['sourceType'];
  targetType: ArgumentEntityType | KnowledgeGraphEdge['targetType'];
  type: ArgumentEdgeType;
  weight: number;                 // 0-1 strength of the relationship
  confidence: number;             // 0-1 certainty of the edge
  metadata?: ArgumentEdgeMetadata;
  computedAt: string;
  validUntil?: string;
}

/**
 * Query options for argument edges.
 */
export interface ArgumentEdgeQueryOptions {
  sourceId?: string;
  targetId?: string;
  sourceType?: ArgumentEdge['sourceType'];
  targetType?: ArgumentEdge['targetType'];
  edgeType?: ArgumentEdgeType;
  ruleType?: 'strict' | 'defeasible';
  minWeight?: number;
  minConfidence?: number;
  minStrength?: number;
  extractedFrom?: ArgumentEdgeMetadata['extractedFrom'];
  limit?: number;
  orderBy?: 'weight' | 'confidence' | 'computed_at';
  orderDirection?: 'asc' | 'desc';
}

// ============================================================================
// ARGUMENT EDGE HELPER FUNCTIONS
// ============================================================================

/** All valid argument edge types */
export const ARGUMENT_EDGE_TYPES: readonly ArgumentEdgeType[] = [
  'supports',
  'warrants',
  'qualifies',
  'contradicts',
  'undermines',
  'rebuts',
  'supersedes',
  'depends_on_decision',
] as const;

/** All valid argument entity types */
export const ARGUMENT_ENTITY_TYPES: readonly ArgumentEntityType[] = [
  'decision',
  'constraint',
  'assumption',
  'alternative',
  'tradeoff',
  'risk',
  'evidence',
  'principle',
] as const;

/**
 * Type guard to check if an edge type is an ArgumentEdgeType.
 *
 * @param edgeType - The edge type to check
 * @returns true if the edge type is a valid ArgumentEdgeType
 *
 * @example
 * ```typescript
 * if (isArgumentEdgeType(edge.type)) {
 *   // edge.type is ArgumentEdgeType
 * }
 * ```
 */
export function isArgumentEdgeType(edgeType: string): edgeType is ArgumentEdgeType {
  return (ARGUMENT_EDGE_TYPES as readonly string[]).includes(edgeType);
}

/**
 * Type guard to check if an entity type is an ArgumentEntityType.
 *
 * @param entityType - The entity type to check
 * @returns true if the entity type is a valid ArgumentEntityType
 */
export function isArgumentEntityType(entityType: string): entityType is ArgumentEntityType {
  return (ARGUMENT_ENTITY_TYPES as readonly string[]).includes(entityType);
}

/**
 * Type guard to check if an edge is an ArgumentEdge.
 *
 * Checks that the edge has a valid ArgumentEdgeType.
 *
 * @param edge - The edge to check
 * @returns true if the edge is an ArgumentEdge
 *
 * @example
 * ```typescript
 * const edges = await storage.getKnowledgeEdges();
 * const argumentEdges = edges.filter(isArgumentEdge);
 * ```
 */
export function isArgumentEdge(edge: { type?: string; edgeType?: string }): edge is ArgumentEdge {
  const type = edge.type ?? edge.edgeType;
  return typeof type === 'string' && isArgumentEdgeType(type);
}

/**
 * Filter edges to get only argument edges.
 *
 * @param edges - Array of edges to filter
 * @returns Array of edges that are argument edges
 *
 * @example
 * ```typescript
 * const allEdges = await storage.getKnowledgeEdges();
 * const argEdges = getArgumentEdges(allEdges);
 * ```
 */
export function getArgumentEdges<T extends { type?: string; edgeType?: string }>(
  edges: T[]
): T[] {
  return edges.filter((edge): edge is T => {
    const type = edge.type ?? edge.edgeType;
    return typeof type === 'string' && isArgumentEdgeType(type);
  });
}

/**
 * Group argument edges by their type.
 *
 * @param edges - Array of argument edges
 * @returns Map of edge type to array of edges
 */
export function groupArgumentEdgesByType<T extends ArgumentEdge>(
  edges: T[]
): Map<ArgumentEdgeType, T[]> {
  const grouped = new Map<ArgumentEdgeType, T[]>();

  for (const edge of edges) {
    const existing = grouped.get(edge.type) ?? [];
    existing.push(edge);
    grouped.set(edge.type, existing);
  }

  return grouped;
}

/**
 * Create an ArgumentEdge with defaults.
 *
 * @param partial - Partial argument edge data
 * @returns Complete ArgumentEdge with defaults filled in
 */
export function createArgumentEdge(
  partial: Pick<ArgumentEdge, 'id' | 'sourceId' | 'targetId' | 'type'> &
    Partial<Omit<ArgumentEdge, 'id' | 'sourceId' | 'targetId' | 'type'>>
): ArgumentEdge {
  return {
    sourceType: 'evidence',
    targetType: 'decision',
    weight: 1.0,
    confidence: 1.0,
    computedAt: new Date().toISOString(),
    ...partial,
  };
}

/**
 * Check if an argument edge represents a conflict (attack relationship).
 *
 * @param edge - The argument edge to check
 * @returns true if the edge represents a conflict
 */
export function isConflictEdge(edge: ArgumentEdge): boolean {
  return edge.type === 'contradicts' || edge.type === 'undermines' || edge.type === 'rebuts';
}

/**
 * Check if an argument edge represents support.
 *
 * @param edge - The argument edge to check
 * @returns true if the edge represents support
 */
export function isSupportEdge(edge: ArgumentEdge): boolean {
  return edge.type === 'supports' || edge.type === 'warrants';
}

/**
 * Check if an argument edge is part of a decision chain.
 *
 * @param edge - The argument edge to check
 * @returns true if the edge is part of a decision chain
 */
export function isDecisionChainEdge(edge: ArgumentEdge): boolean {
  return edge.type === 'supersedes' || edge.type === 'depends_on_decision';
}

/**
 * Subgraph extraction result for focused analysis.
 */
export interface KnowledgeSubgraph {
  nodes: Array<{
    id: string;
    type: KnowledgeGraphEdge['sourceType'];
    label: string;
    properties: Record<string, unknown>;
  }>;
  edges: KnowledgeGraphEdge[];
  metrics: {
    nodeCount: number;
    edgeCount: number;
    density: number;
    avgDegree: number;
  };
}

/**
 * Neuro-symbolic verification result.
 * Based on 2025-2026 research on LLM + symbolic verification.
 */
export interface VerificationResult {
  entityId: string;
  claimType: 'purpose' | 'behavior' | 'constraint' | 'invariant';
  claim: string;
  verified: boolean;
  confidence: number;
  evidence: Array<{
    type: 'static_analysis' | 'runtime_trace' | 'formal_proof' | 'llm_reasoning';
    source: string;
    supports: boolean;
  }>;
  counterexamples?: string[];
  verifiedAt: string;
}

/**
 * Fault localization result for debugging assistance.
 * Based on TokenRepair research (59-70% accuracy).
 */
export interface FaultLocalization {
  id: string;
  failureSignature: string;       // Stack trace or error pattern
  suspiciousEntities: Array<{
    entityId: string;
    entityType: 'function' | 'module' | 'file';
    suspiciousness: number;       // 0-1 probability
    reason: string;
    lineRange?: { start: number; end: number };
  }>;
  methodology: 'spectrum' | 'mutation' | 'llm' | 'hybrid';
  confidence: number;
  computedAt: string;
}

export interface FaultLocalizationQueryOptions {
  failureSignature?: string;
  entityId?: string;
  methodology?: FaultLocalization['methodology'];
  minConfidence?: number;
  limit?: number;
}

// Canonical LiBrainian aliases for migrated modules.
export type LiBrainianStorage = LibrarianStorage;
export type LiBrainianCommit = LibrarianCommit;
