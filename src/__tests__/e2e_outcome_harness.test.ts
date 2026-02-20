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

function buildTaskbank(): JsonRecord {
  const repos = ['repo-alpha', 'repo-beta', 'repo-gamma'];
  const tasks = Array.from({ length: 20 }, (_, index) => {
    const id = `task-${String(index + 1).padStart(3, '0')}`;
    return {
      taskId: id,
      repo: repos[index % repos.length],
      complexity: index < 8 ? 'T2' : 'T3',
      prompt: `Natural task prompt ${index + 1}`,
    };
  });
  return {
    schema_version: 1,
    kind: 'E2EOutcomeTaskbank.v1',
    tasks,
  };
}

function buildAgenticReport(createdAt: string): JsonRecord {
  const taskbank = buildTaskbank();
  const tasks = Array.isArray(taskbank.tasks) ? taskbank.tasks as JsonRecord[] : [];
  return {
    schema: 'AgenticUseCaseReview.v1',
    createdAt,
    results: tasks.map((task, index) => ({
      repo: task.repo,
      useCaseId: task.taskId,
      intent: task.prompt,
      success: index % 9 !== 0,
      strictSignals: [],
    })),
  };
}

function buildAbReport(createdAt: string): JsonRecord {
  const taskbank = buildTaskbank();
  const tasks = (Array.isArray(taskbank.tasks) ? taskbank.tasks as JsonRecord[] : []).slice(0, 10);
  const rows = tasks.flatMap((task, index) => {
    const taskId = String(task.taskId);
    const repo = String(task.repo);
    return [
      {
        taskId,
        repo,
        complexity: 'T3',
        workerType: 'control',
        mode: 'agent_command',
        agentCritique: { valid: true },
        success: index % 4 === 0 ? false : true,
        durationMs: 22000 + index * 500,
        agentCommand: { durationMs: 18000 + index * 400 },
      },
      {
        taskId,
        repo,
        complexity: 'T3',
        workerType: 'treatment',
        mode: 'agent_command',
        agentCritique: { valid: true },
        success: true,
        durationMs: 16000 + index * 450,
        agentCommand: { durationMs: 13000 + index * 350 },
      },
    ];
  });
  return {
    runId: 'test-run',
    startedAt: createdAt,
    completedAt: createdAt,
    results: rows,
  };
}

describe('e2e outcome harness script', () => {
  it('generates pass report and markdown when thresholds are satisfied', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librarian-e2e-outcome-'));
    const now = new Date().toISOString();
    const taskbankPath = path.join(workspace, 'taskbank.json');
    const agenticPath = path.join(workspace, 'agentic.json');
    const abPath = path.join(workspace, 'ab.json');
    const artifactPath = path.join(workspace, 'outcome-report.json');
    const markdownPath = path.join(workspace, 'outcome-report.md');
    await writeJson(taskbankPath, buildTaskbank());
    await writeJson(agenticPath, buildAgenticReport(now));
    await writeJson(abPath, buildAbReport(now));

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'e2e-outcome-harness.mjs');
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--taskbank',
        taskbankPath,
        '--agentic-report',
        agenticPath,
        '--ab-report',
        abPath,
        '--artifact',
        artifactPath,
        '--markdown',
        markdownPath,
        '--strict',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord;
    expect(report.kind).toBe('E2EOutcomeReport.v1');
    expect(report.status).toBe('passed');
    const natural = report.naturalTasks as JsonRecord;
    expect(natural.total).toBe(20);
    expect(natural.uniqueRepos).toBe(3);
    const paired = report.controlVsTreatment as JsonRecord;
    expect(paired.pairedTasks).toBe(10);
    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('## Disconfirmation');
    expect(markdown).toContain('## Diagnoses');
    expect(markdown).toContain('## Suggestions');
    expect(markdown).toContain('## Top Wins');
    expect(markdown).toContain('## Top Regressions');

    await rm(workspace, { recursive: true, force: true });
  });

  it('fails strict mode when freshness gate is violated', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librarian-e2e-outcome-stale-'));
    const staleDate = '2025-01-01T00:00:00.000Z';
    const taskbankPath = path.join(workspace, 'taskbank.json');
    const agenticPath = path.join(workspace, 'agentic.json');
    const abPath = path.join(workspace, 'ab.json');
    const artifactPath = path.join(workspace, 'outcome-report.json');
    await writeJson(taskbankPath, buildTaskbank());
    await writeJson(agenticPath, buildAgenticReport(staleDate));
    await writeJson(abPath, buildAbReport(staleDate));

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'e2e-outcome-harness.mjs');
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--taskbank',
        taskbankPath,
        '--agentic-report',
        agenticPath,
        '--ab-report',
        abPath,
        '--artifact',
        artifactPath,
        '--strict',
        '--max-age-hours',
        '1',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    expect(result.status).not.toBe(0);
    const report = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord;
    expect(report.status).toBe('failed');
    const natural = report.naturalTasks as JsonRecord;
    expect(natural.total).toBe(20);
    const paired = report.controlVsTreatment as JsonRecord;
    expect(paired.pairedTasks).toBe(10);
    const diagnoses = Array.isArray(report.diagnoses) ? report.diagnoses.map((entry) => String(entry)) : [];
    expect(diagnoses.length).toBeGreaterThan(0);
    const suggestions = Array.isArray(report.suggestions) ? report.suggestions.map((entry) => String(entry)) : [];
    expect(suggestions.length).toBeGreaterThan(0);
    const failures = Array.isArray(report.failures) ? report.failures.map((entry) => String(entry)) : [];
    expect(failures.some((entry) => entry.includes('freshness'))).toBe(true);

    await rm(workspace, { recursive: true, force: true });
  });
});
