import { describe, expect, it } from 'vitest';
import type { StageResult } from '../types.js';
import { computeFitnessReport } from '../fitness.js';

function baseStage(status: StageResult['status'] = 'passed'): StageResult {
  return {
    status,
    metrics: {},
    durationMs: 10,
    artifacts: [],
  };
}

function createStages(agenticMetrics: Record<string, number>): {
  stage0: StageResult;
  stage1: StageResult;
  stage2: StageResult;
  stage3: StageResult;
  stage4: StageResult;
  stage5: StageResult;
} {
  return {
    stage0: {
      ...baseStage(),
      metrics: { schema_valid: true, determinism_verified: true },
    },
    stage1: {
      ...baseStage(),
      metrics: { tests_passed: 10, tests_total: 10 },
    },
    stage2: {
      ...baseStage(),
      metrics: { tests_passed: 5, tests_total: 5 },
    },
    stage3: {
      ...baseStage(),
      metrics: { tests_passed: 2, tests_total: 2 },
    },
    stage4: {
      ...baseStage(),
      metrics: { injection_resistance: 1, provenance_labeling: 1, fail_closed: true },
    },
    stage5: {
      ...baseStage(),
      metrics: {
        task_completion_lift: agenticMetrics.task_completion_lift,
        time_to_solution_reduction: agenticMetrics.time_to_solution_reduction,
        context_usage_rate: agenticMetrics.context_usage_rate,
        code_quality_lift: agenticMetrics.code_quality_lift,
        decision_accuracy: agenticMetrics.decision_accuracy,
        agent_satisfaction_score: agenticMetrics.agent_satisfaction_score,
        missing_context_rate: agenticMetrics.missing_context_rate,
        irrelevant_context_rate: agenticMetrics.irrelevant_context_rate,
      },
    },
  };
}

const scope = {
  repository: 'librarian',
  subsystem: 'evolution',
  commitHash: 'test',
};

describe('fitness agentic utility integration', () => {
  it('includes all 8 agenticUtility sub-metrics in the fitness vector', () => {
    const report = computeFitnessReport(
      'variant-agentic',
      scope,
      createStages({
        task_completion_lift: 0.5,
        time_to_solution_reduction: 0.4,
        context_usage_rate: 0.8,
        code_quality_lift: 0.3,
        decision_accuracy: 0.9,
        agent_satisfaction_score: 0.85,
        missing_context_rate: 0.1,
        irrelevant_context_rate: 0.2,
      }),
    );

    expect(report.fitness.agenticUtility.taskCompletionLift).toBeCloseTo(0.5, 6);
    expect(report.fitness.agenticUtility.timeToSolutionReduction).toBeCloseTo(0.4, 6);
    expect(report.fitness.agenticUtility.contextUsageRate).toBeCloseTo(0.8, 6);
    expect(report.fitness.agenticUtility.codeQualityLift).toBeCloseTo(0.3, 6);
    expect(report.fitness.agenticUtility.decisionAccuracy).toBeCloseTo(0.9, 6);
    expect(report.fitness.agenticUtility.agentSatisfactionScore).toBeCloseTo(0.85, 6);
    expect(report.fitness.agenticUtility.missingContextRate).toBeCloseTo(0.1, 6);
    expect(report.fitness.agenticUtility.irrelevantContextRate).toBeCloseTo(0.2, 6);
  });

  it('gives agentic utility at least 25% influence on overall score', () => {
    const lowAgentic = computeFitnessReport(
      'variant-low-agentic',
      scope,
      createStages({
        task_completion_lift: 0.0,
        time_to_solution_reduction: 0.0,
        context_usage_rate: 0.1,
        code_quality_lift: 0.0,
        decision_accuracy: 0.2,
        agent_satisfaction_score: 0.1,
        missing_context_rate: 0.8,
        irrelevant_context_rate: 0.7,
      }),
    );
    const highAgentic = computeFitnessReport(
      'variant-high-agentic',
      scope,
      createStages({
        task_completion_lift: 1.0,
        time_to_solution_reduction: 0.8,
        context_usage_rate: 0.95,
        code_quality_lift: 0.9,
        decision_accuracy: 0.95,
        agent_satisfaction_score: 0.95,
        missing_context_rate: 0.05,
        irrelevant_context_rate: 0.05,
      }),
    );

    expect(highAgentic.fitness.overall).toBeGreaterThan(lowAgentic.fitness.overall + 0.2);
  });
});
