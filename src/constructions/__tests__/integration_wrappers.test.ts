import { describe, expect, it } from 'vitest';
import { getNumericValue, type ConfidenceValue } from '../../epistemics/confidence.js';
import { createSessionId, SqliteEvidenceLedger } from '../../epistemics/evidence_ledger.js';
import { ConstructionError, toEvidenceIds } from '../base/construction_base.js';
import { ConstructionCalibrationTracker } from '../calibration_tracker.js';
import { calibrated } from '../integration-wrappers.js';
import {
  unwrapConstructionExecutionResult,
  type Construction,
} from '../types.js';

type TestResult = {
  confidence: ConfidenceValue;
  evidenceRefs: ReturnType<typeof toEvidenceIds>;
  analysisTimeMs: number;
  predictionId?: string;
  actualCorrect?: boolean;
};

function measured(value: number): ConfidenceValue {
  const bounded = Math.max(0, Math.min(1, value));
  return {
    type: 'measured',
    value: bounded,
    measurement: {
      datasetId: 'test',
      sampleSize: 100,
      accuracy: bounded,
      confidenceInterval: [Math.max(0, bounded - 0.05), Math.min(1, bounded + 0.05)] as const,
      measuredAt: new Date().toISOString(),
    },
  };
}

function createBaseConstruction(id: string, confidence: number): Construction<number, TestResult, ConstructionError> {
  return {
    id,
    name: `Test(${id})`,
    async execute(input: number): Promise<TestResult> {
      return {
        confidence: measured(confidence),
        evidenceRefs: toEvidenceIds([`ev:${id}:${input}`]),
        analysisTimeMs: 1,
      };
    },
  };
}

describe('calibrated integration wrapper', () => {
  it('records prediction + immediate outcome and applies calibrated confidence when history >= 20', async () => {
    const tracker = new ConstructionCalibrationTracker();
    const constructionId = 'construction:immediate-calibration';

    for (let i = 0; i < 20; i += 1) {
      const predictionId = `seed-${i}`;
      tracker.recordPrediction(constructionId, predictionId, measured(0.9), 'seed');
      tracker.recordOutcome(predictionId, i % 2 === 0, 'test_result');
    }

    const wrapped = calibrated(
      createBaseConstruction(constructionId, 0.9),
      tracker,
      {
        immediateOutcomeExtractor: () => ({ correct: true, method: 'system_observation' }),
      }
    );

    const execution = unwrapConstructionExecutionResult(await wrapped.execute(1));
    expect(execution.predictionId).toBeTruthy();
    const confidence = getNumericValue(execution.confidence);
    expect(confidence).not.toBeNull();
    expect(confidence).not.toBeCloseTo(0.9, 4);

    const counts = tracker.getPredictionCounts().get(constructionId);
    expect(counts?.total).toBe(21);
    expect(counts?.withOutcome).toBe(21);
  });

  it('keeps raw confidence unchanged when history is below 20 outcomes', async () => {
    const tracker = new ConstructionCalibrationTracker();
    const constructionId = 'construction:insufficient-history';

    for (let i = 0; i < 10; i += 1) {
      const predictionId = `seed-${i}`;
      tracker.recordPrediction(constructionId, predictionId, measured(0.7), 'seed');
      tracker.recordOutcome(predictionId, true, 'test_result');
    }

    const wrapped = calibrated(createBaseConstruction(constructionId, 0.7), tracker);
    const execution = unwrapConstructionExecutionResult(await wrapped.execute(1));

    const confidence = getNumericValue(execution.confidence);
    expect(confidence).toBeCloseTo(0.7, 4);
  });

  it('routes ledger outcome entries to tracker.recordOutcome', async () => {
    const ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
    const tracker = new ConstructionCalibrationTracker();
    const constructionId = 'construction:ledger-routing';

    const base: Construction<number, TestResult, ConstructionError> = {
      id: constructionId,
      name: 'LedgerRouting',
      async execute(input: number): Promise<TestResult> {
        return {
          confidence: measured(0.6),
          evidenceRefs: toEvidenceIds(['ev:shared']),
          analysisTimeMs: input,
        };
      },
    };

    const wrapped = calibrated(base, tracker, {
      ledger,
      outcomeEventTypes: ['outcome'],
    });
    const execution = unwrapConstructionExecutionResult(await wrapped.execute(7));
    const predictionId = execution.predictionId;
    expect(predictionId).toBeTruthy();

    await ledger.append({
      kind: 'outcome',
      payload: {
        predictionId: predictionId!,
        predicted: {
          claim: 'ledger result',
          confidence: measured(0.6),
        },
        actual: {
          outcome: 'correct',
          observation: 'verified',
        },
        verificationMethod: 'system_observation',
      },
      provenance: {
        source: 'system_observation',
        method: 'ledger_test',
      },
      relatedEntries: ['ev:shared'],
      sessionId: createSessionId('sess_ledger'),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const counts = tracker.getPredictionCounts().get(constructionId);
    expect(counts?.total).toBe(1);
    expect(counts?.withOutcome).toBe(1);

    await ledger.close();
  });

  it('produces meaningful calibration report after 25 deterministic outcomes', async () => {
    const tracker = new ConstructionCalibrationTracker();
    const constructionId = 'construction:report-25';
    let runCount = 0;

    const base: Construction<number, TestResult, ConstructionError> = {
      id: constructionId,
      name: 'DeterministicOutcomes',
      async execute(): Promise<TestResult> {
        runCount += 1;
        return {
          confidence: measured(0.8),
          evidenceRefs: toEvidenceIds([`ev:${runCount}`]),
          analysisTimeMs: 1,
          actualCorrect: runCount <= 15, // 60% true while confidence says 80%
        };
      },
    };

    const wrapped = calibrated(base, tracker, {
      immediateOutcomeExtractor: (output) => ({
        correct: output.actualCorrect === true,
        method: 'system_observation',
      }),
    });

    for (let i = 0; i < 25; i += 1) {
      await wrapped.execute(i);
    }

    const report = tracker.getCalibrationReport(constructionId, { minSamples: 20 });
    expect(report.sampleCount).toBe(25);
    expect(report.ece).toBeGreaterThan(0.15);
    expect(report.buckets.some((bucket) => bucket.sampleSize > 0)).toBe(true);
  });
});
