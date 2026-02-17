import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { smokeCommand } from '../smoke.js';
import { runExternalRepoSmoke } from '../../../evaluation/external_repo_smoke.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('../../../evaluation/external_repo_smoke.js', () => ({
  runExternalRepoSmoke: vi.fn(),
}));

describe('smokeCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('passes reposRoot and maxRepos to runner', async () => {
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [],
    });

    await smokeCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['smoke', '--repos-root', '/tmp/repos', '--max-repos', '2'],
    });

    expect(runExternalRepoSmoke).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: 2,
    });
  });

  it('passes repo filter to runner', async () => {
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [],
    });

    await smokeCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['smoke', '--repos-root', '/tmp/repos', '--repo', 'a,b'],
    });

    expect(runExternalRepoSmoke).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: undefined,
      repoNames: ['a', 'b'],
    });
  });

  it('passes artifacts directory to runner when provided', async () => {
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [],
    });

    await smokeCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['smoke', '--repos-root', '/tmp/repos', '--artifacts-dir', './state/smoke-artifacts'],
    });

    expect(runExternalRepoSmoke).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: undefined,
      repoNames: undefined,
      artifactRoot: expect.stringContaining('state/smoke-artifacts'),
    });
  });

  it('passes abort signal when timeout is provided', async () => {
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [],
    });

    await smokeCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['smoke', '--repos-root', '/tmp/repos', '--timeout-ms', '1000'],
    });

    expect(runExternalRepoSmoke).toHaveBeenCalledWith(expect.objectContaining({
      reposRoot: '/tmp/repos',
      signal: expect.any(AbortSignal),
    }));
  });

  it('outputs json and sets exit code on failures', async () => {
    vi.mocked(runExternalRepoSmoke).mockResolvedValue({
      results: [
        { repo: 'a', overviewOk: true, contextOk: true, errors: [] },
        { repo: 'b', overviewOk: false, contextOk: false, errors: ['boom'] },
      ],
    });

    await smokeCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['smoke', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"summary"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.summary.failures).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it('handles missing manifest with actionable error', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await smokeCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['smoke', '--json', '--repos-root', '/tmp/missing'],
    });

    expect(runExternalRepoSmoke).not.toHaveBeenCalled();
    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"error"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.error.code).toBe('MISSING_MANIFEST');
    expect(process.exitCode).toBe(1);
  });
});
