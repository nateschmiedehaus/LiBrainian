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

function loadIssues(repo: string, state: string, limit: number): AgentIssueSnapshot[] {
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
    throw new Error(`gh issue list failed: ${detail || `exit ${gh.status ?? 'unknown'}`}`);
  }

  const parsed = JSON.parse(String(gh.stdout ?? '[]')) as GhIssue[];
  return parsed.map((issue) => ({
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
    comments: Array.isArray(issue.comments) ? issue.comments.length : 0,
  }));
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

function main(): void {
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

  const issues = loadIssues(repo, state, limit);
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
  console.log(`Issues analyzed: ${plan.summary.totalIssues}`);
  console.log(`P0/P1/P2/P3: ${plan.summary.p0}/${plan.summary.p1}/${plan.summary.p2}/${plan.summary.p3}`);
  console.log(`JSON: ${jsonOut}`);
  console.log(`Markdown: ${markdownOut}`);

  const preview = plan.queue.slice(0, 5);
  if (preview.length > 0) {
    console.log('\nTop queue:');
    for (const item of preview) {
      console.log(`- [${item.priority}] #${item.number} ${item.title}`);
    }
  }
}

main();
