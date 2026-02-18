#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import {
  buildIssueFixPlan,
  type AgentIssueSnapshot,
  type IssueFixPlan,
} from '../src/strategic/agent_issue_feedback.js';

interface GhIssue {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels?: Array<{ name?: string }>;
  comments?: Array<unknown>;
}

interface RestIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels?: Array<{ name?: string }>;
  comments?: number;
  pull_request?: unknown;
}

interface IssueLoadResult {
  issues: AgentIssueSnapshot[];
  source: 'gh' | 'github-rest';
  warning?: string;
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

function resolveRepo(defaultRepo?: string): string {
  if (defaultRepo && defaultRepo.trim().length > 0) {
    return defaultRepo.trim();
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

function mapIssueSnapshot(issue: {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels?: Array<{ name?: string }>;
  comments?: Array<unknown> | number;
}): AgentIssueSnapshot {
  const commentCount = Array.isArray(issue.comments)
    ? issue.comments.length
    : (typeof issue.comments === 'number' ? issue.comments : 0);
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    labels: Array.isArray(issue.labels)
      ? issue.labels
          .map((label) => (typeof label?.name === 'string' ? label.name.trim() : ''))
          .filter((label) => label.length > 0)
      : [],
    comments: commentCount,
  };
}

function loadIssuesViaGh(repo: string, state: string, limit: number): IssueLoadResult {
  const args = [
    'issue',
    'list',
    '--repo', repo,
    '--state', state,
    '--limit', String(limit),
    '--json', 'number,title,url,createdAt,updatedAt,labels,comments',
  ];

  const gh = spawnSync('gh', args, { encoding: 'utf8' });
  if (gh.status !== 0) {
    const detail = String(gh.stderr || gh.stdout || '').trim();
    throw new Error(detail || `exit ${gh.status ?? 'unknown'}`);
  }

  const parsed = JSON.parse(String(gh.stdout ?? '[]')) as GhIssue[];
  return {
    source: 'gh',
    issues: parsed.map((issue) => mapIssueSnapshot({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      labels: issue.labels,
      comments: issue.comments,
    })),
  };
}

async function loadIssuesViaGitHubRest(repo: string, state: string, limit: number): Promise<IssueLoadResult> {
  const allowedStates = new Set(['open', 'closed', 'all']);
  const normalizedState = allowedStates.has(state) ? state : 'open';
  const issues: AgentIssueSnapshot[] = [];
  let page = 1;

  while (issues.length < limit) {
    const remaining = limit - issues.length;
    const perPage = Math.min(100, Math.max(1, remaining));
    const url = `https://api.github.com/repos/${repo}/issues?state=${encodeURIComponent(normalizedState)}&per_page=${perPage}&page=${page}&sort=updated&direction=desc`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'librainian-issue-feedback-loop',
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub REST issue fetch failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const payload = await response.json() as RestIssue[];
    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    for (const issue of payload) {
      if (issue.pull_request) continue;
      issues.push(mapIssueSnapshot({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        labels: issue.labels,
        comments: issue.comments ?? 0,
      }));
      if (issues.length >= limit) break;
    }

    if (payload.length < perPage) {
      break;
    }
    page += 1;
  }

  return {
    source: 'github-rest',
    issues,
  };
}

async function loadIssuesWithFallback(repo: string, state: string, limit: number): Promise<IssueLoadResult> {
  try {
    return loadIssuesViaGh(repo, state, limit);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const fallback = await loadIssuesViaGitHubRest(repo, state, limit);
    return {
      ...fallback,
      warning: `gh issue list failed; used GitHub REST fallback (${detail})`,
    };
  }
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function renderMarkdown(plan: IssueFixPlan, repo: string, state: string): string {
  const lines: string[] = [];

  lines.push('# Agent Issue Fix Plan');
  lines.push('');
  lines.push(`- Repo: ${repo}`);
  lines.push(`- State: ${state}`);
  lines.push(`- Generated: ${plan.generatedAt}`);
  lines.push(`- Total issues: ${plan.summary.totalIssues}`);
  lines.push(`- Priority split: P0=${plan.summary.p0}, P1=${plan.summary.p1}, P2=${plan.summary.p2}, P3=${plan.summary.p3}`);
  lines.push('');
  lines.push('## Execution Queue');
  lines.push('');

  if (plan.queue.length === 0) {
    lines.push('No matching issues found.');
    lines.push('');
    return lines.join('\n');
  }

  for (const item of plan.queue) {
    lines.push(`1. [#${item.number}](${item.url}) ${item.title}`);
    lines.push(`   - Priority: ${item.priority} (score ${item.score})`);
    lines.push(`   - Area: ${item.area}`);
    lines.push(`   - Wave: ${item.recommendedWave}`);
    lines.push(`   - Action: ${item.recommendedAction}`);
    if (item.reasons.length > 0) {
      lines.push(`   - Rationale: ${item.reasons.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: 'string' },
      state: { type: 'string', default: 'open' },
      limit: { type: 'string', default: '200' },
      out: { type: 'string', default: 'state/plans/agent-issue-fix-plan.json' },
      'markdown-out': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const limitRaw = String(values.limit ?? '200');
  const limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }

  const repo = resolveRepo(typeof values.repo === 'string' ? values.repo : undefined);
  const state = typeof values.state === 'string' && values.state.trim().length > 0
    ? values.state.trim()
    : 'open';

  const loadResult = await loadIssuesWithFallback(repo, state, limit);
  const issues = loadResult.issues;
  const plan = buildIssueFixPlan(issues);

  const jsonOut = path.resolve(String(values.out ?? 'state/plans/agent-issue-fix-plan.json'));
  const markdownOut = path.resolve(
    typeof values['markdown-out'] === 'string' && values['markdown-out'].trim().length > 0
      ? values['markdown-out']
      : jsonOut.replace(/\.json$/i, '.md'),
  );

  ensureParentDir(jsonOut);
  ensureParentDir(markdownOut);

  fs.writeFileSync(jsonOut, JSON.stringify({ repo, state, ...plan }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(markdownOut, renderMarkdown(plan, repo, state), 'utf8');

  if (values.json) {
    console.log(JSON.stringify({ repo, state, ...plan }, null, 2));
    return;
  }

  console.log('Agent issue fix plan generated');
  console.log(`Repo: ${repo}`);
  console.log(`Issue source: ${loadResult.source}`);
  console.log(`Issues analyzed: ${plan.summary.totalIssues}`);
  console.log(`P0/P1/P2/P3: ${plan.summary.p0}/${plan.summary.p1}/${plan.summary.p2}/${plan.summary.p3}`);
  console.log(`JSON: ${jsonOut}`);
  console.log(`Markdown: ${markdownOut}`);
  if (loadResult.warning) {
    console.log(`Warning: ${loadResult.warning}`);
  }

  const preview = plan.queue.slice(0, 5);
  if (preview.length > 0) {
    console.log('\nTop queue:');
    for (const item of preview) {
      console.log(`- [${item.priority}] #${item.number} ${item.title}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`issue-feedback-loop failed: ${message}`);
  process.exitCode = 1;
});
