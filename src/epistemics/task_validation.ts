/**
 * @fileoverview Epistemic Task Validation System
 *
 * Implements a system for validating tasks as epistemic claims before execution.
 * This ensures agents work on the RIGHT task with sufficient justification,
 * addressing pathologies like:
 * - Wrong-task pathology: Working efficiently on the wrong problem
 * - Tunnel vision: Failing to consider alternatives
 * - Confirmation bias: Not seeking counter-evidence
 * - Low-warrant execution: Acting on insufficient justification
 *
 * The system draws from three epistemological traditions:
 * - Reliabilism (Goldman): Knowledge requires reliable belief-forming processes
 * - Coherentism: Beliefs justified by coherence with other beliefs
 * - Bayesian Epistemology: Beliefs as credences updated by evidence
 *
 * @see docs/librarian/specs/epistemic-task-validation.md for full specification
 *
 * @packageDocumentation
 */

import type { ConfidenceValue, CalibrationStatus, DerivedConfidence } from './confidence.js';
import {
  checkConfidenceThreshold,
  sequenceConfidence,
  getNumericValue,
  getEffectiveConfidence,
  absent,
  bounded,
  deterministic,
  measuredConfidence,
  computeCalibrationStatus,
} from './confidence.js';
import type { ExtendedDefeater } from './types.js';
import type { EvidenceId, IEvidenceLedger, SessionId } from './evidence_ledger.js';
import type { EvidenceGraphStorage } from './storage.js';
import { CalibrationTracker } from './calibration_laws.js';
import {
  detectDefeaters,
  applyDefeatersToConfidence,
  type DefeaterEngineConfig,
  DEFAULT_DEFEATER_CONFIG,
} from './defeaters.js';

// ============================================================================
// BRANDED TYPES
// ============================================================================

/**
 * Branded type for claim IDs to prevent accidental mixing.
 */
export type ClaimId = string & { readonly __brand: 'ClaimId' };

/**
 * Branded type for task IDs to prevent accidental mixing.
 */
export type TaskId = string & { readonly __brand: 'TaskId' };

/**
 * Create a ClaimId from a string.
 *
 * @param id - The string identifier
 * @returns A branded ClaimId
 */
export function createClaimId(id: string): ClaimId {
  return id as ClaimId;
}

/**
 * Create a TaskId from a string.
 *
 * @param id - The string identifier
 * @returns A branded TaskId
 */
export function createTaskId(id: string): TaskId {
  return id as TaskId;
}

// ============================================================================
// TASK CLAIM
// ============================================================================

/**
 * A task as an epistemic claim - the assertion that this task
 * should be performed to achieve a goal.
 *
 * Tasks are treated as first-class epistemic objects requiring:
 * - Evidence for why this is the correct problem to solve
 * - Consideration of alternatives
 * - Counter-analysis of potential objections
 * - Warrant for the chosen method
 *
 * @example
 * ```typescript
 * const taskClaim: TaskClaim = {
 *   id: createClaimId('task_claim_fix_auth_bug'),
 *   proposition: 'Task "Fix authentication timeout" should be performed to achieve: Improve user login experience',
 *   type: 'task_validity',
 *   task: {
 *     id: createTaskId('fix_auth_timeout'),
 *     description: 'Fix authentication timeout',
 *     goal: 'Improve user login experience',
 *     method: 'Increase session timeout and add retry logic',
 *   },
 *   grounding: { ... },
 *   confidence: measuredConfidence({ ... }),
 *   calibrationStatus: 'preserved',
 *   defeaters: [],
 *   status: 'validated',
 *   schemaVersion: '1.0.0',
 * };
 * ```
 */
export interface TaskClaim {
  /**
   * Unique identifier for this claim.
   */
  readonly id: ClaimId;

  /**
   * The proposition being claimed.
   * Format: "Task X should be performed to achieve goal Y"
   */
  readonly proposition: string;

  /**
   * Type of claim - always 'task_validity' for task claims.
   */
  readonly type: 'task_validity';

  /**
   * Task-specific fields describing what should be done.
   */
  readonly task: {
    /** Unique identifier for the task */
    readonly id: TaskId;
    /** Human-readable description of the task */
    readonly description: string;
    /** The goal this task is meant to achieve */
    readonly goal: string;
    /** The method/approach to be used */
    readonly method: string;
  };

  /**
   * Epistemic grounding - what justifies this task.
   * This is the core of the epistemic validation.
   */
  readonly grounding: TaskEpistemicGrounding;

  /**
   * Overall task confidence (derived from grounding components).
   * Must have proper provenance - no raw numbers.
   */
  readonly confidence: ConfidenceValue;

  /**
   * Calibration status of the confidence derivation.
   * - 'preserved': All inputs are calibrated
   * - 'degraded': Some inputs are uncalibrated
   * - 'unknown': Calibration status cannot be determined
   */
  readonly calibrationStatus: CalibrationStatus;

  /**
   * Active defeaters against this task.
   * If any full-severity defeaters exist, the task should be blocked.
   */
  readonly defeaters: readonly ExtendedDefeater[];

  /**
   * Status tracking for the task validation process.
   */
  readonly status: 'pending_validation' | 'validated' | 'blocked' | 'invalidated';

  /**
   * Schema version for forward compatibility and migration.
   */
  readonly schemaVersion: string;
}

// ============================================================================
// TASK EPISTEMIC GROUNDING
// ============================================================================

/**
 * The epistemic grounding for a task - evidence that it's the RIGHT task.
 *
 * This captures the four pillars of task justification:
 * 1. Problem identification: Is this actually the problem to solve?
 * 2. Alternatives considered: Were other approaches evaluated?
 * 3. Counter-analysis: Were objections addressed?
 * 4. Method warrant: Is the approach historically reliable?
 *
 * @example
 * ```typescript
 * const grounding: TaskEpistemicGrounding = {
 *   problemIdentification: {
 *     evidence: [evidenceId1, evidenceId2],
 *     confidence: measuredConfidence({ ... }),
 *     method: 'analysis',
 *   },
 *   alternativesConsidered: {
 *     alternatives: [
 *       {
 *         description: 'Rewrite entire auth system',
 *         reason_rejected: 'Too risky for timeline',
 *         confidence_in_rejection: bounded(0.7, 0.9, 'theoretical', 'Risk analysis'),
 *       },
 *     ],
 *     thoroughness: deterministic(true, 'alternatives_documented'),
 *   },
 *   counterAnalysis: { ... },
 *   methodWarrant: { ... },
 * };
 * ```
 */
export interface TaskEpistemicGrounding {
  /**
   * Evidence that this is actually the problem to solve.
   * High confidence here means we're confident in the problem identification.
   */
  readonly problemIdentification: {
    /** Evidence IDs supporting the problem identification */
    readonly evidence: readonly EvidenceId[];
    /** Confidence in the problem identification */
    readonly confidence: ConfidenceValue;
    /** How the problem was identified */
    readonly method: 'user_statement' | 'analysis' | 'inferred' | 'measured';
  };

  /**
   * Evidence that alternatives were considered.
   * This prevents tunnel vision and ensures best approach is selected.
   */
  readonly alternativesConsidered: {
    /** List of alternatives that were considered and rejected */
    readonly alternatives: readonly TaskAlternative[];
    /** How exhaustively were alternatives searched? */
    readonly thoroughness: ConfidenceValue;
  };

  /**
   * Evidence that counter-analyses were performed.
   * This prevents confirmation bias by requiring objection handling.
   */
  readonly counterAnalysis: {
    /** List of objections that were addressed */
    readonly objections: readonly TaskObjection[];
    /** How thoroughly were objections sought? */
    readonly completeness: ConfidenceValue;
  };

  /**
   * Evidence for the chosen method/approach.
   * This provides warrant based on historical reliability.
   */
  readonly methodWarrant: {
    /** Description of the method */
    readonly method: string;
    /** Has this approach worked before? */
    readonly historicalReliability: ConfidenceValue;
    /** Does it apply to this situation? */
    readonly applicability: ConfidenceValue;
    /** Optional calibration data for the method */
    readonly calibrationData?: MethodCalibrationData;
  };
}

/**
 * An alternative approach that was considered but rejected.
 */
export interface TaskAlternative {
  /** Description of the alternative approach */
  readonly description: string;
  /** Why this alternative was rejected */
  readonly reason_rejected: string;
  /** Confidence in the rejection decision */
  readonly confidence_in_rejection: ConfidenceValue;
}

/**
 * An objection to the task that was addressed.
 */
export interface TaskObjection {
  /** The objection or concern raised */
  readonly objection: string;
  /** How the objection was addressed */
  readonly response: string;
  /** Confidence in the response adequately addressing the objection */
  readonly response_strength: ConfidenceValue;
}

/**
 * Calibration data for a method's historical reliability.
 */
export interface MethodCalibrationData {
  /** Identifier for the calibration dataset */
  readonly datasetId: string;
  /** Number of samples in the dataset */
  readonly sampleSize: number;
  /** Historical success rate of this method */
  readonly successRate: number;
}

// ============================================================================
// VALIDATION CRITERIA
// ============================================================================

/**
 * Criteria for determining if a task has sufficient epistemic grounding.
 *
 * These thresholds can be configured per-project or per-task-type to
 * balance rigor against velocity.
 *
 * @example
 * ```typescript
 * const criteria: TaskValidationCriteria = {
 *   minimumConfidence: 0.6,
 *   minimumProblemConfidence: 0.7,
 *   minimumAlternativesConsidered: 1,
 *   requireCounterAnalysis: true,
 *   // ... other fields
 * };
 * ```
 */
export interface TaskValidationCriteria {
  /**
   * Minimum overall confidence to proceed with the task.
   * @default 0.6
   */
  readonly minimumConfidence: number;

  /**
   * Minimum confidence for problem identification.
   * Higher than overall because wrong problem is the biggest risk.
   * @default 0.7
   */
  readonly minimumProblemConfidence: number;

  /**
   * Minimum number of alternatives that must be considered.
   * @default 1
   */
  readonly minimumAlternativesConsidered: number;

  /**
   * Whether counter-analysis is required.
   * @default true
   */
  readonly requireCounterAnalysis: boolean;

  /**
   * Minimum objections that must be addressed.
   * @default 1
   */
  readonly minimumObjectionsAddressed: number;

  /**
   * Whether method must have calibration data.
   * @default false (relaxed default for adoption)
   */
  readonly requireMethodCalibration: boolean;

  /**
   * Whether to allow tasks with degraded calibration status.
   * @default true (with warning)
   */
  readonly allowDegradedCalibration: boolean;

  /**
   * Whether to allow tasks with unknown calibration status.
   * @default false
   */
  readonly allowUnknownCalibration: boolean;

  /**
   * Whether to block on full-severity defeaters.
   * @default true
   */
  readonly blockOnFullDefeater: boolean;

  /**
   * Whether to block on partial-severity defeaters.
   * @default false
   */
  readonly blockOnPartialDefeater: boolean;

  /**
   * Maximum staleness for supporting evidence in milliseconds.
   * @default 7 days
   */
  readonly maxEvidenceAgeMs: number;
}

// ============================================================================
// VALIDATION PRESETS
// ============================================================================

/**
 * Preset configurations for common use cases.
 *
 * Choose based on the stakes of the task:
 * - strict: For high-stakes decisions where mistakes are costly
 * - standard: Balanced approach for most tasks
 * - relaxed: For exploratory work where speed matters more than rigor
 *
 * @example
 * ```typescript
 * // Use strict for production deployments
 * const result = await validator.validate(task, ValidationPresets.strict);
 *
 * // Use relaxed for exploratory prototyping
 * const result = await validator.validate(task, ValidationPresets.relaxed);
 * ```
 */
export const ValidationPresets = {
  /**
   * Strict validation - for high-stakes decisions.
   *
   * Requires:
   * - 75% overall confidence
   * - 80% problem confidence
   * - At least 2 alternatives considered
   * - At least 2 objections addressed
   * - Calibrated method data
   * - Evidence no older than 3 days
   */
  strict: {
    minimumConfidence: 0.75,
    minimumProblemConfidence: 0.8,
    minimumAlternativesConsidered: 2,
    requireCounterAnalysis: true,
    minimumObjectionsAddressed: 2,
    requireMethodCalibration: true,
    allowDegradedCalibration: false,
    allowUnknownCalibration: false,
    blockOnFullDefeater: true,
    blockOnPartialDefeater: true,
    maxEvidenceAgeMs: 3 * 24 * 60 * 60 * 1000, // 3 days
  },

  /**
   * Standard validation - balanced approach.
   *
   * Requires:
   * - 60% overall confidence
   * - 70% problem confidence
   * - At least 1 alternative considered
   * - At least 1 objection addressed
   * - Evidence no older than 7 days
   */
  standard: {
    minimumConfidence: 0.6,
    minimumProblemConfidence: 0.7,
    minimumAlternativesConsidered: 1,
    requireCounterAnalysis: true,
    minimumObjectionsAddressed: 1,
    requireMethodCalibration: false,
    allowDegradedCalibration: true,
    allowUnknownCalibration: false,
    blockOnFullDefeater: true,
    blockOnPartialDefeater: false,
    maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  /**
   * Relaxed validation - for exploratory work.
   *
   * Requires:
   * - 40% overall confidence
   * - 50% problem confidence
   * - No minimum alternatives
   * - No counter-analysis required
   * - Unknown calibration allowed
   * - Evidence no older than 30 days
   */
  relaxed: {
    minimumConfidence: 0.4,
    minimumProblemConfidence: 0.5,
    minimumAlternativesConsidered: 0,
    requireCounterAnalysis: false,
    minimumObjectionsAddressed: 0,
    requireMethodCalibration: false,
    allowDegradedCalibration: true,
    allowUnknownCalibration: true,
    blockOnFullDefeater: true,
    blockOnPartialDefeater: false,
    maxEvidenceAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
} as const;

/**
 * Type for validation preset names.
 */
export type ValidationPresetName = keyof typeof ValidationPresets;

// ============================================================================
// VALIDATION RESULT
// ============================================================================

/**
 * Result of task validation.
 *
 * Provides detailed diagnostics on why a task passed or failed validation,
 * including specific breakdown by component and actionable remediation.
 *
 * @example
 * ```typescript
 * const result = await validator.validate(task, ValidationPresets.standard);
 *
 * if (!result.valid) {
 *   console.log('Blocking reasons:', result.blockingReasons);
 *   console.log('Remediation:', result.remediation?.actions);
 * }
 * ```
 */
export interface TaskValidationResult {
  /**
   * Whether the task passed validation.
   */
  readonly valid: boolean;

  /**
   * Overall confidence in the task.
   */
  readonly confidence: ConfidenceValue;

  /**
   * Calibration status of the confidence derivation.
   */
  readonly calibrationStatus: CalibrationStatus;

  /**
   * Detailed breakdown of validation by component.
   */
  readonly breakdown: TaskValidationBreakdown;

  /**
   * Active defeaters against the task.
   */
  readonly defeaters: readonly ExtendedDefeater[];

  /**
   * Blocking reasons (if invalid).
   * Each string describes why the task cannot proceed.
   */
  readonly blockingReasons: readonly string[];

  /**
   * Warnings (non-blocking issues).
   * Issues that should be addressed but don't block execution.
   */
  readonly warnings: readonly string[];

  /**
   * Remediation plan for fixing validation failures.
   * Only present if validation failed.
   */
  readonly remediation?: RemediationPlan;
}

/**
 * Detailed breakdown of validation by component.
 */
export interface TaskValidationBreakdown {
  /**
   * Problem identification validation result.
   */
  readonly problemIdentification: {
    /** Whether the requirement was met */
    readonly met: boolean;
    /** Actual confidence achieved */
    readonly confidence: ConfidenceValue;
    /** Required confidence threshold */
    readonly required: number;
    /** Optional reason for failure */
    readonly reason?: string;
  };

  /**
   * Alternatives consideration validation result.
   */
  readonly alternativesConsidered: {
    /** Whether the requirement was met */
    readonly met: boolean;
    /** Number of alternatives documented */
    readonly count: number;
    /** Required number of alternatives */
    readonly required: number;
    /** List of alternative descriptions */
    readonly alternatives: readonly string[];
    /** Optional reason for failure */
    readonly reason?: string;
  };

  /**
   * Counter-analysis validation result.
   */
  readonly counterAnalysis: {
    /** Whether the requirement was met */
    readonly met: boolean;
    /** Number of objections addressed */
    readonly objectionsAddressed: number;
    /** Required number of objections */
    readonly required: number;
    /** List of objection descriptions */
    readonly objections: readonly string[];
    /** Optional reason for failure */
    readonly reason?: string;
  };

  /**
   * Method warrant validation result.
   */
  readonly methodWarrant: {
    /** Whether the requirement was met */
    readonly met: boolean;
    /** Confidence in the method */
    readonly confidence: ConfidenceValue;
    /** Whether the method has calibration data */
    readonly calibrated: boolean;
    /** Optional reason for failure */
    readonly reason?: string;
  };

  /**
   * Evidence freshness validation result.
   */
  readonly evidenceFreshness: {
    /** Whether the requirement was met */
    readonly met: boolean;
    /** Age of oldest evidence in milliseconds */
    readonly oldestEvidenceAge: number;
    /** Maximum allowed age in milliseconds */
    readonly maxAllowed: number;
    /** IDs of stale evidence */
    readonly staleEvidence: readonly EvidenceId[];
  };
}

// ============================================================================
// REMEDIATION
// ============================================================================

/**
 * A plan for remediating a failed task validation.
 *
 * Provides prioritized, actionable steps to achieve sufficient
 * epistemic grounding for the task.
 *
 * @example
 * ```typescript
 * const plan = validator.generateRemediation(failedResult);
 *
 * console.log('Critical path:', plan.criticalPath.map(a => a.description));
 * console.log('Estimated effort:', plan.estimatedEffort.typical);
 * ```
 */
export interface RemediationPlan {
  /**
   * ID of the task being remediated.
   */
  readonly taskId: string;

  /**
   * Ordered list of remediation actions.
   * Actions are sorted by priority (0 = highest).
   */
  readonly actions: readonly RemediationAction[];

  /**
   * Estimated effort to complete remediation.
   */
  readonly estimatedEffort: {
    /** Just the blocking issues */
    readonly minimal: string;
    /** Blocking + major warnings */
    readonly typical: string;
    /** Complete remediation */
    readonly thorough: string;
  };

  /**
   * Critical path - actions that must be completed.
   * These are the minimum actions required to pass validation.
   */
  readonly criticalPath: readonly RemediationAction[];
}

/**
 * A single remediation action.
 *
 * Describes a specific step to improve the epistemic grounding
 * of a task that failed validation.
 */
export interface RemediationAction {
  /**
   * Type of action to take.
   */
  readonly type: RemediationActionType;

  /**
   * Priority of the action (0 = highest).
   * Lower numbers should be addressed first.
   */
  readonly priority: number;

  /**
   * Human-readable description of the action.
   */
  readonly description: string;

  /**
   * Suggested approaches for completing this action.
   */
  readonly suggestions: readonly string[];

  /**
   * Target confidence (for evidence gathering actions).
   * The confidence level that should be achieved.
   */
  readonly targetConfidence?: number;

  /**
   * Target count (for alternatives/objections actions).
   * The number of items that should be documented.
   */
  readonly targetCount?: number;

  /**
   * Stale evidence IDs (for refresh actions).
   */
  readonly staleEvidence?: readonly EvidenceId[];

  /**
   * Defeater ID (for resolution actions).
   */
  readonly defeaterId?: string;

  /**
   * Target entities that this action should focus on.
   * For example, file paths, function names, etc.
   */
  readonly targets?: readonly string[];
}

/**
 * Types of remediation actions.
 */
export type RemediationActionType =
  | 'gather_evidence'      // Gather more evidence for problem identification
  | 'consider_alternatives' // Document more alternative approaches
  | 'address_objections'    // Address more potential objections
  | 'validate_method'       // Strengthen confidence in the method
  | 'refresh_evidence'      // Update stale evidence
  | 'resolve_defeater';     // Resolve an active defeater

// ============================================================================
// GROUNDING CONTEXT
// ============================================================================

/**
 * Context for building task grounding.
 *
 * Provides access to the evidence ledger and storage needed to
 * query existing evidence and build grounding for a new task.
 *
 * @example
 * ```typescript
 * const context: GroundingContext = {
 *   ledger: evidenceLedger,
 *   storage: graphStorage,
 *   sessionId: createSessionId(),
 *   userAlternatives: ['Approach A', 'Approach B'],
 *   userObjections: ['What about performance?'],
 * };
 *
 * const taskClaim = await validator.buildGrounding(taskInfo, context);
 * ```
 */
export interface GroundingContext {
  /**
   * The evidence ledger for querying past evidence.
   */
  readonly ledger: IEvidenceLedger;

  /**
   * The evidence graph storage for claims and defeaters.
   */
  readonly storage: EvidenceGraphStorage;

  /**
   * Current session ID for provenance tracking.
   */
  readonly sessionId: SessionId;

  /**
   * User-provided alternatives (if any).
   * These will be incorporated into the grounding.
   */
  readonly userAlternatives?: readonly string[];

  /**
   * User-provided objections (if any).
   * These will be incorporated into the grounding.
   */
  readonly userObjections?: readonly string[];

  /**
   * Method calibration data (if available).
   * If provided, enables calibrated method confidence.
   */
  readonly methodCalibration?: MethodCalibrationData;
}

// ============================================================================
// VALIDATOR INTERFACE
// ============================================================================

/**
 * Validates that tasks have sufficient epistemic grounding before execution.
 *
 * The validator is the core component of the epistemic task validation system.
 * It integrates with the evidence ledger and storage to:
 * - Validate existing task claims against criteria
 * - Build grounding for new tasks
 * - Check for defeaters
 * - Generate remediation plans
 *
 * @example
 * ```typescript
 * const validator = new TaskEpistemicValidator(ledger, storage);
 *
 * // Validate an existing task claim
 * const result = await validator.validate(taskClaim, ValidationPresets.strict);
 *
 * if (!result.valid) {
 *   // Get remediation plan
 *   const plan = validator.generateRemediation(result);
 *   console.log('Actions needed:', plan.actions.map(a => a.description));
 * }
 *
 * // Build grounding for a new task
 * const newTask = await validator.buildGrounding(
 *   { id: taskId, description: 'Fix bug', goal: 'Stability', method: 'Patch' },
 *   context
 * );
 * ```
 */
export interface ITaskEpistemicValidator {
  /**
   * Validate a task claim against the configured criteria.
   *
   * @param task - The task claim to validate
   * @param criteria - Validation criteria (defaults to 'standard' preset)
   * @returns Validation result with detailed diagnostics
   */
  validate(
    task: TaskClaim,
    criteria?: TaskValidationCriteria
  ): Promise<TaskValidationResult>;

  /**
   * Build grounding evidence for a task from available sources.
   *
   * Queries the evidence ledger and storage to find supporting evidence
   * and constructs a TaskClaim with populated grounding.
   *
   * @param task - Basic task information
   * @param context - Context for gathering evidence
   * @returns TaskClaim with populated grounding
   */
  buildGrounding(
    task: {
      readonly id: TaskId;
      readonly description: string;
      readonly goal: string;
      readonly method: string;
    },
    context: GroundingContext
  ): Promise<TaskClaim>;

  /**
   * Check for defeaters against a task's justification.
   *
   * Examines the task's supporting evidence and claims for any
   * active defeaters that might invalidate the justification.
   *
   * @param task - The task claim to check
   * @returns Array of active defeaters
   */
  checkDefeaters(task: TaskClaim): Promise<ExtendedDefeater[]>;

  /**
   * Generate remediation actions for a failed validation.
   *
   * Analyzes the validation result and produces a prioritized
   * list of actions to achieve sufficient epistemic grounding.
   *
   * @param result - The failed validation result
   * @returns Ordered list of remediation actions
   */
  generateRemediation(result: TaskValidationResult): RemediationPlan;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract the calibration status from a ConfidenceValue.
 *
 * @param conf - The confidence value
 * @returns The calibration status
 */
function getCalibrationStatus(conf: ConfidenceValue): CalibrationStatus {
  switch (conf.type) {
    case 'deterministic':
      // Deterministic values are always calibrated
      return 'preserved';
    case 'measured':
      // Measured values are calibrated by definition
      return 'preserved';
    case 'derived':
      // Use the derived value's calibration status if present
      return conf.calibrationStatus ?? 'unknown';
    case 'bounded':
      // Bounded values are not empirically calibrated
      return 'degraded';
    case 'absent':
      // Absent values have unknown calibration
      return 'unknown';
  }
}

// ============================================================================
// TASK EPISTEMIC VALIDATOR IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the task epistemic validator.
 *
 * Validates that tasks have sufficient epistemic grounding before execution.
 * Integrates with the evidence ledger and storage to:
 * - Validate existing task claims against criteria
 * - Build grounding for new tasks
 * - Check for defeaters
 * - Generate remediation plans
 *
 * @example
 * ```typescript
 * const validator = new TaskEpistemicValidator(ledger, storage);
 *
 * // Validate an existing task claim
 * const result = await validator.validate(taskClaim, ValidationPresets.strict);
 *
 * if (!result.valid) {
 *   // Get remediation plan
 *   const plan = validator.generateRemediation(result);
 *   console.log('Actions needed:', plan.actions.map(a => a.description));
 * }
 * ```
 */
export class TaskEpistemicValidator implements ITaskEpistemicValidator {
  private readonly defeaterConfig: DefeaterEngineConfig;

  /**
   * Create a new TaskEpistemicValidator.
   *
   * @param ledger - The evidence ledger for querying evidence
   * @param storage - The evidence graph storage for claims and defeaters
   * @param defeaterConfig - Optional configuration for the defeater engine
   */
  constructor(
    private readonly ledger: IEvidenceLedger,
    private readonly storage: EvidenceGraphStorage,
    defeaterConfig?: DefeaterEngineConfig
  ) {
    this.defeaterConfig = defeaterConfig ?? DEFAULT_DEFEATER_CONFIG;
  }

  /**
   * Validate a task claim against the configured criteria.
   *
   * @param task - The task claim to validate
   * @param criteria - Validation criteria (defaults to 'standard' preset)
   * @returns Validation result with detailed diagnostics
   */
  async validate(
    task: TaskClaim,
    criteria?: TaskValidationCriteria
  ): Promise<TaskValidationResult> {
    const effectiveCriteria = criteria ?? ValidationPresets.standard;

    // 1. Check overall confidence threshold
    const confidenceCheck = checkConfidenceThreshold(
      task.confidence,
      effectiveCriteria.minimumConfidence
    );

    // 2. Track calibration through derivation operations
    const calibrationTracker = new CalibrationTracker('preserved');
    const inputConfidences = [
      task.grounding.problemIdentification.confidence,
      task.grounding.alternativesConsidered.thoroughness,
      task.grounding.counterAnalysis.completeness,
      task.grounding.methodWarrant.applicability,
    ];

    calibrationTracker.applyOperation(
      'min',
      inputConfidences.map((c) => getCalibrationStatus(c))
    );

    // 3. Check for defeaters
    const defeaters = await this.checkDefeaters(task);

    // Filter to relevant defeaters based on severity
    const fullDefeaters = defeaters.filter((d) => d.severity === 'full');
    const partialDefeaters = defeaters.filter((d) => d.severity === 'partial');

    // 4. Apply defeaters to confidence
    const { confidence: defeatedConfidence, fullyDefeated } =
      applyDefeatersToConfidence(task.confidence, defeaters);

    // 5. Check evidence freshness
    const evidenceFreshnessResult = await this.checkEvidenceFreshness(
      task,
      effectiveCriteria.maxEvidenceAgeMs
    );

    // 6. Build detailed breakdown
    const breakdown = this.buildValidationBreakdown(
      task,
      effectiveCriteria,
      evidenceFreshnessResult
    );

    // 7. Collect blocking reasons and warnings
    const blockingReasons: string[] = [];
    const warnings: string[] = [];

    // Check overall confidence
    if (confidenceCheck.status === 'blocked') {
      blockingReasons.push(
        confidenceCheck.reason ?? `Overall confidence ${getEffectiveConfidence(task.confidence).toFixed(2)} below threshold ${effectiveCriteria.minimumConfidence}`
      );
    }

    // Check problem identification
    if (!breakdown.problemIdentification.met) {
      blockingReasons.push(
        breakdown.problemIdentification.reason ??
          `Problem identification confidence ${getEffectiveConfidence(breakdown.problemIdentification.confidence).toFixed(2)} below threshold ${effectiveCriteria.minimumProblemConfidence}`
      );
    }

    // Check alternatives considered
    if (!breakdown.alternativesConsidered.met) {
      blockingReasons.push(
        breakdown.alternativesConsidered.reason ??
          `Only ${breakdown.alternativesConsidered.count} alternatives considered, need ${effectiveCriteria.minimumAlternativesConsidered}`
      );
    }

    // Check counter-analysis
    if (effectiveCriteria.requireCounterAnalysis && !breakdown.counterAnalysis.met) {
      blockingReasons.push(
        breakdown.counterAnalysis.reason ??
          `Only ${breakdown.counterAnalysis.objectionsAddressed} objections addressed, need ${effectiveCriteria.minimumObjectionsAddressed}`
      );
    }

    // Check method warrant (including calibration requirement)
    if (!breakdown.methodWarrant.met) {
      if (effectiveCriteria.requireMethodCalibration && !breakdown.methodWarrant.calibrated) {
        blockingReasons.push('Method requires calibration data but none is present');
      }
    }

    // Check evidence freshness
    if (!breakdown.evidenceFreshness.met) {
      blockingReasons.push(
        `Evidence is stale: oldest evidence is ${Math.floor(breakdown.evidenceFreshness.oldestEvidenceAge / (24 * 60 * 60 * 1000))} days old, max allowed is ${Math.floor(effectiveCriteria.maxEvidenceAgeMs / (24 * 60 * 60 * 1000))} days`
      );
    }

    // Check defeaters
    if (effectiveCriteria.blockOnFullDefeater && fullDefeaters.length > 0) {
      for (const defeater of fullDefeaters) {
        blockingReasons.push(`Full defeater: ${defeater.description}`);
      }
    }

    if (effectiveCriteria.blockOnPartialDefeater && partialDefeaters.length > 0) {
      for (const defeater of partialDefeaters) {
        blockingReasons.push(`Partial defeater: ${defeater.description}`);
      }
    }

    // Check calibration status
    const calibrationStatus = calibrationTracker.getStatus();
    if (calibrationStatus === 'degraded' && !effectiveCriteria.allowDegradedCalibration) {
      blockingReasons.push('Calibration status is degraded and degraded calibration is not allowed');
    }
    if (calibrationStatus === 'unknown' && !effectiveCriteria.allowUnknownCalibration) {
      blockingReasons.push('Calibration status is unknown and unknown calibration is not allowed');
    }

    // Add warnings for partial defeaters if not blocking
    if (!effectiveCriteria.blockOnPartialDefeater && partialDefeaters.length > 0) {
      for (const defeater of partialDefeaters) {
        warnings.push(`Warning: Partial defeater - ${defeater.description}`);
      }
    }

    // Add warning for degraded calibration if allowed
    if (calibrationStatus === 'degraded' && effectiveCriteria.allowDegradedCalibration) {
      warnings.push('Warning: Calibration status is degraded');
    }

    const valid = blockingReasons.length === 0;

    // Build the base result (without remediation yet)
    const baseResult: Omit<TaskValidationResult, 'remediation'> = {
      valid,
      confidence: defeatedConfidence,
      calibrationStatus,
      breakdown,
      defeaters,
      blockingReasons,
      warnings,
    };

    // Add remediation plan if validation failed
    if (!valid) {
      const remediation = this.generateRemediation(baseResult as TaskValidationResult);
      return {
        ...baseResult,
        remediation,
      };
    }

    return baseResult;
  }

  /**
   * Build grounding evidence for a task from available sources.
   *
   * @param task - Basic task information
   * @param context - Context for gathering evidence
   * @returns TaskClaim with populated grounding
   */
  async buildGrounding(
    task: {
      readonly id: TaskId;
      readonly description: string;
      readonly goal: string;
      readonly method: string;
    },
    context: GroundingContext
  ): Promise<TaskClaim> {
    // Query ledger for existing evidence about the problem
    const problemEvidence = await context.ledger.query({
      kinds: ['claim', 'extraction', 'synthesis'],
      textSearch: task.goal,
      limit: 10,
    });

    // Compute problem identification confidence
    let problemConfidence: ConfidenceValue;
    if (problemEvidence.length > 0) {
      const evidenceConfidences = problemEvidence
        .filter((e) => e.confidence !== undefined)
        .map((e) => e.confidence!);

      if (evidenceConfidences.length > 0) {
        problemConfidence = sequenceConfidence(evidenceConfidences);
      } else {
        problemConfidence = bounded(0.4, 0.7, 'theoretical', 'Evidence exists but lacks confidence data');
      }
    } else {
      problemConfidence = absent('insufficient_data');
    }

    // Build alternatives from context
    const alternatives: TaskAlternative[] = (context.userAlternatives ?? []).map((alt) => ({
      description: alt,
      reason_rejected: 'User provided alternative - pending evaluation',
      confidence_in_rejection: absent('uncalibrated'),
    }));

    // Build counter-analysis from context
    const objections: TaskObjection[] = (context.userObjections ?? []).map((obj) => ({
      objection: obj,
      response: 'Pending response',
      response_strength: absent('uncalibrated'),
    }));

    // Method warrant from calibration data or bounded estimate
    let methodConfidence: ConfidenceValue;
    let calibrationData: MethodCalibrationData | undefined;

    if (context.methodCalibration) {
      methodConfidence = measuredConfidence({
        datasetId: context.methodCalibration.datasetId,
        sampleSize: context.methodCalibration.sampleSize,
        accuracy: context.methodCalibration.successRate,
        ci95: [
          Math.max(0, context.methodCalibration.successRate - 0.1),
          Math.min(1, context.methodCalibration.successRate + 0.1),
        ],
      });
      calibrationData = context.methodCalibration;
    } else {
      methodConfidence = bounded(
        0.3,
        0.7,
        'theoretical',
        'Uncalibrated method - conservative estimate'
      );
    }

    // Compute thoroughness and completeness
    const alternativesThoroughness: ConfidenceValue =
      alternatives.length > 0
        ? deterministic(true, 'alternatives_documented')
        : absent('insufficient_data');

    const objectionsCompleteness: ConfidenceValue =
      objections.length > 0
        ? deterministic(true, 'objections_documented')
        : absent('insufficient_data');

    // Compose overall confidence
    const inputsForOverall: ConfidenceValue[] = [problemConfidence, methodConfidence];
    if (alternatives.length > 0) {
      inputsForOverall.push(alternativesThoroughness);
    }

    const overallConfidence = sequenceConfidence(inputsForOverall);

    // Compute calibration status for the overall confidence
    const calibrationStatus = computeCalibrationStatus([
      problemConfidence,
      methodConfidence,
    ]);

    return {
      id: createClaimId(`task_claim_${task.id}`),
      proposition: `Task "${task.description}" should be performed to achieve: ${task.goal}`,
      type: 'task_validity',
      task,
      grounding: {
        problemIdentification: {
          evidence: problemEvidence.map((e) => e.id),
          confidence: problemConfidence,
          method: problemEvidence.length > 0 ? 'analysis' : 'inferred',
        },
        alternativesConsidered: {
          alternatives,
          thoroughness: alternativesThoroughness,
        },
        counterAnalysis: {
          objections,
          completeness: objectionsCompleteness,
        },
        methodWarrant: {
          method: task.method,
          historicalReliability: methodConfidence,
          applicability: bounded(
            0.4,
            0.8,
            'theoretical',
            'Default applicability estimate'
          ),
          calibrationData,
        },
      },
      confidence: overallConfidence,
      calibrationStatus,
      defeaters: [],
      status: 'pending_validation',
      schemaVersion: '1.0.0',
    };
  }

  /**
   * Check for defeaters against a task's justification.
   *
   * @param task - The task claim to check
   * @returns Array of active defeaters
   */
  async checkDefeaters(task: TaskClaim): Promise<ExtendedDefeater[]> {
    // Detect defeaters from storage
    const detectionResult = await detectDefeaters(
      this.storage,
      {
        timestamp: new Date().toISOString(),
        changedFiles: [], // Could include related files from task
      },
      this.defeaterConfig
    );

    // Get all claim IDs that this task depends on
    const supportingClaimIds = new Set<string>();

    // Add evidence IDs from problem identification
    for (const evidenceId of task.grounding.problemIdentification.evidence) {
      supportingClaimIds.add(evidenceId);
    }

    // Filter to defeaters affecting this task's supporting claims
    const relevantDefeaters = detectionResult.defeaters.filter((d) =>
      d.affectedClaimIds.some((id) => supportingClaimIds.has(id))
    );

    // Also include any defeaters that are already attached to the task
    const existingDefeaters = [...task.defeaters];

    // Combine and deduplicate
    const allDefeaters = [...relevantDefeaters];
    for (const existing of existingDefeaters) {
      if (!allDefeaters.some((d) => d.id === existing.id)) {
        allDefeaters.push(existing);
      }
    }

    return allDefeaters;
  }

  /**
   * Generate remediation actions for a failed validation.
   *
   * @param result - The failed validation result
   * @returns Ordered list of remediation actions
   */
  generateRemediation(result: TaskValidationResult): RemediationPlan {
    const actions: RemediationAction[] = [];

    // Check each breakdown component and generate appropriate actions
    if (!result.breakdown.problemIdentification.met) {
      actions.push({
        type: 'gather_evidence',
        priority: 1,
        description: 'Gather more evidence that this is the correct problem to solve',
        suggestions: [
          'Query users to confirm problem understanding',
          'Search for related issues or requirements',
          'Analyze error logs or user reports',
        ],
        targetConfidence: result.breakdown.problemIdentification.required,
      });
    }

    if (!result.breakdown.alternativesConsidered.met) {
      const needed = result.breakdown.alternativesConsidered.required - result.breakdown.alternativesConsidered.count;
      actions.push({
        type: 'consider_alternatives',
        priority: 2,
        description: `Consider at least ${needed} more alternative approach${needed > 1 ? 'es' : ''}`,
        suggestions: [
          'Brainstorm alternative solutions',
          'Search for similar problems and their solutions',
          'Ask stakeholders for alternative ideas',
        ],
        targetCount: result.breakdown.alternativesConsidered.required,
      });
    }

    if (!result.breakdown.counterAnalysis.met) {
      const needed = result.breakdown.counterAnalysis.required - result.breakdown.counterAnalysis.objectionsAddressed;
      actions.push({
        type: 'address_objections',
        priority: 3,
        description: `Address at least ${needed} more potential objection${needed > 1 ? 's' : ''}`,
        suggestions: [
          'Consider what could go wrong with this approach',
          'Think about edge cases or failure modes',
          'Seek critical feedback from others',
        ],
        targetCount: result.breakdown.counterAnalysis.required,
      });
    }

    if (!result.breakdown.methodWarrant.met) {
      actions.push({
        type: 'validate_method',
        priority: 4,
        description: 'Strengthen confidence in the chosen method',
        suggestions: [
          'Find historical examples of this method succeeding',
          'Run a small-scale test of the approach',
          'Consult documentation or best practices',
        ],
        targetConfidence: 0.6,
      });
    }

    if (!result.breakdown.evidenceFreshness.met) {
      actions.push({
        type: 'refresh_evidence',
        priority: 5,
        description: 'Update stale evidence',
        staleEvidence: result.breakdown.evidenceFreshness.staleEvidence,
        suggestions: [
          'Re-run analysis on affected files',
          'Verify that cached evidence is still valid',
          'Check for recent changes to the codebase',
        ],
      });
    }

    // Handle defeaters
    for (const defeater of result.defeaters) {
      if (defeater.severity === 'full' || defeater.severity === 'partial') {
        actions.push({
          type: 'resolve_defeater',
          priority: defeater.severity === 'full' ? 0 : 1, // Full defeaters are highest priority
          description: `Resolve ${defeater.severity} defeater: ${defeater.description}`,
          defeaterId: defeater.id,
          suggestions: defeater.autoResolvable
            ? [`Automatic resolution available: ${defeater.resolutionAction}`]
            : ['Manual intervention required'],
        });
      }
    }

    // Sort by priority (lower = higher priority)
    actions.sort((a, b) => a.priority - b.priority);

    // Identify critical path (actions that must be completed)
    const criticalPath = actions.filter((a) => a.priority <= 2);

    return {
      taskId: 'unknown', // This would come from the task being validated
      actions,
      estimatedEffort: this.estimateRemediationEffort(actions),
      criticalPath,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Check evidence freshness for the task's supporting evidence.
   */
  private async checkEvidenceFreshness(
    task: TaskClaim,
    maxAgeMs: number
  ): Promise<{
    met: boolean;
    oldestEvidenceAge: number;
    staleEvidence: EvidenceId[];
  }> {
    const now = Date.now();
    let oldestAge = 0;
    const staleEvidence: EvidenceId[] = [];

    // Check all evidence in problem identification
    for (const evidenceId of task.grounding.problemIdentification.evidence) {
      const entry = await this.ledger.get(evidenceId);
      if (entry) {
        const age = now - entry.timestamp.getTime();
        if (age > oldestAge) {
          oldestAge = age;
        }
        if (age > maxAgeMs) {
          staleEvidence.push(evidenceId);
        }
      }
    }

    return {
      met: staleEvidence.length === 0,
      oldestEvidenceAge: oldestAge,
      staleEvidence,
    };
  }

  /**
   * Build the validation breakdown for a task.
   */
  private buildValidationBreakdown(
    task: TaskClaim,
    criteria: TaskValidationCriteria,
    freshnessResult: {
      met: boolean;
      oldestEvidenceAge: number;
      staleEvidence: EvidenceId[];
    }
  ): TaskValidationBreakdown {
    // Problem identification
    const problemConfidence = getEffectiveConfidence(task.grounding.problemIdentification.confidence);
    const problemMet = problemConfidence >= criteria.minimumProblemConfidence;

    // Alternatives considered
    const alternativesCount = task.grounding.alternativesConsidered.alternatives.length;
    const alternativesMet = alternativesCount >= criteria.minimumAlternativesConsidered;

    // Counter-analysis
    const objectionsCount = task.grounding.counterAnalysis.objections.length;
    const counterMet = !criteria.requireCounterAnalysis || objectionsCount >= criteria.minimumObjectionsAddressed;

    // Method warrant
    const methodConfidence = getEffectiveConfidence(task.grounding.methodWarrant.historicalReliability);
    const methodCalibrated = task.grounding.methodWarrant.calibrationData !== undefined;
    const methodMet = (!criteria.requireMethodCalibration || methodCalibrated) && methodConfidence >= 0.5;

    return {
      problemIdentification: {
        met: problemMet,
        confidence: task.grounding.problemIdentification.confidence,
        required: criteria.minimumProblemConfidence,
        reason: problemMet
          ? undefined
          : `Problem identification confidence ${problemConfidence.toFixed(2)} below threshold ${criteria.minimumProblemConfidence}`,
      },
      alternativesConsidered: {
        met: alternativesMet,
        count: alternativesCount,
        required: criteria.minimumAlternativesConsidered,
        alternatives: task.grounding.alternativesConsidered.alternatives.map((a) => a.description),
        reason: alternativesMet
          ? undefined
          : `Only ${alternativesCount} alternative(s) considered, need ${criteria.minimumAlternativesConsidered}`,
      },
      counterAnalysis: {
        met: counterMet,
        objectionsAddressed: objectionsCount,
        required: criteria.minimumObjectionsAddressed,
        objections: task.grounding.counterAnalysis.objections.map((o) => o.objection),
        reason: counterMet
          ? undefined
          : `Only ${objectionsCount} objection(s) addressed, need ${criteria.minimumObjectionsAddressed}`,
      },
      methodWarrant: {
        met: methodMet,
        confidence: task.grounding.methodWarrant.historicalReliability,
        calibrated: methodCalibrated,
        reason: methodMet
          ? undefined
          : criteria.requireMethodCalibration && !methodCalibrated
            ? 'Method requires calibration data but none is present'
            : `Method confidence ${methodConfidence.toFixed(2)} below threshold`,
      },
      evidenceFreshness: {
        met: freshnessResult.met,
        oldestEvidenceAge: freshnessResult.oldestEvidenceAge,
        maxAllowed: criteria.maxEvidenceAgeMs,
        staleEvidence: freshnessResult.staleEvidence,
      },
    };
  }

  /**
   * Estimate the effort required for remediation actions.
   */
  private estimateRemediationEffort(
    actions: RemediationAction[]
  ): { minimal: string; typical: string; thorough: string } {
    const count = actions.length;
    const hasDefeaters = actions.some((a) => a.type === 'resolve_defeater');

    if (count === 0) {
      return {
        minimal: '0 minutes',
        typical: '0 minutes',
        thorough: '0 minutes',
      };
    }

    if (hasDefeaters) {
      return {
        minimal: count <= 2 ? '15-30 minutes' : '30 minutes - 1 hour',
        typical: count <= 3 ? '1-2 hours' : '2-4 hours',
        thorough: count <= 4 ? '4-8 hours' : '1-2 days',
      };
    }

    return {
      minimal: count <= 1 ? '5-15 minutes' : '15-30 minutes',
      typical: count <= 2 ? '30 minutes - 1 hour' : '1-2 hours',
      thorough: count <= 3 ? '2-4 hours' : '4-8 hours',
    };
  }
}
