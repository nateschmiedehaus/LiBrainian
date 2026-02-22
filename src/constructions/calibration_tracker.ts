/**
 * @fileoverview Construction Calibration Tracker
 *
 * Tracks calibration (stated confidence vs actual accuracy) for constructions.
 * This enables measuring whether a construction's confidence values match reality.
 *
 * PHILOSOPHICAL ALIGNMENT (UNDERSTANDING_LAYER.md):
 * Confidence scores must be calibrated against empirical accuracy.
 * A claim with 80% confidence should be correct ~80% of the time.
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from '../epistemics/confidence.js';
import { getNumericValue } from '../epistemics/confidence.js';
import type { CalibrationBucket, CalibrationClaim, Scope } from '../measurement/calibration.js';
import {
  computeCalibrationReport,
  DEFAULT_BUCKETS,
  CALIBRATION_TARGETS,
} from '../measurement/calibration.js';
import type {
  IEvidenceLedger,
  EvidenceEntry,
  EvidenceId,
  OutcomeEvidence,
} from '../epistemics/evidence_ledger.js';
import { deterministic } from '../epistemics/confidence.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A tracked prediction from a construction.
 */
export interface ConstructionPrediction {
  /** Unique prediction ID */
  predictionId: string;
  /** Construction that made the prediction */
  constructionId: string;
  /** The claim being made */
  claim: string;
  /** Stated confidence */
  confidence: ConfidenceValue;
  /** When the prediction was made */
  timestamp: Date;
  /** Optional context/metadata */
  context?: Record<string, unknown>;
}

/**
 * Verification method for recording outcomes.
 * Must match the OutcomeEvidence verificationMethod type from evidence_ledger.
 */
export type VerificationMethod = 'user_feedback' | 'test_result' | 'system_observation';

/**
 * Calibration report for a specific construction.
 */
export interface ConstructionCalibrationReport {
  /** Construction being measured */
  constructionId: string;
  /** Number of predictions with outcomes */
  sampleCount: number;
  /** Expected Calibration Error (weighted mean |stated - actual|) */
  ece: number;
  /** Per-bucket analysis */
  buckets: CalibrationBucket[];
  /** Trend compared to previous measurement */
  trend: 'improving' | 'stable' | 'degrading';
  /** When this report was generated */
  lastUpdated: Date;
  /** Recommendations based on calibration analysis */
  recommendations: string[];
}

/**
 * Alert for miscalibrated constructions.
 */
export interface CalibrationAlert {
  /** Construction that is miscalibrated */
  constructionId: string;
  /** Current ECE value */
  ece: number;
  /** Threshold that was exceeded */
  threshold: number;
  /** Severity of miscalibration */
  severity: 'warning' | 'critical';
  /** Description of the issue */
  message: string;
  /** Buckets that are particularly miscalibrated */
  problemBuckets: string[];
}

/**
 * Options for calibration analysis.
 */
export interface CalibrationOptions {
  /** Minimum predictions required for analysis (default: 10) */
  minSamples?: number;
  /** Time range for analysis */
  timeRange?: {
    from?: Date;
    to?: Date;
  };
}

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

interface StoredPrediction extends ConstructionPrediction {
  outcome?: {
    correct: boolean;
    verificationMethod: VerificationMethod;
    recordedAt: Date;
  };
}

interface ConstructionHistory {
  previousEce?: number;
  lastReportDate?: Date;
}

// ============================================================================
// CONSTRUCTION CALIBRATION TRACKER
// ============================================================================

/**
 * Tracks calibration for constructions - measuring whether stated confidence
 * matches actual accuracy over time.
 *
 * Usage:
 * ```typescript
 * const tracker = new ConstructionCalibrationTracker();
 *
 * // After a construction outputs a prediction
 * tracker.recordPrediction('RefactoringSafetyChecker', 'pred-123', confidence, 'Refactoring is safe');
 *
 * // Later, when outcome is known
 * tracker.recordOutcome('pred-123', true, 'test_result');
 *
 * // Get calibration report
 * const report = tracker.getCalibration('RefactoringSafetyChecker');
 * console.log(`ECE: ${report.ece}`);
 * ```
 *
 * INVARIANT: Predictions are immutable once recorded
 * INVARIANT: Outcomes can only be recorded once per prediction
 */
export class ConstructionCalibrationTracker {
  private predictions: Map<string, StoredPrediction> = new Map();
  private constructionHistory: Map<string, ConstructionHistory> = new Map();
  private ledger?: IEvidenceLedger;

  /**
   * Create a tracker, optionally backed by an evidence ledger.
   *
   * @param ledger - Optional evidence ledger for persistence
   */
  constructor(ledger?: IEvidenceLedger) {
    this.ledger = ledger;
  }

  /**
   * Record a prediction from a construction.
   *
   * @param constructionId - ID of the construction (e.g., 'RefactoringSafetyChecker')
   * @param predictionId - Unique ID for this prediction
   * @param confidence - The stated confidence value
   * @param claim - Description of what is being predicted
   * @param context - Optional additional context
   */
  recordPrediction(
    constructionId: string,
    predictionId: string,
    confidence: ConfidenceValue,
    claim: string,
    context?: Record<string, unknown>
  ): void {
    if (this.predictions.has(predictionId)) {
      throw new Error(`Prediction ${predictionId} already recorded`);
    }

    const prediction: StoredPrediction = {
      predictionId,
      constructionId,
      claim,
      confidence,
      timestamp: new Date(),
      context,
    };

    this.predictions.set(predictionId, prediction);

    // Record to ledger if available
    if (this.ledger) {
      this.recordPredictionToLedger(prediction).catch((err) => {
        console.warn(`Failed to record prediction to ledger: ${err}`);
      });
    }
  }

  /**
   * Record the actual outcome for a prediction.
   *
   * @param predictionId - ID of the prediction
   * @param correct - Whether the prediction was correct
   * @param verificationMethod - How the outcome was verified
   */
  recordOutcome(
    predictionId: string,
    correct: boolean,
    verificationMethod: VerificationMethod
  ): void {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) {
      throw new Error(`Prediction ${predictionId} not found`);
    }

    if (prediction.outcome) {
      throw new Error(`Outcome for ${predictionId} already recorded`);
    }

    prediction.outcome = {
      correct,
      verificationMethod,
      recordedAt: new Date(),
    };

    // Record to ledger if available
    if (this.ledger) {
      this.recordOutcomeToLedger(prediction).catch((err) => {
        console.warn(`Failed to record outcome to ledger: ${err}`);
      });
    }
  }

  /**
   * Compute calibration report for a construction.
   *
   * @param constructionId - ID of the construction to analyze
   * @param options - Analysis options
   * @returns Calibration report
   */
  getCalibration(
    constructionId: string,
    options: CalibrationOptions = {}
  ): ConstructionCalibrationReport {
    const minSamples = options.minSamples ?? 10;

    // Gather predictions with outcomes for this construction
    const claims = this.getCalibrationClaims(constructionId, options.timeRange);

    if (claims.length < minSamples) {
      return this.createInsufficientDataReport(constructionId, claims.length);
    }

    // Use existing calibration infrastructure
    const report = computeCalibrationReport({
      claims,
      scope: { kind: 'custom', paths: [constructionId] },
      previousReport: undefined, // Could track this for trend analysis
    });

    // Compute trend
    const history = this.constructionHistory.get(constructionId);
    const trend = this.computeTrend(report.overallCalibrationError, history?.previousEce);

    // Update history
    this.constructionHistory.set(constructionId, {
      previousEce: report.overallCalibrationError,
      lastReportDate: new Date(),
    });

    // Generate recommendations
    const recommendations = this.generateRecommendations(report);

    return {
      constructionId,
      sampleCount: claims.length,
      ece: report.overallCalibrationError,
      buckets: report.buckets,
      trend,
      lastUpdated: new Date(),
      recommendations,
    };
  }

  /**
   * Check if any construction is miscalibrated.
   *
   * @param threshold - ECE threshold (default: 0.10 = 10%)
   * @returns Alerts for miscalibrated constructions
   */
  getAlerts(threshold: number = 0.10): CalibrationAlert[] {
    const alerts: CalibrationAlert[] = [];
    const constructionIds = this.getConstructionIds();

    for (const constructionId of constructionIds) {
      const report = this.getCalibration(constructionId);

      if (report.ece > threshold) {
        const severity = report.ece > threshold * 2 ? 'critical' : 'warning';

        // Find problem buckets (those exceeding their targets)
        const problemBuckets = report.buckets
          .filter((bucket) => {
            const range = `[${bucket.confidenceRange[0]}, ${bucket.confidenceRange[1]})`;
            const target = CALIBRATION_TARGETS[range] ?? Infinity;
            return bucket.calibrationError > target && bucket.sampleSize >= 5;
          })
          .map((b) => `[${b.confidenceRange[0]}, ${b.confidenceRange[1]})`);

        alerts.push({
          constructionId,
          ece: report.ece,
          threshold,
          severity,
          message: `${constructionId} is miscalibrated: ECE=${(report.ece * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(0)}%)`,
          problemBuckets,
        });
      }
    }

    return alerts.sort((a, b) => b.ece - a.ece);
  }

  /**
   * Get all tracked construction IDs.
   */
  getConstructionIds(): string[] {
    const ids = new Set<string>();
    for (const prediction of this.predictions.values()) {
      ids.add(prediction.constructionId);
    }
    return Array.from(ids);
  }

  /**
   * Get predictions count per construction.
   */
  getPredictionCounts(): Map<string, { total: number; withOutcome: number }> {
    const counts = new Map<string, { total: number; withOutcome: number }>();

    for (const prediction of this.predictions.values()) {
      const current = counts.get(prediction.constructionId) ?? { total: 0, withOutcome: 0 };
      current.total++;
      if (prediction.outcome) {
        current.withOutcome++;
      }
      counts.set(prediction.constructionId, current);
    }

    return counts;
  }

  /**
   * Get total prediction count for a construction.
   */
  getPredictionCount(constructionId: string): number {
    return this.getPredictionCounts().get(constructionId)?.total ?? 0;
  }

  /**
   * Compute calibrated confidence for a raw confidence value.
   *
   * Returns null when there is insufficient outcome history.
   */
  getCalibratedConfidence(
    constructionId: string,
    rawConfidence: number,
    minSamples: number = 20
  ): number | null {
    if (!Number.isFinite(rawConfidence)) {
      return null;
    }
    const clampedRaw = Math.max(0, Math.min(1, rawConfidence));
    const counts = this.getPredictionCounts().get(constructionId);
    if (!counts || counts.withOutcome < minSamples) {
      return null;
    }

    const report = this.getCalibration(constructionId, { minSamples });
    if (report.sampleCount < minSamples) {
      return null;
    }

    const bucket = report.buckets.find((candidate) => {
      const [low, high] = candidate.confidenceRange;
      if (clampedRaw === 1.0) {
        return clampedRaw >= low && clampedRaw <= high;
      }
      return clampedRaw >= low && clampedRaw < high;
    });

    if (!bucket || bucket.sampleSize === 0) {
      return null;
    }

    return Math.max(0, Math.min(1, bucket.empiricalAccuracy));
  }

  /**
   * Convenience alias for construction-level calibration reports.
   */
  getCalibrationReport(
    constructionId: string,
    options: CalibrationOptions = {}
  ): ConstructionCalibrationReport {
    return this.getCalibration(constructionId, {
      ...options,
      minSamples: options.minSamples ?? 20,
    });
  }

  /**
   * Clear all tracking data (useful for testing).
   */
  clear(): void {
    this.predictions.clear();
    this.constructionHistory.clear();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getCalibrationClaims(
    constructionId: string,
    timeRange?: { from?: Date; to?: Date }
  ): CalibrationClaim[] {
    const claims: CalibrationClaim[] = [];

    for (const prediction of this.predictions.values()) {
      // Filter by construction
      if (prediction.constructionId !== constructionId) continue;

      // Filter by outcome (only predictions with known outcomes)
      if (!prediction.outcome) continue;

      // Filter by time range
      if (timeRange?.from && prediction.timestamp < timeRange.from) continue;
      if (timeRange?.to && prediction.timestamp > timeRange.to) continue;

      // Extract numeric confidence
      const confidence = getNumericValue(prediction.confidence);
      if (confidence === null) continue;

      claims.push({
        claimId: prediction.predictionId,
        confidence,
        correct: prediction.outcome.correct,
        category: constructionId,
      });
    }

    return claims;
  }

  private computeTrend(
    currentEce: number,
    previousEce?: number
  ): 'improving' | 'stable' | 'degrading' {
    if (previousEce === undefined) {
      return 'stable';
    }

    const delta = currentEce - previousEce;
    if (delta < -0.02) return 'improving';
    if (delta > 0.02) return 'degrading';
    return 'stable';
  }

  private generateRecommendations(report: {
    overallCalibrationError: number;
    buckets: CalibrationBucket[];
    overconfidentBuckets: string[];
    underconfidentBuckets: string[];
  }): string[] {
    const recommendations: string[] = [];

    if (report.overallCalibrationError > 0.10) {
      recommendations.push(
        `Overall calibration error (${(report.overallCalibrationError * 100).toFixed(1)}%) exceeds 10% target`
      );
    }

    for (const range of report.overconfidentBuckets) {
      const bucket = report.buckets.find(
        (b) => `[${b.confidenceRange[0]}, ${b.confidenceRange[1]})` === range
      );
      if (bucket && bucket.sampleSize >= 10) {
        recommendations.push(
          `Overconfident in ${range} range: stated ${(bucket.statedMean * 100).toFixed(0)}% vs actual ${(bucket.empiricalAccuracy * 100).toFixed(0)}%`
        );
      }
    }

    for (const range of report.underconfidentBuckets) {
      const bucket = report.buckets.find(
        (b) => `[${b.confidenceRange[0]}, ${b.confidenceRange[1]})` === range
      );
      if (bucket && bucket.sampleSize >= 10) {
        recommendations.push(
          `Underconfident in ${range} range: stated ${(bucket.statedMean * 100).toFixed(0)}% vs actual ${(bucket.empiricalAccuracy * 100).toFixed(0)}%`
        );
      }
    }

    return recommendations;
  }

  private createInsufficientDataReport(
    constructionId: string,
    sampleCount: number
  ): ConstructionCalibrationReport {
    return {
      constructionId,
      sampleCount,
      ece: 0,
      buckets: DEFAULT_BUCKETS.map((b) => ({
        confidenceRange: b,
        statedMean: 0,
        empiricalAccuracy: 0,
        sampleSize: 0,
        calibrationError: 0,
      })),
      trend: 'stable',
      lastUpdated: new Date(),
      recommendations: [
        `Insufficient data: ${sampleCount} predictions with outcomes (minimum: 10)`,
      ],
    };
  }

  private async recordPredictionToLedger(prediction: StoredPrediction): Promise<EvidenceEntry> {
    if (!this.ledger) {
      throw new Error('No ledger configured');
    }

    return this.ledger.append({
      kind: 'claim',
      payload: {
        claim: prediction.claim,
        category: 'behavior',
        subject: {
          type: 'system',
          identifier: prediction.constructionId,
        },
        supportingEvidence: [],
        knownDefeaters: [],
        confidence: prediction.confidence,
      },
      provenance: {
        source: 'system_observation',
        method: `construction_calibration:${prediction.constructionId}`,
      },
      relatedEntries: [],
      confidence: prediction.confidence,
    });
  }

  private async recordOutcomeToLedger(prediction: StoredPrediction): Promise<EvidenceEntry> {
    if (!this.ledger) {
      throw new Error('No ledger configured');
    }

    if (!prediction.outcome) {
      throw new Error('No outcome to record');
    }

    return this.ledger.append({
      kind: 'outcome',
      payload: {
        predictionId: prediction.predictionId as unknown as EvidenceId,
        predicted: {
          claim: prediction.claim,
          confidence: prediction.confidence,
        },
        actual: {
          outcome: prediction.outcome.correct ? 'correct' : 'incorrect',
          observation: `Verified via ${prediction.outcome.verificationMethod}`,
        },
        verificationMethod: prediction.outcome.verificationMethod,
      } satisfies OutcomeEvidence,
      provenance: {
        source: 'system_observation',
        method: prediction.outcome.verificationMethod,
      },
      relatedEntries: [],
      confidence: deterministic(true, 'observed_outcome'),
    });
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a construction calibration tracker.
 *
 * @param ledger - Optional evidence ledger for persistence
 * @returns New tracker instance
 */
export function createConstructionCalibrationTracker(
  ledger?: IEvidenceLedger
): ConstructionCalibrationTracker {
  return new ConstructionCalibrationTracker(ledger);
}

// ============================================================================
// CALIBRATION HOOKS FOR CONSTRUCTIONS
// ============================================================================

/**
 * Mixin interface for constructions that support calibration tracking.
 */
export interface CalibratedConstruction {
  /** Get the construction ID for calibration tracking */
  getConstructionId(): string;
  /** Set the calibration tracker to use */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void;
}

/**
 * Helper to generate a unique prediction ID.
 */
export function generatePredictionId(constructionId: string): string {
  return `${constructionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
