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

  it('recovers malformed sqlite files during initialize by quarantining and recreating storage', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-sqlite-lock-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');

    await fs.writeFile(dbPath, 'not-a-valid-sqlite-db');
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const storage = createSqliteStorage(dbPath, dir);
    await expect(storage.initialize()).resolves.toBeUndefined();
    await expect(storage.getVersion()).resolves.toBeNull();

    const entries = await fs.readdir(dir);
    expect(entries.some((entry) => entry.startsWith('librarian.sqlite.corrupt.'))).toBe(true);

    await storage.close();
  });

  it('uses a PID lock file instead of a heartbeat lock directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-sqlite-lock-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = `${dbPath}.lock`;

    const storage = createSqliteStorage(dbPath, dir);
    await storage.initialize();

    const stats = await fs.stat(lockPath);
    expect(stats.isFile()).toBe(true);

    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: number; startedAt?: string; processStartedAt?: string };
    expect(parsed.pid).toBe(process.pid);
    expect(typeof parsed.startedAt).toBe('string');
    expect(typeof parsed.processStartedAt).toBe('string');

    await storage.close();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('fails with explicit indexing-in-progress details when lock owner is active', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-sqlite-lock-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = `${dbPath}.lock`;

    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        processStartedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
      }, null, 2),
      'utf8',
    );

    const storage = createSqliteStorage(dbPath, dir);
    await expect(storage.initialize()).rejects.toThrow(/storage_locked:\s*indexing in progress/i);
  });

  it('allows lock-free readers while another process lock owner is active', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-sqlite-lock-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = `${dbPath}.lock`;

    const writer = createSqliteStorage(dbPath, dir);
    await writer.initialize();
    expect(existsSync(lockPath)).toBe(true);

    const reader = createSqliteStorage(dbPath, dir, { useProcessLock: false });
    await expect(reader.initialize()).resolves.toBeUndefined();
    await expect(reader.getVersion()).resolves.toBeNull();

    await reader.close();
    expect(existsSync(lockPath)).toBe(true);

    await writer.close();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('allows concurrent :memory: storages without lock contention', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-sqlite-lock-'));
    tempDirs.push(dir);

    const storageA = createSqliteStorage(':memory:', dir);
    const storageB = createSqliteStorage(':memory:', dir);

    await expect(Promise.all([storageA.initialize(), storageB.initialize()])).resolves.toEqual([undefined, undefined]);

    await storageA.close();
    await storageB.close();
  });
});
