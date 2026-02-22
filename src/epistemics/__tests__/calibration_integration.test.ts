import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConstructionCalibrationTracker } from '../../constructions/calibration_tracker.js';
import type { ConfidenceValue } from '../confidence.js';
import { createSessionId, SqliteEvidenceLedger } from '../evidence_ledger.js';
import {
  onContradictionResolved,
  recordCIOutcomes,
  recordHumanFeedbackOutcome,
} from '../calibration_integration.js';
import { resolveContradictionWithCalibration } from '../defeaters.js';

function measured(value: number): ConfidenceValue {
  const bounded = Math.max(0, Math.min(1, value));
  return {
    type: 'measured',
    value: bounded,
    measurement: {
      datasetId: 'test',
      sampleSize: 50,
      accuracy: bounded,
      confidenceInterval: [Math.max(0, bounded - 0.05), Math.min(1, bounded + 0.05)] as const,
      measuredAt: new Date().toISOString(),
    },
  };
}

describe('epistemics calibration integration', () => {
  let ledger: SqliteEvidenceLedger | undefined;

  afterEach(async () => {
    if (ledger) {
      await ledger.close();
      ledger = undefined;
    }
  });

  it('recordCIOutcomes records outcomes in tracker and writes ledger entries', async () => {
    ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
    const tracker = new ConstructionCalibrationTracker();

    tracker.recordPrediction('ci-construction', 'pred-ci-1', measured(0.75, 'seed'), 'claim');
    tracker.recordPrediction('ci-construction', 'pred-ci-2', measured(0.75, 'seed'), 'claim');

    const recorded = await recordCIOutcomes(
      createSessionId('sess_ci'),
      {
        runId: 'ci-run-42',
        passed: true,
        outcomes: [
          { predictionId: 'pred-ci-1', correct: true },
          { predictionId: 'pred-ci-2', correct: false },
        ],
      },
      ledger,
      tracker
    );

    expect(recorded).toBe(2);
    const counts = tracker.getPredictionCounts().get('ci-construction');
    expect(counts?.withOutcome).toBe(2);

    const entries = await ledger.query({
      kinds: ['outcome'],
      sessionId: createSessionId('sess_ci'),
    });
    expect(entries.length).toBe(2);
  });

  it('recordHumanFeedbackOutcome routes human resolution to tracker', async () => {
    ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
    const tracker = new ConstructionCalibrationTracker();

    tracker.recordPrediction('human-construction', 'pred-human-1', measured(0.6, 'seed'), 'claim');

    await recordHumanFeedbackOutcome(
      {
        predictionId: 'pred-human-1',
        outcome: 'confirmed',
        sessionId: createSessionId('sess_human'),
        comment: 'Looks correct',
      },
      tracker,
      ledger
    );

    const counts = tracker.getPredictionCounts().get('human-construction');
    expect(counts?.withOutcome).toBe(1);

    const entries = await ledger.query({
      kinds: ['outcome'],
      sessionId: createSessionId('sess_human'),
    });
    expect(entries.length).toBe(1);
    const payload = entries[0]?.payload as { verificationMethod?: string };
    expect(payload.verificationMethod).toBe('user_feedback');
  });

  it('onContradictionResolved records winner as correct and loser as incorrect', () => {
    const tracker = new ConstructionCalibrationTracker();
    tracker.recordPrediction('contradiction-construction', 'pred-win', measured(0.8, 'seed'), 'claim');
    tracker.recordPrediction('contradiction-construction', 'pred-lose', measured(0.8, 'seed'), 'claim');

    onContradictionResolved(
      {
        method: 'prefer_a',
        explanation: 'claim A is better supported',
        resolver: 'test',
        resolvedAt: new Date().toISOString(),
        tradeoff: 'favor precision over recall',
      },
      {
        winningPredictionId: 'pred-win',
        defeatedPredictionId: 'pred-lose',
      },
      tracker
    );

    const counts = tracker.getPredictionCounts().get('contradiction-construction');
    expect(counts?.withOutcome).toBe(2);
  });

  it('resolveContradictionWithCalibration calls contradiction handler and records outcomes', async () => {
    const tracker = new ConstructionCalibrationTracker();
    tracker.recordPrediction('contradiction-handler', 'pred-handler-win', measured(0.8), 'claim');
    tracker.recordPrediction('contradiction-handler', 'pred-handler-lose', measured(0.8), 'claim');

    const storage = {
      resolveContradiction: vi.fn().mockResolvedValue(undefined),
    };

    await resolveContradictionWithCalibration(
      storage as never,
      'contradiction-1',
      {
        method: 'prefer_a',
        explanation: 'resolved by handler',
        resolver: 'defeater-engine',
        resolvedAt: new Date().toISOString(),
        tradeoff: 'traceability',
      },
      tracker,
      {
        winningPredictionId: 'pred-handler-win',
        defeatedPredictionId: 'pred-handler-lose',
      }
    );

    expect(storage.resolveContradiction).toHaveBeenCalledOnce();
    const counts = tracker.getPredictionCounts().get('contradiction-handler');
    expect(counts?.withOutcome).toBe(2);
  });
});
