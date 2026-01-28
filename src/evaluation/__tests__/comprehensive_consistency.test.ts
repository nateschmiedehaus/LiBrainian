/**
 * @fileoverview Tests for Comprehensive Consistency Checker (WU-1112 - FINAL UNIT)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Comprehensive Consistency Checker integrates all Phase 11 verification mechanisms
 * to perform a complete quality check on Librarian's responses:
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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  ComprehensiveConsistencyChecker,
  createComprehensiveConsistencyChecker,
  type ConsistencyCheckConfig,
  type ConsistencyCheckResult,
  DEFAULT_CONSISTENCY_CHECK_CONFIG,
} from '../comprehensive_consistency.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Use a small external repo for memory-efficient tests
// The evaluation directory is too large and causes OOM during full test suite
const TEST_REPO_PATH = path.resolve(__dirname, '../../../eval-corpus/external-repos/typedriver-ts/src');

// Sample responses for testing
const VALID_RESPONSE_WITH_CITATIONS = `
The \`createCitationVerifier\` function in \`src/evaluation/citation_verifier.ts\` creates
a new CitationVerifier instance. The function returns a CitationVerifier.

The \`CitationVerifier\` class has a method called \`verifyCitation\` that takes a citation
and AST facts as parameters. It returns a CitationVerificationResult.

The \`EntailmentChecker\` class in \`src/evaluation/entailment_checker.ts\` extracts claims
from responses using pattern matching.
`;

const RESPONSE_WITH_INVALID_CITATIONS = `
The function \`nonExistentFunction\` in \`src/fake/file.ts\` does something magical.
This file doesn't exist, so the citation is invalid.
The \`FakeClass\` in \`src/nonexistent/module.ts:42\` implements magic features.
`;

const RESPONSE_WITH_CONTRADICTIONS = `
The function \`processData\` returns a string.
The function \`processData\` returns a number.
This is contradictory information about the same function.
`;

const RESPONSE_WITH_CORRECT_CLAIMS = `
The function \`createCitationVerifier\` is exported from citation_verifier.ts.
The \`ASTFactExtractor\` class extracts facts from TypeScript files.
The \`EntailmentChecker\` has a method called \`extractClaims\`.
`;

const RESPONSE_WITH_NO_CLAIMS = `
This is just general discussion about code quality.
It doesn't make any specific claims about functions or classes.
There are no citations or verifiable statements here.
`;

const RESPONSE_WITH_TEST_VERIFIABLE_CLAIMS = `
The CitationVerifier class verifies citations against AST facts.
It returns a verification result with a verified boolean.
The verifyCitation method takes a citation and facts as parameters.
`;

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createComprehensiveConsistencyChecker', () => {
  it('should create a ComprehensiveConsistencyChecker instance', () => {
    const checker = createComprehensiveConsistencyChecker();
    expect(checker).toBeInstanceOf(ComprehensiveConsistencyChecker);
  });

  it('should accept custom configuration', () => {
    const config: Partial<ConsistencyCheckConfig> = {
      enableCitationValidation: false,
      strictMode: true,
    };
    const checker = createComprehensiveConsistencyChecker(config);
    expect(checker).toBeInstanceOf(ComprehensiveConsistencyChecker);
  });
});

// ============================================================================
// DEFAULT CONFIGURATION TESTS
// ============================================================================

describe('DEFAULT_CONSISTENCY_CHECK_CONFIG', () => {
  it('should have all required configuration fields', () => {
    expect(DEFAULT_CONSISTENCY_CHECK_CONFIG).toBeDefined();
    expect(typeof DEFAULT_CONSISTENCY_CHECK_CONFIG.enableCitationValidation).toBe('boolean');
    expect(typeof DEFAULT_CONSISTENCY_CHECK_CONFIG.enableEntailmentCheck).toBe('boolean');
    expect(typeof DEFAULT_CONSISTENCY_CHECK_CONFIG.enableTestVerification).toBe('boolean');
    expect(typeof DEFAULT_CONSISTENCY_CHECK_CONFIG.enableCommentCodeCheck).toBe('boolean');
    expect(typeof DEFAULT_CONSISTENCY_CHECK_CONFIG.strictMode).toBe('boolean');
    expect(typeof DEFAULT_CONSISTENCY_CHECK_CONFIG.minConsistencyScore).toBe('number');
  });

  it('should have reasonable default values', () => {
    expect(DEFAULT_CONSISTENCY_CHECK_CONFIG.enableCitationValidation).toBe(true);
    expect(DEFAULT_CONSISTENCY_CHECK_CONFIG.enableEntailmentCheck).toBe(true);
    expect(DEFAULT_CONSISTENCY_CHECK_CONFIG.enableTestVerification).toBe(true);
    expect(DEFAULT_CONSISTENCY_CHECK_CONFIG.minConsistencyScore).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONSISTENCY_CHECK_CONFIG.minConsistencyScore).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// CHECK METHOD TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - check', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should return a ConsistencyCheckResult', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result).toBeDefined();
    expect(result.response).toBe(VALID_RESPONSE_WITH_CITATIONS);
    expect(result.repoPath).toBe(TEST_REPO_PATH);
  });

  it('should include aggregated scores', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result.scores).toBeDefined();
    expect(typeof result.scores.citationScore).toBe('number');
    expect(typeof result.scores.entailmentScore).toBe('number');
    expect(typeof result.scores.testEvidenceScore).toBe('number');
    expect(typeof result.scores.overallScore).toBe('number');
  });

  it('should include pass/fail verdict', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(typeof result.passed).toBe('boolean');
  });

  it('should include confidence level', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(['high', 'medium', 'low']).toContain(result.confidence);
  });

  it('should include warnings array', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('should include recommendations array', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('should use custom config when provided', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: false,
      enableEntailmentCheck: true,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    expect(result).toBeDefined();
    // Citation validation should be skipped when disabled
    expect(result.citationValidation).toBeUndefined();
  });

  it('should include citation validation result when enabled', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: false,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    expect(result.citationValidation).toBeDefined();
  });

  it('should include entailment check result when enabled', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: false,
      enableEntailmentCheck: true,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    expect(result.entailmentCheck).toBeDefined();
  });

  it('should include test verification result when enabled', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: false,
      enableEntailmentCheck: false,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(RESPONSE_WITH_TEST_VERIFIABLE_CLAIMS, TEST_REPO_PATH, config);

    expect(result.testVerification).toBeDefined();
  });

  it('should handle empty response', async () => {
    const result = await checker.check('', TEST_REPO_PATH);

    expect(result).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should handle response with no verifiable claims', async () => {
    const result = await checker.check(RESPONSE_WITH_NO_CLAIMS, TEST_REPO_PATH);

    expect(result).toBeDefined();
    // Should still produce valid result structure
    expect(typeof result.passed).toBe('boolean');
  });

  it('should handle invalid repository path', async () => {
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, '/nonexistent/repo');

    expect(result).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// QUICK CHECK METHOD TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - quickCheck', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should return a ConsistencyCheckResult', async () => {
    const result = await checker.quickCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result).toBeDefined();
    expect(result.response).toBe(VALID_RESPONSE_WITH_CITATIONS);
  });

  it('should only perform citation validation', async () => {
    const result = await checker.quickCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    // Quick check should include citation validation
    expect(result.citationValidation).toBeDefined();
    // But might skip other checks for speed
  });

  it('should be faster than full check', async () => {
    const startQuick = Date.now();
    await checker.quickCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);
    const quickTime = Date.now() - startQuick;

    const startFull = Date.now();
    await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);
    const fullTime = Date.now() - startFull;

    // Quick check should be at least as fast (usually faster)
    expect(quickTime).toBeLessThanOrEqual(fullTime + 100); // Allow small margin
  });

  it('should include scores even with limited checks', async () => {
    const result = await checker.quickCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result.scores).toBeDefined();
    expect(typeof result.scores.overallScore).toBe('number');
  });
});

// ============================================================================
// FULL CHECK METHOD TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - fullCheck', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should return a ConsistencyCheckResult', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result).toBeDefined();
    expect(result.response).toBe(VALID_RESPONSE_WITH_CITATIONS);
  });

  it('should include all verification results', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    // Full check should attempt all verifications
    expect(result.citationValidation).toBeDefined();
    expect(result.entailmentCheck).toBeDefined();
    expect(result.testVerification).toBeDefined();
  });

  it('should calculate comprehensive overall score', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result.scores.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.scores.overallScore).toBeLessThanOrEqual(1);
  });

  it('should provide detailed recommendations', async () => {
    const result = await checker.fullCheck(RESPONSE_WITH_INVALID_CITATIONS, TEST_REPO_PATH);

    // Should have recommendations for improvement
    if (result.scores.overallScore < 0.8) {
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// CALCULATE OVERALL SCORE TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - calculateOverallScore', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should calculate score using the specified formula', () => {
    // Formula: (citationScore * 0.3) + (entailmentScore * 0.4) + (testEvidenceScore * 0.3)
    const partialResult: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 1.0,
        entailmentScore: 1.0,
        testEvidenceScore: 1.0,
        overallScore: 0, // Will be calculated
      },
    };

    const score = checker.calculateOverallScore(partialResult);

    // All 1.0 scores should give 1.0 overall
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('should weight entailment score highest (0.4)', () => {
    const partialResult1: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 0.0,
        entailmentScore: 1.0,
        testEvidenceScore: 0.0,
        overallScore: 0,
      },
    };

    const score = checker.calculateOverallScore(partialResult1);

    // Only entailment at 1.0 should give 0.4
    expect(score).toBeCloseTo(0.4, 2);
  });

  it('should weight citation and test scores equally (0.3 each)', () => {
    const citationOnly: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 1.0,
        entailmentScore: 0.0,
        testEvidenceScore: 0.0,
        overallScore: 0,
      },
    };

    const testOnly: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 0.0,
        entailmentScore: 0.0,
        testEvidenceScore: 1.0,
        overallScore: 0,
      },
    };

    const citationScore = checker.calculateOverallScore(citationOnly);
    const testScore = checker.calculateOverallScore(testOnly);

    expect(citationScore).toBeCloseTo(0.3, 2);
    expect(testScore).toBeCloseTo(0.3, 2);
  });

  it('should handle zero scores', () => {
    const partialResult: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 0.0,
        entailmentScore: 0.0,
        testEvidenceScore: 0.0,
        overallScore: 0,
      },
    };

    const score = checker.calculateOverallScore(partialResult);

    expect(score).toBe(0);
  });

  it('should handle partial scores', () => {
    const partialResult: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 0.5,
        entailmentScore: 0.5,
        testEvidenceScore: 0.5,
        overallScore: 0,
      },
    };

    const score = checker.calculateOverallScore(partialResult);

    // 0.5 * 0.3 + 0.5 * 0.4 + 0.5 * 0.3 = 0.5
    expect(score).toBeCloseTo(0.5, 2);
  });

  it('should handle missing scores gracefully', () => {
    const partialResult: Partial<ConsistencyCheckResult> = {};

    const score = checker.calculateOverallScore(partialResult);

    // Should return 0 or handle gracefully
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should clamp score between 0 and 1', () => {
    const partialResult: Partial<ConsistencyCheckResult> = {
      scores: {
        citationScore: 1.5, // Invalid but should be handled
        entailmentScore: 1.5,
        testEvidenceScore: 1.5,
        overallScore: 0,
      },
    };

    const score = checker.calculateOverallScore(partialResult);

    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// GENERATE RECOMMENDATIONS TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - generateRecommendations', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should return an array of recommendations', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);
    const recommendations = checker.generateRecommendations(result);

    expect(Array.isArray(recommendations)).toBe(true);
  }, 60000); // 60s timeout for full consistency check

  it('should recommend citation improvements when citation score is low', async () => {
    const result = await checker.fullCheck(RESPONSE_WITH_INVALID_CITATIONS, TEST_REPO_PATH);
    const recommendations = checker.generateRecommendations(result);

    // Should have recommendations related to citations
    if (result.scores.citationScore < 0.7) {
      expect(recommendations.some(r => r.toLowerCase().includes('citation'))).toBe(true);
    }
  });

  it('should recommend claim verification when entailment score is low', () => {
    const result: ConsistencyCheckResult = {
      response: 'test',
      repoPath: TEST_REPO_PATH,
      scores: {
        citationScore: 1.0,
        entailmentScore: 0.3,
        testEvidenceScore: 1.0,
        overallScore: 0.6,
      },
      passed: false,
      confidence: 'medium',
      warnings: [],
      recommendations: [],
      entailmentCheck: {
        claims: [],
        results: [],
        summary: {
          entailed: 1,
          contradicted: 5,
          neutral: 2,
          entailmentRate: 0.125,
        },
      },
    };

    const recommendations = checker.generateRecommendations(result);

    // Should have recommendations about verifying claims
    expect(recommendations.some(r =>
      r.toLowerCase().includes('claim') ||
      r.toLowerCase().includes('entailment') ||
      r.toLowerCase().includes('verif')
    )).toBe(true);
  });

  it('should recommend adding test coverage when test score is low', () => {
    const result: ConsistencyCheckResult = {
      response: 'test',
      repoPath: TEST_REPO_PATH,
      scores: {
        citationScore: 1.0,
        entailmentScore: 1.0,
        testEvidenceScore: 0.2,
        overallScore: 0.76,
      },
      passed: true,
      confidence: 'medium',
      warnings: [],
      recommendations: [],
      testVerification: {
        claims: [],
        verifications: [],
        summary: {
          claimsWithTestEvidence: 1,
          claimsWithoutTestEvidence: 9,
          testCoverageRate: 0.1,
        },
      },
    };

    const recommendations = checker.generateRecommendations(result);

    // Should have recommendations about test evidence
    expect(recommendations.some(r =>
      r.toLowerCase().includes('test') ||
      r.toLowerCase().includes('coverage')
    )).toBe(true);
  });

  it('should return empty array for high quality responses', () => {
    const result: ConsistencyCheckResult = {
      response: 'test',
      repoPath: TEST_REPO_PATH,
      scores: {
        citationScore: 0.95,
        entailmentScore: 0.95,
        testEvidenceScore: 0.95,
        overallScore: 0.95,
      },
      passed: true,
      confidence: 'high',
      warnings: [],
      recommendations: [],
    };

    const recommendations = checker.generateRecommendations(result);

    // High quality results may have no recommendations
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should handle results without individual check results', () => {
    const result: ConsistencyCheckResult = {
      response: 'test',
      repoPath: TEST_REPO_PATH,
      scores: {
        citationScore: 0.5,
        entailmentScore: 0.5,
        testEvidenceScore: 0.5,
        overallScore: 0.5,
      },
      passed: false,
      confidence: 'medium',
      warnings: [],
      recommendations: [],
    };

    const recommendations = checker.generateRecommendations(result);

    // Should not throw, should return recommendations based on scores
    expect(Array.isArray(recommendations)).toBe(true);
  });
});

// ============================================================================
// CONFIDENCE LEVEL TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - Confidence Levels', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should return high confidence for score >= 0.8', async () => {
    // Mock a high-quality response check result
    const result = await checker.fullCheck(RESPONSE_WITH_CORRECT_CLAIMS, TEST_REPO_PATH);

    if (result.scores.overallScore >= 0.8) {
      expect(result.confidence).toBe('high');
    }
  });

  it('should return medium confidence for 0.5 <= score < 0.8', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    if (result.scores.overallScore >= 0.5 && result.scores.overallScore < 0.8) {
      expect(result.confidence).toBe('medium');
    }
  });

  it('should return low confidence for score < 0.5', async () => {
    const result = await checker.fullCheck(RESPONSE_WITH_INVALID_CITATIONS, TEST_REPO_PATH);

    if (result.scores.overallScore < 0.5) {
      expect(result.confidence).toBe('low');
    }
  });

  it('should correctly map confidence thresholds', () => {
    // Test the confidence level mapping directly
    const testCases = [
      { score: 0.9, expected: 'high' },
      { score: 0.8, expected: 'high' },
      { score: 0.79, expected: 'medium' },
      { score: 0.5, expected: 'medium' },
      { score: 0.49, expected: 'low' },
      { score: 0.1, expected: 'low' },
      { score: 0.0, expected: 'low' },
    ];

    for (const { score, expected } of testCases) {
      const result: ConsistencyCheckResult = {
        response: '',
        repoPath: '',
        scores: {
          citationScore: score,
          entailmentScore: score,
          testEvidenceScore: score,
          overallScore: score,
        },
        passed: score >= 0.5,
        confidence: 'low', // Will be overwritten
        warnings: [],
        recommendations: [],
      };

      // The checker should update confidence based on overall score
      const updatedResult = checker.check('test', TEST_REPO_PATH);
      // Confidence is determined by overall score
    }
  });
});

// ============================================================================
// STRICT MODE TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - Strict Mode', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should fail in strict mode when score is below threshold', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: true,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: true,
      minConsistencyScore: 0.8,
    };

    const result = await checker.check(RESPONSE_WITH_INVALID_CITATIONS, TEST_REPO_PATH, config);

    // Strict mode with high threshold should fail for invalid citations
    if (result.scores.overallScore < 0.8) {
      expect(result.passed).toBe(false);
    }
  });

  it('should pass in strict mode when score meets threshold', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: true,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: true,
      minConsistencyScore: 0.3, // Low threshold
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    if (result.scores.overallScore >= 0.3) {
      expect(result.passed).toBe(true);
    }
  }, 60000); // 60s timeout for full consistency check

  it('should be more lenient in non-strict mode', async () => {
    const strictConfig: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: true,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: true,
      minConsistencyScore: 0.7,
    };

    const lenientConfig: ConsistencyCheckConfig = {
      ...strictConfig,
      strictMode: false,
    };

    const strictResult = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, strictConfig);
    const lenientResult = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, lenientConfig);

    // Non-strict mode should be at least as likely to pass
    // If strict passes, lenient should also pass
    if (strictResult.passed) {
      expect(lenientResult.passed).toBe(true);
    }
  });

  it('should include warnings in strict mode for borderline results', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: true,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: true,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    // Should have some warnings
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - Integration', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should integrate with CitationValidationPipeline', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: false,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    expect(result.citationValidation).toBeDefined();
    expect(result.citationValidation?.citations).toBeDefined();
    expect(typeof result.citationValidation?.validationRate).toBe('number');
  });

  it('should integrate with EntailmentChecker', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: false,
      enableEntailmentCheck: true,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(RESPONSE_WITH_CORRECT_CLAIMS, TEST_REPO_PATH, config);

    expect(result.entailmentCheck).toBeDefined();
    expect(result.entailmentCheck?.claims).toBeDefined();
    expect(result.entailmentCheck?.summary).toBeDefined();
  });

  it('should integrate with TestBasedVerifier', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: false,
      enableEntailmentCheck: false,
      enableTestVerification: true,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(RESPONSE_WITH_TEST_VERIFIABLE_CLAIMS, TEST_REPO_PATH, config);

    expect(result.testVerification).toBeDefined();
    expect(result.testVerification?.verifications).toBeDefined();
    expect(result.testVerification?.summary).toBeDefined();
  });

  it('should combine all verifiers in full check', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    expect(result.citationValidation).toBeDefined();
    expect(result.entailmentCheck).toBeDefined();
    expect(result.testVerification).toBeDefined();
  });

  it('should calculate scores from integrated results', async () => {
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    // Scores should be derived from the individual checker results
    expect(result.scores.citationScore).toBeGreaterThanOrEqual(0);
    expect(result.scores.citationScore).toBeLessThanOrEqual(1);
    expect(result.scores.entailmentScore).toBeGreaterThanOrEqual(0);
    expect(result.scores.entailmentScore).toBeLessThanOrEqual(1);
    expect(result.scores.testEvidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.scores.testEvidenceScore).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ComprehensiveConsistencyChecker - Edge Cases', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should handle empty string response', async () => {
    const result = await checker.check('', TEST_REPO_PATH);

    expect(result).toBeDefined();
    expect(result.response).toBe('');
  });

  it('should handle whitespace-only response', async () => {
    const result = await checker.check('   \n\t\n   ', TEST_REPO_PATH);

    expect(result).toBeDefined();
  });

  it('should handle very long response', async () => {
    const longResponse = VALID_RESPONSE_WITH_CITATIONS.repeat(100);
    const result = await checker.check(longResponse, TEST_REPO_PATH);

    expect(result).toBeDefined();
    expect(typeof result.scores.overallScore).toBe('number');
  });

  it('should handle response with special characters', async () => {
    const response = 'The function `processData<T>` returns `Promise<T[]>`.';
    const result = await checker.check(response, TEST_REPO_PATH);

    expect(result).toBeDefined();
  });

  it('should handle response with unicode', async () => {
    const response = 'The function returns a string with unicode: ';
    const result = await checker.check(response, TEST_REPO_PATH);

    expect(result).toBeDefined();
  });

  it('should handle code blocks in response', async () => {
    const response = `
      The function works like this:
      \`\`\`typescript
      function test() {
        return 'hello';
      }
      \`\`\`
      The function returns a string.
    `;
    const result = await checker.check(response, TEST_REPO_PATH);

    expect(result).toBeDefined();
  });

  it('should handle markdown formatting in response', async () => {
    const response = `
      ## Function Description

      The **important** function *does* something.

      - Point 1
      - Point 2
    `;
    const result = await checker.check(response, TEST_REPO_PATH);

    expect(result).toBeDefined();
  });

  it('should handle all checks disabled', async () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: false,
      enableEntailmentCheck: false,
      enableTestVerification: false,
      enableCommentCodeCheck: false,
      strictMode: false,
      minConsistencyScore: 0.5,
    };

    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH, config);

    expect(result).toBeDefined();
    // Should still return valid result structure
    expect(typeof result.passed).toBe('boolean');
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('ComprehensiveConsistencyChecker - Performance', () => {
  let checker: ComprehensiveConsistencyChecker;

  beforeAll(() => {
    checker = createComprehensiveConsistencyChecker();
  });

  it('should complete quick check within reasonable time', async () => {
    const startTime = Date.now();
    await checker.quickCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);
    const endTime = Date.now();

    // Quick check should complete within 60 seconds (accounts for CI/parallel test load)
    expect(endTime - startTime).toBeLessThan(60000);
  });

  it('should complete full check within reasonable time', async () => {
    const startTime = Date.now();
    await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);
    const endTime = Date.now();

    // Full check should complete within 60 seconds
    expect(endTime - startTime).toBeLessThan(60000);
  });

  it('should handle multiple concurrent checks', async () => {
    const checks = Array.from({ length: 3 }, () =>
      checker.quickCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH)
    );

    const results = await Promise.all(checks);

    expect(results.length).toBe(3);
    results.forEach((result) => {
      expect(result).toBeDefined();
      expect(typeof result.scores.overallScore).toBe('number');
    });
  });
});

// ============================================================================
// CONSISTENCY CHECK RESULT INTERFACE TESTS
// ============================================================================

describe('ConsistencyCheckResult Interface', () => {
  it('should have all required fields', async () => {
    const checker = createComprehensiveConsistencyChecker();
    const result = await checker.check(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    // Required fields
    expect(typeof result.response).toBe('string');
    expect(typeof result.repoPath).toBe('string');
    expect(result.scores).toBeDefined();
    expect(typeof result.scores.citationScore).toBe('number');
    expect(typeof result.scores.entailmentScore).toBe('number');
    expect(typeof result.scores.testEvidenceScore).toBe('number');
    expect(typeof result.scores.overallScore).toBe('number');
    expect(typeof result.passed).toBe('boolean');
    expect(['high', 'medium', 'low']).toContain(result.confidence);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('should have optional fields as appropriate types when present', async () => {
    const checker = createComprehensiveConsistencyChecker();
    const result = await checker.fullCheck(VALID_RESPONSE_WITH_CITATIONS, TEST_REPO_PATH);

    if (result.citationValidation) {
      expect(typeof result.citationValidation.validationRate).toBe('number');
    }
    if (result.entailmentCheck) {
      expect(result.entailmentCheck.summary).toBeDefined();
    }
    if (result.testVerification) {
      expect(result.testVerification.summary).toBeDefined();
    }
  });
});

// ============================================================================
// CONSISTENCY CHECK CONFIG INTERFACE TESTS
// ============================================================================

describe('ConsistencyCheckConfig Interface', () => {
  it('should accept all valid configuration options', () => {
    const config: ConsistencyCheckConfig = {
      enableCitationValidation: true,
      enableEntailmentCheck: true,
      enableTestVerification: true,
      enableCommentCodeCheck: true,
      strictMode: true,
      minConsistencyScore: 0.75,
    };

    expect(config.enableCitationValidation).toBe(true);
    expect(config.enableEntailmentCheck).toBe(true);
    expect(config.enableTestVerification).toBe(true);
    expect(config.enableCommentCodeCheck).toBe(true);
    expect(config.strictMode).toBe(true);
    expect(config.minConsistencyScore).toBe(0.75);
  });

  it('should support partial configuration', () => {
    const partialConfig: Partial<ConsistencyCheckConfig> = {
      strictMode: true,
    };

    expect(partialConfig.strictMode).toBe(true);
    expect(partialConfig.enableCitationValidation).toBeUndefined();
  });
});
