import { describe, expect, it } from 'vitest';
import { ConstructionError } from '../base/construction_base.js';
import { fallback, fanout, seq, withSafetyGate } from '../operators.js';
import { fail, ok, type Construction, type ConstructionEvent, type ConstructionOutcome, type Context } from '../types.js';

type StreamableNumberConstruction = Construction<number, number, ConstructionError, Record<string, unknown>>;

function makeStreamableNumberConstruction(
  id: string,
  streamFactory: (
    input: number,
    context?: Context<Record<string, unknown>>,
  ) => AsyncIterable<ConstructionEvent<number, ConstructionError>>,
): StreamableNumberConstruction {
  const execute = async (
    input: number,
    context?: Context<Record<string, unknown>>,
  ): Promise<ConstructionOutcome<number, ConstructionError>> => {
    for await (const event of streamFactory(input, context)) {
      if (event.kind === 'completed') {
        return ok<number, ConstructionError>(event.result);
      }
      if (event.kind === 'failed') {
        return fail<number, ConstructionError>(event.error, event.partial, id);
      }
    }
    return fail<number, ConstructionError>(
      new ConstructionError('Stream ended without completion event', id),
      undefined,
      id,
    );
  };

  return {
    id,
    name: id,
    execute,
    stream: streamFactory,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('streaming construction operators', () => {
  it('streams progress through a 3-step sequence pipeline and execute matches stream completion', async () => {
    const step1 = makeStreamableNumberConstruction('step1', async function* (input: number) {
      yield { kind: 'progress', step: 'step1:start', percentComplete: 10 };
      yield { kind: 'completed', result: input + 1 };
    });
    const step2 = makeStreamableNumberConstruction('step2', async function* (input: number) {
      yield { kind: 'progress', step: 'step2:start', percentComplete: 50 };
      yield { kind: 'completed', result: input * 2 };
    });
    const step3 = makeStreamableNumberConstruction('step3', async function* (input: number) {
      yield { kind: 'progress', step: 'step3:start', percentComplete: 90 };
      yield { kind: 'completed', result: input - 3 };
    });

    const pipeline = seq(seq(step1, step2), step3);
    const events: Array<ConstructionEvent<number, ConstructionError>> = [];
    for await (const event of pipeline.stream!(2)) {
      events.push(event);
    }

    const progressSteps = events
      .filter((event) => event.kind === 'progress')
      .map((event) => event.step);
    expect(progressSteps).toEqual(['step1:start', 'step2:start', 'step3:start']);

    const terminal = events.at(-1);
    expect(terminal?.kind).toBe('completed');
    if (!terminal || terminal.kind !== 'completed') {
      throw new Error('Expected completed terminal event from sequence stream');
    }
    expect(terminal.result).toBe(3);

    const executeOutcome = await pipeline.execute(2);
    expect(executeOutcome.ok).toBe(true);
    if (!executeOutcome.ok) {
      throw new Error(`Expected successful execute outcome: ${executeOutcome.error.message}`);
    }
    expect(executeOutcome.value).toBe(terminal.result);
  });

  it('terminates with failed event on blocking safety violation before completed', async () => {
    const unsafe = makeStreamableNumberConstruction('unsafe', async function* (input: number) {
      yield { kind: 'progress', step: 'unsafe:start' };
      yield {
        kind: 'safety_violation',
        rule: 'no-unsafe-write',
        severity: 'block',
        detail: 'attempted unsafe write',
      };
      yield { kind: 'completed', result: input + 1 };
    });

    const guarded = withSafetyGate(unsafe);
    const events: Array<ConstructionEvent<number, ConstructionError>> = [];
    for await (const event of guarded.stream!(1)) {
      events.push(event);
    }

    expect(events.some((event) => event.kind === 'safety_violation')).toBe(true);
    expect(events.some((event) => event.kind === 'failed')).toBe(true);
    expect(events.some((event) => event.kind === 'completed')).toBe(false);
  });

  it('switches to backup stream after primary failed event', async () => {
    const primary = makeStreamableNumberConstruction('primary', async function* () {
      yield { kind: 'progress', step: 'primary:start' };
      yield {
        kind: 'failed',
        error: new ConstructionError('primary failed', 'primary'),
      };
    });
    const backup = makeStreamableNumberConstruction('backup', async function* (input: number) {
      yield { kind: 'progress', step: 'backup:start' };
      yield { kind: 'completed', result: input + 10 };
    });

    const resilient = fallback(primary, backup);
    const events: Array<ConstructionEvent<number, ConstructionError>> = [];
    for await (const event of resilient.stream!(5)) {
      events.push(event);
    }

    const steps = events
      .filter((event) => event.kind === 'progress')
      .map((event) => event.step);
    expect(steps).toEqual(['primary:start', 'backup:start']);
    const terminal = events.at(-1);
    expect(terminal?.kind).toBe('completed');
    if (!terminal || terminal.kind !== 'completed') {
      throw new Error('Expected completed terminal event from fallback stream');
    }
    expect(terminal.result).toBe(15);
  });

  it('interleaves fanout branch stream events before producing tuple completion', async () => {
    const left = makeStreamableNumberConstruction('left', async function* (input: number) {
      yield { kind: 'progress', step: 'left:progress' };
      await sleep(6);
      yield { kind: 'completed', result: input + 1 };
    });
    const right = makeStreamableNumberConstruction('right', async function* (input: number) {
      await sleep(1);
      yield { kind: 'progress', step: 'right:progress' };
      await sleep(2);
      yield { kind: 'completed', result: input + 2 };
    });

    const parallel = fanout(left, right);
    const events: Array<ConstructionEvent<[number, number], ConstructionError>> = [];
    for await (const event of parallel.stream!(3)) {
      events.push(event);
    }

    const progressSteps = events
      .filter((event) => event.kind === 'progress')
      .map((event) => event.step);
    expect(progressSteps).toContain('left:progress');
    expect(progressSteps).toContain('right:progress');
    const terminal = events.at(-1);
    expect(terminal?.kind).toBe('completed');
    if (!terminal || terminal.kind !== 'completed') {
      throw new Error('Expected completed terminal event from fanout stream');
    }
    expect(terminal.result).toEqual([4, 5]);
  });
});
