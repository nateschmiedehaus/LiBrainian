import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import {
  recordAgenticFeedbackEvent,
  recordAgenticTaskOutcome,
} from '../../integration/agentic_metrics_store.js';
import { Stage5AgenticUtilityEvaluator } from '../staged_evaluators.js';
import type { EvaluationContext, Variant } from '../types.js';

function buildVariant(): Variant {
  return {
    id: 'variant-stage5-test',
    parentId: null,
    emitterId: 'test',
    createdAt: new Date().toISOString(),
    genotype: {},
    mutationDescription: 'test',
    evaluated: false,
  };
}

describe('Stage5AgenticUtilityEvaluator', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'librainian-stage5-agentic-'));
    dbPath = path.join(tempDir, 'librarian.sqlite');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns passed with measured utility metrics when outcomes exist', async () => {
    const storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
    await recordAgenticTaskOutcome(storage, {
      taskId: 'with-context',
      timestamp: new Date().toISOString(),
      success: true,
      contextProvided: true,
      durationMs: 90,
      contextUsefulness: 0.9,
      codeQualityScore: 0.9,
      decisionCorrect: true,
      missingContext: false,
    });
    await recordAgenticTaskOutcome(storage, {
      taskId: 'without-context',
      timestamp: new Date().toISOString(),
      success: false,
      contextProvided: false,
      durationMs: 180,
      contextUsefulness: 0,
      codeQualityScore: 0.3,
      decisionCorrect: false,
      missingContext: true,
    });
    await recordAgenticFeedbackEvent(storage, {
      queryId: 'q-stage5',
      timestamp: new Date().toISOString(),
      usefulnessMean: 0.8,
      totalRatings: 3,
      irrelevantRatings: 1,
      missingContext: false,
    });
    await storage.close();

    const evaluator = new Stage5AgenticUtilityEvaluator();
    const context: EvaluationContext = {
      workspaceRoot: tempDir,
      providerAvailable: false,
      dbPath,
      budget: {
        maxTokens: 1000,
        maxEmbeddings: 100,
        maxProviderCalls: 10,
        maxDurationMs: 60000,
      },
    };

    const result = await evaluator.run(buildVariant(), context);

    expect(result.status).toBe('passed');
    expect(result.metrics['task_completion_lift']).toBeTypeOf('number');
    expect(result.metrics['time_to_solution_reduction']).toBeTypeOf('number');
    expect(result.metrics['agent_satisfaction_score']).toBeTypeOf('number');
  });

  it('returns unverified_by_trace when no agentic data exists', async () => {
    const storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
    await storage.close();

    const evaluator = new Stage5AgenticUtilityEvaluator();
    const context: EvaluationContext = {
      workspaceRoot: tempDir,
      providerAvailable: true,
      dbPath,
      budget: {
        maxTokens: 1000,
        maxEmbeddings: 100,
        maxProviderCalls: 10,
        maxDurationMs: 60000,
      },
    };

    const result = await evaluator.run(buildVariant(), context);

    expect(result.status).toBe('unverified_by_trace');
    expect(String(result.reason)).toContain('agentic_utility_unmeasured');
  });
});
