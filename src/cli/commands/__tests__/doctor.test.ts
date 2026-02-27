import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctorCommand } from '../doctor.js';
import { resolveDbPath } from '../../db_path.js';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import {
  isBootstrapRequired,
  getBootstrapStatus,
  bootstrapProject,
  createBootstrapConfig,
} from '../../../api/bootstrap.js';
import { checkAllProviders } from '../../../api/provider_check.js';
import { diagnoseConfiguration, autoHealConfiguration } from '../../../config/self_healing.js';
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
  bootstrapProject: vi.fn(),
  createBootstrapConfig: vi.fn(),
}));
vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn(),
}));
vi.mock('../../../config/self_healing.js', () => ({
  diagnoseConfiguration: vi.fn(),
  autoHealConfiguration: vi.fn(),
}));
vi.mock('../../../utils/workspace_resolver.js', () => ({
  resolveWorkspaceRoot: vi.fn(),
}));

const createStorageStub = (statsOverrides: Partial<{
  totalFunctions: number;
  totalEmbeddings: number;
  totalModules: number;
  totalContextPacks: number;
  averageConfidence: number;
  cacheHitRate: number;
  storageSizeBytes: number;
}> = {}, metadataOverrides: Partial<{
  version: { string: string };
  qualityTier: string;
  lastIndexing: string | Date | null;
}> = {}): LibrarianStorage => ({
  initialize: vi.fn().mockResolvedValue(undefined) as Mock,
  close: vi.fn().mockResolvedValue(undefined) as Mock,
  getMetadata: vi.fn().mockResolvedValue({
    version: { string: '1.0.0' },
    qualityTier: 'full',
    lastIndexing: new Date().toISOString(),
    ...metadataOverrides,
  }) as Mock,
  getStats: vi.fn().mockResolvedValue({
    totalFunctions: 10,
    totalEmbeddings: 10,
    totalModules: 5,
    totalContextPacks: 5,
    averageConfidence: 0.8,
    cacheHitRate: 0.5,
    storageSizeBytes: 1024,
    ...statsOverrides,
  }) as Mock,
  getContextPacks: vi.fn().mockResolvedValue([]) as Mock,
  getMultiVectors: vi.fn().mockResolvedValue([]) as Mock,
  getGraphEdges: vi.fn().mockResolvedValue([]) as Mock,
  inspectEmbeddingIntegrity: vi.fn().mockResolvedValue({
    totalEmbeddings: 10,
    invalidEmbeddings: 0,
    sampleEntityIds: [],
  }) as Mock,
  purgeInvalidEmbeddings: vi.fn().mockResolvedValue({
    removedEmbeddings: 0,
    removedMultiVectors: 0,
    sampleEntityIds: [],
  }) as Mock,
  getLastBootstrapReport: vi.fn().mockResolvedValue({
    success: true,
    completedAt: new Date().toISOString(),
  }) as Mock,
  getState: vi.fn().mockResolvedValue(null) as Mock,
} as unknown as LibrarianStorage);

function parseJsonReport(consoleLogSpy: ReturnType<typeof vi.spyOn>): any {
  const raw = consoleLogSpy.mock.calls
    .map((call) => call[0])
    .find((value) => typeof value === 'string') as string | undefined;
  expect(raw).toBeTruthy();
  return JSON.parse(raw!);
}

describe('doctorCommand', () => {
  const workspace = '/tmp/librarian-doctor-workspace';
  let dbPath: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    dbPath = path.join(os.tmpdir(), `librarian-doctor-${Date.now()}.db`);
    fs.writeFileSync(dbPath, '');

    vi.mocked(resolveDbPath).mockResolvedValue(dbPath);
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: workspace,
      workspace,
      changed: false,
      sourceFileCount: 0,
      reason: 'no_candidate',
    });
    vi.mocked(createSqliteStorage).mockImplementation(() => createStorageStub());
    vi.mocked(getBootstrapStatus).mockReturnValue({
      status: 'not_started',
      currentPhase: null,
      progress: 0,
      startedAt: null,
      completedAt: null,
    });
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'test-model', latencyMs: 10 },
      embedding: { available: true, provider: 'xenova', model: 'test-embed', latencyMs: 10 },
    });
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: true,
      healthScore: 1,
      issues: [],
      recommendations: [],
      autoFixable: [],
      generatedAt: new Date(),
      workspace,
      summary: {
        totalIssues: 0,
        criticalIssues: 0,
        autoFixableCount: 0,
        driftScore: 0,
        stalenessScore: 0,
      },
    });
    vi.mocked(autoHealConfiguration).mockResolvedValue({
      success: true,
      appliedFixes: [],
      failedFixes: [],
      newHealthScore: 1,
      durationMs: 0,
      timestamp: new Date(),
      rollbackAvailable: false,
    });
    vi.mocked(createBootstrapConfig).mockImplementation((root, overrides) => ({
      workspace: root,
      ...overrides,
    }) as any);
    vi.mocked(bootstrapProject).mockResolvedValue({
      success: true,
      totalFilesProcessed: 0,
      totalFunctionsIndexed: 0,
      totalContextPacksCreated: 0,
      phases: [],
    } as any);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.useRealTimers();
    process.env.HOME = originalHome;
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('does not auto-heal or bootstrap when --heal is not set', async () => {
    await doctorCommand({ workspace, json: true });

    expect(vi.mocked(autoHealConfiguration)).not.toHaveBeenCalled();
    expect(vi.mocked(bootstrapProject)).not.toHaveBeenCalled();
  });

  it('runs DB-backed checks sequentially to avoid self-lock contention', async () => {
    let activeInitializations = 0;
    let maxConcurrentInitializations = 0;

    vi.mocked(createSqliteStorage).mockImplementation(() => {
      const storage = createStorageStub() as unknown as { initialize: Mock };
      storage.initialize = vi.fn(async () => {
        activeInitializations += 1;
        maxConcurrentInitializations = Math.max(maxConcurrentInitializations, activeInitializations);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeInitializations -= 1;
      });
      return storage as unknown as LibrarianStorage;
    });

    await doctorCommand({ workspace, json: true });

    expect(maxConcurrentInitializations).toBe(1);
    const report = parseJsonReport(consoleLogSpy);
    const dbCheck = report.checks.find((check: { name: string }) => check.name === 'Database Access');
    expect(dbCheck).toBeTruthy();
    expect(dbCheck.status).toBe('OK');
  });

  it('releases storage handles when DB-backed checks throw after initialize', async () => {
    const storages: Array<{
      initialize: Mock;
      close: Mock;
      getStats: Mock;
    }> = [];

    vi.mocked(createSqliteStorage).mockImplementation(() => {
      const storage = createStorageStub() as unknown as {
        initialize: Mock;
        close: Mock;
        getStats: Mock;
      };
      storage.getStats = vi.fn().mockRejectedValue(new Error('forced-get-stats-failure'));
      storages.push(storage);
      return storage as unknown as LibrarianStorage;
    });

    await doctorCommand({ workspace, json: true });

    expect(storages.length).toBeGreaterThan(0);
    const leaked = storages.filter((storage) =>
      storage.initialize.mock.calls.length > 0 && storage.close.mock.calls.length === 0
    );
    expect(leaked).toHaveLength(0);
  });

  it('runs strict referential integrity checks when requested', async () => {
    await doctorCommand({ workspace, json: true, checkConsistency: true });

    const report = parseJsonReport(consoleLogSpy);
    expect(report.checks.some((check: { name: string }) => check.name === 'Cross-DB Referential Integrity')).toBe(true);
  });

  it('does not error on low confidence when no functions are indexed', async () => {
    vi.mocked(createSqliteStorage).mockImplementation(() => createStorageStub({
      totalFunctions: 0,
      totalModules: 1,
      averageConfidence: 0,
    }));

    await doctorCommand({ workspace, json: true });

    const raw = consoleLogSpy.mock.calls.map((call) => call[0]).find((value) => typeof value === 'string') as string | undefined;
    expect(raw).toBeTruthy();
    const report = JSON.parse(raw!);
    const confidence = report.checks.find((check: any) => check.name === 'Knowledge Confidence');
    expect(confidence).toBeTruthy();
    expect(confidence.status).not.toBe('ERROR');
  });

  it('runs config heal and bootstrap recovery when requested', async () => {
    vi.mocked(diagnoseConfiguration).mockResolvedValue({
      isOptimal: false,
      healthScore: 0.4,
      issues: [],
      recommendations: [],
      autoFixable: [
        {
          id: 'fix-1',
          issueId: 'issue-1',
          changes: [],
          riskLevel: 'low',
          requiresConfirmation: false,
        },
      ],
      generatedAt: new Date(),
      workspace,
      summary: {
        totalIssues: 1,
        criticalIssues: 0,
        autoFixableCount: 1,
        driftScore: 0.2,
        stalenessScore: 0.1,
      },
    });
    vi.mocked(isBootstrapRequired).mockResolvedValue({
      required: true,
      reason: 'missing index',
    });
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: false, provider: 'claude', model: 'test-model', latencyMs: 10, error: 'missing' },
      embedding: { available: false, provider: 'xenova', model: 'test-embed', latencyMs: 10, error: 'missing' },
    });

    await doctorCommand({ workspace, json: true, heal: true, riskTolerance: 'safe' });

    expect(vi.mocked(autoHealConfiguration)).toHaveBeenCalledWith(workspace, { riskTolerance: 'safe' });
    expect(vi.mocked(bootstrapProject)).toHaveBeenCalled();
    const bootstrapConfig = vi.mocked(bootstrapProject).mock.calls[0]?.[0] as { skipEmbeddings?: boolean; skipLlm?: boolean; bootstrapMode?: string };
    expect(bootstrapConfig.skipEmbeddings).toBe(true);
    expect(bootstrapConfig.skipLlm).toBe(true);
    expect(bootstrapConfig.bootstrapMode).toBe('fast');
  });

  it('reports watch freshness degradation when watch state is stale', async () => {
    const now = new Date('2026-02-05T18:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(createSqliteStorage).mockImplementation(() => {
      const storage = createStorageStub() as unknown as { getState: Mock };
      storage.getState = vi.fn().mockResolvedValue(JSON.stringify({
        schema_version: 1,
        workspace_root: workspace,
        watch_last_heartbeat_at: new Date(now.getTime() - 120_000).toISOString(),
        watch_last_reindex_ok_at: new Date(now.getTime() - 120_000).toISOString(),
        suspected_dead: true,
        needs_catchup: true,
        storage_attached: true,
        cursor: { kind: 'fs', lastReconcileCompletedAt: new Date(now.getTime() - 120_000).toISOString() },
      }));
      return storage as unknown as LibrarianStorage;
    });

    await doctorCommand({ workspace, json: true });

    const raw = consoleLogSpy.mock.calls.map((call) => call[0]).find((value) => typeof value === 'string') as string | undefined;
    expect(raw).toBeTruthy();
    const report = JSON.parse(raw!);
    const watchCheck = report.checks.find((check: any) => check.name === 'Watch Freshness');
    expect(watchCheck).toBeTruthy();
    expect(watchCheck.status).toBe('WARNING');
    expect(watchCheck.message).toContain('suspected dead');
    vi.useRealTimers();
  });

  it('uses resolved workspace when auto-detect changes', async () => {
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: workspace,
      workspace: '/resolved/workspace',
      changed: true,
      reason: 'marker:package.json',
      confidence: 0.8,
      marker: 'package.json',
      sourceFileCount: 0,
      candidateFileCount: 42,
    });

    await doctorCommand({ workspace, json: true });

    expect(resolveDbPath).toHaveBeenCalledWith('/resolved/workspace');
    const raw = consoleLogSpy.mock.calls.map((call) => call[0]).find((value) => typeof value === 'string') as string | undefined;
    expect(raw).toBeTruthy();
    const report = JSON.parse(raw!);
    expect(report.workspace).toBe('/resolved/workspace');
    expect(report.workspaceOriginal).toBe(workspace);
  });

  it('flags watch errors when last_error is present', async () => {
    const now = new Date('2026-02-05T18:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(createSqliteStorage).mockImplementation(() => {
      const storage = createStorageStub() as unknown as { getState: Mock };
      storage.getState = vi.fn().mockResolvedValue(JSON.stringify({
        schema_version: 1,
        workspace_root: workspace,
        watch_last_heartbeat_at: new Date(now.getTime() - 10_000).toISOString(),
        watch_last_reindex_ok_at: new Date(now.getTime() - 10_000).toISOString(),
        suspected_dead: false,
        needs_catchup: false,
        storage_attached: true,
        last_error: 'watcher crashed',
        cursor: { kind: 'fs', lastReconcileCompletedAt: new Date(now.getTime() - 10_000).toISOString() },
      }));
      return storage as unknown as LibrarianStorage;
    });

    await doctorCommand({ workspace, json: true });

    const raw = consoleLogSpy.mock.calls.map((call) => call[0]).find((value) => typeof value === 'string') as string | undefined;
    expect(raw).toBeTruthy();
    const report = JSON.parse(raw!);
    const watchCheck = report.checks.find((check: any) => check.name === 'Watch Freshness');
    expect(watchCheck.status).toBe('WARNING');
    expect(watchCheck.message).toContain('last error');
    vi.useRealTimers();
  });

  it('flags stale index freshness when source files are newer than the index', async () => {
    const now = new Date('2026-02-06T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const dynamicWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-doctor-freshness-'));
    fs.mkdirSync(path.join(dynamicWorkspace, 'src'), { recursive: true });
    const sourceFile = path.join(dynamicWorkspace, 'src', 'app.ts');
    fs.writeFileSync(sourceFile, 'export const health = true;\n', 'utf8');

    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: dynamicWorkspace,
      workspace: dynamicWorkspace,
      changed: false,
      sourceFileCount: 1,
      reason: 'explicit',
    });
    vi.mocked(createSqliteStorage).mockImplementation(() => createStorageStub({}, {
      lastIndexing: new Date(now.getTime() - (72 * 60 * 60_000)).toISOString(),
    }));

    await doctorCommand({ workspace: dynamicWorkspace, json: true });

    const report = parseJsonReport(consoleLogSpy);
    const freshness = report.checks.find((check: any) => check.name === 'Index Freshness');
    expect(freshness).toBeTruthy();
    expect(freshness.status).toBe('WARNING');
    expect(freshness.message).toContain('stale');

    fs.rmSync(dynamicWorkspace, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('reports stale lock files in lock directories', async () => {
    const dynamicWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-doctor-locks-'));
    const locksDir = path.join(dynamicWorkspace, '.librarian', 'locks');
    fs.mkdirSync(locksDir, { recursive: true });
    fs.writeFileSync(path.join(locksDir, 'stale.lock'), JSON.stringify({ pid: 999999 }), 'utf8');

    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: dynamicWorkspace,
      workspace: dynamicWorkspace,
      changed: false,
      sourceFileCount: 0,
      reason: 'explicit',
    });

    await doctorCommand({ workspace: dynamicWorkspace, json: true });

    const report = parseJsonReport(consoleLogSpy);
    const lockCheck = report.checks.find((check: any) => check.name === 'Lock File Staleness');
    expect(lockCheck).toBeTruthy();
    expect(lockCheck.status).toBe('WARNING');
    expect(lockCheck.message).toContain('stale lock');

    fs.rmSync(dynamicWorkspace, { recursive: true, force: true });
  });

  it('flags missing librarian MCP registration when config exists', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'librarian-doctor-home-'));
    process.env.HOME = homeDir;
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
      mcpServers: {
        otherTool: { command: 'node', args: ['other.js'] },
      },
    }), 'utf8');

    await doctorCommand({ workspace, json: true });

    const report = parseJsonReport(consoleLogSpy);
    const mcpCheck = report.checks.find((check: any) => check.name === 'MCP Registration');
    expect(mcpCheck).toBeTruthy();
    expect(mcpCheck.status).toBe('WARNING');
    expect(mcpCheck.message).toContain('not registered');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('marks embedding coverage below 20% as error', async () => {
    vi.mocked(createSqliteStorage).mockImplementation(() => createStorageStub({
      totalFunctions: 10,
      totalEmbeddings: 1,
    }));

    await doctorCommand({ workspace, json: true });

    const report = parseJsonReport(consoleLogSpy);
    const embeddingCheck = report.checks.find((check: any) => check.name === 'Functions/Embeddings Correlation');
    expect(embeddingCheck).toBeTruthy();
    expect(embeddingCheck.status).toBe('ERROR');
    expect(embeddingCheck.message).toContain('Critical embedding coverage');
  });

  it('emits machine-actionable actions for failing checks', async () => {
    vi.mocked(resolveDbPath).mockRejectedValueOnce(new Error('permission denied'));

    await doctorCommand({ workspace, json: true });

    const raw = consoleLogSpy.mock.calls.map((call) => call[0]).find((value) => typeof value === 'string') as string | undefined;
    expect(raw).toBeTruthy();
    const report = JSON.parse(raw!);
    expect(Array.isArray(report.actions)).toBe(true);
    expect(report.actions.length).toBeGreaterThan(0);
    expect(report.actions[0].command).toContain('librarian bootstrap --force');
  });

  it('reports invalid embeddings and suggests doctor --fix', async () => {
    vi.mocked(createSqliteStorage).mockImplementation(() => {
      const storage = createStorageStub() as unknown as {
        inspectEmbeddingIntegrity: Mock;
      };
      storage.inspectEmbeddingIntegrity = vi.fn().mockResolvedValue({
        totalEmbeddings: 5,
        invalidEmbeddings: 2,
        sampleEntityIds: ['fn-1', 'fn-2'],
      });
      return storage as unknown as LibrarianStorage;
    });

    await doctorCommand({ workspace, json: true });

    const report = parseJsonReport(consoleLogSpy);
    const integrityCheck = report.checks.find((check: any) => check.name === 'Embedding Integrity');
    expect(integrityCheck).toBeTruthy();
    expect(integrityCheck.status).toBe('WARNING');
    expect(integrityCheck.suggestion).toContain('--fix');
  });

  it('runs invalid-embedding remediation when fix is enabled', async () => {
    const storage = createStorageStub() as unknown as {
      inspectEmbeddingIntegrity: Mock;
      purgeInvalidEmbeddings: Mock;
    };
    storage.inspectEmbeddingIntegrity = vi.fn().mockResolvedValue({
      totalEmbeddings: 7,
      invalidEmbeddings: 3,
      sampleEntityIds: ['fn-1'],
    });
    storage.purgeInvalidEmbeddings = vi.fn().mockResolvedValue({
      removedEmbeddings: 3,
      removedMultiVectors: 1,
      sampleEntityIds: ['fn-1'],
    });
    vi.mocked(createSqliteStorage).mockImplementation(() => storage as unknown as LibrarianStorage);

    await doctorCommand({ workspace, json: true, fix: true });

    expect(storage.purgeInvalidEmbeddings).toHaveBeenCalled();
    expect(vi.mocked(bootstrapProject)).toHaveBeenCalled();
  });

  it('binds storage context when inspecting embedding integrity', async () => {
    const storage = createStorageStub() as unknown as {
      ensureDb: Mock;
      inspectEmbeddingIntegrity: Mock;
    };
    storage.ensureDb = vi.fn();
    storage.inspectEmbeddingIntegrity = vi.fn(function (this: { ensureDb?: Mock }) {
      this.ensureDb?.();
      return Promise.resolve({
        totalEmbeddings: 4,
        invalidEmbeddings: 0,
        sampleEntityIds: [],
      });
    });
    vi.mocked(createSqliteStorage).mockImplementation(() => storage as unknown as LibrarianStorage);

    await doctorCommand({ workspace, json: true });

    const report = parseJsonReport(consoleLogSpy);
    const integrityCheck = report.checks.find((check: any) => check.name === 'Embedding Integrity');
    expect(integrityCheck).toBeTruthy();
    expect(integrityCheck.status).toBe('OK');
    expect(storage.ensureDb).toHaveBeenCalled();
  });
});
