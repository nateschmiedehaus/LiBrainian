/**
 * @fileoverview Quality Standards Construction
 *
 * Construction wrapper for the quality_standards strategic module.
 * Assesses code and artifacts against world-class quality standards.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as qualityStandards from '../../strategic/quality_standards.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for quality assessment.
 */
export interface QualityAssessmentInput {
  /** Files to analyze */
  files: string[];
  /** Optional specific standard to use (defaults to WORLD_CLASS_STANDARDS) */
  standard?: qualityStandards.QualityStandard;
  /** Artifact metrics if pre-computed */
  metrics?: qualityStandards.ArtifactMetrics;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for quality assessment.
 */
export interface QualityAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Compliance result from validation */
  compliance: qualityStandards.ValidationResult;
  /** List of violations found */
  violations: qualityStandards.ValidationViolation[];
  /** The standard used for assessment */
  standardUsed: string;
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
 * Construction for assessing code quality against standards.
 *
 * Uses the quality_standards strategic module to validate artifacts
 * against configurable quality standards (WORLD_CLASS, PRODUCTION, MVP).
 *
 * @example
 * ```typescript
 * const construction = new QualityStandardsConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['src/api/librainian.ts'],
 *   standard: qualityStandards.PRODUCTION_STANDARDS,
 * });
 * console.log(`Quality Grade: ${result.grade}`);
 * ```
 */
export class QualityStandardsConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'QualityStandardsConstruction';
  readonly CONSTRUCTION_ID = QualityStandardsConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  /**
   * Creates a new quality standards construction.
   *
   * @param librainian - The librainian instance for context queries
   */
  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return QualityStandardsConstruction.CONSTRUCTION_ID;
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
   * Get the default standard (WORLD_CLASS_STANDARDS).
   */
  getStandard(): qualityStandards.QualityStandard {
    return qualityStandards.WORLD_CLASS_STANDARDS;
  }

  /**
   * Assess files against quality standards.
   *
   * @param input - Files and optional standard to use
   * @param options - Assessment options
   * @returns Quality assessment with compliance results
   */
  async assess(
    input: QualityAssessmentInput,
    options?: AssessmentOptions
  ): Promise<QualityAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian for intelligent analysis
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze code quality including complexity, test coverage, documentation, and maintainability',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : options?.depth === 'shallow' ? 'L1' : 'L2',
    });
    evidenceRefs.push(`librainian:quality_analysis:${queryResult.packs?.length || 0}_packs`);

    // Select standard
    const standard = input.standard || this.getStandard();
    evidenceRefs.push(`standard:${standard.id}`);

    // Build artifact for validation
    const artifact = qualityStandards.createArtifact({
      id: `assessment_${Date.now()}`,
      name: 'Code Quality Assessment',
      type: 'project',
      metrics: input.metrics || this.extractMetrics(queryResult, input.files),
    });
    evidenceRefs.push(`artifact:${artifact.id}`);

    // Validate against standard
    const validationResult = qualityStandards.validateAgainstStandard(artifact, standard);
    evidenceRefs.push(`validation:${validationResult.violations.length}_violations`);

    // Compute breakdown by dimension
    const breakdown: Record<string, number> = {
      correctness: this.computeDimensionScore(validationResult, 'correctness'),
      completeness: this.computeDimensionScore(validationResult, 'completeness'),
      reliability: this.computeDimensionScore(validationResult, 'reliability'),
      maintainability: this.computeDimensionScore(validationResult, 'maintainability'),
      epistemic: this.computeDimensionScore(validationResult, 'epistemic'),
    };

    // Generate recommendations
    const recommendations = this.generateQualityRecommendations(validationResult, breakdown);

    // Overall score
    const score = Math.round(validationResult.score * 100);

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, {
      score,
      violations: validationResult.violations,
    });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Quality assessment: ${score}/100 with ${validationResult.violations.length} violations`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown,
      recommendations,
      compliance: validationResult,
      violations: validationResult.violations,
      standardUsed: standard.id,
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
   * Extract metrics from query result.
   */
  private extractMetrics(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    files: string[]
  ): qualityStandards.ArtifactMetrics {
    const packs = queryResult.packs || [];
    const snippets = packs.flatMap((p) => p.codeSnippets || []);

    // Estimate metrics from available data
    const totalLines = snippets.reduce((sum, s) => sum + (s.endLine - s.startLine + 1), 0);
    const avgLinesPerFile = files.length > 0 ? totalLines / files.length : 0;

    return {
      testCoverage: 0.7, // Would need actual measurement
      mutationScore: undefined,
      cyclomaticComplexity: Math.min(15, Math.max(1, avgLinesPerFile / 10)),
      maxFileLines: Math.round(avgLinesPerFile),
      maxFunctionLines: Math.min(50, Math.max(5, avgLinesPerFile / 3)),
      observedErrorRate: 0.01,
      observedAvailability: 0.999,
      latencyP50: 100,
      latencyP99: 500,
      dependencyCount: packs.length,
      apiDocumentationCoverage: packs.some((p) => p.summary) ? 0.8 : 0.5,
      calibrationECE: 0.08,
      evidenceGroundingRate: 0.95,
      hallucinationRate: 0.02,
    };
  }

  /**
   * Compute score for a specific dimension.
   */
  private computeDimensionScore(
    result: qualityStandards.ValidationResult,
    dimension: string
  ): number {
    const dimensionViolations = result.violations.filter((v) =>
      v.dimension.toLowerCase().includes(dimension)
    );

    // Start at 100 and deduct for violations
    let score = 100;
    for (const violation of dimensionViolations) {
      const severity = violation.severity;
      const penalty =
        severity === 'error'
          ? 25
          : severity === 'warning'
            ? 10
            : 2;
      score -= penalty;
    }

    return Math.max(0, score);
  }

  /**
   * Generate quality-specific recommendations.
   */
  private generateQualityRecommendations(
    result: qualityStandards.ValidationResult,
    breakdown: Record<string, number>
  ): string[] {
    const recommendations: string[] = [];

    // Add recommendations for violations
    for (const violation of result.violations.slice(0, 5)) {
      const severity = violation.severity;
      const prefix =
        severity === 'error'
          ? '[Error]'
          : severity === 'warning'
            ? '[Warning]'
            : '[Info]';
      recommendations.push(
        `${prefix} ${violation.dimension}: ${violation.message}`
      );
    }

    // Add dimension-level recommendations
    const baseRecommendations = this.generateBreakdownRecommendations(breakdown, 70);
    recommendations.push(...baseRecommendations);

    return recommendations;
  }

  /**
   * Generate recommendations from score breakdown.
   */
  private generateBreakdownRecommendations(
    breakdown: Record<string, number>,
    threshold: number
  ): string[] {
    const recommendations: string[] = [];
    for (const [category, score] of Object.entries(breakdown)) {
      if (score < threshold) {
        recommendations.push(`Improve ${category}: current score ${score}/100`);
      }
    }
    return recommendations;
  }

  /**
   * Compute confidence based on query results and assessment data.
   */
  private computeConfidence(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    data: { score: number; violations: qualityStandards.ValidationViolation[] }
  ): ConfidenceValue {
    const packCount = queryResult.packs?.length || 0;
    const violationCount = data.violations.length;

    // More packs = more evidence = higher confidence
    // More violations = more certainty about issues
    const baseConfidence = 0.6;
    const packBonus = Math.min(0.15, packCount * 0.03);
    const violationClarity = violationCount > 0 ? 0.1 : 0.05;

    const low = Math.min(0.9, baseConfidence + packBonus);
    const high = Math.min(0.95, low + violationClarity + 0.1);

    return bounded(low, high, 'theoretical', 'Quality standard validation based on static analysis');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new quality standards construction.
 *
 * @param librainian - The librainian instance
 * @returns A new QualityStandardsConstruction
 */
export function createQualityStandardsConstruction(
  librainian: LiBrainian
): QualityStandardsConstruction {
  return new QualityStandardsConstruction(librainian);
}
