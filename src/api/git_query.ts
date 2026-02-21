/**
 * @fileoverview Git Query Handler
 *
 * Handles queries about git history, recent changes, and file modifications.
 * This module detects when a user is asking about changes to files (not just
 * what's IN the files) and provides actual git commit information.
 *
 * Problem it solves: Queries like "recent changes to query.ts" were returning
 * functions IN the file instead of changes TO it. This handler intercepts such
 * queries and provides real git history.
 */

import path from 'node:path';
import type { ContextPack, LiBrainianVersion } from '../types.js';
import { getRecentCommits, getFileHistory, isGitRepo, type GitCommit } from '../utils/git.js';

/**
 * Result of a git history query.
 */
export interface GitQueryResult {
  /** Commits found in the git history */
  commits: GitCommit[];
  /** Human-readable summary of the results */
  summary: string;
  /** Target file path if querying specific file history */
  targetFile?: string;
  /** Whether the workspace is a git repository */
  isGitRepo: boolean;
}

/**
 * Detection result for git-related queries.
 */
export interface GitQueryDetection {
  /** Whether this appears to be a git/history query */
  isGitQuery: boolean;
  /** The target file/module if detected */
  targetFile?: string;
  /** The type of git query */
  queryType?: 'recent_changes' | 'file_history' | 'changelog' | 'commits' | 'modifications';
  /** Confidence in the detection (0-1) */
  confidence: number;
}

/**
 * Patterns that indicate a git/history query about changes TO files.
 * These are distinct from queries about what's IN the files.
 */
const GIT_QUERY_PATTERNS: Array<{ pattern: RegExp; type: GitQueryDetection['queryType']; confidence: number }> = [
  // "recent changes to X", "recent changes in X"
  { pattern: /recent\s+changes?\s+(?:to|in|for)\s+(\S+)/i, type: 'recent_changes', confidence: 0.95 },
  // "what changed in X", "what was changed in X"
  { pattern: /what\s+(?:was\s+)?(?:changed|modified)\s+in\s+(\S+)/i, type: 'modifications', confidence: 0.9 },
  // "changelog for X", "changelog of X"
  { pattern: /changelog\s+(?:for|of)\s+(\S+)/i, type: 'changelog', confidence: 0.95 },
  // "git history of X", "git history for X"
  { pattern: /git\s+history\s+(?:of|for)\s+(\S+)/i, type: 'file_history', confidence: 0.95 },
  // "commits to X", "commits for X"
  { pattern: /commits?\s+(?:to|for)\s+(\S+)/i, type: 'commits', confidence: 0.9 },
  // "show history of X", "show history for X"
  { pattern: /show\s+(?:the\s+)?history\s+(?:of|for)\s+(\S+)/i, type: 'file_history', confidence: 0.9 },
  // "what has changed in X"
  { pattern: /what\s+has\s+changed\s+in\s+(\S+)/i, type: 'modifications', confidence: 0.9 },
  // "modifications to X"
  { pattern: /modifications?\s+(?:to|in)\s+(\S+)/i, type: 'modifications', confidence: 0.85 },
  // "file history for X"
  { pattern: /file\s+history\s+(?:for|of)\s+(\S+)/i, type: 'file_history', confidence: 0.95 },
  // "last changes to X"
  { pattern: /last\s+(?:\d+\s+)?changes?\s+(?:to|in)\s+(\S+)/i, type: 'recent_changes', confidence: 0.9 },
  // "who changed X", "who modified X"
  { pattern: /who\s+(?:changed|modified|touched)\s+(\S+)/i, type: 'file_history', confidence: 0.85 },
  // "when was X changed", "when was X modified"
  { pattern: /when\s+was\s+(\S+)\s+(?:changed|modified|last\s+updated)/i, type: 'file_history', confidence: 0.85 },
];

/**
 * General patterns that indicate a git query without a specific file.
 */
const GENERAL_GIT_PATTERNS: Array<{ pattern: RegExp; type: GitQueryDetection['queryType']; confidence: number }> = [
  { pattern: /recent\s+changes?\b/i, type: 'recent_changes', confidence: 0.8 },
  { pattern: /latest\s+commits?\b/i, type: 'commits', confidence: 0.85 },
  { pattern: /recent\s+commits?\b/i, type: 'commits', confidence: 0.85 },
  { pattern: /git\s+history\b/i, type: 'file_history', confidence: 0.8 },
  { pattern: /changelog\b/i, type: 'changelog', confidence: 0.75 },
  { pattern: /what\s+(?:was|has\s+been)\s+modified\b/i, type: 'modifications', confidence: 0.8 },
  { pattern: /what\s+changed\s+recently\b/i, type: 'recent_changes', confidence: 0.85 },
];

/**
 * Detect if a query is asking about git history/changes.
 *
 * @param intent - The query intent string
 * @returns Detection result with isGitQuery flag and optional target file
 */
export function detectGitQuery(intent: string): GitQueryDetection {
  // First check file-specific patterns
  for (const { pattern, type, confidence } of GIT_QUERY_PATTERNS) {
    const match = intent.match(pattern);
    if (match) {
      let targetFile = match[1];
      // Clean up the target file - remove trailing punctuation
      if (targetFile) {
        targetFile = targetFile.replace(/[.,;:!?]+$/, '');
      }
      return {
        isGitQuery: true,
        targetFile,
        queryType: type,
        confidence,
      };
    }
  }

  // Check general patterns without file target
  for (const { pattern, type, confidence } of GENERAL_GIT_PATTERNS) {
    if (pattern.test(intent)) {
      return {
        isGitQuery: true,
        queryType: type,
        confidence,
      };
    }
  }

  return { isGitQuery: false, confidence: 0 };
}

/**
 * Resolve a target file name to an actual file path in the workspace.
 * Handles cases like "query.ts" -> "src/api/query.ts"
 *
 * @param workspace - The workspace root directory
 * @param targetFile - The target file name or partial path
 * @returns The resolved file path, or the original if not found
 */
function resolveTargetFile(workspace: string, targetFile: string): string {
  // If it's already an absolute path or starts with ./, use as-is
  if (path.isAbsolute(targetFile) || targetFile.startsWith('./') || targetFile.startsWith('../')) {
    return targetFile;
  }

  // If it contains a path separator, use as-is (it's a relative path)
  if (targetFile.includes('/') || targetFile.includes('\\')) {
    return targetFile;
  }

  // It's just a filename - try common locations
  const commonPaths = [
    `src/api/${targetFile}`,
    `src/${targetFile}`,
    `src/cli/${targetFile}`,
    `src/storage/${targetFile}`,
    `src/utils/${targetFile}`,
    `src/knowledge/${targetFile}`,
    `src/ingest/${targetFile}`,
    `src/graphs/${targetFile}`,
    `src/constructions/${targetFile}`,
    `src/strategic/${targetFile}`,
    `lib/${targetFile}`,
    `test/${targetFile}`,
    `tests/${targetFile}`,
    targetFile,
  ];

  // Add .ts extension if not present
  const withExtension = targetFile.endsWith('.ts') || targetFile.endsWith('.js')
    ? commonPaths
    : [...commonPaths.map(p => `${p}.ts`), ...commonPaths.map(p => `${p}.js`)];

  // For now, just return the first plausible path
  // In a real implementation, we'd check if the file exists
  for (const p of withExtension) {
    // Return the first path that looks reasonable
    // Git will handle the actual file resolution
    return p;
  }

  return targetFile;
}

/**
 * Query git history for the workspace or a specific file.
 *
 * @param workspace - The workspace root directory
 * @param targetFile - Optional file path to get history for
 * @param limit - Maximum number of commits to return (default: 10)
 * @returns Git query result with commits and summary
 */
export function queryGitHistory(
  workspace: string,
  targetFile?: string,
  limit: number = 10
): GitQueryResult {
  // Check if this is a git repository
  if (!isGitRepo(workspace)) {
    return {
      commits: [],
      summary: 'This workspace is not a git repository.',
      targetFile,
      isGitRepo: false,
    };
  }

  try {
    let commits: GitCommit[];
    let resolvedFile: string | undefined;

    if (targetFile) {
      resolvedFile = resolveTargetFile(workspace, targetFile);
      commits = getFileHistory(workspace, resolvedFile, limit);
    } else {
      commits = getRecentCommits(workspace, limit);
    }

    const summary = targetFile
      ? commits.length > 0
        ? `Found ${commits.length} commit(s) affecting ${resolvedFile ?? targetFile}`
        : `No commits found for ${resolvedFile ?? targetFile} (file may not exist or has no git history)`
      : commits.length > 0
        ? `Found ${commits.length} recent commit(s) in the repository`
        : 'No commits found in the repository';

    return {
      commits,
      summary,
      targetFile: resolvedFile ?? targetFile,
      isGitRepo: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      commits: [],
      summary: `Error querying git history: ${message}`,
      targetFile,
      isGitRepo: true,
    };
  }
}

/**
 * Create a context pack from git history results.
 *
 * @param result - The git query result
 * @param version - The librainian version
 * @returns A context pack containing git history information
 */
export function createGitHistoryPack(
  result: GitQueryResult,
  version: LiBrainianVersion
): ContextPack {
  const keyFacts: string[] = [];

  // Add summary
  keyFacts.push(result.summary);

  // Add commit details
  for (const commit of result.commits.slice(0, 5)) {
    const commitLine = `${commit.shortHash} (${commit.date.split(' ')[0]}): ${commit.message} - ${commit.author}`;
    keyFacts.push(commitLine);
  }

  if (result.commits.length > 5) {
    keyFacts.push(`... and ${result.commits.length - 5} more commit(s)`);
  }

  // Build code snippets showing commit messages
  const codeSnippets = result.commits.slice(0, 3).map(commit => ({
    filePath: result.targetFile ?? 'git-log',
    startLine: 1,
    endLine: 1,
    content: `Commit ${commit.shortHash} by ${commit.author} on ${commit.date.split(' ')[0]}:\n${commit.message}`,
    language: 'text',
  }));

  return {
    packId: `git_history_${result.targetFile ?? 'repo'}_${Date.now()}`,
    packType: 'git_history',
    targetId: result.targetFile ?? 'repository',
    summary: result.summary,
    keyFacts,
    codeSnippets,
    relatedFiles: result.targetFile ? [result.targetFile] : [],
    confidence: result.commits.length > 0 ? 0.95 : 0.5,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: result.targetFile ? [result.targetFile] : [],
  };
}

/**
 * Run the git query stage in the query pipeline.
 * This should be called early to intercept git-related queries.
 *
 * @param options - Stage options
 * @returns Stage result with git packs if applicable
 */
export interface GitQueryStageOptions {
  intent: string;
  workspace: string;
  version: LiBrainianVersion;
}

export interface GitQueryStageResult {
  /** Whether this is a git query */
  isGitQuery: boolean;
  /** Whether to short-circuit the rest of the query pipeline */
  shouldShortCircuit: boolean;
  /** Git history context packs */
  gitPacks: ContextPack[];
  /** Explanation of what was found */
  explanation: string;
  /** The detection result */
  detection: GitQueryDetection;
}

export function runGitQueryStage(options: GitQueryStageOptions): GitQueryStageResult {
  const { intent, workspace, version } = options;

  const detection = detectGitQuery(intent);

  if (!detection.isGitQuery) {
    return {
      isGitQuery: false,
      shouldShortCircuit: false,
      gitPacks: [],
      explanation: '',
      detection,
    };
  }

  const gitResult = queryGitHistory(workspace, detection.targetFile);
  const gitPack = createGitHistoryPack(gitResult, version);

  // Short-circuit if we have a high-confidence git query with results
  const shouldShortCircuit = detection.confidence >= 0.85 && gitResult.commits.length > 0;

  const explanation = gitResult.summary + (
    shouldShortCircuit
      ? ' Git query detected with high confidence - returning git history.'
      : ' Git query detected - including git history in results.'
  );

  return {
    isGitQuery: true,
    shouldShortCircuit,
    gitPacks: [gitPack],
    explanation,
    detection,
  };
}
