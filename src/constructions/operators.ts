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
  ConstructionPath,
  Construction,
  ConstructionOutcome,
  CostSemiring,
  ConstructionDebugOptions,
  ConstructionExecutionTrace,
  ConstructionExecutionTraceStep,
  ConstructionFailureHint,
  Either,
  FixpointMetadata,
  FixpointTerminationReason,
  ProgressMetric,
  SelectiveConstruction,
  Context,
} from './types.js';
import { isConstructionOutcome, fail, ok } from './types.js';

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

function toConstructionError(error: unknown, constructionId: string): ConstructionError {
  if (error instanceof ConstructionError) {
    return error;
  }
  if (error instanceof Error) {
    return new ConstructionError(error.message, constructionId, error);
  }
  return new ConstructionError(`Non-error failure: ${String(error)}`, constructionId);
}

async function executeOutcomeWithTrace<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  input: I,
  context?: Context<R>
): Promise<ConstructionOutcome<O, E>> {
  const runtime = traceStorage.getStore();
  const startedEpoch = Date.now();
  const startedAt = nowIso(startedEpoch);

  try {
    const execution = await construction.execute(input, context);
    const outcome = isConstructionOutcome<O, E>(execution)
      ? execution
      : ok<O, E>(execution as O);
    const finishedEpoch = Date.now();
    if (runtime && outcome.ok && runtime.includeSuccessfulSteps) {
      runtime.trace.steps.push({
        constructionId: construction.id,
        constructionName: construction.name,
        startedAt,
        finishedAt: nowIso(finishedEpoch),
        durationMs: finishedEpoch - startedEpoch,
        status: 'succeeded',
        inputType: valueType(input),
        outputType: valueType(outcome.value),
      });
    }
    if (runtime && !outcome.ok) {
      const hint = construction.whyFailed?.(outcome.error) ??
        explainConstructionFailure(outcome.error, construction.id);
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
    }
    return outcome;
  } catch (error) {
    const finishedEpoch = Date.now();
    const normalized = toConstructionError(error, construction.id) as E;
    if (runtime) {
      const hint = construction.whyFailed?.(normalized) ??
        explainConstructionFailure(normalized, construction.id);
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
    }
    return fail<O, E>(normalized, undefined, construction.id);
  }
}

async function executeWithTrace<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  input: I,
  context?: Context<R>
): Promise<ConstructionOutcome<O, E>> {
  return executeOutcomeWithTrace(construction, input, context);
}

function createDebugConstruction<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R> & { whyFailed(error: unknown): ConstructionFailureHint },
  options?: ConstructionDebugOptions
): Construction<I, O, E, R> & { getLastTrace(): ConstructionExecutionTrace | undefined } {
  let lastTrace: ConstructionExecutionTrace | undefined;
  const includeSuccessfulSteps = options?.includeSuccessfulSteps ?? true;

  const debugged: Construction<I, O, E, R> & { getLastTrace(): ConstructionExecutionTrace | undefined } = {
    ...construction,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O, E>> {
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

      const output = await traceStorage.run(
        { trace, includeSuccessfulSteps },
        async () => executeWithTrace(construction, input, context)
      );
      const finishedEpoch = Date.now();
      trace.finishedAt = nowIso(finishedEpoch);
      trace.durationMs = finishedEpoch - startedEpoch;
      lastTrace = toImmutableTrace(trace);
      return output;
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

const ZERO_COST: CostSemiring = {
  llmCalls: { min: 0, max: 0 },
  tokens: { min: 0, max: 0 },
  latencyMs: { min: 0, max: 0 },
  networkRequests: false,
  fileReads: { min: 0, max: 0 },
};

function addCost(a: CostSemiring, b: CostSemiring): CostSemiring {
  return {
    llmCalls: { min: a.llmCalls.min + b.llmCalls.min, max: a.llmCalls.max + b.llmCalls.max },
    tokens: { min: a.tokens.min + b.tokens.min, max: a.tokens.max + b.tokens.max },
    latencyMs: { min: a.latencyMs.min + b.latencyMs.min, max: a.latencyMs.max + b.latencyMs.max },
    networkRequests: a.networkRequests || b.networkRequests,
    fileReads: { min: a.fileReads.min + b.fileReads.min, max: a.fileReads.max + b.fileReads.max },
  };
}

function minCost(a: CostSemiring, b: CostSemiring): CostSemiring {
  return {
    llmCalls: { min: Math.min(a.llmCalls.min, b.llmCalls.min), max: Math.min(a.llmCalls.max, b.llmCalls.max) },
    tokens: { min: Math.min(a.tokens.min, b.tokens.min), max: Math.min(a.tokens.max, b.tokens.max) },
    latencyMs: { min: Math.min(a.latencyMs.min, b.latencyMs.min), max: Math.min(a.latencyMs.max, b.latencyMs.max) },
    networkRequests: a.networkRequests && b.networkRequests,
    fileReads: { min: Math.min(a.fileReads.min, b.fileReads.min), max: Math.min(a.fileReads.max, b.fileReads.max) },
  };
}

function maxCost(a: CostSemiring, b: CostSemiring): CostSemiring {
  return {
    llmCalls: { min: Math.max(a.llmCalls.min, b.llmCalls.min), max: Math.max(a.llmCalls.max, b.llmCalls.max) },
    tokens: { min: Math.max(a.tokens.min, b.tokens.min), max: Math.max(a.tokens.max, b.tokens.max) },
    latencyMs: { min: Math.max(a.latencyMs.min, b.latencyMs.min), max: Math.max(a.latencyMs.max, b.latencyMs.max) },
    networkRequests: a.networkRequests || b.networkRequests,
    fileReads: { min: Math.max(a.fileReads.min, b.fileReads.min), max: Math.max(a.fileReads.max, b.fileReads.max) },
  };
}

function estimateConstructionMinCost<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>
): CostSemiring {
  const costTagged = construction as Construction<I, O, E, R> & { __cost?: CostSemiring };
  if (costTagged.__cost) {
    return costTagged.__cost;
  }
  const maybeSelective = construction as Partial<SelectiveConstruction<I, O, E, R>>;
  if (typeof maybeSelective.minCost === 'function') {
    return maybeSelective.minCost();
  }
  return ZERO_COST;
}

function estimateConstructionMaxCost<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>
): CostSemiring {
  const costTagged = construction as Construction<I, O, E, R> & { __cost?: CostSemiring };
  if (costTagged.__cost) {
    return costTagged.__cost;
  }
  const maybeSelective = construction as Partial<SelectiveConstruction<I, O, E, R>>;
  if (typeof maybeSelective.maxCost === 'function') {
    return maybeSelective.maxCost();
  }
  return ZERO_COST;
}

function dependencyUpper<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>
): Set<string> {
  const maybeSelective = construction as Partial<SelectiveConstruction<I, O, E, R>>;
  if (typeof maybeSelective.dependencySetUpper === 'function') {
    return maybeSelective.dependencySetUpper();
  }
  return new Set([construction.id]);
}

function dependencyLower<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>
): Set<string> {
  const maybeSelective = construction as Partial<SelectiveConstruction<I, O, E, R>>;
  if (typeof maybeSelective.dependencySetLower === 'function') {
    return maybeSelective.dependencySetLower();
  }
  return new Set([construction.id]);
}

export function left<A>(value: A): Either<A, never> {
  return { tag: 'left', value };
}

export function right<B>(value: B): Either<never, B> {
  return { tag: 'right', value };
}

export function isLeft<A, B>(value: Either<A, B>): value is { tag: 'left'; value: A } {
  return value.tag === 'left';
}

export class ProtocolViolationError extends ConstructionError {
  readonly kind = 'cycle_detected';

  constructor(
    constructionId: string,
    public readonly cycleAtIteration: number,
    public readonly stateHash: string
  ) {
    super(
      `Cycle detected in ${constructionId} at iteration ${cycleAtIteration}`,
      constructionId
    );
    this.name = 'ProtocolViolationError';
  }
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
    async execute(input: T): Promise<ConstructionOutcome<T, ConstructionError>> {
      return ok<T, ConstructionError>(input);
    },
  });
}

/**
 * Atom construction: wrap a single focused execution step.
 */
export function atom<I, O, E extends ConstructionError = ConstructionError, R = unknown>(
  id: string,
  executor: (
    input: I,
    context?: Context<R>
  ) => Promise<O | ConstructionOutcome<O, E>> | O | ConstructionOutcome<O, E>,
  name = `Atom(${id})`
): Construction<I, O, E, R> {
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O, E>> {
      const execution = await executor(input, context);
      return isConstructionOutcome<O, E>(execution)
        ? execution
        : ok<O, E>(execution as O);
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
    async execute(
      input: I,
      context
    ): Promise<ConstructionOutcome<O, E1 | E2>> {
      const firstOutcome = await executeOutcomeWithTrace(first, input, context);
      if (!firstOutcome.ok) {
        return fail<O, E1 | E2>(
          firstOutcome.error,
          firstOutcome.partial as Partial<O> | undefined,
          firstOutcome.errorAt ?? first.id,
        );
      }

      const secondOutcome = await executeOutcomeWithTrace(second, firstOutcome.value, context);
      if (!secondOutcome.ok) {
        return fail<O, E1 | E2>(
          secondOutcome.error,
          secondOutcome.partial ?? (firstOutcome.value as unknown as Partial<O>),
          secondOutcome.errorAt ?? second.id,
        );
      }

      return ok<O, E1 | E2>(secondOutcome.value);
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
    async execute(input: I, context): Promise<ConstructionOutcome<[O1, O2], E>> {
      const [leftOutput, rightOutput] = await Promise.all([
        executeWithTrace(left, input, context),
        executeWithTrace(right, input, context),
      ]);
      if (!leftOutput.ok) {
        return fail<[O1, O2], E>(
          leftOutput.error,
          leftOutput.partial as Partial<[O1, O2]> | undefined,
          leftOutput.errorAt ?? left.id,
        );
      }
      if (!rightOutput.ok) {
        return fail<[O1, O2], E>(
          rightOutput.error,
          rightOutput.partial as Partial<[O1, O2]> | undefined,
          rightOutput.errorAt ?? right.id,
        );
      }
      return ok<[O1, O2], E>([leftOutput.value, rightOutput.value]);
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
    async execute(input: I, context): Promise<ConstructionOutcome<O, E>> {
      const primaryOutcome = await executeOutcomeWithTrace(primary, input, context);
      if (primaryOutcome.ok) {
        return ok<O, E>(primaryOutcome.value);
      }

      const backupOutcome = await executeOutcomeWithTrace(backup, input, context);
      if (backupOutcome.ok) {
        return ok<O, E>(backupOutcome.value);
      }

      return fail<O, E>(
        backupOutcome.error,
        backupOutcome.partial ?? primaryOutcome.partial,
        backupOutcome.errorAt ?? backup.id,
      );
    },
    getEstimatedConfidence: primary.getEstimatedConfidence ?? backup.getEstimatedConfidence,
  });
}

/**
 * Selective conditional: execute `ifLeft` only when condition returns `left`.
 */
export function select<I, A, B, E extends ConstructionError, R>(
  condition: Construction<I, Either<A, B>, E, R>,
  ifLeft: Construction<A, B, E, R>,
  id = `select:${condition.id}?${ifLeft.id}`,
  name = `Select(${condition.name}, ${ifLeft.name})`
): SelectiveConstruction<I, B, E, R> {
  const base = withDiagnostics<I, B, E, R>({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<B, E>> {
      const decision = await executeWithTrace(condition, input, context);
      if (!decision.ok) {
        return fail<B, E>(
          decision.error,
          decision.partial as Partial<B> | undefined,
          decision.errorAt ?? condition.id,
        );
      }
      if (decision.value.tag === 'right') {
        return ok<B, E>(decision.value.value);
      }
      return executeWithTrace(ifLeft, decision.value.value, context);
    },
    getEstimatedConfidence: ifLeft.getEstimatedConfidence ?? condition.getEstimatedConfidence,
  }) as SelectiveConstruction<I, B, E, R>;

  const paths: ConstructionPath[] = [
    {
      label: 'right_bypass',
      constructionIds: [condition.id],
    },
    {
      label: 'left_apply',
      constructionIds: [condition.id, ifLeft.id],
    },
  ];

  base.possiblePaths = () => paths;
  base.dependencySetUpper = () => {
    const upper = dependencyUpper(condition);
    for (const dep of dependencyUpper(ifLeft)) upper.add(dep);
    return upper;
  };
  base.dependencySetLower = () => dependencyLower(condition);
  base.maxCost = () => addCost(
    estimateConstructionMaxCost(condition),
    estimateConstructionMaxCost(ifLeft)
  );
  base.minCost = () => addCost(
    estimateConstructionMinCost(condition),
    ZERO_COST
  );
  return base;
}

/**
 * Full two-branch selective conditional.
 */
export function branch<I, A, B, C, E extends ConstructionError, R>(
  predicate: Construction<I, Either<A, B>, E, R>,
  ifLeft: Construction<A, C, E, R>,
  ifRight: Construction<B, C, E, R>,
  id = `branch:${predicate.id}?${ifLeft.id}:${ifRight.id}`,
  name = `Branch(${predicate.name})`
): SelectiveConstruction<I, C, E, R> {
  const base = withDiagnostics<I, C, E, R>({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<C, E>> {
      const decision = await executeWithTrace(predicate, input, context);
      if (!decision.ok) {
        return fail<C, E>(
          decision.error,
          decision.partial as Partial<C> | undefined,
          decision.errorAt ?? predicate.id,
        );
      }
      if (decision.value.tag === 'left') {
        return executeWithTrace(ifLeft, decision.value.value, context);
      }
      return executeWithTrace(ifRight, decision.value.value, context);
    },
    getEstimatedConfidence:
      ifLeft.getEstimatedConfidence ??
      ifRight.getEstimatedConfidence ??
      predicate.getEstimatedConfidence,
  }) as SelectiveConstruction<I, C, E, R>;

  const paths: ConstructionPath[] = [
    {
      label: 'left_branch',
      constructionIds: [predicate.id, ifLeft.id],
    },
    {
      label: 'right_branch',
      constructionIds: [predicate.id, ifRight.id],
    },
  ];

  base.possiblePaths = () => paths;
  base.dependencySetUpper = () => {
    const upper = dependencyUpper(predicate);
    for (const dep of dependencyUpper(ifLeft)) upper.add(dep);
    for (const dep of dependencyUpper(ifRight)) upper.add(dep);
    return upper;
  };
  base.dependencySetLower = () => dependencyLower(predicate);
  base.maxCost = () => addCost(
    estimateConstructionMaxCost(predicate),
    maxCost(estimateConstructionMaxCost(ifLeft), estimateConstructionMaxCost(ifRight))
  );
  base.minCost = () => addCost(
    estimateConstructionMinCost(predicate),
    minCost(estimateConstructionMinCost(ifLeft), estimateConstructionMinCost(ifRight))
  );
  return base;
}

/**
 * Fixpoint iteration with monotone progress tracking and cycle detection.
 */
export function fix<I extends Record<string, unknown>, E extends ConstructionError, R>(
  body: Construction<I, I, E, R>,
  options: {
    stop: (state: I) => boolean;
    metric: ProgressMetric<I>;
    maxIter?: number;
    maxViolations?: number;
  },
  id = `fix:${body.id}`,
  name = `Fix(${body.name})`
): Construction<I, I & FixpointMetadata, E | ProtocolViolationError, R> {
  return withDiagnostics({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<I & FixpointMetadata, E | ProtocolViolationError>> {
      const maxIter = options.maxIter ?? 10;
      const maxViolations = options.maxViolations ?? 0;
      const hashState = options.metric.stateHash ?? ((state: I) => JSON.stringify(state));
      const evidenceLedger = (context?.deps as Record<string, unknown> | undefined)?.evidenceLedger as {
        append?: (entry: Record<string, unknown>) => Promise<unknown>;
      } | undefined;

      let state: I = input;
      let iterations = 0;
      let monotoneViolations = 0;
      let cycleDetected = false;
      let terminationReason: FixpointTerminationReason = 'budget_exhausted';
      let previousMeasure = options.metric.measure(state);

      const seen = new Set<string>([hashState(state)]);

      while (iterations < maxIter) {
        if (options.stop(state)) {
          terminationReason = iterations === 0 ? 'stop_condition' : 'converged';
          break;
        }

        if (previousMeasure >= options.metric.capacity) {
          terminationReason = 'converged';
          break;
        }

        const nextStateOutcome = await executeWithTrace(body, state, context);
        if (!nextStateOutcome.ok) {
          return fail<I & FixpointMetadata, E | ProtocolViolationError>(
            nextStateOutcome.error,
            nextStateOutcome.partial as Partial<I & FixpointMetadata> | undefined,
            nextStateOutcome.errorAt ?? body.id,
          );
        }
        const nextState = nextStateOutcome.value;
        iterations += 1;
        const nextMeasure = options.metric.measure(nextState);

        if (nextMeasure < previousMeasure) {
          monotoneViolations += 1;
          await evidenceLedger?.append?.({
            kind: 'outcome',
            payload: {
              type: 'monotone_violation',
              constructionId: id,
              iteration: iterations,
              previousMeasure,
              nextMeasure,
            },
            provenance: {
              source: 'system_observation',
              method: 'operators.fix',
            },
            relatedEntries: [],
            sessionId: context?.sessionId,
          });
          if (monotoneViolations > maxViolations) {
            state = nextState;
            previousMeasure = nextMeasure;
            terminationReason = 'monotone_violation_limit';
            break;
          }
        }

        const stateHash = hashState(nextState);
        if (seen.has(stateHash)) {
          cycleDetected = true;
          if (maxViolations === 0) {
            return fail<I & FixpointMetadata, E | ProtocolViolationError>(
              new ProtocolViolationError(id, iterations, stateHash),
              state as unknown as Partial<I & FixpointMetadata>,
              id,
            );
          }
          state = nextState;
          previousMeasure = nextMeasure;
          terminationReason = 'cycle';
          break;
        }

        seen.add(stateHash);
        state = nextState;
        previousMeasure = nextMeasure;
      }

      if (terminationReason === 'budget_exhausted' && options.stop(state)) {
        terminationReason = 'converged';
      }

      let outputState: I = state;
      if (monotoneViolations > 0) {
        const maybeConfidence = (state as Record<string, unknown>).confidence as
          | { value?: unknown }
          | undefined;
        if (maybeConfidence && typeof maybeConfidence.value === 'number') {
          const penalty = Math.max(0, 1 - monotoneViolations / Math.max(1, maxIter));
          outputState = {
            ...state,
            confidence: {
              ...maybeConfidence,
              value: Math.max(0, Math.min(1, maybeConfidence.value * penalty)),
            },
          };
        }
      }

      return ok<I & FixpointMetadata, E | ProtocolViolationError>({
        ...outputState,
        iterations,
        finalMeasure: previousMeasure,
        monotoneViolations,
        cycleDetected,
        terminationReason,
      });
    },
    getEstimatedConfidence: body.getEstimatedConfidence,
  }) as Construction<I, I & FixpointMetadata, E | ProtocolViolationError, R>;
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
    async execute(input: I2, context): Promise<ConstructionOutcome<O2, E>> {
      const adaptedInput = pre(input);
      const output = await executeWithTrace(construction, adaptedInput, context);
      if (!output.ok) {
        return fail<O2, E>(
          output.error,
          output.partial as Partial<O2> | undefined,
          output.errorAt ?? construction.id,
        );
      }
      return ok<O2, E>(post(output.value));
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
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O2, E>> {
      const output = await executeWithTrace(construction, input, context);
      if (!output.ok) {
        return fail<O2, E>(
          output.error,
          output.partial as Partial<O2> | undefined,
          output.errorAt ?? construction.id,
        );
      }
      return ok<O2, E>(await post(output.value, context));
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
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O, E2>> {
      const outcome = await executeOutcomeWithTrace(construction, input, context);
      if (outcome.ok) {
        return ok<O, E2>(outcome.value);
      }
      return fail<O, E2>(transform(outcome.error), outcome.partial, outcome.errorAt);
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  });
}

export interface ConstructionRetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
}

/**
 * Retry construction execution only when failures are marked retriable.
 */
export function withRetry<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  options: ConstructionRetryOptions,
  id = `withRetry:${construction.id}`,
  name = `WithRetry(${construction.name})`,
): Construction<I, O, E, R> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 50);
  const backoffFactor = Math.max(1, options.backoffFactor ?? 2);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? baseDelayMs * 10);

  return withDiagnostics({
    id,
    name,
    async execute(input: I, context?: Context<R>): Promise<ConstructionOutcome<O, E>> {
      let attempt = 0;
      let lastFailure: ConstructionOutcome<O, E> | undefined;

      while (attempt < maxAttempts) {
        attempt += 1;
        const outcome = await executeOutcomeWithTrace(construction, input, context);
        if (outcome.ok) {
          return ok<O, E>(outcome.value);
        }

        lastFailure = outcome;
        if (!outcome.error.retriable || attempt >= maxAttempts) {
          return fail<O, E>(outcome.error, outcome.partial, outcome.errorAt ?? construction.id);
        }

        const delayMs = Math.min(
          baseDelayMs * Math.pow(backoffFactor, attempt - 1),
          maxDelayMs,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      if (lastFailure && !lastFailure.ok) {
        return fail<O, E>(
          lastFailure.error,
          lastFailure.partial,
          lastFailure.errorAt ?? construction.id,
        );
      }
      return fail<O, E>(
        new ConstructionError(
          `Retry loop exited without outcome after ${maxAttempts} attempts`,
          construction.id,
        ) as E,
        undefined,
        construction.id,
      );
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
    async execute(
      input: I,
      context?: Context<Omit<R, keyof RP>>,
    ): Promise<ConstructionOutcome<O, E>> {
      if (!context) {
        return fail<O, E>(
          new ConstructionError(
            `Execution context is required for ${construction.id}`,
            construction.id,
          ) as E,
          undefined,
          construction.id,
        );
      }

      const mergedContext: Context<R> = {
        ...context,
        deps: {
          ...(context.deps as object),
          ...(providedDeps as object),
        } as R,
      };

      const outcome = await executeOutcomeWithTrace(construction, input, mergedContext);
      if (outcome.ok) {
        return ok<O, E>(outcome.value);
      }
      return fail<O, E>(outcome.error, outcome.partial, outcome.errorAt ?? construction.id);
    },
    getEstimatedConfidence: construction.getEstimatedConfidence,
  });
}

/**
 * Backward-compatible map alias for existing call sites.
 */
export const mapConstruction = map;
