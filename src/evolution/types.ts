/**
 * @fileoverview EvolutionOps Type Definitions
 *
 * Types for the self-evolution system:
 * - FitnessReport.v1 schema
 * - Variant representation
 * - Archive cells
 * - Emitter interfaces
 * - Budget tracking
 *
 * @packageDocumentation
 */

// ============================================================================
// FITNESS REPORT (Multi-Objective)
// ============================================================================

/**
 * FitnessReport.v1 - Multi-objective fitness vector for Librarian evaluation.
 */
export interface FitnessReport {
  kind: 'FitnessReport.v1';
  schemaVersion: 1;
  generatedAt: string;

  /** Variant being evaluated (null for baseline) */
  variantId: string | null;

  /** Scope of evaluation */
  scope: {
    repository: string;
    subsystem: string;
    commitHash: string;
  };

  /** Staged evaluation results */
  stages: {
    stage0_static: StageResult;
    stage1_tier0: StageResult;
    stage2_tier1: StageResult;
    stage3_tier2: StageResult;
    stage4_adversarial: StageResult;
  };

  /** Multi-objective fitness vector */
  fitness: FitnessVector;

  /** Behavior descriptors for MAP-Elites */
  behaviorDescriptors: BehaviorDescriptors;

  /** Resource usage */
  resources: ResourceUsage;

  /**
   * Explicit measurement completeness for dimensions that may be skipped due to
   * budget constraints or missing measurement artifacts.
   */
  measurementCompleteness?: MeasurementCompleteness;

  /**
   * Measurement integrity of the fitness score itself.
   * If status is unverified_by_trace, overall fitness is informational only.
   */
  scoringIntegrity: FitnessScoringIntegrity;

  /** Differential comparison to baseline (if applicable) */
  baselineDelta?: FitnessDelta;
}

/**
 * Measurement completeness by fitness dimension family.
 */
export interface MeasurementCompleteness {
  retrievalQuality: DimensionMeasurementCompleteness;
  epistemicQuality: DimensionMeasurementCompleteness;
  operationalQuality: DimensionMeasurementCompleteness;
}

/**
 * Integrity metadata for fitness scoring.
 */
export interface FitnessScoringIntegrity {
  status: 'measured' | 'unverified_by_trace';
  measuredFamilies: number;
  totalFamilies: number;
  coverageRatio: number;
  reasons: string[];
}

/**
 * Completeness metadata for a single dimension family.
 */
export interface DimensionMeasurementCompleteness {
  measured: boolean;
  reason?: 'missing_or_budget_skipped' | 'zero_query_coverage' | 'missing_metrics';
  queryCount?: number;
}

/**
 * Multi-objective fitness dimensions.
 */
export interface FitnessVector {
  /** Correctness: tier gates pass, schema-valid, determinism */
  correctness: {
    tier0PassRate: number;
    tier1PassRate: number;
    tier2PassRate: number;
    schemaValid: boolean;
    deterministicVerified: boolean;
  };

  /** Retrieval quality: Recall@k, nDCG, precision */
  retrievalQuality: {
    recallAt5: number;
    recallAt10: number;
    precisionAt5: number;
    nDCG: number;
    mrr: number;
  };

  /** Epistemic quality: evidence coverage, defeaters, calibration */
  epistemicQuality: {
    evidenceCoverage: number;
    defeaterCorrectness: number;
    calibrationError: number;
    claimVerificationRate: number;
  };

  /** Operational quality: latency, bootstrap time, cache */
  operationalQuality: {
    queryLatencyP50Ms: number;
    queryLatencyP99Ms: number;
    bootstrapTimeSeconds: number;
    cacheHitRate: number;
    freshnessLagSeconds: number;
  };

  /** Security robustness: injection resistance, provenance */
  securityRobustness: {
    injectionResistance: number;
    provenanceLabeling: number;
    failClosedBehavior: boolean;
  };

  /** Cost efficiency: tokens, embeddings, recovery budget */
  costEfficiency: {
    tokenUsage: number;
    embeddingCalls: number;
    providerCalls: number;
    recoveryBudgetCompliance: boolean;
  };

  /** Overall score (Pareto-weighted) */
  overall: number;
}

/**
 * Behavior descriptors for Quality-Diversity archiving.
 */
export interface BehaviorDescriptors {
  /** Latency bucket */
  latencyBucket: 'fast' | 'medium' | 'slow';

  /** Token cost bucket */
  tokenCostBucket: 'low' | 'medium' | 'high';

  /** Evidence completeness bucket */
  evidenceCompletenessBucket: 'low' | 'medium' | 'high';

  /** Calibration bucket */
  calibrationBucket: 'low' | 'medium' | 'high';

  /** Retrieval strategy signature */
  retrievalStrategy: 'lexical-heavy' | 'semantic-heavy' | 'graph-heavy' | 'balanced';

  /** Provider reliance level */
  providerReliance: 'deterministic-only' | 'light-llm' | 'heavy-llm';
}

/**
 * Fitness delta for differential comparison.
 */
export interface FitnessDelta {
  baselineId: string;
  improvements: string[];
  regressions: string[];
  neutral: string[];
  isParetoImprovement: boolean;
}

// ============================================================================
// STAGED EVALUATION
// ============================================================================

/**
 * Stage evaluation result.
 */
export interface StageResult {
  status: 'passed' | 'failed' | 'skipped' | 'unverified_by_trace';
  reason?: string;
  metrics: Record<string, number | boolean | string>;
  durationMs: number;
  artifacts: string[];
}

/**
 * Staged evaluator interface.
 */
export interface StagedEvaluator {
  stage: 0 | 1 | 2 | 3 | 4;
  name: string;
  run(variant: Variant, context: EvaluationContext): Promise<StageResult>;
  estimatedCost: {
    tokens: number;
    embeddings: number;
    providerCalls: number;
  };
}

/**
 * Evaluation context passed to evaluators.
 */
export interface EvaluationContext {
  workspaceRoot: string;
  baselineReport?: FitnessReport;
  budget: EvaluationBudget;
  providerAvailable: boolean;
  /**
   * Optional override for workspace database path. When omitted, evaluators that
   * need storage-level state should attempt to resolve it relative to workspaceRoot.
   */
  dbPath?: string;
  /**
   * Optional retrieval evaluation configuration used to generate measured
   * retrieval metrics for fitness scoring.
   */
  retrievalEval?: {
    enabled?: boolean;
    corpusPath?: string;
    corpusPaths?: string[];
    maxRepos?: number;
    maxQueries?: number;
    parallel?: number;
    timeoutMs?: number;
  };
}

/**
 * Evaluation budget constraints.
 */
export interface EvaluationBudget {
  maxTokens: number;
  maxEmbeddings: number;
  maxProviderCalls: number;
  maxDurationMs: number;
}

// ============================================================================
// VARIANTS
// ============================================================================

/**
 * Variant - A candidate configuration/mutation for evaluation.
 */
export interface Variant {
  id: string;
  parentId: string | null;
  emitterId: string;
  createdAt: string;

  /** Genotype: what was changed */
  genotype: VariantGenotype;

  /** Mutation description */
  mutationDescription: string;

  /** Evaluation status */
  evaluated: boolean;
  fitnessReport?: FitnessReport;
}

/**
 * Genotype space - what can be evolved.
 */
export interface VariantGenotype {
  /** Retrieval parameters */
  retrievalParams?: {
    lexicalWeight?: number;
    semanticWeight?: number;
    graphWeight?: number;
    coChangeBoost?: number;
    rerankerThreshold?: number;
    graphExpansionDepth?: number;
  };

  /** Prompt template versions */
  promptTemplates?: {
    purposeExtraction?: string;
    mechanismExtraction?: string;
    contractExtraction?: string;
    contradictionDetection?: string;
    methodPackGeneration?: string;
  };

  /** Budget and recovery thresholds */
  budgetThresholds?: {
    maxTokensPerHour?: number;
    maxEmbeddingsPerHour?: number;
    confidenceDecayRate?: number;
    recoveryTriggerThreshold?: number;
  };

  /** Evaluation set modifications */
  evaluationSet?: {
    addedScenarios?: string[];
    removedScenarios?: string[];
    metamorphicTransforms?: string[];
  };

  /** Code patches (high scrutiny) */
  codePatches?: Array<{
    file: string;
    diff: string;
    targetTest: string;
    rationale: string;
  }>;
}

// ============================================================================
// ARCHIVE (MAP-Elites)
// ============================================================================

/**
 * Archive cell key based on behavior descriptors.
 */
export type ArchiveCellKey = string;

/**
 * Archive cell containing the best variant for a behavior region.
 */
export interface ArchiveCell {
  key: ArchiveCellKey;
  descriptors: BehaviorDescriptors;
  variant: Variant;
  fitness: number;
  addedAt: string;
  replacementCount: number;
}

/**
 * Archive state for persistence.
 */
export interface ArchiveState {
  kind: 'EvolutionArchive.v1';
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  cells: ArchiveCell[];
  totalEvaluations: number;
  totalImprovements: number;
}

// ============================================================================
// EMITTERS
// ============================================================================

/**
 * Emitter interface for mutation strategies.
 */
export interface Emitter {
  id: string;
  name: string;
  description: string;

  /** Generate a candidate variant */
  emit(parent: Variant | null, archive: ArchiveCell[]): Promise<Variant>;

  /** Estimated resource cost */
  estimatedCost: {
    tokens: number;
    embeddings: number;
  };
}

/**
 * Emitter statistics for bandit allocation.
 */
export interface EmitterStats {
  emitterId: string;
  totalTrials: number;
  successfulImprovements: number;
  totalReward: number;
  avgReward: number;
  lastUsed: string;
}

// ============================================================================
// BANDIT
// ============================================================================

/**
 * UCB1 bandit state.
 */
export interface BanditState {
  kind: 'UCB1BanditState.v1';
  schemaVersion: 1;
  totalTrials: number;
  emitterStats: EmitterStats[];
  explorationConstant: number;
}

// ============================================================================
// RESOURCE TRACKING
// ============================================================================

/**
 * Resource usage during evaluation.
 */
export interface ResourceUsage {
  tokensUsed: number;
  embeddingsUsed: number;
  providerCallsUsed: number;
  durationMs: number;
}

// ============================================================================
// EVOLUTION CYCLE
// ============================================================================

/**
 * Evolution cycle result.
 */
export interface EvolutionCycleResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  candidatesGenerated: number;
  candidatesEvaluated: number;
  improvementsFound: number;
  archiveUpdates: number;
  bestVariant?: Variant;
  resourceUsage: ResourceUsage;
}

/**
 * Evolution configuration.
 */
export interface EvolutionConfig {
  /** Number of candidates per cycle */
  candidatesPerCycle: number;

  /** Maximum cycles to run */
  maxCycles: number;

  /** Budget per cycle */
  budgetPerCycle: EvaluationBudget;

  /** UCB1 exploration constant */
  explorationConstant: number;

  /** Acceptance policy */
  acceptancePolicy: 'pareto' | 'weighted' | 'any_improvement';

  /** Archive size limit */
  maxArchiveSize: number;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  candidatesPerCycle: 5,
  maxCycles: 10,
  budgetPerCycle: {
    maxTokens: 50000,
    maxEmbeddings: 500,
    maxProviderCalls: 20,
    maxDurationMs: 300000, // 5 minutes
  },
  explorationConstant: 1.414, // sqrt(2)
  acceptancePolicy: 'pareto',
  maxArchiveSize: 100,
};
