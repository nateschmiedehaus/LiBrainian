/**
 * @fileoverview Tests for Ground Truth Generator
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 * The Ground Truth Generator uses AST facts to automatically create
 * machine-verifiable query/answer pairs for evaluation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import {
  GroundTruthGenerator,
  createGroundTruthGenerator,
  type StructuralGroundTruthQuery,
  type StructuralGroundTruthAnswer,
  type StructuralGroundTruthCorpus,
} from '../ground_truth_generator.js';
import { createASTFactExtractor, type ASTFact } from '../ast_fact_extractor.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');
const AGENTS_DIR = path.join(LIBRARIAN_ROOT, 'src/agents');
const PROBLEM_DETECTOR_PATH = path.join(LIBRARIAN_ROOT, 'src/agents/problem_detector.ts');

// External repo fixture
const EXTERNAL_REPO_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos/typedriver-ts');
const EXTERNAL_SRC_DIR = path.join(EXTERNAL_REPO_ROOT, 'src');

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createGroundTruthGenerator', () => {
  it('should create a generator instance', () => {
    const generator = createGroundTruthGenerator();
    expect(generator).toBeInstanceOf(GroundTruthGenerator);
  });
});

// ============================================================================
// GENERATE FOR REPO TESTS
// ============================================================================

describe('GroundTruthGenerator - generateForRepo', () => {
  let generator: GroundTruthGenerator;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
  });

  it('should generate a corpus for a repository', async () => {
    const corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');

    expect(corpus).toBeDefined();
    expect(corpus.repoName).toBe('agents');
    expect(corpus.repoPath).toBe(AGENTS_DIR);
    expect(corpus.generatedAt).toBeDefined();
    // Validate ISO timestamp format
    expect(() => new Date(corpus.generatedAt)).not.toThrow();
  });

  it('should generate at least 50 queries per repo', async () => {
    const corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');

    expect(corpus.queries.length).toBeGreaterThanOrEqual(50);
  });

  it('should include fact count in corpus', async () => {
    const corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');

    expect(corpus.factCount).toBeGreaterThan(0);
  });

  it('should include coverage statistics', async () => {
    const corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');

    expect(corpus.coverage).toBeDefined();
    expect(typeof corpus.coverage.functions).toBe('number');
    expect(typeof corpus.coverage.classes).toBe('number');
    expect(typeof corpus.coverage.imports).toBe('number');
    expect(typeof corpus.coverage.exports).toBe('number');
  });

  it('should handle external repos', async () => {
    const corpus = await generator.generateForRepo(EXTERNAL_SRC_DIR, 'typedriver-ts');

    expect(corpus).toBeDefined();
    expect(corpus.queries.length).toBeGreaterThan(0);
    expect(corpus.repoName).toBe('typedriver-ts');
  });

  it('should return empty corpus for non-existent directory', async () => {
    const corpus = await generator.generateForRepo('/non/existent/dir', 'nonexistent');

    expect(corpus).toBeDefined();
    expect(corpus.queries.length).toBe(0);
    expect(corpus.factCount).toBe(0);
  });
});

// ============================================================================
// QUERY STRUCTURE TESTS
// ============================================================================

describe('GroundTruthGenerator - Query Structure', () => {
  let generator: GroundTruthGenerator;
  let corpus: StructuralGroundTruthCorpus;

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');
  });

  it('should generate queries with required fields', () => {
    for (const query of corpus.queries) {
      expect(query.id).toBeDefined();
      expect(typeof query.id).toBe('string');
      expect(query.id.length).toBeGreaterThan(0);

      expect(query.query).toBeDefined();
      expect(typeof query.query).toBe('string');
      expect(query.query.length).toBeGreaterThan(0);

      expect(query.category).toBeDefined();
      expect(['structural', 'behavioral', 'architectural']).toContain(query.category);

      expect(query.difficulty).toBeDefined();
      expect(['easy', 'medium', 'hard']).toContain(query.difficulty);

      expect(query.expectedAnswer).toBeDefined();
    }
  });

  it('should generate unique query IDs', () => {
    const ids = corpus.queries.map((q) => q.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should generate queries with expected answer structure', () => {
    for (const query of corpus.queries) {
      const answer = query.expectedAnswer;

      expect(answer.type).toBeDefined();
      expect(['exact', 'contains', 'exists', 'count']).toContain(answer.type);

      expect(answer.value).toBeDefined();
      // Value can be string, string[], number, or boolean

      expect(answer.evidence).toBeDefined();
      expect(Array.isArray(answer.evidence)).toBe(true);
      expect(answer.evidence.length).toBeGreaterThan(0);
    }
  });

  it('should include valid evidence (AST facts) for each query', () => {
    for (const query of corpus.queries) {
      for (const fact of query.expectedAnswer.evidence) {
        expect(fact.type).toBeDefined();
        expect(['function_def', 'import', 'export', 'class', 'call', 'type']).toContain(fact.type);
        expect(fact.identifier).toBeDefined();
        expect(fact.file).toBeDefined();
        expect(fact.line).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// FUNCTION QUERY TESTS
// ============================================================================

describe('GroundTruthGenerator - Function Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;
  let facts: ASTFact[];

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
    facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);
  });

  it('should generate function parameter queries', () => {
    const queries = generator.generateFunctionQueries(facts);

    // Find a query about parameters
    const paramQuery = queries.find((q) => q.query.toLowerCase().includes('parameter'));
    expect(paramQuery).toBeDefined();
    expect(paramQuery?.category).toBe('structural');
  });

  it('should generate function return type queries', () => {
    const queries = generator.generateFunctionQueries(facts);

    // Find a query about return types
    const returnQuery = queries.find((q) => q.query.toLowerCase().includes('return'));
    expect(returnQuery).toBeDefined();
  });

  it('should generate async function queries', () => {
    const queries = generator.generateFunctionQueries(facts);

    // Find a query about async
    const asyncQuery = queries.find((q) => q.query.toLowerCase().includes('async'));
    expect(asyncQuery).toBeDefined();
    expect(asyncQuery?.expectedAnswer.type).toBe('exists');
  });

  it('should generate function count queries', () => {
    const queries = generator.generateFunctionQueries(facts);

    // Find a count query
    const countQuery = queries.find((q) => q.query.toLowerCase().includes('how many'));
    expect(countQuery).toBeDefined();
    expect(countQuery?.expectedAnswer.type).toBe('count');
    expect(typeof countQuery?.expectedAnswer.value).toBe('number');
  });

  it('should generate exact match queries for function parameters', () => {
    const queries = generator.generateFunctionQueries(facts);

    // Find an exact match query
    const exactQuery = queries.find(
      (q) => q.expectedAnswer.type === 'exact' && q.query.toLowerCase().includes('parameter')
    );
    expect(exactQuery).toBeDefined();
  });
});

// ============================================================================
// IMPORT QUERY TESTS
// ============================================================================

describe('GroundTruthGenerator - Import Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;
  let facts: ASTFact[];

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
    facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);
  });

  it('should generate import module queries', () => {
    const queries = generator.generateImportQueries(facts);

    // Find a query about what modules are imported
    const importQuery = queries.find((q) => q.query.toLowerCase().includes('import'));
    expect(importQuery).toBeDefined();
    expect(importQuery?.category).toBe('structural');
  });

  it('should generate queries about import sources', () => {
    const queries = generator.generateImportQueries(facts);

    // Find a query about where something is imported from
    const sourceQuery = queries.find((q) => q.query.toLowerCase().includes('from'));
    expect(sourceQuery).toBeDefined();
  });

  it('should generate boolean import queries', () => {
    const queries = generator.generateImportQueries(facts);

    // Find a boolean query
    const boolQuery = queries.find(
      (q) => q.expectedAnswer.type === 'exists' && q.query.toLowerCase().includes('import')
    );
    expect(boolQuery).toBeDefined();
    expect(typeof boolQuery?.expectedAnswer.value).toBe('boolean');
  });

  it('should generate contains queries for import specifiers', () => {
    const queries = generator.generateImportQueries(facts);

    // Find a contains query
    const containsQuery = queries.find((q) => q.expectedAnswer.type === 'contains');
    expect(containsQuery).toBeDefined();
    expect(Array.isArray(containsQuery?.expectedAnswer.value)).toBe(true);
  });
});

// ============================================================================
// CLASS QUERY TESTS
// ============================================================================

describe('GroundTruthGenerator - Class Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;
  let facts: ASTFact[];

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
    facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);
  });

  it('should generate class inheritance queries', () => {
    const queries = generator.generateClassQueries(facts);

    // Look for class queries
    const classQueries = queries.filter((q) => q.query.toLowerCase().includes('class'));
    expect(classQueries.length).toBeGreaterThan(0);
  });

  it('should generate class method queries', () => {
    const queries = generator.generateClassQueries(facts);

    // Find a query about methods
    const methodQuery = queries.find((q) => q.query.toLowerCase().includes('method'));
    expect(methodQuery).toBeDefined();
  });

  it('should generate class count queries', () => {
    const queries = generator.generateClassQueries(facts);

    // Find a count query
    const countQuery = queries.find((q) => q.query.toLowerCase().includes('how many'));
    expect(countQuery).toBeDefined();
    expect(countQuery?.expectedAnswer.type).toBe('count');
  });

  it('should generate queries about implements/extends', () => {
    const queries = generator.generateClassQueries(facts);

    // Find queries about inheritance
    const inheritanceQuery = queries.find(
      (q) => q.query.toLowerCase().includes('extend') || q.query.toLowerCase().includes('implement')
    );
    expect(inheritanceQuery).toBeDefined();
  });
});

// ============================================================================
// CALL GRAPH QUERY TESTS
// ============================================================================

describe('GroundTruthGenerator - Call Graph Queries', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;
  let facts: ASTFact[];

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
    facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);
  });

  it('should generate call graph queries', () => {
    const queries = generator.generateCallGraphQueries(facts);

    expect(queries.length).toBeGreaterThan(0);
  });

  it('should generate queries about what functions a function calls', () => {
    const queries = generator.generateCallGraphQueries(facts);

    // Find a query about what a function calls
    const callsQuery = queries.find((q) => q.query.toLowerCase().includes('call'));
    expect(callsQuery).toBeDefined();
    expect(callsQuery?.category).toBe('behavioral');
  });

  it('should generate queries about function callers', () => {
    const queries = generator.generateCallGraphQueries(facts);

    // Find a query about what calls a function
    const callerQuery = queries.find(
      (q) => q.query.toLowerCase().includes('called by') || q.query.toLowerCase().includes('caller')
    );
    expect(callerQuery).toBeDefined();
  });

  it('should generate boolean queries for call relationships', () => {
    const queries = generator.generateCallGraphQueries(facts);

    // Find a boolean query
    const boolQuery = queries.find(
      (q) => q.expectedAnswer.type === 'exists' && q.query.toLowerCase().includes('call')
    );
    expect(boolQuery).toBeDefined();
    expect(typeof boolQuery?.expectedAnswer.value).toBe('boolean');
  });
});

// ============================================================================
// QUERY DIFFICULTY TESTS
// ============================================================================

describe('GroundTruthGenerator - Query Difficulty', () => {
  let generator: GroundTruthGenerator;
  let corpus: StructuralGroundTruthCorpus;

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');
  });

  it('should generate queries of varying difficulties', () => {
    const difficulties = new Set(corpus.queries.map((q) => q.difficulty));

    // Should have at least 2 different difficulty levels
    expect(difficulties.size).toBeGreaterThanOrEqual(2);
  });

  it('should have easy queries for simple facts', () => {
    const easyQueries = corpus.queries.filter((q) => q.difficulty === 'easy');
    expect(easyQueries.length).toBeGreaterThan(0);
  });

  it('should have medium queries for moderate complexity', () => {
    const mediumQueries = corpus.queries.filter((q) => q.difficulty === 'medium');
    expect(mediumQueries.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// QUERY CATEGORY TESTS
// ============================================================================

describe('GroundTruthGenerator - Query Categories', () => {
  let generator: GroundTruthGenerator;
  let corpus: StructuralGroundTruthCorpus;

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    corpus = await generator.generateForRepo(AGENTS_DIR, 'agents');
  });

  it('should generate structural queries', () => {
    const structuralQueries = corpus.queries.filter((q) => q.category === 'structural');
    expect(structuralQueries.length).toBeGreaterThan(0);
  });

  it('should generate behavioral queries', () => {
    const behavioralQueries = corpus.queries.filter((q) => q.category === 'behavioral');
    expect(behavioralQueries.length).toBeGreaterThan(0);
  });

  it('should have queries spanning multiple categories', () => {
    const categories = new Set(corpus.queries.map((q) => q.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// ANSWER VERIFICATION TESTS
// ============================================================================

describe('GroundTruthGenerator - Answer Verification', () => {
  let generator: GroundTruthGenerator;
  let extractor: ReturnType<typeof createASTFactExtractor>;
  let facts: ASTFact[];

  beforeAll(async () => {
    generator = createGroundTruthGenerator();
    extractor = createASTFactExtractor();
    facts = await extractor.extractFromFile(PROBLEM_DETECTOR_PATH);
  });

  it('should generate verifiable exact match answers', () => {
    const queries = generator.generateFunctionQueries(facts);
    const exactQueries = queries.filter((q) => q.expectedAnswer.type === 'exact');

    for (const query of exactQueries) {
      // The value should be a string for exact matches
      expect(typeof query.expectedAnswer.value === 'string' || Array.isArray(query.expectedAnswer.value)).toBe(true);
      // Evidence should contain the fact that proves this answer
      expect(query.expectedAnswer.evidence.length).toBeGreaterThan(0);
    }
  });

  it('should generate verifiable contains answers', () => {
    const queries = generator.generateImportQueries(facts);
    const containsQueries = queries.filter((q) => q.expectedAnswer.type === 'contains');

    for (const query of containsQueries) {
      // The value should be an array for contains checks
      expect(Array.isArray(query.expectedAnswer.value)).toBe(true);
    }
  });

  it('should generate verifiable count answers', () => {
    const queries = generator.generateFunctionQueries(facts);
    const countQueries = queries.filter((q) => q.expectedAnswer.type === 'count');

    for (const query of countQueries) {
      // The value should be a number for counts
      expect(typeof query.expectedAnswer.value).toBe('number');
      expect(query.expectedAnswer.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('should generate verifiable boolean answers', () => {
    const allQueries = [
      ...generator.generateFunctionQueries(facts),
      ...generator.generateImportQueries(facts),
      ...generator.generateClassQueries(facts),
      ...generator.generateCallGraphQueries(facts),
    ];
    const boolQueries = allQueries.filter((q) => q.expectedAnswer.type === 'exists');

    for (const query of boolQueries) {
      // The value should be a boolean
      expect(typeof query.expectedAnswer.value).toBe('boolean');
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('GroundTruthGenerator - Edge Cases', () => {
  let generator: GroundTruthGenerator;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
  });

  it('should handle empty facts array', () => {
    const functionQueries = generator.generateFunctionQueries([]);
    const importQueries = generator.generateImportQueries([]);
    const classQueries = generator.generateClassQueries([]);
    const callGraphQueries = generator.generateCallGraphQueries([]);

    expect(functionQueries).toEqual([]);
    expect(importQueries).toEqual([]);
    expect(classQueries).toEqual([]);
    expect(callGraphQueries).toEqual([]);
  });

  it('should handle facts with minimal details', () => {
    const minimalFacts: ASTFact[] = [
      {
        type: 'function_def',
        identifier: 'minimalFn',
        file: '/test/file.ts',
        line: 1,
        details: {},
      },
    ];

    const queries = generator.generateFunctionQueries(minimalFacts);
    // Should still generate at least one query
    expect(queries.length).toBeGreaterThan(0);
  });

  it('should generate natural language queries', () => {
    const corpus = generator.generateFunctionQueries([
      {
        type: 'function_def',
        identifier: 'processData',
        file: '/test/file.ts',
        line: 10,
        details: {
          parameters: [{ name: 'input', type: 'string' }],
          returnType: 'boolean',
          isAsync: false,
          isExported: true,
        },
      },
    ]);

    // Queries should be readable natural language
    for (const query of corpus) {
      // Should not start with special characters
      expect(query.query).toMatch(/^[A-Z]/);
      // Should end with a question mark
      expect(query.query).toMatch(/\?$/);
    }
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('GroundTruthGenerator - Integration', () => {
  let generator: GroundTruthGenerator;

  beforeAll(() => {
    generator = createGroundTruthGenerator();
  });

  it('should work end-to-end with a real repository', async () => {
    const corpus = await generator.generateForRepo(AGENTS_DIR, 'librarian-agents');

    // Verify corpus structure
    expect(corpus.repoName).toBe('librarian-agents');
    expect(corpus.queries.length).toBeGreaterThanOrEqual(50);
    expect(corpus.factCount).toBeGreaterThan(0);

    // Verify coverage
    expect(corpus.coverage.functions).toBeGreaterThan(0);

    // Verify query diversity
    const categories = new Set(corpus.queries.map((q) => q.category));
    const difficulties = new Set(corpus.queries.map((q) => q.difficulty));
    const answerTypes = new Set(corpus.queries.map((q) => q.expectedAnswer.type));

    expect(categories.size).toBeGreaterThanOrEqual(2);
    expect(difficulties.size).toBeGreaterThanOrEqual(2);
    expect(answerTypes.size).toBeGreaterThanOrEqual(2);

    // Verify all queries have evidence
    for (const query of corpus.queries) {
      expect(query.expectedAnswer.evidence.length).toBeGreaterThan(0);
    }
  });

  it('should produce deterministic results for same input', async () => {
    const corpus1 = await generator.generateForRepo(AGENTS_DIR, 'agents');
    const corpus2 = await generator.generateForRepo(AGENTS_DIR, 'agents');

    // Same number of queries
    expect(corpus1.queries.length).toBe(corpus2.queries.length);

    // Same fact count
    expect(corpus1.factCount).toBe(corpus2.factCount);

    // Query IDs should be deterministic (same order)
    const ids1 = corpus1.queries.map((q) => q.id).sort();
    const ids2 = corpus2.queries.map((q) => q.id).sort();
    expect(ids1).toEqual(ids2);
  });
});
