/**
 * @fileoverview Health Dashboard for System Health Monitoring
 *
 * Aggregates health metrics from all system components, provides real-time
 * status reporting, generates visualization-ready data structures, and
 * tracks historical health trends.
 *
 * Implements WU-SELF-304.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Health status of a component.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Severity level for health alerts.
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Trend direction for metrics.
 */
export type TrendDirection = 'improving' | 'stable' | 'degrading';

/**
 * Health state of a single component.
 */
export interface ComponentHealth {
  /** Name of the component */
  name: string;
  /** Current health status */
  status: HealthStatus;
  /** Numeric health score (0-100) */
  score: number;
  /** When this component was last checked */
  lastChecked: Date;
  /** Additional component-specific details */
  details: Record<string, unknown>;
}

/**
 * System-wide health metrics.
 */
export interface HealthMetrics {
  /** Expected Calibration Error */
  calibrationECE: number;
  /** Brier score for calibration */
  calibrationBrier: number;
  /** Index freshness score (0-100) */
  freshnessScore: number;
  /** Consistency score (0-100) */
  consistencyScore: number;
  /** Coverage percentage (0-100) */
  coveragePercent: number;
  /** Error rate (0-1) */
  errorRate: number;
}

/**
 * A snapshot of system health at a point in time.
 */
export interface HealthSnapshot {
  /** When this snapshot was taken */
  timestamp: Date;
  /** Overall system status */
  overallStatus: HealthStatus;
  /** Overall health score (0-100) */
  overallScore: number;
  /** Health status of all components */
  components: ComponentHealth[];
  /** Current metrics */
  metrics: HealthMetrics;
  /** Active alerts */
  alerts: HealthAlert[];
}

/**
 * A health alert.
 */
export interface HealthAlert {
  /** Severity of the alert */
  severity: AlertSeverity;
  /** Component that generated the alert */
  component: string;
  /** Alert message */
  message: string;
  /** When the alert was generated */
  timestamp: Date;
}

/**
 * Trend data for a specific metric.
 */
export interface HealthTrend {
  /** Metric name */
  metric: string;
  /** Historical data points */
  dataPoints: { timestamp: Date; value: number }[];
  /** Trend direction */
  trend: TrendDirection;
  /** Rate of change (per hour) */
  changeRate: number;
}

/**
 * Options for creating a HealthDashboard.
 */
export interface HealthDashboardOptions {
  /** How many hours of history to retain */
  historyRetentionHours?: number;
  /** Interval between automatic snapshots (ms) */
  snapshotIntervalMs?: number;
}

/**
 * Chart data for component visualization.
 */
export interface ComponentChartData {
  /** Component names */
  labels: string[];
  /** Component scores */
  values: number[];
}

/**
 * Time series data for metric visualization.
 */
export interface MetricsTimeSeries {
  /** Timestamps */
  timestamps: Date[];
  /** Metric values */
  values: number[];
}

/**
 * Status summary for dashboard display.
 */
export interface StatusSummary {
  /** Number of healthy components */
  healthyCount: number;
  /** Number of degraded components */
  degradedCount: number;
  /** Number of unhealthy components */
  unhealthyCount: number;
  /** Total components */
  totalCount: number;
}

/**
 * Health check function type.
 */
export type HealthCheckFn = () => Promise<ComponentHealth>;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_HISTORY_RETENTION_HOURS = 24;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 60000; // 1 minute

/**
 * Metrics where lower values indicate better health.
 */
const LOWER_IS_BETTER_METRICS = new Set([
  'calibrationECE',
  'calibrationBrier',
  'errorRate',
]);

/**
 * Default metrics values.
 */
const DEFAULT_METRICS: HealthMetrics = {
  calibrationECE: 0,
  calibrationBrier: 0,
  freshnessScore: 100,
  consistencyScore: 100,
  coveragePercent: 0,
  errorRate: 0,
};

// ============================================================================
// HEALTH DASHBOARD CLASS
// ============================================================================

/**
 * HealthDashboard provides system-wide health monitoring and reporting.
 *
 * Features:
 * - Register and monitor multiple components
 * - Take periodic health snapshots
 * - Track historical health trends
 * - Generate alerts based on health status
 * - Provide visualization-ready data
 *
 * @example
 * ```typescript
 * const dashboard = new HealthDashboard();
 *
 * // Register components
 * dashboard.registerComponent('indexer', async () => ({
 *   name: 'indexer',
 *   status: 'healthy',
 *   score: 95,
 *   lastChecked: new Date(),
 *   details: { documentsIndexed: 1000 },
 * }));
 *
 * // Take a snapshot
 * const snapshot = await dashboard.takeSnapshot();
 * console.log(`Overall status: ${snapshot.overallStatus}`);
 *
 * // Get trends
 * const trends = dashboard.getTrends(['calibrationECE', 'freshnessScore']);
 * ```
 */
export class HealthDashboard {
  private readonly historyRetentionHours: number;
  private readonly snapshotIntervalMs: number;

  /** Registered component health check functions */
  private components: Map<string, HealthCheckFn> = new Map();

  /** Historical snapshots */
  private history: HealthSnapshot[] = [];

  /** Current alerts */
  private alerts: HealthAlert[] = [];

  /** Current metrics */
  private metrics: HealthMetrics = { ...DEFAULT_METRICS };

  /**
   * Create a new HealthDashboard.
   *
   * @param options - Dashboard configuration options
   */
  constructor(options: HealthDashboardOptions = {}) {
    this.historyRetentionHours = options.historyRetentionHours ?? DEFAULT_HISTORY_RETENTION_HOURS;
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
  }

  // ==========================================================================
  // COMPONENT REGISTRATION
  // ==========================================================================

  /**
   * Register a component with a health check function.
   *
   * @param name - Unique name for the component
   * @param healthCheck - Function that returns the component's health status
   */
  registerComponent(name: string, healthCheck: HealthCheckFn): void {
    this.components.set(name, healthCheck);
  }

  /**
   * Unregister a component.
   *
   * @param name - Name of the component to unregister
   */
  unregisterComponent(name: string): void {
    this.components.delete(name);
  }

  /**
   * Get list of registered component names.
   *
   * @returns Array of component names
   */
  getRegisteredComponents(): string[] {
    return Array.from(this.components.keys());
  }

  // ==========================================================================
  // SNAPSHOT MANAGEMENT
  // ==========================================================================

  /**
   * Take a snapshot of current system health.
   *
   * Calls all registered health check functions and aggregates the results.
   *
   * @returns Health snapshot
   */
  async takeSnapshot(): Promise<HealthSnapshot> {
    const timestamp = new Date();
    const componentHealths: ComponentHealth[] = [];

    // Call all health checks in parallel
    const healthChecks = Array.from(this.components.entries()).map(
      async ([name, healthCheck]) => {
        try {
          return await healthCheck();
        } catch (error) {
          // Return unhealthy status for failed health checks
          return {
            name,
            status: 'unhealthy' as HealthStatus,
            score: 0,
            lastChecked: timestamp,
            details: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
    );

    const results = await Promise.all(healthChecks);
    componentHealths.push(...results);

    // Compute overall score and status
    const overallScore = this.computeOverallScore(componentHealths);
    const overallStatus = this.determineOverallStatus(componentHealths);

    // Create snapshot
    const snapshot: HealthSnapshot = {
      timestamp,
      overallStatus,
      overallScore,
      components: componentHealths,
      metrics: { ...this.metrics },
      alerts: [...this.alerts],
    };

    // Store in history
    this.history.push(snapshot);

    // Prune old history
    this.pruneHistory();

    return snapshot;
  }

  /**
   * Compute overall health score from component scores.
   *
   * @param components - Array of component health statuses
   * @returns Overall score (0-100)
   */
  computeOverallScore(components: ComponentHealth[]): number {
    if (components.length === 0) {
      return 0;
    }

    const totalScore = components.reduce((sum, c) => sum + c.score, 0);
    return totalScore / components.length;
  }

  /**
   * Determine overall system status from component statuses.
   *
   * @param components - Array of component health statuses
   * @returns Overall status
   */
  private determineOverallStatus(components: ComponentHealth[]): HealthStatus {
    if (components.length === 0) {
      return 'healthy';
    }

    // If any component is unhealthy, system is unhealthy
    if (components.some((c) => c.status === 'unhealthy')) {
      return 'unhealthy';
    }

    // If any component is degraded, system is degraded
    if (components.some((c) => c.status === 'degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Prune history older than retention period.
   */
  private pruneHistory(): void {
    const cutoff = new Date(
      Date.now() - this.historyRetentionHours * 60 * 60 * 1000
    );

    this.history = this.history.filter((s) => s.timestamp >= cutoff);
  }

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  /**
   * Get health snapshots from the last N hours.
   *
   * @param hours - Number of hours to look back
   * @returns Array of snapshots (newest first)
   */
  getHistory(hours: number): HealthSnapshot[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.history
      .filter((s) => s.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // ==========================================================================
  // TRENDS
  // ==========================================================================

  /**
   * Get trends for specified metrics.
   *
   * @param metrics - Array of metric names to analyze
   * @returns Array of trend data
   */
  getTrends(metricNames: string[]): HealthTrend[] {
    if (this.history.length === 0) {
      return [];
    }

    return metricNames.map((metricName) => {
      const dataPoints = this.history
        .map((snapshot) => ({
          timestamp: snapshot.timestamp,
          value: (snapshot.metrics as unknown as Record<string, number>)[metricName] ?? 0,
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const trend = this.calculateTrendDirection(metricName, dataPoints);
      const changeRate = this.calculateChangeRate(dataPoints);

      return {
        metric: metricName,
        dataPoints,
        trend,
        changeRate,
      };
    });
  }

  /**
   * Calculate trend direction for a metric.
   *
   * @param metricName - Name of the metric
   * @param dataPoints - Historical data points
   * @returns Trend direction
   */
  private calculateTrendDirection(
    metricName: string,
    dataPoints: { timestamp: Date; value: number }[]
  ): TrendDirection {
    if (dataPoints.length < 2) {
      return 'stable';
    }

    // Use simple linear regression to determine trend
    const n = dataPoints.length;
    const xMean = (n - 1) / 2;
    const yMean = dataPoints.reduce((sum, p) => sum + p.value, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = i - xMean;
      const yDiff = dataPoints[i].value - yMean;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;

    // Threshold for considering a trend significant
    const threshold = 0.01 * yMean || 0.001;

    if (Math.abs(slope) < threshold) {
      return 'stable';
    }

    // For metrics where lower is better, negative slope means improving
    const lowerIsBetter = LOWER_IS_BETTER_METRICS.has(metricName);

    if (slope > threshold) {
      return lowerIsBetter ? 'degrading' : 'improving';
    } else {
      return lowerIsBetter ? 'improving' : 'degrading';
    }
  }

  /**
   * Calculate rate of change (per hour).
   *
   * @param dataPoints - Historical data points
   * @returns Change rate per hour
   */
  private calculateChangeRate(
    dataPoints: { timestamp: Date; value: number }[]
  ): number {
    if (dataPoints.length < 2) {
      return 0;
    }

    const first = dataPoints[0];
    const last = dataPoints[dataPoints.length - 1];

    const timeDiffHours =
      (last.timestamp.getTime() - first.timestamp.getTime()) / (1000 * 60 * 60);

    if (timeDiffHours === 0) {
      return 0;
    }

    return (last.value - first.value) / timeDiffHours;
  }

  // ==========================================================================
  // ALERTS
  // ==========================================================================

  /**
   * Add a health alert.
   *
   * @param alert - Alert to add
   */
  addAlert(alert: HealthAlert): void {
    this.alerts.push(alert);
  }

  /**
   * Get all alerts, optionally filtered by severity.
   *
   * @param severity - Optional severity filter
   * @returns Array of alerts
   */
  getAlerts(severity?: AlertSeverity): HealthAlert[] {
    if (severity) {
      return this.alerts.filter((a) => a.severity === severity);
    }
    return [...this.alerts];
  }

  /**
   * Clear alerts for a specific component.
   *
   * @param component - Component name to clear alerts for
   */
  clearAlerts(component: string): void {
    this.alerts = this.alerts.filter((a) => a.component !== component);
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  /**
   * Set all metrics.
   *
   * @param metrics - New metrics values
   */
  setMetrics(metrics: HealthMetrics): void {
    this.metrics = { ...metrics };
  }

  /**
   * Update specific metrics (partial update).
   *
   * @param updates - Partial metrics to update
   */
  updateMetrics(updates: Partial<HealthMetrics>): void {
    this.metrics = { ...this.metrics, ...updates };
  }

  /**
   * Get current metrics.
   *
   * @returns Current metrics
   */
  getMetrics(): HealthMetrics {
    return { ...this.metrics };
  }

  // ==========================================================================
  // VISUALIZATION DATA
  // ==========================================================================

  /**
   * Get chart data for component scores.
   *
   * @returns Chart-ready data with labels and values
   */
  getComponentChartData(): ComponentChartData {
    if (this.history.length === 0) {
      return { labels: [], values: [] };
    }

    const latestSnapshot = this.history[this.history.length - 1];

    return {
      labels: latestSnapshot.components.map((c) => c.name),
      values: latestSnapshot.components.map((c) => c.score),
    };
  }

  /**
   * Get time series data for a specific metric.
   *
   * @param metricName - Name of the metric
   * @returns Time series data
   */
  getMetricsTimeSeries(metricName: string): MetricsTimeSeries {
    const timestamps: Date[] = [];
    const values: number[] = [];

    for (const snapshot of this.history) {
      timestamps.push(snapshot.timestamp);
      values.push(
        (snapshot.metrics as unknown as Record<string, number>)[metricName] ?? 0
      );
    }

    return { timestamps, values };
  }

  /**
   * Get status summary for dashboard display.
   *
   * @returns Status summary counts
   */
  getStatusSummary(): StatusSummary {
    if (this.history.length === 0) {
      return {
        healthyCount: 0,
        degradedCount: 0,
        unhealthyCount: 0,
        totalCount: 0,
      };
    }

    const latestSnapshot = this.history[this.history.length - 1];

    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;

    for (const component of latestSnapshot.components) {
      switch (component.status) {
        case 'healthy':
          healthyCount++;
          break;
        case 'degraded':
          degradedCount++;
          break;
        case 'unhealthy':
          unhealthyCount++;
          break;
      }
    }

    return {
      healthyCount,
      degradedCount,
      unhealthyCount,
      totalCount: latestSnapshot.components.length,
    };
  }
}
