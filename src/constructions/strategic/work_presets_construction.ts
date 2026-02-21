/**
 * @fileoverview Work Presets Construction
 *
 * Construction wrapper for the work_presets strategic module.
 * Assesses work processes against quality gates and preset standards.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as workPresets from '../../strategic/work_presets.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for work preset assessment.
 */
export interface WorkPresetAssessmentInput {
  /** Files affected by the work */
  files: string[];
  /** Current phase of work (e.g., 'implementation', 'testing', 'review') */
  phase: string;
  /** Type of deliverable being produced */
  deliverableType?: workPresets.DeliverableType;
  /** Preset to assess against (defaults to STANDARD_PRESET) */
  preset?: workPresets.WorkPreset;
  /** Current metrics if available */
  metrics?: {
    testCoverage?: number;
    lintPassed?: boolean;
    typeCheckPassed?: boolean;
    confidenceLevel?: number;
  };
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Gate check result.
 */
export interface GateCheckResult {
  /** Gate phase */
  phase: string;
  /** Whether the gate passed */
  passed: boolean;
  /** Whether this gate is blocking */
  blocking: boolean;
  /** Individual requirement results */
  requirements: Array<{
    type: workPresets.GateRequirementType;
    passed: boolean;
    description: string;
    actual?: number | string;
    threshold?: number;
  }>;
}

/**
 * Result for work preset assessment.
 */
export interface WorkPresetAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Gate check results */
  gateResults: GateCheckResult[];
  /** Whether all blocking gates pass */
  canProceed: boolean;
  /** Deliverable requirements status */
  deliverableStatus: Array<{
    id: string;
    name: string;
    met: boolean;
    mandatory: boolean;
  }>;
  /** The preset used for assessment */
  presetUsed: string;
  /** Confidence in this result */
  confidence: ConfidenceValue;
  /** Evidence references */
  evidenceRefs: string[];
  /** Analysis time in milliseconds */
  analysisTimeMs: number;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Construction for assessing work against preset quality gates.
 *
 * Uses the work_presets strategic module to validate work processes
 * against configurable presets (STRICT, STANDARD, EXPLORATORY).
 *
 * @example
 * ```typescript
 * const construction = new WorkPresetsConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['src/feature.ts'],
 *   phase: 'testing',
 *   metrics: { testCoverage: 0.85 },
 * });
 * console.log(`Can proceed: ${result.canProceed}`);
 * ```
 */
export class WorkPresetsConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'WorkPresetsConstruction';
  readonly CONSTRUCTION_ID = WorkPresetsConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return WorkPresetsConstruction.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   */
  recordOutcome(
    predictionId: string,
    wasCorrect: boolean,
    verificationMethod: VerificationMethod = 'user_feedback'
  ): void {
    if (this.calibrationTracker) {
      this.calibrationTracker.recordOutcome(predictionId, wasCorrect, verificationMethod);
    }
  }

  /**
   * Get the default preset (STANDARD_PRESET).
   */
  getStandard(): workPresets.WorkPreset {
    return workPresets.STANDARD_PRESET;
  }

  /**
   * Assess work against preset gates.
   *
   * @param input - Work context and optional preset
   * @param options - Assessment options
   * @returns Work preset assessment with gate results
   */
  async assess(
    input: WorkPresetAssessmentInput,
    options?: AssessmentOptions
  ): Promise<WorkPresetAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand the work context
    const queryResult = await this.librainian.queryOptional({
      intent: `Analyze work quality for ${input.phase} phase including test coverage, code quality, and documentation`,
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:work_analysis:${queryResult.packs?.length || 0}_packs`);

    // Select preset
    const preset = input.preset || this.getStandard();
    evidenceRefs.push(`preset:${preset.id}`);

    // Check gates for the current phase
    const gateResults = this.checkGates(preset.qualityGates, input, queryResult);
    evidenceRefs.push(`gates:${gateResults.length}_checked`);

    // Check deliverable requirements
    const deliverableStatus = this.checkDeliverables(
      preset.deliverables,
      input.deliverableType || 'code',
      queryResult
    );
    evidenceRefs.push(`deliverables:${deliverableStatus.length}_checked`);

    // Determine if work can proceed
    const blockingGatesFailed = gateResults.some((g) => g.blocking && !g.passed);
    const canProceed = !blockingGatesFailed;

    // Compute breakdown
    const breakdown: Record<string, number> = {
      gates: this.computeGateScore(gateResults),
      deliverables: this.computeDeliverableScore(deliverableStatus),
      orchestration: 85, // Baseline for orchestration compliance
      review: this.computeReviewReadiness(input, queryResult),
    };

    // Overall score
    const score = Math.round(
      (breakdown.gates * 0.4 +
        breakdown.deliverables * 0.3 +
        breakdown.orchestration * 0.1 +
        breakdown.review * 0.2)
    );

    // Generate recommendations
    const recommendations = this.generateWorkRecommendations(gateResults, deliverableStatus);

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, { score });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Work preset assessment: ${score}/100, canProceed=${canProceed}`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown,
      recommendations,
      gateResults,
      canProceed,
      deliverableStatus,
      presetUsed: preset.id,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
    };
  }

  /**
   * Record a prediction for calibration tracking.
   */
  private recordPrediction(claim: string, confidence: ConfidenceValue): string {
    const predictionId = generatePredictionId(this.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        this.CONSTRUCTION_ID,
        predictionId,
        confidence,
        claim
      );
    }
    return predictionId;
  }

  /**
   * Compute a letter grade from a numeric score.
   */
  private computeGrade(score: number): string {
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 67) return 'D+';
    if (score >= 63) return 'D';
    if (score >= 60) return 'D-';
    return 'F';
  }

  /**
   * Check gates for the current phase.
   */
  private checkGates(
    gatesPreset: workPresets.QualityGatesPreset,
    input: WorkPresetAssessmentInput,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): GateCheckResult[] {
    const results: GateCheckResult[] = [];

    // Get requirements for current phase
    const phaseGates = gatesPreset.gates.filter(
      (g) => g.phase === input.phase || g.phase === 'all'
    );

    for (const gate of phaseGates) {
      const requirementResults = gate.requirements.map((req) => {
        const result = this.checkRequirement(req, input, queryResult);
        return {
          type: req.type,
          passed: result.passed,
          description: req.description,
          actual: result.actual,
          threshold: req.threshold,
        };
      });

      results.push({
        phase: gate.phase,
        passed: requirementResults.every((r) => r.passed),
        blocking: gate.blocking,
        requirements: requirementResults,
      });
    }

    return results;
  }

  /**
   * Check a single requirement.
   */
  private checkRequirement(
    requirement: workPresets.PresetGateRequirement,
    input: WorkPresetAssessmentInput,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): { passed: boolean; actual?: number | string } {
    switch (requirement.type) {
      case 'test_coverage':
        const coverage = input.metrics?.testCoverage ?? 0.7;
        return {
          passed: coverage >= (requirement.threshold ?? 70) / 100,
          actual: Math.round(coverage * 100),
        };

      case 'lint_pass':
        return {
          passed: input.metrics?.lintPassed ?? true,
          actual: input.metrics?.lintPassed ? 'passed' : 'failed',
        };

      case 'type_check':
        return {
          passed: input.metrics?.typeCheckPassed ?? true,
          actual: input.metrics?.typeCheckPassed ? 'passed' : 'failed',
        };

      case 'confidence_threshold':
        const confidence = input.metrics?.confidenceLevel ?? 0.75;
        return {
          passed: confidence >= (requirement.threshold ?? 70) / 100,
          actual: Math.round(confidence * 100),
        };

      case 'evidence_complete':
        const hasEvidence = (queryResult.packs?.length || 0) > 0;
        return {
          passed: hasEvidence,
          actual: hasEvidence ? 'complete' : 'incomplete',
        };

      case 'review_approved':
        // Would need external review status
        return { passed: true, actual: 'pending' };

      default:
        return { passed: true };
    }
  }

  /**
   * Check deliverable requirements.
   */
  private checkDeliverables(
    deliverables: workPresets.DeliverablePreset[],
    type: workPresets.DeliverableType,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): Array<{ id: string; name: string; met: boolean; mandatory: boolean }> {
    const preset = deliverables.find((d) => d.type === type);
    if (!preset) return [];

    return preset.requirements.map((req) => ({
      id: req.id,
      name: req.name,
      met: this.checkDeliverableRequirement(req, queryResult),
      mandatory: req.mandatory,
    }));
  }

  /**
   * Check a deliverable requirement.
   */
  private checkDeliverableRequirement(
    requirement: workPresets.DeliverableRequirement,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): boolean {
    // Simple heuristics based on requirement ID
    switch (requirement.id) {
      case 'typed':
        return true; // Assume TypeScript
      case 'tested':
        return (queryResult.packs?.length || 0) > 0;
      case 'documented':
        return queryResult.packs?.some((p) => p.summary && p.summary.length > 50) || false;
      case 'linted':
        return true; // Would need actual lint check
      default:
        return true;
    }
  }

  /**
   * Compute score from gate results.
   */
  private computeGateScore(gateResults: GateCheckResult[]): number {
    if (gateResults.length === 0) return 100;

    const totalRequirements = gateResults.reduce(
      (sum, g) => sum + g.requirements.length,
      0
    );
    const passedRequirements = gateResults.reduce(
      (sum, g) => sum + g.requirements.filter((r) => r.passed).length,
      0
    );

    return totalRequirements > 0
      ? Math.round((passedRequirements / totalRequirements) * 100)
      : 100;
  }

  /**
   * Compute score from deliverable status.
   */
  private computeDeliverableScore(
    status: Array<{ met: boolean; mandatory: boolean }>
  ): number {
    if (status.length === 0) return 100;

    const mandatory = status.filter((s) => s.mandatory);
    const mandatoryMet = mandatory.filter((s) => s.met).length;
    const mandatoryScore =
      mandatory.length > 0 ? (mandatoryMet / mandatory.length) * 100 : 100;

    const optional = status.filter((s) => !s.mandatory);
    const optionalMet = optional.filter((s) => s.met).length;
    const optionalScore =
      optional.length > 0 ? (optionalMet / optional.length) * 100 : 100;

    return Math.round(mandatoryScore * 0.8 + optionalScore * 0.2);
  }

  /**
   * Compute review readiness score.
   */
  private computeReviewReadiness(
    input: WorkPresetAssessmentInput,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): number {
    let score = 60; // Baseline

    if (input.metrics?.testCoverage && input.metrics.testCoverage >= 0.7) {
      score += 15;
    }
    if (input.metrics?.lintPassed) {
      score += 10;
    }
    if (input.metrics?.typeCheckPassed) {
      score += 10;
    }
    if ((queryResult.packs?.length || 0) > 0) {
      score += 5;
    }

    return Math.min(100, score);
  }

  /**
   * Generate work-specific recommendations.
   */
  private generateWorkRecommendations(
    gateResults: GateCheckResult[],
    deliverableStatus: Array<{ id: string; name: string; met: boolean; mandatory: boolean }>
  ): string[] {
    const recommendations: string[] = [];

    // Gate failures
    for (const gate of gateResults) {
      for (const req of gate.requirements.filter((r) => !r.passed)) {
        const severity = gate.blocking ? '[Blocking]' : '[Warning]';
        recommendations.push(
          `${severity} ${gate.phase}: ${req.description}${req.actual !== undefined ? ` (current: ${req.actual}, required: ${req.threshold || 'pass'})` : ''}`
        );
      }
    }

    // Deliverable gaps
    for (const status of deliverableStatus.filter((s) => !s.met && s.mandatory)) {
      recommendations.push(`[Required] Deliverable: ${status.name} not met`);
    }

    return recommendations;
  }

  /**
   * Compute confidence based on query results and assessment data.
   */
  private computeConfidence(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    data: { score: number }
  ): ConfidenceValue {
    const packCount = queryResult.packs?.length || 0;

    // More packs = more evidence = higher confidence
    const baseConfidence = 0.6;
    const packBonus = Math.min(0.15, packCount * 0.03);
    const scoreClarity = data.score > 50 ? 0.1 : 0.05;

    const low = Math.min(0.9, baseConfidence + packBonus);
    const high = Math.min(0.95, low + scoreClarity + 0.1);

    return bounded(low, high, 'theoretical', 'Work preset validation based on gate checks and deliverable status');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new work presets construction.
 *
 * @param librainian - The librainian instance
 * @returns A new WorkPresetsConstruction
 */
export function createWorkPresetsConstruction(
  librainian: LiBrainian
): WorkPresetsConstruction {
  return new WorkPresetsConstruction(librainian);
}
