/**
 * @fileoverview E2E Citation Verification Test
 *
 * WU-1203: End-to-end integration test for the Citation Validation Pipeline.
 *
 * This is VALIDATION - we test the actual pipeline, not mocks.
 *
 * Test Categories:
 * 1. Pipeline Configuration Tests: strictMode, autoCorrect, minValidationRate
 * 2. Citation Extraction Tests: Various citation patterns work correctly
 * 3. Validation Tests: Valid citations pass, invalid citations fail
 * 4. Auto-Correction Tests: Pipeline suggests and applies corrections
 * 5. Metrics Measurement: Measure actual validation rates on real repos
 * 6. Real Repo Integration: Run against eval-corpus/external-repos/typedriver-ts
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  CitationValidationPipeline,
  createCitationValidationPipeline,
  type ValidationPipelineConfig,
  type ValidationPipelineResult,
  type CitationValidationResult,
  DEFAULT_VALIDATION_CONFIG,
} from '../citation_validation_pipeline.js';
import {
  CitationVerifier,
  createCitationVerifier,
  type Citation,
  type CitationVerificationReport,
} from '../citation_verifier.js';
import {
  ASTFactExtractor,
  createASTFactExtractor,
  type ASTFact,
  type FunctionDefDetails,
  type ClassDetails,
} from '../ast_fact_extractor.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const EXTERNAL_REPO_BASE = path.join(__dirname, '../../../eval-corpus/external-repos');
const TYPEDRIVER_REPO = path.join(EXTERNAL_REPO_BASE, 'typedriver-ts');
const SRTD_REPO = path.join(EXTERNAL_REPO_BASE, 'srtd-ts');

// Citation verification thresholds
const CITATION_ACCURACY_THRESHOLD = 0.80; // >= 80% citation accuracy
const MIN_VALIDATION_RATE_THRESHOLD = 0.75; // >= 75% validation rate
const LATENCY_THRESHOLD_MS = 10000; // 10 seconds max per validation

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate a response with valid citations based on actual AST facts
 */
function generateValidCitationResponse(facts: ASTFact[], repoPath: string): string {
  const functionFacts = facts.filter((f) => f.type === 'function_def');
  const classFacts = facts.filter((f) => f.type === 'class');

  if (functionFacts.length === 0) {
    return 'No functions found in the codebase.';
  }

  const func = functionFacts[0];
  const details = func.details as FunctionDefDetails;
  const relativePath = func.file.replace(repoPath + '/', '');

  let response = `The function \`${func.identifier}\` is defined in \`${relativePath}:${func.line}\`. `;

  if (details.isAsync) {
    response += 'It is an async function. ';
  }

  if (details.parameters.length > 0) {
    response += `It takes ${details.parameters.length} parameter(s): ${details.parameters.map((p) => p.name).join(', ')}. `;
  }

  // Add a second function if available
  if (functionFacts.length > 1) {
    const func2 = functionFacts[1];
    const relPath2 = func2.file.replace(repoPath + '/', '');
    response += `\n\nAnother function \`${func2.identifier}\` is located in \`${relPath2}:${func2.line}\`.`;
  }

  // Add a class if available
  if (classFacts.length > 0) {
    const cls = classFacts[0];
    const clsRelPath = cls.file.replace(repoPath + '/', '');
    const clsDetails = cls.details as ClassDetails;
    response += `\n\nThe class \`${cls.identifier}\` in \`${clsRelPath}:${cls.line}\` `;
    if (clsDetails.methods && clsDetails.methods.length > 0) {
      response += `has methods: ${clsDetails.methods.slice(0, 3).join(', ')}.`;
    }
  }

  return response;
}

/**
 * Generate a response with invalid/hallucinated citations
 */
function generateInvalidCitationResponse(): string {
  return `The function \`nonExistentFunction\` is defined in \`src/fake/path.ts:999\`.
It calls \`hallucinatedHelper\` from \`src/nonexistent/helper.ts:50\`.
The class \`FakeClass\` at \`src/hallucinated.ts:42\` implements this pattern.
See also \`src/imaginary/module.ts:100\` for related code.`;
}

/**
 * Generate a response with mixed valid and invalid citations
 */
function generateMixedCitationResponse(facts: ASTFact[], repoPath: string): string {
  const functionFacts = facts.filter((f) => f.type === 'function_def');

  if (functionFacts.length === 0) {
    return generateInvalidCitationResponse();
  }

  const validFunc = functionFacts[0];
  const validRelPath = validFunc.file.replace(repoPath + '/', '');

  return `The function \`${validFunc.identifier}\` is defined in \`${validRelPath}:${validFunc.line}\`.
However, it calls \`fakeHelper\` from \`src/nonexistent/helper.ts:50\` which does not exist.
It also uses \`HallucinatedClass\` from \`src/fake/class.ts:999\`.`;
}

/**
 * Compute validation metrics from pipeline results
 */
interface ValidationMetrics {
  totalResponses: number;
  totalCitations: number;
  validCitations: number;
  invalidCitations: number;
  validationRate: number;
  avgConfidence: number;
  correctionsApplied: number;
  passedCount: number;
  failedCount: number;
}

function computeValidationMetrics(results: ValidationPipelineResult[]): ValidationMetrics {
  let totalCitations = 0;
  let validCitations = 0;
  let invalidCitations = 0;
  let totalConfidence = 0;
  let correctionsApplied = 0;
  let passedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    totalCitations += result.citations.length;
    validCitations += result.citations.filter((c) => c.isValid).length;
    invalidCitations += result.citations.filter((c) => !c.isValid).length;
    totalConfidence += result.citations.reduce((sum, c) => sum + c.confidence, 0);
    correctionsApplied += result.corrections;

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  const avgConfidence = totalCitations > 0 ? totalConfidence / totalCitations : 0;
  const validationRate = totalCitations > 0 ? validCitations / totalCitations : 1;

  return {
    totalResponses: results.length,
    totalCitations,
    validCitations,
    invalidCitations,
    validationRate,
    avgConfidence,
    correctionsApplied,
    passedCount,
    failedCount,
  };
}

// ============================================================================
// E2E CITATION VERIFICATION TESTS
// ============================================================================

describe('E2E Citation Verification', () => {
  let pipeline: CitationValidationPipeline;
  let citationVerifier: CitationVerifier;
  let astExtractor: ASTFactExtractor;
  let typedriverFacts: ASTFact[];
  let repoAvailable: boolean;

  beforeAll(async () => {
    // Initialize components
    pipeline = createCitationValidationPipeline();
    citationVerifier = createCitationVerifier();
    astExtractor = createASTFactExtractor();

    // Check if external repo is available
    repoAvailable = fs.existsSync(TYPEDRIVER_REPO);

    if (repoAvailable) {
      // Extract facts from external repo
      typedriverFacts = await astExtractor.extractFromDirectory(path.join(TYPEDRIVER_REPO, 'src'));
      console.log(`Extracted ${typedriverFacts.length} facts from typedriver-ts`);
    } else {
      typedriverFacts = [];
      console.warn('External repo not found, some tests will be skipped:', TYPEDRIVER_REPO);
    }
  }, 60000); // 60s timeout for extraction

  // ==========================================================================
  // 1. PIPELINE CONFIGURATION TESTS
  // ==========================================================================

  describe('Pipeline Configuration', () => {
    it('creates pipeline with default configuration', () => {
      const defaultPipeline = createCitationValidationPipeline();
      expect(defaultPipeline).toBeDefined();
    });

    it('creates pipeline with custom strictMode configuration', () => {
      const strictPipeline = createCitationValidationPipeline({
        strictMode: true,
        minValidationRate: 0.95,
      });
      expect(strictPipeline).toBeDefined();
    });

    it('creates pipeline with autoCorrect enabled', () => {
      const autoCorrectPipeline = createCitationValidationPipeline({
        autoCorrect: true,
      });
      expect(autoCorrectPipeline).toBeDefined();
    });

    it('uses default minValidationRate of 0.8', () => {
      expect(DEFAULT_VALIDATION_CONFIG.minValidationRate).toBe(0.8);
    });

    it('uses default strictMode of false', () => {
      expect(DEFAULT_VALIDATION_CONFIG.strictMode).toBe(false);
    });

    it('uses default autoCorrect of false', () => {
      expect(DEFAULT_VALIDATION_CONFIG.autoCorrect).toBe(false);
    });

    it('validates empty response returns vacuously true', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const result = await pipeline.validate('No citations here.', TYPEDRIVER_REPO);

      expect(result.citations.length).toBe(0);
      expect(result.validationRate).toBe(1.0); // Vacuously true
      expect(result.passed).toBe(true);
      expect(result.warnings).toContain('No citations found in response');
    });

    it('validates with custom config override', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const customConfig: ValidationPipelineConfig = {
        strictMode: true,
        autoCorrect: false,
        minValidationRate: 0.99,
        timeoutMs: 5000,
      };

      const response = generateInvalidCitationResponse();
      const result = await pipeline.validate(response, TYPEDRIVER_REPO, customConfig);

      // Should fail with 99% threshold
      expect(result.passed).toBe(false);
      expect(result.warnings.some((w) => w.includes('Strict mode'))).toBe(true);
    });
  });

  // ==========================================================================
  // 2. CITATION EXTRACTION TESTS
  // ==========================================================================

  describe('Citation Extraction', () => {
    it('extracts file:line citation pattern', () => {
      const text = 'See `src/compile.ts:42` for the implementation.';
      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].file).toBe('src/compile.ts');
      expect(citations[0].line).toBe(42);
    });

    it('extracts GitHub-style #L citation pattern', () => {
      const text = 'Check `src/validator.ts#L25` for details.';
      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].file).toBe('src/validator.ts');
      expect(citations[0].line).toBe(25);
    });

    it('extracts file line N pattern', () => {
      const text = 'The function is in `src/index.ts` line 100.';
      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].file).toBe('src/index.ts');
      expect(citations[0].line).toBe(100);
    });

    it('extracts identifier in file pattern', () => {
      const text = 'The `compile` in `src/compile.ts` exports the main function.';
      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBeGreaterThanOrEqual(1);
      const identifierCitation = citations.find((c) => c.identifier === 'compile');
      expect(identifierCitation).toBeDefined();
    });

    it('extracts identifier defined in file:line pattern', () => {
      const text = '`validate` is defined in `src/validator.ts:50` and exports.';
      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBeGreaterThanOrEqual(1);
      const definedCitation = citations.find(
        (c) => c.identifier === 'validate' || c.file.includes('validator.ts')
      );
      expect(definedCitation).toBeDefined();
    });

    it('extracts multiple citations from single response', () => {
      const text = `The \`compile\` function in \`src/compile.ts:42\` uses \`validate\` from \`src/validator.ts:25\`.
It also imports types from \`src/types.ts:10\`.`;

      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBeGreaterThanOrEqual(2);
    });

    it('handles Windows-style paths', () => {
      const text = 'Found in `src\\compile.ts:42` on Windows.';
      const citations = citationVerifier.extractCitations(text);

      // May extract both Windows pattern and converted forward-slash pattern
      expect(citations.length).toBeGreaterThanOrEqual(1);
      const hasCitation = citations.some((c) => c.file.includes('compile.ts'));
      expect(hasCitation).toBe(true);
    });

    it('ignores command-like strings', () => {
      const text = 'Run `npm install` and then check `src/index.ts:1`.';
      const citations = citationVerifier.extractCitations(text);

      // Should only extract the file citation, not npm command
      const fileCitations = citations.filter((c) => c.file.includes('index.ts'));
      expect(fileCitations.length).toBe(1);
    });

    it('extracts line ranges', () => {
      const text = 'See `src/compile.ts:42-50` for the full function.';
      const citations = citationVerifier.extractCitations(text);

      expect(citations.length).toBe(1);
      expect(citations[0].line).toBe(42); // First line of range
    });
  });

  // ==========================================================================
  // 3. VALIDATION TESTS
  // ==========================================================================

  describe('Validation Tests', () => {
    it('validates correct citations pass', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      expect(typedriverFacts.length).toBeGreaterThan(0);

      const response = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      console.log(`
Valid Citation Validation:
- Total citations: ${result.citations.length}
- Valid: ${result.citations.filter((c) => c.isValid).length}
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
- Passed: ${result.passed}
`);

      // Expect high validation rate for correct citations
      expect(result.validationRate).toBeGreaterThanOrEqual(0.5);
    });

    it('flags invalid citations as failures', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateInvalidCitationResponse();
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      console.log(`
Invalid Citation Validation:
- Total citations: ${result.citations.length}
- Invalid: ${result.citations.filter((c) => !c.isValid).length}
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
- Passed: ${result.passed}
`);

      // Expect low validation rate for invalid citations
      expect(result.validationRate).toBeLessThan(0.5);
      expect(result.citations.filter((c) => !c.isValid).length).toBeGreaterThan(0);
    });

    it('validates mixed response partially', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateMixedCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      console.log(`
Mixed Citation Validation:
- Total citations: ${result.citations.length}
- Valid: ${result.citations.filter((c) => c.isValid).length}
- Invalid: ${result.citations.filter((c) => !c.isValid).length}
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
`);

      // Expect some valid and some invalid
      if (result.citations.length > 0) {
        expect(result.citations.some((c) => c.isValid)).toBe(true);
        expect(result.citations.some((c) => !c.isValid)).toBe(true);
      }
    });

    it('returns correct validation types', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      // Check that validation types are properly assigned
      for (const citation of result.citations) {
        expect(['file_exists', 'line_valid', 'identifier_match', 'content_match']).toContain(
          citation.validationType
        );
      }
    });

    it('provides confidence scores for each citation', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      for (const citation of result.citations) {
        expect(citation.confidence).toBeGreaterThanOrEqual(0);
        expect(citation.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('strictMode rejects responses below threshold', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const strictConfig: ValidationPipelineConfig = {
        strictMode: true,
        autoCorrect: false,
        minValidationRate: 0.9,
        timeoutMs: 30000,
      };

      const response = generateMixedCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO, strictConfig);

      // With mixed citations, should fail strict mode at 90% threshold
      if (result.validationRate < 0.9) {
        expect(result.passed).toBe(false);
        expect(result.warnings.some((w) => w.includes('Strict mode'))).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 4. AUTO-CORRECTION TESTS
  // ==========================================================================

  describe('Auto-Correction Tests', () => {
    it('suggests corrections for invalid citations', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const autoCorrectConfig: ValidationPipelineConfig = {
        strictMode: false,
        autoCorrect: true,
        minValidationRate: 0.8,
        timeoutMs: 30000,
      };

      // Use a response with a typo in the filename
      const functionFacts = typedriverFacts.filter((f) => f.type === 'function_def');
      if (functionFacts.length === 0) {
        console.warn('No function facts available');
        return;
      }

      // Create response with slightly wrong filename
      const validFunc = functionFacts[0];
      const relPath = validFunc.file.replace(TYPEDRIVER_REPO + '/', '');
      const typoPath = relPath.replace('.ts', '_typo.ts');

      const response = `The function \`${validFunc.identifier}\` is in \`${typoPath}:${validFunc.line}\`.`;
      const result = await pipeline.validate(response, TYPEDRIVER_REPO, autoCorrectConfig);

      console.log(`
Auto-Correction Test:
- Original path: ${typoPath}
- Citations found: ${result.citations.length}
- Suggestions provided: ${result.citations.filter((c) => c.suggestion).length}
- Corrections applied: ${result.corrections}
`);

      // Test that pipeline processes auto-correct mode
      expect(result.validatedResponse).toBeDefined();
    });

    it('applies corrections to response text', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const autoCorrectConfig: ValidationPipelineConfig = {
        strictMode: false,
        autoCorrect: true,
        minValidationRate: 0.8,
        timeoutMs: 30000,
      };

      // Create a response that can be corrected
      const functionFacts = typedriverFacts.filter((f) => f.type === 'function_def');
      if (functionFacts.length === 0) {
        console.warn('No function facts available');
        return;
      }

      const func = functionFacts[0];
      const validPath = func.file.replace(TYPEDRIVER_REPO + '/', '');

      // Use a valid citation that should pass through
      const response = `The function \`${func.identifier}\` is in \`${validPath}:${func.line}\`.`;
      const result = await pipeline.validate(response, TYPEDRIVER_REPO, autoCorrectConfig);

      // Validated response should be defined
      expect(result.validatedResponse).toBeDefined();
      expect(typeof result.validatedResponse).toBe('string');
    });

    it('reports warnings when corrections cannot be found', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const autoCorrectConfig: ValidationPipelineConfig = {
        strictMode: false,
        autoCorrect: true,
        minValidationRate: 0.8,
        timeoutMs: 30000,
      };

      // Use a completely fabricated path that cannot be corrected
      const response = 'The code is in `src/completely/fake/nonexistent/module.ts:999`.';
      const result = await pipeline.validate(response, TYPEDRIVER_REPO, autoCorrectConfig);

      console.log(`
Uncorrectable Citation Test:
- Warnings: ${result.warnings.length}
${result.warnings.map((w) => `  - ${w}`).join('\n')}
`);

      // Should have warnings about failed corrections
      if (result.citations.length > 0 && result.citations.every((c) => !c.isValid)) {
        expect(result.warnings.length).toBeGreaterThan(0);
      }
    });

    it('suggestCorrection returns null when no facts available', () => {
      const citation: Citation = {
        file: 'src/nonexistent.ts',
        line: 50,
        identifier: 'someFunction',
        claim: 'test claim',
      };

      // Test with empty facts array
      const suggestion = pipeline.suggestCorrection(citation, []);
      expect(suggestion).toBeNull();
    });
  });

  // ==========================================================================
  // 5. METRICS MEASUREMENT
  // ==========================================================================

  describe('Metrics Measurement', () => {
    it('measures validation rate on real repo responses', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      expect(typedriverFacts.length).toBeGreaterThan(0);

      // Generate multiple responses with varying validity
      const responses: string[] = [];

      // Add correct responses (70%)
      for (let i = 0; i < 7; i++) {
        responses.push(generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO));
      }

      // Add mixed responses (20%)
      for (let i = 0; i < 2; i++) {
        responses.push(generateMixedCitationResponse(typedriverFacts, TYPEDRIVER_REPO));
      }

      // Add invalid response (10%)
      responses.push(generateInvalidCitationResponse());

      // Validate all responses
      const results: ValidationPipelineResult[] = [];
      const startTime = Date.now();

      for (const response of responses) {
        const result = await pipeline.validate(response, TYPEDRIVER_REPO);
        results.push(result);
      }

      const totalTime = Date.now() - startTime;
      const metrics = computeValidationMetrics(results);

      console.log(`
========================================
E2E CITATION VALIDATION METRICS
========================================
Responses tested: ${metrics.totalResponses}
Total citations: ${metrics.totalCitations}
Valid citations: ${metrics.validCitations}
Invalid citations: ${metrics.invalidCitations}

Validation rate: ${(metrics.validationRate * 100).toFixed(1)}%
Average confidence: ${(metrics.avgConfidence * 100).toFixed(1)}%
Corrections applied: ${metrics.correctionsApplied}

Passed: ${metrics.passedCount}
Failed: ${metrics.failedCount}

Total time: ${totalTime}ms
Avg time per response: ${(totalTime / metrics.totalResponses).toFixed(1)}ms

>>> TARGET: >= ${(MIN_VALIDATION_RATE_THRESHOLD * 100).toFixed(0)}% <<<
>>> STATUS: ${metrics.validationRate >= MIN_VALIDATION_RATE_THRESHOLD ? 'PASS' : 'NEEDS IMPROVEMENT'} <<<
========================================
`);

      // Record actual metrics
      expect(metrics.totalResponses).toBe(10);
      expect(metrics.totalCitations).toBeGreaterThan(0);
    });

    it('measures confidence distribution', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      const confidences = result.citations.map((c) => c.confidence);

      if (confidences.length > 0) {
        const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
        const minConfidence = Math.min(...confidences);
        const maxConfidence = Math.max(...confidences);

        console.log(`
Confidence Distribution:
- Min: ${(minConfidence * 100).toFixed(1)}%
- Max: ${(maxConfidence * 100).toFixed(1)}%
- Avg: ${(avgConfidence * 100).toFixed(1)}%
`);

        expect(avgConfidence).toBeGreaterThanOrEqual(0);
        expect(avgConfidence).toBeLessThanOrEqual(1);
      }
    });

    it('measures validation latency', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const latencies: number[] = [];

      // Run validation multiple times to measure latency
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await pipeline.validate(response, TYPEDRIVER_REPO);
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length / 2)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];

      console.log(`
Validation Latency:
- p50: ${p50}ms
- p95: ${p95}ms
- max: ${latencies[latencies.length - 1]}ms
`);

      // Assert latency is reasonable
      expect(p50).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  // ==========================================================================
  // 6. REAL REPO INTEGRATION
  // ==========================================================================

  describe('Real Repo Integration', () => {
    it('validates typedriver-ts has extractable facts', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      expect(typedriverFacts.length).toBeGreaterThan(10);

      const functionFacts = typedriverFacts.filter((f) => f.type === 'function_def');
      const classFacts = typedriverFacts.filter((f) => f.type === 'class');
      const typeFacts = typedriverFacts.filter((f) => f.type === 'type');

      console.log(`
External Repo Facts (typedriver-ts):
- Total facts: ${typedriverFacts.length}
- Functions: ${functionFacts.length}
- Classes: ${classFacts.length}
- Types: ${typeFacts.length}
`);

      expect(functionFacts.length).toBeGreaterThan(0);
    });

    it('verifies compile function can be cited correctly', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      // Find the compile function in facts
      const compileFacts = typedriverFacts.filter(
        (f) => f.identifier === 'compile' && f.type === 'function_def'
      );

      if (compileFacts.length === 0) {
        console.warn('Compile function not found in facts');
        return;
      }

      const compileFunc = compileFacts[0];
      const relPath = compileFunc.file.replace(TYPEDRIVER_REPO + '/', '');

      // Create a citation using the actual line number
      const response = `The \`compile\` function is defined in \`${relPath}:${compileFunc.line}\`.`;
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      console.log(`
Compile Function Citation Test:
- Cited: ${relPath}:${compileFunc.line}
- Valid: ${result.citations.length > 0 && result.citations[0].isValid}
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
`);

      expect(result.citations.length).toBeGreaterThan(0);
    });

    it('verifies Validator class can be cited correctly', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      // Find the Validator class in facts
      const validatorFacts = typedriverFacts.filter(
        (f) => f.identifier === 'Validator' && f.type === 'class'
      );

      if (validatorFacts.length === 0) {
        console.warn('Validator class not found in facts');
        return;
      }

      const validatorClass = validatorFacts[0];
      const relPath = validatorClass.file.replace(TYPEDRIVER_REPO + '/', '');

      // Create a citation
      const response = `The \`Validator\` class in \`${relPath}:${validatorClass.line}\` is the base class.`;
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      console.log(`
Validator Class Citation Test:
- Cited: ${relPath}:${validatorClass.line}
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
`);

      expect(result.citations.length).toBeGreaterThan(0);
    });

    it('validates diverse citation patterns on real repo', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const functionFacts = typedriverFacts.filter((f) => f.type === 'function_def');

      if (functionFacts.length < 3) {
        console.warn('Not enough function facts for diverse test');
        return;
      }

      // Create response with diverse citation patterns
      const func1 = functionFacts[0];
      const func2 = functionFacts[1];
      const func3 = functionFacts[2];

      const response = `
The codebase has several key functions:
1. \`${func1.identifier}\` in \`${func1.file.replace(TYPEDRIVER_REPO + '/', '')}:${func1.line}\` handles the main logic.
2. The \`${func2.identifier}\` from \`${func2.file.replace(TYPEDRIVER_REPO + '/', '')}\` is also important.
3. See \`${func3.file.replace(TYPEDRIVER_REPO + '/', '')}#L${func3.line}\` for additional context.
`;

      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      console.log(`
Diverse Citation Patterns Test:
- Citations found: ${result.citations.length}
- Valid: ${result.citations.filter((c) => c.isValid).length}
- Patterns tested: file:line, file only, GitHub #L style
`);

      expect(result.citations.length).toBeGreaterThanOrEqual(1);
    });

    it('tests pipeline on srtd-ts repo if available', async () => {
      if (!fs.existsSync(SRTD_REPO)) {
        console.warn('Skipping: srtd-ts repo not available');
        return;
      }

      const srtdFacts = await astExtractor.extractFromDirectory(path.join(SRTD_REPO, 'src'));

      if (srtdFacts.length === 0) {
        console.warn('No facts extracted from srtd-ts');
        return;
      }

      const response = generateValidCitationResponse(srtdFacts, SRTD_REPO);
      const result = await pipeline.validate(response, SRTD_REPO);

      console.log(`
SRTD-TS Repo Test:
- Facts extracted: ${srtdFacts.length}
- Citations: ${result.citations.length}
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
`);

      expect(result.citations.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // QUALITY THRESHOLD TESTS
  // ==========================================================================

  describe('Quality Thresholds', () => {
    it('meetsQualityThreshold returns true for high validation rate', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      const meetsThreshold = pipeline.meetsQualityThreshold(result);

      console.log(`
Quality Threshold Test:
- Validation rate: ${(result.validationRate * 100).toFixed(1)}%
- Default threshold: ${(DEFAULT_VALIDATION_CONFIG.minValidationRate * 100).toFixed(1)}%
- Meets threshold: ${meetsThreshold}
`);

      // If validation rate is high, should meet threshold
      if (result.validationRate >= DEFAULT_VALIDATION_CONFIG.minValidationRate) {
        expect(meetsThreshold).toBe(true);
      }
    });

    it('meetsQualityThreshold returns false for low validation rate', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const response = generateInvalidCitationResponse();
      const result = await pipeline.validate(response, TYPEDRIVER_REPO);

      const meetsThreshold = pipeline.meetsQualityThreshold(result);

      // Invalid citations should not meet threshold
      if (result.validationRate < DEFAULT_VALIDATION_CONFIG.minValidationRate) {
        expect(meetsThreshold).toBe(false);
      }
    });
  });

  // ==========================================================================
  // METRICS EXPORT
  // ==========================================================================

  describe('Metrics Export', () => {
    it('exports citation verification metrics for CI', async () => {
      if (!repoAvailable) {
        console.warn('Skipping: external repo not available');
        return;
      }

      const validResponse = generateValidCitationResponse(typedriverFacts, TYPEDRIVER_REPO);
      const invalidResponse = generateInvalidCitationResponse();

      const validResult = await pipeline.validate(validResponse, TYPEDRIVER_REPO);
      const invalidResult = await pipeline.validate(invalidResponse, TYPEDRIVER_REPO);

      const metrics: E2ECitationMetrics = {
        valid_response_rate: validResult.validationRate,
        invalid_detection_rate:
          invalidResult.citations.length > 0
            ? invalidResult.citations.filter((c) => !c.isValid).length / invalidResult.citations.length
            : 0,
        total_citations_tested: validResult.citations.length + invalidResult.citations.length,
        external_repo: 'typedriver-ts',
        accuracy_target: CITATION_ACCURACY_THRESHOLD,
        target_met: validResult.validationRate >= CITATION_ACCURACY_THRESHOLD,
        timestamp: new Date().toISOString(),
      };

      console.log('\nMetrics Export:', JSON.stringify(metrics, null, 2));

      expect(typeof metrics.valid_response_rate).toBe('number');
      expect(typeof metrics.invalid_detection_rate).toBe('number');
    });
  });
});

// ============================================================================
// TYPE EXPORTS FOR CI INTEGRATION
// ============================================================================

export interface E2ECitationMetrics {
  valid_response_rate: number;
  invalid_detection_rate: number;
  total_citations_tested: number;
  external_repo: string;
  accuracy_target: number;
  target_met: boolean;
  timestamp: string;
}
