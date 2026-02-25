import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { FunctionKnowledge } from '../../../types.js';
import type { GraphEdge, GraphEdgeQueryOptions } from '../../../storage/types.js';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createPerformanceRegressionSensorConstruction } from '../performance_regression_sensor.js';

interface MockStorage {
  getFunctions(options?: { limit?: number }): Promise<FunctionKnowledge[]>;
  getGraphEdges(options?: GraphEdgeQueryOptions): Promise<GraphEdge[]>;
}

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'performance-regression-sensor-'));
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
  signature: string;
  purpose?: string;
}): FunctionKnowledge {
  return {
    id: params.id,
    filePath: params.filePath,
    name: params.name,
    signature: params.signature,
    purpose: params.purpose ?? '',
  } as FunctionKnowledge;
}

function createEdge(params: {
  fromId: string;
  toId: string;
}): GraphEdge {
  return {
    fromId: params.fromId,
    fromType: 'function',
    toId: params.toId,
    toType: 'function',
    edgeType: 'calls',
  } as GraphEdge;
}

function createMockStorage(functions: FunctionKnowledge[], edges: GraphEdge[]): MockStorage {
  return {
    async getFunctions(): Promise<FunctionKnowledge[]> {
      return functions;
    },
    async getGraphEdges(options?: GraphEdgeQueryOptions): Promise<GraphEdge[]> {
      let filtered = edges;
      if (options?.toIds && options.toIds.length > 0) {
        const allowed = new Set(options.toIds);
        filtered = filtered.filter((edge) => allowed.has(edge.toId));
      }
      if (options?.fromIds && options.fromIds.length > 0) {
        const allowed = new Set(options.fromIds);
        filtered = filtered.filter((edge) => allowed.has(edge.fromId));
      }
      if (options?.edgeTypes && options.edgeTypes.length > 0) {
        const allowed = new Set(options.edgeTypes);
        filtered = filtered.filter((edge) => allowed.has(edge.edgeType));
      }
      const limit = options?.limit ?? filtered.length;
      return filtered.slice(0, limit);
    },
  };
}

describe('createPerformanceRegressionSensorConstruction', () => {
  it('detects complexity regression from O(log n) to O(n) using diff context', async () => {
    await withTempDir(async (tmpDir) => {
      const sourceDir = path.join(tmpDir, 'src');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, 'search.ts'),
        [
          'type Product = { id: string };',
          '',
          'export function findProductIndex(products: Product[], targetId: string): number {',
          '  for (const product of products) {',
          '    if (product.id === targetId) {',
          '      return 1;',
          '    }',
          '  }',
          '  return -1;',
          '}',
        ].join('\n'),
        'utf8',
      );

      const target = createFunctionKnowledge({
        id: 'src/search.ts:findProductIndex',
        filePath: 'src/search.ts',
        name: 'findProductIndex',
        signature: '(products: Product[], targetId: string) => number',
      });
      const storage = createMockStorage([target], []);

      const diff = [
        'diff --git a/src/search.ts b/src/search.ts',
        'index 1111111..2222222 100644',
        '--- a/src/search.ts',
        '+++ b/src/search.ts',
        '@@ -1,4 +1,9 @@',
        '-export function findProductIndex(products: Product[], targetId: string): number {',
        '-  return binarySearch(products, targetId);',
        '-}',
      ].join('\n');

      const construction = createPerformanceRegressionSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute(
          {
            targets: [target.id],
            diff,
          },
          { deps: { librarian: { workspaceRoot: tmpDir, getStorage: () => storage } } } as never,
        ),
      );

      expect(output.regressions).toHaveLength(1);
      expect(output.regressions[0]?.previousComplexity).toBe('O(log n)');
      expect(output.regressions[0]?.currentComplexity).toBe('O(n)');
    });
  });

  it('marks nested-loop Product[] hot path regressions as critical with inferred impact', async () => {
    await withTempDir(async (tmpDir) => {
      const sourceDir = path.join(tmpDir, 'src', 'catalog');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, 'analysis.ts'),
        [
          'type Product = { id: string; supplier: string };',
          '',
          'export function findSupplierMatches(products: Product[]): number {',
          '  let count = 0;',
          '  for (const product of products) {',
          '    for (const candidate of products) {',
          '      if (product.supplier === candidate.supplier) count += 1;',
          '    }',
          '  }',
          '  return count;',
          '}',
        ].join('\n'),
        'utf8',
      );

      const target = createFunctionKnowledge({
        id: 'src/catalog/analysis.ts:findSupplierMatches',
        filePath: 'src/catalog/analysis.ts',
        name: 'findSupplierMatches',
        signature: '(products: Product[]) => number',
      });
      const caller = createFunctionKnowledge({
        id: 'src/api/products_handler.ts:getProductsHandler',
        filePath: 'src/api/products_handler.ts',
        name: 'getProductsHandler',
        signature: '() => Promise<void>',
      });
      const storage = createMockStorage([target, caller], [
        createEdge({ fromId: caller.id, toId: target.id }),
      ]);

      const diff = [
        'diff --git a/src/catalog/analysis.ts b/src/catalog/analysis.ts',
        'index 1111111..2222222 100644',
        '--- a/src/catalog/analysis.ts',
        '+++ b/src/catalog/analysis.ts',
        '@@ -1,4 +1,11 @@',
        '-export function findSupplierMatches(products: Product[]): number {',
        '-  return products.length;',
        '-}',
      ].join('\n');

      const construction = createPerformanceRegressionSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute(
          {
            targets: [target.id],
            diff,
            inputSizeHints: {
              'Product[]': 50_000,
            },
          },
          { deps: { librarian: { workspaceRoot: tmpDir, getStorage: () => storage } } } as never,
        ),
      );

      expect(output.analyses).toHaveLength(1);
      expect(output.analyses[0]?.severity).toBe('critical');
      expect(output.analyses[0]?.isHotPath).toBe(true);
      expect(output.analyses[0]?.typicalInputSize).toBe(50_000);
      expect(output.analyses[0]?.estimatedImpact).toContain('2,500,000,000');
      expect(output.analyses[0]?.confidence).toBe(0.9);
    });
  });

  it('does not flag bounded constant nested loops as regressions', async () => {
    await withTempDir(async (tmpDir) => {
      const sourceDir = path.join(tmpDir, 'src');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, 'calendar.ts'),
        [
          'export function compareWeekdayWindows(): number {',
          '  let total = 0;',
          '  for (let day = 0; day < 7; day += 1) {',
          '    for (let offset = 0; offset < 7; offset += 1) {',
          '      total += day + offset;',
          '    }',
          '  }',
          '  return total;',
          '}',
        ].join('\n'),
        'utf8',
      );

      const target = createFunctionKnowledge({
        id: 'src/calendar.ts:compareWeekdayWindows',
        filePath: 'src/calendar.ts',
        name: 'compareWeekdayWindows',
        signature: '() => number',
      });
      const storage = createMockStorage([target], []);

      const construction = createPerformanceRegressionSensorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute(
          { targets: [target.id] },
          { deps: { librarian: { workspaceRoot: tmpDir, getStorage: () => storage } } } as never,
        ),
      );

      expect(output.regressions).toHaveLength(0);
      expect(output.analyses[0]?.currentComplexity).toBe('O(1)');
    });
  });

  it('uses medium confidence for semantic-only inferred complexity', async () => {
    const target = createFunctionKnowledge({
      id: 'missing.ts:inferredLinearPass',
      filePath: 'missing.ts',
      name: 'inferredLinearPass',
      signature: '(records: Row[]) => number',
      purpose: 'Iterate over each record and aggregate totals.',
    });
    const storage = createMockStorage([target], []);
    const construction = createPerformanceRegressionSensorConstruction();
    const output = unwrapConstructionExecutionResult(
      await construction.execute(
        { targets: [target.id] },
        { deps: { librarian: { workspaceRoot: '/tmp/nonexistent', getStorage: () => storage } } } as never,
      ),
    );

    expect(output.analyses[0]?.currentComplexity).toBe('O(n)');
    expect(output.analyses[0]?.confidence).toBe(0.6);
  });

  it('runs under 2 seconds per function', async () => {
    await withTempDir(async (tmpDir) => {
      const sourceDir = path.join(tmpDir, 'src');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, 'fast.ts'),
        [
          'export function count(values: number[]): number {',
          '  let total = 0;',
          '  for (const value of values) total += value;',
          '  return total;',
          '}',
        ].join('\n'),
        'utf8',
      );

      const target = createFunctionKnowledge({
        id: 'src/fast.ts:count',
        filePath: 'src/fast.ts',
        name: 'count',
        signature: '(values: number[]) => number',
      });
      const storage = createMockStorage([target], []);
      const construction = createPerformanceRegressionSensorConstruction();

      const startedAt = performance.now();
      unwrapConstructionExecutionResult(
        await construction.execute(
          { targets: [target.id] },
          { deps: { librarian: { workspaceRoot: tmpDir, getStorage: () => storage } } } as never,
        ),
      );
      const durationMs = performance.now() - startedAt;
      expect(durationMs).toBeLessThan(2000);
    });
  });
});
