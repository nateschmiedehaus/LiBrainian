import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootstrapProject } from '../api/bootstrap.js';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { createLibrarianMCPServer } from '../mcp/server.js';
import type { EmbeddingRequest, EmbeddingResult } from '../api/embeddings.js';
import type { GraphEdge, LibrarianStorage } from '../storage/types.js';
import type { FunctionKnowledge } from '../types.js';

const FIXTURE_PATH = path.resolve(__dirname, '../../tests/fixtures/index-correctness-fixture');
const BASELINE_PATH = path.join(FIXTURE_PATH, 'IndexCorrectnessBaseline.v1.json');

type Baseline = {
  callGraph: {
    precisionMin: number;
    recallMin: number;
    edgeCountTolerance: number;
    expectedEdges: Array<[string, string]>;
  };
  embeddingQuality: {
    comparisons: Array<[string, string, string]>;
  };
  functionData: {
    semanticMatchMin: number;
    semanticSimilarityThreshold: number;
    expectations: Array<{
      name: string;
      description: string;
      parameters: string[];
    }>;
  };
  contextPack: {
    moduleFile: string;
    publicFunctions: string[];
    tokenBudget: number;
    unrelatedFunctions: string[];
  };
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function tokenize(value: string): string[] {
  const expanded = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ');
  return expanded.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (left.size + right.size);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function embeddingBuckets(text: string): Float32Array {
  const lower = text.toLowerCase();
  const dimensions = new Float32Array(16);
  const buckets: Array<{ index: number; terms: string[] }> = [
    { index: 0, terms: ['validate', 'normalize', 'email', 'phone'] },
    { index: 1, terms: ['session', 'token', 'auth', 'hash'] },
    { index: 2, terms: ['profile', 'user', 'completeness', 'card'] },
    { index: 3, terms: ['retention', 'churn', 'engagement', 'analytics'] },
    { index: 4, terms: ['subtotal', 'tax', 'discount', 'total', 'pricing'] },
    { index: 5, terms: ['render', 'chart', 'visual'] },
  ];

  for (const bucket of buckets) {
    let hits = 0;
    for (const term of bucket.terms) {
      if (lower.includes(term)) {
        hits += 1;
      }
    }
    dimensions[bucket.index] = hits;
  }

  let fallback = 0;
  for (let i = 0; i < lower.length; i += 1) {
    fallback = ((fallback << 5) - fallback) + lower.charCodeAt(i);
    fallback |= 0;
  }
  dimensions[15] = Math.abs(fallback % 97) / 100;

  let normSq = 0;
  for (let i = 0; i < dimensions.length; i += 1) {
    normSq += dimensions[i] * dimensions[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) {
    dimensions[0] = 1;
    return dimensions;
  }
  for (let i = 0; i < dimensions.length; i += 1) {
    dimensions[i] = dimensions[i] / norm;
  }
  return dimensions;
}

describe('Index correctness verification suite (issue #467)', () => {
  let storage: LibrarianStorage;
  let workspace = '';
  let dbPath = '';
  let baseline: Baseline;
  let deterministicEmbeddingService: {
    getEmbeddingDimension: () => number;
    generateEmbedding: (request: EmbeddingRequest) => Promise<EmbeddingResult>;
    generateEmbeddings: (requests: EmbeddingRequest[]) => Promise<EmbeddingResult[]>;
  };

  beforeAll(async () => {
    if (!fsSync.existsSync(FIXTURE_PATH)) {
      throw new Error(`Fixture missing: ${FIXTURE_PATH}`);
    }
    if (!fsSync.existsSync(BASELINE_PATH)) {
      throw new Error(`Baseline missing: ${BASELINE_PATH}`);
    }

    baseline = JSON.parse(await fs.readFile(BASELINE_PATH, 'utf8')) as Baseline;
    workspace = path.join(os.tmpdir(), `librarian-index-correctness-${randomUUID()}`);
    await fs.cp(FIXTURE_PATH, workspace, { recursive: true });
    await fs.rm(path.join(workspace, '.librarian'), { recursive: true, force: true });
    await fs.rm(path.join(workspace, 'state'), { recursive: true, force: true });

    dbPath = path.join(os.tmpdir(), `librarian-index-correctness-${randomUUID()}.db`);
    storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    deterministicEmbeddingService = {
      getEmbeddingDimension(): number {
        return 16;
      },
      async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
        return {
          embedding: embeddingBuckets(request.text),
          modelId: 'index-correctness-deterministic-16',
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
        workspace,
        bootstrapMode: 'full',
        include: ['src/**/*.ts'],
        exclude: ['node_modules/**', '.git/**'],
        skipLlm: true,
        skipProviderProbe: true,
        maxFileSizeBytes: 256_000,
        embeddingService: deterministicEmbeddingService as any,
      },
      storage,
    );
  }, 120_000);

  afterAll(async () => {
    await storage?.close?.();
    await fs.rm(dbPath, { force: true });
    await fs.rm(`${dbPath}-wal`, { force: true });
    await fs.rm(`${dbPath}-shm`, { force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('achieves 95%+ call graph precision/recall and preserves baseline edge count', async () => {
    const functions = await storage.getFunctions();
    const functionById = new Map(functions.map((fn) => [fn.id, fn]));
    const expectedFunctionNames = new Set(baseline.functionData.expectations.map((item) => item.name));

    for (const name of expectedFunctionNames) {
      expect(functions.some((fn) => fn.name === name)).toBe(true);
    }

    const edges = await storage.getGraphEdges({ edgeType: 'calls', limit: 2000 });
    const predicted = new Set<string>();
    for (const edge of edges) {
      const from = functionById.get(edge.fromId);
      const to = functionById.get(edge.toId);
      if (!from || !to) continue;
      if (!expectedFunctionNames.has(from.name) || !expectedFunctionNames.has(to.name)) continue;
      predicted.add(`${from.name}->${to.name}`);
    }

    const expected = new Set(
      baseline.callGraph.expectedEdges.map(([from, to]) => `${from}->${to}`),
    );

    let truePositive = 0;
    for (const edge of predicted) {
      if (expected.has(edge)) {
        truePositive += 1;
      }
    }
    const falsePositive = predicted.size - truePositive;
    const falseNegative = expected.size - truePositive;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);

    const edgeCountDelta = Math.abs(predicted.size - expected.size) / Math.max(1, expected.size);

    expect(precision).toBeGreaterThanOrEqual(baseline.callGraph.precisionMin);
    expect(recall).toBeGreaterThanOrEqual(baseline.callGraph.recallMin);
    expect(edgeCountDelta).toBeLessThanOrEqual(baseline.callGraph.edgeCountTolerance);
  });

  it('preserves embedding similarity ordering for all baseline comparisons', async () => {
    const functions = await storage.getFunctions();
    const byName = new Map(functions.map((fn) => [fn.name, fn]));

    const resolveEmbedding = async (fn: FunctionKnowledge): Promise<Float32Array> => {
      const candidates = [fn.id, `${fn.filePath}:${fn.name}`, fn.filePath];
      for (const entityId of candidates) {
        const embedding = await storage.getEmbedding(entityId);
        if (embedding) {
          return embedding;
        }
      }
      throw new Error(`Missing embedding for function: ${fn.name}`);
    };

    for (const [anchorName, closerName, fartherName] of baseline.embeddingQuality.comparisons) {
      const anchor = byName.get(anchorName);
      const closer = byName.get(closerName);
      const farther = byName.get(fartherName);
      expect(anchor, `missing function ${anchorName}`).toBeTruthy();
      expect(closer, `missing function ${closerName}`).toBeTruthy();
      expect(farther, `missing function ${fartherName}`).toBeTruthy();

      const [anchorEmbedding, closerEmbedding, fartherEmbedding] = await Promise.all([
        resolveEmbedding(anchor!),
        resolveEmbedding(closer!),
        resolveEmbedding(farther!),
      ]);
      const closeSimilarity = cosineSimilarity(anchorEmbedding, closerEmbedding);
      const farSimilarity = cosineSimilarity(anchorEmbedding, fartherEmbedding);
      expect(closeSimilarity).toBeGreaterThan(farSimilarity);
    }
  });

  it('keeps function purpose/signature accuracy above the baseline threshold', async () => {
    const functions = await storage.getFunctions();
    const byName = new Map(functions.map((fn) => [fn.name, fn]));
    let semanticMatches = 0;

    for (const expectation of baseline.functionData.expectations) {
      const fn = byName.get(expectation.name);
      expect(fn, `missing function ${expectation.name}`).toBeTruthy();
      if (!fn) continue;

      for (const parameter of expectation.parameters) {
        expect(fn.signature.toLowerCase()).toContain(parameter.toLowerCase());
      }

      const semanticSource = `${fn.name} ${fn.purpose}`;
      const similarity = lexicalSimilarity(expectation.description, semanticSource);
      if (similarity >= baseline.functionData.semanticSimilarityThreshold) {
        semanticMatches += 1;
      }
    }

    const semanticMatchRate = semanticMatches / Math.max(1, baseline.functionData.expectations.length);
    expect(semanticMatchRate).toBeGreaterThanOrEqual(baseline.functionData.semanticMatchMin);
  });

  it('keeps module context packs accurate and within declared token budget', async () => {
    const functions = await storage.getFunctions();
    const byName = new Map(functions.map((fn) => [fn.name, fn]));
    const moduleRelativePath = baseline.contextPack.moduleFile;
    const moduleAbsolutePath = path.join(workspace, moduleRelativePath);
    const normalizedModulePath = normalizePath(moduleAbsolutePath);

    const modulePacks = await storage.getContextPacks({
      relatedFile: moduleAbsolutePath,
      packType: 'function_context',
      limit: 200,
    });
    const targetIds = new Set(modulePacks.map((pack) => pack.targetId));

    const hasTarget = (fn: FunctionKnowledge): boolean =>
      targetIds.has(fn.id) || targetIds.has(`${fn.filePath}:${fn.name}`) || targetIds.has(fn.filePath);

    for (const functionName of baseline.contextPack.publicFunctions) {
      const fn = byName.get(functionName);
      expect(fn, `missing function ${functionName}`).toBeTruthy();
      if (!fn) continue;
      expect(normalizePath(fn.filePath)).toContain(normalizedModulePath);
      expect(hasTarget(fn)).toBe(true);
    }

    for (const functionName of baseline.contextPack.unrelatedFunctions) {
      const fn = byName.get(functionName);
      expect(fn, `missing function ${functionName}`).toBeTruthy();
      if (!fn) continue;
      expect(hasTarget(fn)).toBe(false);
    }

    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as unknown as { getOrCreateStorage: () => Promise<LibrarianStorage> }).getOrCreateStorage = vi
      .fn()
      .mockResolvedValue(storage);

    const toolResponse = await (server as unknown as {
      callTool: (name: string, args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    }).callTool('get_context_pack', {
      intent: 'how is total order price calculated',
      workspace,
      relevantFiles: [moduleAbsolutePath],
      tokenBudget: baseline.contextPack.tokenBudget,
    });

    expect(toolResponse.isError).not.toBe(true);
    const payload = JSON.parse(toolResponse.content[0]?.text ?? '{}') as {
      success?: boolean;
      tokenCount?: number;
    };
    expect(payload.success).toBe(true);
    expect(payload.tokenCount ?? 0).toBeLessThanOrEqual(baseline.contextPack.tokenBudget);
  });
});
