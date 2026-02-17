/**
 * @fileoverview Durability Classification System
 *
 * Classifies files by their change frequency to optimize revalidation:
 * - IMMUTABLE: Never revalidate (node_modules, .git, vendored code)
 * - STABLE: Batch validate (unchanged for 24h+)
 * - VOLATILE: Priority validate (recently edited)
 *
 * Inspired by rust-analyzer's Salsa framework "durability" concept.
 * Research (RESEARCH-META-002) found this can skip ~70% of unnecessary revalidation.
 *
 * @packageDocumentation
 */

import { Minimatch } from 'minimatch';

// ============================================================================
// PERFORMANCE OPTIMIZATIONS
// ============================================================================

/**
 * `minimatch()` is relatively expensive when called repeatedly. Durability checks
 * happen on hot paths (e.g., batch classification during indexing), so we:
 * - fast-path the default immutable patterns using string checks
 * - cache compiled minimatch patterns for non-default/custom configs
 */

const DEFAULT_IMMUTABLE_BASENAMES = new Set<string>([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
]);

const DEFAULT_IMMUTABLE_PREFIX_MARKERS = [
  'node_modules/',
  '.git/',
  'vendor/',
  'dist/',
  'build/',
  '.pnpm/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.next/',
  '.nuxt/',
  'coverage/',
  '.nyc_output/',
] as const;

const DEFAULT_IMMUTABLE_DIR_MARKERS = [
  '/node_modules/',
  '/.git/',
  '/vendor/',
  '/dist/',
  '/build/',
  '/.pnpm/',
  '/.venv/',
  '/venv/',
  '/__pycache__/',
  '/.next/',
  '/.nuxt/',
  '/coverage/',
  '/.nyc_output/',
] as const;

function matchesDefaultImmutablePath(normalizedPath: string): boolean {
  const lastSlash = normalizedPath.lastIndexOf('/');
  const basename = lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);

  if (DEFAULT_IMMUTABLE_BASENAMES.has(basename)) return true;
  if (basename.endsWith('.lock')) return true;

  for (const marker of DEFAULT_IMMUTABLE_PREFIX_MARKERS) {
    if (normalizedPath.startsWith(marker)) return true;
  }
  for (const marker of DEFAULT_IMMUTABLE_DIR_MARKERS) {
    if (normalizedPath.includes(marker)) return true;
  }

  return false;
}

const compiledPatternCache = new WeakMap<string[], Minimatch[]>();

function getCompiledPatterns(patterns: string[]): Minimatch[] {
  const cached = compiledPatternCache.get(patterns);
  if (cached) return cached;

  const compiled = patterns.map((pattern) => new Minimatch(pattern, { dot: true }));
  compiledPatternCache.set(patterns, compiled);
  return compiled;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Durability classification for a file based on its change frequency.
 *
 * - IMMUTABLE: Files that never change during normal development
 * - STABLE: Files that haven't been modified recently (batch validation)
 * - VOLATILE: Recently edited files (priority validation)
 */
export enum FileDurability {
  IMMUTABLE = 'immutable',
  STABLE = 'stable',
  VOLATILE = 'volatile',
}

/**
 * Configuration for durability classification.
 */
export interface DurabilityConfig {
  /** Glob patterns for files that should never be revalidated */
  immutablePatterns: string[];
  /** Hours since last modification to consider a file stable */
  stableThresholdHours: number;
  /** Minutes since last edit to keep a file as volatile */
  volatileThresholdMinutes: number;
}

/**
 * Statistics tracking durability classification results.
 */
export interface DurabilityStats {
  /** Count of files by durability classification */
  byDurability: Record<FileDurability, number>;
  /** Number of immutable files skipped from revalidation */
  skippedImmutable: number;
  /** Number of stable files batched for later revalidation */
  batchedStable: number;
  /** Number of volatile files prioritized for immediate revalidation */
  prioritizedVolatile: number;
}

/**
 * Revalidation decision for a file.
 */
export interface RevalidationDecision {
  /** Whether the file should be revalidated */
  shouldRevalidate: boolean;
  /** Reason for the decision */
  reason: string;
  /** Priority level (higher = more urgent, 0 = skip) */
  priority: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default durability configuration with sensible defaults.
 *
 * Immutable patterns include common directories that never change during development.
 * Stable threshold is 24 hours (files unchanged for a day are likely stable).
 * Volatile threshold is 30 minutes (recently edited files need priority).
 */
export const DEFAULT_DURABILITY_CONFIG: DurabilityConfig = {
  immutablePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/vendor/**',
    '**/dist/**',
    '**/build/**',
    '**/*.lock',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/.pnpm/**',
    '**/Cargo.lock',
    '**/Gemfile.lock',
    '**/poetry.lock',
    '**/Pipfile.lock',
    '**/composer.lock',
    '**/go.sum',
    '**/.venv/**',
    '**/venv/**',
    '**/node_modules/.cache/**',
    '**/__pycache__/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/coverage/**',
    '**/.nyc_output/**',
  ],
  stableThresholdHours: 24,
  volatileThresholdMinutes: 30,
};

// ============================================================================
// PRIORITY CONSTANTS
// ============================================================================

/**
 * Priority levels for revalidation scheduling.
 * Higher values indicate more urgent revalidation needs.
 */
export const REVALIDATION_PRIORITY = {
  /** Immutable files: no revalidation needed */
  IMMUTABLE: 0,
  /** Stable files: batch validation, low priority */
  STABLE: 1,
  /** Volatile files: immediate validation, high priority */
  VOLATILE: 10,
} as const;

// ============================================================================
// CORE CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Classify a file's durability based on its path and last modification time.
 *
 * Classification order:
 * 1. Check immutable patterns first (path-based, instant)
 * 2. Check if recently modified (volatile)
 * 3. Check if unchanged for a long time (stable)
 * 4. Default to volatile if unable to determine
 *
 * @param filePath - Path to the file (absolute or relative)
 * @param lastModified - Date when the file was last modified
 * @param config - Optional durability configuration
 * @param now - Current time (for testing)
 * @returns The durability classification
 *
 * @example
 * ```typescript
 * // Classify a node_modules file
 * const durability = classifyDurability(
 *   'node_modules/lodash/index.js',
 *   new Date()
 * );
 * console.log(durability); // FileDurability.IMMUTABLE
 *
 * // Classify a recently edited source file
 * const durability2 = classifyDurability(
 *   'src/index.ts',
 *   new Date() // just modified
 * );
 * console.log(durability2); // FileDurability.VOLATILE
 * ```
 */
export function classifyDurability(
  filePath: string,
  lastModified: Date,
  config?: DurabilityConfig,
  now?: Date
): FileDurability {
  const cfg = config ?? DEFAULT_DURABILITY_CONFIG;
  const currentTime = now ?? new Date();

  // 1. Check immutable patterns first (path-based, instant)
  if (isImmutablePath(filePath, cfg.immutablePatterns)) {
    return FileDurability.IMMUTABLE;
  }

  // 2. Calculate time since last modification
  const timeSinceModified = currentTime.getTime() - lastModified.getTime();
  const hoursSinceModified = timeSinceModified / (1000 * 60 * 60);
  const minutesSinceModified = timeSinceModified / (1000 * 60);

  // 3. Check if recently modified (volatile)
  if (minutesSinceModified < cfg.volatileThresholdMinutes) {
    return FileDurability.VOLATILE;
  }

  // 4. Check if unchanged for a long time (stable)
  if (hoursSinceModified >= cfg.stableThresholdHours) {
    return FileDurability.STABLE;
  }

  // 5. Default to volatile for files in the "middle" (between volatile and stable thresholds)
  // These are files that were modified recently but not "just now"
  return FileDurability.VOLATILE;
}

/**
 * Check if a path matches any of the immutable patterns.
 *
 * @param filePath - Path to check
 * @param patterns - Glob patterns for immutable files
 * @returns True if the path is immutable
 */
export function isImmutablePath(filePath: string, patterns: string[]): boolean {
  // Normalize path separators for cross-platform compatibility
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Fast-path the default immutable patterns: avoids running minimatch for the
  // overwhelmingly common case of regular source files.
  if (patterns === DEFAULT_DURABILITY_CONFIG.immutablePatterns) {
    return matchesDefaultImmutablePath(normalizedPath);
  }

  // Fall back to minimatch semantics for custom patterns/configs, but cache
  // compilation to avoid re-parsing globs on every call.
  const compiled = getCompiledPatterns(patterns);
  for (const matcher of compiled) {
    if (matcher.match(normalizedPath)) return true;
  }
  return false;
}

// ============================================================================
// REVALIDATION FUNCTIONS
// ============================================================================

/**
 * Determine if a file should be revalidated based on its durability.
 *
 * @param durability - The file's durability classification
 * @param lastValidated - When the file was last validated (null if never)
 * @param now - Current time (for testing)
 * @returns True if the file should be revalidated
 *
 * @example
 * ```typescript
 * // Immutable files never need revalidation
 * shouldRevalidate(FileDurability.IMMUTABLE, null); // false
 *
 * // Volatile files always need revalidation if stale
 * shouldRevalidate(FileDurability.VOLATILE, null); // true
 * ```
 */
export function shouldRevalidate(
  durability: FileDurability,
  lastValidated: Date | null,
  now?: Date
): boolean {
  // Immutable files never need revalidation
  if (durability === FileDurability.IMMUTABLE) {
    return false;
  }

  // Never validated - needs validation
  if (lastValidated === null) {
    return true;
  }

  const currentTime = now ?? new Date();
  const timeSinceValidation = currentTime.getTime() - lastValidated.getTime();
  const hoursSinceValidation = timeSinceValidation / (1000 * 60 * 60);

  // Volatile files should be revalidated more frequently
  if (durability === FileDurability.VOLATILE) {
    // Revalidate if more than 5 minutes since last validation
    return timeSinceValidation > 5 * 60 * 1000;
  }

  // Stable files can be revalidated less frequently
  if (durability === FileDurability.STABLE) {
    // Revalidate if more than 1 hour since last validation
    return hoursSinceValidation > 1;
  }

  // Default to revalidate
  return true;
}

/**
 * Get the revalidation priority for a file based on its durability.
 * Higher priority values indicate more urgent revalidation needs.
 *
 * @param durability - The file's durability classification
 * @returns Priority level (0 = skip, 1 = low, 10 = high)
 *
 * @example
 * ```typescript
 * getRevalidationPriority(FileDurability.IMMUTABLE); // 0
 * getRevalidationPriority(FileDurability.STABLE);    // 1
 * getRevalidationPriority(FileDurability.VOLATILE);  // 10
 * ```
 */
export function getRevalidationPriority(durability: FileDurability): number {
  switch (durability) {
    case FileDurability.IMMUTABLE:
      return REVALIDATION_PRIORITY.IMMUTABLE;
    case FileDurability.STABLE:
      return REVALIDATION_PRIORITY.STABLE;
    case FileDurability.VOLATILE:
      return REVALIDATION_PRIORITY.VOLATILE;
    default:
      // Exhaustive check
      const _exhaustive: never = durability;
      return REVALIDATION_PRIORITY.VOLATILE;
  }
}

/**
 * Get a full revalidation decision for a file.
 *
 * @param filePath - Path to the file
 * @param lastModified - When the file was last modified
 * @param lastValidated - When the file was last validated (null if never)
 * @param config - Optional durability configuration
 * @param now - Current time (for testing)
 * @returns Full revalidation decision with reason
 */
export function getRevalidationDecision(
  filePath: string,
  lastModified: Date,
  lastValidated: Date | null,
  config?: DurabilityConfig,
  now?: Date
): RevalidationDecision {
  const durability = classifyDurability(filePath, lastModified, config, now);
  const shouldRevalidateFile = shouldRevalidate(durability, lastValidated, now);
  const priority = getRevalidationPriority(durability);

  let reason: string;
  if (durability === FileDurability.IMMUTABLE) {
    reason = 'File is immutable (matches immutable pattern)';
  } else if (!shouldRevalidateFile && lastValidated) {
    reason = `File is ${durability}, recently validated`;
  } else if (lastValidated === null) {
    reason = 'File has never been validated';
  } else if (durability === FileDurability.VOLATILE) {
    reason = 'File is volatile (recently modified)';
  } else {
    reason = 'File is stable (unchanged for 24+ hours)';
  }

  return {
    shouldRevalidate: shouldRevalidateFile,
    reason,
    priority,
  };
}

// ============================================================================
// STATISTICS TRACKING
// ============================================================================

/**
 * Create empty durability statistics.
 */
export function createEmptyStats(): DurabilityStats {
  return {
    byDurability: {
      [FileDurability.IMMUTABLE]: 0,
      [FileDurability.STABLE]: 0,
      [FileDurability.VOLATILE]: 0,
    },
    skippedImmutable: 0,
    batchedStable: 0,
    prioritizedVolatile: 0,
  };
}

/**
 * Update statistics based on a file's durability classification.
 *
 * @param stats - Current statistics (mutated in place)
 * @param durability - The file's durability classification
 * @param wasRevalidated - Whether the file was actually revalidated
 */
export function updateStats(
  stats: DurabilityStats,
  durability: FileDurability,
  wasRevalidated: boolean
): void {
  stats.byDurability[durability]++;

  if (durability === FileDurability.IMMUTABLE) {
    stats.skippedImmutable++;
  } else if (durability === FileDurability.STABLE && !wasRevalidated) {
    stats.batchedStable++;
  } else if (durability === FileDurability.VOLATILE && wasRevalidated) {
    stats.prioritizedVolatile++;
  }
}

/**
 * Calculate the percentage of files skipped due to durability classification.
 *
 * @param stats - Current statistics
 * @returns Percentage of files skipped (0-100)
 */
export function calculateSkipPercentage(stats: DurabilityStats): number {
  const total = Object.values(stats.byDurability).reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;

  const skipped = stats.skippedImmutable + stats.batchedStable;
  return (skipped / total) * 100;
}

// ============================================================================
// BATCH CLASSIFICATION
// ============================================================================

/**
 * File information for batch classification.
 */
export interface FileInfo {
  /** Path to the file */
  path: string;
  /** Last modification time */
  lastModified: Date;
  /** Last validation time (null if never validated) */
  lastValidated: Date | null;
}

/**
 * Result of batch classification.
 */
export interface BatchClassificationResult {
  /** Files to skip (immutable) */
  skip: string[];
  /** Files to batch process (stable) */
  batch: string[];
  /** Files to process immediately (volatile) */
  priority: string[];
  /** Statistics about the classification */
  stats: DurabilityStats;
}

/**
 * Classify multiple files and sort them into revalidation buckets.
 *
 * @param files - Array of file information
 * @param config - Optional durability configuration
 * @param now - Current time (for testing)
 * @returns Classification result with files sorted into buckets
 *
 * @example
 * ```typescript
 * const files = [
 *   { path: 'node_modules/lodash/index.js', lastModified: new Date(), lastValidated: null },
 *   { path: 'src/index.ts', lastModified: new Date(), lastValidated: null },
 * ];
 *
 * const result = classifyBatch(files);
 * console.log(result.skip);     // ['node_modules/lodash/index.js']
 * console.log(result.priority); // ['src/index.ts']
 * ```
 */
export function classifyBatch(
  files: FileInfo[],
  config?: DurabilityConfig,
  now?: Date
): BatchClassificationResult {
  const stats = createEmptyStats();
  const skip: string[] = [];
  const batch: string[] = [];
  const priority: string[] = [];

  // Avoid per-file `new Date()` allocations and ensure consistent classification
  // across a batch.
  const currentTime = now ?? new Date();

  for (const file of files) {
    const durability = classifyDurability(file.path, file.lastModified, config, currentTime);
    const shouldRevalidateFile = shouldRevalidate(durability, file.lastValidated, currentTime);

    updateStats(stats, durability, shouldRevalidateFile);

    if (durability === FileDurability.IMMUTABLE) {
      skip.push(file.path);
    } else if (durability === FileDurability.STABLE && !shouldRevalidateFile) {
      batch.push(file.path);
    } else {
      priority.push(file.path);
    }
  }

  return { skip, batch, priority, stats };
}

// ============================================================================
// DURABILITY TRACKER CLASS
// ============================================================================

/**
 * Tracks durability classifications and provides revalidation scheduling.
 *
 * This class maintains state about file durability and provides methods
 * for batch processing and statistics tracking.
 *
 * @example
 * ```typescript
 * const tracker = new DurabilityTracker();
 *
 * // Classify files
 * const decision = tracker.classify('src/index.ts', new Date(), null);
 * console.log(decision);
 *
 * // Get statistics
 * console.log(tracker.getStats());
 *
 * // Get next batch of files to process
 * const nextBatch = tracker.getNextBatch();
 * ```
 */
export class DurabilityTracker {
  private config: DurabilityConfig;
  private stats: DurabilityStats;
  private classifications: Map<string, FileDurability> = new Map();
  private lastValidated: Map<string, Date> = new Map();

  constructor(config?: DurabilityConfig) {
    this.config = config ?? DEFAULT_DURABILITY_CONFIG;
    this.stats = createEmptyStats();
  }

  /**
   * Classify a file and track its durability.
   *
   * @param filePath - Path to the file
   * @param lastModified - When the file was last modified
   * @param lastValidatedTime - When the file was last validated
   * @param now - Current time (for testing)
   * @returns Revalidation decision
   */
  classify(
    filePath: string,
    lastModified: Date,
    lastValidatedTime: Date | null,
    now?: Date
  ): RevalidationDecision {
    const durability = classifyDurability(filePath, lastModified, this.config, now);
    const shouldRevalidateFile = shouldRevalidate(durability, lastValidatedTime, now);

    // Track the classification
    this.classifications.set(filePath, durability);
    if (lastValidatedTime) {
      this.lastValidated.set(filePath, lastValidatedTime);
    }

    // Update statistics
    updateStats(this.stats, durability, shouldRevalidateFile);

    return getRevalidationDecision(filePath, lastModified, lastValidatedTime, this.config, now);
  }

  /**
   * Mark a file as validated at the current time.
   *
   * @param filePath - Path to the file
   * @param now - Validation time (defaults to current time)
   */
  markValidated(filePath: string, now?: Date): void {
    this.lastValidated.set(filePath, now ?? new Date());
  }

  /**
   * Get the current durability statistics.
   */
  getStats(): DurabilityStats {
    return { ...this.stats };
  }

  /**
   * Get the durability classification for a specific file.
   *
   * @param filePath - Path to the file
   * @returns Durability classification, or undefined if not classified
   */
  getDurability(filePath: string): FileDurability | undefined {
    return this.classifications.get(filePath);
  }

  /**
   * Reset all statistics and classifications.
   */
  reset(): void {
    this.stats = createEmptyStats();
    this.classifications.clear();
    this.lastValidated.clear();
  }

  /**
   * Get all files of a specific durability level.
   *
   * @param durability - Durability level to filter by
   * @returns Array of file paths
   */
  getFilesByDurability(durability: FileDurability): string[] {
    const files: string[] = [];
    for (const [path, classification] of this.classifications) {
      if (classification === durability) {
        files.push(path);
      }
    }
    return files;
  }

  /**
   * Update the configuration.
   *
   * @param config - New configuration (merged with current)
   */
  updateConfig(config: Partial<DurabilityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): DurabilityConfig {
    return { ...this.config };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new DurabilityTracker instance.
 *
 * @param config - Optional configuration
 * @returns New DurabilityTracker instance
 */
export function createDurabilityTracker(config?: DurabilityConfig): DurabilityTracker {
  return new DurabilityTracker(config);
}
