import { absent, getNumericValue } from '../epistemics/confidence.js';
import type {
  EvidenceEntry,
  EvidenceFilter,
  FeedbackEvidence,
  IEvidenceLedger,
  OutcomeEvidence,
  VerificationEvidence,
} from '../epistemics/evidence_ledger.js';
import { getRelatedIds } from '../epistemics/evidence_ledger.js';
import { ConstructionError } from './base/construction_base.js';
import type { ConstructionResult } from './base/construction_base.js';
import type { ConstructionCalibrationTracker, VerificationMethod } from './calibration_tracker.js';
import { generatePredictionId } from './calibration_tracker.js';
import type {
  Construction,
  ConstructionExecutionResult,
  ConstructionOutcome,
  Context,
} from './types.js';
import { fail, isConstructionOutcome, ok } from './types.js';

type LedgerOutcomeEventType = 'outcome' | 'feedback' | 'verification';

export interface ImmediateConstructionOutcome {
  readonly correct: boolean;
  readonly method: VerificationMethod;
}

export interface CalibratedOptions<O extends ConstructionResult> {
  readonly immediateOutcomeExtractor?: (output: O) => ImmediateConstructionOutcome | null;
  readonly ledger?: IEvidenceLedger;
  readonly outcomeEventTypes?: readonly LedgerOutcomeEventType[];
  readonly minPredictionsForCalibration?: number;
}

type PendingLedgerOutcome = {
  readonly predictionId: string;
  readonly evidenceRefs: Set<string>;
};

function toOutcome<O, E extends ConstructionError>(
  execution: ConstructionExecutionResult<O, E>
): ConstructionOutcome<O, E> {
  return isConstructionOutcome<O, E>(execution)
    ? execution
    : ok<O, E>(execution as O);
}

function normalizeFailure(error: unknown, constructionId: string): ConstructionError {
  if (error instanceof ConstructionError) {
    return error;
  }
  if (error instanceof Error) {
    return new ConstructionError(error.message, constructionId, error);
  }
  return new ConstructionError(`Non-error construction failure: ${String(error)}`, constructionId);
}

function normalizeVerificationMethod(method: string): VerificationMethod {
  if (method === 'user_feedback' || method === 'test_result' || method === 'system_observation') {
    return method;
  }
  return 'system_observation';
}

function tryRecordOutcome(
  tracker: ConstructionCalibrationTracker,
  predictionId: string,
  correct: boolean,
  verificationMethod: VerificationMethod,
): void {
  try {
    tracker.recordOutcome(predictionId, correct, verificationMethod);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already recorded')) {
      return;
    }
    throw error;
  }
}

function hasEvidenceReference(entry: EvidenceEntry, evidenceRefs: Set<string>): boolean {
  if (evidenceRefs.size === 0) {
    return false;
  }
  const related = getRelatedIds(entry);
  return related.some((id) => evidenceRefs.has(id));
}

function extractOutcomeFromLedgerEntry(
  entry: EvidenceEntry,
  pending: PendingLedgerOutcome
): ImmediateConstructionOutcome | null {
  if (entry.kind === 'outcome') {
    const payload = entry.payload as OutcomeEvidence;
    const payloadPredictionId = String(payload.predictionId);
    const matchesPrediction = payloadPredictionId === pending.predictionId;
    const matchesEvidenceRefs = hasEvidenceReference(entry, pending.evidenceRefs);
    if (!matchesPrediction && !matchesEvidenceRefs) {
      return null;
    }
    if (payload.actual.outcome === 'correct') {
      return {
        correct: true,
        method: normalizeVerificationMethod(payload.verificationMethod),
      };
    }
    if (payload.actual.outcome === 'incorrect') {
      return {
        correct: false,
        method: normalizeVerificationMethod(payload.verificationMethod),
      };
    }
    return null;
  }

  if (entry.kind === 'feedback') {
    const payload = entry.payload as FeedbackEvidence;
    const targetMatches = pending.evidenceRefs.has(String(payload.targetId));
    const relatedMatches = hasEvidenceReference(entry, pending.evidenceRefs);
    if (!targetMatches && !relatedMatches) {
      return null;
    }
    if (payload.feedbackType === 'correct' || payload.feedbackType === 'helpful') {
      return { correct: true, method: 'user_feedback' };
    }
    if (
      payload.feedbackType === 'incorrect'
      || payload.feedbackType === 'unhelpful'
      || payload.feedbackType === 'unclear'
    ) {
      return { correct: false, method: 'user_feedback' };
    }
    return null;
  }

  if (entry.kind === 'verification') {
    const payload = entry.payload as VerificationEvidence;
    const claimIdMatches = pending.evidenceRefs.has(String(payload.claimId));
    const relatedMatches = hasEvidenceReference(entry, pending.evidenceRefs);
    if (!claimIdMatches && !relatedMatches) {
      return null;
    }
    if (payload.result === 'verified') {
      return { correct: true, method: 'system_observation' };
    }
    if (payload.result === 'refuted') {
      return { correct: false, method: 'system_observation' };
    }
    return null;
  }

  return null;
}

function createCalibratedConfidence(
  constructionId: string,
  calibratedValue: number,
  sampleCount: number
): ConstructionResult['confidence'] {
  const low = Math.max(0, calibratedValue - 0.05);
  const high = Math.min(1, calibratedValue + 0.05);
  return {
    type: 'measured',
    value: calibratedValue,
    measurement: {
      datasetId: `construction:${constructionId}`,
      sampleSize: sampleCount,
      accuracy: calibratedValue,
      confidenceInterval: [low, high] as const,
      measuredAt: new Date().toISOString(),
    },
  };
}

/**
 * Wrap a construction with automatic prediction/outcome calibration wiring.
 */
export function calibrated<I, O extends ConstructionResult, E extends ConstructionError, R>(
  construction: Construction<I, O, E, R>,
  tracker: ConstructionCalibrationTracker,
  options: CalibratedOptions<O> = {}
): Construction<I, ConstructionExecutionResult<O, E>, E, R> {
  const minPredictions = Math.max(1, options.minPredictionsForCalibration ?? 20);
  const outcomeEventTypes = options.outcomeEventTypes ?? ['outcome', 'feedback', 'verification'];
  const pendingByPrediction = new Map<string, PendingLedgerOutcome>();
  let subscribed = false;

  const ensureLedgerSubscription = (): void => {
    if (subscribed || !options.ledger) {
      return;
    }
    const filter: EvidenceFilter = {
      kinds: [...outcomeEventTypes],
    };
    options.ledger.subscribe(filter, (entry: EvidenceEntry) => {
      for (const pending of pendingByPrediction.values()) {
        const outcome = extractOutcomeFromLedgerEntry(entry, pending);
        if (!outcome) {
          continue;
        }
        tryRecordOutcome(tracker, pending.predictionId, outcome.correct, outcome.method);
        pendingByPrediction.delete(pending.predictionId);
      }
    });
    subscribed = true;
  };

  return {
    ...construction,
    id: `calibrated(${construction.id})`,
    async execute(input: I, context?: Context<R>): Promise<ConstructionExecutionResult<O, E>> {
      const predictionId = generatePredictionId(construction.id);
      let outcome: ConstructionOutcome<O, E>;

      try {
        const execution = await construction.execute(input, context);
        outcome = toOutcome<O, E>(execution);
      } catch (error) {
        const normalized = normalizeFailure(error, construction.id) as E;
        tracker.recordPrediction(
          construction.id,
          predictionId,
          absent('insufficient_data'),
          `Execution failed before producing result: ${construction.id}`,
          {
            reason: normalized.message,
            phase: 'execution_failure',
          }
        );
        tryRecordOutcome(tracker, predictionId, false, 'system_observation');
        return fail<O, E>(normalized, undefined, construction.id);
      }

      if (!outcome.ok) {
        tracker.recordPrediction(
          construction.id,
          predictionId,
          absent('insufficient_data'),
          `Execution returned failure outcome: ${construction.id}`,
          {
            reason: outcome.error.message,
            phase: 'construction_failure_outcome',
          }
        );
        tryRecordOutcome(tracker, predictionId, false, 'system_observation');
        return fail<O, E>(outcome.error, outcome.partial, outcome.errorAt ?? construction.id);
      }

      const resultWithPrediction: O = {
        ...outcome.value,
        predictionId,
      };

      tracker.recordPrediction(
        construction.id,
        predictionId,
        resultWithPrediction.confidence,
        `${construction.name} execution`,
        {
          sessionId: context?.sessionId,
          constructionId: construction.id,
        }
      );

      const rawConfidence = getNumericValue(resultWithPrediction.confidence);
      if (rawConfidence !== null) {
        const calibratedValue = tracker.getCalibratedConfidence(
          construction.id,
          rawConfidence,
          minPredictions,
        );
        if (calibratedValue !== null) {
          const report = tracker.getCalibrationReport(construction.id, { minSamples: minPredictions });
          resultWithPrediction.confidence = createCalibratedConfidence(
            construction.id,
            calibratedValue,
            report.sampleCount,
          );
        }
      }

      if (options.immediateOutcomeExtractor) {
        const immediate = options.immediateOutcomeExtractor(resultWithPrediction);
        if (immediate) {
          tryRecordOutcome(tracker, predictionId, immediate.correct, immediate.method);
        }
      }

      if (options.ledger) {
        ensureLedgerSubscription();
        pendingByPrediction.set(predictionId, {
          predictionId,
          evidenceRefs: new Set(resultWithPrediction.evidenceRefs.map((entry) => String(entry))),
        });
      }

      return resultWithPrediction;
    },
  };
}
