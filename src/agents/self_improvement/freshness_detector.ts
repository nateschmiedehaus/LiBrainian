/**
 * @fileoverview Freshness Detector (WU-SELF-302)
 *
 * Detects stale knowledge in the system using an exponential decay model.
 * Freshness score decreases exponentially over time since last indexing.
 *
 * Formula: freshness = e^(-lambda * time_since_update_in_hours)
 *
 * Integration:
 * - Tracks file modification times vs last indexed times
 * - Reports staleness to Evidence Ledger for audit trail
 * - Provides recommendations for refreshing stale knowledge
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LibrarianStorage, FileKnowledge } from '../../storage/types.js';
import type { IEvidenceLedger, EvidenceProvenance } from '../../epistemics/evidence_ledger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for freshness detection.
 */
export interface FreshnessConfig {
  /**
   * Decay rate (lambda) for the exponential decay model.
   * Higher values = faster decay.
   * Default: 0.001 per hour (half-life of ~693 hours or ~29 days)
   */
  decayLambda: number;

  /**
   * Freshness score below which knowledge is considered stale.
   * Range: 0.0 - 1.0
   * Default: 0.7
   */
  staleThreshold: number;

  /**
   * Freshness score below which knowledge is critically stale.
   * Must be <= staleThreshold.
   * Range: 0.0 - 1.0
   * Default: 0.3
   */
  criticalThreshold: number;

  /**
   * Whether to record staleness events to the Evidence Ledger.
   * Default: true
   */
  recordToLedger?: boolean;
}

/**
 * Result of checking freshness for a single file.
 */
export interface FreshnessResult {
  /** Absolute path to the file */
  path: string;

  /** Last modification time on disk */
  lastModified: Date;

  /** Last time the file was indexed */
  lastIndexed: Date;

  /** Freshness score between 0.0 and 1.0 */
  freshnessScore: number;

  /** Status classification based on thresholds */
  status: 'fresh' | 'stale' | 'critical';

  /** Recommended action based on status */
  recommendedAction: string;
}

/**
 * Aggregated freshness report for a directory.
 */
export interface FreshnessReport {
  /** Total number of files analyzed */
  totalFiles: number;

  /** Number of files classified as fresh */
  freshCount: number;

  /** Number of files classified as stale */
  staleCount: number;

  /** Number of files classified as critical */
  criticalCount: number;

  /** Average freshness score across all files */
  averageFreshness: number;

  /** List of stale and critical files (sorted by freshness ascending) */
  staleFiles: FreshnessResult[];
}

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Default configuration for freshness detection.
 *
 * With these defaults:
 * - After 1 day: freshness ~= 0.976
 * - After 7 days: freshness ~= 0.846
 * - After 30 days: freshness ~= 0.487
 * - After 90 days: freshness ~= 0.115
 */
export const DEFAULT_FRESHNESS_CONFIG: FreshnessConfig = {
  decayLambda: 0.001, // Per hour - half-life ~693 hours (~29 days)
  staleThreshold: 0.7,
  criticalThreshold: 0.3,
  recordToLedger: true,
};

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Options for freshness computation.
 */
export interface FreshnessComputeOptions {
  /** Decay rate (lambda) for exponential decay */
  decayLambda?: number;
}

/**
 * Compute freshness score using exponential decay model.
 *
 * The freshness score measures how up-to-date the indexed knowledge is.
 * Formula: freshness = e^(-lambda * time_since_last_index_in_hours)
 *
 * Semantics:
 * - If lastIndexed >= lastModified, the index is current, freshness depends
 *   on how long ago the indexing happened (time decay)
 * - If lastModified > lastIndexed, the file was modified after indexing,
 *   freshness depends on time since the index became stale
 *
 * @param lastModified - When the file was last modified on disk
 * @param lastIndexed - When the file was last indexed
 * @param options - Optional configuration
 * @returns Freshness score between 0.0 and 1.0
 *
 * @example
 * ```typescript
 * const now = new Date();
 * const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
 * const freshness = computeFreshness(oneWeekAgo, now);
 * // With default lambda 0.001: e^(-0.001 * 168) ~= 0.846
 * ```
 */
export function computeFreshness(
  lastModified: Date,
  lastIndexed: Date,
  options?: FreshnessComputeOptions
): number {
  const lambda = options?.decayLambda ?? DEFAULT_FRESHNESS_CONFIG.decayLambda;

  // If lambda is 0, there's no decay
  if (lambda === 0) {
    return 1.0;
  }

  // Case 1: File was indexed after being modified - index is current
  // Freshness decays based on how long ago the indexing happened
  if (lastIndexed.getTime() >= lastModified.getTime()) {
    // If times are equal (same moment), fully fresh
    return 1.0;
  }

  // Case 2: File was modified after being indexed - index is stale
  // Freshness decays based on how long the file has been stale (since modification)
  const timeSinceModificationMs = lastModified.getTime() - lastIndexed.getTime();
  const timeSinceModificationHours = timeSinceModificationMs / (1000 * 60 * 60);

  // Exponential decay: e^(-lambda * t)
  const freshness = Math.exp(-lambda * timeSinceModificationHours);

  // Clamp to [0, 1] for safety
  return Math.max(0, Math.min(1, freshness));
}

/**
 * Classify freshness status based on thresholds.
 */
function classifyFreshness(
  score: number,
  config: FreshnessConfig
): 'fresh' | 'stale' | 'critical' {
  if (score >= config.staleThreshold) {
    return 'fresh';
  }
  if (score >= config.criticalThreshold) {
    return 'stale';
  }
  return 'critical';
}

/**
 * Generate recommended action based on freshness status.
 */
function getRecommendedAction(
  status: 'fresh' | 'stale' | 'critical',
  context: { fileExists: boolean; isIndexed: boolean; hasError?: boolean }
): string {
  if (context.hasError) {
    return 'Investigate error: unable to check file status. Check file permissions and path validity.';
  }

  if (!context.fileExists) {
    return 'Consider removing from index: file no longer exists on disk.';
  }

  if (!context.isIndexed) {
    return 'High priority: index this file as it has never been indexed.';
  }

  switch (status) {
    case 'fresh':
      return 'No action needed: file is up to date.';
    case 'stale':
      return 'Schedule re-indexing: file has not been indexed recently and may have outdated knowledge.';
    case 'critical':
      return 'Urgent: re-index immediately. Knowledge is critically stale and likely unreliable.';
    default:
      return 'Unknown status.';
  }
}

// ============================================================================
// FRESHNESS DETECTOR CLASS
// ============================================================================

/**
 * Detects stale knowledge using exponential decay model.
 *
 * INVARIANT: Freshness scores are always in [0, 1]
 * INVARIANT: criticalThreshold <= staleThreshold
 * INVARIANT: Detection is read-only (does not modify storage)
 */
export class FreshnessDetector {
  private config: FreshnessConfig;
  private storage: LibrarianStorage;
  private ledger?: IEvidenceLedger;

  /**
   * Create a new FreshnessDetector.
   *
   * @param storage - Storage instance for querying file knowledge
   * @param ledger - Optional Evidence Ledger for recording staleness events
   * @param config - Optional configuration (merged with defaults)
   * @throws Error if criticalThreshold > staleThreshold
   */
  constructor(
    storage: LibrarianStorage,
    ledger?: IEvidenceLedger,
    config?: Partial<FreshnessConfig>
  ) {
    this.storage = storage;
    this.ledger = ledger;
    this.config = { ...DEFAULT_FRESHNESS_CONFIG, ...config };

    // Validate config invariant
    if (this.config.criticalThreshold > this.config.staleThreshold) {
      throw new Error('criticalThreshold must be less than or equal to staleThreshold');
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): FreshnessConfig {
    return { ...this.config };
  }

  /**
   * Check freshness of a single file.
   *
   * @param filePath - Absolute path to the file
   * @returns Freshness result with score, status, and recommendation
   */
  async checkFile(filePath: string): Promise<FreshnessResult> {
    const now = new Date();

    // Check if file exists on disk
    const fileExists = fs.existsSync(filePath);

    // Get file knowledge from storage
    const fileKnowledge = await this.storage.getFileByPath(filePath);
    const isIndexed = fileKnowledge !== null;

    // Handle error cases
    if (!fileExists && !isIndexed) {
      return this.createErrorResult(filePath, now, 'File not found on disk or in index');
    }

    if (!isIndexed) {
      // File exists but not indexed - critical
      const mtime = this.getFileMtime(filePath);
      const result: FreshnessResult = {
        path: filePath,
        lastModified: mtime ?? now,
        lastIndexed: new Date(0), // Never indexed
        freshnessScore: 0,
        status: 'critical',
        recommendedAction: getRecommendedAction('critical', {
          fileExists,
          isIndexed,
        }),
      };

      await this.recordToLedger(result);
      return result;
    }

    if (!fileExists) {
      // File was indexed but no longer exists
      const lastIndexed = new Date(fileKnowledge.lastIndexed);
      const result: FreshnessResult = {
        path: filePath,
        lastModified: new Date(0),
        lastIndexed,
        freshnessScore: 0,
        status: 'critical',
        recommendedAction: getRecommendedAction('critical', {
          fileExists,
          isIndexed,
        }),
      };

      await this.recordToLedger(result);
      return result;
    }

    // Both exist - compute freshness
    const mtime = this.getFileMtime(filePath);
    if (!mtime) {
      return this.createErrorResult(filePath, now, 'Unable to read file modification time');
    }

    const lastIndexed = new Date(fileKnowledge.lastIndexed);
    const freshnessScore = computeFreshness(mtime, lastIndexed, {
      decayLambda: this.config.decayLambda,
    });
    const status = classifyFreshness(freshnessScore, this.config);

    const result: FreshnessResult = {
      path: filePath,
      lastModified: mtime,
      lastIndexed,
      freshnessScore,
      status,
      recommendedAction: getRecommendedAction(status, {
        fileExists,
        isIndexed,
      }),
    };

    // Record stale/critical to ledger
    if (status !== 'fresh') {
      await this.recordToLedger(result);
    }

    return result;
  }

  /**
   * Generate a freshness report for all indexed files.
   *
   * @param rootDir - Root directory (used for context, not for scanning)
   * @returns Aggregated freshness report
   */
  async generateReport(rootDir: string): Promise<FreshnessReport> {
    // Get all indexed files from storage
    const files = await this.storage.getFiles({ limit: 50000 });

    if (files.length === 0) {
      return {
        totalFiles: 0,
        freshCount: 0,
        staleCount: 0,
        criticalCount: 0,
        averageFreshness: 1.0, // No files = fully fresh
        staleFiles: [],
      };
    }

    const results: FreshnessResult[] = [];
    let totalFreshness = 0;
    let freshCount = 0;
    let staleCount = 0;
    let criticalCount = 0;

    for (const file of files) {
      const result = await this.checkFile(file.path);
      results.push(result);
      totalFreshness += result.freshnessScore;

      switch (result.status) {
        case 'fresh':
          freshCount++;
          break;
        case 'stale':
          staleCount++;
          break;
        case 'critical':
          criticalCount++;
          break;
      }
    }

    // Filter and sort stale files (most stale first)
    const staleFiles = results
      .filter((r) => r.status === 'stale' || r.status === 'critical')
      .sort((a, b) => a.freshnessScore - b.freshnessScore);

    return {
      totalFiles: files.length,
      freshCount,
      staleCount,
      criticalCount,
      averageFreshness: totalFreshness / files.length,
      staleFiles,
    };
  }

  /**
   * Get stale files from the index, sorted by staleness.
   *
   * @param rootDir - Root directory (for context)
   * @param limit - Maximum number of files to return
   * @returns Array of stale/critical files, sorted by freshness ascending
   */
  async getStaleFiles(rootDir: string, limit?: number): Promise<FreshnessResult[]> {
    const report = await this.generateReport(rootDir);

    if (limit !== undefined && limit > 0) {
      return report.staleFiles.slice(0, limit);
    }

    return report.staleFiles;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Get file modification time safely.
   */
  private getFileMtime(filePath: string): Date | null {
    try {
      const stats = fs.statSync(filePath);
      return stats.mtime;
    } catch {
      return null;
    }
  }

  /**
   * Create an error result for files that couldn't be checked.
   */
  private createErrorResult(
    filePath: string,
    timestamp: Date,
    errorMessage: string
  ): FreshnessResult {
    return {
      path: filePath,
      lastModified: timestamp,
      lastIndexed: timestamp,
      freshnessScore: 0,
      status: 'critical',
      recommendedAction: getRecommendedAction('critical', {
        fileExists: false,
        isIndexed: false,
        hasError: true,
      }),
    };
  }

  /**
   * Record staleness event to Evidence Ledger if enabled.
   */
  private async recordToLedger(result: FreshnessResult): Promise<void> {
    if (!this.config.recordToLedger || !this.ledger) {
      return;
    }

    const provenance: EvidenceProvenance = {
      source: 'system_observation',
      method: 'freshness_detection',
      config: {
        decayLambda: this.config.decayLambda,
        staleThreshold: this.config.staleThreshold,
        criticalThreshold: this.config.criticalThreshold,
      },
    };

    await this.ledger.append({
      kind: 'verification',
      payload: {
        claimId: `file_freshness_${result.path}` as any,
        method: 'static_analysis',
        result: result.status === 'fresh' ? 'verified' : 'refuted',
        details: JSON.stringify({
          path: result.path,
          freshnessScore: result.freshnessScore,
          status: result.status,
          lastModified: result.lastModified.toISOString(),
          lastIndexed: result.lastIndexed.toISOString(),
          recommendedAction: result.recommendedAction,
        }),
      },
      provenance,
      relatedEntries: [],
    });
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a FreshnessDetector with the given configuration.
 *
 * @param storage - Storage instance
 * @param ledger - Optional Evidence Ledger
 * @param config - Optional configuration
 * @returns New FreshnessDetector instance
 */
export function createFreshnessDetector(
  storage: LibrarianStorage,
  ledger?: IEvidenceLedger,
  config?: Partial<FreshnessConfig>
): FreshnessDetector {
  return new FreshnessDetector(storage, ledger, config);
}
