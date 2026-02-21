import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage, UniversalKnowledgeRecord } from '../../storage/types.js';

vi.mock('../provider_check.js', () => ({
  checkProviderSnapshot: vi.fn().mockResolvedValue({
    status: {
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
      embedding: { available: true, provider: 'xenova', model: 'all-MiniLM-L6-v2', latencyMs: 0 },
    },
    remediationSteps: [],
    reason: 'mocked',
  }),
  ProviderUnavailableError: class ProviderUnavailableError extends Error {
    constructor(public details: { message: string; missing: string[]; suggestion: string }) {
      super(details.message);
      this.name = 'ProviderUnavailableError';
    }
  },
}));

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-architecture-narrator-${randomUUID()}.db`);
}

function createUniversalKnowledgeRecords(): UniversalKnowledgeRecord[] {
  const generatedAt = new Date('2026-02-21T00:00:00.000Z').toISOString();
  return [
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
          imports: [
            { id: 'module-api-synthesis', name: 'query_synthesis' },
            { id: 'module-storage-sqlite', name: 'sqlite_storage' },
          ],
          calls: [],
        },
        quality: {
          maintainability: { index: 70 },
          complexity: { cognitive: 8 },
        },
      }),
      confidence: 0.91,
      generatedAt,
      hash: 'hash-api-query',
    },
    {
      id: 'uk-api-synthesis',
      kind: 'module',
      name: 'query_synthesis',
      qualifiedName: 'api.query_synthesis',
      file: 'src/api/query_synthesis.ts',
      line: 1,
      knowledge: JSON.stringify({
        id: 'module-api-synthesis',
        name: 'query_synthesis',
        kind: 'module',
        module: 'api/query_synthesis',
        location: { file: 'src/api/query_synthesis.ts' },
        relationships: {
          imports: [],
          calls: [],
        },
        quality: {
          maintainability: { index: 72 },
          complexity: { cognitive: 6 },
        },
      }),
      confidence: 0.87,
      generatedAt,
      hash: 'hash-api-synthesis',
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
          imports: [],
          calls: [],
        },
        quality: {
          maintainability: { index: 66 },
          complexity: { cognitive: 12 },
        },
      }),
      confidence: 0.84,
      generatedAt,
      hash: 'hash-storage-sqlite',
    },
  ];
}

async function seedArchitectureData(storage: LibrarianStorage): Promise<void> {
  await storage.upsertModule({
    id: 'module-api-query',
    path: 'src/api/query.ts',
    purpose: 'Main query pipeline orchestration',
    exports: ['queryLibrarian'],
    dependencies: ['src/api/query_synthesis.ts', 'src/storage/sqlite_storage.ts'],
    confidence: 0.9,
  });

  await storage.upsertModule({
    id: 'module-api-synthesis',
    path: 'src/api/query_synthesis.ts',
    purpose: 'Synthesis prompt + structured answer generation',
    exports: ['synthesizeQueryAnswer'],
    dependencies: [],
    confidence: 0.86,
  });

  await storage.upsertModule({
    id: 'module-storage-sqlite',
    path: 'src/storage/sqlite_storage.ts',
    purpose: 'SQLite-backed storage implementation',
    exports: ['createSqliteStorage'],
    dependencies: [],
    confidence: 0.84,
  });

  await storage.upsertUniversalKnowledgeBatch(createUniversalKnowledgeRecords());
}

describe('architecture narrator query integration', () => {
  let storage: LibrarianStorage | null = null;

  afterEach(async () => {
    await storage?.close?.();
    storage = null;
  });

  it('returns architecture narrative with Mermaid for "how does this project work" queries', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), process.cwd());
    await storage.initialize();
    await seedArchitectureData(storage);

    const result = await queryLibrarian(
      {
        intent: 'how does this project work?',
        depth: 'L2',
        llmRequirement: 'disabled',
        embeddingRequirement: 'disabled',
      },
      storage,
    );

    expect(result.synthesisMode).toBe('heuristic');
    expect(result.synthesis?.answer).toContain('Architecture Narrative (project)');
    expect(result.synthesis?.answer).toContain('Load-Bearing Modules (PageRank + Betweenness)');
    expect(result.synthesis?.answer).toContain('Architecture Health');
    expect(result.synthesis?.answer).toContain('```mermaid');
    expect(result.packs.some((pack) => pack.packId === 'architecture:overview')).toBe(true);
  });
});
