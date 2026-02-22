import { describe, expect, it } from 'vitest';
import { ConstructionError, ConstructionTimeoutError } from '../base/construction_base.js';
import { atom, seq, withRetry } from '../operators.js';
import { fail, isConstructionOutcome } from '../types.js';

describe('strict ConstructionOutcome migration', () => {
  it('returns explicit ok(...) outcomes for successful seq pipelines', async () => {
    const addOne = atom<number, number>('add-one', (value) => value + 1);
    const double = atom<number, number>('double', (value) => value * 2);

    const pipeline = seq(addOne, double);
    const outcome = await pipeline.execute(3);

    expect(isConstructionOutcome<number, ConstructionError>(outcome)).toBe(true);
    if (!isConstructionOutcome<number, ConstructionError>(outcome)) {
      return;
    }
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toBe(8);
    }
  });

  it('returns explicit ok(...) outcomes for successful withRetry attempts', async () => {
    let attempts = 0;
    const flaky = atom<string, string, ConstructionError>('flaky', (value) => {
      attempts += 1;
      if (attempts < 2) {
        return fail<string, ConstructionError>(
          new ConstructionTimeoutError('flaky', 25),
          undefined,
          'flaky',
        );
      }
      return `${value}:ok`;
    });

    const retried = withRetry(flaky, { maxAttempts: 3, baseDelayMs: 1 });
    const outcome = await retried.execute('payload');

    expect(isConstructionOutcome<string, ConstructionError>(outcome)).toBe(true);
    if (!isConstructionOutcome<string, ConstructionError>(outcome)) {
      return;
    }
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toBe('payload:ok');
    }
  });
});
