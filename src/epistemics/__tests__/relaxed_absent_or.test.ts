/**
 * @fileoverview Tests for Relaxed Absent Propagation in OR Semantics (WU-THIMPL-213)
 *
 * Tests verify that deriveParallelAnyConfidence correctly handles Absent inputs:
 * - In 'relaxed' mode (default): computes result from present branches only
 * - In 'strict' mode: returns Absent if any input is Absent
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  deriveParallelAnyConfidence,
  measuredConfidence,
  deterministic,
  bounded,
  absent,
  getNumericValue,
  type ConfidenceValue,
  type MeasuredConfidence,
  type DerivedConfidence,
} from '../confidence.js';

describe('Relaxed Absent Propagation for OR (WU-THIMPL-213)', () => {
  // Test fixtures
  const createMeasured = (accuracy: number): MeasuredConfidence =>
    measuredConfidence({
      datasetId: `test-${accuracy}`,
      sampleSize: 100,
      accuracy,
      ci95: [accuracy - 0.05, accuracy + 0.05],
    });

  describe('default behavior (relaxed)', () => {
    it('should compute result when all inputs are present', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = createMeasured(0.5);

      const result = deriveParallelAnyConfidence([conf1, conf2]);

      expect(result.type).toBe('derived');
      // 1 - (0.4 * 0.5) = 0.8
      expect(getNumericValue(result)).toBeCloseTo(0.8);
    });

    it('should compute result even with some Absent inputs', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2]);

      // Should use only conf1
      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBeCloseTo(0.6); // Just the one present branch
    });

    it('should compute result with multiple Absent inputs', () => {
      const conf1 = createMeasured(0.7);
      const absentConf1 = absent('uncalibrated');
      const absentConf2 = absent('insufficient_data');

      const result = deriveParallelAnyConfidence([conf1, absentConf1, absentConf2]);

      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBeCloseTo(0.7);
    });

    it('should return Absent when ALL inputs are Absent', () => {
      const result = deriveParallelAnyConfidence([absent(), absent()]);

      expect(result.type).toBe('absent');
      if (result.type === 'absent') {
        expect(result.reason).toBe('uncalibrated');
      }
    });

    it('should include branch count in formula when branches are excluded', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = absent();
      const conf3 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2, conf3]);

      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.formula).toContain('1/3 branches');
      }
    });

    it('should mark calibration as degraded when branches are excluded', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2]);

      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.calibrationStatus).toBe('degraded');
      }
    });

    it('should preserve calibration status when no branches excluded', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = createMeasured(0.5);

      const result = deriveParallelAnyConfidence([conf1, conf2]);

      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.calibrationStatus).toBe('preserved');
      }
    });

    it('should still include all inputs in the inputs array', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2]);

      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        // All inputs should be recorded for provenance
        expect(result.inputs.length).toBe(2);
        expect(result.inputs[1].confidence.type).toBe('absent');
      }
    });
  });

  describe('strict mode', () => {
    it('should return Absent if ANY input is Absent', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2], { absentHandling: 'strict' });

      expect(result.type).toBe('absent');
    });

    it('should compute result when all inputs are present', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = createMeasured(0.5);

      const result = deriveParallelAnyConfidence([conf1, conf2], { absentHandling: 'strict' });

      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBeCloseTo(0.8);
    });

    it('should preserve original behavior for backward compatibility', () => {
      // Original behavior was strict
      const conf1 = createMeasured(0.7);
      const conf2 = createMeasured(0.5);
      const conf3 = absent();

      const strictResult = deriveParallelAnyConfidence([conf1, conf2, conf3], {
        absentHandling: 'strict',
      });

      expect(strictResult.type).toBe('absent');
    });
  });

  describe('interaction with correlation', () => {
    it('should apply correlation to present branches only', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = createMeasured(0.5);
      const conf3 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2, conf3], { correlation: 0.5 });

      expect(result.type).toBe('derived');
      // Should compute noisy-or and max from conf1 and conf2 only
      // noisy-or(0.6, 0.5) = 1 - 0.4 * 0.5 = 0.8
      // max(0.6, 0.5) = 0.6
      // result = 0.5 * 0.8 + 0.5 * 0.6 = 0.7
      expect(getNumericValue(result)).toBeCloseTo(0.7);
    });

    it('should include correlation in formula even with excluded branches', () => {
      const conf1 = createMeasured(0.6);
      const conf2 = absent();

      const result = deriveParallelAnyConfidence([conf1, conf2], { correlation: 0.3 });

      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.formula).toContain('ρ=0.30');
        expect(result.formula).toContain('1/2 branches');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty branches', () => {
      const result = deriveParallelAnyConfidence([]);

      expect(result.type).toBe('absent');
      if (result.type === 'absent') {
        expect(result.reason).toBe('insufficient_data');
      }
    });

    it('should handle single present branch', () => {
      const conf = createMeasured(0.7);

      const result = deriveParallelAnyConfidence([conf]);

      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBe(0.7);
    });

    it('should handle single absent branch', () => {
      const result = deriveParallelAnyConfidence([absent()]);

      expect(result.type).toBe('absent');
    });

    it('should work with bounded confidence', () => {
      const boundedConf: ConfidenceValue = bounded(0.6, 0.8, 'theoretical', 'test');
      const absentConf = absent();

      const result = deriveParallelAnyConfidence([boundedConf, absentConf]);

      expect(result.type).toBe('derived');
      // Bounded uses midpoint (0.7) for computation
      expect(getNumericValue(result)).toBeCloseTo(0.7);
    });

    it('should work with deterministic confidence', () => {
      const detConf = deterministic(true, 'test'); // value = 1.0
      const absentConf = absent();

      const result = deriveParallelAnyConfidence([detConf, absentConf]);

      expect(result.type).toBe('derived');
      expect(getNumericValue(result)).toBe(1.0); // OR with 1.0 = 1.0
    });

    it('should handle mixed confidence types', () => {
      const measured = createMeasured(0.6);
      const det = deterministic(true, 'parse_success');
      const boundedConf: ConfidenceValue = bounded(0.4, 0.6, 'literature', 'ref');
      const absentConf = absent();

      const result = deriveParallelAnyConfidence([measured, det, boundedConf, absentConf]);

      expect(result.type).toBe('derived');
      // With deterministic 1.0 in OR, result should be 1.0
      expect(getNumericValue(result)).toBe(1.0);
    });
  });

  describe('practical scenarios', () => {
    it('should handle retrieval with some uncalibrated sources', () => {
      // Scenario: Multiple retrieval methods, some calibrated, some not
      const vectorSearch = createMeasured(0.7); // Calibrated
      const keywordSearch = createMeasured(0.5); // Calibrated
      const graphTraversal = absent('uncalibrated'); // New method, not calibrated yet

      const result = deriveParallelAnyConfidence([vectorSearch, keywordSearch, graphTraversal]);

      expect(result.type).toBe('derived');
      // Should compute P(any succeeds) from calibrated sources
      // 1 - (0.3 * 0.5) = 0.85
      expect(getNumericValue(result)).toBeCloseTo(0.85);
    });

    it('should handle verification with mixed evidence quality', () => {
      // Scenario: Multiple verification attempts
      const testEvidence = createMeasured(0.9); // Strong evidence
      const humanReview = absent('insufficient_data'); // Reviewer unavailable
      const staticAnalysis = createMeasured(0.7); // Moderate evidence

      const result = deriveParallelAnyConfidence([testEvidence, humanReview, staticAnalysis]);

      expect(result.type).toBe('derived');
      // 1 - (0.1 * 0.3) = 0.97
      expect(getNumericValue(result)).toBeCloseTo(0.97);
    });

    it('should degrade gracefully as more sources become unavailable', () => {
      const source1 = createMeasured(0.6);
      const source2 = createMeasured(0.6);
      const source3 = createMeasured(0.6);

      // All sources available
      const allAvailable = deriveParallelAnyConfidence([source1, source2, source3]);
      // 1 - (0.4)^3 = 0.936
      expect(getNumericValue(allAvailable)).toBeCloseTo(0.936);

      // Two sources available
      const twoAvailable = deriveParallelAnyConfidence([source1, source2, absent()]);
      // 1 - (0.4)^2 = 0.84
      expect(getNumericValue(twoAvailable)).toBeCloseTo(0.84);

      // One source available
      const oneAvailable = deriveParallelAnyConfidence([source1, absent(), absent()]);
      expect(getNumericValue(oneAvailable)).toBeCloseTo(0.6);

      // Confidence degrades as sources become unavailable
      expect(getNumericValue(allAvailable)!).toBeGreaterThan(getNumericValue(twoAvailable)!);
      expect(getNumericValue(twoAvailable)!).toBeGreaterThan(getNumericValue(oneAvailable)!);
    });
  });

  describe('rationale for relaxed default', () => {
    it('demonstrates why relaxed is appropriate for OR', () => {
      // OR semantics: "at least one succeeds"
      // If we know P(A succeeds) = 0.6, then P(at least one succeeds) >= 0.6
      // Adding unknown branches can only increase this probability
      // So computing from known branches gives a valid lower bound

      const knownGood = createMeasured(0.8);
      const unknown = absent();

      const result = deriveParallelAnyConfidence([knownGood, unknown]);

      expect(result.type).toBe('derived');
      // We know at least 0.8 chance of success (from known branch)
      // True probability could be higher if unknown branch also succeeds
      expect(getNumericValue(result)).toBe(0.8);

      // This is a CONSERVATIVE estimate - we're not overestimating
      // If the unknown branch had confidence 0.5, true result would be:
      // 1 - (0.2 * 0.5) = 0.9 > 0.8
    });

    it('contrasts with AND where strict makes sense', () => {
      // For AND semantics, if ANY branch has unknown confidence,
      // we can't compute P(all succeed) - the unknown could be 0
      // This is why parallelAllConfidence uses strict handling

      // For OR, unknown branches make our estimate more conservative
      // For AND, unknown branches make our estimate meaningless
    });
  });
});
