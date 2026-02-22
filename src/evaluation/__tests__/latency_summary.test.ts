import { describe, expect, it } from 'vitest';
import { summarizeLatencySamples } from '../latency_summary.js';

describe('summarizeLatencySamples', () => {
  it('computes realistic p50/p99 from non-zero latency samples', () => {
    const summary = summarizeLatencySamples([
      { queryType: 'structural', latencyMs: 120 },
      { queryType: 'structural', latencyMs: 240 },
      { queryType: 'structural', latencyMs: 360 },
      { queryType: 'synthesis', latencyMs: 800 },
      { queryType: 'synthesis', latencyMs: 1200 },
    ]);

    expect(summary.overall.sampleCount).toBe(5);
    expect(summary.overall.p50Ms).toBeGreaterThan(0);
    expect(summary.overall.p99Ms).toBeGreaterThanOrEqual(summary.overall.p50Ms);
    expect(summary.byQueryType.structural.p50Ms).toBeLessThan(summary.byQueryType.synthesis.p50Ms);
  });

  it('ignores invalid samples and returns zeros when no valid latency exists', () => {
    const summary = summarizeLatencySamples([
      { queryType: 'structural', latencyMs: -1 },
      { queryType: 'synthesis', latencyMs: Number.NaN },
    ]);

    expect(summary.overall.sampleCount).toBe(0);
    expect(summary.overall.p50Ms).toBe(0);
    expect(summary.overall.p99Ms).toBe(0);
  });
});
