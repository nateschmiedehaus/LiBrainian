/**
 * @fileoverview Calibration Dashboard for Visualization
 *
 * Provides visualization-ready data structures for calibration metrics:
 * - Reliability diagrams with bin-level statistics
 * - Time series tracking of calibration metrics
 * - Alerts for calibration issues
 * - Filtering by claim type and time range
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single prediction outcome for calibration analysis.
 * Represents an individual prediction with its outcome.
 */
export interface PredictionOutcome {
  /** Unique identifier for the data point */
  id: string;

  /** Predicted probability (0-1) */
  predictedProbability: number;

  /** Actual outcome (0 or 1) */
  actualOutcome: 0 | 1;

  /** When this prediction was made */
  timestamp: Date;

  /** Type of claim being predicted */
  claimType: string;
}

/**
 * A bin in the reliability diagram.
 */
export interface ReliabilityBin {
  /** Index of this bin (0-based) */
  binIndex: number;

  /** Start of bin range (inclusive) */
  binStart: number;

  /** End of bin range (exclusive, except for last bin) */
  binEnd: number;

  /** Average confidence of predictions in this bin */
  avgConfidence: number;

  /** Average accuracy (fraction of correct predictions) in this bin */
  avgAccuracy: number;

  /** Number of predictions in this bin */
  count: number;

  /** Calibration gap: avgConfidence - avgAccuracy (positive = overconfident) */
  gap: number;
}

/**
 * A reliability diagram showing calibration across confidence bins.
 */
export interface ReliabilityDiagram {
  /** Array of bins spanning [0, 1] */
  bins: ReliabilityBin[];

  /** Points defining the perfect calibration line (x = y) */
  perfectCalibrationLine: [number, number][];

  /** Total area where model is overconfident (gap > 0) */
  overconfidenceArea: number;

  /** Total area where model is underconfident (gap < 0) */
  underconfidenceArea: number;

  /** Expected Calibration Error: weighted average of |gap| across bins */
  ece: number;

  /** Maximum Calibration Error: max |gap| across bins */
  mce: number;
}

/**
 * Time series of a calibration metric.
 */
export interface CalibrationTimeSeries {
  /** The metric being tracked */
  metric: 'ece' | 'brier' | 'log_loss';

  /** Data points over time */
  dataPoints: { timestamp: Date; value: number }[];

  /** Moving average values (same length as dataPoints) */
  movingAverage: number[];

  /** Overall trend direction */
  trend: 'improving' | 'stable' | 'degrading';
}

/**
 * A snapshot of the dashboard state at a point in time.
 */
export interface DashboardSnapshot {
  /** When this snapshot was taken */
  timestamp: Date;

  /** Overall reliability diagram */
  reliabilityDiagram: ReliabilityDiagram;

  /** Time series for each tracked metric */
  timeSeries: CalibrationTimeSeries[];

  /** Reliability diagram per claim type */
  byClaimType: Map<string, ReliabilityDiagram>;

  /** Active alerts */
  alerts: CalibrationAlert[];

  /** Summary statistics */
  summary: CalibrationSummary;
}

/**
 * An alert about calibration issues.
 */
export interface CalibrationAlert {
  /** Type of calibration issue */
  type: 'high_ece' | 'overconfident' | 'underconfident' | 'insufficient_data';

  /** Severity level */
  severity: 'info' | 'warning' | 'critical';

  /** Human-readable message */
  message: string;

  /** Indices of bins affected (if applicable) */
  affectedBins?: number[];
}

/**
 * Summary of calibration status.
 */
export interface CalibrationSummary {
  /** Overall calibration status */
  overallStatus: 'well_calibrated' | 'needs_attention' | 'poorly_calibrated';

  /** Expected Calibration Error */
  ece: number;

  /** Brier score (mean squared error of predictions) */
  brierScore: number;

  /** Total number of predictions */
  totalPredictions: number;

  /** Date range of data */
  dateRange: [Date, Date];
}

/**
 * Configuration options for the CalibrationDashboard.
 */
export interface CalibrationDashboardConfig {
  /** Default number of bins for reliability diagrams */
  defaultBins: number;

  /** ECE threshold for alerts (warning) */
  eceThreshold: number;

  /** MCE threshold for alerts (warning) */
  mceThreshold: number;

  /** Minimum samples per bin for reliable statistics */
  minSamplesPerBin: number;

  /** Window size for moving average */
  movingAverageWindow: number;
}

/**
 * Filter options for querying data points.
 */
export interface DataPointFilter {
  /** Filter by claim type */
  claimType?: string;

  /** Filter by start date (inclusive) */
  startDate?: Date;

  /** Filter by end date (exclusive) */
  endDate?: Date;
}

/**
 * Default configuration for CalibrationDashboard.
 */
export const DEFAULT_CALIBRATION_CONFIG: CalibrationDashboardConfig = {
  defaultBins: 10,
  eceThreshold: 0.1,
  mceThreshold: 0.2,
  minSamplesPerBin: 10,
  movingAverageWindow: 7,
};

// ============================================================================
// CALIBRATION DASHBOARD CLASS
// ============================================================================

/**
 * CalibrationDashboard generates visualization-ready data structures
 * for analyzing prediction calibration.
 */
export class CalibrationDashboard {
  private config: CalibrationDashboardConfig;
  private dataPoints: PredictionOutcome[] = [];

  constructor(config: Partial<CalibrationDashboardConfig> = {}) {
    this.config = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
  }

  // ==========================================================================
  // DATA MANAGEMENT
  // ==========================================================================

  /**
   * Add calibration data points to the dashboard.
   */
  addDataPoints(points: PredictionOutcome[]): void {
    this.dataPoints.push(...points);
  }

  /**
   * Get data points with optional filtering.
   */
  getDataPoints(filter: DataPointFilter = {}): PredictionOutcome[] {
    let result = [...this.dataPoints];

    if (filter.claimType) {
      result = result.filter((p) => p.claimType === filter.claimType);
    }

    if (filter.startDate) {
      const startTime = filter.startDate.getTime();
      result = result.filter((p) => p.timestamp.getTime() >= startTime);
    }

    if (filter.endDate) {
      const endTime = filter.endDate.getTime();
      result = result.filter((p) => p.timestamp.getTime() < endTime);
    }

    return result;
  }

  /**
   * Clear all data points.
   */
  clear(): void {
    this.dataPoints = [];
  }

  // ==========================================================================
  // RELIABILITY DIAGRAM GENERATION
  // ==========================================================================

  /**
   * Generate a reliability diagram from calibration data.
   */
  generateReliabilityDiagram(
    data: PredictionOutcome[],
    numBins: number = this.config.defaultBins
  ): ReliabilityDiagram {
    // Initialize bins
    const bins: ReliabilityBin[] = [];
    for (let i = 0; i < numBins; i++) {
      bins.push({
        binIndex: i,
        binStart: i / numBins,
        binEnd: (i + 1) / numBins,
        avgConfidence: 0,
        avgAccuracy: 0,
        count: 0,
        gap: 0,
      });
    }

    // Assign data points to bins
    const binData: { confidence: number; outcome: number }[][] = Array.from(
      { length: numBins },
      () => []
    );

    for (const point of data) {
      // Determine which bin this point belongs to
      let binIndex = Math.floor(point.predictedProbability * numBins);
      // Handle edge case where probability is exactly 1.0
      if (binIndex >= numBins) {
        binIndex = numBins - 1;
      }
      binData[binIndex].push({
        confidence: point.predictedProbability,
        outcome: point.actualOutcome,
      });
    }

    // Calculate bin statistics
    for (let i = 0; i < numBins; i++) {
      const binPoints = binData[i];
      if (binPoints.length > 0) {
        const sumConfidence = binPoints.reduce((sum, p) => sum + p.confidence, 0);
        const sumOutcome = binPoints.reduce((sum, p) => sum + p.outcome, 0);

        bins[i].count = binPoints.length;
        bins[i].avgConfidence = sumConfidence / binPoints.length;
        bins[i].avgAccuracy = sumOutcome / binPoints.length;
        bins[i].gap = bins[i].avgConfidence - bins[i].avgAccuracy;
      }
    }

    // Calculate ECE and MCE
    const totalPoints = data.length;
    let ece = 0;
    let mce = 0;

    for (const bin of bins) {
      if (bin.count > 0) {
        const weight = bin.count / totalPoints;
        const absGap = Math.abs(bin.gap);
        ece += weight * absGap;
        if (absGap > mce) {
          mce = absGap;
        }
      }
    }

    // Calculate over/underconfidence areas
    let overconfidenceArea = 0;
    let underconfidenceArea = 0;

    for (const bin of bins) {
      if (bin.count > 0) {
        const weight = bin.count / totalPoints;
        if (bin.gap > 0) {
          overconfidenceArea += weight * bin.gap;
        } else {
          underconfidenceArea += weight * Math.abs(bin.gap);
        }
      }
    }

    // Generate perfect calibration line
    const perfectCalibrationLine: [number, number][] = [];
    for (let i = 0; i <= numBins; i++) {
      const x = i / numBins;
      perfectCalibrationLine.push([x, x]);
    }

    return {
      bins,
      perfectCalibrationLine,
      overconfidenceArea,
      underconfidenceArea,
      ece,
      mce,
    };
  }

  // ==========================================================================
  // TIME SERIES GENERATION
  // ==========================================================================

  /**
   * Get time series data for a calibration metric.
   */
  getTimeSeries(metric: 'ece' | 'brier' | 'log_loss', days: number): CalibrationTimeSeries {
    const cutoffDate = new Date(Date.now() - days * 86400000);
    const filteredData = this.dataPoints.filter(
      (p) => p.timestamp.getTime() >= cutoffDate.getTime()
    );

    // Group data by day
    const dailyData = new Map<string, PredictionOutcome[]>();
    for (const point of filteredData) {
      const dateKey = point.timestamp.toISOString().split('T')[0];
      if (!dailyData.has(dateKey)) {
        dailyData.set(dateKey, []);
      }
      dailyData.get(dateKey)!.push(point);
    }

    // Calculate metric for each day
    const dataPoints: { timestamp: Date; value: number }[] = [];
    const sortedDates = Array.from(dailyData.keys()).sort();

    for (const dateKey of sortedDates) {
      const dayPoints = dailyData.get(dateKey)!;
      let value: number;

      switch (metric) {
        case 'ece':
          value = this.calculateECE(dayPoints);
          break;
        case 'brier':
          value = this.calculateBrierScore(dayPoints);
          break;
        case 'log_loss':
          value = this.calculateLogLoss(dayPoints);
          break;
        default:
          value = 0;
      }

      dataPoints.push({
        timestamp: new Date(dateKey),
        value,
      });
    }

    // Calculate moving average
    const movingAverage = this.calculateMovingAverage(
      dataPoints.map((p) => p.value),
      this.config.movingAverageWindow
    );

    // Determine trend
    const trend = this.detectTrend(movingAverage);

    return {
      metric,
      dataPoints,
      movingAverage,
      trend,
    };
  }

  private calculateECE(data: PredictionOutcome[]): number {
    if (data.length === 0) return 0;
    const diagram = this.generateReliabilityDiagram(data, this.config.defaultBins);
    return diagram.ece;
  }

  private calculateBrierScore(data: PredictionOutcome[]): number {
    if (data.length === 0) return 0;
    let sum = 0;
    for (const point of data) {
      const error = point.predictedProbability - point.actualOutcome;
      sum += error * error;
    }
    return sum / data.length;
  }

  private calculateLogLoss(data: PredictionOutcome[]): number {
    if (data.length === 0) return 0;
    const epsilon = 1e-15; // Prevent log(0)
    let sum = 0;
    for (const point of data) {
      const p = Math.max(epsilon, Math.min(1 - epsilon, point.predictedProbability));
      if (point.actualOutcome === 1) {
        sum -= Math.log(p);
      } else {
        sum -= Math.log(1 - p);
      }
    }
    return sum / data.length;
  }

  private calculateMovingAverage(values: number[], window: number): number[] {
    if (values.length === 0) return [];

    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - window + 1);
      const windowValues = values.slice(start, i + 1);
      const avg = windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
      result.push(avg);
    }
    return result;
  }

  private detectTrend(movingAverage: number[]): 'improving' | 'stable' | 'degrading' {
    if (movingAverage.length < 3) return 'stable';

    // Compare first third with last third
    const third = Math.floor(movingAverage.length / 3);
    const firstThird = movingAverage.slice(0, third);
    const lastThird = movingAverage.slice(-third);

    const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
    const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;

    const threshold = 0.02; // 2% change threshold
    const change = lastAvg - firstAvg;

    // For calibration metrics, lower is better
    if (change < -threshold) {
      return 'improving';
    } else if (change > threshold) {
      return 'degrading';
    }
    return 'stable';
  }

  // ==========================================================================
  // SNAPSHOT GENERATION
  // ==========================================================================

  /**
   * Take a complete snapshot of the dashboard state.
   */
  takeSnapshot(): DashboardSnapshot {
    const allData = this.getDataPoints();
    const reliabilityDiagram = this.generateReliabilityDiagram(allData);

    // Generate time series for all metrics
    const timeSeries: CalibrationTimeSeries[] = [
      this.getTimeSeries('ece', 30),
      this.getTimeSeries('brier', 30),
      this.getTimeSeries('log_loss', 30),
    ];

    // Generate diagrams by claim type
    const byClaimType = new Map<string, ReliabilityDiagram>();
    const claimTypes = new Set(allData.map((p) => p.claimType));
    for (const claimType of claimTypes) {
      const typeData = allData.filter((p) => p.claimType === claimType);
      byClaimType.set(claimType, this.generateReliabilityDiagram(typeData));
    }

    // Generate alerts
    const alerts = this.generateAlerts(reliabilityDiagram);

    // Generate summary
    const summary = this.generateSummary(allData, reliabilityDiagram);

    return {
      timestamp: new Date(),
      reliabilityDiagram,
      timeSeries,
      byClaimType,
      alerts,
      summary,
    };
  }

  // ==========================================================================
  // ALERT GENERATION
  // ==========================================================================

  /**
   * Generate alerts based on the reliability diagram.
   */
  generateAlerts(diagram: ReliabilityDiagram): CalibrationAlert[] {
    const alerts: CalibrationAlert[] = [];
    const totalCount = diagram.bins.reduce((sum, bin) => sum + bin.count, 0);

    // Check for high ECE
    if (diagram.ece > this.config.eceThreshold) {
      const severity = diagram.ece > this.config.eceThreshold * 2 ? 'critical' : 'warning';
      alerts.push({
        type: 'high_ece',
        severity,
        message: `Expected Calibration Error (${(diagram.ece * 100).toFixed(1)}%) exceeds threshold (${(this.config.eceThreshold * 100).toFixed(1)}%)`,
      });
    }

    // Check for overconfidence
    const overconfidentBins = diagram.bins
      .filter((bin) => bin.count > 0 && bin.gap > this.config.eceThreshold)
      .map((bin) => bin.binIndex);

    if (overconfidentBins.length > 0) {
      alerts.push({
        type: 'overconfident',
        severity: diagram.overconfidenceArea > 0.1 ? 'warning' : 'info',
        message: `Model is overconfident in ${overconfidentBins.length} bins (predicts higher confidence than actual accuracy)`,
        affectedBins: overconfidentBins,
      });
    }

    // Check for underconfidence
    const underconfidentBins = diagram.bins
      .filter((bin) => bin.count > 0 && bin.gap < -this.config.eceThreshold)
      .map((bin) => bin.binIndex);

    if (underconfidentBins.length > 0) {
      alerts.push({
        type: 'underconfident',
        severity: diagram.underconfidenceArea > 0.1 ? 'warning' : 'info',
        message: `Model is underconfident in ${underconfidentBins.length} bins (predicts lower confidence than actual accuracy)`,
        affectedBins: underconfidentBins,
      });
    }

    // Check for insufficient data
    const sparseBins = diagram.bins.filter(
      (bin) => bin.count > 0 && bin.count < this.config.minSamplesPerBin
    );
    const emptyBins = diagram.bins.filter((bin) => bin.count === 0);

    if (totalCount < this.config.minSamplesPerBin * diagram.bins.length / 2) {
      alerts.push({
        type: 'insufficient_data',
        severity: 'info',
        message: `Insufficient data for reliable calibration analysis. ${sparseBins.length} bins have fewer than ${this.config.minSamplesPerBin} samples, ${emptyBins.length} bins are empty.`,
        affectedBins: [...sparseBins.map((b) => b.binIndex), ...emptyBins.map((b) => b.binIndex)],
      });
    }

    return alerts;
  }

  private generateSummary(
    data: PredictionOutcome[],
    diagram: ReliabilityDiagram
  ): CalibrationSummary {
    // Calculate Brier score
    const brierScore = this.calculateBrierScore(data);

    // Determine overall status
    let overallStatus: 'well_calibrated' | 'needs_attention' | 'poorly_calibrated';
    if (diagram.ece <= this.config.eceThreshold && diagram.mce <= this.config.mceThreshold) {
      overallStatus = 'well_calibrated';
    } else if (diagram.ece > this.config.eceThreshold * 2 || diagram.mce > this.config.mceThreshold * 2) {
      overallStatus = 'poorly_calibrated';
    } else {
      overallStatus = 'needs_attention';
    }

    // Calculate date range
    let minDate = new Date();
    let maxDate = new Date(0);
    for (const point of data) {
      if (point.timestamp.getTime() < minDate.getTime()) {
        minDate = point.timestamp;
      }
      if (point.timestamp.getTime() > maxDate.getTime()) {
        maxDate = point.timestamp;
      }
    }

    // Handle empty data case
    if (data.length === 0) {
      minDate = new Date();
      maxDate = new Date();
    }

    return {
      overallStatus,
      ece: diagram.ece,
      brierScore,
      totalPredictions: data.length,
      dateRange: [minDate, maxDate],
    };
  }

  // ==========================================================================
  // EXPORT FOR VISUALIZATION
  // ==========================================================================

  /**
   * Export a snapshot in a JSON-friendly format.
   */
  exportForVisualization(snapshot: DashboardSnapshot): {
    timestamp: string;
    reliabilityDiagram: ReliabilityDiagram;
    timeSeries: {
      metric: string;
      dataPoints: { timestamp: string; value: number }[];
      movingAverage: number[];
      trend: string;
    }[];
    byClaimType: Record<string, ReliabilityDiagram>;
    alerts: CalibrationAlert[];
    summary: {
      overallStatus: string;
      ece: number;
      brierScore: number;
      totalPredictions: number;
      dateRange: [string, string];
    };
  } {
    // Convert Map to plain object
    const byClaimType: Record<string, ReliabilityDiagram> = {};
    for (const [key, value] of snapshot.byClaimType) {
      byClaimType[key] = value;
    }

    // Convert time series dates to ISO strings
    const timeSeries = snapshot.timeSeries.map((ts) => ({
      metric: ts.metric,
      dataPoints: ts.dataPoints.map((dp) => ({
        timestamp: dp.timestamp.toISOString(),
        value: dp.value,
      })),
      movingAverage: ts.movingAverage,
      trend: ts.trend,
    }));

    return {
      timestamp: snapshot.timestamp.toISOString(),
      reliabilityDiagram: snapshot.reliabilityDiagram,
      timeSeries,
      byClaimType,
      alerts: snapshot.alerts,
      summary: {
        overallStatus: snapshot.summary.overallStatus,
        ece: snapshot.summary.ece,
        brierScore: snapshot.summary.brierScore,
        totalPredictions: snapshot.summary.totalPredictions,
        dateRange: [
          snapshot.summary.dateRange[0].toISOString(),
          snapshot.summary.dateRange[1].toISOString(),
        ],
      },
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a CalibrationDashboard instance.
 */
export function createCalibrationDashboard(
  config?: Partial<CalibrationDashboardConfig>
): CalibrationDashboard {
  return new CalibrationDashboard(config);
}
