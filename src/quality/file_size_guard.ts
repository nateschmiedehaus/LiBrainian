/**
 * @fileoverview File Size Guard primitive
 *
 * Enforces maximum file size limits to prevent files from becoming too large
 * for AI tools to read. Claude Code has a ~25,000 token limit per file read.
 *
 * Conservative defaults:
 * - maxTokens: 20,000 (leaves buffer for context)
 * - maxLines: 2,000 (reasonable file length)
 * - maxChars: 80,000 (4 chars ~= 1 token)
 *
 * Usage:
 * - Library: checkFile(), checkDirectory(), checkFiles(), assertFileSizes()
 * - Pre-commit hook: scripts/check-file-sizes.mjs
 */

import { readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { glob } from 'glob';
import { minimatch } from 'minimatch';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for file size limits
 */
export interface FileSizeConfig {
  /** Maximum estimated tokens (default: 20000) */
  maxTokens?: number;
  /** Maximum lines (default: 2000) */
  maxLines?: number;
  /** Maximum characters (default: 80000) */
  maxChars?: number;
  /** File extensions to check (default: common code extensions) */
  extensions?: string[];
  /** Glob patterns to exclude (default: node_modules, dist, etc.) */
  excludePatterns?: string[];
}

/**
 * Type of size violation
 */
export type ViolationType = 'lines' | 'chars' | 'tokens';

/**
 * A single violation of a size limit
 */
export interface FileSizeViolation {
  type: ViolationType;
  actual: number;
  limit: number;
  message: string;
}

/**
 * Result of checking a single file
 */
export interface FileSizeResult {
  /** Absolute path to the file */
  file: string;
  /** Relative path from root directory */
  relativePath: string;
  /** Whether the file passed all checks */
  passed: boolean;
  /** Number of lines in the file */
  lines: number;
  /** Number of characters in the file */
  chars: number;
  /** Estimated token count (chars / 4) */
  estimatedTokens: number;
  /** List of violations (empty if passed) */
  violations: FileSizeViolation[];
}

/**
 * Report from checking multiple files
 */
export interface FileSizeReport {
  /** Total files checked */
  totalFiles: number;
  /** Files that passed all checks */
  passedFiles: number;
  /** Files that failed one or more checks */
  failedFiles: number;
  /** Results for each file */
  results: FileSizeResult[];
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

/**
 * Default configuration with conservative limits for AI tool compatibility
 */
export const DEFAULT_FILE_SIZE_CONFIG: Required<FileSizeConfig> = {
  maxTokens: 20000,
  maxLines: 2000,
  maxChars: 80000,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.md'],
  excludePatterns: [
    'node_modules/**',
    'dist/**',
    'build/**',
    '.git/**',
    'coverage/**',
    '*.min.js',
    '*.bundle.js',
    'vendor/**',
    '__pycache__/**',
  ],
};

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Error thrown when file size checks fail
 */
export class FileSizeError extends Error {
  public readonly report: FileSizeReport;

  constructor(message: string, report: FileSizeReport) {
    super(message);
    this.name = 'FileSizeError';
    this.report = report;
  }
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Estimate token count from character count.
 * Uses the approximation that 1 token ~= 4 characters.
 *
 * @param chars - Number of characters
 * @returns Estimated number of tokens
 */
export function estimateTokens(chars: number): number {
  return Math.floor(chars / 4);
}

/**
 * Check a single file against size limits
 *
 * @param filePath - Absolute path to the file
 * @param config - Configuration (uses defaults if not provided)
 * @param rootDir - Root directory for relative path calculation
 * @returns Result of the size check
 */
export async function checkFile(
  filePath: string,
  config?: FileSizeConfig,
  rootDir?: string,
): Promise<FileSizeResult> {
  const cfg = { ...DEFAULT_FILE_SIZE_CONFIG, ...config };
  const relativePath = rootDir ? relative(rootDir, filePath) : filePath;

  // Read file content
  const content = await readFile(filePath, 'utf-8');

  // Calculate metrics
  const chars = content.length;
  const lines = content.length === 0 ? 0 : content.split('\n').length;
  const estimatedTokens = estimateTokens(chars);

  // Check for violations
  const violations: FileSizeViolation[] = [];

  if (lines > cfg.maxLines) {
    violations.push({
      type: 'lines',
      actual: lines,
      limit: cfg.maxLines,
      message: `File has ${lines} lines, exceeds limit of ${cfg.maxLines}`,
    });
  }

  if (chars > cfg.maxChars) {
    violations.push({
      type: 'chars',
      actual: chars,
      limit: cfg.maxChars,
      message: `File has ${chars} characters, exceeds limit of ${cfg.maxChars}`,
    });
  }

  if (estimatedTokens > cfg.maxTokens) {
    violations.push({
      type: 'tokens',
      actual: estimatedTokens,
      limit: cfg.maxTokens,
      message: `File has ~${estimatedTokens} tokens, exceeds limit of ${cfg.maxTokens}`,
    });
  }

  return {
    file: filePath,
    relativePath,
    passed: violations.length === 0,
    lines,
    chars,
    estimatedTokens,
    violations,
  };
}

/**
 * Check all matching files in a directory
 *
 * @param rootDir - Root directory to scan
 * @param config - Configuration (uses defaults if not provided)
 * @returns Report of all file checks
 */
export async function checkDirectory(
  rootDir: string,
  config?: FileSizeConfig,
): Promise<FileSizeReport> {
  const cfg = { ...DEFAULT_FILE_SIZE_CONFIG, ...config };

  // Build glob pattern for matching extensions
  const extensionPattern =
    cfg.extensions.length === 1
      ? `**/*${cfg.extensions[0]}`
      : `**/*{${cfg.extensions.join(',')}}`;

  // Find all matching files
  const files = await glob(extensionPattern, {
    cwd: rootDir,
    absolute: true,
    ignore: cfg.excludePatterns,
    nodir: true,
  });

  // Check each file
  const results: FileSizeResult[] = [];
  for (const file of files) {
    const result = await checkFile(file, cfg, rootDir);
    results.push(result);
  }

  // Build report
  const passedFiles = results.filter((r) => r.passed).length;
  const failedFiles = results.filter((r) => !r.passed).length;

  return {
    totalFiles: results.length,
    passedFiles,
    failedFiles,
    results,
  };
}

/**
 * Check specific files (useful for git staged files)
 *
 * @param files - List of file paths (absolute or relative to rootDir)
 * @param rootDir - Root directory for resolving relative paths
 * @param config - Configuration (uses defaults if not provided)
 * @returns Report of all file checks
 */
export async function checkFiles(
  files: string[],
  rootDir: string,
  config?: FileSizeConfig,
): Promise<FileSizeReport> {
  const cfg = { ...DEFAULT_FILE_SIZE_CONFIG, ...config };

  // Filter and resolve file paths
  const results: FileSizeResult[] = [];

  for (const file of files) {
    // Resolve to absolute path
    const absolutePath = file.startsWith('/') ? file : join(rootDir, file);
    const ext = extname(absolutePath);

    // Skip if not a matching extension
    if (!cfg.extensions.includes(ext)) {
      continue;
    }

    // Skip if matches exclude pattern
    const relativePath = relative(rootDir, absolutePath);
    const isExcluded = cfg.excludePatterns.some((pattern) =>
      minimatch(relativePath, pattern, { matchBase: true }),
    );
    if (isExcluded) {
      continue;
    }

    // Check if file exists
    try {
      await stat(absolutePath);
    } catch {
      // File doesn't exist, skip it
      continue;
    }

    const result = await checkFile(absolutePath, cfg, rootDir);
    results.push(result);
  }

  // Build report
  const passedFiles = results.filter((r) => r.passed).length;
  const failedFiles = results.filter((r) => !r.passed).length;

  return {
    totalFiles: results.length,
    passedFiles,
    failedFiles,
    results,
  };
}

/**
 * Assert that all files in a directory pass size checks.
 * Throws FileSizeError if any file exceeds limits.
 *
 * @param rootDir - Root directory to scan
 * @param config - Configuration (uses defaults if not provided)
 * @throws {FileSizeError} If any file exceeds size limits
 */
export async function assertFileSizes(
  rootDir: string,
  config?: FileSizeConfig,
): Promise<void> {
  const report = await checkDirectory(rootDir, config);

  if (report.failedFiles > 0) {
    const failedFiles = report.results
      .filter((r) => !r.passed)
      .map((r) => r.relativePath)
      .join(', ');

    throw new FileSizeError(
      `${report.failedFiles} file(s) exceed size limits: ${failedFiles}`,
      report,
    );
  }
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Format a report as human-readable text
 *
 * @param report - Report to format
 * @returns Human-readable string
 */
export function formatReport(report: FileSizeReport): string {
  const lines: string[] = [];

  // Header
  lines.push('File Size Check Report');
  lines.push('='.repeat(50));
  lines.push('');

  // Summary
  lines.push(`Total files checked: ${report.totalFiles}`);
  lines.push(`Files passed: ${report.passedFiles}`);
  lines.push(`Files failed: ${report.failedFiles}`);
  lines.push('');

  // Failures
  if (report.failedFiles > 0) {
    lines.push('Violations:');
    lines.push('-'.repeat(50));

    for (const result of report.results) {
      if (!result.passed) {
        lines.push('');
        lines.push(`File: ${result.relativePath}`);
        lines.push(`  Lines: ${result.lines}`);
        lines.push(`  Characters: ${result.chars}`);
        lines.push(`  Estimated tokens: ${result.estimatedTokens}`);
        lines.push('  Issues:');

        for (const violation of result.violations) {
          lines.push(`    - ${violation.type}: ${violation.actual} (limit: ${violation.limit})`);
        }
      }
    }
  } else {
    lines.push(`All ${report.totalFiles} file(s) passed size checks.`);
  }

  return lines.join('\n');
}
