/**
 * @fileoverview Index Completeness Metrics
 *
 * Provides comprehensive metrics about index completeness, staleness, and health.
 * Used by the CLI health command and for monitoring index quality.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Completeness metrics broken down by file extension.
 */
export interface ExtensionMetrics {
  /** Total files with this extension */
  total: number;
  /** Number of indexed files with this extension */
  indexed: number;
  /** Completeness ratio (0-1) */
  completeness: number;
}

/**
 * Completeness metrics broken down by directory.
 */
export interface DirectoryMetrics {
  /** Total files in this directory (not recursive) */
  total: number;
  /** Number of indexed files in this directory */
  indexed: number;
  /** Completeness ratio (0-1) */
  completeness: number;
}

/**
 * Information about a stale file (indexed but modified since).
 */
export interface StaleFileInfo {
  /** Absolute path to the file */
  path: string;
  /** When the file was indexed */
  indexedAt: Date;
  /** When the file was last modified */
  modifiedAt: Date;
  /** How long the file has been stale (ms) */
  stalenessMs: number;
}

/**
 * Comprehensive index completeness report.
 */
export interface IndexCompletenessReport {
  /** Total source files discovered in workspace */
  totalFiles: number;
  /** Number of files that have been indexed */
  indexedFiles: number;
  /** Overall completeness ratio (0-1) */
  completeness: number;
  /** Files that exist but are not indexed */
  missingFiles: string[];
  /** Files that are indexed but have been modified since */
  staleFiles: StaleFileInfo[];
  /** Milliseconds since last full index */
  indexAge: number;
  /** Last index timestamp (null if never indexed) */
  lastIndexTime: Date | null;
  /** Metrics broken down by file extension */
  byExtension: Record<string, ExtensionMetrics>;
  /** Metrics broken down by top-level directory */
  byDirectory: Record<string, DirectoryMetrics>;
  /** Actionable recommendations based on the analysis */
  recommendations: string[];
  /** When this report was generated */
  generatedAt: Date;
}

/**
 * Options for calculating index completeness.
 */
export interface CompletenessOptions {
  /** File extensions to include (default: common source files) */
  extensions?: string[];
  /** Glob patterns to ignore (default: node_modules, dist, etc.) */
  ignorePatterns?: string[];
  /** Maximum number of missing files to include in report */
  maxMissingFiles?: number;
  /** Maximum number of stale files to include in report */
  maxStaleFiles?: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'java', 'go', 'rs', 'rb', 'php',
  'c', 'cpp', 'h', 'hpp', 'cs',
  'swift', 'kt', 'scala',
];

const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/vendor/**',
  '**/.next/**',
  '**/.nuxt/**',
];

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Calculate index completeness for a workspace.
 *
 * Compares discovered source files against the librainian index to determine:
 * - Overall completeness percentage
 * - Missing files that need indexing
 * - Stale files that need re-indexing
 * - Breakdown by extension and directory
 *
 * @param workspace - Root directory of the workspace
 * @param storage - LiBrainian storage instance
 * @param options - Calculation options
 * @returns Comprehensive completeness report
 *
 * @example
 * ```typescript
 * const report = await calculateIndexCompleteness('/path/to/project', storage);
 * console.log(`Index is ${(report.completeness * 100).toFixed(1)}% complete`);
 * console.log(`${report.staleFiles.length} files need re-indexing`);
 * ```
 */
export async function calculateIndexCompleteness(
  workspace: string,
  storage: LiBrainianStorage,
  options: CompletenessOptions = {}
): Promise<IndexCompletenessReport> {
  const {
    extensions = DEFAULT_EXTENSIONS,
    ignorePatterns = DEFAULT_IGNORE_PATTERNS,
    maxMissingFiles = 100,
    maxStaleFiles = 50,
  } = options;

  const generatedAt = new Date();

  // Build glob pattern for source files
  const extensionPattern = extensions.length === 1
    ? `**/*.${extensions[0]}`
    : `**/*.{${extensions.join(',')}}`;

  // Discover all source files
  const allFiles = await glob(extensionPattern, {
    cwd: workspace,
    ignore: ignorePatterns,
    nodir: true,
    absolute: false,
  });

  // Get indexed files from storage
  const indexedFileRecords = await storage.getFiles();
  const indexedPathMap = new Map<string, { indexedAt: Date }>();

  for (const record of indexedFileRecords) {
    // Normalize path to be relative to workspace
    const relativePath = record.path.startsWith(workspace)
      ? record.path.slice(workspace.length).replace(/^\//, '')
      : record.path;

    indexedPathMap.set(relativePath, {
      indexedAt: record.lastIndexed ? new Date(record.lastIndexed) : new Date(0),
    });

    // Also store with absolute path
    indexedPathMap.set(record.path, {
      indexedAt: record.lastIndexed ? new Date(record.lastIndexed) : new Date(0),
    });
  }

  // Find missing and stale files
  const missingFiles: string[] = [];
  const staleFiles: StaleFileInfo[] = [];

  // Metrics by extension and directory
  const byExtension: Record<string, ExtensionMetrics> = {};
  const byDirectory: Record<string, DirectoryMetrics> = {};

  for (const file of allFiles) {
    const absolutePath = path.join(workspace, file);
    const ext = path.extname(file).slice(1) || 'no-ext';
    const topDir = file.split(path.sep)[0] || '.';

    // Initialize extension metrics
    if (!byExtension[ext]) {
      byExtension[ext] = { total: 0, indexed: 0, completeness: 0 };
    }
    byExtension[ext].total++;

    // Initialize directory metrics
    if (!byDirectory[topDir]) {
      byDirectory[topDir] = { total: 0, indexed: 0, completeness: 0 };
    }
    byDirectory[topDir].total++;

    // Check if file is indexed
    const indexed = indexedPathMap.get(file) || indexedPathMap.get(absolutePath);

    if (!indexed) {
      // File is not indexed
      if (missingFiles.length < maxMissingFiles) {
        missingFiles.push(file);
      }
    } else {
      // File is indexed - check if stale
      byExtension[ext].indexed++;
      byDirectory[topDir].indexed++;

      try {
        const stat = await fs.stat(absolutePath);
        if (stat.mtimeMs > indexed.indexedAt.getTime()) {
          // File has been modified since indexing
          if (staleFiles.length < maxStaleFiles) {
            staleFiles.push({
              path: file,
              indexedAt: indexed.indexedAt,
              modifiedAt: stat.mtime,
              stalenessMs: stat.mtimeMs - indexed.indexedAt.getTime(),
            });
          }
        }
      } catch {
        // File may have been deleted or inaccessible
      }
    }
  }

  // Calculate completeness ratios
  for (const metrics of Object.values(byExtension)) {
    metrics.completeness = metrics.total > 0 ? metrics.indexed / metrics.total : 1;
  }
  for (const metrics of Object.values(byDirectory)) {
    metrics.completeness = metrics.total > 0 ? metrics.indexed / metrics.total : 1;
  }

  // Get last index time
  const lastIndexResult = await storage.getLastIndexingResult();
  const lastIndexTime = lastIndexResult?.completedAt
    ? new Date(lastIndexResult.completedAt)
    : null;

  const indexAge = lastIndexTime
    ? generatedAt.getTime() - lastIndexTime.getTime()
    : -1;

  // Overall completeness
  const totalIndexed = Object.values(byExtension).reduce((sum, m) => sum + m.indexed, 0);
  const completeness = allFiles.length > 0 ? totalIndexed / allFiles.length : 1;

  // Generate recommendations
  const recommendations = generateRecommendations({
    completeness,
    missingCount: missingFiles.length,
    staleCount: staleFiles.length,
    indexAge,
    byExtension,
    byDirectory,
  });

  // Sort stale files by staleness (most stale first)
  staleFiles.sort((a, b) => b.stalenessMs - a.stalenessMs);

  return {
    totalFiles: allFiles.length,
    indexedFiles: totalIndexed,
    completeness,
    missingFiles,
    staleFiles,
    indexAge,
    lastIndexTime,
    byExtension,
    byDirectory,
    recommendations,
    generatedAt,
  };
}

/**
 * Generate actionable recommendations based on completeness analysis.
 */
function generateRecommendations(analysis: {
  completeness: number;
  missingCount: number;
  staleCount: number;
  indexAge: number;
  byExtension: Record<string, ExtensionMetrics>;
  byDirectory: Record<string, DirectoryMetrics>;
}): string[] {
  const recommendations: string[] = [];

  // Completeness recommendations
  if (analysis.completeness < 0.5) {
    recommendations.push(
      `Index is only ${(analysis.completeness * 100).toFixed(1)}% complete. ` +
      `Run 'librainian bootstrap --force' for a full reindex.`
    );
  } else if (analysis.completeness < 0.9) {
    recommendations.push(
      `Index is ${(analysis.completeness * 100).toFixed(1)}% complete. ` +
      `Run 'librainian bootstrap' to index missing files.`
    );
  }

  // Stale files recommendations
  if (analysis.staleCount > 50) {
    recommendations.push(
      `${analysis.staleCount} files have been modified since indexing. ` +
      `Consider running 'librainian bootstrap' to update stale entries.`
    );
  } else if (analysis.staleCount > 0) {
    recommendations.push(
      `${analysis.staleCount} files have been modified since indexing. ` +
      `Use 'librainian index --force <files>' for targeted updates.`
    );
  }

  // Index age recommendations
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;

  if (analysis.indexAge > oneWeek) {
    const days = Math.floor(analysis.indexAge / oneDay);
    recommendations.push(
      `Index is ${days} days old. Consider running periodic reindex ` +
      `or enable 'librainian watch' for continuous updates.`
    );
  }

  // Extension-specific recommendations
  const lowCoverageExtensions = Object.entries(analysis.byExtension)
    .filter(([, m]) => m.total >= 5 && m.completeness < 0.8)
    .map(([ext, m]) => `*.${ext} (${(m.completeness * 100).toFixed(0)}%)`)
    .slice(0, 3);

  if (lowCoverageExtensions.length > 0) {
    recommendations.push(
      `Low coverage for file types: ${lowCoverageExtensions.join(', ')}. ` +
      `Check if these should be excluded or need special handling.`
    );
  }

  // Directory-specific recommendations
  const lowCoverageDirs = Object.entries(analysis.byDirectory)
    .filter(([, m]) => m.total >= 5 && m.completeness < 0.8)
    .map(([dir, m]) => `${dir}/ (${(m.completeness * 100).toFixed(0)}%)`)
    .slice(0, 3);

  if (lowCoverageDirs.length > 0) {
    recommendations.push(
      `Low coverage in directories: ${lowCoverageDirs.join(', ')}. ` +
      `Verify these directories should be indexed.`
    );
  }

  // If everything is good
  if (recommendations.length === 0 && analysis.completeness >= 0.95) {
    recommendations.push(
      `Index is healthy with ${(analysis.completeness * 100).toFixed(1)}% coverage.`
    );
  }

  return recommendations;
}

/**
 * Format a completeness report for human-readable output.
 *
 * @param report - The completeness report to format
 * @param verbose - Include detailed breakdown
 * @returns Formatted string for display
 */
export function formatCompletenessReport(
  report: IndexCompletenessReport,
  verbose = false
): string {
  const lines: string[] = [];

  // Header
  lines.push('=== Index Completeness Report ===');
  lines.push('');

  // Overall stats
  const pct = (report.completeness * 100).toFixed(1);
  const statusIcon = report.completeness >= 0.95 ? '[OK]' : report.completeness >= 0.8 ? '[WARN]' : '[CRITICAL]';
  lines.push(`Status: ${statusIcon} ${pct}% complete`);
  lines.push(`Files: ${report.indexedFiles} / ${report.totalFiles} indexed`);

  if (report.lastIndexTime) {
    const ageStr = formatDuration(report.indexAge);
    lines.push(`Last Index: ${report.lastIndexTime.toISOString()} (${ageStr} ago)`);
  } else {
    lines.push('Last Index: Never');
  }

  lines.push(`Stale Files: ${report.staleFiles.length}`);
  lines.push(`Missing Files: ${report.missingFiles.length}`);
  lines.push('');

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of report.recommendations) {
      lines.push(`  - ${rec}`);
    }
    lines.push('');
  }

  if (verbose) {
    // Extension breakdown
    lines.push('Coverage by Extension:');
    const sortedExts = Object.entries(report.byExtension)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10);
    for (const [ext, metrics] of sortedExts) {
      const extPct = (metrics.completeness * 100).toFixed(0);
      lines.push(`  .${ext}: ${metrics.indexed}/${metrics.total} (${extPct}%)`);
    }
    lines.push('');

    // Directory breakdown
    lines.push('Coverage by Directory:');
    const sortedDirs = Object.entries(report.byDirectory)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10);
    for (const [dir, metrics] of sortedDirs) {
      const dirPct = (metrics.completeness * 100).toFixed(0);
      lines.push(`  ${dir}/: ${metrics.indexed}/${metrics.total} (${dirPct}%)`);
    }
    lines.push('');

    // Stale files
    if (report.staleFiles.length > 0) {
      lines.push('Most Stale Files:');
      for (const stale of report.staleFiles.slice(0, 5)) {
        const ageStr = formatDuration(stale.stalenessMs);
        lines.push(`  ${stale.path} (stale for ${ageStr})`);
      }
      if (report.staleFiles.length > 5) {
        lines.push(`  ... and ${report.staleFiles.length - 5} more`);
      }
      lines.push('');
    }

    // Missing files
    if (report.missingFiles.length > 0) {
      lines.push('Missing Files (sample):');
      for (const file of report.missingFiles.slice(0, 5)) {
        lines.push(`  ${file}`);
      }
      if (report.missingFiles.length > 5) {
        lines.push(`  ... and ${report.missingFiles.length - 5} more`);
      }
      lines.push('');
    }
  }

  lines.push(`Generated: ${report.generatedAt.toISOString()}`);

  return lines.join('\n');
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 0) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60 * 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)} min`;
  if (ms < 24 * 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)} hours`;
  return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)} days`;
}

/**
 * Export completeness metrics in Prometheus format.
 *
 * @param report - The completeness report
 * @param prefix - Metric name prefix (default: 'librainian_index')
 * @returns Prometheus-formatted metrics string
 */
export function exportPrometheusMetrics(
  report: IndexCompletenessReport,
  prefix = 'librainian_index'
): string {
  const lines: string[] = [];

  // Completeness gauge
  lines.push(`# HELP ${prefix}_completeness_ratio Index completeness ratio (0-1)`);
  lines.push(`# TYPE ${prefix}_completeness_ratio gauge`);
  lines.push(`${prefix}_completeness_ratio ${report.completeness.toFixed(4)}`);

  // File counts
  lines.push(`# HELP ${prefix}_total_files Total source files in workspace`);
  lines.push(`# TYPE ${prefix}_total_files gauge`);
  lines.push(`${prefix}_total_files ${report.totalFiles}`);

  lines.push(`# HELP ${prefix}_indexed_files Number of indexed files`);
  lines.push(`# TYPE ${prefix}_indexed_files gauge`);
  lines.push(`${prefix}_indexed_files ${report.indexedFiles}`);

  lines.push(`# HELP ${prefix}_missing_files Number of files not yet indexed`);
  lines.push(`# TYPE ${prefix}_missing_files gauge`);
  lines.push(`${prefix}_missing_files ${report.missingFiles.length}`);

  lines.push(`# HELP ${prefix}_stale_files Number of files modified since indexing`);
  lines.push(`# TYPE ${prefix}_stale_files gauge`);
  lines.push(`${prefix}_stale_files ${report.staleFiles.length}`);

  // Index age
  lines.push(`# HELP ${prefix}_age_seconds Seconds since last full index`);
  lines.push(`# TYPE ${prefix}_age_seconds gauge`);
  lines.push(`${prefix}_age_seconds ${Math.floor(report.indexAge / 1000)}`);

  // Per-extension metrics (top 5)
  const topExtensions = Object.entries(report.byExtension)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);

  lines.push(`# HELP ${prefix}_extension_completeness Index completeness by file extension`);
  lines.push(`# TYPE ${prefix}_extension_completeness gauge`);
  for (const [ext, metrics] of topExtensions) {
    lines.push(`${prefix}_extension_completeness{extension="${ext}"} ${metrics.completeness.toFixed(4)}`);
  }

  return lines.join('\n');
}
