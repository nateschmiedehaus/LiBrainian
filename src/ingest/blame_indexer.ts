/**
 * @fileoverview Git Blame Indexer for Line-Level Code Ownership
 *
 * Parses `git blame --line-porcelain` output to create per-line ownership records.
 * Enables "who knows this code?" queries and expertise identification.
 *
 * Based on 2025-2026 research:
 * - Code ownership correlates with code quality and bug introduction rates
 * - Expert identification improves code review efficiency
 * - Line-level granularity enables precise expertise mapping
 */

import { execSync, exec } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import type { LiBrainianStorage, BlameEntry, BlameStats } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface BlameLineInfo {
  commitHash: string;
  originalLine: number;
  finalLine: number;
  author: string;
  authorEmail: string;
  authorTime: number;
  authorTz: string;
  committer: string;
  committerEmail: string;
  committerTime: number;
  committerTz: string;
  summary: string;
  filename: string;
}

export interface BlameChunk {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  author: string;
  authorEmail: string;
  commitHash: string;
  commitDate: string;
  originalLine: number;
}

export interface BlameIndexerOptions {
  workspace: string;
  storage: LiBrainianStorage;
  files?: string[];           // Specific files to blame (if empty, uses git ls-files)
  maxFilesPerBatch?: number;  // Limit concurrent git blame processes
  skipBinaryFiles?: boolean;  // Skip binary files (default: true)
  timeoutMs?: number;         // Timeout per file (default: 30000)
}

export interface BlameIndexerResult {
  filesProcessed: number;
  chunksCreated: number;
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

// ============================================================================
// GIT BLAME PARSER
// ============================================================================

/**
 * Parse a single line of `git blame --line-porcelain` output.
 */
export function parseBlameLineHeader(line: string): { commitHash: string; originalLine: number; finalLine: number; groupLines?: number } | null {
  // Format: <commit-hash> <original-line> <final-line> [<num-lines>]
  const match = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
  if (!match) return null;
  return {
    commitHash: match[1],
    originalLine: parseInt(match[2], 10),
    finalLine: parseInt(match[3], 10),
    groupLines: match[4] ? parseInt(match[4], 10) : undefined,
  };
}

/**
 * Parse `git blame --line-porcelain` output for a file.
 * Returns an array of blame info per line.
 */
export function parseBlameOutput(output: string): BlameLineInfo[] {
  const lines = output.split('\n');
  const results: BlameLineInfo[] = [];
  let current: Partial<BlameLineInfo> = {};
  let inHeader = true;

  for (const line of lines) {
    if (line === '') continue;

    // Check for commit header (40-char hex followed by line numbers)
    const header = parseBlameLineHeader(line);
    if (header) {
      // Save previous if exists
      if (current.commitHash && current.author && current.authorTime !== undefined) {
        results.push(current as BlameLineInfo);
      }
      current = {
        commitHash: header.commitHash,
        originalLine: header.originalLine,
        finalLine: header.finalLine,
      };
      inHeader = true;
      continue;
    }

    // Parse header fields
    if (line.startsWith('author ')) {
      current.author = line.slice(7);
    } else if (line.startsWith('author-mail ')) {
      current.authorEmail = line.slice(12).replace(/[<>]/g, '');
    } else if (line.startsWith('author-time ')) {
      current.authorTime = parseInt(line.slice(12), 10);
    } else if (line.startsWith('author-tz ')) {
      current.authorTz = line.slice(10);
    } else if (line.startsWith('committer ')) {
      current.committer = line.slice(10);
    } else if (line.startsWith('committer-mail ')) {
      current.committerEmail = line.slice(15).replace(/[<>]/g, '');
    } else if (line.startsWith('committer-time ')) {
      current.committerTime = parseInt(line.slice(15), 10);
    } else if (line.startsWith('committer-tz ')) {
      current.committerTz = line.slice(13);
    } else if (line.startsWith('summary ')) {
      current.summary = line.slice(8);
    } else if (line.startsWith('filename ')) {
      current.filename = line.slice(9);
    } else if (line.startsWith('\t')) {
      // This is the actual code line - marks end of header for this line
      inHeader = false;
    }
  }

  // Don't forget the last one
  if (current.commitHash && current.author && current.authorTime !== undefined) {
    results.push(current as BlameLineInfo);
  }

  return results;
}

/**
 * Group consecutive lines with same author/commit into chunks.
 * This reduces storage requirements while preserving ownership info.
 */
export function groupBlameLines(lines: BlameLineInfo[], filePath: string): BlameChunk[] {
  if (lines.length === 0) return [];

  const chunks: BlameChunk[] = [];
  let currentChunk: BlameChunk | null = null;

  for (const line of lines) {
    const shouldStartNewChunk = !currentChunk ||
      currentChunk.author !== line.author ||
      currentChunk.commitHash !== line.commitHash ||
      currentChunk.lineEnd + 1 !== line.finalLine;

    if (shouldStartNewChunk) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = {
        filePath,
        lineStart: line.finalLine,
        lineEnd: line.finalLine,
        author: line.author,
        authorEmail: line.authorEmail,
        commitHash: line.commitHash,
        commitDate: new Date(line.authorTime * 1000).toISOString(),
        originalLine: line.originalLine,
      };
    } else {
      currentChunk!.lineEnd = line.finalLine;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// ============================================================================
// GIT BLAME EXECUTOR
// ============================================================================

/**
 * Run git blame on a single file and parse the output.
 */
export async function blameFile(
  workspace: string,
  filePath: string,
  timeoutMs: number = 30000
): Promise<BlameChunk[]> {
  return new Promise((resolve, reject) => {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspace, filePath);
    const relativePath = path.relative(workspace, absolutePath);

    const child = exec(
      `git blame --line-porcelain "${relativePath}"`,
      {
        cwd: workspace,
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large files
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Some errors are expected (binary files, untracked files)
          if (stderr.includes('binary') || stderr.includes('no such path')) {
            resolve([]);
            return;
          }
          reject(new Error(`git blame failed for ${filePath}: ${error.message}`));
          return;
        }

        try {
          const lines = parseBlameOutput(stdout);
          const chunks = groupBlameLines(lines, relativePath);
          resolve(chunks);
        } catch (parseError) {
          reject(new Error(`Failed to parse blame output for ${filePath}: ${parseError}`));
        }
      }
    );
  });
}

/**
 * Get list of tracked files in the repository.
 */
export function getTrackedFiles(workspace: string): string[] {
  try {
    const output = execSync('git ls-files', {
      cwd: workspace,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });
    return output.split('\n').filter(line => line.trim() !== '');
  } catch {
    return [];
  }
}

/**
 * Check if a file is binary.
 */
export function isBinaryFile(workspace: string, filePath: string): boolean {
  try {
    const output = execSync(`git diff --numstat 4b825dc642cb6eb9a060e54bf8d69288fbee4904 HEAD -- "${filePath}"`, {
      cwd: workspace,
      encoding: 'utf8',
    });
    // Binary files show as "-\t-\t<filename>"
    return output.startsWith('-\t-\t');
  } catch {
    return false;
  }
}

// ============================================================================
// BLAME INDEXER
// ============================================================================

/**
 * Index git blame data for files in a repository.
 */
export async function indexBlame(options: BlameIndexerOptions): Promise<BlameIndexerResult> {
  const startTime = Date.now();
  const {
    workspace,
    storage,
    files,
    maxFilesPerBatch = 10,
    skipBinaryFiles = true,
    timeoutMs = 30000,
  } = options;

  const result: BlameIndexerResult = {
    filesProcessed: 0,
    chunksCreated: 0,
    errors: [],
    durationMs: 0,
  };

  // Get files to process
  let filesToProcess = files ?? getTrackedFiles(workspace);

  // Filter binary files if requested
  if (skipBinaryFiles) {
    filesToProcess = filesToProcess.filter(file => !isBinaryFile(workspace, file));
  }

  // Process files in batches
  for (let i = 0; i < filesToProcess.length; i += maxFilesPerBatch) {
    const batch = filesToProcess.slice(i, i + maxFilesPerBatch);
    const batchPromises = batch.map(async (file) => {
      try {
        const chunks = await blameFile(workspace, file, timeoutMs);
        if (chunks.length > 0) {
          // Convert chunks to BlameEntry format
          const entries: BlameEntry[] = chunks.map(chunk => ({
            id: createHash('sha256').update(`${chunk.filePath}:${chunk.lineStart}:${chunk.commitHash}`).digest('hex').slice(0, 32),
            filePath: chunk.filePath,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
            author: chunk.author,
            authorEmail: chunk.authorEmail,
            commitHash: chunk.commitHash,
            commitDate: chunk.commitDate,
            originalLine: chunk.originalLine,
            indexedAt: new Date().toISOString(),
          }));

          // Delete old entries for this file and insert new ones
          await storage.deleteBlameForFile(file);
          await storage.upsertBlameEntries(entries);

          result.chunksCreated += entries.length;
        }
        result.filesProcessed++;
      } catch (error) {
        result.errors.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(batchPromises);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get the primary author (most lines owned) for a file.
 */
export async function getPrimaryAuthor(
  storage: LiBrainianStorage,
  filePath: string
): Promise<{ author: string; ownership: number } | null> {
  const stats = await storage.getBlameStats(filePath);
  if (!stats) return null;

  return {
    author: stats.topContributor,
    ownership: stats.expertiseByAuthor[stats.topContributor] || 0,
  };
}

/**
 * Get all authors who have contributed to a file.
 */
export async function getFileContributors(
  storage: LiBrainianStorage,
  filePath: string
): Promise<Array<{ author: string; lines: number; percentage: number }>> {
  const stats = await storage.getBlameStats(filePath);
  if (!stats) return [];

  return Object.entries(stats.authorsByLines)
    .map(([author, lines]) => ({
      author,
      lines,
      percentage: stats.expertiseByAuthor[author] || 0,
    }))
    .sort((a, b) => b.lines - a.lines);
}

/**
 * Get all files an author has contributed to.
 */
export async function getAuthorFiles(
  storage: LiBrainianStorage,
  author: string
): Promise<Array<{ filePath: string; linesOwned: number }>> {
  const entries = await storage.getBlameEntries({ author, limit: 10000 });

  // Group by file and count lines
  const fileMap = new Map<string, number>();
  for (const entry of entries) {
    const current = fileMap.get(entry.filePath) || 0;
    fileMap.set(entry.filePath, current + (entry.lineEnd - entry.lineStart + 1));
  }

  return Array.from(fileMap.entries())
    .map(([filePath, linesOwned]) => ({ filePath, linesOwned }))
    .sort((a, b) => b.linesOwned - a.linesOwned);
}

/**
 * Find the expert for specific lines in a file.
 */
export async function getLineExpert(
  storage: LiBrainianStorage,
  filePath: string,
  lineStart: number,
  lineEnd: number
): Promise<{ author: string; commitHash: string; commitDate: string } | null> {
  const entries = await storage.getBlameEntries({
    filePath,
    lineRange: { start: lineStart, end: lineEnd },
    limit: 100,
  });

  if (entries.length === 0) return null;

  // Find the author with most lines in the range
  const authorLines = new Map<string, { lines: number; commitHash: string; commitDate: string }>();
  for (const entry of entries) {
    const overlapStart = Math.max(entry.lineStart, lineStart);
    const overlapEnd = Math.min(entry.lineEnd, lineEnd);
    const overlapLines = Math.max(0, overlapEnd - overlapStart + 1);

    const existing = authorLines.get(entry.author);
    if (!existing || overlapLines > existing.lines) {
      authorLines.set(entry.author, {
        lines: overlapLines,
        commitHash: entry.commitHash,
        commitDate: entry.commitDate,
      });
    }
  }

  let bestAuthor = '';
  let bestInfo = { lines: 0, commitHash: '', commitDate: '' };
  for (const [author, info] of authorLines.entries()) {
    if (info.lines > bestInfo.lines) {
      bestAuthor = author;
      bestInfo = info;
    }
  }

  return bestAuthor ? { author: bestAuthor, ...bestInfo } : null;
}
