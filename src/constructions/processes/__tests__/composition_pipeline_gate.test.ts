import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createCompositionPipelineGateConstruction } from '../composition_pipeline_gate.js';

describe('Composition Pipeline Gate', () => {
  it('validates sequence and parallel composition behavior, timeout enforcement, and error propagation', async () => {
    const gate = createCompositionPipelineGateConstruction();
    const result = unwrapConstructionExecutionResult(
      await gate.execute({
        timeoutMs: 30,
        slowStepDelayMs: 120,
        maxDurationMs: 30_000,
      }),
    );

    expect(result.kind).toBe('CompositionPipelineGateResult.v1');
    expect(result.sequence.dataFlowValid).toBe(true);
    expect(result.sequence.coherent).toBe(true);
    expect(result.parallel.branchCount).toBeGreaterThanOrEqual(2);
    expect(result.parallel.metricsAligned).toBe(true);
    expect(result.parallel.mergedCoherent).toBe(true);
    expect(result.timeout.enforced).toBe(true);
    expect(result.errorPropagation.propagated).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.pass).toBe(true);
  });
});
