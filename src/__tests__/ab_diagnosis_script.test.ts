import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function makeFixtureReport(reportPath: string): void {
  const report = {
    runId: 'ab-fixture-run',
    startedAt: '2026-02-21T00:00:00.000Z',
    completedAt: '2026-02-21T00:05:00.000Z',
    options: {
      reposRoot: '/tmp/repos',
      taskCount: 2,
      selectedTaskIds: ['task-a', 'task-b'],
      selectionMode: 'sequential',
      evidenceProfile: 'quick',
      workerTypes: ['control', 'treatment'],
    },
    results: [
      {
        taskId: 'task-a',
        repo: 'fixture-repo',
        complexity: 'T3',
        workerType: 'control',
        contextLevel: 1,
        success: true,
        durationMs: 1000,
        contextFiles: ['package.json'],
        extraContextFiles: [],
        modifiedFiles: ['src/main.ts'],
        verification: {},
        verificationPolicy: {
          requireBaselineFailure: true,
          baselineCommandsConfigured: 1,
          verificationCommandsConfigured: 1,
          verificationFallbackUsed: false,
        },
      },
      {
        taskId: 'task-a',
        repo: 'fixture-repo',
        complexity: 'T3',
        workerType: 'treatment',
        contextLevel: 1,
        success: true,
        durationMs: 800,
        contextFiles: ['package.json'],
        extraContextFiles: ['src/main.ts'],
        modifiedFiles: ['src/main.ts'],
        verification: {},
        verificationPolicy: {
          requireBaselineFailure: true,
          baselineCommandsConfigured: 1,
          verificationCommandsConfigured: 1,
          verificationFallbackUsed: false,
        },
      },
      {
        taskId: 'task-b',
        repo: 'fixture-repo',
        complexity: 'T4',
        workerType: 'control',
        contextLevel: 1,
        success: false,
        durationMs: 1200,
        failureReason: 'verification_failed',
        contextFiles: ['package.json'],
        extraContextFiles: [],
        modifiedFiles: ['src/main.ts'],
        verification: {},
        verificationPolicy: {
          requireBaselineFailure: true,
          baselineCommandsConfigured: 1,
          verificationCommandsConfigured: 1,
          verificationFallbackUsed: false,
        },
      },
      {
        taskId: 'task-b',
        repo: 'fixture-repo',
        complexity: 'T4',
        workerType: 'treatment',
        contextLevel: 1,
        success: true,
        durationMs: 900,
        contextFiles: ['package.json'],
        extraContextFiles: ['src/main.ts'],
        modifiedFiles: ['src/main.ts'],
        verification: {},
        verificationPolicy: {
          requireBaselineFailure: true,
          baselineCommandsConfigured: 1,
          verificationCommandsConfigured: 1,
          verificationFallbackUsed: false,
        },
      },
    ],
    control: {
      n: 2,
      successes: 1,
      successRate: 0.5,
      avgDurationMs: 1100,
      byComplexity: {
        T1: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
        T2: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
        T3: { n: 1, successes: 1, successRate: 1, avgDurationMs: 1000 },
        T4: { n: 1, successes: 0, successRate: 0, avgDurationMs: 1200 },
        T5: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
      },
    },
    treatment: {
      n: 2,
      successes: 2,
      successRate: 1,
      avgDurationMs: 850,
      byComplexity: {
        T1: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
        T2: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
        T3: { n: 1, successes: 1, successRate: 1, avgDurationMs: 800 },
        T4: { n: 1, successes: 1, successRate: 1, avgDurationMs: 900 },
        T5: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
      },
    },
    lift: null,
    t3PlusLift: null,
    diagnostics: {
      failureReasons: {},
      criticalFailureReasons: {},
      modeCounts: {
        deterministic_edit: 0,
        agent_command: 4,
      },
      agentCommandShare: 1,
      agentVerifiedExecutionShare: 1,
      agentBaselineGuardShare: 1,
      agentCritiqueShare: 0,
      artifactIntegrityShare: 1,
      verificationFallbackRuns: 0,
      verificationFallbackShare: 0,
      providerPreflight: null,
    },
    gates: {
      passed: true,
      reasons: [],
      classifiedReasons: [],
      severityCounts: {
        blocking: 0,
        quality: 0,
        sample_size: 0,
        dependency: 0,
        informational: 0,
      },
      categoryCounts: {
        execution: 0,
        objective: 0,
        measurement: 0,
        dependency: 0,
        sample_size: 0,
        quality: 0,
        context: 0,
        other: 0,
      },
      thresholds: {
        requireAgentCommandTasks: true,
        minAgentCommandShare: 1,
        minT3SuccessRateLift: 0.25,
        requireT3Significance: true,
        requireNoCriticalFailures: true,
        minAgentVerifiedExecutionShare: 1,
        minAgentCritiqueShare: 0,
        requireBaselineFailureForAgentTasks: true,
        minArtifactIntegrityShare: 1,
        maxVerificationFallbackShare: 0,
        requireT3CeilingTimeReduction: true,
        minT3CeilingTimeReduction: 0.01,
      },
    },
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

describe('ab diagnosis script', () => {
  it('produces JSON and markdown diagnosis artifacts', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'ab-diagnosis-script-'));
    const reportPath = path.join(tmpRoot, 'ab-report.json');
    const tasksPath = path.join(tmpRoot, 'tasks.json');
    const outJson = path.join(tmpRoot, 'ab-diagnosis.json');
    const outMd = path.join(tmpRoot, 'ab-diagnosis.md');

    makeFixtureReport(reportPath);
    writeFileSync(
      tasksPath,
      JSON.stringify({
        tasks: [
          { id: 'task-a', queryType: 'debugging' },
          { id: 'task-b', queryType: 'explanation' },
        ],
      }, null, 2),
    );

    const result = spawnSync(
      'node',
      [
        'scripts/run-with-tmpdir.mjs',
        '--',
        'tsx',
        'scripts/ab-diagnosis.ts',
        '--report',
        reportPath,
        '--taskFile',
        tasksPath,
        '--out',
        outJson,
        '--markdown',
        outMd,
        '--latestRunId',
        'ab-fixture-run',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(existsSync(outJson)).toBe(true);
    expect(existsSync(outMd)).toBe(true);

    const diagnosisRaw = readFileSync(outJson, 'utf8');
    const diagnosis = JSON.parse(diagnosisRaw) as {
      reportsAnalyzed: number;
      pairCount: number;
      strata: {
        byQueryType: Record<string, { nPairs: number }>;
      };
    };
    expect(diagnosis.reportsAnalyzed).toBe(1);
    expect(diagnosis.pairCount).toBe(2);
    expect(diagnosis.strata.byQueryType.debugging?.nPairs).toBe(1);
    expect(diagnosis.strata.byQueryType.explanation?.nPairs).toBe(1);

    await rm(tmpRoot, { recursive: true, force: true });
  });
});
