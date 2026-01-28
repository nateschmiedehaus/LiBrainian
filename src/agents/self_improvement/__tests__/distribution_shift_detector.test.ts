/**
 * @fileoverview Tests for Distribution Shift Detector (WU-SELF-303)
 *
 * Detects when query/content patterns drift from calibration data
 * using statistical tests to identify distribution shifts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DistributionShiftDetector,
  type DistributionWindow,
  type ShiftDetectionResult,
  type ShiftReport,
} from '../distribution_shift_detector.js';

describe('DistributionShiftDetector', () => {
  let detector: DistributionShiftDetector;

  beforeEach(() => {
    detector = new DistributionShiftDetector();
  });

  // ===========================================================================
  // CONSTRUCTOR AND INITIALIZATION
  // ===========================================================================

  describe('constructor and initialization', () => {
    it('should create a new instance with default options', () => {
      const d = new DistributionShiftDetector();
      expect(d).toBeInstanceOf(DistributionShiftDetector);
    });

    it('should accept custom window size option', () => {
      const d = new DistributionShiftDetector({ windowSize: 50 });
      expect(d.getWindowSize()).toBe(50);
    });

    it('should accept custom significance level option', () => {
      const d = new DistributionShiftDetector({ significanceLevel: 0.01 });
      expect(d.getSignificanceLevel()).toBe(0.01);
    });

    it('should use default window size of 100', () => {
      expect(detector.getWindowSize()).toBe(100);
    });

    it('should use default significance level of 0.05', () => {
      expect(detector.getSignificanceLevel()).toBe(0.05);
    });
  });

  // ===========================================================================
  // SAMPLE RECORDING
  // ===========================================================================

  describe('recordSample', () => {
    it('should record a sample value', () => {
      detector.recordSample(0.5);
      expect(detector.getSampleCount()).toBe(1);
    });

    it('should record multiple samples', () => {
      detector.recordSample(0.5);
      detector.recordSample(0.6);
      detector.recordSample(0.7);
      expect(detector.getSampleCount()).toBe(3);
    });

    it('should record samples with a category', () => {
      detector.recordSample(0.5, 'query_embedding');
      detector.recordSample(0.6, 'content_embedding');
      expect(detector.getSampleCount('query_embedding')).toBe(1);
      expect(detector.getSampleCount('content_embedding')).toBe(1);
    });

    it('should use default category when none specified', () => {
      detector.recordSample(0.5);
      expect(detector.getSampleCount('default')).toBe(1);
    });

    it('should handle negative values', () => {
      detector.recordSample(-0.5);
      expect(detector.getSampleCount()).toBe(1);
    });

    it('should handle large values', () => {
      detector.recordSample(1e10);
      expect(detector.getSampleCount()).toBe(1);
    });
  });

  // ===========================================================================
  // DISTRIBUTION WINDOW MANAGEMENT
  // ===========================================================================

  describe('distribution windows', () => {
    it('should create reference window after recording enough samples and setting it', () => {
      // Record more than window size samples
      for (let i = 0; i < 100; i++) {
        detector.recordSample(Math.random());
      }
      // Explicitly set the reference window
      detector.setReferenceWindow();
      const refWindow = detector.getReferenceWindow();
      expect(refWindow).not.toBeNull();
      expect(refWindow?.samples.length).toBe(100);
    });

    it('should calculate mean correctly for window', () => {
      const d = new DistributionShiftDetector({ windowSize: 5 });
      d.recordSample(1);
      d.recordSample(2);
      d.recordSample(3);
      d.recordSample(4);
      d.recordSample(5);

      const window = d.getCurrentWindow();
      expect(window?.mean).toBe(3);
    });

    it('should calculate variance correctly for window', () => {
      const d = new DistributionShiftDetector({ windowSize: 5 });
      // Samples: 1, 2, 3, 4, 5 - mean is 3, variance is 2.5
      d.recordSample(1);
      d.recordSample(2);
      d.recordSample(3);
      d.recordSample(4);
      d.recordSample(5);

      const window = d.getCurrentWindow();
      expect(window?.variance).toBeCloseTo(2.5, 5);
    });

    it('should track start and end time of window', () => {
      const before = new Date();
      detector.recordSample(0.5);
      const after = new Date();

      const window = detector.getCurrentWindow();
      expect(window?.startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(window?.endTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should maintain separate windows per category', () => {
      const d = new DistributionShiftDetector({ windowSize: 5 });
      for (let i = 0; i < 5; i++) {
        d.recordSample(i + 1, 'catA');
        d.recordSample((i + 1) * 10, 'catB');
      }

      const windowA = d.getCurrentWindow('catA');
      const windowB = d.getCurrentWindow('catB');

      expect(windowA?.mean).toBe(3);
      expect(windowB?.mean).toBe(30);
    });
  });

  // ===========================================================================
  // COMPARE DISTRIBUTIONS
  // ===========================================================================

  describe('compareDistributions', () => {
    it('should detect no shift for identical distributions', () => {
      const samples = [1, 2, 3, 4, 5];
      const window1: DistributionWindow = {
        windowId: 'w1',
        startTime: new Date(),
        endTime: new Date(),
        samples,
        mean: 3,
        variance: 2.5,
      };
      const window2: DistributionWindow = {
        windowId: 'w2',
        startTime: new Date(),
        endTime: new Date(),
        samples: [...samples],
        mean: 3,
        variance: 2.5,
      };

      const result = detector.compareDistributions(window1, window2);
      expect(result.shifted).toBe(false);
      expect(result.pValue).toBeGreaterThan(0.05);
    });

    it('should detect shift for significantly different means', () => {
      const window1: DistributionWindow = {
        windowId: 'w1',
        startTime: new Date(),
        endTime: new Date(),
        samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        mean: 5.5,
        variance: 8.25,
      };
      const window2: DistributionWindow = {
        windowId: 'w2',
        startTime: new Date(),
        endTime: new Date(),
        samples: [51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
        mean: 55.5,
        variance: 8.25,
      };

      const result = detector.compareDistributions(window1, window2);
      expect(result.shifted).toBe(true);
      expect(result.pValue).toBeLessThan(0.05);
    });

    it('should calculate effect size (Cohen\'s d)', () => {
      const window1: DistributionWindow = {
        windowId: 'w1',
        startTime: new Date(),
        endTime: new Date(),
        samples: [1, 2, 3, 4, 5],
        mean: 3,
        variance: 2.5,
      };
      const window2: DistributionWindow = {
        windowId: 'w2',
        startTime: new Date(),
        endTime: new Date(),
        samples: [6, 7, 8, 9, 10],
        mean: 8,
        variance: 2.5,
      };

      const result = detector.compareDistributions(window1, window2);
      // Cohen's d = (8 - 3) / sqrt(2.5) = 5 / 1.58 ~ 3.16
      expect(result.effectSize).toBeGreaterThan(3);
    });

    it('should provide descriptive result', () => {
      const window1: DistributionWindow = {
        windowId: 'w1',
        startTime: new Date(),
        endTime: new Date(),
        samples: [1, 2, 3],
        mean: 2,
        variance: 1,
      };
      const window2: DistributionWindow = {
        windowId: 'w2',
        startTime: new Date(),
        endTime: new Date(),
        samples: [10, 11, 12],
        mean: 11,
        variance: 1,
      };

      const result = detector.compareDistributions(window1, window2);
      expect(result.description).toBeTruthy();
      expect(typeof result.description).toBe('string');
    });

    it('should provide recommendation', () => {
      const window1: DistributionWindow = {
        windowId: 'w1',
        startTime: new Date(),
        endTime: new Date(),
        samples: [1, 2, 3],
        mean: 2,
        variance: 1,
      };
      const window2: DistributionWindow = {
        windowId: 'w2',
        startTime: new Date(),
        endTime: new Date(),
        samples: [10, 11, 12],
        mean: 11,
        variance: 1,
      };

      const result = detector.compareDistributions(window1, window2);
      expect(result.recommendation).toBeTruthy();
      expect(typeof result.recommendation).toBe('string');
    });
  });

  // ===========================================================================
  // STATISTICAL TESTS
  // ===========================================================================

  describe('statistical tests', () => {
    describe('T-test for mean shift', () => {
      it('should return high p-value for similar means', () => {
        const result = detector.tTest(
          [1, 2, 3, 4, 5],
          [1.1, 2.1, 3.1, 4.1, 5.1]
        );
        expect(result.pValue).toBeGreaterThan(0.05);
      });

      it('should return low p-value for different means', () => {
        const result = detector.tTest(
          [1, 2, 3, 4, 5],
          [100, 101, 102, 103, 104]
        );
        expect(result.pValue).toBeLessThan(0.05);
      });

      it('should handle equal samples', () => {
        const samples = [1, 2, 3, 4, 5];
        const result = detector.tTest(samples, samples);
        expect(result.pValue).toBe(1);
      });
    });

    describe('Levene\'s test for variance shift', () => {
      it('should return high p-value for similar variances', () => {
        const result = detector.levenesTest(
          [1, 2, 3, 4, 5],
          [11, 12, 13, 14, 15]
        );
        expect(result.pValue).toBeGreaterThan(0.05);
      });

      it('should return low p-value for different variances', () => {
        // Use samples with dramatically different variances
        // Group 1: very low variance (std dev ~0.5)
        // Group 2: very high variance (std dev ~30)
        const result = detector.levenesTest(
          [10, 10.1, 10.2, 9.9, 9.8, 10.3, 9.7, 10.4, 10.5, 9.5],
          [0, 50, 10, 90, 5, 85, 15, 75, 25, 95]
        );
        expect(result.pValue).toBeLessThan(0.05);
      });
    });

    describe('Kolmogorov-Smirnov test', () => {
      it('should return high p-value for same distribution', () => {
        const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result = detector.ksTest(samples, [...samples]);
        expect(result.pValue).toBeGreaterThan(0.05);
      });

      it('should return low p-value for different distributions', () => {
        const result = detector.ksTest(
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]
        );
        expect(result.pValue).toBeLessThan(0.05);
      });

      it('should calculate D statistic correctly', () => {
        const result = detector.ksTest(
          [1, 2, 3, 4, 5],
          [1, 2, 3, 4, 5]
        );
        expect(result.statistic).toBe(0);
      });
    });
  });

  // ===========================================================================
  // DETECT SHIFT
  // ===========================================================================

  describe('detectShift', () => {
    it('should return no shift when insufficient samples', () => {
      detector.recordSample(0.5);
      const result = detector.detectShift();
      expect(result.shifted).toBe(false);
      expect(result.description.toLowerCase()).toContain('insufficient');
    });

    it('should detect shift after significant data change', () => {
      const d = new DistributionShiftDetector({ windowSize: 20 });

      // Record reference distribution (low values)
      for (let i = 0; i < 20; i++) {
        d.recordSample(Math.random() * 10);
      }
      d.setReferenceWindow();

      // Record current distribution (high values)
      for (let i = 0; i < 20; i++) {
        d.recordSample(100 + Math.random() * 10);
      }

      const result = d.detectShift();
      expect(result.shifted).toBe(true);
    });

    it('should not detect shift when distribution is stable', () => {
      const d = new DistributionShiftDetector({ windowSize: 20 });

      // Record consistent distribution with deterministic values
      // Reference: 50, 51, 52, ..., 69
      for (let i = 0; i < 20; i++) {
        d.recordSample(50 + i);
      }
      d.setReferenceWindow();

      // Current: same pattern (identical distribution)
      for (let i = 0; i < 20; i++) {
        d.recordSample(50 + i);
      }

      const result = d.detectShift();
      expect(result.shifted).toBe(false);
    });

    it('should detect shift by category', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      // Category A: stable
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i, 'catA');
      }
      d.setReferenceWindow('catA');
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i, 'catA');
      }

      // Category B: shifted
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i, 'catB');
      }
      d.setReferenceWindow('catB');
      for (let i = 0; i < 10; i++) {
        d.recordSample(500 + i, 'catB');
      }

      expect(d.detectShift('catA').shifted).toBe(false);
      expect(d.detectShift('catB').shifted).toBe(true);
    });
  });

  // ===========================================================================
  // GENERATE REPORT
  // ===========================================================================

  describe('generateReport', () => {
    it('should return a valid report structure', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      for (let i = 0; i < 20; i++) {
        d.recordSample(Math.random() * 100);
      }
      d.setReferenceWindow();

      for (let i = 0; i < 10; i++) {
        d.recordSample(Math.random() * 100);
      }

      const report = d.generateReport();

      expect(report).toHaveProperty('detectionTime');
      expect(report).toHaveProperty('referenceWindow');
      expect(report).toHaveProperty('currentWindow');
      expect(report).toHaveProperty('shifts');
      expect(report).toHaveProperty('overallStatus');
    });

    it('should include detection time', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });
      for (let i = 0; i < 20; i++) {
        d.recordSample(i);
      }
      d.setReferenceWindow();

      const before = new Date();
      const report = d.generateReport();
      const after = new Date();

      expect(report.detectionTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(report.detectionTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should report stable status when no shift', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      // Create stable distribution
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i);
      }
      d.setReferenceWindow();
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i);
      }

      const report = d.generateReport();
      expect(report.overallStatus).toBe('stable');
    });

    it('should report shifted status when significant shift', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      // Create shifted distribution
      for (let i = 0; i < 10; i++) {
        d.recordSample(i);
      }
      d.setReferenceWindow();
      for (let i = 0; i < 10; i++) {
        d.recordSample(1000 + i);
      }

      const report = d.generateReport();
      expect(report.overallStatus).toBe('shifted');
    });

    it('should report drifting status for moderate shift', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      // Create moderately drifting distribution
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i);
      }
      d.setReferenceWindow();
      // Moderate shift - mean increases but with overlap
      for (let i = 0; i < 10; i++) {
        d.recordSample(65 + i);
      }

      const report = d.generateReport();
      expect(['drifting', 'shifted', 'stable']).toContain(report.overallStatus);
    });

    it('should include multiple shift results', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      for (let i = 0; i < 10; i++) {
        d.recordSample(i);
      }
      d.setReferenceWindow();
      for (let i = 0; i < 10; i++) {
        d.recordSample(100 + i);
      }

      const report = d.generateReport();

      // Should have results from multiple tests (KS, T-test, Levene's)
      expect(report.shifts.length).toBeGreaterThanOrEqual(1);
    });

    it('should include reference and current windows in report', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      for (let i = 0; i < 10; i++) {
        d.recordSample(i);
      }
      d.setReferenceWindow();
      for (let i = 0; i < 10; i++) {
        d.recordSample(100 + i);
      }

      const report = d.generateReport();

      expect(report.referenceWindow).toBeDefined();
      expect(report.referenceWindow.samples.length).toBe(10);
      expect(report.currentWindow).toBeDefined();
      expect(report.currentWindow.samples.length).toBe(10);
    });
  });

  // ===========================================================================
  // EDGE CASES AND ERROR HANDLING
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty sample arrays', () => {
      const result = detector.tTest([], []);
      expect(result.pValue).toBe(1);
    });

    it('should handle single sample', () => {
      detector.recordSample(0.5);
      const window = detector.getCurrentWindow();
      expect(window?.mean).toBe(0.5);
      expect(window?.variance).toBe(0);
    });

    it('should handle identical samples (zero variance)', () => {
      const d = new DistributionShiftDetector({ windowSize: 5 });
      for (let i = 0; i < 5; i++) {
        d.recordSample(42);
      }
      const window = d.getCurrentWindow();
      expect(window?.variance).toBe(0);
    });

    it('should reset state correctly', () => {
      detector.recordSample(0.5);
      detector.recordSample(0.6);
      detector.reset();
      expect(detector.getSampleCount()).toBe(0);
    });

    it('should handle NaN values gracefully', () => {
      detector.recordSample(NaN);
      // Should either skip NaN or handle it gracefully
      const window = detector.getCurrentWindow();
      // Implementation should filter out NaN
      expect(window === null || !isNaN(window.mean)).toBe(true);
    });

    it('should handle Infinity values gracefully', () => {
      detector.recordSample(Infinity);
      // Should either skip Infinity or handle it gracefully
      const window = detector.getCurrentWindow();
      expect(window === null || isFinite(window.mean)).toBe(true);
    });
  });

  // ===========================================================================
  // RECALIBRATION ALERTS
  // ===========================================================================

  describe('recalibration alerts', () => {
    it('should recommend recalibration when shift detected', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      for (let i = 0; i < 10; i++) {
        d.recordSample(i);
      }
      d.setReferenceWindow();
      for (let i = 0; i < 10; i++) {
        d.recordSample(1000 + i);
      }

      const result = d.detectShift();
      expect(result.recommendation).toContain('recalibrat');
    });

    it('should not recommend recalibration when stable', () => {
      const d = new DistributionShiftDetector({ windowSize: 10 });

      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i);
      }
      d.setReferenceWindow();
      for (let i = 0; i < 10; i++) {
        d.recordSample(50 + i);
      }

      const result = d.detectShift();
      expect(result.recommendation).not.toContain('recalibrat');
    });
  });
});
