import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { statusCommand } from '../status.js';
import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import { isBootstrapRequired, getBootstrapStatus } from '../../../api/bootstrap.js';
import { getIndexState } from '../../../state/index_state.js';
import { checkAllProviders } from '../../../api/provider_check.js';
import { getWatchState } from '../../../state/watch_state.js';
import { inspectWorkspaceLocks } from '../../../storage/storage_recovery.js';
import { printKeyValue } from '../../progress.js';
import { resolveWorkspaceRoot } from '../../../utils/workspace_resolver.js';
import { getGitStatusChanges, isGitRepo } from '../../../utils/git.js';
import type { LibrarianStorage } from '../../../storage/types.js';

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn(),
}));
vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn(),
}));
vi.mock('../../../api/bootstrap.js', () => ({
  isBootstrapRequired: vi.fn(),
  getBootstrapStatus: vi.fn(),
}));
vi.mock('../../../state/index_state.js', () => ({
  getIndexState: vi.fn(),
}));
vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn(),
}));
vi.mock('../../../state/watch_state.js', () => ({
  getWatchState: vi.fn(),
}));
vi.mock('../../../storage/storage_recovery.js', () => ({
  inspectWorkspaceLocks: vi.fn(),
}));
vi.mock('../../../utils/workspace_resolver.js', () => ({
  resolveWorkspaceRoot: vi.fn(),
}));
vi.mock('../../../utils/git.js', () => ({
  isGitRepo: vi.fn(() => true),
  getGitStatusChanges: vi.fn(async () => null),
}));
vi.mock('../../progress.js', async () => {
  const actual = await vi.importActual('../../progress.js');
  return {
    ...actual,
    printKeyValue: vi.fn(),
  };
});

describe('statusCommand', () => {
  const workspace = '/test/workspace';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockStorage: {
    initialize: Mock;
    close: Mock;
    getLastBootstrapReport: Mock;
    getStats: Mock;
    getMetadata: Mock;
    getState: Mock;
    getContextPacks: Mock;
    getFunctions: Mock;
    getFileByPath: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getLastBootstrapReport: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 1,
        totalModules: 1,
        totalContextPacks: 1,
        totalEmbeddings: 0,
        storageSizeBytes: 10,
        averageConfidence: 0.5,
        cacheHitRate: 0.1,
      }),
      getMetadata: vi.fn().mockResolvedValue(null),
      getState: vi.fn().mockResolvedValue(null),
      getContextPacks: vi.fn().mockResolvedValue([]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getFileByPath: vi.fn().mockResolvedValue(null),
    };

    vi.mocked(resolveDbPath).mockResolvedValue('/tmp/librarian.sqlite');
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: workspace,
      workspace,
      changed: false,
      sourceFileCount: 0,
      reason: 'no_candidate',
    });
    vi.mocked(createSqliteStorage).mockReturnValue(mockStorage as unknown as LibrarianStorage);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(getBootstrapStatus).mockReturnValue({
      status: 'not_started',
      currentPhase: null,
      progress: 0,
      startedAt: null,
      completedAt: null,
    });
    vi.mocked(getIndexState).mockResolvedValue({
      phase: 'ready',
      lastFullIndex: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      progress: undefined,
    });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'test-model', latencyMs: 120 },
      embedding: { available: true, provider: 'xenova', model: 'test-embed', latencyMs: 50 },
    });
    vi.mocked(inspectWorkspaceLocks).mockResolvedValue({
      lockDirs: [],
      scannedFiles: 0,
      staleFiles: 0,
      activePidFiles: 0,
      unknownFreshFiles: 0,
      stalePaths: [],
    });
    vi.mocked(isGitRepo).mockReturnValue(true);
    vi.mocked(getGitStatusChanges).mockResolvedValue(null);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints watch state when available', async () => {
    vi.mocked(getWatchState).mockResolvedValue({
      schema_version: 1,
      workspace_root: workspace,
      watch_started_at: '2026-01-19T01:00:00.000Z',
      watch_last_heartbeat_at: '2026-01-19T01:05:00.000Z',
      watch_last_event_at: '2026-01-19T01:06:00.000Z',
      watch_last_reindex_ok_at: '2026-01-19T01:07:00.000Z',
      suspected_dead: false,
      needs_catchup: false,
      storage_attached: true,
      updated_at: '2026-01-19T01:07:30.000Z',
      effective_config: {
        debounceMs: 200,
        cascadeReindex: true,
        cascadeDelayMs: 2000,
        cascadeBatchSize: 5,
        excludes: ['.librarian/', 'state/audits/'],
      },
    });

    await statusCommand({ workspace, verbose: false });

    const calls = vi.mocked(printKeyValue).mock.calls;
    const watchCall = calls.find((call) => call[0].some((entry) => entry.key === 'Watch Started'));
    expect(watchCall).toBeTruthy();
    const configCall = calls.find((call) => call[0].some((entry) => entry.key === 'Watch Debounce (ms)'));
    expect(configCall).toBeTruthy();
    const healthCall = calls.find((call) => call[0].some((entry) => entry.key === 'Derived Suspected Dead'));
    expect(healthCall).toBeTruthy();
    expect(vi.mocked(getWatchState)).toHaveBeenCalledWith(mockStorage);
  });

  it('prints placeholder when watch state is missing', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);

    await statusCommand({ workspace, verbose: false });

    const calls = vi.mocked(printKeyValue).mock.calls;
    const watchCall = calls.find((call) => call[0].some((entry) => entry.key === 'Watch Status'));
    expect(watchCall).toBeTruthy();
  });

  it('emits JSON when format is json', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);

    const exitCode = await statusCommand({ workspace, verbose: false, format: 'json' });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    expect(typeof output).toBe('string');
    const parsed = JSON.parse(output ?? '{}') as {
      workspace?: string;
      storage?: { status?: string };
      embeddingCoverage?: { coverage_pct?: number; total_functions?: number; embedded_functions?: number; needs_embedding_count?: number };
      provenance?: { status?: string };
      server?: { status?: string };
      config?: { status?: string };
    };
    expect(parsed.workspace).toBe(workspace);
    expect(parsed.storage?.status).toBe('ready');
    expect(parsed.embeddingCoverage?.total_functions).toBe(1);
    expect(parsed.embeddingCoverage?.embedded_functions).toBe(0);
    expect(parsed.embeddingCoverage?.coverage_pct).toBe(0);
    expect(parsed.embeddingCoverage?.needs_embedding_count).toBe(1);
    expect(parsed.provenance?.status).toBeDefined();
    expect(parsed.server?.status).toBeDefined();
    expect(parsed.config?.status).toBeDefined();
    expect(exitCode).toBe(0);
  });

  it('reports offline runtime feature availability when LIBRARIAN_OFFLINE is enabled', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    process.env.LIBRARIAN_OFFLINE = '1';

    try {
      await statusCommand({ workspace, verbose: false, format: 'json' });

      const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
      const parsed = JSON.parse(output ?? '{}') as {
        runtime?: { offlineMode?: boolean; availableFeatures?: string[]; unavailableFeatures?: string[] };
      };
      expect(parsed.runtime?.offlineMode).toBe(true);
      expect(parsed.runtime?.availableFeatures).toContain('search');
      expect(parsed.runtime?.unavailableFeatures).toContain('synthesis');
    } finally {
      delete process.env.LIBRARIAN_OFFLINE;
    }
  });

  it('includes freshness counts in JSON output when git data is available', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    mockStorage.getMetadata.mockResolvedValue({
      version: { major: 1, minor: 2, patch: 3, string: '1.2.3' },
      qualityTier: 'full',
      lastBootstrap: '2026-01-19T02:00:00.000Z',
      lastIndexing: '2026-01-19T03:00:00.000Z',
      totalFiles: 10,
      workspace,
      totalFunctions: 0,
      totalContextPacks: 0,
    });
    vi.mocked(getGitStatusChanges).mockResolvedValue({
      added: ['src/new.ts'],
      modified: ['src/changed.ts'],
      deleted: ['src/deleted.ts'],
    });
    mockStorage.getFileByPath.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('changed.ts')) return { id: 'changed' };
      if (filePath.endsWith('deleted.ts')) return { id: 'deleted' };
      return null;
    });

    await statusCommand({ workspace, verbose: false, format: 'json' });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    const parsed = JSON.parse(output ?? '{}') as { freshness?: { freshFiles?: number; staleFiles?: number; missingFiles?: number; newFiles?: number } };
    expect(parsed.freshness?.staleFiles).toBe(1);
    expect(parsed.freshness?.missingFiles).toBe(1);
    expect(parsed.freshness?.newFiles).toBe(1);
    expect(parsed.freshness?.freshFiles).toBe(8);
  });

  it('handles serialized metadata timestamps from storage', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    mockStorage.getMetadata.mockResolvedValue({
      version: { major: 1, minor: 2, patch: 3, string: '1.2.3' },
      qualityTier: 'full',
      lastBootstrap: '2026-01-19T02:00:00.000Z',
      lastIndexing: '2026-01-19T03:00:00.000Z',
      totalFiles: 12,
      workspace,
      totalFunctions: 0,
      totalContextPacks: 0,
    });

    await statusCommand({ workspace, verbose: false, format: 'json' });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    const parsed = JSON.parse(output ?? '{}') as { metadata?: { lastBootstrap?: string | null; lastIndexing?: string | null } };
    expect(parsed.metadata?.lastBootstrap).toBe('2026-01-19T02:00:00.000Z');
    expect(parsed.metadata?.lastIndexing).toBe('2026-01-19T03:00:00.000Z');
  });

  it('uses resolved workspace when auto-detect changes', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: workspace,
      workspace: '/resolved/workspace',
      changed: true,
      reason: 'marker:.git',
      confidence: 0.9,
      marker: '.git',
      sourceFileCount: 0,
      candidateFileCount: 12,
    });

    await statusCommand({ workspace, verbose: false, format: 'json' });

    expect(resolveDbPath).toHaveBeenCalledWith('/resolved/workspace');
    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    const parsed = JSON.parse(output ?? '{}') as { workspace?: string; workspaceOriginal?: string };
    expect(parsed.workspace).toBe('/resolved/workspace');
    expect(parsed.workspaceOriginal).toBe(workspace);
  });

  it('includes lock hygiene details in JSON output', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    vi.mocked(inspectWorkspaceLocks).mockResolvedValue({
      lockDirs: [`${workspace}/.librarian/locks`],
      scannedFiles: 4,
      staleFiles: 2,
      activePidFiles: 1,
      unknownFreshFiles: 1,
      stalePaths: [`${workspace}/.librarian/locks/a.lock`, `${workspace}/.librarian/locks/b.lock`],
    });

    await statusCommand({ workspace, verbose: false, format: 'json' });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    const parsed = JSON.parse(output ?? '{}') as { locks?: { staleFiles?: number; scannedFiles?: number } };
    expect(parsed.locks?.scannedFiles).toBe(4);
    expect(parsed.locks?.staleFiles).toBe(2);
  });

  it('writes JSON report to --out path', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-status-out-'));
    const outPath = path.join(tmpDir, 'status.json');

    try {
      await statusCommand({ workspace, verbose: false, format: 'json', out: outPath });
      const raw = await fs.readFile(outPath, 'utf8');
      const parsed = JSON.parse(raw) as { workspace?: string; storage?: { status?: string } };
      expect(parsed.workspace).toBe(workspace);
      expect(parsed.storage?.status).toBe('ready');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns exit code 1 when freshness drift exceeds 5%', async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    mockStorage.getMetadata.mockResolvedValue({
      version: { major: 1, minor: 2, patch: 3, string: '1.2.3' },
      qualityTier: 'full',
      lastBootstrap: '2026-01-19T02:00:00.000Z',
      lastIndexing: '2026-01-19T03:00:00.000Z',
      totalFiles: 10,
      workspace,
      totalFunctions: 0,
      totalContextPacks: 0,
    });
    vi.mocked(getGitStatusChanges).mockResolvedValue({
      added: [],
      modified: ['src/changed.ts'],
      deleted: [],
    });
    mockStorage.getFileByPath.mockResolvedValue({ id: 'changed' });

    const exitCode = await statusCommand({ workspace, verbose: false, format: 'json' });
    expect(exitCode).toBe(1);
  });

  it('returns exit code 2 when storage is not initialized', async () => {
    vi.mocked(createSqliteStorage).mockReturnValue({
      ...mockStorage,
      initialize: vi.fn().mockRejectedValue(new Error('db missing')),
    } as unknown as LibrarianStorage);

    const exitCode = await statusCommand({ workspace, verbose: false, format: 'json' });
    expect(exitCode).toBe(2);
  });
});
