/**
 * @fileoverview Git Utilities
 * Provides git operations for standalone librarian.
 */

import { execSync } from 'node:child_process';

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getGitRoot(dir: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function getCurrentBranch(dir: string): string | null {
  try {
    return execSync('git branch --show-current', { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function getRecentCommits(dir: string, count = 10): GitCommit[] {
  try {
    const format = '%H|%h|%an|%ai|%s';
    const output = execSync(
      `git log -${count} --pretty=format:"${format}"`,
      { cwd: dir, encoding: 'utf8' }
    );
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [hash, shortHash, author, date, message] = line.split('|');
      return { hash, shortHash, author, date, message };
    });
  } catch {
    return [];
  }
}

export function getFileHistory(dir: string, filePath: string, count = 10): GitCommit[] {
  try {
    const format = '%H|%h|%an|%ai|%s';
    const output = execSync(
      `git log -${count} --pretty=format:"${format}" -- "${filePath}"`,
      { cwd: dir, encoding: 'utf8' }
    );
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [hash, shortHash, author, date, message] = line.split('|');
      return { hash, shortHash, author, date, message };
    });
  } catch {
    return [];
  }
}

export function getStatus(dir: string): GitStatus {
  try {
    const output = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
    const status: GitStatus = { modified: [], added: [], deleted: [], untracked: [] };

    for (const line of output.trim().split('\n').filter(Boolean)) {
      const code = line.substring(0, 2);
      const file = line.substring(3);

      if (code.includes('M')) status.modified.push(file);
      else if (code.includes('A')) status.added.push(file);
      else if (code.includes('D')) status.deleted.push(file);
      else if (code === '??') status.untracked.push(file);
    }

    return status;
  } catch {
    return { modified: [], added: [], deleted: [], untracked: [] };
  }
}

export function getBlame(dir: string, filePath: string): Map<number, string> {
  const blame = new Map<number, string>();
  try {
    const output = execSync(
      `git blame --line-porcelain "${filePath}"`,
      { cwd: dir, encoding: 'utf8' }
    );
    let lineNum = 0;
    let currentAuthor = '';

    for (const line of output.split('\n')) {
      if (line.startsWith('author ')) {
        currentAuthor = line.substring(7);
      } else if (line.startsWith('\t')) {
        lineNum++;
        blame.set(lineNum, currentAuthor);
      }
    }
  } catch {
    // Ignore errors
  }
  return blame;
}

/**
 * Get current git SHA (HEAD commit)
 */
export function getCurrentGitSha(dir?: string): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: dir ?? process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get current git SHA short version
 */
export function getCurrentGitShort(dir?: string): string | null {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: dir ?? process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(dir?: string): boolean {
  try {
    const output = execSync('git status --porcelain', { cwd: dir ?? process.cwd(), encoding: 'utf8' });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the diff for a file
 */
export function getFileDiff(filePath: string, dir?: string): string | null {
  try {
    return execSync(`git diff "${filePath}"`, { cwd: dir ?? process.cwd(), encoding: 'utf8' });
  } catch {
    return null;
  }
}

export async function getGitDiffNames(
  dir: string,
  baseSha: string
): Promise<{ added: string[]; modified: string[]; deleted: string[] } | null> {
  if (!baseSha || !isGitRepo(dir)) return null;
  try {
    const output = execSync(`git diff --name-status ${baseSha}..HEAD`, { cwd: dir, encoding: 'utf8' });
    if (!output.trim()) return null;
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const line of output.trim().split('\n').filter(Boolean)) {
      const parts = line.split(/\s+/);
      const status = parts[0] ?? '';
      const pathA = parts[1];
      const pathB = parts[2];

      if (!status) continue;
      if (status.startsWith('A') && pathA) {
        added.push(pathA);
      } else if (status.startsWith('D') && pathA) {
        deleted.push(pathA);
      } else if (status.startsWith('R')) {
        if (pathA) deleted.push(pathA);
        if (pathB) added.push(pathB);
      } else if (status.startsWith('C') && pathB) {
        added.push(pathB);
      } else if (pathA) {
        modified.push(pathA);
      }
    }

    if (added.length === 0 && modified.length === 0 && deleted.length === 0) return null;
    return { added, modified, deleted };
  } catch {
    return null;
  }
}

export async function getGitStatusChanges(
  dir: string
): Promise<{ added: string[]; modified: string[]; deleted: string[] } | null> {
  if (!isGitRepo(dir)) return null;
  const status = getStatus(dir);
  const added = [...status.added, ...status.untracked];
  const modified = status.modified.slice();
  const deleted = status.deleted.slice();
  if (added.length === 0 && modified.length === 0 && deleted.length === 0) return null;
  return { added, modified, deleted };
}
