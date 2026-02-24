import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createWorktreeTriageConstruction } from '../../constructions/processes/worktree_triage_construction.js';
import { unwrapConstructionExecutionResult } from '../../constructions/types.js';
import type {
  WorktreeChangeCluster,
  WorktreeTriageOutput,
} from '../../constructions/processes/worktree_triage_construction.js';
import { createError } from '../errors.js';

export interface TriageCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface AppliedRecovery {
  mode: 'none' | 'auto-commit-clusters' | 'stash-and-branch' | 'revert-all';
  backupBranch: string | null;
  commitsCreated: number;
  stashed: boolean;
  reverted: boolean;
}

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
    const stderr = toSingleLine(`${result.stdout ?? ''} ${result.stderr ?? ''}`);
    throw createError('STORAGE_ERROR', `git ${args.join(' ')} failed: ${stderr || 'unknown error'}`);
  }
  return (result.stdout ?? '').trim();
}

function parseThreshold(rawValue: string | undefined): number | undefined {
  if (!rawValue) return undefined;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createError('INVALID_ARGUMENT', 'Invalid --threshold value. Use a positive integer.');
  }
  return parsed;
}

function clusterCommitMessage(cluster: WorktreeChangeCluster): string {
  return cluster.suggestedCommitMessage ?? `chore: triage ${cluster.type} cluster`;
}

function createBackupBranch(workspace: string, backupBranch: string): void {
  runGit(workspace, ['branch', backupBranch]);
}

function applyAutoCommitClusters(workspace: string, report: WorktreeTriageOutput): number {
  let commitsCreated = 0;
  const committable = report.clusters.filter((cluster) =>
    cluster.recommendation === 'commit' && cluster.risk === 'low' && cluster.fileCount > 0);
  for (const cluster of committable) {
    runGit(workspace, ['add', '--', ...cluster.files]);
    const staged = runGit(workspace, ['diff', '--cached', '--name-only']);
    if (!staged) {
      continue;
    }
    runGit(workspace, ['commit', '--no-gpg-sign', '-m', clusterCommitMessage(cluster)]);
    commitsCreated += 1;
  }
  return commitsCreated;
}

function applyRecovery(
  workspace: string,
  report: WorktreeTriageOutput,
  action: 'none' | 'auto' | 'stash' | 'revert',
  confirm: boolean,
): AppliedRecovery {
  if (action === 'none' || report.assessment.totalDirty <= 0) {
    return {
      mode: 'none',
      backupBranch: null,
      commitsCreated: 0,
      stashed: false,
      reverted: false,
    };
  }

  const backupBranch = report.recoveryStrategies[0]?.backupBranch ?? `triage-backup-${Date.now()}`;
  createBackupBranch(workspace, backupBranch);

  if (action === 'auto') {
    const commitsCreated = applyAutoCommitClusters(workspace, report);
    return {
      mode: 'auto-commit-clusters',
      backupBranch,
      commitsCreated,
      stashed: false,
      reverted: false,
    };
  }

  if (action === 'stash') {
    runGit(workspace, ['stash', 'push', '--include-untracked', '-m', `librarian-triage-${Date.now()}`]);
    return {
      mode: 'stash-and-branch',
      backupBranch,
      commitsCreated: 0,
      stashed: true,
      reverted: false,
    };
  }

  if (!confirm) {
    throw createError('INVALID_ARGUMENT', 'Revert requires --confirm. No changes were made.');
  }
  runGit(workspace, ['reset', '--hard', 'HEAD']);
  runGit(workspace, ['clean', '-fd']);
  return {
    mode: 'revert-all',
    backupBranch,
    commitsCreated: 0,
    stashed: false,
    reverted: true,
  };
}

function printTextReport(report: WorktreeTriageOutput, applied: AppliedRecovery): void {
  console.log('');
  console.log('Worktree Triage Report');
  console.log('======================');
  console.log(`Status: ${report.assessment.severity.toUpperCase()} (${report.assessment.totalDirty} dirty files)`);
  console.log(`Dirty threshold: ${report.thresholdPolicy.maxDirtyFiles} (${report.thresholdPolicy.exceeded ? 'EXCEEDED' : 'within limit'})`);
  console.log(`Branch divergence: ${report.assessment.commitsBehind} behind / ${report.assessment.commitsAhead} ahead`);
  console.log(`Estimated agent sessions: ${report.assessment.estimatedAgentSessions}`);
  console.log('');
  if (report.clusters.length === 0) {
    console.log('No dirty clusters detected.');
  } else {
    console.log('Change clusters:');
    for (const cluster of report.clusters) {
      const pattern = cluster.diffPattern ? ` pattern=${cluster.diffPattern}` : '';
      console.log(
        `- ${cluster.name}: ${cluster.fileCount} files | ${cluster.type} | risk=${cluster.risk} | recommendation=${cluster.recommendation}${pattern}`,
      );
    }
  }
  console.log('');
  if (applied.mode === 'none') {
    console.log('Recovery applied: none');
  } else {
    console.log(
      `Recovery applied: ${applied.mode} (backup=${applied.backupBranch}, commits=${applied.commitsCreated}, stashed=${applied.stashed}, reverted=${applied.reverted})`,
    );
  }
  if (report.thresholdPolicy.exceeded) {
    console.log('');
    console.log('Threshold policy: BLOCKED. Resolve dirty state before adding new edits.');
    console.log('Use: librarian triage --auto | --stash | --revert --confirm');
  }
  console.log('');
}

export async function triageCommand(options: TriageCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
      threshold: { type: 'string' },
      auto: { type: 'boolean', default: false },
      stash: { type: 'boolean', default: false },
      revert: { type: 'boolean', default: false },
      confirm: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const actionFlags = [Boolean(values.auto), Boolean(values.stash), Boolean(values.revert)].filter(Boolean).length;
  if (actionFlags > 1) {
    throw createError('INVALID_ARGUMENT', 'Use only one recovery flag: --auto, --stash, or --revert.');
  }
  const action: 'none' | 'auto' | 'stash' | 'revert' =
    values.auto ? 'auto' : values.stash ? 'stash' : values.revert ? 'revert' : 'none';

  const threshold = parseThreshold(values.threshold ? String(values.threshold) : undefined);
  const construction = createWorktreeTriageConstruction();
  const report = unwrapConstructionExecutionResult(await construction.execute({
    workspace,
    dirtyThreshold: threshold,
  }));

  const applied = applyRecovery(workspace, report, action, Boolean(values.confirm));
  const payload = {
    kind: 'WorktreeTriageCli.v1',
    report,
    appliedRecovery: applied,
  };

  if (values.json) {
    console.log(JSON.stringify(payload));
  } else {
    printTextReport(report, applied);
  }

  if (report.thresholdPolicy.exceeded && action === 'none') {
    process.exitCode = 2;
  }
}
