/**
 * @fileoverview Continuous Fitness Computation with Harmonic Mean
 *
 * Replaces geometric mean (where 0 kills everything) with weighted harmonic mean
 * plus dimension floors. This ensures fitness is always in [floor, 1.0], providing
 * gradient signal even for broken systems.
 *
 * Mathematical Properties:
 * - Monotonic: improving any dimension never decreases overall score
 * - Continuous: small changes yield proportional fitness changes
 * - Bounded: always in [minimum_floor, 1.0]
 * - Interpretable: weights represent dimension importance
 *
 * @packageDocumentation
 */

import type { FitnessVector } from './types.js';
import { clamp } from '../utils/math.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input dimensions for continuous fitness computation.
 * Each value should be in [0, 1] range.
 */
export interface FitnessDimensions {
  /** Correctness: tier0/tier1 pass rate combined */
  correctness: number;
  /** Retrieval quality: nDCG * recall combined */
  retrieval: number;
  /** Epistemic quality: evidence coverage */
  epistemic: number;
  /** Operational quality: normalized latency/cache hit */
  operational: number;
  /** Calibration quality: 1 - calibration_error */
  calibration: number;
  /** Coverage quality: code graph coverage */
  coverage: number;
}

/**
 * Result of continuous fitness computation.
 */
export interface ContinuousFitnessResult {
  /** Overall fitness score in [min_floor, 1.0] */
  overall: number;
  /** Floored dimension values used in computation */
  dimensions: FitnessDimensions;
  /** Per-dimension contributions to overall score */
  contributions: FitnessDimensions;
  /** Metadata about the computation */
  metadata: {
    method: 'weighted_harmonic_mean';
    floorsApplied: string[];
    rawInputs: FitnessDimensions;
    maskedDimensions?: Partial<Record<keyof FitnessDimensions, boolean>>;
    weights?: FitnessDimensions;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Dimension floors - minimum values to prevent zero collapse.
 * These represent "even a completely broken system has some value".
 */
export const DIMENSION_FLOORS: FitnessDimensions = {
  correctness: 0.10, // Even failing tests have some value (framework works)
  retrieval: 0.05,   // Lowest floor - retrieval can genuinely fail
  epistemic: 0.10,   // Evidence coverage floor
  operational: 0.15, // System is at least running
  calibration: 0.10, // Uncalibrated is still informative
  coverage: 0.05,    // Lowest floor for coverage
};

/**
 * Dimension weights - importance of each dimension.
 * Sum should equal 1.0 for interpretability.
 */
export const DIMENSION_WEIGHTS: FitnessDimensions = {
  correctness: 0.30, // Most important - tests must pass
  retrieval: 0.20,   // Second most - retrieval is core function
  epistemic: 0.15,   // Important - evidence quality
  operational: 0.15, // Important - must be usable
  calibration: 0.10, // Useful but not critical
  coverage: 0.10,    // Useful but not critical
};

// ============================================================================
// MAIN COMPUTATION
// ============================================================================

/**
 * Compute continuous fitness using weighted harmonic mean with floors.
 *
 * The harmonic mean formula with weights:
 *   H = sum(weights) / sum(weight_i / value_i)
 *
 * This penalizes low values more than geometric mean but less than minimum.
 * Combined with floors, it ensures:
 * 1. Fitness is never zero
 * 2. Small improvements always yield positive gradient
 * 3. Poor dimensions still allow partial credit
 *
 * @param input - Raw fitness dimensions (values should be in [0, 1])
 * @returns Continuous fitness result with overall score and metadata
 */
export function computeContinuousFitness(input: FitnessDimensions): ContinuousFitnessResult {
  return computeContinuousFitnessWithWeights(input, DIMENSION_WEIGHTS);
}

/**
 * Compute continuous fitness with a dimension mask.
 *
 * When a dimension is unmeasured, we mask it by setting its weight to 0 and
 * renormalizing the remaining weights. This prevents missing measurement from
 * being scored as poor performance.
 */
export function computeContinuousFitnessMasked(
  input: FitnessDimensions,
  maskedDimensions: Partial<Record<keyof FitnessDimensions, boolean>>
): ContinuousFitnessResult {
  const maskedWeights: FitnessDimensions = { ...DIMENSION_WEIGHTS };
  for (const key of Object.keys(maskedWeights) as Array<keyof FitnessDimensions>) {
    if (maskedDimensions[key]) maskedWeights[key] = 0;
  }

  const sum = Object.values(maskedWeights).reduce((acc, value) => acc + value, 0);
  const weights = sum > 0
    ? {
        correctness: maskedWeights.correctness / sum,
        retrieval: maskedWeights.retrieval / sum,
        epistemic: maskedWeights.epistemic / sum,
        operational: maskedWeights.operational / sum,
        calibration: maskedWeights.calibration / sum,
        coverage: maskedWeights.coverage / sum,
      }
    : { ...DIMENSION_WEIGHTS };

  return computeContinuousFitnessWithWeights(input, weights, maskedDimensions);
}

function computeContinuousFitnessWithWeights(
  input: FitnessDimensions,
  weights: FitnessDimensions,
  maskedDimensions: Partial<Record<keyof FitnessDimensions, boolean>> = {}
): ContinuousFitnessResult {
  const floorsApplied: string[] = [];

  // Apply floors to prevent division by zero and provide gradient
  const floored: FitnessDimensions = {
    correctness: applyFloor(input.correctness, DIMENSION_FLOORS.correctness, 'correctness', floorsApplied),
    retrieval: applyFloor(input.retrieval, DIMENSION_FLOORS.retrieval, 'retrieval', floorsApplied),
    epistemic: applyFloor(input.epistemic, DIMENSION_FLOORS.epistemic, 'epistemic', floorsApplied),
    operational: applyFloor(input.operational, DIMENSION_FLOORS.operational, 'operational', floorsApplied),
    calibration: applyFloor(input.calibration, DIMENSION_FLOORS.calibration, 'calibration', floorsApplied),
    coverage: applyFloor(input.coverage, DIMENSION_FLOORS.coverage, 'coverage', floorsApplied),
  };

  // Compute weighted harmonic mean
  // H = sum(weights) / sum(weight_i / value_i)
  let weightedReciprocalsSum = 0;
  let totalWeight = 0;

  const dims = Object.keys(floored) as (keyof FitnessDimensions)[];
  for (const dim of dims) {
    const weight = weights[dim];
    const value = floored[dim];
    weightedReciprocalsSum += weight / value;
    totalWeight += weight;
  }

  // Harmonic mean: total weight divided by sum of weighted reciprocals
  const harmonicMean = totalWeight / weightedReciprocalsSum;

  // Compute per-dimension contributions (for analysis)
  const contributions: FitnessDimensions = {
    correctness: computeContribution(floored.correctness, weights.correctness, harmonicMean),
    retrieval: computeContribution(floored.retrieval, weights.retrieval, harmonicMean),
    epistemic: computeContribution(floored.epistemic, weights.epistemic, harmonicMean),
    operational: computeContribution(floored.operational, weights.operational, harmonicMean),
    calibration: computeContribution(floored.calibration, weights.calibration, harmonicMean),
    coverage: computeContribution(floored.coverage, weights.coverage, harmonicMean),
  };

  return {
    overall: harmonicMean,
    dimensions: floored,
    contributions,
    metadata: {
      method: 'weighted_harmonic_mean',
      floorsApplied,
      rawInputs: { ...input },
      maskedDimensions: Object.keys(maskedDimensions).length > 0 ? { ...maskedDimensions } : undefined,
      weights,
    },
  };
}

/**
 * Extract fitness dimensions from a FitnessVector.
 * Normalizes the complex fitness vector into simple [0,1] dimensions.
 */
export function extractDimensionsFromVector(fitness: FitnessVector): FitnessDimensions {
  // Correctness: geometric mean of tier pass rates
  const correctness = Math.sqrt(
    fitness.correctness.tier0PassRate * fitness.correctness.tier1PassRate
  );

  // Retrieval: nDCG * recall (both important)
  const retrieval = Math.sqrt(
    fitness.retrievalQuality.nDCG * fitness.retrievalQuality.recallAt5
  );

  // Epistemic: evidence coverage directly
  const epistemic = fitness.epistemicQuality.evidenceCoverage;

  // Operational: normalized from latency and cache hit
  const latencyScore = normalizeLatency(fitness.operationalQuality.queryLatencyP50Ms);
  const cacheScore = fitness.operationalQuality.cacheHitRate;
  const operational = (latencyScore + cacheScore) / 2;

  // Calibration: 1 - error (lower error is better)
  const calibration = 1 - fitness.epistemicQuality.calibrationError;

  // Coverage: from epistemic coverage ratio
  const coverage = fitness.epistemicQuality.evidenceCoverage;

  return {
    correctness: clamp(correctness, 0, 1),
    retrieval: clamp(retrieval, 0, 1),
    epistemic: clamp(epistemic, 0, 1),
    operational: clamp(operational, 0, 1),
    calibration: clamp(calibration, 0, 1),
    coverage: clamp(coverage, 0, 1),
  };
}

/**
 * Compute overall fitness score for a FitnessVector using continuous method.
 * This is the main entry point for replacing the old geometric mean.
 */
export function computeContinuousOverallScore(fitness: FitnessVector): number {
  const masked: Partial<Record<keyof FitnessDimensions, boolean>> = {};

  // Sentinel convention: negative values represent "unmeasured", not "bad".
  if (fitness.retrievalQuality.nDCG < 0 || fitness.retrievalQuality.recallAt5 < 0) {
    masked.retrieval = true;
  }
  if (fitness.epistemicQuality.evidenceCoverage < 0) {
    masked.epistemic = true;
    masked.coverage = true;
  }
  if (fitness.epistemicQuality.calibrationError < 0) {
    masked.calibration = true;
  }
  if (fitness.operationalQuality.queryLatencyP50Ms < 0 || fitness.operationalQuality.cacheHitRate < 0) {
    masked.operational = true;
  }

  const sanitized: FitnessVector = {
    ...fitness,
    retrievalQuality: masked.retrieval
      ? { ...fitness.retrievalQuality, nDCG: 0, recallAt5: 0 }
      : fitness.retrievalQuality,
    epistemicQuality: {
      ...fitness.epistemicQuality,
      evidenceCoverage: masked.epistemic ? 0 : fitness.epistemicQuality.evidenceCoverage,
      calibrationError: masked.calibration ? 1 : fitness.epistemicQuality.calibrationError,
    },
    operationalQuality: masked.operational
      ? { ...fitness.operationalQuality, queryLatencyP50Ms: 10_000, cacheHitRate: 0 }
      : fitness.operationalQuality,
  };

  const dimensions = extractDimensionsFromVector(sanitized);
  const hasMask = Object.keys(masked).length > 0;
  const result = hasMask ? computeContinuousFitnessMasked(dimensions, masked) : computeContinuousFitness(dimensions);
  return result.overall;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Apply floor to a dimension value, tracking when floors are applied.
 */
function applyFloor(
  value: number,
  floor: number,
  dimensionName: string,
  floorsApplied: string[]
): number {
  // Handle NaN, undefined, negative values
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;

  if (safeValue < floor) {
    floorsApplied.push(dimensionName);
    return floor;
  }
  return Math.min(safeValue, 1.0); // Cap at 1.0
}

/**
 * Compute the contribution of a dimension to the harmonic mean.
 * This is an approximation for interpretability.
 */
function computeContribution(value: number, weight: number, harmonicMean: number): number {
  // The "contribution" is how much this dimension pulled down (or up) the mean
  // Simplified: weight * (value / harmonicMean - 1) normalized
  const pull = value / harmonicMean;
  return weight * Math.max(0, Math.min(1, pull));
}

/**
 * Normalize latency to [0, 1] where lower is better.
 * Target: 100ms = 1.0, 1000ms = 0.1
 */
function normalizeLatency(latencyMs: number): number {
  if (latencyMs <= 0) return 1.0;
  // Logarithmic scaling: 100ms -> 1.0, 1000ms -> 0.5, 10000ms -> 0.25
  const normalized = 1 / (1 + Math.log10(latencyMs / 100));
  return clamp(normalized, 0, 1);
}


// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate that dimension weights sum to ~1.0
 */
export function validateWeights(): boolean {
  const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) < 0.001;
}

/**
 * Validate mathematical properties of the fitness function.
 * Used in tests to ensure correctness.
 */
export function validateMonotonicity(
  base: FitnessDimensions,
  improved: FitnessDimensions
): boolean {
  const baseFitness = computeContinuousFitness(base);
  const improvedFitness = computeContinuousFitness(improved);

  // Check that all dimensions in improved >= base
  const dims = Object.keys(base) as (keyof FitnessDimensions)[];
  const allBetterOrEqual = dims.every(d => improved[d] >= base[d] - 0.0001);

  // If all dimensions better or equal, fitness should be better or equal
  if (allBetterOrEqual) {
    return improvedFitness.overall >= baseFitness.overall - 0.0001;
  }

  return true; // Can't validate if some dimensions got worse
}
