/**
 * @fileoverview Tests for SQLite WAL mode concurrent read support
 *
 * Verifies that WAL mode is enabled and allows multiple concurrent readers.
 * WAL mode should allow:
 * - Multiple simultaneous read queries
 * - One writer while reads are in progress
 *
 * Note: Since we use a process-level lock, true concurrent connection testing
 * requires verifying that WAL mode is set and that parallel reads within the
 * same connection complete successfully.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { LibrarianStorage } from '../types.js';
import type { FunctionKnowledge } from '../../types.js';

/**
 * Create a minimal FunctionKnowledge object for testing.
 */
function createTestFunction(id: string, name: string, filePath: string, startLine = 1): FunctionKnowledge {
  return {
    id,
    name,
    filePath,
    startLine,
    endLine: startLine + 9,
    signature: `function ${name}(): void`,
    purpose: `Test function ${name}`,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

describe('SQLite WAL Mode Concurrent Reads', () => {
  let storage: LibrarianStorage;
  let dbPath: string;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'librarian-wal-test-'));
    dbPath = join(testDir, 'test.db');
    storage = createSqliteStorage(dbPath, testDir);
    await storage.initialize();
  }, 30000);

  afterEach(async () => {
    await storage.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }, 30000);

  it('should have WAL mode enabled on the database', async () => {
    // Open a read-only connection to verify WAL mode
    // The main storage has exclusive lock, so we check via the -wal file presence
    // and by querying journal mode on a fresh connection after storage is closed
    await storage.close();

    const db = new Database(dbPath, { readonly: true });
    try {
      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(result[0].journal_mode.toLowerCase()).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('should create WAL and SHM files when database is used', async () => {
    // Insert some data to trigger WAL file creation
    const testFunc = createTestFunction('wal-test-func', 'testWalFunction', '/test/wal.ts');
    await storage.upsertFunction(testFunc);

    // WAL and SHM files should exist
    expect(existsSync(dbPath + '-wal')).toBe(true);
    expect(existsSync(dbPath + '-shm')).toBe(true);
  });

  it('should allow multiple concurrent read queries', async () => {
    // Insert test data
    for (let i = 0; i < 20; i++) {
      const func = createTestFunction(
        `concurrent-func-${i}`,
        `concurrentFunc${i}`,
        `/test/concurrent${i}.ts`
      );
      await storage.upsertFunction(func);
    }

    // Execute multiple read queries in parallel
    // With WAL mode, these should all complete without blocking each other
    const startTime = Date.now();

    const readPromises = Array.from({ length: 10 }, async (_, i) => {
      const result = await storage.getFunctions({ limit: 5 });
      return { queryIndex: i, count: result.length };
    });

    const results = await Promise.all(readPromises);
    const duration = Date.now() - startTime;

    // All queries should return results
    expect(results.every((r) => r.count > 0)).toBe(true);

    // All 10 queries should complete (we just verify they all returned)
    expect(results).toHaveLength(10);

    // Log timing for informational purposes
    // With WAL mode, parallel reads should complete quickly
    console.log(`10 parallel read queries completed in ${duration}ms`);
  });

  it('should allow reads to complete while write is prepared', async () => {
    // Insert initial data
    const initialFunc = createTestFunction('initial-func', 'initialFunc', '/test/initial.ts');
    await storage.upsertFunction(initialFunc);

    // Start multiple reads and a write concurrently
    // The reads should complete even as the write is being processed
    const newFunc = createTestFunction('new-func-during-reads', 'newFuncDuringReads', '/test/new.ts');

    const operations = [
      storage.getFunctions({ limit: 10 }),
      storage.getFunctions({ limit: 5 }),
      storage.getFunction('initial-func'),
      storage.upsertFunction(newFunc),
      storage.getFunctions({ limit: 10 }),
    ];

    const results = await Promise.all(operations);

    // All operations should complete
    expect(results).toHaveLength(5);

    // Verify reads returned data
    expect((results[0] as FunctionKnowledge[]).length).toBeGreaterThan(0);
    expect((results[1] as FunctionKnowledge[]).length).toBeGreaterThan(0);
    expect(results[2]).toBeTruthy();

    // Verify the new function was created
    const retrievedNewFunc = await storage.getFunction('new-func-during-reads');
    expect(retrievedNewFunc).toBeTruthy();
    expect(retrievedNewFunc?.name).toBe('newFuncDuringReads');
  });

  it('should maintain data consistency with concurrent operations', async () => {
    // Create multiple functions with sequential writes
    const writePromises = Array.from({ length: 10 }, (_, i) => {
      const func = createTestFunction(
        `consistency-func-${i}`,
        `consistencyFunc${i}`,
        `/test/consistency${i}.ts`,
        i * 10
      );
      return storage.upsertFunction(func);
    });

    await Promise.all(writePromises);

    // Now read all functions and verify consistency
    const functions = await storage.getFunctions({ limit: 100 });
    const consistencyFuncs = functions.filter((f) =>
      f.id.startsWith('consistency-func-')
    );

    // All 10 functions should be present
    expect(consistencyFuncs.length).toBe(10);

    // Verify each function has correct data
    for (let i = 0; i < 10; i++) {
      const func = consistencyFuncs.find((f) => f.id === `consistency-func-${i}`);
      expect(func).toBeTruthy();
      expect(func?.name).toBe(`consistencyFunc${i}`);
      expect(func?.startLine).toBe(i * 10);
    }
  });
});
