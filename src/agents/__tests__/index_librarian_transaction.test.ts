/**
 * Transaction boundary tests for IndexLibrarian indexing.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexLibrarian } from '../index_librarian.js';
import { globalEventBus } from '../../events.js';
import { checkAllProviders } from '../../api/provider_check.js';

// Skip in unit test mode (no real providers)
const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && !process.env.LIBRARIAN_TIER0);
const describeWithProviders = IS_UNIT_MODE ? describe.skip : describe;
import type { FunctionKnowledge, ModuleKnowledge } from '../../types.js';
import type { LibrarianStorage, TransactionContext } from '../../storage/types.js';
import type { ResolvedCallEdge } from '../ast_indexer.js';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';

let astResult: {
  functions: FunctionKnowledge[];
  module: ModuleKnowledge | null;
  callEdges: ResolvedCallEdge[];
  partiallyIndexed: boolean;
  parser: string;
};

vi.mock('../ast_indexer.js', () => ({
  AstIndexer: vi.fn().mockImplementation(() => ({
    indexFile: vi.fn(async () => astResult),
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

async function createTempFile(contents: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'index-librarian-'));
  const filePath = path.join(dir, 'sample.ts');
  await fs.writeFile(filePath, contents, 'utf8');
  return {
    filePath,
    cleanup: async () => fs.rm(dir, { recursive: true, force: true }),
  };
}

function createMockStorage(options: { failOnUpsert?: boolean } = {}): {
  storage: LibrarianStorage;
  tx: TransactionContext;
} {
  const { failOnUpsert = false } = options;
  const tx: TransactionContext = {
    upsertFunction: vi.fn(async () => {
      if (failOnUpsert) {
        throw new Error('transaction_failed');
      }
    }),
    upsertModule: vi.fn(async () => undefined),
    upsertContextPack: vi.fn(async () => undefined),
    upsertIngestionItem: vi.fn(async () => undefined),
    upsertTestMapping: vi.fn(async () => ({} as any)),
    upsertCommit: vi.fn(async () => ({} as any)),
    upsertOwnership: vi.fn(async () => ({} as any)),
    setEmbedding: vi.fn(async () => undefined),
    upsertMultiVector: vi.fn(async () => undefined),
    deleteFunction: vi.fn(async () => undefined),
    deleteFunctionsByPath: vi.fn(async () => undefined),
    deleteModule: vi.fn(async () => undefined),
    deleteFileByPath: vi.fn(async () => undefined),
    deleteUniversalKnowledgeByFile: vi.fn(async () => 0),
    deleteContextPack: vi.fn(async () => undefined),
    invalidateContextPacks: vi.fn(async () => 0),
    upsertGraphEdges: vi.fn(async () => undefined),
    deleteGraphEdgesForSource: vi.fn(async () => undefined),
    setFileChecksum: vi.fn(async () => undefined),
  };

  const storage = {
    initialize: vi.fn(async () => undefined),
    isInitialized: vi.fn(() => true),
    getFunctionByPath: vi.fn(async () => null),
    getModuleByPath: vi.fn(async () => null),
    getContextPack: vi.fn(async () => null),
    getFileChecksum: vi.fn(async () => null),
    getMultiVector: vi.fn(async () => null),
    getEmbedding: vi.fn(async () => null),
    getModules: vi.fn(async () => []),
    transaction: vi.fn(async (fn: (ctx: TransactionContext) => Promise<unknown>) => fn(tx)),
  } as unknown as LibrarianStorage;

  return { storage, tx };
}

function normalizePath(value: string): string {
  return path.normalize(path.resolve(value));
}

describeWithProviders('IndexLibrarian transaction boundaries', () => {
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

  it('skips events and cache updates when the transaction fails', async () => {
    const { filePath, cleanup } = await createTempFile('export function alpha() {}\n');
    const fnA = buildFunction('fn_alpha', filePath, 'alpha', 1);
    const fnB = buildFunction('fn_beta', filePath, 'beta', 5);
    const module = buildModule('mod_alpha', filePath);
    astResult = {
      functions: [fnA, fnB],
      module,
      callEdges: [
        {
          fromId: fnA.id,
          toId: fnB.id,
          sourceLine: 2,
          targetResolved: true,
          isAmbiguous: false,
          overloadCount: 0,
        },
      ],
      partiallyIndexed: false,
      parser: 'ts-morph',
    };

    const { storage } = createMockStorage({ failOnUpsert: true });
    const librarian = new IndexLibrarian({
      createContextPacks: true,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
    });
    await librarian.initialize(storage);

    const events: string[] = [];
    const off = globalEventBus.on('*', (event) => {
      if (event.type === 'entity_created' || event.type === 'entity_updated' || event.type === 'index_function') {
        events.push(event.type);
      }
    });

    const result = await librarian.indexFile(filePath);
    off();
    await cleanup();

    expect(result.errors.some((message) => message.includes('Failed to persist index data'))).toBe(true);
    expect(events).toHaveLength(0);

    const cache = (librarian as unknown as { moduleIdCache: Map<string, string> | null }).moduleIdCache;
    expect(cache?.has(normalizePath(filePath))).toBe(false);
  });

  it('emits events and updates cache after a successful transaction', async () => {
    const { filePath, cleanup } = await createTempFile('export function alpha() {}\n');
    const fnA = buildFunction('fn_alpha', filePath, 'alpha', 1);
    const module = buildModule('mod_alpha', filePath);
    astResult = {
      functions: [fnA],
      module,
      callEdges: [],
      partiallyIndexed: false,
      parser: 'ts-morph',
    };

    const { storage } = createMockStorage();
    const librarian = new IndexLibrarian({
      createContextPacks: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
    });
    await librarian.initialize(storage);

    const events: string[] = [];
    const off = globalEventBus.on('*', (event) => {
      if (event.type === 'entity_created' || event.type === 'entity_updated' || event.type === 'index_function') {
        events.push(event.type);
      }
    });

    const result = await librarian.indexFile(filePath);
    off();
    await cleanup();

    expect(result.errors).toHaveLength(0);
    expect(events.length).toBeGreaterThan(0);

    const cache = (librarian as unknown as { moduleIdCache: Map<string, string> | null }).moduleIdCache;
    expect(cache?.get(normalizePath(filePath))).toBe(module.id);
  });
});
