import type { Context, Construction } from '../types.js';
import { fail, ok } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface ProcessBudget {
  maxDurationMs?: number;
  maxTokenBudget?: number;
  maxUsd?: number;
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

export interface ProcessEvent {
  stage: string;
  type: 'stage_start' | 'stage_end' | 'cleanup' | 'warning';
  timestamp: string;
  detail?: string;
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

function normalizeProcessFailure(error: unknown, constructionId: string): ConstructionError {
  if (error instanceof ConstructionError) {
    return error;
  }
  if (error instanceof Error) {
    return new ConstructionError(error.message, constructionId, error);
  }
  return new ConstructionError(`Non-error process failure: ${String(error)}`, constructionId);
}

function createExitReasonFailure(
  exitReason: Exclude<ProcessExitReason, 'completed'>,
  constructionId: string,
): ConstructionError {
  switch (exitReason) {
    case 'dry_run':
      return new ConstructionError(
        'Process completed in dry-run mode; preview output is not a successful execution result',
        constructionId,
      );
    case 'budget_exceeded':
      return new ConstructionError(
        'Process exceeded its configured runtime or cost budget',
        constructionId,
      );
    case 'timeout':
      return new ConstructionError(
        'Process timed out before completing successfully',
        constructionId,
      );
    case 'failed':
    default:
      return new ConstructionError('Process did not complete successfully', constructionId);
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

  protected constructor(id: string, name: string, description: string) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  protected registerCleanup(handler: () => Promise<void> | void): void {
    this.cleanups.push(handler);
  }

  protected abstract buildPipeline(
    input: I,
    context?: Context<unknown>,
  ): ConstructionPipeline<I, S, O>;

  async execute(input: I, context?: Context<unknown>) {
    const startedAt = Date.now();
    const events: ProcessEvent[] = [];
    const pushEvent = (stage: string, type: ProcessEvent['type'], detail?: string): void => {
      events.push({
        stage,
        type,
        timestamp: new Date().toISOString(),
        detail,
      });
    };

    const timeoutMs = input.timeoutMs ?? 0;
    const maxDurationMs = input.budget?.maxDurationMs;

    const pipeline = this.buildPipeline(input, context);
    let state = pipeline.initialState(input);
    let exitReason: ProcessExitReason = 'completed';
    let failureError: ConstructionError | undefined;
    let failureAt: string | undefined;
    let cleanupFailureError: ConstructionError | undefined;

    const checkRuntimeLimits = (stageId: string): void => {
      const elapsed = Date.now() - startedAt;
      if (timeoutMs > 0 && elapsed > timeoutMs) {
        exitReason = 'timeout';
        throw new Error(`process_timeout:${stageId}:${elapsed}>${timeoutMs}`);
      }
      if (typeof maxDurationMs === 'number' && maxDurationMs > 0 && elapsed > maxDurationMs) {
        exitReason = 'budget_exceeded';
        throw new Error(`process_budget_duration_exceeded:${stageId}:${elapsed}>${maxDurationMs}`);
      }
    };

    try {
      for (const stage of pipeline.stages) {
        checkRuntimeLimits(stage.id);
        pushEvent(stage.id, 'stage_start');

        if (stage.mode === 'sequential') {
          for (const task of stage.tasks) {
            try {
              const patch = await task.run(input, state, context);
              state = { ...state, ...patch };
              checkRuntimeLimits(task.id);
            } catch (error) {
              failureAt = task.id;
              throw error;
            }
          }
        } else {
          const patches = await Promise.all(
            stage.tasks.map((task) =>
              task.run(input, state, context).catch((error) => {
                failureAt = task.id;
                throw error;
              }),
            ),
          );
          for (const patch of patches) {
            state = { ...state, ...patch };
          }
          checkRuntimeLimits(stage.id);
        }

        pushEvent(stage.id, 'stage_end');
      }
    } catch (error) {
      if (exitReason === 'completed') {
        exitReason = 'failed';
      }
      failureError = normalizeProcessFailure(error, this.id);
      failureAt ??= this.id;
      pushEvent(this.id, 'warning', error instanceof Error ? error.message : String(error));
    } finally {
      for (const cleanup of this.cleanups.reverse()) {
        try {
          await cleanup();
          pushEvent(this.id, 'cleanup');
        } catch (error) {
          cleanupFailureError ??= normalizeProcessFailure(error, this.id);
          pushEvent(
            this.id,
            'warning',
            `cleanup_failed:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.cleanups.length = 0;
    }

    let output: O;
    try {
      output = await pipeline.finalize(input, state, events);
    } catch (error) {
      const normalized = normalizeProcessFailure(error, this.id);
      pushEvent(this.id, 'warning', `finalize_failed:${normalized.message}`);
      return fail<O, ConstructionError>(
        failureError ?? normalized,
        undefined,
        failureAt ?? this.id,
      );
    }
    const durationMs = Date.now() - startedAt;
    const resolvedExitReason =
      exitReason === 'completed'
        ? (output.exitReason ?? 'completed')
        : exitReason;
    const normalizedOutput = {
      ...output,
      observations: output.observations ?? {},
      costSummary: {
        ...output.costSummary,
        durationMs: output.costSummary?.durationMs ?? durationMs,
      },
      exitReason:
        cleanupFailureError && resolvedExitReason === 'completed'
          ? ('failed' as const)
          : resolvedExitReason,
      events,
    };

    if (failureError) {
      return fail<O, ConstructionError>(
        failureError,
        normalizedOutput as Partial<O>,
        failureAt ?? this.id,
      );
    }

    if (cleanupFailureError) {
      return fail<O, ConstructionError>(
        cleanupFailureError,
        normalizedOutput as Partial<O>,
        this.id,
      );
    }

    if (normalizedOutput.exitReason !== 'completed') {
      return fail<O, ConstructionError>(
        createExitReasonFailure(normalizedOutput.exitReason, this.id),
        normalizedOutput as Partial<O>,
        this.id,
      );
    }

    return ok<O, ConstructionError>(normalizedOutput);
  }
}
