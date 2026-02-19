import { describe, expect, it, vi } from 'vitest';
import type { Librarian } from '../../api/librarian.js';
import type { KnowledgeGraphEdge, LibrarianStorage } from '../../storage/types.js';
import { KnowledgeOwnershipMapConstruction } from '../knowledge_ownership_map_construction.js';

function createLibrarianWithStorage(storage: LibrarianStorage | null): Librarian {
  return {
    getStorage: vi.fn(() => storage),
  } as unknown as Librarian;
}

describe('KnowledgeOwnershipMapConstruction', () => {
  it('builds ownership map from ownership graph edges', async () => {
    const edges: KnowledgeGraphEdge[] = [
      {
        id: 'e1',
        sourceId: 'src/feature/auth.ts',
        targetId: 'alice',
        sourceType: 'file',
        targetType: 'author',
        edgeType: 'authored_by',
        weight: 0.7,
        confidence: 0.95,
        metadata: {},
        computedAt: new Date().toISOString(),
      },
      {
        id: 'e2',
        sourceId: 'src/feature/auth.ts',
        targetId: 'bob',
        sourceType: 'file',
        targetType: 'author',
        edgeType: 'authored_by',
        weight: 0.3,
        confidence: 0.95,
        metadata: {},
        computedAt: new Date().toISOString(),
      },
    ];

    const storage = {
      getKnowledgeEdges: vi.fn().mockResolvedValue(edges),
      getOwnerships: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;

    const construction = new KnowledgeOwnershipMapConstruction(
      createLibrarianWithStorage(storage)
    );

    const result = await construction.construct();

    expect(storage.getKnowledgeEdges).toHaveBeenCalledWith({
      edgeType: 'authored_by',
      limit: 50000,
    });
    expect(result.source).toBe('knowledge_graph');
    expect(result.missingStorage).toBe(false);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entityId).toBe('src/feature/auth.ts');
    expect(result.entities[0].primaryAuthor).toBe('alice');
    expect(result.entities[0].ownership).toBe(0.7);
    expect(result.authorSummary.alice?.totalEntities).toBe(1);
    expect(storage.getOwnerships).not.toHaveBeenCalled();
  });

  it('applies path and minOwnership filters', async () => {
    const edges: KnowledgeGraphEdge[] = [
      {
        id: 'e1',
        sourceId: 'src/feature/auth.ts',
        targetId: 'alice',
        sourceType: 'file',
        targetType: 'author',
        edgeType: 'authored_by',
        weight: 0.8,
        confidence: 0.95,
        metadata: {},
        computedAt: new Date().toISOString(),
      },
      {
        id: 'e2',
        sourceId: 'src/feature/auth.ts',
        targetId: 'bob',
        sourceType: 'file',
        targetType: 'author',
        edgeType: 'authored_by',
        weight: 0.2,
        confidence: 0.95,
        metadata: {},
        computedAt: new Date().toISOString(),
      },
      {
        id: 'e3',
        sourceId: 'src/platform/db.ts',
        targetId: 'carol',
        sourceType: 'file',
        targetType: 'author',
        edgeType: 'authored_by',
        weight: 1,
        confidence: 0.95,
        metadata: {},
        computedAt: new Date().toISOString(),
      },
    ];

    const storage = {
      getKnowledgeEdges: vi.fn().mockResolvedValue(edges),
      getOwnerships: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;

    const construction = new KnowledgeOwnershipMapConstruction(
      createLibrarianWithStorage(storage)
    );

    const result = await construction.construct({
      path: 'src/feature',
      minOwnership: 0.5,
    });

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entityId).toBe('src/feature/auth.ts');
    expect(result.entities[0].contributors).toEqual([
      {
        author: 'alice',
        percentage: 0.8,
      },
    ]);
    expect(result.authorSummary.carol).toBeUndefined();
    expect(result.options).toEqual({
      path: 'src/feature',
      minOwnership: 0.5,
    });
  });

  it('returns an empty map when storage is unavailable', async () => {
    const construction = new KnowledgeOwnershipMapConstruction(
      createLibrarianWithStorage(null)
    );

    const result = await construction.construct();

    expect(result.missingStorage).toBe(true);
    expect(result.source).toBe('none');
    expect(result.entities).toEqual([]);
    expect(result.authorSummary).toEqual({});
  });
});
