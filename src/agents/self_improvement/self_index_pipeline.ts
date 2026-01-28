/**
 * @fileoverview Self-Index Pipeline (WU-BOOT-001)
 *
 * Orchestrates complete indexing of Librarian's own codebase.
 * This enables Librarian to understand and analyze itself.
 *
 * Key features:
 * - Uses existing selfBootstrap primitive for indexing
 * - Validates index quality after completion
 * - Persists index for ongoing use
 * - Reports detailed progress during execution
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import type { LibrarianStorage } from '../../storage/types.js';
import { selfBootstrap } from './self_bootstrap.js';
import { isExcluded, getAllIncludePatterns, UNIVERSAL_EXCLUDES } from '../../universal_patterns.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for self-indexing pipeline.
 */
export interface SelfIndexConfig {
  /** Root directory of the codebase to index */
  rootDir: string;
  /** Glob patterns for files/directories to exclude */
  excludePatterns: string[];
  /** Maximum number of files to index */
  maxFiles: number;
  /** Whether to validate index quality after completion */
  validateQuality: boolean;
}

/**
 * Progress updates during indexing.
 */
export interface IndexProgress {
  /** Current phase of the pipeline */
  phase: 'scanning' | 'parsing' | 'indexing' | 'validating' | 'complete';
  /** Number of files processed so far */
  filesProcessed: number;
  /** Total number of files to process */
  totalFiles: number;
  /** Current file being processed */
  currentFile?: string;
  /** Errors encountered so far */
  errors: IndexError[];
}

/**
 * Error encountered during indexing.
 */
export interface IndexError {
  /** File path where error occurred */
  file: string;
  /** Error message */
  error: string;
  /** Whether the error is recoverable (indexing can continue) */
  recoverable: boolean;
}

/**
 * Result of indexing a single file.
 */
export interface FileIndex {
  /** Absolute file path */
  filePath: string;
  /** Symbols extracted from the file */
  symbols: SymbolInfo[];
  /** File checksum for change detection */
  checksum: string;
  /** When the file was indexed */
  indexedAt: string;
}

/**
 * Information about a symbol (function, class, etc.)
 */
export interface SymbolInfo {
  /** Symbol name */
  name: string;
  /** Symbol kind (function, class, variable, etc.) */
  kind: string;
  /** Line number where symbol is defined */
  line: number;
  /** Optional end line */
  endLine?: number;
  /** Optional signature for functions */
  signature?: string;
}

/**
 * Complete index of all files in the codebase.
 */
export interface CodeIndex {
  /** All indexed files */
  files: FileIndex[];
  /** Total number of symbols across all files */
  totalSymbols: number;
  /** When the index was created */
  createdAt: string;
  /** Index version */
  version: string;
}

/**
 * Quality validation report for an index.
 */
export interface QualityReport {
  /** Overall quality score (0.0 - 1.0) */
  score: number;
  /** Specific issues found */
  issues: string[];
  /** Recommendations for improvement */
  recommendations: string[];
  /** Coverage statistics */
  coverage: {
    filesWithSymbols: number;
    totalFiles: number;
    avgSymbolsPerFile: number;
  };
}

/**
 * Result of the complete self-indexing operation.
 */
export interface SelfIndexResult {
  /** Whether indexing completed successfully */
  success: boolean;
  /** Number of files indexed */
  filesIndexed: number;
  /** Total symbols extracted across all files */
  symbolsExtracted: number;
  /** Approximate size of the index in bytes */
  indexSize: number;
  /** Quality score (0.0 - 1.0) if validation was enabled */
  qualityScore: number;
  /** Errors encountered during indexing */
  errors: IndexError[];
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Options for creating a SelfIndexPipeline.
 */
export interface SelfIndexPipelineOptions {
  /** Storage instance for persisting indexed data */
  storage?: LibrarianStorage;
  /** Progress callback for monitoring indexing progress */
  onProgress?: (progress: IndexProgress) => void;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Skip selfBootstrap and use fallback indexing (for testing) */
  skipBootstrap?: boolean;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for indexing Librarian's own codebase.
 */
export const LIBRARIAN_INDEX_CONFIG: SelfIndexConfig = {
  rootDir: process.cwd(),
  excludePatterns: [
    'node_modules/**',
    'dist/**',
    '**/*.test.ts',
    'eval-corpus/**',
    'coverage/**',
    '.git/**',
    '**/__snapshots__/**',
    '**/fixtures/**',
  ],
  maxFiles: 1000,
  validateQuality: true,
};

// ============================================================================
// SELF INDEX PIPELINE CLASS
// ============================================================================

/**
 * Orchestrates complete indexing of Librarian's own codebase.
 *
 * This class provides the main entry point for self-indexing. It:
 * 1. Scans the codebase to find all relevant files
 * 2. Uses selfBootstrap to index each file
 * 3. Validates the quality of the resulting index
 * 4. Persists the index for ongoing use
 *
 * @example
 * ```typescript
 * const pipeline = new SelfIndexPipeline({ storage });
 * const result = await pipeline.runPipeline(LIBRARIAN_INDEX_CONFIG);
 * console.log(`Indexed ${result.filesIndexed} files`);
 * ```
 */
export class SelfIndexPipeline {
  private storage: LibrarianStorage;
  private onProgress?: (progress: IndexProgress) => void;
  private verbose: boolean;
  private skipBootstrap: boolean;
  private currentProgress: IndexProgress;

  constructor(options: SelfIndexPipelineOptions) {
    if (!options.storage) {
      throw new Error('storage is required for SelfIndexPipeline');
    }

    this.storage = options.storage;
    this.onProgress = options.onProgress;
    this.verbose = options.verbose ?? false;
    this.skipBootstrap = options.skipBootstrap ?? this.isTestMode();
    this.currentProgress = {
      phase: 'scanning',
      filesProcessed: 0,
      totalFiles: 0,
      errors: [],
    };
  }

  /**
   * Check if we're running in test mode.
   */
  private isTestMode(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true';
  }

  // ============================================================================
  // MAIN PIPELINE
  // ============================================================================

  /**
   * Run the complete self-indexing pipeline.
   *
   * @param config - Configuration for the indexing operation
   * @returns Result of the indexing operation
   */
  async runPipeline(config: SelfIndexConfig): Promise<SelfIndexResult> {
    const startTime = Date.now();
    const errors: IndexError[] = [];

    // Validate config
    await this.validateConfig(config);

    // Phase 1: Scanning
    this.updateProgress({ phase: 'scanning', filesProcessed: 0, totalFiles: 0, errors: [] });
    const files = await this.scanFiles(config.rootDir, config.excludePatterns);
    const filesToIndex = files.slice(0, config.maxFiles);

    if (this.verbose) {
      console.log(`[SelfIndexPipeline] Found ${files.length} files, indexing ${filesToIndex.length}`);
    }

    // Phase 2: Indexing
    this.updateProgress({
      phase: 'indexing',
      filesProcessed: 0,
      totalFiles: filesToIndex.length,
      errors: [],
    });

    let filesIndexed = 0;
    let symbolsExtracted = 0;

    if (this.skipBootstrap) {
      // Fallback indexing for test mode
      const result = await this.fallbackIndexing(filesToIndex, errors);
      filesIndexed = result.filesIndexed;
      symbolsExtracted = result.symbolsExtracted;
    } else {
      // Use selfBootstrap for production indexing
      try {
        const bootstrapResult = await selfBootstrap({
          rootDir: config.rootDir,
          excludePatterns: config.excludePatterns,
          maxFiles: config.maxFiles,
          storage: this.storage,
          onProgress: (progress) => {
            this.updateProgress({
              phase: 'indexing',
              filesProcessed: progress.completed,
              totalFiles: progress.total,
              currentFile: progress.currentFile,
              errors: this.currentProgress.errors,
            });
          },
          verbose: this.verbose,
          indexConfig: {
            generateEmbeddings: false,
            createContextPacks: true,
            computeGraphMetrics: true,
          },
        });

        filesIndexed = bootstrapResult.indexedFiles;
        symbolsExtracted = bootstrapResult.extractedSymbols;

        // Convert bootstrap errors to IndexError format
        for (const errorMsg of bootstrapResult.errors) {
          const parts = errorMsg.split(': ');
          errors.push({
            file: parts[0] ?? 'unknown',
            error: parts.slice(1).join(': ') || errorMsg,
            recoverable: true,
          });
        }
      } catch (error) {
        errors.push({
          file: config.rootDir,
          error: getErrorMessage(error),
          recoverable: false,
        });
      }
    }

    // Phase 3: Validation (optional)
    let qualityScore = 0;
    if (config.validateQuality) {
      this.updateProgress({
        phase: 'validating',
        filesProcessed: filesIndexed,
        totalFiles: filesToIndex.length,
        errors,
      });

      const codeIndex = await this.buildCodeIndexFromStorage();
      const report = this.validateIndex(codeIndex);
      qualityScore = report.score;

      if (this.verbose) {
        console.log(`[SelfIndexPipeline] Quality score: ${(qualityScore * 100).toFixed(1)}%`);
        for (const issue of report.issues) {
          console.log(`  Issue: ${issue}`);
        }
      }
    }

    // Get index size estimate
    const stats = await this.storage.getStats();
    const indexSize = stats.storageSizeBytes;

    // Phase 4: Complete
    this.updateProgress({
      phase: 'complete',
      filesProcessed: filesIndexed,
      totalFiles: filesToIndex.length,
      errors,
    });

    const duration = Date.now() - startTime;

    return {
      success: errors.filter((e) => !e.recoverable).length === 0,
      filesIndexed,
      symbolsExtracted,
      indexSize,
      qualityScore,
      errors,
      duration,
    };
  }

  /**
   * Fallback indexing for test mode when selfBootstrap is unavailable.
   * Uses simple file parsing without LLM analysis.
   */
  private async fallbackIndexing(
    filesToIndex: string[],
    errors: IndexError[]
  ): Promise<{ filesIndexed: number; symbolsExtracted: number }> {
    let filesIndexed = 0;
    let symbolsExtracted = 0;

    for (let i = 0; i < filesToIndex.length; i++) {
      const filePath = filesToIndex[i];
      try {
        const fileIndex = await this.indexFile(filePath);
        filesIndexed++;
        symbolsExtracted += fileIndex.symbols.length;

        this.updateProgress({
          phase: 'indexing',
          filesProcessed: i + 1,
          totalFiles: filesToIndex.length,
          currentFile: filePath,
          errors: this.currentProgress.errors,
        });
      } catch (error) {
        errors.push({
          file: filePath,
          error: getErrorMessage(error),
          recoverable: true,
        });
      }
    }

    return { filesIndexed, symbolsExtracted };
  }

  // ============================================================================
  // FILE SCANNING
  // ============================================================================

  /**
   * Scan directory for files to index.
   *
   * @param rootDir - Root directory to scan
   * @param excludePatterns - Patterns to exclude
   * @returns Array of absolute file paths
   */
  async scanFiles(rootDir: string, excludePatterns: string[]): Promise<string[]> {
    const includePatterns = getAllIncludePatterns();

    // Combine exclude patterns
    const allExcludes = [
      ...UNIVERSAL_EXCLUDES,
      ...excludePatterns,
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

    return filteredFiles;
  }

  // ============================================================================
  // FILE INDEXING
  // ============================================================================

  /**
   * Index a single file and extract symbols.
   *
   * @param filePath - Absolute path to the file
   * @returns FileIndex with extracted symbols
   */
  async indexFile(filePath: string): Promise<FileIndex> {
    // Verify file exists
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await fs.readFile(filePath, 'utf8');
    const symbols = this.extractSymbols(content, filePath);
    const checksum = await this.computeChecksum(content);

    return {
      filePath,
      symbols,
      checksum,
      indexedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract symbols from file content.
   * This is a simplified extraction - the real work is done by selfBootstrap.
   */
  private extractSymbols(content: string, filePath: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = content.split('\n');
    const ext = path.extname(filePath);

    // Simple regex patterns for TypeScript/JavaScript
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      const patterns = [
        // Named function declarations
        { pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
        // Arrow functions assigned to const/let
        { pattern: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/gm, kind: 'variable' },
        // Class declarations
        { pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
        // Interface declarations
        { pattern: /^(?:export\s+)?interface\s+(\w+)/gm, kind: 'interface' },
        // Type declarations
        { pattern: /^(?:export\s+)?type\s+(\w+)/gm, kind: 'type' },
      ];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { pattern, kind } of patterns) {
          pattern.lastIndex = 0;
          const match = pattern.exec(line);
          if (match && match[1]) {
            symbols.push({
              name: match[1],
              kind,
              line: i + 1,
            });
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Compute a simple checksum for content.
   */
  private async computeChecksum(content: string): Promise<string> {
    // Use a simple hash for testing - in production, use crypto
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  // ============================================================================
  // INDEX VALIDATION
  // ============================================================================

  /**
   * Validate the quality of a code index.
   *
   * @param index - The code index to validate
   * @returns Quality report with score and issues
   */
  validateIndex(index: CodeIndex): QualityReport {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for empty index
    if (index.files.length === 0) {
      issues.push('Index contains no files');
      recommendations.push('Run indexing on the codebase');
    }

    // Check for files with no symbols
    const filesWithSymbols = index.files.filter((f) => f.symbols.length > 0);
    const filesWithNoSymbols = index.files.filter((f) => f.symbols.length === 0);

    if (filesWithNoSymbols.length > 0) {
      issues.push(`${filesWithNoSymbols.length} files have no symbols extracted`);
    }

    // Calculate average symbols per file
    const avgSymbols = index.files.length > 0
      ? index.totalSymbols / index.files.length
      : 0;

    if (avgSymbols < 1 && index.files.length > 0) {
      issues.push('Average symbols per file is less than 1');
      recommendations.push('Check parser configuration for missing symbol types');
    }

    // Calculate quality score
    let score = 1.0;

    // Penalty for empty index
    if (index.files.length === 0) {
      score = 0;
    } else {
      // Penalty for files without symbols (up to 30%)
      const symbolCoverage = filesWithSymbols.length / index.files.length;
      score -= (1 - symbolCoverage) * 0.3;

      // Penalty for low average symbols (up to 20%)
      if (avgSymbols < 5) {
        score -= (1 - avgSymbols / 5) * 0.2;
      }

      // Ensure score is in range
      score = Math.max(0, Math.min(1, score));
    }

    return {
      score,
      issues,
      recommendations,
      coverage: {
        filesWithSymbols: filesWithSymbols.length,
        totalFiles: index.files.length,
        avgSymbolsPerFile: avgSymbols,
      },
    };
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  /**
   * Persist the index to disk.
   *
   * @param index - The code index to persist
   * @param indexPath - Path where to save the index
   */
  async persistIndex(index: CodeIndex, indexPath: string): Promise<void> {
    // Ensure parent directory exists
    const dir = path.dirname(indexPath);
    await fs.mkdir(dir, { recursive: true });

    // Write index as JSON
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));

    if (this.verbose) {
      console.log(`[SelfIndexPipeline] Index persisted to ${indexPath}`);
    }
  }

  /**
   * Load an index from disk.
   *
   * @param indexPath - Path to the index file
   * @returns The loaded code index
   */
  async loadIndex(indexPath: string): Promise<CodeIndex> {
    const content = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(content) as CodeIndex;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Validate the configuration.
   */
  private async validateConfig(config: SelfIndexConfig): Promise<void> {
    if (!config.rootDir) {
      throw new Error('rootDir is required for self-indexing');
    }

    if (config.maxFiles < 0) {
      throw new Error('maxFiles must be a positive number');
    }

    // Check rootDir exists
    try {
      await fs.access(config.rootDir);
    } catch {
      throw new Error(`rootDir does not exist: ${config.rootDir}`);
    }
  }

  /**
   * Update progress and notify callback.
   */
  private updateProgress(progress: IndexProgress): void {
    this.currentProgress = progress;
    this.onProgress?.(progress);
  }

  /**
   * Build a CodeIndex from storage data.
   */
  private async buildCodeIndexFromStorage(): Promise<CodeIndex> {
    const functions = await this.storage.getFunctions({ limit: 10000 });
    const modules = await this.storage.getModules({ limit: 10000 });

    // Group functions by file
    const fileMap = new Map<string, SymbolInfo[]>();

    for (const fn of functions) {
      const symbols = fileMap.get(fn.filePath) ?? [];
      symbols.push({
        name: fn.name,
        kind: 'function',
        line: fn.startLine ?? 1,
        endLine: fn.endLine,
        signature: fn.signature,
      });
      fileMap.set(fn.filePath, symbols);
    }

    // Ensure all modules are represented
    for (const mod of modules) {
      if (!fileMap.has(mod.path)) {
        fileMap.set(mod.path, []);
      }
    }

    // Build file index entries
    const files: FileIndex[] = [];
    let totalSymbols = 0;

    for (const [filePath, symbols] of fileMap) {
      files.push({
        filePath,
        symbols,
        checksum: '', // Not available from storage
        indexedAt: new Date().toISOString(),
      });
      totalSymbols += symbols.length;
    }

    return {
      files,
      totalSymbols,
      createdAt: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SelfIndexPipeline with the given options.
 *
 * @param options - Pipeline options
 * @returns Configured SelfIndexPipeline instance
 */
export function createSelfIndexPipeline(
  options: SelfIndexPipelineOptions
): SelfIndexPipeline {
  return new SelfIndexPipeline(options);
}
