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
});
