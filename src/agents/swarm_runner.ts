import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { LibrarianStorage } from '../storage/types.js';
import type { GovernorContext } from '../api/governor_context.js';
import type { EmbeddingProvider, EmbeddingService } from '../api/embeddings.js';
import { computeGraphMetrics, writeGraphMetricsReport, type GraphMetricsEntry } from '../graphs/metrics.js';
import type { IndexingTask } from '../types.js';
import { IndexLibrarian } from './index_librarian.js';
import { SwarmScheduler } from './swarm_scheduler.js';
import { ParserRegistry } from './parser_registry.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { logWarning } from '../telemetry/logger.js';
import { removeControlChars } from '../security/sanitization.js';

const TAG = 'SwarmRunner';

function sanitizeForLog(value: string): string {
  return removeControlChars(value).trim();
}

/** Safely unlink a file, logging errors instead of silently swallowing them */
async function safeUnlink(filePath: string, context: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // ENOENT is expected if file was already removed - don't log
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logWarning(`${TAG}: Failed to unlink file during ${context}`, {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// ============================================================================
// CHECKPOINT V2 - Content-aware, configuration-aware checkpointing
// ============================================================================

/**
 * Checkpoint schema version for forward compatibility.
 * Increment this when the checkpoint format changes in a breaking way.
 */
const CHECKPOINT_SCHEMA_VERSION = 2;

/**
 * Indexer version - bump this when the indexing logic changes significantly.
 * This ensures files get reindexed when the extraction logic improves.
 */
const INDEXER_VERSION = '2.0.0';

/**
 * Configuration fingerprint for detecting configuration changes.
 */
interface ConfigFingerprint {
  llmProvider?: string;
  llmModelId?: string;
  useAstIndexer?: boolean;
  embeddingProvider?: string;
  embeddingDimension?: number;
  generateEmbeddings?: boolean;
  fileTimeoutMs?: number;
  fileTimeoutRetries?: number;
  fileTimeoutPolicy?: string;
}

/**
 * Per-file checkpoint entry with content hash.
 */
interface FileCheckpointEntry {
  contentHash: string;        // SHA-256 of file content
  processedAt: string;        // ISO timestamp
  indexerVersion: string;     // Version of indexer that processed it
}

/**
 * V2 checkpoint format with content-aware tracking.
 */
interface CheckpointV2 {
  schemaVersion: 2;
  indexerVersion: string;
  configFingerprint: ConfigFingerprint;
  createdAt: string;
  updatedAt: string;
  files: Record<string, FileCheckpointEntry>;
}

/**
 * Legacy V1 checkpoint format for migration.
 */
interface CheckpointV1 {
  completed?: string[];
}

export interface SwarmRunnerOptions {
  storage: LibrarianStorage;
  workspace: string;
  maxWorkers: number;
  maxFileSizeBytes: number;
  useAstIndexer?: boolean;
  generateEmbeddings?: boolean;
  /** Whether to run per-file LLM analysis (purpose extraction) during AST indexing. */
  enableLlmAnalysis?: boolean;
  embeddingBatchSize?: number;
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  embeddingProvider?: EmbeddingProvider;
  embeddingModelId?: string;
  embeddingService?: EmbeddingService;
  fileTimeoutMs?: number;
  fileTimeoutRetries?: number;
  fileTimeoutPolicy?: 'skip' | 'retry' | 'fail';
  governor?: GovernorContext;
  progressCallback?: (progress: { total: number; completed: number; currentFile?: string }) => void;
  /** Force re-indexing of all files, ignoring checkpoint cache */
  forceReindex?: boolean;
  /** Persist graph metrics from in-memory accumulator at end of run. */
  persistGraphMetrics?: boolean;
}

export class SwarmRunner {
  private readonly storage: LibrarianStorage;
  private readonly workspace: string;
  private readonly maxWorkers: number;
  private readonly maxFileSizeBytes: number;
  private readonly useAstIndexer?: boolean;
  private readonly generateEmbeddings?: boolean;
  private readonly enableLlmAnalysis?: boolean;
  private readonly embeddingBatchSize?: number;
  private readonly llmProvider?: 'claude' | 'codex';
  private readonly llmModelId?: string;
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly embeddingModelId?: string;
  private readonly embeddingService?: EmbeddingService;
  private readonly fileTimeoutMs?: number;
  private readonly fileTimeoutRetries?: number;
  private readonly fileTimeoutPolicy?: 'skip' | 'retry' | 'fail';
  private readonly governor?: GovernorContext;
  private readonly progressCallback?: (progress: { total: number; completed: number; currentFile?: string }) => void;
  private readonly forceReindex: boolean;
  private readonly persistGraphMetricsEnabled: boolean;

  constructor(options: SwarmRunnerOptions) {
    this.storage = options.storage;
    this.workspace = options.workspace;
    this.maxWorkers = Math.max(1, options.maxWorkers);
    this.maxFileSizeBytes = options.maxFileSizeBytes;
    this.useAstIndexer = options.useAstIndexer;
    this.generateEmbeddings = options.generateEmbeddings;
    this.enableLlmAnalysis = options.enableLlmAnalysis;
    this.embeddingBatchSize = options.embeddingBatchSize;
    this.llmProvider = options.llmProvider;
    this.llmModelId = options.llmModelId;
    this.embeddingProvider = options.embeddingProvider;
    this.embeddingModelId = options.embeddingModelId;
    this.embeddingService = options.embeddingService;
    this.fileTimeoutMs = options.fileTimeoutMs;
    this.fileTimeoutRetries = options.fileTimeoutRetries;
    this.fileTimeoutPolicy = options.fileTimeoutPolicy;
    this.governor = options.governor;
    this.progressCallback = options.progressCallback;
    this.forceReindex = options.forceReindex ?? false;
    this.persistGraphMetricsEnabled = options.persistGraphMetrics ?? true;
  }
  /**
   * Build configuration fingerprint for checkpoint invalidation.
   */
  private buildConfigFingerprint(): ConfigFingerprint {
    return {
      llmProvider: this.llmProvider,
      llmModelId: this.llmModelId,
      useAstIndexer: this.useAstIndexer,
      embeddingProvider: this.embeddingProvider,
      generateEmbeddings: this.generateEmbeddings,
      fileTimeoutMs: this.fileTimeoutMs,
      fileTimeoutRetries: this.fileTimeoutRetries,
      fileTimeoutPolicy: this.fileTimeoutPolicy,
    };
  }

  async run(files: string[]): Promise<{ files: number; functions: number; errors: string[] }> {
    if (!files.length) return { files: 0, functions: 0, errors: [] };

    const scheduler = new SwarmScheduler(this.storage);
    const ordered = await scheduler.prioritize(files);
    const totalFiles = ordered.length;
    const { checkpointPath, lockDir } = await ensureSwarmDirs(this.workspace);
    if (this.forceReindex) {
      await clearSwarmLocks(lockDir);
    }

    // Build current config fingerprint for comparison
    const currentConfig = this.buildConfigFingerprint();

    // Load checkpoint with V2 content-aware logic
    const checkpoint = this.forceReindex
      ? createEmptyCheckpoint(currentConfig)
      : await loadCheckpointV2(checkpointPath, currentConfig);

    // Determine which files need processing based on content hash comparison
    const { pending, contentHashes } = await filterPendingFiles(
      ordered,
      checkpoint,
      this.forceReindex
    );

    const graphAccumulator = createGraphAccumulator();
    const workerGovernors = this.governor
      ? Array.from({ length: this.maxWorkers }, () => this.governor!.fork())
      : Array.from({ length: this.maxWorkers }, () => undefined);

    const workers = workerGovernors.map((governorContext) => new IndexLibrarian({
      maxFileSizeBytes: this.maxFileSizeBytes,
      useAstIndexer: this.useAstIndexer,
      generateEmbeddings: this.generateEmbeddings ?? true,
      createContextPacks: false,
      resolveExternalCallEdges: false,
      enableLlmAnalysis: this.enableLlmAnalysis ?? false,
      embeddingBatchSize: this.embeddingBatchSize,
      llmProvider: this.llmProvider,
      llmModelId: this.llmModelId,
      embeddingProvider: this.embeddingProvider,
      embeddingModelId: this.embeddingModelId,
      embeddingService: this.embeddingService,
      fileTimeoutMs: this.fileTimeoutMs,
      fileTimeoutRetries: this.fileTimeoutRetries,
      fileTimeoutPolicy: this.fileTimeoutPolicy,
      governorContext,
      workspaceRoot: this.workspace,
      computeGraphMetrics: false,
    }));

    for (const worker of workers) {
      await worker.initialize(this.storage);
      worker.attachGraphAccumulator(graphAccumulator);
    }

    let filesProcessed = 0;
    let functionsIndexed = 0;
    const errors: string[] = [];
    const completedCount = totalFiles - pending.length;

    if (this.progressCallback) {
      this.progressCallback({ total: totalFiles, completed: completedCount });
    }

    let checkpointQueue = Promise.resolve();
    const enqueueCheckpoint = async (): Promise<void> => {
      const snapshot = { ...checkpoint };
      checkpointQueue = checkpointQueue.then(() => saveCheckpointV2(checkpointPath, snapshot));
      return checkpointQueue;
    };

    const pendingLock = createMutex();
    const takeNext = (): Promise<string | null> => pendingLock.run(() => pending.shift() ?? null);
    const requeue = (filePath: string): Promise<void> => pendingLock.run(() => { pending.push(filePath); });

    // Memory cleanup configuration
    const MEMORY_CLEANUP_INTERVAL = 50; // Clean up every 50 files
    let workerFilesProcessed = 0;

    const runWorker = async (worker: IndexLibrarian): Promise<void> => {
      while (true) {
        const filePath = await takeNext();
        if (!filePath) break;

        const lockPath = lockPathForFile(lockDir, filePath);
        if (!(await acquireLock(lockPath))) {
          await requeue(filePath);
          await delay(25);
          continue;
        }

        try {
          const task: IndexingTask = {
            type: 'targeted',
            paths: [filePath],
            priority: 'high',
            reason: 'swarm',
            triggeredBy: 'bootstrap',
          };
          const result = await worker.processTask(task);
          filesProcessed += result.filesProcessed;
          functionsIndexed += result.functionsIndexed;
          workerFilesProcessed++;
          if (result.errors.length > 0) {
            errors.push(
              ...result.errors.map((item) => `${sanitizeForLog(item.path)}: ${sanitizeForLog(item.error)}`)
            );
          }

          // Update checkpoint with content hash
          const contentHash = contentHashes.get(filePath) ?? await computeFileHash(filePath);
          checkpoint.files[filePath] = {
            contentHash,
            processedAt: new Date().toISOString(),
            indexerVersion: INDEXER_VERSION,
          };
          checkpoint.updatedAt = new Date().toISOString();

          if (this.progressCallback) {
            const done = totalFiles - pending.length;
            this.progressCallback({ total: totalFiles, completed: done, currentFile: filePath });
          }

          await enqueueCheckpoint();

          // Periodic memory cleanup to prevent OOM during large batch operations
          if (workerFilesProcessed % MEMORY_CLEANUP_INTERVAL === 0) {
            ParserRegistry.getInstance().clearCache();
            // Suggest garbage collection if available (requires --expose-gc flag)
            if (typeof global.gc === 'function') {
              global.gc();
            }
          }
        } finally {
          await releaseLock(lockPath);
        }
      }
    };

    await Promise.all(workers.map((worker) => runWorker(worker)));
    await checkpointQueue;
    if (workers.length > 0) {
      try {
        const resolveResult = await workers[0].resolveExternalCallEdges();
        if (resolveResult.resolved > 0) {
          const pct = resolveResult.total > 0
            ? Math.round((resolveResult.resolved / resolveResult.total) * 100)
            : 0;
          console.error(
            `[SwarmRunner] Resolved ${resolveResult.resolved}/${resolveResult.total} external edges (${pct}%)`,
          );
        }
      } catch (error) {
        errors.push(
          `external_edge_resolution: ${sanitizeForLog(error instanceof Error ? error.message : String(error))}`,
        );
      }
    }
    await Promise.all(workers.map((worker) => worker.shutdown()));
    if (this.persistGraphMetricsEnabled) {
      await persistGraphMetrics(this.storage, graphAccumulator, this.workspace);
    }

    return { files: filesProcessed, functions: functionsIndexed, errors };
  }
}

// ============================================================================
// CHECKPOINT V2 FUNCTIONS
// ============================================================================

async function ensureSwarmDirs(workspace: string): Promise<{ checkpointPath: string; lockDir: string }> {
  const swarmDir = path.join(workspace, '.librarian', 'swarm');
  const lockDir = path.join(swarmDir, 'locks');
  await fs.mkdir(lockDir, { recursive: true });
  return { checkpointPath: path.join(swarmDir, 'checkpoint.json'), lockDir };
}

async function clearSwarmLocks(lockDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(lockDir);
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.lock'))
        .map((entry) => safeUnlink(path.join(lockDir, entry), 'clearSwarmLocks'))
    );
  } catch {
    // Ignore lock cleanup failures; stale locks are handled by acquireLock.
  }
}

/**
 * Create an empty V2 checkpoint with current configuration.
 */
function createEmptyCheckpoint(config: ConfigFingerprint): CheckpointV2 {
  const now = new Date().toISOString();
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    indexerVersion: INDEXER_VERSION,
    configFingerprint: config,
    createdAt: now,
    updatedAt: now,
    files: {},
  };
}

/**
 * Check if two config fingerprints are equivalent.
 */
function configsMatch(a: ConfigFingerprint, b: ConfigFingerprint): boolean {
  return (
    a.llmProvider === b.llmProvider &&
    a.llmModelId === b.llmModelId &&
    a.useAstIndexer === b.useAstIndexer &&
    a.embeddingProvider === b.embeddingProvider &&
    a.generateEmbeddings === b.generateEmbeddings &&
    a.fileTimeoutMs === b.fileTimeoutMs &&
    a.fileTimeoutRetries === b.fileTimeoutRetries &&
    a.fileTimeoutPolicy === b.fileTimeoutPolicy
  );
}

/**
 * Load V2 checkpoint, migrating from V1 if necessary.
 * Returns empty checkpoint if config has changed (forces full reindex).
 */
async function loadCheckpointV2(
  pathname: string,
  currentConfig: ConfigFingerprint
): Promise<CheckpointV2> {
  try {
    const raw = await fs.readFile(pathname, 'utf8');
    const parsed = safeJsonParse<CheckpointV2 | CheckpointV1>(raw);

    if (!parsed.ok) {
      return createEmptyCheckpoint(currentConfig);
    }

    const data = parsed.value;

    // Check if it's a V2 checkpoint
    if ('schemaVersion' in data && data.schemaVersion === 2) {
      const v2 = data as CheckpointV2;

      // If indexer version changed, invalidate all entries
      if (v2.indexerVersion !== INDEXER_VERSION) {
        console.error(`[SwarmRunner] Indexer version changed (${v2.indexerVersion} → ${INDEXER_VERSION}), reindexing all files`);
        return createEmptyCheckpoint(currentConfig);
      }

      // If config changed, invalidate all entries
      if (!configsMatch(v2.configFingerprint, currentConfig)) {
        console.error('[SwarmRunner] Configuration changed, reindexing all files');
        return createEmptyCheckpoint(currentConfig);
      }

      return v2;
    }

    // Migrate from V1 checkpoint (no content hashes, must reindex)
    console.error('[SwarmRunner] Migrating from V1 checkpoint, reindexing all files for content hashing');
    return createEmptyCheckpoint(currentConfig);
  } catch {
    return createEmptyCheckpoint(currentConfig);
  }
}

/**
 * Save V2 checkpoint atomically.
 */
async function saveCheckpointV2(pathname: string, checkpoint: CheckpointV2): Promise<void> {
  const payload = JSON.stringify(checkpoint, null, 2);
  const tempPath = `${pathname}.tmp.${process.pid}`;

  try {
    await fs.writeFile(tempPath, payload + '\n', 'utf8');
    await fs.rename(tempPath, pathname);
  } catch {
    // Clean up temp file if rename failed
    await safeUnlink(tempPath, 'saveCheckpointV2:cleanup');
    throw new Error('Failed to save checkpoint');
  }
}

/**
 * Compute SHA-256 hash of file content.
 */
async function computeFileHash(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    // If file can't be read, return empty hash (will force reindex)
    return '';
  }
}

/**
 * Filter files that need processing based on content hash comparison.
 * Returns files that are new, modified, or have outdated indexer version.
 */
async function filterPendingFiles(
  files: string[],
  checkpoint: CheckpointV2,
  forceReindex: boolean
): Promise<{ pending: string[]; contentHashes: Map<string, string> }> {
  if (forceReindex) {
    // Compute all hashes upfront for forceReindex
    const contentHashes = new Map<string, string>();
    for (const file of files) {
      contentHashes.set(file, await computeFileHash(file));
    }
    return { pending: [...files], contentHashes };
  }

  const pending: string[] = [];
  const contentHashes = new Map<string, string>();

  // Process files in parallel batches for efficiency
  const batchSize = 50;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (file) => {
        const currentHash = await computeFileHash(file);
        contentHashes.set(file, currentHash);

        const entry = checkpoint.files[file];
        if (!entry) {
          // New file, needs indexing
          return { file, needsProcessing: true, reason: 'new' };
        }

        if (entry.indexerVersion !== INDEXER_VERSION) {
          // Indexer version changed, needs re-indexing
          return { file, needsProcessing: true, reason: 'indexer_updated' };
        }

        if (entry.contentHash !== currentHash) {
          // Content changed, needs re-indexing
          return { file, needsProcessing: true, reason: 'content_changed' };
        }

        // File is up-to-date
        return { file, needsProcessing: false, reason: 'unchanged' };
      })
    );

    for (const result of results) {
      if (result.needsProcessing) {
        pending.push(result.file);
      }
    }
  }

  return { pending, contentHashes };
}

// Legacy V1 functions (kept for reference, but no longer used)
async function loadCheckpoint(pathname: string): Promise<Set<string>> { try { const raw = await fs.readFile(pathname, 'utf8'); const parsed = safeJsonParse<{ completed?: string[] }>(raw); if (!parsed.ok) return new Set(); return new Set(Array.isArray(parsed.value.completed) ? parsed.value.completed : []); } catch { return new Set(); } }
async function saveCheckpoint(pathname: string, completed: Set<string>): Promise<void> { const payload = JSON.stringify({ completed: Array.from(completed) }); await fs.writeFile(pathname, payload + '\n', 'utf8'); }
function lockPathForFile(lockDir: string, filePath: string): string { const hash = createHash('sha256').update(filePath).digest('hex'); return path.join(lockDir, `${hash}.lock`); }
// Reduced from 10 minutes to 3 minutes for faster crash recovery
const DEFAULT_LOCK_STALE_MS = 3 * 60 * 1000;
async function acquireLock(lockPath: string, staleMs: number = DEFAULT_LOCK_STALE_MS): Promise<boolean> {
  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.close();
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'EEXIST') return false;
    if (await isLockStale(lockPath, staleMs)) {
      await safeUnlink(lockPath, 'acquireLock:stale');
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.close();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}
async function releaseLock(lockPath: string): Promise<void> { await safeUnlink(lockPath, 'releaseLock'); }
async function isLockStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const stats = await fs.stat(lockPath);
    return Date.now() - stats.mtimeMs > staleMs;
  } catch {
    return false;
  }
}
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
type Mutex = { run<T>(fn: () => Promise<T> | T): Promise<T> };
function createMutex(): Mutex {
  let chain = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      const next = chain.then(fn, fn);
      chain = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}

type GraphAccumulator = {
  functionGraph: Map<string, Set<string>>;
  moduleIdByPath: Map<string, string>;
  modulePathById: Map<string, string>;
  moduleDepsById: Map<string, string[]>;
};

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function createGraphAccumulator(): GraphAccumulator {
  return {
    functionGraph: new Map(),
    moduleIdByPath: new Map(),
    modulePathById: new Map(),
    moduleDepsById: new Map(),
  };
}

async function persistGraphMetrics(
  storage: LibrarianStorage,
  accumulator: GraphAccumulator,
  workspace: string
): Promise<void> {
  if (!accumulator.functionGraph.size && !accumulator.moduleDepsById.size) return;
  const moduleGraph = new Map<string, Set<string>>();
  for (const moduleId of accumulator.modulePathById.keys()) {
    moduleGraph.set(moduleId, new Set());
  }
  for (const [moduleId, deps] of accumulator.moduleDepsById) {
    const fromPath = accumulator.modulePathById.get(moduleId);
    if (!fromPath) continue;
    const edges = moduleGraph.get(moduleId) ?? new Set<string>();
    for (const dep of deps) {
      const target = resolveModuleDependency(dep, fromPath, accumulator.moduleIdByPath);
      if (target) edges.add(target);
    }
    moduleGraph.set(moduleId, edges);
  }
  const { metrics, report } = computeGraphMetrics({ function: accumulator.functionGraph, module: moduleGraph });
  const metricsStore = storage as { setGraphMetrics?: (entries: GraphMetricsEntry[]) => Promise<void> };
  if (metricsStore.setGraphMetrics) {
    await metricsStore.setGraphMetrics(metrics);
  }
  await writeGraphMetricsReport(workspace, report);
}

function resolveModuleDependency(
  dependency: string,
  fromPath: string,
  moduleIdByPath: Map<string, string>
): string | null {
  if (!dependency.startsWith('.') && !dependency.startsWith('/')) return null;
  const direct = moduleIdByPath.get(normalizeGraphPath(dependency));
  if (direct) return direct;
  const base = dependency.startsWith('/')
    ? normalizeGraphPath(dependency)
    : normalizeGraphPath(path.resolve(path.dirname(fromPath), dependency));
  const candidates = new Set<string>([base]);
  const ext = path.extname(base);
  const addCandidates = (root: string, includeIndex: boolean): void => {
    for (const nextExt of RESOLVE_EXTENSIONS) {
      candidates.add(`${root}${nextExt}`);
      if (includeIndex) {
        candidates.add(path.join(root, `index${nextExt}`));
      }
    }
  };
  if (!ext) {
    addCandidates(base, true);
  } else if (RESOLVE_EXTENSIONS.includes(ext)) {
    const withoutExt = base.slice(0, -ext.length);
    if (withoutExt && withoutExt !== base) {
      addCandidates(withoutExt, false);
    }
  }
  for (const candidate of candidates) {
    const resolved = moduleIdByPath.get(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function normalizeGraphPath(value: string): string {
  return path.normalize(path.resolve(value));
}
