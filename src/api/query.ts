// Query API for Librarian.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { glob } from 'glob';
import type {
  LibrarianStorage,
  SimilarityResult,
  QueryCacheEntry,
  StorageCapabilities,
  EmbeddableEntityType,
  QueryAccessLogEntry,
} from '../storage/types.js';
import type {
  LibrarianQuery,
  LibrarianResponse,
  ContextPack,
  ContextPackType,
  LibrarianVersion,
  LlmRequirement,
  EmbeddingRequirement,
  StageName,
  StageReport,
  StageIssue,
  StageIssueSeverity,
  StageTelemetry,
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
import type { AdrRecord } from '../ingest/adr_indexer.js';
import { LIBRARIAN_VERSION } from '../index.js';
import type { GraphEntityType } from '../graphs/metrics.js';
import { EmbeddingService } from './embeddings.js';
import { isModelLoaded, preloadEmbeddingModel } from './embedding_providers/real_embeddings.js';
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
import { getLanguageFromPath } from '../utils/language.js';
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
import type { HierarchicalMemory } from '../cache/tiered_cache.js';
import { resolveMethodGuidance } from '../methods/method_guidance.js';
import { globalEventBus, createQueryCompleteEvent, createQueryReceivedEvent, createQueryStartEvent, createQueryResultEvent, createQueryErrorEvent } from '../events.js';
import { isEvalCorpusPath } from '../query/scoring.js';
import {
  applyAdequacyToSynthesis,
  applyHeuristicSynthesisGuardrail,
  isAnchoredImplementationPlanningIntent,
  resolveProviderCallTimeoutMs,
  resolveStageTimeoutMs,
  runSynthesisStage,
  shouldSkipSemanticRetrievalForAnchoredPlanning,
  shouldUseAnchoredPlanningDirectMode,
  stripTracePrefix,
  withStageTimeout,
} from './query_pipeline_synthesis_stage.js';
import { runDefeaterStage } from './query_pipeline_defeater_stage.js';
import { runMethodGuidanceStage } from './query_pipeline_method_guidance_stage.js';
import { runRerankStage } from './query_pipeline_reranking_stage.js';
import type { AdequacyReport } from './difficulty_detectors.js';
import {
  runAdequacyScanStage,
  runDirectPacksStage,
} from './query_pipeline_early_stages.js';
import { runCandidatePackStage } from './query_pipeline_candidate_pack_stage.js';
import {
  getEntityStats,
  runGraphExpansionStage,
} from './query_pipeline_graph_expansion_stage.js';
import { runSemanticRetrievalStage } from './query_pipeline_semantic_retrieval_stage.js';
import { runScoringStage } from './query_pipeline_scoring_stage.js';
import {
  appendConstructionPlanEvidence,
  appendQueryEvidence,
  appendStageEvidence,
} from './query_pipeline_evidence_reporting.js';
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
import { analyzeResultCoherence, applyCoherenceAdjustment } from '../epistemics/result_coherence.js';
import { getFileCategory, isExcluded } from '../universal_patterns.js';
import { collectCorrelationConflictDisclosures } from '../epistemics/event_ledger_bridge.js';
import { getCurrentGitSha, getGitStatusChanges, isGitRepo } from '../utils/git.js';
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
  type ResolvedDependency,
  type StructuralQueryIntent,
} from './dependency_query.js';
import {
  detectCallFlowQuery,
  traceCallFlow,
  formatCallFlowResult,
  toCallChain,
  type CallFlowResult,
} from './call_flow.js';
import { detectSymbolQuery } from '../constructions/symbol_table.js';
import { runSymbolLookupStage } from './symbol_lookup.js';
import { runComparisonLookupStage, type ComparisonLookupStageResult } from './comparison_lookup.js';
import { runGitQueryStage, type GitQueryStageResult } from './git_query.js';
import { buildQueryResultContract, normalizeQueryIntentType } from './query_contracts.js';
import { buildQueryIntelSections } from './query_intel.js';
import {
  buildCoverageAssessment,
  buildStageCostSummary,
  createStageTracker,
  normalizeStageObserver,
  type CoverageAssessmentWeights,
  type StageTracker,
} from './query_stage_reporting.js';
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
  selectAndRecordRetrievalStrategy,
  selectRetrievalStrategyForIntent,
  type RetrievalStrategyArm,
} from './retrieval_strategy_bandit.js';
import {
  logRetrievalConfidenceObservation,
  logRetrievalEscalationEvent,
  resolveMaxEscalationDepth,
  resolveWorkspaceRoot,
} from './query_retrieval_observability.js';
import {
  extractBugContext,
  extractCodeReviewFilePath,
  extractFeatureTarget,
  extractIntentAnchorPaths,
  extractReferencedFilePath,
  extractRefactoringTarget,
  extractSecurityCheckTypes,
  extractWhyQueryTopics,
} from './query_intent_targets.js';
import {
  applyDefinitionBias,
  applyDocumentBias,
  applyLowRelevanceConfidenceGuardrail,
  isDefinitionEntity,
} from './query_result_biasing.js';
import {
  buildExplanation,
  dedupePacks,
  resolveEvidenceEntityType,
} from './query_pack_postprocessing.js';
import {
  buildQueryCacheKey,
  buildQueryCacheVersionPrefix,
  buildSemanticCacheScopeSignature,
  classifySemanticCacheCategory,
  computeSemanticIntentSimilarity,
  normalizeIntentForCache,
  type SemanticCacheCategory,
} from './query_semantic_cache_utils.js';
import { type CachedResponse } from './query_cache_response_utils.js';
import { hydrateCachedQueryResponse } from './query_cache_hydration.js';
import { buildShortCircuitCachedResponse } from './query_short_circuit_response.js';
import {
  compileCodeownerPattern,
  countFindings,
  isAdrPayload,
  isCommitPayload,
  isOwnershipPayload,
  isRecord,
  isTestPayload,
  readRecordArray,
  readString,
  readStringArray,
} from './query_ingestion_helpers.js';
import {
  buildHydePrompt,
  buildIdentifierExpansionVariants,
  fuseSimilarityResultListsWithRrf,
  fuseSimilarityResultsWithRrf,
  normalizeHydeExpansion,
} from './query_hyde_helpers.js';
import {
  expandPathCandidates,
  normalizePath,
  normalizeQueryScope,
  resolveWorkspacePath,
  toRelativePath,
} from './query_scope_utils.js';
import {
  getQueryCache,
  setCachedQuery,
  type QueryCacheStore,
} from './query_cache_store_utils.js';
import { createStalenessTracker } from '../storage/staleness.js';
import {
  applyEntryPointBias,
  isEntryPointEntity,
} from './query_entry_point_biasing.js';
import {
  CONSTRUCTION_TO_CLASSIFICATION_MAP,
  getConstructionIdFromClassification,
  isConstructionEnabled,
} from './query_construction_routing.js';
import {
  ARCHITECTURE_INTENT_PATTERNS,
  ARCHITECTURE_VERIFICATION_PATTERNS,
  BUG_INVESTIGATION_PATTERNS,
  CODE_QUALITY_PATTERNS,
  CODE_QUERY_PATTERNS,
  CODE_REVIEW_QUERY_PATTERNS,
  DEFINITION_QUERY_PATTERNS,
  ENTRY_POINT_QUERY_PATTERNS,
  FEATURE_LOCATION_PATTERNS,
  IMPLEMENTATION_SEEKING_PATTERNS,
  META_QUERY_PATTERNS,
  PATH_LIKE_QUERY_PATTERNS,
  REFACTORING_OPPORTUNITIES_PATTERNS,
  REFACTORING_SAFETY_PATTERNS,
  SECURITY_AUDIT_PATTERNS,
  WHY_QUERY_PATTERNS,
} from './query_intent_patterns.js';
import { buildQueryIntentBiasProfile } from './query_intent_bias_profile.js';
import { applyIntentTypeRoutingOverrides } from './query_intent_routing_overrides.js';
import {
  resolveQueryDepthProfile,
} from './query_depth_profile.js';
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
export { applyIntentTypeRoutingOverrides };
export { applyDefinitionBias, applyDocumentBias, isDefinitionEntity };
export { applyEntryPointBias, isEntryPointEntity };

type Candidate = { entityId: string; entityType: GraphEntityType; path?: string; semanticSimilarity: number; confidence: number; recency: number; pagerank: number; centrality: number; communityId: number | null; graphSimilarity?: number; cochange?: number; score?: number; };
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

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const EMBEDDING_QUERY_MIN_SIMILARITY = q(
  0.35,
  [0, 1],
  'Minimum similarity for query embedding search.'
);
const HYDE_EMBEDDING_CACHE_PREFIX = 'hyde:embedding:';
const HYDE_EXPANSION_CACHE_LIMIT = 128;
const IDENTIFIER_EXPANSION_EMBEDDING_PREFIX = 'identifier:embedding:';
const DEFAULT_MIN_CONFIDENCE = q(0.3, [0, 1], 'Default minimum confidence for pack retrieval.');
const CANDIDATE_SCORE_FLOOR = q(0.85, [0, 1], 'Fallback candidate score floor.');
const DIRECT_PACK_SCORE_BASE = 1.08;
const DIRECT_PACK_SCORE_MAX = 1.28;
const DIRECT_PACK_SCORE_STOP_WORDS = new Set([
  'where',
  'when',
  'what',
  'which',
  'with',
  'into',
  'from',
  'that',
  'this',
  'these',
  'those',
  'should',
  'does',
  'how',
  'are',
  'the',
  'and',
  'for',
  'guidance',
  'actionable',
]);
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
const COVERAGE_ASSESSMENT_WEIGHTS: CoverageAssessmentWeights = {
  baseOffset: COVERAGE_BASE_OFFSET,
  packDivisor: COVERAGE_PACK_DIVISOR,
  gapPenaltyMax: COVERAGE_GAP_PENALTY_MAX,
  gapPenaltyStep: COVERAGE_GAP_PENALTY_STEP,
  totalConfidenceWeight: COVERAGE_TOTAL_CONFIDENCE_WEIGHT,
  successRatioWeight: COVERAGE_SUCCESS_RATIO_WEIGHT,
  failedCountWeight: COVERAGE_FAILED_COUNT_WEIGHT,
  confidenceBase: COVERAGE_CONFIDENCE_BASE,
  confidenceSuccessWeight: COVERAGE_CONFIDENCE_SUCCESS_WEIGHT,
  confidenceFailedWeight: COVERAGE_CONFIDENCE_FAILED_WEIGHT,
};
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
const INDEX_CONFIDENCE_CAP_MIN = q(0.1, [0, 1], 'Minimum confidence cap during indexing.');
const INDEX_CONFIDENCE_CAP_MAX = q(0.5, [0, 1], 'Maximum confidence cap during indexing.');
const INDEX_CONFIDENCE_CAP_SCALE = q(0.5, [0, 1], 'Scale factor for indexing confidence cap.');
const INDEX_CONFIDENCE_CAP_FALLBACK = q(0.3, [0, 1], 'Fallback confidence cap when progress unknown.');
const HINT_LOW_CONFIDENCE_THRESHOLD = q(
  0.5,
  [0, 1],
  'Hint threshold for low-confidence results.'
);
const FILESYSTEM_FALLBACK_LIMIT = 6;
const FILESYSTEM_FALLBACK_GLOB = 'src/**/*.{ts,tsx,js,jsx,mjs,cjs}';
const FILESYSTEM_FALLBACK_STOP_WORDS = new Set([
  'the', 'how', 'does', 'what', 'where', 'when', 'why', 'work', 'works', 'working',
  'implemented', 'implementation', 'defined', 'located', 'handled', 'handling', 'across',
  'codebase', 'project', 'file', 'files', 'stage', 'stages', 'into', 'from', 'with',
  'that', 'this', 'those', 'these', 'its', 'their', 'there', 'about',
]);
const FILESYSTEM_FALLBACK_DEPRIORITIZED_TERMS = new Set([
  'dead',
  'legacy',
  'deprecated',
  'archive',
  'archived',
  'obsolete',
  'old',
]);
const FILESYSTEM_FALLBACK_DEPRIORITIZED_PATH_SEGMENTS = /(^|\/)(dead|legacy|deprecated|archive|archived|obsolete|old)(\/|$)/u;
const FILESYSTEM_FALLBACK_PREFERRED_PATH_SEGMENTS = /(^|\/)(live|active|current|canonical|primary)(\/|$)/u;

// ============================================================================
// META-QUERY DETECTION FOR DOCUMENTATION ROUTING
// ============================================================================

// ============================================================================
// CONSTRUCTION ROUTING HELPERS
// ============================================================================

/**
 * Mapping from construction IDs to their stage runner classifications.
 * This maps the ConstructableId from auto_selector.ts to the query classification flags.
 */
const CONSTRUCTION_TO_CLASSIFICATION: Record<string, keyof QueryClassification> =
  CONSTRUCTION_TO_CLASSIFICATION_MAP as Record<string, keyof QueryClassification>;

/**
 * Get the construction ID for a classification flag.
 * Returns undefined if the flag is not a construction-related flag.
 */
function getConstructionId(classificationFlag: keyof QueryClassification): string | undefined {
  return getConstructionIdFromClassification(classificationFlag, CONSTRUCTION_TO_CLASSIFICATION);
}

export interface QueryClassification {
  isMetaQuery: boolean;
  isCodeQuery: boolean;
  isPathQuery: boolean;  // Queries naming explicit file paths
  pathTarget?: string;  // The referenced file path when present
  isSymbolQuery: boolean;  // Queries asking for a concrete symbol definition/location
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
  const pathTarget = extractReferencedFilePath(intent);
  const pathMatches = PATH_LIKE_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const rawMetaMatches = META_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const implementationSeekingMatches = IMPLEMENTATION_SEEKING_PATTERNS.filter(p => p.test(intent)).length;
  // When the query is seeking implementation details (e.g., "how does the query pipeline work"),
  // suppress meta classification by zeroing out meta matches.
  const metaMatches = implementationSeekingMatches > 0 ? 0 : rawMetaMatches;
  const codeMatches = CODE_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const definitionMatches = DEFINITION_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const entryPointMatches = ENTRY_POINT_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const projectUnderstandingMatches = PROJECT_UNDERSTANDING_PATTERNS.filter(p => p.test(intent)).length;
  const whyMatches = WHY_QUERY_PATTERNS.filter(p => p.test(intent)).length;
  const symbolQuery = detectSymbolQuery(intent);
  const explicitSymbolLocationQuery =
    /\bwhere\s+is\s+(?:the\s+)?[A-Za-z_][A-Za-z0-9_]*\s+(?:function|class|method|symbol)\b/i.test(intent)
    || /\bwhere\s+is\s+(?:the\s+)?[A-Za-z_][A-Za-z0-9_]*\s+(?:defined|declared|implemented)\??$/i.test(intent)
    || /\bwho\s+calls?\s+[A-Za-z_][A-Za-z0-9_]*\b/i.test(intent);

  // Check for test query using the dedicated classifier
  const testClassification = classifyTestQuery(intent);
  const isTestQuery = testClassification.isTestQuery;
  const isPathQuery = Boolean(pathTarget) && pathMatches > 0 && !isTestQuery;

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
  const architectureOverviewMatches =
    ARCHITECTURE_QUERY_PATTERNS.filter(p => p.test(intent)).length
    + ARCHITECTURE_INTENT_PATTERNS.filter(p => p.test(intent)).length;
  const isArchitectureOverviewQuery = architectureOverviewMatches > 0 && !isTestQuery && !isArchitectureVerificationQuery;
  const isSymbolQuery = (Boolean(symbolQuery) || explicitSymbolLocationQuery) && !isTestQuery && !isArchitectureOverviewQuery && !isPathQuery;

  const codeQualityMatches = CODE_QUALITY_PATTERNS.filter(p => p.test(intent)).length;
  const isCodeQualityQuery = codeQualityMatches > 0 && !isTestQuery;

  const featureLocationMatches = FEATURE_LOCATION_PATTERNS.filter(p => p.test(intent)).length;
  const isFeatureLocationQuery = featureLocationMatches > 0 && !isTestQuery;
  const featureTarget = isFeatureLocationQuery ? extractFeatureTarget(intent) : undefined;
  const hasStrongImplementationLocationSignal =
    implementationSeekingMatches > 0
    || isPathQuery
    || isSymbolQuery
    || isFeatureLocationQuery
    || /\bwhere\s+is\b.*\b(implemented|defined|located)\b/i.test(intent);

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
  const isMetaQuery = (
    metaMatches > 0
    && metaMatches >= codeMatches
    && !hasStrongImplementationLocationSignal
    && !isTestQuery
    && !isWhyQuery
  ) || isProjectUnderstanding;
  const isCodeQuery =
    (codeMatches > 0 || implementationSeekingMatches > 0 || isPathQuery || isSymbolQuery || isFeatureLocationQuery)
    && (codeMatches > metaMatches || hasStrongImplementationLocationSignal || implementationSeekingMatches > 0 || isPathQuery || isSymbolQuery || isFeatureLocationQuery)
    && !isTestQuery
    && !isProjectUnderstanding
    && !isWhyQuery;
  const isDefinitionQuery = definitionMatches > 0 && !isTestQuery;
  const isEntryPointQuery = entryPointMatches > 0 && !isTestQuery && !isArchitectureOverviewQuery && !isSymbolQuery;

  const whyTopics = isWhyQuery ? extractWhyQueryTopics(intent) : {};
  const whyQueryTopic = whyTopics.topic;
  const whyComparisonTopic = whyTopics.comparisonTopic;

  const intentBiasProfile = buildQueryIntentBiasProfile({
    metaMatches,
    definitionMatches,
    entryPointMatches,
    projectUnderstandingMatches,
    whyMatches,
    architectureOverviewMatches,
    isMetaQuery,
    isCodeQuery,
    isDefinitionQuery,
    isTestQuery,
    isEntryPointQuery,
    isProjectUnderstandingQuery: isProjectUnderstanding,
    isWhyQuery,
    isArchitectureOverviewQuery,
    isPathQuery,
    isSymbolQuery,
  });
  const {
    documentBias,
    definitionBias,
    entryPointBias,
    projectUnderstandingBias,
    rationaleBias,
    architectureOverviewBias,
    entityTypes,
  } = intentBiasProfile;

  return {
    isMetaQuery,
    isCodeQuery,
    isPathQuery,
    pathTarget,
    isSymbolQuery,
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

function appendPipelineStageFacts(keyFacts: string[], filePath: string, exportsList: string[]): void {
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath !== 'src/api/query.ts') return;
  if (!exportsList.includes('getQueryPipelineStages') && !exportsList.includes('queryLibrarian')) return;
  keyFacts.push(`Pipeline stages: ${getQueryPipelineStages().map((stage) => stage.stage).join(', ')}`);
}

function applyQueryPipelineStageAnswerAugmentation(options: {
  query: LibrarianQuery;
  synthesis?: SynthesizedResponse;
  finalPacks: ContextPack[];
}): SynthesizedResponse | undefined {
  const { query, synthesis, finalPacks } = options;
  if (!synthesis) return synthesis;
  const intent = query.intent?.toLowerCase() ?? '';
  if (!/\bquery\s+pipeline\b/.test(intent) || !/\bstages?\b/.test(intent)) return synthesis;
  const pointsToQueryModule = finalPacks.some((pack) =>
    (pack.relatedFiles ?? []).some((file) => file.replace(/\\/g, '/') === 'src/api/query.ts')
  );
  if (!pointsToQueryModule) return synthesis;
  const stageList = getQueryPipelineStages().map((stage) => stage.stage).join(', ');
  if (synthesis.answer.includes(stageList)) return synthesis;
  return {
    ...synthesis,
    answer: `${synthesis.answer} Pipeline stages: ${stageList}.`,
  };
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
    let llmRequirement: LlmRequirement =
      (offlineMode || envDisableSynthesis) ? 'disabled' : requestedLlmRequirement;
    const embeddingRequirementExplicit = query.embeddingRequirement !== undefined;
    const deterministicStructuralRetrieval =
      deterministicCtx
      && envDisableSynthesis
      && !embeddingRequirementExplicit;
    let embeddingRequirement: EmbeddingRequirement =
      deterministicStructuralRetrieval
        ? 'disabled'
        : (query.embeddingRequirement ?? (query.depth === 'L0' ? 'disabled' : 'required'));
    const anchoredPlanningDirectMode = shouldUseAnchoredPlanningDirectMode(query)
      && requestedLlmRequirement !== 'required'
      && query.embeddingRequirement !== 'required';
    if (anchoredPlanningDirectMode) {
      embeddingRequirement = 'disabled';
    }
    let llmAvailable = llmRequirement === 'required';
    let llmProviderError: string | undefined;
    query = {
      ...query,
      llmRequirement,
      embeddingRequirement,
      forceSummarySynthesis: anchoredPlanningDirectMode ? true : query.forceSummarySynthesis,
    };
    if (offlineMode) {
      disclosures.push('unverified_by_trace(offline_mode): Runtime offline/local-only mode active; LLM synthesis disabled.');
    }
    if (anchoredPlanningDirectMode) {
      disclosures.push('unverified_by_trace(anchored_planning_direct_mode): Skipping provider probes and semantic retrieval for anchored implementation-planning query.');
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

    const providerChecksDisabled =
      (llmRequirement === 'disabled' && query.embeddingRequirement === 'disabled')
      || anchoredPlanningDirectMode
      || query.coldStartStructuralOnly === true;
    const providerSnapshot = providerChecksDisabled
      ? {
          status: {
            llm: {
              available: false,
              provider: 'none',
              model: 'unknown',
              latencyMs: 0,
              error: 'provider checks skipped because llmRequirement=disabled',
            },
            embedding: {
              available: false,
              provider: 'none',
              model: 'unknown',
              latencyMs: 0,
              error: 'provider checks skipped because embeddingRequirement=disabled',
            },
          },
          remediationSteps: [] as string[],
          reason: query.coldStartStructuralOnly ? 'cold_start_structural_only' : 'provider_checks_skipped',
        }
      : await checkProviderSnapshot({
          workspaceRoot,
          ledger: traceOptions.evidenceLedger,
          sessionId: traceSessionId,
        });
    if (query.coldStartStructuralOnly) {
      disclosures.push(
        'unverified_by_trace(cold_start_structural_only): Provider probes skipped and semantic retrieval deferred during model prewarm.'
      );
    }

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
    const synthesisEnabled = ((llmRequirement !== 'disabled' && llmAvailable) || query.forceSummarySynthesis === true) && !deterministicCtx;

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

    const stats = await storage.getStats();
    if (stats.totalFunctions === 0 && stats.totalModules === 0) {
      recordCoverageGap(
        'semantic_retrieval',
        'Persistent index is empty; falling back to direct filesystem retrieval.',
        'significant'
      );
      disclosures.push(
        'unverified_by_trace(empty_storage): Persistent index is empty; using direct filesystem retrieval until bootstrap is repaired.'
      );
    }

  let queryEmbedding: Float32Array | null = null;
  const governor = governorContext ?? new GovernorContext({ phase: 'query', config: DEFAULT_GOVERNOR_CONFIG }); governor.checkBudget();
  const version = await storage.getVersion() || getSyntheticPackVersion();
  const retrievalIntentType = (query.intentType ?? query.taskType ?? 'general').toString();
  const retrievalStrategySelection = await selectRetrievalStrategyForIntent(storage, retrievalIntentType);
  const selectedRetrievalStrategy: RetrievalStrategyArm = retrievalStrategySelection.strategyId;
  disclosures.push(`retrieval_strategy: ${selectedRetrievalStrategy} (thompson_sampling)`);
  let indexState = await getIndexState(storage);
  if (query.waitForIndexMs && !isReadyPhase(indexState.phase)) {
    indexState = await waitForIndexReady(storage, { timeoutMs: query.waitForIndexMs });
  }
  const cacheEligibility = await resolveQueryCacheEligibility({
    storage,
    query,
    indexState,
    workspaceRoot,
  });
  if (cacheEligibility.reason) {
    disclosures.push(`cache_bypassed: ${cacheEligibility.reason}`);
  }
  const allowCache = cacheEligibility.allowCache;
  const cacheKey = allowCache ? buildQueryCacheKey(query, version, llmRequirement, synthesisEnabled) : '';
  if (allowCache) {
    const cache = getQueryCache(storage);
    const cached = await cache.get(cacheKey);
    if (cached) {
      const queryId = cacheKey || generateUUID('qry_');
      errorQueryId = queryId;
      void globalEventBus.emit(createQueryReceivedEvent(queryId, query.intent ?? '', query.depth ?? 'L1', traceSessionId));
      const cachedResponse = hydrateCachedQueryResponse({
        baseResponse: cached,
        query,
        latencyMs: deterministicCtx ? 0 : (Date.now() - startTime),
        version,
        traceId,
        disclosures,
        constructionPlan,
      });
      await logRetrievalConfidenceObservation(storage, workspaceRoot, {
        queryHash: queryId,
        intent: query.intent,
        confidenceScore: cachedResponse.totalConfidence,
        retrievalEntropy: cachedResponse.retrievalEntropy ?? 0,
        returnedPackIds: cachedResponse.packs.map((pack) => pack.packId),
        timestamp: new Date().toISOString(),
        routedStrategy: selectedRetrievalStrategy,
      });
      await selectAndRecordRetrievalStrategy(
        storage,
        typeof cachedResponse.feedbackToken === 'string' ? cachedResponse.feedbackToken : queryId,
        retrievalIntentType,
        new Date().toISOString()
      );
      const cacheStore = storage as QueryCacheStore;
      if (cacheStore.recordQueryCacheAccess) {
        await cacheStore.recordQueryCacheAccess(cacheKey);
      }
      for (const pack of cachedResponse.packs) await storage.recordContextPackAccess(pack.packId);
      await recordQueryAccessLogsForPacks(storage, cachedResponse.packs, getNow());
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
      const cachedResponse = hydrateCachedQueryResponse({
        baseResponse: semanticCached.response,
        query,
        latencyMs: deterministicCtx ? 0 : (Date.now() - startTime),
        version,
        traceId,
        disclosures: [...disclosures, semanticDisclosure],
        constructionPlan,
      });
      await logRetrievalConfidenceObservation(storage, workspaceRoot, {
        queryHash: queryId,
        intent: query.intent,
        confidenceScore: cachedResponse.totalConfidence,
        retrievalEntropy: cachedResponse.retrievalEntropy ?? 0,
        returnedPackIds: cachedResponse.packs.map((pack) => pack.packId),
        timestamp: new Date().toISOString(),
        routedStrategy: selectedRetrievalStrategy,
      });
      await selectAndRecordRetrievalStrategy(
        storage,
        typeof cachedResponse.feedbackToken === 'string' ? cachedResponse.feedbackToken : queryId,
        retrievalIntentType,
        new Date().toISOString()
      );
      const cacheStore = storage as QueryCacheStore;
      if (cacheStore.recordQueryCacheAccess) {
        await cacheStore.recordQueryCacheAccess(semanticCached.matchedKey);
      }
      for (const pack of cachedResponse.packs) await storage.recordContextPackAccess(pack.packId);
      await recordQueryAccessLogsForPacks(storage, cachedResponse.packs, getNow());
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
    collectDirectPacksFn: collectDirectPacks,
  });
  let cacheHit = directStageResult.cacheHit;
  let directPacks = directStageResult.directPacks;
  type DirectPackResponseOptions = {
    totalConfidence?: number;
    drillDownHints?: string[];
  };
  const finalizeEarlyShortCircuit = async (
    packs: ContextPack[],
    options: DirectPackResponseOptions = {}
  ): Promise<LibrarianResponse> => {
    const calibration = await getConfidenceCalibration(storage);
    const calibratedPacks = applyCalibrationToPacks(packs, calibration);
    const latencyMs = deterministicCtx ? 0 : Date.now() - startTime;
    const response = buildShortCircuitCachedResponse({
      query,
      packs: calibratedPacks,
      disclosures,
      traceId,
      constructionPlan,
      calibration,
      explanation: explanationParts.join(' '),
      latencyMs,
      version,
      totalConfidence: options.totalConfidence,
      drillDownHints: options.drillDownHints,
    });

    try {
      await recordQueryEpisode(storage, { query, response, durationMs: latencyMs });
    } catch {
      // Non-blocking: continue even if episode recording fails
    }

    void globalEventBus.emit(
      createQueryCompleteEvent(queryId, calibratedPacks.length, false, latencyMs, traceSessionId)
    );
    return response;
  };
  const applyDirectPackStage = async (
    stage: {
      shouldShortCircuit: boolean;
      shouldMerge: boolean;
      packs: ContextPack[];
      explanation: string | string[];
      responseOptions?: DirectPackResponseOptions;
    }
  ): Promise<LibrarianResponse | null> => {
    const explanationMessages = Array.isArray(stage.explanation)
      ? stage.explanation.filter(message => message.length > 0)
      : [stage.explanation];
    if (stage.shouldShortCircuit && stage.packs.length > 0) {
      explanationParts.push(...explanationMessages);
      return finalizeEarlyShortCircuit(stage.packs, stage.responseOptions);
    }
    if (stage.shouldMerge && stage.packs.length > 0) {
      directPacks = [...stage.packs, ...directPacks];
      explanationParts.push(...explanationMessages);
    }
    return null;
  };
  const preliminaryQueryClassification = applyIntentTypeRoutingOverrides(
    classifyQueryIntent(query.intent ?? ''),
    query.intentType,
    query.affectedFiles
  );
  let pathLookupHandled = false;
  let featureLocationHandled = false;

  if (preliminaryQueryClassification.isPathQuery && preliminaryQueryClassification.pathTarget) {
    const pathLookupResult = await runPathLookupStage({
      storage,
      intent: query.intent ?? '',
      pathTarget: preliminaryQueryClassification.pathTarget,
      workspaceRoot,
      depth: query.depth,
      filter: query.filter,
      minConfidence: query.minConfidence,
    });
    pathLookupHandled = pathLookupResult.analyzed;
    const pathLookupStageResponse = await applyDirectPackStage({
      shouldShortCircuit: Boolean(pathLookupResult.shouldShortCircuit),
      shouldMerge: pathLookupResult.analyzed,
      packs: pathLookupResult.packs,
      explanation: pathLookupResult.explanation,
    });
    if (pathLookupStageResponse) {
      return pathLookupStageResponse;
    }
  }

  if (!pathLookupHandled && preliminaryQueryClassification.isFeatureLocationQuery && preliminaryQueryClassification.featureTarget) {
    const featureLocationResult = await runFeatureLocationStage({
      storage,
      intent: query.intent ?? '',
      featureTarget: preliminaryQueryClassification.featureTarget,
      version,
    });
    featureLocationHandled = featureLocationResult.analyzed;
    const featureLocationStageResponse = await applyDirectPackStage({
      shouldShortCircuit: Boolean(featureLocationResult.shouldShortCircuit),
      shouldMerge: featureLocationResult.analyzed,
      packs: featureLocationResult.packs,
      explanation: featureLocationResult.explanation,
    });
    if (featureLocationStageResponse) {
      return featureLocationStageResponse;
    }
  }

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
  const symbolStageResponse = await applyDirectPackStage({
    shouldShortCircuit: symbolLookupResult.shouldShortCircuit,
    shouldMerge: symbolLookupResult.isSymbolQuery,
    packs: symbolLookupResult.symbolPacks,
    explanation: symbolLookupResult.explanation,
  });
  if (symbolStageResponse) {
    return symbolStageResponse;
  }

  // GIT QUERY STAGE - Handle "recent changes to X", "git history", "what changed" queries
  // This runs early to intercept git-related queries and return actual commit history
  // instead of semantic matches that return functions IN the file rather than changes TO it
  const gitQueryResult = runGitQueryStage({
    intent: query.intent ?? '',
    workspace: workspaceRoot,
    version,
  });
  const gitStageResponse = await applyDirectPackStage({
    shouldShortCircuit: gitQueryResult.isGitQuery && gitQueryResult.shouldShortCircuit,
    shouldMerge: gitQueryResult.isGitQuery,
    packs: gitQueryResult.gitPacks,
    explanation: gitQueryResult.explanation,
  });
  if (gitStageResponse) {
    return gitStageResponse;
  }

  // ENUMERATION STAGE - Handle "list all X", "how many Y", "enumerate Z" queries
  // This runs early to provide complete entity listings without semantic search
  const enumIntent = detectEnumerationIntent(query.intent ?? '');
  const shouldBypassEnumeration = shouldBypassEnumerationForIntent(query.intent ?? '');
  if (enumIntent.isEnumeration && enumIntent.category && !shouldBypassEnumeration) {
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

        const enumerationStageResponse = await applyDirectPackStage({
          shouldShortCircuit: true,
          shouldMerge: false,
          packs: enumPacks,
          explanation: [
            enumResult.explanation,
            `Enumeration query detected (${enumIntent.queryType}). ${formatEnumerationResult(enumResult).split('\n').slice(0, 3).join(' ')}`,
          ],
        });
        if (enumerationStageResponse) {
          return enumerationStageResponse;
        }
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

        const callFlowStageResponse = await applyDirectPackStage({
          shouldShortCircuit: true,
          shouldMerge: false,
          packs: [callFlowPack],
          explanation: `Call flow query detected. ${callFlowResult.summary}`,
          responseOptions: {
            drillDownHints: callFlowResult.sequence.length > 5
              ? [`Explore deeper: "call flow for ${callFlowResult.sequence[1]?.function}"`]
              : [],
          },
        });
        if (callFlowStageResponse) {
          return callFlowStageResponse;
        }
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
  const comparisonPacks = comparisonLookupResult.comparisonPack
    ? [comparisonLookupResult.comparisonPack, ...comparisonLookupResult.entityPacks]
    : [];
  const comparisonStageResponse = await applyDirectPackStage({
    shouldShortCircuit: comparisonLookupResult.shouldShortCircuit && Boolean(comparisonLookupResult.comparisonPack),
    shouldMerge: comparisonLookupResult.isComparisonQuery && Boolean(comparisonLookupResult.comparisonPack),
    packs: comparisonPacks,
    explanation: comparisonLookupResult.explanation,
  });
  if (comparisonStageResponse) {
    return comparisonStageResponse;
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
        const callerProbePack = shouldShortCircuitStructuralCallerQuery(structuralIntent, dependencyQueryResult)
          ? buildStructuralCallerPack(dependencyQueryResult, version, workspaceRoot)
          : null;
        const callerProbeStageResponse = callerProbePack
          ? await applyDirectPackStage({
              shouldShortCircuit: true,
              shouldMerge: false,
              packs: [callerProbePack],
              explanation: [
                dependencyQueryResult.explanation,
                `Caller probe detected for "${structuralIntent.targetEntity}"; using indexed call edges instead of semantic retrieval.`,
              ],
            })
          : null;
        if (callerProbeStageResponse) {
          return callerProbeStageResponse;
        }
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

  const skipSemanticRetrievalForAnchoredPlanning = !shouldRunExhaustive
    && shouldSkipSemanticRetrievalForAnchoredPlanning(query, directPacks);
  if (skipSemanticRetrievalForAnchoredPlanning) {
    explanationParts.push('Skipped semantic retrieval for anchored planning query because direct packs already cover the referenced file.');
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
    : skipSemanticRetrievalForAnchoredPlanning
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
        isModelLoadedFn: isModelLoaded,
        preloadEmbeddingModelFn: preloadEmbeddingModel,
        logWarningFn: logWarning,
        resolveQueryEmbeddingsFn: resolveQueryEmbeddings,
        classifyQueryIntentFn: classifyQueryIntent,
        applyIntentTypeRoutingOverridesFn: applyIntentTypeRoutingOverrides,
        fuseSimilarityResultListsWithRrfFn: fuseSimilarityResultListsWithRrf,
        applyDocumentBiasFn: applyDocumentBias,
        applyDefinitionBiasFn: applyDefinitionBias,
        hydrateCandidatesFn: hydrateCandidates,
        injectFilenameCandidatesFn: injectFilenameCandidates,
        extractIntentAnchorPathsFn: extractIntentAnchorPaths,
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

  // Filter archive docs from candidates — they're archived and shouldn't appear in results.
  // For implementation-seeking queries, also remove all doc candidates since the user
  // is asking about code, not documentation.
  const isImplSeeking = IMPLEMENTATION_SEEKING_PATTERNS.some(p => p.test(query.intent ?? ''));
  const preFilterCount = candidates.length;
  candidates = candidates.filter(c => {
    const id = c.entityId;
    // Always exclude archive docs
    if (id.startsWith('doc:') && id.includes('/archive/')) return false;
    // For implementation-seeking queries, exclude ALL doc candidates
    if (isImplSeeking && (id.startsWith('doc:') || (c as Candidate & { isDocument?: boolean }).isDocument)) return false;
    return true;
  });
  if (candidates.length < preFilterCount) {
    explanationParts.push(`Filtered ${preFilterCount - candidates.length} doc candidates (implementation-seeking query).`);
  }

  const candidateMaterializationLimit = resolveCandidateMaterializationLimit(
    query.depth,
    query.intent ?? '',
    shouldRunExhaustive,
  );
  if (candidates.length > candidateMaterializationLimit) {
    const before = candidates.length;
    candidates = capCandidatesForMaterialization(candidates, candidateMaterializationLimit);
    explanationParts.push(
      `Bounded candidate materialization to ${candidateMaterializationLimit}/${before} entities to keep retrieval latency stable.`
    );
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
    workspaceRoot,
    candidates,
    directPacks,
    candidateScoreMap,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    version,
    collectCandidatePacksFn: collectCandidatePacks,
    dedupePacksFn: dedupePacks,
    collectFilesystemFallbackPacksFn: collectFilesystemFallbackPacks,
    rankHeuristicFallbackPacksFn: rankHeuristicFallbackPacks,
    scoreAnchoredDirectPackFn: scoreAnchoredDirectPack,
    filterPacksToWorkspaceFn: filterPacksToWorkspace,
  });
  // Determine task type for ranking: use 'guidance' for meta-queries to boost documentation,
  // 'implementation' for code-seeking queries to penalize docs and prefer functions.
  // Also detect implementation-seeking queries (e.g., "how does X work" where X is a code concept)
  // which suppress meta classification but must also get implementation ranking.
  const isImplementationSeeking = IMPLEMENTATION_SEEKING_PATTERNS.some(p => p.test(query.intent ?? ''));
  const rankingTaskType = queryClassification?.isMetaQuery
    ? 'guidance'
    : (queryClassification?.isCodeQuery || isImplementationSeeking)
      ? (query.taskType ?? 'implementation')
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
  const priorityDirectPacks = selectPriorityDirectPacks(directPacks, query.intent ?? '', contextLevel.packLimit);
  if (priorityDirectPacks.length > 0) {
    finalPacks = dedupePacks([...priorityDirectPacks, ...finalPacks]).slice(0, contextLevel.packLimit);
    explanationParts.push(`Preserved ${priorityDirectPacks.length} anchor-priority direct packs in final ranking.`);
  }
  const prependSpecializedPacks = (stage: {
    shouldPrepend: boolean;
    packs: ContextPack[];
    explanation: string;
  }): void => {
    if (!stage.shouldPrepend || stage.packs.length === 0) {
      return;
    }
    finalPacks = [...stage.packs, ...finalPacks];
    explanationParts.push(stage.explanation);
  };
  type SpecializedStageResult = {
    analyzed: boolean;
    packs: ContextPack[];
    explanation: string;
  };
  const runSpecializedAnalyzedStage = async (stage: {
    enabled: boolean;
    execute: () => Promise<SpecializedStageResult>;
  }): Promise<void> => {
    if (!stage.enabled) {
      return;
    }
    const result = await stage.execute();
    prependSpecializedPacks({
      shouldPrepend: result.analyzed,
      packs: result.packs,
      explanation: result.explanation,
    });
  };
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
    prependSpecializedPacks({
      shouldPrepend: entryPointResult.found,
      packs: entryPointResult.packs,
      explanation: entryPointResult.explanation,
    });
    if (!entryPointResult.found) {
      explanationParts.push(entryPointResult.explanation);
    }
  }
  // Handle architecture overview queries specially - infer layers from structure
  if (queryClassification?.isArchitectureOverviewQuery) {
    explanationParts.push('Architecture query detected: inferring layers from directory structure and dependencies.');
    // Generate architecture overview and prepend to packs
    finalPacks = await handleArchitectureQuery(storage, workspaceRoot, finalPacks, version, query.intent ?? '');
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
    prependSpecializedPacks({
      shouldPrepend: rationaleResult.found,
      packs: rationaleResult.packs,
      explanation: rationaleResult.explanation,
    });
    if (!rationaleResult.found && rationaleResult.inferredRationale) {
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
  const specializedStageConfigs: Array<{
    enabled: boolean;
    execute: () => Promise<SpecializedStageResult>;
  }> = [
    // Handle refactoring safety queries - analyze impact of changes
    // Check both pattern match AND construction enablement
    {
      enabled: Boolean(
        queryClassification?.isRefactoringSafetyQuery &&
        queryClassification.refactoringTarget &&
        isConstructionEnabled('refactoring-safety-checker', query.enabledConstructables)
      ),
      execute: () => runRefactoringSafetyStage({
        storage,
        target: queryClassification!.refactoringTarget!,
        intent: query.intent ?? '',
        version,
      }),
    },
    // Handle bug investigation queries - debug errors and trace issues
    {
      enabled: Boolean(
        queryClassification?.isBugInvestigationQuery &&
        isConstructionEnabled('bug-investigation-assistant', query.enabledConstructables)
      ),
      execute: () => runBugInvestigationStage({
        storage,
        intent: query.intent ?? '',
        bugContext: queryClassification?.bugContext,
        version,
      }),
    },
    // Handle security audit queries - find vulnerabilities
    {
      enabled: Boolean(
        queryClassification?.isSecurityAuditQuery &&
        isConstructionEnabled('security-audit-helper', query.enabledConstructables)
      ),
      execute: () => runSecurityAuditStage({
        storage,
        intent: query.intent ?? '',
        checkTypes: queryClassification?.securityCheckTypes,
        version,
        workspaceRoot,
      }),
    },
    // Handle architecture verification queries - check layer/boundary compliance
    {
      enabled: Boolean(
        queryClassification?.isArchitectureVerificationQuery &&
        isConstructionEnabled('architecture-verifier', query.enabledConstructables)
      ),
      execute: () => runArchitectureVerificationStage({
        storage,
        intent: query.intent ?? '',
        version,
        workspaceRoot,
      }),
    },
    // Handle code quality queries - analyze complexity, duplication, smells
    {
      enabled: Boolean(
        queryClassification?.isCodeQualityQuery &&
        isConstructionEnabled('code-quality-reporter', query.enabledConstructables)
      ),
      execute: () => runCodeQualityStage({
        storage,
        intent: query.intent ?? '',
        version,
        workspaceRoot,
      }),
    },
    // Handle feature location queries - find where features are implemented
    {
      enabled: Boolean(
        !featureLocationHandled &&
        queryClassification?.isFeatureLocationQuery &&
        queryClassification.featureTarget &&
        isConstructionEnabled('feature-location-advisor', query.enabledConstructables)
      ),
      execute: () => runFeatureLocationStage({
        storage,
        intent: query.intent ?? '',
        featureTarget: queryClassification!.featureTarget!,
        version,
      }),
    },
    // Handle refactoring opportunities queries - find code that should be refactored
    {
      enabled: Boolean(queryClassification?.isRefactoringOpportunitiesQuery),
      execute: () => runRefactoringOpportunitiesStage({
        storage,
        intent: query.intent ?? '',
        version,
        workspaceRoot,
      }),
    },
    // Handle dependency management queries - analyze packages, find unused, outdated, etc.
    {
      enabled: Boolean(queryClassification?.isDependencyManagementQuery),
      execute: () => runDependencyManagementStage({
        storage,
        intent: query.intent ?? '',
        version,
        workspaceRoot,
        action: queryClassification?.dependencyAction,
      }),
    },
    // Handle decision support queries - help agents make technical choices
    {
      enabled: Boolean(queryClassification?.isDecisionSupportQuery),
      execute: () => runDecisionSupportStage({
        storage,
        intent: query.intent ?? '',
        version,
        workspaceRoot,
      }),
    },
  ];
  for (const stage of specializedStageConfigs) {
    await runSpecializedAnalyzedStage(stage);
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
  const hardPackCap = Math.max(
    contextLevel.packLimit,
    isCallerProbeIntent(query.intent ?? '') ? 12 : contextLevel.packLimit * 3,
  );
  if (finalPacks.length > hardPackCap) {
    const before = finalPacks.length;
    finalPacks = finalPacks.slice(0, hardPackCap);
    explanationParts.push(`Bounded response packs to ${hardPackCap}/${before} for stable agent-facing output size.`);
  }
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
  if (!packStageResult.usedFilesystemFallback && indexAssessment.confidenceCap !== null) {
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
  let lowRelevanceGuardrailTriggered = false;
  let lowRelevanceGuardrailReason: string | undefined;
  if (finalPacks.length > 0) {
    const topPackRelevance = candidateScoreMap.get(finalPacks[0].targetId) ?? finalPacks[0].confidence;
    const relevanceGuardrail = applyLowRelevanceConfidenceGuardrail(totalConfidence, topPackRelevance);
    totalConfidence = relevanceGuardrail.totalConfidence;
    lowRelevanceGuardrailTriggered = relevanceGuardrail.triggered;
    lowRelevanceGuardrailReason = relevanceGuardrail.reason;
    if (relevanceGuardrail.triggered && relevanceGuardrail.reason) {
      disclosures.push(`low_relevance_confidence_guardrail: ${relevanceGuardrail.reason}`);
    }
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
          stageCosts: buildStageCostSummary(stageTracker.report()),
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
    preferQuickSynthesis: skipSemanticRetrievalForAnchoredPlanning
      || coverageGaps.some((gap) =>
        /persistent index is empty|vector_index_empty|index not initialized/i.test(gap)
      ),
    workspaceRoot,
  });
  let synthesis = synthesisStageResult.synthesis;
  let synthesisMode: SynthesisMode | undefined = synthesisStageResult.synthesisMode;
  let llmError: string | undefined = synthesisStageResult.llmError;
  if (!llmError && llmProviderError) {
    llmError = llmProviderError;
  }
  synthesis = applyHeuristicSynthesisGuardrail({
    synthesis,
    synthesisMode,
    queryIntent: query.intent,
    finalPacks,
    coherenceAnalysis,
    lowRelevanceTriggered: lowRelevanceGuardrailTriggered,
    lowRelevanceReason: lowRelevanceGuardrailReason,
  });
  synthesis = applyAdequacyToSynthesis(synthesis, adequacyReport);
  synthesis = applyQueryPipelineStageAnswerAugmentation({ query, synthesis, finalPacks });
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
        recordCoverageGap('post_processing', degradedMessage, 'significant', 'Run `librainian doctor --heal` to recover storage locks.');
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
    retrievalStrategyId: selectedRetrievalStrategy,
    retrievalIntentType: retrievalIntentType,
  }, storage);
  await recordQueryAccessLogsForPacks(storage, finalPacks, getNow());
  await selectAndRecordRetrievalStrategy(
    storage,
    feedbackToken,
    retrievalIntentType,
    getNow()
  );

  // Mark the first/best pack as the primary result for agent ergonomics
  // This gives agents a clear "start here" signal
  if (finalPacks.length > 0) {
    finalPacks[0].isPrimaryResult = true;
  }

  let queryIntelSections: Pick<LibrarianResponse, 'riskHighlights' | 'stabilityAlerts' | 'ownershipContext' | 'entityIntel'> = {};
  try {
    const fallbackTokenBudget = estimateTokenCount(
      JSON.stringify({
        packs: finalPacks.map((pack) => ({
          summary: pack.summary,
          keyFacts: pack.keyFacts,
          codeSnippets: pack.codeSnippets.map((snippet) => snippet.content),
        })),
        synthesis: synthesis?.answer,
      })
    );
    queryIntelSections = await buildQueryIntelSections({
      storage,
      packs: finalPacks,
      depth: query.depth ?? 'L1',
      workspaceRoot,
      maxResponseTokens: tokenBudgetResult?.totalAvailable ?? query.tokenBudget?.maxTokens ?? fallbackTokenBudget,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Query intel projection failed: ${message}`);
  }

  const response = {
    query,
    intentType: query.intentType,
    packs: finalPacks,
    ...queryIntelSections,
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
        recordCoverageGap('post_processing', degradedMessage, 'significant', 'Run `librainian doctor --heal` to recover storage locks.');
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
    weights: COVERAGE_ASSESSMENT_WEIGHTS,
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
    routedStrategy: selectedRetrievalStrategy,
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
      stageCosts: buildStageCostSummary(stageReports),
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
  retrievalStrategyId?: string;
  retrievalIntentType?: string;
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
        typeof record.createdAt === 'string' &&
        (typeof record.retrievalStrategyId === 'string' || typeof record.retrievalStrategyId === 'undefined') &&
        (typeof record.retrievalIntentType === 'string' || typeof record.retrievalIntentType === 'undefined')
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

type RecordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity, remediation?: string) => void;

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

async function collectFilesystemFallbackPacks(
  workspaceRoot: string,
  intent: string,
  version: LibrarianVersion,
): Promise<ContextPack[]> {
  const terms = tokenize(intent)
    .filter((term) => term.length >= 3 && !FILESYSTEM_FALLBACK_STOP_WORDS.has(term));
  if (terms.length === 0) return [];
  const seeksDeprioritizedPaths = terms.some((term) => FILESYSTEM_FALLBACK_DEPRIORITIZED_TERMS.has(term));

  const files = await glob(FILESYSTEM_FALLBACK_GLOB, {
    cwd: workspaceRoot,
    absolute: true,
    nodir: true,
    follow: false,
    ignore: ['**/__tests__/**', '**/*.test.*', '**/*.system.*', '**/*.d.ts'],
  }).catch(() => []);
  if (files.length === 0) return [];

  const scored = await Promise.all(files.map(async (absolutePath) => {
    const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
    const basename = path.basename(relativePath, path.extname(relativePath)).toLowerCase();
    const pathLower = relativePath.toLowerCase();
    let content = '';
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      return null;
    }

    const exports = extractExportNames(content);
    const exportTerms = new Set(exports.flatMap((name) => tokenize(name)));
    const contentLower = content.toLowerCase();
    let score = pathLower.startsWith('src/api/') ? 2 : 0;
    if (FILESYSTEM_FALLBACK_PREFERRED_PATH_SEGMENTS.test(pathLower)) {
      score += 2;
    }
    if (!seeksDeprioritizedPaths && FILESYSTEM_FALLBACK_DEPRIORITIZED_PATH_SEGMENTS.test(pathLower)) {
      score -= 18;
    }
    if (!seeksDeprioritizedPaths && /\b(dead code|legacy|deprecated|archived|obsolete)\b/u.test(contentLower)) {
      score -= 8;
    }
    const matchedTerms = new Set<string>();
    for (const term of terms) {
      let termScore = 0;
      if (exportTerms.has(term)) termScore = Math.max(termScore, 10);
      if (basename === term) termScore = Math.max(termScore, 12);
      if (basename.startsWith(term)) termScore = Math.max(termScore, 8);
      if (basename.includes(term)) termScore = Math.max(termScore, 5);
      if (pathLower.includes(`/${term}/`) || pathLower.includes(`_${term}`) || pathLower.includes(`${term}_`)) {
        termScore = Math.max(termScore, 4);
      }
      if (contentLower.includes(term)) {
        termScore = Math.max(termScore, 3);
      }
      if (termScore > 0) {
        score += termScore;
        matchedTerms.add(term);
      }
    }

    if (matchedTerms.size >= 2) {
      score += matchedTerms.size * 3;
    }
    if (score <= 0) return null;

    const snippet = buildFilesystemFallbackSnippet(relativePath, content, terms);
    return {
      relativePath,
      score,
      matchedTerms: Array.from(matchedTerms.values()),
      exports,
      snippet,
    };
  }));

  const ranked = scored
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) =>
      right.score - left.score
      || right.matchedTerms.length - left.matchedTerms.length
      || left.relativePath.localeCompare(right.relativePath)
    )
    .slice(0, FILESYSTEM_FALLBACK_LIMIT);
  const highestScore = ranked[0]?.score ?? 0;
  const lowestScore = ranked.at(-1)?.score ?? highestScore;
  const scoreSpread = Math.max(1, highestScore - lowestScore);

  return ranked
    .map((entry) => {
      const relativeScore = ranked.length === 1
        ? 0.75
        : (entry.score - lowestScore) / scoreSpread;
      const confidence = 0.45 + (relativeScore * 0.35);
      return {
      packId: `filesystem:${entry.relativePath}`,
      packType: 'module_context' as ContextPackType,
      targetId: `filesystem:${entry.relativePath}`,
      summary: `${entry.relativePath} matches ${entry.matchedTerms.join(', ')}`,
      keyFacts: [
        `File: ${entry.relativePath}`,
        `Matched terms: ${entry.matchedTerms.join(', ')}`,
        ...(entry.exports.length > 0 ? [`Exports: ${entry.exports.join(', ')}`] : []),
      ],
      codeSnippets: entry.snippet ? [entry.snippet] : [],
      relatedFiles: [entry.relativePath],
      confidence,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version,
      invalidationTriggers: [entry.relativePath],
      };
    });
}

function buildFilesystemFallbackSnippet(
  relativePath: string,
  content: string,
  terms: string[],
): ContextPack['codeSnippets'][number] | null {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return null;
  const lowerTerms = terms.map((term) => term.toLowerCase());
  let matchIndex = lines.findIndex((line) => lowerTerms.some((term) => line.toLowerCase().includes(term)));
  if (matchIndex < 0) {
    matchIndex = 0;
  }
  const startLine = Math.max(1, matchIndex - 2 + 1);
  const endLine = Math.min(lines.length, matchIndex + 3 + 1);
  return {
    filePath: relativePath,
    startLine,
    endLine,
    content: lines.slice(startLine - 1, endLine).join('\n'),
    language: getLanguageFromPath(relativePath, 'plaintext'),
  };
}

function extractExportNames(content: string): string[] {
  const matches = Array.from(content.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|type|interface)\s+([A-Za-z0-9_]+)/g));
  return matches.slice(0, 6).map((match) => match[1]);
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
          ...getSyntheticPackVersion(),
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
        ...getSyntheticPackVersion(),
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
  shouldShortCircuit?: boolean;
}

interface PathLookupStageResult {
  analyzed: boolean;
  packs: ContextPack[];
  explanation: string;
  shouldShortCircuit?: boolean;
}

const FEATURE_LOCATION_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  'with',
  'code',
  'module',
  'feature',
  'implementation',
  'implementations',
  'logic',
  'flow',
  'system',
]);

const FEATURE_LOCATION_SYNONYMS: Record<string, string[]> = {
  auth: ['auth', 'authentication', 'authorize', 'authorization', 'token', 'session'],
  routing: ['route', 'routes', 'router', 'routing', 'handler', 'handlers', 'endpoint', 'endpoints'],
  query: ['query', 'queries', 'retrieval', 'search'],
  bootstrap: ['bootstrap', 'index', 'indexing', 'semantic_indexing', 'semantic indexing'],
};

function isExcludedFeatureLocationPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (!normalized) return true;
  if (isEvalCorpusPath(normalized)) return true;
  return normalized.includes('/__tests__/')
    || normalized.startsWith('__tests__/')
    || normalized.includes('/test/')
    || normalized.includes('/tests/')
    || normalized.startsWith('test/')
    || normalized.startsWith('tests/')
    || normalized.includes('/fixtures/')
    || normalized.startsWith('fixtures/')
    || normalized.includes('/__fixtures__/')
    || normalized.startsWith('__fixtures__/')
    || normalized.includes('/node_modules/')
    || normalized.includes('/dist/')
    || normalized.includes('/build/')
    || normalized.endsWith('.test.ts')
    || normalized.endsWith('.test.tsx')
    || normalized.endsWith('.test.js')
    || normalized.endsWith('.spec.ts')
    || normalized.endsWith('.spec.tsx')
    || normalized.endsWith('.spec.js');
}

function buildFeatureLocationKeywordGroups(featureTarget: string): Array<{ label: string; aliases: string[] }> {
  const normalized = featureTarget
    .toLowerCase()
    .replace(/[_/.-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !FEATURE_LOCATION_STOP_WORDS.has(token));

  const tokens = normalized.length > 0 ? normalized : [featureTarget.toLowerCase()];
  return tokens.map((token) => {
    const aliases = new Set<string>([token]);
    for (const synonym of FEATURE_LOCATION_SYNONYMS[token] ?? []) {
      aliases.add(synonym);
    }
    if (token.endsWith('ing') && token.length > 4) {
      aliases.add(token.slice(0, -3));
    }
    return {
      label: token,
      aliases: Array.from(aliases).filter((alias) => alias.length >= 3),
    };
  });
}

function scoreFeatureLocationMatch(
  featureTarget: string,
  filePath: string,
  name: string,
  content: string,
  type: 'function' | 'module' | 'documentation'
): { relevance: number; matchedTerms: number; totalTerms: number; exactMatch: boolean } {
  const normalizedTarget = featureTarget.toLowerCase().replace(/[_/.-]+/g, ' ').trim();
  const normalizedPath = filePath.toLowerCase().replace(/[_/.-]+/g, ' ');
  const normalizedName = name.toLowerCase().replace(/[_/.-]+/g, ' ');
  const normalizedContent = content.toLowerCase().replace(/[_/.-]+/g, ' ');
  const groups = buildFeatureLocationKeywordGroups(featureTarget);
  const totalTerms = groups.length;
  const textBuckets = [normalizedPath, normalizedName, normalizedContent];
  let matchedTerms = 0;

  for (const group of groups) {
    if (group.aliases.some((alias) => textBuckets.some((bucket) => bucket.includes(alias)))) {
      matchedTerms += 1;
    }
  }

  const coverage = totalTerms > 0 ? matchedTerms / totalTerms : 0;
  const exactMatch = normalizedTarget.length > 0
    && (normalizedPath.includes(normalizedTarget)
      || normalizedName.includes(normalizedTarget)
      || normalizedContent.includes(normalizedTarget));

  let relevance = 0;
  if (exactMatch) {
    relevance = type === 'documentation' ? 0.62 : 0.92;
  } else if (matchedTerms > 0) {
    relevance = 0.28 + (coverage * 0.42);
    if (normalizedPath.includes(groups[0]?.label ?? '')) relevance += 0.12;
    if (normalizedName.includes(groups[0]?.label ?? '')) relevance += 0.1;
    if (normalizedContent.includes(groups[0]?.label ?? '')) relevance += 0.05;
    if (coverage < 1 && totalTerms > 1) relevance -= 0.1;
    if (type === 'documentation') relevance -= 0.12;
  }

  if (normalizedPath.startsWith('src/')) {
    relevance += 0.04;
  }

  if (normalizedTarget === 'query pipeline') {
    if (normalizedPath === 'src api query ts') {
      relevance += 0.18;
    }
    if (normalizedName.includes('querylibrarian') || normalizedContent.includes('getquerypipelinestages')) {
      relevance += 0.08;
    }
    if (normalizedPath.includes('embedding providers') && normalizedPath.includes('pipeline')) {
      relevance -= 0.22;
    }
  }

  return {
    relevance: Math.max(0, Math.min(0.98, relevance)),
    matchedTerms,
    totalTerms,
    exactMatch,
  };
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

  const locations: Array<{
    file: string;
    type: string;
    name: string;
    relevance: number;
    matchedTerms: number;
    totalTerms: number;
    exactMatch: boolean;
  }> = [];

  // Search in functions
  for (const item of functionItems) {
    const payload = item.payload as { path?: string; name?: string; content?: string } | null;
    const name = (payload?.name || '').toLowerCase();
    const filePath = payload?.path || item.id;
    if (isExcludedFeatureLocationPath(filePath)) {
      continue;
    }

    const scored = scoreFeatureLocationMatch(featureTarget, filePath, payload?.name || item.id, payload?.content || '', 'function');
    if (scored.relevance > 0) {
      locations.push({
        file: filePath,
        type: 'function',
        name: payload?.name || item.id,
        relevance: scored.relevance,
        matchedTerms: scored.matchedTerms,
        totalTerms: scored.totalTerms,
        exactMatch: scored.exactMatch,
      });
    }
  }

  // Search in modules
  for (const item of moduleItems) {
    const payload = item.payload as { path?: string; content?: string } | null;
    const filePath = payload?.path || item.id;
    if (isExcludedFeatureLocationPath(filePath)) {
      continue;
    }

    const scored = scoreFeatureLocationMatch(featureTarget, filePath, filePath, payload?.content || '', 'module');
    if (scored.relevance > 0) {
      locations.push({
        file: filePath,
        type: 'module',
        name: filePath,
        relevance: scored.relevance,
        matchedTerms: scored.matchedTerms,
        totalTerms: scored.totalTerms,
        exactMatch: scored.exactMatch,
      });
    }
  }

  // Search in documentation
  for (const item of docItems) {
    const payload = item.payload as { path?: string; content?: string } | null;
    const filePath = payload?.path || item.id;
    if (isExcludedFeatureLocationPath(filePath)) {
      continue;
    }

    const scored = scoreFeatureLocationMatch(featureTarget, filePath, filePath, payload?.content || '', 'documentation');
    if (scored.relevance > 0) {
      locations.push({
        file: filePath,
        type: 'documentation',
        name: filePath,
        relevance: scored.relevance,
        matchedTerms: scored.matchedTerms,
        totalTerms: scored.totalTerms,
        exactMatch: scored.exactMatch,
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
  const topLocation = locations[0];
  const hasExactCoverage = locations.some((location) => location.exactMatch || location.matchedTerms === location.totalTerms);
  const featureConfidence = topLocation.relevance >= 0.85
    ? 0.88
    : topLocation.relevance >= 0.7
      ? 0.74
      : 0.58;
  const { predictionId } = recordStagePrediction(
    'feature-location-stage',
    featureConfidence,
    `Located ${locations.length} implementation(s) for feature "${featureTarget}" (top relevance: ${(topLocation?.relevance * 100 || 0).toFixed(0)}%)`,
    { stageId: 'feature-location-stage', target: featureTarget, queryIntent: intent }
  );

  const summaryPack: ContextPack = {
    packId: `feature-location:${featureTarget}:${Date.now()}`,
    packType: 'decision_context',
    targetId: `feature:${featureTarget}`,
    summary: `Feature Location Results for "${featureTarget}":\n\n` +
      `Found ${locations.length} relevant locations:\n\n` +
      locations.slice(0, 10).map((loc, i) =>
        `${i + 1}. [${loc.type}] ${loc.name}\n   File: ${loc.file}\n   Relevance: ${(loc.relevance * 100).toFixed(0)}%\n   Keyword coverage: ${loc.matchedTerms}/${loc.totalTerms}`
      ).join('\n\n'),
    keyFacts: [
      `Feature: ${featureTarget}`,
      `Locations found: ${locations.length}`,
      `Primary location: ${topLocation?.file || 'unknown'}`,
      hasExactCoverage
        ? 'Matched full feature phrase coverage in at least one location.'
        : 'No exact multi-term match found; showing closest related implementations.',
      ...locations.slice(0, 3).map(l => `${l.type}: ${l.name}`),
    ],
    codeSnippets: [],
    relatedFiles: [...new Set(locations.map(l => l.file))].slice(0, 10),
    confidence: featureConfidence,
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
    explanation: hasExactCoverage
      ? `Feature location query detected: found ${locations.length} locations for "${featureTarget}".`
      : `Feature location query detected: no exact multi-term match for "${featureTarget}", returning closest related implementations.`,
    predictionId,
    shouldShortCircuit: topLocation.relevance >= 0.72,
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
  const graphMetrics = typeof (storage as LibrarianStorage & { getGraphMetrics?: unknown }).getGraphMetrics === 'function';
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
  const versionPrefix = `${buildQueryCacheVersionPrefix(options.version)}|`;
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

async function collectDirectPacks(
  storage: LibrarianStorage,
  query: LibrarianQuery,
  workspaceRoot: string,
): Promise<ContextPack[]> {
  const intent = query.intent ?? '';
  const inferredIntentPath = extractReferencedFilePath(query.intent ?? '');
  const inferredAnchorPaths = extractIntentAnchorPaths(intent);
  const anchorPaths = [...(query.affectedFiles ?? []), ...inferredAnchorPaths].slice(0, 12);
  const identifierAnchors = shouldInferIdentifierAnchors(intent)
    ? extractReferencedIdentifiers(intent)
    : [];
  const hasAnchors = Boolean(anchorPaths.length || inferredIntentPath);
  const hasStructuralFilter = Boolean(
    query.filter?.pathPrefix
    || query.filter?.language
    || typeof query.filter?.isPure === 'boolean'
  );
  if (!hasAnchors && !hasStructuralFilter && identifierAnchors.length === 0) return emptyArray<ContextPack>();
  const minConfidence = query.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const packs: ContextPack[] = [];
  const relatedFilesAny = new Set<string>();
  const indexedAnchorFiles = new Set<string>();
  const anchoredPaths = inferredIntentPath
    ? [inferredIntentPath, ...anchorPaths]
    : anchorPaths;
  for (const filePath of anchoredPaths) {
    indexedAnchorFiles.add(filePath);
    for (const candidate of expandPathCandidates(filePath, workspaceRoot)) {
      relatedFilesAny.add(candidate);
    }
  }
  if (inferredIntentPath && isBareFilenameAnchor(inferredIntentPath)) {
    try {
      const indexedFiles = await storage.getFiles();
      const bareFilename = inferredIntentPath.trim().toLowerCase();
      const bareFilenameMatches = indexedFiles
        .map((file) => file.path)
        .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)
        .filter((filePath) => path.basename(filePath).toLowerCase() === bareFilename);
      const selectedBareMatches = selectBareFilenameAnchorMatches(intent, bareFilenameMatches);
      for (const filePath of selectedBareMatches) {
        indexedAnchorFiles.add(filePath);
        for (const candidate of expandPathCandidates(filePath, workspaceRoot)) {
          relatedFilesAny.add(candidate);
        }
      }
    } catch {
      // Non-fatal: basename anchoring is best-effort for bare file mentions.
    }
  }
  if (identifierAnchors.length > 0) {
    for (const identifier of identifierAnchors) {
      try {
        const functions = await storage.getFunctionsByName(identifier);
        for (const fn of functions.slice(0, 8)) {
          if (!fn.filePath) continue;
          for (const candidate of expandPathCandidates(fn.filePath, workspaceRoot)) {
            relatedFilesAny.add(candidate);
          }
        }
      } catch {
        // Non-fatal: identifier anchoring is best-effort.
      }
    }
  }
  const anchoredByPath = anchoredPaths.length > 0;
  const directPackLimit = anchoredByPath ? 80 : 24;
  packs.push(...await storage.getContextPacks({
    minConfidence,
    limit: directPackLimit,
    relatedFilesAny: relatedFilesAny.size > 0 ? Array.from(relatedFilesAny) : undefined,
    relatedFilePrefix: query.filter?.pathPrefix,
    language: query.filter?.language,
    excludeTests: query.filter?.excludeTests,
  }));
  if (indexedAnchorFiles.size > 0) {
    packs.unshift(...await synthesizeAnchoredFileFallbackPacks(
      storage,
      intent,
      Array.from(indexedAnchorFiles),
    ));
  }
  const finalLimit = anchoredByPath ? 40 : 24;
  return dedupePacks(packs).slice(0, finalLimit);
}

function isBareFilenameAnchor(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.includes('/') && !trimmed.includes('\\');
}

function selectBareFilenameAnchorMatches(intent: string, filePaths: string[]): string[] {
  const uniquePaths = Array.from(new Set(
    filePaths
      .map((filePath) => filePath.trim())
      .filter((filePath) => filePath.length > 0)
  ));
  if (uniquePaths.length <= 1) {
    return uniquePaths;
  }
  if (!isAnchoredImplementationPlanningIntent(intent)) {
    return uniquePaths;
  }

  const ranked = uniquePaths
    .map((filePath) => ({
      filePath,
      score: scoreBareFilenameAnchorPath(intent, filePath),
    }))
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  return ranked.slice(0, 1).map((entry) => entry.filePath);
}

function scoreBareFilenameAnchorPath(intent: string, filePath: string): number {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const seamIntent = /\b(routing|retrieval|synthesis|intent|pipeline|orchestration)\b/i.test(intent);
  let score = 0;

  if (normalizedPath.includes('/src/api/')) score += 5;
  if (normalizedPath.includes('/src/cli/commands/')) score -= 2;
  if (normalizedPath.includes('/__tests__/') || normalizedPath.includes('.test.') || normalizedPath.includes('.spec.')) {
    score -= 4;
  }
  if (seamIntent && normalizedPath.includes('/src/api/')) score += 3;
  if (seamIntent && normalizedPath.includes('/src/cli/commands/')) score -= 2;
  if (seamIntent && /query(?:_synthesis|_intent|_result|_entry_point|_bias)/.test(normalizedPath)) score += 1;

  return score;
}

async function synthesizeAnchoredFileFallbackPacks(
  storage: LibrarianStorage,
  intent: string,
  filePaths: string[],
): Promise<ContextPack[]> {
  const storageWithPathLookups = storage as LibrarianStorage & {
    getModuleByPath?: LibrarianStorage['getModuleByPath'];
    getFunctionsByPath?: LibrarianStorage['getFunctionsByPath'];
    getFiles?: LibrarianStorage['getFiles'];
  };
  if (
    typeof storageWithPathLookups.getModuleByPath !== 'function'
    || typeof storageWithPathLookups.getFunctionsByPath !== 'function'
  ) {
    return [];
  }
  const moduleByPath = storageWithPathLookups.getModuleByPath.bind(storage);
  const functionsByPath = storageWithPathLookups.getFunctionsByPath.bind(storage);
  const indexedFiles = typeof storageWithPathLookups.getFiles === 'function'
    ? await storageWithPathLookups.getFiles().catch(() => [])
    : [];

  const uniquePaths = Array.from(new Set(
    filePaths
      .map((filePath) => filePath.trim())
      .filter((filePath) => filePath.length > 0)
  ));
  if (uniquePaths.length === 0) return [];

  const terms = tokenize(intent).filter((term) => !DIRECT_PACK_SCORE_STOP_WORDS.has(term));
  const scoredPacks: Array<{ pack: ContextPack; score: number }> = [];

  for (const filePath of uniquePaths.slice(0, 8)) {
    const moduleRecord = await moduleByPath(filePath).catch(() => null);
    const functions = await functionsByPath(filePath).catch(() => []);
    const fileRelevance = scoreTextRelevance(terms, {
      summary: moduleRecord?.purpose ?? '',
      highlights: functions.slice(0, 12).map((fn) => `${fn.name} ${fn.purpose}`.trim()),
      files: [filePath],
    });

    if (moduleRecord) {
      const topFunctions = functions
        .slice()
        .sort((left, right) =>
          scoreAnchoredFunctionCandidate(right, terms) - scoreAnchoredFunctionCandidate(left, terms)
          || ((right.endLine - right.startLine) - (left.endLine - left.startLine))
        )
        .slice(0, 5)
        .map((fn) => fn.name);
      const keyFacts: string[] = [];
      if (moduleRecord.purpose) keyFacts.push(`Purpose: ${moduleRecord.purpose}`);
      if (topFunctions.length > 0) keyFacts.push(`Top-level routines: ${topFunctions.join(', ')}`);
      const adjacentModules = findAdjacentImplementationModules(filePath, indexedFiles, intent);
      if (adjacentModules.length > 0) keyFacts.push(`Adjacent modules: ${adjacentModules.join(', ')}`);
      if (moduleRecord.exports.length > 0) keyFacts.push(`Exports: ${moduleRecord.exports.slice(0, 6).join(', ')}`);
      appendPipelineStageFacts(keyFacts, filePath, moduleRecord.exports);
      if (moduleRecord.dependencies.length > 0) keyFacts.push(`Dependencies: ${moduleRecord.dependencies.slice(0, 6).join(', ')}`);
      const pack: ContextPack = {
        packId: `anchor_mod_${moduleRecord.id.slice(0, 12)}`,
        packType: 'module_context',
        targetId: moduleRecord.id,
        summary: moduleRecord.purpose || `Module ${filePath}`,
        keyFacts,
        codeSnippets: [],
        relatedFiles: [filePath],
        confidence: Math.max(moduleRecord.confidence ?? 0.45, 0.45),
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: getSyntheticPackVersion(),
        invalidationTriggers: [filePath],
      };
      scoredPacks.push({
        pack,
        score: scoreAnchoredDirectPack(pack, intent) + Math.min(0.25, fileRelevance * 0.04),
      });
    }

    for (const fn of functions
      .slice()
      .sort((left, right) =>
        scoreAnchoredFunctionCandidate(right, terms) - scoreAnchoredFunctionCandidate(left, terms)
        || ((right.endLine - right.startLine) - (left.endLine - left.startLine))
      )
      .slice(0, 2)) {
      const lineCount = Math.max(0, (fn.endLine ?? 0) - (fn.startLine ?? 0));
      const keyFacts: string[] = [];
      if (fn.signature) keyFacts.push(`Signature: ${fn.signature}`);
      if (fn.purpose) keyFacts.push(fn.purpose);
      if (lineCount > 0) keyFacts.push(`${lineCount} lines (L${fn.startLine}–L${fn.endLine})`);
      const pack: ContextPack = {
        packId: `anchor_fn_${fn.id.slice(0, 12)}`,
        packType: 'function_context',
        targetId: fn.id,
        summary: `${fn.name} in ${filePath.split('/').slice(-2).join('/')}${fn.purpose ? `: ${fn.purpose}` : ''}`,
        keyFacts,
        codeSnippets: [],
        relatedFiles: [filePath],
        confidence: Math.max(fn.confidence ?? 0.4, 0.4),
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: getSyntheticPackVersion(),
        invalidationTriggers: [filePath],
      };
      scoredPacks.push({
        pack,
        score: scoreAnchoredDirectPack(pack, intent) + Math.min(0.25, fileRelevance * 0.04),
      });
    }
  }

  return scoredPacks
    .sort((left, right) => right.score - left.score || right.pack.confidence - left.pack.confidence)
    .map((entry) => entry.pack)
    .slice(0, 6);
}

function findAdjacentImplementationModules(
  filePath: string,
  indexedFiles: Array<{ path: string }>,
  intent: string,
): string[] {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const directory = path.posix.dirname(normalizedPath);
  const ext = path.posix.extname(normalizedPath);
  const stem = path.posix.basename(normalizedPath, ext);
  if (!directory || !stem || indexedFiles.length === 0) return [];

  return indexedFiles
    .map((entry) => entry.path)
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => candidate.replace(/\\/g, '/'))
    .filter((candidate) => candidate !== normalizedPath)
    .filter((candidate) => path.posix.dirname(candidate) === directory)
    .filter((candidate) => path.posix.extname(candidate) === ext)
    .filter((candidate) => path.posix.basename(candidate, ext).startsWith(`${stem}_`))
    .filter((candidate) => !candidate.includes('/__tests__/') && !candidate.includes('.test.') && !candidate.includes('.spec.'))
    .sort((left, right) =>
      scoreAdjacentImplementationModule(intent, right) - scoreAdjacentImplementationModule(intent, left)
      || left.localeCompare(right)
    )
    .slice(0, 4);
}

function scoreAdjacentImplementationModule(intent: string, filePath: string): number {
  const normalizedIntent = intent.toLowerCase();
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const mixedSeamPlanningIntent =
    /\b(split|extract|separate|decompose)\b/.test(normalizedIntent)
    && ['routing', 'retrieval', 'synthesis'].filter((seam) => new RegExp(`\\b${seam}\\b`).test(normalizedIntent)).length >= 3;
  let score = 0;

  if (/\bsynthesis\b/.test(normalizedIntent) && normalizedPath.includes('query_synthesis')) score += 6;
  if (/\brouting\b/.test(normalizedIntent) && /\bquery_intent|bias|routing\b/.test(normalizedPath)) score += 5;
  if (/\bretrieval\b/.test(normalizedIntent) && /\bresult|candidate|retrieval\b/.test(normalizedPath)) score += 4;
  if (normalizedPath.includes('query_intent')) score += 2;
  if (normalizedPath.includes('query_result')) score += 2;
  if (normalizedPath.includes('query_candidate')) score += 1;
  if (normalizedPath.includes('query_cache')) score -= 3;
  if (mixedSeamPlanningIntent) {
    if (normalizedPath.includes('query_synthesis')) score += 6;
    if (normalizedPath.includes('query_intent_routing_overrides')) score += 2;
    if (normalizedPath.includes('query_result_biasing')) score += 2;
    if (normalizedPath.includes('query_candidate_merge')) score += 2;
    if (normalizedPath.includes('query_intent_patterns')) score -= 2;
    if (normalizedPath.includes('query_intent_targets')) score -= 1;
    if (normalizedPath.includes('query_intent_bias_profile')) score -= 1;
  }

  return score;
}

function shouldShortCircuitStructuralCallerQuery(
  structuralIntent: StructuralQueryIntent,
  dependencyQueryResult: DependencyQueryResult,
): boolean {
  return structuralIntent.direction === 'dependents'
    && structuralIntent.edgeTypes.length === 1
    && structuralIntent.edgeTypes[0] === 'calls'
    && dependencyQueryResult.results.length > 0;
}

function buildStructuralCallerPack(
  dependencyQueryResult: DependencyQueryResult,
  version: LibrarianVersion,
  workspaceRoot: string,
): ContextPack {
  const targetLabel = dependencyQueryResult.intent.targetEntity
    ?? dependencyQueryResult.targetResolution.resolvedPath
    ?? dependencyQueryResult.targetResolution.resolvedEntityId
    ?? 'target';
  const shortTargetLabel = formatCallerEntityLabel(targetLabel);
  const locations = dependencyQueryResult.results
    .filter((dep) => typeof dep.sourceFile === 'string' && dep.sourceFile.length > 0)
    .map((dep) => ({
      label: formatCallerLocation(dep, workspaceRoot),
      file: relativizeCallerPath(dep.sourceFile, workspaceRoot),
    }));
  const uniqueLocations = Array.from(new Set(locations.map((entry) => entry.label))).slice(0, 5);
  const uniqueFiles = Array.from(new Set(locations.map((entry) => entry.file))).filter((file) => file.length > 0).slice(0, 10);
  const moreCount = Math.max(0, dependencyQueryResult.results.length - uniqueLocations.length);
  const summary = uniqueLocations.length > 0
    ? `${shortTargetLabel} is called from ${uniqueLocations.join(', ')}${moreCount > 0 ? ` and ${moreCount} more indexed caller${moreCount === 1 ? '' : 's'}` : ''}.`
    : `${shortTargetLabel} has ${dependencyQueryResult.results.length} indexed caller${dependencyQueryResult.results.length === 1 ? '' : 's'}.`;

  return {
    packId: `caller-probe:${shortTargetLabel}`,
    packType: 'call_flow',
    targetId: dependencyQueryResult.targetResolution.resolvedEntityId
      ?? dependencyQueryResult.targetResolution.resolvedPath
      ?? shortTargetLabel,
    summary,
    keyFacts: [
      `Target: ${shortTargetLabel}`,
      `Indexed callers: ${dependencyQueryResult.results.length}`,
      ...uniqueLocations.map((location) => `Caller location: ${location}`),
    ],
    codeSnippets: dependencyQueryResult.results.slice(0, 5).map((dep) => ({
      filePath: relativizeCallerPath(dep.sourceFile, workspaceRoot),
      startLine: dep.sourceLine ?? 1,
      endLine: dep.sourceLine ?? 1,
      content: `${formatCallerEntityLabel(dep.entityId)} -> ${shortTargetLabel}()`,
      language: 'typescript',
    })),
    relatedFiles: uniqueFiles,
    confidence: 0.95,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: uniqueFiles,
  };
}

function formatCallerLocation(dep: ResolvedDependency, workspaceRoot: string): string {
  const file = relativizeCallerPath(dep.sourceFile, workspaceRoot);
  return dep.sourceLine && dep.sourceLine > 0 ? `${file}:${dep.sourceLine}` : file;
}

function relativizeCallerPath(filePath: string, workspaceRoot: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedRoot.length > 0 && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

function formatCallerEntityLabel(entityId: string): string {
  const normalized = entityId.replace(/\\/g, '/');
  const byFragment = normalized.split(/[#:/]/).filter(Boolean);
  return byFragment[byFragment.length - 1] ?? normalized;
}

function scoreAnchoredFunctionCandidate(
  fn: { name: string; purpose: string; startLine: number; endLine: number },
  terms: string[],
): number {
  const haystack = `${fn.name} ${fn.purpose}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length >= 7 ? 3 : 2;
  }
  score += Math.min(2, Math.max(0, (fn.endLine - fn.startLine) / 200));
  return score;
}

async function runPathLookupStage(options: {
  storage: LibrarianStorage;
  intent: string;
  pathTarget: string;
  workspaceRoot: string;
  depth: LibrarianQuery['depth'];
  filter?: LibrarianQuery['filter'];
  minConfidence?: number;
}): Promise<PathLookupStageResult> {
  const { storage, intent, pathTarget, workspaceRoot, depth, filter, minConfidence } = options;
  const normalizedCandidates = new Set(
    expandPathCandidates(pathTarget, workspaceRoot).map((candidate) => candidate.replace(/\\/g, '/')),
  );
  const packs = await collectDirectPacks(
    storage,
    {
      intent,
      depth,
      affectedFiles: [pathTarget],
      filter,
      minConfidence,
    },
    workspaceRoot,
  );

  if (packs.length === 0) {
    return {
      analyzed: false,
      packs: [],
      explanation: `Path query detected: no indexed context found for "${pathTarget}".`,
    };
  }

  const exactPacks = packs.filter((pack) =>
    pack.relatedFiles.some((file) => normalizedCandidates.has(file.replace(/\\/g, '/'))),
  );
  const orderedPacks = exactPacks.length > 0 ? dedupePacks([...exactPacks, ...packs]) : packs;

  return {
    analyzed: true,
    packs: orderedPacks,
    explanation: exactPacks.length > 0
      ? `Path query detected: found ${exactPacks.length} exact context pack(s) for "${pathTarget}".`
      : `Path query detected: found ${packs.length} context pack(s) anchored to "${pathTarget}".`,
    shouldShortCircuit: exactPacks.length > 0,
  };
}

function shouldInferIdentifierAnchors(intent: string): boolean {
  const normalized = intent.toLowerCase();
  if (!normalized.trim()) return false;
  return normalized.startsWith('where is')
    || normalized.startsWith('where are')
    || /\b(callers?|called\s+by|who\s+calls?|what\s+calls?)\b/.test(normalized);
}

function extractReferencedIdentifiers(intent: string): string[] {
  const stopWords = new Set([
    'where', 'is', 'are', 'the', 'this', 'that', 'which', 'what', 'who', 'how',
    'function', 'functions', 'method', 'methods', 'implemented', 'implementation',
    'defined', 'definition', 'called', 'calls', 'caller', 'callers', 'pipeline',
    'core', 'code', 'repository', 'in', 'of', 'to', 'for', 'and', 'or',
  ]);
  const identifiers = new Set<string>();
  const add = (value: string): void => {
    const token = value.trim().replace(/[()]/g, '');
    if (token.length < 3) return;
    if (stopWords.has(token.toLowerCase())) return;
    identifiers.add(token);
  };

  for (const match of intent.matchAll(/[`'"]([A-Za-z_][A-Za-z0-9_]*)[`'"]/g)) {
    add(match[1]);
  }
  for (const match of intent.matchAll(/\b(?:function|method|symbol)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)) {
    add(match[1]);
  }
  for (const match of intent.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g)) {
    const token = match[1];
    if (/[A-Z]/.test(token) || token.includes('_')) {
      add(token);
    }
  }
  return Array.from(identifiers).slice(0, 6);
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

function scoreAnchoredDirectPack(pack: ContextPack, intent: string): number {
  const terms = tokenize(intent).filter((term) => !DIRECT_PACK_SCORE_STOP_WORDS.has(term));
  if (terms.length === 0) return DIRECT_PACK_SCORE_BASE;

  const relevance = scoreTextRelevance(terms, {
    summary: pack.summary,
    highlights: pack.keyFacts,
    files: pack.relatedFiles,
  });
  const normalizedRelevance = Math.min(1, relevance / Math.max(3, Math.min(terms.length, 8)));
  let score = DIRECT_PACK_SCORE_BASE + (normalizedRelevance * 0.16);

  if (pack.packType === 'function_context' && relevance > 0) {
    score += 0.04;
  }
  if (pack.packType === 'module_context' && relevance === 0) {
    score -= 0.02;
  }

  return Math.max(CANDIDATE_SCORE_FLOOR, Math.min(DIRECT_PACK_SCORE_MAX, score));
}

function selectPriorityDirectPacks(
  directPacks: ContextPack[],
  intent: string,
  limit: number,
): ContextPack[] {
  if (directPacks.length === 0 || !intent.trim()) return [];

  const bestByFile = new Map<string, { pack: ContextPack; score: number }>();
  for (const pack of directPacks) {
    const primaryFile = pack.relatedFiles[0] ?? pack.targetId;
    const score = scoreAnchoredDirectPack(pack, intent);
    const current = bestByFile.get(primaryFile);
    if (!current || score > current.score) {
      bestByFile.set(primaryFile, { pack, score });
    }
  }

  return Array.from(bestByFile.values())
    .sort((left, right) =>
      right.score - left.score
      || (right.pack.confidence - left.pack.confidence)
      || left.pack.packId.localeCompare(right.pack.packId)
    )
    .map((entry) => entry.pack)
    .slice(0, Math.min(3, limit));
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
/**
 * Inject candidates whose file names match query terms.
 * Semantic search may miss files whose code content doesn't embed well for
 * natural language queries. This step ensures files like "query.ts" appear
 * in the candidate pool when the user asks about "query pipeline".
 */
async function injectFilenameCandidates(
  intent: string,
  existingCandidates: Candidate[],
  storage: LibrarianStorage,
  explicitPaths: string[] = [],
): Promise<{ candidates: Candidate[]; added: number }> {
  const stopWords = new Set([
    'the', 'how', 'does', 'what', 'work', 'and', 'this', 'that', 'with', 'for', 'from', 'into',
    'are', 'is', 'where', 'implemented', 'defined', 'located', 'handled', 'across', 'codebase',
    'stage', 'stages', 'feature', 'files', 'file', 'its',
  ]);
  const terms = Array.from(new Set(
    intent.toLowerCase().split(/\s+/)
      .filter(t => t.length >= 3 && !stopWords.has(t))
      .flatMap((term) => term.endsWith('s') && term.length > 4 ? [term, term.slice(0, -1)] : [term])
  ));
  if (terms.length === 0) return { candidates: existingCandidates, added: 0 };

  const existingIds = new Set(existingCandidates.map(c => c.entityId));
  const existingPaths = new Set(existingCandidates.map(c => c.path).filter(Boolean));
  const injected: Candidate[] = [];
  const normalizedExplicitPaths = new Set(
    explicitPaths
      .map((entry) => entry.replace(/\\/g, '/').trim().toLowerCase())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => entry.endsWith('.ts') ? [entry, entry.replace(/\.ts$/, '.js')] : [entry])
  );

  try {
    // Get all indexed files (lightweight: typically < 3000 entries)
    const allFiles = await storage.getFiles();
    // Score files by how well they match query terms, then take the best matches
    type ScoredFile = { path: string; score: number };
    const scoredFiles: ScoredFile[] = [];
    for (const file of allFiles) {
      const basename = (file.path ?? '').split('/').pop()?.replace(/\.\w+$/, '').toLowerCase() ?? '';
      const pathLower = (file.path ?? '').toLowerCase();
      // Skip test files and already-present paths
      if (pathLower.includes('__tests__') || pathLower.includes('.test.') || pathLower.includes('.spec.')) continue;
      if (existingPaths.has(file.path)) continue;

      // Accumulate scores across ALL matching terms (not just best single term).
      // A file matching 2+ query terms should rank above one matching only 1.
      let totalScore = 0;
      let matchedTerms = 0;
      if (normalizedExplicitPaths.has(pathLower)) {
        totalScore = Math.max(totalScore, 80);
      }
      for (const term of terms) {
        // Check ALL match types and take the best score for this term.
        // The previous if/else chain could miss a high-scoring directory match
        // when a low-scoring basename match was found first (e.g., sqlite_storage
        // in /storage/ directory: basename-includes=3 masked directory-match=5).
        let termScore = 0;
        // Exact basename match (e.g., "query" → "query.ts") — best signal
        if (basename === term) {
          termScore = Math.max(termScore, 10);
        }
        // Basename starts with term (e.g., "query" → "query_intent_patterns.ts")
        if (basename.startsWith(term)) {
          termScore = Math.max(termScore, 7);
        }
        // Basename contains term
        if (basename.includes(term)) {
          termScore = Math.max(termScore, 3);
        }
        // Directory contains term (e.g., "storage" → "/storage/foo.ts")
        const dirMatch = pathLower.includes(`/${term}/`) || pathLower.includes(`/${term}_`) || pathLower.includes(`_${term}/`) || pathLower.includes(`_${term}.`);
        if (dirMatch) {
          termScore = Math.max(termScore, 5);
        }
        // Bonus: term appears in both basename AND directory (e.g., sqlite_storage in /storage/)
        if (dirMatch && basename.includes(term)) {
          termScore += 3;
        }
        if (termScore > 0) {
          totalScore += termScore;
          matchedTerms++;
        }
      }
      // Bonus for matching multiple query terms (strong relevance signal)
      if (matchedTerms >= 2) totalScore += matchedTerms * 3;
      // Prefer src/ over scripts/, tests, docs, etc.
      if (totalScore > 0) {
        if (pathLower.includes('/src/')) totalScore += 2;
        if (pathLower.includes('/scripts/')) totalScore -= 1;
        scoredFiles.push({ path: file.path, score: totalScore });
      }
    }
    // Sort by score descending, take top matches
    scoredFiles.sort((a, b) => b.score - a.score);
    const matchingPaths = scoredFiles.slice(0, 8).map(f => f.path);

    // Get functions from matching files and inject as candidates
    for (const filePath of matchingPaths) {
      const moduleRecord = await storage.getModuleByPath(filePath).catch(() => null);
      if (moduleRecord && !existingIds.has(moduleRecord.id)) {
        injected.push({
          entityId: moduleRecord.id,
          entityType: 'module',
          path: moduleRecord.path,
          semanticSimilarity: 0.52,
          confidence: moduleRecord.confidence ?? 0.6,
          recency: 0.5,
          pagerank: 0,
          centrality: 0,
          communityId: null,
        });
        existingIds.add(moduleRecord.id);
      }
      const fns = await storage.getFunctionsByPath(filePath);
      // Prefer functions whose names match query terms (most relevant to the question),
      // then fall back to the longest function (likely the main export)
      const fnScored = fns.map(fn => {
        const fnName = (fn.name ?? '').toLowerCase();
        let nameScore = 0;
        for (const term of terms) {
          if (fnName.includes(term)) nameScore += 5;
        }
        return { fn, nameScore, size: (fn.endLine - fn.startLine) || 0 };
      });
      fnScored.sort((a, b) => (b.nameScore - a.nameScore) || (b.size - a.size));
      const topFn = fnScored[0]?.fn;
      if (topFn && !existingIds.has(topFn.id)) {
        injected.push({
          entityId: topFn.id,
          entityType: 'function',
          path: topFn.filePath,
          semanticSimilarity: 0.40,
          confidence: topFn.confidence ?? 0.5,
          recency: 0.5,
          pagerank: 0,
          centrality: 0,
          communityId: null,
        });
        existingIds.add(topFn.id);
      }
      if (injected.length >= 6) break;
    }
  } catch {
    // Non-fatal: continue without filename injection
  }

  if (injected.length === 0) return { candidates: existingCandidates, added: 0 };
  return { candidates: [...existingCandidates, ...injected], added: injected.length };
}

async function hydrateCandidates(results: SimilarityResult[], storage: LibrarianStorage): Promise<Candidate[]> {
  return Promise.all(results.map(async (result) => {
    // Map embeddable entity type to graph entity type
    const graphEntityType = result.entityType === 'document' ? 'file' : result.entityType;
    const stats = await getEntityStats(result.entityId, result.entityType, storage, result.similarity);
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

function inferQueryAccessEntityType(pack: ContextPack): QueryAccessLogEntry['entityType'] | null {
  if (pack.packType === 'module_context' || pack.packType === 'project_understanding') {
    return 'module';
  }
  return 'function';
}

function buildQueryAccessLogEntries(packs: ContextPack[], timestamp: string): QueryAccessLogEntry[] {
  const counts = new Map<string, QueryAccessLogEntry>();
  for (const pack of packs) {
    if (typeof pack.targetId !== 'string' || pack.targetId.trim().length === 0) continue;
    const entityType = inferQueryAccessEntityType(pack);
    if (!entityType) continue;
    const key = `${entityType}:${pack.targetId}`;
    const existing = counts.get(key);
    if (existing) {
      existing.queryCount += 1;
      continue;
    }
    counts.set(key, {
      entityId: pack.targetId,
      entityType,
      lastQueriedAt: timestamp,
      queryCount: 1,
    });
  }
  return Array.from(counts.values());
}

async function recordQueryAccessLogsForPacks(
  storage: LibrarianStorage,
  packs: ContextPack[],
  timestamp: string,
): Promise<void> {
  if (typeof storage.recordQueryAccessLogs !== 'function') return;
  const entries = buildQueryAccessLogEntries(packs, timestamp);
  if (entries.length === 0) return;
  try {
    await storage.recordQueryAccessLogs(entries);
  } catch {
    // Access logging must never break query execution.
  }
}

function isPathWithinWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  if (!candidatePath) return false;
  const trimmed = candidatePath.trim();
  if (!trimmed) return false;
  const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceRoot, trimmed);
  const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  return relative !== '' && relative !== '.' && !relative.startsWith('..');
}

function filterPacksToWorkspace(
  packs: ContextPack[],
  workspaceRoot: string,
): { packs: ContextPack[]; dropped: number } {
  if (!workspaceRoot.trim()) return { packs, dropped: 0 };
  const kept: ContextPack[] = [];
  let dropped = 0;
  for (const pack of packs) {
    const relatedFiles = Array.isArray(pack.relatedFiles)
      ? pack.relatedFiles.filter((file): file is string => typeof file === 'string' && file.trim().length > 0)
      : [];
    if (relatedFiles.length === 0) {
      kept.push(pack);
      continue;
    }
    const hasWorkspaceScopedFile = relatedFiles.some((file) => isPathWithinWorkspace(file, workspaceRoot));
    if (hasWorkspaceScopedFile) {
      kept.push(pack);
    } else {
      dropped += 1;
    }
  }
  return { packs: kept, dropped };
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
    let foundPack = false;
    for (const packType of packTypes) {
      let pack = await storage.getContextPackForTarget(candidate.entityId, packType);
      // Fallback 1: try filepath:functionName format (context packs use this as target_id
      // while embeddings use UUIDs as entity_id)
      if (!pack && candidate.entityType === 'function' && candidate.path) {
        try {
          const fn = await storage.getFunction(candidate.entityId);
          if (fn?.name) {
            const compositeTarget = `${candidate.path}:${fn.name}`;
            pack = await storage.getContextPackForTarget(compositeTarget, packType);
          }
        } catch {
          // Non-fatal: proceed to next fallback
        }
      }
      // Fallback 2: if no pack found by entityId or composite target, try lookup by relatedFile
      if (!pack && candidate.path) {
        const fallbackPacks = await storage.getContextPacks({ relatedFile: candidate.path, packType, limit: 1 });
        if (fallbackPacks.length > 0) pack = fallbackPacks[0];
      }
      if (pack) { packs.push(pack); foundPack = true; }
    }
    // JIT synthesis: if no pre-existing pack found for a function candidate, synthesize one
    // from function metadata so candidates from filename injection / semantic search
    // aren't silently dropped
    if (!foundPack && candidate.entityType === 'function') {
      const jitPack = await synthesizeFunctionPack(storage, candidate);
      if (jitPack) packs.push(jitPack);
    }
    if (!foundPack && candidate.entityType === 'module') {
      const jitPack = await synthesizeModulePack(storage, candidate);
      if (jitPack) packs.push(jitPack);
    }
  }
  return dedupePacks(packs);
}

/**
 * JIT pack synthesis: creates a minimal function_context pack from function metadata.
 * This ensures candidates found by filename injection or semantic search produce results
 * even when bootstrap didn't generate packs for them (common when only ~20% of functions
 * get packs during context_pack_generation phase).
 */
async function synthesizeFunctionPack(storage: LibrarianStorage, candidate: Candidate): Promise<ContextPack | null> {
  try {
    const fn = await storage.getFunction(candidate.entityId);
    if (!fn) return null;
    const lineCount = (fn.endLine ?? 0) - (fn.startLine ?? 0);
    const keyFacts: string[] = [];
    if (fn.signature) keyFacts.push(`Signature: ${fn.signature}`);
    if (fn.purpose) keyFacts.push(fn.purpose);
    if (lineCount > 0) keyFacts.push(`${lineCount} lines (L${fn.startLine}–L${fn.endLine})`);
    const filePath = fn.filePath || candidate.path || '';
    return {
      packId: `jit_${candidate.entityId.slice(0, 12)}`,
      packType: 'function_context' as ContextPackType,
      targetId: candidate.entityId,
      summary: `${fn.name} in ${filePath.split('/').slice(-2).join('/')}${fn.purpose ? ': ' + fn.purpose : ''}`,
      keyFacts,
      codeSnippets: [],
      relatedFiles: filePath ? [filePath] : [],
      confidence: Math.max(0.3, candidate.confidence * 0.8), // slightly lower than stored packs
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: getSyntheticPackVersion(),
      invalidationTriggers: filePath ? [filePath] : [],
    };
  } catch {
    return null;
  }
}

async function synthesizeModulePack(storage: LibrarianStorage, candidate: Candidate): Promise<ContextPack | null> {
  try {
    const mod = await storage.getModule(candidate.entityId);
    if (!mod) return null;
    const filePath = mod.path || candidate.path || '';
    const functions = filePath ? await storage.getFunctionsByPath(filePath).catch(() => []) : [];
    const topFunctions = functions
      .slice()
      .sort((left, right) => (right.endLine - right.startLine) - (left.endLine - left.startLine))
      .slice(0, 5)
      .map((fn) => fn.name);
    const snippet = await readModuleSnippet(storage, filePath);
    const keyFacts: string[] = [];
    if (mod.purpose) keyFacts.push(`Purpose: ${mod.purpose}`);
    if (topFunctions.length > 0) keyFacts.push(`Top-level routines: ${topFunctions.join(', ')}`);
    if (mod.exports.length > 0) keyFacts.push(`Exports: ${mod.exports.slice(0, 6).join(', ')}`);
    appendPipelineStageFacts(keyFacts, filePath, mod.exports);
    if (mod.dependencies.length > 0) keyFacts.push(`Dependencies: ${mod.dependencies.slice(0, 6).join(', ')}`);

    return {
      packId: `jit_mod_${candidate.entityId.slice(0, 12)}`,
      packType: 'module_context' as ContextPackType,
      targetId: candidate.entityId,
      summary: mod.purpose || `Module ${filePath || candidate.entityId}`,
      keyFacts,
      codeSnippets: snippet ? [snippet] : [],
      relatedFiles: filePath ? [filePath] : [],
      confidence: Math.max(mod.confidence ?? 0.5, candidate.confidence ?? 0.5),
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: await storage.getVersion() || getSyntheticPackVersion(),
      invalidationTriggers: filePath ? [filePath] : [],
    };
  } catch {
    return null;
  }
}

async function readModuleSnippet(
  storage: LibrarianStorage,
  filePath: string,
): Promise<ContextPack['codeSnippets'][number] | null> {
  if (!filePath) return null;

  try {
    const metadata = await storage.getMetadata().catch(() => null);
    const workspaceRoot = metadata?.workspace ?? process.cwd();
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split(/\r?\n/).slice(0, 40);
    if (lines.length === 0) return null;
    return {
      filePath,
      startLine: 1,
      endLine: lines.length,
      content: lines.join('\n'),
      language: getLanguageFromFilePath(filePath),
    };
  } catch {
    return null;
  }
}

function getLanguageFromFilePath(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return 'javascript';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  if (filePath.endsWith('.go')) return 'go';
  return 'text';
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
      ...getSyntheticPackVersion(),
      indexedAt: new Date(item.ingestedAt),
    },
    invalidationTriggers: [payload.path],
  };

  return pack;
}
type QueryCacheEligibility = {
  allowCache: boolean;
  reason?: string;
};

const QUERY_CACHE_DRIFT_EXCLUDED_DIRS = new Set([
  '.git',
  '.librarian',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'state',
  '.claude',
  '.codex',
]);

const QUERY_CACHE_DRIFT_EXCLUDED_EXTENSIONS = new Set([
  '.cpuprofile',
  '.tgz',
  '.tar',
  '.gz',
  '.zip',
]);

const QUERY_CACHE_DRIFT_EXTENSIONLESS_ALLOWLIST = [
  /^dockerfile(?:\..+)?$/i,
  /^makefile$/i,
  /^readme$/i,
  /^license$/i,
  /^changelog$/i,
  /^agents$/i,
  /^claude$/i,
  /^codex$/i,
];

type QueryCacheEligibilityDeps = {
  getWatchStateFn?: typeof getWatchState;
  getCurrentGitShaFn?: typeof getCurrentGitSha;
  getGitStatusChangesFn?: typeof getGitStatusChanges;
  isGitRepoFn?: typeof isGitRepo;
  createStalenessTrackerFn?: typeof createStalenessTracker;
};

async function resolveQueryCacheEligibility(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  indexState: IndexState;
  workspaceRoot: string;
  deps?: QueryCacheEligibilityDeps;
}): Promise<QueryCacheEligibility> {
  const { storage, query, indexState, workspaceRoot, deps } = options;
  if (!isReadyPhase(indexState.phase) || query.disableCache === true) {
    return { allowCache: false };
  }

  const getWatchStateFn = deps?.getWatchStateFn ?? getWatchState;
  const getCurrentGitShaFn = deps?.getCurrentGitShaFn ?? getCurrentGitSha;
  const getGitStatusChangesFn = deps?.getGitStatusChangesFn ?? getGitStatusChanges;
  const isGitRepoFn = deps?.isGitRepoFn ?? isGitRepo;
  const createStalenessTrackerFn = deps?.createStalenessTrackerFn ?? createStalenessTracker;

  try {
    const watchState = await getWatchStateFn(storage);
    if (watchState?.needs_catchup) {
      return {
        allowCache: false,
        reason: 'watch freshness requires catch-up',
      };
    }
    if (watchState?.cursor?.kind === 'git') {
      const headSha = getCurrentGitShaFn(workspaceRoot);
      if (headSha && watchState.cursor.lastIndexedCommitSha && headSha !== watchState.cursor.lastIndexedCommitSha) {
        return {
          allowCache: false,
          reason: 'indexed git cursor lags current HEAD',
        };
      }
    }
  } catch {
    // Ignore watch-state lookup failures when deciding cache eligibility.
  }

  if (!isGitRepoFn(workspaceRoot)) {
    return { allowCache: true };
  }

  try {
    const changes = await getGitStatusChangesFn(workspaceRoot);
    if (!changes) {
      return { allowCache: true };
    }
    const changedPaths = dedupePathsForCacheEligibility([
      ...changes.added,
      ...changes.modified,
      ...changes.deleted,
    ])
      .filter((relativePath) => isRelevantCacheDriftPath(relativePath))
      .map((relativePath) => path.resolve(workspaceRoot, relativePath));

    if (changedPaths.length === 0) {
      return { allowCache: true };
    }

    const tracker = createStalenessTrackerFn(storage);
    const changedStatuses = await tracker.checkFiles(changedPaths);
    const staleFiles = changedStatuses.filter((status) => status.status === 'stale').length;
    const missingFiles = changedStatuses.filter((status) => status.status === 'missing').length;
    const newFiles = changedStatuses.filter((status) => status.status === 'new').length;
    const driftCount = staleFiles + missingFiles + newFiles;
    if (driftCount > 0) {
      return {
        allowCache: false,
        reason: `workspace drift detected (${staleFiles} stale, ${missingFiles} missing, ${newFiles} new)`,
      };
    }
  } catch {
    // Ignore git/staleness lookup failures and preserve cache eligibility.
  }

  return { allowCache: true };
}

function dedupePathsForCacheEligibility(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of paths) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped;
}

function isRelevantCacheDriftPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').trim();
  if (!normalized || normalized.endsWith('/')) {
    return false;
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => QUERY_CACHE_DRIFT_EXCLUDED_DIRS.has(part))) {
    return false;
  }

  const baseName = parts[parts.length - 1] ?? normalized;
  const extension = path.extname(baseName).toLowerCase();
  const allowlistedExtensionless = !extension
    && QUERY_CACHE_DRIFT_EXTENSIONLESS_ALLOWLIST.some((pattern) => pattern.test(baseName));
  if (QUERY_CACHE_DRIFT_EXCLUDED_EXTENSIONS.has(extension)) {
    return false;
  }

  if (!extension && !allowlistedExtensionless) {
    return false;
  }

  if (/^tmp($|[-_.])/i.test(baseName) && !extension) {
    return false;
  }

  if (isExcluded(normalized)) {
    return false;
  }

  if (getFileCategory(normalized) === 'unknown' && !allowlistedExtensionless) {
    return false;
  }

  return true;
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
  return `Session degraded: results were returned but could not be persisted (${detail}). Run \`librainian doctor --heal\` to recover.`;
}

function getSyntheticPackVersion(): LibrarianVersion {
  return {
    major: LIBRARIAN_VERSION.major,
    minor: LIBRARIAN_VERSION.minor,
    patch: LIBRARIAN_VERSION.patch,
    string: LIBRARIAN_VERSION.string,
    // Runtime-generated packs without a persisted version should fail closed.
    qualityTier: 'mvp',
    indexedAt: new Date(0),
    indexerVersion: `${LIBRARIAN_VERSION.string}-runtime-fallback`,
    features: [...LIBRARIAN_VERSION.features],
  };
}

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

function shouldBypassEnumerationForIntent(intent: string): boolean {
  const normalized = intent.toLowerCase();
  if (!normalized) return false;
  const callLike = /\b(call|calls|called|caller|callers|used|usage|reference|references)\b/.test(normalized);
  if (!callLike) return false;
  return /\b(function|functions|method|methods)\b/.test(normalized);
}

function isCallerProbeIntent(intent: string): boolean {
  const normalized = intent.toLowerCase();
  if (!normalized) return false;
  return /\b(callers?|called\s+by|who\s+calls?|what\s+calls?)\b/.test(normalized);
}

function resolveCandidateMaterializationLimit(
  depth: LibrarianQuery['depth'],
  intent: string,
  exhaustive: boolean,
): number {
  if (exhaustive) return 1000;
  const profile = resolveQueryDepthProfile(depth);
  const base = profile === 'L0' ? 48 : profile === 'L1' ? 72 : profile === 'L2' ? 96 : 128;
  if (isCallerProbeIntent(intent)) {
    return profile === 'L0' ? 24 : Math.min(base, 48);
  }
  return base;
}

function capCandidatesForMaterialization(candidates: Candidate[], maxCandidates: number): Candidate[] {
  if (maxCandidates <= 0 || candidates.length <= maxCandidates) {
    return candidates;
  }
  const sorted = [...candidates].sort((left, right) => {
    const leftScore = left.score ?? (left.semanticSimilarity * 0.7 + left.confidence * 0.3);
    const rightScore = right.score ?? (right.semanticSimilarity * 0.7 + right.confidence * 0.3);
    return rightScore - leftScore;
  });
  return sorted.slice(0, maxCandidates);
}

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
  collectDirectPacks,
  collectCandidatePacks,
  scoreAnchoredDirectPack,
  selectPriorityDirectPacks,
  buildHydePrompt,
  normalizeHydeExpansion,
  buildIdentifierExpansionVariants,
  shouldBypassEnumerationForIntent,
  fuseSimilarityResultListsWithRrf,
  fuseSimilarityResultsWithRrf,
  filterPacksToWorkspace,
  isCallerProbeIntent,
  resolveCandidateMaterializationLimit,
  capCandidatesForMaterialization,
  injectFilenameCandidates,
  applyHeuristicSynthesisGuardrail,
  resolveQueryCacheEligibility,
  dedupePathsForCacheEligibility,
  runPathLookupStage,
  runFeatureLocationStage,
  scoreFeatureLocationMatch,
  appendPipelineStageFacts,
  applyQueryPipelineStageAnswerAugmentation,
  shouldSkipSemanticRetrievalForAnchoredPlanning,
  shouldUseAnchoredPlanningDirectMode,
  findAdjacentImplementationModules,
  shouldShortCircuitStructuralCallerQuery,
  buildStructuralCallerPack,
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
