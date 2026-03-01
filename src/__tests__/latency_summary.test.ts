import { describe, expect, it } from 'vitest';
import { summarizeLatencySamples } from '../evaluation/latency_summary.js';

describe('latency summary', () => {
  it('computes overall and per-query-type latency stats', () => {
    const summary = summarizeLatencySamples([
      { queryType: 'structural', latencyMs: 10 },
      { queryType: 'structural', latencyMs: 30 },
      { queryType: 'synthesis', latencyMs: 20 },
      { queryType: 'synthesis', latencyMs: 40 },
    ]);

    expect(summary.count).toBe(4);
    expect(summary.minMs).toBe(10);
    expect(summary.maxMs).toBe(40);
    expect(summary.meanMs).toBe(25);
    expect(summary.p50Ms).toBe(20);
    expect(summary.p95Ms).toBe(40);
    expect(summary.p99Ms).toBe(40);

    expect(summary.byQueryType.structural?.count).toBe(2);
    expect(summary.byQueryType.structural?.p50Ms).toBe(10);
    expect(summary.byQueryType.synthesis?.count).toBe(2);
    expect(summary.byQueryType.synthesis?.p50Ms).toBe(20);
  });

  it('returns zeroed stats for empty input', () => {
    const summary = summarizeLatencySamples([]);
    expect(summary.count).toBe(0);
    expect(summary.minMs).toBe(0);
    expect(summary.maxMs).toBe(0);
    expect(summary.meanMs).toBe(0);
    expect(summary.p50Ms).toBe(0);
    expect(summary.p95Ms).toBe(0);
    expect(summary.p99Ms).toBe(0);
    expect(summary.byQueryType).toEqual({});
  });
});
