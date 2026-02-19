import { AsyncLocalStorage } from 'node:async_hooks';
import { sequenceConfidence } from '../epistemics/confidence.js';
import {
  ConstructionCapabilityError,
  ConstructionCancelledError,
  ConstructionError,
  ConstructionInputError,
  ConstructionLLMError,
  ConstructionTimeoutError,
} from './base/construction_base.js';
import type {
  Construction,
  ConstructionDebugOptions,
  ConstructionExecutionTrace,
  ConstructionExecutionTraceStep,
  ConstructionFailureHint,
  Context,
} from './types.js';

type MutableTrace = {
  mode: 'execution_trace';
  rootConstructionId: string;
  rootConstructionName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: ConstructionExecutionTraceStep[];
  failed?: ConstructionFailureHint;
};

type TraceRuntime = {
  trace: MutableTrace;
  includeSuccessfulSteps: boolean;
};

const traceStorage = new AsyncLocalStorage<TraceRuntime>();

function nowIso(epochMs = Date.now()): string {
  return new Date(epochMs).toISOString();
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function toImmutableTrace(trace: MutableTrace): ConstructionExecutionTrace {
  return {
    ...trace,
    steps: [...trace.steps],
  };
}

export function explainConstructionFailure(
  error: unknown,
  defaultConstructionId: string
): ConstructionFailureHint {
  if (error instanceof ConstructionTimeoutError) {
    return {
      kind: 'timeout',
      constructionId: error.constructionId,
      message: error.message,
      retriable: true,
      suggestions: [
        'Increase timeout for this construction path.',
        'Profile earlier composition steps to isolate slow inputs.',
        'Cache deterministic sub-results when feasible.',
      ],
      cause: error.cause?.message,
    };
  }

  if (error instanceof ConstructionCancelledError) {
    return {
      kind: 'cancelled',
      constructionId: error.constructionId,
      message: error.message,
      retriable: false,
      suggestions: [
        'Check abort signal wiring in the caller.',
        'Avoid cancelling shared contexts used by sibling constructions.',
      ],
      cause: error.cause?.message,
    };
  }

  if (error instanceof ConstructionInputError) {
    return {
      kind: 'input_error',
      constructionId: error.constructionId,
      message: error.message,
      retriable: false,
      suggestions: [
        'Validate construction input before composition execution.',
        ...(error.fieldPath ? [`Inspect invalid field: ${error.fieldPath}.`] : []),
      ],
      cause: error.cause?.message,
    };
  }

  if (error instanceof ConstructionCapabilityError) {
    return {
      kind: 'capability_missing',
      constructionId: error.constructionId,
      message: error.message,
      retriable: false,
      suggestions: [
        `Provide required capability: ${error.requiredCapability}.`,
        'Gate this path behind capability detection before execution.',
      ],
      cause: error.cause?.message,
    };
  }

  if (error instanceof ConstructionLLMError) {
    return {
      kind: 'llm_error',
      constructionId: error.constructionId,
      message: error.message,
      retriable: true,
      suggestions: [
        `Verify model/provider availability for ${error.model}.`,
        'Retry with bounded backoff and capture provider response metadata.',
      ],
      cause: error.cause?.message,
    };
  }

  if (error instanceof ConstructionError) {
    return {
      kind: 'construction_error',
      constructionId: error.constructionId,
      message: error.message,
      retriable: error.retriable,
      suggestions: [
        'Inspect nested cause and prior construction trace steps.',
        'Add mapError or fallback composition to recover predictably.',
      ],
      cause: error.cause?.message,
    };
  }

  if (error instanceof Error) {
    return {
      kind: 'unknown',
      constructionId: defaultConstructionId,
      message: error.message,
      retriable: false,
      suggestions: [
        'Wrap external failures into ConstructionError subclasses for typed hints.',
        'Enable debug() and inspect trace steps for the failing segment.',
      ],
      cause: error.cause instanceof Error ? error.cause.message : undefined,
    };
  }

  return {
    kind: 'unknown',
    constructionId: defaultConstructionId,
    message: `Non-error failure: ${String(error)}`,
    retriable: false,
    suggestions: [
      'Throw Error subclasses from construction implementations.',
      'Normalize unknown thrown values with mapError in composition boundaries.',
    ],
  };
}

async function executeWithTrace<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  input: I,
  context?: Context<R>
): Promise<O> {
  const runtime = traceStorage.getStore();
  if (!runtime) {
    return construction.execute(input, context);
  }

  const startedEpoch = Date.now();
  const startedAt = nowIso(startedEpoch);
  try {
    const output = await construction.execute(input, context);
    const finishedEpoch = Date.now();
    if (runtime.includeSuccessfulSteps) {
      runtime.trace.steps.push({
        constructionId: construction.id,
        constructionName: construction.name,
        startedAt,
        finishedAt: nowIso(finishedEpoch),
        durationMs: finishedEpoch - startedEpoch,
        status: 'succeeded',
        inputType: valueType(input),
        outputType: valueType(output),
      });
    }
    return output;
  } catch (error) {
    const finishedEpoch = Date.now();
    const hint = construction.whyFailed?.(error) ?? explainConstructionFailure(error, construction.id);
    runtime.trace.failed ??= hint;
    runtime.trace.steps.push({
      constructionId: construction.id,
      constructionName: construction.name,
      startedAt,
      finishedAt: nowIso(finishedEpoch),
      durationMs: finishedEpoch - startedEpoch,
      status: 'failed',
      inputType: valueType(input),
      errorKind: hint.kind,
      errorMessage: hint.message,
    });
    throw error;
  }
}

function createDebugConstruction<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R> & { whyFailed(error: unknown): ConstructionFailureHint },
  options?: ConstructionDebugOptions
): Construction<I, O, E, R> & { getLastTrace(): ConstructionExecutionTrace | undefined } {
  let lastTrace: ConstructionExecutionTrace | undefined;
  const includeSuccessfulSteps = options?.includeSuccessfulSteps ?? true;

  const debugged: Construction<I, O, E, R> & { getLastTrace(): ConstructionExecutionTrace | undefined } = {
    ...construction,
    async execute(input: I, context?: Context<R>): Promise<O> {
      const startedEpoch = Date.now();
      const trace: MutableTrace = {
        mode: 'execution_trace',
        rootConstructionId: construction.id,
        rootConstructionName: construction.name,
        startedAt: nowIso(startedEpoch),
        finishedAt: nowIso(startedEpoch),
        durationMs: 0,
        steps: [],
      };

      try {
        const output = await traceStorage.run(
          { trace, includeSuccessfulSteps },
          async () => executeWithTrace(construction, input, context)
        );
        const finishedEpoch = Date.now();
        trace.finishedAt = nowIso(finishedEpoch);
        trace.durationMs = finishedEpoch - startedEpoch;
        lastTrace = toImmutableTrace(trace);
        return output;
      } catch (error) {
        const finishedEpoch = Date.now();
        trace.finishedAt = nowIso(finishedEpoch);
        trace.durationMs = finishedEpoch - startedEpoch;
        trace.failed ??= construction.whyFailed(error);
        lastTrace = toImmutableTrace(trace);
        throw error;
      }
    },
    getLastTrace(): ConstructionExecutionTrace | undefined {
      return lastTrace;
    },
  };

  debugged.whyFailed = construction.whyFailed;
  debugged.debug = (nextOptions?: ConstructionDebugOptions) => createDebugConstruction(construction, nextOptions);
  return debugged;
}

function withDiagnostics<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>
): Construction<I, O, E, R> {
  const whyFailed =
    construction.whyFailed ??
    ((error: unknown) => explainConstructionFailure(error, construction.id));

  return {
    ...construction,
    whyFailed,
    debug(options?: ConstructionDebugOptions) {
      return createDebugConstruction({ ...construction, whyFailed }, options);
    },
  };
}

/**
 * Identity construction.
 */
export function identity<T, R = unknown>(
  id = 'identity',
  name = 'Identity'
): Construction<T, T, ConstructionError, R> {
  return withDiagnostics({
    id,
    name,
    async execute(input: T): Promise<T> {
      return input;
    },
  });
}

/**
 * Sequential composition (Kleisli sequence).
 */
export function seq<I, M, O, E1 extends ConstructionError, E2 extends ConstructionError, R>(
  first: Construction<I, M, E1, R>,
  second: Construction<M, O, E2, R>,
  id = `seq:${first.id}>${second.id}`,
  name = `Seq(${first.name}, ${second.name})`
): Construction<I, O, E1 | E2, R> {
  const firstEstimate = first.getEstimatedConfidence;
  const secondEstimate = second.getEstimatedConfidence;
  const estimatedConfidence = firstEstimate && secondEstimate
    ? () => sequenceConfidence([
      firstEstimate(),
      secondEstimate(),
    ])
    : undefined;

  return withDiagnostics({
    id,
    name,
    async execute(input: I, context): Promise<O> {
      const intermediate = await executeWithTrace(first, input, context);
      return executeWithTrace(second, intermediate, context);
    },
    ...(estimatedConfidence ? { getEstimatedConfidence: estimatedConfidence } : {}),
  });
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
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context): Promise<[O1, O2]> {
      const [leftOutput, rightOutput] = await Promise.all([
        executeWithTrace(left, input, context),
        executeWithTrace(right, input, context),
      ]);
      return [leftOutput, rightOutput];
    },
  });
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
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context): Promise<O> {
      try {
        return await executeWithTrace(primary, input, context);
      } catch {
        return executeWithTrace(backup, input, context);
      }
    },
    getEstimatedConfidence: primary.getEstimatedConfidence ?? backup.getEstimatedConfidence,
  });
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
  return withDiagnostics({
    id,
    name,
    async execute(input: I2, context): Promise<O2> {
      const adaptedInput = pre(input);
      const output = await executeWithTrace(construction, adaptedInput, context);
      return post(output);
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  });
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
export function map<I, O, O2, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  post: (output: O) => O2,
  id = `map:${construction.id}`,
  name = `Map(${construction.name})`
): Construction<I, O2, E, R> {
  return dimap(construction, (input: I) => input, post, id, name);
}

/**
 * Async map: adapt output with an asynchronous projection.
 */
export function mapAsync<I, O, O2, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  post: (output: O, context?: Context<R>) => Promise<O2>,
  id = `mapAsync:${construction.id}`,
  name = `MapAsync(${construction.name})`
): Construction<I, O2, E, R> {
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<O2> {
      const output = await executeWithTrace(construction, input, context);
      return post(output, context);
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  });
}

/**
 * Map error: transform construction errors while preserving success path.
 */
export function mapError<I, O, E extends ConstructionError, E2 extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  transform: (error: E) => E2,
  id = `mapError:${construction.id}`,
  name = `MapError(${construction.name})`
): Construction<I, O, E2, R> {
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<O> {
      try {
        return await executeWithTrace(construction, input, context);
      } catch (error) {
        if (error instanceof Error) {
          throw transform(error as E);
        }
        throw error;
      }
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  });
}

/**
 * Provide part of a construction's dependency requirements up front.
 */
export function provide<I, O, E extends ConstructionError, R extends Record<string, unknown>, RP extends Partial<R>>(
  construction: Construction<I, O, E, R>,
  providedDeps: RP,
  id = `provide:${construction.id}`,
  name = `Provide(${construction.name})`
): Construction<I, O, E, Omit<R, keyof RP>> {
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context?: Context<Omit<R, keyof RP>>): Promise<O> {
      if (!context) {
        throw new ConstructionError(`Execution context is required for ${construction.id}`, construction.id);
      }

      const mergedContext: Context<R> = {
        ...context,
        deps: {
          ...(context.deps as object),
          ...(providedDeps as object),
        } as R,
      };

      return executeWithTrace(construction, input, mergedContext);
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  });
}

/**
 * Backward-compatible map alias for existing call sites.
 */
export const mapConstruction = map;
