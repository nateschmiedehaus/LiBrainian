import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { EmbeddingService } from '../embeddings.js';

const { checkProviderSnapshotMock } = vi.hoisted(() => ({
  checkProviderSnapshotMock: vi.fn().mockResolvedValue({
    status: {
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
      embedding: { available: true, provider: 'xenova', model: 'all-MiniLM-L6-v2', latencyMs: 0 },
    },
    remediationSteps: [],
    reason: 'mocked',
  }),
}));

vi.mock('../provider_check.js', () => ({
  checkProviderSnapshot: checkProviderSnapshotMock,
  ProviderUnavailableError: class ProviderUnavailableError extends Error {
    constructor(public details: { message: string; missing: string[]; suggestion: string }) {
      super(details.message);
      this.name = 'ProviderUnavailableError';
    }
  },
}));

const workspaceRoot = process.cwd();

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-exhaustive-${randomUUID()}.db`);
}

describe('queryLibrarian exhaustive routing', () => {
  let storage: LibrarianStorage;

  afterEach(async () => {
    await storage?.close?.();
    checkProviderSnapshotMock.mockClear();
  });

  it('skips semantic retrieval for exhaustive structural queries', async () => {
    const { queryLibrarian } = await import('../query.js');
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

    const result = await queryLibrarian(
      { intent: 'all files that depend on src/target.ts', depth: 'L1', llmRequirement: 'disabled' },
      storage,
      embeddingService
    );

    expect(embeddingService.generateEmbedding).not.toHaveBeenCalled();
    expect(result.explanation ?? '').toMatch(/Exhaustive dependency query selected|Path query detected/);
  });

  it('skips provider snapshots when llm and embeddings are disabled', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();
    await storage.upsertModule({
      id: 'module-basic',
      path: path.join(workspaceRoot, 'src/basic.ts'),
      purpose: 'Basic module',
      exports: [],
      dependencies: [],
      confidence: 0.6,
    });

    const response = await queryLibrarian(
      {
        intent: 'where is query synthesis executed?',
        depth: 'L0',
        llmRequirement: 'disabled',
        embeddingRequirement: 'disabled',
        disableCache: true,
      },
      storage
    );

    expect(response.llmRequirement).toBe('disabled');
    expect(checkProviderSnapshotMock).not.toHaveBeenCalled();
  });

  it('short-circuits caller probes with indexed call edges', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();

    const targetPath = path.join(workspaceRoot, 'src/api/query.ts');
    const bootstrapPath = path.join(workspaceRoot, 'src/api/bootstrap.ts');
    const serverPath = path.join(workspaceRoot, 'src/mcp/server.ts');

    await storage.upsertFunction({
      id: 'fn-queryLibrarian',
      filePath: targetPath,
      name: 'queryLibrarian',
      signature: 'queryLibrarian(query, storage): Promise<LibrarianResponse>',
      purpose: 'Main query pipeline entry point.',
      startLine: 1,
      endLine: 40,
      confidence: 0.8,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    });
    await storage.upsertFunction({
      id: 'fn-bootstrapCaller',
      filePath: bootstrapPath,
      name: 'bootstrapProject',
      signature: 'bootstrapProject(): Promise<void>',
      purpose: 'Bootstrap path that calls queryLibrarian.',
      startLine: 50,
      endLine: 90,
      confidence: 0.7,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    });
    await storage.upsertFunction({
      id: 'fn-serverCaller',
      filePath: serverPath,
      name: 'runQueryTool',
      signature: 'runQueryTool(): Promise<void>',
      purpose: 'MCP server tool wrapper that calls queryLibrarian.',
      startLine: 70,
      endLine: 120,
      confidence: 0.7,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    });

    await storage.upsertGraphEdges([
      {
        fromId: 'fn-bootstrapCaller',
        fromType: 'function',
        toId: 'fn-queryLibrarian',
        toType: 'function',
        edgeType: 'calls',
        sourceFile: bootstrapPath,
        sourceLine: 52,
        confidence: 0.94,
        computedAt: new Date('2026-01-19T00:00:00.000Z'),
      },
      {
        fromId: 'fn-serverCaller',
        fromType: 'function',
        toId: 'fn-queryLibrarian',
        toType: 'function',
        edgeType: 'calls',
        sourceFile: serverPath,
        sourceLine: 73,
        confidence: 0.91,
        computedAt: new Date('2026-01-19T00:00:00.000Z'),
      },
    ]);

    const embeddingService = {
      generateEmbedding: vi.fn().mockRejectedValue(new Error('embedding should not be called')),
    } as unknown as EmbeddingService;

    const result = await queryLibrarian(
      {
        intent: 'What calls queryLibrarian?',
        depth: 'L1',
        llmRequirement: 'disabled',
        embeddingRequirement: 'disabled',
        disableCache: true,
      },
      storage,
      embeddingService,
    );

    expect(embeddingService.generateEmbedding).not.toHaveBeenCalled();
    expect(result.packs[0]?.summary).toContain('queryLibrarian');
    expect(result.packs[0]?.summary).toContain('src/api/bootstrap.ts:52');
    expect(result.packs[0]?.summary).toContain('src/mcp/server.ts:73');
    expect(result.explanation ?? '').toContain('Caller probe detected');
  });
});
