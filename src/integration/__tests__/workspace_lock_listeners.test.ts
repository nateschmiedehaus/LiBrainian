import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireWorkspaceLock } from '../workspace_lock.js';

describe('workspace_lock signal handler registration', () => {
  const handles: Array<{ release: () => Promise<void>; dir: string }> = [];
  const baseCounts: Record<string, number> = {};

  beforeEach(() => {
    baseCounts.SIGINT = process.listenerCount('SIGINT');
    baseCounts.SIGTERM = process.listenerCount('SIGTERM');
    baseCounts.exit = process.listenerCount('exit');
  });

  afterEach(async () => {
    await Promise.all(handles.map(async (h) => h.release().catch(() => undefined)));
    await Promise.all(handles.map(async (h) => fs.rm(h.dir, { recursive: true, force: true }).catch(() => undefined)));
    handles.length = 0;
  });

  it('does not add unbounded SIGINT/SIGTERM listeners for many workspaces', async () => {
    const roots = await Promise.all(
      Array.from({ length: 12 }, async () => fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ws-lock-')))
    );

    for (const root of roots) {
      // eslint-disable-next-line no-await-in-loop
      const handle = await acquireWorkspaceLock(root);
      handles.push({ release: handle.release, dir: root });
    }

    // The implementation should register at most one global handler per signal.
    expect(process.listenerCount('SIGINT')).toBeLessThanOrEqual(baseCounts.SIGINT + 1);
    expect(process.listenerCount('SIGTERM')).toBeLessThanOrEqual(baseCounts.SIGTERM + 1);
    expect(process.listenerCount('exit')).toBeLessThanOrEqual(baseCounts.exit + 1);
  });

  it('fails closed when an existing lock file is corrupt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ws-lock-corrupt-'));
    handles.push({ release: async () => undefined, dir: root });
    const lockPath = path.join(root, '.librarian', 'bootstrap.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, '{corrupt', 'utf8');

    await expect(acquireWorkspaceLock(root, {
      timeoutMs: 20,
      pollIntervalMs: 5,
    })).rejects.toThrow(/bootstrap lock exists but is corrupt/i);
    await expect(fs.readFile(lockPath, 'utf8')).resolves.toBe('{corrupt');
  });
});
