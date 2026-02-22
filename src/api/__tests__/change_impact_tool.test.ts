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
  knowledgeEdges?: KnowledgeGraphEdge[];
}): LibrarianStorage {
  const modules = options?.modules ?? [];
  const coChanged = options?.coChanged ?? [];
  const knowledgeEdges = options?.knowledgeEdges ?? [];
  const allEdges = [...coChanged, ...knowledgeEdges];

  return {
    getModules: vi.fn().mockResolvedValue(modules),
    getKnowledgeEdges: vi.fn().mockImplementation(async (query?: { sourceId?: string; targetId?: string; edgeType?: string }) => {
      return allEdges.filter((entry) => {
        if (query?.edgeType && entry.edgeType !== query.edgeType) return false;
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

  it('includes schema-linked endpoint entities in blast radius', async () => {
    const openapiSpec = 'specs/openapi.yaml';
    const schemaId = 'schema:UserResponse';
    const endpointId = 'endpoint:GET /users/{id}';

    const storage = createMockStorage({
      modules: [module(openapiSpec)],
      knowledgeEdges: [
        {
          id: 'schema-to-spec',
          sourceId: schemaId,
          targetId: openapiSpec,
          sourceType: 'graphql_type',
          targetType: 'file',
          edgeType: 'part_of',
          weight: 1,
          confidence: 0.95,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'endpoint-returns-schema',
          sourceId: endpointId,
          targetId: schemaId,
          sourceType: 'endpoint',
          targetType: 'graphql_type',
          edgeType: 'returns_schema',
          weight: 1,
          confidence: 0.95,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ],
    });

    const report = await computeChangeImpactReport(storage, {
      target: openapiSpec,
      depth: 3,
    });

    expect(report.success).toBe(true);
    expect(report.impacted.some((entry) => entry.file === endpointId)).toBe(true);
  });
});
