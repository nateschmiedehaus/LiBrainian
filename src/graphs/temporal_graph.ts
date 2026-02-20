import { spawn } from 'child_process';

export interface CochangeEdge { fileA: string; fileB: string; changeCount: number; totalChanges: number; strength: number; }
export interface TemporalGraph {
  edges: CochangeEdge[];
  commitCount: number;
  fileChangeCounts: Record<string, number>;
  latestCommitSha: string | null;
}
export interface TemporalGraphOptions {
  maxCommits?: number;
  maxFilesPerCommit?: number;
  sinceCommitExclusive?: string;
  signal?: AbortSignal;
}

const DEFAULT_MAX_COMMITS = 2000;
const DEFAULT_MAX_FILES = 50;
const EMPTY_TEMPORAL_GRAPH: TemporalGraph = { edges: [], commitCount: 0, fileChangeCounts: {}, latestCommitSha: null };

async function readGitLog(
  workspace: string,
  maxCommits: number,
  sinceCommitExclusive?: string,
  signal?: AbortSignal
): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const args = ['log', '--name-only', '--pretty=format:%H', '-n', String(maxCommits)];
    if (sinceCommitExclusive) args.push(`${sinceCommitExclusive}..HEAD`);
    const child = spawn(
      'git',
      args,
      { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const handleAbort = () => {
      try {
        child.kill();
      } catch {
        // Ignore process termination failures
      }
      finish(null);
    };

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', handleAbort);
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(stdout);
    });
  });
}

export async function buildTemporalGraph(workspace: string, options: TemporalGraphOptions = {}): Promise<TemporalGraph> {
  const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  const maxFilesPerCommit = options.maxFilesPerCommit ?? DEFAULT_MAX_FILES;
  const stdout = await readGitLog(workspace, maxCommits, options.sinceCommitExclusive, options.signal);
  if (!stdout) return { ...EMPTY_TEMPORAL_GRAPH };
  const lines = stdout.split(/\r?\n/);
  const commits: Array<{ sha: string; files: string[] }> = [];
  let currentSha: string | null = null;
  let currentFiles: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[0-9a-f]{7,40}$/i.test(trimmed)) {
      if (currentSha && currentFiles.length) commits.push({ sha: currentSha, files: currentFiles });
      currentSha = trimmed;
      currentFiles = [];
      continue;
    }
    currentFiles.push(trimmed);
  }
  if (currentSha && currentFiles.length) commits.push({ sha: currentSha, files: currentFiles });
  const pairCounts = new Map<string, number>();
  const fileChangeCounts: Record<string, number> = {};
  for (const commit of commits) {
    const filesRaw = commit.files;
    const files = Array.from(new Set(filesRaw)).slice(0, maxFilesPerCommit);
    for (const file of files) fileChangeCounts[file] = (fileChangeCounts[file] ?? 0) + 1;
    for (let i = 0; i < files.length; i += 1) {
      for (let j = i + 1; j < files.length; j += 1) {
        const a = files[i] ?? '';
        const b = files[j] ?? '';
        if (!a || !b) continue;
        const key = a < b ? `${a}||${b}` : `${b}||${a}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const commitCount = commits.length;
  const edges: CochangeEdge[] = [];
  for (const [key, count] of pairCounts.entries()) {
    const [fileA, fileB] = key.split('||');
    edges.push({ fileA, fileB, changeCount: count, totalChanges: commitCount, strength: commitCount > 0 ? count / commitCount : 0 });
  }
  return { edges, commitCount, fileChangeCounts, latestCommitSha: commits[0]?.sha ?? null };
}
