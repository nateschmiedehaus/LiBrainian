/**
 * @fileoverview Quality Assessment Construction
 *
 * A composed construction that wraps the strategic quality_standards module
 * to provide quality assessment with confidence tracking and calibration.
 *
 * Composes:
 * - Query API for code metrics collection
 * - Quality Standards for validation
 * - Evidence Ledger for traceability
 * - Confidence System for uncertainty quantification
 * - Calibration Tracking for confidence accuracy measurement
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue, MeasuredConfidence, BoundedConfidence } from '../../epistemics/confidence.js';
import type { ContextPack } from '../../types.js';
import type {
  ConstructionCalibrationTracker,
  CalibratedConstruction,
  VerificationMethod,
} from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import {
  validateAgainstStandard,
  WORLD_CLASS_STANDARDS,
  type QualityStandard,
  type ValidationResult,
  type ValidatableArtifact,
  type ArtifactMetrics,
} from '../../strategic/quality_standards.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of a quality assessment.
 */
export interface QualityAssessmentResult {
  /** Compliance validation result */
  compliance: ValidationResult;
  /** Confidence in this assessment */
  confidence: ConfidenceValue;
  /** Evidence trail */
  evidenceRefs: string[];
  /** Time taken for analysis in milliseconds */
  analysisTimeMs: number;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
  /** Files that were analyzed */
  analyzedFiles: string[];
  /** Standard used for validation */
  standardId: string;
  /** Metrics collected from code analysis */
  collectedMetrics: Partial<ArtifactMetrics>;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Quality Assessment Construction - wraps quality_standards.ts in the
 * construction pattern with confidence tracking and calibration.
 *
 * Usage:
 * ```typescript
 * const construction = new QualityAssessmentConstruction(librainian);
 * const result = await construction.assess(['src/module.ts']);
 * console.log(`Compliance: ${result.compliance.passed}`);
 * console.log(`Score: ${result.compliance.score}`);
 * ```
 */
export class QualityAssessmentConstruction implements CalibratedConstruction {
  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  static readonly CONSTRUCTION_ID = 'QualityAssessmentConstruction';

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return QualityAssessmentConstruction.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   * Call this after verifying the assessment outcome.
   *
   * @param predictionId - The prediction ID from the assessment result
   * @param wasCorrect - Whether the assessment was correct
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
   * Assess code quality for the given files against a quality standard.
   *
   * @param files - Files to assess
   * @param standard - Quality standard to validate against (defaults to WORLD_CLASS_STANDARDS)
   * @returns Quality assessment result with compliance, confidence, and evidence
   */
  async assess(
    files: string[],
    standard: QualityStandard = WORLD_CLASS_STANDARDS
  ): Promise<QualityAssessmentResult> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Step 1: Query librainian for code metrics
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze code quality metrics',
      affectedFiles: files,
      depth: 'L2',
    });
    evidenceRefs.push('librainian_query:quality_metrics');

    // Step 2: Extract metrics from query result
    const collectedMetrics = this.extractMetricsFromPacks(queryResult.packs, files);
    evidenceRefs.push(`metrics_extraction:${files.length}_files`);

    // Step 3: Build validatable artifact
    const artifact = this.buildArtifact(collectedMetrics, files);
    evidenceRefs.push(`artifact:${artifact.id}`);

    // Step 4: Run validation against standard
    const compliance = validateAgainstStandard(artifact, standard);
    evidenceRefs.push(`validation:${standard.id}`);

    // Step 5: Compute confidence
    const confidence = this.computeConfidence(queryResult.packs, compliance, files);

    // Step 6: Record prediction for calibration tracking
    const predictionId = generatePredictionId(QualityAssessmentConstruction.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        QualityAssessmentConstruction.CONSTRUCTION_ID,
        predictionId,
        confidence,
        `Quality assessment ${compliance.passed ? 'passed' : 'failed'} against ${standard.id}`,
        {
          files,
          standardId: standard.id,
          score: compliance.score,
          violationCount: compliance.violations.length,
        }
      );
    }

    return {
      compliance,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
      analyzedFiles: files,
      standardId: standard.id,
      collectedMetrics,
    };
  }

  /**
   * Extract metrics from context packs returned by librainian.
   */
  private extractMetricsFromPacks(
    packs: ContextPack[],
    files: string[]
  ): Partial<ArtifactMetrics> {
    const metrics: Partial<ArtifactMetrics> = {};

    // Aggregate metrics from packs
    let totalComplexity = 0;
    let maxFileLines = 0;
    let maxFunctionLines = 0;
    let packCount = 0;

    for (const pack of packs) {
      packCount++;

      // Estimate complexity from code snippets
      if (pack.codeSnippets) {
        for (const snippet of pack.codeSnippets) {
          const lines = snippet.endLine - snippet.startLine + 1;
          maxFileLines = Math.max(maxFileLines, lines);

          // Rough complexity estimation based on control flow
          const content = snippet.content;
          const ifCount = (content.match(/\bif\b/g) || []).length;
          const forCount = (content.match(/\bfor\b/g) || []).length;
          const whileCount = (content.match(/\bwhile\b/g) || []).length;
          const switchCount = (content.match(/\bswitch\b/g) || []).length;
          const caseCount = (content.match(/\bcase\b/g) || []).length;

          const snippetComplexity = 1 + ifCount + forCount + whileCount + switchCount + caseCount;
          totalComplexity += snippetComplexity;
          maxFunctionLines = Math.max(maxFunctionLines, lines);
        }
      }
    }

    if (packCount > 0) {
      metrics.cyclomaticComplexity = Math.round(totalComplexity / packCount);
      metrics.maxFileLines = maxFileLines;
      metrics.maxFunctionLines = maxFunctionLines;
    }

    // Set defaults for metrics we cannot measure from packs
    metrics.dependencyCount = files.length; // Rough estimate

    return metrics;
  }

  /**
   * Build a validatable artifact from collected metrics.
   */
  private buildArtifact(
    metrics: Partial<ArtifactMetrics>,
    files: string[]
  ): ValidatableArtifact {
    return {
      id: `quality-assessment-${Date.now()}`,
      name: files.length === 1 ? files[0] : `${files.length} files`,
      type: files.length === 1 ? 'file' : 'project',
      metrics: metrics as ArtifactMetrics,
    };
  }

  /**
   * Compute confidence in the assessment.
   */
  private computeConfidence(
    packs: ContextPack[],
    compliance: ValidationResult,
    files: string[]
  ): ConfidenceValue {
    // Confidence factors:
    // 1. Number of packs found (coverage)
    // 2. Pack confidence levels
    // 3. Number of files analyzed

    if (packs.length === 0) {
      // No context packs - low confidence
      return {
        type: 'bounded' as const,
        low: 0.2,
        high: 0.5,
        basis: 'theoretical' as const,
        citation: 'No context packs found for analyzed files',
      };
    }

    // Calculate average pack confidence
    const avgPackConfidence = packs.reduce((sum, pack) => sum + pack.confidence, 0) / packs.length;

    // Factor in coverage (packs per file)
    const coverageRatio = Math.min(1, packs.length / files.length);

    // Compute overall confidence
    const baseConfidence = avgPackConfidence * 0.6 + coverageRatio * 0.4;

    // Apply penalty for warnings (undefined metrics)
    const warningCount = compliance.violations.filter((v) => v.severity === 'warning').length;
    const confidenceWithPenalty = baseConfidence * (1 - warningCount * 0.02);

    return {
      type: 'measured' as const,
      value: Math.max(0.1, Math.min(1, confidenceWithPenalty)),
      measurement: {
        datasetId: 'quality_assessment',
        sampleSize: packs.length,
        accuracy: confidenceWithPenalty,
        confidenceInterval: [
          Math.max(0, confidenceWithPenalty - 0.15),
          Math.min(1, confidenceWithPenalty + 0.15),
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
 * Create a Quality Assessment Construction.
 *
 * @param librainian - The librainian instance to use for queries
 * @returns New construction instance
 */
export function createQualityAssessmentConstruction(
  librainian: LiBrainian
): QualityAssessmentConstruction {
  return new QualityAssessmentConstruction(librainian);
}
