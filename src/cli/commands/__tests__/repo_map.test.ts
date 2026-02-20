import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repoMapCommand } from '../repo_map.js';
import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { generateRepoMap } from '../../../api/repo_map.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));

vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));

vi.mock('../../../api/repo_map.js', () => ({
  generateRepoMap: vi.fn(),
}));

describe('repoMapCommand', () => {
  const workspace = '/tmp/workspace';
  let logSpy: ReturnType<typeof vi.spyOn>;
  const mockStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(resolveDbPath).mockResolvedValue('/tmp/workspace/.librarian/librarian.sqlite');
    vi.mocked(createSqliteStorage).mockReturnValue(mockStorage as any);
    vi.mocked(generateRepoMap).mockResolvedValue({
      workspaceRoot: workspace,
      generatedAt: '2026-02-20T00:00:00.000Z',
      style: 'json',
      maxTokens: 500,
      consumedTokens: 200,
      entries: [],
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('emits JSON output when --json is provided', async () => {
    await repoMapCommand({
      workspace,
      args: [],
      rawArgs: ['repo-map', '--json', '--max-tokens', '500', '--focus', 'src/api,src/auth'],
    });

    expect(generateRepoMap).toHaveBeenCalledWith(
      mockStorage,
      workspace,
      expect.objectContaining({
        style: 'json',
        maxTokens: 500,
        focus: ['src/api', 'src/auth'],
      }),
    );
    const payload = String(logSpy.mock.calls[0]?.[0] ?? '');
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(mockStorage.close).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid style values', async () => {
    await expect(repoMapCommand({
      workspace,
      args: [],
      rawArgs: ['repo-map', '--style', 'broken'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('prints a clear notice when repo-map has no entries', async () => {
    vi.mocked(generateRepoMap).mockResolvedValue({
      workspaceRoot: workspace,
      generatedAt: '2026-02-20T00:00:00.000Z',
      style: 'compact',
      maxTokens: 500,
      consumedTokens: 0,
      entries: [],
      text: 'No files indexed. Run `librarian bootstrap` first.',
      notice: 'No files indexed. Run `librarian bootstrap` first.',
    });

    await repoMapCommand({
      workspace,
      args: [],
      rawArgs: ['repo-map'],
    });

    expect(logSpy.mock.calls[0]?.[0]).toContain('No files indexed');
  });
});
