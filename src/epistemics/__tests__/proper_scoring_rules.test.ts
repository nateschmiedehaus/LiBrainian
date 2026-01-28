import { describe, it, expect } from 'vitest';
import {
  computeBrierScore,
  computeLogLoss,
  computeWilsonInterval,
  type ScoringPrediction,
} from '../calibration.js';

describe('computeBrierScore', () => {
  it('returns 0 for perfect predictions', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 1.0, actual: 1 },
      { predicted: 0.0, actual: 0 },
      { predicted: 1.0, actual: 1 },
      { predicted: 0.0, actual: 0 },
    ];

    expect(computeBrierScore(predictions)).toBe(0);
  });

  it('returns 1 for worst possible predictions', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.0, actual: 1 },
      { predicted: 1.0, actual: 0 },
    ];

    expect(computeBrierScore(predictions)).toBe(1);
  });

  it('returns 0.25 for constant 0.5 predictions (random guessing)', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.5, actual: 1 },
      { predicted: 0.5, actual: 0 },
      { predicted: 0.5, actual: 1 },
      { predicted: 0.5, actual: 0 },
    ];

    expect(computeBrierScore(predictions)).toBe(0.25);
  });

  it('computes correct score for mixed predictions', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.9, actual: 1 },  // (0.9 - 1)² = 0.01
      { predicted: 0.2, actual: 0 },  // (0.2 - 0)² = 0.04
      { predicted: 0.8, actual: 0 },  // (0.8 - 0)² = 0.64
    ];

    // Mean: (0.01 + 0.04 + 0.64) / 3 = 0.69 / 3 = 0.23
    expect(computeBrierScore(predictions)).toBeCloseTo(0.23, 10);
  });

  it('throws error for empty predictions array', () => {
    expect(() => computeBrierScore([])).toThrow(
      'Cannot compute Brier Score from empty predictions array'
    );
  });

  it('clamps predictions to [0, 1]', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 1.5, actual: 1 },  // Clamped to 1.0, (1 - 1)² = 0
      { predicted: -0.5, actual: 0 }, // Clamped to 0.0, (0 - 0)² = 0
    ];

    expect(computeBrierScore(predictions)).toBe(0);
  });

  it('penalizes confident wrong predictions heavily', () => {
    const highConfidenceWrong: ScoringPrediction[] = [
      { predicted: 0.99, actual: 0 },
    ];
    const lowConfidenceWrong: ScoringPrediction[] = [
      { predicted: 0.6, actual: 0 },
    ];

    const highScore = computeBrierScore(highConfidenceWrong);
    const lowScore = computeBrierScore(lowConfidenceWrong);

    // High confidence wrong should be penalized more
    expect(highScore).toBeGreaterThan(lowScore);
    expect(highScore).toBeCloseTo(0.9801, 4); // (0.99 - 0)²
    expect(lowScore).toBeCloseTo(0.36, 4);    // (0.6 - 0)²
  });
});

describe('computeLogLoss', () => {
  it('returns ~0 for near-perfect predictions', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.9999, actual: 1 },
      { predicted: 0.0001, actual: 0 },
    ];

    expect(computeLogLoss(predictions)).toBeLessThan(0.001);
  });

  it('returns high value for worst predictions', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.01, actual: 1 },
      { predicted: 0.99, actual: 0 },
    ];

    // -log(0.01) ≈ 4.605 for each, so average ≈ 4.605
    expect(computeLogLoss(predictions)).toBeGreaterThan(4);
  });

  it('returns ~0.693 for constant 0.5 predictions (random guessing)', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.5, actual: 1 },
      { predicted: 0.5, actual: 0 },
    ];

    // -log(0.5) ≈ 0.693
    expect(computeLogLoss(predictions)).toBeCloseTo(0.6931471805599453, 10);
  });

  it('computes correct log loss for mixed predictions', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.9, actual: 1 },  // -log(0.9) ≈ 0.105
      { predicted: 0.1, actual: 0 },  // -log(0.9) ≈ 0.105
    ];

    expect(computeLogLoss(predictions)).toBeCloseTo(0.10536051565782628, 10);
  });

  it('throws error for empty predictions array', () => {
    expect(() => computeLogLoss([])).toThrow(
      'Cannot compute Log Loss from empty predictions array'
    );
  });

  it('handles edge case predictions (0 and 1) with epsilon clamping', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.0, actual: 0 },  // Would be log(0) without clamping
      { predicted: 1.0, actual: 1 },  // Would be log(0) without clamping
    ];

    // Should not throw and should return a finite value
    const loss = computeLogLoss(predictions);
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeLessThan(0.001); // Should be very small (near perfect)
  });

  it('penalizes confident wrong predictions more severely than Brier', () => {
    const confidentWrong: ScoringPrediction[] = [
      { predicted: 0.99, actual: 0 },
    ];

    const logLoss = computeLogLoss(confidentWrong);
    const brierScore = computeBrierScore(confidentWrong);

    // Log loss: -log(0.01) ≈ 4.605
    // Brier: (0.99)² ≈ 0.9801
    expect(logLoss).toBeGreaterThan(4);
    expect(brierScore).toBeLessThan(1);
    expect(logLoss).toBeGreaterThan(brierScore);
  });
});

describe('computeWilsonInterval', () => {
  it('computes correct interval for 50% success rate', () => {
    const [lower, upper] = computeWilsonInterval(50, 100, 0.95);

    // For p=0.5, n=100, z=1.96, Wilson interval is approximately [0.40, 0.60]
    expect(lower).toBeCloseTo(0.4, 1);
    expect(upper).toBeCloseTo(0.6, 1);
    expect(lower).toBeLessThan(0.5);
    expect(upper).toBeGreaterThan(0.5);
  });

  it('computes correct interval for small sample with all successes', () => {
    const [lower, upper] = computeWilsonInterval(5, 5, 0.95);

    // All 5 successes - Wilson interval still gives reasonable bounds
    // Unlike normal approximation which would give impossible [1.0, 1.0+something]
    expect(lower).toBeLessThan(1);
    expect(upper).toBe(1);
    expect(lower).toBeGreaterThan(0.5); // Should still be high
  });

  it('computes correct interval for small sample with no successes', () => {
    const [lower, upper] = computeWilsonInterval(0, 5, 0.95);

    // No successes - Wilson interval gives reasonable bounds
    expect(lower).toBe(0);
    expect(upper).toBeGreaterThan(0);
    expect(upper).toBeLessThan(0.5); // Should still be low
  });

  it('narrows interval with larger sample size', () => {
    const [lower10, upper10] = computeWilsonInterval(7, 10, 0.95);
    const [lower100, upper100] = computeWilsonInterval(70, 100, 0.95);
    const [lower1000, upper1000] = computeWilsonInterval(700, 1000, 0.95);

    const width10 = upper10 - lower10;
    const width100 = upper100 - lower100;
    const width1000 = upper1000 - lower1000;

    // Same proportion (70%), but interval should narrow with more samples
    expect(width100).toBeLessThan(width10);
    expect(width1000).toBeLessThan(width100);
  });

  it('widens interval with higher confidence level', () => {
    const [lower90, upper90] = computeWilsonInterval(50, 100, 0.90);
    const [lower95, upper95] = computeWilsonInterval(50, 100, 0.95);
    const [lower99, upper99] = computeWilsonInterval(50, 100, 0.99);

    const width90 = upper90 - lower90;
    const width95 = upper95 - lower95;
    const width99 = upper99 - lower99;

    // Higher confidence = wider interval
    expect(width95).toBeGreaterThan(width90);
    expect(width99).toBeGreaterThan(width95);
  });

  it('handles single trial with success', () => {
    const [lower, upper] = computeWilsonInterval(1, 1, 0.95);

    // With n=1, p=1, the interval should still be reasonable
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBe(1);
  });

  it('handles single trial with failure', () => {
    const [lower, upper] = computeWilsonInterval(0, 1, 0.95);

    expect(lower).toBe(0);
    expect(upper).toBeLessThan(1);
  });

  it('throws error for zero total', () => {
    expect(() => computeWilsonInterval(0, 0, 0.95)).toThrow('Total must be positive');
  });

  it('throws error for negative total', () => {
    expect(() => computeWilsonInterval(5, -10, 0.95)).toThrow('Total must be positive');
  });

  it('throws error for successes greater than total', () => {
    expect(() => computeWilsonInterval(15, 10, 0.95)).toThrow(
      'Successes (15) must be between 0 and total (10)'
    );
  });

  it('throws error for negative successes', () => {
    expect(() => computeWilsonInterval(-5, 10, 0.95)).toThrow(
      'Successes (-5) must be between 0 and total (10)'
    );
  });

  it('throws error for invalid confidence level', () => {
    expect(() => computeWilsonInterval(5, 10, 0)).toThrow(
      'Confidence level must be between 0 and 1 (exclusive)'
    );
    expect(() => computeWilsonInterval(5, 10, 1)).toThrow(
      'Confidence level must be between 0 and 1 (exclusive)'
    );
    expect(() => computeWilsonInterval(5, 10, 1.5)).toThrow(
      'Confidence level must be between 0 and 1 (exclusive)'
    );
  });

  it('interval always contains the observed proportion', () => {
    // Test various proportions (excluding edge cases 0/n and n/n which have
    // boundary behavior due to clamping to [0, 1])
    const testCases = [
      { successes: 1, total: 10 },
      { successes: 3, total: 10 },
      { successes: 5, total: 10 },
      { successes: 7, total: 10 },
      { successes: 9, total: 10 },
      { successes: 1, total: 100 },
      { successes: 50, total: 100 },
      { successes: 99, total: 100 },
    ];

    for (const { successes, total } of testCases) {
      const [lower, upper] = computeWilsonInterval(successes, total, 0.95);
      const p = successes / total;

      // Use small epsilon for floating point comparison
      expect(lower).toBeLessThanOrEqual(p + 1e-10);
      expect(upper).toBeGreaterThanOrEqual(p - 1e-10);
    }
  });

  it('uses correct z-scores for common confidence levels', () => {
    // We can verify by checking the interval width ratios
    // z-scores: 90% -> 1.645, 95% -> 1.96, 99% -> 2.576
    const [, u90] = computeWilsonInterval(50, 100, 0.90);
    const [l90] = computeWilsonInterval(50, 100, 0.90);
    const [, u95] = computeWilsonInterval(50, 100, 0.95);
    const [l95] = computeWilsonInterval(50, 100, 0.95);

    const width90 = u90 - l90;
    const width95 = u95 - l95;

    // Ratio should be approximately 1.96/1.645 ≈ 1.19
    const ratio = width95 / width90;
    expect(ratio).toBeCloseTo(1.19, 1);
  });
});

describe('proper scoring rules comparison', () => {
  it('both scores improve for better calibrated predictions', () => {
    const wellCalibrated: ScoringPrediction[] = [
      { predicted: 0.9, actual: 1 },
      { predicted: 0.1, actual: 0 },
      { predicted: 0.8, actual: 1 },
      { predicted: 0.2, actual: 0 },
    ];

    const poorlyCalibrated: ScoringPrediction[] = [
      { predicted: 0.9, actual: 0 },
      { predicted: 0.1, actual: 1 },
      { predicted: 0.8, actual: 0 },
      { predicted: 0.2, actual: 1 },
    ];

    const wellBrier = computeBrierScore(wellCalibrated);
    const poorBrier = computeBrierScore(poorlyCalibrated);
    const wellLogLoss = computeLogLoss(wellCalibrated);
    const poorLogLoss = computeLogLoss(poorlyCalibrated);

    expect(wellBrier).toBeLessThan(poorBrier);
    expect(wellLogLoss).toBeLessThan(poorLogLoss);
  });
});
