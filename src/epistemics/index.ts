/**
 * @fileoverview Epistemics Module - Evidence Graph and Defeater Calculus
 *
 * This module provides the epistemic engine for Librarian:
 * - Evidence graph with claims, supports, opposes, and defeaters
 * - Contradiction tracking (never silently reconciled)
 * - Calibrated confidence decomposition
 * - Typed defeater calculus
 *
 * @packageDocumentation
 */

// Types
export {
  // Schema version
  EVIDENCE_GRAPH_SCHEMA_VERSION,

  // Core types
  type Claim,
  type ClaimId,
  type ClaimType,
  type ClaimSubject,
  type ClaimSource,
  type ClaimStatus,

  // Confidence
  type ClaimSignalStrength,
  createDefaultSignalStrength,
  computeOverallSignalStrength,

  // Edges
  type EvidenceEdge,
  type EdgeType,

  // Defeaters
  type ExtendedDefeaterType,
  type ExtendedDefeater,
  type DefeaterSeverity,

  // Contradictions
  type Contradiction,
  type ContradictionType,
  type ContradictionStatus,
  type ContradictionResolution,

  // Graph
  type EvidenceGraph,
  type EvidenceGraphMeta,
  type SerializedEvidenceGraph,

  // Type guards
  isClaimId,
  isClaim,
  isEvidenceEdge,
  isExtendedDefeater,
  isContradiction,
  isEvidenceGraph,

  // Serialization
  serializeEvidenceGraph,
  deserializeEvidenceGraph,

  // Factory functions
  createClaimId,
  createEmptyEvidenceGraph,
  createClaim,
  createDefeater,
  createContradiction,
} from './types.js';

// Storage
export {
  // Storage interface
  type EvidenceGraphStorage,
  type ClaimQueryOptions,
  type EdgeQueryOptions,
  type DefeaterQueryOptions,
  type ContradictionQueryOptions,
  type TraversalResult,
  type GraphStats,

  // Implementation
  SqliteEvidenceGraphStorage,
  createEvidenceGraphStorage,
} from './storage.js';

// Defeater Calculus Engine
export {
  // Configuration
  DEFAULT_DEFEATER_CONFIG,
  type DefeaterEngineConfig,

  // Detection
  detectDefeaters,
  type DetectionResult,
  type DetectionContext,

  // Application
  applyDefeaters,
  type ApplicationResult,

  // Resolution
  getResolutionActions,
  resolveDefeater,
  type ResolutionAction,

  // Health Assessment
  assessGraphHealth,
  type GraphHealthAssessment,

  // Full Cycle
  runDefeaterCycle,

  // Higher-order defeat (WU-THIMPL-102)
  isDefeaterActive,
  getEffectivelyActiveDefeaters,
  addMetaDefeater,
  removeMetaDefeater,

  // Transitive defeat propagation (WU-THIMPL-103)
  propagateDefeat,
  applyTransitiveDefeat,
  getDependencyGraph,
  type AffectedClaim,

  // Defeater-ConfidenceValue integration (WU-THIMPL-104)
  applyDefeaterToConfidence,
  applyDefeatersToConfidence,
  findDefeatersInConfidence,
  removeDefeaterFromConfidence,
  type DefeaterApplicationResult,

  // Untrusted content detection (WU-THIMPL-105)
  detectUntrustedContent,
  createUntrustedContentDefeater,
  type UntrustedContentResult,

  // Dependency drift detection (WU-THIMPL-106)
  detectDependencyDrift,
  createDependencyDriftDefeater,
  type DependencyInfo,
  type DependencyDriftResult,

  // Bayesian defeat reduction (WU-THIMPL-202)
  computeDefeatedStrength,
  computeMultipleDefeatedStrength,
  DEFAULT_DEFEAT_REDUCTION_OPTIONS,
  type DefeatReductionOptions,

  // Fixed-point defeater resolution (Grounded Semantics)
  buildDefeaterGraph,
  computeGroundedExtension,
  resolveDefeaterCycles,
  detectDefeaterCycles,
  isExtensionComplete,
  getDefeaterGroundedStatus,
  type DefeaterGraph,
  type GroundedExtension,
} from './defeaters.js';

// Computed Confidence
export {
  // Constants
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  COMPONENT_WEIGHTS,

  // Core computation
  computeConfidence,
  computeConfidenceBatch,
  computeConfidenceStats,

  // Entity adapters
  extractSignalsFromFunction,
  extractSignalsFromFile,
  extractSignalsFromContextPack,

  // Types
  type ConfidenceSignals,
  type ComputedConfidenceResult,
} from './computed_confidence.js';

// Claim-outcome tracking (Track F C1)
export {
  ClaimOutcomeTracker,
  createClaimOutcomeTracker,
  type ClaimOutcomeCategory,
  type TrackClaimInput,
  type RecordOutcomeInput,
  type ClaimOutcomeTrackerConfig,
  type OutcomeCalibrationOptions,
} from './outcomes.js';

// Calibration curve computation (Track F C2)
export {
  computeCalibrationCurve,
  buildCalibrationReport,
  snapshotCalibrationReport,
  restoreCalibrationReport,
  adjustConfidenceScore,
  // Proper scoring rules
  computeBrierScore,
  computeLogLoss,
  // Confidence interval computation
  computeWilsonInterval,
  // Isotonic calibration (WU-THIMPL-112)
  isotonicCalibration,
  applyIsotonicMapping,
  type CalibrationPoint,
  type CalibratedMapping,
  // Bootstrap calibration (WU-THIMPL-113)
  bootstrapCalibration,
  bayesianSmooth,
  applyBootstrapCalibration,
  type CalibrationConfig,
  // PAC-based sample thresholds (WU-THIMPL-208)
  computeMinSamplesForCalibration,
  computeAchievableAccuracy,
  checkCalibrationRequirements,
  type PACThresholdResult,
  // Core types
  type CalibrationSample,
  type CalibrationBucket,
  type CalibrationCurve,
  type CalibrationReport,
  type CalibrationReportSnapshot,
  type CalibrationCurveOptions,
  type CalibrationAdjustmentOptions,
  type CalibrationAdjustmentResult,
  type ScoringPrediction,
  // SmoothECE (WU-THIMPL-211)
  computeSmoothECE,
  DEFAULT_SMOOTH_ECE_OPTIONS,
  type SmoothECEOptions,
} from './calibration.js';

// Quantification invariant helpers (DEPRECATED - use ConfidenceValue instead)
export {
  /** @deprecated Use ConfidenceValue from confidence.ts instead */
  type QuantificationSource,
  /** @deprecated Use ConfidenceValue from confidence.ts instead */
  type QuantifiedValue,
  /** @deprecated Use ConfidenceValue from confidence.ts instead */
  type QuantifiedValueLike,
  /** @deprecated Use isConfidenceValue from confidence.ts instead */
  isQuantifiedValue,
  /** @deprecated Use getNumericValue from confidence.ts instead */
  resolveQuantifiedValue,
  /** @deprecated Use absent() from confidence.ts instead - placeholder() allows arbitrary numbers */
  placeholder,
  configurable,
  calibrated,
  derived,
} from './quantification.js';

// Principled Confidence System (CANONICAL - replaces QuantifiedValue)
export {
  // Core type
  type ConfidenceValue,
  type DeterministicConfidence,
  type DerivedConfidence,
  type MeasuredConfidence,
  type BoundedConfidence,
  type AbsentConfidence,

  // Typed Formula AST (WU-THIMPL-201)
  type FormulaNode,
  type FormulaValueNode,
  type FormulaMinNode,
  type FormulaMaxNode,
  type FormulaProductNode,
  type FormulaSumNode,
  type FormulaScaleNode,
  formulaToString,
  evaluateFormula,
  createFormula,
  isFormulaNode,

  // Type guards
  isConfidenceValue,
  isDeterministicConfidence,
  isDerivedConfidence,
  isMeasuredConfidence,
  isBoundedConfidence,
  isAbsentConfidence,

  // Derivation rules (D1-D6)
  syntacticConfidence,
  sequenceConfidence,
  parallelAllConfidence,
  parallelAnyConfidence,
  uncalibratedConfidence,
  measuredConfidence,
  type CalibrationResult,
  adjustConfidenceValue,
  type ConfidenceAdjustmentResult,

  // Calibration status tracking (WU-THIMPL-101)
  type CalibrationStatus,
  computeCalibrationStatus,
  deriveSequentialConfidence,
  deriveParallelConfidence,

  // Correlation-aware derivation (WU-THIMPL-117)
  type CorrelationOptions,
  deriveParallelAllConfidence,
  deriveParallelAnyConfidence,
  // Relaxed Absent handling for OR (WU-THIMPL-213)
  type ParallelAnyOptions,

  // Degradation handlers
  getNumericValue,
  getEffectiveConfidence,
  selectWithDegradation,
  checkConfidenceThreshold,
  reportConfidenceStatus,
  type ExecutionBlockResult,
  type ConfidenceStatusReport,

  // Factory functions
  deterministic,
  bounded,
  absent,

  // D7 boundary enforcement utilities
  combinedConfidence,
  applyDecay,
  andConfidence,
  orConfidence,
  meetsThreshold,
  assertConfidenceValue,
} from './confidence.js';

// Evidence Ledger (append-only epistemic event log)
export {
  // Branded types
  type EvidenceId,
  type SessionId,
  createEvidenceId,
  createSessionId,

  // Stable Entry IDs (WU-LEDG-007)
  type EvidenceHashInput,
  computeEvidenceHash,
  createContentAddressableEvidenceId,

  // Evidence kinds
  type EvidenceKind,

  // Evidence relations (WU-LEDG-005)
  type EvidenceRelationType,
  type EvidenceRelation,
  getRelatedIds,
  getTypedRelations,
  hasTypedRelations,
  getRelationsByType,

  // Provenance
  type ProvenanceSource,
  type EvidenceProvenance,

  // Payload types
  type CodeLocation,
  type ExtractionEvidence,
  type RetrievalEvidence,
  type SynthesisEvidence,
  type ClaimEvidence,
  type VerificationEvidence,
  type ContradictionEvidence,
  type FeedbackEvidence,
  type OutcomeEvidence,
  type ToolCallEvidence,
  type EpisodeEvidence,
  type CalibrationEvidence,
  type EvidencePayload,

  // Entry and chain
  type EvidenceEntry,
  type EvidenceChain,

  // Propagation rules (WU-THIMPL-108)
  type PropagationRule,
  type ChainConfidenceOptions,

  // Query interface
  type EvidenceQuery,
  type EvidenceFilter,
  type Unsubscribe,

  // Ledger interface
  type IEvidenceLedger,

  // Implementation
  SqliteEvidenceLedger,
  createEvidenceLedger,

  // Agent attribution validation (WU-THIMPL-109)
  type AgentAttributionConfig,
  DEFAULT_AGENT_ATTRIBUTION_CONFIG,
  MissingAgentAttributionError,
  validateAgentAttribution,
  type AgentAttributionWarningCallback,

  // Replay session (WU-LEDG-006)
  ReplaySession,
  type ReplayIntegrityResult,

  // Deterministic replay mode (WU-THIMPL-205)
  replaySession,
  DEFAULT_REPLAY_OPTIONS,
  type ReplayOptions,
  type ReplayProgress,
  type ReplayEntryResult,
  type ReplayResult,
} from './evidence_ledger.js';

// Primitive Contracts (design-by-contract for technique primitives)
export {
  // Branded types
  type ContractId,
  type PrimitiveId,
  createContractId,
  createPrimitiveId,

  // Execution context
  type ProviderStatus,
  type ExecutionBudget,
  type ExecutionContext,

  // Condition results
  type PreconditionResult,
  type PostconditionResult,
  type InvariantResult,

  // Conditions
  type Precondition,
  type Postcondition,
  type Invariant,

  // Confidence derivation
  type ConfidenceFactorSource,
  type ConfidenceFactor,
  type ConfidenceCombiner,
  type ConfidenceDerivationSpec,

  // Error handling
  type ExpectedError,
  type RetryPolicy,
  type ErrorSpec,
  type UnexpectedErrorBehavior,

  // Performance
  type PerformanceBounds,

  // Contract
  type PrimitiveContract,

  // Registry
  type IContractRegistry,
  getContractRegistry,
  getGlobalContractRegistry,
  registerContract,
  getContract,
  resetContractRegistry,

  // Violation
  type ViolationType,
  ContractViolation,
  ContractViolationError,
  type ContractWarning,
  type ContractVerification,
  type ContractExecution,
  type ContractResult,
  type IContractExecutor,
  ContractExecutor,
  createContractExecutor,

  // Validation
  type ContractValidationResult,
  type ContractValidationError,
  type ContractValidationWarning,
  validateContract,

  // Factory
  type CreateContractOptions,
  createContract,

  // Defaults and helpers
  DEFAULT_RETRY_POLICY,
  DEFAULT_ERROR_SPEC,
  DEFAULT_CONFIDENCE_DERIVATION,
  createPrecondition,
  createPostcondition,
  createInvariant,
  createConfidenceFactor,
  createExpectedError,

  // Built-in primitive contracts
  SYNTACTIC_CONFIDENCE_CONTRACT,
  SEQUENCE_CONFIDENCE_CONTRACT,
  PARALLEL_ALL_CONFIDENCE_CONTRACT,
  PARALLEL_ANY_CONFIDENCE_CONTRACT,
  UNCALIBRATED_CONFIDENCE_CONTRACT,
  MEASURED_CONFIDENCE_CONTRACT,
  CALIBRATION_ADJUSTMENT_CONTRACT,
  EVIDENCE_LEDGER_APPEND_CONTRACT,
  EVIDENCE_LEDGER_QUERY_CONTRACT,
  registerBuiltInContracts,
} from './contracts.js';

// Defeater-Ledger Integration
export {
  // Configuration
  type DefeaterLedgerConfig,

  // Events
  type DefeaterDetectionEvent,
  type DefeaterApplicationEvent,

  // Bridge
  DefeaterLedgerBridge,
  createDefeaterLedgerBridge,
} from './defeater_ledger.js';

// Causal Reasoning
export {
  // Core types
  type CausalNode,
  type CausalEdge,
  type CausalGraph,
  type CausalPath,
  type CausalEvent,
  type CausalNodeType,
  type CausalEdgeType,
  type EvidenceRef,
  type CausalGraphMeta,
  type TraversalOptions,

  // Type guards
  isCausalNode,
  isCausalEdge,
  isCausalGraph,

  // Factory functions
  createCausalNode,
  createCausalEdge,
  createEmptyCausalGraph,

  // Graph manipulation
  addNodeToGraph,
  addEdgeToGraph,

  // Graph building
  buildCausalGraphFromFacts,

  // Cause finding (backward traversal)
  findCauses,
  getDirectCauses,
  findRootCauses,

  // Effect finding (forward traversal)
  findEffects,
  getDirectEffects,
  findTerminalEffects,

  // Path explanation
  explainCausation,
  hasPath,

  // Utilities
  getCausalChainDepth,
  getCycleNodes,

  // Level 2 causal inference (WU-THIMPL-110)
  type InterventionValue,
  doIntervention,
  doMultipleInterventions,

  // D-separation (WU-THIMPL-111)
  isDSeparated,
  findMinimalSeparatingSet,
} from './causal_reasoning.js';

// Evidence Ledger Adapters (WU-LEDG-001 through WU-LEDG-004)
export {
  // Types
  type ExtractionResult,
  type EvidenceAdapterOptions,
  type QueryStageEvidenceOptions,

  // MCP Audit -> Evidence Ledger (WU-LEDG-001)
  createToolCallEvidence,

  // Episodes -> Evidence Ledger (WU-LEDG-002)
  createEpisodeEvidence,

  // Query Stages -> Evidence Ledger (WU-LEDG-003)
  createRetrievalEvidence,
  createRetrievalEvidenceBatch,

  // Bootstrap Extraction -> Evidence Ledger (WU-LEDG-004)
  createExtractionEvidence,
  createExtractionEvidenceBatch,
} from './evidence_adapters.js';

// Automated Rollback Mechanism (WU-THIMPL-114)
export {
  // Types
  type SerializedState,
  type RollbackMetadata,
  type RollbackPoint,
  type RollbackManagerConfig,
  type StateProvider,
  type RollbackManager,

  // Errors
  CheckpointNotFoundError,
  CheckpointVerificationError,
  StateVersionMismatchError,
  RollbackFailedError,

  // Constants
  DEFAULT_ROLLBACK_CONFIG,
  STATE_VERSION,

  // Functions
  computeChecksum,
  verifyChecksum,

  // Implementation
  InMemoryRollbackManager,
  createRollbackManager,
  createNoopStateProvider,

  // Type guards
  isRollbackPoint,
  isSerializedState,
  isRollbackMetadata,
} from './rollback.js';

// W3C PROV Export (WU-THIMPL-203)
export {
  // Types
  type PROVDocument,
  type PROVEntity,
  type PROVActivity,
  type PROVAgent,
  type PROVRelation,
  type PROVExportOptions,

  // Export functions
  exportToPROV,
  exportToPROVJSON,
  validatePROVDocument,
  DEFAULT_PROV_EXPORT_OPTIONS,
} from './prov_export.js';

// Evidence Record Schema (WU-PROV-002)
export {
  // Constants
  EVIDENCE_RECORD_SCHEMA_VERSION,

  // Core types
  type EvidenceRecord,
  type Activity,
  type Agent,
  type EvidenceType,
  type ActivityType,
  type AgentType,
  type RecordMetadata,

  // PROV Document types
  type ProvDocument,
  type ProvEntity,
  type ProvActivity,
  type ProvAgent,
  type ProvRelation,

  // Core functions
  createRecord,
  computeContentHash,
  verifyIntegrity,
  signRecord,
  verifySignature,
  exportToProv,

  // Factory functions
  createActivity,
  createAgent,
  type CreateActivityInput,
  type CreateAgentInput,

  // Type guards
  isEvidenceRecord,
  isActivity,
  isAgent,
} from './evidence_record_schema.js';

// Proven Formula AST System (WU-THIMPL-XXX)
export {
  // Proof Terms
  type ProofTerm,
  type ProofType,
  isProofTerm,

  // AST Node Types
  type ProvenFormulaNode,
  type LiteralNode,
  type InputRefNode,
  type BinaryOpNode,
  type BinaryOp,
  type UnaryOpNode,
  type UnaryOp,
  type ConditionalNode,

  // Builder Functions
  literal,
  input,
  add,
  sub,
  mul,
  div,
  min,
  max,
  and,
  or,
  neg,
  conditional,

  // Evaluator
  evaluate,

  // Serialization
  provenFormulaToString,
  parseProvenFormula,
  type ParseError,
  isParseError,

  // Type Guards
  isLiteralNode,
  isInputRefNode,
  isBinaryOpNode,
  isUnaryOpNode,
  isConditionalNode,
  isProvenFormulaNode,

  // Integration Type
  type ProvenDerivedConfidence,
  createProvenDerivedConfidence,

  // Migration Helpers (WU-THEORY-001)
  migrateStringFormula,
  hasProvenFormula,
  createDerivedConfidenceWithProof,
} from './formula_ast.js';

// Calibration Laws (Algebraic Laws for Confidence Values)
export {
  // Semilattice law definitions
  type SemilatticeLaw,
  SEMILATTICE_LAWS,

  // Law check result
  type LawCheckResult,

  // Law verification functions
  checkAssociativity,
  checkCommutativity,
  checkIdempotence,
  checkIdentity,
  checkAbsorption,
  verifyAllLaws,

  // Calibration rules
  type CalibrationRule,
  CALIBRATION_RULES,
  applyCalibrationRule,

  // Calibration tracker
  type CalibrationTrace,
  CalibrationTracker,

  // Semilattice structure
  type Semilattice,
  ConfidenceSemilattice,

  // Helper functions
  confidenceEquals,
  createTestConfidence,
} from './calibration_laws.js';

// Task Validation - Epistemic grounding for agent tasks
export {
  // Types
  type TaskClaim,
  type TaskId,
  type TaskEpistemicGrounding,
  type TaskAlternative,
  type TaskObjection,
  type MethodCalibrationData,
  type TaskValidationCriteria,
  type TaskValidationResult,
  type TaskValidationBreakdown,
  type RemediationPlan,
  type RemediationAction,
  type GroundingContext,
  type ITaskEpistemicValidator,

  // Factory functions
  createClaimId as createTaskClaimId,
  createTaskId,

  // Presets
  ValidationPresets,

  // Implementation
  TaskEpistemicValidator,
} from './task_validation.js';

// Validation Configuration
export {
  type EpistemicPreset,
  type EpistemicValidationConfig,
  DEFAULT_EPISTEMIC_CONFIG,
  EPISTEMIC_ENV_VARS,
  getEnvConfig,
  resolveEpistemicConfig,
  getValidationCriteria,
  isEpistemicValidationEnabled,
  getCurrentValidationCriteria,
} from './validation_config.js';

// Multi-Agent Epistemology (Social Epistemology)
export {
  // Agent modeling
  type AgentProfile,
  type BeliefBasis,
  type AgentBelief,
  isAgentProfile,
  isAgentBelief,
  createAgentProfile,
  createAgentBelief,

  // Disagreement handling
  type DisagreementStrategy,
  type DisagreementResolution,
  computeDisagreementDegree,
  resolveDisagreement,

  // Belief aggregation (opinion pools)
  aggregateBeliefs,
  linearPool,
  logPool,

  // Common knowledge
  type KnowledgeLevel,
  isCommonKnowledge,
  computeMutualKnowledgeLevel,

  // Testimony evaluation
  type TestimonyEvaluationResult,
  evaluateTestimony,
  shouldAcceptTestimony,

  // Group epistemics
  type EpistemicGroup,
  createEpistemicGroup,
  computeGroupConsensus,

  // Utilities
  getAgentsWhoKnow,
  getAgentKnowledge,
  findDisagreements,
  rankByAuthority,
} from './multi_agent.js';

// Dempster-Shafer Belief Functions
export {
  // Core types
  type Frame,
  type BeliefMassFunction,
  type CombinationResult,
  type MassAssignment,

  // Subset serialization
  serializeSubset,
  deserializeSubset,

  // Creation functions
  createBeliefMass,
  createVacuousMass,
  createBayesianMass,

  // Belief and plausibility measures
  belief,
  plausibility,
  beliefInterval,
  pignisticProbability,

  // Dempster's rule of combination
  combineDempster,
  combineMultiple,

  // Conflict handling
  DEFAULT_CONFLICT_THRESHOLD,
  isConflictTooHigh,
  type ConflictSeverity,
  analyzeConflict,
  combineWithHighConflict,

  // BoundedConfidence integration
  toBoundedConfidence,
  fromBoundedConfidence,

  // Utility functions
  getFocalElements,
  specificity,
  nonSpecificity,

  // Type guards
  isBeliefMassFunction,
  isCombinationResult,
} from './belief_functions.js';

// Epistemic Progress Metrics (Information Theory)
export {
  // Entropy metrics
  shannonEntropy,
  beliefEntropy,
  differentialEntropy,

  // Information gain
  calculateInformationGain,
  type InformationGain,
  type InformationGainSignificance,

  // KL divergence and related measures
  klDivergence,
  jsDivergence,
  measureBeliefUpdate,

  // Progress reports
  generateProgressReport,
  type EpistemicProgressReport,
  type ProgressAssessment,

  // Trend analysis
  analyzeProgressTrend,
  type ProgressTrend,
  type TrendDirection,

  // Utility functions
  mutualInformation,
  measureRedundancy,
  estimateQueryValue,
} from './progress_metrics.js';

// AGM Belief Revision Theory
export {
  // Branded types
  type ClaimId as BeliefClaimId,
  createClaimId as createBeliefClaimId,

  // Core types
  type BeliefBase,
  type RevisionOperation,
  type RevisionResult,
  type PostulateCheckResult,
  type RevisionOptions,
  DEFAULT_REVISION_OPTIONS,

  // Belief base operations
  createEmptyBeliefBase,
  createBeliefBase,
  cloneBeliefBase,
  believes,
  getEntrenchment,

  // AGM operations
  expand,
  contract,
  revise,

  // Entrenchment computation
  computeEntrenchment,
  computeEntrenchmentFromConfidence,

  // Selection for contraction
  selectForContraction,
  findMinimalRemovalSet,

  // AGM postulate verification
  checkAGMPostulates,

  // Integration with confidence values
  createRevisionConfidence,

  // Batch operations
  updateAllEntrenchment,
  reviseMultiple,

  // Type guards
  isBeliefBase,
  isRevisionResult,
} from './belief_revision.js';

// Credal Sets for Imprecise Probability
export {
  // Interval arithmetic
  type Interval,
  createInterval,
  intervalContains,
  addIntervals,
  subtractIntervals,
  multiplyIntervals,
  complementInterval,
  sequenceIntervals,
  parallelIntervalsAnd,
  parallelIntervalsOr,
  intervalWidth,
  intervalMidpoint,
  isIntervalPrecise,
  isIntervalVacuous,

  // Credal set types
  type CredalSet,
  createCredalSet,
  isInCredalSet,
  vacuousCredal,
  preciseCredal,
  isVacuous,
  isPrecise,
  getOutcomeInterval,
  credalImprecision,

  // Credal operations
  marginalize,
  condition,
  naturalExtension,

  // BoundedConfidence integration
  toCredalSet,
  toBoundedFromCredal,
  confidenceToInterval,
  composeCredalBounds,
  composeConfidenceCredal,

  // Imprecision propagation
  type ImprecisionPropagationResult,
  trackImprecisionPropagation,

  // Type guards
  isInterval,
  isCredalSet,
} from './credal_sets.js';

// Universal Coherence System
export {
  // Schema version
  UNIVERSAL_COHERENCE_SCHEMA_VERSION,

  // Branded types
  type ContentId,
  type ObjectId,
  type GroundingId,
  type NetworkId,
  type AgentId,

  // ID constructors
  createContentId as createUniversalContentId,
  createObjectId,
  createGroundingId,
  createNetworkId,
  createAgentId as createUniversalAgentId,

  // Primitive types
  type ContentType,
  type ContentSchema,
  type Content,
  type AttitudeType,
  type StrengthBasis,
  type GradedStrength,
  type Attitude,
  type AgentType as UniversalAgentType,
  type TrustLevel,
  type Agent as UniversalAgent,
  type GroundingType,
  type ExtendedGroundingType,
  type GroundingStrength,
  type Grounding,
  type AbstractionLevel,
  type LevelConstraints,
  type ObjectStatus,
  type SourceDescriptor,
  type EpistemicMetadata,
  type RevisionEntry,
  type EpistemicObject,

  // Coherence network types
  type CoherenceRuleType,
  type CoherenceRule,
  type NetworkConfig,
  type CoherenceViolation,
  type CoherenceStatus,
  type CoherenceNetwork,

  // Evaluation types
  type GroundingStatus,
  type ObjectEvaluation,
  type GroundingAnalysis,
  type RecommendationType,
  type EvaluationRecommendation,
  type StakesLevel,
  type EpistemicStandards,
  type EvaluationContext,
  type CoherenceResult,
  type Conflict,
  type LevelViolation,

  // Error types
  type GroundingErrorCode,
  GroundingError,
  type NetworkErrorCode,
  NetworkError,

  // Default rules
  DEFAULT_COHERENCE_RULES,

  // Constructors
  constructContent,
  constructAttitude,
  constructEpistemicObject,
  type ConstructOptions,
  constructGrounding,
  type GroundingOptions,
  constructAbstractionLevel,
  constructHierarchy,
  constructCoherenceNetwork,
  type NetworkConstructOptions,

  // Coherence evaluation
  evaluateCoherence,
  findGroundingChain,
  detectConflicts,
  checkLevelConsistency,

  // Presets
  type PresetConfig,
  SOFTWARE_DEV_PRESET,
  SCIENTIFIC_METHOD_PRESET,
  LEGAL_REASONING_PRESET,
  PRESETS,
  type PresetKey,
  applyPreset,
  adaptPreset,

  // Auto-configuration
  type InferredStructure,
  inferStructure,
  suggestPreset,

  // Integration with Librarian epistemics
  toConfidenceValue,
  fromConfidenceValue,
  toClaim,
  fromClaim,
  storeNetworkAsEvidence,
} from './universal_coherence.js';

// Conative Attitudes (Action-directed epistemic attitudes)
export {
  // Schema version
  CONATIVE_ATTITUDES_SCHEMA_VERSION,

  // Extended attitude types
  type ConativeAttitudeType,
  type ExtendedAttitudeType,
  type PreferenceOrdering,

  // Type guards for attitude types
  isConativeAttitudeType,
  isExtendedAttitudeType,

  // Conative attitude interface
  type ConativeAttitude,
  isConativeAttitude,
  validateCommitmentStrength,
  validateDesireIntensity,

  // Conative attitude construction
  type ConativeAttitudeOptions,
  constructConativeAttitude,

  // Intention type
  type MeansEndRelation,
  type Intention,
  type IntentionStatus,
  type CreateIntentionOptions,
  isIntention,
  createIntention,
  addMeansToIntention,
  addConditionToIntention,
  updateIntentionStatus,
  areConditionsSatisfied,

  // Preference type
  type Preference,
  type CreatePreferenceOptions,
  isPreference,
  createPreference,
  isPreferred,
  getMostPreferred,
  getLeastPreferred,
  checkTransitivity,
  validatePreferenceConsistency,

  // Goal type
  type Goal,
  type GoalStatus,
  type CreateGoalOptions,
  isGoal,
  createGoal,
  addCriterionToGoal,
  addSubgoal,
  updateGoalStatus,
  isGoalAchieved,
  computeGoalProgress,

  // Desire type (including hope and fear)
  type Desire,
  isDesire,
  createDesire,
  createHope,
  createFear,

  // BDI Agent State
  type BDIAgentState,
  type CreateBDIAgentOptions,
  isBDIAgentState,
  createBDIAgentState,
  addBelief,
  addDesireToAgent,
  addIntentionToAgent,
  addGoalToAgent,
  addPreferenceToAgent,

  // Practical reasoning
  type PracticalReasoningResult,
  evaluatePracticalCoherence,
  isIntentionAchievable,
  deriveIntentionFromGoal,

  // Integration with epistemic objects
  intentionToEpistemicObject,
  goalToEpistemicObject,
  preferenceToEpistemicObject,
} from './conative_attitudes.js';

// Temporal Grounding Validity (WU-REC-7.2)
export {
  // Schema version
  TEMPORAL_GROUNDING_SCHEMA_VERSION,

  // Types
  type DecayFunction,
  type TemporalBounds,
  type TemporalGrounding,
  type TemporalPresetKey,
  type TemporalGroundingOptions,

  // Presets
  EPHEMERAL,
  SHORT_TERM,
  MEDIUM_TERM,
  LONG_TERM,
  PERMANENT,
  TEMPORAL_PRESETS,

  // Preset helpers
  createEphemeralBounds,
  createShortTermBounds,
  createMediumTermBounds,
  createLongTermBounds,

  // Core functions
  isGroundingValid,
  getGroundingStrength,
  detectStaleGroundings,
  refreshGrounding,
  applyDecay as applyTemporalDecay,

  // Construction
  constructTemporalGrounding,
  toTemporalGrounding,
  isTemporalGrounding,

  // Utilities
  getGroundingAge,
  getTimeSinceVerification,
  getRemainingValidity,
  extendValidity,
  getExpiringGroundings,
  groupByDecayFunction,
  sortByUrgency,
} from './temporal_grounding.js';

// Intuitive Grounding System (WU-REC-7.3)
export {
  // Schema version
  INTUITIVE_GROUNDING_SCHEMA_VERSION,

  // Types
  type ExtendedGroundingTypeWithIntuitive,
  type IntuitiveSource,
  type Articulability,
  type UpgradePath,
  type IntuitiveGrounding,
  type Evidence,

  // Constants
  DEFAULT_INTUITIVE_CONFIDENCE,
  INTUITIVE_CONFIDENCE_BOUNDS,
  DEFAULT_UPGRADE_PATHS,

  // Factory functions
  createIntuitiveGrounding,
  getDefaultConfidence,

  // Upgrade functions
  canUpgrade,
  findBestUpgradePath,
  upgradeGrounding,

  // Articulability functions
  isArticulable,
  getArticulabilityScore,

  // Pattern recognition helpers
  detectPattern,
  analogyFromPrior,

  // Confidence conversion
  toConfidenceValue as intuitiveToConfidenceValue,

  // Type guards
  isIntuitiveGrounding,
  isIntuitiveSource,
  isArticulability,

  // Validation
  validateIntuitiveGrounding,
} from './intuitive_grounding.js';

// Inference Auditor (Bad Agentic Logic Detection)
export {
  // Fallacy enumeration
  InferenceFallacy,
  FALLACY_DESCRIPTIONS,

  // Inference step
  type InferenceRule,
  type InferenceStep,
  createInferenceStep,

  // Audit report
  type AuditSeverity,
  type InferenceAuditReport,

  // Detection functions
  detectFallacy,
  checkCircularity,
  checkOvergeneralization,
  suggestFix,

  // Audit functions
  auditInference,
  auditChain,

  // Helper functions
  createTestContent,
  createSimpleInferenceStep,
} from './inference_auditor.js';
