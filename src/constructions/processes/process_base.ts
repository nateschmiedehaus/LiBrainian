import type { Context, Construction } from '../types.js';
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

  async execute(input: I, context?: Context<unknown>): Promise<O> {
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
            const patch = await task.run(input, state, context);
            state = { ...state, ...patch };
            checkRuntimeLimits(task.id);
          }
        } else {
          const patches = await Promise.all(
            stage.tasks.map((task) => task.run(input, state, context)),
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
      pushEvent(this.id, 'warning', error instanceof Error ? error.message : String(error));
    } finally {
      for (const cleanup of this.cleanups.reverse()) {
        try {
          await cleanup();
          pushEvent(this.id, 'cleanup');
        } catch (error) {
          pushEvent(
            this.id,
            'warning',
            `cleanup_failed:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.cleanups.length = 0;
    }

    const output = await pipeline.finalize(input, state, events);
    const durationMs = Date.now() - startedAt;
    const resolvedExitReason =
      exitReason === 'completed'
        ? (output.exitReason ?? 'completed')
        : exitReason;

    return {
      ...output,
      observations: output.observations ?? {},
      costSummary: {
        ...output.costSummary,
        durationMs: output.costSummary?.durationMs ?? durationMs,
      },
      exitReason: resolvedExitReason,
      events,
    };
  }
}
