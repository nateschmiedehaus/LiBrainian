import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';

describe('retrieval strategy storage', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('records selections, updates rewards, and stays idempotent on duplicate feedback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-strategy-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');

    const storage = createSqliteStorage(dbPath, dir);
    await storage.initialize();
    try {
      expect(typeof storage.recordRetrievalStrategySelection).toBe('function');
      expect(typeof storage.getRetrievalStrategyRewards).toBe('function');
      expect(typeof storage.applyRetrievalStrategyFeedback).toBe('function');

      await storage.recordRetrievalStrategySelection?.({
        queryId: 'fbk_q_1',
        strategyId: 'hybrid',
        intentType: 'debug',
        createdAt: new Date().toISOString(),
      });

      const before = await storage.getRetrievalStrategyRewards?.('debug');
      expect(before?.find((row) => row.strategyId === 'hybrid')?.successCount).toBe(0);
      expect(before?.find((row) => row.strategyId === 'hybrid')?.failureCount).toBe(0);

      const firstUpdate = await storage.applyRetrievalStrategyFeedback?.('fbk_q_1', true, 'success');
      expect(firstUpdate?.successCount).toBe(1);
      expect(firstUpdate?.failureCount).toBe(0);

      const secondUpdate = await storage.applyRetrievalStrategyFeedback?.('fbk_q_1', true, 'success');
      expect(secondUpdate?.successCount).toBe(1);
      expect(secondUpdate?.failureCount).toBe(0);

      const selection = await storage.getRetrievalStrategySelection?.('fbk_q_1');
      expect(selection?.feedbackOutcome).toBe('success');

      const selections = await storage.getRetrievalStrategySelections?.({ intentType: 'debug', limit: 10 });
      expect(selections?.length).toBe(1);
      expect(selections?.[0]?.strategyId).toBe('hybrid');
    } finally {
      await storage.close();
    }
  });
});
