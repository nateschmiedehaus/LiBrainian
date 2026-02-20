import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createSqliteStorage } from '../sqlite_storage.js';

describe('retrieval confidence log storage', () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (!target) continue;
      await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      await fs.rm(`${target}-wal`, { force: true }).catch(() => {});
      await fs.rm(`${target}-shm`, { force: true }).catch(() => {});
    }
  });

  it('persists and retrieves retrieval confidence log entries', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-retrieval-log-workspace-'));
    const dbPath = path.join(os.tmpdir(), `librarian-retrieval-log-${randomUUID()}.db`);
    tempPaths.push(workspace);
    tempPaths.push(dbPath);

    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();

    await storage.appendRetrievalConfidenceLog({
      queryHash: 'query-hash-1',
      confidenceScore: 0.41,
      retrievalEntropy: 1.76,
      returnedPackIds: ['pack-a', 'pack-b'],
      timestamp: new Date().toISOString(),
      intent: 'find auth implementation',
      fromDepth: 'L1',
      toDepth: 'L2',
      escalationReason: 'entropy_above_2_0',
      attempt: 1,
      maxEscalationDepth: 2,
      routedStrategy: 'graph+vector',
    });

    const logs = await storage.getRetrievalConfidenceLogs({ queryHash: 'query-hash-1', limit: 5 });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.queryHash).toBe('query-hash-1');
    expect(logs[0]?.confidenceScore).toBeCloseTo(0.41, 4);
    expect(logs[0]?.retrievalEntropy).toBeCloseTo(1.76, 4);
    expect(logs[0]?.returnedPackIds).toEqual(['pack-a', 'pack-b']);
    expect(logs[0]?.intent).toBe('find auth implementation');

    await storage.close();
  });
});

