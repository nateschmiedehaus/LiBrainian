import { describe, expect, it } from 'vitest';
import { shouldFailForThreshold, type BenchmarkFailOn, type BenchmarkSlaStatus } from '../benchmark.js';

function status(id: string, value: BenchmarkSlaStatus) {
  return { metricId: id, status: value, target: 1, actual: 1, ratio: 1 };
}

describe('benchmark fail-threshold policy', () => {
  it('never fails when fail-on is never', () => {
    const result = shouldFailForThreshold([status('query.p99', 'block')], 'never');
    expect(result).toBe(false);
  });

  it('fails on block-only threshold', () => {
    expect(shouldFailForThreshold([status('query.p95', 'alert')], asMode('block'))).toBe(false);
    expect(shouldFailForThreshold([status('query.p99', 'block')], asMode('block'))).toBe(true);
  });

  it('fails on alert threshold when configured', () => {
    expect(shouldFailForThreshold([status('query.p95', 'alert')], asMode('alert'))).toBe(true);
  });
});

function asMode(value: BenchmarkFailOn): BenchmarkFailOn {
  return value;
}
