import { describe, it, expect } from 'vitest';
import { createStageTracker } from '../query_stage_reporting.js';

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
});
