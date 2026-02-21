import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { EmbeddingService } from '../embeddings.js';

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

const workspaceRoot = process.cwd();

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librainian-exhaustive-${randomUUID()}.db`);
}

describe('queryLiBrainian exhaustive routing', () => {
  let storage: LiBrainianStorage;

  afterEach(async () => {
    await storage?.close?.();
  });

  it('skips semantic retrieval for exhaustive structural queries', async () => {
    const { queryLiBrainian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();

    const targetPath = path.join(workspaceRoot, 'src/target.ts');
    const dependentPath = path.join(workspaceRoot, 'src/dependent.ts');

    await storage.upsertModule({
      id: 'module-target',
      path: targetPath,
      purpose: 'Target module',
      exports: [],
      dependencies: [],
      confidence: 0.6,
    });

    await storage.upsertGraphEdges([
      {
        fromId: dependentPath,
        fromType: 'module',
        toId: targetPath,
        toType: 'module',
        edgeType: 'imports',
        sourceFile: dependentPath,
        sourceLine: 1,
        confidence: 0.9,
        computedAt: new Date('2026-01-19T00:00:00.000Z'),
      },
    ]);

    const embeddingService = {
      generateEmbedding: vi.fn().mockRejectedValue(new Error('embedding should not be called')),
    } as unknown as EmbeddingService;

    const result = await queryLiBrainian(
      { intent: 'all files that depend on src/target.ts', depth: 'L1', llmRequirement: 'disabled' },
      storage,
      embeddingService
    );

    expect(embeddingService.generateEmbedding).not.toHaveBeenCalled();
    expect(result.explanation ?? '').toMatch(/Exhaustive dependency query selected/);
  });
});
