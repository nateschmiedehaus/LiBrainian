/**
 * @fileoverview Calibration curve computation from outcome samples (Track F C2).
 *
 * Computes bucketed calibration curves, Expected Calibration Error (ECE),
 * and Maximum Calibration Error (MCE) from outcome data.
 */

export interface CalibrationSample {
  confidence: number;
  outcome: number;
}

export interface CalibrationBucket {
  /** Upper bound for the bucket (e.g., 0.1, 0.2, ..., 1.0) */
  confidenceBucket: number;
  /** Confidence range [min, max) */
  range: [number, number];
  /** Mean stated confidence in this bucket */
  statedMean: number;
  /** Empirical accuracy in this bucket */
  empiricalAccuracy: number;
  /** Number of samples in this bucket */
  sampleSize: number;
  /** Standard error of the empirical accuracy */
  standardError: number;
  /** |statedMean - empiricalAccuracy| */
  calibrationError: number;
}

export interface CalibrationCurve {
  buckets: CalibrationBucket[];
  ece: number;
  mce: number;
  overconfidenceRatio: number;
  sampleSize: number;
}

export interface CalibrationReport {
  datasetId: string;
  computedAt: string;
  calibrationCurve: Map<number, number>;
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  adjustments: Map<string, { raw: number; calibrated: number }>;
  buckets: CalibrationBucket[];
  sampleSize: number;
  overconfidenceRatio: number;
}

export interface CalibrationReportSnapshot {
  id: string;
  datasetId: string;
  computedAt: string;
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  overconfidenceRatio: number;
  sampleSize: number;
  bucketCount: number;
  buckets: CalibrationBucket[];
  calibrationCurve: Array<{ bucket: number; accuracy: number }>;
  adjustments: Array<{ bucket: string; raw: number; calibrated: number }>;
  claimType?: string;
  category?: string;
}

export interface CalibrationCurveOptions {
  bucketCount?: number;
  minConfidence?: number;
  maxConfidence?: number;
}

export interface CalibrationAdjustmentOptions {
  minSamplesForAdjustment?: number;
  minSamplesForFullWeight?: number;
  clamp?: [number, number];
}

export interface CalibrationAdjustmentResult {
  raw: number;
  calibrated: number;
  weight: number;
  bucket?: CalibrationBucket;
}

export function computeCalibrationCurve(
  samples: CalibrationSample[],
  options: CalibrationCurveOptions = {}
): CalibrationCurve {
  const bucketCount = options.bucketCount ?? 10;
  const minConfidence = options.minConfidence ?? 0;
  const maxConfidence = options.maxConfidence ?? 1;

  if (bucketCount <= 0) {
    throw new Error('calibration_bucket_count_invalid');
  }

  const width = (maxConfidence - minConfidence) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const lower = roundTo(minConfidence + index * width, 4);
    const upper = index === bucketCount - 1
      ? roundTo(maxConfidence, 4)
      : roundTo(minConfidence + (index + 1) * width, 4);
    return {
      range: [lower, upper] as [number, number],
      label: upper,
      count: 0,
      sumConfidence: 0,
      sumOutcome: 0,
      sumOutcomeSquares: 0,
    };
  });

  let totalSamples = 0;
  let overconfidenceCount = 0;

  for (const sample of samples) {
    const confidence = clamp(sample.confidence, minConfidence, maxConfidence);
    const outcome = clamp(sample.outcome, 0, 1);
    const bucketIndex = confidence >= maxConfidence
      ? bucketCount - 1
      : Math.min(bucketCount - 1, Math.max(0, Math.floor((confidence - minConfidence) / width)));
    const bucket = buckets[bucketIndex];

    bucket.count += 1;
    bucket.sumConfidence += confidence;
    bucket.sumOutcome += outcome;
    bucket.sumOutcomeSquares += outcome * outcome;
    totalSamples += 1;

    if (confidence > outcome) {
      overconfidenceCount += 1;
    }
  }

  let eceSum = 0;
  let mce = 0;

  const bucketReports: CalibrationBucket[] = buckets.map((bucket) => {
    if (bucket.count === 0) {
      return {
        confidenceBucket: bucket.label,
        range: bucket.range,
        statedMean: 0,
        empiricalAccuracy: 0,
        sampleSize: 0,
        standardError: 0,
        calibrationError: 0,
      };
    }

    const statedMean = bucket.sumConfidence / bucket.count;
    const empiricalAccuracy = bucket.sumOutcome / bucket.count;
    const meanSquare = bucket.sumOutcomeSquares / bucket.count;
    const variance = Math.max(0, meanSquare - empiricalAccuracy * empiricalAccuracy);
    const standardError = Math.sqrt(variance / bucket.count);
    const calibrationError = Math.abs(statedMean - empiricalAccuracy);

    eceSum += bucket.count * calibrationError;
    mce = Math.max(mce, calibrationError);

    return {
      confidenceBucket: bucket.label,
      range: bucket.range,
      statedMean,
      empiricalAccuracy,
      sampleSize: bucket.count,
      standardError,
      calibrationError,
    };
  });

  const ece = totalSamples > 0 ? eceSum / totalSamples : 0;
  const overconfidenceRatio = totalSamples > 0 ? overconfidenceCount / totalSamples : 0;

  return {
    buckets: bucketReports,
    ece,
    mce,
    overconfidenceRatio,
    sampleSize: totalSamples,
  };
}

export function buildCalibrationReport(
  datasetId: string,
  curve: CalibrationCurve,
  computedAt: Date = new Date()
): CalibrationReport {
  const calibrationCurve = new Map<number, number>();
  const adjustments = new Map<string, { raw: number; calibrated: number }>();

  for (const bucket of curve.buckets) {
    calibrationCurve.set(bucket.confidenceBucket, bucket.empiricalAccuracy);
    const range = formatBucketRange(bucket.range);
    adjustments.set(range, { raw: bucket.statedMean, calibrated: bucket.empiricalAccuracy });
  }

  return {
    datasetId,
    computedAt: computedAt.toISOString(),
    calibrationCurve,
    expectedCalibrationError: curve.ece,
    maximumCalibrationError: curve.mce,
    adjustments,
    buckets: curve.buckets,
    sampleSize: curve.sampleSize,
    overconfidenceRatio: curve.overconfidenceRatio,
  };
}

export function snapshotCalibrationReport(
  report: CalibrationReport,
  options: { id: string; bucketCount: number; claimType?: string; category?: string }
): CalibrationReportSnapshot {
  return {
    id: options.id,
    datasetId: report.datasetId,
    computedAt: report.computedAt,
    expectedCalibrationError: report.expectedCalibrationError,
    maximumCalibrationError: report.maximumCalibrationError,
    overconfidenceRatio: report.overconfidenceRatio,
    sampleSize: report.sampleSize,
    bucketCount: options.bucketCount,
    buckets: report.buckets,
    calibrationCurve: Array.from(report.calibrationCurve.entries()).map(([bucket, accuracy]) => ({
      bucket,
      accuracy,
    })),
    adjustments: Array.from(report.adjustments.entries()).map(([bucket, values]) => ({
      bucket,
      raw: values.raw,
      calibrated: values.calibrated,
    })),
    claimType: options.claimType,
    category: options.category,
  };
}

export function restoreCalibrationReport(snapshot: CalibrationReportSnapshot): CalibrationReport {
  const calibrationCurve = new Map<number, number>(
    snapshot.calibrationCurve.map((entry) => [entry.bucket, entry.accuracy])
  );
  const adjustments = new Map<string, { raw: number; calibrated: number }>(
    snapshot.adjustments.map((entry) => [entry.bucket, { raw: entry.raw, calibrated: entry.calibrated }])
  );

  return {
    datasetId: snapshot.datasetId,
    computedAt: snapshot.computedAt,
    calibrationCurve,
    expectedCalibrationError: snapshot.expectedCalibrationError,
    maximumCalibrationError: snapshot.maximumCalibrationError,
    adjustments,
    buckets: snapshot.buckets,
    sampleSize: snapshot.sampleSize,
    overconfidenceRatio: snapshot.overconfidenceRatio,
  };
}

export function adjustConfidenceScore(
  rawConfidence: number,
  report: CalibrationReport,
  options: CalibrationAdjustmentOptions = {}
): CalibrationAdjustmentResult {
  const clampBounds = options.clamp ?? [0, 1];
  const clamped = clamp(rawConfidence, clampBounds[0], clampBounds[1]);
  if (report.buckets.length === 0) {
    return { raw: clamped, calibrated: clamped, weight: 0 };
  }

  const bucket = findBucketForConfidence(report.buckets, clamped);
  if (!bucket) {
    return { raw: clamped, calibrated: clamped, weight: 0 };
  }

  const minSamplesForAdjustment = options.minSamplesForAdjustment ?? 3;
  if (bucket.sampleSize < minSamplesForAdjustment) {
    return { raw: clamped, calibrated: clamped, weight: 0, bucket };
  }

  const minSamplesForFullWeight = options.minSamplesForFullWeight ?? 20;
  const weight = Math.min(1, bucket.sampleSize / minSamplesForFullWeight);
  const calibrated = clamp(
    bucket.empiricalAccuracy * weight + clamped * (1 - weight),
    clampBounds[0],
    clampBounds[1]
  );

  return { raw: clamped, calibrated, weight, bucket };
}

function formatBucketRange(range: [number, number]): string {
  const [low, high] = range;
  return `[${low.toFixed(2)}, ${high.toFixed(2)})`;
}

function findBucketForConfidence(
  buckets: CalibrationBucket[],
  confidence: number
): CalibrationBucket | undefined {
  if (buckets.length === 0) return undefined;
  const lastIndex = buckets.length - 1;
  return buckets.find((bucket, index) => {
    const [min, max] = bucket.range;
    if (index === lastIndex) {
      return confidence >= min && confidence <= max;
    }
    return confidence >= min && confidence < max;
  });
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ============================================================================
// PROPER SCORING RULES
// ============================================================================

/**
 * Input type for proper scoring rule computations.
 */
export interface ScoringPrediction {
  /** Predicted probability (0 to 1) */
  predicted: number;
  /** Actual outcome: 1 = positive/correct, 0 = negative/incorrect */
  actual: 0 | 1;
}

/**
 * Computes the Brier Score for a set of probabilistic predictions.
 *
 * The Brier Score is a proper scoring rule that measures the accuracy of
 * probabilistic predictions. It is the mean squared error between predicted
 * probabilities and actual outcomes.
 *
 * Formula: (1/n) * Σ(predicted - actual)²
 *
 * Range: [0, 1] where 0 is perfect calibration and 1 is worst possible.
 * - A Brier Score of 0.25 corresponds to random guessing (predicting 0.5 always)
 * - Lower scores indicate better calibration
 *
 * This is a strictly proper scoring rule, meaning it incentivizes honest
 * probability assessments - the expected score is minimized when predictions
 * match true underlying probabilities.
 *
 * @param predictions - Array of {predicted, actual} pairs
 * @returns Brier Score (0 = perfect, 1 = worst)
 * @throws Error if predictions array is empty
 *
 * @example
 * ```ts
 * const score = computeBrierScore([
 *   { predicted: 0.9, actual: 1 },  // High confidence, correct
 *   { predicted: 0.2, actual: 0 },  // Low confidence, correct
 *   { predicted: 0.8, actual: 0 },  // High confidence, wrong - penalized heavily
 * ]);
 * ```
 */
export function computeBrierScore(predictions: ScoringPrediction[]): number {
  if (predictions.length === 0) {
    throw new Error('Cannot compute Brier Score from empty predictions array');
  }

  let sumSquaredError = 0;
  for (const { predicted, actual } of predictions) {
    const clamped = clamp(predicted, 0, 1);
    const error = clamped - actual;
    sumSquaredError += error * error;
  }

  return sumSquaredError / predictions.length;
}

/**
 * Small epsilon to prevent log(0) in log loss computation.
 * Clamps predictions away from exact 0 and 1.
 */
const LOG_LOSS_EPSILON = 1e-15;

/**
 * Computes the Log Loss (cross-entropy loss) for a set of probabilistic predictions.
 *
 * Log Loss is a proper scoring rule that heavily penalizes confident wrong predictions.
 * It measures the negative log-likelihood of the actual outcomes given the predictions.
 *
 * Formula: -(1/n) * Σ[actual*log(predicted) + (1-actual)*log(1-predicted)]
 *
 * Range: [0, ∞) where 0 is perfect and higher values indicate worse performance.
 * - Log Loss of 0.693 corresponds to random guessing (predicting 0.5 always)
 * - A confident wrong prediction (e.g., predicted=0.99, actual=0) yields high loss
 *
 * This is a strictly proper scoring rule that penalizes overconfidence more
 * severely than Brier Score.
 *
 * Edge Case Handling: Predictions of exactly 0 or 1 are clamped to [ε, 1-ε]
 * where ε = 1e-15 to avoid log(0) = -∞.
 *
 * @param predictions - Array of {predicted, actual} pairs
 * @returns Log Loss (0 = perfect, higher = worse)
 * @throws Error if predictions array is empty
 *
 * @example
 * ```ts
 * const loss = computeLogLoss([
 *   { predicted: 0.9, actual: 1 },  // Good: -log(0.9) ≈ 0.105
 *   { predicted: 0.1, actual: 0 },  // Good: -log(0.9) ≈ 0.105
 *   { predicted: 0.99, actual: 0 }, // Bad: -log(0.01) ≈ 4.605 (heavily penalized)
 * ]);
 * ```
 */
export function computeLogLoss(predictions: ScoringPrediction[]): number {
  if (predictions.length === 0) {
    throw new Error('Cannot compute Log Loss from empty predictions array');
  }

  let sumLogLoss = 0;
  for (const { predicted, actual } of predictions) {
    // Clamp to avoid log(0)
    const p = clamp(predicted, LOG_LOSS_EPSILON, 1 - LOG_LOSS_EPSILON);

    if (actual === 1) {
      sumLogLoss -= Math.log(p);
    } else {
      sumLogLoss -= Math.log(1 - p);
    }
  }

  return sumLogLoss / predictions.length;
}

// ============================================================================
// WILSON SCORE INTERVAL
// ============================================================================

/**
 * Computes the Wilson score confidence interval for a binomial proportion.
 *
 * The Wilson interval is more accurate than the normal approximation (Wald interval)
 * especially for small sample sizes or proportions near 0 or 1. It has better
 * coverage probability and never produces impossible intervals (< 0 or > 1).
 *
 * Formula (for lower and upper bounds):
 * ```
 * center = (p + z²/2n) / (1 + z²/n)
 * margin = z * sqrt(p(1-p)/n + z²/4n²) / (1 + z²/n)
 * interval = [center - margin, center + margin]
 * ```
 *
 * Where:
 * - p = successes/total (observed proportion)
 * - n = total (sample size)
 * - z = z-score for desired confidence level (1.96 for 95%)
 *
 * @param successes - Number of successful outcomes
 * @param total - Total number of trials
 * @param confidence - Confidence level (default: 0.95 for 95% CI)
 * @returns Tuple [lower, upper] representing the confidence interval bounds
 * @throws Error if total is 0 or negative, or if successes > total
 *
 * @example
 * ```ts
 * // 7 successes out of 10 trials, 95% CI
 * const [lower, upper] = computeWilsonInterval(7, 10);
 * // Returns approximately [0.35, 0.93]
 *
 * // Small sample: 1 success out of 2 trials
 * const [l, u] = computeWilsonInterval(1, 2);
 * // Wilson interval handles this gracefully, unlike normal approximation
 * ```
 *
 * @see https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
 */
export function computeWilsonInterval(
  successes: number,
  total: number,
  confidence: number = 0.95
): [number, number] {
  if (total <= 0) {
    throw new Error('Total must be positive');
  }
  if (successes < 0 || successes > total) {
    throw new Error(`Successes (${successes}) must be between 0 and total (${total})`);
  }
  if (confidence <= 0 || confidence >= 1) {
    throw new Error('Confidence level must be between 0 and 1 (exclusive)');
  }

  // Get z-score for the confidence level
  // For common values: 0.95 -> 1.96, 0.99 -> 2.576, 0.90 -> 1.645
  const z = getZScore(confidence);
  const n = total;
  const p = successes / total;

  const z2 = z * z;
  const denominator = 1 + z2 / n;

  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);

  return [lower, upper];
}

/**
 * Approximates the z-score (standard normal quantile) for a given confidence level
 * using the rational approximation method (Abramowitz and Stegun, formula 26.2.23).
 *
 * @param confidence - Confidence level (e.g., 0.95 for 95% CI)
 * @returns z-score for two-tailed test
 */
function getZScore(confidence: number): number {
  // For two-tailed interval, we need quantile at (1 + confidence) / 2
  const p = (1 + confidence) / 2;

  // Fast path for common values
  if (Math.abs(confidence - 0.95) < 0.001) return 1.959963984540054;
  if (Math.abs(confidence - 0.99) < 0.001) return 2.5758293035489004;
  if (Math.abs(confidence - 0.90) < 0.001) return 1.6448536269514729;

  // Rational approximation (Abramowitz and Stegun 26.2.23)
  // Valid for 0.5 < p < 1
  const t = Math.sqrt(-2 * Math.log(1 - p));

  // Coefficients for the approximation
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

// ============================================================================
// ISOTONIC REGRESSION CALIBRATION (WU-THIMPL-112)
// ============================================================================

/**
 * A point in the calibrated mapping.
 */
export interface CalibrationPoint {
  /** Raw (uncalibrated) score */
  raw: number;
  /** Calibrated probability */
  calibrated: number;
}

/**
 * Result of isotonic calibration: a monotonic mapping from raw scores
 * to calibrated probabilities.
 */
export interface CalibratedMapping {
  /** Ordered array of calibration points */
  points: CalibrationPoint[];
  /** Minimum raw score in the training data */
  minRaw: number;
  /** Maximum raw score in the training data */
  maxRaw: number;
  /** Number of samples used for calibration */
  sampleSize: number;
  /** Whether the mapping is strictly increasing (no ties) */
  isStrictlyMonotonic: boolean;
}

/**
 * Performs isotonic regression calibration using the Pool Adjacent Violators
 * (PAV) algorithm.
 *
 * Isotonic regression finds a monotonic function that minimizes the weighted
 * least squares error. This is superior to histogram binning for calibration
 * because:
 *
 * 1. **Monotonicity Guarantee**: The output is always monotonically increasing.
 *    If a model gives higher scores to more confident predictions, calibrated
 *    probabilities will also be higher. Histogram binning can violate this.
 *
 * 2. **Better Small-Sample Behavior**: PAV adapts the "bin width" based on data,
 *    automatically merging adjacent groups when they violate monotonicity.
 *
 * 3. **No Bin Choice**: No need to choose number of bins or bin boundaries.
 *
 * The PAV algorithm works by:
 * 1. Sorting predictions by raw score
 * 2. Scanning for monotonicity violations (where empirical accuracy decreases
 *    as raw score increases)
 * 3. "Pooling" adjacent violating pairs by averaging their values
 * 4. Repeating until the entire sequence is monotonic
 *
 * Time complexity: O(n log n) due to initial sort, then O(n) for PAV.
 *
 * @param predictions - Array of {predicted, actual} pairs to calibrate on
 * @returns CalibratedMapping that can be used to transform new predictions
 * @throws Error if predictions array is empty
 *
 * @example
 * ```typescript
 * const mapping = isotonicCalibration([
 *   { predicted: 0.9, actual: 1 },
 *   { predicted: 0.8, actual: 1 },
 *   { predicted: 0.7, actual: 0 },  // Violator - will be pooled
 *   { predicted: 0.6, actual: 1 },  // with adjacent points
 *   { predicted: 0.3, actual: 0 },
 * ]);
 *
 * // Use the mapping:
 * const calibratedScore = applyIsotonicMapping(mapping, 0.75);
 * ```
 *
 * @see https://en.wikipedia.org/wiki/Isotonic_regression
 * @see Zadrozny & Elkan (2002) "Transforming Classifier Scores into
 *      Accurate Multiclass Probability Estimates"
 */
export function isotonicCalibration(predictions: ScoringPrediction[]): CalibratedMapping {
  if (predictions.length === 0) {
    throw new Error('Cannot perform isotonic calibration on empty predictions array');
  }

  // Sort predictions by raw score (ascending)
  const sorted = [...predictions].sort((a, b) => a.predicted - b.predicted);

  // Initialize blocks - each prediction starts as its own block
  // A block has: sum of actuals, count, weighted average
  interface Block {
    sumActual: number;
    count: number;
    minRaw: number;
    maxRaw: number;
  }

  const blocks: Block[] = sorted.map((p) => ({
    sumActual: p.actual,
    count: 1,
    minRaw: p.predicted,
    maxRaw: p.predicted,
  }));

  // Pool Adjacent Violators algorithm
  // Merge adjacent blocks that violate monotonicity
  let i = 0;
  while (i < blocks.length - 1) {
    const currentAvg = blocks[i].sumActual / blocks[i].count;
    const nextAvg = blocks[i + 1].sumActual / blocks[i + 1].count;

    if (currentAvg > nextAvg) {
      // Violation: current block has higher average than next
      // Pool them together
      blocks[i] = {
        sumActual: blocks[i].sumActual + blocks[i + 1].sumActual,
        count: blocks[i].count + blocks[i + 1].count,
        minRaw: blocks[i].minRaw,
        maxRaw: blocks[i + 1].maxRaw,
      };
      blocks.splice(i + 1, 1);

      // Move back to check if pooling created a new violation
      if (i > 0) {
        i--;
      }
    } else {
      i++;
    }
  }

  // Convert blocks to calibration points
  // Each block maps to its average empirical accuracy
  const points: CalibrationPoint[] = [];
  let prevCalibrated = -1;
  let isStrictlyMonotonic = true;

  for (const block of blocks) {
    const calibrated = block.sumActual / block.count;

    // Add point for the start of the block
    points.push({
      raw: block.minRaw,
      calibrated,
    });

    // If block spans a range, add point for end too
    if (block.maxRaw > block.minRaw) {
      points.push({
        raw: block.maxRaw,
        calibrated,
      });
    }

    // Check strict monotonicity
    if (calibrated <= prevCalibrated && prevCalibrated >= 0) {
      isStrictlyMonotonic = false;
    }
    prevCalibrated = calibrated;
  }

  // Deduplicate points with same raw value (keep the calibrated value)
  const deduped: CalibrationPoint[] = [];
  for (const point of points) {
    if (deduped.length === 0 || deduped[deduped.length - 1].raw !== point.raw) {
      deduped.push(point);
    }
  }

  return {
    points: deduped,
    minRaw: sorted[0].predicted,
    maxRaw: sorted[sorted.length - 1].predicted,
    sampleSize: predictions.length,
    isStrictlyMonotonic,
  };
}

/**
 * Apply an isotonic calibration mapping to a new raw score.
 *
 * Uses linear interpolation between calibration points for scores
 * within the training range. Extrapolates at boundaries using the
 * nearest calibrated value.
 *
 * @param mapping - CalibratedMapping from isotonicCalibration()
 * @param rawScore - The raw score to calibrate
 * @returns Calibrated probability
 */
export function applyIsotonicMapping(mapping: CalibratedMapping, rawScore: number): number {
  const { points, minRaw, maxRaw } = mapping;

  if (points.length === 0) {
    return rawScore; // No calibration available
  }

  if (points.length === 1) {
    return points[0].calibrated;
  }

  // Handle extrapolation
  if (rawScore <= minRaw) {
    return points[0].calibrated;
  }
  if (rawScore >= maxRaw) {
    return points[points.length - 1].calibrated;
  }

  // Find the two points to interpolate between
  let left = 0;
  let right = points.length - 1;

  while (left < right - 1) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid].raw <= rawScore) {
      left = mid;
    } else {
      right = mid;
    }
  }

  // Linear interpolation
  const p1 = points[left];
  const p2 = points[right];

  if (p2.raw === p1.raw) {
    return p1.calibrated;
  }

  const t = (rawScore - p1.raw) / (p2.raw - p1.raw);
  return p1.calibrated + t * (p2.calibrated - p1.calibrated);
}

// ============================================================================
// BOOTSTRAP CALIBRATION (WU-THIMPL-113)
// ============================================================================

/**
 * Configuration for calibration with principled defaults.
 */
export interface CalibrationConfig {
  /** Number of buckets for histogram binning */
  bucketCount: number;
  /** Minimum samples needed per bucket for adjustment */
  minSamplesPerBucket: number;
  /** Minimum total samples for any calibration */
  minTotalSamples: number;
  /** Whether to use isotonic regression instead of histogram */
  useIsotonic: boolean;
  /** Weight given to calibrated vs raw scores (0-1) */
  calibrationWeight: number;
  /** Prior for Bayesian smoothing (Beta distribution alpha/beta) */
  prior: { alpha: number; beta: number };
  /** Description of why these parameters were chosen */
  rationale: string;
}

/**
 * Returns appropriate calibration configuration for cold-start scenarios
 * with limited data.
 *
 * Bootstrap calibration implements principled priors based on sample size to
 * handle the "cold start" problem: when you have very few samples, aggressive
 * calibration can lead to worse results than using uncalibrated scores.
 *
 * The configuration adapts based on sample size:
 *
 * **N < 10**: Don't calibrate at all. Use a flat prior and raw scores.
 * The variance from few samples would make calibration harmful.
 *
 * **10 <= N < 50**: Conservative calibration. Use Bayesian smoothing with
 * a strong prior (Beta(2,2) = uniform prior). Low calibration weight.
 * Fewer, wider buckets.
 *
 * **50 <= N < 200**: Moderate calibration. Weaker prior (Beta(1,1) = uniform).
 * More buckets. Consider isotonic for monotonicity.
 *
 * **N >= 200**: Full calibration. Minimal prior. Isotonic regression.
 * Full calibration weight.
 *
 * The key insight is that calibration is itself an estimation problem.
 * With few samples, our calibration curve estimate has high variance,
 * which can make things worse. We need to balance:
 * - Bias (from not calibrating)
 * - Variance (from calibrating on too little data)
 *
 * @param sampleSize - Number of samples available for calibration
 * @returns CalibrationConfig with principled parameters for the sample size
 *
 * @example
 * ```typescript
 * // New model with 25 outcome samples
 * const config = bootstrapCalibration(25);
 * // config.useIsotonic = false (not enough data)
 * // config.bucketCount = 3 (wide buckets for stability)
 * // config.calibrationWeight = 0.3 (mostly trust raw scores)
 *
 * // Established model with 500 outcome samples
 * const fullConfig = bootstrapCalibration(500);
 * // fullConfig.useIsotonic = true (stable isotonic regression)
 * // fullConfig.calibrationWeight = 1.0 (full calibration)
 * ```
 *
 * @see Bella et al. (2009) "On the Effect of Calibration Data on Calibration
 *      in Binary and Multiclass Classification"
 */
export function bootstrapCalibration(sampleSize: number): CalibrationConfig {
  if (sampleSize < 0) {
    throw new Error('Sample size cannot be negative');
  }

  // Tier 1: Insufficient data - don't calibrate
  if (sampleSize < 10) {
    return {
      bucketCount: 1,
      minSamplesPerBucket: 10,
      minTotalSamples: 10,
      useIsotonic: false,
      calibrationWeight: 0,
      prior: { alpha: 2, beta: 2 }, // Strong prior toward 0.5
      rationale:
        'Insufficient samples (N < 10). Calibration would add more variance than ' +
        'bias reduction. Using raw scores with no adjustment.',
    };
  }

  // Tier 2: Very limited data - conservative calibration
  if (sampleSize < 50) {
    const buckets = Math.max(2, Math.floor(sampleSize / 10));
    return {
      bucketCount: buckets,
      minSamplesPerBucket: 5,
      minTotalSamples: 10,
      useIsotonic: false,
      calibrationWeight: 0.3, // Mostly trust raw scores
      prior: { alpha: 2, beta: 2 }, // Moderate prior
      rationale:
        `Limited samples (N = ${sampleSize}). Using ${buckets} wide buckets with ` +
        'Bayesian smoothing. Calibration weight 0.3 balances bias/variance.',
    };
  }

  // Tier 3: Moderate data - balanced calibration
  if (sampleSize < 200) {
    const buckets = Math.min(10, Math.floor(sampleSize / 15));
    return {
      bucketCount: buckets,
      minSamplesPerBucket: 10,
      minTotalSamples: 50,
      useIsotonic: sampleSize >= 100, // Isotonic at 100+
      calibrationWeight: 0.6,
      prior: { alpha: 1, beta: 1 }, // Weak prior (uniform)
      rationale:
        `Moderate samples (N = ${sampleSize}). Using ${buckets} buckets with weak prior. ` +
        (sampleSize >= 100 ? 'Isotonic regression enabled.' : 'Histogram binning.'),
    };
  }

  // Tier 4: Sufficient data - full calibration
  const buckets = Math.min(15, Math.floor(sampleSize / 20));
  return {
    bucketCount: buckets,
    minSamplesPerBucket: 15,
    minTotalSamples: 100,
    useIsotonic: true,
    calibrationWeight: 1.0, // Full calibration
    prior: { alpha: 0.5, beta: 0.5 }, // Jeffreys prior (minimal)
    rationale:
      `Sufficient samples (N = ${sampleSize}). Full isotonic calibration with ` +
      'Jeffreys prior for minimal regularization.',
  };
}

/**
 * Apply Bayesian smoothing to a calibration bucket.
 *
 * Uses Beta-Binomial conjugacy: if we observe k successes in n trials,
 * and have a Beta(alpha, beta) prior, the posterior mean is:
 *   (k + alpha) / (n + alpha + beta)
 *
 * This "shrinks" observed proportions toward the prior, especially
 * for small sample sizes.
 *
 * @param successes - Number of positive outcomes in the bucket
 * @param total - Total samples in the bucket
 * @param prior - Beta distribution parameters (alpha, beta)
 * @returns Smoothed probability estimate
 */
export function bayesianSmooth(
  successes: number,
  total: number,
  prior: { alpha: number; beta: number }
): number {
  if (total < 0 || successes < 0 || successes > total) {
    throw new Error(`Invalid counts: successes=${successes}, total=${total}`);
  }

  const { alpha, beta } = prior;
  if (alpha <= 0 || beta <= 0) {
    throw new Error(`Invalid prior: alpha=${alpha}, beta=${beta} (must be positive)`);
  }

  return (successes + alpha) / (total + alpha + beta);
}

/**
 * Compute calibrated prediction using bootstrap config.
 *
 * Applies the appropriate calibration strategy based on the config,
 * including Bayesian smoothing when sample sizes are small.
 *
 * @param rawScore - Raw prediction to calibrate
 * @param bucketAccuracies - Map of bucket index to {successes, total}
 * @param config - CalibrationConfig from bootstrapCalibration()
 * @returns Calibrated prediction
 */
export function applyBootstrapCalibration(
  rawScore: number,
  bucketAccuracies: Map<number, { successes: number; total: number }>,
  config: CalibrationConfig
): number {
  // Find the bucket for this raw score
  const bucketIndex = Math.min(
    config.bucketCount - 1,
    Math.max(0, Math.floor(rawScore * config.bucketCount))
  );

  const bucket = bucketAccuracies.get(bucketIndex);

  if (!bucket || bucket.total < config.minSamplesPerBucket) {
    // Not enough data in this bucket - blend with raw score
    // Use prior as the calibrated estimate
    const priorMean = config.prior.alpha / (config.prior.alpha + config.prior.beta);
    return (1 - config.calibrationWeight) * rawScore + config.calibrationWeight * priorMean;
  }

  // Apply Bayesian smoothing to the bucket
  const smoothedAccuracy = bayesianSmooth(bucket.successes, bucket.total, config.prior);

  // Blend calibrated and raw scores based on weight
  return (1 - config.calibrationWeight) * rawScore + config.calibrationWeight * smoothedAccuracy;
}

// ============================================================================
// PAC-BASED SAMPLE THRESHOLDS (WU-THIMPL-208)
// ============================================================================

/**
 * Result of PAC-based sample size computation.
 */
export interface PACThresholdResult {
  /** Minimum number of samples required */
  minSamples: number;
  /** The accuracy parameter used (epsilon) */
  desiredAccuracy: number;
  /** The confidence level used (1 - delta) */
  confidenceLevel: number;
  /** Number of calibration bins (if applicable) */
  numBins?: number;
  /** Explanation of the computation */
  rationale: string;
}

/**
 * Compute the minimum number of samples required for calibration with
 * PAC (Probably Approximately Correct) guarantees.
 *
 * ## Mathematical Foundation
 *
 * PAC learning theory provides bounds on how many samples are needed to
 * ensure that empirical estimates are close to true values with high probability.
 *
 * For estimating a probability p from binary outcomes, we want:
 *   P(|p_hat - p| > ε) < δ
 *
 * Where:
 * - p_hat is our empirical estimate
 * - p is the true probability
 * - ε (epsilon) is the desired accuracy (e.g., 0.05 = within 5%)
 * - δ (delta) is the failure probability (e.g., 0.05 for 95% confidence)
 *
 * ## Derivation from Hoeffding's Inequality
 *
 * Hoeffding's inequality states that for n i.i.d. bounded random variables:
 *   P(|p_hat - p| > ε) ≤ 2 * exp(-2nε²)
 *
 * Setting this equal to δ and solving for n:
 *   2 * exp(-2nε²) = δ
 *   exp(-2nε²) = δ/2
 *   -2nε² = ln(δ/2)
 *   n = -ln(δ/2) / (2ε²)
 *   n = ln(2/δ) / (2ε²)
 *
 * ## Multiple Bins (Union Bound)
 *
 * When calibrating with k bins, we apply a union bound:
 *   P(any bin is off by > ε) ≤ k * P(single bin is off by > ε)
 *
 * To maintain overall failure probability δ, we need each bin to have
 * failure probability δ/k. This increases the required samples per bin:
 *   n_per_bin = ln(2k/δ) / (2ε²)
 *
 * Total samples = k * n_per_bin
 *
 * @param desiredAccuracy - How close the calibrated values should be to true values
 *                          (e.g., 0.05 means within 5 percentage points)
 * @param confidenceLevel - Probability that the guarantee holds
 *                          (e.g., 0.95 means 95% confident)
 * @param numBins - Optional number of calibration bins (default: 1 for overall estimate)
 * @returns PACThresholdResult with minimum samples and explanation
 *
 * @throws Error if desiredAccuracy <= 0 or >= 1
 * @throws Error if confidenceLevel <= 0 or >= 1
 * @throws Error if numBins < 1
 *
 * @example
 * ```typescript
 * // Basic case: estimate overall accuracy within 5% with 95% confidence
 * const result = computeMinSamplesForCalibration(0.05, 0.95);
 * // result.minSamples ≈ 738
 *
 * // With 10 calibration bins, need more samples for same guarantee
 * const binned = computeMinSamplesForCalibration(0.05, 0.95, 10);
 * // binned.minSamples ≈ 8844 (total across all bins)
 *
 * // Relaxed requirements: 10% accuracy, 90% confidence
 * const relaxed = computeMinSamplesForCalibration(0.10, 0.90);
 * // relaxed.minSamples ≈ 150
 * ```
 *
 * @see Hoeffding (1963) "Probability Inequalities for Sums of Bounded Random Variables"
 * @see Valiant (1984) "A Theory of the Learnable" (PAC learning framework)
 */
export function computeMinSamplesForCalibration(
  desiredAccuracy: number,
  confidenceLevel: number,
  numBins?: number
): PACThresholdResult {
  // Validate inputs
  if (desiredAccuracy <= 0 || desiredAccuracy >= 1) {
    throw new Error(
      `desiredAccuracy must be in (0, 1), got ${desiredAccuracy}. ` +
      'Use 0.05 for "within 5 percentage points".'
    );
  }
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new Error(
      `confidenceLevel must be in (0, 1), got ${confidenceLevel}. ` +
      'Use 0.95 for "95% confident".'
    );
  }
  if (numBins !== undefined && (numBins < 1 || !Number.isInteger(numBins))) {
    throw new Error(`numBins must be a positive integer, got ${numBins}.`);
  }

  const epsilon = desiredAccuracy;
  const delta = 1 - confidenceLevel;
  const k = numBins ?? 1;

  // Apply Hoeffding bound with union bound for multiple bins
  // n = ln(2k/δ) / (2ε²)
  const numerator = Math.log((2 * k) / delta);
  const denominator = 2 * epsilon * epsilon;
  const samplesPerBin = numerator / denominator;

  // For binned calibration, we need this many samples per bin
  // Total samples = k * samplesPerBin
  // But we want samples PER BIN to meet the guarantee
  // So total samples needed depends on whether we're asking for total or per-bin

  // For calibration, we typically want a certain number of samples per bin
  // to ensure each bin's estimate is accurate
  const totalSamples = Math.ceil(k * samplesPerBin);

  let rationale: string;
  if (k === 1) {
    rationale =
      `PAC bound via Hoeffding's inequality: To estimate a probability ` +
      `within ε=${epsilon.toFixed(3)} of the true value with probability ` +
      `≥${confidenceLevel.toFixed(3)}, we need n ≥ ln(2/δ)/(2ε²) = ` +
      `ln(${(2 / delta).toFixed(2)})/(2×${epsilon.toFixed(3)}²) ≈ ${Math.ceil(samplesPerBin)} samples.`;
  } else {
    rationale =
      `PAC bound with union bound for ${k} bins: To ensure EACH bin's estimate ` +
      `is within ε=${epsilon.toFixed(3)} of the true value with overall probability ` +
      `≥${confidenceLevel.toFixed(3)}, we apply a union bound. Each bin needs ` +
      `n ≥ ln(2k/δ)/(2ε²) = ln(${((2 * k) / delta).toFixed(2)})/(2×${epsilon.toFixed(3)}²) ` +
      `≈ ${Math.ceil(samplesPerBin)} samples. Total across ${k} bins: ${totalSamples} samples.`;
  }

  return {
    minSamples: totalSamples,
    desiredAccuracy,
    confidenceLevel,
    numBins: k > 1 ? k : undefined,
    rationale,
  };
}

/**
 * Compute the achievable accuracy given a sample size.
 *
 * This is the inverse of computeMinSamplesForCalibration - given n samples,
 * what accuracy ε can we guarantee with confidence (1-δ)?
 *
 * From Hoeffding: n = ln(2/δ) / (2ε²)
 * Solving for ε: ε = sqrt(ln(2/δ) / (2n))
 *
 * @param sampleSize - Number of samples available
 * @param confidenceLevel - Desired confidence level (e.g., 0.95)
 * @param numBins - Optional number of calibration bins
 * @returns The achievable accuracy (epsilon) for the given sample size
 *
 * @example
 * ```typescript
 * // With 1000 samples and 95% confidence, what accuracy can we achieve?
 * const accuracy = computeAchievableAccuracy(1000, 0.95);
 * // accuracy ≈ 0.043 (within 4.3 percentage points)
 * ```
 */
export function computeAchievableAccuracy(
  sampleSize: number,
  confidenceLevel: number,
  numBins?: number
): number {
  if (sampleSize <= 0) {
    throw new Error(`sampleSize must be positive, got ${sampleSize}.`);
  }
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new Error(`confidenceLevel must be in (0, 1), got ${confidenceLevel}.`);
  }
  if (numBins !== undefined && (numBins < 1 || !Number.isInteger(numBins))) {
    throw new Error(`numBins must be a positive integer, got ${numBins}.`);
  }

  const delta = 1 - confidenceLevel;
  const k = numBins ?? 1;

  // For binned case, samples per bin
  const samplesPerBin = sampleSize / k;

  // ε = sqrt(ln(2k/δ) / (2n))
  const epsilon = Math.sqrt(Math.log((2 * k) / delta) / (2 * samplesPerBin));

  return Math.min(1, epsilon); // Cap at 1 (can't be more than 100% off)
}

/**
 * Check if a calibration dataset meets PAC requirements.
 *
 * @param sampleSize - Number of samples in the dataset
 * @param desiredAccuracy - Required accuracy (e.g., 0.05)
 * @param confidenceLevel - Required confidence (e.g., 0.95)
 * @param numBins - Number of calibration bins (optional)
 * @returns Object with whether requirements are met and details
 */
export function checkCalibrationRequirements(
  sampleSize: number,
  desiredAccuracy: number,
  confidenceLevel: number,
  numBins?: number
): {
  meets: boolean;
  required: number;
  actual: number;
  deficit: number;
  achievableAccuracy: number;
} {
  const required = computeMinSamplesForCalibration(
    desiredAccuracy,
    confidenceLevel,
    numBins
  ).minSamples;

  const achievableAccuracy = computeAchievableAccuracy(
    sampleSize,
    confidenceLevel,
    numBins
  );

  return {
    meets: sampleSize >= required,
    required,
    actual: sampleSize,
    deficit: Math.max(0, required - sampleSize),
    achievableAccuracy,
  };
}

// ============================================================================
// SMOOTH ECE (WU-THIMPL-211)
// ============================================================================

/**
 * Options for kernel density-based smooth ECE computation.
 *
 * WU-THIMPL-211: Kernel density-based ECE to avoid bin boundary artifacts.
 */
export interface SmoothECEOptions {
  /**
   * Kernel bandwidth (h) for density estimation.
   *
   * Controls the smoothness of the calibration curve estimate.
   * - Smaller values = more local (follow data closely, may overfit)
   * - Larger values = more global (smoother curve, may miss patterns)
   *
   * If not provided, uses Silverman's rule of thumb:
   *   h = 1.06 * σ * n^(-1/5)
   *
   * Range: (0, 1]. Default: computed from data.
   */
  bandwidth?: number;

  /**
   * Type of kernel function to use.
   *
   * - 'gaussian': Standard Gaussian kernel, smooth, unbounded support
   * - 'epanechnikov': Optimal for MSE, bounded support, computationally efficient
   *
   * Default: 'gaussian'
   */
  kernelType?: 'gaussian' | 'epanechnikov';

  /**
   * Number of evaluation points for numerical integration.
   * More points = more accurate but slower.
   * Default: 100
   */
  numEvalPoints?: number;
}

/**
 * Default options for smooth ECE computation.
 */
export const DEFAULT_SMOOTH_ECE_OPTIONS: Required<Omit<SmoothECEOptions, 'bandwidth'>> & {
  bandwidth: number | undefined;
} = {
  bandwidth: undefined, // Will use Silverman's rule
  kernelType: 'gaussian',
  numEvalPoints: 100,
};

/**
 * Compute kernel-smoothed Expected Calibration Error (ECE).
 *
 * WU-THIMPL-211: Kernel density-based ECE to avoid bin boundary artifacts.
 *
 * ## Overview
 *
 * Traditional ECE uses histogram binning, which introduces artifacts at bin
 * boundaries and can be sensitive to the choice of bin count. Smooth ECE
 * uses kernel density estimation (KDE) to produce a continuous estimate of
 * the calibration function, avoiding these issues.
 *
 * ## Mathematical Foundation
 *
 * Let f(p) be the density of predictions at confidence p, and let
 * r(p) = E[Y | predicted = p] be the "reliability" (true probability given
 * predicted probability).
 *
 * The smooth calibration error at point p is |p - r(p)|, and the smooth ECE is:
 *
 *   SmoothECE = ∫ |p - r(p)| f(p) dp
 *
 * We estimate r(p) using Nadaraya-Watson kernel regression:
 *
 *   r̂(p) = Σᵢ K((p - pᵢ)/h) × yᵢ / Σᵢ K((p - pᵢ)/h)
 *
 * And f(p) using kernel density estimation:
 *
 *   f̂(p) = (1/nh) Σᵢ K((p - pᵢ)/h)
 *
 * ## Advantages over Binned ECE
 *
 * 1. **No bin boundary artifacts**: Smooth transition between regions
 * 2. **Data-driven smoothness**: Bandwidth adapts to data density
 * 3. **Better small-sample behavior**: KDE handles sparse regions gracefully
 * 4. **Theoretically grounded**: Converges to true ECE as n → ∞
 *
 * ## When to Use
 *
 * - When you have limited data (< 100 samples per bin in traditional ECE)
 * - When you want more robust calibration estimates
 * - When bin boundary effects are a concern
 * - For research or precise calibration analysis
 *
 * ## References
 *
 * - Vaicenavicius et al. (2019) "Evaluating Model Calibration in Classification"
 * - Nadaraya (1964) "On Estimating Regression"
 * - Watson (1964) "Smooth Regression Analysis"
 *
 * @param predictions - Array of predictions with predicted probabilities and actual outcomes
 * @param options - Configuration for kernel density estimation
 * @returns Smooth ECE value in range [0, 1]
 *
 * @example
 * ```typescript
 * const predictions: ScoringPrediction[] = [
 *   { predicted: 0.9, actual: 1 },
 *   { predicted: 0.8, actual: 1 },
 *   { predicted: 0.7, actual: 0 },
 *   { predicted: 0.3, actual: 0 },
 * ];
 *
 * // Using default options (Silverman bandwidth, Gaussian kernel)
 * const ece = computeSmoothECE(predictions);
 *
 * // Using custom bandwidth
 * const customEce = computeSmoothECE(predictions, {
 *   bandwidth: 0.1,
 *   kernelType: 'epanechnikov',
 * });
 * ```
 */
export function computeSmoothECE(
  predictions: ScoringPrediction[],
  options?: SmoothECEOptions
): number {
  if (predictions.length === 0) {
    throw new Error('Cannot compute smooth ECE from empty predictions array');
  }

  if (predictions.length === 1) {
    // With one sample, ECE is just the absolute difference
    return Math.abs(predictions[0].predicted - predictions[0].actual);
  }

  const opts = { ...DEFAULT_SMOOTH_ECE_OPTIONS, ...options };
  const n = predictions.length;

  // Extract predicted probabilities
  const probs = predictions.map((p) => clamp(p.predicted, 0, 1));
  const actuals = predictions.map((p) => p.actual);

  // Compute bandwidth using Silverman's rule of thumb if not provided
  const bandwidth = opts.bandwidth ?? computeSilvermanBandwidth(probs);

  // Generate evaluation points in [0, 1]
  const numEval = opts.numEvalPoints;
  const evalPoints: number[] = [];
  for (let i = 0; i <= numEval; i++) {
    evalPoints.push(i / numEval);
  }

  // Select kernel function
  const kernel =
    opts.kernelType === 'epanechnikov' ? epanechnikovKernel : gaussianKernel;

  // Compute smooth ECE using numerical integration
  // SmoothECE = ∫ |p - r(p)| f(p) dp ≈ Σ |pₖ - r̂(pₖ)| × f̂(pₖ) × Δp
  let smoothEce = 0;
  let totalDensity = 0;

  for (const p of evalPoints) {
    // Compute kernel weights for this evaluation point
    let kernelSum = 0;
    let weightedOutcomeSum = 0;

    for (let i = 0; i < n; i++) {
      const u = (p - probs[i]) / bandwidth;
      const k = kernel(u);
      kernelSum += k;
      weightedOutcomeSum += k * actuals[i];
    }

    // f(p): density estimate at p
    const density = kernelSum / (n * bandwidth);

    // r(p): reliability estimate at p (Nadaraya-Watson)
    const reliability = kernelSum > 0 ? weightedOutcomeSum / kernelSum : p;

    // Calibration error at this point
    const calibrationError = Math.abs(p - reliability);

    // Accumulate weighted calibration error
    smoothEce += calibrationError * density;
    totalDensity += density;
  }

  // Normalize by the integral of the density (should be ~1 but may not be exact)
  const deltaP = 1 / numEval;
  smoothEce *= deltaP;
  totalDensity *= deltaP;

  // Return normalized smooth ECE
  // If totalDensity is 0 (shouldn't happen with proper data), return 0
  return totalDensity > 0 ? smoothEce / totalDensity : 0;
}

/**
 * Gaussian kernel function.
 *
 * K(u) = (1/√(2π)) × exp(-u²/2)
 *
 * @param u - Standardized distance
 * @returns Kernel value
 */
function gaussianKernel(u: number): number {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

/**
 * Epanechnikov kernel function.
 *
 * K(u) = (3/4)(1 - u²) for |u| ≤ 1, 0 otherwise
 *
 * The Epanechnikov kernel is optimal (minimizes mean integrated squared error)
 * among all kernels with bounded support.
 *
 * @param u - Standardized distance
 * @returns Kernel value
 */
function epanechnikovKernel(u: number): number {
  if (Math.abs(u) > 1) return 0;
  return 0.75 * (1 - u * u);
}

/**
 * Compute bandwidth using Silverman's rule of thumb.
 *
 * h = 1.06 × σ × n^(-1/5)
 *
 * This is optimal for Gaussian kernels and approximately Gaussian data.
 * For calibration data in [0, 1], we may want to adjust, but this provides
 * a reasonable default.
 *
 * @param data - Array of values
 * @returns Computed bandwidth
 */
function computeSilvermanBandwidth(data: number[]): number {
  const n = data.length;
  if (n === 0) return 0.1; // Fallback

  // Compute standard deviation
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const variance =
    data.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1 || 1);
  const std = Math.sqrt(variance);

  // Silverman's rule of thumb
  // Adjust factor slightly for bounded [0,1] data
  const bandwidth = 1.06 * std * Math.pow(n, -0.2);

  // Ensure bandwidth is reasonable for [0,1] domain
  // Don't let it be too small (overfitting) or too large (oversmoothing)
  return clamp(bandwidth, 0.01, 0.5);
}
