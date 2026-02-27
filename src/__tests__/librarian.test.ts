/**
 * @fileoverview Tests for Librarian subsystem
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { safeJsonParseOrThrow } from '../utils/safe_json.js';
import {
  Librarian,
  createSqliteStorage,
  LIBRARIAN_VERSION,
  QUALITY_TIERS,
  compareVersions,
  shouldReplaceExistingData,
  ensureLibrarianReady,
  isLibrarianReady,
  resetGate,
} from '../index.js';
import { ProviderUnavailableError } from '../api/provider_check.js';
import { EmbeddingService } from '../api/embeddings.js';
import { ParserRegistry } from '../agents/parser_registry.js';
import { GovernorContext, estimateTokenCount } from '../api/governor_context.js';
import { loadGovernorConfig } from '../api/bootstrap.js';
import { DEFAULT_GOVERNOR_CONFIG, writeGovernorBudgetReport, type GovernorConfig } from '../api/governors.js';
import { __setMigrationBackupCopyForTests } from '../api/migrations.js';
import { minimizeSnippet, redactText } from '../api/redaction.js';
import type { LibrarianVersion, FunctionKnowledge } from '../types.js';
import { cleanupWorkspace } from './helpers/index.js';

const createTempWorkspace = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-test-'));
  const canonPath = path.join(root, 'config', 'canon.json');
  await fs.mkdir(path.dirname(canonPath), { recursive: true });
  await fs.writeFile(canonPath, JSON.stringify({ schema_version: 1 }, null, 2));
  return root;
};
const createTestFile = async (workspace: string, relativePath: string, content: string): Promise<string> => {
  const fullPath = path.join(workspace, relativePath); await fs.mkdir(path.dirname(fullPath), { recursive: true }); await fs.writeFile(fullPath, content); return fullPath;
};

const DETERMINISTIC_BOOTSTRAP = { include: ['**/*.ts'] };
const BASE_GOVERNOR_LIMITS: Pick<GovernorConfig, 'maxRetries' | 'maxWallTimeMs' | 'maxConcurrentWorkers' | 'maxEmbeddingsPerBatch'> = { maxRetries: 0, maxWallTimeMs: 0, maxConcurrentWorkers: 1, maxEmbeddingsPerBatch: 10 };
const buildGovernorConfig = (overrides: Partial<GovernorConfig>): GovernorConfig => ({ ...DEFAULT_GOVERNOR_CONFIG, ...BASE_GOVERNOR_LIMITS, ...overrides });

const SAMPLE_TS_FILE = `export function add(a: number, b: number): number {
  return a + b;
}
export function multiply(a: number, b: number): number {
  return a * b;
}
`;


describe('Librarian Versioning', () => {
  it('should have valid version constants', () => {
    expect(LIBRARIAN_VERSION.major).toBeGreaterThanOrEqual(1);
    expect(LIBRARIAN_VERSION.minor).toBeGreaterThanOrEqual(0);
    expect(LIBRARIAN_VERSION.patch).toBeGreaterThanOrEqual(0);
    expect(LIBRARIAN_VERSION.string).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have quality tiers in correct order', () => {
    expect(QUALITY_TIERS.mvp.level).toBeLessThan(QUALITY_TIERS.enhanced.level);
    expect(QUALITY_TIERS.enhanced.level).toBeLessThan(QUALITY_TIERS.full.level);
  });

  describe('compareVersions', () => {
    const baseVersion: LibrarianVersion = {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'mvp',
      indexedAt: new Date(),
      indexerVersion: '1.0.0',
      features: ['basic_indexing'],
    };

    it('should detect major version upgrade', () => {
      const target: LibrarianVersion = { ...baseVersion, major: 2, string: '2.0.0' };
      const result = compareVersions(baseVersion, target);
      expect(result.upgradeRequired).toBe(true);
      expect(result.upgradeType).toBe('major');
    });

    it('should detect minor version upgrade', () => {
      const target: LibrarianVersion = { ...baseVersion, minor: 1, string: '1.1.0' };
      const result = compareVersions(baseVersion, target);
      expect(result.upgradeRequired).toBe(true);
      expect(result.upgradeType).toBe('minor');
    });

    it('should detect patch version (optional upgrade)', () => {
      const target: LibrarianVersion = { ...baseVersion, patch: 1, string: '1.0.1' };
      const result = compareVersions(baseVersion, target);
      expect(result.upgradeRequired).toBe(false);
      expect(result.upgradeType).toBe('patch');
    });

    it('should detect quality tier upgrade', () => {
      const target: LibrarianVersion = { ...baseVersion, qualityTier: 'enhanced' };
      const result = compareVersions(baseVersion, target);
      expect(result.upgradeRequired).toBe(true);
      expect(result.upgradeType).toBe('quality_tier');
    });

    it('should detect no upgrade needed', () => {
      const result = compareVersions(baseVersion, baseVersion);
      expect(result.upgradeRequired).toBe(false);
      expect(result.upgradeType).toBe('none');
    });
  });

  describe('shouldReplaceExistingData', () => {
    const baseVersion: LibrarianVersion = {
      major: 1,
      minor: 0,
      patch: 0,
      string: '1.0.0',
      qualityTier: 'mvp',
      indexedAt: new Date(),
      indexerVersion: '1.0.0',
      features: [],
    };

    it('should replace for quality tier upgrade', () => {
      const target: LibrarianVersion = { ...baseVersion, qualityTier: 'enhanced' };
      expect(shouldReplaceExistingData(baseVersion, target)).toBe(true);
    });

    it('should replace for major version upgrade', () => {
      const target: LibrarianVersion = { ...baseVersion, major: 2, string: '2.0.0' };
      expect(shouldReplaceExistingData(baseVersion, target)).toBe(true);
    });

    it('should not replace for minor version upgrade', () => {
      const target: LibrarianVersion = { ...baseVersion, minor: 1, string: '1.1.0' };
      expect(shouldReplaceExistingData(baseVersion, target)).toBe(false);
    });
  });
});


describe('Librarian Storage', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await createTempWorkspace();
  });

  afterEach(async () => {
    await cleanupWorkspace(workspace);
  });

  it('should create and initialize SQLite storage', async () => {
    const dbPath = path.join(workspace, 'test.db');
    const storage = createSqliteStorage(dbPath);

    expect(storage.isInitialized()).toBe(false);
    await storage.initialize();
    expect(storage.isInitialized()).toBe(true);

    await storage.close();
    expect(storage.isInitialized()).toBe(false);
  });

  it('applies migrations and writes a migration report', async () => {
    const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    const auditRoot = path.join(workspace, 'state', 'audits', 'librarian', 'migrations');
    const entries = await fs.readdir(auditRoot);
    expect(entries.length).toBeGreaterThan(0);
    const latest = entries.sort().at(-1);
    const reportPath = path.join(auditRoot, latest ?? '', 'LibrarianSchemaMigrationReport.v1.json');
    const report = safeJsonParseOrThrow<{ kind: string; from_version: number; to_version: number; applied: unknown[] }>(await fs.readFile(reportPath, 'utf8'), 'migration report');
    expect(report.kind).toBe('LibrarianSchemaMigrationReport.v1');
    expect(report.from_version).toBe(0);
    expect(report.to_version).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(report.applied)).toBe(true);
    await storage.close();
  });

  it('creates a pre-migration backup of .librarian state', async () => {
    const librarianDir = path.join(workspace, '.librarian');
    const dbPath = path.join(librarianDir, 'librarian.sqlite');
    await fs.mkdir(librarianDir, { recursive: true });
    await fs.writeFile(path.join(librarianDir, 'preexisting.txt'), 'seed\n', 'utf8');

    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    await storage.close();

    const rootEntries = await fs.readdir(workspace);
    const backupDir = rootEntries.find((entry) => entry.startsWith('.librarian.backup.v0.'));
    expect(backupDir).toBeTruthy();
    const backupFile = path.join(workspace, backupDir ?? '', 'preexisting.txt');
    const backupContent = await fs.readFile(backupFile, 'utf8');
    expect(backupContent.trim()).toBe('seed');
  });

  it('recovers from transient sqlite sidecar ENOENT while creating migration backup', async () => {
    const librarianDir = path.join(workspace, '.librarian');
    const dbPath = path.join(librarianDir, 'librarian.sqlite');
    await fs.mkdir(librarianDir, { recursive: true });
    await fs.writeFile(path.join(librarianDir, 'preexisting.txt'), 'seed\n', 'utf8');

    let shouldFailInitialCopy = true;
    const copyDirectory = fs.cp.bind(fs);
    __setMigrationBackupCopyForTests(async (src, dest, options) => {
      const isInitialBackupCopy =
        shouldFailInitialCopy &&
        src === librarianDir &&
        options !== undefined &&
        !('filter' in options);
      if (isInitialBackupCopy) {
        shouldFailInitialCopy = false;
        const err = new Error(
          `ENOENT: no such file or directory, lstat '${path.join(librarianDir, 'librarian.sqlite-shm')}'`,
        ) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return copyDirectory(src, dest, options);
    });

    try {
      const storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();
      await storage.close();
    } finally {
      __setMigrationBackupCopyForTests(null);
    }

    const rootEntries = await fs.readdir(workspace);
    const backupDir = rootEntries.find((entry) => entry.startsWith('.librarian.backup.v0.'));
    expect(backupDir).toBeTruthy();
    const backupFile = path.join(workspace, backupDir ?? '', 'preexisting.txt');
    const backupContent = await fs.readFile(backupFile, 'utf8');
    expect(backupContent.trim()).toBe('seed');
  });

  it('recovers from transient ENOTEMPTY while creating migration backup', async () => {
    const librarianDir = path.join(workspace, '.librarian');
    const dbPath = path.join(librarianDir, 'librarian.sqlite');
    await fs.mkdir(librarianDir, { recursive: true });
    await fs.writeFile(path.join(librarianDir, 'preexisting.txt'), 'seed\n', 'utf8');

    let shouldFailInitialCopy = true;
    const copyDirectory = fs.cp.bind(fs);
    __setMigrationBackupCopyForTests(async (src, dest, options) => {
      const isInitialBackupCopy =
        shouldFailInitialCopy &&
        src === librarianDir &&
        options !== undefined &&
        !('filter' in options);
      if (isInitialBackupCopy) {
        shouldFailInitialCopy = false;
        const err = new Error(
          `ENOTEMPTY: directory not empty, rmdir '${path.join(String(dest), 'packs')}'`,
        ) as NodeJS.ErrnoException;
        err.code = 'ENOTEMPTY';
        throw err;
      }
      return copyDirectory(src, dest, options);
    });

    try {
      const storage = createSqliteStorage(dbPath, workspace);
      await storage.initialize();
      await storage.close();
    } finally {
      __setMigrationBackupCopyForTests(null);
    }

    const rootEntries = await fs.readdir(workspace);
    const backupDir = rootEntries.find((entry) => entry.startsWith('.librarian.backup.v0.'));
    expect(backupDir).toBeTruthy();
    const backupFile = path.join(workspace, backupDir ?? '', 'preexisting.txt');
    const backupContent = await fs.readFile(backupFile, 'utf8');
    expect(backupContent.trim()).toBe('seed');
  });

  it('retains only the newest pre-migration backup directory', async () => {
    const librarianDir = path.join(workspace, '.librarian');
    const dbPath = path.join(librarianDir, 'librarian.sqlite');
    await fs.mkdir(librarianDir, { recursive: true });
    await fs.writeFile(path.join(librarianDir, 'preexisting.txt'), 'seed\n', 'utf8');

    const staleA = path.join(workspace, '.librarian.backup.v0.1000.stale-a');
    const staleB = path.join(workspace, '.librarian.backup.v0.2000.stale-b');
    await fs.mkdir(staleA, { recursive: true });
    await fs.mkdir(staleB, { recursive: true });
    await fs.writeFile(path.join(staleA, 'marker.txt'), 'old-a\n', 'utf8');
    await fs.writeFile(path.join(staleB, 'marker.txt'), 'old-b\n', 'utf8');
    const now = Date.now();
    await fs.utimes(staleA, new Date(now - 60_000), new Date(now - 60_000));
    await fs.utimes(staleB, new Date(now - 30_000), new Date(now - 30_000));

    const storage = createSqliteStorage(dbPath, workspace);
    await storage.initialize();
    await storage.close();

    const backupDirs = (await fs.readdir(workspace)).filter((entry) => entry.startsWith('.librarian.backup.v'));
    expect(backupDirs).toHaveLength(1);
    const preservedPath = path.join(workspace, backupDirs[0] ?? '');
    const preservedSeed = await fs.readFile(path.join(preservedPath, 'preexisting.txt'), 'utf8');
    expect(preservedSeed.trim()).toBe('seed');
  });

  it('should store and retrieve functions', async () => {
    const dbPath = path.join(workspace, 'test.db');
    const storage = createSqliteStorage(dbPath);
    await storage.initialize();

    const fn: FunctionKnowledge = {
      id: 'test-fn-1',
      filePath: '/test/file.ts',
      name: 'testFunction',
      signature: 'testFunction(a: number): void',
      purpose: 'Test function for testing',
      startLine: 10,
      endLine: 20,
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    await storage.upsertFunction(fn);

    const retrieved = await storage.getFunction('test-fn-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('testFunction');
    expect(retrieved!.confidence).toBe(0.5);

    await storage.close();
  });

  it('should update confidence with decay', async () => {
    const dbPath = path.join(workspace, 'test.db');
    const storage = createSqliteStorage(dbPath);
    await storage.initialize();

    const fn: FunctionKnowledge = {
      id: 'decay-test',
      filePath: '/test/file.ts',
      name: 'decayTest',
      signature: 'decayTest(): void',
      purpose: 'Test decay',
      startLine: 1,
      endLine: 5,
      confidence: 0.8,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    await storage.upsertFunction(fn);

    const updated = await storage.applyTimeDecay(0.1);
    expect(updated).toBeGreaterThan(0);

    const retrieved = await storage.getFunction('decay-test');
    expect(retrieved!.confidence).toBeCloseTo(0.7, 5); // 0.8 - 0.1

    await storage.close();
  });

  it('should handle embeddings', async () => {
    const dbPath = path.join(workspace, 'test.db');
    const storage = createSqliteStorage(dbPath);
    await storage.initialize();

    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    await storage.setEmbedding('entity-1', embedding, { modelId: 'test-model' });

    const retrieved = await storage.getEmbedding('entity-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(5);
    expect(retrieved![0]).toBeCloseTo(0.1, 5);

    await storage.close();
  });
});

it('redacts secrets and minimizes snippets', () => {
  const privateKeyHeader = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
  const privateKeyFooter = ['-----END', 'PRIVATE', 'KEY-----'].join(' ');
  const apiKey = ['1234567890', '1234567890'].join('');
  const token = ['ABCD', '1234', 'EFGH', '5678', 'IJKL'].join('');
  const githubToken = ['ghp_', '1234567890', 'abcdefghij', 'KLMNOPQRST'].join('');
  const awsKey = ['AKIA', '1234567890ABCDEF'].join('');
  const input = [
    `api_key: '${apiKey}'`,
    'password = "hunter2"',
    `token: '${token}'`,
    githubToken,
    awsKey,
    privateKeyHeader,
    'abc',
    privateKeyFooter,
  ].join('\n');

  const result = redactText(input);
  const expectedCounts = {
    api_key: 1,
    password: 1,
    token: 2,
    aws_key: 1,
    private_key: 1,
  } as const;
  for (const type of Object.keys(expectedCounts) as Array<keyof typeof expectedCounts>) {
    expect(result.text).toContain(`[REDACTED:${type}]`);
    expect(result.counts.by_type[type]).toBe(expectedCounts[type]);
  }

  const minimized = minimizeSnippet(
    Array.from({ length: 40 }, (_, index) => `line-${index}-${'x'.repeat(80)}`).join('\n')
  );
  expect(minimized.text.length).toBeLessThanOrEqual(2000);
  for (const line of ['line-0-', 'line-4-', 'line-35-', 'line-39-']) {
    expect(minimized.text).toContain(line);
  }
});
// NOTE: EmbeddingService tests have been updated to reflect the new real embedding implementation.
// The old tests used custom embedder functions which are no longer supported - the new service
// uses @huggingface/transformers or sentence-transformers exclusively per VISION.md 8.5 policy.
// LLM-generated "embeddings" are FORBIDDEN as they're hallucinated numbers, not real vectors.
describe('EmbeddingService', () => {
  it('creates service with default configuration', () => {
    // Real embedding providers (xenova/sentence-transformers) are auto-configured
    const service = new EmbeddingService({});
    expect(service.getEmbeddingDimension()).toBe(384); // all-MiniLM-L6-v2 dimension
  });
});


describe('GovernorContext', () => {
  // NOTE: GovernorContext uses graceful degradation - it returns strategy recommendations
  // instead of throwing. Use recommendStrategy() for soft limits or checkBudget() to throw.

  it('returns defer strategy when per-file token limits exceeded', () => {
    const context = new GovernorContext({
      phase: 'test',
      config: buildGovernorConfig({
        maxTokensPerFile: 3,
        maxTokensPerPhase: 10,
        maxTokensPerRun: 10,
        maxFilesPerPhase: 10,
      }),
    });

    context.enterFile('alpha.ts');
    const result1 = context.recordTokens(2);
    expect(result1.shouldDeferNewCalls).toBe(false);
    // Second record exceeds per-file limit - should recommend defer
    const result2 = context.recordTokens(2);
    expect(result2.shouldDeferNewCalls).toBe(true);
    expect(result2.strategy).toBe('defer');
  });

  it('returns defer strategy when per-phase token limits exceeded', () => {
    const context = new GovernorContext({
      phase: 'phase',
      config: buildGovernorConfig({
        maxTokensPerFile: 100,
        maxTokensPerPhase: 3,
        maxTokensPerRun: 100,
        maxFilesPerPhase: 10,
      }),
    });

    context.enterFile('phase.ts');
    const result1 = context.recordTokens(2);
    expect(result1.shouldDeferNewCalls).toBe(false);
    // Second record exceeds per-phase limit
    const result2 = context.recordTokens(2);
    expect(result2.shouldDeferNewCalls).toBe(true);
  });

  it('returns defer strategy when per-run token limits exceeded', () => {
    const context = new GovernorContext({
      phase: 'run',
      config: buildGovernorConfig({
        maxTokensPerFile: 100,
        maxTokensPerPhase: 100,
        maxTokensPerRun: 3,
        maxFilesPerPhase: 10,
      }),
    });

    context.enterFile('run.ts');
    const result1 = context.recordTokens(2);
    expect(result1.shouldDeferNewCalls).toBe(false);
    // Second record exceeds per-run limit
    const result2 = context.recordTokens(2);
    expect(result2.shouldDeferNewCalls).toBe(true);
  });

  it('throws when file count severely exceeds limits (health < -0.5)', () => {
    const context = new GovernorContext({
      phase: 'files',
      config: buildGovernorConfig({
        maxTokensPerFile: 100,
        maxTokensPerPhase: 100,
        maxTokensPerRun: 100,
        maxFilesPerPhase: 1,
      }),
    });

    context.enterFile('file-a.ts');
    // Second file exceeds limit - enterFile calls checkBudget() which throws when health < -0.5
    // With 2 files and limit of 1: utilization = 2/1 = 2, health = 1 - 2 = -1 (< -0.5)
    expect(() => context.enterFile('file-b.ts')).toThrow('budget_exhausted');
  });

  it('treats zero budgets as unlimited', () => {
    const context = new GovernorContext({
      phase: 'unlimited',
      config: buildGovernorConfig({
        maxTokensPerFile: 0,
        maxTokensPerPhase: 0,
        maxTokensPerRun: 0,
        maxFilesPerPhase: 0,
        maxRetries: 0,
        maxWallTimeMs: 0,
      }),
    });

    context.enterFile('unlimited.ts');
    expect(() => context.recordTokens(1_000)).not.toThrow();
    expect(() => context.recordRetry()).not.toThrow();
  });

  it('builds a GovernorBudgetReport.v1 payload', async () => {
    const context = new GovernorContext({
      phase: 'report',
      config: buildGovernorConfig({
        maxTokensPerFile: 10,
        maxTokensPerPhase: 10,
        maxTokensPerRun: 10,
        maxFilesPerPhase: 10,
      }),
    });

    context.enterFile('beta.ts');
    context.recordTokens(1);

    const report = await context.buildReport({ status: 'success' });
    expect(report.kind).toBe('GovernorBudgetReport.v1');
    expect(report.schema_version).toBe(1);
    expect(report.phase).toBe('report');
    expect(report.budget_limits.maxTokensPerPhase).toBe(10);
    expect(report.usage.tokens_used_phase).toBeGreaterThan(0);
    expect(report.outcome.status).toBe('success');
  });

  it('writes GovernorBudgetReport.v1 to disk', async () => {
    const workspace = await createTempWorkspace();
    try {
      const context = new GovernorContext({
        phase: 'write-test',
        config: buildGovernorConfig({
          maxTokensPerFile: 10,
          maxTokensPerPhase: 10,
          maxTokensPerRun: 10,
          maxFilesPerPhase: 10,
        }),
      });

      context.enterFile('gamma.ts');
      context.recordTokens(1);

      const report = await context.buildReport({ status: 'success' });
      const reportPath = await writeGovernorBudgetReport(workspace, report);
      const raw = await fs.readFile(reportPath, 'utf8');
      const parsed = safeJsonParseOrThrow<{ kind: string; phase: string }>(raw, 'governor budget report');

      expect(parsed.kind).toBe('GovernorBudgetReport.v1');
      expect(parsed.phase).toBe('write-test');
      expect(reportPath).toContain(path.join('state', 'audits', 'librarian', 'governor'));
    } finally {
      await cleanupWorkspace(workspace);
    }
  });

  it('loads governor config overrides from workspace file', async () => {
    const workspace = await createTempWorkspace();
    try {
      const configPath = path.join(workspace, '.librarian', 'governor.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ maxTokensPerFile: 42, maxConcurrentWorkers: 2 }, null, 2)
      );

      const config = await loadGovernorConfig(workspace);
      expect(config.maxTokensPerFile).toBe(42);
      expect(config.maxConcurrentWorkers).toBe(2);
      expect(config.maxTokensPerPhase).toBe(DEFAULT_GOVERNOR_CONFIG.maxTokensPerPhase);
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});

describe('Librarian Initialize', () => {
  it('rejects dbPath outside workspace .librarian', async () => {
    const workspace = await createTempWorkspace();
    try {
      const librarian = new Librarian({ workspace, autoBootstrap: false, dbPath: '../escape.db' });
      await expect(librarian.initialize()).rejects.toThrow('unverified_by_trace(storage_path_escape)');
    } finally {
      await cleanupWorkspace(workspace);
    }
  });

  it('supports dependency override seams for core initialization services', async () => {
    const workspace = await createTempWorkspace();
    const createEmbeddingService = vi.fn(() => new EmbeddingService({ maxBatchSize: 8 }));
    const createStorageOverride = vi.fn((ctx: { dbPath: string; workspace: string }) =>
      createSqliteStorage(ctx.dbPath, ctx.workspace)
    );

    try {
      const librarian = new Librarian({
        workspace,
        autoBootstrap: false,
        dependencyOverrides: {
          createEmbeddingService,
          createStorage: (ctx) => createStorageOverride({ dbPath: ctx.dbPath, workspace: ctx.workspace }),
        },
      });
      await librarian.initialize();
      expect(createEmbeddingService).toHaveBeenCalledTimes(1);
      expect(createStorageOverride).toHaveBeenCalled();
      await librarian.shutdown();
    } finally {
      await cleanupWorkspace(workspace);
    }
  });
});

describe('ParserRegistry', () => {
  it('dispatches parsers and reports coverage gaps', () => {
    const registry = ParserRegistry.getInstance();
    registry.resetCoverage();

    const tsResult = registry.parseFile('sample.ts', 'export function add(a: number, b: number) { return a + b; }');
    const jsResult = registry.parseFile('sample.js', 'function sub(a, b) { return a - b; }');
    const jsonResult = registry.parseFile('config.json', '{"name": "test"}');

    expect(tsResult.parser).toBe('ts-morph');
    expect(jsResult.parser).toBe('ts-morph');
    expect(jsonResult.parser).toBe('tree-sitter-json');

    expect(() => registry.parseFile('script.unknown', 'function add() { return 1; }'))
      .toThrow('unverified_by_trace(parser_unavailable)');

    const coverage = registry.getCoverageReport();
    expect(coverage.files_by_parser['ts-morph']).toBeGreaterThanOrEqual(2);
    expect(coverage.files_by_parser['tree-sitter-json']).toBeGreaterThanOrEqual(1);
    expect(coverage.coverage_gaps).toContain('*.unknown');
  });

  it('parses large tree-sitter inputs without throwing Invalid argument', () => {
    const registry = ParserRegistry.getInstance();
    const supported = new Set(registry.getSupportedExtensions());
    if (!supported.has('.py')) {
      // In environments where tree-sitter-python is not present, skip gracefully.
      return;
    }

    const largePython = 'x = 1\n'.repeat(10_000); // >32k chars
    const result = registry.parseFile('big.py', largePython);
    expect(result.parser).toBe('tree-sitter-python');
  });
});

/**
 * First-Run Gate Tests
 *
 * NOTE: These tests require LIVE embedding providers per docs/LIVE_PROVIDERS_PLAYBOOK.md.
 * Tests that cannot get live providers will fail with unverified_by_trace(provider_unavailable).
 * This is CORRECT behavior - we do not test semantic systems with fake embeddings.
 */
describe('First-Run Gate (Tier-0)', () => {
  let workspace: string;
  let previousTestMode: string | undefined;

  beforeEach(async () => {
    previousTestMode = process.env.WAVE0_TEST_MODE;
    process.env.WAVE0_TEST_MODE = 'true';
    workspace = await createTempWorkspace();
    await resetGate(workspace);
  }, 0);

  afterEach(async () => {
    if (workspace) {
      await resetGate(workspace);
    }
    if (previousTestMode === undefined) {
      delete process.env.WAVE0_TEST_MODE;
    } else {
      process.env.WAVE0_TEST_MODE = previousTestMode;
    }
    if (workspace) {
      await cleanupWorkspace(workspace);
    }
  }, 0);

  it('should detect when bootstrap is required (Tier-0: no provider needed)', async () => {
    // This test is Tier-0 - it tests gate state detection, not semantic behavior
    expect(isLibrarianReady(workspace)).toBe(false);
  });

  it('fails closed when provider gate reports unavailable (Tier-0: tests gate behavior)', async () => {
    // This test is Tier-0 - it verifies the gate CORRECTLY rejects when providers unavailable
    await createTestFile(workspace, 'src/index.ts', SAMPLE_TS_FILE);

    const providerGate = async () => ({
      ready: false,
      providers: [],
      embedding: { provider: 'unknown' as const, available: false, lastCheck: Date.now(), error: 'embedding unavailable' },
      llmReady: false,
      embeddingReady: false,
      reason: 'no providers configured',
      guidance: [],
      selectedProvider: null,
      bypassed: false,
    });

    await expect(
      ensureLibrarianReady(workspace, {
        throwOnFailure: true,
        includePatterns: ['**/*.ts'],
        allowDegradedEmbeddings: false,
        providerGate,
        embeddingService: undefined,
      })
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
