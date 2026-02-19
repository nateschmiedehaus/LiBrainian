import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_SLA,
  assessSlaMetric,
  classifyCodebaseSize,
  resolveFullIndexTargetMs,
} from '../sla.js';

describe('performance SLA evaluator', () => {
  it('uses expected query latency thresholds', () => {
    expect(PERFORMANCE_SLA.queryLatency.p50Ms).toBe(500);
    expect(PERFORMANCE_SLA.queryLatency.p95Ms).toBe(2000);
    expect(PERFORMANCE_SLA.queryLatency.p99Ms).toBe(5000);
  });

  it('classifies codebase size buckets from file count', () => {
    expect(classifyCodebaseSize(100)).toBe('small');
    expect(classifyCodeSize(2000)).toBe('medium');
    expect(classifyCodeSize(50000)).toBe('large');
  });

  it('resolves full-index targets by size bucket', () => {
    expect(resolveFullIndexTargetMs(100)).toBe(30_000);
    expect(resolveFullIndexTargetMs(2_000)).toBe(300_000);
    expect(resolveFullIndexTargetMs(50_000)).toBe(1_800_000);
  });

  it('marks values as pass/alert/block by ratio', () => {
    expect(assessSlaMetric('query.p50', 500, 450).status).toBe('pass');
    expect(assessSlaMetric('query.p50', 500, 610).status).toBe('alert');
    expect(assessSlaMetric('query.p50', 500, 1100).status).toBe('block');
  });
});

function classifyCodeSize(fileCount: number) {
  return classifyCodebaseSize(fileCount);
}
