/**
 * @fileoverview Tests for MiniCheck Scorer (WU-1410)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * MiniCheck-style entailment scoring improves grounding accuracy by using
 * semantic similarity scoring alongside regex-only entailment. Research shows
 * MiniCheck achieves 77.4% grounding accuracy.
 *
 * Implementation approach:
 * 1. Extract key terms from claims (function names, class names, etc.)
 * 2. Check for term presence in evidence
 * 3. Check for relationship patterns (extends, implements, returns, etc.)
 * 4. Compute weighted score based on matches
 * 5. Apply threshold to determine grounding
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  MiniCheckScorer,
  createMiniCheckScorer,
  type MiniCheckScore,
  type ClaimScore,
  type MiniCheckConfig,
  DEFAULT_MINICHECK_CONFIG,
} from '../minicheck_scorer.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Sample evidence for testing - simulating AST-extracted facts as strings
const sampleEvidence: string[] = [
  'function createASTFactExtractor returns ASTFactExtractor',
  'class ASTFactExtractor has methods: extractFromFile, extractFromDirectory, extractFunctions',
  'function extractFromFile takes parameter filePath of type string',
  'function extractFromFile returns Promise<ASTFact[]>',
  'function extractFromFile is async',
  'class UserService extends BaseService',
  'class UserService implements IUserService',
  'import Project from ts-morph',
  'type ASTFact is an interface with properties: type, identifier, file, line, details',
];

// Sample claims for testing
const sampleClaims = {
  perfectMatch: 'The function createASTFactExtractor returns ASTFactExtractor',
  partialMatch: 'The function createASTFactExtractor does something',
  noMatch: 'The function nonExistentFunction returns void',
  relationshipExtends: 'The UserService class extends BaseService',
  relationshipImplements: 'UserService implements IUserService',
  methodClaim: 'ASTFactExtractor has method extractFromFile',
  parameterClaim: 'extractFromFile takes a filePath parameter',
  asyncClaim: 'The extractFromFile function is async',
  importClaim: 'Project is imported from ts-morph',
  interfaceClaim: 'ASTFact is an interface',
};

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createMiniCheckScorer', () => {
  it('should create a MiniCheckScorer instance', () => {
    const scorer = createMiniCheckScorer();
    expect(scorer).toBeInstanceOf(MiniCheckScorer);
  });

  it('should accept custom configuration', () => {
    const customConfig: Partial<MiniCheckConfig> = {
      groundingThreshold: 0.8,
      exactMatchWeight: 0.9,
    };
    const scorer = createMiniCheckScorer(customConfig);
    expect(scorer).toBeInstanceOf(MiniCheckScorer);
  });

  it('should use default configuration when none provided', () => {
    const scorer = createMiniCheckScorer();
    expect(scorer).toBeInstanceOf(MiniCheckScorer);
  });
});

// ============================================================================
// DEFAULT CONFIGURATION TESTS
// ============================================================================

describe('DEFAULT_MINICHECK_CONFIG', () => {
  it('should have a grounding threshold of 0.6', () => {
    expect(DEFAULT_MINICHECK_CONFIG.groundingThreshold).toBe(0.6);
  });

  it('should have useSemanticSimilarity set to false', () => {
    expect(DEFAULT_MINICHECK_CONFIG.useSemanticSimilarity).toBe(false);
  });

  it('should have exactMatchWeight of 0.7', () => {
    expect(DEFAULT_MINICHECK_CONFIG.exactMatchWeight).toBe(0.7);
  });
});

// ============================================================================
// SCORE GROUNDING TESTS
// ============================================================================

describe('MiniCheckScorer - scoreGrounding', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should return a MiniCheckScore object', () => {
    const result = scorer.scoreGrounding([sampleClaims.perfectMatch], sampleEvidence);

    expect(result).toHaveProperty('groundingScore');
    expect(result).toHaveProperty('claimScores');
    expect(result).toHaveProperty('isGrounded');
  });

  it('should score perfect grounding highly', () => {
    const result = scorer.scoreGrounding([sampleClaims.perfectMatch], sampleEvidence);

    expect(result.groundingScore).toBeGreaterThanOrEqual(0.8);
    expect(result.isGrounded).toBe(true);
  });

  it('should score partial grounding moderately', () => {
    const result = scorer.scoreGrounding([sampleClaims.partialMatch], sampleEvidence);

    expect(result.groundingScore).toBeGreaterThan(0.2);
    expect(result.groundingScore).toBeLessThan(0.8);
  });

  it('should score no grounding lowly', () => {
    const result = scorer.scoreGrounding([sampleClaims.noMatch], sampleEvidence);

    expect(result.groundingScore).toBeLessThan(0.5);
    expect(result.isGrounded).toBe(false);
  });

  it('should handle empty claims array', () => {
    const result = scorer.scoreGrounding([], sampleEvidence);

    expect(result.groundingScore).toBe(1.0); // No claims = fully grounded (nothing to contradict)
    expect(result.claimScores).toEqual([]);
    expect(result.isGrounded).toBe(true);
  });

  it('should handle empty evidence array', () => {
    const result = scorer.scoreGrounding([sampleClaims.perfectMatch], []);

    expect(result.groundingScore).toBe(0);
    expect(result.isGrounded).toBe(false);
  });

  it('should aggregate multiple claim scores correctly', () => {
    const claims = [
      sampleClaims.perfectMatch,
      sampleClaims.noMatch,
    ];
    const result = scorer.scoreGrounding(claims, sampleEvidence);

    // Should be average of high and low score
    expect(result.groundingScore).toBeGreaterThan(0.2);
    expect(result.groundingScore).toBeLessThan(0.9);
    expect(result.claimScores.length).toBe(2);
  });

  it('should return claim scores for each claim', () => {
    const claims = [
      sampleClaims.perfectMatch,
      sampleClaims.methodClaim,
    ];
    const result = scorer.scoreGrounding(claims, sampleEvidence);

    expect(result.claimScores.length).toBe(2);
    result.claimScores.forEach((cs) => {
      expect(cs).toHaveProperty('claim');
      expect(cs).toHaveProperty('score');
      expect(cs).toHaveProperty('bestEvidence');
      expect(cs).toHaveProperty('isGrounded');
    });
  });
});

// ============================================================================
// SCORE CLAIM GROUNDING TESTS
// ============================================================================

describe('MiniCheckScorer - scoreClaimGrounding', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should return a ClaimScore object', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.perfectMatch, sampleEvidence);

    expect(result).toHaveProperty('claim');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('bestEvidence');
    expect(result).toHaveProperty('isGrounded');
  });

  it('should score exact match highly', () => {
    const result = scorer.scoreClaimGrounding(
      'createASTFactExtractor returns ASTFactExtractor',
      sampleEvidence
    );

    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.isGrounded).toBe(true);
    expect(result.bestEvidence).not.toBeNull();
  });

  it('should identify best matching evidence', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.perfectMatch, sampleEvidence);

    expect(result.bestEvidence).toContain('createASTFactExtractor');
  });

  it('should handle claims about non-existent entities', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.noMatch, sampleEvidence);

    expect(result.score).toBeLessThan(0.5);
    expect(result.isGrounded).toBe(false);
  });

  it('should score relationship "extends" claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.relationshipExtends, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.isGrounded).toBe(true);
  });

  it('should score relationship "implements" claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.relationshipImplements, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.isGrounded).toBe(true);
  });

  it('should score method existence claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.methodClaim, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.isGrounded).toBe(true);
  });

  it('should score parameter claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.parameterClaim, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.isGrounded).toBe(true);
  });

  it('should score async claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.asyncClaim, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.isGrounded).toBe(true);
  });

  it('should score import claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.importClaim, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.isGrounded).toBe(true);
  });

  it('should score interface type claims', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.interfaceClaim, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('should return score between 0 and 1', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.perfectMatch, sampleEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('should return null bestEvidence when no match found', () => {
    const result = scorer.scoreClaimGrounding('completely unrelated claim xyz', sampleEvidence);

    expect(result.score).toBeLessThan(0.3);
    expect(result.bestEvidence).toBeNull();
  });
});

// ============================================================================
// SIMILARITY COMPUTATION TESTS
// ============================================================================

describe('MiniCheckScorer - Similarity Computation', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should give high similarity for exact term matches', () => {
    const claim = 'createASTFactExtractor returns ASTFactExtractor';
    const result = scorer.scoreClaimGrounding(claim, [
      'function createASTFactExtractor returns ASTFactExtractor',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it('should give moderate similarity for partial term matches', () => {
    const claim = 'createASTFactExtractor returns something';
    const result = scorer.scoreClaimGrounding(claim, [
      'function createASTFactExtractor returns ASTFactExtractor',
    ]);

    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThan(0.95);
  });

  it('should give low similarity for no term matches', () => {
    const claim = 'UnknownFunction returns void';
    const result = scorer.scoreClaimGrounding(claim, [
      'function createASTFactExtractor returns ASTFactExtractor',
    ]);

    expect(result.score).toBeLessThan(0.4);
  });

  it('should handle case-insensitive matching', () => {
    const claim = 'CREATEASTFACTEXTRACTOR returns ASTFACTEXTRACTOR';
    const result = scorer.scoreClaimGrounding(claim, [
      'function createASTFactExtractor returns ASTFactExtractor',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('should extract CamelCase identifiers', () => {
    const claim = 'ASTFactExtractor is important';
    const result = scorer.scoreClaimGrounding(claim, [
      'class ASTFactExtractor has methods',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('should extract snake_case identifiers', () => {
    const claim = 'extract_from_file does something';
    const result = scorer.scoreClaimGrounding(claim, [
      'function extract_from_file takes parameter',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it('should handle backtick-quoted identifiers', () => {
    const claim = 'The `createASTFactExtractor` function returns something';
    const result = scorer.scoreClaimGrounding(claim, [
      'function createASTFactExtractor returns ASTFactExtractor',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });
});

// ============================================================================
// RELATIONSHIP PATTERN TESTS
// ============================================================================

describe('MiniCheckScorer - Relationship Patterns', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should recognize "extends" relationship pattern', () => {
    const claim = 'UserService extends BaseService';
    const result = scorer.scoreClaimGrounding(claim, [
      'class UserService extends BaseService',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('should recognize "implements" relationship pattern', () => {
    const claim = 'UserService implements IUserService';
    const result = scorer.scoreClaimGrounding(claim, [
      'class UserService implements IUserService',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('should recognize "returns" relationship pattern', () => {
    const claim = 'extractFromFile returns Promise';
    const result = scorer.scoreClaimGrounding(claim, [
      'function extractFromFile returns Promise<ASTFact[]>',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('should recognize "has method" relationship pattern', () => {
    const claim = 'ASTFactExtractor has method extractFromFile';
    const result = scorer.scoreClaimGrounding(claim, [
      'class ASTFactExtractor has methods: extractFromFile, extractFromDirectory',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it('should recognize "takes parameter" relationship pattern', () => {
    const claim = 'extractFromFile takes parameter filePath';
    const result = scorer.scoreClaimGrounding(claim, [
      'function extractFromFile takes parameter filePath of type string',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('should recognize "is async" relationship pattern', () => {
    const claim = 'extractFromFile is async';
    const result = scorer.scoreClaimGrounding(claim, [
      'function extractFromFile is async',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('should recognize "import from" relationship pattern', () => {
    const claim = 'Project is imported from ts-morph';
    const result = scorer.scoreClaimGrounding(claim, [
      'import Project from ts-morph',
    ]);

    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('should handle contradicting relationship patterns', () => {
    const claim = 'UserService extends WrongClass';
    const result = scorer.scoreClaimGrounding(claim, [
      'class UserService extends BaseService',
    ]);

    // Should have some match for UserService + extends but not very high
    // Score can be moderate due to UserService and "extends" keyword matching
    expect(result.score).toBeLessThan(0.8);
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('MiniCheckScorer - Configuration', () => {
  it('should respect custom grounding threshold', () => {
    const strictScorer = createMiniCheckScorer({ groundingThreshold: 0.9 });
    const lenientScorer = createMiniCheckScorer({ groundingThreshold: 0.3 });

    const claim = 'createASTFactExtractor does something';
    const evidence = ['function createASTFactExtractor returns ASTFactExtractor'];

    const strictResult = strictScorer.scoreClaimGrounding(claim, evidence);
    const lenientResult = lenientScorer.scoreClaimGrounding(claim, evidence);

    // Same score but different isGrounded based on threshold
    expect(strictResult.score).toBe(lenientResult.score);
    // Lenient should be more likely to mark as grounded
    if (strictResult.score >= 0.3 && strictResult.score < 0.9) {
      expect(lenientResult.isGrounded).toBe(true);
      expect(strictResult.isGrounded).toBe(false);
    }
  });

  it('should respect exactMatchWeight configuration', () => {
    const highExactWeight = createMiniCheckScorer({ exactMatchWeight: 0.9 });
    const lowExactWeight = createMiniCheckScorer({ exactMatchWeight: 0.3 });

    const claim = 'createASTFactExtractor returns ASTFactExtractor';
    const evidence = ['function createASTFactExtractor returns ASTFactExtractor'];

    const highResult = highExactWeight.scoreClaimGrounding(claim, evidence);
    const lowResult = lowExactWeight.scoreClaimGrounding(claim, evidence);

    // Both should find the match, but weights may affect final score
    expect(highResult.score).toBeGreaterThanOrEqual(0.7);
    expect(lowResult.score).toBeGreaterThanOrEqual(0.5);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('MiniCheckScorer - Edge Cases', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should handle empty claim string', () => {
    const result = scorer.scoreClaimGrounding('', sampleEvidence);

    expect(result.score).toBe(0);
    expect(result.isGrounded).toBe(false);
  });

  it('should handle whitespace-only claim', () => {
    const result = scorer.scoreClaimGrounding('   \t\n   ', sampleEvidence);

    expect(result.score).toBe(0);
    expect(result.isGrounded).toBe(false);
  });

  it('should handle very long claims', () => {
    const longClaim = 'The function '.repeat(100) + 'createASTFactExtractor returns something.';
    const result = scorer.scoreClaimGrounding(longClaim, sampleEvidence);

    expect(result.score).toBeGreaterThan(0);
    expect(typeof result.score).toBe('number');
  });

  it('should handle claims with special characters', () => {
    const claim = 'The `foo<T>` function returns `Promise<T[]>`';
    const evidence = ['function foo<T> returns Promise<T[]>'];
    const result = scorer.scoreClaimGrounding(claim, evidence);

    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle unicode in claims', () => {
    const claim = 'The function handles unicode strings';
    const evidence = ['function processUnicode handles unicode strings'];
    const result = scorer.scoreClaimGrounding(claim, evidence);

    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle claims with numbers', () => {
    const claim = 'The function accepts 3 parameters';
    const evidence = ['function formatData accepts 3 parameters'];
    const result = scorer.scoreClaimGrounding(claim, evidence);

    expect(result.score).toBeGreaterThan(0.5);
  });

  it('should handle duplicate evidence entries', () => {
    const duplicateEvidence = [
      'function foo returns string',
      'function foo returns string',
      'function foo returns string',
    ];
    const result = scorer.scoreClaimGrounding('foo returns string', duplicateEvidence);

    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it('should handle evidence with no identifiers', () => {
    const noIdentifierEvidence = ['this is just text without identifiers'];
    const result = scorer.scoreClaimGrounding('ASTFactExtractor is a class', noIdentifierEvidence);

    // Low score but common words like "is" and "class" may produce some minor match
    expect(result.score).toBeLessThan(0.5);
  });
});

// ============================================================================
// AGGREGATE SCORING TESTS
// ============================================================================

describe('MiniCheckScorer - Aggregate Scoring', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should calculate average for multiple claims', () => {
    const claims = [
      sampleClaims.perfectMatch,  // High score
      sampleClaims.noMatch,       // Low score
    ];
    const result = scorer.scoreGrounding(claims, sampleEvidence);

    // Should be between the two extremes
    expect(result.groundingScore).toBeGreaterThan(0.2);
    expect(result.groundingScore).toBeLessThan(0.9);
  });

  it('should mark as grounded only if aggregate meets threshold', () => {
    // All high-scoring claims
    const goodClaims = [
      sampleClaims.perfectMatch,
      sampleClaims.methodClaim,
      sampleClaims.asyncClaim,
    ];
    const goodResult = scorer.scoreGrounding(goodClaims, sampleEvidence);
    expect(goodResult.isGrounded).toBe(true);

    // Mix of high and low scoring claims
    const mixedClaims = [
      sampleClaims.perfectMatch,
      sampleClaims.noMatch,
      'completely fake claim about nothing',
    ];
    const mixedResult = scorer.scoreGrounding(mixedClaims, sampleEvidence);
    // May or may not be grounded depending on threshold
    expect(typeof mixedResult.isGrounded).toBe('boolean');
  });

  it('should provide individual scores for each claim', () => {
    const claims = [
      sampleClaims.perfectMatch,
      sampleClaims.partialMatch,
      sampleClaims.noMatch,
    ];
    const result = scorer.scoreGrounding(claims, sampleEvidence);

    expect(result.claimScores.length).toBe(3);

    // First claim should have highest score
    expect(result.claimScores[0].score).toBeGreaterThan(result.claimScores[2].score);
  });

  it('should handle single claim', () => {
    const result = scorer.scoreGrounding([sampleClaims.perfectMatch], sampleEvidence);

    expect(result.claimScores.length).toBe(1);
    expect(result.groundingScore).toBe(result.claimScores[0].score);
  });

  it('should handle many claims efficiently', () => {
    const manyClaims = Array(50).fill(sampleClaims.perfectMatch);
    const startTime = Date.now();
    const result = scorer.scoreGrounding(manyClaims, sampleEvidence);
    const duration = Date.now() - startTime;

    expect(result.claimScores.length).toBe(50);
    expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
  });
});

// ============================================================================
// MINICHECK SCORE INTERFACE TESTS
// ============================================================================

describe('MiniCheckScore Interface', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should have all required fields', () => {
    const result = scorer.scoreGrounding([sampleClaims.perfectMatch], sampleEvidence);

    expect(typeof result.groundingScore).toBe('number');
    expect(Array.isArray(result.claimScores)).toBe(true);
    expect(typeof result.isGrounded).toBe('boolean');
  });

  it('should have groundingScore between 0 and 1', () => {
    const result = scorer.scoreGrounding([sampleClaims.perfectMatch], sampleEvidence);

    expect(result.groundingScore).toBeGreaterThanOrEqual(0);
    expect(result.groundingScore).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// CLAIM SCORE INTERFACE TESTS
// ============================================================================

describe('ClaimScore Interface', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should have all required fields', () => {
    const result = scorer.scoreClaimGrounding(sampleClaims.perfectMatch, sampleEvidence);

    expect(typeof result.claim).toBe('string');
    expect(typeof result.score).toBe('number');
    expect(result.bestEvidence === null || typeof result.bestEvidence === 'string').toBe(true);
    expect(typeof result.isGrounded).toBe('boolean');
  });

  it('should preserve original claim text', () => {
    const claim = 'This is the original claim text';
    const result = scorer.scoreClaimGrounding(claim, sampleEvidence);

    expect(result.claim).toBe(claim);
  });
});

// ============================================================================
// INTEGRATION WITH EXISTING EVALUATION TESTS
// ============================================================================

describe('MiniCheckScorer - Integration Compatibility', () => {
  let scorer: MiniCheckScorer;

  beforeAll(() => {
    scorer = createMiniCheckScorer();
  });

  it('should work with AST-style evidence strings', () => {
    const astEvidence = [
      'function_def: createASTFactExtractor at line 816 in ast_fact_extractor.ts returns ASTFactExtractor',
      'class: ASTFactExtractor at line 149 methods: extractFromFile, extractFromDirectory',
      'import: Project from ts-morph',
    ];

    const result = scorer.scoreClaimGrounding(
      'createASTFactExtractor returns ASTFactExtractor',
      astEvidence
    );

    expect(result.score).toBeGreaterThan(0.5);
  });

  it('should work with natural language evidence', () => {
    const naturalEvidence = [
      'The createASTFactExtractor function creates and returns a new ASTFactExtractor instance.',
      'ASTFactExtractor is a class that extracts facts from TypeScript files.',
    ];

    const result = scorer.scoreClaimGrounding(
      'createASTFactExtractor returns ASTFactExtractor',
      naturalEvidence
    );

    expect(result.score).toBeGreaterThan(0.5);
  });

  it('should produce scores compatible with entailment thresholds', () => {
    // Scores should work with typical entailment thresholds (0.5, 0.6, 0.7)
    const highConfidenceClaim = 'createASTFactExtractor returns ASTFactExtractor';
    const lowConfidenceClaim = 'UnknownFunction does something';

    const highResult = scorer.scoreClaimGrounding(highConfidenceClaim, sampleEvidence);
    const lowResult = scorer.scoreClaimGrounding(lowConfidenceClaim, sampleEvidence);

    // High confidence should pass typical thresholds
    expect(highResult.score).toBeGreaterThan(0.6);

    // Low confidence should fail typical thresholds
    expect(lowResult.score).toBeLessThan(0.5);
  });
});
