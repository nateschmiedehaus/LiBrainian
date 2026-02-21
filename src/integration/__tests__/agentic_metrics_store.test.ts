import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import {
  computeAgenticUtilitySnapshot,
  recordAgenticFeedbackEvent,
  recordAgenticTaskOutcome,
} from '../agentic_metrics_store.js';

describe('agentic metrics store', () => {
  let tempDir: string;
  let storage: LibrarianStorage;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'librainian-agentic-metrics-'));
    const dbPath = path.join(tempDir, 'librarian.sqlite');
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('computes all agentic utility metrics from persisted task/feedback history', async () => {
    await recordAgenticTaskOutcome(storage, {
      taskId: 'with-1',
      timestamp: new Date().toISOString(),
      success: true,
      contextProvided: true,
      durationMs: 100,
      contextUsefulness: 0.9,
      codeQualityScore: 0.9,
      decisionCorrect: true,
      missingContext: false,
    });
    await recordAgenticTaskOutcome(storage, {
      taskId: 'with-2',
      timestamp: new Date().toISOString(),
      success: true,
      contextProvided: true,
      durationMs: 120,
      contextUsefulness: 0.8,
      codeQualityScore: 0.85,
      decisionCorrect: true,
      missingContext: false,
    });
    await recordAgenticTaskOutcome(storage, {
      taskId: 'without-1',
      timestamp: new Date().toISOString(),
      success: true,
      contextProvided: false,
      durationMs: 220,
      contextUsefulness: 0,
      codeQualityScore: 0.6,
      decisionCorrect: false,
      missingContext: false,
    });
    await recordAgenticTaskOutcome(storage, {
      taskId: 'without-2',
      timestamp: new Date().toISOString(),
      success: false,
      contextProvided: false,
      durationMs: 260,
      contextUsefulness: 0,
      codeQualityScore: 0.4,
      decisionCorrect: false,
      missingContext: true,
    });

    await recordAgenticFeedbackEvent(storage, {
      queryId: 'q-1',
      timestamp: new Date().toISOString(),
      usefulnessMean: 0.85,
      totalRatings: 4,
      irrelevantRatings: 1,
      missingContext: false,
    });
    await recordAgenticFeedbackEvent(storage, {
      queryId: 'q-2',
      timestamp: new Date().toISOString(),
      usefulnessMean: 0.75,
      totalRatings: 2,
      irrelevantRatings: 0,
      missingContext: true,
    });

    const snapshot = await computeAgenticUtilitySnapshot(storage);

    expect(snapshot.measured).toBe(true);
    expect(snapshot.taskCount).toBe(4);
    expect(snapshot.feedbackCount).toBe(2);
    expect(snapshot.taskCompletionLift).toBeGreaterThan(0);
    expect(snapshot.timeToSolutionReduction).toBeGreaterThan(0);
    expect(snapshot.contextUsageRate).toBeGreaterThan(0);
    expect(snapshot.codeQualityLift).toBeGreaterThan(0);
    expect(snapshot.decisionAccuracy).toBeGreaterThan(0);
    expect(snapshot.agentSatisfactionScore).toBeGreaterThan(0.7);
    expect(snapshot.missingContextRate).toBeGreaterThan(0);
    expect(snapshot.irrelevantContextRate).toBeGreaterThanOrEqual(0);
  });

  it('returns an unmeasured snapshot when no outcomes/feedback are recorded', async () => {
    const snapshot = await computeAgenticUtilitySnapshot(storage);

    expect(snapshot.measured).toBe(false);
    expect(snapshot.reason).toBe('missing_task_and_feedback_data');
    expect(snapshot.taskCompletionLift).toBe(-1);
    expect(snapshot.agentSatisfactionScore).toBe(-1);
  });
});
