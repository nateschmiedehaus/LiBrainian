import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';

describe('sqlite lock recovery on initialize', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('recovers stale lock directories before re-trying lock acquisition', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-sqlite-lock-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = `${dbPath}.lock`;

    await fs.writeFile(dbPath, '');
    await fs.mkdir(lockPath, { recursive: true });

    // Older than empty-lock recovery threshold (20s) but not stale for proper-lockfile (15m).
    const aged = new Date(Date.now() - 30_000);
    await fs.utimes(lockPath, aged, aged);

    const storage = createSqliteStorage(dbPath, dir);
    await expect(storage.initialize()).resolves.toBeUndefined();
    await storage.close();

    expect(existsSync(lockPath)).toBe(false);
  });
});
