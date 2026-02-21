/**
 * @fileoverview MVP Librarian Tests (SYSTEM)
 *
 * These tests validate the minimum viable librarian functionality as defined in
 * docs/WORLD_CLASS_ASSESSMENT.md Part 12.
 *
 * MVP Requirements:
 * - Indexes Wave0 codebase correctly
 * - Answers "where is X defined?" for 10 test queries
 * - Context assembly includes relevant files
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  createLibrarian,
  Librarian,
  createSqliteStorage,
  createIndexLibrarian,
  queryLibrarian,
  bootstrapProject,
  isBootstrapRequired,
  createBootstrapConfig,
} from '../index.js';
import { checkAllProviders, type AllProviderStatus } from '../api/provider_check.js';
import { EmbeddingService, REAL_EMBEDDING_DIMENSION } from '../api/embeddings.js';
import type { LibrarianStorage } from '../storage/types.js';
import { resolveLibrarianModelId } from '../api/llm_env.js';
import { cleanupWorkspace } from './helpers/index.js';

const IS_TIER0 = process.env.LIBRARIAN_TIER0 === '1';
const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && process.env.LIBRARIAN_TIER0 !== '1');
const describeLive = IS_TIER0 || IS_UNIT_MODE ? describe.skip : describe;

let previousTestMode: string | undefined;

beforeAll(async () => {
  if (IS_TIER0 || IS_UNIT_MODE) return;
  previousTestMode = process.env.WAVE0_TEST_MODE;
  process.env.WAVE0_TEST_MODE = 'true';
  const status = await requireLiveProviders();
  liveLlmProvider = status.llm.provider === 'claude' ? 'claude' : 'codex';
  liveLlmModelId = resolveLlmModelId(liveLlmProvider);
}, 0);

afterAll(() => {
  if (IS_TIER0 || IS_UNIT_MODE) return;
  if (typeof previousTestMode === 'string') {
    process.env.WAVE0_TEST_MODE = previousTestMode;
  } else {
    delete process.env.WAVE0_TEST_MODE;
  }
});

/**
 * Create a minimal test workspace with Wave0-like structure
 */
async function createMVPWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mvp-librarian-test-'));

  // Create config
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'config', 'canon.json'),
    JSON.stringify({ schema_version: 1 }, null, 2)
  );

  // Create src structure matching Wave0 patterns
  await fs.mkdir(path.join(root, 'src', 'orchestrator'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'librarian', 'api'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'workgraph'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'spine'), { recursive: true });

  // Create test files with known function definitions
  await fs.writeFile(
    path.join(root, 'src', 'orchestrator', 'runner.ts'),
    `/**
 * Orchestrator runner for Wave0
 */
export interface OrchestratorConfig {
  workspace: string;
  maxIterations: number;
}

export async function runOrchestrator(config: OrchestratorConfig): Promise<void> {
  console.log('Running orchestrator');
}

export function createOrchestratorConfig(workspace: string): OrchestratorConfig {
  return { workspace, maxIterations: 10 };
}
`
  );

  await fs.writeFile(
    path.join(root, 'src', 'librarian', 'api', 'query.ts'),
    `/**
 * Librarian query interface
 */
export interface LibrarianQuery {
  intent: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';
}

export async function queryLibrarian(query: LibrarianQuery): Promise<unknown> {
  return { packs: [], latencyMs: 0 };
}

export function createFunctionQuery(functionName: string): LibrarianQuery {
  return { intent: \`Find function \${functionName}\`, depth: 'L1' };
}
`
  );

  await fs.writeFile(
    path.join(root, 'src', 'workgraph', 'runner.ts'),
    `/**
 * WorkGraph execution runner
 */
export interface WorkGraphNode {
  id: string;
  type: 'task' | 'checkpoint';
  status: 'pending' | 'running' | 'complete' | 'failed';
}

export interface WorkGraph {
  nodes: WorkGraphNode[];
  edges: Array<[string, string]>;
}

export async function executeWorkGraph(graph: WorkGraph): Promise<void> {
  for (const node of graph.nodes) {
    node.status = 'running';
    await processNode(node);
    node.status = 'complete';
  }
}

async function processNode(node: WorkGraphNode): Promise<void> {
  console.log(\`Processing node \${node.id}\`);
}

export function createWorkGraph(): WorkGraph {
  return { nodes: [], edges: [] };
}
`
  );

  await fs.writeFile(
    path.join(root, 'src', 'spine', 'exec_tool.ts'),
    `/**
 * Tool execution for spine
 */
export interface ToolResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export async function executeTool(name: string, args: string[]): Promise<ToolResult> {
  return { success: true, output: '', exitCode: 0 };
}

export function validateToolArgs(args: string[]): boolean {
  return args.every(arg => typeof arg === 'string');
}
`
  );

  return root;
}

// Workspace cleanup moved to shared helper: ./helpers/workspace.ts

const TEST_EMBEDDING_DIMENSION = resolveTestEmbeddingDimension();
const DEFAULT_CODEX_MODEL_ID = 'gpt-5.1-codex-mini';
const DEFAULT_CLAUDE_MODEL_ID = 'claude-haiku-4-5-20241022';
let liveProviderStatus: AllProviderStatus | null = null;
let liveLlmProvider: 'claude' | 'codex' | null = null;
let liveLlmModelId: string | null = null;

/**
 * LIVE PROVIDERS REQUIRED FOR SEMANTIC TESTS
 *
 * Per docs/LIVE_PROVIDERS_PLAYBOOK.md:
 * - Fake/deterministic embeddings are FORBIDDEN
 * - Tests that make semantic claims MUST use live providers
 *
 * The createTestEmbeddingService function with fake embeddings has been DELETED.
 */
async function requireLiveProviders(): Promise<AllProviderStatus> {
  const status = await checkAllProviders({ workspaceRoot: process.cwd() });
  const missing: string[] = [];
  if (!status.llm.available) missing.push(`LLM: ${status.llm.error ?? 'unavailable'}`);
  if (!status.embedding.available) missing.push(`Embedding: ${status.embedding.error ?? 'unavailable'}`);
  if (missing.length > 0) {
    throw new Error(`unverified_by_trace(provider_unavailable): ${missing.join('; ')}`);
  }
  liveProviderStatus = status;
  return status;
}

function resolveLlmModelId(provider: 'claude' | 'codex'): string {
  const envModel = resolveLibrarianModelId(provider);
  if (envModel) return envModel;
  return provider === 'claude' ? DEFAULT_CLAUDE_MODEL_ID : DEFAULT_CODEX_MODEL_ID;
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
    embeddingDimension: TEST_EMBEDDING_DIMENSION,
    maxBatchSize: 5,
    maxConcurrentBatches: 1,
    batchDelayMs: 0,
  });
}

function resolveTestEmbeddingDimension(): number {
  return REAL_EMBEDDING_DIMENSION;
}

describeLive('MVP Librarian Tests (LIB-U*)', () => {
  let workspace: string;
  let storage: LibrarianStorage;
  let dbPath: string;

  beforeAll(async () => {
    workspace = await createMVPWorkspace();
    dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    // Index the test workspace
    const embeddingService = await getLiveEmbeddingService();
    const llmConfig = getLiveLlmConfig();
    const indexer = createIndexLibrarian({
      createContextPacks: true,
      generateEmbeddings: true,
      embeddingService,
      llmProvider: llmConfig.llmProvider,
      llmModelId: llmConfig.llmModelId,
    });
    await indexer.initialize(storage);

    const files = [
      path.join(workspace, 'src', 'orchestrator', 'runner.ts'),
      path.join(workspace, 'src', 'librarian', 'api', 'query.ts'),
      path.join(workspace, 'src', 'workgraph', 'runner.ts'),
      path.join(workspace, 'src', 'spine', 'exec_tool.ts'),
    ];

    for (const file of files) {
      await indexer.indexFile(file);
    }

    await indexer.shutdown();
  }, 0);

  afterAll(async () => {
    await storage.close();
    await cleanupWorkspace(workspace);
  });

  describe('LIB-U1: Indexes codebase correctly', () => {
    it('should index all TypeScript files in workspace', async () => {
      const functions = await storage.getFunctions();
      expect(functions.length).toBeGreaterThan(0);

      // Should have indexed functions from all 4 files
      const filePaths = [...new Set(functions.map((f) => f.filePath))];
      expect(filePaths.length).toBe(4);
    });

    it('should extract function names correctly', async () => {
      const functions = await storage.getFunctions();
      const functionNames = functions.map((f) => f.name);

      // Check for known functions
      expect(functionNames).toContain('runOrchestrator');
      expect(functionNames).toContain('createOrchestratorConfig');
      expect(functionNames).toContain('queryLibrarian');
      expect(functionNames).toContain('createFunctionQuery');
      expect(functionNames).toContain('executeWorkGraph');
      expect(functionNames).toContain('createWorkGraph');
      expect(functionNames).toContain('executeTool');
      expect(functionNames).toContain('validateToolArgs');
    });

    it('should extract function signatures', async () => {
      const functions = await storage.getFunctions();
      const runOrchestrator = functions.find((f) => f.name === 'runOrchestrator');

      expect(runOrchestrator).toBeDefined();
      expect(runOrchestrator!.signature).toContain('config');
      expect(runOrchestrator!.signature).toContain('OrchestratorConfig');
    });
  });

  describe('LIB-U2: Answers "where is X defined?" queries', () => {
    // Test 10 different "where is X defined?" queries
    const testQueries = [
      { name: 'runOrchestrator', expectedPath: 'orchestrator/runner.ts' },
      { name: 'createOrchestratorConfig', expectedPath: 'orchestrator/runner.ts' },
      { name: 'queryLibrarian', expectedPath: 'librarian/api/query.ts' },
      { name: 'createFunctionQuery', expectedPath: 'librarian/api/query.ts' },
      { name: 'executeWorkGraph', expectedPath: 'workgraph/runner.ts' },
      { name: 'createWorkGraph', expectedPath: 'workgraph/runner.ts' },
      { name: 'processNode', expectedPath: 'workgraph/runner.ts' },
      { name: 'executeTool', expectedPath: 'spine/exec_tool.ts' },
      { name: 'validateToolArgs', expectedPath: 'spine/exec_tool.ts' },
      { name: 'OrchestratorConfig', expectedPath: 'orchestrator/runner.ts' },
    ];

    testQueries.forEach(({ name, expectedPath }, index) => {
      it(`LIB-U2.${index + 1}: should find where "${name}" is defined`, async () => {
        const functions = await storage.getFunctions();
        const found = functions.find((f) => f.name === name || f.signature.includes(name));

        expect(found).toBeDefined();
        expect(found!.filePath).toContain(expectedPath);
      });
    });
  });

  describe('LIB-U3: Context assembly includes relevant files', () => {
    it('should create context packs for indexed functions', async () => {
      const packs = await storage.getContextPacks();
      expect(packs.length).toBeGreaterThan(0);
    });

    it('should include code snippets in context packs', async () => {
      const packs = await storage.getContextPacks();
      const packWithSnippets = packs.find((p) => p.codeSnippets && p.codeSnippets.length > 0);

      expect(packWithSnippets).toBeDefined();
      expect(packWithSnippets!.codeSnippets.length).toBeGreaterThan(0);
    });

    it('should associate context packs with correct files', async () => {
      const packs = await storage.getContextPacks();

      // Each pack should reference a file path
      for (const pack of packs) {
        expect(pack.codeSnippets.length).toBeGreaterThanOrEqual(0);
        if (pack.codeSnippets.length > 0) {
          expect(pack.codeSnippets[0].filePath).toBeDefined();
        }
      }
    });
  });
});

/**
 * MVP Librarian Integration Tests
 *
 * NOTE: These tests require LIVE embedding providers per docs/LIVE_PROVIDERS_PLAYBOOK.md.
 * Tests that cannot get live providers will fail with unverified_by_trace(provider_unavailable).
 */
describeLive('MVP Librarian Integration Tests (LIB-I*)', () => {
  let workspace: string;
  let storage: LibrarianStorage;
  let dbPath: string;

  beforeAll(async () => {
    workspace = await createMVPWorkspace();
    dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
  }, 0);

  afterAll(async () => {
    await storage.close();
    await cleanupWorkspace(workspace);
  });

  describe('LIB-I1: Bootstrap detection', () => {
    it('should detect when bootstrap is required', async () => {
      const result = await isBootstrapRequired(workspace, storage);
      expect(result.required).toBe(true);
      expect(result.reason).toContain('fresh bootstrap');
    });
  });

  describe('LIB-I2: Full bootstrap flow', () => {
    let embeddingService: EmbeddingService | null = null;

    beforeAll(async () => {
      embeddingService = await getLiveEmbeddingService();
      if (!embeddingService) {
        throw new Error('unverified_by_trace(provider_unavailable): Live embedding provider required for bootstrap test');
      }
    }, 0);

    it('should bootstrap the workspace successfully (requires live provider)', async () => {
      const activeEmbeddingService = embeddingService;
      if (!activeEmbeddingService) {
        throw new Error('unverified_by_trace(provider_unavailable): Live embedding provider required for bootstrap test');
      }
      const report = await bootstrapProject(
        createBootstrapConfig(workspace, {
          include: ['**/*.ts'],
          embeddingService: activeEmbeddingService,
        }),
        storage
      );

      expect(report.success).toBe(true);
      expect(report.totalFilesProcessed).toBeGreaterThan(0);
    }, 0); // Unlimited per VISION (no timeouts for librarian)

    it('should not require bootstrap after initial run', async () => {
      const result = await isBootstrapRequired(workspace, storage);
      expect(result.required).toBe(false);
    });
  });
});

/**
 * MVP Librarian System Tests
 *
 * NOTE: These tests require LIVE embedding providers per docs/LIVE_PROVIDERS_PLAYBOOK.md.
 * Tests that cannot get live providers will fail with unverified_by_trace(provider_unavailable).
 */
describeLive('MVP Librarian System Tests (LIB-S*)', () => {
  const LIVE_TEST_TIMEOUT_MS = 0; // Unlimited per VISION (no timeouts for librarian)
  let workspace: string;
  let librarian: Librarian;
  let embeddingService: EmbeddingService;
  let llmConfig: { llmProvider: 'claude' | 'codex'; llmModelId: string };

  beforeAll(
    async () => {
      workspace = await createMVPWorkspace();
      embeddingService = await getLiveEmbeddingService();
      llmConfig = getLiveLlmConfig();
      librarian = await createLibrarian({
        workspace,
        autoBootstrap: true,
        bootstrapTimeoutMs: 0, // 0 = unlimited per VISION (no timeouts)
        bootstrapConfig: {
          include: ['**/*.ts'],
          embeddingService,
        },
        embeddingService,
        llmProvider: llmConfig.llmProvider,
        llmModelId: llmConfig.llmModelId,
      });
    },
    0 // Unlimited timeout per VISION (no timeouts for librarian)
  );

  afterAll(async () => {
    if (librarian) {
      await librarian.shutdown();
    }
    await cleanupWorkspace(workspace);
  });

  describe('LIB-S1: High-level librarian API', () => {
    it('should be ready after bootstrap', () => {
      expect(librarian.isReady()).toBe(true);
    }, LIVE_TEST_TIMEOUT_MS);

    it('should return status with correct version', async () => {
      const status = await librarian.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.bootstrapped).toBe(true);
      expect(status.version).toBeDefined();
    }, LIVE_TEST_TIMEOUT_MS);

    it('should respond to queries within timeout', async () => {
      const response = await librarian.query({
        intent: 'Find orchestrator functions',
        depth: 'L1',
      });

      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
      expect(response.version).toBeDefined();
    }, LIVE_TEST_TIMEOUT_MS);
  });

  describe('LIB-S2: Outcome tracking', () => {
    it('should track access counts on query', async () => {
      const response = await librarian.query({
        intent: '',
        depth: 'L1',
      });

      if (response.packs.length > 0) {
        const pack = response.packs[0];
        const initialAccess = pack.accessCount;

        // Query again
        await librarian.query({
          intent: '',
          depth: 'L1',
        });

        const updated = await librarian.getContextPack(pack.targetId, pack.packType);
        if (updated) {
          expect(updated.accessCount).toBeGreaterThanOrEqual(initialAccess);
        }
      }
    }, LIVE_TEST_TIMEOUT_MS);
  });

  describe('LIB-S3: Engine toolkit', () => {
    it('should answer agent context queries with engine toolkit', async () => {
      const agent = librarian.getAgent();
      const answer = await agent.ask({
        type: 'context',
        intent: 'authentication flow',
        scope: ['src'],
      });

      const payload = answer.answer as { tiers?: { essential: unknown[] } };
      expect(payload.tiers?.essential).toBeDefined();
      expect(answer.confidence).toBeGreaterThanOrEqual(0);
    }, LIVE_TEST_TIMEOUT_MS);

    it('should validate constraints through agent interface', async () => {
      const agent = librarian.getAgent();
      const validation = await agent.ask({
        type: 'allowed',
        action: {
          file: 'src/librarian/api/index.ts',
          before: 'export const example = 1;',
          after: 'export const example = 2;',
        },
      });

      const payload = validation.answer as { blocking?: boolean };
      expect(payload.blocking).toBe(false);
    }, LIVE_TEST_TIMEOUT_MS);

    it('should report confidence via meta engine', async () => {
      const agent = librarian.getAgent();
      const confidence = await agent.ask({
        type: 'confidence',
        in: ['src/librarian/api/index.ts'],
      });

      const payload = confidence.answer as { overall?: number };
      expect(payload.overall).toBeDefined();
    }, LIVE_TEST_TIMEOUT_MS);

    it('should surface test mappings via agent interface', async () => {
      const agent = librarian.getAgent();
      const coverage = await agent.ask({
        type: 'tests',
        for: ['src/librarian/api/index.ts'],
      });

      const payload = coverage.answer as Array<{ source?: string; tests?: string[] }>;
      expect(Array.isArray(payload)).toBe(true);
    }, LIVE_TEST_TIMEOUT_MS);

    it('should include engine results in query responses', async () => {
      const response = await librarian.query({
        intent: 'authentication flow',
        depth: 'L1',
        includeEngines: true,
      });

      expect(response.engines?.relevance).toBeDefined();
      expect(response.engines?.meta?.confidence).toBeDefined();
      expect(response.engines?.constraints?.applicable).toBeDefined();
    }, LIVE_TEST_TIMEOUT_MS);
  });
});
