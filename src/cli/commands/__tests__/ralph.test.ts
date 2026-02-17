import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ralphCommand } from '../ralph.js';
import { resolveDbPath } from '../../db_path.js';
import { runOnboardingRecovery } from '../../../api/onboarding_recovery.js';
import { checkAllProviders } from '../../../api/provider_check.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { generateStateReport } from '../../../measurement/observability.js';
import { runStagedEvaluation } from '../../../evolution/index.js';
import { doctorCommand } from '../doctor.js';
import { externalReposCommand } from '../external_repos.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));
vi.mock('../../../api/onboarding_recovery.js', () => ({
  runOnboardingRecovery: vi.fn(),
}));
vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn(),
}));
vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));
vi.mock('../../../measurement/observability.js', () => ({
  generateStateReport: vi.fn(),
}));
vi.mock('../../../evolution/index.js', () => ({
  runStagedEvaluation: vi.fn(),
}));
vi.mock('../doctor.js', () => ({
  doctorCommand: vi.fn(),
}));
vi.mock('../external_repos.js', () => ({
  externalReposCommand: vi.fn(),
}));

describe('ralphCommand', () => {
  let workspace: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-ralph-'));

    vi.mocked(resolveDbPath).mockResolvedValue(path.join(workspace, '.librarian', 'librarian.sqlite'));
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: null, model: null, reason: 'not configured' },
      embedding: { available: false, provider: null, model: null, reason: 'not configured' },
    } as any);
    vi.mocked(runOnboardingRecovery).mockResolvedValue({
      errors: [],
      configHeal: { attempted: false, success: true, appliedFixes: 0, failedFixes: 0 },
      storageRecovery: { attempted: false, recovered: false, actions: [], errors: [] },
      providerStatus: null,
      bootstrap: { required: false, attempted: false, success: true, retries: 0, skipEmbeddings: true, skipLlm: true },
    } as any);
    vi.mocked(createSqliteStorage).mockImplementation(() => ({
      initialize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }) as any);
    vi.mocked(generateStateReport).mockResolvedValue({
      health: { status: 'healthy', degradationReasons: [], suspectedDead: false, stalenessMs: 0 },
    } as any);
    vi.mocked(runStagedEvaluation).mockResolvedValue({
      fitnessReport: { fitness: { overall: 0.9 } },
    } as any);
    vi.mocked(doctorCommand).mockResolvedValue(undefined);
    vi.mocked(externalReposCommand).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('writes an audit report and emits JSON when --json is set', async () => {
    await ralphCommand({
      workspace,
      args: [],
      rawArgs: ['ralph', '--json', '--mode', 'fast', '--max-cycles', '1'],
    });

    const payload = consoleLogSpy.mock.calls
      .map(call => call[0])
      .find(value => typeof value === 'string' && value.includes('"RalphLoopReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();

    const parsed = JSON.parse(payload!);
    expect(parsed.schema).toBe('RalphLoopReport.v1');
    expect(parsed.cyclesRun).toBe(1);
  });

  it('does not run evaluation in fast mode by default', async () => {
    await ralphCommand({
      workspace,
      args: [],
      rawArgs: ['ralph', '--mode', 'fast', '--max-cycles', '1', '--json'],
    });
    expect(runStagedEvaluation).not.toHaveBeenCalled();
  });

  it('runs evaluation in full mode unless --skip-eval is set', async () => {
    await ralphCommand({
      workspace,
      args: [],
      rawArgs: ['ralph', '--mode', 'full', '--max-cycles', '1', '--json'],
    });
    expect(runStagedEvaluation).toHaveBeenCalledTimes(1);

    vi.mocked(runStagedEvaluation).mockClear();
    await ralphCommand({
      workspace,
      args: [],
      rawArgs: ['ralph', '--mode', 'full', '--max-cycles', '1', '--json', '--skip-eval'],
    });
    expect(runStagedEvaluation).not.toHaveBeenCalled();
  });

  it('degrades worldclass verdict when critical measurements are unmeasured', async () => {
    vi.mocked(runStagedEvaluation).mockResolvedValue({
      fitnessReport: {
        fitness: { overall: 0.92 },
        stages: {
          stage0_static: { status: 'passed' },
          stage1_tier0: { status: 'passed' },
          stage2_tier1: { status: 'passed' },
          stage3_tier2: { status: 'passed' },
          stage4_adversarial: { status: 'passed' },
        },
        measurementCompleteness: {
          retrievalQuality: { measured: false, reason: 'missing_or_budget_skipped' },
          epistemicQuality: { measured: true },
          operationalQuality: { measured: true },
        },
      },
    } as any);

    await ralphCommand({
      workspace,
      args: [],
      rawArgs: ['ralph', '--mode', 'full', '--objective', 'worldclass', '--max-cycles', '1', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"RalphLoopReport.v1"')) as string | undefined;
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.cycles[0].verdict).toBe('degraded');
    expect(parsed.cycles[0].nextActions.join(' ')).toContain('strict worldclass gate failures');
    expect(process.exitCode).toBe(1);
  });
});
