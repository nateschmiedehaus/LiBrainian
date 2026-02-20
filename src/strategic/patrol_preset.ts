/**
 * @fileoverview PATROL Work Preset
 *
 * Quality gates for agent patrol dogfooding runs. This preset defines
 * the minimum requirements for a patrol run to be considered valid --
 * ensuring sufficient coverage, thoroughness, and observation quality.
 *
 * The patrol preset is itself validated by the same preset system it tests,
 * proving the preset system works end-to-end.
 */

import type { WorkPreset, QualityGatesPreset, PresetQualityGate } from './work_presets.js';
import {
  createWorkPreset,
  createQualityGatesPreset,
  createOrchestrationPreset,
  createReviewPreset,
  STANDARD_ORCHESTRATION,
} from './work_presets.js';

// ---------------------------------------------------------------------------
// Patrol Quality Gates
// ---------------------------------------------------------------------------

/**
 * Observation gates: blocking requirements for patrol output validity.
 */
const PATROL_OBSERVATION_GATE: PresetQualityGate = {
  phase: 'observation',
  blocking: true,
  requirements: [
    {
      type: 'evidence_complete',
      threshold: 3,
      description: 'At least 3 constructions must be exercised during patrol',
    },
    {
      type: 'evidence_complete',
      threshold: 3,
      description: 'At least 3 distinct features must be used',
    },
    {
      type: 'evidence_complete',
      threshold: 2,
      description: 'At least 2 negative findings required (thoroughness check)',
    },
    {
      type: 'confidence_threshold',
      threshold: 0.8,
      description: 'Observation completeness must exceed 80%',
    },
  ],
};

/**
 * Quality gates: non-blocking quality signals for patrol metrics.
 */
const PATROL_QUALITY_GATE: PresetQualityGate = {
  phase: 'quality',
  blocking: false,
  requirements: [
    {
      type: 'confidence_threshold',
      threshold: 5,
      description: 'Minimum NPS score of 5 (neutral or better)',
    },
    {
      type: 'confidence_threshold',
      threshold: 0.3,
      description: 'Implicit fallback rate must not exceed 30%',
    },
    {
      type: 'confidence_threshold',
      threshold: 0.5,
      description: 'Mean construction output quality must be at least adequate',
    },
  ],
};

/**
 * Patrol quality gates preset.
 */
export const PATROL_QUALITY_GATES: QualityGatesPreset = createQualityGatesPreset({
  id: 'patrol-quality-gates',
  name: 'Patrol Quality Gates',
  description: 'Quality gates for agent patrol dogfooding runs',
  gates: [PATROL_OBSERVATION_GATE, PATROL_QUALITY_GATE],
});

// ---------------------------------------------------------------------------
// Complete Patrol Preset
// ---------------------------------------------------------------------------

/**
 * PATROL work preset: defines quality gates for patrol dogfooding runs.
 *
 * This preset is intentionally lightweight on orchestration and review
 * (patrol runs are automated, not human-reviewed) but strict on observation
 * and evidence completeness.
 */
export const PATROL_PRESET: WorkPreset = createWorkPreset({
  id: 'patrol',
  name: 'Patrol',
  description: 'Quality gates for agent patrol dogfooding runs -- ensures sufficient coverage, thoroughness, and observation quality',
  version: '1.0.0',
  qualityGates: PATROL_QUALITY_GATES,
  orchestration: createOrchestrationPreset({
    id: 'patrol-orchestration',
    maxConcurrentAgents: 1,
    progressCheckIntervalMs: 30000,
    stallDetectionThresholdMs: 300000,
    failurePolicy: 'continue',
  }),
  deliverables: [],
  review: createReviewPreset({
    selfReviewChecklist: [
      'Observation JSON was extracted successfully',
      'At least 2 negative findings were reported',
      'At least 3 features/constructions were exercised',
      'NPS score was provided and calibrated',
    ],
    peerReviewTriggers: [],
    automatedChecks: [],
  }),
  tags: ['meta', 'quality', 'dogfood', 'e2e', 'patrol'],
});

// ---------------------------------------------------------------------------
// Patrol-specific validation helpers
// ---------------------------------------------------------------------------

/**
 * Threshold constants for patrol validation.
 * These mirror the gate requirements above for programmatic access.
 */
export const PATROL_THRESHOLDS = {
  minConstructionsExercised: 3,
  minFeaturesUsed: 3,
  minNegativeFindings: 2,
  observationCompleteness: 0.8,
  minNpsScore: 5,
  maxImplicitFallbackRate: 0.3,
  minConstructionQualityMean: 'adequate' as const,
} as const;

/**
 * Validate a patrol observation against the PATROL preset thresholds.
 * Returns a list of failures (empty = all gates passed).
 */
export function validatePatrolObservation(observation: {
  featuresUsed?: { feature: string }[];
  constructionsUsed?: { constructionId: string; outputQuality?: string }[];
  negativeFindingsMandatory?: unknown[];
  overallVerdict?: { npsScore?: number };
  implicitBehavior?: { fellBackToGrep?: boolean; ignoredResults?: boolean };
}): { passed: boolean; failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];

  const featuresCount = (observation.featuresUsed ?? []).length;
  const constructionsCount = (observation.constructionsUsed ?? []).length;
  const negativeCount = (observation.negativeFindingsMandatory ?? []).length;
  const nps = observation.overallVerdict?.npsScore;
  const fellBack = observation.implicitBehavior?.fellBackToGrep ||
    observation.implicitBehavior?.ignoredResults;

  // Blocking observation gates
  if (constructionsCount < PATROL_THRESHOLDS.minConstructionsExercised) {
    failures.push(`constructions_exercised:${constructionsCount}<${PATROL_THRESHOLDS.minConstructionsExercised}`);
  }
  if (featuresCount < PATROL_THRESHOLDS.minFeaturesUsed) {
    failures.push(`features_used:${featuresCount}<${PATROL_THRESHOLDS.minFeaturesUsed}`);
  }
  if (negativeCount < PATROL_THRESHOLDS.minNegativeFindings) {
    failures.push(`negative_findings:${negativeCount}<${PATROL_THRESHOLDS.minNegativeFindings}`);
  }

  // Non-blocking quality gates
  if (typeof nps === 'number' && nps < PATROL_THRESHOLDS.minNpsScore) {
    warnings.push(`nps_score:${nps}<${PATROL_THRESHOLDS.minNpsScore}`);
  }
  if (fellBack) {
    warnings.push('implicit_fallback_detected');
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  };
}
