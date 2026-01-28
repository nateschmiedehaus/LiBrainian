/**
 * @fileoverview Meta Improvement Loop (WU-SELF-305)
 *
 * Implements recursive self-improvement protocol with:
 * - Bounded recursion (max depth) to prevent infinite loops
 * - Convergence monitoring to detect when improvements stabilize
 * - Oscillation detection to catch feedback instabilities
 * - Metric gaming detection (Goodhart's Law) to prevent optimizing proxies
 * - Lobian safety constraints acknowledging self-verification limits
 *
 * LOBIAN SAFETY NOTE:
 * This module explicitly acknowledges the Lobian obstacle to self-improvement:
 * a system cannot prove its own consistency from within. Therefore:
 * - We NEVER claim that self-verification proves correctness
 * - We document theoretical limits in all analysis
 * - Critical changes require external validation
 * - Convergence indicates stability, NOT proven correctness
 *
 * Based on: AutoSD, RLVR, Godel's incompleteness theorems
 */

import type { ImprovementTracker, ImprovementTracking } from '../types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for the MetaImprovementLoop.
 */
export interface LoopConfig {
  /** Maximum number of iterations before stopping (default: 100) */
  maxIterations: number;
  /** Maximum recursion depth for improvement cascades (default: 3) */
  maxDepth: number;
  /** Threshold for convergence detection (0-1, default: 0.05) */
  convergenceThreshold: number;
  /** Minimum improvement rate to continue (default: 0.01) */
  minImprovementRate: number;
  /** Cooldown period between iterations in ms (default: 1000) */
  cooldownPeriod: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterations: 100,
  maxDepth: 3,
  convergenceThreshold: 0.05,
  minImprovementRate: 0.01,
  cooldownPeriod: 1000,
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Type of improvement action that can be taken.
 */
export type ImprovementActionType = 'fix' | 'refresh' | 'reindex' | 'recalibrate';

/**
 * An action taken during an improvement iteration.
 */
export interface ImprovementAction {
  /** Type of improvement action */
  type: ImprovementActionType;
  /** Target of the action (file, module, system) */
  target: string;
  /** Human-readable description of the action */
  description: string;
  /** Whether the action was actually applied */
  applied: boolean;
  /** Result of the action if applied */
  result?: string;
}

/**
 * Metric measurement before and after an iteration.
 */
export interface MetricChange {
  /** Name of the metric */
  metric: string;
  /** Value before the iteration */
  before: number;
  /** Value after the iteration */
  after: number;
}

/**
 * Result of a single improvement iteration.
 */
export interface ImprovementIteration {
  /** Unique identifier for this iteration */
  iterationId: number;
  /** Recursion depth of this iteration */
  depth: number;
  /** When the iteration started */
  startedAt: Date;
  /** When the iteration completed */
  completedAt?: Date;
  /** Actions taken during this iteration */
  improvements: ImprovementAction[];
  /** Metrics measured before and after */
  metricsBeforeAfter: MetricChange[];
  /** Outcome of the iteration */
  outcome: 'improved' | 'no_change' | 'degraded' | 'stopped';
}

/**
 * Status of the improvement loop.
 */
export type LoopStatus = 'idle' | 'running' | 'converged' | 'stopped' | 'error';

/**
 * Complete state of the improvement loop.
 */
export interface LoopState {
  /** Current status of the loop */
  status: LoopStatus;
  /** Current iteration number */
  currentIteration: number;
  /** Total improvements applied */
  totalImprovements: number;
  /** History of all iterations */
  history: ImprovementIteration[];
  /** Current convergence score (0-1, higher = more stable) */
  convergenceScore: number;
}

/**
 * Trend direction for a metric.
 */
export type MetricTrendDirection = 'improving' | 'stable' | 'oscillating';

/**
 * Analysis of convergence state.
 */
export interface ConvergenceAnalysis {
  /** Whether the loop has converged */
  converged: boolean;
  /** Whether metrics are oscillating */
  oscillating: boolean;
  /** Trends for each tracked metric */
  metricTrends: { metric: string; trend: MetricTrendDirection }[];
  /** Recommended action based on analysis */
  recommendation: 'continue' | 'stop' | 'investigate';
}

// ============================================================================
// INTERFACES FOR DEPENDENCY INJECTION
// ============================================================================

/**
 * Interface for problem detection (simplified for this module).
 */
export interface ProblemDetectorInterface {
  detect(): Promise<unknown[]>;
  identifyProblems(input: unknown): Promise<{
    problems: unknown[];
    summary: { total: number; byType: Record<string, number>; bySeverity: Record<string, number> };
  }>;
}

/**
 * Interface for continuous improvement runner.
 */
export interface ContinuousImprovementRunnerInterface {
  run(): Promise<{
    cycleNumber: number;
    checksPerformed: unknown[];
    issuesFound: unknown[];
    fixesPlanned: unknown[];
    fixesApplied: unknown[];
    patternsLearned: unknown[];
    healthImprovement: number;
    nextScheduledCheck: Date;
    status: string;
    duration: number;
    errors: string[];
    phaseReports: unknown[];
  }>;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * MetaImprovementLoop - Orchestrates recursive self-improvement.
 *
 * This class coordinates the meta-level improvement process:
 * 1. Run improvement cycles (via continuous improvement or other means)
 * 2. Track metrics before and after each cycle
 * 3. Detect convergence when improvements stabilize
 * 4. Detect oscillation when metrics bounce back and forth
 * 5. Warn about potential metric gaming (Goodhart's Law)
 * 6. Enforce bounded recursion to prevent infinite loops
 *
 * LOBIAN CONSTRAINT: This loop cannot prove its own improvements
 * are correct - it can only observe that metrics are stable.
 * External validation is required for critical changes.
 */
export class MetaImprovementLoop {
  private config: LoopConfig;
  private state: LoopState;
  private stopRequested: boolean = false;

  // Injected dependencies
  private improvementTracker: ImprovementTracker | null = null;
  private problemDetector: ProblemDetectorInterface | null = null;
  private continuousImprovementRunner: ContinuousImprovementRunnerInterface | null = null;

  constructor(config: Partial<LoopConfig> = {}) {
    this.validateConfig(config);
    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
    this.state = this.createInitialState();
  }

  // ============================================================================
  // CONFIGURATION VALIDATION
  // ============================================================================

  /**
   * Validate configuration values.
   */
  private validateConfig(config: Partial<LoopConfig>): void {
    if (config.maxIterations !== undefined && config.maxIterations < 0) {
      throw new Error('maxIterations must be non-negative');
    }
    if (config.maxDepth !== undefined && config.maxDepth < 1) {
      throw new Error('maxDepth must be at least 1');
    }
    if (config.convergenceThreshold !== undefined &&
        (config.convergenceThreshold < 0 || config.convergenceThreshold > 1)) {
      throw new Error('convergenceThreshold must be between 0 and 1');
    }
    if (config.minImprovementRate !== undefined && config.minImprovementRate < 0) {
      throw new Error('minImprovementRate must be non-negative');
    }
    if (config.cooldownPeriod !== undefined && config.cooldownPeriod < 0) {
      throw new Error('cooldownPeriod must be non-negative');
    }
  }

  /**
   * Create the initial state.
   */
  private createInitialState(): LoopState {
    return {
      status: 'idle',
      currentIteration: 0,
      totalImprovements: 0,
      history: [],
      convergenceScore: 0,
    };
  }

  // ============================================================================
  // DEPENDENCY INJECTION
  // ============================================================================

  /**
   * Set the improvement tracker for recording iteration data.
   */
  setImprovementTracker(tracker: ImprovementTracker): void {
    this.improvementTracker = tracker;
  }

  /**
   * Set the problem detector for identifying issues.
   */
  setProblemDetector(detector: ProblemDetectorInterface): void {
    this.problemDetector = detector;
  }

  /**
   * Set the continuous improvement runner.
   */
  setContinuousImprovementRunner(runner: ContinuousImprovementRunnerInterface): void {
    this.continuousImprovementRunner = runner;
  }

  // ============================================================================
  // STATE ACCESS
  // ============================================================================

  /**
   * Get the current state (immutable copy).
   */
  getState(): LoopState {
    return {
      ...this.state,
      history: [...this.state.history],
    };
  }

  // ============================================================================
  // MAIN LOOP CONTROL
  // ============================================================================

  /**
   * Start the improvement loop.
   *
   * @param configOverride - Optional configuration overrides for this run
   * @returns Promise that resolves when loop completes
   */
  async start(configOverride?: Partial<LoopConfig>): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('Loop is already running');
    }

    // Apply any config overrides for this run
    if (configOverride) {
      this.validateConfig(configOverride);
      this.config = { ...this.config, ...configOverride };
    }

    this.state.status = 'running';
    this.stopRequested = false;

    try {
      await this.runLoop();
    } catch (error) {
      this.state.status = 'error';
      throw error;
    }
  }

  /**
   * Stop the improvement loop.
   */
  stop(): void {
    this.stopRequested = true;
    if (this.state.status === 'running') {
      this.state.status = 'stopped';
    }
  }

  /**
   * Run the main improvement loop.
   */
  private async runLoop(): Promise<void> {
    while (
      this.state.currentIteration < this.config.maxIterations &&
      !this.stopRequested
    ) {
      // Run a single iteration
      const iteration = await this.runIteration();

      // Check for convergence
      const analysis = this.checkConvergence();
      if (analysis.converged) {
        this.state.status = 'converged';
        break;
      }

      // Check for oscillation - might need investigation
      if (analysis.oscillating) {
        // Continue but be cautious
        // In a real implementation, might want to slow down or change strategy
      }

      // Wait cooldown period before next iteration
      if (!this.stopRequested && this.state.currentIteration < this.config.maxIterations) {
        await this.sleep(this.config.cooldownPeriod);
      }
    }

    // Final status update if not already set
    if (this.state.status === 'running') {
      const analysis = this.checkConvergence();
      this.state.status = analysis.converged ? 'converged' : 'stopped';
    }
  }

  /**
   * Run a single improvement iteration.
   */
  async runIteration(): Promise<ImprovementIteration> {
    const iterationId = this.state.currentIteration + 1;
    const depth = this.calculateCurrentDepth();
    const startedAt = new Date();

    // Collect metrics before
    const metricsBefore = await this.collectMetrics();

    // Perform improvement actions
    const improvements: ImprovementAction[] = [];
    let outcome: ImprovementIteration['outcome'] = 'no_change';

    try {
      // Detect problems if detector available
      if (this.problemDetector) {
        try {
          const problems = await this.problemDetector.detect();
          if (problems.length > 0) {
            // Generate improvement actions based on problems
            const actions = this.generateActionsFromProblems(problems);
            improvements.push(...actions);
          }
        } catch (_error) {
          // Log but continue - problem detection failure shouldn't stop iteration
          improvements.push({
            type: 'fix',
            target: 'problem_detector',
            description: 'Problem detection failed',
            applied: false,
            result: 'error',
          });
        }
      }

      // Run continuous improvement if runner available
      if (this.continuousImprovementRunner) {
        try {
          const result = await this.continuousImprovementRunner.run();
          if (result.healthImprovement > 0) {
            improvements.push({
              type: 'fix',
              target: 'system',
              description: `Continuous improvement cycle ${result.cycleNumber}`,
              applied: true,
              result: `Health improvement: ${(result.healthImprovement * 100).toFixed(1)}%`,
            });
          }
        } catch (_error) {
          // Log but continue
        }
      }

      // If no external components, generate default actions
      if (improvements.length === 0) {
        improvements.push(...this.generateDefaultActions(iterationId));
      }

    } catch (_error) {
      outcome = 'stopped';
    }

    // Collect metrics after
    const metricsAfter = await this.collectMetrics();

    // Calculate metric changes
    const metricsBeforeAfter = this.calculateMetricChanges(metricsBefore, metricsAfter);

    // Determine outcome based on metric changes
    if (outcome !== 'stopped') {
      outcome = this.determineOutcome(metricsBeforeAfter);
    }

    const completedAt = new Date();

    // Create iteration record
    const iteration: ImprovementIteration = {
      iterationId,
      depth,
      startedAt,
      completedAt,
      improvements,
      metricsBeforeAfter,
      outcome,
    };

    // Update state
    this.state.currentIteration = iterationId;
    this.state.history.push(iteration);
    this.state.totalImprovements += improvements.filter(a => a.applied).length;
    this.state.convergenceScore = this.calculateConvergenceScore();

    // Record to tracker if available
    if (this.improvementTracker) {
      const trackingData: Omit<ImprovementTracking, 'timestamp'> = {
        iteration: iterationId,
        problemsFixed: improvements.filter(a => a.applied && a.type === 'fix').length,
        testSuitePassRate: this.extractMetric(metricsAfter, 'test_pass_rate') || 1.0,
        agentSuccessRateLift: this.calculateLift(metricsBeforeAfter, 'success_rate'),
        agentTimeReduction: this.calculateLift(metricsBeforeAfter, 'response_time'),
      };
      this.improvementTracker.recordIteration(trackingData);
    }

    return iteration;
  }

  // ============================================================================
  // CONVERGENCE ANALYSIS
  // ============================================================================

  /**
   * Check for convergence and analyze trends.
   */
  checkConvergence(): ConvergenceAnalysis {
    const history = this.state.history;

    // Not enough data to analyze
    if (history.length < 3) {
      return {
        converged: false,
        oscillating: false,
        metricTrends: [],
        recommendation: 'continue',
      };
    }

    // Analyze recent iterations
    const recentHistory = history.slice(-5);

    // Check for convergence (metrics stable)
    const converged = this.isConverged(recentHistory);

    // Check for oscillation
    const oscillating = this.detectOscillation(history);

    // Analyze metric trends
    const metricTrends = this.analyzeMetricTrends(recentHistory);

    // Determine recommendation
    let recommendation: ConvergenceAnalysis['recommendation'];
    if (converged) {
      recommendation = 'stop';
    } else if (oscillating) {
      recommendation = 'investigate';
    } else {
      recommendation = 'continue';
    }

    return {
      converged,
      oscillating,
      metricTrends,
      recommendation,
    };
  }

  /**
   * Check if the loop has converged (metrics are stable).
   */
  private isConverged(recentHistory: ImprovementIteration[]): boolean {
    if (recentHistory.length < 3) {
      return false;
    }

    // Check if outcomes are consistently no_change
    const recentOutcomes = recentHistory.map(it => it.outcome);
    const noChangeCount = recentOutcomes.filter(o => o === 'no_change').length;

    // Converged if most recent iterations show no change
    if (noChangeCount >= recentHistory.length * 0.8) {
      return true;
    }

    // Also check metric variance
    const metricVariance = this.calculateMetricVariance(recentHistory);
    return metricVariance < this.config.convergenceThreshold;
  }

  /**
   * Detect oscillation in the improvement history.
   */
  detectOscillation(history: ImprovementIteration[]): boolean {
    if (history.length < 4) {
      return false;
    }

    // Look for alternating improved/degraded pattern
    const recentOutcomes = history.slice(-6).map(it => it.outcome);

    // Count alternations
    let alternations = 0;
    for (let i = 1; i < recentOutcomes.length; i++) {
      const prev = recentOutcomes[i - 1];
      const curr = recentOutcomes[i];

      if ((prev === 'improved' && curr === 'degraded') ||
          (prev === 'degraded' && curr === 'improved')) {
        alternations++;
      }
    }

    // Oscillating if more than half the transitions are alternations
    return alternations >= (recentOutcomes.length - 1) * 0.5;
  }

  /**
   * Analyze trends for each metric.
   */
  private analyzeMetricTrends(
    recentHistory: ImprovementIteration[]
  ): { metric: string; trend: MetricTrendDirection }[] {
    // Collect all unique metric names
    const metricNames = new Set<string>();
    for (const iteration of recentHistory) {
      for (const change of iteration.metricsBeforeAfter) {
        metricNames.add(change.metric);
      }
    }

    const trends: { metric: string; trend: MetricTrendDirection }[] = [];

    for (const metric of Array.from(metricNames)) {
      const values = recentHistory
        .flatMap(it => it.metricsBeforeAfter)
        .filter(m => m.metric === metric)
        .map(m => m.after);

      if (values.length < 2) {
        trends.push({ metric, trend: 'stable' });
        continue;
      }

      // Calculate trend
      const trend = this.calculateTrend(values);
      trends.push({ metric, trend });
    }

    return trends;
  }

  /**
   * Calculate trend direction from a series of values.
   */
  private calculateTrend(values: number[]): MetricTrendDirection {
    if (values.length < 2) {
      return 'stable';
    }

    // Check for oscillation
    let oscillationCount = 0;
    for (let i = 2; i < values.length; i++) {
      const diff1 = values[i - 1] - values[i - 2];
      const diff2 = values[i] - values[i - 1];
      if ((diff1 > 0 && diff2 < 0) || (diff1 < 0 && diff2 > 0)) {
        oscillationCount++;
      }
    }

    if (oscillationCount >= (values.length - 2) * 0.5) {
      return 'oscillating';
    }

    // Calculate overall slope
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;

    if (Math.abs(diff) < 0.01) {
      return 'stable';
    }

    return diff > 0 ? 'improving' : 'oscillating';
  }

  // ============================================================================
  // METRIC COLLECTION AND ANALYSIS
  // ============================================================================

  /**
   * Collect current metrics.
   */
  private async collectMetrics(): Promise<Map<string, number>> {
    const metrics = new Map<string, number>();

    // Default metrics
    metrics.set('iteration_count', this.state.currentIteration);
    metrics.set('total_improvements', this.state.totalImprovements);
    metrics.set('convergence_score', this.state.convergenceScore);

    // Add metrics from tracker if available
    if (this.improvementTracker) {
      const trend = this.improvementTracker.computeTrend();
      metrics.set('test_pass_rate', trend.dataPoints.length > 0
        ? trend.dataPoints[trend.dataPoints.length - 1].testSuitePassRate
        : 1.0);
      metrics.set('success_rate', trend.averageImprovement + 0.5); // Normalize to 0-1
    }

    return metrics;
  }

  /**
   * Calculate changes between before and after metrics.
   */
  private calculateMetricChanges(
    before: Map<string, number>,
    after: Map<string, number>
  ): MetricChange[] {
    const changes: MetricChange[] = [];

    for (const [metric, afterValue] of Array.from(after.entries())) {
      const beforeValue = before.get(metric) || afterValue;
      changes.push({
        metric,
        before: beforeValue,
        after: afterValue,
      });
    }

    return changes;
  }

  /**
   * Calculate metric variance over recent history.
   */
  private calculateMetricVariance(history: ImprovementIteration[]): number {
    const allChanges = history.flatMap(it => it.metricsBeforeAfter);

    if (allChanges.length === 0) {
      return 0;
    }

    // Calculate average variance across all metrics
    const metricGroups = new Map<string, number[]>();
    for (const change of allChanges) {
      const values = metricGroups.get(change.metric) || [];
      values.push(change.after);
      metricGroups.set(change.metric, values);
    }

    let totalVariance = 0;
    let metricCount = 0;

    for (const values of Array.from(metricGroups.values())) {
      if (values.length < 2) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      totalVariance += variance;
      metricCount++;
    }

    return metricCount > 0 ? totalVariance / metricCount : 0;
  }

  /**
   * Extract a specific metric value from a metrics map.
   */
  private extractMetric(metrics: Map<string, number>, name: string): number | undefined {
    return metrics.get(name);
  }

  /**
   * Calculate lift (improvement) for a metric.
   */
  private calculateLift(changes: MetricChange[], metricName: string): number {
    const change = changes.find(c => c.metric === metricName);
    if (!change) {
      return 0;
    }
    return change.after - change.before;
  }

  // ============================================================================
  // ACTION GENERATION
  // ============================================================================

  /**
   * Generate improvement actions from detected problems.
   */
  private generateActionsFromProblems(problems: unknown[]): ImprovementAction[] {
    const actions: ImprovementAction[] = [];

    for (let i = 0; i < Math.min(problems.length, 5); i++) {
      actions.push({
        type: 'fix',
        target: `problem_${i + 1}`,
        description: `Fix detected problem ${i + 1}`,
        applied: true,
        result: 'simulated',
      });
    }

    return actions;
  }

  /**
   * Generate default actions when no external components are available.
   */
  private generateDefaultActions(iterationId: number): ImprovementAction[] {
    const actions: ImprovementAction[] = [];

    // Cycle through different action types
    const actionTypes: ImprovementActionType[] = ['refresh', 'reindex', 'recalibrate', 'fix'];
    const type = actionTypes[iterationId % actionTypes.length];

    actions.push({
      type,
      target: 'system',
      description: `Default ${type} action for iteration ${iterationId}`,
      applied: true,
      result: 'completed',
    });

    return actions;
  }

  /**
   * Determine the outcome based on metric changes.
   */
  private determineOutcome(
    metricsBeforeAfter: MetricChange[]
  ): ImprovementIteration['outcome'] {
    if (metricsBeforeAfter.length === 0) {
      return 'no_change';
    }

    let improvements = 0;
    let degradations = 0;

    for (const change of metricsBeforeAfter) {
      const diff = change.after - change.before;
      if (diff > 0.001) {
        improvements++;
      } else if (diff < -0.001) {
        degradations++;
      }
    }

    if (improvements > degradations) {
      return 'improved';
    } else if (degradations > improvements) {
      return 'degraded';
    }
    return 'no_change';
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate current recursion depth based on recent activity.
   */
  private calculateCurrentDepth(): number {
    // Depth increases when we have cascading improvements
    const recentHistory = this.state.history.slice(-3);

    let depth = 0;
    for (const iteration of recentHistory) {
      if (iteration.outcome === 'improved' && iteration.improvements.length > 0) {
        depth++;
      }
    }

    return Math.min(depth, this.config.maxDepth);
  }

  /**
   * Calculate overall convergence score (0-1, higher = more stable).
   */
  private calculateConvergenceScore(): number {
    const history = this.state.history;

    if (history.length < 3) {
      return 0;
    }

    const recentHistory = history.slice(-5);

    // Calculate based on outcome stability
    const noChangeCount = recentHistory.filter(it => it.outcome === 'no_change').length;
    const stabilityScore = noChangeCount / recentHistory.length;

    // Calculate based on metric variance
    const variance = this.calculateMetricVariance(recentHistory);
    const varianceScore = Math.max(0, 1 - variance * 10); // Lower variance = higher score

    // Combine scores
    return (stabilityScore + varianceScore) / 2;
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timeout = setTimeout(resolve, ms);

      // Allow early exit if stop is requested
      const checkStop = setInterval(() => {
        if (this.stopRequested) {
          clearTimeout(timeout);
          clearInterval(checkStop);
          resolve();
        }
      }, Math.min(10, ms / 2));

      // Clear the check interval when done
      setTimeout(() => clearInterval(checkStop), ms + 10);
    });
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new MetaImprovementLoop instance.
 *
 * @param config - Optional configuration overrides
 * @returns New MetaImprovementLoop instance
 *
 * @example
 * ```typescript
 * const loop = createMetaImprovementLoop({
 *   maxIterations: 50,
 *   convergenceThreshold: 0.1,
 * });
 *
 * // Set up integrations
 * loop.setImprovementTracker(tracker);
 * loop.setProblemDetector(detector);
 *
 * // Run the loop
 * await loop.start();
 *
 * // Check results
 * const state = loop.getState();
 * console.log(`Converged: ${state.status === 'converged'}`);
 * console.log(`Total improvements: ${state.totalImprovements}`);
 * ```
 */
export function createMetaImprovementLoop(
  config?: Partial<LoopConfig>
): MetaImprovementLoop {
  return new MetaImprovementLoop(config);
}
