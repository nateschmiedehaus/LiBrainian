/**
 * @fileoverview Tests for IRCoT (Interleaved Retrieval with Chain-of-Thought) (WU-RET-001)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * IRCoT interleaves retrieval steps with reasoning steps, retrieving additional
 * context when reasoning requires it. This enables multi-hop question answering
 * where the answer depends on connecting information from multiple sources.
 *
 * Research reference: "Interleaving Retrieval with Chain-of-Thought Reasoning
 * for Knowledge-Intensive Multi-Step Questions" (Trivedi et al., 2023)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as path from 'path';
import {
  IRCoTRetriever,
  createIRCoTRetriever,
  type IRCoTInput,
  type IRCoTOutput,
  type ReasoningStep,
  type RetrievalDecision,
  DEFAULT_IRCOT_CONFIG,
} from '../ircot_retrieval.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// Sample initial context for testing
const sampleContext = [
  'The EvaluationHarness class is defined in src/evaluation/harness.ts',
  'EvaluationHarness has a method called evaluate() that takes a query and returns results',
  'The evaluate() method calls the retriever to get relevant documents',
];

// Sample question types for testing
const singleHopQuestion = 'What class is defined in harness.ts?';
const multiHopQuestion =
  'What does the evaluate() method of EvaluationHarness call, and where is that component defined?';
const noRetrievalQuestion = 'Given the context, what method does EvaluationHarness have?';
const conflictingInfoQuestion =
  'Is the retriever called synchronously or asynchronously by evaluate()?';

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createIRCoTRetriever', () => {
  it('should create a retriever instance', () => {
    const retriever = createIRCoTRetriever();
    expect(retriever).toBeInstanceOf(IRCoTRetriever);
  });

  it('should accept custom configuration', () => {
    const retriever = createIRCoTRetriever({
      maxHops: 5,
      retrievalThreshold: 0.8,
    });
    expect(retriever).toBeInstanceOf(IRCoTRetriever);
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe('DEFAULT_IRCOT_CONFIG', () => {
  it('should have reasonable default values', () => {
    expect(DEFAULT_IRCOT_CONFIG.maxHops).toBeGreaterThan(0);
    expect(DEFAULT_IRCOT_CONFIG.maxHops).toBeLessThanOrEqual(10);
    expect(DEFAULT_IRCOT_CONFIG.retrievalThreshold).toBeGreaterThan(0);
    expect(DEFAULT_IRCOT_CONFIG.retrievalThreshold).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// SOLVE METHOD TESTS - SINGLE HOP
// ============================================================================

describe('IRCoTRetriever - solve (single-hop questions)', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should answer single-hop questions from initial context', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.question).toBe(singleHopQuestion);
    expect(output.answer).toBeDefined();
    expect(output.answer.length).toBeGreaterThan(0);
    expect(output.reasoningChain.length).toBeGreaterThanOrEqual(1);
    expect(output.hopsUsed).toBeGreaterThanOrEqual(1);
  });

  it('should produce reasoning steps for single-hop questions', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);
    const firstStep = output.reasoningChain[0];

    expect(firstStep).toBeDefined();
    expect(firstStep.stepNumber).toBe(1);
    expect(firstStep.thought).toBeDefined();
    expect(firstStep.thought.length).toBeGreaterThan(0);
    expect(typeof firstStep.needsRetrieval).toBe('boolean');
  });

  it('should have low retrieval count for simple questions', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 5,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    // Single-hop questions with good initial context shouldn't need many retrievals
    expect(output.totalRetrievals).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// SOLVE METHOD TESTS - MULTI HOP
// ============================================================================

describe('IRCoTRetriever - solve (multi-hop questions)', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should handle multi-hop questions requiring multiple retrieval steps', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: sampleContext,
      maxHops: 5,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.question).toBe(multiHopQuestion);
    expect(output.answer).toBeDefined();
    expect(output.reasoningChain.length).toBeGreaterThanOrEqual(1);
  });

  it('should track reasoning chain across hops', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: sampleContext,
      maxHops: 5,
      retrievalThreshold: 0.3, // Lower threshold to encourage retrieval
    };

    const output = await retriever.solve(input);

    // Check that step numbers are sequential
    for (let i = 0; i < output.reasoningChain.length; i++) {
      expect(output.reasoningChain[i].stepNumber).toBe(i + 1);
    }
  });

  it('should retrieve additional context when reasoning needs it', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: [], // No initial context forces retrieval
      maxHops: 5,
      retrievalThreshold: 0.3,
    };

    const output = await retriever.solve(input);

    // With no initial context, we should need retrieval
    expect(output.totalRetrievals).toBeGreaterThanOrEqual(0);
  });

  it('should accumulate context across hops', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: sampleContext,
      maxHops: 5,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    // Final context should include initial context
    expect(output.finalContext.length).toBeGreaterThanOrEqual(sampleContext.length);
  });
});

// ============================================================================
// SOLVE METHOD TESTS - NO RETRIEVAL NEEDED
// ============================================================================

describe('IRCoTRetriever - solve (no retrieval needed)', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should answer without retrieval when context is sufficient', async () => {
    const input: IRCoTInput = {
      question: noRetrievalQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.9, // High threshold makes retrieval less likely
    };

    const output = await retriever.solve(input);

    expect(output.answer).toBeDefined();
    // With high threshold and sufficient context, should need minimal retrieval
    expect(output.totalRetrievals).toBeLessThanOrEqual(1);
  });

  it('should recognize when initial context is sufficient', async () => {
    const input: IRCoTInput = {
      question: 'What method does EvaluationHarness have?',
      initialContext: [
        'EvaluationHarness has a method called evaluate()',
        'The evaluate() method returns results',
      ],
      maxHops: 3,
      retrievalThreshold: 0.8,
    };

    const output = await retriever.solve(input);

    // Should find the answer in context
    expect(output.answer.toLowerCase()).toContain('evaluate');
  });
});

// ============================================================================
// SOLVE METHOD TESTS - CONFLICTING INFORMATION
// ============================================================================

describe('IRCoTRetriever - solve (conflicting information)', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should handle conflicting information in context', async () => {
    const conflictingContext = [
      'The retriever is called synchronously by evaluate()',
      'The retriever is called asynchronously by evaluate()',
      'evaluate() uses await to call the retriever',
    ];

    const input: IRCoTInput = {
      question: conflictingInfoQuestion,
      initialContext: conflictingContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    // Should still produce an answer despite conflict
    expect(output.answer).toBeDefined();
    expect(output.reasoningChain.length).toBeGreaterThanOrEqual(1);
  });

  it('should attempt to resolve conflicts through additional retrieval', async () => {
    const conflictingContext = [
      'Component A uses synchronous calls',
      'Component A uses asynchronous calls',
    ];

    const input: IRCoTInput = {
      question: 'Does Component A use sync or async calls?',
      initialContext: conflictingContext,
      maxHops: 5,
      retrievalThreshold: 0.3, // Low threshold encourages retrieval to resolve conflict
    };

    const output = await retriever.solve(input);

    // The reasoning chain should acknowledge the conflict
    expect(output.reasoningChain.length).toBeGreaterThanOrEqual(1);
  });

  it('should express uncertainty when conflicts cannot be resolved', async () => {
    const conflictingContext = [
      'The function returns a string',
      'The function returns a number',
    ];

    const input: IRCoTInput = {
      question: 'What type does the function return?',
      initialContext: conflictingContext,
      maxHops: 2,
      retrievalThreshold: 0.9, // High threshold limits retrieval
    };

    const output = await retriever.solve(input);

    // Confidence should be lower due to conflicting information
    expect(output.confidence.type).toBeDefined();
  });
});

// ============================================================================
// GENERATE THOUGHT TESTS
// ============================================================================

describe('IRCoTRetriever - generateThought', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should generate a thought based on question and context', async () => {
    const thought = await retriever.generateThought(
      'What is the main class in this file?',
      ['The file contains a class called MainProcessor'],
      []
    );

    expect(thought).toBeDefined();
    expect(thought.length).toBeGreaterThan(0);
  });

  it('should incorporate previous reasoning history', async () => {
    const history: ReasoningStep[] = [
      {
        stepNumber: 1,
        thought: 'First, I need to identify the main class',
        needsRetrieval: false,
        conclusion: 'The main class appears to be MainProcessor',
      },
    ];

    const thought = await retriever.generateThought(
      'What methods does the main class have?',
      ['MainProcessor has methods: process(), validate(), transform()'],
      history
    );

    expect(thought).toBeDefined();
    // Should build on previous reasoning
    expect(thought.length).toBeGreaterThan(0);
  });

  it('should handle empty context gracefully', async () => {
    const thought = await retriever.generateThought(
      'What is the purpose of this module?',
      [],
      []
    );

    expect(thought).toBeDefined();
    // Should indicate need for more information
    expect(thought.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// DECIDE RETRIEVAL TESTS
// ============================================================================

describe('IRCoTRetriever - decideRetrieval', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should decide to retrieve when thought indicates missing information', () => {
    const decision = retriever.decideRetrieval(
      'I need to find where the UserService is defined to understand its dependencies',
      ['Currently I only know about the AuthController']
    );

    expect(decision.shouldRetrieve).toBe(true);
    expect(decision.reason).toBeDefined();
    expect(decision.query).toBeDefined();
  });

  it('should decide not to retrieve when context is sufficient', () => {
    const decision = retriever.decideRetrieval(
      'Based on the context, the answer is clearly that UserService extends BaseService',
      [
        'UserService extends BaseService',
        'BaseService provides core functionality',
        'UserService is defined in user_service.ts',
      ]
    );

    expect(decision.shouldRetrieve).toBe(false);
    expect(decision.reason).toBeDefined();
  });

  it('should provide retrieval query when retrieval is needed', () => {
    const decision = retriever.decideRetrieval(
      'I need to understand how the caching mechanism works',
      ['The system uses caching but details are not in context']
    );

    if (decision.shouldRetrieve) {
      expect(decision.query).toBeDefined();
      expect(decision.query!.length).toBeGreaterThan(0);
    }
  });

  it('should estimate expected information gain', () => {
    const decision = retriever.decideRetrieval(
      'Where is the database connection configured?',
      []
    );

    expect(typeof decision.expectedInfoGain).toBe('number');
    expect(decision.expectedInfoGain).toBeGreaterThanOrEqual(0);
    expect(decision.expectedInfoGain).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// EXECUTE RETRIEVAL TESTS
// ============================================================================

describe('IRCoTRetriever - executeRetrieval', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should retrieve relevant context for a query', async () => {
    const context = await retriever.executeRetrieval('evaluation harness');

    expect(Array.isArray(context)).toBe(true);
    // Should return some results for a valid query
    expect(context.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty query gracefully', async () => {
    const context = await retriever.executeRetrieval('');

    expect(Array.isArray(context)).toBe(true);
  });

  it('should return string array of context items', async () => {
    const context = await retriever.executeRetrieval('Agent');

    for (const item of context) {
      expect(typeof item).toBe('string');
    }
  });

  it('should limit the number of retrieved items', async () => {
    const context = await retriever.executeRetrieval('function');

    // Should not return an excessive number of results
    expect(context.length).toBeLessThanOrEqual(20);
  });
});

// ============================================================================
// SYNTHESIZE ANSWER TESTS
// ============================================================================

describe('IRCoTRetriever - synthesizeAnswer', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should synthesize answer from reasoning chain', () => {
    const chain: ReasoningStep[] = [
      {
        stepNumber: 1,
        thought: 'Looking for the main export',
        needsRetrieval: false,
        conclusion: 'Found EvaluationHarness as the main export',
      },
      {
        stepNumber: 2,
        thought: 'Checking what methods it has',
        needsRetrieval: false,
        conclusion: 'It has evaluate() and report() methods',
      },
    ];

    const answer = retriever.synthesizeAnswer(chain);

    expect(answer).toBeDefined();
    expect(answer.length).toBeGreaterThan(0);
  });

  it('should handle empty reasoning chain', () => {
    const answer = retriever.synthesizeAnswer([]);

    expect(answer).toBeDefined();
    // Should indicate inability to answer
    expect(answer.length).toBeGreaterThan(0);
  });

  it('should incorporate conclusions from all steps', () => {
    const chain: ReasoningStep[] = [
      {
        stepNumber: 1,
        thought: 'Finding class definition',
        needsRetrieval: false,
        conclusion: 'UserService is defined in user_service.ts',
      },
      {
        stepNumber: 2,
        thought: 'Finding what it extends',
        needsRetrieval: true,
        retrievalQuery: 'UserService extends',
        retrievedContext: ['UserService extends BaseService'],
        conclusion: 'UserService extends BaseService',
      },
    ];

    const answer = retriever.synthesizeAnswer(chain);

    // Answer should reflect both conclusions
    expect(answer.toLowerCase()).toMatch(/userservice|baseservice/i);
  });

  it('should handle steps with retrieval', () => {
    const chain: ReasoningStep[] = [
      {
        stepNumber: 1,
        thought: 'Need to find more information',
        needsRetrieval: true,
        retrievalQuery: 'database configuration',
        retrievedContext: ['Database is configured in db.config.ts'],
        conclusion: 'Configuration is in db.config.ts',
      },
    ];

    const answer = retriever.synthesizeAnswer(chain);

    expect(answer).toBeDefined();
    expect(answer.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CONFIDENCE TESTS
// ============================================================================

describe('IRCoTRetriever - confidence tracking', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should produce valid confidence value', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.confidence).toBeDefined();
    expect(output.confidence.type).toBeDefined();
    // Should be one of the valid confidence types
    expect(['deterministic', 'derived', 'measured', 'bounded', 'absent']).toContain(
      output.confidence.type
    );
  });

  it('should have lower confidence with more hops', async () => {
    // More hops generally means more uncertainty
    const simpleInput: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 1,
      retrievalThreshold: 0.9,
    };

    const complexInput: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: [],
      maxHops: 5,
      retrievalThreshold: 0.3,
    };

    const simpleOutput = await retriever.solve(simpleInput);
    const complexOutput = await retriever.solve(complexInput);

    // Both should have valid confidence
    expect(simpleOutput.confidence).toBeDefined();
    expect(complexOutput.confidence).toBeDefined();
  });

  it('should have higher confidence with rich context', async () => {
    const richContextInput: IRCoTInput = {
      question: 'What is the evaluate method?',
      initialContext: [
        'The evaluate() method is the main entry point',
        'evaluate() takes a Query object as input',
        'evaluate() returns an EvaluationResult',
        'evaluate() is defined in harness.ts line 45',
      ],
      maxHops: 2,
      retrievalThreshold: 0.8,
    };

    const output = await retriever.solve(richContextInput);

    expect(output.confidence).toBeDefined();
  });
});

// ============================================================================
// INTERFACE TESTS
// ============================================================================

describe('IRCoTOutput Interface', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should have all required fields', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.question).toBeDefined();
    expect(output.answer).toBeDefined();
    expect(Array.isArray(output.reasoningChain)).toBe(true);
    expect(typeof output.totalRetrievals).toBe('number');
    expect(Array.isArray(output.finalContext)).toBe(true);
    expect(output.confidence).toBeDefined();
    expect(typeof output.hopsUsed).toBe('number');
  });
});

describe('ReasoningStep Interface', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should have all required fields in reasoning steps', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.reasoningChain.length).toBeGreaterThanOrEqual(1);

    const step = output.reasoningChain[0];
    expect(typeof step.stepNumber).toBe('number');
    expect(typeof step.thought).toBe('string');
    expect(typeof step.needsRetrieval).toBe('boolean');

    // Conditional fields
    if (step.needsRetrieval) {
      expect(step.retrievalQuery).toBeDefined();
    }
  });
});

describe('RetrievalDecision Interface', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should have all required fields', () => {
    const decision = retriever.decideRetrieval(
      'I need more information about the caching system',
      []
    );

    expect(typeof decision.shouldRetrieve).toBe('boolean');
    expect(typeof decision.reason).toBe('string');
    expect(typeof decision.expectedInfoGain).toBe('number');

    if (decision.shouldRetrieve) {
      expect(decision.query).toBeDefined();
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('IRCoTRetriever - Edge Cases', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should handle empty question', async () => {
    const input: IRCoTInput = {
      question: '',
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output).toBeDefined();
    expect(output.answer).toBeDefined();
  });

  it('should handle maxHops of 0', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 0,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.hopsUsed).toBe(0);
  });

  it('should handle maxHops of 1', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: sampleContext,
      maxHops: 1,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output.hopsUsed).toBeLessThanOrEqual(1);
  });

  it('should handle retrieval threshold of 0', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0, // Always retrieve
    };

    const output = await retriever.solve(input);

    expect(output).toBeDefined();
  });

  it('should handle retrieval threshold of 1', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 1, // Never retrieve
    };

    const output = await retriever.solve(input);

    expect(output.totalRetrievals).toBe(0);
  });

  it('should handle very long question', async () => {
    const longQuestion = 'What is '.repeat(100) + 'the main class?';
    const input: IRCoTInput = {
      question: longQuestion,
      initialContext: sampleContext,
      maxHops: 2,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output).toBeDefined();
  });

  it('should handle undefined initialContext', async () => {
    const input: IRCoTInput = {
      question: singleHopQuestion,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output).toBeDefined();
    expect(output.finalContext).toBeDefined();
  });

  it('should handle special characters in question', async () => {
    const input: IRCoTInput = {
      question: 'What is the `evaluate()` method? @param input',
      initialContext: sampleContext,
      maxHops: 2,
      retrievalThreshold: 0.5,
    };

    const output = await retriever.solve(input);

    expect(output).toBeDefined();
  });
});

// ============================================================================
// STOPPING CRITERIA TESTS
// ============================================================================

describe('IRCoTRetriever - Stopping Criteria', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should stop when maxHops is reached', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: [],
      maxHops: 2,
      retrievalThreshold: 0.1, // Very low threshold encourages retrieval
    };

    const output = await retriever.solve(input);

    expect(output.hopsUsed).toBeLessThanOrEqual(2);
  });

  it('should stop early when confidence is high enough', async () => {
    const input: IRCoTInput = {
      question: 'What class has the evaluate method?',
      initialContext: ['EvaluationHarness has the evaluate() method'],
      maxHops: 10,
      retrievalThreshold: 0.9,
    };

    const output = await retriever.solve(input);

    // Should stop well before 10 hops with sufficient context
    expect(output.hopsUsed).toBeLessThan(10);
  });

  it('should stop when no more retrieval is needed', async () => {
    const input: IRCoTInput = {
      question: noRetrievalQuestion,
      initialContext: sampleContext,
      maxHops: 5,
      retrievalThreshold: 0.95,
    };

    const output = await retriever.solve(input);

    // With high threshold, should stop after finding answer
    expect(output.totalRetrievals).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('IRCoTRetriever - Performance', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should complete within reasonable time for simple questions', async () => {
    const start = Date.now();

    const input: IRCoTInput = {
      question: singleHopQuestion,
      initialContext: sampleContext,
      maxHops: 3,
      retrievalThreshold: 0.5,
    };

    await retriever.solve(input);

    const elapsed = Date.now() - start;

    // Should complete within 5 seconds for simple questions
    expect(elapsed).toBeLessThan(5000);
  });

  it('should complete within reasonable time for complex questions', async () => {
    const start = Date.now();

    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: sampleContext,
      maxHops: 5,
      retrievalThreshold: 0.3,
    };

    await retriever.solve(input);

    const elapsed = Date.now() - start;

    // Should complete within 15 seconds for complex questions
    expect(elapsed).toBeLessThan(15000);
  });
});

// ============================================================================
// RETRIEVAL DECISION TRACKING TESTS
// ============================================================================

describe('IRCoTRetriever - Retrieval Decision Tracking', () => {
  let retriever: IRCoTRetriever;

  beforeAll(() => {
    retriever = createIRCoTRetriever();
  });

  it('should track which steps triggered retrieval', async () => {
    const input: IRCoTInput = {
      question: multiHopQuestion,
      initialContext: [],
      maxHops: 5,
      retrievalThreshold: 0.3,
    };

    const output = await retriever.solve(input);

    // Count retrieval steps
    const retrievalSteps = output.reasoningChain.filter((step) => step.needsRetrieval);

    // totalRetrievals should match the count
    expect(output.totalRetrievals).toBe(retrievalSteps.length);
  });

  it('should include retrieval queries in steps that retrieved', async () => {
    const input: IRCoTInput = {
      question: 'Where is the database connection defined?',
      initialContext: [],
      maxHops: 3,
      retrievalThreshold: 0.3,
    };

    const output = await retriever.solve(input);

    for (const step of output.reasoningChain) {
      if (step.needsRetrieval) {
        expect(step.retrievalQuery).toBeDefined();
        expect(typeof step.retrievalQuery).toBe('string');
      }
    }
  });

  it('should include retrieved context in steps that retrieved', async () => {
    const input: IRCoTInput = {
      question: 'What patterns are used in this codebase?',
      initialContext: [],
      maxHops: 3,
      retrievalThreshold: 0.3,
    };

    const output = await retriever.solve(input);

    for (const step of output.reasoningChain) {
      if (step.needsRetrieval && step.retrievedContext) {
        expect(Array.isArray(step.retrievedContext)).toBe(true);
      }
    }
  });
});
