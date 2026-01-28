/**
 * @fileoverview Self-Improvement Primitives Module
 *
 * This module provides primitives for Librarian to analyze, verify, and
 * improve itself. These form the foundation of the meta-epistemic loop.
 *
 * Based on self-improvement-primitives.md specification.
 *
 * Categories:
 * - Self-Indexing: tp_self_bootstrap, tp_self_refresh
 * - Self-Analysis: tp_analyze_architecture, tp_analyze_consistency
 * - Self-Verification: tp_verify_claim, tp_verify_calibration
 * - Self-Improvement: tp_improve_generate_recommendations, tp_improve_plan_fix
 * - Self-Learning: tp_learn_from_outcomes, tp_learn_extract_patterns
 */

// Self-Indexing Primitives
export {
  selfBootstrap,
  createSelfBootstrap,
  type SelfBootstrapResult,
  type SelfBootstrapOptions,
  type CoverageMetrics,
} from './self_bootstrap.js';

export {
  selfRefresh,
  createSelfRefresh,
  type SelfRefreshResult,
  type SelfRefreshOptions,
  type ChangeSummary,
} from './self_refresh.js';

// Self-Analysis Primitives
export {
  analyzeArchitecture,
  createAnalyzeArchitecture,
  type ArchitectureAnalysisResult,
  type AnalyzeArchitectureOptions,
  type ModuleInfo,
  type DependencyInfo,
  type CycleInfo,
  type ViolationInfo,
  type CouplingMetrics,
  type ArchitectureSuggestion,
  type ArchitectureCheck,
  type ArchitectureThresholds,
} from './analyze_architecture.js';

export {
  analyzeConsistency,
  createAnalyzeConsistency,
  type ConsistencyAnalysisResult,
  type AnalyzeConsistencyOptions,
  type ConsistencyCheck,
  type Mismatch,
  type PhantomClaim,
  type UntestedClaim,
  type DocDrift,
} from './analyze_consistency.js';

// Self-Verification Primitives
export {
  verifyClaim,
  createVerifyClaim,
  type ClaimVerificationResult,
  type VerifyClaimOptions,
  type Claim,
  type VerificationBudget,
} from './verify_claim.js';

export {
  verifyCalibration,
  createVerifyCalibration,
  type CalibrationVerificationResult,
  type VerifyCalibrationOptions,
  type ReliabilityBin,
  type ReliabilityDiagram,
  type SampleComplexityAnalysis,
} from './verify_calibration.js';

// Self-Improvement Primitives
export {
  generateRecommendations,
  createGenerateRecommendations,
  type RecommendationResult,
  type GenerateRecommendationsOptions,
  type AnalysisResults,
  type Action,
  type ImpactEstimate,
  type ImprovementRoadmap,
  type RecommendationDependency,
  type PrioritizationWeights,
} from './generate_recommendations.js';

export {
  planFix,
  createPlanFix,
  type PlanFixResult,
  type PlanFixOptions,
  type Issue,
  type IssueType,
  type IssueSeverity,
  type FixPlan,
  type Change,
  type ChangeType,
  type TestPlan,
  type RollbackPlan,
  type Risk,
  type RiskAssessment,
  type VerificationCriteria,
  type Effort,
  type FixConstraints,
  type ComplexityBudget,
} from './plan_fix.js';

export {
  generateAdversarialTests,
  createGenerateAdversarialTests,
  type AdversarialTestResult,
  type GenerateAdversarialTestsOptions,
  type Weakness,
  type WeaknessType,
  type TestDifficulty,
  type AdversarialTestCase,
  type ExpectedBehavior,
  type FailureMode,
  type WeaknessCoverage,
  type EdgeCase,
  type CoverageGap,
} from './adversarial_test.js';

// Self-Learning Primitives
export {
  learnFromOutcome,
  createLearnFromOutcome,
  type LearningResult,
  type LearnFromOutcomeOptions,
  type Prediction,
  type Outcome,
  type VerificationMethod,
  type PredictionContext,
  type CalibrationUpdate,
  type BinUpdate,
  type KnowledgeUpdate,
  type KnowledgeUpdateType,
  type ConfidenceAdjustment,
  type LearnedPattern,
  type Defeater,
} from './learn_from_outcome.js';

export {
  extractPattern,
  createExtractPattern,
  type PatternExtractionResult,
  type ExtractPatternOptions,
  type CompletedImprovement,
  type ImprovementType,
  type VerificationResult,
  type CodeState,
  type ExtractedPattern,
  type PatternCategory,
  type ApplicabilityConditions,
  type ContextPattern,
  type ApplicabilityAnalysis,
  type ExpectedBenefit,
  type GeneralizationResult,
} from './extract_pattern.js';

// Health Dashboard
export {
  HealthDashboard,
  type HealthStatus,
  type AlertSeverity,
  type TrendDirection,
  type ComponentHealth,
  type HealthMetrics,
  type HealthSnapshot,
  type HealthAlert,
  type HealthTrend,
  type HealthDashboardOptions,
  type ComponentChartData,
  type MetricsTimeSeries,
  type StatusSummary,
  type HealthCheckFn,
} from './health_dashboard.js';

// Meta Improvement Loop (WU-SELF-305)
export {
  MetaImprovementLoop,
  createMetaImprovementLoop,
  DEFAULT_LOOP_CONFIG,
  type LoopConfig,
  type ImprovementIteration,
  type ImprovementAction,
  type ImprovementActionType,
  type MetricChange,
  type LoopState,
  type LoopStatus,
  type ConvergenceAnalysis,
  type MetricTrendDirection,
  type ProblemDetectorInterface,
  type ContinuousImprovementRunnerInterface,
} from './meta_improvement_loop.js';

// Distribution Shift Detection (WU-SELF-303)
export {
  DistributionShiftDetector,
  type DistributionWindow,
  type ShiftDetectionResult,
  type ShiftReport,
  type StatisticalTestResult,
  type DistributionShiftDetectorOptions,
} from './distribution_shift_detector.js';

// Self-Index Validation (WU-META-002)
export {
  SelfIndexValidator,
  createSelfIndexValidator,
  validateSelfIndex,
  DEFAULT_VALIDATION_QUERIES,
  type QuerySpec,
  type ValidationResult,
  type ValidationReport,
  type SelfIndexValidatorOptions,
} from './self_index_validator.js';

// Self-Improvement Report Generator (WU-META-003)
export {
  SelfImprovementReportGenerator,
  createSelfImprovementReportGenerator,
  type Issue as ReportIssue,
  type IssueCategory,
  type IssueSeverity as ReportIssueSeverity,
  type Recommendation as ReportRecommendation,
  type EffortLevel,
  type ImpactLevel,
  type AnalysisScope,
  type HealthSummary,
  type SelfImprovementReport,
  type ReportFormat,
} from './self_improvement_report.js';

// Executor (WU-SELF-301)
export {
  SelfImprovementExecutor,
  createSelfImprovementExecutor,
  type ExecutionContext,
  type ExecutionOptions,
  type ExecutionResult,
  type ExecutorMetrics,
  type ExecutionEntry,
  type ExecutorEventType,
  type ExecutorEvent,
  type ExecutorEventHandler,
  type PrimitiveFunction,
  type CompositionFunction,
  type SelfImprovementExecutorConfig,
} from './executor.js';

// Freshness Detector (WU-SELF-302)
export {
  FreshnessDetector,
  createFreshnessDetector,
  computeFreshness,
  DEFAULT_FRESHNESS_CONFIG,
  type FreshnessConfig,
  type FreshnessResult,
  type FreshnessReport,
  type FreshnessComputeOptions,
} from './freshness_detector.js';

// Self-Index Pipeline (WU-BOOT-001)
export {
  SelfIndexPipeline,
  createSelfIndexPipeline,
  LIBRARIAN_INDEX_CONFIG,
  type SelfIndexConfig,
  type SelfIndexResult,
  type IndexProgress,
  type IndexError,
  type FileIndex,
  type CodeIndex,
  type QualityReport,
  type SymbolInfo,
  type SelfIndexPipelineOptions,
} from './self_index_pipeline.js';

// Probe Executor (WU-SELF-002)
export {
  ProbeExecutor,
  createProbeExecutor,
  type Probe,
  type ProbeResult,
  type ProbeLog,
  type ProbeLogFilter,
  type ProbeExecutorConfig,
  type ProbeType,
} from './probe_executor.js';

// Hypothesis Generator for Retrieval Failures (WU-SELF-001)
export {
  createHypothesisGenerator,
  type HypothesisGenerator,
  type Hypothesis,
  type HypothesisType,
  type HypothesisProbe,
  type ProbeType as HypothesisProbeType,
  type RetrievalFailure,
  type HypothesisTestResult,
  type TestHistoryEntry,
  type HypothesisGeneratorConfig,
} from './hypothesis_generator.js';

// Re-export all types as a namespace for convenience
export * as SelfImprovement from './types.js';
