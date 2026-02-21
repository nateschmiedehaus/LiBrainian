/**
 * @fileoverview Stage Calibration Wiring
 *
 * Provides calibration tracking for stage runners in query.ts.
 * This module bridges the gap between:
 * - ConstructionCalibrationTracker (well-designed but unused)
 * - Stage runners (inline implementations without calibration)
 *
 * USAGE PATTERN:
 * ```typescript
 * import { recordStagePrediction, recordStageOutcome } from './stage_calibration.js';
 *
 * async function runSomeStage(options) {
 *   const predictionId = recordStagePrediction(
 *     'refactoring-safety-stage',
 *     0.75,
 *     'Refactoring of ${target} is safe',
 *     { target }
 *   );
 *
 *   // ... do the stage work ...
 *
 *   return {
 *     ...result,
 *     predictionId, // Include for outcome tracking
 *   };
 * }
 * ```
 *
 * OUTCOME RECORDING:
 * Outcomes are recorded via:
 * 1. Direct call to recordStageOutcome() when outcome is known
 * 2. FeedbackLoop integration when task completes
 * 3. Agent hooks when agent reports success/failure
 *
 * @packageDocumentation
 */

import {
  ConstructionCalibrationTracker,
  createConstructionCalibrationTracker,
  generatePredictionId,
  type VerificationMethod,
} from '../constructions/calibration_tracker.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { bounded } from '../epistemics/confidence.js';
import type { IEvidenceLedger } from '../epistemics/evidence_ledger.js';
import { logInfo, logWarning } from '../telemetry/logger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata about a stage prediction for tracking.
 */
export interface StagePredictionContext {
  /** The stage name/ID making the prediction */
  stageId: string;
  /** Query intent that triggered this stage */
  queryIntent?: string;
  /** The target entity being analyzed (if applicable) */
  target?: string;
  /** Check types for security audits */
  checkTypes?: string[];
  /** Additional context for debugging */
  [key: string]: unknown;
}

/**
 * Result of recording a stage prediction.
 */
export interface StagePredictionResult {
  /** Unique prediction ID for outcome recording */
  predictionId: string;
  /** Whether the prediction was actually recorded */
  recorded: boolean;
}

/**
 * Tracked stage info for pending outcomes.
 */
interface PendingStageOutcome {
  stageId: string;
  predictionId: string;
  confidence: number;
  claim: string;
  recordedAt: Date;
  queryId?: string;
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

/** Global calibration tracker singleton */
let globalTracker: ConstructionCalibrationTracker | null = null;

/** Pending outcomes awaiting verification */
const pendingOutcomes = new Map<string, PendingStageOutcome>();

/** Track prediction IDs by query ID for batch outcome recording */
const queryPredictions = new Map<string, Set<string>>();

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the stage calibration system.
 *
 * Call this during LiBrainian initialization to enable calibration tracking.
 * If not called, predictions will be generated but not recorded.
 *
 * @param ledger - Optional evidence ledger for persistence
 */
export function initStageCalibration(ledger?: IEvidenceLedger): void {
  globalTracker = createConstructionCalibrationTracker(ledger);
  logInfo('[stage_calibration] Initialized stage calibration tracker', {
    hasLedger: !!ledger,
  });
}

/**
 * Get the global calibration tracker.
 *
 * @returns The tracker or null if not initialized
 */
export function getStageCalibrationTracker(): ConstructionCalibrationTracker | null {
  return globalTracker;
}

/**
 * Check if stage calibration is enabled.
 */
export function isStageCalibrationEnabled(): boolean {
  return globalTracker !== null;
}

// ============================================================================
// PREDICTION RECORDING
// ============================================================================

/**
 * Record a prediction from a stage runner.
 *
 * This is the primary entry point for stage runners to record predictions.
 * Predictions are tracked to measure calibration (stated vs actual accuracy).
 *
 * @param stageId - ID of the stage (e.g., 'refactoring-safety-stage')
 * @param confidence - Confidence value (0-1) or ConfidenceValue
 * @param claim - What the stage is claiming (e.g., 'Refactoring is safe')
 * @param context - Optional additional context
 * @param queryId - Optional query ID for batch outcome recording
 * @returns Prediction result with ID
 *
 * @example
 * ```typescript
 * const { predictionId } = recordStagePrediction(
 *   'security-audit-stage',
 *   0.85,
 *   'No critical vulnerabilities detected',
 *   { target: 'src/auth' },
 *   queryId
 * );
 * ```
 */
export function recordStagePrediction(
  stageId: string,
  confidence: number | ConfidenceValue,
  claim: string,
  context?: StagePredictionContext,
  queryId?: string
): StagePredictionResult {
  const predictionId = generatePredictionId(stageId);

  // Convert numeric confidence to ConfidenceValue
  const confidenceValue: ConfidenceValue =
    typeof confidence === 'number'
      ? bounded(
          Math.max(0, confidence - 0.1),
          Math.min(1, confidence + 0.1),
          'theoretical',
          `${stageId}_estimate`
        )
      : confidence;

  // Always generate the prediction ID (for tracking even without recording)
  const result: StagePredictionResult = {
    predictionId,
    recorded: false,
  };

  // Record to global tracker if available
  if (globalTracker) {
    try {
      globalTracker.recordPrediction(
        stageId,
        predictionId,
        confidenceValue,
        claim,
        {
          ...context,
          queryId,
          recordedAt: new Date().toISOString(),
        }
      );
      result.recorded = true;

      logInfo('[stage_calibration] Recorded prediction', {
        stageId,
        predictionId,
        confidence: typeof confidence === 'number' ? confidence : 'complex',
        claimPreview: claim.slice(0, 50),
      });
    } catch (error) {
      logWarning('[stage_calibration] Failed to record prediction', {
        stageId,
        predictionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Track for pending outcome
  const numericConfidence =
    typeof confidence === 'number'
      ? confidence
      : 0.5; // Default if complex confidence

  pendingOutcomes.set(predictionId, {
    stageId,
    predictionId,
    confidence: numericConfidence,
    claim,
    recordedAt: new Date(),
    queryId,
  });

  // Track by query ID for batch operations
  if (queryId) {
    const queryPreds = queryPredictions.get(queryId) ?? new Set();
    queryPreds.add(predictionId);
    queryPredictions.set(queryId, queryPreds);
  }

  return result;
}

// ============================================================================
// OUTCOME RECORDING
// ============================================================================

/**
 * Record the outcome for a stage prediction.
 *
 * Call this when the actual outcome of a prediction is known.
 *
 * @param predictionId - The prediction ID from recordStagePrediction
 * @param correct - Whether the prediction was correct
 * @param verificationMethod - How the outcome was verified
 * @param observation - Optional observation about the outcome
 */
export function recordStageOutcome(
  predictionId: string,
  correct: boolean,
  verificationMethod: VerificationMethod = 'system_observation',
  observation?: string
): void {
  const pending = pendingOutcomes.get(predictionId);
  if (!pending) {
    logWarning('[stage_calibration] Outcome for unknown prediction', {
      predictionId,
    });
    return;
  }

  // Record to global tracker if available
  if (globalTracker) {
    try {
      globalTracker.recordOutcome(predictionId, correct, verificationMethod);

      logInfo('[stage_calibration] Recorded outcome', {
        predictionId,
        stageId: pending.stageId,
        correct,
        verificationMethod,
      });
    } catch (error) {
      logWarning('[stage_calibration] Failed to record outcome', {
        predictionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Remove from pending
  pendingOutcomes.delete(predictionId);

  // Remove from query predictions
  if (pending.queryId) {
    const queryPreds = queryPredictions.get(pending.queryId);
    if (queryPreds) {
      queryPreds.delete(predictionId);
      if (queryPreds.size === 0) {
        queryPredictions.delete(pending.queryId);
      }
    }
  }
}

/**
 * Record outcomes for all predictions from a query.
 *
 * This is useful when recording outcomes in batch from feedback loops.
 *
 * @param queryId - The query ID
 * @param success - Whether the overall query/task was successful
 * @param verificationMethod - How the outcome was verified
 */
export function recordQueryOutcomes(
  queryId: string,
  success: boolean,
  verificationMethod: VerificationMethod = 'user_feedback'
): void {
  const predictionIds = queryPredictions.get(queryId);
  if (!predictionIds || predictionIds.size === 0) {
    return;
  }

  logInfo('[stage_calibration] Recording batch outcomes for query', {
    queryId,
    predictionCount: predictionIds.size,
    success,
  });

  for (const predictionId of predictionIds) {
    recordStageOutcome(predictionId, success, verificationMethod);
  }
}

// ============================================================================
// STATISTICS AND MONITORING
// ============================================================================

/**
 * Get pending outcome statistics.
 */
export function getPendingOutcomeStats(): {
  pendingCount: number;
  queriesWithPending: number;
  oldestPendingMs: number | null;
} {
  const now = Date.now();
  let oldestMs: number | null = null;

  for (const pending of pendingOutcomes.values()) {
    const ageMs = now - pending.recordedAt.getTime();
    if (oldestMs === null || ageMs > oldestMs) {
      oldestMs = ageMs;
    }
  }

  return {
    pendingCount: pendingOutcomes.size,
    queriesWithPending: queryPredictions.size,
    oldestPendingMs: oldestMs,
  };
}

/**
 * Get calibration report for a stage.
 *
 * @param stageId - The stage ID to get calibration for
 */
export function getStageCalibration(stageId: string) {
  if (!globalTracker) {
    return null;
  }
  return globalTracker.getCalibration(stageId);
}

/**
 * Get calibration alerts for all stages.
 *
 * @param threshold - ECE threshold for alerts (default: 0.10)
 */
export function getStageCalibrationAlerts(threshold = 0.10) {
  if (!globalTracker) {
    return [];
  }
  return globalTracker.getAlerts(threshold);
}

/**
 * Get prediction counts by stage.
 */
export function getStagePredictionCounts() {
  if (!globalTracker) {
    return new Map<string, { total: number; withOutcome: number }>();
  }
  return globalTracker.getPredictionCounts();
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clear stale pending outcomes older than the specified age.
 *
 * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 * @returns Number of cleared outcomes
 */
export function clearStalePendingOutcomes(maxAgeMs = 60 * 60 * 1000): number {
  const now = Date.now();
  let cleared = 0;

  for (const [predictionId, pending] of pendingOutcomes.entries()) {
    const ageMs = now - pending.recordedAt.getTime();
    if (ageMs > maxAgeMs) {
      pendingOutcomes.delete(predictionId);
      cleared++;

      // Clean up query predictions
      if (pending.queryId) {
        const queryPreds = queryPredictions.get(pending.queryId);
        if (queryPreds) {
          queryPreds.delete(predictionId);
          if (queryPreds.size === 0) {
            queryPredictions.delete(pending.queryId);
          }
        }
      }
    }
  }

  if (cleared > 0) {
    logInfo('[stage_calibration] Cleared stale pending outcomes', { cleared });
  }

  return cleared;
}

/**
 * Reset all calibration state (for testing).
 */
export function resetStageCalibration(): void {
  globalTracker?.clear();
  pendingOutcomes.clear();
  queryPredictions.clear();
}
