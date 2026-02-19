import { sequenceConfidence } from '../epistemics/confidence.js';
import type { ConstructionError } from './base/construction_base.js';
import type { Construction } from './types.js';

/**
 * Identity construction.
 */
export function identity<T, R = unknown>(
  id = 'identity',
  name = 'Identity'
): Construction<T, T, ConstructionError, R> {
  return {
    id,
    name,
    async execute(input: T): Promise<T> {
      return input;
    },
  };
}

/**
 * Sequential composition (Kleisli sequence).
 */
export function seq<I, M, O, E extends ConstructionError, R>(
  first: Construction<I, M, E, R>,
  second: Construction<M, O, E, R>,
  id = `seq:${first.id}>${second.id}`,
  name = `Seq(${first.name}, ${second.name})`
): Construction<I, O, E, R> {
  const firstEstimate = first.getEstimatedConfidence;
  const secondEstimate = second.getEstimatedConfidence;
  const estimatedConfidence = firstEstimate && secondEstimate
    ? () => sequenceConfidence([
      firstEstimate(),
      secondEstimate(),
    ])
    : undefined;

  return {
    id,
    name,
    async execute(input: I, context): Promise<O> {
      const intermediate = await first.execute(input, context);
      return second.execute(intermediate, context);
    },
    ...(estimatedConfidence ? { getEstimatedConfidence: estimatedConfidence } : {}),
  };
}

/**
 * Fan-out composition: execute both constructions on the same input.
 */
export function fanout<I, O1, O2, E extends ConstructionError, R>(
  left: Construction<I, O1, E, R>,
  right: Construction<I, O2, E, R>,
  id = `fanout:${left.id}|${right.id}`,
  name = `Fanout(${left.name}, ${right.name})`
): Construction<I, [O1, O2], E, R> {
  return {
    id,
    name,
    async execute(input: I, context): Promise<[O1, O2]> {
      const [leftOutput, rightOutput] = await Promise.all([
        left.execute(input, context),
        right.execute(input, context),
      ]);
      return [leftOutput, rightOutput];
    },
  };
}

/**
 * Ranked fallback: use backup if primary throws.
 */
export function fallback<I, O, E extends ConstructionError, R>(
  primary: Construction<I, O, E, R>,
  backup: Construction<I, O, E, R>,
  id = `fallback:${primary.id}>${backup.id}`,
  name = `Fallback(${primary.name}, ${backup.name})`
): Construction<I, O, E, R> {
  return {
    id,
    name,
    async execute(input: I, context): Promise<O> {
      try {
        return await primary.execute(input, context);
      } catch {
        return backup.execute(input, context);
      }
    },
    getEstimatedConfidence: primary.getEstimatedConfidence ?? backup.getEstimatedConfidence,
  };
}

/**
 * Profunctor dimap: adapt both input and output.
 */
export function dimap<I2, I, O, O2, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  pre: (input: I2) => I,
  post: (output: O) => O2,
  id = `dimap:${construction.id}`,
  name = `Dimap(${construction.name})`
): Construction<I2, O2, E, R> {
  return {
    id,
    name,
    async execute(input: I2, context): Promise<O2> {
      const adaptedInput = pre(input);
      const output = await construction.execute(adaptedInput, context);
      return post(output);
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  };
}

/**
 * Contramap: adapt input only.
 */
export function contramap<I2, I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  pre: (input: I2) => I,
  id = `contramap:${construction.id}`,
  name = `Contramap(${construction.name})`
): Construction<I2, O, E, R> {
  return dimap(construction, pre, (output: O) => output, id, name);
}

/**
 * Map: adapt output only.
 */
export function mapConstruction<I, O, O2, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  post: (output: O) => O2,
  id = `map:${construction.id}`,
  name = `Map(${construction.name})`
): Construction<I, O2, E, R> {
  return dimap(construction, (input: I) => input, post, id, name);
}
