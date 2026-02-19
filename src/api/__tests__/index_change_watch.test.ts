import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { watchPaths } from '../index_change_watch.js';

async function nextWithTimeout<T>(
  promise: Promise<IteratorResult<T>>,
  timeoutMs: number
): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout_${timeoutMs}`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

describe('watchPaths', () => {
  let storage: LibrarianStorage;
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'librarian-watch-paths-'));
    dbPath = join(testDir, 'test.db');
    storage = createSqliteStorage(dbPath, testDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('emits matching change event within 500ms', async () => {
    const baseVersion = await storage.getIndexCoordinationVersion();
    const stream = watchPaths({
      storage,
      paths: ['src/auth/**'],
      sinceVersion: baseVersion,
      pollIntervalMs: 20,
    });

    const startedAt = Date.now();
    const nextPromise = nextWithTimeout(stream.next(), 500);

    await storage.transaction(async (tx) => {
      await tx.setFileChecksum('src/auth/middleware.ts', 'checksum-1');
    });

    const result = await nextPromise;
    await stream.return?.();

    expect(result.done).toBe(false);
    expect(result.value.path).toBe('src/auth/middleware.ts');
    expect(Date.now() - startedAt).toBeLessThanOrEqual(500);
  });
});
