import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BootstrapReport } from '../../types.js';
import { createSqliteStorage } from '../sqlite_storage.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('bootstrap history persistence', () => {
  it('stores synthesis availability metadata alongside bootstrap reports', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bootstrap-history-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const storage = createSqliteStorage(dbPath, dir);
    await storage.initialize();

    const synthesis = {
      synthesisMode: 'structural-only' as const,
      synthesisUnavailableReason: 'Nested Claude session',
    };
    const now = new Date();
    const report: BootstrapReport = {
      workspace: dir,
      startedAt: now,
      completedAt: now,
      phases: [],
      totalFilesProcessed: 0,
      totalFunctionsIndexed: 0,
      totalContextPacksCreated: 0,
      version: {
        major: 0,
        minor: 0,
        patch: 0,
        string: '0.0.0-test',
        qualityTier: 'mvp',
        indexedAt: now,
        indexerVersion: '0.0.0-test',
        features: [],
      },
      success: true,
      synthesis,
    };

    await storage.recordBootstrapReport(report);
    const stored = await storage.getLastBootstrapReport();

    expect(stored?.synthesis).toEqual(synthesis);

    await storage.close();
  });
});
