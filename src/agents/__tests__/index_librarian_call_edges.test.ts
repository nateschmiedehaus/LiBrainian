import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexLibrarian } from '../index_librarian.js';
import type { ResolvedCallEdge } from '../ast_indexer.js';
import type { TransactionContext, LibrarianStorage } from '../../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge, GraphEdge } from '../../types.js';
import type { StrategicContractRecord } from '../../storage/types.js';

const mockIndexFile = vi.fn();

vi.mock('../ast_indexer.js', () => ({
  AstIndexer: vi.fn().mockImplementation(() => ({
    indexFile: mockIndexFile,
    setGovernorContext: vi.fn(),
  })),
}));

function buildFunction(id: string, filePath: string, name: string, startLine: number): FunctionKnowledge {
  return {
    id,
    filePath,
    name,
    signature: `${name}()`,
    purpose: `Test function ${name}`,
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
    exports: [],
    dependencies: [],
    confidence: 0.8,
  };
}

function buildTx(): TransactionContext {
  return {
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
}

function buildStorage(
  tx: TransactionContext,
  overrides: Partial<LibrarianStorage> = {}
): LibrarianStorage {
  const base: LibrarianStorage = {
    initialize: vi.fn(async () => undefined),
    isInitialized: vi.fn(() => true),
    transaction: vi.fn(async (run: (ctx: TransactionContext) => Promise<unknown>) => run(tx)),
    recordIndexingResult: vi.fn(async () => undefined),
    getFileChecksum: vi.fn(async () => null),
    getFunctionByPath: vi.fn(async () => null),
    getModuleByPath: vi.fn(async () => null),
    getContextPack: vi.fn(async () => null),
    getEmbedding: vi.fn(async () => null),
    getMultiVector: vi.fn(async () => null),
    getModules: vi.fn(async () => []),
    getGraphEdges: vi.fn(async () => []),
    getFunctions: vi.fn(async () => []),
  } as unknown as LibrarianStorage;

  return { ...base, ...overrides } as LibrarianStorage;
}

async function createTempTsFile(content: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'index-librarian-call-edges-'));
  const filePath = path.join(tempDir, 'sample.ts');
  await fs.writeFile(filePath, content, 'utf8');
  return {
    filePath,
    cleanup: async () => fs.rm(tempDir, { recursive: true, force: true }),
  };
}

describe('IndexLibrarian call-edge persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists calls edges extracted from AST indexing', async () => {
    const { filePath, cleanup } = await createTempTsFile(
      'export function caller(){ return callee(); }\nexport function callee(){ return 1; }\n'
    );

    const caller = buildFunction('fn_caller', filePath, 'caller', 1);
    const callee = buildFunction('fn_callee', filePath, 'callee', 2);
    const module = buildModule('mod_sample', filePath);
    const callEdges: ResolvedCallEdge[] = [
      {
        fromId: caller.id,
        toId: callee.id,
        sourceLine: 1,
        targetResolved: true,
        isAmbiguous: false,
        overloadCount: 0,
      },
    ];

    mockIndexFile.mockResolvedValue({
      functions: [caller, callee],
      module,
      callEdges,
      partiallyIndexed: false,
      parser: 'ts-morph',
    });

    const tx = buildTx();
    const storage = buildStorage(tx);
    const librarian = new IndexLibrarian({
      generateEmbeddings: false,
      createContextPacks: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
    });
    await librarian.initialize(storage);

    const result = await librarian.indexFile(filePath);
    await cleanup();

    expect(result.errors).toEqual([]);
    expect(tx.upsertGraphEdges).toHaveBeenCalledTimes(1);

    const persistedEdges = vi.mocked(tx.upsertGraphEdges).mock.calls[0]?.[0] as GraphEdge[];
    expect(persistedEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeType: 'calls',
          fromType: 'function',
          toType: 'function',
          fromId: caller.id,
          toId: callee.id,
          sourceFile: filePath,
        }),
      ])
    );
  });

  it('resolves external calls edges into function IDs after indexing', async () => {
    const externalCallEdge: GraphEdge = {
      fromId: 'fn_caller',
      fromType: 'function',
      toId: 'external:callee',
      toType: 'function',
      edgeType: 'calls',
      sourceFile: '/tmp/sample.ts',
      sourceLine: 12,
      confidence: 0.4,
      computedAt: new Date(),
    };
    const resolvedTarget = buildFunction('fn_callee_real', '/tmp/other.ts', 'callee', 4);

    const tx = buildTx();
    const storage = buildStorage(tx, {
      getGraphEdges: vi.fn(async () => [externalCallEdge]),
      getFunctions: vi.fn(async () => [resolvedTarget]),
      upsertGraphEdges: vi.fn(async () => undefined),
    });

    const librarian = new IndexLibrarian({
      generateEmbeddings: false,
      createContextPacks: false,
    });
    await librarian.initialize(storage);

    const result = await librarian.resolveExternalCallEdges();

    expect(result).toEqual({ resolved: 1, total: 1 });
    expect(storage.upsertGraphEdges).toHaveBeenCalledTimes(1);
    expect(storage.upsertGraphEdges).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          fromId: 'fn_caller',
          toId: 'fn_callee_real',
          edgeType: 'calls',
          toType: 'function',
        }),
      ])
    );
  });

  it('skips per-task external edge resolution when disabled in config', async () => {
    const tx = buildTx();
    const storage = buildStorage(tx);

    const librarian = new IndexLibrarian({
      generateEmbeddings: false,
      createContextPacks: false,
      computeGraphMetrics: false,
      resolveExternalCallEdges: false,
    });
    await librarian.initialize(storage);

    vi.spyOn(librarian, 'indexFile').mockResolvedValue({
      filePath: '/tmp/single.ts',
      functionsFound: 0,
      functionsIndexed: 0,
      moduleIndexed: false,
      contextPacksCreated: 0,
      durationMs: 1,
      errors: [],
    });
    const resolveSpy = vi.spyOn(librarian, 'resolveExternalCallEdges');

    const result = await librarian.processTask({
      type: 'targeted',
      paths: ['/tmp/single.ts'],
      priority: 'high',
      reason: 'test',
      triggeredBy: 'manual',
    });

    expect(result.errors).toEqual([]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('materializes strategic contracts from indexed module dependencies during processTask', async () => {
    const tx = buildTx();
    const providerPath = path.resolve('/tmp/strategic-provider.ts');
    const consumerPath = path.resolve('/tmp/strategic-consumer.ts');
    const providerModule: ModuleKnowledge = {
      ...buildModule('mod_provider', providerPath),
      exports: ['runProvider'],
    };
    const consumerModule: ModuleKnowledge = {
      ...buildModule('mod_consumer', consumerPath),
      dependencies: ['./strategic-provider'],
    };
    const upsertStrategicContracts = vi.fn(async () => undefined);
    const storage = buildStorage(tx, {
      getModules: vi.fn(async () => [providerModule, consumerModule]),
      upsertStrategicContracts,
    } as Partial<LibrarianStorage>);

    const librarian = new IndexLibrarian({
      generateEmbeddings: false,
      createContextPacks: false,
      computeGraphMetrics: false,
    });
    await librarian.initialize(storage);

    vi.spyOn(librarian, 'indexFile').mockResolvedValue({
      filePath: providerPath,
      functionsFound: 0,
      functionsIndexed: 0,
      moduleIndexed: false,
      contextPacksCreated: 0,
      durationMs: 1,
      errors: [],
    });

    const result = await librarian.processTask({
      type: 'targeted',
      paths: [providerPath],
      priority: 'high',
      reason: 'strategic-contract-pass',
      triggeredBy: 'manual',
    });

    expect(result.errors).toEqual([]);
    expect(upsertStrategicContracts).toHaveBeenCalledTimes(1);
    const records = upsertStrategicContracts.mock.calls[0]?.[0] as StrategicContractRecord[];
    const providerContract = records.find((record) => record.producers.includes('mod_provider'));
    expect(providerContract).toBeTruthy();
    expect(providerContract?.consumers).toContain('mod_consumer');
  });

  it('adds semantic entanglement edges from co-call patterns', async () => {
    const { filePath, cleanup } = await createTempTsFile(
      'export function caller(){ alpha(); beta(); }\nexport function alpha(){}\nexport function beta(){}\n'
    );

    const caller = buildFunction('fn_caller', filePath, 'caller', 1);
    const alpha = buildFunction('fn_alpha', filePath, 'alpha', 2);
    const beta = buildFunction('fn_beta', filePath, 'beta', 3);
    const module = buildModule('mod_sample', filePath);
    const callEdges: ResolvedCallEdge[] = [
      { fromId: caller.id, toId: alpha.id, sourceLine: 1, targetResolved: true, isAmbiguous: false, overloadCount: 0 },
      { fromId: caller.id, toId: beta.id, sourceLine: 1, targetResolved: true, isAmbiguous: false, overloadCount: 0 },
    ];

    mockIndexFile.mockResolvedValue({
      functions: [caller, alpha, beta],
      module,
      callEdges,
      partiallyIndexed: false,
      parser: 'ts-morph',
    });

    const tx = buildTx();
    const storage = buildStorage(tx);
    const librarian = new IndexLibrarian({
      generateEmbeddings: false,
      createContextPacks: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
    });
    await librarian.initialize(storage);

    const result = await librarian.indexFile(filePath);
    await cleanup();

    expect(result.errors).toEqual([]);
    const persistedEdges = vi.mocked(tx.upsertGraphEdges).mock.calls[0]?.[0] as GraphEdge[];
    expect(persistedEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ edgeType: 'entangled', fromId: alpha.id, toId: beta.id }),
        expect.objectContaining({ edgeType: 'entangled', fromId: beta.id, toId: alpha.id }),
      ])
    );
  });
});
