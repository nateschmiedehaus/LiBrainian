/**
 * @fileoverview Architecture Decisions Construction
 *
 * Construction wrapper for the architecture_decisions strategic module.
 * Assesses architecture against constraints and detects drift.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as archDecisions from '../../strategic/architecture_decisions.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for architecture assessment.
 */
export interface ArchitectureAssessmentInput {
  /** Files to analyze */
  files: string[];
  /** Architecture constraints to validate */
  constraints?: archDecisions.ArchitectureConstraint[];
  /** Existing ADRs to check drift against */
  adrs?: archDecisions.ArchitectureDecisionRecord[];
  /** Focus areas for assessment */
  focus?: Array<'layers' | 'naming' | 'dependencies' | 'patterns'>;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for architecture assessment.
 */
export interface ArchitectureAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Constraint violations found */
  violations: archDecisions.ConstraintViolation[];
  /** Technical debt estimate */
  technicalDebt: archDecisions.TechnicalDebtEstimate;
  /** Drift report */
  driftReport: archDecisions.ArchitectureDriftReport;
  /** Pattern recommendations */
  patternRecommendations: archDecisions.PatternRecommendation[];
  /** Trade-off analysis if alternatives found */
  tradeoffs?: archDecisions.TradeoffAnalysis;
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
 * Construction for assessing architecture decisions and constraints.
 *
 * Uses the architecture_decisions strategic module to validate
 * architectural integrity, detect drift, and recommend patterns.
 *
 * @example
 * ```typescript
 * const construction = new ArchitectureDecisionsConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['src/domain/**', 'src/infrastructure/**'],
 *   constraints: archDecisions.CLEAN_ARCHITECTURE_CONSTRAINTS,
 * });
 * console.log(`Violations: ${result.violations.length}`);
 * ```
 */
export class ArchitectureDecisionsConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'ArchitectureDecisionsConstruction';
  readonly CONSTRUCTION_ID = ArchitectureDecisionsConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return ArchitectureDecisionsConstruction.CONSTRUCTION_ID;
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
   * Get the default constraints (CLEAN_ARCHITECTURE_CONSTRAINTS).
   */
  getStandard(): archDecisions.ArchitectureConstraint[] {
    return archDecisions.CLEAN_ARCHITECTURE_CONSTRAINTS;
  }

  /**
   * Assess architecture against constraints.
   *
   * @param input - Files and constraints to check
   * @param options - Assessment options
   * @returns Architecture assessment with violations and recommendations
   */
  async assess(
    input: ArchitectureAssessmentInput,
    options?: AssessmentOptions
  ): Promise<ArchitectureAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand architecture
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze architecture including layer structure, dependencies, and design patterns',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:architecture_analysis:${queryResult.packs?.length || 0}_packs`);

    // Select constraints
    const constraints = input.constraints || this.getStandard();
    evidenceRefs.push(`constraints:${constraints.length}`);

    // Validate constraints
    const violations = await this.validateConstraints(constraints, input, queryResult);
    evidenceRefs.push(`violations:${violations.length}`);

    // Calculate technical debt
    const technicalDebt = archDecisions.calculateTechnicalDebt(violations);
    evidenceRefs.push(`debt:${technicalDebt.totalHours}h`);

    // Generate drift report
    const driftReport = archDecisions.generateDriftReport(constraints, violations);
    evidenceRefs.push(`drift:${driftReport.summary.totalViolations}_total`);

    // Generate pattern recommendations
    const patternRecommendations = this.generatePatternRecommendations(queryResult, violations);
    evidenceRefs.push(`patterns:${patternRecommendations.length}`);

    // Compute breakdown
    const breakdown: Record<string, number> = {
      layerIntegrity: this.computeLayerScore(violations),
      namingConventions: this.computeNamingScore(violations),
      dependencyManagement: this.computeDependencyScore(violations),
      patternCompliance: this.computePatternScore(violations),
    };

    // Overall score
    const score = this.computeOverallScore(violations, constraints.length);

    // Generate recommendations from breakdown
    const breakdownRecommendations = this.generateBreakdownRecommendations(breakdown, 70);

    // Generate recommendations
    const recommendations = [
      ...driftReport.recommendations,
      ...breakdownRecommendations,
    ];

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, {
      score,
      violations,
    });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Architecture assessment: ${score}/100 with ${violations.length} violations`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown,
      recommendations,
      violations,
      technicalDebt,
      driftReport,
      patternRecommendations,
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
   * Validate constraints against codebase.
   */
  private async validateConstraints(
    constraints: archDecisions.ArchitectureConstraint[],
    input: ArchitectureAssessmentInput,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): Promise<archDecisions.ConstraintViolation[]> {
    const violations: archDecisions.ConstraintViolation[] = [];
    const focus = input.focus || ['layers', 'naming', 'dependencies', 'patterns'];

    for (const constraint of constraints) {
      // Skip constraints not in focus
      if (
        (constraint.type === 'layer_dependency' && !focus.includes('layers')) ||
        (constraint.type === 'naming_convention' && !focus.includes('naming')) ||
        (constraint.type === 'circular_dependency' && !focus.includes('dependencies'))
      ) {
        continue;
      }

      // Check constraint based on type
      const constraintViolations = this.checkConstraint(constraint, input, queryResult);
      violations.push(...constraintViolations);
    }

    return violations;
  }

  /**
   * Check a single constraint.
   */
  private checkConstraint(
    constraint: archDecisions.ArchitectureConstraint,
    input: ArchitectureAssessmentInput,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): archDecisions.ConstraintViolation[] {
    const violations: archDecisions.ConstraintViolation[] = [];
    const packs = queryResult.packs || [];

    switch (constraint.type) {
      case 'layer_dependency':
        // Check for forbidden dependencies in related files
        for (const pack of packs) {
          const files = pack.relatedFiles || [];
          const matchesScope =
            !constraint.scope || files.some((f) => this.matchGlob(f, constraint.scope!));

          if (matchesScope && constraint.forbiddenDependencies) {
            for (const forbidden of constraint.forbiddenDependencies) {
              // Check snippets for imports from forbidden layers
              for (const snippet of pack.codeSnippets || []) {
                if (snippet.content.includes(forbidden)) {
                  violations.push({
                    constraintId: constraint.id,
                    file: snippet.filePath || files[0] || 'unknown',
                    line: snippet.startLine,
                    message: `Forbidden dependency on ${forbidden} violates ${constraint.rule}`,
                    severity: constraint.severity,
                    suggestion: `Remove dependency on ${forbidden} layer`,
                  });
                }
              }
            }
          }
        }
        break;

      case 'naming_convention':
        // Check for naming violations
        if (constraint.pattern) {
          const pattern = new RegExp(constraint.pattern);
          for (const file of input.files) {
            if (constraint.scope && !this.matchGlob(file, constraint.scope)) {
              continue;
            }
            const filename = file.split('/').pop() || file;
            if (!pattern.test(filename)) {
              violations.push({
                constraintId: constraint.id,
                file,
                message: `File name '${filename}' does not match pattern '${constraint.pattern}'`,
                severity: constraint.severity,
                suggestion: `Rename to match ${constraint.pattern}`,
              });
            }
          }
        }
        break;

      case 'circular_dependency':
        // Would need dependency graph analysis - simplified check
        const circularHint = packs.some((p) =>
          p.keyFacts?.some((f) => f.toLowerCase().includes('circular'))
        );
        if (circularHint) {
          violations.push({
            constraintId: constraint.id,
            file: 'multiple',
            message: 'Potential circular dependency detected',
            severity: constraint.severity,
            suggestion: 'Refactor to break the dependency cycle',
          });
        }
        break;
    }

    return violations;
  }

  /**
   * Simple glob matching.
   */
  private matchGlob(path: string, pattern: string): boolean {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.') +
        '$'
    );
    return regex.test(path);
  }

  /**
   * Generate pattern recommendations.
   */
  private generatePatternRecommendations(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    violations: archDecisions.ConstraintViolation[]
  ): archDecisions.PatternRecommendation[] {
    const recommendations: archDecisions.PatternRecommendation[] = [];

    // Recommend patterns based on violations
    const hasLayerViolations = violations.some((v) =>
      v.message.toLowerCase().includes('layer')
    );
    if (hasLayerViolations) {
      recommendations.push(
        archDecisions.createPatternRecommendation({
          pattern: 'Clean Architecture',
          description: 'Organize code into concentric layers with dependencies pointing inward',
          applicability: ['Applications with complex business logic', 'Long-lived codebases'],
          confidence: bounded(0.7, 0.9, 'literature', 'Clean Architecture by Robert C. Martin'),
        })
      );
    }

    const hasDependencyViolations = violations.some((v) =>
      v.message.toLowerCase().includes('dependency')
    );
    if (hasDependencyViolations) {
      recommendations.push(
        archDecisions.createPatternRecommendation({
          pattern: 'Dependency Injection',
          description: 'Inject dependencies rather than creating them directly',
          applicability: ['Testable code', 'Loosely coupled modules'],
          confidence: bounded(0.8, 0.95, 'literature', 'Dependency Injection Principles, Practices, and Patterns'),
        })
      );
    }

    return recommendations;
  }

  /**
   * Compute score for layer integrity.
   */
  private computeLayerScore(violations: archDecisions.ConstraintViolation[]): number {
    const layerViolations = violations.filter(
      (v) => v.message.toLowerCase().includes('layer') || v.message.toLowerCase().includes('forbidden')
    );
    return Math.max(0, 100 - layerViolations.length * 10);
  }

  /**
   * Compute score for naming conventions.
   */
  private computeNamingScore(violations: archDecisions.ConstraintViolation[]): number {
    const namingViolations = violations.filter((v) =>
      v.message.toLowerCase().includes('naming') || v.message.toLowerCase().includes('pattern')
    );
    return Math.max(0, 100 - namingViolations.length * 5);
  }

  /**
   * Compute score for dependency management.
   */
  private computeDependencyScore(violations: archDecisions.ConstraintViolation[]): number {
    const depViolations = violations.filter(
      (v) =>
        v.message.toLowerCase().includes('circular') ||
        v.message.toLowerCase().includes('dependency')
    );
    return Math.max(0, 100 - depViolations.length * 15);
  }

  /**
   * Compute score for pattern compliance.
   */
  private computePatternScore(violations: archDecisions.ConstraintViolation[]): number {
    const patternViolations = violations.filter((v) =>
      v.message.toLowerCase().includes('pattern')
    );
    return Math.max(0, 100 - patternViolations.length * 8);
  }

  /**
   * Compute overall architecture score.
   */
  private computeOverallScore(
    violations: archDecisions.ConstraintViolation[],
    totalConstraints: number
  ): number {
    if (totalConstraints === 0) return 100;

    // Weight violations by severity
    let penalty = 0;
    for (const violation of violations) {
      penalty +=
        violation.severity === 'error' ? 15 : violation.severity === 'warning' ? 8 : 3;
    }

    return Math.max(0, Math.min(100, 100 - penalty));
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
    data: { score: number; violations: archDecisions.ConstraintViolation[] }
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

    return bounded(low, high, 'theoretical', 'Architecture constraint validation based on static analysis');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new architecture decisions construction.
 *
 * @param librainian - The librainian instance
 * @returns A new ArchitectureDecisionsConstruction
 */
export function createArchitectureDecisionsConstruction(
  librainian: LiBrainian
): ArchitectureDecisionsConstruction {
  return new ArchitectureDecisionsConstruction(librainian);
}
