/**
 * Probabilistic Analysis Module
 *
 * Implements Bayesian and probabilistic methods for codebase analysis:
 * - Bayesian confidence tracking with Beta-binomial updates
 * - Confidence propagation through dependency graphs
 * - Similarity-based confidence aggregation
 * - Uncertainty quantification
 */

import type {
  LiBrainianStorage,
  BayesianConfidence,
  StabilityMetrics,
} from '../storage/types.js';
import type { ModuleGraph } from '../knowledge/module_graph.js';

// ============================================================================
// BAYESIAN CONFIDENCE TYPES
// ============================================================================

export interface ConfidenceObservation {
  entityId: string;
  entityType: BayesianConfidence['entityType'];
  success: boolean;
  timestamp?: string;
}

export interface ConfidenceEstimate {
  mean: number;
  variance: number;
  lowerBound: number;  // 95% credible interval lower
  upperBound: number;  // 95% credible interval upper
  observations: number;
}

export interface PropagationResult {
  entityId: string;
  originalConfidence: number;
  propagatedConfidence: number;
  contributingSources: number;
}

// ============================================================================
// BAYESIAN CONFIDENCE CALCULATIONS
// ============================================================================

/**
 * Compute the mean of a Beta distribution.
 * Mean = alpha / (alpha + beta)
 */
export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Compute the variance of a Beta distribution.
 * Variance = (alpha * beta) / ((alpha + beta)^2 * (alpha + beta + 1))
 */
export function betaVariance(alpha: number, beta: number): number {
  const sum = alpha + beta;
  return (alpha * beta) / (sum * sum * (sum + 1));
}

/**
 * Compute a 95% credible interval using the quantile function approximation.
 * For beta distribution, uses normal approximation for large samples.
 */
export function betaCredibleInterval(
  alpha: number,
  beta: number,
  level: number = 0.95
): { lower: number; upper: number } {
  const mean = betaMean(alpha, beta);
  const variance = betaVariance(alpha, beta);
  const stdDev = Math.sqrt(variance);

  // Use normal approximation (works well for alpha + beta > 10)
  const z = 1.96; // 95% confidence
  const halfWidth = z * stdDev;

  return {
    lower: Math.max(0, mean - halfWidth),
    upper: Math.min(1, mean + halfWidth),
  };
}

/**
 * Convert a BayesianConfidence record to a ConfidenceEstimate.
 */
export function computeConfidenceEstimate(conf: BayesianConfidence): ConfidenceEstimate {
  const mean = betaMean(conf.posteriorAlpha, conf.posteriorBeta);
  const variance = betaVariance(conf.posteriorAlpha, conf.posteriorBeta);
  const interval = betaCredibleInterval(conf.posteriorAlpha, conf.posteriorBeta);

  return {
    mean,
    variance,
    lowerBound: interval.lower,
    upperBound: interval.upper,
    observations: conf.observationCount,
  };
}

/**
 * Create initial Bayesian confidence with uninformative prior.
 * Uses Jeffrey's prior: Beta(0.5, 0.5)
 */
export function createInitialConfidence(
  entityId: string,
  entityType: BayesianConfidence['entityType']
): BayesianConfidence {
  const now = new Date().toISOString();
  return {
    entityId,
    entityType,
    priorAlpha: 0.5,
    priorBeta: 0.5,
    posteriorAlpha: 0.5,
    posteriorBeta: 0.5,
    observationCount: 0,
    computedAt: now,
  };
}

/**
 * Update Bayesian confidence with a new observation.
 * Returns a new BayesianConfidence object with updated posteriors.
 */
export function updateConfidence(
  conf: BayesianConfidence,
  success: boolean
): BayesianConfidence {
  const now = new Date().toISOString();
  return {
    ...conf,
    posteriorAlpha: success ? conf.posteriorAlpha + 1 : conf.posteriorAlpha,
    posteriorBeta: success ? conf.posteriorBeta : conf.posteriorBeta + 1,
    observationCount: conf.observationCount + 1,
    lastObservation: now,
    computedAt: now,
  };
}

/**
 * Batch update confidence from multiple observations.
 */
export async function recordObservations(
  storage: LiBrainianStorage,
  observations: ConfidenceObservation[]
): Promise<void> {
  for (const obs of observations) {
    await storage.updateBayesianConfidence(obs.entityId, obs.entityType, obs.success);
  }
}

// ============================================================================
// CONFIDENCE PROPAGATION
// ============================================================================

/**
 * Propagate confidence through a dependency graph.
 * A module's confidence is influenced by its dependencies.
 *
 * Algorithm: Weighted average of own confidence + dependency confidences
 * PropagatedConf(A) = w * Conf(A) + (1-w) * avg(Conf(deps of A))
 */
export async function propagateConfidence(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  selfWeight: number = 0.7 // Weight given to self vs dependencies
): Promise<PropagationResult[]> {
  const results: PropagationResult[] = [];

  for (const [entityId, dependencies] of graph) {
    // Get self confidence
    let selfConf = await storage.getBayesianConfidence(entityId, 'module');
    if (!selfConf) {
      selfConf = createInitialConfidence(entityId, 'module');
      await storage.upsertBayesianConfidence(selfConf);
    }

    const selfMean = betaMean(selfConf.posteriorAlpha, selfConf.posteriorBeta);

    // Get dependency confidences
    const depConfidences: number[] = [];
    for (const depId of dependencies) {
      let depConf = await storage.getBayesianConfidence(depId, 'module');
      if (depConf) {
        depConfidences.push(betaMean(depConf.posteriorAlpha, depConf.posteriorBeta));
      }
    }

    // Calculate propagated confidence
    let propagatedConfidence: number;
    if (depConfidences.length === 0) {
      propagatedConfidence = selfMean;
    } else {
      const avgDepConfidence = depConfidences.reduce((a, b) => a + b, 0) / depConfidences.length;
      propagatedConfidence = selfWeight * selfMean + (1 - selfWeight) * avgDepConfidence;
    }

    results.push({
      entityId,
      originalConfidence: selfMean,
      propagatedConfidence,
      contributingSources: depConfidences.length + 1,
    });
  }

  return results;
}

/**
 * Compute aggregate confidence for a set of entities.
 * Uses weighted geometric mean for more conservative estimates.
 */
export function aggregateConfidence(
  confidences: ConfidenceEstimate[],
  weights?: number[]
): ConfidenceEstimate {
  if (confidences.length === 0) {
    return {
      mean: 0.5,
      variance: 0.25,
      lowerBound: 0,
      upperBound: 1,
      observations: 0,
    };
  }

  const effectiveWeights = weights ?? confidences.map(() => 1 / confidences.length);

  // Weighted geometric mean (more conservative than arithmetic)
  let logSum = 0;
  let varianceSum = 0;
  let totalObs = 0;
  let minLower = 1;
  let maxUpper = 0;

  for (let i = 0; i < confidences.length; i++) {
    const conf = confidences[i];
    const w = effectiveWeights[i];

    logSum += w * Math.log(Math.max(conf.mean, 0.001));
    varianceSum += w * w * conf.variance;
    totalObs += conf.observations;
    minLower = Math.min(minLower, conf.lowerBound);
    maxUpper = Math.max(maxUpper, conf.upperBound);
  }

  const aggregatedMean = Math.exp(logSum);

  return {
    mean: aggregatedMean,
    variance: varianceSum,
    lowerBound: minLower,
    upperBound: maxUpper,
    observations: totalObs,
  };
}

// ============================================================================
// STABILITY TRACKING
// ============================================================================

/**
 * Compute stability metrics from a time series of confidence values.
 */
export function computeStabilityFromHistory(
  values: number[],
  timestamps: string[],
  windowDays: number = 30
): Omit<StabilityMetrics, 'entityId' | 'entityType' | 'computedAt'> {
  if (values.length === 0) {
    return {
      volatility: 0,
      trend: 0,
      meanReversionRate: 0,
      halfLifeDays: undefined,
      windowDays,
    };
  }

  if (values.length === 1) {
    return {
      volatility: 0,
      trend: 0,
      meanReversionRate: 0,
      halfLifeDays: undefined,
      windowDays,
    };
  }

  // Volatility: standard deviation of changes
  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) {
    changes.push(values[i] - values[i - 1]);
  }

  const meanChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, c) => a + (c - meanChange) ** 2, 0) / changes.length;
  const volatility = Math.sqrt(variance);

  // Trend: linear regression slope
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  const trend = denominator !== 0 ? numerator / denominator : 0;

  // Mean reversion: Ornstein-Uhlenbeck estimation
  // dX = theta * (mu - X) * dt + sigma * dW
  // Simple AR(1) approximation: X_t = phi * X_{t-1} + epsilon
  const meanValue = yMean;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 1; i < values.length; i++) {
    const centered = values[i - 1] - meanValue;
    const nextCentered = values[i] - meanValue;
    sumXY += centered * nextCentered;
    sumXX += centered * centered;
  }
  const phi = sumXX !== 0 ? sumXY / sumXX : 0;
  const meanReversionRate = -Math.log(Math.abs(phi) + 0.001);

  // Half-life: time for deviation to decay by half (in days)
  const halfLife = meanReversionRate !== 0 ? Math.log(2) / Math.abs(meanReversionRate) : Infinity;

  return {
    volatility,
    trend,
    meanReversionRate,
    halfLifeDays: isFinite(halfLife) ? halfLife : undefined,
    windowDays,
  };
}

/**
 * Record stability metrics for an entity.
 */
export async function recordStabilityMetrics(
  storage: LiBrainianStorage,
  entityId: string,
  entityType: StabilityMetrics['entityType'],
  values: number[],
  timestamps: string[],
  windowDays: number = 30
): Promise<StabilityMetrics> {
  const computed = computeStabilityFromHistory(values, timestamps, windowDays);
  const metrics: StabilityMetrics = {
    entityId,
    entityType,
    ...computed,
    computedAt: new Date().toISOString(),
  };

  await storage.upsertStabilityMetrics(metrics);
  return metrics;
}

// ============================================================================
// UNCERTAINTY QUANTIFICATION
// ============================================================================

export interface UncertaintyReport {
  entityId: string;
  confidence: ConfidenceEstimate;
  uncertaintyLevel: 'low' | 'medium' | 'high' | 'very_high';
  dataQuality: 'sufficient' | 'limited' | 'minimal';
  recommendation: string;
}

/**
 * Generate an uncertainty report for an entity.
 */
export function generateUncertaintyReport(
  entityId: string,
  confidence: ConfidenceEstimate
): UncertaintyReport {
  // Determine uncertainty level based on credible interval width
  const intervalWidth = confidence.upperBound - confidence.lowerBound;
  let uncertaintyLevel: UncertaintyReport['uncertaintyLevel'];
  if (intervalWidth < 0.1) {
    uncertaintyLevel = 'low';
  } else if (intervalWidth < 0.25) {
    uncertaintyLevel = 'medium';
  } else if (intervalWidth < 0.5) {
    uncertaintyLevel = 'high';
  } else {
    uncertaintyLevel = 'very_high';
  }

  // Determine data quality based on observation count
  let dataQuality: UncertaintyReport['dataQuality'];
  if (confidence.observations >= 30) {
    dataQuality = 'sufficient';
  } else if (confidence.observations >= 10) {
    dataQuality = 'limited';
  } else {
    dataQuality = 'minimal';
  }

  // Generate recommendation
  let recommendation: string;
  if (dataQuality === 'minimal') {
    recommendation = 'Collect more observations to establish reliable confidence estimates.';
  } else if (uncertaintyLevel === 'very_high') {
    recommendation = 'High uncertainty suggests inconsistent behavior. Investigate root causes.';
  } else if (uncertaintyLevel === 'high') {
    recommendation = 'Moderate uncertainty. Consider adding tests to stabilize confidence.';
  } else if (confidence.mean < 0.5) {
    recommendation = 'Low confidence indicates potential issues. Review and improve quality.';
  } else {
    recommendation = 'Confidence is stable. Continue monitoring.';
  }

  return {
    entityId,
    confidence,
    uncertaintyLevel,
    dataQuality,
    recommendation,
  };
}

// ============================================================================
// FULL PROBABILISTIC ANALYSIS
// ============================================================================

export interface ProbabilisticAnalysisResult {
  confidenceEstimates: Map<string, ConfidenceEstimate>;
  propagationResults: PropagationResult[];
  uncertaintyReports: UncertaintyReport[];
  aggregateConfidence: ConfidenceEstimate;
  healthScore: number;
}

/**
 * Run full probabilistic analysis on entities.
 */
export async function runProbabilisticAnalysis(
  storage: LiBrainianStorage,
  entityIds: string[],
  entityType: BayesianConfidence['entityType'],
  graph?: ModuleGraph
): Promise<ProbabilisticAnalysisResult> {
  const confidenceEstimates = new Map<string, ConfidenceEstimate>();
  const uncertaintyReports: UncertaintyReport[] = [];

  // Get confidence estimates for each entity
  for (const entityId of entityIds) {
    let conf = await storage.getBayesianConfidence(entityId, entityType);
    if (!conf) {
      conf = createInitialConfidence(entityId, entityType);
    }

    const estimate = computeConfidenceEstimate(conf);
    confidenceEstimates.set(entityId, estimate);
    uncertaintyReports.push(generateUncertaintyReport(entityId, estimate));
  }

  // Run propagation if graph provided
  let propagationResults: PropagationResult[] = [];
  if (graph) {
    propagationResults = await propagateConfidence(storage, graph);
  }

  // Compute aggregate confidence
  const allEstimates = Array.from(confidenceEstimates.values());
  const aggregateConf = aggregateConfidence(allEstimates);

  // Compute health score (weighted by data quality)
  const healthScores = allEstimates.map(e => {
    const weight = Math.min(1, e.observations / 30);
    return weight * e.mean;
  });
  const totalWeight = allEstimates.reduce((sum, e) => sum + Math.min(1, e.observations / 30), 0);
  const healthScore = totalWeight > 0 ? healthScores.reduce((a, b) => a + b, 0) / totalWeight : 0.5;

  return {
    confidenceEstimates,
    propagationResults,
    uncertaintyReports,
    aggregateConfidence: aggregateConf,
    healthScore,
  };
}
