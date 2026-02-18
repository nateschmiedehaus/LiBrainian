import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import type { Librarian } from '../api/librarian.js';
import type { LibrarianStorage } from '../storage/types.js';
import { getAllIncludePatterns, getFileCategory, isExcluded, EXCLUDE_PATTERNS } from '../universal_patterns.js';
import { logInfo, logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';
import { getIndexState, setIndexState } from '../state/index_state.js';
import { getWatchState, updateWatchState, type WatchCursor, type WatchStateConfig } from '../state/watch_state.js';
import { computeFileChecksum } from '../utils/checksums.js';
import { getCurrentGitSha, getGitDiffNames, getGitStatusChanges } from '../utils/git.js';
import {
  globalEventBus,
  createFileModifiedEvent,
  createFileDeletedEvent,
  createEntityDeletedEvent,
  createUnderstandingInvalidatedEvent,
  createContextPacksInvalidatedEvent,
} from '../events.js';

export interface FileWatcherOptions {
  debounceMs?: number;
  /** Batch file events for a single reindex pass (default: 200ms) */
  batchWindowMs?: number;
  /** Max queued events per batch window before catch-up (default: 200) */
  stormThreshold?: number;
  workspaceRoot: string;
  librarian: Librarian;
  storage?: LibrarianStorage;
  watch?: (root: string, options: fs.WatchOptions & { recursive: boolean }, listener: (event: string, filename: string | Buffer) => void) => fs.FSWatcher;
  /** Enable lazy cascade re-indexing of dependent files */
  cascadeReindex?: boolean;
  /** Delay between cascade reindex operations in ms (default: 2000) */
  cascadeDelayMs?: number;
  /** Max cascade reindex operations per batch (default: 5) */
  cascadeBatchSize?: number;
}

export interface FileWatcherHandle {
  stop(): void | Promise<void>;
  attachStorage?(storage: LibrarianStorage): void;
}

const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_BATCH_WINDOW_MS = 0;
const DEFAULT_STORM_THRESHOLD = 200;
const DEFAULT_CASCADE_DELAY_MS = 2000;
const DEFAULT_CASCADE_BATCH_SIZE = 5;
const MAX_CASCADE_DEPENDENTS = 50; // Limit cascade to prevent runaway graph traversal
const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONCILE_BATCH_SIZE = 50;
const WATCH_EXCLUDES = ['.librarian/', 'state/audits/'];
const watchers = new Map<string, FileWatcherHandle>();

/**
 * Background queue for lazy cascade re-indexing of dependent files.
 * Rate-limited and deduplicated to avoid overwhelming the LLM provider.
 */
const MAX_RETRY_COUNT = 3;

interface QueueItem {
  filePath: string;
  retryCount: number;
}

class CascadeReindexQueue {
  private queue = new Map<string, QueueItem>();
  private processing = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly librarian: Librarian,
    private readonly delayMs: number,
    private readonly batchSize: number,
  ) {}

  /** Add files to the cascade queue (deduplicated) */
  enqueue(filePaths: string[]): void {
    if (this.stopped) return;
    for (const filePath of filePaths) {
      if (!this.queue.has(filePath)) {
        this.queue.set(filePath, { filePath, retryCount: 0 });
      }
    }
    this.scheduleProcessing();
  }

  /**
   * Stop the queue.
   * @param options.flush - If true, process all remaining items before stopping (graceful shutdown)
   */
  async stop(options?: { flush?: boolean }): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    try {
      if (options?.flush && (this.queue.size > 0 || this.processing)) {
        logInfo('[librarian] Flushing cascade queue before stop', {
          remaining: this.queue.size,
          processing: this.processing,
        });
        // First wait for any in-progress batch to complete
        while (this.processing) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        // Then process all remaining items
        while (this.queue.size > 0) {
          await this.processBatch();
        }
      } else if (this.queue.size > 0) {
        logWarning('[librarian] Discarding cascade queue items on stop', { discarded: this.queue.size });
      }
    } finally {
      // Always set stopped and clear queue, even if flush fails
      this.stopped = true;
      this.queue.clear();
    }
  }

  /** Get current queue size */
  get size(): number {
    return this.queue.size;
  }

  private scheduleProcessing(): void {
    if (this.processing || this.timer || this.queue.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processBatch();
    }, this.delayMs);
  }

  private async processBatch(): Promise<void> {
    if (this.stopped || this.queue.size === 0) return;
    this.processing = true;

    const batch: QueueItem[] = [];
    try {
      // Take up to batchSize items from the queue
      for (const item of this.queue.values()) {
        if (batch.length >= this.batchSize) break;
        batch.push(item);
      }

      // Remove from queue before processing
      for (const item of batch) {
        this.queue.delete(item.filePath);
      }

      if (batch.length > 0) {
        const filePaths = batch.map(item => item.filePath);
        logInfo('[librarian] Cascade reindex starting', {
          files: batch.length,
          remaining: this.queue.size
        });

        try {
          // Reindex the batch - reindexFiles handles multiple files
          await this.librarian.reindexFiles(filePaths);
          logInfo('[librarian] Cascade reindex completed', { files: batch.length });
        } catch (error) {
          logWarning('[librarian] Cascade reindex failed', {
            files: batch.length,
            error: error instanceof Error ? error.message : String(error),
          });
          // Re-queue failed items for retry (if not stopped and under retry limit)
          if (!this.stopped) {
            for (const item of batch) {
              if (item.retryCount < MAX_RETRY_COUNT) {
                this.queue.set(item.filePath, {
                  filePath: item.filePath,
                  retryCount: item.retryCount + 1,
                });
              } else {
                logWarning('[librarian] Cascade reindex max retries exceeded', {
                  filePath: item.filePath,
                  retries: item.retryCount,
                });
              }
            }
          }
        }
      }
    } finally {
      this.processing = false;
      // Schedule next batch if there are more items
      if (this.queue.size > 0 && !this.stopped) {
        this.scheduleProcessing();
      }
    }
  }
}

export function startFileWatcher(options: FileWatcherOptions): FileWatcherHandle {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const existing = watchers.get(workspaceRoot);
  if (existing) {
    if (options.storage && typeof existing.attachStorage === 'function') {
      existing.attachStorage(options.storage);
    }
    return existing;
  }

  const watcher = new IncrementalFileWatcher({ ...options, workspaceRoot });
  watcher.start();
  watchers.set(workspaceRoot, watcher);
  return watcher;
}

export async function stopFileWatcher(workspaceRoot: string): Promise<void> {
  const watcher = watchers.get(path.resolve(workspaceRoot));
  if (!watcher) return;
  await watcher.stop();
  watchers.delete(path.resolve(workspaceRoot));
}

class IncrementalFileWatcher implements FileWatcherHandle {
  private pending = new Map<string, NodeJS.Timeout>();
  private watcher: fs.FSWatcher | null = null;
  private readonly debounceMs: number;
  private readonly batchWindowMs: number;
  private readonly stormThreshold: number;
  private readonly warningOnceKeys = new Set<string>();
  private reconcileDisabled = false;
  private cascadeDisabled = false;
  private batchQueue = new Set<string>();
  private batchTimer: NodeJS.Timeout | null = null;
  private batchEventCount = 0;
  private stormActive = false;
  private readonly workspaceRoot: string;
  private readonly librarian: Librarian;
  private storage?: LibrarianStorage;
  private readonly watchImpl: FileWatcherOptions['watch'];
  private readonly cascadeEnabled: boolean;
  private readonly cascadeQueue: CascadeReindexQueue | null;
  private heartbeat: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly watchConfig: WatchStateConfig;

  constructor(options: FileWatcherOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.librarian = options.librarian;
    this.storage = options.storage;
    this.debounceMs = Math.max(50, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.batchWindowMs = Math.max(0, options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS);
    this.stormThreshold = Math.max(1, options.stormThreshold ?? DEFAULT_STORM_THRESHOLD);
    this.watchImpl = options.watch;
    this.cascadeEnabled = options.cascadeReindex ?? true; // Default enabled
    this.cascadeQueue = this.cascadeEnabled
      ? new CascadeReindexQueue(
          this.librarian,
          options.cascadeDelayMs ?? DEFAULT_CASCADE_DELAY_MS,
          options.cascadeBatchSize ?? DEFAULT_CASCADE_BATCH_SIZE,
        )
      : null;
    this.watchConfig = {
      debounceMs: this.debounceMs,
      batchWindowMs: this.batchWindowMs,
      stormThreshold: this.stormThreshold,
      cascadeReindex: this.cascadeEnabled,
      cascadeDelayMs: options.cascadeDelayMs ?? DEFAULT_CASCADE_DELAY_MS,
      cascadeBatchSize: options.cascadeBatchSize ?? DEFAULT_CASCADE_BATCH_SIZE,
      excludes: [...WATCH_EXCLUDES],
    };
  }

  private warnOnce(key: string, message: string, meta: Record<string, unknown>): void {
    if (this.warningOnceKeys.has(key)) return;
    this.warningOnceKeys.add(key);
    logWarning(message, meta);
  }

  start(): void {
    if (this.watcher) return;
    const watch = this.watchImpl ?? fs.watch;
    this.watcher = watch(this.workspaceRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const relativePath = normalizePath(filename);
      if (!this.shouldProcess(relativePath)) return;
      this.schedule(relativePath);
    });
    this.startHeartbeat();
    logInfo('[librarian] File watcher started', { workspaceRoot: this.workspaceRoot, debounceMs: this.debounceMs });
    void this.markIncremental();
    void this.updateWatchStarted();
    void this.reconcileWorkspace();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.batchQueue.clear();
    this.batchEventCount = 0;
    for (const timeout of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
    // Graceful shutdown: flush remaining cascade items
    const queueSize = this.cascadeQueue?.size ?? 0;
    await this.cascadeQueue?.stop({ flush: true });
    logInfo('[librarian] File watcher stopped', {
      workspaceRoot: this.workspaceRoot,
      cascadeQueueSize: queueSize,
    });
    await this.updateWatchStopped();
  }

  private schedule(relativePath: string): void {
    const existing = this.pending.get(relativePath);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => {
      this.pending.delete(relativePath);
      if (this.batchWindowMs > 0) {
        this.queueBatch(relativePath);
      } else {
        this.handleChange(relativePath).catch((error) => {
          logWarning('[librarian] File watcher reindex failed', {
            filePath: relativePath,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }, this.debounceMs);
    this.pending.set(relativePath, timeout);
  }

  private async handleChange(relativePath: string): Promise<void> {
    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    const exists = fs.existsSync(absolutePath);
    if (!exists) {
      await this.handleDeletion(absolutePath);
      return;
    }
    try {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) return;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logWarning('[librarian] Failed to stat file for reindex', { filePath: absolutePath, error: message });
      return;
    }

    if (await this.isUnchanged(absolutePath)) {
      return;
    }

    void globalEventBus.emit(createFileModifiedEvent(absolutePath, 'watcher'));
    await this.updateWatchEvent();
    await this.librarian.reindexFiles([absolutePath]);
    await this.updateWatchReindexOk();

    // Lazy cascade: find and queue dependent files for background reindexing
    if (this.cascadeQueue && this.storage) {
      await this.queueDependentsForCascade(absolutePath);
    }
  }

  private queueBatch(relativePath: string): void {
    if (this.stopped || this.stormActive) return;
    this.batchQueue.add(relativePath);
    this.batchEventCount += 1;

    if (this.stormThreshold > 0 && this.batchEventCount >= this.stormThreshold) {
      logWarning('[librarian] Watch event storm detected', {
        workspaceRoot: this.workspaceRoot,
        queued: this.batchEventCount,
      });
      void this.handleStorm();
      return;
    }

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        void this.flushBatch();
      }, this.batchWindowMs);
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.stopped || this.batchQueue.size === 0) return;
    const batch = Array.from(this.batchQueue);
    this.batchQueue.clear();
    this.batchEventCount = 0;

    const deletions: string[] = [];
    const toReindex: string[] = [];

    for (const relativePath of batch) {
      const absolutePath = path.resolve(this.workspaceRoot, relativePath);
      const exists = fs.existsSync(absolutePath);
      if (!exists) {
        deletions.push(absolutePath);
        continue;
      }
      try {
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) continue;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        logWarning('[librarian] Failed to stat file for reindex', { filePath: absolutePath, error: message });
        continue;
      }

      if (await this.isUnchanged(absolutePath)) {
        continue;
      }
      toReindex.push(absolutePath);
    }

    for (const filePath of deletions) {
      await this.handleDeletion(filePath);
    }

    if (toReindex.length === 0) return;

    for (const filePath of toReindex) {
      void globalEventBus.emit(createFileModifiedEvent(filePath, 'watcher'));
    }
    await this.updateWatchEvent();
    try {
      await this.librarian.reindexFiles(toReindex);
      await this.updateWatchReindexOk();
    } catch (error) {
      logWarning('[librarian] Batch reindex failed', {
        files: toReindex.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (this.cascadeQueue && this.storage) {
      for (const filePath of toReindex) {
        await this.queueDependentsForCascade(filePath);
      }
    }
  }

  private async handleStorm(): Promise<void> {
    if (this.stormActive) return;
    this.stormActive = true;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.batchQueue.clear();
    this.batchEventCount = 0;
    await this.updateWatchStorm();
    await this.reconcileWorkspace();
    this.stormActive = false;
  }

  /**
   * Find files that depend on the changed file and queue them for cascade reindex.
   * Uses the import graph to find dependents.
   */
  private async queueDependentsForCascade(changedFilePath: string): Promise<void> {
    if (!this.storage || !this.cascadeQueue) return;
    if (this.cascadeDisabled) return;

    const storageAny = this.storage as unknown as Record<string, unknown>;
    const missing: string[] = [];
    if (typeof storageAny.getModuleByPath !== 'function') missing.push('getModuleByPath');
    if (typeof storageAny.getGraphEdges !== 'function') missing.push('getGraphEdges');
    if (typeof storageAny.getModule !== 'function') missing.push('getModule');
    if (missing.length > 0) {
      this.cascadeDisabled = true;
      this.warnOnce('cascade_storage_missing_graph_apis', '[librarian] Cascade reindex disabled', {
        workspaceRoot: this.workspaceRoot,
        reason: 'storage_missing_graph_apis',
        missing,
      });
      return;
    }

    try {
      // Get the module record for the changed file
      const moduleRecord = await this.storage.getModuleByPath(changedFilePath);
      if (!moduleRecord) {
        // File might not be a module (e.g., test file, config file)
        return;
      }

      // Find all modules that import this module
      const edges = await this.storage.getGraphEdges({
        edgeTypes: ['imports'],
        toIds: [moduleRecord.id],
        fromTypes: ['module'],
      });

      if (edges.length === 0) {
        return;
      }

      // Limit cascade to prevent runaway graph traversal
      const edgesToProcess = edges.slice(0, MAX_CASCADE_DEPENDENTS);
      if (edges.length > MAX_CASCADE_DEPENDENTS) {
        logWarning('[librarian] Cascade limited due to high dependent count', {
          changedFile: changedFilePath,
          totalDependents: edges.length,
          limited: MAX_CASCADE_DEPENDENTS,
        });
      }

      // Fetch only the specific dependent modules by ID (O(k) instead of O(n))
      const dependentPaths: string[] = [];
      for (const edge of edgesToProcess) {
        const dependent = await this.storage.getModule(edge.fromId);
        if (dependent) {
          const dependentAbsPath = path.resolve(dependent.path);
          // Don't queue the file that just changed
          if (dependentAbsPath !== changedFilePath) {
            dependentPaths.push(dependentAbsPath);
          }
        }
      }

      if (dependentPaths.length > 0) {
        logInfo('[librarian] Queueing cascade reindex for dependents', {
          changedFile: changedFilePath,
          dependents: dependentPaths.length,
        });
        this.cascadeQueue.enqueue(dependentPaths);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('storage_slice_missing_method') || message.includes('is not a function')) {
        this.cascadeDisabled = true;
        this.warnOnce('cascade_storage_capability_mismatch', '[librarian] Cascade reindex disabled', {
          workspaceRoot: this.workspaceRoot,
          reason: 'storage_capability_mismatch',
          error: message,
        });
        return;
      }
      logWarning('[librarian] Failed to queue cascade reindex', {
        filePath: changedFilePath,
        error: message,
      });
    }
  }

  private async markIncremental(): Promise<void> {
    if (!this.storage) return;
    try {
      const state = await getIndexState(this.storage);
      if (state.phase !== 'incremental') {
        await setIndexState(this.storage, { ...state, phase: 'incremental' });
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logWarning('[librarian] Failed to update index state', { error: message });
    }
  }

  private async reconcileWorkspace(): Promise<void> {
    if (!this.storage) return;
    if (this.reconcileDisabled) return;
    const storageAny = this.storage as unknown as Record<string, unknown>;
    if (typeof storageAny.getFiles !== 'function') {
      this.reconcileDisabled = true;
      // Storage is attached but does not support workspace reconciliation. This should not
      // spam logs; warn once and keep watcher functional for event-driven reindexing.
      try {
        await updateWatchState(this.storage, (prev) => ({
          schema_version: 1,
          workspace_root: this.workspaceRoot,
          watch_started_at: prev?.watch_started_at,
          watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
          watch_last_event_at: prev?.watch_last_event_at,
          watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
          suspected_dead: false,
          needs_catchup: true,
          storage_attached: true,
          effective_config: this.watchConfig,
          cursor: prev?.cursor,
          last_error: 'storage_missing_getFiles',
        }));
      } catch {
        // Ignore: state updates are best-effort in degraded storage scenarios.
      }
      this.warnOnce('watch_reconcile_storage_missing_getFiles', '[librarian] Watch reconcile disabled', {
        workspaceRoot: this.workspaceRoot,
        reason: 'storage_missing_getFiles',
        hint: 'Attach a full LibrarianStorage implementation to enable reconcile/catch-up.',
      });
      return;
    }
    const startedAt = Date.now();
    try {
      const previousWatchState = await getWatchState(this.storage);
      const previousCursor = previousWatchState?.cursor?.kind === 'git' ? previousWatchState.cursor : null;
      const gitCursorSha = previousCursor?.lastIndexedCommitSha;

      if (gitCursorSha) {
        const gitChanges = await getGitDiffNames(this.workspaceRoot, gitCursorSha);
        const statusChanges = await getGitStatusChanges(this.workspaceRoot);
        if (gitChanges || statusChanges) {
          const added = new Set<string>();
          const modified = new Set<string>();
          const deleted = new Set<string>();

          const mergeChanges = (changes: { added: string[]; modified: string[]; deleted: string[] } | null) => {
            if (!changes) return;
            for (const entry of changes.added) added.add(entry);
            for (const entry of changes.modified) modified.add(entry);
            for (const entry of changes.deleted) deleted.add(entry);
          };

          mergeChanges(gitChanges);
          mergeChanges(statusChanges);

          const deletions: string[] = [];
          const toReindex: string[] = [];

          for (const relativePath of deleted) {
            if (!this.shouldProcess(relativePath)) continue;
            deletions.push(path.resolve(this.workspaceRoot, relativePath));
          }

          for (const relativePath of [...added, ...modified]) {
            if (!this.shouldProcess(relativePath)) continue;
            toReindex.push(path.resolve(this.workspaceRoot, relativePath));
          }

          for (const filePath of deletions) {
            await this.handleDeletion(filePath);
          }
          for (let i = 0; i < toReindex.length; i += RECONCILE_BATCH_SIZE) {
            const batch = toReindex.slice(i, i + RECONCILE_BATCH_SIZE);
            if (batch.length === 0) continue;
            await this.librarian.reindexFiles(batch);
            await this.updateWatchReindexOk();
          }

          const currentSha = await getCurrentGitSha(this.workspaceRoot);
          const cursor = currentSha
            ? { kind: 'git' as const, lastIndexedCommitSha: currentSha }
            : { kind: 'fs' as const, lastReconcileCompletedAt: new Date().toISOString() };

          await updateWatchState(this.storage, (prev) => ({
            schema_version: 1,
            workspace_root: this.workspaceRoot,
            watch_started_at: prev?.watch_started_at,
            watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
            watch_last_event_at: prev?.watch_last_event_at,
            watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
            suspected_dead: false,
            needs_catchup: false,
            storage_attached: true,
            effective_config: this.watchConfig,
            cursor,
            last_error: prev?.last_error,
          }));
          logInfo('[librarian] Watch reconcile completed (git)', {
            workspaceRoot: this.workspaceRoot,
            added: added.size,
            changed: modified.size,
            deleted: deleted.size,
            durationMs: Date.now() - startedAt,
          });
          return;
        }
      }

      const includePatterns = getAllIncludePatterns();
      const matches = await glob(includePatterns, {
        cwd: this.workspaceRoot,
        nodir: true,
        absolute: true,
        ignore: EXCLUDE_PATTERNS,
      });
      const filteredMatches = matches.filter((filePath) => !isWatchExcluded(filePath));
      const currentFiles = new Set(filteredMatches.map((filePath) => path.resolve(filePath)));

      const storedFiles = await this.storage.getFiles();

      const deleted: string[] = [];
      const changed: string[] = [];
      const seen = new Set<string>();

      for (const file of storedFiles) {
        const resolved = path.resolve(file.path);
        seen.add(resolved);
        if (!currentFiles.has(resolved)) {
          deleted.push(resolved);
          continue;
        }
        try {
          const stat = fs.statSync(resolved);
          const mtimeMs = stat.mtimeMs;
          const lastModified = Date.parse(file.lastModified);
          if (Number.isFinite(lastModified) && mtimeMs > lastModified) {
            changed.push(resolved);
          }
        } catch (error) {
          logWarning('[librarian] Watch reconcile stat failed', {
            filePath: resolved,
            error: getErrorMessage(error),
          });
        }
      }

      const added = filteredMatches
        .map((filePath) => path.resolve(filePath))
        .filter((filePath) => !seen.has(filePath));

      for (const filePath of deleted) {
        await this.handleDeletion(filePath);
      }

      const toReindex = [...added, ...changed];
      for (let i = 0; i < toReindex.length; i += RECONCILE_BATCH_SIZE) {
        const batch = toReindex.slice(i, i + RECONCILE_BATCH_SIZE);
        if (batch.length === 0) continue;
        await this.librarian.reindexFiles(batch);
        await this.updateWatchReindexOk();
      }

      const currentSha = await getCurrentGitSha(this.workspaceRoot);
      const cursor = currentSha
        ? { kind: 'git' as const, lastIndexedCommitSha: currentSha }
        : { kind: 'fs' as const, lastReconcileCompletedAt: new Date().toISOString() };

      await updateWatchState(this.storage, (prev) => ({
        schema_version: 1,
        workspace_root: this.workspaceRoot,
        watch_started_at: prev?.watch_started_at,
        watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
        watch_last_event_at: prev?.watch_last_event_at,
        watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
        suspected_dead: false,
        needs_catchup: false,
        storage_attached: true,
        effective_config: this.watchConfig,
        cursor,
        last_error: prev?.last_error,
      }));
      logInfo('[librarian] Watch reconcile completed', {
        workspaceRoot: this.workspaceRoot,
        added: added.length,
        changed: changed.length,
        deleted: deleted.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      await updateWatchState(this.storage, (prev) => ({
        schema_version: 1,
        workspace_root: this.workspaceRoot,
        watch_started_at: prev?.watch_started_at,
        watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
        watch_last_event_at: prev?.watch_last_event_at,
        watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
        suspected_dead: true,
        needs_catchup: true,
        storage_attached: true,
        effective_config: this.watchConfig,
        cursor: prev?.cursor,
        last_error: message,
      }));
      if (message.includes('storage_slice_missing_method') || message.includes('is not a function')) {
        this.reconcileDisabled = true;
        this.warnOnce('watch_reconcile_storage_capability_mismatch', '[librarian] Watch reconcile disabled', {
          workspaceRoot: this.workspaceRoot,
          reason: 'storage_capability_mismatch',
          error: message,
        });
        return;
      }
      logWarning('[librarian] Watch reconcile failed', { workspaceRoot: this.workspaceRoot, error: message });
    }
  }

  attachStorage(storage: LibrarianStorage): void {
    this.storage = storage;
    this.reconcileDisabled = false;
    this.cascadeDisabled = false;
    void this.updateWatchStorageAttached();
    this.startHeartbeat();
    void this.reconcileWorkspace();
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    if (!this.storage) return;
    this.heartbeat = setInterval(() => {
      void this.updateWatchHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async updateWatchStarted(): Promise<void> {
    if (!this.storage) return;
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: new Date().toISOString(),
      watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
      watch_last_event_at: prev?.watch_last_event_at,
      watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
      suspected_dead: false,
      needs_catchup: true,
      storage_attached: true,
      effective_config: this.watchConfig,
      cursor: prev?.cursor,
      last_error: prev?.last_error,
    }));
  }

  private async updateWatchStopped(): Promise<void> {
    if (!this.storage) return;
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: prev?.watch_started_at,
      watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
      watch_last_event_at: prev?.watch_last_event_at,
      watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
      suspected_dead: true,
      needs_catchup: true,
      storage_attached: Boolean(prev?.storage_attached),
      effective_config: this.watchConfig,
      cursor: prev?.cursor,
      last_error: prev?.last_error,
    }));
  }

  private async updateWatchHeartbeat(): Promise<void> {
    if (!this.storage) return;
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: prev?.watch_started_at,
      watch_last_heartbeat_at: new Date().toISOString(),
      watch_last_event_at: prev?.watch_last_event_at,
      watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
      suspected_dead: false,
      needs_catchup: Boolean(prev?.needs_catchup),
      storage_attached: true,
      effective_config: this.watchConfig,
      cursor: prev?.cursor,
      last_error: prev?.last_error,
    }));
  }

  private async updateWatchEvent(): Promise<void> {
    if (!this.storage) return;
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: prev?.watch_started_at,
      watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
      watch_last_event_at: new Date().toISOString(),
      watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
      suspected_dead: false,
      needs_catchup: Boolean(prev?.needs_catchup),
      storage_attached: true,
      effective_config: this.watchConfig,
      cursor: prev?.cursor,
      last_error: prev?.last_error,
    }));
  }

  private async updateWatchReindexOk(): Promise<void> {
    if (!this.storage) return;
    const cursor = await this.resolveCursor();
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: prev?.watch_started_at,
      watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
      watch_last_event_at: prev?.watch_last_event_at,
      watch_last_reindex_ok_at: new Date().toISOString(),
      suspected_dead: false,
      needs_catchup: Boolean(prev?.needs_catchup),
      storage_attached: true,
      effective_config: this.watchConfig,
      cursor: cursor ?? prev?.cursor,
      last_error: prev?.last_error,
    }));
  }

  private async updateWatchStorm(): Promise<void> {
    if (!this.storage) return;
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: prev?.watch_started_at,
      watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
      watch_last_event_at: new Date().toISOString(),
      watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
      suspected_dead: false,
      needs_catchup: true,
      storage_attached: true,
      effective_config: this.watchConfig,
      cursor: prev?.cursor,
      last_error: 'watch_event_storm',
    }));
  }

  private async resolveCursor(): Promise<WatchCursor | null> {
    const currentSha = await getCurrentGitSha(this.workspaceRoot);
    if (currentSha) {
      return { kind: 'git', lastIndexedCommitSha: currentSha };
    }
    return null;
  }

  private async updateWatchStorageAttached(): Promise<void> {
    if (!this.storage) return;
    await updateWatchState(this.storage, (prev) => ({
      schema_version: 1,
      workspace_root: this.workspaceRoot,
      watch_started_at: prev?.watch_started_at,
      watch_last_heartbeat_at: prev?.watch_last_heartbeat_at,
      watch_last_event_at: prev?.watch_last_event_at,
      watch_last_reindex_ok_at: prev?.watch_last_reindex_ok_at,
      suspected_dead: Boolean(prev?.suspected_dead),
      needs_catchup: Boolean(prev?.needs_catchup),
      storage_attached: true,
      effective_config: this.watchConfig,
      cursor: prev?.cursor,
      last_error: prev?.last_error,
    }));
  }

  private async handleDeletion(absolutePath: string): Promise<void> {
    if (!this.storage) return;
    try {
      const fileRecord = await this.storage.getFileByPath(absolutePath);
      const functions = await this.storage.getFunctionsByPath(absolutePath);
      const moduleRecord = await this.storage.getModuleByPath(absolutePath);
      const knowledgeRecords = await this.storage.getUniversalKnowledgeByFile(absolutePath);

      if (fileRecord) {
        void globalEventBus.emit(createEntityDeletedEvent('file', fileRecord.id, absolutePath));
      }
      for (const fn of functions) {
        void globalEventBus.emit(createEntityDeletedEvent('function', fn.id, fn.filePath));
      }
      if (moduleRecord) {
        void globalEventBus.emit(createEntityDeletedEvent('module', moduleRecord.id, moduleRecord.path));
      }
      for (const record of knowledgeRecords) {
        void globalEventBus.emit(createUnderstandingInvalidatedEvent(record.id, record.kind, 'file_deleted'));
      }

      await this.storage.deleteFileChecksum(absolutePath);
      await this.storage.deleteFileByPath(absolutePath);
      await this.storage.deleteUniversalKnowledgeByFile(absolutePath);
      await this.storage.deleteFunctionsByPath(absolutePath);
      await this.storage.deleteGraphEdgesForSource(absolutePath);
      const invalidated = await this.storage.invalidateContextPacks(absolutePath);
      if (invalidated > 0) {
        void globalEventBus.emit(createContextPacksInvalidatedEvent(absolutePath, invalidated));
      }
      const modules = await this.storage.getModules();
      const moduleToDelete = modules.find((item) => path.resolve(item.path) === absolutePath);
      if (moduleToDelete) {
        await this.storage.deleteModule(moduleToDelete.id);
      }
      void globalEventBus.emit(createFileDeletedEvent(absolutePath));
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logWarning('[librarian] File deletion cleanup failed', { filePath: absolutePath, error: message });
    }
  }

  private async isUnchanged(absolutePath: string): Promise<boolean> {
    if (!this.storage) return false;
    try {
      const content = await fs.promises.readFile(absolutePath, 'utf8');
      const checksum = computeFileChecksum(content);
      const existing = await this.storage.getFileChecksum(absolutePath);
      return Boolean(existing && existing === checksum);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logWarning('[librarian] Failed to compute checksum', { filePath: absolutePath, error: message });
      return false;
    }
  }

  private shouldProcess(relativePath: string): boolean {
    if (!relativePath) return false;
    if (isExcluded(relativePath)) return false;
    if (isWatchExcluded(relativePath)) return false;
    const category = getFileCategory(relativePath);
    return category !== 'unknown';
  }
}

function normalizePath(value: string | Buffer): string {
  const raw = typeof value === 'string' ? value : value.toString('utf8');
  return raw.replace(/\\/g, '/');
}

function isWatchExcluded(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return WATCH_EXCLUDES.some((fragment) => normalized.includes(fragment));
}
