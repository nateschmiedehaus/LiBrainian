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
});

