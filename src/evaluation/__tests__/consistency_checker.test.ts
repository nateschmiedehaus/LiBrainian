/**
 * @fileoverview Tests for Consistency Checker (WU-805)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Consistency Checker detects when Librarian gives contradictory answers
 * to semantically equivalent questions. This is a hallucination detection mechanism.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  ConsistencyChecker,
  createConsistencyChecker,
  type QueryVariant,
  type QuerySet,
  type ConsistencyAnswer,
  type ConsistencyViolation,
  type ConsistencyReport,
} from '../consistency_checker.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleQuerySet: QuerySet = {
  canonicalQuery: 'What parameters does function processData accept?',
  variants: [
    { id: 'q1', query: 'What parameters does function processData accept?', isCanonical: true },
    { id: 'q2', query: 'What are the arguments to function processData?', isCanonical: false },
    { id: 'q3', query: 'What inputs does processData take?', isCanonical: false },
    { id: 'q4', query: 'Describe the parameters of processData', isCanonical: false },
  ],
  topic: 'processData function parameters',
};

const consistentAnswers: ConsistencyAnswer[] = [
  {
    queryId: 'q1',
    query: 'What parameters does function processData accept?',
    answer: 'The function processData accepts two parameters: data (string) and options (object).',
    extractedFacts: ['processData accepts two parameters', 'parameter data is string', 'parameter options is object'],
  },
  {
    queryId: 'q2',
    query: 'What are the arguments to function processData?',
    answer: 'processData takes two arguments: data which is a string, and options which is an object.',
    extractedFacts: ['processData takes two arguments', 'data is a string', 'options is an object'],
  },
];

const contradictoryAnswers: ConsistencyAnswer[] = [
  {
    queryId: 'q1',
    query: 'What parameters does function processData accept?',
    answer: 'The function processData accepts two parameters: data (string) and options (object).',
    extractedFacts: ['processData accepts two parameters', 'data is string', 'options is object'],
  },
  {
    queryId: 'q2',
    query: 'What are the arguments to function processData?',
    answer: 'processData takes three arguments: input, config, and callback.',
    extractedFacts: ['processData takes three arguments', 'input is argument', 'config is argument', 'callback is argument'],
  },
];

const partialConflictAnswers: ConsistencyAnswer[] = [
  {
    queryId: 'q1',
    query: 'What parameters does function processData accept?',
    answer: 'processData has 3 parameters.',
    extractedFacts: ['processData has 3 parameters'],
  },
  {
    queryId: 'q2',
    query: 'What are the arguments to function processData?',
    answer: 'processData takes parameters a, b, c, and d.',
    extractedFacts: ['processData takes parameter a', 'processData takes parameter b', 'processData takes parameter c', 'processData takes parameter d'],
  },
];

const missingFactAnswers: ConsistencyAnswer[] = [
  {
    queryId: 'q1',
    query: 'What does the function return?',
    answer: 'The function returns a Promise that resolves to an array of strings.',
    extractedFacts: ['returns Promise', 'resolves to array', 'array of strings'],
  },
  {
    queryId: 'q2',
    query: 'What is the return type?',
    answer: 'It returns a Promise.',
    extractedFacts: ['returns Promise'],
  },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createConsistencyChecker', () => {
  it('should create a checker instance', () => {
    const checker = createConsistencyChecker();
    expect(checker).toBeInstanceOf(ConsistencyChecker);
  });
});

// ============================================================================
// QUERY VARIANT GENERATION TESTS
// ============================================================================

describe('ConsistencyChecker - generateVariants', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should generate variants for a parameter question', () => {
    const querySet = checker.generateVariants(
      'What parameters does function processData accept?',
      'processData function parameters'
    );

    expect(querySet.canonicalQuery).toBe('What parameters does function processData accept?');
    expect(querySet.topic).toBe('processData function parameters');
    expect(querySet.variants.length).toBeGreaterThanOrEqual(3);

    // Should have one canonical variant
    const canonicalVariants = querySet.variants.filter((v) => v.isCanonical);
    expect(canonicalVariants.length).toBe(1);
  });

  it('should generate variants for a return type question', () => {
    const querySet = checker.generateVariants(
      'What does function calculateTotal return?',
      'calculateTotal return type'
    );

    expect(querySet.variants.length).toBeGreaterThanOrEqual(2);
    expect(querySet.variants.some((v) => v.query.includes('return'))).toBe(true);
  });

  it('should generate variants for a definition question', () => {
    const querySet = checker.generateVariants(
      'Where is function getUserById defined?',
      'getUserById definition location'
    );

    expect(querySet.variants.length).toBeGreaterThanOrEqual(2);
    // Should have variants asking about location/definition
    const hasLocationVariant = querySet.variants.some(
      (v) => v.query.includes('defined') || v.query.includes('located') || v.query.includes('where')
    );
    expect(hasLocationVariant).toBe(true);
  });

  it('should generate variants for a purpose/description question', () => {
    const querySet = checker.generateVariants(
      'What does the UserService class do?',
      'UserService purpose'
    );

    expect(querySet.variants.length).toBeGreaterThanOrEqual(2);
  });

  it('should include unique IDs for each variant', () => {
    const querySet = checker.generateVariants(
      'What parameters does function foo accept?',
      'foo parameters'
    );

    const ids = querySet.variants.map((v) => v.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should handle questions without recognized patterns gracefully', () => {
    const querySet = checker.generateVariants(
      'Tell me about the codebase',
      'general codebase info'
    );

    // Should still create at least a canonical query
    expect(querySet.variants.length).toBeGreaterThanOrEqual(1);
    expect(querySet.canonicalQuery).toBe('Tell me about the codebase');
  });

  it('should extract function names from queries', () => {
    const querySet = checker.generateVariants(
      'What parameters does function mySpecialFunc accept?',
      'mySpecialFunc parameters'
    );

    // Variants should reference the same function
    const variantsWithFunc = querySet.variants.filter(
      (v) => v.query.includes('mySpecialFunc')
    );
    expect(variantsWithFunc.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract class names from queries', () => {
    const querySet = checker.generateVariants(
      'What methods does the DatabaseConnection class have?',
      'DatabaseConnection methods'
    );

    const variantsWithClass = querySet.variants.filter(
      (v) => v.query.includes('DatabaseConnection')
    );
    expect(variantsWithClass.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// FACT EXTRACTION TESTS
// ============================================================================

describe('ConsistencyChecker - extractFacts', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should extract parameter-related facts', () => {
    const answer = 'The function accepts two parameters: name (string) and age (number).';
    const facts = checker.extractFacts(answer);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.includes('two') || f.includes('2') || f.includes('parameter'))).toBe(true);
  });

  it('should extract return type facts', () => {
    const answer = 'The function returns a Promise<User[]>.';
    const facts = checker.extractFacts(answer);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.includes('return') || f.includes('Promise'))).toBe(true);
  });

  it('should extract location/file facts', () => {
    const answer = 'The function is defined in src/utils/helpers.ts at line 42.';
    const facts = checker.extractFacts(answer);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.includes('src/utils/helpers.ts') || f.includes('line 42') || f.includes('42'))).toBe(true);
  });

  it('should extract type information', () => {
    const answer = 'The parameter config is of type ConfigOptions.';
    const facts = checker.extractFacts(answer);

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.includes('ConfigOptions') || f.includes('config'))).toBe(true);
  });

  it('should handle empty answers', () => {
    const facts = checker.extractFacts('');
    expect(facts).toEqual([]);
  });

  it('should normalize facts to lowercase', () => {
    const answer = 'Returns STRING type';
    const facts = checker.extractFacts(answer);

    if (facts.length > 0) {
      // Facts should be normalized
      expect(facts.every((f) => f === f.toLowerCase())).toBe(true);
    }
  });

  it('should extract numeric values', () => {
    const answer = 'The function has 3 required parameters and 2 optional ones.';
    const facts = checker.extractFacts(answer);

    expect(facts.some((f) => f.includes('3') || f.includes('three'))).toBe(true);
  });

  it('should extract list items', () => {
    const answer = 'Parameters: name, email, password, role';
    const facts = checker.extractFacts(answer);

    // Should extract individual parameter names
    expect(facts.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// CONSISTENCY CHECKING TESTS
// ============================================================================

describe('ConsistencyChecker - checkConsistency', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should return null for consistent answers', () => {
    const violation = checker.checkConsistency(consistentAnswers);
    expect(violation).toBeNull();
  });

  it('should detect direct contradictions', () => {
    const violation = checker.checkConsistency(contradictoryAnswers);

    expect(violation).not.toBeNull();
    expect(violation?.conflictType).toBe('direct_contradiction');
    expect(violation?.severity).toBe('high');
  });

  it('should detect partial conflicts', () => {
    const violation = checker.checkConsistency(partialConflictAnswers);

    expect(violation).not.toBeNull();
    expect(violation?.conflictType).toBe('partial_conflict');
  });

  it('should detect missing facts', () => {
    const violation = checker.checkConsistency(missingFactAnswers);

    expect(violation).not.toBeNull();
    expect(['missing_fact', 'extra_fact']).toContain(violation?.conflictType);
  });

  it('should include explanation for violations', () => {
    const violation = checker.checkConsistency(contradictoryAnswers);

    expect(violation).not.toBeNull();
    expect(violation?.explanation).toBeDefined();
    expect(violation?.explanation.length).toBeGreaterThan(0);
  });

  it('should include conflicting answers in violation', () => {
    const violation = checker.checkConsistency(contradictoryAnswers);

    expect(violation).not.toBeNull();
    expect(violation?.conflictingAnswers.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle single answer (no comparison possible)', () => {
    const singleAnswer: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'What parameters does function foo accept?',
        answer: 'foo accepts one parameter',
        extractedFacts: ['foo accepts one parameter'],
      },
    ];

    const violation = checker.checkConsistency(singleAnswer);
    expect(violation).toBeNull();
  });

  it('should handle empty answers array', () => {
    const violation = checker.checkConsistency([]);
    expect(violation).toBeNull();
  });

  it('should assign appropriate severity levels', () => {
    // Direct contradiction should be high severity
    const directViolation = checker.checkConsistency(contradictoryAnswers);
    if (directViolation) {
      expect(directViolation.severity).toBe('high');
    }

    // Missing fact should be lower severity
    const missingViolation = checker.checkConsistency(missingFactAnswers);
    if (missingViolation) {
      expect(['medium', 'low']).toContain(missingViolation.severity);
    }
  });
});

// ============================================================================
// FULL CONSISTENCY CHECK TESTS
// ============================================================================

describe('ConsistencyChecker - runConsistencyCheck', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should run consistency check across multiple query sets', async () => {
    const querySets: QuerySet[] = [
      sampleQuerySet,
      {
        canonicalQuery: 'What does function calculateSum return?',
        variants: [
          { id: 'r1', query: 'What does function calculateSum return?', isCanonical: true },
          { id: 'r2', query: 'What is the return type of calculateSum?', isCanonical: false },
        ],
        topic: 'calculateSum return type',
      },
    ];

    // Mock answer provider that returns consistent answers
    const answerProvider = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes('processData')) {
        return 'processData accepts two parameters: data and config.';
      }
      return 'calculateSum returns a number.';
    });

    const report = await checker.runConsistencyCheck(querySets, answerProvider);

    expect(report.totalQuerySets).toBe(2);
    expect(typeof report.consistentSets).toBe('number');
    expect(typeof report.inconsistentSets).toBe('number');
    expect(report.consistentSets + report.inconsistentSets).toBe(report.totalQuerySets);
  });

  it('should calculate consistency rate correctly', async () => {
    const querySets: QuerySet[] = [sampleQuerySet];

    const answerProvider = vi.fn().mockResolvedValue('Some consistent answer about two parameters.');

    const report = await checker.runConsistencyCheck(querySets, answerProvider);

    expect(report.consistencyRate).toBeGreaterThanOrEqual(0);
    expect(report.consistencyRate).toBeLessThanOrEqual(1);
  });

  it('should detect violations across query sets', async () => {
    const querySets: QuerySet[] = [
      {
        canonicalQuery: 'What parameters does foo accept?',
        variants: [
          { id: 'v1', query: 'What parameters does foo accept?', isCanonical: true },
          { id: 'v2', query: 'What arguments does foo take?', isCanonical: false },
        ],
        topic: 'foo parameters',
      },
    ];

    // Mock inconsistent answers
    let callCount = 0;
    const answerProvider = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return 'foo accepts two parameters: a and b.';
      }
      return 'foo accepts five arguments: x, y, z, w, v.';
    });

    const report = await checker.runConsistencyCheck(querySets, answerProvider);

    expect(report.inconsistentSets).toBeGreaterThan(0);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it('should call answer provider for each variant', async () => {
    const querySets: QuerySet[] = [
      {
        canonicalQuery: 'Test query',
        variants: [
          { id: 'v1', query: 'Test query', isCanonical: true },
          { id: 'v2', query: 'Test query variant', isCanonical: false },
          { id: 'v3', query: 'Another test query', isCanonical: false },
        ],
        topic: 'test',
      },
    ];

    const answerProvider = vi.fn().mockResolvedValue('Consistent answer');

    await checker.runConsistencyCheck(querySets, answerProvider);

    expect(answerProvider).toHaveBeenCalledTimes(3);
  });

  it('should include summary statistics in report', async () => {
    const querySets: QuerySet[] = [sampleQuerySet];
    const answerProvider = vi.fn().mockResolvedValue('Answer');

    const report = await checker.runConsistencyCheck(querySets, answerProvider);

    expect(report.summary).toBeDefined();
    expect(typeof report.summary.directContradictions).toBe('number');
    expect(typeof report.summary.partialConflicts).toBe('number');
    expect(typeof report.summary.missingFacts).toBe('number');
    expect(typeof report.summary.extraFacts).toBe('number');
  });

  it('should handle empty query sets array', async () => {
    const answerProvider = vi.fn().mockResolvedValue('Answer');

    const report = await checker.runConsistencyCheck([], answerProvider);

    expect(report.totalQuerySets).toBe(0);
    expect(report.consistencyRate).toBe(1); // 100% consistent when no queries
    expect(report.violations).toEqual([]);
  });

  it('should handle answer provider errors gracefully', async () => {
    const querySets: QuerySet[] = [sampleQuerySet];
    const answerProvider = vi.fn().mockRejectedValue(new Error('API Error'));

    // Should not throw, should handle gracefully
    await expect(
      checker.runConsistencyCheck(querySets, answerProvider)
    ).resolves.toBeDefined();
  });

  it('should preserve query set topic in violations', async () => {
    const querySets: QuerySet[] = [
      {
        canonicalQuery: 'What does foo do?',
        variants: [
          { id: 'v1', query: 'What does foo do?', isCanonical: true },
          { id: 'v2', query: 'Describe foo', isCanonical: false },
        ],
        topic: 'foo functionality',
      },
    ];

    let callCount = 0;
    const answerProvider = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? 'foo does X' : 'foo does Y completely differently';
    });

    const report = await checker.runConsistencyCheck(querySets, answerProvider);

    if (report.violations.length > 0) {
      expect(report.violations[0].querySetTopic).toBe('foo functionality');
      expect(report.violations[0].canonicalQuery).toBe('What does foo do?');
    }
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('QueryVariant Interface', () => {
  it('should support all required fields', () => {
    const variant: QueryVariant = {
      id: 'test-1',
      query: 'What does function test do?',
      isCanonical: true,
    };

    expect(variant.id).toBe('test-1');
    expect(variant.query).toBe('What does function test do?');
    expect(variant.isCanonical).toBe(true);
  });
});

describe('QuerySet Interface', () => {
  it('should support all required fields', () => {
    const querySet: QuerySet = {
      canonicalQuery: 'Test question',
      variants: [
        { id: 'v1', query: 'Test question', isCanonical: true },
      ],
      topic: 'test topic',
    };

    expect(querySet.canonicalQuery).toBe('Test question');
    expect(querySet.variants.length).toBe(1);
    expect(querySet.topic).toBe('test topic');
  });
});

describe('ConsistencyAnswer Interface', () => {
  it('should support all required fields', () => {
    const answer: ConsistencyAnswer = {
      queryId: 'q1',
      query: 'Test query',
      answer: 'Test answer',
      extractedFacts: ['fact1', 'fact2'],
    };

    expect(answer.queryId).toBe('q1');
    expect(answer.query).toBe('Test query');
    expect(answer.answer).toBe('Test answer');
    expect(answer.extractedFacts).toEqual(['fact1', 'fact2']);
  });
});

describe('ConsistencyViolation Interface', () => {
  it('should support all required fields', () => {
    const violation: ConsistencyViolation = {
      querySetTopic: 'test topic',
      canonicalQuery: 'Test query',
      conflictingAnswers: [],
      conflictType: 'direct_contradiction',
      severity: 'high',
      explanation: 'Test explanation',
    };

    expect(violation.querySetTopic).toBe('test topic');
    expect(violation.canonicalQuery).toBe('Test query');
    expect(violation.conflictType).toBe('direct_contradiction');
    expect(violation.severity).toBe('high');
    expect(violation.explanation).toBe('Test explanation');
  });

  it('should support all conflict types', () => {
    const types: ConsistencyViolation['conflictType'][] = [
      'direct_contradiction',
      'partial_conflict',
      'missing_fact',
      'extra_fact',
    ];

    types.forEach((type) => {
      const violation: ConsistencyViolation = {
        querySetTopic: 'test',
        canonicalQuery: 'test',
        conflictingAnswers: [],
        conflictType: type,
        severity: 'medium',
        explanation: 'test',
      };
      expect(violation.conflictType).toBe(type);
    });
  });

  it('should support all severity levels', () => {
    const levels: ConsistencyViolation['severity'][] = ['high', 'medium', 'low'];

    levels.forEach((level) => {
      const violation: ConsistencyViolation = {
        querySetTopic: 'test',
        canonicalQuery: 'test',
        conflictingAnswers: [],
        conflictType: 'direct_contradiction',
        severity: level,
        explanation: 'test',
      };
      expect(violation.severity).toBe(level);
    });
  });
});

describe('ConsistencyReport Interface', () => {
  it('should support all required fields', () => {
    const report: ConsistencyReport = {
      totalQuerySets: 10,
      consistentSets: 8,
      inconsistentSets: 2,
      consistencyRate: 0.8,
      violations: [],
      summary: {
        directContradictions: 1,
        partialConflicts: 1,
        missingFacts: 0,
        extraFacts: 0,
      },
    };

    expect(report.totalQuerySets).toBe(10);
    expect(report.consistentSets).toBe(8);
    expect(report.inconsistentSets).toBe(2);
    expect(report.consistencyRate).toBe(0.8);
    expect(report.summary.directContradictions).toBe(1);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ConsistencyChecker - Edge Cases', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should handle answers with special characters', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'What type?',
        answer: 'Returns Promise<Map<string, number>>',
        extractedFacts: ['returns promise map string number'],
      },
      {
        queryId: 'q2',
        query: 'Return type?',
        answer: 'Promise<Map<string, number>>',
        extractedFacts: ['promise map string number'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    // Should handle without crashing
    expect(violation).toBeNull(); // These are consistent
  });

  it('should handle very long answers', () => {
    const longAnswer = 'The function '.repeat(1000) + 'accepts two parameters.';
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'Test',
        answer: longAnswer,
        extractedFacts: ['accepts two parameters'],
      },
      {
        queryId: 'q2',
        query: 'Test variant',
        answer: 'Accepts two parameters.',
        extractedFacts: ['accepts two parameters'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    expect(violation).toBeNull();
  });

  it('should handle unicode in answers', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'Test',
        answer: 'Returns emoji data',
        extractedFacts: ['returns emoji data'],
      },
      {
        queryId: 'q2',
        query: 'Test variant',
        answer: 'Returns emoji data',
        extractedFacts: ['returns emoji data'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    expect(violation).toBeNull();
  });

  it('should handle answers with code blocks', () => {
    const facts = checker.extractFacts('```typescript\nfunction foo(a: string, b: number) {}\n```');
    // Should extract something meaningful from code
    expect(facts).toBeDefined();
  });

  it('should handle numeric consistency', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'How many parameters?',
        answer: 'There are 3 parameters.',
        extractedFacts: ['3 parameters'],
      },
      {
        queryId: 'q2',
        query: 'Parameter count?',
        answer: 'Three parameters total.',
        extractedFacts: ['three parameters'],
      },
    ];

    // Should recognize "3" and "three" as consistent
    const violation = checker.checkConsistency(answers);
    expect(violation).toBeNull();
  });

  it('should handle case-insensitive comparison', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'What type?',
        answer: 'Returns STRING',
        extractedFacts: ['returns string'],
      },
      {
        queryId: 'q2',
        query: 'Return type?',
        answer: 'returns string',
        extractedFacts: ['returns string'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    expect(violation).toBeNull();
  });

  it('should handle empty facts arrays', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'Test',
        answer: 'I do not know.',
        extractedFacts: [],
      },
      {
        queryId: 'q2',
        query: 'Test variant',
        answer: 'Unknown.',
        extractedFacts: [],
      },
    ];

    const violation = checker.checkConsistency(answers);
    // Empty facts should be considered consistent (both admit lack of knowledge)
    expect(violation).toBeNull();
  });
});

// ============================================================================
// CONFLICT DETECTION PATTERN TESTS
// ============================================================================

describe('ConsistencyChecker - Conflict Detection Patterns', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should detect type contradictions', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'What type does X return?',
        answer: 'X returns string',
        extractedFacts: ['x returns string'],
      },
      {
        queryId: 'q2',
        query: 'Return type of X?',
        answer: 'X returns number',
        extractedFacts: ['x returns number'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    expect(violation).not.toBeNull();
    expect(violation?.conflictType).toBe('direct_contradiction');
  });

  it('should detect count contradictions', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'How many parameters?',
        answer: '2 parameters',
        extractedFacts: ['2 parameters'],
      },
      {
        queryId: 'q2',
        query: 'Parameter count?',
        answer: '5 parameters',
        extractedFacts: ['5 parameters'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    expect(violation).not.toBeNull();
  });

  it('should detect location contradictions', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'Where is foo defined?',
        answer: 'foo is defined in src/a.ts',
        extractedFacts: ['foo defined in src/a.ts'],
      },
      {
        queryId: 'q2',
        query: 'foo location?',
        answer: 'foo is in src/b.ts',
        extractedFacts: ['foo in src/b.ts'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    expect(violation).not.toBeNull();
  });

  it('should not flag similar but non-contradictory answers', () => {
    const answers: ConsistencyAnswer[] = [
      {
        queryId: 'q1',
        query: 'What does foo do?',
        answer: 'foo processes input data',
        extractedFacts: ['foo processes input data'],
      },
      {
        queryId: 'q2',
        query: 'Purpose of foo?',
        answer: 'foo processes and validates input data',
        extractedFacts: ['foo processes input data', 'foo validates input data'],
      },
    ];

    const violation = checker.checkConsistency(answers);
    // Second answer is more detailed but not contradictory
    if (violation) {
      expect(violation.conflictType).not.toBe('direct_contradiction');
    }
  });
});

// ============================================================================
// NORMALIZATION TESTS
// ============================================================================

describe('ConsistencyChecker - Answer Normalization', () => {
  let checker: ConsistencyChecker;

  beforeAll(() => {
    checker = createConsistencyChecker();
  });

  it('should normalize whitespace in facts', () => {
    const facts1 = checker.extractFacts('returns   string   value');
    const facts2 = checker.extractFacts('returns string value');

    // After normalization, these should produce similar facts
    expect(facts1.length).toBe(facts2.length);
  });

  it('should handle punctuation consistently', () => {
    const facts1 = checker.extractFacts('Returns: string.');
    const facts2 = checker.extractFacts('Returns string');

    // Both should extract the return type fact
    expect(facts1.some((f) => f.includes('return') && f.includes('string'))).toBe(true);
    expect(facts2.some((f) => f.includes('return') && f.includes('string'))).toBe(true);
  });

  it('should handle article variations', () => {
    // "a string" vs "the string" vs "string"
    const facts1 = checker.extractFacts('Returns a string');
    const facts2 = checker.extractFacts('Returns the string');
    const facts3 = checker.extractFacts('Returns string');

    // All should capture the string return type
    [facts1, facts2, facts3].forEach((facts) => {
      expect(facts.some((f) => f.includes('string'))).toBe(true);
    });
  });
});
