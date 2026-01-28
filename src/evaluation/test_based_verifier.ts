/**
 * @fileoverview Test-Based Verifier (WU-1111)
 *
 * Uses existing tests in a codebase to verify Librarian's claims.
 * If Librarian claims "function X does Y", we can check if there's a test
 * that demonstrates this behavior.
 *
 * Verification Strength Levels:
 * - Strong: Multiple tests directly verify the claim
 * - Moderate: One test verifies, or tests partially cover
 * - Weak: Tests exist for related functionality
 * - None: No test evidence found
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { type Claim, EntailmentChecker } from './entailment_checker.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Represents a test case extracted from a test file
 */
export interface TestCase {
  /** Path to the test file */
  file: string;
  /** Name of the test (from it() or test()) */
  name: string;
  /** What the test describes (from describe()) */
  describes: string;
  /** Key assertions in the test */
  assertions: string[];
  /** Function being tested (if identifiable) */
  testedFunction?: string;
  /** Class being tested (if identifiable) */
  testedClass?: string;
}

/**
 * Verification strength levels
 */
export type VerificationStrength = 'strong' | 'moderate' | 'weak' | 'none';

/**
 * Result of verifying a single claim with test evidence
 */
export interface TestBasedVerification {
  /** The claim that was verified */
  claim: Claim;
  /** Whether test evidence was found */
  hasTestEvidence: boolean;
  /** Tests that match or relate to the claim */
  matchingTests: TestCase[];
  /** Strength of the verification */
  verificationStrength: VerificationStrength;
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Report of verifying all claims in a response
 */
export interface TestVerificationReport {
  /** All claims extracted from the response */
  claims: Claim[];
  /** Verification results for each claim */
  verifications: TestBasedVerification[];
  /** Summary statistics */
  summary: {
    /** Number of claims with test evidence */
    claimsWithTestEvidence: number;
    /** Number of claims without test evidence */
    claimsWithoutTestEvidence: number;
    /** Proportion of claims with test coverage */
    testCoverageRate: number;
  };
}

// ============================================================================
// PATTERNS FOR TEST EXTRACTION
// ============================================================================

// Pattern to match it() and test() calls
const TEST_PATTERN = /(?:it|test)\s*\(\s*(['"`])(.+?)\1/g;

// Pattern to match describe() calls
const DESCRIBE_PATTERN = /describe\s*\(\s*(['"`])(.+?)\1/g;

// Pattern to match expect() assertions
const EXPECT_PATTERN = /expect\s*\([^)]+\)\s*\.[\w.]+\s*\([^)]*\)/g;

// Pattern to extract identifiers from backticks
const BACKTICK_ID_PATTERN = /[`'](\w+)[`']/g;

// Pattern to match PascalCase class names
const CLASS_NAME_PATTERN = /\b([A-Z][a-zA-Z0-9]+)\b/g;

// Pattern to match camelCase function names
const FUNCTION_NAME_PATTERN = /\b([a-z][a-zA-Z0-9]*)\b/g;

// ============================================================================
// TEST BASED VERIFIER CLASS
// ============================================================================

/**
 * Verifies Librarian's claims using test evidence from a codebase
 */
export class TestBasedVerifier {
  private entailmentChecker: EntailmentChecker;

  constructor() {
    this.entailmentChecker = new EntailmentChecker();
  }

  /**
   * Extract test cases from a repository
   */
  async extractTests(repoPath: string): Promise<TestCase[]> {
    if (!fs.existsSync(repoPath)) {
      return [];
    }

    const testCases: TestCase[] = [];

    try {
      // Find all test files
      const testFiles = await glob('**/*.{test,spec}.{ts,tsx,js,jsx}', {
        cwd: repoPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        absolute: true,
      });

      // Process each test file
      for (const testFile of testFiles) {
        try {
          const testsFromFile = await this.extractTestsFromFile(testFile);
          testCases.push(...testsFromFile);
        } catch {
          // Skip files that can't be read
        }
      }
    } catch {
      // Return empty array on error
    }

    return testCases;
  }

  /**
   * Extract test cases from a single test file
   */
  private async extractTestsFromFile(filePath: string): Promise<TestCase[]> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const testCases: TestCase[] = [];

    // Extract describe blocks (nested support)
    const describeBlocks = this.extractDescribeBlocks(content);

    // Extract test cases
    const testPattern = new RegExp(TEST_PATTERN.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = testPattern.exec(content)) !== null) {
      const testName = match[2];
      const testPosition = match.index;

      // Find the describe context for this test
      const describes = this.findDescribeContext(describeBlocks, testPosition, content);

      // Extract assertions from the test body
      const testBody = this.extractTestBody(content, testPosition);
      const assertions = this.extractAssertions(testBody);

      // Try to identify tested function/class
      const testedFunction = this.identifyTestedFunction(testName, testBody, describes);
      const testedClass = this.identifyTestedClass(testName, testBody, describes);

      testCases.push({
        file: filePath,
        name: testName,
        describes,
        assertions,
        testedFunction,
        testedClass,
      });
    }

    return testCases;
  }

  /**
   * Extract describe block names and positions
   */
  private extractDescribeBlocks(content: string): Array<{ name: string; start: number; end: number }> {
    const blocks: Array<{ name: string; start: number; end: number }> = [];
    const describePattern = new RegExp(DESCRIBE_PATTERN.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = describePattern.exec(content)) !== null) {
      const name = match[2];
      const start = match.index;
      // Estimate end position (find matching closing brace)
      const end = this.findBlockEnd(content, start);

      blocks.push({ name, start, end });
    }

    return blocks;
  }

  /**
   * Find the end of a block (matching braces)
   */
  private findBlockEnd(content: string, start: number): number {
    let braceCount = 0;
    let foundFirstBrace = false;

    for (let i = start; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        foundFirstBrace = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (foundFirstBrace && braceCount === 0) {
          return i;
        }
      }
    }

    return content.length;
  }

  /**
   * Find the describe context for a test at a given position
   */
  private findDescribeContext(
    describeBlocks: Array<{ name: string; start: number; end: number }>,
    testPosition: number,
    _content: string
  ): string {
    // Find all describe blocks that contain this test position
    const containingBlocks = describeBlocks.filter(
      (block) => block.start < testPosition && block.end > testPosition
    );

    // Sort by position (innermost first)
    containingBlocks.sort((a, b) => b.start - a.start);

    // Combine describe names
    if (containingBlocks.length > 0) {
      // Return the most specific (innermost) describe
      return containingBlocks.map((b) => b.name).join(' - ');
    }

    return '';
  }

  /**
   * Extract the body of a test function
   */
  private extractTestBody(content: string, testStart: number): string {
    // Find the opening brace of the test
    const arrowOrBrace = content.indexOf('=>', testStart);
    const openBrace = content.indexOf('{', testStart);

    let bodyStart: number;
    if (arrowOrBrace !== -1 && arrowOrBrace < openBrace + 50) {
      bodyStart = arrowOrBrace + 2;
    } else {
      bodyStart = openBrace + 1;
    }

    // Find the end of the test body
    const bodyEnd = this.findBlockEnd(content, bodyStart - 1);

    return content.slice(bodyStart, bodyEnd);
  }

  /**
   * Extract assertions from test body
   */
  private extractAssertions(testBody: string): string[] {
    const assertions: string[] = [];
    const expectPattern = new RegExp(EXPECT_PATTERN.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = expectPattern.exec(testBody)) !== null) {
      assertions.push(match[0].trim());
    }

    return assertions;
  }

  /**
   * Try to identify the tested function from test name and body
   */
  private identifyTestedFunction(testName: string, testBody: string, describes: string): string | undefined {
    // Check describe for function name
    const describeWords = describes.split(/\s*-\s*/);
    for (const word of describeWords) {
      const funcMatch = word.match(/\.?(\w+)\s*$/);
      if (funcMatch && /^[a-z]/.test(funcMatch[1])) {
        return funcMatch[1];
      }
    }

    // Check test name for function mentions
    const backtickPattern = new RegExp(BACKTICK_ID_PATTERN.source, 'g');
    const backtickMatches = [...testName.matchAll(backtickPattern)];
    for (const match of backtickMatches) {
      if (/^[a-z]/.test(match[1])) {
        return match[1];
      }
    }

    // Check test body for function calls
    const funcCallPattern = /(\w+)\s*\(/g;
    const funcCalls = [...testBody.matchAll(funcCallPattern)];
    for (const call of funcCalls) {
      const funcName = call[1];
      // Skip common test utilities
      if (!['expect', 'it', 'test', 'describe', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach'].includes(funcName)) {
        if (/^[a-z]/.test(funcName)) {
          return funcName;
        }
      }
    }

    return undefined;
  }

  /**
   * Try to identify the tested class from test name and body
   */
  private identifyTestedClass(testName: string, testBody: string, describes: string): string | undefined {
    // Check describe for class name (PascalCase)
    const classPattern = new RegExp(CLASS_NAME_PATTERN.source, 'g');
    const describeMatches = [...describes.matchAll(classPattern)];
    for (const match of describeMatches) {
      // Filter out common non-class words
      if (!['Interface', 'Tests', 'Test', 'Edge', 'Cases'].includes(match[1])) {
        return match[1];
      }
    }

    // Check test name for class mentions
    const testNameMatches = [...testName.matchAll(classPattern)];
    for (const match of testNameMatches) {
      if (!['Interface', 'Tests', 'Test'].includes(match[1])) {
        return match[1];
      }
    }

    // Check test body for class instantiation
    const newPattern = /new\s+([A-Z][a-zA-Z0-9]+)/g;
    const newMatches = [...testBody.matchAll(newPattern)];
    if (newMatches.length > 0) {
      return newMatches[0][1];
    }

    return undefined;
  }

  /**
   * Find tests related to a claim
   */
  findRelatedTests(claim: Claim, tests: TestCase[]): TestCase[] {
    const relatedTests: TestCase[] = [];
    const seenTests = new Set<string>();

    // Extract identifiers from the claim
    const claimIdentifiers = this.extractClaimIdentifiers(claim);

    for (const test of tests) {
      const testKey = `${test.file}:${test.name}`;
      if (seenTests.has(testKey)) {
        continue;
      }

      const relevanceScore = this.calculateRelevance(claim, claimIdentifiers, test);

      if (relevanceScore > 0) {
        relatedTests.push(test);
        seenTests.add(testKey);
      }
    }

    // Sort by relevance (most relevant first)
    return relatedTests.sort((a, b) => {
      const scoreA = this.calculateRelevance(claim, claimIdentifiers, a);
      const scoreB = this.calculateRelevance(claim, claimIdentifiers, b);
      return scoreB - scoreA;
    });
  }

  /**
   * Extract identifiers from a claim
   */
  private extractClaimIdentifiers(claim: Claim): { classes: string[]; functions: string[]; keywords: string[] } {
    const classes: string[] = [];
    const functions: string[] = [];
    const keywords: string[] = [];

    const claimText = claim.text;

    // Extract PascalCase class names
    const classPattern = new RegExp(CLASS_NAME_PATTERN.source, 'g');
    const classMatches = [...claimText.matchAll(classPattern)];
    for (const match of classMatches) {
      if (!['The', 'This', 'It', 'If', 'When', 'Then'].includes(match[1])) {
        classes.push(match[1]);
      }
    }

    // Extract backtick identifiers
    const backtickPattern = new RegExp(BACKTICK_ID_PATTERN.source, 'g');
    const backtickMatches = [...claimText.matchAll(backtickPattern)];
    for (const match of backtickMatches) {
      if (/^[A-Z]/.test(match[1])) {
        if (!classes.includes(match[1])) {
          classes.push(match[1]);
        }
      } else {
        if (!functions.includes(match[1])) {
          functions.push(match[1]);
        }
      }
    }

    // Extract significant keywords (3+ chars, not common words)
    const commonWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were',
      'been', 'being', 'will', 'would', 'should', 'could', 'method', 'function', 'class', 'returns',
      'takes', 'accepts', 'when', 'then', 'correctly', 'properly', 'successfully',
    ]);

    const words = claimText.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
    for (const word of words) {
      if (!commonWords.has(word) && !keywords.includes(word)) {
        keywords.push(word);
      }
    }

    // Extract from source if available
    if (claim.source) {
      const sourceFile = path.basename(claim.source).replace(/\.[^.]+$/, '');
      const sourceWords = sourceFile.split(/[_-]/).filter((w) => w.length > 0);
      for (const word of sourceWords) {
        if (!keywords.includes(word.toLowerCase())) {
          keywords.push(word.toLowerCase());
        }
      }
    }

    return { classes, functions, keywords };
  }

  /**
   * Calculate relevance score between a claim and a test
   */
  private calculateRelevance(
    claim: Claim,
    identifiers: { classes: string[]; functions: string[]; keywords: string[] },
    test: TestCase
  ): number {
    let score = 0;

    // Direct class match (high score)
    for (const className of identifiers.classes) {
      if (test.testedClass === className) {
        score += 10;
      } else if (test.describes.includes(className)) {
        score += 5;
      } else if (test.name.includes(className)) {
        score += 3;
      }
    }

    // Direct function match (high score)
    for (const funcName of identifiers.functions) {
      if (test.testedFunction === funcName) {
        score += 10;
      } else if (test.describes.includes(funcName)) {
        score += 5;
      } else if (test.name.includes(funcName)) {
        score += 3;
      }
    }

    // Keyword matches (lower score)
    const testText = `${test.describes} ${test.name} ${test.assertions.join(' ')}`.toLowerCase();
    for (const keyword of identifiers.keywords) {
      if (testText.includes(keyword)) {
        score += 1;
      }
    }

    // Source file match
    if (claim.source) {
      const sourceBasename = path.basename(claim.source).replace(/\.[^.]+$/, '');
      const testBasename = path.basename(test.file).replace(/\.(test|spec)\.[^.]+$/, '');

      if (sourceBasename === testBasename) {
        score += 8;
      } else if (testBasename.includes(sourceBasename) || sourceBasename.includes(testBasename)) {
        score += 4;
      }
    }

    return score;
  }

  /**
   * Verify a claim using test evidence
   */
  verify(claim: Claim, tests: TestCase[]): TestBasedVerification {
    const matchingTests = this.findRelatedTests(claim, tests);
    const hasTestEvidence = matchingTests.length > 0;

    // Calculate verification strength
    const verificationStrength = this.calculateVerificationStrength(claim, matchingTests);

    // Generate explanation
    const explanation = this.generateExplanation(claim, matchingTests, verificationStrength);

    return {
      claim,
      hasTestEvidence,
      matchingTests,
      verificationStrength,
      explanation,
    };
  }

  /**
   * Calculate verification strength based on matching tests
   */
  private calculateVerificationStrength(claim: Claim, matchingTests: TestCase[]): VerificationStrength {
    if (matchingTests.length === 0) {
      return 'none';
    }

    const identifiers = this.extractClaimIdentifiers(claim);

    // Count direct matches (tests that directly test the claimed function/class)
    let directMatches = 0;
    let partialMatches = 0;

    for (const test of matchingTests) {
      const relevance = this.calculateRelevance(claim, identifiers, test);

      if (relevance >= 10) {
        directMatches++;
      } else if (relevance >= 3) {
        partialMatches++;
      }
    }

    if (directMatches >= 2) {
      return 'strong';
    } else if (directMatches === 1 || partialMatches >= 2) {
      return 'moderate';
    } else if (matchingTests.length > 0) {
      return 'weak';
    }

    return 'none';
  }

  /**
   * Generate human-readable explanation for verification
   */
  private generateExplanation(
    claim: Claim,
    matchingTests: TestCase[],
    strength: VerificationStrength
  ): string {
    if (strength === 'none') {
      return 'No test evidence found for this claim.';
    }

    const testDescriptions = matchingTests.slice(0, 3).map((t) => {
      const testInfo = t.testedClass ? `${t.testedClass}` : t.testedFunction || 'test';
      return `"${t.name}" (${testInfo})`;
    });

    const testList = testDescriptions.join(', ');

    switch (strength) {
      case 'strong':
        return `Strong evidence: Multiple tests directly verify this claim: ${testList}.`;
      case 'moderate':
        return `Moderate evidence: Test verifies part of this claim: ${testList}.`;
      case 'weak':
        return `Weak evidence: Related tests exist but don't directly verify: ${testList}.`;
      default:
        return 'No test evidence found.';
    }
  }

  /**
   * Verify all claims in a response
   */
  async verifyResponse(response: string, repoPath: string): Promise<TestVerificationReport> {
    // Extract claims from the response
    const claims = this.entailmentChecker.extractClaims(response);

    if (claims.length === 0) {
      return {
        claims: [],
        verifications: [],
        summary: {
          claimsWithTestEvidence: 0,
          claimsWithoutTestEvidence: 0,
          testCoverageRate: 0,
        },
      };
    }

    // Extract tests from the repository
    const tests = await this.extractTests(repoPath);

    // Verify each claim
    const verifications: TestBasedVerification[] = claims.map((claim) => this.verify(claim, tests));

    // Calculate summary
    const claimsWithTestEvidence = verifications.filter((v) => v.hasTestEvidence).length;
    const claimsWithoutTestEvidence = verifications.filter((v) => !v.hasTestEvidence).length;

    return {
      claims,
      verifications,
      summary: {
        claimsWithTestEvidence,
        claimsWithoutTestEvidence,
        testCoverageRate: claims.length > 0 ? claimsWithTestEvidence / claims.length : 0,
      },
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new TestBasedVerifier instance
 */
export function createTestBasedVerifier(): TestBasedVerifier {
  return new TestBasedVerifier();
}
