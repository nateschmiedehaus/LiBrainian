import { absent, deterministic } from './confidence.js';
import type { ContradictionResolution } from './types.js';
import type { SessionId, IEvidenceLedger, OutcomeEvidence, EvidenceId } from './evidence_ledger.js';
import type {
  ConstructionCalibrationTracker,
  VerificationMethod,
} from '../constructions/calibration_tracker.js';

export interface CIOutcomeRecord {
  readonly predictionId: string;
  readonly correct: boolean;
}

export interface CITestResult {
  readonly runId: string;
  readonly passed: boolean;
  readonly outcomes: readonly CIOutcomeRecord[];
}

export interface HumanFeedbackResolution {
  readonly predictionId: string;
  readonly outcome: 'confirmed' | 'proceed' | 'success' | 'rejected' | 'abort' | 'failure' | 'partial';
  readonly sessionId?: SessionId;
  readonly comment?: string;
}

export interface ContradictionCalibrationResolution {
  readonly winningPredictionId?: string;
  readonly defeatedPredictionId?: string;
}

function safeRecordOutcome(
  tracker: ConstructionCalibrationTracker,
  predictionId: string,
  correct: boolean,
  method: VerificationMethod,
): void {
  try {
    tracker.recordOutcome(predictionId, correct, method);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already recorded')) {
      return;
    }
    throw error;
  }
}

/**
 * Record CI outcomes for prediction IDs and emit corresponding ledger entries.
 */
export async function recordCIOutcomes(
  sessionId: SessionId,
  testResult: CITestResult,
  ledger: IEvidenceLedger,
  tracker: ConstructionCalibrationTracker
): Promise<number> {
  let recorded = 0;
  for (const outcome of testResult.outcomes) {
    safeRecordOutcome(tracker, outcome.predictionId, outcome.correct, 'test_result');
    recorded += 1;

    await ledger.append({
      kind: 'outcome',
      payload: {
        predictionId: outcome.predictionId as EvidenceId,
        predicted: {
          claim: `CI verification for prediction ${outcome.predictionId}`,
          confidence: absent('insufficient_data'),
        },
        actual: {
          outcome: outcome.correct ? 'correct' : 'incorrect',
          observation: `CI run ${testResult.runId} (${testResult.passed ? 'passed' : 'failed'})`,
        },
        verificationMethod: 'test_result',
      } satisfies OutcomeEvidence,
      provenance: {
        source: 'system_observation',
        method: 'ci_test_result',
      },
      relatedEntries: [],
      confidence: deterministic(true, 'ci_outcome_recorded'),
      sessionId,
    });
  }
  return recorded;
}

/**
 * Record user confirmation/rejection outcomes for a prediction.
 */
export async function recordHumanFeedbackOutcome(
  input: HumanFeedbackResolution,
  tracker: ConstructionCalibrationTracker,
  ledger?: IEvidenceLedger
): Promise<void> {
  const positiveOutcome =
    input.outcome === 'confirmed'
    || input.outcome === 'proceed'
    || input.outcome === 'success';
  safeRecordOutcome(tracker, input.predictionId, positiveOutcome, 'user_feedback');

  if (ledger) {
    await ledger.append({
      kind: 'outcome',
      payload: {
        predictionId: input.predictionId as EvidenceId,
        predicted: {
          claim: `Human review outcome for prediction ${input.predictionId}`,
          confidence: absent('insufficient_data'),
        },
        actual: {
          outcome: positiveOutcome ? 'correct' : 'incorrect',
          observation: input.comment ?? `human_feedback:${input.outcome}`,
        },
        verificationMethod: 'user_feedback',
      },
      provenance: {
        source: 'user_input',
        method: 'human_feedback',
      },
      relatedEntries: [],
      confidence: deterministic(true, 'human_feedback_recorded'),
      sessionId: input.sessionId,
    });
  }
}

/**
 * Route contradiction resolution winners/losers to calibration outcomes.
 */
export function onContradictionResolved(
  _resolution: ContradictionResolution,
  calibration: ContradictionCalibrationResolution,
  tracker: ConstructionCalibrationTracker
): void {
  if (calibration.winningPredictionId) {
    safeRecordOutcome(tracker, calibration.winningPredictionId, true, 'system_observation');
  }
  if (calibration.defeatedPredictionId) {
    safeRecordOutcome(tracker, calibration.defeatedPredictionId, false, 'system_observation');
  }
}
