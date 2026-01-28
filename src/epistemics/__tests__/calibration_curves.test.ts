import { describe, it, expect } from 'vitest';
import type { LibrarianStorage } from '../../storage/types.js';
import { bounded } from '../confidence.js';
import {
  computeCalibrationCurve,
  buildCalibrationReport,
  // Isotonic calibration (WU-THIMPL-112)
  isotonicCalibration,
  applyIsotonicMapping,
  type CalibratedMapping,
  // Bootstrap calibration (WU-THIMPL-113)
  bootstrapCalibration,
  bayesianSmooth,
  applyBootstrapCalibration,
  type CalibrationConfig,
} from '../calibration.js';
import { createClaimOutcomeTracker } from '../outcomes.js';

class MockStorage implements Pick<LibrarianStorage, 'getState' | 'setState'> {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('calibration curves', () => {
  it('computes bucket accuracy and ECE from samples', () => {
    const curve = computeCalibrationCurve(
      [
        { confidence: 0.05, outcome: 0 },
        { confidence: 0.15, outcome: 1 },
        { confidence: 0.25, outcome: 1 },
        { confidence: 0.85, outcome: 0 },
        { confidence: 0.95, outcome: 1 },
      ],
      { bucketCount: 5 }
    );

    expect(curve.sampleSize).toBe(5);
    expect(curve.ece).toBeCloseTo(0.47, 4);
    expect(curve.mce).toBeCloseTo(0.75, 4);
    expect(curve.overconfidenceRatio).toBeCloseTo(0.4, 4);

    const bucketLow = curve.buckets.find((bucket) => bucket.confidenceBucket === 0.2);
    const bucketHigh = curve.buckets.find((bucket) => bucket.confidenceBucket === 1.0);

    expect(bucketLow?.sampleSize).toBe(2);
    expect(bucketLow?.statedMean).toBeCloseTo(0.1, 4);
    expect(bucketLow?.empiricalAccuracy).toBeCloseTo(0.5, 4);
    expect(bucketLow?.standardError).toBeCloseTo(0.3536, 4);

    expect(bucketHigh?.sampleSize).toBe(2);
    expect(bucketHigh?.statedMean).toBeCloseTo(0.9, 4);
    expect(bucketHigh?.empiricalAccuracy).toBeCloseTo(0.5, 4);

    const report = buildCalibrationReport('dataset_test', curve, new Date('2026-01-26T00:00:00Z'));
    expect(report.datasetId).toBe('dataset_test');
    expect(report.calibrationCurve.get(0.2)).toBeCloseTo(0.5, 4);
    expect(report.adjustments.get('[0.00, 0.20)')).toMatchObject({
      raw: 0.1,
      calibrated: 0.5,
    });
  });

  it('computes and stores calibration reports from claim outcomes', async () => {
    const storage = new MockStorage();
    const tracker = createClaimOutcomeTracker(storage as unknown as LibrarianStorage);

    const { record: claimA } = await tracker.recordClaim({
      claim: 'endpoint returns 200',
      claimType: 'behavioral',
      statedConfidence: bounded(0.6, 0.8, 'theoretical', 'static_analysis'),
      category: 'behavior',
    });
    const { record: claimB } = await tracker.recordClaim({
      claim: 'error handling is correct',
      claimType: 'behavioral',
      statedConfidence: bounded(0.2, 0.4, 'theoretical', 'static_analysis'),
      category: 'behavior',
    });

    await tracker.recordOutcome({
      claimId: claimA.id,
      outcome: 'correct',
      verifiedBy: 'automated_test',
      observation: 'integration test passed',
    });
    await tracker.recordOutcome({
      claimId: claimB.id,
      outcome: 'incorrect',
      verifiedBy: 'automated_test',
      observation: 'test failed',
    });

    const { report, snapshot } = await tracker.computeCalibrationReport({
      datasetId: 'outcome_dataset',
      bucketCount: 2,
      claimType: 'behavioral',
      category: 'behavior',
    });

    expect(report.sampleSize).toBe(2);
    expect(report.expectedCalibrationError).toBeCloseTo(0.3, 4);
    expect(report.maximumCalibrationError).toBeCloseTo(0.3, 4);
    expect(snapshot.datasetId).toBe('outcome_dataset');
    expect(snapshot.bucketCount).toBe(2);

    const history = await tracker.listCalibrationReports(5);
    expect(history.length).toBe(1);
    expect(history[0]?.expectedCalibrationError).toBeCloseTo(0.3, 4);
  });
});

// ============================================================================
// ISOTONIC CALIBRATION TESTS (WU-THIMPL-112)
// ============================================================================

describe('Isotonic Calibration', () => {
  describe('isotonicCalibration', () => {
    it('should produce monotonic mapping from predictions', () => {
      const predictions = [
        { predicted: 0.9, actual: 1 as const },
        { predicted: 0.8, actual: 1 as const },
        { predicted: 0.7, actual: 1 as const },
        { predicted: 0.3, actual: 0 as const },
        { predicted: 0.2, actual: 0 as const },
      ];

      const mapping = isotonicCalibration(predictions);

      expect(mapping.sampleSize).toBe(5);
      expect(mapping.minRaw).toBe(0.2);
      expect(mapping.maxRaw).toBe(0.9);
      expect(mapping.points.length).toBeGreaterThan(0);

      // Verify monotonicity
      for (let i = 1; i < mapping.points.length; i++) {
        expect(mapping.points[i].calibrated).toBeGreaterThanOrEqual(
          mapping.points[i - 1].calibrated
        );
      }
    });

    it('should handle violations by pooling adjacent points', () => {
      // Deliberately include a violation:
      // predicted 0.6 has outcome 1, but predicted 0.7 has outcome 0
      const predictions = [
        { predicted: 0.5, actual: 0 as const },
        { predicted: 0.6, actual: 1 as const }, // High actual
        { predicted: 0.7, actual: 0 as const }, // Low actual (violation!)
        { predicted: 0.8, actual: 1 as const },
      ];

      const mapping = isotonicCalibration(predictions);

      // Should still be monotonic after PAV algorithm
      for (let i = 1; i < mapping.points.length; i++) {
        expect(mapping.points[i].calibrated).toBeGreaterThanOrEqual(
          mapping.points[i - 1].calibrated
        );
      }
    });

    it('should throw for empty predictions', () => {
      expect(() => isotonicCalibration([])).toThrow(/empty/);
    });

    it('should handle single prediction', () => {
      const mapping = isotonicCalibration([{ predicted: 0.5, actual: 1 }]);

      expect(mapping.points.length).toBe(1);
      expect(mapping.points[0].calibrated).toBe(1);
    });

    it('should handle all same outcomes', () => {
      const predictions = [
        { predicted: 0.3, actual: 1 as const },
        { predicted: 0.5, actual: 1 as const },
        { predicted: 0.7, actual: 1 as const },
      ];

      const mapping = isotonicCalibration(predictions);

      // All calibrated values should be 1 (or very close)
      for (const point of mapping.points) {
        expect(point.calibrated).toBeCloseTo(1, 5);
      }
    });

    it('should preserve perfect calibration', () => {
      // Perfectly calibrated: low scores = 0, high scores = 1
      const predictions = [
        { predicted: 0.1, actual: 0 as const },
        { predicted: 0.2, actual: 0 as const },
        { predicted: 0.8, actual: 1 as const },
        { predicted: 0.9, actual: 1 as const },
      ];

      const mapping = isotonicCalibration(predictions);

      // Should be monotonically increasing (not strictly - ties allowed at 0 and 1)
      for (let i = 1; i < mapping.points.length; i++) {
        expect(mapping.points[i].calibrated).toBeGreaterThanOrEqual(
          mapping.points[i - 1].calibrated
        );
      }
      // Calibrated values should be at extremes
      expect(mapping.points[0].calibrated).toBe(0);
      expect(mapping.points[mapping.points.length - 1].calibrated).toBe(1);
    });
  });

  describe('applyIsotonicMapping', () => {
    it('should interpolate between calibration points', () => {
      const mapping: CalibratedMapping = {
        points: [
          { raw: 0.2, calibrated: 0.1 },
          { raw: 0.4, calibrated: 0.3 },
          { raw: 0.6, calibrated: 0.5 },
          { raw: 0.8, calibrated: 0.9 },
        ],
        minRaw: 0.2,
        maxRaw: 0.8,
        sampleSize: 100,
        isStrictlyMonotonic: true,
      };

      // Exact points
      expect(applyIsotonicMapping(mapping, 0.2)).toBeCloseTo(0.1, 5);
      expect(applyIsotonicMapping(mapping, 0.8)).toBeCloseTo(0.9, 5);

      // Interpolated
      expect(applyIsotonicMapping(mapping, 0.3)).toBeCloseTo(0.2, 5);
      expect(applyIsotonicMapping(mapping, 0.5)).toBeCloseTo(0.4, 5);
    });

    it('should extrapolate at boundaries', () => {
      const mapping: CalibratedMapping = {
        points: [
          { raw: 0.3, calibrated: 0.2 },
          { raw: 0.7, calibrated: 0.8 },
        ],
        minRaw: 0.3,
        maxRaw: 0.7,
        sampleSize: 10,
        isStrictlyMonotonic: true,
      };

      // Below range
      expect(applyIsotonicMapping(mapping, 0.1)).toBe(0.2);
      // Above range
      expect(applyIsotonicMapping(mapping, 0.9)).toBe(0.8);
    });

    it('should handle single-point mapping', () => {
      const mapping: CalibratedMapping = {
        points: [{ raw: 0.5, calibrated: 0.7 }],
        minRaw: 0.5,
        maxRaw: 0.5,
        sampleSize: 1,
        isStrictlyMonotonic: true,
      };

      expect(applyIsotonicMapping(mapping, 0.3)).toBe(0.7);
      expect(applyIsotonicMapping(mapping, 0.5)).toBe(0.7);
      expect(applyIsotonicMapping(mapping, 0.8)).toBe(0.7);
    });

    it('should handle empty mapping gracefully', () => {
      const mapping: CalibratedMapping = {
        points: [],
        minRaw: 0,
        maxRaw: 0,
        sampleSize: 0,
        isStrictlyMonotonic: true,
      };

      // Returns raw score when no calibration available
      expect(applyIsotonicMapping(mapping, 0.6)).toBe(0.6);
    });
  });
});

// ============================================================================
// BOOTSTRAP CALIBRATION TESTS (WU-THIMPL-113)
// ============================================================================

describe('Bootstrap Calibration', () => {
  describe('bootstrapCalibration', () => {
    it('should return no-calibration config for N < 10', () => {
      const config = bootstrapCalibration(5);

      expect(config.calibrationWeight).toBe(0);
      expect(config.useIsotonic).toBe(false);
      expect(config.rationale).toContain('Insufficient');
    });

    it('should return conservative config for 10 <= N < 50', () => {
      const config = bootstrapCalibration(25);

      expect(config.calibrationWeight).toBe(0.3);
      expect(config.useIsotonic).toBe(false);
      expect(config.bucketCount).toBeLessThanOrEqual(5);
      expect(config.prior.alpha).toBe(2);
      expect(config.prior.beta).toBe(2);
    });

    it('should return moderate config for 50 <= N < 200', () => {
      const config = bootstrapCalibration(100);

      expect(config.calibrationWeight).toBe(0.6);
      expect(config.useIsotonic).toBe(true); // Enabled at 100+
      expect(config.bucketCount).toBeLessThanOrEqual(10);
    });

    it('should return full calibration config for N >= 200', () => {
      const config = bootstrapCalibration(500);

      expect(config.calibrationWeight).toBe(1.0);
      expect(config.useIsotonic).toBe(true);
      expect(config.prior.alpha).toBe(0.5); // Jeffreys prior
      expect(config.prior.beta).toBe(0.5);
    });

    it('should throw for negative sample size', () => {
      expect(() => bootstrapCalibration(-1)).toThrow(/negative/);
    });

    it('should handle zero sample size', () => {
      const config = bootstrapCalibration(0);
      expect(config.calibrationWeight).toBe(0);
    });

    it('should scale bucket count with sample size', () => {
      const small = bootstrapCalibration(30);
      const medium = bootstrapCalibration(100);
      const large = bootstrapCalibration(300);

      expect(small.bucketCount).toBeLessThan(medium.bucketCount);
      expect(medium.bucketCount).toBeLessThanOrEqual(large.bucketCount);
    });
  });

  describe('bayesianSmooth', () => {
    it('should apply Beta-Binomial smoothing', () => {
      // 7 successes in 10 trials with uniform prior Beta(1,1)
      const smoothed = bayesianSmooth(7, 10, { alpha: 1, beta: 1 });

      // Posterior mean = (7 + 1) / (10 + 1 + 1) = 8/12 = 0.667
      expect(smoothed).toBeCloseTo(0.667, 2);
    });

    it('should shrink toward prior mean with strong prior', () => {
      // Same data but with strong prior Beta(10,10) centered at 0.5
      const weakPrior = bayesianSmooth(7, 10, { alpha: 1, beta: 1 });
      const strongPrior = bayesianSmooth(7, 10, { alpha: 10, beta: 10 });

      // Strong prior pulls toward 0.5 more
      expect(strongPrior).toBeLessThan(weakPrior);
      expect(strongPrior).toBeCloseTo(0.567, 2); // (7+10)/(10+20) = 17/30
    });

    it('should handle edge cases', () => {
      // All successes
      expect(bayesianSmooth(10, 10, { alpha: 1, beta: 1 })).toBeLessThan(1);

      // No successes
      expect(bayesianSmooth(0, 10, { alpha: 1, beta: 1 })).toBeGreaterThan(0);
    });

    it('should throw for invalid inputs', () => {
      expect(() => bayesianSmooth(-1, 10, { alpha: 1, beta: 1 })).toThrow();
      expect(() => bayesianSmooth(11, 10, { alpha: 1, beta: 1 })).toThrow();
      expect(() => bayesianSmooth(5, 10, { alpha: 0, beta: 1 })).toThrow();
    });
  });

  describe('applyBootstrapCalibration', () => {
    it('should blend calibrated and raw scores based on weight', () => {
      const config: CalibrationConfig = {
        bucketCount: 5,
        minSamplesPerBucket: 5,
        minTotalSamples: 10,
        useIsotonic: false,
        calibrationWeight: 0.5,
        prior: { alpha: 1, beta: 1 },
        rationale: 'test',
      };

      // Bucket 2 (0.4-0.6) has 10 successes in 20 samples = 0.5 empirical
      const buckets = new Map([[2, { successes: 10, total: 20 }]]);

      // Raw score 0.5 falls in bucket 2
      const calibrated = applyBootstrapCalibration(0.5, buckets, config);

      // Expected: 0.5 * 0.5 + 0.5 * smoothedAccuracy
      // smoothedAccuracy = (10+1)/(20+2) = 11/22 = 0.5
      expect(calibrated).toBeCloseTo(0.5, 2);
    });

    it('should use prior when bucket has insufficient samples', () => {
      const config: CalibrationConfig = {
        bucketCount: 5,
        minSamplesPerBucket: 10,
        minTotalSamples: 10,
        useIsotonic: false,
        calibrationWeight: 0.5,
        prior: { alpha: 2, beta: 2 }, // Prior mean = 0.5
        rationale: 'test',
      };

      // Bucket 2 has only 3 samples (< minSamplesPerBucket)
      const buckets = new Map([[2, { successes: 3, total: 3 }]]);

      const calibrated = applyBootstrapCalibration(0.5, buckets, config);

      // Should blend with prior mean (0.5), not bucket data
      // 0.5 * 0.5 + 0.5 * 0.5 = 0.5
      expect(calibrated).toBeCloseTo(0.5, 2);
    });

    it('should return raw score when calibration weight is 0', () => {
      const config = bootstrapCalibration(5); // N < 10, weight = 0

      const buckets = new Map([[2, { successes: 10, total: 10 }]]);

      // Despite perfect bucket accuracy, weight is 0
      const calibrated = applyBootstrapCalibration(0.3, buckets, config);

      expect(calibrated).toBeCloseTo(0.3, 5);
    });

    it('should handle missing bucket data', () => {
      const config: CalibrationConfig = {
        bucketCount: 5,
        minSamplesPerBucket: 5,
        minTotalSamples: 10,
        useIsotonic: false,
        calibrationWeight: 0.6,
        prior: { alpha: 2, beta: 2 },
        rationale: 'test',
      };

      // No data for any bucket
      const buckets = new Map<number, { successes: number; total: number }>();

      const calibrated = applyBootstrapCalibration(0.7, buckets, config);

      // Should blend with prior mean
      // 0.4 * 0.7 + 0.6 * 0.5 = 0.28 + 0.3 = 0.58
      expect(calibrated).toBeCloseTo(0.58, 2);
    });
  });

  describe('Integration: bootstrapCalibration with real data', () => {
    it('should provide appropriate config for cold-start scenario', () => {
      // Simulate cold-start: just 15 samples
      const predictions = Array.from({ length: 15 }, (_, i) => ({
        predicted: 0.3 + (i / 15) * 0.4,
        actual: (i >= 8 ? 1 : 0) as 0 | 1,
      }));

      const config = bootstrapCalibration(predictions.length);

      expect(config.calibrationWeight).toBe(0.3);
      expect(config.useIsotonic).toBe(false);

      // If we had isotonic, we'd use it. Since not, use histogram
      // Just verify config is reasonable
      expect(config.bucketCount).toBeGreaterThanOrEqual(2);
      expect(config.minSamplesPerBucket).toBeLessThanOrEqual(10);
    });

    it('should transition to full calibration with enough data', () => {
      // Simulate mature system: 500 samples
      const predictions = Array.from({ length: 500 }, (_, i) => ({
        predicted: i / 500,
        actual: (Math.random() < i / 500 ? 1 : 0) as 0 | 1,
      }));

      const config = bootstrapCalibration(predictions.length);

      expect(config.calibrationWeight).toBe(1.0);
      expect(config.useIsotonic).toBe(true);

      // With enough data, isotonic calibration should work well
      const mapping = isotonicCalibration(predictions);
      expect(mapping.sampleSize).toBe(500);
    });
  });
});
