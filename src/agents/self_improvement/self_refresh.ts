/**
 * @fileoverview Self-Refresh Primitive (tp_self_refresh)
 *
 * Incrementally update Librarian knowledge based on recent changes.
 * Uses git history to detect what changed and updates the index accordingly.
 *
 * Based on self-improvement-primitives.md specification.
 */

import * as path from 'path';
import type { LibrarianStorage } from '../../storage/types.js';
import { IndexLibrarian, type IndexLibrarianConfig } from '../index_librarian.js';
import {
  isGitRepo,
  getGitRoot,
  getGitDiffNames,
  getGitStatusChanges,
  getCurrentGitSha,
  getRecentCommits,
} from '../../utils/git.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a self-refresh operation.
 */
export interface SelfRefreshResult {
  /** Files that were changed and re-indexed */
  changedFiles: string[];
  /** Number of symbols updated */
  updatedSymbols: number;
  /** Number of claims invalidated due to changes */
  invalidatedClaims: number;
  /** Number of new defeaters discovered */
  newDefeaters: number;
  /** Duration of the refresh operation in milliseconds */
  duration: number;
  /** Any errors encountered during refresh */
  errors: string[];
  /** Detailed change summary */
  changeSummary: ChangeSummary;
}

/**
 * Detailed summary of changes detected and processed.
 */
export interface ChangeSummary {
  /** Files that were added */
  added: string[];
  /** Files that were modified */
  modified: string[];
  /** Files that were deleted */
  deleted: string[];
  /** Git commit used as base for comparison */
  baseCommit?: string;
  /** Current HEAD commit */
  headCommit?: string;
}

/**
 * Options for the self-refresh operation.
 */
export interface SelfRefreshOptions {
  /** Root directory of the codebase */
  rootDir: string;
  /** Git commit SHA to compare against (e.g., "abc123", "HEAD~5") */
  sinceCommit?: string;
  /** Number of days to look back for changes */
  sinceDays?: number;
  /** Refresh scope: how widely to propagate updates */
  scope?: 'changed_only' | 'changed_and_dependents' | 'full';
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Optional progress callback */
  onProgress?: (progress: { total: number; completed: number; currentFile?: string }) => void;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom index librarian config */
  indexConfig?: Partial<IndexLibrarianConfig>;
}

// ============================================================================
// GIT CHANGE DETECTION
// ============================================================================

/**
 * Resolve the base commit for comparison.
 */
async function resolveBaseCommit(
  rootDir: string,
  sinceCommit?: string,
  sinceDays?: number
): Promise<string | null> {
  if (sinceCommit) {
    return sinceCommit;
  }

  if (sinceDays && sinceDays > 0) {
    // Find commit from N days ago
    const commits = getRecentCommits(rootDir, 100);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - sinceDays);

    for (const commit of commits) {
      const commitDate = new Date(commit.date);
      if (commitDate < cutoffDate) {
        return commit.hash;
      }
    }

    // If no commit found within range, use the oldest available
    if (commits.length > 0) {
      return commits[commits.length - 1].hash;
    }
  }

  return null;
}

/**
 * Detect changes in the repository since a base commit.
 */
async function detectChanges(
  rootDir: string,
  sinceCommit?: string,
  sinceDays?: number
): Promise<ChangeSummary> {
  const summary: ChangeSummary = {
    added: [],
    modified: [],
    deleted: [],
    headCommit: getCurrentGitSha(rootDir) ?? undefined,
  };

  if (!isGitRepo(rootDir)) {
    // Not a git repo - check for uncommitted changes only
    const statusChanges = await getGitStatusChanges(rootDir);
    if (statusChanges) {
      summary.added = statusChanges.added;
      summary.modified = statusChanges.modified;
      summary.deleted = statusChanges.deleted;
    }
    return summary;
  }

  // Resolve base commit
  const baseCommit = await resolveBaseCommit(rootDir, sinceCommit, sinceDays);
  summary.baseCommit = baseCommit ?? undefined;

  if (baseCommit) {
    // Get changes since the base commit
    const diffChanges = await getGitDiffNames(rootDir, baseCommit);
    if (diffChanges) {
      summary.added = diffChanges.added;
      summary.modified = diffChanges.modified;
      summary.deleted = diffChanges.deleted;
    }
  }

  // Also include uncommitted changes
  const statusChanges = await getGitStatusChanges(rootDir);
  if (statusChanges) {
    // Merge, avoiding duplicates
    for (const file of statusChanges.added) {
      if (!summary.added.includes(file)) {
        summary.added.push(file);
      }
    }
    for (const file of statusChanges.modified) {
      if (!summary.modified.includes(file) && !summary.added.includes(file)) {
        summary.modified.push(file);
      }
    }
    for (const file of statusChanges.deleted) {
      if (!summary.deleted.includes(file)) {
        summary.deleted.push(file);
      }
    }
  }

  return summary;
}

/**
 * Filter changes to only include indexable code files.
 */
function filterIndexableFiles(files: string[]): string[] {
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java'];
  return files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return codeExtensions.includes(ext);
  });
}

// ============================================================================
// DEPENDENT FILE DISCOVERY
// ============================================================================

/**
 * Find files that depend on the changed files.
 * This enables cascade refresh when scope is 'changed_and_dependents'.
 */
async function findDependentFiles(
  storage: LibrarianStorage,
  changedFiles: string[]
): Promise<string[]> {
  const dependentFiles = new Set<string>();

  for (const changedFile of changedFiles) {
    try {
      // Get edges where changedFile is the target (reverse dependencies)
      const edges = await storage.getGraphEdges({
        toIds: [changedFile],
        edgeTypes: ['imports'],
      });

      for (const edge of edges) {
        if (edge.sourceFile && !changedFiles.includes(edge.sourceFile)) {
          dependentFiles.add(edge.sourceFile);
        }
      }
    } catch {
      // Ignore errors in dependency lookup
    }
  }

  return Array.from(dependentFiles);
}

// ============================================================================
// CLAIM INVALIDATION
// ============================================================================

/**
 * Invalidate claims related to changed files.
 * Returns the count of invalidated claims.
 */
async function invalidateAffectedClaims(
  storage: LibrarianStorage,
  changedFiles: string[]
): Promise<number> {
  let invalidatedCount = 0;

  for (const file of changedFiles) {
    try {
      // Invalidate context packs for the file
      const count = await storage.invalidateContextPacks(file);
      invalidatedCount += count;
    } catch {
      // Continue on error
    }
  }

  return invalidatedCount;
}

// ============================================================================
// MAIN REFRESH FUNCTION
// ============================================================================

/**
 * Incrementally refresh the Librarian index based on recent changes.
 *
 * This function:
 * 1. Detects what files have changed using git
 * 2. Re-indexes changed files
 * 3. Optionally refreshes dependent files
 * 4. Invalidates stale claims and context packs
 *
 * @param options - Refresh configuration options
 * @returns Result of the refresh operation
 *
 * @example
 * ```typescript
 * // Refresh based on last 5 commits
 * const result = await selfRefresh({
 *   rootDir: '/path/to/repo',
 *   sinceCommit: 'HEAD~5',
 *   storage: myStorage,
 * });
 *
 * // Refresh based on changes in last 7 days
 * const result = await selfRefresh({
 *   rootDir: '/path/to/repo',
 *   sinceDays: 7,
 *   storage: myStorage,
 * });
 * ```
 */
export async function selfRefresh(
  options: SelfRefreshOptions
): Promise<SelfRefreshResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    rootDir,
    sinceCommit,
    sinceDays,
    scope = 'changed_and_dependents',
    storage,
    onProgress,
    verbose = false,
    indexConfig = {},
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for selfRefresh');
  }
  if (!storage) {
    throw new Error('storage is required for selfRefresh');
  }

  // Detect changes
  const changeSummary = await detectChanges(rootDir, sinceCommit, sinceDays);

  if (verbose) {
    console.error(`[selfRefresh] Detected changes:`, {
      added: changeSummary.added.length,
      modified: changeSummary.modified.length,
      deleted: changeSummary.deleted.length,
    });
  }

  // Filter to indexable files
  const addedFiles = filterIndexableFiles(changeSummary.added);
  const modifiedFiles = filterIndexableFiles(changeSummary.modified);
  const deletedFiles = filterIndexableFiles(changeSummary.deleted);

  // Combine added and modified for indexing
  let filesToIndex = [...addedFiles, ...modifiedFiles];

  // Expand to dependents if requested
  if (scope === 'changed_and_dependents' && filesToIndex.length > 0) {
    const dependents = await findDependentFiles(storage, filesToIndex);
    filesToIndex = [...filesToIndex, ...dependents];
    // Remove duplicates
    filesToIndex = [...new Set(filesToIndex)];
  }

  // Handle full scope
  if (scope === 'full') {
    // For full scope, we would need to re-index everything
    // This is handled by selfBootstrap, not selfRefresh
    errors.push('Full scope refresh should use selfBootstrap instead');
  }

  // Convert to absolute paths
  const gitRoot = getGitRoot(rootDir) ?? rootDir;
  const absoluteFilesToIndex = filesToIndex.map((f) =>
    path.isAbsolute(f) ? f : path.join(gitRoot, f)
  );
  const absoluteDeletedFiles = deletedFiles.map((f) =>
    path.isAbsolute(f) ? f : path.join(gitRoot, f)
  );

  // Create index librarian
  const indexLibrarian = new IndexLibrarian({
    generateEmbeddings: false,
    createContextPacks: true,
    computeGraphMetrics: false, // Skip for incremental
    progressCallback: onProgress,
    forceReindex: true, // Force re-index for changed files
    ...indexConfig,
  });

  await indexLibrarian.initialize(storage);

  let updatedSymbols = 0;
  const changedFiles: string[] = [];

  // Process deleted files first
  for (const file of absoluteDeletedFiles) {
    try {
      await indexLibrarian.removeFile(file);
      changedFiles.push(file);
    } catch (error) {
      errors.push(`Failed to remove ${file}: ${getErrorMessage(error)}`);
    }
  }

  // Re-index changed/added files
  for (const file of absoluteFilesToIndex) {
    try {
      const result = await indexLibrarian.indexFile(file);
      updatedSymbols += result.functionsIndexed;
      changedFiles.push(file);

      if (result.errors.length > 0) {
        errors.push(...result.errors.map((e) => `${file}: ${e}`));
      }
    } catch (error) {
      errors.push(`Failed to index ${file}: ${getErrorMessage(error)}`);
    }
  }

  // Invalidate affected claims
  const invalidatedClaims = await invalidateAffectedClaims(storage, changedFiles);

  // Shutdown
  await indexLibrarian.shutdown();

  // New defeaters count (stub - would need defeater tracking)
  const newDefeaters = 0;

  return {
    changedFiles,
    updatedSymbols,
    invalidatedClaims,
    newDefeaters,
    duration: Date.now() - startTime,
    errors,
    changeSummary,
  };
}

/**
 * Create a self-refresh primitive with bound options.
 */
export function createSelfRefresh(
  defaultOptions: Partial<SelfRefreshOptions>
): (options: Partial<SelfRefreshOptions> & { rootDir: string; storage: LibrarianStorage }) => Promise<SelfRefreshResult> {
  return async (options) => {
    return selfRefresh({
      ...defaultOptions,
      ...options,
    });
  };
}
