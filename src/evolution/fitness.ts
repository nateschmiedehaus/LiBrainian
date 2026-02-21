/**
 * @fileoverview Fitness Computation for EvolutionOps
 *
 * Computes multi-objective FitnessReport.v1 from evaluation results.
 * Integrates with existing evaluation harness and observability.
 *
 * @packageDocumentation
 */

import type {
  FitnessReport,
  FitnessVector,
  BehaviorDescriptors,
  FitnessDelta,
  FitnessScoringIntegrity,
  MeasurementCompleteness,
  StageResult,
  ResourceUsage,
  Variant,
} from './types.js';
import type { EvaluationReport } from '../evaluation/harness.js';
import type { EvalReport } from '../evaluation/runner.js';
import type { LibrarianStateReport } from '../measurement/observability.js';
import { isRetrievalQualityReport, type RetrievalQualityReport } from '../measurement/retrieval_quality.js';
import { computeContinuousOverallScore } from './continuous_fitness.js';

// ============================================================================
// FITNESS COMPUTATION
// ============================================================================

type RetrievalReportLike = EvaluationReport | EvalReport | RetrievalQualityReport;

/**
 * Compute FitnessReport.v1 from evaluation results.
 */
export function computeFitnessReport(
  variantId: string | null,
  scope: { repository: string; subsystem: string; commitHash: string },
  stages: {
    stage0: StageResult;
    stage1: StageResult;
    stage2: StageResult;
    stage3: StageResult;
    stage4: StageResult;
    stage5: StageResult;
  },
  retrievalReport?: RetrievalReportLike,
  stateReport?: LibrarianStateReport,
  resourceUsage?: ResourceUsage,
  baseline?: FitnessReport
): FitnessReport {
  const fitness = computeFitnessVector(stages, retrievalReport, stateReport);
  const descriptors = computeBehaviorDescriptors(fitness, stateReport);
  const delta = baseline ? computeFitnessDelta(fitness, baseline.fitness, baseline.variantId ?? 'baseline') : undefined;
  const measurementCompleteness = computeMeasurementCompleteness(retrievalReport, stateReport, stages.stage5);
  const scoringIntegrity = computeScoringIntegrity(measurementCompleteness);

  return {
    kind: 'FitnessReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    variantId,
    scope,
    stages: {
      stage0_static: stages.stage0,
      stage1_tier0: stages.stage1,
      stage2_tier1: stages.stage2,
      stage3_tier2: stages.stage3,
      stage4_adversarial: stages.stage4,
      stage5_agentic_utility: stages.stage5,
    },
    fitness,
    behaviorDescriptors: descriptors,
    resources: resourceUsage ?? { tokensUsed: 0, embeddingsUsed: 0, providerCallsUsed: 0, durationMs: 0 },
    measurementCompleteness,
    scoringIntegrity,
    baselineDelta: delta,
  };
}

/**
 * Compute multi-objective fitness vector.
 */
export function computeFitnessVector(
  stages: {
    stage0: StageResult;
    stage1: StageResult;
    stage2: StageResult;
    stage3: StageResult;
    stage4: StageResult;
    stage5: StageResult;
  },
  retrievalReport?: RetrievalReportLike,
  stateReport?: LibrarianStateReport
): FitnessVector {
  // Correctness from stage results
  const correctness = {
    tier0PassRate: stages.stage1.status === 'passed' ? 1.0 : extractPassRate(stages.stage1),
    tier1PassRate: stages.stage2.status === 'passed' ? 1.0 : extractPassRate(stages.stage2),
    tier2PassRate: stages.stage3.status === 'passed' ? 1.0 : extractPassRate(stages.stage3),
    schemaValid: stages.stage0.metrics['schema_valid'] === true,
    deterministicVerified: stages.stage0.metrics['determinism_verified'] === true,
  };

  // Retrieval quality from evaluation report
  const retrievalQuality = extractRetrievalQuality(retrievalReport);

  // Epistemic quality from state report
  const epistemicQuality = extractEpistemicQuality(stateReport);

  // Operational quality from state report
  const operationalQuality = extractOperationalQuality(stateReport);

  // Security robustness from stage 4
  const securityRobustness = extractSecurityRobustness(stages.stage4);

  // Cost efficiency from stages
  const costEfficiency = extractCostEfficiency(stages);

  // Agentic utility from stage 5
  const agenticUtility = extractAgenticUtility(stages.stage5);

  // Compute overall score (geometric mean of normalized scores)
  const overall = computeOverallScore({
    correctness,
    retrievalQuality,
    epistemicQuality,
    operationalQuality,
    securityRobustness,
    costEfficiency,
    agenticUtility,
  });

  return {
    correctness,
    retrievalQuality,
    epistemicQuality,
    operationalQuality,
    securityRobustness,
    costEfficiency,
    agenticUtility,
    overall,
  };
}

/**
 * Compute behavior descriptors for MAP-Elites archiving.
 */
export function computeBehaviorDescriptors(
  fitness: FitnessVector,
  stateReport?: LibrarianStateReport
): BehaviorDescriptors {
  // Latency bucket
  const latencyP50 = fitness.operationalQuality.queryLatencyP50Ms;
  const latencyBucket: BehaviorDescriptors['latencyBucket'] =
    latencyP50 < 0 ? 'slow' : latencyP50 < 200 ? 'fast' : latencyP50 < 500 ? 'medium' : 'slow';

  // Token cost bucket
  const tokenUsage = fitness.costEfficiency.tokenUsage;
  const tokenCostBucket: BehaviorDescriptors['tokenCostBucket'] =
    tokenUsage < 10000 ? 'low' : tokenUsage < 50000 ? 'medium' : 'high';

  // Evidence completeness bucket
  const evidenceCoverage = fitness.epistemicQuality.evidenceCoverage;
  const evidenceCompletenessBucket: BehaviorDescriptors['evidenceCompletenessBucket'] =
    evidenceCoverage < 0 ? 'low' : evidenceCoverage < 0.5 ? 'low' : evidenceCoverage < 0.8 ? 'medium' : 'high';

  // Calibration bucket
  const calibrationError = fitness.epistemicQuality.calibrationError;
  const calibrationBucket: BehaviorDescriptors['calibrationBucket'] =
    calibrationError < 0 ? 'low' : calibrationError > 0.2 ? 'low' : calibrationError > 0.1 ? 'medium' : 'high';

  // Retrieval strategy (simplified heuristic)
  const retrievalStrategy = inferRetrievalStrategy(stateReport);

  // Provider reliance
  const providerReliance = inferProviderReliance(fitness);

  return {
    latencyBucket,
    tokenCostBucket,
    evidenceCompletenessBucket,
    calibrationBucket,
    retrievalStrategy,
    providerReliance,
  };
}

/**
 * Compute fitness delta vs baseline.
 */
export function computeFitnessDelta(
  current: FitnessVector,
  baseline: FitnessVector,
  baselineId: string
): FitnessDelta {
  const improvements: string[] = [];
  const regressions: string[] = [];
  const neutral: string[] = [];

  // Compare correctness
  compareMetric('tier0PassRate', current.correctness.tier0PassRate, baseline.correctness.tier0PassRate, improvements, regressions, neutral);
  compareMetric('tier1PassRate', current.correctness.tier1PassRate, baseline.correctness.tier1PassRate, improvements, regressions, neutral);

  // Compare retrieval
  if (current.retrievalQuality.recallAt5 >= 0 && baseline.retrievalQuality.recallAt5 >= 0) {
    compareMetric('recallAt5', current.retrievalQuality.recallAt5, baseline.retrievalQuality.recallAt5, improvements, regressions, neutral);
  } else {
    neutral.push('recallAt5');
  }
  if (current.retrievalQuality.nDCG >= 0 && baseline.retrievalQuality.nDCG >= 0) {
    compareMetric('nDCG', current.retrievalQuality.nDCG, baseline.retrievalQuality.nDCG, improvements, regressions, neutral);
  } else {
    neutral.push('nDCG');
  }

  // Compare epistemic
  if (current.epistemicQuality.evidenceCoverage >= 0 && baseline.epistemicQuality.evidenceCoverage >= 0) {
    compareMetric('evidenceCoverage', current.epistemicQuality.evidenceCoverage, baseline.epistemicQuality.evidenceCoverage, improvements, regressions, neutral);
  } else {
    neutral.push('evidenceCoverage');
  }
  if (current.epistemicQuality.calibrationError >= 0 && baseline.epistemicQuality.calibrationError >= 0) {
    compareMetric('calibrationError', baseline.epistemicQuality.calibrationError, current.epistemicQuality.calibrationError, improvements, regressions, neutral); // Lower is better
  } else {
    neutral.push('calibrationError');
  }

  // Compare operational (lower is better for latency)
  if (current.operationalQuality.queryLatencyP50Ms >= 0 && baseline.operationalQuality.queryLatencyP50Ms >= 0) {
    compareMetric('queryLatencyP50', baseline.operationalQuality.queryLatencyP50Ms, current.operationalQuality.queryLatencyP50Ms, improvements, regressions, neutral);
  } else {
    neutral.push('queryLatencyP50');
  }

  // Compare overall
  compareMetric('overall', current.overall, baseline.overall, improvements, regressions, neutral);

  // Pareto improvement: at least one improvement, no regressions
  const isParetoImprovement = improvements.length > 0 && regressions.length === 0;

  return {
    baselineId,
    improvements,
    regressions,
    neutral,
    isParetoImprovement,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function extractPassRate(stage: StageResult): number {
  const passed = stage.metrics['tests_passed'];
  const total = stage.metrics['tests_total'];
  if (typeof passed === 'number' && typeof total === 'number' && total > 0) {
    return passed / total;
  }
  return stage.status === 'passed' ? 1.0 : 0.0;
}

function extractRetrievalQuality(report?: RetrievalReportLike): FitnessVector['retrievalQuality'] {
  // Important: missing/skipped measurement is not "bad retrieval".
  // Use sentinel negatives so scoring can mask this dimension rather than penalize it.
  const completeness = getRetrievalMeasurementCompleteness(report);
  if (!completeness.measured) return createUnmeasuredRetrievalQuality();

  if (isRetrievalQualityReport(report)) {
    if (!hasRetrievalMetricSet([
      report.aggregate.meanRecallAtK[5],
      report.aggregate.meanRecallAtK[10],
      report.aggregate.meanPrecisionAtK[5],
      report.aggregate.meanNdcgAtK[5],
      report.aggregate.meanMrr,
    ])) {
      return createUnmeasuredRetrievalQuality();
    }
    return {
      recallAt5: report.aggregate.meanRecallAtK[5] ?? 0,
      recallAt10: report.aggregate.meanRecallAtK[10] ?? 0,
      precisionAt5: report.aggregate.meanPrecisionAtK[5] ?? 0,
      nDCG: report.aggregate.meanNdcgAtK[5] ?? 0,
      mrr: report.aggregate.meanMrr ?? 0,
    };
  }

  if (isEvalRunnerReport(report)) {
    if (!hasRetrievalMetricSet([
      report.metrics.retrieval.recallAtK[5],
      report.metrics.retrieval.recallAtK[10],
      report.metrics.retrieval.precisionAtK[5],
      report.metrics.retrieval.ndcg,
      report.metrics.retrieval.mrr,
    ])) {
      return createUnmeasuredRetrievalQuality();
    }
    return {
      recallAt5: report.metrics.retrieval.recallAtK[5] ?? 0,
      recallAt10: report.metrics.retrieval.recallAtK[10] ?? 0,
      precisionAt5: report.metrics.retrieval.precisionAtK[5] ?? 0,
      nDCG: report.metrics.retrieval.ndcg ?? 0,
      mrr: report.metrics.retrieval.mrr ?? 0,
    };
  }

  const harnessReport = report as EvaluationReport;
  if (!harnessReport.aggregateMetrics) {
    return createUnmeasuredRetrievalQuality();
  }
  if (!hasRetrievalMetricSet([
    harnessReport.aggregateMetrics.recall?.mean,
    harnessReport.aggregateMetrics.precision?.mean,
    harnessReport.aggregateMetrics.ndcg?.mean,
    harnessReport.aggregateMetrics.mrr?.mean,
  ])) {
    return createUnmeasuredRetrievalQuality();
  }

  return {
    recallAt5: harnessReport.aggregateMetrics.recall?.mean ?? 0,
    recallAt10: harnessReport.aggregateMetrics.recall?.mean ?? 0, // EvaluationHarness is single-cutoff; treat as same when unknown.
    precisionAt5: harnessReport.aggregateMetrics.precision?.mean ?? 0,
    nDCG: harnessReport.aggregateMetrics.ndcg?.mean ?? 0,
    mrr: harnessReport.aggregateMetrics.mrr?.mean ?? 0,
  };
}

function extractEpistemicQuality(stateReport?: LibrarianStateReport): FitnessVector['epistemicQuality'] {
  const completeness = getEpistemicMeasurementCompleteness(stateReport);
  if (!stateReport || !completeness.measured) {
    // Missing measurement is not "bad epistemics". Use sentinel values so scoring can mask.
    return {
      evidenceCoverage: -1,
      defeaterCorrectness: -1,
      calibrationError: -1,
      claimVerificationRate: -1,
    };
  }

  return {
    evidenceCoverage: stateReport.codeGraphHealth.coverageRatio,
    defeaterCorrectness: stateReport.confidenceState.defeaterCount <= 10 ? 1.0 : 0.5,
    calibrationError: stateReport.confidenceState.calibrationError ?? 0.15,
    claimVerificationRate: stateReport.confidenceState.geometricMeanConfidence,
  };
}

function extractOperationalQuality(stateReport?: LibrarianStateReport): FitnessVector['operationalQuality'] {
  const completeness = getOperationalMeasurementCompleteness(stateReport);
  if (!stateReport || !completeness.measured) {
    // Missing measurement is not "slow". Use sentinel values so scoring can mask.
    return {
      queryLatencyP50Ms: -1,
      queryLatencyP99Ms: -1,
      bootstrapTimeSeconds: -1,
      cacheHitRate: -1,
      freshnessLagSeconds: -1,
    };
  }

  return {
    queryLatencyP50Ms: stateReport.queryPerformance.queryLatencyP50,
    queryLatencyP99Ms: stateReport.queryPerformance.queryLatencyP99,
    bootstrapTimeSeconds: 60, // Would need bootstrap timing
    cacheHitRate: stateReport.queryPerformance.cacheHitRate,
    freshnessLagSeconds: Math.max(0, stateReport.indexFreshness.stalenessMs / 1000),
  };
}

function computeMeasurementCompleteness(
  retrievalReport?: RetrievalReportLike,
  stateReport?: LibrarianStateReport,
  stage5?: StageResult
): MeasurementCompleteness {
  return {
    retrievalQuality: getRetrievalMeasurementCompleteness(retrievalReport),
    epistemicQuality: getEpistemicMeasurementCompleteness(stateReport),
    operationalQuality: getOperationalMeasurementCompleteness(stateReport),
    agenticUtility: getAgenticMeasurementCompleteness(stage5),
  };
}

function computeScoringIntegrity(
  completeness: MeasurementCompleteness
): FitnessScoringIntegrity {
  const reasons: string[] = [];
  let measuredFamilies = 0;
  const totalFamilies = 4;

  if (completeness.retrievalQuality.measured) {
    measuredFamilies += 1;
  } else {
    reasons.push(`retrieval_quality_unmeasured:${completeness.retrievalQuality.reason ?? 'unknown'}`);
  }

  if (completeness.epistemicQuality.measured) {
    measuredFamilies += 1;
  } else {
    reasons.push(`epistemic_quality_unmeasured:${completeness.epistemicQuality.reason ?? 'unknown'}`);
  }

  if (completeness.operationalQuality.measured) {
    measuredFamilies += 1;
  } else {
    reasons.push(`operational_quality_unmeasured:${completeness.operationalQuality.reason ?? 'unknown'}`);
  }

  if (completeness.agenticUtility.measured) {
    measuredFamilies += 1;
  } else {
    reasons.push(`agentic_utility_unmeasured:${completeness.agenticUtility.reason ?? 'unknown'}`);
  }

  return {
    status: reasons.length === 0 ? 'measured' : 'unverified_by_trace',
    measuredFamilies,
    totalFamilies,
    coverageRatio: totalFamilies > 0 ? measuredFamilies / totalFamilies : 0,
    reasons,
  };
}

function getRetrievalMeasurementCompleteness(
  report?: RetrievalReportLike
): MeasurementCompleteness['retrievalQuality'] {
  if (!report) {
    return { measured: false, reason: 'missing_or_budget_skipped' };
  }

  const queryCount = getQueryCount(report);
  if (typeof queryCount === 'number' && queryCount <= 0) {
    return { measured: false, reason: 'zero_query_coverage', queryCount };
  }

  if (isRetrievalQualityReport(report)) {
    if (!hasRetrievalMetricSet([
      report.aggregate.meanRecallAtK[5],
      report.aggregate.meanRecallAtK[10],
      report.aggregate.meanPrecisionAtK[5],
      report.aggregate.meanNdcgAtK[5],
      report.aggregate.meanMrr,
    ])) {
      return { measured: false, reason: 'missing_metrics', queryCount };
    }
    return { measured: true, queryCount };
  }

  if (isEvalRunnerReport(report)) {
    if (!hasRetrievalMetricSet([
      report.metrics.retrieval.recallAtK[5],
      report.metrics.retrieval.recallAtK[10],
      report.metrics.retrieval.precisionAtK[5],
      report.metrics.retrieval.ndcg,
      report.metrics.retrieval.mrr,
    ])) {
      return { measured: false, reason: 'missing_metrics', queryCount };
    }
    return { measured: true, queryCount };
  }

  const harnessReport = report as EvaluationReport;
  if (!harnessReport.aggregateMetrics) {
    return { measured: false, reason: 'missing_metrics', queryCount };
  }
  if (!hasRetrievalMetricSet([
    harnessReport.aggregateMetrics.recall?.mean,
    harnessReport.aggregateMetrics.precision?.mean,
    harnessReport.aggregateMetrics.ndcg?.mean,
    harnessReport.aggregateMetrics.mrr?.mean,
  ])) {
    return { measured: false, reason: 'missing_metrics', queryCount };
  }

  return { measured: true, queryCount };
}

function getAgenticMeasurementCompleteness(
  stage5?: StageResult
): MeasurementCompleteness['agenticUtility'] {
  if (!stage5) {
    return { measured: false, reason: 'missing_or_budget_skipped' };
  }
  if (stage5.status === 'skipped') {
    return { measured: false, reason: 'missing_or_budget_skipped' };
  }

  const requiredMetricNames = [
    'task_completion_lift',
    'time_to_solution_reduction',
    'context_usage_rate',
    'code_quality_lift',
    'decision_accuracy',
    'agent_satisfaction_score',
    'missing_context_rate',
    'irrelevant_context_rate',
  ];
  const hasAllMetrics = requiredMetricNames.every((name) => {
    const value = stage5.metrics[name];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  });
  if (!hasAllMetrics) {
    return { measured: false, reason: 'missing_metrics' };
  }
  return { measured: true };
}

function getEpistemicMeasurementCompleteness(
  stateReport?: LibrarianStateReport
): MeasurementCompleteness['epistemicQuality'] {
  if (!stateReport) {
    return { measured: false, reason: 'missing_or_budget_skipped' };
  }
  if (
    !Number.isFinite(stateReport.codeGraphHealth.coverageRatio)
    || !Number.isFinite(stateReport.confidenceState.geometricMeanConfidence)
    || (stateReport.confidenceState.calibrationError !== null && !Number.isFinite(stateReport.confidenceState.calibrationError))
  ) {
    return { measured: false, reason: 'missing_metrics' };
  }
  return { measured: true };
}

function getOperationalMeasurementCompleteness(
  stateReport?: LibrarianStateReport
): MeasurementCompleteness['operationalQuality'] {
  if (!stateReport) {
    return { measured: false, reason: 'missing_or_budget_skipped' };
  }

  const queryCount = stateReport.queryPerformance.queryCount;
  if (queryCount <= 0) {
    return { measured: false, reason: 'zero_query_coverage', queryCount };
  }
  if (
    !Number.isFinite(stateReport.queryPerformance.queryLatencyP50)
    || !Number.isFinite(stateReport.queryPerformance.queryLatencyP99)
    || !Number.isFinite(stateReport.queryPerformance.cacheHitRate)
  ) {
    return { measured: false, reason: 'missing_metrics', queryCount };
  }

  return { measured: true, queryCount };
}

function hasRetrievalMetricSet(metrics: Array<number | undefined>): boolean {
  return metrics.every((metric) => Number.isFinite(metric));
}

function getQueryCount(report: RetrievalReportLike): number | undefined {
  if (isRetrievalQualityReport(report)) return report.queryCount;
  if (isEvalRunnerReport(report)) return report.queryCount;
  const harnessReport = report as EvaluationReport;
  return typeof harnessReport.queryCount === 'number' ? harnessReport.queryCount : undefined;
}

function createUnmeasuredRetrievalQuality(): FitnessVector['retrievalQuality'] {
  return {
    recallAt5: -1,
    recallAt10: -1,
    precisionAt5: -1,
    nDCG: -1,
    mrr: -1,
  };
}

function extractSecurityRobustness(stage4: StageResult): FitnessVector['securityRobustness'] {
  return {
    injectionResistance: stage4.metrics['injection_resistance'] as number ?? 1.0,
    provenanceLabeling: stage4.metrics['provenance_labeling'] as number ?? 1.0,
    failClosedBehavior: stage4.metrics['fail_closed'] as boolean ?? true,
  };
}

function extractCostEfficiency(stages: Record<string, StageResult>): FitnessVector['costEfficiency'] {
  let totalTokens = 0;
  let totalEmbeddings = 0;
  let totalProviderCalls = 0;

  for (const stage of Object.values(stages)) {
    totalTokens += (stage.metrics['tokens_used'] as number) ?? 0;
    totalEmbeddings += (stage.metrics['embeddings_used'] as number) ?? 0;
    totalProviderCalls += (stage.metrics['provider_calls'] as number) ?? 0;
  }

  return {
    tokenUsage: totalTokens,
    embeddingCalls: totalEmbeddings,
    providerCalls: totalProviderCalls,
    recoveryBudgetCompliance: true, // Would check against actual budgets
  };
}

function extractAgenticUtility(stage5: StageResult): FitnessVector['agenticUtility'] {
  const readNumber = (name: string): number => {
    const value = stage5.metrics[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : -1;
  };
  return {
    taskCompletionLift: readNumber('task_completion_lift'),
    timeToSolutionReduction: readNumber('time_to_solution_reduction'),
    contextUsageRate: readNumber('context_usage_rate'),
    codeQualityLift: readNumber('code_quality_lift'),
    decisionAccuracy: readNumber('decision_accuracy'),
    agentSatisfactionScore: readNumber('agent_satisfaction_score'),
    missingContextRate: readNumber('missing_context_rate'),
    irrelevantContextRate: readNumber('irrelevant_context_rate'),
  };
}

function computeOverallScore(fitness: Omit<FitnessVector, 'overall'>): number {
  // Structural score from existing harmonic-fitness dimensions.
  const fitnessWithOverall = {
    ...fitness,
    overall: 0, // Will be computed by computeContinuousOverallScore
  } as FitnessVector;
  const structuralScore = computeContinuousOverallScore(fitnessWithOverall);

  // Agentic utility must have major influence on total fitness in M0.
  const agenticScore = normalizeAgenticUtilityScore(fitness.agenticUtility);
  if (agenticScore < 0) return structuralScore;

  const AGENTIC_WEIGHT = 0.30;
  return ((1 - AGENTIC_WEIGHT) * structuralScore) + (AGENTIC_WEIGHT * agenticScore);
}

function normalizeLatency(latencyMs: number): number {
  // Target: 500ms = 1.0, 2000ms = 0.25
  return Math.min(1.0, 500 / Math.max(1, latencyMs));
}

function normalizeTokenUsage(tokens: number): number {
  // Target: <10k = 1.0, 100k = 0.1
  return Math.min(1.0, 10000 / Math.max(1, tokens));
}

function normalizeAgenticUtilityScore(agentic: FitnessVector['agenticUtility']): number {
  const values: number[] = [];
  const normalizeLift = (value: number): number => clamp01(value);
  const normalizeRate = (value: number): number => clamp01(value);

  if (agentic.taskCompletionLift >= 0) values.push(normalizeLift(agentic.taskCompletionLift));
  if (agentic.timeToSolutionReduction >= 0) values.push(normalizeRate(agentic.timeToSolutionReduction));
  if (agentic.contextUsageRate >= 0) values.push(normalizeRate(agentic.contextUsageRate));
  if (agentic.codeQualityLift >= 0) values.push(normalizeLift(agentic.codeQualityLift));
  if (agentic.decisionAccuracy >= 0) values.push(normalizeRate(agentic.decisionAccuracy));
  if (agentic.agentSatisfactionScore >= 0) values.push(normalizeRate(agentic.agentSatisfactionScore));
  if (agentic.missingContextRate >= 0) values.push(1 - normalizeRate(agentic.missingContextRate));
  if (agentic.irrelevantContextRate >= 0) values.push(1 - normalizeRate(agentic.irrelevantContextRate));

  if (values.length === 0) return -1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function compareMetric(
  name: string,
  current: number,
  baseline: number,
  improvements: string[],
  regressions: string[],
  neutral: string[]
): void {
  const threshold = 0.01; // 1% threshold for change detection
  const delta = current - baseline;

  if (delta > threshold) {
    improvements.push(`${name}: ${baseline.toFixed(3)} -> ${current.toFixed(3)} (+${(delta * 100).toFixed(1)}%)`);
  } else if (delta < -threshold) {
    regressions.push(`${name}: ${baseline.toFixed(3)} -> ${current.toFixed(3)} (${(delta * 100).toFixed(1)}%)`);
  } else {
    neutral.push(name);
  }
}

function inferRetrievalStrategy(_stateReport?: LibrarianStateReport): BehaviorDescriptors['retrievalStrategy'] {
  // Would analyze actual retrieval weights; default to balanced
  return 'balanced';
}

function inferProviderReliance(fitness: FitnessVector): BehaviorDescriptors['providerReliance'] {
  const calls = fitness.costEfficiency.providerCalls;
  if (calls === 0) return 'deterministic-only';
  if (calls < 10) return 'light-llm';
  return 'heavy-llm';
}

function isEvalRunnerReport(value: unknown): value is EvalReport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const metrics = v['metrics'];
  if (!metrics || typeof metrics !== 'object') return false;
  const retrieval = (metrics as Record<string, unknown>)['retrieval'];
  if (!retrieval || typeof retrieval !== 'object') return false;
  return typeof (retrieval as Record<string, unknown>)['mrr'] === 'number';
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isFitnessReport(value: unknown): value is FitnessReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return r.kind === 'FitnessReport.v1' && r.schemaVersion === 1;
}
