import { describe, expect, it } from 'vitest';
import type {
  AbExperimentReport,
  AbTaskComplexity,
  AbTaskRunResult,
  AbWorkerType,
} from '../ab_harness.js';
import {
  diagnoseAbReports,
  type AbTaskMetadata,
  type AbTaskPairInput,
} from '../ab_diagnosis.js';

function createRunResult(input: {
  taskId: string;
  workerType: AbWorkerType;
  complexity: AbTaskComplexity;
  success: boolean;
  durationMs: number;
  failureReason?: string;
}): AbTaskRunResult {
  return {
    taskId: input.taskId,
    repo: 'fixture-repo',
    complexity: input.complexity,
    workerType: input.workerType,
    contextLevel: 1,
    success: input.success,
    durationMs: input.durationMs,
    failureReason: input.failureReason,
    contextFiles: ['package.json'],
    extraContextFiles: input.workerType === 'treatment' ? ['src/main.ts'] : [],
    modifiedFiles: ['src/main.ts'],
    verification: {},
    verificationPolicy: {
      requireBaselineFailure: true,
      baselineCommandsConfigured: 1,
      verificationCommandsConfigured: 1,
      verificationFallbackUsed: false,
    },
    artifactIntegrity: {
      complete: true,
      requiredFiles: [],
      missingFiles: [],
    },
  };
}

function createReport(runId: string, pairs: AbTaskPairInput[]): AbExperimentReport {
  const results: AbTaskRunResult[] = [];
  for (const pair of pairs) {
    results.push(createRunResult({
      taskId: pair.taskId,
      workerType: 'control',
      complexity: pair.complexity,
      success: pair.control.success,
      durationMs: pair.control.durationMs,
      failureReason: pair.control.failureReason,
    }));
    results.push(createRunResult({
      taskId: pair.taskId,
      workerType: 'treatment',
      complexity: pair.complexity,
      success: pair.treatment.success,
      durationMs: pair.treatment.durationMs,
      failureReason: pair.treatment.failureReason,
    }));
  }

  const n = pairs.length;
  const controlSuccesses = pairs.filter((pair) => pair.control.success).length;
  const treatmentSuccesses = pairs.filter((pair) => pair.treatment.success).length;
  const controlSuccessRate = n > 0 ? controlSuccesses / n : 0;
  const treatmentSuccessRate = n > 0 ? treatmentSuccesses / n : 0;
  const controlDuration = pairs.reduce((sum, pair) => sum + pair.control.durationMs, 0);
  const treatmentDuration = pairs.reduce((sum, pair) => sum + pair.treatment.durationMs, 0);

  const byComplexity = {
    T1: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
    T2: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
    T3: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
    T4: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
    T5: { n: 0, successes: 0, successRate: 0, avgDurationMs: 0 },
  };

  return {
    runId,
    startedAt: '2026-02-21T00:00:00.000Z',
    completedAt: '2026-02-21T00:10:00.000Z',
    options: {
      reposRoot: '/tmp/repos',
      taskCount: n,
      selectedTaskIds: pairs.map((pair) => pair.taskId),
      selectionMode: 'sequential',
      evidenceProfile: 'release',
      workerTypes: ['control', 'treatment'],
    },
    results,
    control: {
      n,
      successes: controlSuccesses,
      successRate: controlSuccessRate,
      avgDurationMs: n > 0 ? controlDuration / n : 0,
      byComplexity,
    },
    treatment: {
      n,
      successes: treatmentSuccesses,
      successRate: treatmentSuccessRate,
      avgDurationMs: n > 0 ? treatmentDuration / n : 0,
      byComplexity,
    },
    lift: null,
    t3PlusLift: null,
    diagnostics: {
      failureReasons: {},
      criticalFailureReasons: {},
      modeCounts: {
        deterministic_edit: 0,
        agent_command: results.length,
      },
      agentCommandShare: 1,
      agentVerifiedExecutionShare: 1,
      agentBaselineGuardShare: 1,
      agentCritiqueShare: 1,
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
}

describe('diagnoseAbReports', () => {
  it('computes sample-size gap for small non-significant effects', () => {
    const report = createReport('run-small', [
      { taskId: 't1', complexity: 'T3', control: { success: true, durationMs: 1000 }, treatment: { success: true, durationMs: 900 } },
      { taskId: 't2', complexity: 'T3', control: { success: true, durationMs: 1000 }, treatment: { success: true, durationMs: 950 } },
      { taskId: 't3', complexity: 'T3', control: { success: true, durationMs: 1000 }, treatment: { success: true, durationMs: 900 } },
      { taskId: 't4', complexity: 'T3', control: { success: true, durationMs: 1000 }, treatment: { success: false, durationMs: 1100 } },
      { taskId: 't5', complexity: 'T3', control: { success: true, durationMs: 1000 }, treatment: { success: true, durationMs: 890 } },
      { taskId: 't6', complexity: 'T3', control: { success: false, durationMs: 1000 }, treatment: { success: true, durationMs: 900 } },
      { taskId: 't7', complexity: 'T3', control: { success: false, durationMs: 1000 }, treatment: { success: false, durationMs: 1000 } },
      { taskId: 't8', complexity: 'T3', control: { success: false, durationMs: 1000 }, treatment: { success: false, durationMs: 1000 } },
      { taskId: 't9', complexity: 'T3', control: { success: false, durationMs: 1000 }, treatment: { success: true, durationMs: 920 } },
      { taskId: 't10', complexity: 'T3', control: { success: false, durationMs: 1000 }, treatment: { success: false, durationMs: 1010 } },
    ]);

    const diagnosis = diagnoseAbReports({
      reports: [report],
      latestRunId: 'run-small',
    });

    expect(diagnosis.power.requiredPerGroup).toBeGreaterThan(10);
    expect(diagnosis.power.sampleGapPerGroup).toBeGreaterThan(0);
    expect(diagnosis.rootCause.category).toBe('sample_size');
    expect(diagnosis.decision.recommendedFocus).toBe('sampling_and_experiment_design');
  });

  it('stratifies outcomes by query type', () => {
    const report = createReport('run-strata', [
      { taskId: 'debug-1', complexity: 'T3', control: { success: false, durationMs: 1000 }, treatment: { success: true, durationMs: 800 } },
      { taskId: 'debug-2', complexity: 'T3', control: { success: false, durationMs: 1100 }, treatment: { success: true, durationMs: 850 } },
      { taskId: 'explain-1', complexity: 'T3', control: { success: true, durationMs: 900 }, treatment: { success: false, durationMs: 1000 } },
      { taskId: 'explain-2', complexity: 'T3', control: { success: true, durationMs: 950 }, treatment: { success: false, durationMs: 1100 } },
    ]);

    const metadata = new Map<string, AbTaskMetadata>([
      ['debug-1', { id: 'debug-1', queryType: 'debugging' }],
      ['debug-2', { id: 'debug-2', queryType: 'debugging' }],
      ['explain-1', { id: 'explain-1', queryType: 'explanation' }],
      ['explain-2', { id: 'explain-2', queryType: 'explanation' }],
    ]);

    const diagnosis = diagnoseAbReports({
      reports: [report],
      taskMetadataById: metadata,
    });

    expect(diagnosis.strata.byQueryType.debugging.nPairs).toBe(2);
    expect(diagnosis.strata.byQueryType.debugging.absoluteSuccessRateDelta).toBeGreaterThan(0);
    expect(diagnosis.strata.byQueryType.explanation.nPairs).toBe(2);
    expect(diagnosis.strata.byQueryType.explanation.absoluteSuccessRateDelta).toBeLessThan(0);
  });

  it('captures treatment-worse cases and duration outliers', () => {
    const report = createReport('run-outlier', [
      {
        taskId: 'task-worse',
        complexity: 'T4',
        control: { success: true, durationMs: 1000 },
        treatment: { success: false, durationMs: 12000, failureReason: 'verification_failed' },
      },
      {
        taskId: 'task-plain',
        complexity: 'T4',
        control: { success: true, durationMs: 1000 },
        treatment: { success: true, durationMs: 950 },
      },
      {
        taskId: 'task-plain-2',
        complexity: 'T4',
        control: { success: true, durationMs: 980 },
        treatment: { success: true, durationMs: 900 },
      },
      {
        taskId: 'task-plain-3',
        complexity: 'T4',
        control: { success: true, durationMs: 1020 },
        treatment: { success: true, durationMs: 950 },
      },
      {
        taskId: 'task-plain-4',
        complexity: 'T4',
        control: { success: true, durationMs: 1010 },
        treatment: { success: true, durationMs: 960 },
      },
      {
        taskId: 'task-plain-5',
        complexity: 'T4',
        control: { success: true, durationMs: 1005 },
        treatment: { success: true, durationMs: 940 },
      },
      {
        taskId: 'task-plain-6',
        complexity: 'T4',
        control: { success: true, durationMs: 995 },
        treatment: { success: true, durationMs: 930 },
      },
    ]);

    const diagnosis = diagnoseAbReports({ reports: [report] });
    expect(diagnosis.treatmentWorseCases).toHaveLength(1);
    expect(diagnosis.treatmentWorseCases[0]?.taskId).toBe('task-worse');
    expect(diagnosis.variance.outlierPairs.some((entry) => entry.taskId === 'task-worse')).toBe(true);
  });

  it('recommends synthesis/integration when effect is significantly negative', () => {
    const pairs: AbTaskPairInput[] = [];
    for (let index = 0; index < 40; index += 1) {
      pairs.push({
        taskId: `task-${index}`,
        complexity: 'T5',
        control: { success: true, durationMs: 1100 },
        treatment: { success: index < 20, durationMs: 1200, failureReason: index < 20 ? undefined : 'verification_failed' },
      });
    }
    const report = createReport('run-negative', pairs);

    const diagnosis = diagnoseAbReports({
      reports: [report],
      latestRunId: 'run-negative',
    });

    expect(diagnosis.overall.significance.pValue).not.toBeNull();
    expect(diagnosis.overall.absoluteSuccessRateDelta).toBeLessThan(0);
    expect(diagnosis.rootCause.category).toBe('negative_effect');
    expect(diagnosis.decision.recommendedFocus).toBe('synthesis_integration');
  });
});
