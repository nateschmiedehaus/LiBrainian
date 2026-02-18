/**
 * @fileoverview Learn From Outcome Primitive (tp_learn_from_outcome)
 *
 * Update Librarian knowledge based on outcome feedback.
 * Adjusts calibration, extracts patterns, and updates confidence.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { ConfidenceValue } from './types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A prediction made by the system.
 */
export interface Prediction {
  /** Unique identifier */
  id: string;
  /** The claim that was predicted */
  claim: string;
  /** The predicted outcome */
  predictedOutcome: unknown;
  /** Confidence stated at prediction time */
  statedConfidence: ConfidenceValue;
  /** When the prediction was made */
  timestamp: Date;
  /** Context of the prediction */
  context: string;
  /** Entity ID related to this prediction */
  entityId?: string;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Verification method for an outcome.
 */
export type VerificationMethod = 'automated' | 'human' | 'downstream_success';

/**
 * An actual outcome observed.
 */
export interface Outcome {
  /** ID of the prediction this outcome corresponds to */
  predictionId: string;
  /** The actual value observed */
  actualValue: unknown;
  /** Whether the prediction was correct */
  wasCorrect: boolean;
  /** How the outcome was verified */
  verificationMethod: VerificationMethod;
  /** When the outcome was observed */
  timestamp: Date;
  /** Additional notes about the outcome */
  notes?: string;
}

/**
 * Update to a confidence bin.
 */
export interface BinUpdate {
  /** Bin index (0-9 for 10 bins) */
  bin: number;
  /** Bin center value */
  binCenter: number;
  /** Frequency before this update */
  previousFrequency: number;
  /** Frequency after this update */
  newFrequency: number;
  /** Samples in this bin before update */
  previousSamples: number;
  /** Samples in this bin after update */
  newSamples: number;
}

/**
 * Update to calibration metrics.
 */
export interface CalibrationUpdate {
  /** ECE before this outcome */
  previousECE: number;
  /** ECE after incorporating this outcome */
  newECE: number;
  /** Number of samples added */
  samplesAdded: number;
  /** Updates to individual bins */
  binUpdates: BinUpdate[];
  /** Direction of calibration change */
  calibrationImproved: boolean;
}

/**
 * Types of knowledge updates.
 */
export type KnowledgeUpdateType =
  | 'confidence_adjust'
  | 'claim_revise'
  | 'relationship_add'
  | 'relationship_remove'
  | 'evidence_add'
  | 'evidence_invalidate';

/**
 * An update to stored knowledge.
 */
export interface KnowledgeUpdate {
  /** Entity being updated */
  entityId: string;
  /** Type of update */
  updateType: KnowledgeUpdateType;
  /** Value before update */
  before: unknown;
  /** Value after update */
  after: unknown;
  /** Reason for the update */
  reason: string;
  /** Timestamp of the update */
  timestamp: Date;
}

/**
 * An adjustment to confidence.
 */
export interface ConfidenceAdjustment {
  /** Entity whose confidence is being adjusted */
  entityId: string;
  /** Previous confidence value */
  previous: ConfidenceValue;
  /** New adjusted confidence value */
  adjusted: ConfidenceValue;
  /** Reason for adjustment */
  reason: string;
  /** Factor applied to adjust */
  adjustmentFactor: number;
}

/**
 * A pattern extracted from the outcome.
 */
export interface LearnedPattern {
  /** Pattern identifier */
  id: string;
  /** Pattern name */
  name: string;
  /** Pattern description */
  description: string;
  /** When this pattern applies */
  trigger: string;
  /** What the pattern indicates */
  indication: string;
  /** Confidence in this pattern */
  confidence: ConfidenceValue;
  /** Examples supporting this pattern */
  supportingExamples: number;
}

/**
 * A defeater that undermines a claim.
 */
export interface Defeater {
  /** Defeater identifier */
  id: string;
  /** Claim being defeated */
  targetClaimId: string;
  /** Type of defeater */
  type: 'rebutting' | 'undercutting';
  /** Description of the defeater */
  description: string;
  /** How strong the defeater is (0-1) */
  strength: number;
  /** Evidence for the defeater */
  evidence: string;
}

/**
 * Context for the prediction.
 */
export interface PredictionContext {
  /** Domain of the prediction */
  domain: string;
  /** Complexity level */
  complexity: 'simple' | 'moderate' | 'complex';
  /** Relevant features */
  features: Record<string, unknown>;
  /** Prior similar predictions */
  priorSimilarPredictions?: number;
  /** Historical accuracy in this context */
  historicalAccuracy?: number;
}

/**
 * Options for learning from outcome.
 */
export interface LearnFromOutcomeOptions {
  /** Update calibration metrics */
  updateCalibration?: boolean;
  /** Extract patterns from outcomes */
  extractPatterns?: boolean;
  /** Minimum pattern support (number of examples) */
  minPatternSupport?: number;
  /** Confidence adjustment factor */
  adjustmentFactor?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Result of learning from an outcome.
 */
export interface LearningResult {
  /** Number of outcomes processed */
  outcomesProcessed: number;
  /** Calibration update */
  calibrationUpdate: CalibrationUpdate;
  /** Knowledge updates made */
  knowledgeUpdates: KnowledgeUpdate[];
  /** Confidence adjustments made */
  confidenceAdjustments: ConfidenceAdjustment[];
  /** Patterns extracted */
  patternsExtracted: LearnedPattern[];
  /** New defeaters identified */
  newDefeaters: Defeater[];
  /** Duration of learning in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_BIN_COUNT = 10;
const DEFAULT_ADJUSTMENT_FACTOR = 0.1;
const DEFAULT_MIN_PATTERN_SUPPORT = 3;

// ============================================================================
// CALIBRATION UPDATE
// ============================================================================

/**
 * Compute the bin index for a confidence value.
 */
function getBinIndex(confidence: number, binCount: number = DEFAULT_BIN_COUNT): number {
  const binIndex = Math.floor(confidence * binCount);
  return Math.min(binIndex, binCount - 1);
}

/**
 * Get bin center for a bin index.
 */
function getBinCenter(binIndex: number, binCount: number = DEFAULT_BIN_COUNT): number {
  return (binIndex + 0.5) / binCount;
}

/**
 * Simulate current calibration state (in production would come from storage).
 */
interface CalibrationState {
  bins: Array<{
    count: number;
    correct: number;
  }>;
  totalSamples: number;
}

function getInitialCalibrationState(): CalibrationState {
  return {
    bins: Array(DEFAULT_BIN_COUNT).fill(null).map(() => ({ count: 0, correct: 0 })),
    totalSamples: 0,
  };
}

/**
 * Compute ECE from calibration state.
 */
function computeECE(state: CalibrationState): number {
  if (state.totalSamples === 0) return 0;

  let ece = 0;
  for (let i = 0; i < state.bins.length; i++) {
    const bin = state.bins[i];
    if (bin.count > 0) {
      const binCenter = getBinCenter(i);
      const actualFrequency = bin.correct / bin.count;
      const weight = bin.count / state.totalSamples;
      ece += weight * Math.abs(actualFrequency - binCenter);
    }
  }
  return ece;
}

/**
 * Update calibration based on a prediction/outcome pair.
 */
function updateCalibration(
  prediction: Prediction,
  outcome: Outcome,
  state: CalibrationState
): { newState: CalibrationState; update: CalibrationUpdate } {
  const binIndex = getBinIndex(prediction.statedConfidence.score);
  const previousECE = computeECE(state);

  // Create new state with updated bin
  const newBins = state.bins.map((bin, i) => {
    if (i === binIndex) {
      return {
        count: bin.count + 1,
        correct: bin.correct + (outcome.wasCorrect ? 1 : 0),
      };
    }
    return { ...bin };
  });

  const newState: CalibrationState = {
    bins: newBins,
    totalSamples: state.totalSamples + 1,
  };

  const newECE = computeECE(newState);

  // Build bin updates
  const binUpdates: BinUpdate[] = [{
    bin: binIndex,
    binCenter: getBinCenter(binIndex),
    previousFrequency: state.bins[binIndex].count > 0
      ? state.bins[binIndex].correct / state.bins[binIndex].count
      : 0,
    newFrequency: newBins[binIndex].correct / newBins[binIndex].count,
    previousSamples: state.bins[binIndex].count,
    newSamples: newBins[binIndex].count,
  }];

  return {
    newState,
    update: {
      previousECE,
      newECE,
      samplesAdded: 1,
      binUpdates,
      calibrationImproved: newECE < previousECE,
    },
  };
}

// ============================================================================
// CONFIDENCE ADJUSTMENT
// ============================================================================

/**
 * Calculate confidence adjustment based on prediction accuracy.
 */
function calculateConfidenceAdjustment(
  prediction: Prediction,
  outcome: Outcome,
  context: PredictionContext,
  adjustmentFactor: number
): ConfidenceAdjustment | null {
  if (!prediction.entityId) return null;

  const previous = prediction.statedConfidence;
  let adjustedScore: number;
  let reason: string;
  let factor: number;

  if (outcome.wasCorrect) {
    // Prediction was correct - potentially increase confidence
    if (previous.score < 0.9) {
      factor = 1 + adjustmentFactor;
      adjustedScore = Math.min(0.99, previous.score * factor);
      reason = 'Prediction verified correct, increasing confidence';
    } else {
      adjustedScore = previous.score;
      factor = 1;
      reason = 'Confidence already high, maintaining';
    }
  } else {
    // Prediction was wrong - decrease confidence
    factor = 1 - adjustmentFactor;
    adjustedScore = Math.max(0.1, previous.score * factor);
    reason = 'Prediction incorrect, decreasing confidence';
  }

  // Adjust based on context complexity
  if (context.complexity === 'complex' && !outcome.wasCorrect) {
    adjustedScore = Math.max(0.1, adjustedScore - 0.05);
    reason += ' (complex context penalty)';
  }

  // Determine new tier
  let tier: ConfidenceValue['tier'];
  if (adjustedScore >= 0.8) tier = 'high';
  else if (adjustedScore >= 0.5) tier = 'medium';
  else if (adjustedScore >= 0.2) tier = 'low';
  else tier = 'uncertain';

  const adjusted: ConfidenceValue = {
    score: adjustedScore,
    tier,
    source: 'measured',
    sampleSize: (previous.sampleSize ?? 0) + 1,
  };

  return {
    entityId: prediction.entityId,
    previous,
    adjusted,
    reason,
    adjustmentFactor: factor,
  };
}

// ============================================================================
// KNOWLEDGE UPDATE
// ============================================================================

/**
 * Generate knowledge updates from prediction/outcome pair.
 */
function generateKnowledgeUpdates(
  prediction: Prediction,
  outcome: Outcome,
  context: PredictionContext
): KnowledgeUpdate[] {
  const updates: KnowledgeUpdate[] = [];
  const now = new Date();

  // If prediction was wrong, potentially revise claim
  if (!outcome.wasCorrect && prediction.entityId) {
    updates.push({
      entityId: prediction.entityId,
      updateType: 'claim_revise',
      before: prediction.claim,
      after: `[REVISED] ${prediction.claim} - contrary evidence observed`,
      reason: `Prediction "${prediction.claim}" was incorrect`,
      timestamp: now,
    });

    // Add invalidating evidence
    updates.push({
      entityId: prediction.entityId,
      updateType: 'evidence_add',
      before: null,
      after: {
        type: 'outcome',
        content: JSON.stringify(outcome.actualValue),
        timestamp: outcome.timestamp,
        verificationMethod: outcome.verificationMethod,
      },
      reason: 'Adding contrary evidence from outcome',
      timestamp: now,
    });
  }

  // If prediction was correct with high confidence, strengthen relationships
  if (outcome.wasCorrect && prediction.statedConfidence.score > 0.8 && prediction.entityId) {
    updates.push({
      entityId: prediction.entityId,
      updateType: 'evidence_add',
      before: null,
      after: {
        type: 'verification',
        content: `Verified correct at ${outcome.timestamp.toISOString()}`,
        method: outcome.verificationMethod,
      },
      reason: 'Adding supporting evidence from correct prediction',
      timestamp: now,
    });
  }

  return updates;
}

// ============================================================================
// PATTERN EXTRACTION
// ============================================================================

/**
 * Attempt to extract patterns from the prediction/outcome pair.
 */
function extractPatterns(
  prediction: Prediction,
  outcome: Outcome,
  context: PredictionContext,
  minSupport: number
): LearnedPattern[] {
  const patterns: LearnedPattern[] = [];

  // Pattern: High confidence predictions in simple contexts are usually correct
  if (context.complexity === 'simple' && prediction.statedConfidence.score > 0.8) {
    if (outcome.wasCorrect) {
      patterns.push({
        id: `pattern-simple-high-conf-${Date.now()}`,
        name: 'Simple Context High Confidence',
        description: 'High confidence predictions in simple contexts tend to be correct',
        trigger: 'complexity === "simple" && confidence > 0.8',
        indication: 'Prediction likely correct',
        confidence: {
          score: 0.85,
          tier: 'high',
          source: 'measured',
          sampleSize: context.priorSimilarPredictions ?? 1,
        },
        supportingExamples: (context.priorSimilarPredictions ?? 0) + 1,
      });
    }
  }

  // Pattern: Overconfidence in complex contexts
  if (context.complexity === 'complex' && prediction.statedConfidence.score > 0.7 && !outcome.wasCorrect) {
    patterns.push({
      id: `pattern-complex-overconf-${Date.now()}`,
      name: 'Complex Context Overconfidence',
      description: 'High confidence in complex contexts often leads to incorrect predictions',
      trigger: 'complexity === "complex" && confidence > 0.7',
      indication: 'Reduce confidence by 20%',
      confidence: {
        score: 0.6,
        tier: 'medium',
        source: 'estimated',
      },
      supportingExamples: 1,
    });
  }

  // Pattern: Verification method reliability
  if (outcome.verificationMethod === 'automated' && outcome.wasCorrect) {
    patterns.push({
      id: `pattern-auto-verify-${Date.now()}`,
      name: 'Automated Verification Reliable',
      description: 'Automated verification confirms prediction accuracy',
      trigger: 'verificationMethod === "automated"',
      indication: 'High reliability verification',
      confidence: {
        score: 0.9,
        tier: 'high',
        source: 'measured',
      },
      supportingExamples: 1,
    });
  }

  // Filter patterns by minimum support
  return patterns.filter((p) => p.supportingExamples >= minSupport);
}

// ============================================================================
// DEFEATER DETECTION
// ============================================================================

/**
 * Identify defeaters from incorrect predictions.
 */
function identifyDefeaters(
  prediction: Prediction,
  outcome: Outcome
): Defeater[] {
  const defeaters: Defeater[] = [];

  if (!outcome.wasCorrect && prediction.entityId) {
    // Rebutting defeater: direct contradiction
    defeaters.push({
      id: `defeater-rebut-${prediction.id}`,
      targetClaimId: prediction.entityId,
      type: 'rebutting',
      description: `Outcome contradicts prediction: expected ${JSON.stringify(prediction.predictedOutcome)}, got ${JSON.stringify(outcome.actualValue)}`,
      strength: prediction.statedConfidence.score, // Higher confidence = stronger defeat
      evidence: `Verified via ${outcome.verificationMethod} at ${outcome.timestamp.toISOString()}`,
    });

    // Undercutting defeater if confidence was very high
    if (prediction.statedConfidence.score > 0.8) {
      defeaters.push({
        id: `defeater-undercut-${prediction.id}`,
        targetClaimId: prediction.entityId,
        type: 'undercutting',
        description: 'High confidence prediction failed, suggesting flawed reasoning process',
        strength: 0.6,
        evidence: `Stated confidence was ${prediction.statedConfidence.score} but prediction failed`,
      });
    }
  }

  return defeaters;
}

// ============================================================================
// MAIN LEARNING FUNCTION
// ============================================================================

/**
 * Learn from a prediction outcome for calibration and improvement.
 *
 * This function:
 * 1. Updates calibration metrics (ECE) based on the outcome
 * 2. Adjusts confidence for the related entity
 * 3. Generates knowledge updates
 * 4. Extracts reusable patterns
 * 5. Identifies defeaters for incorrect predictions
 *
 * @param prediction - The original prediction
 * @param outcome - The actual outcome observed
 * @param context - Context of the prediction
 * @param options - Learning options
 * @returns Learning result with updates
 *
 * @example
 * ```typescript
 * const result = await learnFromOutcome(
 *   {
 *     id: 'pred-1',
 *     claim: 'Function will return valid JSON',
 *     predictedOutcome: true,
 *     statedConfidence: { score: 0.85, tier: 'high', source: 'estimated' },
 *     timestamp: new Date(),
 *     context: 'JSON parsing',
 *   },
 *   {
 *     predictionId: 'pred-1',
 *     actualValue: true,
 *     wasCorrect: true,
 *     verificationMethod: 'automated',
 *     timestamp: new Date(),
 *   },
 *   {
 *     domain: 'parsing',
 *     complexity: 'simple',
 *     features: {},
 *   }
 * );
 * console.log(`ECE changed from ${result.calibrationUpdate.previousECE} to ${result.calibrationUpdate.newECE}`);
 * ```
 */
export async function learnFromOutcome(
  prediction: Prediction,
  outcome: Outcome,
  context: PredictionContext,
  options: LearnFromOutcomeOptions = {}
): Promise<LearningResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    updateCalibration: shouldUpdateCalibration = true,
    extractPatterns: shouldExtractPatterns = true,
    minPatternSupport = DEFAULT_MIN_PATTERN_SUPPORT,
    adjustmentFactor = DEFAULT_ADJUSTMENT_FACTOR,
    verbose = false,
  } = options;

  if (verbose) {
    console.error(`[learnFromOutcome] Learning from prediction: ${prediction.id}`);
  }

  // Initialize or get calibration state (in production from storage)
  const calibrationState = getInitialCalibrationState();

  // Update calibration
  let calibrationUpdate: CalibrationUpdate;
  if (shouldUpdateCalibration) {
    const { update } = updateCalibration(prediction, outcome, calibrationState);
    calibrationUpdate = update;

    if (verbose) {
      console.error(`[learnFromOutcome] ECE: ${update.previousECE.toFixed(4)} -> ${update.newECE.toFixed(4)}`);
    }
  } else {
    calibrationUpdate = {
      previousECE: 0,
      newECE: 0,
      samplesAdded: 0,
      binUpdates: [],
      calibrationImproved: false,
    };
  }

  // Calculate confidence adjustment
  const confidenceAdjustments: ConfidenceAdjustment[] = [];
  const adjustment = calculateConfidenceAdjustment(prediction, outcome, context, adjustmentFactor);
  if (adjustment) {
    confidenceAdjustments.push(adjustment);

    if (verbose) {
      console.error(`[learnFromOutcome] Confidence: ${adjustment.previous.score.toFixed(3)} -> ${adjustment.adjusted.score.toFixed(3)}`);
    }
  }

  // Generate knowledge updates
  const knowledgeUpdates = generateKnowledgeUpdates(prediction, outcome, context);

  if (verbose) {
    console.error(`[learnFromOutcome] Generated ${knowledgeUpdates.length} knowledge updates`);
  }

  // Extract patterns
  let patternsExtracted: LearnedPattern[] = [];
  if (shouldExtractPatterns) {
    patternsExtracted = extractPatterns(prediction, outcome, context, minPatternSupport);

    if (verbose && patternsExtracted.length > 0) {
      console.error(`[learnFromOutcome] Extracted ${patternsExtracted.length} patterns`);
    }
  }

  // Identify defeaters
  const newDefeaters = identifyDefeaters(prediction, outcome);

  if (verbose && newDefeaters.length > 0) {
    console.error(`[learnFromOutcome] Identified ${newDefeaters.length} defeaters`);
  }

  return {
    outcomesProcessed: 1,
    calibrationUpdate,
    knowledgeUpdates,
    confidenceAdjustments,
    patternsExtracted,
    newDefeaters,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a learning primitive with bound options.
 */
export function createLearnFromOutcome(
  defaultOptions: Partial<LearnFromOutcomeOptions>
): (
  prediction: Prediction,
  outcome: Outcome,
  context: PredictionContext,
  options?: Partial<LearnFromOutcomeOptions>
) => Promise<LearningResult> {
  return async (prediction, outcome, context, options = {}) => {
    return learnFromOutcome(prediction, outcome, context, {
      ...defaultOptions,
      ...options,
    });
  };
}
