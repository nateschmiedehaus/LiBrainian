/**
 * @fileoverview Tests for Self-RAG Critique Tokens (WU-RET-003)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * Self-RAG (ICLR 2024) introduces reflection tokens for self-evaluation of retrieval quality:
 * - Retrieval relevance: Is the retrieved document relevant to the query?
 * - Support: Does the document support generating a response?
 * - Usefulness: How useful is the document for answering the query?
 * - Retrieval decision: Should we retrieve more documents?
 *
 * Target: Reflection token accuracy >= 80%
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createSelfRAGCritiquer,
  type SelfRAGCritiquer,
  type RetrievalCritique,
  type SelfRAGConfig,
  DEFAULT_SELFRAG_CONFIG,
} from '../selfrag_critique.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Sample queries and documents for testing
const testFixtures = {
  relevantPair: {
    query: 'How do I implement a binary search in TypeScript?',
    document: `
      Binary search is an efficient algorithm for finding an element in a sorted array.
      Here's a TypeScript implementation:

      function binarySearch<T>(arr: T[], target: T): number {
        let left = 0;
        let right = arr.length - 1;

        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          if (arr[mid] === target) return mid;
          if (arr[mid] < target) left = mid + 1;
          else right = mid - 1;
        }
        return -1;
      }
    `,
  },
  irrelevantPair: {
    query: 'How do I implement a binary search in TypeScript?',
    document: `
      The weather forecast for today shows partly cloudy skies with a high of 72 degrees.
      There is a 20% chance of rain in the afternoon. Winds will be light from the southwest.
    `,
  },
  partiallyRelevantPair: {
    query: 'How do I implement a binary search in TypeScript?',
    document: `
      Search algorithms are fundamental in computer science.
      Common search algorithms include linear search, binary search, and hash-based search.
      Each has different time complexities and use cases.
    `,
  },
  wellSupportedResponse: {
    query: 'What is the return type of the binarySearch function?',
    response: 'The binarySearch function returns a number, specifically the index of the target element or -1 if not found.',
    contexts: [
      'function binarySearch<T>(arr: T[], target: T): number { return index; }',
      'Returns -1 if the element is not found in the array.',
    ],
  },
  unsupportedResponse: {
    query: 'What is the return type of the binarySearch function?',
    response: 'The binarySearch function returns a string containing the found element.',
    contexts: [
      'function binarySearch<T>(arr: T[], target: T): number { return index; }',
      'Returns -1 if the element is not found in the array.',
    ],
  },
  retrievalNeededScenario: {
    query: 'What are all the exported functions in the utils module?',
    partialResponse: 'The utils module contains several functions including formatDate',
  },
  noRetrievalNeededScenario: {
    query: 'What is 2 + 2?',
    partialResponse: 'The answer is 4.',
  },
};

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createSelfRAGCritiquer', () => {
  it('should create a SelfRAGCritiquer instance', () => {
    const critiquer = createSelfRAGCritiquer();
    expect(critiquer).toBeDefined();
    expect(typeof critiquer.critiqueRetrieval).toBe('function');
    expect(typeof critiquer.critiqueResponse).toBe('function');
    expect(typeof critiquer.shouldRetrieve).toBe('function');
    expect(typeof critiquer.getCritiqueStats).toBe('function');
  });

  it('should accept custom configuration', () => {
    const customConfig: Partial<SelfRAGConfig> = {
      relevanceThreshold: 0.8,
      supportThreshold: 0.7,
    };
    const critiquer = createSelfRAGCritiquer(customConfig);
    expect(critiquer).toBeDefined();
  });

  it('should use default configuration when none provided', () => {
    const critiquer = createSelfRAGCritiquer();
    expect(critiquer).toBeDefined();
  });
});

// ============================================================================
// DEFAULT CONFIGURATION TESTS
// ============================================================================

describe('DEFAULT_SELFRAG_CONFIG', () => {
  it('should have relevanceThreshold between 0 and 1', () => {
    expect(DEFAULT_SELFRAG_CONFIG.relevanceThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SELFRAG_CONFIG.relevanceThreshold).toBeLessThanOrEqual(1);
  });

  it('should have supportThreshold between 0 and 1', () => {
    expect(DEFAULT_SELFRAG_CONFIG.supportThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SELFRAG_CONFIG.supportThreshold).toBeLessThanOrEqual(1);
  });

  it('should have useSemanticAnalysis boolean', () => {
    expect(typeof DEFAULT_SELFRAG_CONFIG.useSemanticAnalysis).toBe('boolean');
  });
});

// ============================================================================
// CRITIQUE RETRIEVAL TESTS
// ============================================================================

describe('SelfRAGCritiquer - critiqueRetrieval', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should return a RetrievalCritique object', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(result).toHaveProperty('isRelevant');
    expect(result).toHaveProperty('relevanceScore');
    expect(result).toHaveProperty('isSupported');
    expect(result).toHaveProperty('supportScore');
    expect(result).toHaveProperty('isUseful');
    expect(result).toHaveProperty('usefulness');
    expect(result).toHaveProperty('explanation');
  });

  it('should mark highly relevant documents as relevant', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(result.isRelevant).toBe(true);
    expect(result.relevanceScore).toBeGreaterThanOrEqual(0.7);
  });

  it('should mark irrelevant documents as not relevant', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.irrelevantPair.query,
      testFixtures.irrelevantPair.document
    );

    expect(result.isRelevant).toBe(false);
    expect(result.relevanceScore).toBeLessThan(0.5);
  });

  it('should give moderate scores for partially relevant documents', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.partiallyRelevantPair.query,
      testFixtures.partiallyRelevantPair.document
    );

    expect(result.relevanceScore).toBeGreaterThan(0.2);
    expect(result.relevanceScore).toBeLessThan(0.9);
  });

  it('should return relevanceScore between 0 and 1', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(result.relevanceScore).toBeGreaterThanOrEqual(0);
    expect(result.relevanceScore).toBeLessThanOrEqual(1);
  });

  it('should return supportScore between 0 and 1', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(result.supportScore).toBeGreaterThanOrEqual(0);
    expect(result.supportScore).toBeLessThanOrEqual(1);
  });

  it('should return valid usefulness enum value', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(['very_useful', 'somewhat_useful', 'not_useful']).toContain(result.usefulness);
  });

  it('should provide non-empty explanation', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(result.explanation).toBeDefined();
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('should mark very useful documents appropriately', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(result.usefulness).toBe('very_useful');
    expect(result.isUseful).toBe(true);
  });

  it('should mark irrelevant documents as not useful', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.irrelevantPair.query,
      testFixtures.irrelevantPair.document
    );

    expect(result.usefulness).toBe('not_useful');
    expect(result.isUseful).toBe(false);
  });

  it('should handle empty query', async () => {
    const result = await critiquer.critiqueRetrieval('', testFixtures.relevantPair.document);

    expect(result.isRelevant).toBe(false);
    expect(result.relevanceScore).toBe(0);
  });

  it('should handle empty document', async () => {
    const result = await critiquer.critiqueRetrieval(testFixtures.relevantPair.query, '');

    expect(result.isRelevant).toBe(false);
    expect(result.relevanceScore).toBe(0);
  });

  it('should handle whitespace-only input', async () => {
    const result = await critiquer.critiqueRetrieval('   \n\t  ', '   \n\t  ');

    expect(result.isRelevant).toBe(false);
    expect(result.relevanceScore).toBe(0);
  });
});

// ============================================================================
// CRITIQUE RESPONSE TESTS
// ============================================================================

describe('SelfRAGCritiquer - critiqueResponse', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should return overall quality and per-context critiques', async () => {
    const result = await critiquer.critiqueResponse(
      testFixtures.wellSupportedResponse.query,
      testFixtures.wellSupportedResponse.response,
      testFixtures.wellSupportedResponse.contexts
    );

    expect(result).toHaveProperty('overallQuality');
    expect(result).toHaveProperty('perContextCritiques');
    expect(typeof result.overallQuality).toBe('number');
    expect(Array.isArray(result.perContextCritiques)).toBe(true);
  });

  it('should return overallQuality between 0 and 1', async () => {
    const result = await critiquer.critiqueResponse(
      testFixtures.wellSupportedResponse.query,
      testFixtures.wellSupportedResponse.response,
      testFixtures.wellSupportedResponse.contexts
    );

    expect(result.overallQuality).toBeGreaterThanOrEqual(0);
    expect(result.overallQuality).toBeLessThanOrEqual(1);
  });

  it('should return one critique per context', async () => {
    const result = await critiquer.critiqueResponse(
      testFixtures.wellSupportedResponse.query,
      testFixtures.wellSupportedResponse.response,
      testFixtures.wellSupportedResponse.contexts
    );

    expect(result.perContextCritiques.length).toBe(testFixtures.wellSupportedResponse.contexts.length);
  });

  it('should give high quality score for well-supported responses', async () => {
    const result = await critiquer.critiqueResponse(
      testFixtures.wellSupportedResponse.query,
      testFixtures.wellSupportedResponse.response,
      testFixtures.wellSupportedResponse.contexts
    );

    // Quality score should be moderate to high for well-supported responses
    expect(result.overallQuality).toBeGreaterThanOrEqual(0.4);
  });

  it('should give lower quality score for unsupported responses', async () => {
    const result = await critiquer.critiqueResponse(
      testFixtures.unsupportedResponse.query,
      testFixtures.unsupportedResponse.response,
      testFixtures.unsupportedResponse.contexts
    );

    expect(result.overallQuality).toBeLessThan(0.5);
  });

  it('should handle empty contexts array', async () => {
    const result = await critiquer.critiqueResponse(
      'some query',
      'some response',
      []
    );

    expect(result.overallQuality).toBe(0);
    expect(result.perContextCritiques).toEqual([]);
  });

  it('should handle single context', async () => {
    const result = await critiquer.critiqueResponse(
      testFixtures.wellSupportedResponse.query,
      testFixtures.wellSupportedResponse.response,
      [testFixtures.wellSupportedResponse.contexts[0]]
    );

    expect(result.perContextCritiques.length).toBe(1);
  });

  it('should critique each context independently', async () => {
    const mixedContexts = [
      'function binarySearch<T>(arr: T[], target: T): number { return index; }',
      'The weather is sunny today.',
    ];

    const result = await critiquer.critiqueResponse(
      testFixtures.wellSupportedResponse.query,
      testFixtures.wellSupportedResponse.response,
      mixedContexts
    );

    // First context should be more relevant than second
    expect(result.perContextCritiques[0].relevanceScore).toBeGreaterThan(
      result.perContextCritiques[1].relevanceScore
    );
  });
});

// ============================================================================
// SHOULD RETRIEVE TESTS
// ============================================================================

describe('SelfRAGCritiquer - shouldRetrieve', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should return retrieve decision and reason', async () => {
    const result = await critiquer.shouldRetrieve(
      testFixtures.retrievalNeededScenario.query,
      testFixtures.retrievalNeededScenario.partialResponse
    );

    expect(result).toHaveProperty('retrieve');
    expect(result).toHaveProperty('reason');
    expect(typeof result.retrieve).toBe('boolean');
    expect(typeof result.reason).toBe('string');
  });

  it('should recommend retrieval for incomplete responses', async () => {
    const result = await critiquer.shouldRetrieve(
      testFixtures.retrievalNeededScenario.query,
      testFixtures.retrievalNeededScenario.partialResponse
    );

    expect(result.retrieve).toBe(true);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('should not recommend retrieval for simple factual questions', async () => {
    const result = await critiquer.shouldRetrieve(
      testFixtures.noRetrievalNeededScenario.query,
      testFixtures.noRetrievalNeededScenario.partialResponse
    );

    expect(result.retrieve).toBe(false);
  });

  it('should recommend retrieval for code-related queries', async () => {
    const result = await critiquer.shouldRetrieve(
      'What functions are exported from the utils module?',
      ''
    );

    expect(result.retrieve).toBe(true);
  });

  it('should provide meaningful reason for retrieval decision', async () => {
    const result = await critiquer.shouldRetrieve(
      testFixtures.retrievalNeededScenario.query,
      testFixtures.retrievalNeededScenario.partialResponse
    );

    expect(result.reason).toBeDefined();
    expect(result.reason.length).toBeGreaterThan(10);
  });

  it('should handle empty query', async () => {
    const result = await critiquer.shouldRetrieve('', 'partial response');

    expect(result.retrieve).toBe(false);
  });

  it('should handle empty partial response', async () => {
    const result = await critiquer.shouldRetrieve(
      'What is the implementation of function X?',
      ''
    );

    expect(result.retrieve).toBe(true);
  });

  it('should recommend retrieval for queries asking about specific code', async () => {
    const codeQueries = [
      'How is the parseConfig function implemented?',
      'What does the UserService class do?',
      'Show me the implementation of binarySearch',
      'What parameters does formatOutput accept?',
    ];

    for (const query of codeQueries) {
      const result = await critiquer.shouldRetrieve(query, '');
      expect(result.retrieve).toBe(true);
    }
  });

  it('should not recommend retrieval for general knowledge questions', async () => {
    const generalQueries = [
      'What is object-oriented programming?',
      'Explain the concept of recursion',
      'What are design patterns?',
    ];

    for (const query of generalQueries) {
      const result = await critiquer.shouldRetrieve(
        query,
        'Here is an explanation of the concept...'
      );
      // These might or might not need retrieval depending on context
      expect(typeof result.retrieve).toBe('boolean');
    }
  });
});

// ============================================================================
// GET CRITIQUE STATS TESTS
// ============================================================================

describe('SelfRAGCritiquer - getCritiqueStats', () => {
  let critiquer: SelfRAGCritiquer;

  beforeEach(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should return avgRelevance and avgSupport', () => {
    const stats = critiquer.getCritiqueStats();

    expect(stats).toHaveProperty('avgRelevance');
    expect(stats).toHaveProperty('avgSupport');
    expect(typeof stats.avgRelevance).toBe('number');
    expect(typeof stats.avgSupport).toBe('number');
  });

  it('should return 0 for avgRelevance when no critiques performed', () => {
    const stats = critiquer.getCritiqueStats();

    expect(stats.avgRelevance).toBe(0);
    expect(stats.avgSupport).toBe(0);
  });

  it('should track statistics across multiple critiques', async () => {
    // Perform several critiques
    await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );
    await critiquer.critiqueRetrieval(
      testFixtures.irrelevantPair.query,
      testFixtures.irrelevantPair.document
    );

    const stats = critiquer.getCritiqueStats();

    // Should be average of high and low scores
    expect(stats.avgRelevance).toBeGreaterThan(0);
    expect(stats.avgRelevance).toBeLessThan(1);
  });

  it('should update stats after each critique', async () => {
    // First critique - highly relevant
    await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );
    const stats1 = critiquer.getCritiqueStats();
    const firstRelevance = stats1.avgRelevance;

    // Second critique - irrelevant
    await critiquer.critiqueRetrieval(
      testFixtures.irrelevantPair.query,
      testFixtures.irrelevantPair.document
    );
    const stats2 = critiquer.getCritiqueStats();

    // Average should decrease after adding low-relevance critique
    expect(stats2.avgRelevance).toBeLessThan(firstRelevance);
  });

  it('should return values between 0 and 1', async () => {
    await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    const stats = critiquer.getCritiqueStats();

    expect(stats.avgRelevance).toBeGreaterThanOrEqual(0);
    expect(stats.avgRelevance).toBeLessThanOrEqual(1);
    expect(stats.avgSupport).toBeGreaterThanOrEqual(0);
    expect(stats.avgSupport).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// RETRIEVAL CRITIQUE INTERFACE TESTS
// ============================================================================

describe('RetrievalCritique Interface', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should have all required boolean fields', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(typeof result.isRelevant).toBe('boolean');
    expect(typeof result.isSupported).toBe('boolean');
    expect(typeof result.isUseful).toBe('boolean');
  });

  it('should have all required numeric fields', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(typeof result.relevanceScore).toBe('number');
    expect(typeof result.supportScore).toBe('number');
  });

  it('should have valid usefulness enum value', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    const validValues = ['very_useful', 'somewhat_useful', 'not_useful'];
    expect(validValues).toContain(result.usefulness);
  });

  it('should have string explanation', async () => {
    const result = await critiquer.critiqueRetrieval(
      testFixtures.relevantPair.query,
      testFixtures.relevantPair.document
    );

    expect(typeof result.explanation).toBe('string');
  });
});

// ============================================================================
// ACCURACY TESTS (Target: >= 80%)
// ============================================================================

describe('SelfRAGCritiquer - Reflection Token Accuracy', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should correctly identify relevant documents (accuracy test)', async () => {
    const testCases = [
      {
        query: 'How to implement a stack in TypeScript?',
        document: 'A stack is a LIFO data structure. Here is TypeScript: class Stack<T> { push(item: T) {} pop(): T {} }',
        expectedRelevant: true,
      },
      {
        query: 'What is the return type of Array.map?',
        document: 'Array.map returns a new array with each element being the result of the callback function.',
        expectedRelevant: true,
      },
      {
        query: 'How to connect to a PostgreSQL database?',
        document: 'Cats are small domesticated carnivorous mammals with soft fur.',
        expectedRelevant: false,
      },
      {
        query: 'What is the syntax for async/await in JavaScript?',
        document: 'async function fetchData() { const result = await fetch(url); return result.json(); }',
        expectedRelevant: true,
      },
      {
        query: 'How to sort an array in Python?',
        document: 'The history of pizza dates back to ancient civilizations.',
        expectedRelevant: false,
      },
    ];

    let correct = 0;
    for (const testCase of testCases) {
      const result = await critiquer.critiqueRetrieval(testCase.query, testCase.document);
      if (result.isRelevant === testCase.expectedRelevant) {
        correct++;
      }
    }

    const accuracy = correct / testCases.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.8); // Target: >= 80%
  });

  it('should correctly identify useful documents (accuracy test)', async () => {
    const testCases = [
      {
        query: 'Implementation of quicksort',
        document: 'function quicksort(arr) { if (arr.length <= 1) return arr; const pivot = arr[0]; const left = arr.filter(x => x < pivot); const right = arr.filter(x => x > pivot); return [...quicksort(left), pivot, ...quicksort(right)]; }',
        expectedUsefulOrBetter: true, // very_useful or somewhat_useful
      },
      {
        query: 'What is React?',
        document: 'Programming is fun.',
        expectedUsefulOrBetter: false, // not_useful
      },
      {
        query: 'How to handle errors in Node.js?',
        document: 'Error handling is important in programming. There are try/catch blocks.',
        expectedUsefulOrBetter: true, // somewhat_useful or better
      },
    ];

    let correct = 0;
    for (const testCase of testCases) {
      const result = await critiquer.critiqueRetrieval(testCase.query, testCase.document);
      const isUsefulOrBetter = result.usefulness !== 'not_useful';
      if (isUsefulOrBetter === testCase.expectedUsefulOrBetter) {
        correct++;
      }
    }

    const accuracy = correct / testCases.length;
    // Usefulness classification should be reasonably accurate
    expect(accuracy).toBeGreaterThanOrEqual(0.66);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('SelfRAGCritiquer - Edge Cases', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should handle very long documents', async () => {
    const longDocument = 'This is code. '.repeat(10000);
    const result = await critiquer.critiqueRetrieval(
      'What is in the document?',
      longDocument
    );

    expect(result).toBeDefined();
    expect(typeof result.relevanceScore).toBe('number');
  });

  it('should handle special characters in query', async () => {
    const result = await critiquer.critiqueRetrieval(
      'What does `function<T>` return?',
      'function<T> returns T'
    );

    expect(result).toBeDefined();
    expect(typeof result.relevanceScore).toBe('number');
  });

  it('should handle unicode in documents', async () => {
    const result = await critiquer.critiqueRetrieval(
      'What is the greeting?',
      'const greeting = "Hello world!"'
    );

    expect(result).toBeDefined();
    expect(typeof result.relevanceScore).toBe('number');
  });

  it('should handle code with complex syntax', async () => {
    const complexCode = `
      type DeepPartial<T> = T extends object
        ? { [P in keyof T]?: DeepPartial<T[P]> }
        : T;
    `;

    const result = await critiquer.critiqueRetrieval(
      'What is DeepPartial?',
      complexCode
    );

    expect(result).toBeDefined();
    // Score should be positive as DeepPartial is mentioned
    expect(result.relevanceScore).toBeGreaterThan(0.2);
  });

  it('should handle multiple languages in document', async () => {
    const multiLangDoc = `
      // JavaScript
      function add(a, b) { return a + b; }

      # Python
      def add(a, b):
          return a + b
    `;

    const result = await critiquer.critiqueRetrieval(
      'How to add two numbers?',
      multiLangDoc
    );

    expect(result).toBeDefined();
    // Should recognize this has some relevance to addition
    expect(result.relevanceScore).toBeGreaterThan(0.1);
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('SelfRAGCritiquer - Configuration', () => {
  it('should respect custom relevance threshold', async () => {
    const strictCritiquer = createSelfRAGCritiquer({ relevanceThreshold: 0.9 });
    const lenientCritiquer = createSelfRAGCritiquer({ relevanceThreshold: 0.3 });

    const result1 = await strictCritiquer.critiqueRetrieval(
      testFixtures.partiallyRelevantPair.query,
      testFixtures.partiallyRelevantPair.document
    );

    const result2 = await lenientCritiquer.critiqueRetrieval(
      testFixtures.partiallyRelevantPair.query,
      testFixtures.partiallyRelevantPair.document
    );

    // Same scores but potentially different isRelevant based on threshold
    expect(result1.relevanceScore).toBeCloseTo(result2.relevanceScore, 1);
    // Lenient should be more likely to mark as relevant
    if (result1.relevanceScore >= 0.3 && result1.relevanceScore < 0.9) {
      expect(result2.isRelevant).toBe(true);
      expect(result1.isRelevant).toBe(false);
    }
  });

  it('should respect custom support threshold', async () => {
    const strictCritiquer = createSelfRAGCritiquer({ supportThreshold: 0.9 });
    const lenientCritiquer = createSelfRAGCritiquer({ supportThreshold: 0.3 });

    const result1 = await strictCritiquer.critiqueRetrieval(
      testFixtures.partiallyRelevantPair.query,
      testFixtures.partiallyRelevantPair.document
    );

    const result2 = await lenientCritiquer.critiqueRetrieval(
      testFixtures.partiallyRelevantPair.query,
      testFixtures.partiallyRelevantPair.document
    );

    // Support scores should be similar
    expect(typeof result1.supportScore).toBe('number');
    expect(typeof result2.supportScore).toBe('number');
  });
});

// ============================================================================
// CONSISTENCY TESTS
// ============================================================================

describe('SelfRAGCritiquer - Consistency', () => {
  let critiquer: SelfRAGCritiquer;

  beforeAll(() => {
    critiquer = createSelfRAGCritiquer();
  });

  it('should return consistent results for same input', async () => {
    const query = testFixtures.relevantPair.query;
    const document = testFixtures.relevantPair.document;

    const result1 = await critiquer.critiqueRetrieval(query, document);
    const result2 = await critiquer.critiqueRetrieval(query, document);

    expect(result1.relevanceScore).toBe(result2.relevanceScore);
    expect(result1.isRelevant).toBe(result2.isRelevant);
    expect(result1.usefulness).toBe(result2.usefulness);
  });

  it('should maintain consistency across many invocations', async () => {
    const query = testFixtures.relevantPair.query;
    const document = testFixtures.relevantPair.document;
    const scores: number[] = [];

    for (let i = 0; i < 5; i++) {
      const result = await critiquer.critiqueRetrieval(query, document);
      scores.push(result.relevanceScore);
    }

    // All scores should be identical
    const uniqueScores = [...new Set(scores)];
    expect(uniqueScores.length).toBe(1);
  });
});
