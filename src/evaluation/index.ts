/**
 * @fileoverview Evaluation Module for Librarian
 *
 * Provides systematic evaluation capabilities:
 * - Retrieval quality metrics (precision, recall, F1, nDCG, MRR, MAP)
 * - Confidence calibration assessment
 * - Latency and throughput tracking
 * - Quality grading and recommendations
 *
 * @packageDocumentation
 */

export {
  type CitationEvidenceRef,
  type CitationInput,
  type CitationAccuracyInput,
  type CitationAccuracyResult,
  computeCitationAccuracy,
} from './citation_accuracy.js';

export {
  // Types
  type MetricType,
  type EvaluationQuery,
  type QueryEvaluationResult,
  type EvaluationReport,
  type AggregateMetric,
  type EvaluationSummary,
  type EvaluationConfig,

  // Constants
  DEFAULT_EVAL_CONFIG,

  // Class
  EvaluationHarness,

  // Factory
  createEvaluationHarness,
} from './harness.js';

export {
  type GroundTruthCategory,
  type GroundTruthDifficulty,
  type EvidenceRef,
  type CorrectAnswer,
  type GroundTruthQuery,
  type RepoManifest,
  type EvalCorpus,
  type EvalQueryInput,
  type RetrievalResult,
  type SynthesisResult,
  type EvalPipeline,
  type EvalOptions,
  type QueryEvalResult,
  type RetrievalEvalResult,
  type SynthesisEvalResult,
  type EvalReport,
  type EvalMetrics,
  type CategoryMetrics,
  type RegressionReport,
  type RegressionEntry,
  type EvalRunnerDependencies,
  DEFAULT_EVAL_K_VALUES,
  EvalRunner,
  createEvalRunner,
} from './runner.js';

export {
  type QualityDashboard,
  type DashboardSummary,
  buildQualityDashboard,
  renderQualityDashboardMarkdown,
} from './dashboard.js';

export {
  // Types
  type ASTFactType,
  type ASTFact,
  type FunctionDefDetails,
  type ImportDetails,
  type ExportDetails,
  type ClassDetails,
  type CallDetails,
  type TypeDetails,

  // Class
  ASTFactExtractor,

  // Factory
  createASTFactExtractor,
} from './ast_fact_extractor.js';

export {
  // Types
  type StructuralQueryCategory,
  type StructuralQueryDifficulty,
  type AnswerType,
  type StructuralGroundTruthAnswer,
  type StructuralGroundTruthQuery,
  type GroundTruthCoverage,
  type StructuralGroundTruthCorpus,

  // Class
  GroundTruthGenerator,

  // Factory
  createGroundTruthGenerator,
} from './ground_truth_generator.js';

export {
  // Types
  type Citation,
  type VerificationReason,
  type CitationVerificationResult,
  type CitationVerificationReport,

  // Class
  CitationVerifier,

  // Factory
  createCitationVerifier,
} from './citation_verifier.js';

export {
  // Types
  type QueryVariant,
  type QuerySet,
  type ConsistencyAnswer,
  type ConsistencyViolation,
  type ConsistencyReport,

  // Class
  ConsistencyChecker,

  // Factory
  createConsistencyChecker,
} from './consistency_checker.js';

export {
  // Types
  type AdversarialCategory,
  type AdversarialSeverity,
  type AdversarialExample,
  type AdversarialPattern,
  type AdversarialCorpus,
  type AdversarialProbe,
  type AdversarialTestResult,

  // Class
  AdversarialPatternLibrary,

  // Factory
  createAdversarialPatternLibrary,
} from './adversarial_patterns.js';

export {
  // Types
  type SizeMetrics,
  type ComplexityMetrics,
  type QualityIndicators,
  type StructureIndicators,
  type RiskIndicators,
  type SizeClassification,
  type QualityTier,
  type CodebaseProfile,

  // Class
  CodebaseProfiler,

  // Factory
  createCodebaseProfiler,
} from './codebase_profiler.js';

export {
  // Types
  type FactorImpact,
  type QualityFactor,
  type ConfidenceInterval,
  type QualityPrediction,

  // Class
  QualityPredictionModel,

  // Factory
  createQualityPredictionModel,
} from './quality_prediction.js';

export {
  // Types
  type CitationRequirement,
  type HedgingLevel,
  type VerificationStatus,
  type SynthesisStrategy,
  type AdaptiveSynthesisConfig,
  type SynthesisContext,
  type SynthesisMetadata,
  type SynthesizedResponse,

  // Constants
  DEFAULT_SYNTHESIS_STRATEGIES,
  DEFAULT_ADAPTIVE_SYNTHESIS_CONFIG,

  // Class
  AdaptiveSynthesizer,

  // Factory
  createAdaptiveSynthesizer,
} from './adaptive_synthesis.js';

export {
  // Types
  type DisclosureLevel,
  type DisclosureVerbosity,
  type DisclosureFormatStyle,
  type QualityDisclosure,
  type DisclosureConfig,
  type FormattedDisclosure,

  // Constants
  DEFAULT_DISCLOSURE_CONFIG,

  // Class
  QualityDisclosureGenerator,

  // Factory
  createQualityDisclosureGenerator,
} from './quality_disclosure.js';

export {
  // Types
  type DeadCodeType,
  type DeadCodeCandidate,
  type DeadCodeSummary,
  type DeadCodeReport,

  // Class
  DeadCodeDetector,

  // Factory
  createDeadCodeDetector,
} from './dead_code_detector.js';

export {
  // Types
  type RedFlagType,
  type RedFlagSeverity,
  type RedFlag,
  type RedFlagSummary,
  type RedFlagReport,

  // Class
  RedFlagDetector,

  // Factory
  createRedFlagDetector,
} from './red_flag_detector.js';

export {
  // Types
  type CitationValidationResult,
  type ValidationPipelineConfig,
  type ValidationPipelineResult,

  // Constants
  DEFAULT_VALIDATION_CONFIG,

  // Class
  CitationValidationPipeline,

  // Factory
  createCitationValidationPipeline,
} from './citation_validation_pipeline.js';

export {
  // Types
  type IterativeRetrievalResultItem,
  type RetrievalRound,
  type IterativeRetrievalConfig,
  type IterativeRetrievalResult,

  // Constants
  DEFAULT_ITERATIVE_CONFIG,

  // Class
  IterativeRetriever,

  // Factory
  createIterativeRetriever,
} from './iterative_retrieval.js';

export {
  // Types (legacy)
  type CommentCodePair,
  type MismatchResult,
  type CommentCodeReport,

  // Types (WU-CONTRA-001)
  type CommentAnalysis,
  type ConsistencyIssue,
  type ConsistencyReport as CommentConsistencyReport,

  // Class
  CommentCodeChecker,

  // Factory
  createCommentCodeChecker,
} from './comment_code_checker.js';

export {
  // Types
  type ClaimType,
  type EntailmentVerdict,
  type EvidenceType,
  type Claim,
  type EntailmentEvidence,
  type EntailmentResult,
  type EntailmentReport,

  // Class
  EntailmentChecker,

  // Factory
  createEntailmentChecker,
} from './entailment_checker.js';

export {
  // Types
  type TestCase,
  type VerificationStrength,
  type TestBasedVerification,
  type TestVerificationReport,

  // Class
  TestBasedVerifier,

  // Factory
  createTestBasedVerifier,
} from './test_based_verifier.js';

export {
  // Types
  type ConsistencyCheckConfig,
  type ConsistencyScores,
  type ConfidenceLevel,
  type ConsistencyCheckResult,

  // Constants
  DEFAULT_CONSISTENCY_CHECK_CONFIG,

  // Class
  ComprehensiveConsistencyChecker,

  // Factory
  createComprehensiveConsistencyChecker,
} from './comprehensive_consistency.js';

export {
  // Types
  type VerificationInput,
  type VerificationQuestion,
  type VerificationAnswer,
  type VerificationResult as ChainVerificationResult,
  type Inconsistency,
  type ChainOfVerificationConfig,

  // Constants
  DEFAULT_CHAIN_OF_VERIFICATION_CONFIG,

  // Class
  ChainOfVerification,

  // Factory
  createChainOfVerification,
} from './chain_of_verification.js';

export {
  // Types
  type MiniCheckScore,
  type ClaimScore,
  type MiniCheckConfig,

  // Constants
  DEFAULT_MINICHECK_CONFIG,

  // Class
  MiniCheckScorer,

  // Factory
  createMiniCheckScorer,
} from './minicheck_scorer.js';

export {
  // Types
  type GroundingCheck,
  type GroundingResult,
  type SupportingEvidence,
  type BatchGroundingResult,
  type GroundingMetrics,
  type MiniCheckVerifierConfig,

  // Constants
  DEFAULT_MINICHECK_VERIFIER_CONFIG,

  // Class
  MiniCheckVerifier,

  // Factory
  createMiniCheckVerifier,
} from './minicheck_integration.js';

export {
  // Types
  type Claim as CausalClaim,
  type Outcome,
  type AttributionResult,
  type AttributionReport,
  type ClaimImpact,

  // Class
  CausalAttributor,

  // Factory
  createCausalAttributor,
} from './causal_attribution.js';

export {
  // Types
  type EvidenceType as StalenessEvidenceType,
  type StalenessEvidence,
  type StalenessAssessment,
  type ChangeFrequencyProfile,
  type StalenessConfig,

  // Constants
  DEFAULT_STALENESS_CONFIG,

  // Class
  EvidenceBasedStaleness,

  // Factory
  createEvidenceBasedStaleness,
} from './evidence_based_staleness.js';

export {
  // Types
  type IndexedClaim,
  type IndexedOutcome,
  type ClaimOutcomeRelation,
  type CalibrationQuery,
  type CalibrationDataPoint,

  // Class
  ClaimOutcomeIndex,

  // Factory
  createClaimOutcomeIndex,
} from './claim_outcome_index.js';

export {
  // Types
  type HealthStatus,
  type TrendDirection,
  type ComponentScore,
  type HealthScoreConfig,
  type AggregateHealthScore,
  type HealthHistory,

  // Constants
  DEFAULT_HEALTH_SCORE_CONFIG,

  // Class
  HealthScoreComputer,

  // Factory
  createHealthScoreComputer,
} from './health_score.js';

export {
  // Types
  type PredictionOutcome,
  type ReliabilityBin,
  type ReliabilityDiagram,
  type CalibrationTimeSeries,
  type DashboardSnapshot,
  type CalibrationAlert,
  type CalibrationSummary,
  type CalibrationDashboardConfig,
  type DataPointFilter,

  // Constants
  DEFAULT_CALIBRATION_CONFIG,

  // Class
  CalibrationDashboard,

  // Factory
  createCalibrationDashboard,
} from './calibration_dashboard.js';

export {
  // Types
  type ClaimType as CalibrationClaimType,
  type TypeCalibrationData,
  type CalibrationCurve,
  type CalibrationAdjustment,
  type TypeComparisonResult,
  type ClaimTypeCalibratorOptions,

  // Class
  ClaimTypeCalibrator,

  // Factory
  createClaimTypeCalibrator,
} from './claim_type_calibration.js';

export {
  // Types
  type IRCoTInput,
  type IRCoTOutput,
  type ReasoningStep,
  type RetrievalDecision as IRCoTRetrievalDecision,
  type IRCoTConfig,

  // Constants
  DEFAULT_IRCOT_CONFIG,

  // Class
  IRCoTRetriever,

  // Factory
  createIRCoTRetriever,
} from './ircot_retrieval.js';

export {
  // Types
  type RetrievalResult as HybridRetrievalResult,
  type FusionConfig,
  type HybridRetrievalInput,
  type HybridRetrievalOutput,
  type FusedResult,

  // Constants
  DEFAULT_FUSION_CONFIG,

  // Class
  HybridRetriever,

  // Factory
  createHybridRetriever,
} from './hybrid_retrieval.js';

export {
  // Types
  type ContextChunk,
  type ReorderingStrategy,
  type ReorderedContext,
  type PositionAnalysis,

  // Class
  PositionBiasManager,

  // Factory
  createPositionBiasManager,
} from './position_bias.js';

export {
  // Types
  type EmbeddingSource,
  type FusionStrategy,
  type FusionInput,
  type FusedEmbedding,
  type FusionMetrics,

  // Class
  EmbeddingFusion,

  // Factory
  createEmbeddingFusion,
} from './embedding_fusion.js';

export {
  // Types
  type FailureCase,
  type CorpusStats,
  type CorpusConfig,
  type FailureAnalysis,
  type FailurePattern,

  // Class
  FailureCorpus,

  // Factory
  createFailureCorpus,
} from './failure_corpus.js';

export {
  // Types
  type RAGASInput,
  type RAGASOutput,
  type FaithfulnessResult,
  type ClaimAnalysis,
  type ContextPrecisionResult,
  type ContextRelevanceInfo,
  type ContextRecallResult,
  type AttributedClaim,
  type AnswerRelevanceResult,

  // Class
  RAGASMetrics,

  // Factory
  createRAGASMetrics,
} from './ragas_metrics.js';

export {
  // Types
  type SymbolType,
  type SymbolReference,
  type SymbolVerificationResult,
  type VerificationReport,
  type CodebaseIndex,

  // Class
  SymbolVerifier,

  // Factory
  createSymbolVerifier,
} from './symbol_verifier.js';

export {
  // Types
  type SamplingConfig,
  type ResponseSample,
  type ConsistencyResult,
  type Agreement,
  type Contradiction,
  type InconsistencyDetectionResult,

  // Constants
  DEFAULT_SAMPLING_CONFIG,

  // Class
  SelfConsistencyChecker,

  // Factory
  createSelfConsistencyChecker,
} from './self_consistency.js';

export {
  // Types
  type ContextQualityResult,
  type ContextQualityConfig,
  type EvaluateOptions as ContextEvaluateOptions,
  type ContextQualityEvaluator,

  // Factory
  createContextQualityEvaluator,
} from './context_precision_recall.js';

export {
  // Types
  type ASTChunkType,
  type ASTChunk,
  type ASTChunkerConfig,
  type ASTChunker,

  // Factory
  createASTChunker,
} from './ast_chunking.js';

export {
  // Types
  type KnowledgeTriplet,
  type Predicate,
  type TripletVerificationResult,
  type TripletExtractorConfig,
  type Claim as TripletClaim,
  type TripletExtractor,

  // Factory
  createTripletExtractor,
} from './refchecker_triplets.js';

export {
  // Types
  type ClaimType as AtomicClaimType,
  type AtomicClaim,
  type DecompositionStats,
  type ClaimDecomposerConfig,
  type ClaimDecomposer,

  // Constants
  DEFAULT_DECOMPOSER_CONFIG,

  // Factory
  createClaimDecomposer,
} from './atomic_claims.js';

export {
  // Types
  type ConfidenceSignal,
  type ActiveRetrievalConfig,

  // Constants
  DEFAULT_ACTIVE_RETRIEVAL_CONFIG,

  // Class
  ActiveRetriever,

  // Factory
  createActiveRetriever,
} from './flare_retrieval.js';

export {
  // Types
  type CoverageData,
  type DeadCodeEvidence,
  type DynamicCoverageIntegrator,

  // Factory
  createDynamicCoverageIntegrator,
} from './dynamic_coverage.js';

export {
  // Types
  type Citation as VerificationCitation,
  type VerificationResult,
  type VerificationMethod,
  type CitationVerificationConfig,
  type GroundingStats,
  type CitationVerificationPipeline,

  // Constants
  DEFAULT_CITATION_VERIFICATION_CONFIG,

  // Factory
  createCitationVerificationPipeline,
} from './citation_verification.js';

export {
  // Types
  type RepoNodeType,
  type RepoEdgeType,
  type RepoNode,
  type RepoEdge,
  type RepoGraph,

  // Factory
  createRepoGraph,
} from './repo_graph.js';

export {
  // Types
  type RegistryType,
  type PackageInfo,
  type PackageVerifierConfig,
  type CacheStats,
  type PackageVerifier,

  // Factory
  createPackageVerifier,
} from './package_existence.js';

export {
  // Types
  type UsefulnessLevel,
  type RetrievalCritique,
  type ResponseCritique,
  type RetrievalDecision,
  type CritiqueStats,
  type SelfRAGConfig,
  type SelfRAGCritiquer,

  // Constants
  DEFAULT_SELFRAG_CONFIG,

  // Factory
  createSelfRAGCritiquer,
} from './selfrag_critique.js';

export {
  // Types
  type LineReference,
  type IssueType,
  type VerificationIssue,
  type ClaimVerificationResult,
  type ASTClaimVerifierConfig,
  type VerificationStats,

  // Class
  ASTClaimVerifier,

  // Factory
  createASTClaimVerifier,
} from './ast_claim_verifier.js';

export {
  // Types
  type CPGNodeType,
  type CPGEdgeType,
  type CPGNode,
  type CPGEdge,
  type CodePropertyGraph,
  type GraphQuery,
  type QueryResult,

  // Class
  CodePropertyGraphBuilder,

  // Factory
  createCodePropertyGraphBuilder,
} from './code_property_graph.js';

export {
  // Types
  type UncertaintyType,
  type UncertaintySignal,
  type RetrievalDecision as DRAGINRetrievalDecision,
  type ActiveRetrievalResult,
  type DynamicRetrievalResult,
  type DRAGINConfig,

  // Constants
  DEFAULT_DRAGIN_CONFIG,

  // Functions
  computeUncertaintySignals,
  detectRetrievalNeed,
  triggerDynamicRetrieval,

  // Class
  DRAGINRetriever,

  // Factory
  createDRAGINRetriever,
} from './active_retrieval.js';

export {
  // Types
  type BugCategory,
  type BugDifficulty,
  type BugLocation,
  type BugInjection,
  type BugInjectorConfig,
  type InjectionManifest,
  type CorpusItem,
  type InjectionStats,

  // Class
  BugInjector,

  // Standalone functions
  injectBug,
  injectRandomBug,
  describeBug,
  revertBug,

  // Factory
  createBugInjector,
} from './bug_injector.js';

export {
  // Types
  type FactType,
  type SearchStrategy,
  type AtomicFact,
  type SearchResult,
  type FactVerification,
  type SAFEResult,
  type SAFEConfig,
  type SearchOptions,

  // Constants
  DEFAULT_SAFE_CONFIG,

  // Functions
  decomposeClaim,
  generateSearchQueries,
  searchForEvidence,
  evaluateEvidence,
  aggregateVerdict,

  // Class
  SAFEVerifier,

  // Factory
  createSAFEVerifier,
} from './search_augmented_verification.js';
