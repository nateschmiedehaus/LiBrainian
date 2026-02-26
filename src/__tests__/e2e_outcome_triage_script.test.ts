import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type JsonRecord = Record<string, unknown>;

async function writeJson(filePath: string, value: JsonRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

describe('e2e outcome triage script', () => {
  it('escalates critical reliability regressions as immediate actions', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librarian-e2e-triage-'));
    const reportPath = path.join(workspace, 'outcome-report.json');
    const artifactPath = path.join(workspace, 'outcome-triage.json');
    const markdownPath = path.join(workspace, 'outcome-triage.md');
    const planPath = path.join(workspace, 'agent-issue-fix-plan.json');
    const planMarkdownPath = path.join(workspace, 'agent-issue-fix-plan.md');
    await writeJson(reportPath, {
      schema_version: 1,
      kind: 'E2EOutcomeReport.v1',
      status: 'failed',
      createdAt: new Date().toISOString(),
      failures: ['reliability_lift_below_threshold:-0.0909<0'],
      diagnoses: ['Treatment reliability underperformed control.'],
      suggestions: ['Inspect failed treatment tasks and rerun targeted AB tasks.'],
      controlVsTreatment: {
        topRegressions: [
          {
            taskId: 'task-001',
            evidence: '/tmp/fake-evidence.json',
          },
        ],
      },
    });

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'e2e-outcome-triage.mjs');
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--report',
        reportPath,
        '--artifact',
        artifactPath,
        '--markdown',
        markdownPath,
        '--plan-artifact',
        planPath,
        '--plan-markdown',
        planMarkdownPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status).toBe(2);
    const triage = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord;
    const summary = triage.summary as JsonRecord;
    expect(summary.immediateActions).toBe(1);
    const immediate = triage.immediateActions as JsonRecord[];
    expect(immediate[0]?.key).toBe('reliability-lift-negative');
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as JsonRecord;
    expect(plan.kind).toBe('E2ERemediationPlan.v1');
    const queue = plan.queue as JsonRecord[];
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]?.priority).toBe('P0');
    expect((queue[0]?.verificationCommands as string[]).length).toBeGreaterThan(0);
    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('Immediate Actions');
    const planMarkdown = await readFile(planMarkdownPath, 'utf8');
    expect(planMarkdown).toContain('Execution Queue');

    await rm(workspace, { recursive: true, force: true });
  });

  it('emits issue candidates for non-critical freshness failures', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librarian-e2e-triage-freshness-'));
    const reportPath = path.join(workspace, 'outcome-report.json');
    const artifactPath = path.join(workspace, 'outcome-triage.json');
    const planPath = path.join(workspace, 'agent-issue-fix-plan.json');
    await writeJson(reportPath, {
      schema_version: 1,
      kind: 'E2EOutcomeReport.v1',
      status: 'failed',
      createdAt: new Date().toISOString(),
      failures: ['freshness:stale:ab:300.00h>240h'],
      diagnoses: ['Outcome evidence freshness is stale or missing.'],
      suggestions: ['Refresh agentic-use-case and AB artifacts.'],
      controlVsTreatment: {
        topRegressions: [],
      },
    });

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'e2e-outcome-triage.mjs');
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--report',
        reportPath,
        '--artifact',
        artifactPath,
        '--plan-artifact',
        planPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status).toBe(0);
    const triage = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord;
    const summary = triage.summary as JsonRecord;
    expect(summary.immediateActions).toBe(0);
    expect(summary.issueCandidates).toBeGreaterThan(0);
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as JsonRecord;
    const queue = plan.queue as JsonRecord[];
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((entry) => typeof entry.priority === 'string')).toBe(true);

    await rm(workspace, { recursive: true, force: true });
  });
});
