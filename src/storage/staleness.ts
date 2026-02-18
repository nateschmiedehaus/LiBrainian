/**
 * @fileoverview Staleness Tracking for Librarian Index
 *
 * Tracks and reports on index freshness:
 * - Detect stale files (checksum mismatch)
 * - Report overall index freshness
 * - Provide staleness statistics
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LibrarianStorage, FileQueryOptions } from './types.js';
import { computeFileChecksum } from '../utils/checksums.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Staleness status for a single file
 */
export interface FileStaleStatus {
  filePath: string;
  status: 'fresh' | 'stale' | 'missing' | 'new' | 'error';
  storedChecksum?: string;
  currentChecksum?: string;
  lastIndexed?: string;
  reason?: string;
}

/**
 * Overall index staleness statistics
 */
export interface StalenessStats {
  totalFiles: number;
  freshFiles: number;
  staleFiles: number;
  missingFiles: number;
  newFiles: number;
  errorFiles: number;
  freshnessPercent: number;
  lastFullIndex?: Date;
  oldestIndexedFile?: {
    path: string;
    indexedAt: Date;
  };
  computedAt: Date;
}

/**
 * Options for staleness checking
 */
export interface StalenessCheckOptions {
  /** Root directory to scan for files */
  rootDir: string;
  /** File extensions to include (default: all code files) */
  extensions?: string[];
  /** Directories to exclude (default: node_modules, .git, dist) */
  excludeDirs?: string[];
  /** Maximum files to check (for performance) */
  limit?: number;
  /** Whether to compute checksums (slower but accurate) */
  computeChecksums?: boolean;
}

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.m', '.mm',
];

const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', '.git', 'dist', 'build', 'target',
  '.next', '__pycache__', '.pytest_cache', 'coverage',
  '.cache', '.idea', '.vscode',
];

// ============================================================================
// STALENESS TRACKER
// ============================================================================

/**
 * Tracks index staleness and provides freshness APIs.
 *
 * INVARIANT: Staleness checks are read-only
 * INVARIANT: Checksum computation is deterministic
 */
export class StalenessTracker {
  constructor(private storage: LibrarianStorage) {}

  /**
   * Check staleness of a single file.
   */
  async checkFile(filePath: string): Promise<FileStaleStatus> {
    try {
      // Check if file exists on disk
      if (!fs.existsSync(filePath)) {
        const storedChecksum = await this.storage.getFileChecksum(filePath);
        if (storedChecksum) {
          return {
            filePath,
            status: 'missing',
            storedChecksum,
            reason: 'File was indexed but no longer exists on disk',
          };
        }
        return {
          filePath,
          status: 'error',
          reason: 'File does not exist',
        };
      }

      // Get stored checksum
      const storedChecksum = await this.storage.getFileChecksum(filePath);

      if (!storedChecksum) {
        return {
          filePath,
          status: 'new',
          currentChecksum: await this.computeChecksum(filePath),
          reason: 'File exists but has never been indexed',
        };
      }

      // Compute current checksum
      const currentChecksum = await this.computeChecksum(filePath);

      if (currentChecksum === storedChecksum) {
        // Get lastIndexed from file knowledge if available
        const fileKnowledge = await this.storage.getFileByPath(filePath);
        return {
          filePath,
          status: 'fresh',
          storedChecksum,
          currentChecksum,
          lastIndexed: fileKnowledge?.lastIndexed,
        };
      }

      const fileKnowledge = await this.storage.getFileByPath(filePath);
      return {
        filePath,
        status: 'stale',
        storedChecksum,
        currentChecksum,
        lastIndexed: fileKnowledge?.lastIndexed,
        reason: 'Checksum mismatch - file has been modified since last index',
      };
    } catch (error) {
      return {
        filePath,
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check staleness of multiple files.
   */
  async checkFiles(filePaths: string[]): Promise<FileStaleStatus[]> {
    return Promise.all(filePaths.map((fp) => this.checkFile(fp)));
  }

  /**
   * Get stale files from the index.
   * Returns files that have been modified since they were indexed.
   */
  async getStaleFiles(options: StalenessCheckOptions): Promise<FileStaleStatus[]> {
    const { rootDir, extensions = DEFAULT_EXTENSIONS, excludeDirs = DEFAULT_EXCLUDE_DIRS, limit } = options;

    // Get all indexed files
    const indexedFiles = await this.storage.getFiles({
      limit: limit ?? 10000,
    } as FileQueryOptions);

    const staleFiles: FileStaleStatus[] = [];

    for (const file of indexedFiles) {
      const fullPath = path.isAbsolute(file.path) ? file.path : path.join(rootDir, file.path);

      // Skip excluded directories
      if (excludeDirs.some((dir) => fullPath.includes(`/${dir}/`) || fullPath.includes(`\\${dir}\\`))) {
        continue;
      }

      // Check extension
      const ext = path.extname(fullPath);
      if (extensions.length > 0 && !extensions.includes(ext)) {
        continue;
      }

      const status = await this.checkFile(fullPath);
      if (status.status === 'stale' || status.status === 'missing') {
        staleFiles.push(status);
      }

      if (limit && staleFiles.length >= limit) {
        break;
      }
    }

    return staleFiles;
  }

  /**
   * Get new files that exist on disk but haven't been indexed.
   */
  async getNewFiles(options: StalenessCheckOptions): Promise<string[]> {
    const { rootDir, extensions = DEFAULT_EXTENSIONS, excludeDirs = DEFAULT_EXCLUDE_DIRS, limit = 1000 } = options;

    const newFiles: string[] = [];

    const scanDir = async (dir: string): Promise<void> => {
      if (newFiles.length >= limit) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (newFiles.length >= limit) return;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await scanDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            const checksum = await this.storage.getFileChecksum(fullPath);
            if (!checksum) {
              newFiles.push(fullPath);
            }
          }
        }
      }
    };

    await scanDir(rootDir);
    return newFiles;
  }

  /**
   * Get overall staleness statistics for the index.
   */
  async getStats(options: StalenessCheckOptions): Promise<StalenessStats> {
    const { rootDir, extensions = DEFAULT_EXTENSIONS, excludeDirs = DEFAULT_EXCLUDE_DIRS } = options;

    // Get indexed files
    const indexedFiles = await this.storage.getFiles({ limit: 50000 } as FileQueryOptions);

    let totalFiles = 0;
    let freshFiles = 0;
    let staleFiles = 0;
    let missingFiles = 0;
    let errorFiles = 0;
    let oldestIndexedFile: { path: string; indexedAt: Date } | undefined;

    for (const file of indexedFiles) {
      const fullPath = path.isAbsolute(file.path) ? file.path : path.join(rootDir, file.path);

      // Skip excluded directories
      if (excludeDirs.some((dir) => fullPath.includes(`/${dir}/`) || fullPath.includes(`\\${dir}\\`))) {
        continue;
      }

      // Check extension
      const ext = path.extname(fullPath);
      if (extensions.length > 0 && !extensions.includes(ext)) {
        continue;
      }

      totalFiles++;

      const status = await this.checkFile(fullPath);
      switch (status.status) {
        case 'fresh':
          freshFiles++;
          break;
        case 'stale':
          staleFiles++;
          break;
        case 'missing':
          missingFiles++;
          break;
        case 'error':
          errorFiles++;
          break;
      }

      // Track oldest indexed file
      if (file.lastIndexed) {
        const indexedAt = new Date(file.lastIndexed);
        if (!oldestIndexedFile || indexedAt < oldestIndexedFile.indexedAt) {
          oldestIndexedFile = { path: file.path, indexedAt };
        }
      }
    }

    // Count new files
    const newFiles = await this.getNewFiles(options);
    const newFilesCount = newFiles.length;

    // Get last full index time
    const lastIndexingResult = await this.storage.getLastIndexingResult();
    const lastFullIndex = lastIndexingResult?.completedAt;

    return {
      totalFiles: totalFiles + newFilesCount,
      freshFiles,
      staleFiles,
      missingFiles,
      newFiles: newFilesCount,
      errorFiles,
      freshnessPercent: totalFiles > 0 ? (freshFiles / totalFiles) * 100 : 100,
      lastFullIndex,
      oldestIndexedFile,
      computedAt: new Date(),
    };
  }

  /**
   * Compute checksum for a file.
   */
  private async computeChecksum(filePath: string): Promise<string> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return computeFileChecksum(content);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a staleness tracker for the given storage.
 */
export function createStalenessTracker(storage: LibrarianStorage): StalenessTracker {
  return new StalenessTracker(storage);
}
