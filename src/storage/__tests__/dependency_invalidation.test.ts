/**
 * @fileoverview Tests for Dependency Invalidation Storage Methods
 *
 * Tests for invalidateCache, invalidateEmbeddings, and getReverseDependencies
 * methods on SqliteLibrarianStorage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteLibrarianStorage } from '../sqlite_storage.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testDir: string;
let storage: SqliteLibrarianStorage;

async function createTestStorage(): Promise<SqliteLibrarianStorage> {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-dep-inv-test-'));
  const dbPath = path.join(testDir, 'test.db');
  const testStorage = new SqliteLibrarianStorage(dbPath);
  await testStorage.initialize();
  return testStorage;
}

async function cleanupTestStorage(): Promise<void> {
  if (storage) {
    await storage.close();
  }
  if (testDir) {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('SqliteLibrarianStorage dependency invalidation', () => {
  beforeEach(async () => {
    storage = await createTestStorage();
  });

  afterEach(async () => {
    await cleanupTestStorage();
  });

  describe('invalidateCache', () => {
    it('invalidates query cache entries containing file path', async () => {
      // Set up some query cache entries
      await storage.upsertQueryCacheEntry({
        queryHash: 'hash1',
        queryParams: JSON.stringify({ files: ['src/api/query.ts', 'src/types.ts'] }),
        response: 'response1',
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 1,
      });
      await storage.upsertQueryCacheEntry({
        queryHash: 'hash2',
        queryParams: JSON.stringify({ files: ['src/other.ts'] }),
        response: 'response2',
        createdAt: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
        accessCount: 1,
      });

      // Invalidate cache for query.ts
      const count = await storage.invalidateCache('src/api/query.ts');

      // hash1 should be deleted, hash2 should remain
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify hash1 is gone
      const entry1 = await storage.getQueryCacheEntry('hash1');
      expect(entry1).toBeNull();

      // Verify hash2 still exists
      const entry2 = await storage.getQueryCacheEntry('hash2');
      expect(entry2).not.toBeNull();
    });

    it('returns 0 when no cache entries match', async () => {
      const count = await storage.invalidateCache('nonexistent.ts');
      expect(count).toBe(0);
    });
  });

  describe('invalidateEmbeddings', () => {
    it('invalidates embeddings for functions in a file', async () => {
      // Create a function
      await storage.upsertFunction({
        id: 'func1',
        filePath: 'src/api/query.ts',
        name: 'queryFunction',
        signature: 'function queryFunction(): void',
        purpose: 'Query something',
        startLine: 1,
        endLine: 10,
        confidence: 0.8,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      });

      // Create an embedding for this function
      await storage.setEmbedding(
        'func1',
        new Float32Array(384).fill(0.1),
        {
          modelId: 'test-model',
          entityType: 'function',
          generatedAt: new Date().toISOString(),
          tokenCount: 100,
        }
      );

      // Verify embedding exists
      const embeddingBefore = await storage.getEmbedding('func1');
      expect(embeddingBefore).not.toBeNull();

      // Invalidate embeddings for this file
      const count = await storage.invalidateEmbeddings('src/api/query.ts');
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify embedding is deleted
      const embeddingAfter = await storage.getEmbedding('func1');
      expect(embeddingAfter).toBeNull();
    });

    it('invalidates embeddings for modules', async () => {
      // Create a module
      await storage.upsertModule({
        id: 'mod1',
        path: 'src/storage/types.ts',
        purpose: 'Storage types',
        exports: ['LibrarianStorage'],
        dependencies: [],
        complexity: 10,
        confidence: 0.9,
      });

      // Create an embedding for this module
      await storage.setEmbedding(
        'mod1',
        new Float32Array(384).fill(0.2),
        {
          modelId: 'test-model',
          entityType: 'module',
          generatedAt: new Date().toISOString(),
          tokenCount: 200,
        }
      );

      // Verify embedding exists
      const embeddingBefore = await storage.getEmbedding('mod1');
      expect(embeddingBefore).not.toBeNull();

      // Invalidate embeddings for this file
      const count = await storage.invalidateEmbeddings('src/storage/types.ts');
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify embedding is deleted
      const embeddingAfter = await storage.getEmbedding('mod1');
      expect(embeddingAfter).toBeNull();
    });

    it('returns 0 when no embeddings match', async () => {
      const count = await storage.invalidateEmbeddings('nonexistent.ts');
      expect(count).toBe(0);
    });
  });

  describe('getGraphEdges filters', () => {
    it('supports both edgeType and edgeTypes filters', async () => {
      await storage.upsertGraphEdges([
        {
          fromId: 'fnA',
          fromType: 'function',
          toId: 'fnB',
          toType: 'function',
          edgeType: 'calls',
          sourceFile: 'src/a.ts',
          sourceLine: 10,
          confidence: 1.0,
          computedAt: new Date(),
        },
        {
          fromId: 'src/a.ts',
          fromType: 'file',
          toId: 'src/b.ts',
          toType: 'file',
          edgeType: 'imports',
          sourceFile: 'src/a.ts',
          sourceLine: 1,
          confidence: 1.0,
          computedAt: new Date(),
        },
      ]);

      const callsOnly = await storage.getGraphEdges({ edgeType: 'calls' });
      expect(callsOnly).toHaveLength(1);
      expect(callsOnly[0]?.edgeType).toBe('calls');

      const importsOnly = await storage.getGraphEdges({ edgeTypes: ['imports'] });
      expect(importsOnly).toHaveLength(1);
      expect(importsOnly[0]?.edgeType).toBe('imports');

      const merged = await storage.getGraphEdges({ edgeType: 'calls', edgeTypes: ['imports'] });
      expect(merged).toHaveLength(2);
      expect(new Set(merged.map((edge) => edge.edgeType))).toEqual(new Set(['calls', 'imports']));
    });
  });

  describe('getReverseDependencies', () => {
    it('returns files that import the given file', async () => {
      // Create import edges
      await storage.upsertGraphEdges([
        {
          fromId: 'src/api/query.ts',
          fromType: 'file',
          toId: 'src/types.ts',
          toType: 'file',
          edgeType: 'imports',
          sourceFile: 'src/api/query.ts',
          sourceLine: 1,
          confidence: 1.0,
          computedAt: new Date(),
        },
        {
          fromId: 'src/api/librarian.ts',
          fromType: 'file',
          toId: 'src/types.ts',
          toType: 'file',
          edgeType: 'imports',
          sourceFile: 'src/api/librarian.ts',
          sourceLine: 1,
          confidence: 1.0,
          computedAt: new Date(),
        },
        {
          fromId: 'src/api/bootstrap.ts',
          fromType: 'file',
          toId: 'src/storage/types.ts',
          toType: 'file',
          edgeType: 'imports',
          sourceFile: 'src/api/bootstrap.ts',
          sourceLine: 1,
          confidence: 1.0,
          computedAt: new Date(),
        },
      ]);

      // Get reverse dependencies for types.ts
      const deps = await storage.getReverseDependencies('src/types.ts');

      expect(deps).toHaveLength(2);
      expect(deps).toContain('src/api/query.ts');
      expect(deps).toContain('src/api/librarian.ts');
    });

    it('returns empty array when no importers exist', async () => {
      const deps = await storage.getReverseDependencies('isolated.ts');
      expect(deps).toHaveLength(0);
    });

    it('does not return call edges as imports', async () => {
      // Create a call edge (not an import)
      await storage.upsertGraphEdges([
        {
          fromId: 'funcA',
          fromType: 'function',
          toId: 'src/types.ts',
          toType: 'file',
          edgeType: 'calls',
          sourceFile: 'src/api/query.ts',
          sourceLine: 5,
          confidence: 1.0,
          computedAt: new Date(),
        },
      ]);

      const deps = await storage.getReverseDependencies('src/types.ts');
      expect(deps).toHaveLength(0);
    });
  });
});
