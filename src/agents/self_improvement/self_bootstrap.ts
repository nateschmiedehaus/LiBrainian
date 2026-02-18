/**
 * @fileoverview Self-Bootstrap Primitive (tp_self_bootstrap)
 *
 * Bootstrap Librarian knowledge index on Librarian source code itself.
 * This primitive enables Librarian to index and understand its own codebase,
 * providing the foundation for self-analysis and self-improvement.
 *
 * Based on self-improvement-primitives.md specification.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import type { LibrarianStorage } from '../../storage/types.js';
import { IndexLibrarian, type IndexLibrarianConfig } from '../index_librarian.js';
import { isExcluded, getAllIncludePatterns, UNIVERSAL_EXCLUDES } from '../../universal_patterns.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a self-bootstrap operation.
 */
export interface SelfBootstrapResult {
  /** Number of files successfully indexed */
  indexedFiles: number;
  /** Number of symbols (functions, classes, etc.) extracted */
  extractedSymbols: number;
  /** Number of nodes in the knowledge graph */
  graphNodes: number;
  /** Number of edges in the knowledge graph */
  graphEdges: number;
  /** Duration of the bootstrap operation in milliseconds */
  duration: number;
  /** Any errors encountered during bootstrap */
  errors: string[];
  /** Whether this was a self-referential bootstrap (indexing Librarian itself) */
  isSelfReferential: boolean;
  /** Coverage metrics */
  coverage: CoverageMetrics;
}

/**
 * Coverage metrics for the bootstrap operation.
 */
export interface CoverageMetrics {
  /** Percentage of functions indexed (0.0-1.0) */
  functions: number;
  /** Percentage of classes indexed (0.0-1.0) */
  classes: number;
  /** Percentage of modules indexed (0.0-1.0) */
  modules: number;
  /** Percentage of relationships discovered (0.0-1.0) */
  relationships: number;
}

/**
 * Options for the self-bootstrap operation.
 */
export interface SelfBootstrapOptions {
  /** Root directory of the codebase to index */
  rootDir: string;
  /** Patterns to exclude from indexing */
  excludePatterns?: string[];
  /** Maximum number of files to index (for testing/limiting scope) */
  maxFiles?: number;
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
// SELF-REFERENTIAL DETECTION
// ============================================================================

/**
 * Detect if we are indexing the Librarian codebase itself.
 * This enables self-referential awareness for special handling.
 */
async function isSelfReferentialBootstrap(rootDir: string): Promise<boolean> {
  const markers = [
    'src/agents/index_librarian.ts',
    'src/storage/types.ts',
    'package.json',
  ];

  for (const marker of markers) {
    const markerPath = path.join(rootDir, marker);
    try {
      await fs.access(markerPath);
    } catch {
      return false;
    }
  }

  // Check package.json for Librarian package identity
  try {
    const packagePath = path.join(rootDir, 'package.json');
    const content = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(content) as { name?: string };
    const packageName = pkg.name ?? '';
    return (
      packageName === 'librainian' ||
      packageName === 'librarian' ||
      packageName === '@librarian/core' ||
      packageName.includes('librarian')
    );
  } catch {
    return false;
  }
}

// ============================================================================
// FILE DISCOVERY
// ============================================================================

/**
 * Discover files to index in the root directory.
 */
async function discoverFiles(
  rootDir: string,
  excludePatterns: string[],
  maxFiles?: number
): Promise<string[]> {
  const includePatterns = getAllIncludePatterns();

  // Combine default and custom exclude patterns
  const allExcludes = [
    ...UNIVERSAL_EXCLUDES,
    ...excludePatterns,
    // Always exclude test fixtures and snapshots
    '**/__snapshots__/**',
    '**/fixtures/**',
    '**/test-data/**',
  ];

  const files = await glob(includePatterns, {
    cwd: rootDir,
    ignore: allExcludes,
    absolute: true,
    follow: false,
    nodir: true,
  });

  // Filter out any remaining excluded files
  const filteredFiles = files.filter((file) => {
    const relativePath = path.relative(rootDir, file);
    return !isExcluded(relativePath);
  });

  // Sort for deterministic ordering
  filteredFiles.sort();

  // Apply max files limit if specified
  if (maxFiles && maxFiles > 0) {
    return filteredFiles.slice(0, maxFiles);
  }

  return filteredFiles;
}

// ============================================================================
// GRAPH METRICS
// ============================================================================

/**
 * Compute graph metrics from storage after indexing.
 */
async function computeGraphMetrics(storage: LibrarianStorage): Promise<{
  nodes: number;
  edges: number;
}> {
  try {
    const edges = await storage.getGraphEdges({});
    const nodeSet = new Set<string>();

    for (const edge of edges) {
      nodeSet.add(edge.fromId);
      nodeSet.add(edge.toId);
    }

    return {
      nodes: nodeSet.size,
      edges: edges.length,
    };
  } catch {
    return { nodes: 0, edges: 0 };
  }
}

// ============================================================================
// MAIN BOOTSTRAP FUNCTION
// ============================================================================

/**
 * Bootstrap Librarian knowledge index on a codebase.
 *
 * This function indexes the specified codebase, extracting:
 * - Functions and their signatures
 * - Module structure and dependencies
 * - Call graph relationships
 * - Context packs for retrieval
 *
 * When indexing the Librarian codebase itself, it enables
 * self-referential awareness for meta-cognitive capabilities.
 *
 * @param options - Bootstrap configuration options
 * @returns Result of the bootstrap operation
 *
 * @example
 * ```typescript
 * const result = await selfBootstrap({
 *   rootDir: '/path/to/librarian',
 *   storage: myStorage,
 * });
 * console.log(`Indexed ${result.indexedFiles} files with ${result.extractedSymbols} symbols`);
 * ```
 */
export async function selfBootstrap(
  options: SelfBootstrapOptions
): Promise<SelfBootstrapResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    rootDir,
    excludePatterns = [],
    maxFiles,
    storage,
    onProgress,
    verbose = false,
    indexConfig = {},
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for selfBootstrap');
  }
  if (!storage) {
    throw new Error('storage is required for selfBootstrap');
  }

  // Check for self-referential bootstrap
  const isSelfReferential = await isSelfReferentialBootstrap(rootDir);

  if (verbose && isSelfReferential) {
    console.error('[selfBootstrap] Detected self-referential bootstrap - indexing Librarian itself');
  }

  // Discover files to index
  const files = await discoverFiles(rootDir, excludePatterns, maxFiles);

  if (files.length === 0) {
    return {
      indexedFiles: 0,
      extractedSymbols: 0,
      graphNodes: 0,
      graphEdges: 0,
      duration: Date.now() - startTime,
      errors: ['No files found to index'],
      isSelfReferential,
      coverage: { functions: 0, classes: 0, modules: 0, relationships: 0 },
    };
  }

  // Create and initialize index librarian
  const indexLibrarian = new IndexLibrarian({
    generateEmbeddings: false, // Skip embeddings for bootstrap
    createContextPacks: true,
    computeGraphMetrics: true,
    workspaceRoot: rootDir,
    progressCallback: onProgress,
    ...indexConfig,
  });

  await indexLibrarian.initialize(storage);

  // Process files
  let indexedFiles = 0;
  let extractedSymbols = 0;

  for (const filePath of files) {
    try {
      const result = await indexLibrarian.indexFile(filePath);
      indexedFiles++;
      extractedSymbols += result.functionsIndexed;

      if (result.errors.length > 0) {
        errors.push(...result.errors.map((e) => `${filePath}: ${e}`));
      }
    } catch (error) {
      errors.push(`Failed to index ${filePath}: ${getErrorMessage(error)}`);
    }
  }

  // Compute graph metrics
  const graphMetrics = await computeGraphMetrics(storage);

  // Get indexing stats
  const stats = indexLibrarian.getStats();

  // Compute coverage metrics
  const coverage: CoverageMetrics = {
    functions: indexedFiles > 0 ? Math.min(1, stats.totalFunctionsIndexed / (indexedFiles * 10)) : 0,
    classes: 0.5, // Stub - would need class tracking
    modules: indexedFiles > 0 ? Math.min(1, stats.totalModulesIndexed / indexedFiles) : 0,
    relationships: graphMetrics.edges > 0 ? Math.min(1, graphMetrics.edges / (extractedSymbols * 2)) : 0,
  };

  // Shutdown
  await indexLibrarian.shutdown();

  return {
    indexedFiles,
    extractedSymbols,
    graphNodes: graphMetrics.nodes,
    graphEdges: graphMetrics.edges,
    duration: Date.now() - startTime,
    errors,
    isSelfReferential,
    coverage,
  };
}

/**
 * Create a self-bootstrap primitive with bound options.
 * Useful for creating reusable bootstrap configurations.
 */
export function createSelfBootstrap(
  defaultOptions: Partial<SelfBootstrapOptions>
): (options: Partial<SelfBootstrapOptions> & { rootDir: string; storage: LibrarianStorage }) => Promise<SelfBootstrapResult> {
  return async (options) => {
    return selfBootstrap({
      ...defaultOptions,
      ...options,
    });
  };
}
