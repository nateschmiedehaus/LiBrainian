import { describe, expect, it } from 'vitest';
import { createQueryRelevanceGateConstruction } from '../query_relevance_gate.js';

describe('Query Relevance Gate', () => {
  it('evaluates curated query pairs, reports precision@k, and flags threshold regressions', async () => {
    const gate = createQueryRelevanceGateConstruction();
    const result = await gate.execute();

    expect(result.kind).toBe('QueryRelevanceGateResult.v1');
    expect(result.k).toBe(5);
    expect(result.precisionThreshold).toBe(0.4);
    expect(result.fixtures.length).toBeGreaterThan(0);
    expect(result.fixtures.every((fixture) => fixture.pairResults.length >= 5)).toBe(true);

    expect(
      result.fixtures.every((fixture) =>
        fixture.pairResults.every((pair) =>
          pair.precisionAtK >= 0 &&
          pair.precisionAtK <= 1 &&
          pair.confidenceValues.every((confidence) => confidence >= 0 && confidence <= 1)
        )
      )
    ).toBe(true);

    expect(
      result.fixtures.every((fixture) =>
        fixture.pairResults.every((pair) => !pair.topFiles.some((file) => file.includes('.librarian/')))
      )
    ).toBe(true);

    const hasPrecisionRegression = result.fixtures.some((fixture) =>
      fixture.pairResults.some((pair) => pair.precisionAtK < result.precisionThreshold),
    );
    if (hasPrecisionRegression) {
      expect(result.pass).toBe(false);
      expect(result.findings.some((finding) => finding.includes(`precision@${result.k}`))).toBe(true);
    }
  }, 160_000);
});
