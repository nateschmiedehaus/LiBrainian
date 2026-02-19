import { describe, expect, it } from 'vitest';
import type { Construction } from '../types.js';
import { deterministic } from '../../epistemics/confidence.js';
import {
  dimap,
  identity,
  map,
  mapAsync,
  mapConstruction,
  mapError,
  seq,
} from '../operators.js';
import { ConstructionCancelledError } from '../base/construction_base.js';

function makeNumberConstruction(
  id: string,
  name: string,
  transform: (input: number) => number
): Construction<number, number> {
  return {
    id,
    name,
    async execute(input: number): Promise<number> {
      return transform(input);
    },
    getEstimatedConfidence: () => deterministic(true, `${id}:estimate`),
  };
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

    expect(leftResult).toBe(rightResult);
    expect(leftResult).toBe(9);
  });

  it('satisfies left and right identity', async () => {
    const addOne = makeNumberConstruction('add_one', 'Add One', (n) => n + 1);
    const idNumber = identity<number>('number_identity', 'Number Identity');

    const left = seq(idNumber, addOne);
    const right = seq(addOne, idNumber);

    const baseline = await addOne.execute(8);
    const leftResult = await left.execute(8);
    const rightResult = await right.execute(8);

    expect(leftResult).toBe(baseline);
    expect(rightResult).toBe(baseline);
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

    expect(mapped).toBe(baseline);
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

    expect(leftResult).toBe(rightResult);
    expect(leftResult).toBe('n:17');
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

    await expect(mapped.execute(5)).resolves.toBe('value:7');
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

    await expect(mapped.execute(1)).rejects.toThrow('cancel-base:mapped');
  });

  it('keeps map alias behavior equivalent to mapConstruction', async () => {
    const base = makeNumberConstruction('base', 'Base', (n) => n + 1);
    const viaMap = map(base, (value) => value * 10);
    const viaAlias = mapConstruction(base, (value) => value * 10);

    await expect(viaMap.execute(2)).resolves.toBe(await viaAlias.execute(2));
  });
});
