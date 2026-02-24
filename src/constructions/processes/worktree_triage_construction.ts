import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ConstructionError } from '../base/construction_base.js';
import type { Construction } from '../types.js';
import { ok } from '../types.js';

const TOKEN_REGEX = /\b[A-Za-z][A-Za-z0-9_]{2,}\b/gu;
const DEFAULT_DIRTY_THRESHOLD = 50;

export type WorktreeSeverity = 'clean' | 'light' | 'moderate' | 'heavy' | 'critical';
export type WorktreeClusterType =
  | 'bulk-rename'
  | 'bulk-format'
  | 'config-change'
  | 'new-feature'
  | 'test-updates'
  | 'doc-updates'
  | 'build-artifacts'
  | 'conflict-residue'
  | 'unrelated-edits';
export type WorktreeClusterRisk = 'low' | 'medium' | 'high';
export type WorktreeClusterRecommendation = 'commit' | 'stash' | 'review' | 'revert';

export interface WorktreeTriageInput {
  workspace: string;
  dirtyThreshold?: number;
}

export interface WorktreeAssessment {
  totalDirty: number;
  modified: number;
  untracked: number;
  deleted: number;
  renamed: number;
  conflicted: number;
  dirtyRatio: number;
  severity: WorktreeSeverity;
  estimatedAgentSessions: number;
  lastCommitAge: string;
  branchDivergence: number;
  commitsAhead: number;
  commitsBehind: number;
}

export interface WorktreeChangeCluster {
  id: string;
  name: string;
  type: WorktreeClusterType;
  files: string[];
  fileCount: number;
  confidence: number;
  risk: WorktreeClusterRisk;
  recommendation: WorktreeClusterRecommendation;
  suggestedCommitMessage: string | null;
  diffPattern?: string;
}

export interface WorktreeRecoveryStrategy {
  id: 'auto-commit-clusters' | 'stash-and-branch' | 'interactive-review' | 'revert-all';
  description: string;
  nonDestructive: boolean;
  requiresConfirmation: boolean;
  recommended: boolean;
  backupBranch: string;
  command: string;
}

export interface WorktreeThresholdPolicy {
  maxDirtyFiles: number;
  exceeded: boolean;
  action: 'allow' | 'warn' | 'block';
}

export interface WorktreeTriageOutput {
  kind: 'WorktreeTriageReport.v1';
  assessment: WorktreeAssessment;
  clusters: WorktreeChangeCluster[];
  thresholdPolicy: WorktreeThresholdPolicy;
  recoveryStrategies: WorktreeRecoveryStrategy[];
}

interface DirtyEntry {
  path: string;
  originalPath?: string;
  status: string;
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
}

interface RenameCandidate {
  from: string;
  to: string;
  files: string[];
  confidence: number;
}

interface TokenDelta {
  removed: Set<string>;
  added: Set<string>;
}

const CONFIG_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'vitest.setup.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.json',
]);

function toSingleLine(error: unknown): string {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  return text.replace(/\s+/gu, ' ').trim();
}

function runGit(workspace: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status ?? 1) !== 0) {
    const errorText = toSingleLine(`${result.stdout ?? ''} ${result.stderr ?? ''}`);
    throw new Error(`git ${args.join(' ')} failed: ${errorText || 'unknown error'}`);
  }
  return (result.stdout ?? '').trimEnd();
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function parseDirtyEntries(output: string): DirtyEntry[] {
  const lines = output.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0);
  const entries: DirtyEntry[] = [];
  for (const line of lines) {
    if (line.startsWith('?? ')) {
      entries.push({
        path: normalizePath(line.slice(3).trim()),
        status: '??',
        kind: 'untracked',
      });
      continue;
    }

    const status = line.slice(0, 2);
    const payload = line.length > 3 ? line.slice(3).trim() : '';
    const hasConflict = status.includes('U') || status === 'AA' || status === 'DD';
    if (hasConflict) {
      entries.push({
        path: normalizePath(payload),
        status,
        kind: 'conflicted',
      });
      continue;
    }

    if (status.includes('R') && payload.includes(' -> ')) {
      const renameParts = payload.split(' -> ');
      const fromPath = normalizePath(renameParts[0].trim());
      const toPath = normalizePath(renameParts[1].trim());
      entries.push({
        path: toPath,
        originalPath: fromPath,
        status,
        kind: 'renamed',
      });
      continue;
    }

    if (status.includes('D')) {
      entries.push({
        path: normalizePath(payload),
        status,
        kind: 'deleted',
      });
      continue;
    }

    if (status.includes('A')) {
      entries.push({
        path: normalizePath(payload),
        status,
        kind: 'added',
      });
      continue;
    }

    entries.push({
      path: normalizePath(payload),
      status,
      kind: 'modified',
    });
  }
  return entries;
}

function severityForDirtyCount(count: number): WorktreeSeverity {
  if (count <= 0) return 'clean';
  if (count <= 10) return 'light';
  if (count <= 50) return 'moderate';
  if (count <= 200) return 'heavy';
  return 'critical';
}

function formatAge(nowMs: number, unixSeconds: number): string {
  const deltaMs = Math.max(0, nowMs - (unixSeconds * 1_000));
  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) return 'moments ago';
  if (deltaMinutes < 60) return `${deltaMinutes} minute${deltaMinutes === 1 ? '' : 's'} ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours} hour${deltaHours === 1 ? '' : 's'} ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays} day${deltaDays === 1 ? '' : 's'} ago`;
}

async function estimateAgentSessions(workspace: string, entries: DirtyEntry[]): Promise<number> {
  const buckets = new Set<number>();
  for (const entry of entries) {
    try {
      const fileStat = await fs.stat(path.join(workspace, entry.path));
      buckets.add(Math.floor(fileStat.mtimeMs / (30 * 60 * 1_000)));
    } catch {
      // Ignore deleted/missing files.
    }
  }
  return Math.max(1, buckets.size);
}

function parseTokenDelta(diffText: string): TokenDelta {
  const removed = new Set<string>();
  const added = new Set<string>();
  const lines = diffText.split('\n');
  for (const line of lines) {
    if ((line.startsWith('---') || line.startsWith('+++'))) {
      continue;
    }
    if (line.startsWith('-')) {
      for (const token of line.match(TOKEN_REGEX) ?? []) {
        if (token.length <= 64) {
          removed.add(token);
        }
      }
      continue;
    }
    if (line.startsWith('+')) {
      for (const token of line.match(TOKEN_REGEX) ?? []) {
        if (token.length <= 64) {
          added.add(token);
        }
      }
    }
  }
  return { removed, added };
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) {
    previous[j] = j;
  }
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }
  return previous[right.length];
}

function isLikelyRenamePair(fromToken: string, toToken: string): boolean {
  const fromLower = fromToken.toLowerCase();
  const toLower = toToken.toLowerCase();
  if (fromLower === toLower) return false;
  if (fromLower.includes(toLower) || toLower.includes(fromLower)) return true;
  const maxLength = Math.max(fromToken.length, toToken.length);
  if (maxLength < 5) return false;
  const maxDistance = Math.max(2, Math.min(4, Math.floor(maxLength * 0.35)));
  return boundedEditDistance(fromLower, toLower, maxDistance) <= maxDistance;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function clusterRisk(type: WorktreeClusterType): WorktreeClusterRisk {
  switch (type) {
    case 'bulk-rename':
    case 'bulk-format':
    case 'new-feature':
    case 'doc-updates':
      return 'low';
    case 'config-change':
    case 'test-updates':
      return 'medium';
    case 'build-artifacts':
    case 'conflict-residue':
    case 'unrelated-edits':
    default:
      return 'high';
  }
}

function clusterRecommendation(type: WorktreeClusterType): WorktreeClusterRecommendation {
  switch (type) {
    case 'bulk-rename':
    case 'bulk-format':
    case 'new-feature':
    case 'test-updates':
    case 'doc-updates':
      return 'commit';
    case 'config-change':
    case 'unrelated-edits':
    case 'conflict-residue':
      return 'review';
    case 'build-artifacts':
      return 'revert';
    default:
      return 'stash';
  }
}

function topScope(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const filePath of paths) {
    const parts = filePath.split('/');
    const scope = parts[0] || '.';
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  const winners = [...counts.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return winners[0]?.[0] ?? '.';
}

function clusterMessage(type: WorktreeClusterType, files: string[], rename?: RenameCandidate): string | null {
  const scope = topScope(files);
  switch (type) {
    case 'bulk-rename':
      return rename ? `refactor: rename ${rename.from} to ${rename.to} across codebase` : 'refactor: apply bulk rename';
    case 'bulk-format':
      return `style: apply formatting updates in ${scope}`;
    case 'new-feature':
      return `feat: add new files in ${scope}`;
    case 'test-updates':
      return `test: update tests in ${scope}`;
    case 'doc-updates':
      return `docs: update documentation in ${scope}`;
    case 'config-change':
      return 'chore: update configuration';
    case 'build-artifacts':
      return 'chore: remove generated build artifacts';
    default:
      return null;
  }
}

function clusterName(type: WorktreeClusterType, files: string[], rename?: RenameCandidate): string {
  if (type === 'bulk-rename' && rename) {
    return `${rename.from} -> ${rename.to} rename`;
  }
  const scope = topScope(files);
  switch (type) {
    case 'bulk-format':
      return `Formatting cascade in ${scope}`;
    case 'config-change':
      return 'Configuration updates';
    case 'new-feature':
      return `New files in ${scope}`;
    case 'test-updates':
      return `Test updates in ${scope}`;
    case 'doc-updates':
      return 'Documentation updates';
    case 'build-artifacts':
      return 'Build artifact contamination';
    case 'conflict-residue':
      return 'Merge conflict residue';
    case 'unrelated-edits':
    default:
      return 'Scattered unrelated edits';
  }
}

function classifyFileType(entry: DirtyEntry): WorktreeClusterType {
  const filePath = entry.path;
  const base = path.posix.basename(filePath);
  if (entry.kind === 'conflicted') return 'conflict-residue';
  if (filePath.startsWith('dist/') || filePath.startsWith('build/') || filePath.endsWith('.map')) return 'build-artifacts';
  if (CONFIG_NAMES.has(base) || base.endsWith('.config.js') || base.endsWith('.config.ts')) return 'config-change';
  if (filePath.startsWith('docs/') || filePath.endsWith('.md')) return 'doc-updates';
  if (filePath.includes('/__tests__/') || filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) return 'test-updates';
  if (entry.kind === 'untracked') return 'new-feature';
  return 'unrelated-edits';
}

function createRecoveryStrategies(backupBranch: string): WorktreeRecoveryStrategy[] {
  return [
    {
      id: 'auto-commit-clusters',
      description: 'Create a backup branch, then commit low-risk clusters as separate commits.',
      nonDestructive: true,
      requiresConfirmation: false,
      recommended: true,
      backupBranch,
      command: 'librarian triage --auto',
    },
    {
      id: 'stash-and-branch',
      description: 'Create a backup branch, then stash all dirty changes for safe recovery.',
      nonDestructive: true,
      requiresConfirmation: false,
      recommended: false,
      backupBranch,
      command: 'librarian triage --stash',
    },
    {
      id: 'interactive-review',
      description: 'Review each cluster manually and choose commit/stash per cluster.',
      nonDestructive: true,
      requiresConfirmation: false,
      recommended: false,
      backupBranch,
      command: 'librarian triage',
    },
    {
      id: 'revert-all',
      description: 'Create a backup branch and revert all local changes (destructive).',
      nonDestructive: false,
      requiresConfirmation: true,
      recommended: false,
      backupBranch,
      command: 'librarian triage --revert --confirm',
    },
  ];
}

async function detectRenameCandidate(workspace: string, entries: DirtyEntry[]): Promise<RenameCandidate | null> {
  const eligible = entries.filter((entry) => entry.kind === 'modified' || entry.kind === 'renamed');
  if (eligible.length < 10) {
    return null;
  }

  const pairToFiles = new Map<string, Set<string>>();
  for (const entry of eligible) {
    try {
      const diffText = runGit(workspace, ['diff', '--unified=0', '--', entry.path]);
      if (!diffText) continue;
      const delta = parseTokenDelta(diffText);
      if (delta.removed.size === 0 || delta.added.size === 0) continue;
      const seenPairs = new Set<string>();
      for (const removed of delta.removed) {
        for (const added of delta.added) {
          if (!isLikelyRenamePair(removed, added)) continue;
          const key = `${removed}\u0000${added}`;
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);
          let files = pairToFiles.get(key);
          if (!files) {
            files = new Set<string>();
            pairToFiles.set(key, files);
          }
          files.add(entry.path);
        }
      }
    } catch {
      // Ignore per-file diff failures.
    }
  }

  if (pairToFiles.size === 0) return null;

  const orderedPairs = [...pairToFiles.entries()].sort((left, right) => {
    const leftCount = left[1].size;
    const rightCount = right[1].size;
    if (leftCount !== rightCount) return rightCount - leftCount;
    return left[0].localeCompare(right[0]);
  });

  const best = orderedPairs[0];
  const [pairKey, files] = best;
  const [from, to] = pairKey.split('\u0000');
  const minRequired = Math.max(10, Math.floor(eligible.length * 0.5));
  if (files.size < minRequired) return null;
  const confidence = roundConfidence(Math.min(0.99, 0.6 + (files.size / eligible.length) * 0.39));
  return {
    from,
    to,
    files: [...files].sort(),
    confidence,
  };
}

function buildClusters(entries: DirtyEntry[], rename: RenameCandidate | null): WorktreeChangeCluster[] {
  const assigned = new Set<string>();
  const clusters: WorktreeChangeCluster[] = [];

  if (rename) {
    for (const filePath of rename.files) {
      assigned.add(filePath);
    }
    clusters.push({
      id: 'cluster-bulk-rename',
      name: clusterName('bulk-rename', rename.files, rename),
      type: 'bulk-rename',
      files: [...rename.files],
      fileCount: rename.files.length,
      confidence: rename.confidence,
      risk: clusterRisk('bulk-rename'),
      recommendation: clusterRecommendation('bulk-rename'),
      suggestedCommitMessage: clusterMessage('bulk-rename', rename.files, rename),
      diffPattern: `s/${rename.from}/${rename.to}/g`,
    });
  }

  const buckets = new Map<WorktreeClusterType, Set<string>>();
  for (const entry of entries) {
    if (assigned.has(entry.path)) continue;
    const clusterType = classifyFileType(entry);
    let files = buckets.get(clusterType);
    if (!files) {
      files = new Set<string>();
      buckets.set(clusterType, files);
    }
    files.add(entry.path);
  }

  const sortedBuckets = [...buckets.entries()].sort((left, right) => {
    if (left[1].size !== right[1].size) return right[1].size - left[1].size;
    return left[0].localeCompare(right[0]);
  });

  for (const [type, fileSet] of sortedBuckets) {
    const files = [...fileSet].sort();
    const confidence = roundConfidence(Math.min(0.95, 0.5 + Math.min(files.length, 100) / 200));
    clusters.push({
      id: `cluster-${type}`,
      name: clusterName(type, files),
      type,
      files,
      fileCount: files.length,
      confidence,
      risk: clusterRisk(type),
      recommendation: clusterRecommendation(type),
      suggestedCommitMessage: clusterMessage(type, files),
    });
  }

  return clusters;
}

async function buildAssessment(workspace: string, entries: DirtyEntry[]): Promise<WorktreeAssessment> {
  const totalDirty = entries.length;
  const modified = entries.filter((entry) => entry.kind === 'modified').length;
  const untracked = entries.filter((entry) => entry.kind === 'untracked').length;
  const deleted = entries.filter((entry) => entry.kind === 'deleted').length;
  const renamed = entries.filter((entry) => entry.kind === 'renamed').length;
  const conflicted = entries.filter((entry) => entry.kind === 'conflicted').length;
  const trackedFilesRaw = runGit(workspace, ['ls-files']);
  const trackedFilesCount = trackedFilesRaw.length === 0 ? 0 : trackedFilesRaw.split('\n').length;
  const dirtyRatio = trackedFilesCount === 0 ? (totalDirty > 0 ? 1 : 0) : totalDirty / trackedFilesCount;

  let lastCommitAge = 'unknown';
  try {
    const commitTsRaw = runGit(workspace, ['log', '-1', '--format=%ct']).trim();
    if (commitTsRaw) {
      lastCommitAge = formatAge(Date.now(), Number.parseInt(commitTsRaw, 10));
    }
  } catch {
    // Keep unknown.
  }

  let commitsAhead = 0;
  let commitsBehind = 0;
  try {
    const divergence = runGit(workspace, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).trim();
    const parts = divergence.split(/\s+/u);
    if (parts.length >= 2) {
      commitsBehind = Number.parseInt(parts[0], 10) || 0;
      commitsAhead = Number.parseInt(parts[1], 10) || 0;
    }
  } catch {
    commitsAhead = 0;
    commitsBehind = 0;
  }

  return {
    totalDirty,
    modified,
    untracked,
    deleted,
    renamed,
    conflicted,
    dirtyRatio: roundConfidence(dirtyRatio),
    severity: severityForDirtyCount(totalDirty),
    estimatedAgentSessions: await estimateAgentSessions(workspace, entries),
    lastCommitAge,
    branchDivergence: commitsAhead + commitsBehind,
    commitsAhead,
    commitsBehind,
  };
}

export function createWorktreeTriageConstruction(): Construction<
  WorktreeTriageInput,
  WorktreeTriageOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'WorktreeTriageConstruction',
    name: 'Worktree Triage Construction',
    description: 'Assesses dirty git worktrees, clusters changes, and recommends safe recovery plans.',
    async execute(input: WorktreeTriageInput) {
      const workspace = path.resolve(input.workspace);
      const dirtyThreshold = Math.max(1, Math.floor(input.dirtyThreshold ?? DEFAULT_DIRTY_THRESHOLD));
      const statusRaw = runGit(workspace, ['status', '--porcelain=1', '--untracked-files=all', '--renames']);
      const entries = parseDirtyEntries(statusRaw);
      const assessment = await buildAssessment(workspace, entries);
      const rename = await detectRenameCandidate(workspace, entries);
      const clusters = buildClusters(entries, rename);

      const thresholdPolicy: WorktreeThresholdPolicy = {
        maxDirtyFiles: dirtyThreshold,
        exceeded: assessment.totalDirty > dirtyThreshold,
        action:
          assessment.totalDirty <= 0
            ? 'allow'
            : assessment.totalDirty > dirtyThreshold
              ? 'block'
              : 'warn',
      };

      const backupBranch = `triage-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
      const recoveryStrategies = createRecoveryStrategies(backupBranch);

      return ok<WorktreeTriageOutput, ConstructionError>({
        kind: 'WorktreeTriageReport.v1',
        assessment,
        clusters,
        thresholdPolicy,
        recoveryStrategies,
      });
    },
  };
}
