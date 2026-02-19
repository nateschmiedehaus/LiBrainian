/**
 * @fileoverview Librarian Constructions Module
 *
 * Composed primitives for common agent tasks. Each construction combines
 * multiple librarian primitives (query, confidence, evidence) to solve
 * higher-level problems while maintaining epistemic properties.
 *
 * @packageDocumentation
 */

export type {
  Construction,
  Context,
  LibrarianContext,
} from './types.js';

export {
  identity,
  seq,
  fanout,
  fallback,
  dimap,
  contramap,
  mapConstruction,
} from './operators.js';

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
