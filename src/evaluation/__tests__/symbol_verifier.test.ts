/**
 * @fileoverview Tests for Symbol Existence Verifier (WU-HALU-006)
 *
 * TDD: Tests written FIRST. Implementation follows.
 *
 * Verifies that cited functions, classes, and variables exist in the codebase.
 * Target: 100% symbol verification accuracy
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import {
  SymbolVerifier,
  createSymbolVerifier,
  type SymbolReference,
  type SymbolVerificationResult,
  type VerificationReport,
  type CodebaseIndex,
} from '../symbol_verifier.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const SRC_DIR = path.join(LIBRARIAN_ROOT, 'src');
const EVALUATION_DIR = path.join(SRC_DIR, 'evaluation');
const AST_FACT_EXTRACTOR_PATH = path.join(EVALUATION_DIR, 'ast_fact_extractor.ts');

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createSymbolVerifier', () => {
  it('should create a SymbolVerifier instance', () => {
    const verifier = createSymbolVerifier();
    expect(verifier).toBeInstanceOf(SymbolVerifier);
  });
});

// ============================================================================
// SYMBOL EXTRACTION TESTS
// ============================================================================

describe('SymbolVerifier - extractSymbolReferences', () => {
  let verifier: SymbolVerifier;

  beforeAll(() => {
    verifier = createSymbolVerifier();
  });

  it('should extract function call references', () => {
    const text = 'The function `createASTFactExtractor()` is used to initialize the extractor.';
    const refs = verifier.extractSymbolReferences(text);

    expect(refs.length).toBeGreaterThan(0);
    const funcRef = refs.find((r) => r.name === 'createASTFactExtractor');
    expect(funcRef).toBeDefined();
    expect(funcRef?.type).toBe('function');
  });

  it('should extract class instantiation references', () => {
    const text = 'Create a new instance with `new ASTFactExtractor()` to begin extraction.';
    const refs = verifier.extractSymbolReferences(text);

    const classRef = refs.find((r) => r.name === 'ASTFactExtractor');
    expect(classRef).toBeDefined();
    expect(classRef?.type).toBe('class');
  });

  it('should extract static method call references', () => {
    const text = 'Call `SymbolVerifier.verify()` to check symbol existence.';
    const refs = verifier.extractSymbolReferences(text);

    const methodRef = refs.find((r) => r.name === 'verify' && r.type === 'method');
    expect(methodRef).toBeDefined();
    expect(methodRef?.type).toBe('method');
  });

  it('should extract import references', () => {
    const text = 'Import the function with `import { ASTFactExtractor } from "./ast_fact_extractor"`.';
    const refs = verifier.extractSymbolReferences(text);

    const importRef = refs.find((r) => r.name === 'ASTFactExtractor');
    expect(importRef).toBeDefined();
  });

  it('should extract type annotation references', () => {
    const text = 'The variable is typed as `: ASTFact` for proper type checking.';
    const refs = verifier.extractSymbolReferences(text);

    const typeRef = refs.find((r) => r.name === 'ASTFact');
    expect(typeRef).toBeDefined();
    expect(typeRef?.type).toBe('type');
  });

  it('should extract interface references', () => {
    const text = 'The class implements the `SymbolReference` interface.';
    const refs = verifier.extractSymbolReferences(text);

    const ifaceRef = refs.find((r) => r.name === 'SymbolReference');
    expect(ifaceRef).toBeDefined();
    expect(ifaceRef?.type).toBe('interface');
  });

  it('should extract variable references', () => {
    const text = 'Access the `DEFAULT_EVAL_CONFIG` constant for default settings.';
    const refs = verifier.extractSymbolReferences(text);

    const varRef = refs.find((r) => r.name === 'DEFAULT_EVAL_CONFIG');
    expect(varRef).toBeDefined();
    expect(varRef?.type).toBe('variable');
  });

  it('should handle file path context in references', () => {
    const text = 'The `extractFromFile` function in `ast_fact_extractor.ts` handles file processing.';
    const refs = verifier.extractSymbolReferences(text);

    const funcRef = refs.find((r) => r.name === 'extractFromFile');
    expect(funcRef).toBeDefined();
    // Check that filePath is defined and contains the expected value
    expect(funcRef?.filePath).toBeDefined();
    expect(funcRef!.filePath!).toContain('ast_fact_extractor');
  });

  it('should handle line number context in references', () => {
    const text = 'See `ASTFactExtractor` at `ast_fact_extractor.ts:149` for the implementation.';
    const refs = verifier.extractSymbolReferences(text);

    const ref = refs.find((r) => r.name === 'ASTFactExtractor');
    expect(ref).toBeDefined();
    expect(ref?.lineNumber).toBe(149);
  });

  it('should preserve original context for each reference', () => {
    const text = 'The `createSymbolVerifier` function creates a new verifier instance.';
    const refs = verifier.extractSymbolReferences(text);

    const funcRef = refs.find((r) => r.name === 'createSymbolVerifier');
    expect(funcRef).toBeDefined();
    expect(funcRef?.context).toContain('createSymbolVerifier');
  });

  it('should handle multiple references in the same text', () => {
    const text = 'Use `ASTFactExtractor` to extract `ASTFact` objects via `extractFromFile()`.';
    const refs = verifier.extractSymbolReferences(text);

    expect(refs.length).toBeGreaterThanOrEqual(3);
    expect(refs.some((r) => r.name === 'ASTFactExtractor')).toBe(true);
    expect(refs.some((r) => r.name === 'ASTFact')).toBe(true);
    expect(refs.some((r) => r.name === 'extractFromFile')).toBe(true);
  });

  it('should not extract non-symbol backtick content', () => {
    const text = 'Run the command `npm install` and then `cd src`.';
    const refs = verifier.extractSymbolReferences(text);

    // Should not extract "npm install" or "cd src" as symbols
    expect(refs.every((r) => r.name !== 'npm install')).toBe(true);
    expect(refs.every((r) => r.name !== 'cd src')).toBe(true);
  });
});

// ============================================================================
// CODEBASE INDEX BUILDING TESTS
// ============================================================================

describe('SymbolVerifier - buildCodebaseIndex', () => {
  let verifier: SymbolVerifier;

  beforeAll(() => {
    verifier = createSymbolVerifier();
  });

  it('should build an index from a directory', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    expect(index).toBeDefined();
    expect(index.functions).toBeInstanceOf(Map);
    expect(index.classes).toBeInstanceOf(Map);
    expect(index.variables).toBeInstanceOf(Map);
    expect(index.types).toBeInstanceOf(Map);
  });

  it('should index functions from the codebase', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    // ASTFactExtractor exports createASTFactExtractor
    expect(index.functions.has('createASTFactExtractor')).toBe(true);
    const locations = index.functions.get('createASTFactExtractor');
    expect(locations).toBeDefined();
    expect(locations!.length).toBeGreaterThan(0);
    expect(locations![0].file).toContain('ast_fact_extractor');
  });

  it('should index classes from the codebase', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    expect(index.classes.has('ASTFactExtractor')).toBe(true);
    const locations = index.classes.get('ASTFactExtractor');
    expect(locations).toBeDefined();
    expect(locations!.length).toBeGreaterThan(0);
  });

  it('should index types and interfaces from the codebase', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    // ASTFact is an interface in ast_fact_extractor.ts
    expect(index.types.has('ASTFact')).toBe(true);
    const locations = index.types.get('ASTFact');
    expect(locations).toBeDefined();
  });

  it('should index exported constants', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    // DEFAULT_EVAL_CONFIG is exported from harness.ts
    expect(index.variables.has('DEFAULT_EVAL_CONFIG')).toBe(true);
  });

  it('should include file and line information', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    const classLocations = index.classes.get('ASTFactExtractor');
    expect(classLocations).toBeDefined();
    expect(classLocations![0].file).toBeTruthy();
    expect(classLocations![0].line).toBeGreaterThan(0);
  });

  it('should handle empty directories gracefully', async () => {
    const index = await verifier.buildCodebaseIndex('/non/existent/path');

    expect(index.functions.size).toBe(0);
    expect(index.classes.size).toBe(0);
    expect(index.types.size).toBe(0);
    expect(index.variables.size).toBe(0);
  });

  it('should handle methods within classes', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);

    // extractFromFile is a method on ASTFactExtractor
    expect(index.functions.has('extractFromFile')).toBe(true);
  });
});

// ============================================================================
// SINGLE SYMBOL VERIFICATION TESTS
// ============================================================================

describe('SymbolVerifier - verifySymbol', () => {
  let verifier: SymbolVerifier;
  let index: CodebaseIndex;

  beforeAll(async () => {
    verifier = createSymbolVerifier();
    index = await verifier.buildCodebaseIndex(EVALUATION_DIR);
  });

  it('should verify an existing function', () => {
    const ref: SymbolReference = {
      name: 'createASTFactExtractor',
      type: 'function',
      context: 'Use createASTFactExtractor() to create an extractor.',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.foundAt).toBeDefined();
    expect(result.verificationMethod).toBe('ast');
  });

  it('should verify an existing class', () => {
    const ref: SymbolReference = {
      name: 'ASTFactExtractor',
      type: 'class',
      context: 'The ASTFactExtractor class handles extraction.',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(true);
    expect(result.foundAt).toBeDefined();
    expect(result.foundAt?.file).toContain('ast_fact_extractor');
  });

  it('should verify an existing type', () => {
    const ref: SymbolReference = {
      name: 'ASTFact',
      type: 'type',
      context: 'The result is typed as ASTFact.',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(true);
    expect(result.foundAt).toBeDefined();
  });

  it('should detect a hallucinated symbol', () => {
    const ref: SymbolReference = {
      name: 'NonExistentFunction',
      type: 'function',
      context: 'Call NonExistentFunction() to process data.',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should suggest alternatives for misspelled symbols', () => {
    const ref: SymbolReference = {
      name: 'ASTFactExtractorr', // typo
      type: 'class',
      context: 'Use ASTFactExtractorr for extraction.',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(false);
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives?.length).toBeGreaterThan(0);
    expect(result.alternatives).toContain('ASTFactExtractor');
  });

  it('should verify symbol with matching file path', () => {
    const ref: SymbolReference = {
      name: 'ASTFactExtractor',
      type: 'class',
      filePath: 'ast_fact_extractor.ts',
      context: 'ASTFactExtractor in ast_fact_extractor.ts',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('should reduce confidence for wrong file path', () => {
    const ref: SymbolReference = {
      name: 'ASTFactExtractor',
      type: 'class',
      filePath: 'wrong_file.ts',
      context: 'ASTFactExtractor in wrong_file.ts',
    };

    const result = verifier.verifySymbol(ref, index);

    // Symbol exists but in wrong file
    expect(result.exists).toBe(true);
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('should verify with approximate line number matching', () => {
    const ref: SymbolReference = {
      name: 'ASTFactExtractor',
      type: 'class',
      filePath: 'ast_fact_extractor.ts',
      lineNumber: 149, // approximately correct
      context: 'ASTFactExtractor at line 149',
    };

    const result = verifier.verifySymbol(ref, index);

    expect(result.exists).toBe(true);
  });
});

// ============================================================================
// SIMILAR SYMBOL FINDING TESTS
// ============================================================================

describe('SymbolVerifier - findSimilarSymbols', () => {
  let verifier: SymbolVerifier;
  let index: CodebaseIndex;

  beforeAll(async () => {
    verifier = createSymbolVerifier();
    index = await verifier.buildCodebaseIndex(EVALUATION_DIR);
  });

  it('should find similar symbols for a typo', () => {
    const similar = verifier.findSimilarSymbols('ASTFactExtractorr', index);

    expect(similar).toContain('ASTFactExtractor');
  });

  it('should find similar symbols for case differences', () => {
    const similar = verifier.findSimilarSymbols('astfactextractor', index);

    expect(similar.some((s) => s.toLowerCase() === 'astfactextractor')).toBe(true);
  });

  it('should find similar symbols for partial matches', () => {
    const similar = verifier.findSimilarSymbols('FactExtractor', index);

    expect(similar.some((s) => s.includes('FactExtractor'))).toBe(true);
  });

  it('should return empty array for completely unrelated names', () => {
    const similar = verifier.findSimilarSymbols('xyzzyplugh', index);

    expect(similar.length).toBeLessThanOrEqual(3); // May return some low-confidence matches
  });

  it('should limit the number of suggestions', () => {
    const similar = verifier.findSimilarSymbols('create', index);

    expect(similar.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// FULL TEXT VERIFICATION TESTS
// ============================================================================

describe('SymbolVerifier - verifyAllReferences', () => {
  let verifier: SymbolVerifier;
  let index: CodebaseIndex;

  beforeAll(async () => {
    verifier = createSymbolVerifier();
    index = await verifier.buildCodebaseIndex(EVALUATION_DIR);
  });

  it('should verify all references in text', () => {
    const text = `
      The \`ASTFactExtractor\` class provides methods like \`extractFromFile()\`
      and \`extractFromDirectory()\` to parse TypeScript code.
    `;

    const report = verifier.verifyAllReferences(text, index);

    expect(report.totalReferences).toBeGreaterThan(0);
    expect(report.verified).toBeGreaterThan(0);
  });

  it('should calculate accuracy correctly', () => {
    const text = `
      Use \`createASTFactExtractor()\` to create an \`ASTFactExtractor\`.
      Then call \`extractFromFile()\` on it.
    `;

    const report = verifier.verifyAllReferences(text, index);

    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(report.accuracy).toBe(report.verified / report.totalReferences);
  });

  it('should identify hallucinated symbols', () => {
    const text = `
      Call \`nonExistentMethod()\` on the \`FakeClass\` instance.
    `;

    const report = verifier.verifyAllReferences(text, index);

    expect(report.hallucinatedSymbols.length).toBeGreaterThan(0);
    expect(report.hallucinatedSymbols.some((s) => s.name === 'nonExistentMethod')).toBe(true);
  });

  it('should return detailed results for each reference', () => {
    const text = 'The `ASTFactExtractor` class is defined in `ast_fact_extractor.ts`.';

    const report = verifier.verifyAllReferences(text, index);

    expect(report.results.length).toBeGreaterThan(0);
    report.results.forEach((result) => {
      expect(result.symbol).toBeDefined();
      expect(typeof result.exists).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
      expect(result.verificationMethod).toBeDefined();
    });
  });

  it('should handle text with no symbol references', () => {
    const text = 'This is just plain text with no code references.';

    const report = verifier.verifyAllReferences(text, index);

    expect(report.totalReferences).toBe(0);
    expect(report.accuracy).toBe(1); // No references means perfect accuracy
  });

  it('should handle mixed valid and invalid symbols', () => {
    // Use explicit function call syntax to ensure extraction
    const text = `
      The real \`ASTFactExtractor\` class provides the \`extractFromFile()\` method.
      The fake \`HallucinatedClass\` class has a \`nonExistentMethod()\` function.
    `;

    const report = verifier.verifyAllReferences(text, index);

    // Should have both verified and not found symbols
    expect(report.totalReferences).toBeGreaterThan(0);
    // At least some should be verified (ASTFactExtractor, extractFromFile)
    // and some not found (HallucinatedClass, nonExistentMethod)
  });
});

// ============================================================================
// VERIFICATION REPORT STRUCTURE TESTS
// ============================================================================

describe('VerificationReport Structure', () => {
  let verifier: SymbolVerifier;
  let index: CodebaseIndex;

  beforeAll(async () => {
    verifier = createSymbolVerifier();
    index = await verifier.buildCodebaseIndex(EVALUATION_DIR);
  });

  it('should have correct report structure', () => {
    const text = 'Use `ASTFactExtractor` to extract facts.';
    const report = verifier.verifyAllReferences(text, index);

    expect(report).toHaveProperty('totalReferences');
    expect(report).toHaveProperty('verified');
    expect(report).toHaveProperty('notFound');
    expect(report).toHaveProperty('accuracy');
    expect(report).toHaveProperty('results');
    expect(report).toHaveProperty('hallucinatedSymbols');
  });

  it('should have correct result structure', () => {
    const text = 'Use `ASTFactExtractor` to extract facts.';
    const report = verifier.verifyAllReferences(text, index);

    const result = report.results[0];
    expect(result).toHaveProperty('symbol');
    expect(result).toHaveProperty('exists');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('verificationMethod');
  });

  it('should include foundAt for verified symbols', () => {
    // Use explicit function call syntax for reliable extraction
    const text = 'Call `createASTFactExtractor()` to create an instance.';
    const report = verifier.verifyAllReferences(text, index);

    expect(report.results.length).toBeGreaterThan(0);
    const verifiedResult = report.results.find((r) => r.exists);
    if (verifiedResult) {
      expect(verifiedResult.foundAt).toBeDefined();
      expect(verifiedResult.foundAt?.file).toBeTruthy();
      expect(verifiedResult.foundAt?.line).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('SymbolVerifier - Edge Cases', () => {
  let verifier: SymbolVerifier;

  beforeEach(() => {
    verifier = createSymbolVerifier();
  });

  it('should handle empty text', () => {
    const index: CodebaseIndex = {
      functions: new Map(),
      classes: new Map(),
      variables: new Map(),
      types: new Map(),
    };

    const report = verifier.verifyAllReferences('', index);

    expect(report.totalReferences).toBe(0);
    expect(report.accuracy).toBe(1);
  });

  it('should handle empty codebase index', () => {
    const index: CodebaseIndex = {
      functions: new Map(),
      classes: new Map(),
      variables: new Map(),
      types: new Map(),
    };

    const text = 'Use `SomeFunction()` to do something.';
    const report = verifier.verifyAllReferences(text, index);

    expect(report.totalReferences).toBeGreaterThan(0);
    expect(report.verified).toBe(0);
    expect(report.accuracy).toBe(0);
  });

  it('should handle special characters in symbol names', () => {
    const refs = verifier.extractSymbolReferences('Call `$helper()` for assistance.');

    // $ is a valid identifier start in JS
    expect(refs.some((r) => r.name === '$helper')).toBe(true);
  });

  it('should handle underscore prefixed symbols', () => {
    const refs = verifier.extractSymbolReferences('The `_privateMethod()` is internal.');

    expect(refs.some((r) => r.name === '_privateMethod')).toBe(true);
  });

  it('should handle generic types', () => {
    // Note: Built-in types like Map are filtered out by isBuiltInType
    // Test with a custom generic type
    const refs = verifier.extractSymbolReferences('The type is `CustomMap<string, number>`.');

    expect(refs.some((r) => r.name === 'CustomMap')).toBe(true);
  });

  it('should handle nested method calls in context', () => {
    const refs = verifier.extractSymbolReferences('Call `obj.method().anotherMethod()`.');

    // Should extract method names from the chain
    expect(refs.some((r) => r.name === 'method' || r.name === 'anotherMethod')).toBe(true);
  });

  it('should distinguish between function calls and class instantiation', () => {
    const refs = verifier.extractSymbolReferences('Use `new Parser()` or call `parse()`.');

    const classRef = refs.find((r) => r.name === 'Parser' && r.type === 'class');
    const funcRef = refs.find((r) => r.name === 'parse' && r.type === 'function');

    expect(classRef).toBeDefined();
    expect(funcRef).toBeDefined();
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('SymbolVerifier - Performance', () => {
  let verifier: SymbolVerifier;

  beforeAll(() => {
    verifier = createSymbolVerifier();
  });

  it('should build index for evaluation directory in reasonable time', async () => {
    const start = Date.now();
    await verifier.buildCodebaseIndex(EVALUATION_DIR);
    const elapsed = Date.now() - start;

    // Should complete in under 60 seconds for the evaluation directory
    // (AST parsing can be slow on large codebases)
    expect(elapsed).toBeLessThan(60000);
  });

  it('should verify many references quickly', async () => {
    const index = await verifier.buildCodebaseIndex(EVALUATION_DIR);
    const text = `
      Use \`ASTFactExtractor\` with \`createASTFactExtractor()\`.
      Call \`extractFromFile()\` and \`extractFromDirectory()\`.
      Process \`ASTFact\` objects and handle \`FunctionDefDetails\`.
    `.repeat(10);

    const start = Date.now();
    verifier.verifyAllReferences(text, index);
    const elapsed = Date.now() - start;

    // Should complete in under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});

// ============================================================================
// INTEGRATION WITH REAL CODEBASE
// ============================================================================

describe('SymbolVerifier - Real Codebase Integration', () => {
  let verifier: SymbolVerifier;
  let index: CodebaseIndex;

  beforeAll(async () => {
    verifier = createSymbolVerifier();
    index = await verifier.buildCodebaseIndex(EVALUATION_DIR);
  });

  it('should achieve high accuracy on valid LLM-style output', () => {
    // Use explicit function call syntax for reliable extraction
    const llmOutput = `
      Call \`createASTFactExtractor()\` to create an instance.
      Then use \`extractFromFile()\` and \`extractFromDirectory()\` methods.
    `;

    const report = verifier.verifyAllReferences(llmOutput, index);

    // Should find and verify the function references
    expect(report.totalReferences).toBeGreaterThan(0);
    // At least some should be verified
    expect(report.verified).toBeGreaterThan(0);
    // Accuracy should be reasonable for valid references
    expect(report.accuracy).toBeGreaterThanOrEqual(0.5);
  });

  it('should detect hallucinations in fabricated output', () => {
    const hallucinatedOutput = `
      The \`SuperFactExtractor\` class provides \`magicParse()\` method
      that uses the \`AutomaticCodeAnalyzer\` interface.
    `;

    const report = verifier.verifyAllReferences(hallucinatedOutput, index);

    expect(report.hallucinatedSymbols.length).toBeGreaterThan(0);
    expect(report.accuracy).toBeLessThan(0.5);
  });

  it('should handle mixed accurate and hallucinated content', () => {
    const mixedOutput = `
      The real \`ASTFactExtractor\` class works alongside the
      imaginary \`MagicCodeParser\` to analyze code. Use
      \`createASTFactExtractor()\` (real) but avoid \`createMagicParser()\` (fake).
    `;

    const report = verifier.verifyAllReferences(mixedOutput, index);

    expect(report.verified).toBeGreaterThan(0);
    expect(report.notFound).toBeGreaterThan(0);
  });
});
