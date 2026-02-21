/**
 * @fileoverview Bootstrap Output Verification Tests (SYSTEM)
 *
 * These tests verify that bootstrap produces correct outputs on a small,
 * real-world fixture (vendored from GitHub) with deterministic assertions.
 *
 * This is NOT a "doesn't crash" test - it validates real knowledge extraction.
 * Requires live providers; run with vitest.librainian-agentic.config.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'node:fs';
import { pathToFileURL } from 'node:url';
import { glob } from 'glob';
import { Project, Node, SyntaxKind, type SourceFile } from 'ts-morph';
import { EmbeddingService } from '../../api/embeddings.js';
import { bootstrapProject } from '../../api/bootstrap.js';
import type { BootstrapConfig, BootstrapPhase, BootstrapReport } from '../../types.js';
import { checkAllProviders, type AllProviderStatus } from '../../api/provider_check.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import {
  clearDefaultLlmServiceFactory,
  createDefaultLlmServiceAdapter,
  setDefaultLlmServiceFactory,
} from '../../adapters/llm_service.js';
import { resolveLiBrainianModelId } from '../../api/llm_env.js';

// ============================================================================
// TEST SCOPE - Small GitHub fixture (ky / p-map / p-queue)
// ============================================================================

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const LLM_SERVICE_PATH_CANDIDATES = [
  path.join(REPO_ROOT, 'src', 'soma', 'providers', 'llm_service.ts'),
  path.join(REPO_ROOT, 'src', 'soma', 'providers', 'llm_service.js'),
];
const WAVE0_LLM_SERVICE_PATH = LLM_SERVICE_PATH_CANDIDATES.find((candidate) => fsSync.existsSync(candidate));
const HAS_WAVE0_LLM_SERVICE = Boolean(WAVE0_LLM_SERVICE_PATH);

type QueryExpectation = {
  query: string;
  targetPattern: RegExp;
  label: string;
  topK?: number;
  minMargin?: number;
};

interface ExpectedModule {
  pathPattern: RegExp;
  minFunctions?: number;
  minFunctionRatio?: number;
  minMatchRatio?: number;
}

type FixtureConfig = {
  rootRelative: string;
  includeGlobs: string[];
  testFiles: string[];
  expectedModules: ExpectedModule[];
  queries: QueryExpectation[];
};

const FIXTURES: Record<string, FixtureConfig> = {
  ky: {
    rootRelative: 'test/fixtures/github/ky',
    includeGlobs: [
      'source/**/*.ts',
      'test/**/*.ts',
    ],
    testFiles: [
      'source/index.ts',
      'source/utils/merge.ts',
      'source/utils/normalize.ts',
      'test/hooks.ts',
      'test/retry.ts',
    ],
    expectedModules: [
      { pathPattern: /source\/utils\/merge\.ts$/, minFunctionRatio: 0.4, minMatchRatio: 0.6 },
      { pathPattern: /source\/utils\/normalize\.ts$/, minFunctionRatio: 0.4, minMatchRatio: 0.6 },
      { pathPattern: /source\/utils\/type-guards\.ts$/, minFunctionRatio: 0.5, minMatchRatio: 0.6 },
    ],
    queries: [
      {
        query: 'merge hooks and headers options',
        targetPattern: /source\/utils\/merge\.ts$/,
        label: 'merge hooks and headers options',
      },
      {
        query: 'normalize retry options and default retry settings',
        targetPattern: /source\/utils\/normalize\.ts$/,
        label: 'normalize retry options and default retry settings',
      },
      {
        query: 'type guard for timeout error',
        targetPattern: /source\/utils\/type-guards\.ts$/,
        label: 'type guard for timeout error',
      },
    ],
  },
  'p-map': {
    rootRelative: 'test/fixtures/github/p-map',
    includeGlobs: ['**/*.js', '**/*.ts'],
    testFiles: ['index.js', 'assert-in-range.js', 'test.js'],
    expectedModules: [
      { pathPattern: /index\.js$/, minFunctionRatio: 0.4, minMatchRatio: 0.6 },
      { pathPattern: /assert-in-range\.js$/, minFunctionRatio: 0.5, minMatchRatio: 0.6 },
      { pathPattern: /test\.js$/, minFunctionRatio: 0.2, minMatchRatio: 0.4 },
    ],
    queries: [
      {
        query: 'concurrency limit and async mapper function',
        targetPattern: /index\.js$/,
        label: 'concurrency limit and async mapper function',
      },
      {
        query: 'assert value is within a numeric range',
        targetPattern: /assert-in-range\.js$/,
        label: 'assert value is within a numeric range',
      },
    ],
  },
  'p-queue': {
    rootRelative: 'test/fixtures/github/p-queue',
    includeGlobs: [
      'source/**/*.ts',
      'test/**/*.ts',
      'test-d/**/*.ts',
      'bench.ts',
    ],
    testFiles: [
      'source/index.ts',
      'source/priority-queue.ts',
      'source/lower-bound.ts',
      'test/basic.ts',
    ],
    expectedModules: [
      { pathPattern: /source\/index\.ts$/, minFunctionRatio: 0.4, minMatchRatio: 0.6 },
      { pathPattern: /source\/priority-queue\.ts$/, minFunctionRatio: 0.4, minMatchRatio: 0.6 },
      { pathPattern: /source\/lower-bound\.ts$/, minFunctionRatio: 0.5, minMatchRatio: 0.6 },
    ],
    queries: [
      {
        query: 'priority queue insertion and setPriority',
        targetPattern: /source\/priority-queue\.ts$/,
        label: 'priority queue insertion and setPriority',
      },
      {
        query: 'concurrency limit and rate interval queue',
        targetPattern: /source\/index\.ts$/,
        label: 'concurrency limit and rate interval queue',
      },
    ],
  },
};

const HAS_FIXTURES = Object.values(FIXTURES).every((fixture) =>
  fsSync.existsSync(path.join(REPO_ROOT, fixture.rootRelative))
);
const describeFixtures = HAS_FIXTURES && HAS_WAVE0_LLM_SERVICE ? describe : describe.skip;

const FIXTURE_NAME = process.env.WAVE0_BOOTSTRAP_FIXTURE ?? 'ky';
const fixture = FIXTURES[FIXTURE_NAME];
if (!fixture) {
  throw new Error(`Unknown fixture "${FIXTURE_NAME}". Available: ${Object.keys(FIXTURES).join(', ')}`);
}

const FIXTURE_ROOT = fixture.rootRelative;
const FIXTURE_ROOT_ABS = path.join(REPO_ROOT, FIXTURE_ROOT);
const TEST_WORKSPACE = REPO_ROOT;
const TEST_FILES = fixture.testFiles.map((entry) => path.join(FIXTURE_ROOT, entry));
const BOOTSTRAP_INCLUDE_GLOBS = fixture.includeGlobs.map((entry) => path.join(FIXTURE_ROOT, entry));
const EXPECTED_MODULES = fixture.expectedModules;
const QUERY_EXPECTATIONS = fixture.queries;

// Unique test database (kept under repo root for isolation)
const TEST_DB_PATH = path.join(REPO_ROOT, '.librainian', 'test_bootstrap_verification.sqlite');
const BOOTSTRAP_STATE_PATH = path.join(TEST_WORKSPACE, '.librainian', 'bootstrap_state.json');
const BOOTSTRAP_EXCLUDE_GLOBS: string[] = ['**/.librainian/**', '**/node_modules/**'];

// ============================================================================
// TEST STATE
// ============================================================================

let storage: LiBrainianStorage | null = null;
let embeddingService: EmbeddingService | null = null;
let providerStatus: AllProviderStatus | null = null;
let resolvedLlmProvider: 'claude' | 'codex' = 'codex';
let bootstrapTargets: string[] = [];
let bootstrapReport: BootstrapReport | null = null;
let bootstrapTargetStats: CodexComplexity | null = null;
let embeddingDimension = 384;
let fixtureExpectations: FixtureAstExpectations | null = null;
let previousStrictProvider: string | undefined;

const requireStorage = (): LiBrainianStorage => {
  if (!storage) throw new Error('Storage not initialized');
  return storage;
};

const requireEmbeddingService = (): EmbeddingService => {
  if (!embeddingService) throw new Error('Embedding service not initialized');
  return embeddingService;
};

type CodexComplexity = {
  fileCount: number;
  totalBytes: number;
  maxFileBytes: number;
};

type FixtureAstExpectations = {
  functionsByFile: Map<string, string[]>;
  importEdges: Array<{ from: string; to: string }>;
};

const AST_IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function normalizeAbsolute(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

function resolveImportTarget(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const extname = path.extname(base);
  const baseWithoutExt = extname ? base.slice(0, -extname.length) : base;
  const candidates: string[] = [base];
  const shouldTryExtensions = !extname || ['.js', '.mjs', '.cjs', '.jsx'].includes(extname);
  if (shouldTryExtensions) {
    for (const ext of AST_IMPORT_EXTENSIONS) {
      candidates.push(`${baseWithoutExt}${ext}`);
      candidates.push(path.join(baseWithoutExt, `index${ext}`));
    }
  }
  for (const candidate of candidates) {
    const normalized = normalizeAbsolute(candidate);
    if (fileSet.has(normalized)) return normalized;
  }
  return null;
}

function extractTsMorphFunctionNames(sourceFile: SourceFile): string[] {
  const names = new Set<string>();

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name) names.add(name);
  }

  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    const name = method.getName();
    if (name) names.add(name);
  }

  for (const decl of sourceFile.getVariableDeclarations()) {
    const initializer = decl.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
    names.add(decl.getName());
  }

  for (const prop of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
    const initializer = prop.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
    const name = prop.getName();
    if (name) names.add(name);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

async function collectFixtureExpectations(files: string[]): Promise<FixtureAstExpectations> {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      noResolve: true,
      skipLibCheck: true,
    },
  });

  const fileSet = new Set(files.map(normalizeAbsolute));
  const functionsByFile = new Map<string, string[]>();
  const importEdges: Array<{ from: string; to: string }> = [];

  for (const absolutePath of files) {
    const content = await fs.readFile(absolutePath, 'utf8');
    const sourceFile = project.createSourceFile(absolutePath, content, { overwrite: true });

    functionsByFile.set(normalizeAbsolute(absolutePath), extractTsMorphFunctionNames(sourceFile));

    const specifiers = [
      ...sourceFile.getImportDeclarations().map((decl) => decl.getModuleSpecifierValue()),
      ...sourceFile.getExportDeclarations()
        .map((decl) => decl.getModuleSpecifierValue())
        .filter((specifier): specifier is string => Boolean(specifier)),
    ];

    for (const specifier of specifiers) {
      const resolved = resolveImportTarget(absolutePath, specifier, fileSet);
      if (resolved) {
        importEdges.push({ from: normalizeAbsolute(absolutePath), to: resolved });
      }
    }
  }

  return { functionsByFile, importEdges };
}

function computeMedian(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function sortFunctionsForSampling(functions: Array<{ filePath: string; name: string }>): Array<{ filePath: string; name: string }> {
  return [...functions].sort((a, b) => {
    const fileCompare = a.filePath.localeCompare(b.filePath);
    if (fileCompare !== 0) return fileCompare;
    return a.name.localeCompare(b.name);
  });
}

const ENV_LLM_MODEL_ID = resolveLiBrainianModelId() ?? '';
const DEFAULT_CLAUDE_HAIKU_MODEL_ID = 'claude-haiku-4-5-20241022';
const CODEX_MINI_MODEL_ID = 'gpt-5.1-codex-mini';
const BOOTSTRAP_TIMEOUT_MS = Number.parseInt(process.env.WAVE0_BOOTSTRAP_TIMEOUT_MS ?? '', 10)
  || 0;
const TEST_TIMEOUT_MS = Number.parseInt(process.env.WAVE0_BOOTSTRAP_TEST_TIMEOUT_MS ?? '', 10)
  || 0;
const RESUME_BOOTSTRAP = process.env.WAVE0_BOOTSTRAP_RESUME === 'true';
const USE_CLAUDE = process.env.WAVE0_BOOTSTRAP_USE_CLAUDE === 'true';

async function measureTargets(targets: string[]): Promise<CodexComplexity> {
  let totalBytes = 0;
  let maxFileBytes = 0;
  for (const target of targets) {
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) continue;
      totalBytes += stat.size;
      if (stat.size > maxFileBytes) maxFileBytes = stat.size;
    } catch {
      // Ignore missing files during measurement
    }
  }
  return { fileCount: targets.length, totalBytes, maxFileBytes };
}

function resolveEnvModelId(provider: 'claude' | 'codex'): string | undefined {
  if (ENV_LLM_MODEL_ID) return ENV_LLM_MODEL_ID;
  return provider === 'claude' ? process.env.CLAUDE_MODEL : process.env.CODEX_MODEL;
}

const BASE_LLM_PROVIDER: 'codex' = 'codex';
const BASE_CODEX_MODEL_ID = resolveEnvModelId('codex') ?? CODEX_MINI_MODEL_ID;
const CLAUDE_HAIKU_MODEL_ID = resolveEnvModelId('claude') ?? DEFAULT_CLAUDE_HAIKU_MODEL_ID;
let llmPhaseOverrides: BootstrapConfig['llmPhaseOverrides'] = {};

// ============================================================================
// SETUP / TEARDOWN
// ============================================================================

beforeAll(async () => {
  previousStrictProvider = process.env.WAVE0_LLM_STRICT_PROVIDER;
  process.env.WAVE0_LLM_STRICT_PROVIDER = 'true';

  if (WAVE0_LLM_SERVICE_PATH) {
    const module = await import(pathToFileURL(WAVE0_LLM_SERVICE_PATH).href);
    setDefaultLlmServiceFactory(async () => new module.LLMService(), { force: true });
  }

  if (!RESUME_BOOTSTRAP) {
    // Clean up any previous test database
    try {
      await fs.rm(TEST_DB_PATH, { force: true });
      await fs.rm(TEST_DB_PATH + '-shm', { force: true });
      await fs.rm(TEST_DB_PATH + '-wal', { force: true });
      await fs.rm(TEST_DB_PATH + '.lock', { force: true });
      await fs.rm(BOOTSTRAP_STATE_PATH, { force: true });
    } catch {
      // Ignore
    }
  } else {
    try {
      await fs.rm(BOOTSTRAP_STATE_PATH, { force: true });
      console.log('Resume mode: cleared bootstrap recovery state to rerun phases');
    } catch {
      // Ignore
    }
  }

  // Create fresh storage (requires both dbPath and workspace)
  storage = createSqliteStorage(TEST_DB_PATH, TEST_WORKSPACE);
  await storage.initialize();

  providerStatus = await checkAllProviders({ workspaceRoot: TEST_WORKSPACE });
  if (!providerStatus.llm.available || !providerStatus.embedding.available) {
    const missing: string[] = [];
    if (!providerStatus.llm.available) {
      missing.push(`LLM: ${providerStatus.llm.error ?? 'unavailable'}`);
    }
    if (!providerStatus.embedding.available) {
      missing.push(`Embedding: ${providerStatus.embedding.error ?? 'unavailable'}`);
    }
    throw new Error(`unverified_by_trace(provider_unavailable): ${missing.join('; ')}`);
  }

  const llmService = createDefaultLlmServiceAdapter();
  const codexHealth = await llmService.checkCodexHealth();
  const claudeHealth = await llmService.checkClaudeHealth();

  const providerErrors: string[] = [];
  if (!codexHealth.available || !codexHealth.authenticated) {
    providerErrors.push(`codex ${codexHealth.error ?? 'unavailable'}`);
  }
  const canUseClaude = USE_CLAUDE && claudeHealth.available && claudeHealth.authenticated;
  if (USE_CLAUDE && !canUseClaude) {
    console.log(`Claude unavailable; continuing with codex only (${claudeHealth.error ?? 'unavailable'})`);
  }
  if (providerErrors.length > 0) {
    throw new Error(`unverified_by_trace(provider_unavailable): ${providerErrors.join('; ')}`);
  }

  llmPhaseOverrides = canUseClaude ? {
    structural_scan: { llmProvider: 'claude', llmModelId: CLAUDE_HAIKU_MODEL_ID },
    context_pack_generation: { llmProvider: 'claude', llmModelId: CLAUDE_HAIKU_MODEL_ID },
    knowledge_generation: { llmProvider: 'claude', llmModelId: CLAUDE_HAIKU_MODEL_ID },
  } : {};

  resolvedLlmProvider = BASE_LLM_PROVIDER;

  // Create embedding service
  embeddingService = new EmbeddingService();
  embeddingDimension = embeddingService.getEmbeddingDimension();

  console.log('Test setup complete. Storage initialized at:', TEST_DB_PATH);
  console.log('Provider status:', providerStatus);
  console.log('LLM provider:', resolvedLlmProvider);
  console.log('LLM phase overrides:', llmPhaseOverrides);
  console.log('LLM use Claude:', USE_CLAUDE);
  console.log('Fixture:', FIXTURE_NAME);
  console.log('Fixture root:', FIXTURE_ROOT_ABS);
  console.log('Resume bootstrap:', RESUME_BOOTSTRAP);
}, 120_000);

afterAll(async () => {
  if (previousStrictProvider === undefined) {
    delete process.env.WAVE0_LLM_STRICT_PROVIDER;
  } else {
    process.env.WAVE0_LLM_STRICT_PROVIDER = previousStrictProvider;
  }

  clearDefaultLlmServiceFactory();

  if (storage) {
    await storage.close();
    storage = null;
  }

  if (RESUME_BOOTSTRAP) return;

  // Clean up test database
  try {
    await fs.rm(TEST_DB_PATH, { force: true });
    await fs.rm(TEST_DB_PATH + '-shm', { force: true });
    await fs.rm(TEST_DB_PATH + '-wal', { force: true });
    await fs.rm(TEST_DB_PATH + '.lock', { force: true });
    await fs.rm(BOOTSTRAP_STATE_PATH, { force: true });
  } catch {
    // Ignore
  }
}, 30_000);

// ============================================================================
// VERIFICATION TESTS
// ============================================================================

describeFixtures('Bootstrap Output Verification', () => {
  describe('Pre-Bootstrap State', () => {
    it('should start with empty storage', async () => {
      const activeStorage = requireStorage();
      if (RESUME_BOOTSTRAP) {
        const modules = await activeStorage.getModules();
        console.log(`Resume mode: ${modules.length} modules present before bootstrap`);
        return;
      }

      const modules = await activeStorage.getModules();
      expect(modules.length).toBe(0);

      const stats = await activeStorage.getStats();
      expect(stats.totalModules).toBe(0);
      expect(stats.totalFunctions).toBe(0);

      console.log('Pre-bootstrap stats:', stats);
    });

    it('should have no modules before bootstrap', async () => {
      const activeStorage = requireStorage();
      if (RESUME_BOOTSTRAP) {
        const modules = await activeStorage.getModules();
        console.log(`Resume mode: ${modules.length} modules present before bootstrap`);
        return;
      }

      const modules = await activeStorage.getModules();
      expect(modules.length).toBe(0);
      console.log('Pre-bootstrap modules:', modules.length);
    });
  });

  describe('Glob Verification', () => {
    it('should find the test files via glob', async () => {
      // First, verify the files actually exist
      for (const filePath of TEST_FILES) {
        const absolutePath = path.join(TEST_WORKSPACE, filePath);
        const exists = await fs.access(absolutePath).then(() => true).catch(() => false);
        console.log(`File ${filePath}: ${exists ? 'EXISTS' : 'MISSING'} at ${absolutePath}`);
        expect(exists).toBe(true);
      }

      // Now verify glob can find them
      const files = await glob(TEST_FILES, {
        cwd: TEST_WORKSPACE,
        ignore: [],
        absolute: true,
      });

      console.log('Glob results:', files);
      expect(files.length).toBe(TEST_FILES.length);
    });
  });

  describe('Bootstrap Execution', () => {
    it('should successfully bootstrap the test files', async () => {
      const activeStorage = requireStorage();
      const activeEmbeddingService = requireEmbeddingService();

      bootstrapTargets = await glob(BOOTSTRAP_INCLUDE_GLOBS, {
        cwd: TEST_WORKSPACE,
        ignore: BOOTSTRAP_EXCLUDE_GLOBS,
        absolute: true,
        nodir: true,
      });
      if (!bootstrapTargets.length) {
        throw new Error('No bootstrap targets found for fixture');
      }
      bootstrapTargets.sort();
      bootstrapTargetStats = await measureTargets(bootstrapTargets);
      const llmModelId = BASE_CODEX_MODEL_ID;
      fixtureExpectations = await collectFixtureExpectations(bootstrapTargets);

      console.log('Bootstrap include globs:', BOOTSTRAP_INCLUDE_GLOBS);
      console.log('Bootstrap targets:', {
        count: bootstrapTargetStats.fileCount,
        totalBytes: bootstrapTargetStats.totalBytes,
        maxFileBytes: bootstrapTargetStats.maxFileBytes,
      });
      console.log('Fixture expectations:', {
        files: fixtureExpectations.functionsByFile.size,
        importEdges: fixtureExpectations.importEdges.length,
      });
      console.log('LLM selection:', { provider: resolvedLlmProvider, modelId: llmModelId });
      console.log('LLM phase overrides:', llmPhaseOverrides);

      const config: BootstrapConfig = {
        workspace: TEST_WORKSPACE,
        bootstrapMode: 'full',
        ingestionWorkspace: FIXTURE_ROOT_ABS,
        include: BOOTSTRAP_INCLUDE_GLOBS,
        exclude: BOOTSTRAP_EXCLUDE_GLOBS,
        maxFileSizeBytes: 1024 * 1024,
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        embeddingService: activeEmbeddingService,
        llmProvider: resolvedLlmProvider,
        llmModelId: llmModelId,
        llmPhaseOverrides,
        useAstIndexer: true,
        forceReindex: !RESUME_BOOTSTRAP,
        progressCallback: (phase: BootstrapPhase, progress: number) => {
          console.log(`[Bootstrap] ${phase.name}: ${Math.round(progress * 100)}%`);
        },
      };

      console.log('Starting bootstrap with config:', {
        workspace: config.workspace,
        ingestionWorkspace: config.ingestionWorkspace,
        include: config.include,
        exclude: config.exclude,
        llmProvider: config.llmProvider,
        llmModelId: config.llmModelId,
        llmPhaseOverrides: config.llmPhaseOverrides,
        forceReindex: config.forceReindex,
      });

      const result = await bootstrapProject(config, activeStorage);
      bootstrapReport = result;

      console.log('Bootstrap result:', {
        success: result.success,
        totalFilesProcessed: result.totalFilesProcessed,
        totalFunctionsIndexed: result.totalFunctionsIndexed,
        totalContextPacksCreated: result.totalContextPacksCreated,
        phases: result.phases?.map(p => ({
          phase: p.phase.name,
          items: p.itemsProcessed,
          errors: p.errors?.length ?? 0,
          errorDetails: p.errors?.slice(0, 3),
        })),
        error: result.error,
      });

      // These are the CRITICAL assertions
      expect(result.success).toBe(true);
      const requireProcessing = !RESUME_BOOTSTRAP || config.forceReindex;
      if (requireProcessing) {
        const processedRatio = result.totalFilesProcessed / bootstrapTargets.length;
        expect(result.totalFilesProcessed).toBeGreaterThanOrEqual(TEST_FILES.length);
        expect(processedRatio).toBeGreaterThanOrEqual(0.8);
        expect(result.totalFunctionsIndexed).toBeGreaterThan(0);
        console.log(`Processed ${result.totalFilesProcessed}/${bootstrapTargets.length} files (${(processedRatio * 100).toFixed(1)}%)`);
      } else {
        console.log('Resume mode: skipping processed-file assertions (checksum cache may short-circuit indexing).');
      }
      for (const phase of result.phases ?? []) {
        const errors = phase.errors ?? [];
        if (errors.length > 0) {
          console.log(`Phase ${phase.phase.name} errors:`, errors);
        }
        expect(errors.length).toBe(0);
        if (phase.phase.name === 'structural_scan') {
          expect(phase.metrics).toBeDefined();
          const discovered = phase.metrics?.filesDiscovered ?? 0;
          const minDiscovered = Math.max(TEST_FILES.length, Math.floor(bootstrapTargets.length * 0.8));
          expect(discovered).toBeGreaterThanOrEqual(minDiscovered);
        }
        if (phase.phase.name === 'semantic_indexing') {
          expect(phase.metrics).toBeDefined();
          const metrics = phase.metrics ?? {};
          const minIndexed = phase.itemsProcessed > 0
            ? Math.max(1, Math.floor(phase.itemsProcessed * 0.8))
            : 0;
          expect(metrics.filesIndexed ?? 0).toBeGreaterThanOrEqual(minIndexed);
          if (metrics.totalItems !== undefined) {
            expect(metrics.totalItems).toBeGreaterThanOrEqual(metrics.filesIndexed ?? 0);
          }
          if (metrics.totalFiles !== undefined) {
            expect(metrics.totalFiles).toBeGreaterThanOrEqual(metrics.filesIndexed ?? 0);
          }
        }
        if (phase.phase.name === 'context_pack_generation') {
          expect(phase.metrics).toBeDefined();
          const metrics = phase.metrics ?? {};
          const minPacks = phase.itemsProcessed > 0
            ? Math.max(1, Math.floor(phase.itemsProcessed * 0.8))
            : 0;
          expect(metrics.contextPacksCreated ?? 0).toBeGreaterThanOrEqual(minPacks);
          if (metrics.totalItems !== undefined) {
            expect(metrics.totalItems).toBeGreaterThanOrEqual(metrics.contextPacksCreated ?? 0);
          }
        }
      }
    }, TEST_TIMEOUT_MS);
  });

  describe('Post-Bootstrap Verification', () => {
    it('should have indexed the expected modules', async () => {
      const activeStorage = requireStorage();
      const modules = await activeStorage.getModules();
      console.log('Indexed modules:', modules.map(m => m.path));
      if (!bootstrapTargets.length) {
        throw new Error('Bootstrap targets not recorded; bootstrap may not have run');
      }
      if (!fixtureExpectations) {
        throw new Error('Fixture expectations not recorded; bootstrap may not have run');
      }

      // Verify each expected module was indexed
      for (const expected of EXPECTED_MODULES) {
        const found = modules.find(m => expected.pathPattern.test(m.path));
        expect(found).toBeDefined();
        if (found) {
          console.log(`✓ Found module matching ${expected.pathPattern}: ${found.path}`);
        }
      }

      const modulePathSet = new Set(modules.map((m) => normalizeAbsolute(m.path)));
      let matchedTargets = 0;
      for (const target of bootstrapTargets) {
        if (modulePathSet.has(normalizeAbsolute(target))) matchedTargets++;
      }
      const moduleCoverage = matchedTargets / bootstrapTargets.length;
      expect(moduleCoverage).toBeGreaterThanOrEqual(0.8);
      expect(modules.length).toBeGreaterThanOrEqual(EXPECTED_MODULES.length);

      const allFunctions = await activeStorage.getFunctions();
      for (const expected of EXPECTED_MODULES) {
        const moduleMatch = modules.find(m => expected.pathPattern.test(m.path));
        if (!moduleMatch) continue;

        const moduleFunctions = allFunctions.filter(fn => fn.filePath === moduleMatch.path);
        const expectedNames = fixtureExpectations.functionsByFile.get(normalizeAbsolute(moduleMatch.path)) ?? [];
        const fallbackMinFunctions = expectedNames.length
          ? Math.max(1, Math.ceil(expectedNames.length * (expected.minFunctionRatio ?? 0.4)))
          : 0;
        const minFunctions = expected.minFunctions ?? fallbackMinFunctions;
        expect(moduleFunctions.length).toBeGreaterThanOrEqual(minFunctions);
        if (expectedNames.length) {
          const matchedNames = expectedNames.filter((name) => moduleFunctions.some((fn) => fn.name === name));
          const minMatchRatio = expected.minMatchRatio ?? 0.6;
          const expectedMinMatches = Math.min(
            expectedNames.length,
            Math.max(1, Math.ceil(expectedNames.length * minMatchRatio))
          );
          expect(matchedNames.length).toBeGreaterThanOrEqual(expectedMinMatches);
        }
      }
    });

    it('should have generated embeddings for functions', async () => {
      const activeStorage = requireStorage();

      const functions = await activeStorage.getFunctions();
      const stats = await activeStorage.getStats();
      const dimension = embeddingDimension;
      expect(functions.length).toBeGreaterThan(0);

      const embeddingCoverage = stats.totalEmbeddings / functions.length;
      expect(embeddingCoverage).toBeGreaterThanOrEqual(0.9);
      console.log(`Embeddings: ${stats.totalEmbeddings}/${functions.length} functions (${(embeddingCoverage * 100).toFixed(1)}%)`);

      const orderedFunctions = sortFunctionsForSampling(functions.map((fn) => ({ filePath: fn.filePath, name: fn.name })));
      const sampleSize = Math.min(20, Math.max(6, Math.ceil(functions.length * 0.2)));
      const sample = orderedFunctions.slice(0, sampleSize)
        .map(({ filePath, name }) => functions.find((fn) => fn.filePath === filePath && fn.name === name))
        .filter((fn): fn is typeof functions[number] => Boolean(fn));

      const embeddings = await Promise.all(sample.map((fn) => activeStorage.getEmbedding(fn.id)));
      embeddings.forEach((embedding, index) => {
        const fn = sample[index];
        expect(embedding).toBeTruthy();
        if (!embedding) return;

        expect(embedding.length).toBe(dimension);
        let norm = 0;
        for (let i = 0; i < embedding.length; i++) {
          norm += embedding[i] * embedding[i];
        }
        expect(Math.sqrt(norm)).toBeCloseTo(1, 1);
        console.log(`✓ Sample embedding ${fn.name} (${fn.filePath}) ok`);
      });
    });

    it('should have extracted functions from code files', async () => {
      const activeStorage = requireStorage();

      const modules = await activeStorage.getModules();
      const allFunctions = await activeStorage.getFunctions();
      let totalFunctions = 0;

      for (const mod of modules) {
        const functions = allFunctions.filter(fn => fn.filePath === mod.path);
        totalFunctions += functions.length;

        if (functions.length > 0) {
          console.log(`Module ${mod.path}: ${functions.length} functions`);
          for (const fn of functions.slice(0, 3)) {
            console.log(`  - ${fn.name}()`);
          }
        }
      }

      // merge.ts should have at least some functions
      const mergeModule = modules.find(m => /source\/utils\/merge\.ts$/.test(m.path));
      if (mergeModule) {
        const mergeFunctions = allFunctions.filter(fn => fn.filePath === mergeModule.path);
        expect(mergeFunctions.length).toBeGreaterThan(0);
        console.log(`merge.ts has ${mergeFunctions.length} functions`);
      }

      console.log(`Total functions extracted: ${totalFunctions}`);
    });

    it('should have created context packs', async () => {
      const activeStorage = requireStorage();
      const modules = await activeStorage.getModules();
      let packsFound = 0;

      for (const mod of modules) {
        const pack = await activeStorage.getContextPackForTarget(mod.id, 'module_context');
        if (pack) {
          packsFound++;
          expect(pack.targetId).toBe(mod.id);
          expect(pack.packType).toBeDefined();
          console.log(`✓ Module ${mod.path} has context pack (confidence: ${pack.confidence})`);
        }
      }

      console.log(`Context packs: ${packsFound}/${modules.length} modules`);
      if (modules.length > 0) {
        const packCoverage = packsFound / modules.length;
        expect(packCoverage).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should have built import graph edges', async () => {
      const activeStorage = requireStorage();
      if (!fixtureExpectations) throw new Error('Fixture expectations not recorded');

      const modules = await activeStorage.getModules();
      const importEdges = await activeStorage.getGraphEdges({ edgeTypes: ['imports'] });
      console.log(`Import edges found: ${importEdges.length}`);

      for (const edge of importEdges.slice(0, 10)) {
        console.log(`  ${edge.fromId} --imports--> ${edge.toId}`);
      }

      const moduleIdByPath = new Map<string, string>();
      modules.forEach((mod) => moduleIdByPath.set(normalizeAbsolute(mod.path), mod.id));
      const expectedEdges = fixtureExpectations.importEdges
        .map((edge) => {
          const fromId = moduleIdByPath.get(edge.from);
          const toId = moduleIdByPath.get(edge.to);
          if (!fromId || !toId) return null;
          return { fromId, toId };
        })
        .filter((edge): edge is { fromId: string; toId: string } => Boolean(edge));

      if (expectedEdges.length === 0) {
        throw new Error('Fixture did not produce import expectations');
      }

      const edgeKey = (fromId: string, toId: string) => `${fromId}::${toId}`;
      const edgeSet = new Set(importEdges.map(edge => edgeKey(edge.fromId, edge.toId)));
      let matched = 0;
      for (const edge of expectedEdges) {
        if (edgeSet.has(edgeKey(edge.fromId, edge.toId))) matched++;
      }
      const coverage = matched / expectedEdges.length;
      expect(coverage).toBeGreaterThanOrEqual(0.8);
      console.log(`Import edge coverage: ${matched}/${expectedEdges.length} (${(coverage * 100).toFixed(1)}%)`);
    });

    it('should have indexed modules after bootstrap', async () => {
      const activeStorage = requireStorage();
      const modules = await activeStorage.getModules();
      console.log('Post-bootstrap modules:', modules.length);

      // After successful bootstrap, should have modules
      expect(modules.length).toBeGreaterThan(0);
      if (bootstrapTargets.length) {
        expect(modules.length).toBeGreaterThanOrEqual(EXPECTED_MODULES.length);
      }
    });
  });

  describe('Query Verification', () => {
    it('should return relevant results for semantic queries', async () => {
      const activeStorage = requireStorage();
      const activeEmbeddingService = requireEmbeddingService();
      const functions = await activeStorage.getFunctions();
      expect(functions.length).toBeGreaterThan(0);
      const functionsById = new Map(functions.map((fn) => [fn.id, fn]));
      const similarityLimit = Math.max(20, Math.min(80, functions.length));

      const rankFilesForQuery = async (queryText: string) => {
        const queryResult = await activeEmbeddingService.generateEmbedding({
          text: queryText,
          kind: 'query',
        });

        const searchResponse = await activeStorage.findSimilarByEmbedding(queryResult.embedding, {
          limit: similarityLimit,
          minSimilarity: 0,
          entityTypes: ['function'],
        });

        const fileScores = new Map<string, number>();
        for (const result of searchResponse.results) {
          const fn = functionsById.get(result.entityId);
          if (!fn) continue;
          const current = fileScores.get(fn.filePath);
          if (current === undefined || result.similarity > current) {
            fileScores.set(fn.filePath, result.similarity);
          }
        }

        return [...fileScores.entries()]
          .map(([filePath, score]) => ({ filePath, score }))
          .sort((a, b) => b.score - a.score);
      };

      const assertRetrieval = (
        ranking: Array<{ filePath: string; score: number }>,
        targetPattern: RegExp,
        label: string,
        options: { topK?: number; minMargin?: number } = {}
      ) => {
        const topK = Math.min(options.topK ?? 6, Math.max(1, ranking.length));
        const targetIndex = ranking.findIndex((entry) => targetPattern.test(entry.filePath));
        const scores = ranking.map((entry) => entry.score);
        const median = computeMedian(scores);
        const targetScore = targetIndex >= 0 ? ranking[targetIndex].score : Number.NaN;
        const margin = options.minMargin ?? 0.02;

        console.log(`Query: "${label}"`);
        console.log('Top results:');
        for (const result of ranking.slice(0, topK)) {
          console.log(`  ${result.score.toFixed(3)}: ${result.filePath}`);
        }
        console.log(`Median score: ${median.toFixed(3)}; target score: ${Number.isFinite(targetScore) ? targetScore.toFixed(3) : 'n/a'}`);

        expect(targetIndex).toBeGreaterThanOrEqual(0);
        expect(targetIndex).toBeLessThan(topK);
        expect(targetScore).toBeGreaterThanOrEqual(median + margin);
      };

      for (const expectation of QUERY_EXPECTATIONS) {
        const ranking = await rankFilesForQuery(expectation.query);
        assertRetrieval(ranking, expectation.targetPattern, expectation.label, {
          topK: expectation.topK,
          minMargin: expectation.minMargin,
        });
      }
    });
  });
});

// ============================================================================
// DETAILED STATISTICS
// ============================================================================

describeFixtures('Bootstrap Statistics', () => {
  it('should report accurate statistics', async () => {
    const activeStorage = requireStorage();
    const stats = await activeStorage.getStats();
    const expectedMinFunctions = EXPECTED_MODULES.reduce((sum, mod) => {
      if (!fixtureExpectations) return sum + (mod.minFunctions ?? 0);
      const matchedPath = [...fixtureExpectations.functionsByFile.keys()]
        .find((filePath) => mod.pathPattern.test(filePath));
      const expectedNames = matchedPath ? fixtureExpectations.functionsByFile.get(matchedPath) ?? [] : [];
      const fallbackMinFunctions = expectedNames.length
        ? Math.max(1, Math.ceil(expectedNames.length * (mod.minFunctionRatio ?? 0.4)))
        : 0;
      return sum + (mod.minFunctions ?? fallbackMinFunctions);
    }, 0);

    console.log('=== FINAL BOOTSTRAP STATISTICS ===');
    console.log(`Total Modules: ${stats.totalModules}`);
    console.log(`Total Functions: ${stats.totalFunctions}`);
    console.log(`Total Context Packs: ${stats.totalContextPacks}`);
    console.log(`Total Embeddings: ${stats.totalEmbeddings}`);
    console.log(`Average Confidence: ${stats.averageConfidence.toFixed(2)}`);
    console.log('==================================');

    // Minimum expectations
    if (!bootstrapTargets.length) {
      throw new Error('Bootstrap targets not recorded; bootstrap may not have run');
    }
    const moduleCoverage = stats.totalModules / bootstrapTargets.length;
    expect(moduleCoverage).toBeGreaterThanOrEqual(0.8);
    expect(stats.totalFunctions).toBeGreaterThanOrEqual(expectedMinFunctions);
    if (stats.totalFunctions > 0) {
      expect(stats.totalEmbeddings / stats.totalFunctions).toBeGreaterThanOrEqual(0.9);
    }
    if (stats.totalModules > 0) {
      const packCoverage = stats.totalContextPacks / stats.totalModules;
      expect(packCoverage).toBeGreaterThanOrEqual(0.8);
    }
    if (bootstrapReport) {
      const requireProcessing = !RESUME_BOOTSTRAP;
      if (requireProcessing) {
        const processedRatio = bootstrapReport.totalFilesProcessed / bootstrapTargets.length;
        expect(bootstrapReport.totalFilesProcessed).toBeGreaterThanOrEqual(TEST_FILES.length);
        expect(processedRatio).toBeGreaterThanOrEqual(0.8);
        if (stats.totalFunctions > 0) {
          const functionCoverage = bootstrapReport.totalFunctionsIndexed / stats.totalFunctions;
          expect(functionCoverage).toBeGreaterThanOrEqual(0.9);
        }
      } else {
        console.log('Resume mode: skipping processed-file assertions for bootstrap report.');
      }
    }
  });
});
