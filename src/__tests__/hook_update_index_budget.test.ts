import { describe, expect, it, vi } from 'vitest';

type HookUpdateResult = {
  exitCode: number;
  report: {
    kind: string;
    status: 'pass' | 'fail';
    elapsedMs: number;
    budgetMs: number;
    strictReliability: boolean;
    latencyViolated: boolean;
    reliabilityViolated: boolean;
    outcome: string;
    softFailureReason: string | null;
    updateExitCode: number;
  };
  update: {
    status: number;
    stdout: string;
    stderr: string;
  };
};

type HookModule = {
  runHookUpdate: (args: {
    stagedFiles: string[];
    env: NodeJS.ProcessEnv;
    runCommand: (command: string, args: string[]) => { status: number; stdout: string; stderr: string };
    now: () => number;
  }) => HookUpdateResult;
};

async function loadHookModule(): Promise<HookModule> {
  return (await import('../../scripts/hook-update-index.mjs')) as HookModule;
}

function createNow(startMs: number, endMs: number): () => number {
  let count = 0;
  return () => {
    count += 1;
    return count === 1 ? startMs : endMs;
  };
}

function createEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    CI: 'false',
    LIBRARIAN_PRECOMMIT_BUDGET_MS: '1000',
    LIBRARIAN_PRECOMMIT_STRICT: '0',
    ...overrides,
  };
}

describe('hook-update-index budget gate', () => {
  it('passes a successful staged update inside latency budget', async () => {
    const hook = await loadHookModule();
    const runCommand = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '' }));
    const result = hook.runHookUpdate({
      stagedFiles: ['src/api/query.ts'],
      env: createEnv({}),
      runCommand,
      now: createNow(0, 250),
    });

    expect(runCommand).toHaveBeenCalledWith('npm', ['run', 'librainian:update', '--', 'src/api/query.ts']);
    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('pass');
    expect(result.report.outcome).toBe('success');
    expect(result.report.latencyViolated).toBe(false);
    expect(result.report.reliabilityViolated).toBe(false);
  });

  it('fails when latency budget is exceeded even if update succeeds', async () => {
    const hook = await loadHookModule();
    const runCommand = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '' }));
    const result = hook.runHookUpdate({
      stagedFiles: ['src/api/query.ts'],
      env: createEnv({ LIBRARIAN_PRECOMMIT_BUDGET_MS: '200' }),
      runCommand,
      now: createNow(0, 750),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe('fail');
    expect(result.report.latencyViolated).toBe(true);
    expect(result.report.outcome).toBe('success');
  });

  it('allows known soft failures in non-strict mode', async () => {
    const hook = await loadHookModule();
    const runCommand = vi.fn(() => ({
      status: 41,
      stdout: 'unverified_by_trace(llm_adapter_unavailable): Default LLM service factory not registered.',
      stderr: '',
    }));
    const result = hook.runHookUpdate({
      stagedFiles: ['src/api/query.ts'],
      env: createEnv({ LIBRARIAN_PRECOMMIT_STRICT: '0' }),
      runCommand,
      now: createNow(0, 120),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('pass');
    expect(result.report.outcome).toBe('soft_failure');
    expect(result.report.softFailureReason).toBe('llm_adapter_unavailable');
    expect(result.report.reliabilityViolated).toBe(false);
  });

  it('fails known soft failures in strict reliability mode', async () => {
    const hook = await loadHookModule();
    const runCommand = vi.fn(() => ({
      status: 41,
      stdout: 'ProviderUnavailable',
      stderr: '',
    }));
    const result = hook.runHookUpdate({
      stagedFiles: ['src/api/query.ts'],
      env: createEnv({ LIBRARIAN_PRECOMMIT_STRICT: '1' }),
      runCommand,
      now: createNow(0, 120),
    });

    expect(result.exitCode).toBe(41);
    expect(result.report.status).toBe('fail');
    expect(result.report.outcome).toBe('soft_failure');
    expect(result.report.reliabilityViolated).toBe(true);
  });

  it('fails unknown hard failures regardless of strict mode', async () => {
    const hook = await loadHookModule();
    const runCommand = vi.fn(() => ({
      status: 17,
      stdout: 'unexpected failure',
      stderr: 'fatal index crash',
    }));
    const result = hook.runHookUpdate({
      stagedFiles: ['src/api/query.ts'],
      env: createEnv({ LIBRARIAN_PRECOMMIT_STRICT: '0' }),
      runCommand,
      now: createNow(0, 120),
    });

    expect(result.exitCode).toBe(17);
    expect(result.report.status).toBe('fail');
    expect(result.report.outcome).toBe('hard_failure');
    expect(result.report.reliabilityViolated).toBe(false);
  });

  it('supports command override for deterministic gate checks', async () => {
    const hook = await loadHookModule();
    const runCommand = vi.fn(() => ({ status: 0, stdout: 'ok', stderr: '' }));
    const result = hook.runHookUpdate({
      stagedFiles: ['a.ts', 'b.ts'],
      env: createEnv({
        LIBRARIAN_HOOK_UPDATE_CMD_JSON: JSON.stringify(['node', 'fake-update.mjs', '--dry-run']),
      }),
      runCommand,
      now: createNow(0, 10),
    });

    expect(runCommand).toHaveBeenCalledWith('node', ['fake-update.mjs', '--dry-run', 'a.ts', 'b.ts']);
    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('pass');
  });
});
