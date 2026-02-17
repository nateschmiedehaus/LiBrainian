/**
 * @fileoverview Co-Change Signals from Git History
 *
 * Files that change together in commits are likely semantically related.
 * This module extracts co-change patterns from git history to:
 * 1. Boost similarity scores for frequently co-changed files
 * 2. Discover implicit relationships embeddings miss
 * 3. Capture developer intent (what files belong together)
 *
 * KEY INSIGHT: Embeddings measure text similarity,
 * but git history captures behavioral relationships.
 *
 * Example:
 *   auth.ts and session.ts always change together
 *   → Even if embeddings don't see the connection, they're related
 */

import { execSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logDebug } from '../../telemetry/logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CommitInfo {
  hash: string;
  timestamp: number;
  files: string[];
}

export interface CoChangeMatrix {
  /** Map of file pairs to co-change count */
  pairCounts: Map<string, number>;
  /** Map of file to total commits */
  fileCounts: Map<string, number>;
  /** Total commits analyzed */
  totalCommits: number;
}

export interface CoChangeScore {
  /** Raw count of commits where both files changed */
  rawCount: number;
  /** Jaccard similarity: |A ∩ B| / |A ∪ B| */
  jaccard: number;
  /** Conditional probability: P(B|A) - if A changes, how often does B? */
  conditionalAB: number;
  /** Conditional probability: P(A|B) - if B changes, how often does A? */
  conditionalBA: number;
  /** Combined score (geometric mean of conditionals) */
  score: number;
}

export interface CoChangeOptions {
  /** Maximum commits to analyze */
  maxCommits?: number;
  /** Only consider commits within this many days */
  daysBack?: number;
  /** Minimum files in commit (skip single-file commits) */
  minFilesPerCommit?: number;
  /** Maximum files in commit (skip huge refactors) */
  maxFilesPerCommit?: number;
  /** File patterns to include */
  includePatterns?: RegExp[];
  /** File patterns to exclude */
  excludePatterns?: RegExp[];
}

// ============================================================================
// GIT HISTORY EXTRACTION
// ============================================================================

function isInsideGitWorkTree(repoPath: string): boolean {
  // Fast path: if we're in the repo root, `.git` exists (dir or file in worktrees).
  // This avoids spawning git on common paths.
  try {
    if (fs.existsSync(path.join(repoPath, '.git'))) return true;
  } catch {
    // ignore
  }

  // Robust path: support subdirectories inside a repo.
  try {
    const output = execSync('git rev-parse --is-inside-work-tree', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Extract commit history from git.
 */
export function extractCommitHistory(
  repoPath: string,
  options: CoChangeOptions = {}
): CommitInfo[] {
  const {
    maxCommits = 1000,
    daysBack = 365,
    minFilesPerCommit = 2,
    maxFilesPerCommit = 50,
    includePatterns = [/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/],
    excludePatterns = [/node_modules/, /\.test\.(ts|js)$/, /\.spec\.(ts|js)$/, /__tests__/],
  } = options;

  const commits: CommitInfo[] = [];

  try {
    if (!isInsideGitWorkTree(repoPath)) return commits;

    // Get commit hashes with timestamps
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysBack);
    const since = sinceDate.toISOString().split('T')[0];

    const logCmd = `git log --since="${since}" --format="%H %ct" --name-only -n ${maxCommits}`;
    const output = execSync(logCmd, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 50 * 1024 * 1024,
    });

    // Parse output
    // Format is: HASH TIMESTAMP\n\nfile1\nfile2\n...\nHASH TIMESTAMP\n\n...
    let currentCommit: CommitInfo | null = null;
    let lastWasHeader = false;

    for (const line of output.split('\n')) {
      const trimmed = line.trim();

      // Check if this is a commit header line (hash + timestamp)
      const headerMatch = trimmed.match(/^([a-f0-9]{40})\s+(\d+)$/);
      if (headerMatch) {
        // Save previous commit if valid
        if (currentCommit && currentCommit.files.length >= minFilesPerCommit &&
            currentCommit.files.length <= maxFilesPerCommit) {
          commits.push(currentCommit);
        }
        currentCommit = {
          hash: headerMatch[1],
          timestamp: parseInt(headerMatch[2], 10) * 1000,
          files: [],
        };
        lastWasHeader = true;
        continue;
      }

      // Skip empty line after header
      if (!trimmed) {
        if (lastWasHeader) {
          lastWasHeader = false;
          continue;
        }
        // Empty line after files = end of commit
        if (currentCommit && currentCommit.files.length >= minFilesPerCommit &&
            currentCommit.files.length <= maxFilesPerCommit) {
          commits.push(currentCommit);
        }
        currentCommit = null;
        continue;
      }

      lastWasHeader = false;

      // This is a file path
      if (currentCommit) {
        // Apply filters
        const matchesInclude = includePatterns.some((p) => p.test(trimmed));
        const matchesExclude = excludePatterns.some((p) => p.test(trimmed));

        if (matchesInclude && !matchesExclude) {
          currentCommit.files.push(trimmed);
        }
      }
    }

    // Don't forget the last commit
    if (currentCommit && currentCommit.files.length >= minFilesPerCommit &&
        currentCommit.files.length <= maxFilesPerCommit) {
      commits.push(currentCommit);
    }
  } catch (error) {
    // Non-fatal: git history is an optional signal and many workspaces (extracted fixtures,
    // vendored repos, CI sandboxes) are not git repositories.
    logDebug('[co-change] Failed to extract git history; continuing without co-change signals', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return commits;
}

// ============================================================================
// CO-CHANGE MATRIX CONSTRUCTION
// ============================================================================

/**
 * Build co-change matrix from commit history.
 */
export function buildCoChangeMatrix(commits: CommitInfo[]): CoChangeMatrix {
  const pairCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();

  for (const commit of commits) {
    // Count individual file appearances
    for (const file of commit.files) {
      fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    }

    // Count file pairs (all combinations)
    const files = commit.files.sort();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const pairKey = `${files[i]}|${files[j]}`;
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
  }

  return {
    pairCounts,
    fileCounts,
    totalCommits: commits.length,
  };
}

/**
 * Compute co-change score between two files.
 */
export function computeCoChangeScore(
  fileA: string,
  fileB: string,
  matrix: CoChangeMatrix
): CoChangeScore {
  // Normalize paths
  const normA = normalizeFilePath(fileA);
  const normB = normalizeFilePath(fileB);

  // Get pair key (sorted for consistency)
  const [first, second] = [normA, normB].sort();
  const pairKey = `${first}|${second}`;

  const rawCount = matrix.pairCounts.get(pairKey) || 0;
  const countA = matrix.fileCounts.get(normA) || 0;
  const countB = matrix.fileCounts.get(normB) || 0;

  // No data
  if (rawCount === 0 || countA === 0 || countB === 0) {
    return {
      rawCount: 0,
      jaccard: 0,
      conditionalAB: 0,
      conditionalBA: 0,
      score: 0,
    };
  }

  // Jaccard: |A ∩ B| / |A ∪ B|
  const jaccard = rawCount / (countA + countB - rawCount);

  // Conditional probabilities
  const conditionalAB = rawCount / countA; // P(B|A)
  const conditionalBA = rawCount / countB; // P(A|B)

  // Combined score: geometric mean of conditionals
  const score = Math.sqrt(conditionalAB * conditionalBA);

  return {
    rawCount,
    jaccard,
    conditionalAB,
    conditionalBA,
    score,
  };
}

/**
 * Normalize file path for comparison.
 */
function normalizeFilePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.ts$|\.js$/, '');
}

// ============================================================================
// CO-CHANGE ANALYSIS
// ============================================================================

export interface FileCluster {
  name: string;
  files: string[];
  avgCoChange: number;
}

/**
 * Discover file clusters based on co-change patterns.
 */
export function discoverFileClusters(
  matrix: CoChangeMatrix,
  options: {
    minCoChange?: number;
    maxClusterSize?: number;
  } = {}
): FileCluster[] {
  const { minCoChange = 0.3, maxClusterSize = 10 } = options;

  const clusters: FileCluster[] = [];
  const assigned = new Set<string>();

  // Sort files by total commits (most active first)
  const files = Array.from(matrix.fileCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);

  for (const seedFile of files) {
    if (assigned.has(seedFile)) continue;

    // Find files that co-change with seed
    const cluster: string[] = [seedFile];
    const candidates: Array<{ file: string; score: number }> = [];

    for (const otherFile of files) {
      if (otherFile === seedFile || assigned.has(otherFile)) continue;

      const score = computeCoChangeScore(seedFile, otherFile, matrix);
      if (score.score >= minCoChange) {
        candidates.push({ file: otherFile, score: score.score });
      }
    }

    // Add top candidates to cluster
    candidates.sort((a, b) => b.score - a.score);
    for (const { file } of candidates.slice(0, maxClusterSize - 1)) {
      cluster.push(file);
      assigned.add(file);
    }

    if (cluster.length >= 2) {
      // Compute average co-change within cluster
      let totalScore = 0;
      let pairs = 0;
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          totalScore += computeCoChangeScore(cluster[i], cluster[j], matrix).score;
          pairs++;
        }
      }

      clusters.push({
        name: inferClusterName(cluster),
        files: cluster,
        avgCoChange: pairs > 0 ? totalScore / pairs : 0,
      });
    }

    assigned.add(seedFile);
  }

  return clusters.sort((a, b) => b.avgCoChange - a.avgCoChange);
}

/**
 * Infer a name for a cluster based on common path components.
 */
function inferClusterName(files: string[]): string {
  if (files.length === 0) return 'unknown';

  // Find common path prefix
  const parts = files.map((f) => f.split('/'));
  const minLength = Math.min(...parts.map((p) => p.length));

  let commonDepth = 0;
  for (let i = 0; i < minLength - 1; i++) {
    const part = parts[0][i];
    if (parts.every((p) => p[i] === part)) {
      commonDepth = i + 1;
    } else {
      break;
    }
  }

  if (commonDepth > 0) {
    return parts[0].slice(0, commonDepth).join('/');
  }

  // Fallback: use first file's directory
  return path.dirname(files[0]) || 'root';
}

// ============================================================================
// INTEGRATION WITH SIMILARITY
// ============================================================================

/**
 * Boost similarity score based on co-change history.
 */
export function boostWithCoChange(
  semanticSimilarity: number,
  coChangeScore: CoChangeScore,
  options: {
    coChangeWeight?: number;
    minCoChangeForBoost?: number;
    maxBoost?: number;
  } = {}
): {
  boostedSimilarity: number;
  coChangeContribution: number;
} {
  const {
    coChangeWeight = 0.3,
    minCoChangeForBoost = 0.1,
    maxBoost = 0.3,
  } = options;

  // No boost if co-change is too weak
  if (coChangeScore.score < minCoChangeForBoost) {
    return {
      boostedSimilarity: semanticSimilarity,
      coChangeContribution: 0,
    };
  }

  // Compute boost: stronger co-change = bigger boost
  const boost = Math.min(maxBoost, coChangeScore.score * coChangeWeight);

  // Apply boost (additive, capped at 1.0)
  const boostedSimilarity = Math.min(1.0, semanticSimilarity + boost);

  return {
    boostedSimilarity,
    coChangeContribution: boost,
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

export interface SerializedCoChangeMatrix {
  version: 1;
  timestamp: number;
  totalCommits: number;
  pairs: Array<[string, number]>;
  files: Array<[string, number]>;
}

/**
 * Serialize co-change matrix for storage.
 */
export function serializeMatrix(matrix: CoChangeMatrix): SerializedCoChangeMatrix {
  return {
    version: 1,
    timestamp: Date.now(),
    totalCommits: matrix.totalCommits,
    pairs: Array.from(matrix.pairCounts.entries()),
    files: Array.from(matrix.fileCounts.entries()),
  };
}

/**
 * Deserialize co-change matrix from storage.
 */
export function deserializeMatrix(data: SerializedCoChangeMatrix): CoChangeMatrix {
  return {
    pairCounts: new Map(data.pairs),
    fileCounts: new Map(data.files),
    totalCommits: data.totalCommits,
  };
}

// All exports are inline above
