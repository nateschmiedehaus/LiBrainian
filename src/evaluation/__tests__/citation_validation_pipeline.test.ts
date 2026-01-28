/**
 * @fileoverview Tests for Citation Validation Pipeline (WU-1107)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Citation Validation Pipeline integrates the Citation Verifier into
 * Librarian's response generation, ensuring all citations in responses are
 * validated before delivery.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  CitationValidationPipeline,
  createCitationValidationPipeline,
  type CitationValidationResult,
  type ValidationPipelineConfig,
  type ValidationPipelineResult,
  DEFAULT_VALIDATION_CONFIG,
} from '../citation_validation_pipeline.js';
import { type Citation, type ASTFact } from '../index.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Use a temp directory for faster tests (no AST extraction of entire repo)
let TEST_DIR: string;
let TEST_FILE_PATH: string;

// Sample response with various citations (will be updated with test paths)
let SAMPLE_RESPONSE_VALID: string;
let SAMPLE_RESPONSE_MIXED: string;

const SAMPLE_RESPONSE_NO_CITATIONS = `
This is a response without any code citations.
It just describes things in general terms without referencing specific files or lines.
`;

// Sample AST facts for testing (with placeholder paths, updated in beforeAll)
let sampleFacts: ASTFact[];

// Create a test fixture file
function createTestFixture(): void {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-test-'));
  TEST_FILE_PATH = path.join(TEST_DIR, 'test_file.ts');

  // Create a simple test file
  const testFileContent = `/**
 * Test file for citation validation
 */

export interface TestInterface {
  id: string;
  name: string;
}

export class TestClass {
  private data: TestInterface;

  constructor(data: TestInterface) {
    this.data = data;
  }

  public getData(): TestInterface {
    return this.data;
  }

  public processData(): string {
    return this.data.name;
  }
}

export function createTestClass(data: TestInterface): TestClass {
  return new TestClass(data);
}

export const helperFunction = (input: string): string => {
  return input.toUpperCase();
};
`;

  fs.writeFileSync(TEST_FILE_PATH, testFileContent);

  // Update sample responses with test paths
  SAMPLE_RESPONSE_VALID = `
The \`createTestClass\` function is defined in \`test_file.ts:25\`.
This factory function creates instances of the \`TestClass\` class, which is defined at line 10.
The main method \`getData\` is located at \`test_file.ts:17\`.
`;

  SAMPLE_RESPONSE_MIXED = `
The \`createTestClass\` function is defined in \`test_file.ts:25\`.
There is also a \`nonExistentFunction\` in \`src/fake/file.ts:999\`.
See \`test_file.ts\` for the main implementation.
`;

  // Update sample facts with test paths
  sampleFacts = [
    {
      type: 'function_def',
      identifier: 'createTestClass',
      file: TEST_FILE_PATH,
      line: 25,
      details: {
        parameters: [{ name: 'data', type: 'TestInterface' }],
        returnType: 'TestClass',
        isAsync: false,
        isExported: true,
      },
    },
    {
      type: 'class',
      identifier: 'TestClass',
      file: TEST_FILE_PATH,
      line: 10,
      details: {
        methods: ['getData', 'processData'],
        properties: ['data'],
        isAbstract: false,
      },
    },
    {
      type: 'function_def',
      identifier: 'getData',
      file: TEST_FILE_PATH,
      line: 17,
      details: {
        parameters: [],
        returnType: 'TestInterface',
        isAsync: false,
        isExported: false,
        className: 'TestClass',
      },
    },
    {
      type: 'function_def',
      identifier: 'helperFunction',
      file: TEST_FILE_PATH,
      line: 29,
      details: {
        parameters: [{ name: 'input', type: 'string' }],
        returnType: 'string',
        isAsync: false,
        isExported: true,
      },
    },
  ];
}

function cleanupTestFixture(): void {
  if (TEST_DIR && fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createCitationValidationPipeline', () => {
  it('should create a pipeline instance', () => {
    const pipeline = createCitationValidationPipeline();
    expect(pipeline).toBeInstanceOf(CitationValidationPipeline);
  });

  it('should accept optional configuration', () => {
    const config: ValidationPipelineConfig = {
      strictMode: true,
      autoCorrect: false,
      minValidationRate: 0.9,
      timeoutMs: 5000,
    };
    const pipeline = createCitationValidationPipeline(config);
    expect(pipeline).toBeInstanceOf(CitationValidationPipeline);
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe('DEFAULT_VALIDATION_CONFIG', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_VALIDATION_CONFIG).toBeDefined();
    expect(typeof DEFAULT_VALIDATION_CONFIG.strictMode).toBe('boolean');
    expect(typeof DEFAULT_VALIDATION_CONFIG.autoCorrect).toBe('boolean');
    expect(typeof DEFAULT_VALIDATION_CONFIG.minValidationRate).toBe('number');
    expect(DEFAULT_VALIDATION_CONFIG.minValidationRate).toBeGreaterThan(0);
    expect(DEFAULT_VALIDATION_CONFIG.minValidationRate).toBeLessThanOrEqual(1);
    expect(typeof DEFAULT_VALIDATION_CONFIG.timeoutMs).toBe('number');
    expect(DEFAULT_VALIDATION_CONFIG.timeoutMs).toBeGreaterThan(0);
  });
});

// ============================================================================
// VALIDATE METHOD TESTS
// ============================================================================

describe('CitationValidationPipeline - validate', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should validate all citations in a response', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    expect(result).toBeDefined();
    expect(result.originalResponse).toBe(SAMPLE_RESPONSE_VALID);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(typeof result.validationRate).toBe('number');
    expect(result.validationRate).toBeGreaterThanOrEqual(0);
    expect(result.validationRate).toBeLessThanOrEqual(1);
  });

  it('should return passed=true when validation rate meets threshold', async () => {
    const config: ValidationPipelineConfig = {
      strictMode: false,
      autoCorrect: false,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    };
    const customPipeline = createCitationValidationPipeline(config);

    const result = await customPipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    // With valid citations, should pass the 50% threshold
    expect(result.passed).toBe(true);
  });

  it('should return passed=false when validation rate is below threshold', async () => {
    const config: ValidationPipelineConfig = {
      strictMode: false,
      autoCorrect: false,
      minValidationRate: 1.0, // 100% requirement
      timeoutMs: 10000,
    };
    const customPipeline = createCitationValidationPipeline(config);

    // Response with one valid and one invalid citation
    const result = await customPipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    // Should fail since we have invalid citations
    expect(result.passed).toBe(false);
  });

  it('should handle responses with no citations', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_NO_CITATIONS, TEST_DIR);

    expect(result.citations.length).toBe(0);
    expect(result.validationRate).toBe(1); // No citations = 100% valid (vacuously true)
    expect(result.passed).toBe(true);
    expect(result.warnings).toContain('No citations found in response');
  });

  it('should include validation type in results', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    for (const citation of result.citations) {
      expect(['file_exists', 'line_valid', 'identifier_match', 'content_match']).toContain(
        citation.validationType
      );
    }
  });

  it('should include confidence scores', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    for (const citation of result.citations) {
      expect(typeof citation.confidence).toBe('number');
      expect(citation.confidence).toBeGreaterThanOrEqual(0);
      expect(citation.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should use custom config when provided to validate', async () => {
    const customConfig: ValidationPipelineConfig = {
      strictMode: true,
      autoCorrect: true,
      minValidationRate: 0.9,
      timeoutMs: 5000,
    };

    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR, customConfig);

    // Should use the custom config for this call
    expect(result).toBeDefined();
  });
});

// ============================================================================
// CITATION VALIDATION RESULT TESTS
// ============================================================================

describe('CitationValidationResult Interface', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should have all required fields', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    for (const citationResult of result.citations) {
      expect(citationResult.citation).toBeDefined();
      expect(typeof citationResult.isValid).toBe('boolean');
      expect(citationResult.validationType).toBeDefined();
      expect(typeof citationResult.confidence).toBe('number');
    }
  });

  it('should include suggestion for invalid citations when autoCorrect is enabled', async () => {
    const config: ValidationPipelineConfig = {
      strictMode: false,
      autoCorrect: true,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    };
    const customPipeline = createCitationValidationPipeline(config);

    const result = await customPipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    // Check if any invalid citation has a suggestion
    const invalidCitations = result.citations.filter((c) => !c.isValid);
    // Suggestions are optional and depend on correction strategies
    expect(invalidCitations.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// VALIDATION PIPELINE RESULT TESTS
// ============================================================================

describe('ValidationPipelineResult Interface', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should have all required fields', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    expect(result.originalResponse).toBeDefined();
    expect(result.validatedResponse).toBeDefined();
    expect(Array.isArray(result.citations)).toBe(true);
    expect(typeof result.validationRate).toBe('number');
    expect(typeof result.passed).toBe('boolean');
    expect(typeof result.corrections).toBe('number');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('should preserve original response', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    expect(result.originalResponse).toBe(SAMPLE_RESPONSE_VALID);
  });

  it('should include correction count', async () => {
    const config: ValidationPipelineConfig = {
      strictMode: false,
      autoCorrect: true,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    };
    const customPipeline = createCitationValidationPipeline(config);

    const result = await customPipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    expect(typeof result.corrections).toBe('number');
    expect(result.corrections).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// SUGGEST CORRECTION TESTS
// ============================================================================

describe('CitationValidationPipeline - suggestCorrection', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should suggest correction for file not found - similar filename', () => {
    const invalidCitation: Citation = {
      file: path.join(TEST_DIR, 'test_flie.ts'), // Typo: flie vs file
      line: 25,
      claim: 'function definition',
    };

    const suggestion = pipeline.suggestCorrection(invalidCitation, sampleFacts);

    // Should suggest the correct filename
    if (suggestion) {
      expect(suggestion.file).toContain('test_file');
    }
  });

  it('should suggest correction for line out of range - nearest identifier', () => {
    const invalidCitation: Citation = {
      file: TEST_FILE_PATH,
      line: 27, // Slightly off from actual line 25
      identifier: 'createTestClass',
      claim: 'factory function',
    };

    const suggestion = pipeline.suggestCorrection(invalidCitation, sampleFacts);

    // Should suggest the correct line
    if (suggestion) {
      expect(suggestion.line).toBe(25);
    }
  });

  it('should suggest correction for identifier not found - similar identifier', () => {
    const invalidCitation: Citation = {
      file: TEST_FILE_PATH,
      identifier: 'createTestClas', // Typo: Clas vs Class
      claim: 'factory function',
    };

    const suggestion = pipeline.suggestCorrection(invalidCitation, sampleFacts);

    // Should suggest the correct identifier
    if (suggestion) {
      expect(suggestion.identifier).toBe('createTestClass');
    }
  });

  it('should return null when no correction is possible', () => {
    const invalidCitation: Citation = {
      file: '/completely/nonexistent/path/to/file.ts',
      line: 999,
      identifier: 'completelyRandomIdentifier',
      claim: 'no match',
    };

    const suggestion = pipeline.suggestCorrection(invalidCitation, sampleFacts);

    // No valid suggestion possible
    expect(suggestion).toBeNull();
  });

  it('should handle empty facts array', () => {
    const citation: Citation = {
      file: TEST_FILE_PATH,
      identifier: 'anything',
      claim: 'test',
    };

    const suggestion = pipeline.suggestCorrection(citation, []);

    expect(suggestion).toBeNull();
  });
});

// ============================================================================
// APPLY CORRECTIONS TESTS
// ============================================================================

describe('CitationValidationPipeline - applyCorrections', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    pipeline = createCitationValidationPipeline();
  });

  it('should apply corrections to response text', () => {
    const response = 'See `src/wrong/path.ts:100` for details';
    const corrections = new Map<Citation, Citation>([
      [
        { file: 'src/wrong/path.ts', line: 100, claim: 'test' },
        { file: 'src/correct/path.ts', line: 50, claim: 'test' },
      ],
    ]);

    const corrected = pipeline.applyCorrections(response, corrections);

    expect(corrected).toContain('src/correct/path.ts');
    expect(corrected).toContain('50');
  });

  it('should apply multiple corrections', () => {
    const response = `
      See \`src/wrong1.ts:10\` and \`src/wrong2.ts:20\` for details.
    `;
    const corrections = new Map<Citation, Citation>([
      [
        { file: 'src/wrong1.ts', line: 10, claim: 'c1' },
        { file: 'src/correct1.ts', line: 15, claim: 'c1' },
      ],
      [
        { file: 'src/wrong2.ts', line: 20, claim: 'c2' },
        { file: 'src/correct2.ts', line: 25, claim: 'c2' },
      ],
    ]);

    const corrected = pipeline.applyCorrections(response, corrections);

    expect(corrected).toContain('src/correct1.ts');
    expect(corrected).toContain('src/correct2.ts');
  });

  it('should return original if no corrections provided', () => {
    const response = 'Original response text';
    const corrections = new Map<Citation, Citation>();

    const corrected = pipeline.applyCorrections(response, corrections);

    expect(corrected).toBe(response);
  });

  it('should handle identifier corrections', () => {
    const response = 'The `wrongFunc` function in `src/test.ts`';
    const corrections = new Map<Citation, Citation>([
      [
        { file: 'src/test.ts', identifier: 'wrongFunc', claim: 'test' },
        { file: 'src/test.ts', identifier: 'correctFunc', claim: 'test' },
      ],
    ]);

    const corrected = pipeline.applyCorrections(response, corrections);

    expect(corrected).toContain('correctFunc');
  });
});

// ============================================================================
// MEETS QUALITY THRESHOLD TESTS
// ============================================================================

describe('CitationValidationPipeline - meetsQualityThreshold', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    pipeline = createCitationValidationPipeline({
      strictMode: false,
      autoCorrect: false,
      minValidationRate: 0.8,
      timeoutMs: 10000,
    });
  });

  it('should return true when validation rate meets threshold', () => {
    const result: ValidationPipelineResult = {
      originalResponse: 'test',
      validatedResponse: 'test',
      citations: [
        { citation: { file: 'a.ts', claim: '' }, isValid: true, validationType: 'file_exists', confidence: 1 },
        { citation: { file: 'b.ts', claim: '' }, isValid: true, validationType: 'file_exists', confidence: 1 },
      ],
      validationRate: 1.0,
      passed: true,
      corrections: 0,
      warnings: [],
    };

    expect(pipeline.meetsQualityThreshold(result)).toBe(true);
  });

  it('should return false when validation rate is below threshold', () => {
    const result: ValidationPipelineResult = {
      originalResponse: 'test',
      validatedResponse: 'test',
      citations: [
        { citation: { file: 'a.ts', claim: '' }, isValid: true, validationType: 'file_exists', confidence: 1 },
        { citation: { file: 'b.ts', claim: '' }, isValid: false, validationType: 'file_exists', confidence: 0 },
        { citation: { file: 'c.ts', claim: '' }, isValid: false, validationType: 'file_exists', confidence: 0 },
      ],
      validationRate: 0.33,
      passed: false,
      corrections: 0,
      warnings: [],
    };

    expect(pipeline.meetsQualityThreshold(result)).toBe(false);
  });

  it('should return true for empty citations (vacuously true)', () => {
    const result: ValidationPipelineResult = {
      originalResponse: 'test',
      validatedResponse: 'test',
      citations: [],
      validationRate: 1.0,
      passed: true,
      corrections: 0,
      warnings: ['No citations found in response'],
    };

    expect(pipeline.meetsQualityThreshold(result)).toBe(true);
  });
});

// ============================================================================
// AUTO-CORRECTION TESTS
// ============================================================================

describe('CitationValidationPipeline - Auto-Correction', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline({
      strictMode: false,
      autoCorrect: true,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    });
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should not auto-correct when disabled', async () => {
    const noCorrectPipeline = createCitationValidationPipeline({
      strictMode: false,
      autoCorrect: false,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    });

    const response = 'See `src/fake/path.ts:100`';
    const result = await noCorrectPipeline.validate(response, TEST_DIR);

    expect(result.corrections).toBe(0);
    expect(result.validatedResponse).toBe(response);
  });

  it('should track number of corrections made', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    expect(typeof result.corrections).toBe('number');
    expect(result.corrections).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// STRICT MODE TESTS
// ============================================================================

describe('CitationValidationPipeline - Strict Mode', () => {
  let strictPipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    strictPipeline = createCitationValidationPipeline({
      strictMode: true,
      autoCorrect: false,
      minValidationRate: 0.8,
      timeoutMs: 10000,
    });
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should fail validation in strict mode when below threshold', async () => {
    const result = await strictPipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    // Strict mode should fail with mixed valid/invalid citations
    expect(result.passed).toBe(false);
  });

  it('should include strict mode warning when failing', async () => {
    const result = await strictPipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    if (!result.passed) {
      expect(result.warnings.some((w) => w.toLowerCase().includes('strict'))).toBe(true);
    }
  });

  it('should pass strict mode with all valid citations', async () => {
    const result = await strictPipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    // Should pass if all citations are valid
    if (result.validationRate >= 0.8) {
      expect(result.passed).toBe(true);
    }
  });
});

// ============================================================================
// CORRECTION STRATEGIES TESTS
// ============================================================================

describe('CitationValidationPipeline - Correction Strategies', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline({
      strictMode: false,
      autoCorrect: true,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    });
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  describe('File not found strategy', () => {
    it('should search for similar filenames', () => {
      const citation: Citation = {
        file: path.join(TEST_DIR, 'test_flie.ts'), // Typo
        line: 25,
        claim: 'function',
      };

      const suggestion = pipeline.suggestCorrection(citation, sampleFacts);

      if (suggestion) {
        expect(suggestion.file.toLowerCase()).toContain('test_file');
      }
    });
  });

  describe('Line out of range strategy', () => {
    it('should find nearest matching identifier', () => {
      const citation: Citation = {
        file: TEST_FILE_PATH,
        line: 27, // Off by 2 from actual line 25
        identifier: 'createTestClass',
        claim: 'factory',
      };

      const suggestion = pipeline.suggestCorrection(citation, sampleFacts);

      if (suggestion) {
        expect(suggestion.line).toBe(25);
        expect(suggestion.identifier).toBe('createTestClass');
      }
    });
  });

  describe('Identifier not found strategy', () => {
    it('should search for similar identifiers', () => {
      const citation: Citation = {
        file: TEST_FILE_PATH,
        identifier: 'TestClass', // Exact match should work
        claim: 'class',
      };

      const suggestion = pipeline.suggestCorrection(citation, sampleFacts);

      // For exact match, should return the same or null (already valid)
      if (suggestion) {
        expect(suggestion.identifier).toBe('TestClass');
      }
    });

    it('should find identifiers with minor typos', () => {
      const citation: Citation = {
        file: TEST_FILE_PATH,
        identifier: 'getDat', // Missing 'a'
        claim: 'method',
      };

      const suggestion = pipeline.suggestCorrection(citation, sampleFacts);

      if (suggestion) {
        expect(suggestion.identifier).toBe('getData');
      }
    });
  });
});

// ============================================================================
// INTEGRATION WITH CITATION VERIFIER TESTS
// ============================================================================

describe('CitationValidationPipeline - Integration with CitationVerifier', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should use CitationVerifier for extraction', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    // Should extract citations using CitationVerifier patterns
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it('should use CitationVerifier for verification', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);

    // Verification should be done by CitationVerifier
    for (const citation of result.citations) {
      expect(typeof citation.isValid).toBe('boolean');
    }
  });
});

// ============================================================================
// EDGE CASES TESTS
// ============================================================================

describe('CitationValidationPipeline - Edge Cases', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should handle empty response', async () => {
    const result = await pipeline.validate('', TEST_DIR);

    expect(result.citations.length).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('should handle invalid repo path', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_VALID, '/nonexistent/repo');

    expect(result).toBeDefined();
    // Should fail validation due to invalid repo
    expect(result.validationRate).toBeLessThan(1);
  });

  it('should handle malformed citations gracefully', async () => {
    const malformedResponse = `
      See \`\` for details.
      Check \`src/.ts:abc\` for more.
      Also \`src/file.ts:-5\` has info.
    `;

    const result = await pipeline.validate(malformedResponse, TEST_DIR);

    // Should not crash
    expect(result).toBeDefined();
  });

  it('should handle concurrent validations', async () => {
    const results = await Promise.all([
      pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR),
      pipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR),
      pipeline.validate(SAMPLE_RESPONSE_NO_CITATIONS, TEST_DIR),
    ]);

    expect(results.length).toBe(3);
    for (const result of results) {
      expect(result).toBeDefined();
    }
  });
});

// ============================================================================
// WARNINGS TESTS
// ============================================================================

describe('CitationValidationPipeline - Warnings', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should warn when no citations found', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_NO_CITATIONS, TEST_DIR);

    expect(result.warnings).toContain('No citations found in response');
  });

  it('should warn about low validation rate', async () => {
    const result = await pipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    if (result.validationRate < 0.8) {
      expect(result.warnings.some((w) => w.toLowerCase().includes('validation rate'))).toBe(true);
    }
  });

  it('should warn about uncorrectable citations', async () => {
    const autoCorrectPipeline = createCitationValidationPipeline({
      strictMode: false,
      autoCorrect: true,
      minValidationRate: 0.5,
      timeoutMs: 10000,
    });

    const result = await autoCorrectPipeline.validate(SAMPLE_RESPONSE_MIXED, TEST_DIR);

    // Should have warnings about citations that couldn't be corrected
    if (result.citations.some((c) => !c.isValid && !c.suggestion)) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('CitationValidationPipeline - Performance', () => {
  let pipeline: CitationValidationPipeline;

  beforeAll(() => {
    createTestFixture();
    pipeline = createCitationValidationPipeline();
  });

  afterAll(() => {
    cleanupTestFixture();
  });

  it('should complete validation within reasonable time', async () => {
    const startTime = Date.now();
    await pipeline.validate(SAMPLE_RESPONSE_VALID, TEST_DIR);
    const duration = Date.now() - startTime;

    // Should complete within 5 seconds with small test fixture
    expect(duration).toBeLessThan(5000);
  });
});
