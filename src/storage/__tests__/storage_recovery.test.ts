import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  attemptStorageRecovery,
  cleanupWorkspaceLocks,
  inspectWorkspaceLocks,
  isRecoverableStorageError,
} from '../storage_recovery.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'librarian-storage-recovery-'));
}

describe('attemptStorageRecovery', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('removes stale lock and WAL/SHM files when pid is not alive', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    await fs.writeFile(dbPath, '');
    await fs.writeFile(dbPath + '.lock', JSON.stringify({ pid: 999999 }));
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath);

    expect(result.recovered).toBe(true);
    expect(existsSync(dbPath + '.lock')).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);
  });

  it('does not remove active lock files', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    await fs.writeFile(dbPath, '');
    await fs.writeFile(dbPath + '.lock', JSON.stringify({ pid: process.pid }));
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath);

    expect(result.recovered).toBe(false);
    expect(existsSync(dbPath + '.lock')).toBe(true);
  });

  it('removes stale lock directories from proper-lockfile', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = dbPath + '.lock';
    await fs.writeFile(dbPath, '');
    await fs.mkdir(lockPath, { recursive: true });
    const staleDate = new Date(Date.now() - (3 * 60_000));
    await fs.utimes(lockPath, staleDate, staleDate);
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath);

    expect(result.recovered).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);
  });

  it('removes empty lock directories after the short empty-dir timeout', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = dbPath + '.lock';
    await fs.writeFile(dbPath, '');
    await fs.mkdir(lockPath, { recursive: true });
    const staleDate = new Date(Date.now() - 30_000);
    await fs.utimes(lockPath, staleDate, staleDate);
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath);

    expect(result.recovered).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);
  });

  it('does not claim recovery when lock directory is still fresh', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = dbPath + '.lock';
    await fs.writeFile(dbPath, '');
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath);

    expect(result.recovered).toBe(false);
    expect(existsSync(lockPath)).toBe(true);
    expect(existsSync(dbPath + '-wal')).toBe(true);
    expect(existsSync(dbPath + '-shm')).toBe(true);
  });

  it('removes unknown-pid lock files once they age past the quick recovery threshold', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    const lockPath = dbPath + '.lock';
    await fs.writeFile(dbPath, '');
    await fs.writeFile(lockPath, 'not-json-pid');
    const staleDate = new Date(Date.now() - 10_000);
    await fs.utimes(lockPath, staleDate, staleDate);
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath);

    expect(result.recovered).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);
  });

  it('treats malformed database errors as recoverable', () => {
    expect(isRecoverableStorageError(new Error('database disk image is malformed'))).toBe(true);
    expect(isRecoverableStorageError(new Error('SQLITE_CORRUPT: file is not a database'))).toBe(true);
  });

  it('quarantines corrupt db file during recovery', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    await fs.writeFile(dbPath, 'not-a-valid-sqlite-db');
    await fs.writeFile(dbPath + '-wal', 'wal');
    await fs.writeFile(dbPath + '-shm', 'shm');

    const result = await attemptStorageRecovery(dbPath, {
      error: new Error('database disk image is malformed'),
    });

    expect(result.recovered).toBe(true);
    expect(result.actions).toContain('quarantined_corrupt_db');
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);

    const entries = await fs.readdir(dir);
    expect(entries.some((entry) => entry.startsWith('librarian.sqlite.corrupt.'))).toBe(true);
  });

  it('deduplicates repeated no-action recovery warnings for the same lock state', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'librarian.sqlite');
    await fs.writeFile(dbPath, '');
    await fs.writeFile(dbPath + '.lock', JSON.stringify({ pid: process.pid }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previousLevel = process.env.LIBRARIAN_LOG_LEVEL;
    process.env.LIBRARIAN_LOG_LEVEL = 'warn';
    try {
      await attemptStorageRecovery(dbPath);
      await attemptStorageRecovery(dbPath);

      const noActionWarnings = warnSpy.mock.calls.filter(([message]) =>
        String(message).includes('[storage-recovery] no recovery actions applied')
      );
      expect(noActionWarnings).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
      if (previousLevel === undefined) {
        delete process.env.LIBRARIAN_LOG_LEVEL;
      } else {
        process.env.LIBRARIAN_LOG_LEVEL = previousLevel;
      }
    }
  });

  it('detects stale lock files under .librarian/locks and .librarian/swarm/locks', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const lockDir = path.join(dir, '.librarian', 'locks');
    const swarmLockDir = path.join(dir, '.librarian', 'swarm', 'locks');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.mkdir(swarmLockDir, { recursive: true });

    const stalePath = path.join(lockDir, 'stale.lock');
    const freshPath = path.join(swarmLockDir, 'fresh.lock');
    await fs.writeFile(stalePath, 'stale');
    await fs.writeFile(freshPath, String(process.pid));

    const staleDate = new Date(Date.now() - (3 * 60 * 60_000));
    await fs.utimes(stalePath, staleDate, staleDate);

    const inspection = await inspectWorkspaceLocks(dir);

    expect(inspection.scannedFiles).toBe(2);
    expect(inspection.staleFiles).toBe(1);
    expect(inspection.activePidFiles).toBe(1);
    expect(inspection.stalePaths).toContain(stalePath);
  });

  it('removes stale workspace lock files during cleanup', async () => {
    const dir = await createTempDir();
    tempDirs.push(dir);
    const lockDir = path.join(dir, '.librarian', 'locks');
    await fs.mkdir(lockDir, { recursive: true });

    const stalePath = path.join(lockDir, 'dead.lock');
    await fs.writeFile(stalePath, JSON.stringify({ pid: 999999 }));

    const result = await cleanupWorkspaceLocks(dir);

    expect(result.removedFiles).toBe(1);
    expect(result.staleFiles).toBe(1);
    expect(existsSync(stalePath)).toBe(false);
  });
});
