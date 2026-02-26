import { describe, it, expect } from 'vitest';
import { buildCoverageAssessment, createStageTracker } from '../query_stage_reporting.js';

describe('query stage reporting', () => {
  it('queues issues before start and marks failed when output is empty', () => {
    const tracker = createStageTracker();
    tracker.issue('semantic_retrieval', { message: 'no intent', severity: 'moderate' });
    const ctx = tracker.start('semantic_retrieval', 1);
    expect(ctx.issues).toHaveLength(1);
    const report = tracker.finish(ctx, { outputCount: 0 });
    expect(report.status).toBe('failed');
    expect(report.issues[0]?.message).toBe('no intent');
  });

  it('marks success when output exists and no issues are recorded', () => {
    const tracker = createStageTracker();
    const ctx = tracker.start('direct_packs', 2);
    const report = tracker.finish(ctx, { outputCount: 2, filteredCount: 0 });
    expect(report.status).toBe('success');
    expect(report.results.filteredCount).toBe(0);
  });

  it('finalizeMissing creates skipped stages with queued issues', () => {
    const tracker = createStageTracker();
    tracker.issue('synthesis', { message: 'llm disabled', severity: 'minor' });
    tracker.finalizeMissing(['synthesis']);
    const report = tracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('skipped');
    expect(report?.issues.length).toBe(1);
  });

  it('marks partial when output is empty without issues', () => {
    const tracker = createStageTracker();
    const ctx = tracker.start('graph_expansion', 3);
    const report = tracker.finish(ctx, { outputCount: 0 });
    expect(report.status).toBe('partial');
  });

  it('isolates telemetry snapshots from observer mutations', () => {
    const tracker = createStageTracker((report) => {
      if (report.results.telemetry) {
        report.results.telemetry.rerankWindow = 999;
      }
    });
    const ctx = tracker.start('reranking', 2);
    tracker.finish(ctx, {
      outputCount: 2,
      telemetry: {
        rerankWindow: 10,
        rerankInputCount: 2,
        rerankAppliedCount: 2,
      },
    });
    const report = tracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.results.telemetry?.rerankWindow).toBe(10);
  });

  it('builds coverage assessment with bounded metrics and actionable suggestions', () => {
    const assessment = buildCoverageAssessment({
      stageReports: [
        {
          stage: 'semantic_retrieval',
          status: 'failed',
          results: { inputCount: 1, outputCount: 0, filteredCount: 1 },
          issues: [{ message: 'no semantic candidates', severity: 'significant' }],
          durationMs: 10,
        },
        {
          stage: 'graph_expansion',
          status: 'skipped',
          results: { inputCount: 0, outputCount: 0, filteredCount: 0 },
          issues: [],
          durationMs: 0,
        },
        {
          stage: 'synthesis',
          status: 'skipped',
          results: { inputCount: 0, outputCount: 0, filteredCount: 0 },
          issues: [],
          durationMs: 0,
        },
      ],
      totalConfidence: 0.2,
      packCount: 0,
      coverageGaps: ['missing evidence'],
      weights: {
        baseOffset: 0.2,
        packDivisor: 12,
        gapPenaltyMax: 0.4,
        gapPenaltyStep: 0.04,
        totalConfidenceWeight: 0.4,
        successRatioWeight: 0.2,
        failedCountWeight: 0.1,
        confidenceBase: 0.2,
        confidenceSuccessWeight: 0.6,
        confidenceFailedWeight: 0.1,
      },
    });

    expect(assessment.estimatedCoverage).toBeGreaterThanOrEqual(0);
    expect(assessment.estimatedCoverage).toBeLessThanOrEqual(1);
    expect(assessment.coverageConfidence).toBeGreaterThanOrEqual(0);
    expect(assessment.coverageConfidence).toBeLessThanOrEqual(1);
    expect(assessment.suggestions).toContain('Index the project and include affected files to improve coverage.');
    expect(assessment.suggestions).toContain('Enable graph metrics during bootstrap to improve graph expansion.');
  });
});
