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

  it('marks catch-up but keeps the current index queryable when git cursor lags HEAD', async () => {
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

    expect(result.required).toBe(false);
    expect(result.reason).toContain('usable but stale relative to git HEAD');
    expect(result.reason).toContain('new commits detected on current lineage');
    expect(vi.mocked(updateWatchState)).toHaveBeenCalledTimes(1);
  });

  it('keeps the current index queryable when HEAD moves behind indexed commit', async () => {
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

    expect(result.required).toBe(false);
    expect(result.reason).toContain('usable but stale relative to git HEAD');
    expect(result.reason).toContain('branch/reset moved HEAD behind indexed commit');
    expect(vi.mocked(updateWatchState)).toHaveBeenCalledTimes(1);
  });

  it('keeps the current index queryable when branches diverge', async () => {
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

    expect(result.required).toBe(false);
    expect(result.reason).toContain('usable but stale relative to git HEAD');
    expect(result.reason).toContain('history diverged (rebase/rewrite/switch)');
    expect(vi.mocked(updateWatchState)).toHaveBeenCalledTimes(1);
  });

  it('keeps the current index queryable when watch state already needs catch-up', async () => {
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

    expect(result.required).toBe(false);
    expect(result.reason).toContain('usable but stale');
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
      await fs.writeFile(path.join(librarianDir, 'librarian.sqlite'), '', 'utf8');
      await fs.writeFile(path.join(librarianDir, 'knowledge.db'), '', 'utf8');
      await fs.writeFile(path.join(librarianDir, 'evidence_ledger.db'), '', 'utf8');
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

  it('requires bootstrap when consistency snapshot shows an effectively empty librarian.sqlite', async () => {
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { getWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha } = await import('../../utils/git.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-consistency-skew-'));
    const librarianDir = path.join(workspace, '.librarian');
    const nowIso = new Date().toISOString();

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(path.join(librarianDir, 'librarian.sqlite'), '', 'utf8');
      await fs.writeFile(path.join(librarianDir, 'knowledge.db'), '', 'utf8');
      await fs.writeFile(path.join(librarianDir, 'evidence_ledger.db'), '', 'utf8');
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
            librarian: { path: path.join(librarianDir, 'librarian.sqlite'), exists: true, size_bytes: 4096 },
            knowledge: { path: path.join(librarianDir, 'knowledge.db'), exists: true, size_bytes: 64000 },
            evidence: { path: path.join(librarianDir, 'evidence_ledger.db'), exists: true, size_bytes: 64000 },
          },
        }),
        'utf8',
      );

      vi.mocked(getWatchState).mockResolvedValue(null as never);
      vi.mocked(getCurrentGitSha).mockReturnValue(undefined);

      const result = await isBootstrapRequired(workspace, createStorageStub());
      expect(result.required).toBe(true);
      expect(result.reason).toContain('effectively empty');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('clears restored failure markers when a usable index snapshot was recovered', async () => {
    const { isBootstrapRequired, __testing } = await import('../bootstrap.js');
    const { getWatchState } = await import('../../state/watch_state.js');
    const { getCurrentGitSha } = await import('../../utils/git.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-restored-bootstrap-state-'));
    const librarianDir = path.join(workspace, '.librarian');
    const nowIso = new Date().toISOString();
    const completedIso = new Date(Date.now() - 60_000).toISOString();
    const storage = createStorageStub() as unknown as {
      getLastBootstrapReport: ReturnType<typeof vi.fn>;
      getStats: ReturnType<typeof vi.fn>;
      getMetadata: ReturnType<typeof vi.fn>;
    };

    storage.getLastBootstrapReport = vi.fn().mockResolvedValue({ success: true, completedAt: new Date(completedIso) });
    storage.getStats = vi.fn().mockResolvedValue({
      totalFunctions: 12,
      totalModules: 3,
      totalContextPacks: 8,
      totalEmbeddings: 12,
    });
    storage.getMetadata = vi.fn().mockResolvedValue({ lastIndexing: completedIso });

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(path.join(librarianDir, 'librarian.sqlite'), 'ok', 'utf8');
      await fs.writeFile(path.join(librarianDir, 'knowledge.db'), 'ok', 'utf8');
      await fs.writeFile(path.join(librarianDir, 'evidence_ledger.db'), 'ok', 'utf8');
      await fs.writeFile(
        path.join(librarianDir, 'bootstrap_state.json'),
        JSON.stringify({
          kind: 'BootstrapRecoveryState.v1',
          schema_version: 1,
          workspace,
          version: '2.0.0',
          phase_index: 1,
          phase_name: 'semantic_indexing',
          total_phases: 5,
          started_at: nowIso,
          updated_at: nowIso,
          last_error: 'semantic indexing failed after restore',
        }),
        'utf8',
      );
      await fs.writeFile(
        path.join(librarianDir, 'bootstrap_consistency.json'),
        JSON.stringify({
          kind: 'BootstrapConsistencyState.v1',
          schema_version: 1,
          workspace,
          generation_id: 'gen-test',
          status: 'failed',
          started_at: nowIso,
          updated_at: nowIso,
          completed_at: nowIso,
          artifacts: {
            librarian: { path: path.join(librarianDir, 'librarian.sqlite'), exists: true, size_bytes: 65536 },
            knowledge: { path: path.join(librarianDir, 'knowledge.db'), exists: true, size_bytes: 65536 },
            evidence: { path: path.join(librarianDir, 'evidence_ledger.db'), exists: true, size_bytes: 65536 },
          },
          last_error: 'bootstrap_failed_restored_previous_state: semantic indexing failed',
        }),
        'utf8',
      );

      vi.mocked(getWatchState).mockResolvedValue({
        schema_version: 1,
        workspace_root: workspace,
        needs_catchup: false,
        cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
      });
      vi.mocked(getCurrentGitSha).mockReturnValue('abc123');

      const result = await isBootstrapRequired(workspace, storage as unknown as LibrarianStorage);

      expect(result.required).toBe(false);
      expect(result.reason).toBe('Librarian data is up-to-date');
      await expect(fs.access(path.join(librarianDir, 'bootstrap_state.json'))).rejects.toThrow();
      const consistencyRaw = await fs.readFile(__testing.bootstrapConsistencyPath(workspace), 'utf8');
      const consistency = JSON.parse(consistencyRaw) as { status: string; last_error?: string };
      expect(consistency.status).toBe('complete');
      expect(consistency.last_error).toBeUndefined();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
