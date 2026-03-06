/**
 * @fileoverview Tests for query command LLM resolution behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

vi.mock('../../../api/query.js', () => ({
  queryLibrarian: vi.fn().mockResolvedValue({
    intent: 'test',
    depth: 'L1',
    totalConfidence: 0.5,
    cacheHit: false,
    latencyMs: 10,
    packs: [],
  }),
}));

vi.mock('../../../api/bootstrap.js', () => ({
  isBootstrapRequired: vi.fn().mockResolvedValue({ required: false, reason: 'ok' }),
  bootstrapProject: vi.fn().mockResolvedValue({ success: true }),
  createBootstrapConfig: vi.fn((workspace: string, overrides: Record<string, unknown> = {}) => ({
    workspace,
    include: [],
    exclude: [],
    ...overrides,
  })),
}));

vi.mock('../../../api/versioning.js', () => ({
  detectLibrarianVersion: vi.fn().mockResolvedValue({ qualityTier: 'full' }),
}));

vi.mock('../../db_path.js', () => ({
  resolveDbPath: vi.fn().mockResolvedValue('/tmp/librarian.sqlite'),
}));

vi.mock('../../../storage/sqlite_storage.js', () => ({
  createSqliteStorage: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue({
      totalFunctions: 100,
      totalModules: 10,
      totalEmbeddings: 100,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../constructions/enumeration.js', () => ({
  detectEnumerationIntent: vi.fn().mockReturnValue({ isEnumeration: false, confidence: 0 }),
  shouldUseEnumerationMode: vi.fn().mockReturnValue(false),
  enumerateByCategory: vi.fn(),
  formatEnumerationResult: vi.fn(),
}));

vi.mock('../../../api/dependency_query.js', () => ({
  parseStructuralQueryIntent: vi.fn().mockReturnValue({ isStructural: false }),
  executeExhaustiveDependencyQuery: vi.fn(),
  shouldUseExhaustiveMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../progress.js', () => ({
  createSpinner: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn(), update: vi.fn() })),
  formatDuration: vi.fn((ms: number) => `${ms}ms`),
  printKeyValue: vi.fn(),
}));

vi.mock('../../../api/llm_env.js', () => ({
  resolveLibrarianModelConfigWithDiscovery: vi.fn().mockRejectedValue(new Error('no providers')),
}));

vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn().mockResolvedValue({
    llm: { available: false, provider: 'unknown', model: 'unknown' },
    embedding: { available: true, provider: 'xenova', model: 'test-embed' },
  }),
}));

describe('queryCommand LLM resolution', () => {
  const prevEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.LIBRARIAN_LLM_MODEL;

    const { resolveDbPath } = await import('../../db_path.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    vi.mocked(resolveDbPath).mockResolvedValue('/tmp/librarian.sqlite');
    vi.mocked(createSqliteStorage).mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 100,
        totalModules: 10,
        totalEmbeddings: 100,
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);
    vi.mocked(queryLibrarian).mockResolvedValue({
      intent: 'test',
      depth: 'L1',
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      packs: [],
    } as any);
    vi.mocked(isBootstrapRequired).mockResolvedValue({ required: false, reason: 'ok' });
    vi.mocked(bootstrapProject).mockResolvedValue({ success: true } as any);
  });

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = null;
    process.env = { ...prevEnv };
  });

  it('disables synthesis when no LLM config is available', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.llmRequirement).toBe('disabled');
    expect(process.env.LIBRARIAN_LLM_PROVIDER).toBeUndefined();
  });

  it('continues with the existing index snapshot when bootstrap is required but the index is usable', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject, createBootstrapConfig } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({ required: true, reason: 'missing' });

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    expect(bootstrapProject).not.toHaveBeenCalled();
    expect(vi.mocked(createBootstrapConfig).mock.calls).toHaveLength(0);
  });

  it('skips auto-bootstrap and uses semantic fallback when no usable index exists', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({ required: true, reason: 'missing' });
    vi.mocked(createSqliteStorage).mockReturnValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 0,
        totalModules: 0,
        totalEmbeddings: 0,
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    expect(bootstrapProject).not.toHaveBeenCalled();
  });

  it('maps governor wall-time bootstrap timeout to QUERY_TIMEOUT', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({
      required: true,
      reason: 'Watch state indicates catch-up is required before queries can be trusted',
    });
    vi.mocked(bootstrapProject).mockRejectedValueOnce(
      new Error('unverified_by_trace(budget_exhausted): Exceeded wall_time budget (health: -0.72)')
    );

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--timeout', '5000', '--json'],
    })).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
  });

  it('recovers corrupted storage during bootstrap and retries bootstrap once', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-bootstrap-recovery-'));
    const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, 'corrupt', 'utf8');
    vi.mocked(resolveDbPath).mockResolvedValueOnce(dbPath);
    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({
      required: true,
      reason: 'Watch state indicates catch-up is required before queries can be trusted',
    });

    const firstStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ totalFunctions: 100, totalModules: 10, totalEmbeddings: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ totalFunctions: 100, totalModules: 10, totalEmbeddings: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createSqliteStorage)
      .mockReturnValueOnce(firstStorage as any)
      .mockReturnValueOnce(secondStorage as any);
    vi.mocked(bootstrapProject)
      .mockRejectedValueOnce(new Error('database disk image is malformed'))
      .mockResolvedValueOnce({ success: true } as any);

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json'],
      });
      expect(bootstrapProject).toHaveBeenCalledTimes(2);
      expect(firstStorage.close).toHaveBeenCalledTimes(1);
      expect(secondStorage.initialize).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('falls through to auto-bootstrap when watch catch-up is required (deferred reason)', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({
      required: true,
      reason: 'Watch state indicates catch-up is required before queries can be trusted',
    });
    vi.mocked(bootstrapProject).mockResolvedValueOnce({ success: true } as any);

    // deferred reasons (watch_catchup etc.) no longer throw NOT_BOOTSTRAPPED;
    // they log a warning and fall through to auto-bootstrap so the query can recover.
    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    expect(bootstrapProject).toHaveBeenCalled();
  });

  it('respects --no-bootstrap', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({ required: true, reason: 'missing' });

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--no-bootstrap', '--json'],
    })).rejects.toMatchObject({ code: 'NOT_BOOTSTRAPPED' });

    expect(bootstrapProject).not.toHaveBeenCalled();
  });

  it('parses intent from command args when raw argv includes pre-command globals', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: ['hello world', '--json'],
      rawArgs: ['--workspace', '/tmp/workspace', 'query', 'hello world', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.intent).toBe('hello world');
  });

  it('preserves --files values when raw argv includes pre-command globals', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = '/tmp/workspace';

    await queryCommand({
      workspace,
      args: ['hello world', '--files', 'src/a.ts,src/b.ts', '--json'],
      rawArgs: ['--workspace', workspace, 'query', 'hello world', '--files', 'src/a.ts,src/b.ts', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.intent).toBe('hello world');
    expect(call?.affectedFiles).toEqual([
      path.resolve(workspace, 'src/a.ts'),
      path.resolve(workspace, 'src/b.ts'),
    ]);
  });

  it('does not swallow mixed-order query flags into intent text', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = '/tmp/workspace';

    await queryCommand({
      workspace,
      args: ['--strategy', 'heuristic', 'hello world', '--json'],
      rawArgs: ['--workspace', workspace, 'query', '--strategy', 'heuristic', 'hello world', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.intent).toBe('hello world');
    expect(call?.embeddingRequirement).toBe('disabled');
    expect(call?.llmRequirement).toBe('disabled');
  });

  it('does not swallow --format json into intent text', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = '/tmp/workspace';

    await queryCommand({
      workspace,
      args: ['--format', 'json', 'hello world'],
      rawArgs: ['--workspace', workspace, 'query', '--format', 'json', 'hello world'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.intent).toBe('hello world');
  });

  it('maps --strategy heuristic to disabled embeddings and synthesis', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--strategy', 'heuristic', '--json'],
    });

    const call = vi.mocked(queryLibrarian).mock.calls[0]?.[0];
    expect(call?.embeddingRequirement).toBe('disabled');
    expect(call?.llmRequirement).toBe('disabled');
  });

  it('allows query execution when an active storage lock holder exists (read-concurrent mode)', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-lock-active-'));
    const librarianDir = path.join(workspace, '.librarian');
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const lockPath = `${sqlitePath}.lock`;
    const lockHolder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], {
      stdio: 'ignore',
    });
    const holderPid = lockHolder.pid;
    if (!holderPid) {
      lockHolder.kill('SIGKILL');
      throw new Error('expected spawned lock holder pid');
    }

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(
        lockPath,
        JSON.stringify({
          pid: holderPid,
          startedAt: '2026-02-26T00:00:00.000Z',
        }),
        'utf8',
      );
      vi.mocked(resolveDbPath).mockResolvedValueOnce(sqlitePath);

      await expect(queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json', '--lock-timeout-ms', '25'],
      })).resolves.toBeUndefined();

      const storageCall = vi.mocked(createSqliteStorage).mock.calls[0];
      expect(storageCall?.[2]).toMatchObject({ useProcessLock: false });
    } finally {
      lockHolder.kill('SIGKILL');
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('waits briefly for active lock holders to clear before running query', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-lock-wait-'));
    const librarianDir = path.join(workspace, '.librarian');
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const lockPath = `${sqlitePath}.lock`;
    const lockHolder = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 160)'], {
      stdio: 'ignore',
    });
    const holderPid = lockHolder.pid;
    if (!holderPid) {
      lockHolder.kill('SIGKILL');
      throw new Error('expected spawned lock holder pid');
    }

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(
        lockPath,
        JSON.stringify({
          pid: holderPid,
          startedAt: '2026-02-26T00:00:00.000Z',
        }),
        'utf8',
      );
      vi.mocked(resolveDbPath).mockResolvedValueOnce(sqlitePath);

      await expect(queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json', '--lock-timeout-ms', '1200'],
      })).resolves.toBeUndefined();
    } finally {
      lockHolder.kill('SIGKILL');
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('auto-recovers stale bootstrap lock artifacts before query execution', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-bootstrap-lock-stale-'));
    const librarianDir = path.join(workspace, '.librarian');
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const bootstrapLockPath = path.join(librarianDir, 'bootstrap.lock');

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(
        bootstrapLockPath,
        JSON.stringify({
          pid: 999999,
          startedAt: '2026-02-26T00:00:00.000Z',
        }),
        'utf8',
      );
      vi.mocked(resolveDbPath).mockResolvedValueOnce(sqlitePath);

      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json'],
      });

      await expect(fs.access(bootstrapLockPath)).rejects.toBeDefined();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('uses the preserved bootstrap snapshot while an active bootstrap lock is held', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-bootstrap-snapshot-'));
    const librarianDir = path.join(workspace, '.librarian');
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const backupPath = `${sqlitePath}.bak.test`;
    const bootstrapLockPath = path.join(librarianDir, 'bootstrap.lock');
    const backupStatePath = path.join(librarianDir, 'bootstrap_artifact_backup.json');
    const lockHolder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore',
      detached: false,
    });

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(sqlitePath, 'primary', 'utf8');
      await fs.writeFile(backupPath, 'backup', 'utf8');
      await fs.writeFile(
        bootstrapLockPath,
        JSON.stringify({
          pid: lockHolder.pid,
          startedAt: '2026-03-06T19:29:38.878Z',
        }),
        'utf8',
      );
      await fs.writeFile(
        backupStatePath,
        JSON.stringify({
          kind: 'BootstrapArtifactBackupState.v1',
          schema_version: 1,
          workspace,
          generation_id: 'snapshot-test',
          created_at: '2026-03-06T19:29:47.161Z',
          files: [
            {
              original_path: sqlitePath,
              backup_path: backupPath,
            },
          ],
        }),
        'utf8',
      );
      vi.mocked(resolveDbPath).mockResolvedValueOnce(sqlitePath);

      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json'],
      });

      const storageCall = vi.mocked(createSqliteStorage).mock.calls[0];
      expect(storageCall?.[0]).toBe(backupPath);
      expect(storageCall?.[2]).toMatchObject({ useProcessLock: false });
    } finally {
      lockHolder.kill('SIGKILL');
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('auto-recovers stale legacy lock artifacts before query execution', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-lock-stale-'));
    const librarianDir = path.join(workspace, '.librarian');
    const sqlitePath = path.join(librarianDir, 'librarian.sqlite');
    const legacyPath = path.join(librarianDir, 'librarian.db');
    const legacyLockPath = `${legacyPath}.lock`;
    const legacyWalPath = `${legacyPath}-wal`;
    const legacyShmPath = `${legacyPath}-shm`;

    try {
      await fs.mkdir(librarianDir, { recursive: true });
      await fs.writeFile(legacyLockPath, JSON.stringify({ pid: 999999 }), 'utf8');
      await fs.writeFile(legacyWalPath, 'wal', 'utf8');
      await fs.writeFile(legacyShmPath, 'shm', 'utf8');
      vi.mocked(resolveDbPath).mockResolvedValueOnce(sqlitePath);

      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json'],
      });

      await expect(fs.access(legacyLockPath)).rejects.toBeDefined();
      await expect(fs.access(legacyWalPath)).resolves.toBeUndefined();
      await expect(fs.access(legacyShmPath)).resolves.toBeUndefined();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('recovers corrupted storage during initialization and retries query once', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-init-recovery-'));
    const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, 'corrupt', 'utf8');
    vi.mocked(resolveDbPath).mockResolvedValueOnce(dbPath);

    const firstStorage = {
      initialize: vi.fn().mockRejectedValueOnce(new Error('database disk image is malformed')),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ totalFunctions: 100, totalModules: 10, totalEmbeddings: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ totalFunctions: 100, totalModules: 10, totalEmbeddings: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createSqliteStorage)
      .mockReturnValueOnce(firstStorage as any)
      .mockReturnValueOnce(secondStorage as any);

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json'],
      });
      expect(vi.mocked(queryLibrarian)).toHaveBeenCalledTimes(1);
      expect(firstStorage.close).toHaveBeenCalledTimes(1);
      expect(secondStorage.initialize).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('recovers corrupted storage during query execution and retries once', async () => {
    const { queryCommand } = await import('../query.js');
    const { resolveDbPath } = await import('../../db_path.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-exec-recovery-'));
    const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, 'corrupt', 'utf8');
    vi.mocked(resolveDbPath).mockResolvedValueOnce(dbPath);

    const firstStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ totalFunctions: 100, totalModules: 10, totalEmbeddings: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ totalFunctions: 100, totalModules: 10, totalEmbeddings: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createSqliteStorage)
      .mockReturnValueOnce(firstStorage as any)
      .mockReturnValueOnce(secondStorage as any);

    vi.mocked(queryLibrarian)
      .mockRejectedValueOnce(new Error('database disk image is malformed'))
      .mockResolvedValueOnce({
        intent: 'test',
        depth: 'L1',
        totalConfidence: 0.5,
        cacheHit: false,
        latencyMs: 10,
        packs: [],
      } as any);

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'hello world', '--json'],
      });
      expect(vi.mocked(queryLibrarian)).toHaveBeenCalledTimes(2);
      expect(firstStorage.close).toHaveBeenCalledTimes(1);
      expect(secondStorage.initialize).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('blocks --strategy semantic when embedding coverage is below threshold', async () => {
    const { queryCommand } = await import('../query.js');
    const { createSqliteStorage } = await import('../../../storage/sqlite_storage.js');

    vi.mocked(createSqliteStorage).mockReturnValueOnce({
      initialize: vi.fn().mockResolvedValue(undefined),
      getState: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 100,
        totalModules: 10,
        totalEmbeddings: 20,
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--strategy', 'semantic', '--json'],
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_EMBEDDING_COVERAGE' });
  });

  it('applies --limit to JSON output packs', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [],
      drillDownHints: [],
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 't1', summary: 'a', keyFacts: [], relatedFiles: [], codeSnippets: [], confidence: 0.8, createdAt: new Date(), version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() } },
        { packId: 'p2', packType: 'function_context', targetId: 't2', summary: 'b', keyFacts: [], relatedFiles: [], codeSnippets: [], confidence: 0.7, createdAt: new Date(), version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() } },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--limit', '1', '--json'],
    });

    const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}');
    expect(parsed.packs).toHaveLength(1);
  });

  it('includes a derived answer in JSON output when synthesis is unavailable', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      explanation: 'Security risk score is computed in technical_debt_analysis.ts and rendered in persona views.',
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [],
      drillDownHints: [],
      synthesis: undefined,
      packs: [
        {
          packId: 'p1',
          packType: 'function_context',
          targetId: 't1',
          summary: 'calculateSecurityDebt computes the risk score.',
          keyFacts: [],
          relatedFiles: [],
          codeSnippets: [],
          confidence: 0.8,
          createdAt: new Date(),
          version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
        },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}');
    expect(parsed.answer).toBe('calculateSecurityDebt computes the risk score.');
  });

  it('prefers the primary source file in derived location answers', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'Where is the query pipeline implemented?', depth: 'L1' },
      totalConfidence: 0.9,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [],
      drillDownHints: [],
      synthesis: undefined,
      packs: [
        {
          packId: 'p1',
          packType: 'module_context',
          targetId: '/tmp/workspace/src/api/query.ts',
          summary: 'query pipeline module',
          keyFacts: [],
          relatedFiles: ['src/storage/types.js', 'src/types.js'],
          codeSnippets: [
            {
              filePath: '/tmp/workspace/src/api/query.ts',
              startLine: 1,
              endLine: 5,
              content: 'export function queryLibrarian() {}',
              language: 'typescript',
            },
          ],
          confidence: 0.95,
          createdAt: new Date(),
          version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
        },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'Where is the query pipeline implemented?', '--json'],
    });

    const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}');
    expect(parsed.answer).toContain('src/api/query.ts');
    expect(parsed.answer).not.toContain('src/storage/types.js');
  });

  it('writes JSON output to --out path', async () => {
    const { queryCommand } = await import('../query.js');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-out-'));
    const outPath = path.join(tmpDir, 'query.json');

    try {
      await queryCommand({
        workspace: '/tmp/workspace',
        args: [],
        rawArgs: ['query', 'hello world', '--json', '--out', outPath],
      });

      const raw = await fs.readFile(outPath, 'utf8');
      const parsed = JSON.parse(raw) as { strategy?: string };
      expect(typeof parsed.strategy).toBe('string');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('sanitizes unverified trace markers in JSON output fields', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: ['unverified_by_trace(storage_write_degraded): Session degraded due to lock contention.'],
      traceId: 'unverified_by_trace(replay_unavailable)',
      llmError: 'unverified_by_trace(provider_unavailable): Embedding provider unavailable',
      coverageGaps: ['unverified_by_trace(provider_unavailable): Embedding provider unavailable'],
      methodHints: ['unverified_by_trace(provider_unavailable): Try provider diagnostics.'],
      drillDownHints: ['unverified_by_trace(provider_unavailable): Retry after provider setup.'],
      packs: [
        {
          packId: 'p1',
          packType: 'function_context',
          targetId: 't1',
          summary: 'unverified_by_trace(provider_unavailable): Structural-only summary.',
          keyFacts: ['unverified_by_trace(provider_unavailable): fact'],
          relatedFiles: [],
          codeSnippets: [],
          confidence: 0.8,
          createdAt: new Date(),
          version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
        },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json'],
    });

    const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput ?? '{}');

    expect(parsed.disclosures).toEqual(['Session degraded due to lock contention.']);
    expect(parsed.traceId).toBe('replay_unavailable');
    expect(parsed.llmError).toBe('Embedding provider unavailable');
    expect(parsed.coverageGaps?.[0]).toBe('Embedding provider unavailable');
    expect(parsed.methodHints?.[0]).toBe('Try provider diagnostics.');
    expect(parsed.drillDownHints?.[0]).toBe('Retry after provider setup.');
    expect(parsed.packs?.[0]?.summary).toBe('Structural-only summary.');
    expect(parsed.packs?.[0]?.keyFacts?.[0]).toBe('fact');
  });

  it('rejects --out without --json', async () => {
    const { queryCommand } = await import('../query.js');
    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--out', '/tmp/query.json'],
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('allows --out when --format json is used', async () => {
    const { queryCommand } = await import('../query.js');
    const workspace = '/tmp/workspace';
    const outPath = path.join(workspace, 'query-output.json');

    await expect(queryCommand({
      workspace,
      args: ['hello world', '--format', 'json', '--out', outPath],
      rawArgs: ['query', 'hello world', '--format', 'json', '--out', outPath],
    })).resolves.toBeUndefined();
  });

  it('starts a persistent session with --session new', async () => {
    const { queryCommand } = await import('../query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });

      const jsonOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput ?? '{}') as { mode?: string; sessionId?: string };
      expect(parsed.mode).toBe('start');
      expect(parsed.sessionId).toMatch(/^sess_/);

      const sessionPath = path.join(workspace, '.librarian', 'query_sessions', `${parsed.sessionId}.json`);
      const stored = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as { session?: { sessionId?: string } };
      expect(stored.session?.sessionId).toBe(parsed.sessionId);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('continues a persisted session with follow-up intent', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });
      const startOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const started = JSON.parse(startOutput ?? '{}') as { sessionId?: string };
      expect(started.sessionId).toBeTruthy();

      logSpy?.mockClear();
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'token refresh details', '--session', started.sessionId!, '--json'],
      });
      const followUpOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const followUp = JSON.parse(followUpOutput ?? '{}') as { mode?: string; sessionId?: string };
      expect(followUp.mode).toBe('follow_up');
      expect(followUp.sessionId).toBe(started.sessionId);

      const intents = vi.mocked(queryLibrarian).mock.calls.map((call) => call[0]?.intent);
      expect(intents).toContain('token refresh details');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('supports drill-down in persisted sessions without requiring intent text', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-session-'));

    try {
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', 'auth overview', '--session', 'new', '--json'],
      });
      const startOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const started = JSON.parse(startOutput ?? '{}') as { sessionId?: string };
      expect(started.sessionId).toBeTruthy();

      logSpy?.mockClear();
      await queryCommand({
        workspace,
        args: [],
        rawArgs: ['query', '--session', started.sessionId!, '--drill-down', 'src/auth/session.ts', '--json'],
      });
      const drillOutput = logSpy?.mock.calls.map((call) => String(call[0])).find((line) => line.trim().startsWith('{'));
      const drill = JSON.parse(drillOutput ?? '{}') as { mode?: string };
      expect(drill.mode).toBe('drill_down');

      const intents = vi.mocked(queryLibrarian).mock.calls.map((call) => call[0]?.intent);
      expect(intents).toContain('Drill down: src/auth/session.ts');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('surfaces critical storage and synthesis warnings before coverage gaps', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [
        'unverified_by_trace(storage_write_degraded): Session degraded: results were returned but could not be persisted.',
      ],
      drillDownHints: [
        'Session degraded: results were returned but could not be persisted (storage lock compromised). Run `librarian doctor --heal` to recover.',
      ],
      coverageGaps: [
        'Synthesis failed: Claude CLI error',
      ],
      llmError: 'Claude CLI error: auth expired',
      synthesisMode: 'heuristic',
      packs: [],
      synthesis: undefined,
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world'],
    });

    const lines = logSpy?.mock.calls.map((call) => String(call[0])) ?? [];
    const criticalWarningsIndex = lines.findIndex((line) => line.includes('Critical Warnings:'));
    const coverageGapsIndex = lines.findIndex((line) => line.includes('Coverage Gaps:'));

    expect(criticalWarningsIndex).toBeGreaterThan(-1);
    expect(coverageGapsIndex).toBeGreaterThan(-1);
    expect(criticalWarningsIndex).toBeLessThan(coverageGapsIndex);
    expect(lines.some((line) => line.includes('LLM synthesis error: Claude CLI error: auth expired'))).toBe(true);
    expect(lines.some((line) => line.includes('Session degraded: results were returned but could not be persisted'))).toBe(true);
    expect(lines.some((line) => line.includes('LLM synthesis unavailable: results are structural-only'))).toBe(true);
  });

  it('prints a derived answer in text mode when synthesis is unavailable', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'where is synthesis executed', depth: 'L1' },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: [],
      drillDownHints: [],
      synthesis: undefined,
      packs: [
        {
          packId: 'p1',
          packType: 'function_context',
          targetId: 'src/api/query.ts:runSynthesisStage',
          summary: 'Query synthesis is executed in runSynthesisStage in src/api/query.ts.',
          keyFacts: [],
          relatedFiles: ['src/api/query.ts'],
          codeSnippets: [],
          confidence: 0.86,
          createdAt: new Date(),
          version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
        },
      ],
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'where is synthesis executed'],
    });

    const lines = logSpy?.mock.calls.map((call) => String(call[0])) ?? [];
    expect(lines.some((line) => line.includes('Answer:'))).toBe(true);
    expect(lines.some((line) => line.includes('Query synthesis is executed in runSynthesisStage in src/api/query.ts.'))).toBe(true);
  });

  it('surfaces partial-index and low-confidence quality warnings at top', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockResolvedValueOnce({
      query: { intent: 'hello world', depth: 'L1' },
      totalConfidence: 0.094,
      cacheHit: false,
      latencyMs: 10,
      version: { major: 0, minor: 2, patch: 1, qualityTier: 'full', indexedAt: new Date() },
      disclosures: ['coherence_warning: result set appears scattered'],
      drillDownHints: ['Result coherence: Results appear scattered/incoherent (36%).'],
      coverageGaps: ['Index structural scan (19% complete). Results may be incomplete.'],
      packs: [],
      synthesis: undefined,
    } as any);

    await queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world'],
    });

    const lines = logSpy?.mock.calls.map((call) => String(call[0])) ?? [];
    const criticalWarningsIndex = lines.findIndex((line) => line.includes('Critical Warnings:'));
    const coverageGapsIndex = lines.findIndex((line) => line.includes('Coverage Gaps:'));

    expect(criticalWarningsIndex).toBeGreaterThan(-1);
    expect(coverageGapsIndex).toBeGreaterThan(-1);
    expect(criticalWarningsIndex).toBeLessThan(coverageGapsIndex);
    expect(lines.some((line) => line.includes('Index structural scan (19% complete). Results may be incomplete.'))).toBe(true);
    expect(lines.some((line) => line.includes('Low confidence (0.094)'))).toBe(true);
    expect(lines.some((line) => line.includes('Result coherence:'))).toBe(true);
  });

  it('fails fast with QUERY_TIMEOUT when query execution exceeds timeout budget', async () => {
    const { queryCommand } = await import('../query.js');
    const { queryLibrarian } = await import('../../../api/query.js');

    vi.mocked(queryLibrarian).mockImplementationOnce(
      () => new Promise<never>(() => {})
    );

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json', '--timeout', '30'],
    })).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
  });

  it('fails fast with QUERY_TIMEOUT when bootstrap stage makes no progress', async () => {
    const { queryCommand } = await import('../query.js');
    const { isBootstrapRequired, bootstrapProject } = await import('../../../api/bootstrap.js');

    vi.mocked(isBootstrapRequired).mockResolvedValueOnce({
      required: true,
      reason: 'Watch state indicates catch-up is required before queries can be trusted',
    });
    vi.mocked(bootstrapProject).mockImplementationOnce(
      () => new Promise<never>(() => {})
    );

    await expect(queryCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['query', 'hello world', '--json', '--timeout', '30'],
    })).rejects.toMatchObject({ code: 'QUERY_TIMEOUT' });
  });
});
