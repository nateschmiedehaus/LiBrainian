/**
 * @fileoverview File Watcher Integration with Evidence Ledger
 *
 * WU-STALE-001: Provides real-time file change notifications using native FS events
 * with integration to the Evidence Ledger for staleness tracking.
 *
 * Features:
 * - Uses native file system events (FSEvents on macOS, inotify on Linux)
 * - Real-time file change notifications
 * - Pattern-based filtering with glob patterns
 * - Debouncing of rapid changes
 * - Target: < 5s detection latency
 * - Evidence Ledger integration for staleness marking
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';
import type { IEvidenceLedger, EvidenceEntry, ToolCallEvidence } from '../epistemics/evidence_ledger.js';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Represents a file system change event.
 */
export interface FileChangeEvent {
  /** Type of change */
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  /** Absolute path to the changed file */
  path: string;
  /** Previous path for rename events */
  oldPath?: string;
  /** Timestamp of the event */
  timestamp: Date;
  /** File stats when available */
  stats?: {
    /** File size in bytes */
    size: number;
    /** Last modification time */
    mtime: Date;
  };
}

/**
 * Configuration for the file watcher.
 */
export interface WatcherConfig {
  /** Root directory to watch */
  rootPath: string;
  /** Glob patterns to include (e.g., ['**\/*.ts', '**\/*.tsx']) */
  patterns?: string[];
  /** Glob patterns to exclude (e.g., ['**/node_modules/**']) */
  ignorePatterns?: string[];
  /** Debounce time for rapid changes to same file (default: 100ms) */
  debounceMs?: number;
  /** Watch recursively (default: true) */
  recursive?: boolean;
}

/**
 * Statistics about the file watcher.
 */
export interface WatcherStats {
  /** Total number of raw events received from the OS */
  eventsReceived: number;
  /** Estimated number of files being watched */
  filesWatched: number;
  /** Average latency from file change to handler notification (ms) */
  avgLatencyMs: number;
  /** Number of errors encountered */
  errors: number;
}

/**
 * Handler function for file change events.
 */
export type FileChangeHandler = (event: FileChangeEvent) => void | Promise<void>;

/**
 * Options for creating a FileWatcher.
 */
export interface FileWatcherOptions {
  /** Evidence ledger for staleness tracking */
  evidenceLedger?: IEvidenceLedger | {
    markStale: (path: string) => void;
    append: (entry: Omit<EvidenceEntry, 'id' | 'timestamp'>) => Promise<EvidenceEntry>;
  };
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface PendingChange {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
  timestamp: Date;
  timeout: NodeJS.Timeout;
}

interface LatencyMeasurement {
  startTime: number;
  endTime: number;
}

// ============================================================================
// FILE WATCHER CLASS
// ============================================================================

/**
 * File watcher that provides real-time file change notifications.
 *
 * Uses native file system events (FSEvents on macOS, inotify on Linux)
 * to detect file changes with low latency (target: < 5s).
 *
 * Integrates with the Evidence Ledger to mark affected knowledge as
 * potentially stale when files change.
 *
 * @example
 * ```typescript
 * const watcher = new FileWatcher();
 *
 * // Subscribe to changes
 * watcher.onFileChange((event) => {
 *   console.log(`${event.type}: ${event.path}`);
 * });
 *
 * // Start watching
 * await watcher.start({
 *   rootPath: '/path/to/project',
 *   patterns: ['**' + '/*.ts'],
 *   ignorePatterns: ['**' + '/node_modules/**'],
 *   debounceMs: 100
 * });
 *
 * // Later, stop watching
 * await watcher.stop();
 * ```
 */
export class FileWatcher {
  private fsWatcher: fs.FSWatcher | null = null;
  private handlers: Set<FileChangeHandler> = new Set();
  private config: WatcherConfig | null = null;
  private pendingChanges: Map<string, PendingChange> = new Map();
  private stats: WatcherStats = {
    eventsReceived: 0,
    filesWatched: 0,
    avgLatencyMs: 0,
    errors: 0,
  };
  private latencyMeasurements: LatencyMeasurement[] = [];
  private existingFiles: Set<string> = new Set();
  private evidenceLedger?: FileWatcherOptions['evidenceLedger'];

  constructor(options?: FileWatcherOptions) {
    this.evidenceLedger = options?.evidenceLedger;
  }

  /**
   * Start watching for file changes.
   *
   * @param config - Watcher configuration
   * @throws Error if already watching or root path doesn't exist
   */
  async start(config: WatcherConfig): Promise<void> {
    if (this.fsWatcher) {
      throw new Error('FileWatcher is already watching. Call stop() first.');
    }

    // Validate root path exists
    const rootPath = path.resolve(config.rootPath);
    try {
      const stat = await fs.promises.stat(rootPath);
      if (!stat.isDirectory()) {
        throw new Error(`Root path is not a directory: ${rootPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Root path does not exist: ${rootPath}`);
      }
      throw error;
    }

    this.config = {
      ...config,
      rootPath,
      debounceMs: config.debounceMs ?? 100,
      recursive: config.recursive ?? true,
    };

    // Build initial file set for detecting creates vs modifies
    await this.scanExistingFiles(rootPath);

    // Start native watcher
    this.fsWatcher = fs.watch(
      rootPath,
      {
        recursive: this.config.recursive,
        persistent: true,
      },
      (eventType, filename) => {
        this.handleFsEvent(eventType, filename);
      }
    );

    this.fsWatcher.on('error', (error) => {
      this.stats.errors++;
      logError('[FileWatcher] Watcher error', { error: getErrorMessage(error) });
    });

    logInfo('[FileWatcher] Started watching', {
      rootPath: this.config.rootPath,
      recursive: this.config.recursive,
      debounceMs: this.config.debounceMs,
    });
  }

  /**
   * Stop watching for file changes.
   */
  async stop(): Promise<void> {
    // Clear pending debounced changes
    for (const pending of this.pendingChanges.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingChanges.clear();

    // Close the watcher
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }

    // Clear state
    this.config = null;
    this.existingFiles.clear();

    logInfo('[FileWatcher] Stopped watching');
  }

  /**
   * Register a handler for file change events.
   *
   * @param handler - Function to call when a file changes
   * @returns Unsubscribe function
   */
  onFileChange(handler: FileChangeHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Get current watcher statistics.
   */
  getStats(): WatcherStats {
    return { ...this.stats };
  }

  /**
   * Check if the watcher is currently active.
   */
  isWatching(): boolean {
    return this.fsWatcher !== null;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Scan existing files to differentiate creates from modifies.
   */
  private async scanExistingFiles(rootPath: string): Promise<void> {
    this.existingFiles.clear();
    try {
      await this.walkDirectory(rootPath, (filePath) => {
        this.existingFiles.add(filePath);
        this.stats.filesWatched++;
      });
    } catch (error) {
      logWarning('[FileWatcher] Error scanning existing files', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Recursively walk a directory.
   */
  private async walkDirectory(
    dir: string,
    callback: (filePath: string) => void
  ): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (this.shouldIgnore(fullPath)) continue;
        await this.walkDirectory(fullPath, callback);
      } else if (entry.isFile()) {
        if (!this.shouldIgnore(fullPath) && this.matchesPatterns(fullPath)) {
          callback(fullPath);
        }
      }
    }
  }

  /**
   * Handle raw fs.watch event.
   */
  private handleFsEvent(eventType: string, filename: string | Buffer | null): void {
    if (!filename || !this.config) return;

    const startTime = Date.now();
    this.stats.eventsReceived++;

    const relativePath = typeof filename === 'string' ? filename : filename.toString('utf8');
    const absolutePath = path.resolve(this.config.rootPath, relativePath);

    // Check if file matches filters
    if (this.shouldIgnore(absolutePath) || !this.matchesPatterns(absolutePath)) {
      return;
    }

    // Determine event type
    const changeType = this.determineChangeType(absolutePath, eventType);

    // Debounce the change
    this.debounceChange(absolutePath, changeType, startTime);
  }

  /**
   * Determine the type of change that occurred.
   */
  private determineChangeType(
    absolutePath: string,
    fsEventType: string
  ): 'created' | 'modified' | 'deleted' | 'renamed' {
    try {
      const exists = fs.existsSync(absolutePath);

      if (!exists) {
        // File was deleted
        this.existingFiles.delete(absolutePath);
        return 'deleted';
      }

      if (this.existingFiles.has(absolutePath)) {
        // File existed before, so it was modified
        return 'modified';
      }

      // File is new
      this.existingFiles.add(absolutePath);
      this.stats.filesWatched++;
      return 'created';
    } catch {
      // If we can't stat, assume modified
      return 'modified';
    }
  }

  /**
   * Debounce a file change event.
   */
  private debounceChange(
    absolutePath: string,
    changeType: 'created' | 'modified' | 'deleted' | 'renamed',
    startTime: number
  ): void {
    const debounceMs = this.config?.debounceMs ?? 100;

    // Cancel existing pending change for this file
    const existing = this.pendingChanges.get(absolutePath);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    // Schedule new debounced change
    const timeout = setTimeout(() => {
      this.pendingChanges.delete(absolutePath);
      this.emitChange(absolutePath, changeType, startTime);
    }, debounceMs);

    this.pendingChanges.set(absolutePath, {
      type: changeType,
      path: absolutePath,
      timestamp: new Date(),
      timeout,
    });
  }

  /**
   * Emit a file change event to all handlers.
   */
  private async emitChange(
    absolutePath: string,
    changeType: 'created' | 'modified' | 'deleted' | 'renamed',
    startTime: number
  ): Promise<void> {
    const event: FileChangeEvent = {
      type: changeType,
      path: absolutePath,
      timestamp: new Date(),
    };

    // Try to get file stats for non-deleted files
    if (changeType !== 'deleted') {
      try {
        const stat = await fs.promises.stat(absolutePath);
        event.stats = {
          size: stat.size,
          mtime: stat.mtime,
        };
      } catch {
        // Stats not available
      }
    }

    // Record latency
    const endTime = Date.now();
    this.recordLatency(startTime, endTime);

    // Notify evidence ledger of staleness
    await this.notifyEvidenceLedger(event);

    // Notify all handlers
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((error) => {
            logWarning('[FileWatcher] Handler error', {
              error: getErrorMessage(error),
            });
          });
        }
      } catch (error) {
        logWarning('[FileWatcher] Handler error', {
          error: getErrorMessage(error),
        });
      }
    }
  }

  /**
   * Record latency measurement and update average.
   */
  private recordLatency(startTime: number, endTime: number): void {
    this.latencyMeasurements.push({ startTime, endTime });

    // Keep only last 100 measurements
    if (this.latencyMeasurements.length > 100) {
      this.latencyMeasurements.shift();
    }

    // Calculate average latency
    const totalLatency = this.latencyMeasurements.reduce(
      (sum, m) => sum + (m.endTime - m.startTime),
      0
    );
    this.stats.avgLatencyMs = totalLatency / this.latencyMeasurements.length;
  }

  /**
   * Notify the evidence ledger about file staleness.
   */
  private async notifyEvidenceLedger(event: FileChangeEvent): Promise<void> {
    if (!this.evidenceLedger) return;

    try {
      // Mark the file as stale in the ledger
      if ('markStale' in this.evidenceLedger) {
        this.evidenceLedger.markStale(event.path);
      }

      // Append a tool call evidence entry for audit trail
      if ('append' in this.evidenceLedger) {
        const payload: ToolCallEvidence = {
          toolName: 'file_watcher',
          toolVersion: '1.0.0',
          arguments: {
            eventType: event.type,
            path: event.path,
            oldPath: event.oldPath,
          },
          result: {
            staleness: 'marked',
            timestamp: event.timestamp.toISOString(),
          },
          success: true,
          durationMs: 0,
        };

        await this.evidenceLedger.append({
          kind: 'tool_call',
          payload,
          provenance: {
            source: 'system_observation',
            method: 'file_watcher.native_event',
          },
          relatedEntries: [],
        });
      }
    } catch (error) {
      logWarning('[FileWatcher] Failed to notify evidence ledger', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Check if a path should be ignored based on ignore patterns.
   */
  private shouldIgnore(absolutePath: string): boolean {
    if (!this.config?.ignorePatterns?.length) return false;

    const relativePath = path.relative(this.config.rootPath, absolutePath);

    return this.config.ignorePatterns.some((pattern) =>
      minimatch(relativePath, pattern, { dot: true })
    );
  }

  /**
   * Check if a path matches the include patterns.
   */
  private matchesPatterns(absolutePath: string): boolean {
    if (!this.config?.patterns?.length) return true;

    const relativePath = path.relative(this.config.rootPath, absolutePath);

    return this.config.patterns.some((pattern) =>
      minimatch(relativePath, pattern, { dot: true })
    );
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new file watcher instance.
 *
 * @param options - Optional configuration
 * @returns New FileWatcher instance
 */
export function createFileWatcher(options?: FileWatcherOptions): FileWatcher {
  return new FileWatcher(options);
}
