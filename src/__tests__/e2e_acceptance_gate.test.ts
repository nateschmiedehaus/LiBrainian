import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootstrapProject } from '../api/bootstrap.js';
import { queryLibrarian } from '../api/query.js';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { createLibrarianMCPServer } from '../mcp/server.js';
import type { LibrarianStorage, GraphEdge } from '../storage/types.js';
import type { EmbeddingRequest, EmbeddingResult } from '../api/embeddings.js';

const E2E_FIXTURE_PATH = path.resolve(__dirname, '../../tests/fixtures/e2e-fixture');

function resultContainsPath(result: { packs?: Array<{ targetId?: string; relatedFiles?: string[] }> }, expectedPath: string): boolean {
  const normalizedExpected = expectedPath.replace(/\\/g, '/').toLowerCase();
  for (const pack of result.packs ?? []) {
    const targetId = (pack.targetId ?? '').replace(/\\/g, '/').toLowerCase();
    if (targetId.includes(normalizedExpected) || normalizedExpected.includes(targetId)) {
      return true;
    }
    for (const related of pack.relatedFiles ?? []) {
      const rel = related.replace(/\\/g, '/').toLowerCase();
      if (rel.includes(normalizedExpected) || normalizedExpected.includes(rel)) {
        return true;
      }
    }
  }
  return false;
}

describe('E2E acceptance gate (issue #466)', () => {
  let storage: LibrarianStorage;
  let fixtureWorkspace = '';
  let dbPath = '';
  let deterministicEmbeddingService: {
    getEmbeddingDimension: () => number;
    generateEmbedding: (request: EmbeddingRequest) => Promise<EmbeddingResult>;
    generateEmbeddings: (requests: EmbeddingRequest[]) => Promise<EmbeddingResult[]>;
  };

  beforeAll(async () => {
    if (!fsSync.existsSync(E2E_FIXTURE_PATH)) {
      throw new Error(`Fixture missing: ${E2E_FIXTURE_PATH}`);
    }

    fixtureWorkspace = path.join(os.tmpdir(), `librarian-e2e-fixture-${randomUUID()}`);
    await fs.cp(E2E_FIXTURE_PATH, fixtureWorkspace, { recursive: true });
    await fs.rm(path.join(fixtureWorkspace, '.librarian'), { recursive: true, force: true });

    dbPath = path.join(os.tmpdir(), `librarian-e2e-gate-${randomUUID()}.db`);
    storage = createSqliteStorage(dbPath, fixtureWorkspace);
    await storage.initialize();
    deterministicEmbeddingService = {
      getEmbeddingDimension(): number {
        return 384;
      },
      async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
        const embedding = new Float32Array(384);
        embedding[0] = 1;
        embedding[1] = (request.text.length % 13) / 100;
        const magnitude = Math.hypot(...embedding);
        embedding[0] /= magnitude;
        embedding[1] /= magnitude;
        return {
          embedding,
          modelId: 'test-e2e-deterministic-384',
          provider: 'xenova',
          generatedAt: new Date().toISOString(),
          tokenCount: Math.max(1, Math.ceil(request.text.length / 4)),
        };
      },
      async generateEmbeddings(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
        return Promise.all(requests.map((request) => this.generateEmbedding(request)));
      },
    };

    await bootstrapProject(
      {
        workspace: fixtureWorkspace,
        bootstrapMode: 'fast',
        include: ['**/*'],
        exclude: ['node_modules/**', '.git/**'],
        maxFileSizeBytes: 512_000,
        skipProviderProbe: true,
        embeddingService: deterministicEmbeddingService as any,
      },
      storage,
    );
  }, 120_000);

  afterAll(async () => {
    await storage?.close?.();
    if (dbPath) {
      await fs.rm(dbPath, { force: true });
      await fs.rm(`${dbPath}-wal`, { force: true });
      await fs.rm(`${dbPath}-shm`, { force: true });
    }
    if (fixtureWorkspace) {
      await fs.rm(fixtureWorkspace, { recursive: true, force: true });
    }
  });

  it('indexes known functions, builds expected call edges, and stores non-zero embeddings', async () => {
    const functions = await storage.getFunctions();
    const authenticateUser = functions.find((fn) => fn.name === 'authenticateUser');
    const validateEmail = functions.find((fn) => fn.name === 'validateEmail');
    const loadUserByEmail = functions.find((fn) => fn.name === 'loadUserByEmail');

    expect(authenticateUser).toBeTruthy();
    expect(validateEmail).toBeTruthy();
    expect(loadUserByEmail).toBeTruthy();

    const edges = await storage.getGraphEdges({ edgeType: 'calls' });
    const hasEdge = (fromId: string, toId: string): boolean =>
      edges.some((edge: GraphEdge) => edge.edgeType === 'calls' && edge.fromId === fromId && edge.toId === toId);

    expect(hasEdge(authenticateUser!.id, validateEmail!.id)).toBe(true);
    expect(hasEdge(authenticateUser!.id, loadUserByEmail!.id)).toBe(true);
    expect(hasEdge(validateEmail!.id, loadUserByEmail!.id)).toBe(false);

    const embedding = await storage.getEmbedding(authenticateUser!.id);
    expect(embedding).toBeTruthy();
    expect(Array.from(embedding ?? []).some((value) => value !== 0)).toBe(true);
  });

  it('returns auth module context with confidence and latency bounds for an orientation query', async () => {
    const result = await queryLibrarian(
      {
        intent: 'where is authentication handled?',
        depth: 'L0',
        llmRequirement: 'disabled',
        embeddingRequirement: 'disabled',
      },
      storage,
      deterministicEmbeddingService as any,
    );

    expect(result.latencyMs).toBeLessThan(5_000);
    expect(result.totalConfidence).toBeGreaterThan(0.5);
    expect(resultContainsPath(result, 'src/auth/session.ts')).toBe(true);
  });

  it('serves semantic_search via MCP and returns validation module hits in MCP tool format', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    server.registerWorkspace(fixtureWorkspace);
    server.updateWorkspaceState(fixtureWorkspace, { indexState: 'ready' });
    (server as unknown as { getOrCreateStorage: () => Promise<LibrarianStorage> }).getOrCreateStorage = vi
      .fn()
      .mockResolvedValue(storage);

    const toolResponse = await (server as unknown as {
      callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    }).callTool('semantic_search', {
      query: 'find user validation',
      workspace: fixtureWorkspace,
      depth: 'L1',
      minConfidence: 0.2,
    });

    expect(toolResponse.isError).not.toBe(true);
    expect(Array.isArray(toolResponse.content)).toBe(true);
    const payload = JSON.parse(toolResponse.content[0]?.text ?? '{}') as Record<string, unknown>;
    expect(payload.tool).toBe('semantic_search');
    expect(Array.isArray(payload.packs)).toBe(true);
    expect(JSON.stringify(payload).toLowerCase()).toContain('validation/user.ts');
  });

  it('round-trips get_context_pack under 10k tokens and includes auth-related function context', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    server.registerWorkspace(fixtureWorkspace);
    server.updateWorkspaceState(fixtureWorkspace, { indexState: 'ready' });
    (server as unknown as { getOrCreateStorage: () => Promise<LibrarianStorage> }).getOrCreateStorage = vi
      .fn()
      .mockResolvedValue(storage);

    const toolResponse = await (server as unknown as {
      callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    }).callTool('get_context_pack', {
      intent: 'authentication module flow',
      workspace: fixtureWorkspace,
      relevantFiles: [path.join(fixtureWorkspace, 'src/auth/session.ts')],
      tokenBudget: 10_000,
    });

    expect(toolResponse.isError).not.toBe(true);
    const payload = JSON.parse(toolResponse.content[0]?.text ?? '{}') as {
      success?: boolean;
      tool?: string;
      tokenCount?: number;
      functions?: Array<{ relatedFiles?: string[] }>;
    };
    expect(payload.success).toBe(true);
    expect(payload.tool).toBe('get_context_pack');
    expect(payload.tokenCount ?? 0).toBeLessThan(10_000);
    expect(Array.isArray(payload.functions)).toBe(true);
    expect(
      (payload.functions ?? []).some((fn) =>
        (fn.relatedFiles ?? []).some((file) => file.replace(/\\/g, '/').includes('src/auth/session.ts'))),
    ).toBe(true);
  });
});
