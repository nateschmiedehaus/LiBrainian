import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const createdDirs: string[] = [];

async function mkTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status ?? 1) !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`git ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
  return (result.stdout ?? '').trim();
}

async function createGitRepo(prefix: string): Promise<string> {
  const dir = await mkTempDir(prefix);
  runGit(dir, ['init']);
  runGit(dir, ['checkout', '-B', 'main']);
  runGit(dir, ['config', 'user.email', 'tests@librainian.invalid']);
  runGit(dir, ['config', 'user.name', 'LiBrainian Tests']);
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'baseline\n', 'utf8');
  runGit(dir, ['add', '.']);
  runGit(dir, ['commit', '--no-gpg-sign', '-m', 'baseline']);
  return dir;
}

async function runScript(args: string[], env: NodeJS.ProcessEnv = {}, cwd = process.cwd()) {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'portfolio-control.mjs');
  return execFileAsync('node', [scriptPath, ...args], {
    cwd,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      ...env,
    },
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('portfolio-control script', () => {
  it('builds milestone ledgers and rewrites the milestone brief from live-like inputs', async () => {
    const temp = await mkTempDir('portfolio-control-');
    const inputPath = path.join(temp, 'open.json');
    const closedPath = path.join(temp, 'closed.json');
    const outPath = path.join(temp, 'state', 'portfolio', 'open-issue-ledger.json');
    const scorecardDir = path.join(temp, 'state', 'milestones');
    const docsPath = path.join(temp, 'MILESTONE_BRIEF.md');
    const githubOutput = path.join(temp, 'github-output.txt');

    await fs.writeFile(
      docsPath,
      [
        '# Milestone Brief (M0 -> M4)',
        '',
        'Last updated: 2026-03-01',
        '',
        '## Backlog Snapshot',
        '',
        '- Total open issues: 0',
        '- M0: 0',
        '- M1: 0',
        '- M2: 0',
        '- M3: 0',
        '- M4: 0',
        '',
        '## Execution Policy',
        '',
        '1. Active implementation order is strict: `M0 -> M1`.',
        '',
        '## M0: Dogfood-Ready',
        '',
        'Open issues (2026-03-01): 0',
        '',
        '## M1: Construction MVP',
        '',
        'Open issues (2026-03-01): 0',
        '',
        '## M2: Agent Integration',
        '',
        'Open issues (2026-03-01): 0',
        '',
        '## M3: Scale & Epistemics',
        '',
        'Open issues (2026-03-01): 0',
        '',
        '## M4: World-Class',
        '',
        'Open issues (2026-03-01): 0',
        '',
      ].join('\n'),
      'utf8',
    );

    const openIssues = [
      {
        number: 905,
        title: 'Ready M0 source issue',
        body: '',
        url: 'https://example.com/905',
        labels: [{ name: 'triage/ready' }, { name: 'agent:actionable' }],
        milestone: { title: 'M0: Dogfood-Ready' },
        updatedAt: '2026-03-05T12:00:00Z',
      },
      {
        number: 1043,
        title: 'Meta manage M0 issue #906',
        body: 'Source issue: #906\nqueue=work',
        url: 'https://example.com/1043',
        labels: [{ name: 'agent:management-ticket' }, { name: 'agent:management-needed' }],
        milestone: { title: 'M0: Dogfood-Ready' },
        updatedAt: '2026-03-05T12:00:00Z',
      },
      {
        number: 906,
        title: 'Needs decomposition',
        body: '',
        url: 'https://example.com/906',
        labels: [{ name: 'agent:needs-decomposition' }, { name: 'triage/missing-essentials' }],
        milestone: { title: 'M0: Dogfood-Ready' },
        updatedAt: '2026-03-05T12:00:00Z',
      },
      {
        number: 850,
        title: 'Frozen M1 umbrella',
        body: '',
        url: 'https://example.com/850',
        labels: [{ name: 'lifecycle/frozen' }, { name: 'kind/tracking' }],
        milestone: { title: 'M0: Dogfood-Ready' },
        updatedAt: '2026-03-05T12:00:00Z',
      },
      {
        number: 745,
        title: 'Ready M1 source issue',
        body: '',
        url: 'https://example.com/745',
        labels: [{ name: 'triage/ready' }, { name: 'agent:actionable' }],
        milestone: { title: 'M1: Construction MVP' },
        updatedAt: '2026-03-05T12:00:00Z',
      },
      {
        number: 907,
        title: 'Verify pending M0 source issue',
        body: '',
        url: 'https://example.com/907',
        labels: [{ name: 'triage/ready' }, { name: 'agent:actionable' }, { name: 'verify:pending' }],
        milestone: { title: 'M0: Dogfood-Ready' },
        updatedAt: '2026-03-05T12:00:00Z',
      },
    ];

    const closedIssues = [
      {
        number: 911,
        title: 'Closed M0 source issue',
        body: '',
        url: 'https://example.com/911',
        labels: [{ name: 'triage/ready' }],
        milestone: { title: 'M0: Dogfood-Ready' },
        closedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];

    await fs.writeFile(inputPath, JSON.stringify(openIssues), 'utf8');
    await fs.writeFile(closedPath, JSON.stringify(closedIssues), 'utf8');

    await runScript([
      'ledger',
      '--repo', 'owner/repo',
      '--input', inputPath,
      '--closed-input', closedPath,
      '--out', outPath,
      '--scorecard-dir', scorecardDir,
      '--docs-sync', docsPath,
      '--write-docs',
      '--github-output', githubOutput,
    ]);

    const ledger = JSON.parse(await fs.readFile(outPath, 'utf8'));
    expect(ledger.activeMilestone).toBe('M0: Dogfood-Ready');
    expect(ledger.milestones['M0: Dogfood-Ready'].total).toBe(5);
    expect(ledger.milestones['M0: Dogfood-Ready'].executableSource).toBe(3);
    expect(ledger.milestones['M0: Dogfood-Ready'].executionReady).toBe(1);
    expect(ledger.milestones['M0: Dogfood-Ready'].management).toBe(1);
    expect(ledger.milestones['M0: Dogfood-Ready'].closedSource24h).toBe(1);
    expect(ledger.milestones['M0: Dogfood-Ready'].bundleIssueNumbers['m0:bundle-b']).toEqual([905, 907]);
    expect(ledger.milestones['M0: Dogfood-Ready'].bundleIssueNumbers['m0:bundle-a']).toEqual([906]);
    expect(ledger.milestones['M1: Construction MVP'].executionReady).toBe(1);

    const m0Scorecard = JSON.parse(
      await fs.readFile(path.join(scorecardDir, 'M0', 'scorecard.json'), 'utf8'),
    );
    expect(m0Scorecard.transitionVerdict).toBe('NO_GO');
    expect(m0Scorecard.readyIssueNumbers).toEqual([905]);

    const docs = await fs.readFile(docsPath, 'utf8');
    expect(docs).toContain('Generated from live GitHub issue ledger');
    expect(docs).toContain('advisory summary');
    expect(docs).toContain('M0: 5 total (3 executable, 1 execution-ready)');
    expect(docs).toContain('Open issues (');
    expect(docs).toContain('5 total / 3 executable / 1 execution-ready');
    const firstDocs = docs;

    await runScript([
      'ledger',
      '--repo', 'owner/repo',
      '--input', inputPath,
      '--closed-input', closedPath,
      '--out', outPath,
      '--scorecard-dir', scorecardDir,
      '--docs-sync', docsPath,
      '--write-docs',
    ]);
    expect(await fs.readFile(docsPath, 'utf8')).toBe(firstDocs);

    const outputs = await fs.readFile(githubOutput, 'utf8');
    expect(outputs).toContain('active_milestone=M0: Dogfood-Ready');
    expect(outputs).toContain('open_source=3');
    expect(outputs).toContain('runnable_source=1');
    expect(outputs).toContain('closed_source_24h=1');
  });

  it('selects work and verify issues from source issues only', async () => {
    const temp = await mkTempDir('portfolio-control-select-');
    const inputPath = path.join(temp, 'open.json');
    const closedPath = path.join(temp, 'closed.json');
    const workOutputPath = path.join(temp, 'work-output.txt');
    const verifyOutputPath = path.join(temp, 'verify-output.txt');

    const openIssues = [
      {
        number: 1061,
        title: 'meta: manage issue #910',
        body: 'Source issue: #910\nqueue=work',
        url: 'https://example.com/1061',
        labels: [{ name: 'agent:management-ticket' }, { name: 'triage/ready' }, { name: 'agent:actionable' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
      {
        number: 910,
        title: 'Ranking guardrail',
        body: '',
        url: 'https://example.com/910',
        labels: [{ name: 'triage/ready' }, { name: 'agent:actionable' }, { name: 'm0:bundle-a' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
      {
        number: 888,
        title: 'Incremental reindex',
        body: '',
        url: 'https://example.com/888',
        labels: [{ name: 'triage/ready' }, { name: 'agent:actionable' }, { name: 'm0:bundle-c' }, { name: 'verify:pending' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
      {
        number: 916,
        title: 'Golden path MCP descriptions',
        body: '',
        url: 'https://example.com/916',
        labels: [{ name: 'triage/ready' }, { name: 'agent:actionable' }, { name: 'm0:bundle-d' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
    ];

    await fs.writeFile(inputPath, JSON.stringify(openIssues), 'utf8');
    await fs.writeFile(closedPath, '[]', 'utf8');

    await runScript([
      'select-work',
      '--repo', 'owner/repo',
      '--input', inputPath,
      '--closed-input', closedPath,
      '--github-output', workOutputPath,
    ]);

    await runScript([
      'select-verify',
      '--repo', 'owner/repo',
      '--input', inputPath,
      '--closed-input', closedPath,
      '--github-output', verifyOutputPath,
    ]);

    const workOutputs = await fs.readFile(workOutputPath, 'utf8');
    expect(workOutputs).toContain('found=true');
    expect(workOutputs).toContain('issue_number=910');
    expect(workOutputs).toContain('issue_bundle=m0:bundle-a');

    const verifyOutputs = await fs.readFile(verifyOutputPath, 'utf8');
    expect(verifyOutputs).toContain('found=true');
    expect(verifyOutputs).toContain('issue_number=888');
    expect(verifyOutputs).toContain('issue_verify_pending=true');
  });

  it('repairs contradictory labels and closes malformed management tickets', async () => {
    const temp = await mkTempDir('portfolio-control-repair-');
    const inputPath = path.join(temp, 'open.json');
    const ghLogPath = path.join(temp, 'gh-log.jsonl');
    const ghStubPath = path.join(temp, 'gh');

    const openIssues = [
      {
        number: 905,
        title: 'Contradictory readiness',
        body: '',
        url: 'https://example.com/905',
        labels: [{ name: 'triage/ready' }, { name: 'triage/missing-essentials' }, { name: 'm1' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
      {
        number: 1043,
        title: 'meta: manage issue #1043',
        body: 'Source issue: #1043\nqueue=work',
        url: 'https://example.com/1043',
        labels: [{ name: 'agent:management-ticket' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
      {
        number: 1044,
        title: 'meta: manage missing source',
        body: 'queue=work',
        url: 'https://example.com/1044',
        labels: [{ name: 'agent:management-ticket' }],
        milestone: { title: 'M0: Dogfood-Ready' },
      },
    ];
    await fs.writeFile(inputPath, JSON.stringify(openIssues), 'utf8');

    await fs.writeFile(
      ghStubPath,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG_PATH, JSON.stringify(args) + '\\n');
process.stdout.write('{}');
`,
      'utf8',
    );
    await fs.chmod(ghStubPath, 0o755);

    await runScript([
      'repair',
      '--repo', 'owner/repo',
      '--input', inputPath,
      '--apply',
    ], {
      PATH: `${temp}:${process.env.PATH}`,
      GH_LOG_PATH: ghLogPath,
    });

    const calls = (await fs.readFile(ghLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);

    expect(calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['issue', 'edit', '905', '-R', 'owner/repo', '--remove-label', 'triage/ready']),
        expect.arrayContaining(['issue', 'edit', '905', '-R', 'owner/repo', '--remove-label', 'm1', '--add-label', 'm0']),
        expect.arrayContaining(['issue', 'edit', '905', '-R', 'owner/repo', '--add-label', 'm0:bundle-b']),
        expect.arrayContaining(['issue', 'close', '1043', '-R', 'owner/repo']),
        expect.arrayContaining(['issue', 'close', '1044', '-R', 'owner/repo']),
      ]),
    );
  });

  it('distinguishes preserved foreign dirty state from new agent-owned delta', async () => {
    const repo = await createGitRepo('portfolio-control-worktree-');
    const artifacts = await mkTempDir('portfolio-control-worktree-artifacts-');
    const baselinePath = path.join(artifacts, '.worktree-baseline.json');
    const deltaPath = path.join(artifacts, '.worktree-delta.json');

    await fs.writeFile(path.join(repo, 'tracked.txt'), 'baseline\nforeign change\n', 'utf8');

    await runScript([
      'worktree',
      '--out', baselinePath,
    ], {}, repo);

    await fs.writeFile(path.join(repo, 'agent-owned.txt'), 'new delta\n', 'utf8');

    await runScript([
      'worktree',
      '--baseline-in', baselinePath,
      '--out', deltaPath,
    ], {}, repo);

    const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
    expect(baseline.summary.totalDirty).toBe(1);
    expect(baseline.summary.severity).toBe('light');

    const delta = JSON.parse(await fs.readFile(deltaPath, 'utf8'));
    expect(delta.summary.baselineDirtyCount).toBe(1);
    expect(delta.summary.currentDirtyCount).toBe(2);
    expect(delta.summary.newDirtyCount).toBe(1);
    expect(delta.summary.touchedBaselineCount).toBe(0);
    expect(delta.summary.preservedBaselineCount).toBe(1);
    expect(delta.summary.guardAction).toBe('agent_delta_only');
    expect(delta.delta.newEntries.map((entry: { path: string }) => entry.path)).toEqual(['agent-owned.txt']);
  });
});
