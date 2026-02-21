/**
 * @fileoverview Tests for dependency query handling
 *
 * Tests that structural queries like "what imports X" correctly use
 * graph traversal instead of semantic search.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseStructuralQueryIntent,
  shouldUseGraphTraversal,
  executeDependencyQuery,
  mergeGraphResultsWithCandidates,
  type StructuralQueryIntent,
  type ResolvedDependency,
} from '../dependency_query.js';
import type { LiBrainianStorage, GraphEdgeQueryOptions } from '../../storage/types.js';
import type { GraphEdge, ModuleKnowledge, FunctionKnowledge } from '../../types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(options: {
  modules?: ModuleKnowledge[];
  functions?: FunctionKnowledge[];
  edges?: GraphEdge[];
} = {}): LiBrainianStorage {
  const {
    modules = [],
    functions = [],
    edges = [],
  } = options;

  return {
    getModules: vi.fn().mockResolvedValue(modules),
    getFunctions: vi.fn().mockResolvedValue(functions),
    getGraphEdges: vi.fn().mockImplementation((queryOptions: GraphEdgeQueryOptions) => {
      let filtered = edges;

      if (queryOptions.toIds?.length) {
        filtered = filtered.filter((e) =>
          queryOptions.toIds!.some((id) => e.toId.includes(id) || id.includes(e.toId))
        );
      }

      if (queryOptions.fromIds?.length) {
        filtered = filtered.filter((e) =>
          queryOptions.fromIds!.some((id) => e.fromId.includes(id) || id.includes(e.fromId))
        );
      }

      if (queryOptions.sourceFiles?.length) {
        filtered = filtered.filter((e) =>
          queryOptions.sourceFiles!.some((sf) => e.sourceFile.includes(sf) || sf.includes(e.sourceFile))
        );
      }

      if (queryOptions.edgeTypes?.length) {
        filtered = filtered.filter((e) => queryOptions.edgeTypes!.includes(e.edgeType));
      }

      if (queryOptions.limit) {
        filtered = filtered.slice(0, queryOptions.limit);
      }

      return Promise.resolve(filtered);
    }),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// INTENT PARSING TESTS
// ============================================================================

describe('parseStructuralQueryIntent', () => {
  describe('dependent queries (what imports X?)', () => {
    it('parses "What imports utils.ts?"', () => {
      const result = parseStructuralQueryIntent('What imports utils.ts?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('utils.ts');
      expect(result.edgeTypes).toContain('imports');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('parses "What files import the storage module?"', () => {
      const result = parseStructuralQueryIntent('What files import the storage module?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('storage module');
      expect(result.edgeTypes).toContain('imports');
    });

    it('parses "What depends on LiBrainianStorage?"', () => {
      const result = parseStructuralQueryIntent('What depends on LiBrainianStorage?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('LiBrainianStorage');
      expect(result.edgeTypes).toContain('imports');
      expect(result.edgeTypes).toContain('calls');
    });

    it('parses "What calls the queryLiBrainian function?"', () => {
      const result = parseStructuralQueryIntent('What calls the queryLiBrainian function?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('queryLiBrainian function');
      expect(result.edgeTypes).toContain('calls');
    });

    it('parses "Show dependents of query.ts"', () => {
      const result = parseStructuralQueryIntent('Show dependents of query.ts');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('query.ts');
    });

    it('parses "Files that import types.ts"', () => {
      const result = parseStructuralQueryIntent('Files that import types.ts');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('types.ts');
      expect(result.edgeTypes).toContain('imports');
    });

    it('parses "What extends BaseClass?"', () => {
      const result = parseStructuralQueryIntent('What extends BaseClass?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('BaseClass');
      expect(result.edgeTypes).toContain('extends');
    });

    it('parses "What implements StorageInterface?"', () => {
      const result = parseStructuralQueryIntent('What implements StorageInterface?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('StorageInterface');
      expect(result.edgeTypes).toContain('implements');
    });

    it('parses "Reverse dependencies of sqlite_storage.ts"', () => {
      const result = parseStructuralQueryIntent('Reverse dependencies of sqlite_storage.ts');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependents');
      expect(result.targetEntity).toBe('sqlite_storage.ts');
    });
  });

  describe('dependency queries (what does X import?)', () => {
    it('parses "What does query.ts import?"', () => {
      const result = parseStructuralQueryIntent('What does query.ts import?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependencies');
      expect(result.targetEntity).toBe('query.ts');
      expect(result.edgeTypes).toContain('imports');
    });

    it('parses "What does the storage module depend on?"', () => {
      const result = parseStructuralQueryIntent('What does the storage module depend on?');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependencies');
      expect(result.targetEntity).toBe('storage module');
    });

    it('parses "Dependencies of sqlite_storage.ts"', () => {
      const result = parseStructuralQueryIntent('Dependencies of sqlite_storage.ts');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependencies');
      expect(result.targetEntity).toBe('sqlite_storage.ts');
    });

    it('parses "Show dependencies of index.ts"', () => {
      const result = parseStructuralQueryIntent('Show dependencies of index.ts');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependencies');
      expect(result.targetEntity).toBe('index.ts');
    });

    it("parses \"query.ts's dependencies\"", () => {
      const result = parseStructuralQueryIntent("query.ts's dependencies");
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependencies');
      expect(result.targetEntity).toBe('query.ts');
    });

    it('parses "Imports in bootstrap.ts"', () => {
      const result = parseStructuralQueryIntent('Imports in bootstrap.ts');
      expect(result.isStructural).toBe(true);
      expect(result.direction).toBe('dependencies');
      expect(result.targetEntity).toBe('bootstrap.ts');
    });
  });

  describe('non-structural queries', () => {
    it('returns isStructural=false for semantic queries', () => {
      const result = parseStructuralQueryIntent('How does authentication work?');
      expect(result.isStructural).toBe(false);
    });

    it('returns isStructural=false for empty queries', () => {
      const result = parseStructuralQueryIntent('');
      expect(result.isStructural).toBe(false);
    });

    it('returns isStructural=false for implementation queries', () => {
      const result = parseStructuralQueryIntent('Where is queryLiBrainian defined?');
      expect(result.isStructural).toBe(false);
    });

    it('returns isStructural=false for meta queries', () => {
      const result = parseStructuralQueryIntent('What is the purpose of the storage module?');
      expect(result.isStructural).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('cleans quoted target entities', () => {
      const result = parseStructuralQueryIntent('What imports "utils.ts"?');
      expect(result.targetEntity).toBe('utils.ts');
    });

    it('removes articles from target entities', () => {
      const result = parseStructuralQueryIntent('What imports the utils module?');
      expect(result.targetEntity).toBe('utils module');
    });

    it('handles trailing punctuation', () => {
      const result = parseStructuralQueryIntent('What imports utils.ts???');
      expect(result.targetEntity).toBe('utils.ts');
    });
  });
});

// ============================================================================
// SHOULD USE GRAPH TRAVERSAL TESTS
// ============================================================================

describe('shouldUseGraphTraversal', () => {
  it('returns true for "What imports X?" queries', () => {
    expect(shouldUseGraphTraversal('What imports utils.ts?')).toBe(true);
  });

  it('returns true for "What depends on X?" queries', () => {
    expect(shouldUseGraphTraversal('What depends on LiBrainianStorage?')).toBe(true);
  });

  it('returns false for semantic queries', () => {
    expect(shouldUseGraphTraversal('How does authentication work?')).toBe(false);
  });

  it('returns false for implementation queries', () => {
    expect(shouldUseGraphTraversal('Where is queryLiBrainian defined?')).toBe(false);
  });

  it('returns true for "Show dependents of X" queries', () => {
    expect(shouldUseGraphTraversal('Show dependents of query.ts')).toBe(true);
  });
});

// ============================================================================
// GRAPH EXECUTION TESTS
// ============================================================================

describe('executeDependencyQuery', () => {
  const mockModules: ModuleKnowledge[] = [
    { id: 'mod:utils', path: 'src/utils/index.ts', purpose: 'Utilities', exports: [], dependencies: [], confidence: 0.9 },
    { id: 'mod:storage', path: 'src/storage/types.ts', purpose: 'Storage types', exports: [], dependencies: [], confidence: 0.9 },
    { id: 'mod:query', path: 'src/api/query.ts', purpose: 'Query API', exports: [], dependencies: [], confidence: 0.9 },
    { id: 'mod:sqlite', path: 'src/storage/sqlite_storage.ts', purpose: 'SQLite storage', exports: [], dependencies: [], confidence: 0.9 },
  ];

  const mockEdges: GraphEdge[] = [
    {
      fromId: 'src/api/query.ts',
      fromType: 'module',
      toId: 'src/storage/types.ts',
      toType: 'module',
      edgeType: 'imports',
      sourceFile: 'src/api/query.ts',
      sourceLine: 5,
      confidence: 0.95,
      computedAt: new Date(),
    },
    {
      fromId: 'src/storage/sqlite_storage.ts',
      fromType: 'module',
      toId: 'src/storage/types.ts',
      toType: 'module',
      edgeType: 'imports',
      sourceFile: 'src/storage/sqlite_storage.ts',
      sourceLine: 3,
      confidence: 0.95,
      computedAt: new Date(),
    },
    {
      fromId: 'src/api/bootstrap.ts',
      fromType: 'module',
      toId: 'src/storage/types.ts',
      toType: 'module',
      edgeType: 'imports',
      sourceFile: 'src/api/bootstrap.ts',
      sourceLine: 7,
      confidence: 0.95,
      computedAt: new Date(),
    },
    {
      fromId: 'src/api/query.ts',
      fromType: 'module',
      toId: 'src/utils/index.ts',
      toType: 'module',
      edgeType: 'imports',
      sourceFile: 'src/api/query.ts',
      sourceLine: 10,
      confidence: 0.9,
      computedAt: new Date(),
    },
  ];

  it('finds all dependents of types.ts (what imports it)', async () => {
    const storage = createMockStorage({ modules: mockModules, edges: mockEdges });
    const intent = parseStructuralQueryIntent('What imports types.ts?');

    const result = await executeDependencyQuery(storage, intent, 'What imports types.ts?');

    expect(result.results.length).toBe(3);
    expect(result.results.map((r) => r.entityId)).toContain('src/api/query.ts');
    expect(result.results.map((r) => r.entityId)).toContain('src/storage/sqlite_storage.ts');
    expect(result.results.map((r) => r.entityId)).toContain('src/api/bootstrap.ts');
  });

  it('finds dependencies of query.ts (what it imports)', async () => {
    const storage = createMockStorage({ modules: mockModules, edges: mockEdges });
    const intent = parseStructuralQueryIntent('What does query.ts import?');

    const result = await executeDependencyQuery(storage, intent, 'What does query.ts import?');

    expect(result.results.length).toBe(2);
    expect(result.results.map((r) => r.entityId)).toContain('src/storage/types.ts');
    expect(result.results.map((r) => r.entityId)).toContain('src/utils/index.ts');
  });

  it('returns empty results for non-existent entity', async () => {
    const storage = createMockStorage({ modules: mockModules, edges: mockEdges });
    const intent = parseStructuralQueryIntent('What imports nonexistent.ts?');

    const result = await executeDependencyQuery(storage, intent, 'What imports nonexistent.ts?');

    expect(result.results.length).toBe(0);
    // When entity is not in modules but we try to query with it as target path,
    // we get "No edges found" rather than "Could not find"
    expect(result.explanation).toMatch(/Could not find|No .* edges found/);
  });

  it('provides helpful explanation for results', async () => {
    const storage = createMockStorage({ modules: mockModules, edges: mockEdges });
    const intent = parseStructuralQueryIntent('What imports types.ts?');

    const result = await executeDependencyQuery(storage, intent, 'What imports types.ts?');

    expect(result.explanation).toContain('Found 3');
    expect(result.explanation).toContain('imports');
  });

  it('deduplicates results by entityId', async () => {
    // Create edges that would result in duplicates
    const duplicateEdges: GraphEdge[] = [
      ...mockEdges,
      // Duplicate edge with different source line
      {
        fromId: 'src/api/query.ts',
        fromType: 'module',
        toId: 'src/storage/types.ts',
        toType: 'module',
        edgeType: 'imports',
        sourceFile: 'src/api/query.ts',
        sourceLine: 15, // Different line
        confidence: 0.95,
        computedAt: new Date(),
      },
    ];

    const storage = createMockStorage({ modules: mockModules, edges: duplicateEdges });
    const intent = parseStructuralQueryIntent('What imports types.ts?');

    const result = await executeDependencyQuery(storage, intent, 'What imports types.ts?');

    // Should still be 3, not 4 (duplicate removed)
    const queryCount = result.results.filter((r) => r.entityId === 'src/api/query.ts').length;
    expect(queryCount).toBe(1);
  });
});

// ============================================================================
// MERGE RESULTS TESTS
// ============================================================================

describe('mergeGraphResultsWithCandidates', () => {
  const graphResults: ResolvedDependency[] = [
    { entityId: 'file1', entityType: 'module', edgeType: 'imports', sourceFile: 'file1.ts', sourceLine: 5, confidence: 0.9 },
    { entityId: 'file2', entityType: 'module', edgeType: 'imports', sourceFile: 'file2.ts', sourceLine: 3, confidence: 0.85 },
  ];

  it('adds graph results as high-scoring candidates', () => {
    const existing = [
      { entityId: 'file3', score: 0.7 },
    ];

    const merged = mergeGraphResultsWithCandidates(graphResults, existing);

    // Should have 3 candidates
    expect(merged.length).toBe(3);

    // Graph results should be first (higher score)
    expect(merged[0].entityId).toBe('file1');
    expect(merged[0].score).toBeGreaterThanOrEqual(0.85);
  });

  it('boosts existing candidates that appear in graph results', () => {
    const existing = [
      { entityId: 'file1', score: 0.5 }, // This one is also in graph results
      { entityId: 'file3', score: 0.6 },
    ];

    const merged = mergeGraphResultsWithCandidates(graphResults, existing);

    // file1 should be boosted
    const file1 = merged.find((c) => c.entityId === 'file1');
    expect(file1?.score).toBeGreaterThan(0.5);
    expect(file1?.score).toBeGreaterThanOrEqual(0.8); // 0.5 + 0.3 boost

    // file3 should not be boosted
    const file3 = merged.find((c) => c.entityId === 'file3');
    expect(file3?.score).toBe(0.6);
  });

  it('does not create duplicates for entities in both lists', () => {
    const existing = [
      { entityId: 'file1', score: 0.5 },
      { entityId: 'file3', score: 0.6 },
    ];

    const merged = mergeGraphResultsWithCandidates(graphResults, existing);

    // file1 should appear only once (boosted existing, not added again)
    const file1Count = merged.filter((c) => c.entityId === 'file1').length;
    expect(file1Count).toBe(1);

    // file2 should be added from graph results
    const file2 = merged.find((c) => c.entityId === 'file2');
    expect(file2).toBeDefined();
  });

  it('handles empty graph results', () => {
    const existing = [
      { entityId: 'file1', score: 0.5 },
    ];

    const merged = mergeGraphResultsWithCandidates([], existing);

    expect(merged.length).toBe(1);
    expect(merged[0].score).toBe(0.5); // Unchanged
  });

  it('handles empty existing candidates', () => {
    const merged = mergeGraphResultsWithCandidates(graphResults, []);

    expect(merged.length).toBe(2);
    expect(merged[0].score).toBeGreaterThanOrEqual(0.85);
  });
});
