import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { Context } from '../../types.js';
import { unwrapConstructionExecutionResult } from '../../types.js';
import type { FunctionKnowledge, GraphEdge } from '../../../types.js';
import type { GraphEdgeQueryOptions, LibrarianStorage } from '../../../storage/types.js';
import { createSemanticDuplicateDetectorConstruction } from '../semantic_duplicate_detector.js';

type StorageSlice = Pick<LibrarianStorage, 'getFunctions' | 'getGraphEdges'>;

interface StorageHarness {
  storage: StorageSlice;
  getLastGraphQuery: () => GraphEdgeQueryOptions | undefined;
}

function createFunctionKnowledge(params: {
  id: string;
  filePath: string;
  name: string;
  purpose: string;
  signature?: string;
}): FunctionKnowledge {
  return {
    id: params.id,
    filePath: params.filePath,
    name: params.name,
    signature: params.signature ?? `function ${params.name}(input: string): string`,
    purpose: params.purpose,
    startLine: 1,
    endLine: 10,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: {
      successes: 0,
      failures: 0,
    },
  };
}

function createCallEdge(fromId: string, toId: string): GraphEdge {
  return {
    fromId,
    fromType: 'function',
    toId,
    toType: 'function',
    edgeType: 'calls',
    sourceFile: 'src/callers.ts',
    sourceLine: 1,
    confidence: 1,
    computedAt: new Date(),
  };
}

function createStorageHarness(functions: FunctionKnowledge[], edges: GraphEdge[] = []): StorageHarness {
  let lastGraphQuery: GraphEdgeQueryOptions | undefined;
  const storage: StorageSlice = {
    async getFunctions() {
      return functions;
    },
    async getGraphEdges(options?: GraphEdgeQueryOptions) {
      lastGraphQuery = options;
      const requestedEdgeTypes = options?.edgeTypes;
      const requestedFromIds = options?.fromIds;
      const requestedToIds = options?.toIds;
      const filtered = edges.filter((edge) => {
        if (requestedEdgeTypes && !requestedEdgeTypes.includes(edge.edgeType)) return false;
        if (requestedFromIds && !requestedFromIds.includes(edge.fromId)) return false;
        if (requestedToIds && !requestedToIds.includes(edge.toId)) return false;
        return true;
      });
      const limit = options?.limit ?? filtered.length;
      return filtered.slice(0, Math.max(0, limit));
    },
  };
  return {
    storage,
    getLastGraphQuery: () => lastGraphQuery,
  };
}

function createContext(storage: StorageSlice): Context<unknown> {
  return {
    deps: {
      librarian: {
        getStorage: () => storage,
      },
    },
    signal: new AbortController().signal,
    sessionId: 'semantic-duplicate-test',
  };
}

describe('createSemanticDuplicateDetectorConstruction', () => {
  it('finds semantically equivalent parseAmount-style logic and recommends reuse', async () => {
    const functions: FunctionKnowledge[] = [
      createFunctionKnowledge({
        id: 'src/utils/money.ts:formatCurrency',
        filePath: 'src/utils/money.ts',
        name: 'formatCurrency',
        purpose: 'Parse a currency string into float, strip currency symbols, and handle locale decimal separators.',
      }),
      createFunctionKnowledge({
        id: 'src/shared/finance.ts:amountFromString',
        filePath: 'src/shared/finance.ts',
        name: 'amountFromString',
        purpose: 'Parse currency string to float, strip symbols, and handle locale formats for amount normalization.',
      }),
      createFunctionKnowledge({
        id: 'src/api/stripe/helpers.ts:normalizeAmount',
        filePath: 'src/api/stripe/helpers.ts',
        name: 'normalizeAmount',
        purpose: 'Parse currency string to float and handle locale formats by stripping symbols before conversion.',
      }),
      createFunctionKnowledge({
        id: 'src/ids.ts:generateReference',
        filePath: 'src/ids.ts',
        name: 'generateReference',
        purpose: 'Generate a random payment reference identifier.',
      }),
    ];
    const harness = createStorageHarness(functions);
    const construction = createSemanticDuplicateDetectorConstruction();

    const output = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          intendedDescription: 'parse currency string to float, strip symbols, and handle locale formats',
          threshold: 0.8,
        },
        createContext(harness.storage),
      ),
    );

    expect(output.hasDuplicates).toBe(true);
    expect(output.matches.length).toBe(3);
    expect(output.matches.every((entry) => entry.similarityScore >= 0.8)).toBe(true);
    expect(output.matches.every((entry) => entry.recommendation === 'use_existing' || entry.recommendation === 'extend_existing')).toBe(true);
    expect(output.topMatch?.filePath).toContain('src/');
    expect(output.agentSummary).toMatch(/Top match:/i);
  });

  it('avoids false positives for intentionally distinct behavior', async () => {
    const functions: FunctionKnowledge[] = [
      createFunctionKnowledge({
        id: 'src/utils/money.ts:formatCurrency',
        filePath: 'src/utils/money.ts',
        name: 'formatCurrency',
        purpose: 'Parse a currency string into float and normalize separators.',
      }),
      createFunctionKnowledge({
        id: 'src/ids.ts:generateReference',
        filePath: 'src/ids.ts',
        name: 'generateReference',
        purpose: 'Generate random payment references with collision checks.',
      }),
    ];
    const harness = createStorageHarness(functions);
    const construction = createSemanticDuplicateDetectorConstruction();

    const output = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          intendedDescription: 'generate a random payment reference ID',
          threshold: 0.82,
        },
        createContext(harness.storage),
      ),
    );

    expect(output.hasDuplicates).toBe(false);
    expect(output.matches).toHaveLength(0);
    expect(output.topMatch).toBeNull();
  });

  it('lowers threshold to 0.75 when anticipated callers already call a candidate function', async () => {
    const candidateId = 'src/account/normalizer.ts:canonicalizeEmail';
    const callerId = 'src/account/service.ts:updateAccountEmail';
    const functions: FunctionKnowledge[] = [
      createFunctionKnowledge({
        id: candidateId,
        filePath: 'src/account/normalizer.ts',
        name: 'canonicalizeEmail',
        purpose: 'Normalize email address by trimming whitespace and lowercasing for storage.',
      }),
    ];
    const edges = [createCallEdge(callerId, candidateId)];
    const harness = createStorageHarness(functions, edges);
    const construction = createSemanticDuplicateDetectorConstruction();

    const withoutOverlap = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          intendedDescription: 'normalize email address by trimming whitespace and lowercasing',
          threshold: 0.99,
        },
        createContext(harness.storage),
      ),
    );
    expect(withoutOverlap.matches).toHaveLength(0);

    const withOverlap = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          intendedDescription: 'normalize email address by trimming whitespace and lowercasing',
          threshold: 0.9,
          anticipatedCallers: [callerId],
        },
        createContext(harness.storage),
      ),
    );
    expect(withOverlap.matches.length).toBeGreaterThan(0);
    expect(withOverlap.matches[0]?.hasCallGraphOverlap).toBe(true);
    expect(harness.getLastGraphQuery()?.fromIds).toEqual([callerId]);
    expect(harness.getLastGraphQuery()?.edgeTypes).toEqual(['calls']);
    expect(harness.getLastGraphQuery()?.toIds).toContain(candidateId);
  });

  it('runs under 800ms for 5000 indexed functions', async () => {
    const functions: FunctionKnowledge[] = [];
    for (let i = 0; i < 5000; i += 1) {
      functions.push(
        createFunctionKnowledge({
          id: `src/generated/fn${i}.ts:fn${i}`,
          filePath: `src/generated/fn${i}.ts`,
          name: `fn${i}`,
          purpose: `Compute deterministic transform variant ${i} for generated fixtures.`,
        }),
      );
    }
    functions.push(
      createFunctionKnowledge({
        id: 'src/payments/parse.ts:parsePaymentAmount',
        filePath: 'src/payments/parse.ts',
        name: 'parsePaymentAmount',
        purpose: 'Parse payment amount string into float with currency stripping, locale handling, and normalization.',
      }),
    );

    const harness = createStorageHarness(functions);
    const construction = createSemanticDuplicateDetectorConstruction();
    const started = performance.now();
    const output = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          intendedDescription: 'parse payment amount string into float with currency and locale normalization',
          threshold: 0.8,
        },
        createContext(harness.storage),
      ),
    );
    const durationMs = performance.now() - started;

    expect(output.matches.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(800);
  });
});
