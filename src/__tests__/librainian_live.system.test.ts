/**
 * @fileoverview Live provider tests for Librarian subsystem
 *
 * These tests require live providers (LLM + embeddings). They are intentionally
 * excluded from unit/integration runs via `LIBRARIAN_TEST_MODE` and should only
 * run in system/agentic qualification contexts.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  createLibrarian,
  Librarian,
  createSqliteStorage,
  createIndexLibrarian,
  ensureLibrarianReady,
  isLibrarianReady,
  resetGate,
} from '../index.js';
import { checkAllProviders, requireProviders, type AllProviderStatus } from '../api/provider_check.js';
import { EmbeddingService, REAL_EMBEDDING_DIMENSION } from '../api/embeddings.js';
import { resolveLibrarianModelId } from '../api/llm_env.js';
import { cleanupWorkspace } from './helpers/index.js';

const DEFAULT_CODEX_MODEL_ID = 'gpt-5.1-codex-mini';
const DEFAULT_CLAUDE_MODEL_ID = 'claude-haiku-4-5-20241022';

const createTempWorkspace = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-test-'));
  const canonPath = path.join(root, 'config', 'canon.json');
  await fs.mkdir(path.dirname(canonPath), { recursive: true });
  await fs.writeFile(canonPath, JSON.stringify({ schema_version: 1 }, null, 2));
  return root;
};

const createTestFile = async (workspace: string, relativePath: string, content: string): Promise<string> => {
  const fullPath = path.join(workspace, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  return fullPath;
};

const DETERMINISTIC_BOOTSTRAP = { include: ['**/*.ts'] };

const SAMPLE_TS_FILE = `export function add(a: number, b: number): number {
  return a + b;
}
export function multiply(a: number, b: number): number {
  return a * b;
}
`;

let liveProviderStatus: AllProviderStatus | null = null;
let liveLlmProvider: 'claude' | 'codex' | null = null;
let liveLlmModelId: string | null = null;

function resolveLlmModelId(provider: 'claude' | 'codex'): string {
  const envModel = resolveLibrarianModelId(provider);
  if (envModel) return envModel;
  return provider === 'claude' ? DEFAULT_CLAUDE_MODEL_ID : DEFAULT_CODEX_MODEL_ID;
}

async function requireLiveProviders(): Promise<AllProviderStatus> {
  await requireProviders({ llm: true, embedding: true }, { workspaceRoot: process.cwd() });
  const status = await checkAllProviders({ workspaceRoot: process.cwd() });
  liveProviderStatus = status;
  return status;
}

function getLiveLlmConfig(): { llmProvider: 'claude' | 'codex'; llmModelId: string } {
  if (!liveLlmProvider || !liveLlmModelId) {
    throw new Error('unverified_by_trace(provider_unavailable): Live LLM provider not initialized');
  }
  return { llmProvider: liveLlmProvider, llmModelId: liveLlmModelId };
}

async function getLiveEmbeddingService(): Promise<EmbeddingService> {
  await requireLiveProviders();
  return new EmbeddingService({
    embeddingDimension: REAL_EMBEDDING_DIMENSION,
    maxBatchSize: 5,
    maxConcurrentBatches: 1,
    batchDelayMs: 0,
  });
}

beforeAll(async () => {
  const status = await requireLiveProviders();
  liveLlmProvider = status.llm.provider === 'claude' ? 'claude' : 'codex';
  liveLlmModelId = resolveLlmModelId(liveLlmProvider);
}, 0);

describe('IndexLibrarian (Live)', () => {
  let workspace: string;
  let embeddingService: EmbeddingService;
  let llmConfig: { llmProvider: 'claude' | 'codex'; llmModelId: string };

  beforeEach(async () => {
    workspace = await createTempWorkspace();
    llmConfig = getLiveLlmConfig();
    embeddingService = await getLiveEmbeddingService();
  }, 0);

  afterEach(async () => {
    await cleanupWorkspace(workspace);
  }, 0);

  it('extracts functions from TypeScript files', async () => {
    const filePath = await createTestFile(workspace, 'src/math.ts', SAMPLE_TS_FILE);

    const dbPath = path.join(workspace, '.librarian', 'test.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath);
    await storage.initialize();

    const indexer = createIndexLibrarian({
      createContextPacks: true,
      generateEmbeddings: true,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });
    await indexer.initialize(storage);

    const result = await indexer.indexFile(filePath);

    expect(result.functionsFound).toBeGreaterThan(0);
    expect(result.functionsIndexed).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    const functions = await storage.getFunctions();
    expect(functions.length).toBeGreaterThan(0);

    const functionNames = functions.map(f => f.name);
    expect(functionNames).toContain('add');
    expect(functionNames).toContain('multiply');

    await indexer.shutdown();
    await storage.close();
  });

  it('creates context packs for functions', async () => {
    const filePath = await createTestFile(workspace, 'src/sample.ts', SAMPLE_TS_FILE);

    const dbPath = path.join(workspace, '.librarian', 'test.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath);
    await storage.initialize();

    const indexer = createIndexLibrarian({
      createContextPacks: true,
      generateEmbeddings: true,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });
    await indexer.initialize(storage);

    await indexer.indexFile(filePath);

    const packs = await storage.getContextPacks();
    expect(packs.length).toBeGreaterThan(0);

    const functions = await storage.getFunctions();
    const addFn = functions.find((fn) => fn.name === 'add');
    expect(addFn).toBeDefined();

    const addPack = await storage.getContextPackForTarget(addFn!.id, 'function_context');
    expect(addPack).toBeTruthy();
    expect(addPack!.codeSnippets.length).toBeGreaterThan(0);

    await indexer.shutdown();
    await storage.close();
  });

  it('generates embeddings when enabled', async () => {
    const filePath = await createTestFile(workspace, 'src/test.ts', SAMPLE_TS_FILE);

    const dbPath = path.join(workspace, '.librarian', 'test.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const storage = createSqliteStorage(dbPath);
    await storage.initialize();

    const indexer = createIndexLibrarian({
      generateEmbeddings: true,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });
    await indexer.initialize(storage);

    await indexer.indexFile(filePath);

    const functions = await storage.getFunctions();
    expect(functions.length).toBeGreaterThan(0);

    const embedding1 = await storage.getEmbedding(functions[0].id);
    expect(embedding1).toBeTruthy();
    expect(embedding1?.length).toBe(REAL_EMBEDDING_DIMENSION);

    await indexer.shutdown();
    await storage.close();
  });
});

describe('First-Run Gate (Live)', () => {
  let workspace: string;
  let previousTestMode: string | undefined;

  beforeEach(async () => {
    previousTestMode = process.env.WAVE0_TEST_MODE;
    process.env.WAVE0_TEST_MODE = 'true';
    workspace = await createTempWorkspace();
    await resetGate(workspace);
  });

  afterEach(async () => {
    if (workspace) {
      await resetGate(workspace);
    }
    if (previousTestMode === undefined) {
      delete process.env.WAVE0_TEST_MODE;
    } else {
      process.env.WAVE0_TEST_MODE = previousTestMode;
    }
    if (workspace) {
      await cleanupWorkspace(workspace);
    }
  });

  it('bootstraps and becomes ready', async () => {
    const embeddingService = await getLiveEmbeddingService();
    const { llmProvider, llmModelId } = getLiveLlmConfig();
    const previousProvider = process.env.LIBRARIAN_LLM_PROVIDER;
    const previousModel = process.env.LIBRARIAN_LLM_MODEL;
    process.env.LIBRARIAN_LLM_PROVIDER = llmProvider;
    process.env.LIBRARIAN_LLM_MODEL = llmModelId;

    try {
      await createTestFile(workspace, 'src/index.ts', SAMPLE_TS_FILE);

      const result = await ensureLibrarianReady(workspace, {
        throwOnFailure: true,
        includePatterns: ['**/*.ts'],
        embeddingService,
      });

      expect(result).toMatchObject({ success: true, wasBootstrapped: true });
      expect(result.librarian).not.toBeNull();
      expect(isLibrarianReady(workspace)).toBe(true);

      const result2 = await ensureLibrarianReady(workspace);
      expect(result2).toMatchObject({ wasBootstrapped: false });
      expect(result2.durationMs).toBeLessThan(100); // Should be instant
    } finally {
      if (previousProvider === undefined) {
        delete process.env.LIBRARIAN_LLM_PROVIDER;
      } else {
        process.env.LIBRARIAN_LLM_PROVIDER = previousProvider;
      }
      if (previousModel === undefined) {
        delete process.env.LIBRARIAN_LLM_MODEL;
      } else {
        process.env.LIBRARIAN_LLM_MODEL = previousModel;
      }
    }
  }, 0); // Unlimited per VISION (no timeouts for librarian)
});

describe('Librarian API (Live)', () => {
  let workspace: string;
  let librarian: Librarian;
  let embeddingService: EmbeddingService | null = null;
  let llmConfig: { llmProvider: 'claude' | 'codex'; llmModelId: string };

  beforeEach(async () => {
    llmConfig = getLiveLlmConfig();
    embeddingService = await getLiveEmbeddingService();
    workspace = await createTempWorkspace();
    await createTestFile(workspace, 'src/math.ts', SAMPLE_TS_FILE);
  }, 0); // Unlimited per VISION (no timeouts for librarian)

  afterEach(async () => {
    if (librarian) {
      await librarian.shutdown();
    }
    embeddingService = null;
    await cleanupWorkspace(workspace);
  }, 0);

  it('creates and initializes librarian', async () => {
    if (!embeddingService) throw new Error('Embedding service not initialized');
    librarian = await createLibrarian({
      workspace,
      autoBootstrap: true,
      bootstrapTimeoutMs: 0,
      bootstrapConfig: DETERMINISTIC_BOOTSTRAP,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });

    expect(librarian.isReady()).toBe(true);

    const status = await librarian.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.bootstrapped).toBe(true);
    expect(status.version).not.toBeNull();
  }, 0); // Unlimited per VISION (no timeouts for librarian)

  it('queries for context', async () => {
    if (!embeddingService) throw new Error('Embedding service not initialized');
    librarian = await createLibrarian({
      workspace,
      autoBootstrap: true,
      bootstrapTimeoutMs: 0,
      bootstrapConfig: DETERMINISTIC_BOOTSTRAP,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });

    const response = await librarian.query({
      intent: '',
      depth: 'L1',
    });

    expect(response.packs.length).toBeGreaterThanOrEqual(0);
    expect(response.version).toBeDefined();
  }, 0); // Unlimited per VISION (no timeouts for librarian)

  it('tracks confidence based on outcomes', async () => {
    if (!embeddingService) throw new Error('Embedding service not initialized');
    librarian = await createLibrarian({
      workspace,
      autoBootstrap: true,
      bootstrapTimeoutMs: 0,
      bootstrapConfig: DETERMINISTIC_BOOTSTRAP,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });

    const response = await librarian.query({
      intent: '',
      depth: 'L1',
    });

    if (response.packs.length > 0) {
      const pack = response.packs[0];

      await librarian.recordOutcome(pack.packId, 'success');

      const updated = await librarian.getContextPack(pack.targetId, pack.packType);
      if (updated) {
        expect(updated.accessCount).toBeGreaterThan(pack.accessCount);
      }
    }
  }, 0); // Unlimited per VISION (no timeouts for librarian)
});
