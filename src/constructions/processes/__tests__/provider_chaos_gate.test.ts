import { describe, expect, it } from 'vitest';
import { createProviderChaosGateConstruction } from '../provider_chaos_gate.js';

describe('Provider Chaos Gate', () => {
  it('injects five failure modes, recovers, and reports clean post-recovery state', async () => {
    const gate = createProviderChaosGateConstruction();
    const result = await gate.execute({ maxDurationMs: 30_000, slowDelayMs: 10 });

    expect(result.kind).toBe('ProviderChaosGateResult.v1');
    expect(result.modeResults).toHaveLength(5);
    expect(result.modeResults.every((mode) => mode.recovered)).toBe(true);
    expect(result.modeResults.some((mode) => mode.injectedFailure)).toBe(true);
    expect(result.modeResults.every((mode) => mode.stateCorrupted === false)).toBe(true);
    expect(result.pass).toBe(true);
  });
});
