/**
 * @fileoverview Developer Experience Construction
 *
 * Construction wrapper for the developer_experience strategic module.
 * Assesses developer experience practices against DX standards.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as dx from '../../strategic/developer_experience.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for developer experience assessment.
 */
export interface DeveloperExperienceAssessmentInput {
  /** Files to analyze (configs, docs, tooling) */
  files: string[];
  /** DX configuration to assess against (defaults to STANDARD_DX_PRESET) */
  config?: dx.DeveloperExperienceConfig;
  /** Focus areas for assessment */
  focus?: Array<'onboarding' | 'workflow' | 'tooling' | 'documentation'>;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for developer experience assessment.
 */
export interface DeveloperExperienceAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** DX score details */
  dxScore: dx.DXScore;
  /** Onboarding checklist */
  onboardingChecklist: dx.OnboardingChecklist;
  /** Workflow validation results */
  workflowValidation: dx.WorkflowValidationResult;
  /** Preset used */
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
 * Construction for assessing developer experience.
 *
 * Uses the developer_experience strategic module to evaluate
 * onboarding, workflow, tooling, and documentation practices.
 *
 * @example
 * ```typescript
 * const construction = new DeveloperExperienceConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['package.json', '.eslintrc', 'README.md', 'CONTRIBUTING.md'],
 *   focus: ['onboarding', 'tooling'],
 * });
 * console.log(`DX Score: ${result.dxScore.overall}`);
 * ```
 */
export class DeveloperExperienceConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'DeveloperExperienceConstruction';
  readonly CONSTRUCTION_ID = DeveloperExperienceConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return DeveloperExperienceConstruction.CONSTRUCTION_ID;
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
   * Get the default configuration (STANDARD_DX_PRESET).
   */
  getStandard(): dx.DeveloperExperienceConfig {
    return dx.STANDARD_DX_PRESET;
  }

  /**
   * Assess developer experience practices.
   *
   * @param input - Files and optional configuration
   * @param options - Assessment options
   * @returns DX assessment with scores and recommendations
   */
  async assess(
    input: DeveloperExperienceAssessmentInput,
    options?: AssessmentOptions
  ): Promise<DeveloperExperienceAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand DX context
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze developer experience including onboarding docs, workflow configuration, tooling setup, and documentation standards',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:dx_analysis:${queryResult.packs?.length || 0}_packs`);

    // Select configuration
    const config = input.config || this.getStandard();
    evidenceRefs.push(`config:${this.getConfigId(config)}`);

    // Calculate DX score
    const dxScore = dx.calculateDXScore(config);
    evidenceRefs.push(`dx_score:${dxScore.overall}`);

    // Generate onboarding checklist
    const onboardingChecklist = dx.generateOnboardingChecklist(config);
    evidenceRefs.push(`onboarding:${onboardingChecklist.items.length}_items`);

    // Validate workflow - validateWorkflow takes full config
    const workflowValidation = dx.validateWorkflow(config);
    evidenceRefs.push(`workflow:${workflowValidation.valid ? 'valid' : 'invalid'}`);

    // Compute breakdown - use breakdown property from DXScore
    const breakdown: Record<string, number> = {
      onboarding: Math.round(dxScore.breakdown.onboarding),
      workflow: Math.round(dxScore.breakdown.workflow),
      tooling: Math.round(dxScore.breakdown.tooling),
      documentation: Math.round(dxScore.breakdown.documentation),
      feedbackLoops: Math.round(dxScore.breakdown.feedback),
    };

    // Filter breakdown based on focus
    const focus = input.focus || ['onboarding', 'workflow', 'tooling', 'documentation'];
    const filteredBreakdown = Object.fromEntries(
      Object.entries(breakdown).filter(([key]) => {
        if (key === 'feedbackLoops') return focus.includes('tooling');
        return focus.includes(key as typeof focus[number]);
      })
    );

    // Overall score
    const score = Math.round(dxScore.overall);

    // Generate recommendations
    const recommendations = this.generateDXRecommendations(
      config,
      dxScore,
      workflowValidation,
      onboardingChecklist
    );

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, { score });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `DX assessment: ${score}/100`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown: filteredBreakdown,
      recommendations,
      dxScore,
      onboardingChecklist,
      workflowValidation,
      presetUsed: this.getConfigId(config),
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
   * Get configuration identifier.
   */
  private getConfigId(config: dx.DeveloperExperienceConfig): string {
    // Try to identify the preset
    if (this.configMatches(config, dx.WORLD_CLASS_DX_PRESET)) return 'world-class';
    if (this.configMatches(config, dx.STANDARD_DX_PRESET)) return 'standard';
    if (this.configMatches(config, dx.MINIMAL_DX_PRESET)) return 'minimal';
    return 'custom';
  }

  /**
   * Check if config matches a preset (simplified check).
   */
  private configMatches(
    a: dx.DeveloperExperienceConfig,
    b: dx.DeveloperExperienceConfig
  ): boolean {
    return (
      a.onboarding.timeToFirstCommitTarget === b.onboarding.timeToFirstCommitTarget &&
      a.workflow.branchStrategy === b.workflow.branchStrategy
    );
  }

  /**
   * Generate DX-specific recommendations.
   */
  private generateDXRecommendations(
    config: dx.DeveloperExperienceConfig,
    score: dx.DXScore,
    workflowValidation: dx.WorkflowValidationResult,
    onboardingChecklist: dx.OnboardingChecklist
  ): string[] {
    const recommendations: string[] = [];

    // Workflow validation issues
    for (const issue of workflowValidation.issues) {
      const severity = issue.severity === 'error' ? '[Error]' : '[Warning]';
      recommendations.push(`${severity} Workflow: ${issue.message}`);
    }

    // Low-scoring components (components is DXScoreComponent[])
    for (const component of score.components) {
      const percentScore = (component.score / component.maxScore) * 100;
      if (percentScore < 60) {
        recommendations.push(
          `[Improvement] ${component.name}: Score ${Math.round(percentScore)}/100 - needs attention`
        );
      }
    }

    // Onboarding items needing attention
    const requiredItems = onboardingChecklist.items.filter((i) => i.required);
    if (requiredItems.length > 0) {
      recommendations.push(
        `[Onboarding] ${requiredItems.length} required checklist items to complete`
      );
    }

    // Specific recommendations based on config
    if (!config.onboarding.setupAutomation.oneCommandBootstrap) {
      recommendations.push('[Quick Win] Implement one-command bootstrap for faster onboarding');
    }

    if (!config.tooling.formatting.enabled) {
      recommendations.push('[Quick Win] Enable automatic code formatting');
    }

    if (config.workflow.codeReview.minReviewers < 1) {
      recommendations.push('[Best Practice] Require at least one code reviewer');
    }

    return recommendations.slice(0, 10);
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
    const packBonus = Math.min(0.2, packCount * 0.04);

    const low = Math.min(0.85, baseConfidence + packBonus);
    const high = Math.min(0.95, low + 0.1);

    return bounded(low, high, 'theoretical', 'Developer experience assessment based on configuration analysis');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new developer experience construction.
 *
 * @param librainian - The librainian instance
 * @returns A new DeveloperExperienceConstruction
 */
export function createDeveloperExperienceConstruction(
  librainian: LiBrainian
): DeveloperExperienceConstruction {
  return new DeveloperExperienceConstruction(librainian);
}
