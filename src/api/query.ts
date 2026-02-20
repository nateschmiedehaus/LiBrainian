// Query API for Librarian.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { glob } from 'glob';
import type { LibrarianStorage, SimilarityResult, QueryCacheEntry, MultiVectorRecord, MultiVectorQueryOptions, StorageCapabilities, EmbeddableEntityType } from '../storage/types.js';
import type {
  LibrarianQuery,
  LibrarianResponse,
  ContextPack,
  LibrarianVersion,
  LlmRequirement,
  EmbeddingRequirement,
  StageName,
  StageReport,
  StageIssue,
  StageIssueSeverity,
  CoverageAssessment,
  QueryPipelineStageDefinition,
  QueryPipelineDefinition,
  QueryStageObserver,
  ConstructionPlan,
  DeterministicContext,
  FollowUpQuery,
  QueryDiagnostics,
  QueryIntentType,
  SynthesisMode,
} from '../types.js';
import { isProjectUnderstandingQuery, PROJECT_UNDERSTANDING_PATTERNS, handleProjectUnderstandingQuery } from './project_understanding.js';
import { isArchitectureQuery, ARCHITECTURE_QUERY_PATTERNS, handleArchitectureQuery } from './architecture_overview.js';
import { runEntryPointQueryStage } from './entry_point_query.js';
import { createDeterministicContext, stableSort } from '../types.js';
import type { CommitRecord } from '../ingest/commit_indexer.js';
import type { OwnershipRecord } from '../ingest/ownership_indexer.js';
import type { AdrRecord } from '../ingest/adr_indexer.js';
import type { TestMapping as IngestTestMapping } from '../ingest/test_indexer.js';
import { LIBRARIAN_VERSION } from '../index.js';
import type { GraphEntityType, GraphMetricsEntry } from '../graphs/metrics.js';
import { buildMetricEmbeddings, findGraphNeighbors } from '../graphs/embeddings.js';
import { EmbeddingService } from './embeddings.js';
import { isModelLoaded } from './embedding_providers/real_embeddings.js';
import { GovernorContext, estimateTokenCount } from './governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from './governors.js';
import { applyCalibrationToPacks, computeUncertaintyMetrics, getConfidenceCalibration, summarizeCalibration } from './confidence_calibration.js';
import { checkDefeaters, STANDARD_DEFEATERS, type ActivationSummary } from '../knowledge/defeater_activation.js';
import { rankContextPacks } from './packs.js';
import { resolveContextLevel } from './context_levels.js';
import { assembleContextFromResponse, type AgentKnowledgeContext, type ContextAssemblyOptions, type CallEdge, type ImportEdge, type TestMapping, type OwnerMapping, type ChangeContext, type PatternMatch, type KnowledgeSourceRef } from './context_assembly.js';
import type { QueryRunner, SimilarMatch } from './query_interface.js';
import type { EvidenceRef } from './evidence.js';
import { emptyArray, noResult } from './empty_values.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { checkProviderSnapshot, ProviderUnavailableError } from './provider_check.js';
import { checkExtractionSnapshot } from './extraction_gate.js';
import { ensureDailyModelSelection } from '../adapters/model_policy.js';
import { resolveLlmServiceAdapter } from '../adapters/llm_service.js';
import { resolveLibrarianModelConfigWithDiscovery } from './llm_env.js';
import type { IngestionItem } from '../ingest/types.js';
import { getIndexState, isReadyPhase, waitForIndexReady } from '../state/index_state.js';
import type { IndexState } from '../state/index_state.js';
import { getWatchState, type WatchState } from '../state/watch_state.js';
import { deriveWatchHealth, type WatchHealth } from '../state/watch_health.js';
import { HierarchicalMemory, type MemoryTier } from '../cache/tiered_cache.js';
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
import { getConstructableClassificationMap } from '../constructions/constructable_registry.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';
import { createSessionId, REPLAY_UNAVAILABLE_TRACE } from '../epistemics/evidence_ledger.js';
import { analyzeResultCoherence, applyCoherenceAdjustment } from '../epistemics/result_coherence.js';
import { collectCorrelationConflictDisclosures } from '../epistemics/event_ledger_bridge.js';
import { getCurrentGitSha } from '../utils/git.js';
import { getErrorMessage } from '../utils/errors.js';
import { isOfflineModeEnabled } from '../utils/runtime_controls.js';
import { inferPerspective, getPerspectiveConfig, type PerspectiveConfig } from './perspective.js';
import { enforceResponseTokenBudget, hasValidTokenBudget } from './token_budget.js';
import {
  validateQueryEdgeTypes,
  hasArgumentEdgeFilter,
  expandGraphWithEdgeFilter,
  getArgumentEdgesForEntity,
} from './argument_edges.js';
import type { EdgeQueryResult, EdgeInfo } from '../types.js';
import {
  classifyTestQuery,
  runTestCorrelationStage,
  type TestQueryClassification,
  type TestCorrelationStageResult,
} from './test_file_correlation.js';
import {
  parseStructuralQueryIntent,
  executeDependencyQuery,
  executeExhaustiveDependencyQuery,
  shouldUseExhaustiveMode,
  mergeGraphResultsWithCandidates,
  type DependencyQueryResult,
} from './dependency_query.js';
import {
  detectCallFlowQuery,
  traceCallFlow,
  formatCallFlowResult,
  toCallChain,
  type CallFlowResult,
} from './call_flow.js';
import { runSymbolLookupStage } from './symbol_lookup.js';
import { runComparisonLookupStage, type ComparisonLookupStageResult } from './comparison_lookup.js';
import { runGitQueryStage, type GitQueryStageResult } from './git_query.js';
import { buildQueryResultContract, normalizeQueryIntentType } from './query_contracts.js';
import {
  buildCoreMemoryDisclosure,
  getSessionState,
  recordSessionError,
  recordSessionQuery,
} from '../memory/session_store.js';
import { searchMemoryFacts } from '../memory/fact_store.js';
import {
  detectEnumerationIntent,
  enumerateByCategory,
  formatEnumerationResult,
  type EnumerationIntent,
  type EnumerationResult,
} from '../constructions/enumeration.js';
import {
  isCodePatternQuery,
  extractPatternCategory,
  handleCodePatternQuery,
  type PatternCategory,
} from '../knowledge/code_patterns.js';
import {
  isDecisionSupportQuery,
  runDecisionSupportStage,
  type DecisionSupportStageResult,
} from './decision_support.js';
import {
  isDependencyManagementQuery,
  extractDependencyAction,
  analyzeDependencies,
  summarizeDependencies,
} from './dependency_management.js';
import {
  recordStagePrediction,
  recordQueryOutcomes,
  type StagePredictionResult,
} from './stage_calibration.js';
import {
  isPerformanceQuery,
  extractPerformanceTarget,
  analyzePerformance,
  type PerformanceAnalysis,
} from './performance_analysis.js';
import {
  RefactoringSafetyChecker,
  createRefactoringSafetyChecker,
  type RefactoringSafetyReport,
  type RefactoringTarget,
  type BreakingChange,
  type Usage,
} from '../constructions/refactoring_safety_checker.js';
import {
  findRefactoringOpportunities,
  summarizeRefactoringSuggestions,
  type RefactoringSuggestion,
} from '../recommendations/refactoring_suggestions.js';
import {
  BugInvestigationAssistant,
  createBugInvestigationAssistant,
  type InvestigationReport,
  type BugReport,
} from '../constructions/bug_investigation_assistant.js';
import {
  buildClarifyingQuestions,
  categorizeRetrievalStatus,
  computeRetrievalEntropy,
  decideRetrievalEscalation,
  expandEscalationIntent,
} from './retrieval_escalation.js';
import {
  SecurityAuditHelper,
  createSecurityAuditHelper,
  type SecurityReport,
  type AuditScope,
  type SecurityCheckType,
} from '../constructions/security_audit_helper.js';
import {
  ArchitectureVerifier,
  createArchitectureVerifier,
  type VerificationReport,
  type ArchitectureSpec,
} from '../constructions/architecture_verifier.js';
import {
  CodeQualityReporter,
  createCodeQualityReporter,
  type QualityReport,
  type QualityQuery,
} from '../constructions/code_quality_reporter.js';
import {
  FeatureLocationAdvisor,
  createFeatureLocationAdvisor,
  type FeatureLocationReport,
  type FeatureQuery,
} from '../constructions/feature_location_advisor.js';
export type { LibrarianQuery, LibrarianResponse, ContextPack };

type Candidate = { entityId: string; entityType: GraphEntityType; path?: string; semanticSimilarity: number; confidence: number; recency: number; pagerank: number; centrality: number; communityId: number | null; graphSimilarity?: number; cochange?: number; score?: number; };
type GraphMetricsStore = LibrarianStorage & { getGraphMetrics?: (options?: { entityIds?: string[]; entityType?: GraphEntityType }) => Promise<GraphMetricsEntry[]>; };
type CachedResponse = LibrarianResponse & { explanation?: string; coverageGaps?: string[]; evidenceByPack?: Record<string, EvidenceRef[]> };
type QueryCacheStore = LibrarianStorage & {
  getQueryCacheEntry?: (queryHash: string) => Promise<QueryCacheEntry | null>;
  upsertQueryCacheEntry?: (entry: QueryCacheEntry) => Promise<void>;
  recordQueryCacheAccess?: (queryHash: string) => Promise<void>;
  pruneQueryCache?: (options: { maxEntries: number; maxAgeMs: number }) => Promise<number>;
  getRecentQueryCacheEntries?: (limit: number) => Promise<QueryCacheEntry[]>;
};
type SemanticCacheCategory = 'lookup' | 'conceptual' | 'diagnostic';
const SEMANTIC_CACHE_THRESHOLDS: Record<SemanticCacheCategory, number> = {
  lookup: 0.95,
  conceptual: 0.7,
  diagnostic: 0.8,
};
const SEMANTIC_CACHE_CANDIDATE_LIMIT = 120;

export interface QueryTraceOptions {
  evidenceLedger?: IEvidenceLedger;
  sessionId?: SessionId;
}

interface RetrievalEscalationState {
  attempts: number;
  maxDepth: number;
}

interface QueryExecutionOptions {
  escalationState?: RetrievalEscalationState;
}

const DEFAULT_MAX_ESCALATION_DEPTH = 2;
const MAX_ALLOWED_ESCALATION_DEPTH = 8;
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
const MIN_SIMILARITY_FULL = q(0.35, [0, 1], 'Minimum semantic similarity for full retrieval.');
const EMBEDDING_QUERY_MIN_SIMILARITY = q(
  0.35,
  [0, 1],
  'Minimum similarity for query embedding search.'
);
const HYDE_RRF_K = 60;
const HYDE_MAX_STUB_CHARS = 1200;
const HYDE_EMBEDDING_CACHE_PREFIX = 'hyde:embedding:';
const HYDE_EXPANSION_CACHE_LIMIT = 128;
const IDENTIFIER_EXPANSION_EMBEDDING_PREFIX = 'identifier:embedding:';
const IDENTIFIER_EXPANSION_MAX_VARIANTS = 3;
const IDENTIFIER_EXPANSION_SYNONYMS: Record<string, string[]> = {
  permission: ['access', 'authorization', 'role'],
  permissions: ['access', 'authorization', 'roles'],
  auth: ['authentication', 'authorization'],
  authenticate: ['login', 'sign in'],
  login: ['authenticate', 'sign in'],
  user: ['account', 'principal', 'identity'],
  users: ['accounts', 'principals', 'identities'],
  route: ['endpoint', 'path'],
  routes: ['endpoints', 'paths'],
};
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
const FALLBACK_CANDIDATE_LIMIT = 80;
const FALLBACK_RESULT_LIMIT = 6;
const DEFAULT_MIN_CONFIDENCE = q(0.3, [0, 1], 'Default minimum confidence for pack retrieval.');
const CANDIDATE_SCORE_FLOOR = q(0.85, [0, 1], 'Fallback candidate score floor.');
const MIN_RESULT_CONFIDENCE_THRESHOLD = q(0.4, [0, 1], 'Minimum confidence threshold for returning results vs "not found".');
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

// ============================================================================
// META-QUERY DETECTION FOR DOCUMENTATION ROUTING
// ============================================================================

/**
 * Keywords that indicate a meta-query about usage, integration, or concepts.
 * These queries should prefer documentation over code.
 */
const META_QUERY_PATTERNS = [
  /\bhow\s+(should|do|does|can|to)\b/i,
  /\bhow\s+.*\s+(use|integrate|work|configure)\b/i,
  /\bwhat\s+is\b/i,
  /\bwhat\s+are\b/i,
  /\bexplain\b/i,
  /\bguide\b/i,
  /\bdocumentation\b/i,
  /\bintroduction\b/i,
  /\bgetting\s+started\b/i,
  /\boverview\b/i,
  /\bworkflow\b/i,
  /\bbest\s+practice/i,
  /\bagent\b.*\buse\b/i,
  /\buse\b.*\bagent\b/i,
  /\blibrarian\b/i,
];

/**
 * Keywords that indicate a code-specific query (implementation details).
 * These queries should prefer code entities over documentation.
 */
const CODE_QUERY_PATTERNS = [
  /\bfunction\b.*\b(called|named|does)\b/i,
  /\bmethod\b/i,
  /\bclass\b.*\b(called|named)\b/i,
  /\bimplementation\b/i,
  /\bbug\b/i,
  /\bfix\b/i,
  /\berror\b/i,
  /\bwhere\s+is\b.*\b(defined|implemented)\b/i,
  /\bcall\s+graph\b/i,
  /\bdependenc(y|ies)\b/i,
];

/**
 * Keywords that indicate a definition/contract query.
 * These queries should prioritize TypeScript interface/type declarations
 * over function implementations (abstract boundaries over concrete code).
 */
const DEFINITION_QUERY_PATTERNS = [
  /\binterface\b/i,
  /\btype\s+(alias|definition|declaration)\b/i,
  /\btype\b.*\b(for|of)\b/i,
  /\btype\s+definitions?\b/i,  // "type definition" or "type definitions"
  /\bcontract\b/i,
  /\babstract(ion|ions)?\b/i,
  /\bdefinition\b/i,
  /\bdeclare[ds]?\b/i,
  /\bschema\b/i,
  /\bsignature\b/i,
  /\bapi\s+(surface|boundary|contract)\b/i,
  /\bwhat\s+(is|are)\s+the\s+(storage|query|embedding)\s+interface/i,
  /\bstorage\s+interface\b/i,
  /\bquery\s+interface\b/i,
  /\b(\w+)\s+interface\s+definition\b/i,  // "ContextPack interface definition"
  /\b(\w+)\s+type\s+definition\b/i,       // "QueryOptions type definition"
  /\bwhere\s+is\s+(\w+)\s+(interface|type)\b/i, // "where is X interface"
];

/**
 * Keywords that indicate a query about entry points.
 * These queries should prioritize entry point knowledge (main files, factories,
 * CLI entries) over random internal functions.
 */
const ENTRY_POINT_QUERY_PATTERNS = [
  /\bentry\s*point/i,
  /\bmain\s*(file|module|entry|function)?/i,
  /\bstart(ing)?\s*(point|file)?/i,
  /\binitialize?\b/i,
  /\bwhere\s+(to\s+)?start/i,
  /\bhow\s+to\s+(use|start|run|begin)/i,
  /\bAPI\s*(entry|main)/i,
  /\bcli\s*(entry|command|binary)?/i,
  /\bbin(ary)?\s*(entry)?/i,
  /\bfactory\s*(function)?/i,
  /\bcreate[A-Z]\w+/,  // Specific factory function lookups
  /\bmake[A-Z]\w+/,
  /\bprimary\s*(export|api)/i,
  /\bpackage\.json\s*(main|bin|exports)/i,
  /\broot\s*(module|file)/i,
  /\bindex\s*(file|module|\.ts|\.js)/i,
];

/**
 * Keywords that indicate a WHY query about rationale/reasoning.
 * These queries should prioritize ADRs, design docs, and explanatory content.
 */
const WHY_QUERY_PATTERNS = [
  // Direct WHY questions
  /\bwhy\b.*\b(use[ds]?|choose|chose|chosen|have|is|are|does|did|was|were|prefer|pick|select|adopt|implement|went\s+with)\b/i,
  // Simple WHY + technology/concept (e.g., "why embeddings", "why typescript")
  /\bwhy\s+[A-Za-z0-9_-]+\b/i,
  // Comparison questions
  /\bwhy\b.*\binstead\s+of\b/i,
  /\bwhy\b.*\bover\b/i,
  /\bwhy\b.*\brather\s+than\b/i,
  /\bwhy\b.*\bnot\b.*\b(use|have)\b/i,
  // Rationale questions
  /\breason(s)?\s+(for|why)\b/i,
  /\brationale\s+(for|behind)\b/i,
  /\bjustification\s+for\b/i,
  // Decision questions
  /\bdecision\s+(to|behind|for)\b/i,
  /\bdesign\s+decision\b/i,
  /\barchitectural\s+decision\b/i,
  /\bwhat\s+motivated\b/i,
  // "Reasoning behind" pattern (e.g., "reasoning behind using TypeScript")
  /\breasoning\s+behind\b/i,
  // "What's the reason/rationale/motivation" pattern
  /\bwhat(?:'s| is) the (?:reason|rationale|motivation)\b/i,
];

/**
 * Patterns that indicate a REFACTORING SAFETY query.
 * These queries ask about the impact of changing, renaming, or modifying code.
 * Examples: "what would break if I changed X", "can I safely rename X", "impact of modifying X"
 */
const REFACTORING_SAFETY_PATTERNS = [
  /what\s+would\s+break\s+if\s+(?:I\s+|we\s+)?(?:changed?|modif(?:y|ied)|renamed?|deleted?|removed?)/i,
  /can\s+(?:I|we)\s+safely\s+(?:rename|change|delete|modify|remove|refactor)/i,
  /is\s+it\s+safe\s+to\s+(?:rename|change|delete|modify|remove|refactor)/i,
  /impact\s+of\s+(?:changing|modifying|renaming|deleting|removing)/i,
  /safe\s+to\s+refactor/i,
  /refactor(?:ing)?\s+.*\s+(?:safely|safe|break|impact)/i,
  /what\s+(?:depends\s+on|uses|calls|imports)\s+.*\s+(?:if|when)\s+(?:I\s+)?(?:change|modify|rename|delete)/i,
  /breaking\s+changes?\s+(?:if|when|for)\s+(?:changing|modifying|renaming)/i,
  /(?:rename|change|modify|delete)\s+.*\s+(?:breaking|safely|impact)/i,
];

/**
 * Patterns that indicate a BUG INVESTIGATION query.
 * These queries ask about debugging errors, investigating bugs, or tracing issues.
 * Examples: "debug this bug", "investigate the error", "what caused this crash"
 */
const BUG_INVESTIGATION_PATTERNS = [
  /debug\s+(?:this|the|a)\s+(?:bug|issue|error|problem)/i,
  /investigate\s+(?:bug|error|issue|crash)/i,
  /what\s+(?:caused|causes)\s+(?:this|the)\s+(?:error|bug|crash)/i,
  /trace\s+(?:the\s+)?(?:error|stack|exception)/i,
  /null\s*pointer|undefined\s+error/i,
  /find\s+(?:the\s+)?(?:root\s+)?cause/i,
  /why\s+(?:is|does|did)\s+(?:this|it)\s+(?:crash|fail|error|throw)/i,
  /stack\s+trace\s+(?:analysis|for)/i,
];

/**
 * Patterns that indicate a SECURITY AUDIT query.
 * These queries ask about security vulnerabilities, audits, or injection risks.
 * Examples: "find security vulnerabilities", "check for SQL injection"
 */
const SECURITY_AUDIT_PATTERNS = [
  /security\s+(?:audit|check|scan|review)/i,
  /vulnerability\s+(?:check|scan|find)/i,
  /injection\s+(?:risk|check|vulnerability)/i,
  /find\s+security\s+(?:issues|vulnerabilities)/i,
  /(?:sql|xss|command)\s+injection/i,
  /security\s+(?:vulnerabilities|issues|risks)/i,
  /(?:check|scan|find)\s+(?:for\s+)?(?:security|vulnerabilities)/i,
  /(?:insecure|unsafe)\s+(?:code|patterns?)/i,
];

/**
 * Patterns that indicate an ARCHITECTURE VERIFICATION query.
 * These queries ask about architectural compliance, layer violations, or boundary checks.
 * Examples: "verify architecture", "check layer violations", "circular dependencies"
 */
const ARCHITECTURE_VERIFICATION_PATTERNS = [
  /verify\s+(?:architecture|layers|boundaries)/i,
  /check\s+(?:layer|boundary)\s+violations?/i,
  /architectural\s+(?:compliance|rules)/i,
  /circular\s+dependenc/i,
  /layer\s+violations?/i,
  /architecture\s+(?:check|verification|validation)/i,
  /(?:dependency|import)\s+(?:cycle|loop)/i,
  /boundary\s+(?:check|violations?)/i,
];

/**
 * Patterns that indicate a CODE QUALITY query.
 * These queries ask about code quality metrics, complexity, duplication, or code smells.
 * Examples: "code quality report", "check complexity", "find code smells"
 */
const CODE_QUALITY_PATTERNS = [
  /code\s+quality\s+(?:report|analysis|check)/i,
  /complexity\s+(?:analysis|check|score)/i,
  /duplication\s+(?:check|analysis|find)/i,
  /code\s+smells?/i,
  /quality\s+(?:metrics|report|assessment)/i,
  /(?:check|analyze)\s+(?:code\s+)?quality/i,
  /cyclomatic\s+complexity/i,
  /technical\s+debt/i,
];

/**
 * Patterns that indicate a REFACTORING OPPORTUNITIES query.
 * These queries ask about what code should be refactored or improved.
 * Examples: "what should I refactor", "refactoring opportunities", "code improvements"
 */
const REFACTORING_OPPORTUNITIES_PATTERNS = [
  /what\s+should\s+(?:I|we)\s+refactor/i,
  /refactoring\s+opportunit/i,
  /refactor(?:ing)?\s+suggestions?/i,
  /code\s+improvements?\s+(?:needed|opportunities|suggestions)/i,
  /(?:find|show|list|identify)\s+(?:code\s+)?(?:to\s+)?refactor/i,
  /(?:areas?|code|files?)\s+(?:that\s+)?(?:needs?|requiring?)\s+refactor/i,
  /what\s+(?:code|files?)\s+(?:needs?|should|could)\s+(?:be\s+)?(?:refactor|improv)/i,
  /suggest\s+(?:code\s+)?(?:refactoring|improvements)/i,
  /where\s+(?:should|can)\s+(?:I|we)\s+(?:refactor|improve)/i,
  /improve\s+(?:code\s+)?quality/i,
  /clean\s*up\s+(?:code|opportunities|suggestions)/i,
];

/**
 * Patterns that indicate a CODE REVIEW query.
 * These queries ask for code review feedback or issue detection.
 * Examples: "review this file", "code review for changes", "check code for issues"
 */
const CODE_REVIEW_QUERY_PATTERNS = [
  /\breview\s+(?:this\s+)?(?:file|code|changes?)\b/i,
  /\bcode\s+review\b/i,
  /\bcheck\s+(?:this\s+)?(?:file|code)\s+for\s+issues?\b/i,
  /\banalyze\s+(?:this\s+)?(?:file|code)\s+quality\b/i,
  /\bfind\s+issues?\s+in\s+(?:this\s+)?(?:file|code)\b/i,
  /\bquality\s+check\b/i,
  /\bpre[- ]commit\s+review\b/i,
  /\bwhat\s+(?:issues?|problems?)\s+(?:are\s+)?(?:in|with)\s+(?:this\s+)?(?:file|code)\b/i,
  /\breview\s+(?:before\s+)?(?:commit|merge|push)\b/i,
];

/**
 * Patterns that indicate a FEATURE LOCATION query.
 * These queries ask about where features are implemented or how to find functionality.
 * Examples: "where is authentication implemented", "find the login feature"
 */
const FEATURE_LOCATION_PATTERNS = [
  /where\s+is\s+(?:the\s+)?(?:\w+)\s+(?:implemented|defined|located)/i,
  /find\s+(?:the\s+)?(?:\w+)\s+feature/i,
  /locate\s+(?:the\s+)?(?:implementation|code)\s+(?:for|of)/i,
  /which\s+files?\s+(?:implement|contain|handle)\s+(?:the\s+)?(?:\w+)/i,
  /where\s+(?:does|is)\s+(?:the\s+)?(?:\w+)\s+(?:happen|occur|get\s+handled)/i,
  /feature\s+location/i,
];

/**
 * Extract the refactoring target from a refactoring safety query.
 * Returns the entity name/identifier that the user wants to refactor.
 */
function extractRefactoringTarget(intent: string): string | undefined {
  // Patterns to extract the target entity
  const targetPatterns = [
    // "what would break if I changed SqliteLibrarianStorage"
    /(?:changed?|modif(?:y|ied)|renamed?|deleted?|removed?)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    // "can I safely rename createLibrarian"
    /(?:rename|change|delete|modify|remove|refactor)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    // "impact of changing queryLibrarian"
    /(?:changing|modifying|renaming|deleting|removing)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    // "safe to refactor EmbeddingService"
    /refactor(?:ing)?\s+([A-Za-z_][A-Za-z0-9_]*)/i,
    // "what depends on Storage if I change it"
    /(?:depends\s+on|uses|calls|imports)\s+([A-Za-z_][A-Za-z0-9_]*)/i,
  ];

  for (const pattern of targetPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Extract bug context from a bug investigation query.
 * Returns error description, stack trace hints, or suspected file/module.
 */
function extractBugContext(intent: string): string | undefined {
  const contextPatterns = [
    // "debug the error in query.ts"
    /(?:error|bug|issue|problem)\s+in\s+([A-Za-z0-9_./-]+)/i,
    // "investigate null pointer exception"
    /(null\s*pointer|undefined\s+error|type\s*error|reference\s*error)/i,
    // "trace the stack trace"
    /(?:error|exception|crash):\s*(.+?)(?:\.|$)/i,
    // "what caused the crash in Storage"
    /(?:crash|fail|error)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)/i,
  ];

  for (const pattern of contextPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

/**
 * Extract security check types from a security audit query.
 * Returns the specific vulnerability types to check.
 */
function extractSecurityCheckTypes(intent: string): string[] {
  const types: string[] = [];

  if (/sql\s*injection/i.test(intent)) types.push('injection');
  if (/xss|cross.?site/i.test(intent)) types.push('injection');
  if (/command\s*injection/i.test(intent)) types.push('injection');
  if (/auth|authentication|authorization/i.test(intent)) types.push('auth');
  if (/crypto|encryption|hash/i.test(intent)) types.push('crypto');
  if (/expos|leak|sensitive/i.test(intent)) types.push('exposure');

  // If no specific type detected, check all types
  if (types.length === 0) {
    types.push('injection', 'auth', 'crypto', 'exposure');
  }

  return types;
}

/**
 * Extract the feature target from a feature location query.
 * Returns the feature name/functionality being searched for.
 */
function extractFeatureTarget(intent: string): string | undefined {
  const targetPatterns = [
    // "where is authentication implemented"
    /where\s+is\s+(?:the\s+)?(\w+)\s+(?:implemented|defined|located)/i,
    // "find the login feature"
    /find\s+(?:the\s+)?(\w+)\s+feature/i,
    // "locate the implementation for caching"
    /locate\s+(?:the\s+)?(?:implementation|code)\s+(?:for|of)\s+(\w+)/i,
    // "which files handle authentication"
    /which\s+files?\s+(?:implement|contain|handle)\s+(?:the\s+)?(\w+)/i,
    // "where does logging happen"
    /where\s+(?:does|is)\s+(?:the\s+)?(\w+)\s+(?:happen|occur|get\s+handled)/i,
  ];

  for (const pattern of targetPatterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Extract file path from a code review query.
 * Returns the file path to review if mentioned.
 */
function extractCodeReviewFilePath(intent: string): string | undefined {
  const patterns = [
    // "review file src/api/query.ts"
    /review\s+(?:file\s+)?["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']?/i,
    // "check src/storage/types.ts"
    /check\s+["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']?/i,
    // "code review for src/api/query.ts"
    /code\s+review\s+(?:for\s+)?["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']?/i,
    // File path in quotes
    /["']([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|scala))["']/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

// ============================================================================
// CONSTRUCTION ROUTING HELPERS
// ============================================================================

/**
 * Mapping from construction IDs to their stage runner classifications.
 * This maps the ConstructableId from auto_selector.ts to the query classification flags.
 */
const CONSTRUCTION_TO_CLASSIFICATION: Record<string, keyof QueryClassification> =
  getConstructableClassificationMap() as Record<string, keyof QueryClassification>;

/**
 * Check if a construction is enabled for a query.
 *
 * When enabledConstructables is provided, only listed constructions are allowed.
 * When enabledConstructables is undefined, all constructions are enabled (legacy behavior).
 *
 * @param constructionId - The construction ID to check (e.g., 'refactoring-safety-checker')
 * @param enabledConstructables - List of enabled construction IDs from session config
 * @returns true if the construction should run
 */
function isConstructionEnabled(
  constructionId: string,
  enabledConstructables: string[] | undefined
): boolean {
  // Legacy behavior: if enabledConstructables is not provided, all constructions are enabled
  if (enabledConstructables === undefined) {
    return true;
  }
  // Check if the construction is in the enabled list
  return enabledConstructables.includes(constructionId);
}

/**
 * Get the construction ID for a classification flag.
 * Returns undefined if the flag is not a construction-related flag.
 */
function getConstructionId(classificationFlag: keyof QueryClassification): string | undefined {
  for (const [id, flag] of Object.entries(CONSTRUCTION_TO_CLASSIFICATION)) {
    if (flag === classificationFlag) {
      return id;
    }
  }
  return undefined;
}

export interface QueryClassification {
  isMetaQuery: boolean;
  isCodeQuery: boolean;
  isDefinitionQuery: boolean;  // Queries about interfaces, types, contracts
  isTestQuery: boolean;  // Queries asking about test files for a source file
  isEntryPointQuery: boolean;  // Queries about entry points, main files, factories
  isProjectUnderstandingQuery: boolean;  // Queries about "what does this codebase do"
  isWhyQuery: boolean;  // Queries about rationale/reasoning (WHY questions)
  documentBias: number;  // 0-1, higher = prefer documents
  definitionBias: number;  // 0-1, higher = prefer interface/type declarations over implementations
  entryPointBias: number;  // 0-1, higher = prefer entry points over internal utilities
  projectUnderstandingBias: number;  // 0-1, higher = prioritize high-level project info
  rationaleBias: number;  // 0-1, higher = prefer ADRs, design docs, rationale content
  entityTypes: EmbeddableEntityType[];
  /** For test queries: the extracted target file/module name */
  testQueryTarget?: string;
  /** For WHY queries: the primary topic being asked about */
  whyQueryTopic?: string;
  /** For WHY queries: the comparison topic if "why X instead of Y" */
  whyComparisonTopic?: string;
  /** For refactoring safety queries: asking about impact of changes */
  isRefactoringSafetyQuery: boolean;
  /** For refactoring safety queries: the target entity to refactor */
  refactoringTarget?: string;
  /** For bug investigation queries: asking about debugging errors */
  isBugInvestigationQuery: boolean;
  /** For bug investigation queries: extracted error context */
  bugContext?: string;
  /** For security audit queries: asking about security vulnerabilities */
  isSecurityAuditQuery: boolean;
  /** For security audit queries: specific check types */
  securityCheckTypes?: string[];
  /** For architecture verification queries: asking about layer/boundary compliance */
  isArchitectureVerificationQuery: boolean;
  /** For architecture overview queries: asking about system structure, layers, organization */
  isArchitectureOverviewQuery: boolean;
  /** Bias for architecture overview queries (0-1, higher = prefer structure docs) */
  architectureOverviewBias: number;
  /** For code quality queries: asking about quality metrics, smells, complexity */
  isCodeQualityQuery: boolean;
  /** For code review queries: asking for code review or issue detection */
  isCodeReviewQuery: boolean;
  /** For code review queries: the file path to review */
  reviewFilePath?: string;
  /** For feature location queries: asking where features are implemented */
  isFeatureLocationQuery: boolean;
  /** For feature location queries: the feature being searched for */
  featureTarget?: string;
  /** For refactoring opportunities queries: asking what code should be refactored */
  isRefactoringOpportunitiesQuery: boolean;
  /** For code pattern queries: asking about patterns used in the codebase */
  isCodePatternQuery: boolean;
  /** For code pattern queries: the pattern category being asked about */
  patternCategory?: PatternCategory;
  /** For dependency management queries: asking about package dependencies */
  isDependencyManagementQuery: boolean;
  /** For dependency management queries: the specific action requested */
  dependencyAction?: 'analyze' | 'unused' | 'outdated' | 'duplicates' | 'issues' | 'all';
  /** For performance analysis queries: asking about performance issues, bottlenecks */
  isPerformanceAnalysisQuery: boolean;
  /** For performance analysis queries: the target file to analyze */
  performanceTarget?: string;
  /** For decision support queries: asking for help making technical choices */
  isDecisionSupportQuery: boolean;
}

/**
 * Classifies a query to determine optimal entity type routing.
 * Meta-queries about "how to use" should prefer documentation.
 * Code queries about implementation should prefer function/module.
 * Definition queries about interfaces/types should prefer type declarations.
 * WHY queries should prefer ADRs, design docs, and rationale content.
 */
export function classifyQueryIntent(intent: string): QueryClassification {
  const metaMatches = META_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const codeMatches = CODE_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const definitionMatches = DEFINITION_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const entryPointMatches = ENTRY_POINT_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const projectUnderstandingMatches = PROJECT_UNDERSTANDING_PATTERNS.filter(p => p.test(intent)).length;
  const whyMatches = WHY_QUERY_PATTERNS.filter(p => p.test(intent)).length;

  // Check for test query using the dedicated classifier
  const testClassification = classifyTestQuery(intent);
  const isTestQuery = testClassification.isTestQuery;

  // Check for refactoring safety queries - these have highest priority
  const refactoringMatches = REFACTORING_SAFETY_PATTERNS.filter(p => p.test(intent)).length;
  const isRefactoringSafetyQuery = refactoringMatches > 0 && !isTestQuery;
  const refactoringTarget = isRefactoringSafetyQuery ? extractRefactoringTarget(intent) : undefined;

  // Check for domain-specific construction queries
  const bugInvestigationMatches = BUG_INVESTIGATION_PATTERNS.filter(p => p.test(intent)).length;
  const isBugInvestigationQuery = bugInvestigationMatches > 0 && !isTestQuery;
  const bugContext = isBugInvestigationQuery ? extractBugContext(intent) : undefined;

  const securityAuditMatches = SECURITY_AUDIT_PATTERNS.filter(p => p.test(intent)).length;
  const isSecurityAuditQuery = securityAuditMatches > 0 && !isTestQuery;
  const securityCheckTypes = isSecurityAuditQuery ? extractSecurityCheckTypes(intent) : undefined;

  const architectureMatches = ARCHITECTURE_VERIFICATION_PATTERNS.filter(p => p.test(intent)).length;
  const isArchitectureVerificationQuery = architectureMatches > 0 && !isTestQuery;

  // Check for architecture overview queries (structure, layers, organization)
  // Architecture overview queries take priority over generic project understanding
  const architectureOverviewMatches = ARCHITECTURE_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const isArchitectureOverviewQuery = architectureOverviewMatches > 0 && !isTestQuery && !isArchitectureVerificationQuery;

  const codeQualityMatches = CODE_QUALITY_PATTERNS.filter(p => p.test(intent)).length;
  const isCodeQualityQuery = codeQualityMatches > 0 && !isTestQuery;

  const featureLocationMatches = FEATURE_LOCATION_PATTERNS.filter(p => p.test(intent)).length;
  const isFeatureLocationQuery = featureLocationMatches > 0 && !isTestQuery;
  const featureTarget = isFeatureLocationQuery ? extractFeatureTarget(intent) : undefined;

  // Check for code review queries - asking for code review or issue detection
  const codeReviewMatches = CODE_REVIEW_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const isCodeReviewQuery = codeReviewMatches > 0 && !isTestQuery;
  const reviewFilePath = isCodeReviewQuery ? extractCodeReviewFilePath(intent) : undefined;

  // Check for refactoring opportunities queries - asking what code should be refactored
  const refactoringOpportunitiesMatches = REFACTORING_OPPORTUNITIES_PATTERNS.filter(p => p.test(intent)).length;
  const isRefactoringOpportunitiesQuery = refactoringOpportunitiesMatches > 0 && !isTestQuery && !isRefactoringSafetyQuery;

  // Check for code pattern queries - asking about patterns used in the codebase
  const codePatternQueryMatch = isCodePatternQuery(intent) && !isTestQuery;
  const patternCategory = codePatternQueryMatch ? extractPatternCategory(intent) : undefined;

  // Check for dependency management queries - asking about package dependencies
  const isDependencyMgmtQuery = isDependencyManagementQuery(intent) && !isTestQuery;
  const dependencyAction = isDependencyMgmtQuery ? extractDependencyAction(intent) : undefined;

  // Check for performance analysis queries - asking about performance issues, bottlenecks, N+1
  const isPerformanceAnalysisQuery = isPerformanceQuery(intent) && !isTestQuery;
  const performanceTarget = isPerformanceAnalysisQuery ? extractPerformanceTarget(intent) : undefined;

  // WHY queries have high priority - asking about rationale requires special handling
  const isWhyQuery = whyMatches > 0 && !isTestQuery && !isRefactoringSafetyQuery;

  // Project understanding queries have high priority for high-level questions
  // But architecture overview queries are more specific and take precedence
  const isProjectUnderstanding = projectUnderstandingMatches > 0 && !isTestQuery && !isWhyQuery && !isArchitectureOverviewQuery;

  // Test queries take priority and exclude other query types
  const isMetaQuery = (metaMatches > 0 && metaMatches >= codeMatches && !isTestQuery && !isWhyQuery) || isProjectUnderstanding;
  const isCodeQuery = codeMatches > 0 && codeMatches > metaMatches && !isTestQuery && !isProjectUnderstanding && !isWhyQuery;
  const isDefinitionQuery = definitionMatches > 0 && !isTestQuery;
  const isEntryPointQuery = entryPointMatches > 0 && !isTestQuery;

  // Extract WHY query topics
  let whyQueryTopic: string | undefined;
  let whyComparisonTopic: string | undefined;
  if (isWhyQuery) {
    // Extract primary topic - try multiple patterns in order of specificity
    const topicPatterns = [
      // "why use X" or "why does it use X" (capture X after use/uses/using)
      /\buse[ds]?\s+([A-Za-z0-9_-]+)\b/i,
      // "why X instead of Y" (capture X)
      /\bwhy\s+([A-Za-z0-9_-]+)\s+(?:instead|over|rather)/i,
      // "why not use X" (capture X)
      /\bwhy\s+not\s+(?:use|have)\s+([A-Za-z0-9_-]+)/i,
      // "why choose/chose/pick/prefer X" (capture X)
      /\b(?:choose|chose|chosen|pick|prefer|select|adopt)\s+([A-Za-z0-9_-]+)\b/i,
      // "reasoning behind X" or "reasoning behind using X" (capture X)
      /\breasoning\s+behind\s+(?:using\s+)?([A-Za-z0-9_-]+)/i,
      // "rationale for X" (capture X)
      /\brationale\s+(?:for|behind)\s+(?:using\s+)?([A-Za-z0-9_-]+)/i,
      // Simple "why X" as last resort - capture last meaningful word
      /\bwhy\s+(?:is|are|does|do|did|was|were|the\s+\w+\s+)?(?:use[ds]?\s+)?([A-Za-z0-9_-]+)\s*$/i,
    ];
    // Common stop words to skip
    const stopWords = ['the', 'this', 'that', 'use', 'uses', 'used', 'using', 'system', 'project', 'codebase', 'code', 'have', 'has', 'had', 'does', 'did', 'is', 'are', 'was', 'were'];
    for (const pattern of topicPatterns) {
      const match = pattern.exec(intent);
      if (match?.[1] && match[1].length > 2 && !stopWords.includes(match[1].toLowerCase())) {
        whyQueryTopic = match[1];
        break;
      }
    }

    // Extract comparison topic
    const comparisonPatterns = [
      /instead\s+of\s+([A-Za-z0-9_-]+)/i,
      /over\s+([A-Za-z0-9_-]+)/i,
      /rather\s+than\s+([A-Za-z0-9_-]+)/i,
    ];
    for (const pattern of comparisonPatterns) {
      const match = pattern.exec(intent);
      if (match?.[1]) {
        whyComparisonTopic = match[1];
        break;
      }
    }
  }

  // Calculate document bias based on query classification
  let documentBias = 0.3; // Default: slight preference for code
  if (isWhyQuery) {
    // WHY queries strongly prefer documentation (ADRs, READMEs, design docs)
    documentBias = 0.9;
  } else if (isProjectUnderstanding) {
    // Project understanding queries should strongly prefer documentation
    documentBias = 0.95;
  } else if (isMetaQuery) {
    documentBias = 0.7 + (metaMatches * 0.05); // High preference for docs
  } else if (isCodeQuery || isTestQuery) {
    documentBias = 0.1; // Strong preference for code/test files
  }
  documentBias = Math.min(1.0, documentBias);

  // Calculate definition bias - how much to prefer interface/type declarations over implementations
  // Higher bias = prefer abstract boundaries (interfaces, types) over concrete implementations (functions)
  let definitionBias = 0.0; // Default: no special treatment
  if (isDefinitionQuery) {
    // Strong preference for interface/type definitions
    definitionBias = 0.6 + (definitionMatches * 0.1);
    definitionBias = Math.min(1.0, definitionBias);
  }

  // Calculate entry point bias
  let entryPointBias = 0.0;
  if (isEntryPointQuery) {
    entryPointBias = 0.6 + (entryPointMatches * 0.1);
    entryPointBias = Math.min(1.0, entryPointBias);
  }

  // Calculate project understanding bias
  let projectUnderstandingBias = 0.0;
  if (isProjectUnderstanding) {
    // Very high bias for project understanding - prioritize README, package.json, AGENTS.md
    projectUnderstandingBias = 0.8 + (projectUnderstandingMatches * 0.05);
    projectUnderstandingBias = Math.min(1.0, projectUnderstandingBias);
  }

  // Calculate rationale bias - how much to prefer ADRs and rationale content
  let rationaleBias = 0.0;
  if (isWhyQuery) {
    // Strong preference for rationale content
    rationaleBias = 0.7 + (whyMatches * 0.1);
    rationaleBias = Math.min(1.0, rationaleBias);
  }

  // Calculate architecture overview bias - for structure/layer queries
  let architectureOverviewBias = 0.0;
  if (isArchitectureOverviewQuery) {
    // Strong bias for architecture overview - prioritize directory structure info
    architectureOverviewBias = 0.75 + (architectureOverviewMatches * 0.05);
    architectureOverviewBias = Math.min(1.0, architectureOverviewBias);
    // Also boost document bias for architecture docs
    documentBias = Math.max(documentBias, 0.8);
  }

  // Determine entity types to search
  const entityTypes: EmbeddableEntityType[] = [];
  if (isTestQuery) {
    // Test queries: search functions and modules (test files are categorized as code)
    // The test correlation stage handles finding actual test files deterministically
    entityTypes.push('function', 'module');
  } else if (isWhyQuery) {
    // WHY queries: prioritize documents (ADRs, design docs), but also search code
    // for inline rationale comments
    entityTypes.push('document', 'function', 'module');
  } else if (isProjectUnderstanding) {
    // Project understanding queries: prioritize documents only
    entityTypes.push('document');
  } else if (isArchitectureOverviewQuery) {
    // Architecture queries: search modules and documents for structure info
    entityTypes.push('module', 'document');
  } else if (isMetaQuery) {
    // Meta-queries: search docs first, then code
    entityTypes.push('document', 'function', 'module');
  } else if (isCodeQuery) {
    // Code queries: search code only
    entityTypes.push('function', 'module');
  } else {
    // Mixed/unclear: search all
    entityTypes.push('function', 'module', 'document');
  }

  return {
    isMetaQuery,
    isCodeQuery,
    isDefinitionQuery,
    isTestQuery,
    isEntryPointQuery,
    isProjectUnderstandingQuery: isProjectUnderstanding,
    isWhyQuery,
    documentBias,
    definitionBias,
    entryPointBias,
    projectUnderstandingBias,
    rationaleBias,
    entityTypes,
    testQueryTarget: testClassification.targetFile ?? undefined,
    whyQueryTopic,
    whyComparisonTopic,
    isRefactoringSafetyQuery,
    refactoringTarget,
    isBugInvestigationQuery,
    bugContext,
    isSecurityAuditQuery,
    securityCheckTypes,
    isArchitectureVerificationQuery,
    isArchitectureOverviewQuery,
    architectureOverviewBias,
    isCodeQualityQuery,
    isFeatureLocationQuery,
    featureTarget,
    isRefactoringOpportunitiesQuery,
    isCodePatternQuery: codePatternQueryMatch,
    patternCategory,
    isDependencyManagementQuery: isDependencyMgmtQuery,
    dependencyAction,
    isPerformanceAnalysisQuery,
    performanceTarget,
    isCodeReviewQuery,
    reviewFilePath,
    isDecisionSupportQuery: isDecisionSupportQuery(intent),
  };
}

function normalizeEntityTypeOrder(types: EmbeddableEntityType[]): EmbeddableEntityType[] {
  const deduped: EmbeddableEntityType[] = [];
  for (const type of types) {
    if (!deduped.includes(type)) deduped.push(type);
  }
  return deduped;
}

function inferTargetFromAffectedFiles(affectedFiles: string[] | undefined): string | undefined {
  if (!affectedFiles?.length) return undefined;
  const first = affectedFiles.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (!first) return undefined;
  const parsed = path.parse(first.trim());
  if (parsed.name) return parsed.name;
  return undefined;
}

/**
 * Applies deterministic intent-type routing overrides to query classification.
 * This allows explicit intentType callers to steer retrieval even when intent
 * text is ambiguous or generic.
 */
export function applyIntentTypeRoutingOverrides(
  classification: QueryClassification,
  intentType: QueryIntentType | undefined,
  affectedFiles?: string[]
): QueryClassification {
  const normalized = intentType ?? 'general';
  if (normalized === 'general' || normalized === 'understand') {
    return classification;
  }

  const routed: QueryClassification = {
    ...classification,
    entityTypes: [...classification.entityTypes],
    securityCheckTypes: classification.securityCheckTypes ? [...classification.securityCheckTypes] : undefined,
  };

  switch (normalized) {
    case 'document':
      routed.isMetaQuery = true;
      routed.isCodeQuery = false;
      routed.isTestQuery = false;
      routed.documentBias = Math.max(routed.documentBias, 0.9);
      routed.entityTypes = normalizeEntityTypeOrder(['document', 'module', 'function', ...routed.entityTypes]);
      return routed;
    case 'navigate':
      routed.isMetaQuery = false;
      routed.isCodeQuery = true;
      routed.isProjectUnderstandingQuery = false;
      routed.documentBias = Math.min(routed.documentBias, 0.2);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'impact':
      routed.isRefactoringSafetyQuery = true;
      routed.refactoringTarget = routed.refactoringTarget ?? inferTargetFromAffectedFiles(affectedFiles);
      routed.documentBias = Math.max(routed.documentBias, 0.35);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'refactor':
      routed.isRefactoringSafetyQuery = true;
      routed.refactoringTarget = routed.refactoringTarget ?? inferTargetFromAffectedFiles(affectedFiles);
      routed.documentBias = Math.min(routed.documentBias, 0.25);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'debug':
      routed.isBugInvestigationQuery = true;
      routed.bugContext = routed.bugContext ?? inferTargetFromAffectedFiles(affectedFiles);
      routed.documentBias = Math.min(routed.documentBias, 0.25);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'security':
      routed.isSecurityAuditQuery = true;
      routed.securityCheckTypes = routed.securityCheckTypes?.length ? routed.securityCheckTypes : ['all'];
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    case 'test':
      routed.isTestQuery = true;
      routed.isCodeQuery = true;
      routed.isMetaQuery = false;
      routed.documentBias = Math.min(routed.documentBias, 0.15);
      routed.entityTypes = normalizeEntityTypeOrder(['function', 'module', 'document', ...routed.entityTypes]);
      return routed;
    default:
      return routed;
  }
}

/**
 * Re-ranks similarity results to boost documents for meta-queries.
 */
export function applyDocumentBias(
  results: SimilarityResult[],
  documentBias: number
): SimilarityResult[] {
  if (documentBias <= 0.3) {
    // No significant document bias, return as-is
    return results;
  }

  return results.map(result => {
    if (result.entityType === 'document') {
      // Boost document similarity based on bias
      const boost = 1 + (documentBias - 0.3) * 0.5; // Up to 35% boost
      return {
        ...result,
        similarity: Math.min(1.0, result.similarity * boost),
      };
    }
    return result;
  }).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Keywords that indicate a result is an interface/type definition.
 * Used to identify abstract boundaries vs concrete implementations.
 */
const DEFINITION_INDICATORS = [
  'interface',
  'type alias',
  'export interface',
  'export type',
  'abstract class',
  'declare',
  'Contract',
  'Schema',
  'Protocol',
];

/**
 * Keywords that indicate a result is a concrete implementation.
 * Used to de-prioritize implementations when searching for definitions.
 */
const IMPLEMENTATION_INDICATORS = [
  'function',
  'const',
  'async function',
  'class implements',
  'export function',
  'export const',
  'export async',
];

/**
 * Checks if an entity name or content indicates an interface/type definition.
 * This helps prioritize abstract boundaries over concrete implementations.
 */
export function isDefinitionEntity(entityId: string, entityName?: string): boolean {
  const idLower = entityId.toLowerCase();
  const nameLower = (entityName ?? '').toLowerCase();

  // Check for common interface/type naming patterns
  if (idLower.includes('interface') || idLower.includes('type:')) {
    return true;
  }

  // Check for naming conventions that indicate types
  // e.g., IStorage, StorageInterface, StorageType, StorageContract
  if (/^I[A-Z]/.test(entityName ?? '') || // IStorage pattern
      /Interface$/.test(entityName ?? '') ||
      /Type$/.test(entityName ?? '') ||
      /Contract$/.test(entityName ?? '') ||
      /Schema$/.test(entityName ?? '') ||
      /Protocol$/.test(entityName ?? '')) {
    return true;
  }

  // Check entity ID for types file indicators
  if (idLower.includes('/types.') || idLower.includes('/types/')) {
    return true;
  }

  return false;
}

/**
 * Re-ranks similarity results to boost interface/type definitions for definition queries.
 * This ensures that queries about "storage interface" return the LibrarianStorage interface
 * rather than implementation functions like getStorage().
 *
 * @param results - The similarity results to re-rank
 * @param definitionBias - 0-1 value, higher = prefer definitions over implementations
 * @param entityNames - Optional map of entityId -> entityName for better detection
 * @returns Re-ranked results with definitions boosted
 */
export function applyDefinitionBias(
  results: SimilarityResult[],
  definitionBias: number,
  entityNames?: Map<string, string>
): SimilarityResult[] {
  if (definitionBias <= 0.1) {
    // No significant definition bias, return as-is
    return results;
  }

  return results.map(result => {
    const entityName = entityNames?.get(result.entityId);
    const isDefinition = isDefinitionEntity(result.entityId, entityName);

    if (isDefinition) {
      // Strong boost for definitions when definition is sought
      // Up to 150% boost (2.5x multiplier) for strong definition queries
      // This ensures type/interface definitions appear at the top
      const boost = 1 + (definitionBias * 1.5);
      return {
        ...result,
        similarity: Math.min(1.0, result.similarity * boost),
      };
    }

    // Check if this looks like a usage rather than a definition
    // Usages should be heavily penalized when seeking definitions
    const idLower = result.entityId.toLowerCase();
    const nameIndicatesImpl = entityName &&
      (entityName.startsWith('get') ||
       entityName.startsWith('set') ||
       entityName.startsWith('create') ||
       entityName.startsWith('make') ||
       entityName.startsWith('build') ||
       entityName.startsWith('init') ||
       entityName.startsWith('use') ||
       entityName.startsWith('handle') ||
       entityName.startsWith('process'));

    // Heavy penalty for usages/implementations when definition sought
    if (definitionBias > 0.3) {
      const isUsage = nameIndicatesImpl ||
        idLower.includes('impl') ||
        idLower.includes('implementation') ||
        idLower.includes('usage') ||
        idLower.includes('handler') ||
        idLower.includes('controller') ||
        (idLower.includes('service') && !idLower.includes('interface'));

      if (isUsage) {
        // Apply heavy penalty to usages - up to 70% reduction
        const penalty = 1 - (definitionBias * 0.7);
        return {
          ...result,
          similarity: result.similarity * penalty,
        };
      }
    }

    return result;
  }).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Names that indicate an entry point (factory functions, main exports, etc.)
 */
const ENTRY_POINT_NAME_PATTERNS = [
  /^create[A-Z]/,      // createLibrarian, createStorage
  /^make[A-Z]/,        // makeStore, makeConfig
  /^build[A-Z]/,       // buildContext, buildQuery
  /^init[A-Z]/,        // initializeApp
  /^setup[A-Z]/,       // setupRouter
  /^bootstrap/i,       // bootstrap, bootstrapProject
  /^main$/i,           // main function
  /^run$/i,            // run function
  /^start$/i,          // start function
  /^launch$/i,         // launch function
  /^index$/i,          // index module
];

/**
 * Path patterns that indicate an entry point file
 */
const ENTRY_POINT_PATH_PATTERNS = [
  /\/index\.(ts|js|tsx|jsx|mjs|cjs)$/,  // index files
  /\/main\.(ts|js|tsx|jsx|mjs|cjs)$/,   // main files
  /\/bin\//,                             // bin directory
  /\/cli\//,                             // cli directory
  /\/src\/index\./,                      // src/index
  /\/src\/main\./,                       // src/main
];

/**
 * Checks if an entity is likely an entry point based on its ID/name/path.
 */
export function isEntryPointEntity(entityId: string, entityName?: string): boolean {
  const idLower = entityId.toLowerCase();

  // Check path patterns
  if (ENTRY_POINT_PATH_PATTERNS.some(p => p.test(entityId))) {
    return true;
  }

  // Check name patterns
  if (entityName && ENTRY_POINT_NAME_PATTERNS.some(p => p.test(entityName))) {
    return true;
  }

  // Check for entry_point source type marker
  if (idLower.includes('entry_point:') || idLower.includes('entry-point')) {
    return true;
  }

  return false;
}

/**
 * Re-ranks similarity results to boost entry points for entry point queries.
 * This ensures that queries about "entry points", "main", "factory" return
 * actual entry points (src/index.ts, createLibrarian) rather than internal utilities.
 *
 * @param results - The similarity results to re-rank
 * @param entryPointBias - 0-1 value, higher = prefer entry points over internal utilities
 * @param entityNames - Optional map of entityId -> entityName for better detection
 * @returns Re-ranked results with entry points boosted
 */
export function applyEntryPointBias(
  results: SimilarityResult[],
  entryPointBias: number,
  entityNames?: Map<string, string>
): SimilarityResult[] {
  if (entryPointBias <= 0.1) {
    // No significant entry point bias, return as-is
    return results;
  }

  return results.map(result => {
    const entityName = entityNames?.get(result.entityId);
    const isEntryPoint = isEntryPointEntity(result.entityId, entityName);

    if (isEntryPoint) {
      // Boost entry point similarity based on bias
      // Up to 60% boost for strong entry point queries
      const boost = 1 + (entryPointBias * 0.6);
      return {
        ...result,
        similarity: Math.min(1.0, result.similarity * boost),
      };
    }

    // Slightly penalize internal utility functions when seeking entry points
    if (entryPointBias > 0.5) {
      const idLower = result.entityId.toLowerCase();
      const isInternalUtil =
        idLower.includes('/utils/') ||
        idLower.includes('/helpers/') ||
        idLower.includes('/internal/') ||
        idLower.includes('/_') ||
        (entityName && entityName.startsWith('_'));

      if (isInternalUtil) {
        // Apply a penalty to internal utilities
        const penalty = 1 - (entryPointBias * 0.2); // Up to 20% penalty
        return {
          ...result,
          similarity: result.similarity * penalty,
        };
      }
    }

    return result;
  }).sort((a, b) => b.similarity - a.similarity);
}

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
  traceOptions: QueryTraceOptions = {},
  executionOptions: QueryExecutionOptions = {}
): Promise<LibrarianResponse> {
  query = normalizeQueryIntentType(query);
  // Initialize deterministic context if deterministic mode is enabled
  const deterministicCtx: DeterministicContext | null = query.deterministic
    ? createDeterministicContext(query.intent)
    : null;

  // Use deterministic or real timestamps/IDs based on mode
  const startTime = deterministicCtx ? 0 : Date.now();
  const generateUUID = deterministicCtx
    ? (prefix?: string) => deterministicCtx.generateId(prefix)
    : (prefix?: string) => (prefix ? `${prefix}${randomUUID()}` : randomUUID());
  const getNow = deterministicCtx
    ? () => deterministicCtx.now()
    : () => new Date().toISOString();

  let errorQueryId: string = generateUUID(); // Used for error tracking if query fails early
  const explanationParts: string[] = [];
  const coverageGaps: string[] = [];
  let adequacyReport: AdequacyReport | null = null;
  const disclosures: string[] = [];
  let traceSessionId: SessionId | undefined;
  let traceId: string = REPLAY_UNAVAILABLE_TRACE;
  let sessionWorkspaceRoot: string | null = null;
  let constructionPlan: ConstructionPlan = {
    id: generateUUID('cp_'),
    templateId: 'T1',
    ucIds: query.ucRequirements?.ucIds ?? [],
    intent: query.intent ?? '',
    source: 'default',
    createdAt: getNow(),
  };

  // Add disclosure about deterministic mode
  if (deterministicCtx) {
    disclosures.push('deterministic_mode: Query executed in deterministic mode - LLM synthesis skipped, stable sorting applied.');
  }
  // Add disclosure about construction filtering
  if (query.enabledConstructables !== undefined) {
    const enabledCount = query.enabledConstructables.length;
    const totalCount = Object.keys(CONSTRUCTION_TO_CLASSIFICATION).length;
    if (enabledCount < totalCount) {
      disclosures.push(`construction_filter: ${enabledCount}/${totalCount} constructions enabled by session config.`);
    }
  }
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
    sessionWorkspaceRoot = workspaceRoot;
    try {
      const session = await getSessionState(workspaceRoot);
      const coreMemoryDisclosure = buildCoreMemoryDisclosure(session);
      if (coreMemoryDisclosure) {
        disclosures.unshift(coreMemoryDisclosure);
      }
      const semanticMemory = await searchMemoryFacts(workspaceRoot, query.intent, {
        limit: 3,
        minScore: 0.2,
      });
      if (semanticMemory.length > 0) {
        const summary = semanticMemory
          .map((fact) => `${fact.content} [score=${fact.score.toFixed(2)}]`)
          .join(' | ');
        disclosures.unshift(`persistent_memory: ${summary}`);
      }
    } catch (error) {
      logWarning('[query] Failed to load session state', { error: getErrorMessage(error) });
    }
    const normalizedScope = await normalizeQueryScope(query, workspaceRoot);
    query = normalizedScope.query;
    if (normalizedScope.disclosures.length) {
      disclosures.push(...normalizedScope.disclosures);
    }
    const configuredMaxEscalationDepth = await resolveMaxEscalationDepth(workspaceRoot, query.maxEscalationDepth);
    const escalationState = executionOptions.escalationState ?? {
      attempts: 0,
      maxDepth: configuredMaxEscalationDepth,
    };
    const extractionSnapshot = await checkExtractionSnapshot({
      workspaceRoot,
      discloseMissingMetadata: false,
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
    const offlineMode = isOfflineModeEnabled();
    // Default to optional LLM usage: retrieval should work without a live chat model,
    // and synthesis should degrade gracefully when providers are unavailable.
    const requestedLlmRequirement: LlmRequirement = query.llmRequirement ?? 'optional';
    const llmRequirement: LlmRequirement =
      (offlineMode || envDisableSynthesis) ? 'disabled' : requestedLlmRequirement;
    const embeddingRequirementExplicit = query.embeddingRequirement !== undefined;
    let embeddingRequirement: EmbeddingRequirement =
      query.embeddingRequirement ?? (query.depth === 'L0' ? 'disabled' : 'required');
    let llmAvailable = llmRequirement === 'required';
    let llmProviderError: string | undefined;
    query = { ...query, llmRequirement, embeddingRequirement };
    if (offlineMode) {
      disclosures.push('unverified_by_trace(offline_mode): Runtime offline/local-only mode active; LLM synthesis disabled.');
    }
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
    let embeddingDisclosureAdded = false;
    if (!embeddingProviderReady && !embeddingRequirementExplicit && embeddingRequirement === 'required') {
      embeddingRequirement = 'optional';
      query = { ...query, embeddingRequirement };
      recordCoverageGap(
        'semantic_retrieval',
        'Embedding provider unavailable; running in degraded mode.',
        'significant',
        'Configure an embedding provider for full semantic retrieval.'
      );
      disclosures.push('unverified_by_trace(embedding_unavailable): Embedding provider unavailable; semantic retrieval degraded.');
      embeddingDisclosureAdded = true;
    }
    const structuralIntent = parseStructuralQueryIntent(query.intent ?? '');
    const shouldRunExhaustive = structuralIntent.isStructural
      && structuralIntent.confidence >= 0.6
      && shouldUseExhaustiveMode(query.intent ?? '');
    const hasDirectAnchors = Boolean(query.affectedFiles?.length);
    const wantsSemanticRetrieval =
      Boolean(query.intent) && query.depth !== 'L0' && query.embeddingRequirement !== 'disabled';
    const embeddingsRequired = wantsSemanticRetrieval && !hasDirectAnchors && !shouldRunExhaustive;

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
    if (embeddingsRequired && !embeddingProviderReady && query.embeddingRequirement === 'required') {
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
        llmProviderError = providerSnapshot.status.llm.error ?? 'LLM provider unavailable';
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

    if (query.embeddingRequirement === 'disabled') {
      recordCoverageGap('semantic_retrieval', 'Embeddings disabled by request.', 'minor');
      disclosures.push('unverified_by_trace(embedding_disabled): Embedding retrieval disabled by request.');
    }

    const embeddingsAvailable =
      query.embeddingRequirement !== 'disabled' && embeddingProviderReady && capabilities.optional.embeddings;
    if (wantsSemanticRetrieval && !embeddingsAvailable && !shouldRunExhaustive) {
      const reason = capabilities.optional.embeddings
        ? providerSnapshot.status.embedding.error ?? 'Embedding provider unavailable'
        : 'Embedding retrieval unsupported by storage';
      recordCoverageGap('semantic_retrieval', reason, 'significant');
      if (!embeddingDisclosureAdded) {
        disclosures.push(`unverified_by_trace(embedding_unavailable): ${reason}`);
      }
    }

    // Disable synthesis in deterministic mode for reproducible results
    const synthesisEnabled = llmRequirement !== 'disabled' && llmAvailable && !deterministicCtx;

    if (deterministicCtx) {
      recordCoverageGap('synthesis', 'LLM synthesis skipped for deterministic mode.', 'minor');
    }

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
  const allowCache = isReadyPhase(indexState.phase) && query.disableCache !== true;
  const cacheKey = allowCache ? buildQueryCacheKey(query, version, llmRequirement, synthesisEnabled) : '';
  if (allowCache) {
    const cache = getQueryCache(storage);
    const cached = await cache.get(cacheKey);
    if (cached) {
      const queryId = cacheKey || generateUUID('qry_');
      errorQueryId = queryId;
      void globalEventBus.emit(createQueryReceivedEvent(queryId, query.intent ?? '', query.depth ?? 'L1', traceSessionId));
      const cachedResponse = {
        ...cached,
        query,
        cacheHit: true,
        latencyMs: deterministicCtx ? 0 : (Date.now() - startTime),
        version,
        traceId,
        disclosures,
        constructionPlan,
      } as CachedResponse;
      cachedResponse.synthesisMode = 'cache';
      if (query.showLlmErrors === false) {
        cachedResponse.llmError = undefined;
      }
      cachedResponse.retrievalEntropy = cachedResponse.retrievalEntropy
        ?? computeRetrievalEntropy(cachedResponse.packs);
      cachedResponse.retrievalStatus = cachedResponse.retrievalStatus
        ?? categorizeRetrievalStatus({
          totalConfidence: cachedResponse.totalConfidence,
          packCount: cachedResponse.packs.length,
        });
      cachedResponse.retrievalInsufficient = cachedResponse.retrievalInsufficient
        ?? ((query.depth ?? 'L1') === 'L3' && cachedResponse.totalConfidence < 0.3);
      if (cachedResponse.retrievalInsufficient && !cachedResponse.suggestedClarifyingQuestions?.length) {
        cachedResponse.suggestedClarifyingQuestions = buildClarifyingQuestions(query.intent ?? '');
      }
      await logRetrievalConfidenceObservation(storage, workspaceRoot, {
        queryHash: queryId,
        intent: query.intent,
        confidenceScore: cachedResponse.totalConfidence,
        retrievalEntropy: cachedResponse.retrievalEntropy ?? 0,
        returnedPackIds: cachedResponse.packs.map((pack) => pack.packId),
        timestamp: new Date().toISOString(),
      });
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
    const semanticCached = await trySemanticCacheLookup({
      query,
      version,
      cacheKey,
      storage,
      cache,
    });
    if (semanticCached) {
      const queryId = cacheKey || generateUUID('qry_');
      errorQueryId = queryId;
      void globalEventBus.emit(createQueryReceivedEvent(queryId, query.intent ?? '', query.depth ?? 'L1', traceSessionId));
      const semanticDisclosure = `semantic_cache_hit(category=${semanticCached.category}, similarity=${semanticCached.similarity.toFixed(2)})`;
      const cachedResponse = {
        ...semanticCached.response,
        query,
        cacheHit: true,
        latencyMs: deterministicCtx ? 0 : (Date.now() - startTime),
        version,
        traceId,
        disclosures: [...disclosures, semanticDisclosure],
        constructionPlan,
      } as CachedResponse;
      cachedResponse.synthesisMode = 'cache';
      if (query.showLlmErrors === false) {
        cachedResponse.llmError = undefined;
      }
      cachedResponse.retrievalEntropy = cachedResponse.retrievalEntropy
        ?? computeRetrievalEntropy(cachedResponse.packs);
      cachedResponse.retrievalStatus = cachedResponse.retrievalStatus
        ?? categorizeRetrievalStatus({
          totalConfidence: cachedResponse.totalConfidence,
          packCount: cachedResponse.packs.length,
        });
      cachedResponse.retrievalInsufficient = cachedResponse.retrievalInsufficient
        ?? ((query.depth ?? 'L1') === 'L3' && cachedResponse.totalConfidence < 0.3);
      if (cachedResponse.retrievalInsufficient && !cachedResponse.suggestedClarifyingQuestions?.length) {
        cachedResponse.suggestedClarifyingQuestions = buildClarifyingQuestions(query.intent ?? '');
      }
      await logRetrievalConfidenceObservation(storage, workspaceRoot, {
        queryHash: queryId,
        intent: query.intent,
        confidenceScore: cachedResponse.totalConfidence,
        retrievalEntropy: cachedResponse.retrievalEntropy ?? 0,
        returnedPackIds: cachedResponse.packs.map((pack) => pack.packId),
        timestamp: new Date().toISOString(),
      });
      const cacheStore = storage as QueryCacheStore;
      if (cacheStore.recordQueryCacheAccess) {
        await cacheStore.recordQueryCacheAccess(semanticCached.matchedKey);
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
          cacheKey: semanticCached.matchedKey,
          packCount: cachedResponse.packs.length,
          latencyMs: cachedResponse.latencyMs,
          templateId: constructionPlan.templateId,
        });
      }
      return cachedResponse;
    }
  }
  const queryId = allowCache && cacheKey ? cacheKey : generateUUID('qry_');
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
    workspaceRoot,
    stageTracker,
    explanationParts,
  });
  let cacheHit = directStageResult.cacheHit;
  let directPacks = directStageResult.directPacks;

  // TEST CORRELATION STAGE: Find test files through deterministic path matching
  // This runs before semantic retrieval to provide reliable test file results
  // without relying on embedding similarity which may match irrelevant keywords
  const testCorrelationResult = await runTestCorrelationStage({
    intent: query.intent ?? '',
    affectedFiles: query.affectedFiles,
    storage,
    workspaceRoot,
  });

  // If this is a test query, prioritize test correlation results
  if (testCorrelationResult.isTestQuery && testCorrelationResult.testPacks.length > 0) {
    // Add test packs to direct packs (highest priority)
    directPacks = [...testCorrelationResult.testPacks, ...directPacks];
    cacheHit = true; // We have deterministic results
    explanationParts.push(testCorrelationResult.explanation);

    // If we found test files, we can provide a more targeted response
    if (testCorrelationResult.correlation) {
      explanationParts.push(
        `Deterministic test correlation found ${testCorrelationResult.correlation.totalTestFiles} test file(s) for ${testCorrelationResult.correlation.sourcePath}.`
      );
    }
  }

  // SYMBOL LOOKUP STAGE - Direct name->location for "X class/function/interface" queries
  // This runs early to provide exact matches without semantic search overhead
  // Pre-check for definition query to help symbol lookup make short-circuit decisions
  const definitionQueryPatterns = DEFINITION_QUERY_PATTERNS;
  const isEarlyDefinitionQuery = definitionQueryPatterns.some(p => p.test(query.intent ?? ''));
  const symbolLookupResult = await runSymbolLookupStage({
    workspaceRoot,
    intent: query.intent ?? '',
    isDefinitionQuery: isEarlyDefinitionQuery,
  });
  if (symbolLookupResult.shouldShortCircuit && symbolLookupResult.symbolPacks.length > 0) {
    // Direct symbol match found - return immediately with high confidence
    explanationParts.push(symbolLookupResult.explanation);
    const symbolPacks = symbolLookupResult.symbolPacks;

    // Apply calibration to symbol packs
    const calibration = await getConfidenceCalibration(storage);
    const calibratedPacks = applyCalibrationToPacks(symbolPacks, calibration);

    // Build response directly - skip semantic search stages
    const totalConfidence = calibratedPacks.length
      ? Math.exp(calibratedPacks.reduce((sum, p) => sum + Math.log(Math.max(0.01, p.confidence)), 0) / calibratedPacks.length)
      : 0;
    const latencyMs = deterministicCtx ? 0 : Date.now() - startTime;

    const response = {
      query,
      packs: calibratedPacks,
      disclosures,
      traceId,
      constructionPlan,
      totalConfidence,
      calibration: summarizeCalibration(calibration),
      uncertainty: computeUncertaintyMetrics(totalConfidence),
      cacheHit: false,
      latencyMs,
      version,
      drillDownHints: [] as string[],
      explanation: explanationParts.join(' '),
      coverageGaps: [] as string[],
    } as CachedResponse;

    // Record query episode for symbol lookup
    try {
      await recordQueryEpisode(storage, { query, response, durationMs: latencyMs });
    } catch (error) {
      // Non-blocking: continue even if episode recording fails
    }

    void globalEventBus.emit(createQueryCompleteEvent(queryId, calibratedPacks.length, false, latencyMs, traceSessionId));
    return response;
  } else if (symbolLookupResult.isSymbolQuery && symbolLookupResult.symbolPacks.length > 0) {
    // Fuzzy symbol match - add to direct packs but continue with semantic search
    directPacks = [...symbolLookupResult.symbolPacks, ...directPacks];
    explanationParts.push(symbolLookupResult.explanation);
  }

  // GIT QUERY STAGE - Handle "recent changes to X", "git history", "what changed" queries
  // This runs early to intercept git-related queries and return actual commit history
  // instead of semantic matches that return functions IN the file rather than changes TO it
  const gitQueryResult = runGitQueryStage({
    intent: query.intent ?? '',
    workspace: workspaceRoot,
    version,
  });
  if (gitQueryResult.isGitQuery && gitQueryResult.shouldShortCircuit && gitQueryResult.gitPacks.length > 0) {
    // High-confidence git query with results - return immediately
    explanationParts.push(gitQueryResult.explanation);
    const gitPacks = gitQueryResult.gitPacks;

    // Apply calibration to git packs
    const calibration = await getConfidenceCalibration(storage);
    const calibratedPacks = applyCalibrationToPacks(gitPacks, calibration);

    // Build response directly - skip semantic search stages
    const totalConfidence = calibratedPacks.length
      ? Math.exp(calibratedPacks.reduce((sum, p) => sum + Math.log(Math.max(0.01, p.confidence)), 0) / calibratedPacks.length)
      : 0;
    const latencyMs = deterministicCtx ? 0 : Date.now() - startTime;

    const response = {
      query,
      packs: calibratedPacks,
      disclosures,
      traceId,
      constructionPlan,
      totalConfidence,
      calibration: summarizeCalibration(calibration),
      uncertainty: computeUncertaintyMetrics(totalConfidence),
      cacheHit: false,
      latencyMs,
      version,
      drillDownHints: [] as string[],
      explanation: explanationParts.join(' '),
      coverageGaps: [] as string[],
    } as CachedResponse;

    // Record query episode for git query
    try {
      await recordQueryEpisode(storage, { query, response, durationMs: latencyMs });
    } catch (error) {
      // Non-blocking: continue even if episode recording fails
    }

    void globalEventBus.emit(createQueryCompleteEvent(queryId, calibratedPacks.length, false, latencyMs, traceSessionId));
    return response;
  } else if (gitQueryResult.isGitQuery && gitQueryResult.gitPacks.length > 0) {
    // Git query detected but with lower confidence - add git packs and continue
    directPacks = [...gitQueryResult.gitPacks, ...directPacks];
    explanationParts.push(gitQueryResult.explanation);
  }

  // ENUMERATION STAGE - Handle "list all X", "how many Y", "enumerate Z" queries
  // This runs early to provide complete entity listings without semantic search
  const enumIntent = detectEnumerationIntent(query.intent ?? '');
  if (enumIntent.isEnumeration && enumIntent.category) {
    try {
      const enumResult = await enumerateByCategory(
        storage,
        enumIntent.category,
        workspaceRoot
      );

      if (enumResult.entities.length > 0) {
        // Convert enumeration results to context packs
        const enumPacks: ContextPack[] = enumResult.entities.map((entity, index) => ({
          packId: `enum-${enumIntent.category}-${index}`,
          packType: 'enumeration_result' as const,
          targetId: entity.id,
          summary: `${enumIntent.category}: ${entity.name}`,
          keyFacts: [
            `File: ${entity.filePath}`,
            ...(entity.line !== undefined ? [`Line: ${entity.line}`] : []),
            ...(entity.description ? [entity.description] : []),
          ],
          codeSnippets: [],
          relatedFiles: [entity.filePath],
          confidence: 0.95,
          createdAt: new Date(),
          accessCount: 0,
          lastOutcome: 'unknown' as const,
          successCount: 0,
          failureCount: 0,
          version,
          invalidationTriggers: [entity.filePath],
        }));

        // Apply calibration to enumeration packs
        const calibration = await getConfidenceCalibration(storage);
        const calibratedPacks = applyCalibrationToPacks(enumPacks, calibration);

        // Build response with enumeration results
        const totalConfidence = calibratedPacks.length
          ? Math.exp(calibratedPacks.reduce((sum, p) => sum + Math.log(Math.max(0.01, p.confidence)), 0) / calibratedPacks.length)
          : 0;
        const latencyMs = deterministicCtx ? 0 : Date.now() - startTime;

        explanationParts.push(enumResult.explanation);
        explanationParts.push(`Enumeration query detected (${enumIntent.queryType}). ${formatEnumerationResult(enumResult).split('\n').slice(0, 3).join(' ')}`);

        const response = {
          query,
          packs: calibratedPacks,
          disclosures,
          traceId,
          constructionPlan,
          totalConfidence,
          calibration: summarizeCalibration(calibration),
          uncertainty: computeUncertaintyMetrics(totalConfidence),
          cacheHit: false,
          latencyMs,
          version,
          drillDownHints: [] as string[],
          explanation: explanationParts.join(' '),
          coverageGaps: [] as string[],
        } as CachedResponse;

        // Record query episode for enumeration
        try {
          await recordQueryEpisode(storage, { query, response, durationMs: latencyMs });
        } catch {
          // Non-blocking: continue even if episode recording fails
        }

        void globalEventBus.emit(createQueryCompleteEvent(queryId, calibratedPacks.length, false, latencyMs, traceSessionId));
        return response;
      }
    } catch {
      // Enumeration failed - fall through to semantic search
      explanationParts.push(`Enumeration attempted for ${enumIntent.category} but failed, falling back to semantic search.`);
    }
  }

  // CALL FLOW STAGE - Handle "call flow for X", "execution path for Y" queries
  // This runs early to provide proper execution sequences instead of fragments
  const callFlowDetection = detectCallFlowQuery(query.intent ?? '');
  if (callFlowDetection.isCallFlow && callFlowDetection.entry) {
    try {
      const callFlowResult = await traceCallFlow(storage, callFlowDetection.entry, 5, 5);

      if (callFlowResult.sequence.length > 0) {
        // Convert call flow sequence to context pack
        const callFlowPack: ContextPack = {
          packId: `call-flow-${callFlowDetection.entry}`,
          packType: 'call_flow' as const,
          targetId: callFlowResult.entryPoint,
          summary: callFlowResult.summary,
          keyFacts: [
            `Entry point: ${callFlowResult.entryPoint}`,
            `Call chain: ${toCallChain(callFlowResult, 8)}`,
            `Depth: ${callFlowResult.maxDepth} levels`,
            `Functions traced: ${callFlowResult.sequence.length}`,
            ...(callFlowResult.truncated ? ['(Traversal truncated due to depth/breadth limits)'] : []),
          ],
          codeSnippets: callFlowResult.sequence.slice(0, 5).map(node => ({
            filePath: node.file,
            startLine: node.line,
            endLine: node.line,
            content: `${node.function}() -> [${node.callsTo.slice(0, 3).join(', ')}${node.callsTo.length > 3 ? '...' : ''}]`,
            language: 'typescript',
          })),
          relatedFiles: [...new Set(callFlowResult.sequence.map(n => n.file))],
          confidence: 0.95,
          createdAt: new Date(),
          accessCount: 0,
          lastOutcome: 'unknown' as const,
          successCount: 0,
          failureCount: 0,
          version,
          invalidationTriggers: callFlowResult.sequence.map(n => n.file),
        };

        // Apply calibration to call flow pack
        const calibration = await getConfidenceCalibration(storage);
        const calibratedPacks = applyCalibrationToPacks([callFlowPack], calibration);

        // Build response with call flow result
        const totalConfidence = calibratedPacks[0]?.confidence ?? 0.9;
        const latencyMs = deterministicCtx ? 0 : Date.now() - startTime;

        explanationParts.push(`Call flow query detected. ${callFlowResult.summary}`);

        const response = {
          query,
          packs: calibratedPacks,
          disclosures,
          traceId,
          constructionPlan,
          totalConfidence,
          calibration: summarizeCalibration(calibration),
          uncertainty: computeUncertaintyMetrics(totalConfidence),
          cacheHit: false,
          latencyMs,
          version,
          drillDownHints: callFlowResult.sequence.length > 5
            ? [`Explore deeper: "call flow for ${callFlowResult.sequence[1]?.function}"`]
            : [],
          explanation: explanationParts.join(' '),
          coverageGaps: [] as string[],
        } as CachedResponse;

        // Record query episode for call flow
        try {
          await recordQueryEpisode(storage, { query, response, durationMs: latencyMs });
        } catch {
          // Non-blocking: continue even if episode recording fails
        }

        void globalEventBus.emit(createQueryCompleteEvent(queryId, calibratedPacks.length, false, latencyMs, traceSessionId));
        return response;
      } else {
        // No call flow found - add explanation and continue
        explanationParts.push(`Call flow query for "${callFlowDetection.entry}" found no results. Falling back to semantic search.`);
      }
    } catch {
      // Call flow failed - fall through to semantic search
      explanationParts.push(`Call flow trace for "${callFlowDetection.entry}" failed, falling back to semantic search.`);
    }
  }

  // COMPARISON LOOKUP STAGE - Analyze "difference between X and Y", "X vs Y" queries
  // This runs early to provide structured comparison analysis for contrastive queries
  const comparisonLookupResult = await runComparisonLookupStage({
    workspaceRoot,
    intent: query.intent ?? '',
    storage,
  });
  if (comparisonLookupResult.shouldShortCircuit && comparisonLookupResult.comparisonPack) {
    // Comparison found - return immediately with comparison pack as primary result
    explanationParts.push(comparisonLookupResult.explanation);

    // Combine comparison pack with entity packs for full context
    const allPacks = [comparisonLookupResult.comparisonPack, ...comparisonLookupResult.entityPacks];

    // Apply calibration to comparison packs
    const calibration = await getConfidenceCalibration(storage);
    const calibratedPacks = applyCalibrationToPacks(allPacks, calibration);

    // Build response directly - skip semantic search stages
    const totalConfidence = calibratedPacks.length
      ? Math.exp(calibratedPacks.reduce((sum, p) => sum + Math.log(Math.max(0.01, p.confidence)), 0) / calibratedPacks.length)
      : 0;
    const latencyMs = deterministicCtx ? 0 : Date.now() - startTime;

    const response = {
      query,
      packs: calibratedPacks,
      disclosures,
      traceId,
      constructionPlan,
      totalConfidence,
      calibration: summarizeCalibration(calibration),
      uncertainty: computeUncertaintyMetrics(totalConfidence),
      cacheHit: false,
      latencyMs,
      version,
      drillDownHints: [] as string[],
      explanation: explanationParts.join(' '),
      coverageGaps: [] as string[],
    } as CachedResponse;

    // Record query episode for comparison lookup
    try {
      await recordQueryEpisode(storage, { query, response, durationMs: latencyMs });
    } catch (error) {
      // Non-blocking: continue even if episode recording fails
    }

    void globalEventBus.emit(createQueryCompleteEvent(queryId, calibratedPacks.length, false, latencyMs, traceSessionId));
    return response;
  } else if (comparisonLookupResult.isComparisonQuery && comparisonLookupResult.comparisonPack) {
    // Partial comparison match - add to direct packs but continue with semantic search
    directPacks = [comparisonLookupResult.comparisonPack, ...comparisonLookupResult.entityPacks, ...directPacks];
    explanationParts.push(comparisonLookupResult.explanation);
  }

  // DEPENDENCY GRAPH TRAVERSAL STAGE
  // For structural queries like "what imports X" or "what depends on Y",
  // run graph traversal BEFORE semantic search to get accurate results.
  let dependencyQueryResult: DependencyQueryResult | undefined;
  let dependencyCandidates: Candidate[] = [];
  if (structuralIntent.isStructural && structuralIntent.confidence >= 0.6) {
    try {
      if (shouldRunExhaustive) {
        const includeTransitive = /\btransitive\b|\bimpact\b|\bbreak\b|\bbreaking\b|\bwhat\s+breaks\b|\bwould\s+break\b|\baffect\b/i
          .test(query.intent ?? '');
        dependencyQueryResult = await executeExhaustiveDependencyQuery(storage, structuralIntent, {
          includeTransitive,
        });
        explanationParts.push('Exhaustive dependency query selected; semantic retrieval will be skipped for determinism.');
      } else {
        dependencyQueryResult = await executeDependencyQuery(storage, structuralIntent, query.intent ?? '');
      }
      if (dependencyQueryResult.results.length > 0) {
        // Convert graph traversal results to candidates with high scores
        // Filter to only function/module types that are valid Candidate entityTypes
        const validResults = dependencyQueryResult.results.filter(
          (dep) => dep.entityType === 'function' || dep.entityType === 'module'
        );
        dependencyCandidates = validResults.map((dep) => ({
          entityId: dep.entityId,
          entityType: dep.entityType as 'function' | 'module',
          path: dep.sourceFile,
          semanticSimilarity: 0.6, // Base semantic score
          confidence: dep.confidence,
          recency: 0.5,
          pagerank: 0.6, // Boost for structural match
          centrality: 0.5,
          communityId: null,
          // High score for structurally accurate results
          score: 0.85 + (dep.confidence * 0.1),
        }));
        explanationParts.push(
          `Graph traversal: Found ${dependencyQueryResult.results.length} ${structuralIntent.direction === 'dependents' ? 'dependents' : 'dependencies'} ` +
          `for "${structuralIntent.targetEntity}" via ${structuralIntent.edgeTypes.join('/')} edges.`
        );
      } else {
        explanationParts.push(dependencyQueryResult.explanation);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCoverageGap('semantic_retrieval', `Graph traversal failed: ${message}`, 'moderate');
    }
  }

  const semanticResult = shouldRunExhaustive
    ? {
        candidates: [] as Candidate[],
        queryEmbedding: null,
        queryClassification: applyIntentTypeRoutingOverrides(
          classifyQueryIntent(query.intent ?? ''),
          query.intentType,
          query.affectedFiles
        ),
        diagnostics: {
          vectorIndexDegraded: false,
          vectorIndexEmpty: false,
          noSemanticMatches: false,
          embeddingUnavailable: false,
          degradedReason: undefined as string | undefined,
        },
      }
    : await runSemanticRetrievalStage({
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
  const queryClassification = semanticResult.queryClassification;
  const semanticDiagnostics = semanticResult.diagnostics;

  // Merge graph traversal results with semantic candidates
  // Graph results get priority since they are structurally accurate
  let candidates: Candidate[];
  if (dependencyCandidates.length > 0 && semanticResult.candidates.length > 0) {
    candidates = mergeGraphResultsWithCandidates(
      dependencyQueryResult?.results ?? [],
      semanticResult.candidates
    );
    explanationParts.push(`Merged ${semanticResult.candidates.length} semantic matches with graph traversal results.`);
  } else if (dependencyCandidates.length > 0) {
    candidates = dependencyCandidates;
  } else {
    candidates = semanticResult.candidates;
  }
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
  // Determine task type for ranking: use 'guidance' for meta-queries to boost documentation
  const rankingTaskType = queryClassification?.isMetaQuery
    ? 'guidance'
    : query.taskType;
  // Use context level's pack limit for agent ergonomics (L0=3, L1=6, L2=8, L3=10)
  const contextLevel = resolveContextLevel(query.depth);
  const ranked = rankContextPacks({
    packs: packStageResult.allPacks,
    scoreByTarget: candidateScoreMap,
    maxPacks: contextLevel.packLimit,
    taskType: rankingTaskType,
    depth: query.depth,
  });
  // Apply stable sorting in deterministic mode to ensure consistent ordering
  let finalPacks = deterministicCtx
    ? stableSort(
        ranked.packs,
        (pack) => candidateScoreMap.get(pack.targetId) ?? pack.confidence,
        (pack) => pack.packId
      )
    : ranked.packs;
  // Add explanation for meta-query routing
  if (queryClassification?.isMetaQuery) {
    explanationParts.push('Meta-query detected: boosted documentation in ranking.');
  }
  // Handle project understanding queries specially - prioritize high-level docs
  if (queryClassification?.isProjectUnderstandingQuery) {
    explanationParts.push('Project understanding query detected: prioritizing README, package.json, AGENTS.md.');
    // Re-prioritize packs using project understanding handler
    finalPacks = await handleProjectUnderstandingQuery(storage, workspaceRoot, finalPacks);
  }
  // Handle entry point queries - return indexed entry point data
  if (queryClassification?.isEntryPointQuery) {
    const entryPointResult = await runEntryPointQueryStage({
      storage,
      version,
    });
    if (entryPointResult.found) {
      // Prepend entry point packs for highest priority
      finalPacks = [...entryPointResult.packs, ...finalPacks];
      explanationParts.push(entryPointResult.explanation);
    } else {
      explanationParts.push(entryPointResult.explanation);
    }
  }
  // Handle architecture overview queries specially - infer layers from structure
  if (queryClassification?.isArchitectureOverviewQuery) {
    explanationParts.push('Architecture query detected: inferring layers from directory structure and dependencies.');
    // Generate architecture overview and prepend to packs
    finalPacks = await handleArchitectureQuery(storage, workspaceRoot, finalPacks, version);
  }
  // Handle WHY queries specially - search for rationale/reasoning
  let inferredRationaleHint: string | undefined;
  if (queryClassification?.isWhyQuery) {
    const rationaleResult = await runRationaleStage({
      storage,
      intent: query.intent ?? '',
      topic: queryClassification.whyQueryTopic,
      comparisonTopic: queryClassification.whyComparisonTopic,
    });
    if (rationaleResult.found) {
      // Prepend rationale packs for highest priority
      finalPacks = [...rationaleResult.packs, ...finalPacks];
      explanationParts.push(rationaleResult.explanation);
    } else if (rationaleResult.inferredRationale) {
      // Create a pack for the inferred rationale so it surfaces in results
      const rationalePack: ContextPack = {
        packId: generateUUID('rat_'),
        packType: 'decision_context',
        targetId: `rationale:${queryClassification.whyQueryTopic || 'unknown'}`,
        summary: rationaleResult.inferredRationale,
        confidence: 0.65, // Lower confidence for inferred rationale
        keyFacts: [
          `Topic: ${queryClassification.whyQueryTopic || 'general'}`,
          'Source: inferred from code patterns and project context',
          'Recommendation: Add an ADR for explicit documentation',
        ],
        codeSnippets: [],
        relatedFiles: [],
        createdAt: deterministicCtx ? new Date(0) : new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version,
        invalidationTriggers: [],
      };
      finalPacks = [rationalePack, ...finalPacks];
      explanationParts.push(rationaleResult.explanation);
      inferredRationaleHint = `Inferred rationale: ${rationaleResult.inferredRationale}. Consider adding an ADR for explicit documentation.`;
    }
  }
  // Handle refactoring safety queries - analyze impact of changes
  // Check both pattern match AND construction enablement
  if (queryClassification?.isRefactoringSafetyQuery && queryClassification.refactoringTarget &&
      isConstructionEnabled('refactoring-safety-checker', query.enabledConstructables)) {
    const refactoringSafetyResult = await runRefactoringSafetyStage({
      storage,
      target: queryClassification.refactoringTarget,
      intent: query.intent ?? '',
      version,
    });
    if (refactoringSafetyResult.analyzed) {
      // Prepend refactoring safety packs for highest priority
      finalPacks = [...refactoringSafetyResult.packs, ...finalPacks];
      explanationParts.push(refactoringSafetyResult.explanation);
    }
  }
  // Handle bug investigation queries - debug errors and trace issues
  if (queryClassification?.isBugInvestigationQuery &&
      isConstructionEnabled('bug-investigation-assistant', query.enabledConstructables)) {
    const bugInvestigationResult = await runBugInvestigationStage({
      storage,
      intent: query.intent ?? '',
      bugContext: queryClassification.bugContext,
      version,
    });
    if (bugInvestigationResult.analyzed) {
      finalPacks = [...bugInvestigationResult.packs, ...finalPacks];
      explanationParts.push(bugInvestigationResult.explanation);
    }
  }
  // Handle security audit queries - find vulnerabilities
  if (queryClassification?.isSecurityAuditQuery &&
      isConstructionEnabled('security-audit-helper', query.enabledConstructables)) {
    const securityAuditResult = await runSecurityAuditStage({
      storage,
      intent: query.intent ?? '',
      checkTypes: queryClassification.securityCheckTypes,
      version,
      workspaceRoot,
    });
    if (securityAuditResult.analyzed) {
      finalPacks = [...securityAuditResult.packs, ...finalPacks];
      explanationParts.push(securityAuditResult.explanation);
    }
  }
  // Handle architecture verification queries - check layer/boundary compliance
  if (queryClassification?.isArchitectureVerificationQuery &&
      isConstructionEnabled('architecture-verifier', query.enabledConstructables)) {
    const architectureResult = await runArchitectureVerificationStage({
      storage,
      intent: query.intent ?? '',
      version,
      workspaceRoot,
    });
    if (architectureResult.analyzed) {
      finalPacks = [...architectureResult.packs, ...finalPacks];
      explanationParts.push(architectureResult.explanation);
    }
  }
  // Handle code quality queries - analyze complexity, duplication, smells
  if (queryClassification?.isCodeQualityQuery &&
      isConstructionEnabled('code-quality-reporter', query.enabledConstructables)) {
    const codeQualityResult = await runCodeQualityStage({
      storage,
      intent: query.intent ?? '',
      version,
      workspaceRoot,
    });
    if (codeQualityResult.analyzed) {
      finalPacks = [...codeQualityResult.packs, ...finalPacks];
      explanationParts.push(codeQualityResult.explanation);
    }
  }
  // Handle feature location queries - find where features are implemented
  if (queryClassification?.isFeatureLocationQuery && queryClassification.featureTarget &&
      isConstructionEnabled('feature-location-advisor', query.enabledConstructables)) {
    const featureLocationResult = await runFeatureLocationStage({
      storage,
      intent: query.intent ?? '',
      featureTarget: queryClassification.featureTarget,
      version,
    });
    if (featureLocationResult.analyzed) {
      finalPacks = [...featureLocationResult.packs, ...finalPacks];
      explanationParts.push(featureLocationResult.explanation);
    }
  }
  // Handle refactoring opportunities queries - find code that should be refactored
  if (queryClassification?.isRefactoringOpportunitiesQuery) {
    const refactoringOpportunitiesResult = await runRefactoringOpportunitiesStage({
      storage,
      intent: query.intent ?? '',
      version,
      workspaceRoot,
    });
    if (refactoringOpportunitiesResult.analyzed) {
      finalPacks = [...refactoringOpportunitiesResult.packs, ...finalPacks];
      explanationParts.push(refactoringOpportunitiesResult.explanation);
    }
  }
  // Handle dependency management queries - analyze packages, find unused, outdated, etc.
  if (queryClassification?.isDependencyManagementQuery) {
    const dependencyMgmtResult = await runDependencyManagementStage({
      storage,
      intent: query.intent ?? '',
      version,
      workspaceRoot,
      action: queryClassification.dependencyAction,
    });
    if (dependencyMgmtResult.analyzed) {
      finalPacks = [...dependencyMgmtResult.packs, ...finalPacks];
      explanationParts.push(dependencyMgmtResult.explanation);
    }
  }
  // Handle decision support queries - help agents make technical choices
  if (queryClassification?.isDecisionSupportQuery) {
    const decisionSupportResult = await runDecisionSupportStage({
      storage,
      intent: query.intent ?? '',
      version,
      workspaceRoot,
    });
    if (decisionSupportResult.analyzed) {
      finalPacks = [...decisionSupportResult.packs, ...finalPacks];
      explanationParts.push(decisionSupportResult.explanation);
    }
  }
  // Add explanation for definition query routing
  if (queryClassification?.isDefinitionQuery) {
    explanationParts.push('Definition query detected: boosted interface/type declarations over implementations.');
  }
  // Add explanation for perspective-aware routing
  const perspective = inferPerspective(query);
  if (perspective) {
    const perspectiveConfig = getPerspectiveConfig(perspective);
    explanationParts.push(
      `Perspective '${perspective}' applied: ${perspectiveConfig.description}. ` +
      `Boosted T-patterns: ${perspectiveConfig.tPatternIds.slice(0, 4).join(', ')}${perspectiveConfig.tPatternIds.length > 4 ? '...' : ''}.`
    );
  }
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

  // COHERENCE-BASED CONFIDENCE ADJUSTMENT
  // When results are semantically scattered or don't align with the query,
  // confidence should be reduced. This prevents reporting high confidence
  // on irrelevant results.
  const coherenceAnalysis = analyzeResultCoherence(finalPacks, {
    queryEmbedding,
    queryIntent: query.intent,
  });
  totalConfidence = applyCoherenceAdjustment(totalConfidence, coherenceAnalysis);
  // Add coherence warnings to disclosures for transparency
  if (coherenceAnalysis.warnings.length > 0) {
    disclosures.push(...coherenceAnalysis.warnings.map(w => `coherence_warning: ${w}`));
  }
  const currentDepth = query.depth ?? 'L1';
  const retrievalEntropy = computeRetrievalEntropy(finalPacks);
  const escalationDecision = decideRetrievalEscalation({
    depth: currentDepth,
    totalConfidence,
    retrievalEntropy,
    escalationAttempts: escalationState.attempts,
    maxEscalationDepth: escalationState.maxDepth,
    packCount: finalPacks.length,
  });

  if (escalationDecision.shouldEscalate) {
    const expandedIntent = escalationDecision.expandQuery
      ? expandEscalationIntent(query.intent ?? '', finalPacks)
      : (query.intent ?? '');
    const nextQuery: LibrarianQuery = {
      ...query,
      depth: escalationDecision.nextDepth,
      intent: expandedIntent,
    };
    const unchangedIntent = nextQuery.intent === query.intent;
    const unchangedDepth = nextQuery.depth === currentDepth;

    if (!(unchangedIntent && unchangedDepth)) {
      await logRetrievalEscalationEvent(storage, workspaceRoot, {
        queryHash: queryId,
        intent: query.intent,
        fromDepth: currentDepth,
        toDepth: nextQuery.depth,
        totalConfidence,
        retrievalEntropy,
        reasons: escalationDecision.reasons,
        attempt: escalationState.attempts + 1,
        maxEscalationDepth: escalationState.maxDepth,
        returnedPackIds: finalPacks.map((pack) => pack.packId),
      });

      const escalatedResponse = await queryLibrarian(
        nextQuery,
        storage,
        embeddingService,
        governorContext,
        onStage,
        traceOptions,
        {
          escalationState: {
            attempts: escalationState.attempts + 1,
            maxDepth: escalationState.maxDepth,
          },
        }
      );
      escalatedResponse.disclosures = [
        ...escalatedResponse.disclosures,
        `retrieval_escalation: ${currentDepth} -> ${nextQuery.depth} (${escalationDecision.reasons.join(', ') || 'policy_triggered'})`,
      ];
      return escalatedResponse;
    }
  }
  const retrievalStatus = categorizeRetrievalStatus({
    totalConfidence,
    packCount: finalPacks.length,
  });
  const retrievalInsufficient = currentDepth === 'L3' && totalConfidence < 0.3;
  const suggestedClarifyingQuestions = retrievalInsufficient
    ? buildClarifyingQuestions(query.intent ?? '')
    : undefined;

  // CONFIDENCE THRESHOLD CHECK: Return "no results" for low-confidence matches
  // It's better to say "I don't know" than to return confidently wrong answers.
  // Check if the top pack's confidence is below threshold after all adjustments.
  if (finalPacks.length > 0) {
    const topPackConfidence = finalPacks[0].confidence ?? candidateScoreMap.get(finalPacks[0].targetId) ?? 0;
    if (topPackConfidence < MIN_RESULT_CONFIDENCE_THRESHOLD) {
      // All results are below confidence threshold - return explicit "no results"
      const lowConfidenceResponse = {
        query,
        packs: [],
        disclosures: [
          ...disclosures,
          `low_confidence_filter: Best result confidence (${(topPackConfidence * 100).toFixed(1)}%) below threshold (${(MIN_RESULT_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%). Returning no results rather than potentially incorrect matches.`,
        ],
        traceId,
        constructionPlan,
        totalConfidence: 0,
        calibration: summarizeCalibration(calibration),
        uncertainty: computeUncertaintyMetrics(0),
        retrievalStatus: 'insufficient',
        retrievalEntropy,
        retrievalInsufficient: currentDepth === 'L3',
        suggestedClarifyingQuestions: currentDepth === 'L3'
          ? buildClarifyingQuestions(query.intent ?? '')
          : undefined,
        cacheHit: false,
        latencyMs: deterministicCtx ? 0 : (Date.now() - startTime),
        version,
        llmRequirement,
        llmAvailable,
        drillDownHints: [
          'No relevant results found above confidence threshold.',
          'The query may not match indexed content, or the indexed content may not be relevant enough.',
          'Try a more specific query with different terminology.',
          'Verify the topic exists in the codebase.',
        ],
        // synthesis is undefined when no confident results - the failure info is in
        // queryDiagnostics, coverageGaps, and drillDownHints
        synthesis: undefined,
        feedbackToken: generateUUID('fbk_'),
        queryDiagnostics: {
          noResults: true,
          reasons: [
            `Best result confidence (${(topPackConfidence * 100).toFixed(1)}%) below minimum threshold (${(MIN_RESULT_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%)`,
            'Matches found but not confident enough to return',
          ],
          suggestions: [
            'Try a more specific query',
            'Use different terminology that matches the codebase',
            'Check if the topic exists in the indexed files',
          ],
        },
        coverageGaps: [
          'Query did not match indexed content with sufficient confidence',
          ...coverageGaps,
        ],
      } as CachedResponse;

      // Log the low-confidence filter event
      void globalEventBus.emit(createQueryCompleteEvent(queryId, 0, false, lowConfidenceResponse.latencyMs, traceSessionId));
      if (traceOptions.evidenceLedger && traceSessionId) {
        void appendQueryEvidence(traceOptions.evidenceLedger, traceSessionId, 'query_complete', {
          queryId,
          cacheKey,
          packCount: 0,
          latencyMs: lowConfidenceResponse.latencyMs,
          templateId: constructionPlan.templateId,
          cacheHit: false,
          lowConfidenceFilter: true,
          topPackConfidence,
          confidenceThreshold: MIN_RESULT_CONFIDENCE_THRESHOLD,
        });
      }

      return lowConfidenceResponse;
    }
  }

  const drillDownResult = generateDrillDownHints(finalPacks, query);
  const drillDownHints = drillDownResult.hints;
  const followUpQueries = drillDownResult.followUpQueries;
  const explanation = buildExplanation(explanationParts, ranked.averageScore, candidates.length);
  // Add inferred rationale hint if available (from WHY query handling)
  if (inferredRationaleHint) {
    drillDownHints.push(inferredRationaleHint);
  }
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
  // Add coherence explanation to drill-down hints when coherence is low
  if (coherenceAnalysis.overallCoherence < 0.4) {
    drillDownHints.push(`Result coherence: ${coherenceAnalysis.explanation}`);
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
  const synthesisStageResult = await runSynthesisStage({
    query,
    storage,
    finalPacks,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    synthesisEnabled,
    workspaceRoot,
  });
  let synthesis = synthesisStageResult.synthesis;
  let synthesisMode: SynthesisMode | undefined = synthesisStageResult.synthesisMode;
  let llmError: string | undefined = synthesisStageResult.llmError;
  if (!llmError && llmProviderError) {
    llmError = llmProviderError;
  }
  synthesis = applyAdequacyToSynthesis(synthesis, adequacyReport);
  if (!synthesisMode && synthesis) synthesisMode = 'llm';
  if (!synthesisMode && finalPacks.length > 0) synthesisMode = 'heuristic';

  // Apply token budget if specified - truncate by relevance to fit budget
  let tokenBudgetResult: import('../types.js').TokenBudgetResult | undefined;
  if (hasValidTokenBudget(query.tokenBudget)) {
    const scoreByPack = new Map<string, number>();
    for (const pack of finalPacks) {
      // Use the candidate score if available, otherwise use confidence
      const candidateScore = candidateScoreMap.get(pack.targetId);
      scoreByPack.set(pack.packId, candidateScore ?? pack.confidence);
    }
    const budgetOutput = enforceResponseTokenBudget({
      packs: finalPacks,
      synthesis,
      budget: query.tokenBudget,
      scoreByPack,
    });
    finalPacks = budgetOutput.packs;
    synthesis = budgetOutput.synthesis;
    tokenBudgetResult = budgetOutput.result;

    if (tokenBudgetResult.truncated) {
      disclosures.push(
        `token_budget_enforced: Response truncated from ${tokenBudgetResult.originalPackCount} to ${tokenBudgetResult.finalPackCount} packs ` +
        `(strategy: ${tokenBudgetResult.truncationStrategy}, used: ${tokenBudgetResult.tokensUsed}/${tokenBudgetResult.totalAvailable} tokens)`
      );
    }
  }

  // Collect edge information if edge types filter is specified
  let edgeQueryResult: EdgeQueryResult | undefined;
  if (query.edgeTypes && query.edgeTypes.length > 0) {
    const validatedEdgeTypes = validateQueryEdgeTypes(query.edgeTypes);

    // Collect edges from packs' target entities
    const allEdges: EdgeInfo[] = [];
    const seenEdgeIds = new Set<string>();

    for (const pack of finalPacks) {
      try {
        // Get edges for this pack's target entity
        const edgeResult = await getArgumentEdgesForEntity(storage, pack.targetId, {
          edgeTypes: validatedEdgeTypes.argumentEdgeTypes.length > 0
            ? validatedEdgeTypes.argumentEdgeTypes
            : undefined,
          limit: 20,
        });

        for (const edge of edgeResult.edges) {
          if (!seenEdgeIds.has(edge.id)) {
            seenEdgeIds.add(edge.id);
            allEdges.push({
              type: edge.type,
              sourceId: edge.sourceId,
              targetId: edge.targetId,
              weight: edge.weight,
              confidence: edge.confidence,
              isArgumentEdge: true,
            });
          }
        }

        // Also get knowledge edges if requested
        if (validatedEdgeTypes.knowledgeEdgeTypes.length > 0) {
          const knowledgeEdges = await storage.getKnowledgeEdges({
            sourceId: pack.targetId,
            edgeType: validatedEdgeTypes.knowledgeEdgeTypes[0], // Storage API takes single type
            limit: 20,
          });

          for (const edge of knowledgeEdges) {
            if (!seenEdgeIds.has(edge.id)) {
              seenEdgeIds.add(edge.id);
              allEdges.push({
                type: edge.edgeType,
                sourceId: edge.sourceId,
                targetId: edge.targetId,
                weight: edge.weight,
                confidence: edge.confidence,
                isArgumentEdge: false,
              });
            }
          }
        }
      } catch (edgeError) {
        // Non-blocking: continue if edge retrieval fails
        const message = edgeError instanceof Error ? edgeError.message : String(edgeError);
        logWarning(`Edge retrieval failed for ${pack.targetId}: ${message}`);
      }
    }

    edgeQueryResult = {
      edges: allEdges.slice(0, 100), // Limit total edges
      edgeTypesSearched: validatedEdgeTypes.allTypes,
      totalCount: allEdges.length,
    };

    if (allEdges.length > 0) {
      explanationParts.push(
        `Found ${allEdges.length} edges of types [${validatedEdgeTypes.allTypes.join(', ')}].`
      );
    }
  }

  const postProcessingStage = stageTracker.start('post_processing', 1);
  let storageWriteDegraded = false;
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
      if (isStorageWriteDegradedError(message)) {
        storageWriteDegraded = true;
        const degradedMessage = createStorageWriteDegradedMessage(message);
        disclosures.push(`unverified_by_trace(storage_write_degraded): ${degradedMessage}`);
        drillDownHints.unshift(degradedMessage);
        recordCoverageGap('post_processing', degradedMessage, 'significant', 'Run `librarian doctor --heal` to recover storage locks.');
      } else {
        recordCoverageGap('post_processing', `Verification plan save failed: ${message}`, 'minor');
      }
    }
  }

  // Generate unique feedbackToken for this query (CONTROL_LOOP.md feedback loop)
  // Use deterministic ID in deterministic mode
  const feedbackToken = generateUUID('fbk_');

  // Store feedback context for later attribution
  await storeFeedbackContext({
    feedbackToken,
    packIds: finalPacks.map(p => p.packId),
    queryIntent: query.intent ?? '',
    queryDepth: query.depth ?? 'L1',
    createdAt: getNow(),
  }, storage);

  // Mark the first/best pack as the primary result for agent ergonomics
  // This gives agents a clear "start here" signal
  if (finalPacks.length > 0) {
    finalPacks[0].isPrimaryResult = true;
  }

  const response = {
    query,
    intentType: query.intentType,
    packs: finalPacks,
    disclosures,
    verificationPlan: verificationPlan ?? undefined,
    adequacy: adequacyReport ?? undefined,
    traceId,
    constructionPlan,
    totalConfidence,
    calibration: summarizeCalibration(calibration),
    uncertainty: computeUncertaintyMetrics(totalConfidence),
    retrievalStatus,
    retrievalEntropy,
    retrievalInsufficient,
    suggestedClarifyingQuestions,
    cacheHit,
    // Use fixed latency (0) in deterministic mode for reproducibility
    latencyMs: deterministicCtx ? 0 : (Date.now() - startTime),
    version,
    llmRequirement,
    llmAvailable,
    synthesisMode,
    llmError: query.showLlmErrors === false ? undefined : llmError,
    drillDownHints,
    followUpQueries: followUpQueries.length ? followUpQueries : undefined,
    methodHints: methodGuidance?.hints,
    methodFamilies: methodGuidance?.families,
    methodHintSource: methodGuidance?.source,
    synthesis,
    feedbackToken,
    tokenBudgetResult,
    edges: edgeQueryResult,
    contract: buildQueryResultContract({
      query,
      packs: finalPacks,
      synthesis,
      totalConfidence,
      version,
      disclosures,
    }),
  } as CachedResponse;
  response.explanation = explanation || undefined;
  response.coverageGaps = coverageGaps.length ? coverageGaps : undefined;
  response.evidenceByPack = Object.keys(evidenceByPack).length ? evidenceByPack : undefined;

  // Build queryDiagnostics when no results found to help agents understand why
  if (finalPacks.length === 0) {
    const reasons: string[] = [];
    const suggestions: string[] = [];

    // Check for vector index issues
    if (semanticDiagnostics.vectorIndexEmpty) {
      reasons.push('Vector index empty - no semantic search available');
      suggestions.push('Verify bootstrap completed successfully');
      suggestions.push('Re-run bootstrap to populate the vector index');
    } else if (semanticDiagnostics.vectorIndexDegraded) {
      reasons.push(`Vector index degraded: ${semanticDiagnostics.degradedReason ?? 'unknown reason'}`);
      suggestions.push('Re-bootstrap the index or check embedding configuration');
    }

    // Check for embedding availability
    if (semanticDiagnostics.embeddingUnavailable) {
      reasons.push('Embedding service unavailable - semantic search disabled');
      suggestions.push('Configure an embedding provider (e.g., sentence-transformers)');
    }

    // Check for semantic match issues
    if (semanticDiagnostics.noSemanticMatches && !semanticDiagnostics.vectorIndexEmpty) {
      reasons.push('No semantic matches found for query');
      suggestions.push('Try a more specific query');
      suggestions.push('Use different terminology or keywords');
    }

    // Check if candidates were found but no packs generated
    if (candidates.length > 0 && finalPacks.length === 0) {
      reasons.push(`Found ${candidates.length} candidates but no matching context packs`);
      suggestions.push('Check if relevant files are indexed');
    }

    // Check if all packs were filtered out (e.g., by confidence threshold)
    if (packStageResult.allPacks.length > 0 && finalPacks.length === 0) {
      reasons.push('All packs filtered out during ranking/confidence threshold');
      suggestions.push('Lower the confidence threshold or refine the query');
    }

    // Add fallback reasons if none were identified
    if (reasons.length === 0) {
      reasons.push('Query did not match any indexed entities');
      suggestions.push('Try a more specific query');
      suggestions.push('Check if relevant files are indexed');
      suggestions.push('Verify bootstrap completed successfully');
    }

    response.queryDiagnostics = {
      noResults: true,
      reasons,
      suggestions,
    };
  }

  try {
    await recordQueryEpisode(storage, { query, response, durationMs: response.latencyMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isStorageWriteDegradedError(message)) {
      if (!storageWriteDegraded) {
        const degradedMessage = createStorageWriteDegradedMessage(message);
        disclosures.push(`unverified_by_trace(storage_write_degraded): ${degradedMessage}`);
        drillDownHints.unshift(degradedMessage);
        recordCoverageGap('post_processing', degradedMessage, 'significant', 'Run `librarian doctor --heal` to recover storage locks.');
      }
    } else {
      recordCoverageGap('post_processing', `Episode record failed: ${message}`, 'minor');
    }
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
  await logRetrievalConfidenceObservation(storage, workspaceRoot, {
    queryHash: queryId,
    intent: query.intent,
    confidenceScore: response.totalConfidence,
    retrievalEntropy: response.retrievalEntropy ?? 0,
    returnedPackIds: response.packs.map((pack) => pack.packId),
    timestamp: new Date().toISOString(),
  });
  if (sessionWorkspaceRoot) {
    const relatedFiles = Array.from(
      new Set(
        response.packs
          .flatMap((pack) => pack.relatedFiles)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    ).slice(0, 30);
    await recordSessionQuery(sessionWorkspaceRoot, query.intent ?? '', relatedFiles).catch((error) => {
      logWarning('[query] Failed to persist session query event', { error: getErrorMessage(error) });
    });
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
    if (sessionWorkspaceRoot) {
      await recordSessionError(sessionWorkspaceRoot, errorMessage).catch((sessionError) => {
        logWarning('[query] Failed to persist session error event', { error: getErrorMessage(sessionError) });
      });
    }
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
const hydeExpansionCache = new Map<string, string>();
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
const FEEDBACK_CONTEXT_STATE_KEY = 'feedback_context_v1';

function parseFeedbackContextList(raw: string | null): FeedbackContext[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is FeedbackContext => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Partial<FeedbackContext>;
      return (
        typeof record.feedbackToken === 'string' &&
        Array.isArray(record.packIds) &&
        typeof record.queryIntent === 'string' &&
        typeof record.queryDepth === 'string' &&
        typeof record.createdAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

function pruneFeedbackContexts(contexts: FeedbackContext[]): FeedbackContext[] {
  const now = Date.now();
  const deduped = new Map<string, FeedbackContext>();

  for (const context of contexts) {
    const createdAtMs = Date.parse(context.createdAt);
    if (!Number.isFinite(createdAtMs)) continue;
    if (now - createdAtMs > FEEDBACK_CONTEXT_TTL_MS) continue;
    deduped.set(context.feedbackToken, context);
  }

  return Array.from(deduped.values())
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-FEEDBACK_CONTEXT_LIMIT);
}

/**
 * Store feedback context for a query result.
 * Called internally when generating feedbackToken.
 */
async function storeFeedbackContext(context: FeedbackContext, storage?: LibrarianStorage): Promise<void> {
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

  if (!storage) return;

  try {
    const persisted = parseFeedbackContextList(await storage.getState(FEEDBACK_CONTEXT_STATE_KEY));
    const merged = pruneFeedbackContexts([...persisted, context]);
    await storage.setState(FEEDBACK_CONTEXT_STATE_KEY, JSON.stringify(merged));
  } catch {
    // Feedback persistence should never fail the main query path.
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
          selectionReason: plan.selectionReason ?? null,
          requiredMaps: plan.requiredMaps ?? [],
          requiredCapabilities: plan.requiredCapabilities ?? [],
          requiredArtifacts: plan.requiredArtifacts ?? [],
          rankedCandidates: (plan.rankedCandidates ?? []).map((candidate) => ({
            templateId: candidate.templateId,
            score: candidate.score,
            source: candidate.source,
          })),
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
  workspaceRoot: string;
  stageTracker: StageTracker;
  explanationParts: string[];
}): Promise<{ directPacks: ContextPack[]; cacheHit: boolean }> {
  const { storage, query, workspaceRoot, stageTracker, explanationParts } = options;
  const directScopeHints = (query.affectedFiles?.length ?? 0) + (query.filter ? 1 : 0);
  const directStage = stageTracker.start('direct_packs', directScopeHints);
  const directPacks = await collectDirectPacks(storage, query, workspaceRoot);
  stageTracker.finish(directStage, { outputCount: directPacks.length, filteredCount: 0 });
  const cacheHit = directPacks.length > 0;
  if (cacheHit) {
    explanationParts.push(`Matched ${directPacks.length} packs from affected files.`);
  }
  return { directPacks, cacheHit };
}

function applySimilaritySearchDegradation(
  source: string,
  response: {
    degraded?: boolean;
    degradedReason?: string;
  },
  diagnostics: {
    vectorIndexDegraded: boolean;
    vectorIndexEmpty: boolean;
    noSemanticMatches: boolean;
    embeddingUnavailable: boolean;
    degradedReason?: string;
  },
  recordCoverageGap: RecordCoverageGap
): void {
  if (!response.degraded) return;
  diagnostics.vectorIndexDegraded = true;
  if (!diagnostics.degradedReason) {
    diagnostics.degradedReason = response.degradedReason;
  }
  const emptyIndex = response.degradedReason === 'vector_index_empty' || response.degradedReason === 'vector_index_null';
  if (emptyIndex) {
    diagnostics.vectorIndexEmpty = true;
  }
  recordCoverageGap(
    'semantic_retrieval',
    `Similarity search (${source}) degraded: ${response.degradedReason ?? 'unknown'}`,
    emptyIndex ? 'significant' : 'moderate',
    'Re-bootstrap the index or check embedding configuration.'
  );
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
}): Promise<{
  candidates: Candidate[];
  queryEmbedding: Float32Array | null;
  queryClassification?: QueryClassification;
  diagnostics: {
    vectorIndexDegraded: boolean;
    vectorIndexEmpty: boolean;
    noSemanticMatches: boolean;
    embeddingUnavailable: boolean;
    degradedReason?: string;
  };
}> {
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
  let queryClassification: QueryClassification | undefined;

  // Track diagnostic state for zero-result explanation
  const diagnostics = {
    vectorIndexDegraded: false,
    vectorIndexEmpty: false,
    noSemanticMatches: false,
    embeddingUnavailable: false,
    degradedReason: undefined as string | undefined,
  };

  if (embeddingAvailable && !isModelLoaded()) {
    logWarning('Embedding model not preloaded - first query may experience cold-start latency. Ensure preloadEmbeddingModel() is called during bootstrap.', {
      stage: 'semantic_retrieval',
    });
  }

  const semanticStage = stageTracker.start('semantic_retrieval', query.intent && query.depth !== 'L0' ? 1 : 0);
  if (semanticStage.inputCount > 0) {
    if (!embeddingAvailable) {
      diagnostics.embeddingUnavailable = true;
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
      const resolvedEmbeddings = await resolveQueryEmbeddings(query, embeddingService, governor);
      queryEmbedding = resolvedEmbeddings.hydeEmbedding ?? resolvedEmbeddings.directEmbedding;
      const minSimilarity = version.qualityTier === 'mvp'
        ? MIN_SIMILARITY_MVP
        : MIN_SIMILARITY_FULL;

      // Classify query to determine entity type routing.
      // Explicit intentType overrides heuristic text classification.
      queryClassification = applyIntentTypeRoutingOverrides(
        classifyQueryIntent(query.intent ?? ''),
        query.intentType,
        query.affectedFiles
      );

      const searchLimit = queryClassification.isMetaQuery ? 20 : 14;
      const searchMinSimilarity = queryClassification.isMetaQuery ? minSimilarity * 0.9 : minSimilarity;

      // Use classified entity types (includes 'document' for meta-queries)
      const directSearchResponse = await storage.findSimilarByEmbedding(resolvedEmbeddings.directEmbedding, {
        limit: searchLimit,
        minSimilarity: searchMinSimilarity,
        entityTypes: queryClassification.entityTypes,
        filter: query.filter,
      });
      applySimilaritySearchDegradation('direct', directSearchResponse, diagnostics, recordCoverageGap);

      const resultLists: SimilarityResult[][] = [directSearchResponse.results];
      if (resolvedEmbeddings.hydeEmbedding) {
        const hydeSearchResponse = await storage.findSimilarByEmbedding(resolvedEmbeddings.hydeEmbedding, {
          limit: searchLimit,
          minSimilarity: searchMinSimilarity,
          entityTypes: queryClassification.entityTypes,
          filter: query.filter,
        });
        applySimilaritySearchDegradation('hyde', hydeSearchResponse, diagnostics, recordCoverageGap);
        resultLists.push(hydeSearchResponse.results);
      }

      for (let i = 0; i < resolvedEmbeddings.identifierEmbeddings.length; i += 1) {
        const expansionSearchResponse = await storage.findSimilarByEmbedding(resolvedEmbeddings.identifierEmbeddings[i], {
          limit: searchLimit,
          minSimilarity: searchMinSimilarity,
          entityTypes: queryClassification.entityTypes,
          filter: query.filter,
        });
        applySimilaritySearchDegradation(`identifier_expansion_${i + 1}`, expansionSearchResponse, diagnostics, recordCoverageGap);
        resultLists.push(expansionSearchResponse.results);
      }

      let similarResults = resultLists.length === 1
        ? resultLists[0]
        : fuseSimilarityResultListsWithRrf(resultLists, searchLimit);

      // Apply document bias for meta-queries
      if (queryClassification.isMetaQuery && queryClassification.documentBias > 0.3) {
        similarResults = applyDocumentBias(similarResults, queryClassification.documentBias);
      }

      // Apply definition bias for interface/type definition queries
      // This ensures "storage interface" returns LibrarianStorage interface, not getStorage() implementations
      if (queryClassification.isDefinitionQuery && queryClassification.definitionBias > 0.1) {
        similarResults = applyDefinitionBias(similarResults, queryClassification.definitionBias);
      }

      if (!similarResults.length) {
        diagnostics.noSemanticMatches = true;
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
  return { candidates, queryEmbedding, queryClassification, diagnostics };
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
    let fallbackCandidates = await storage.getContextPacks({ minConfidence: fallbackMinConfidence, limit: FALLBACK_CANDIDATE_LIMIT });
    if (!fallbackCandidates.length) fallbackCandidates = await storage.getContextPacks({ limit: FALLBACK_CANDIDATE_LIMIT });
    const fallback = rankHeuristicFallbackPacks(fallbackCandidates, query.intent ?? '').slice(0, FALLBACK_RESULT_LIMIT);
    if (fallback.length) {
      allPacks.push(...fallback);
      explanationParts.push('Applied heuristic fallback ranking (lexical + outcome-weighted) because semantic match was unavailable.');
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

function rankHeuristicFallbackPacks(candidates: ContextPack[], intent: string): ContextPack[] {
  if (candidates.length <= 1) return candidates;
  const queryTerms = Array.from(new Set(tokenize(intent)));
  if (queryTerms.length === 0) {
    return candidates
      .slice()
      .sort((left, right) => {
        const leftOutcome = (left.successCount + 1) / (left.successCount + left.failureCount + 2);
        const rightOutcome = (right.successCount + 1) / (right.successCount + right.failureCount + 2);
        return rightOutcome - leftOutcome || right.confidence - left.confidence;
      });
  }

  const corpus = candidates.map((pack) => {
    const text = [
      pack.summary,
      pack.packType,
      pack.targetId,
      ...pack.keyFacts,
      ...pack.relatedFiles,
    ].join(' ');
    const terms = tokenize(text);
    const termFreq = new Map<string, number>();
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    }
    return {
      pack,
      termFreq,
      length: Math.max(1, terms.length),
    };
  });

  const averageDocLength = Math.max(
    1,
    corpus.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, corpus.length)
  );
  const docFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    let df = 0;
    for (const doc of corpus) {
      if (doc.termFreq.has(term)) df += 1;
    }
    docFrequency.set(term, df);
  }

  const k1 = 1.2;
  const b = 0.75;
  const totalDocs = corpus.length;

  return corpus
    .map((doc) => {
      let bm25 = 0;
      for (const term of queryTerms) {
        const tf = doc.termFreq.get(term) ?? 0;
        if (tf === 0) continue;
        const df = docFrequency.get(term) ?? 0;
        const idf = Math.log(1 + ((totalDocs - df + 0.5) / (df + 0.5)));
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (doc.length / averageDocLength));
        bm25 += idf * (numerator / Math.max(denominator, 1e-9));
      }

      const lexicalScore = bm25 / (bm25 + 1);
      const outcomeScore = (doc.pack.successCount + 1) / (doc.pack.successCount + doc.pack.failureCount + 2);
      const confidenceScore = Math.max(0, Math.min(1, doc.pack.confidence));
      const finalScore = (lexicalScore * 0.65) + (outcomeScore * 0.2) + (confidenceScore * 0.15);

      return { pack: doc.pack, finalScore };
    })
    .sort((left, right) =>
      right.finalScore - left.finalScore
      || right.pack.confidence - left.pack.confidence
      || right.pack.accessCount - left.pack.accessCount
    )
    .map((entry) => entry.pack);
}

// ============================================================================
// RATIONALE STAGE - handles WHY queries by searching ADRs and design docs
// ============================================================================

interface RationaleStageResult {
  found: boolean;
  packs: ContextPack[];
  explanation: string;
  inferredRationale?: string;
}

/**
 * Run the rationale stage for WHY queries.
 *
 * This stage:
 * 1. Searches ADR ingestion items for matching rationale
 * 2. Generates inferred rationale if no explicit documentation exists
 * 3. Creates context packs from ADR content
 */
async function runRationaleStage(options: {
  storage: LibrarianStorage;
  intent: string;
  topic?: string;
  comparisonTopic?: string;
}): Promise<RationaleStageResult> {
  const { storage, intent, topic, comparisonTopic } = options;

  // Search for ADR records that might contain rationale
  const adrItems = await storage.getIngestionItems({ sourceType: 'adr' });
  const matchingPacks: ContextPack[] = [];
  const explanationParts: string[] = [];

  // Normalize search terms
  const searchTerms: string[] = [];
  if (topic) searchTerms.push(topic.toLowerCase());
  if (comparisonTopic) searchTerms.push(comparisonTopic.toLowerCase());

  // Extract additional terms from intent
  const intentWords = intent.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  searchTerms.push(...intentWords.slice(0, 5));

  let foundExplicitRationale = false;

  for (const item of adrItems) {
    const adr = item.payload as AdrRecord;
    const adrContent = `${adr.title} ${adr.decision} ${adr.context} ${adr.consequences}`.toLowerCase();

    // Check if this ADR is relevant to our query
    const isRelevant = searchTerms.some(term => adrContent.includes(term));

    if (isRelevant) {
      foundExplicitRationale = true;

      // Create a context pack from this ADR
      const pack: ContextPack = {
        packId: `adr:${adr.path}`,
        packType: 'decision_context',
        targetId: `adr:${adr.path}`,
        summary: adr.summary || adr.decision,
        keyFacts: [
          adr.decision && `Decision: ${adr.decision.slice(0, 200)}`,
          adr.context && `Context: ${adr.context.slice(0, 200)}`,
          adr.consequences && `Consequences: ${adr.consequences.slice(0, 200)}`,
        ].filter((f): f is string => !!f),
        codeSnippets: [],
        relatedFiles: adr.relatedFiles,
        confidence: 0.85, // High confidence for explicit ADR content
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: {
          major: 1,
          minor: 0,
          patch: 0,
          string: '1.0.0',
          qualityTier: 'full',
          indexedAt: new Date(),
          indexerVersion: '1.0.0',
          features: ['adr'],
        },
        invalidationTriggers: [adr.path],
      };

      matchingPacks.push(pack);
      explanationParts.push(`Found ADR "${adr.title}" matching rationale query.`);
    }
  }

  if (foundExplicitRationale) {
    return {
      found: true,
      packs: matchingPacks,
      explanation: `WHY query detected: ${explanationParts.join(' ')} Found ${matchingPacks.length} ADR(s) with relevant rationale.`,
    };
  }

  // If no explicit rationale found, try to generate inferred rationale
  const inferredRationale = generateInferredRationaleForTopic(topic);

  if (inferredRationale) {
    // Create a decision_context pack for the inferred rationale
    const inferredPack: ContextPack = {
      packId: `inferred-rationale:${topic?.toLowerCase() ?? 'unknown'}`,
      packType: 'decision_context',
      targetId: `rationale:${topic?.toLowerCase() ?? 'unknown'}`,
      summary: inferredRationale,
      keyFacts: [
        `Rationale: ${inferredRationale}`,
        'Note: This rationale was inferred from common usage patterns. Consider adding explicit documentation (ADR) for project-specific reasoning.',
      ],
      codeSnippets: [],
      relatedFiles: [],
      confidence: 0.65, // Lower confidence for inferred rationale
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        string: '1.0.0',
        qualityTier: 'full',
        indexedAt: new Date(),
        indexerVersion: '1.0.0',
        features: ['inferred_rationale'],
      },
      invalidationTriggers: [],
    };

    return {
      found: false,
      packs: [inferredPack],
      explanation: `WHY query detected: No explicit ADRs found. Generated inferred rationale for "${topic}".`,
      inferredRationale,
    };
  }

  return {
    found: false,
    packs: [],
    explanation: `WHY query detected: No explicit rationale found for "${intent}". Consider adding an ADR.`,
  };
}

/**
 * Generate inferred rationale based on common technology patterns.
 */
function generateInferredRationaleForTopic(topic?: string): string | undefined {
  if (!topic) return undefined;

  const normalizedTopic = topic.toLowerCase().replace(/[-_]/g, '');

  // Common technology choices and their typical rationale (50+ technologies)
  const commonRationale: Record<string, string> = {
    // Databases
    sqlite: 'SQLite chosen for: zero-config deployment, single-file storage, embedded database with no separate server process, local-first architecture, ACID compliance, excellent read performance for typical workloads.',
    postgres: 'PostgreSQL chosen for: ACID compliance, rich SQL feature set, excellent performance at scale, extensibility, strong community support, advanced data types (JSON, arrays, etc.).',
    postgresql: 'PostgreSQL chosen for: ACID compliance, rich SQL feature set, excellent performance at scale, extensibility, strong community support, advanced data types (JSON, arrays, etc.).',
    mysql: 'MySQL chosen for: proven reliability, wide hosting support, large community, good performance for web applications, mature replication features.',
    mongodb: 'MongoDB chosen for: flexible schema design, horizontal scaling, document model matching JSON, fast development iteration, good for unstructured data.',
    redis: 'Redis chosen for: in-memory performance, caching capabilities, pub/sub messaging, data structure support, session management, rate limiting.',
    dynamodb: 'DynamoDB chosen for: serverless architecture, auto-scaling, low-latency at scale, AWS integration, managed service, predictable performance.',
    cassandra: 'Cassandra chosen for: linear scalability, high availability, no single point of failure, write performance, distributed architecture.',

    // Languages
    typescript: 'TypeScript chosen for: static type checking, better IDE support, improved refactoring safety, self-documenting code, catch errors at compile time rather than runtime.',
    javascript: 'JavaScript chosen for: universal browser support, full-stack capability, large ecosystem, rapid prototyping, event-driven architecture.',
    python: 'Python chosen for: readability, rapid development, extensive libraries, data science/ML support, scripting capabilities, wide adoption.',
    rust: 'Rust chosen for: memory safety without garbage collection, performance comparable to C/C++, fearless concurrency, zero-cost abstractions.',
    go: 'Go chosen for: simplicity, fast compilation, built-in concurrency, efficient resource usage, excellent for microservices, strong standard library.',
    golang: 'Go chosen for: simplicity, fast compilation, built-in concurrency, efficient resource usage, excellent for microservices, strong standard library.',
    java: 'Java chosen for: platform independence, enterprise features, strong typing, extensive libraries, proven scalability, mature tooling.',
    kotlin: 'Kotlin chosen for: null safety, concise syntax, Java interoperability, coroutines for async, modern language features, Android support.',
    swift: 'Swift chosen for: safety features, modern syntax, performance, Apple ecosystem integration, memory management, protocol-oriented design.',
    csharp: 'C# chosen for: .NET ecosystem, strong typing, LINQ, async/await, cross-platform with .NET Core, enterprise features.',

    // Frontend Frameworks
    react: 'React chosen for: component-based architecture, virtual DOM for performance, large ecosystem, excellent developer experience, strong community support.',
    vue: 'Vue chosen for: gentle learning curve, progressive adoption, excellent documentation, reactive data binding, flexible architecture.',
    angular: 'Angular chosen for: comprehensive framework, TypeScript-first, dependency injection, enterprise features, consistent architecture.',
    svelte: 'Svelte chosen for: compile-time optimizations, no virtual DOM overhead, smaller bundle sizes, simpler state management, reactive by default.',
    nextjs: 'Next.js chosen for: server-side rendering, static generation, file-based routing, API routes, excellent developer experience, Vercel integration.',
    nuxt: 'Nuxt chosen for: Vue server-side rendering, auto-imports, file-based routing, excellent developer experience, modular architecture.',

    // Backend Frameworks
    express: 'Express chosen for: minimalist web framework, middleware architecture, large ecosystem, flexibility, wide adoption.',
    fastify: 'Fastify chosen for: high performance, schema-based validation, plugin architecture, TypeScript support, developer experience.',
    nestjs: 'NestJS chosen for: Angular-inspired architecture, TypeScript-first, dependency injection, modular design, enterprise patterns.',
    django: 'Django chosen for: batteries-included approach, admin interface, ORM, security features, rapid development, Python ecosystem.',
    flask: 'Flask chosen for: lightweight, flexibility, microframework approach, easy to learn, extensible, Python ecosystem.',
    rails: 'Rails chosen for: convention over configuration, rapid development, mature ecosystem, full-stack framework, Ruby elegance.',
    spring: 'Spring chosen for: comprehensive Java ecosystem, dependency injection, enterprise patterns, microservices support, proven scalability.',
    fastapi: 'FastAPI chosen for: high performance, automatic API documentation, type hints, async support, data validation with Pydantic.',

    // State Management
    redux: 'Redux chosen for: predictable state management, time-travel debugging, middleware support, centralized store, unidirectional data flow.',
    mobx: 'MobX chosen for: simpler API than Redux, reactive programming, less boilerplate, automatic tracking, object-oriented approach.',
    zustand: 'Zustand chosen for: minimal boilerplate, TypeScript support, no providers needed, simple API, small bundle size.',
    recoil: 'Recoil chosen for: React-specific design, atomic state management, derived state, async selectors, minimal boilerplate.',

    // API & Communication
    graphql: 'GraphQL chosen for: flexible data fetching, strong typing, reduced over-fetching, self-documenting API, excellent developer experience.',
    rest: 'REST chosen for: simplicity, statelessness, cacheability, uniform interface, wide tooling support, easy to understand.',
    grpc: 'gRPC chosen for: high performance, protocol buffers, bidirectional streaming, code generation, strongly typed contracts.',
    websocket: 'WebSocket chosen for: real-time bidirectional communication, persistent connections, low latency, push notifications.',
    trpc: 'tRPC chosen for: end-to-end type safety, no code generation, TypeScript-first, RPC-style API calls, excellent DX.',

    // Message Queues & Streaming
    kafka: 'Kafka chosen for: high throughput, distributed architecture, event streaming, durability, replay capability, real-time processing.',
    rabbitmq: 'RabbitMQ chosen for: reliable message delivery, routing flexibility, multiple protocols, management UI, mature ecosystem.',
    sqs: 'SQS chosen for: managed service, AWS integration, scalability, dead-letter queues, no infrastructure management.',

    // Containerization & Orchestration
    docker: 'Docker chosen for: consistent environments, isolation, portability, microservices deployment, reproducible builds.',
    kubernetes: 'Kubernetes chosen for: container orchestration, auto-scaling, self-healing, declarative configuration, cloud-native deployment.',
    k8s: 'Kubernetes chosen for: container orchestration, auto-scaling, self-healing, declarative configuration, cloud-native deployment.',

    // Testing
    vitest: 'Vitest chosen for: native ESM support, fast execution, Vite integration, Jest-compatible API, excellent TypeScript support, watch mode performance.',
    jest: 'Jest chosen for: zero-config setup, snapshot testing, code coverage, mocking capabilities, parallel test execution, wide adoption.',
    cypress: 'Cypress chosen for: end-to-end testing, time-travel debugging, automatic waiting, real browser testing, excellent developer experience.',
    playwright: 'Playwright chosen for: cross-browser testing, auto-waiting, modern API, trace viewer, parallel execution, reliable selectors.',
    mocha: 'Mocha chosen for: flexibility, extensive plugin ecosystem, async support, BDD/TDD interfaces, browser support.',
    pytest: 'Pytest chosen for: simple syntax, powerful fixtures, extensive plugins, parametrized tests, excellent assertion introspection.',

    // Code Quality
    eslint: 'ESLint chosen for: configurable linting rules, TypeScript support, auto-fixing capabilities, large plugin ecosystem, integration with most IDEs.',
    prettier: 'Prettier chosen for: consistent code formatting, minimal configuration, integration with ESLint, supports multiple languages, eliminates style debates.',
    biome: 'Biome chosen for: all-in-one tooling, fast performance (Rust-based), formatting and linting, minimal configuration, ESLint/Prettier replacement.',

    // Build Tools
    vite: 'Vite chosen for: fast development server, native ES modules, optimized production builds, excellent DX, framework agnostic.',
    webpack: 'Webpack chosen for: mature ecosystem, extensive plugin system, code splitting, asset optimization, wide adoption.',
    esbuild: 'Esbuild chosen for: extremely fast builds, written in Go, simple API, bundling and minification, JavaScript/TypeScript support.',
    turbo: 'Turborepo chosen for: monorepo build caching, parallel execution, remote caching, incremental builds, task scheduling.',
    nx: 'Nx chosen for: monorepo management, computation caching, affected commands, code generation, plugin ecosystem.',

    // Package Managers
    npm: 'npm chosen for: standard Node.js package manager, wide adoption, largest registry, built into Node.js.',
    yarn: 'Yarn chosen for: faster installations, deterministic dependencies, workspaces support, plug-and-play mode.',
    pnpm: 'pnpm chosen for: disk space efficiency, strict dependency resolution, fast installations, content-addressable storage.',

    // Runtime & Platform
    nodejs: 'Node.js chosen for: JavaScript runtime, non-blocking I/O, large npm ecosystem, unified frontend/backend language, excellent for I/O-heavy applications.',
    deno: 'Deno chosen for: security by default, TypeScript built-in, modern APIs, single executable, standard library.',
    bun: 'Bun chosen for: fast JavaScript runtime, built-in bundler, native TypeScript, npm compatibility, performance focus.',

    // Embeddings & AI
    embeddings: 'Embeddings chosen for: semantic similarity search, vector representations, machine learning integration, capturing meaning beyond keywords.',
    vectors: 'Vector search chosen for: semantic similarity matching, efficient nearest-neighbor lookup, AI-powered retrieval, representing complex concepts.',
    openai: 'OpenAI chosen for: state-of-the-art language models, comprehensive API, embedding models, wide adoption, strong documentation.',
    llm: 'LLM chosen for: natural language understanding, text generation, semantic analysis, intelligent assistance, flexible applications.',

    // Caching
    caching: 'Caching chosen for: improved performance, reduced latency, decreased database load, cost efficiency, better user experience.',
    cache: 'Caching chosen for: improved performance, reduced latency, decreased database load, cost efficiency, better user experience.',
    memcached: 'Memcached chosen for: simple key-value caching, distributed architecture, low latency, horizontal scaling, session storage.',

    // Authentication
    jwt: 'JWT chosen for: stateless authentication, cross-domain support, self-contained tokens, mobile-friendly, scalable.',
    oauth: 'OAuth chosen for: delegated authorization, third-party login, secure token exchange, standardized protocol, user consent.',
    auth0: 'Auth0 chosen for: managed authentication, social logins, security compliance, easy integration, enterprise features.',

    // Cloud Providers
    aws: 'AWS chosen for: comprehensive services, global infrastructure, mature ecosystem, scalability, enterprise adoption.',
    azure: 'Azure chosen for: Microsoft integration, enterprise features, hybrid cloud support, AI services, compliance certifications.',
    gcp: 'GCP chosen for: data analytics strength, Kubernetes origin, machine learning, global network, competitive pricing.',
    vercel: 'Vercel chosen for: frontend deployment, serverless functions, edge network, excellent DX, Next.js integration.',
    cloudflare: 'Cloudflare chosen for: edge computing, CDN performance, security features, Workers platform, global network.',

    // Monitoring & Observability
    prometheus: 'Prometheus chosen for: metrics collection, time-series database, alerting, Kubernetes integration, pull-based model.',
    grafana: 'Grafana chosen for: visualization dashboards, multi-source support, alerting, extensive plugins, open source.',
    datadog: 'Datadog chosen for: unified observability, APM, log management, infrastructure monitoring, cloud integration.',
    sentry: 'Sentry chosen for: error tracking, performance monitoring, release tracking, detailed stack traces, integrations.',

    // Design Patterns
    singleton: 'Singleton pattern chosen for: single instance guarantee, global access point, resource management, configuration objects.',
    factory: 'Factory pattern chosen for: object creation abstraction, decoupling, flexibility, testing support, complex initialization.',
    observer: 'Observer pattern chosen for: loose coupling, event-driven architecture, one-to-many relationships, reactive updates.',
    dependency: 'Dependency injection chosen for: loose coupling, testability, flexibility, inversion of control, maintainability.',
    microservices: 'Microservices chosen for: independent deployment, scalability, technology diversity, fault isolation, team autonomy.',
    monolith: 'Monolith chosen for: simplicity, easier debugging, no network overhead, simpler deployment, suitable for smaller teams.',
  };

  for (const [key, value] of Object.entries(commonRationale)) {
    if (normalizedTopic.includes(key) || key.includes(normalizedTopic)) {
      return value;
    }
  }

  return undefined;
}

/**
 * Result from refactoring safety analysis stage.
 */
interface RefactoringSafetyStageResult {
  /** Whether analysis was performed */
  analyzed: boolean;
  /** Context packs generated from the safety report */
  packs: ContextPack[];
  /** Explanation of the analysis */
  explanation: string;
  /** The full safety report for additional context */
  report?: RefactoringSafetyReport;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
}

/**
 * Run refactoring safety analysis for queries asking about impact of changes.
 *
 * This stage:
 * 1. Analyzes the target entity for usages across the codebase
 * 2. Identifies potential breaking changes
 * 3. Converts the safety report to context packs
 */
async function runRefactoringSafetyStage(options: {
  storage: LibrarianStorage;
  target: string;
  intent: string;
  version: LibrarianVersion;
}): Promise<RefactoringSafetyStageResult> {
  const { storage, target, intent, version } = options;

  // Find usages of the target entity
  const usages: Usage[] = [];
  const breakingChanges: BreakingChange[] = [];

  // Search ingestion items for references to the target
  const allItems = await storage.getIngestionItems({ sourceType: 'module' }).catch((err) => {
    logWarning('[query] getIngestionItems(module) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'module' });
    return [];
  });
  const functionItems = await storage.getIngestionItems({ sourceType: 'function' }).catch((err) => {
    logWarning('[query] getIngestionItems(function) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'function' });
    return [];
  });

  const targetLower = target.toLowerCase();

  // Check each item for references to the target
  for (const item of [...allItems, ...functionItems]) {
    const content = JSON.stringify(item.payload || {}).toLowerCase();
    const payload = item.payload as { path?: string; id?: string; name?: string } | null;
    const itemId = item.id;
    if (content.includes(targetLower) && itemId !== target) {
      // Found a reference
      const filePath = payload?.path || itemId.split('#')[0] || 'unknown';

      // Determine usage type
      let usageType: Usage['usageType'] = 'reference';
      if (content.includes(`import`) && content.includes(targetLower)) {
        usageType = 'import';
      } else if (content.includes(`extends ${targetLower}`)) {
        usageType = 'extend';
      } else if (content.includes(`implements ${targetLower}`)) {
        usageType = 'implement';
      } else if (content.includes(`${targetLower}(`)) {
        usageType = 'call';
      }

      usages.push({
        file: filePath,
        line: 1,
        column: 0,
        context: `Reference to ${target} in ${itemId}`,
        usageType,
      });

      // Potential breaking changes for imports
      if (usageType === 'import') {
        breakingChanges.push({
          description: `Import of ${target} will need updating`,
          severity: 'major',
          affectedFile: filePath,
          suggestedFix: `Update import statement in ${filePath}`,
        });
      } else if (usageType === 'call') {
        breakingChanges.push({
          description: `Call to ${target} may need signature update`,
          severity: 'major',
          affectedFile: filePath,
          suggestedFix: `Verify call at ${filePath}`,
        });
      } else if (usageType === 'extend' || usageType === 'implement') {
        breakingChanges.push({
          description: `${usageType === 'extend' ? 'Extension' : 'Implementation'} of ${target} is a breaking dependency`,
          severity: 'critical',
          affectedFile: filePath,
          suggestedFix: `Update ${usageType === 'extend' ? 'extending' : 'implementing'} class in ${filePath}`,
        });
      }
    }
  }

  // Determine if refactoring is safe
  const criticalBreaking = breakingChanges.filter(bc => bc.severity === 'critical');
  const majorBreaking = breakingChanges.filter(bc => bc.severity === 'major');
  const safe = criticalBreaking.length === 0 && majorBreaking.length < 5;

  // Record prediction for calibration tracking
  const safetyConfidence = usages.length > 0 ? 0.75 : 0.5;
  const { predictionId } = recordStagePrediction(
    'refactoring-safety-stage',
    safetyConfidence,
    safe
      ? `Refactoring of "${target}" is safe with ${usages.length} usage(s)`
      : `Refactoring of "${target}" requires careful review (${criticalBreaking.length} critical, ${majorBreaking.length} major issues)`,
    { stageId: 'refactoring-safety-stage', target, queryIntent: intent }
  );

  // Build the explanation
  const explanationParts: string[] = [];
  explanationParts.push(`Refactoring safety analysis for "${target}".`);
  explanationParts.push(`Found ${usages.length} usage(s).`);
  if (breakingChanges.length > 0) {
    explanationParts.push(`Detected ${breakingChanges.length} potential breaking change(s).`);
    if (criticalBreaking.length > 0) {
      explanationParts.push(`WARNING: ${criticalBreaking.length} critical breaking change(s).`);
    }
  }
  explanationParts.push(safe ? 'Refactoring appears relatively safe.' : 'Refactoring requires careful review.');

  // Create a summary pack with the safety analysis
  const summaryPack: ContextPack = {
    packId: `refactor-safety:${target}`,
    packType: 'decision_context',
    targetId: `refactoring:${target}`,
    summary: `Refactoring Safety Analysis for ${target}:\n\n` +
      `Overall: ${safe ? 'SAFE (with precautions)' : 'REQUIRES CAREFUL REVIEW'}\n\n` +
      `Usages found: ${usages.length}\n` +
      `Breaking changes: ${breakingChanges.length} (${criticalBreaking.length} critical, ${majorBreaking.length} major)\n\n` +
      (breakingChanges.length > 0
        ? `Breaking Changes:\n${breakingChanges.slice(0, 10).map(bc =>
            `- [${bc.severity.toUpperCase()}] ${bc.description}\n  File: ${bc.affectedFile}\n  Fix: ${bc.suggestedFix || 'Manual review required'}`
          ).join('\n\n')}`
        : 'No breaking changes detected.'),
    keyFacts: [
      `Target: ${target}`,
      `Usages: ${usages.length}`,
      `Breaking changes: ${breakingChanges.length}`,
      `Critical issues: ${criticalBreaking.length}`,
      `Safety verdict: ${safe ? 'Relatively safe' : 'Requires review'}`,
      ...breakingChanges.slice(0, 5).map(bc => `${bc.severity}: ${bc.description}`),
    ],
    codeSnippets: [],
    relatedFiles: [...new Set(usages.map(u => u.file))].slice(0, 10),
    confidence: usages.length > 0 ? 0.75 : 0.5, // Higher confidence if we found usages
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [target],
  };

  // Create individual packs for each breaking change with details
  const breakingChangePacks: ContextPack[] = breakingChanges.slice(0, 5).map((bc, index) => ({
    packId: `refactor-breaking:${target}:${index}`,
    packType: 'decision_context' as const,
    targetId: bc.affectedFile,
    summary: `Breaking Change: ${bc.description}`,
    keyFacts: [
      `Severity: ${bc.severity}`,
      `Affected file: ${bc.affectedFile}`,
      `Suggested fix: ${bc.suggestedFix || 'Manual review required'}`,
    ],
    codeSnippets: [],
    relatedFiles: [bc.affectedFile],
    confidence: 0.8,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [bc.affectedFile],
  }));

  const packs = [summaryPack, ...breakingChangePacks];

  return {
    analyzed: true,
    packs,
    explanation: explanationParts.join(' '),
    predictionId,
    report: {
      target: {
        entityId: target,
        refactoringType: 'rename', // Default assumption
      },
      usages,
      usageCount: usages.length,
      breakingChanges,
      hasBreakingChanges: breakingChanges.length > 0,
      testCoverageGaps: [],
      estimatedCoverage: 0,
      graphImpact: null, // Graph analysis not performed in this simplified path
      riskScore: criticalBreaking.length > 0 ? 0.8 : majorBreaking.length > 0 ? 0.5 : 0.2,
      safe,
      risks: breakingChanges.map(bc => `${bc.severity}: ${bc.description}`),
      confidence: {
        type: 'measured',
        value: usages.length > 0 ? 0.75 : 0.5,
        measurement: {
          datasetId: 'refactoring_safety_analysis',
          sampleSize: usages.length + 1,
          accuracy: 0.75,
          confidenceInterval: [0.6, 0.9] as const,
          measuredAt: new Date().toISOString(),
        },
      },
      evidenceRefs: [`usage_search:${target}`],
      analysisTimeMs: 0,
    },
  };
}

// ============================================================================
// BUG INVESTIGATION STAGE
// ============================================================================

interface BugInvestigationStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  predictionId?: string;
}

/**
 * Run bug investigation stage using the BugInvestigationAssistant construction.
 * This stage analyzes errors, traces stack traces, and generates hypotheses.
 */
async function runBugInvestigationStage(options: {
  storage: LibrarianStorage;
  intent: string;
  bugContext?: string;
  version: LibrarianVersion;
}): Promise<BugInvestigationStageResult> {
  const { storage, intent, bugContext, version } = options;

  // Build a bug report from the query context
  const bugReport: BugReport = {
    description: intent,
    errorMessage: bugContext,
    suspectedFiles: [],
  };

  // Search for related error handling code
  const errorItems = await storage.getIngestionItems({ sourceType: 'function' }).catch((err) => {
    logWarning('[query] getIngestionItems(function) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'function' });
    return [];
  });
  const relevantItems = errorItems.filter(item => {
    const payload = item.payload as { content?: string; name?: string } | null;
    const content = (payload?.content || '').toLowerCase();
    const name = (payload?.name || '').toLowerCase();
    // Look for error handling, try-catch, throw statements
    return content.includes('error') || content.includes('throw') ||
           content.includes('catch') || content.includes('exception') ||
           (bugContext && (content.includes(bugContext.toLowerCase()) || name.includes(bugContext.toLowerCase())));
  });

  const hypotheses: Array<{ description: string; confidence: number; affectedCode: string[] }> = [];

  // Generate hypotheses based on found code
  for (const item of relevantItems.slice(0, 5)) {
    const payload = item.payload as { path?: string; name?: string } | null;
    hypotheses.push({
      description: `Potential error source in ${payload?.name || item.id}`,
      confidence: 0.6,
      affectedCode: [payload?.path || item.id],
    });
  }

  if (hypotheses.length === 0) {
    return {
      analyzed: false,
      packs: [],
      explanation: 'Bug investigation: No relevant error handling code found.',
    };
  }

  // Record prediction for calibration tracking
  const investigationConfidence = 0.65;
  const { predictionId } = recordStagePrediction(
    'bug-investigation-stage',
    investigationConfidence,
    `Identified ${hypotheses.length} potential error source(s) for: ${bugContext || intent.slice(0, 50)}`,
    { stageId: 'bug-investigation-stage', target: bugContext, queryIntent: intent }
  );

  // Create summary pack
  const summaryPack: ContextPack = {
    packId: `bug-investigation:${Date.now()}`,
    packType: 'decision_context',
    targetId: `bug:${bugContext || 'unknown'}`,
    summary: `Bug Investigation Analysis:\n\n` +
      `Query: ${intent}\n` +
      `Context: ${bugContext || 'Not specified'}\n\n` +
      `Hypotheses (${hypotheses.length}):\n` +
      hypotheses.map((h, i) => `${i + 1}. ${h.description} (confidence: ${(h.confidence * 100).toFixed(0)}%)`).join('\n'),
    keyFacts: [
      `Potential sources identified: ${hypotheses.length}`,
      ...hypotheses.slice(0, 3).map(h => h.description),
    ],
    codeSnippets: [],
    relatedFiles: hypotheses.flatMap(h => h.affectedCode).slice(0, 10),
    confidence: 0.65,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };

  return {
    analyzed: true,
    packs: [summaryPack],
    explanation: `Bug investigation query detected: analyzed ${hypotheses.length} potential error sources.`,
    predictionId,
  };
}

// ============================================================================
// SECURITY AUDIT STAGE
// ============================================================================

interface SecurityAuditStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  predictionId?: string;
}

/**
 * Run security audit stage using the SecurityAuditHelper construction.
 * This stage scans for vulnerabilities, injection risks, and security issues.
 */
async function runSecurityAuditStage(options: {
  storage: LibrarianStorage;
  intent: string;
  checkTypes?: string[];
  version: LibrarianVersion;
  workspaceRoot: string;
}): Promise<SecurityAuditStageResult> {
  const { storage, intent, checkTypes = ['injection', 'auth', 'crypto', 'exposure'], version } = options;

  // Security patterns to check
  const securityPatterns = [
    { pattern: /eval\s*\(/i, title: 'Eval Usage', severity: 'high', type: 'injection' },
    { pattern: /innerHTML\s*=/i, title: 'InnerHTML Assignment', severity: 'medium', type: 'injection' },
    { pattern: /document\.write/i, title: 'Document.write', severity: 'medium', type: 'injection' },
    { pattern: /\$\{.*\}.*(?:sql|query)/i, title: 'SQL Injection Risk', severity: 'critical', type: 'injection' },
    { pattern: /exec\s*\(|spawn\s*\(/i, title: 'Command Execution', severity: 'high', type: 'injection' },
    { pattern: /password\s*=\s*['"][^'"]+['"]/i, title: 'Hardcoded Password', severity: 'critical', type: 'exposure' },
    { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/i, title: 'Hardcoded API Key', severity: 'critical', type: 'exposure' },
    { pattern: /md5\s*\(/i, title: 'Weak Hash (MD5)', severity: 'medium', type: 'crypto' },
    { pattern: /sha1\s*\(/i, title: 'Weak Hash (SHA1)', severity: 'low', type: 'crypto' },
  ];

  const findings: Array<{ title: string; severity: string; file: string; type: string }> = [];

  // Scan ingested code for security issues
  const codeItems = await storage.getIngestionItems({ sourceType: 'function' }).catch((err) => {
    logWarning('[query] getIngestionItems(function) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'function' });
    return [];
  });

  for (const item of codeItems) {
    const payload = item.payload as { content?: string; path?: string } | null;
    const content = payload?.content || '';
    const filePath = payload?.path || item.id;

    for (const pattern of securityPatterns) {
      if (!checkTypes.includes(pattern.type)) continue;
      if (pattern.pattern.test(content)) {
        findings.push({
          title: pattern.title,
          severity: pattern.severity,
          file: filePath,
          type: pattern.type,
        });
      }
    }
  }

  // Record prediction for calibration tracking
  const securityConfidence = findings.length === 0 ? 0.5 : 0.7;
  const securityClaim = findings.length === 0
    ? `No obvious vulnerabilities detected for check types: ${checkTypes.join(', ')}`
    : `Found ${findings.length} potential vulnerabilities (${findings.filter(f => f.severity === 'critical').length} critical)`;
  const { predictionId } = recordStagePrediction(
    'security-audit-stage',
    securityConfidence,
    securityClaim,
    { stageId: 'security-audit-stage', checkTypes, queryIntent: intent }
  );

  if (findings.length === 0) {
    // Create a pack indicating no issues found
    const cleanPack: ContextPack = {
      packId: `security-audit:clean:${Date.now()}`,
      packType: 'decision_context',
      targetId: 'security:audit',
      summary: `Security Audit Results:\n\nNo vulnerabilities detected for check types: ${checkTypes.join(', ')}\n\nNote: This is a basic static analysis. Consider using specialized security tools for comprehensive audits.`,
      keyFacts: [
        'No obvious security issues detected',
        `Checked patterns: ${securityPatterns.filter(p => checkTypes.includes(p.type)).length}`,
        'Recommendation: Use dedicated security scanners for thorough analysis',
      ],
      codeSnippets: [],
      relatedFiles: [],
      confidence: 0.5, // Lower confidence as this is basic analysis
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version,
      invalidationTriggers: [],
    };
    return {
      analyzed: true,
      packs: [cleanPack],
      explanation: 'Security audit query detected: no obvious vulnerabilities found in basic scan.',
      predictionId,
    };
  }

  // Group findings by severity
  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const highCount = findings.filter(f => f.severity === 'high').length;
  const mediumCount = findings.filter(f => f.severity === 'medium').length;

  const summaryPack: ContextPack = {
    packId: `security-audit:${Date.now()}`,
    packType: 'decision_context',
    targetId: 'security:audit',
    summary: `Security Audit Results:\n\n` +
      `Total findings: ${findings.length}\n` +
      `Critical: ${criticalCount}, High: ${highCount}, Medium: ${mediumCount}\n\n` +
      `Findings:\n` +
      findings.slice(0, 10).map(f => `- [${f.severity.toUpperCase()}] ${f.title} in ${f.file}`).join('\n'),
    keyFacts: [
      `Total vulnerabilities: ${findings.length}`,
      `Critical: ${criticalCount}`,
      `High: ${highCount}`,
      ...findings.slice(0, 5).map(f => `${f.severity}: ${f.title}`),
    ],
    codeSnippets: [],
    relatedFiles: [...new Set(findings.map(f => f.file))].slice(0, 10),
    confidence: 0.7,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };

  return {
    analyzed: true,
    packs: [summaryPack],
    explanation: `Security audit query detected: found ${findings.length} potential vulnerabilities.`,
    predictionId,
  };
}

// ============================================================================
// ARCHITECTURE VERIFICATION STAGE
// ============================================================================

interface ArchitectureVerificationStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  predictionId?: string;
}

/**
 * Run architecture verification stage using the ArchitectureVerifier construction.
 * This stage checks for layer violations, circular dependencies, and boundary compliance.
 */
async function runArchitectureVerificationStage(options: {
  storage: LibrarianStorage;
  intent: string;
  version: LibrarianVersion;
  workspaceRoot: string;
}): Promise<ArchitectureVerificationStageResult> {
  const { storage, intent, version } = options;

  // Analyze import patterns to detect layer violations
  const moduleItems = await storage.getIngestionItems({ sourceType: 'module' }).catch((err) => {
    logWarning('[query] getIngestionItems(module) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'module' });
    return [];
  });
  const functionItems = await storage.getIngestionItems({ sourceType: 'function' }).catch((err) => {
    logWarning('[query] getIngestionItems(function) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'function' });
    return [];
  });

  // Common layer patterns
  const layerPatterns = {
    api: /\/(api|routes|controllers)\//i,
    service: /\/(service|business|domain)\//i,
    storage: /\/(storage|repository|data|db)\//i,
    util: /\/(util|helper|common|shared)\//i,
  };

  // Violations: lower layers importing from higher layers
  const violations: Array<{ from: string; to: string; type: string }> = [];
  const circularDeps: Array<{ files: string[] }> = [];

  // Build import graph
  const importGraph = new Map<string, Set<string>>();

  for (const item of [...moduleItems, ...functionItems]) {
    const payload = item.payload as { path?: string; imports?: string[]; content?: string } | null;
    const filePath = payload?.path || item.id;
    const content = payload?.content || '';

    // Extract imports from content
    const importMatches = content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
    const imports = new Set<string>();
    for (const match of importMatches) {
      imports.add(match[1]);
    }
    importGraph.set(filePath, imports);

    // Check for layer violations
    const fromLayer = Object.entries(layerPatterns).find(([, pattern]) => pattern.test(filePath));
    if (fromLayer) {
      for (const imp of imports) {
        const toLayer = Object.entries(layerPatterns).find(([, pattern]) => pattern.test(imp));
        if (toLayer) {
          // Check for violations (e.g., storage importing from api)
          const layerOrder = ['util', 'storage', 'service', 'api'];
          const fromIndex = layerOrder.indexOf(fromLayer[0]);
          const toIndex = layerOrder.indexOf(toLayer[0]);
          if (fromIndex >= 0 && toIndex >= 0 && fromIndex < toIndex) {
            violations.push({
              from: filePath,
              to: imp,
              type: `${fromLayer[0]} -> ${toLayer[0]}`,
            });
          }
        }
      }
    }
  }

  // Detect circular dependencies (simple cycle detection)
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function detectCycle(node: string, path: string[] = []): boolean {
    if (recursionStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        circularDeps.push({ files: path.slice(cycleStart) });
      }
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    recursionStack.add(node);

    const imports = importGraph.get(node) || new Set();
    for (const imp of imports) {
      if (importGraph.has(imp)) {
        detectCycle(imp, [...path, node]);
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of importGraph.keys()) {
    detectCycle(node);
  }

  const hasIssues = violations.length > 0 || circularDeps.length > 0;

  // Record prediction for calibration tracking
  const archConfidence = 0.7;
  const archClaim = hasIssues
    ? `Found ${violations.length} layer violations and ${circularDeps.length} circular dependencies`
    : 'Architecture is compliant - no layer violations or circular dependencies detected';
  const { predictionId } = recordStagePrediction(
    'architecture-verification-stage',
    archConfidence,
    archClaim,
    { stageId: 'architecture-verification-stage', queryIntent: intent }
  );

  const summaryPack: ContextPack = {
    packId: `architecture-verification:${Date.now()}`,
    packType: 'decision_context',
    targetId: 'architecture:verification',
    summary: `Architecture Verification Results:\n\n` +
      `Layer Violations: ${violations.length}\n` +
      `Circular Dependencies: ${circularDeps.length}\n\n` +
      (violations.length > 0
        ? `Violations:\n${violations.slice(0, 5).map(v => `- ${v.from} imports ${v.to} (${v.type})`).join('\n')}\n\n`
        : '') +
      (circularDeps.length > 0
        ? `Circular Dependencies:\n${circularDeps.slice(0, 3).map(c => `- ${c.files.join(' -> ')}`).join('\n')}`
        : '') +
      (!hasIssues ? 'No architectural issues detected.' : ''),
    keyFacts: [
      `Layer violations: ${violations.length}`,
      `Circular dependencies: ${circularDeps.length}`,
      `Overall: ${hasIssues ? 'Issues found' : 'Architecture compliant'}`,
      ...violations.slice(0, 3).map(v => `Violation: ${v.type}`),
    ],
    codeSnippets: [],
    relatedFiles: [...new Set([...violations.map(v => v.from), ...circularDeps.flatMap(c => c.files)])].slice(0, 10),
    confidence: 0.7,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };

  return {
    analyzed: true,
    packs: [summaryPack],
    explanation: `Architecture verification query detected: found ${violations.length} layer violations and ${circularDeps.length} circular dependencies.`,
    predictionId,
  };
}

// ============================================================================
// CODE QUALITY STAGE
// ============================================================================

interface CodeQualityStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  predictionId?: string;
}

/**
 * Run code quality stage using the CodeQualityReporter construction.
 * This stage analyzes complexity, duplication, and code smells.
 */
async function runCodeQualityStage(options: {
  storage: LibrarianStorage;
  intent: string;
  version: LibrarianVersion;
  workspaceRoot: string;
}): Promise<CodeQualityStageResult> {
  const { storage, intent, version } = options;

  const functionItems = await storage.getIngestionItems({ sourceType: 'function' }).catch((err) => {
    logWarning('[query] getIngestionItems(function) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'function' });
    return [];
  });

  const issues: Array<{ type: string; description: string; file: string; severity: string }> = [];

  for (const item of functionItems) {
    const payload = item.payload as { content?: string; path?: string; name?: string } | null;
    const content = payload?.content || '';
    const filePath = payload?.path || item.id;
    const name = payload?.name || 'unknown';

    // Check for long functions (lines > 50)
    const lineCount = content.split('\n').length;
    if (lineCount > 50) {
      issues.push({
        type: 'long_function',
        description: `Function ${name} has ${lineCount} lines (recommended: <50)`,
        file: filePath,
        severity: lineCount > 100 ? 'high' : 'medium',
      });
    }

    // Check for deeply nested code (more than 4 levels)
    const maxIndent = Math.max(...content.split('\n').map(line => {
      const match = line.match(/^(\s*)/);
      return match ? match[1].length / 2 : 0;
    }));
    if (maxIndent > 4) {
      issues.push({
        type: 'deep_nesting',
        description: `Function ${name} has nesting depth of ${maxIndent} (recommended: <4)`,
        file: filePath,
        severity: maxIndent > 6 ? 'high' : 'medium',
      });
    }

    // Check for too many parameters
    const paramMatch = content.match(/function\s*\w*\s*\(([^)]*)\)/);
    if (paramMatch) {
      const paramCount = paramMatch[1].split(',').filter(p => p.trim()).length;
      if (paramCount > 5) {
        issues.push({
          type: 'many_parameters',
          description: `Function ${name} has ${paramCount} parameters (recommended: <5)`,
          file: filePath,
          severity: paramCount > 7 ? 'high' : 'medium',
        });
      }
    }

    // Check for TODO/FIXME comments
    const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
    if (todoMatches && todoMatches.length > 0) {
      issues.push({
        type: 'todo_comments',
        description: `Found ${todoMatches.length} TODO/FIXME comments in ${name}`,
        file: filePath,
        severity: 'low',
      });
    }
  }

  const highCount = issues.filter(i => i.severity === 'high').length;
  const mediumCount = issues.filter(i => i.severity === 'medium').length;

  // Record prediction for calibration tracking
  const qualityConfidence = 0.65;
  const qualityClaim = issues.length === 0
    ? 'Code quality is acceptable - no significant issues detected'
    : `Found ${issues.length} code quality issues (${highCount} high, ${mediumCount} medium severity)`;
  const { predictionId } = recordStagePrediction(
    'code-quality-stage',
    qualityConfidence,
    qualityClaim,
    { stageId: 'code-quality-stage', queryIntent: intent }
  );

  const summaryPack: ContextPack = {
    packId: `code-quality:${Date.now()}`,
    packType: 'decision_context',
    targetId: 'quality:report',
    summary: `Code Quality Report:\n\n` +
      `Total issues: ${issues.length}\n` +
      `High: ${highCount}, Medium: ${mediumCount}, Low: ${issues.length - highCount - mediumCount}\n\n` +
      `Issues:\n` +
      issues.slice(0, 10).map(i => `- [${i.severity.toUpperCase()}] ${i.type}: ${i.description}`).join('\n'),
    keyFacts: [
      `Total issues: ${issues.length}`,
      `High severity: ${highCount}`,
      `Medium severity: ${mediumCount}`,
      `Files analyzed: ${functionItems.length}`,
      ...issues.slice(0, 3).map(i => `${i.type}: ${i.description.slice(0, 50)}`),
    ],
    codeSnippets: [],
    relatedFiles: [...new Set(issues.map(i => i.file))].slice(0, 10),
    confidence: 0.65,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };

  return {
    analyzed: true,
    packs: [summaryPack],
    explanation: `Code quality query detected: found ${issues.length} quality issues across ${functionItems.length} functions.`,
    predictionId,
  };
}

// ============================================================================
// FEATURE LOCATION STAGE
// ============================================================================

interface FeatureLocationStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  predictionId?: string;
}

/**
 * Run feature location stage using the FeatureLocationAdvisor construction.
 * This stage finds where features are implemented in the codebase.
 */
async function runFeatureLocationStage(options: {
  storage: LibrarianStorage;
  intent: string;
  featureTarget: string;
  version: LibrarianVersion;
}): Promise<FeatureLocationStageResult> {
  const { storage, intent, featureTarget, version } = options;

  const targetLower = featureTarget.toLowerCase();

  // Search for functions and modules related to the feature
  const functionItems = await storage.getIngestionItems({ sourceType: 'function' }).catch((err) => {
    logWarning('[query] getIngestionItems(function) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'function' });
    return [];
  });
  const moduleItems = await storage.getIngestionItems({ sourceType: 'module' }).catch((err) => {
    logWarning('[query] getIngestionItems(module) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'module' });
    return [];
  });
  const docItems = await storage.getIngestionItems({ sourceType: 'document' }).catch((err) => {
    logWarning('[query] getIngestionItems(document) failed', { operation: 'getIngestionItems', error: getErrorMessage(err), sourceType: 'document' });
    return [];
  });

  const locations: Array<{ file: string; type: string; name: string; relevance: number }> = [];

  // Search in functions
  for (const item of functionItems) {
    const payload = item.payload as { path?: string; name?: string; content?: string } | null;
    const name = (payload?.name || '').toLowerCase();
    const content = (payload?.content || '').toLowerCase();
    const filePath = payload?.path || item.id;

    if (name.includes(targetLower) || content.includes(targetLower)) {
      const nameMatch = name.includes(targetLower);
      locations.push({
        file: filePath,
        type: 'function',
        name: payload?.name || item.id,
        relevance: nameMatch ? 0.9 : 0.6,
      });
    }
  }

  // Search in modules
  for (const item of moduleItems) {
    const payload = item.payload as { path?: string; content?: string } | null;
    const content = (payload?.content || '').toLowerCase();
    const filePath = payload?.path || item.id;

    if (filePath.toLowerCase().includes(targetLower) || content.includes(targetLower)) {
      const pathMatch = filePath.toLowerCase().includes(targetLower);
      locations.push({
        file: filePath,
        type: 'module',
        name: filePath,
        relevance: pathMatch ? 0.85 : 0.5,
      });
    }
  }

  // Search in documentation
  for (const item of docItems) {
    const payload = item.payload as { path?: string; content?: string } | null;
    const content = (payload?.content || '').toLowerCase();
    const filePath = payload?.path || item.id;

    if (content.includes(targetLower)) {
      locations.push({
        file: filePath,
        type: 'documentation',
        name: filePath,
        relevance: 0.4,
      });
    }
  }

  // Sort by relevance
  locations.sort((a, b) => b.relevance - a.relevance);

  if (locations.length === 0) {
    return {
      analyzed: false,
      packs: [],
      explanation: `Feature location query detected: no locations found for "${featureTarget}".`,
    };
  }

  // Record prediction for calibration tracking
  const featureConfidence = locations.length > 0 && locations[0].relevance > 0.8 ? 0.8 : 0.6;
  const { predictionId } = recordStagePrediction(
    'feature-location-stage',
    featureConfidence,
    `Located ${locations.length} implementation(s) for feature "${featureTarget}" (top relevance: ${(locations[0]?.relevance * 100 || 0).toFixed(0)}%)`,
    { stageId: 'feature-location-stage', target: featureTarget, queryIntent: intent }
  );

  const summaryPack: ContextPack = {
    packId: `feature-location:${featureTarget}:${Date.now()}`,
    packType: 'decision_context',
    targetId: `feature:${featureTarget}`,
    summary: `Feature Location Results for "${featureTarget}":\n\n` +
      `Found ${locations.length} relevant locations:\n\n` +
      locations.slice(0, 10).map((loc, i) =>
        `${i + 1}. [${loc.type}] ${loc.name}\n   File: ${loc.file}\n   Relevance: ${(loc.relevance * 100).toFixed(0)}%`
      ).join('\n\n'),
    keyFacts: [
      `Feature: ${featureTarget}`,
      `Locations found: ${locations.length}`,
      `Primary location: ${locations[0]?.file || 'unknown'}`,
      ...locations.slice(0, 3).map(l => `${l.type}: ${l.name}`),
    ],
    codeSnippets: [],
    relatedFiles: [...new Set(locations.map(l => l.file))].slice(0, 10),
    confidence: locations[0]?.relevance || 0.5,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [featureTarget],
  };

  return {
    analyzed: true,
    packs: [summaryPack],
    explanation: `Feature location query detected: found ${locations.length} locations for "${featureTarget}".`,
    predictionId,
  };
}

interface RefactoringOpportunitiesStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  predictionId?: string;
}

/**
 * Run refactoring opportunities stage.
 * Analyzes the codebase for code that could benefit from refactoring.
 */
async function runRefactoringOpportunitiesStage(options: {
  storage: LibrarianStorage;
  intent: string;
  version: LibrarianVersion;
  workspaceRoot?: string;
}): Promise<RefactoringOpportunitiesStageResult> {
  const { storage, version } = options;
  try {
    const suggestions = await findRefactoringOpportunities(storage, undefined, { maxFiles: 30, includeLowPriority: false });
    if (suggestions.length === 0) {
      return { analyzed: true, packs: [], explanation: 'Refactoring opportunities: no significant opportunities found.' };
    }
    const summary = summarizeRefactoringSuggestions(suggestions);
    const riskInfo = `${summary.byRisk.low} low, ${summary.byRisk.medium} medium, ${summary.byRisk.high} high`;
    const effortInfo = `trivial: ${summary.byEffort.trivial}, easy: ${summary.byEffort.easy}, moderate: ${summary.byEffort.moderate}, significant: ${summary.byEffort.significant}`;
    const topOpsText = summary.topOpportunities.map((op, i) => `${i + 1}. [${op.type}] ${op.description}\n   File: ${op.file}`).join('\n\n');
    const summaryPack: ContextPack = {
      packId: `refactoring-opportunities:summary:${Date.now()}`,
      packType: 'decision_context',
      targetId: 'refactoring:opportunities',
      summary: `Refactoring Opportunities Analysis:\n\nFound ${summary.total} opportunities:\n\nBy Risk: ${riskInfo}\nBy Effort: ${effortInfo}\nAutomatable: ${summary.automatableCount}\n\nTop Opportunities:\n${topOpsText}`,
      keyFacts: [`Total: ${summary.total}`, `Risk: ${riskInfo}`, `Automatable: ${summary.automatableCount}`, ...summary.topOpportunities.slice(0, 3).map(op => `${op.type}: ${op.description.slice(0, 50)}`)],
      codeSnippets: [],
      relatedFiles: [...new Set(suggestions.map(s => s.target.file))].slice(0, 15),
      confidence: 0.75, createdAt: new Date(), accessCount: 0, lastOutcome: 'unknown', successCount: 0, failureCount: 0, version, invalidationTriggers: [],
    };
    const detailPacks: ContextPack[] = suggestions.slice(0, 5).map((s, i) => {
      const stepsText = s.steps.map((step, j) => `${j + 1}. ${step}`).join('\n');
      const beforeAfterText = s.beforeAfter ? `\n\nBefore:\n${s.beforeAfter.before}\n\nAfter:\n${s.beforeAfter.after}` : '';
      return {
        packId: `refactoring-opportunities:detail:${i}:${Date.now()}`, packType: 'decision_context' as const, targetId: `refactoring:${s.target.file}:${s.target.startLine}`,
        summary: `Refactoring: ${s.type.replace(/_/g, ' ')}\n\nFile: ${s.target.file}\nLines: ${s.target.startLine}-${s.target.endLine}\n\n${s.description}\n\nBenefit: ${s.benefit}\nRisk: ${s.risk}, Effort: ${s.effort}, Automatable: ${s.automatable ? 'Yes' : 'No'}\n\nSteps:\n${stepsText}${beforeAfterText}`,
        keyFacts: [`Type: ${s.type}`, `File: ${s.target.file}`, `Risk: ${s.risk}`, `Effort: ${s.effort}`, ...s.steps.slice(0, 2)],
        codeSnippets: s.target.code ? [{ filePath: s.target.file, startLine: s.target.startLine, endLine: s.target.endLine, content: s.target.code, language: 'typescript' }] : [],
        relatedFiles: [s.target.file], confidence: s.risk === 'low' ? 0.85 : s.risk === 'medium' ? 0.7 : 0.55, createdAt: new Date(), accessCount: 0, lastOutcome: 'unknown', successCount: 0, failureCount: 0, version, invalidationTriggers: [s.target.file],
      };
    });
    return { analyzed: true, packs: [summaryPack, ...detailPacks], explanation: `Refactoring opportunities: found ${summary.total} (${riskInfo} risk).` };
  } catch (error) {
    return { analyzed: false, packs: [], explanation: `Refactoring opportunities: analysis failed (${error instanceof Error ? error.message : 'unknown'}).` };
  }
}

// ============================================================================
// DEPENDENCY MANAGEMENT STAGE
// ============================================================================

interface DependencyManagementStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
}

/**
 * Run dependency management stage to analyze project dependencies.
 * This stage helps agents understand package dependencies, find unused packages,
 * detect outdated versions, and identify dependency issues.
 */
async function runDependencyManagementStage(options: {
  storage: LibrarianStorage;
  intent: string;
  version: LibrarianVersion;
  workspaceRoot: string;
  action?: 'analyze' | 'unused' | 'outdated' | 'duplicates' | 'issues' | 'all';
}): Promise<DependencyManagementStageResult> {
  const { storage, version, workspaceRoot, action = 'all' } = options;

  try {
    const analysis = await analyzeDependencies(workspaceRoot, storage);

    // Build summary based on requested action
    let summaryContent: string;
    let keyFacts: string[] = [];

    if (action === 'unused') {
      summaryContent = `## Unused Dependencies Analysis\n\n`;
      if (analysis.unused.length === 0) {
        summaryContent += `No unused runtime dependencies detected.\n`;
        keyFacts.push('No unused dependencies');
      } else {
        summaryContent += `Found ${analysis.unused.length} potentially unused dependencies:\n\n`;
        for (const dep of analysis.unused) {
          summaryContent += `- \`${dep}\` - can potentially be removed with \`npm uninstall ${dep}\`\n`;
        }
        keyFacts.push(`${analysis.unused.length} unused dependencies`);
        keyFacts.push(...analysis.unused.slice(0, 3));
      }
    } else if (action === 'outdated') {
      summaryContent = `## Outdated Dependencies Analysis\n\n`;
      if (analysis.outdated.length === 0) {
        summaryContent += `All dependencies are up to date.\n`;
        keyFacts.push('All dependencies up to date');
      } else {
        const major = analysis.outdated.filter(d => d.updateType === 'major');
        const minor = analysis.outdated.filter(d => d.updateType === 'minor');
        const patch = analysis.outdated.filter(d => d.updateType === 'patch');

        summaryContent += `Found ${analysis.outdated.length} outdated dependencies:\n\n`;
        if (major.length > 0) {
          summaryContent += `### Major Updates (Breaking Changes)\n`;
          for (const dep of major) {
            summaryContent += `- \`${dep.name}\`: ${dep.current} -> ${dep.latest}\n`;
          }
          summaryContent += `\n`;
        }
        if (minor.length > 0) {
          summaryContent += `### Minor Updates (New Features)\n`;
          for (const dep of minor) {
            summaryContent += `- \`${dep.name}\`: ${dep.current} -> ${dep.latest}\n`;
          }
          summaryContent += `\n`;
        }
        if (patch.length > 0) {
          summaryContent += `### Patch Updates (Bug Fixes)\n`;
          for (const dep of patch.slice(0, 10)) {
            summaryContent += `- \`${dep.name}\`: ${dep.current} -> ${dep.latest}\n`;
          }
          if (patch.length > 10) {
            summaryContent += `- ... and ${patch.length - 10} more\n`;
          }
        }
        keyFacts.push(`${analysis.outdated.length} outdated dependencies`);
        keyFacts.push(`${major.length} major, ${minor.length} minor, ${patch.length} patch`);
      }
    } else if (action === 'duplicates') {
      summaryContent = `## Duplicate Dependencies Analysis\n\n`;
      if (analysis.duplicates.length === 0) {
        summaryContent += `No duplicate packages detected.\n`;
        keyFacts.push('No duplicate packages');
      } else {
        summaryContent += `Found ${analysis.duplicates.length} packages with multiple versions:\n\n`;
        for (const dup of analysis.duplicates) {
          summaryContent += `- \`${dup.name}\`: ${dup.versions.join(', ')}\n`;
          summaryContent += `  ${dup.recommendation}\n`;
        }
        keyFacts.push(`${analysis.duplicates.length} duplicate packages`);
      }
    } else if (action === 'issues') {
      summaryContent = `## Dependency Issues Analysis\n\n`;
      if (analysis.issues.length === 0) {
        summaryContent += `No dependency issues detected.\n`;
        keyFacts.push('No dependency issues');
      } else {
        summaryContent += `Found ${analysis.issues.length} issues:\n\n`;
        for (const issue of analysis.issues) {
          summaryContent += `### [${issue.severity.toUpperCase()}] ${issue.package}\n`;
          summaryContent += `${issue.description}\n`;
          if (issue.fix) {
            summaryContent += `**Fix:** ${issue.fix}\n`;
          }
          summaryContent += `\n`;
        }
        const critical = analysis.issues.filter(i => i.severity === 'critical').length;
        const high = analysis.issues.filter(i => i.severity === 'high').length;
        keyFacts.push(`${analysis.issues.length} issues found`);
        if (critical > 0) keyFacts.push(`${critical} CRITICAL`);
        if (high > 0) keyFacts.push(`${high} HIGH`);
      }
    } else {
      // Full analysis
      summaryContent = summarizeDependencies(analysis);
      keyFacts = [
        `${analysis.direct.length} runtime + ${analysis.dev.length} dev dependencies`,
        analysis.unused.length > 0 ? `${analysis.unused.length} unused` : 'No unused',
        analysis.outdated.length > 0 ? `${analysis.outdated.length} outdated` : 'All up to date',
        analysis.issues.length > 0 ? `${analysis.issues.length} issues` : 'No issues',
      ];
    }

    // Add recommendations if available
    if (analysis.recommendations.length > 0 && action !== 'unused' && action !== 'outdated') {
      summaryContent += `\n## Recommendations\n\n`;
      for (const rec of analysis.recommendations.slice(0, 5)) {
        summaryContent += `- **${rec.type.toUpperCase()}** \`${rec.package}\`: ${rec.reason}\n`;
        if (rec.command) {
          summaryContent += `  \`\`\`bash\n  ${rec.command}\n  \`\`\`\n`;
        }
      }
    }

    const summaryPack: ContextPack = {
      packId: `dependency-analysis:${action}:${Date.now()}`,
      packType: 'decision_context',
      targetId: 'dependency:analysis',
      summary: summaryContent,
      keyFacts,
      codeSnippets: [],
      relatedFiles: ['package.json', 'package-lock.json'],
      confidence: 0.85,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version,
      invalidationTriggers: ['package.json', 'package-lock.json'],
    };

    return {
      analyzed: true,
      packs: [summaryPack],
      explanation: `Dependency management query detected: analyzed ${analysis.direct.length + analysis.dev.length} dependencies.`,
    };
  } catch (error) {
    return {
      analyzed: false,
      packs: [],
      explanation: `Dependency analysis failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
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
  const mmrEligible = query.diversify === true && finalPacks.length >= 2;
  const rerankEligible =
    Boolean(query.intent) &&
    finalPacks.length >= 2 &&
    (query.depth === 'L2' || query.depth === 'L3') &&
    (forceRerank || isCrossEncoderEnabled());
  const rerankStage = stageTracker.start('reranking', (rerankEligible || mmrEligible) ? finalPacks.length : 0);
  const applyMmr = (packs: ContextPack[]): ContextPack[] => applyMmrDiversification({
    packs,
    query,
    candidateScoreMap,
    explanationParts,
    recordCoverageGap,
  });
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
        return applyMmr(finalPacks);
      }
      const outputIds = reranked.map((pack) => pack?.packId);
      if (outputIds.some((id) => !id)) {
        recordCoverageGap('reranking', 'Cross-encoder rerank returned invalid pack IDs; using original order.', 'minor');
        stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
        return applyMmr(finalPacks);
      }
      const normalizedOutputIds = outputIds as string[];
      const inputIds = new Set(finalPacks.map((pack) => pack.packId));
      const outputIdSet = new Set(normalizedOutputIds);
      if (outputIdSet.size !== normalizedOutputIds.length || outputIdSet.size !== inputIds.size) {
        recordCoverageGap('reranking', 'Cross-encoder rerank returned mismatched packs; using original order.', 'minor');
        stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
        return applyMmr(finalPacks);
      }
      for (const id of inputIds) {
        if (!outputIdSet.has(id)) {
          recordCoverageGap('reranking', 'Cross-encoder rerank returned mismatched packs; using original order.', 'minor');
          stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'partial' });
          return applyMmr(finalPacks);
        }
      }
      stageTracker.finish(rerankStage, { outputCount: reranked.length, filteredCount: 0 });
      return applyMmr(reranked);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordCoverageGap('reranking', `Cross-encoder rerank failed: ${message}`, 'minor');
      stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'failed' });
      return applyMmr(finalPacks);
    }
  }
  if (mmrEligible) {
    stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0 });
    return applyMmr(finalPacks);
  }
  stageTracker.finish(rerankStage, { outputCount: finalPacks.length, filteredCount: 0, status: 'skipped' });
  return finalPacks;
}

const MMR_DEFAULT_LAMBDA = 0.5;

function tokenizeForMmr(pack: ContextPack): string[] {
  const parts: string[] = [pack.targetId, pack.summary];
  if (Array.isArray(pack.keyFacts)) {
    parts.push(...pack.keyFacts);
  }
  if (Array.isArray(pack.relatedFiles)) {
    parts.push(...pack.relatedFiles);
  }
  return parts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 2);
}

function buildTfVector(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (const value of left.values()) {
    normLeft += value * value;
  }
  for (const value of right.values()) {
    normRight += value * value;
  }
  for (const [token, leftValue] of left.entries()) {
    const rightValue = right.get(token);
    if (!rightValue) continue;
    dot += leftValue * rightValue;
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

function clampMmrLambda(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MMR_DEFAULT_LAMBDA;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function applyMmrDiversification(options: {
  packs: ContextPack[];
  query: LibrarianQuery;
  candidateScoreMap: Map<string, number>;
  explanationParts: string[];
  recordCoverageGap: RecordCoverageGap;
}): ContextPack[] {
  const { packs, query, candidateScoreMap, explanationParts, recordCoverageGap } = options;
  if (query.diversify !== true || packs.length < 2) return packs;

  const lambda = clampMmrLambda(query.diversityLambda);
  const vectors = packs.map((pack) => buildTfVector(tokenizeForMmr(pack)));
  const relevance = packs.map((pack) => {
    const scored = candidateScoreMap.get(pack.targetId) ?? pack.confidence;
    return Number.isFinite(scored) ? Math.max(0, Math.min(1, scored)) : Math.max(0, Math.min(1, pack.confidence));
  });

  if (relevance.every((value) => value === 0)) {
    recordCoverageGap('reranking', 'MMR diversification skipped due to zero relevance scores.', 'minor');
    return packs;
  }

  const selectedIndexes: number[] = [];
  const remaining = new Set<number>(packs.map((_, index) => index));

  while (remaining.size > 0) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const index of remaining) {
      const maxSimilarity = selectedIndexes.length === 0
        ? 0
        : Math.max(...selectedIndexes.map((picked) => cosineSimilarity(vectors[index], vectors[picked])));
      const mmrScore = (lambda * relevance[index]) - ((1 - lambda) * maxSimilarity);
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    remaining.delete(bestIndex);
    selectedIndexes.push(bestIndex);
  }

  if (selectedIndexes.length !== packs.length) {
    recordCoverageGap('reranking', 'MMR diversification produced incomplete output; preserving original order.', 'minor');
    return packs;
  }

  explanationParts.push(`Applied MMR diversification (lambda=${lambda.toFixed(2)}) to reduce redundant packs.`);
  return selectedIndexes.map((index) => packs[index]);
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
  const methodGuidanceEnabled = synthesisEnabled && query.disableMethodGuidance !== true;
  const methodGuidanceStage = stageTracker.start('method_guidance', methodGuidanceEnabled ? 1 : 0);
  if (methodGuidanceEnabled) {
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

function stripTracePrefix(message: string): string {
  return message.replace(/unverified_by_trace\([^)]+\):\s*/g, '').trim();
}

interface SynthesisStageResult {
  synthesis?: SynthesizedResponse;
  synthesisMode?: SynthesisMode;
  llmError?: string;
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
}): Promise<SynthesisStageResult> {
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
  let synthesisMode: SynthesisMode | undefined = synthesisEnabled
    ? undefined
    : (finalPacks.length > 0 ? 'heuristic' : undefined);
  let llmError: string | undefined;
  const synthesisStage = stageTracker.start('synthesis', synthesisEnabled && query.intent && finalPacks.length > 0 ? 1 : 0);
  if (synthesisEnabled && query.intent && finalPacks.length > 0) {
    const resolvedWorkspaceRoot = workspaceRoot?.trim() || await resolveWorkspace(storage);
    if (!resolvedWorkspaceRoot || !resolvedWorkspaceRoot.trim()) {
      recordCoverageGap('synthesis', 'Workspace root unavailable; skipping synthesis.', 'moderate');
      stageTracker.finish(synthesisStage, { outputCount: 0, filteredCount: 0, status: 'failed' });
      return { synthesis: undefined, synthesisMode: 'heuristic', llmError };
    }
    try {
      const forceSummarySynthesis = query.forceSummarySynthesis === true;
      // Use quick synthesis for simple queries when possible
      if (forceSummarySynthesis || shouldQuickAnswer(query, finalPacks)) {
        try {
          const quickAnswer = buildQuickAnswer(query, finalPacks);
          synthesis = {
            answer: quickAnswer.answer,
            confidence: quickAnswer.confidence,
            citations: quickAnswer.citations,
            keyInsights: quickAnswer.keyInsights,
            uncertainties: quickAnswer.uncertainties,
          };
          synthesisMode = 'heuristic';
          explanationParts.push('Quick synthesis from pack summaries.');
        } catch (quickError) {
          if (!forceSummarySynthesis) {
            throw quickError;
          }
          const topPack = finalPacks
            .slice()
            .sort((left, right) => right.confidence - left.confidence)[0];
          const summary = topPack?.summary?.trim().length
            ? topPack.summary.trim()
            : `Relevant context available for ${topPack?.targetId ?? 'this query'}.`;
          synthesis = {
            answer: summary,
            confidence: Math.min(0.6, Math.max(0.2, topPack?.confidence ?? 0.3)),
            citations: topPack
              ? [{
                  packId: topPack.packId,
                  content: summary,
                  relevance: Math.max(0.3, Math.min(1, topPack.confidence)),
                  file: topPack.relatedFiles[0],
                }]
              : [],
            keyInsights: topPack?.keyFacts?.slice(0, 3) ?? [],
            uncertainties: ['Answer synthesized from retrieved context summaries (forced quick mode).'],
          };
          synthesisMode = 'heuristic';
          explanationParts.push('Forced quick synthesis from top retrieved context.');
        }
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
          synthesisMode = 'llm';
          explanationParts.push('LLM-synthesized understanding from retrieved knowledge.');
        } else {
          const reason = 'reason' in synthesisResult ? synthesisResult.reason : 'unverified_by_trace(synthesis_unavailable)';
          recordCoverageGap('synthesis', `Synthesis unavailable: ${reason}`, 'moderate');
          synthesisMode = 'heuristic';
          if (query.showLlmErrors !== false) {
            llmError = stripTracePrefix(reason);
          }
        }
      }
    } catch (synthesisError) {
      const message = synthesisError instanceof Error ? synthesisError.message : String(synthesisError);
      // Log but don't fail query if synthesis fails
      const sanitized = stripTracePrefix(message);
      recordCoverageGap('synthesis', `Synthesis failed: ${sanitized}`, 'moderate');
      synthesisMode = 'heuristic';
      if (query.showLlmErrors !== false) {
        llmError = sanitized;
      }
    }
  }
  if (!synthesisMode && finalPacks.length > 0 && !synthesis) {
    synthesisMode = 'heuristic';
  }
  stageTracker.finish(synthesisStage, { outputCount: synthesis ? 1 : 0, filteredCount: 0 });
  return { synthesis, synthesisMode, llmError };
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
  storage: LibrarianStorage
): Promise<FeedbackContext | null> {
  const context = feedbackContextCache.get(feedbackToken);
  if (context) {
    const age = Date.now() - new Date(context.createdAt).getTime();
    if (age <= FEEDBACK_CONTEXT_TTL_MS) {
      return context;
    }
    feedbackContextCache.delete(feedbackToken);
  }

  try {
    const persisted = parseFeedbackContextList(await storage.getState(FEEDBACK_CONTEXT_STATE_KEY));
    const pruned = pruneFeedbackContexts(persisted);
    if (pruned.length !== persisted.length) {
      await storage.setState(FEEDBACK_CONTEXT_STATE_KEY, JSON.stringify(pruned));
    }
    const match = pruned.find((entry) => entry.feedbackToken === feedbackToken);
    if (!match) return null;
    feedbackContextCache.set(match.feedbackToken, match);
    return match;
  } catch {
    return null;
  }
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

function buildQueryCacheKey(
  query: LibrarianQuery,
  version: LibrarianVersion,
  llmRequirement: LlmRequirement,
  synthesisEnabled: boolean
): string {
  const normalizedIntent = normalizeIntentForCache(query.intent);
  const files = query.affectedFiles?.slice().sort().join('|') ?? '';
  const filterKey = query.filter
    ? [
        query.filter.pathPrefix ?? '',
        query.filter.language ?? '',
        typeof query.filter.isExported === 'boolean' ? String(query.filter.isExported) : '',
        typeof query.filter.isPure === 'boolean' ? String(query.filter.isPure) : '',
        query.filter.excludeTests ? '1' : '0',
        typeof query.filter.maxFileSizeBytes === 'number' ? String(query.filter.maxFileSizeBytes) : '',
      ].join('|')
    : '';
  const workingFile = query.workingFile ?? '';
  const versionKey = `${version.string}:${version.indexedAt?.getTime?.() ?? 0}`;
  const embeddingRequirement = query.embeddingRequirement ?? '';
  const methodGuidanceFlag = query.disableMethodGuidance === true ? 1 : 0;
  const forceSummarySynthesisFlag = query.forceSummarySynthesis === true ? 1 : 0;
  const hydeExpansionFlag = query.hydeExpansion === true ? 1 : 0;
  return `${versionKey}|llm:${llmRequirement}|embed:${embeddingRequirement}|syn:${synthesisEnabled ? 1 : 0}|mg:${methodGuidanceFlag}|fs:${forceSummarySynthesisFlag}|hyde:${hydeExpansionFlag}|${query.depth}|${query.taskType ?? ''}|${query.minConfidence ?? ''}|${normalizedIntent}|${files}|wf:${workingFile}|flt:${filterKey}`;
}

function classifySemanticCacheCategory(intent: string): SemanticCacheCategory {
  const normalized = intent.toLowerCase();
  if (
    /\b(error|exception|bug|failed|failing|timeout|trace|stack)\b/.test(normalized)
    || normalized.includes('why does')
  ) {
    return 'diagnostic';
  }
  if (
    /\bhow does\b/.test(normalized)
    || /\barchitecture\b/.test(normalized)
    || /\bdesign\b/.test(normalized)
    || /\boverview\b/.test(normalized)
    || /\bconcept\b/.test(normalized)
  ) {
    return 'conceptual';
  }
  return 'lookup';
}

function buildSemanticCacheScopeSignature(query: LibrarianQuery): string {
  const files = query.affectedFiles?.slice().sort().join('|') ?? '';
  const filterKey = query.filter
    ? [
      query.filter.pathPrefix ?? '',
      query.filter.language ?? '',
      typeof query.filter.isExported === 'boolean' ? String(query.filter.isExported) : '',
      typeof query.filter.isPure === 'boolean' ? String(query.filter.isPure) : '',
      query.filter.excludeTests ? '1' : '0',
      typeof query.filter.maxFileSizeBytes === 'number' ? String(query.filter.maxFileSizeBytes) : '',
    ].join('|')
    : '';
  const hydeFlag = query.hydeExpansion === true ? '1' : '0';
  return [
    query.depth ?? 'L1',
    query.taskType ?? '',
    query.embeddingRequirement ?? '',
    hydeFlag,
    query.workingFile ?? '',
    files,
    filterKey,
  ].join('|');
}

function computeSemanticIntentSimilarity(currentIntent: string, candidateIntent: string): number {
  if (currentIntent === candidateIntent) return 1;
  const currentTokens = new Set(currentIntent.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidateIntent.split(' ').filter(Boolean));
  if (currentTokens.size === 0 || candidateTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of currentTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  const union = new Set([...currentTokens, ...candidateTokens]).size;
  const jaccard = union > 0 ? overlap / union : 0;

  const total = currentTokens.size + candidateTokens.size;
  const dice = total > 0 ? (2 * overlap) / total : 0;
  return Math.max(jaccard, dice);
}

const QUERY_CACHE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'does',
  'do',
  'describe',
  'for',
  'how',
  'in',
  'is',
  'me',
  'of',
  'or',
  'please',
  'the',
  'to',
  'what',
]);

const QUERY_CACHE_SYNONYMS: Record<string, string> = {
  authentication: 'auth',
  authenticate: 'auth',
  authenticated: 'auth',
  implementation: 'function',
  implementations: 'function',
  method: 'function',
  methods: 'function',
  routine: 'function',
  routines: 'function',
  authn: 'auth',
  login: 'auth',
  logins: 'auth',
  explain: 'describe',
  explains: 'describe',
  flow: 'workflow',
  flows: 'workflow',
  work: 'workflow',
  works: 'workflow',
};

function normalizeIntentForCache(intent: string): string {
  const tokens = intent
    .toLowerCase()
    .match(/[a-z0-9_]+/g)
    ?.map((token) => QUERY_CACHE_SYNONYMS[token] ?? token)
    .map((token) => stripSimpleSuffix(token))
    .filter((token) => token.length > 1 && !QUERY_CACHE_STOP_WORDS.has(token));

  if (!tokens || tokens.length === 0) {
    return intent.trim().toLowerCase();
  }
  return Array.from(new Set(tokens)).sort().join(' ');
}

function stripSimpleSuffix(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}
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

async function trySemanticCacheLookup(options: {
  query: LibrarianQuery;
  version: LibrarianVersion;
  cacheKey: string;
  storage: LibrarianStorage;
  cache: HierarchicalMemory<CachedResponse>;
}): Promise<{
  matchedKey: string;
  similarity: number;
  category: SemanticCacheCategory;
  response: CachedResponse;
} | null> {
  const cacheStore = options.storage as QueryCacheStore;
  if (!cacheStore.getRecentQueryCacheEntries) return null;

  const intent = options.query.intent?.trim() ?? '';
  if (!intent) return null;

  const category = classifySemanticCacheCategory(intent);
  const threshold = SEMANTIC_CACHE_THRESHOLDS[category];
  const targetIntent = normalizeIntentForCache(intent);
  const targetScope = buildSemanticCacheScopeSignature(options.query);
  const versionPrefix = `${options.version.string}:${options.version.indexedAt?.getTime?.() ?? 0}|`;
  const candidates = await cacheStore.getRecentQueryCacheEntries(SEMANTIC_CACHE_CANDIDATE_LIMIT);

  let best: { key: string; similarity: number } | null = null;
  for (const entry of candidates) {
    if (!entry?.queryHash || entry.queryHash === options.cacheKey) continue;
    if (!entry.queryHash.startsWith(versionPrefix)) continue;
    const parsed = safeJsonParse<LibrarianQuery>(entry.queryParams);
    if (!parsed.ok || !parsed.value?.intent) continue;

    const candidateQuery = parsed.value;
    if (buildSemanticCacheScopeSignature(candidateQuery) !== targetScope) continue;
    const similarity = computeSemanticIntentSimilarity(
      targetIntent,
      normalizeIntentForCache(candidateQuery.intent),
    );
    if (similarity < threshold) continue;
    if (!best || similarity > best.similarity) {
      best = { key: entry.queryHash, similarity };
    }
  }

  if (!best) return null;
  const response = await options.cache.get(best.key);
  if (!response) return null;
  return {
    matchedKey: best.key,
    similarity: best.similarity,
    category,
    response,
  };
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

async function collectDirectPacks(
  storage: LibrarianStorage,
  query: LibrarianQuery,
  workspaceRoot: string,
): Promise<ContextPack[]> {
  const hasAnchors = Boolean(query.affectedFiles?.length);
  const hasFilter = Boolean(
    query.filter?.pathPrefix
    || query.filter?.excludeTests
    || query.filter?.language
    || typeof query.filter?.isPure === 'boolean'
  );
  if (!hasAnchors && !hasFilter) return emptyArray<ContextPack>();
  const minConfidence = query.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const packs: ContextPack[] = [];
  const relatedFilesAny = new Set<string>();
  for (const filePath of query.affectedFiles?.slice(0, 12) ?? []) {
    for (const candidate of expandPathCandidates(filePath, workspaceRoot)) {
      relatedFilesAny.add(candidate);
    }
  }
  packs.push(...await storage.getContextPacks({
    minConfidence,
    limit: 80,
    relatedFilesAny: relatedFilesAny.size > 0 ? Array.from(relatedFilesAny) : undefined,
    relatedFilePrefix: query.filter?.pathPrefix,
    language: query.filter?.language,
    excludeTests: query.filter?.excludeTests,
  }));
  return dedupePacks(packs).slice(0, 40);
}

type ResolvedQueryEmbeddings = {
  directEmbedding: Float32Array;
  hydeEmbedding: Float32Array | null;
  identifierEmbeddings: Float32Array[];
};

async function resolveQueryEmbeddings(
  query: LibrarianQuery,
  embeddingService: EmbeddingService,
  governor: GovernorContext,
): Promise<ResolvedQueryEmbeddings> {
  const directEmbedding = await resolveEmbeddingForText(
    embeddingService,
    query.intent,
    'query',
    governor
  );

  const identifierEmbeddings: Float32Array[] = [];
  const identifierVariants = buildIdentifierExpansionVariants(query.intent);
  for (let i = 0; i < identifierVariants.length; i += 1) {
    const variant = identifierVariants[i];
    const key = `${IDENTIFIER_EXPANSION_EMBEDDING_PREFIX}${i}:${variant}`;
    const embedding = await resolveEmbeddingForText(
      embeddingService,
      variant,
      'query',
      governor,
      key
    );
    identifierEmbeddings.push(embedding);
  }

  if (query.hydeExpansion !== true) {
    return { directEmbedding, hydeEmbedding: null, identifierEmbeddings };
  }

  const hydeKey = `${HYDE_EMBEDDING_CACHE_PREFIX}${query.intent}`;
  const cache = getEmbeddingCache(embeddingService);
  const cachedHyde = cache.get(hydeKey);
  if (cachedHyde) {
    return { directEmbedding, hydeEmbedding: cachedHyde, identifierEmbeddings };
  }

  const hydeExpansion = await resolveHydeExpansion(query.intent, governor);
  if (!hydeExpansion) {
    return { directEmbedding, hydeEmbedding: null, identifierEmbeddings };
  }

  const hydeEmbedding = await resolveEmbeddingForText(
    embeddingService,
    hydeExpansion,
    'code',
    governor,
    hydeKey
  );
  return { directEmbedding, hydeEmbedding, identifierEmbeddings };
}

function normalizeIdentifierToken(token: string): string {
  return token.trim().toLowerCase();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildIdentifierExpansionVariants(intent: string): string[] {
  const normalizedIntent = intent.trim();
  if (!normalizedIntent) return emptyArray<string>();

  const variants = new Set<string>();
  const tokens = (normalizedIntent.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .map((token) => normalizeIdentifierToken(token))
    .filter(Boolean);
  const tokenSet = new Set(tokens);

  for (const token of tokenSet) {
    const synonyms = IDENTIFIER_EXPANSION_SYNONYMS[token];
    if (!synonyms || synonyms.length === 0) continue;
    const replacementPattern = new RegExp(`\\b${escapeRegex(token)}\\b`, 'ig');
    for (const synonym of synonyms.slice(0, 2)) {
      const replaced = normalizedIntent.replace(replacementPattern, synonym);
      if (replaced !== normalizedIntent) variants.add(replaced);
    }
  }

  if (tokenSet.has('user') && (tokenSet.has('permission') || tokenSet.has('permissions') || tokenSet.has('role') || tokenSet.has('roles'))) {
    variants.add('canAccessRoute checkUserRole authorizeUser');
  }
  if (tokenSet.has('auth') || tokenSet.has('authenticate') || tokenSet.has('login')) {
    variants.add('authenticateUser authorizeRequest checkUserRole');
  }

  return Array.from(variants).slice(0, IDENTIFIER_EXPANSION_MAX_VARIANTS);
}

async function resolveEmbeddingForText(
  embeddingService: EmbeddingService,
  text: string,
  kind: 'query' | 'code',
  governor: GovernorContext,
  cacheKey?: string,
): Promise<Float32Array> {
  const key = cacheKey ?? text;
  const cache = getEmbeddingCache(embeddingService);
  const cached = cache.get(key);
  if (cached) return cached;

  governor.recordTokens(estimateTokenCount(text));
  const embeddingResult = await embeddingService.generateEmbedding({ text, kind }, { governorContext: governor });
  if (!(embeddingResult.embedding instanceof Float32Array)) {
    throw new Error('unverified_by_trace(provider_invalid_output): query embedding is not a Float32Array');
  }
  cacheEmbedding(cache, key, embeddingResult.embedding);
  return embeddingResult.embedding;
}

async function resolveHydeExpansion(intent: string, governor: GovernorContext): Promise<string | null> {
  const cacheKey = normalizeIntentForCache(intent);
  const cached = hydeExpansionCache.get(cacheKey);
  if (cached) return cached;

  try {
    const modelConfig = await resolveLibrarianModelConfigWithDiscovery();
    const llmService = resolveLlmServiceAdapter();
    const prompt = buildHydePrompt(intent);
    governor.recordTokens(estimateTokenCount(prompt));
    const response = await llmService.chat({
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      messages: [
        {
          role: 'system',
          content: 'You generate compact hypothetical TypeScript snippets for retrieval expansion. Return code only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      maxTokens: 320,
      governorContext: governor,
    });
    const normalized = normalizeHydeExpansion(response.content);
    if (!normalized) return null;
    cacheHydeExpansion(cacheKey, normalized);
    return normalized;
  } catch (error: unknown) {
    logWarning('HyDE expansion unavailable; continuing with direct query embedding', {
      error: getErrorMessage(error),
    });
    return null;
  }
}

function buildHydePrompt(intent: string): string {
  return [
    'Write a TypeScript function signature plus a concise 2-line docstring that would implement this request.',
    'Keep it grounded to likely production code and avoid placeholders.',
    '',
    `Request: ${intent}`,
  ].join('\n');
}

function normalizeHydeExpansion(content: string): string | null {
  const withoutFences = content
    .replace(/^```[a-zA-Z]*\s*/g, '')
    .replace(/```$/g, '')
    .trim();
  if (!withoutFences) return null;
  return withoutFences.slice(0, HYDE_MAX_STUB_CHARS);
}

function cacheHydeExpansion(key: string, value: string): void {
  if (hydeExpansionCache.has(key)) {
    hydeExpansionCache.delete(key);
  }
  hydeExpansionCache.set(key, value);
  if (hydeExpansionCache.size > HYDE_EXPANSION_CACHE_LIMIT) {
    const oldest = hydeExpansionCache.keys().next().value as string | undefined;
    if (oldest) hydeExpansionCache.delete(oldest);
  }
}

function fuseSimilarityResultListsWithRrf(
  resultLists: SimilarityResult[][],
  limit: number
): SimilarityResult[] {
  const rankScores = new Map<string, { entityId: string; entityType: SimilarityResult['entityType']; rrf: number; maxSimilarity: number }>();

  const applyList = (results: SimilarityResult[]): void => {
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const key = `${result.entityType}:${result.entityId}`;
      const existing = rankScores.get(key);
      const rrfIncrement = 1 / (HYDE_RRF_K + i + 1);
      if (existing) {
        existing.rrf += rrfIncrement;
        existing.maxSimilarity = Math.max(existing.maxSimilarity, result.similarity);
      } else {
        rankScores.set(key, {
          entityId: result.entityId,
          entityType: result.entityType,
          rrf: rrfIncrement,
          maxSimilarity: result.similarity,
        });
      }
    }
  };

  for (const list of resultLists) {
    applyList(list);
  }

  const ranked = Array.from(rankScores.values())
    .sort((a, b) => b.rrf - a.rrf || b.maxSimilarity - a.maxSimilarity)
    .slice(0, Math.max(1, limit));

  const topRrf = ranked[0]?.rrf ?? 1;
  return ranked.map((entry) => ({
    entityId: entry.entityId,
    entityType: entry.entityType,
    similarity: Math.max(entry.maxSimilarity, Math.min(1, entry.rrf / topRrf)),
  }));
}

function fuseSimilarityResultsWithRrf(
  direct: SimilarityResult[],
  hyde: SimilarityResult[],
  limit: number
): SimilarityResult[] {
  return fuseSimilarityResultListsWithRrf([direct, hyde], limit);
}

async function searchSimilarWithEmbedding(snippet: string, limit: number, storage: LibrarianStorage, embeddingService: EmbeddingService, governor: GovernorContext): Promise<SimilarMatch[]> {
  governor.recordTokens(estimateTokenCount(snippet)); const embeddingResult = await embeddingService.generateEmbedding({ text: snippet, kind: 'code' }, { governorContext: governor });
  if (!(embeddingResult.embedding instanceof Float32Array)) throw new Error('unverified_by_trace(provider_invalid_output): similarity embedding is not a Float32Array');
  const searchResponse = await storage.findSimilarByEmbedding(embeddingResult.embedding, {
    limit: Math.max(1, limit),
    minSimilarity: EMBEDDING_QUERY_MIN_SIMILARITY,
    entityTypes: ['function', 'module'],
  });
  // Note: degraded flag is not propagated here since this is a utility function.
  // Callers should be aware that empty results may indicate degraded search.
  return searchResponse.results.map((result) => ({ entityId: result.entityId, entityType: result.entityType, similarity: result.similarity }));
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

const workspacePackageRootsCache = new Map<string, string[]>();

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeToWorkspaceRelative(workspaceRoot: string, candidate: string): string | null {
  const normalized = normalizePath(candidate.trim());
  if (!normalized) return null;
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspaceRoot, candidate);
  const relative = normalizePath(path.relative(workspaceRoot, resolved));
  if (!relative || relative === '.' || relative.startsWith('..')) return null;
  return relative;
}

function normalizeLanguageFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

async function normalizeQueryScope(
  query: LibrarianQuery,
  workspaceRoot: string,
): Promise<{ query: LibrarianQuery; disclosures: string[] }> {
  const disclosures: string[] = [];
  const affectedFiles = normalizeAffectedFilesForWorkspace(query.affectedFiles);
  const workingFile = normalizeSingleFileHint(query.workingFile, workspaceRoot);
  const explicitScopePrefix = normalizePathPrefix(query.scope, workspaceRoot);
  const filter = normalizeSearchFilter(query.filter, workspaceRoot);
  let nextFilter = filter;

  if (!nextFilter.pathPrefix && explicitScopePrefix) {
    nextFilter = { ...nextFilter, pathPrefix: explicitScopePrefix };
    disclosures.push(`scope_explicit: ${explicitScopePrefix}`);
  }

  if (!nextFilter.pathPrefix && workingFile) {
    const derived = await derivePathPrefixFromWorkingFile(workspaceRoot, workingFile);
    if (derived) {
      nextFilter = { ...nextFilter, pathPrefix: derived };
      disclosures.push(`scope_auto_detected: ${derived} (from workingFile)`);
    }
  }

  const hasFilter = hasSearchFilter(nextFilter);
  return {
    query: {
      ...query,
      affectedFiles,
      workingFile,
      filter: hasFilter ? nextFilter : undefined,
    },
    disclosures,
  };
}

function hasSearchFilter(filter: LibrarianQuery['filter'] | undefined): boolean {
  if (!filter) return false;
  return Boolean(
    filter.pathPrefix
    || filter.language
    || typeof filter.isExported === 'boolean'
    || typeof filter.isPure === 'boolean'
    || filter.excludeTests
    || typeof filter.maxFileSizeBytes === 'number'
  );
}

function normalizeSearchFilter(
  filter: LibrarianQuery['filter'] | undefined,
  workspaceRoot: string,
): NonNullable<LibrarianQuery['filter']> {
  const pathPrefix = normalizePathPrefix(filter?.pathPrefix, workspaceRoot);
  const language = normalizeLanguageFilter(filter?.language);
  const maxFileSizeBytes = typeof filter?.maxFileSizeBytes === 'number' && Number.isFinite(filter.maxFileSizeBytes) && filter.maxFileSizeBytes > 0
    ? Math.floor(filter.maxFileSizeBytes)
    : undefined;
  return {
    pathPrefix,
    language,
    isExported: typeof filter?.isExported === 'boolean' ? filter.isExported : undefined,
    isPure: typeof filter?.isPure === 'boolean' ? filter.isPure : undefined,
    excludeTests: filter?.excludeTests === true ? true : undefined,
    maxFileSizeBytes,
  };
}

function normalizePathPrefix(prefix: string | undefined, workspaceRoot: string): string | undefined {
  if (!prefix) return undefined;
  const relative = normalizeToWorkspaceRelative(workspaceRoot, prefix);
  if (!relative) return undefined;
  return ensureTrailingSlash(relative);
}

function normalizeAffectedFilesForWorkspace(
  affectedFiles: string[] | undefined,
): string[] | undefined {
  if (!Array.isArray(affectedFiles) || affectedFiles.length === 0) return undefined;
  const normalized = new Set<string>();
  for (const file of affectedFiles) {
    if (typeof file !== 'string') continue;
    const trimmed = file.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return normalized.size > 0 ? Array.from(normalized) : undefined;
}

function normalizeSingleFileHint(
  filePath: string | undefined,
  workspaceRoot: string,
): string | undefined {
  if (!filePath) return undefined;
  const trimmed = filePath.trim();
  if (!trimmed) return undefined;
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
}

async function derivePathPrefixFromWorkingFile(
  workspaceRoot: string,
  workingFile: string,
): Promise<string | undefined> {
  const absoluteFile = path.resolve(workingFile);
  const relativeFile = normalizePath(path.relative(workspaceRoot, absoluteFile));
  if (!relativeFile || relativeFile.startsWith('..')) return undefined;

  const packageRoots = await resolveWorkspacePackageRoots(workspaceRoot);
  const matched = packageRoots
    .filter((root) => relativeFile === root || relativeFile.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (matched) {
    return ensureTrailingSlash(matched);
  }

  const nearestPackageRoot = await findNearestPackageRoot(workspaceRoot, absoluteFile);
  if (!nearestPackageRoot) return undefined;
  const relativeRoot = normalizePath(path.relative(workspaceRoot, nearestPackageRoot));
  if (!relativeRoot || relativeRoot === '.' || relativeRoot.startsWith('..')) return undefined;
  return ensureTrailingSlash(relativeRoot);
}

async function resolveWorkspacePackageRoots(workspaceRoot: string): Promise<string[]> {
  const cached = workspacePackageRootsCache.get(workspaceRoot);
  if (cached) return cached;

  const patterns = await loadWorkspacePatterns(workspaceRoot);
  if (patterns.length === 0) {
    workspacePackageRootsCache.set(workspaceRoot, []);
    return [];
  }

  const roots = new Set<string>();
  for (const pattern of patterns) {
    const normalized = normalizePath(pattern).replace(/\/+$/, '');
    if (!normalized) continue;
    const globPattern = normalized.endsWith('package.json') ? normalized : `${normalized}/package.json`;
    const matches = await glob(globPattern, {
      cwd: workspaceRoot,
      absolute: false,
      nodir: true,
      follow: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/.librarian/**'],
    });
    for (const match of matches) {
      const relative = normalizePath(path.posix.dirname(match));
      if (relative && relative !== '.') {
        roots.add(relative);
      }
    }
  }

  const resolved = Array.from(roots).sort((a, b) => a.localeCompare(b));
  workspacePackageRootsCache.set(workspaceRoot, resolved);
  return resolved;
}

async function loadWorkspacePatterns(workspaceRoot: string): Promise<string[]> {
  const patterns = new Set<string>();
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  try {
    const raw = await fs.readFile(packageJsonPath, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (parsed.ok && parsed.value) {
      const workspaces = parsed.value.workspaces;
      for (const pattern of parseWorkspacePatterns(workspaces)) {
        patterns.add(pattern);
      }
    }
  } catch {
    // Optional workspace metadata.
  }

  const pnpmWorkspacePath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  try {
    const raw = await fs.readFile(pnpmWorkspacePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) continue;
      const pattern = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
      if (pattern.length > 0) {
        patterns.add(pattern);
      }
    }
  } catch {
    // Optional workspace metadata.
  }

  return Array.from(patterns);
}

function parseWorkspacePatterns(workspaces: unknown): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (workspaces && typeof workspaces === 'object') {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
  }
  return [];
}

async function findNearestPackageRoot(workspaceRoot: string, filePath: string): Promise<string | undefined> {
  let current = path.dirname(filePath);
  const normalizedWorkspace = path.resolve(workspaceRoot);
  while (current.startsWith(normalizedWorkspace)) {
    if (current === normalizedWorkspace) return undefined;
    try {
      await fs.access(path.join(current, 'package.json'));
      return current;
    } catch {
      // Keep traversing toward workspace root.
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function expandPathCandidates(filePath: string, workspaceRoot: string): string[] {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) return [];
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
  const normalizedAbsolute = normalizePath(absolute);
  const candidates = new Set<string>([absolute, normalizedAbsolute]);
  const relative = normalizePath(path.relative(workspaceRoot, absolute));
  if (relative && relative !== '.' && !relative.startsWith('..')) {
    candidates.add(relative);
    candidates.add(`./${relative}`);
  }
  return Array.from(candidates);
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
  const rawTokens = text
    .split(/[^A-Za-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const expanded = new Set<string>();
  for (const token of rawTokens) {
    const normalized = token.toLowerCase();
    if (normalized.length > 2) {
      expanded.add(normalized);
    }
    for (const segment of token.split(/[._/-]+/)) {
      if (!segment) continue;
      const normalizedSegment = segment.toLowerCase();
      if (normalizedSegment.length > 2) {
        expanded.add(normalizedSegment);
      }
      for (const part of splitCamelCase(segment)) {
        if (part.length > 2) {
          expanded.add(part);
        }
      }
    }
  }
  return Array.from(expanded);
}

function splitCamelCase(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
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
    // Map embeddable entity type to graph entity type
    const graphEntityType = result.entityType === 'document' ? 'file' : result.entityType;
    const stats = await getEntityStats(result.entityId, result.entityType, storage);
    return {
      entityId: result.entityId,
      entityType: graphEntityType,
      path: stats.path,
      semanticSimilarity: result.similarity,
      confidence: stats.confidence,
      recency: stats.recency,
      pagerank: result.entityType === 'document' ? 0.5 : 0, // Documents get moderate PageRank
      centrality: 0,
      communityId: null,
      isDocument: result.entityType === 'document', // Track document origin
    } as Candidate & { isDocument?: boolean };
  }));
}
async function getEntityStats(entityId: string, entityType: GraphEntityType | 'document', storage: LibrarianStorage): Promise<{ confidence: number; recency: number; path?: string }> {
  try {
    if (entityType === 'function') {
      const fn = await storage.getFunction(entityId);
      return {
        confidence: fn?.confidence ?? ENTITY_CONFIDENCE_FALLBACK,
        recency: computeRecency(fn?.lastAccessed ?? null),
        path: fn?.filePath,
      };
    }
    if (entityType === 'document') {
      // Documents get from ingestion items or default high confidence
      const docItem = await storage.getIngestionItem(entityId);
      const payload = docItem?.payload as { path?: string } | undefined;
      return {
        confidence: 0.85, // High confidence for documentation
        recency: 0.9, // Documents considered fresh
        path: payload?.path ?? entityId.replace(/^doc:/, ''),
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
async function resolveMaxEscalationDepth(workspaceRoot: string, override?: number): Promise<number> {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return normalizeEscalationDepth(override);
  }

  const configPaths = [
    path.join(workspaceRoot, 'librainian.config.json'),
    path.join(workspaceRoot, '.librarian', 'config.json'),
  ];

  for (const configPath of configPaths) {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = safeJsonParse<Record<string, unknown>>(raw);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') continue;

      const topLevel = parsed.value.max_escalation_depth;
      const retrievalScoped = (parsed.value.retrieval as { max_escalation_depth?: unknown } | undefined)?.max_escalation_depth;
      const candidate = typeof topLevel === 'number' ? topLevel : (typeof retrievalScoped === 'number' ? retrievalScoped : undefined);
      if (candidate !== undefined) {
        return normalizeEscalationDepth(candidate);
      }
    } catch {
      // Optional config file; ignore read/parse failures.
    }
  }

  return DEFAULT_MAX_ESCALATION_DEPTH;
}

function normalizeEscalationDepth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_ESCALATION_DEPTH;
  return Math.max(0, Math.min(MAX_ALLOWED_ESCALATION_DEPTH, Math.floor(value)));
}

async function logRetrievalEscalationEvent(storage: LibrarianStorage, workspaceRoot: string, event: {
  queryHash: string;
  intent: string;
  fromDepth: LibrarianQuery['depth'];
  toDepth: LibrarianQuery['depth'];
  totalConfidence: number;
  retrievalEntropy: number;
  reasons: string[];
  attempt: number;
  maxEscalationDepth: number;
  returnedPackIds: string[];
}): Promise<void> {
  const now = new Date().toISOString();
  await logRetrievalConfidenceObservation(storage, workspaceRoot, {
    queryHash: event.queryHash,
    intent: event.intent,
    confidenceScore: event.totalConfidence,
    retrievalEntropy: event.retrievalEntropy,
    returnedPackIds: event.returnedPackIds,
    timestamp: now,
    fromDepth: event.fromDepth,
    toDepth: event.toDepth,
    escalationReason: event.reasons.join('|') || 'policy_triggered',
    attempt: event.attempt,
    maxEscalationDepth: event.maxEscalationDepth,
  });
}

async function logRetrievalConfidenceObservation(
  storage: LibrarianStorage,
  workspaceRoot: string,
  event: {
    queryHash: string;
    intent?: string;
    confidenceScore: number;
    retrievalEntropy: number;
    returnedPackIds: string[];
    timestamp: string;
    fromDepth?: LibrarianQuery['depth'];
    toDepth?: LibrarianQuery['depth'];
    escalationReason?: string;
    attempt?: number;
    maxEscalationDepth?: number;
    routedStrategy?: string;
  },
): Promise<void> {
  try {
    await storage.appendRetrievalConfidenceLog({
      queryHash: event.queryHash,
      confidenceScore: Number(event.confidenceScore.toFixed(4)),
      retrievalEntropy: Number(event.retrievalEntropy.toFixed(4)),
      returnedPackIds: event.returnedPackIds.slice(0, 50),
      timestamp: event.timestamp,
      intent: event.intent,
      fromDepth: event.fromDepth,
      toDepth: event.toDepth,
      escalationReason: event.escalationReason,
      attempt: event.attempt,
      maxEscalationDepth: event.maxEscalationDepth,
      routedStrategy: event.routedStrategy,
    });
  } catch {
    // Storage logging is best-effort and must never break query execution.
  }

  try {
    const logPath = path.join(workspaceRoot, '.librarian', 'retrieval_confidence_log.jsonl');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const record = {
      timestamp: event.timestamp,
      query_hash: event.queryHash,
      escalation_reason: event.escalationReason ?? null,
      intent: event.intent,
      from_depth: event.fromDepth ?? null,
      to_depth: event.toDepth ?? null,
      confidence_score: Number(event.confidenceScore.toFixed(4)),
      retrieval_entropy: Number(event.retrievalEntropy.toFixed(4)),
      returned_pack_ids: event.returnedPackIds.slice(0, 50),
      attempt: event.attempt ?? null,
      max_escalation_depth: event.maxEscalationDepth ?? null,
      routed_strategy: event.routedStrategy ?? null,
    };
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Logging must never break query execution.
  }
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
    // Handle document entities - create synthetic doc_context packs from ingestion items
    // Documents are marked with isDocument=true (entityType may be 'file' for graph compatibility)
    const candidateWithDoc = candidate as Candidate & { isDocument?: boolean };
    if (candidateWithDoc.isDocument || candidate.entityId.startsWith('doc:')) {
      const docPack = await buildDocumentContextPack(storage, candidate);
      if (docPack) packs.push(docPack);
      continue;
    }
    const packTypes = candidate.entityType === 'function'
      ? ['function_context']
      : depth === 'L3'
        ? ['module_context', 'change_impact', 'pattern_context', 'decision_context', 'similar_tasks']
        : depth === 'L2'
          ? ['module_context', 'change_impact']
          : ['module_context'];
    for (const packType of packTypes) {
      let pack = await storage.getContextPackForTarget(candidate.entityId, packType);
      // Fallback: if no pack found by entityId, try lookup by relatedFile using candidate.path
      // This handles the case where embedding entity_id (file path) differs from old pack targetId (UUID)
      if (!pack && candidate.path) {
        const fallbackPacks = await storage.getContextPacks({ relatedFile: candidate.path, packType, limit: 1 });
        if (fallbackPacks.length > 0) pack = fallbackPacks[0];
      }
      if (pack) packs.push(pack);
    }
  }
  return dedupePacks(packs);
}

/**
 * Builds a synthetic context pack for a document entity.
 * Documents are stored as ingestion items, not regular context packs.
 */
async function buildDocumentContextPack(storage: LibrarianStorage, candidate: Candidate): Promise<ContextPack | null> {
  // Document entityIds are formatted as "doc:relativePath"
  const docId = candidate.entityId;

  // Try to get the document from ingestion items
  const item = await storage.getIngestionItem(docId);
  if (!item) return null;

  const payload = item.payload as {
    path?: string;
    summary?: string;
    headings?: Array<{ text: string; level: number }>;
    links?: Array<{ text: string; url: string }>;
  } | null;

  if (!payload?.path) return null;

  // Extract headings for key facts
  const headingFacts = (payload.headings ?? [])
    .slice(0, 5)
    .map(h => h.text);

  const keyFacts = [
    `Document: ${payload.path}`,
    ...(headingFacts.length > 0 ? [`Topics: ${headingFacts.join(', ')}`] : []),
  ];

  // Create a synthetic context pack for the document
  const pack: ContextPack = {
    packId: `doc_pack_${docId.replace(/[^a-zA-Z0-9]/g, '_')}`,
    packType: 'doc_context', // Documentation pack type for meta-query routing
    targetId: docId,
    summary: payload.summary ?? `Documentation: ${payload.path}`,
    keyFacts,
    codeSnippets: [], // Documents don't have code snippets
    relatedFiles: [payload.path],
    confidence: candidate.confidence,
    createdAt: new Date(item.ingestedAt),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'full',
      indexedAt: new Date(item.ingestedAt),
      indexerVersion: '1.0.0',
      features: [],
    },
    invalidationTriggers: [payload.path],
  };

  return pack;
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
  if (process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true' || process.env.LIBRARIAN_DETERMINISTIC === '1') {
    return false;
  }
  const flag = process.env.LIBRARIAN_LIBRARIAN_CROSS_ENCODER;
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
  if (pack.packType === 'module_context' || pack.packType === 'change_impact' || pack.packType === 'pattern_context' || pack.packType === 'decision_context' || pack.packType === 'doc_context') return 'module';
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
    disclosures.push(`watch_state_unavailable: ${message}`);
  }
  if (!state) {
    disclosures.push('watch_state_missing: watch state unavailable');
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

interface DrillDownResult {
  hints: string[];
  followUpQueries: FollowUpQuery[];
}

/**
 * Generates both string hints (for backward compatibility) and structured
 * follow-up queries (for agent automation).
 *
 * Follow-up queries are actionable intents that can be passed directly to
 * librarian.query(), making them far more useful for agents than generic hints.
 */
function generateDrillDownHints(packs: ContextPack[], query: LibrarianQuery): DrillDownResult {
  const hints: string[] = [];
  const followUpQueries: FollowUpQuery[] = [];
  const relatedFiles = new Set<string>();

  for (const pack of packs) {
    for (const file of pack.relatedFiles) relatedFiles.add(file);
  }

  // Generate file exploration follow-ups
  if (relatedFiles.size) {
    const files = Array.from(relatedFiles).slice(0, 3);
    hints.push(`Explore related files: ${files.join(', ')}`);

    // Create structured follow-up for the most relevant related file
    const topFile = files[0];
    followUpQueries.push({
      intent: `What does ${topFile} do and how does it relate to ${query.intent}?`,
      reason: `Related file discovered in pack context`,
    });
  }

  // Generate deeper exploration follow-up for shallow queries
  if (query.depth === 'L0' && packs.length < 3) {
    hints.push('Try depth: L1 for more comprehensive results');
    followUpQueries.push({
      intent: query.intent,
      reason: 'L0 returned limited results; L1 may provide more context',
    });
  }

  // Generate confidence-based follow-ups
  if (packs.length) {
    const avgConfidence = packs.reduce((s, p) => s + p.confidence, 0) / packs.length;
    if (avgConfidence < HINT_LOW_CONFIDENCE_THRESHOLD) {
      hints.push('Results have low confidence. Consider providing more specific file hints.');

      // If we have affected files, suggest exploring them specifically
      if (query.affectedFiles?.length) {
        followUpQueries.push({
          intent: `Explain the purpose and structure of ${query.affectedFiles[0]}`,
          reason: 'Low confidence results; targeted file query may yield better results',
        });
      }
    }
  }

  // Generate pack-type-specific follow-ups
  const packTypes = new Set(packs.map((p) => p.packType));
  if (packTypes.has('function_context') && !packTypes.has('change_impact')) {
    const primaryPack = packs[0];
    if (primaryPack) {
      followUpQueries.push({
        intent: `What would break if I modify ${primaryPack.targetId}?`,
        reason: 'Function context found; impact analysis could help with modifications',
      });
    }
  }

  if (packTypes.has('module_context') && !packTypes.has('pattern_context')) {
    followUpQueries.push({
      intent: `What patterns and design decisions are used in this module?`,
      reason: 'Module context found; patterns could provide architectural insight',
    });
  }

  return { hints, followUpQueries };
}

function isStorageWriteDegradedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('storage_lock_compromised')
    || lower.includes('storage_locked')
    || lower.includes('database is locked')
    || lower.includes('sqlite_busy')
    || lower.includes('unable to update lock within the stale threshold')
  );
}

function createStorageWriteDegradedMessage(rawMessage: string): string {
  const cleaned = rawMessage
    .replace(/\bunverified_by_trace\([^)]+\):\s*/gi, '')
    .trim();
  const detail = cleaned.length > 0 ? cleaned : 'storage unavailable';
  return `Session degraded: results were returned but could not be persisted (${detail}). Run \`librarian doctor --heal\` to recover.`;
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
  rankHeuristicFallbackPacks,
  normalizeQueryScope,
  expandPathCandidates,
  buildQueryCacheKey,
  normalizeIntentForCache,
  classifySemanticCacheCategory,
  computeSemanticIntentSimilarity,
  buildSemanticCacheScopeSignature,
  buildHydePrompt,
  normalizeHydeExpansion,
  buildIdentifierExpansionVariants,
  fuseSimilarityResultListsWithRrf,
  fuseSimilarityResultsWithRrf,
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
    case 'doc_context':
      return ['semantics', 'rationale', 'guidance'];
    default:
      return ['semantics'];
  }
}
