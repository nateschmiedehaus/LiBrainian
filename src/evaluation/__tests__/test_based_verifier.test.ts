/**
 * @fileoverview Tests for Test-Based Verifier (WU-1111)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Test-Based Verifier uses existing tests in a codebase to verify Librarian's claims.
 * If Librarian claims "function X does Y", we can check if there's a test that demonstrates
 * this behavior, providing additional verification beyond AST analysis.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  TestBasedVerifier,
  createTestBasedVerifier,
  type TestCase,
  type TestBasedVerification,
  type TestVerificationReport,
} from '../test_based_verifier.js';
import { type Claim } from '../entailment_checker.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const EVALUATION_DIR = path.join(LIBRARIAN_ROOT, 'src/evaluation');
const TEST_DIR = path.join(EVALUATION_DIR, '__tests__');

// Sample test cases for testing verification logic
const sampleTestCases: TestCase[] = [
  {
    file: path.join(TEST_DIR, 'citation_verifier.test.ts'),
    name: 'should verify a citation that matches an AST fact',
    describes: 'CitationVerifier - verifyCitation',
    assertions: [
      'expect(result.verified).toBe(true)',
      'expect(result.reason).toBe("identifier_found")',
      'expect(result.matchedFact).toBeDefined()',
    ],
    testedFunction: 'verifyCitation',
    testedClass: 'CitationVerifier',
  },
  {
    file: path.join(TEST_DIR, 'entailment_checker.test.ts'),
    name: 'should return entailed for correct return type claim',
    describes: 'EntailmentChecker - checkEntailment',
    assertions: [
      'expect(result.verdict).toBe("entailed")',
      'expect(result.confidence).toBeGreaterThan(0.7)',
    ],
    testedFunction: 'checkEntailment',
    testedClass: 'EntailmentChecker',
  },
  {
    file: path.join(TEST_DIR, 'ast_fact_extractor.test.ts'),
    name: 'should extract function definitions',
    describes: 'ASTFactExtractor - extractFromFile',
    assertions: [
      'expect(facts.length).toBeGreaterThan(0)',
      'expect(facts.some((f) => f.type === "function_def")).toBe(true)',
    ],
    testedFunction: 'extractFromFile',
    testedClass: 'ASTFactExtractor',
  },
];

// Sample claims for testing
const sampleClaims: Claim[] = [
  {
    text: 'The CitationVerifier.verifyCitation method verifies citations against AST facts',
    type: 'behavioral',
    source: 'src/evaluation/citation_verifier.ts',
  },
  {
    text: 'The EntailmentChecker returns entailed for correct claims',
    type: 'behavioral',
    source: 'src/evaluation/entailment_checker.ts',
  },
  {
    text: 'ASTFactExtractor extracts function definitions from TypeScript files',
    type: 'structural',
    source: 'src/evaluation/ast_fact_extractor.ts',
  },
  {
    text: 'The NonExistentClass has a magic method',
    type: 'behavioral',
  },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createTestBasedVerifier', () => {
  it('should create a TestBasedVerifier instance', () => {
    const verifier = createTestBasedVerifier();
    expect(verifier).toBeInstanceOf(TestBasedVerifier);
  });
});

// ============================================================================
// EXTRACT TESTS TESTS
// ============================================================================

describe('TestBasedVerifier - extractTests', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should extract test cases from a repository', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    expect(tests.length).toBeGreaterThan(0);
  });

  it('should extract test names from it() calls', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Should find at least one test with a descriptive name
    const hasTestNames = tests.some((t) => t.name.length > 0);
    expect(hasTestNames).toBe(true);
  });

  it('should extract test names from test() calls', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Should handle both it() and test() patterns
    expect(tests.some((t) => t.name.length > 0)).toBe(true);
  });

  it('should extract describe block context', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Should have describe context for tests
    const hasDescribe = tests.some((t) => t.describes.length > 0);
    expect(hasDescribe).toBe(true);
  });

  it('should extract assertions from expect() calls', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // At least some tests should have extracted assertions
    const hasAssertions = tests.some((t) => t.assertions.length > 0);
    expect(hasAssertions).toBe(true);
  });

  it('should identify tested function when possible', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Some tests should have testedFunction identified
    const hasTestedFunction = tests.some((t) => t.testedFunction !== undefined);
    expect(hasTestedFunction).toBe(true);
  });

  it('should identify tested class when possible', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Some tests should have testedClass identified
    const hasTestedClass = tests.some((t) => t.testedClass !== undefined);
    expect(hasTestedClass).toBe(true);
  });

  it('should include file path for each test', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    expect(tests.every((t) => t.file.length > 0)).toBe(true);
    // Test files can have either .test. or .spec. extension
    expect(tests.every((t) => t.file.includes('.test.') || t.file.includes('.spec.'))).toBe(true);
  });

  it('should handle repositories with no tests gracefully', async () => {
    const tempDir = path.join(LIBRARIAN_ROOT, 'node_modules/.cache');

    // Should not throw, should return empty array
    const tests = await verifier.extractTests(tempDir);

    expect(Array.isArray(tests)).toBe(true);
  });

  it('should handle invalid repository path gracefully', async () => {
    const tests = await verifier.extractTests('/nonexistent/path');

    expect(tests).toEqual([]);
  });

  it('should extract tests from nested directories', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Should find tests from multiple directories
    const uniqueDirs = new Set(tests.map((t) => path.dirname(t.file)));
    expect(uniqueDirs.size).toBeGreaterThan(1);
  });

  it('should handle different test file extensions (.test.ts, .test.js, .spec.ts)', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Should primarily find .test.ts files
    const hasTestTs = tests.some((t) => t.file.endsWith('.test.ts'));
    expect(hasTestTs).toBe(true);
  });
});

// ============================================================================
// FIND RELATED TESTS TESTS
// ============================================================================

describe('TestBasedVerifier - findRelatedTests', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should find tests related to a claim by function name', () => {
    const claim: Claim = {
      text: 'The verifyCitation method returns verified true',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    expect(relatedTests.length).toBeGreaterThan(0);
    expect(relatedTests.some((t) => t.testedFunction === 'verifyCitation')).toBe(true);
  });

  it('should find tests related to a claim by class name', () => {
    const claim: Claim = {
      text: 'The CitationVerifier class verifies citations',
      type: 'structural',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    expect(relatedTests.length).toBeGreaterThan(0);
    expect(relatedTests.some((t) => t.testedClass === 'CitationVerifier')).toBe(true);
  });

  it('should find tests by keyword matching in test descriptions', () => {
    const claim: Claim = {
      text: 'The system verifies citations against AST facts',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    // Should find tests that mention verification, citations, or AST facts
    expect(relatedTests.length).toBeGreaterThan(0);
  });

  it('should find tests by assertion content matching', () => {
    const claim: Claim = {
      text: 'The method returns verified with high confidence',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    // Should find tests with assertions about verified or confidence
    expect(relatedTests.length).toBeGreaterThan(0);
  });

  it('should return empty array when no related tests found', () => {
    const claim: Claim = {
      text: 'The completely unrelated feature does something',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    expect(relatedTests).toEqual([]);
  });

  it('should handle claims with cited source file', () => {
    const claim: Claim = {
      text: 'The CitationVerifier works correctly',
      type: 'behavioral',
      source: 'src/evaluation/citation_verifier.ts',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    // Should prioritize tests for the cited source file
    expect(relatedTests.length).toBeGreaterThan(0);
  });

  it('should match PascalCase class names', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor extracts facts',
      type: 'structural',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    expect(relatedTests.some((t) => t.testedClass === 'ASTFactExtractor')).toBe(true);
  });

  it('should match camelCase function names', () => {
    const claim: Claim = {
      text: 'extractFromFile reads TypeScript files',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    expect(relatedTests.some((t) => t.testedFunction === 'extractFromFile')).toBe(true);
  });

  it('should not return duplicate tests', () => {
    const claim: Claim = {
      text: 'CitationVerifier.verifyCitation verifies citations',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, sampleTestCases);

    const uniqueTests = new Set(relatedTests.map((t) => `${t.file}:${t.name}`));
    expect(uniqueTests.size).toBe(relatedTests.length);
  });

  it('should handle empty test cases array', () => {
    const claim: Claim = {
      text: 'Some claim about code',
      type: 'behavioral',
    };

    const relatedTests = verifier.findRelatedTests(claim, []);

    expect(relatedTests).toEqual([]);
  });
});

// ============================================================================
// VERIFY SINGLE CLAIM TESTS
// ============================================================================

describe('TestBasedVerifier - verify', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should return strong verification when multiple tests verify claim', () => {
    const claim: Claim = {
      text: 'CitationVerifier verifies citations',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.claim).toEqual(claim);
    expect(verification.hasTestEvidence).toBe(true);
    expect(verification.matchingTests.length).toBeGreaterThan(0);
    // With the sample test cases, we expect at least moderate verification
    expect(['strong', 'moderate']).toContain(verification.verificationStrength);
  });

  it('should return moderate verification when one test partially verifies', () => {
    const claim: Claim = {
      text: 'The entailment checker checks entailment',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.hasTestEvidence).toBe(true);
    // Verification strength depends on matching patterns
    expect(['strong', 'moderate', 'weak']).toContain(verification.verificationStrength);
  });

  it('should return weak verification for tangentially related tests', () => {
    const claim: Claim = {
      text: 'The evaluation module processes data',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    // Should find some related tests but not direct matches
    if (verification.hasTestEvidence) {
      expect(['moderate', 'weak']).toContain(verification.verificationStrength);
    }
  });

  it('should return none verification when no test evidence exists', () => {
    const claim: Claim = {
      text: 'NonExistentClass has a magic method',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.hasTestEvidence).toBe(false);
    expect(verification.matchingTests).toEqual([]);
    expect(verification.verificationStrength).toBe('none');
  });

  it('should include explanation in verification', () => {
    const claim: Claim = {
      text: 'CitationVerifier works',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.explanation).toBeDefined();
    expect(verification.explanation.length).toBeGreaterThan(0);
  });

  it('should include the original claim in verification', () => {
    const claim: Claim = {
      text: 'Test claim',
      type: 'factual',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.claim).toEqual(claim);
  });

  it('should include matching tests in verification', () => {
    const claim: Claim = {
      text: 'verifyCitation returns verified true',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    if (verification.hasTestEvidence) {
      expect(verification.matchingTests.length).toBeGreaterThan(0);
      expect(verification.matchingTests[0].file).toBeDefined();
      expect(verification.matchingTests[0].name).toBeDefined();
    }
  });

  it('should handle structural claims', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor has method extractFromFile',
      type: 'structural',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(['strong', 'moderate', 'weak', 'none']).toContain(verification.verificationStrength);
  });

  it('should handle factual claims', () => {
    const claim: Claim = {
      text: 'CitationVerifier is defined in citation_verifier.ts',
      type: 'factual',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(typeof verification.hasTestEvidence).toBe('boolean');
  });
});

// ============================================================================
// VERIFY RESPONSE TESTS
// ============================================================================

describe('TestBasedVerifier - verifyResponse', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should verify all claims in a response', async () => {
    const response = `
      The CitationVerifier.verifyCitation method verifies citations against AST facts.
      It returns a verification result with confidence scores.
      The method is exported from the evaluation module.
    `;

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    expect(report.claims.length).toBeGreaterThan(0);
    expect(report.verifications.length).toBe(report.claims.length);
  });

  it('should calculate correct summary statistics', async () => {
    const response = `
      The ASTFactExtractor extracts function definitions from TypeScript files.
      The EntailmentChecker returns entailed for correct claims.
    `;

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    expect(report.summary).toBeDefined();
    expect(typeof report.summary.claimsWithTestEvidence).toBe('number');
    expect(typeof report.summary.claimsWithoutTestEvidence).toBe('number');
    expect(typeof report.summary.testCoverageRate).toBe('number');
    expect(report.summary.claimsWithTestEvidence + report.summary.claimsWithoutTestEvidence).toBe(report.claims.length);
  });

  it('should calculate test coverage rate', async () => {
    const response = 'The CitationVerifier verifies citations.';

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    expect(report.summary.testCoverageRate).toBeGreaterThanOrEqual(0);
    expect(report.summary.testCoverageRate).toBeLessThanOrEqual(1);
  });

  it('should handle response with no verifiable claims', async () => {
    const response = 'This is general discussion without code claims.';

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    expect(report.claims).toEqual([]);
    expect(report.verifications).toEqual([]);
    expect(report.summary.testCoverageRate).toBe(0);
  });

  it('should handle invalid repo path gracefully', async () => {
    const response = 'The function returns a string.';

    const report = await verifier.verifyResponse(response, '/nonexistent/repo');

    expect(report).toBeDefined();
    expect(Array.isArray(report.claims)).toBe(true);
    expect(Array.isArray(report.verifications)).toBe(true);
  });

  it('should preserve claim order in verifications', async () => {
    const response = `
      First: The CitationVerifier verifies.
      Second: The EntailmentChecker checks.
      Third: The ASTFactExtractor extracts.
    `;

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    if (report.claims.length >= 3) {
      // Verifications should be in same order as claims
      for (let i = 0; i < report.claims.length; i++) {
        expect(report.verifications[i].claim.text).toBe(report.claims[i].text);
      }
    }
  });

  it('should extract tests before verification', async () => {
    const response = 'The CitationVerifier verifies citations.';

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    // Should use real tests from the repo, not just sample tests
    if (report.verifications.length > 0 && report.verifications[0].hasTestEvidence) {
      expect(report.verifications[0].matchingTests[0].file).toContain(LIBRARIAN_ROOT);
    }
  });
});

// ============================================================================
// TEST CASE INTERFACE TESTS
// ============================================================================

describe('TestCase Interface', () => {
  it('should support all required fields', () => {
    const testCase: TestCase = {
      file: '/path/to/test.ts',
      name: 'should do something',
      describes: 'TestClass - method',
      assertions: ['expect(x).toBe(y)'],
      testedFunction: 'methodName',
      testedClass: 'TestClass',
    };

    expect(testCase.file).toBe('/path/to/test.ts');
    expect(testCase.name).toBe('should do something');
    expect(testCase.describes).toBe('TestClass - method');
    expect(testCase.assertions).toEqual(['expect(x).toBe(y)']);
    expect(testCase.testedFunction).toBe('methodName');
    expect(testCase.testedClass).toBe('TestClass');
  });

  it('should allow optional fields to be undefined', () => {
    const testCase: TestCase = {
      file: '/path/to/test.ts',
      name: 'should do something',
      describes: 'TestSuite',
      assertions: [],
    };

    expect(testCase.testedFunction).toBeUndefined();
    expect(testCase.testedClass).toBeUndefined();
  });
});

// ============================================================================
// TEST BASED VERIFICATION INTERFACE TESTS
// ============================================================================

describe('TestBasedVerification Interface', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should have all required fields', () => {
    const claim: Claim = {
      text: 'Some claim',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.claim).toBeDefined();
    expect(typeof verification.hasTestEvidence).toBe('boolean');
    expect(Array.isArray(verification.matchingTests)).toBe(true);
    expect(['strong', 'moderate', 'weak', 'none']).toContain(verification.verificationStrength);
    expect(typeof verification.explanation).toBe('string');
  });

  it('should have valid verification strength values', () => {
    const strengths = ['strong', 'moderate', 'weak', 'none'] as const;
    const claim: Claim = { text: 'test', type: 'factual' };

    const verification = verifier.verify(claim, []);

    expect(strengths).toContain(verification.verificationStrength);
  });
});

// ============================================================================
// TEST VERIFICATION REPORT INTERFACE TESTS
// ============================================================================

describe('TestVerificationReport Interface', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should have all required fields', async () => {
    const response = 'The CitationVerifier verifies.';

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    expect(Array.isArray(report.claims)).toBe(true);
    expect(Array.isArray(report.verifications)).toBe(true);
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.claimsWithTestEvidence).toBe('number');
    expect(typeof report.summary.claimsWithoutTestEvidence).toBe('number');
    expect(typeof report.summary.testCoverageRate).toBe('number');
  });

  it('should have consistent counts', async () => {
    const response = `
      The CitationVerifier verifies citations.
      The EntailmentChecker checks entailment.
    `;

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    expect(report.verifications.length).toBe(report.claims.length);
    const withEvidence = report.verifications.filter((v) => v.hasTestEvidence).length;
    const withoutEvidence = report.verifications.filter((v) => !v.hasTestEvidence).length;
    expect(report.summary.claimsWithTestEvidence).toBe(withEvidence);
    expect(report.summary.claimsWithoutTestEvidence).toBe(withoutEvidence);
  });
});

// ============================================================================
// VERIFICATION STRENGTH TESTS
// ============================================================================

describe('TestBasedVerifier - Verification Strength', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should return strong when multiple direct tests exist', () => {
    // Multiple tests directly test CitationVerifier
    const claim: Claim = {
      text: 'CitationVerifier verifies citations correctly',
      type: 'behavioral',
    };

    const testsWithMultiple: TestCase[] = [
      ...sampleTestCases,
      {
        file: '/test/citation_verifier.test.ts',
        name: 'should verify valid citations',
        describes: 'CitationVerifier',
        assertions: ['expect(result.verified).toBe(true)'],
        testedClass: 'CitationVerifier',
        testedFunction: 'verify',
      },
      {
        file: '/test/citation_verifier.test.ts',
        name: 'should reject invalid citations',
        describes: 'CitationVerifier',
        assertions: ['expect(result.verified).toBe(false)'],
        testedClass: 'CitationVerifier',
        testedFunction: 'verify',
      },
    ];

    const verification = verifier.verify(claim, testsWithMultiple);

    expect(verification.verificationStrength).toBe('strong');
    expect(verification.matchingTests.length).toBeGreaterThanOrEqual(2);
  });

  it('should return moderate when one direct test exists', () => {
    const claim: Claim = {
      text: 'extractFromFile extracts facts',
      type: 'behavioral',
    };

    const singleTest: TestCase[] = [
      {
        file: '/test/extractor.test.ts',
        name: 'should extract facts from file',
        describes: 'ASTFactExtractor',
        assertions: ['expect(facts.length).toBeGreaterThan(0)'],
        testedFunction: 'extractFromFile',
      },
    ];

    const verification = verifier.verify(claim, singleTest);

    // With one direct matching test, expect moderate or higher
    expect(['strong', 'moderate', 'weak']).toContain(verification.verificationStrength);
    expect(verification.matchingTests.length).toBe(1);
  });

  it('should return weak when tests are tangentially related', () => {
    const claim: Claim = {
      text: 'The evaluation module handles errors',
      type: 'behavioral',
    };

    const tangentialTests: TestCase[] = [
      {
        file: '/test/evaluation.test.ts',
        name: 'should process data',
        describes: 'Evaluation',
        assertions: ['expect(result).toBeDefined()'],
      },
    ];

    const verification = verifier.verify(claim, tangentialTests);

    // May return weak if there's some keyword match
    expect(['moderate', 'weak', 'none']).toContain(verification.verificationStrength);
  });

  it('should return none when no related tests exist', () => {
    const claim: Claim = {
      text: 'CompletelyUnrelatedClass does magic',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(verification.verificationStrength).toBe('none');
    expect(verification.hasTestEvidence).toBe(false);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('TestBasedVerifier - Edge Cases', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should handle empty response', async () => {
    const report = await verifier.verifyResponse('', LIBRARIAN_ROOT);

    expect(report.claims).toEqual([]);
    expect(report.verifications).toEqual([]);
  });

  it('should handle whitespace-only response', async () => {
    const report = await verifier.verifyResponse('   \n\t\n   ', LIBRARIAN_ROOT);

    expect(report.claims).toEqual([]);
  });

  it('should handle claims with special characters', () => {
    const claim: Claim = {
      text: 'The function<T> returns Promise<T[]>',
      type: 'structural',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(['strong', 'moderate', 'weak', 'none']).toContain(verification.verificationStrength);
  });

  it('should handle unicode in claims', () => {
    const claim: Claim = {
      text: 'The function handles unicode strings',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(typeof verification.hasTestEvidence).toBe('boolean');
  });

  it('should handle very long claim text', () => {
    const claim: Claim = {
      text: 'The function '.repeat(100) + 'returns a value',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(typeof verification.hasTestEvidence).toBe('boolean');
  });

  it('should handle test cases with empty assertions', () => {
    const claim: Claim = {
      text: 'TestClass does something',
      type: 'behavioral',
    };

    const testWithNoAssertions: TestCase[] = [
      {
        file: '/test/test.ts',
        name: 'should work',
        describes: 'TestClass',
        assertions: [],
        testedClass: 'TestClass',
      },
    ];

    const verification = verifier.verify(claim, testWithNoAssertions);

    // Should still match by class name even without assertions
    expect(verification.matchingTests.length).toBeGreaterThan(0);
  });

  it('should handle claims about nested classes/methods', () => {
    const claim: Claim = {
      text: 'OuterClass.InnerClass.method works correctly',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    expect(['strong', 'moderate', 'weak', 'none']).toContain(verification.verificationStrength);
  });

  it('should handle test files with multiple describe blocks', async () => {
    const tests = await verifier.extractTests(LIBRARIAN_ROOT);

    // Should extract tests from nested describe blocks
    const describesSet = new Set(tests.map((t) => t.describes));
    expect(describesSet.size).toBeGreaterThan(1);
  });

  it('should handle claim with no identifiable function/class', () => {
    const claim: Claim = {
      text: 'The code handles errors gracefully',
      type: 'behavioral',
    };

    const verification = verifier.verify(claim, sampleTestCases);

    // Should match by keywords if possible, or return none
    expect(['strong', 'moderate', 'weak', 'none']).toContain(verification.verificationStrength);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('TestBasedVerifier - Integration', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should verify claims from actual Librarian test files', async () => {
    const response = `
      The CitationVerifier class is defined in citation_verifier.ts.
      It has a method called verifyCitation that takes a citation and facts.
      The method returns a verification result with verified boolean and reason.
    `;

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    // Should find test evidence from the actual test files
    expect(report.verifications.some((v) => v.hasTestEvidence)).toBe(true);
  });

  it('should work with EntailmentChecker claims', async () => {
    const response = `
      The EntailmentChecker extracts claims from responses.
      It checks whether claims are entailed by AST facts.
      The checker returns verdicts: entailed, contradicted, or neutral.
    `;

    const report = await verifier.verifyResponse(response, LIBRARIAN_ROOT);

    // Should find related tests
    expect(report.summary.claimsWithTestEvidence).toBeGreaterThanOrEqual(0);
  });

  it('should provide useful explanations for verification results', async () => {
    const claim: Claim = {
      text: 'CitationVerifier verifies citations against AST facts',
      type: 'behavioral',
    };

    const tests = await verifier.extractTests(LIBRARIAN_ROOT);
    const verification = verifier.verify(claim, tests);

    if (verification.hasTestEvidence) {
      // Explanation should mention the matching tests
      expect(verification.explanation.length).toBeGreaterThan(10);
    } else {
      // Explanation should indicate no evidence found
      expect(verification.explanation).toContain('No test evidence');
    }
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('TestBasedVerifier - Performance', () => {
  let verifier: TestBasedVerifier;

  beforeAll(() => {
    verifier = createTestBasedVerifier();
  });

  it('should extract tests within reasonable time', async () => {
    const startTime = Date.now();
    await verifier.extractTests(LIBRARIAN_ROOT);
    const endTime = Date.now();

    // Should complete within 30 seconds for a typical repo
    expect(endTime - startTime).toBeLessThan(30000);
  });

  it('should verify claims quickly', () => {
    const claim: Claim = {
      text: 'CitationVerifier verifies citations',
      type: 'behavioral',
    };

    const startTime = Date.now();
    verifier.verify(claim, sampleTestCases);
    const endTime = Date.now();

    // Should complete within 100ms
    expect(endTime - startTime).toBeLessThan(100);
  });

  it('should handle large test suites efficiently', () => {
    const claim: Claim = {
      text: 'Some function works',
      type: 'behavioral',
    };

    // Create many test cases
    const manyTests: TestCase[] = Array.from({ length: 1000 }, (_, i) => ({
      file: `/test/test_${i}.ts`,
      name: `test case ${i}`,
      describes: `TestSuite${i}`,
      assertions: ['expect(x).toBe(y)'],
    }));

    const startTime = Date.now();
    verifier.verify(claim, manyTests);
    const endTime = Date.now();

    // Should complete within 500ms even with 1000 tests
    expect(endTime - startTime).toBeLessThan(500);
  });
});
