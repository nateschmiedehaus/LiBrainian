import { describe, expect, it, vi } from 'vitest';
import type { LibrarianStorage } from '../../storage/types.js';
import type { ContextPack, LibrarianQuery } from '../../types.js';
import { buildArchitectureNarrative } from '../architecture_narrator.js';

function createArchitectureStorageMock(): LibrarianStorage {
  return {
    getModules: vi.fn(async () => [
      {
        id: 'module-api-query',
        path: 'src/api/query.ts',
        purpose: 'Main query pipeline',
        exports: ['queryLibrarian'],
        dependencies: ['src/storage/sqlite_storage.ts', 'src/api/query_synthesis.ts'],
        confidence: 0.9,
      },
      {
        id: 'module-storage-sqlite',
        path: 'src/storage/sqlite_storage.ts',
        purpose: 'SQLite storage backend',
        exports: ['createSqliteStorage'],
        dependencies: [],
        confidence: 0.87,
      },
      {
        id: 'module-api-synthesis',
        path: 'src/api/query_synthesis.ts',
        purpose: 'Synthesis prompt and answer generation',
        exports: ['synthesizeQueryAnswer'],
        dependencies: [],
        confidence: 0.84,
      },
    ]),
    queryUniversalKnowledge: vi.fn(async () => [
      {
        id: 'uk-api-query',
        kind: 'module',
        name: 'query',
        qualifiedName: 'api.query',
        file: 'src/api/query.ts',
        line: 1,
        knowledge: JSON.stringify({
          id: 'module-api-query',
          name: 'query',
          kind: 'module',
          module: 'api/query',
          location: { file: 'src/api/query.ts' },
          relationships: {
            layer: 'api',
            imports: [
              { id: 'module-storage-sqlite', name: 'sqlite_storage' },
              { id: 'module-api-synthesis', name: 'query_synthesis' },
            ],
            calls: [],
          },
          quality: {
            maintainability: { index: 68 },
            complexity: { cognitive: 7 },
          },
        }),
        confidence: 0.9,
        generatedAt: new Date().toISOString(),
        hash: 'h1',
      },
      {
        id: 'uk-storage-sqlite',
        kind: 'module',
        name: 'sqlite_storage',
        qualifiedName: 'storage.sqlite_storage',
        file: 'src/storage/sqlite_storage.ts',
        line: 1,
        knowledge: JSON.stringify({
          id: 'module-storage-sqlite',
          name: 'sqlite_storage',
          kind: 'module',
          module: 'storage/sqlite_storage',
          location: { file: 'src/storage/sqlite_storage.ts' },
          relationships: {
            layer: 'storage',
            imports: [],
            calls: [],
          },
          quality: {
            maintainability: { index: 60 },
            complexity: { cognitive: 11 },
          },
        }),
        confidence: 0.85,
        generatedAt: new Date().toISOString(),
        hash: 'h2',
      },
    ]),
  } as unknown as LibrarianStorage;
}

function createPacks(): ContextPack[] {
  const now = new Date();
  return [
    {
      packId: 'pack-api-query',
      packType: 'module_context',
      targetId: 'module-api-query',
      summary: 'Query pipeline orchestrates retrieval and synthesis.',
      keyFacts: ['Routes architecture queries into structure-aware retrieval.'],
      codeSnippets: [],
      relatedFiles: ['src/api/query.ts'],
      confidence: 0.91,
      createdAt: now,
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        string: '1.0.0',
        qualityTier: 'full',
        indexedAt: now,
        indexerVersion: '1.0.0',
        features: [],
      },
      invalidationTriggers: ['src/api/query.ts'],
    },
  ];
}

describe('architecture narrator', () => {
  it('builds a multi-section architecture narrative with Mermaid and health metrics', async () => {
    const storage = createArchitectureStorageMock();
    const query: LibrarianQuery = {
      intent: 'Explain the architecture of this project',
      depth: 'L2',
      llmRequirement: 'disabled',
      embeddingRequirement: 'disabled',
    };

    const result = await buildArchitectureNarrative({
      query,
      storage,
      workspaceRoot: '/tmp/workspace',
      packs: createPacks(),
    });

    expect(result.zoomLevel).toBe('project');
    expect(result.synthesis.answer).toContain('Architecture Health');
    expect(result.synthesis.answer).toContain('Load-Bearing Modules');
    expect(result.synthesis.answer).toContain('Interesting Findings');
    expect(result.synthesis.answer).toContain('```mermaid');
    expect(result.synthesis.answer).toContain('PageRank');
    expect(result.interestingFindings.length).toBeGreaterThan(0);
  });

  it('adapts zoom level to module-scoped architecture questions', async () => {
    const storage = createArchitectureStorageMock();
    const query: LibrarianQuery = {
      intent: 'How does the query pipeline work?',
      depth: 'L2',
      affectedFiles: ['src/api/query.ts'],
      llmRequirement: 'disabled',
      embeddingRequirement: 'disabled',
    };

    const result = await buildArchitectureNarrative({
      query,
      storage,
      workspaceRoot: '/tmp/workspace',
      packs: createPacks(),
    });

    expect(result.zoomLevel).toBe('module');
    expect(result.diagramType).toBe('call_hierarchy');
  });

  it('keeps project zoom for "how does this project work" intents', async () => {
    const storage = createArchitectureStorageMock();
    const query: LibrarianQuery = {
      intent: 'how does this project work?',
      depth: 'L2',
      llmRequirement: 'disabled',
      embeddingRequirement: 'disabled',
    };

    const result = await buildArchitectureNarrative({
      query,
      storage,
      workspaceRoot: '/tmp/workspace',
      packs: createPacks(),
    });

    expect(result.zoomLevel).toBe('project');
    expect(result.diagramType).toBe('architecture');
  });
});
