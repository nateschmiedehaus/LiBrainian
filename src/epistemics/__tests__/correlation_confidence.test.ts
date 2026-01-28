/**
 * @fileoverview Tests for Correlation-Aware Confidence Derivation (WU-THIMPL-117)
 *
 * Tests cover:
 * - deriveParallelAllConfidence with correlation parameter
 * - deriveParallelAnyConfidence with correlation parameter
 * - Edge cases: ρ=0 (independent), ρ=1 (perfectly correlated)
 * - Calibration status tracking through correlation-aware derivation
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  deriveParallelAllConfidence,
  deriveParallelAnyConfidence,
  measuredConfidence,
  deterministic,
  bounded,
  absent,
  getNumericValue,
  type ConfidenceValue,
  type MeasuredConfidence,
} from '../confidence.js';

describe('Correlation-Aware Confidence Derivation (WU-THIMPL-117)', () => {
  // Test fixtures
  const createMeasured = (accuracy: number): MeasuredConfidence =>
    measuredConfidence({
      datasetId: `test-${accuracy}`,
      sampleSize: 100,
      accuracy,
      ci95: [accuracy - 0.05, accuracy + 0.05],
    });

  describe('deriveParallelAllConfidence', () => {
    describe('with correlation = 0 (independent)', () => {
      it('should behave like standard product formula', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        const result = deriveParallelAllConfidence([conf1, conf2], { correlation: 0 });

        expect(getNumericValue(result)).toBeCloseTo(0.72); // 0.8 * 0.9
        if (result.type === 'derived') {
          expect(result.formula).toBe('product(branches)');
        }
      });

      it('should default to independent when no correlation specified', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        const result = deriveParallelAllConfidence([conf1, conf2]);

        expect(getNumericValue(result)).toBeCloseTo(0.72);
      });
    });

    describe('with correlation = 1 (perfectly correlated)', () => {
      it('should behave like minimum formula', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        const result = deriveParallelAllConfidence([conf1, conf2], { correlation: 1 });

        expect(getNumericValue(result)).toBe(0.8); // min(0.8, 0.9)
        if (result.type === 'derived') {
          expect(result.formula).toContain('ρ=1.00');
        }
      });

      it('should return min of all branches', () => {
        const confs = [createMeasured(0.95), createMeasured(0.85), createMeasured(0.90)];

        const result = deriveParallelAllConfidence(confs, { correlation: 1 });

        expect(getNumericValue(result)).toBe(0.85);
      });
    });

    describe('with partial correlation', () => {
      it('should interpolate between product and min', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        // ρ=0.5: halfway between product (0.72) and min (0.8)
        const result = deriveParallelAllConfidence([conf1, conf2], { correlation: 0.5 });
        const value = getNumericValue(result)!;

        // (1 - 0.5) * 0.72 + 0.5 * 0.8 = 0.36 + 0.4 = 0.76
        expect(value).toBeCloseTo(0.76);
        expect(value).toBeGreaterThan(0.72); // Higher than independent
        expect(value).toBeLessThan(0.8); // Lower than perfectly correlated
      });

      it('should increase monotonically with correlation', () => {
        const conf1 = createMeasured(0.7);
        const conf2 = createMeasured(0.8);

        const r0 = getNumericValue(deriveParallelAllConfidence([conf1, conf2], { correlation: 0 }))!;
        const r25 = getNumericValue(deriveParallelAllConfidence([conf1, conf2], { correlation: 0.25 }))!;
        const r50 = getNumericValue(deriveParallelAllConfidence([conf1, conf2], { correlation: 0.5 }))!;
        const r75 = getNumericValue(deriveParallelAllConfidence([conf1, conf2], { correlation: 0.75 }))!;
        const r100 = getNumericValue(deriveParallelAllConfidence([conf1, conf2], { correlation: 1 }))!;

        expect(r25).toBeGreaterThan(r0);
        expect(r50).toBeGreaterThan(r25);
        expect(r75).toBeGreaterThan(r50);
        expect(r100).toBeGreaterThan(r75);
      });

      it('should include correlation in formula description', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        const result = deriveParallelAllConfidence([conf1, conf2], { correlation: 0.7 });

        if (result.type === 'derived') {
          expect(result.formula).toContain('correlation_adjusted');
          expect(result.formula).toContain('0.70');
        }
      });
    });

    describe('edge cases', () => {
      it('should return absent for empty branches', () => {
        const result = deriveParallelAllConfidence([]);
        expect(result.type).toBe('absent');
      });

      it('should return absent when any branch has absent confidence', () => {
        const result = deriveParallelAllConfidence([createMeasured(0.8), absent()]);
        expect(result.type).toBe('absent');
      });

      it('should clamp correlation to [0, 1]', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        // Negative correlation should be treated as 0
        const resultNeg = deriveParallelAllConfidence([conf1, conf2], { correlation: -0.5 });
        expect(getNumericValue(resultNeg)).toBeCloseTo(0.72); // Product

        // Correlation > 1 should be treated as 1
        const resultHigh = deriveParallelAllConfidence([conf1, conf2], { correlation: 1.5 });
        expect(getNumericValue(resultHigh)).toBe(0.8); // Min
      });

      it('should handle single branch', () => {
        const conf = createMeasured(0.8);
        const result = deriveParallelAllConfidence([conf], { correlation: 0.5 });
        expect(getNumericValue(result)).toBe(0.8);
      });
    });

    describe('calibration status tracking', () => {
      it('should preserve calibration for measured inputs', () => {
        const conf1 = createMeasured(0.8);
        const conf2 = createMeasured(0.9);

        const result = deriveParallelAllConfidence([conf1, conf2], { correlation: 0.5 });

        if (result.type === 'derived') {
          expect(result.calibrationStatus).toBe('preserved');
        }
      });

      it('should degrade calibration for bounded inputs', () => {
        const measured = createMeasured(0.8);
        const boundedConf: ConfidenceValue = bounded(0.7, 0.9, 'literature', 'test');

        const result = deriveParallelAllConfidence([measured, boundedConf], { correlation: 0.5 });

        if (result.type === 'derived') {
          expect(result.calibrationStatus).toBe('degraded');
        }
      });
    });
  });

  describe('deriveParallelAnyConfidence', () => {
    describe('with correlation = 0 (independent)', () => {
      it('should behave like standard noisy-or formula', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        const result = deriveParallelAnyConfidence([conf1, conf2], { correlation: 0 });

        // 1 - (0.4 * 0.5) = 1 - 0.2 = 0.8
        expect(getNumericValue(result)).toBeCloseTo(0.8);
        if (result.type === 'derived') {
          expect(result.formula).toBe('1 - product(1 - branches)');
        }
      });

      it('should default to independent when no correlation specified', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        const result = deriveParallelAnyConfidence([conf1, conf2]);

        expect(getNumericValue(result)).toBeCloseTo(0.8);
      });
    });

    describe('with correlation = 1 (perfectly correlated)', () => {
      it('should behave like maximum formula', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        const result = deriveParallelAnyConfidence([conf1, conf2], { correlation: 1 });

        expect(getNumericValue(result)).toBe(0.6); // max(0.6, 0.5)
        if (result.type === 'derived') {
          expect(result.formula).toContain('ρ=1.00');
        }
      });

      it('should return max of all branches', () => {
        const confs = [createMeasured(0.5), createMeasured(0.7), createMeasured(0.6)];

        const result = deriveParallelAnyConfidence(confs, { correlation: 1 });

        expect(getNumericValue(result)).toBe(0.7);
      });
    });

    describe('with partial correlation', () => {
      it('should interpolate between noisy-or and max', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        // ρ=0.5: halfway between noisy-or (0.8) and max (0.6)
        const result = deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.5 });
        const value = getNumericValue(result)!;

        // (1 - 0.5) * 0.8 + 0.5 * 0.6 = 0.4 + 0.3 = 0.7
        expect(value).toBeCloseTo(0.7);
        expect(value).toBeLessThan(0.8); // Lower than independent
        expect(value).toBeGreaterThan(0.6); // Higher than perfectly correlated
      });

      it('should decrease monotonically with correlation', () => {
        const conf1 = createMeasured(0.5);
        const conf2 = createMeasured(0.5);

        const r0 = getNumericValue(deriveParallelAnyConfidence([conf1, conf2], { correlation: 0 }))!;
        const r25 = getNumericValue(deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.25 }))!;
        const r50 = getNumericValue(deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.5 }))!;
        const r75 = getNumericValue(deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.75 }))!;
        const r100 = getNumericValue(deriveParallelAnyConfidence([conf1, conf2], { correlation: 1 }))!;

        expect(r25).toBeLessThan(r0);
        expect(r50).toBeLessThan(r25);
        expect(r75).toBeLessThan(r50);
        expect(r100).toBeLessThan(r75);
      });

      it('should include correlation in formula description', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        const result = deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.3 });

        if (result.type === 'derived') {
          expect(result.formula).toContain('correlation_adjusted');
          expect(result.formula).toContain('0.30');
        }
      });
    });

    describe('edge cases', () => {
      it('should return absent for empty branches', () => {
        const result = deriveParallelAnyConfidence([]);
        expect(result.type).toBe('absent');
      });

      it('should compute from present branches with absent inputs (relaxed default, WU-THIMPL-213)', () => {
        // Default behavior changed to 'relaxed' for OR semantics
        const result = deriveParallelAnyConfidence([createMeasured(0.6), absent()]);
        expect(result.type).toBe('derived');
        expect(getNumericValue(result)).toBe(0.6); // Only uses the present branch
      });

      it('should return absent when any branch has absent confidence with strict mode', () => {
        const result = deriveParallelAnyConfidence([createMeasured(0.6), absent()], {
          absentHandling: 'strict',
        });
        expect(result.type).toBe('absent');
      });

      it('should clamp correlation to [0, 1]', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        // Negative correlation should be treated as 0
        const resultNeg = deriveParallelAnyConfidence([conf1, conf2], { correlation: -0.5 });
        expect(getNumericValue(resultNeg)).toBeCloseTo(0.8); // Noisy-or

        // Correlation > 1 should be treated as 1
        const resultHigh = deriveParallelAnyConfidence([conf1, conf2], { correlation: 1.5 });
        expect(getNumericValue(resultHigh)).toBe(0.6); // Max
      });

      it('should handle single branch', () => {
        const conf = createMeasured(0.6);
        const result = deriveParallelAnyConfidence([conf], { correlation: 0.5 });
        expect(getNumericValue(result)).toBe(0.6);
      });
    });

    describe('calibration status tracking', () => {
      it('should preserve calibration for measured inputs', () => {
        const conf1 = createMeasured(0.6);
        const conf2 = createMeasured(0.5);

        const result = deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.5 });

        if (result.type === 'derived') {
          expect(result.calibrationStatus).toBe('preserved');
        }
      });

      it('should degrade calibration for absent inputs', () => {
        // Note: absent inputs return absent result, so this tests bounded
        const measured = createMeasured(0.6);
        const boundedConf: ConfidenceValue = bounded(0.4, 0.6, 'theoretical', 'test');

        const result = deriveParallelAnyConfidence([measured, boundedConf], { correlation: 0.5 });

        if (result.type === 'derived') {
          expect(result.calibrationStatus).toBe('degraded');
        }
      });
    });
  });

  describe('practical scenarios', () => {
    it('should handle LLM retrieval attempts (positively correlated)', () => {
      // Multiple retrieval attempts from the same query context
      // If one fails due to ambiguous query, others likely fail too
      const attempt1 = createMeasured(0.7);
      const attempt2 = createMeasured(0.7);
      const attempt3 = createMeasured(0.7);

      // Independent assumption would give: 1 - (0.3)^3 = 0.973
      const independent = deriveParallelAnyConfidence([attempt1, attempt2, attempt3]);
      expect(getNumericValue(independent)).toBeCloseTo(0.973);

      // With correlation=0.6 (realistic for same-context attempts)
      const correlated = deriveParallelAnyConfidence(
        [attempt1, attempt2, attempt3],
        { correlation: 0.6 }
      );
      // (1-0.6) * 0.973 + 0.6 * 0.7 = 0.389 + 0.42 = 0.809
      expect(getNumericValue(correlated)).toBeCloseTo(0.809, 1);
      expect(getNumericValue(correlated)).toBeLessThan(getNumericValue(independent)!);
    });

    it('should handle verification checks (weakly correlated)', () => {
      // Multiple independent verification approaches
      // Some correlation exists if they use same underlying data
      const typeCheck = createMeasured(0.95);
      const testEvidence = createMeasured(0.85);
      const staticAnalysis = createMeasured(0.90);

      // All must pass
      const independent = deriveParallelAllConfidence([typeCheck, testEvidence, staticAnalysis]);
      // 0.95 * 0.85 * 0.90 = 0.727
      expect(getNumericValue(independent)).toBeCloseTo(0.727, 2);

      // With weak correlation (shared codebase)
      const correlated = deriveParallelAllConfidence(
        [typeCheck, testEvidence, staticAnalysis],
        { correlation: 0.2 }
      );
      // Interpolate between product (0.727) and min (0.85)
      // (1-0.2) * 0.727 + 0.2 * 0.85 = 0.58 + 0.17 = 0.75
      expect(getNumericValue(correlated)).toBeCloseTo(0.752, 1);
    });
  });
});
