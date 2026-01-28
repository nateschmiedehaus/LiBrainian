/**
 * @fileoverview Tests for HealthDashboard
 *
 * Tests the health monitoring and aggregation system.
 * Implements WU-SELF-304.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HealthDashboard,
  type ComponentHealth,
  type HealthMetrics,
  type HealthSnapshot,
  type HealthAlert,
  type HealthTrend,
} from '../health_dashboard.js';

describe('HealthDashboard', () => {
  let dashboard: HealthDashboard;

  beforeEach(() => {
    dashboard = new HealthDashboard();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // CONSTRUCTION AND INITIALIZATION
  // ==========================================================================

  describe('construction', () => {
    it('creates a dashboard with empty state', () => {
      expect(dashboard).toBeInstanceOf(HealthDashboard);
    });

    it('initializes with configurable options', () => {
      const customDashboard = new HealthDashboard({
        historyRetentionHours: 48,
        snapshotIntervalMs: 30000,
      });
      expect(customDashboard).toBeInstanceOf(HealthDashboard);
    });
  });

  // ==========================================================================
  // COMPONENT REGISTRATION
  // ==========================================================================

  describe('registerComponent', () => {
    it('registers a component with a health check function', () => {
      const healthCheck = vi.fn().mockResolvedValue({
        name: 'test-component',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('test-component', healthCheck);

      expect(dashboard.getRegisteredComponents()).toContain('test-component');
    });

    it('overwrites existing component with same name', () => {
      const healthCheck1 = vi.fn().mockResolvedValue({
        name: 'component',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });
      const healthCheck2 = vi.fn().mockResolvedValue({
        name: 'component',
        status: 'degraded',
        score: 50,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('component', healthCheck1);
      dashboard.registerComponent('component', healthCheck2);

      expect(dashboard.getRegisteredComponents().filter((c) => c === 'component')).toHaveLength(1);
    });

    it('allows registering multiple different components', () => {
      const healthCheck = vi.fn().mockResolvedValue({
        name: 'component',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('component-a', healthCheck);
      dashboard.registerComponent('component-b', healthCheck);
      dashboard.registerComponent('component-c', healthCheck);

      expect(dashboard.getRegisteredComponents()).toHaveLength(3);
    });

    it('unregisters a component', () => {
      const healthCheck = vi.fn().mockResolvedValue({
        name: 'component',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('component', healthCheck);
      dashboard.unregisterComponent('component');

      expect(dashboard.getRegisteredComponents()).not.toContain('component');
    });
  });

  // ==========================================================================
  // SNAPSHOT TAKING
  // ==========================================================================

  describe('takeSnapshot', () => {
    it('returns a valid snapshot structure', async () => {
      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('overallStatus');
      expect(snapshot).toHaveProperty('overallScore');
      expect(snapshot).toHaveProperty('components');
      expect(snapshot).toHaveProperty('metrics');
      expect(snapshot).toHaveProperty('alerts');
      expect(snapshot.timestamp).toBeInstanceOf(Date);
    });

    it('calls registered health check functions', async () => {
      const healthCheck = vi.fn().mockResolvedValue({
        name: 'test-component',
        status: 'healthy',
        score: 95,
        lastChecked: new Date(),
        details: { uptime: 99.9 },
      });

      dashboard.registerComponent('test-component', healthCheck);
      await dashboard.takeSnapshot();

      expect(healthCheck).toHaveBeenCalled();
    });

    it('aggregates results from multiple components', async () => {
      const healthyCheck = vi.fn().mockResolvedValue({
        name: 'healthy-component',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });
      const degradedCheck = vi.fn().mockResolvedValue({
        name: 'degraded-component',
        status: 'degraded',
        score: 60,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('healthy-component', healthyCheck);
      dashboard.registerComponent('degraded-component', degradedCheck);

      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.components).toHaveLength(2);
    });

    it('handles component health check failures gracefully', async () => {
      const failingCheck = vi.fn().mockRejectedValue(new Error('Health check failed'));

      dashboard.registerComponent('failing-component', failingCheck);

      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.components).toHaveLength(1);
      expect(snapshot.components[0].status).toBe('unhealthy');
      expect(snapshot.components[0].score).toBe(0);
    });

    it('stores snapshot in history', async () => {
      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();

      const history = dashboard.getHistory(1);

      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // OVERALL SCORE COMPUTATION
  // ==========================================================================

  describe('computeOverallScore', () => {
    it('returns 100 for all healthy components', () => {
      const components: ComponentHealth[] = [
        { name: 'a', status: 'healthy', score: 100, lastChecked: new Date(), details: {} },
        { name: 'b', status: 'healthy', score: 100, lastChecked: new Date(), details: {} },
      ];

      const score = dashboard.computeOverallScore(components);

      expect(score).toBe(100);
    });

    it('returns weighted average of component scores', () => {
      const components: ComponentHealth[] = [
        { name: 'a', status: 'healthy', score: 100, lastChecked: new Date(), details: {} },
        { name: 'b', status: 'degraded', score: 50, lastChecked: new Date(), details: {} },
      ];

      const score = dashboard.computeOverallScore(components);

      expect(score).toBe(75);
    });

    it('returns 0 for empty components array', () => {
      const score = dashboard.computeOverallScore([]);

      expect(score).toBe(0);
    });

    it('returns 0 for all unhealthy components', () => {
      const components: ComponentHealth[] = [
        { name: 'a', status: 'unhealthy', score: 0, lastChecked: new Date(), details: {} },
        { name: 'b', status: 'unhealthy', score: 0, lastChecked: new Date(), details: {} },
      ];

      const score = dashboard.computeOverallScore(components);

      expect(score).toBe(0);
    });

    it('handles components with mixed scores', () => {
      const components: ComponentHealth[] = [
        { name: 'a', status: 'healthy', score: 90, lastChecked: new Date(), details: {} },
        { name: 'b', status: 'degraded', score: 60, lastChecked: new Date(), details: {} },
        { name: 'c', status: 'unhealthy', score: 20, lastChecked: new Date(), details: {} },
      ];

      const score = dashboard.computeOverallScore(components);

      // (90 + 60 + 20) / 3 = 56.67
      expect(score).toBeCloseTo(56.67, 1);
    });
  });

  // ==========================================================================
  // OVERALL STATUS DETERMINATION
  // ==========================================================================

  describe('overall status determination', () => {
    it('returns healthy when all components are healthy', async () => {
      const healthyCheck = vi.fn().mockResolvedValue({
        name: 'component',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('component', healthyCheck);
      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.overallStatus).toBe('healthy');
    });

    it('returns degraded when any component is degraded', async () => {
      const healthyCheck = vi.fn().mockResolvedValue({
        name: 'healthy',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });
      const degradedCheck = vi.fn().mockResolvedValue({
        name: 'degraded',
        status: 'degraded',
        score: 60,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('healthy', healthyCheck);
      dashboard.registerComponent('degraded', degradedCheck);
      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.overallStatus).toBe('degraded');
    });

    it('returns unhealthy when any component is unhealthy', async () => {
      const healthyCheck = vi.fn().mockResolvedValue({
        name: 'healthy',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });
      const unhealthyCheck = vi.fn().mockResolvedValue({
        name: 'unhealthy',
        status: 'unhealthy',
        score: 0,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('healthy', healthyCheck);
      dashboard.registerComponent('unhealthy', unhealthyCheck);
      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.overallStatus).toBe('unhealthy');
    });
  });

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  describe('getHistory', () => {
    it('returns empty array when no snapshots taken', () => {
      const history = dashboard.getHistory(1);

      expect(history).toEqual([]);
    });

    it('returns snapshots within time range', async () => {
      vi.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      await dashboard.takeSnapshot();

      // Advance 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);
      await dashboard.takeSnapshot();

      // Advance another 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);
      await dashboard.takeSnapshot();

      const history = dashboard.getHistory(1);

      expect(history.length).toBe(3);
    });

    it('filters out snapshots older than specified hours', async () => {
      vi.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);

      await dashboard.takeSnapshot();

      // Advance 3 hours
      vi.advanceTimersByTime(3 * 60 * 60 * 1000);
      await dashboard.takeSnapshot();

      const history = dashboard.getHistory(1);

      // Only the snapshot from last hour should be included
      expect(history.length).toBe(1);
    });

    it('returns snapshots ordered by timestamp (newest first)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      await dashboard.takeSnapshot();

      const history = dashboard.getHistory(1);

      for (let i = 0; i < history.length - 1; i++) {
        expect(history[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          history[i + 1].timestamp.getTime()
        );
      }
    });
  });

  // ==========================================================================
  // TRENDS
  // ==========================================================================

  describe('getTrends', () => {
    it('returns empty array when no history', () => {
      const trends = dashboard.getTrends(['calibrationECE']);

      expect(trends).toEqual([]);
    });

    it('returns trends for specified metrics', async () => {
      // Set up metrics by taking multiple snapshots
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });

      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();

      const trends = dashboard.getTrends(['calibrationECE', 'freshnessScore']);

      expect(trends).toHaveLength(2);
      expect(trends.map((t) => t.metric)).toContain('calibrationECE');
      expect(trends.map((t) => t.metric)).toContain('freshnessScore');
    });

    it('calculates trend direction correctly - improving', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      // Improving ECE (lower is better)
      dashboard.setMetrics({
        calibrationECE: 0.10,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      dashboard.setMetrics({
        calibrationECE: 0.07,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      dashboard.setMetrics({
        calibrationECE: 0.03,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      const trends = dashboard.getTrends(['calibrationECE']);

      expect(trends[0].trend).toBe('improving');
    });

    it('calculates trend direction correctly - degrading', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      // Degrading coverage (higher is better, going down is bad)
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 90,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 75,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 60,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      const trends = dashboard.getTrends(['coveragePercent']);

      expect(trends[0].trend).toBe('degrading');
    });

    it('calculates trend direction correctly - stable', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      // Stable metrics
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      await dashboard.takeSnapshot();

      const trends = dashboard.getTrends(['consistencyScore']);

      expect(trends[0].trend).toBe('stable');
    });

    it('includes data points in trend', async () => {
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });

      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();

      const trends = dashboard.getTrends(['freshnessScore']);

      expect(trends[0].dataPoints.length).toBeGreaterThanOrEqual(3);
      expect(trends[0].dataPoints[0]).toHaveProperty('timestamp');
      expect(trends[0].dataPoints[0]).toHaveProperty('value');
    });

    it('calculates change rate', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 80,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      vi.advanceTimersByTime(10 * 60 * 1000);
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 90,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });
      await dashboard.takeSnapshot();

      const trends = dashboard.getTrends(['freshnessScore']);

      expect(typeof trends[0].changeRate).toBe('number');
    });
  });

  // ==========================================================================
  // ALERTS
  // ==========================================================================

  describe('addAlert', () => {
    it('adds an alert to the dashboard', () => {
      const alert: HealthAlert = {
        severity: 'warning',
        component: 'test-component',
        message: 'Test alert message',
        timestamp: new Date(),
      };

      dashboard.addAlert(alert);

      const alerts = dashboard.getAlerts();
      expect(alerts).toContainEqual(alert);
    });

    it('maintains alert history', () => {
      dashboard.addAlert({
        severity: 'info',
        component: 'component-a',
        message: 'Info message',
        timestamp: new Date(),
      });
      dashboard.addAlert({
        severity: 'warning',
        component: 'component-b',
        message: 'Warning message',
        timestamp: new Date(),
      });
      dashboard.addAlert({
        severity: 'critical',
        component: 'component-c',
        message: 'Critical message',
        timestamp: new Date(),
      });

      const alerts = dashboard.getAlerts();
      expect(alerts).toHaveLength(3);
    });

    it('includes active alerts in snapshot', async () => {
      dashboard.addAlert({
        severity: 'warning',
        component: 'test',
        message: 'Test alert',
        timestamp: new Date(),
      });

      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.alerts).toHaveLength(1);
    });

    it('filters alerts by severity', () => {
      dashboard.addAlert({
        severity: 'info',
        component: 'a',
        message: 'Info',
        timestamp: new Date(),
      });
      dashboard.addAlert({
        severity: 'warning',
        component: 'b',
        message: 'Warning',
        timestamp: new Date(),
      });
      dashboard.addAlert({
        severity: 'critical',
        component: 'c',
        message: 'Critical',
        timestamp: new Date(),
      });

      const criticalAlerts = dashboard.getAlerts('critical');
      expect(criticalAlerts).toHaveLength(1);
      expect(criticalAlerts[0].severity).toBe('critical');
    });

    it('clears resolved alerts', () => {
      dashboard.addAlert({
        severity: 'warning',
        component: 'test',
        message: 'Test alert',
        timestamp: new Date(),
      });

      dashboard.clearAlerts('test');

      const alerts = dashboard.getAlerts();
      expect(alerts.filter((a) => a.component === 'test')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // METRICS
  // ==========================================================================

  describe('metrics', () => {
    it('includes default metrics in snapshot', async () => {
      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.metrics).toHaveProperty('calibrationECE');
      expect(snapshot.metrics).toHaveProperty('calibrationBrier');
      expect(snapshot.metrics).toHaveProperty('freshnessScore');
      expect(snapshot.metrics).toHaveProperty('consistencyScore');
      expect(snapshot.metrics).toHaveProperty('coveragePercent');
      expect(snapshot.metrics).toHaveProperty('errorRate');
    });

    it('allows setting metrics externally', async () => {
      dashboard.setMetrics({
        calibrationECE: 0.03,
        calibrationBrier: 0.08,
        freshnessScore: 98,
        consistencyScore: 95,
        coveragePercent: 85,
        errorRate: 0.005,
      });

      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.metrics.calibrationECE).toBe(0.03);
      expect(snapshot.metrics.freshnessScore).toBe(98);
    });

    it('allows partial metric updates', async () => {
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });

      dashboard.updateMetrics({ calibrationECE: 0.02 });

      const snapshot = await dashboard.takeSnapshot();

      expect(snapshot.metrics.calibrationECE).toBe(0.02);
      expect(snapshot.metrics.freshnessScore).toBe(95); // unchanged
    });
  });

  // ==========================================================================
  // VISUALIZATION DATA
  // ==========================================================================

  describe('visualization data', () => {
    it('generates chart-ready data for component scores', async () => {
      const healthCheck = vi.fn().mockResolvedValue({
        name: 'component',
        status: 'healthy',
        score: 85,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('component', healthCheck);
      await dashboard.takeSnapshot();

      const chartData = dashboard.getComponentChartData();

      expect(chartData).toHaveProperty('labels');
      expect(chartData).toHaveProperty('values');
      expect(chartData.labels).toContain('component');
    });

    it('generates time-series data for metrics', async () => {
      dashboard.setMetrics({
        calibrationECE: 0.05,
        calibrationBrier: 0.1,
        freshnessScore: 95,
        consistencyScore: 90,
        coveragePercent: 80,
        errorRate: 0.01,
      });

      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();
      await dashboard.takeSnapshot();

      const timeSeriesData = dashboard.getMetricsTimeSeries('calibrationECE');

      expect(timeSeriesData).toHaveProperty('timestamps');
      expect(timeSeriesData).toHaveProperty('values');
      expect(timeSeriesData.values.length).toBeGreaterThanOrEqual(3);
    });

    it('generates status summary for dashboard display', async () => {
      const healthyCheck = vi.fn().mockResolvedValue({
        name: 'healthy',
        status: 'healthy',
        score: 100,
        lastChecked: new Date(),
        details: {},
      });
      const degradedCheck = vi.fn().mockResolvedValue({
        name: 'degraded',
        status: 'degraded',
        score: 60,
        lastChecked: new Date(),
        details: {},
      });

      dashboard.registerComponent('healthy', healthyCheck);
      dashboard.registerComponent('degraded', degradedCheck);
      await dashboard.takeSnapshot();

      const summary = dashboard.getStatusSummary();

      expect(summary).toHaveProperty('healthyCount');
      expect(summary).toHaveProperty('degradedCount');
      expect(summary).toHaveProperty('unhealthyCount');
      expect(summary.healthyCount).toBe(1);
      expect(summary.degradedCount).toBe(1);
    });
  });
});
