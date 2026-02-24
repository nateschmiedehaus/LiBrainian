#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import {
  evaluateIssueClosureHygiene,
  requiresReleaseGradeClosureEvidence,
  type IssueClosureHygieneFinding,
  type IssueClosureHygieneInput,
} from '../src/strategic/issue_hygiene.js';

interface GhIssueLabel {
  name?: string;
}

interface GhMilestone {
  title?: string;
}

interface GhIssueRecord {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  body?: string | null;
  labels?: GhIssueLabel[];
  milestone?: GhMilestone | null;
  closed_at?: string | null;
  pull_request?: unknown;
}

interface GhIssueComment {
  body?: string | null;
}

interface IssueViolation {
  issue: IssueClosureHygieneInput;
  findings: IssueClosureHygieneFinding[];
}

function parseRepoFromRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  const httpsMatch = trimmed.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (httpsMatch && httpsMatch[1]) {
    return httpsMatch[1];
  }
  return null;
}

function resolveRepo(explicitRepo?: string): string {
  if (explicitRepo && explicitRepo.trim().length > 0) {
    return explicitRepo.trim();
  }
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (remote.status !== 0) {
    throw new Error('Unable to infer GitHub repo from git remote. Pass --repo owner/name.');
  }
  const parsed = parseRepoFromRemoteUrl(String(remote.stdout ?? ''));
  if (!parsed) {
    throw new Error('Could not parse GitHub repo from origin remote. Pass --repo owner/name.');
  }
  return parsed;
}

function runGhCommand(args: string[]): string {
  const gh = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (gh.status !== 0) {
    const detail = String(gh.stderr || gh.stdout || '').trim();
    throw new Error(detail || `gh failed with exit ${gh.status ?? 'unknown'}`);
  }
  return String(gh.stdout ?? '');
}

function fetchClosedIssues(repo: string, limit: number): GhIssueRecord[] {
  const output = runGhCommand([
    'api',
    '--paginate',
    '--method',
    'GET',
    `repos/${repo}/issues`,
    '-f',
    'state=closed',
    '-f',
    'per_page=100',
    '-f',
    'sort=updated',
    '-f',
    'direction=desc',
    '--jq',
    '.[] | select(.pull_request | not) | @base64',
  ]);

  const rows = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const issues: GhIssueRecord[] = [];
  for (const row of rows) {
    const decoded = Buffer.from(row, 'base64').toString('utf8');
    const issue = JSON.parse(decoded) as GhIssueRecord;
    issues.push(issue);
    if (issues.length >= limit) {
      break;
    }
  }
  return issues;
}

function fetchIssueComments(repo: string, issueNumber: number): string[] {
  const output = runGhCommand([
    'api',
    '--method',
    'GET',
    `repos/${repo}/issues/${issueNumber}/comments`,
    '-f',
    'per_page=100',
  ]);
  const payload = JSON.parse(output) as GhIssueComment[];
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((comment) => (typeof comment.body === 'string' ? comment.body : ''))
    .filter((body) => body.trim().length > 0);
}

function toHygieneInput(issue: GhIssueRecord, comments: string[]): IssueClosureHygieneInput {
  return {
    number: issue.number,
    url: issue.html_url,
    title: issue.title,
    state: issue.state,
    milestoneTitle: typeof issue.milestone?.title === 'string' ? issue.milestone.title : null,
    labels: Array.isArray(issue.labels)
      ? issue.labels
          .map((label) => (typeof label?.name === 'string' ? label.name.trim() : ''))
          .filter((label) => label.length > 0)
      : [],
    body: typeof issue.body === 'string' ? issue.body : '',
    comments,
  };
}

function isWithinLookback(closedAt: string | null | undefined, lookbackDays: number): boolean {
  if (!closedAt) return false;
  const closedMs = Date.parse(closedAt);
  if (!Number.isFinite(closedMs)) return false;
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return closedMs >= cutoffMs;
}

function reportViolations(violations: IssueViolation[], dryRun: boolean): void {
  if (violations.length === 0) {
    console.log('issue hygiene: pass (no closure evidence violations found)');
    return;
  }

  console.log(`issue hygiene: found ${violations.length} closure evidence violation(s)`);
  for (const violation of violations) {
    console.log(`- #${violation.issue.number} ${violation.issue.url}`);
    for (const finding of violation.findings) {
      console.log(`  - [${finding.code}] ${finding.message}`);
    }
  }

  if (dryRun) {
    console.log('issue hygiene: dry-run mode enabled; exiting without failure');
    return;
  }

  process.exitCode = 1;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: 'string' },
      limit: { type: 'string', default: '200' },
      'lookback-days': { type: 'string', default: '14' },
      'pin-limit': { type: 'string' },
      'missing-essentials-days': { type: 'string' },
      'stale-days': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  const repo = resolveRepo(typeof values.repo === 'string' ? values.repo : undefined);

  const parsedLimit = Number.parseInt(String(values.limit ?? '200'), 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    throw new Error(`Invalid --limit value: ${String(values.limit ?? '')}`);
  }

  const parsedLookbackDays = Number.parseInt(String(values['lookback-days'] ?? '14'), 10);
  if (!Number.isFinite(parsedLookbackDays) || parsedLookbackDays <= 0) {
    throw new Error(`Invalid --lookback-days value: ${String(values['lookback-days'] ?? '')}`);
  }

  const rawIssues = fetchClosedIssues(repo, parsedLimit);
  const candidateIssues = rawIssues.filter((issue) => isWithinLookback(issue.closed_at, parsedLookbackDays));

  const checked: IssueClosureHygieneInput[] = [];
  const violations: IssueViolation[] = [];

  for (const issue of candidateIssues) {
    const candidate = toHygieneInput(issue, []);
    if (!requiresReleaseGradeClosureEvidence(candidate)) {
      continue;
    }

    const comments = fetchIssueComments(repo, issue.number);
    const enriched = toHygieneInput(issue, comments);
    checked.push(enriched);

    const result = evaluateIssueClosureHygiene(enriched);
    if (!result.compliant) {
      violations.push({
        issue: enriched,
        findings: result.findings,
      });
    }
  }

  if (values.json) {
    console.log(JSON.stringify({
      repo,
      lookbackDays: parsedLookbackDays,
      checked: checked.length,
      violations,
    }, null, 2));
  } else {
    console.log(`issue hygiene: checked ${checked.length} release-grade closure(s) in ${repo}`);
    reportViolations(violations, Boolean(values['dry-run']));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`issue hygiene failed: ${message}`);
  process.exitCode = 1;
});
