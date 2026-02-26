import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphEdgeQueryOptions, LibrarianStorage } from '../../../storage/types.js';
import type { FunctionKnowledge } from '../../../types.js';
import type { Context } from '../../types.js';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createImpactAwareTestSequencePlannerConstruction } from '../impact_aware_test_sequence_planner.js';

type StorageSlice = Pick<LibrarianStorage, 'getFunctions' | 'getGraphEdges'>;

interface StorageHarness {
  storage: StorageSlice;
}

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'impact-aware-test-sequence-planner-'));
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function createFunctionKnowledge(params: {
  id: string;
  filePath: string;
  name: string;
}): FunctionKnowledge {
  return {
    id: params.id,
    filePath: params.filePath,
    name: params.name,
    signature: `function ${params.name}(): void`,
    purpose: `${params.name} implementation`,
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
    sourceFile: 'src/runtime.ts',
    sourceLine: 1,
    confidence: 1,
    computedAt: new Date(),
  };
}

function createStorageHarness(functions: FunctionKnowledge[], edges: GraphEdge[] = []): StorageHarness {
  const storage: StorageSlice = {
    async getFunctions() {
      return functions;
    },
    async getGraphEdges(options?: GraphEdgeQueryOptions) {
      const requestedFrom = options?.fromIds ? new Set(options.fromIds) : null;
      const requestedTo = options?.toIds ? new Set(options.toIds) : null;
      const requestedTypes = options?.edgeTypes ? new Set(options.edgeTypes) : null;
      const filtered = edges.filter((edge) => {
        if (requestedFrom && !requestedFrom.has(edge.fromId)) return false;
        if (requestedTo && !requestedTo.has(edge.toId)) return false;
        if (requestedTypes && !requestedTypes.has(edge.edgeType)) return false;
        return true;
      });
      const limit = options?.limit ?? filtered.length;
      return filtered.slice(0, Math.max(0, limit));
    },
  };
  return { storage };
}

function createContext(storage: StorageSlice, workspaceRoot: string): Context<unknown> {
  return {
    deps: {
      librarian: {
        workspaceRoot,
        getStorage: () => storage,
      },
    },
    signal: new AbortController().signal,
    sessionId: 'impact-aware-test-sequence-planner-test',
  };
}

describe('createImpactAwareTestSequencePlannerConstruction', () => {
  it('prioritizes smoke and targeted tests for auth/session change intent', async () => {
    await withTempDir(async (tmpDir) => {
      await mkdir(path.join(tmpDir, 'src', 'auth'), { recursive: true });
      await mkdir(path.join(tmpDir, 'tests', 'unit'), { recursive: true });
      await mkdir(path.join(tmpDir, 'tests', 'integration'), { recursive: true });
      await mkdir(path.join(tmpDir, 'tests', 'e2e'), { recursive: true });

      await writeFile(path.join(tmpDir, 'src', 'auth', 'session.ts'), 'export function refreshSession(): void {}', 'utf8');
      await writeFile(path.join(tmpDir, 'tests', 'unit', 'session_refresh.test.ts'), 'test("refresh", () => {})', 'utf8');
      await writeFile(path.join(tmpDir, 'tests', 'integration', 'auth_logout.integration.test.ts'), 'test("logout", () => {})', 'utf8');
      await writeFile(path.join(tmpDir, 'tests', 'e2e', 'login_flow.e2e.test.ts'), 'test("login", () => {})', 'utf8');
      await writeFile(path.join(tmpDir, 'tests', 'unit', 'math_utils.test.ts'), 'test("math", () => {})', 'utf8');

      const construction = createImpactAwareTestSequencePlannerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute(
          {
            intent: 'Users get logged out randomly after idle time',
            changedFiles: ['src/auth/session.ts'],
            workspaceRoot: tmpDir,
            maxInitialTests: 4,
          },
          createContext(createStorageHarness([], []).storage, tmpDir),
        ),
      );

      expect(output.groups.length).toBeGreaterThan(1);
      expect(output.groups[0]?.stage).toBe('smoke');
      expect(output.selectedTests.some((entry) => entry.testPath.includes('session_refresh.test.ts'))).toBe(true);
      expect(output.selectedTests.some((entry) => entry.testPath.includes('auth_logout.integration.test.ts'))).toBe(true);
      expect(output.selectedTests.every((entry) => entry.reason.length > 0)).toBe(true);
      expect(output.confidence).toBeGreaterThan(0.45);
    });
  });

  it('uses transitive call-graph impact to include caller-adjacent tests', async () => {
    const changed = createFunctionKnowledge({
      id: 'src/auth/session.ts:refreshSession',
      filePath: 'src/auth/session.ts',
      name: 'refreshSession',
    });
    const caller = createFunctionKnowledge({
      id: 'src/api/auth_controller.ts:handleRefresh',
      filePath: 'src/api/auth_controller.ts',
      name: 'handleRefresh',
    });
    const harness = createStorageHarness([changed, caller], [createCallEdge(caller.id, changed.id)]);

    const construction = createImpactAwareTestSequencePlannerConstruction();
    const output = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          changedFiles: ['src/auth/session.ts'],
          changedFunctions: [changed.id],
          availableTests: [
            'tests/integration/auth_controller.test.ts',
            'tests/unit/date_format.test.ts',
          ],
        },
        createContext(harness.storage, process.cwd()),
      ),
    );

    expect(output.impactedFiles).toContain('src/api/auth_controller.ts');
    expect(output.selectedTests.some((entry) => entry.testPath.includes('auth_controller.test.ts'))).toBe(true);
  });

  it('adds fallback escalation stage when confidence is low', async () => {
    const construction = createImpactAwareTestSequencePlannerConstruction();
    const output = unwrapConstructionExecutionResult(
      await construction.execute(
        {
          changedFiles: ['src/infra/queue.ts'],
          availableTests: ['tests/unit/date_format.test.ts'],
          includeFallbackSuite: true,
          confidenceThresholdForFallback: 0.8,
        },
        createContext(createStorageHarness([], []).storage, process.cwd()),
      ),
    );

    expect(output.confidence).toBeLessThan(0.8);
    expect(output.groups.some((group) => group.stage === 'fallback')).toBe(true);
    expect(output.escalationPolicy.enabled).toBe(true);
    expect(output.escalationPolicy.reason).toMatch(/low_confidence|no_targeted_tests|failure/);
  });
});
