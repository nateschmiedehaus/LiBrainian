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

    await statusCommand({ workspace, verbose: false, format: 'json' });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    expect(typeof output).toBe('string');
    const parsed = JSON.parse(output ?? '{}') as { workspace?: string; storage?: { status?: string } };
    expect(parsed.workspace).toBe(workspace);
    expect(parsed.storage?.status).toBe('ready');
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
});
