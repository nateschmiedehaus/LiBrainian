/**
 * Adaptive Worker Pool Calculation Module
 *
 * Provides adaptive worker pool configuration and calculation based on
 * real-time system resource monitoring. Dynamically adjusts worker counts
 * to optimize throughput while preventing resource exhaustion.
 */

import { ResourceMonitor } from './resource_monitor.js';

/**
 * Configuration for adaptive worker pool behavior.
 *
 * Controls resource allocation ratios, adaptive scaling behavior,
 * and safety limits for worker pool management.
 */
export interface AdaptivePoolConfig {
  /**
   * Target memory utilization ratio.
   * E.g., 0.7 = use up to 70% of free memory for workers.
   */
  targetMemoryUtilization: number;

  /**
   * Target CPU utilization ratio.
   * E.g., 0.8 = use up to 80% of available CPU capacity.
   */
  targetCpuUtilization: number;

  /**
   * Minimum percentage of total memory to always keep free.
   * E.g., 0.2 = always keep 20% of total memory available.
   */
  minReservedMemoryPercent: number;

  /**
   * Minimum number of CPU cores to reserve for system operations.
   * E.g., 2 = always keep 2 cores free from worker utilization.
   */
  minReservedCpuCores: number;

  /**
   * Strategy for initial worker count estimation.
   * - 'conservative': Start with fewer workers, scale up gradually
   * - 'moderate': Balance between performance and safety
   * - 'aggressive': Start with more workers, scale down if needed
   */
  initialWorkerEstimate: 'conservative' | 'moderate' | 'aggressive';

  /**
   * Add workers if current utilization is below this threshold.
   * E.g., 0.5 = scale up if using less than 50% of capacity.
   */
  scaleUpThreshold: number;

  /**
   * Remove workers if current utilization exceeds this threshold.
   * E.g., 0.9 = scale down if using more than 90% of capacity.
   */
  scaleDownThreshold: number;

  /**
   * Interval in milliseconds between resource reassessments.
   */
  checkIntervalMs: number;

  /**
   * Hard cap on worker count regardless of available resources.
   */
  absoluteMaxWorkers: number;

  /**
   * Minimum worker count that will always be maintained.
   */
  absoluteMinWorkers: number;

  /**
   * Memory utilization threshold that triggers emergency stop.
   * E.g., 0.95 = emergency stop if 95% of memory is consumed.
   */
  oomKillThreshold: number;
}

/**
 * Default configuration for adaptive worker pools.
 *
 * Provides conservative defaults suitable for most workloads while
 * maintaining system stability and responsiveness.
 */
export const DEFAULT_POOL_CONFIG: AdaptivePoolConfig = {
  targetMemoryUtilization: 0.7,
  targetCpuUtilization: 0.8,
  minReservedMemoryPercent: 0.2,
  minReservedCpuCores: 2,
  initialWorkerEstimate: 'conservative',
  scaleUpThreshold: 0.5,
  scaleDownThreshold: 0.9,
  checkIntervalMs: 5000,
  absoluteMaxWorkers: 32,
  absoluteMinWorkers: 1,
  oomKillThreshold: 0.95,
};

/**
 * Calculates the optimal worker budget based on current system resources.
 *
 * Takes into account both memory and CPU constraints, applies load-based
 * adjustments, and enforces safety bounds to prevent resource exhaustion.
 *
 * @param config - The adaptive pool configuration
 * @param monitor - The resource monitor providing system metrics
 * @returns The recommended number of workers
 *
 * @example
 * ```typescript
 * const monitor = new ResourceMonitor();
 * const budget = calculateWorkerBudget(DEFAULT_POOL_CONFIG, monitor);
 * console.log(`Recommended workers: ${budget}`);
 * ```
 */
export function calculateWorkerBudget(
  config: AdaptivePoolConfig,
  monitor: ResourceMonitor
): number {
  // Take a fresh snapshot of system resources
  const snapshot = monitor.takeSnapshot();

  // Calculate estimated memory per worker
  // Use historical data if available, otherwise default to 5% of total memory
  const historicalCost = monitor.getHistoricalCost('ast_analysis');
  const estimatedMemoryPerWorker =
    historicalCost?.estimatedMemoryBytes ?? snapshot.totalMemoryBytes * 0.05;

  // Calculate memory-based worker limit
  const usableMemory = snapshot.freeMemoryBytes * config.targetMemoryUtilization;
  const memoryBasedWorkers =
    estimatedMemoryPerWorker > 0
      ? Math.floor(usableMemory / estimatedMemoryPerWorker)
      : config.absoluteMaxWorkers;

  // Calculate CPU-based worker limit
  const usableCores = Math.max(1, snapshot.cpuCores - config.minReservedCpuCores);
  const cpuBasedWorkers = Math.floor(usableCores * config.targetCpuUtilization);

  // Apply load adjustment multiplier
  const loadRatio = snapshot.loadAverage1m / snapshot.cpuCores;
  let loadMultiplier: number;
  if (loadRatio > 1.0) {
    // System is overloaded, significantly reduce worker count
    loadMultiplier = 0.5;
  } else if (loadRatio > 0.7) {
    // System is under moderate load, slightly reduce worker count
    loadMultiplier = 0.75;
  } else {
    // System has capacity, use full calculated budget
    loadMultiplier = 1.0;
  }

  // Take minimum of memory and CPU limits, apply load multiplier
  const rawWorkerCount = Math.min(memoryBasedWorkers, cpuBasedWorkers);
  const adjustedWorkerCount = Math.floor(rawWorkerCount * loadMultiplier);

  // Apply absolute bounds
  return Math.max(
    config.absoluteMinWorkers,
    Math.min(config.absoluteMaxWorkers, adjustedWorkerCount)
  );
}

/**
 * Adaptive worker pool manager that provides intelligent scaling recommendations.
 *
 * Maintains configuration and state for worker pool management, providing
 * methods to query current recommendations and scaling decisions.
 *
 * @example
 * ```typescript
 * const pool = new AdaptivePool({
 *   targetMemoryUtilization: 0.6,
 *   absoluteMaxWorkers: 16
 * });
 *
 * pool.setCurrentWorkerCount(4);
 *
 * const { workers, reasoning } = pool.recommend();
 * console.log(`Recommended: ${workers} workers`);
 * reasoning.forEach(r => console.log(`  - ${r}`));
 *
 * if (pool.shouldScaleUp()) {
 *   // Add more workers
 * } else if (pool.shouldScaleDown()) {
 *   // Remove some workers
 * }
 * ```
 */
export class AdaptivePool {
  private readonly config: AdaptivePoolConfig;
  private readonly monitor: ResourceMonitor;
  private currentWorkerCount: number;

  /**
   * Creates a new AdaptivePool instance.
   *
   * @param config - Partial configuration to override defaults
   */
  constructor(config?: Partial<AdaptivePoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.monitor = new ResourceMonitor();
    this.currentWorkerCount = this.calculateInitialWorkerCount();
  }

  /**
   * Calculates the initial worker count based on configuration strategy.
   *
   * @returns Initial worker count
   */
  private calculateInitialWorkerCount(): number {
    const snapshot = this.monitor.takeSnapshot();
    const usableCores = Math.max(1, snapshot.cpuCores - this.config.minReservedCpuCores);

    let baseCount: number;
    switch (this.config.initialWorkerEstimate) {
      case 'conservative':
        // Start with 25% of usable cores
        baseCount = Math.max(1, Math.floor(usableCores * 0.25));
        break;
      case 'moderate':
        // Start with 50% of usable cores
        baseCount = Math.max(1, Math.floor(usableCores * 0.5));
        break;
      case 'aggressive':
        // Start with 75% of usable cores
        baseCount = Math.max(1, Math.floor(usableCores * 0.75));
        break;
    }

    return Math.max(
      this.config.absoluteMinWorkers,
      Math.min(this.config.absoluteMaxWorkers, baseCount)
    );
  }

  /**
   * Gets the current pool configuration.
   *
   * @returns The active AdaptivePoolConfig
   */
  getConfig(): AdaptivePoolConfig {
    return { ...this.config };
  }

  /**
   * Gets the current worker count.
   *
   * @returns Current number of active workers
   */
  getCurrentWorkerCount(): number {
    return this.currentWorkerCount;
  }

  /**
   * Sets the current worker count.
   *
   * @param count - The new worker count
   */
  setCurrentWorkerCount(count: number): void {
    this.currentWorkerCount = Math.max(
      this.config.absoluteMinWorkers,
      Math.min(this.config.absoluteMaxWorkers, count)
    );
  }

  /**
   * Provides a scaling recommendation with detailed reasoning.
   *
   * Analyzes current system state and returns the optimal worker count
   * along with explanations for the recommendation.
   *
   * @returns Object containing recommended worker count and reasoning array
   */
  recommend(): { workers: number; reasoning: string[] } {
    const reasoning: string[] = [];
    const snapshot = this.monitor.takeSnapshot();
    const pressure = this.monitor.calculatePressure();

    // Check for OOM condition
    const memoryUsageRatio =
      (snapshot.totalMemoryBytes - snapshot.freeMemoryBytes) /
      snapshot.totalMemoryBytes;

    if (memoryUsageRatio >= this.config.oomKillThreshold) {
      reasoning.push(
        `EMERGENCY: Memory usage at ${(memoryUsageRatio * 100).toFixed(1)}% ` +
          `exceeds OOM threshold of ${(this.config.oomKillThreshold * 100).toFixed(0)}%`
      );
      return {
        workers: this.config.absoluteMinWorkers,
        reasoning,
      };
    }

    // Calculate budget
    const budget = calculateWorkerBudget(this.config, this.monitor);

    // Build reasoning
    reasoning.push(
      `System state: ${pressure.level} ` +
        `(memory: ${(pressure.memoryPressure * 100).toFixed(1)}%, ` +
        `CPU: ${(pressure.cpuPressure * 100).toFixed(1)}%)`
    );

    const loadRatio = snapshot.loadAverage1m / snapshot.cpuCores;
    reasoning.push(
      `Load average: ${snapshot.loadAverage1m.toFixed(2)} ` +
        `(${(loadRatio * 100).toFixed(0)}% of ${snapshot.cpuCores} cores)`
    );

    const historicalCost = this.monitor.getHistoricalCost('ast_analysis');
    if (historicalCost) {
      const memoryMB = (historicalCost.estimatedMemoryBytes / (1024 * 1024)).toFixed(1);
      reasoning.push(
        `Historical memory per worker: ${memoryMB}MB ` +
          `(confidence: ${(historicalCost.confidence * 100).toFixed(0)}%)`
      );
    } else {
      const defaultMB = ((snapshot.totalMemoryBytes * 0.05) / (1024 * 1024)).toFixed(1);
      reasoning.push(`Using default memory estimate: ${defaultMB}MB per worker`);
    }

    if (budget > this.currentWorkerCount) {
      reasoning.push(
        `Recommendation: Scale UP from ${this.currentWorkerCount} to ${budget} workers`
      );
    } else if (budget < this.currentWorkerCount) {
      reasoning.push(
        `Recommendation: Scale DOWN from ${this.currentWorkerCount} to ${budget} workers`
      );
    } else {
      reasoning.push(
        `Recommendation: Maintain current ${this.currentWorkerCount} workers`
      );
    }

    return { workers: budget, reasoning };
  }

  /**
   * Determines if the pool should scale up based on current utilization.
   *
   * Returns true if current resource utilization is below the scaleUpThreshold,
   * indicating capacity for additional workers.
   *
   * @returns True if scaling up is recommended
   */
  shouldScaleUp(): boolean {
    const pressure = this.monitor.calculatePressure();
    const currentUtilization = Math.max(
      pressure.memoryPressure,
      pressure.cpuPressure
    );

    if (currentUtilization >= this.config.scaleUpThreshold) {
      return false;
    }

    const budget = calculateWorkerBudget(this.config, this.monitor);
    return budget > this.currentWorkerCount;
  }

  /**
   * Determines if the pool should scale down based on current utilization.
   *
   * Returns true if current resource utilization exceeds the scaleDownThreshold,
   * indicating resource pressure that should be relieved.
   *
   * @returns True if scaling down is recommended
   */
  shouldScaleDown(): boolean {
    const pressure = this.monitor.calculatePressure();
    const currentUtilization = Math.max(
      pressure.memoryPressure,
      pressure.cpuPressure
    );

    // Always scale down if approaching OOM
    const snapshot = this.monitor.getLatestSnapshot() ?? this.monitor.takeSnapshot();
    const memoryUsageRatio =
      (snapshot.totalMemoryBytes - snapshot.freeMemoryBytes) /
      snapshot.totalMemoryBytes;

    if (memoryUsageRatio >= this.config.oomKillThreshold) {
      return true;
    }

    if (currentUtilization <= this.config.scaleDownThreshold) {
      return false;
    }

    const budget = calculateWorkerBudget(this.config, this.monitor);
    return budget < this.currentWorkerCount;
  }

  /**
   * Gets the underlying ResourceMonitor instance.
   *
   * Useful for recording operation costs or accessing detailed metrics.
   *
   * @returns The ResourceMonitor used by this pool
   */
  getMonitor(): ResourceMonitor {
    return this.monitor;
  }
}
