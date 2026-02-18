import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BootstrapReport } from '../../types.js';

vi.mock('../bootstrap.js', () => ({
  createBootstrapConfig: vi.fn((workspace: string, overrides: Record<string, unknown>) => ({
    workspace,
    ...overrides,
  })),
  isBootstrapRequired: vi.fn(),
  bootstrapProject: vi.fn(),
}));

vi.mock('../provider_check.js', () => ({
  checkAllProviders: vi.fn(),
}));

vi.mock('../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));

vi.mock('../../storage/storage_recovery.js', () => ({
  attemptStorageRecovery: vi.fn(),
  cleanupWorkspaceLocks: vi.fn(),
  isRecoverableStorageError: vi.fn(),
}));

vi.mock('../../config/self_healing.js', () => ({
  diagnoseConfiguration: vi.fn(),
  autoHealConfiguration: vi.fn(),
}));

vi.mock('../../bootstrap/bootstrap_recovery.js', () => ({
  planBootstrapRecovery: vi.fn(),
}));

describe('onboarding recovery', () => {
  const workspace = '/workspace';
  const dbPath = '/workspace/.librarian/librarian.sqlite';

  beforeEach(async () => {
    vi.resetAllMocks();
    const { createBootstrapConfig } = await import('../bootstrap.js');
    const { cleanupWorkspaceLocks } = await import('../../storage/storage_recovery.js');
    vi.mocked(createBootstrapConfig).mockImplementation(
      (workspaceRoot: string, overrides: Record<string, unknown>) => ({
        workspace: workspaceRoot,
        ...overrides,
      })
    );
    vi.mocked(cleanupWorkspaceLocks).mockResolvedValue({
      lockDirs: [],
      scannedFiles: 0,
      staleFiles: 0,
      activePidFiles: 0,
      unknownFreshFiles: 0,
      stalePaths: [],
      removedFiles: 0,
      errors: [],
    });
  });

  it('attempts storage recovery on recoverable init errors', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const {
      attemptStorageRecovery,
      cleanupWorkspaceLocks,
      isRecoverableStorageError,
    } = await import('../../storage/storage_recovery.js');
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn()
        .mockRejectedValueOnce(new Error('sqlite_busy'))
        .mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isRecoverableStorageError).mockReturnValue(true);
    vi.mocked(attemptStorageRecovery).mockResolvedValue({
      recovered: true,
      actions: ['removed_lock'],
      errors: [],
    });
    vi.mocked(cleanupWorkspaceLocks).mockResolvedValue({
      lockDirs: [],
      scannedFiles: 0,
      staleFiles: 0,
      activePidFiles: 0,
      unknownFreshFiles: 0,
      stalePaths: [],
      removedFiles: 0,
      errors: [],
    });
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    const result = await runOnboardingRecovery({ workspace, dbPath, autoHealConfig: true });

    expect(storage.initialize).toHaveBeenCalledTimes(2);
    expect(attemptStorageRecovery).toHaveBeenCalledWith(
      dbPath,
      expect.objectContaining({
        error: expect.any(Error),
      })
    );
    expect(result.storageRecovery?.recovered).toBe(true);
  });

  it('records stale workspace lock cleanup in storage recovery actions', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { cleanupWorkspaceLocks } = await import('../../storage/storage_recovery.js');
    const { isBootstrapRequired } = await import('../bootstrap.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(cleanupWorkspaceLocks).mockResolvedValue({
      lockDirs: [`${workspace}/.librarian/locks`],
      scannedFiles: 3,
      staleFiles: 2,
      activePidFiles: 0,
      unknownFreshFiles: 1,
      stalePaths: [`${workspace}/.librarian/locks/a.lock`, `${workspace}/.librarian/locks/b.lock`],
      removedFiles: 2,
      errors: [],
    });
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    const result = await runOnboardingRecovery({ workspace, dbPath, autoHealConfig: true });

    expect(result.storageRecovery?.attempted).toBe(true);
    expect(result.storageRecovery?.recovered).toBe(true);
    expect(result.storageRecovery?.actions).toContain('removed_workspace_locks:2');
  });

  it('degrades bootstrap when providers are unavailable and degraded mode is allowed', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 1, error: 'unavailable' },
      embedding: { available: false, provider: 'xenova', model: 'unknown', latencyMs: 1, error: 'unavailable' },
    });
    vi.mocked(bootstrapProject).mockResolvedValue({ success: true } as BootstrapReport);
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    const result = await runOnboardingRecovery({ workspace, dbPath, allowDegradedEmbeddings: true });

    expect(createBootstrapConfig).toHaveBeenCalledWith(workspace, expect.objectContaining({
      skipEmbeddings: true,
      skipLlm: true,
    }));
    expect(result.bootstrap?.skipEmbeddings).toBe(true);
    expect(result.bootstrap?.skipLlm).toBe(true);
  });

  it('retries bootstrap when recovery plan suggests include/exclude overrides', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { planBootstrapRecovery } = await import('../../bootstrap/bootstrap_recovery.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'test', latencyMs: 1 },
      embedding: { available: true, provider: 'xenova', model: 'test', latencyMs: 1 },
    });
    vi.mocked(bootstrapProject)
      .mockResolvedValueOnce({ success: false, error: 'Include patterns matched no files' } as BootstrapReport)
      .mockResolvedValueOnce({ success: true } as BootstrapReport);
    vi.mocked(planBootstrapRecovery).mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: ['dist/**'],
      reason: 'retry with defaults',
    });
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    const result = await runOnboardingRecovery({ workspace, dbPath });

    expect(bootstrapProject).toHaveBeenCalledTimes(2);
    expect(result.bootstrap?.retries).toBe(1);
    expect(result.bootstrap?.success).toBe(true);
  });

  it('retries bootstrap when recovery plan suggests workspace root change', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { planBootstrapRecovery } = await import('../../bootstrap/bootstrap_recovery.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const previousEnv = process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT;
    process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT = '1';

    const storageA = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const storageB = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage)
      .mockReturnValueOnce(storageA as never)
      .mockReturnValueOnce(storageB as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'test', latencyMs: 1 },
      embedding: { available: true, provider: 'xenova', model: 'test', latencyMs: 1 },
    });
    vi.mocked(bootstrapProject)
      .mockResolvedValueOnce({ success: false, error: 'root at /new-root' } as BootstrapReport)
      .mockResolvedValueOnce({ success: true } as BootstrapReport);
    vi.mocked(planBootstrapRecovery).mockReturnValue({
      workspaceRoot: '/new-root',
      reason: 'retry with detected root',
    });
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    const result = await runOnboardingRecovery({ workspace, dbPath });

    if (previousEnv === undefined) {
      delete process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT;
    } else {
      process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT = previousEnv;
    }

    expect(createSqliteStorage).toHaveBeenNthCalledWith(1, dbPath, workspace);
    expect(createSqliteStorage).toHaveBeenNthCalledWith(
      2,
      '/new-root/.librarian/librarian.sqlite',
      '/new-root'
    );
    expect(createBootstrapConfig).toHaveBeenCalledWith(workspace, expect.any(Object));
    const firstConfig = vi.mocked(bootstrapProject).mock.calls[0]?.[0] as { workspace?: string };
    const secondConfig = vi.mocked(bootstrapProject).mock.calls[1]?.[0] as { workspace?: string };
    expect(firstConfig?.workspace).toBe(workspace);
    expect(secondConfig?.workspace).toBe('/new-root');
    expect(bootstrapProject).toHaveBeenCalledTimes(2);
    expect(result.bootstrap?.retries).toBe(1);
    expect(result.bootstrap?.success).toBe(true);
  });

  it('forces skipLlm in fast bootstrap mode to avoid accidental LLM work', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'test', latencyMs: 1 },
      embedding: { available: true, provider: 'xenova', model: 'test', latencyMs: 1 },
    });
    vi.mocked(bootstrapProject).mockResolvedValue({ success: true } as BootstrapReport);
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    await runOnboardingRecovery({ workspace, dbPath, bootstrapMode: 'fast' });

    expect(createBootstrapConfig).toHaveBeenCalledWith(workspace, expect.objectContaining({
      bootstrapMode: 'fast',
      skipEmbeddings: true,
      skipLlm: true,
    }));
  });

  it('forces bootstrap when requested even if not required', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 1, error: 'unavailable' },
      embedding: { available: false, provider: 'xenova', model: 'unknown', latencyMs: 1, error: 'unavailable' },
    });
    vi.mocked(bootstrapProject).mockResolvedValue({ success: true } as BootstrapReport);
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    await runOnboardingRecovery({ workspace, dbPath, forceBootstrap: true });

    expect(bootstrapProject).toHaveBeenCalled();
  });

  it('passes emitBaseline when enabled', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 1, error: 'unavailable' },
      embedding: { available: false, provider: 'xenova', model: 'unknown', latencyMs: 1, error: 'unavailable' },
    });
    vi.mocked(bootstrapProject).mockResolvedValue({ success: true } as BootstrapReport);
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    await runOnboardingRecovery({ workspace, dbPath, emitBaseline: true });

    expect(createBootstrapConfig).toHaveBeenCalledWith(workspace, expect.objectContaining({
      emitBaseline: true,
    }));
  });

  it('passes updateAgentDocs when enabled', async () => {
    const { runOnboardingRecovery } = await import('../onboarding_recovery.js');
    const { createSqliteStorage } = await import('../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../bootstrap.js');
    const { checkAllProviders } = await import('../provider_check.js');
    const { diagnoseConfiguration } = await import('../../config/self_healing.js');

    const storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createSqliteStorage).mockReturnValue(storage as never);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: true, reason: 'missing index' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 1, error: 'unavailable' },
      embedding: { available: false, provider: 'xenova', model: 'unknown', latencyMs: 1, error: 'unavailable' },
    });
    vi.mocked(bootstrapProject).mockResolvedValue({ success: true } as BootstrapReport);
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      autoFixable: [],
      issues: [],
      healthScore: 1,
    });

    await runOnboardingRecovery({ workspace, dbPath, updateAgentDocs: true });

    expect(createBootstrapConfig).toHaveBeenCalledWith(workspace, expect.objectContaining({
      updateAgentDocs: true,
    }));
  });
});
