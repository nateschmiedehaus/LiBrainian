// Query API for Librarian.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibrarianStorage, SimilarityResult, QueryCacheEntry, MultiVectorRecord, MultiVectorQueryOptions, StorageCapabilities } from '../storage/types.js';
import type {
  LibrarianQuery,
  LibrarianResponse,
  ContextPack,
  LibrarianVersion,
  LlmRequirement,
  StageName,
  StageReport,
  StageIssue,
  StageIssueSeverity,
  CoverageAssessment,
  QueryPipelineStageDefinition,
  QueryPipelineDefinition,
  QueryStageObserver,
  ConstructionPlan,
} from '../types.js';
import type { CommitRecord } from '../ingest/commit_indexer.js';
import type { OwnershipRecord } from '../ingest/ownership_indexer.js';
import type { AdrRecord } from '../ingest/adr_indexer.js';
import type { TestMapping as IngestTestMapping } from '../ingest/test_indexer.js';
import { LIBRARIAN_VERSION } from '../index.js';
import type { GraphEntityType, GraphMetricsEntry } from '../graphs/metrics.js';
import { buildMetricEmbeddings, findGraphNeighbors } from '../graphs/embeddings.js';
import { EmbeddingService } from './embeddings.js';
import { GovernorContext, estimateTokenCount } from './governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from './governors.js';
import { applyCalibrationToPacks, computeUncertaintyMetrics, getConfidenceCalibration, summarizeCalibration } from './confidence_calibration.js';
import { checkDefeaters, STANDARD_DEFEATERS, type ActivationSummary } from '../knowledge/defeater_activation.js';
import { rankContextPacks } from './packs.js';
import { assembleContextFromResponse, type AgentKnowledgeContext, type ContextAssemblyOptions, type CallEdge, type ImportEdge, type TestMapping, type OwnerMapping, type ChangeContext, type PatternMatch, type KnowledgeSourceRef } from './context_assembly.js';
import type { QueryRunner, SimilarMatch } from './query_interface.js';
import type { EvidenceRef } from './evidence.js';
import { emptyArray, noResult } from './empty_values.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { checkProviderSnapshot, ProviderUnavailableError } from './provider_check.js';
import { checkExtractionSnapshot } from './extraction_gate.js';
import { ensureDailyModelSelection } from '../adapters/model_policy.js';
import { resolveLibrarianModelConfigWithDiscovery } from './llm_env.js';
import type { IngestionItem } from '../ingest/types.js';
import { getIndexState, isReadyPhase, waitForIndexReady } from '../state/index_state.js';
import type { IndexState } from '../state/index_state.js';
import { getWatchState, type WatchState } from '../state/watch_state.js';
import { deriveWatchHealth, type WatchHealth } from '../state/watch_health.js';
import { HierarchicalMemory, type MemoryTier } from '../memory/hierarchical_memory.js';
import { resolveMethodGuidance } from '../methods/method_guidance.js';
import { globalEventBus, createQueryCompleteEvent, createQueryReceivedEvent, createQueryStartEvent, createQueryResultEvent, createQueryErrorEvent } from '../events.js';
import { scoreCandidatesWithMultiSignals } from '../query/scoring.js';
import { deserializeMultiVector, queryMultiVectors, QUERY_TYPE_WEIGHTS, type SerializedMultiVector } from './embedding_providers/multi_vector_representations.js';
import { synthesizeQueryAnswer, canAnswerFromSummaries, createQuickAnswer, type QuerySynthesisResult } from './query_synthesis.js';
import { runAdequacyScan, type AdequacyReport } from './difficulty_detectors.js';
import type { SynthesizedResponse } from '../types.js';
import { calculateStalenessDecay } from '../knowledge/extractors/evidence_collector.js';
import { createQueryVerificationPlan } from './verification_plans.js';
import { saveVerificationPlan } from '../state/verification_plans.js';
import { recordQueryEpisode } from './query_episodes.js';
import { logWarning } from '../telemetry/logger.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';
import { buildConstructionPlan } from './construction_plan.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';
import { createSessionId, REPLAY_UNAVAILABLE_TRACE } from '../epistemics/evidence_ledger.js';
import { collectCorrelationConflictDisclosures } from '../epistemics/event_ledger_bridge.js';
import { getCurrentGitSha } from '../utils/git.js';
export type { LibrarianQuery, LibrarianResponse, ContextPack };

type Candidate = { entityId: string; entityType: GraphEntityType; path?: string; semanticSimilarity: number; confidence: number; recency: number; pagerank: number; centrality: number; communityId: number | null; graphSimilarity?: number; cochange?: number; score?: number; };
type GraphMetricsStore = LibrarianStorage & { getGraphMetrics?: (options?: { entityIds?: string[]; entityType?: GraphEntityType }) => Promise<GraphMetricsEntry[]>; };
type CachedResponse = LibrarianResponse & { explanation?: string; coverageGaps?: string[]; evidenceByPack?: Record<string, EvidenceRef[]> };
type QueryCacheStore = LibrarianStorage & { getQueryCacheEntry?: (queryHash: string) => Promise<QueryCacheEntry | null>; upsertQueryCacheEntry?: (entry: QueryCacheEntry) => Promise<void>; recordQueryCacheAccess?: (queryHash: string) => Promise<void>; pruneQueryCache?: (options: { maxEntries: number; maxAgeMs: number }) => Promise<number>; };

export interface QueryTraceOptions {
  evidenceLedger?: IEvidenceLedger;
  sessionId?: SessionId;
}
const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const SCORE_WEIGHTS = {
  semantic: q(0.35, [0, 1], 'Semantic similarity weight for candidate scoring.'),
  pagerank: q(0.2, [0, 1], 'PageRank weight for candidate scoring.'),
  centrality: q(0.1, [0, 1], 'Graph centrality weight for candidate scoring.'),
  confidence: q(0.2, [0, 1], 'Stored confidence weight for candidate scoring.'),
  recency: q(0.1, [0, 1], 'Recency weight for candidate scoring.'),
  cochange: q(0.05, [0, 1], 'Co-change signal weight for candidate scoring.'),
};
const MULTI_VECTOR_BLEND_WEIGHT = q(0.18, [0, 1], 'Blend weight for multi-vector reranking.');
const MIN_SIMILARITY_MVP = q(0.35, [0, 1], 'Minimum semantic similarity for MVP retrieval.');
const MIN_SIMILARITY_FULL = q(0.45, [0, 1], 'Minimum semantic similarity for full retrieval.');
const EMBEDDING_QUERY_MIN_SIMILARITY = q(
  0.35,
  [0, 1],
  'Minimum similarity for query embedding search.'
);
const GRAPH_NEIGHBOR_MIN_SIMILARITY = q(
  0.55,
  [0, 1],
  'Minimum similarity for graph neighbor expansion.'
);
const FALLBACK_MIN_CONFIDENCE_MVP = q(
  0.45,
  [0, 1],
  'Fallback minimum confidence for MVP packs.'
);
const FALLBACK_MIN_CONFIDENCE_FULL = q(
  0.7,
  [0, 1],
  'Fallback minimum confidence for full packs.'
);
const DEFAULT_MIN_CONFIDENCE = q(0.3, [0, 1], 'Default minimum confidence for pack retrieval.');
const CANDIDATE_SCORE_FLOOR = q(0.85, [0, 1], 'Fallback candidate score floor.');
const CONFIDENCE_ADJUSTMENT_FLOOR = q(
  0.1,
  [0, 1],
  'Minimum confidence after summary adjustments.'
);
const COVERAGE_BASE_OFFSET = q(0.2, [0, 1], 'Baseline coverage offset when packs exist.');
const COVERAGE_PACK_DIVISOR = q(12, [1, 100], 'Pack count divisor for coverage estimation.');
const COVERAGE_GAP_PENALTY_MAX = q(0.4, [0, 1], 'Maximum penalty for coverage gaps.');
const COVERAGE_GAP_PENALTY_STEP = q(0.04, [0, 1], 'Penalty per coverage gap.');
const COVERAGE_TOTAL_CONFIDENCE_WEIGHT = q(
  0.4,
  [0, 1],
  'Weight for total confidence in coverage estimation.'
);
const COVERAGE_SUCCESS_RATIO_WEIGHT = q(
  0.2,
  [0, 1],
  'Weight for successful stages in coverage estimation.'
);
const COVERAGE_FAILED_COUNT_WEIGHT = q(
  0.1,
  [0, 1],
  'Penalty weight per failed stage in coverage estimation.'
);
const COVERAGE_CONFIDENCE_BASE = q(0.2, [0, 1], 'Baseline coverage confidence.');
const COVERAGE_CONFIDENCE_SUCCESS_WEIGHT = q(
  0.6,
  [0, 1],
  'Weight for successful stages in coverage confidence.'
);
const COVERAGE_CONFIDENCE_FAILED_WEIGHT = q(
  0.1,
  [0, 1],
  'Penalty weight per failed stage in coverage confidence.'
);
const KNOWLEDGE_SCORE_FALLBACK = q(
  0.5,
  [0, 1],
  'Fallback knowledge source score for low-signal sources.'
);
const KNOWLEDGE_CONFIDENCE_MIN = q(
  0.35,
  [0, 1],
  'Minimum confidence for knowledge source scoring.'
);
const KNOWLEDGE_CONFIDENCE_MAX = q(
  0.9,
  [0, 1],
  'Maximum confidence for knowledge source scoring.'
);
const KNOWLEDGE_CONFIDENCE_BASE = q(
  0.4,
  [0, 1],
  'Base confidence offset for knowledge sources.'
);
const KNOWLEDGE_CONFIDENCE_SLOPE = q(
  0.05,
  [0, 1],
  'Confidence slope per relevance point for knowledge sources.'
);
const ENTITY_CONFIDENCE_FALLBACK = q(0.4, [0, 1], 'Fallback confidence for missing entity stats.');
const ENTITY_RECENCY_DEFAULT = q(0.5, [0, 1], 'Default recency for entities without timestamps.');
const ENTITY_RECENCY_FALLBACK = q(0.4, [0, 1], 'Fallback recency when entity stats are missing.');
const RECENCY_DECAY_DAYS = q(30, [1, 365], 'Recency decay window in days.');
const BLEND_WEIGHT_MIN = q(0.05, [0, 1], 'Minimum blend weight for rescoring.');
const BLEND_WEIGHT_MAX = q(0.9, [0, 1], 'Maximum blend weight for rescoring.');
const CROSS_ENCODER_BI_WEIGHT = q(0.4, [0, 1], 'Bi-encoder weight for hybrid rerank.');
const CROSS_ENCODER_CROSS_WEIGHT = q(0.6, [0, 1], 'Cross-encoder weight for hybrid rerank.');
const INDEX_CONFIDENCE_CAP_MIN = q(0.1, [0, 1], 'Minimum confidence cap during indexing.');
const INDEX_CONFIDENCE_CAP_MAX = q(0.5, [0, 1], 'Maximum confidence cap during indexing.');
const INDEX_CONFIDENCE_CAP_SCALE = q(0.5, [0, 1], 'Scale factor for indexing confidence cap.');
const INDEX_CONFIDENCE_CAP_FALLBACK = q(0.3, [0, 1], 'Fallback confidence cap when progress unknown.');
const HINT_LOW_CONFIDENCE_THRESHOLD = q(
  0.5,
  [0, 1],
  'Hint threshold for low-confidence results.'
);

const QUERY_PIPELINE_STAGES: QueryPipelineStageDefinition[] = [
  {
    stage: 'adequacy_scan',
    description: 'Detect adequacy gaps and difficulty signals before retrieval.',
    requires: ['intent'],
    produces: ['adequacyReport'],
  },
  {
    stage: 'direct_packs',
    description: 'Collect packs tied to explicitly affected files.',
    requires: ['affectedFiles'],
    produces: ['directPacks'],
  },
  {
    stage: 'semantic_retrieval',
    description: 'Embed intent and retrieve semantically similar entities.',
    requires: ['intent', 'embeddings'],
    produces: ['semanticCandidates'],
  },
  {
    stage: 'graph_expansion',
    description: 'Expand candidates using graph metrics and neighborhood traversal.',
    requires: ['semanticCandidates', 'graphMetrics'],
    produces: ['expandedCandidates'],
  },
  {
    stage: 'multi_signal_scoring',
    description: 'Score candidates using multiple relevance signals.',
    requires: ['candidates'],
    produces: ['scoredCandidates'],
  },
  {
    stage: 'multi_vector_scoring',
    description: 'Apply multi-vector scoring to module candidates when supported.',
    requires: ['moduleCandidates', 'multiVectors'],
    produces: ['rescoredCandidates'],
  },
  {
    stage: 'fallback',
    description: 'Fallback to alternate retrieval when candidates are sparse.',
    requires: ['directPacks', 'recentHistory'],
    produces: ['fallbackPacks'],
  },
  {
    stage: 'reranking',
    description: 'Rerank packs using secondary relevance signals.',
    requires: ['packs'],
    produces: ['rerankedPacks'],
  },
  {
    stage: 'defeater_check',
    description: 'Remove packs invalidated by defeater rules.',
    requires: ['packs', 'defeaterRules'],
    produces: ['validatedPacks'],
  },
  {
    stage: 'method_guidance',
    description: 'Infer method guidance and hints from retrieved context.',
    requires: ['intent', 'packs'],
    produces: ['methodHints'],
  },
  {
    stage: 'synthesis',
    description: 'Generate LLM synthesis over the final packs.',
    requires: ['llm', 'packs'],
    produces: ['synthesis'],
  },
  {
    stage: 'post_processing',
    description: 'Finalize response payload and cache entries.',
    requires: ['response'],
    produces: ['response'],
  },
];

function clonePipelineStages(): QueryPipelineStageDefinition[] {
  return QUERY_PIPELINE_STAGES.map((stage) => ({
    ...stage,
    requires: [...stage.requires],
    produces: [...stage.produces],
  }));
}

export function getQueryPipelineDefinition(): QueryPipelineDefinition {
  return { stages: clonePipelineStages() };
}

export function getQueryPipelineStages(): QueryPipelineStageDefinition[] {
  return clonePipelineStages();
}
/**
 * Queries the librarian knowledge base to retrieve relevant context packs.
 *
 * This is the primary API for retrieving knowledge from the indexed codebase.
 * It combines multiple retrieval strategies:
 * - Semantic search via embeddings
 * - Graph-based retrieval (PageRank, centrality, co-change patterns)
 * - Confidence calibration to prioritize reliable context
 * - Response caching for performance
 *
 * @param query - The query specification containing intent, depth, affected files, and task type
 * @param storage - The storage backend (typically SQLite) containing indexed knowledge
 * @param embeddingService - Optional embedding service for semantic search (uses default if not provided)
 * @param governorContext - Optional governor context for resource/budget tracking
 * @returns A response containing ranked context packs, reasoning, and metadata
 * @throws CliError if providers are unavailable or storage has no indexed data
 *
 * @example
 * ```typescript
 * const response = await queryLibrarian({
 *   intent: 'authentication flow',
 *   depth: 'L2',
 *   affectedFiles: ['src/auth/login.ts'],
 *   taskType: 'feature'
 * }, storage);
 *
 * for (const pack of response.packs) {
 *   console.log(pack.packType, pack.relatedFiles);
 * }
 * ```
 */
export async function queryLibrarian(
  query: LibrarianQuery,
  storage: LibrarianStorage,
  embeddingService: EmbeddingService = defaultEmbeddingService,
  governorContext?: GovernorContext,
  onStage?: QueryStageObserver,
  traceOptions: QueryTraceOptions = {}
): Promise<LibrarianResponse> {
  const startTime = Date.now();
  let errorQueryId: string = randomUUID(); // Used for error tracking if query fails early
  const explanationParts: string[] = [];
  const coverageGaps: string[] = [];
  let adequacyReport: AdequacyReport | null = null;
  const disclosures: string[] = [];
  let traceSessionId: SessionId | undefined;
  let traceId: string = REPLAY_UNAVAILABLE_TRACE;
  let constructionPlan: ConstructionPlan = {
    id: `cp_${randomUUID()}`,
    templateId: 'T1',
    ucIds: query.ucRequirements?.ucIds ?? [],
    intent: query.intent ?? '',
    source: 'default',
    createdAt: new Date().toISOString(),
  };
  try {
    traceSessionId = traceOptions.evidenceLedger ? (traceOptions.sessionId ?? createSessionId()) : undefined;
    traceId = traceSessionId ?? REPLAY_UNAVAILABLE_TRACE;
    if (!traceSessionId) {
      disclosures.push(`${REPLAY_UNAVAILABLE_TRACE}: Evidence ledger unavailable for this query.`);
    }
    const stageObserver = normalizeStageObserver(
      traceOptions.evidenceLedger && traceSessionId
        ? (report: StageReport) => {
            void appendStageEvidence(traceOptions.evidenceLedger!, traceSessionId!, report);
            onStage?.(report);
          }
        : onStage
    );
    const workspaceRoot = await resolveWorkspaceRoot(storage);
    const extractionSnapshot = await checkExtractionSnapshot({
      workspaceRoot,
      ledger: traceOptions.evidenceLedger,
      sessionId: traceSessionId,
    });
    disclosures.push(...extractionSnapshot.disclosures);
    const { plan, disclosures: planDisclosures } = await buildConstructionPlan(query, workspaceRoot);
    constructionPlan = plan;
    disclosures.push(...planDisclosures);
    if (traceOptions.evidenceLedger && traceSessionId) {
      void appendConstructionPlanEvidence(traceOptions.evidenceLedger, traceSessionId, constructionPlan);
    }
    const envDisableSynthesis =
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS === '1' ||
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS === 'true';
    const llmRequirement: LlmRequirement = envDisableSynthesis ? 'disabled' : (query.llmRequirement ?? 'required');
    let llmAvailable = llmRequirement === 'required';
    query = { ...query, llmRequirement };
    const capabilities = resolveStorageCapabilities(storage);
  const stageTracker = createStageTracker(stageObserver);
    const recordCoverageGap: RecordCoverageGap = (stage, message, severity = 'moderate', remediation) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity, remediation });
    };

    adequacyReport = runAdequacyScanStage({
      query,
      workspaceRoot,
      stageTracker,
      recordCoverageGap,
    });

    const providerSnapshot = await checkProviderSnapshot({
      workspaceRoot,
      ledger: traceOptions.evidenceLedger,
      sessionId: traceSessionId,
    });

    const { disclosures: watchDisclosures, health: watchHealth, state: watchState } = await buildWatchDisclosures({
      storage,
      workspaceRoot,
    });
    if (watchDisclosures.length) {
      disclosures.push(...watchDisclosures);
      recordCoverageGap(
        'post_processing',
        watchDisclosures.join('; '),
        'moderate',
        'Ensure watch mode is healthy or re-run bootstrap for fresh indexing.'
      );
    }
    const embeddingProviderReady = providerSnapshot.status.embedding.available;
    const llmProviderReady = providerSnapshot.status.llm.available;
    const hasDirectAnchors = Boolean(query.affectedFiles?.length);
    const wantsSemanticRetrieval = Boolean(query.intent) && query.depth !== 'L0';
    const embeddingsRequired = wantsSemanticRetrieval && !hasDirectAnchors;

    if (llmRequirement === 'required' && !llmProviderReady) {
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): LLM provider unavailable',
        missing: [`LLM: ${providerSnapshot.status.llm.error ?? 'unavailable'}`],
        suggestion:
          providerSnapshot.remediationSteps.join(' ') ||
          providerSnapshot.reason ||
          'Authenticate providers via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`).',
      });
    }
    if (embeddingsRequired && !embeddingProviderReady) {
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): Embedding provider unavailable',
        missing: [`Embedding: ${providerSnapshot.status.embedding.error ?? 'unavailable'}`],
        suggestion:
          providerSnapshot.remediationSteps.join(' ') ||
          providerSnapshot.reason ||
          'Install embedding providers (xenova/transformers) or configure sentence-transformers.',
      });
    }

    if (llmRequirement === 'optional') {
      llmAvailable = llmProviderReady;
      if (!llmAvailable) {
        recordCoverageGap(
          'synthesis',
          `LLM unavailable: ${providerSnapshot.status.llm.error ?? 'not configured'}.`,
          'moderate',
          'Authenticate a live LLM provider (Claude: `claude setup-token` or run `claude`; Codex: `codex login`).'
        );
        disclosures.push(
          `unverified_by_trace(llm_unavailable): ${providerSnapshot.status.llm.error ?? 'LLM provider unavailable'}`
        );
      }
    } else if (llmRequirement === 'disabled') {
      llmAvailable = false;
      recordCoverageGap('synthesis', 'LLM disabled by request.', 'minor');
      disclosures.push('unverified_by_trace(llm_disabled): LLM synthesis disabled by request.');
    }

    const embeddingsAvailable = embeddingProviderReady && capabilities.optional.embeddings;
    if (wantsSemanticRetrieval && !embeddingsAvailable) {
      const reason = capabilities.optional.embeddings
        ? providerSnapshot.status.embedding.error ?? 'Embedding provider unavailable'
        : 'Embedding retrieval unsupported by storage';
      recordCoverageGap('semantic_retrieval', reason, 'significant');
      disclosures.push(`unverified_by_trace(embedding_unavailable): ${reason}`);
    }

    const synthesisEnabled = llmRequirement !== 'disabled' && llmAvailable;

    if (synthesisEnabled) {
      const defaultProvider = process.env.LIBRARIAN_LLM_PROVIDER === 'codex' ? 'codex' : 'claude';
      await ensureDailyModelSelection(workspaceRoot, {
        defaultProvider,
        applyEnv: true,
        respectExistingEnv: true,
      });
    }

    // FAIL-FAST: Verify storage has indexed data before running queries
    // If bootstrap ran but indexed nothing, queries will return empty/useless results
    const stats = await storage.getStats();
    if (stats.totalFunctions === 0 && stats.totalModules === 0) {
      throw new Error(
        'unverified_by_trace(empty_storage): Cannot query librarian - no functions or modules indexed. ' +
        'Bootstrap may have failed silently or was not run. Run bootstrapProject() first with valid LLM/embedding providers configured.'
      );
    }

  let queryEmbedding: Float32Array | null = null;
  const governor = governorContext ?? new GovernorContext({ phase: 'query', config: DEFAULT_GOVERNOR_CONFIG }); governor.checkBudget();
  const version = await storage.getVersion() || getCurrentVersion();
  let indexState = await getIndexState(storage);
  if (query.waitForIndexMs && !isReadyPhase(indexState.phase)) {
    indexState = await waitForIndexReady(storage, { timeoutMs: query.waitForIndexMs });
  }
  const allowCache = isReadyPhase(indexState.phase);
  const cacheKey = allowCache ? buildQueryCacheKey(query, version, llmRequirement, synthesisEnabled) : '';
  if (allowCache) {
    const cache = getQueryCache(storage);
    const cached = await cache.get(cacheKey);
    if (cached) {
      const queryId = cacheKey || randomUUID();
      errorQueryId = queryId;
      void globalEventBus.emit(createQueryReceivedEvent(queryId, query.intent ?? '', query.depth ?? 'L1', traceSessionId));
      const cachedResponse = {
        ...cached,
        cacheHit: true,
        latencyMs: Date.now() - startTime,
        version,
        traceId,
        disclosures,
        constructionPlan,
      } as CachedResponse;
      const cacheStore = storage as QueryCacheStore;
      if (cacheStore.recordQueryCacheAccess) {
        await cacheStore.recordQueryCacheAccess(cacheKey);
      }
      for (const pack of cachedResponse.packs) await storage.recordContextPackAccess(pack.packId);
      void globalEventBus.emit(createQueryCompleteEvent(queryId, cachedResponse.packs.length, true, cachedResponse.latencyMs, traceSessionId));
      if (traceOptions.evidenceLedger && traceSessionId) {
        void appendQueryEvidence(traceOptions.evidenceLedger, traceSessionId, 'query_start', {
          queryId,
          cacheKey,
          intent: query.intent ?? '',
          depth: query.depth ?? 'L1',
        });
        void appendQueryEvidence(traceOptions.evidenceLedger, traceSessionId, 'query_cache_hit', {
          queryId,
          cacheKey,
          packCount: cachedResponse.packs.length,
          latencyMs: cachedResponse.latencyMs,
          templateId: constructionPlan.templateId,
        });
      }
      return cachedResponse;
    }
  }
  const queryId = allowCache && cacheKey ? cacheKey : randomUUID();
  errorQueryId = queryId; // Update for error tracking
  void globalEventBus.emit(createQueryReceivedEvent(queryId, query.intent ?? '', query.depth ?? 'L1', traceSessionId));
  void globalEventBus.emit(createQueryStartEvent(queryId, query.intent ?? '', query.depth ?? 'L1', traceSessionId));
  if (traceOptions.evidenceLedger && traceSessionId) {
    void appendQueryEvidence(traceOptions.evidenceLedger, traceSessionId, 'query_start', {
      queryId,
      cacheKey,
      intent: query.intent ?? '',
      depth: query.depth ?? 'L1',
    });
  }
  const directStageResult = await runDirectPacksStage({
    storage,
    query,
    stageTracker,
    explanationParts,
  });
  let cacheHit = directStageResult.cacheHit;
  const directPacks = directStageResult.directPacks;
  const semanticResult = await runSemanticRetrievalStage({
    storage,
    query,
    embeddingService,
    governor,
    stageTracker,
    recordCoverageGap,
    capabilities,
    version,
    embeddingAvailable: embeddingsAvailable,
  });
  queryEmbedding = semanticResult.queryEmbedding;
  let candidates = semanticResult.candidates;
  candidates = await runGraphExpansionStage({
    storage,
    query,
    candidates,
    stageTracker,
    recordCoverageGap,
    capabilities,
    explanationParts,
    directPacks,
  });
  const scoringResult = await runScoringStage({
    storage,
    query,
    candidates,
    queryEmbedding,
    stageTracker,
    recordCoverageGap,
    capabilities,
    explanationParts,
  });
  candidates = scoringResult.candidates;
  const candidateScoreMap = scoringResult.candidateScoreMap;
  const packStageResult = await runCandidatePackStage({
    storage,
    query,
    candidates,
    directPacks,
    candidateScoreMap,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    version,
  });
  const ranked = rankContextPacks({
    packs: packStageResult.allPacks,
    scoreByTarget: candidateScoreMap,
    maxPacks: 10,
    taskType: query.taskType,
    depth: query.depth,
  });
  let finalPacks = ranked.packs;
  finalPacks = await runRerankStage({
    query,
    finalPacks,
    candidateScoreMap,
    stageTracker,
    explanationParts,
    recordCoverageGap,
  });
  const calibration = await getConfidenceCalibration(storage);
  finalPacks = applyCalibrationToPacks(finalPacks, calibration);

  finalPacks = await runDefeaterStage({
    storage,
    finalPacks,
    stageTracker,
    recordCoverageGap,
    workspaceRoot,
  });

  // VISION REQUIREMENT: Apply staleness-based confidence decay
  // Knowledge confidence decreases over time at domain-specific rates
  // IMPORTANT: Create copies to avoid mutating cached/shared packs
  finalPacks = finalPacks.map(pack => {
    // Validate createdAt is a Date instance before calling toISOString
    if (pack.createdAt && pack.createdAt instanceof Date) {
      const sections = inferPackSections(pack.packType);
      const decayedConfidence = calculateStalenessDecay(
        pack.createdAt.toISOString(),
        sections,
        pack.confidence
      );
      // Guard against NaN - use original confidence if decay calculation fails
      if (!isNaN(decayedConfidence) && decayedConfidence < pack.confidence) {
        return { ...pack, confidence: decayedConfidence };
      }
    }
    return pack;
  });

  // Use geometric mean for totalConfidence per VISION
  let totalConfidence = finalPacks.length
    ? Math.exp(finalPacks.reduce((sum, p) => sum + Math.log(Math.max(0.01, p.confidence)), 0) / finalPacks.length)
    : 0;
  const indexAssessment = assessIndexState(indexState);
  if (indexAssessment.confidenceCap !== null) {
    totalConfidence = Math.min(totalConfidence, indexAssessment.confidenceCap);
  }
  const drillDownHints = generateDrillDownHints(finalPacks, query); const explanation = buildExplanation(explanationParts, ranked.averageScore, candidates.length);
  let methodGuidance = await runMethodGuidanceStage({
    query,
    storage,
    governor,
    stageTracker,
    recordCoverageGap,
    synthesisEnabled,
  });
  if (methodGuidance?.hints.length) {
    drillDownHints.push(...methodGuidance.hints);
  }
  if (indexAssessment.warning) {
    recordCoverageGap('post_processing', indexAssessment.warning, 'moderate');
    drillDownHints.push(indexAssessment.warning);
  }
  if (explanation) drillDownHints.unshift(`Why these results: ${explanation}`);
  if (coverageGaps.length) drillDownHints.push(`Coverage gaps: ${coverageGaps.join('; ')}`);
  if (adequacyReport?.missingEvidence.length) {
    const gaps = adequacyReport.missingEvidence.map((req) => req.description).join('; ');
    drillDownHints.push(`Adequacy gaps: ${gaps}`);
    disclosures.push(`unverified_by_trace(adequacy_missing): ${gaps}`);
  }
  const evidenceByPack: Record<string, EvidenceRef[]> = {}; const evidenceStore = storage as LibrarianStorage & { getEvidenceForTarget?: (entityId: string, entityType: 'function' | 'module') => Promise<EvidenceRef[]> };
  if (evidenceStore.getEvidenceForTarget) {
    for (const pack of finalPacks) {
      const entityType = resolveEvidenceEntityType(pack); if (!entityType) continue;
      const evidence = await evidenceStore.getEvidenceForTarget(pack.targetId, entityType); if (evidence.length) evidenceByPack[pack.packId] = evidence;
    }
  }
  for (const pack of finalPacks) await storage.recordContextPackAccess(pack.packId);

  // VISION REQUIREMENT: Synthesize understanding from retrieved knowledge
  // LLM synthesis is mandatory when LLM is available
  let synthesis = await runSynthesisStage({
    query,
    storage,
    finalPacks,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    synthesisEnabled,
    workspaceRoot,
  });
  synthesis = applyAdequacyToSynthesis(synthesis, adequacyReport);

  const postProcessingStage = stageTracker.start('post_processing', 1);
  const verificationPlan = createQueryVerificationPlan({
    query,
    packs: finalPacks,
    coverageGaps,
    synthesis,
    adequacyReport,
  });
  if (verificationPlan) {
    try {
      await saveVerificationPlan(storage, verificationPlan, { adequacyReport });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCoverageGap('post_processing', `Verification plan save failed: ${message}`, 'minor');
    }
  }

  // Generate unique feedbackToken for this query (CONTROL_LOOP.md feedback loop)
  const feedbackToken = `fbk_${randomUUID()}`;

  // Store feedback context for later attribution
  storeFeedbackContext({
    feedbackToken,
    packIds: finalPacks.map(p => p.packId),
    queryIntent: query.intent ?? '',
    queryDepth: query.depth ?? 'L1',
    createdAt: new Date().toISOString(),
  });

  const response = {
    query,
    packs: finalPacks,
    disclosures,
    verificationPlan: verificationPlan ?? undefined,
    adequacy: adequacyReport ?? undefined,
    traceId,
    constructionPlan,
    totalConfidence,
    calibration: summarizeCalibration(calibration),
    uncertainty: computeUncertaintyMetrics(totalConfidence),
    cacheHit,
    latencyMs: Date.now() - startTime,
    version,
    llmRequirement,
    llmAvailable,
    drillDownHints,
    methodHints: methodGuidance?.hints,
    methodFamilies: methodGuidance?.families,
    methodHintSource: methodGuidance?.source,
    synthesis,
    feedbackToken,
  } as CachedResponse;
  response.explanation = explanation || undefined;
  response.coverageGaps = coverageGaps.length ? coverageGaps : undefined;
  response.evidenceByPack = Object.keys(evidenceByPack).length ? evidenceByPack : undefined;
  try {
    await recordQueryEpisode(storage, { query, response, durationMs: response.latencyMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCoverageGap('post_processing', `Episode record failed: ${message}`, 'minor');
    response.coverageGaps = coverageGaps;
  }
  stageTracker.finish(postProcessingStage, { outputCount: 1, filteredCount: 0 });
  stageTracker.finalizeMissing([
    'adequacy_scan',
    'direct_packs',
    'semantic_retrieval',
    'graph_expansion',
    'multi_signal_scoring',
    'multi_vector_scoring',
    'reranking',
    'defeater_check',
    'synthesis',
    'fallback',
    'method_guidance',
    'post_processing',
  ]);
  const stageReports = stageTracker.report();
  const coverage = buildCoverageAssessment({
    stageReports,
    totalConfidence,
    packCount: finalPacks.length,
    coverageGaps,
  });
  response.stages = stageReports;
  response.coverage = coverage;
  if (traceOptions.evidenceLedger && traceSessionId) {
    const conflictDisclosures = await collectCorrelationConflictDisclosures(
      traceOptions.evidenceLedger,
      traceSessionId
    );
    if (conflictDisclosures.length) {
      disclosures.push(...conflictDisclosures);
    }
  }
  if (allowCache) {
    await setCachedQuery(cacheKey, response, storage, query);
  }
  void globalEventBus.emit(createQueryCompleteEvent(queryId, response.packs.length, cacheHit, response.latencyMs, traceSessionId));
  void globalEventBus.emit(createQueryResultEvent(queryId, response.packs.length, response.totalConfidence, response.latencyMs, traceSessionId));
  if (traceOptions.evidenceLedger && traceSessionId) {
    void appendQueryEvidence(traceOptions.evidenceLedger, traceSessionId, 'query_complete', {
      queryId,
      cacheKey,
      packCount: response.packs.length,
      latencyMs: response.latencyMs,
      templateId: constructionPlan.templateId,
      cacheHit,
    });
  }
  return response;
  } catch (error) {
    // Emit query_error event when query fails
    const errorMessage = error instanceof Error ? error.message : String(error);
    void globalEventBus.emit(createQueryErrorEvent(errorQueryId, errorMessage, traceSessionId));
    if (traceOptions.evidenceLedger && traceSessionId) {
      void appendQueryEvidence(traceOptions.evidenceLedger, traceSessionId, 'query_error', {
        queryId: errorQueryId,
        errorMessage,
      });
    }
    throw error;
  }
}

export async function queryLibrarianWithObserver(
  query: LibrarianQuery,
  storage: LibrarianStorage,
  options: {
    embeddingService?: EmbeddingService;
    governorContext?: GovernorContext;
    onStage?: QueryStageObserver;
    traceOptions?: QueryTraceOptions;
  } = {}
): Promise<LibrarianResponse> {
  return queryLibrarian(
    query,
    storage,
    options.embeddingService ?? defaultEmbeddingService,
    options.governorContext,
    options.onStage,
    options.traceOptions
  );
}

/**
 * Assemble an AgentKnowledgeContext (L0-L3) from a Librarian query response.
 * Uses the same query pipeline and emits context packs ordered by confidence.
 */
export async function assembleContext(query: LibrarianQuery, storage: LibrarianStorage, embeddingService: EmbeddingService = defaultEmbeddingService, governorContext?: GovernorContext, options: ContextAssemblyOptions = {}): Promise<AgentKnowledgeContext> {
  const governor = governorContext ?? new GovernorContext({ phase: 'context_assembly', config: DEFAULT_GOVERNOR_CONFIG }); const response = await queryLibrarian(query, storage, embeddingService, governor);
  const runner: QueryRunner = { query: (nextQuery) => queryLibrarian(nextQuery, storage, embeddingService, governor), searchSimilar: (snippet, limit) => searchSimilarWithEmbedding(snippet, limit ?? 8, storage, embeddingService, governor) };
  const graph = await collectGraphContext(storage, response);
  const ingestionContext = await collectIngestionContext(storage, response, options.workspace, query);
  const supplementary = mergeSupplementaryContext(options.supplementary, {
    recentChanges: ingestionContext.recentChanges,
    patterns: ingestionContext.patterns,
    knowledgeSources: ingestionContext.knowledgeSources,
  });
  return assembleContextFromResponse(response, {
    ...options,
    queryRunner: runner,
    graph: {
      ...graph,
      testMapping: ingestionContext.testMapping,
      ownerMapping: ingestionContext.ownerMapping,
    },
    supplementary,
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const defaultEmbeddingService = new EmbeddingService();
const EMBEDDING_CACHE_LIMIT = 64;
const embeddingCache = new WeakMap<EmbeddingService, Map<string, Float32Array>>();
const QUERY_CACHE_TTL_L1_MS = 5 * 60 * 1000;
const QUERY_CACHE_TTL_L2_MS = 30 * 60 * 1000;
const QUERY_CACHE_L1_LIMIT = 100;
const QUERY_CACHE_L2_LIMIT = 1000;
const queryCacheByStorage = new WeakMap<LibrarianStorage, HierarchicalMemory<CachedResponse>>();

// ============================================================================
// FEEDBACK CONTEXT STORAGE (CONTROL_LOOP.md feedback loop)
// ============================================================================

/**
 * Feedback context - stores mapping from feedbackToken to query pack IDs.
 * Used to attribute feedback to the correct context packs.
 */
export interface FeedbackContext {
  feedbackToken: string;
  packIds: string[];
  queryIntent: string;
  queryDepth: string;
  createdAt: string;
}

const FEEDBACK_CONTEXT_LIMIT = 500;
const FEEDBACK_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const feedbackContextCache = new Map<string, FeedbackContext>();

/**
 * Store feedback context for a query result.
 * Called internally when generating feedbackToken.
 */
function storeFeedbackContext(context: FeedbackContext): void {
  feedbackContextCache.set(context.feedbackToken, context);

  // Prune old entries if over limit
  if (feedbackContextCache.size > FEEDBACK_CONTEXT_LIMIT) {
    const now = Date.now();
    const entries = Array.from(feedbackContextCache.entries());

    // Remove expired entries first
    for (const [token, ctx] of entries) {
      if (now - new Date(ctx.createdAt).getTime() > FEEDBACK_CONTEXT_TTL_MS) {
        feedbackContextCache.delete(token);
      }
    }

    // If still over limit, remove oldest entries
    if (feedbackContextCache.size > FEEDBACK_CONTEXT_LIMIT) {
      const sorted = entries.sort((a, b) =>
        new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime()
      );
      const toRemove = sorted.slice(0, feedbackContextCache.size - FEEDBACK_CONTEXT_LIMIT);
      for (const [token] of toRemove) {
        feedbackContextCache.delete(token);
      }
    }
  }
}

type StageContext = { stage: StageName; startedAt: number; inputCount: number; issues: StageIssue[] };
type RecordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity, remediation?: string) => void;
type StageTracker = ReturnType<typeof createStageTracker>;

function runAdequacyScanStage(options: {
  query: LibrarianQuery;
  workspaceRoot: string;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  runAdequacyScanFn?: typeof runAdequacyScan;
}): AdequacyReport | null {
  const {
    query,
    workspaceRoot,
    stageTracker,
    recordCoverageGap,
    runAdequacyScanFn,
  } = options;
  const shouldRun = Boolean(query.intent && query.intent.trim());
  const stage = stageTracker.start('adequacy_scan', shouldRun ? 1 : 0);
  if (!shouldRun) {
    stageTracker.finish(stage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
    return null;
  }
  try {
    const scan = (runAdequacyScanFn ?? runAdequacyScan)({
      intent: query.intent,
      taskType: query.taskType,
      workspaceRoot,
    });
    if (scan.missingEvidence.length > 0) {
      const missing = scan.missingEvidence.map((req) => req.description).join('; ');
      const remediation = scan.evidenceCommands.length
        ? `Collect evidence: ${scan.evidenceCommands.join(' | ')}`
        : undefined;
      recordCoverageGap('adequacy_scan', `Missing adequacy evidence: ${missing}`, scan.blocking ? 'significant' : 'moderate', remediation);
    }
    for (const difficulty of scan.difficulties) {
      const severity: StageIssueSeverity =
        difficulty.severity === 'extreme' || difficulty.severity === 'hard'
          ? 'significant'
          : difficulty.severity === 'medium'
            ? 'moderate'
            : 'minor';
      stageTracker.issue('adequacy_scan', {
        message: `Difficulty detected: ${difficulty.name}`,
        severity,
        remediation: difficulty.evidenceCommands.length
          ? `Evidence commands: ${difficulty.evidenceCommands.join(' | ')}`
          : undefined,
      });
    }
    const status = scan.missingEvidence.length > 0
      ? (scan.blocking ? 'failed' : 'partial')
      : 'success';
    stageTracker.finish(stage, { outputCount: 1, filteredCount: 0, status });
    return scan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCoverageGap('adequacy_scan', `Adequacy scan failed: ${message}`, 'moderate');
    stageTracker.finish(stage, { outputCount: 0, filteredCount: 0, status: 'failed' });
    return null;
  }
}

function normalizeStageObserver(value: unknown): QueryStageObserver | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'function') {
    throw new TypeError('onStage must be a function');
  }
  return value as QueryStageObserver;
}

function cloneStageReport(report: StageReport): StageReport {
  return {
    ...report,
    results: { ...report.results },
    issues: report.issues.map((issue) => ({ ...issue })),
  };
}

function notifyStageObserver(onStage: QueryStageObserver | undefined, report: StageReport): void {
  if (!onStage) {
    return;
  }
  const snapshot = cloneStageReport(report);
  try {
    onStage(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning('Query stage observer failed', { stage: report.stage, error: message });
  }
}

function createStageTracker(onStage?: QueryStageObserver) {
  const stages: StageReport[] = [];
  const active = new Map<StageName, StageContext>();
  const pendingIssues = new Map<StageName, StageIssue[]>();
  const reported = new Set<StageName>();

  const issue = (stage: StageName, nextIssue: StageIssue): void => {
    const current = active.get(stage);
    if (current) {
      current.issues.push(nextIssue);
      return;
    }
    const queued = pendingIssues.get(stage) ?? [];
    queued.push(nextIssue);
    pendingIssues.set(stage, queued);
  };

  const start = (stage: StageName, inputCount: number): StageContext => {
    const queued = pendingIssues.get(stage) ?? [];
    pendingIssues.delete(stage);
    const context = { stage, startedAt: Date.now(), inputCount, issues: [...queued] };
    active.set(stage, context);
    return context;
  };

  const finish = (context: StageContext, options: { outputCount: number; filteredCount?: number; status?: StageReport['status'] }): StageReport => {
    active.delete(context.stage);
    const filteredCount = options.filteredCount ?? Math.max(0, context.inputCount - options.outputCount);
    const status = options.status ?? deriveStageStatus(context.inputCount, options.outputCount, context.issues.length);
    const report: StageReport = {
      stage: context.stage,
      status,
      results: {
        inputCount: context.inputCount,
        outputCount: options.outputCount,
        filteredCount,
      },
      issues: context.issues,
      durationMs: Math.max(0, Date.now() - context.startedAt),
    };
    stages.push(report);
    reported.add(context.stage);
    notifyStageObserver(onStage, report);
    return report;
  };

  const finalizeMissing = (stageNames: StageName[]): void => {
    for (const stage of stageNames) {
      if (reported.has(stage)) continue;
      const queued = pendingIssues.get(stage) ?? [];
      pendingIssues.delete(stage);
      const report: StageReport = {
        stage,
        status: 'skipped',
        results: { inputCount: 0, outputCount: 0, filteredCount: 0 },
        issues: queued,
        durationMs: 0,
      };
      stages.push(report);
      reported.add(stage);
      notifyStageObserver(onStage, report);
    }
  };

  return {
    start,
    finish,
    issue,
    finalizeMissing,
    report: () => stages.slice(),
  };
}

function deriveStageStatus(inputCount: number, outputCount: number, issueCount: number): StageReport['status'] {
  if (inputCount === 0) return 'skipped';
  if (outputCount === 0) return issueCount > 0 ? 'failed' : 'partial';
  if (issueCount > 0) return 'partial';
  return 'success';
}

function buildCoverageAssessment(options: {
  stageReports: StageReport[];
  totalConfidence: number;
  packCount: number;
  coverageGaps: string[];
}): CoverageAssessment {
  const { stageReports, totalConfidence, packCount, coverageGaps } = options;
  const stageCount = Math.max(1, stageReports.length);
  const successCount = stageReports.filter((stage) => stage.status === 'success').length;
  const failedCount = stageReports.filter((stage) => stage.status === 'failed').length;
  const baseCoverage = packCount > 0
    ? Math.min(1, COVERAGE_BASE_OFFSET + packCount / COVERAGE_PACK_DIVISOR)
    : 0;
  const gapPenalty = Math.min(COVERAGE_GAP_PENALTY_MAX, coverageGaps.length * COVERAGE_GAP_PENALTY_STEP);
  const successRatio = successCount / stageCount;
  const estimatedCoverage = clamp01(
    baseCoverage +
    (totalConfidence * COVERAGE_TOTAL_CONFIDENCE_WEIGHT) +
    (successRatio * COVERAGE_SUCCESS_RATIO_WEIGHT) -
    gapPenalty -
    (failedCount * COVERAGE_FAILED_COUNT_WEIGHT)
  );
  const coverageConfidence = clamp01(
    COVERAGE_CONFIDENCE_BASE +
    (successRatio * COVERAGE_CONFIDENCE_SUCCESS_WEIGHT) -
    (failedCount * COVERAGE_CONFIDENCE_FAILED_WEIGHT)
  );
  const gaps = stageReports.flatMap((stage) => stage.issues.map((issue) => ({
    source: stage.stage,
    description: issue.message,
    severity: issue.severity,
    remediation: issue.remediation,
  })));
  const suggestions = buildCoverageSuggestions(stageReports, gaps, packCount);
  return {
    estimatedCoverage,
    coverageConfidence,
    gaps,
    suggestions,
  };
}

function buildCoverageSuggestions(stageReports: StageReport[], gaps: CoverageAssessment['gaps'], packCount: number): string[] {
  const suggestions = new Set<string>();
  const hasStage = (stageName: StageName, status?: StageReport['status'] | Array<StageReport['status']>) => {
    const statusSet = Array.isArray(status) ? new Set(status) : null;
    return stageReports.some((stage) => stage.stage === stageName && (!statusSet || statusSet.has(stage.status)));
  };
  if (packCount === 0) suggestions.add('Index the project and include affected files to improve coverage.');
  if (hasStage('semantic_retrieval', ['partial', 'failed'])) suggestions.add('Provide a more specific intent or affected files for stronger semantic matches.');
  if (hasStage('graph_expansion', ['skipped', 'failed'])) suggestions.add('Enable graph metrics during bootstrap to improve graph expansion.');
  if (hasStage('synthesis', ['skipped', 'failed'])) suggestions.add('Enable LLM providers to generate synthesized answers.');
  if (gaps.some((gap) => gap.severity === 'significant')) suggestions.add('Increase query depth or broaden affectedFiles to improve coverage.');
  return Array.from(suggestions);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

type QueryEvidenceEvent = 'query_start' | 'query_complete' | 'query_cache_hit' | 'query_error';

async function appendQueryEvidence(
  ledger: IEvidenceLedger,
  sessionId: SessionId,
  event: QueryEvidenceEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: `librarian_query_${event}`,
        arguments: payload,
        result: event === 'query_error' ? null : payload,
        success: event !== 'query_error',
        durationMs: 0,
        errorMessage: event === 'query_error' ? String(payload.errorMessage ?? 'unverified_by_trace(query_failed)') : undefined,
      },
      provenance: {
        source: 'system_observation',
        method: 'librarian_query',
        agent: { type: 'tool', identifier: 'librarian' },
      },
      relatedEntries: [],
      sessionId,
    });
  } catch {
    // Evidence ledger failures must not break queries.
  }
}

async function appendStageEvidence(
  ledger: IEvidenceLedger,
  sessionId: SessionId,
  report: StageReport
): Promise<void> {
  try {
    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: 'librarian_query_stage',
        arguments: { stage: report.stage, status: report.status },
        result: report,
        success: report.status === 'success',
        durationMs: report.durationMs ?? 0,
        errorMessage: report.status === 'failed' ? report.issues.map((issue) => issue.message).join('; ') : undefined,
      },
      provenance: {
        source: 'system_observation',
        method: 'query_stage',
        agent: { type: 'tool', identifier: 'librarian' },
      },
      relatedEntries: [],
      sessionId,
    });
  } catch {
    // Non-fatal.
  }
}

async function appendConstructionPlanEvidence(
  ledger: IEvidenceLedger,
  sessionId: SessionId,
  plan: ConstructionPlan
): Promise<void> {
  try {
    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: 'construction_plan',
        arguments: {
          planId: plan.id,
          templateId: plan.templateId,
          ucIds: plan.ucIds,
          domain: plan.domain ?? null,
          source: plan.source,
        },
        result: plan,
        success: true,
        durationMs: 0,
      },
      provenance: {
        source: 'system_observation',
        method: 'construction_plan',
        agent: { type: 'tool', identifier: 'librarian' },
      },
      relatedEntries: [],
      sessionId,
    });
  } catch {
    // Non-fatal.
  }
}

// Query pipeline stage helpers
async function runDirectPacksStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  stageTracker: StageTracker;
  explanationParts: string[];
}): Promise<{ directPacks: ContextPack[]; cacheHit: boolean }> {
  const { storage, query, stageTracker, explanationParts } = options;
  const directStage = stageTracker.start('direct_packs', query.affectedFiles?.length ?? 0);
  const directPacks = await collectDirectPacks(storage, query);
  stageTracker.finish(directStage, { outputCount: directPacks.length, filteredCount: 0 });
  const cacheHit = directPacks.length > 0;
  if (cacheHit) {
    explanationParts.push(`Matched ${directPacks.length} packs from affected files.`);
  }
  return { directPacks, cacheHit };
}

async function runSemanticRetrievalStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  embeddingService: EmbeddingService;
  governor: GovernorContext;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  capabilities: StorageCapabilities;
  version: LibrarianVersion;
  embeddingAvailable: boolean;
}): Promise<{ candidates: Candidate[]; queryEmbedding: Float32Array | null }> {
  const {
    storage,
    query,
    embeddingService,
    governor,
    stageTracker,
    recordCoverageGap,
    capabilities,
    version,
    embeddingAvailable,
  } = options;
  let queryEmbedding: Float32Array | null = null;
  let candidates: Candidate[] = [];
  const semanticStage = stageTracker.start('semantic_retrieval', query.intent && query.depth !== 'L0' ? 1 : 0);
  if (semanticStage.inputCount > 0) {
    if (!embeddingAvailable) {
      const reason = capabilities.optional.embeddings
        ? 'Embedding provider unavailable.'
        : 'Embedding retrieval unsupported by storage.';
      recordCoverageGap(
        'semantic_retrieval',
        reason,
        'significant',
        capabilities.optional.embeddings ? 'Authenticate a live embedding provider.' : 'Use a storage backend with embedding support.'
      );
    } else {
      queryEmbedding = await resolveQueryEmbedding(query, embeddingService, governor);
      const minSimilarity = version.qualityTier === 'mvp'
        ? MIN_SIMILARITY_MVP
        : MIN_SIMILARITY_FULL;
      const similarResults = await storage.findSimilarByEmbedding(queryEmbedding, {
        limit: 14,
        minSimilarity,
        entityTypes: ['function', 'module'],
      });
      if (!similarResults.length) {
        recordCoverageGap(
          'semantic_retrieval',
          `No semantic matches above similarity threshold (${minSimilarity}).`,
          'moderate',
          'Refine the query intent or add affectedFiles to anchor the search.'
        );
      }
      candidates = await hydrateCandidates(similarResults, storage);
    }
  } else if (!query.intent) {
    recordCoverageGap('semantic_retrieval', 'No query intent provided for semantic search.', 'minor');
  }
  stageTracker.finish(semanticStage, { outputCount: candidates.length, filteredCount: 0 });
  return { candidates, queryEmbedding };
}

async function runGraphExpansionStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  candidates: Candidate[];
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  capabilities: StorageCapabilities;
  explanationParts: string[];
  directPacks: ContextPack[];
}): Promise<Candidate[]> {
  const {
    storage,
    query,
    candidates: initialCandidates,
    stageTracker,
    recordCoverageGap,
    capabilities,
    explanationParts,
    directPacks,
  } = options;
  let candidates = initialCandidates;
  const graphStage = stageTracker.start('graph_expansion', candidates.length);
  let graphStageFinished = false;
  let expansion: { candidates: Candidate[]; communityAdded: number; graphAdded: number } = {
    candidates: [],
    communityAdded: 0,
    graphAdded: 0,
  };
  const graphStore = storage as GraphMetricsStore;
  const metricsByType = new Map<GraphEntityType, GraphMetricsEntry[]>();
  if (candidates.length) {
    const metricsLoaded = await loadGraphMetrics(graphStore, candidates, metricsByType, recordCoverageGap, capabilities);
    if (metricsLoaded) {
      applyGraphMetrics(candidates, metricsByType);
      expansion = await expandCandidates(candidates, metricsByType, storage, query.depth);
    } else {
      stageTracker.finish(graphStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
      graphStageFinished = true;
    }
  } else {
    stageTracker.finish(graphStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
    graphStageFinished = true;
  }
  if (!graphStageFinished) {
    stageTracker.finish(graphStage, { outputCount: expansion.candidates.length, filteredCount: 0 });
  }
  if (expansion.candidates.length) {
    candidates = mergeCandidates(candidates, expansion.candidates);
    applyGraphMetrics(candidates, metricsByType);
  }
  if (expansion.communityAdded > 0) explanationParts.push(`Added ${expansion.communityAdded} community neighbors.`);
  if (expansion.graphAdded > 0) explanationParts.push(`Added ${expansion.graphAdded} graph-similar entities.`);
  if (candidates.length) {
    const anchorFiles = resolveCochangeAnchors(query, directPacks);
    if (anchorFiles.length) {
      const boosted = await applyCochangeScores(storage, candidates, anchorFiles);
      if (boosted > 0) explanationParts.push(`Applied co-change boosts for ${boosted} candidates.`);
    }
  }
  return candidates;
}

async function runScoringStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  candidates: Candidate[];
  queryEmbedding: Float32Array | null;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  capabilities: StorageCapabilities;
  explanationParts: string[];
}): Promise<{ candidates: Candidate[]; candidateScoreMap: Map<string, number> }> {
  const {
    storage,
    query,
    candidates,
    queryEmbedding,
    stageTracker,
    recordCoverageGap,
    capabilities,
    explanationParts,
  } = options;
  const candidateScoreMap = new Map<string, number>();
  const scoringStage = stageTracker.start('multi_signal_scoring', candidates.length);
  if (candidates.length) {
    let scoredMap: Map<string, { combinedScore: number }> | null = null;
    try {
      scoredMap = await scoreCandidatesWithMultiSignals(storage, candidates, query, queryEmbedding);
    } catch (error) {
      scoredMap = null;
    }

    if (!scoredMap || scoredMap.size === 0) {
      recordCoverageGap('multi_signal_scoring', 'Multi-signal scorer unavailable; using baseline signal weights.', 'minor');
      scoreCandidates(candidates);
      explanationParts.push('Scored candidates using baseline signal weights (multi-signal scorer unavailable).');
    } else {
      for (const candidate of candidates) {
        const scored = scoredMap.get(candidate.entityId);
        if (scored) {
          candidate.score = scored.combinedScore;
        }
      }
      explanationParts.push('Scored candidates using multi-signal relevance model.');
    }

    if (queryEmbedding && query.intent) {
      const moduleCandidateCount = candidates.filter((candidate) => candidate.entityType === 'module').length;
      const multiVectorStage = stageTracker.start('multi_vector_scoring', moduleCandidateCount);
      if (!moduleCandidateCount) {
        stageTracker.finish(multiVectorStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
      } else if (!capabilities.optional.multiVectors) {
        recordCoverageGap(
          'multi_vector_scoring',
          'Multi-vector embeddings unsupported by storage.',
          'moderate',
          'Use a storage backend that supports multi-vector embeddings.'
        );
        stageTracker.finish(multiVectorStage, { outputCount: 0, filteredCount: moduleCandidateCount, status: 'skipped' });
      } else {
        try {
          const multiVectorStats = await applyMultiVectorScores({
            storage,
            candidates,
            query,
            queryEmbedding,
          });
          if (multiVectorStats.applied > 0) {
            explanationParts.push(`Applied multi-vector scoring to ${multiVectorStats.applied} module candidates.`);
          }
          if (multiVectorStats.missing > 0) {
            recordCoverageGap(
              'multi_vector_scoring',
              `Multi-vector embeddings missing for ${multiVectorStats.missing} module candidates.`,
              'minor'
            );
          }
          const multiVectorStatus = multiVectorStats.applied > 0 ? undefined : 'partial';
          stageTracker.finish(multiVectorStage, {
            outputCount: multiVectorStats.applied,
            filteredCount: multiVectorStats.missing,
            status: multiVectorStatus,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordCoverageGap('multi_vector_scoring', `Multi-vector scoring unavailable (${message}).`, 'moderate');
          stageTracker.finish(multiVectorStage, { outputCount: 0, filteredCount: moduleCandidateCount, status: 'failed' });
        }
      }
    }

    for (const candidate of candidates) {
      if (typeof candidate.score === 'number') {
        candidateScoreMap.set(candidate.entityId, candidate.score);
        candidateScoreMap.set(`${candidate.entityType}:${candidate.entityId}`, candidate.score);
      }
    }
    stageTracker.finish(scoringStage, { outputCount: candidates.length, filteredCount: 0 });
  } else {
    stageTracker.finish(scoringStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
  }

  return { candidates, candidateScoreMap };
}

async function runCandidatePackStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  candidates: Candidate[];
  directPacks: ContextPack[];
  candidateScoreMap: Map<string, number>;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  explanationParts: string[];
  version: LibrarianVersion;
}): Promise<{ allPacks: ContextPack[] }> {
  const {
    storage,
    query,
    candidates,
    directPacks,
    candidateScoreMap,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    version,
  } = options;
  const candidatePacks = await collectCandidatePacks(storage, candidates, query.depth);
  if (candidatePacks.length && candidates.length) {
    explanationParts.push(`Added ${candidatePacks.length} packs from semantic + graph candidates.`);
  }
  const allPacks = dedupePacks([...directPacks, ...candidatePacks]);
  if (!allPacks.length) {
    const fallbackStage = stageTracker.start('fallback', 1);
    const fallbackMinConfidence = version.qualityTier === 'mvp'
      ? FALLBACK_MIN_CONFIDENCE_MVP
      : FALLBACK_MIN_CONFIDENCE_FULL;
    let fallback = await storage.getContextPacks({ minConfidence: fallbackMinConfidence, limit: 6 });
    if (!fallback.length) fallback = await storage.getContextPacks({ limit: 6 });
    if (fallback.length) {
      allPacks.push(...fallback);
      explanationParts.push('Fell back to general packs (semantic match unavailable).');
      stageTracker.finish(fallbackStage, { outputCount: fallback.length, filteredCount: 0 });
    } else {
      recordCoverageGap(
        'fallback',
        'No context packs available from storage.',
        'significant',
        'Run bootstrap or lower the minimum confidence threshold.'
      );
      stageTracker.finish(fallbackStage, { outputCount: 0, filteredCount: 0, status: 'failed' });
    }
  }
  if (directPacks.length) {
    for (const pack of directPacks) {
      const existing = candidateScoreMap.get(pack.targetId) ?? 0;
        candidateScoreMap.set(pack.targetId, Math.max(existing, CANDIDATE_SCORE_FLOOR));
    }
  }
  return { allPacks };
}

async function runRerankStage(options: {
  query: LibrarianQuery;
  finalPacks: ContextPack[];
  candidateScoreMap: Map<string, number>;
  stageTracker: StageTracker;
  explanationParts: string[];
  recordCoverageGap: RecordCoverageGap;
  rerank?: typeof maybeRerankWithCrossEncoder;
  forceRerank?: boolean;
}): Promise<ContextPack[]> {
  const {
    query,
    finalPacks,
    candidateScoreMap,
    stageTracker,
    explanationParts,
    recordCoverageGap,
    rerank,
    forceRerank,
  } = options;
  const rerankRunner = rerank ?? maybeRerankWithCrossEncoder;
  const rerankEligible =
    Boolean(query.intent) &&
    finalPacks.length >= 2 &&
    (query.depth === 'L2' || query.depth === 'L3') &&
    (forceRerank || isCrossEncoderEnabled());
  const rerankStage = stageTracker.start('reranking', rerankEligible ? finalPacks.length : 0);
  if (rerankEligible) {
    try {
      const reranked = await rerankRunner(
        query,
        finalPacks,
        candidateScoreMap,
        explanationParts,
        recordCoverageGap
      );
      if (!Array.isArray(reranked) || reranked.length === 0 || reranked.length !== finalPacks.length) {
        recordCoverageGap('reranking', 'Cross-encoder rerank produced invalid output; using original order.', 'minor');
        stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
        return finalPacks;
      }
      const outputIds = reranked.map((pack) => pack?.packId);
      if (outputIds.some((id) => !id)) {
        recordCoverageGap('reranking', 'Cross-encoder rerank returned invalid pack IDs; using original order.', 'minor');
        stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
        return finalPacks;
      }
      const normalizedOutputIds = outputIds as string[];
      const inputIds = new Set(finalPacks.map((pack) => pack.packId));
      const outputIdSet = new Set(normalizedOutputIds);
      if (outputIdSet.size !== normalizedOutputIds.length || outputIdSet.size !== inputIds.size) {
        recordCoverageGap('reranking', 'Cross-encoder rerank returned mismatched packs; using original order.', 'minor');
        stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
        return finalPacks;
      }
      for (const id of inputIds) {
        if (!outputIdSet.has(id)) {
          recordCoverageGap('reranking', 'Cross-encoder rerank returned mismatched packs; using original order.', 'minor');
          stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
          return finalPacks;
        }
      }
      stageTracker.finish(rerankStage, { outputCount: reranked.length, filteredCount: 0 });
      return reranked;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCoverageGap('reranking', `Cross-encoder rerank failed: ${message}`, 'minor');
      stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'failed' });
      return finalPacks;
    }
  }
  stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'skipped' });
  return finalPacks;
}

function resolveDefeaterFilePath(pack: ContextPack, workspaceRoot?: string): string | null {
  const candidate = pack.relatedFiles[0];
  if (!candidate) return null;
  const normalized = candidate.replace(/\\/g, '/').trim();
  if (!normalized) return null;
  if (!workspaceRoot) {
    return path.isAbsolute(normalized) ? null : normalized;
  }
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) return null;
  return relative;
}

async function runDefeaterStage(options: {
  storage: LibrarianStorage;
  finalPacks: ContextPack[];
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  workspaceRoot: string;
  checkDefeatersFn?: typeof checkDefeaters;
}): Promise<ContextPack[]> {
  const { storage, finalPacks: initialPacks, stageTracker, recordCoverageGap, workspaceRoot, checkDefeatersFn } = options;
  const defeaterStage = stageTracker.start('defeater_check', initialPacks.length);
  const defeaterInputCount = initialPacks.length;
  // Phase A: Check defeaters to filter stale knowledge (CHUNKED BATCHING for performance)
  // Process in chunks of 10 to avoid overwhelming database with concurrent reads
  const DEFEATER_BATCH_SIZE = 10;
  const defeaterResults: Map<string, ActivationSummary> = new Map();
  const failedPacks = new Set<string>();
  const runDefeaters = checkDefeatersFn ?? checkDefeaters;
  let missingPathCount = 0;
  let firstFailureMessage: string | null = null;

  for (let i = 0; i < initialPacks.length; i += DEFEATER_BATCH_SIZE) {
    const chunk = initialPacks.slice(i, i + DEFEATER_BATCH_SIZE);
    const chunkResults = await Promise.allSettled(chunk.map(async (pack) => {
      const meta = {
        confidence: { overall: pack.confidence, bySection: {} as Record<string, number> },
        evidence: [] as Array<{
          type: 'code' | 'test' | 'commit' | 'comment' | 'usage' | 'doc' | 'inferred';
          source: string;
          description: string;
          confidence: number;
        }>,
        generatedAt: pack.createdAt.toISOString(),
        generatedBy: 'librarian',
        defeaters: [STANDARD_DEFEATERS.codeChange, STANDARD_DEFEATERS.testFailure],
      };
      const filePath = resolveDefeaterFilePath(pack, workspaceRoot);
      if (!filePath) missingPathCount += 1;
      const result = await runDefeaters(meta, {
        entityId: pack.targetId,
        filePath: filePath ?? undefined,
        storage,
        workspaceRoot,
      });
      return { packId: pack.packId, result };
    }));

    for (let index = 0; index < chunkResults.length; index += 1) {
      const outcome = chunkResults[index];
      const pack = chunk[index];
      if (outcome.status === 'fulfilled') {
        const { result } = outcome.value;
        if (result.activeDefeaters > 0 || result.confidenceAdjustment !== 0 || !result.knowledgeValid) {
          defeaterResults.set(outcome.value.packId, result);
        }
      } else {
        failedPacks.add(pack.packId);
        if (!firstFailureMessage) {
          const reason = outcome.reason;
          firstFailureMessage = reason instanceof Error ? reason.message : String(reason);
        }
      }
    }
  }

  if (missingPathCount > 0) {
    recordCoverageGap(
      'defeater_check',
      `Skipped code-change checks for ${missingPathCount} pack(s) without valid file paths.`,
      'minor'
    );
  }
  if (failedPacks.size > 0) {
    const detail = firstFailureMessage ? ` (${firstFailureMessage})` : '';
    recordCoverageGap(
      'defeater_check',
      `Defeater checks failed for ${failedPacks.size} pack(s); excluding them from results.${detail}`,
      'significant'
    );
  }

  // Filter fully defeated packs, reduce confidence for partial defeats
  const finalPacks: ContextPack[] = [];
  for (const pack of initialPacks) {
    if (failedPacks.has(pack.packId)) {
      continue;
    }
    const summary = defeaterResults.get(pack.packId);
    if (!summary) {
      finalPacks.push(pack);
      continue;
    }
    if (!summary.knowledgeValid) {
      recordCoverageGap(
        'defeater_check',
        `Filtered stale pack for ${pack.targetId} (${summary.results.find((r) => r.activated)?.reason ?? 'code changed'})`,
        'moderate'
      );
      continue; // Remove fully defeated pack
    }
    // Apply partial confidence adjustment
    const adjustedConfidence = Math.max(
      CONFIDENCE_ADJUSTMENT_FLOOR,
      pack.confidence + summary.confidenceAdjustment
    );
    if (adjustedConfidence !== pack.confidence) {
      finalPacks.push({ ...pack, confidence: adjustedConfidence });
    } else {
      finalPacks.push(pack);
    }
  }
  stageTracker.finish(defeaterStage, {
    outputCount: finalPacks.length,
    filteredCount: Math.max(0, defeaterInputCount - finalPacks.length),
  });
  return finalPacks;
}

async function runMethodGuidanceStage(options: {
  query: LibrarianQuery;
  storage: LibrarianStorage;
  governor: GovernorContext;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  synthesisEnabled: boolean;
  resolveMethodGuidanceFn?: typeof resolveMethodGuidance;
  resolveLlmConfig?: typeof resolveLibrarianModelConfigWithDiscovery;
}): Promise<Awaited<ReturnType<typeof resolveMethodGuidance>> | null> {
  const {
    query,
    storage,
    governor,
    stageTracker,
    recordCoverageGap,
    synthesisEnabled,
    resolveMethodGuidanceFn,
    resolveLlmConfig,
  } = options;
  const resolveGuidance = resolveMethodGuidanceFn ?? resolveMethodGuidance;
  const readLlmConfig = resolveLlmConfig ?? resolveLibrarianModelConfigWithDiscovery;
  let methodGuidance: Awaited<ReturnType<typeof resolveMethodGuidance>> | null = null;
  const methodGuidanceStage = stageTracker.start('method_guidance', synthesisEnabled ? 1 : 0);
  if (synthesisEnabled) {
    try {
      const llmConfig = await readLlmConfig();
      if (llmConfig.provider?.trim() && llmConfig.modelId?.trim()) {
        methodGuidance = await resolveGuidance({
          ucIds: query.ucRequirements?.ucIds,
          taskType: query.taskType,
          intent: query.intent,
          storage,
          llmProvider: llmConfig.provider,
          llmModelId: llmConfig.modelId,
          governorContext: governor,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCoverageGap('method_guidance', message, 'minor');
    }
  }
  const methodGuidanceOutput = methodGuidance?.hints.length ?? 0;
  const methodGuidanceStatus =
    methodGuidanceStage.inputCount > 0 && methodGuidanceOutput === 0 && methodGuidanceStage.issues.length > 0
      ? 'partial'
      : undefined;
  stageTracker.finish(methodGuidanceStage, {
    outputCount: methodGuidanceOutput,
    filteredCount: 0,
    status: methodGuidanceStatus,
  });
  return methodGuidance;
}

async function runSynthesisStage(options: {
  query: LibrarianQuery;
  storage: LibrarianStorage;
  finalPacks: ContextPack[];
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  explanationParts: string[];
  synthesisEnabled: boolean;
  workspaceRoot?: string;
  resolveWorkspaceRootFn?: typeof resolveWorkspaceRoot;
  canAnswerFromSummariesFn?: typeof canAnswerFromSummaries;
  createQuickAnswerFn?: typeof createQuickAnswer;
  synthesizeQueryAnswerFn?: typeof synthesizeQueryAnswer;
}): Promise<SynthesizedResponse | undefined> {
  const {
    query,
    storage,
    finalPacks,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    synthesisEnabled,
    workspaceRoot,
    resolveWorkspaceRootFn,
    canAnswerFromSummariesFn,
    createQuickAnswerFn,
    synthesizeQueryAnswerFn,
  } = options;
  const resolveWorkspace = resolveWorkspaceRootFn ?? resolveWorkspaceRoot;
  const shouldQuickAnswer = canAnswerFromSummariesFn ?? canAnswerFromSummaries;
  const buildQuickAnswer = createQuickAnswerFn ?? createQuickAnswer;
  const synthesizeAnswer = synthesizeQueryAnswerFn ?? synthesizeQueryAnswer;
  let synthesis: SynthesizedResponse | undefined;
  const synthesisStage = stageTracker.start('synthesis', synthesisEnabled && query.intent && finalPacks.length > 0 ? 1 : 0);
  if (synthesisEnabled && query.intent && finalPacks.length > 0) {
    const resolvedWorkspaceRoot = workspaceRoot?.trim() || await resolveWorkspace(storage);
    if (!resolvedWorkspaceRoot || !resolvedWorkspaceRoot.trim()) {
      recordCoverageGap('synthesis', 'Workspace root unavailable; skipping synthesis.', 'moderate');
      stageTracker.finish(synthesisStage, { outputCount: 0, filteredCount: 0, status: 'failed' });
      return undefined;
    }
    try {
      // Use quick synthesis for simple queries when possible
      if (shouldQuickAnswer(query, finalPacks)) {
        const quickAnswer = buildQuickAnswer(query, finalPacks);
        synthesis = {
          answer: quickAnswer.answer,
          confidence: quickAnswer.confidence,
          citations: quickAnswer.citations,
          keyInsights: quickAnswer.keyInsights,
          uncertainties: quickAnswer.uncertainties,
        };
        explanationParts.push('Quick synthesis from pack summaries.');
      } else {
        // Full LLM synthesis
        const synthesisResult = await synthesizeAnswer({
          query,
          packs: finalPacks,
          storage,
          workspace: resolvedWorkspaceRoot,
        });

        if (synthesisResult.synthesized) {
          synthesis = {
            answer: synthesisResult.answer,
            confidence: synthesisResult.confidence,
            citations: synthesisResult.citations,
            keyInsights: synthesisResult.keyInsights,
            uncertainties: synthesisResult.uncertainties,
          };
          explanationParts.push('LLM-synthesized understanding from retrieved knowledge.');
        } else {
          const reason = 'reason' in synthesisResult ? synthesisResult.reason : 'unverified_by_trace(synthesis_unavailable)';
          recordCoverageGap('synthesis', `Synthesis unavailable: ${reason}`, 'moderate');
        }
      }
    } catch (synthesisError) {
      const message = synthesisError instanceof Error ? synthesisError.message : String(synthesisError);
      // Log but don't fail query if synthesis fails
      recordCoverageGap('synthesis', `Synthesis failed: ${message.replace(/unverified_by_trace\([^)]+\):\s*/, '')}`, 'moderate');
    }
  }
  stageTracker.finish(synthesisStage, { outputCount: synthesis ? 1 : 0, filteredCount: 0 });
  return synthesis;
}

function applyAdequacyToSynthesis(
  synthesis: SynthesizedResponse | undefined,
  adequacyReport: AdequacyReport | null
): SynthesizedResponse | undefined {
  if (!synthesis || !adequacyReport) return synthesis;
  if (adequacyReport.missingEvidence.length === 0) return synthesis;
  const missing = adequacyReport.missingEvidence.map((req) => req.description).join('; ');
  const notice = `unverified_by_trace(adequacy_missing): ${missing}`;
  const updated = {
    ...synthesis,
    uncertainties: [...synthesis.uncertainties, notice],
  };
  if (adequacyReport.blocking) {
    updated.confidence = Math.min(updated.confidence, 0.35);
  }
  return updated;
}

/**
 * Retrieve feedback context for a feedbackToken.
 * Returns null if token not found or expired.
 */
export async function getFeedbackContext(
  feedbackToken: string,
  _storage: LibrarianStorage
): Promise<FeedbackContext | null> {
  const context = feedbackContextCache.get(feedbackToken);
  if (!context) return null;

  // Check if expired
  const age = Date.now() - new Date(context.createdAt).getTime();
  if (age > FEEDBACK_CONTEXT_TTL_MS) {
    feedbackContextCache.delete(feedbackToken);
    return null;
  }

  return context;
}

function resolveStorageCapabilities(storage: LibrarianStorage): StorageCapabilities {
  if (typeof storage.getCapabilities === 'function') {
    return storage.getCapabilities();
  }
  const graphMetrics = typeof (storage as GraphMetricsStore).getGraphMetrics === 'function';
  const multiVectors = typeof (storage as LibrarianStorage & { getMultiVectors?: unknown }).getMultiVectors === 'function';
  const embeddings = typeof storage.getEmbedding === 'function' && typeof storage.findSimilarByEmbedding === 'function';
  return {
    core: {
      getFunctions: true,
      getFiles: true,
      getContextPacks: true,
    },
    optional: {
      graphMetrics,
      multiVectors,
      embeddings,
      episodes: true,
      verificationPlans: true,
    },
    versions: {
      schema: 0,
      api: 0,
    },
  };
}

function getEmbeddingCache(service: EmbeddingService): Map<string, Float32Array> {
  let cache = embeddingCache.get(service);
  if (!cache) {
    cache = new Map();
    embeddingCache.set(service, cache);
  }
  return cache;
}

function cacheEmbedding(cache: Map<string, Float32Array>, key: string, embedding: Float32Array): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, embedding);
  if (cache.size > EMBEDDING_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

function buildQueryCacheKey(query: LibrarianQuery, version: LibrarianVersion, llmRequirement: LlmRequirement, synthesisEnabled: boolean): string { const files = query.affectedFiles?.slice().sort().join('|') ?? ''; const versionKey = `${version.string}:${version.indexedAt?.getTime?.() ?? 0}`; return `${versionKey}|llm:${llmRequirement}|syn:${synthesisEnabled ? 1 : 0}|${query.depth}|${query.taskType ?? ''}|${query.minConfidence ?? ''}|${query.intent}|${files}`; }
function getQueryCache(storage: LibrarianStorage): HierarchicalMemory<CachedResponse> {
  const existing = queryCacheByStorage.get(storage);
  if (existing) return existing;
  const memory = new HierarchicalMemory<CachedResponse>({
    l1Max: QUERY_CACHE_L1_LIMIT,
    l2Max: QUERY_CACHE_L2_LIMIT,
    l1TtlMs: QUERY_CACHE_TTL_L1_MS,
    l2TtlMs: QUERY_CACHE_TTL_L2_MS,
    l3: {
      get: (key) => readPersistentCache(storage, key),
      set: (key, value) => writePersistentCache(storage, key, value),
    },
  });
  queryCacheByStorage.set(storage, memory);
  return memory;
}

function resolveQueryCacheTier(query: LibrarianQuery): MemoryTier {
  return query.depth === 'L0' ? 'l1' : 'l2';
}

function resolveQueryCacheTtl(depth?: LibrarianQuery['depth']): number {
  return depth === 'L0' ? QUERY_CACHE_TTL_L1_MS : QUERY_CACHE_TTL_L2_MS;
}

function extractQueryDepth(entry: QueryCacheEntry): LibrarianQuery['depth'] | undefined {
  const parsed = safeJsonParse<LibrarianQuery>(entry.queryParams);
  if (!parsed.ok || !parsed.value) return undefined;
  return parsed.value.depth;
}

async function setCachedQuery(
  key: string,
  response: CachedResponse,
  storage: LibrarianStorage,
  query: LibrarianQuery
): Promise<void> {
  const cache = getQueryCache(storage);
  await cache.set(key, response, resolveQueryCacheTier(query));
}

async function readPersistentCache(storage: LibrarianStorage, key: string): Promise<CachedResponse | null> {
  const cacheStore = storage as QueryCacheStore;
  if (!cacheStore.getQueryCacheEntry) return noResult();
  const entry = await cacheStore.getQueryCacheEntry(key);
  if (!entry) return noResult();
  const createdAt = Date.parse(entry.createdAt);
  const ttlMs = resolveQueryCacheTtl(extractQueryDepth(entry));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
    if (cacheStore.pruneQueryCache) {
      await cacheStore.pruneQueryCache({ maxEntries: QUERY_CACHE_L2_LIMIT, maxAgeMs: QUERY_CACHE_TTL_L2_MS });
    }
    return noResult();
  }
  const parsed = deserializeCachedResponse(entry.response);
  if (!parsed) return noResult();
  return parsed;
}

async function writePersistentCache(storage: LibrarianStorage, key: string, response: CachedResponse): Promise<void> {
  const cacheStore = storage as QueryCacheStore;
  if (!cacheStore?.upsertQueryCacheEntry) return;
  const nowIso = new Date().toISOString();
  await cacheStore.upsertQueryCacheEntry({
    queryHash: key,
    queryParams: JSON.stringify(response.query),
    response: serializeCachedResponse(response),
    createdAt: nowIso,
    lastAccessed: nowIso,
    accessCount: 1,
  });
  if (cacheStore.pruneQueryCache) {
    await cacheStore.pruneQueryCache({ maxEntries: QUERY_CACHE_L2_LIMIT, maxAgeMs: QUERY_CACHE_TTL_L2_MS });
  }
}

type SerializedVersion = Omit<LibrarianVersion, 'indexedAt'> & { indexedAt: string };
type SerializedContextPack = Omit<ContextPack, 'createdAt' | 'version'> & { createdAt: string; version: SerializedVersion };
type SerializedResponse = Omit<CachedResponse, 'version' | 'packs'> & { version: SerializedVersion; packs: SerializedContextPack[] };

function serializeCachedResponse(response: CachedResponse): string {
  return JSON.stringify(response, (_key, value) => (value instanceof Date ? value.toISOString() : value));
}

function deserializeCachedResponse(raw: string): CachedResponse | null {
  const parsed = safeJsonParse<SerializedResponse>(raw);
  if (!parsed.ok) return noResult();
  const value = parsed.value;
  if (!value || !value.version || !Array.isArray(value.packs)) return noResult();
  const version = {
    ...value.version,
    indexedAt: new Date(value.version.indexedAt),
  };
  const packs = value.packs.map((pack) => ({
    ...pack,
    createdAt: new Date(pack.createdAt),
    version: {
      ...pack.version,
      indexedAt: new Date(pack.version.indexedAt),
    },
  }));
  return { ...value, version, packs };
}

async function collectDirectPacks(storage: LibrarianStorage, query: LibrarianQuery): Promise<ContextPack[]> {
  if (!query.affectedFiles?.length) return emptyArray<ContextPack>();
  const minConfidence = query.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const packs: ContextPack[] = [];
  for (const filePath of query.affectedFiles.slice(0, 12)) {
    packs.push(...await storage.getContextPacks({ relatedFile: filePath, minConfidence, limit: 30 }));
  }
  return dedupePacks(packs).slice(0, 40);
}
async function resolveQueryEmbedding(query: LibrarianQuery, embeddingService: EmbeddingService, governor: GovernorContext): Promise<Float32Array> {
  const cache = getEmbeddingCache(embeddingService); const cached = cache.get(query.intent); if (cached) return cached;
  governor.recordTokens(estimateTokenCount(query.intent));
  const embeddingResult = await embeddingService.generateEmbedding({ text: query.intent, kind: 'query' }, { governorContext: governor });
  if (!(embeddingResult.embedding instanceof Float32Array)) throw new Error('unverified_by_trace(provider_invalid_output): query embedding is not a Float32Array');
  cacheEmbedding(cache, query.intent, embeddingResult.embedding); return embeddingResult.embedding;
}
async function searchSimilarWithEmbedding(snippet: string, limit: number, storage: LibrarianStorage, embeddingService: EmbeddingService, governor: GovernorContext): Promise<SimilarMatch[]> {
  governor.recordTokens(estimateTokenCount(snippet)); const embeddingResult = await embeddingService.generateEmbedding({ text: snippet, kind: 'code' }, { governorContext: governor });
  if (!(embeddingResult.embedding instanceof Float32Array)) throw new Error('unverified_by_trace(provider_invalid_output): similarity embedding is not a Float32Array');
  const results = await storage.findSimilarByEmbedding(embeddingResult.embedding, {
    limit: Math.max(1, limit),
    minSimilarity: EMBEDDING_QUERY_MIN_SIMILARITY,
    entityTypes: ['function', 'module'],
  });
  return results.map((result) => ({ entityId: result.entityId, entityType: result.entityType, similarity: result.similarity }));
}

function collectFilesForGraph(response: LibrarianResponse): string[] {
  const depth = response.query.depth ?? 'L1';
  const maxFiles = depth === 'L3' ? 50 : depth === 'L2' ? 35 : depth === 'L1' ? 20 : 10;
  const files: string[] = [];
  const seen = new Set<string>();
  for (const pack of response.packs) {
    for (const file of pack.relatedFiles) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
      if (files.length >= maxFiles) return files;
    }
  }
  return files;
}

async function collectGraphContext(
  storage: LibrarianStorage,
  response: LibrarianResponse
): Promise<{ callGraph: CallEdge[]; importGraph: ImportEdge[] }> {
  const sourceFiles = collectFilesForGraph(response);
  if (!sourceFiles.length) {
    return { callGraph: emptyArray<CallEdge>(), importGraph: emptyArray<ImportEdge>() };
  }
  const depth = response.query.depth ?? 'L1';
  const callLimit = depth === 'L3' ? 220 : depth === 'L2' ? 150 : depth === 'L1' ? 120 : 80;
  const importLimit = depth === 'L3' ? 130 : depth === 'L2' ? 90 : depth === 'L1' ? 60 : 40;
  const callEdges = await storage.getGraphEdges({
    sourceFiles,
    edgeTypes: ['calls'],
    fromTypes: ['function'],
    limit: callLimit,
  });
  const importEdges = await storage.getGraphEdges({
    sourceFiles,
    edgeTypes: ['imports'],
    fromTypes: ['module'],
    limit: importLimit,
  });
  return {
    callGraph: callEdges.map((edge) => ({
      from: edge.fromId,
      to: edge.toId,
      sourceFile: edge.sourceFile,
      sourceLine: edge.sourceLine ?? null,
      confidence: edge.confidence,
    })),
    importGraph: importEdges.map((edge) => ({
      from: edge.fromId,
      to: edge.toId,
      sourceFile: edge.sourceFile,
      confidence: edge.confidence,
    })),
  };
}

function mergeSupplementaryContext(
  base: ContextAssemblyOptions['supplementary'] | undefined,
  extra: ContextAssemblyOptions['supplementary'] | undefined
): ContextAssemblyOptions['supplementary'] {
  return {
    recentChanges: [...(base?.recentChanges ?? []), ...(extra?.recentChanges ?? [])],
    patterns: [...(base?.patterns ?? []), ...(extra?.patterns ?? [])],
    antiPatterns: [...(base?.antiPatterns ?? []), ...(extra?.antiPatterns ?? [])],
    similarTasks: [...(base?.similarTasks ?? []), ...(extra?.similarTasks ?? [])],
    knowledgeSources: [...(base?.knowledgeSources ?? []), ...(extra?.knowledgeSources ?? [])],
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function toRelativePath(workspace: string | undefined, filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!workspace) return normalized;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(workspace, filePath);
  const relative = normalizePath(path.relative(workspace, absolute));
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return normalized;
}

function resolveWorkspacePath(workspace: string | undefined, filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!workspace) return normalized;
  if (path.isAbsolute(filePath)) return normalized;
  return normalizePath(path.join(workspace, filePath));
}

const KNOWLEDGE_SOURCE_TYPES = [
  'docs',
  'config',
  'ci',
  'process',
  'security',
  'domain',
  'schema',
  'api',
  'deps',
  'adr',
] as const;

const KNOWLEDGE_SOURCE_KEYWORDS: Record<string, string[]> = {
  docs: ['doc', 'docs', 'readme', 'guide', 'manual', 'design', 'architecture'],
  config: ['config', 'setting', 'env', 'environment', 'flag'],
  ci: ['ci', 'pipeline', 'build', 'deploy', 'workflow'],
  process: ['process', 'review', 'checklist', 'branch', 'release', 'pr'],
  security: ['security', 'vulnerability', 'auth', 'audit', 'codeql'],
  domain: ['domain', 'entity', 'model', 'business', 'invariant'],
  schema: ['schema', 'database', 'migration', 'sql', 'prisma'],
  api: ['api', 'endpoint', 'route', 'graphql', 'openapi', 'swagger'],
  deps: ['dependency', 'dependencies', 'package', 'lockfile', 'vulnerability'],
  adr: ['adr', 'decision', 'rationale', 'architecture'],
};

const MAX_KNOWLEDGE_SOURCES = 8;

async function loadKnowledgeItems(storage: LibrarianStorage): Promise<IngestionItem[]> {
  const limits: Record<string, number> = {
    docs: 20,
    config: 12,
    ci: 8,
    process: 6,
    security: 4,
    domain: 6,
    schema: 6,
    api: 8,
    deps: 4,
    adr: 10,
  };
  const entries = await Promise.all(
    KNOWLEDGE_SOURCE_TYPES.map((type) =>
      storage.getIngestionItems({
        sourceType: type,
        limit: limits[type] ?? 6,
        orderBy: 'ingested_at',
        orderDirection: 'desc',
      })
    )
  );
  return entries.flat();
}

function buildKnowledgeSources(
  items: IngestionItem[],
  query: LibrarianQuery,
  fileMap: Map<string, string>,
  workspace: string | undefined
): KnowledgeSourceRef[] {
  const tokens = tokenize(`${query.intent ?? ''} ${query.taskType ?? ''}`);
  const scored: Array<{ ref: KnowledgeSourceRef; score: number }> = [];

  for (const item of items) {
    if (!isRecord(item.payload)) continue;
    const summary = summarizeIngestionItem(item, workspace);
    if (!summary) continue;
    const fileScore = scoreFileRelevance(summary.files, fileMap, workspace);
    const textScore = scoreTextRelevance(tokens, summary);
    const typeScore = scoreTypeRelevance(tokens, item.sourceType);
    let score = fileScore + textScore + typeScore;
    if (score <= 0 && (item.sourceType === 'docs' || item.sourceType === 'adr' || item.sourceType === 'process')) {
      score = KNOWLEDGE_SCORE_FALLBACK;
    }
    if (score <= 0) continue;
    const confidence = Math.max(
      KNOWLEDGE_CONFIDENCE_MIN,
      Math.min(KNOWLEDGE_CONFIDENCE_MAX, KNOWLEDGE_CONFIDENCE_BASE + score * KNOWLEDGE_CONFIDENCE_SLOPE)
    );
    scored.push({
      ref: {
        id: item.id,
        sourceType: item.sourceType,
        summary: summary.summary,
        relatedFiles: summary.files.map((file) => resolveWorkspacePath(workspace, file)),
        highlights: summary.highlights,
        confidence,
      },
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const deduped = new Map<string, KnowledgeSourceRef>();
  for (const entry of scored) {
    if (deduped.size >= MAX_KNOWLEDGE_SOURCES) break;
    if (!deduped.has(entry.ref.id)) deduped.set(entry.ref.id, entry.ref);
  }
  return Array.from(deduped.values());
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scoreTextRelevance(tokens: string[], summary: { summary: string; highlights: string[]; files: string[] }): number {
  if (!tokens.length) return 0;
  const haystack = `${summary.summary} ${summary.highlights.join(' ')} ${summary.files.join(' ')}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function scoreTypeRelevance(tokens: string[], sourceType: string): number {
  if (!tokens.length) return 0;
  const keywords = KNOWLEDGE_SOURCE_KEYWORDS[sourceType] ?? [];
  let score = 0;
  for (const token of tokens) {
    if (keywords.some((keyword) => token.includes(keyword) || keyword.includes(token))) {
      score += 2;
    }
  }
  return score;
}

function scoreFileRelevance(files: string[], fileMap: Map<string, string>, workspace: string | undefined): number {
  if (!files.length || fileMap.size === 0) return 0;
  const keys = Array.from(fileMap.keys());
  let score = 0;
  for (const file of files) {
    const relative = toRelativePath(workspace, file);
    if (fileMap.has(relative)) {
      score += 3;
      continue;
    }
    const dir = relative.includes('/') ? relative.split('/').slice(0, -1).join('/') : '';
    if (dir && keys.some((candidate) => candidate.startsWith(dir))) {
      score += 1;
    }
  }
  return score;
}

function summarizeIngestionItem(
  item: IngestionItem,
  workspace: string | undefined
): { summary: string; highlights: string[]; files: string[] } | null {
  if (!isRecord(item.payload)) return null;
  const payload = item.payload;
  switch (item.sourceType) {
    case 'docs': {
      const pathValue = readString(payload.path);
      const headings = readRecordArray(payload.headings)
        .map((entry) => readString(entry.text))
        .filter((value): value is string => Boolean(value));
      const summary = readString(payload.summary) ?? (pathValue ? `Documentation ${pathValue}` : 'Documentation summary');
      return { summary, highlights: headings.slice(0, 4), files: pathValue ? [pathValue] : [] };
    }
    case 'config': {
      const pathValue = readString(payload.path);
      const keys = readRecordArray(payload.keys)
        .map((entry) => readString(entry.key))
        .filter((value): value is string => Boolean(value));
      const summary = pathValue
        ? `Config ${pathValue} (${keys.length} keys)`
        : `Config keys (${keys.length})`;
      return { summary, highlights: keys.slice(0, 4), files: pathValue ? [pathValue] : [] };
    }
    case 'ci': {
      const pathValue = readString(payload.path);
      const pipeline = readString(payload.pipelineType) ?? 'ci';
      const jobs = readRecordArray(payload.jobs)
        .map((entry) => readString(entry.name) ?? readString(entry.id))
        .filter((value): value is string => Boolean(value));
      const summary = `CI (${pipeline}) ${jobs.length} job${jobs.length === 1 ? '' : 's'}`;
      return { summary, highlights: jobs.slice(0, 4), files: pathValue ? [pathValue] : [] };
    }
    case 'process': {
      const templates = readRecordArray(payload.templates).map((entry) => ({
        path: readString(entry.path),
        headings: readStringArray(entry.headings),
        checklist: readStringArray(entry.checklist),
      }));
      const files = templates.map((entry) => entry.path).filter((value): value is string => Boolean(value));
      const highlights = templates.flatMap((entry) => entry.headings.length ? entry.headings : entry.checklist).filter(Boolean);
      const summary = `Process templates (${templates.length})`;
      return { summary, highlights: highlights.slice(0, 4), files };
    }
    case 'security': {
      const eslint = readRecordArray(payload.eslint);
      const tsconfig = readRecordArray(payload.tsconfig);
      const codeqlFindings = countFindings(payload.codeql);
      const joernFindings = countFindings(payload.joern);
      const summary = `Security signals: eslint ${eslint.length}, tsconfig ${tsconfig.length}, codeql ${codeqlFindings}, joern ${joernFindings}`;
      const highlights = [
        codeqlFindings ? `codeql:${codeqlFindings}` : null,
        joernFindings ? `joern:${joernFindings}` : null,
      ].filter((value): value is string => Boolean(value));
      return { summary, highlights, files: [] };
    }
    case 'domain': {
      const entities = readRecordArray(payload.entities)
        .map((entry) => readString(entry.name))
        .filter((value): value is string => Boolean(value));
      const invariants = readRecordArray(payload.invariants)
        .map((entry) => readString(entry.name))
        .filter((value): value is string => Boolean(value));
      const files = readStringArray(payload.files);
      const summary = `Domain entities ${entities.length}, invariants ${invariants.length}`;
      const highlights = [...entities.slice(0, 3), ...invariants.slice(0, 2)];
      return { summary, highlights, files };
    }
    case 'schema': {
      const tables = readRecordArray(payload.tables)
        .map((entry) => readString(entry.name))
        .filter((value): value is string => Boolean(value));
      const relations = readRecordArray(payload.relations);
      const migrations = readStringArray(payload.migrations);
      const schemaFiles = readStringArray(payload.schema_files);
      const files = [...migrations, ...schemaFiles];
      const summary = `Schema tables ${tables.length}, relations ${relations.length}`;
      return { summary, highlights: tables.slice(0, 4), files };
    }
    case 'api': {
      const endpoints = readRecordArray(payload.endpoints)
        .map((entry) => {
          const method = readString(entry.method);
          const pathValue = readString(entry.path);
          return method && pathValue ? `${method} ${pathValue}` : null;
        })
        .filter((value): value is string => Boolean(value));
      const graphql = readRecordArray(payload.graphql)
        .map((entry) => readString(entry.name))
        .filter((value): value is string => Boolean(value));
      const files = [...readStringArray(payload.openapi_files), ...readStringArray(payload.graphql_files)];
      const summary = `API endpoints ${endpoints.length}, GraphQL ops ${graphql.length}`;
      const highlights = [...endpoints.slice(0, 3), ...graphql.slice(0, 2)];
      return { summary, highlights, files };
    }
    case 'deps': {
      const graph = isRecord(payload.graph) ? payload.graph : null;
      const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
      const vulnerabilities = readRecordArray(payload.vulnerabilities);
      const services = readStringArray(payload.external_services);
      const summary = `Dependencies ${nodes.length}, vulnerabilities ${vulnerabilities.length}, services ${services.length}`;
      const depNames = nodes.map((node) => readString(node.name)).filter((value): value is string => Boolean(value));
      const vulnNames = vulnerabilities.map((entry) => readString(entry.package)).filter((value): value is string => Boolean(value));
      const highlights = [...depNames.slice(0, 3), ...vulnNames.slice(0, 2), ...services.slice(0, 2)];
      const files = readStringArray(payload.lockfiles);
      return { summary, highlights, files };
    }
    case 'adr': {
      const title = readString(payload.title);
      const summary = readString(payload.summary) ?? (title ? `ADR: ${title}` : 'ADR summary');
      const relatedFiles = readStringArray(payload.relatedFiles);
      const links = readStringArray(payload.links);
      const files = [readString(payload.path), ...relatedFiles].filter((value): value is string => Boolean(value));
      const highlights = [title, ...links].filter((value): value is string => Boolean(value));
      return { summary, highlights: highlights.slice(0, 4), files };
    }
    default:
      return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function countFindings(value: unknown): number {
  if (!isRecord(value)) return 0;
  const findings = Array.isArray(value.findings) ? value.findings.length : 0;
  return findings;
}

function collectRelevantFiles(
  response: LibrarianResponse,
  workspace: string | undefined
): Map<string, string> {
  const files = collectFilesForGraph(response);
  const map = new Map<string, string>();
  for (const file of files) {
    const relative = toRelativePath(workspace, file);
    map.set(relative, normalizePath(file));
  }
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTestPayload(value: unknown): value is { mappings: IngestTestMapping[] } {
  return isRecord(value) && Array.isArray(value.mappings);
}

function isCommitPayload(value: unknown): value is CommitRecord {
  if (!isRecord(value)) return false;
  return typeof value.commitHash === 'string' && Array.isArray(value.filesChanged);
}

function isOwnershipPayload(value: unknown): value is OwnershipRecord {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string'
    && typeof value.primaryOwner === 'string'
    && Array.isArray(value.contributors);
}

function isAdrPayload(value: unknown): value is AdrRecord {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string' && typeof value.title === 'string';
}

function compileCodeownerPattern(pattern: string): RegExp | null {
  let normalized = pattern.trim();
  if (!normalized || normalized.startsWith('#')) return null;
  if (normalized.startsWith('!')) normalized = normalized.slice(1);
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  if (normalized.endsWith('/')) normalized = `${normalized}**`;
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const globbed = escaped
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '.');
  return new RegExp(`^${globbed}$`);
}

async function collectIngestionContext(
  storage: LibrarianStorage,
  response: LibrarianResponse,
  workspace: string | undefined,
  query: LibrarianQuery
): Promise<{
  testMapping: TestMapping[];
  ownerMapping: OwnerMapping[];
  recentChanges: ChangeContext[];
  patterns: PatternMatch[];
  knowledgeSources: KnowledgeSourceRef[];
}> {
  const fileMap = collectRelevantFiles(response, workspace);
  const testMapping: TestMapping[] = [];
  const ownerMapping: OwnerMapping[] = [];
  const recentChanges: ChangeContext[] = [];
  const patterns: PatternMatch[] = [];
  const knowledgeSources: KnowledgeSourceRef[] = [];

  const testItem = await storage.getIngestionItem('test:knowledge');
  const testMappings = new Map<string, Set<string>>();
  if (testItem && isTestPayload(testItem.payload)) {
    for (const entry of testItem.payload.mappings) {
      if (!entry?.testFile || !Array.isArray(entry.sourceFiles)) continue;
      for (const source of entry.sourceFiles) {
        const normalizedSource = normalizePath(source);
        const set = testMappings.get(normalizedSource) ?? new Set<string>();
        set.add(entry.testFile);
        testMappings.set(normalizedSource, set);
      }
    }
  }

  const teamItems = await storage.getIngestionItems({ sourceType: 'team', limit: 20 });
  const teamPatterns: Array<{ regex: RegExp; owners: string[] }> = [];
  for (const item of teamItems) {
    if (!isRecord(item.payload)) continue;
    const entries = Array.isArray(item.payload.entries) ? item.payload.entries : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const pattern = typeof entry.pattern === 'string' ? entry.pattern : '';
      const owners = Array.isArray(entry.owners) ? entry.owners.filter((owner) => typeof owner === 'string') : [];
      const regex = compileCodeownerPattern(pattern);
      if (regex && owners.length) teamPatterns.push({ regex, owners });
    }
  }

  for (const [relative, absolute] of fileMap.entries()) {
    const tests = Array.from(testMappings.get(relative) ?? []).map((file) => resolveWorkspacePath(workspace, file));
    testMapping.push({ file: absolute, tests });
    const owners = new Set<string>();
    const ownershipItem = await storage.getIngestionItem(`ownership:${relative}`);
    if (ownershipItem && isOwnershipPayload(ownershipItem.payload)) {
      owners.add(ownershipItem.payload.primaryOwner);
      ownershipItem.payload.contributors.forEach((owner) => owners.add(owner));
    }
    for (const pattern of teamPatterns) {
      if (pattern.regex.test(relative)) {
        pattern.owners.forEach((owner) => owners.add(owner));
      }
    }
    ownerMapping.push({ file: absolute, owners: Array.from(owners.values()) });
  }

  const commitItems = await storage.getIngestionItems({ sourceType: 'commit', limit: 120 });
  for (const item of commitItems) {
    if (!isCommitPayload(item.payload)) continue;
    const commit = item.payload;
    const touches = commit.filesChanged.some((file) => fileMap.has(normalizePath(file)));
    if (!touches) continue;
    const relatedFiles = commit.filesChanged.map((file) => resolveWorkspacePath(workspace, file));
    const summary = typeof commit.semanticSummary === 'string' && commit.semanticSummary.trim().length > 0
      ? commit.semanticSummary
      : typeof commit.message === 'string' && commit.message.trim().length > 0
        ? commit.message
        : 'Recent change';
    recentChanges.push({
      summary,
      relatedFiles,
      packId: commit.commitHash,
    });
    if (recentChanges.length >= 5) break;
  }

  const adrItems = await storage.getIngestionItems({ sourceType: 'adr', limit: 60 });
  for (const item of adrItems) {
    if (!isAdrPayload(item.payload)) continue;
    const adr = item.payload;
    const related = Array.isArray(adr.relatedFiles) ? adr.relatedFiles : [];
    const touches = related.some((file) => fileMap.has(normalizePath(file))) || fileMap.has(adr.path);
    if (!touches) continue;
    const relatedFiles = related.length
      ? related.map((file) => resolveWorkspacePath(workspace, file))
      : [resolveWorkspacePath(workspace, adr.path)];
    const status = adr.status ? ` (${adr.status})` : '';
    const detail = typeof adr.summary === 'string' && adr.summary.trim().length > 0
      ? adr.summary
      : typeof adr.decision === 'string' && adr.decision.trim().length > 0
        ? adr.decision
        : typeof adr.context === 'string' && adr.context.trim().length > 0
          ? adr.context
          : 'See ADR';
    const summary = `ADR${status}: ${adr.title} - ${detail}`;
    patterns.push({ summary, relatedFiles, packId: adr.path });
    if (patterns.length >= 4) break;
  }

  const knowledgeItems = await loadKnowledgeItems(storage);
  knowledgeSources.push(...buildKnowledgeSources(knowledgeItems, query, fileMap, workspace));

  return { testMapping, ownerMapping, recentChanges, patterns, knowledgeSources };
}
async function hydrateCandidates(results: SimilarityResult[], storage: LibrarianStorage): Promise<Candidate[]> {
  return Promise.all(results.map(async (result) => {
    const stats = await getEntityStats(result.entityId, result.entityType, storage);
    return {
      entityId: result.entityId,
      entityType: result.entityType,
      path: stats.path,
      semanticSimilarity: result.similarity,
      confidence: stats.confidence,
      recency: stats.recency,
      pagerank: 0,
      centrality: 0,
      communityId: null,
    } as Candidate;
  }));
}
async function getEntityStats(entityId: string, entityType: GraphEntityType, storage: LibrarianStorage): Promise<{ confidence: number; recency: number; path?: string }> {
  try {
    if (entityType === 'function') {
      const fn = await storage.getFunction(entityId);
      return {
        confidence: fn?.confidence ?? ENTITY_CONFIDENCE_FALLBACK,
        recency: computeRecency(fn?.lastAccessed ?? null),
        path: fn?.filePath,
      };
    }
    const mod = await storage.getModule(entityId);
    return {
      confidence: mod?.confidence ?? ENTITY_CONFIDENCE_FALLBACK,
      recency: ENTITY_RECENCY_DEFAULT,
      path: mod?.path,
    };
  } catch {
    return { confidence: ENTITY_CONFIDENCE_FALLBACK, recency: ENTITY_RECENCY_FALLBACK };
  }
}
async function loadGraphMetrics(
  storage: GraphMetricsStore,
  candidates: Candidate[],
  metricsByType: Map<GraphEntityType, GraphMetricsEntry[]>,
  recordCoverageGap: RecordCoverageGap,
  capabilities: StorageCapabilities
): Promise<boolean> {
  if (!capabilities.optional.graphMetrics || !storage.getGraphMetrics) {
    recordCoverageGap('graph_expansion', 'Graph metrics unavailable for scoring.', 'moderate', 'Re-run bootstrap with graph metrics enabled.');
    return false;
  }
  let anyMetrics = false;
  const types = Array.from(new Set(candidates.map((c) => c.entityType)));
  for (const type of types) {
    try {
      const metrics = await storage.getGraphMetrics({ entityType: type });
      if (metrics.length) {
        metricsByType.set(type, metrics);
        anyMetrics = true;
      } else {
        recordCoverageGap('graph_expansion', `Graph metrics missing for ${type} entities.`, 'moderate');
      }
    } catch {
      recordCoverageGap('graph_expansion', `Graph metrics lookup failed for ${type} entities.`, 'moderate');
    }
  }
  return anyMetrics;
}
function applyGraphMetrics(candidates: Candidate[], metricsByType: Map<GraphEntityType, GraphMetricsEntry[]>): void {
  const cache = new Map<GraphEntityType, Map<string, GraphMetricsEntry>>();
  for (const [type, metrics] of metricsByType) { const map = new Map<string, GraphMetricsEntry>(); for (const entry of metrics) map.set(entry.entityId, entry); cache.set(type, map); }
  for (const candidate of candidates) { const metrics = cache.get(candidate.entityType)?.get(candidate.entityId); if (!metrics) continue; candidate.pagerank = metrics.pagerank; candidate.centrality = computeCentrality(metrics); candidate.communityId = metrics.communityId; }
}
async function expandCandidates(candidates: Candidate[], metricsByType: Map<GraphEntityType, GraphMetricsEntry[]>, storage: LibrarianStorage, depth: LibrarianQuery['depth']): Promise<{ candidates: Candidate[]; communityAdded: number; graphAdded: number }> {
  if (!candidates.length || !metricsByType.size) return { candidates: [], communityAdded: 0, graphAdded: 0 };
  const bySignal = [...candidates].sort((a, b) => b.semanticSimilarity - a.semanticSimilarity); const topCandidates = bySignal.slice(0, 3);
  const existing = new Set(candidates.map((candidate) => candidateKey(candidate))); const expansions: Candidate[] = [];
  let communityAdded = 0; let graphAdded = 0; const communityLimit = depth === 'L3' ? 6 : depth === 'L2' ? 4 : 2; const graphLimit = depth === 'L3' ? 6 : depth === 'L2' ? 4 : 2;
  const embeddingsByType = new Map<GraphEntityType, Map<string, Float32Array>>(); for (const [type, metrics] of metricsByType) embeddingsByType.set(type, buildMetricEmbeddings(metrics));
  for (const candidate of topCandidates) {
    const metrics = metricsByType.get(candidate.entityType); if (!metrics) continue;
    if (candidate.communityId !== null) {
      const communityMembers = metrics.filter((entry) => entry.communityId === candidate.communityId).sort((a, b) => b.pagerank - a.pagerank);
      for (const entry of communityMembers) {
        if (communityAdded >= communityLimit) break; const key = `${candidate.entityType}:${entry.entityId}`; if (existing.has(key)) continue; existing.add(key);
        const stats = await getEntityStats(entry.entityId, candidate.entityType, storage);
        expansions.push({ entityId: entry.entityId, entityType: candidate.entityType, path: stats.path, semanticSimilarity: 0, confidence: stats.confidence, recency: stats.recency, pagerank: 0, centrality: 0, communityId: entry.communityId });
        communityAdded += 1;
      }
    }
    const embeddings = embeddingsByType.get(candidate.entityType);
    if (embeddings) {
      const neighbors = findGraphNeighbors(candidate.entityId, embeddings, {
        limit: graphLimit,
        minSimilarity: GRAPH_NEIGHBOR_MIN_SIMILARITY,
      });
      for (const neighbor of neighbors) {
        if (graphAdded >= graphLimit) break; const key = `${candidate.entityType}:${neighbor.entityId}`; if (existing.has(key)) continue; existing.add(key);
        const stats = await getEntityStats(neighbor.entityId, candidate.entityType, storage);
        expansions.push({ entityId: neighbor.entityId, entityType: candidate.entityType, path: stats.path, semanticSimilarity: 0, graphSimilarity: neighbor.similarity, confidence: stats.confidence, recency: stats.recency, pagerank: 0, centrality: 0, communityId: null });
        graphAdded += 1;
      }
    }
  }
  return { candidates: expansions, communityAdded, graphAdded };
}
function mergeCandidates(primary: Candidate[], additions: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const candidate of [...primary, ...additions]) {
    const key = candidateKey(candidate); const existing = map.get(key);
    if (!existing) { map.set(key, candidate); continue; }
    existing.semanticSimilarity = Math.max(existing.semanticSimilarity, candidate.semanticSimilarity);
    if (candidate.graphSimilarity !== undefined) existing.graphSimilarity = Math.max(existing.graphSimilarity ?? 0, candidate.graphSimilarity);
    if (!existing.path && candidate.path) existing.path = candidate.path;
    if (candidate.cochange !== undefined) existing.cochange = Math.max(existing.cochange ?? 0, candidate.cochange);
    existing.confidence = Math.max(existing.confidence, candidate.confidence); existing.recency = Math.max(existing.recency, candidate.recency);
  }
  return Array.from(map.values());
}
function scoreCandidates(candidates: Candidate[]): void {
  if (!candidates.length) return;
  const semanticValues = candidates.map((candidate) => Math.max(candidate.semanticSimilarity, candidate.graphSimilarity ?? 0));
  const pagerankValues = candidates.map((candidate) => candidate.pagerank);
  const centralityValues = candidates.map((candidate) => candidate.centrality);
  const confidenceValues = candidates.map((candidate) => candidate.confidence);
  const recencyValues = candidates.map((candidate) => candidate.recency);
  const cochangeValues = candidates.map((candidate) => candidate.cochange ?? 0);
  const semanticRange = scoreRange(semanticValues); const pagerankRange = scoreRange(pagerankValues); const centralityRange = scoreRange(centralityValues);
  const confidenceRange = scoreRange(confidenceValues); const recencyRange = scoreRange(recencyValues); const cochangeRange = scoreRange(cochangeValues);
  for (const candidate of candidates) {
    const semanticSignal = Math.max(candidate.semanticSimilarity, candidate.graphSimilarity ?? 0);
    candidate.score = SCORE_WEIGHTS.semantic * normalizeScore(semanticSignal, semanticRange)
      + SCORE_WEIGHTS.pagerank * normalizeScore(candidate.pagerank, pagerankRange)
      + SCORE_WEIGHTS.centrality * normalizeScore(candidate.centrality, centralityRange)
      + SCORE_WEIGHTS.confidence * normalizeScore(candidate.confidence, confidenceRange)
      + SCORE_WEIGHTS.recency * normalizeScore(candidate.recency, recencyRange)
      + SCORE_WEIGHTS.cochange * normalizeScore(candidate.cochange ?? 0, cochangeRange);
  }
}
async function applyMultiVectorScores(options: {
  storage: LibrarianStorage;
  candidates: Candidate[];
  query: LibrarianQuery;
  queryEmbedding: Float32Array;
}): Promise<{ applied: number; missing: number }> {
  const { storage, candidates, query, queryEmbedding } = options;
  const moduleCandidates = candidates.filter((candidate) => candidate.entityType === 'module');
  if (!moduleCandidates.length) return { applied: 0, missing: 0 };
  const multiVectorStore = storage as LibrarianStorage & {
    getMultiVectors?: (options?: MultiVectorQueryOptions) => Promise<MultiVectorRecord[]>;
  };
  if (!multiVectorStore.getMultiVectors) {
    return { applied: 0, missing: moduleCandidates.length };
  }
  const records = await multiVectorStore.getMultiVectors({
    entityIds: moduleCandidates.map((candidate) => candidate.entityId),
    entityType: 'module',
  });
  if (!records.length) return { applied: 0, missing: moduleCandidates.length };
  const vectors = records.map((record) => {
    const vector = deserializeMultiVector(record.payload as SerializedMultiVector);
    return { ...vector, filePath: record.entityId };
  });
  const queryType = resolveMultiVectorQueryType(query);
  const matches = await queryMultiVectors(
    {
      queryText: query.intent,
      queryEmbedding,
    },
    vectors,
    {
      topK: vectors.length,
      queryType,
    }
  );
  const matchByEntity = new Map(matches.map((match) => [match.filePath, match]));
  let applied = 0;
  for (const candidate of moduleCandidates) {
    const match = matchByEntity.get(candidate.entityId);
    if (!match) continue;
    candidate.score = blendScores(candidate.score, match.weightedScore, MULTI_VECTOR_BLEND_WEIGHT);
    applied += 1;
  }
  const missing = Math.max(0, moduleCandidates.length - records.length);
  return { applied, missing };
}
function resolveMultiVectorQueryType(query: LibrarianQuery): keyof typeof QUERY_TYPE_WEIGHTS {
  const taskType = query.taskType?.toLowerCase() ?? '';
  const intent = query.intent?.toLowerCase() ?? '';
  const combined = `${taskType} ${intent}`.trim();
  if (!combined) return 'default';
  // PURPOSE QUERIES: "What does X do?", "Explain X", "Purpose of X", "Understand X"
  // These need the pure purpose vector, not implementation details
  if (matchesAny(combined, ['what does', 'what is', 'explain', 'purpose', 'understand', 'how does', 'why does', 'describe', 'overview', 'summary'])) {
    return 'purpose-query';
  }
  if (matchesAny(combined, ['api', 'interface', 'contract', 'schema', 'endpoint', 'client', 'signature', 'public'])) {
    return 'compatible-apis';
  }
  if (matchesAny(combined, ['dependency', 'dependencies', 'import', 'integration', 'module', 'impact', 'coupling', 'graph'])) {
    return 'related-modules';
  }
  if (matchesAny(combined, ['structure', 'architecture', 'pattern', 'refactor', 'design', 'layout'])) {
    return 'similar-structure';
  }
  if (matchesAny(combined, ['similar', 'equivalent', 'analogue', 'analogy', 'compare', 'related'])) {
    return 'similar-purpose';
  }
  return 'default';
}
function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
function blendScores(base: number | undefined, extra: number, weight: number): number {
  if (typeof base !== 'number' || Number.isNaN(base)) return extra;
  const clampedWeight = Math.min(BLEND_WEIGHT_MAX, Math.max(BLEND_WEIGHT_MIN, weight));
  return base * (1 - clampedWeight) + extra * clampedWeight;
}
function resolveCochangeAnchors(query: LibrarianQuery, directPacks: ContextPack[]): string[] {
  const anchors = new Set<string>();
  for (const file of query.affectedFiles ?? []) {
    if (file) anchors.add(file);
  }
  if (anchors.size < 6) {
    for (const pack of directPacks) {
      for (const file of pack.relatedFiles) {
        if (file) anchors.add(file);
      }
    }
  }
  return Array.from(anchors.values()).slice(0, 8);
}
async function applyCochangeScores(storage: LibrarianStorage, candidates: Candidate[], anchorFiles: string[]): Promise<number> {
  if (!candidates.length || anchorFiles.length === 0) return 0;
  const workspaceRoot = await resolveWorkspaceRoot(storage);
  const normalizedAnchors = anchorFiles
    .map((file) => normalizeCochangePath(file, workspaceRoot))
    .filter((value): value is string => Boolean(value));
  if (!normalizedAnchors.length) return 0;
  const edgeCache = new Map<string, number>();
  let boosted = 0;
  for (const candidate of candidates) {
    const candidatePath = candidate.path ? normalizeCochangePath(candidate.path, workspaceRoot) : null;
    if (!candidatePath) {
      candidate.cochange = 0;
      continue;
    }
    let maxStrength = 0;
    for (const anchor of normalizedAnchors) {
      if (anchor === candidatePath) continue;
      const key = anchor < candidatePath ? `${anchor}||${candidatePath}` : `${candidatePath}||${anchor}`;
      let strength = edgeCache.get(key);
      if (strength === undefined) {
        const edges = await storage.getCochangeEdges({ fileA: anchor, fileB: candidatePath, limit: 1 });
        strength = edges[0]?.strength ?? 0;
        edgeCache.set(key, strength);
      }
      if (strength > maxStrength) maxStrength = strength;
    }
    if (maxStrength > 0) boosted += 1;
    candidate.cochange = maxStrength;
  }
  return boosted;
}
async function resolveWorkspaceRoot(storage: LibrarianStorage): Promise<string> {
  try {
    const metadata = await storage.getMetadata();
    if (metadata?.workspace) return metadata.workspace;
  } catch {
    // Fall back to cwd when metadata is unavailable.
  }
  return process.cwd();
}
function normalizeCochangePath(value: string, workspaceRoot: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) return null;
  return relative;
}
async function collectCandidatePacks(storage: LibrarianStorage, candidates: Candidate[], depth: LibrarianQuery['depth']): Promise<ContextPack[]> {
  const packs: ContextPack[] = [];
  for (const candidate of candidates) {
    const packTypes = candidate.entityType === 'function'
      ? ['function_context']
      : depth === 'L3'
        ? ['module_context', 'change_impact', 'pattern_context', 'decision_context', 'similar_tasks']
        : depth === 'L2'
          ? ['module_context', 'change_impact']
          : ['module_context'];
    for (const packType of packTypes) { const pack = await storage.getContextPackForTarget(candidate.entityId, packType); if (pack) packs.push(pack); }
  }
  return dedupePacks(packs);
}
async function maybeRerankWithCrossEncoder(
  query: LibrarianQuery,
  packs: ContextPack[],
  scoreByTarget: Map<string, number>,
  explanationParts: string[],
  recordCoverageGap: RecordCoverageGap
): Promise<ContextPack[]> {
  if (!query.intent || packs.length < 2) return packs;
  if (query.depth !== 'L2' && query.depth !== 'L3') return packs;
  if (!isCrossEncoderEnabled()) return packs;

  const rerankTop = Math.min(packs.length, query.depth === 'L3' ? 14 : 10);
  const rerankSlice = packs.slice(0, rerankTop);
  const inputs = rerankSlice.map((pack) => ({
    document: buildCrossEncoderDocument(pack),
    biEncoderScore: scoreByTarget.get(pack.targetId) ?? pack.confidence,
  }));

  try {
    const { hybridRerank } = await import('./embedding_providers/cross_encoder_reranker.js');
    const reranked = await hybridRerank(query.intent, inputs, {
      topK: rerankTop,
      returnTopN: rerankTop,
      biEncoderWeight: CROSS_ENCODER_BI_WEIGHT,
      crossEncoderWeight: CROSS_ENCODER_CROSS_WEIGHT,
    });
    const reordered = reranked.map((entry) => rerankSlice[entry.index]).filter(Boolean);
    if (reordered.length === rerankSlice.length) {
      explanationParts.push(`Re-ranked top ${rerankTop} packs with cross-encoder.`);
      return [...reordered, ...packs.slice(rerankTop)];
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCoverageGap('reranking', `Cross-encoder rerank unavailable (${message}).`, 'minor');
  }

  return packs;
}
function buildCrossEncoderDocument(pack: ContextPack): string {
  const parts = [
    `Type: ${pack.packType}`,
    pack.summary,
    pack.keyFacts.slice(0, 6).join(' | '),
    pack.relatedFiles.length ? `Files: ${pack.relatedFiles.slice(0, 4).join(', ')}` : '',
  ].filter(Boolean);
  const joined = parts.join('\n');
  return joined.length > 1200 ? joined.slice(0, 1200) : joined;
}
function isCrossEncoderEnabled(): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true' || process.env.WVO_DETERMINISTIC === '1') {
    return false;
  }
  const flag = process.env.WVO_LIBRARIAN_CROSS_ENCODER;
  return flag !== '0' && flag !== 'false';
}
function dedupePacks(packs: ContextPack[]): ContextPack[] { const map = new Map<string, ContextPack>(); for (const pack of packs) if (!map.has(pack.packId)) map.set(pack.packId, pack); return Array.from(map.values()); }
function buildExplanation(parts: string[], averageScore: number, candidateCount: number): string {
  const explanation = parts.slice(); if (candidateCount > 0 && Number.isFinite(averageScore)) explanation.push(`Ranked ${candidateCount} candidates (avg score ${averageScore.toFixed(2)}).`);
  return explanation.join(' ');
}
function candidateKey(candidate: Candidate): string { return `${candidate.entityType}:${candidate.entityId}`; }
function computeRecency(date: Date | null): number {
  if (!date) return ENTITY_RECENCY_DEFAULT;
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  const score = Math.exp(-ageDays / RECENCY_DECAY_DAYS);
  return Math.max(0, Math.min(1, score));
}
function computeCentrality(metrics: GraphMetricsEntry): number { return (metrics.betweenness + metrics.closeness + metrics.eigenvector) / 3; }
function scoreRange(values: number[]): { min: number; max: number } { let min = Infinity; let max = -Infinity; for (const value of values) { if (value < min) min = value; if (value > max) max = value; } if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 }; return { min, max }; }
function normalizeScore(value: number, range: { min: number; max: number }): number { const span = range.max - range.min; if (span <= 0) return range.max > 0 ? 1 : 0; return (value - range.min) / span; }
function resolveEvidenceEntityType(pack: ContextPack): 'function' | 'module' | null {
  if (pack.packType === 'function_context') return 'function';
  if (pack.packType === 'module_context' || pack.packType === 'change_impact' || pack.packType === 'pattern_context' || pack.packType === 'decision_context') return 'module';
  return noResult();
}
async function buildWatchDisclosures(options: {
  storage: LibrarianStorage;
  workspaceRoot: string;
  now?: Date;
}): Promise<{ disclosures: string[]; state: WatchState | null; health: WatchHealth | null }> {
  const disclosures: string[] = [];
  let state: WatchState | null = null;
  let health: WatchHealth | null = null;
  try {
    state = await getWatchState(options.storage);
    health = deriveWatchHealth(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    disclosures.push(`unverified_by_trace(watch_state_unavailable): ${message}`);
  }
  if (!state) {
    disclosures.push('unverified_by_trace(watch_state_missing): watch state unavailable');
    return { disclosures, state: null, health: null };
  }

  const now = options.now ?? new Date();
  if (state.storage_attached === false) {
    disclosures.push('unverified_by_trace(watch_storage_detached): watch storage not attached');
  }
  if (state.needs_catchup) {
    disclosures.push('unverified_by_trace(watch_needs_catchup): watch requires catch-up');
  }
  if (health?.suspectedDead) {
    disclosures.push('unverified_by_trace(watch_suspected_dead): watcher heartbeat stale');
  }
  if (state.cursor?.kind === 'git') {
    const headSha = getCurrentGitSha(options.workspaceRoot);
    if (headSha && state.cursor.lastIndexedCommitSha && headSha !== state.cursor.lastIndexedCommitSha) {
      disclosures.push('unverified_by_trace(watch_cursor_stale): watch cursor lags HEAD');
    }
  } else if (state.cursor?.kind === 'fs') {
    const lastReconcile = Date.parse(state.cursor.lastReconcileCompletedAt);
    if (Number.isFinite(lastReconcile)) {
      const stalenessMs = health?.stalenessMs ?? 60_000;
      if (now.getTime() - lastReconcile > stalenessMs) {
        disclosures.push('unverified_by_trace(watch_reconcile_stale): filesystem reconcile is stale');
      }
    }
  }

  return { disclosures, state, health };
}
function assessIndexState(state: IndexState): { warning: string | null; confidenceCap: number | null } {
  if (isReadyPhase(state.phase)) {
    return { warning: null, confidenceCap: null };
  }
  const progress = state.progress;
  const ratio = progress && progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 0;
  const percent = progress && progress.total > 0 ? Math.round(ratio * 100) : null;
  const phaseLabel = state.phase === 'uninitialized' ? 'not initialized' : state.phase.replace('_', ' ');
  const warning = percent !== null
    ? `Index ${phaseLabel} (${percent}% complete). Results may be incomplete.`
    : `Index ${phaseLabel}. Results may be incomplete.`;
  const cap = percent !== null
    ? Math.min(INDEX_CONFIDENCE_CAP_MAX, Math.max(INDEX_CONFIDENCE_CAP_MIN, ratio * INDEX_CONFIDENCE_CAP_SCALE))
    : INDEX_CONFIDENCE_CAP_FALLBACK;
  return { warning, confidenceCap: cap };
}

function generateDrillDownHints(packs: ContextPack[], query: LibrarianQuery): string[] {
  const hints: string[] = []; const relatedFiles = new Set<string>();
  for (const pack of packs) for (const file of pack.relatedFiles) relatedFiles.add(file);
  if (relatedFiles.size) { const files = Array.from(relatedFiles).slice(0, 3); hints.push(`Explore related files: ${files.join(', ')}`); }
  if (packs.length) {
    const avgConfidence = packs.reduce((s, p) => s + p.confidence, 0) / packs.length;
    if (avgConfidence < HINT_LOW_CONFIDENCE_THRESHOLD) {
      hints.push('Results have low confidence. Consider providing more specific file hints.');
    }
  }
  if (query.depth === 'L0' && packs.length < 3) hints.push('Try depth: L1 for more comprehensive results');
  return hints;
}
function getCurrentVersion(): LibrarianVersion { return { major: LIBRARIAN_VERSION.major, minor: LIBRARIAN_VERSION.minor, patch: LIBRARIAN_VERSION.patch, string: LIBRARIAN_VERSION.string, qualityTier: 'full', indexedAt: new Date(), indexerVersion: LIBRARIAN_VERSION.string, features: [...LIBRARIAN_VERSION.features] }; }

/**
 * Creates a query to understand how a specific function works.
 *
 * @param functionName - The name of the function to query about
 * @param filePath - Optional file path hint to narrow search scope
 * @returns A LibrarianQuery configured for L1 depth function exploration
 *
 * @example
 * const query = createFunctionQuery('parseConfig', 'src/config/parser.ts');
 */
export function createFunctionQuery(functionName: string, filePath?: string): LibrarianQuery { return { intent: `How does ${functionName} work?`, affectedFiles: filePath ? [filePath] : undefined, depth: 'L1' }; }

/**
 * Creates a query to understand what a specific file does.
 *
 * @param filePath - The path to the file to query about
 * @returns A LibrarianQuery configured for L1 depth file exploration
 *
 * @example
 * const query = createFileQuery('src/auth/middleware.ts');
 */
export function createFileQuery(filePath: string): LibrarianQuery { return { intent: 'What does this file do?', affectedFiles: [filePath], depth: 'L1' }; }

/**
 * Creates a query to find code related to a concept or domain.
 *
 * @param concept - The concept or topic to search for (e.g., 'authentication', 'error handling')
 * @param context - Optional array of file paths to provide context hints
 * @returns A LibrarianQuery configured for L1 depth concept exploration
 *
 * @example
 * const query = createRelatedQuery('authentication', ['src/auth/']);
 */
export function createRelatedQuery(concept: string, context?: string[]): LibrarianQuery { return { intent: `Find code related to: ${concept}`, affectedFiles: context, depth: 'L1' }; }

export const __testing = {
  createStageTracker,
  buildCoverageAssessment,
  buildWatchDisclosures,
  runRerankStage,
  runDefeaterStage,
  runMethodGuidanceStage,
  runSynthesisStage,
};

/**
 * Infer which knowledge sections are relevant for a pack type.
 * Used for domain-specific staleness decay calculation.
 */
function inferPackSections(packType: ContextPack['packType']): string[] {
  switch (packType) {
    case 'function_context':
      return ['semantics', 'identity', 'quality'];
    case 'module_context':
      return ['semantics', 'structure', 'relationships'];
    case 'pattern_context':
      return ['semantics', 'structure'];
    case 'decision_context':
      return ['rationale', 'history'];
    case 'change_impact':
      return ['history', 'relationships'];
    default:
      return ['semantics'];
  }
}
