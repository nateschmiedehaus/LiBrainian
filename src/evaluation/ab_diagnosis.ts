import type {
  AbExperimentReport,
  AbTaskComplexity,
  AbTaskRunResult,
} from './ab_harness.js';

export type AbQueryType = 'structural' | 'explanation' | 'debugging' | 'architectural' | 'other';

export interface AbTaskMetadata {
  id: string;
  queryType?: AbQueryType;
  tags?: string[];
  description?: string;
  complexity?: AbTaskComplexity;
}

export interface AbTaskPairSideInput {
  success: boolean;
  durationMs: number;
  failureReason?: string;
}

export interface AbTaskPairInput {
  taskId: string;
  complexity: AbTaskComplexity;
  control: AbTaskPairSideInput;
  treatment: AbTaskPairSideInput;
}

interface AbTaskPair {
  runId: string;
  taskId: string;
  complexity: AbTaskComplexity;
  queryType: AbQueryType;
  control: AbTaskRunResult;
  treatment: AbTaskRunResult;
}

export interface AbDeltaSignificance {
  alpha: number;
  pValue: number | null;
  statisticallySignificant: boolean | null;
  sampleSizeAdequate: boolean;
}

export interface AbPowerAnalysis {
  alpha: number;
  targetPower: number;
  currentPerGroup: number;
  requiredPerGroup: number | null;
  sampleGapPerGroup: number | null;
  estimatedPower: number;
  latestPerGroup: number | null;
  aggregateVsLatestMultiplier: number | null;
}

export interface AbStratumSummary {
  nPairs: number;
  controlSuccessRate: number;
  treatmentSuccessRate: number;
  absoluteSuccessRateDelta: number;
  relativeLift: number;
  meanDurationDeltaMs: number;
  treatmentWorsePairs: number;
}

export interface AbOverallSummary extends AbStratumSummary {
  confidenceInterval95: {
    lower: number;
    upper: number;
  };
  significance: AbDeltaSignificance;
}

export interface AbVarianceSummary {
  controlDurationStdDevMs: number;
  treatmentDurationStdDevMs: number;
  pairedDurationDeltaStdDevMs: number;
  controlDurationCv: number;
  treatmentDurationCv: number;
  outlierPairs: Array<{
    runId: string;
    taskId: string;
    queryType: AbQueryType;
    deltaMs: number;
    zScore: number;
    controlSuccess: boolean;
    treatmentSuccess: boolean;
  }>;
}

export interface AbTreatmentWorseCase {
  runId: string;
  taskId: string;
  complexity: AbTaskComplexity;
  queryType: AbQueryType;
  failureReason: string;
  controlDurationMs: number;
  treatmentDurationMs: number;
  treatmentExtraContextFiles: number;
}

export interface AbCorrelationSummary {
  successVsExtraContextPearson: number | null;
}

export interface AbRootCauseSummary {
  category: 'sample_size' | 'high_variance' | 'marginal_effect' | 'negative_effect' | 'mixed';
  reasons: string[];
}

export interface AbDecisionSummary {
  recommendedFocus: 'retrieval' | 'synthesis_integration' | 'sampling_and_experiment_design' | 'mixed';
  rationale: string[];
}

export interface AbDiagnosisReport {
  generatedAt: string;
  reportsAnalyzed: number;
  pairCount: number;
  uniqueTaskCount: number;
  overall: AbOverallSummary;
  power: AbPowerAnalysis;
  variance: AbVarianceSummary;
  strata: {
    byComplexity: Record<AbTaskComplexity, AbStratumSummary>;
    byQueryType: Record<AbQueryType, AbStratumSummary>;
  };
  treatmentWorseCases: AbTreatmentWorseCase[];
  correlation: AbCorrelationSummary;
  rootCause: AbRootCauseSummary;
  decision: AbDecisionSummary;
}

const Z_95 = 1.959963984540054;
const MIN_SIGNIFICANCE_SAMPLE_PER_GROUP = 5;
const NORMAL_Z_80_POWER = 0.8416212335729143;

function normalizeQueryType(value: string): AbQueryType | null {
  switch (value) {
    case 'structural':
    case 'explanation':
    case 'debugging':
    case 'architectural':
    case 'other':
      return value;
    default:
      return null;
  }
}

function inferQueryType(taskId: string, metadata?: AbTaskMetadata): AbQueryType {
  if (metadata?.queryType) {
    return metadata.queryType;
  }
  const hintParts = [
    taskId,
    metadata?.description ?? '',
    ...(metadata?.tags ?? []),
  ].join(' ').toLowerCase();
  if (
    hintParts.includes('bugfix')
    || hintParts.includes('regression')
    || hintParts.includes('debug')
    || hintParts.includes('error')
    || hintParts.includes('fix')
    || hintParts.includes('failure')
  ) {
    return 'debugging';
  }
  if (
    hintParts.includes('readme')
    || hintParts.includes('docs')
    || hintParts.includes('documentation')
    || hintParts.includes('explain')
  ) {
    return 'explanation';
  }
  if (
    hintParts.includes('architect')
    || hintParts.includes('design')
    || hintParts.includes('topolog')
    || hintParts.includes('dependency graph')
  ) {
    return 'architectural';
  }
  if (
    hintParts.includes('structure')
    || hintParts.includes('import')
    || hintParts.includes('rename')
    || hintParts.includes('path')
  ) {
    return 'structural';
  }
  return 'other';
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  return Math.sqrt(variance(values));
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function erfApprox(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const polynomial = (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t;
  const y = 1 - polynomial * Math.exp(-(absolute * absolute));
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erfApprox(value / Math.sqrt(2)));
}

function inverseNormalCdf(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    throw new Error(`invalid_probability:${probability}`);
  }

  const a = [
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.38357751867269e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00,
  ];

  const plow = 0.02425;
  const phigh = 1 - plow;

  if (probability < plow) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function computeSignificance(
  controlSuccesses: number,
  treatmentSuccesses: number,
  controlN: number,
  treatmentN: number,
  alpha: number,
): AbDeltaSignificance {
  const sampleSizeAdequate = controlN >= MIN_SIGNIFICANCE_SAMPLE_PER_GROUP
    && treatmentN >= MIN_SIGNIFICANCE_SAMPLE_PER_GROUP;
  if (!sampleSizeAdequate) {
    return {
      alpha,
      pValue: null,
      statisticallySignificant: null,
      sampleSizeAdequate,
    };
  }
  const controlRate = controlN > 0 ? controlSuccesses / controlN : 0;
  const treatmentRate = treatmentN > 0 ? treatmentSuccesses / treatmentN : 0;
  const pooledRate = (controlSuccesses + treatmentSuccesses) / (controlN + treatmentN);
  const pooledStdErr = Math.sqrt(pooledRate * (1 - pooledRate) * ((1 / controlN) + (1 / treatmentN)));
  if (!Number.isFinite(pooledStdErr) || pooledStdErr <= 0) {
    return {
      alpha,
      pValue: null,
      statisticallySignificant: null,
      sampleSizeAdequate,
    };
  }
  const zScore = (treatmentRate - controlRate) / pooledStdErr;
  const pValue = clampProbability(2 * (1 - normalCdf(Math.abs(zScore))));
  return {
    alpha,
    pValue,
    statisticallySignificant: pValue <= alpha,
    sampleSizeAdequate,
  };
}

function computeAbsoluteDeltaConfidenceInterval(
  controlRate: number,
  treatmentRate: number,
  controlN: number,
  treatmentN: number,
): { lower: number; upper: number } {
  const diff = treatmentRate - controlRate;
  if (controlN <= 0 || treatmentN <= 0) {
    return { lower: diff, upper: diff };
  }
  const stderr = Math.sqrt(
    ((controlRate * (1 - controlRate)) / controlN)
    + ((treatmentRate * (1 - treatmentRate)) / treatmentN),
  );
  if (!Number.isFinite(stderr) || stderr <= 0) {
    return { lower: diff, upper: diff };
  }
  return {
    lower: diff - (Z_95 * stderr),
    upper: diff + (Z_95 * stderr),
  };
}

function computeRequiredSamplePerGroup(
  controlRate: number,
  treatmentRate: number,
  alpha: number,
  targetPower: number,
): number | null {
  const delta = Math.abs(treatmentRate - controlRate);
  if (!Number.isFinite(delta) || delta <= 0) {
    return null;
  }
  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const zBeta = inverseNormalCdf(targetPower);
  const pooled = (controlRate + treatmentRate) / 2;
  const partOne = zAlpha * Math.sqrt(2 * pooled * (1 - pooled));
  const partTwo = zBeta * Math.sqrt(
    (controlRate * (1 - controlRate)) + (treatmentRate * (1 - treatmentRate)),
  );
  const required = ((partOne + partTwo) ** 2) / (delta ** 2);
  if (!Number.isFinite(required) || required <= 0) {
    return null;
  }
  return Math.ceil(required);
}

function computeEstimatedPower(
  controlRate: number,
  treatmentRate: number,
  perGroupN: number,
  alpha: number,
): number {
  if (perGroupN <= 0) return 0;
  const delta = Math.abs(treatmentRate - controlRate);
  if (delta <= 0) return 0;
  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const stderr = Math.sqrt(
    ((controlRate * (1 - controlRate)) / perGroupN)
    + ((treatmentRate * (1 - treatmentRate)) / perGroupN),
  );
  if (!Number.isFinite(stderr) || stderr <= 0) {
    return 0;
  }
  const zEffect = delta / stderr;
  return clampProbability(normalCdf(zEffect - zAlpha));
}

function summarizePairs(pairs: AbTaskPair[]): AbStratumSummary {
  const nPairs = pairs.length;
  if (nPairs === 0) {
    return {
      nPairs: 0,
      controlSuccessRate: 0,
      treatmentSuccessRate: 0,
      absoluteSuccessRateDelta: 0,
      relativeLift: 0,
      meanDurationDeltaMs: 0,
      treatmentWorsePairs: 0,
    };
  }
  const controlSuccesses = pairs.filter((pair) => pair.control.success).length;
  const treatmentSuccesses = pairs.filter((pair) => pair.treatment.success).length;
  const controlSuccessRate = controlSuccesses / nPairs;
  const treatmentSuccessRate = treatmentSuccesses / nPairs;
  const absoluteSuccessRateDelta = treatmentSuccessRate - controlSuccessRate;
  const relativeLift = controlSuccessRate === 0
    ? absoluteSuccessRateDelta
    : absoluteSuccessRateDelta / controlSuccessRate;
  const meanDurationDeltaMs = mean(
    pairs.map((pair) => pair.control.durationMs - pair.treatment.durationMs),
  );
  const treatmentWorsePairs = pairs.filter((pair) => pair.control.success && !pair.treatment.success).length;

  return {
    nPairs,
    controlSuccessRate,
    treatmentSuccessRate,
    absoluteSuccessRateDelta,
    relativeLift,
    meanDurationDeltaMs,
    treatmentWorsePairs,
  };
}

function buildPairs(
  reports: AbExperimentReport[],
  taskMetadataById: Map<string, AbTaskMetadata>,
): AbTaskPair[] {
  const pairs: AbTaskPair[] = [];

  for (const report of reports) {
    const runId = report.runId;
    const byTask = new Map<string, { control: AbTaskRunResult[]; treatment: AbTaskRunResult[] }>();
    for (const result of report.results) {
      const bucket = byTask.get(result.taskId) ?? { control: [], treatment: [] };
      if (result.workerType === 'control') {
        bucket.control.push(result);
      } else if (result.workerType === 'treatment') {
        bucket.treatment.push(result);
      }
      byTask.set(result.taskId, bucket);
    }

    for (const [taskId, bucket] of byTask.entries()) {
      const pairCount = Math.min(bucket.control.length, bucket.treatment.length);
      const metadata = taskMetadataById.get(taskId);
      for (let index = 0; index < pairCount; index += 1) {
        const control = bucket.control[index];
        const treatment = bucket.treatment[index];
        if (!control || !treatment) continue;
        const complexity = control.complexity ?? treatment.complexity;
        pairs.push({
          runId,
          taskId,
          complexity,
          queryType: inferQueryType(taskId, metadata),
          control,
          treatment,
        });
      }
    }
  }

  return pairs;
}

function buildOutliers(pairs: AbTaskPair[]): AbVarianceSummary['outlierPairs'] {
  const deltas = pairs.map((pair) => pair.control.durationMs - pair.treatment.durationMs);
  const deltaStdDev = standardDeviation(deltas);
  if (deltaStdDev <= 0) return [];
  const deltaMean = mean(deltas);
  return pairs
    .map((pair) => {
      const deltaMs = pair.control.durationMs - pair.treatment.durationMs;
      const zScore = (deltaMs - deltaMean) / deltaStdDev;
      return {
        runId: pair.runId,
        taskId: pair.taskId,
        queryType: pair.queryType,
        deltaMs,
        zScore,
        controlSuccess: pair.control.success,
        treatmentSuccess: pair.treatment.success,
      };
    })
    .filter((entry) => Math.abs(entry.zScore) >= 2);
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const xDiff = xs[index] - xMean;
    const yDiff = ys[index] - yMean;
    numerator += xDiff * yDiff;
    xDenominator += xDiff ** 2;
    yDenominator += yDiff ** 2;
  }
  if (xDenominator <= 0 || yDenominator <= 0) return null;
  return numerator / Math.sqrt(xDenominator * yDenominator);
}

function classifyRootCause(input: {
  overall: AbOverallSummary;
  power: AbPowerAnalysis;
  variance: AbVarianceSummary;
  byQueryType: Record<AbQueryType, AbStratumSummary>;
}): AbRootCauseSummary {
  const reasons: string[] = [];
  const delta = input.overall.absoluteSuccessRateDelta;
  const ciCrossesZero = input.overall.confidenceInterval95.lower <= 0
    && input.overall.confidenceInterval95.upper >= 0;
  const significant = input.overall.significance.statisticallySignificant === true;
  const highVariance = input.variance.controlDurationCv > 0.6
    || input.variance.treatmentDurationCv > 0.6
    || input.variance.outlierPairs.length > Math.max(1, Math.floor(input.overall.nPairs * 0.15));

  const strata = Object.values(input.byQueryType).filter((entry) => entry.nPairs > 0);
  const hasPositiveStratum = strata.some((entry) => entry.absoluteSuccessRateDelta > 0);
  const hasNegativeStratum = strata.some((entry) => entry.absoluteSuccessRateDelta < 0);
  const mixedStrata = hasPositiveStratum && hasNegativeStratum;

  if (input.power.sampleGapPerGroup !== null && input.power.sampleGapPerGroup > 0 && ciCrossesZero) {
    reasons.push('insufficient_sample_size_for_current_effect');
    if (mixedStrata) reasons.push('strata_show_mixed_effect_directions');
    return { category: 'sample_size', reasons };
  }

  if (delta < 0 && significant) {
    reasons.push('treatment_underperforms_control_with_significance');
    if (mixedStrata) reasons.push('query_type_effects_are_inconsistent');
    return { category: 'negative_effect', reasons };
  }

  if (Math.abs(delta) < 0.05 && !significant) {
    reasons.push('observed_effect_is_marginal_and_not_significant');
    if (mixedStrata) reasons.push('query_type_effects_are_inconsistent');
    return { category: 'marginal_effect', reasons };
  }

  if (highVariance) {
    reasons.push('duration_variance_and_outliers_are_high');
    if (mixedStrata) reasons.push('query_type_effects_are_inconsistent');
    return { category: 'high_variance', reasons };
  }

  if (mixedStrata) {
    reasons.push('query_type_effects_are_inconsistent');
    return { category: 'mixed', reasons };
  }

  reasons.push('no_single_failure_pattern_dominates');
  return { category: 'mixed', reasons };
}

function recommendDecision(input: {
  overall: AbOverallSummary;
  rootCause: AbRootCauseSummary;
}): AbDecisionSummary {
  const rationale: string[] = [];
  const category = input.rootCause.category;
  if (category === 'sample_size') {
    rationale.push('Current sample size is below the power requirement for the observed effect size.');
    rationale.push('Expand run count before committing to retrieval-only roadmap changes.');
    return {
      recommendedFocus: 'sampling_and_experiment_design',
      rationale,
    };
  }
  if (category === 'negative_effect' || category === 'marginal_effect') {
    rationale.push('Outcome lift is negative or too small to justify retrieval-only investment.');
    rationale.push('Prioritize synthesis quality, context presentation, and agent integration behavior.');
    return {
      recommendedFocus: 'synthesis_integration',
      rationale,
    };
  }
  if (
    input.overall.absoluteSuccessRateDelta > 0
    && input.overall.significance.statisticallySignificant === true
  ) {
    rationale.push('Treatment advantage is statistically supported.');
    rationale.push('Retrieval improvements are likely to compound existing gains.');
    return {
      recommendedFocus: 'retrieval',
      rationale,
    };
  }
  rationale.push('Signals are mixed across measures and require dual-track remediation.');
  return {
    recommendedFocus: 'mixed',
    rationale,
  };
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function diagnoseAbReports(input: {
  reports: AbExperimentReport[];
  taskMetadataById?: Map<string, AbTaskMetadata>;
  alpha?: number;
  targetPower?: number;
  latestRunId?: string;
}): AbDiagnosisReport {
  const alpha = input.alpha ?? 0.05;
  const targetPower = input.targetPower ?? 0.8;
  const taskMetadataById = input.taskMetadataById ?? new Map<string, AbTaskMetadata>();
  const pairs = buildPairs(input.reports, taskMetadataById);
  const uniqueTaskCount = new Set(pairs.map((pair) => pair.taskId)).size;

  const overallSummary = summarizePairs(pairs);
  const controlSuccesses = pairs.filter((pair) => pair.control.success).length;
  const treatmentSuccesses = pairs.filter((pair) => pair.treatment.success).length;
  const confidenceInterval95 = computeAbsoluteDeltaConfidenceInterval(
    overallSummary.controlSuccessRate,
    overallSummary.treatmentSuccessRate,
    pairs.length,
    pairs.length,
  );
  const significance = computeSignificance(
    controlSuccesses,
    treatmentSuccesses,
    pairs.length,
    pairs.length,
    alpha,
  );
  const overall: AbOverallSummary = {
    ...overallSummary,
    confidenceInterval95: {
      lower: round(confidenceInterval95.lower),
      upper: round(confidenceInterval95.upper),
    },
    significance: {
      ...significance,
      pValue: significance.pValue === null ? null : round(significance.pValue, 6),
    },
  };

  const requiredPerGroup = computeRequiredSamplePerGroup(
    overall.controlSuccessRate,
    overall.treatmentSuccessRate,
    alpha,
    targetPower,
  );
  const sampleGapPerGroup = requiredPerGroup === null
    ? null
    : Math.max(0, requiredPerGroup - pairs.length);

  const latestReport = input.latestRunId
    ? input.reports.find((report) => report.runId === input.latestRunId)
    : input.reports
      .slice()
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .at(-1);
  const latestPerGroup = latestReport?.control?.n ?? null;
  const aggregateVsLatestMultiplier = latestPerGroup && latestPerGroup > 0
    ? pairs.length / latestPerGroup
    : null;
  const power: AbPowerAnalysis = {
    alpha,
    targetPower,
    currentPerGroup: pairs.length,
    requiredPerGroup,
    sampleGapPerGroup,
    estimatedPower: round(
      computeEstimatedPower(
        overall.controlSuccessRate,
        overall.treatmentSuccessRate,
        pairs.length,
        alpha,
      ),
      4,
    ),
    latestPerGroup,
    aggregateVsLatestMultiplier: aggregateVsLatestMultiplier === null
      ? null
      : round(aggregateVsLatestMultiplier, 3),
  };

  const controlDurations = pairs.map((pair) => pair.control.durationMs);
  const treatmentDurations = pairs.map((pair) => pair.treatment.durationMs);
  const durationDeltas = pairs.map((pair) => pair.control.durationMs - pair.treatment.durationMs);
  const controlDurationStdDevMs = standardDeviation(controlDurations);
  const treatmentDurationStdDevMs = standardDeviation(treatmentDurations);
  const pairedDurationDeltaStdDevMs = standardDeviation(durationDeltas);
  const varianceSummary: AbVarianceSummary = {
    controlDurationStdDevMs: round(controlDurationStdDevMs, 3),
    treatmentDurationStdDevMs: round(treatmentDurationStdDevMs, 3),
    pairedDurationDeltaStdDevMs: round(pairedDurationDeltaStdDevMs, 3),
    controlDurationCv: round(controlDurationStdDevMs / Math.max(mean(controlDurations), 1), 4),
    treatmentDurationCv: round(treatmentDurationStdDevMs / Math.max(mean(treatmentDurations), 1), 4),
    outlierPairs: buildOutliers(pairs).map((entry) => ({
      ...entry,
      zScore: round(entry.zScore, 3),
    })),
  };

  const byComplexity = {
    T1: summarizePairs(pairs.filter((pair) => pair.complexity === 'T1')),
    T2: summarizePairs(pairs.filter((pair) => pair.complexity === 'T2')),
    T3: summarizePairs(pairs.filter((pair) => pair.complexity === 'T3')),
    T4: summarizePairs(pairs.filter((pair) => pair.complexity === 'T4')),
    T5: summarizePairs(pairs.filter((pair) => pair.complexity === 'T5')),
  };
  const byQueryType: Record<AbQueryType, AbStratumSummary> = {
    structural: summarizePairs(pairs.filter((pair) => pair.queryType === 'structural')),
    explanation: summarizePairs(pairs.filter((pair) => pair.queryType === 'explanation')),
    debugging: summarizePairs(pairs.filter((pair) => pair.queryType === 'debugging')),
    architectural: summarizePairs(pairs.filter((pair) => pair.queryType === 'architectural')),
    other: summarizePairs(pairs.filter((pair) => pair.queryType === 'other')),
  };

  const treatmentWorseCases: AbTreatmentWorseCase[] = pairs
    .filter((pair) => pair.control.success && !pair.treatment.success)
    .map((pair) => ({
      runId: pair.runId,
      taskId: pair.taskId,
      complexity: pair.complexity,
      queryType: pair.queryType,
      failureReason: pair.treatment.failureReason ?? 'unknown',
      controlDurationMs: pair.control.durationMs,
      treatmentDurationMs: pair.treatment.durationMs,
      treatmentExtraContextFiles: pair.treatment.extraContextFiles.length,
    }));

  const treatmentRuns = pairs.map((pair) => pair.treatment);
  const successVsExtraContextPearson = pearson(
    treatmentRuns.map((run) => run.success ? 1 : 0),
    treatmentRuns.map((run) => run.extraContextFiles.length),
  );
  const correlation: AbCorrelationSummary = {
    successVsExtraContextPearson: successVsExtraContextPearson === null
      ? null
      : round(successVsExtraContextPearson, 4),
  };

  const rootCause = classifyRootCause({
    overall,
    power,
    variance: varianceSummary,
    byQueryType,
  });
  const decision = recommendDecision({ overall, rootCause });

  return {
    generatedAt: new Date().toISOString(),
    reportsAnalyzed: input.reports.length,
    pairCount: pairs.length,
    uniqueTaskCount,
    overall: {
      ...overall,
      controlSuccessRate: round(overall.controlSuccessRate),
      treatmentSuccessRate: round(overall.treatmentSuccessRate),
      absoluteSuccessRateDelta: round(overall.absoluteSuccessRateDelta),
      relativeLift: round(overall.relativeLift),
      meanDurationDeltaMs: round(overall.meanDurationDeltaMs, 3),
    },
    power,
    variance: varianceSummary,
    strata: {
      byComplexity,
      byQueryType,
    },
    treatmentWorseCases,
    correlation,
    rootCause,
    decision,
  };
}

function formatPercent(value: number): string {
  return `${round(value * 100, 2).toFixed(2)}%`;
}

export function renderAbDiagnosisMarkdown(report: AbDiagnosisReport): string {
  const lines: string[] = [];
  lines.push('# A/B Diagnosis Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Reports analyzed: ${report.reportsAnalyzed}`);
  lines.push(`Paired task samples: ${report.pairCount}`);
  lines.push(`Unique tasks: ${report.uniqueTaskCount}`);
  lines.push('');
  lines.push('## Overall Effect');
  lines.push(`- Control success: ${formatPercent(report.overall.controlSuccessRate)}`);
  lines.push(`- Treatment success: ${formatPercent(report.overall.treatmentSuccessRate)}`);
  lines.push(`- Absolute delta: ${formatPercent(report.overall.absoluteSuccessRateDelta)}`);
  lines.push(`- Relative lift: ${formatPercent(report.overall.relativeLift)}`);
  lines.push(`- 95% CI (absolute delta): [${report.overall.confidenceInterval95.lower}, ${report.overall.confidenceInterval95.upper}]`);
  lines.push(`- p-value: ${report.overall.significance.pValue ?? 'n/a'}`);
  lines.push(`- Significant: ${report.overall.significance.statisticallySignificant === true ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Power');
  lines.push(`- Current per-group samples: ${report.power.currentPerGroup}`);
  lines.push(`- Required per-group (target power ${report.power.targetPower}): ${report.power.requiredPerGroup ?? 'n/a'}`);
  lines.push(`- Sample gap per group: ${report.power.sampleGapPerGroup ?? 'n/a'}`);
  lines.push(`- Estimated current power: ${report.power.estimatedPower}`);
  if (report.power.latestPerGroup !== null) {
    lines.push(`- Coverage vs latest run: ${report.power.aggregateVsLatestMultiplier ?? 0}x (latest n=${report.power.latestPerGroup})`);
  }
  lines.push('');
  lines.push('## Stratified Lift (Query Type)');
  lines.push('| Query Type | nPairs | Control | Treatment | Abs Delta |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const queryType of ['debugging', 'structural', 'explanation', 'architectural', 'other'] as const) {
    const stratum = report.strata.byQueryType[queryType];
    lines.push(
      `| ${queryType} | ${stratum.nPairs} | ${formatPercent(stratum.controlSuccessRate)} | ${formatPercent(stratum.treatmentSuccessRate)} | ${formatPercent(stratum.absoluteSuccessRateDelta)} |`,
    );
  }
  lines.push('');
  lines.push('## Root Cause');
  lines.push(`- Category: ${report.rootCause.category}`);
  for (const reason of report.rootCause.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Decision');
  lines.push(`- Recommended focus: ${report.decision.recommendedFocus}`);
  for (const rationale of report.decision.rationale) {
    lines.push(`- ${rationale}`);
  }
  lines.push('');
  lines.push('## Treatment-Worse Cases');
  if (report.treatmentWorseCases.length === 0) {
    lines.push('- none');
  } else {
    for (const item of report.treatmentWorseCases.slice(0, 10)) {
      lines.push(`- ${item.runId} / ${item.taskId}: ${item.failureReason}`);
    }
  }
  lines.push('');
  lines.push('## Correlation');
  lines.push(`- success vs extra-context-files (pearson): ${report.correlation.successVsExtraContextPearson ?? 'n/a'}`);
  lines.push('');
  return lines.join('\n');
}

export function buildTaskMetadataMap(taskMetadata: Iterable<AbTaskMetadata>): Map<string, AbTaskMetadata> {
  const byId = new Map<string, AbTaskMetadata>();
  for (const entry of taskMetadata) {
    if (!entry.id) continue;
    const normalizedType = entry.queryType ? normalizeQueryType(entry.queryType) : null;
    byId.set(entry.id, {
      ...entry,
      queryType: normalizedType ?? undefined,
    });
  }
  return byId;
}
