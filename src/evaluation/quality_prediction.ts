/**
 * @fileoverview Quality Prediction Model
 *
 * Predicts Librarian's expected accuracy for a given codebase profile.
 * Enables honest quality disclosure to users about what accuracy they can expect.
 *
 * Features:
 * - Predicts retrieval accuracy based on codebase characteristics
 * - Predicts synthesis accuracy and hallucination risk
 * - Identifies positive and negative quality factors
 * - Provides confidence intervals for predictions
 * - Supports query-type-specific predictions
 *
 * Prediction Heuristics (Based on Research):
 * - Positive: TypeScript, tests, documentation, small/medium size, CI
 * - Negative: Large codebase, complex functions, missing types, circular deps
 *
 * @packageDocumentation
 */

import type { CodebaseProfile } from './codebase_profiler.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Quality factor impact type
 */
export type FactorImpact = 'positive' | 'negative' | 'neutral';

/**
 * A factor that affects quality prediction
 */
export interface QualityFactor {
  /** Name of the factor */
  name: string;
  /** Impact on quality (positive increases accuracy, negative decreases) */
  impact: FactorImpact;
  /** Weight of this factor (0.0 - 1.0) */
  weight: number;
  /** Human-readable reason for this factor */
  reason: string;
}

/**
 * Confidence interval for a prediction
 */
export interface ConfidenceInterval {
  /** Lower bound of the interval */
  low: number;
  /** Upper bound of the interval */
  high: number;
}

/**
 * Complete quality prediction for a codebase
 */
export interface QualityPrediction {
  /** Expected retrieval accuracy (0.0 - 1.0) */
  retrievalAccuracy: number;
  /** Expected synthesis accuracy (0.0 - 1.0) */
  synthesisAccuracy: number;
  /** Expected hallucination rate (0.0 - 1.0) */
  hallucinationRisk: number;
  /** Confidence interval for the prediction */
  confidenceInterval: ConfidenceInterval;
  /** Factors that affect the prediction */
  factors: QualityFactor[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Base accuracy for predictions */
const BASE_ACCURACY = 0.7;

/** Minimum clamped accuracy */
const MIN_ACCURACY = 0.3;

/** Maximum clamped accuracy */
const MAX_ACCURACY = 0.95;

/** Adjustment per positive/negative factor */
const FACTOR_ADJUSTMENT = 0.05;

/** Default confidence interval margin */
const DEFAULT_CONFIDENCE_MARGIN = 0.1;

/** Query type modifiers */
const QUERY_TYPE_MODIFIERS: Record<string, number> = {
  structural: 0.05, // Structural queries are easier (function signatures, imports)
  behavioral: -0.02, // Behavioral queries require more reasoning
  architectural: -0.05, // Architectural queries are most complex
  unknown: 0, // Default/unknown query type
};

// ============================================================================
// QUALITY PREDICTION MODEL CLASS
// ============================================================================

/**
 * Predicts Librarian's expected accuracy for a given codebase profile
 */
export class QualityPredictionModel {
  /**
   * Predict quality for a codebase profile
   */
  predict(profile: CodebaseProfile): QualityPrediction {
    const factors = this.analyzeFactors(profile);
    const retrievalAccuracy = this.calculateAccuracy(factors);
    const synthesisAccuracy = this.calculateSynthesisAccuracy(profile, retrievalAccuracy);
    const hallucinationRisk = this.calculateHallucinationRisk(profile, retrievalAccuracy);
    const confidenceInterval = this.calculateConfidenceInterval(profile, retrievalAccuracy);

    return {
      retrievalAccuracy,
      synthesisAccuracy,
      hallucinationRisk,
      confidenceInterval,
      factors,
    };
  }

  /**
   * Analyze factors that affect quality prediction
   */
  analyzeFactors(profile: CodebaseProfile): QualityFactor[] {
    const factors: QualityFactor[] = [];

    // TypeScript factor
    if (profile.quality.hasTypeScript) {
      factors.push({
        name: 'TypeScript',
        impact: 'positive',
        weight: 0.8,
        reason: 'Type information helps understand code structure and relationships',
      });
    } else {
      factors.push({
        name: 'No TypeScript',
        impact: 'negative',
        weight: 0.6,
        reason: 'Missing type information reduces code understanding accuracy',
      });
    }

    // Tests factor
    if (profile.quality.hasTests) {
      factors.push({
        name: 'Tests Present',
        impact: 'positive',
        weight: 0.7,
        reason: 'Tests provide behavioral documentation and usage examples',
      });
    }

    // Documentation factor
    if (profile.quality.documentationScore >= 0.6) {
      factors.push({
        name: 'Good Documentation',
        impact: 'positive',
        weight: profile.quality.documentationScore,
        reason: 'Documentation improves understanding of code intent and usage',
      });
    } else if (profile.quality.documentationScore < 0.3) {
      factors.push({
        name: 'Poor Documentation',
        impact: 'negative',
        weight: 0.5,
        reason: 'Lack of documentation makes it harder to understand code purpose',
      });
    }

    // CI factor
    if (profile.quality.hasCI) {
      factors.push({
        name: 'CI Present',
        impact: 'positive',
        weight: 0.5,
        reason: 'CI indicates well-maintained code with automated quality checks',
      });
    }

    // Size factors
    if (profile.classification === 'small') {
      factors.push({
        name: 'Small Size',
        impact: 'positive',
        weight: 0.8,
        reason: 'Small codebases are easier to index and retrieve from accurately',
      });
    } else if (profile.classification === 'medium') {
      factors.push({
        name: 'Medium Size',
        impact: 'positive',
        weight: 0.4,
        reason: 'Medium codebases balance depth with manageability',
      });
    } else if (profile.classification === 'large') {
      factors.push({
        name: 'Large Size',
        impact: 'negative',
        weight: 0.7,
        reason: 'Large codebases are harder to search and retrieve relevant results from',
      });
    } else if (profile.classification === 'monorepo') {
      factors.push({
        name: 'Monorepo',
        impact: 'negative',
        weight: 0.6,
        reason: 'Monorepos have complex structure that makes retrieval more challenging',
      });
    }

    // Complex functions factor
    if (profile.risks.complexFunctions.length > 0) {
      const complexityWeight = Math.min(profile.risks.complexFunctions.length * 0.1, 0.8);
      factors.push({
        name: 'Complex Functions',
        impact: 'negative',
        weight: complexityWeight,
        reason: `${profile.risks.complexFunctions.length} complex functions make synthesis more difficult`,
      });
    }

    // Circular dependencies factor
    if (profile.risks.circularDependencies) {
      factors.push({
        name: 'Circular Dependencies',
        impact: 'negative',
        weight: 0.6,
        reason: 'Circular dependencies create confusing code structure',
      });
    }

    // Outdated dependencies factor
    if (profile.risks.outdatedDependencies) {
      factors.push({
        name: 'Outdated Dependencies',
        impact: 'negative',
        weight: 0.4,
        reason: 'Outdated dependencies may have inconsistencies with documentation',
      });
    }

    // Large files factor
    if (profile.risks.largeFiles.length > 5) {
      factors.push({
        name: 'Many Large Files',
        impact: 'negative',
        weight: 0.5,
        reason: 'Large files are harder to understand and retrieve from accurately',
      });
    }

    // Linting factor (indicates code quality)
    if (profile.quality.hasLinting) {
      factors.push({
        name: 'Linting Present',
        impact: 'positive',
        weight: 0.3,
        reason: 'Linting indicates consistent code style and fewer issues',
      });
    }

    return factors;
  }

  /**
   * Predict quality for a specific query type
   */
  predictForQueryType(profile: CodebaseProfile, queryType: string): QualityPrediction {
    const basePrediction = this.predict(profile);
    const modifier = QUERY_TYPE_MODIFIERS[queryType] ?? QUERY_TYPE_MODIFIERS['unknown'];

    // Adjust retrieval accuracy based on query type
    const adjustedRetrieval = this.clampAccuracy(basePrediction.retrievalAccuracy + modifier);

    // Adjust synthesis similarly but with smaller impact
    const adjustedSynthesis = this.clampAccuracy(basePrediction.synthesisAccuracy + modifier * 0.8);

    // Hallucination risk adjusts inversely
    const adjustedHallucination = this.clampAccuracy(basePrediction.hallucinationRisk - modifier);

    return {
      ...basePrediction,
      retrievalAccuracy: adjustedRetrieval,
      synthesisAccuracy: adjustedSynthesis,
      hallucinationRisk: adjustedHallucination,
      confidenceInterval: this.calculateConfidenceInterval(profile, adjustedRetrieval),
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Calculate accuracy based on factors
   */
  private calculateAccuracy(factors: QualityFactor[]): number {
    let accuracy = BASE_ACCURACY;

    for (const factor of factors) {
      const adjustment = factor.weight * FACTOR_ADJUSTMENT;

      if (factor.impact === 'positive') {
        accuracy += adjustment;
      } else if (factor.impact === 'negative') {
        accuracy -= adjustment;
      }
      // neutral factors don't affect accuracy
    }

    return this.clampAccuracy(accuracy);
  }

  /**
   * Calculate synthesis accuracy based on profile and retrieval accuracy
   */
  private calculateSynthesisAccuracy(profile: CodebaseProfile, retrievalAccuracy: number): number {
    // Synthesis accuracy is generally lower than retrieval and depends on:
    // 1. Base retrieval accuracy (can't synthesize well from bad retrieval)
    // 2. Code complexity (more complex = harder synthesis)
    // 3. Documentation quality (better docs = better synthesis)

    let synthAccuracy = retrievalAccuracy * 0.9; // Slightly lower than retrieval

    // Complexity penalty
    if (profile.complexity.averageFunctionsPerFile > 10) {
      synthAccuracy -= 0.05;
    }
    if (profile.complexity.deepestNesting > 8) {
      synthAccuracy -= 0.03;
    }

    // Documentation bonus
    synthAccuracy += profile.quality.documentationScore * 0.1;

    return this.clampAccuracy(synthAccuracy);
  }

  /**
   * Calculate hallucination risk based on profile and accuracy
   */
  private calculateHallucinationRisk(profile: CodebaseProfile, retrievalAccuracy: number): number {
    // Hallucination risk is inversely related to:
    // 1. Retrieval accuracy (poor retrieval = more hallucination)
    // 2. Code quality indicators
    // 3. Documentation quality

    let risk = 1 - retrievalAccuracy; // Base risk is inverse of accuracy

    // Reduce risk for high-quality indicators
    if (profile.quality.hasTests) {
      risk -= 0.05;
    }
    if (profile.quality.hasTypeScript) {
      risk -= 0.08;
    }
    if (profile.quality.documentationScore > 0.5) {
      risk -= 0.05;
    }

    // Increase risk for problematic indicators
    if (profile.risks.circularDependencies) {
      risk += 0.05;
    }
    if (profile.risks.outdatedDependencies) {
      risk += 0.03;
    }
    if (profile.classification === 'large' || profile.classification === 'monorepo') {
      risk += 0.05;
    }

    return this.clampAccuracy(risk);
  }

  /**
   * Calculate confidence interval based on profile and accuracy
   */
  private calculateConfidenceInterval(
    profile: CodebaseProfile,
    accuracy: number
  ): ConfidenceInterval {
    // Wider intervals for:
    // 1. Larger codebases (more uncertainty)
    // 2. Lower documentation (less predictable)
    // 3. Complex codebases

    let margin = DEFAULT_CONFIDENCE_MARGIN;

    // Size-based adjustment
    if (profile.classification === 'large' || profile.classification === 'monorepo') {
      margin += 0.05;
    } else if (profile.classification === 'small') {
      margin -= 0.03;
    }

    // Documentation-based adjustment
    if (profile.quality.documentationScore < 0.3) {
      margin += 0.03;
    } else if (profile.quality.documentationScore > 0.7) {
      margin -= 0.02;
    }

    // Complexity-based adjustment
    if (profile.complexity.deepestNesting > 10 || profile.risks.complexFunctions.length > 5) {
      margin += 0.03;
    }

    return {
      low: this.clampAccuracy(accuracy - margin),
      high: this.clampAccuracy(accuracy + margin),
    };
  }

  /**
   * Clamp accuracy to valid range [MIN_ACCURACY, MAX_ACCURACY]
   */
  private clampAccuracy(value: number): number {
    return Math.max(MIN_ACCURACY, Math.min(MAX_ACCURACY, value));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new QualityPredictionModel instance
 */
export function createQualityPredictionModel(): QualityPredictionModel {
  return new QualityPredictionModel();
}
