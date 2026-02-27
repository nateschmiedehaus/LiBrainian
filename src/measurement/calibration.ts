/**
 * @fileoverview Confidence Calibration Measurement
 *
 * PHILOSOPHICAL ALIGNMENT (UNDERSTANDING_LAYER.md §Confidence Calibration Testing):
 * Confidence scores must be calibrated against empirical accuracy.
 * A claim with 80% confidence should be correct ~80% of the time.
 *
 * CALIBRATION TARGETS:
 * - 0.9-1.0 range: ≤ 5% calibration error
 * - 0.7-0.9 range: ≤ 10% calibration error
 * - 0.5-0.7 range: ≤ 15% calibration error
 * - 0.0-0.5 range: N/A (low confidence acceptable)
 *
 * Schema: CalibrationReport.v1 per docs/archive/SCHEMAS.md
 */

// ============================================================================
// TYPES (per SCHEMAS.md)
// ============================================================================

export interface Scope {
  kind: 'file' | 'directory' | 'module' | 'function' | 'workspace' | 'custom';
  paths: string[];
  excludes?: string[];
  depth?: number;
}

export interface CalibrationBucket {
  /** Confidence range [min, max) */
  confidenceRange: [number, number];
  /** Mean stated confidence in this bucket */
  statedMean: number;
  /** Actual accuracy (fraction correct) */
  empiricalAccuracy: number;
  /** Number of claims in this bucket */
  sampleSize: number;
  /** |statedMean - empiricalAccuracy| */
  calibrationError: number;
}

export interface CalibrationReport {
  kind: 'CalibrationReport.v1';
  schemaVersion: 1;

  /** ISO 8601 timestamp */
  generatedAt: string;
  /** Scope of the calibration test */
  scope: Scope;
  /** Total number of claims evaluated */
  sampleSize: number;

  /** Weighted mean calibration error across buckets. Target: ≤ 0.10 */
  overallCalibrationError: number;

  /** Per-bucket analysis */
  buckets: CalibrationBucket[];

  /** Bucket ranges where stated > empirical (overconfident) */
  overconfidentBuckets: string[];
  /** Bucket ranges where stated < empirical (underconfident) */
  underconfidentBuckets: string[];

  /** Trend compared to previous report */
  trend?: {
    previousError: number;
    direction: 'improving' | 'degrading' | 'stable';
  };
}

// ============================================================================
// CALIBRATION INPUT
// ============================================================================

export interface CalibrationClaim {
  /** Unique claim ID */
  claimId: string;
  /** Stated confidence [0, 1] */
  confidence: number;
  /** Ground truth: was this claim correct? */
  correct: boolean;
  /** Optional entity this claim is about */
  entityId?: string;
  /** Optional claim category for segmented analysis */
  category?: string;
}

export interface CalibrationInput {
  /** Claims with ground truth labels */
  claims: CalibrationClaim[];
  /** Scope of evaluation */
  scope: Scope;
  /** Previous report for trend analysis */
  previousReport?: CalibrationReport;
}

// ============================================================================
// DEFAULT BUCKET CONFIGURATION
// ============================================================================

/**
 * Standard confidence buckets per UNDERSTANDING_LAYER.md.
 * Note: 0.0-0.5 is tracked but not penalized (low confidence is acceptable).
 */
export const DEFAULT_BUCKETS: Array<[number, number]> = [
  [0.0, 0.5],   // Low confidence (no penalty)
  [0.5, 0.7],   // Medium confidence (≤15% error target)
  [0.7, 0.9],   // High confidence (≤10% error target)
  [0.9, 1.0],   // Very high confidence (≤5% error target)
];

export const CALIBRATION_TARGETS: Record<string, number> = {
  '[0.9, 1.0)': 0.05,
  '[0.7, 0.9)': 0.10,
  '[0.5, 0.7)': 0.15,
  '[0.0, 0.5)': Infinity, // No target for low confidence
};

// ============================================================================
// CALIBRATION COMPUTATION
// ============================================================================

/**
 * Compute calibration report from claims with ground truth.
 *
 * @example
 * ```typescript
 * const claims = [
 *   { claimId: '1', confidence: 0.9, correct: true },
 *   { claimId: '2', confidence: 0.9, correct: false },
 *   { claimId: '3', confidence: 0.7, correct: true },
 * ];
 *
 * const report = computeCalibrationReport({
 *   claims,
 *   scope: { kind: 'workspace', paths: ['/project'] },
 * });
 *
 * console.log(report.overallCalibrationError); // Should be ≤ 0.10
 * ```
 */
export function computeCalibrationReport(input: CalibrationInput): CalibrationReport {
  const { claims, scope, previousReport } = input;

  if (claims.length === 0) {
    return createEmptyReport(scope);
  }

  // Group claims into buckets
  const bucketData = new Map<string, { stated: number[]; correct: boolean[] }>();

  for (const bucket of DEFAULT_BUCKETS) {
    const key = formatBucketRange(bucket);
    bucketData.set(key, { stated: [], correct: [] });
  }

  for (const claim of claims) {
    const bucket = findBucket(claim.confidence);
    const key = formatBucketRange(bucket);
    const data = bucketData.get(key)!;
    data.stated.push(claim.confidence);
    data.correct.push(claim.correct);
  }

  // Compute per-bucket metrics
  const buckets: CalibrationBucket[] = [];
  const overconfidentBuckets: string[] = [];
  const underconfidentBuckets: string[] = [];

  for (const [range, bucket] of DEFAULT_BUCKETS.map((b) => [formatBucketRange(b), b] as const)) {
    const data = bucketData.get(range)!;

    if (data.stated.length === 0) {
      buckets.push({
        confidenceRange: bucket,
        statedMean: 0,
        empiricalAccuracy: 0,
        sampleSize: 0,
        calibrationError: 0,
      });
      continue;
    }

    const statedMean = mean(data.stated);
    const empiricalAccuracy = mean(data.correct.map((c) => (c ? 1 : 0)));
    const calibrationError = Math.abs(statedMean - empiricalAccuracy);

    buckets.push({
      confidenceRange: bucket,
      statedMean,
      empiricalAccuracy,
      sampleSize: data.stated.length,
      calibrationError,
    });

    // Classify as over/underconfident
    if (statedMean > empiricalAccuracy + 0.02) {
      overconfidentBuckets.push(range);
    } else if (statedMean < empiricalAccuracy - 0.02) {
      underconfidentBuckets.push(range);
    }
  }

  // Compute overall calibration error (weighted by sample size, excluding low-confidence bucket)
  const highConfidenceBuckets = buckets.filter(
    (b) => b.confidenceRange[0] >= 0.5 && b.sampleSize > 0
  );

  const totalWeight = highConfidenceBuckets.reduce((sum, b) => sum + b.sampleSize, 0);
  const weightedError =
    totalWeight > 0
      ? highConfidenceBuckets.reduce((sum, b) => sum + b.calibrationError * b.sampleSize, 0) /
        totalWeight
      : 0;

  // Compute trend
  let trend: CalibrationReport['trend'];
  if (previousReport) {
    const delta = weightedError - previousReport.overallCalibrationError;
    trend = {
      previousError: previousReport.overallCalibrationError,
      direction: delta < -0.01 ? 'improving' : delta > 0.01 ? 'degrading' : 'stable',
    };
  }

  return {
    kind: 'CalibrationReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope,
    sampleSize: claims.length,
    overallCalibrationError: weightedError,
    buckets,
    overconfidentBuckets,
    underconfidentBuckets,
    trend,
  };
}

// ============================================================================
// CALIBRATION VALIDATION
// ============================================================================

export interface CalibrationValidation {
  /** Does overall error meet target (≤10%)? */
  meetsTarget: boolean;
  /** Per-bucket target compliance */
  bucketCompliance: Array<{
    range: string;
    target: number;
    actual: number;
    compliant: boolean;
  }>;
  /** Suggested actions */
  recommendations: string[];
}

/**
 * Validate a calibration report against targets.
 */
export function validateCalibration(report: CalibrationReport): CalibrationValidation {
  const bucketCompliance: CalibrationValidation['bucketCompliance'] = [];
  const recommendations: string[] = [];

  for (const bucket of report.buckets) {
    const range = formatBucketRange(bucket.confidenceRange);
    const target = CALIBRATION_TARGETS[range] ?? Infinity;

    const compliant = bucket.calibrationError <= target || bucket.sampleSize === 0;
    bucketCompliance.push({
      range,
      target,
      actual: bucket.calibrationError,
      compliant,
    });

    if (!compliant && bucket.sampleSize >= 10) {
      if (report.overconfidentBuckets.includes(range)) {
        recommendations.push(
          `Reduce confidence in ${range} range (currently ${(bucket.statedMean * 100).toFixed(1)}% stated vs ${(bucket.empiricalAccuracy * 100).toFixed(1)}% actual)`
        );
      } else if (report.underconfidentBuckets.includes(range)) {
        recommendations.push(
          `Increase confidence in ${range} range (currently ${(bucket.statedMean * 100).toFixed(1)}% stated vs ${(bucket.empiricalAccuracy * 100).toFixed(1)}% actual)`
        );
      }
    }
  }

  const meetsTarget = report.overallCalibrationError <= 0.10;

  if (!meetsTarget) {
    recommendations.push(
      `Overall calibration error (${(report.overallCalibrationError * 100).toFixed(1)}%) exceeds 10% target`
    );
  }

  if (report.trend?.direction === 'degrading') {
    recommendations.push(
      `Calibration is degrading (was ${(report.trend.previousError * 100).toFixed(1)}%, now ${(report.overallCalibrationError * 100).toFixed(1)}%)`
    );
  }

  return {
    meetsTarget,
    bucketCompliance,
    recommendations,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function findBucket(confidence: number): [number, number] {
  for (const bucket of DEFAULT_BUCKETS) {
    if (confidence >= bucket[0] && confidence < bucket[1]) {
      return bucket;
    }
  }
  // Edge case: confidence === 1.0 goes in highest bucket
  return DEFAULT_BUCKETS[DEFAULT_BUCKETS.length - 1];
}

function formatBucketRange(bucket: [number, number]): string {
  return `[${bucket[0]}, ${bucket[1]})`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function createEmptyReport(scope: Scope): CalibrationReport {
  return {
    kind: 'CalibrationReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope,
    sampleSize: 0,
    overallCalibrationError: 0,
    buckets: DEFAULT_BUCKETS.map((b) => ({
      confidenceRange: b,
      statedMean: 0,
      empiricalAccuracy: 0,
      sampleSize: 0,
      calibrationError: 0,
    })),
    overconfidentBuckets: [],
    underconfidentBuckets: [],
  };
}

// ============================================================================
// TYPE GUARD
// ============================================================================

export function isCalibrationReport(value: unknown): value is CalibrationReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return r.kind === 'CalibrationReport.v1' && r.schemaVersion === 1;
}
