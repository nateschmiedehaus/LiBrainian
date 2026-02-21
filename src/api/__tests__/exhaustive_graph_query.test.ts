/**
 * @fileoverview Tests for exhaustive graph query functionality
 *
 * Verifies that exhaustive mode returns ALL dependents, not just top-k samples.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  queryExhaustiveDependents,
  findAllImporters,
  findAllDependencies,
  getTransitiveClosure,
  detectExhaustiveIntent,
  extractTargetFromIntent,
  toFileList,
  type ExhaustiveQueryOptions,
} from '../exhaustive_graph_query.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { GraphEdge } from '../../types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(edges: GraphEdge[]): LiBrainianStorage {
  return {
    getGraphEdges: vi.fn(async (options) => {
      let filtered = edges;

      if (options?.toIds?.length) {
        filtered = filtered.filter(e => options.toIds!.includes(e.toId));
      }
      if (options?.fromIds?.length) {
        filtered = filtered.filter(e => options.fromIds!.includes(e.fromId));
      }
      if (options?.edgeTypes?.length) {
        filtered = filtered.filter(e => options.edgeTypes!.includes(e.edgeType));
      }
      if (options?.sourceFiles?.length) {
        filtered = filtered.filter(e => options.sourceFiles!.includes(e.sourceFile));
      }
      if (options?.limit) {
        filtered = filtered.slice(0, options.limit);
      }

      return filtered;
    }),
    // Add minimal required methods
    initialize: vi.fn(),
    close: vi.fn(),
    isInitialized: vi.fn(() => true),
    getCapabilities: vi.fn(() => ({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: { graphMetrics: false, multiVectors: false, embeddings: false, episodes: false, verificationPlans: false },
      versions: { schema: 1, api: 1 },
    })),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// TESTS: INTENT DETECTION
// ============================================================================

describe('detectExhaustiveIntent', () => {
  it('should detect "all files that depend on"', () => {
    expect(detectExhaustiveIntent('all files that depend on storage')).toBe(true);
    expect(detectExhaustiveIntent('every file that imports types.ts')).toBe(true);
    expect(detectExhaustiveIntent('complete list of dependents')).toBe(true);
  });

  it('should detect exhaustive keywords', () => {
    expect(detectExhaustiveIntent('show exhaustive dependencies')).toBe(true);
    expect(detectExhaustiveIntent('transitive dependents of X')).toBe(true);
    expect(detectExhaustiveIntent('refactor impact analysis')).toBe(true);
    expect(detectExhaustiveIntent('breaking change analysis')).toBe(true);
  });

  it('should detect count queries', () => {
    expect(detectExhaustiveIntent('how many files depend on storage')).toBe(true);
    expect(detectExhaustiveIntent('total count of importers')).toBe(true);
  });

  it('should NOT detect non-exhaustive queries', () => {
    expect(detectExhaustiveIntent('what is the storage module')).toBe(false);
    expect(detectExhaustiveIntent('explain authentication')).toBe(false);
    expect(detectExhaustiveIntent('find the main entry point')).toBe(false);
  });
});

describe('extractTargetFromIntent', () => {
  it('should extract target from "depends on X"', () => {
    const result = extractTargetFromIntent('What depends on SqliteLiBrainianStorage');
    expect(result.name).toBe('SqliteLiBrainianStorage');
    expect(result.type).toBe('symbol');
  });

  it('should extract file path', () => {
    const result = extractTargetFromIntent('files that import src/storage/types.ts');
    expect(result.path).toBe('src/storage/types.ts');
    expect(result.type).toBe('file');
  });

  it('should categorize PascalCase as symbol', () => {
    const result = extractTargetFromIntent('depends on EmbeddingService');
    expect(result.name).toBe('EmbeddingService');
    expect(result.type).toBe('symbol');
  });

  it('should categorize camelCase as symbol', () => {
    const result = extractTargetFromIntent('uses queryLiBrainian');
    expect(result.name).toBe('queryLiBrainian');
    expect(result.type).toBe('symbol');
  });
});

// ============================================================================
// TESTS: EXHAUSTIVE QUERY
// ============================================================================

describe('queryExhaustiveDependents', () => {
  it('should return ALL direct dependents without limit', async () => {
    // Create 250 edges to test that we get all of them (not just 200)
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 250; i++) {
      edges.push({
        fromId: `src/module${i}.ts`,
        fromType: 'file',
        toId: 'src/storage/types.ts',
        toType: 'file',
        edgeType: 'imports',
        sourceFile: `src/module${i}.ts`,
        sourceLine: 1,
        confidence: 0.9,
        computedAt: new Date(),
      });
    }

    const storage = createMockStorage(edges);

    const result = await queryExhaustiveDependents(storage, {
      targetId: 'src/storage/types.ts',
      direction: 'dependents',
      edgeTypes: ['imports'],
    });

    // Should get ALL 250 dependents, not limited to 200
    expect(result.totalCount).toBe(250);
    expect(result.directCount).toBe(250);
    expect(result.transitiveCount).toBe(0);
    expect(result.dependents).toHaveLength(250);
  });

  it('should handle transitive dependencies', async () => {
    // A imports B, B imports C, C imports Target
    // So A, B, C all depend on Target transitively
    const edges: GraphEdge[] = [
      // Direct: C imports Target
      { fromId: 'C.ts', fromType: 'file', toId: 'Target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'C.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      // B imports C
      { fromId: 'B.ts', fromType: 'file', toId: 'C.ts', toType: 'file', edgeType: 'imports', sourceFile: 'B.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      // A imports B
      { fromId: 'A.ts', fromType: 'file', toId: 'B.ts', toType: 'file', edgeType: 'imports', sourceFile: 'A.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);

    const result = await queryExhaustiveDependents(storage, {
      targetId: 'Target.ts',
      direction: 'dependents',
      edgeTypes: ['imports'],
      includeTransitive: true,
      maxDepth: 5,
    });

    // Should find C (direct), B (depth 2), A (depth 3)
    expect(result.totalCount).toBe(3);
    expect(result.directCount).toBe(1);
    expect(result.transitiveCount).toBe(2);

    // Check depths
    const cDep = result.dependents.find(d => d.entityId === 'C.ts');
    const bDep = result.dependents.find(d => d.entityId === 'B.ts');
    const aDep = result.dependents.find(d => d.entityId === 'A.ts');

    expect(cDep?.depth).toBe(1);
    expect(bDep?.depth).toBe(2);
    expect(aDep?.depth).toBe(3);
  });

  it('should track progress during traversal', async () => {
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 100; i++) {
      edges.push({
        fromId: `src/module${i}.ts`,
        fromType: 'file',
        toId: 'target.ts',
        toType: 'file',
        edgeType: 'imports',
        sourceFile: `src/module${i}.ts`,
        sourceLine: 1,
        confidence: 0.9,
        computedAt: new Date(),
      });
    }

    const storage = createMockStorage(edges);
    const progressCalls: number[] = [];

    await queryExhaustiveDependents(storage, {
      targetId: 'target.ts',
      direction: 'dependents',
      onProgress: (progress) => {
        progressCalls.push(progress.entitiesFound);
      },
    });

    // Should have been called with increasing counts
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1]).toBe(100);
  });

  it('should respect maxDepth limit', async () => {
    // Create a deep chain: A -> B -> C -> D -> E -> Target
    const edges: GraphEdge[] = [
      { fromId: 'E.ts', fromType: 'file', toId: 'Target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'E.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'D.ts', fromType: 'file', toId: 'E.ts', toType: 'file', edgeType: 'imports', sourceFile: 'D.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'C.ts', fromType: 'file', toId: 'D.ts', toType: 'file', edgeType: 'imports', sourceFile: 'C.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'B.ts', fromType: 'file', toId: 'C.ts', toType: 'file', edgeType: 'imports', sourceFile: 'B.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'A.ts', fromType: 'file', toId: 'B.ts', toType: 'file', edgeType: 'imports', sourceFile: 'A.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);

    const result = await queryExhaustiveDependents(storage, {
      targetId: 'Target.ts',
      direction: 'dependents',
      edgeTypes: ['imports'],
      includeTransitive: true,
      maxDepth: 3, // Should only reach C, not B or A
    });

    expect(result.maxDepthReached).toBe(3);
    expect(result.totalCount).toBe(3); // E, D, C only
    expect(result.dependents.map(d => d.entityId)).toContain('E.ts');
    expect(result.dependents.map(d => d.entityId)).toContain('D.ts');
    expect(result.dependents.map(d => d.entityId)).toContain('C.ts');
    expect(result.dependents.map(d => d.entityId)).not.toContain('B.ts');
    expect(result.dependents.map(d => d.entityId)).not.toContain('A.ts');
  });

  it('should group results by directory', async () => {
    const edges: GraphEdge[] = [
      { fromId: 'src/api/query.ts', fromType: 'file', toId: 'target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'src/api/query.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'src/api/packs.ts', fromType: 'file', toId: 'target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'src/api/packs.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'src/storage/sqlite.ts', fromType: 'file', toId: 'target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'src/storage/sqlite.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);

    const result = await queryExhaustiveDependents(storage, {
      targetId: 'target.ts',
      direction: 'dependents',
    });

    expect(result.byDirectory.size).toBe(2);
    expect(result.byDirectory.get('src/api')?.length).toBe(2);
    expect(result.byDirectory.get('src/storage')?.length).toBe(1);
  });
});

// ============================================================================
// TESTS: CONVENIENCE FUNCTIONS
// ============================================================================

describe('findAllImporters', () => {
  it('should find all files that import a target', async () => {
    const edges: GraphEdge[] = [
      { fromId: 'a.ts', fromType: 'file', toId: 'types.ts', toType: 'file', edgeType: 'imports', sourceFile: 'a.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'b.ts', fromType: 'file', toId: 'types.ts', toType: 'file', edgeType: 'imports', sourceFile: 'b.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      // This should NOT be included (different edge type)
      { fromId: 'c.ts', fromType: 'file', toId: 'types.ts', toType: 'file', edgeType: 'calls', sourceFile: 'c.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);
    const result = await findAllImporters(storage, 'types.ts');

    expect(result.totalCount).toBe(2);
    expect(result.dependents.map(d => d.entityId)).toContain('a.ts');
    expect(result.dependents.map(d => d.entityId)).toContain('b.ts');
    expect(result.dependents.map(d => d.entityId)).not.toContain('c.ts');
  });
});

describe('findAllDependencies', () => {
  it('should find all files a source depends on', async () => {
    const edges: GraphEdge[] = [
      { fromId: 'query.ts', fromType: 'file', toId: 'types.ts', toType: 'file', edgeType: 'imports', sourceFile: 'query.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'query.ts', fromType: 'file', toId: 'storage.ts', toType: 'file', edgeType: 'imports', sourceFile: 'query.ts', sourceLine: 2, confidence: 0.9, computedAt: new Date() },
      { fromId: 'query.ts', fromType: 'function', toId: 'helperFn', toType: 'function', edgeType: 'calls', sourceFile: 'query.ts', sourceLine: 10, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);
    const result = await findAllDependencies(storage, 'query.ts');

    expect(result.totalCount).toBe(3);
    expect(result.direction).toBe('dependencies');
  });
});

describe('getTransitiveClosure', () => {
  it('should find complete transitive closure', async () => {
    // A uses B, B uses C, C uses Target
    // Transitive closure of Target's dependents = {C, B, A}
    const edges: GraphEdge[] = [
      { fromId: 'C.ts', fromType: 'file', toId: 'Target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'C.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'B.ts', fromType: 'file', toId: 'C.ts', toType: 'file', edgeType: 'calls', sourceFile: 'B.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'A.ts', fromType: 'file', toId: 'B.ts', toType: 'file', edgeType: 'extends', sourceFile: 'A.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);
    const result = await getTransitiveClosure(storage, 'Target.ts');

    expect(result.totalCount).toBe(3);
    expect(result.transitiveCount).toBe(2);
    expect(result.dependents.map(d => d.entityId).sort()).toEqual(['A.ts', 'B.ts', 'C.ts']);
  });
});

describe('toFileList', () => {
  it('should convert result to simple file list', async () => {
    const edges: GraphEdge[] = [
      { fromId: 'a.ts', fromType: 'file', toId: 'target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'a.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'b.ts', fromType: 'file', toId: 'target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'b.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const storage = createMockStorage(edges);
    const result = await queryExhaustiveDependents(storage, {
      targetId: 'target.ts',
      direction: 'dependents',
    });

    const files = toFileList(result);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
    expect(files.length).toBe(2);
  });
});
