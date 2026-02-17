import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { externalReposCommand } from '../external_repos.js';
import { spawnSync } from 'node:child_process';
import { runExternalRepoSmoke } from '../../../evaluation/external_repo_smoke.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));
vi.mock('../../../evaluation/external_repo_smoke.js', () => ({
  runExternalRepoSmoke: vi.fn(),
}));

describe('externalReposCommand', () => {
  let workspace: string;
  let reposRoot: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-extrepos-'));
    reposRoot = path.join(workspace, 'external-repos');
    await fs.mkdir(reposRoot, { recursive: true });
    await fs.writeFile(
      path.join(reposRoot, 'manifest.json'),
      JSON.stringify({ repos: [{ name: 'repo-a', remote: 'https://example.com/repo-a.git', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] }, null, 2),
      'utf8',
    );
    await fs.mkdir(path.join(reposRoot, 'repo-a', '.git'), { recursive: true });

    // Default git mock: succeed and return expected HEAD.
    vi.mocked(spawnSync).mockImplementation((_cmd: any, args: any, _opts: any) => {
      const argv = Array.isArray(args) ? args : [];
      if (argv[0] === 'rev-parse') {
        return { status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' } as any;
      }
      return { status: 0, stdout: '', stderr: '' } as any;
    });
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({ results: [] } as any);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('syncs repos from manifest and emits JSON report', async () => {
    await externalReposCommand({
      workspace,
      args: ['sync'],
      rawArgs: ['external-repos', 'sync', '--repos-root', reposRoot, '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"reposRoot"')) as string | undefined;
    expect(payload).toBeTruthy();

    const parsed = JSON.parse(payload!);
    expect(parsed.reposRoot).toBe(path.resolve(reposRoot));
    expect(parsed.total).toBe(1);
    expect(parsed.errors).toBe(0);
  });

  it('runs smoke verification when --verify is set', async () => {
    await externalReposCommand({
      workspace,
      args: ['sync'],
      rawArgs: ['external-repos', 'sync', '--repos-root', reposRoot, '--json', '--verify'],
    });
    expect(runExternalRepoSmoke).toHaveBeenCalledWith(expect.objectContaining({ reposRoot: path.resolve(reposRoot) }));
  });

  it('avoids nested clone paths when reposRoot is relative', async () => {
    await fs.rm(path.join(reposRoot, 'repo-a'), { recursive: true, force: true });

    vi.mocked(spawnSync).mockImplementation((cmd: any, args: any, opts: any) => {
      if (cmd !== 'git') return { status: 0, stdout: '', stderr: '' } as any;
      const argv = Array.isArray(args) ? args : [];
      if (argv[0] === 'clone') {
        const target = String(argv[argv.length - 1] ?? '');
        // In the fixed implementation, we always pass an absolute target path.
        const targetPath = path.isAbsolute(target) ? target : path.join(String(opts?.cwd ?? ''), target);
        fsSync.mkdirSync(path.join(targetPath, '.git'), { recursive: true });
        return { status: 0, stdout: '', stderr: '' } as any;
      }
      if (argv[0] === 'rev-parse') {
        return { status: 0, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', stderr: '' } as any;
      }
      return { status: 0, stdout: '', stderr: '' } as any;
    });

    const relativeRoot = path.relative(process.cwd(), reposRoot);
    await externalReposCommand({
      workspace,
      args: ['sync'],
      rawArgs: ['external-repos', 'sync', '--repos-root', relativeRoot, '--json'],
    });

    const cloneCall = vi.mocked(spawnSync).mock.calls.find((call) => Array.isArray(call[1]) && call[1][0] === 'clone');
    expect(cloneCall).toBeTruthy();
    const cloneArgs = cloneCall![1] as string[];
    const target = String(cloneArgs[cloneArgs.length - 1] ?? '');
    expect(path.isAbsolute(target)).toBe(true);
  });
});
