/**
 * @fileoverview Tests for AST-Based Claim Verifier (WU-HALU-007)
 *
 * TDD: Tests written FIRST. Implementation follows.
 *
 * Verifies line-level citation accuracy using AST analysis.
 * Target: >= 95% line number accuracy
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  ASTClaimVerifier,
  createASTClaimVerifier,
  type LineReference,
  type ClaimVerificationResult,
  type ASTClaimVerifierConfig,
} from '../ast_claim_verifier.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(LIBRARIAN_ROOT, 'src');
const EVALUATION_DIR = path.join(SRC_DIR, 'evaluation');
const AST_FACT_EXTRACTOR_PATH = path.join(EVALUATION_DIR, 'ast_fact_extractor.ts');
const CITATION_VERIFIER_PATH = path.join(EVALUATION_DIR, 'citation_verifier.ts');
const AGENTS_DIR = path.join(SRC_DIR, 'agents');

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createASTClaimVerifier', () => {
  it('should create an ASTClaimVerifier instance', () => {
    const verifier = createASTClaimVerifier();
    expect(verifier).toBeInstanceOf(ASTClaimVerifier);
  });

  it('should accept custom configuration', () => {
    const config: ASTClaimVerifierConfig = {
      lineTolerance: 5,
      enableFuzzyMatching: false,
    };
    const verifier = createASTClaimVerifier(config);
    expect(verifier).toBeInstanceOf(ASTClaimVerifier);
  });
});

// ============================================================================
// LINE REFERENCE VERIFICATION TESTS
// ============================================================================

describe('ASTClaimVerifier - verifyLineReferences', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should verify exact line reference match', async () => {
    // First, find the actual line number of createASTFactExtractor
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const factoryLine = lines.findIndex((line) =>
      line.includes('export function createASTFactExtractor')
    ) + 1;

    const claim = 'The factory function createASTFactExtractor is exported';
    const references: LineReference[] = [
      {
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: factoryLine,
        content: 'export function createASTFactExtractor',
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(result.issues.length).toBe(0);
  });

  it('should handle off-by-one line errors gracefully', async () => {
    // Find actual line of ASTFactExtractor class
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const classLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;

    const claim = 'The ASTFactExtractor class is defined here';
    const references: LineReference[] = [
      {
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: classLine + 1, // Off by one
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    // Line is still valid (exists in file), so verification passes
    // Note: verifyLineReferences checks if line exists, not if it matches AST symbol
    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.5);
  });

  it('should handle off-by-three line errors with partial match', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const classLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;

    const claim = 'ASTFactExtractor class definition';
    const references: LineReference[] = [
      {
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: classLine + 3, // Off by three (within default tolerance)
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    // Within 3-line tolerance should still be a partial match
    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.5);
  });

  it('should reject references beyond tolerance', async () => {
    const claim = 'Some function is here';
    const references: LineReference[] = [
      {
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: 99999, // Way beyond file length
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    expect(result.verified).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'line_mismatch')).toBe(true);
  });

  it('should detect missing files', async () => {
    const claim = 'This file does not exist';
    const references: LineReference[] = [
      {
        filePath: '/nonexistent/path/to/file.ts',
        lineNumber: 10,
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    expect(result.verified).toBe(false);
    expect(result.accuracy).toBe(0);
    expect(result.issues.some((i) => i.type === 'file_missing')).toBe(true);
  });

  it('should verify content matches when provided', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const factoryLine = lines.findIndex((line) =>
      line.includes('export function createASTFactExtractor')
    ) + 1;

    const claim = 'Factory function for ASTFactExtractor';
    const references: LineReference[] = [
      {
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: factoryLine,
        content: 'createASTFactExtractor',
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('should detect content changes', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const factoryLine = lines.findIndex((line) =>
      line.includes('export function createASTFactExtractor')
    ) + 1;

    const claim = 'Factory function';
    const references: LineReference[] = [
      {
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: factoryLine,
        content: 'COMPLETELY_DIFFERENT_CONTENT_NOT_IN_FILE',
      },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    expect(result.issues.some((i) => i.type === 'content_changed')).toBe(true);
  });

  it('should handle multiple references', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const classLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;
    const factoryLine = lines.findIndex((line) =>
      line.includes('export function createASTFactExtractor')
    ) + 1;

    const claim = 'ASTFactExtractor class and factory function';
    const references: LineReference[] = [
      { filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: classLine },
      { filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: factoryLine },
    ];

    const result = await verifier.verifyLineReferences(claim, references);

    expect(result.verified).toBe(true);
    expect(result.references.length).toBe(2);
  });

  it('should handle empty references array', async () => {
    const result = await verifier.verifyLineReferences('Some claim', []);

    expect(result.verified).toBe(false);
    expect(result.accuracy).toBe(0);
  });
});

// ============================================================================
// FUNCTION CLAIM VERIFICATION TESTS
// ============================================================================

describe('ASTClaimVerifier - verifyFunctionClaim', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should verify an existing function claim', async () => {
    const claim = 'createASTFactExtractor is a factory function';
    const result = await verifier.verifyFunctionClaim(
      claim,
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.references[0].lineNumber).toBeGreaterThan(0);
  });

  it('should verify a class method claim', async () => {
    const claim = 'extractFromFile is a method on ASTFactExtractor';
    const result = await verifier.verifyFunctionClaim(
      claim,
      'extractFromFile',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it('should reject non-existent function claims', async () => {
    const claim = 'nonExistentFunction does something';
    const result = await verifier.verifyFunctionClaim(
      claim,
      'nonExistentFunction',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(false);
    expect(result.accuracy).toBe(0);
  });

  it('should handle non-existent file gracefully', async () => {
    const claim = 'someFunction exists';
    const result = await verifier.verifyFunctionClaim(
      claim,
      'someFunction',
      '/nonexistent/file.ts'
    );

    expect(result.verified).toBe(false);
    expect(result.issues.some((i) => i.type === 'file_missing')).toBe(true);
  });

  it('should find function in different file locations', async () => {
    // citationVerifier.ts has extractCitations method
    const claim = 'extractCitations extracts citations from text';
    const result = await verifier.verifyFunctionClaim(
      claim,
      'extractCitations',
      CITATION_VERIFIER_PATH
    );

    expect(result.verified).toBe(true);
    expect(result.references[0].filePath).toBe(CITATION_VERIFIER_PATH);
  });

  it('should return accurate line numbers for functions', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const expectedLine = lines.findIndex((line) =>
      line.includes('export function createASTFactExtractor')
    ) + 1;

    const result = await verifier.verifyFunctionClaim(
      'Factory function',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(true);
    // Line number should be within tolerance
    const actualLine = result.references[0].lineNumber;
    expect(Math.abs(actualLine - expectedLine)).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// CLASS CLAIM VERIFICATION TESTS
// ============================================================================

describe('ASTClaimVerifier - verifyClassClaim', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should verify an existing class claim', async () => {
    const claim = 'ASTFactExtractor is the main class for fact extraction';
    const result = await verifier.verifyClassClaim(
      claim,
      'ASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(result.references.length).toBeGreaterThan(0);
  });

  it('should verify CitationVerifier class claim', async () => {
    const claim = 'CitationVerifier verifies citations';
    const result = await verifier.verifyClassClaim(
      claim,
      'CitationVerifier',
      CITATION_VERIFIER_PATH
    );

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('should reject non-existent class claims', async () => {
    const claim = 'NonExistentClass is defined here';
    const result = await verifier.verifyClassClaim(
      claim,
      'NonExistentClass',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(false);
    expect(result.accuracy).toBe(0);
  });

  it('should handle non-existent file gracefully', async () => {
    const claim = 'SomeClass exists';
    const result = await verifier.verifyClassClaim(
      claim,
      'SomeClass',
      '/nonexistent/file.ts'
    );

    expect(result.verified).toBe(false);
    expect(result.issues.some((i) => i.type === 'file_missing')).toBe(true);
  });

  it('should return accurate line numbers for classes', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const expectedLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;

    const result = await verifier.verifyClassClaim(
      'Main extractor class',
      'ASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(true);
    const actualLine = result.references[0].lineNumber;
    // Line number should be within tolerance
    expect(Math.abs(actualLine - expectedLine)).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// VERIFICATION STATISTICS TESTS
// ============================================================================

describe('ASTClaimVerifier - getVerificationStats', () => {
  let verifier: ASTClaimVerifier;

  beforeEach(() => {
    verifier = createASTClaimVerifier();
  });

  it('should return initial stats with zero values', () => {
    const stats = verifier.getVerificationStats();

    expect(stats.total).toBe(0);
    expect(stats.verified).toBe(0);
    expect(stats.accuracy).toBe(0);
  });

  it('should track verification attempts', async () => {
    await verifier.verifyFunctionClaim(
      'Test claim',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    const stats = verifier.getVerificationStats();

    expect(stats.total).toBe(1);
    expect(stats.verified).toBe(1);
    expect(stats.accuracy).toBe(1);
  });

  it('should track failed verifications', async () => {
    await verifier.verifyFunctionClaim(
      'Test claim',
      'nonExistentFunction',
      AST_FACT_EXTRACTOR_PATH
    );

    const stats = verifier.getVerificationStats();

    expect(stats.total).toBe(1);
    expect(stats.verified).toBe(0);
    expect(stats.accuracy).toBe(0);
  });

  it('should calculate accuracy correctly', async () => {
    // One successful verification
    await verifier.verifyFunctionClaim(
      'Claim 1',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    // One failed verification
    await verifier.verifyFunctionClaim(
      'Claim 2',
      'nonExistentFunction',
      AST_FACT_EXTRACTOR_PATH
    );

    const stats = verifier.getVerificationStats();

    expect(stats.total).toBe(2);
    expect(stats.verified).toBe(1);
    expect(stats.accuracy).toBe(0.5);
  });

  it('should accumulate stats across multiple verifications', async () => {
    await verifier.verifyClassClaim('Class claim', 'ASTFactExtractor', AST_FACT_EXTRACTOR_PATH);
    await verifier.verifyFunctionClaim('Function claim', 'createASTFactExtractor', AST_FACT_EXTRACTOR_PATH);
    await verifier.verifyFunctionClaim('Method claim', 'extractFromFile', AST_FACT_EXTRACTOR_PATH);

    const stats = verifier.getVerificationStats();

    expect(stats.total).toBe(3);
    expect(stats.verified).toBe(3);
    expect(stats.accuracy).toBe(1);
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('ASTClaimVerifier - Configuration', () => {
  it('should respect custom line tolerance', async () => {
    const strictVerifier = createASTClaimVerifier({ lineTolerance: 0 });

    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const classLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;

    // Off-by-one should fail with zero tolerance
    const result = await strictVerifier.verifyLineReferences(
      'ASTFactExtractor class',
      [{ filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: classLine + 1 }]
    );

    // With zero tolerance, off-by-one should reduce accuracy significantly
    expect(result.accuracy).toBeLessThan(0.9);
  });

  it('should respect higher line tolerance', async () => {
    const lenientVerifier = createASTClaimVerifier({ lineTolerance: 10 });

    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const classLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;

    // Off-by-five should pass with tolerance of 10
    const result = await lenientVerifier.verifyLineReferences(
      'ASTFactExtractor class',
      [{ filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: classLine + 5 }]
    );

    expect(result.verified).toBe(true);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.5);
  });

  it('should use default configuration when none provided', () => {
    const verifier = createASTClaimVerifier();
    expect(verifier).toBeInstanceOf(ASTClaimVerifier);
    // Should have sensible default behavior
  });
});

// ============================================================================
// INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('LineReference Interface', () => {
  it('should support all required fields', () => {
    const ref: LineReference = {
      filePath: '/path/to/file.ts',
      lineNumber: 42,
    };

    expect(ref.filePath).toBe('/path/to/file.ts');
    expect(ref.lineNumber).toBe(42);
  });

  it('should support optional content field', () => {
    const ref: LineReference = {
      filePath: '/path/to/file.ts',
      lineNumber: 42,
      content: 'function example() {}',
    };

    expect(ref.content).toBe('function example() {}');
  });
});

describe('ClaimVerificationResult Interface', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should have all required fields', async () => {
    const result = await verifier.verifyFunctionClaim(
      'Test claim',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.claim).toBe('Test claim');
    expect(Array.isArray(result.references)).toBe(true);
    expect(typeof result.verified).toBe('boolean');
    expect(typeof result.accuracy).toBe('number');
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it('should have accuracy between 0 and 1', async () => {
    const result = await verifier.verifyFunctionClaim(
      'Test claim',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
  });

  it('should have proper issue structure', async () => {
    const result = await verifier.verifyFunctionClaim(
      'Test claim',
      'nonExistentFunction',
      AST_FACT_EXTRACTOR_PATH
    );

    if (result.issues.length > 0) {
      const issue = result.issues[0];
      expect(['line_mismatch', 'file_missing', 'content_changed']).toContain(issue.type);
      expect(typeof issue.details).toBe('string');
    }
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('ASTClaimVerifier - Edge Cases', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should handle empty claim string', async () => {
    const result = await verifier.verifyFunctionClaim(
      '',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    // Should still verify based on function name, not claim text
    expect(result.verified).toBe(true);
  });

  it('should handle empty function name', async () => {
    const result = await verifier.verifyFunctionClaim(
      'Some claim',
      '',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(false);
  });

  it('should handle empty class name', async () => {
    const result = await verifier.verifyClassClaim(
      'Some claim',
      '',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.verified).toBe(false);
  });

  it('should handle line number 0', async () => {
    const result = await verifier.verifyLineReferences(
      'Test claim',
      [{ filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: 0 }]
    );

    // Line 0 is invalid (lines are 1-indexed)
    expect(result.verified).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should handle negative line numbers', async () => {
    const result = await verifier.verifyLineReferences(
      'Test claim',
      [{ filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: -5 }]
    );

    expect(result.verified).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should handle special characters in function names', async () => {
    // Dollar sign is valid in JS identifiers
    const result = await verifier.verifyFunctionClaim(
      'Test claim',
      '$specialFunction',
      AST_FACT_EXTRACTOR_PATH
    );

    // Should not crash, just not find the function
    expect(result.verified).toBe(false);
  });

  it('should handle unicode in claims', async () => {
    const result = await verifier.verifyFunctionClaim(
      'Test claim with unicode: \u{1F600}',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    // Should still verify despite unicode in claim
    expect(result.verified).toBe(true);
  });

  it('should handle very long file paths', async () => {
    const longPath = '/a'.repeat(500) + '/file.ts';
    const result = await verifier.verifyFunctionClaim(
      'Test claim',
      'someFunction',
      longPath
    );

    expect(result.verified).toBe(false);
    expect(result.issues.some((i) => i.type === 'file_missing')).toBe(true);
  });

  it('should handle binary/non-text files gracefully', async () => {
    // Try to verify against package-lock.json (not a TS file)
    const result = await verifier.verifyFunctionClaim(
      'Test claim',
      'someFunction',
      path.join(LIBRARIAN_ROOT, 'package-lock.json')
    );

    // Should not crash, just fail verification
    expect(result.verified).toBe(false);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('ASTClaimVerifier - Performance', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should verify function claims quickly', async () => {
    const start = Date.now();

    for (let i = 0; i < 10; i++) {
      await verifier.verifyFunctionClaim(
        'Test claim',
        'createASTFactExtractor',
        AST_FACT_EXTRACTOR_PATH
      );
    }

    const elapsed = Date.now() - start;
    // Should complete 10 verifications in under 5 seconds
    expect(elapsed).toBeLessThan(5000);
  });

  it('should verify class claims quickly', async () => {
    const start = Date.now();

    for (let i = 0; i < 10; i++) {
      await verifier.verifyClassClaim(
        'Test claim',
        'ASTFactExtractor',
        AST_FACT_EXTRACTOR_PATH
      );
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it('should handle multiple line references efficiently', async () => {
    const references: LineReference[] = [];
    for (let i = 1; i <= 50; i++) {
      references.push({
        filePath: AST_FACT_EXTRACTOR_PATH,
        lineNumber: i * 10,
      });
    }

    const start = Date.now();
    await verifier.verifyLineReferences('Many references', references);
    const elapsed = Date.now() - start;

    // Should complete in under 10 seconds
    expect(elapsed).toBeLessThan(10000);
  });
});

// ============================================================================
// ACCURACY REQUIREMENT TESTS
// ============================================================================

describe('ASTClaimVerifier - 95% Accuracy Requirement', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should achieve >= 95% accuracy on exact matches', async () => {
    const result = await verifier.verifyFunctionClaim(
      'Factory function',
      'createASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('should achieve >= 95% accuracy on class verification', async () => {
    const result = await verifier.verifyClassClaim(
      'Main class',
      'ASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    expect(result.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('should achieve >= 95% accuracy on multiple valid references', async () => {
    const fileContent = fs.readFileSync(AST_FACT_EXTRACTOR_PATH, 'utf-8');
    const lines = fileContent.split('\n');
    const classLine = lines.findIndex((line) =>
      line.includes('export class ASTFactExtractor')
    ) + 1;

    const result = await verifier.verifyLineReferences(
      'ASTFactExtractor class',
      [{ filePath: AST_FACT_EXTRACTOR_PATH, lineNumber: classLine }]
    );

    expect(result.accuracy).toBeGreaterThanOrEqual(0.95);
  });
});

// ============================================================================
// INTEGRATION WITH REAL CODEBASE
// ============================================================================

describe('ASTClaimVerifier - Real Codebase Integration', () => {
  let verifier: ASTClaimVerifier;

  beforeAll(() => {
    verifier = createASTClaimVerifier();
  });

  it('should verify claims against evaluation directory files', async () => {
    const result = await verifier.verifyClassClaim(
      'CitationVerifier handles citation verification',
      'CitationVerifier',
      CITATION_VERIFIER_PATH
    );

    expect(result.verified).toBe(true);
    expect(result.references[0].filePath).toBe(CITATION_VERIFIER_PATH);
    expect(result.references[0].lineNumber).toBeGreaterThan(0);
  });

  it('should handle multiple files in verification', async () => {
    // Verify across different files
    const result1 = await verifier.verifyClassClaim(
      'ASTFactExtractor',
      'ASTFactExtractor',
      AST_FACT_EXTRACTOR_PATH
    );

    const result2 = await verifier.verifyClassClaim(
      'CitationVerifier',
      'CitationVerifier',
      CITATION_VERIFIER_PATH
    );

    expect(result1.verified).toBe(true);
    expect(result2.verified).toBe(true);

    const stats = verifier.getVerificationStats();
    expect(stats.total).toBe(2);
    expect(stats.verified).toBe(2);
    expect(stats.accuracy).toBe(1);
  });
});
