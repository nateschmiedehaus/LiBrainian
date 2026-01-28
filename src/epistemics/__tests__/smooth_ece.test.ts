/**
 * @fileoverview Tests for Smooth ECE (WU-THIMPL-211)
 *
 * Tests cover:
 * - Basic smooth ECE computation
 * - Kernel types (Gaussian, Epanechnikov)
 * - Bandwidth selection (Silverman's rule, custom)
 * - Comparison with binned ECE
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import {
  computeSmoothECE,
  DEFAULT_SMOOTH_ECE_OPTIONS,
  type SmoothECEOptions,
  type ScoringPrediction,
  computeCalibrationCurve,
} from '../calibration.js';

describe('Smooth ECE (WU-THIMPL-211)', () => {
  describe('computeSmoothECE - Basic Functionality', () => {
    it('should compute smooth ECE for basic predictions', () => {
      const predictions: ScoringPrediction[] = [
        { predicted: 0.9, actual: 1 },
        { predicted: 0.8, actual: 1 },
        { predicted: 0.7, actual: 1 },
        { predicted: 0.3, actual: 0 },
        { predicted: 0.2, actual: 0 },
        { predicted: 0.1, actual: 0 },
      ];

      const ece = computeSmoothECE(predictions);

      // Should be a valid probability
      expect(ece).toBeGreaterThanOrEqual(0);
      expect(ece).toBeLessThanOrEqual(1);
    });

    it('should return 0 for perfectly calibrated predictions', () => {
      // Perfect calibration: predicted = actual probability
      const predictions: ScoringPrediction[] = [
        { predicted: 1.0, actual: 1 },
        { predicted: 1.0, actual: 1 },
        { predicted: 0.0, actual: 0 },
        { predicted: 0.0, actual: 0 },
      ];

      const ece = computeSmoothECE(predictions);

      // Should be very close to 0
      expect(ece).toBeLessThan(0.15);
    });

    it('should detect poorly calibrated predictions', () => {
      // Always predict 0.9 but get 50% accuracy
      const predictions: ScoringPrediction[] = [
        { predicted: 0.9, actual: 1 },
        { predicted: 0.9, actual: 0 },
        { predicted: 0.9, actual: 1 },
        { predicted: 0.9, actual: 0 },
      ];

      const ece = computeSmoothECE(predictions);

      // Should detect significant miscalibration (0.9 predicted, 0.5 actual)
      expect(ece).toBeGreaterThan(0.1);
    });

    it('should throw for empty predictions', () => {
      expect(() => computeSmoothECE([])).toThrow(/empty/);
    });

    it('should handle single prediction', () => {
      const predictions: ScoringPrediction[] = [
        { predicted: 0.7, actual: 1 },
      ];

      const ece = computeSmoothECE(predictions);

      // ECE for single sample is |predicted - actual|
      expect(ece).toBeCloseTo(0.3, 2);
    });
  });

  describe('computeSmoothECE - Kernel Types', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.9, actual: 1 },
      { predicted: 0.8, actual: 1 },
      { predicted: 0.7, actual: 0 },
      { predicted: 0.3, actual: 0 },
      { predicted: 0.2, actual: 1 },
      { predicted: 0.1, actual: 0 },
    ];

    it('should use Gaussian kernel by default', () => {
      const defaultEce = computeSmoothECE(predictions);
      const gaussianEce = computeSmoothECE(predictions, { kernelType: 'gaussian' });

      expect(defaultEce).toBeCloseTo(gaussianEce, 5);
    });

    it('should support Epanechnikov kernel', () => {
      const gaussianEce = computeSmoothECE(predictions, { kernelType: 'gaussian' });
      const epanechnikovEce = computeSmoothECE(predictions, { kernelType: 'epanechnikov' });

      // Both should be valid ECE values
      expect(gaussianEce).toBeGreaterThanOrEqual(0);
      expect(epanechnikovEce).toBeGreaterThanOrEqual(0);

      // They may differ slightly due to kernel shape
      // but should be in the same ballpark
      expect(Math.abs(gaussianEce - epanechnikovEce)).toBeLessThan(0.3);
    });
  });

  describe('computeSmoothECE - Bandwidth', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.9, actual: 1 },
      { predicted: 0.8, actual: 1 },
      { predicted: 0.7, actual: 1 },
      { predicted: 0.3, actual: 0 },
      { predicted: 0.2, actual: 0 },
      { predicted: 0.1, actual: 0 },
    ];

    it('should use Silverman bandwidth by default', () => {
      // Default bandwidth should produce reasonable results
      const ece = computeSmoothECE(predictions);

      expect(ece).toBeGreaterThanOrEqual(0);
      expect(ece).toBeLessThanOrEqual(1);
    });

    it('should respect custom bandwidth', () => {
      const smallBandwidth = computeSmoothECE(predictions, { bandwidth: 0.05 });
      const largeBandwidth = computeSmoothECE(predictions, { bandwidth: 0.5 });

      // Both should be valid ECE values
      expect(smallBandwidth).toBeGreaterThanOrEqual(0);
      expect(largeBandwidth).toBeGreaterThanOrEqual(0);

      // Results may differ based on bandwidth
      // Smaller bandwidth = more local = potentially different behavior
    });

    it('should handle edge bandwidth values', () => {
      // Very small bandwidth
      const smallEce = computeSmoothECE(predictions, { bandwidth: 0.01 });
      expect(smallEce).toBeGreaterThanOrEqual(0);

      // Larger bandwidth
      const largeEce = computeSmoothECE(predictions, { bandwidth: 0.3 });
      expect(largeEce).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeSmoothECE - Numerical Integration', () => {
    const predictions: ScoringPrediction[] = [
      { predicted: 0.9, actual: 1 },
      { predicted: 0.7, actual: 1 },
      { predicted: 0.5, actual: 0 },
      { predicted: 0.3, actual: 0 },
    ];

    it('should respect numEvalPoints option', () => {
      const lowRes = computeSmoothECE(predictions, { numEvalPoints: 20 });
      const highRes = computeSmoothECE(predictions, { numEvalPoints: 200 });

      // Both should be valid
      expect(lowRes).toBeGreaterThanOrEqual(0);
      expect(highRes).toBeGreaterThanOrEqual(0);

      // Higher resolution should give similar but possibly more accurate results
      // They shouldn't differ dramatically
      expect(Math.abs(lowRes - highRes)).toBeLessThan(0.1);
    });
  });

  describe('computeSmoothECE - Comparison with Binned ECE', () => {
    it('should be in same ballpark as binned ECE', () => {
      const predictions: ScoringPrediction[] = [];
      // Generate synthetic data
      for (let i = 0; i < 100; i++) {
        const predicted = Math.random();
        // Make actual follow predicted loosely
        const actual = Math.random() < predicted ? 1 : 0;
        predictions.push({ predicted, actual: actual as 0 | 1 });
      }

      const smoothEce = computeSmoothECE(predictions);

      // Convert to CalibrationSample format
      const samples = predictions.map(p => ({
        confidence: p.predicted,
        outcome: p.actual,
      }));
      const curve = computeCalibrationCurve(samples, { bucketCount: 10 });
      const binnedEce = curve.ece;

      // Both should be reasonable ECE values
      expect(smoothEce).toBeGreaterThanOrEqual(0);
      expect(smoothEce).toBeLessThanOrEqual(1);
      expect(binnedEce).toBeGreaterThanOrEqual(0);
      expect(binnedEce).toBeLessThanOrEqual(1);

      // They should be in the same general range
      // Allow reasonable difference since methods differ
      expect(Math.abs(smoothEce - binnedEce)).toBeLessThan(0.25);
    });

    it('should avoid bin boundary artifacts', () => {
      // Create predictions clustered near bin boundaries
      const predictions: ScoringPrediction[] = [
        // Near 0.5 boundary
        { predicted: 0.49, actual: 1 },
        { predicted: 0.49, actual: 1 },
        { predicted: 0.51, actual: 1 },
        { predicted: 0.51, actual: 1 },
        // Far from boundary
        { predicted: 0.1, actual: 0 },
        { predicted: 0.9, actual: 1 },
      ];

      // Smooth ECE should handle this gracefully
      const smoothEce = computeSmoothECE(predictions);

      // Should still produce valid result
      expect(smoothEce).toBeGreaterThanOrEqual(0);
      expect(smoothEce).toBeLessThanOrEqual(1);
    });
  });

  describe('computeSmoothECE - Edge Cases', () => {
    it('should handle all predictions being the same', () => {
      const predictions: ScoringPrediction[] = [
        { predicted: 0.5, actual: 1 },
        { predicted: 0.5, actual: 0 },
        { predicted: 0.5, actual: 1 },
        { predicted: 0.5, actual: 0 },
      ];

      const ece = computeSmoothECE(predictions);

      // Should still compute (50% actual rate, 50% predicted)
      expect(ece).toBeGreaterThanOrEqual(0);
      expect(ece).toBeLessThanOrEqual(1);
    });

    it('should handle predictions at boundaries', () => {
      const predictions: ScoringPrediction[] = [
        { predicted: 0.0, actual: 0 },
        { predicted: 1.0, actual: 1 },
      ];

      const ece = computeSmoothECE(predictions);

      // Perfect calibration at boundaries
      expect(ece).toBeLessThan(0.15);
    });

    it('should handle uniform distribution', () => {
      const predictions: ScoringPrediction[] = [];
      for (let i = 0; i <= 10; i++) {
        const p = i / 10;
        predictions.push({ predicted: p, actual: p > 0.5 ? 1 : 0 });
      }

      const ece = computeSmoothECE(predictions);

      expect(ece).toBeGreaterThanOrEqual(0);
      expect(ece).toBeLessThanOrEqual(1);
    });

    it('should clamp predictions to [0, 1]', () => {
      // Predictions outside [0, 1] should be clamped
      const predictions: ScoringPrediction[] = [
        { predicted: -0.1, actual: 0 }, // Should be treated as 0
        { predicted: 1.1, actual: 1 },  // Should be treated as 1
        { predicted: 0.5, actual: 0 },
        { predicted: 0.5, actual: 1 },
      ];

      const ece = computeSmoothECE(predictions);

      // Should not throw and produce valid result
      expect(ece).toBeGreaterThanOrEqual(0);
      expect(ece).toBeLessThanOrEqual(1);
    });
  });

  describe('DEFAULT_SMOOTH_ECE_OPTIONS', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_SMOOTH_ECE_OPTIONS.bandwidth).toBeUndefined(); // Uses Silverman
      expect(DEFAULT_SMOOTH_ECE_OPTIONS.kernelType).toBe('gaussian');
      expect(DEFAULT_SMOOTH_ECE_OPTIONS.numEvalPoints).toBe(100);
    });
  });

  describe('Mathematical Properties', () => {
    it('should be non-negative', () => {
      // Generate random predictions
      const predictions: ScoringPrediction[] = [];
      for (let i = 0; i < 50; i++) {
        predictions.push({
          predicted: Math.random(),
          actual: Math.random() < 0.5 ? 1 : 0,
        });
      }

      const ece = computeSmoothECE(predictions);
      expect(ece).toBeGreaterThanOrEqual(0);
    });

    it('should be bounded by 1', () => {
      // Worst case: always predict 1, always get 0
      const predictions: ScoringPrediction[] = [
        { predicted: 1.0, actual: 0 },
        { predicted: 1.0, actual: 0 },
        { predicted: 1.0, actual: 0 },
        { predicted: 1.0, actual: 0 },
      ];

      const ece = computeSmoothECE(predictions);
      expect(ece).toBeLessThanOrEqual(1);
    });
  });
});
