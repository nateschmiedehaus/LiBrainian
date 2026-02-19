import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { embedCommand } from '../embed.js';

import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { checkAllProviders } from '../../../api/provider_check.js';
import { bootstrapProject, createBootstrapConfig } from '../../../api/bootstrap.js';
import { resolveWorkspaceRoot } from '../../../utils/workspace_resolver.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));
vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));
vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn(),
}));
vi.mock('../../../api/bootstrap.js', () => ({
  bootstrapProject: vi.fn(),
  createBootstrapConfig: vi.fn(),
}));
vi.mock('../../../utils/workspace_resolver.js', () => ({
  resolveWorkspaceRoot: vi.fn(),
}));

describe('embedCommand', () => {
  const workspace = '/tmp/librarian-embed-workspace';
  const dbPath = '/tmp/librarian-embed-workspace/.librarian/librarian.sqlite';
  const storage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(),
  } as unknown as {
    initialize: Mock;
    close: Mock;
    getStats: Mock;
  };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: workspace,
      workspace,
      changed: false,
      sourceFileCount: 0,
      reason: 'no_candidate',
    });
    vi.mocked(resolveDbPath).mockResolvedValue(dbPath);
    vi.mocked(createSqliteStorage).mockReturnValue(storage as any);
    storage.getStats
      .mockResolvedValueOnce({
        totalFunctions: 100,
        totalEmbeddings: 20,
      })
      .mockResolvedValueOnce({
        totalFunctions: 100,
        totalEmbeddings: 100,
      });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 1, error: 'unavailable' },
      embedding: { available: true, provider: 'xenova', model: 'test-embed', latencyMs: 1 },
    });
    vi.mocked(createBootstrapConfig).mockImplementation((_root, overrides) => ({
      workspace,
      ...overrides,
    }) as any);
    vi.mocked(bootstrapProject).mockResolvedValue({
      success: true,
      totalFilesProcessed: 12,
      totalFunctionsIndexed: 100,
      totalContextPacksCreated: 10,
      phases: [],
    } as any);
  });

  it('requires --fix for remediation mode', async () => {
    await expect(embedCommand({
      workspace,
      args: [],
      rawArgs: ['embed'],
    })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('fails closed when embedding provider is unavailable', async () => {
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'x', latencyMs: 1 },
      embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 1, error: 'missing key' },
    });

    await expect(embedCommand({
      workspace,
      args: ['--fix'],
      rawArgs: ['embed', '--fix'],
    })).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(bootstrapProject).not.toHaveBeenCalled();
  });

  it('runs fast forced bootstrap for embedding backfill', async () => {
    await embedCommand({
      workspace,
      args: ['--fix'],
      rawArgs: ['embed', '--fix', '--json'],
    });

    expect(bootstrapProject).toHaveBeenCalledTimes(1);
    const config = vi.mocked(bootstrapProject).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.forceReindex).toBe(true);
    expect(config.bootstrapMode).toBe('fast');
    expect(config.skipLlm).toBe(true);
    expect(config.skipEmbeddings).toBe(false);

    const output = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((entry) => typeof entry === 'string' && entry.startsWith('{')) as string | undefined;
    expect(output).toBeTruthy();
    const report = JSON.parse(output ?? '{}');
    expect(report.before.coverage_pct).toBe(20);
    expect(report.after.coverage_pct).toBe(100);
    expect(report.success).toBe(true);
  });
});
