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
    const result = await patrol.execute({
      mode: 'quick',
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected dry-run patrol preview to be non-success');
    }
    expect(result.error.message).toContain('dry-run mode');
    expect(result.partial?.report.kind).toBe('PatrolReport.v1');
    expect(result.partial?.exitReason).toBe('dry_run');
    expect(Array.isArray(result.partial?.findings)).toBe(true);
    expect(result.partial?.policyEnforcement.enforcement).toBe('allowed');
    expect(result.partial?.policyEnforcement.requiredEvidenceMode).toBe('dry');
  });

  it('fails closed when release mode attempts dry-run bypass without wet evidence', async () => {
    const patrol = createPatrolProcessConstruction();
    const result = await patrol.execute({
      mode: 'release',
      dryRun: true,
      policyTrigger: 'release',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected patrol release bypass to fail closed');
    }
    expect(result.error.message).toContain('patrol_policy_fail_closed');
    expect(result.partial?.exitReason).toBe('failed');
    expect(result.partial?.policyEnforcement?.enforcement).toBe('blocked');
    expect(result.partial?.policyEnforcement?.requiredEvidenceMode).toBe('wet');
    expect(result.partial?.findings?.some((finding) => finding.category === 'policy')).toBe(true);
  });

  it('returns preset process plans in dry-run mode', async () => {
    const preset = createCodeReviewPipelineConstruction();
    const result = unwrapConstructionExecutionResult(await preset.execute({ dryRun: true }));

    expect(result.preset).toBe('code-review-pipeline');
    expect(result.executed).toBe(false);
    expect(result.stages.length).toBeGreaterThan(2);
  });

  it('fails presets closed when the dispatched command exits non-zero', async () => {
    const preset = createCodeReviewPipelineConstruction();
    const result = await preset.execute({
      dryRun: false,
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected preset failure');
    }
    expect(result.error.message).toContain('failed with exit code 1');
    expect(result.partial?.executed).toBe(true);
    expect(result.partial?.execution?.exitCode).toBe(1);
  });

  it('fails patrol process closed when the dispatched command exits non-zero', async () => {
    const patrol = createPatrolProcessConstruction();
    const result = await patrol.execute({
      mode: 'full',
      dryRun: false,
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      policyTrigger: 'manual',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected patrol process failure');
    }
    expect(result.error.message).toContain('failed with exit code 1');
    expect(result.partial?.exitReason).toBe('failed');
  });

  it('returns a successful outcome and guarantees cleanup execution on success', async () => {
    const demo = new DemoProcess();
    const result = await demo.execute({});

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected demo process success');
    }
    expect(result.value.exitReason).toBe('completed');
    expect(result.value.value).toBe(3);
    expect(demo.getCleanupCount()).toBe(1);
  });

  it('returns a failed construction outcome and guarantees cleanup execution on failure', async () => {
    const demo = new DemoProcess();
    const result = await demo.execute({ fail: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected demo process failure');
    }
    expect(result.error.message).toContain('boom');
    expect(result.partial?.exitReason).toBe('failed');
    expect(demo.getCleanupCount()).toBe(1);
  });
});
