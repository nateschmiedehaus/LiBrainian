import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { journeyCommand } from '../journey.js';
import { runAgenticJourney } from '../../../evaluation/agentic_journey.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('../../../evaluation/agentic_journey.js', () => ({
  runAgenticJourney: vi.fn(),
}));

describe('journeyCommand', () => {
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
    vi.mocked(runAgenticJourney).mockResolvedValue({ results: [] });

    await journeyCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['journey', '--repos-root', '/tmp/repos', '--max-repos', '2'],
    });

    expect(runAgenticJourney).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: 2,
      deterministic: false,
      llmMode: 'disabled',
      protocol: 'objective',
      strictObjective: false,
    });
  });

  it('supports strict objective protocol flags', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({ results: [] });

    await journeyCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['journey', '--repos-root', '/tmp/repos', '--objective', '--strict-objective'],
    });

    expect(runAgenticJourney).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: undefined,
      deterministic: false,
      llmMode: 'disabled',
      protocol: 'objective',
      strictObjective: true,
    });
  });

  it('passes artifacts directory to runner when provided', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({ results: [] });

    await journeyCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['journey', '--repos-root', '/tmp/repos', '--artifacts-dir', './state/journey-artifacts'],
    });

    expect(runAgenticJourney).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: undefined,
      deterministic: false,
      llmMode: 'disabled',
      protocol: 'objective',
      strictObjective: false,
      artifactRoot: expect.stringContaining('state/journey-artifacts'),
    });
  });

  it('passes abort signal when timeout is provided', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({ results: [] });

    await journeyCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['journey', '--repos-root', '/tmp/repos', '--timeout-ms', '1000'],
    });

    expect(runAgenticJourney).toHaveBeenCalledWith(expect.objectContaining({
      reposRoot: '/tmp/repos',
      signal: expect.any(AbortSignal),
    }));
  });

  it('outputs json and sets exit code on failures', async () => {
    vi.mocked(runAgenticJourney).mockResolvedValue({
      results: [
        { repo: 'a', journeyOk: true, errors: [] },
        { repo: 'b', journeyOk: false, errors: ['boom'] },
      ],
    } as any);

    await journeyCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['journey', '--json'],
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

    await journeyCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['journey', '--json', '--repos-root', '/tmp/missing'],
    });

    expect(runAgenticJourney).not.toHaveBeenCalled();
    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"error"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.error.code).toBe('MISSING_MANIFEST');
    expect(process.exitCode).toBe(1);
  });
});
