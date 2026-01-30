/**
 * @fileoverview Quality Gates System for Course Correction
 *
 * Implements quality gates that enable course correction at any stage of work.
 * Based on the course correction protocol specification.
 *
 * Key principles:
 * - Positively productive at any stage (not "you're wrong, start over")
 * - Stage-aware evaluation (different gates for different progress levels)
 * - Sunk cost awareness (avoid completion bias)
 * - Evidence-based continuation decisions
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { ConfidenceValue } from './confidence.js';
import { absent, getNumericValue, bounded, deterministic } from './confidence.js';
import type { Claim, ClaimId } from './types.js';
import type {
  Grounding,
  ObjectId,
  CoherenceNetwork,
  EpistemicObject,
  CoherenceViolation,
} from './universal_coherence.js';
import { evaluateCoherence, createObjectId } from './universal_coherence.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for quality gates types */
export const QUALITY_GATES_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// WORK STAGE ENUM
// ============================================================================

/**
 * Stages of work progress for quality gate evaluation.
 * Each stage has different concerns and appropriate remediation strategies.
 */
export enum WorkStage {
  /** Before work begins - validate task understanding */
  PRE_PLANNING = 'PRE_PLANNING',

  /** 0-25% complete - detect wrong direction early */
  EARLY_WORK = 'EARLY_WORK',

  /** 25-75% complete - handle sunk cost bias */
  MID_WORK = 'MID_WORK',

  /** 75-99% complete - resist completion bias */
  LATE_WORK = 'LATE_WORK',

  /** After "done" - retrospective validation */
  POST_COMPLETION = 'POST_COMPLETION',
}

/**
 * Get the work stage based on percent complete.
 */
export function getStageFromProgress(percentComplete: number): WorkStage {
  if (percentComplete <= 0) {
    return WorkStage.PRE_PLANNING;
  }
  if (percentComplete < 0.25) {
    return WorkStage.EARLY_WORK;
  }
  if (percentComplete < 0.75) {
    return WorkStage.MID_WORK;
  }
  if (percentComplete < 1.0) {
    return WorkStage.LATE_WORK;
  }
  return WorkStage.POST_COMPLETION;
}

// ============================================================================
// TASK CLAIM TYPE
// ============================================================================

/**
 * A claim about a task being worked on.
 * Extends the base Claim with task-specific metadata.
 */
export interface TaskClaim extends Omit<Claim, 'type'> {
  type: 'task';
  /** The task description */
  taskDescription: string;
  /** Success criteria for the task */
  successCriteria: string[];
  /** Current progress (0-1) */
  progress: number;
  /** Assumptions made about the task */
  assumptions: string[];
}

// ============================================================================
// INFERENCE STEP TYPE
// ============================================================================

/**
 * A step in an inference chain.
 * Used to track reasoning during task execution.
 */
export interface InferenceStep {
  /** Unique identifier */
  id: string;
  /** Description of the inference */
  description: string;
  /** Premises used in this inference */
  premises: string[];
  /** Conclusion drawn */
  conclusion: string;
  /** Confidence in this inference */
  confidence: ConfidenceValue;
  /** Timestamp when this inference was made */
  timestamp: string;
}

// ============================================================================
// GATE CONTEXT
// ============================================================================

/**
 * Context information for evaluating quality gates.
 * Provides all relevant state for gate criteria evaluation.
 */
export interface GateContext {
  /** Current work stage */
  stage: WorkStage;

  /** Percentage of work complete (0-1) */
  percentComplete: number;

  /** Claims made about the task */
  claims: TaskClaim[];

  /** Groundings supporting claims */
  groundings: Grounding[];

  /** Inference steps taken */
  inferences: InferenceStep[];

  /** Time elapsed in milliseconds */
  timeElapsed: number;

  /** Sunk cost (effort invested) */
  sunkCost: number;

  /** Optional coherence network for full evaluation */
  network?: CoherenceNetwork;

  /** Optional epistemic objects for evaluation */
  objects?: EpistemicObject[];
}

// ============================================================================
// GATE CRITERIA
// ============================================================================

/**
 * Result of evaluating a single criterion.
 */
export interface CriteriaResult {
  /** Whether the criterion passed */
  passed: boolean;

  /** Score for this criterion (0-1) */
  score: number;

  /** Explanation of the result */
  explanation: string;

  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * A criterion for evaluating a quality gate.
 */
export interface GateCriteria {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Evaluation function */
  evaluate: (context: GateContext) => CriteriaResult;

  /** Weight of this criterion (0-1) */
  weight: number;
}

// ============================================================================
// REMEDIATION
// ============================================================================

/**
 * Effort level for a remediation action.
 */
export type RemediationEffort = 'trivial' | 'low' | 'medium' | 'high' | 'critical';

/**
 * A remediation action to address gate violations.
 */
export interface Remediation {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Type of remediation */
  type: 'clarify' | 'adjust' | 'rollback' | 'pivot' | 'abort' | 'hotfix';

  /** Estimated effort */
  effort: RemediationEffort;

  /** Specific steps to take */
  steps: string[];

  /** Which violations this addresses */
  addressesViolations: string[];
}

// ============================================================================
// GATE VIOLATION
// ============================================================================

/**
 * A violation of a quality gate criterion.
 */
export interface GateViolation {
  /** Criterion that was violated */
  criterionId: string;

  /** Criterion description */
  description: string;

  /** Severity of the violation */
  severity: 'minor' | 'major' | 'critical';

  /** Score achieved (0-1) */
  score: number;

  /** Threshold that was not met */
  threshold: number;

  /** Explanation of the violation */
  explanation: string;
}

// ============================================================================
// QUALITY GATE
// ============================================================================

/**
 * A quality gate that must be passed to proceed.
 */
export interface QualityGate {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Work stage this gate applies to */
  stage: WorkStage;

  /** Criteria to evaluate */
  criteria: GateCriteria[];

  /** Threshold score to pass (0-1) */
  threshold: number;

  /** Whether this gate must pass to proceed */
  blocking: boolean;

  /** Available remediations */
  remediations: Remediation[];
}

// ============================================================================
// GATE RESULT
// ============================================================================

/**
 * Result of evaluating a quality gate.
 */
export interface GateResult {
  /** The gate that was evaluated */
  gate: QualityGate;

  /** Whether the gate passed */
  passed: boolean;

  /** Overall score (0-1) */
  score: number;

  /** List of violations */
  violations: GateViolation[];

  /** Recommendations for improvement */
  recommendations: string[];

  /** Whether a pivot is recommended */
  shouldPivot: boolean;

  /** Estimated cost of pivoting */
  pivotCost: number;
}

// ============================================================================
// COURSE CORRECTION
// ============================================================================

/**
 * A course correction recommendation.
 */
export interface CourseCorrection {
  /** Type of correction */
  type: 'continue' | 'adjust' | 'partial_rollback' | 'full_pivot' | 'abort';

  /** Urgency level */
  urgency: 'low' | 'medium' | 'high' | 'critical';

  /** Detailed description */
  description: string;

  /** Actions to take */
  actions: Remediation[];

  /** Expected benefit of correction */
  expectedBenefit: string;

  /** Cost of not correcting */
  costOfInaction: string;

  /** Salvageable work from current approach */
  salvageValue: number;
}

// ============================================================================
// GATE CREATION
// ============================================================================

/**
 * Create a quality gate from partial configuration.
 *
 * @param config - Partial gate configuration
 * @returns A complete QualityGate
 */
export function createGate(config: Partial<QualityGate> & Pick<QualityGate, 'name' | 'stage'>): QualityGate {
  return {
    id: config.id ?? `gate_${randomUUID()}`,
    name: config.name,
    stage: config.stage,
    criteria: config.criteria ?? [],
    threshold: config.threshold ?? 0.7,
    blocking: config.blocking ?? false,
    remediations: config.remediations ?? [],
  };
}

/**
 * Create a gate criterion.
 *
 * @param config - Criterion configuration
 * @returns A GateCriteria instance
 */
export function createCriterion(
  config: Omit<GateCriteria, 'id'> & { id?: string }
): GateCriteria {
  return {
    id: config.id ?? `criterion_${randomUUID()}`,
    description: config.description,
    evaluate: config.evaluate,
    weight: config.weight,
  };
}

// ============================================================================
// GATE ENFORCEMENT
// ============================================================================

/**
 * Enforce a quality gate against a context.
 *
 * @param gate - The gate to enforce
 * @param context - The context to evaluate
 * @returns The gate result
 */
export function enforceGate(gate: QualityGate, context: GateContext): GateResult {
  const violations: GateViolation[] = [];
  const recommendations: string[] = [];

  // Evaluate each criterion
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const criterion of gate.criteria) {
    const result = criterion.evaluate(context);
    totalWeightedScore += result.score * criterion.weight;
    totalWeight += criterion.weight;

    if (!result.passed) {
      violations.push({
        criterionId: criterion.id,
        description: criterion.description,
        severity: result.score < 0.3 ? 'critical' : result.score < 0.5 ? 'major' : 'minor',
        score: result.score,
        threshold: gate.threshold,
        explanation: result.explanation,
      });

      if (result.suggestions) {
        recommendations.push(...result.suggestions);
      }
    }
  }

  // Calculate overall score
  const score = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
  const passed = score >= gate.threshold && violations.filter(v => v.severity === 'critical').length === 0;

  // Calculate pivot cost
  const pivotCost = calculatePivotCost(context);

  // Determine if pivot is recommended
  const shouldPivot = !passed && pivotCost < context.sunkCost * 0.5;

  // Add stage-specific recommendations
  recommendations.push(...getStageRecommendations(gate.stage, violations, context));

  // Add remediation recommendations
  for (const remediation of gate.remediations) {
    const relevantViolations = violations.filter(v =>
      remediation.addressesViolations.includes(v.criterionId)
    );
    if (relevantViolations.length > 0) {
      recommendations.push(`Consider: ${remediation.description} (${remediation.effort} effort)`);
    }
  }

  return {
    gate,
    passed,
    score,
    violations,
    recommendations,
    shouldPivot,
    pivotCost,
  };
}

/**
 * Evaluate all gates against a context.
 *
 * @param gates - Gates to evaluate
 * @param context - Context for evaluation
 * @returns Array of gate results
 */
export function evaluateAllGates(gates: QualityGate[], context: GateContext): GateResult[] {
  return gates
    .filter(gate => gate.stage === context.stage)
    .map(gate => enforceGate(gate, context));
}

// ============================================================================
// COURSE CORRECTION
// ============================================================================

/**
 * Suggest course correction based on gate results.
 *
 * @param results - Gate evaluation results
 * @returns Course correction recommendation
 */
export function suggestCourseCorrection(results: GateResult[]): CourseCorrection {
  const failedBlocking = results.filter(r => !r.passed && r.gate.blocking);
  const failedNonBlocking = results.filter(r => !r.passed && !r.gate.blocking);
  const criticalViolations = results.flatMap(r =>
    r.violations.filter(v => v.severity === 'critical')
  );

  // Determine correction type
  let type: CourseCorrection['type'];
  let urgency: CourseCorrection['urgency'];

  if (criticalViolations.length > 3) {
    type = 'abort';
    urgency = 'critical';
  } else if (failedBlocking.length > 0) {
    const shouldPivot = failedBlocking.some(r => r.shouldPivot);
    type = shouldPivot ? 'full_pivot' : 'partial_rollback';
    urgency = criticalViolations.length > 0 ? 'critical' : 'high';
  } else if (failedNonBlocking.length > 0) {
    type = failedNonBlocking.length > 2 ? 'partial_rollback' : 'adjust';
    urgency = failedNonBlocking.length > 2 ? 'medium' : 'low';
  } else {
    type = 'continue';
    urgency = 'low';
  }

  // Gather all recommendations
  const allRecommendations = results.flatMap(r => r.recommendations);

  // Gather all applicable remediations
  const actions: Remediation[] = [];
  for (const result of results) {
    if (!result.passed) {
      for (const remediation of result.gate.remediations) {
        const addressesViolation = result.violations.some(v =>
          remediation.addressesViolations.includes(v.criterionId)
        );
        if (addressesViolation && !actions.find(a => a.id === remediation.id)) {
          actions.push(remediation);
        }
      }
    }
  }

  // Calculate salvage value (average of non-failed scores)
  const allScores = results.map(r => r.score);
  const salvageValue = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0;

  // Build description
  const description = buildCorrectionDescription(type, failedBlocking, criticalViolations);

  return {
    type,
    urgency,
    description,
    actions: actions.sort((a, b) => {
      const effortOrder: Record<RemediationEffort, number> = {
        trivial: 0,
        low: 1,
        medium: 2,
        high: 3,
        critical: 4,
      };
      return effortOrder[a.effort] - effortOrder[b.effort];
    }),
    expectedBenefit: buildExpectedBenefit(type, results),
    costOfInaction: buildCostOfInaction(type, criticalViolations),
    salvageValue,
  };
}

/**
 * Calculate the cost of pivoting at current stage.
 *
 * @param context - Current gate context
 * @returns Estimated pivot cost
 */
export function calculatePivotCost(context: GateContext): number {
  const { stage, percentComplete, sunkCost, claims, groundings } = context;

  // Base cost is proportional to progress
  let baseCost = percentComplete * sunkCost;

  // Stage-specific multipliers
  const stageMultipliers: Record<WorkStage, number> = {
    [WorkStage.PRE_PLANNING]: 0.1, // Cheap to pivot early
    [WorkStage.EARLY_WORK]: 0.3,
    [WorkStage.MID_WORK]: 0.6,
    [WorkStage.LATE_WORK]: 0.9, // Expensive late
    [WorkStage.POST_COMPLETION]: 1.2, // Very expensive after done
  };

  baseCost *= stageMultipliers[stage];

  // Reduce cost if claims are poorly grounded (work was weak anyway)
  const groundedClaims = claims.filter(c =>
    groundings.some(g => g.to === (c.id as unknown as ObjectId))
  );
  const groundingRatio = claims.length > 0 ? groundedClaims.length / claims.length : 1;
  baseCost *= groundingRatio;

  return baseCost;
}

/**
 * Determine if work should be aborted based on gate results.
 *
 * @param results - Gate evaluation results
 * @returns Whether to abort
 */
export function shouldAbort(results: GateResult[]): boolean {
  // Abort if multiple critical blocking gates failed
  const criticalBlockingFailures = results.filter(
    r => !r.passed && r.gate.blocking &&
    r.violations.some(v => v.severity === 'critical')
  );

  if (criticalBlockingFailures.length >= 2) {
    return true;
  }

  // Abort if overall score across all gates is very low
  const averageScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.score, 0) / results.length
    : 1;

  if (averageScore < 0.3) {
    return true;
  }

  // Abort if pivot cost exceeds benefit
  const maxPivotCost = Math.max(...results.map(r => r.pivotCost), 0);
  const potentialRecovery = averageScore * 100; // Rough estimate
  if (maxPivotCost > potentialRecovery * 2) {
    return true;
  }

  return false;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getStageRecommendations(
  stage: WorkStage,
  violations: GateViolation[],
  context: GateContext
): string[] {
  const recommendations: string[] = [];

  switch (stage) {
    case WorkStage.PRE_PLANNING:
      if (violations.length > 0) {
        recommendations.push('Task understanding may be insufficient. Consider clarifying requirements.');
      }
      break;

    case WorkStage.EARLY_WORK:
      if (violations.some(v => v.severity === 'critical')) {
        recommendations.push('Early detection of potential wrong direction. Course correction is still cheap.');
      }
      break;

    case WorkStage.MID_WORK:
      if (violations.length > 0) {
        const salvageEstimate = (1 - context.percentComplete) * 100;
        recommendations.push(`Consider salvage value: ~${salvageEstimate.toFixed(0)}% of work may be reusable.`);
      }
      break;

    case WorkStage.LATE_WORK:
      if (context.percentComplete > 0.9 && violations.some(v => v.severity === 'minor')) {
        recommendations.push('Completion is close. Consider if minor issues can be addressed post-completion.');
      } else if (violations.some(v => v.severity === 'critical')) {
        recommendations.push('Critical issue detected late. Pause and assess before pushing to completion.');
      }
      break;

    case WorkStage.POST_COMPLETION:
      recommendations.push('Use retrospective analysis to improve future work.');
      if (violations.length > 0) {
        recommendations.push('Document discovered issues for remediation backlog.');
      }
      break;
  }

  return recommendations;
}

function buildCorrectionDescription(
  type: CourseCorrection['type'],
  failedBlocking: GateResult[],
  criticalViolations: GateViolation[]
): string {
  switch (type) {
    case 'continue':
      return 'All gates passed. Continue with current approach.';

    case 'adjust':
      return 'Minor adjustments needed. Address non-blocking issues without major changes.';

    case 'partial_rollback':
      return `Partial rollback recommended. ${failedBlocking.length} blocking gate(s) failed. ` +
        'Some work can be preserved.';

    case 'full_pivot':
      return `Full pivot recommended. ${criticalViolations.length} critical violation(s) detected. ` +
        'Fundamental approach change needed.';

    case 'abort':
      return 'Abort recommended. Multiple critical issues make continuation inadvisable. ' +
        'Reassess task requirements.';
  }
}

function buildExpectedBenefit(type: CourseCorrection['type'], results: GateResult[]): string {
  switch (type) {
    case 'continue':
      return 'Maintain momentum toward completion.';

    case 'adjust':
      return 'Improve quality while preserving progress.';

    case 'partial_rollback':
      return 'Recover from errors while preserving salvageable work.';

    case 'full_pivot':
      return 'Avoid sunk cost fallacy. Fresh approach has better success probability.';

    case 'abort':
      return 'Avoid wasted effort on fundamentally flawed approach.';
  }
}

function buildCostOfInaction(
  type: CourseCorrection['type'],
  criticalViolations: GateViolation[]
): string {
  switch (type) {
    case 'continue':
      return 'None - on track.';

    case 'adjust':
      return 'Minor issues may compound. Technical debt accumulation.';

    case 'partial_rollback':
      return 'Continued work may be wasted. Rework cost increases with progress.';

    case 'full_pivot':
      return 'Significant rework likely. Current approach has fundamental issues.';

    case 'abort':
      return `Critical failures: ${criticalViolations.map(v => v.description).join(', ')}. ` +
        'Continuation risks complete failure.';
  }
}

// ============================================================================
// PRESET GATES
// ============================================================================

/**
 * Create the grounding gate criterion.
 */
function createGroundingCriterion(): GateCriteria {
  return createCriterion({
    id: 'grounding_confidence',
    description: 'Minimum grounding confidence for claims',
    weight: 1.0,
    evaluate: (context: GateContext): CriteriaResult => {
      if (context.claims.length === 0) {
        return {
          passed: true,
          score: 1.0,
          explanation: 'No claims to evaluate.',
        };
      }

      // Check grounding for each claim
      const claimScores: number[] = [];
      const ungrounded: string[] = [];

      for (const claim of context.claims) {
        const claimGroundings = context.groundings.filter(
          g => g.to === (claim.id as unknown as ObjectId)
        );

        if (claimGroundings.length === 0) {
          claimScores.push(0);
          ungrounded.push(claim.taskDescription);
        } else {
          const avgStrength = claimGroundings.reduce((sum, g) => sum + g.strength.value, 0) /
            claimGroundings.length;
          claimScores.push(avgStrength);
        }
      }

      const avgScore = claimScores.reduce((a, b) => a + b, 0) / claimScores.length;
      const passed = avgScore >= 0.6;

      return {
        passed,
        score: avgScore,
        explanation: ungrounded.length > 0
          ? `${ungrounded.length} claim(s) lack grounding.`
          : `Average grounding strength: ${(avgScore * 100).toFixed(1)}%`,
        suggestions: ungrounded.length > 0
          ? ['Add evidence or reasoning to support ungrounded claims.']
          : undefined,
      };
    },
  });
}

/**
 * Create the coherence gate criterion.
 */
function createCoherenceCriterion(): GateCriteria {
  return createCriterion({
    id: 'coherence_check',
    description: 'No major contradictions in work',
    weight: 1.0,
    evaluate: (context: GateContext): CriteriaResult => {
      if (!context.network && !context.objects) {
        // No network to evaluate - pass by default
        return {
          passed: true,
          score: 1.0,
          explanation: 'No coherence network available for evaluation.',
        };
      }

      // Evaluate coherence if we have objects
      if (context.objects && context.objects.length > 0) {
        const result = evaluateCoherence(context.objects);
        const contradictions = result.status.violations.filter(
          v => v.rule.type === 'no_contradictions'
        );

        const passed = contradictions.length === 0;
        const score = result.status.score;

        return {
          passed,
          score,
          explanation: contradictions.length > 0
            ? `${contradictions.length} contradiction(s) detected.`
            : 'No contradictions detected.',
          suggestions: contradictions.map(c => c.remediation).filter((r): r is string => r !== undefined),
        };
      }

      // Evaluate from network
      if (context.network) {
        const result = evaluateCoherence(context.network);
        const contradictions = result.status.violations.filter(
          v => v.rule.type === 'no_contradictions'
        );

        return {
          passed: contradictions.length === 0,
          score: result.status.score,
          explanation: contradictions.length > 0
            ? `${contradictions.length} contradiction(s) detected.`
            : 'No contradictions detected.',
          suggestions: contradictions.map(c => c.remediation).filter((r): r is string => r !== undefined),
        };
      }

      return {
        passed: true,
        score: 1.0,
        explanation: 'No data available for coherence evaluation.',
      };
    },
  });
}

/**
 * Create the progress gate criterion.
 */
function createProgressCriterion(): GateCriteria {
  return createCriterion({
    id: 'progress_rate',
    description: 'Reasonable progress rate',
    weight: 0.8,
    evaluate: (context: GateContext): CriteriaResult => {
      if (context.timeElapsed <= 0) {
        return {
          passed: true,
          score: 1.0,
          explanation: 'Time tracking not available.',
        };
      }

      // Calculate expected progress based on time
      // Assume linear progress model for simplicity
      const progressRate = context.percentComplete / (context.timeElapsed / 1000 / 60); // progress per minute

      // Define acceptable range (very permissive for now)
      const minAcceptableRate = 0.001; // 0.1% per minute minimum
      const optimalRate = 0.01; // 1% per minute optimal

      let score: number;
      if (progressRate >= optimalRate) {
        score = 1.0;
      } else if (progressRate >= minAcceptableRate) {
        score = 0.5 + (0.5 * (progressRate - minAcceptableRate) / (optimalRate - minAcceptableRate));
      } else {
        score = 0.5 * (progressRate / minAcceptableRate);
      }

      const passed = score >= 0.5;

      return {
        passed,
        score: Math.min(1, Math.max(0, score)),
        explanation: `Progress rate: ${(progressRate * 100).toFixed(3)}% per minute.`,
        suggestions: !passed
          ? ['Consider if task scope is appropriate.', 'Check for blockers.']
          : undefined,
      };
    },
  });
}

/**
 * Create the evidence gate criterion.
 */
function createEvidenceCriterion(): GateCriteria {
  return createCriterion({
    id: 'evidence_sufficiency',
    description: 'Sufficient evidence for claims',
    weight: 1.0,
    evaluate: (context: GateContext): CriteriaResult => {
      if (context.claims.length === 0) {
        return {
          passed: true,
          score: 1.0,
          explanation: 'No claims requiring evidence.',
        };
      }

      // Each claim should have at least one grounding
      const claimsWithEvidence = context.claims.filter(claim =>
        context.groundings.some(g => g.to === (claim.id as unknown as ObjectId))
      );

      const evidenceRatio = claimsWithEvidence.length / context.claims.length;
      const passed = evidenceRatio >= 0.8;

      return {
        passed,
        score: evidenceRatio,
        explanation: `${claimsWithEvidence.length}/${context.claims.length} claims have supporting evidence.`,
        suggestions: !passed
          ? ['Gather evidence for unsupported claims.', 'Consider removing unfounded claims.']
          : undefined,
      };
    },
  });
}

/**
 * Create the completion bias gate criterion.
 */
function createCompletionBiasCriterion(): GateCriteria {
  return createCriterion({
    id: 'completion_bias',
    description: 'Detect rushing to finish',
    weight: 0.9,
    evaluate: (context: GateContext): CriteriaResult => {
      // Completion bias is most relevant in late work
      if (context.stage !== WorkStage.LATE_WORK && context.stage !== WorkStage.POST_COMPLETION) {
        return {
          passed: true,
          score: 1.0,
          explanation: 'Completion bias check not applicable at this stage.',
        };
      }

      const indicators: string[] = [];
      let biasScore = 0;

      // Check 1: Are recent claims less well-grounded?
      if (context.claims.length >= 3) {
        const recentClaims = context.claims.slice(-Math.ceil(context.claims.length / 3));
        const recentGroundingCount = recentClaims.filter(c =>
          context.groundings.some(g => g.to === (c.id as unknown as ObjectId))
        ).length;
        const recentGroundingRatio = recentGroundingCount / recentClaims.length;

        const oldClaims = context.claims.slice(0, -Math.ceil(context.claims.length / 3));
        const oldGroundingCount = oldClaims.filter(c =>
          context.groundings.some(g => g.to === (c.id as unknown as ObjectId))
        ).length;
        const oldGroundingRatio = oldClaims.length > 0 ? oldGroundingCount / oldClaims.length : 1;

        if (recentGroundingRatio < oldGroundingRatio - 0.2) {
          biasScore += 0.3;
          indicators.push('Recent claims are less well-grounded than earlier claims.');
        }
      }

      // Check 2: Are inferences getting weaker?
      if (context.inferences.length >= 3) {
        const recentInferences = context.inferences.slice(-Math.ceil(context.inferences.length / 3));
        const recentConfidences = recentInferences.map(i => getNumericValue(i.confidence) ?? 0.5);
        const avgRecentConfidence = recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length;

        if (avgRecentConfidence < 0.5) {
          biasScore += 0.3;
          indicators.push('Recent inferences have low confidence.');
        }
      }

      // Check 3: Is progress accelerating suspiciously?
      // (This would need historical progress data - simplified check)
      if (context.percentComplete > 0.9 && context.claims.length < 5) {
        biasScore += 0.2;
        indicators.push('Near completion with few claims - may be rushing.');
      }

      // Check 4: Many assumptions in recent work
      const recentAssumptions = context.claims
        .slice(-Math.ceil(context.claims.length / 3))
        .flatMap(c => c.assumptions);
      if (recentAssumptions.length > 5) {
        biasScore += 0.2;
        indicators.push('High number of assumptions in recent work.');
      }

      const score = 1 - Math.min(1, biasScore);
      const passed = score >= 0.6;

      return {
        passed,
        score,
        explanation: indicators.length > 0
          ? `Completion bias indicators: ${indicators.join(' ')}`
          : 'No completion bias detected.',
        suggestions: indicators.length > 0
          ? ['Pause and verify work quality.', 'Review recent claims for proper grounding.']
          : undefined,
      };
    },
  });
}

/**
 * Grounding Gate - Minimum grounding confidence for claims.
 */
export const GROUNDING_GATE: QualityGate = createGate({
  id: 'grounding_gate',
  name: 'Grounding Gate',
  stage: WorkStage.MID_WORK,
  threshold: 0.6,
  blocking: true,
  criteria: [createGroundingCriterion()],
  remediations: [
    {
      id: 'add_evidence',
      description: 'Add evidence to support ungrounded claims',
      type: 'adjust',
      effort: 'medium',
      steps: [
        'Identify ungrounded claims',
        'Gather supporting evidence',
        'Create grounding relations',
      ],
      addressesViolations: ['grounding_confidence'],
    },
  ],
});

/**
 * Coherence Gate - No major contradictions.
 */
export const COHERENCE_GATE: QualityGate = createGate({
  id: 'coherence_gate',
  name: 'Coherence Gate',
  stage: WorkStage.MID_WORK,
  threshold: 0.8,
  blocking: true,
  criteria: [createCoherenceCriterion()],
  remediations: [
    {
      id: 'resolve_contradictions',
      description: 'Resolve detected contradictions',
      type: 'adjust',
      effort: 'medium',
      steps: [
        'Identify contradicting claims',
        'Determine which claim is correct',
        'Remove or modify incorrect claim',
        'Update dependent claims',
      ],
      addressesViolations: ['coherence_check'],
    },
  ],
});

/**
 * Progress Gate - Reasonable progress rate.
 */
export const PROGRESS_GATE: QualityGate = createGate({
  id: 'progress_gate',
  name: 'Progress Gate',
  stage: WorkStage.EARLY_WORK,
  threshold: 0.5,
  blocking: false,
  criteria: [createProgressCriterion()],
  remediations: [
    {
      id: 'address_blockers',
      description: 'Address progress blockers',
      type: 'adjust',
      effort: 'low',
      steps: [
        'Identify blocking issues',
        'Seek clarification if needed',
        'Consider task decomposition',
      ],
      addressesViolations: ['progress_rate'],
    },
  ],
});

/**
 * Evidence Gate - Sufficient evidence for claims.
 */
export const EVIDENCE_GATE: QualityGate = createGate({
  id: 'evidence_gate',
  name: 'Evidence Gate',
  stage: WorkStage.LATE_WORK,
  threshold: 0.8,
  blocking: true,
  criteria: [createEvidenceCriterion()],
  remediations: [
    {
      id: 'gather_evidence',
      description: 'Gather evidence for unsupported claims',
      type: 'adjust',
      effort: 'medium',
      steps: [
        'List claims lacking evidence',
        'Research or test to gather evidence',
        'Document evidence and create groundings',
      ],
      addressesViolations: ['evidence_sufficiency'],
    },
  ],
});

/**
 * Completion Bias Gate - Detect rushing to finish.
 */
export const COMPLETION_BIAS_GATE: QualityGate = createGate({
  id: 'completion_bias_gate',
  name: 'Completion Bias Gate',
  stage: WorkStage.LATE_WORK,
  threshold: 0.6,
  blocking: true,
  criteria: [createCompletionBiasCriterion()],
  remediations: [
    {
      id: 'slow_down',
      description: 'Slow down and verify work quality',
      type: 'adjust',
      effort: 'low',
      steps: [
        'Pause current work',
        'Review recent claims for quality',
        'Add proper grounding to weak claims',
        'Resume with proper pacing',
      ],
      addressesViolations: ['completion_bias'],
    },
  ],
});

/**
 * All preset gates organized by stage.
 */
export const PRESET_GATES: Record<WorkStage, QualityGate[]> = {
  [WorkStage.PRE_PLANNING]: [],
  [WorkStage.EARLY_WORK]: [PROGRESS_GATE],
  [WorkStage.MID_WORK]: [GROUNDING_GATE, COHERENCE_GATE],
  [WorkStage.LATE_WORK]: [EVIDENCE_GATE, COMPLETION_BIAS_GATE],
  [WorkStage.POST_COMPLETION]: [],
};

/**
 * Get all preset gates for a given stage.
 *
 * @param stage - The work stage
 * @returns Array of applicable gates
 */
export function getPresetsForStage(stage: WorkStage): QualityGate[] {
  return PRESET_GATES[stage] ?? [];
}

/**
 * Get all preset gates.
 *
 * @returns Array of all preset gates
 */
export function getAllPresetGates(): QualityGate[] {
  return Object.values(PRESET_GATES).flat();
}
