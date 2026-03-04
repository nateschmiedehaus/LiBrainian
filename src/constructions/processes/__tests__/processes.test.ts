import { describe, expect, it } from 'vitest';
import {
  AgenticProcess,
  createObservationExtractionConstruction,
  createPatrolProcessConstruction,
  createCodeReviewPipelineConstruction,
  type ConstructionPipeline,
  type ProcessInput,
  type ProcessOutput,
} from '../index.js';
import { unwrapConstructionExecutionResult } from '../../types.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface DemoInput extends ProcessInput {
  fail?: boolean;
}

interface DemoOutput extends ProcessOutput {
  value: number;
}

class DemoProcess extends AgenticProcess<DemoInput, DemoOutput, { value: number }> {
  private cleanupCount = 0;

  constructor() {
    super('demo-process', 'Demo Process', 'demo');
  }

  getCleanupCount(): number {
    return this.cleanupCount;
  }

  protected buildPipeline(): ConstructionPipeline<DemoInput, { value: number }, DemoOutput> {
    return {
      initialState: () => ({ value: 0 }),
      stages: [
        {
          id: 'setup',
          mode: 'sequential',
          tasks: [
            {
              id: 'setup.task',
              run: async () => {
                this.registerCleanup(async () => {
                  this.cleanupCount += 1;
                });
                return { value: 1 };
              },
            },
          ],
        },
        {
          id: 'parallel',
          mode: 'parallel',
          tasks: [
            {
              id: 'parallel.a',
              run: async (input) => {
                if (input.fail) throw new Error('boom');
                return { value: 2 };
              },
            },
            {
              id: 'parallel.b',
              run: async () => ({ value: 3 }),
            },
          ],
        },
      ],
      finalize: async (_input, state, events) => ({
        value: state.value,
        observations: { state },
        costSummary: { durationMs: 0 },
        exitReason: 'completed',
        events,
      }),
    };
  }
}

class ParallelDelayProcess extends AgenticProcess<ProcessInput, DemoOutput, { total: number }> {
  constructor() {
    super('parallel-delay', 'Parallel Delay', 'tests parallel stage metadata');
  }

  protected buildPipeline(): ConstructionPipeline<ProcessInput, { total: number }, DemoOutput> {
    return {
      initialState: () => ({ total: 0 }),
      stages: [
        {
          id: 'parallel-stage',
          mode: 'parallel',
          tasks: [
            {
              id: 'parallel.a',
              run: async () => {
                await sleep(35);
                return { total: 1 };
              },
            },
            {
              id: 'parallel.b',
              run: async () => {
                await sleep(55);
                return { total: 2 };
              },
            },
          ],
        },
      ],
      finalize: async (_input, state, events) => ({
        value: state.total,
        observations: { state },
        costSummary: { durationMs: 0 },
        exitReason: 'completed',
        events,
      }),
    };
  }
}

class TimeoutProcess extends AgenticProcess<ProcessInput, DemoOutput, { invoked: boolean }> {
  private cleanupRuns = 0;

  constructor() {
    super('timeout-process', 'Timeout Process', 'tests timeout handling');
  }

  getCleanupRuns(): number {
    return this.cleanupRuns;
  }

  protected buildPipeline(): ConstructionPipeline<ProcessInput, { invoked: boolean }, DemoOutput> {
    return {
      initialState: () => ({ invoked: false }),
      stages: [
        {
          id: 'slow-stage',
          mode: 'sequential',
          tasks: [
            {
              id: 'slow.task',
              run: async () => {
                this.registerCleanup(() => {
                  this.cleanupRuns += 1;
                });
                await sleep(80);
                return { invoked: true };
              },
            },
          ],
        },
      ],
      finalize: async (_input, state, events) => ({
        value: state.invoked ? 1 : 0,
        observations: { state },
        costSummary: { durationMs: 0 },
        exitReason: 'completed',
        events,
      }),
    };
  }
}

class BudgetProcess extends AgenticProcess<ProcessInput, DemoOutput, { usage: number }> {
  constructor() {
    super('budget-process', 'Budget Process', 'tests cost accounting');
  }

  protected buildPipeline(): ConstructionPipeline<ProcessInput, { usage: number }, DemoOutput> {
    return {
      initialState: () => ({ usage: 0 }),
      stages: [
        {
          id: 'usage-stage',
          mode: 'sequential',
          tasks: [
            {
              id: 'usage.task',
              run: async () => {
                this.recordUsage({ tokensUsed: 200 });
                return { usage: 200 };
              },
            },
          ],
        },
      ],
      finalize: async (_input, state, events) => ({
        value: state.usage,
        observations: { usage: state.usage },
        costSummary: { durationMs: 0, tokensUsed: state.usage },
        exitReason: 'completed',
        events,
      }),
    };
  }
}

describe('process constructions', () => {
  it('extracts incremental and block observations', async () => {
    const extractor = createObservationExtractionConstruction();
    const output = [
      'PATROL_OBS: {"type":"feature","feature":"query"}',
      'PATROL_OBSERVATION_JSON_START',
      '{"overallVerdict":{"npsScore":7}}',
      'PATROL_OBSERVATION_JSON_END',
    ].join('\n');

    const result = unwrapConstructionExecutionResult(await extractor.execute({ output }));
    expect(result.incrementalObservations).toHaveLength(1);
    expect(result.fullObservation?.overallVerdict).toBeTruthy();
  });

  it('runs patrol process in dry-run mode', async () => {
    const patrol = createPatrolProcessConstruction();
    const result = unwrapConstructionExecutionResult(await patrol.execute({
      mode: 'quick',
      dryRun: true,
    }));

    expect(result.report.kind).toBe('PatrolReport.v1');
    expect(result.exitReason).toBe('dry_run');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.policyEnforcement.enforcement).toBe('allowed');
    expect(result.policyEnforcement.requiredEvidenceMode).toBe('dry');
  });

  it('fails closed when release mode attempts dry-run bypass without wet evidence', async () => {
    const patrol = createPatrolProcessConstruction();
    const result = unwrapConstructionExecutionResult(await patrol.execute({
      mode: 'release',
      dryRun: true,
      policyTrigger: 'release',
    }));

    expect(result.exitReason).toBe('failed');
    expect(result.policyEnforcement.enforcement).toBe('blocked');
    expect(result.policyEnforcement.requiredEvidenceMode).toBe('wet');
    expect(result.findings.some((finding) => finding.category === 'policy')).toBe(true);
  });

  it('returns preset process plans in dry-run mode', async () => {
    const preset = createCodeReviewPipelineConstruction();
    const result = unwrapConstructionExecutionResult(await preset.execute({ dryRun: true }));

    expect(result.preset).toBe('code-review-pipeline');
    expect(result.executed).toBe(false);
    expect(result.stages.length).toBeGreaterThan(2);
  });

  it('guarantees cleanup execution even on failure', async () => {
    const demo = new DemoProcess();
    const result = unwrapConstructionExecutionResult(await demo.execute({ fail: true }));

    expect(result.exitReason).toBe('failed');
    expect(demo.getCleanupCount()).toBe(1);
  });

  it('records parallel stage metadata showing concurrent execution', async () => {
    const process = new ParallelDelayProcess();
    const result = unwrapConstructionExecutionResult(await process.execute({}));
    const parallelEvent = result.events.find(
      (event) => event.stage === 'parallel-stage' && event.type === 'stage_complete',
    );
    expect(result.exitReason).toBe('completed');
    expect(parallelEvent?.metadata?.durationMs).toBeLessThan(120);
    expect(parallelEvent?.metadata?.durationMs).toBeGreaterThanOrEqual(50);
  });

  it('enforces timeout budgets and emits timeout events', async () => {
    const process = new TimeoutProcess();
    const result = unwrapConstructionExecutionResult(await process.execute({ timeoutMs: 10 }));
    expect(result.exitReason).toBe('timeout');
    expect(process.getCleanupRuns()).toBe(1);
    expect(result.events.some((event) => event.type === 'timeout')).toBe(true);
    expect(result.events.some((event) => event.type === 'process_failed')).toBe(true);
  });

  it('terminates when token budget is exceeded', async () => {
    const process = new BudgetProcess();
    const result = unwrapConstructionExecutionResult(await process.execute({
      budget: { maxTokenBudget: 100 },
    }));
    expect(result.exitReason).toBe('budget_exceeded');
    expect(result.events.some((event) => event.type === 'budget_exceeded')).toBe(true);
    expect(result.events.some((event) => event.type === 'stage_failed')).toBe(true);
  });
});
