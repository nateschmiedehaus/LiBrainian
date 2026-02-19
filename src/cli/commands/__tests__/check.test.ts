import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { execSync } from 'node:child_process';
import { checkCommand } from '../check.js';
import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { isBootstrapRequired } from '../../../api/bootstrap.js';
import { getGitDiffNames, getGitStatusChanges, isGitRepo } from '../../../utils/git.js';
import type { LibrarianStorage } from '../../../storage/types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));
vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));
vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));
vi.mock('../../../api/bootstrap.js', () => ({
  isBootstrapRequired: vi.fn(),
}));
vi.mock('../../../utils/git.js', () => ({
  isGitRepo: vi.fn(() => true),
  getGitDiffNames: vi.fn(async () => null),
  getGitStatusChanges: vi.fn(async () => null),
}));

describe('checkCommand', () => {
  const workspace = '/test/workspace';
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  let mockStorage: {
    initialize: Mock;
    close: Mock;
    getFileByPath: Mock;
    getContextPacks: Mock;
    getFunctionsByPath: Mock;
    getGraphEdges: Mock;
    getFunction: Mock;
    getModuleByPath: Mock;
    getEvidenceForTarget: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getFileByPath: vi.fn().mockResolvedValue({
        id: 'file-1',
        path: `${workspace}/src/a.ts`,
        lastIndexed: '2026-02-19T00:00:00.000Z',
      }),
      getContextPacks: vi.fn().mockResolvedValue([{ packId: 'pack-1' }]),
      getFunctionsByPath: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getFunction: vi.fn().mockResolvedValue(null),
      getModuleByPath: vi.fn().mockResolvedValue(null),
      getEvidenceForTarget: vi.fn().mockResolvedValue([]),
    };

    vi.mocked(resolveDbPath).mockResolvedValue('/tmp/librarian.sqlite');
    vi.mocked(createSqliteStorage).mockReturnValue(mockStorage as unknown as LibrarianStorage);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(isGitRepo).mockReturnValue(true);
    vi.mocked(getGitStatusChanges).mockResolvedValue(null);
    vi.mocked(getGitDiffNames).mockResolvedValue(null);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns exit code 2 when bootstrap is required', async () => {
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });

    const exitCode = await checkCommand({
      workspace,
      args: [],
      rawArgs: ['check'],
    });

    expect(exitCode).toBe(2);
    expect(mockStorage.close).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Run librainian bootstrap first'));
  });

  it('returns exit code 1 when stale context is detected', async () => {
    vi.mocked(getGitStatusChanges).mockResolvedValue({
      added: [],
      modified: ['src/a.ts'],
      deleted: [],
    });
    mockStorage.getFileByPath.mockResolvedValue(null);

    const exitCode = await checkCommand({
      workspace,
      args: ['--json'],
      rawArgs: ['check', '--json'],
    });

    const payload = consoleLogSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(payload) as { status?: string; checks?: Array<{ name?: string; status?: string }> };

    expect(exitCode).toBe(1);
    expect(parsed.status).toBe('fail');
    expect(parsed.checks?.some((c) => c.name === 'stale_context' && c.status === 'fail')).toBe(true);
  });

  it('returns exit code 0 and emits junit output', async () => {
    const exitCode = await checkCommand({
      workspace,
      args: ['--format', 'junit'],
      rawArgs: ['check', '--format', 'junit'],
    });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(exitCode).toBe(0);
    expect(output).toContain('<testsuite');
    expect(output).toContain('name="librarian.check"');
  });

  it('supports explicit diff ranges like HEAD~1..HEAD', async () => {
    vi.mocked(execSync).mockReturnValue('M\tsrc/a.ts\n' as unknown as Buffer);

    await checkCommand({
      workspace,
      args: [],
      rawArgs: ['check', '--diff', 'HEAD~1..HEAD', '--json'],
    });

    expect(execSync).toHaveBeenCalledWith(
      'git diff --name-status HEAD~1..HEAD',
      expect.objectContaining({ cwd: workspace, encoding: 'utf8' })
    );
  });
});
