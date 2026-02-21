/**
 * @fileoverview Git Reflog Indexer for Branch History and Workflow Tracking
 *
 * Parses `git reflog` output to capture development workflow patterns.
 * Tracks reverted changes, rebases, and branch history.
 *
 * Based on 2025-2026 research:
 * - Reflog analysis reveals development patterns
 * - Reverted changes indicate potential issues
 * - Branch topology affects merge conflict frequency
 */

import { execSync, exec } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import type { LiBrainianStorage, ReflogEntry } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ReflogIndexerOptions {
  workspace: string;
  storage: LiBrainianStorage;
  refs?: string[];            // Specific refs to track (default: HEAD)
  maxEntries?: number;        // Limit entries per ref (default: 500)
  sinceDate?: string;         // Only entries after this date
  includeRemotes?: boolean;   // Include remote branch refs (default: false)
}

export interface ReflogIndexerResult {
  refsProcessed: number;
  entriesCreated: number;
  errors: Array<{ ref: string; error: string }>;
  durationMs: number;
}

export interface ParsedReflogEntry {
  commitHash: string;
  reflogSelector: string;      // e.g., "HEAD@{0}"
  action: ReflogEntry['action'];
  message: string;
  previousCommit?: string;
  timestamp?: string;
  author?: string;
}

// ============================================================================
// ACTION DETECTION
// ============================================================================

/**
 * Parse the action type from a reflog message.
 */
export function parseAction(message: string): ReflogEntry['action'] {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.startsWith('commit:') || lowerMessage.startsWith('commit (initial):')) {
    return 'commit';
  }
  if (lowerMessage.startsWith('rebase')) {
    return 'rebase';
  }
  if (lowerMessage.startsWith('reset:')) {
    return 'reset';
  }
  if (lowerMessage.startsWith('merge')) {
    return 'merge';
  }
  if (lowerMessage.startsWith('checkout:')) {
    return 'checkout';
  }
  if (lowerMessage.startsWith('cherry-pick')) {
    return 'cherry-pick';
  }
  if (lowerMessage.startsWith('revert')) {
    return 'revert';
  }
  if (lowerMessage.startsWith('pull:') || lowerMessage.includes('fast-forward')) {
    return 'pull';
  }

  return 'other';
}

/**
 * Extract the previous commit from a reset message.
 */
export function extractPreviousCommit(message: string): string | undefined {
  // Pattern: "reset: moving to <commit>"
  const match = message.match(/moving to ([0-9a-f]{7,40})/i);
  return match ? match[1] : undefined;
}

// ============================================================================
// REFLOG PARSER
// ============================================================================

/**
 * Parse reflog output in porcelain-like format.
 * Uses: git reflog --format="%H %gd %gs" -n <limit>
 */
export function parseReflogOutput(output: string): ParsedReflogEntry[] {
  const entries: ParsedReflogEntry[] = [];
  const lines = output.split('\n').filter(line => line.trim() !== '');

  for (const line of lines) {
    // Format: <commit-hash> <reflog-selector> <subject>
    // Example: abc123... HEAD@{0} commit: Added feature
    const match = line.match(/^([0-9a-f]+)\s+([\w@{}]+)\s+(.*)$/);
    if (!match) continue;

    const [, commitHash, reflogSelector, message] = match;
    const action = parseAction(message);
    const previousCommit = action === 'reset' ? extractPreviousCommit(message) : undefined;

    entries.push({
      commitHash,
      reflogSelector,
      action,
      message,
      previousCommit,
    });
  }

  return entries;
}

/**
 * Parse detailed reflog with timestamps.
 * Uses: git reflog --format="%H|%gd|%gs|%ci|%an"
 */
export function parseDetailedReflog(output: string): ParsedReflogEntry[] {
  const entries: ParsedReflogEntry[] = [];
  const lines = output.split('\n').filter(line => line.trim() !== '');

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length < 3) continue;

    const [commitHash, reflogSelector, message, timestamp, author] = parts;
    const action = parseAction(message);
    const previousCommit = action === 'reset' ? extractPreviousCommit(message) : undefined;

    entries.push({
      commitHash,
      reflogSelector,
      action,
      message,
      previousCommit,
      timestamp: timestamp || undefined,
      author: author || undefined,
    });
  }

  return entries;
}

// ============================================================================
// REFLOG EXECUTOR
// ============================================================================

/**
 * Get reflog entries for a specific ref.
 */
export async function getReflogForRef(
  workspace: string,
  refName: string,
  maxEntries: number = 500
): Promise<ReflogEntry[]> {
  return new Promise((resolve, reject) => {
    exec(
      `git reflog "${refName}" --format="%H|%gd|%gs|%ci|%an" -n ${maxEntries}`,
      {
        cwd: workspace,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30000,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Ref might not exist or have no reflog
          if (stderr.includes('unknown ref') || stderr.includes('no reflog')) {
            resolve([]);
            return;
          }
          reject(new Error(`git reflog failed for ${refName}: ${error.message}`));
          return;
        }

        try {
          const parsed = parseDetailedReflog(stdout);
          const now = new Date().toISOString();

          const entries: ReflogEntry[] = parsed.map((entry, index) => ({
            id: createHash('sha256').update(`${refName}:${entry.commitHash}:${index}`).digest('hex').slice(0, 32),
            refName,
            commitHash: entry.commitHash,
            action: entry.action,
            previousCommit: entry.previousCommit,
            timestamp: entry.timestamp || now,
            message: entry.message,
            author: entry.author,
            indexedAt: now,
          }));

          resolve(entries);
        } catch (parseError) {
          reject(new Error(`Failed to parse reflog for ${refName}: ${parseError}`));
        }
      }
    );
  });
}

/**
 * Get all local branch refs.
 */
export function getLocalBranchRefs(workspace: string): string[] {
  try {
    const output = execSync('git for-each-ref --format="%(refname:short)" refs/heads/', {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    return output.split('\n').filter(line => line.trim() !== '');
  } catch {
    return [];
  }
}

/**
 * Get remote branch refs.
 */
export function getRemoteBranchRefs(workspace: string): string[] {
  try {
    const output = execSync('git for-each-ref --format="%(refname:short)" refs/remotes/', {
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
// REFLOG INDEXER
// ============================================================================

/**
 * Index git reflog data for refs in a repository.
 */
export async function indexReflog(options: ReflogIndexerOptions): Promise<ReflogIndexerResult> {
  const startTime = Date.now();
  const {
    workspace,
    storage,
    refs,
    maxEntries = 500,
    includeRemotes = false,
  } = options;

  const result: ReflogIndexerResult = {
    refsProcessed: 0,
    entriesCreated: 0,
    errors: [],
    durationMs: 0,
  };

  // Get refs to process
  let refsToProcess = refs ?? ['HEAD', ...getLocalBranchRefs(workspace)];
  if (includeRemotes) {
    refsToProcess = [...refsToProcess, ...getRemoteBranchRefs(workspace)];
  }

  // Process refs sequentially
  for (const ref of refsToProcess) {
    try {
      const entries = await getReflogForRef(workspace, ref, maxEntries);

      if (entries.length > 0) {
        await storage.upsertReflogEntries(entries);
        result.entriesCreated += entries.length;
      }

      result.refsProcessed++;
    } catch (error) {
      result.errors.push({
        ref,
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
 * Get recent reverts in the repository.
 */
export async function getRecentReverts(
  storage: LiBrainianStorage,
  limit: number = 20
): Promise<ReflogEntry[]> {
  return storage.getReflogEntries({
    action: 'revert',
    limit,
    orderBy: 'timestamp',
    orderDirection: 'desc',
  });
}

/**
 * Get recent resets (potential rollbacks).
 */
export async function getRecentResets(
  storage: LiBrainianStorage,
  limit: number = 20
): Promise<ReflogEntry[]> {
  return storage.getReflogEntries({
    action: 'reset',
    limit,
    orderBy: 'timestamp',
    orderDirection: 'desc',
  });
}

/**
 * Get merge history.
 */
export async function getMergeHistory(
  storage: LiBrainianStorage,
  limit: number = 50
): Promise<ReflogEntry[]> {
  return storage.getReflogEntries({
    action: 'merge',
    limit,
    orderBy: 'timestamp',
    orderDirection: 'desc',
  });
}

/**
 * Get rebase history (potential conflict points).
 */
export async function getRebaseHistory(
  storage: LiBrainianStorage,
  limit: number = 50
): Promise<ReflogEntry[]> {
  return storage.getReflogEntries({
    action: 'rebase',
    limit,
    orderBy: 'timestamp',
    orderDirection: 'desc',
  });
}

/**
 * Analyze development workflow patterns.
 */
export async function analyzeWorkflowPatterns(
  storage: LiBrainianStorage
): Promise<{
  commitCount: number;
  mergeCount: number;
  rebaseCount: number;
  revertCount: number;
  resetCount: number;
  workflowStyle: 'merge-based' | 'rebase-based' | 'mixed';
}> {
  const entries = await storage.getReflogEntries({ limit: 1000 });

  const counts = {
    commit: 0,
    merge: 0,
    rebase: 0,
    revert: 0,
    reset: 0,
  };

  for (const entry of entries) {
    if (entry.action === 'commit') counts.commit++;
    else if (entry.action === 'merge') counts.merge++;
    else if (entry.action === 'rebase') counts.rebase++;
    else if (entry.action === 'revert') counts.revert++;
    else if (entry.action === 'reset') counts.reset++;
  }

  // Determine workflow style
  let workflowStyle: 'merge-based' | 'rebase-based' | 'mixed';
  if (counts.merge > counts.rebase * 2) {
    workflowStyle = 'merge-based';
  } else if (counts.rebase > counts.merge * 2) {
    workflowStyle = 'rebase-based';
  } else {
    workflowStyle = 'mixed';
  }

  return {
    commitCount: counts.commit,
    mergeCount: counts.merge,
    rebaseCount: counts.rebase,
    revertCount: counts.revert,
    resetCount: counts.reset,
    workflowStyle,
  };
}

/**
 * Find potentially problematic patterns (many reverts, resets).
 */
export async function findProblematicPatterns(
  storage: LiBrainianStorage,
  sinceTimestamp?: string
): Promise<{
  revertFrequency: number;  // reverts per 100 commits
  resetFrequency: number;   // resets per 100 commits
  flags: string[];
}> {
  const entries = await storage.getReflogEntries({
    sinceTimestamp,
    limit: 1000,
  });

  const counts = { commit: 0, revert: 0, reset: 0 };
  for (const entry of entries) {
    if (entry.action === 'commit') counts.commit++;
    else if (entry.action === 'revert') counts.revert++;
    else if (entry.action === 'reset') counts.reset++;
  }

  const revertFrequency = counts.commit > 0 ? (counts.revert / counts.commit) * 100 : 0;
  const resetFrequency = counts.commit > 0 ? (counts.reset / counts.commit) * 100 : 0;

  const flags: string[] = [];
  if (revertFrequency > 5) {
    flags.push('High revert rate may indicate quality issues');
  }
  if (resetFrequency > 10) {
    flags.push('Frequent resets may indicate unstable development');
  }

  return {
    revertFrequency,
    resetFrequency,
    flags,
  };
}
