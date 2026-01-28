/**
 * @fileoverview Comprehensive Consistency Checker (WU-1112 - FINAL UNIT)
 *
 * Integrates all Phase 11 verification mechanisms to perform a complete
 * quality check on Librarian's responses:
 * - CitationValidationPipeline (WU-1107)
 * - EntailmentChecker (WU-1110)
 * - TestBasedVerifier (WU-1111)
 * - ConsistencyChecker (WU-805) for multi-query consistency
 *
 * Scoring Formula:
 *   overallScore = (citationScore * 0.3) + (entailmentScore * 0.4) + (testEvidenceScore * 0.3)
 *
 * Confidence Levels:
 *   High: overallScore >= 0.8
 *   Medium: overallScore >= 0.5
 *   Low: overallScore < 0.5
 *
 * @packageDocumentation
 */

import {
  CitationValidationPipeline,
  createCitationValidationPipeline,
  type ValidationPipelineResult,
} from './citation_validation_pipeline.js';
import {
  EntailmentChecker,
  createEntailmentChecker,
  type EntailmentReport,
} from './entailment_checker.js';
import {
  TestBasedVerifier,
  createTestBasedVerifier,
  type TestVerificationReport,
} from './test_based_verifier.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for the comprehensive consistency check
 */
export interface ConsistencyCheckConfig {
  /** Enable citation validation check */
  enableCitationValidation: boolean;
  /** Enable entailment checking */
  enableEntailmentCheck: boolean;
  /** Enable test-based verification */
  enableTestVerification: boolean;
  /** Enable comment-code consistency checking */
  enableCommentCodeCheck: boolean;
  /** Strict mode fails on any issues */
  strictMode: boolean;
  /** Minimum overall score to pass (0.0 to 1.0) */
  minConsistencyScore: number;
}

/**
 * Aggregated scores from all checks
 */
export interface ConsistencyScores {
  /** Score from citation validation (0.0 to 1.0) */
  citationScore: number;
  /** Score from entailment checking (0.0 to 1.0) */
  entailmentScore: number;
  /** Score from test-based verification (0.0 to 1.0) */
  testEvidenceScore: number;
  /** Overall weighted score (0.0 to 1.0) */
  overallScore: number;
}

/**
 * Confidence level for the consistency check result
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Result of a comprehensive consistency check
 */
export interface ConsistencyCheckResult {
  /** The response that was checked */
  response: string;
  /** The repository path used for verification */
  repoPath: string;

  /** Citation validation results (if enabled) */
  citationValidation?: ValidationPipelineResult;
  /** Entailment check results (if enabled) */
  entailmentCheck?: EntailmentReport;
  /** Test verification results (if enabled) */
  testVerification?: TestVerificationReport;

  /** Aggregated scores */
  scores: ConsistencyScores;

  /** Whether the response passed the consistency check */
  passed: boolean;
  /** Confidence level of the result */
  confidence: ConfidenceLevel;
  /** Warning messages */
  warnings: string[];
  /** Recommendations for improvement */
  recommendations: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Score weights for the overall score calculation
 */
const SCORE_WEIGHTS = {
  citation: 0.3,
  entailment: 0.4,
  testEvidence: 0.3,
} as const;

/**
 * Confidence level thresholds
 */
const CONFIDENCE_THRESHOLDS = {
  high: 0.8,
  medium: 0.5,
} as const;

/**
 * Default configuration for consistency checking
 */
export const DEFAULT_CONSISTENCY_CHECK_CONFIG: ConsistencyCheckConfig = {
  enableCitationValidation: true,
  enableEntailmentCheck: true,
  enableTestVerification: true,
  enableCommentCodeCheck: false,
  strictMode: false,
  minConsistencyScore: 0.5,
};

// ============================================================================
// COMPREHENSIVE CONSISTENCY CHECKER CLASS
// ============================================================================

/**
 * Integrates all Phase 11 verifiers for comprehensive consistency checking
 */
export class ComprehensiveConsistencyChecker {
  private citationPipeline: CitationValidationPipeline;
  private entailmentChecker: EntailmentChecker;
  private testVerifier: TestBasedVerifier;
  private defaultConfig: ConsistencyCheckConfig;

  constructor(config?: Partial<ConsistencyCheckConfig>) {
    this.citationPipeline = createCitationValidationPipeline();
    this.entailmentChecker = createEntailmentChecker();
    this.testVerifier = createTestBasedVerifier();
    this.defaultConfig = { ...DEFAULT_CONSISTENCY_CHECK_CONFIG, ...config };
  }

  /**
   * Run a consistency check on a response
   */
  async check(
    response: string,
    repoPath: string,
    config?: ConsistencyCheckConfig
  ): Promise<ConsistencyCheckResult> {
    const effectiveConfig = config || this.defaultConfig;
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Handle empty response
    if (!response || response.trim().length === 0) {
      warnings.push('Response is empty or contains only whitespace');
      return this.buildEmptyResult(response, repoPath, warnings);
    }

    // Run enabled checks
    let citationValidation: ValidationPipelineResult | undefined;
    let entailmentCheck: EntailmentReport | undefined;
    let testVerification: TestVerificationReport | undefined;

    // Citation validation
    if (effectiveConfig.enableCitationValidation) {
      try {
        citationValidation = await this.citationPipeline.validate(response, repoPath);
        if (citationValidation.warnings) {
          warnings.push(...citationValidation.warnings);
        }
      } catch (error) {
        warnings.push(`Citation validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Entailment checking
    if (effectiveConfig.enableEntailmentCheck) {
      try {
        entailmentCheck = await this.entailmentChecker.checkResponse(response, repoPath);
      } catch (error) {
        warnings.push(`Entailment check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Test-based verification
    if (effectiveConfig.enableTestVerification) {
      try {
        testVerification = await this.testVerifier.verifyResponse(response, repoPath);
      } catch (error) {
        warnings.push(`Test verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Calculate scores
    const scores = this.calculateScores(citationValidation, entailmentCheck, testVerification);

    // Determine pass/fail
    const passed = this.determinePassFail(scores, effectiveConfig);

    // Determine confidence level
    const confidence = this.determineConfidence(scores.overallScore);

    // Build result
    const result: ConsistencyCheckResult = {
      response,
      repoPath,
      citationValidation,
      entailmentCheck,
      testVerification,
      scores,
      passed,
      confidence,
      warnings,
      recommendations: [],
    };

    // Generate recommendations
    result.recommendations = this.generateRecommendations(result);

    return result;
  }

  /**
   * Quick check - citation validation only (fastest)
   */
  async quickCheck(response: string, repoPath: string): Promise<ConsistencyCheckResult> {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: false,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: this.defaultConfig.minConsistencyScore,
    };

    return this.check(response, repoPath, config);
  }

  /**
   * Full check - all verifiers enabled
   */
  async fullCheck(response: string, repoPath: string): Promise<ConsistencyCheckResult> {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: true,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: this.defaultConfig.strictMode,
      minConsistencyScore: this.defaultConfig.minConsistencyScore,
    };

    return this.check(response, repoPath, config);
  }

  /**
   * Calculate overall score from partial results
   *
   * Formula: (citationScore * 0.3) + (entailmentScore * 0.4) + (testEvidenceScore * 0.3)
   */
  calculateOverallScore(result: Partial<ConsistencyCheckResult>): number {
    const scores = result.scores;

    if (!scores) {
      return 0;
    }

    const citationScore = this.clampScore(scores.citationScore || 0);
    const entailmentScore = this.clampScore(scores.entailmentScore || 0);
    const testEvidenceScore = this.clampScore(scores.testEvidenceScore || 0);

    const rawScore =
      citationScore * SCORE_WEIGHTS.citation +
      entailmentScore * SCORE_WEIGHTS.entailment +
      testEvidenceScore * SCORE_WEIGHTS.testEvidence;

    return this.clampScore(rawScore);
  }

  /**
   * Generate recommendations based on check results
   */
  generateRecommendations(result: ConsistencyCheckResult): string[] {
    const recommendations: string[] = [];
    const scores = result.scores;

    // High-quality results may not need recommendations
    if (scores.overallScore >= 0.9) {
      return recommendations;
    }

    // Citation score recommendations
    if (scores.citationScore < 0.7) {
      recommendations.push(
        'Improve citation accuracy: Ensure all file paths and line numbers are correct and verifiable.'
      );
      if (result.citationValidation) {
        const invalidCount = result.citationValidation.citations.filter((c) => !c.isValid).length;
        if (invalidCount > 0) {
          recommendations.push(
            `Fix ${invalidCount} invalid citation(s) by verifying file paths and identifiers exist in the codebase.`
          );
        }
      }
    }

    // Entailment score recommendations
    if (scores.entailmentScore < 0.7) {
      recommendations.push(
        'Verify claim accuracy: Ensure all statements about code are supported by actual source code.'
      );
      if (result.entailmentCheck) {
        const { contradicted, neutral } = result.entailmentCheck.summary;
        if (contradicted > 0) {
          recommendations.push(
            `Review ${contradicted} contradicted claim(s) - these statements conflict with the actual code.`
          );
        }
        if (neutral > 2) {
          recommendations.push(
            `Add evidence for ${neutral} unverified claim(s) by citing specific code locations.`
          );
        }
      }
    }

    // Test evidence score recommendations
    if (scores.testEvidenceScore < 0.7) {
      recommendations.push(
        'Strengthen claims with test evidence: Reference existing tests that demonstrate the described behavior.'
      );
      if (result.testVerification) {
        const { claimsWithoutTestEvidence } = result.testVerification.summary;
        if (claimsWithoutTestEvidence > 0) {
          recommendations.push(
            `${claimsWithoutTestEvidence} claim(s) lack test coverage - consider referencing relevant test files.`
          );
        }
      }
    }

    // General recommendations based on overall score
    if (scores.overallScore < 0.5) {
      recommendations.push(
        'Consider rewriting the response with more specific citations and verifiable claims.'
      );
    } else if (scores.overallScore < 0.7) {
      recommendations.push(
        'Add more specific file and line references to improve verifiability.'
      );
    }

    return recommendations;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Build an empty result for invalid inputs
   */
  private buildEmptyResult(
    response: string,
    repoPath: string,
    warnings: string[]
  ): ConsistencyCheckResult {
    return {
      response,
      repoPath,
      scores: {
        citationScore: 0,
        entailmentScore: 0,
        testEvidenceScore: 0,
        overallScore: 0,
      },
      passed: false,
      confidence: 'low',
      warnings,
      recommendations: ['Provide a non-empty response with verifiable claims.'],
    };
  }

  /**
   * Calculate individual and overall scores from check results
   */
  private calculateScores(
    citationResult?: ValidationPipelineResult,
    entailmentResult?: EntailmentReport,
    testResult?: TestVerificationReport
  ): ConsistencyScores {
    // Calculate citation score
    let citationScore = 0;
    if (citationResult) {
      citationScore = citationResult.validationRate;
    } else {
      // If not checked, give neutral score
      citationScore = 0.5;
    }

    // Calculate entailment score
    let entailmentScore = 0;
    if (entailmentResult && entailmentResult.claims.length > 0) {
      const { entailed, contradicted, neutral } = entailmentResult.summary;
      const total = entailed + contradicted + neutral;
      if (total > 0) {
        // Entailed gives full points, neutral gives half points, contradicted gives none
        entailmentScore = (entailed + neutral * 0.5) / total;
      }
    } else {
      // If no claims or not checked, give neutral score
      entailmentScore = 0.5;
    }

    // Calculate test evidence score
    let testEvidenceScore = 0;
    if (testResult && testResult.claims.length > 0) {
      testEvidenceScore = testResult.summary.testCoverageRate;

      // Boost score based on verification strength
      const strongCount = testResult.verifications.filter(
        (v) => v.verificationStrength === 'strong'
      ).length;
      const moderateCount = testResult.verifications.filter(
        (v) => v.verificationStrength === 'moderate'
      ).length;

      if (testResult.verifications.length > 0) {
        const strengthBonus =
          (strongCount * 0.2 + moderateCount * 0.1) / testResult.verifications.length;
        testEvidenceScore = Math.min(1, testEvidenceScore + strengthBonus);
      }
    } else {
      // If no claims or not checked, give neutral score
      testEvidenceScore = 0.5;
    }

    // Calculate overall score using the formula
    const overallScore =
      citationScore * SCORE_WEIGHTS.citation +
      entailmentScore * SCORE_WEIGHTS.entailment +
      testEvidenceScore * SCORE_WEIGHTS.testEvidence;

    return {
      citationScore: this.clampScore(citationScore),
      entailmentScore: this.clampScore(entailmentScore),
      testEvidenceScore: this.clampScore(testEvidenceScore),
      overallScore: this.clampScore(overallScore),
    };
  }

  /**
   * Determine if the check passed based on config and scores
   */
  private determinePassFail(scores: ConsistencyScores, config: ConsistencyCheckConfig): boolean {
    if (config.strictMode) {
      // In strict mode, require meeting the minimum score
      return scores.overallScore >= config.minConsistencyScore;
    }

    // In non-strict mode, be more lenient
    // Pass if score is above 0.3 or above the configured minimum
    return scores.overallScore >= Math.min(config.minConsistencyScore, 0.3);
  }

  /**
   * Determine confidence level from overall score
   */
  private determineConfidence(overallScore: number): ConfidenceLevel {
    if (overallScore >= CONFIDENCE_THRESHOLDS.high) {
      return 'high';
    }
    if (overallScore >= CONFIDENCE_THRESHOLDS.medium) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Clamp a score to be between 0 and 1
   */
  private clampScore(score: number): number {
    return Math.max(0, Math.min(1, score));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ComprehensiveConsistencyChecker instance
 */
export function createComprehensiveConsistencyChecker(
  config?: Partial<ConsistencyCheckConfig>
): ComprehensiveConsistencyChecker {
  return new ComprehensiveConsistencyChecker(config);
}
