/**
 * @fileoverview Strategic Knowledge Architecture Module
 *
 * This module provides the foundation for deep project understanding,
 * intelligent work management, and sophisticated verification capabilities.
 *
 * Key Components:
 *
 * 1. **Strategic Context** (types.ts)
 *    - Project Vision: Mission, pillars, constraints
 *    - Bounded Contexts: DDD-style domain separation
 *    - Quality Weights: Project-specific quality priorities
 *    - Knowledge Confidence: Epistemic humility framework
 *
 * 2. **Work Primitives** (work_primitives.ts)
 *    - Composable work items: Epic → Story → Task → Step
 *    - Evidence-based tracking
 *    - Templates for common patterns
 *    - Full traceability
 *
 * 3. **Prioritization Engine** (prioritization.ts)
 *    - Multi-factor priority computation
 *    - Transparent, explainable scoring
 *    - Dynamic rules and adjustments
 *    - Impact simulation
 *
 * 4. **Conceptual Verification** (conceptual_verification.ts)
 *    - Beyond-code error detection
 *    - Logical, theoretical, domain errors
 *    - Security model verification
 *    - Consistency checking
 *
 * Design Philosophy:
 *
 * - **Research-First**: The repo and LLM don't have all answers
 * - **Epistemic Humility**: Track confidence, acknowledge uncertainty
 * - **Evidence-Based**: Every claim should have provenance
 * - **Composable**: Building blocks that combine for any need
 * - **Transparent**: Every decision can be explained
 *
 * @packageDocumentation
 */

// ============================================================================
// STRATEGIC CONTEXT TYPES
// ============================================================================

export type {
  // Confidence and Provenance
  ConfidenceLevel,
  ConfidenceAssessment,
  ConfidenceFactor,
  Provenance,
  KnowledgeSource,
  SourceAuthority,

  // Project Vision
  ProjectVision,
  TargetUser,
  Stakeholder,
  StrategicPillar,
  Constraint,
  ConstraintException,
  AntiPattern,
  AntiPatternExample,
  SuccessCriterion,
  SuccessMetric,

  // Quality
  QualityWeights,
  CustomQualityDimension,

  // Bounded Contexts
  BoundedContext,
  ContextBoundary,
  Term,
  TermExample,
  ContextRelationship,
  ContextRelationType,
  IntegrationMechanism,
  DataFlow,
  Contract,
  ContextOwnership,
  ContextImplementation,
  ExternalDependency,
  ContextHealth,
  ContextIssue,

  // Research
  ResearchDepth,
  ResearchTrigger,
  ResearchCondition,
  ResearchQuery,
  ResearchConstraints,
  ResearchResult,
  ResearchFinding,
  ExtractedFact,
  ResearchSynthesis,
  ResearchQualityAssessment,
  QualityFactor,
  KnowledgeGap,

  // External Knowledge
  ExternalKnowledge,
  ExternalKnowledgeType,

  // Architecture Decisions
  ArchitectureDecision,
  ADRStatus,
  AlternativeConsidered,
  DecisionRisk,

  // Utilities
  ChangeRecord,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types.js';

export { DEFAULT_QUALITY_WEIGHTS } from './types.js';

// ============================================================================
// WORK PRIMITIVES
// ============================================================================

export type {
  // Core Types
  WorkPrimitiveType,
  WorkStatus,
  WorkPrimitive,
  WorkExecutionContext,
  WorkResourceEstimates,
  WorkDependencySummary,
  WorkFileReference,
  WorkEntityReference,
  WorkEpisodeReference,
  WorkToolSuggestion,
  WorkExternalDependency,

  // Acceptance Criteria
  AcceptanceCriterion,
  VerificationMethod,

  // Notes
  Note,
  NoteReference,

  // Dependencies
  WorkDependency,
  DependencyType,

  // Traceability
  WorkTraceability,
  AffectedFile,
  RequirementLink,
  ExternalRef,
  TestLink,

  // Priority
  ComputedPriority,
  PriorityLevel,
  PriorityFactor,
  PriorityOverride,

  // Impact
  ImpactAssessment,
  ImpactLevel,
  CascadeEffect,

  // Effort
  EffortEstimate,
  EffortComplexity,
  EffortSize,
  EffortBreakdown,

  // Status and Timing
  StatusChange,
  WorkTiming,
  Deadline,
  ServiceLevelAgreement,

  // Evidence
  WorkEvidence,
  EvidenceType,

  // Labels
  WorkLabel,

  // Changes
  WorkChange,
  WorkChangeType,

  // Templates
  WorkTemplate,
  SuggestedStep,
  TemplateAutoTrigger,

  // Hierarchy
  WorkHierarchy,
  WorkPath,
  WorkPathSegment,

  // Queries
  WorkQuery,
  WorkQueryOrderBy,

  // Operations
  CreateWorkInput,
  UpdateWorkInput,
  DecomposeOptions,
  TransitionOptions,

  // Reports
  WorkReport,
  WorkSummary,
  WorkMetrics,
  WorkReportIssue,
} from './work_primitives.js';

export { STANDARD_PRIORITY_FACTORS, STANDARD_LABELS } from './work_primitives.js';
export type { VerificationPlan, VerificationPlanCost } from './verification_plan.js';
export { createVerificationPlan } from './verification_plan.js';
export type {
  TechniquePrimitive,
  TechniquePrimitiveKind,
  TechniqueAbstractionLevel,
  TechniquePrimitiveContract,
  TechniqueFieldSpec,
  TechniqueFieldOrigin,
  TechniqueFieldType,
  TechniqueVerificationSpec,
  TechniqueComposition,
  TechniqueOperator,
  TechniqueOperatorType,
  TechniqueRelationship,
  TechniqueRelationshipType,
} from './techniques.js';
export type { TechniquePackage } from './technique_packages.js';
export {
  TECHNIQUE_PRIMITIVE_CATEGORIES,
  TECHNIQUE_PRIMITIVE_KINDS,
  TECHNIQUE_ABSTRACTION_LEVELS,
  TECHNIQUE_SEMANTIC_PROFILE_IDS,
  TECHNIQUE_DOMAIN_TAGS,
  TECHNIQUE_OPERATOR_TYPES,
  TECHNIQUE_RELATIONSHIP_TYPES,
  isBuiltinOperatorType,
  isCustomOperatorType,
  isBuiltinRelationshipType,
  isCustomRelationshipType,
  createTechniquePrimitive,
  normalizeTechniquePrimitive,
  createTechniqueComposition,
} from './techniques.js';
export { createTechniquePackage } from './technique_packages.js';
export {
  OPERATOR_SEMANTICS,
  RELATIONSHIP_SEMANTICS,
  getOperatorSemantics,
  getRelationshipSemantics,
  registerOperatorSemantics,
  registerRelationshipSemantics,
  lockTechniqueSemanticsRegistry,
} from './technique_semantics.js';
export {
  TECHNIQUE_SEMANTIC_PROFILES,
  getTechniqueSemanticProfile,
} from './technique_profiles.js';
export { createEpisode } from './episodes.js';

// ============================================================================
// PRIORITIZATION ENGINE
// ============================================================================

export type {
  // Configuration
  PrioritizationConfig,
  PriorityWeights,
  PriorityThresholds,
  DecayConfig,

  // Rules
  PrioritizationRule,
  RuleCondition,
  RuleEffect,

  // Computation
  PriorityComputeContext,
  DependencyGraph,
  PriorityComputation,
  AppliedRule,
  PriorityAdjustment,

  // Explanation
  PriorityExplanation,
  ExplainedFactor,
  PriorityComparison,
  WorkReference,
  PrioritySuggestion,

  // Results
  RankedWork,
  RankOptions,
  FocusRecommendation,
  PrioritySimulation,
  PriorityChange,

  // Factor Calculation
  FactorCalculator,
  FactorResult,

  // Engine Interface
  PrioritizationEngine,
} from './prioritization.js';

export {
  DEFAULT_PRIORITIZATION_CONFIG,
  BUILT_IN_RULES,
  // Factor calculators
  calculateStrategicAlignment,
  calculateUserImpact,
  calculateRiskReduction,
  calculateDependencyUnblock,
  calculateEffortValue,
  calculateTimeDecay,
  calculateMomentum,
  calculateExternalPressure,
  calculateHotspotScore,
} from './prioritization.js';

// ============================================================================
// CONCEPTUAL VERIFICATION
// ============================================================================

export type {
  // Error Types
  ConceptualErrorCategory,
  ErrorSubcategory,
  ConceptualError,
  ErrorSeverity,
  ErrorLocation,
  ErrorScope,

  // Evidence
  ConceptualEvidence,
  EvidenceType as ConceptualEvidenceType,

  // Analysis
  RootCauseAnalysis,
  ContributingFactor,
  TimelineEvent,
  Implication,

  // Fixes
  SuggestedFix,
  FixStep,

  // Detection
  DetectionMethod,
  DetectionRule,
  DetectionPattern,
  DetectionConstraint,

  // Status
  ErrorStatus,
  ErrorStatusChange,

  // Context
  VerificationContext,
  FunctionInfo,
  ModuleInfo,
  DependencyInfo,
  DocumentationInfo,
  VerificationConfig,

  // Results
  VerificationReport,
  VerificationSummary,
  CategoryBreakdown,
  VerificationTrends,
  TrendPoint,
  VerificationRecommendation,

  // Verifier Interface
  ConceptualVerifier,
  ErrorExplanation,
} from './conceptual_verification.js';

export {
  ERROR_SUBCATEGORIES,
  BUILT_IN_VERIFICATION_RULES,
} from './conceptual_verification.js';

// ============================================================================
// AGENT LIFECYCLE HOOKS
// ============================================================================

export type {
  // Core Hook Types
  HookTiming,
  HookScope,
  HookPriority,
  HookHandle,
  HookOptions,
  HookCondition,
  HookErrorHandling,

  // Context Types
  HookContext,
  HookEvidence,
  HookEvidenceType,
  AgentContext,
  ModelContext,
  ToolContext,
  MemoryContext,
  ErrorContext,

  // Agent State
  AgentState as HookAgentState,
  StateTransition,

  // Result Types
  AgentResult,
  ModelResponse,
  ToolResult,
  MemoryResult,
  RecoveryAction,
  RecoveryActionType,
  RetryDecision,
  RetryStrategy,

  // Request Types
  ModelRequest,
  Message,
  ToolCall,
  ToolDefinition,
  ToolChoice,
  ToolInvocation,
  MemoryQuery,
  MemoryType,
  MemoryFilter,
  MemoryItem,

  // Supporting Types
  ToolInfo,
  MemoryInfo,
  ModelConfig,
  RetryContext,
  RetryAttempt,

  // Lifecycle Hooks
  AgentInvocationHooks,
  ModelHooks,
  ToolHooks,
  ToolSelectionRequest,
  MemoryHooks,
  StateTransitionHooks,
  ErrorRecoveryHooks,

  // Task Hooks
  TaskCreationHooks,
  TaskCreateInput,
  TaskInfo,
  TaskStatus,
  TaskDecomposeOptions,
  TaskExecutionHooks,
  TaskProgress,
  ResourceUsage as HookResourceUsage,
  ProgressAction,
  TaskCompletionHooks,
  TaskResult,
  Artifact,
  TaskMetrics,
  TaskError,
  FailureAction,
  CompensationAction,
  VerificationResult,
  CriterionResult,

  // Priority Hooks
  PriorityHooks,
  PriorityFactorValue,
  PriorityAdjustment as HookPriorityAdjustment,
  EscalationDecision,

  // Dependency Hooks
  DependencyHooks,
  TaskDependency,
  DependencyType as HookDependencyType,
  DependencyFailureAction,

  // Gate Types
  GateLevel,
  GateCapability,
  Gate,
  GateRequirement,
  GateContext,
  GateAction,
  GateResult as HookGateResult,
  GateHooks,
  ActionResult,
  Proposal,
  ProposedChange,
  ProposalDecision,
  PullRequestInfo as HookPullRequestInfo,
  CommitInfo,
  GateViolation,
  ViolationResponse,

  // Approval Workflow
  ApprovalWorkflow,
  ApprovalStage,
  ApproverConfig,
  ApprovalRequirement,
  EscalationPolicy,
  EscalationLevel,
  ApprovalHooks,
  ApprovalContext,
  ApprovalRequest,
  Approval,
  Denial,
  DenialAction,
  TimeoutAction as HookTimeoutAction,

  // Hook Registry
  AllHooks,
  HookRegistry,
  HookExecutionResult,
  HookExecutionError,
  HookExecutionOptions,
} from './hooks.js';

export { AGENT_STATE_TRANSITIONS, STANDARD_GATES } from './hooks.js';

// ============================================================================
// BUILDING BLOCKS
// ============================================================================

export type {
  // Reasoning Patterns
  ReasoningPatternType,
  ChainOfThoughtConfig,
  ThoughtStep,
  ChainOfThoughtResult,
  TreeOfThoughtConfig,
  ThoughtBranch,
  TreeOfThoughtResult,
  GraphOfThoughtConfig,
  ThoughtNode,
  GraphOfThoughtResult,
  AdaptiveGraphOfThoughtConfig,
  ReActConfig,
  ToolSpec,
  ParameterSpec,
  StopCondition,
  ReActStep,
  ReActResult,
  ReflexionConfig,
  ReflexionIteration,
  ReflexionResult,

  // Memory Systems
  MemoryTier,
  MemorySystemConfig,
  WorkingMemoryConfig,
  WorkingMemoryItem,
  EpisodicMemoryConfig,
  Episode,
  EpisodeType,
  EpisodeContext,
  EpisodeActor,
  EpisodeEvent,
  EpisodeOutcome,
  EpisodeLesson,
  SemanticMemoryConfig,
  SemanticFact,
  SemanticConcept,
  ConceptAttribute,
  ConceptExample,
  ConceptRelationship,
  ProceduralMemoryConfig,
  Procedure,
  ProcedureApplicability,
  ProcedureCondition,
  ProcedureStep,
  ProcedureParameter,
  RetryPolicy,
  AlternativeStep,
  ProcedureVariant,
  ProcedureDifference,
  ProcedureStatistics,
  MemorySearchConfig,
  ConsolidationConfig,
  ConsolidationTrigger,
  MemoryDecayConfig,

  // Tool Orchestration
  ToolOrchestrationPattern,
  ManagerPatternConfig,
  WorkerConfig,
  HandoffPatternConfig,
  HandoffAgentConfig,
  HandoffRule,
  HandoffCondition,
  ContextTransform,
  ToolSelectionConfig,
  ToolSelectionRule,
  ToolCondition,

  // Reflection & Critique
  ReflectionLoopConfig,
  ReflectionTrigger,
  Reflection,
  ExecutionSummary,
  ReflectionOutcome,
  ReflectionDeviation,
  CausalAnalysis,
  ReflectionAssumption,
  ReasoningFlaw,
  ReflectionLesson,
  ReflectionRecommendation,
  SelfCritiqueConfig,
  ConstitutionalPrinciple,
  RubricCriterion,
  RubricLevel,
  CritiqueResult,
  CriterionResult as CritiqueCriterionResult,

  // Uncertainty
  UncertaintyConfig,
  UncertaintyThresholds,
  UncertaintyActions,
  UncertaintyAction,
  ConfidenceEstimate,
  ConfidenceComponents,
  UncertaintySource,
  UncertaintySourceType,

  // Knowledge Graphs
  KnowledgeGraphConfig,
  KGEntity,
  KGRelation,
  TemporalInfo,
  KGQuery,
  KGQueryPattern,
  KGConstraint,
  KGQueryResult,
  KGPath,

  // Consensus
  ConsensusType,
  ConsensusConfig,
  WeightFunction,
  ConsensusFailureAction,
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,

  // Configuration
  AgentConfig,
  AgentConfigType,
  ReasoningConfig,
  ToolConfig,
  ReflectionConfig,
  GateConfig,
  GateOverride,
  ModelConfiguration,
} from './building_blocks.js';

export {
  DEFAULT_COT_CONFIG,
  DEFAULT_TOT_CONFIG,
  DEFAULT_GOT_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_UNCERTAINTY_CONFIG,
  DEFAULT_REFLECTION_CONFIG,
  DEFAULT_CRITIQUE_CONFIG,
  createStarterConfig,
} from './building_blocks.js';

// ============================================================================
// AGENT FORMULATIONS
// ============================================================================

export type {
  // Workflow Types
  WorkflowStep,
  LoopConfig,
  RetryConfig,
  OutputSpec,
  WorkflowDefinition,
  InputSpec,
  QualityGate,
  QualityCheck,
  QualityFailureAction,
  WorkflowErrorHandling,

  // Formulation Base
  AgentFormulation,
  ToolRecommendation,
  FormulationExample,

  // Code Review
  CodeReviewFormulation,
  CodeAnalyzerConfig,
  CodeReviewFocusArea,
  SeverityConfig,
  SeverityLevel,
  EscalationRule,
  ReviewReportConfig,

  // Research
  ResearchFormulation,
  ResearchSource,
  ResearchVerificationConfig,
  CitationConfig,
  ResearchDepthConfig as ResearchFormulationDepthConfig,

  // Planning
  PlanningFormulation,
  MethodDefinition,
  MethodApplicability,
  SubtaskDefinition,
  PlanningConstraint,
  ContingencyConfig,
  FailureMode,
  RecoveryStrategy as FormulationRecoveryStrategy,

  // Verification
  VerificationFormulation,
  VerificationLevel,
  CoverageConfig,
  FormalVerificationConfig,
  PropertySpec,

  // Documentation
  DocumentationFormulation,
  DocumentationType,
  DocumentationOutputConfig,
  DocumentationStyleConfig,
} from './agent_formulations.js';

export {
  CODE_REVIEW_WORKFLOW,
  CODE_REVIEW_FORMULATION,
  RESEARCH_WORKFLOW,
  RESEARCH_FORMULATION,
  PLANNING_WORKFLOW,
  PLANNING_FORMULATION,
  VERIFICATION_WORKFLOW,
  VERIFICATION_FORMULATION,
  DOCUMENTATION_WORKFLOW,
  DOCUMENTATION_FORMULATION,
  FORMULATION_REGISTRY,
  getFormulation,
  listFormulations,
  customizeFormulation,
} from './agent_formulations.js';

// ============================================================================
// INTEGRATION PATTERNS
// ============================================================================

export type {
  // MCP
  MCPServerConfig,
  MCPTransportConfig,
  MCPCapabilities,
  MCPToolCapability,
  MCPResourceCapability,
  MCPPromptCapability,
  MCPPromptArgument,
  MCPSamplingCapability,
  MCPLoggingCapability,
  MCPSecurityConfig,
  MCPAuthConfig,
  MCPRateLimitConfig,
  MCPClientConfig,
  MCPServerConnection,
  MCPRetryConfig,
  MCPToolRequest,
  MCPToolResult,
  MCPContent,
  MCPResourceRequest,
  MCPResource,
  MCPHooks,

  // Git
  GitIntegrationConfig,
  BranchStrategy,
  CommitConfig,
  CommitMessageFormat,
  PRConfig,
  GitHooksConfig,
  GitHookConfig,
  GitOperationType,
  GitOperationResult,
  GitCommitInfo,
  GitIntegrationHooks,
  PRCreateConfig,
  PullRequestInfo,
  ConflictResolution,
  WorktreeConfig,
  Worktree,

  // CI/CD
  CICDIntegrationConfig,
  CICDProvider,
  PipelineConfig,
  TriggerConfig,
  PushTrigger,
  PRTrigger,
  ScheduledTrigger,
  SelfCorrectionConfig,
  SelfCorrectionType,
  PipelineStage,
  PipelineRunResult,
  PipelineStatus,
  StageResult,
  ArtifactInfo,
  CICDHooks,
  PipelineRunConfig,
  StageContext,
  StageFailureAction,
  PipelineFailureAction,

  // Event-Driven
  EventDrivenConfig,
  EventBusConfig,
  EventRetryConfig,
  SchemaRegistryConfig,
  DeadLetterConfig,
  EventObservabilityConfig,
  AgentEvent,
  AgentEventType,
  EventSubscription,
  EventPattern,
  EventHandler,
  SubscriptionOptions,
  EventFilter,
  BatchConfig,
  EventBus,
  EventStore,

  // IDE
  IDEIntegrationConfig,
  IDEType,
  LSPConfig,
  LSPCapability,
  ExtensionConfig,
  IDEFeature,
  IDERequest,
  IDERequestType,
  DocumentInfo,
  Position,
  Range,
  IDEResponse,
  CompletionResult,
  CompletionItem,
  CompletionKind,

  // API Gateway
  APIGatewayConfig,
  APIGatewayType,
  RouteConfig,
  RouteRateLimitConfig,
  ValidationConfig,
  APIAuthConfig,
  APIRateLimitConfig,
  MiddlewareConfig,
  APIErrorConfig,
  APIRequest,
  APIUser,
  APIResponse,
  APIGatewayHooks,

  // Integration Manager
  IntegrationManagerConfig,
  GlobalIntegrationSettings,
  GlobalRetryConfig,
  IntegrationHealthCheck,
} from './integration_patterns.js';

export { createDefaultIntegrationConfig } from './integration_patterns.js';

// ============================================================================
// WORK PRESETS
// ============================================================================

export type {
  // Gate Requirements
  GateRequirementType,
  PresetGateRequirement,
  PresetQualityGate,
  QualityGatesPreset,

  // Orchestration
  FailurePolicy,
  RetryConfig as WorkPresetRetryConfig,
  OrchestrationPreset,

  // Deliverables
  DeliverableType,
  DeliverableRequirement,
  DeliverablePreset,

  // Review
  ReviewTriggerCondition,
  ReviewTrigger,
  AutomatedCheckType,
  AutomatedCheck,
  ReviewPreset,

  // Composite
  WorkPreset,
} from './work_presets.js';

export {
  // Standard Quality Gates Presets
  STRICT_QUALITY_GATES,
  STANDARD_QUALITY_GATES,
  EXPLORATORY_QUALITY_GATES,

  // Standard Orchestration Presets
  STRICT_ORCHESTRATION,
  STANDARD_ORCHESTRATION,
  EXPLORATORY_ORCHESTRATION,

  // Standard Deliverable Presets
  CODE_DELIVERABLE_STRICT,
  CODE_DELIVERABLE_STANDARD,
  CODE_DELIVERABLE_EXPLORATORY,
  DOCUMENTATION_DELIVERABLE,
  REPORT_DELIVERABLE,

  // Standard Review Presets
  STRICT_REVIEW,
  STANDARD_REVIEW,
  EXPLORATORY_REVIEW,

  // Complete Work Presets
  STRICT_PRESET,
  STANDARD_PRESET,
  EXPLORATORY_PRESET,

  // Factory Functions
  createQualityGatesPreset,
  createOrchestrationPreset,
  createDeliverablePreset,
  createReviewPreset,
  createWorkPreset,
  mergeWorkPresets,
  getPresetById,
  listPresetIds,

  // Validators
  validateGateRequirement,
  validateQualityGate,
  validateQualityGatesPreset,
  validateOrchestrationPreset,
  validateDeliverableRequirement,
  validateDeliverablePreset,
  validateReviewTrigger,
  validateAutomatedCheck,
  validateReviewPreset,
  validateWorkPreset,

  // Utility Functions
  hasBlockingGates,
  getPhaseRequirements,
  isPeerReviewTriggered,
  calculateBackoff,
} from './work_presets.js';

// Patrol Preset (agent patrol dogfooding)
export {
  PATROL_QUALITY_GATES,
  PATROL_PRESET,
  PATROL_THRESHOLDS,
  validatePatrolObservation,
} from './patrol_preset.js';

// ============================================================================
// ARCHITECTURE DECISIONS
// ============================================================================

export type {
  // ADR Types (prefixed with Adf to avoid conflicts with types.ts)
  AdfStatus,
  Alternative as AdfAlternative,
  ArchitectureDecisionRecord,

  // Trade-off Analysis
  QualityAttribute as TradeoffQualityAttribute,
  TradeoffCell,
  TradeoffRow,
  TradeoffMatrix,
  TradeoffAnalysis,
  CreateTradeoffAnalysisInput,

  // Constraint Validation
  ConstraintType as ArchConstraintType,
  ConstraintSeverity as ArchConstraintSeverity,
  ArchitectureConstraint,
  ConstraintViolation,
  ConstraintValidatorConfig,
  ConstraintValidationResult,

  // Drift Detection
  TechnicalDebtEstimate,
  ArchitectureDriftReport,
  TechnicalDebt,

  // Pattern Guidance
  PatternEvidence,
  AntiPatternWarning,
  PatternExample,
  PatternRecommendation,
  CreatePatternRecommendationInput,

  // ADR Input
  CreateADRInput,
} from './architecture_decisions.js';

export {
  // ADR Factory
  createADR,
  updateADR,
  supersedeADR,

  // Trade-off Analysis
  DEFAULT_TRADEOFF_WEIGHTS,
  createTradeoffAnalysis,
  compareOptions,

  // Constraint Validation
  validateLayerDependency,
  validateNamingConvention,
  validateCircularDependencies,

  // Drift Detection
  calculateTechnicalDebt,
  generateDriftReport,

  // Pattern Recommendations
  createPatternRecommendation,
  checkPatternApplicability,

  // Built-in Constraints
  CLEAN_ARCHITECTURE_CONSTRAINTS,
  NAMING_CONVENTION_CONSTRAINTS,
} from './architecture_decisions.js';

// ============================================================================
// QUALITY STANDARDS
// ============================================================================

export type {
  // Documentation Type (aliased to avoid conflict with agent_formulations)
  DocumentationType as QualityDocumentationType,

  // Standards
  CorrectnessStandard,
  CompletenessStandard,
  ReliabilityStandard,
  MaintainabilityStandard,
  EpistemicStandard,
  QualityStandard,

  // Validation (aliased to avoid conflict with types.ts)
  ViolationSeverity,
  ValidationViolation,
  ValidationResult as QualityValidationResult,
  ValidatableArtifact,
  ArtifactMetrics,

  // Compliance
  ProjectCompliance,
  ComplianceReport,

  // DORA Metrics
  DORAPerformanceLevel,
  DORAMetrics,

  // SRE Standards (aliased to avoid conflicts with operational_excellence)
  SLIType as QualitySLIType,
  ServiceLevelIndicator as QualityServiceLevelIndicator,
  ServiceLevelObjective as QualityServiceLevelObjective,
  ErrorBudgetConfig as QualityErrorBudgetConfig,
  ToilMetrics,
  SREStandards,

  // Advanced Code Quality
  CognitiveComplexityStandard,
  PackageCouplingMetrics,
  TechnicalDebtRatio,
  AdvancedCodeQuality,

  // ISO 25010
  ISO25010Quality,

  // CISQ
  CISQStandards,

  // SQALE
  SQALERating,
  SQALEStandards,

  // Formal Verification
  FormalVerificationStandard,
  TestDeterminismStandard,
  ZeroDowntimeDeployment,
} from './quality_standards.js';

export {
  // Schema Version
  QUALITY_STANDARDS_SCHEMA_VERSION,

  // Standard Presets
  WORLD_CLASS_PLUS_STANDARDS,
  WORLD_CLASS_STANDARDS,
  PRODUCTION_STANDARDS,
  MVP_STANDARDS,

  // DORA Presets
  ELITE_DORA_METRICS,
  HIGH_DORA_METRICS,

  // Validator Functions
  validateAgainstStandard,
  generateComplianceReport,
  validateDORAMetrics,
  validateSREMetrics,
  validateAdvancedCodeQuality,

  // Calculator Functions
  getDORAPerformanceLevel,
  calculateSQALERating,

  // Factory Functions
  createCustomStandard,
  createArtifact,
  getStandardById,
  getAllStandardPresets,
} from './quality_standards.js';

// ============================================================================
// TESTING STRATEGY
// ============================================================================

export type {
  // Core Testing Pyramid Types
  TestingPyramid,
  UnitTestingConfig,
  IntegrationTestingConfig,
  E2ETestingConfig,
  SpecializedTestingConfig,
  PerformanceBaseline,

  // Security Testing
  SecurityTestingConfig,

  // Accessibility Testing
  AccessibilityConfig,

  // Performance Testing
  PerformanceTestingConfig,
  SLADefinition,

  // Mutation Testing
  MutationTestingConfig,
  MutationOperator,

  // Test Infrastructure
  TestInfrastructure,
  CIConfig,
  FlakyTestConfig,
  TestEnvironment,
  ArtifactStorageConfig,

  // Test Quality Metrics
  TestQualityMetrics,
  ExecutionTimeMetrics,

  // Complete Strategy
  TestingStrategy,
  TestingStrategyMetadata,

  // Validation Types
  ValidationSeverity,
  ValidationIssue,
  StrategyValidationResult,
  ValidationSummary,

  // Coverage Gap Analysis Types
  GapSeverity,
  CoverageGap,
  CoverageGapAnalysis,
  PrioritizedAction,

  // Quality Report Types
  TrendDirection,
  MetricTrend,
  TestCategoryStats,
  TestQualityReport,
  ReportRecommendation,
} from './testing_strategy.js';

export {
  // Preset Configurations
  COMPREHENSIVE_PRESET,
  BALANCED_PRESET,
  MINIMAL_PRESET,
  DEFAULT_TEST_INFRASTRUCTURE,
  DEFAULT_QUALITY_TARGETS,

  // Strategy Functions
  createTestingStrategy,
  validateStrategy,
  analyzeCoverageGaps,
  generateQualityReport,
} from './testing_strategy.js';

// ============================================================================
// DEVELOPER EXPERIENCE STANDARDS
// ============================================================================

export type {
  // Onboarding Types
  Prerequisite as DXPrerequisite,
  SetupConfig as DXSetupConfig,
  OnboardingDocs as DXOnboardingDocs,
  MentorshipConfig as DXMentorshipConfig,
  OnboardingConfig as DXOnboardingConfig,

  // Workflow Types
  CodeReviewConfig as DXCodeReviewConfig,
  CommitConfig as DXCommitConfig,
  PRConfig as DXPRConfig,
  WorkflowConfig as DXWorkflowConfig,

  // Tooling Types
  IDEConfig as DXIDEConfig,
  LintingConfig as DXLintingConfig,
  FormattingConfig as DXFormattingConfig,
  HookConfig as DXHookConfig,
  ToolingConfig as DXToolingConfig,

  // Documentation Types
  APIDocConfig as DXAPIDocConfig,
  ArchDocConfig as DXArchDocConfig,
  ReadmeConfig as DXReadmeConfig,
  RunbookConfig as DXRunbookConfig,
  DocumentationConfig as DXDocumentationConfig,

  // Feedback Loop Types
  FeedbackLoopConfig as DXFeedbackLoopConfig,

  // Complete Config
  DeveloperExperienceConfig,

  // Score Types
  DXScoreComponent,
  DXScore,
  DXScoreWeights,

  // Checklist Types
  OnboardingChecklistItem as DXOnboardingChecklistItem,
  OnboardingChecklist as DXOnboardingChecklist,

  // Validation Types
  WorkflowValidationIssue as DXWorkflowValidationIssue,
  WorkflowValidationResult as DXWorkflowValidationResult,

  // World-Class Documentation Standards Types
  DiagramRequirement,
  WrittenDocConfig,
  VisualDocConfig,
  InteractiveDocConfig,
  VideoDocConfig,
  MultiModalDocs,
  ApiMismatch,
  DocTestResult,
  DocTesting,
  Audience,
  ExampleRequirements,
  ContentRequirements,
  AudienceContent,
  StalenessDetection,
  AutoUpdateHook,
  DocFreshness,
  DocFreshnessStatus,
  SEOConfig,
  CrossLinkConfig,
  RecommendationConfig,
  LearningStep,
  LearningPath,
  Discoverability,
  WorldClassDocConfig,
  DocValidationIssue,
  DocValidationResult,
} from './developer_experience.js';

export {
  // Score Calculator
  calculateDXScore,

  // Checklist Generator
  generateOnboardingChecklist,

  // Workflow Validator
  validateWorkflow,

  // Preset Configurations
  WORLD_CLASS_DX_PRESET,
  STANDARD_DX_PRESET,
  MINIMAL_DX_PRESET,
  WORLD_CLASS_DOCS_PRESET,

  // Factory Functions
  createDXConfig,
  getDXPresets,

  // World-Class Documentation Functions
  runDocTests,
  calculateReadingLevel,
  validateContentForAudience,
  checkDocFreshness,
  calculateLearningProgress,
  validateWorldClassDocs,
  createWorldClassDocsConfig,
} from './developer_experience.js';

// ============================================================================
// KNOWLEDGE MANAGEMENT
// ============================================================================

export type {
  // Knowledge Types
  KnowledgeType,
  StalenessInfo,
  FeedbackStats,
  KnowledgeItem,

  // Decision Knowledge
  DecisionAlternative,
  DecisionKnowledge,

  // Operational Knowledge
  RunbookStep,
  OperationalKnowledge,

  // Domain Knowledge
  DomainKnowledge,

  // Technical Knowledge
  TechnicalKnowledge,

  // Lesson Knowledge
  LessonKnowledge,

  // Recipe Knowledge
  RecipeStep,
  RecipeKnowledge,

  // Glossary Knowledge
  GlossaryKnowledge,

  // Relations and Gaps
  KnowledgeRelationType,
  KnowledgeRelation,
  KnowledgeGapItem,
  KnowledgeImprovement,
  Contradiction,

  // Search
  SearchResult,
  SearchOptions,

  // Graph and Learning System Interfaces
  KnowledgeGraph,
  LearningSystem,
  KnowledgeFeedback,

  // Evidence Ledger Integration
  EvidenceLedgerOptions,

  // Factory Options
  CreateKnowledgeItemOptions,
} from './knowledge_management.js';

export {
  // Factory Functions
  createDefaultStalenessInfo,
  createDefaultFeedbackStats,
  isKnowledgeStale,
  computeRefreshPriority,
  createKnowledgeId,
  createDecisionKnowledge,
  createOperationalKnowledge,
  createDomainKnowledge,
  createGlossaryKnowledge,
  createKnowledgeGraph,
  createLearningSystem,

  // Type Guards
  isDecisionKnowledge,
  isOperationalKnowledge,
  isDomainKnowledge,
  isGlossaryKnowledge,

  // Implementations
  InMemoryKnowledgeGraph,
  InMemoryLearningSystem,

  // Evidence Ledger Integration
  recordKnowledgeAsEvidence,
  recordFeedbackAsEvidence,
} from './knowledge_management.js';

// ============================================================================
// OPERATIONAL EXCELLENCE
// ============================================================================

export type {
  // Observability
  ObservabilityConfig,
  LoggingConfig,
  LogDestination,
  MetricsConfig,
  ServiceLevelIndicator,
  ServiceLevelObjective,
  BurnRateThreshold,
  ErrorBudgetConfig,
  ErrorBudgetThresholdAction,
  ErrorBudgetAction,
  CustomMetric,
  MetricsExportConfig,
  TracingConfig,
  TraceExporterConfig,
  AlertingConfig,
  AlertRoute,
  AlertSuppressionRule,
  EscalationPolicy as OpExEscalationPolicy,
  EscalationStep as OpExEscalationStep,
  EscalationTarget,
  OnCallConfig,
  AlertDeduplicationConfig,

  // Reliability
  ReliabilityConfig,
  IncidentResponseConfig,
  SeverityLevel as OpExSeverityLevel,
  RotationConfig,
  RotationScheduleEntry,
  AutomatedResponse,
  AutomatedResponseTrigger,
  AutomatedResponseAction,
  StatusPageConfig,
  StatusPageComponent,
  PostMortemTemplate,
  PostMortemSection,
  PostMortemCustomField,
  CapacityPlanningConfig,
  CapacityMetric,
  ScalingThreshold,
  DisasterRecoveryConfig,
  BackupConfig,
  BackupRetention,
  BackupDestination,
  BackupEncryption,
  BackupVerification,
  FailoverConfig,
  FailoverTrigger,
  HealthCheckConfig,
  DNSFailoverConfig,
  DRTestSchedule,

  // Deployment
  DeploymentConfig,
  DeploymentStrategy,
  PipelineConfig as OpExPipelineConfig,
  PipelineStage as OpExPipelineStage,
  PipelineStep as OpExPipelineStep,
  QualityGate as OpExQualityGate,
  EnvironmentConfig,
  ApprovalConfig,
  ArtifactConfig,
  FeatureFlagConfig,
  TargetingRule,
  StaleFlagPolicy,
  FlagLifecycleConfig,
  RollbackConfig,
  RollbackTrigger,
  RollbackVerification,
  SuccessCriterion as OpExSuccessCriterion,

  // Security Operations
  SecOpsConfig,
  VulnerabilityConfig,
  VulnerabilityScanConfig,
  VulnerabilityScanType,
  ScannerConfig,
  RemediationSLA,
  ExceptionPolicy,
  TicketingIntegration,
  AssignmentRule,
  SecretsConfig,
  RotationPolicy,
  SecretCategory,
  SecretAccessPolicy,
  SecretAuditConfig,
  AccessControlConfig,
  AuthenticationConfig,
  AuthMethod,
  MFAPolicy,
  SessionConfig,
  PasswordPolicy,
  AuthorizationConfig,
  RoleDefinition,
  RoleConstraint,
  PermissionDefinition,
  PermissionCondition,
  AccessReviewConfig,
  AuditConfig,
  AuditedEvent,
  AuditDestination,
  AuditReplication,
  AuditRetention,
  TamperProtectionConfig,
  AuditAlertRule,
  AuditAlertCondition,

  // Operational Excellence Assessment
  OperationalExcellenceConfig,
  ConfigMetadata,
  ComplianceCheckResult,
  ComplianceCategoryResult,
  ComplianceCheck,
  ComplianceIssue,
  HealthScoreResult,
  HealthDimensionScore,
  HealthFactor,
  HealthRecommendation,
  RunbookTemplate,
  RunbookSection,
  RunbookStep as OpExRunbookStep,
  RunbookMetadata,
} from './operational_excellence.js';

export {
  // Compliance Checker
  checkCompliance,

  // Health Score Calculator
  calculateHealthScore,

  // Runbook Generator
  generateRunbookTemplate,

  // Preset Configurations
  ENTERPRISE_CONFIG,
  STARTUP_CONFIG,
  MINIMAL_CONFIG,

  // Factory Function
  createOperationalExcellenceConfig,
} from './operational_excellence.js';

// ============================================================================
// TECHNICAL DEBT MANAGEMENT
// ============================================================================

export type {
  // Debt Classification
  DebtType,
  DebtCategory,
  DebtSeverity,
  DiscoveryMethod,
  DebtStatus,
  TechnicalDebtItem,
  DebtEvidence,
  DebtStatusChange,

  // Debt Tracking
  DebtInventory,
  DebtTrendDirection,
  DebtCategorySummary,
  DebtDetector,
  DetectorConfig,
  DetectorThresholds,

  // Debt Prioritization
  DebtPrioritization,
  PrioritizationFactors,
  PaydownPlan,
  PaydownPlanItem,
  PaydownOptions,
  DebtPrioritizationOptions,

  // Debt Prevention
  DebtCheck,
  CheckContext,
  CodeChange,
  CheckResult,
  ComplexityBudget,
  DependencyPolicy,
  ReviewGate,
  GateTrigger,
  DebtPreventionPolicy,

  // Debt Metrics Dashboard
  DebtSummary,
  DebtTrend,
  DebtRecommendation,
  DebtDashboard,

  // Validation Types
  PolicyValidationResult,
  CodeMetrics,
  ComplexityValidationResult,
  ComplexityViolation,

  // Factory Input Types
  CreateDebtItemInput,
} from './technical_debt.js';

export {
  // ROI and Risk Calculators
  calculateDebtROI,
  calculateDebtRisk,
  rankDebtByValue,

  // Paydown Scheduler
  createPaydownPlan,

  // Prevention Policy Validators
  validateAgainstPolicy,
  validateComplexityBudget,

  // Dashboard Generation
  generateDebtDashboard,

  // Factory Functions
  createDebtItem,
  createDebtInventory,
  createDebtPrioritization,

  // Detector Factories
  createComplexityDetector,
  createDuplicationDetector,
  createOutdatedDependencyDetector,
  createMissingTestsDetector,

  // Default Configurations
  DEFAULT_COMPLEXITY_BUDGET,
  STRICT_COMPLEXITY_BUDGET,
  DEFAULT_DEPENDENCY_POLICY,
  DEFAULT_PREVENTION_POLICY,
} from './technical_debt.js';

// ============================================================================
// ANTIFRAGILITY PATTERNS
// ============================================================================

export type {
  // Stress-Driven Improvement
  StressEventType,
  StressEvent,
  Resolution as StressResolution,
  StressMetrics,
  ResponseAnalysis,
  ResponseClassification,
  ResponseStrength,
  ResponseWeakness,
  ResponsePattern,
  BaselineComparison,
  MetricComparison as StressMetricComparison,
  Improvement as StressImprovement,
  ImprovementType as StressImprovementType,
  EffortEstimate as AntifragileEffortEstimate,
  ImplementationStep,
  ImprovementStatus,
  StrengtheningMetrics,
  RecurringPattern,
  StressResponse,

  // Optionality Preservation
  Decision as OptionalityDecision,
  Cost as OptionalityCost,
  Alternative as OptionalityAlternative,
  DecisionContext as OptionalityDecisionContext,
  ReversibilityScore,
  ReversibilityClassification,
  ReversibilityFactor,
  Option as PreservableOption,
  OptionValue,
  OptionalityManager,

  // Barbell Strategy
  Item as BarbellItem,
  Budget as BarbellBudget,
  AllocationConstraint,
  BarbellAllocation,
  AllocatedItem,
  AllocationRiskMetrics,
  Protection as BarbellProtection,
  ProtectionMechanism,
  ProtectionIssue,
  Scope as BarbellScope,
  RollbackRequirement as AntifragileRollbackRequirement,
  ExperimentConfig,
  ExperimentMonitoring,
  ExperimentStatus as BarbellExperimentStatus,
  BarbellStrategy,

  // Via Negativa
  System as ViaNegativaSystem,
  SystemComponent,
  SystemDependency,
  ExternalSystemDependency,
  ComplexityMetrics,
  Fragility,
  FragilityType,
  FragilityEvidence,
  RemediationOption,
  Removal,
  SimplificationBenefit,
  RemovalStatus,
  RemovalSafetyCheck,
  RemovalRisk,
  SimplificationMetrics,
  ViaNegativa,
  SimplificationRecommendation,

  // Skin in the Game
  Ownership,
  OwnershipType,
  OwnershipMetrics,
  OwnershipTransfer,
  QualityMetrics as AuthorQualityMetrics,
  QualityBreakdown,
  Feedback as AccountabilityFeedback,
  FeedbackType as AccountabilityFeedbackType,
  FeedbackResponse as AccountabilityFeedbackResponse,
  ReputationScore,
  ReputationComponent,
  ReputationChange,
  Badge,
  ReputationLevel,
  AccountabilitySystem,
} from './antifragility.js';

export {
  // Factory Functions
  createStressEvent,
  createImprovement,
  createDecision,
  createOption,
  createBarbellAllocation,
  createFragility,
  createRemoval,
  createOwnership,
  createFeedback,
  createConfidenceAssessment,

  // Utility Functions
  calculateAntifragilityScore,
  classifyResponse,
  calculateReversibilityScore,
  prioritizeFragilities,
  calculateReputationFromQuality,
  getReputationLevel,
  isValidStressEventType,
  isValidFragilityType,

  // Preset Configurations - Stress Response
  HIGH_RELIABILITY_STRESS_CONFIG,
  STANDARD_STRESS_CONFIG,

  // Preset Configurations - Barbell Strategy
  CONSERVATIVE_BARBELL_CONFIG,
  BALANCED_BARBELL_CONFIG,
  AGGRESSIVE_BARBELL_CONFIG,

  // Preset Configurations - Via Negativa
  THOROUGH_SIMPLIFICATION_CONFIG,
  STANDARD_SIMPLIFICATION_CONFIG,

  // Preset Configurations - Accountability
  STRICT_ACCOUNTABILITY_CONFIG,
  STANDARD_ACCOUNTABILITY_CONFIG,
} from './antifragility.js';

// ============================================================================
// PROJECT TEMPLATES
// ============================================================================

export type {
  // Template Types
  ProjectTemplateType,
  ProjectTemplateBase,
  ProjectTemplate,
  AcceptanceCriteriaTemplate,

  // Quality Gates
  GateViolationSeverity,
  QualityGateRequirement as TemplateQualityGateRequirement,
  QualityGate as TemplateQualityGate,
  GateFailureAction,

  // Rollback (aliased to avoid conflict with operational_excellence.ts)
  RollbackTriggerType as TemplateRollbackTriggerType,
  RollbackTrigger as TemplateRollbackTrigger,
  RollbackStep as TemplateRollbackStep,
  RollbackProcedure as TemplateRollbackProcedure,

  // Deliverables
  DeliverableType as TemplateDeliverableType,
  Deliverable as TemplateDeliverable,

  // Feature Development
  FeatureDevelopmentPhase,
  FeatureDevelopmentTemplate,

  // Bug Investigation
  BugInvestigationPhase,
  EvidenceRequirement as TemplateEvidenceRequirement,
  ConfidenceRule as TemplateConfidenceRule,
  TimeoutProcedure as TemplateTimeoutProcedure,
  BugInvestigationTemplate,

  // Refactoring
  RefactoringPhase,
  BreakingChangeProtocol,
  OrderingRule,
  CoverageRequirement as TemplateCoverageRequirement,
  RefactoringTemplate,

  // Research
  ResearchPhase as TemplateResearchPhase,
  UncertaintyConfig as TemplateUncertaintyConfig,
  DeadEndConfig,
  CaptureConfig,
  HypothesisTemplate,
  ResearchTemplate,

  // Context and Results
  TemplateContext,
  TemplateResult,
} from './project_templates.js';

export {
  // Standard Templates
  FEATURE_DEVELOPMENT_TEMPLATE,
  BUG_INVESTIGATION_TEMPLATE,
  REFACTORING_TEMPLATE,
  RESEARCH_TEMPLATE,

  // Factory Functions
  getTemplate,
  listTemplateTypes,
  createFromTemplate,
  createFeatureDevelopmentTemplate,
  createBugInvestigationTemplate,
  createRefactoringTemplate,
  createResearchTemplate,

  // Validators
  validateQualityGate as validateTemplateQualityGate,
  validateDeliverable as validateTemplateDeliverable,
  validateTemplate,

  // Utility Functions
  getGatesForPhase,
  getDeliverablesForPhase,
  hasBlockingGatesForPhase,
  getMandatoryRequirements,
  getTemplateStats,
  templateHasPhase,
  getNextPhase,
  getPreviousPhase,
} from './project_templates.js';

// ============================================================================
// ORCHESTRATION RELIABILITY
// ============================================================================

export type {
  // Progress and Resource Types
  ProgressMetrics,
  ResourceUsage,
  TimeoutAction,

  // Agent State Types
  AgentStatus,
  AgentState,
  PendingOperation,
  CompletedOperation,

  // Checkpoint and Recovery Types
  Checkpoint,
  CheckpointReason,
  ResumeResult,
  PartialResult,
  GracefulDegradation,
  ManualInterventionRequest,

  // QA Types
  Change,
  CommitValidationResult,
  ValidationCheck,
  ValidationIssue as OrchestrationValidationIssue,
  TestResult,
  GateResult,
  Output,
  ConfidenceCheck,
  CompletenessResult,
  EvidenceQualityIssue,

  // Audit Types
  AgentAction,
  Decision as OrchestrationDecision,
  DecisionFactor,
  Outcome as OrchestrationOutcome,
  AuditExport,
  AuditAction,
  AuditDecision,
  AuditOutcome,
  AuditSummary,

  // Interface Types
  AgentHealthMonitor,
  FailureRecovery,
  QAHooks,
  OrchestrationAudit,

  // Configuration Types
  OrchestrationReliabilityConfig,
} from './orchestration_reliability.js';

export {
  // Implementations
  InMemoryAgentHealthMonitor,
  InMemoryFailureRecovery,
  DefaultQAHooks,
  InMemoryOrchestrationAudit,
  OrchestrationReliabilityFramework,

  // Factory Functions
  createAgentHealthMonitor,
  createFailureRecovery,
  createQAHooks,
  createOrchestrationAudit,
  createOrchestrationReliabilityFramework,

  // Validators
  validateProgressMetrics,
  validateAgentState,
  validateCheckpoint,
} from './orchestration_reliability.js';

// ============================================================================
// ADVANCED SOFTWARE ENGINEERING
// ============================================================================

export type {
  // Lightweight Formal Methods
  Precondition,
  Postcondition,
  Invariant,
  InvariantCheckpoint,
  Contract as FormalContract,
  ContractViolationBehavior,
  ContractViolation,
  ContractEnforcement,

  // Advanced Testing - Metamorphic
  MetamorphicRelation,
  MetamorphicTestResult,
  MetamorphicTest,
  MetamorphicTestConfig,

  // Advanced Testing - Fuzzing
  FuzzConfig,
  FuzzInputSchema,
  FuzzConstraint,
  MutationStrategy,
  CrashDetectionConfig,
  CrashDetector,
  FuzzingSetup,
  FuzzingResult,
  FuzzingCoverage,

  // Advanced Testing - Property-Based
  PropertyTest,
  Generator,
  RandomGenerator,
  PropertyTestConfig,
  PropertyTestResult,

  // Advanced Testing Interface
  AdvancedTesting,

  // AI Assistance - Context
  AIContext,
  ProjectContext,
  CodeContext,
  DeveloperPreferences,
  HistoricalContext,
  CodeChange as AICodeChange,

  // AI Assistance - Refactoring
  RefactoringSuggestion,
  RefactoringType,
  RefactoringImpact,
  CodeLocation,

  // AI Assistance - Code Review
  ReviewGuideline,
  ReviewCategory,
  ReviewPattern,
  CodeReviewResult,
  FileReviewResult,
  ReviewIssue,
  ReviewSummary,
  ReviewRecommendation as AIReviewRecommendation,

  // AI Assistance - Test Generation
  CoverageTarget,
  GeneratedTest,
  TestCoverage,
  GeneratedAssertion,
  GeneratedMock,

  // AI Assistance - Documentation
  DocumentationAudience,
  GeneratedDocumentation,
  DocumentationSection,
  CodeExample,
  DocumentationDiagram,
  DocumentationMetadata,

  // AI Assistance Interface
  AIAssistance,

  // Reliability Patterns - Circuit Breaker
  CircuitBreakerConfig,
  CircuitState,
  ErrorMatcher,
  CircuitFallback,
  CircuitBreaker,
  CircuitBreakerMetrics,

  // Reliability Patterns - Bulkhead
  BulkheadConfig,
  BulkheadRejection,
  Bulkhead,
  BulkheadMetrics,

  // Reliability Patterns - Retry
  RetryConfig as AdvancedRetryConfig,
  BackoffStrategy,
  JitterStrategy,
  RetryPolicy as AdvancedRetryPolicy,
  RetryMetrics,

  // Reliability Patterns - Chaos
  ChaosConfig,
  ChaosFault,
  FaultType,
  FaultTarget,
  SteadyStateMetric,
  SafetyControl,
  ExperimentSchedule,
  ChaosExperiment,
  ExperimentStatus,
  ExperimentResults,
  FaultEvent,
  HypothesisEvaluation,
  MetricDeviation,

  // Reliability Patterns Interface
  ReliabilityPatterns,
  ComposedResilience,

  // Performance Engineering - Profiling
  ProfileConfig,
  ProfileType,
  ProfileStorageConfig,
  ProfileAlertThreshold,
  ContinuousProfile,
  ProfileStatus,
  ProfileFilter,
  ProfileData,
  ProfileAnalysis,
  Hotspot,
  MemoryIssue,
  ConcurrencyIssue,
  ProfileComparison,
  ProfileSummary,
  ProfileDifference,
  ProfileRegression,
  ProfileImprovement,

  // Performance Engineering - Baseline & Regression
  PerformanceBaseline as AdvancedPerformanceBaseline,
  BaselineMetric,
  PerformanceMetrics,
  MetricMeasurement,
  RegressionResult,
  PerformanceRegression,
  PerformanceImprovement,
  RegressionMethodology,

  // Performance Engineering - Capacity
  GrowthModel,
  SeasonalityConfig,
  CapacityModel,
  ResourceCapacity,
  GrowthProjection,
  CapacityBottleneck,
  CapacityRecommendation,
  ScalingPlan,
  ScalingAction,

  // Performance Engineering Interface
  PerformanceEngineering,
  TrendAnalysis,
  MetricTrend as PerformanceMetricTrend,
  MetricAnomaly,
  SeasonalPattern,
  MetricPrediction,
} from './advanced_engineering.js';

export {
  // Factory Functions - Contracts
  createPrecondition,
  createPostcondition,
  createInvariant,
  createContract,
  createContractEnforcement,

  // Factory Functions - Testing
  createMetamorphicRelation,

  // Factory Functions - Reliability
  createCircuitBreakerConfig,
  createBulkheadConfig,
  createRetryConfig,
  createChaosConfig,

  // Factory Functions - Performance
  createProfileConfig,
  createPerformanceBaseline,
  detectPerformanceRegression,

  // Default Configurations
  DEFAULT_FUZZ_CONFIG,
  DEFAULT_PROPERTY_TEST_CONFIG,
  DEFAULT_REVIEW_GUIDELINES,
  STANDARD_METAMORPHIC_RELATIONS,
} from './advanced_engineering.js';

// ============================================================================
// CONTINUOUS IMPROVEMENT
// ============================================================================

export type {
  // Time and Common Types
  TimeRange,
  Trend,
  Severity as CISeverity,
  Priority as CIPriority,

  // Outcome Tracking
  Outcome as CIOutcome,
  SideEffect,
  ProcessMetrics,
  ResourceUsage as CIResourceUsage,
  ImprovementOpportunity,
  ImprovementType,
  OpportunityStatus,
  EffortEstimate as CIEffortEstimate,
  TrendPoint as CITrendPoint,
  OutcomeTracker,

  // Feedback Loop
  FeedbackSource,
  Feedback,
  FeedbackSubject,
  FeedbackType,
  AggregatedFeedback,
  Insight,
  InsightCategory,
  ProcessChange,
  ProcessChangeType,
  FeedbackLoop,

  // Failure Learning
  Failure,
  FailureType,
  ErrorDetail,
  FailureResolution,
  FailureCategory,
  RootCause as CIRootCause,
  RootCauseCategory,
  ContributingFactor as CIContributingFactor,
  TimelineEvent as CITimelineEvent,
  Action as CIAction,
  ActionType as CIActionType,
  ActionStatus as CIActionStatus,
  FailurePattern,
  PatternSignature,
  FailureLearning,
  FailureFilter,

  // Benchmarking
  Baseline,
  BaselineMethod,
  Comparison,
  ComparisonStatus,
  StatisticalSignificance,
  Alert as CIAlert,
  AlertType as CIAlertType,
  AlertStatus as CIAlertStatus,
  BenchmarkSystem,

  // Template Evolution
  Change as CIChange,
  ChangeType as CIChangeType,
  Version,
  VersionStatus,
  DeprecationInfo,
  MigrationPath,
  MigrationStep,
  MigrationRisk,
  AdoptionMetrics,
  TemplateEvolution,
  VersionComparison,

  // Integrated System
  ContinuousImprovementConfig,
  ContinuousImprovementSystem,
  ImprovementReport,
} from './continuous_improvement.js';

export {
  // Factory Functions
  createOutcomeTracker,
  createFeedbackLoop,
  createFailureLearning,
  createBenchmarkSystem,
  createTemplateEvolution,
  createContinuousImprovementSystem,

  // Default Configuration
  DEFAULT_CONTINUOUS_IMPROVEMENT_CONFIG,
} from './continuous_improvement.js';

// ============================================================================
// EXCELLENCE VALIDATION
// ============================================================================

export type {
  // Dimensions and Evidence
  ExcellenceDimension,
  EvidenceType as ExcellenceEvidenceType,
  Evidence,

  // Requirements and Benchmarks
  RequirementOperator,
  Requirement,
  Benchmark,
  BenchmarkEntry,
  Metrics,
  ComparisonResult,
  MetricComparison,
  HistoricalBest,

  // Excellence Criteria
  ExcellenceCriteria,
  Artifact as ExcellenceArtifact,
  ExcellenceReport,
  DimensionScore,
  RequirementResult,
  ExcellenceGap,
  ExcellenceRecommendation,
  ExcellenceChecklist,

  // Benchmark Database
  BenchmarkDatabase,

  // Independent Validation - Audit
  AuditStandard,
  AuditResult,
  ControlResult,
  AuditFinding,
  RemediationItem,

  // Independent Validation - Red Team
  AttackVectorType,
  AttackVector,
  RedTeamResult,
  Breach,
  BlockedAttempt,
  Vulnerability,
  System,
  Component,
  SystemInterface,

  // Independent Validation - Adversarial Testing
  AdversarialConfig,
  TestCase,
  AdversarialResult,
  CrashReport,
  UnexpectedBehavior,
  PerformanceAnomaly,

  // Independent Validation - Edge Cases
  Domain,
  EdgeCaseReport,
  FailedEdgeCase,
  EdgeCaseCategory,
  IndependentValidation,

  // Certification Framework
  ExcellenceTier,
  TierRequirements,
  TierAssessment,
  DimensionAssessment,
  MaintenanceStatus,
  CertificationIssue,
  UpgradePath,
  UpgradeStep,
  CertificationFramework,
} from './excellence_validation.js';

export {
  // Schema Version
  EXCELLENCE_VALIDATION_SCHEMA_VERSION,

  // Dimensions and Tiers
  EXCELLENCE_DIMENSIONS,
  EXCELLENCE_TIERS,
  TIER_NAMES,
  TIER_DESCRIPTIONS,

  // Tier Requirements Presets
  GOOD_TIER_REQUIREMENTS,
  GREAT_TIER_REQUIREMENTS,
  WORLD_CLASS_TIER_REQUIREMENTS,
  LEGENDARY_TIER_REQUIREMENTS,
  getTierRequirements,

  // Default Excellence Criteria
  FUNCTIONAL_CRITERIA,
  PERFORMANCE_CRITERIA,
  RELIABILITY_CRITERIA,
  SECURITY_CRITERIA,
  MAINTAINABILITY_CRITERIA,
  USABILITY_CRITERIA,
  DEFAULT_EXCELLENCE_CRITERIA,

  // Implementation Classes
  InMemoryBenchmarkDatabase,
  createExcellenceChecklist,
  createCertificationFramework,
  createIndependentValidation,

  // Factory Functions
  createEvidence,
  createValidationArtifact,
  createAttackVector,
  createTestSystem,
  createTestComponent,
} from './excellence_validation.js';

// ============================================================================
// HOTSPOT SCORING
// ============================================================================

export type {
  // Core Types
  HotspotScore,
  HotspotInput,
  HotspotConfig,
  ChurnDetails,
  ComplexityDetails,

  // Integration Types
  HotspotFactorResult,
  HotspotSignalValue,
} from './hotspot.js';

export {
  // Configuration
  DEFAULT_HOTSPOT_CONFIG,

  // Core Computation
  computeHotspotScore,
  computeChurnScore,
  computeComplexityScore,

  // Batch Operations
  computeHotspotScores,
  filterHotspots,
  getTopHotspots,

  // Integration Helpers
  fromTemporalGraph,
  fromDebtMetrics,
  mergeHotspotInputs,

  // Prioritization Integration
  calculateHotspotFactor,

  // Multi-Signal Scorer Integration
  toHotspotSignal,
} from './hotspot.js';

// ============================================================================
// MODULE DOCUMENTATION
// ============================================================================

/**
 * # Strategic Knowledge Architecture
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   ProjectVision,
 *   BoundedContext,
 *   WorkPrimitive,
 *   ComputedPriority,
 *   ConceptualError,
 * } from './librarian/strategic';
 *
 * // Define project vision
 * const vision: ProjectVision = {
 *   mission: 'Enable developers to build better software faster',
 *   pillars: [...],
 *   qualityWeights: DEFAULT_QUALITY_WEIGHTS,
 *   // ...
 * };
 *
 * // Create work items
 * const task: WorkPrimitive = {
 *   type: 'task',
 *   title: 'Implement user authentication',
 *   // ...
 * };
 *
 * // Compute priority
 * const priority = await prioritizationEngine.computePriority(task, context);
 *
 * // Verify conceptual integrity
 * const errors = await verifier.verifyAll(verificationContext);
 * ```
 *
 * ## Research-First Philosophy
 *
 * This module is built on the principle that:
 *
 * 1. **The repository doesn't contain all relevant knowledge**
 * 2. **The LLM doesn't have all the answers**
 * 3. **Confidence must be tracked and expressed**
 * 4. **Research should be triggered automatically when uncertainty is high**
 *
 * ## Key Concepts
 *
 * ### Confidence Levels
 *
 * - **Verified** (0.9-1.0): Multiple authoritative sources, production-tested
 * - **Established** (0.7-0.9): Single authoritative source, consistent
 * - **Probable** (0.5-0.7): Inferred, RESEARCH RECOMMENDED
 * - **Speculative** (0.3-0.5): LLM inference, RESEARCH REQUIRED
 * - **Unknown** (<0.3): No information, MUST RESEARCH
 *
 * ### Work Primitive Hierarchy
 *
 * ```
 * Epic (Strategic)
 * └── Story (Tactical)
 *     └── Task (Operational)
 *         └── Step (Atomic)
 *             └── Checkpoint (Verification)
 * ```
 *
 * ### Priority Computation
 *
 * Priority is COMPUTED from multiple factors:
 * - Strategic alignment (20%)
 * - User impact (18%)
 * - Risk reduction (15%)
 * - Dependency unblock (12%)
 * - Effort/value ratio (12%)
 * - Time decay (8%)
 * - Momentum (8%)
 * - External pressure (7%)
 *
 * ### Conceptual Error Categories
 *
 * - **Logical**: Contradictions, incomplete cases
 * - **Theoretical**: Algorithm misuse, distributed fallacies
 * - **Design**: Abstraction leaks, temporal coupling
 * - **Domain**: Business rule violations, language inconsistency
 * - **Consistency**: Doc/code drift, decision drift
 * - **Security**: Trust boundary violations
 */
