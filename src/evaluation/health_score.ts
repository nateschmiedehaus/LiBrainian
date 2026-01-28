/**
 * @fileoverview Health Score Computation for Librarian
 *
 * Computes aggregate health scores from multiple components including:
 * - Calibration metrics (ECE, Brier score)
 * - Freshness metrics (stale documents, average age)
 * - Consistency metrics (violations, total checks)
 * - Coverage metrics (covered files, total files)
 * - Error rate metrics (errors, total requests)
 *
 * Features:
 * - Configurable weighting schemes
 * - Trend analysis over time
 * - Anomaly detection
 * - Actionable recommendations
 *
 * WU-CALX-003: Health Score Computation
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Status of a health component
 */
export type HealthStatus = 'healthy' | 'warning' | 'critical';

/**
 * Trend direction for health scores
 */
export type TrendDirection = 'improving' | 'stable' | 'degrading';

/**
 * Score for an individual component
 */
export interface ComponentScore {
  /** Name of the component (e.g., 'calibration', 'freshness') */
  component: string;
  /** Score from 0-100 */
  score: number;
  /** Weight of this component in aggregate calculation */
  weight: number;
  /** Health status based on thresholds */
  status: HealthStatus;
  /** Detailed metrics that contributed to the score */
  details: Record<string, number>;
}

/**
 * Configuration for health score computation
 */
export interface HealthScoreConfig {
  /** Weight for each component (should sum to 1.0) */
  weights: {
    calibration: number;
    freshness: number;
    consistency: number;
    coverage: number;
    errorRate: number;
  };
  /** Thresholds for status determination */
  thresholds: {
    /** Score >= this is healthy */
    healthy: number;
    /** Score >= this is warning, < healthy; below warning is critical */
    warning: number;
  };
}

/**
 * Aggregate health score combining multiple components
 */
export interface AggregateHealthScore {
  /** Overall score from 0-100 */
  overall: number;
  /** Overall health status */
  status: HealthStatus;
  /** Individual component scores */
  components: ComponentScore[];
  /** When this score was computed */
  timestamp: Date;
  /** Trend compared to recent history */
  trend: TrendDirection;
  /** Actionable recommendations for improvement */
  recommendations: string[];
}

/**
 * Historical health score data
 */
export interface HealthHistory {
  /** Historical scores */
  scores: AggregateHealthScore[];
  /** Average score over the period */
  averageScore: number;
  /** Standard deviation of scores (volatility) */
  volatility: number;
  /** Trend direction as a number (positive = improving) */
  trendDirection: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default configuration for health score computation
 */
export const DEFAULT_HEALTH_SCORE_CONFIG: HealthScoreConfig = {
  weights: {
    calibration: 0.25,
    freshness: 0.2,
    consistency: 0.2,
    coverage: 0.2,
    errorRate: 0.15,
  },
  thresholds: {
    healthy: 80,
    warning: 50,
  },
};

/**
 * Penalty applied when any component is in critical state
 */
const CRITICAL_PENALTY = 0.15;

/**
 * Bonus applied when all components are healthy
 */
const ALL_HEALTHY_BONUS = 0.05;

/**
 * Default weight for unknown components
 */
const DEFAULT_COMPONENT_WEIGHT = 0.1;

/**
 * Threshold for detecting volatility anomalies (standard deviation)
 */
const VOLATILITY_ANOMALY_THRESHOLD = 15;

/**
 * Threshold for detecting sudden drops
 */
const SUDDEN_DROP_THRESHOLD = 25;

/**
 * Threshold for sustained low scores
 */
const SUSTAINED_LOW_THRESHOLD = 50;

/**
 * Minimum samples needed for trend analysis
 */
const MIN_SAMPLES_FOR_TREND = 3;

// ============================================================================
// RECOMMENDATION TEMPLATES
// ============================================================================

const RECOMMENDATIONS: Record<string, Record<HealthStatus, string>> = {
  calibration: {
    healthy: '',
    warning: 'Improve calibration: Review confidence score distribution and adjust calibration model.',
    critical: 'CRITICAL: Calibration is severely off. Immediate recalibration required. Review ECE and Brier scores.',
  },
  freshness: {
    healthy: '',
    warning: 'Improve freshness: Update stale documentation and refresh index for recently modified files.',
    critical: 'CRITICAL: Freshness is critically low. Immediate index refresh required. Many documents are stale.',
  },
  consistency: {
    healthy: '',
    warning: 'Improve consistency: Review and resolve consistency violations in knowledge base.',
    critical: 'CRITICAL: Consistency violations are severe. Urgent review of conflicting information needed.',
  },
  coverage: {
    healthy: '',
    warning: 'Increase coverage: Add missing files to index and improve documentation coverage.',
    critical: 'CRITICAL: Coverage is critically low. Increase indexed files immediately. Review and add missing codebase sections.',
  },
  errorRate: {
    healthy: '',
    warning: 'Reduce error rate: Review error logs and fix recurring issues.',
    critical: 'CRITICAL: Error rate is unacceptably high. Immediate investigation required.',
  },
};

// ============================================================================
// HEALTH SCORE COMPUTER CLASS
// ============================================================================

/**
 * Computes and tracks health scores for the Librarian system
 */
export class HealthScoreComputer {
  private config: HealthScoreConfig;
  private history: AggregateHealthScore[] = [];

  constructor(config: HealthScoreConfig = DEFAULT_HEALTH_SCORE_CONFIG) {
    this.config = config;
  }

  /**
   * Compute a score for an individual component based on its metrics
   *
   * @param component - Name of the component (e.g., 'calibration')
   * @param metrics - Key-value pairs of metric names and values
   * @returns ComponentScore with computed score and status
   */
  computeComponentScore(component: string, metrics: Record<string, number>): ComponentScore {
    // Get weight from config or use default
    const weight = this.getComponentWeight(component);

    // Compute score from metrics (0-100 scale)
    const score = this.computeScoreFromMetrics(metrics);

    // Determine status based on thresholds
    const status = this.determineStatus(score);

    return {
      component,
      score,
      weight,
      status,
      details: { ...metrics },
    };
  }

  /**
   * Compute an aggregate health score from multiple component scores
   *
   * @param components - Array of component scores
   * @returns AggregateHealthScore with overall score and recommendations
   */
  computeAggregateScore(components: ComponentScore[]): AggregateHealthScore {
    if (components.length === 0) {
      return {
        overall: 0,
        status: 'critical',
        components: [],
        timestamp: new Date(),
        trend: 'stable',
        recommendations: ['No components available for health scoring.'],
      };
    }

    // Compute weighted average
    let weightedSum = 0;
    let totalWeight = 0;
    let hasCritical = false;
    let allHealthy = true;

    for (const comp of components) {
      // Clamp score to 0-100
      const clampedScore = Math.max(0, Math.min(100, comp.score));
      weightedSum += clampedScore * comp.weight;
      totalWeight += comp.weight;

      if (comp.status === 'critical') {
        hasCritical = true;
        allHealthy = false;
      } else if (comp.status === 'warning') {
        allHealthy = false;
      }
    }

    // Calculate base weighted average
    let overall = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Apply penalty for critical components
    if (hasCritical) {
      overall = overall * (1 - CRITICAL_PENALTY);
    }

    // Apply bonus for all-healthy state
    if (allHealthy && !hasCritical) {
      overall = Math.min(100, overall * (1 + ALL_HEALTHY_BONUS));
    }

    // Clamp to valid range
    overall = Math.max(0, Math.min(100, overall));

    // Determine overall status
    const status = this.determineStatus(overall);

    // Compute trend from history
    const trend = this.computeTrend(overall);

    // Generate recommendations
    const aggregate: AggregateHealthScore = {
      overall,
      status,
      components,
      timestamp: new Date(),
      trend,
      recommendations: [],
    };

    aggregate.recommendations = this.generateRecommendations(aggregate);

    return aggregate;
  }

  /**
   * Record a score in history for trend analysis
   *
   * @param score - The aggregate score to record
   */
  recordScore(score: AggregateHealthScore): void {
    this.history.push(score);
  }

  /**
   * Get historical health scores within a time window
   *
   * @param hours - Number of hours to look back
   * @returns HealthHistory with scores and computed statistics
   */
  getHistory(hours: number): HealthHistory {
    const now = new Date();
    const cutoff = new Date(now.getTime() - hours * 3600000);

    const filteredScores = this.history.filter((s) => s.timestamp >= cutoff);

    if (filteredScores.length === 0) {
      return {
        scores: [],
        averageScore: 0,
        volatility: 0,
        trendDirection: 0,
      };
    }

    // Compute average
    const sum = filteredScores.reduce((acc, s) => acc + s.overall, 0);
    const averageScore = sum / filteredScores.length;

    // Compute volatility (standard deviation)
    const squaredDiffs = filteredScores.map((s) => Math.pow(s.overall - averageScore, 2));
    const variance = squaredDiffs.reduce((acc, d) => acc + d, 0) / filteredScores.length;
    const volatility = Math.sqrt(variance);

    // Compute trend direction using linear regression
    const trendDirection = this.computeTrendDirection(filteredScores);

    return {
      scores: filteredScores,
      averageScore,
      volatility,
      trendDirection,
    };
  }

  /**
   * Generate actionable recommendations based on aggregate score
   *
   * @param score - The aggregate score to analyze
   * @returns Array of recommendation strings
   */
  generateRecommendations(score: AggregateHealthScore): string[] {
    const recommendations: string[] = [];

    // Sort components by status (critical first, then warning)
    const sortedComponents = [...score.components].sort((a, b) => {
      const statusOrder: Record<HealthStatus, number> = {
        critical: 0,
        warning: 1,
        healthy: 2,
      };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    for (const comp of sortedComponents) {
      if (comp.status === 'healthy') {
        continue;
      }

      const template = RECOMMENDATIONS[comp.component]?.[comp.status];
      if (template) {
        recommendations.push(template);
      } else {
        // Generic recommendation for unknown components
        const urgency = comp.status === 'critical' ? 'CRITICAL: ' : '';
        recommendations.push(
          `${urgency}Improve ${comp.component}: Current score is ${comp.score.toFixed(1)}. Review and address issues.`
        );
      }
    }

    return recommendations;
  }

  /**
   * Detect anomalies in health history
   *
   * @param history - Historical health data
   * @returns Array of anomaly descriptions
   */
  detectAnomalies(history: HealthHistory): string[] {
    const anomalies: string[] = [];

    if (history.scores.length < MIN_SAMPLES_FOR_TREND) {
      return anomalies;
    }

    // Check for high volatility
    if (history.volatility > VOLATILITY_ANOMALY_THRESHOLD) {
      anomalies.push(
        `High volatility detected: Health scores are fluctuating significantly (stddev: ${history.volatility.toFixed(1)}). Investigate unstable components.`
      );
    }

    // Check for sudden drops
    const scores = history.scores;
    for (let i = 1; i < scores.length; i++) {
      const drop = scores[i - 1].overall - scores[i].overall;
      if (drop > SUDDEN_DROP_THRESHOLD) {
        anomalies.push(
          `Sudden score drop detected: Score decreased by ${drop.toFixed(1)} points at ${scores[i].timestamp.toISOString()}. Investigate recent changes.`
        );
        break; // Only report first sudden drop
      }
    }

    // Check for sustained low scores
    const lowScores = scores.filter((s) => s.overall < SUSTAINED_LOW_THRESHOLD);
    if (lowScores.length === scores.length && scores.length >= MIN_SAMPLES_FOR_TREND) {
      anomalies.push(
        `Sustained low scores: All ${scores.length} samples are below ${SUSTAINED_LOW_THRESHOLD}. Chronic health issues require attention.`
      );
    }

    return anomalies;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Get the weight for a component from configuration
   */
  private getComponentWeight(component: string): number {
    const weights = this.config.weights as Record<string, number>;
    return weights[component] ?? DEFAULT_COMPONENT_WEIGHT;
  }

  /**
   * Compute a 0-100 score from raw metrics
   * Uses average of metric values, scaled appropriately
   */
  private computeScoreFromMetrics(metrics: Record<string, number>): number {
    const values = Object.values(metrics);

    if (values.length === 0) {
      return 0;
    }

    // Assume metrics are either:
    // - 0-1 scale (like accuracy, precision) -> multiply by 100
    // - Already 0-100 scale
    // - Count-based (like errors, violations) -> need to handle specially

    let sum = 0;
    let count = 0;

    for (const value of values) {
      let normalizedValue: number;

      if (value >= 0 && value <= 1) {
        // Likely a ratio/percentage in 0-1 format
        normalizedValue = value * 100;
      } else if (value >= 0 && value <= 100) {
        // Likely already in 0-100 format
        normalizedValue = value;
      } else {
        // For count-based metrics, we can't easily normalize
        // Skip them or use a heuristic
        continue;
      }

      sum += normalizedValue;
      count++;
    }

    return count > 0 ? sum / count : 0;
  }

  /**
   * Determine health status based on score and thresholds
   */
  private determineStatus(score: number): HealthStatus {
    if (score >= this.config.thresholds.healthy) {
      return 'healthy';
    } else if (score >= this.config.thresholds.warning) {
      return 'warning';
    } else {
      return 'critical';
    }
  }

  /**
   * Compute trend direction based on history
   */
  private computeTrend(currentScore: number): TrendDirection {
    if (this.history.length < MIN_SAMPLES_FOR_TREND) {
      return 'stable';
    }

    // Get recent history
    const recentScores = this.history.slice(-MIN_SAMPLES_FOR_TREND);
    const avgRecent =
      recentScores.reduce((acc, s) => acc + s.overall, 0) / recentScores.length;

    const diff = currentScore - avgRecent;

    if (diff > 5) {
      return 'improving';
    } else if (diff < -5) {
      return 'degrading';
    } else {
      return 'stable';
    }
  }

  /**
   * Compute trend direction as a number using simple linear regression
   * Positive = improving, negative = degrading
   */
  private computeTrendDirection(scores: AggregateHealthScore[]): number {
    if (scores.length < 2) {
      return 0;
    }

    // Use simple linear regression (y = mx + b, return m)
    const n = scores.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = scores[i].overall;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) {
      return 0;
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    return slope;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new HealthScoreComputer instance
 *
 * @param config - Optional custom configuration
 * @returns HealthScoreComputer instance
 */
export function createHealthScoreComputer(
  config: HealthScoreConfig = DEFAULT_HEALTH_SCORE_CONFIG
): HealthScoreComputer {
  return new HealthScoreComputer(config);
}
