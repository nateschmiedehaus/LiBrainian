#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildBaselineFailureTriage,
  buildDeferredIssueCandidate,
  type BaselineFailureTriageResult,
  type DeferredIssueCandidate,
} from '../src/evaluation/baseline_failure_autotriage.js';

interface CliOptions {
  logPath: string;
  artifactPath: string;
  markdownPath: string;
  repo: string;
  createGhIssues: boolean;
  scopePaths: string[];
  scopeFromGit: boolean;
  issueMilestone: string;
}

interface IssueAction {
  key: string;
  action: 'created' | 'updated' | 'reopened' | 'skipped';
  reason?: string;
  number?: number;
  url?: string;
}

interface GhIssueRef {
  number: number;
  url: string;
  state: 'open' | 'closed';
}

const DEFAULT_ARTIFACT = 'state/triage/baseline-failure-triage.json';
const DEFAULT_MARKDOWN = 'state/triage/baseline-failure-triage.md';
const DEFAULT_MILESTONE = 'M0: Dogfood-Ready';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    logPath: '',
    artifactPath: DEFAULT_ARTIFACT,
    markdownPath: DEFAULT_MARKDOWN,
    repo: process.env.GITHUB_REPOSITORY ?? '',
    createGhIssues: true,
    scopePaths: [],
    scopeFromGit: true,
    issueMilestone: DEFAULT_MILESTONE,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];

    if (arg === '--log') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --log');
      options.logPath = value;
      i += 1;
      continue;
    }
    if (arg === '--artifact') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --artifact');
      options.artifactPath = value;
      i += 1;
      continue;
    }
    if (arg === '--markdown') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --markdown');
      options.markdownPath = value;
      i += 1;
      continue;
    }
    if (arg === '--repo') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --repo');
      options.repo = value;
      i += 1;
      continue;
    }
    if (arg === '--scope') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --scope');
      options.scopePaths.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
      i += 1;
      continue;
    }
    if (arg === '--issue-milestone') {
      if (!value || value.startsWith('--')) throw new Error('Missing value for --issue-milestone');
      options.issueMilestone = value;
      i += 1;
      continue;
    }
    if (arg === '--scope-from-git') {
      options.scopeFromGit = true;
      continue;
    }
    if (arg === '--no-scope-from-git') {
      options.scopeFromGit = false;
      continue;
    }
    if (arg === '--create-gh-issues') {
      options.createGhIssues = true;
      continue;
    }
    if (arg === '--no-create-gh-issues') {
      options.createGhIssues = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.logPath) {
    throw new Error('Missing required --log <path>');
  }

  return options;
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    const stdout = String(result.stdout ?? '').trim();
    const stderr = String(result.stderr ?? '').trim();
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${combined ? `\n${combined}` : ''}`);
  }
  return String(result.stdout ?? '').trim();
}

function ghAvailable(repo: string): boolean {
  if (!repo) return false;
  try {
    run('gh', ['--version']);
    run('gh', ['auth', 'status', '-h', 'github.com']);
    return true;
  } catch {
    return false;
  }
}

function collectScopePathsFromGit(): string[] {
  const files = new Set<string>();
  const commands: Array<string[]> = [
    ['diff', '--name-only', '--diff-filter=ACMR'],
    ['diff', '--name-only', '--cached', '--diff-filter=ACMR'],
  ];

  for (const args of commands) {
    try {
      const output = run('git', args);
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) files.add(trimmed);
      }
    } catch {
      continue;
    }
  }

  return Array.from(files);
}

function toIssueSearch(repo: string, marker: string): GhIssueRef | null {
  const output = run('gh', [
    'issue', 'list',
    '--repo', repo,
    '--search', `${marker} in:body`,
    '--state', 'all',
    '--limit', '1',
    '--json', 'number,url,state',
  ]);

  const parsed = JSON.parse(output) as Array<{ number?: number; url?: string; state?: string }>;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const first = parsed[0];
  if (!first || typeof first.number !== 'number' || typeof first.url !== 'string') return null;
  const state = first.state === 'closed' ? 'closed' : 'open';
  return { number: first.number, url: first.url, state };
}

function renderIssueUpdateComment(candidate: DeferredIssueCandidate, triage: BaselineFailureTriageResult): string {
  const lines: string[] = [];
  lines.push('## Baseline failure observed again');
  lines.push('');
  lines.push(`- Triage timestamp: ${triage.generatedAt}`);
  lines.push(`- Must fix now: ${triage.summary.mustFixNow}`);
  lines.push(`- Deferred baseline items: ${triage.summary.deferNonScope}`);
  lines.push('');
  lines.push('### Current evidence');
  lines.push('```text');
  const evidenceBlock = candidate.body
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);
  lines.push(...evidenceBlock);
  lines.push('```');
  lines.push('');
  lines.push(candidate.marker);
  return `${lines.join('\n')}\n`;
}

function createOrUpdateIssue(repo: string, candidate: DeferredIssueCandidate, triage: BaselineFailureTriageResult): IssueAction {
  const existing = toIssueSearch(repo, candidate.marker);
  if (existing) {
    if (existing.state === 'closed') {
      run('gh', ['issue', 'reopen', String(existing.number), '--repo', repo]);
      run('gh', ['issue', 'comment', String(existing.number), '--repo', repo, '--body', renderIssueUpdateComment(candidate, triage)]);
      return {
        key: candidate.key,
        action: 'reopened',
        number: existing.number,
        url: existing.url,
      };
    }

    run('gh', ['issue', 'comment', String(existing.number), '--repo', repo, '--body', renderIssueUpdateComment(candidate, triage)]);
    return {
      key: candidate.key,
      action: 'updated',
      number: existing.number,
      url: existing.url,
    };
  }

  const args = [
    'issue', 'create',
    '--repo', repo,
    '--title', candidate.title,
    '--body', candidate.body,
  ];

  if (candidate.milestone && candidate.milestone.trim().length > 0) {
    args.push('--milestone', candidate.milestone);
  }

  for (const label of candidate.labels) {
    args.push('--label', label);
  }

  const issueUrl = run('gh', args);
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  const number = match ? Number.parseInt(match[1], 10) : undefined;

  return {
    key: candidate.key,
    action: 'created',
    number,
    url: issueUrl,
  };
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  const absolute = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function writeText(filePath: string, content: string): Promise<void> {
  const absolute = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

function buildMarkdown(
  triage: BaselineFailureTriageResult,
  issueActions: IssueAction[],
  candidates: DeferredIssueCandidate[],
): string {
  const lines: string[] = [];
  lines.push('# Baseline Failure Triage');
  lines.push('');
  lines.push(`- Generated: ${triage.generatedAt}`);
  lines.push(`- Scope paths: ${triage.scopePaths.length > 0 ? triage.scopePaths.join(', ') : 'none'}`);
  lines.push(`- must_fix_now: ${triage.summary.mustFixNow}`);
  lines.push(`- defer_non_scope: ${triage.summary.deferNonScope}`);
  lines.push(`- expected_diagnostic: ${triage.summary.expectedDiagnostic}`);
  lines.push('');

  lines.push('## Immediate Follow-Up');
  if (triage.immediateFollowUp.length === 0) {
    lines.push('- None');
  } else {
    for (const item of triage.immediateFollowUp) {
      lines.push(`- [${item.verdict}] ${item.summary}${item.command ? ` -> \`${item.command}\`` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Deferred Baseline Issue Actions');
  if (issueActions.length === 0) {
    lines.push('- None');
  } else {
    for (const action of issueActions) {
      lines.push(`- ${action.key}: ${action.action}${action.url ? ` (${action.url})` : ''}${action.reason ? ` - ${action.reason}` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Deferred Candidates');
  if (candidates.length === 0) {
    lines.push('- None');
  } else {
    for (const candidate of candidates) {
      lines.push(`- ${candidate.title} (${candidate.marker})`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const logAbsolutePath = path.resolve(process.cwd(), options.logPath);
  const logContent = await readFile(logAbsolutePath, 'utf8');

  const scopePaths = new Set<string>(options.scopePaths);
  if (options.scopeFromGit) {
    for (const file of collectScopePathsFromGit()) {
      scopePaths.add(file);
    }
  }

  const triage = buildBaselineFailureTriage(logContent, {
    scopePaths: Array.from(scopePaths),
  });

  const deferredCandidates = triage.deferNonScope.map((signal) => buildDeferredIssueCandidate(signal, {
    scopePaths: Array.from(scopePaths),
    sourceLogPath: options.logPath,
    issueMilestone: options.issueMilestone,
  }));

  const issueActions: IssueAction[] = [];
  const canCreateIssues = options.createGhIssues && ghAvailable(options.repo);
  if (deferredCandidates.length > 0) {
    if (canCreateIssues) {
      for (const candidate of deferredCandidates) {
        issueActions.push(createOrUpdateIssue(options.repo, candidate, triage));
      }
    } else {
      for (const candidate of deferredCandidates) {
        issueActions.push({
          key: candidate.key,
          action: 'skipped',
          reason: options.createGhIssues ? 'gh_unavailable_or_repo_missing' : 'auto_creation_disabled',
        });
      }
    }
  }

  const payload = {
    ...triage,
    issueActions,
    deferredIssueCandidates: deferredCandidates,
  };

  await writeJson(options.artifactPath, payload);
  await writeText(options.markdownPath, buildMarkdown(triage, issueActions, deferredCandidates));

  const mustFixNow = triage.summary.mustFixNow > 0;
  const deferredUntracked = triage.summary.deferNonScope > 0 && issueActions.some((action) => action.action === 'skipped');

  if (mustFixNow) {
    console.error(`[baseline-triage] must_fix_now=${triage.summary.mustFixNow}`);
    process.exit(2);
  }
  if (deferredUntracked) {
    console.error('[baseline-triage] defer_non_scope found but could not create/update tracking issues');
    process.exit(3);
  }

  console.log(`[baseline-triage] completed must_fix_now=${triage.summary.mustFixNow} defer_non_scope=${triage.summary.deferNonScope} expected_diagnostic=${triage.summary.expectedDiagnostic}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[baseline-triage] failed: ${message}`);
  process.exit(1);
});
