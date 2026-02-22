import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { LibrarianStorage } from '../types.js';

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-exploration-${randomUUID()}.db`);
}

describe('Exploration suggestions storage', () => {
  let storage: LibrarianStorage;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = getTempDbPath();
    storage = createSqliteStorage(dbPath, process.cwd());
    await storage.initialize();
  }, 30000);

  afterEach(async () => {
    await storage?.close();
  }, 30000);

  it('ranks underqueried high-centrality modules above queried peers', async () => {
    const now = new Date().toISOString();
    await storage.setGraphMetrics([
      {
        entityId: 'moduleA',
        entityType: 'module',
        pagerank: 0.95,
        betweenness: 0.93,
        closeness: 0.92,
        eigenvector: 0.94,
        communityId: 1,
        isBridge: true,
        computedAt: now,
      },
      {
        entityId: 'moduleB',
        entityType: 'module',
        pagerank: 0.95,
        betweenness: 0.93,
        closeness: 0.92,
        eigenvector: 0.94,
        communityId: 1,
        isBridge: true,
        computedAt: now,
      },
      {
        entityId: 'moduleC',
        entityType: 'module',
        pagerank: 0.40,
        betweenness: 0.35,
        closeness: 0.38,
        eigenvector: 0.36,
        communityId: 2,
        isBridge: false,
        computedAt: now,
      },
    ]);

    await storage.upsertGraphEdges(
      Array.from({ length: 50 }, (_, index) => ({
        fromId: `fn_dep_A_${index}`,
        fromType: 'function' as const,
        toId: 'moduleA',
        toType: 'module' as const,
        edgeType: 'imports' as const,
        sourceFile: `src/dep_a_${index}.ts`,
        confidence: 1,
        computedAt: new Date(now),
      }))
    );
    await storage.upsertGraphEdges(
      Array.from({ length: 5 }, (_, index) => ({
        fromId: `fn_dep_B_${index}`,
        fromType: 'function' as const,
        toId: 'moduleB',
        toType: 'module' as const,
        edgeType: 'imports' as const,
        sourceFile: `src/dep_b_${index}.ts`,
        confidence: 1,
        computedAt: new Date(now),
      }))
    );

    if (typeof storage.recordQueryAccessLogs !== 'function' || typeof storage.getExplorationSuggestions !== 'function') {
      throw new Error('Exploration access logging APIs are required');
    }

    await storage.recordQueryAccessLogs([
      { entityId: 'moduleB', entityType: 'module', lastQueriedAt: now, queryCount: 10 },
    ]);

    const suggestions = await storage.getExplorationSuggestions({
      entityType: 'module',
      limit: 3,
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(suggestions[0]?.entityId).toBe('moduleA');

    const moduleA = suggestions.find((entry) => entry.entityId === 'moduleA');
    const moduleB = suggestions.find((entry) => entry.entityId === 'moduleB');
    expect(moduleA).toBeDefined();
    expect(moduleB).toBeDefined();
    expect(moduleA?.queryCount).toBe(0);
    expect(moduleB?.queryCount).toBe(10);
    expect((moduleA?.explorationValue ?? 0) > (moduleB?.explorationValue ?? 0)).toBe(true);
    expect(moduleA?.dependentCount).toBe(50);
  });
});
