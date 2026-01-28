/**
 * @fileoverview Tests for FreshnessDetector
 *
 * WU-SELF-302: Implements freshness detection using exponential decay model.
 *
 * Tests verify:
 * - Exponential decay formula correctness
 * - Freshness status classification (fresh/stale/critical)
 * - Integration with Evidence Ledger for staleness tracking
 * - Report generation with accurate statistics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import {
  FreshnessDetector,
  computeFreshness,
  createFreshnessDetector,
  type FreshnessConfig,
  type FreshnessResult,
  type FreshnessReport,
  DEFAULT_FRESHNESS_CONFIG,
} from '../freshness_detector.js';
import type { LibrarianStorage, FileKnowledge } from '../../../storage/types.js';
import type { IEvidenceLedger, EvidenceEntry, EvidenceId } from '../../../epistemics/evidence_ledger.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock fs module - must be hoisted
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({
    mtime: new Date(),
    isFile: () => true,
  }),
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({
      mtime: new Date(),
      isFile: () => true,
    }),
  },
}));

// Import fs after mocking
import * as fs from 'node:fs';

function createMockStorage(files: FileKnowledge[] = []): LibrarianStorage {
  return {
    isInitialized: vi.fn().mockReturnValue(true),
    getFiles: vi.fn().mockResolvedValue(files),
    getFileByPath: vi.fn().mockImplementation((filePath: string) => {
      return Promise.resolve(files.find((f) => f.path === filePath) ?? null);
    }),
    getFileChecksum: vi.fn().mockResolvedValue(null),
  } as unknown as LibrarianStorage;
}

function createMockLedger(): IEvidenceLedger {
  const entries: EvidenceEntry[] = [];
  return {
    append: vi.fn().mockImplementation(async (entry) => {
      const fullEntry = {
        ...entry,
        id: `ev_${entries.length}` as EvidenceId,
        timestamp: new Date(),
      };
      entries.push(fullEntry);
      return fullEntry;
    }),
    query: vi.fn().mockResolvedValue(entries),
    get: vi.fn().mockResolvedValue(null),
    getChain: vi.fn().mockResolvedValue({ evidence: [], contradictions: [] }),
    getSessionEntries: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    appendBatch: vi.fn().mockResolvedValue([]),
  } as unknown as IEvidenceLedger;
}

function createMockFileKnowledge(
  filePath: string,
  lastIndexed: Date,
  lastModified?: Date
): FileKnowledge {
  return {
    id: `file_${filePath.replace(/\//g, '_')}`,
    path: filePath,
    name: path.basename(filePath),
    extension: path.extname(filePath),
    language: 'typescript',
    size: 1000,
    lineCount: 50,
    checksum: 'abc123',
    lastIndexed: lastIndexed.toISOString(),
    lastModified: (lastModified ?? lastIndexed).toISOString(),
    confidence: 0.9,
  };
}

// ============================================================================
// UNIT TESTS: computeFreshness function (pure function, no mocking needed)
// ============================================================================

describe('computeFreshness', () => {
  it('returns 1.0 when lastModified equals lastIndexed', () => {
    const now = new Date();
    const freshness = computeFreshness(now, now);
    expect(freshness).toBe(1.0);
  });

  it('returns 1.0 when lastIndexed is after lastModified (index is current)', () => {
    const lastModified = new Date('2024-01-01');
    const lastIndexed = new Date('2024-01-02'); // Indexed after modification

    // If lastIndexed >= lastModified, the index is current -> fully fresh
    const freshness = computeFreshness(lastModified, lastIndexed);
    expect(freshness).toBe(1.0);
  });

  it('applies exponential decay when file modified after indexing', () => {
    const lastIndexed = new Date('2024-01-01T00:00:00Z');
    const lastModified = new Date('2024-01-01T01:00:00Z'); // Modified 1 hour after indexing

    // With default lambda = 0.001 (per hour), file stale for 1 hour:
    // freshness = e^(-0.001 * 1) = ~0.999
    const freshness = computeFreshness(lastModified, lastIndexed, { decayLambda: 0.001 });
    expect(freshness).toBeCloseTo(Math.exp(-0.001), 3);
  });

  it('returns lower freshness for files modified longer ago after indexing', () => {
    const lastIndexed = new Date('2024-01-01T00:00:00Z');
    const modifiedOneHourLater = new Date('2024-01-01T01:00:00Z');
    const modifiedOneDayLater = new Date('2024-01-02T00:00:00Z');

    const freshnessOneHour = computeFreshness(modifiedOneHourLater, lastIndexed);
    const freshnessOneDay = computeFreshness(modifiedOneDayLater, lastIndexed);

    expect(freshnessOneDay).toBeLessThan(freshnessOneHour);
  });

  it('uses custom decay lambda', () => {
    const lastIndexed = new Date('2024-01-01T00:00:00Z');
    const lastModified = new Date('2024-01-01T01:00:00Z'); // Modified 1 hour after indexing

    // Higher lambda = faster decay
    const slowDecay = computeFreshness(lastModified, lastIndexed, { decayLambda: 0.001 });
    const fastDecay = computeFreshness(lastModified, lastIndexed, { decayLambda: 0.1 });

    expect(fastDecay).toBeLessThan(slowDecay);
  });

  it('never returns negative values', () => {
    const lastIndexed = new Date('2000-01-01');
    const lastModified = new Date(); // Modified now (very stale)

    const freshness = computeFreshness(lastModified, lastIndexed);
    expect(freshness).toBeGreaterThanOrEqual(0);
    expect(freshness).toBeLessThanOrEqual(1);
  });

  it('handles very high decay lambda (rapid decay)', () => {
    const lastIndexed = new Date('2024-01-01T00:00:00Z');
    const lastModified = new Date('2024-01-01T00:01:00Z'); // Modified 1 minute after indexing

    // Very high lambda should cause rapid decay
    // 1 minute = 1/60 hour, lambda = 100 -> e^(-100/60) ~ e^(-1.67) ~ 0.19
    const freshness = computeFreshness(lastModified, lastIndexed, { decayLambda: 100 });
    expect(freshness).toBeLessThan(0.3);
  });

  it('handles zero decay lambda (no decay)', () => {
    const lastIndexed = new Date('2000-01-01');
    const lastModified = new Date(); // Modified now (but no decay)

    // Zero lambda means no decay: e^0 = 1
    const freshness = computeFreshness(lastModified, lastIndexed, { decayLambda: 0 });
    expect(freshness).toBe(1.0);
  });
});

// ============================================================================
// UNIT TESTS: FreshnessDetector class
// ============================================================================

describe('FreshnessDetector', () => {
  let mockStorage: LibrarianStorage;
  let mockLedger: IEvidenceLedger;
  let detector: FreshnessDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = createMockStorage();
    mockLedger = createMockLedger();
    detector = new FreshnessDetector(mockStorage, mockLedger);

    // Reset fs mocks to defaults
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      mtime: new Date(),
      isFile: () => true,
    } as unknown as ReturnType<typeof fs.statSync>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor and configuration', () => {
    it('uses default config when none provided', () => {
      const det = new FreshnessDetector(mockStorage);
      expect(det.getConfig()).toEqual(DEFAULT_FRESHNESS_CONFIG);
    });

    it('merges custom config with defaults', () => {
      const customConfig: Partial<FreshnessConfig> = {
        decayLambda: 0.05,
      };
      const det = new FreshnessDetector(mockStorage, undefined, customConfig);
      const config = det.getConfig();

      expect(config.decayLambda).toBe(0.05);
      expect(config.staleThreshold).toBe(DEFAULT_FRESHNESS_CONFIG.staleThreshold);
    });

    it('validates config thresholds', () => {
      // criticalThreshold must be <= staleThreshold
      expect(() => {
        new FreshnessDetector(mockStorage, undefined, {
          staleThreshold: 0.5,
          criticalThreshold: 0.8, // Invalid: critical > stale
        });
      }).toThrow('criticalThreshold must be less than or equal to staleThreshold');
    });
  });

  describe('checkFile', () => {
    it('returns fresh status for recently indexed file with no changes', async () => {
      const now = new Date();
      const file = createMockFileKnowledge('/test/file.ts', now);
      mockStorage = createMockStorage([file]);
      detector = new FreshnessDetector(mockStorage, mockLedger);

      // File modification time equals index time -> fresh
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const result = await detector.checkFile('/test/file.ts');

      expect(result.status).toBe('fresh');
      expect(result.freshnessScore).toBeCloseTo(1.0, 2);
      expect(result.path).toBe('/test/file.ts');
    });

    it('returns stale status for file modified after indexing', async () => {
      const now = new Date();
      // File was indexed 30 days ago
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const file = createMockFileKnowledge('/test/old_file.ts', thirtyDaysAgo);
      mockStorage = createMockStorage([file]);

      // Use a config that makes 30 days stale
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01, // Per hour - 30 days = 720 hours -> e^(-7.2) ~ 0.0007
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // File was modified NOW (after being indexed 30 days ago)
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now, // Modified now, indexed 30 days ago -> stale
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const result = await detector.checkFile('/test/old_file.ts');

      expect(result.status).toBe('critical');
      expect(result.freshnessScore).toBeLessThan(0.1);
    });

    it('returns critical status for file modified long after indexing', async () => {
      const now = new Date();
      // File was indexed 1 year ago
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const file = createMockFileKnowledge('/test/ancient.ts', oneYearAgo);
      mockStorage = createMockStorage([file]);

      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.001,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // File was modified NOW (after being indexed 1 year ago)
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now, // Modified now, indexed 1 year ago -> very stale
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const result = await detector.checkFile('/test/ancient.ts');

      expect(result.status).toBe('critical');
    });

    it('handles file not found in storage', async () => {
      mockStorage = createMockStorage([]);
      detector = new FreshnessDetector(mockStorage, mockLedger);

      const result = await detector.checkFile('/test/unknown.ts');

      expect(result.status).toBe('critical');
      expect(result.recommendedAction).toContain('index');
    });

    it('handles file not found on disk', async () => {
      const file = createMockFileKnowledge('/test/deleted.ts', new Date());
      mockStorage = createMockStorage([file]);
      detector = new FreshnessDetector(mockStorage, mockLedger);

      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await detector.checkFile('/test/deleted.ts');

      expect(result.recommendedAction).toContain('removing');
    });

    it('provides appropriate recommended actions', async () => {
      const now = new Date();
      // File was indexed 7 days ago
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const file = createMockFileKnowledge('/test/stale.ts', sevenDaysAgo);
      mockStorage = createMockStorage([file]);

      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // File was modified NOW (after being indexed 7 days ago)
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now, // Modified now -> stale
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const result = await detector.checkFile('/test/stale.ts');

      expect(result.recommendedAction).toBeDefined();
      expect(result.recommendedAction.length).toBeGreaterThan(0);
    });
  });

  describe('generateReport', () => {
    it('returns report with correct structure', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const files = [
        createMockFileKnowledge('/test/repo/fresh.ts', now),
        createMockFileKnowledge('/test/repo/stale.ts', thirtyDaysAgo), // Indexed 30 days ago
      ];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.001,
        staleThreshold: 0.7,
        criticalThreshold: 0.3,
      });

      // fresh.ts: mtime = now (same as lastIndexed) -> fresh
      // stale.ts: mtime = now (modified after being indexed 30 days ago) -> stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const report = await detector.generateReport('/test/repo');

      expect(report).toHaveProperty('totalFiles');
      expect(report).toHaveProperty('freshCount');
      expect(report).toHaveProperty('staleCount');
      expect(report).toHaveProperty('criticalCount');
      expect(report).toHaveProperty('averageFreshness');
      expect(report).toHaveProperty('staleFiles');
      expect(Array.isArray(report.staleFiles)).toBe(true);
    });

    it('calculates correct counts', async () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const files = [
        createMockFileKnowledge('/test/repo/fresh1.ts', now),
        createMockFileKnowledge('/test/repo/fresh2.ts', now),
        createMockFileKnowledge('/test/repo/stale.ts', tenDaysAgo), // Indexed 10 days ago
      ];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // fresh1.ts and fresh2.ts: mtime = lastIndexed = now -> fresh
      // stale.ts: mtime = now, lastIndexed = 10 days ago -> stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const report = await detector.generateReport('/test/repo');

      expect(report.totalFiles).toBe(3);
      expect(report.freshCount).toBe(2);
      expect(report.staleCount + report.criticalCount).toBe(1);
    });

    it('calculates average freshness correctly', async () => {
      const now = new Date();
      const files = [
        createMockFileKnowledge('/test/repo/file1.ts', now),
        createMockFileKnowledge('/test/repo/file2.ts', now),
      ];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger);

      // Both files: mtime = lastIndexed = now -> fully fresh
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const report = await detector.generateReport('/test/repo');

      expect(report.averageFreshness).toBeCloseTo(1.0, 1);
    });

    it('includes stale files in report', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const files = [
        createMockFileKnowledge('/test/repo/fresh.ts', now),
        createMockFileKnowledge('/test/repo/stale.ts', thirtyDaysAgo), // Indexed 30 days ago
      ];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // fresh.ts: mtime = lastIndexed = now -> fresh
      // stale.ts: mtime = now, lastIndexed = 30 days ago -> stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const report = await detector.generateReport('/test/repo');

      expect(report.staleFiles.length).toBeGreaterThan(0);
      expect(report.staleFiles[0].path).toBe('/test/repo/stale.ts');
    });
  });

  describe('getStaleFiles', () => {
    it('returns only stale and critical files', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const files = [
        createMockFileKnowledge('/test/repo/fresh.ts', now),
        createMockFileKnowledge('/test/repo/stale.ts', thirtyDaysAgo), // Indexed 30 days ago
      ];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // All files have mtime = now, so:
      // fresh.ts: lastIndexed = now -> fresh
      // stale.ts: lastIndexed = 30 days ago -> stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const staleFiles = await detector.getStaleFiles('/test/repo');

      expect(staleFiles.every((f) => f.status === 'stale' || f.status === 'critical')).toBe(true);
    });

    it('respects limit parameter', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const files = Array.from({ length: 10 }, (_, i) =>
        createMockFileKnowledge(`/test/repo/stale${i}.ts`, thirtyDaysAgo) // All indexed 30 days ago
      );
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
      });

      // All files have mtime = now -> all stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const staleFiles = await detector.getStaleFiles('/test/repo', 3);

      expect(staleFiles.length).toBeLessThanOrEqual(3);
    });

    it('sorts by freshness score ascending (most stale first)', async () => {
      const now = new Date();
      // Files indexed at different times (all modified now)
      const files = [
        createMockFileKnowledge('/test/repo/medium.ts', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
        createMockFileKnowledge('/test/repo/very_stale.ts', new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
        createMockFileKnowledge('/test/repo/slightly_stale.ts', new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)),
      ];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.9,
        criticalThreshold: 0.3,
      });

      // All files modified now -> staleness depends on when they were indexed
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      const staleFiles = await detector.getStaleFiles('/test/repo');

      // Verify sorted by freshness ascending (most stale first)
      for (let i = 1; i < staleFiles.length; i++) {
        expect(staleFiles[i - 1].freshnessScore).toBeLessThanOrEqual(staleFiles[i].freshnessScore);
      }
    });
  });

  describe('Evidence Ledger integration', () => {
    it('records staleness evidence when enabled', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const files = [createMockFileKnowledge('/test/repo/stale.ts', thirtyDaysAgo)]; // Indexed 30 days ago
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
        recordToLedger: true,
      });

      // File modified now, indexed 30 days ago -> stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      await detector.checkFile('/test/repo/stale.ts');

      expect(mockLedger.append).toHaveBeenCalled();
    });

    it('does not record to ledger when disabled', async () => {
      const now = new Date();
      const files = [createMockFileKnowledge('/test/repo/fresh.ts', now)];
      mockStorage = createMockStorage(files);
      const localLedger = createMockLedger();
      detector = new FreshnessDetector(mockStorage, localLedger, {
        recordToLedger: false,
      });

      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      await detector.checkFile('/test/repo/fresh.ts');

      // Fresh files don't get recorded anyway, but with recordToLedger: false
      // even stale files wouldn't be recorded
      expect(localLedger.append).not.toHaveBeenCalled();
    });

    it('includes appropriate provenance in evidence', async () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const files = [createMockFileKnowledge('/test/repo/stale.ts', thirtyDaysAgo)]; // Indexed 30 days ago
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.01,
        staleThreshold: 0.5,
        criticalThreshold: 0.1,
        recordToLedger: true,
      });

      // File modified now, indexed 30 days ago -> stale
      vi.mocked(fs.statSync).mockReturnValue({
        mtime: now,
        isFile: () => true,
      } as unknown as ReturnType<typeof fs.statSync>);

      await detector.checkFile('/test/repo/stale.ts');

      const appendCall = (mockLedger.append as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(appendCall.provenance.source).toBe('system_observation');
      expect(appendCall.provenance.method).toBe('freshness_detection');
    });
  });

  describe('edge cases', () => {
    it('handles empty file list', async () => {
      mockStorage = createMockStorage([]);
      detector = new FreshnessDetector(mockStorage, mockLedger);

      const report = await detector.generateReport('/test/repo');

      expect(report.totalFiles).toBe(0);
      expect(report.averageFreshness).toBe(1.0); // No files means 100% fresh
      expect(report.staleFiles).toEqual([]);
    });

    it('handles fs errors gracefully', async () => {
      const files = [createMockFileKnowledge('/test/repo/error.ts', new Date())];
      mockStorage = createMockStorage(files);
      detector = new FreshnessDetector(mockStorage, mockLedger);

      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = await detector.checkFile('/test/repo/error.ts');

      expect(result.status).toBe('critical');
      expect(result.recommendedAction).toContain('error');
    });
  });

  describe('factory function', () => {
    it('createFreshnessDetector creates a valid detector', () => {
      const det = createFreshnessDetector(mockStorage, mockLedger, {
        decayLambda: 0.05,
      });

      expect(det).toBeInstanceOf(FreshnessDetector);
      expect(det.getConfig().decayLambda).toBe(0.05);
    });
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('FreshnessDetector interfaces', () => {
  it('FreshnessConfig has correct shape', () => {
    const config: FreshnessConfig = {
      decayLambda: 0.001,
      staleThreshold: 0.7,
      criticalThreshold: 0.3,
      recordToLedger: true,
    };

    expect(config.decayLambda).toBe(0.001);
    expect(config.staleThreshold).toBe(0.7);
    expect(config.criticalThreshold).toBe(0.3);
    expect(config.recordToLedger).toBe(true);
  });

  it('FreshnessResult has correct shape', () => {
    const result: FreshnessResult = {
      path: '/test/file.ts',
      lastModified: new Date(),
      lastIndexed: new Date(),
      freshnessScore: 0.85,
      status: 'fresh',
      recommendedAction: 'No action needed',
    };

    expect(result.path).toBe('/test/file.ts');
    expect(result.status).toBe('fresh');
    expect(result.freshnessScore).toBe(0.85);
  });

  it('FreshnessReport has correct shape', () => {
    const report: FreshnessReport = {
      totalFiles: 100,
      freshCount: 80,
      staleCount: 15,
      criticalCount: 5,
      averageFreshness: 0.78,
      staleFiles: [],
    };

    expect(report.totalFiles).toBe(100);
    expect(report.freshCount).toBe(80);
    expect(report.staleCount).toBe(15);
    expect(report.criticalCount).toBe(5);
    expect(report.averageFreshness).toBe(0.78);
  });

  it('status can be fresh, stale, or critical', () => {
    const statuses: FreshnessResult['status'][] = ['fresh', 'stale', 'critical'];

    for (const status of statuses) {
      const result: FreshnessResult = {
        path: '/test/file.ts',
        lastModified: new Date(),
        lastIndexed: new Date(),
        freshnessScore: 0.5,
        status,
        recommendedAction: 'Test',
      };
      expect(['fresh', 'stale', 'critical']).toContain(result.status);
    }
  });
});
