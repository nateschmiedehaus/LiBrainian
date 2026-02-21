/**
 * Transaction boundary tests for IndexLibrarian removeFile.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexLibrarian } from '../index_librarian.js';
import { globalEventBus } from '../../events.js';
import { checkAllProviders } from '../../api/provider_check.js';

// Skip in unit test mode (no real providers)
const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && !process.env.LIBRARIAN_TIER0);
const describeWithProviders = IS_UNIT_MODE ? describe.skip : describe;
import type { FileKnowledge, FunctionKnowledge, ModuleKnowledge } from '../../types.js';
import type { LibrarianStorage, TransactionContext, UniversalKnowledgeRecord } from '../../storage/types.js';
import os from 'os';
import path from 'path';

vi.mock('../ast_indexer.js', () => ({
  AstIndexer: vi.fn().mockImplementation(() => ({
    indexFile: vi.fn(),
    setGovernorContext: vi.fn(),
  })),
}));

function buildFunction(id: string, filePath: string, name: string, startLine: number): FunctionKnowledge {
  return {
    id,
    filePath,
    name,
    signature: `${name}()`,
    purpose: `Test ${name}`,
    startLine,
    endLine: startLine + 1,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

function buildModule(id: string, filePath: string): ModuleKnowledge {
  return {
    id,
    path: filePath,
    purpose: 'Test module',
    exports: ['alpha'],
    dependencies: [],
    confidence: 0.7,
  };
}

function buildFile(filePath: string): FileKnowledge {
  const now = new Date().toISOString();
  return {
    id: 'file-test',
    path: filePath,
    relativePath: path.basename(filePath),
    name: path.basename(filePath),
    extension: path.extname(filePath),
    category: 'code',
    purpose: 'Test file',
    role: 'utility',
    summary: 'Test summary',
    keyExports: ['alpha'],
    mainConcepts: ['tests'],
    lineCount: 12,
    functionCount: 1,
    classCount: 0,
    importCount: 0,
    exportCount: 1,
    imports: [],
    importedBy: [],
    directory: path.dirname(filePath),
    complexity: 'low',
    hasTests: false,
    checksum: 'file-checksum',
    confidence: 0.5,
    lastIndexed: now,
    lastModified: now,
  };
}

function buildKnowledge(filePath: string): UniversalKnowledgeRecord {
  return {
    id: 'knowledge-1',
    kind: 'function',
    name: 'alpha',
    qualifiedName: 'alpha',
    file: filePath,
    line: 1,
    knowledge: '{}',
    confidence: 0.5,
    generatedAt: new Date().toISOString(),
    hash: 'knowledge-hash',
  };
}

function createMockStorage(options: { failOnDelete?: boolean; invalidated?: number } = {}): {
  storage: LibrarianStorage;
  tx: TransactionContext;
} {
  const { failOnDelete = false, invalidated = 0 } = options;
  const tx: TransactionContext = {
    upsertFunction: vi.fn(async () => undefined),
    upsertModule: vi.fn(async () => undefined),
    upsertContextPack: vi.fn(async () => undefined),
    upsertIngestionItem: vi.fn(async () => undefined),
    upsertTestMapping: vi.fn(async () => ({} as any)),
    upsertCommit: vi.fn(async () => ({} as any)),
    upsertOwnership: vi.fn(async () => ({} as any)),
    setEmbedding: vi.fn(async () => undefined),
    upsertMultiVector: vi.fn(async () => undefined),
    deleteFunction: vi.fn(async () => undefined),
    deleteFunctionsByPath: vi.fn(async () => {
      if (failOnDelete) {
        throw new Error('transaction_failed');
      }
    }),
    deleteModule: vi.fn(async () => undefined),
    deleteFileByPath: vi.fn(async () => undefined),
    deleteUniversalKnowledgeByFile: vi.fn(async () => 0),
    deleteContextPack: vi.fn(async () => undefined),
    invalidateContextPacks: vi.fn(async () => invalidated),
    upsertGraphEdges: vi.fn(async () => undefined),
    deleteGraphEdgesForSource: vi.fn(async () => undefined),
    setFileChecksum: vi.fn(async () => undefined),
  };

  const storage = {
    initialize: vi.fn(async () => undefined),
    isInitialized: vi.fn(() => true),
    getFileByPath: vi.fn(async () => null),
    getFunctionsByPath: vi.fn(async () => []),
    getModuleByPath: vi.fn(async () => null),
    getUniversalKnowledgeByFile: vi.fn(async () => []),
    transaction: vi.fn(async (fn: (ctx: TransactionContext) => Promise<unknown>) => fn(tx)),
  } as unknown as LibrarianStorage;

  return { storage, tx };
}

async function flushEvents(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describeWithProviders('IndexLibrarian removeFile transaction boundaries', () => {
  beforeAll(async () => {
    const status = await checkAllProviders({ workspaceRoot: process.cwd(), forceProbe: false });
    if (!status.embedding.available) {
      throw new Error(
        `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`
      );
    }
  });

  beforeEach(() => {
    globalEventBus.clear();
  });

  afterEach(() => {
    globalEventBus.clear();
  });

  it('skips deletion events when the transaction fails', async () => {
    const filePath = path.join(os.tmpdir(), 'remove-file.ts');
    const fileRecord = buildFile(filePath);
    const functions = [buildFunction('fn_alpha', filePath, 'alpha', 1)];
    const module = buildModule('mod_alpha', filePath);
    const knowledgeRecords = [buildKnowledge(filePath)];

    const { storage } = createMockStorage({ failOnDelete: true });
    storage.getFileByPath = vi.fn(async () => fileRecord);
    storage.getFunctionsByPath = vi.fn(async () => functions);
    storage.getModuleByPath = vi.fn(async () => module);
    storage.getUniversalKnowledgeByFile = vi.fn(async () => knowledgeRecords);

    const librarian = new IndexLibrarian({
      createContextPacks: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
    });
    await librarian.initialize(storage);

    const events: string[] = [];
    const off = globalEventBus.on('*', (event) => {
      if (
        event.type === 'entity_deleted' ||
        event.type === 'understanding_invalidated' ||
        event.type === 'context_packs_invalidated' ||
        event.type === 'file_deleted'
      ) {
        events.push(event.type);
      }
    });

    await expect(librarian.removeFile(filePath)).rejects.toThrow('transaction_failed');
    await flushEvents();
    off();

    expect(events).toHaveLength(0);
  });

  it('emits deletion events after a successful transaction', async () => {
    const filePath = path.join(os.tmpdir(), 'remove-file.ts');
    const fileRecord = buildFile(filePath);
    const functions = [buildFunction('fn_alpha', filePath, 'alpha', 1)];
    const module = buildModule('mod_alpha', filePath);
    const knowledgeRecords = [buildKnowledge(filePath)];

    const { storage } = createMockStorage({ invalidated: 2 });
    storage.getFileByPath = vi.fn(async () => fileRecord);
    storage.getFunctionsByPath = vi.fn(async () => functions);
    storage.getModuleByPath = vi.fn(async () => module);
    storage.getUniversalKnowledgeByFile = vi.fn(async () => knowledgeRecords);

    const librarian = new IndexLibrarian({
      createContextPacks: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
    });
    await librarian.initialize(storage);

    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const off = globalEventBus.on('*', (event) => {
      if (
        event.type === 'entity_deleted' ||
        event.type === 'understanding_invalidated' ||
        event.type === 'context_packs_invalidated' ||
        event.type === 'file_deleted'
      ) {
        events.push({ type: event.type, data: event.data as Record<string, unknown> });
      }
    });

    await librarian.removeFile(filePath);
    await flushEvents();
    off();

    const entityDeletes = events.filter((event) => event.type === 'entity_deleted').map((event) => event.data);
    expect(entityDeletes).toEqual(
      expect.arrayContaining([
        { entityType: 'file', entityId: fileRecord.id, filePath },
        { entityType: 'function', entityId: functions[0]!.id, filePath: functions[0]!.filePath },
        { entityType: 'module', entityId: module.id, filePath: module.path },
      ])
    );

    const invalidations = events.filter((event) => event.type === 'understanding_invalidated');
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]?.data).toEqual({
      entityId: knowledgeRecords[0]!.id,
      entityType: knowledgeRecords[0]!.kind,
      reason: 'file_removed',
    });

    const packInvalidations = events.filter((event) => event.type === 'context_packs_invalidated');
    expect(packInvalidations).toHaveLength(1);
    expect(packInvalidations[0]?.data).toEqual({ triggerPath: filePath, count: 2 });

    const fileDeleted = events.filter((event) => event.type === 'file_deleted');
    expect(fileDeleted).toHaveLength(1);
    expect(fileDeleted[0]?.data).toEqual({ filePath });
  });
});
