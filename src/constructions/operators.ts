import { AsyncLocalStorage } from 'node:async_hooks';
import {
  isConfidenceValue,
  sequenceConfidence,
  type ConfidenceValue,
} from '../epistemics/confidence.js';
import type { EvidenceId } from '../epistemics/evidence_ledger.js';
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
  ConstructionHandle,
  HumanContinuation,
  HumanRequest,
  HumanResponse,
  ConstructionEvent,
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
  ResumableConstruction,
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

type StreamingConstruction<I, O, E extends ConstructionError, R> = Omit<Construction<I, O, E, R>, 'execute'> & {
  execute?: Construction<I, O, E, R>['execute'];
  stream?: Construction<I, O, E, R>['stream'];
};

function cancelledStreamError<E extends ConstructionError>(constructionId: string): E {
  return new ConstructionCancelledError(constructionId) as E;
}

async function* defaultStreamFromExecute<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  input: I,
  context?: Context<R>,
): AsyncIterable<ConstructionEvent<O, E>> {
  const outcome = await executeOutcomeWithTrace(construction, input, context);
  if (outcome.ok) {
    yield { kind: 'completed', result: outcome.value };
    return;
  }
  yield {
    kind: 'failed',
    error: outcome.error,
    partial: outcome.partial,
  };
}

function getStreamImplementation<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
): (input: I, context?: Context<R>) => AsyncIterable<ConstructionEvent<O, E>> {
  if (construction.stream) {
    return (input: I, context?: Context<R>) => construction.stream!(input, context);
  }
  return (input: I, context?: Context<R>) => defaultStreamFromExecute(construction, input, context);
}

function deriveExecuteFromStream<I, O, E extends ConstructionError, R>(
  constructionId: string,
  stream: (input: I, context?: Context<R>) => AsyncIterable<ConstructionEvent<O, E>>,
): (input: I, context?: Context<R>) => Promise<ConstructionOutcome<O, E>> {
  return async (input: I, context?: Context<R>) => {
    for await (const event of stream(input, context)) {
      if (context?.signal?.aborted) {
        return fail<O, E>(cancelledStreamError<E>(constructionId), undefined, constructionId);
      }
      if (event.kind === 'completed') {
        return ok<O, E>(event.result);
      }
      if (event.kind === 'failed') {
        const errorAt = typeof event.error?.constructionId === 'string'
          && event.error.constructionId.length > 0
          ? event.error.constructionId
          : constructionId;
        return fail<O, E>(event.error, event.partial, errorAt);
      }
      if (event.kind === 'safety_violation' && event.severity === 'block') {
        return fail<O, E>(
          new ConstructionError(`Safety rule blocked: ${event.rule}`, constructionId) as E,
          undefined,
          constructionId,
        );
      }
    }
    return fail<O, E>(
      new ConstructionError('Stream ended without completion event', constructionId) as E,
      undefined,
      constructionId,
    );
  };
}

function withDiagnostics<I, O, E extends ConstructionError, R>(
  construction: StreamingConstruction<I, O, E, R>
): Construction<I, O, E, R> {
  if (!construction.execute && !construction.stream) {
    throw new ConstructionError(
      `Construction ${construction.id} must define execute() or stream()`,
      construction.id,
    );
  }

  const stream = construction.stream
    ? (input: I, context?: Context<R>) => construction.stream!(input, context)
    : (input: I, context?: Context<R>) => defaultStreamFromExecute(construction as Construction<I, O, E, R>, input, context);
  const execute = construction.execute
    ? (input: I, context?: Context<R>) => construction.execute!(input, context)
    : deriveExecuteFromStream<I, O, E, R>(construction.id, stream);

  const whyFailed =
    construction.whyFailed ??
    ((error: unknown) => explainConstructionFailure(error, construction.id));

  return {
    ...construction,
    execute,
    stream,
    whyFailed,
    debug(options?: ConstructionDebugOptions) {
      return createDebugConstruction({ ...construction, execute, stream, whyFailed }, options);
    },
  };
}

type StreamRaceResult<
  O,
  E extends ConstructionError,
> = {
  source: 'left' | 'right';
  result: IteratorResult<ConstructionEvent<O, E>>;
};

async function closeIterator(iterator: AsyncIterator<unknown>): Promise<void> {
  if (typeof iterator.return === 'function') {
    await iterator.return();
  }
}

async function* interleaveEventStreams<
  O1,
  E1 extends ConstructionError,
  O2,
  E2 extends ConstructionError,
>(
  left: AsyncIterable<ConstructionEvent<O1, E1>>,
  right: AsyncIterable<ConstructionEvent<O2, E2>>,
): AsyncIterable<StreamRaceResult<O1 | O2, E1 | E2>> {
  const leftIterator = left[Symbol.asyncIterator]();
  const rightIterator = right[Symbol.asyncIterator]();
  let leftPending: Promise<StreamRaceResult<O1 | O2, E1 | E2>> | undefined = leftIterator
    .next()
    .then((result) => ({ source: 'left', result }));
  let rightPending: Promise<StreamRaceResult<O1 | O2, E1 | E2>> | undefined = rightIterator
    .next()
    .then((result) => ({ source: 'right', result }));

  try {
    while (leftPending || rightPending) {
      const pending = [leftPending, rightPending].filter(Boolean) as Array<
        Promise<StreamRaceResult<O1 | O2, E1 | E2>>
      >;
      const next = await Promise.race(pending);
      yield next;
      if (next.source === 'left') {
        leftPending = next.result.done
          ? undefined
          : leftIterator.next().then((result) => ({ source: 'left', result }));
      } else {
        rightPending = next.result.done
          ? undefined
          : rightIterator.next().then((result) => ({ source: 'right', result }));
      }
    }
  } finally {
    await Promise.allSettled([closeIterator(leftIterator), closeIterator(rightIterator)]);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function extractConfidenceFromValue(value: unknown): ConfidenceValue | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const confidence = value.confidence;
  if (!isConfidenceValue(confidence)) {
    return undefined;
  }
  return confidence;
}

function confidenceScalar(confidence: ConfidenceValue): number | undefined {
  switch (confidence.type) {
    case 'absent':
      return undefined;
    case 'bounded':
      return clampUnit((confidence.low + confidence.high) / 2);
    default:
      return clampUnit(confidence.value);
  }
}

function extractEvidenceRefsFromValue(value: unknown): EvidenceId[] {
  if (!isRecord(value) || !Array.isArray(value.evidenceRefs)) {
    return [];
  }
  return value.evidenceRefs
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry as EvidenceId);
}

function dedupeEvidenceRefs(...refs: ReadonlyArray<ReadonlyArray<EvidenceId | string>>): EvidenceId[] {
  const seen = new Set<string>();
  for (const list of refs) {
    for (const item of list) {
      if (typeof item === 'string' && item.length > 0) {
        seen.add(item);
      }
    }
  }
  return Array.from(seen).map((entry) => entry as EvidenceId);
}

function applyEvidenceRefs<O>(value: O, evidenceRefs: EvidenceId[]): O {
  if (!isRecord(value) || !Array.isArray(value.evidenceRefs)) {
    return value;
  }
  return {
    ...value,
    evidenceRefs,
  } as O;
}

function applyConfidenceOverride<O>(value: O, overrideConfidence?: number): O {
  if (!isRecord(value) || !isRecord(value.confidence) || typeof value.confidence.value !== 'number') {
    return value;
  }
  if (typeof overrideConfidence !== 'number') {
    return value;
  }
  return {
    ...value,
    confidence: {
      ...value.confidence,
      value: clampUnit(overrideConfidence),
    },
  } as O;
}

type AppendOnlyLedger = {
  append?: (entry: Record<string, unknown>) => Promise<unknown>;
};

function evidenceLedgerFromContext<R>(context?: Context<R>): AppendOnlyLedger | undefined {
  if (!context || !isRecord(context.deps)) {
    return undefined;
  }
  const maybeLedger = (context.deps as Record<string, unknown>).evidenceLedger;
  if (!isRecord(maybeLedger) || typeof maybeLedger.append !== 'function') {
    return undefined;
  }
  return maybeLedger as AppendOnlyLedger;
}

async function appendLedgerEntry(
  ledger: AppendOnlyLedger | undefined,
  entry: Record<string, unknown>,
): Promise<EvidenceId | undefined> {
  if (!ledger?.append) {
    return undefined;
  }
  const appended = await ledger.append(entry);
  if (!isRecord(appended) || typeof appended.id !== 'string') {
    return undefined;
  }
  return appended.id as EvidenceId;
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

  const stream = async function* (
    input: I,
    context?: Context<R>,
  ): AsyncIterable<ConstructionEvent<O, E1 | E2>> {
    const firstStream = getStreamImplementation(first);
    const secondStream = getStreamImplementation(second);
    for await (const event of firstStream(input, context)) {
      if (context?.signal?.aborted) {
        yield { kind: 'failed', error: cancelledStreamError<E1 | E2>(id) };
        return;
      }
      if (event.kind === 'completed') {
        for await (const secondEvent of secondStream(event.result, context)) {
          if (context?.signal?.aborted) {
            yield { kind: 'failed', error: cancelledStreamError<E1 | E2>(id) };
            return;
          }
          if (secondEvent.kind === 'failed') {
            yield {
              kind: 'failed',
              error: secondEvent.error as E1 | E2,
              partial: (secondEvent.partial
                ?? (event.result as unknown as Partial<O>)) as Partial<O> | undefined,
            };
            return;
          }
          yield secondEvent as ConstructionEvent<O, E1 | E2>;
          if (secondEvent.kind === 'completed') {
            return;
          }
        }
        yield {
          kind: 'failed',
          error: new ConstructionError('Second stage ended without terminal event', second.id) as E1 | E2,
        };
        return;
      }

      if (event.kind === 'failed') {
        yield {
          kind: 'failed',
          error: event.error as E1 | E2,
          partial: event.partial as Partial<O> | undefined,
        };
        return;
      }

      yield event as ConstructionEvent<O, E1 | E2>;
    }

    yield {
      kind: 'failed',
      error: new ConstructionError('First stage ended without terminal event', first.id) as E1 | E2,
    };
  };

  return withDiagnostics({
    id,
    name,
    stream,
    execute: deriveExecuteFromStream<I, O, E1 | E2, R>(id, stream),
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
  const stream = async function* (
    input: I,
    context?: Context<R>,
  ): AsyncIterable<ConstructionEvent<[O1, O2], E>> {
    const leftStream = getStreamImplementation(left)(input, context);
    const rightStream = getStreamImplementation(right)(input, context);
    let leftResult: O1 | undefined;
    let rightResult: O2 | undefined;

    for await (const raced of interleaveEventStreams(leftStream, rightStream)) {
      if (context?.signal?.aborted) {
        yield { kind: 'failed', error: cancelledStreamError<E>(id) };
        return;
      }
      const event = raced.result.value;
      if (raced.result.done || !event) {
        continue;
      }
      if (event.kind === 'failed') {
        yield {
          kind: 'failed',
          error: event.error,
          partial: event.partial as Partial<[O1, O2]> | undefined,
        };
        return;
      }
      if (event.kind === 'completed') {
        if (raced.source === 'left') {
          leftResult = event.result as O1;
        } else {
          rightResult = event.result as O2;
        }
        if (leftResult !== undefined && rightResult !== undefined) {
          yield { kind: 'completed', result: [leftResult, rightResult] };
          return;
        }
        continue;
      }
      yield event as ConstructionEvent<[O1, O2], E>;
    }

    yield {
      kind: 'failed',
      error: new ConstructionError('Fanout stream ended without both branch completions', id) as E,
    };
  };

  return withDiagnostics({
    id,
    name,
    stream,
    execute: deriveExecuteFromStream<I, [O1, O2], E, R>(id, stream),
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
  const stream = async function* (
    input: I,
    context?: Context<R>,
  ): AsyncIterable<ConstructionEvent<O, E>> {
    const primaryStream = getStreamImplementation(primary);
    const backupStream = getStreamImplementation(backup);
    let primaryFailed = false;

    for await (const event of primaryStream(input, context)) {
      if (context?.signal?.aborted) {
        yield { kind: 'failed', error: cancelledStreamError<E>(id) };
        return;
      }
      if (event.kind === 'failed') {
        primaryFailed = true;
        break;
      }
      yield event;
      if (event.kind === 'completed') {
        return;
      }
    }

    if (!primaryFailed) {
      yield {
        kind: 'failed',
        error: new ConstructionError('Primary stream ended without terminal event', primary.id) as E,
      };
      return;
    }

    for await (const event of backupStream(input, context)) {
      if (context?.signal?.aborted) {
        yield { kind: 'failed', error: cancelledStreamError<E>(id) };
        return;
      }
      yield event;
      if (event.kind === 'completed' || event.kind === 'failed') {
        return;
      }
    }

    yield {
      kind: 'failed',
      error: new ConstructionError('Backup stream ended without terminal event', backup.id) as E,
    };
  };

  return withDiagnostics({
    id,
    name,
    stream,
    execute: deriveExecuteFromStream<I, O, E, R>(id, stream),
    getEstimatedConfidence: primary.getEstimatedConfidence ?? backup.getEstimatedConfidence,
  });
}

/**
 * Guard stream execution by failing closed on blocking safety violations.
 */
export function withSafetyGate<I, O, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  id = `withSafetyGate:${construction.id}`,
  name = `WithSafetyGate(${construction.name})`,
): Construction<I, O, E | ConstructionError, R> {
  const stream = async function* (
    input: I,
    context?: Context<R>,
  ): AsyncIterable<ConstructionEvent<O, E | ConstructionError>> {
    const source = getStreamImplementation(construction)(input, context);
    for await (const event of source) {
      if (context?.signal?.aborted) {
        yield {
          kind: 'failed',
          error: cancelledStreamError<E | ConstructionError>(id),
        };
        return;
      }
      yield event as ConstructionEvent<O, E | ConstructionError>;
      if (event.kind === 'safety_violation' && event.severity === 'block') {
        yield {
          kind: 'failed',
          error: new ConstructionError(
            `Safety rule blocked execution: ${event.rule}`,
            construction.id,
          ),
        };
        return;
      }
      if (event.kind === 'failed' || event.kind === 'completed') {
        return;
      }
    }
    yield {
      kind: 'failed',
      error: new ConstructionError('Safety gate stream ended without terminal event', construction.id),
    };
  };

  return withDiagnostics({
    id,
    name,
    stream,
    execute: deriveExecuteFromStream<I, O, E | ConstructionError, R>(id, stream),
    getEstimatedConfidence: construction.getEstimatedConfidence,
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

export interface PauseForHumanOptions {
  /**
   * Confidence threshold below which human escalation is triggered.
   * Defaults to 0.6.
   */
  readonly confidenceThreshold?: number;
  /**
   * Optional timeout metadata propagated through `human_request` stream events.
   */
  readonly timeoutMs?: number;
}

/**
 * Pause and resume a construction at low-confidence outcomes.
 *
 * The inner construction is executed exactly once per `start()` call.
 * If paused, `resume()` completes from captured state without re-executing inner.
 */
export function pauseForHuman<I, O, E extends ConstructionError, R>(
  inner: Construction<I, O, E, R>,
  escalation: (partial: Partial<O>, confidence: ConfidenceValue) => HumanRequest,
  options?: PauseForHumanOptions,
): ResumableConstruction<I, O, E, R> {
  const confidenceThreshold = options?.confidenceThreshold ?? 0.6;
  const id = `pauseForHuman:${inner.id}`;
  const name = `PauseForHuman(${inner.name})`;

  const toCompletedHandle = (
    result: ConstructionOutcome<O, E>,
  ): ConstructionHandle<O, E> => ({
    status: 'completed',
    result,
  });

  const start = async (
    input: I,
    context?: Context<R>,
  ): Promise<ConstructionHandle<O, E>> => {
    const outcome = await executeOutcomeWithTrace(inner, input, context);
    if (!outcome.ok) {
      return toCompletedHandle(
        fail<O, E>(
          outcome.error,
          outcome.partial,
          outcome.errorAt ?? inner.id,
        ),
      );
    }

    const confidence = extractConfidenceFromValue(outcome.value) ?? inner.getEstimatedConfidence?.();
    const confidenceValue = confidence ? confidenceScalar(confidence) : undefined;
    if (!confidence || confidenceValue === undefined || confidenceValue >= confidenceThreshold) {
      return toCompletedHandle(ok<O, E>(outcome.value));
    }

    const partialEvidence = extractEvidenceRefsFromValue(outcome.value);
    const request = escalation(outcome.value as Partial<O>, confidence);
    const normalizedRequest: HumanRequest = {
      ...request,
      sessionId: request.sessionId || context?.sessionId || 'unknown_session',
      constructionId: request.constructionId || inner.id,
      evidenceRefs: request.evidenceRefs.length > 0 ? request.evidenceRefs : partialEvidence,
    };

    const ledger = evidenceLedgerFromContext(context);
    const escalationEvidenceId = await appendLedgerEntry(ledger, {
      kind: 'escalation_request',
      payload: {
        constructionId: inner.id,
        threshold: confidenceThreshold,
        confidence: confidenceValue,
        request: normalizedRequest,
        partialEvidence,
      },
      provenance: {
        source: 'system_observation',
        method: 'constructions.pauseForHuman',
      },
      relatedEntries: partialEvidence,
      sessionId: context?.sessionId,
    });

    let resumed: Promise<ConstructionHandle<O, E>> | undefined;
    const resume = (response: HumanResponse): Promise<ConstructionHandle<O, E>> => {
      if (resumed) {
        return resumed;
      }
      resumed = (async () => {
        const overrideEvidenceId = await appendLedgerEntry(ledger, {
          kind: 'human_override',
          payload: {
            constructionId: inner.id,
            reviewerId: response.reviewerId,
            decision: response.decision,
            rationale: response.rationale,
            overrideConfidence: response.overrideConfidence,
            request: normalizedRequest,
          },
          provenance: {
            source: 'user_input',
            method: 'constructions.pauseForHuman.resume',
          },
          relatedEntries: dedupeEvidenceRefs(
            partialEvidence,
            escalationEvidenceId ? [escalationEvidenceId] : [],
          ),
          sessionId: context?.sessionId,
        });

        const mergedEvidenceRefs = dedupeEvidenceRefs(
          extractEvidenceRefsFromValue(outcome.value),
          partialEvidence,
          normalizedRequest.evidenceRefs,
          escalationEvidenceId ? [escalationEvidenceId] : [],
          overrideEvidenceId ? [overrideEvidenceId] : [],
        );

        const withEvidence = applyEvidenceRefs(outcome.value, mergedEvidenceRefs);
        const withOverride = applyConfidenceOverride(withEvidence, response.overrideConfidence);
        return toCompletedHandle(ok<O, E>(withOverride));
      })();
      return resumed;
    };

    return {
      status: 'paused',
      request: normalizedRequest,
      partialEvidence,
      resume,
    };
  };

  const stream = async function* (
    input: I,
    context?: Context<R>,
  ): AsyncIterable<ConstructionEvent<O, E>> {
    const handle = await start(input, context);
    if (handle.status === 'completed') {
      if (handle.result.ok) {
        yield { kind: 'completed', result: handle.result.value };
        return;
      }
      yield {
        kind: 'failed',
        error: handle.result.error,
        partial: handle.result.partial,
      };
      return;
    }

    const emitTerminal = async function* (
      resumedHandle: ConstructionHandle<O, E>,
    ): AsyncIterable<ConstructionEvent<O, E>> {
      if (resumedHandle.status !== 'completed') {
        return;
      }
      if (resumedHandle.result.ok) {
        yield { kind: 'completed', result: resumedHandle.result.value };
        return;
      }
      yield {
        kind: 'failed',
        error: resumedHandle.result.error,
        partial: resumedHandle.result.partial,
      };
    };

    let consumed = false;
    const continuation: HumanContinuation<O, E> = {
      resume: (response: HumanResponse): AsyncIterable<ConstructionEvent<O, E>> => (async function* () {
        if (consumed) {
          return;
        }
        consumed = true;
        const resumedHandle = await handle.resume(response);
        yield* emitTerminal(resumedHandle);
      })(),
      skip: (): AsyncIterable<ConstructionEvent<O, E>> => (async function* () {
        if (consumed) {
          return;
        }
        consumed = true;
        const resumedHandle = await handle.resume({
          reviewerId: 'system',
          decision: 'skip',
        });
        yield* emitTerminal(resumedHandle);
      })(),
      abort: (): void => {
        consumed = true;
      },
    };

    yield {
      kind: 'human_request',
      type: 'human_request',
      request: handle.request,
      continuation,
      ...(options?.timeoutMs && options.timeoutMs > 0 ? { timeoutMs: options.timeoutMs } : {}),
    };
  };

  return {
    id,
    name,
    description: `Pause ${inner.name} for human review when confidence is below ${confidenceThreshold}.`,
    start,
    stream,
  };
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
