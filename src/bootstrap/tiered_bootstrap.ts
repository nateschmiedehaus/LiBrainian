/**
 * @fileoverview Tiered Bootstrap System for Fast Startup
 *
 * Implements progressive bootstrap that provides immediate partial functionality
 * while full indexing completes in the background.
 *
 * Tiers:
 * - Tier 0 (IMMEDIATE, <5s): Directory scan, file classification, basic file index
 * - Tier 1 (FAST, <30s): Entry points, symbol extraction, import graph skeleton
 * - Tier 2 (FULL, unbounded): Deep analysis, patterns, relationships, full features
 *
 * @packageDocumentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { createHash } from 'crypto';
import type { LibrarianStorage } from '../storage/types.js';
import type { FileKnowledge, DirectoryKnowledge } from '../types.js';
import { UNIVERSAL_EXCLUDES, getFileCategory, type FileCategory } from '../universal_patterns.js';

/**
 * Map FileCategory from universal_patterns to FileKnowledge.category.
 * The types have some differences: 'tests' -> 'test', 'scripts'/'infra'/'ci'/'meta'/'styles' -> 'other'
 */
function mapToFileKnowledgeCategory(
  category: FileCategory
): FileKnowledge['category'] {
  switch (category) {
    case 'code':
      return 'code';
    case 'docs':
      return 'docs';
    case 'config':
      return 'config';
    case 'tests':
      return 'test';
    case 'schema':
      return 'schema';
    case 'data':
      return 'data';
    default:
      return 'other';
  }
}

// ============================================================================
// TYPES AND ENUMS
// ============================================================================

/**
 * Bootstrap tiers representing progressive levels of functionality.
 */
export enum BootstrapTier {
  /** No bootstrap completed */
  NONE = 0,
  /** File listing, basic search - target < 5 seconds */
  IMMEDIATE = 1,
  /** Symbols, import graph skeleton - target < 30 seconds */
  FAST = 2,
  /** Complete analysis, all features */
  FULL = 3,
}

/**
 * Feature constants for capability checking.
 */
export const FEATURES = {
  FILE_SEARCH: 'file_search',
  BASIC_NAVIGATION: 'basic_navigation',
  SYMBOL_SEARCH: 'symbol_search',
  GO_TO_DEFINITION: 'go_to_definition',
  IMPORT_GRAPH: 'import_graph',
  FULL_ANALYSIS: 'full_analysis',
  PATTERN_DETECTION: 'pattern_detection',
  ARCHITECTURE_ANALYSIS: 'architecture_analysis',
} as const;

export type FeatureId = (typeof FEATURES)[keyof typeof FEATURES];

/**
 * Features enabled at each tier.
 */
export const TIER_FEATURES: Record<BootstrapTier, Set<FeatureId>> = {
  [BootstrapTier.NONE]: new Set(),
  [BootstrapTier.IMMEDIATE]: new Set([
    FEATURES.FILE_SEARCH,
    FEATURES.BASIC_NAVIGATION,
  ]),
  [BootstrapTier.FAST]: new Set([
    FEATURES.FILE_SEARCH,
    FEATURES.BASIC_NAVIGATION,
    FEATURES.SYMBOL_SEARCH,
    FEATURES.GO_TO_DEFINITION,
    FEATURES.IMPORT_GRAPH,
  ]),
  [BootstrapTier.FULL]: new Set([
    FEATURES.FILE_SEARCH,
    FEATURES.BASIC_NAVIGATION,
    FEATURES.SYMBOL_SEARCH,
    FEATURES.GO_TO_DEFINITION,
    FEATURES.IMPORT_GRAPH,
    FEATURES.FULL_ANALYSIS,
    FEATURES.PATTERN_DETECTION,
    FEATURES.ARCHITECTURE_ANALYSIS,
  ]),
};

/**
 * Statistics for a completed tier.
 */
export interface TierStats {
  /** The completed tier */
  tier: BootstrapTier;
  /** Number of files processed in this tier */
  filesProcessed: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Features enabled after this tier */
  enabledFeatures: string[];
  /** Additional metrics specific to the tier */
  metrics?: Record<string, number>;
}

/**
 * Options for tiered bootstrap.
 */
export interface TieredBootstrapOptions {
  /** Root path of the workspace */
  rootPath: string;
  /** Storage backend */
  storage: LibrarianStorage;
  /** Callback when a tier completes */
  onTierComplete?: (tier: BootstrapTier, stats: TierStats) => void;
  /** Progress callback */
  onProgress?: (tier: BootstrapTier, progress: number) => void;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Include patterns for file discovery */
  includePatterns?: string[];
  /** Exclude patterns for file discovery */
  excludePatterns?: string[];
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSizeBytes?: number;
  /** Time budget for Tier 0 in ms (default: 5000) */
  tier0TimeoutMs?: number;
  /** Time budget for Tier 1 in ms (default: 30000) */
  tier1TimeoutMs?: number;
}

/**
 * Current bootstrap status.
 */
export interface BootstrapStatus {
  /** Current completed tier */
  currentTier: BootstrapTier;
  /** Whether all tiers are complete */
  isComplete: boolean;
  /** Statistics for each completed tier */
  tierStats: Map<BootstrapTier, TierStats>;
  /** Currently enabled features */
  enabledFeatures: Set<string>;
  /** Whether bootstrap is in progress */
  inProgress: boolean;
  /** Error if bootstrap failed */
  error?: Error;
}

/**
 * Discovered file information from Tier 0.
 */
export interface DiscoveredFile {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  category: FileKnowledge['category'];
  sizeBytes: number;
}

/**
 * Extracted symbol from Tier 1.
 */
export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum';
  filePath: string;
  line: number;
  isExported: boolean;
}

/**
 * Import edge from Tier 1.
 */
export interface ImportEdge {
  sourceFile: string;
  targetFile: string;
  importedNames: string[];
}

// ============================================================================
// TIERED BOOTSTRAP CLASS
// ============================================================================

/**
 * Tiered Bootstrap implementation for progressive initialization.
 */
export class TieredBootstrap {
  private readonly rootPath: string;
  private readonly storage: LibrarianStorage;
  private readonly options: Required<
    Pick<
      TieredBootstrapOptions,
      | 'includePatterns'
      | 'excludePatterns'
      | 'maxFileSizeBytes'
      | 'tier0TimeoutMs'
      | 'tier1TimeoutMs'
    >
  > &
    Pick<TieredBootstrapOptions, 'onTierComplete' | 'onProgress' | 'abortSignal'>;

  private currentTier: BootstrapTier = BootstrapTier.NONE;
  private tierStats: Map<BootstrapTier, TierStats> = new Map();
  private enabledFeatures: Set<string> = new Set();
  private inProgress = false;
  private aborted = false;
  private error?: Error;

  // Tier completion promises for waitForTier
  private tierPromises: Map<BootstrapTier, Promise<void>> = new Map();
  private tierResolvers: Map<BootstrapTier, () => void> = new Map();

  // Discovered data
  private discoveredFiles: DiscoveredFile[] = [];
  private extractedSymbols: ExtractedSymbol[] = [];
  private importEdges: ImportEdge[] = [];

  constructor(options: TieredBootstrapOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.storage = options.storage;
    this.options = {
      onTierComplete: options.onTierComplete,
      onProgress: options.onProgress,
      abortSignal: options.abortSignal,
      includePatterns: options.includePatterns ?? ['**/*'],
      excludePatterns: options.excludePatterns ?? UNIVERSAL_EXCLUDES,
      maxFileSizeBytes: options.maxFileSizeBytes ?? 1024 * 1024, // 1MB
      tier0TimeoutMs: options.tier0TimeoutMs ?? 5000,
      tier1TimeoutMs: options.tier1TimeoutMs ?? 30000,
    };

    // Set up tier promises
    for (const tier of [
      BootstrapTier.IMMEDIATE,
      BootstrapTier.FAST,
      BootstrapTier.FULL,
    ]) {
      this.tierPromises.set(
        tier,
        new Promise<void>((resolve) => {
          this.tierResolvers.set(tier, resolve);
        })
      );
    }

    // Handle abort signal
    if (this.options.abortSignal) {
      this.options.abortSignal.addEventListener('abort', () => {
        this.aborted = true;
      });
    }
  }

  /**
   * Start the tiered bootstrap process.
   * Runs tiers sequentially: IMMEDIATE -> FAST -> FULL
   */
  async start(): Promise<void> {
    if (this.inProgress) {
      throw new Error('Bootstrap already in progress');
    }

    this.inProgress = true;
    this.aborted = false;
    this.error = undefined;

    try {
      // Tier 0: Immediate
      await this.runTier0();
      if (this.aborted) return;

      // Tier 1: Fast
      await this.runTier1();
      if (this.aborted) return;

      // Tier 2: Full
      await this.runTier2();
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
      throw this.error;
    } finally {
      this.inProgress = false;
    }
  }

  /**
   * Get current bootstrap status.
   */
  getStatus(): BootstrapStatus {
    return {
      currentTier: this.currentTier,
      isComplete: this.currentTier === BootstrapTier.FULL,
      tierStats: new Map(this.tierStats),
      enabledFeatures: new Set(this.enabledFeatures),
      inProgress: this.inProgress,
      error: this.error,
    };
  }

  /**
   * Check if a feature is currently enabled.
   */
  isFeatureEnabled(feature: string): boolean {
    return this.enabledFeatures.has(feature);
  }

  /**
   * Wait for a specific tier to complete.
   */
  async waitForTier(tier: BootstrapTier): Promise<void> {
    if (tier === BootstrapTier.NONE) return;
    if (this.currentTier >= tier) return;

    const promise = this.tierPromises.get(tier);
    if (!promise) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    await promise;
  }

  /**
   * Abort the bootstrap process.
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Get discovered files (available after Tier 0).
   */
  getDiscoveredFiles(): readonly DiscoveredFile[] {
    return this.discoveredFiles;
  }

  /**
   * Get extracted symbols (available after Tier 1).
   */
  getExtractedSymbols(): readonly ExtractedSymbol[] {
    return this.extractedSymbols;
  }

  /**
   * Get import graph edges (available after Tier 1).
   */
  getImportEdges(): readonly ImportEdge[] {
    return this.importEdges;
  }

  // ============================================================================
  // TIER IMPLEMENTATIONS
  // ============================================================================

  /**
   * Tier 0: Immediate - Fast directory scan and file classification.
   * Target: < 5 seconds
   */
  private async runTier0(): Promise<void> {
    const startTime = Date.now();
    const deadline = startTime + this.options.tier0TimeoutMs;

    this.options.onProgress?.(BootstrapTier.IMMEDIATE, 0);

    // Fast file discovery using glob
    const files = await glob(this.options.includePatterns, {
      cwd: this.rootPath,
      ignore: this.options.excludePatterns,
      absolute: false,
      nodir: true,
      follow: false,
    });

    if (this.aborted) return;

    this.options.onProgress?.(BootstrapTier.IMMEDIATE, 0.3);

    // Process files with stat calls (batched for performance)
    const batchSize = 100;
    const fileKnowledgeItems: FileKnowledge[] = [];
    const directorySet = new Set<string>();

    for (let i = 0; i < files.length; i += batchSize) {
      if (this.aborted) return;

      // Check deadline
      if (Date.now() > deadline) {
        // Store what we have so far
        break;
      }

      const batch = files.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (relativePath) => {
          try {
            const absolutePath = path.join(this.rootPath, relativePath);
            const stats = await fs.stat(absolutePath);
            const ext = path.extname(relativePath);
            const name = path.basename(relativePath);
            const dir = path.dirname(relativePath);

            if (dir !== '.') {
              directorySet.add(dir);
            }

            const discovered: DiscoveredFile = {
              path: absolutePath,
              relativePath,
              name,
              extension: ext,
              category: mapToFileKnowledgeCategory(getFileCategory(relativePath)),
              sizeBytes: stats.size,
            };

            this.discoveredFiles.push(discovered);

            // Create minimal FileKnowledge for storage
            const fileKnowledge: FileKnowledge = {
              id: createFileId(relativePath),
              path: absolutePath,
              relativePath,
              name,
              extension: ext,
              category: discovered.category,
              purpose: '', // Will be filled in later tiers
              role: '',
              summary: '',
              keyExports: [],
              mainConcepts: [],
              lineCount: 0,
              functionCount: 0,
              classCount: 0,
              importCount: 0,
              exportCount: 0,
              imports: [],
              importedBy: [],
              directory: dir,
              complexity: 'low',
              hasTests: false,
              checksum: '',
              confidence: 0.3, // Low confidence for Tier 0
              lastIndexed: new Date().toISOString(),
              lastModified: stats.mtime.toISOString(),
            };

            return fileKnowledge;
          } catch {
            return null;
          }
        })
      );

      fileKnowledgeItems.push(
        ...results.filter((r): r is FileKnowledge => r !== null)
      );

      this.options.onProgress?.(
        BootstrapTier.IMMEDIATE,
        0.3 + 0.5 * (Math.min(i + batchSize, files.length) / files.length)
      );
    }

    if (this.aborted) return;

    // Store file knowledge
    if (fileKnowledgeItems.length > 0) {
      await this.storage.upsertFiles(fileKnowledgeItems);
    }

    // Create directory knowledge
    const directoryKnowledgeItems: DirectoryKnowledge[] = [];
    for (const dir of directorySet) {
      const absolutePath = path.join(this.rootPath, dir);
      const dirFiles = fileKnowledgeItems.filter(
        (f) => f.directory === dir || f.relativePath.startsWith(dir + '/')
      );

      const dirKnowledge: DirectoryKnowledge = {
        id: createDirectoryId(dir),
        path: absolutePath,
        relativePath: dir,
        name: path.basename(dir),
        fingerprint: '',
        purpose: '',
        role: 'other',
        description: '',
        pattern: 'flat',
        depth: dir.split('/').length,
        fileCount: dirFiles.filter((f) => f.directory === dir).length,
        subdirectoryCount: 0,
        totalFiles: dirFiles.length,
        mainFiles: [],
        subdirectories: [],
        fileTypes: {},
        parent: path.dirname(dir) === '.' ? null : path.dirname(dir),
        siblings: [],
        relatedDirectories: [],
        hasReadme: dirFiles.some((f) => f.name.toLowerCase() === 'readme.md'),
        hasIndex: dirFiles.some(
          (f) => f.name === 'index.ts' || f.name === 'index.js'
        ),
        hasTests: dirFiles.some(
          (f) =>
            f.relativePath.includes('__tests__') ||
            f.name.includes('.test.') ||
            f.name.includes('.spec.')
        ),
        complexity: 'low',
        confidence: 0.3,
        lastIndexed: new Date().toISOString(),
      };

      directoryKnowledgeItems.push(dirKnowledge);
    }

    if (directoryKnowledgeItems.length > 0) {
      await this.storage.upsertDirectories(directoryKnowledgeItems);
    }

    this.options.onProgress?.(BootstrapTier.IMMEDIATE, 1.0);

    // Complete Tier 0
    const stats: TierStats = {
      tier: BootstrapTier.IMMEDIATE,
      filesProcessed: this.discoveredFiles.length,
      durationMs: Date.now() - startTime,
      enabledFeatures: Array.from(TIER_FEATURES[BootstrapTier.IMMEDIATE]),
      metrics: {
        directories: directorySet.size,
        totalSizeBytes: this.discoveredFiles.reduce(
          (sum, f) => sum + f.sizeBytes,
          0
        ),
      },
    };

    this.completeTier(BootstrapTier.IMMEDIATE, stats);
  }

  /**
   * Tier 1: Fast - Entry points, symbols, and import graph.
   * Target: < 30 seconds
   */
  private async runTier1(): Promise<void> {
    const startTime = Date.now();
    const deadline = startTime + this.options.tier1TimeoutMs;

    this.options.onProgress?.(BootstrapTier.FAST, 0);

    // Find entry points (package.json main/exports, index files)
    const entryPoints = await this.findEntryPoints();

    if (this.aborted) return;

    this.options.onProgress?.(BootstrapTier.FAST, 0.1);

    // Process source files for symbols and imports
    const sourceFiles = this.discoveredFiles.filter((f) =>
      ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.py', '.go', '.yaml', '.yml', '.json'].includes(f.extension)
    );

    // Prioritize entry points and limit for time budget
    const prioritizedFiles = this.prioritizeFiles(sourceFiles, entryPoints);
    const filesToProcess = prioritizedFiles.filter(
      (f) => f.sizeBytes <= this.options.maxFileSizeBytes
    );

    let processed = 0;
    const batchSize = 20;

    for (let i = 0; i < filesToProcess.length; i += batchSize) {
      if (this.aborted) return;

      // Check deadline
      if (Date.now() > deadline) {
        break;
      }

      const batch = filesToProcess.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (file) => {
          try {
            const content = await fs.readFile(file.path, 'utf8');
            const { symbols, imports } = this.extractSymbolsAndImports(
              content,
              file.path,
              file.relativePath
            );
            this.extractedSymbols.push(...symbols);
            this.importEdges.push(...imports);
            processed++;
          } catch {
            // Skip files that can't be read
          }
        })
      );

      this.options.onProgress?.(
        BootstrapTier.FAST,
        0.1 + 0.8 * (Math.min(i + batchSize, filesToProcess.length) / filesToProcess.length)
      );
    }

    if (this.aborted) return;

    // Update storage with symbol and import information
    await this.updateStorageWithTier1Data();

    this.options.onProgress?.(BootstrapTier.FAST, 1.0);

    // Complete Tier 1
    const stats: TierStats = {
      tier: BootstrapTier.FAST,
      filesProcessed: processed,
      durationMs: Date.now() - startTime,
      enabledFeatures: Array.from(TIER_FEATURES[BootstrapTier.FAST]),
      metrics: {
        symbolsExtracted: this.extractedSymbols.length,
        importEdges: this.importEdges.length,
        entryPoints: entryPoints.length,
      },
    };

    this.completeTier(BootstrapTier.FAST, stats);
  }

  /**
   * Tier 2: Full - Deep analysis and complete feature set.
   */
  private async runTier2(): Promise<void> {
    const startTime = Date.now();

    this.options.onProgress?.(BootstrapTier.FULL, 0);

    // Full analysis is delegated to the main bootstrap system
    // This tier primarily signals that we're ready for deep analysis
    // In practice, the main bootstrap will continue from here

    // For now, mark as complete with placeholder stats
    // The actual full bootstrap will handle deep analysis

    this.options.onProgress?.(BootstrapTier.FULL, 1.0);

    const stats: TierStats = {
      tier: BootstrapTier.FULL,
      filesProcessed: this.discoveredFiles.length,
      durationMs: Date.now() - startTime,
      enabledFeatures: Array.from(TIER_FEATURES[BootstrapTier.FULL]),
      metrics: {
        totalSymbols: this.extractedSymbols.length,
        totalImports: this.importEdges.length,
      },
    };

    this.completeTier(BootstrapTier.FULL, stats);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Complete a tier and update state.
   */
  private completeTier(tier: BootstrapTier, stats: TierStats): void {
    this.currentTier = tier;
    this.tierStats.set(tier, stats);

    // Enable features for this tier
    const tierFeatures = TIER_FEATURES[tier];
    for (const feature of tierFeatures) {
      this.enabledFeatures.add(feature);
    }

    // Resolve the tier promise
    const resolver = this.tierResolvers.get(tier);
    if (resolver) {
      resolver();
    }

    // Callback
    this.options.onTierComplete?.(tier, stats);
  }

  /**
   * Find entry points from package.json and common patterns.
   */
  private async findEntryPoints(): Promise<string[]> {
    const entryPoints: string[] = [];

    // Check package.json
    try {
      const packageJsonPath = path.join(this.rootPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(content);

      if (typeof pkg.main === 'string') {
        entryPoints.push(pkg.main);
      }

      if (typeof pkg.module === 'string') {
        entryPoints.push(pkg.module);
      }

      if (pkg.exports) {
        this.extractExportsEntryPoints(pkg.exports, entryPoints);
      }
    } catch {
      // No package.json or parse error
    }

    // Common index files
    const indexFiles = this.discoveredFiles.filter(
      (f) =>
        f.name === 'index.ts' ||
        f.name === 'index.js' ||
        f.name === 'main.ts' ||
        f.name === 'main.js'
    );
    entryPoints.push(...indexFiles.map((f) => f.relativePath));

    return [...new Set(entryPoints)];
  }

  /**
   * Extract entry points from package.json exports field.
   */
  private extractExportsEntryPoints(
    exports: unknown,
    result: string[]
  ): void {
    if (typeof exports === 'string') {
      result.push(exports);
    } else if (typeof exports === 'object' && exports !== null) {
      for (const value of Object.values(exports)) {
        this.extractExportsEntryPoints(value, result);
      }
    }
  }

  /**
   * Prioritize files for processing.
   */
  private prioritizeFiles(
    files: DiscoveredFile[],
    entryPoints: string[]
  ): DiscoveredFile[] {
    const entryPointSet = new Set(entryPoints.map((p) => p.replace(/^\.\//, '')));

    return [...files].sort((a, b) => {
      // Entry points first
      const aIsEntry = entryPointSet.has(a.relativePath);
      const bIsEntry = entryPointSet.has(b.relativePath);
      if (aIsEntry && !bIsEntry) return -1;
      if (!aIsEntry && bIsEntry) return 1;

      // Smaller files first (more likely to process before deadline)
      return a.sizeBytes - b.sizeBytes;
    });
  }

  /**
   * Extract symbols and imports from file content using regex.
   * This is a fast approximation - full AST parsing happens in Tier 2.
   */
  private extractSymbolsAndImports(
    content: string,
    absolutePath: string,
    relativePath: string
  ): { symbols: ExtractedSymbol[]; imports: ImportEdge[] } {
    const symbols: ExtractedSymbol[] = [];
    const imports: ImportEdge[] = [];
    const extension = path.extname(relativePath).toLowerCase();

    // Track exports
    const exportedNames = new Set<string>();

    // Find export statements
    const exportAllRegex = /export\s+\*/g;
    const exportNamedRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    const exportDefaultRegex = /export\s+default\s+(?:async\s+)?(?:function|class)\s*(\w*)/g;
    const exportFromRegex = /export\s+\{([^}]+)\}/g;

    let match: RegExpExecArray | null;

    while ((match = exportNamedRegex.exec(content)) !== null) {
      exportedNames.add(match[1]);
    }

    while ((match = exportFromRegex.exec(content)) !== null) {
      const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      names.forEach((n) => exportedNames.add(n));
    }

    const extractSymbol = (regex: RegExp, kind: ExtractedSymbol['kind'], isExportedDefault = false): void => {
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;
        const lineNumber = content.slice(0, match.index).split('\n').length;
        symbols.push({
          name,
          kind,
          filePath: absolutePath,
          line: lineNumber,
          isExported: isExportedDefault || exportedNames.has(name) || match[0].includes('export'),
        });
      }
    };

    if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(extension)) {
      extractSymbol(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, 'function');
      extractSymbol(/(?:export\s+)?class\s+(\w+)/g, 'class');
      extractSymbol(/(?:export\s+)?const\s+(\w+)/g, 'variable');
      extractSymbol(/(?:export\s+)?type\s+(\w+)/g, 'type');
      extractSymbol(/(?:export\s+)?interface\s+(\w+)/g, 'interface');
      extractSymbol(/(?:export\s+)?enum\s+(\w+)/g, 'enum');
    } else if (extension === '.py') {
      extractSymbol(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm, 'function', true);
      extractSymbol(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm, 'class', true);
    } else if (extension === '.go') {
      extractSymbol(/^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm, 'function', true);
      extractSymbol(/^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)\b/gm, 'type', true);
    } else if (extension === '.yaml' || extension === '.yml') {
      extractSymbol(/^([A-Za-z0-9_-]+):\s*(?:#.*)?$/gm, 'variable', true);
    } else if (extension === '.json') {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const key of Object.keys(parsed)) {
            symbols.push({
              name: key,
              kind: 'variable',
              filePath: absolutePath,
              line: 1,
              isExported: true,
            });
          }
        }
      } catch {
        // Keep tier-1 extraction resilient; malformed JSON gets no symbols.
      }
    }

    // Extract imports
    const importRegex = /import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(extension)) {
      while ((match = importRegex.exec(content)) !== null) {
        const namedImports = match[1]
          ? match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim())
          : [];
        const defaultImport = match[2] ? [match[2]] : [];
        const namespaceImport = match[3] ? [`* as ${match[3]}`] : [];
        const importPath = match[4];

        if (importPath.startsWith('.')) {
          const targetFile = this.resolveImportPath(relativePath, importPath);
          if (targetFile) {
            imports.push({
              sourceFile: relativePath,
              targetFile,
              importedNames: [...namedImports, ...defaultImport, ...namespaceImport],
            });
          }
        }
      }

      while ((match = dynamicImportRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          const targetFile = this.resolveImportPath(relativePath, importPath);
          if (targetFile) {
            imports.push({
              sourceFile: relativePath,
              targetFile,
              importedNames: ['*'],
            });
          }
        }
      }
    }

    return { symbols, imports };
  }

  /**
   * Resolve import path to actual file path.
   */
  private resolveImportPath(
    sourceRelativePath: string,
    importPath: string
  ): string | null {
    const sourceDir = path.dirname(sourceRelativePath);

    // Remove .js extension if present (TypeScript projects often use .js in imports)
    const cleanImportPath = importPath.replace(/\.js$/, '');
    let targetPath = path.join(sourceDir, cleanImportPath);

    // Normalize the path
    targetPath = path.normalize(targetPath);

    // Try various extensions - prioritize .ts over .js
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '/index.ts', '/index.js'];

    for (const ext of extensions) {
      const fullPath = targetPath + ext;
      const discovered = this.discoveredFiles.find(
        (f) => f.relativePath === fullPath
      );
      if (discovered) {
        return discovered.relativePath;
      }
    }

    // Also try with original path in case of non-.js extension
    const originalTargetPath = path.normalize(path.join(sourceDir, importPath));
    for (const ext of extensions) {
      const fullPath = originalTargetPath + ext;
      const discovered = this.discoveredFiles.find(
        (f) => f.relativePath === fullPath
      );
      if (discovered) {
        return discovered.relativePath;
      }
    }

    return null;
  }

  /**
   * Update storage with Tier 1 data.
   */
  private async updateStorageWithTier1Data(): Promise<void> {
    // Group symbols by file
    const symbolsByFile = new Map<string, ExtractedSymbol[]>();
    for (const symbol of this.extractedSymbols) {
      const existing = symbolsByFile.get(symbol.filePath) ?? [];
      existing.push(symbol);
      symbolsByFile.set(symbol.filePath, existing);
    }

    // Update file knowledge with symbol counts and exports
    const filesToUpdate: FileKnowledge[] = [];

    for (const [filePath, symbols] of symbolsByFile) {
      const existing = await this.storage.getFileByPath(filePath);
      if (existing) {
        const exportedSymbols = symbols.filter((s) => s.isExported);
        const updated: FileKnowledge = {
          ...existing,
          functionCount: symbols.filter((s) => s.kind === 'function').length,
          classCount: symbols.filter((s) => s.kind === 'class').length,
          exportCount: exportedSymbols.length,
          keyExports: exportedSymbols.slice(0, 10).map((s) => s.name),
          confidence: 0.5, // Increased confidence for Tier 1
        };
        filesToUpdate.push(updated);
      }
    }

    // Update import counts
    const importsBySource = new Map<string, ImportEdge[]>();
    for (const edge of this.importEdges) {
      const existing = importsBySource.get(edge.sourceFile) ?? [];
      existing.push(edge);
      importsBySource.set(edge.sourceFile, existing);
    }

    for (const [sourceFile, imports] of importsBySource) {
      const absolutePath = path.join(this.rootPath, sourceFile);
      const existingIdx = filesToUpdate.findIndex((f) => f.path === absolutePath);

      if (existingIdx >= 0) {
        filesToUpdate[existingIdx].importCount = imports.length;
        filesToUpdate[existingIdx].imports = imports.map((i) => i.targetFile);
      } else {
        const existing = await this.storage.getFileByPath(absolutePath);
        if (existing) {
          filesToUpdate.push({
            ...existing,
            importCount: imports.length,
            imports: imports.map((i) => i.targetFile),
            confidence: 0.5,
          });
        }
      }
    }

    // Update importedBy relationships
    const importsByTarget = new Map<string, string[]>();
    for (const edge of this.importEdges) {
      const existing = importsByTarget.get(edge.targetFile) ?? [];
      existing.push(edge.sourceFile);
      importsByTarget.set(edge.targetFile, existing);
    }

    for (const [targetFile, sources] of importsByTarget) {
      const absolutePath = path.join(this.rootPath, targetFile);
      const existingIdx = filesToUpdate.findIndex((f) => f.path === absolutePath);

      if (existingIdx >= 0) {
        filesToUpdate[existingIdx].importedBy = sources;
      } else {
        const existing = await this.storage.getFileByPath(absolutePath);
        if (existing) {
          filesToUpdate.push({
            ...existing,
            importedBy: sources,
            confidence: 0.5,
          });
        }
      }
    }

    // Batch update
    if (filesToUpdate.length > 0) {
      await this.storage.upsertFiles(filesToUpdate);
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a deterministic file ID from relative path.
 */
function createFileId(relativePath: string): string {
  return createHash('sha256').update(relativePath).digest('hex').slice(0, 16);
}

/**
 * Create a deterministic directory ID from relative path.
 */
function createDirectoryId(relativePath: string): string {
  return createHash('sha256')
    .update('dir:' + relativePath)
    .digest('hex')
    .slice(0, 16);
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a tiered bootstrap instance.
 */
export function createTieredBootstrap(
  options: TieredBootstrapOptions
): TieredBootstrap {
  return new TieredBootstrap(options);
}
