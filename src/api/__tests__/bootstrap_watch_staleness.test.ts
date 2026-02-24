import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarianStorage } from '../../storage/types.js';

vi.mock('../versioning.js', () => ({
  detectLibrarianVersion: vi.fn(),
  upgradeRequired: vi.fn(),
  runUpgrade: vi.fn(),
}));

vi.mock('../../utils/git.js', () => ({
  getCurrentGitSha: vi.fn(),
  getGitCommitRelation: vi.fn(() => 'indexed_ancestor'),
}));

vi.mock('../../state/watch_state.js', () => ({
  getWatchState: vi.fn(),
  updateWatchState: vi.fn(),
}));

function createStorageStub(): LibrarianStorage {
  return {
    getMetadata: vi.fn().mockResolvedValue({ lastIndexing: '2026-02-18T00:00:00.000Z' }),
    getStats: vi.fn().mockResolvedValue({
      totalFunctions: 1,
      totalModules: 1,
      totalContextPacks: 1,
      totalEmbeddings: 1,
    }),
    getLastBootstrapReport: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as LibrarianStorage;
}

describe('isBootstrapRequired watch freshness checks', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { detectLibrarianVersion, upgradeRequired } = await import('../versioning.js');
    vi.mocked(detectLibrarianVersion).mockResolvedValue({ qualityTier: 'full' } as never);
    vi.mocked(upgradeRequired).mockResolvedValue({ required: false, reason: 'up-to-date' });
  });

  it('requires bootstrap when git cursor lags HEAD and marks catch-up', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState, updateWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha, getGitCommitRelation } = await import('../../utils/git.js');

    vi.mocked(getWatchState).mockResolvedValue({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    });
    vi.mocked(updateWatchState).mockImplementation(async (_storage, updater) => updater({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    }));
    vi.mocked(getCurrentGitSha).mockReturnValue('def456');
    vi.mocked(getGitCommitRelation).mockReturnValue('indexed_ancestor');

    const result = await isBootstrapRequired('/tmp/workspace', createStorageStub());

    expect(result.required).toBe(true);
    expect(result.reason).toContain('Index is stale relative to git HEAD');
    expect(result.reason).toContain('new commits detected on current lineage');
    expect(result.reason).toContain('Run `librarian bootstrap');
    expect(vi.mocked(updateWatchState)).toHaveBeenCalledTimes(1);
  });

  it('surfaces force remediation when HEAD moves behind indexed commit', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState, updateWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha, getGitCommitRelation } = await import('../../utils/git.js');

    vi.mocked(getWatchState).mockResolvedValue({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    });
    vi.mocked(updateWatchState).mockImplementation(async (_storage, updater) => updater({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    }));
    vi.mocked(getCurrentGitSha).mockReturnValue('def456');
    vi.mocked(getGitCommitRelation).mockReturnValue('head_ancestor');

    const result = await isBootstrapRequired('/tmp/workspace', createStorageStub());

    expect(result.required).toBe(true);
    expect(result.reason).toContain('branch/reset moved HEAD behind indexed commit');
    expect(result.reason).toContain('bootstrap --force');
    expect(vi.mocked(updateWatchState)).toHaveBeenCalledTimes(1);
  });

  it('surfaces rewritten-history remediation when branches diverge', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState, updateWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha, getGitCommitRelation } = await import('../../utils/git.js');

    vi.mocked(getWatchState).mockResolvedValue({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    });
    vi.mocked(updateWatchState).mockImplementation(async (_storage, updater) => updater({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    }));
    vi.mocked(getCurrentGitSha).mockReturnValue('def456');
    vi.mocked(getGitCommitRelation).mockReturnValue('diverged');

    const result = await isBootstrapRequired('/tmp/workspace', createStorageStub());

    expect(result.required).toBe(true);
    expect(result.reason).toContain('history diverged (rebase/rewrite/switch)');
    expect(result.reason).toContain('bootstrap --force');
    expect(vi.mocked(updateWatchState)).toHaveBeenCalledTimes(1);
  });

  it('requires bootstrap when watch state already needs catch-up', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha } = await import('../../utils/git.js');

    vi.mocked(getWatchState).mockResolvedValue({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: true,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    });
    vi.mocked(getCurrentGitSha).mockReturnValue('abc123');

    const result = await isBootstrapRequired('/tmp/workspace', createStorageStub());

    expect(result.required).toBe(true);
    expect(result.reason).toContain('catch-up is required');
  });

  it('does not require bootstrap when git cursor is current', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState, updateWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha } = await import('../../utils/git.js');

    vi.mocked(getWatchState).mockResolvedValue({
      schema_version: 1,
      workspace_root: '/tmp/workspace',
      needs_catchup: false,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    });
    vi.mocked(getCurrentGitSha).mockReturnValue('abc123');

    const result = await isBootstrapRequired('/tmp/workspace', createStorageStub());

    expect(result.required).toBe(false);
    expect(result.reason).toBe('Librarian data is up-to-date');
    expect(vi.mocked(updateWatchState)).not.toHaveBeenCalled();
  });

  it('requires bootstrap when cross-database consistency marker is in progress', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha } = await import('../../utils/git.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-consistency-inprogress-'));
    const librarianDir = path.join(workspace, '.librarian');
    const nowIso = new Date().toISOString();

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(
        path.join(librarianDir, 'bootstrap_consistency.json'),
        JSON.stringify({
          kind: 'BootstrapConsistencyState.v1',
          schema_version: 1,
          workspace,
          generation_id: 'gen-test',
          status: 'in_progress',
          started_at: nowIso,
          updated_at: nowIso,
          artifacts: {
            librarian: { path: path.join(librarianDir, 'librarian.sqlite'), exists: false },
            knowledge: { path: path.join(librarianDir, 'knowledge.db'), exists: false },
            evidence: { path: path.join(librarianDir, 'evidence_ledger.db'), exists: false },
          },
        }),
        'utf8',
      );

      vi.mocked(getWatchState).mockResolvedValue(null as never);
      vi.mocked(getCurrentGitSha).mockReturnValue(undefined);

      const result = await isBootstrapRequired(workspace, createStorageStub());
      expect(result.required).toBe(true);
      expect(result.reason).toContain('consistency marker');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('requires bootstrap when consistency marker expects missing artifact', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha } = await import('../../utils/git.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-consistency-missing-artifact-'));
    const librarianDir = path.join(workspace, '.librarian');
    const nowIso = new Date().toISOString();
    const existingDb = path.join(librarianDir, 'librarian.sqlite');
    const missingDb = path.join(librarianDir, 'knowledge.db');
    const evidenceDb = path.join(librarianDir, 'evidence_ledger.db');

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(existingDb, '', 'utf8');
      await fs.writeFile(evidenceDb, '', 'utf8');
      await fs.writeFile(
        path.join(librarianDir, 'bootstrap_consistency.json'),
        JSON.stringify({
          kind: 'BootstrapConsistencyState.v1',
          schema_version: 1,
          workspace,
          generation_id: 'gen-test',
          status: 'complete',
          started_at: nowIso,
          updated_at: nowIso,
          completed_at: nowIso,
          artifacts: {
            librarian: { path: existingDb, exists: true },
            knowledge: { path: missingDb, exists: true },
            evidence: { path: evidenceDb, exists: true },
          },
        }),
        'utf8',
      );

      vi.mocked(getWatchState).mockResolvedValue(null as never);
      vi.mocked(getCurrentGitSha).mockReturnValue(undefined);

      const result = await isBootstrapRequired(workspace, createStorageStub());
      expect(result.required).toBe(true);
      expect(result.reason).toContain('Bootstrap artifacts missing');
      expect(result.reason).toContain('knowledge.db');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
