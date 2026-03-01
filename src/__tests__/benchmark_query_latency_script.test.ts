import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('benchmark-query-latency script guardrails', () => {
  it('tracks warm/cold SLOs and can fail the run on regression', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'benchmark-query-latency.ts');
    const script = fs.readFileSync(scriptPath, 'utf8');

    expect(script).toContain('const WARM_QUERY_P50_SLO_MS = 500;');
    expect(script).toContain('const COLD_QUERY_P95_SLO_MS = 2000;');
    expect(script).toContain("runPhase: 'cold' | 'warm';");
    expect(script).toContain("failOnSlo: { type: 'boolean', default: false }");
    expect(script).toContain("const coldSamples = successfulSamples.filter((sample) => sample.runPhase === 'cold');");
    expect(script).toContain("const warmSamples = successfulSamples.filter((sample) => sample.runPhase === 'warm');");
    expect(script).toContain('const coldLatency = summarizeLatencySamples(coldSamples);');
    expect(script).toContain('const warmLatency = summarizeLatencySamples(warmSamples);');
    expect(script).toContain('const warmP50Passed = warmLatency.p50Ms <= WARM_QUERY_P50_SLO_MS;');
    expect(script).toContain('const coldP95Passed = coldLatency.p95Ms <= COLD_QUERY_P95_SLO_MS;');
    expect(script).toContain('if (values.failOnSlo === true && !slo.passed)');
  });
});
