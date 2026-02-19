import { describe, expect, it } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import { sequence } from '../composition.js';
import { BaseConstruction, type ConstructionResult } from '../base/construction_base.js';
import { identity, seq } from '../operators.js';
import type { Construction, Context } from '../types.js';

class ExampleConstruction extends BaseConstruction<number, ConstructionResult & { data: number }> {
  readonly CONSTRUCTION_ID = 'example_construction';

  async execute(input: number): Promise<ConstructionResult & { data: number }> {
    return {
      data: input * 2,
      confidence: deterministic(true, 'example'),
      evidenceRefs: ['example:executed'],
      analysisTimeMs: 1,
    };
  }
}

describe('canonical construction interface bridge', () => {
  it('adapts BaseConstruction to canonical Construction via toConstruction', async () => {
    const construction = new ExampleConstruction({} as any);
    const adapted = construction.toConstruction('Example Construction');

    expect(adapted.id).toBe('example_construction');
    expect(adapted.name).toBe('Example Construction');

    const context: Context = {
      deps: { librarian: {} as any },
      signal: new AbortController().signal,
      sessionId: 'sess-test',
    };
    const result = await adapted.execute(3, context);
    expect(result.data).toBe(6);
  });

  it('allows composition operators to accept canonical Construction values', async () => {
    const first: Construction<number, ConstructionResult & { data: number }> = {
      id: 'first',
      name: 'First',
      async execute(input: number) {
        return {
          data: input + 1,
          confidence: deterministic(true, 'first'),
          evidenceRefs: ['first:executed'],
          analysisTimeMs: 1,
        };
      },
      getEstimatedConfidence: () => deterministic(true, 'first-estimate'),
    };

    const second: Construction<ConstructionResult & { data: number }, ConstructionResult & { data: number }> = {
      id: 'second',
      name: 'Second',
      async execute(input) {
        return {
          data: input.data * 4,
          confidence: deterministic(true, 'second'),
          evidenceRefs: ['second:executed'],
          analysisTimeMs: 1,
        };
      },
      getEstimatedConfidence: () => deterministic(true, 'second-estimate'),
    };

    const composed = sequence(first, second);
    const result = await composed.execute(2);
    expect(result.data).toBe(12);
  });

  it('allows wrapped BaseConstruction instances to participate in canonical operator composition', async () => {
    const wrapped = new ExampleConstruction({} as any).toConstruction('Wrapped Example');
    const chain = seq(
      identity<number>('identity', 'Identity'),
      wrapped
    );

    const result = await chain.execute(7, {
      deps: { librarian: {} as any },
      signal: new AbortController().signal,
      sessionId: 'sess-op',
    });

    expect(result.data).toBe(14);
  });
});
