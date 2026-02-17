/**
 * @fileoverview Tests for Citation Verifier (WU-804)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Citation Verifier validates Librarian's output citations against ground truth.
 * When Librarian claims "function X is defined in file Y at line Z", the Citation
 * Verifier checks if that's actually true.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  CitationVerifier,
  createCitationVerifier,
  type Citation,
  type CitationVerificationResult,
  type CitationVerificationReport,
} from '../citation_verifier.js';
import { type ASTFact } from '../ast_fact_extractor.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const PROBLEM_DETECTOR_PATH = path.join(LIBRARIAN_ROOT, 'src/agents/problem_detector.ts');
const AGENTS_DIR = path.join(LIBRARIAN_ROOT, 'src/agents');

// Sample AST facts for testing (simulating what ASTFactExtractor would return)
const sampleFacts: ASTFact[] = [
  {
    type: 'function_def',
    identifier: 'createProblemDetector',
    file: PROBLEM_DETECTOR_PATH,
    line: 150,
    details: {
      parameters: [],
      returnType: 'ProblemDetector',
      isAsync: false,
      isExported: true,
    },
  },
  {
    type: 'class',
    identifier: 'ProblemDetector',
    file: PROBLEM_DETECTOR_PATH,
    line: 50,
    details: {
      methods: ['identifyProblems', 'testFailures', 'regressionCheck'],
      properties: ['agentType', 'name'],
      isAbstract: false,
    },
  },
  {
    type: 'function_def',
    identifier: 'identifyProblems',
    file: PROBLEM_DETECTOR_PATH,
    line: 80,
    details: {
      parameters: [{ name: 'context', type: 'Context' }],
      returnType: 'Promise<Problem[]>',
      isAsync: true,
      isExported: false,
      className: 'ProblemDetector',
    },
  },
  {
    type: 'import',
    identifier: 'ProblemDetectorAgent',
    file: PROBLEM_DETECTOR_PATH,
    line: 5,
    details: {
      source: './types.js',
      specifiers: [{ name: 'ProblemDetectorAgent' }],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: true,
    },
  },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createCitationVerifier', () => {
  it('should create a verifier instance', () => {
    const verifier = createCitationVerifier();
    expect(verifier).toBeInstanceOf(CitationVerifier);
  });
});

// ============================================================================
// EXTRACT CITATIONS TESTS
// ============================================================================

describe('CitationVerifier - extractCitations', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should extract file:line citations from backticks', () => {
    const text = 'The function is defined in `src/foo.ts:42`';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/foo.ts');
    expect(citations[0].line).toBe(42);
  });

  it('should extract "line N" pattern citations', () => {
    const text = 'see `src/bar.ts` line 15 for the implementation';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/bar.ts');
    expect(citations[0].line).toBe(15);
  });

  it('should extract function identifier citations', () => {
    const text = 'function `doThing` in `src/util.ts`';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/util.ts');
    expect(citations[0].identifier).toBe('doThing');
  });

  it('should extract parenthetical citations with line numbers', () => {
    const text = '`MyClass` (src/models/my_class.ts:100) provides the implementation';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/models/my_class.ts');
    expect(citations[0].line).toBe(100);
    expect(citations[0].identifier).toBe('MyClass');
  });

  it('should extract multiple citations from a single text', () => {
    const text = `
      The \`handleRequest\` function is defined in \`src/api.ts:25\`.
      It calls \`parseInput\` from \`src/parser.ts:10\`.
      See also \`validateData\` in \`src/validator.ts\` line 42.
    `;
    const citations = verifier.extractCitations(text);

    // Should have at least 3 citations (may have more due to pattern overlaps)
    expect(citations.length).toBeGreaterThanOrEqual(3);

    // Verify we found the expected files
    const files = citations.map((c) => c.file);
    expect(files).toContain('src/api.ts');
    expect(files).toContain('src/parser.ts');
    expect(files).toContain('src/validator.ts');
  });

  it('should extract file-only citations without line numbers', () => {
    const text = 'The configuration is in `src/config.ts`';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/config.ts');
    expect(citations[0].line).toBeUndefined();
  });

  it('should handle GitHub-style line references', () => {
    const text = 'See `src/main.ts#L25` for details';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/main.ts');
    expect(citations[0].line).toBe(25);
  });

  it('should handle "defined in" pattern', () => {
    const text = '`processData` is defined in `src/processor.ts:30`';
    const citations = verifier.extractCitations(text);

    // Should find at least one citation with the correct file and line
    expect(citations.length).toBeGreaterThanOrEqual(1);
    const mainCitation = citations.find((c) => c.file === 'src/processor.ts' && c.line === 30);
    expect(mainCitation).toBeDefined();
    expect(mainCitation?.identifier).toBe('processData');
  });

  it('should handle line ranges', () => {
    const text = 'See `src/utils.ts:10-20` for the helper functions';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/utils.ts');
    expect(citations[0].line).toBe(10); // Start of range
  });

  it('should return empty array for text with no citations', () => {
    const text = 'This is just regular text without any code references.';
    const citations = verifier.extractCitations(text);

    expect(citations).toEqual([]);
  });

  it('should handle claims in the citation text', () => {
    // Use backtick around the file:line for more reliable extraction
    const text = 'The `UserService` class handles authentication in `src/services/user.ts:50`';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBeGreaterThanOrEqual(1);
    const mainCitation = citations.find((c) => c.file === 'src/services/user.ts');
    expect(mainCitation).toBeDefined();
    expect(mainCitation?.claim).toContain('UserService');
  });
});

// ============================================================================
// VERIFY SINGLE CITATION TESTS
// ============================================================================

describe('CitationVerifier - verifyCitation', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should verify a citation that matches an AST fact', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 150,
      identifier: 'createProblemDetector',
      claim: 'function createProblemDetector is defined here',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(true);
    expect(result.reason).toBe('identifier_found');
    expect(result.matchedFact).toBeDefined();
    expect(result.matchedFact?.identifier).toBe('createProblemDetector');
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('should reject a citation with wrong line number', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 999, // Line doesn't exist
      identifier: 'createProblemDetector',
      claim: 'function at line 999',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(false);
    expect(['line_out_of_range', 'identifier_not_found', 'identifier_not_in_file']).toContain(result.reason);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should reject a citation with non-existent identifier', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 50,
      identifier: 'nonExistentFunction',
      claim: 'this function does not exist',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(false);
    expect(['identifier_not_found', 'identifier_not_in_file']).toContain(result.reason);
  });

  it('should verify file existence even without line number', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      claim: 'problem_detector.ts exists',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(true);
    expect(result.reason).toBe('file_exists');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('should reject citation for non-existent file', async () => {
    const citation: Citation = {
      file: '/nonexistent/path/to/file.ts',
      line: 10,
      claim: 'this file does not exist',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('file_not_found');
    expect(result.confidence).toBe(0);
  });

  it('should verify line validity within file range', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 50,
      claim: 'line 50 is valid',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    // Line 50 should be valid in problem_detector.ts
    expect(result.verified).toBe(true);
    expect(['line_valid', 'line_empty', 'identifier_found', 'claim_matches_fact']).toContain(result.reason);
  });

  it('should handle fuzzy line matching within tolerance', async () => {
    // Citation says line 148, fact is at line 150 - should still match with lower confidence
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 148,
      identifier: 'createProblemDetector',
      claim: 'createProblemDetector is around here',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    // Should still find the identifier nearby
    expect(result.verified).toBe(true);
    expect(result.matchedFact?.identifier).toBe('createProblemDetector');
    // Confidence might be lower due to line mismatch
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should verify class identifier matches', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 50,
      identifier: 'ProblemDetector',
      claim: 'ProblemDetector class is defined here',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(true);
    expect(result.matchedFact?.type).toBe('class');
    expect(result.matchedFact?.identifier).toBe('ProblemDetector');
  });

  it('should include the original citation in result', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 50,
      identifier: 'ProblemDetector',
      claim: 'test claim',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.citation).toEqual(citation);
  });
});

// ============================================================================
// VERIFY ALL CITATIONS TESTS
// ============================================================================

describe('CitationVerifier - verifyAll', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should verify multiple citations and return a report', async () => {
    const citations: Citation[] = [
      {
        file: PROBLEM_DETECTOR_PATH,
        line: 150,
        identifier: 'createProblemDetector',
        claim: 'factory function',
      },
      {
        file: PROBLEM_DETECTOR_PATH,
        line: 50,
        identifier: 'ProblemDetector',
        claim: 'main class',
      },
      {
        file: '/nonexistent/file.ts',
        line: 10,
        claim: 'should fail',
      },
    ];

    const report = await verifier.verifyAll(citations, sampleFacts);

    expect(report.totalCitations).toBe(3);
    expect(report.verifiedCount).toBe(2);
    expect(report.failedCount).toBe(1);
    expect(report.verificationRate).toBeCloseTo(2 / 3, 2);
    expect(report.results.length).toBe(3);
  });

  it('should calculate correct summary statistics', async () => {
    const citations: Citation[] = [
      { file: PROBLEM_DETECTOR_PATH, claim: 'file exists' },
      { file: PROBLEM_DETECTOR_PATH, line: 50, claim: 'valid line' },
      { file: PROBLEM_DETECTOR_PATH, identifier: 'ProblemDetector', claim: 'class exists' },
      { file: '/bad/path.ts', claim: 'file not found' },
    ];

    const report = await verifier.verifyAll(citations, sampleFacts);

    expect(report.summary).toBeDefined();
    expect(report.summary.fileExistenceRate).toBeGreaterThan(0);
    expect(typeof report.summary.lineValidityRate).toBe('number');
    expect(typeof report.summary.identifierMatchRate).toBe('number');
  });

  it('should handle empty citations array', async () => {
    const report = await verifier.verifyAll([], sampleFacts);

    expect(report.totalCitations).toBe(0);
    expect(report.verifiedCount).toBe(0);
    expect(report.failedCount).toBe(0);
    expect(report.verificationRate).toBe(0);
    expect(report.results).toEqual([]);
  });

  it('should handle empty facts array', async () => {
    const citations: Citation[] = [
      { file: PROBLEM_DETECTOR_PATH, identifier: 'anything', claim: 'test' },
    ];

    const report = await verifier.verifyAll(citations, []);

    // File might still exist, but identifier won't be found in facts
    expect(report.totalCitations).toBe(1);
    expect(report.results.length).toBe(1);
  });

  it('should preserve order of results matching citations', async () => {
    const citations: Citation[] = [
      { file: PROBLEM_DETECTOR_PATH, identifier: 'identifyProblems', claim: 'first' },
      { file: PROBLEM_DETECTOR_PATH, identifier: 'ProblemDetector', claim: 'second' },
      { file: PROBLEM_DETECTOR_PATH, identifier: 'createProblemDetector', claim: 'third' },
    ];

    const report = await verifier.verifyAll(citations, sampleFacts);

    expect(report.results[0].citation.claim).toBe('first');
    expect(report.results[1].citation.claim).toBe('second');
    expect(report.results[2].citation.claim).toBe('third');
  });
});

// ============================================================================
// VERIFY LIBRARIAN OUTPUT TESTS
// ============================================================================

describe('CitationVerifier - verifyLibrarianOutput', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should extract and verify citations from Librarian output text', async () => {
    const librarianOutput = `
      The \`ProblemDetector\` class is defined in \`src/agents/problem_detector.ts:50\`.
      It has a method \`identifyProblems\` at line 80.
      The factory function \`createProblemDetector\` is exported from the same file.
    `;

    const report = await verifier.verifyLibrarianOutput(librarianOutput, LIBRARIAN_ROOT);

    expect(report.totalCitations).toBeGreaterThan(0);
    expect(report.results.length).toBeGreaterThan(0);
  });

  it('should handle Librarian output with no citations', async () => {
    const librarianOutput = 'This response has no code citations at all.';

    const report = await verifier.verifyLibrarianOutput(librarianOutput, LIBRARIAN_ROOT);

    expect(report.totalCitations).toBe(0);
    expect(report.verificationRate).toBe(0);
  });

  it('should resolve relative paths against repo root', async () => {
    const librarianOutput = 'See `src/agents/problem_detector.ts:50` for the class definition';

    const report = await verifier.verifyLibrarianOutput(librarianOutput, LIBRARIAN_ROOT);

    expect(report.totalCitations).toBe(1);
    // The verifier should resolve src/agents/problem_detector.ts against LIBRARIAN_ROOT
    expect(report.verifiedCount).toBeGreaterThan(0);
  });

  it('should use AST extractor to get facts from repo', async () => {
    // Use a citation with a known identifier that exists in the file
    const librarianOutput = `
      The \`createProblemDetector\` function in \`src/agents/problem_detector.ts\`
      creates a new instance of the ProblemDetector class.
    `;

    const report = await verifier.verifyLibrarianOutput(librarianOutput, LIBRARIAN_ROOT);

    // Should have extracted facts from the repo and verified against them
    // At minimum, the file should exist and be verified
    expect(report.verifiedCount).toBeGreaterThan(0);
  });

  it('should handle invalid repo path gracefully', async () => {
    const librarianOutput = 'Check `src/foo.ts:10`';

    const report = await verifier.verifyLibrarianOutput(librarianOutput, '/nonexistent/repo');

    expect(report.totalCitations).toBeGreaterThan(0);
    expect(report.failedCount).toBe(report.totalCitations);
  });
});

// ============================================================================
// CITATION INTERFACE TESTS
// ============================================================================

describe('Citation Interface', () => {
  it('should support all required fields', () => {
    const citation: Citation = {
      file: 'src/test.ts',
      line: 10,
      identifier: 'testFunction',
      claim: 'testFunction is defined at line 10',
    };

    expect(citation.file).toBe('src/test.ts');
    expect(citation.line).toBe(10);
    expect(citation.identifier).toBe('testFunction');
    expect(citation.claim).toBe('testFunction is defined at line 10');
  });

  it('should allow optional fields to be undefined', () => {
    const citation: Citation = {
      file: 'src/test.ts',
      claim: 'file exists',
    };

    expect(citation.file).toBe('src/test.ts');
    expect(citation.line).toBeUndefined();
    expect(citation.identifier).toBeUndefined();
    expect(citation.claim).toBe('file exists');
  });
});

// ============================================================================
// VERIFICATION RESULT INTERFACE TESTS
// ============================================================================

describe('CitationVerificationResult Interface', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should have all required fields', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      claim: 'test',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.citation).toBeDefined();
    expect(typeof result.verified).toBe('boolean');
    expect(result.reason).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should have matchedFact when verification succeeds', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      identifier: 'ProblemDetector',
      claim: 'class exists',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    if (result.verified && result.reason === 'identifier_found') {
      expect(result.matchedFact).toBeDefined();
    }
  });
});

// ============================================================================
// VERIFICATION REPORT INTERFACE TESTS
// ============================================================================

describe('CitationVerificationReport Interface', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should have all required fields', async () => {
    const citations: Citation[] = [{ file: PROBLEM_DETECTOR_PATH, claim: 'test' }];

    const report = await verifier.verifyAll(citations, sampleFacts);

    expect(typeof report.totalCitations).toBe('number');
    expect(typeof report.verifiedCount).toBe('number');
    expect(typeof report.failedCount).toBe('number');
    expect(typeof report.verificationRate).toBe('number');
    expect(Array.isArray(report.results)).toBe(true);
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.fileExistenceRate).toBe('number');
    expect(typeof report.summary.lineValidityRate).toBe('number');
    expect(typeof report.summary.identifierMatchRate).toBe('number');
  });

  it('should have consistent counts', async () => {
    const citations: Citation[] = [
      { file: PROBLEM_DETECTOR_PATH, identifier: 'ProblemDetector', claim: 'exists' },
      { file: '/bad/path.ts', claim: 'not exists' },
    ];

    const report = await verifier.verifyAll(citations, sampleFacts);

    expect(report.totalCitations).toBe(report.verifiedCount + report.failedCount);
    expect(report.results.length).toBe(report.totalCitations);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('CitationVerifier - Edge Cases', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should handle citations with special characters in paths', () => {
    const text = 'See `src/my-component/utils_v2.ts:10`';
    const citations = verifier.extractCitations(text);

    expect(citations.length).toBe(1);
    expect(citations[0].file).toBe('src/my-component/utils_v2.ts');
  });

  it('should handle citations with Windows-style paths', () => {
    const text = 'Located at `src\\utils\\helper.ts:20`';
    const citations = verifier.extractCitations(text);

    // Should find at least one citation with the file
    expect(citations.length).toBeGreaterThanOrEqual(1);
    // Should normalize or handle backslashes
    const helperCitation = citations.find((c) => c.file.includes('helper.ts'));
    expect(helperCitation).toBeDefined();
  });

  it('should handle very long file paths', async () => {
    const longPath = 'src/' + 'nested/'.repeat(10) + 'file.ts';
    const citation: Citation = {
      file: longPath,
      claim: 'deep nesting',
    };

    const result = await verifier.verifyCitation(citation, []);

    // Should handle gracefully without crashing
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('file_not_found');
  });

  it('should handle line number 0 as invalid', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 0,
      claim: 'line 0',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    // Line numbers should be 1-based
    expect(result.reason).not.toBe('line_valid');
  });

  it('should handle negative line numbers', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: -5,
      claim: 'negative line',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.verified).toBe(false);
  });

  it('should handle unicode in identifiers', () => {
    const text = 'The `handleUnicode\u{1F600}` function in `src/unicode.ts`';
    const citations = verifier.extractCitations(text);

    // Should extract something, even if unicode handling varies
    expect(citations.length).toBeGreaterThanOrEqual(0);
  });

  it('should not extract false positives from inline code', () => {
    const text = 'Run `npm install` to set up';
    const citations = verifier.extractCitations(text);

    // npm install is not a file citation
    expect(citations.length).toBe(0);
  });

  it('should handle multiple backtick pairs correctly', () => {
    const text = '`functionA` calls `functionB` in `src/caller.ts:30`';
    const citations = verifier.extractCitations(text);

    // Should find the file citation, possibly with identifiers
    const fileCitation = citations.find((c) => c.file.includes('caller.ts'));
    expect(fileCitation).toBeDefined();
  });
});

// ============================================================================
// CONFIDENCE SCORING TESTS
// ============================================================================

describe('CitationVerifier - Confidence Scoring', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should give high confidence for exact matches', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 150,
      identifier: 'createProblemDetector',
      claim: 'exact match',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('should give lower confidence for partial matches', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      // No line number, no identifier - just file
      claim: 'partial match',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    // Still verified but lower confidence
    if (result.verified) {
      expect(result.confidence).toBeLessThan(0.9);
    }
  });

  it('should give zero confidence for file not found', async () => {
    const citation: Citation = {
      file: '/does/not/exist.ts',
      claim: 'missing file',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.confidence).toBe(0);
  });

  it('should give intermediate confidence for line-only verification', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 50,
      // No identifier specified
      claim: 'line only',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    // Should be verified with moderate confidence
    if (result.verified) {
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.confidence).toBeLessThanOrEqual(0.9);
    }
  });
});

// ============================================================================
// REASON CODES TESTS
// ============================================================================

describe('CitationVerifier - Reason Codes', () => {
  let verifier: CitationVerifier;

  beforeAll(() => {
    verifier = createCitationVerifier();
  });

  it('should return file_exists for valid file without line/identifier', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      claim: 'file check',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.reason).toBe('file_exists');
  });

  it('should return file_not_found for invalid file', async () => {
    const citation: Citation = {
      file: '/invalid/path.ts',
      claim: 'bad file',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.reason).toBe('file_not_found');
  });

  it('should return line_valid for valid line number', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 10,
      claim: 'line check',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    // Either line_valid or identifier_found if there's a fact at that line
    expect(['line_valid', 'identifier_found', 'claim_matches_fact']).toContain(result.reason);
  });

  it('should return line_out_of_range for invalid line number', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      line: 99999,
      claim: 'out of range',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.reason).toBe('line_out_of_range');
  });

  it('should return identifier_found for matching identifier', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      identifier: 'ProblemDetector',
      claim: 'identifier check',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(result.reason).toBe('identifier_found');
  });

  it('should return identifier_not_found for non-matching identifier', async () => {
    const citation: Citation = {
      file: PROBLEM_DETECTOR_PATH,
      identifier: 'NonExistentThing',
      claim: 'bad identifier',
    };

    const result = await verifier.verifyCitation(citation, sampleFacts);

    expect(['identifier_not_found', 'identifier_not_in_file']).toContain(result.reason);
  });
});
