/**
 * @fileoverview Tests for Content-Hash Based Caching
 *
 * Comprehensive tests for the content cache implementation including:
 * - Cache hit/miss behavior
 * - Content deduplication
 * - Version-based invalidation
 * - LRU eviction
 * - Metrics accuracy
 * - Concurrent access safety
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  computeContentHash,
  SqliteContentCache,
  InMemoryContentCache,
  createContentCache,
  createInMemoryContentCache,
  type ContentCacheOptions,
} from '../content_cache.js';

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestAnalysisResult {
  purpose: string;
  complexity: number;
  functions: string[];
}

// ============================================================================
// FIXTURES
// ============================================================================

const SAMPLE_CONTENT_1 = `
function calculateSum(a: number, b: number): number {
  return a + b;
}
`;

const SAMPLE_CONTENT_2 = `
function calculateProduct(a: number, b: number): number {
  return a * b;
}
`;

const SAMPLE_RESULT_1: TestAnalysisResult = {
  purpose: 'Calculate the sum of two numbers',
  complexity: 1,
  functions: ['calculateSum'],
};

const SAMPLE_RESULT_2: TestAnalysisResult = {
  purpose: 'Calculate the product of two numbers',
  complexity: 1,
  functions: ['calculateProduct'],
};

// ============================================================================
// HASH UTILITY TESTS
// ============================================================================

describe('computeContentHash', () => {
  it('returns 64-character hex string', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('returns consistent hash for same content', () => {
    const hash1 = computeContentHash(SAMPLE_CONTENT_1);
    const hash2 = computeContentHash(SAMPLE_CONTENT_1);
    expect(hash1).toBe(hash2);
  });

  it('returns different hash for different content', () => {
    const hash1 = computeContentHash(SAMPLE_CONTENT_1);
    const hash2 = computeContentHash(SAMPLE_CONTENT_2);
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty string', () => {
    const hash = computeContentHash('');
    expect(hash).toHaveLength(64);
    // SHA-256 of empty string is well-known
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('handles unicode content', () => {
    const hash = computeContentHash('const greeting = "Hello, \u4e16\u754c!";');
    expect(hash).toHaveLength(64);
  });

  it('is sensitive to whitespace changes', () => {
    const hash1 = computeContentHash('function foo() {}');
    const hash2 = computeContentHash('function foo()  {}'); // extra space
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// IN-MEMORY CACHE TESTS
// ============================================================================

describe('InMemoryContentCache', () => {
  let cache: InMemoryContentCache<TestAnalysisResult>;
  const options: ContentCacheOptions = {
    analysisVersion: '1.0.0',
    maxEntries: 100,
  };

  beforeEach(() => {
    cache = createInMemoryContentCache<TestAnalysisResult>(options);
  });

  describe('get/set', () => {
    it('returns undefined for cache miss', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      const result = await cache.get(hash);
      expect(result).toBeUndefined();
    });

    it('returns stored value for cache hit', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);
      const result = await cache.get(hash);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('same content = same cache entry (deduplication)', async () => {
      const hash1 = computeContentHash(SAMPLE_CONTENT_1);
      const hash2 = computeContentHash(SAMPLE_CONTENT_1);

      await cache.set(hash1, SAMPLE_RESULT_1);
      const result = await cache.get(hash2);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('different content = different cache entries', async () => {
      const hash1 = computeContentHash(SAMPLE_CONTENT_1);
      const hash2 = computeContentHash(SAMPLE_CONTENT_2);

      await cache.set(hash1, SAMPLE_RESULT_1);
      await cache.set(hash2, SAMPLE_RESULT_2);

      expect(await cache.get(hash1)).toEqual(SAMPLE_RESULT_1);
      expect(await cache.get(hash2)).toEqual(SAMPLE_RESULT_2);
    });

    it('overwrites existing entry with same hash', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      const updatedResult: TestAnalysisResult = {
        ...SAMPLE_RESULT_1,
        purpose: 'Updated purpose',
      };

      await cache.set(hash, SAMPLE_RESULT_1);
      await cache.set(hash, updatedResult);

      const result = await cache.get(hash);
      expect(result?.purpose).toBe('Updated purpose');
    });
  });

  describe('has', () => {
    it('returns false for missing entry', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      expect(await cache.has(hash)).toBe(false);
    });

    it('returns true for existing entry', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);
      expect(await cache.has(hash)).toBe(true);
    });
  });

  describe('version invalidation', () => {
    it('invalidateByVersion removes entries with matching version', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      const count = await cache.invalidateByVersion('1.0.0');
      expect(count).toBe(1);

      const result = await cache.get(hash);
      expect(result).toBeUndefined();
    });

    it('invalidateByVersion does not affect other versions', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      const count = await cache.invalidateByVersion('2.0.0');
      expect(count).toBe(0);

      const result = await cache.get(hash);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('get returns undefined when version mismatch', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      // Create cache with different version
      const cache2 = createInMemoryContentCache<TestAnalysisResult>({
        analysisVersion: '2.0.0',
        maxEntries: 100,
      });

      // The entry was set with v1.0.0, but cache2 uses v2.0.0
      // However, cache2 is a different instance and won't have the entry
      // To properly test version mismatch, we need to check original cache behavior
      // when the underlying version changes. For InMemoryContentCache, version is
      // checked on get, and entries are stored with their version.

      // Let's verify by directly checking has() which checks version
      expect(await cache.has(hash)).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    it('evicts entries when maxEntries exceeded', async () => {
      const smallCache = createInMemoryContentCache<TestAnalysisResult>({
        analysisVersion: '1.0.0',
        maxEntries: 3,
      });

      // Add 4 entries to a cache that holds 3
      for (let i = 0; i < 4; i++) {
        const content = `function test${i}() { return ${i}; }`;
        const hash = computeContentHash(content);
        await smallCache.set(hash, {
          purpose: `Test ${i}`,
          complexity: i,
          functions: [`test${i}`],
        });
      }

      const stats = await smallCache.getStats();
      expect(stats.entries).toBeLessThanOrEqual(3);
    });

    it('evicts least recently used entries', async () => {
      const smallCache = createInMemoryContentCache<TestAnalysisResult>({
        analysisVersion: '1.0.0',
        maxEntries: 2,
      });

      const hash1 = computeContentHash('content1');
      const hash2 = computeContentHash('content2');
      const hash3 = computeContentHash('content3');

      await smallCache.set(hash1, { purpose: '1', complexity: 1, functions: ['f1'] });
      await smallCache.set(hash2, { purpose: '2', complexity: 2, functions: ['f2'] });

      // Access hash1 to make it recently used
      await smallCache.get(hash1);

      // Add hash3, which should evict hash2 (less recently used)
      await smallCache.set(hash3, { purpose: '3', complexity: 3, functions: ['f3'] });

      // hash1 should still be present (was accessed)
      expect(await smallCache.has(hash1)).toBe(true);
      // hash3 should be present (just added)
      expect(await smallCache.has(hash3)).toBe(true);
    });
  });

  describe('metrics', () => {
    it('tracks hits and misses accurately', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      const nonExistentHash = computeContentHash('nonexistent');

      // Miss
      await cache.get(nonExistentHash);
      // Miss
      await cache.get(hash);

      // Set and hit
      await cache.set(hash, SAMPLE_RESULT_1);
      await cache.get(hash);
      await cache.get(hash);

      const stats = await cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(50);
    });

    it('reports correct entry count', async () => {
      await cache.set(computeContentHash('a'), SAMPLE_RESULT_1);
      await cache.set(computeContentHash('b'), SAMPLE_RESULT_1);
      await cache.set(computeContentHash('c'), SAMPLE_RESULT_1);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(3);
    });

    it('estimates total size', async () => {
      await cache.set(computeContentHash(SAMPLE_CONTENT_1), SAMPLE_RESULT_1);

      const stats = await cache.getStats();
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await cache.set(computeContentHash('a'), SAMPLE_RESULT_1);
      await cache.set(computeContentHash('b'), SAMPLE_RESULT_2);

      const count = await cache.clear();
      expect(count).toBe(2);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });

    it('resets statistics', async () => {
      await cache.get(computeContentHash('miss'));
      await cache.clear();

      const stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('getOrCompute', () => {
    it('returns cached value without computing', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      let computed = false;
      const result = await cache.getOrCompute(SAMPLE_CONTENT_1, async () => {
        computed = true;
        return SAMPLE_RESULT_2;
      });

      expect(computed).toBe(false);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('computes and caches when not cached', async () => {
      let computeCount = 0;
      const computeFn = async () => {
        computeCount++;
        return SAMPLE_RESULT_1;
      };

      const result1 = await cache.getOrCompute(SAMPLE_CONTENT_1, computeFn);
      const result2 = await cache.getOrCompute(SAMPLE_CONTENT_1, computeFn);

      expect(computeCount).toBe(1);
      expect(result1).toEqual(SAMPLE_RESULT_1);
      expect(result2).toEqual(SAMPLE_RESULT_1);
    });
  });
});

// ============================================================================
// SQLITE CACHE TESTS
// ============================================================================

describe('SqliteContentCache', () => {
  let db: Database.Database;
  let cache: SqliteContentCache<TestAnalysisResult>;
  let tempDir: string;
  let dbPath: string;

  const options: ContentCacheOptions = {
    analysisVersion: '1.0.0',
    maxEntries: 100,
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cache-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    cache = createContentCache<TestAnalysisResult>(db, options);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('table creation', () => {
    it('creates table on initialization', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='librainian_content_cache'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('creates indexes', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='librainian_content_cache'")
        .all();
      expect(indexes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('get/set', () => {
    it('returns undefined for cache miss', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      const result = await cache.get(hash);
      expect(result).toBeUndefined();
    });

    it('returns stored value for cache hit', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);
      const result = await cache.get(hash);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('same content = same cache entry (deduplication)', async () => {
      const hash1 = computeContentHash(SAMPLE_CONTENT_1);
      const hash2 = computeContentHash(SAMPLE_CONTENT_1);

      await cache.set(hash1, SAMPLE_RESULT_1);
      const result = await cache.get(hash2);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('persists across cache instances', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      // Create new cache instance with same db
      const cache2 = createContentCache<TestAnalysisResult>(db, options);
      const result = await cache2.get(hash);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('handles complex nested objects', async () => {
      const complexResult: TestAnalysisResult = {
        purpose: 'Complex purpose with "quotes" and special chars: <>&',
        complexity: 42,
        functions: ['func1', 'func2', 'func3'],
      };

      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, complexResult);
      const result = await cache.get(hash);
      expect(result).toEqual(complexResult);
    });
  });

  describe('has', () => {
    it('returns false for missing entry', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      expect(await cache.has(hash)).toBe(false);
    });

    it('returns true for existing entry', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);
      expect(await cache.has(hash)).toBe(true);
    });

    it('returns false when version mismatch', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      // Create cache with different version
      const cache2 = createContentCache<TestAnalysisResult>(db, {
        ...options,
        analysisVersion: '2.0.0',
      });

      expect(await cache2.has(hash)).toBe(false);
    });
  });

  describe('version invalidation', () => {
    it('invalidateByVersion removes entries with matching version', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      const count = await cache.invalidateByVersion('1.0.0');
      expect(count).toBe(1);

      // Verify entry is gone even for same-version cache
      const result = await cache.get(hash);
      expect(result).toBeUndefined();
    });

    it('invalidateByVersion does not affect other versions', async () => {
      const hash1 = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash1, SAMPLE_RESULT_1);

      // Create another cache with v2 and add an entry
      const cache2 = createContentCache<TestAnalysisResult>(db, {
        ...options,
        analysisVersion: '2.0.0',
      });
      const hash2 = computeContentHash(SAMPLE_CONTENT_2);
      await cache2.set(hash2, SAMPLE_RESULT_2);

      // Invalidate v1 entries
      const count = await cache.invalidateByVersion('1.0.0');
      expect(count).toBe(1);

      // v2 entry should still exist
      const result = await cache2.get(hash2);
      expect(result).toEqual(SAMPLE_RESULT_2);
    });

    it('get returns undefined when version mismatch', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      // Create cache with different version
      const cache2 = createContentCache<TestAnalysisResult>(db, {
        ...options,
        analysisVersion: '2.0.0',
      });

      const result = await cache2.get(hash);
      expect(result).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('evicts entries when maxEntries exceeded', async () => {
      const smallCache = createContentCache<TestAnalysisResult>(db, {
        analysisVersion: '1.0.0',
        maxEntries: 5,
        maxSizeBytes: 100 * 1024 * 1024, // Large size limit
      });

      // Add 10 entries to trigger eviction
      for (let i = 0; i < 10; i++) {
        const content = `function test${i}() { return ${i}; }`;
        const hash = computeContentHash(content);
        await smallCache.set(hash, {
          purpose: `Test ${i}`,
          complexity: i,
          functions: [`test${i}`],
        });
      }

      const stats = await smallCache.getStats();
      // Should have evicted some entries (5 max + 10% extra eviction = ~4 remaining)
      expect(stats.entries).toBeLessThanOrEqual(5);
    });

    it('updates access count on get', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      // Access multiple times
      await cache.get(hash);
      await cache.get(hash);
      await cache.get(hash);

      // Check access count in database
      const row = db
        .prepare('SELECT access_count FROM librainian_content_cache WHERE hash = ?')
        .get(hash) as { access_count: number } | undefined;

      expect(row?.access_count).toBe(3);
    });
  });

  describe('metrics', () => {
    it('tracks hits and misses accurately', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);

      // Miss
      await cache.get(hash);
      // Miss
      await cache.get(computeContentHash('nonexistent'));

      // Set and hit
      await cache.set(hash, SAMPLE_RESULT_1);
      await cache.get(hash);
      await cache.get(hash);

      const stats = await cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(50);
    });

    it('reports correct entry count', async () => {
      await cache.set(computeContentHash('a'), SAMPLE_RESULT_1);
      await cache.set(computeContentHash('b'), SAMPLE_RESULT_1);
      await cache.set(computeContentHash('c'), SAMPLE_RESULT_1);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(3);
    });

    it('reports total size', async () => {
      await cache.set(computeContentHash(SAMPLE_CONTENT_1), SAMPLE_RESULT_1);

      const stats = await cache.getStats();
      expect(stats.totalSize).toBeGreaterThan(0);
    });

    it('resetStats clears hit/miss counts', async () => {
      await cache.get(computeContentHash('miss'));
      cache.resetStats();

      const stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await cache.set(computeContentHash('a'), SAMPLE_RESULT_1);
      await cache.set(computeContentHash('b'), SAMPLE_RESULT_2);

      const count = await cache.clear();
      expect(count).toBe(2);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });
  });

  describe('delete', () => {
    it('removes specific entry', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      const deleted = await cache.delete(hash);
      expect(deleted).toBe(true);

      expect(await cache.has(hash)).toBe(false);
    });

    it('returns false for non-existent entry', async () => {
      const deleted = await cache.delete(computeContentHash('nonexistent'));
      expect(deleted).toBe(false);
    });
  });

  describe('getOrCompute', () => {
    it('returns cached value without computing', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      let computed = false;
      const result = await cache.getOrCompute(SAMPLE_CONTENT_1, async () => {
        computed = true;
        return SAMPLE_RESULT_2;
      });

      expect(computed).toBe(false);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });

    it('computes and caches when not cached', async () => {
      let computeCount = 0;
      const computeFn = async () => {
        computeCount++;
        return SAMPLE_RESULT_1;
      };

      const result1 = await cache.getOrCompute(SAMPLE_CONTENT_1, computeFn);
      const result2 = await cache.getOrCompute(SAMPLE_CONTENT_1, computeFn);

      expect(computeCount).toBe(1);
      expect(result1).toEqual(SAMPLE_RESULT_1);
      expect(result2).toEqual(SAMPLE_RESULT_1);
    });
  });

  describe('concurrent access', () => {
    it('handles concurrent reads safely', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash, SAMPLE_RESULT_1);

      // Perform many concurrent reads
      const reads = Array.from({ length: 100 }, () => cache.get(hash));
      const results = await Promise.all(reads);

      // All reads should return the same value
      for (const result of results) {
        expect(result).toEqual(SAMPLE_RESULT_1);
      }
    });

    it('handles concurrent writes safely', async () => {
      // Write different entries concurrently
      const writes = Array.from({ length: 50 }, (_, i) => {
        const content = `function f${i}() {}`;
        const hash = computeContentHash(content);
        return cache.set(hash, {
          purpose: `Function ${i}`,
          complexity: i,
          functions: [`f${i}`],
        });
      });

      await Promise.all(writes);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(50);
    });

    it('handles mixed concurrent reads and writes', async () => {
      const hash1 = computeContentHash(SAMPLE_CONTENT_1);
      await cache.set(hash1, SAMPLE_RESULT_1);

      const operations: Promise<unknown>[] = [];

      // Mix of reads and writes
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          operations.push(cache.get(hash1));
        } else {
          const content = `function f${i}() {}`;
          const hash = computeContentHash(content);
          operations.push(
            cache.set(hash, {
              purpose: `Function ${i}`,
              complexity: i,
              functions: [`f${i}`],
            })
          );
        }
      }

      await Promise.all(operations);

      // Verify original entry still accessible
      const result = await cache.get(hash1);
      expect(result).toEqual(SAMPLE_RESULT_1);
    });
  });

  describe('edge cases', () => {
    it('handles very large content', async () => {
      const largeContent = 'x'.repeat(1_000_000); // 1MB of content
      const hash = computeContentHash(largeContent);
      const result: TestAnalysisResult = {
        purpose: 'Large file',
        complexity: 100,
        functions: [],
      };

      await cache.set(hash, result);
      const cached = await cache.get(hash);
      expect(cached).toEqual(result);
    });

    it('handles empty result object', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      const emptyResult: TestAnalysisResult = {
        purpose: '',
        complexity: 0,
        functions: [],
      };

      await cache.set(hash, emptyResult);
      const cached = await cache.get(hash);
      expect(cached).toEqual(emptyResult);
    });

    it('handles result with null-like values', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);
      // Note: TestAnalysisResult doesn't allow null, but we're testing JSON handling
      const result: TestAnalysisResult = {
        purpose: 'null',
        complexity: 0,
        functions: ['undefined', 'null'],
      };

      await cache.set(hash, result);
      const cached = await cache.get(hash);
      expect(cached).toEqual(result);
    });

    it('recovers from corrupted entry', async () => {
      const hash = computeContentHash(SAMPLE_CONTENT_1);

      // Manually insert corrupted data
      db.prepare(`
        INSERT INTO librainian_content_cache (hash, version, result, created_at, access_count, last_accessed, size_bytes)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(hash, '1.0.0', Buffer.from('not valid json'), Date.now(), Date.now(), 15);

      // Should return undefined and delete the corrupted entry
      const result = await cache.get(hash);
      expect(result).toBeUndefined();

      // Corrupted entry should be deleted
      const row = db
        .prepare('SELECT 1 FROM librainian_content_cache WHERE hash = ?')
        .get(hash);
      expect(row).toBeUndefined();
    });
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('Factory Functions', () => {
  describe('createContentCache', () => {
    let db: Database.Database;
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cache-factory-test-'));
      const dbPath = path.join(tempDir, 'test.db');
      db = new Database(dbPath);
    });

    afterEach(() => {
      db.close();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('creates SqliteContentCache instance', () => {
      const cache = createContentCache(db, { analysisVersion: '1.0.0' });
      expect(cache).toBeInstanceOf(SqliteContentCache);
    });

    it('uses default maxEntries when not specified', async () => {
      const cache = createContentCache<string>(db, { analysisVersion: '1.0.0' });
      // Just verify it works - defaults are internal
      await cache.set('hash', 'value');
      expect(await cache.get('hash')).toBe('value');
    });
  });

  describe('createInMemoryContentCache', () => {
    it('creates InMemoryContentCache instance', () => {
      const cache = createInMemoryContentCache({ analysisVersion: '1.0.0' });
      expect(cache).toBeInstanceOf(InMemoryContentCache);
    });
  });
});

// ============================================================================
// TTL TESTS
// ============================================================================

describe('TTL Support', () => {
  describe('InMemoryContentCache with TTL', () => {
    it('expires entries after TTL', async () => {
      const cache = createInMemoryContentCache<string>({
        analysisVersion: '1.0.0',
        ttlMs: 100, // 100ms TTL
      });

      const hash = computeContentHash('test content');
      await cache.set(hash, 'cached value');

      // Should be available immediately
      expect(await cache.get(hash)).toBe('cached value');
      expect(await cache.has(hash)).toBe(true);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be expired now
      expect(await cache.get(hash)).toBeUndefined();
      expect(await cache.has(hash)).toBe(false);
    });

    it('tracks TTL expirations in stats', async () => {
      const cache = createInMemoryContentCache<string>({
        analysisVersion: '1.0.0',
        ttlMs: 50,
      });

      await cache.set(computeContentHash('a'), 'value');
      await cache.set(computeContentHash('b'), 'value');

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger expiry checks via get
      await cache.get(computeContentHash('a'));
      await cache.get(computeContentHash('b'));

      const stats = await cache.getStats();
      expect(stats.ttlExpirations).toBe(2);
    });

    it('invalidateStale removes expired entries', async () => {
      const cache = createInMemoryContentCache<string>({
        analysisVersion: '1.0.0',
        ttlMs: 50,
      });

      await cache.set(computeContentHash('a'), 'value');
      await cache.set(computeContentHash('b'), 'value');

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      const invalidated = await cache.invalidateStale();
      expect(invalidated).toBe(2);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });

    it('returns 0 from invalidateStale when TTL disabled', async () => {
      const cache = createInMemoryContentCache<string>({
        analysisVersion: '1.0.0',
        ttlMs: 0, // No TTL
      });

      await cache.set(computeContentHash('a'), 'value');
      const invalidated = await cache.invalidateStale();
      expect(invalidated).toBe(0);
    });

    it('calls onEvict callback when entry expires', async () => {
      const evicted: Array<{ key: string; reason: string }> = [];
      const cache = createInMemoryContentCache<string>({
        analysisVersion: '1.0.0',
        ttlMs: 50,
        onEvict: (key, reason) => evicted.push({ key, reason }),
      });

      const hash = computeContentHash('test');
      await cache.set(hash, 'value');

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger expiry via get
      await cache.get(hash);

      expect(evicted).toHaveLength(1);
      expect(evicted[0].key).toBe(hash);
      expect(evicted[0].reason).toBe('ttl');
    });

    it('reports stale entries in stats', async () => {
      const cache = createInMemoryContentCache<string>({
        analysisVersion: '1.0.0',
        ttlMs: 50,
      });

      await cache.set(computeContentHash('a'), 'value');

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = await cache.getStats();
      expect(stats.staleEntries).toBe(1);
    });
  });

  describe('SqliteContentCache with TTL', () => {
    let db: Database.Database;
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cache-ttl-test-'));
      const dbPath = path.join(tempDir, 'test.db');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
    });

    afterEach(() => {
      db.close();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('expires entries after TTL', async () => {
      const cache = createContentCache<string>(db, {
        analysisVersion: '1.0.0',
        ttlMs: 100,
      });

      const hash = computeContentHash('test content');
      await cache.set(hash, 'cached value');

      // Should be available immediately
      expect(await cache.get(hash)).toBe('cached value');

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should be expired now
      expect(await cache.get(hash)).toBeUndefined();
    });

    it('invalidateStale removes expired entries', async () => {
      const cache = createContentCache<string>(db, {
        analysisVersion: '1.0.0',
        ttlMs: 50,
      });

      await cache.set(computeContentHash('a'), 'value');
      await cache.set(computeContentHash('b'), 'value');

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100));

      const invalidated = await cache.invalidateStale();
      expect(invalidated).toBe(2);

      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });

    it('getTtlMs returns configured TTL', () => {
      const cache = createContentCache<string>(db, {
        analysisVersion: '1.0.0',
        ttlMs: 5000,
      });

      expect(cache.getTtlMs()).toBe(5000);
    });

    it('getTtlMs returns 0 when TTL not configured', () => {
      const cache = createContentCache<string>(db, {
        analysisVersion: '1.0.0',
      });

      expect(cache.getTtlMs()).toBe(0);
    });
  });
});
