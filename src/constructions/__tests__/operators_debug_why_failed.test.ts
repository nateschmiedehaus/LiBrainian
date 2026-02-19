import { describe, expect, it } from 'vitest';
import {
  ConstructionCapabilityError,
  ConstructionTimeoutError,
  type ConstructionError,
} from '../base/construction_base.js';
import { seq } from '../operators.js';
import type { Construction } from '../types.js';

function makeConstruction(
  id: string,
  name: string,
  execute: (input: number) => Promise<number>
): Construction<number, number, ConstructionError> {
  return {
    id,
    name,
    execute,
  };
}

describe('construction diagnostics operators', () => {
  it('captures execution traces for composed sequence steps', async () => {
    const first = makeConstruction('first', 'First', async (input) => input + 1);
    const second = makeConstruction('second', 'Second', async (input) => input * 3);
    const composed = seq(first, second);

    const debugged = composed.debug?.();
    expect(debugged).toBeDefined();

    const result = await debugged!.execute(2);
    expect(result).toBe(9);

    const trace = (debugged as any).getLastTrace?.();
    expect(trace).toBeTruthy();
    expect(trace.mode).toBe('execution_trace');
    expect(trace.steps.some((step: { constructionId: string }) => step.constructionId === 'first')).toBe(true);
    expect(trace.steps.some((step: { constructionId: string }) => step.constructionId === 'second')).toBe(true);
  });

  it('returns typed timeout hints via whyFailed', () => {
    const first = makeConstruction('first', 'First', async (input) => input + 1);
    const second = makeConstruction('second', 'Second', async (input) => input * 2);
    const composed = seq(first, second);

    const hint = composed.whyFailed?.(new ConstructionTimeoutError('slow-construction', 250));

    expect(hint).toBeTruthy();
    expect(hint?.kind).toBe('timeout');
    expect(hint?.constructionId).toBe('slow-construction');
    expect(hint?.retriable).toBe(true);
    expect(hint?.suggestions.length).toBeGreaterThan(0);
  });

  it('attaches failure hints to debug traces on composed failures', async () => {
    const first = makeConstruction('first', 'First', async (input) => input + 1);
    const second = makeConstruction(
      'second',
      'Second',
      async () => {
        throw new ConstructionCapabilityError('git.commit', 'second');
      }
    );
    const composed = seq(first, second);
    const debugged = composed.debug?.({
      includeSuccessfulSteps: false,
    });

    await expect(debugged!.execute(1)).rejects.toThrow('Missing required capability: git.commit');

    const trace = (debugged as any).getLastTrace?.();
    expect(trace).toBeTruthy();
    expect(trace.failed).toBeTruthy();
    expect(trace.failed.kind).toBe('capability_missing');
    expect(trace.steps.every((step: { status: string }) => step.status === 'failed')).toBe(true);
  });
});
