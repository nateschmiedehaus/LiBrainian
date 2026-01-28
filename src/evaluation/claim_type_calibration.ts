/**
 * @fileoverview Claim Type Calibration (WU-CALX-005)
 *
 * Prevents "confidence monism" by maintaining separate calibration curves
 * per claim type. Different claim types (structural, behavioral, factual)
 * often have different calibration needs - a model might be well-calibrated
 * for structural claims but overconfident for behavioral claims.
 *
 * Features:
 * - Separate calibration curves per claim type
 * - Isotonic regression for smooth calibration
 * - Statistical comparison between type calibrations
 * - Monism detection to identify when unified calibration is appropriate
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A claim type with metadata
 */
export interface ClaimType {
  /** Unique identifier for the claim type */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this claim type covers */
  description: string;
  /** Example claims of this type */
  examples: string[];
}

/**
 * Calibration data for a specific claim type
 */
export interface TypeCalibrationData {
  /** The claim type ID */
  claimType: string;
  /** All recorded predictions for this type */
  predictions: { confidence: number; correct: boolean }[];
  /** Computed calibration curve */
  calibrationCurve: CalibrationCurve;
  /** When the data was last updated */
  lastUpdated: Date;
}

/**
 * A calibration curve mapping predicted to actual probabilities
 */
export interface CalibrationCurve {
  /** Points on the calibration curve */
  points: { predicted: number; actual: number }[];
  /** Expected Calibration Error */
  ece: number;
  /** Function to adjust a confidence value */
  adjustmentFunction: (confidence: number) => number;
}

/**
 * Result of adjusting a confidence value
 */
export interface CalibrationAdjustment {
  /** The claim type */
  claimType: string;
  /** Original confidence value */
  originalConfidence: number;
  /** Adjusted confidence value */
  adjustedConfidence: number;
  /** Reason for the adjustment */
  adjustmentReason: string;
  /** ECE of the calibration curve used */
  curveECE: number;
}

/**
 * Result of comparing calibration between types
 */
export interface TypeComparisonResult {
  /** Types that were compared */
  types: string[];
  /** Whether there's a significant difference */
  significantDifference: boolean;
  /** p-value from statistical test */
  pValue: number;
  /** Recommendation based on comparison */
  recommendation: string;
  /** The type with worst calibration */
  worstCalibratedType?: string;
}

/**
 * Configuration options for the calibrator
 */
export interface ClaimTypeCalibratorOptions {
  /** Minimum samples required before calibration is applied */
  minSamplesForCalibration?: number;
  /** Number of bins for ECE calculation */
  numBins?: number;
  /** Significance level for statistical tests */
  significanceLevel?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MIN_SAMPLES = 20;
const DEFAULT_NUM_BINS = 10;
const DEFAULT_SIGNIFICANCE_LEVEL = 0.05;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clamp a value to [0, 1]
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Calculate Expected Calibration Error
 */
function calculateECE(
  predictions: { confidence: number; correct: boolean }[],
  numBins: number
): number {
  if (predictions.length === 0) return 0;

  const bins: { sum: number; correct: number; count: number }[] = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({ sum: 0, correct: 0, count: 0 });
  }

  // Assign predictions to bins
  for (const pred of predictions) {
    const binIndex = Math.min(Math.floor(pred.confidence * numBins), numBins - 1);
    bins[binIndex].sum += pred.confidence;
    bins[binIndex].correct += pred.correct ? 1 : 0;
    bins[binIndex].count += 1;
  }

  // Calculate ECE
  let ece = 0;
  const totalSamples = predictions.length;

  for (const bin of bins) {
    if (bin.count > 0) {
      const avgConfidence = bin.sum / bin.count;
      const accuracy = bin.correct / bin.count;
      ece += (bin.count / totalSamples) * Math.abs(accuracy - avgConfidence);
    }
  }

  return ece;
}

/**
 * Pool Adjacent Violators Algorithm for isotonic regression
 * Ensures monotonically increasing values
 */
function isotonicRegression(
  xValues: number[],
  yValues: number[],
  weights?: number[]
): number[] {
  if (xValues.length === 0) return [];
  if (xValues.length === 1) return [...yValues];

  // Create sorted indices by x
  const indices = xValues.map((_, i) => i).sort((a, b) => xValues[a] - xValues[b]);

  // Sort y values and weights accordingly
  const sortedY = indices.map((i) => yValues[i]);
  const sortedW = weights ? indices.map((i) => weights[i]) : indices.map(() => 1);

  // Pool Adjacent Violators
  const n = sortedY.length;
  const result = [...sortedY];
  const w = [...sortedW];

  // Keep track of block boundaries
  const blocks: { start: number; end: number; value: number; weight: number }[] = [];

  for (let i = 0; i < n; i++) {
    blocks.push({
      start: i,
      end: i,
      value: result[i],
      weight: w[i],
    });

    // Merge blocks that violate monotonicity
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];

      if (prev.value <= last.value) {
        break;
      }

      // Merge blocks
      const totalWeight = prev.weight + last.weight;
      const mergedValue = (prev.value * prev.weight + last.value * last.weight) / totalWeight;

      blocks.pop();
      blocks.pop();
      blocks.push({
        start: prev.start,
        end: last.end,
        value: mergedValue,
        weight: totalWeight,
      });
    }
  }

  // Fill result from blocks
  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) {
      result[i] = block.value;
    }
  }

  // Unsort to original order
  const unsortedResult = new Array(n);
  for (let i = 0; i < n; i++) {
    unsortedResult[indices[i]] = result[i];
  }

  return unsortedResult;
}

/**
 * Perform a simple chi-squared test for calibration difference
 * Returns approximate p-value
 */
function chiSquaredTest(
  predictions1: { confidence: number; correct: boolean }[],
  predictions2: { confidence: number; correct: boolean }[],
  numBins: number
): number {
  if (predictions1.length < 5 || predictions2.length < 5) {
    return 1; // Not enough data for meaningful test
  }

  // Bin the predictions
  const bins1: { correct: number; total: number }[] = [];
  const bins2: { correct: number; total: number }[] = [];

  for (let i = 0; i < numBins; i++) {
    bins1.push({ correct: 0, total: 0 });
    bins2.push({ correct: 0, total: 0 });
  }

  for (const pred of predictions1) {
    const bin = Math.min(Math.floor(pred.confidence * numBins), numBins - 1);
    bins1[bin].total++;
    if (pred.correct) bins1[bin].correct++;
  }

  for (const pred of predictions2) {
    const bin = Math.min(Math.floor(pred.confidence * numBins), numBins - 1);
    bins2[bin].total++;
    if (pred.correct) bins2[bin].correct++;
  }

  // Calculate chi-squared statistic
  let chiSquared = 0;
  let degreesOfFreedom = 0;

  for (let i = 0; i < numBins; i++) {
    const total1 = bins1[i].total;
    const total2 = bins2[i].total;

    if (total1 + total2 < 5) continue; // Skip bins with too few samples

    const observed1 = bins1[i].correct;
    const observed2 = bins2[i].correct;

    const pooledRate = (observed1 + observed2) / (total1 + total2);
    const expected1 = pooledRate * total1;
    const expected2 = pooledRate * total2;

    if (expected1 > 0) {
      chiSquared += Math.pow(observed1 - expected1, 2) / expected1;
    }
    if (expected2 > 0) {
      chiSquared += Math.pow(observed2 - expected2, 2) / expected2;
    }

    degreesOfFreedom++;
  }

  if (degreesOfFreedom === 0) return 1;

  // Approximate p-value using chi-squared distribution
  // Using a simplified approximation for chi-squared CDF
  return chiSquaredPValue(chiSquared, degreesOfFreedom);
}

/**
 * Approximate chi-squared p-value
 */
function chiSquaredPValue(chiSquared: number, df: number): number {
  if (df <= 0) return 1;
  if (chiSquared <= 0) return 1;

  // Use Wilson-Hilferty approximation for chi-squared
  const x = Math.pow(chiSquared / df, 1 / 3);
  const mean = 1 - 2 / (9 * df);
  const variance = 2 / (9 * df);
  const z = (x - mean) / Math.sqrt(variance);

  // Convert to p-value using normal CDF approximation
  return 1 - normalCDF(z);
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(z: number): number {
  // Approximation using error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

// ============================================================================
// CLAIM TYPE CALIBRATOR CLASS
// ============================================================================

/**
 * Calibrator that maintains separate calibration curves per claim type
 * to prevent confidence monism.
 */
export class ClaimTypeCalibrator {
  private claimTypes: Map<string, ClaimType> = new Map();
  private calibrationData: Map<string, TypeCalibrationData> = new Map();
  private minSamples: number;
  private numBins: number;
  private significanceLevel: number;

  constructor(options: ClaimTypeCalibratorOptions = {}) {
    this.minSamples = options.minSamplesForCalibration ?? DEFAULT_MIN_SAMPLES;
    this.numBins = options.numBins ?? DEFAULT_NUM_BINS;
    this.significanceLevel = options.significanceLevel ?? DEFAULT_SIGNIFICANCE_LEVEL;
  }

  /**
   * Register a new claim type
   */
  registerClaimType(type: ClaimType): void {
    this.claimTypes.set(type.id, type);

    // Initialize calibration data if not exists
    if (!this.calibrationData.has(type.id)) {
      this.calibrationData.set(type.id, {
        claimType: type.id,
        predictions: [],
        calibrationCurve: this.createDefaultCurve(),
        lastUpdated: new Date(),
      });
    }
  }

  /**
   * Get all registered claim type IDs
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.claimTypes.keys());
  }

  /**
   * Record a prediction for a claim type
   */
  recordPrediction(claimType: string, confidence: number, correct: boolean): void {
    const data = this.calibrationData.get(claimType);
    if (!data) {
      throw new Error(`Claim type '${claimType}' not registered`);
    }

    data.predictions.push({
      confidence: clamp01(confidence),
      correct,
    });
    data.lastUpdated = new Date();

    // Recompute calibration curve
    data.calibrationCurve = this.computeCalibrationCurve(data.predictions);
  }

  /**
   * Get calibration data for a claim type
   */
  getCalibrationData(claimType: string): TypeCalibrationData {
    const data = this.calibrationData.get(claimType);
    if (!data) {
      throw new Error(`Claim type '${claimType}' not registered`);
    }
    return data;
  }

  /**
   * Get the calibration curve for a claim type
   */
  getCalibrationCurve(claimType: string): CalibrationCurve {
    const data = this.calibrationData.get(claimType);
    if (!data) {
      throw new Error(`Claim type '${claimType}' not registered`);
    }
    return data.calibrationCurve;
  }

  /**
   * Adjust a confidence value based on the calibration curve for a claim type
   */
  adjustConfidence(claimType: string, confidence: number): CalibrationAdjustment {
    const data = this.calibrationData.get(claimType);
    if (!data) {
      throw new Error(`Claim type '${claimType}' not registered`);
    }

    const originalConfidence = clamp01(confidence);

    // Check if we have enough data
    if (data.predictions.length < this.minSamples) {
      return {
        claimType,
        originalConfidence,
        adjustedConfidence: originalConfidence,
        adjustmentReason: `Insufficient data (${data.predictions.length}/${this.minSamples} samples). Using original confidence.`,
        curveECE: data.calibrationCurve.ece,
      };
    }

    const adjustedConfidence = data.calibrationCurve.adjustmentFunction(originalConfidence);
    const diff = adjustedConfidence - originalConfidence;

    let reason: string;
    if (Math.abs(diff) < 0.01) {
      reason = 'Confidence is well-calibrated for this claim type.';
    } else if (diff < 0) {
      reason = `Calibration indicates overconfidence for ${claimType} claims. Reducing confidence by ${Math.abs(diff * 100).toFixed(1)}%.`;
    } else {
      reason = `Calibration indicates underconfidence for ${claimType} claims. Increasing confidence by ${(diff * 100).toFixed(1)}%.`;
    }

    return {
      claimType,
      originalConfidence,
      adjustedConfidence,
      adjustmentReason: reason,
      curveECE: data.calibrationCurve.ece,
    };
  }

  /**
   * Compare calibration between multiple claim types
   */
  compareCalibration(types: string[]): TypeComparisonResult {
    if (types.length === 0) {
      return {
        types: [],
        significantDifference: false,
        pValue: 1,
        recommendation: 'No types provided for comparison.',
      };
    }

    // Verify all types are registered
    for (const type of types) {
      if (!this.calibrationData.has(type)) {
        throw new Error(`Claim type '${type}' not registered`);
      }
    }

    if (types.length === 1) {
      return {
        types,
        significantDifference: false,
        pValue: 1,
        recommendation: 'Single type provided, no comparison possible.',
      };
    }

    // Get calibration data for all types
    const dataMap = new Map<string, TypeCalibrationData>();
    let hasInsufficientData = false;

    for (const type of types) {
      const data = this.calibrationData.get(type)!;
      dataMap.set(type, data);
      if (data.predictions.length < this.minSamples) {
        hasInsufficientData = true;
      }
    }

    if (hasInsufficientData) {
      return {
        types,
        significantDifference: false,
        pValue: 1,
        recommendation: `Insufficient data for comparison. Need at least ${this.minSamples} samples per type.`,
      };
    }

    // Find the worst calibrated type
    let worstType: string | undefined;
    let worstECE = -1;

    for (const type of Array.from(dataMap.keys())) {
      const data = dataMap.get(type)!;
      if (data.calibrationCurve.ece > worstECE) {
        worstECE = data.calibrationCurve.ece;
        worstType = type;
      }
    }

    // Perform pairwise comparisons and get minimum p-value
    let minPValue = 1;

    const typeList = Array.from(dataMap.keys());
    for (let i = 0; i < typeList.length; i++) {
      for (let j = i + 1; j < typeList.length; j++) {
        const data1 = dataMap.get(typeList[i])!;
        const data2 = dataMap.get(typeList[j])!;

        const pValue = chiSquaredTest(data1.predictions, data2.predictions, this.numBins);
        if (pValue < minPValue) {
          minPValue = pValue;
        }
      }
    }

    const significantDifference = minPValue < this.significanceLevel;

    let recommendation: string;
    if (significantDifference) {
      recommendation = `Significant calibration differences detected (p=${minPValue.toFixed(4)}). Use type-specific calibration, especially for ${worstType} which has ECE=${worstECE.toFixed(3)}.`;
    } else {
      recommendation = `No significant calibration differences (p=${minPValue.toFixed(4)}). A unified calibration approach may be appropriate.`;
    }

    return {
      types,
      significantDifference,
      pValue: minPValue,
      recommendation,
      worstCalibratedType: worstType,
    };
  }

  /**
   * Detect if calibration is monistic (same for all types) or type-specific
   */
  detectMonism(): { isMonistic: boolean; recommendation: string } {
    const types = this.getRegisteredTypes();

    if (types.length < 2) {
      return {
        isMonistic: true,
        recommendation: 'Insufficient claim types registered (need at least 2). Cannot determine monism.',
      };
    }

    // Check if we have enough data for any type
    let hasEnoughData = false;
    for (const type of types) {
      const data = this.calibrationData.get(type);
      if (data && data.predictions.length >= this.minSamples) {
        hasEnoughData = true;
        break;
      }
    }

    if (!hasEnoughData) {
      return {
        isMonistic: true,
        recommendation: `Insufficient data to determine monism. Need at least ${this.minSamples} samples for at least one type.`,
      };
    }

    // Compare all registered types
    const comparison = this.compareCalibration(types);

    if (comparison.significantDifference) {
      return {
        isMonistic: false,
        recommendation: `Calibration varies significantly by claim type (p=${comparison.pValue.toFixed(4)}). Use type-specific calibration curves.`,
      };
    } else {
      return {
        isMonistic: true,
        recommendation: `Calibration is similar across claim types (p=${comparison.pValue.toFixed(4)}). A unified calibration approach is appropriate.`,
      };
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Create a default calibration curve (identity function)
   */
  private createDefaultCurve(): CalibrationCurve {
    const points: { predicted: number; actual: number }[] = [];
    for (let i = 0; i <= 10; i++) {
      const p = i / 10;
      points.push({ predicted: p, actual: p });
    }

    return {
      points,
      ece: 0,
      adjustmentFunction: (conf: number) => conf,
    };
  }

  /**
   * Compute calibration curve from predictions using isotonic regression
   */
  private computeCalibrationCurve(
    predictions: { confidence: number; correct: boolean }[]
  ): CalibrationCurve {
    if (predictions.length < this.minSamples) {
      return this.createDefaultCurve();
    }

    // Calculate ECE
    const ece = calculateECE(predictions, this.numBins);

    // Group predictions by confidence bins for calibration points
    const binSize = 1 / this.numBins;
    const binData: { confidences: number[]; corrects: number[] }[] = [];

    for (let i = 0; i < this.numBins; i++) {
      binData.push({ confidences: [], corrects: [] });
    }

    for (const pred of predictions) {
      const binIndex = Math.min(Math.floor(pred.confidence * this.numBins), this.numBins - 1);
      binData[binIndex].confidences.push(pred.confidence);
      binData[binIndex].corrects.push(pred.correct ? 1 : 0);
    }

    // Calculate bin centers and accuracies
    const xValues: number[] = [];
    const yValues: number[] = [];
    const weights: number[] = [];

    for (let i = 0; i < this.numBins; i++) {
      const bin = binData[i];
      if (bin.confidences.length > 0) {
        const avgConf = bin.confidences.reduce((a, b) => a + b, 0) / bin.confidences.length;
        const accuracy = bin.corrects.reduce((a, b) => a + b, 0) / bin.corrects.length;

        xValues.push(avgConf);
        yValues.push(accuracy);
        weights.push(bin.confidences.length);
      }
    }

    // Apply isotonic regression
    const calibratedY = isotonicRegression(xValues, yValues, weights);

    // Build calibration points
    const points: { predicted: number; actual: number }[] = [];
    for (let i = 0; i < xValues.length; i++) {
      points.push({
        predicted: xValues[i],
        actual: calibratedY[i],
      });
    }

    // Sort points by predicted value
    points.sort((a, b) => a.predicted - b.predicted);

    // Create adjustment function using linear interpolation
    const adjustmentFunction = (confidence: number): number => {
      if (points.length === 0) return confidence;
      if (points.length === 1) return points[0].actual;

      const conf = clamp01(confidence);

      // Find surrounding points
      let lower = points[0];
      let upper = points[points.length - 1];

      for (let i = 0; i < points.length - 1; i++) {
        if (points[i].predicted <= conf && points[i + 1].predicted >= conf) {
          lower = points[i];
          upper = points[i + 1];
          break;
        }
      }

      // Handle edge cases
      if (conf <= lower.predicted) return lower.actual;
      if (conf >= upper.predicted) return upper.actual;

      // Linear interpolation
      const t = (conf - lower.predicted) / (upper.predicted - lower.predicted);
      return clamp01(lower.actual + t * (upper.actual - lower.actual));
    };

    return {
      points,
      ece,
      adjustmentFunction,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ClaimTypeCalibrator instance
 */
export function createClaimTypeCalibrator(
  options?: ClaimTypeCalibratorOptions
): ClaimTypeCalibrator {
  return new ClaimTypeCalibrator(options);
}
