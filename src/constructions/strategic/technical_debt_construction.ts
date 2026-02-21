/**
 * @fileoverview Technical Debt Construction
 *
 * Construction wrapper for the technical_debt strategic module.
 * Assesses technical debt and provides prioritized paydown plans.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as technicalDebt from '../../strategic/technical_debt.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for technical debt assessment.
 */
export interface TechnicalDebtAssessmentInput {
  /** Files to analyze */
  files: string[];
  /** Complexity budget to validate against (defaults to DEFAULT_COMPLEXITY_BUDGET) */
  complexityBudget?: technicalDebt.ComplexityBudget;
  /** Prevention policy to check (defaults to DEFAULT_PREVENTION_POLICY) */
  preventionPolicy?: technicalDebt.DebtPreventionPolicy;
  /** Existing inventory if available */
  inventory?: technicalDebt.DebtInventory;
  /** Budget hours available for paydown */
  paydownBudgetHours?: number;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for technical debt assessment.
 */
export interface TechnicalDebtAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Dashboard with debt summary and trends */
  dashboard: technicalDebt.DebtDashboard;
  /** Paydown plan if budget provided */
  paydownPlan?: technicalDebt.PaydownPlan;
  /** Policy validation result */
  policyValidation?: technicalDebt.PolicyValidationResult;
  /** Complexity validation result */
  complexityValidation: technicalDebt.ComplexityValidationResult;
  /** Detected debt items */
  debtItems: technicalDebt.TechnicalDebtItem[];
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
 * Construction for assessing technical debt.
 *
 * Uses the technical_debt strategic module to detect, prioritize,
 * and plan paydown of technical debt.
 *
 * @example
 * ```typescript
 * const construction = new TechnicalDebtConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['src/**'],
 *   paydownBudgetHours: 40,
 * });
 * console.log(`Total Debt: ${result.dashboard.summary.totalPrincipal}h`);
 * ```
 */
export class TechnicalDebtConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'TechnicalDebtConstruction';
  readonly CONSTRUCTION_ID = TechnicalDebtConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return TechnicalDebtConstruction.CONSTRUCTION_ID;
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
   * Get the default prevention policy.
   */
  getStandard(): technicalDebt.DebtPreventionPolicy {
    return technicalDebt.DEFAULT_PREVENTION_POLICY;
  }

  /**
   * Assess technical debt in the codebase.
   *
   * @param input - Files and optional configuration
   * @param options - Assessment options
   * @returns Technical debt assessment
   */
  async assess(
    input: TechnicalDebtAssessmentInput,
    options?: AssessmentOptions
  ): Promise<TechnicalDebtAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand code context
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze code for technical debt including complexity, duplication, outdated dependencies, missing tests, and code smells',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:debt_analysis:${queryResult.packs?.length || 0}_packs`);

    // Detect debt items
    const debtItems = await this.detectDebtItems(input.files, queryResult);
    evidenceRefs.push(`debt_items:${debtItems.length}`);

    // Create inventory
    const inventory = input.inventory || technicalDebt.createDebtInventory(debtItems);
    evidenceRefs.push(`inventory:${inventory.totalPrincipal}h_principal`);

    // Validate against complexity budget
    const complexityBudget = input.complexityBudget || technicalDebt.DEFAULT_COMPLEXITY_BUDGET;
    const metrics = this.extractCodeMetrics(queryResult, input.files);
    const complexityValidation = technicalDebt.validateComplexityBudget(metrics, complexityBudget);
    evidenceRefs.push(`complexity:${complexityValidation.violations.length}_violations`);

    // Generate dashboard (with empty history since we don't have historical data)
    const dashboard = technicalDebt.generateDebtDashboard(inventory, []);
    evidenceRefs.push(`dashboard:health_${dashboard.summary.healthScore}`);

    // Generate paydown plan if budget provided
    let paydownPlan: technicalDebt.PaydownPlan | undefined;
    if (input.paydownBudgetHours && debtItems.length > 0) {
      paydownPlan = technicalDebt.createPaydownPlan(debtItems, input.paydownBudgetHours, {
        roiWeight: 0.7, // Prioritize by ROI with higher weight
        riskWeight: 0.3,
      });
      evidenceRefs.push(`paydown:${paydownPlan.items.length}_items`);
    }

    // Compute breakdown
    const breakdown: Record<string, number> = {
      complexity: Math.max(0, 100 - complexityValidation.violations.length * 10),
      duplication: this.computeDebtTypeScore(debtItems, 'code', 'duplication'),
      testCoverage: this.computeDebtTypeScore(debtItems, 'code', 'missing_tests'),
      dependencies: this.computeDebtTypeScore(debtItems, 'dependency', 'outdated_dependency'),
      documentation: this.computeDebtTypeScore(debtItems, 'documentation', 'missing_docs'),
    };

    // Overall score based on health score
    const score = dashboard.summary.healthScore;

    // Generate recommendations
    const recommendations = dashboard.recommendations.map(
      (r) => `[${r.type.toUpperCase()}] ${r.title}: ${r.description}`
    );

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, {
      score,
      violations: complexityValidation.violations,
    });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Technical debt assessment: ${score}/100 with ${debtItems.length} items`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown,
      recommendations,
      dashboard,
      paydownPlan,
      complexityValidation,
      debtItems,
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
   * Detect debt items from analysis.
   */
  private async detectDebtItems(
    files: string[],
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): Promise<technicalDebt.TechnicalDebtItem[]> {
    const items: technicalDebt.TechnicalDebtItem[] = [];
    const packs = queryResult.packs || [];

    // Detect complexity debt
    for (const pack of packs) {
      const snippets = pack.codeSnippets || [];
      for (const snippet of snippets) {
        const lines = snippet.content.split('\n').length;

        // Long functions
        if (lines > 100) {
          items.push(
            technicalDebt.createDebtItem({
              title: `Long function in ${snippet.filePath}`,
              description: `Function at line ${snippet.startLine} has ${lines} lines`,
              type: 'code',
              category: 'complexity',
              severity: lines > 200 ? 'high' : 'medium',
              affectedFiles: [snippet.filePath || 'unknown'],
              principalCost: Math.ceil(lines / 20),
              interestRate: 1.1,
            })
          );
        }

        // Deep nesting detection
        const maxNesting = this.detectNestingDepth(snippet.content);
        if (maxNesting > 4) {
          items.push(
            technicalDebt.createDebtItem({
              title: `Deep nesting in ${snippet.filePath}`,
              description: `Nesting depth of ${maxNesting} at line ${snippet.startLine}`,
              type: 'code',
              category: 'complexity',
              severity: maxNesting > 6 ? 'high' : 'medium',
              affectedFiles: [snippet.filePath || 'unknown'],
              principalCost: Math.ceil(maxNesting / 2),
              interestRate: 1.05,
            })
          );
        }

        // TODO/FIXME detection
        const todoCount = (snippet.content.match(/TODO|FIXME|HACK/g) || []).length;
        if (todoCount > 0) {
          items.push(
            technicalDebt.createDebtItem({
              title: `Technical debt markers in ${snippet.filePath}`,
              description: `Found ${todoCount} TODO/FIXME/HACK comments`,
              type: 'code',
              category: 'workaround',
              severity: todoCount > 3 ? 'medium' : 'low',
              affectedFiles: [snippet.filePath || 'unknown'],
              principalCost: todoCount * 2,
              interestRate: 1.02,
            })
          );
        }
      }

      // Missing documentation
      if (!pack.summary || pack.summary.length < 20) {
        items.push(
          technicalDebt.createDebtItem({
            title: `Missing documentation for ${pack.targetId}`,
            description: 'Component lacks adequate documentation',
            type: 'documentation',
            category: 'missing_docs',
            severity: 'low',
            affectedFiles: pack.relatedFiles || [],
            principalCost: 1,
            interestRate: 1.01,
          })
        );
      }
    }

    return items;
  }

  /**
   * Detect maximum nesting depth in code.
   */
  private detectNestingDepth(code: string): number {
    let maxNesting = 0;
    let currentNesting = 0;

    for (const char of code) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        currentNesting = Math.max(0, currentNesting - 1);
      }
    }

    return maxNesting;
  }

  /**
   * Extract code metrics from query result.
   */
  private extractCodeMetrics(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    files: string[]
  ): technicalDebt.CodeMetrics {
    const packs = queryResult.packs || [];
    const snippets = packs.flatMap((p) => p.codeSnippets || []);

    // Compute average metrics
    let totalLines = 0;
    let maxComplexity = 1;
    let maxNesting = 0;

    for (const snippet of snippets) {
      const lines = snippet.content.split('\n').length;
      totalLines += lines;
      maxNesting = Math.max(maxNesting, this.detectNestingDepth(snippet.content));

      // Estimate complexity from conditionals
      const conditionals = (snippet.content.match(/if|else|switch|while|for|\?/g) || []).length;
      maxComplexity = Math.max(maxComplexity, conditionals);
    }

    const avgLinesPerFile = files.length > 0 ? totalLines / files.length : 0;

    return {
      cyclomaticComplexity: Math.min(50, maxComplexity),
      fileLines: Math.round(avgLinesPerFile),
      functionLines: Math.min(200, Math.round(avgLinesPerFile / 3)),
      dependencies: packs.length,
      nestingDepth: maxNesting,
      parameters: 5, // Estimated
    };
  }

  /**
   * Compute score for a specific debt type/category.
   */
  private computeDebtTypeScore(
    items: technicalDebt.TechnicalDebtItem[],
    type: technicalDebt.DebtType,
    category: technicalDebt.DebtCategory
  ): number {
    const relevantItems = items.filter((i) => i.type === type && i.category === category);
    const totalPrincipal = relevantItems.reduce((sum, i) => sum + i.principalCost, 0);

    // Score decreases with more debt
    return Math.max(0, 100 - totalPrincipal * 5);
  }

  /**
   * Compute confidence based on query results and assessment data.
   */
  private computeConfidence(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    data: { score: number; violations: technicalDebt.ComplexityViolation[] }
  ): ConfidenceValue {
    const packCount = queryResult.packs?.length || 0;
    const violationCount = data.violations.length;

    // More packs = more evidence = higher confidence
    const baseConfidence = 0.6;
    const packBonus = Math.min(0.15, packCount * 0.03);
    const violationClarity = violationCount > 0 ? 0.1 : 0.05;

    const low = Math.min(0.9, baseConfidence + packBonus);
    const high = Math.min(0.95, low + violationClarity + 0.1);

    return bounded(low, high, 'theoretical', 'Technical debt analysis based on code metrics and heuristics');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new technical debt construction.
 *
 * @param librainian - The librainian instance
 * @returns A new TechnicalDebtConstruction
 */
export function createTechnicalDebtConstruction(
  librainian: LiBrainian
): TechnicalDebtConstruction {
  return new TechnicalDebtConstruction(librainian);
}
