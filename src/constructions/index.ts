/**
 * @fileoverview LiBrainian Constructions Module
 *
 * Composed primitives for common agent tasks. Each construction combines
 * multiple librarian primitives (query, confidence, evidence) to solve
 * higher-level problems while maintaining epistemic properties.
 *
 * @packageDocumentation
 */

export type {
  CapabilityId,
  ConstructionPath,
  Construction,
  ConstructionDebugOptions,
  ConstructionExecutionResult,
  ConstructionExecutionTrace,
  ConstructionExecutionTraceStep,
  ConstructionFailureHint,
  ConstructionFailureKind,
  ConstructionOutcome,
  CostRange,
  CostSemiring,
  ConstructionId,
  ConstructionListFilter,
  ConstructionManifest,
  ConstructionManifestExample,
  ConstructionScope,
  ConstructionSchema,
  ConstructionTrustTier,
  Context,
  ConstructionRequirements,
  Either,
  FixpointMetadata,
  FixpointTerminationReason,
  LegacyConstructionClassId,
  LegacyConstructionId,
  LiBrainianContext,
  Layer,
  NamespacedOfficialConstructionId,
  OfficialConstructionSlug,
  ProgressMetric,
  SelectiveConstruction,
  ThirdPartyConstructionId,
} from './types.js';

export {
  OFFICIAL_CONSTRUCTION_SLUGS,
  LEGACY_CONSTRUCTION_CLASS_IDS,
  LEGACY_CONSTRUCTION_ALIASES,
  isConstructionId,
  toCanonicalConstructionId,
  fail,
  isConstructionOutcome,
  ok,
  unwrapConstructionExecutionResult,
} from './types.js';

export {
  CONSTRUCTION_REGISTRY,
  getConstructionManifest,
  invokeConstruction,
  listConstructions,
} from './registry.js';

export {
  identity,
  atom,
  seq,
  fanout,
  fallback,
  fix,
  branch,
  select,
  left,
  right,
  isLeft,
  dimap,
  contramap,
  map,
  mapAsync,
  mapError,
  withRetry,
  provide,
  ProtocolViolationError,
  mapConstruction,
} from './operators.js';

export {
  calibrated,
  withContextPackSeeding,
  type CalibratedOptions,
  type ContextPackSeedingMetadata,
  type ContextPackSeedingOptions,
  type ImmediateConstructionOutcome,
} from './integration-wrappers.js';

export {
  toMCPTool,
  validateSchema as validateConstructionInputSchema,
  type MCPConstructionTool,
  type MCPToolResult as MCPConstructionToolResult,
  type ToMCPToolOptions,
} from './mcp_bridge.js';

export {
  RefactoringSafetyChecker,
  createRefactoringSafetyChecker,
  type RefactoringTarget,
  type Usage,
  type BreakingChange,
  type TestCoverageGap,
  type GraphImpactAnalysis,
  type RefactoringSafetyReport,
} from './refactoring_safety_checker.js';

export {
  BugInvestigationAssistant,
  createBugInvestigationAssistant,
  // Stack trace parsing
  parseStackFrame,
  parseStackTrace,
  detectStackTraceLanguage,
  STACK_PATTERNS,
  // Log parsing and correlation
  parseLogFile,
  correlateLogsWithStack,
  LOG_PATTERNS,
  // Runtime state analysis
  parseNodeCrashDump,
  analyzeRuntimeState,
  // Enhanced hypothesis generation
  generateHypothesesWithLogs,
  // Types
  type BugReport,
  type StackFrame,
  type Hypothesis,
  type SimilarBug,
  type SimilaritySignalBreakdown,
  type SimilarityWeights,
  type ErrorSignature,
  type StructuralFingerprint,
  type InvestigationReport,
  type LogEntry,
  type LogCorrelation,
  type RuntimeState,
  type SimpleHypothesis,
} from './bug_investigation_assistant.js';

export {
  ConstructionCalibrationTracker,
  createConstructionCalibrationTracker,
  generatePredictionId,
  type ConstructionPrediction,
  type ConstructionCalibrationReport,
  type CalibrationAlert,
  type CalibrationOptions,
  type VerificationMethod,
  type CalibratedConstruction,
} from './calibration_tracker.js';

export {
  FeatureLocationAdvisor,
  createFeatureLocationAdvisor,
  type FeatureQuery,
  type FeatureLocation,
  type FeatureLocationReport,
} from './feature_location_advisor.js';

export {
  CodeQualityReporter,
  createCodeQualityReporter,
  type QualityAspect,
  type QualityQuery,
  type QualityIssue,
  type QualityMetrics,
  type QualityRecommendation,
  type QualityReport,
} from './code_quality_reporter.js';

export {
  ArchitectureVerifier,
  createArchitectureVerifier,
  // Cycle detection
  detectAllCycles,
  findStronglyConnectedComponents,
  // Layer auto-discovery
  discoverArchitectureLayers,
  discoveredLayersToSpec,
  LAYER_PATTERNS,
  // Visualization (DOT format)
  generateDependencyDOT,
  generateLayeredDOT,
  // Package metrics (Robert C. Martin)
  calculatePackageMetrics,
  calculateAllPackageMetrics,
  evaluatePackageHealth,
  // Secret detection
  detectHighEntropyStrings,
  calculateEntropy,
  classifySecret,
  scanFilesForSecrets,
  generateSecretReport,
  // Types
  type ArchitectureLayer,
  type ArchitectureBoundary,
  type ArchitectureRule,
  type ArchitectureSpec,
  type ArchitectureViolation,
  type ComplianceScore,
  type VerificationReport,
  type DependencyCycle,
  type DiscoveredLayer,
  type DOTGenerationOptions,
  type PackageMetrics,
  type PackageMetricsStorage,
  type DetectedSecret,
  type SecretType,
} from './architecture_verifier.js';

export {
  SecurityAuditHelper,
  createSecurityAuditHelper,
  // Dependency vulnerability scanning
  scanDependencyVulnerabilities,
  // Taint analysis
  analyzeTaintFlow,
  TAINT_SOURCES,
  TAINT_SINKS,
  type SecurityCheckType,
  type AuditScope,
  type SecurityFinding,
  type SeverityBreakdown,
  type SecurityReport,
  type DependencyVulnerability,
  type DependencyScanResult,
  type TaintSource,
  type TaintSink,
  type TaintFlow,
} from './security_audit_helper.js';

export {
  SkillAuditConstruction,
  createSkillAuditConstruction,
  type SkillAuditInput,
  type SkillAuditPattern,
  type SkillAuditPatternType,
  type SkillAuditOutput,
} from './skill_audit.js';

export {
  tokenizeForIntentBehavior,
  computeIntentBehaviorCoherence,
} from './intent_behavior_coherence.js';

export {
  ComprehensiveQualityConstruction,
  createComprehensiveQualityConstruction,
  type ExcellenceTier,
  type PriorityLevel,
  type AssessmentScope,
  type Issue,
  type Recommendation,
  type Priority,
  type ComprehensiveQualityReport,
} from './comprehensive_quality_construction.js';

export {
  PreFlightChecker,
  createPreFlightChecker,
  type PreFlightSummary,
} from './preflight_checker.js';

export {
  AgenticProcess,
  createSandboxLifecycleConstruction,
  createAgentDispatchConstruction,
  createObservationExtractionConstruction,
  createImplicitSignalConstruction,
  createCostControlConstruction,
  createAggregationConstruction,
  createReportConstruction,
  createPatrolProcessConstruction,
  createPatrolFixVerifyProcessConstruction,
  createPatrolScanConstruction,
  createIssueFilerConstruction,
  createFixGeneratorConstruction,
  createRegressionTestConstruction,
  createFixVerifierConstruction,
  createOperationalProofGateConstruction,
  createCodeReviewPipelineConstruction,
  createMigrationAssistantConstruction,
  createDocumentationGeneratorConstruction,
  createRegressionDetectorConstruction,
  createOnboardingAssistantConstruction,
  createReleaseQualificationConstruction,
  createDependencyAuditorConstruction,
  createBootstrapQualityGateConstruction,
  createQueryRelevanceGateConstruction,
  createContextPackDepthGateConstruction,
  createCliOutputSanityGateConstruction,
  createSelfIndexGateConstruction,
  createPatrolRegressionClosureGateConstruction,
  createProviderChaosGateConstruction,
  createResultQualityJudgeConstruction,
  deriveResultQualityThresholds,
  isShallowContextPack,
  UnitPatrolConstruction,
  createFixtureSmokeUnitPatrolConstruction,
  UNIT_PATROL_DEFAULT_SCENARIO,
  UNIT_PATROL_DEFAULT_EVALUATION,
  PATROL_PROCESS_DESCRIPTION,
  PATROL_PROCESS_EXAMPLE_INPUT,
  PATROL_FIX_VERIFY_DESCRIPTION,
  PATROL_FIX_VERIFY_EXAMPLE_INPUT,
  OPERATIONAL_PROOF_GATE_DESCRIPTION,
  type ProcessBudget,
  type ProcessInput,
  type ProcessOutput,
  type ProcessEvent,
  type ProcessExitReason,
  type ConstructionPipeline,
  type PipelineStage,
  type PipelineTask,
  type PatrolInput,
  type PatrolOutput,
  type PatrolFixVerifyCommandConfig,
  type PatrolFixVerifyInput,
  type PatrolFixVerifyOutput,
  type PatrolScanResult,
  type PatrolFinding,
  type IssueFilerResult,
  type FixGeneratorResult,
  type RegressionTestResult,
  type FixVerifierResult,
  type OperationalProofCheck,
  type OperationalProofGateInput,
  type OperationalProofCheckResult,
  type OperationalProofGateOutput,
  type PresetProcessInput,
  type PresetProcessOutput,
  type BootstrapQualityFixture,
  type BootstrapQualityGateInput,
  type BootstrapQualityFixtureResult,
  type BootstrapQualityGateOutput,
  type QueryRelevancePair,
  type QueryRelevanceFixture,
  type QueryRelevanceGateInput,
  type QueryRelevancePairResult,
  type QueryRelevanceFixtureResult,
  type QueryRelevanceGateOutput,
  type ContextPackDepthQueryType,
  type ContextPackDepthQuery,
  type ContextPackDepthFixture,
  type ContextPackDepthGateInput,
  type ContextPackDepthQueryResult,
  type ContextPackDepthFixtureResult,
  type ContextPackDepthGateOutput,
  type CliOutputSanityGateInput,
  type CliOutputProbeResult,
  type CliHelpValidation,
  type CliOutputSanityGateSnapshots,
  type CliOutputSanityGateOutput,
  type SelfIndexQueryId,
  type SelfIndexQuerySpec,
  type SelfIndexFixture,
  type SelfIndexGateInput,
  type SelfIndexQueryResult,
  type SelfIndexFixtureResult,
  type SelfIndexGateOutput,
  type PatrolRegressionClosureGateInput,
  type PatrolRegressionCheckResult,
  type PatrolRegressionClosureGateOutput,
  type ProviderChaosGateInput,
  type ProviderChaosModeResult,
  type ProviderChaosGateOutput,
  type ResultQualityThresholdSeed,
  type ResultQualityThresholds,
  type ResultQualityJudgeInput,
  type ResultQualityJudgeOutput,
  type UnitPatrolOperationKind,
  type UnitPatrolQueryConfig,
  type UnitPatrolOperation,
  type UnitPatrolScenario,
  type UnitPatrolEvaluationCriteria,
  type UnitPatrolInput,
  type UnitPatrolOperationResult,
  type UnitPatrolFinding,
  type UnitPatrolQualityScores,
  type UnitPatrolResult,
} from './processes/index.js';

// Strategic Constructions - wrapping strategic modules
export {
  // Original Strategic Constructions (CalibratedConstruction pattern)
  QualityAssessmentConstruction,
  createQualityAssessmentConstruction,
  type QualityAssessmentResult,
  ArchitectureValidationConstruction,
  createArchitectureValidationConstruction,
  type ArchitectureValidationConfig,
  type ArchitectureValidationResult,
  WorkflowValidationConstruction,
  createWorkflowValidationConstruction,
  type WorkflowPhaseContext,
  type GateCheckResult,
  type WorkflowValidationResult,

  // New Strategic Constructions (AssessmentConstruction pattern)
  QualityStandardsConstruction,
  createQualityStandardsConstruction,
  type QualityAssessmentInput,
  type QualityAssessmentOutput,
  WorkPresetsConstruction,
  createWorkPresetsConstruction,
  type WorkPresetAssessmentInput,
  type WorkPresetAssessmentOutput,
  type WorkPresetGateCheckResult,
  ArchitectureDecisionsConstruction,
  createArchitectureDecisionsConstruction,
  type ArchitectureAssessmentInput,
  type ArchitectureAssessmentOutput,
  TestingStrategyConstruction,
  createTestingStrategyConstruction,
  type TestingStrategyAssessmentInput,
  type TestingStrategyAssessmentOutput,
  OperationalExcellenceConstruction,
  createOperationalExcellenceConstruction,
  type OperationalExcellenceAssessmentInput,
  type OperationalExcellenceAssessmentOutput,
  DeveloperExperienceConstruction,
  createDeveloperExperienceConstruction,
  type DeveloperExperienceAssessmentInput,
  type DeveloperExperienceAssessmentOutput,
  TechnicalDebtConstruction,
  createTechnicalDebtConstruction,
  type TechnicalDebtAssessmentInput,
  type TechnicalDebtAssessmentOutput,
  KnowledgeManagementConstruction,
  createKnowledgeManagementConstruction,
  type KnowledgeManagementAssessmentInput,
  type KnowledgeManagementAssessmentOutput,
} from './strategic/index.js';

// Auto-selection for automatic constructable detection and configuration
export {
  // Main API
  detectOptimalConstructables,
  analyzeProject,
  selectConstructables,
  getAvailableConstructables,
  getConstructableMetadata,
  validateConstructableConfig,
  // Bootstrap Integration
  integrateWithBootstrap,
  DEFAULT_BOOTSTRAP_AUTO_SELECTION,
  // Classes
  ProjectAnalyzer,
  // Types
  type DetectedProjectType,
  type DetectedFramework,
  type DetectedPattern,
  type ConstructableConfig,
  type ProjectAnalysis,
  type OptimalConstructableConfig,
  type ManualOverrides,
  type BootstrapAutoSelectionConfig,
  type ProjectType,
  type Language,
  type FrameworkCategory,
  type Framework,
  type ProjectPattern,
  type ConstructableId,
} from './auto_selector.js';

// Composable Lego-style construction pipeline (shared context + standardized findings)
export {
  composeConstructions,
  type SharedAgentContext,
  type ConstructionFinding,
  type ConstructionRecommendation,
  type ConstructionOutput,
  type ComposedConstructionReport,
  type ComposeConstructionsOptions,
} from './lego_pipeline.js';

// Enumeration Construction - complete entity listing by category
export {
  // Intent detection
  detectEnumerationIntent,
  shouldUseEnumerationMode,
  // Main enumeration
  enumerateByCategory,
  // Paginated enumeration
  enumerateByCategoryPaginated,
  // Filtered enumeration
  enumerateWithFilters,
  enumerateExported,
  enumerateInDirectory,
  // Framework detection
  detectFramework,
  getFrameworkCategories,
  // Endpoint enumeration (convenience function)
  getEndpoints,
  // Formatting
  formatEnumerationResult,
  // Helpers
  getSupportedCategories,
  getCategoryAliases,
  // Types
  type EnumerationCategory,
  type EnumerationQueryType,
  type EnumerationIntent,
  type EnumeratedEntity,
  type EnumerationResult,
  // Pagination types
  type EnumerationOptions,
  type PaginatedResult,
  // Framework types
  type EnumerationFramework,
  // Filter types
  type FilterOptions,
  // Endpoint types
  type HttpMethod,
  type EndpointFramework,
  type EndpointInfo,
} from './enumeration.js';

// Rationale Construction for WHY questions
export {
  RationaleConstruction,
  createRationaleConstruction,
  RationaleIndex,
  isWhyQuery,
  classifyWhyQuery,
  generateInferredRationale,
  extractRationaleFromComments,
  WHY_QUERY_PATTERN,
  type RationaleEntry,
  type RationaleSource,
  type RationaleAnswer,
  type RationaleInput,
  type RationaleResult,
  type WhyQueryClassification,
} from './rationale.js';

// Symbol Table Construction for direct symbol lookup
export {
  SymbolTable,
  parseSymbolQuery,
  detectSymbolQuery,
  symbolToContextPack,
  type SymbolEntry,
  type SymbolKind,
  type SymbolLookupResult,
  type SymbolQueryPattern,
} from './symbol_table.js';

// Comparison Construction for contrastive queries
export {
  // Intent detection
  detectComparisonIntent,
  shouldUseComparisonMode,
  // Entity analysis
  findAndAnalyzeEntity,
  // Main comparison
  compareEntities,
  // Pack generation
  createComparisonPack,
  // Formatting
  formatComparisonResult,
  // Semantic/behavioral difference analysis
  analyzeSemanticDifferences,
  // Code diffing
  generateUnifiedDiff,
  formatUnifiedDiff,
  longestCommonSubsequence,
  // Module-level comparison
  compareModules,
  formatModuleComparison,
  // Types
  type ComparisonIntent,
  type ComparisonType,
  type ComparisonResult,
  type AnalyzedEntity,
  type SimilarityPoint,
  type DifferencePoint,
  type BehavioralDifference,
  type CodeDiff,
  type DiffHunk,
  type DiffLine,
  type ModuleComparison,
} from './comparison.js';

// Re-export types needed by consumers
export type { ConfidenceValue } from '../epistemics/confidence.js';

// Re-export graph utilities for construction use
export {
  analyzeCascadingImpact,
  estimateBlastRadius,
  estimateBenefitOfOptimizing,
  compareCascadeImpact,
  isHighImpactEntity,
  type CascadeConfig,
  type CascadeResult,
  type AffectedEntity,
  type BenefitEstimate,
  type BlastRadiusEstimate,
} from '../graphs/cascading_impact.js';

export {
  computeImportanceProfile,
  computeCodeImportance,
  computeRationaleImportance,
  computeEpistemicImportance,
  computeOrgImportance,
  computeBatchImportance,
  DEFAULT_IMPORTANCE_CONFIG,
  type ImportanceProfile,
  type ImportanceFlags,
  type ImportanceConfig,
  type CodeImportanceMetrics,
  type RationaleImportanceMetrics,
  type EpistemicImportanceMetrics,
  type OrgImportanceMetrics,
  type BatchImportanceOptions,
  type BatchImportanceResult,
} from '../graphs/importance_metrics.js';
