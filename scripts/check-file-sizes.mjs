#!/usr/bin/env node
/**
 * @fileoverview Pre-commit hook to check file sizes
 *
 * Enforces maximum file size limits to prevent files from becoming too large
 * for AI tools to read. Claude Code has a ~25,000 token limit per file read.
 *
 * Usage:
 *   node scripts/check-file-sizes.mjs [--all] [--root <path>]
 *
 * Options:
 *   --all    Check all files in the repository (not just staged)
 *   --root   Root directory (defaults to cwd)
 *
 * Exit codes:
 *   0 - All files pass size checks
 *   1 - One or more files exceed size limits
 */

import { execSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, relative, extname, resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { glob } from 'glob';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
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
// UTILITIES
// ============================================================================

function parseArgs(argv) {
  const out = { root: process.cwd(), all: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --root');
      out.root = resolve(value);
      i += 1;
    } else if (arg === '--all') {
      out.all = true;
    }
  }
  return out;
}

function estimateTokens(chars) {
  return Math.floor(chars / 4);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// FILE SIZE CHECKING
// ============================================================================

async function checkFile(filePath, rootDir, config = DEFAULT_CONFIG) {
  const relativePath = relative(rootDir, filePath);

  // Read file content
  const content = await readFile(filePath, 'utf-8');

  // Calculate metrics
  const chars = content.length;
  const lines = content.length === 0 ? 0 : content.split('\n').length;
  const estimatedTokens = estimateTokens(chars);

  // Check for violations
  const violations = [];

  if (lines > config.maxLines) {
    violations.push({
      type: 'lines',
      actual: lines,
      limit: config.maxLines,
    });
  }

  if (chars > config.maxChars) {
    violations.push({
      type: 'chars',
      actual: chars,
      limit: config.maxChars,
    });
  }

  if (estimatedTokens > config.maxTokens) {
    violations.push({
      type: 'tokens',
      actual: estimatedTokens,
      limit: config.maxTokens,
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

async function getStagedFiles(rootDir) {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: rootDir,
      encoding: 'utf-8',
    });
    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => join(rootDir, line));
  } catch {
    return [];
  }
}

async function getAllFiles(rootDir, config = DEFAULT_CONFIG) {
  const extensionPattern =
    config.extensions.length === 1
      ? `**/*${config.extensions[0]}`
      : `**/*{${config.extensions.join(',')}}`;

  return glob(extensionPattern, {
    cwd: rootDir,
    absolute: true,
    ignore: config.excludePatterns,
    nodir: true,
  });
}

function shouldCheckFile(filePath, rootDir, config = DEFAULT_CONFIG) {
  const ext = extname(filePath);

  // Check extension
  if (!config.extensions.includes(ext)) {
    return false;
  }

  // Check exclude patterns
  const relativePath = relative(rootDir, filePath);
  const isExcluded = config.excludePatterns.some((pattern) =>
    minimatch(relativePath, pattern, { matchBase: true }),
  );

  return !isExcluded;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { root, all } = parseArgs(process.argv);

  // Get files to check
  let filesToCheck;
  if (all) {
    filesToCheck = await getAllFiles(root);
  } else {
    const stagedFiles = await getStagedFiles(root);
    filesToCheck = stagedFiles.filter((f) => shouldCheckFile(f, root));
  }

  if (filesToCheck.length === 0) {
    process.stdout.write('[file-size-guard] No files to check\n');
    process.exit(0);
  }

  // Check each file
  const results = [];
  for (const file of filesToCheck) {
    if (!(await fileExists(file))) {
      continue;
    }
    const result = await checkFile(file, root);
    results.push(result);
  }

  // Calculate summary
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  // Output results
  if (failed.length === 0) {
    process.stdout.write(`[file-size-guard] OK - ${passed.length} file(s) checked\n`);
    process.exit(0);
  }

  // Report failures
  process.stderr.write(`[file-size-guard] FAIL - ${failed.length} file(s) exceed size limits\n\n`);

  for (const result of failed) {
    process.stderr.write(`File: ${result.relativePath}\n`);
    process.stderr.write(`  Lines: ${result.lines} (limit: ${DEFAULT_CONFIG.maxLines})\n`);
    process.stderr.write(`  Characters: ${result.chars} (limit: ${DEFAULT_CONFIG.maxChars})\n`);
    process.stderr.write(`  Estimated tokens: ${result.estimatedTokens} (limit: ${DEFAULT_CONFIG.maxTokens})\n`);
    process.stderr.write('  Violations:\n');
    for (const v of result.violations) {
      process.stderr.write(`    - ${v.type}: ${v.actual} exceeds limit of ${v.limit}\n`);
    }
    process.stderr.write('\n');
  }

  process.stderr.write('Consider splitting large files into smaller modules.\n');
  process.stderr.write('This ensures AI tools can read the entire file.\n');
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[file-size-guard] ERROR: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
