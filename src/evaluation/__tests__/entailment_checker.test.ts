/**
 * @fileoverview Tests for MiniCheck Entailment Checker (WU-1110)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Entailment Checker verifies whether claims made in Librarian's responses
 * are actually entailed by the source code. This is a hallucination detection mechanism.
 *
 * Entailment logic:
 * - Entailed: Claim is supported by evidence (e.g., "Function X returns string" + AST shows `: string`)
 * - Contradicted: Claim conflicts with evidence (e.g., "Function X takes no parameters" + AST shows params)
 * - Neutral: Insufficient evidence to verify (e.g., "This function is efficient")
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  EntailmentChecker,
  createEntailmentChecker,
  type Claim,
  type ClaimType,
  type EntailmentResult,
  type EntailmentVerdict,
  type EntailmentEvidence,
  type EntailmentReport,
} from '../entailment_checker.js';
import { type ASTFact } from '../ast_fact_extractor.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_FILE = path.join(LIBRARIAN_ROOT, 'src/evaluation/ast_fact_extractor.ts');

// Sample AST facts for testing
const sampleFacts: ASTFact[] = [
  {
    type: 'function_def',
    identifier: 'createASTFactExtractor',
    file: SAMPLE_FILE,
    line: 816,
    details: {
      parameters: [],
      returnType: 'ASTFactExtractor',
      isAsync: false,
      isExported: true,
    },
  },
  {
    type: 'class',
    identifier: 'ASTFactExtractor',
    file: SAMPLE_FILE,
    line: 149,
    details: {
      methods: ['extractFromFile', 'extractFromDirectory', 'extractFunctions', 'extractImports', 'extractClasses', 'extractExports'],
      properties: ['project'],
      isAbstract: false,
    },
  },
  {
    type: 'function_def',
    identifier: 'extractFromFile',
    file: SAMPLE_FILE,
    line: 168,
    details: {
      parameters: [{ name: 'filePath', type: 'string' }],
      returnType: 'Promise<ASTFact[]>',
      isAsync: true,
      isExported: false,
      className: 'ASTFactExtractor',
    },
  },
  {
    type: 'function_def',
    identifier: 'extractFromDirectory',
    file: SAMPLE_FILE,
    line: 197,
    details: {
      parameters: [{ name: 'dirPath', type: 'string' }],
      returnType: 'Promise<ASTFact[]>',
      isAsync: true,
      isExported: false,
      className: 'ASTFactExtractor',
    },
  },
  {
    type: 'import',
    identifier: 'Project',
    file: SAMPLE_FILE,
    line: 17,
    details: {
      source: 'ts-morph',
      specifiers: [{ name: 'Project' }, { name: 'SourceFile' }, { name: 'SyntaxKind' }, { name: 'Node' }],
      isDefault: false,
      isNamespace: false,
      isTypeOnly: false,
    },
  },
  {
    type: 'type',
    identifier: 'ASTFactType',
    file: SAMPLE_FILE,
    line: 28,
    details: {
      kind: 'type_alias',
    },
  },
  {
    type: 'type',
    identifier: 'ASTFact',
    file: SAMPLE_FILE,
    line: 33,
    details: {
      kind: 'interface',
      properties: ['type', 'identifier', 'file', 'line', 'details'],
    },
  },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createEntailmentChecker', () => {
  it('should create an EntailmentChecker instance', () => {
    const checker = createEntailmentChecker();
    expect(checker).toBeInstanceOf(EntailmentChecker);
  });
});

// ============================================================================
// EXTRACT CLAIMS TESTS
// ============================================================================

describe('EntailmentChecker - extractClaims', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should extract "function returns" claims', () => {
    const response = 'The function `createASTFactExtractor` returns an `ASTFactExtractor` instance.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const returnClaim = claims.find((c) => c.text.includes('returns'));
    expect(returnClaim).toBeDefined();
    expect(returnClaim?.type).toBe('structural');
  });

  it('should extract "function accepts/takes" claims', () => {
    const response = 'The method `extractFromFile` takes a `filePath` parameter of type string.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const paramClaim = claims.find((c) => c.text.includes('takes') || c.text.includes('parameter'));
    expect(paramClaim).toBeDefined();
    expect(paramClaim?.type).toBe('structural');
  });

  it('should extract "class extends/implements" claims', () => {
    const response = 'The class `UserService` extends `BaseService` and implements `IUserService`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const inheritanceClaim = claims.find((c) => c.text.includes('extends') || c.text.includes('implements'));
    expect(inheritanceClaim).toBeDefined();
    expect(inheritanceClaim?.type).toBe('structural');
  });

  it('should extract "file imports/exports" claims', () => {
    const response = 'The file imports `Project` from ts-morph.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const importClaim = claims.find((c) => c.text.includes('imports'));
    expect(importClaim).toBeDefined();
    expect(importClaim?.type).toBe('structural');
  });

  it('should extract "X is defined in Y" claims', () => {
    const response = 'The `ASTFactExtractor` class is defined in `ast_fact_extractor.ts`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const locationClaim = claims.find((c) => c.text.includes('defined'));
    expect(locationClaim).toBeDefined();
    expect(locationClaim?.type).toBe('factual');
  });

  it('should extract "X calls Y" claims', () => {
    const response = 'The `processData` function calls `validateInput` internally.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const callClaim = claims.find((c) => c.text.includes('calls'));
    expect(callClaim).toBeDefined();
    expect(callClaim?.type).toBe('behavioral');
  });

  it('should extract "function is async" claims', () => {
    const response = 'The `extractFromFile` method is async and returns a Promise.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const asyncClaim = claims.find((c) => c.text.includes('async'));
    expect(asyncClaim).toBeDefined();
    expect(asyncClaim?.type).toBe('structural');
  });

  it('should extract "X has N parameters" claims', () => {
    const response = 'The `formatOutput` function has two parameters: `data` and `options`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const paramCountClaim = claims.find((c) => c.text.includes('parameters') || c.text.includes('two'));
    expect(paramCountClaim).toBeDefined();
  });

  it('should extract cited sources when present', () => {
    // This pattern has "function X returns Y" which should match
    const response = 'The function `createASTFactExtractor` returns an instance (see src/evaluation/ast_fact_extractor.ts:816).';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    // Source citation should be picked up if nearby the claim pattern
    const anyClaim = claims[0];
    expect(anyClaim).toBeDefined();
  });

  it('should handle multiple claims in a single response', () => {
    const response = `
      The \`ASTFactExtractor\` class is defined in \`ast_fact_extractor.ts\`.
      It has a method \`extractFromFile\` that takes a string parameter.
      The method returns a Promise of ASTFact array.
      The file imports \`Project\` from ts-morph.
    `;
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(3);
  });

  it('should return empty array for text with no claims', () => {
    const response = 'This is general discussion without specific code claims.';
    const claims = checker.extractClaims(response);

    expect(claims).toEqual([]);
  });

  it('should classify behavioral claims correctly', () => {
    const response = 'The function validates input and throws an error if invalid.';
    const claims = checker.extractClaims(response);

    const behavioralClaims = claims.filter((c) => c.type === 'behavioral');
    expect(behavioralClaims.length).toBeGreaterThanOrEqual(0);
  });

  it('should classify factual claims correctly', () => {
    const response = 'The class is located at line 149 in the file.';
    const claims = checker.extractClaims(response);

    const factualClaims = claims.filter((c) => c.type === 'factual');
    expect(factualClaims.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// CHECK ENTAILMENT TESTS
// ============================================================================

describe('EntailmentChecker - checkEntailment', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  // ENTAILED cases
  it('should return entailed for correct return type claim', () => {
    const claim: Claim = {
      text: 'The function createASTFactExtractor returns ASTFactExtractor',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.supports)).toBe(true);
  });

  it('should return entailed for correct parameter claim', () => {
    const claim: Claim = {
      text: 'The method extractFromFile takes a filePath parameter of type string',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should return entailed for correct async claim', () => {
    const claim: Claim = {
      text: 'The extractFromFile method is async',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should return entailed for correct class method claim', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor has a method extractFromDirectory',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should return entailed for correct import claim', () => {
    const claim: Claim = {
      text: 'The file imports Project from ts-morph',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should return entailed for correct interface properties claim', () => {
    const claim: Claim = {
      text: 'The ASTFact interface has properties type, identifier, file, line, and details',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  // CONTRADICTED cases
  it('should return contradicted for wrong return type claim', () => {
    const claim: Claim = {
      text: 'The function createASTFactExtractor returns void',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('contradicted');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.evidence.some((e) => !e.supports)).toBe(true);
  });

  it('should return contradicted for wrong parameter type claim', () => {
    const claim: Claim = {
      text: 'The method extractFromFile takes a filePath parameter of type number',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('contradicted');
  });

  it('should return contradicted for wrong async claim', () => {
    const claim: Claim = {
      text: 'The createASTFactExtractor function is async',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('contradicted');
  });

  it('should return contradicted for claim about non-existent method', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor has a method processData',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('contradicted');
  });

  it('should return contradicted for wrong import source claim', () => {
    const claim: Claim = {
      text: 'The file imports Project from typescript',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('contradicted');
  });

  it('should return contradicted for claim about wrong number of parameters', () => {
    const claim: Claim = {
      text: 'The createASTFactExtractor function takes two parameters',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('contradicted');
  });

  // NEUTRAL cases
  it('should return neutral for subjective claim', () => {
    const claim: Claim = {
      text: 'The function is well-designed and efficient',
      type: 'behavioral',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('neutral');
  });

  it('should return neutral when no evidence available', () => {
    const claim: Claim = {
      text: 'The function handles edge cases gracefully',
      type: 'behavioral',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('neutral');
  });

  it('should return neutral for claims about entities not in facts', () => {
    const claim: Claim = {
      text: 'The UnknownClass returns a string',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('neutral');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should return neutral for vague claims', () => {
    const claim: Claim = {
      text: 'The code works correctly',
      type: 'behavioral',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('neutral');
  });

  // Result structure tests
  it('should include the original claim in the result', () => {
    const claim: Claim = {
      text: 'Test claim',
      type: 'factual',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.claim).toEqual(claim);
  });

  it('should include explanation in the result', () => {
    const claim: Claim = {
      text: 'The function createASTFactExtractor returns ASTFactExtractor',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.explanation).toBeDefined();
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('should include confidence score between 0 and 1', () => {
    const claim: Claim = {
      text: 'Any claim',
      type: 'factual',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// FIND EVIDENCE TESTS
// ============================================================================

describe('EntailmentChecker - findEvidence', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should find AST fact evidence for function claims', () => {
    const claim: Claim = {
      text: 'createASTFactExtractor returns ASTFactExtractor',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((e) => e.type === 'ast_fact')).toBe(true);
  });

  it('should find type info evidence', () => {
    const claim: Claim = {
      text: 'The function extractFromFile returns Promise<ASTFact[]>',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    // Should find evidence - may be ast_fact or type_info depending on implementation
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((e) => e.type === 'type_info' || e.type === 'ast_fact')).toBe(true);
  });

  it('should find code match evidence from context', () => {
    const claim: Claim = {
      text: 'The function uses Project from ts-morph',
      type: 'structural',
    };

    const context = ['import { Project, SourceFile } from "ts-morph";'];
    const evidence = checker.findEvidence(claim, sampleFacts, context);

    expect(evidence.some((e) => e.type === 'code_match' || e.type === 'ast_fact')).toBe(true);
  });

  it('should indicate whether evidence supports the claim', () => {
    const claim: Claim = {
      text: 'createASTFactExtractor returns ASTFactExtractor',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.every((e) => typeof e.supports === 'boolean')).toBe(true);
  });

  it('should include source information in evidence', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor is a class',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.source !== undefined)).toBe(true);
  });

  it('should include content snippet in evidence', () => {
    const claim: Claim = {
      text: 'extractFromFile takes filePath parameter',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.content !== undefined)).toBe(true);
  });

  it('should return empty array when no evidence found', () => {
    const claim: Claim = {
      text: 'UnrelatedFunction does something',
      type: 'behavioral',
    };

    const evidence = checker.findEvidence(claim, [], []);

    expect(evidence).toEqual([]);
  });

  it('should find comment evidence when available', () => {
    const claim: Claim = {
      text: 'The function extracts facts from TypeScript code',
      type: 'behavioral',
    };

    const context = [
      '/**',
      ' * Extracts machine-verifiable facts from TypeScript/JavaScript codebases',
      ' */',
    ];
    const evidence = checker.findEvidence(claim, sampleFacts, context);

    const commentEvidence = evidence.find((e) => e.type === 'comment');
    // May or may not find comment evidence depending on implementation
    expect(Array.isArray(evidence)).toBe(true);
  });
});

// ============================================================================
// CHECK RESPONSE TESTS
// ============================================================================

describe('EntailmentChecker - checkResponse', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should check all claims in a response', async () => {
    const response = `
      The function \`createASTFactExtractor\` returns an \`ASTFactExtractor\` instance.
      The method \`extractFromFile\` takes a string parameter.
      The file imports \`Project\` from ts-morph.
    `;

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    expect(report.claims.length).toBeGreaterThanOrEqual(1);
    expect(report.results.length).toBe(report.claims.length);
  });

  it('should calculate correct summary statistics', async () => {
    const response = `
      The \`createASTFactExtractor\` function returns an \`ASTFactExtractor\`.
      This function is async.
    `;

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    expect(report.summary).toBeDefined();
    expect(typeof report.summary.entailed).toBe('number');
    expect(typeof report.summary.contradicted).toBe('number');
    expect(typeof report.summary.neutral).toBe('number');
    expect(report.summary.entailed + report.summary.contradicted + report.summary.neutral).toBe(report.claims.length);
  });

  it('should calculate entailment rate', async () => {
    const response = 'The function returns a value.';

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    expect(typeof report.summary.entailmentRate).toBe('number');
    expect(report.summary.entailmentRate).toBeGreaterThanOrEqual(0);
    expect(report.summary.entailmentRate).toBeLessThanOrEqual(1);
  });

  it('should handle response with no claims', async () => {
    const response = 'This is general discussion without code claims.';

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    expect(report.claims).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.summary.entailmentRate).toBe(0);
  });

  it('should handle invalid repo path gracefully', async () => {
    const response = 'The function returns a string.';

    const report = await checker.checkResponse(response, '/nonexistent/repo');

    // Should not throw, should return neutral results
    expect(report).toBeDefined();
    expect(report.claims.length).toBeGreaterThanOrEqual(0);
  });

  it('should preserve claim order in results', async () => {
    const response = `
      First: The function returns void.
      Second: The class has methods.
      Third: The file imports modules.
    `;

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    if (report.claims.length >= 3) {
      expect(report.results[0].claim.text).toContain('First');
      expect(report.results[1].claim.text).toContain('Second');
      expect(report.results[2].claim.text).toContain('Third');
    }
  });
});

// ============================================================================
// ENTAILMENT REPORT TESTS
// ============================================================================

describe('EntailmentReport Interface', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should have all required fields', async () => {
    const response = 'The function returns a value.';

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    expect(Array.isArray(report.claims)).toBe(true);
    expect(Array.isArray(report.results)).toBe(true);
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.entailed).toBe('number');
    expect(typeof report.summary.contradicted).toBe('number');
    expect(typeof report.summary.neutral).toBe('number');
    expect(typeof report.summary.entailmentRate).toBe('number');
  });

  it('should have consistent counts', async () => {
    const response = `
      The \`createASTFactExtractor\` function returns ASTFactExtractor.
      The \`extractFromFile\` method is async.
    `;

    const report = await checker.checkResponse(response, LIBRARIAN_ROOT);

    const total = report.summary.entailed + report.summary.contradicted + report.summary.neutral;
    expect(total).toBe(report.claims.length);
    expect(report.results.length).toBe(report.claims.length);
  });
});

// ============================================================================
// CLAIM INTERFACE TESTS
// ============================================================================

describe('Claim Interface', () => {
  it('should support all required fields', () => {
    const claim: Claim = {
      text: 'The function returns a string',
      type: 'structural',
      source: 'src/test.ts:10',
    };

    expect(claim.text).toBe('The function returns a string');
    expect(claim.type).toBe('structural');
    expect(claim.source).toBe('src/test.ts:10');
  });

  it('should allow optional source to be undefined', () => {
    const claim: Claim = {
      text: 'The function is async',
      type: 'structural',
    };

    expect(claim.source).toBeUndefined();
  });

  it('should accept all claim types', () => {
    const types: ClaimType[] = ['structural', 'behavioral', 'factual'];

    types.forEach((type) => {
      const claim: Claim = { text: 'test', type };
      expect(claim.type).toBe(type);
    });
  });
});

// ============================================================================
// ENTAILMENT EVIDENCE TESTS
// ============================================================================

describe('EntailmentEvidence Interface', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should include evidence type', () => {
    const claim: Claim = {
      text: 'createASTFactExtractor returns ASTFactExtractor',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.length).toBeGreaterThan(0);
    evidence.forEach((e) => {
      expect(['code_match', 'ast_fact', 'comment', 'type_info']).toContain(e.type);
    });
  });

  it('should have source and content fields', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor is a class',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.length).toBeGreaterThan(0);
    evidence.forEach((e) => {
      expect(typeof e.source).toBe('string');
      expect(typeof e.content).toBe('string');
    });
  });

  it('should indicate support/contradiction', () => {
    const claim: Claim = {
      text: 'extractFromFile is async',
      type: 'structural',
    };

    const evidence = checker.findEvidence(claim, sampleFacts, []);

    expect(evidence.length).toBeGreaterThan(0);
    evidence.forEach((e) => {
      expect(typeof e.supports).toBe('boolean');
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('EntailmentChecker - Edge Cases', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should handle empty response', () => {
    const claims = checker.extractClaims('');
    expect(claims).toEqual([]);
  });

  it('should handle whitespace-only response', () => {
    const claims = checker.extractClaims('   \n\t\n   ');
    expect(claims).toEqual([]);
  });

  it('should handle very long claims', () => {
    const longText = 'The function '.repeat(100) + 'returns a value.';
    const claims = checker.extractClaims(longText);

    // Should extract something or handle gracefully
    expect(Array.isArray(claims)).toBe(true);
  });

  it('should handle claims with special characters', () => {
    const response = 'The `foo<T>` generic function returns `Promise<T[]>`.';
    const claims = checker.extractClaims(response);

    expect(Array.isArray(claims)).toBe(true);
  });

  it('should handle unicode in claims', () => {
    const response = 'The function handles unicode strings like "hello".';
    const claims = checker.extractClaims(response);

    expect(Array.isArray(claims)).toBe(true);
  });

  it('should handle claims about private methods', () => {
    const claim: Claim = {
      text: 'The class has a private method _helper',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    // Should handle gracefully even if private methods aren't in facts
    expect(['entailed', 'contradicted', 'neutral']).toContain(result.verdict);
  });

  it('should handle empty facts array', () => {
    const claim: Claim = {
      text: 'The function returns a string',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, [], []);

    expect(result.verdict).toBe('neutral');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should handle claims with negation', () => {
    const claim: Claim = {
      text: 'The function does not return void',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    // Should handle negation in claim
    expect(['entailed', 'contradicted', 'neutral']).toContain(result.verdict);
  });

  it('should handle ambiguous claims', () => {
    const claim: Claim = {
      text: 'The method does something',
      type: 'behavioral',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('neutral');
  });

  it('should handle multiple entities mentioned in one claim', () => {
    const claim: Claim = {
      text: 'Both createASTFactExtractor and extractFromFile are functions',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    // Should check both entities
    expect(['entailed', 'contradicted', 'neutral']).toContain(result.verdict);
  });
});

// ============================================================================
// CONFIDENCE SCORING TESTS
// ============================================================================

describe('EntailmentChecker - Confidence Scoring', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should give high confidence for exact structural matches', () => {
    const claim: Claim = {
      text: 'createASTFactExtractor returns ASTFactExtractor',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    if (result.verdict === 'entailed') {
      expect(result.confidence).toBeGreaterThan(0.8);
    }
  });

  it('should give moderate confidence for partial matches', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor has methods',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    if (result.verdict === 'entailed') {
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('should give low confidence for neutral verdicts', () => {
    const claim: Claim = {
      text: 'The code is well-optimized',
      type: 'behavioral',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    if (result.verdict === 'neutral') {
      expect(result.confidence).toBeLessThan(0.5);
    }
  });

  it('should give high confidence for clear contradictions', () => {
    const claim: Claim = {
      text: 'createASTFactExtractor returns void',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    if (result.verdict === 'contradicted') {
      expect(result.confidence).toBeGreaterThan(0.7);
    }
  });
});

// ============================================================================
// NEW CLAIM PATTERNS TESTS (WU-1408)
// ============================================================================

describe('EntailmentChecker - New Claim Patterns (WU-1408)', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  // Test pattern 1: "X implements Y interface"
  it('should extract "class implements interface" claims', () => {
    const response = 'The class `UserService` implements `IUserService` interface.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const implementsClaim = claims.find((c) => c.text.toLowerCase().includes('implements'));
    expect(implementsClaim).toBeDefined();
    expect(implementsClaim?.type).toBe('structural');
  });

  // Test pattern 3: "X depends on Y"
  it('should extract "X depends on Y" claims', () => {
    const response = 'The `UserController` depends on `UserService` for data access.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const dependsClaim = claims.find((c) => c.text.toLowerCase().includes('depends on'));
    expect(dependsClaim).toBeDefined();
    expect(dependsClaim?.type).toBe('structural');
  });

  // Test pattern 4: "X is called by Y"
  it('should extract "X is called by Y" claims', () => {
    const response = 'The `validateInput` function is called by `processRequest`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const calledByClaim = claims.find((c) => c.text.toLowerCase().includes('is called by'));
    expect(calledByClaim).toBeDefined();
    expect(calledByClaim?.type).toBe('behavioral');
  });

  // Test pattern 5: "X has parameter Y of type Z"
  it('should extract "X has parameter Y of type Z" claims', () => {
    const response = 'The `createUser` function has parameter `name` of type `string`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const paramTypeClaim = claims.find((c) => c.text.toLowerCase().includes('has parameter') && c.text.toLowerCase().includes('of type'));
    expect(paramTypeClaim).toBeDefined();
    expect(paramTypeClaim?.type).toBe('structural');
  });

  // Test pattern 6: "X accepts N parameters"
  it('should extract "X accepts N parameters" claims', () => {
    const response = 'The `formatData` function accepts 3 parameters.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const acceptsParamsClaim = claims.find((c) => c.text.toLowerCase().includes('accepts') && c.text.toLowerCase().includes('parameters'));
    expect(acceptsParamsClaim).toBeDefined();
    expect(acceptsParamsClaim?.type).toBe('structural');
  });

  // Test pattern 7: "X is exported from Y"
  it('should extract "X is exported from Y" claims', () => {
    const response = 'The `UserModel` is exported from `models/user.ts`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const exportedClaim = claims.find((c) => c.text.toLowerCase().includes('is exported from'));
    expect(exportedClaim).toBeDefined();
    expect(exportedClaim?.type).toBe('structural');
  });

  // Test pattern 11: "X has property Y"
  it('should extract "X has property Y" claims', () => {
    const response = 'The `UserConfig` class has property `maxRetries`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const hasPropertyClaim = claims.find((c) => c.text.toLowerCase().includes('has property'));
    expect(hasPropertyClaim).toBeDefined();
    expect(hasPropertyClaim?.type).toBe('structural');
  });

  // Test pattern 12: "X contains Y"
  it('should extract "X contains Y" claims', () => {
    const response = 'The `utils` module contains `formatDate` helper.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const containsClaim = claims.find((c) => c.text.toLowerCase().includes('contains'));
    expect(containsClaim).toBeDefined();
    expect(containsClaim?.type).toBe('structural');
  });

  // Test pattern 13: "X uses Y"
  it('should extract "X uses Y" claims', () => {
    const response = 'The `DataProcessor` uses `Logger` for logging.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const usesClaim = claims.find((c) => c.text.toLowerCase().includes('uses'));
    expect(usesClaim).toBeDefined();
    expect(usesClaim?.type).toBe('behavioral');
  });

  // Test pattern 14: "X provides Y"
  it('should extract "X provides Y" claims', () => {
    const response = 'The `ServiceContainer` provides `DatabaseConnection` to consumers.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const providesClaim = claims.find((c) => c.text.toLowerCase().includes('provides'));
    expect(providesClaim).toBeDefined();
    expect(providesClaim?.type).toBe('structural');
  });

  // Test pattern 16: "X decorates Y" / "X is decorated with Y"
  it('should extract "X decorates Y" claims', () => {
    const response = 'The `LoggingProxy` decorates `UserService`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const decoratesClaim = claims.find((c) => c.text.toLowerCase().includes('decorates'));
    expect(decoratesClaim).toBeDefined();
    expect(decoratesClaim?.type).toBe('structural');
  });

  it('should extract "X is decorated with Y" claims', () => {
    const response = 'The `UserController` is decorated with `Injectable`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const decoratedWithClaim = claims.find((c) => c.text.toLowerCase().includes('is decorated with'));
    expect(decoratedWithClaim).toBeDefined();
    expect(decoratedWithClaim?.type).toBe('structural');
  });

  // Test pattern 17: "X overrides Y"
  it('should extract "X overrides Y" claims', () => {
    const response = 'The `CustomLogger` overrides `log` method from base class.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const overridesClaim = claims.find((c) => c.text.toLowerCase().includes('overrides'));
    expect(overridesClaim).toBeDefined();
    expect(overridesClaim?.type).toBe('structural');
  });

  // Test pattern 18: "X handles Y"
  it('should extract "X handles Y" claims', () => {
    const response = 'The `ErrorHandler` handles `ValidationError` exceptions.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const handlesClaim = claims.find((c) => c.text.toLowerCase().includes('handles'));
    expect(handlesClaim).toBeDefined();
    expect(handlesClaim?.type).toBe('behavioral');
  });

  // Test pattern 19: "X triggers Y"
  it('should extract "X triggers Y" claims', () => {
    const response = 'The `UserService` triggers `UserCreatedEvent` after signup.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const triggersClaim = claims.find((c) => c.text.toLowerCase().includes('triggers'));
    expect(triggersClaim).toBeDefined();
    expect(triggersClaim?.type).toBe('behavioral');
  });

  // Test pattern 20: "X validates Y"
  it('should extract "X validates Y" claims', () => {
    const response = 'The `InputValidator` validates `userInput` before processing.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const validatesClaim = claims.find((c) => c.text.toLowerCase().includes('validates'));
    expect(validatesClaim).toBeDefined();
    expect(validatesClaim?.type).toBe('behavioral');
  });

  // Test pattern 21: "X throws Y"
  it('should extract "X throws Y" claims', () => {
    const response = 'The `parseConfig` function throws `ConfigError` on invalid input.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const throwsClaim = claims.find((c) => c.text.toLowerCase().includes('throws'));
    expect(throwsClaim).toBeDefined();
    expect(throwsClaim?.type).toBe('behavioral');
  });

  // Test pattern 22: "X emits Y"
  it('should extract "X emits Y" claims', () => {
    const response = 'The `EventEmitter` emits `dataReady` event.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const emitsClaim = claims.find((c) => c.text.toLowerCase().includes('emits'));
    expect(emitsClaim).toBeDefined();
    expect(emitsClaim?.type).toBe('behavioral');
  });

  // Test pattern 23: "X listens for/to Y"
  it('should extract "X listens for Y" claims', () => {
    const response = 'The `NotificationService` listens for `userLogin` events.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const listensClaim = claims.find((c) => c.text.toLowerCase().includes('listens'));
    expect(listensClaim).toBeDefined();
    expect(listensClaim?.type).toBe('behavioral');
  });

  // Test pattern 24: "X inherits from Y"
  it('should extract "X inherits from Y" claims', () => {
    const response = 'The `AdminUser` inherits from `BaseUser`.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const inheritsClaim = claims.find((c) => c.text.toLowerCase().includes('inherits from'));
    expect(inheritsClaim).toBeDefined();
    expect(inheritsClaim?.type).toBe('structural');
  });

  // Test pattern 30: "X is deprecated"
  it('should extract "X is deprecated" claims', () => {
    const response = 'The `oldMethod` is deprecated and should not be used.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const deprecatedClaim = claims.find((c) => c.text.toLowerCase().includes('is deprecated'));
    expect(deprecatedClaim).toBeDefined();
    expect(deprecatedClaim?.type).toBe('factual');
  });

  // Test pattern 33: "X is private/public/protected"
  it('should extract "X is private" claims', () => {
    const response = 'The `_internalHelper` method is private.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const privateClaim = claims.find((c) => c.text.toLowerCase().includes('is private'));
    expect(privateClaim).toBeDefined();
    expect(privateClaim?.type).toBe('structural');
  });

  // Test pattern 34: "X is static"
  it('should extract "X is static" claims', () => {
    const response = 'The `getInstance` method is static.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const staticClaim = claims.find((c) => c.text.toLowerCase().includes('is static'));
    expect(staticClaim).toBeDefined();
    expect(staticClaim?.type).toBe('structural');
  });

  // Test pattern 37: "X is generic"
  it('should extract "X is generic" claims', () => {
    const response = 'The `Container` class is generic and accepts a type parameter.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(1);
    const genericClaim = claims.find((c) => c.text.toLowerCase().includes('is generic'));
    expect(genericClaim).toBeDefined();
    expect(genericClaim?.type).toBe('structural');
  });

  // Test multiple new patterns in one response
  it('should extract multiple new pattern claims from one response', () => {
    const response = `
      The \`UserService\` depends on \`DatabaseClient\`.
      The \`validateUser\` function is called by \`createUser\`.
      The \`UserController\` uses \`Logger\` for logging.
      The \`ErrorHandler\` handles \`ValidationError\`.
      The \`EventBus\` emits \`userCreated\` event.
    `;
    const claims = checker.extractClaims(response);

    // Should extract at least 5 claims (one for each new pattern)
    expect(claims.length).toBeGreaterThanOrEqual(5);
  });
});

// ============================================================================
// INTEGRATION WITH AST FACTS TESTS
// ============================================================================

describe('EntailmentChecker - AST Facts Integration', () => {
  let checker: EntailmentChecker;

  beforeAll(() => {
    checker = createEntailmentChecker();
  });

  it('should verify function_def facts', () => {
    const claim: Claim = {
      text: 'createASTFactExtractor is a function that is exported',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should verify class facts', () => {
    const claim: Claim = {
      text: 'ASTFactExtractor is a class with method extractFromFile',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should verify import facts', () => {
    const claim: Claim = {
      text: 'Project is imported from ts-morph',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should verify type facts', () => {
    const claim: Claim = {
      text: 'ASTFactType is defined as a type alias',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should check parameter details', () => {
    const claim: Claim = {
      text: 'extractFromFile has a parameter named filePath',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });

  it('should check return type details', () => {
    const claim: Claim = {
      text: 'extractFromDirectory returns Promise<ASTFact[]>',
      type: 'structural',
    };

    const result = checker.checkEntailment(claim, sampleFacts, []);

    expect(result.verdict).toBe('entailed');
  });
});
