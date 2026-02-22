import { describe, expect, it } from 'vitest';
import type { Construction, Context } from '../types.js';
import { deterministic } from '../../epistemics/confidence.js';
import {
  atom,
  dimap,
  identity,
  map,
  mapAsync,
  mapConstruction,
  mapError,
  provide,
  seq,
  withRetry,
} from '../operators.js';
import { fail, isConstructionOutcome, ok, type ConstructionOutcome } from '../types.js';
import {
  ConstructionError,
  ConstructionCancelledError,
  ConstructionInputError,
  ConstructionTimeoutError,
} from '../base/construction_base.js';

function makeNumberConstruction(
  id: string,
  name: string,
  transform: (input: number) => number
): Construction<number, number> {
  return {
    id,
    name,
    async execute(input: number): Promise<ConstructionOutcome<number, ConstructionError>> {
      return ok<number, ConstructionError>(transform(input));
    },
    getEstimatedConfidence: () => deterministic(true, `${id}:estimate`),
  };
}

function expectOkValue<T>(outcome: ConstructionOutcome<T, ConstructionError>): T {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) {
    throw new Error(`Expected success outcome, received failure: ${outcome.error.message}`);
  }
  return outcome.value;
}

describe('construction operators', () => {
  it('satisfies sequence associativity', async () => {
    const addOne = makeNumberConstruction('add_one', 'Add One', (n) => n + 1);
    const timesTwo = makeNumberConstruction('times_two', 'Times Two', (n) => n * 2);
    const minusThree = makeNumberConstruction('minus_three', 'Minus Three', (n) => n - 3);

    const left = seq(seq(addOne, timesTwo), minusThree);
    const right = seq(addOne, seq(timesTwo, minusThree));

    const leftResult = await left.execute(5);
    const rightResult = await right.execute(5);
    const leftValue = expectOkValue(leftResult);
    const rightValue = expectOkValue(rightResult);

    expect(leftValue).toBe(rightValue);
    expect(leftValue).toBe(9);
  });

  it('creates a single-step construction via atom', async () => {
    const triple = atom<number, number>('triple', async (input) => input * 3);
    const outcome = await triple.execute(4);
    expect(expectOkValue(outcome)).toBe(12);
    expect(triple.name).toContain('Atom');
  });

  it('satisfies left and right identity', async () => {
    const addOne = makeNumberConstruction('add_one', 'Add One', (n) => n + 1);
    const idNumber = identity<number>('number_identity', 'Number Identity');

    const left = seq(idNumber, addOne);
    const right = seq(addOne, idNumber);

    const baseline = await addOne.execute(8);
    const leftResult = await left.execute(8);
    const rightResult = await right.execute(8);
    const baselineValue = expectOkValue(baseline);
    const leftValue = expectOkValue(leftResult);
    const rightValue = expectOkValue(rightResult);

    expect(leftValue).toBe(baselineValue);
    expect(rightValue).toBe(baselineValue);
  });

  it('satisfies dimap identity law', async () => {
    const base = makeNumberConstruction('base', 'Base', (n) => n * 3);
    const identityMapped = dimap(
      base,
      (input: number) => input,
      (output: number) => output
    );

    const baseline = await base.execute(4);
    const mapped = await identityMapped.execute(4);
    const baselineValue = expectOkValue(baseline);
    const mappedValue = expectOkValue(mapped);

    expect(mappedValue).toBe(baselineValue);
  });

  it('satisfies dimap composition law', async () => {
    const base = makeNumberConstruction('base', 'Base', (n) => n * 2);
    const f = (text: string): number => Number.parseInt(text, 10);
    const g = (n: number): number => n + 3;
    const h = (value: { raw: string }): string => value.raw;
    const k = (n: number): string => `n:${n}`;

    const left = dimap(
      dimap(base, f, g),
      h,
      k
    );
    const right = dimap(
      base,
      (input: { raw: string }) => f(h(input)),
      (output: number) => k(g(output))
    );

    const leftResult = await left.execute({ raw: '7' });
    const rightResult = await right.execute({ raw: '7' });
    const leftValue = expectOkValue(leftResult);
    const rightValue = expectOkValue(rightResult);

    expect(leftValue).toBe(rightValue);
    expect(leftValue).toBe('n:17');
  });

  it('rejects mismatched seq seams but accepts mapped adaptation', () => {
    const advisor: Construction<string, { primaryLocation: string }> = {
      id: 'feature_advisor',
      name: 'Feature Advisor',
      async execute(input: string) {
        return { primaryLocation: input };
      },
    };

    const checker: Construction<{ entityId: string; refactoringType: 'rename' }, boolean> = {
      id: 'refactor_checker',
      name: 'Refactor Checker',
      async execute(input) {
        return Boolean(input.entityId);
      },
    };

    if (false) {
      // @ts-expect-error intermediate type does not match checker input
      seq(advisor, checker);
    }

    const adapted = mapConstruction(advisor, (report) => ({
      entityId: report.primaryLocation,
      refactoringType: 'rename' as const,
    }));
    const composed = seq(adapted, checker);

    void composed;
    expect(true).toBe(true);
  });

  it('supports async output adaptation with mapAsync', async () => {
    const base = makeNumberConstruction('base', 'Base', (n) => n + 2);
    const mapped = mapAsync(base, async (output) => `value:${output}`);
    const outcome = await mapped.execute(5);
    expect(expectOkValue(outcome)).toBe('value:7');
  });

  it('supports typed error transformation with mapError', async () => {
    const cancellable: Construction<number, number, ConstructionCancelledError> = {
      id: 'cancel-base',
      name: 'Cancel Base',
      async execute() {
        throw new ConstructionCancelledError('cancel-base');
      },
    };

    const mapped = mapError(
      cancellable,
      (error) => new ConstructionCancelledError(`${error.constructionId}:mapped`)
    );

    const result = await mapped.execute(1);
    expect(isConstructionOutcome<number, ConstructionCancelledError>(result)).toBe(true);
    if (isConstructionOutcome<number, ConstructionCancelledError>(result)) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('cancel-base:mapped');
      }
    }
  });

  it('keeps map alias behavior equivalent to mapConstruction', async () => {
    const base = makeNumberConstruction('base', 'Base', (n) => n + 1);
    const viaMap = map(base, (value) => value * 10);
    const viaAlias = mapConstruction(base, (value) => value * 10);
    const mapped = await viaMap.execute(2);
    const aliased = await viaAlias.execute(2);
    expect(expectOkValue(mapped)).toBe(expectOkValue(aliased));
  });

  it('unions typed error channels across seq composition', () => {
    const first: Construction<number, number, ConstructionCancelledError> = {
      id: 'cancel-first',
      name: 'Cancel First',
      async execute(input: number) {
        return input + 1;
      },
    };

    const second: Construction<number, number, ConstructionTimeoutError> = {
      id: 'timeout-second',
      name: 'Timeout Second',
      async execute(input: number) {
        return input * 2;
      },
    };

    const composed = seq(first, second);

    if (false) {
      const unionTyped: Construction<
        number,
        number,
        ConstructionCancelledError | ConstructionTimeoutError
      > = composed;

      // @ts-expect-error composed includes timeout errors and cannot narrow to cancelled-only
      const narrowed: Construction<number, number, ConstructionCancelledError> = composed;

      void unionTyped;
      void narrowed;
    }

    expect(composed.id).toContain('seq:');
  });

  it('provide reduces dependency requirements at the execution boundary', async () => {
    type NeedsLlm = {
      librarian: { name: string };
      llm: { model: string };
    };

    const requiresLlm: Construction<number, string, ConstructionError, NeedsLlm> = {
      id: 'needs-llm',
      name: 'Needs LLM',
      async execute(_input: number, context?: Context<NeedsLlm>) {
        if (!context) {
          throw new ConstructionError('missing context', 'needs-llm');
        }
        return `${context.deps.librarian.name}:${context.deps.llm.model}`;
      },
    };

    const provided = provide(requiresLlm, {
      llm: { model: 'claude-haiku-3-5' },
    });

    if (false) {
      const baseContext: Context<{ librarian: { name: string } }> = {
        deps: { librarian: { name: 'base' } },
        signal: new AbortController().signal,
        sessionId: 'base-session',
      };

      // @ts-expect-error missing llm dependency for original construction
      requiresLlm.execute(1, baseContext);
      provided.execute(1, baseContext);
    }

    const result = await provided.execute(1, {
      deps: { librarian: { name: 'librarian-core' } },
      signal: new AbortController().signal,
      sessionId: 'provide-session',
    });

    expect(expectOkValue(result)).toBe('librarian-core:claude-haiku-3-5');
  });

  it('short-circuits seq when step 2 fails and preserves partial output from step 1', async () => {
    const step3Spy = vi.fn(async (input: number) => input * 10);
    const step1: Construction<number, number> = {
      id: 'step-1',
      name: 'Step 1',
      async execute(input: number) {
        return input + 1;
      },
    };
    const step2: Construction<number, number, ConstructionError> = {
      id: 'step-2',
      name: 'Step 2',
      async execute(input: number) {
        return fail(
          new ConstructionInputError('step-2 rejected value', 'value', 'step-2'),
          undefined,
          'step-2',
        );
      },
    };
    const step3: Construction<number, number> = {
      id: 'step-3',
      name: 'Step 3',
      async execute(input: number) {
        return step3Spy(input);
      },
    };

    const piped = seq(seq(step1, step2), step3);
    const outcome = await piped.execute(5);

    expect(step3Spy).not.toHaveBeenCalled();
    expect(isConstructionOutcome<number, ConstructionError>(outcome)).toBe(true);
    if (isConstructionOutcome<number, ConstructionError>(outcome)) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.errorAt).toBe('step-2');
        expect(outcome.partial).toBe(6);
      }
    }
  });

  it('retries only when error.retriable is true', async () => {
    let attempts = 0;
    const flaky: Construction<string, string, ConstructionError> = {
      id: 'flaky',
      name: 'Flaky',
      async execute(input: string) {
        attempts += 1;
        if (attempts < 3) {
          return fail(
            new ConstructionTimeoutError('flaky', 50) as ConstructionError,
            { lastInput: input } as unknown as Partial<string>,
            'flaky',
          );
        }
        return `${input}:ok`;
      },
    };

    const retried = withRetry(flaky, { maxAttempts: 4, baseDelayMs: 1 });
    const success = await retried.execute('payload');
    expect(expectOkValue(success)).toBe('payload:ok');
    expect(attempts).toBe(3);

    attempts = 0;
    const permanent: Construction<string, string, ConstructionError> = {
      id: 'permanent',
      name: 'Permanent',
      async execute(input: string) {
        attempts += 1;
        return fail(
          new ConstructionInputError('bad input', 'input', 'permanent'),
          { badInput: input } as unknown as Partial<string>,
          'permanent',
        );
      },
    };

    const noRetry = withRetry(permanent, { maxAttempts: 5, baseDelayMs: 1 });
    const failed = await noRetry.execute('bad');
    expect(attempts).toBe(1);
    expect(isConstructionOutcome<string, ConstructionError>(failed)).toBe(true);
    if (isConstructionOutcome<string, ConstructionError>(failed)) {
      expect(failed.ok).toBe(false);
      if (!failed.ok) {
        expect(failed.error.retriable).toBe(false);
      }
    }
  });
});
