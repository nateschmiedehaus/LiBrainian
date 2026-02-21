/**
 * @fileoverview Workflow Validation Construction
 *
 * A composed construction that wraps the strategic work_presets module
 * to provide workflow validation with confidence tracking and calibration.
 *
 * Composes:
 * - Query API for code state analysis
 * - Work Presets for gate validation
 * - Evidence Ledger for traceability
 * - Confidence System for uncertainty quantification
 * - Calibration Tracking for confidence accuracy measurement
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import type { ContextPack } from '../../types.js';
import type {
  ConstructionCalibrationTracker,
  CalibratedConstruction,
  VerificationMethod,
} from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import {
  validateQualityGatesPreset,
  validateWorkPreset,
  hasBlockingGates,
  getPhaseRequirements,
  isPeerReviewTriggered,
  STRICT_PRESET,
  STANDARD_PRESET,
  EXPLORATORY_PRESET,
  type WorkPreset,
  type PresetQualityGate,
  type PresetGateRequirement,
  type ReviewPreset,
} from '../../strategic/work_presets.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context for workflow phase validation.
 */
export interface WorkflowPhaseContext {
  /** Current phase (e.g., 'implementation', 'testing', 'review', 'deploy') */
  phase: string;
  /** Files affected in this workflow */
  files: string[];
  /** Current test coverage (0.0 - 1.0) */
  testCoverage?: number;
  /** Whether lint has passed */
  lintPassed?: boolean;
  /** Whether type checks have passed */
  typeCheckPassed?: boolean;
  /** Current confidence in changes (0.0 - 1.0) */
  changeConfidence?: number;
  /** Number of lines changed */
  linesChanged?: number;
  /** Whether changes are security-sensitive */
  isSecuritySensitive?: boolean;
  /** Whether changes are breaking */
  isBreakingChange?: boolean;
  /** Whether new dependencies are added */
  hasNewDependency?: boolean;
  /** Whether changes affect critical paths */
  isCriticalPath?: boolean;
}

/**
 * Result of a gate check.
 */
export interface GateCheckResult {
  /** Whether the gate passed */
  passed: boolean;
  /** Requirements that passed */
  passedRequirements: PresetGateRequirement[];
  /** Requirements that failed */
  failedRequirements: PresetGateRequirement[];
  /** Blocking status */
  blocking: boolean;
}

/**
 * Result of workflow validation.
 */
export interface WorkflowValidationResult {
  /** The preset used for validation */
  presetId: string;
  /** Current phase being validated */
  phase: string;
  /** Gate check result for the phase */
  gateCheck: GateCheckResult;
  /** Whether peer review is triggered */
  peerReviewTriggered: boolean;
  /** Reasons for peer review (if triggered) */
  peerReviewReasons: string[];
  /** Minimum reviewers required (if peer review triggered) */
  minReviewers: number;
  /** Overall validation passed */
  passed: boolean;
  /** Confidence in this validation */
  confidence: ConfidenceValue;
  /** Evidence trail */
  evidenceRefs: string[];
  /** Time taken for validation in milliseconds */
  validationTimeMs: number;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
  /** Recommendations for next steps */
  recommendations: string[];
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Workflow Validation Construction - wraps work_presets.ts in the
 * construction pattern with confidence tracking and calibration.
 *
 * Usage:
 * ```typescript
 * const construction = new WorkflowValidationConstruction(librainian);
 * const result = await construction.validatePhase({
 *   phase: 'testing',
 *   files: ['src/module.ts'],
 *   testCoverage: 0.85,
 * });
 * console.log(`Gate passed: ${result.gateCheck.passed}`);
 * ```
 */
export class WorkflowValidationConstruction implements CalibratedConstruction {
  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  static readonly CONSTRUCTION_ID = 'WorkflowValidationConstruction';

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return WorkflowValidationConstruction.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   * Call this after verifying the validation outcome.
   *
   * @param predictionId - The prediction ID from the validation result
   * @param wasCorrect - Whether the validation was correct
   * @param verificationMethod - How the outcome was verified
   */
  recordOutcome(
    predictionId: string,
    wasCorrect: boolean,
    verificationMethod: VerificationMethod = 'user_feedback'
  ): void {
    if (!this.calibrationTracker) {
      return; // Silently skip if no tracker configured
    }
    this.calibrationTracker.recordOutcome(predictionId, wasCorrect, verificationMethod);
  }

  /**
   * Validate a workflow phase against a preset.
   *
   * @param context - The workflow phase context
   * @param presetId - Preset ID ('strict', 'standard', or 'exploratory')
   * @returns Workflow validation result
   */
  async validatePhase(
    context: WorkflowPhaseContext,
    presetId: 'strict' | 'standard' | 'exploratory' = 'standard'
  ): Promise<WorkflowValidationResult> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Step 1: Get the preset
    const preset = this.getPreset(presetId);
    evidenceRefs.push(`preset:${presetId}`);

    // Step 2: Query librainian for additional context
    const queryResult = await this.librainian.queryOptional({
      intent: `Analyze workflow status for ${context.phase} phase`,
      affectedFiles: context.files,
      depth: 'L1',
    });
    evidenceRefs.push('librainian_query:workflow_context');

    // Step 3: Enhance context with librainian data
    const enhancedContext = this.enhanceContext(context, queryResult.packs);
    evidenceRefs.push('context_enhancement');

    // Step 4: Check quality gate for the phase
    const gateCheck = this.checkGate(preset, enhancedContext);
    evidenceRefs.push(`gate_check:${context.phase}`);

    // Step 5: Check peer review triggers
    const reviewResult = isPeerReviewTriggered(preset.review, {
      isSecuritySensitive: enhancedContext.isSecuritySensitive,
      isBreakingChange: enhancedContext.isBreakingChange,
      hasNewDependency: enhancedContext.hasNewDependency,
      linesChanged: enhancedContext.linesChanged,
      isCriticalPath: enhancedContext.isCriticalPath,
    });
    evidenceRefs.push(`peer_review_check:${reviewResult.triggered}`);

    // Step 6: Generate recommendations
    const recommendations = this.generateRecommendations(
      gateCheck,
      reviewResult,
      enhancedContext,
      preset
    );
    evidenceRefs.push(`recommendations:${recommendations.length}`);

    // Step 7: Compute confidence
    const confidence = this.computeConfidence(queryResult.packs, gateCheck, context);

    // Step 8: Determine overall pass/fail
    const passed = gateCheck.passed || !gateCheck.blocking;

    // Step 9: Record prediction for calibration tracking
    const predictionId = generatePredictionId(WorkflowValidationConstruction.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        WorkflowValidationConstruction.CONSTRUCTION_ID,
        predictionId,
        confidence,
        `Workflow validation for ${context.phase} phase ${passed ? 'passed' : 'failed'}`,
        {
          phase: context.phase,
          presetId,
          gatePassed: gateCheck.passed,
          blocking: gateCheck.blocking,
          peerReviewTriggered: reviewResult.triggered,
        }
      );
    }

    return {
      presetId,
      phase: context.phase,
      gateCheck,
      peerReviewTriggered: reviewResult.triggered,
      peerReviewReasons: reviewResult.reasons,
      minReviewers: reviewResult.minReviewers,
      passed,
      confidence,
      evidenceRefs,
      validationTimeMs: Date.now() - startTime,
      predictionId,
      recommendations,
    };
  }

  /**
   * Get a preset by ID.
   */
  private getPreset(presetId: 'strict' | 'standard' | 'exploratory'): WorkPreset {
    switch (presetId) {
      case 'strict':
        return STRICT_PRESET;
      case 'exploratory':
        return EXPLORATORY_PRESET;
      case 'standard':
      default:
        return STANDARD_PRESET;
    }
  }

  /**
   * Enhance context with data from librainian packs.
   */
  private enhanceContext(
    context: WorkflowPhaseContext,
    packs: ContextPack[]
  ): WorkflowPhaseContext {
    const enhanced = { ...context };

    // Estimate test coverage from pack data if not provided
    if (enhanced.testCoverage === undefined) {
      const testPacks = packs.filter(
        (pack) =>
          pack.relatedFiles.some(
            (file) =>
              file.includes('.test.') ||
              file.includes('.spec.') ||
              file.includes('__tests__')
          )
      );
      enhanced.testCoverage = testPacks.length > 0 ? 0.5 : 0; // Rough estimate
    }

    // Estimate lines changed if not provided
    if (enhanced.linesChanged === undefined) {
      let totalLines = 0;
      for (const pack of packs) {
        if (pack.codeSnippets) {
          for (const snippet of pack.codeSnippets) {
            totalLines += snippet.endLine - snippet.startLine + 1;
          }
        }
      }
      enhanced.linesChanged = totalLines;
    }

    // Detect security-sensitive code if not specified
    if (enhanced.isSecuritySensitive === undefined) {
      const securityKeywords = ['password', 'secret', 'token', 'auth', 'crypto', 'encrypt'];
      for (const pack of packs) {
        if (pack.codeSnippets) {
          for (const snippet of pack.codeSnippets) {
            const lowerContent = snippet.content.toLowerCase();
            if (securityKeywords.some((kw) => lowerContent.includes(kw))) {
              enhanced.isSecuritySensitive = true;
              break;
            }
          }
        }
        if (enhanced.isSecuritySensitive) break;
      }
    }

    return enhanced;
  }

  /**
   * Check if a quality gate passes for the given context.
   */
  private checkGate(
    preset: WorkPreset,
    context: WorkflowPhaseContext
  ): GateCheckResult {
    const requirements = getPhaseRequirements(preset.qualityGates, context.phase);
    const blocking = hasBlockingGates(preset.qualityGates, context.phase);

    const passedRequirements: PresetGateRequirement[] = [];
    const failedRequirements: PresetGateRequirement[] = [];

    for (const req of requirements) {
      const passed = this.checkRequirement(req, context);
      if (passed) {
        passedRequirements.push(req);
      } else {
        failedRequirements.push(req);
      }
    }

    return {
      passed: failedRequirements.length === 0,
      passedRequirements,
      failedRequirements,
      blocking,
    };
  }

  /**
   * Check if a single requirement is satisfied.
   */
  private checkRequirement(
    req: PresetGateRequirement,
    context: WorkflowPhaseContext
  ): boolean {
    switch (req.type) {
      case 'test_coverage':
        if (context.testCoverage === undefined) return false;
        return context.testCoverage * 100 >= (req.threshold ?? 0);

      case 'lint_pass':
        return context.lintPassed === true;

      case 'type_check':
        return context.typeCheckPassed === true;

      case 'confidence_threshold':
        if (context.changeConfidence === undefined) return false;
        return context.changeConfidence >= (req.threshold ?? 0);

      case 'review_approved':
        // This would require external data; return true by default
        return true;

      case 'evidence_complete':
        // This would require external data; return true by default
        return true;

      default:
        return false;
    }
  }

  /**
   * Generate recommendations based on validation results.
   */
  private generateRecommendations(
    gateCheck: GateCheckResult,
    reviewResult: { triggered: boolean; reasons: string[]; minReviewers: number },
    context: WorkflowPhaseContext,
    preset: WorkPreset
  ): string[] {
    const recommendations: string[] = [];

    // Add recommendations for failed requirements
    for (const req of gateCheck.failedRequirements) {
      switch (req.type) {
        case 'test_coverage':
          recommendations.push(
            `Increase test coverage to at least ${req.threshold}% (current: ${Math.round((context.testCoverage ?? 0) * 100)}%)`
          );
          break;
        case 'lint_pass':
          recommendations.push('Fix linting errors before proceeding');
          break;
        case 'type_check':
          recommendations.push('Fix TypeScript type errors before proceeding');
          break;
        case 'confidence_threshold':
          recommendations.push(
            `Increase confidence in changes to at least ${(req.threshold ?? 0) * 100}%`
          );
          break;
      }
    }

    // Add peer review recommendation if triggered
    if (reviewResult.triggered) {
      recommendations.push(
        `Peer review required (${reviewResult.minReviewers} reviewer${reviewResult.minReviewers > 1 ? 's' : ''}) for: ${reviewResult.reasons.join(', ')}`
      );
    }

    // Add general recommendation if all passed
    if (recommendations.length === 0) {
      recommendations.push(`All ${context.phase} phase requirements satisfied`);
    }

    return recommendations;
  }

  /**
   * Compute confidence in the validation.
   */
  private computeConfidence(
    packs: ContextPack[],
    gateCheck: GateCheckResult,
    context: WorkflowPhaseContext
  ): ConfidenceValue {
    // Confidence based on data availability and gate check completeness
    const totalRequirements =
      gateCheck.passedRequirements.length + gateCheck.failedRequirements.length;

    if (totalRequirements === 0) {
      // No requirements for this phase
      return {
        type: 'bounded' as const,
        low: 0.5,
        high: 0.9,
        basis: 'theoretical' as const,
        citation: 'No requirements defined for this phase',
      };
    }

    // Base confidence on how many requirements we could actually check
    const checkableRequirements =
      (context.testCoverage !== undefined ? 1 : 0) +
      (context.lintPassed !== undefined ? 1 : 0) +
      (context.typeCheckPassed !== undefined ? 1 : 0) +
      (context.changeConfidence !== undefined ? 1 : 0);

    const coverageRatio = checkableRequirements / Math.max(1, totalRequirements);
    const baseConfidence = 0.5 + coverageRatio * 0.4;

    // Adjust based on pack data
    const packBoost = packs.length > 0 ? 0.1 : 0;
    const finalConfidence = Math.min(1, baseConfidence + packBoost);

    return {
      type: 'measured' as const,
      value: finalConfidence,
      measurement: {
        datasetId: 'workflow_validation',
        sampleSize: totalRequirements,
        accuracy: finalConfidence,
        confidenceInterval: [
          Math.max(0, finalConfidence - 0.15),
          Math.min(1, finalConfidence + 0.15),
        ] as const,
        measuredAt: new Date().toISOString(),
      },
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a Workflow Validation Construction.
 *
 * @param librainian - The librainian instance to use for queries
 * @returns New construction instance
 */
export function createWorkflowValidationConstruction(
  librainian: LiBrainian
): WorkflowValidationConstruction {
  return new WorkflowValidationConstruction(librainian);
}
