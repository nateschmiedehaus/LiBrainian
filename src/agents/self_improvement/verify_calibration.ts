/**
 * @fileoverview Calibration Verification Primitive (tp_verify_calibration)
 *
 * Verify that confidence scores are well-calibrated.
 * Computes ECE, MCE, Brier score, and provides calibration recommendations.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { LibrarianStorage, ConfidenceEvent, EvolutionOutcome, BayesianConfidence } from '../../storage/types.js';
import type { CalibrationStatus, ConfidenceValue } from './types.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A bin in the reliability diagram.
 */
export interface ReliabilityBin {
  /** Center of the bin (e.g., 0.15 for 0.1-0.2 bin) */
  binCenter: number;
  /** Average predicted probability in this bin */
  predictedProbability: number;
  /** Actual frequency of positive outcomes in this bin */
  actualFrequency: number;
  /** Number of samples in this bin */
  sampleCount: number;
}

/**
 * Reliability diagram for visualizing calibration.
 */
export interface ReliabilityDiagram {
  /** Bins with calibration data */
  bins: ReliabilityBin[];
  /** Perfect calibration reference line */
  perfectCalibrationLine: Array<[number, number]>;
}

/**
 * Sample complexity analysis.
 */
export interface SampleComplexityAnalysis {
  /** Current sample size */
  currentSampleSize: number;
  /** Samples required for a given epsilon */
  requiredSamplesForEpsilon: number;
  /** Current achievable epsilon */
  currentEpsilon: number;
  /** Confidence interval for ECE */
  confidenceInterval: [number, number];
  /** Power analysis results */
  powerAnalysis: {
    /** Current statistical power */
    currentPower: number;
    /** Detectable effect size */
    detectableEffectSize: number;
    /** Samples needed for 80% power */
    samplesForPower80: number;
  };
}

/**
 * Result of calibration verification.
 */
export interface CalibrationVerificationResult {
  /** Expected Calibration Error */
  ece: number;
  /** Maximum Calibration Error */
  mce: number;
  /** Brier score */
  brierScore: number;
  /** Whether the model is well-calibrated */
  isWellCalibrated: boolean;
  /** Recommendations for improving calibration */
  recommendations: string[];
  /** Calibration status */
  calibrationStatus: CalibrationStatus;
  /** Reliability diagram data */
  reliabilityDiagram: ReliabilityDiagram;
  /** Sample complexity analysis */
  sampleComplexityAnalysis: SampleComplexityAnalysis;
  /** Confidence in this calibration assessment */
  confidence: ConfidenceValue;
  /** Duration of verification in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Options for calibration verification.
 */
export interface VerifyCalibrationOptions {
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Minimum samples required for analysis */
  minSamples?: number;
  /** Target ECE for well-calibrated status */
  targetEce?: number;
  /** Number of bins for reliability diagram */
  binCount?: number;
  /** Entity types to include in analysis */
  entityTypes?: Array<'function' | 'module' | 'context_pack'>;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * A prediction-outcome pair for calibration analysis.
 */
interface PredictionOutcome {
  /** Predicted probability (confidence score) */
  predicted: number;
  /** Actual outcome (1 for success, 0 for failure) */
  actual: number;
  /** Entity ID */
  entityId: string;
  /** Timestamp */
  timestamp: Date;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MIN_SAMPLES = 50;
const DEFAULT_TARGET_ECE = 0.05;
const DEFAULT_BIN_COUNT = 10;

// ============================================================================
// DATA GATHERING
// ============================================================================

/**
 * Gather prediction-outcome pairs from storage.
 */
async function gatherPredictionOutcomes(
  storage: LibrarianStorage,
  entityTypes: Array<'function' | 'module' | 'context_pack'>,
  verbose: boolean
): Promise<PredictionOutcome[]> {
  const outcomes: PredictionOutcome[] = [];

  // Gather from evolution outcomes
  try {
    const evolutionOutcomes = await storage.getEvolutionOutcomes({ limit: 1000 });

    for (const outcome of evolutionOutcomes) {
      // Use quality score as predicted confidence
      outcomes.push({
        predicted: outcome.qualityScore,
        actual: outcome.success ? 1 : 0,
        entityId: outcome.taskId,
        timestamp: outcome.timestamp,
      });
    }
  } catch {
    // Evolution outcomes may not be available
  }

  // Gather from Bayesian confidence
  try {
    const bayesianConfidences = await storage.getBayesianConfidences({ limit: 1000 });

    for (const bc of bayesianConfidences) {
      if (entityTypes.includes(bc.entityType as 'function' | 'module' | 'context_pack')) {
        // Calculate mean of posterior distribution
        const mean = bc.posteriorAlpha / (bc.posteriorAlpha + bc.posteriorBeta);
        // Use observations as outcomes
        const successRate = bc.posteriorAlpha - 1; // Prior alpha is 1
        const totalObservations = bc.observationCount;

        if (totalObservations > 0) {
          // Add one entry per observation (approximated)
          const successCount = Math.round(mean * totalObservations);
          for (let i = 0; i < Math.min(totalObservations, 10); i++) {
            outcomes.push({
              predicted: mean,
              actual: i < successCount ? 1 : 0,
              entityId: bc.entityId,
              timestamp: new Date(bc.computedAt),
            });
          }
        }
      }
    }
  } catch {
    // Bayesian confidence may not be available
  }

  // Gather from confidence events
  try {
    const events = await storage.getConfidenceEvents({ limit: 1000 });

    // Group events by entity and use delta direction as outcome proxy
    const entityEvents = new Map<string, ConfidenceEvent[]>();
    for (const event of events) {
      const key = `${event.entityId}-${event.entityType}`;
      const existing = entityEvents.get(key) ?? [];
      existing.push(event);
      entityEvents.set(key, existing);
    }

    // For entities with multiple events, treat positive delta as "correct" prediction
    for (const [key, entityEventList] of entityEvents) {
      if (entityEventList.length >= 2) {
        // Sort by date
        entityEventList.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

        for (let i = 1; i < entityEventList.length; i++) {
          const prevEvent = entityEventList[i - 1];
          const currEvent = entityEventList[i];

          // Use relative position in (0,1) range as predicted
          // Positive delta indicates the previous prediction was "correct"
          outcomes.push({
            predicted: 0.5 + (prevEvent.delta / 2), // Normalize to 0-1
            actual: currEvent.delta > 0 ? 1 : 0,
            entityId: currEvent.entityId,
            timestamp: currEvent.updatedAt,
          });
        }
      }
    }
  } catch {
    // Confidence events may not be available
  }

  if (verbose) {
    console.error(`[verifyCalibration] Gathered ${outcomes.length} prediction-outcome pairs`);
  }

  return outcomes;
}

// ============================================================================
// CALIBRATION METRICS
// ============================================================================

/**
 * Compute binned calibration data.
 */
function computeBins(
  outcomes: PredictionOutcome[],
  binCount: number
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  const binWidth = 1 / binCount;

  for (let i = 0; i < binCount; i++) {
    const binStart = i * binWidth;
    const binEnd = (i + 1) * binWidth;
    const binCenter = (binStart + binEnd) / 2;

    // Filter outcomes in this bin
    const binOutcomes = outcomes.filter(
      (o) => o.predicted >= binStart && o.predicted < binEnd
    );

    if (binOutcomes.length > 0) {
      const predictedProbability = binOutcomes.reduce((sum, o) => sum + o.predicted, 0) / binOutcomes.length;
      const actualFrequency = binOutcomes.reduce((sum, o) => sum + o.actual, 0) / binOutcomes.length;

      bins.push({
        binCenter,
        predictedProbability,
        actualFrequency,
        sampleCount: binOutcomes.length,
      });
    } else {
      bins.push({
        binCenter,
        predictedProbability: binCenter,
        actualFrequency: 0,
        sampleCount: 0,
      });
    }
  }

  return bins;
}

/**
 * Compute Expected Calibration Error (ECE).
 *
 * ECE = sum_i (n_i / N) * |acc_i - conf_i|
 *
 * Where:
 * - n_i = number of samples in bin i
 * - N = total samples
 * - acc_i = accuracy (actual frequency) in bin i
 * - conf_i = average confidence (predicted probability) in bin i
 */
function computeECE(bins: ReliabilityBin[], totalSamples: number): number {
  if (totalSamples === 0) return 0;

  let ece = 0;
  for (const bin of bins) {
    if (bin.sampleCount > 0) {
      const weight = bin.sampleCount / totalSamples;
      const error = Math.abs(bin.actualFrequency - bin.predictedProbability);
      ece += weight * error;
    }
  }

  return ece;
}

/**
 * Compute Maximum Calibration Error (MCE).
 *
 * MCE = max_i |acc_i - conf_i|
 */
function computeMCE(bins: ReliabilityBin[]): number {
  let mce = 0;
  for (const bin of bins) {
    if (bin.sampleCount > 0) {
      const error = Math.abs(bin.actualFrequency - bin.predictedProbability);
      mce = Math.max(mce, error);
    }
  }
  return mce;
}

/**
 * Compute Brier Score.
 *
 * Brier = (1/N) * sum_i (predicted_i - actual_i)^2
 */
function computeBrierScore(outcomes: PredictionOutcome[]): number {
  if (outcomes.length === 0) return 0;

  const sumSquaredError = outcomes.reduce((sum, o) => {
    const error = o.predicted - o.actual;
    return sum + error * error;
  }, 0);

  return sumSquaredError / outcomes.length;
}

// ============================================================================
// SAMPLE COMPLEXITY ANALYSIS
// ============================================================================

/**
 * Compute sample complexity analysis.
 */
function computeSampleComplexity(
  outcomes: PredictionOutcome[],
  ece: number,
  targetEce: number
): SampleComplexityAnalysis {
  const n = outcomes.length;

  // Hoeffding bound: P(|ECE_empirical - ECE_true| >= epsilon) <= 2*exp(-2*n*epsilon^2)
  // For 95% confidence (delta = 0.05): epsilon = sqrt(ln(2/delta) / (2*n))

  const delta = 0.05; // 95% confidence
  const currentEpsilon = n > 0 ? Math.sqrt(Math.log(2 / delta) / (2 * n)) : 1;

  // Samples required for target ECE precision
  const requiredSamplesForEpsilon = Math.ceil(Math.log(2 / delta) / (2 * targetEce * targetEce));

  // Confidence interval
  const ciLower = Math.max(0, ece - currentEpsilon);
  const ciUpper = Math.min(1, ece + currentEpsilon);

  // Power analysis (simplified)
  // Detectable effect size at 80% power with current n
  // d = sqrt(2 * ln(2/alpha) / n) where alpha = 0.05
  const alpha = 0.05;
  const detectableEffectSize = n > 0 ? Math.sqrt(2 * Math.log(2 / alpha) / n) : 1;

  // Current power for detecting target ECE deviation
  // Using normal approximation
  const zAlpha = 1.96; // 95% confidence
  const standardError = n > 0 ? 1 / Math.sqrt(n) : 1;
  const zScore = n > 0 ? (targetEce - ece) / standardError : 0;
  const currentPower = 1 - normalCDF(zAlpha - zScore);

  // Samples for 80% power
  const desiredPower = 0.8;
  const zBeta = 0.84; // 80% power
  const samplesForPower80 = Math.ceil(Math.pow((zAlpha + zBeta) / targetEce, 2));

  return {
    currentSampleSize: n,
    requiredSamplesForEpsilon,
    currentEpsilon,
    confidenceInterval: [ciLower, ciUpper],
    powerAnalysis: {
      currentPower: Math.max(0, Math.min(1, currentPower)),
      detectableEffectSize,
      samplesForPower80,
    },
  };
}

/**
 * Approximate normal CDF using error function approximation.
 */
function normalCDF(x: number): number {
  // Approximation using error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

/**
 * Generate calibration recommendations.
 */
function generateRecommendations(
  ece: number,
  mce: number,
  brierScore: number,
  bins: ReliabilityBin[],
  sampleSize: number,
  targetEce: number
): string[] {
  const recommendations: string[] = [];

  // Check overall calibration
  if (ece > targetEce) {
    recommendations.push(`ECE (${ece.toFixed(3)}) exceeds target (${targetEce}). Consider recalibrating confidence estimates.`);
  }

  // Check for overconfidence
  const overconfidentBins = bins.filter(
    (b) => b.sampleCount >= 5 && b.predictedProbability > b.actualFrequency + 0.1
  );
  if (overconfidentBins.length > 0) {
    recommendations.push(
      `Overconfidence detected in ${overconfidentBins.length} bins. Consider reducing confidence scores for predictions in these ranges.`
    );
  }

  // Check for underconfidence
  const underconfidentBins = bins.filter(
    (b) => b.sampleCount >= 5 && b.actualFrequency > b.predictedProbability + 0.1
  );
  if (underconfidentBins.length > 0) {
    recommendations.push(
      `Underconfidence detected in ${underconfidentBins.length} bins. Consider increasing confidence scores for predictions in these ranges.`
    );
  }

  // Check for high MCE
  if (mce > 0.2) {
    recommendations.push(
      `Maximum Calibration Error (${mce.toFixed(3)}) is high. Focus on improving calibration in the worst-performing bin.`
    );
  }

  // Check sample size
  if (sampleSize < 100) {
    recommendations.push(
      `Sample size (${sampleSize}) is low. Gather more predictions to improve calibration estimates.`
    );
  }

  // Check Brier score
  if (brierScore > 0.25) {
    recommendations.push(
      `Brier score (${brierScore.toFixed(3)}) is high, indicating poor probabilistic predictions. Consider model improvements.`
    );
  }

  // Specific bin recommendations
  for (const bin of bins) {
    if (bin.sampleCount >= 10) {
      const error = Math.abs(bin.actualFrequency - bin.predictedProbability);
      if (error > 0.15) {
        const direction = bin.actualFrequency > bin.predictedProbability ? 'increase' : 'decrease';
        recommendations.push(
          `For predictions around ${(bin.binCenter * 100).toFixed(0)}%: ${direction} confidence by ~${(error * 100).toFixed(0)}%`
        );
      }
    }
  }

  // If well-calibrated, add positive feedback
  if (ece <= targetEce && mce <= 0.15) {
    recommendations.push('Calibration is good. Continue monitoring for distribution shift.');
  }

  return recommendations;
}

// ============================================================================
// STATUS DETERMINATION
// ============================================================================

/**
 * Determine calibration status.
 */
function determineCalibrationStatus(
  ece: number,
  sampleSize: number,
  targetEce: number,
  minSamples: number
): CalibrationStatus {
  if (sampleSize < minSamples) {
    return 'insufficient_data';
  }

  if (ece <= targetEce) {
    return 'well_calibrated';
  }

  // Check for potential distribution shift
  // (would need historical data to properly detect)
  if (ece > targetEce * 3) {
    return 'distribution_shift';
  }

  return 'miscalibrated';
}

// ============================================================================
// MAIN VERIFICATION FUNCTION
// ============================================================================

/**
 * Verify calibration quality of confidence values.
 *
 * This function:
 * 1. Gathers prediction-outcome pairs from storage
 * 2. Computes ECE, MCE, and Brier score
 * 3. Builds a reliability diagram
 * 4. Generates calibration recommendations
 *
 * @param options - Verification options
 * @returns Calibration verification result
 *
 * @example
 * ```typescript
 * const result = await verifyCalibration({
 *   storage: myStorage,
 *   minSamples: 100,
 *   targetEce: 0.05,
 * });
 * console.log(`ECE: ${result.ece}, Well-calibrated: ${result.isWellCalibrated}`);
 * ```
 */
export async function verifyCalibration(
  options: VerifyCalibrationOptions
): Promise<CalibrationVerificationResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    storage,
    minSamples = DEFAULT_MIN_SAMPLES,
    targetEce = DEFAULT_TARGET_ECE,
    binCount = DEFAULT_BIN_COUNT,
    entityTypes = ['function', 'module', 'context_pack'],
    verbose = false,
  } = options;

  // Validate inputs
  if (!storage) {
    throw new Error('storage is required for verifyCalibration');
  }

  if (verbose) {
    console.error(`[verifyCalibration] Starting calibration verification`);
  }

  // Gather prediction-outcome pairs
  let outcomes: PredictionOutcome[] = [];
  try {
    outcomes = await gatherPredictionOutcomes(storage, entityTypes, verbose);
  } catch (error) {
    errors.push(`Failed to gather outcomes: ${getErrorMessage(error)}`);
  }

  const totalSamples = outcomes.length;

  // Compute bins
  const bins = computeBins(outcomes, binCount);

  // Compute metrics
  const ece = computeECE(bins, totalSamples);
  const mce = computeMCE(bins);
  const brierScore = computeBrierScore(outcomes);

  if (verbose) {
    console.error(`[verifyCalibration] ECE: ${ece.toFixed(4)}, MCE: ${mce.toFixed(4)}, Brier: ${brierScore.toFixed(4)}`);
  }

  // Determine status
  const calibrationStatus = determineCalibrationStatus(ece, totalSamples, targetEce, minSamples);
  const isWellCalibrated = calibrationStatus === 'well_calibrated';

  // Compute sample complexity
  const sampleComplexityAnalysis = computeSampleComplexity(outcomes, ece, targetEce);

  // Generate recommendations
  const recommendations = generateRecommendations(ece, mce, brierScore, bins, totalSamples, targetEce);

  // Build reliability diagram
  const reliabilityDiagram: ReliabilityDiagram = {
    bins,
    perfectCalibrationLine: [[0, 0], [1, 1]],
  };

  // Compute confidence in this assessment
  const assessmentConfidence: ConfidenceValue = {
    score: totalSamples >= minSamples ? Math.min(1, totalSamples / 500) : totalSamples / minSamples,
    tier: totalSamples >= minSamples * 2 ? 'high' : totalSamples >= minSamples ? 'medium' : 'low',
    source: 'measured',
    sampleSize: totalSamples,
  };

  return {
    ece,
    mce,
    brierScore,
    isWellCalibrated,
    recommendations,
    calibrationStatus,
    reliabilityDiagram,
    sampleComplexityAnalysis,
    confidence: assessmentConfidence,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a calibration verification primitive with bound options.
 */
export function createVerifyCalibration(
  defaultOptions: Partial<VerifyCalibrationOptions>
): (options?: Partial<VerifyCalibrationOptions>) => Promise<CalibrationVerificationResult> {
  return async (options = {}) => {
    return verifyCalibration({
      ...defaultOptions,
      ...options,
    } as VerifyCalibrationOptions);
  };
}
