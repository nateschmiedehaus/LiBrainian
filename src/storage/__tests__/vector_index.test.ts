/**
 * @fileoverview Tests for VectorIndex with HNSW support
 *
 * Tests cover:
 * - HNSWIndex standalone functionality
 * - VectorIndex brute-force mode
 * - VectorIndex automatic HNSW mode switching
 * - Search quality and performance characteristics
 */

import os from 'node:os';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VectorIndex,
  HNSWIndex,
  HNSWConfig,
  DEFAULT_HNSW_CONFIG,
  HNSW_AUTO_THRESHOLD,
  type VectorIndexItem,
} from '../vector_index.js';

const TEST_HNSW_AUTO_THRESHOLD = 1_000;

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Generate a random unit vector of given dimension.
 */
function randomVector(dim: number): Float32Array {
  const vec = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    vec[i] = Math.random() - 0.5;
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) {
    vec[i] = vec[i]! / norm;
  }
  return vec;
}

/**
 * Generate a vector that is similar to the given vector (perturbation).
 */
function similarVector(base: Float32Array, noise: number = 0.1): Float32Array {
  const vec = new Float32Array(base.length);
  let norm = 0;
  for (let i = 0; i < base.length; i++) {
    vec[i] = base[i]! + (Math.random() - 0.5) * noise;
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < base.length; i++) {
    vec[i] = vec[i]! / norm;
  }
  return vec;
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate test items with optional clustering.
 */
function generateItems(
  count: number,
  dim: number = 384,
  clusters: number = 1
): VectorIndexItem[] {
  const items: VectorIndexItem[] = [];
  const clusterCenters: Float32Array[] = [];

  // Generate cluster centers
  for (let c = 0; c < clusters; c++) {
    clusterCenters.push(randomVector(dim));
  }

  for (let i = 0; i < count; i++) {
    const clusterIdx = i % clusters;
    const center = clusterCenters[clusterIdx]!;
    const embedding = similarVector(center, 0.3);
    const entityType = i % 3 === 0 ? 'function' : i % 3 === 1 ? 'module' : 'document';

    items.push({
      entityId: `entity_${i}`,
      entityType: entityType as 'function' | 'module' | 'document',
      embedding,
    });
  }

  return items;
}

/**
 * Returns a timing budget that scales when the host is under heavy load.
 * Keeps strong perf expectations while avoiding false failures on busy CI/dev machines.
 */
function adaptiveSearchBudgetMs(baseMs: number): number {
  const cpuCount = Math.max(1, os.cpus().length);
  const normalizedLoad = os.loadavg()[0] / cpuCount;
  const multiplier = normalizedLoad >= 1.0 ? 2.0 : normalizedLoad >= 0.75 ? 1.6 : 1.0;
  return Math.round(baseMs * multiplier);
}

// ============================================================================
// HNSW INDEX TESTS
// ============================================================================

describe('HNSWIndex', () => {
  describe('construction and configuration', () => {
    it('should use default config when none provided', () => {
      const index = new HNSWIndex();
      expect(index.size()).toBe(0);
      const stats = index.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.maxLayer).toBe(0);
      expect(stats.entryPoint).toBeNull();
    });

    it('should accept custom config', () => {
      const config: Partial<HNSWConfig> = {
        M: 32,
        efConstruction: 400,
        efSearch: 100,
      };
      const index = new HNSWIndex(config);
      expect(index.size()).toBe(0);
    });

    it('should have sensible defaults', () => {
      expect(DEFAULT_HNSW_CONFIG.M).toBe(16);
      expect(DEFAULT_HNSW_CONFIG.efConstruction).toBe(200);
      expect(DEFAULT_HNSW_CONFIG.efSearch).toBe(50);
    });
  });

  describe('insert and size', () => {
    let index: HNSWIndex;

    beforeEach(() => {
      index = new HNSWIndex();
    });

    it('should insert first node and set as entry point', () => {
      const vec = randomVector(384);
      index.insert('node_1', vec, 'function');

      expect(index.size()).toBe(1);
      const stats = index.getStats();
      expect(stats.entryPoint).toBe('node_1');
    });

    it('should insert multiple nodes', () => {
      for (let i = 0; i < 100; i++) {
        index.insert(`node_${i}`, randomVector(384), 'function');
      }

      expect(index.size()).toBe(100);
      const stats = index.getStats();
      expect(stats.nodeCount).toBe(100);
      expect(stats.maxLayer).toBeGreaterThanOrEqual(0);
      expect(stats.avgConnectionsPerNode).toBeGreaterThan(0);
    });

    it('should track dimensions', () => {
      index.insert('node_1', randomVector(384), 'function');
      expect(index.hasDimension(384)).toBe(true);
      expect(index.hasDimension(512)).toBe(false);

      index.insert('node_2', randomVector(512), 'module');
      expect(index.hasDimension(512)).toBe(true);
    });

    it('should update existing node on duplicate insert', () => {
      const vec1 = randomVector(384);
      const vec2 = randomVector(384);

      index.insert('node_1', vec1, 'function');
      expect(index.size()).toBe(1);

      index.insert('node_1', vec2, 'function');
      expect(index.size()).toBe(1);

      // The vector should be updated
      const results = index.search(vec2, 1);
      expect(results[0]?.id).toBe('node_1');
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    });

    it('should replace entity type when reinserting an existing node id', () => {
      const vec1 = randomVector(384);
      const vec2 = randomVector(384);

      index.insert('node_1', vec1, 'function');
      index.insert('node_1', vec2, 'module');

      const results = index.search(vec2, 1);
      expect(results[0]?.id).toBe('node_1');
      expect(results[0]?.entityType).toBe('module');
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    });
  });

  describe('search', () => {
    let index: HNSWIndex;
    let baseVector: Float32Array;

    beforeEach(() => {
      index = new HNSWIndex({ efSearch: 100 });
      baseVector = randomVector(384);

      // Insert a base node and similar nodes
      index.insert('base', baseVector, 'function');
      for (let i = 0; i < 50; i++) {
        const similar = similarVector(baseVector, 0.2);
        index.insert(`similar_${i}`, similar, 'function');
      }
      // Insert some dissimilar nodes
      for (let i = 0; i < 50; i++) {
        const dissimilar = randomVector(384);
        index.insert(`random_${i}`, dissimilar, 'module');
      }
    });

    it('should return empty array for empty index', () => {
      const emptyIndex = new HNSWIndex();
      const results = emptyIndex.search(randomVector(384), 10);
      expect(results).toEqual([]);
    });

    it('should find exact match with high similarity', () => {
      const results = index.search(baseVector, 1);
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('base');
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    });

    it('should return results sorted by similarity (descending)', () => {
      const results = index.search(baseVector, 10);
      expect(results.length).toBeLessThanOrEqual(10);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(results[i]!.similarity);
      }
    });

    it('should respect k limit', () => {
      const results = index.search(baseVector, 5);
      expect(results).toHaveLength(5);
    });

    it('should filter by entity type', () => {
      const results = index.search(baseVector, 100, ['module']);
      for (const result of results) {
        expect(result.entityType).toBe('module');
      }
    });

    it('should pre-filter traversal work when entity type is constrained', () => {
      const perfIndex = new HNSWIndex({ efSearch: 80 });
      for (let i = 0; i < 240; i++) {
        perfIndex.insert(`module_${i}`, randomVector(128), 'module');
      }
      for (let i = 0; i < 24; i++) {
        perfIndex.insert(`function_${i}`, randomVector(128), 'function');
      }

      const cosineSpy = vi.spyOn(
        perfIndex as unknown as { cosineDistance: (a: Float32Array, b: Float32Array) => number },
        'cosineDistance'
      );

      perfIndex.search(randomVector(128), 10);
      const unfilteredDistanceCalls = cosineSpy.mock.calls.length;
      cosineSpy.mockClear();

      const filtered = perfIndex.search(randomVector(128), 10, ['function']);
      const filteredDistanceCalls = cosineSpy.mock.calls.length;
      cosineSpy.mockRestore();

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((item) => item.entityType === 'function')).toBe(true);
      expect(filteredDistanceCalls).toBeLessThan(unfilteredDistanceCalls);
    });

    it('should find filtered results even when entry point type is excluded', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      try {
        const constrained = new HNSWIndex();
        const moduleVector = new Float32Array([1, 0, 0, 0]);
        const functionVector = new Float32Array([0, 1, 0, 0]);
        constrained.insert('module-entry', moduleVector, 'module');
        constrained.insert('function-target', functionVector, 'function');

        const results = constrained.search(functionVector, 5, ['function'], 0);
        expect(results.some((item) => item.id === 'function-target')).toBe(true);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should filter by minimum similarity', () => {
      const results = index.search(baseVector, 100, undefined, 0.8);
      for (const result of results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should find similar vectors with good recall', () => {
      // Search for vectors similar to base
      const query = similarVector(baseVector, 0.1);
      const results = index.search(query, 20);

      // Most results should be from the "similar" group
      const similarCount = results.filter(r => r.id.startsWith('similar') || r.id === 'base').length;
      expect(similarCount).toBeGreaterThanOrEqual(10); // At least 50% recall
    });

    it('should avoid excessive Array.sort calls during layer traversal', () => {
      const perfIndex = new HNSWIndex({ efSearch: 80 });
      for (let i = 0; i < 400; i++) {
        perfIndex.insert(`node_${i}`, randomVector(128), 'function');
      }

      const sortSpy = vi.spyOn(Array.prototype, 'sort');
      perfIndex.search(randomVector(128), 10);
      const sortCalls = sortSpy.mock.calls.length;
      sortSpy.mockRestore();

      expect(sortCalls).toBeLessThan(10);
    });
  });

  describe('remove', () => {
    let index: HNSWIndex;

    beforeEach(() => {
      index = new HNSWIndex();
      for (let i = 0; i < 20; i++) {
        index.insert(`node_${i}`, randomVector(384), 'function');
      }
    });

    it('should remove existing node', () => {
      expect(index.size()).toBe(20);
      const removed = index.remove('node_5');
      expect(removed).toBe(true);
      expect(index.size()).toBe(19);
    });

    it('should return false for non-existent node', () => {
      const removed = index.remove('non_existent');
      expect(removed).toBe(false);
      expect(index.size()).toBe(20);
    });

    it('should update entry point if removed', () => {
      const stats = index.getStats();
      const entryPoint = stats.entryPoint;

      if (entryPoint) {
        index.remove(entryPoint);
        const newStats = index.getStats();
        expect(newStats.entryPoint).not.toBe(entryPoint);
      }
    });
  });

  describe('clear', () => {
    it('should remove all nodes', () => {
      const index = new HNSWIndex();
      for (let i = 0; i < 50; i++) {
        index.insert(`node_${i}`, randomVector(384), 'function');
      }

      expect(index.size()).toBe(50);
      index.clear();
      expect(index.size()).toBe(0);

      const stats = index.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.entryPoint).toBeNull();
      expect(stats.maxLayer).toBe(0);
    });

    it('should round-trip serialize and deserialize HNSW payload', () => {
      const index = new HNSWIndex({ efSearch: 100 });
      const items = generateItems(200, 128, 4);
      for (const item of items) {
        index.insert(item.entityId, item.embedding, item.entityType);
      }

      const serialized = index.serializeHNSW();
      expect(serialized.byteLength).toBeGreaterThan(0);

      const restored = HNSWIndex.deserializeHNSW(serialized);
      expect(restored.size()).toBe(index.size());
      expect(restored.hasDimension(128)).toBe(true);

      const query = items[0]!.embedding;
      const restoredResults = restored.search(query, 10);
      expect(restoredResults.some((result) => result.id === items[0]!.entityId)).toBe(true);
    });

    it('should reject malformed serialization payloads', () => {
      expect(() => HNSWIndex.deserializeHNSW(Buffer.from('not-a-valid-payload'))).toThrow(
        'Invalid HNSW payload'
      );
    });
  });

  describe('search quality', () => {
    it('should achieve good recall on clustered data', () => {
      const index = new HNSWIndex({ M: 16, efConstruction: 200, efSearch: 100 });

      // Create 5 clusters with 20 items each
      const clusters = 5;
      const itemsPerCluster = 20;
      const dim = 128;
      const clusterCenters: Float32Array[] = [];
      const clusterItems: Map<number, string[]> = new Map();

      // Create cluster centers and items
      for (let c = 0; c < clusters; c++) {
        const center = randomVector(dim);
        clusterCenters.push(center);
        clusterItems.set(c, []);

        for (let i = 0; i < itemsPerCluster; i++) {
          const id = `cluster_${c}_item_${i}`;
          const vec = similarVector(center, 0.1);
          index.insert(id, vec, 'function');
          clusterItems.get(c)!.push(id);
        }
      }

      // Query each cluster center and check recall
      for (let c = 0; c < clusters; c++) {
        const query = similarVector(clusterCenters[c]!, 0.05);
        const results = index.search(query, 10);
        const expectedItems = new Set(clusterItems.get(c)!);

        const matches = results.filter(r => expectedItems.has(r.id)).length;
        expect(matches).toBeGreaterThanOrEqual(5); // At least 50% of top-10 from correct cluster
      }
    });
  });
});

// ============================================================================
// VECTOR INDEX TESTS
// ============================================================================

describe('VectorIndex', () => {
  describe('brute-force mode', () => {
    it('should use brute-force for small indexes by default', () => {
      const index = new VectorIndex();
      const items = generateItems(100);
      index.load(items);

      expect(index.isUsingHNSW()).toBe(false);
    });

    it('should search correctly in brute-force mode', () => {
      const index = new VectorIndex();
      const items = generateItems(50, 128);
      index.load(items);

      const query = items[0]!.embedding;
      const results = index.search(query, { limit: 5, minSimilarity: 0 });

      expect(results).toHaveLength(5);
      expect(results[0]?.entityId).toBe('entity_0');
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    });

    it('should filter by entity type', () => {
      const index = new VectorIndex();
      const items = generateItems(30, 128);
      index.load(items);

      const query = randomVector(128);
      const results = index.search(query, {
        limit: 100,
        minSimilarity: 0,
        entityTypes: ['function'],
      });

      for (const result of results) {
        expect(result.entityType).toBe('function');
      }
    });

    it('should filter by minimum similarity', () => {
      const index = new VectorIndex();
      const items = generateItems(50, 128);
      index.load(items);

      const query = randomVector(128);
      const results = index.search(query, {
        limit: 100,
        minSimilarity: 0.5,
      });

      for (const result of results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.5);
      }
    });
  });

  describe('HNSW mode', () => {
    it('should use HNSW when explicitly enabled', () => {
      const index = new VectorIndex({ useHNSW: true });
      const items = generateItems(50);
      index.load(items);

      expect(index.isUsingHNSW()).toBe(true);
    });

    it('should not use HNSW when explicitly disabled', () => {
      const index = new VectorIndex({ useHNSW: false });
      const items = generateItems(2000);
      index.load(items);

      expect(index.isUsingHNSW()).toBe(false);
    });

    it('should auto-enable HNSW above threshold', () => {
      const index = new VectorIndex({ useHNSW: 'auto', hnswAutoThreshold: TEST_HNSW_AUTO_THRESHOLD });
      const items = generateItems(TEST_HNSW_AUTO_THRESHOLD + 100);
      index.load(items);

      expect(index.isUsingHNSW()).toBe(true);
    });

    it('should not auto-enable HNSW below threshold', () => {
      const index = new VectorIndex({ useHNSW: 'auto', hnswAutoThreshold: TEST_HNSW_AUTO_THRESHOLD });
      const items = generateItems(TEST_HNSW_AUTO_THRESHOLD - 100);
      index.load(items);

      expect(index.isUsingHNSW()).toBe(false);
    });

    it('should return HNSW stats when in HNSW mode', () => {
      const index = new VectorIndex({ useHNSW: true });
      const items = generateItems(100);
      index.load(items);

      const stats = index.getHNSWStats();
      expect(stats).not.toBeNull();
      expect(stats!.nodeCount).toBe(100);
    });

    it('should return null stats when not in HNSW mode', () => {
      const index = new VectorIndex({ useHNSW: false });
      const items = generateItems(100);
      index.load(items);

      const stats = index.getHNSWStats();
      expect(stats).toBeNull();
    });

    it('should search correctly in HNSW mode', () => {
      const index = new VectorIndex({ useHNSW: true });
      const items = generateItems(200, 128);
      index.load(items);

      const query = items[0]!.embedding;
      const results = index.search(query, { limit: 5, minSimilarity: 0 });

      expect(results).toHaveLength(5);
      // Exact match should be first (or very close to first in approximate search)
      const exactMatchResult = results.find(r => r.entityId === 'entity_0');
      expect(exactMatchResult).toBeDefined();
      expect(exactMatchResult!.similarity).toBeGreaterThan(0.99);
    });

    it('should accept custom HNSW config', () => {
      const index = new VectorIndex({
        useHNSW: true,
        hnswConfig: {
          M: 32,
          efConstruction: 400,
          efSearch: 100,
        },
      });
      const items = generateItems(100);
      index.load(items);

      expect(index.isUsingHNSW()).toBe(true);
    });

    it('should restore serialized HNSW payloads directly', () => {
      const source = new VectorIndex({ useHNSW: true });
      const items = generateItems(250, 128, 5);
      source.load(items);

      const serialized = source.serializeHNSW();
      expect(serialized).not.toBeNull();

      const restored = new VectorIndex();
      restored.loadSerializedHNSW(serialized!);
      expect(restored.isUsingHNSW()).toBe(true);
      expect(restored.size()).toBe(items.length);

      const query = items[0]!.embedding;
      const results = restored.search(query, { limit: 10, minSimilarity: 0 });
      expect(results.some((result) => result.entityId === items[0]!.entityId)).toBe(true);
    });
  });

  describe('incremental updates', () => {
    it('should add items incrementally in brute-force mode', () => {
      const index = new VectorIndex({ useHNSW: false });
      index.load([]);

      for (let i = 0; i < 50; i++) {
        index.add({
          entityId: `entity_${i}`,
          entityType: 'function',
          embedding: randomVector(128),
        });
      }

      expect(index.size()).toBe(50);
    });

    it('should add items incrementally in HNSW mode', () => {
      const index = new VectorIndex({ useHNSW: true });
      index.load([]);

      for (let i = 0; i < 50; i++) {
        index.add({
          entityId: `entity_${i}`,
          entityType: 'function',
          embedding: randomVector(128),
        });
      }

      expect(index.size()).toBe(50);
      expect(index.isUsingHNSW()).toBe(true);
    });

    it('should replace existing items by entityId instead of duplicating them', () => {
      const index = new VectorIndex({ useHNSW: true });
      index.load([]);

      const original = randomVector(128);
      const updated = randomVector(128);

      index.add({
        entityId: 'entity_a',
        entityType: 'function',
        embedding: original,
      });

      index.add({
        entityId: 'entity_a',
        entityType: 'module',
        embedding: updated,
      });

      expect(index.size()).toBe(1);
      const results = index.search(updated, { limit: 1, minSimilarity: 0 });
      expect(results[0]?.entityId).toBe('entity_a');
      expect(results[0]?.entityType).toBe('module');
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    });

    it('should auto-upgrade to HNSW when threshold crossed', () => {
      const index = new VectorIndex({ useHNSW: 'auto', hnswAutoThreshold: TEST_HNSW_AUTO_THRESHOLD });
      const initialItems = generateItems(TEST_HNSW_AUTO_THRESHOLD - 10);
      index.load(initialItems);

      expect(index.isUsingHNSW()).toBe(false);

      // Add items to cross threshold
      for (let i = 0; i < 20; i++) {
        index.add({
          entityId: `new_entity_${i}`,
          entityType: 'function',
          embedding: randomVector(384),
        });
      }

      expect(index.isUsingHNSW()).toBe(true);
    });

    it('should remove items by ID', () => {
      const index = new VectorIndex({ useHNSW: false });
      const items = generateItems(50);
      index.load(items);

      expect(index.size()).toBe(50);
      const removed = index.removeById('entity_25');
      expect(removed).toBe(true);
      expect(index.size()).toBe(49);
    });

    it('should remove items from HNSW index', () => {
      const index = new VectorIndex({ useHNSW: true });
      const items = generateItems(50);
      index.load(items);

      expect(index.size()).toBe(50);
      const removed = index.removeById('entity_25');
      expect(removed).toBe(true);
      expect(index.size()).toBe(49);

      // Verify removed item is not in search results
      const query = items[25]!.embedding;
      const results = index.search(query, { limit: 100, minSimilarity: 0 });
      expect(results.find(r => r.entityId === 'entity_25')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear brute-force index', () => {
      const index = new VectorIndex({ useHNSW: false });
      const items = generateItems(50);
      index.load(items);

      expect(index.size()).toBe(50);
      index.clear();
      expect(index.size()).toBe(0);
    });

    it('should clear HNSW index', () => {
      const index = new VectorIndex({ useHNSW: true });
      const items = generateItems(50);
      index.load(items);

      expect(index.size()).toBe(50);
      index.clear();
      expect(index.size()).toBe(0);

      const stats = index.getHNSWStats();
      expect(stats?.nodeCount).toBe(0);
    });
  });

  describe('dimension tracking', () => {
    it('should track dimensions from loaded items', () => {
      const index = new VectorIndex();
      const items = generateItems(10, 384);
      index.load(items);

      expect(index.hasDimension(384)).toBe(true);
      expect(index.hasDimension(512)).toBe(false);
    });

    it('should track multiple dimensions', () => {
      const index = new VectorIndex();
      index.load([
        { entityId: 'a', entityType: 'function', embedding: randomVector(384) },
        { entityId: 'b', entityType: 'module', embedding: randomVector(512) },
      ]);

      expect(index.hasDimension(384)).toBe(true);
      expect(index.hasDimension(512)).toBe(true);
      expect(index.hasDimension(768)).toBe(false);
    });
  });

  describe('search quality comparison', () => {
    it('should produce comparable results between brute-force and HNSW', () => {
      const items = generateItems(500, 128, 5);

      const bruteForce = new VectorIndex({ useHNSW: false });
      const hnsw = new VectorIndex({ useHNSW: true, hnswConfig: { efSearch: 100 } });

      bruteForce.load(items);
      hnsw.load(items);

      // Run multiple queries and compare
      for (let q = 0; q < 10; q++) {
        const query = items[Math.floor(Math.random() * items.length)]!.embedding;

        const bfResults = bruteForce.search(query, { limit: 10, minSimilarity: 0 });
        const hnswResults = hnsw.search(query, { limit: 10, minSimilarity: 0 });

        // HNSW should find at least 70% of the true top-10
        const bfTopIds = new Set(bfResults.map(r => r.entityId));
        const overlap = hnswResults.filter(r => bfTopIds.has(r.entityId)).length;
        expect(overlap).toBeGreaterThanOrEqual(7);
      }
    });
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases', () => {
  describe('empty queries and results', () => {
    it('should handle search on empty index', () => {
      const index = new VectorIndex();
      index.load([]);

      const results = index.search(randomVector(384), { limit: 10, minSimilarity: 0 });
      expect(results).toEqual([]);
    });

    it('should return results when no entity type filter is applied', () => {
      const index = new VectorIndex();
      const items = generateItems(50);
      index.load(items);

      // No entityTypes filter means return all types
      const results = index.search(randomVector(384), {
        limit: 10,
        minSimilarity: 0,
      });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return no results for non-existent entity type', () => {
      const index = new VectorIndex();
      // Create items with only 'function' type
      const items: VectorIndexItem[] = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          entityId: `entity_${i}`,
          entityType: 'function',
          embedding: randomVector(128),
        });
      }
      index.load(items);

      // Filter for 'document' type which doesn't exist
      const results = index.search(randomVector(128), {
        limit: 10,
        minSimilarity: 0,
        entityTypes: ['document'],
      });
      expect(results).toEqual([]);
    });

    it('should handle search with very high minSimilarity', () => {
      const index = new VectorIndex();
      const items = generateItems(50);
      index.load(items);

      const results = index.search(randomVector(384), {
        limit: 10,
        minSimilarity: 0.999, // Very high threshold
      });
      // Random query unlikely to match anything at 99.9% similarity
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('dimension mismatches', () => {
    it('should skip items with mismatched dimensions in brute-force', () => {
      const index = new VectorIndex({ useHNSW: false });

      // Create specific vectors
      const vec128 = randomVector(128);
      const vec256 = randomVector(256);

      index.load([
        { entityId: 'a', entityType: 'function', embedding: vec128 },
        { entityId: 'b', entityType: 'function', embedding: vec256 },
      ]);

      expect(index.size()).toBe(2);
      expect(index.hasDimension(128)).toBe(true);
      expect(index.hasDimension(256)).toBe(true);

      // Query with 128 dimensions should only match 'a'
      // Use minSimilarity of -1 to catch all possible similarities
      const query128 = randomVector(128);
      const results128 = index.search(query128, { limit: 10, minSimilarity: -1 });
      expect(results128).toHaveLength(1);
      expect(results128[0]?.entityId).toBe('a');

      // Query with 256 dimensions should only match 'b'
      const query256 = randomVector(256);
      const results256 = index.search(query256, { limit: 10, minSimilarity: -1 });
      expect(results256).toHaveLength(1);
      expect(results256[0]?.entityId).toBe('b');
    });
  });

  describe('single item index', () => {
    it('should handle single item correctly', () => {
      const index = new VectorIndex({ useHNSW: true });
      const embedding = randomVector(128);
      index.load([{ entityId: 'solo', entityType: 'function', embedding }]);

      expect(index.size()).toBe(1);

      const results = index.search(embedding, { limit: 10, minSimilarity: 0 });
      expect(results).toHaveLength(1);
      expect(results[0]?.entityId).toBe('solo');
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    });
  });

  describe('zero vectors', () => {
    it('should handle zero vectors gracefully', () => {
      const index = new VectorIndex();
      const zeroVec = new Float32Array(128); // All zeros

      index.load([
        { entityId: 'zero', entityType: 'function', embedding: zeroVec },
        { entityId: 'normal', entityType: 'function', embedding: randomVector(128) },
      ]);

      // Searching with a normal vector
      const results = index.search(randomVector(128), { limit: 10, minSimilarity: 0 });
      // Zero vector should have 0 similarity, but shouldn't crash
      expect(results).toBeDefined();
    });
  });
});

// ============================================================================
// PERFORMANCE CHARACTERISTICS (not benchmarks, just sanity checks)
// ============================================================================

describe('Performance Characteristics', () => {
  it('should use a practical default HNSW auto threshold', () => {
    expect(HNSW_AUTO_THRESHOLD).toBe(5_000);
  });

  it('should build HNSW index in reasonable time', () => {
    const index = new VectorIndex({ useHNSW: true });
    const items = generateItems(1000, 128);

    const start = performance.now();
    index.load(items);
    const elapsed = performance.now() - start;

    // Should complete in under 5 seconds even on slow machines
    expect(elapsed).toBeLessThan(5000);
    expect(index.size()).toBe(1000);
  });

  it('should search in reasonable time', () => {
    const index = new VectorIndex({ useHNSW: true });
    const items = generateItems(1000, 128);
    index.load(items);

    const query = randomVector(128);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      index.search(query, { limit: 10, minSimilarity: 0 });
    }
    const elapsed = performance.now() - start;

    // 100 searches should complete within baseline budget, adjusted for host pressure.
    expect(elapsed).toBeLessThan(adaptiveSearchBudgetMs(1000));
  });
});
