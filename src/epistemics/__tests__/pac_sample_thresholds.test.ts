/**
 * @fileoverview Tests for PAC-Based Sample Thresholds (WU-THIMPL-208)
 *
 * Tests cover:
 * - computeMinSamplesForCalibration
 * - computeAchievableAccuracy
 * - checkCalibrationRequirements
 * - Mathematical correctness of Hoeffding-based bounds
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  computeMinSamplesForCalibration,
  computeAchievableAccuracy,
  checkCalibrationRequirements,
  type PACThresholdResult,
} from '../calibration.js';

describe('PAC-Based Sample Thresholds (WU-THIMPL-208)', () => {
  describe('computeMinSamplesForCalibration', () => {
    describe('basic functionality', () => {
      it('should compute minimum samples for standard case', () => {
        // Standard: 5% accuracy, 95% confidence
        const result = computeMinSamplesForCalibration(0.05, 0.95);

        expect(result.minSamples).toBeGreaterThan(0);
        expect(result.desiredAccuracy).toBe(0.05);
        expect(result.confidenceLevel).toBe(0.95);
        expect(result.numBins).toBeUndefined();
        expect(result.rationale).toContain('Hoeffding');
      });

      it('should compute correct value using Hoeffding formula', () => {
        // n = ln(2/δ) / (2ε²)
        // For ε=0.05, δ=0.05 (95% confidence):
        // n = ln(2/0.05) / (2 × 0.05²) = ln(40) / 0.005 ≈ 738
        const result = computeMinSamplesForCalibration(0.05, 0.95);

        // Allow some rounding tolerance
        expect(result.minSamples).toBeGreaterThanOrEqual(738);
        expect(result.minSamples).toBeLessThanOrEqual(740);
      });

      it('should require more samples for higher accuracy', () => {
        const loose = computeMinSamplesForCalibration(0.10, 0.95);
        const standard = computeMinSamplesForCalibration(0.05, 0.95);
        const tight = computeMinSamplesForCalibration(0.02, 0.95);

        expect(standard.minSamples).toBeGreaterThan(loose.minSamples);
        expect(tight.minSamples).toBeGreaterThan(standard.minSamples);
      });

      it('should require more samples for higher confidence', () => {
        const low = computeMinSamplesForCalibration(0.05, 0.90);
        const medium = computeMinSamplesForCalibration(0.05, 0.95);
        const high = computeMinSamplesForCalibration(0.05, 0.99);

        expect(medium.minSamples).toBeGreaterThan(low.minSamples);
        expect(high.minSamples).toBeGreaterThan(medium.minSamples);
      });
    });

    describe('with multiple bins', () => {
      it('should require more total samples with bins', () => {
        const noBins = computeMinSamplesForCalibration(0.05, 0.95);
        const withBins = computeMinSamplesForCalibration(0.05, 0.95, 10);

        expect(withBins.minSamples).toBeGreaterThan(noBins.minSamples);
        expect(withBins.numBins).toBe(10);
      });

      it('should scale appropriately with number of bins', () => {
        const bins5 = computeMinSamplesForCalibration(0.05, 0.95, 5);
        const bins10 = computeMinSamplesForCalibration(0.05, 0.95, 10);
        const bins20 = computeMinSamplesForCalibration(0.05, 0.95, 20);

        // More bins = more samples (but not exactly linear due to log factor)
        expect(bins10.minSamples).toBeGreaterThan(bins5.minSamples);
        expect(bins20.minSamples).toBeGreaterThan(bins10.minSamples);
      });

      it('should explain union bound in rationale', () => {
        const result = computeMinSamplesForCalibration(0.05, 0.95, 10);

        expect(result.rationale).toContain('union bound');
        expect(result.rationale).toContain('10 bins');
      });
    });

    describe('input validation', () => {
      it('should throw for accuracy <= 0', () => {
        expect(() => computeMinSamplesForCalibration(0, 0.95)).toThrow(/desiredAccuracy/);
        expect(() => computeMinSamplesForCalibration(-0.1, 0.95)).toThrow(/desiredAccuracy/);
      });

      it('should throw for accuracy >= 1', () => {
        expect(() => computeMinSamplesForCalibration(1, 0.95)).toThrow(/desiredAccuracy/);
        expect(() => computeMinSamplesForCalibration(1.5, 0.95)).toThrow(/desiredAccuracy/);
      });

      it('should throw for confidence <= 0', () => {
        expect(() => computeMinSamplesForCalibration(0.05, 0)).toThrow(/confidenceLevel/);
        expect(() => computeMinSamplesForCalibration(0.05, -0.1)).toThrow(/confidenceLevel/);
      });

      it('should throw for confidence >= 1', () => {
        expect(() => computeMinSamplesForCalibration(0.05, 1)).toThrow(/confidenceLevel/);
        expect(() => computeMinSamplesForCalibration(0.05, 1.5)).toThrow(/confidenceLevel/);
      });

      it('should throw for invalid numBins', () => {
        expect(() => computeMinSamplesForCalibration(0.05, 0.95, 0)).toThrow(/numBins/);
        expect(() => computeMinSamplesForCalibration(0.05, 0.95, -1)).toThrow(/numBins/);
        expect(() => computeMinSamplesForCalibration(0.05, 0.95, 2.5)).toThrow(/numBins/);
      });
    });

    describe('practical scenarios', () => {
      it('should give reasonable values for common calibration cases', () => {
        // Relaxed: 10% accuracy, 90% confidence
        const relaxed = computeMinSamplesForCalibration(0.10, 0.90);
        expect(relaxed.minSamples).toBeLessThan(200);

        // Standard: 5% accuracy, 95% confidence
        const standard = computeMinSamplesForCalibration(0.05, 0.95);
        expect(standard.minSamples).toBeLessThan(1000);

        // Strict: 2% accuracy, 99% confidence
        const strict = computeMinSamplesForCalibration(0.02, 0.99);
        expect(strict.minSamples).toBeGreaterThan(5000);
      });

      it('should align with bootstrapCalibration thresholds', () => {
        // The bootstrap calibration uses different tiers
        // Verify PAC thresholds are in the right ballpark

        // For N=50 (moderate bootstrap tier), what accuracy is achievable?
        const accuracy50 = computeAchievableAccuracy(50, 0.95);
        expect(accuracy50).toBeGreaterThan(0.15); // Not very accurate with 50 samples

        // For N=200 (full calibration tier), what accuracy is achievable?
        const accuracy200 = computeAchievableAccuracy(200, 0.95);
        expect(accuracy200).toBeLessThan(0.15);
        expect(accuracy200).toBeGreaterThan(0.05);
      });
    });
  });

  describe('computeAchievableAccuracy', () => {
    it('should compute achievable accuracy from sample size', () => {
      const accuracy = computeAchievableAccuracy(1000, 0.95);

      expect(accuracy).toBeGreaterThan(0);
      expect(accuracy).toBeLessThan(0.1);
    });

    it('should be inverse of computeMinSamplesForCalibration', () => {
      // If we need N samples for accuracy ε, then N samples should give accuracy ≈ ε
      const desiredAccuracy = 0.05;
      const confidenceLevel = 0.95;

      const required = computeMinSamplesForCalibration(desiredAccuracy, confidenceLevel);
      const achieved = computeAchievableAccuracy(required.minSamples, confidenceLevel);

      // Should be close to desired (allow small numerical error)
      expect(achieved).toBeCloseTo(desiredAccuracy, 2);
    });

    it('should improve accuracy with more samples', () => {
      const acc100 = computeAchievableAccuracy(100, 0.95);
      const acc500 = computeAchievableAccuracy(500, 0.95);
      const acc1000 = computeAchievableAccuracy(1000, 0.95);

      // Lower epsilon = better accuracy
      expect(acc500).toBeLessThan(acc100);
      expect(acc1000).toBeLessThan(acc500);
    });

    it('should handle multiple bins', () => {
      const noBins = computeAchievableAccuracy(1000, 0.95);
      const withBins = computeAchievableAccuracy(1000, 0.95, 10);

      // With bins, same total samples gives worse per-bin accuracy
      expect(withBins).toBeGreaterThan(noBins);
    });

    it('should cap at 1', () => {
      // Very small sample size should not exceed 100% error
      const accuracy = computeAchievableAccuracy(1, 0.99);
      expect(accuracy).toBeLessThanOrEqual(1);
    });

    describe('input validation', () => {
      it('should throw for non-positive sample size', () => {
        expect(() => computeAchievableAccuracy(0, 0.95)).toThrow(/sampleSize/);
        expect(() => computeAchievableAccuracy(-10, 0.95)).toThrow(/sampleSize/);
      });

      it('should throw for invalid confidence level', () => {
        expect(() => computeAchievableAccuracy(100, 0)).toThrow(/confidenceLevel/);
        expect(() => computeAchievableAccuracy(100, 1)).toThrow(/confidenceLevel/);
      });
    });
  });

  describe('checkCalibrationRequirements', () => {
    it('should return meets=true when samples are sufficient', () => {
      const result = checkCalibrationRequirements(1000, 0.05, 0.95);

      expect(result.meets).toBe(true);
      expect(result.deficit).toBe(0);
      expect(result.actual).toBe(1000);
    });

    it('should return meets=false when samples are insufficient', () => {
      const result = checkCalibrationRequirements(100, 0.05, 0.95);

      expect(result.meets).toBe(false);
      expect(result.deficit).toBeGreaterThan(0);
      expect(result.required).toBeGreaterThan(100);
    });

    it('should compute achievable accuracy', () => {
      const result = checkCalibrationRequirements(500, 0.05, 0.95);

      expect(result.achievableAccuracy).toBeGreaterThan(0);
      expect(result.achievableAccuracy).toBeLessThan(1);
    });

    it('should correctly report deficit', () => {
      const required = computeMinSamplesForCalibration(0.05, 0.95).minSamples;
      const actual = 100;

      const result = checkCalibrationRequirements(actual, 0.05, 0.95);

      expect(result.deficit).toBe(required - actual);
    });

    it('should handle binned calibration', () => {
      const noBins = checkCalibrationRequirements(1000, 0.05, 0.95);
      const withBins = checkCalibrationRequirements(1000, 0.05, 0.95, 10);

      // Same samples may meet without bins but not with bins
      expect(noBins.meets).toBe(true);
      // With 10 bins, 1000 samples might not be enough
      expect(withBins.required).toBeGreaterThan(noBins.required);
    });
  });

  describe('mathematical correctness', () => {
    it('should satisfy Hoeffding inequality', () => {
      // For the Hoeffding bound to be valid:
      // P(|p_hat - p| > ε) ≤ 2 * exp(-2nε²)
      //
      // If we choose n = ln(2/δ) / (2ε²), then:
      // 2 * exp(-2nε²) = 2 * exp(-ln(2/δ)) = 2 * (δ/2) = δ

      const epsilon = 0.05;
      const delta = 0.05; // 95% confidence

      const result = computeMinSamplesForCalibration(epsilon, 1 - delta);
      const n = result.minSamples;

      // Verify the bound holds
      const boundValue = 2 * Math.exp(-2 * n * epsilon * epsilon);
      expect(boundValue).toBeLessThanOrEqual(delta);
    });

    it('should handle union bound correctly', () => {
      // With k bins, we need P(any bin off by ε) ≤ δ
      // Union bound: P(any) ≤ sum(P(each)) = k * P(single)
      // So we need P(single) ≤ δ/k

      const epsilon = 0.05;
      const delta = 0.05;
      const k = 10;

      const result = computeMinSamplesForCalibration(epsilon, 1 - delta, k);
      const samplesPerBin = result.minSamples / k;

      // Each bin should satisfy Hoeffding with δ/k
      const perBinBound = 2 * Math.exp(-2 * samplesPerBin * epsilon * epsilon);
      expect(perBinBound * k).toBeLessThanOrEqual(delta * 1.01); // Small tolerance for rounding
    });

    it('should scale correctly with epsilon', () => {
      // n ∝ 1/ε²
      // Halving ε should quadruple n

      const n1 = computeMinSamplesForCalibration(0.10, 0.95).minSamples;
      const n2 = computeMinSamplesForCalibration(0.05, 0.95).minSamples;

      // n2/n1 should be approximately 4 (0.10² / 0.05² = 4)
      const ratio = n2 / n1;
      expect(ratio).toBeCloseTo(4, 0); // Within 0.5
    });

    it('should scale correctly with delta', () => {
      // n ∝ ln(1/δ)
      // Going from 90% to 99% confidence increases n

      const n90 = computeMinSamplesForCalibration(0.05, 0.90).minSamples;
      const n95 = computeMinSamplesForCalibration(0.05, 0.95).minSamples;
      const n99 = computeMinSamplesForCalibration(0.05, 0.99).minSamples;

      // Ratio should follow ln(2/δ)
      // δ90=0.10, δ95=0.05, δ99=0.01
      // ln(20)/ln(40) ≈ 0.81, ln(40)/ln(200) ≈ 0.70

      expect(n95).toBeGreaterThan(n90);
      expect(n99).toBeGreaterThan(n95);

      // The ratio of changes should be moderate
      const ratio1 = n95 / n90;
      const ratio2 = n99 / n95;

      expect(ratio1).toBeGreaterThan(1);
      expect(ratio1).toBeLessThan(2);
      expect(ratio2).toBeGreaterThan(1);
      expect(ratio2).toBeLessThan(2);
    });
  });
});
