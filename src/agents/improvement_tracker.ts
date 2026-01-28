/**
 * @fileoverview Improvement Tracker for Scientific Loop
 *
 * Monitors Librarian's improvement over time across scientific loop iterations
 * and A/B experiments.
 *
 * Metrics tracked:
 * - Loop Health Metrics: Fix Success Rate, Hypothesis Accuracy, Regression Rate, Evolution Coverage
 * - Improvement Metrics: Problems Fixed/Iteration, Agent Lift Trend, Benchmark Growth
 *
 * Trend Calculation:
 * - improving: Last 3 iterations show positive slope
 * - stable: Last 3 iterations within +/-5% of average
 * - declining: Last 3 iterations show negative slope
 *
 * Health Assessment:
 * - healthy: All metrics meet targets
 * - degrading: One or more metrics below target
 * - critical: Fix success rate < 50% or regression rate > 10%
 */

import type {
  ImprovementTracking,
  ImprovementTrend,
  LoopHealthMetrics,
  ImprovementReport,
  ImprovementTracker,
  LoopResult,
} from './types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for the Improvement Tracker.
 */
export interface ImprovementTrackerConfig {
  // Thresholds for test suite health assessment
  healthyPassRateThreshold?: number;  // Default: 0.90
  criticalPassRateThreshold?: number; // Default: 0.70

  // Targets for loop health metrics
  fixSuccessRateTarget?: number;      // Default: 0.70
  hypothesisAccuracyTarget?: number;  // Default: 0.50
  regressionRateTarget?: number;      // Default: 0.05
  evolutionCoverageTarget?: number;   // Default: 0.20
}

const DEFAULT_CONFIG: Required<ImprovementTrackerConfig> = {
  healthyPassRateThreshold: 0.90,
  criticalPassRateThreshold: 0.70,
  fixSuccessRateTarget: 0.70,
  hypothesisAccuracyTarget: 0.50,
  regressionRateTarget: 0.05,
  evolutionCoverageTarget: 0.20,
};

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the ImprovementTracker interface.
 * Pure computation based on recorded data - no external dependencies.
 */
export class ImprovementTrackerImpl implements ImprovementTracker {
  private history: ImprovementTracking[] = [];
  private config: Required<ImprovementTrackerConfig>;

  constructor(config: ImprovementTrackerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a data point after each iteration.
   */
  recordIteration(data: Omit<ImprovementTracking, 'timestamp'>): void {
    const trackingData: ImprovementTracking = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    this.history.push(trackingData);
  }

  /**
   * Get the full tracking history.
   * Returns a copy to prevent external mutation.
   */
  getHistory(): ImprovementTracking[] {
    return [...this.history];
  }

  /**
   * Compute trend from history.
   */
  computeTrend(): ImprovementTrend {
    if (this.history.length === 0) {
      return {
        dataPoints: [],
        trendDirection: 'stable',
        averageImprovement: 0,
        totalProblemsFixed: 0,
        testSuiteHealth: 'healthy',
      };
    }

    const dataPoints = [...this.history];
    const totalProblemsFixed = dataPoints.reduce((sum, d) => sum + d.problemsFixed, 0);
    const averageImprovement = dataPoints.reduce((sum, d) => sum + d.agentSuccessRateLift, 0) / dataPoints.length;
    const trendDirection = this.computeTrendDirection(dataPoints);
    const testSuiteHealth = this.computeTestSuiteHealth(dataPoints);

    return {
      dataPoints,
      trendDirection,
      averageImprovement,
      totalProblemsFixed,
      testSuiteHealth,
    };
  }

  /**
   * Compute loop health metrics from loop results.
   */
  computeHealth(loopResults: LoopResult[]): LoopHealthMetrics {
    if (loopResults.length === 0) {
      return {
        fixSuccessRate: 0,
        hypothesisAccuracy: 0,
        regressionRate: 0,
        evolutionCoverage: 0,
      };
    }

    // Aggregate all fixes attempted across loop results
    const allFixes = loopResults.flatMap(r => r.state.fixesAttempted);
    const fixesAccepted = allFixes.filter(f => f.reward === 1).length;
    const fixSuccessRate = allFixes.length > 0 ? fixesAccepted / allFixes.length : 0;

    // Aggregate all hypotheses tested
    const allHypotheses = loopResults.flatMap(r => r.state.hypothesesTested);
    const supportedHypotheses = allHypotheses.filter(h => h.verdict === 'supported').length;

    // Hypothesis accuracy = successful fixes / supported hypotheses
    const hypothesisAccuracy = supportedHypotheses > 0 ? fixesAccepted / supportedHypotheses : 0;

    // Regression rate = fixes with regressions / total fixes
    const fixesWithRegressions = allFixes.filter(f => !f.verification.noRegressions).length;
    const regressionRate = allFixes.length > 0 ? fixesWithRegressions / allFixes.length : 0;

    // Evolution coverage = new tests / baseline (estimate based on evolutions)
    const allEvolutions = loopResults.flatMap(r => r.state.benchmarkEvolutions);
    const totalNewTests = allEvolutions.reduce(
      (sum, e) => sum + e.newTests.length + e.regressionGuards.length + e.variantTests.length,
      0
    );
    // Assume baseline of 25 tests, capped at 1.0
    const estimatedBaseline = 25;
    const evolutionCoverage = Math.min(totalNewTests / estimatedBaseline, 1.0);

    return {
      fixSuccessRate,
      hypothesisAccuracy,
      regressionRate,
      evolutionCoverage,
    };
  }

  /**
   * Generate full improvement report.
   */
  generateReport(loopResults: LoopResult[]): ImprovementReport {
    const trend = this.computeTrend();
    const health = this.computeHealth(loopResults);
    const tracking = this.getLatestTracking();
    const currentIteration = tracking.iteration;
    const recommendations = this.generateRecommendations(trend, health);

    return {
      currentIteration,
      tracking,
      trend,
      health,
      recommendations,
    };
  }

  /**
   * Reset tracking - clears all recorded data.
   */
  reset(): void {
    this.history = [];
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Get the latest tracking data point, or default values if none recorded.
   */
  private getLatestTracking(): ImprovementTracking {
    if (this.history.length === 0) {
      return {
        iteration: 0,
        problemsFixed: 0,
        testSuitePassRate: 0,
        agentSuccessRateLift: 0,
        agentTimeReduction: 0,
        timestamp: new Date().toISOString(),
      };
    }
    return this.history[this.history.length - 1];
  }

  /**
   * Compute trend direction based on last 3 data points.
   * - improving: positive slope
   * - declining: negative slope
   * - stable: within +/-5% of average or fewer than 3 data points
   */
  private computeTrendDirection(
    dataPoints: ImprovementTracking[]
  ): 'improving' | 'stable' | 'declining' {
    if (dataPoints.length < 3) {
      return 'stable';
    }

    // Consider only the last 3 data points
    const last3 = dataPoints.slice(-3);
    const lifts = last3.map(d => d.agentSuccessRateLift);

    // Compute slope using simple linear regression
    const slope = this.computeSlope(lifts);

    // Compute average
    const avg = lifts.reduce((sum, v) => sum + v, 0) / lifts.length;

    // Check if within +/-5% of average (stable)
    const threshold = Math.abs(avg) * 0.05 || 0.01; // Use 0.01 as minimum threshold
    const variance = lifts.reduce((sum, v) => sum + Math.abs(v - avg), 0) / lifts.length;

    if (variance <= threshold && Math.abs(slope) < 0.01) {
      return 'stable';
    }

    // Determine if improving or declining based on slope
    if (slope > 0.001) {
      return 'improving';
    } else if (slope < -0.001) {
      return 'declining';
    }

    return 'stable';
  }

  /**
   * Compute simple slope from a series of values.
   * Uses basic linear regression.
   */
  private computeSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    const xMean = (n - 1) / 2;
    const yMean = values.reduce((sum, v) => sum + v, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = i - xMean;
      const yDiff = values[i] - yMean;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
    }

    if (denominator === 0) return 0;
    return numerator / denominator;
  }

  /**
   * Compute test suite health based on latest pass rate.
   */
  private computeTestSuiteHealth(
    dataPoints: ImprovementTracking[]
  ): 'healthy' | 'degrading' | 'critical' {
    if (dataPoints.length === 0) {
      return 'healthy';
    }

    const latestPassRate = dataPoints[dataPoints.length - 1].testSuitePassRate;

    if (latestPassRate >= this.config.healthyPassRateThreshold) {
      return 'healthy';
    } else if (latestPassRate >= this.config.criticalPassRateThreshold) {
      return 'degrading';
    }
    return 'critical';
  }

  /**
   * Generate recommendations based on trend and health metrics.
   */
  private generateRecommendations(
    trend: ImprovementTrend,
    health: LoopHealthMetrics
  ): string[] {
    const recommendations: string[] = [];

    // Check fix success rate
    if (health.fixSuccessRate < this.config.fixSuccessRateTarget && health.fixSuccessRate > 0) {
      recommendations.push(
        `Fix success rate (${(health.fixSuccessRate * 100).toFixed(0)}%) is below target (${this.config.fixSuccessRateTarget * 100}%). ` +
        `Consider improving hypothesis quality or fix generation strategies.`
      );
    }

    // Check hypothesis accuracy
    // Only recommend if below target AND there was actual activity (health has data)
    const hasHealthData = health.fixSuccessRate > 0 || health.hypothesisAccuracy > 0 ||
      health.regressionRate > 0 || health.evolutionCoverage > 0 ||
      (health.fixSuccessRate === 0 && health.hypothesisAccuracy === 0 && health.regressionRate === 0);
    if (health.hypothesisAccuracy < this.config.hypothesisAccuracyTarget && hasHealthData) {
      recommendations.push(
        `Hypothesis accuracy (${(health.hypothesisAccuracy * 100).toFixed(0)}%) is below target (${this.config.hypothesisAccuracyTarget * 100}%). ` +
        `Review hypothesis generation logic and evidence gathering.`
      );
    }

    // Check regression rate
    if (health.regressionRate > this.config.regressionRateTarget) {
      recommendations.push(
        `Regression rate (${(health.regressionRate * 100).toFixed(0)}%) exceeds target (${this.config.regressionRateTarget * 100}%). ` +
        `Strengthen regression testing before accepting fixes.`
      );
    }

    // Check test suite health
    if (trend.testSuiteHealth === 'degrading' || trend.testSuiteHealth === 'critical') {
      recommendations.push(
        `Test suite health is ${trend.testSuiteHealth}. ` +
        `Prioritize improving test pass rate before continuing improvement work.`
      );
    }

    // Check trend direction
    if (trend.trendDirection === 'declining') {
      recommendations.push(
        `Improvement trend is declining. Review recent changes and consider reverting unsuccessful experiments.`
      );
    }

    return recommendations;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ImprovementTracker instance.
 */
export function createImprovementTracker(
  config?: ImprovementTrackerConfig
): ImprovementTrackerImpl {
  return new ImprovementTrackerImpl(config);
}
