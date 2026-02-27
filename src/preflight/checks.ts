/**
 * @fileoverview Pre-flight Checks for Bootstrap and Major Operations
 *
 * Detects potential problems at the earliest possible interval before
 * they can cause issues during major operations like bootstrap.
 *
 * Philosophy: It's better to fail fast with a clear message than to
 * fail slowly with cryptic errors deep in the execution.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkAllProviders, type AllProviderStatus } from '../api/provider_check.js';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import { resolveWorkspaceRoot } from '../utils/workspace_resolver.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Severity levels for pre-flight checks
 */
export type CheckSeverity = 'critical' | 'warning' | 'info';

/**
 * Category of the check
 */
export type CheckCategory =
  | 'environment'
  | 'providers'
  | 'storage'
  | 'filesystem'
  | 'configuration'
  | 'dependencies';

/**
 * Result of a single pre-flight check
 */
export interface PreflightCheckResult {
  /** Unique check identifier */
  checkId: string;
  /** Human-readable name */
  name: string;
  /** Category of the check */
  category: CheckCategory;
  /** Whether the check passed */
  passed: boolean;
  /** Severity if failed */
  severity: CheckSeverity;
  /** Detailed message */
  message: string;
  /** Suggested fix if failed */
  suggestedFix?: string;
  /** Time taken to run check (ms) */
  durationMs: number;
}

/**
 * Overall pre-flight report
 */
export interface PreflightReport {
  /** Whether all critical checks passed */
  canProceed: boolean;
  /** Total checks run */
  totalChecks: number;
  /** Checks that passed */
  passedChecks: number;
  /** Checks that failed */
  failedChecks: PreflightCheckResult[];
  /** Warnings (non-blocking) */
  warnings: PreflightCheckResult[];
  /** Informational messages */
  info: PreflightCheckResult[];
  /** Total time to run all checks */
  totalDurationMs: number;
  /** Timestamp */
  timestamp: string;
}

/**
 * Options for running pre-flight checks
 */
export interface PreflightOptions {
  /** Workspace root directory */
  workspaceRoot: string;
  /** Skip provider checks (for offline mode) */
  skipProviderChecks?: boolean;
  /** Force live provider probing (bootstrap-grade) */
  forceProbe?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Specific checks to run (runs all if not specified) */
  onlyChecks?: string[];
  /** Internal: cached provider status for this preflight run */
  providerStatusCache?: Promise<AllProviderStatus>;
}

// ============================================================================
// CHECK IMPLEMENTATIONS
// ============================================================================

type CheckFunction = (options: PreflightOptions) => Promise<PreflightCheckResult>;

/**
 * Check: Environment variables are set correctly
 *
 * Note: Wave0 uses CLI-based authentication; do not check for API keys here.
 * Actual provider readiness is verified by checkLLMProvider/checkEmbeddingProvider.
 */
const checkEnvironmentVariables: CheckFunction = async (options) => {
  const startTime = Date.now();
  const warnings: string[] = [];
  const criticalIssues: string[] = [];
  const suggestions: string[] = [];

  const provider = process.env.LIBRARIAN_LLM_PROVIDER?.trim();
  if (provider && provider !== 'claude' && provider !== 'codex') {
    criticalIssues.push(`LIBRARIAN_LLM_PROVIDER must be 'claude' or 'codex' (got ${provider})`);
    suggestions.push('Unset LIBRARIAN_LLM_PROVIDER or set it to claude/codex');
  }

  // Check for common misconfigurations - these are critical
  if (process.env.LIBRARIAN_LLM_MODEL && !process.env.LIBRARIAN_LLM_PROVIDER) {
    criticalIssues.push('LIBRARIAN_LLM_MODEL is set but LIBRARIAN_LLM_PROVIDER is not');
    suggestions.push('Set LIBRARIAN_LLM_PROVIDER to match your model');
  }

  const hasCritical = criticalIssues.length > 0;
  const hasWarnings = warnings.length > 0;
  const allIssues = [...criticalIssues, ...warnings];

  return {
    checkId: 'env_variables',
    name: 'Environment Variables',
    category: 'environment',
    passed: !hasCritical,
    severity: hasCritical ? 'critical' : (hasWarnings ? 'warning' : 'info'),
    message: allIssues.length > 0
      ? `Environment issues: ${allIssues.join('; ')}`
      : 'Environment variables configured correctly',
    suggestedFix: suggestions.length > 0 ? suggestions.join('; ') : undefined,
    durationMs: Date.now() - startTime,
  };
};

async function getProviderStatus(options: PreflightOptions): Promise<AllProviderStatus> {
  const cached = options.providerStatusCache;
  if (cached) return cached;
  return checkAllProviders({
    workspaceRoot: options.workspaceRoot,
    forceProbe: options.forceProbe ?? false,
  });
}

/**
 * Check: LLM provider is accessible
 */
const checkLLMProvider: CheckFunction = async (options) => {
  const startTime = Date.now();

  if (options.skipProviderChecks) {
    return {
      checkId: 'llm_provider',
      name: 'LLM Provider',
      category: 'providers',
      passed: true,
      severity: 'info',
      message: 'Provider check skipped (offline mode)',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const status = await getProviderStatus(options);

    if (!status.llm.available) {
      return {
        checkId: 'llm_provider',
        name: 'LLM Provider',
        category: 'providers',
        passed: false,
        severity: 'critical',
        message: `LLM provider unavailable: ${status.llm.error || 'Unknown error'}`,
        suggestedFix: 'Authenticate via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`) or wait for rate/usage limits to reset',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      checkId: 'llm_provider',
      name: 'LLM Provider',
      category: 'providers',
      passed: true,
      severity: 'info',
      message: `LLM provider available: ${status.llm.provider} (${status.llm.model})`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      checkId: 'llm_provider',
      name: 'LLM Provider',
      category: 'providers',
      passed: false,
      severity: 'critical',
      message: `LLM provider check failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: 'Authenticate via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`) and retry',
      durationMs: Date.now() - startTime,
    };
  }
};

/**
 * Check: Embedding provider is accessible
 */
const checkEmbeddingProvider: CheckFunction = async (options) => {
  const startTime = Date.now();

  if (options.skipProviderChecks) {
    return {
      checkId: 'embedding_provider',
      name: 'Embedding Provider',
      category: 'providers',
      passed: true,
      severity: 'info',
      message: 'Provider check skipped (offline mode)',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const status = await getProviderStatus(options);

    if (!status.embedding.available) {
      return {
        checkId: 'embedding_provider',
        name: 'Embedding Provider',
        category: 'providers',
        passed: false,
        severity: 'critical',
        message: `Embedding provider unavailable: ${status.embedding.error || 'Unknown error'}`,
        suggestedFix: 'Install a real embedding provider (e.g. @huggingface/transformers) and retry',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      checkId: 'embedding_provider',
      name: 'Embedding Provider',
      category: 'providers',
      passed: true,
      severity: 'info',
      message: `Embedding provider available: ${status.embedding.provider}`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      checkId: 'embedding_provider',
      name: 'Embedding Provider',
      category: 'providers',
      passed: false,
      severity: 'critical',
      message: `Embedding provider check failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: 'Verify embedding provider installation and file permissions',
      durationMs: Date.now() - startTime,
    };
  }
};

/**
 * Check: Workspace directory exists and is accessible
 */
const checkWorkspaceDirectory: CheckFunction = async (options) => {
  const startTime = Date.now();

  if (!fs.existsSync(options.workspaceRoot)) {
    return {
      checkId: 'workspace_dir',
      name: 'Workspace Directory',
      category: 'filesystem',
      passed: false,
      severity: 'critical',
      message: `Workspace directory does not exist: ${options.workspaceRoot}`,
      suggestedFix: 'Ensure the workspace path is correct',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const stats = fs.statSync(options.workspaceRoot);
    if (!stats.isDirectory()) {
      return {
        checkId: 'workspace_dir',
        name: 'Workspace Directory',
        category: 'filesystem',
        passed: false,
        severity: 'critical',
        message: `Workspace path is not a directory: ${options.workspaceRoot}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Check if writable
    const testFile = path.join(options.workspaceRoot, '.librarian', '.preflight_test');
    const librarianDir = path.dirname(testFile);

    if (!fs.existsSync(librarianDir)) {
      fs.mkdirSync(librarianDir, { recursive: true });
    }

    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);

    return {
      checkId: 'workspace_dir',
      name: 'Workspace Directory',
      category: 'filesystem',
      passed: true,
      severity: 'info',
      message: 'Workspace directory is accessible and writable',
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      checkId: 'workspace_dir',
      name: 'Workspace Directory',
      category: 'filesystem',
      passed: false,
      severity: 'critical',
      message: `Workspace not writable: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: 'Check file permissions',
      durationMs: Date.now() - startTime,
    };
  }
};

const checkWorkspaceRootCandidate: CheckFunction = async (options) => {
  const startTime = Date.now();
  const resolution = resolveWorkspaceRoot(options.workspaceRoot);
  if (resolution.changed) {
    return {
      checkId: 'workspace_root',
      name: 'Workspace Root',
      category: 'filesystem',
      passed: false,
      severity: 'warning',
      message: `Workspace appears to be a subdirectory; detected project root at ${resolution.workspace}`,
      suggestedFix: `Re-run with workspace root: ${resolution.workspace}`,
      durationMs: Date.now() - startTime,
    };
  }
  return {
    checkId: 'workspace_root',
    name: 'Workspace Root',
    category: 'filesystem',
    passed: true,
    severity: 'info',
    message: 'Workspace root appears correct',
    durationMs: Date.now() - startTime,
  };
};

/**
 * Check: Sufficient disk space
 */
const checkDiskSpace: CheckFunction = async (options) => {
  const startTime = Date.now();

  try {
    // Try to get disk space using df command (Unix-like systems)
    const { execSync } = await import('node:child_process');
    const output = execSync(`df -k "${options.workspaceRoot}"`, { encoding: 'utf-8' });
    const lines = output.trim().split('\n');

    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availableKB = parseInt(parts[3], 10);
      const availableMB = availableKB / 1024;
      const availableGB = availableMB / 1024;

      if (availableMB < 100) {
        return {
          checkId: 'disk_space',
          name: 'Disk Space',
          category: 'filesystem',
          passed: false,
          severity: 'critical',
          message: `Low disk space: ${availableMB.toFixed(0)}MB available`,
          suggestedFix: 'Free up disk space before bootstrapping',
          durationMs: Date.now() - startTime,
        };
      }

      if (availableMB < 500) {
        return {
          checkId: 'disk_space',
          name: 'Disk Space',
          category: 'filesystem',
          passed: true,
          severity: 'warning',
          message: `Limited disk space: ${availableMB.toFixed(0)}MB available`,
          suggestedFix: 'Consider freeing up disk space',
          durationMs: Date.now() - startTime,
        };
      }

      return {
        checkId: 'disk_space',
        name: 'Disk Space',
        category: 'filesystem',
        passed: true,
        severity: 'info',
        message: `Sufficient disk space: ${availableGB.toFixed(1)}GB available`,
        durationMs: Date.now() - startTime,
      };
    }
  } catch {
    // Disk space check not available on this platform
  }

  return {
    checkId: 'disk_space',
    name: 'Disk Space',
    category: 'filesystem',
    passed: true,
    severity: 'info',
    message: 'Disk space check not available on this platform',
    durationMs: Date.now() - startTime,
  };
};

/**
 * Check: Database file is accessible (if exists)
 */
const checkDatabaseAccess: CheckFunction = async (options) => {
  const startTime = Date.now();
  const dbPath = path.join(options.workspaceRoot, '.librarian', 'librarian.db');

  if (!fs.existsSync(dbPath)) {
    return {
      checkId: 'database_access',
      name: 'Database Access',
      category: 'storage',
      passed: true,
      severity: 'info',
      message: 'Database does not exist yet (will be created)',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Check if we can read and write
    const stats = fs.statSync(dbPath);
    const sizeMB = stats.size / (1024 * 1024);

    // Try to open for reading
    const fd = fs.openSync(dbPath, 'r+');
    fs.closeSync(fd);

    return {
      checkId: 'database_access',
      name: 'Database Access',
      category: 'storage',
      passed: true,
      severity: 'info',
      message: `Database accessible (${sizeMB.toFixed(1)}MB)`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      checkId: 'database_access',
      name: 'Database Access',
      category: 'storage',
      passed: false,
      severity: 'critical',
      message: `Database not accessible: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: 'Check file permissions or remove corrupted database',
      durationMs: Date.now() - startTime,
    };
  }
};

/**
 * Check: Source files exist in workspace
 */
const checkSourceFiles: CheckFunction = async (options) => {
  const startTime = Date.now();

  try {
    const fileCount = countSourceFilesRecursive(options.workspaceRoot);

    if (fileCount === 0) {
      return {
        checkId: 'source_files',
        name: 'Source Files',
        category: 'filesystem',
        passed: false,
        severity: 'warning',
        message: 'No source files found in workspace',
        suggestedFix: 'Ensure you are in the correct directory',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      checkId: 'source_files',
      name: 'Source Files',
      category: 'filesystem',
      passed: true,
      severity: 'info',
      message: `Found approximately ${fileCount} source files`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      checkId: 'source_files',
      name: 'Source Files',
      category: 'filesystem',
      passed: true,
      severity: 'warning',
      message: 'Could not count source files',
      durationMs: Date.now() - startTime,
    };
  }
};

/**
 * Check: Memory availability
 */
const checkMemory: CheckFunction = async (_options) => {
  const startTime = Date.now();

  try {
    const used = process.memoryUsage();
    const heapUsedMB = used.heapUsed / (1024 * 1024);
    const heapTotalMB = used.heapTotal / (1024 * 1024);
    const rssMB = used.rss / (1024 * 1024);

    // Check if we're already using too much memory
    if (heapUsedMB > 500) {
      return {
        checkId: 'memory',
        name: 'Memory Availability',
        category: 'environment',
        passed: true,
        severity: 'warning',
        message: `High memory usage: ${heapUsedMB.toFixed(0)}MB heap`,
        suggestedFix: 'Consider restarting the process before bootstrap',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      checkId: 'memory',
      name: 'Memory Availability',
      category: 'environment',
      passed: true,
      severity: 'info',
      message: `Memory: ${heapUsedMB.toFixed(0)}MB heap, ${rssMB.toFixed(0)}MB RSS`,
      durationMs: Date.now() - startTime,
    };
  } catch {
    return {
      checkId: 'memory',
      name: 'Memory Availability',
      category: 'environment',
      passed: true,
      severity: 'info',
      message: 'Memory check not available',
      durationMs: Date.now() - startTime,
    };
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function countSourceFilesRecursive(root: string): number {
  const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt']);
  const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    '.hg',
    '.svn',
    '.librarian',
    '.next',
    '.turbo',
    '.cache',
    'dist',
    'build',
    'coverage',
  ]);
  const MAX_VISITED = 200_000;

  const stack: string[] = [root];
  let count = 0;
  let visited = 0;

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      if (visited >= MAX_VISITED) {
        return count;
      }
      const ext = path.extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        count += 1;
      }
    }
  }

  return count;
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * All available pre-flight checks
 */
const ALL_CHECKS: Map<string, CheckFunction> = new Map([
  ['env_variables', checkEnvironmentVariables],
  ['llm_provider', checkLLMProvider],
  ['embedding_provider', checkEmbeddingProvider],
  ['workspace_dir', checkWorkspaceDirectory],
  ['workspace_root', checkWorkspaceRootCandidate],
  ['disk_space', checkDiskSpace],
  ['database_access', checkDatabaseAccess],
  ['source_files', checkSourceFiles],
  ['memory', checkMemory],
]);

/**
 * Run all pre-flight checks
 */
export async function runPreflightChecks(
  options: PreflightOptions
): Promise<PreflightReport> {
  const startTime = Date.now();
  const results: PreflightCheckResult[] = [];
  const providerStatusCache = options.skipProviderChecks
    ? undefined
    : checkAllProviders({
        workspaceRoot: options.workspaceRoot,
        forceProbe: options.forceProbe ?? false,
      });
  const effectiveOptions: PreflightOptions = {
    ...options,
    providerStatusCache,
  };

  const checksToRun = options.onlyChecks
    ? Array.from(ALL_CHECKS.entries()).filter(([id]) => options.onlyChecks!.includes(id))
    : Array.from(ALL_CHECKS.entries());

  logInfo('[preflight] Starting pre-flight checks', {
    checksCount: checksToRun.length,
    workspace: options.workspaceRoot,
  });

  for (const [checkId, checkFn] of checksToRun) {
    try {
      const result = await checkFn(effectiveOptions);
      results.push(result);

      if (options.verbose) {
        const icon = result.passed ? '\u2705' : result.severity === 'critical' ? '\u274C' : '\u26A0\uFE0F';
        console.log(`  ${icon} ${result.name}: ${result.message}`);
      }
    } catch (error) {
      results.push({
        checkId,
        name: checkId,
        category: 'environment',
        passed: false,
        severity: 'critical',
        message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: 0,
      });
    }
  }

  const failedChecks = results.filter((r) => !r.passed && r.severity === 'critical');
  const warnings = results.filter((r) => !r.passed && r.severity === 'warning');
  const info = results.filter((r) => r.passed || r.severity === 'info');

  const report: PreflightReport = {
    canProceed: failedChecks.length === 0,
    totalChecks: results.length,
    passedChecks: results.filter((r) => r.passed).length,
    failedChecks,
    warnings,
    info,
    totalDurationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };

  if (report.canProceed) {
    logInfo('[preflight] All critical checks passed', {
      passed: report.passedChecks,
      warnings: warnings.length,
      duration: report.totalDurationMs,
    });
  } else {
    logError('[preflight] Critical checks failed', {
      failed: failedChecks.length,
      warnings: warnings.length,
    });
  }

  return report;
}

/**
 * Print pre-flight report to console
 */
export function printPreflightReport(report: PreflightReport): void {
  console.log('\n=== Pre-flight Checks ===\n');

  if (report.failedChecks.length > 0) {
    console.log('\u274C Critical Issues:');
    for (const check of report.failedChecks) {
      console.log(`  - ${check.name}: ${check.message}`);
      if (check.suggestedFix) {
        console.log(`    Fix: ${check.suggestedFix}`);
      }
    }
    console.log();
  }

  if (report.warnings.length > 0) {
    console.log('\u26A0\uFE0F  Warnings:');
    for (const check of report.warnings) {
      console.log(`  - ${check.name}: ${check.message}`);
      if (check.suggestedFix) {
        console.log(`    Fix: ${check.suggestedFix}`);
      }
    }
    console.log();
  }

  console.log(`Checks: ${report.passedChecks}/${report.totalChecks} passed`);
  console.log(`Duration: ${report.totalDurationMs}ms\n`);

  if (report.canProceed) {
    console.log('\u2705 All critical checks passed. Ready to proceed.\n');
  } else {
    console.log('\u274C Cannot proceed. Please fix the issues above.\n');
  }
}
