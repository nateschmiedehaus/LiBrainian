/**
 * @fileoverview Assessment Construction Base Class
 *
 * Provides an abstract base class for scoring/grading constructions.
 * Assessment constructions evaluate inputs against standards and produce
 * numeric scores, letter grades, and recommendations.
 *
 * Use this base class when your construction:
 * - Produces a numeric score (0-100)
 * - Assigns a grade (A+, A, B, etc.)
 * - Provides a breakdown of contributing factors
 * - Generates recommendations for improvement
 *
 * Examples: Code quality assessment, security scoring, performance grading
 *
 * @packageDocumentation
 */

import type { Librarian } from '../../api/librarian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import { BaseConstruction, toEvidenceIds, type ConstructionResult } from './construction_base.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Grade levels for assessment results.
 */
export type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';

/**
 * Simple grade scale (without plus/minus).
 */
export type SimpleGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * Priority level for recommendations.
 */
export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Estimated effort for a recommendation.
 */
export type RecommendationEffort = 'trivial' | 'small' | 'medium' | 'large' | 'major';

/**
 * A score category in the breakdown.
 */
export interface ScoreCategory {
  /** Category identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Score for this category (0-100) */
  score: number;
  /** Weight of this category in the overall score */
  weight: number;
  /** Description of the category */
  description?: string;
  /** Sub-scores if applicable */
  subScores?: ScoreCategory[];
}

/**
 * Breakdown of how the score was computed.
 */
export interface ScoreBreakdown {
  /** Individual category scores */
  categories: ScoreCategory[];
  /** Weighted average computation details */
  computation: {
    formula: string;
    weights: Record<string, number>;
  };
}

/**
 * A recommendation for improvement.
 */
export interface Recommendation {
  /** Unique identifier */
  id: string;
  /** Title of the recommendation */
  title: string;
  /** Detailed description */
  description: string;
  /** Priority level */
  priority: RecommendationPriority;
  /** Estimated effort to implement */
  effort: RecommendationEffort;
  /** Expected score impact if implemented */
  expectedImpact: number;
  /** Files or areas affected */
  affectedAreas?: string[];
  /** Specific action items */
  actionItems?: string[];
}

/**
 * Result of an assessment construction.
 */
export interface AssessmentResult extends ConstructionResult {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: Grade;
  /** Breakdown of score components */
  breakdown: ScoreBreakdown;
  /** Recommendations for improvement */
  recommendations: Recommendation[];
  /** Number of items assessed */
  itemsAssessed: number;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
  /** Maximum time to spend on analysis */
  maxTimeMs?: number;
  /** Whether to include detailed breakdowns */
  includeBreakdown?: boolean;
}

// ============================================================================
// GRADE THRESHOLDS
// ============================================================================

/**
 * Default grade thresholds (can be overridden by subclasses).
 */
export const DEFAULT_GRADE_THRESHOLDS: Record<Grade, number> = {
  'A+': 97,
  'A': 93,
  'A-': 90,
  'B+': 87,
  'B': 83,
  'B-': 80,
  'C+': 77,
  'C': 73,
  'C-': 70,
  'D+': 67,
  'D': 63,
  'D-': 60,
  'F': 0,
};

/**
 * Simple grade thresholds (without plus/minus).
 */
export const SIMPLE_GRADE_THRESHOLDS: Record<SimpleGrade, number> = {
  'A': 90,
  'B': 80,
  'C': 70,
  'D': 60,
  'F': 0,
};

// ============================================================================
// ASSESSMENT CONSTRUCTION BASE
// ============================================================================

/**
 * Abstract base class for assessment/scoring constructions.
 *
 * Assessment constructions evaluate inputs against a standard and produce:
 * - A numeric score (0-100)
 * - A letter grade
 * - A breakdown of contributing factors
 * - Recommendations for improvement
 *
 * Type Parameters:
 * - TInput: The input type to assess
 * - TStandard: The type representing the assessment standard
 *
 * @example
 * ```typescript
 * interface CodeInput {
 *   files: string[];
 *   language: string;
 * }
 *
 * interface QualityStandard {
 *   name: string;
 *   thresholds: Record<string, number>;
 * }
 *
 * class CodeQualityAssessor extends AssessmentConstruction<CodeInput, QualityStandard> {
 *   readonly CONSTRUCTION_ID = 'CodeQualityAssessor';
 *
 *   getStandard(): QualityStandard {
 *     return {
 *       name: 'Enterprise Quality Standard',
 *       thresholds: { complexity: 10, duplication: 5 },
 *     };
 *   }
 *
 *   async assess(input: CodeInput): Promise<AssessmentResult> {
 *     const startTime = Date.now();
 *     // ... perform assessment ...
 *     return this.buildAssessmentResult(score, breakdown, recommendations, Date.now() - startTime);
 *   }
 * }
 * ```
 */
export abstract class AssessmentConstruction<TInput, TStandard>
  extends BaseConstruction<TInput, AssessmentResult> {

  /** Grade thresholds (can be overridden) */
  protected gradeThresholds: Record<Grade, number> = DEFAULT_GRADE_THRESHOLDS;

  /**
   * Get the standard for this assessment.
   *
   * Subclasses must implement this to provide their assessment standard.
   *
   * @returns The standard for this assessment
   */
  abstract getStandard(): TStandard;

  /**
   * Perform the assessment.
   *
   * Subclasses must implement this to perform their specific assessment.
   *
   * @param input - The input to assess
   * @returns Promise resolving to the assessment result
   */
  abstract assess(input: TInput): Promise<AssessmentResult>;

  /**
   * Execute the construction (delegates to assess).
   *
   * @param input - The input to assess
   * @returns Promise resolving to the assessment result
   */
  async execute(input: TInput): Promise<AssessmentResult> {
    return this.assess(input);
  }

  /**
   * Compute a letter grade from a numeric score (with plus/minus).
   *
   * @param score - The numeric score (0-100)
   * @returns The corresponding letter grade
   */
  protected computeGrade(score: number): Grade {
    const grades: Grade[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];

    for (const grade of grades) {
      if (score >= this.gradeThresholds[grade]) {
        return grade;
      }
    }

    return 'F';
  }

  /**
   * Compute a simple letter grade (A, B, C, D, F) from a numeric score.
   *
   * @param score - The numeric score (0-100)
   * @returns The corresponding simple letter grade
   */
  protected computeSimpleGrade(score: number): SimpleGrade {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Compute weighted average score from categories.
   *
   * @param categories - Score categories with weights
   * @returns Weighted average score (0-100)
   */
  protected computeWeightedScore(categories: ScoreCategory[]): number {
    const totalWeight = categories.reduce((sum, cat) => sum + cat.weight, 0);

    if (totalWeight === 0) {
      return 0;
    }

    const weightedSum = categories.reduce(
      (sum, cat) => sum + cat.score * cat.weight,
      0
    );

    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  /**
   * Build a score breakdown from categories.
   *
   * @param categories - The scored categories
   * @returns The score breakdown
   */
  protected buildScoreBreakdown(categories: ScoreCategory[]): ScoreBreakdown {
    const weights: Record<string, number> = {};
    for (const cat of categories) {
      weights[cat.id] = cat.weight;
    }

    return {
      categories,
      computation: {
        formula: 'weighted_average(categories)',
        weights,
      },
    };
  }

  /**
   * Generate recommendations based on scores.
   *
   * @param categories - The scored categories
   * @param threshold - Score below which to recommend improvement (default: 70)
   * @returns Array of recommendations
   */
  protected generateRecommendations(
    categories: ScoreCategory[],
    threshold: number = 70
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Sort by score ascending (worst first)
    const sortedCategories = [...categories].sort((a, b) => a.score - b.score);

    for (const category of sortedCategories) {
      if (category.score < threshold) {
        const priority = this.computeRecommendationPriority(category.score, category.weight);
        const effort = this.estimateEffort(category.score);
        const expectedImpact = this.estimateImpact(category.score, category.weight);

        recommendations.push({
          id: `improve-${category.id}`,
          title: `Improve ${category.name}`,
          description: `Current score: ${category.score}. ${category.description || 'Consider improvements in this area.'}`,
          priority,
          effort,
          expectedImpact,
          actionItems: this.generateActionItems(category),
        });
      }
    }

    return recommendations;
  }

  /**
   * Compute recommendation priority based on score and weight.
   */
  private computeRecommendationPriority(score: number, weight: number): RecommendationPriority {
    // Critical if very low score and high weight
    if (score < 40 && weight >= 0.3) return 'critical';
    if (score < 50 || (score < 60 && weight >= 0.25)) return 'high';
    if (score < 70) return 'medium';
    return 'low';
  }

  /**
   * Estimate effort to improve a category.
   */
  private estimateEffort(score: number): RecommendationEffort {
    if (score >= 80) return 'trivial';
    if (score >= 60) return 'small';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'large';
    return 'major';
  }

  /**
   * Estimate impact of improving a category.
   */
  private estimateImpact(score: number, weight: number): number {
    // Maximum potential improvement
    const maxImprovement = 100 - score;
    // Weighted by category importance
    return Math.round(maxImprovement * weight);
  }

  /**
   * Generate action items for a category.
   * Subclasses can override this for domain-specific actions.
   */
  protected generateActionItems(category: ScoreCategory): string[] {
    const items: string[] = [];

    if (category.score < 50) {
      items.push(`Prioritize ${category.name.toLowerCase()} improvements`);
      items.push(`Review best practices for ${category.name.toLowerCase()}`);
    }

    if (category.score < 70) {
      items.push(`Identify specific ${category.name.toLowerCase()} issues`);
    }

    items.push(`Set target: improve ${category.name.toLowerCase()} to ${Math.min(100, category.score + 20)}`);

    return items;
  }

  /**
   * Build a complete assessment result.
   *
   * @param score - Overall score (0-100)
   * @param breakdown - Score breakdown
   * @param recommendations - Recommendations
   * @param analysisTimeMs - Time taken for assessment
   * @param itemsAssessed - Number of items assessed
   * @returns Complete assessment result
   */
  protected buildAssessmentResult(
    score: number,
    breakdown: ScoreBreakdown,
    recommendations: Recommendation[],
    analysisTimeMs: number,
    itemsAssessed: number = 1
  ): AssessmentResult {
    const grade = this.computeGrade(score);
    const confidence = this.computeAssessmentConfidence(
      score,
      breakdown.categories.length,
      itemsAssessed
    );

    // Record prediction
    const predictionId = this.recordPrediction(
      `Assessment result: ${grade} (${score}/100) with ${recommendations.length} recommendations`,
      confidence,
      {
        score,
        grade,
        recommendationCount: recommendations.length,
        categoryCount: breakdown.categories.length,
        itemsAssessed,
      }
    );

    return {
      score,
      grade,
      breakdown,
      recommendations,
      itemsAssessed,
      confidence,
      evidenceRefs: toEvidenceIds([
        `assessment:score_${score}`,
        `grade:${grade}`,
        `categories:${breakdown.categories.length}`,
        `recommendations:${recommendations.length}`,
      ]),
      analysisTimeMs,
      predictionId,
    };
  }

  /**
   * Compute confidence for an assessment result.
   *
   * @param score - The computed score
   * @param categoryCount - Number of categories assessed
   * @param itemsAssessed - Number of items assessed
   * @returns Confidence value for the assessment
   */
  protected computeAssessmentConfidence(
    score: number,
    categoryCount: number,
    itemsAssessed: number
  ): ConfidenceValue {
    // No categories = low confidence
    if (categoryCount === 0) {
      return bounded(
        0.2,
        0.5,
        'theoretical',
        'No scoring categories were evaluated'
      );
    }

    // More categories and items = higher confidence
    const categoryBonus = Math.min(0.2, categoryCount * 0.04);
    const itemBonus = Math.min(0.15, itemsAssessed * 0.01);

    // Extreme scores (very high or very low) tend to be more reliable
    const extremityBonus = Math.abs(score - 50) / 500; // Max 0.1

    const baseConfidence = 0.55 + categoryBonus + itemBonus + extremityBonus;
    const confidenceValue = Math.min(0.92, baseConfidence);

    return {
      type: 'measured',
      value: confidenceValue,
      measurement: {
        datasetId: `${this.CONSTRUCTION_ID}_assessment`,
        sampleSize: itemsAssessed,
        accuracy: confidenceValue,
        confidenceInterval: [
          Math.max(0, confidenceValue - 0.12),
          Math.min(1, confidenceValue + 0.08),
        ],
        measuredAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Create a score category.
   *
   * Helper method for building score categories.
   *
   * @param id - Category identifier
   * @param name - Human-readable name
   * @param score - Score for this category (0-100)
   * @param weight - Weight in overall score
   * @param description - Optional description
   * @returns The score category
   */
  protected createCategory(
    id: string,
    name: string,
    score: number,
    weight: number,
    description?: string
  ): ScoreCategory {
    return {
      id,
      name,
      score: Math.max(0, Math.min(100, score)),
      weight: Math.max(0, weight),
      description,
    };
  }
}
