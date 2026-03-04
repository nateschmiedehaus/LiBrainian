import type { Context, Construction } from '../types.js';
import { ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';
import { globalEventBus } from '../../events.js';
import { getErrorMessage } from '../../utils/errors.js';

export interface ProcessBudget {
  maxDurationMs?: number;
  maxTokenBudget?: number;
  maxUsd?: number;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface ProcessSandboxConfig {
  cleanup?: boolean;
}

export interface ProcessInput {
  budget?: ProcessBudget;
  timeoutMs?: number;
  sandboxConfig?: ProcessSandboxConfig;
}

export type ProcessExitReason = 'completed' | 'failed' | 'timeout' | 'budget_exceeded' | 'dry_run';

export type ProcessEventType =
  | 'process_start'
  | 'process_complete'
  | 'process_failed'
  | 'stage_start'
  | 'stage_complete'
  | 'stage_failed'
  | 'timeout'
  | 'budget_exceeded'
  | 'cleanup'
  | 'cleanup_failed'
  | 'warning';

export interface ProcessEvent {
  stage: string;
  type: ProcessEventType;
  timestamp: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessOutput {
  observations: Record<string, unknown>;
  costSummary: {
    durationMs: number;
    tokensUsed?: number;
    usd?: number;
  };
  exitReason: ProcessExitReason;
  events: ProcessEvent[];
}

export interface PipelineTask<I extends ProcessInput, S extends Record<string, unknown>> {
  id: string;
  run: (
    input: I,
    state: Readonly<S>,
    context?: Context<unknown>,
  ) => Promise<Partial<S>>;
}

export interface PipelineStage<I extends ProcessInput, S extends Record<string, unknown>> {
  id: string;
  mode: 'sequential' | 'parallel';
  tasks: Array<PipelineTask<I, S>>;
}

export interface ConstructionPipeline<
  I extends ProcessInput,
  S extends Record<string, unknown>,
  O extends ProcessOutput,
> {
  initialState(input: I): S;
  stages: Array<PipelineStage<I, S>>;
  finalize(input: I, state: S, events: ProcessEvent[]): Promise<O> | O;
}

interface ProcessCostUsage {
  durationMs: number;
  tokensUsed?: number;
  usd?: number;
}

class ProcessTimeoutError extends Error {
  constructor(
    public readonly stageId: string,
    public readonly timeoutMs: number,
  ) {
    super(`process_timeout:${stageId}:${timeoutMs}`);
    this.name = 'ProcessTimeoutError';
  }
}

class ProcessBudgetExceededError extends Error {
  constructor(
    public readonly stageId: string,
    public readonly metric: 'duration' | 'tokens' | 'usd',
    public readonly usage: number,
    public readonly limit: number,
  ) {
    super(`process_budget_exceeded:${metric}:${usage}>${limit}:${stageId}`);
    this.name = 'ProcessBudgetExceededError';
  }

  get details(): Record<string, unknown> {
    return {
      metric: this.metric,
      usage: this.usage,
      limit: this.limit,
      stageId: this.stageId,
    };
  }
}

/**
 * Base process abstraction for multi-stage/multi-agent constructions.
 * Subclasses declare the pipeline topology (sequential/parallel stages),
 * while the base class enforces timeout, budget checks, and cleanup guarantees.
 */
export abstract class AgenticProcess<
  I extends ProcessInput,
  O extends ProcessOutput,
  S extends Record<string, unknown>,
> implements Construction<I, O, ConstructionError, unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private readonly cleanups: Array<() => Promise<void> | void> = [];
  private usage: ProcessCostUsage = { durationMs: 0 };

  protected constructor(id: string, name: string, description: string) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  protected registerCleanup(handler: () => Promise<void> | void): void {
    this.cleanups.push(handler);
  }

  protected recordUsage(delta: Partial<ProcessCostUsage>): void {
    if (!this.usage) {
      this.usage = { durationMs: 0 };
    }
    if (typeof delta.durationMs === 'number' && Number.isFinite(delta.durationMs)) {
      const duration = Math.max(0, delta.durationMs);
      this.usage.durationMs = Math.max(this.usage.durationMs ?? 0, duration);
    }
    if (typeof delta.tokensUsed === 'number' && Number.isFinite(delta.tokensUsed)) {
      const tokens = Math.max(0, delta.tokensUsed);
      this.usage.tokensUsed = (this.usage.tokensUsed ?? 0) + tokens;
    }
    if (typeof delta.usd === 'number' && Number.isFinite(delta.usd)) {
      const usd = Math.max(0, delta.usd);
      this.usage.usd = (this.usage.usd ?? 0) + usd;
    }
  }

  protected abstract buildPipeline(
    input: I,
    context?: Context<unknown>,
  ): ConstructionPipeline<I, S, O>;

  async execute(input: I, context?: Context<unknown>) {
    const startedAt = Date.now();
    this.usage = { durationMs: 0 };
    const budget = input.budget ?? {};
    const events: ProcessEvent[] = [];
    const emitEvent = (
      stage: string,
      type: ProcessEventType,
      detail?: string,
      metadata?: Record<string, unknown>,
    ): void => {
      const event: ProcessEvent = {
        stage,
        type,
        timestamp: new Date().toISOString(),
        detail,
        metadata,
      };
      events.push(event);
      void globalEventBus.emit({
        type: 'process_event',
        timestamp: new Date(),
        data: {
          processId: this.id,
          processName: this.name,
          stageId: stage,
          eventType: type,
          detail,
          metadata,
        },
      });
    };

    const updateDurationUsage = (): void => {
      this.recordUsage({ durationMs: Date.now() - startedAt });
    };

    const enforceBudget = (stageId: string): void => {
      updateDurationUsage();
      const maxDurationMs = budget.maxDurationMs;
      const tokenLimit = budget.maxTokenBudget ?? budget.maxTokens;
      const usdLimit = budget.maxUsd;
      if (typeof maxDurationMs === 'number' && this.usage.durationMs > maxDurationMs) {
        throw new ProcessBudgetExceededError(stageId, 'duration', this.usage.durationMs, maxDurationMs);
      }
      if (
        typeof tokenLimit === 'number'
        && typeof this.usage.tokensUsed === 'number'
        && this.usage.tokensUsed > tokenLimit
      ) {
        throw new ProcessBudgetExceededError(stageId, 'tokens', this.usage.tokensUsed, tokenLimit);
      }
      if (
        typeof usdLimit === 'number'
        && typeof this.usage.usd === 'number'
        && this.usage.usd > usdLimit
      ) {
        throw new ProcessBudgetExceededError(stageId, 'usd', this.usage.usd, usdLimit);
      }
    };

    const abortController = new AbortController();
    if (context?.signal) {
      if (context.signal.aborted) {
        abortController.abort(context.signal.reason);
      } else {
        const forwardAbort = (): void => {
          abortController.abort(context.signal.reason);
        };
        context.signal.addEventListener('abort', forwardAbort, { once: true });
      }
    }
    const effectiveContext = context
      ? { ...context, signal: abortController.signal }
      : context;

    const pipeline = this.buildPipeline(input, effectiveContext);
    let state = pipeline.initialState(input);
    let exitReason: ProcessExitReason = 'completed';

    const ensureNotAborted = (stageId: string): void => {
      if (abortController.signal.aborted) {
        const reason = abortController.signal.reason;
        if (reason instanceof Error) {
          throw reason;
        }
        throw new Error(`process_aborted:${stageId}`);
      }
    };

    const runStages = async (): Promise<void> => {
      for (const stage of pipeline.stages) {
        ensureNotAborted(stage.id);
        enforceBudget(stage.id);
        emitEvent(stage.id, 'stage_start');
        const stageStarted = Date.now();
        try {
          if (stage.mode === 'sequential') {
            for (const task of stage.tasks) {
              ensureNotAborted(task.id);
              const patch = await task.run(input, state, effectiveContext);
              if (patch && typeof patch === 'object') {
                state = { ...state, ...patch };
              }
              enforceBudget(task.id);
            }
          } else {
            const patches = await Promise.all(
              stage.tasks.map((task) => task.run(input, state, effectiveContext)),
            );
            for (const patch of patches) {
              if (patch && typeof patch === 'object') {
                state = { ...state, ...patch };
              }
            }
            enforceBudget(stage.id);
          }
          emitEvent(stage.id, 'stage_complete', undefined, {
            durationMs: Date.now() - stageStarted,
          });
        } catch (error) {
          const detail = getErrorMessage(error);
          if (error instanceof ProcessBudgetExceededError) {
            emitEvent(stage.id, 'budget_exceeded', detail, error.details);
          } else if (error instanceof ProcessTimeoutError) {
            emitEvent(stage.id, 'timeout', detail);
          } else {
            emitEvent(stage.id, 'warning', detail);
          }
          emitEvent(stage.id, 'stage_failed', detail);
          throw error;
        }
      }
    };

    const resolveTimeoutMs = (): number => {
      const candidates = [
        input.timeoutMs,
        budget.timeoutMs,
        budget.maxDurationMs,
      ].filter((value): value is number => typeof value === 'number' && value > 0);
      return candidates.length > 0 ? Math.min(...candidates) : 0;
    };

    emitEvent(this.id, 'process_start');
    const timeoutMs = resolveTimeoutMs();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const pipelinePromise = runStages();
    if (timeoutMs > 0) {
      pipelinePromise.catch(() => undefined);
    }

    let failure: unknown;
    try {
      if (timeoutMs > 0) {
        await Promise.race([
          pipelinePromise,
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              const error = new ProcessTimeoutError(this.id, timeoutMs);
              abortController.abort(error);
              reject(error);
            }, timeoutMs);
          }),
        ]);
      } else {
        await pipelinePromise;
      }
    } catch (error) {
      failure = error;
      if (error instanceof ProcessTimeoutError) {
        exitReason = 'timeout';
      } else if (error instanceof ProcessBudgetExceededError) {
        exitReason = 'budget_exceeded';
      } else {
        exitReason = 'failed';
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    updateDurationUsage();

    if (failure) {
      const detail = getErrorMessage(failure);
      if (exitReason === 'timeout') {
        emitEvent(this.id, 'timeout', detail);
      } else if (exitReason === 'budget_exceeded') {
        emitEvent(this.id, 'budget_exceeded', detail);
      }
      emitEvent(this.id, 'process_failed', detail, { exitReason });
    } else {
      emitEvent(this.id, 'process_complete', undefined, {
        durationMs: this.usage.durationMs,
      });
    }

    try {
      // Ensure cleanup always runs, even if pipeline failed.
      for (const cleanup of this.cleanups.reverse()) {
        try {
          await cleanup();
          emitEvent(this.id, 'cleanup');
        } catch (error) {
          emitEvent(this.id, 'cleanup_failed', getErrorMessage(error));
        }
      }
    } finally {
      this.cleanups.length = 0;
    }

    const output = await pipeline.finalize(input, state, events);
    const resolvedExitReason =
      exitReason === 'completed'
        ? (output.exitReason ?? 'completed')
        : exitReason;
    const fallbackDuration = Date.now() - startedAt;
    const costSummary = {
      durationMs: output.costSummary?.durationMs ?? this.usage.durationMs ?? fallbackDuration,
      tokensUsed: output.costSummary?.tokensUsed ?? this.usage.tokensUsed,
      usd: output.costSummary?.usd ?? this.usage.usd,
    };

    return ok<O, ConstructionError>({
      ...output,
      observations: output.observations ?? {},
      costSummary,
      exitReason: resolvedExitReason,
      events,
    });
  }
}
