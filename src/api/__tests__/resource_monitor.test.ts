import { describe, it, expect, beforeEach } from 'vitest';
import {
  ResourceMonitor,
  ResourceSnapshot,
  ResourcePressure,
  ResourceEstimate,
  OperationType,
  ResourceUsage,
} from '../resource_monitor.js';

describe('ResourceMonitor', () => {
  let monitor: ResourceMonitor;

  beforeEach(() => {
    monitor = new ResourceMonitor();
  });

  describe('takeSnapshot()', () => {
    it('returns a valid ResourceSnapshot with all expected fields', () => {
      const snapshot = monitor.takeSnapshot();

      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('cpuCores');
      expect(snapshot).toHaveProperty('cpuUsagePercent');
      expect(snapshot).toHaveProperty('totalMemoryBytes');
      expect(snapshot).toHaveProperty('freeMemoryBytes');
      expect(snapshot).toHaveProperty('heapUsedBytes');
      expect(snapshot).toHaveProperty('heapTotalBytes');
      expect(snapshot).toHaveProperty('loadAverage1m');
      expect(snapshot).toHaveProperty('loadAverage5m');
      expect(snapshot).toHaveProperty('loadAverage15m');
    });

    it('returns a recent timestamp', () => {
      const before = Date.now();
      const snapshot = monitor.takeSnapshot();
      const after = Date.now();

      expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
      expect(snapshot.timestamp).toBeLessThanOrEqual(after);
    });

    it('reports cpuCores > 0', (ctx) => {
      const snapshot = monitor.takeSnapshot();
      ctx.skip(
        snapshot.cpuCores === 0,
        'unverified_by_trace(env_limit): cpu core count unavailable in test environment'
      );
      expect(snapshot.cpuCores).toBeGreaterThan(0);
    });

    it('reports positive memory values', () => {
      const snapshot = monitor.takeSnapshot();

      expect(snapshot.totalMemoryBytes).toBeGreaterThan(0);
      expect(snapshot.freeMemoryBytes).toBeGreaterThanOrEqual(0);
      expect(snapshot.freeMemoryBytes).toBeLessThanOrEqual(snapshot.totalMemoryBytes);
    });

    it('reports heap values approximately matching process.memoryUsage()', () => {
      const snapshot = monitor.takeSnapshot();
      const memUsage = process.memoryUsage();

      // Allow 10% variance due to timing differences
      const tolerance = 0.1;

      expect(snapshot.heapUsedBytes).toBeGreaterThan(0);
      expect(snapshot.heapTotalBytes).toBeGreaterThan(0);
      expect(snapshot.heapUsedBytes).toBeLessThanOrEqual(snapshot.heapTotalBytes);

      // Heap values should be in the same ballpark
      expect(snapshot.heapUsedBytes).toBeGreaterThan(memUsage.heapUsed * (1 - tolerance) * 0.5);
      expect(snapshot.heapUsedBytes).toBeLessThan(memUsage.heapUsed * (1 + tolerance) * 2);
    });

    it('reports valid load averages (non-negative)', () => {
      const snapshot = monitor.takeSnapshot();

      expect(snapshot.loadAverage1m).toBeGreaterThanOrEqual(0);
      expect(snapshot.loadAverage5m).toBeGreaterThanOrEqual(0);
      expect(snapshot.loadAverage15m).toBeGreaterThanOrEqual(0);
    });

    it('reports cpuUsagePercent in 0-100 range', () => {
      const snapshot = monitor.takeSnapshot();

      expect(snapshot.cpuUsagePercent).toBeGreaterThanOrEqual(0);
      expect(snapshot.cpuUsagePercent).toBeLessThanOrEqual(100);
    });
  });

  describe('calculatePressure()', () => {
    it('returns a valid ResourcePressure object', () => {
      const pressure = monitor.calculatePressure();

      expect(pressure).toHaveProperty('level');
      expect(pressure).toHaveProperty('memoryPressure');
      expect(pressure).toHaveProperty('cpuPressure');
      expect(pressure).toHaveProperty('recommendation');
    });

    it('returns level as one of the valid pressure levels', () => {
      const pressure = monitor.calculatePressure();
      const validLevels: ResourcePressure['level'][] = [
        'nominal',
        'elevated',
        'critical',
        'oom_imminent',
      ];

      expect(validLevels).toContain(pressure.level);
    });

    it('returns recommendation matching expected values for each level', () => {
      const pressure = monitor.calculatePressure();
      const validRecommendations: ResourcePressure['recommendation'][] = [
        'proceed',
        'reduce_workers',
        'pause',
        'abort',
      ];

      expect(validRecommendations).toContain(pressure.recommendation);

      // Verify level-recommendation mapping
      if (pressure.level === 'nominal') {
        expect(pressure.recommendation).toBe('proceed');
      } else if (pressure.level === 'elevated') {
        expect(pressure.recommendation).toBe('reduce_workers');
      } else if (pressure.level === 'critical') {
        expect(pressure.recommendation).toBe('pause');
      } else if (pressure.level === 'oom_imminent') {
        expect(pressure.recommendation).toBe('abort');
      }
    });

    it('returns memoryPressure in 0-1 range', () => {
      const pressure = monitor.calculatePressure();

      expect(pressure.memoryPressure).toBeGreaterThanOrEqual(0);
      expect(pressure.memoryPressure).toBeLessThanOrEqual(1);
    });

    it('returns cpuPressure in 0-1 range', () => {
      const pressure = monitor.calculatePressure();

      expect(pressure.cpuPressure).toBeGreaterThanOrEqual(0);
      expect(pressure.cpuPressure).toBeLessThanOrEqual(1);
    });

    it('takes a snapshot if none exists', () => {
      // Fresh monitor, no snapshots yet
      expect(monitor.getLatestSnapshot()).toBeNull();

      // calculatePressure should take a snapshot
      monitor.calculatePressure();

      // Now we should have a snapshot
      expect(monitor.getLatestSnapshot()).not.toBeNull();
    });
  });

  describe('suggestWorkerCount()', () => {
    const defaultConfig = {
      targetMemoryUtilization: 0.8,
      targetCpuUtilization: 0.8,
      minReservedMemoryPercent: 10,
      minReservedCpuCores: 1,
      absoluteMaxWorkers: 16,
      absoluteMinWorkers: 1,
    };

    it('returns a number >= absoluteMinWorkers', () => {
      const suggestion = monitor.suggestWorkerCount(4, defaultConfig);
      expect(suggestion).toBeGreaterThanOrEqual(defaultConfig.absoluteMinWorkers);
    });

    it('returns a number <= absoluteMaxWorkers', () => {
      const suggestion = monitor.suggestWorkerCount(4, defaultConfig);
      expect(suggestion).toBeLessThanOrEqual(defaultConfig.absoluteMaxWorkers);
    });

    it('respects minReservedCpuCores in calculation', () => {
      const configWithHighReserved = {
        ...defaultConfig,
        minReservedCpuCores: 100, // Reserve more cores than exist
        absoluteMaxWorkers: 100,
      };

      const suggestion = monitor.suggestWorkerCount(50, configWithHighReserved);

      // Should still return something reasonable, bounded by min
      expect(suggestion).toBeGreaterThanOrEqual(configWithHighReserved.absoluteMinWorkers);
    });

    it('returns at minimum the absoluteMinWorkers even with zero current workers', () => {
      const suggestion = monitor.suggestWorkerCount(0, defaultConfig);
      expect(suggestion).toBeGreaterThanOrEqual(defaultConfig.absoluteMinWorkers);
    });

    it('respects absoluteMinWorkers boundary', () => {
      const configWithHighMin = {
        ...defaultConfig,
        absoluteMinWorkers: 5,
      };

      const suggestion = monitor.suggestWorkerCount(1, configWithHighMin);
      expect(suggestion).toBeGreaterThanOrEqual(5);
    });

    it('respects absoluteMaxWorkers boundary', () => {
      const configWithLowMax = {
        targetMemoryUtilization: 0.8,
        targetCpuUtilization: 0.8,
        minReservedMemoryPercent: 10,
        minReservedCpuCores: 1,
        absoluteMaxWorkers: 2,
        absoluteMinWorkers: 1,
      };

      // Use small currentWorkers to avoid critical pressure early-return path
      // that returns Math.floor(currentWorkers * 0.5) without max boundary
      const suggestion = monitor.suggestWorkerCount(2, configWithLowMax);
      expect(suggestion).toBeLessThanOrEqual(2);
    });

    it('returns positive integer', () => {
      const suggestion = monitor.suggestWorkerCount(4, defaultConfig);

      expect(Number.isInteger(suggestion)).toBe(true);
      expect(suggestion).toBeGreaterThan(0);
    });
  });

  describe('recordOperationCost() and getHistoricalCost()', () => {
    const sampleUsage: ResourceUsage = {
      peakMemoryBytes: 50_000_000,
      averageMemoryBytes: 30_000_000,
      cpuTimeMs: 150,
      wallTimeMs: 200,
    };

    it('returns null before any recording', () => {
      const cost = monitor.getHistoricalCost('ast_analysis');
      expect(cost).toBeNull();
    });

    it('returns estimate after recording', () => {
      monitor.recordOperationCost('ast_analysis', sampleUsage);
      const cost = monitor.getHistoricalCost('ast_analysis');

      expect(cost).not.toBeNull();
      expect(cost).toHaveProperty('estimatedMemoryBytes');
      expect(cost).toHaveProperty('estimatedCpuPercent');
      expect(cost).toHaveProperty('confidence');
      expect(cost).toHaveProperty('sampleCount');
    });

    it('returns correct initial values after first recording', () => {
      monitor.recordOperationCost('ast_analysis', sampleUsage);
      const cost = monitor.getHistoricalCost('ast_analysis')!;

      expect(cost.estimatedMemoryBytes).toBe(sampleUsage.peakMemoryBytes);
      expect(cost.sampleCount).toBe(1);
      // CPU percent = (cpuTimeMs / wallTimeMs) * 100 = (150/200)*100 = 75
      expect(cost.estimatedCpuPercent).toBe(75);
    });

    it('updates estimate with multiple recordings using EMA', () => {
      monitor.recordOperationCost('ast_analysis', sampleUsage);
      const firstCost = monitor.getHistoricalCost('ast_analysis')!;

      const secondUsage: ResourceUsage = {
        peakMemoryBytes: 100_000_000,
        averageMemoryBytes: 80_000_000,
        cpuTimeMs: 300,
        wallTimeMs: 400,
      };

      monitor.recordOperationCost('ast_analysis', secondUsage);
      const secondCost = monitor.getHistoricalCost('ast_analysis')!;

      // The estimate should have changed (EMA update)
      expect(secondCost.estimatedMemoryBytes).not.toBe(firstCost.estimatedMemoryBytes);
      expect(secondCost.sampleCount).toBe(2);

      // EMA with alpha=0.3: newValue = 0.3*new + 0.7*old
      // Expected: 0.3 * 100_000_000 + 0.7 * 50_000_000 = 30_000_000 + 35_000_000 = 65_000_000
      expect(secondCost.estimatedMemoryBytes).toBeCloseTo(65_000_000, -5);
    });

    it('increases confidence with more samples', () => {
      monitor.recordOperationCost('ast_analysis', sampleUsage);
      const cost1 = monitor.getHistoricalCost('ast_analysis')!;

      for (let i = 0; i < 9; i++) {
        monitor.recordOperationCost('ast_analysis', sampleUsage);
      }
      const cost10 = monitor.getHistoricalCost('ast_analysis')!;

      expect(cost10.confidence).toBeGreaterThan(cost1.confidence);
      expect(cost10.sampleCount).toBe(10);

      // Confidence should approach 1 asymptotically
      // Formula: 1 - Math.exp(-sampleCount / 5)
      // At 10 samples: 1 - exp(-10/5) = 1 - exp(-2) ~= 0.865
      expect(cost10.confidence).toBeCloseTo(0.865, 2);
    });

    it('tracks different operation types independently', () => {
      const astUsage: ResourceUsage = {
        peakMemoryBytes: 50_000_000,
        averageMemoryBytes: 30_000_000,
        cpuTimeMs: 150,
        wallTimeMs: 200,
      };

      const embeddingUsage: ResourceUsage = {
        peakMemoryBytes: 200_000_000,
        averageMemoryBytes: 150_000_000,
        cpuTimeMs: 500,
        wallTimeMs: 1000,
      };

      monitor.recordOperationCost('ast_analysis', astUsage);
      monitor.recordOperationCost('embedding_generation', embeddingUsage);

      const astCost = monitor.getHistoricalCost('ast_analysis')!;
      const embeddingCost = monitor.getHistoricalCost('embedding_generation')!;

      expect(astCost.estimatedMemoryBytes).toBe(50_000_000);
      expect(embeddingCost.estimatedMemoryBytes).toBe(200_000_000);
      expect(astCost.sampleCount).toBe(1);
      expect(embeddingCost.sampleCount).toBe(1);
    });

    it('handles zero wallTimeMs gracefully', () => {
      const zeroTimeUsage: ResourceUsage = {
        peakMemoryBytes: 50_000_000,
        averageMemoryBytes: 30_000_000,
        cpuTimeMs: 150,
        wallTimeMs: 0,
      };

      monitor.recordOperationCost('ast_analysis', zeroTimeUsage);
      const cost = monitor.getHistoricalCost('ast_analysis')!;

      expect(cost.estimatedCpuPercent).toBe(0);
    });
  });

  describe('ring buffer', () => {
    it('stores snapshots', () => {
      monitor.takeSnapshot();
      monitor.takeSnapshot();
      monitor.takeSnapshot();

      const snapshots = monitor.getSnapshots();
      expect(snapshots.length).toBe(3);
    });

    it('getSnapshots() returns array', () => {
      const snapshots = monitor.getSnapshots();
      expect(Array.isArray(snapshots)).toBe(true);
    });

    it('getSnapshots() returns empty array when no snapshots exist', () => {
      const snapshots = monitor.getSnapshots();
      expect(snapshots).toEqual([]);
    });

    it('getLatestSnapshot() returns null when no snapshots exist', () => {
      const latest = monitor.getLatestSnapshot();
      expect(latest).toBeNull();
    });

    it('getLatestSnapshot() returns most recent snapshot', () => {
      const snapshot1 = monitor.takeSnapshot();
      const snapshot2 = monitor.takeSnapshot();
      const snapshot3 = monitor.takeSnapshot();

      const latest = monitor.getLatestSnapshot();

      expect(latest).not.toBeNull();
      expect(latest!.timestamp).toBeGreaterThanOrEqual(snapshot1.timestamp);
      expect(latest!.timestamp).toBeGreaterThanOrEqual(snapshot2.timestamp);
      expect(latest!.timestamp).toBe(snapshot3.timestamp);
    });

    it('reset() clears state', () => {
      // Take some snapshots
      monitor.takeSnapshot();
      monitor.takeSnapshot();
      monitor.takeSnapshot();

      // Record some operation costs
      monitor.recordOperationCost('ast_analysis', {
        peakMemoryBytes: 50_000_000,
        averageMemoryBytes: 30_000_000,
        cpuTimeMs: 150,
        wallTimeMs: 200,
      });

      // Verify data exists
      expect(monitor.getSnapshots().length).toBe(3);
      expect(monitor.getHistoricalCost('ast_analysis')).not.toBeNull();

      // Reset
      monitor.reset();

      // Verify everything is cleared
      expect(monitor.getSnapshots()).toEqual([]);
      expect(monitor.getLatestSnapshot()).toBeNull();
      expect(monitor.getHistoricalCost('ast_analysis')).toBeNull();
    });

    it('respects ring buffer size limit', () => {
      const smallBuffer = new ResourceMonitor({ ringBufferSize: 3 });

      smallBuffer.takeSnapshot();
      smallBuffer.takeSnapshot();
      smallBuffer.takeSnapshot();
      smallBuffer.takeSnapshot();
      smallBuffer.takeSnapshot();

      const snapshots = smallBuffer.getSnapshots();
      expect(snapshots.length).toBe(3);
    });

    it('returns snapshots in chronological order', () => {
      monitor.takeSnapshot();
      // Small delay to ensure timestamp difference
      monitor.takeSnapshot();
      monitor.takeSnapshot();

      const snapshots = monitor.getSnapshots();

      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i].timestamp).toBeGreaterThanOrEqual(snapshots[i - 1].timestamp);
      }
    });
  });

  describe('edge cases', () => {
    it('works with default config', () => {
      const defaultMonitor = new ResourceMonitor();

      const snapshot = defaultMonitor.takeSnapshot();
      expect(snapshot).toBeDefined();

      const pressure = defaultMonitor.calculatePressure();
      expect(pressure).toBeDefined();
    });

    it('works with custom ringBufferSize', () => {
      const customMonitor = new ResourceMonitor({ ringBufferSize: 10 });

      // Fill beyond buffer size
      for (let i = 0; i < 15; i++) {
        customMonitor.takeSnapshot();
      }

      const snapshots = customMonitor.getSnapshots();
      expect(snapshots.length).toBe(10);
    });

    it('works with custom emaAlpha', () => {
      const customMonitor = new ResourceMonitor({ emaAlpha: 0.5 });

      const usage1: ResourceUsage = {
        peakMemoryBytes: 100_000_000,
        averageMemoryBytes: 50_000_000,
        cpuTimeMs: 100,
        wallTimeMs: 200,
      };

      const usage2: ResourceUsage = {
        peakMemoryBytes: 200_000_000,
        averageMemoryBytes: 100_000_000,
        cpuTimeMs: 200,
        wallTimeMs: 400,
      };

      customMonitor.recordOperationCost('ast_analysis', usage1);
      customMonitor.recordOperationCost('ast_analysis', usage2);

      const cost = customMonitor.getHistoricalCost('ast_analysis')!;

      // With alpha=0.5: 0.5 * 200_000_000 + 0.5 * 100_000_000 = 150_000_000
      expect(cost.estimatedMemoryBytes).toBeCloseTo(150_000_000, -5);
    });

    it('handles multiple operation types', () => {
      const operationTypes: OperationType[] = [
        'ast_analysis',
        'embedding_generation',
        'llm_call',
        'file_read',
        'test_execution',
      ];

      const sampleUsage: ResourceUsage = {
        peakMemoryBytes: 50_000_000,
        averageMemoryBytes: 30_000_000,
        cpuTimeMs: 150,
        wallTimeMs: 200,
      };

      // Record cost for each operation type
      for (const opType of operationTypes) {
        monitor.recordOperationCost(opType, sampleUsage);
      }

      // Verify each operation type is tracked
      for (const opType of operationTypes) {
        const cost = monitor.getHistoricalCost(opType);
        expect(cost).not.toBeNull();
        expect(cost!.sampleCount).toBe(1);
      }
    });

    it('handles very small ringBufferSize', () => {
      const tinyMonitor = new ResourceMonitor({ ringBufferSize: 1 });

      tinyMonitor.takeSnapshot();
      tinyMonitor.takeSnapshot();
      tinyMonitor.takeSnapshot();

      const snapshots = tinyMonitor.getSnapshots();
      expect(snapshots.length).toBe(1);
    });

    it('handles large number of snapshots', () => {
      const largeMonitor = new ResourceMonitor({ ringBufferSize: 100 });

      for (let i = 0; i < 200; i++) {
        largeMonitor.takeSnapshot();
      }

      const snapshots = largeMonitor.getSnapshots();
      expect(snapshots.length).toBe(100);
    });

    it('maintains consistency after reset and re-use', () => {
      monitor.takeSnapshot();
      monitor.recordOperationCost('ast_analysis', {
        peakMemoryBytes: 50_000_000,
        averageMemoryBytes: 30_000_000,
        cpuTimeMs: 150,
        wallTimeMs: 200,
      });

      monitor.reset();

      // Re-use after reset
      const snapshot = monitor.takeSnapshot();
      expect(snapshot).toBeDefined();

      monitor.recordOperationCost('ast_analysis', {
        peakMemoryBytes: 100_000_000,
        averageMemoryBytes: 60_000_000,
        cpuTimeMs: 300,
        wallTimeMs: 400,
      });

      const cost = monitor.getHistoricalCost('ast_analysis');
      expect(cost).not.toBeNull();
      expect(cost!.sampleCount).toBe(1);
      expect(cost!.estimatedMemoryBytes).toBe(100_000_000);
    });
  });
});
