/**
 * @fileoverview Dependency Tracker for File Change Invalidation
 *
 * Tracks forward and reverse dependencies between files to enable
 * cascading invalidation when a file changes. When a file is modified,
 * all files that import it need to have their cached data invalidated.
 *
 * Key Concepts:
 * - Forward edges: file -> files it imports
 * - Reverse edges: file -> files that import it (importedBy)
 *
 * @packageDocumentation
 */

import type { LiBrainianStorage } from '../storage/types.js';
import { logInfo, logWarning } from '../telemetry/logger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Graph structure for tracking file dependencies.
 */
export interface DependencyGraph {
  /** Forward: file -> files it imports */
  imports: Map<string, Set<string>>;
  /** Reverse: file -> files that import it */
  importedBy: Map<string, Set<string>>;
}

/**
 * Result of an invalidation cascade operation.
 */
export interface InvalidationResult {
  /** The file that triggered the invalidation */
  changedFile: string;
  /** Files that were invalidated */
  invalidatedFiles: string[];
  /** Files that had their cache cleared */
  cacheInvalidated: string[];
  /** Files that had their embeddings cleared */
  embeddingsInvalidated: string[];
  /** Total time for the operation in ms */
  durationMs: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Options for invalidation operations.
 */
export interface InvalidationOptions {
  /** Whether to invalidate cache */
  invalidateCache?: boolean;
  /** Whether to invalidate embeddings */
  invalidateEmbeddings?: boolean;
  /** Maximum depth for cascading invalidation (0 = unlimited) */
  maxDepth?: number;
  /** Whether to log progress */
  verbose?: boolean;
}

const DEFAULT_INVALIDATION_OPTIONS: Required<InvalidationOptions> = {
  invalidateCache: true,
  invalidateEmbeddings: true,
  maxDepth: 0,
  verbose: false,
};

// ============================================================================
// DEPENDENCY TRACKER
// ============================================================================

/**
 * Tracks file dependencies and manages cascading invalidation.
 *
 * The tracker maintains an in-memory graph of file dependencies that can be
 * hydrated from storage (graph edges) and updated as files are indexed.
 *
 * @example
 * ```typescript
 * const tracker = new DependencyTracker();
 *
 * // Record imports during indexing
 * tracker.recordImport('src/api/query.ts', 'src/storage/types.ts');
 * tracker.recordImport('src/api/query.ts', 'src/utils/index.ts');
 *
 * // When a file changes, get all files that need invalidation
 * const toInvalidate = tracker.getFilesToInvalidate('src/storage/types.ts');
 * // Returns ['src/api/query.ts', ...other files that import types.ts]
 * ```
 */
export class DependencyTracker {
  private graph: DependencyGraph = {
    imports: new Map(),
    importedBy: new Map(),
  };

  /**
   * Record an import relationship between files.
   *
   * @param sourceFile - The file that contains the import statement
   * @param targetFile - The file being imported
   */
  recordImport(sourceFile: string, targetFile: string): void {
    // Forward edge: sourceFile imports targetFile
    if (!this.graph.imports.has(sourceFile)) {
      this.graph.imports.set(sourceFile, new Set());
    }
    this.graph.imports.get(sourceFile)!.add(targetFile);

    // Reverse edge: targetFile is imported by sourceFile
    if (!this.graph.importedBy.has(targetFile)) {
      this.graph.importedBy.set(targetFile, new Set());
    }
    this.graph.importedBy.get(targetFile)!.add(sourceFile);
  }

  /**
   * Record multiple imports from a single source file.
   *
   * @param sourceFile - The file that contains the import statements
   * @param targetFiles - The files being imported
   */
  recordImports(sourceFile: string, targetFiles: string[]): void {
    for (const targetFile of targetFiles) {
      this.recordImport(sourceFile, targetFile);
    }
  }

  /**
   * Get all files that need to be invalidated when a file changes.
   *
   * Uses BFS to traverse the reverse dependency graph and find all files
   * that directly or transitively depend on the changed file.
   *
   * @param changedFile - The file that changed
   * @param maxDepth - Maximum depth to traverse (0 = unlimited)
   * @returns Array of file paths that depend on the changed file
   */
  getFilesToInvalidate(changedFile: string, maxDepth = 0): string[] {
    const toInvalidate = new Set<string>();
    const queue: Array<{ file: string; depth: number }> = [{ file: changedFile, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;

      if (visited.has(file)) {
        continue;
      }
      visited.add(file);

      // Get all files that import this file
      const importers = this.graph.importedBy.get(file) ?? new Set();

      for (const importer of importers) {
        if (!toInvalidate.has(importer)) {
          toInvalidate.add(importer);

          // Continue traversing if within depth limit
          if (maxDepth === 0 || depth + 1 < maxDepth) {
            queue.push({ file: importer, depth: depth + 1 });
          }
        }
      }
    }

    return Array.from(toInvalidate);
  }

  /**
   * Get the direct importers of a file (one level only).
   *
   * @param file - The file to check
   * @returns Set of files that directly import the given file
   */
  getDirectImporters(file: string): Set<string> {
    return this.graph.importedBy.get(file) ?? new Set();
  }

  /**
   * Get the files that a given file directly imports.
   *
   * @param file - The file to check
   * @returns Set of files that the given file imports
   */
  getDirectImports(file: string): Set<string> {
    return this.graph.imports.get(file) ?? new Set();
  }

  /**
   * Clear all dependency information for a file.
   *
   * This should be called before re-indexing a file to remove stale
   * dependency information.
   *
   * @param file - The file to clear
   */
  clearFile(file: string): void {
    // Remove forward edges from this file
    const imports = this.graph.imports.get(file);
    if (imports) {
      for (const target of imports) {
        this.graph.importedBy.get(target)?.delete(file);
      }
      this.graph.imports.delete(file);
    }

    // Note: We don't remove the reverse edges (importedBy) for this file
    // because other files may still import it. Those edges are removed
    // when the importing files are cleared/re-indexed.
  }

  /**
   * Check if a file has any dependents (files that import it).
   *
   * @param file - The file to check
   * @returns true if the file has dependents
   */
  hasDependents(file: string): boolean {
    const importers = this.graph.importedBy.get(file);
    return importers !== undefined && importers.size > 0;
  }

  /**
   * Check if a file has any dependencies (files it imports).
   *
   * @param file - The file to check
   * @returns true if the file has dependencies
   */
  hasDependencies(file: string): boolean {
    const imports = this.graph.imports.get(file);
    return imports !== undefined && imports.size > 0;
  }

  /**
   * Get the total number of files tracked.
   */
  getFileCount(): number {
    const allFiles = new Set<string>();
    for (const file of this.graph.imports.keys()) {
      allFiles.add(file);
    }
    for (const file of this.graph.importedBy.keys()) {
      allFiles.add(file);
    }
    return allFiles.size;
  }

  /**
   * Get the total number of edges in the dependency graph.
   */
  getEdgeCount(): number {
    let count = 0;
    for (const targets of this.graph.imports.values()) {
      count += targets.size;
    }
    return count;
  }

  /**
   * Clear all tracked dependencies.
   */
  clear(): void {
    this.graph.imports.clear();
    this.graph.importedBy.clear();
  }

  /**
   * Hydrate the tracker from storage graph edges.
   *
   * @param storage - The storage instance
   */
  async hydrateFromStorage(storage: LiBrainianStorage): Promise<void> {
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'] });

    for (const edge of edges) {
      // For import edges, fromId is the importing file, toId is the imported file
      // We use sourceFile as it's always populated
      const sourceFile = edge.sourceFile;
      const targetId = edge.toId;

      // Only track file-to-file dependencies
      if (edge.fromType === 'file' && edge.toType === 'file') {
        this.recordImport(sourceFile, targetId);
      } else if (edge.fromType === 'module' && edge.toType === 'module') {
        // Module imports are also file-level imports
        this.recordImport(edge.fromId, targetId);
      }
    }

    logInfo('[dependency_tracker] Hydrated from storage', {
      fileCount: this.getFileCount(),
      edgeCount: this.getEdgeCount(),
    });
  }

  /**
   * Get dependency graph statistics.
   */
  getStats(): {
    fileCount: number;
    edgeCount: number;
    maxDependents: number;
    maxDependencies: number;
    averageDependents: number;
    averageDependencies: number;
  } {
    let maxDependents = 0;
    let maxDependencies = 0;
    let totalDependents = 0;
    let totalDependencies = 0;
    let filesWithDependents = 0;
    let filesWithDependencies = 0;

    for (const importers of this.graph.importedBy.values()) {
      const count = importers.size;
      if (count > 0) {
        filesWithDependents++;
        totalDependents += count;
        maxDependents = Math.max(maxDependents, count);
      }
    }

    for (const imports of this.graph.imports.values()) {
      const count = imports.size;
      if (count > 0) {
        filesWithDependencies++;
        totalDependencies += count;
        maxDependencies = Math.max(maxDependencies, count);
      }
    }

    return {
      fileCount: this.getFileCount(),
      edgeCount: this.getEdgeCount(),
      maxDependents,
      maxDependencies,
      averageDependents: filesWithDependents > 0 ? totalDependents / filesWithDependents : 0,
      averageDependencies: filesWithDependencies > 0 ? totalDependencies / filesWithDependencies : 0,
    };
  }
}

// ============================================================================
// FILE CHANGE HANDLER
// ============================================================================

/**
 * Handle a file change event by invalidating dependent files.
 *
 * This function should be called when a file is modified to ensure
 * all dependent files have their cached data invalidated.
 *
 * @param storage - The storage instance
 * @param tracker - The dependency tracker
 * @param changedFile - The file that changed
 * @param options - Invalidation options
 * @returns Result of the invalidation operation
 */
export async function onFileChanged(
  storage: LiBrainianStorage,
  tracker: DependencyTracker,
  changedFile: string,
  options: InvalidationOptions = {}
): Promise<InvalidationResult> {
  const opts = { ...DEFAULT_INVALIDATION_OPTIONS, ...options };
  const startTime = Date.now();
  const result: InvalidationResult = {
    changedFile,
    invalidatedFiles: [],
    cacheInvalidated: [],
    embeddingsInvalidated: [],
    durationMs: 0,
    errors: [],
  };

  try {
    // Clear old dependency info for this file (will be rebuilt on reindex)
    tracker.clearFile(changedFile);

    // Get files to invalidate (files that depend on the changed file)
    const toInvalidate = tracker.getFilesToInvalidate(changedFile, opts.maxDepth);
    result.invalidatedFiles = toInvalidate;

    if (opts.verbose) {
      logInfo('[dependency_tracker] Starting invalidation cascade', {
        changedFile,
        dependentCount: toInvalidate.length,
      });
    }

    // Invalidate cached data for dependent files
    for (const file of toInvalidate) {
      try {
        if (opts.invalidateCache) {
          await storage.invalidateCache(file);
          result.cacheInvalidated.push(file);
        }

        if (opts.invalidateEmbeddings) {
          await storage.invalidateEmbeddings(file);
          result.embeddingsInvalidated.push(file);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to invalidate ${file}: ${msg}`);
        logWarning('[dependency_tracker] Invalidation failed for file', {
          file,
          error: msg,
        });
      }
    }

    // Log invalidation cascade
    if (toInvalidate.length > 0) {
      logInfo('[dependency_tracker] Invalidation cascade complete', {
        changedFile,
        invalidatedCount: toInvalidate.length,
        cacheInvalidated: result.cacheInvalidated.length,
        embeddingsInvalidated: result.embeddingsInvalidated.length,
        errors: result.errors.length,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Invalidation failed: ${msg}`);
    logWarning('[dependency_tracker] Invalidation cascade failed', {
      changedFile,
      error: msg,
    });
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new dependency tracker.
 */
export function createDependencyTracker(): DependencyTracker {
  return new DependencyTracker();
}

/**
 * Create a dependency tracker and hydrate it from storage.
 *
 * @param storage - The storage instance to hydrate from
 * @returns A hydrated dependency tracker
 */
export async function createHydratedDependencyTracker(
  storage: LiBrainianStorage
): Promise<DependencyTracker> {
  const tracker = new DependencyTracker();
  await tracker.hydrateFromStorage(storage);
  return tracker;
}
