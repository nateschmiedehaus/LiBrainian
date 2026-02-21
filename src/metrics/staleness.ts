/**
 * @fileoverview Staleness Metrics and SLA Tracking for LiBrainian
 *
 * Provides time-based staleness tracking and SLA monitoring for indexed files.
 * This complements the checksum-based staleness tracker in storage/staleness.ts
 * by adding time-based freshness guarantees.
 *
 * SLA Targets:
 * - Open/active files: < 1 second stale
 * - Project source files: < 5 minutes stale
 * - Dependencies: < 1 hour stale (or on version change)
 *
 * @packageDocumentation
 */

import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * SLA thresholds configuration in milliseconds.
 */
export interface StalenessConfig {
  /** SLA for open/active files in milliseconds (default: 1000ms / 1 second) */
  openFileSlaMs: number;
  /** SLA for project source files in milliseconds (default: 300000ms / 5 minutes) */
  projectFileSlaMs: number;
  /** SLA for dependencies in milliseconds (default: 3600000ms / 1 hour) */
  dependencySlaMs: number;
}

/**
 * Default SLA configuration matching the specification.
 */
export const DEFAULT_STALENESS_CONFIG: StalenessConfig = {
  openFileSlaMs: 1000,                    // 1 second
  projectFileSlaMs: 5 * 60 * 1000,        // 5 minutes
  dependencySlaMs: 60 * 60 * 1000,        // 1 hour
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * File type classification for SLA determination.
 */
export type FileType = 'open' | 'project' | 'dependency';

/**
 * Staleness category based on SLA comparison.
 */
export type StalenessCategory = 'fresh' | 'stale' | 'critical';

/**
 * Buckets for categorizing files by staleness status.
 */
export interface FileStalenessBucket {
  /** Files within their SLA threshold */
  fresh: string[];
  /** Files beyond SLA but not critical (< 2x SLA) */
  stale: string[];
  /** Very stale files (>= 2x SLA threshold) */
  critical: string[];
}

/**
 * Detailed staleness information for a single file.
 */
export interface StalestFileInfo {
  /** File path */
  path: string;
  /** Age in milliseconds since last indexing */
  ageMs: number;
  /** Applicable SLA threshold in milliseconds */
  slaMs: number;
}

/**
 * Complete SLA adherence report.
 */
export interface SlaReport {
  /** Timestamp when the report was generated */
  timestamp: Date;
  /** Total number of tracked files */
  totalFiles: number;
  /** Number of files within their SLA */
  withinSla: number;
  /** Number of files beyond their SLA */
  beyondSla: number;
  /** Percentage of files meeting SLA (0-100) */
  slaAdherencePercent: number;
  /** Files categorized by staleness status */
  buckets: FileStalenessBucket;
  /** Worst offenders - files with highest staleness */
  stalestFiles: StalestFileInfo[];
  /** Average age across all files in milliseconds */
  averageAgeMs: number;
  /** 50th percentile age in milliseconds */
  p50AgeMs: number;
  /** 95th percentile age in milliseconds */
  p95AgeMs: number;
  /** 99th percentile age in milliseconds */
  p99AgeMs: number;
}

/**
 * Internal record for tracking file index timestamps.
 */
interface IndexRecord {
  path: string;
  indexedAt: Date;
  fileType: FileType;
}

// ============================================================================
// STALENESS TRACKER
// ============================================================================

/**
 * Tracks index staleness and monitors SLA adherence.
 *
 * This tracker maintains an in-memory record of when files were last indexed
 * and provides APIs for checking SLA compliance and generating reports.
 *
 * INVARIANT: All time calculations use monotonic timestamps
 * INVARIANT: SLA thresholds are immutable after construction
 * INVARIANT: File type classification is deterministic
 */
export class StalenessTracker {
  private readonly storage: LiBrainianStorage;
  private readonly config: StalenessConfig;
  private readonly indexRecords: Map<string, IndexRecord>;
  private readonly openFiles: Set<string>;

  constructor(storage: LiBrainianStorage, config?: Partial<StalenessConfig>) {
    this.storage = storage;
    this.config = { ...DEFAULT_STALENESS_CONFIG, ...config };
    this.indexRecords = new Map();
    this.openFiles = new Set();
  }

  // ==========================================================================
  // OPEN FILE MANAGEMENT
  // ==========================================================================

  /**
   * Mark a file as currently open (applies stricter SLA).
   */
  markFileOpen(path: string): void {
    this.openFiles.add(path);
  }

  /**
   * Mark a file as closed (reverts to normal SLA).
   */
  markFileClosed(path: string): void {
    this.openFiles.delete(path);
  }

  /**
   * Check if a file is currently marked as open.
   */
  isFileOpen(path: string): boolean {
    return this.openFiles.has(path);
  }

  /**
   * Get all currently open files.
   */
  getOpenFiles(): string[] {
    return Array.from(this.openFiles);
  }

  // ==========================================================================
  // INDEX RECORDING
  // ==========================================================================

  /**
   * Record when a file was last indexed.
   *
   * @param path - File path to record
   * @param timestamp - When the file was indexed (defaults to now)
   */
  async recordIndexed(path: string, timestamp?: Date): Promise<void> {
    const indexedAt = timestamp ?? new Date();
    const fileType = this.classifyFileType(path);

    this.indexRecords.set(path, {
      path,
      indexedAt,
      fileType,
    });
  }

  /**
   * Bulk record indexing for multiple files.
   */
  async recordIndexedBatch(
    files: Array<{ path: string; timestamp?: Date }>
  ): Promise<void> {
    for (const { path, timestamp } of files) {
      await this.recordIndexed(path, timestamp);
    }
  }

  // ==========================================================================
  // FILE AGE QUERIES
  // ==========================================================================

  /**
   * Get age of index for a file in milliseconds.
   *
   * @param path - File path to check
   * @returns Age in milliseconds, or null if file was never indexed
   */
  async getFileAge(path: string): Promise<number | null> {
    const record = this.indexRecords.get(path);
    if (!record) {
      // Try to get from storage if not in memory
      const fileKnowledge = await this.storage.getFileByPath(path);
      if (fileKnowledge?.lastIndexed) {
        const indexedAt = new Date(fileKnowledge.lastIndexed);
        return Date.now() - indexedAt.getTime();
      }
      return null;
    }
    return Date.now() - record.indexedAt.getTime();
  }

  /**
   * Get ages for multiple files.
   */
  async getFileAges(
    paths: string[]
  ): Promise<Map<string, number | null>> {
    const ages = new Map<string, number | null>();
    for (const path of paths) {
      ages.set(path, await this.getFileAge(path));
    }
    return ages;
  }

  // ==========================================================================
  // SLA DETERMINATION
  // ==========================================================================

  /**
   * Classify a file type based on its path.
   *
   * Classification rules:
   * - Open files: Any file marked as open via markFileOpen()
   * - Dependencies: Files in node_modules, vendor, or similar directories
   * - Project: All other source files
   */
  private classifyFileType(path: string): FileType {
    if (this.openFiles.has(path)) {
      return 'open';
    }

    // Check for dependency paths
    const depPatterns = [
      '/node_modules/',
      '/vendor/',
      '/.pnpm/',
      '/bower_components/',
      '/packages/', // monorepo dependencies
    ];

    for (const pattern of depPatterns) {
      if (path.includes(pattern)) {
        return 'dependency';
      }
    }

    return 'project';
  }

  /**
   * Get the SLA threshold for a file based on its type.
   *
   * @param path - File path to check
   * @returns SLA threshold in milliseconds
   */
  getSlaForFile(path: string): number {
    const fileType = this.classifyFileType(path);

    switch (fileType) {
      case 'open':
        return this.config.openFileSlaMs;
      case 'dependency':
        return this.config.dependencySlaMs;
      case 'project':
      default:
        return this.config.projectFileSlaMs;
    }
  }

  /**
   * Check if a file is within its SLA threshold.
   *
   * @param path - File path to check
   * @returns true if within SLA, false if beyond, null if never indexed
   */
  async isWithinSla(path: string): Promise<boolean | null> {
    const age = await this.getFileAge(path);
    if (age === null) {
      return null;
    }

    const sla = this.getSlaForFile(path);
    return age <= sla;
  }

  // ==========================================================================
  // AGGREGATED METRICS
  // ==========================================================================

  /**
   * Get overall SLA adherence percentage.
   *
   * @returns Percentage of tracked files meeting their SLA (0-100)
   */
  async getSlaAdherence(): Promise<number> {
    const paths = this.getAllTrackedPaths();
    if (paths.length === 0) {
      return 100; // No files = perfect adherence
    }

    let withinSla = 0;
    for (const path of paths) {
      const isWithin = await this.isWithinSla(path);
      if (isWithin === true) {
        withinSla++;
      }
    }

    return (withinSla / paths.length) * 100;
  }

  /**
   * Get list of files beyond their SLA.
   *
   * @param limit - Maximum number of files to return
   * @returns Files that are stale, sorted by age (most stale first)
   */
  async getStaleFiles(
    limit?: number
  ): Promise<Array<{ path: string; ageMs: number }>> {
    const staleFiles: Array<{ path: string; ageMs: number }> = [];

    for (const path of this.getAllTrackedPaths()) {
      const age = await this.getFileAge(path);
      if (age === null) continue;

      const sla = this.getSlaForFile(path);
      if (age > sla) {
        staleFiles.push({ path, ageMs: age });
      }
    }

    // Sort by age descending (most stale first)
    staleFiles.sort((a, b) => b.ageMs - a.ageMs);

    if (limit !== undefined) {
      return staleFiles.slice(0, limit);
    }

    return staleFiles;
  }

  /**
   * Get stalest files (worst offenders).
   *
   * @param limit - Maximum number of files to return (default: 10)
   * @returns Files sorted by age, most stale first
   */
  async getStalestFiles(
    limit: number = 10
  ): Promise<Array<{ path: string; ageMs: number }>> {
    const allFiles: Array<{ path: string; ageMs: number }> = [];

    for (const path of this.getAllTrackedPaths()) {
      const age = await this.getFileAge(path);
      if (age !== null) {
        allFiles.push({ path, ageMs: age });
      }
    }

    // Sort by age descending
    allFiles.sort((a, b) => b.ageMs - a.ageMs);

    return allFiles.slice(0, limit);
  }

  /**
   * Get freshness confidence for a set of query result paths.
   *
   * This is useful for indicating how trustworthy query results are
   * based on how fresh the underlying index data is.
   *
   * @param paths - File paths from query results
   * @returns Confidence score from 0 (all stale) to 1 (all fresh)
   */
  async getFreshnessConfidence(paths: string[]): Promise<number> {
    if (paths.length === 0) {
      return 1.0;
    }

    let totalConfidence = 0;

    for (const path of paths) {
      const age = await this.getFileAge(path);
      if (age === null) {
        // Unknown freshness - assume somewhat stale
        totalConfidence += 0.5;
        continue;
      }

      const sla = this.getSlaForFile(path);

      if (age <= sla) {
        // Within SLA - full confidence
        totalConfidence += 1.0;
      } else if (age <= sla * 2) {
        // Beyond SLA but not critical - reduced confidence
        // Linear decay from 1.0 to 0.5 as we go from SLA to 2x SLA
        const decay = (age - sla) / sla;
        totalConfidence += 1.0 - (decay * 0.5);
      } else {
        // Critical staleness - low confidence
        // Exponential decay beyond 2x SLA
        const multiplier = age / sla;
        totalConfidence += Math.max(0.1, 0.5 / multiplier);
      }
    }

    return totalConfidence / paths.length;
  }

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================

  /**
   * Generate a comprehensive SLA report.
   *
   * @returns Full report with all metrics
   */
  async generateReport(): Promise<SlaReport> {
    const now = new Date();
    const paths = this.getAllTrackedPaths();
    const ages: number[] = [];
    const buckets: FileStalenessBucket = {
      fresh: [],
      stale: [],
      critical: [],
    };
    const stalestFilesInfo: StalestFileInfo[] = [];

    let withinSla = 0;
    let beyondSla = 0;

    for (const path of paths) {
      const age = await this.getFileAge(path);
      if (age === null) continue;

      ages.push(age);
      const sla = this.getSlaForFile(path);
      const category = categorizeStaleness(age, sla);

      buckets[category].push(path);
      stalestFilesInfo.push({ path, ageMs: age, slaMs: sla });

      if (category === 'fresh') {
        withinSla++;
      } else {
        beyondSla++;
      }
    }

    // Sort stalest files
    stalestFilesInfo.sort((a, b) => b.ageMs - a.ageMs);

    // Calculate percentiles
    ages.sort((a, b) => a - b);
    const totalFiles = ages.length;

    return {
      timestamp: now,
      totalFiles,
      withinSla,
      beyondSla,
      slaAdherencePercent: totalFiles > 0 ? (withinSla / totalFiles) * 100 : 100,
      buckets,
      stalestFiles: stalestFilesInfo.slice(0, 10),
      averageAgeMs: totalFiles > 0 ? ages.reduce((a, b) => a + b, 0) / totalFiles : 0,
      p50AgeMs: calculatePercentile(ages, 50),
      p95AgeMs: calculatePercentile(ages, 95),
      p99AgeMs: calculatePercentile(ages, 99),
    };
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  /**
   * Get all tracked file paths.
   */
  private getAllTrackedPaths(): string[] {
    return Array.from(this.indexRecords.keys());
  }

  /**
   * Get the current configuration.
   */
  getConfig(): StalenessConfig {
    return { ...this.config };
  }

  /**
   * Get the number of tracked files.
   */
  getTrackedFileCount(): number {
    return this.indexRecords.size;
  }

  /**
   * Clear all tracked records (useful for testing).
   */
  clear(): void {
    this.indexRecords.clear();
    this.openFiles.clear();
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format age in milliseconds to a human-readable string.
 *
 * @param ms - Age in milliseconds
 * @returns Formatted string like "2m 30s" or "1h 5m"
 */
export function formatAge(ms: number): string {
  if (ms < 0) {
    return '0s';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * Categorize staleness based on age and SLA threshold.
 *
 * @param ageMs - Age in milliseconds
 * @param slaMs - SLA threshold in milliseconds
 * @returns Category: 'fresh', 'stale', or 'critical'
 */
export function categorizeStaleness(
  ageMs: number,
  slaMs: number
): StalenessCategory {
  if (ageMs <= slaMs) {
    return 'fresh';
  }

  if (ageMs < slaMs * 2) {
    return 'stale';
  }

  return 'critical';
}

/**
 * Calculate a percentile from a sorted array of values.
 *
 * @param sortedValues - Array of values sorted in ascending order
 * @param percentile - Percentile to calculate (0-100)
 * @returns The percentile value, or 0 if array is empty
 */
export function calculatePercentile(
  sortedValues: number[],
  percentile: number
): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  if (percentile <= 0) {
    return sortedValues[0]!;
  }

  if (percentile >= 100) {
    return sortedValues[sortedValues.length - 1]!;
  }

  // Use linear interpolation for percentile calculation
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower]!;
  }

  const fraction = index - lower;
  return sortedValues[lower]! + fraction * (sortedValues[upper]! - sortedValues[lower]!);
}

// ============================================================================
// CLI FORMATTING
// ============================================================================

/**
 * Format a staleness report for CLI output.
 *
 * @param tracker - StalenessTracker instance
 * @returns Formatted string suitable for terminal display
 */
export async function formatStatusReport(
  tracker: StalenessTracker
): Promise<string> {
  const report = await tracker.generateReport();
  const lines: string[] = [];

  // Header
  lines.push('Index Freshness Report');
  lines.push('='.repeat(50));
  lines.push('');

  // Summary
  lines.push(`Total files: ${report.totalFiles.toLocaleString()}`);
  lines.push(`SLA Adherence: ${report.slaAdherencePercent.toFixed(1)}%`);
  lines.push('');

  // By Status
  lines.push('By Status:');
  const freshCount = report.buckets.fresh.length;
  const staleCount = report.buckets.stale.length;
  const criticalCount = report.buckets.critical.length;
  const total = report.totalFiles || 1; // Avoid division by zero

  lines.push(
    `  [FRESH]    ${freshCount.toString().padStart(6)} (${((freshCount / total) * 100).toFixed(1)}%)`
  );
  lines.push(
    `  [STALE]    ${staleCount.toString().padStart(6)} (${((staleCount / total) * 100).toFixed(1)}%)`
  );
  lines.push(
    `  [CRITICAL] ${criticalCount.toString().padStart(6)} (${((criticalCount / total) * 100).toFixed(1)}%)`
  );
  lines.push('');

  // Stalest Files
  if (report.stalestFiles.length > 0) {
    lines.push('Stalest Files:');
    for (const file of report.stalestFiles.slice(0, 5)) {
      const age = formatAge(file.ageMs);
      const sla = formatAge(file.slaMs);
      // Truncate path if too long
      const displayPath = file.path.length > 40
        ? '...' + file.path.slice(-37)
        : file.path.padEnd(40);
      lines.push(`  ${displayPath}  ${age.padStart(8)} (SLA: ${sla})`);
    }
    lines.push('');
  }

  // Percentiles
  lines.push('Percentiles:');
  lines.push(
    `  p50: ${formatAge(report.p50AgeMs)} | p95: ${formatAge(report.p95AgeMs)} | p99: ${formatAge(report.p99AgeMs)}`
  );

  return lines.join('\n');
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new StalenessTracker instance.
 *
 * @param storage - LiBrainianStorage instance
 * @param config - Optional configuration overrides
 * @returns Configured StalenessTracker
 */
export function createStalenessMetricsTracker(
  storage: LiBrainianStorage,
  config?: Partial<StalenessConfig>
): StalenessTracker {
  return new StalenessTracker(storage, config);
}
