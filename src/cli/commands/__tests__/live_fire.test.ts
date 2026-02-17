import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { liveFireCommand } from '../live_fire.js';
import { runLiveFireTrials } from '../../../evaluation/live_fire_trials.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('../../../evaluation/live_fire_trials.js', () => ({
  runLiveFireTrials: vi.fn(),
}));

describe('liveFireCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(runLiveFireTrials).mockResolvedValue({
      schema: 'LiveFireTrialReport.v1',
      createdAt: '2026-01-01T00:00:00.000Z',
      options: {
        reposRoot: '/tmp/repos',
        rounds: 1,
        llmModes: ['disabled'],
        deterministic: true,
        protocol: 'objective',
        strictObjective: true,
        includeSmoke: true,
        minJourneyPassRate: 1,
        minRetrievedContextRate: 0.95,
        maxBlockingValidationRate: 0,
      },
      runs: [],
      aggregate: {
        totalRuns: 1,
        passingRuns: 1,
        passRate: 1,
        meanJourneyPassRate: 1,
        meanRetrievedContextRate: 1,
        meanBlockingValidationRate: 0,
        meanSmokePassRate: 1,
      },
      gates: {
        passed: true,
        reasons: [],
      },
    } as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('passes parsed options to runner', async () => {
    await liveFireCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: [
        'live-fire',
        '--repos-root', '/tmp/repos',
        '--max-repos', '3',
        '--rounds', '2',
        '--repo', 'a,b',
        '--llm-modes', 'disabled,optional',
        '--deterministic',
        '--strict-objective',
        '--include-smoke',
      ],
    });

    expect(runLiveFireTrials).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: 3,
      rounds: 2,
      repoNames: ['a', 'b'],
      llmModes: ['disabled', 'optional'],
      deterministic: true,
      protocol: 'objective',
      strictObjective: true,
      includeSmoke: true,
      minJourneyPassRate: undefined,
      minRetrievedContextRate: undefined,
      maxBlockingValidationRate: undefined,
      journeyTimeoutMs: undefined,
      smokeTimeoutMs: undefined,
    });
  });

  it('defers boolean defaults to trial runner when flags are absent', async () => {
    await liveFireCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['live-fire', '--repos-root', '/tmp/repos'],
    });

    expect(runLiveFireTrials).toHaveBeenCalledWith({
      reposRoot: '/tmp/repos',
      maxRepos: undefined,
      rounds: undefined,
      repoNames: undefined,
      llmModes: undefined,
      deterministic: undefined,
      protocol: 'objective',
      strictObjective: undefined,
      includeSmoke: undefined,
      minJourneyPassRate: undefined,
      minRetrievedContextRate: undefined,
      maxBlockingValidationRate: undefined,
      journeyTimeoutMs: undefined,
      smokeTimeoutMs: undefined,
    });
  });

  it('outputs json payload when --json is set', async () => {
    await liveFireCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['live-fire', '--repos-root', '/tmp/repos', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"schema"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.schema).toBe('LiveFireTrialReport.v1');
  });

  it('writes single-profile report artifact when artifacts-dir is provided without --output', async () => {
    vi.mocked(fs.existsSync).mockImplementation((targetPath) => {
      if (targetPath === '/tmp/artifacts/custom') return false;
      return true;
    });

    await liveFireCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['live-fire', '--repos-root', '/tmp/repos', '--artifacts-dir', '/tmp/artifacts'],
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/artifacts/custom', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/artifacts/custom/report.json', expect.any(String), 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/artifacts/custom/latest.json', expect.any(String), 'utf8');
  });

  it('handles missing manifest with actionable error', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await liveFireCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: ['live-fire', '--json', '--repos-root', '/tmp/missing'],
    });

    expect(runLiveFireTrials).not.toHaveBeenCalled();
    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"error"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.error.code).toBe('MISSING_MANIFEST');
    expect(process.exitCode).toBe(1);
  });

  it('runs a profile matrix and emits matrix report', async () => {
    vi.mocked(runLiveFireTrials)
      .mockResolvedValueOnce({
        schema: 'LiveFireTrialReport.v1',
        createdAt: '2026-01-01T00:00:00.000Z',
        options: { reposRoot: '/tmp/repos', rounds: 1 },
        runs: [],
        aggregate: {
          totalRuns: 1,
          passingRuns: 1,
          passRate: 1,
          meanJourneyPassRate: 1,
          meanRetrievedContextRate: 1,
          meanBlockingValidationRate: 0,
        },
        gates: { passed: true, reasons: [] },
      } as any)
      .mockResolvedValueOnce({
        schema: 'LiveFireTrialReport.v1',
        createdAt: '2026-01-01T00:00:00.000Z',
        options: { reposRoot: '/tmp/repos', rounds: 1 },
        runs: [],
        aggregate: {
          totalRuns: 1,
          passingRuns: 0,
          passRate: 0,
          meanJourneyPassRate: 0,
          meanRetrievedContextRate: 0,
          meanBlockingValidationRate: 0.5,
        },
        gates: { passed: false, reasons: ['gate_failed'] },
      } as any);
    vi.mocked(fs.existsSync).mockImplementation((targetPath) => {
      if (targetPath === '/tmp/artifacts') return false;
      return true;
    });

    await liveFireCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: [
        'live-fire',
        '--repos-root', '/tmp/repos',
        '--profiles', 'baseline,hardcore',
        '--matrix',
        '--artifacts-dir', '/tmp/artifacts',
        '--json',
      ],
    });

    expect(runLiveFireTrials).toHaveBeenCalledTimes(2);
    expect(runLiveFireTrials).toHaveBeenNthCalledWith(1, expect.objectContaining({
      rounds: 1,
      maxRepos: 3,
      llmModes: ['disabled'],
      strictObjective: true,
      includeSmoke: true,
      journeyTimeoutMs: 180000,
      smokeTimeoutMs: 180000,
    }));
    expect(runLiveFireTrials).toHaveBeenNthCalledWith(2, expect.objectContaining({
      rounds: 2,
      maxRepos: 6,
      llmModes: ['disabled', 'optional'],
      strictObjective: true,
      includeSmoke: true,
      journeyTimeoutMs: 180000,
      smokeTimeoutMs: 180000,
    }));
    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/artifacts', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/artifacts/baseline.json', expect.any(String), 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/artifacts/hardcore.json', expect.any(String), 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/artifacts/matrix_summary.json', expect.any(String), 'utf8');

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"schema"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.schema).toBe('LiveFireMatrixReport.v1');
    expect(parsed.overall.failedProfiles).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  it('loads profiles from file for custom hardcore scenarios', async () => {
    const readFileSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      schema: 'LiveFireProfiles.v1',
      profiles: {
        feral: {
          rounds: 5,
          maxRepos: 8,
          llmModes: ['disabled', 'optional'],
          strictObjective: true,
          includeSmoke: true,
          minRetrievedContextRate: 1,
        },
      },
    }));

    await liveFireCommand({
      workspace: '/tmp',
      args: [],
      rawArgs: [
        'live-fire',
        '--repos-root', '/tmp/repos',
        '--profile', 'feral',
        '--profiles-file', '/tmp/live-fire-profiles.json',
      ],
    });

    expect(runLiveFireTrials).toHaveBeenCalledWith(expect.objectContaining({
      rounds: 5,
      maxRepos: 8,
      llmModes: ['disabled', 'optional'],
      strictObjective: true,
      includeSmoke: true,
      minRetrievedContextRate: 1,
    }));

    readFileSpy.mockRestore();
  });
});
