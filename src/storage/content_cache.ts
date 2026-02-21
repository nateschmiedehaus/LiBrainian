/**
 * @fileoverview Content-Hash Based Caching for LiBrainian
 *
 * Implements content-addressable caching for analysis results using SHA-256 hashing.
 * This enables:
 * - Automatic deduplication across workspaces
 * - Survival of file moves/renames (content-based, not path-based)
 * - Avoid re-analysis when content unchanged
 *
 * Based on research (RESEARCH-META-002) findings that content-addressable caching
 * provides high benefit with low complexity.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A cached analysis result entry.
 *
 * @typeParam T - The type of the analysis result being cached.
 */
export interface ContentCacheEntry<T> {
  /** SHA-256 hash of the content that was analyzed */
  contentHash: string;
  /** Version of the analysis code; cache invalidates on version upgrade */
  analysisVersion: string;
  /** The cached analysis result */
  result: T;
  /** When this entry was created */
  createdAt: Date;
  /** Number of times this cache entry has been accessed */
  accessCount: number;
}

/**
 * Statistics about the content cache.
 */
export interface CacheStats {
  /** Total number of entries in the cache */
  entries: number;
  /** Total cache hits since startup */
  hits: number;
  /** Total cache misses since startup */
  misses: number;
  /** Hit rate as a percentage (0-100) */
  hitRate: number;
  /** Approximate total size in bytes */
  totalSize: number;
  /** Number of entries expired via TTL since startup */
  ttlExpirations: number;
  /** Number of stale entries (expired but not yet evicted) */
  staleEntries: number;
}

/**
 * Content cache configuration options.
 */
export interface ContentCacheOptions {
  /** Maximum number of entries before LRU eviction (default: 10000) */
  maxEntries?: number;
  /** Maximum cache size in bytes before LRU eviction (default: 100MB) */
  maxSizeBytes?: number;
  /** Current analysis version for cache invalidation */
  analysisVersion: string;
  /** Time-to-live in milliseconds. 0 = no TTL (default: 0) */
  ttlMs?: number;
  /** Callback invoked when an entry is evicted */
  onEvict?: (key: string, reason: 'ttl' | 'lru' | 'version' | 'manual') => void;
}

/**
 * Content cache interface for storing analysis results by content hash.
 *
 * @typeParam T - The type of analysis results being cached.
 */
export interface ContentCache<T> {
  /**
   * Get a cached result for the given content hash.
   *
   * @param contentHash - SHA-256 hash of the content
   * @returns The cached result, or undefined if not found or version mismatch
   */
  get(contentHash: string): Promise<T | undefined>;

  /**
   * Store an analysis result in the cache.
   *
   * @param contentHash - SHA-256 hash of the content
   * @param result - The analysis result to cache
   */
  set(contentHash: string, result: T): Promise<void>;

  /**
   * Check if a cache entry exists for the given content hash.
   *
   * @param contentHash - SHA-256 hash of the content
   * @returns true if a valid (version-matching) entry exists
   */
  has(contentHash: string): Promise<boolean>;

  /**
   * Invalidate all cache entries for a specific analysis version.
   *
   * @param oldVersion - The version to invalidate
   * @returns Number of entries invalidated
   */
  invalidateByVersion(oldVersion: string): Promise<number>;

  /**
   * Get cache statistics.
   *
   * @returns Current cache statistics
   */
  getStats(): Promise<CacheStats>;

  /**
   * Clear all entries from the cache.
   *
   * @returns Number of entries cleared
   */
  clear(): Promise<number>;

  /**
   * Invalidate entries that have exceeded their TTL.
   * Only applicable when TTL is configured.
   *
   * @returns Number of entries invalidated
   */
  invalidateStale(): Promise<number>;
}

// ============================================================================
// HASH UTILITY
// ============================================================================

/**
 * Compute a SHA-256 hash of the given content.
 *
 * @param content - The string content to hash
 * @returns Hex-encoded SHA-256 hash (64 characters)
 *
 * @example
 * ```typescript
 * const hash = computeContentHash('function foo() { return 42; }');
 * // => "a1b2c3d4..." (64 hex characters)
 * ```
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ============================================================================
// SQLITE CONTENT CACHE IMPLEMENTATION
// ============================================================================

/**
 * Row type for the content_cache table.
 */
interface ContentCacheRow {
  hash: string;
  version: string;
  result: Buffer;
  created_at: number;
  access_count: number;
  last_accessed: number;
  size_bytes: number;
}

/**
 * SQLite-backed content cache implementation.
 *
 * Provides persistent caching of analysis results with LRU eviction,
 * version-based invalidation, and thread-safe concurrent access.
 *
 * @typeParam T - The type of analysis results being cached.
 */
export class SqliteContentCache<T> implements ContentCache<T> {
  private readonly db: Database.Database;
  private readonly analysisVersion: string;
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (key: string, reason: 'ttl' | 'lru' | 'version' | 'manual') => void;

  // In-memory stats (reset on restart)
  private hits = 0;
  private misses = 0;
  private ttlExpirations = 0;

  // Prepared statements (cached for performance)
  private readonly stmtGet: Database.Statement;
  private readonly stmtInsert: Database.Statement;
  private readonly stmtUpdate: Database.Statement;
  private readonly stmtHas: Database.Statement;
  private readonly stmtDelete: Database.Statement;
  private readonly stmtDeleteByVersion: Database.Statement;
  private readonly stmtStats: Database.Statement;
  private readonly stmtTotalSize: Database.Statement;
  private readonly stmtClear: Database.Statement;
  private readonly stmtEvictOldest: Database.Statement;
  private readonly stmtCountEntries: Database.Statement;
  private readonly stmtGetStaleHashes: Database.Statement;
  private readonly stmtDeleteStale: Database.Statement;
  private readonly stmtCountStale: Database.Statement;

  /**
   * Create a new SQLite content cache.
   *
   * @param db - The better-sqlite3 database instance
   * @param options - Cache configuration options
   */
  constructor(db: Database.Database, options: ContentCacheOptions) {
    this.db = db;
    this.analysisVersion = options.analysisVersion;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.maxSizeBytes = options.maxSizeBytes ?? 100 * 1024 * 1024; // 100MB
    this.ttlMs = options.ttlMs ?? 0; // 0 = no TTL
    this.onEvict = options.onEvict;

    // Create table if not exists
    this.ensureTable();

    // Prepare statements
    this.stmtGet = this.db.prepare(`
      SELECT hash, version, result, created_at, access_count, last_accessed, size_bytes
      FROM librainian_content_cache
      WHERE hash = ? AND version = ?
    `);

    this.stmtInsert = this.db.prepare(`
      INSERT INTO librainian_content_cache (hash, version, result, created_at, access_count, last_accessed, size_bytes)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(hash) DO UPDATE SET
        version = excluded.version,
        result = excluded.result,
        created_at = excluded.created_at,
        access_count = 0,
        last_accessed = excluded.last_accessed,
        size_bytes = excluded.size_bytes
    `);

    this.stmtUpdate = this.db.prepare(`
      UPDATE librainian_content_cache
      SET access_count = access_count + 1, last_accessed = ?
      WHERE hash = ?
    `);

    this.stmtHas = this.db.prepare(`
      SELECT 1 FROM librainian_content_cache
      WHERE hash = ? AND version = ?
    `);

    this.stmtDelete = this.db.prepare(`
      DELETE FROM librainian_content_cache WHERE hash = ?
    `);

    this.stmtDeleteByVersion = this.db.prepare(`
      DELETE FROM librainian_content_cache WHERE version = ?
    `);

    this.stmtStats = this.db.prepare(`
      SELECT COUNT(*) as entries FROM librainian_content_cache
    `);

    this.stmtTotalSize = this.db.prepare(`
      SELECT COALESCE(SUM(size_bytes), 0) as total_size FROM librainian_content_cache
    `);

    this.stmtClear = this.db.prepare(`
      DELETE FROM librainian_content_cache
    `);

    this.stmtEvictOldest = this.db.prepare(`
      DELETE FROM librainian_content_cache
      WHERE hash IN (
        SELECT hash FROM librainian_content_cache
        ORDER BY last_accessed ASC
        LIMIT ?
      )
    `);

    this.stmtCountEntries = this.db.prepare(`
      SELECT COUNT(*) as count FROM librainian_content_cache
    `);

    this.stmtGetStaleHashes = this.db.prepare(`
      SELECT hash FROM librainian_content_cache
      WHERE created_at < ?
    `);

    this.stmtDeleteStale = this.db.prepare(`
      DELETE FROM librainian_content_cache
      WHERE created_at < ?
    `);

    this.stmtCountStale = this.db.prepare(`
      SELECT COUNT(*) as count FROM librainian_content_cache
      WHERE created_at < ?
    `);
  }

  /**
   * Ensure the content_cache table exists with proper schema.
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS librainian_content_cache (
        hash TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        result BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_content_cache_version ON librainian_content_cache(version);
      CREATE INDEX IF NOT EXISTS idx_content_cache_last_accessed ON librainian_content_cache(last_accessed);
    `);
  }

  async get(contentHash: string): Promise<T | undefined> {
    const row = this.stmtGet.get(contentHash, this.analysisVersion) as ContentCacheRow | undefined;

    if (!row) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    const now = Date.now();
    if (this.ttlMs > 0 && (now - row.created_at) > this.ttlMs) {
      // Entry has expired
      this.stmtDelete.run(contentHash);
      this.ttlExpirations++;
      this.misses++;
      this.onEvict?.(contentHash, 'ttl');
      return undefined;
    }

    this.hits++;

    // Update access count and last accessed time
    this.stmtUpdate.run(now, contentHash);

    // Deserialize result
    try {
      const jsonStr = row.result.toString('utf-8');
      return JSON.parse(jsonStr) as T;
    } catch {
      // Corrupted entry, delete it
      this.stmtDelete.run(contentHash);
      return undefined;
    }
  }

  async set(contentHash: string, result: T): Promise<void> {
    const now = Date.now();
    const jsonStr = JSON.stringify(result);
    const buffer = Buffer.from(jsonStr, 'utf-8');
    const sizeBytes = buffer.length;

    this.stmtInsert.run(
      contentHash,
      this.analysisVersion,
      buffer,
      now,
      now,
      sizeBytes
    );

    // Check if we need to evict
    await this.evictIfNeeded();
  }

  async has(contentHash: string): Promise<boolean> {
    const row = this.stmtGet.get(contentHash, this.analysisVersion) as ContentCacheRow | undefined;
    if (!row) return false;

    // Check TTL expiration
    if (this.ttlMs > 0 && (Date.now() - row.created_at) > this.ttlMs) {
      return false;
    }

    return true;
  }

  async invalidateByVersion(oldVersion: string): Promise<number> {
    const result = this.stmtDeleteByVersion.run(oldVersion);
    return result.changes;
  }

  async invalidateStale(): Promise<number> {
    if (this.ttlMs === 0) return 0;

    const cutoff = Date.now() - this.ttlMs;

    // Get hashes of stale entries for callbacks
    if (this.onEvict) {
      const staleRows = this.stmtGetStaleHashes.all(cutoff) as Array<{ hash: string }>;
      for (const row of staleRows) {
        this.onEvict(row.hash, 'ttl');
      }
    }

    const result = this.stmtDeleteStale.run(cutoff);
    this.ttlExpirations += result.changes;
    return result.changes;
  }

  async getStats(): Promise<CacheStats> {
    const statsRow = this.stmtStats.get() as { entries: number };
    const sizeRow = this.stmtTotalSize.get() as { total_size: number };

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;

    // Count stale entries (expired but not yet evicted)
    let staleEntries = 0;
    if (this.ttlMs > 0) {
      const cutoff = Date.now() - this.ttlMs;
      const staleRow = this.stmtCountStale.get(cutoff) as { count: number };
      staleEntries = staleRow.count;
    }

    return {
      entries: statsRow.entries,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      totalSize: sizeRow.total_size,
      ttlExpirations: this.ttlExpirations,
      staleEntries,
    };
  }

  async clear(): Promise<number> {
    const result = this.stmtClear.run();
    this.hits = 0;
    this.misses = 0;
    this.ttlExpirations = 0;
    return result.changes;
  }

  /**
   * Evict oldest entries if cache exceeds limits.
   */
  private async evictIfNeeded(): Promise<void> {
    // Check entry count limit
    const countRow = this.stmtCountEntries.get() as { count: number };
    if (countRow.count > this.maxEntries) {
      const toEvict = countRow.count - this.maxEntries + Math.floor(this.maxEntries * 0.1); // Evict 10% extra
      this.stmtEvictOldest.run(toEvict);
      return;
    }

    // Check size limit
    const sizeRow = this.stmtTotalSize.get() as { total_size: number };
    if (sizeRow.total_size > this.maxSizeBytes) {
      // Evict 20% of entries by count when size limit exceeded
      const toEvict = Math.max(1, Math.floor(countRow.count * 0.2));
      this.stmtEvictOldest.run(toEvict);
    }
  }

  /**
   * Delete a specific entry from the cache.
   *
   * @param contentHash - The hash of the entry to delete
   * @returns true if an entry was deleted
   */
  async delete(contentHash: string): Promise<boolean> {
    const result = this.stmtDelete.run(contentHash);
    return result.changes > 0;
  }

  /**
   * Get or compute a cached value.
   *
   * If the value exists in cache, return it. Otherwise, compute it using
   * the provided function and store it in cache.
   *
   * @param content - The content to hash and use as cache key
   * @param computeFn - Function to compute the value if not cached
   * @returns The cached or computed value
   *
   * @example
   * ```typescript
   * const result = await cache.getOrCompute(fileContent, async () => {
   *   return await expensiveAnalysis(fileContent);
   * });
   * ```
   */
  async getOrCompute(content: string, computeFn: () => Promise<T>): Promise<T> {
    const hash = computeContentHash(content);

    const cached = await this.get(hash);
    if (cached !== undefined) {
      return cached;
    }

    const result = await computeFn();
    await this.set(hash, result);
    return result;
  }

  /**
   * Reset in-memory statistics.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.ttlExpirations = 0;
  }

  /**
   * Get the configured TTL in milliseconds.
   * Returns 0 if TTL is not configured.
   */
  getTtlMs(): number {
    return this.ttlMs;
  }
}

// ============================================================================
// IN-MEMORY CACHE (for testing)
// ============================================================================

/**
 * In-memory content cache implementation for testing.
 *
 * @typeParam T - The type of analysis results being cached.
 */
export class InMemoryContentCache<T> implements ContentCache<T> {
  private readonly cache = new Map<string, ContentCacheEntry<T>>();
  private readonly analysisVersion: string;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (key: string, reason: 'ttl' | 'lru' | 'version' | 'manual') => void;
  private hits = 0;
  private misses = 0;
  private ttlExpirations = 0;

  constructor(options: ContentCacheOptions) {
    this.analysisVersion = options.analysisVersion;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.ttlMs = options.ttlMs ?? 0;
    this.onEvict = options.onEvict;
  }

  async get(contentHash: string): Promise<T | undefined> {
    const entry = this.cache.get(contentHash);

    if (!entry || entry.analysisVersion !== this.analysisVersion) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.ttlMs > 0 && (Date.now() - entry.createdAt.getTime()) > this.ttlMs) {
      this.cache.delete(contentHash);
      this.ttlExpirations++;
      this.misses++;
      this.onEvict?.(contentHash, 'ttl');
      return undefined;
    }

    this.hits++;
    entry.accessCount++;
    return entry.result;
  }

  async set(contentHash: string, result: T): Promise<void> {
    // Evict if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(contentHash, {
      contentHash,
      analysisVersion: this.analysisVersion,
      result,
      createdAt: new Date(),
      accessCount: 0,
    });
  }

  async has(contentHash: string): Promise<boolean> {
    const entry = this.cache.get(contentHash);
    if (!entry || entry.analysisVersion !== this.analysisVersion) {
      return false;
    }

    // Check TTL expiration
    if (this.ttlMs > 0 && (Date.now() - entry.createdAt.getTime()) > this.ttlMs) {
      return false;
    }

    return true;
  }

  async invalidateByVersion(oldVersion: string): Promise<number> {
    let count = 0;
    for (const [hash, entry] of this.cache) {
      if (entry.analysisVersion === oldVersion) {
        this.cache.delete(hash);
        this.onEvict?.(hash, 'version');
        count++;
      }
    }
    return count;
  }

  async invalidateStale(): Promise<number> {
    if (this.ttlMs === 0) return 0;

    let invalidated = 0;
    const now = Date.now();

    for (const [hash, entry] of this.cache) {
      if ((now - entry.createdAt.getTime()) > this.ttlMs) {
        this.cache.delete(hash);
        this.ttlExpirations++;
        this.onEvict?.(hash, 'ttl');
        invalidated++;
      }
    }

    return invalidated;
  }

  async getStats(): Promise<CacheStats> {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;

    let totalSize = 0;
    let staleEntries = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      totalSize += JSON.stringify(entry.result).length;
      if (this.ttlMs > 0 && (now - entry.createdAt.getTime()) > this.ttlMs) {
        staleEntries++;
      }
    }

    return {
      entries: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      totalSize,
      ttlExpirations: this.ttlExpirations,
      staleEntries,
    };
  }

  async clear(): Promise<number> {
    const count = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.ttlExpirations = 0;
    return count;
  }

  private evictOldest(): void {
    // Find entry with lowest access count (simple LRU approximation)
    let oldest: string | undefined;
    let lowestAccess = Infinity;

    for (const [hash, entry] of this.cache) {
      if (entry.accessCount < lowestAccess) {
        lowestAccess = entry.accessCount;
        oldest = hash;
      }
    }

    if (oldest) {
      this.cache.delete(oldest);
      this.onEvict?.(oldest, 'lru');
    }
  }

  /**
   * Get or compute a cached value.
   *
   * @param content - The content to hash and use as cache key
   * @param computeFn - Function to compute the value if not cached
   * @returns The cached or computed value
   */
  async getOrCompute(content: string, computeFn: () => Promise<T>): Promise<T> {
    const hash = computeContentHash(content);

    const cached = await this.get(hash);
    if (cached !== undefined) {
      return cached;
    }

    const result = await computeFn();
    await this.set(hash, result);
    return result;
  }

  /**
   * Reset in-memory statistics.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.ttlExpirations = 0;
  }

  /**
   * Get the configured TTL in milliseconds.
   * Returns 0 if TTL is not configured.
   */
  getTtlMs(): number {
    return this.ttlMs;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a SQLite-backed content cache.
 *
 * @param db - The better-sqlite3 database instance
 * @param options - Cache configuration options
 * @returns A new SqliteContentCache instance
 *
 * @example
 * ```typescript
 * const cache = createContentCache(db, {
 *   analysisVersion: '1.0.0',
 *   maxEntries: 5000,
 * });
 *
 * // Store analysis result
 * const hash = computeContentHash(fileContent);
 * await cache.set(hash, analysisResult);
 *
 * // Retrieve from cache
 * const cached = await cache.get(hash);
 * ```
 */
export function createContentCache<T>(
  db: Database.Database,
  options: ContentCacheOptions
): SqliteContentCache<T> {
  return new SqliteContentCache<T>(db, options);
}

/**
 * Create an in-memory content cache (for testing).
 *
 * @param options - Cache configuration options
 * @returns A new InMemoryContentCache instance
 */
export function createInMemoryContentCache<T>(
  options: ContentCacheOptions
): InMemoryContentCache<T> {
  return new InMemoryContentCache<T>(options);
}
