/**
 * @fileoverview Git Diff Indexer for Semantic Change Tracking
 *
 * Parses `git show` and `git diff` output to create semantic change records.
 * Categorizes changes as structural, behavioral, or cosmetic.
 *
 * Based on 2025-2026 research:
 * - Change categorization improves impact analysis
 * - Hunk-level analysis enables precise change understanding
 * - Complexity metrics correlate with bug introduction rates
 */

import { execSync, exec } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import type { LiBrainianStorage, DiffRecord, DiffHunk } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DiffIndexerOptions {
  workspace: string;
  storage: LiBrainianStorage;
  commits?: string[];         // Specific commits to analyze (if empty, uses recent commits)
  maxCommits?: number;        // Limit number of commits to process (default: 100)
  sinceDate?: string;         // Only commits after this date (ISO format)
  timeoutMs?: number;         // Timeout per commit (default: 30000)
}

export interface DiffIndexerResult {
  commitsProcessed: number;
  recordsCreated: number;
  errors: Array<{ commit: string; error: string }>;
  durationMs: number;
}

export interface ParsedDiff {
  filePath: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

// ============================================================================
// CHANGE CATEGORY DETECTION
// ============================================================================

/**
 * Keywords that indicate structural changes (architecture, API, contracts).
 */
const STRUCTURAL_KEYWORDS = [
  'interface', 'class', 'export', 'import', 'extends', 'implements',
  'public', 'private', 'protected', 'static', 'abstract',
  'function', 'method', 'constructor', 'type', 'enum',
  'module', 'namespace', 'package', 'require', 'from',
];

/**
 * Keywords that indicate behavioral changes (logic, flow).
 */
const BEHAVIORAL_KEYWORDS = [
  'if', 'else', 'switch', 'case', 'for', 'while', 'do',
  'return', 'throw', 'try', 'catch', 'finally', 'await', 'async',
  'new', 'delete', 'call', 'apply', 'bind',
  '===', '!==', '==', '!=', '>', '<', '>=', '<=',
  '&&', '||', '!', '?', ':',
];

/**
 * Patterns that indicate cosmetic changes (formatting, comments).
 */
const COSMETIC_PATTERNS = [
  /^\s*\/\//, // Single-line comments
  /^\s*\/\*/, // Multi-line comment start
  /^\s*\*/, // Multi-line comment continuation
  /^\s*\*\//, // Multi-line comment end
  /^\s*$/, // Empty lines
  /^\s+$/, // Whitespace-only lines
  /^\s*["']use strict["']/, // Use strict
];

/**
 * Categorize a change based on the diff content.
 */
export function categorizeChange(addedLines: string[], removedLines: string[]): DiffRecord['changeCategory'] {
  let structuralScore = 0;
  let behavioralScore = 0;
  let cosmeticScore = 0;

  const allLines = [...addedLines, ...removedLines];

  for (const line of allLines) {
    const trimmed = line.trim();

    // Check cosmetic patterns first
    if (COSMETIC_PATTERNS.some(pattern => pattern.test(trimmed))) {
      cosmeticScore++;
      continue;
    }

    // Check for structural keywords
    for (const keyword of STRUCTURAL_KEYWORDS) {
      if (new RegExp(`\\b${keyword}\\b`).test(trimmed)) {
        structuralScore++;
        break;
      }
    }

    // Check for behavioral keywords
    for (const keyword of BEHAVIORAL_KEYWORDS) {
      if (trimmed.includes(keyword)) {
        behavioralScore++;
        break;
      }
    }
  }

  const total = structuralScore + behavioralScore + cosmeticScore;
  if (total === 0) return 'cosmetic';

  const structuralRatio = structuralScore / total;
  const behavioralRatio = behavioralScore / total;
  const cosmeticRatio = cosmeticScore / total;

  if (structuralRatio > 0.5) return 'structural';
  if (behavioralRatio > 0.5) return 'behavioral';
  if (cosmeticRatio > 0.7) return 'cosmetic';

  return 'mixed';
}

/**
 * Calculate change complexity based on hunk analysis.
 * Higher values indicate more complex changes.
 */
export function calculateComplexity(diff: ParsedDiff): number {
  const totalChanges = diff.additions + diff.deletions;
  if (totalChanges === 0) return 0;

  // Factors that increase complexity:
  // 1. Number of hunks (scattered changes are harder to understand)
  // 2. Ratio of additions to deletions (refactoring has balanced ratio)
  // 3. Total lines changed

  const hunkFactor = Math.min(diff.hunks.length / 5, 1); // Normalize to 0-1
  const changeFactor = Math.min(totalChanges / 100, 1); // Normalize to 0-1

  // Balanced changes (refactoring) are less complex than pure additions/deletions
  const addRatio = diff.additions / totalChanges;
  const balanceFactor = 1 - Math.abs(addRatio - 0.5) * 2; // 0 at extremes, 1 at 50/50

  return (hunkFactor * 0.3 + changeFactor * 0.4 + (1 - balanceFactor) * 0.3);
}

/**
 * Estimate impact score based on file type and change characteristics.
 */
export function estimateImpact(filePath: string, diff: ParsedDiff, category: DiffRecord['changeCategory']): number {
  let score = 0.5; // Base score

  // File type impact
  const ext = path.extname(filePath).toLowerCase();
  const highImpactExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java'];
  const configExtensions = ['.json', '.yaml', '.yml', '.toml', '.xml'];
  const testExtensions = ['.test.ts', '.test.js', '.spec.ts', '.spec.js'];

  if (highImpactExtensions.includes(ext)) {
    score += 0.1;
  }
  if (configExtensions.includes(ext)) {
    score += 0.15; // Config changes can have wide impact
  }
  if (testExtensions.some(te => filePath.endsWith(te))) {
    score -= 0.2; // Test changes are usually isolated
  }

  // Category impact
  switch (category) {
    case 'structural':
      score += 0.2;
      break;
    case 'behavioral':
      score += 0.1;
      break;
    case 'cosmetic':
      score -= 0.2;
      break;
    case 'mixed':
      break;
  }

  // Size impact
  const totalChanges = diff.additions + diff.deletions;
  if (totalChanges > 50) score += 0.1;
  if (totalChanges > 200) score += 0.1;

  return Math.max(0, Math.min(1, score));
}

// ============================================================================
// GIT DIFF PARSER
// ============================================================================

/**
 * Parse unified diff output to extract hunks.
 */
export function parseUnifiedDiff(diffOutput: string): ParsedDiff[] {
  const results: ParsedDiff[] = [];
  const files = diffOutput.split(/^diff --git /m).slice(1);

  for (const fileBlock of files) {
    const lines = fileBlock.split('\n');

    // Extract file path from first line
    const headerMatch = lines[0].match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const filePath = headerMatch[2];
    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;

    let currentHunk: DiffHunk | null = null;
    let addedLines: string[] = [];
    let removedLines: string[] = [];

    for (const line of lines.slice(1)) {
      // Hunk header: @@ -start,count +start,count @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          startLine: parseInt(hunkMatch[3], 10),
          length: parseInt(hunkMatch[4] || '1', 10),
          changeType: 'modify',
        };
        addedLines = [];
        removedLines = [];
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        addedLines.push(line.slice(1));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
        removedLines.push(line.slice(1));
      }
    }

    if (currentHunk) {
      // Determine change type based on line counts
      if (addedLines.length > 0 && removedLines.length === 0) {
        currentHunk.changeType = 'add';
      } else if (removedLines.length > 0 && addedLines.length === 0) {
        currentHunk.changeType = 'delete';
      } else {
        currentHunk.changeType = 'modify';
      }
      hunks.push(currentHunk);
    }

    results.push({
      filePath,
      additions,
      deletions,
      hunks,
    });
  }

  return results;
}

// ============================================================================
// GIT DIFF EXECUTOR
// ============================================================================

/**
 * Get diff for a specific commit.
 */
export async function getDiffForCommit(
  workspace: string,
  commitHash: string,
  timeoutMs: number = 30000
): Promise<DiffRecord[]> {
  return new Promise((resolve, reject) => {
    exec(
      `git show --format="" --unified=3 "${commitHash}"`,
      {
        cwd: workspace,
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git show failed for ${commitHash}: ${error.message}`));
          return;
        }

        try {
          const diffs = parseUnifiedDiff(stdout);
          const now = new Date().toISOString();

          const records: DiffRecord[] = diffs.map(diff => {
            // Get added/removed lines for categorization
            const addedLines: string[] = [];
            const removedLines: string[] = [];

            // Simple extraction from diff output
            const lines = stdout.split('\n');
            for (const line of lines) {
              if (line.startsWith('+') && !line.startsWith('+++')) {
                addedLines.push(line.slice(1));
              } else if (line.startsWith('-') && !line.startsWith('---')) {
                removedLines.push(line.slice(1));
              }
            }

            const category = categorizeChange(addedLines, removedLines);
            const complexity = calculateComplexity(diff);
            const impactScore = estimateImpact(diff.filePath, diff, category);

            return {
              id: createHash('sha256').update(`${commitHash}:${diff.filePath}`).digest('hex').slice(0, 32),
              commitHash,
              filePath: diff.filePath,
              additions: diff.additions,
              deletions: diff.deletions,
              hunkCount: diff.hunks.length,
              hunks: diff.hunks,
              changeCategory: category,
              complexity,
              impactScore,
              indexedAt: now,
            };
          });

          resolve(records);
        } catch (parseError) {
          reject(new Error(`Failed to parse diff for ${commitHash}: ${parseError}`));
        }
      }
    );
  });
}

/**
 * Get recent commit hashes.
 */
export function getRecentCommits(workspace: string, limit: number = 100, sinceDate?: string): string[] {
  try {
    let cmd = `git log --format="%H" -n ${limit}`;
    if (sinceDate) {
      cmd += ` --since="${sinceDate}"`;
    }

    const output = execSync(cmd, {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    return output.split('\n').filter(line => line.trim() !== '');
  } catch {
    return [];
  }
}

// ============================================================================
// DIFF INDEXER
// ============================================================================

/**
 * Index git diff data for commits in a repository.
 */
export async function indexDiffs(options: DiffIndexerOptions): Promise<DiffIndexerResult> {
  const startTime = Date.now();
  const {
    workspace,
    storage,
    commits,
    maxCommits = 100,
    sinceDate,
    timeoutMs = 30000,
  } = options;

  const result: DiffIndexerResult = {
    commitsProcessed: 0,
    recordsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  // Get commits to process
  const commitsToProcess = commits ?? getRecentCommits(workspace, maxCommits, sinceDate);

  // Process commits sequentially to avoid overwhelming git
  for (const commit of commitsToProcess) {
    try {
      const records = await getDiffForCommit(workspace, commit, timeoutMs);

      if (records.length > 0) {
        // Delete old records for this commit and insert new ones
        await storage.deleteDiffForCommit(commit);
        await storage.upsertDiffRecords(records);
        result.recordsCreated += records.length;
      }

      result.commitsProcessed++;
    } catch (error) {
      result.errors.push({
        commit,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get high-impact changes in recent commits.
 */
export async function getHighImpactChanges(
  storage: LiBrainianStorage,
  minImpact: number = 0.7,
  limit: number = 20
): Promise<DiffRecord[]> {
  return storage.getDiffRecords({
    minImpact,
    limit,
    orderBy: 'impact_score',
    orderDirection: 'desc',
  });
}

/**
 * Get structural changes (API/interface changes).
 */
export async function getStructuralChanges(
  storage: LiBrainianStorage,
  limit: number = 20
): Promise<DiffRecord[]> {
  return storage.getDiffRecords({
    changeCategory: 'structural',
    limit,
    orderBy: 'complexity',
    orderDirection: 'desc',
  });
}

/**
 * Get change statistics for a file.
 */
export async function getFileChangeStats(
  storage: LiBrainianStorage,
  filePath: string
): Promise<{
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  avgComplexity: number;
  dominantCategory: DiffRecord['changeCategory'];
}> {
  const records = await storage.getDiffRecords({ filePath, limit: 1000 });

  if (records.length === 0) {
    return {
      totalCommits: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      avgComplexity: 0,
      dominantCategory: 'cosmetic',
    };
  }

  const uniqueCommits = new Set(records.map(r => r.commitHash));
  const totalAdditions = records.reduce((sum, r) => sum + r.additions, 0);
  const totalDeletions = records.reduce((sum, r) => sum + r.deletions, 0);
  const avgComplexity = records.reduce((sum, r) => sum + r.complexity, 0) / records.length;

  // Count categories
  const categoryCounts = { structural: 0, behavioral: 0, cosmetic: 0, mixed: 0 };
  for (const r of records) {
    categoryCounts[r.changeCategory]++;
  }

  const dominantCategory = Object.entries(categoryCounts)
    .reduce((a, b) => a[1] > b[1] ? a : b)[0] as DiffRecord['changeCategory'];

  return {
    totalCommits: uniqueCommits.size,
    totalAdditions,
    totalDeletions,
    avgComplexity,
    dominantCategory,
  };
}
