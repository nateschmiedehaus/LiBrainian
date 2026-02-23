import { describe, expect, it, vi } from 'vitest';
import { deterministic } from '../../epistemics/confidence.js';
import type { Construction, ConstructionOutcome, Context } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import {
  branch,
  fix,
  left,
  ProtocolViolationError,
  right,
  select,
} from '../operators.js';

function expectOkValue<T>(outcome: ConstructionOutcome<T, ConstructionError>): T {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

function expectFailError<E extends ConstructionError>(
  outcome: ConstructionOutcome<unknown, E>
): E {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) {
    throw new Error('Expected failure outcome');
  }
  return outcome.error;
}

describe('construction select/branch/fix operators', () => {
  it('select skips ifLeft when condition returns right', async () => {
    const condition: Construction<number, ReturnType<typeof right<string>>> = {
      id: 'cond-right',
      name: 'Condition Right',
      async execute(input: number) {
        return right(`value:${input}`);
      },
    };
    const ifLeftSpy = vi.fn(async (input: number) => `left:${input}`);
    const ifLeft: Construction<number, string> = {
      id: 'if-left',
      name: 'If Left',
      execute: ifLeftSpy,
    };

    const selective = select(condition, ifLeft);
    const result = expectOkValue(await selective.execute(3));

    expect(result).toBe('value:3');
    expect(ifLeftSpy).not.toHaveBeenCalled();
    expect(selective.possiblePaths()).toHaveLength(2);
  });

  it('select invokes ifLeft when condition returns left', async () => {
    const condition: Construction<number, ReturnType<typeof left<number>>> = {
      id: 'cond-left',
      name: 'Condition Left',
      async execute(input: number) {
        return left(input + 2);
      },
    };
    const ifLeftSpy = vi.fn(async (input: number) => `left:${input}`);
    const ifLeft: Construction<number, string> = {
      id: 'if-left',
      name: 'If Left',
      execute: ifLeftSpy,
    };

    const selective = select(condition, ifLeft);
    const result = expectOkValue(await selective.execute(4));

    expect(result).toBe('left:6');
    expect(ifLeftSpy).toHaveBeenCalledTimes(1);
    expect(ifLeftSpy).toHaveBeenCalledWith(6, undefined);
  });

  it('branch runs matching branch by either tag', async () => {
    const predicate: Construction<number, ReturnType<typeof left<number>> | ReturnType<typeof right<number>>> = {
      id: 'predicate',
      name: 'Predicate',
      async execute(input: number) {
        return input % 2 === 0 ? left(input / 2) : right(input * 3);
      },
    };
    const ifLeft: Construction<number, string> = {
      id: 'left-branch',
      name: 'Left Branch',
      async execute(input: number) {
        return `L:${input}`;
      },
    };
    const ifRight: Construction<number, string> = {
      id: 'right-branch',
      name: 'Right Branch',
      async execute(input: number) {
        return `R:${input}`;
      },
    };

    const conditional = branch(predicate, ifLeft, ifRight);
    expect(expectOkValue(await conditional.execute(8))).toBe('L:4');
    expect(expectOkValue(await conditional.execute(5))).toBe('R:15');
  });

  it('select maxCost is an upper bound and minCost a lower bound for sampled runs', async () => {
    const conditionCost = 10;
    const leftCost = 25;
    let measuredTokens = 0;

    const condition: Construction<number, ReturnType<typeof left<number>> | ReturnType<typeof right<string>>> & {
      __cost: {
        llmCalls: { min: number; max: number };
        tokens: { min: number; max: number };
        latencyMs: { min: number; max: number };
        networkRequests: boolean;
        fileReads: { min: number; max: number };
      };
    } = {
      id: 'cost-condition',
      name: 'Cost Condition',
      async execute(input: number) {
        measuredTokens += conditionCost;
        return input % 2 === 0 ? left(input) : right(`ok:${input}`);
      },
      __cost: {
        llmCalls: { min: 0, max: 0 },
        tokens: { min: conditionCost, max: conditionCost },
        latencyMs: { min: 1, max: 1 },
        networkRequests: false,
        fileReads: { min: 0, max: 0 },
      },
    };

    const ifLeft: Construction<number, string> & {
      __cost: {
        llmCalls: { min: number; max: number };
        tokens: { min: number; max: number };
        latencyMs: { min: number; max: number };
        networkRequests: boolean;
        fileReads: { min: number; max: number };
      };
    } = {
      id: 'cost-left',
      name: 'Cost Left',
      async execute(input: number) {
        measuredTokens += leftCost;
        return `left:${input}`;
      },
      __cost: {
        llmCalls: { min: 0, max: 0 },
        tokens: { min: leftCost, max: leftCost },
        latencyMs: { min: 1, max: 1 },
        networkRequests: false,
        fileReads: { min: 0, max: 0 },
      },
    };

    const selective = select(condition, ifLeft);
    const min = selective.minCost().tokens.min;
    const max = selective.maxCost().tokens.max;

    for (let run = 0; run < 100; run += 1) {
      measuredTokens = 0;
      await selective.execute(run);
      expect(measuredTokens).toBeLessThanOrEqual(max);
      expect(measuredTokens).toBeGreaterThanOrEqual(min);
    }
  });

  it('fix converges with monotone progress and reports metadata', async () => {
    type State = { count: number };
    const increment: Construction<State, State> = {
      id: 'increment',
      name: 'Increment',
      async execute(input: State) {
        return { count: input.count + 1 };
      },
    };

    const iterative = fix(increment, {
      stop: (state) => state.count >= 3,
      metric: {
        measure: (state) => state.count,
        capacity: 3,
      },
      maxIter: 10,
    });

    const result = expectOkValue(await iterative.execute({ count: 0 }));
    expect(result.count).toBe(3);
    expect(result.iterations).toBe(3);
    expect(result.monotoneViolations).toBe(0);
    expect(result.cycleDetected).toBe(false);
    expect(result.terminationReason).toBe('converged');
  });

  it('fix throws ProtocolViolationError on strict cycle detection', async () => {
    type State = { value: number };
    const oscillate: Construction<State, State, ConstructionError> = {
      id: 'oscillate',
      name: 'Oscillate',
      async execute(input: State) {
        return { value: input.value };
      },
    };

    const iterative = fix(oscillate, {
      stop: () => false,
      metric: {
        measure: (state) => state.value,
        capacity: 10,
      },
      maxIter: 5,
      maxViolations: 0,
    });

    const error = expectFailError(await iterative.execute({ value: 1 }));
    expect(error).toBeInstanceOf(ProtocolViolationError);
  });

  it('fix records cycle metadata in lenient mode', async () => {
    type State = { value: number };
    const noProgress: Construction<State, State, ConstructionError> = {
      id: 'no-progress',
      name: 'No Progress',
      async execute(input: State) {
        return { value: input.value };
      },
    };

    const iterative = fix(noProgress, {
      stop: () => false,
      metric: {
        measure: (state) => state.value,
        capacity: 10,
      },
      maxIter: 5,
      maxViolations: 1,
    });

    const result = expectOkValue(await iterative.execute({ value: 2 }));
    expect(result.cycleDetected).toBe(true);
    expect(result.terminationReason).toBe('cycle');
  });

  it('fix records monotone violations and degrades confidence', async () => {
    type State = {
      value: number;
      confidence: ReturnType<typeof deterministic>;
    };
    const degrade: Construction<State, State, ConstructionError> = {
      id: 'degrade',
      name: 'Degrade',
      async execute(input: State) {
        return {
          value: input.value - 1,
          confidence: deterministic(true, 'baseline'),
        };
      },
    };

    const append = vi.fn(async () => ({
      id: 'ev',
      timestamp: new Date().toISOString(),
    }));

    const iterative = fix(degrade, {
      stop: () => false,
      metric: {
        measure: (state) => state.value,
        capacity: 10,
      },
      maxIter: 1,
      maxViolations: 2,
    });

    const executionContext: Context<unknown> = {
      deps: { evidenceLedger: { append } },
      signal: new AbortController().signal,
      sessionId: 'fix-metric-test',
    };

    const result = expectOkValue(await iterative.execute(
      {
        value: 3,
        confidence: deterministic(true, 'start'),
      },
      executionContext
    ));

    expect(result.monotoneViolations).toBe(1);
    expect((result.confidence as { value: number }).value).toBeLessThan(1);
    expect(append).toHaveBeenCalledTimes(1);
  });
});
