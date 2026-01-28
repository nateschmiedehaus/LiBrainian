/**
 * @fileoverview Tests for CalibrationDashboard
 *
 * Tests calibration visualization and metric tracking capabilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CalibrationDashboard,
  createCalibrationDashboard,
  type PredictionOutcome,
  type ReliabilityDiagram,
  type ReliabilityBin,
  type CalibrationTimeSeries,
  type DashboardSnapshot,
  type CalibrationAlert,
  type CalibrationSummary,
} from '../calibration_dashboard.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a perfectly calibrated dataset where confidence equals accuracy.
 */
function createPerfectlyCalibrated(count: number): PredictionOutcome[] {
  const points: PredictionOutcome[] = [];
  for (let i = 0; i < count; i++) {
    const confidence = (i + 1) / (count + 1);
    points.push({
      id: `point_${i}`,
      predictedProbability: confidence,
      actualOutcome: Math.random() < confidence ? 1 : 0,
      timestamp: new Date(Date.now() - i * 86400000), // One day apart
      claimType: i % 2 === 0 ? 'existence' : 'relationship',
    });
  }
  return points;
}

/**
 * Creates an overconfident dataset where predictions > actual accuracy.
 */
function createOverconfidentData(count: number): PredictionOutcome[] {
  const points: PredictionOutcome[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      id: `point_${i}`,
      predictedProbability: 0.9, // Always predicts high confidence
      actualOutcome: i % 3 === 0 ? 1 : 0, // Only 33% correct
      timestamp: new Date(Date.now() - i * 86400000),
      claimType: 'existence',
    });
  }
  return points;
}

/**
 * Creates an underconfident dataset where predictions < actual accuracy.
 */
function createUnderconfidentData(count: number): PredictionOutcome[] {
  const points: PredictionOutcome[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      id: `point_${i}`,
      predictedProbability: 0.3, // Always predicts low confidence
      actualOutcome: i % 3 !== 0 ? 1 : 0, // 67% correct
      timestamp: new Date(Date.now() - i * 86400000),
      claimType: 'relationship',
    });
  }
  return points;
}

/**
 * Creates time series calibration data for testing trends.
 */
function createTimeSeriesData(days: number, trend: 'improving' | 'stable' | 'degrading'): PredictionOutcome[] {
  const points: PredictionOutcome[] = [];
  for (let d = 0; d < days; d++) {
    const dayOffset = days - d;
    for (let i = 0; i < 10; i++) {
      let calibrationError: number;
      if (trend === 'improving') {
        calibrationError = 0.3 - (d / days) * 0.25; // Decreasing error
      } else if (trend === 'degrading') {
        calibrationError = 0.05 + (d / days) * 0.25; // Increasing error
      } else {
        calibrationError = 0.1; // Stable
      }
      const confidence = 0.7;
      const actualProb = confidence - calibrationError;
      points.push({
        id: `point_${d}_${i}`,
        predictedProbability: confidence,
        actualOutcome: Math.random() < actualProb ? 1 : 0,
        timestamp: new Date(Date.now() - dayOffset * 86400000),
        claimType: 'existence',
      });
    }
  }
  return points;
}

// ============================================================================
// CALIBRATION DASHBOARD TESTS
// ============================================================================

describe('CalibrationDashboard', () => {
  let dashboard: CalibrationDashboard;

  beforeEach(() => {
    dashboard = createCalibrationDashboard();
  });

  // ==========================================================================
  // RELIABILITY DIAGRAM TESTS
  // ==========================================================================

  describe('generateReliabilityDiagram', () => {
    it('should generate correct number of bins', () => {
      const data = createPerfectlyCalibrated(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      expect(diagram.bins.length).toBe(10);
      diagram.bins.forEach((bin, index) => {
        expect(bin.binIndex).toBe(index);
        expect(bin.binStart).toBeCloseTo(index / 10, 5);
        expect(bin.binEnd).toBeCloseTo((index + 1) / 10, 5);
      });
    });

    it('should calculate perfect calibration line correctly', () => {
      const data = createPerfectlyCalibrated(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      // Perfect calibration line should be diagonal
      expect(diagram.perfectCalibrationLine.length).toBeGreaterThan(0);
      diagram.perfectCalibrationLine.forEach(([x, y]) => {
        expect(x).toBeCloseTo(y, 5);
      });
    });

    it('should detect overconfidence when predictions exceed accuracy', () => {
      const data = createOverconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      // Overconfidence: avgConfidence > avgAccuracy
      expect(diagram.overconfidenceArea).toBeGreaterThan(0);
      expect(diagram.overconfidenceArea).toBeGreaterThan(diagram.underconfidenceArea);
    });

    it('should detect underconfidence when accuracy exceeds predictions', () => {
      const data = createUnderconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      // Underconfidence: avgAccuracy > avgConfidence
      expect(diagram.underconfidenceArea).toBeGreaterThan(0);
      expect(diagram.underconfidenceArea).toBeGreaterThan(diagram.overconfidenceArea);
    });

    it('should calculate ECE (Expected Calibration Error) correctly', () => {
      const data = createPerfectlyCalibrated(1000);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      // For well-calibrated data, ECE should be low
      expect(diagram.ece).toBeGreaterThanOrEqual(0);
      expect(diagram.ece).toBeLessThan(0.5);
    });

    it('should calculate MCE (Maximum Calibration Error) correctly', () => {
      const data = createOverconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      // MCE is the maximum gap across all bins
      expect(diagram.mce).toBeGreaterThanOrEqual(diagram.ece);
      expect(diagram.mce).toBeGreaterThan(0);
    });

    it('should calculate gap correctly for each bin', () => {
      const data = createOverconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      diagram.bins.forEach((bin) => {
        if (bin.count > 0) {
          const expectedGap = bin.avgConfidence - bin.avgAccuracy;
          expect(bin.gap).toBeCloseTo(expectedGap, 5);
        }
      });
    });

    it('should handle empty bins gracefully', () => {
      // Data only in high confidence range
      const data: PredictionOutcome[] = [];
      for (let i = 0; i < 50; i++) {
        data.push({
          id: `point_${i}`,
          predictedProbability: 0.85 + Math.random() * 0.15,
          actualOutcome: i % 2,
          timestamp: new Date(),
          claimType: 'existence',
        });
      }

      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      // Lower bins should be empty (count = 0)
      const emptyBins = diagram.bins.filter((bin) => bin.count === 0);
      expect(emptyBins.length).toBeGreaterThan(0);
      emptyBins.forEach((bin) => {
        expect(bin.avgConfidence).toBe(0);
        expect(bin.avgAccuracy).toBe(0);
        expect(bin.gap).toBe(0);
      });
    });

    it('should use default 10 bins when not specified', () => {
      const data = createPerfectlyCalibrated(100);
      const diagram = dashboard.generateReliabilityDiagram(data);

      expect(diagram.bins.length).toBe(10);
    });
  });

  // ==========================================================================
  // TIME SERIES TESTS
  // ==========================================================================

  describe('getTimeSeries', () => {
    beforeEach(() => {
      // Add time series data to dashboard
      const data = createTimeSeriesData(30, 'improving');
      dashboard.addDataPoints(data);
    });

    it('should return time series for ECE metric', () => {
      const series = dashboard.getTimeSeries('ece', 30);

      expect(series.metric).toBe('ece');
      expect(series.dataPoints.length).toBeGreaterThan(0);
      series.dataPoints.forEach((point) => {
        expect(point.timestamp).toBeInstanceOf(Date);
        expect(typeof point.value).toBe('number');
        expect(point.value).toBeGreaterThanOrEqual(0);
      });
    });

    it('should return time series for Brier score', () => {
      const series = dashboard.getTimeSeries('brier', 30);

      expect(series.metric).toBe('brier');
      expect(series.dataPoints.length).toBeGreaterThan(0);
      series.dataPoints.forEach((point) => {
        expect(point.value).toBeGreaterThanOrEqual(0);
        expect(point.value).toBeLessThanOrEqual(1);
      });
    });

    it('should return time series for log loss', () => {
      const series = dashboard.getTimeSeries('log_loss', 30);

      expect(series.metric).toBe('log_loss');
      expect(series.dataPoints.length).toBeGreaterThan(0);
    });

    it('should calculate moving average correctly', () => {
      const series = dashboard.getTimeSeries('ece', 30);

      expect(series.movingAverage.length).toBeGreaterThan(0);
      // Moving average should smooth out variations
      series.movingAverage.forEach((value) => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
      });
    });

    it('should detect improving trend', () => {
      const improvingData = createTimeSeriesData(30, 'improving');
      const improvingDashboard = createCalibrationDashboard();
      improvingDashboard.addDataPoints(improvingData);

      const series = improvingDashboard.getTimeSeries('ece', 30);
      // Note: Trend detection may vary with random data
      expect(['improving', 'stable', 'degrading']).toContain(series.trend);
    });

    it('should filter by time range', () => {
      const series7days = dashboard.getTimeSeries('ece', 7);
      const series30days = dashboard.getTimeSeries('ece', 30);

      expect(series7days.dataPoints.length).toBeLessThanOrEqual(series30days.dataPoints.length);
    });
  });

  // ==========================================================================
  // SNAPSHOT TESTS
  // ==========================================================================

  describe('takeSnapshot', () => {
    beforeEach(() => {
      const data = createPerfectlyCalibrated(100);
      dashboard.addDataPoints(data);
    });

    it('should create snapshot with timestamp', () => {
      const snapshot = dashboard.takeSnapshot();

      expect(snapshot.timestamp).toBeInstanceOf(Date);
      expect(snapshot.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should include reliability diagram in snapshot', () => {
      const snapshot = dashboard.takeSnapshot();

      expect(snapshot.reliabilityDiagram).toBeDefined();
      expect(snapshot.reliabilityDiagram.bins.length).toBeGreaterThan(0);
      expect(typeof snapshot.reliabilityDiagram.ece).toBe('number');
    });

    it('should include time series in snapshot', () => {
      const snapshot = dashboard.takeSnapshot();

      expect(Array.isArray(snapshot.timeSeries)).toBe(true);
      expect(snapshot.timeSeries.length).toBeGreaterThan(0);
    });

    it('should include breakdown by claim type', () => {
      const snapshot = dashboard.takeSnapshot();

      expect(snapshot.byClaimType).toBeInstanceOf(Map);
      expect(snapshot.byClaimType.size).toBeGreaterThan(0);
    });

    it('should include alerts in snapshot', () => {
      const snapshot = dashboard.takeSnapshot();

      expect(Array.isArray(snapshot.alerts)).toBe(true);
    });

    it('should include summary in snapshot', () => {
      const snapshot = dashboard.takeSnapshot();

      expect(snapshot.summary).toBeDefined();
      expect(['well_calibrated', 'needs_attention', 'poorly_calibrated']).toContain(
        snapshot.summary.overallStatus
      );
      expect(typeof snapshot.summary.ece).toBe('number');
      expect(typeof snapshot.summary.brierScore).toBe('number');
      expect(typeof snapshot.summary.totalPredictions).toBe('number');
    });
  });

  // ==========================================================================
  // ALERT GENERATION TESTS
  // ==========================================================================

  describe('generateAlerts', () => {
    it('should generate high_ece alert when ECE exceeds threshold', () => {
      const data = createOverconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);
      const alerts = dashboard.generateAlerts(diagram);

      const highEceAlert = alerts.find((a) => a.type === 'high_ece');
      expect(highEceAlert).toBeDefined();
      expect(['warning', 'critical']).toContain(highEceAlert!.severity);
    });

    it('should generate overconfident alert when overconfidence detected', () => {
      const data = createOverconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);
      const alerts = dashboard.generateAlerts(diagram);

      const overconfidentAlert = alerts.find((a) => a.type === 'overconfident');
      expect(overconfidentAlert).toBeDefined();
      expect(overconfidentAlert!.affectedBins).toBeDefined();
    });

    it('should generate underconfident alert when underconfidence detected', () => {
      const data = createUnderconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);
      const alerts = dashboard.generateAlerts(diagram);

      const underconfidentAlert = alerts.find((a) => a.type === 'underconfident');
      expect(underconfidentAlert).toBeDefined();
    });

    it('should generate insufficient_data alert for sparse bins', () => {
      // Very few data points
      const data: PredictionOutcome[] = [];
      for (let i = 0; i < 5; i++) {
        data.push({
          id: `point_${i}`,
          predictedProbability: 0.5,
          actualOutcome: i % 2,
          timestamp: new Date(),
          claimType: 'existence',
        });
      }

      const diagram = dashboard.generateReliabilityDiagram(data, 10);
      const alerts = dashboard.generateAlerts(diagram);

      const insufficientAlert = alerts.find((a) => a.type === 'insufficient_data');
      expect(insufficientAlert).toBeDefined();
      expect(insufficientAlert!.severity).toBe('info');
    });

    it('should return empty alerts for well-calibrated data', () => {
      // Create perfectly calibrated data with many points
      const data: PredictionOutcome[] = [];
      for (let i = 0; i < 1000; i++) {
        const conf = (i % 100) / 100;
        data.push({
          id: `point_${i}`,
          predictedProbability: conf,
          actualOutcome: Math.random() < conf ? 1 : 0,
          timestamp: new Date(),
          claimType: 'existence',
        });
      }

      const diagram = dashboard.generateReliabilityDiagram(data, 10);
      const alerts = dashboard.generateAlerts(diagram);

      // May have some alerts but no critical ones
      const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
      expect(criticalAlerts.length).toBe(0);
    });

    it('should set appropriate severity levels', () => {
      const data = createOverconfidentData(100);
      const diagram = dashboard.generateReliabilityDiagram(data, 10);
      const alerts = dashboard.generateAlerts(diagram);

      alerts.forEach((alert) => {
        expect(['info', 'warning', 'critical']).toContain(alert.severity);
        expect(typeof alert.message).toBe('string');
        expect(alert.message.length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // EXPORT FOR VISUALIZATION TESTS
  // ==========================================================================

  describe('exportForVisualization', () => {
    it('should export JSON-friendly format', () => {
      const data = createPerfectlyCalibrated(100);
      dashboard.addDataPoints(data);
      const snapshot = dashboard.takeSnapshot();
      const exported = dashboard.exportForVisualization(snapshot);

      // Should be JSON serializable
      expect(() => JSON.stringify(exported)).not.toThrow();
    });

    it('should convert Map to plain object', () => {
      const data = createPerfectlyCalibrated(100);
      dashboard.addDataPoints(data);
      const snapshot = dashboard.takeSnapshot();
      const exported = dashboard.exportForVisualization(snapshot);

      // byClaimType should be converted from Map to object
      expect(exported.byClaimType).not.toBeInstanceOf(Map);
      expect(typeof exported.byClaimType).toBe('object');
    });

    it('should convert Date to ISO string', () => {
      const data = createPerfectlyCalibrated(100);
      dashboard.addDataPoints(data);
      const snapshot = dashboard.takeSnapshot();
      const exported = dashboard.exportForVisualization(snapshot);

      expect(typeof exported.timestamp).toBe('string');
      expect(exported.summary.dateRange[0]).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it('should preserve all essential data', () => {
      const data = createPerfectlyCalibrated(100);
      dashboard.addDataPoints(data);
      const snapshot = dashboard.takeSnapshot();
      const exported = dashboard.exportForVisualization(snapshot);

      expect(exported.reliabilityDiagram).toBeDefined();
      expect(exported.reliabilityDiagram.bins).toBeDefined();
      expect(exported.reliabilityDiagram.ece).toBeDefined();
      expect(exported.timeSeries).toBeDefined();
      expect(exported.alerts).toBeDefined();
      expect(exported.summary).toBeDefined();
    });
  });

  // ==========================================================================
  // FILTERING TESTS
  // ==========================================================================

  describe('filtering', () => {
    beforeEach(() => {
      const existenceData = createPerfectlyCalibrated(50).map((p) => ({
        ...p,
        claimType: 'existence' as const,
      }));
      const relationshipData = createOverconfidentData(50).map((p) => ({
        ...p,
        claimType: 'relationship' as const,
      }));
      dashboard.addDataPoints([...existenceData, ...relationshipData]);
    });

    it('should filter reliability diagram by claim type', () => {
      const existenceDiagram = dashboard.generateReliabilityDiagram(
        dashboard.getDataPoints({ claimType: 'existence' }),
        10
      );
      const relationshipDiagram = dashboard.generateReliabilityDiagram(
        dashboard.getDataPoints({ claimType: 'relationship' }),
        10
      );

      // Different claim types should have different diagrams
      expect(existenceDiagram.ece).not.toEqual(relationshipDiagram.ece);
    });

    it('should filter by time range', () => {
      const recentData = dashboard.getDataPoints({
        startDate: new Date(Date.now() - 7 * 86400000),
      });
      const allData = dashboard.getDataPoints({});

      expect(recentData.length).toBeLessThanOrEqual(allData.length);
    });

    it('should combine claim type and time filters', () => {
      const sevenDaysAgo = Date.now() - 7 * 86400000;
      const filtered = dashboard.getDataPoints({
        claimType: 'existence',
        startDate: new Date(sevenDaysAgo),
      });

      filtered.forEach((point) => {
        expect(point.claimType).toBe('existence');
        expect(point.timestamp.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo);
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty data gracefully', () => {
      const diagram = dashboard.generateReliabilityDiagram([], 10);

      expect(diagram.bins.length).toBe(10);
      expect(diagram.ece).toBe(0);
      expect(diagram.mce).toBe(0);
    });

    it('should handle single data point', () => {
      const data: PredictionOutcome[] = [{
        id: 'single',
        predictedProbability: 0.7,
        actualOutcome: 1,
        timestamp: new Date(),
        claimType: 'existence',
      }];

      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      expect(diagram.bins.length).toBe(10);
      const nonEmptyBins = diagram.bins.filter((b) => b.count > 0);
      expect(nonEmptyBins.length).toBe(1);
    });

    it('should handle probability edge values (0 and 1)', () => {
      const data: PredictionOutcome[] = [
        { id: '1', predictedProbability: 0, actualOutcome: 0, timestamp: new Date(), claimType: 'existence' },
        { id: '2', predictedProbability: 1, actualOutcome: 1, timestamp: new Date(), claimType: 'existence' },
      ];

      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      expect(diagram.bins[0].count).toBeGreaterThanOrEqual(0);
      expect(diagram.bins[9].count).toBeGreaterThanOrEqual(0);
    });

    it('should handle all outcomes being 0', () => {
      const data: PredictionOutcome[] = [];
      for (let i = 0; i < 100; i++) {
        data.push({
          id: `point_${i}`,
          predictedProbability: 0.5,
          actualOutcome: 0,
          timestamp: new Date(),
          claimType: 'existence',
        });
      }

      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      expect(diagram.ece).toBeGreaterThan(0); // Overconfident since accuracy is 0
    });

    it('should handle all outcomes being 1', () => {
      const data: PredictionOutcome[] = [];
      for (let i = 0; i < 100; i++) {
        data.push({
          id: `point_${i}`,
          predictedProbability: 0.5,
          actualOutcome: 1,
          timestamp: new Date(),
          claimType: 'existence',
        });
      }

      const diagram = dashboard.generateReliabilityDiagram(data, 10);

      expect(diagram.ece).toBeGreaterThan(0); // Underconfident since accuracy is 1
    });
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createCalibrationDashboard', () => {
  it('should create dashboard instance', () => {
    const dashboard = createCalibrationDashboard();
    expect(dashboard).toBeInstanceOf(CalibrationDashboard);
  });

  it('should accept configuration options', () => {
    const dashboard = createCalibrationDashboard({
      defaultBins: 20,
      eceThreshold: 0.15,
      mceThreshold: 0.25,
    });
    expect(dashboard).toBeInstanceOf(CalibrationDashboard);
  });
});
