/**
 * @fileoverview API module exports
 */

// Main librarian API
export {
  Librarian,
  createLibrarian,
  createLibrarianSync,
} from './librarian.js';
export type { LibrarianConfig, LibrarianStatus } from './librarian.js';
export type {
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
  LibrarianResponse,
} from '../types.js';

// Core API utilities (providers, embeddings, redaction, reporting)
export {
  EmbeddingService,
  REAL_EMBEDDING_DIMENSION,
  cosineSimilarity,
} from './embeddings.js';
export type {
  EmbeddingKind,
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingMetadata,
  EmbeddingServiceOptions,
  EmbeddingRetryConfig,
  EmbeddingNormalizationConfig,
} from './embeddings.js';
export {
  redactText,
  minimizeSnippet,
  createEmptyRedactionCounts,
  mergeRedactionCounts,
  createRedactionAuditReport,
  writeRedactionAuditReport,
  DEFAULT_SNIPPET_LIMITS,
} from './redaction.js';
export type {
  RedactionType,
  RedactionCounts,
  RedactionResult,
  SnippetMinimizationConfig,
  SnippetMinimizationResult,
  RedactionAuditReportV1,
} from './redaction.js';
export { runProviderReadinessGate } from './provider_gate.js';
export type {
  ProviderGateStatus,
  EmbeddingGateStatus,
  ProviderGateResult,
  ProviderGateRunner,
  ProviderGateOptions,
} from './provider_gate.js';
export {
  negotiateCapabilities,
  negotiateCapabilityContract,
  requireCapabilities,
} from './capability_contracts.js';
export type {
  Capability,
  CapabilityContract,
  CapabilityNegotiationResult,
} from './capability_contracts.js';
export { assembleContextFromResponse } from './context_assembly.js';
export type {
  AgentKnowledgeContext,
  ContextAssemblyOptions,
  FileKnowledge,
  CallEdge,
  ImportEdge,
  TestMapping,
  OwnerMapping,
  ChangeContext,
  PatternMatch,
  AntiPatternMatch,
  SimilarTaskMatch,
  KnowledgeGap,
  LowConfidenceItem,
  KnowledgeSourceRef,
  ContextConstraints,
} from './context_assembly.js';
export { resolveContextLevel, CONTEXT_LEVELS } from './context_levels.js';
export type { ContextLevel, ContextLevelDefinition } from './context_levels.js';
export {
  createTrajectoryAnalysisReport,
  writeTrajectoryAnalysisReport,
  createKnowledgeCoverageReport,
  writeKnowledgeCoverageReport,
} from './reporting.js';
export type {
  ProviderStatusReportV1,
  LibrarianRunReportV1,
  TrajectoryAnalysisReportV1,
  KnowledgeCoverageReportV1,
} from './reporting.js';
export {
  TAXONOMY_ITEMS,
  TAXONOMY_ITEM_COUNT,
  isTaxonomyItem,
} from './taxonomy.js';
export type { TaxonomyItem, TaxonomySource } from './taxonomy.js';

// Technique semantics API
export {
  TECHNIQUE_PRIMITIVE_CATEGORIES,
  TECHNIQUE_PRIMITIVE_KINDS,
  TECHNIQUE_ABSTRACTION_LEVELS,
  TECHNIQUE_SEMANTIC_PROFILE_IDS,
  TECHNIQUE_DOMAIN_TAGS,
  TECHNIQUE_OPERATOR_TYPES,
  TECHNIQUE_RELATIONSHIP_TYPES,
  getTechniqueSemanticProfile,
  getOperatorSemantics,
  getRelationshipSemantics,
  registerOperatorSemantics,
  registerRelationshipSemantics,
  lockTechniqueSemanticsRegistry,
} from '../strategic/index.js';

// Technique library API
export {
  DEFAULT_TECHNIQUE_PRIMITIVES,
  DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID,
  ensureTechniquePrimitives,
} from './technique_library.js';

// Technique package API
export {
  DEFAULT_TECHNIQUE_PACKAGES,
  listTechniquePackages,
  getTechniquePackage,
  compileTechniquePackageBundle,
  compileTechniquePackageBundleById,
} from './technique_packages.js';

// Technique composition API
export {
  DEFAULT_TECHNIQUE_COMPOSITIONS,
  DEFAULT_TECHNIQUE_COMPOSITIONS_BY_ID,
  ensureTechniqueCompositions,
  validateTechniqueComposition,
} from './technique_compositions.js';
export {
  TechniqueCompositionBuilder,
} from './technique_composition_builder.js';
export type {
  AddPrimitiveOptions,
  CompositionBuildOptions,
  MergeOptions,
} from './technique_composition_builder.js';
export {
  compileLCL,
  loadPreset,
  savePreset,
} from './lcl.js';
export type {
  LCLExpression,
  LCLConditional,
  LCLOperatorSpec,
  LCLCompileOptions,
} from './lcl.js';
export {
  loadPresets,
  savePresets,
  getDefaultPresets,
  resolvePresetsPath,
} from './preset_storage.js';
export {
  STRUCTURE_TEMPLATES,
  applyTemplate,
} from './structure_templates.js';
export type { StructureTemplateName, StructureTemplateResult } from './structure_templates.js';
export {
  ASPECT_TO_PRIMITIVES,
  decomposeToAspects,
  decomposeDomainWithLlm,
  resolveDomainPrimitives,
  constructDomainSupport,
  validateDomainComposition,
} from './domain_support.js';
export type {
  FundamentalAspect,
  DomainDescription,
  DomainAspectDecomposition,
  DomainSupportPlan,
  DomainCompositionValidation,
  DomainLlmDecompositionOptions,
} from './domain_support.js';
export {
  listDifficultyDetectors,
  scanRepositorySignals,
  buildAdequacySpec,
  evaluateAdequacy,
  runDifficultyDetectors,
  runAdequacyScan,
  mergeSignals,
} from './difficulty_detectors.js';
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
} from './difficulty_detectors.js';
export {
  loadEpistemicPolicy,
  applyEpistemicPolicy,
  DEFAULT_EPISTEMIC_POLICY,
} from './epistemic_policy.js';
export type { EpistemicPolicy, EpistemicClaim } from './epistemic_policy.js';
export {
  ZERO_KNOWLEDGE_PROTOCOL,
  getZeroKnowledgeProtocol,
  createZeroKnowledgeState,
  recordPhaseResult,
  computeEvidenceBasedConfidence,
  reportUnderstanding,
  EpistemicEscalationEngine,
} from './zero_knowledge_bootstrap.js';
export type {
  KnowledgeSource,
  KnowledgeClaim,
  KnowledgeState,
  BootstrapPhase,
  ZeroKnowledgeProtocolState,
  PhaseResult,
  EvidenceSource,
  EvidenceBasedConfidence,
  ProgressiveUnderstanding,
  UnderstandingLevel,
  KnowledgeAtLevel,
  EscalationDecision,
  EpistemicEscalationOptions,
} from './zero_knowledge_bootstrap.js';
export {
  UniversalProtocolSelector,
} from './universal_applicability.js';
export type {
  Role,
  Task,
  ProjectState,
  KnowledgeState as UniversalKnowledgeState,
  SituationVector,
  TaskProtocol,
  Protocol,
} from './universal_applicability.js';
export {
  analyzeTechniqueComposition,
  analyzeTechniquePrimitive,
} from './technique_validation.js';
export type {
  TechniqueCompositionAnalysis,
  TechniquePrimitiveAnalysis,
  TechniquePrimitiveSignature,
  TechniqueValidationIssue,
  TechniqueValidationSeverity,
} from './technique_validation.js';
export {
  validateTechniqueContractInput,
  validateTechniqueContractOutput,
  validateTechniqueContractPreconditions,
  validateTechniqueContractPostconditions,
  validateTechniquePrimitiveExecution,
  validateTechniquePrimitiveExamples,
} from './technique_contracts.js';
export type {
  TechniqueContractIssue,
  TechniqueContractValidationResult,
} from './technique_contracts.js';
export {
  InMemoryExecutionCheckpointStore,
  TechniqueExecutionEngine,
  createLlmPrimitiveExecutor,
} from './technique_execution.js';
export type {
  CheckpointReason,
  ExecutionCheckpoint,
  ExecutionCheckpointStore,
  ExecutionStatus,
  ExecutionPhase,
  ExecutionIssue,
  ExecutionEvidence,
  ExecutionProgress,
  ExecutionContext,
  PrimitiveExecutionResult,
  PrimitiveExecutionHandler,
  CompositionStepResult,
  CompositionExecutionOptions,
  ExecutionEngine,
  LlmPrimitiveExecutorOptions,
} from './technique_execution.js';
export {
  OperatorInterpreterRegistry,
  createDefaultOperatorRegistry,
} from './operator_registry.js';
export type {
  ExecutionPlan,
} from './operator_registry.js';
export type {
  OperatorInterpreter,
  OperatorExecutionResult,
  OperatorContext,
  EscalationLevel,
} from './operator_interpreters.js';
export {
  DEFAULT_OPERATOR_INTERPRETERS,
} from './operator_interpreters.js';
export {
  llmProviderRegistry,
  resolveLibrarianModelConfigWithDiscovery,
} from './llm_env.js';
export type {
  LlmProviderDescriptor,
  LlmProviderProbe,
  LlmProviderProbeResult,
  LlmAuthMethod,
  DiscoveredProvider,
} from './llm_provider_discovery.js';
export {
  discoverLlmProvider,
  getAllProviderStatus,
} from './llm_provider_discovery.js';
export {
  ClosedLoopLearner,
} from './learning_loop.js';
export {
  TuringOracleClassifier,
} from './self_aware_oracle.js';
export {
  ProofCarryingRetriever,
} from './proof_carrying_context.js';
export {
  CausalDiscoveryEngine,
} from './causal_discovery.js';
export {
  BiTemporalKnowledgeStore,
} from './bi_temporal_knowledge.js';
export {
  MetacognitiveMonitor,
  REASONING_STRATEGIES,
} from './metacognitive_architecture.js';
export {
  CodebaseCompositionAdvisor,
} from './codebase_advisor.js';
export type {
  LearningLoop,
  LearningLoopOptions,
  LearningOutcome,
  LearningInsight,
  LearningUpdate,
  ConsolidationOptions,
  ConsolidationResult,
  CodebaseStats,
  PatternTier,
  ModelUpdate,
  Recommendation,
  CompositionSuggestion,
  PrimitiveSuggestion,
  ContextSourceSuggestion,
  HistoricalWarning,
  LearnedRecommendations,
  LearningQueryContext,
} from './learning_loop.js';
export type {
  UndecidabilityClass,
  UndecidabilityClassification,
  OracleContextEntity,
  OracleUncertaintyEstimate,
} from './self_aware_oracle.js';
export type {
  ProofEntity,
  ProofCarryingContext,
  ProofFailure,
  ProofStep,
  RelevanceProof,
} from './proof_carrying_context.js';
export type {
  DiscoveredCausalRelationship,
  GitCommitEvent,
  GitHistory,
  TestRun,
  MetricObservation,
  MetricTimeSeries,
  VerificationResult,
} from './causal_discovery.js';
export type {
  Timestamp,
  EvidenceEntry,
  BiTemporalFact,
  BiTemporalQuery,
  KnowledgeDiff,
} from './bi_temporal_knowledge.js';
export type {
  ReasoningState,
  MetacognitiveState,
  ReasoningStrategy,
  Impasse,
  ProgressIndicator,
  StrategySwitch,
  ReasoningExplanation,
} from './metacognitive_architecture.js';
export type {
  CodebaseAdvisorClient,
  CodebaseAdvisorOptions,
  CodebaseFeature,
  CompositionSuggestion as CodebaseCompositionSuggestion,
  OperatorRecommendation,
} from './codebase_advisor.js';
export {
  CompositionEvolutionEngine,
} from './composition_evolution.js';
export type {
  DiscoveredPattern,
  CompositionProposal,
  CompositionMutation,
  EvolutionReport,
  EvolutionError,
  CompositionEvolutionOptions,
} from './composition_evolution.js';
export {
  COMPOSITION_PATTERN_CATALOG,
  createCompositionPattern,
  validatePatternCatalog,
} from './pattern_catalog.js';
export type {
  CompositionPattern,
  CompositionPatternInput,
  CompositionPatternMatch,
  CompositionArchetype,
  PatternCatalogContext,
  PatternId,
  PrimitiveId,
  ConfidenceScore,
  NonEmptyArray,
} from './pattern_catalog.js';
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
} from '../epistemics/quantification.js';
export {
  ContextAssemblySessionManager,
} from './context_sessions.js';
export type {
  ContextSession,
  ConversationTurn,
  QAPair,
  FocusArea,
  AccumulatedContext,
  FollowUpResponse,
  DrillDownResponse,
  ContextSummary,
  ContextAssemblySession,
  ContextAssemblySessionOptions,
} from './context_sessions.js';

// Plan compiler API
export {
  selectTechniqueCompositions,
  selectMethods,
  selectTechniqueCompositionsFromStorage,
  compileTechniqueCompositionTemplate,
  compileTechniqueCompositionTemplateFromStorage,
  compileTechniqueCompositionTemplateWithGaps,
  compileTechniqueCompositionTemplateWithGapsFromStorage,
  compileTechniqueCompositionBundle,
  compileTechniqueCompositionBundleFromStorage,
  compileTechniqueBundlesFromIntent,
  compileTechniqueCompositionPrototype,
  planWorkFromComposition,
  planWorkFromCompositionWithContext,
  planWorkFromIntent,
  planWorkFromIntentWithContext,
} from './plan_compiler.js';
export type {
  PlanWorkOptions,
  PlanWorkResult,
} from './plan_compiler.js';
export {
  SemanticCompositionSelector,
  buildLearningSignalMap,
} from './composition_selector.js';
export type {
  CompositionSelectionMode,
  CompositionSelectionOptions,
  CompositionSelector,
  CompositionUsageOutcome,
  CompositionMatch,
  AlternativeMatch,
  MatchReason,
  LearningSignal,
} from './composition_selector.js';

// Query API
export {
  queryLibrarian,
  queryLibrarianWithObserver,
  getQueryPipelineDefinition,
  getQueryPipelineStages,
  createFunctionQuery,
  createFileQuery,
  createRelatedQuery,
} from './query.js';
export {
  executeQueryPipeline,
} from './execution_pipeline.js';
export type {
  ExecutionPipelineOptions,
  ExecutionPipelineResult,
} from './execution_pipeline.js';

// Bootstrap API
export {
  isBootstrapRequired,
  getBootstrapStatus,
  bootstrapProject,
  createBootstrapConfig,
  DEFAULT_BOOTSTRAP_CONFIG,
} from './bootstrap.js';
export type { BootstrapState } from './bootstrap.js';

// Provider availability checks
export {
  requireProviders,
  checkAllProviders,
  ProviderUnavailableError,
} from './provider_check.js';
export type {
  ProviderRequirement,
  ProviderStatus,
  AllProviderStatus,
  ProviderCheckOptions,
} from './provider_check.js';

// Versioning API
export {
  detectLibrarianVersion,
  compareVersions,
  upgradeRequired,
  runUpgrade,
  getCurrentVersion,
  parseVersionString,
  isVersionCompatible,
  getUpgradePath,
  shouldReplaceExistingData,
} from './versioning.js';
export type { UpgradeReport } from './versioning.js';

// Technique-Epistemics Contract Bridge
export {
  TechniqueContractBridge,
  createTechniqueContractBridge,
  DEFAULT_CONFIDENCE_SPEC,
} from './technique_contract_bridge.js';
export type {
  TechniqueContractBridgeConfig,
  EnhancedExecutionResult,
  ContractMapping,
} from './technique_contract_bridge.js';

// Template Registry API
export {
  createTemplateRegistry,
  getDefaultTemplateRegistry,
  resetDefaultTemplateRegistry,
  DOMAIN_TO_TEMPLATES,
} from './template_registry.js';
export type {
  TemplateRegistry,
  ConstructionTemplate,
  IntentHints,
  RankedTemplate,
  TemplateInfo,
  OutputEnvelopeSpec,
  TemplateContext,
  TemplateResult,
  TemplateSelectionEvidence,
} from './template_registry.js';

// T2 DeltaMap Template API
export {
  createDeltaMapTemplate,
  parseDiffOutput,
  parseFileDelta,
  identifyAffectedComponents,
  computeRiskAssessment,
  executeGitDiff,
  normalizeGitRef,
} from './delta_map_template.js';
export type {
  DeltaMapInput,
  DeltaMapOutput,
  FileDelta,
  DiffHunk,
  DeltaMapTemplate,
} from './delta_map_template.js';

// T6 ReproAndBisect Template API
export {
  createReproAndBisectTemplate,
  parseIssueDescription,
  generateReproSteps,
  executeBisect,
  trackReproAttempt,
  createMinimalReproCase,
  analyzeBisectResult,
  normalizeGitRef as normalizeGitRefRepro,
  validateTestCommand,
} from './repro_bisect_template.js';
export type {
  ReproAndBisectInput,
  ReproAndBisectOutput,
  ReproStep,
  BisectResult,
  ReproAttempt,
  TrackedReproAttempt,
  BisectAnalysis,
  BisectOptions,
  ParsedIssue,
  ReproAndBisectTemplate,
} from './repro_bisect_template.js';

// T7 SupplyChain Template API
export {
  createSupplyChainTemplate,
  parsePackageJson,
  parsePackageLock,
  parseYarnLock,
  parsePnpmLock,
  detectPackageManager,
  analyzeDependencies,
  generateSBOM,
  checkVulnerabilities,
  checkOutdated,
  computeSupplyChainRisk,
} from './supply_chain_template.js';
export type {
  SupplyChainInput,
  SupplyChainOutput,
  Dependency,
  Vulnerability,
  OutdatedInfo,
  SBOM,
  SupplyChainSummary,
  SupplyChainTemplate,
} from './supply_chain_template.js';

// T8 InfraMap Template API
export {
  createInfraMapTemplate,
  parseKubernetesYaml,
  parseDockerfile,
  parseDockerCompose,
  parseTerraformFile,
  parseHelmChart,
  buildInfraGraph,
  detectInfraIssues,
  autoDetectInfraTypes,
} from './infra_map_template.js';
export type {
  InfraMapInput,
  InfraMapOutput,
  InfraComponent,
  InfraRelationship,
  InfraIssue,
  InfraComponentType,
  InfraRelationshipType,
  InfraIssueSeverity,
  InfraType,
  InfraGraph,
  InfraParseResult,
  InfraMapTemplate,
} from './infra_map_template.js';

// T12 UncertaintyReduction Template API
export {
  createUncertaintyReductionTemplate,
  identifyUncertaintySources,
  planReductionSteps,
  executeReductionStep,
  iterateUntilTarget,
  mapDefeaterToUncertaintySource,
} from './uncertainty_reduction_template.js';
export type {
  UncertaintyReductionInput,
  UncertaintyReductionOutput,
  UncertaintySource,
  UncertaintySourceType,
  ReductionStep,
  ReductionAction,
  UncertaintyReductionTemplate,
} from './uncertainty_reduction_template.js';
