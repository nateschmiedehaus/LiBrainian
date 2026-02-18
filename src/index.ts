/**
 * @fileoverview Librarian Agent Swarm - Packageable Knowledge Indexing System
 *
 * This module provides a complete, self-contained librarian system that:
 * 1. MUST run to completion before any agent work in new projects
 * 2. Detects and upgrades older librarian work automatically
 * 3. Is designed as a standalone API for use in any project
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createLibrarian } from 'librainian';
 *
 * // Initialize librarian (blocks until ready)
 * const librarian = await createLibrarian({
 *   workspace: '/path/to/project',
 * });
 *
 * // Query for context
 * const context = await librarian.query({
 *   intent: 'How does authentication work?',
 *   depth: 'L1',
 * });
 * ```
 *
 * ## Integration
 *
 * ```typescript
 * import { preOrchestrationHook, enrichTaskContext } from 'librainian';
 *
 * // Before starting any agent work:
 * await preOrchestrationHook(workspace);
 *
 * // When assembling task context:
 * const librarianContext = await enrichTaskContext(workspace, {
 *   intent: task.description,
 *   affectedFiles: task.fileHints,
 * });
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// PUBLIC API SURFACE
// ============================================================================

// ============================================================================
// PRIMARY ENTRY POINT - USE THIS
// ============================================================================
//
// The recommended way to use Librarian is through the unified orchestrator:
//
//   import { initializeLibrarian } from 'librainian';
//
//   const session = await initializeLibrarian(workspace);
//   const context = await session.query('How does auth work?');
//   await session.recordOutcome({ success: true, packIds: context.packIds });
//
// This single function handles:
// - Bootstrap if needed
// - Optimal tier selection (always 'full')
// - Background file watching
// - Self-healing recovery loop
// - Simple session interface
//
export {
  initializeLibrarian,
  hasSession,
  getSession,
  shutdownAllSessions,
  getActiveSessionCount,
} from './orchestrator/index.js';
export type {
  LibrarianSession,
  TaskResult,
  HealthReport,
  Context,
  InitializeOptions,
  QueryOptions,
} from './orchestrator/index.js';

// ============================================================================
// LOWER-LEVEL APIs (for advanced use cases)
// ============================================================================

// Core librarian interface
export { Librarian, createLibrarian, createLibrarianSync } from './api/librarian.js';
export type { LibrarianConfig, LibrarianStatus, LibrarianDependencyOverrides } from './api/librarian.js';

// Query interface
export {
  queryLibrarian,
  queryLibrarianWithObserver,
  getQueryPipelineDefinition,
  getQueryPipelineStages,
  createFunctionQuery,
  createFileQuery,
  createRelatedQuery,
} from './api/query.js';
export {
  executeQueryPipeline,
} from './api/execution_pipeline.js';
export type {
  ExecutionPipelineOptions,
  ExecutionPipelineResult,
} from './api/execution_pipeline.js';
export { applyCalibrationToPacks, computeUncertaintyMetrics, getConfidenceCalibration, summarizeCalibration } from './api/confidence_calibration.js';
export {
  enforceResponseTokenBudget,
  hasValidTokenBudget,
  estimateTokens,
  estimatePackTokens,
  estimateSynthesisTokens,
} from './api/token_budget.js';
export type { ResponseBudgetInput, ResponseBudgetOutput } from './api/token_budget.js';
export {
  ASPECT_TO_PRIMITIVES,
  decomposeToAspects,
  decomposeDomainWithLlm,
  resolveDomainPrimitives,
  constructDomainSupport,
  validateDomainComposition,
} from './api/domain_support.js';
export type {
  FundamentalAspect,
  DomainDescription,
  DomainAspectDecomposition,
  DomainSupportPlan,
  DomainCompositionValidation,
  DomainLlmDecompositionOptions,
} from './api/domain_support.js';
export {
  listDifficultyDetectors,
  scanRepositorySignals,
  buildAdequacySpec,
  evaluateAdequacy,
  runDifficultyDetectors,
  runAdequacyScan,
  mergeSignals,
} from './api/difficulty_detectors.js';
export type {
  DifficultyCategory,
  DifficultySeverity,
  RepositorySignals,
  DifficultyDetector,
  DifficultyFinding,
  AdequacyEvidenceSource,
  AdequacyRequirement,
  AdequacySpec,
  AdequacyReport,
} from './api/difficulty_detectors.js';
export {
  checkAllProviders,
  requireProviders,
  ProviderUnavailableError,
} from './api/provider_check.js';
export type {
  ProviderStatus,
  AllProviderStatus,
  ProviderRequirement,
  ProviderCheckOptions,
} from './api/provider_check.js';
export {
  negotiateCapabilities,
  negotiateCapabilityContract,
  requireCapabilities,
} from './api/capability_contracts.js';
export type {
  Capability,
  CapabilityContract,
  CapabilityNegotiationResult,
} from './api/capability_contracts.js';

// Bootstrap interface
export {
  bootstrapProject,
  isBootstrapRequired,
  getBootstrapStatus,
  createBootstrapConfig,
  loadGovernorConfig,
} from './api/bootstrap.js';

// Version and upgrade interface
export {
  detectLibrarianVersion,
  upgradeRequired,
  runUpgrade,
  compareVersions,
  getCurrentVersion,
  shouldReplaceExistingData,
} from './api/versioning.js';
export type { UpgradeReport } from './api/versioning.js';

// Storage interface (for custom backends)
export type { LibrarianStorage, StorageBackend, StorageCapabilities, StorageStats } from './storage/types.js';
export { createSqliteStorage, createStorageFromBackend } from './storage/sqlite_storage.js';

// Tiered Bootstrap (progressive initialization for fast startup)
export {
  TieredBootstrap,
  createTieredBootstrap,
  BootstrapTier,
  FEATURES as BOOTSTRAP_FEATURES,
  TIER_FEATURES,
} from './bootstrap/index.js';
export type {
  TieredBootstrapOptions,
  TierStats,
  BootstrapStatus as TieredBootstrapStatus,
  DiscoveredFile,
  ExtractedSymbol,
  ImportEdge,
  FeatureId,
} from './bootstrap/index.js';

// Extension points
export type {
  LibrarianAgent as IndexingLibrarianAgent,
  AgentCapability,
  IndexingAgent,
} from './agents/types.js';
export { IndexLibrarian, createIndexLibrarian } from './agents/index_librarian.js';
export {
  clearDefaultLlmServiceFactory,
  createDefaultLlmServiceAdapter,
  getLlmServiceAdapter,
  registerLlmServiceAdapter,
  setDefaultLlmServiceFactory,
  requireLlmServiceAdapter,
  withLlmServiceAdapter,
} from './adapters/index.js';
export type {
  LlmChatMessage,
  LlmChatOptions,
  LlmProviderHealth,
  LlmServiceFactory,
  LlmServiceAdapter,
  RegisterDefaultLlmServiceFactoryOptions,
  RegisterLlmServiceAdapterOptions,
} from './adapters/index.js';
export { clearModelPolicyProvider, registerModelPolicyProvider } from './adapters/model_policy.js';
export type { ModelPolicyProvider, RegisterModelPolicyProviderOptions } from './adapters/model_policy.js';

// Events
export type { LibrarianEvent, LibrarianEventHandler } from './events.js';
export {
  LibrarianEventBus,
  globalEventBus,
  onLibrarianEvent,
  onceLibrarianEvent,
  // Event factory functions
  createBootstrapStartedEvent,
  createBootstrapPhaseCompleteEvent,
  createBootstrapCompleteEvent,
  createBootstrapErrorEvent,
  createQueryStartEvent,
  createQueryResultEvent,
  createQueryErrorEvent,
  createIndexFileEvent,
  createIndexFunctionEvent,
  createIndexCompleteEvent,
  createEngineRelevanceEvent,
  createEngineConstraintEvent,
  createEngineConfidenceEvent,
  createIntegrationContextEvent,
  createIntegrationOutcomeEvent,
} from './events.js';

// Integration (Wave0 + standalone)
export {
  ensureLibrarianReady,
  isLibrarianReady,
  getLibrarian,
  resetGate,
  createLibrarianPreTaskHook,
  withLibrarian,
} from './integration/first_run_gate.js';
export type { FirstRunGateOptions, FirstRunGateResult } from './integration/first_run_gate.js';

export {
  preOrchestrationHook,
  postOrchestrationHook,
  enrichTaskContext,
  formatLibrarianContext,
  recordTaskOutcome,
  notifyFileChange,
  notifyFileChanges,
} from './integration/wave0_integration.js';
export type { LibrarianContext } from './integration/wave0_integration.js';
export { startFileWatcher, stopFileWatcher } from './integration/file_watcher.js';
export type { FileWatcherHandle, FileWatcherOptions } from './integration/file_watcher.js';
export {
  checkModularization,
  getModularizationGuidance,
  buildModularizationPrompt,
  MODULARIZATION_GUIDANCE_VERSION,
  GENERIC_FILE_NAMES,
  POOR_NAME_PATTERNS,
} from './integration/modularization_hooks.js';
export type {
  ModularizationCheckResult,
  ModularizationGuidance,
  FileCreationContext,
} from './integration/modularization_hooks.js';
export { FileLockManager } from './integration/file_lock_manager.js';
export type { LockStatus, BlockedLock, LockResult } from './integration/file_lock_manager.js';
export { interceptFileRead, getReadLog, clearReadLog } from './integration/read_interceptor.js';
export type { FileReadLogEntry } from './integration/read_interceptor.js';
export { DefaultFileReadPolicy } from './integration/file_read_policy.js';
export type { FileReadPolicy, FileReadRequest, FileReadDecision } from './integration/file_read_policy.js';
export {
  configureReadPolicyRegistry,
  resetReadPolicyRegistry,
  registerReadPolicyContext,
  resolveReadPolicyContext,
  clearReadPolicyContext,
  listReadPolicyContexts,
} from './integration/read_policy_registry.js';
export type { ReadPolicyContext, ReadPolicyRegistryOptions } from './integration/read_policy_registry.js';
export { createAgentComplianceReport, writeAgentComplianceReport } from './integration/compliance_report.js';
export type { AgentComplianceReportV1, AgentComplianceSummary } from './integration/compliance_report.js';
export { validateAgentOutput } from './integration/output_validator.js';
export { AGENT_PROTOCOL_BEGIN, AGENT_PROTOCOL_VERSION, buildAgentProtocolPrompt } from './integration/agent_protocol.js';

// Knowledge System
export { Knowledge } from './knowledge/index.js';
export type {
  KnowledgeCategory,
  KnowledgeQuery,
  KnowledgeResult,
} from './knowledge/index.js';
export { checkDefeaters, STANDARD_DEFEATERS } from './knowledge/defeater_activation.js';
export {
  type QuantificationSource,
  type QuantifiedValue,
  type QuantifiedValueLike,
  isQuantifiedValue,
  resolveQuantifiedValue,
  placeholder,
  configurable,
  calibrated,
  derived,
} from './epistemics/quantification.js';

// Epistemics Module - Evidence Graph, Confidence, Contracts, Defeaters
export {
  // Evidence Ledger
  SqliteEvidenceLedger,
  createEvidenceLedger,
  createEvidenceId,
  createSessionId,
  // Evidence Graph Storage
  SqliteEvidenceGraphStorage,
  createEvidenceGraphStorage,
  // Confidence System (D7 compliant)
  deterministic,
  bounded,
  absent,
  isConfidenceValue,
  isDeterministicConfidence,
  isBoundedConfidence,
  isAbsentConfidence,
  getNumericValue,
  getEffectiveConfidence,
  checkConfidenceThreshold,
  meetsThreshold,
  combinedConfidence,
  andConfidence,
  orConfidence,
  applyDecay,
  // Contracts
  ContractExecutor,
  createContractExecutor,
  getContractRegistry,
  resetContractRegistry,
  createContractId,
  createPrimitiveId,
  ContractViolation,
  // Defeater Engine
  detectDefeaters,
  applyDefeaters,
  assessGraphHealth,
  runDefeaterCycle,
  getResolutionActions,
  resolveDefeater,
  DEFAULT_DEFEATER_CONFIG,
  // Defeater-Ledger Bridge
  DefeaterLedgerBridge,
  createDefeaterLedgerBridge,
  // Computed Confidence
  computeConfidence,
  computeConfidenceBatch,
  computeConfidenceStats,
  extractSignalsFromFunction,
  extractSignalsFromFile,
  extractSignalsFromContextPack,
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  COMPONENT_WEIGHTS,
  // Types
  createClaimId,
  createEmptyEvidenceGraph,
  createClaim,
  createDefeater as createDefeaterType,
  createContradiction,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  ClaimOutcomeTracker,
  createClaimOutcomeTracker,
} from './epistemics/index.js';

export type {
  // Evidence Ledger Types
  IEvidenceLedger,
  EvidenceId,
  SessionId,
  EvidenceKind,
  EvidenceEntry,
  EvidenceQuery,
  EvidenceFilter,
  EvidenceChain,
  EvidenceProvenance,
  ProvenanceSource,
  ClaimEvidence,
  VerificationEvidence,
  ContradictionEvidence,
  OutcomeEvidence,
  // Confidence Types
  ConfidenceValue,
  DeterministicConfidence,
  DerivedConfidence,
  MeasuredConfidence,
  BoundedConfidence,
  AbsentConfidence,
  ConfidenceSignals,
  ComputedConfidenceResult,
  // Contract Types
  PrimitiveContract,
  ContractId,
  PrimitiveId,
  ExecutionContext as ContractExecutionContext,
  ContractResult,
  ContractWarning,
  Precondition,
  Postcondition,
  // Graph Types
  Claim,
  ClaimId,
  ClaimType,
  ClaimStatus,
  EvidenceEdge,
  EdgeType,
  ExtendedDefeater,
  ExtendedDefeaterType,
  DefeaterSeverity,
  Contradiction,
  ContradictionType,
  EvidenceGraph,
  // Defeater Engine Types
  DetectionResult,
  DetectionContext,
  ApplicationResult,
  ResolutionAction,
  GraphHealthAssessment,
  DefeaterEngineConfig,
  // Defeater-Ledger Types
  DefeaterLedgerConfig,
  DefeaterDetectionEvent,
  DefeaterApplicationEvent,
  ClaimOutcomeCategory,
  TrackClaimInput,
  RecordOutcomeInput,
  ClaimOutcomeTrackerConfig,
} from './epistemics/index.js';

// Calibration Tracker (bridges measurement with epistemics)
export { CalibrationTracker, createCalibrationTracker } from './measurement/calibration_ledger.js';
export type { TrackedPrediction, ObservedOutcome, CalibrationAnalysisOptions } from './measurement/calibration_ledger.js';

// Technique Contract Bridge (bridges api with epistemics)
export { TechniqueContractBridge, createTechniqueContractBridge, DEFAULT_CONFIDENCE_SPEC } from './api/technique_contract_bridge.js';
export type { TechniqueContractBridgeConfig, EnhancedExecutionResult, ContractMapping } from './api/technique_contract_bridge.js';

// Understanding Layer (UNDERSTANDING_LAYER.md §Knowledge Aggregation Rules)
export {
  aggregateKnowledge,
  propagateConfidence,
  calculateHierarchicalConfidence,
  propagateDefeaters,
  shouldAggregate,
  getCachedAggregation,
  cacheAggregation,
  invalidateAggregationCache,
  clearAggregationCache,
  aggregateRisk,
  aggregateQuality,
  aggregateCoverage,
  aggregateOwnership,
  aggregateConfidence,
  aggregateEntity,
  aggregateContextPacks,
  DEFAULT_AGGREGATION_CONFIGS,
} from './understanding/index.js';
export type {
  AggregationFunction,
  AggregationDomain,
  AggregationConfig,
  AggregatedKnowledge,
  EntityForAggregation,
  AggregatedDefeater,
  AggregationTrigger,
  AggregationEvent,
  AggregationCacheEntry,
  EntityAggregationResult,
} from './understanding/index.js';

// Analysis + recommendations (Wave0 integration)
export { analyzeTrajectory } from './analysis/trajectory_analyzer.js';
export type { TrajectoryAnalysisInput, TrajectoryAnalysisResult } from './analysis/trajectory_analyzer.js';
export { generateRefactoringRecommendations } from './recommendations/refactoring_advisor.js';
export type {
  RefactoringRecommendation,
  RefactoringType,
  RefactoringStep,
  EffortEstimate,
  RiskLevel,
  EntityReference,
} from './recommendations/refactoring_advisor.js';
export { analyzeArchitecture } from './recommendations/architecture_advisor.js';
export type { ArchitectureRecommendation, ArchitectureIssueType } from './recommendations/architecture_advisor.js';

// Measurement Layer (CONTROL_LOOP.md)
export {
  // Calibration
  computeCalibrationReport,
  validateCalibration,
  isCalibrationReport,
  DEFAULT_BUCKETS,
  CALIBRATION_TARGETS,
  // Freshness
  computeFreshness,
  computeDomainFreshness,
  checkStaleness,
  createStalenessDefeater,
  computeRefreshPriority,
  computeFreshnessReport,
  isFreshnessReport,
  formatDuration,
  sectionToDomain,
  DOMAIN_FRESHNESS_CONFIG,
  // Observability
  collectCodeGraphHealth,
  collectIndexFreshness,
  collectConfidenceState,
  collectQueryPerformance,
  QueryLatencyTracker,
  getQueryLatencyTracker,
  assessHealth,
  transitionRecoveryState,
  getRecoveryState,
  resetRecoveryState,
  generateStateReport,
  exportPrometheusMetrics,
  isLibrarianStateReport,
  SLO_THRESHOLDS,
} from './measurement/index.js';
export type {
  // Calibration
  Scope,
  CalibrationBucket,
  CalibrationReport,
  CalibrationClaim,
  CalibrationInput,
  CalibrationValidation,
  // Freshness
  FreshnessDomain,
  DomainFreshnessConfig,
  StalenessCheckInput,
  StalenessCheckResult,
  FreshnessReport,
  DomainFreshnessEntry,
  RefreshQueueEntry,
  BatchFreshnessInput,
  // Observability
  CodeGraphHealth,
  IndexFreshness,
  ConfidenceState,
  QueryPerformance,
  RecoveryState,
  LibrarianStateReport,
  LibrarianHealth,
} from './measurement/index.js';

// Integration Layer (CONTROL_LOOP.md)
export {
  // Agent feedback loop
  processAgentFeedback,
  logRetrievalGap,
  getRetrievalGaps,
  addressRetrievalGap,
  analyzeFeedbackTrends,
  createTaskOutcomeFeedback,
  // Closed-loop recovery
  DEFAULT_RECOVERY_BUDGET,
  canUseRecoveryBudget,
  recordRecoveryUsage,
  getRemainingBudget,
  diagnoseDegradation,
  planRecoveryActions,
  executeRecovery,
  getRecoveryStatus,
  forceResetRecovery,
} from './integration/index.js';
export type {
  // Agent feedback
  AgentFeedback,
  RelevanceRating,
  RetrievalGap,
  ConfidenceAdjustment,
  FeedbackProcessingResult,
  FeedbackAnalysis,
  // Recovery
  RecoveryBudget,
  DegradationType,
  DegradationDiagnosis,
  RecoveryAction,
  RecoveryResult,
  RecoveryStatus,
} from './integration/index.js';

// Automatic Feedback Loop for Calibration
export {
  FeedbackLoop,
  createFeedbackLoop,
  initFeedbackLoop,
  getFeedbackLoop,
  recordOutcome,
  startTask,
  recordSignal,
  analyzeBias,
  inferOutcomeFromToolOutput,
} from './integration/index.js';
export type {
  FeedbackTaskOutcome,
  CompletionSignal,
  FeedbackLoopConfig,
  BiasAnalysis,
} from './integration/index.js';

// Confidence & Defeaters
export { bayesianUpdate, bayesianDelta, calculateCalibration, CONFIDENCE_CONFIGS } from './knowledge/confidence_updater.js';
export { applyDefeaterResults, createDefeater } from './knowledge/defeater_activation.js';
export type { DefeaterCheckContext, DefeaterCheckResult, ActivationSummary } from './knowledge/defeater_activation.js';

// Persona Views
export { projectForPersona, generateGlanceCard, getPersonaSummary } from './views/persona_views.js';
export type { Persona, PersonaView, GlanceCard, KeyMetric, Alert, Action } from './views/persona_views.js';

// Visualization
export { generateMermaidDiagram } from './visualization/mermaid_generator.js';
export { generateASCIITree, generateDependencyBox, generateHealthSummary } from './visualization/ascii_diagrams.js';
export type { DiagramType, DiagramRequest, DiagramResult } from './visualization/mermaid_generator.js';
export type { ASCIIResult, TreeNode } from './visualization/ascii_diagrams.js';

// Graph Analysis - Cascading Impact (RESEARCH-004)
export {
  analyzeCascadingImpact,
  estimateBenefitOfOptimizing,
  estimateBlastRadius,
  compareCascadeImpact,
  getPropagationFactor,
  isHighImpactEntity,
  RISK_PROPAGATION_FACTORS,
  BENEFIT_PROPAGATION_FACTORS,
  DEFAULT_CASCADE_CONFIG,
} from './graphs/cascading_impact.js';
export type {
  CascadeConfig,
  CascadeResult,
  AffectedEntity,
  BenefitEstimate,
  BlastRadiusEstimate,
} from './graphs/cascading_impact.js';


// Engine toolkit
export {
  LibrarianEngineToolkit,
  createLibrarianEngineToolkit,
  RelevanceEngine,
  ConstraintEngine,
  MetaKnowledgeEngine,
} from './engines/index.js';
export type {
  LibrarianAgent,
  AgentQuestion,
  AgentAction,
  AgentAnswer,
  ActionResult,
} from './engines/index.js';

// File patterns
export {
  INCLUDE_PATTERNS,
  EXCLUDE_PATTERNS,
  getFileCategory,
  shouldEmbed,
} from './universal_patterns.js';
export type { FileCategory } from './universal_patterns.js';

// Configuration presets
export {
  FULL_MODE_CONFIG,
  FULL_MODE_BOOTSTRAP_CONFIG,
  FULL_MODE_GOVERNOR_CONFIG,
  FULL_MODE_CONTEXT_LEVEL,
  FULL_MODE_ANALYSIS_CONFIG,
  FULL_MODE_TDD_CONFIG,
  createFullModeConfig,
} from './config/index.js';
export type { FullModeAnalysisConfig, FullModeTddConfig } from './config/index.js';

// Types (re-export from types.ts)
// Note: QualityTier is defined in this file based on QUALITY_TIERS constant
export type {
  LibrarianVersion,
  FunctionKnowledge,
  ModuleKnowledge,
  ContextPack,
  ContextPackType,
  CodeSnippet,
  ConfidenceModel,
  ConfidenceCalibrationSummary,
  IndexingTask,
  IndexingResult,
  BootstrapConfig,
  BootstrapPhase,
  BootstrapReport,
  LibrarianQuery,
  LibrarianResponse,
  LibrarianMetadata,
  LibrarianEventType,
  UncertaintyMetrics,
  LlmRequirement,
  LlmRequired,
  LlmOptional,
  LlmResult,
  StageName,
  StageStatus,
  StageIssueSeverity,
  StageIssue,
  StageReport,
  CoverageGap,
  CoverageAssessment,
  QueryPipelineStageDefinition,
  QueryPipelineDefinition,
  QueryStageObserver,
  Perspective,
  TokenBudget,
  TokenBudgetResult,
  DeterministicContext,
  QueryDiagnostics,
} from './types.js';

export { DEFAULT_CONFIDENCE_MODEL, BOOTSTRAP_PHASES, PERSPECTIVES, isPerspective, createDeterministicContext, stableSort } from './types.js';

// Perspective configuration exports
export {
  getPerspectiveConfig,
  inferPerspective,
  getRelevantTPatterns,
  PERSPECTIVE_CONFIGS,
  TASK_TYPE_TO_PERSPECTIVE,
  type PerspectiveConfig,
} from './api/perspective.js';

// ============================================================================
// VERSION CONSTANTS
// ============================================================================

/**
 * Current librarian schema version.
 * Increment MAJOR for breaking changes requiring full re-index.
 * Increment MINOR for backward-compatible additions.
 * Increment PATCH for bug fixes.
 */
export const LIBRARIAN_VERSION = {
  major: 2,
  minor: 0,
  patch: 0,
  string: '2.0.0',

  // Minimum version that current code can read from
  minCompatible: '1.0.0',

  // Features available at this version - FULL TIER (no MVP shortcuts)
  features: [
    'basic_indexing',
    'confidence_tracking',
    'context_packs',
    'embeddings',
    'pattern_detection',
    'hierarchical_summaries',
    'cross_project_learning',
  ] as const,
} as const;

/**
 * Version history for upgrade path determination.
 * Each entry describes what changed and how to upgrade.
 */
export const VERSION_HISTORY = [
  {
    version: '1.0.0',
    date: '2025-12-25',
    changes: ['Initial MVP release', 'Basic semantic indexing', 'Confidence scoring'],
    upgradeFrom: null,
    quality: 'mvp' as const,
  },
  {
    version: '2.0.0',
    date: '2025-12-31',
    changes: [
      'FULL tier - no MVP shortcuts',
      'Embeddings REQUIRED',
      'Pattern detection',
      'Hierarchical summaries',
      'Cross-project learning',
    ],
    upgradeFrom: '1.0.0',
    quality: 'full' as const,
  },
] as const;

// ============================================================================
// QUALITY TIERS
// ============================================================================

/**
 * Quality tiers for librarian output.
 * Higher tiers automatically supersede lower tiers.
 */
export const QUALITY_TIERS = {
  mvp: {
    level: 1,
    description: 'MVP: Basic indexing, function-level context packs',
    supersedes: [],
  },
  enhanced: {
    level: 2,
    description: 'Enhanced: Pattern detection, decision tracking',
    supersedes: ['mvp'],
  },
  full: {
    level: 3,
    description: 'Full: Hierarchical summaries, cross-project learning',
    supersedes: ['mvp', 'enhanced'],
  },
} as const;

export type QualityTier = keyof typeof QUALITY_TIERS;
