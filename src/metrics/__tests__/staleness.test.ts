/**
 * @fileoverview Comprehensive Tests for Staleness Metrics and SLA Tracking
 *
 * Tests cover:
 * - File age calculation
 * - SLA threshold determination
 * - SLA adherence calculation
 * - Stale/stalest file queries
 * - Report generation
 * - Percentile calculations
 * - Utility functions
 * - Edge cases
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StalenessTracker,
  StalenessConfig,
  DEFAULT_STALENESS_CONFIG,
  formatAge,
  categorizeStaleness,
  calculatePercentile,
  formatStatusReport,
  createStalenessMetricsTracker,
} from '../staleness.js';
import type { LiBrainianStorage, FileKnowledge } from '../../storage/types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

class MockStorage implements Partial<LiBrainianStorage> {
  private files = new Map<string, FileKnowledge>();

  async getFileByPath(path: string): Promise<FileKnowledge | null> {
    return this.files.get(path) ?? null;
  }

  async getFiles(): Promise<FileKnowledge[]> {
    return Array.from(this.files.values());
  }

  // Test helpers
  addFile(file: FileKnowledge): void {
    this.files.set(file.path, file);
  }

  clear(): void {
    this.files.clear();
  }
}

function createMockFileKnowledge(
  filePath: string,
  lastIndexed?: string
): FileKnowledge {
  return {
    id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    path: filePath,
    relativePath: filePath.split('/').pop()!,
    name: filePath.split('/').pop()!,
    extension: '.ts',
    category: 'code',
    purpose: 'Test file',
    role: 'implementation',
    lineCount: 10,
    functionCount: 1,
    classCount: 0,
    importCount: 0,
    exportCount: 0,
    imports: [],
    importedBy: [],
    directory: filePath.replace(/\/[^/]+$/, ''),
    complexity: 'low',
    hasTests: false,
    checksum: 'abc123',
    confidence: 0.8,
    lastIndexed: lastIndexed ?? new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('StalenessTracker', () => {
  let tracker: StalenessTracker;
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
    tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );
  });

  describe('constructor and configuration', () => {
    it('uses default config when none provided', () => {
      const config = tracker.getConfig();
      expect(config).toEqual(DEFAULT_STALENESS_CONFIG);
    });

    it('merges custom config with defaults', () => {
      const customTracker = new StalenessTracker(
        mockStorage as unknown as LiBrainianStorage,
        { openFileSlaMs: 500 }
      );
      const config = customTracker.getConfig();
      expect(config.openFileSlaMs).toBe(500);
      expect(config.projectFileSlaMs).toBe(DEFAULT_STALENESS_CONFIG.projectFileSlaMs);
      expect(config.dependencySlaMs).toBe(DEFAULT_STALENESS_CONFIG.dependencySlaMs);
    });
  });

  describe('recordIndexed', () => {
    it('records indexing timestamp for a file', async () => {
      const path = '/src/test.ts';
      await tracker.recordIndexed(path);

      const age = await tracker.getFileAge(path);
      expect(age).not.toBeNull();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(1000); // Should be very recent
    });

    it('uses provided timestamp when specified', async () => {
      const path = '/src/test.ts';
      const pastTime = new Date(Date.now() - 60000); // 1 minute ago
      await tracker.recordIndexed(path, pastTime);

      const age = await tracker.getFileAge(path);
      expect(age).not.toBeNull();
      expect(age).toBeGreaterThanOrEqual(60000);
      expect(age).toBeLessThan(61000);
    });

    it('overwrites previous record for same file', async () => {
      const path = '/src/test.ts';
      const oldTime = new Date(Date.now() - 60000);
      await tracker.recordIndexed(path, oldTime);

      const newTime = new Date();
      await tracker.recordIndexed(path, newTime);

      const age = await tracker.getFileAge(path);
      expect(age).toBeLessThan(1000); // Should use newer timestamp
    });
  });

  describe('getFileAge', () => {
    it('returns correct duration since indexing', async () => {
      const path = '/src/test.ts';
      const pastTime = new Date(Date.now() - 5000); // 5 seconds ago
      await tracker.recordIndexed(path, pastTime);

      const age = await tracker.getFileAge(path);
      expect(age).not.toBeNull();
      expect(age).toBeGreaterThanOrEqual(5000);
      expect(age).toBeLessThan(6000);
    });

    it('returns null for files with no index record', async () => {
      const age = await tracker.getFileAge('/src/unknown.ts');
      expect(age).toBeNull();
    });

    it('falls back to storage for untracked files', async () => {
      const path = '/src/from-storage.ts';
      const pastTime = new Date(Date.now() - 30000).toISOString();
      mockStorage.addFile(createMockFileKnowledge(path, pastTime));

      const age = await tracker.getFileAge(path);
      expect(age).not.toBeNull();
      expect(age).toBeGreaterThanOrEqual(30000);
      expect(age).toBeLessThan(31000);
    });
  });

  describe('getSlaForFile', () => {
    it('returns open file SLA for open files', () => {
      const path = '/src/editor.ts';
      tracker.markFileOpen(path);

      const sla = tracker.getSlaForFile(path);
      expect(sla).toBe(DEFAULT_STALENESS_CONFIG.openFileSlaMs);
    });

    it('returns project file SLA for source files', () => {
      const path = '/src/utils/helper.ts';
      const sla = tracker.getSlaForFile(path);
      expect(sla).toBe(DEFAULT_STALENESS_CONFIG.projectFileSlaMs);
    });

    it('returns dependency SLA for node_modules files', () => {
      const path = '/node_modules/lodash/index.js';
      const sla = tracker.getSlaForFile(path);
      expect(sla).toBe(DEFAULT_STALENESS_CONFIG.dependencySlaMs);
    });

    it('returns dependency SLA for vendor files', () => {
      const path = '/vendor/libs/utils.js';
      const sla = tracker.getSlaForFile(path);
      expect(sla).toBe(DEFAULT_STALENESS_CONFIG.dependencySlaMs);
    });

    it('returns dependency SLA for pnpm files', () => {
      const path = '/.pnpm/lodash@4.17.21/node_modules/lodash/index.js';
      const sla = tracker.getSlaForFile(path);
      expect(sla).toBe(DEFAULT_STALENESS_CONFIG.dependencySlaMs);
    });
  });

  describe('isWithinSla', () => {
    it('returns true for files within SLA', async () => {
      const path = '/src/test.ts';
      await tracker.recordIndexed(path); // Just indexed

      const isWithin = await tracker.isWithinSla(path);
      expect(isWithin).toBe(true);
    });

    it('returns false for files beyond SLA', async () => {
      const path = '/src/test.ts';
      const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      await tracker.recordIndexed(path, oldTime);

      const isWithin = await tracker.isWithinSla(path);
      expect(isWithin).toBe(false);
    });

    it('returns null for files never indexed', async () => {
      const isWithin = await tracker.isWithinSla('/src/unknown.ts');
      expect(isWithin).toBeNull();
    });

    it('correctly compares against thresholds', async () => {
      const customTracker = new StalenessTracker(
        mockStorage as unknown as LiBrainianStorage,
        { projectFileSlaMs: 5000 } // 5 second SLA
      );

      const path = '/src/test.ts';

      // 4 seconds ago - should be within SLA
      await customTracker.recordIndexed(path, new Date(Date.now() - 4000));
      expect(await customTracker.isWithinSla(path)).toBe(true);

      // 6 seconds ago - should be beyond SLA
      await customTracker.recordIndexed(path, new Date(Date.now() - 6000));
      expect(await customTracker.isWithinSla(path)).toBe(false);
    });
  });

  describe('getSlaAdherence', () => {
    it('returns 100% for empty tracker', async () => {
      const adherence = await tracker.getSlaAdherence();
      expect(adherence).toBe(100);
    });

    it('calculates percentage correctly', async () => {
      // 2 fresh, 2 stale = 50% adherence
      await tracker.recordIndexed('/src/a.ts', new Date()); // Fresh
      await tracker.recordIndexed('/src/b.ts', new Date()); // Fresh
      await tracker.recordIndexed('/src/c.ts', new Date(Date.now() - 10 * 60 * 1000)); // Stale
      await tracker.recordIndexed('/src/d.ts', new Date(Date.now() - 10 * 60 * 1000)); // Stale

      const adherence = await tracker.getSlaAdherence();
      expect(adherence).toBe(50);
    });

    it('returns 0% when all files are stale', async () => {
      const oldTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      await tracker.recordIndexed('/src/a.ts', oldTime);
      await tracker.recordIndexed('/src/b.ts', oldTime);

      const adherence = await tracker.getSlaAdherence();
      expect(adherence).toBe(0);
    });

    it('returns 100% when all files are fresh', async () => {
      await tracker.recordIndexed('/src/a.ts', new Date());
      await tracker.recordIndexed('/src/b.ts', new Date());

      const adherence = await tracker.getSlaAdherence();
      expect(adherence).toBe(100);
    });
  });

  describe('getStaleFiles', () => {
    it('returns files beyond SLA', async () => {
      const oldTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
      await tracker.recordIndexed('/src/stale.ts', oldTime);
      await tracker.recordIndexed('/src/fresh.ts', new Date());

      const staleFiles = await tracker.getStaleFiles();
      expect(staleFiles).toHaveLength(1);
      expect(staleFiles[0]!.path).toBe('/src/stale.ts');
    });

    it('returns sorted by age (most stale first)', async () => {
      await tracker.recordIndexed('/src/a.ts', new Date(Date.now() - 10 * 60 * 1000));
      await tracker.recordIndexed('/src/b.ts', new Date(Date.now() - 30 * 60 * 1000));
      await tracker.recordIndexed('/src/c.ts', new Date(Date.now() - 20 * 60 * 1000));

      const staleFiles = await tracker.getStaleFiles();
      expect(staleFiles).toHaveLength(3);
      expect(staleFiles[0]!.path).toBe('/src/b.ts'); // Most stale
      expect(staleFiles[1]!.path).toBe('/src/c.ts');
      expect(staleFiles[2]!.path).toBe('/src/a.ts'); // Least stale
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await tracker.recordIndexed(`/src/file${i}.ts`, new Date(Date.now() - 10 * 60 * 1000));
      }

      const staleFiles = await tracker.getStaleFiles(3);
      expect(staleFiles).toHaveLength(3);
    });

    it('returns empty array when all files are fresh', async () => {
      await tracker.recordIndexed('/src/a.ts', new Date());
      await tracker.recordIndexed('/src/b.ts', new Date());

      const staleFiles = await tracker.getStaleFiles();
      expect(staleFiles).toHaveLength(0);
    });
  });

  describe('getStalestFiles', () => {
    it('returns all files sorted by age', async () => {
      await tracker.recordIndexed('/src/a.ts', new Date(Date.now() - 1000)); // 1 second
      await tracker.recordIndexed('/src/b.ts', new Date(Date.now() - 5000)); // 5 seconds
      await tracker.recordIndexed('/src/c.ts', new Date(Date.now() - 3000)); // 3 seconds

      const stalest = await tracker.getStalestFiles(10);
      expect(stalest).toHaveLength(3);
      expect(stalest[0]!.path).toBe('/src/b.ts');
      expect(stalest[1]!.path).toBe('/src/c.ts');
      expect(stalest[2]!.path).toBe('/src/a.ts');
    });

    it('uses default limit of 10', async () => {
      for (let i = 0; i < 20; i++) {
        await tracker.recordIndexed(`/src/file${i}.ts`, new Date(Date.now() - i * 1000));
      }

      const stalest = await tracker.getStalestFiles();
      expect(stalest).toHaveLength(10);
    });
  });

  describe('generateReport', () => {
    it('includes all metrics', async () => {
      await tracker.recordIndexed('/src/a.ts', new Date());
      await tracker.recordIndexed('/src/b.ts', new Date(Date.now() - 10 * 60 * 1000));
      await tracker.recordIndexed('/src/c.ts', new Date(Date.now() - 30 * 60 * 1000));

      const report = await tracker.generateReport();

      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.totalFiles).toBe(3);
      expect(report.withinSla).toBe(1);
      expect(report.beyondSla).toBe(2);
      expect(report.slaAdherencePercent).toBeCloseTo(33.33, 1);
      expect(report.buckets).toBeDefined();
      expect(report.stalestFiles).toBeDefined();
      expect(report.averageAgeMs).toBeGreaterThan(0);
      expect(report.p50AgeMs).toBeGreaterThan(0);
      expect(report.p95AgeMs).toBeGreaterThan(0);
      expect(report.p99AgeMs).toBeGreaterThan(0);
    });

    it('correctly categorizes files into buckets', async () => {
      const config: Partial<StalenessConfig> = {
        projectFileSlaMs: 10000, // 10 seconds
      };
      const customTracker = new StalenessTracker(
        mockStorage as unknown as LiBrainianStorage,
        config
      );

      // Fresh: within SLA (< 10s)
      await customTracker.recordIndexed('/src/fresh.ts', new Date(Date.now() - 5000));
      // Stale: beyond SLA but < 2x (10s - 20s)
      await customTracker.recordIndexed('/src/stale.ts', new Date(Date.now() - 15000));
      // Critical: >= 2x SLA (>= 20s)
      await customTracker.recordIndexed('/src/critical.ts', new Date(Date.now() - 25000));

      const report = await customTracker.generateReport();

      expect(report.buckets.fresh).toContain('/src/fresh.ts');
      expect(report.buckets.stale).toContain('/src/stale.ts');
      expect(report.buckets.critical).toContain('/src/critical.ts');
    });

    it('handles empty tracker gracefully', async () => {
      const report = await tracker.generateReport();

      expect(report.totalFiles).toBe(0);
      expect(report.withinSla).toBe(0);
      expect(report.beyondSla).toBe(0);
      expect(report.slaAdherencePercent).toBe(100);
      expect(report.averageAgeMs).toBe(0);
      expect(report.p50AgeMs).toBe(0);
      expect(report.p95AgeMs).toBe(0);
      expect(report.p99AgeMs).toBe(0);
    });
  });

  describe('getFreshnessConfidence', () => {
    it('returns 1.0 for empty paths array', async () => {
      const confidence = await tracker.getFreshnessConfidence([]);
      expect(confidence).toBe(1.0);
    });

    it('returns 1.0 for all fresh files', async () => {
      await tracker.recordIndexed('/src/a.ts', new Date());
      await tracker.recordIndexed('/src/b.ts', new Date());

      const confidence = await tracker.getFreshnessConfidence(['/src/a.ts', '/src/b.ts']);
      expect(confidence).toBe(1.0);
    });

    it('returns reduced confidence for stale files', async () => {
      const config: Partial<StalenessConfig> = {
        projectFileSlaMs: 10000, // 10 seconds
      };
      const customTracker = new StalenessTracker(
        mockStorage as unknown as LiBrainianStorage,
        config
      );

      // 1.5x SLA - should have reduced confidence
      await customTracker.recordIndexed('/src/stale.ts', new Date(Date.now() - 15000));

      const confidence = await customTracker.getFreshnessConfidence(['/src/stale.ts']);
      expect(confidence).toBeLessThan(1.0);
      expect(confidence).toBeGreaterThan(0.5);
    });

    it('returns low confidence for critical files', async () => {
      const config: Partial<StalenessConfig> = {
        projectFileSlaMs: 10000, // 10 seconds
      };
      const customTracker = new StalenessTracker(
        mockStorage as unknown as LiBrainianStorage,
        config
      );

      // 5x SLA - should have very low confidence
      await customTracker.recordIndexed('/src/critical.ts', new Date(Date.now() - 50000));

      const confidence = await customTracker.getFreshnessConfidence(['/src/critical.ts']);
      expect(confidence).toBeLessThan(0.5);
    });

    it('returns 0.5 for unknown files', async () => {
      const confidence = await tracker.getFreshnessConfidence(['/src/unknown.ts']);
      expect(confidence).toBe(0.5);
    });
  });

  describe('open file management', () => {
    it('tracks open files correctly', () => {
      const path = '/src/editor.ts';

      expect(tracker.isFileOpen(path)).toBe(false);

      tracker.markFileOpen(path);
      expect(tracker.isFileOpen(path)).toBe(true);

      tracker.markFileClosed(path);
      expect(tracker.isFileOpen(path)).toBe(false);
    });

    it('returns list of open files', () => {
      tracker.markFileOpen('/src/a.ts');
      tracker.markFileOpen('/src/b.ts');

      const openFiles = tracker.getOpenFiles();
      expect(openFiles).toHaveLength(2);
      expect(openFiles).toContain('/src/a.ts');
      expect(openFiles).toContain('/src/b.ts');
    });

    it('uses open file SLA when file is open', async () => {
      const path = '/src/editor.ts';

      // Before opening - project SLA
      expect(tracker.getSlaForFile(path)).toBe(DEFAULT_STALENESS_CONFIG.projectFileSlaMs);

      // While open - open file SLA
      tracker.markFileOpen(path);
      expect(tracker.getSlaForFile(path)).toBe(DEFAULT_STALENESS_CONFIG.openFileSlaMs);

      // After closing - project SLA again
      tracker.markFileClosed(path);
      expect(tracker.getSlaForFile(path)).toBe(DEFAULT_STALENESS_CONFIG.projectFileSlaMs);
    });
  });

  describe('clear', () => {
    it('removes all tracked records and open files', async () => {
      await tracker.recordIndexed('/src/a.ts');
      await tracker.recordIndexed('/src/b.ts');
      tracker.markFileOpen('/src/a.ts');

      expect(tracker.getTrackedFileCount()).toBe(2);
      expect(tracker.getOpenFiles()).toHaveLength(1);

      tracker.clear();

      expect(tracker.getTrackedFileCount()).toBe(0);
      expect(tracker.getOpenFiles()).toHaveLength(0);
    });
  });
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('formatAge', () => {
  it('formats seconds correctly', () => {
    expect(formatAge(0)).toBe('0s');
    expect(formatAge(1000)).toBe('1s');
    expect(formatAge(45000)).toBe('45s');
  });

  it('formats minutes and seconds correctly', () => {
    expect(formatAge(60000)).toBe('1m');
    expect(formatAge(90000)).toBe('1m 30s');
    expect(formatAge(150000)).toBe('2m 30s');
  });

  it('formats hours and minutes correctly', () => {
    expect(formatAge(3600000)).toBe('1h');
    expect(formatAge(5400000)).toBe('1h 30m');
    expect(formatAge(7200000)).toBe('2h');
  });

  it('formats days and hours correctly', () => {
    expect(formatAge(86400000)).toBe('1d');
    expect(formatAge(90000000)).toBe('1d 1h');
    expect(formatAge(172800000)).toBe('2d');
  });

  it('handles negative values', () => {
    expect(formatAge(-1000)).toBe('0s');
  });

  it('produces human-readable strings', () => {
    // These are the example outputs from the spec
    expect(formatAge(150000)).toBe('2m 30s');
    expect(formatAge(3900000)).toBe('1h 5m');
  });
});

describe('categorizeStaleness', () => {
  it('returns fresh for files within SLA', () => {
    expect(categorizeStaleness(5000, 10000)).toBe('fresh');
    expect(categorizeStaleness(10000, 10000)).toBe('fresh'); // Exactly at SLA
  });

  it('returns stale for files between 1x and 2x SLA', () => {
    expect(categorizeStaleness(15000, 10000)).toBe('stale');
    expect(categorizeStaleness(19999, 10000)).toBe('stale');
  });

  it('returns critical for files at or beyond 2x SLA', () => {
    expect(categorizeStaleness(20000, 10000)).toBe('critical');
    expect(categorizeStaleness(50000, 10000)).toBe('critical');
  });

  it('correctly buckets edge cases', () => {
    const sla = 300000; // 5 minutes

    // Just under SLA
    expect(categorizeStaleness(299999, sla)).toBe('fresh');

    // Just over SLA
    expect(categorizeStaleness(300001, sla)).toBe('stale');

    // Just under 2x SLA
    expect(categorizeStaleness(599999, sla)).toBe('stale');

    // At 2x SLA
    expect(categorizeStaleness(600000, sla)).toBe('critical');
  });
});

describe('calculatePercentile', () => {
  it('handles empty array', () => {
    expect(calculatePercentile([], 50)).toBe(0);
  });

  it('handles single element', () => {
    expect(calculatePercentile([100], 50)).toBe(100);
  });

  it('calculates percentiles accurately', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    expect(calculatePercentile(values, 0)).toBe(1);
    expect(calculatePercentile(values, 100)).toBe(10);
    expect(calculatePercentile(values, 50)).toBeCloseTo(5.5, 1);
  });

  it('handles edge percentiles', () => {
    const values = [10, 20, 30, 40, 50];

    expect(calculatePercentile(values, 0)).toBe(10);
    expect(calculatePercentile(values, 100)).toBe(50);
    expect(calculatePercentile(values, -10)).toBe(10);
    expect(calculatePercentile(values, 110)).toBe(50);
  });

  it('uses linear interpolation', () => {
    const values = [0, 100];

    expect(calculatePercentile(values, 25)).toBe(25);
    expect(calculatePercentile(values, 50)).toBe(50);
    expect(calculatePercentile(values, 75)).toBe(75);
  });

  it('handles realistic age values', () => {
    // Simulating file ages in milliseconds
    const ages = [
      1000,   // 1s
      5000,   // 5s
      10000,  // 10s
      30000,  // 30s
      60000,  // 1m
      120000, // 2m
      180000, // 3m
      240000, // 4m
      300000, // 5m
      600000, // 10m
    ];

    const p50 = calculatePercentile(ages, 50);
    const p95 = calculatePercentile(ages, 95);
    const p99 = calculatePercentile(ages, 99);

    expect(p50).toBeGreaterThan(0);
    expect(p95).toBeGreaterThan(p50);
    expect(p99).toBeGreaterThan(p95);
    expect(p99).toBeLessThanOrEqual(600000);
  });
});

// ============================================================================
// CLI FORMATTING TESTS
// ============================================================================

describe('formatStatusReport', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  it('produces formatted output', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    await tracker.recordIndexed('/src/a.ts', new Date());
    await tracker.recordIndexed('/src/b.ts', new Date(Date.now() - 10 * 60 * 1000));

    const output = await formatStatusReport(tracker);

    expect(output).toContain('Index Freshness Report');
    expect(output).toContain('Total files:');
    expect(output).toContain('SLA Adherence:');
    expect(output).toContain('By Status:');
    expect(output).toContain('[FRESH]');
    expect(output).toContain('[STALE]');
    expect(output).toContain('[CRITICAL]');
    expect(output).toContain('Percentiles:');
    expect(output).toContain('p50:');
    expect(output).toContain('p95:');
    expect(output).toContain('p99:');
  });

  it('shows stalest files section when files are stale', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    await tracker.recordIndexed('/src/old/legacy.ts', new Date(Date.now() - 60 * 60 * 1000));

    const output = await formatStatusReport(tracker);

    expect(output).toContain('Stalest Files:');
    expect(output).toContain('legacy.ts');
  });

  it('handles empty tracker gracefully', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    const output = await formatStatusReport(tracker);

    expect(output).toContain('Total files: 0');
    expect(output).toContain('SLA Adherence: 100.0%');
  });

  it('truncates long file paths', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    const longPath = '/very/long/path/that/goes/on/and/on/and/on/for/many/directories/file.ts';
    await tracker.recordIndexed(longPath, new Date(Date.now() - 10 * 60 * 1000));

    const output = await formatStatusReport(tracker);

    // Should be truncated with ellipsis
    expect(output).toContain('...');
    expect(output).toContain('file.ts');
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createStalenessMetricsTracker', () => {
  it('creates tracker with default config', () => {
    const mockStorage = new MockStorage();
    const tracker = createStalenessMetricsTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    expect(tracker).toBeInstanceOf(StalenessTracker);
    expect(tracker.getConfig()).toEqual(DEFAULT_STALENESS_CONFIG);
  });

  it('creates tracker with custom config', () => {
    const mockStorage = new MockStorage();
    const tracker = createStalenessMetricsTracker(
      mockStorage as unknown as LiBrainianStorage,
      { openFileSlaMs: 500 }
    );

    expect(tracker.getConfig().openFileSlaMs).toBe(500);
  });
});

// ============================================================================
// EDGE CASES AND PERFORMANCE TESTS
// ============================================================================

describe('edge cases', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  it('handles files with no index record', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    const age = await tracker.getFileAge('/nonexistent.ts');
    expect(age).toBeNull();

    const isWithin = await tracker.isWithinSla('/nonexistent.ts');
    expect(isWithin).toBeNull();
  });

  it('handles empty storage gracefully', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    const report = await tracker.generateReport();
    expect(report.totalFiles).toBe(0);

    const adherence = await tracker.getSlaAdherence();
    expect(adherence).toBe(100);

    const staleFiles = await tracker.getStaleFiles();
    expect(staleFiles).toHaveLength(0);
  });

  it('handles concurrent operations', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    // Simulate concurrent indexing
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(tracker.recordIndexed(`/src/file${i}.ts`));
    }
    await Promise.all(promises);

    expect(tracker.getTrackedFileCount()).toBe(100);
  });

  it('handles large file counts for performance', async () => {
    const tracker = new StalenessTracker(
      mockStorage as unknown as LiBrainianStorage
    );

    // Record many files
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      await tracker.recordIndexed(
        `/src/file${i}.ts`,
        new Date(Date.now() - Math.random() * 60 * 60 * 1000)
      );
    }
    const recordTime = Date.now() - start;

    // Generate report should complete in reasonable time
    const reportStart = Date.now();
    const report = await tracker.generateReport();
    const reportTime = Date.now() - reportStart;

    expect(report.totalFiles).toBe(1000);
    expect(reportTime).toBeLessThan(5000); // Should complete in < 5 seconds
  });
});

// ============================================================================
// DEFAULT CONFIG VALIDATION
// ============================================================================

describe('DEFAULT_STALENESS_CONFIG', () => {
  it('has correct SLA values', () => {
    expect(DEFAULT_STALENESS_CONFIG.openFileSlaMs).toBe(1000); // 1 second
    expect(DEFAULT_STALENESS_CONFIG.projectFileSlaMs).toBe(300000); // 5 minutes
    expect(DEFAULT_STALENESS_CONFIG.dependencySlaMs).toBe(3600000); // 1 hour
  });

  it('values are in expected order', () => {
    // Open files have strictest SLA
    expect(DEFAULT_STALENESS_CONFIG.openFileSlaMs).toBeLessThan(
      DEFAULT_STALENESS_CONFIG.projectFileSlaMs
    );

    // Project files have stricter SLA than dependencies
    expect(DEFAULT_STALENESS_CONFIG.projectFileSlaMs).toBeLessThan(
      DEFAULT_STALENESS_CONFIG.dependencySlaMs
    );
  });
});
