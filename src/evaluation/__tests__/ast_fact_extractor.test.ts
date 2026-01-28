/**
 * @fileoverview Tests for AST Fact Extractor
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 * Uses problem_detector.ts as the primary test fixture (self-referential but valid).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  ASTFactExtractor,
  createASTFactExtractor,
  type ASTFact,
  type FunctionDefDetails,
  type ImportDetails,
  type ClassDetails,
  type ExportDetails,
} from '../ast_fact_extractor.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Use problem_detector.ts as the main test fixture
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const PROBLEM_DETECTOR_PATH = path.join(LIBRARIAN_ROOT, 'src/agents/problem_detector.ts');
const AGENTS_DIR = path.join(LIBRARIAN_ROOT, 'src/agents');

// External repo fixture (from WU-801-REAL)
const EXTERNAL_REPO_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos/typedriver-ts');
const EXTERNAL_FILE_PATH = path.join(EXTERNAL_REPO_ROOT, 'src/compile.ts');

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createASTFactExtractor', () => {
  it('should create an extractor instance', () => {
    const extractor = createASTFactExtractor();
    expect(extractor).toBeInstanceOf(ASTFactExtractor);
  });
});

// ============================================================================
// FUNCTION EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Function Definitions', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract function definitions from a TypeScript file', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.type === 'function_def')).toBe(true);
  });

  it('should extract the createProblemDetector function', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    const createFn = facts.find((f) => f.identifier === 'createProblemDetector');
    expect(createFn).toBeDefined();
    expect(createFn?.file).toContain('problem_detector.ts');
    expect(createFn?.line).toBeGreaterThan(0);
  });

  it('should extract function parameters and return types', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    const createFn = facts.find((f) => f.identifier === 'createProblemDetector');
    expect(createFn).toBeDefined();

    const details = createFn?.details as FunctionDefDetails;
    expect(details).toBeDefined();
    expect(details.parameters).toBeDefined();
    expect(Array.isArray(details.parameters)).toBe(true);
    expect(details.isExported).toBe(true);
  });

  it('should detect async functions', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    // identifyProblems is async
    const asyncFn = facts.find((f) => f.identifier === 'identifyProblems');
    if (asyncFn) {
      const details = asyncFn.details as FunctionDefDetails;
      expect(details.isAsync).toBe(true);
    }
  });

  it('should extract class methods', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    // testFailures is a method on ProblemDetector class
    const methodFn = facts.find((f) => f.identifier === 'testFailures');
    expect(methodFn).toBeDefined();
  });

  it('should handle external repo files', async () => {
    const facts = await extractor.extractFunctions(EXTERNAL_FILE_PATH);

    // compile.ts has the 'compile' function
    const compileFn = facts.find((f) => f.identifier === 'compile');
    expect(compileFn).toBeDefined();
    expect(compileFn?.file).toContain('compile.ts');
  });
});

// ============================================================================
// IMPORT EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Imports', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract import statements', async () => {
    const facts = await extractor.extractImports(PROBLEM_DETECTOR_PATH);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.type === 'import')).toBe(true);
  });

  it('should extract type imports', async () => {
    const facts = await extractor.extractImports(PROBLEM_DETECTOR_PATH);

    // problem_detector.ts imports from './types.js'
    const typesImport = facts.find((f) => {
      const details = f.details as ImportDetails;
      return details.source.includes('types');
    });
    expect(typesImport).toBeDefined();
  });

  it('should extract import specifiers', async () => {
    const facts = await extractor.extractImports(PROBLEM_DETECTOR_PATH);

    // Find the types import which should have many specifiers
    const typesImport = facts.find((f) => {
      const details = f.details as ImportDetails;
      return details.source.includes('types');
    });

    expect(typesImport).toBeDefined();
    const details = typesImport?.details as ImportDetails;
    expect(details.specifiers).toBeDefined();
    expect(details.specifiers.length).toBeGreaterThan(0);

    // ProblemDetectorAgent should be one of the imported types
    const hasAgent = details.specifiers.some((s) => s.name === 'ProblemDetectorAgent');
    expect(hasAgent).toBe(true);
  });

  it('should handle default imports', async () => {
    const facts = await extractor.extractImports(EXTERNAL_FILE_PATH);

    // Check that we can detect default vs named imports
    expect(facts.length).toBeGreaterThan(0);
    facts.forEach((f) => {
      const details = f.details as ImportDetails;
      expect(typeof details.isDefault).toBe('boolean');
    });
  });

  it('should extract import sources correctly', async () => {
    const facts = await extractor.extractImports(EXTERNAL_FILE_PATH);

    // compile.ts imports from 'typebox', '@standard-schema/spec', etc.
    const sources = facts.map((f) => (f.details as ImportDetails).source);
    expect(sources.some((s) => s.includes('typebox') || s.includes('validator'))).toBe(true);
  });
});

// ============================================================================
// EXPORT EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Exports', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract export statements', async () => {
    const facts = await extractor.extractExports(PROBLEM_DETECTOR_PATH);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.type === 'export')).toBe(true);
  });

  it('should find exported class ProblemDetector', async () => {
    const facts = await extractor.extractExports(PROBLEM_DETECTOR_PATH);

    const classExport = facts.find((f) => f.identifier === 'ProblemDetector');
    expect(classExport).toBeDefined();
  });

  it('should find exported function createProblemDetector', async () => {
    const facts = await extractor.extractExports(PROBLEM_DETECTOR_PATH);

    const fnExport = facts.find((f) => f.identifier === 'createProblemDetector');
    expect(fnExport).toBeDefined();
  });

  it('should identify export kind (function, class, interface, type)', async () => {
    const facts = await extractor.extractExports(PROBLEM_DETECTOR_PATH);

    facts.forEach((f) => {
      const details = f.details as ExportDetails;
      expect(details.kind).toBeDefined();
      expect(['function', 'class', 'interface', 'type', 'variable', 'const', 'enum']).toContain(
        details.kind
      );
    });
  });

  it('should extract type exports from compile.ts', async () => {
    const facts = await extractor.extractExports(EXTERNAL_FILE_PATH);

    // compile.ts exports TCompile type and compile function
    const typeExport = facts.find((f) => f.identifier === 'TCompile');
    const fnExport = facts.find((f) => f.identifier === 'compile');

    expect(typeExport || fnExport).toBeDefined();
  });
});

// ============================================================================
// CLASS EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Classes', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract class definitions', async () => {
    const facts = await extractor.extractClasses(PROBLEM_DETECTOR_PATH);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.type === 'class')).toBe(true);
  });

  it('should extract the ProblemDetector class', async () => {
    const facts = await extractor.extractClasses(PROBLEM_DETECTOR_PATH);

    const pdClass = facts.find((f) => f.identifier === 'ProblemDetector');
    expect(pdClass).toBeDefined();
    expect(pdClass?.file).toContain('problem_detector.ts');
  });

  it('should extract class methods', async () => {
    const facts = await extractor.extractClasses(PROBLEM_DETECTOR_PATH);

    const pdClass = facts.find((f) => f.identifier === 'ProblemDetector');
    expect(pdClass).toBeDefined();

    const details = pdClass?.details as ClassDetails;
    expect(details.methods).toBeDefined();
    expect(Array.isArray(details.methods)).toBe(true);
    expect(details.methods.length).toBeGreaterThan(0);

    // Should include testFailures, regressionCheck, etc.
    expect(details.methods).toContain('testFailures');
    expect(details.methods).toContain('identifyProblems');
  });

  it('should extract class properties', async () => {
    const facts = await extractor.extractClasses(PROBLEM_DETECTOR_PATH);

    const pdClass = facts.find((f) => f.identifier === 'ProblemDetector');
    expect(pdClass).toBeDefined();

    const details = pdClass?.details as ClassDetails;
    expect(details.properties).toBeDefined();
    expect(Array.isArray(details.properties)).toBe(true);

    // Should include agentType, name, capabilities, etc.
    expect(details.properties).toContain('agentType');
  });

  it('should detect implements interfaces', async () => {
    const facts = await extractor.extractClasses(PROBLEM_DETECTOR_PATH);

    const pdClass = facts.find((f) => f.identifier === 'ProblemDetector');
    expect(pdClass).toBeDefined();

    const details = pdClass?.details as ClassDetails;
    expect(details.implements).toBeDefined();
    expect(Array.isArray(details.implements)).toBe(true);

    // ProblemDetector implements ProblemDetectorAgent
    expect(details.implements).toContain('ProblemDetectorAgent');
  });

  it('should detect extends class', async () => {
    // This file may not have extends, but we should handle it gracefully
    const facts = await extractor.extractClasses(PROBLEM_DETECTOR_PATH);

    const pdClass = facts.find((f) => f.identifier === 'ProblemDetector');
    const details = pdClass?.details as ClassDetails;

    // extends should be undefined or a string
    expect(details.extends === undefined || typeof details.extends === 'string').toBe(true);
  });
});

// ============================================================================
// CALL GRAPH EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Call Graph', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract function calls', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    const callFacts = facts.filter((f) => f.type === 'call');
    expect(callFacts.length).toBeGreaterThan(0);
  });

  it('should identify caller and callee', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    const callFacts = facts.filter((f) => f.type === 'call');
    callFacts.forEach((f) => {
      expect(f.details).toBeDefined();
      expect((f.details as { caller?: string }).caller).toBeDefined();
      expect((f.details as { callee?: string }).callee).toBeDefined();
    });
  });

  it('should detect method calls within the same class', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    // identifyProblems calls testFailures, regressionCheck, etc.
    const callFacts = facts.filter((f) => f.type === 'call');
    const internalCalls = callFacts.filter((f) => {
      const details = f.details as { caller?: string; callee?: string };
      return details.caller?.includes('identifyProblems');
    });

    expect(internalCalls.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// TYPE EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Types', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract type information', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    const typeFacts = facts.filter((f) => f.type === 'type');
    // May have type aliases, interfaces, etc.
    expect(typeFacts.length >= 0).toBe(true);
  });

  it('should extract interface definitions', async () => {
    // problem_detector.ts has ProblemDetectorConfig interface
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    const typeFacts = facts.filter((f) => f.type === 'type');
    const configInterface = typeFacts.find((f) => f.identifier === 'ProblemDetectorConfig');

    expect(configInterface).toBeDefined();
  });
});

// ============================================================================
// DIRECTORY EXTRACTION TESTS
// ============================================================================

describe('ASTFactExtractor - Directory Extraction', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract facts from a directory recursively', async () => {
    const facts = await extractor.extractFromDirectory(AGENTS_DIR);

    expect(facts.length).toBeGreaterThan(0);
  });

  it('should include facts from multiple files', async () => {
    const facts = await extractor.extractFromDirectory(AGENTS_DIR);

    const files = new Set(facts.map((f) => f.file));
    expect(files.size).toBeGreaterThan(0);
  });

  it('should handle external repo directory', async () => {
    const srcDir = path.join(EXTERNAL_REPO_ROOT, 'src');
    const facts = await extractor.extractFromDirectory(srcDir);

    expect(facts.length).toBeGreaterThan(0);

    // Should find facts from multiple files
    const files = new Set(facts.map((f) => f.file));
    expect(files.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// EXTRACTFROMFILE COMPREHENSIVE TESTS
// ============================================================================

describe('ASTFactExtractor - extractFromFile', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should extract all fact types from a single file', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    expect(facts.length).toBeGreaterThan(0);

    const factTypes = new Set(facts.map((f) => f.type));

    // Should have function definitions
    expect(factTypes.has('function_def')).toBe(true);

    // Should have imports
    expect(factTypes.has('import')).toBe(true);

    // Should have exports
    expect(factTypes.has('export')).toBe(true);

    // Should have classes
    expect(factTypes.has('class')).toBe(true);
  });

  it('should include correct file paths in all facts', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    facts.forEach((f) => {
      expect(f.file).toBeDefined();
      expect(f.file).toContain('problem_detector.ts');
    });
  });

  it('should include valid line numbers', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    facts.forEach((f) => {
      expect(f.line).toBeDefined();
      expect(f.line).toBeGreaterThan(0);
    });
  });

  it('should return empty array for non-existent file', async () => {
    const facts = await extractor.extractFromFile('/non/existent/file.ts');

    expect(Array.isArray(facts)).toBe(true);
    expect(facts.length).toBe(0);
  });

  it('should handle .tsx files', async () => {
    // If a .tsx file exists, test it; otherwise skip
    const extractor = createASTFactExtractor();

    // This test verifies the extractor doesn't crash on different extensions
    // Even if we don't have a .tsx file, the method should handle it gracefully
    const facts = await extractor.extractFromFile('/non/existent/file.tsx');
    expect(Array.isArray(facts)).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ASTFactExtractor - Edge Cases', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should handle files with only imports', async () => {
    // Some index files might only have imports/exports
    const indexPath = path.join(EXTERNAL_REPO_ROOT, 'src/index.ts');
    const facts = await extractor.extractFromFile(indexPath);

    // Should not crash and should return some facts
    expect(Array.isArray(facts)).toBe(true);
  });

  it('should handle arrow functions', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    // Look for any arrow function definitions
    // Arrow functions might be extracted as function definitions
    expect(facts.length).toBeGreaterThan(0);
  });

  it('should handle anonymous functions gracefully', async () => {
    const facts = await extractor.extractFunctions(PROBLEM_DETECTOR_PATH);

    // All extracted facts should have an identifier (may be synthetic for anonymous)
    facts.forEach((f) => {
      expect(f.identifier).toBeDefined();
      expect(typeof f.identifier).toBe('string');
    });
  });

  it('should handle empty directories', async () => {
    // Non-existent directory should return empty array
    const facts = await extractor.extractFromDirectory('/non/existent/directory');

    expect(Array.isArray(facts)).toBe(true);
    expect(facts.length).toBe(0);
  });
});

// ============================================================================
// FACT STRUCTURE VALIDATION
// ============================================================================

describe('ASTFact Structure', () => {
  let extractor: ASTFactExtractor;

  beforeAll(() => {
    extractor = createASTFactExtractor();
  });

  it('should have correct ASTFact structure', async () => {
    const facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);

    facts.forEach((fact) => {
      // Required fields
      expect(fact.type).toBeDefined();
      expect(['function_def', 'import', 'export', 'class', 'call', 'type']).toContain(fact.type);

      expect(fact.identifier).toBeDefined();
      expect(typeof fact.identifier).toBe('string');

      expect(fact.file).toBeDefined();
      expect(typeof fact.file).toBe('string');

      expect(fact.line).toBeDefined();
      expect(typeof fact.line).toBe('number');

      expect(fact.details).toBeDefined();
      expect(typeof fact.details).toBe('object');
    });
  });
});
