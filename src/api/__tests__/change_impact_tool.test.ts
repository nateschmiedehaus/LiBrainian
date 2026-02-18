import { describe, expect, it, vi } from 'vitest';

import type { LibrarianStorage, KnowledgeGraphEdge } from '../../storage/types.js';
import { computeChangeImpactReport } from '../change_impact_tool.js';

function module(path: string, dependencies: string[] = []): any {
  return {
    id: path,
    path,
    purpose: `module ${path}`,
    exports: [],
    dependencies,
    lastIndexed: new Date().toISOString(),
    checksum: `checksum:${path}`,
  };
}

function edge(sourceId: string, targetId: string, weight: number): KnowledgeGraphEdge {
  return {
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    sourceType: 'file',
    targetType: 'file',
    edgeType: 'co_changed',
    weight,
    confidence: 0.9,
    metadata: { changeCount: Math.round(weight * 10) },
    computedAt: new Date().toISOString(),
  };
}

function createMockStorage(options?: {
  modules?: any[];
  coChanged?: KnowledgeGraphEdge[];
}): LibrarianStorage {
  const modules = options?.modules ?? [];
  const coChanged = options?.coChanged ?? [];

  return {
    getModules: vi.fn().mockResolvedValue(modules),
    getKnowledgeEdges: vi.fn().mockImplementation(async (query?: { sourceId?: string; targetId?: string; edgeType?: string }) => {
      if (query?.edgeType && query.edgeType !== 'co_changed') return [];
      return coChanged.filter((entry) => {
        if (query?.sourceId && entry.sourceId !== query.sourceId) return false;
        if (query?.targetId && entry.targetId !== query.targetId) return false;
        return true;
      });
    }),
  } as unknown as LibrarianStorage;
}

describe('computeChangeImpactReport', () => {
  it('ranks direct dependents before transitive and flags impacted tests', async () => {
    const target = 'src/core/auth.ts';
    const direct = 'src/api/login.ts';
    const transitive = 'src/routes/index.ts';
    const directTest = 'src/api/login.test.ts';

    const storage = createMockStorage({
      modules: [
        module(target),
        module(direct, [target]),
        module(transitive, [direct]),
        module(directTest, [target]),
      ],
      coChanged: [edge(target, transitive, 0.95)],
    });

    const report = await computeChangeImpactReport(storage, {
      target,
      depth: 3,
    });

    expect(report.success).toBe(true);
    expect(report.summary.directCount).toBeGreaterThanOrEqual(2);
    expect(report.summary.transitiveCount).toBeGreaterThanOrEqual(1);

    const directIndex = report.impacted.findIndex((entry) => entry.file === direct);
    const transitiveIndex = report.impacted.findIndex((entry) => entry.file === transitive);

    expect(directIndex).toBeGreaterThanOrEqual(0);
    expect(transitiveIndex).toBeGreaterThanOrEqual(0);
    expect(directIndex).toBeLessThan(transitiveIndex);

    const testEntry = report.impacted.find((entry) => entry.file === directTest);
    expect(testEntry).toBeDefined();
    expect(testEntry?.testCoversChanged).toBe(true);
    expect(testEntry?.reasonFlags).toContain('test_covers_changed');
  });

  it('respects depth cap when collecting impacted files', async () => {
    const target = 'src/core/types.ts';
    const depth1 = 'src/services/user.ts';
    const depth2 = 'src/routes/user.ts';

    const storage = createMockStorage({
      modules: [
        module(target),
        module(depth1, [target]),
        module(depth2, [depth1]),
      ],
    });

    const shallow = await computeChangeImpactReport(storage, { target, depth: 1 });
    const deep = await computeChangeImpactReport(storage, { target, depth: 3 });

    expect(shallow.impacted.some((entry) => entry.file === depth2)).toBe(false);
    expect(deep.impacted.some((entry) => entry.file === depth2)).toBe(true);
  });
});
