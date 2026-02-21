/**
 * @fileoverview Tests for exhaustive mode in dependency_query.ts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseStructuralQueryIntent,
  executeExhaustiveDependencyQuery,
  shouldUseExhaustiveMode,
} from '../dependency_query.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { GraphEdge } from '../../types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(edges: GraphEdge[], modules: { id: string; path: string }[] = []): LiBrainianStorage {
  return {
    getGraphEdges: vi.fn(async (options) => {
      let filtered = edges;

      if (options?.toIds?.length) {
        filtered = filtered.filter(e => options.toIds!.some(id => e.toId === id || e.toId.includes(id)));
      }
      if (options?.fromIds?.length) {
        filtered = filtered.filter(e => options.fromIds!.some(id => e.fromId === id || e.fromId.includes(id)));
      }
      if (options?.edgeTypes?.length) {
        filtered = filtered.filter(e => options.edgeTypes!.includes(e.edgeType));
      }
      if (options?.sourceFiles?.length) {
        filtered = filtered.filter(e => options.sourceFiles!.includes(e.sourceFile));
      }

      return filtered;
    }),
    getModules: vi.fn(async () => modules.map(m => ({
      id: m.id,
      path: m.path,
      purpose: '',
      exports: [],
      dependencies: [],
      confidence: 0.9,
    }))),
    getFunctions: vi.fn(async () => []),
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
// TESTS: shouldUseExhaustiveMode
// ============================================================================

describe('shouldUseExhaustiveMode', () => {
  it('should detect "all" keyword patterns', () => {
    expect(shouldUseExhaustiveMode('all files that depend on storage')).toBe(true);
    expect(shouldUseExhaustiveMode('every module that imports types')).toBe(true);
    expect(shouldUseExhaustiveMode('complete list of importers')).toBe(true);
    expect(shouldUseExhaustiveMode('full list of dependents')).toBe(true);
  });

  it('should detect exhaustive/transitive keywords', () => {
    expect(shouldUseExhaustiveMode('exhaustive dependency analysis')).toBe(true);
    expect(shouldUseExhaustiveMode('transitive dependents of storage')).toBe(true);
  });

  it('should detect refactoring-related queries', () => {
    expect(shouldUseExhaustiveMode('refactor impact of changing storage')).toBe(true);
    expect(shouldUseExhaustiveMode('breaking change analysis for types.ts')).toBe(true);
    expect(shouldUseExhaustiveMode('impact analysis for SqliteStorage')).toBe(true);
  });

  it('should detect count queries', () => {
    expect(shouldUseExhaustiveMode('how many files depend on utils')).toBe(true);
    expect(shouldUseExhaustiveMode('total count of importers for types.ts')).toBe(true);
  });

  it('should NOT detect regular queries', () => {
    expect(shouldUseExhaustiveMode('what does storage do')).toBe(false);
    expect(shouldUseExhaustiveMode('explain the query module')).toBe(false);
    expect(shouldUseExhaustiveMode('find authentication code')).toBe(false);
    expect(shouldUseExhaustiveMode('what imports types')).toBe(false); // Not exhaustive
  });
});

// ============================================================================
// TESTS: executeExhaustiveDependencyQuery
// ============================================================================

describe('executeExhaustiveDependencyQuery', () => {
  it('should return ALL direct dependents without limit', async () => {
    // Create many edges to verify no artificial limit
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 300; i++) {
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

    const modules = [{ id: 'mod-types', path: 'src/storage/types.ts' }];
    const storage = createMockStorage(edges, modules);

    const intent = parseStructuralQueryIntent('what imports types.ts');
    const result = await executeExhaustiveDependencyQuery(storage, intent);

    // Should get ALL 300 dependents
    expect(result.results.length).toBe(300);
    expect(result.isExhaustive).toBe(true);
  });

  it('should handle transitive dependencies', async () => {
    // Chain: A -> B -> C -> Target
    const edges: GraphEdge[] = [
      { fromId: 'C.ts', fromType: 'file', toId: 'Target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'C.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'B.ts', fromType: 'file', toId: 'C.ts', toType: 'file', edgeType: 'imports', sourceFile: 'B.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'A.ts', fromType: 'file', toId: 'B.ts', toType: 'file', edgeType: 'imports', sourceFile: 'A.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const modules = [{ id: 'mod-target', path: 'Target.ts' }];
    const storage = createMockStorage(edges, modules);

    const intent = parseStructuralQueryIntent('what depends on Target.ts');
    const result = await executeExhaustiveDependencyQuery(storage, intent, {
      includeTransitive: true,
      maxDepth: 10,
    });

    // Should find all three: C (direct), B (depth 2), A (depth 3)
    expect(result.results.length).toBe(3);
    expect(result.transitiveCount).toBe(2);

    // Verify depths
    const depths = new Map(result.results.map(r => [r.entityId, (r as { depth?: number }).depth]));
    expect(depths.get('C.ts')).toBe(1);
    expect(depths.get('B.ts')).toBe(2);
    expect(depths.get('A.ts')).toBe(3);
  });

  it('should respect maxDepth limit', async () => {
    // Deep chain: A -> B -> C -> D -> E -> Target
    const edges: GraphEdge[] = [
      { fromId: 'E.ts', fromType: 'file', toId: 'Target.ts', toType: 'file', edgeType: 'imports', sourceFile: 'E.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'D.ts', fromType: 'file', toId: 'E.ts', toType: 'file', edgeType: 'imports', sourceFile: 'D.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'C.ts', fromType: 'file', toId: 'D.ts', toType: 'file', edgeType: 'imports', sourceFile: 'C.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'B.ts', fromType: 'file', toId: 'C.ts', toType: 'file', edgeType: 'imports', sourceFile: 'B.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'A.ts', fromType: 'file', toId: 'B.ts', toType: 'file', edgeType: 'imports', sourceFile: 'A.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const modules = [{ id: 'mod-target', path: 'Target.ts' }];
    const storage = createMockStorage(edges, modules);

    const intent = parseStructuralQueryIntent('what depends on Target.ts');
    const result = await executeExhaustiveDependencyQuery(storage, intent, {
      includeTransitive: true,
      maxDepth: 2, // Should only find E (depth 1) and D (depth 2)
    });

    expect(result.results.length).toBe(2);
    expect(result.results.map(r => r.entityId).sort()).toEqual(['D.ts', 'E.ts']);
  });

  it('should provide progress updates', async () => {
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 50; i++) {
      edges.push({
        fromId: `module${i}.ts`,
        fromType: 'file',
        toId: 'target.ts',
        toType: 'file',
        edgeType: 'imports',
        sourceFile: `module${i}.ts`,
        sourceLine: 1,
        confidence: 0.9,
        computedAt: new Date(),
      });
    }

    const modules = [{ id: 'mod-target', path: 'target.ts' }];
    const storage = createMockStorage(edges, modules);

    const progressUpdates: number[] = [];
    const intent = parseStructuralQueryIntent('what imports target.ts');

    await executeExhaustiveDependencyQuery(storage, intent, {
      onProgress: (count) => progressUpdates.push(count),
    });

    // Should have received progress updates
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(50);
  });

  it('should provide helpful explanation', async () => {
    const edges: GraphEdge[] = [
      { fromId: 'a.ts', fromType: 'file', toId: 'types.ts', toType: 'file', edgeType: 'imports', sourceFile: 'a.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
      { fromId: 'b.ts', fromType: 'file', toId: 'types.ts', toType: 'file', edgeType: 'imports', sourceFile: 'b.ts', sourceLine: 1, confidence: 0.9, computedAt: new Date() },
    ];

    const modules = [{ id: 'mod-types', path: 'types.ts' }];
    const storage = createMockStorage(edges, modules);

    const intent = parseStructuralQueryIntent('what imports types.ts');
    const result = await executeExhaustiveDependencyQuery(storage, intent);

    expect(result.explanation).toContain('EXHAUSTIVE');
    expect(result.explanation).toContain('2');
    expect(result.explanation).toContain('imports');
  });
});

// ============================================================================
// INTEGRATION: End-to-end exhaustive query
// ============================================================================

describe('integration: exhaustive query flow', () => {
  it('should correctly identify and execute exhaustive queries', async () => {
    // Create realistic scenario: many files importing storage/types.ts
    const edges: GraphEdge[] = [];
    const directories = ['api', 'cli', 'ingest', 'knowledge', 'query', 'storage', 'utils'];

    for (const dir of directories) {
      for (let i = 0; i < 30; i++) {
        edges.push({
          fromId: `src/${dir}/module${i}.ts`,
          fromType: 'file',
          toId: 'src/storage/types.ts',
          toType: 'file',
          edgeType: 'imports',
          sourceFile: `src/${dir}/module${i}.ts`,
          sourceLine: 1 + i,
          confidence: 0.85,
          computedAt: new Date(),
        });
      }
    }

    const modules = [{ id: 'storage-types', path: 'src/storage/types.ts' }];
    const storage = createMockStorage(edges, modules);

    // 1. Detect exhaustive intent
    const query = 'all files that depend on storage/types.ts';
    expect(shouldUseExhaustiveMode(query)).toBe(true);

    // 2. Parse structural intent
    const intent = parseStructuralQueryIntent(query);
    expect(intent.isStructural).toBe(true);
    expect(intent.direction).toBe('dependents');

    // 3. Execute exhaustive query
    const result = await executeExhaustiveDependencyQuery(storage, intent);

    // 4. Verify ALL 210 files are returned (7 dirs * 30 files each)
    expect(result.results.length).toBe(210);
    expect(result.isExhaustive).toBe(true);
    expect(result.explanation).toContain('210');
    expect(result.explanation).toContain('EXHAUSTIVE');
  });
});
