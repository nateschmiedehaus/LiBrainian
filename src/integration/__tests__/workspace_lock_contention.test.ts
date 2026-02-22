import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireWorkspaceLock } from '../workspace_lock.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-lock-contention-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.librarian'), { recursive: true });
  return root;
}

describe('workspace lock contention handling', () => {
  it('reclaims stale lock files for dead processes', async () => {
    const workspace = await createWorkspace();
    const lockPath = path.join(workspace, '.librarian', 'bootstrap.lock');
    await fs.writeFile(lockPath, JSON.stringify({
      pid: 999_999_999,
      startedAt: '2026-02-22T00:00:00.000Z',
    }), 'utf8');

    const handle = await acquireWorkspaceLock(workspace, { timeoutMs: 500, pollIntervalMs: 5 });
    try {
      expect(handle.state.pid).toBe(process.pid);
      const persisted = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { pid: number };
      expect(persisted.pid).toBe(process.pid);
    } finally {
      await handle.release();
    }
  });

  it('fails closed with lease_conflict when another live process owns the lock', async () => {
    const workspace = await createWorkspace();
    const lockPath = path.join(workspace, '.librarian', 'bootstrap.lock');
    await fs.writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }), 'utf8');

    await expect(
      acquireWorkspaceLock(workspace, { timeoutMs: 60, pollIntervalMs: 10 })
    ).rejects.toThrow(/lease_conflict/);
  });
});
