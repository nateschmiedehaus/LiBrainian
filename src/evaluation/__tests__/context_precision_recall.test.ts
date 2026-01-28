/**
 * @fileoverview Context Precision and Recall Evaluator Tests (WU-EVAL-002)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Context Quality Evaluator measures retrieval quality:
 * - Precision: How much of retrieved context is relevant
 * - Recall: How much of needed context was retrieved
 * - F1: Harmonic mean of precision and recall
 *
 * Reference: RAGAS approach for RAG evaluation
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  ContextQualityEvaluator,
  createContextQualityEvaluator,
  type ContextQualityResult,
  type ContextQualityConfig,
} from '../context_precision_recall.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleQuestion = 'What does the UserService class do?';
const sampleAnswer = 'The UserService class handles user authentication and session management. It has a login method that validates credentials.';

const relevantContexts = [
  'class UserService { login(username: string, password: string): Promise<Session> { /* validates credentials */ } }',
  'UserService extends BaseService and implements AuthProvider interface.',
  'The login method validates user credentials against the database.',
];

const irrelevantContexts = [
  'The color scheme uses blue (#0066cc) for primary buttons.',
  'Font size is 14px for body text.',
  'Database connection pool maximum is 10.',
];

const mixedContexts = [
  'class UserService { login(username: string, password: string): Promise<Session> }', // relevant
  'The color scheme uses blue (#0066cc) for primary buttons.', // irrelevant
  'UserService implements AuthProvider interface.', // relevant
  'Font size is 14px for body text.', // irrelevant
];

const groundTruthContexts = [
  'class UserService { login(username, password) { validates credentials } }',
  'UserService handles authentication.',
  'Session management is done by UserService.',
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createContextQualityEvaluator', () => {
  it('should create a ContextQualityEvaluator instance', () => {
    const evaluator = createContextQualityEvaluator();
    expect(evaluator).toBeDefined();
    expect(typeof evaluator.evaluate).toBe('function');
    expect(typeof evaluator.evaluateChunkRelevance).toBe('function');
    expect(typeof evaluator.getAverageMetrics).toBe('function');
  });

  it('should accept optional configuration', () => {
    const config: ContextQualityConfig = {
      relevanceThreshold: 0.5,
    };
    const evaluator = createContextQualityEvaluator(config);
    expect(evaluator).toBeDefined();
  });
});

// ============================================================================
// CONTEXT QUALITY EVALUATOR TESTS
// ============================================================================

describe('ContextQualityEvaluator', () => {
  let evaluator: ContextQualityEvaluator;

  beforeEach(() => {
    evaluator = createContextQualityEvaluator();
  });

  // ==========================================================================
  // evaluate() - Full Evaluation Tests
  // ==========================================================================

  describe('evaluate', () => {
    it('should return ContextQualityResult with all required fields', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      expect(result).toBeDefined();
      expect(typeof result.precision).toBe('number');
      expect(typeof result.recall).toBe('number');
      expect(typeof result.f1).toBe('number');
      expect(typeof result.relevantChunks).toBe('number');
      expect(typeof result.retrievedChunks).toBe('number');
      expect(typeof result.neededChunks).toBe('number');
    });

    it('should have scores between 0 and 1', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      expect(result.precision).toBeGreaterThanOrEqual(0);
      expect(result.precision).toBeLessThanOrEqual(1);
      expect(result.recall).toBeGreaterThanOrEqual(0);
      expect(result.recall).toBeLessThanOrEqual(1);
      expect(result.f1).toBeGreaterThanOrEqual(0);
      expect(result.f1).toBeLessThanOrEqual(1);
    });

    it('should compute F1 as harmonic mean of precision and recall', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      if (result.precision > 0 && result.recall > 0) {
        const expectedF1 = (2 * result.precision * result.recall) / (result.precision + result.recall);
        expect(result.f1).toBeCloseTo(expectedF1, 5);
      }
    });

    it('should return high precision when all retrieved contexts are relevant', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      expect(result.precision).toBeGreaterThan(0.7);
    });

    it('should return low precision when retrieved contexts are irrelevant', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: irrelevantContexts,
      });

      expect(result.precision).toBeLessThan(0.3);
    });

    it('should return moderate precision for mixed contexts', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: mixedContexts,
      });

      // With 2/4 relevant, precision should be around 0.5
      expect(result.precision).toBeGreaterThan(0.3);
      expect(result.precision).toBeLessThan(0.8);
    });

    it('should handle empty retrieved contexts', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: [],
      });

      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
      expect(result.f1).toBe(0);
      expect(result.retrievedChunks).toBe(0);
    });

    it('should handle empty question', async () => {
      const result = await evaluator.evaluate({
        question: '',
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      expect(result).toBeDefined();
      // With no question, relevance cannot be determined well
      expect(result.precision).toBeDefined();
    });

    it('should handle empty answer', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: '',
        retrievedContexts: relevantContexts,
      });

      expect(result).toBeDefined();
      expect(result.precision).toBeDefined();
    });

    it('should count relevant and retrieved chunks correctly', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: mixedContexts,
      });

      expect(result.retrievedChunks).toBe(4);
      // Should detect about half are relevant
      expect(result.relevantChunks).toBeGreaterThanOrEqual(1);
      expect(result.relevantChunks).toBeLessThanOrEqual(4);
    });
  });

  // ==========================================================================
  // evaluate() with ground truth - Recall Tests
  // ==========================================================================

  describe('evaluate with ground truth', () => {
    it('should compute recall when ground truth is provided', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
        groundTruthContexts: groundTruthContexts,
      });

      expect(result.recall).toBeGreaterThan(0);
    });

    it('should return high recall when all needed contexts are retrieved', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: groundTruthContexts,
        groundTruthContexts: groundTruthContexts,
      });

      expect(result.recall).toBeGreaterThan(0.7);
    });

    it('should return low recall when needed contexts are missing', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: irrelevantContexts,
        groundTruthContexts: groundTruthContexts,
      });

      expect(result.recall).toBeLessThan(0.3);
    });

    it('should track needed chunks when ground truth is provided', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
        groundTruthContexts: groundTruthContexts,
      });

      expect(result.neededChunks).toBe(groundTruthContexts.length);
    });
  });

  // ==========================================================================
  // evaluate() without ground truth - Recall Estimation Tests
  // ==========================================================================

  describe('evaluate without ground truth', () => {
    it('should estimate recall based on answer coverage when no ground truth', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      // Without ground truth, recall should be estimated from answer
      expect(result.recall).toBeDefined();
      expect(result.recall).toBeGreaterThanOrEqual(0);
      expect(result.recall).toBeLessThanOrEqual(1);
    });

    it('should estimate neededChunks from answer when no ground truth', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      expect(result.neededChunks).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // evaluateChunkRelevance() Tests
  // ==========================================================================

  describe('evaluateChunkRelevance', () => {
    it('should return a relevance score between 0 and 1', async () => {
      const score = await evaluator.evaluateChunkRelevance(
        relevantContexts[0],
        sampleQuestion,
        sampleAnswer
      );

      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should score highly relevant chunks higher', async () => {
      const relevantScore = await evaluator.evaluateChunkRelevance(
        'class UserService { login(username, password) { validates credentials } }',
        sampleQuestion,
        sampleAnswer
      );

      const irrelevantScore = await evaluator.evaluateChunkRelevance(
        'The color scheme uses blue (#0066cc) for primary buttons.',
        sampleQuestion,
        sampleAnswer
      );

      expect(relevantScore).toBeGreaterThan(irrelevantScore);
    });

    it('should consider question keywords in relevance', async () => {
      const score = await evaluator.evaluateChunkRelevance(
        'UserService is the main service class.',
        'What does the UserService class do?',
        'It handles authentication.'
      );

      expect(score).toBeGreaterThan(0.3);
    });

    it('should consider answer overlap in relevance', async () => {
      const score = await evaluator.evaluateChunkRelevance(
        'Authentication is handled by the service.',
        sampleQuestion,
        'The service handles authentication.'
      );

      expect(score).toBeGreaterThan(0.3);
    });

    it('should handle empty chunk', async () => {
      const score = await evaluator.evaluateChunkRelevance(
        '',
        sampleQuestion,
        sampleAnswer
      );

      expect(score).toBe(0);
    });

    it('should handle chunk with only whitespace', async () => {
      const score = await evaluator.evaluateChunkRelevance(
        '   \n\t   ',
        sampleQuestion,
        sampleAnswer
      );

      expect(score).toBe(0);
    });
  });

  // ==========================================================================
  // getAverageMetrics() Tests
  // ==========================================================================

  describe('getAverageMetrics', () => {
    it('should return average metrics structure', () => {
      const metrics = evaluator.getAverageMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics.avgPrecision).toBe('number');
      expect(typeof metrics.avgRecall).toBe('number');
      expect(typeof metrics.avgF1).toBe('number');
    });

    it('should return zeros before any evaluation', () => {
      const freshEvaluator = createContextQualityEvaluator();
      const metrics = freshEvaluator.getAverageMetrics();

      expect(metrics.avgPrecision).toBe(0);
      expect(metrics.avgRecall).toBe(0);
      expect(metrics.avgF1).toBe(0);
    });

    it('should track running averages after evaluations', async () => {
      await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      });

      const metrics = evaluator.getAverageMetrics();

      expect(metrics.avgPrecision).toBeGreaterThan(0);
      expect(metrics.avgRecall).toBeGreaterThanOrEqual(0);
      expect(metrics.avgF1).toBeGreaterThanOrEqual(0);
    });

    it('should compute correct average after multiple evaluations', async () => {
      const results: ContextQualityResult[] = [];

      results.push(await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: relevantContexts,
      }));

      results.push(await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: irrelevantContexts,
      }));

      const metrics = evaluator.getAverageMetrics();

      const expectedAvgPrecision = (results[0].precision + results[1].precision) / 2;
      const expectedAvgRecall = (results[0].recall + results[1].recall) / 2;
      const expectedAvgF1 = (results[0].f1 + results[1].f1) / 2;

      expect(metrics.avgPrecision).toBeCloseTo(expectedAvgPrecision, 5);
      expect(metrics.avgRecall).toBeCloseTo(expectedAvgRecall, 5);
      expect(metrics.avgF1).toBeCloseTo(expectedAvgF1, 5);
    });
  });

  // ==========================================================================
  // Acceptance Criteria Tests
  // ==========================================================================

  describe('acceptance criteria', () => {
    it('should achieve context recall >= 80% target for well-matched retrieval', async () => {
      // Perfect retrieval scenario where all ground truth contexts are retrieved
      const result = await evaluator.evaluate({
        question: 'How does authentication work in UserService?',
        answer: 'UserService handles authentication by validating credentials through the login method and managing sessions.',
        retrievedContexts: [
          'UserService handles authentication by validating credentials.',
          'The login method in UserService validates user credentials.',
          'Session management is part of UserService functionality.',
        ],
        groundTruthContexts: [
          'UserService handles authentication.',
          'login method validates credentials.',
          'Session management in UserService.',
        ],
      });

      expect(result.recall).toBeGreaterThanOrEqual(0.8);
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle very long contexts', async () => {
      const longContext = 'UserService handles authentication. '.repeat(100);

      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: [longContext],
      });

      expect(result).toBeDefined();
      expect(result.precision).toBeGreaterThanOrEqual(0);
    });

    it('should handle special characters in contexts', async () => {
      const specialContext = 'function login<T extends User>(param: T): Promise<Session> { /* @deprecated */ }';

      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: [specialContext],
      });

      expect(result).toBeDefined();
    });

    it('should handle unicode characters', async () => {
      const unicodeContext = 'The UserService handles authentication with special chars: \u00e9\u00e0\u00fc\u00f1';

      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: [unicodeContext],
      });

      expect(result).toBeDefined();
    });

    it('should handle contexts with code blocks', async () => {
      const codeBlockContext = '```typescript\nclass UserService {\n  login() {}\n}\n```';

      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: [codeBlockContext],
      });

      expect(result).toBeDefined();
    });

    it('should handle single word contexts', async () => {
      const result = await evaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: ['UserService', 'login', 'authentication'],
      });

      expect(result).toBeDefined();
      expect(result.retrievedChunks).toBe(3);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should respect custom relevance threshold', async () => {
      const highThresholdEvaluator = createContextQualityEvaluator({
        relevanceThreshold: 0.9,
      });

      const lowThresholdEvaluator = createContextQualityEvaluator({
        relevanceThreshold: 0.1,
      });

      const highResult = await highThresholdEvaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: mixedContexts,
      });

      const lowResult = await lowThresholdEvaluator.evaluate({
        question: sampleQuestion,
        answer: sampleAnswer,
        retrievedContexts: mixedContexts,
      });

      // Higher threshold should result in fewer chunks marked as relevant
      expect(highResult.relevantChunks).toBeLessThanOrEqual(lowResult.relevantChunks);
    });
  });
});

// ============================================================================
// TYPE INTERFACE TESTS
// ============================================================================

describe('ContextQualityResult interface', () => {
  it('should have all required fields', async () => {
    const evaluator = createContextQualityEvaluator();
    const result = await evaluator.evaluate({
      question: sampleQuestion,
      answer: sampleAnswer,
      retrievedContexts: relevantContexts,
    });

    // Type check via presence of fields
    const {
      precision,
      recall,
      f1,
      relevantChunks,
      retrievedChunks,
      neededChunks,
    } = result;

    expect(precision).toBeDefined();
    expect(recall).toBeDefined();
    expect(f1).toBeDefined();
    expect(relevantChunks).toBeDefined();
    expect(retrievedChunks).toBeDefined();
    expect(neededChunks).toBeDefined();
  });
});

describe('ContextQualityConfig interface', () => {
  it('should support optional relevanceThreshold', () => {
    const config: ContextQualityConfig = {
      relevanceThreshold: 0.5,
    };

    const evaluator = createContextQualityEvaluator(config);
    expect(evaluator).toBeDefined();
  });

  it('should work with empty config', () => {
    const evaluator = createContextQualityEvaluator({});
    expect(evaluator).toBeDefined();
  });
});
