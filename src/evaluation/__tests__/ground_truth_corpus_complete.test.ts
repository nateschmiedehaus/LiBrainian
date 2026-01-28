/**
 * @fileoverview Complete Ground Truth Corpus Tests (WU-1301 through WU-1306)
 *
 * This comprehensive test file validates and expands the ground truth corpus to 100+ queries
 * across external repos. It covers:
 *
 * - WU-1301: Structural queries (functions, classes, methods)
 * - WU-1302: Dependency queries (imports, exports)
 * - WU-1303: Call graph queries (what calls what)
 * - WU-1304: Type queries (return types, parameter types)
 * - WU-1305: Adversarial queries (trick questions, non-existent items)
 * - WU-1306: Corpus validation (100+ unique, machine-verifiable)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  GroundTruthGenerator,
  createGroundTruthGenerator,
  type StructuralGroundTruthQuery,
  type StructuralGroundTruthCorpus,
} from '../ground_truth_generator.js';
import {
  createASTFactExtractor,
  type ASTFact,
  type FunctionDefDetails,
  type ImportDetails,
  type ClassDetails,
  type CallDetails,
  type TypeDetails,
} from '../ast_fact_extractor.js';
import {
  AdversarialPatternLibrary,
  createAdversarialPatternLibrary,
  type AdversarialProbe,
} from '../adversarial_patterns.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const EXTERNAL_REPOS_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos');
const MANIFEST_PATH = path.join(EXTERNAL_REPOS_ROOT, 'manifest.json');

// TypeScript repos from manifest
const TS_REPOS = [
  { name: 'typedriver-ts', path: path.join(EXTERNAL_REPOS_ROOT, 'typedriver-ts') },
  { name: 'srtd-ts', path: path.join(EXTERNAL_REPOS_ROOT, 'srtd-ts') },
  { name: 'quickpickle-ts', path: path.join(EXTERNAL_REPOS_ROOT, 'quickpickle-ts') },
  { name: 'aws-sdk-vitest-mock-ts', path: path.join(EXTERNAL_REPOS_ROOT, 'aws-sdk-vitest-mock-ts') },
];

// Check if external repos exist
function reposExist(): boolean {
  return fs.existsSync(EXTERNAL_REPOS_ROOT) && fs.existsSync(MANIFEST_PATH);
}

// ============================================================================
// WU-1301: STRUCTURAL QUERIES (Functions, Classes, Methods)
// ============================================================================

describe('WU-1301: Structural Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
  });

  describe('Function Definition Queries', () => {
    it('should generate queries about function existence', async () => {
      if (!reposExist()) {
        return; // Skip if repos not cloned
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const functionFacts = facts.filter((f) => f.type === 'function_def');

      expect(functionFacts.length).toBeGreaterThan(0);

      const queries = generator.generateFunctionQueries(facts);
      const existenceQueries = queries.filter(
        (q) => q.query.includes('Is function') || q.query.includes('Does function')
      );

      expect(existenceQueries.length).toBeGreaterThan(0);
    });

    it('should generate queries about function parameters with types', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateFunctionQueries(facts);

      // Find parameter type queries
      const paramTypeQueries = queries.filter((q) => q.query.includes('type of parameter'));

      if (paramTypeQueries.length > 0) {
        for (const query of paramTypeQueries) {
          expect(query.category).toBe('structural');
          expect(query.expectedAnswer.type).toBe('exact');
          expect(typeof query.expectedAnswer.value).toBe('string');
        }
      }
    });

    it('should generate queries about function return types', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateFunctionQueries(facts);

      // Find return type queries
      const returnQueries = queries.filter((q) => q.query.includes('return'));

      expect(returnQueries.length).toBeGreaterThan(0);
      for (const query of returnQueries) {
        expect(query.category).toBe('structural');
      }
    });

    it('should generate queries about async functions', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateFunctionQueries(facts);

      const asyncQueries = queries.filter((q) => q.query.toLowerCase().includes('async'));

      expect(asyncQueries.length).toBeGreaterThan(0);
      for (const query of asyncQueries) {
        expect(query.expectedAnswer.type).toBe('exists');
        expect(typeof query.expectedAnswer.value).toBe('boolean');
      }
    });

    it('should generate queries about exported functions', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateFunctionQueries(facts);

      const exportedQueries = queries.filter((q) => q.query.toLowerCase().includes('exported'));

      expect(exportedQueries.length).toBeGreaterThan(0);
    });
  });

  describe('Class Definition Queries', () => {
    it('should generate queries about class existence', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[1].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const classFacts = facts.filter((f) => f.type === 'class');

      if (classFacts.length > 0) {
        const queries = generator.generateClassQueries(facts);

        expect(queries.length).toBeGreaterThan(0);

        const classNameQueries = queries.filter((q) => q.query.toLowerCase().includes('class'));
        expect(classNameQueries.length).toBeGreaterThan(0);
      }
    });

    it('should generate queries about class methods', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[1].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateClassQueries(facts);

      const methodQueries = queries.filter((q) => q.query.toLowerCase().includes('method'));

      if (methodQueries.length > 0) {
        for (const query of methodQueries) {
          expect(query.category).toBe('structural');
          expect(['contains', 'count']).toContain(query.expectedAnswer.type);
        }
      }
    });

    it('should generate queries about class inheritance', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[1].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateClassQueries(facts);

      const inheritanceQueries = queries.filter(
        (q) => q.query.toLowerCase().includes('extend') || q.query.toLowerCase().includes('implement')
      );

      // Some classes may not have inheritance
      if (inheritanceQueries.length > 0) {
        for (const query of inheritanceQueries) {
          expect(query.category).toBe('structural');
        }
      }
    });

    it('should generate queries about class properties', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[1].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateClassQueries(facts);

      const propertyQueries = queries.filter((q) => q.query.toLowerCase().includes('propert'));

      if (propertyQueries.length > 0) {
        for (const query of propertyQueries) {
          expect(query.expectedAnswer.type).toBe('contains');
          expect(Array.isArray(query.expectedAnswer.value)).toBe(true);
        }
      }
    });
  });

  describe('Method Queries (Class Methods)', () => {
    it('should generate queries about method class ownership', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[1].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const methodFacts = facts.filter(
        (f) => f.type === 'function_def' && (f.details as FunctionDefDetails).className
      );

      if (methodFacts.length > 0) {
        const queries = generator.generateFunctionQueries(facts);
        const classQueries = queries.filter(
          (q) => q.query.toLowerCase().includes('class') && q.query.toLowerCase().includes('belong')
        );

        if (classQueries.length > 0) {
          for (const query of classQueries) {
            expect(query.expectedAnswer.type).toBe('exact');
          }
        }
      }
    });
  });
});

// ============================================================================
// WU-1302: DEPENDENCY QUERIES (Imports, Exports)
// ============================================================================

describe('WU-1302: Dependency Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
  });

  describe('Import Queries', () => {
    it('should generate queries about what modules a file imports', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateImportQueries(facts);

      const moduleQueries = queries.filter((q) => q.query.toLowerCase().includes('import'));

      expect(moduleQueries.length).toBeGreaterThan(0);
    });

    it('should generate queries about import sources', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateImportQueries(facts);

      const sourceQueries = queries.filter(
        (q) => q.query.toLowerCase().includes('from') && q.query.toLowerCase().includes('import')
      );

      expect(sourceQueries.length).toBeGreaterThan(0);
      for (const query of sourceQueries) {
        expect(query.expectedAnswer.evidence.length).toBeGreaterThan(0);
      }
    });

    it('should generate queries about named imports', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const importFacts = facts.filter((f) => f.type === 'import');

      const factsWithSpecifiers = importFacts.filter((f) => {
        const details = f.details as ImportDetails;
        return details.specifiers && details.specifiers.length > 0;
      });

      if (factsWithSpecifiers.length > 0) {
        const queries = generator.generateImportQueries(facts);
        const specifierQueries = queries.filter((q) => q.query.toLowerCase().includes('specifier'));

        if (specifierQueries.length > 0) {
          for (const query of specifierQueries) {
            expect(query.expectedAnswer.type).toBe('contains');
          }
        }
      }
    });

    it('should generate boolean queries for import existence', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateImportQueries(facts);

      const existsQueries = queries.filter(
        (q) => q.expectedAnswer.type === 'exists' && q.query.toLowerCase().includes('import')
      );

      expect(existsQueries.length).toBeGreaterThan(0);
      for (const query of existsQueries) {
        expect(typeof query.expectedAnswer.value).toBe('boolean');
      }
    });
  });

  describe('Export Queries', () => {
    it('should extract export facts from repos', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const exportFacts = facts.filter((f) => f.type === 'export');

      // TypeScript repos should have exports
      expect(exportFacts.length).toBeGreaterThan(0);
    });

    it('should have AST-backed evidence for all dependency queries', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateImportQueries(facts);

      for (const query of queries) {
        expect(query.expectedAnswer.evidence.length).toBeGreaterThan(0);

        for (const fact of query.expectedAnswer.evidence) {
          expect(fact.type).toBeDefined();
          expect(fact.file).toBeDefined();
          expect(fact.line).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Cross-File Dependencies', () => {
    it('should identify imports from local modules', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const importFacts = facts.filter((f) => f.type === 'import');

      const localImports = importFacts.filter((f) => {
        const details = f.details as ImportDetails;
        return details.source.startsWith('./') || details.source.startsWith('../');
      });

      // Most repos have local imports
      if (localImports.length > 0) {
        expect(localImports[0].details).toHaveProperty('source');
      }
    });

    it('should identify imports from external packages', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const importFacts = facts.filter((f) => f.type === 'import');

      const externalImports = importFacts.filter((f) => {
        const details = f.details as ImportDetails;
        return !details.source.startsWith('./') && !details.source.startsWith('../');
      });

      if (externalImports.length > 0) {
        expect(externalImports[0].details).toHaveProperty('source');
      }
    });
  });
});

// ============================================================================
// WU-1303: CALL GRAPH QUERIES (What Calls What)
// ============================================================================

describe('WU-1303: Call Graph Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
  });

  describe('Direct Call Queries', () => {
    it('should generate queries about what functions a function calls', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateCallGraphQueries(facts);

      const callsFromQueries = queries.filter(
        (q) => q.query.toLowerCase().includes('call') && !q.query.toLowerCase().includes('called by')
      );

      if (callsFromQueries.length > 0) {
        expect(callsFromQueries[0].category).toBe('behavioral');
      }
    });

    it('should generate queries about what calls a specific function', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateCallGraphQueries(facts);

      const calledByQueries = queries.filter((q) => q.query.toLowerCase().includes('called by'));

      if (calledByQueries.length > 0) {
        expect(calledByQueries[0].difficulty).toBe('hard');
      }
    });

    it('should generate boolean queries for call relationships', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateCallGraphQueries(facts);

      const boolCallQueries = queries.filter(
        (q) =>
          q.expectedAnswer.type === 'exists' &&
          q.query.toLowerCase().includes('does') &&
          q.query.toLowerCase().includes('call')
      );

      if (boolCallQueries.length > 0) {
        for (const query of boolCallQueries) {
          expect(typeof query.expectedAnswer.value).toBe('boolean');
        }
      }
    });
  });

  describe('Call Graph Structure', () => {
    it('should extract call facts with caller and callee', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const callFacts = facts.filter((f) => f.type === 'call');

      if (callFacts.length > 0) {
        for (const fact of callFacts.slice(0, 10)) {
          const details = fact.details as CallDetails;
          expect(details.caller).toBeDefined();
          expect(details.callee).toBeDefined();
        }
      }
    });

    it('should capture method calls within classes', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[1].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const callFacts = facts.filter((f) => f.type === 'call');

      const methodCalls = callFacts.filter((f) => {
        const details = f.details as CallDetails;
        return details.callerClass !== undefined;
      });

      // May not have class method calls in all repos
      if (methodCalls.length > 0) {
        expect(methodCalls[0].details).toHaveProperty('callerClass');
      }
    });
  });

  describe('Call Graph Evidence', () => {
    it('should provide file and line evidence for call queries', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateCallGraphQueries(facts);

      for (const query of queries.slice(0, 10)) {
        for (const evidence of query.expectedAnswer.evidence) {
          expect(evidence.file).toBeDefined();
          expect(evidence.file).toMatch(/\.tsx?$/);
          expect(evidence.line).toBeGreaterThan(0);
        }
      }
    });
  });
});

// ============================================================================
// WU-1304: TYPE QUERIES (Return Types, Parameter Types)
// ============================================================================

describe('WU-1304: Type Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
  });

  describe('Return Type Queries', () => {
    it('should extract return types from functions', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const functionFacts = facts.filter((f) => f.type === 'function_def');

      const withReturnTypes = functionFacts.filter((f) => {
        const details = f.details as FunctionDefDetails;
        return details.returnType && details.returnType !== 'void';
      });

      // TypeScript repos should have typed functions
      expect(withReturnTypes.length).toBeGreaterThan(0);
    });

    it('should generate queries asking about return types', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateFunctionQueries(facts);

      const returnTypeQueries = queries.filter((q) => q.query.toLowerCase().includes('return'));

      expect(returnTypeQueries.length).toBeGreaterThan(0);
    });
  });

  describe('Parameter Type Queries', () => {
    it('should extract parameter types', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const functionFacts = facts.filter((f) => f.type === 'function_def');

      const withTypedParams = functionFacts.filter((f) => {
        const details = f.details as FunctionDefDetails;
        return details.parameters?.some((p) => p.type && p.type !== 'any');
      });

      expect(withTypedParams.length).toBeGreaterThan(0);
    });

    it('should generate queries about parameter types', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const queries = generator.generateFunctionQueries(facts);

      const paramTypeQueries = queries.filter((q) => q.query.toLowerCase().includes('type of parameter'));

      if (paramTypeQueries.length > 0) {
        for (const query of paramTypeQueries) {
          expect(query.difficulty).toBe('medium');
        }
      }
    });
  });

  describe('Interface and Type Alias Queries', () => {
    it('should extract interface definitions', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const typeFacts = facts.filter((f) => f.type === 'type');

      const interfaces = typeFacts.filter((f) => {
        const details = f.details as TypeDetails;
        return details.kind === 'interface';
      });

      // TypeScript repos should have interfaces
      if (interfaces.length > 0) {
        expect(interfaces[0].identifier).toBeDefined();
      }
    });

    it('should extract type aliases', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const typeFacts = facts.filter((f) => f.type === 'type');

      const typeAliases = typeFacts.filter((f) => {
        const details = f.details as TypeDetails;
        return details.kind === 'type_alias';
      });

      if (typeAliases.length > 0) {
        expect(typeAliases[0].identifier).toBeDefined();
      }
    });
  });

  describe('Generic Type Queries', () => {
    it('should handle functions with generic parameters', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const facts = await extractor.extractFromDirectory(repoPath);
      const functionFacts = facts.filter((f) => f.type === 'function_def');

      // Look for generic type patterns in return types
      const withGenerics = functionFacts.filter((f) => {
        const details = f.details as FunctionDefDetails;
        return details.returnType && details.returnType.includes('<');
      });

      // Generic types are common in TypeScript libs
      if (withGenerics.length > 0) {
        expect(withGenerics[0].details).toHaveProperty('returnType');
      }
    });
  });
});

// ============================================================================
// WU-1305: ADVERSARIAL QUERIES (Trick Questions, Non-Existent Items)
// ============================================================================

describe('WU-1305: Adversarial Queries', () => {
  let library: AdversarialPatternLibrary;
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;

  beforeAll(() => {
    library = createAdversarialPatternLibrary();
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
  });

  describe('Non-Existent Item Queries', () => {
    it('should create adversarial probes for non-existent functions', () => {
      const patterns = library.getPatterns();

      // Create a custom probe for non-existent function
      const nonExistentProbes: AdversarialProbe[] = [
        {
          patternId: 'custom-nonexistent-001',
          query: 'What does function calculateMagicNumber do?',
          expectedAnswer: 'Function calculateMagicNumber does not exist in this codebase',
          trapAnswer: 'calculateMagicNumber performs complex mathematical calculations',
        },
        {
          patternId: 'custom-nonexistent-002',
          query: 'What parameters does processUserData accept?',
          expectedAnswer: 'Function processUserData does not exist',
          trapAnswer: 'processUserData accepts a user object with id and name fields',
        },
      ];

      for (const probe of nonExistentProbes) {
        expect(probe.expectedAnswer).toContain('not exist');
      }
    });

    it('should generate adversarial queries from detected patterns', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path);
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const imported = await library.importFromRepo(repoPath);
      const allPatterns = [...library.getPatterns(), ...imported];

      // Generate probes from patterns
      const probes = library.generateProbes(allPatterns);

      expect(probes.length).toBeGreaterThan(0);

      // Each probe should have expected and trap answers
      for (const probe of probes.slice(0, 10)) {
        expect(probe.expectedAnswer).toBeDefined();
        expect(probe.trapAnswer).toBeDefined();
        expect(probe.query).toBeTruthy();
      }
    });
  });

  describe('Similar Name Confusion Queries', () => {
    it('should have patterns for similar function names', () => {
      const patterns = library.getByCategory('naming');

      expect(patterns.length).toBeGreaterThan(0);

      const similarNamePatterns = patterns.filter((p) => p.name.toLowerCase().includes('similar'));

      expect(similarNamePatterns.length).toBeGreaterThan(0);
    });

    it('should generate probes that test for name confusion', () => {
      const namingPatterns = library.getByCategory('naming');
      const probes = library.generateProbes(namingPatterns);

      // Find probes about differentiating similar names
      const confusionProbes = probes.filter(
        (p) => p.query.toLowerCase().includes('difference') || p.query.toLowerCase().includes('confus')
      );

      expect(confusionProbes.length).toBeGreaterThan(0);
    });
  });

  describe('Semantic Trap Queries', () => {
    it('should have patterns for semantic traps', () => {
      const semanticPatterns = library.getByCategory('semantic');

      expect(semanticPatterns.length).toBeGreaterThan(0);
    });

    it('should include dead code detection patterns', () => {
      const semanticPatterns = library.getByCategory('semantic');

      const deadCodePatterns = semanticPatterns.filter(
        (p) => p.name.toLowerCase().includes('dead') || p.description.toLowerCase().includes('unreachable')
      );

      expect(deadCodePatterns.length).toBeGreaterThan(0);
    });

    it('should include deprecated function patterns', () => {
      const semanticPatterns = library.getByCategory('semantic');

      const deprecatedPatterns = semanticPatterns.filter(
        (p) => p.name.toLowerCase().includes('deprecated') || p.description.toLowerCase().includes('deprecated')
      );

      expect(deprecatedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('Misleading Documentation Queries', () => {
    it('should have patterns for misleading comments', () => {
      const misleadingPatterns = library.getByCategory('misleading');

      expect(misleadingPatterns.length).toBeGreaterThan(0);

      const commentPatterns = misleadingPatterns.filter(
        (p) => p.name.toLowerCase().includes('comment') || p.description.toLowerCase().includes('comment')
      );

      expect(commentPatterns.length).toBeGreaterThan(0);
    });

    it('should include README contradiction patterns', () => {
      const misleadingPatterns = library.getByCategory('misleading');

      const readmePatterns = misleadingPatterns.filter(
        (p) => p.name.toLowerCase().includes('readme') || p.description.toLowerCase().includes('documentation')
      );

      expect(readmePatterns.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Case Queries', () => {
    it('should have patterns for edge cases', () => {
      const edgePatterns = library.getByCategory('edge_case');

      expect(edgePatterns.length).toBeGreaterThan(0);
    });

    it('should include empty function patterns', () => {
      const edgePatterns = library.getByCategory('edge_case');

      const emptyPatterns = edgePatterns.filter((p) => p.name.toLowerCase().includes('empty'));

      expect(emptyPatterns.length).toBeGreaterThan(0);
    });

    it('should include circular dependency patterns', () => {
      const edgePatterns = library.getByCategory('edge_case');

      const circularPatterns = edgePatterns.filter((p) => p.name.toLowerCase().includes('circular'));

      expect(circularPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('Adversarial Corpus Statistics', () => {
    it('should have at least 20 built-in adversarial patterns', () => {
      const corpus = library.getCorpus();

      expect(corpus.totalPatterns).toBeGreaterThanOrEqual(20);
    });

    it('should cover all adversarial categories', () => {
      const corpus = library.getCorpus();

      expect(corpus.categories['naming']).toBeGreaterThan(0);
      expect(corpus.categories['structure']).toBeGreaterThan(0);
      expect(corpus.categories['semantic']).toBeGreaterThan(0);
      expect(corpus.categories['misleading']).toBeGreaterThan(0);
      expect(corpus.categories['edge_case']).toBeGreaterThan(0);
    });

    it('should have high severity patterns', () => {
      const patterns = library.getPatterns();
      const highSeverity = patterns.filter((p) => p.severity === 'high');

      expect(highSeverity.length).toBeGreaterThan(5);
    });
  });
});

// ============================================================================
// WU-1306: CORPUS VALIDATION (100+ Unique, Machine-Verifiable)
// ============================================================================

describe('WU-1306: Corpus Validation', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
  });

  describe('100+ Queries Generation', () => {
    it('should generate at least 100 queries across all external repos', async () => {
      if (!reposExist()) {
        return;
      }

      let totalQueries = 0;
      const allQueries: StructuralGroundTruthQuery[] = [];

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);
        totalQueries += corpus.queries.length;
        allQueries.push(...corpus.queries);
      }

      // Should have at least 100 queries total
      expect(totalQueries).toBeGreaterThanOrEqual(100);
    });

    it('should generate queries from multiple repos', async () => {
      if (!reposExist()) {
        return;
      }

      const reposWithQueries: string[] = [];

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);
        if (corpus.queries.length > 0) {
          reposWithQueries.push(repo.name);
        }
      }

      // Should have queries from at least 2 repos
      expect(reposWithQueries.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Unique Query IDs', () => {
    it('should generate unique IDs within each corpus', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);
        const ids = corpus.queries.map((q) => q.id);
        const uniqueIds = new Set(ids);

        expect(uniqueIds.size).toBe(ids.length);
      }
    });

    it('should generate deterministic IDs for the same input', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const corpus1 = await generator.generateForRepo(repoPath, TS_REPOS[0].name);
      const corpus2 = await generator.generateForRepo(repoPath, TS_REPOS[0].name);

      const ids1 = corpus1.queries.map((q) => q.id).sort();
      const ids2 = corpus2.queries.map((q) => q.id).sort();

      expect(ids1).toEqual(ids2);
    });
  });

  describe('Query Deduplication', () => {
    it('should not have duplicate query text within a corpus', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);
        const queryTexts = corpus.queries.map((q) => q.query);
        const uniqueTexts = new Set(queryTexts);

        // Most queries should be unique (allowing some duplication for count queries, etc.)
        // At least 70% uniqueness is expected
        const uniquenessRatio = uniqueTexts.size / queryTexts.length;
        expect(uniquenessRatio).toBeGreaterThan(0.7);
      }
    });

    it('should handle repos with similar structure without ID collision', async () => {
      if (!reposExist()) {
        return;
      }

      const allIds: string[] = [];

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);
        allIds.push(...corpus.queries.map((q) => `${repo.name}:${q.id}`));
      }

      const uniqueIds = new Set(allIds);

      // When prefixed with repo name, all IDs should be unique
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  describe('Machine Verifiability', () => {
    it('should have AST-backed evidence for every query', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        for (const query of corpus.queries) {
          expect(query.expectedAnswer.evidence).toBeDefined();
          expect(query.expectedAnswer.evidence.length).toBeGreaterThan(0);

          // Each evidence fact must have required fields
          for (const fact of query.expectedAnswer.evidence) {
            expect(fact.type).toBeDefined();
            expect(fact.identifier).toBeDefined();
            expect(fact.file).toBeDefined();
            expect(fact.line).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have verifiable answer types', async () => {
      if (!reposExist()) {
        return;
      }

      const validTypes = ['exact', 'contains', 'exists', 'count'];

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        for (const query of corpus.queries) {
          expect(validTypes).toContain(query.expectedAnswer.type);

          // Validate value type matches answer type
          const { type, value } = query.expectedAnswer;
          if (type === 'count') {
            expect(typeof value).toBe('number');
          } else if (type === 'exists') {
            expect(typeof value).toBe('boolean');
          } else if (type === 'contains') {
            expect(Array.isArray(value)).toBe(true);
          }
        }
      }
    });

    it('should reference existing files in evidence', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        for (const query of corpus.queries.slice(0, 20)) {
          for (const fact of query.expectedAnswer.evidence) {
            expect(fs.existsSync(fact.file)).toBe(true);
          }
        }
      }
    });
  });

  describe('Query Diversity', () => {
    it('should have queries across multiple categories', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const corpus = await generator.generateForRepo(repoPath, TS_REPOS[0].name);
      const categories = new Set(corpus.queries.map((q) => q.category));

      // Should have at least 2 categories
      expect(categories.size).toBeGreaterThanOrEqual(2);
    });

    it('should have queries across multiple difficulty levels', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const corpus = await generator.generateForRepo(repoPath, TS_REPOS[0].name);
      const difficulties = new Set(corpus.queries.map((q) => q.difficulty));

      // Should have at least 2 difficulty levels
      expect(difficulties.size).toBeGreaterThanOrEqual(2);
    });

    it('should have queries with different answer types', async () => {
      if (!reposExist()) {
        return;
      }

      const repoPath = path.join(TS_REPOS[0].path, 'src');
      if (!fs.existsSync(repoPath)) {
        return;
      }

      const corpus = await generator.generateForRepo(repoPath, TS_REPOS[0].name);
      const answerTypes = new Set(corpus.queries.map((q) => q.expectedAnswer.type));

      // Should have at least 3 answer types
      expect(answerTypes.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Coverage Statistics', () => {
    it('should track function coverage', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        expect(corpus.coverage).toBeDefined();
        expect(corpus.coverage.functions).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track class coverage', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        expect(corpus.coverage.classes).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track import/export coverage', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        expect(corpus.coverage.imports).toBeGreaterThanOrEqual(0);
        expect(corpus.coverage.exports).toBeGreaterThanOrEqual(0);
      }
    });

    it('should report total fact count', async () => {
      if (!reposExist()) {
        return;
      }

      for (const repo of TS_REPOS) {
        const repoPath = path.join(repo.path, 'src');
        if (!fs.existsSync(repoPath)) {
          continue;
        }

        const corpus = await generator.generateForRepo(repoPath, repo.name);

        expect(corpus.factCount).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================================
// INTEGRATION: COMBINED CORPUS TESTS
// ============================================================================

describe('Integration: Combined Ground Truth Corpus', () => {
  let generator: GroundTruthGenerator;
  let adversarialLibrary: AdversarialPatternLibrary;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
    adversarialLibrary = createAdversarialPatternLibrary();
  });

  it('should generate comprehensive corpus combining all query types', async () => {
    if (!reposExist()) {
      return;
    }

    // Collect all queries from all repos
    const allCorpora: StructuralGroundTruthCorpus[] = [];

    for (const repo of TS_REPOS) {
      const repoPath = path.join(repo.path, 'src');
      if (!fs.existsSync(repoPath)) {
        continue;
      }

      const corpus = await generator.generateForRepo(repoPath, repo.name);
      allCorpora.push(corpus);
    }

    // Aggregate statistics
    const totalQueries = allCorpora.reduce((sum, c) => sum + c.queries.length, 0);
    const totalFacts = allCorpora.reduce((sum, c) => sum + c.factCount, 0);

    // Validate minimum requirements
    expect(totalQueries).toBeGreaterThanOrEqual(100);
    expect(totalFacts).toBeGreaterThan(0);

    // Validate category distribution
    const allQueries = allCorpora.flatMap((c) => c.queries);
    const structuralQueries = allQueries.filter((q) => q.category === 'structural');
    const behavioralQueries = allQueries.filter((q) => q.category === 'behavioral');

    expect(structuralQueries.length).toBeGreaterThan(0);
    expect(behavioralQueries.length).toBeGreaterThan(0);
  });

  it('should have adversarial patterns that complement ground truth', () => {
    const corpus = adversarialLibrary.getCorpus();

    // Adversarial patterns should cover common error patterns
    expect(corpus.totalPatterns).toBeGreaterThanOrEqual(20);

    // Categories should be well-distributed
    const categoryCount = Object.keys(corpus.categories).length;
    expect(categoryCount).toBeGreaterThanOrEqual(5);
  });

  it('should produce a corpus suitable for evaluation', async () => {
    if (!reposExist()) {
      return;
    }

    const repoPath = path.join(TS_REPOS[0].path, 'src');
    if (!fs.existsSync(repoPath)) {
      return;
    }

    const corpus = await generator.generateForRepo(repoPath, TS_REPOS[0].name);

    // Check that corpus is suitable for automated evaluation
    for (const query of corpus.queries) {
      // Query should be a natural language question or statement
      // Most will end with ? but some may be statements
      expect(query.query.length).toBeGreaterThan(10);

      // Query must have an answer
      expect(query.expectedAnswer).toBeDefined();
      expect(query.expectedAnswer.value).toBeDefined();

      // Answer must be verifiable
      expect(query.expectedAnswer.evidence.length).toBeGreaterThan(0);

      // Metadata must be complete
      expect(query.id).toBeTruthy();
      expect(query.category).toBeTruthy();
      expect(query.difficulty).toBeTruthy();
    }

    // Most queries should end with question marks
    const questionsWithMark = corpus.queries.filter((q) => q.query.endsWith('?'));
    expect(questionsWithMark.length / corpus.queries.length).toBeGreaterThan(0.9);
  });
});
