/**
 * @fileoverview Tests for Dependency Tracker
 *
 * Tests for file dependency tracking and cascading invalidation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DependencyTracker,
  createDependencyTracker,
  onFileChanged,
  type InvalidationResult,
} from '../dependency_tracker.js';
import type { LiBrainianStorage } from '../../storage/types.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockStorage(): LiBrainianStorage {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    getGraphEdges: vi.fn().mockResolvedValue([]),
    invalidateCache: vi.fn().mockResolvedValue(1),
    invalidateEmbeddings: vi.fn().mockResolvedValue(1),
    getReverseDependencies: vi.fn().mockResolvedValue([]),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// DEPENDENCY TRACKER UNIT TESTS
// ============================================================================

describe('DependencyTracker', () => {
  let tracker: DependencyTracker;

  beforeEach(() => {
    tracker = createDependencyTracker();
  });

  describe('recordImport', () => {
    it('records a single import relationship', () => {
      tracker.recordImport('src/api/query.ts', 'src/storage/types.ts');

      expect(tracker.getDirectImports('src/api/query.ts').has('src/storage/types.ts')).toBe(true);
      expect(tracker.getDirectImporters('src/storage/types.ts').has('src/api/query.ts')).toBe(true);
    });

    it('handles multiple imports from a single file', () => {
      tracker.recordImport('src/api/query.ts', 'src/storage/types.ts');
      tracker.recordImport('src/api/query.ts', 'src/utils/index.ts');
      tracker.recordImport('src/api/query.ts', 'src/types.ts');

      const imports = tracker.getDirectImports('src/api/query.ts');
      expect(imports.size).toBe(3);
      expect(imports.has('src/storage/types.ts')).toBe(true);
      expect(imports.has('src/utils/index.ts')).toBe(true);
      expect(imports.has('src/types.ts')).toBe(true);
    });

    it('handles multiple files importing the same dependency', () => {
      tracker.recordImport('src/api/query.ts', 'src/types.ts');
      tracker.recordImport('src/api/librainian.ts', 'src/types.ts');
      tracker.recordImport('src/api/bootstrap.ts', 'src/types.ts');

      const importers = tracker.getDirectImporters('src/types.ts');
      expect(importers.size).toBe(3);
      expect(importers.has('src/api/query.ts')).toBe(true);
      expect(importers.has('src/api/librainian.ts')).toBe(true);
      expect(importers.has('src/api/bootstrap.ts')).toBe(true);
    });

    it('handles duplicate imports idempotently', () => {
      tracker.recordImport('src/api/query.ts', 'src/types.ts');
      tracker.recordImport('src/api/query.ts', 'src/types.ts');
      tracker.recordImport('src/api/query.ts', 'src/types.ts');

      expect(tracker.getDirectImports('src/api/query.ts').size).toBe(1);
      expect(tracker.getDirectImporters('src/types.ts').size).toBe(1);
    });
  });

  describe('recordImports', () => {
    it('records multiple imports at once', () => {
      tracker.recordImports('src/api/query.ts', [
        'src/storage/types.ts',
        'src/utils/index.ts',
        'src/types.ts',
      ]);

      const imports = tracker.getDirectImports('src/api/query.ts');
      expect(imports.size).toBe(3);
    });
  });

  describe('getFilesToInvalidate', () => {
    it('returns empty array when file has no dependents', () => {
      tracker.recordImport('src/api/query.ts', 'src/types.ts');

      const toInvalidate = tracker.getFilesToInvalidate('src/api/query.ts');
      expect(toInvalidate).toHaveLength(0);
    });

    it('returns direct dependents', () => {
      tracker.recordImport('src/api/query.ts', 'src/types.ts');
      tracker.recordImport('src/api/librainian.ts', 'src/types.ts');

      const toInvalidate = tracker.getFilesToInvalidate('src/types.ts');
      expect(toInvalidate).toHaveLength(2);
      expect(toInvalidate).toContain('src/api/query.ts');
      expect(toInvalidate).toContain('src/api/librainian.ts');
    });

    it('returns transitive dependents (cascading invalidation)', () => {
      // types.ts <- storage.ts <- query.ts <- cli.ts
      tracker.recordImport('src/storage.ts', 'src/types.ts');
      tracker.recordImport('src/query.ts', 'src/storage.ts');
      tracker.recordImport('src/cli.ts', 'src/query.ts');

      const toInvalidate = tracker.getFilesToInvalidate('src/types.ts');
      expect(toInvalidate).toHaveLength(3);
      expect(toInvalidate).toContain('src/storage.ts');
      expect(toInvalidate).toContain('src/query.ts');
      expect(toInvalidate).toContain('src/cli.ts');
    });

    it('handles diamond dependencies correctly', () => {
      // types.ts <- storage.ts <- query.ts
      //          <- utils.ts   <-/
      tracker.recordImport('src/storage.ts', 'src/types.ts');
      tracker.recordImport('src/utils.ts', 'src/types.ts');
      tracker.recordImport('src/query.ts', 'src/storage.ts');
      tracker.recordImport('src/query.ts', 'src/utils.ts');

      const toInvalidate = tracker.getFilesToInvalidate('src/types.ts');
      // Should include storage, utils, and query (once, not twice)
      expect(toInvalidate).toHaveLength(3);
      expect(toInvalidate).toContain('src/storage.ts');
      expect(toInvalidate).toContain('src/utils.ts');
      expect(toInvalidate).toContain('src/query.ts');
    });

    it('handles circular dependencies without infinite loop', () => {
      // Create a cycle: a.ts <- b.ts <- c.ts <- a.ts (each imports the previous)
      // When a.ts changes, b.ts imports a.ts so it needs invalidation
      // c.ts imports b.ts, so it needs invalidation
      // a.ts imports c.ts, so it also appears (circular)
      tracker.recordImport('b.ts', 'a.ts'); // b imports a
      tracker.recordImport('c.ts', 'b.ts'); // c imports b
      tracker.recordImport('a.ts', 'c.ts'); // a imports c (completes cycle)

      // Should not hang and should find all files in the cycle
      const toInvalidate = tracker.getFilesToInvalidate('a.ts');
      // When a.ts changes: b.ts imports a.ts (direct), c.ts imports b.ts (transitive)
      // Then we find a.ts imports c.ts, but a.ts is already the changed file (not added to result)
      // Actually the cycle means: b imports a, c imports b, a imports c
      // If a changes, b needs revalidation (b->a).
      // Then c needs revalidation because c->b.
      // Then a needs revalidation because a->c, but a is visited so we don't loop forever.
      expect(toInvalidate.length).toBeGreaterThanOrEqual(2);
      expect(toInvalidate).toContain('b.ts');
      expect(toInvalidate).toContain('c.ts');
      // Note: a.ts may or may not be included depending on traversal order,
      // but the important thing is we don't hang on infinite loop
    });

    it('respects maxDepth parameter', () => {
      // Create a chain: a.ts <- b.ts <- c.ts <- d.ts <- e.ts
      tracker.recordImport('b.ts', 'a.ts');
      tracker.recordImport('c.ts', 'b.ts');
      tracker.recordImport('d.ts', 'c.ts');
      tracker.recordImport('e.ts', 'd.ts');

      // Depth 1: only direct dependents
      const depth1 = tracker.getFilesToInvalidate('a.ts', 1);
      expect(depth1).toHaveLength(1);
      expect(depth1).toContain('b.ts');

      // Depth 2: direct + one level
      const depth2 = tracker.getFilesToInvalidate('a.ts', 2);
      expect(depth2).toHaveLength(2);
      expect(depth2).toContain('b.ts');
      expect(depth2).toContain('c.ts');

      // Depth 0 (unlimited): all dependents
      const unlimited = tracker.getFilesToInvalidate('a.ts', 0);
      expect(unlimited).toHaveLength(4);
    });
  });

  describe('clearFile', () => {
    it('removes forward edges for a file', () => {
      tracker.recordImport('src/query.ts', 'src/types.ts');
      tracker.recordImport('src/query.ts', 'src/utils.ts');

      tracker.clearFile('src/query.ts');

      expect(tracker.getDirectImports('src/query.ts').size).toBe(0);
    });

    it('removes reverse edge references', () => {
      tracker.recordImport('src/query.ts', 'src/types.ts');

      tracker.clearFile('src/query.ts');

      // types.ts should no longer show query.ts as an importer
      expect(tracker.getDirectImporters('src/types.ts').has('src/query.ts')).toBe(false);
    });

    it('preserves other files dependencies', () => {
      tracker.recordImport('src/query.ts', 'src/types.ts');
      tracker.recordImport('src/librainian.ts', 'src/types.ts');

      tracker.clearFile('src/query.ts');

      // librainian.ts should still show as importing types.ts
      expect(tracker.getDirectImporters('src/types.ts').has('src/librainian.ts')).toBe(true);
    });
  });

  describe('hasDependents / hasDependencies', () => {
    it('correctly identifies files with dependents', () => {
      tracker.recordImport('src/query.ts', 'src/types.ts');

      expect(tracker.hasDependents('src/types.ts')).toBe(true);
      expect(tracker.hasDependents('src/query.ts')).toBe(false);
    });

    it('correctly identifies files with dependencies', () => {
      tracker.recordImport('src/query.ts', 'src/types.ts');

      expect(tracker.hasDependencies('src/query.ts')).toBe(true);
      expect(tracker.hasDependencies('src/types.ts')).toBe(false);
    });
  });

  describe('statistics', () => {
    it('returns correct file count', () => {
      tracker.recordImport('a.ts', 'b.ts');
      tracker.recordImport('a.ts', 'c.ts');
      tracker.recordImport('d.ts', 'b.ts');

      expect(tracker.getFileCount()).toBe(4); // a, b, c, d
    });

    it('returns correct edge count', () => {
      tracker.recordImport('a.ts', 'b.ts');
      tracker.recordImport('a.ts', 'c.ts');
      tracker.recordImport('d.ts', 'b.ts');

      expect(tracker.getEdgeCount()).toBe(3);
    });

    it('returns comprehensive stats', () => {
      tracker.recordImport('a.ts', 'b.ts');
      tracker.recordImport('a.ts', 'c.ts');
      tracker.recordImport('d.ts', 'b.ts');
      tracker.recordImport('e.ts', 'b.ts');
      tracker.recordImport('e.ts', 'c.ts');

      const stats = tracker.getStats();
      expect(stats.fileCount).toBe(5);
      expect(stats.edgeCount).toBe(5);
      expect(stats.maxDependents).toBe(3); // b.ts has 3 importers
      expect(stats.maxDependencies).toBe(2); // a.ts and e.ts have 2 imports each
    });
  });

  describe('clear', () => {
    it('removes all tracked dependencies', () => {
      tracker.recordImport('a.ts', 'b.ts');
      tracker.recordImport('c.ts', 'd.ts');

      tracker.clear();

      expect(tracker.getFileCount()).toBe(0);
      expect(tracker.getEdgeCount()).toBe(0);
    });
  });
});

// ============================================================================
// HYDRATION TESTS
// ============================================================================

describe('DependencyTracker hydration', () => {
  it('hydrates from storage graph edges', async () => {
    const mockStorage = createMockStorage();
    vi.mocked(mockStorage.getGraphEdges).mockResolvedValue([
      {
        fromId: 'src/query.ts',
        fromType: 'module',
        toId: 'src/types.ts',
        toType: 'module',
        edgeType: 'imports',
        sourceFile: 'src/query.ts',
        sourceLine: 1,
        confidence: 1.0,
        computedAt: new Date(),
      },
      {
        fromId: 'src/librainian.ts',
        fromType: 'module',
        toId: 'src/types.ts',
        toType: 'module',
        edgeType: 'imports',
        sourceFile: 'src/librainian.ts',
        sourceLine: 1,
        confidence: 1.0,
        computedAt: new Date(),
      },
    ]);

    const tracker = createDependencyTracker();
    await tracker.hydrateFromStorage(mockStorage);

    expect(mockStorage.getGraphEdges).toHaveBeenCalledWith({ edgeTypes: ['imports'] });
    expect(tracker.getFileCount()).toBeGreaterThan(0);
  });
});

// ============================================================================
// FILE CHANGE HANDLER TESTS
// ============================================================================

describe('onFileChanged', () => {
  let tracker: DependencyTracker;
  let mockStorage: LiBrainianStorage;

  beforeEach(() => {
    tracker = createDependencyTracker();
    mockStorage = createMockStorage();

    // Set up dependency graph
    tracker.recordImport('src/query.ts', 'src/types.ts');
    tracker.recordImport('src/librainian.ts', 'src/types.ts');
    tracker.recordImport('src/cli.ts', 'src/query.ts');
  });

  it('returns invalidation result with correct files', async () => {
    const result = await onFileChanged(mockStorage, tracker, 'src/types.ts');

    expect(result.changedFile).toBe('src/types.ts');
    expect(result.invalidatedFiles).toContain('src/query.ts');
    expect(result.invalidatedFiles).toContain('src/librainian.ts');
    expect(result.invalidatedFiles).toContain('src/cli.ts');
  });

  it('calls invalidateCache for dependent files', async () => {
    await onFileChanged(mockStorage, tracker, 'src/types.ts', { invalidateCache: true });

    expect(mockStorage.invalidateCache).toHaveBeenCalledWith('src/query.ts');
    expect(mockStorage.invalidateCache).toHaveBeenCalledWith('src/librainian.ts');
    expect(mockStorage.invalidateCache).toHaveBeenCalledWith('src/cli.ts');
  });

  it('calls invalidateEmbeddings for dependent files', async () => {
    await onFileChanged(mockStorage, tracker, 'src/types.ts', { invalidateEmbeddings: true });

    expect(mockStorage.invalidateEmbeddings).toHaveBeenCalledWith('src/query.ts');
    expect(mockStorage.invalidateEmbeddings).toHaveBeenCalledWith('src/librainian.ts');
    expect(mockStorage.invalidateEmbeddings).toHaveBeenCalledWith('src/cli.ts');
  });

  it('skips cache invalidation when disabled', async () => {
    await onFileChanged(mockStorage, tracker, 'src/types.ts', { invalidateCache: false });

    expect(mockStorage.invalidateCache).not.toHaveBeenCalled();
  });

  it('skips embedding invalidation when disabled', async () => {
    await onFileChanged(mockStorage, tracker, 'src/types.ts', { invalidateEmbeddings: false });

    expect(mockStorage.invalidateEmbeddings).not.toHaveBeenCalled();
  });

  it('respects maxDepth option', async () => {
    const result = await onFileChanged(mockStorage, tracker, 'src/types.ts', { maxDepth: 1 });

    // Only direct dependents should be included (query.ts, librainian.ts)
    // cli.ts depends on query.ts which depends on types.ts, so at depth 1 it shouldn't be included
    expect(result.invalidatedFiles).toContain('src/query.ts');
    expect(result.invalidatedFiles).toContain('src/librainian.ts');
    expect(result.invalidatedFiles).not.toContain('src/cli.ts');
  });

  it('clears dependency info for the changed file', async () => {
    // Before the change
    expect(tracker.getDirectImports('src/query.ts').has('src/types.ts')).toBe(true);

    // The changed file's dependencies should be cleared (they will be rebuilt on reindex)
    await onFileChanged(mockStorage, tracker, 'src/query.ts');

    // After clearFile, query.ts should have no imports
    expect(tracker.getDirectImports('src/query.ts').size).toBe(0);
  });

  it('handles errors gracefully', async () => {
    vi.mocked(mockStorage.invalidateCache).mockRejectedValue(new Error('Storage error'));

    const result = await onFileChanged(mockStorage, tracker, 'src/types.ts');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Storage error');
  });

  it('records duration', async () => {
    const result = await onFileChanged(mockStorage, tracker, 'src/types.ts');

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks cache and embedding invalidation counts separately', async () => {
    const result = await onFileChanged(mockStorage, tracker, 'src/types.ts');

    expect(result.cacheInvalidated.length).toBeGreaterThan(0);
    expect(result.embeddingsInvalidated.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge cases', () => {
  let tracker: DependencyTracker;

  beforeEach(() => {
    tracker = createDependencyTracker();
  });

  it('handles empty file path', () => {
    expect(tracker.getFilesToInvalidate('')).toHaveLength(0);
    expect(tracker.getDirectImports('')).toEqual(new Set());
    expect(tracker.getDirectImporters('')).toEqual(new Set());
  });

  it('handles file with no recorded dependencies', () => {
    expect(tracker.getFilesToInvalidate('nonexistent.ts')).toHaveLength(0);
    expect(tracker.hasDependents('nonexistent.ts')).toBe(false);
    expect(tracker.hasDependencies('nonexistent.ts')).toBe(false);
  });

  it('handles clearing a file that was never recorded', () => {
    // Should not throw
    tracker.clearFile('nonexistent.ts');
    expect(tracker.getFileCount()).toBe(0);
  });

  it('handles deeply nested dependency chains', () => {
    // Create a chain of 100 files
    for (let i = 1; i <= 100; i++) {
      tracker.recordImport(`file${i}.ts`, `file${i - 1}.ts`);
    }

    // Changing file0 should invalidate all 100 files
    const toInvalidate = tracker.getFilesToInvalidate('file0.ts');
    expect(toInvalidate).toHaveLength(100);
  });

  it('handles self-import (should not cause issues)', () => {
    tracker.recordImport('a.ts', 'a.ts');

    const toInvalidate = tracker.getFilesToInvalidate('a.ts');
    // a.ts imports itself, so it appears as its own dependent
    expect(toInvalidate).toContain('a.ts');
    expect(toInvalidate).toHaveLength(1);
  });
});
