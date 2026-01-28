/**
 * @fileoverview Tests for Calibration Status Tracking (WU-THIMPL-101)
 *
 * Tests cover:
 * - CalibrationStatus type and computeCalibrationStatus function
 * - deriveSequentialConfidence with calibration tracking
 * - deriveParallelConfidence with calibration tracking
 * - Edge cases: empty inputs, mixed inputs, nested derived values
 */

import { describe, it, expect } from 'vitest';
import {
  computeCalibrationStatus,
  deriveSequentialConfidence,
  deriveParallelConfidence,
  deterministic,
  measuredConfidence,
  bounded,
  absent,
  type ConfidenceValue,
  type DerivedConfidence,
  type CalibrationStatus,
} from '../confidence.js';

describe('Calibration Status Tracking (WU-THIMPL-101)', () => {
  // Test fixtures
  const deterministicTrue = deterministic(true, 'test_true');
  const deterministicFalse = deterministic(false, 'test_false');

  const measured = measuredConfidence({
    datasetId: 'test-dataset',
    sampleSize: 100,
    accuracy: 0.85,
    ci95: [0.80, 0.90],
  });

  const boundedValue = bounded(0.6, 0.8, 'literature', 'Test citation');

  const absentValue = absent('uncalibrated');

  describe('computeCalibrationStatus', () => {
    it('should return "unknown" for empty inputs', () => {
      expect(computeCalibrationStatus([])).toBe('unknown');
    });

    it('should return "preserved" for all deterministic inputs', () => {
      const result = computeCalibrationStatus([deterministicTrue, deterministicFalse]);
      expect(result).toBe('preserved');
    });

    it('should return "preserved" for all measured inputs', () => {
      const result = computeCalibrationStatus([measured, measured]);
      expect(result).toBe('preserved');
    });

    it('should return "preserved" for mixed deterministic and measured inputs', () => {
      const result = computeCalibrationStatus([deterministicTrue, measured]);
      expect(result).toBe('preserved');
    });

    it('should return "degraded" for bounded inputs', () => {
      const result = computeCalibrationStatus([boundedValue]);
      expect(result).toBe('degraded');
    });

    it('should return "degraded" for absent inputs', () => {
      const result = computeCalibrationStatus([absentValue]);
      expect(result).toBe('degraded');
    });

    it('should return "degraded" when mixing calibrated and bounded inputs', () => {
      const result = computeCalibrationStatus([measured, boundedValue]);
      expect(result).toBe('degraded');
    });

    it('should return "degraded" when mixing calibrated and absent inputs', () => {
      const result = computeCalibrationStatus([deterministicTrue, absentValue]);
      expect(result).toBe('degraded');
    });

    it('should preserve calibration through derived values with preserved status', () => {
      const derived: DerivedConfidence = {
        type: 'derived',
        value: 0.8,
        formula: 'min(a, b)',
        inputs: [
          { name: 'a', confidence: measured },
          { name: 'b', confidence: deterministicTrue },
        ],
        calibrationStatus: 'preserved',
      };

      const result = computeCalibrationStatus([derived, measured]);
      expect(result).toBe('preserved');
    });

    it('should degrade calibration through derived values with degraded status', () => {
      const derived: DerivedConfidence = {
        type: 'derived',
        value: 0.8,
        formula: 'min(a, b)',
        inputs: [
          { name: 'a', confidence: boundedValue },
          { name: 'b', confidence: deterministicTrue },
        ],
        calibrationStatus: 'degraded',
      };

      const result = computeCalibrationStatus([derived, measured]);
      expect(result).toBe('degraded');
    });

    it('should degrade calibration through derived values with unknown status', () => {
      const derived: DerivedConfidence = {
        type: 'derived',
        value: 0.8,
        formula: 'min(a, b)',
        inputs: [
          { name: 'a', confidence: measured },
          { name: 'b', confidence: measured },
        ],
        calibrationStatus: 'unknown',
      };

      const result = computeCalibrationStatus([derived, measured]);
      expect(result).toBe('degraded');
    });

    it('should degrade calibration through derived values with undefined status', () => {
      const derived: DerivedConfidence = {
        type: 'derived',
        value: 0.8,
        formula: 'min(a, b)',
        inputs: [
          { name: 'a', confidence: measured },
          { name: 'b', confidence: measured },
        ],
        // calibrationStatus not set (undefined)
      };

      const result = computeCalibrationStatus([derived, measured]);
      expect(result).toBe('degraded');
    });
  });

  describe('deriveSequentialConfidence', () => {
    it('should return absent for empty steps', () => {
      const result = deriveSequentialConfidence([]);
      expect(result.type).toBe('absent');
      if (result.type === 'absent') {
        expect(result.reason).toBe('insufficient_data');
      }
    });

    it('should return absent when any step has absent confidence', () => {
      const result = deriveSequentialConfidence([measured, absentValue]);
      expect(result.type).toBe('absent');
      if (result.type === 'absent') {
        expect(result.reason).toBe('uncalibrated');
      }
    });

    it('should compute min value with preserved calibration for calibrated inputs', () => {
      const result = deriveSequentialConfidence([deterministicTrue, measured]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBe(0.85); // min(1.0, 0.85)
        expect(result.formula).toBe('min(steps)');
        expect(result.calibrationStatus).toBe('preserved');
        expect(result.inputs.length).toBe(2);
      }
    });

    it('should compute min value with degraded calibration for bounded inputs', () => {
      const result = deriveSequentialConfidence([measured, boundedValue]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBe(0.7); // min(0.85, 0.7) - midpoint of bounded
        expect(result.calibrationStatus).toBe('degraded');
      }
    });

    it('should handle single deterministic input', () => {
      const result = deriveSequentialConfidence([deterministicTrue]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBe(1.0);
        expect(result.calibrationStatus).toBe('preserved');
      }
    });

    it('should take minimum of multiple measured values', () => {
      const measured1 = measuredConfidence({
        datasetId: 'test-1',
        sampleSize: 100,
        accuracy: 0.9,
        ci95: [0.85, 0.95],
      });
      const measured2 = measuredConfidence({
        datasetId: 'test-2',
        sampleSize: 100,
        accuracy: 0.75,
        ci95: [0.70, 0.80],
      });

      const result = deriveSequentialConfidence([measured1, measured2]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBe(0.75);
        expect(result.calibrationStatus).toBe('preserved');
      }
    });
  });

  describe('deriveParallelConfidence', () => {
    it('should return absent for empty branches', () => {
      const result = deriveParallelConfidence([]);
      expect(result.type).toBe('absent');
      if (result.type === 'absent') {
        expect(result.reason).toBe('insufficient_data');
      }
    });

    it('should return absent when any branch has absent confidence', () => {
      const result = deriveParallelConfidence([measured, absentValue]);
      expect(result.type).toBe('absent');
      if (result.type === 'absent') {
        expect(result.reason).toBe('uncalibrated');
      }
    });

    it('should compute product with preserved calibration for calibrated inputs', () => {
      const measured1 = measuredConfidence({
        datasetId: 'test-1',
        sampleSize: 100,
        accuracy: 0.8,
        ci95: [0.75, 0.85],
      });
      const measured2 = measuredConfidence({
        datasetId: 'test-2',
        sampleSize: 100,
        accuracy: 0.9,
        ci95: [0.85, 0.95],
      });

      const result = deriveParallelConfidence([measured1, measured2]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBeCloseTo(0.72); // 0.8 * 0.9
        expect(result.formula).toBe('product(branches)');
        expect(result.calibrationStatus).toBe('preserved');
        expect(result.inputs.length).toBe(2);
      }
    });

    it('should compute product with degraded calibration for bounded inputs', () => {
      const result = deriveParallelConfidence([measured, boundedValue]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBeCloseTo(0.595); // 0.85 * 0.7
        expect(result.calibrationStatus).toBe('degraded');
      }
    });

    it('should handle single deterministic input', () => {
      const result = deriveParallelConfidence([deterministicTrue]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBe(1.0);
        expect(result.calibrationStatus).toBe('preserved');
      }
    });

    it('should correctly compute product of multiple values', () => {
      const d1 = deterministic(true, 'test1'); // 1.0
      const m1 = measuredConfidence({
        datasetId: 'test-1',
        sampleSize: 100,
        accuracy: 0.5,
        ci95: [0.45, 0.55],
      }); // 0.5
      const m2 = measuredConfidence({
        datasetId: 'test-2',
        sampleSize: 100,
        accuracy: 0.5,
        ci95: [0.45, 0.55],
      }); // 0.5

      const result = deriveParallelConfidence([d1, m1, m2]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.value).toBeCloseTo(0.25); // 1.0 * 0.5 * 0.5
        expect(result.calibrationStatus).toBe('preserved');
      }
    });
  });

  describe('Nested derivation calibration tracking', () => {
    it('should propagate preserved calibration through nested derivations', () => {
      // First level: sequential with calibrated inputs
      const seq1 = deriveSequentialConfidence([deterministicTrue, measured]);
      expect(seq1.type).toBe('derived');
      if (seq1.type !== 'derived') return;
      expect(seq1.calibrationStatus).toBe('preserved');

      // Second level: parallel with calibrated inputs including the derived
      const result = deriveParallelConfidence([seq1, measured]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.calibrationStatus).toBe('preserved');
      }
    });

    it('should propagate degraded calibration through nested derivations', () => {
      // First level: sequential with bounded (degraded) input
      const seq1 = deriveSequentialConfidence([boundedValue, measured]);
      expect(seq1.type).toBe('derived');
      if (seq1.type !== 'derived') return;
      expect(seq1.calibrationStatus).toBe('degraded');

      // Second level: should inherit the degraded status
      const result = deriveParallelConfidence([seq1, measured]);
      expect(result.type).toBe('derived');
      if (result.type === 'derived') {
        expect(result.calibrationStatus).toBe('degraded');
      }
    });

    it('should handle deeply nested derivations', () => {
      // Level 1
      const level1 = deriveSequentialConfidence([measured, measured]);
      // Level 2
      const level2 = deriveParallelConfidence([level1 as ConfidenceValue, deterministicTrue]);
      // Level 3
      const level3 = deriveSequentialConfidence([level2 as ConfidenceValue, measured]);

      expect(level3.type).toBe('derived');
      if (level3.type === 'derived') {
        expect(level3.calibrationStatus).toBe('preserved');
      }
    });
  });
});
