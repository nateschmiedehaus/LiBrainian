import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarianStorage } from '../../storage/types.js';

vi.mock('../versioning.js', () => ({
  detectLibrarianVersion: vi.fn(),
  upgradeRequired: vi.fn(),
  runUpgrade: vi.fn(),
}));

vi.mock('../../utils/git.js', () => ({
  getCurrentGitSha: vi.fn(),
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
    const { getCurrentGitSha } = await import('../../utils/git.js');

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

    const result = await isBootstrapRequired('/tmp/workspace', createStorageStub());

    expect(result.required).toBe(true);
    expect(result.reason).toContain('Index is stale relative to git HEAD');
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
});
