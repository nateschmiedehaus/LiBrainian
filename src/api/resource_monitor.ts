/**
 * Resource Detection and Monitoring Module
 *
 * Provides real-time system resource monitoring, pressure detection,
 * and adaptive worker scaling recommendations for parallel operations.
 */

import * as os from 'os';
import { getAvailableMemoryBytes } from './system_memory.js';

/**
 * A point-in-time snapshot of system resource utilization.
 */
export interface ResourceSnapshot {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Number of logical CPU cores */
  cpuCores: number;
  /** Current CPU utilization as percentage (0-100) */
  cpuUsagePercent: number;
  /** Total system memory in bytes */
  totalMemoryBytes: number;
  /** Free system memory in bytes */
  freeMemoryBytes: number;
  /** Available system memory in bytes (best-effort, may be same as freeMemoryBytes) */
  availableMemoryBytes: number;
  /** Node.js heap memory currently in use */
  heapUsedBytes: number;
  /** Total Node.js heap memory allocated */
  heapTotalBytes: number;
  /** 1-minute load average */
  loadAverage1m: number;
  /** 5-minute load average */
  loadAverage5m: number;
  /** 15-minute load average */
  loadAverage15m: number;
}

/**
 * Configuration for resource allocation per worker.
 */
export interface ResourceBudget {
  /** Maximum number of concurrent workers */
  maxWorkers: number;
  /** Memory budget per worker in bytes */
  memoryPerWorkerBytes: number;
  /** CPU budget per worker as percentage */
  cpuPerWorkerPercent: number;
  /** Percentage of memory to keep free for system (0-100) */
  reservedMemoryPercent: number;
  /** Number of CPU cores to reserve for system */
  reservedCpuCores: number;
}

/**
 * Current resource pressure assessment with scaling recommendation.
 */
export interface ResourcePressure {
  /** Overall pressure level classification */
  level: 'nominal' | 'elevated' | 'critical' | 'oom_imminent';
  /** Memory pressure on 0-1 scale (1 = fully utilized) */
  memoryPressure: number;
  /** CPU pressure on 0-1 scale (1 = fully utilized) */
  cpuPressure: number;
  /** Recommended action based on pressure levels */
  recommendation: 'proceed' | 'reduce_workers' | 'pause' | 'abort';
}

/**
 * Types of operations that can be tracked for resource estimation.
 */
export type OperationType =
  | 'ast_analysis'
  | 'embedding_generation'
  | 'llm_call'
  | 'file_read'
  | 'test_execution';

/**
 * Actual resource usage recorded for an operation.
 */
export interface ResourceUsage {
  /** Peak memory consumption during operation */
  peakMemoryBytes: number;
  /** Average memory consumption during operation */
  averageMemoryBytes: number;
  /** CPU time consumed in milliseconds */
  cpuTimeMs: number;
  /** Wall clock time in milliseconds */
  wallTimeMs: number;
}

/**
 * Estimated resource requirements for an operation type.
 */
export interface ResourceEstimate {
  /** Estimated memory requirement in bytes */
  estimatedMemoryBytes: number;
  /** Estimated CPU usage as percentage */
  estimatedCpuPercent: number;
  /** Confidence level 0-1 based on sample count */
  confidence: number;
  /** Number of samples used to compute estimate */
  sampleCount: number;
}

/**
 * Internal structure for tracking operation costs with exponential moving average.
 */
interface OperationCostTracker {
  estimatedMemoryBytes: number;
  estimatedCpuPercent: number;
  sampleCount: number;
}

/**
 * Configuration options for the ResourceMonitor.
 */
export interface ResourceMonitorConfig {
  /** Size of the snapshot ring buffer (default: 60) */
  ringBufferSize?: number;
  /** Alpha value for exponential moving average (default: 0.3) */
  emaAlpha?: number;
}

/**
 * Monitors system resources and provides adaptive scaling recommendations.
 *
 * Uses a ring buffer to maintain historical snapshots and tracks operation
 * costs using exponential moving averages for resource estimation.
 *
 * @example
 * ```typescript
 * const monitor = new ResourceMonitor({ ringBufferSize: 120 });
 *
 * // Take periodic snapshots
 * const snapshot = monitor.takeSnapshot();
 *
 * // Check pressure and get recommendations
 * const pressure = monitor.calculatePressure();
 * if (pressure.recommendation === 'reduce_workers') {
 *   // Scale down workers
 * }
 *
 * // Track operation costs
 * monitor.recordOperationCost('ast_analysis', {
 *   peakMemoryBytes: 50_000_000,
 *   averageMemoryBytes: 30_000_000,
 *   cpuTimeMs: 150,
 *   wallTimeMs: 200
 * });
 * ```
 */
export class ResourceMonitor {
  private readonly ringBuffer: ResourceSnapshot[];
  private readonly ringBufferSize: number;
  private ringBufferIndex: number = 0;
  private snapshotCount: number = 0;

  private readonly operationCosts: Map<OperationType, OperationCostTracker> =
    new Map();
  private readonly emaAlpha: number;

  private lastCpuInfo: { idle: number; total: number } | null = null;

  /**
   * Creates a new ResourceMonitor instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config: ResourceMonitorConfig = {}) {
    this.ringBufferSize = config.ringBufferSize ?? 60;
    this.emaAlpha = config.emaAlpha ?? 0.3;
    this.ringBuffer = new Array(this.ringBufferSize);
  }

  /**
   * Takes a snapshot of current system resource utilization.
   *
   * Captures CPU, memory, and load average information using Node.js
   * os module and process.memoryUsage().
   *
   * @returns A ResourceSnapshot with current system metrics
   */
  takeSnapshot(): ResourceSnapshot {
    const memUsage = process.memoryUsage();
    const loadAvg = os.loadavg();
    const cpuUsagePercent = this.measureCpuUsage();
    const available = getAvailableMemoryBytes();

    const snapshot: ResourceSnapshot = {
      timestamp: Date.now(),
      cpuCores: os.cpus().length,
      cpuUsagePercent,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      availableMemoryBytes: available.bytes,
      heapUsedBytes: memUsage.heapUsed,
      heapTotalBytes: memUsage.heapTotal,
      loadAverage1m: loadAvg[0],
      loadAverage5m: loadAvg[1],
      loadAverage15m: loadAvg[2],
    };

    // Store in ring buffer
    this.ringBuffer[this.ringBufferIndex] = snapshot;
    this.ringBufferIndex = (this.ringBufferIndex + 1) % this.ringBufferSize;
    this.snapshotCount = Math.min(this.snapshotCount + 1, this.ringBufferSize);

    return snapshot;
  }

  /**
   * Measures CPU usage since the last measurement.
   *
   * @returns CPU usage as percentage (0-100)
   */
  private measureCpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total +=
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.idle +
        cpu.times.irq;
    }

    if (this.lastCpuInfo === null) {
      this.lastCpuInfo = { idle, total };
      // Return load average based estimate for first call
      const loadAvg = os.loadavg()[0];
      const cores = cpus.length;
      return Math.min(100, (loadAvg / cores) * 100);
    }

    const idleDiff = idle - this.lastCpuInfo.idle;
    const totalDiff = total - this.lastCpuInfo.total;

    this.lastCpuInfo = { idle, total };

    if (totalDiff === 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100));
  }

  /**
   * Calculates current resource pressure levels and provides a recommendation.
   *
   * Pressure policy:
   * - Memory drives OOM classification (cpu saturation alone is not "OOM imminent").
   * - CPU contributes up to "critical" to reduce concurrency, but never upgrades to OOM.
   *
   * Memory thresholds (pressure = used/total, using available memory when possible):
   * - nominal:  < 0.70
   * - elevated: < 0.85
   * - critical: < 0.95
   * - oom_imminent: >= 0.97 OR available memory < 512MB
   *
   * CPU thresholds (pressure = cpuUsagePercent/100):
   * - nominal:  < 0.70
   * - elevated: < 0.85
   * - critical: >= 0.85
   *
   * @returns ResourcePressure with level and recommendation
   */
  calculatePressure(): ResourcePressure {
    // Take a fresh snapshot if we don't have any
    const snapshot =
      this.snapshotCount > 0
        ? this.getLatestSnapshot()!
        : this.takeSnapshot();

    // Calculate memory pressure (0-1 scale)
    // Prefer "available" memory when possible to avoid macOS reclaimable-memory pessimism.
    const availableBytes = Number.isFinite(snapshot.availableMemoryBytes)
      ? snapshot.availableMemoryBytes
      : snapshot.freeMemoryBytes;
    const usedMemory = snapshot.totalMemoryBytes - Math.max(0, Math.min(snapshot.totalMemoryBytes, availableBytes));
    const memoryPressure = usedMemory / snapshot.totalMemoryBytes;

    // Calculate CPU pressure (0-1 scale)
    const cpuPressure = snapshot.cpuUsagePercent / 100;

    const levelRank: Record<ResourcePressure['level'], number> = {
      nominal: 0,
      elevated: 1,
      critical: 2,
      oom_imminent: 3,
    };

    const memoryLevel: ResourcePressure['level'] = (() => {
      if (availableBytes < 512 * 1024 * 1024) return 'oom_imminent';
      if (memoryPressure >= 0.97) return 'oom_imminent';
      if (memoryPressure >= 0.85) return 'critical';
      if (memoryPressure >= 0.70) return 'elevated';
      return 'nominal';
    })();

    const cpuLevel: ResourcePressure['level'] = (() => {
      if (cpuPressure >= 0.85) return 'critical';
      if (cpuPressure >= 0.70) return 'elevated';
      return 'nominal';
    })();

    const level: ResourcePressure['level'] =
      levelRank[memoryLevel] >= levelRank[cpuLevel] ? memoryLevel : cpuLevel;

    const recommendation: ResourcePressure['recommendation'] = level === 'nominal'
      ? 'proceed'
      : level === 'elevated'
        ? 'reduce_workers'
        : level === 'critical'
          ? 'pause'
          : 'abort';

    return {
      level,
      memoryPressure,
      cpuPressure,
      recommendation,
    };
  }

  /**
   * Suggests an optimal worker count based on current resource utilization.
   *
   * Takes into account current pressure, target utilization levels,
   * reserved resources, and absolute min/max bounds.
   *
   * @param currentWorkers - Current number of active workers
   * @param config - Configuration for worker scaling decisions
   * @returns Suggested number of workers
   */
  suggestWorkerCount(
    currentWorkers: number,
    config: {
      /** Target memory utilization (0-1) */
      targetMemoryUtilization: number;
      /** Target CPU utilization (0-1) */
      targetCpuUtilization: number;
      /** Minimum memory to keep free (0-100 percent) */
      minReservedMemoryPercent: number;
      /** Minimum CPU cores to reserve */
      minReservedCpuCores: number;
      /** Absolute maximum workers allowed */
      absoluteMaxWorkers: number;
      /** Absolute minimum workers to maintain */
      absoluteMinWorkers: number;
    }
  ): number {
    const snapshot =
      this.snapshotCount > 0
        ? this.getLatestSnapshot()!
        : this.takeSnapshot();

    const pressure = this.calculatePressure();

    // If under critical pressure, reduce immediately
    if (pressure.level === 'oom_imminent') {
      return config.absoluteMinWorkers;
    }

    if (pressure.level === 'critical') {
      return Math.max(
        config.absoluteMinWorkers,
        Math.floor(currentWorkers * 0.5)
      );
    }

    // Calculate available resources after reservations
    const reservedMemoryBytes =
      snapshot.totalMemoryBytes * (config.minReservedMemoryPercent / 100);
    const snapshotAvailableBytes = Number.isFinite(snapshot.availableMemoryBytes)
      ? snapshot.availableMemoryBytes
      : snapshot.freeMemoryBytes;
    const availableMemoryBytes =
      snapshotAvailableBytes - reservedMemoryBytes;

    const availableCores = Math.max(
      1,
      snapshot.cpuCores - config.minReservedCpuCores
    );

    // Estimate memory per worker (use historical average if available)
    const avgMemoryPerWorker = this.estimateMemoryPerWorker(currentWorkers);

    // Calculate worker limits based on memory
    const memoryBasedLimit =
      avgMemoryPerWorker > 0
        ? Math.floor(
            (availableMemoryBytes * config.targetMemoryUtilization) /
              avgMemoryPerWorker
          )
        : config.absoluteMaxWorkers;

    // Calculate worker limits based on CPU
    const cpuBasedLimit = Math.floor(
      availableCores * config.targetCpuUtilization * 2 // Allow some oversubscription
    );

    // Take the minimum of memory and CPU based limits
    let suggestedWorkers = Math.min(memoryBasedLimit, cpuBasedLimit);

    // Apply gradual scaling based on current pressure
    if (pressure.level === 'elevated') {
      suggestedWorkers = Math.min(suggestedWorkers, currentWorkers);
    } else if (pressure.level === 'nominal' && suggestedWorkers > currentWorkers) {
      // Scale up gradually
      suggestedWorkers = Math.min(
        suggestedWorkers,
        currentWorkers + Math.ceil(currentWorkers * 0.25) + 1
      );
    }

    // Apply absolute bounds
    return Math.max(
      config.absoluteMinWorkers,
      Math.min(config.absoluteMaxWorkers, suggestedWorkers)
    );
  }

  /**
   * Estimates average memory usage per worker based on recent snapshots.
   *
   * @param currentWorkers - Current number of workers
   * @returns Estimated memory per worker in bytes
   */
  private estimateMemoryPerWorker(currentWorkers: number): number {
    if (currentWorkers <= 0 || this.snapshotCount === 0) {
      return 0;
    }

    const snapshot = this.getLatestSnapshot()!;
    const usedMemory = snapshot.totalMemoryBytes - snapshot.freeMemoryBytes;

    // Rough estimate: assume workers use 60% of consumed memory
    return (usedMemory * 0.6) / currentWorkers;
  }

  /**
   * Records the actual resource cost of an operation for future estimation.
   *
   * Uses exponential moving average to weight recent observations more heavily
   * while maintaining historical context.
   *
   * @param operation - The type of operation being tracked
   * @param actual - The actual resource usage observed
   */
  recordOperationCost(operation: OperationType, actual: ResourceUsage): void {
    const existing = this.operationCosts.get(operation);

    // Calculate CPU percent from timing
    const cpuPercent =
      actual.wallTimeMs > 0
        ? (actual.cpuTimeMs / actual.wallTimeMs) * 100
        : 0;

    if (!existing) {
      // First observation
      this.operationCosts.set(operation, {
        estimatedMemoryBytes: actual.peakMemoryBytes,
        estimatedCpuPercent: cpuPercent,
        sampleCount: 1,
      });
    } else {
      // Exponential moving average update
      const alpha = this.emaAlpha;
      this.operationCosts.set(operation, {
        estimatedMemoryBytes:
          alpha * actual.peakMemoryBytes +
          (1 - alpha) * existing.estimatedMemoryBytes,
        estimatedCpuPercent:
          alpha * cpuPercent + (1 - alpha) * existing.estimatedCpuPercent,
        sampleCount: existing.sampleCount + 1,
      });
    }
  }

  /**
   * Retrieves the historical cost estimate for an operation type.
   *
   * Confidence is calculated based on sample count, reaching high confidence
   * after approximately 10 samples.
   *
   * @param operation - The operation type to look up
   * @returns ResourceEstimate if data exists, null otherwise
   */
  getHistoricalCost(operation: OperationType): ResourceEstimate | null {
    const tracker = this.operationCosts.get(operation);

    if (!tracker) {
      return null;
    }

    // Confidence grows with sample count, asymptotically approaching 1
    // Reaches ~0.9 confidence at 10 samples
    const confidence = 1 - Math.exp(-tracker.sampleCount / 5);

    return {
      estimatedMemoryBytes: tracker.estimatedMemoryBytes,
      estimatedCpuPercent: tracker.estimatedCpuPercent,
      confidence,
      sampleCount: tracker.sampleCount,
    };
  }

  /**
   * Gets the most recent snapshot from the ring buffer.
   *
   * @returns The latest ResourceSnapshot or null if no snapshots exist
   */
  getLatestSnapshot(): ResourceSnapshot | null {
    if (this.snapshotCount === 0) {
      return null;
    }

    const index =
      (this.ringBufferIndex - 1 + this.ringBufferSize) % this.ringBufferSize;
    return this.ringBuffer[index];
  }

  /**
   * Gets all snapshots currently in the ring buffer, oldest first.
   *
   * @returns Array of ResourceSnapshots in chronological order
   */
  getSnapshots(): ResourceSnapshot[] {
    if (this.snapshotCount === 0) {
      return [];
    }

    const snapshots: ResourceSnapshot[] = [];
    const startIndex =
      this.snapshotCount < this.ringBufferSize
        ? 0
        : this.ringBufferIndex;

    for (let i = 0; i < this.snapshotCount; i++) {
      const index = (startIndex + i) % this.ringBufferSize;
      snapshots.push(this.ringBuffer[index]);
    }

    return snapshots;
  }

  /**
   * Clears all recorded operation costs and snapshots.
   */
  reset(): void {
    this.operationCosts.clear();
    this.ringBufferIndex = 0;
    this.snapshotCount = 0;
    this.lastCpuInfo = null;
  }
}
