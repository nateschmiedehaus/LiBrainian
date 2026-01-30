/**
 * Bridge Module: Adaptive Resource Management <-> Vitest Configuration
 *
 * This module bridges the adaptive resource monitoring system with vitest
 * test configuration, providing dynamic worker pool detection and configuration
 * based on real-time system resource availability.
 *
 * @module test-resource-config
 */

import {
  ResourceMonitor,
  type ResourcePressure,
} from '../api/resource_monitor.js';
import {
  type AdaptivePoolConfig,
  DEFAULT_POOL_CONFIG,
  calculateWorkerBudget,
} from '../api/adaptive_pool.js';

/**
 * Configuration output for vitest worker pool management.
 *
 * Contains all necessary settings for configuring vitest's parallel
 * test execution based on detected system resources and pressure levels.
 */
export interface TestResourceConfig {
  /**
   * Vitest-specific configuration for worker pools.
   */
  vitest: {
    /**
     * Worker pool type.
     * - 'threads': Uses worker threads (shares memory, faster startup)
     * - 'forks': Uses child processes (better isolation, recommended for heavy tests)
     */
    pool: 'threads' | 'forks';
    /**
     * Maximum number of worker processes/threads to spawn.
     */
    maxWorkers: number;
    /**
     * Whether to run test files in parallel.
     * Disabled when maxWorkers is 1.
     */
    fileParallelism: boolean;
    /**
     * Whether to isolate test environments.
     * Always true for memory isolation with heavy tests.
     */
    isolate: boolean;
  };
  /**
   * Human-readable explanations for the configuration decisions.
   */
  reasoning: string[];
  /**
   * The current system resource pressure assessment.
   */
  pressure: ResourcePressure;
}

/**
 * Resource mode for test execution.
 *
 * - 'auto': Use system defaults and automatic detection
 * - 'conservative': Prioritize stability over speed
 * - 'aggressive': Maximize parallelism, use more resources
 */
export type ResourceMode = 'auto' | 'conservative' | 'aggressive';

/**
 * Detects current system resources and generates vitest configuration.
 *
 * This function performs the following:
 * 1. Creates a ResourceMonitor and takes a system snapshot
 * 2. Calculates current resource pressure
 * 3. Determines optimal worker count based on available resources
 * 4. Applies pressure-based reductions to prevent OOM conditions
 * 5. Builds a comprehensive reasoning log for debugging
 *
 * @param overrides - Optional partial configuration to override defaults
 * @returns Complete test resource configuration for vitest
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const config = detectTestResources();
 * console.log(`Using ${config.vitest.maxWorkers} workers`);
 *
 * // With conservative overrides
 * const safeConfig = detectTestResources({
 *   targetMemoryUtilization: 0.5,
 *   absoluteMaxWorkers: 4
 * });
 * ```
 */
export function detectTestResources(
  overrides?: Partial<AdaptivePoolConfig>
): TestResourceConfig {
  const monitor = new ResourceMonitor();
  const snapshot = monitor.takeSnapshot();
  const pressure = monitor.calculatePressure();

  // Merge configuration with defaults
  const config: AdaptivePoolConfig = {
    ...DEFAULT_POOL_CONFIG,
    ...overrides,
  };

  // Calculate initial worker budget based on resources
  let calculatedWorkers = calculateWorkerBudget(config, monitor);

  const reasoning: string[] = [];

  // Add system information to reasoning
  const freeMemoryGB = (snapshot.freeMemoryBytes / (1024 * 1024 * 1024)).toFixed(
    2
  );
  reasoning.push(
    `System: ${snapshot.cpuCores} cores, ${freeMemoryGB}GB free`
  );

  // Add load information
  reasoning.push(
    `Load: ${snapshot.loadAverage1m.toFixed(2)} (${pressure.level})`
  );

  // Apply pressure-based reductions
  let maxWorkers: number;
  switch (pressure.level) {
    case 'nominal':
      maxWorkers = calculatedWorkers;
      reasoning.push(`Pressure nominal: using full calculated budget`);
      break;

    case 'elevated':
      maxWorkers = Math.ceil(calculatedWorkers * 0.5);
      reasoning.push(
        `Pressure elevated: reducing workers to ${maxWorkers} (50% of ${calculatedWorkers})`
      );
      break;

    case 'critical':
      maxWorkers = 1;
      reasoning.push(
        `Pressure critical: limiting to single worker for stability`
      );
      break;

    case 'oom_imminent':
      maxWorkers = 1;
      console.warn(
        '[test-resource-config] WARNING: OOM imminent! Running with minimal workers.'
      );
      reasoning.push(
        `WARNING: OOM imminent! Memory pressure at ${(pressure.memoryPressure * 100).toFixed(1)}%`
      );
      reasoning.push(`Emergency mode: single worker only`);
      break;
  }

  // Ensure we have at least 1 worker
  maxWorkers = Math.max(1, maxWorkers);

  reasoning.push(`Calculated workers: ${maxWorkers}`);

  // Determine parallelism based on worker count
  const fileParallelism = maxWorkers > 1;

  return {
    vitest: {
      // Always use forks for better memory isolation with heavy tests
      pool: 'forks',
      maxWorkers,
      fileParallelism,
      // Always isolate for consistent test behavior
      isolate: true,
    },
    reasoning,
    pressure,
  };
}

/**
 * Gets the current test resource mode from environment variables.
 *
 * The resource mode can be configured via the LIBRARIAN_RESOURCE_MODE
 * environment variable. Valid values are:
 * - 'auto' (default): Automatic resource detection
 * - 'conservative': Use fewer resources, prioritize stability
 * - 'aggressive': Use maximum available resources
 *
 * @returns The current resource mode
 *
 * @example
 * ```typescript
 * // Set via environment
 * // LIBRARIAN_RESOURCE_MODE=conservative npm test
 *
 * const mode = getTestResourceMode();
 * // mode === 'conservative'
 * ```
 */
export function getTestResourceMode(): ResourceMode {
  const envMode = process.env.LIBRARIAN_RESOURCE_MODE;

  if (envMode === 'conservative' || envMode === 'aggressive') {
    return envMode;
  }

  return 'auto';
}

/**
 * Generates configuration overrides based on the resource mode.
 *
 * Different modes adjust the adaptive pool configuration to
 * trade off between performance and resource safety:
 *
 * - 'auto': No overrides, use default configuration
 * - 'conservative': Lower utilization targets, start with fewer workers
 * - 'aggressive': Higher utilization targets, maximize parallelism
 *
 * @param mode - The resource mode to apply
 * @returns Partial configuration overrides for the adaptive pool
 *
 * @example
 * ```typescript
 * const mode = getTestResourceMode();
 * const overrides = applyResourceModeOverrides(mode);
 * const config = detectTestResources(overrides);
 * ```
 */
export function applyResourceModeOverrides(
  mode: ResourceMode
): Partial<AdaptivePoolConfig> {
  switch (mode) {
    case 'auto':
      // Use defaults, no overrides
      return {};

    case 'conservative':
      return {
        targetMemoryUtilization: 0.5,
        targetCpuUtilization: 0.6,
        initialWorkerEstimate: 'conservative',
      };

    case 'aggressive':
      return {
        targetMemoryUtilization: 0.85,
        targetCpuUtilization: 0.9,
        initialWorkerEstimate: 'aggressive',
      };
  }
}

/**
 * Convenience function to get fully configured test resources.
 *
 * Combines mode detection, override application, and resource detection
 * into a single call for common use cases.
 *
 * @returns Complete test resource configuration based on environment and system state
 *
 * @example
 * ```typescript
 * // In vitest.config.ts
 * import { getConfiguredTestResources } from './test-resource-config.js';
 *
 * const resources = getConfiguredTestResources();
 * export default defineConfig({
 *   test: {
 *     pool: resources.vitest.pool,
 *     poolOptions: {
 *       forks: {
 *         maxForks: resources.vitest.maxWorkers,
 *       },
 *     },
 *     fileParallelism: resources.vitest.fileParallelism,
 *     isolate: resources.vitest.isolate,
 *   },
 * });
 * ```
 */
export function getConfiguredTestResources(): TestResourceConfig {
  const mode = getTestResourceMode();
  const overrides = applyResourceModeOverrides(mode);
  return detectTestResources(overrides);
}
