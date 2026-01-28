/**
 * @fileoverview RAGAS Metrics Suite Tests (WU-EVAL-001)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The RAGAS Metrics Suite implements the standard RAGAS evaluation framework:
 * - Faithfulness: Are claims grounded in context?
 * - Context Precision: Is retrieved context relevant?
 * - Context Recall: Did we retrieve all needed context?
 * - Answer Relevance: Does answer address the question?
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  RAGASMetrics,
  createRAGASMetrics,
  type RAGASInput,
  type RAGASOutput,
  type FaithfulnessResult,
  type ContextPrecisionResult,
  type ContextRecallResult,
  type AnswerRelevanceResult,
  type ClaimAnalysis,
} from '../ragas_metrics.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleInput: RAGASInput = {
  question: 'What does the UserService class do?',
  answer: 'The UserService class handles user authentication and session management. It has a login method that validates credentials and creates a session token.',
  contexts: [
    'class UserService { login(username: string, password: string): Promise<Session> { /* validates credentials */ } }',
    'UserService extends BaseService and implements AuthProvider interface.',
    'The session token is a JWT with a 24-hour expiration.',
  ],
  groundTruth: 'The UserService class manages user authentication, including login functionality that validates credentials and creates session tokens.',
};

const inputWithHallucination: RAGASInput = {
  question: 'What database does the application use?',
  answer: 'The application uses PostgreSQL as its primary database with Redis for caching. It also supports MongoDB for document storage.',
  contexts: [
    'const db = new PostgreSQLConnection(config.database);',
    'Redis is used for session caching.',
  ],
  groundTruth: 'The application uses PostgreSQL and Redis.',
};

const inputWithIrrelevantContext: RAGASInput = {
  question: 'How does error handling work?',
  answer: 'Errors are caught using try-catch blocks and logged using the Logger service.',
  contexts: [
    'The color scheme uses blue (#0066cc) for primary buttons.',
    'try { await operation(); } catch (e) { Logger.error(e); }',
    'Font size is 14px for body text.',
    'The ErrorHandler class wraps all async operations.',
  ],
};

const inputWithPoorRecall: RAGASInput = {
  question: 'What are all the API endpoints?',
  answer: 'The API has /users and /products endpoints.',
  contexts: [
    'app.get("/users", getUsersHandler);',
  ],
  groundTruth: 'The API has endpoints: /users, /products, /orders, /auth/login, /auth/logout, /settings.',
};

const inputWithIrrelevantAnswer: RAGASInput = {
  question: 'How do I configure logging?',
  answer: 'The database uses connection pooling with a maximum of 10 connections.',
  contexts: [
    'Logger.configure({ level: "info", format: "json" });',
    'const pool = new Pool({ max: 10 });',
  ],
};

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createRAGASMetrics', () => {
  it('should create a RAGASMetrics instance', () => {
    const metrics = createRAGASMetrics();
    expect(metrics).toBeInstanceOf(RAGASMetrics);
  });
});

// ============================================================================
// RAGAS METRICS CLASS TESTS
// ============================================================================

describe('RAGASMetrics', () => {
  let metrics: RAGASMetrics;

  beforeAll(() => {
    metrics = createRAGASMetrics();
  });

  // ==========================================================================
  // evaluate() - Full Pipeline Tests
  // ==========================================================================

  describe('evaluate', () => {
    it('should return complete RAGASOutput with all metrics', async () => {
      const output = await metrics.evaluate(sampleInput);

      expect(output).toBeDefined();
      expect(output.faithfulness).toBeDefined();
      expect(output.contextPrecision).toBeDefined();
      expect(output.contextRecall).toBeDefined();
      expect(output.answerRelevance).toBeDefined();
      expect(output.overallScore).toBeDefined();
      expect(output.summary).toBeDefined();
    });

    it('should have scores between 0 and 1', async () => {
      const output = await metrics.evaluate(sampleInput);

      expect(output.faithfulness.score).toBeGreaterThanOrEqual(0);
      expect(output.faithfulness.score).toBeLessThanOrEqual(1);
      expect(output.contextPrecision.score).toBeGreaterThanOrEqual(0);
      expect(output.contextPrecision.score).toBeLessThanOrEqual(1);
      expect(output.contextRecall.score).toBeGreaterThanOrEqual(0);
      expect(output.contextRecall.score).toBeLessThanOrEqual(1);
      expect(output.answerRelevance.score).toBeGreaterThanOrEqual(0);
      expect(output.answerRelevance.score).toBeLessThanOrEqual(1);
      expect(output.overallScore).toBeGreaterThanOrEqual(0);
      expect(output.overallScore).toBeLessThanOrEqual(1);
    });

    it('should compute overall score as weighted average', async () => {
      const output = await metrics.evaluate(sampleInput);

      // Overall score should be a reasonable combination of individual metrics
      const expectedRange = [
        Math.min(
          output.faithfulness.score,
          output.contextPrecision.score,
          output.contextRecall.score,
          output.answerRelevance.score
        ),
        Math.max(
          output.faithfulness.score,
          output.contextPrecision.score,
          output.contextRecall.score,
          output.answerRelevance.score
        ),
      ];
      expect(output.overallScore).toBeGreaterThanOrEqual(expectedRange[0] * 0.5);
      expect(output.overallScore).toBeLessThanOrEqual(expectedRange[1] * 1.5);
    });

    it('should provide meaningful summary', async () => {
      const output = await metrics.evaluate(sampleInput);

      expect(typeof output.summary).toBe('string');
      expect(output.summary.length).toBeGreaterThan(0);
    });

    it('should handle empty contexts gracefully', async () => {
      const input: RAGASInput = {
        question: 'What is X?',
        answer: 'X is something.',
        contexts: [],
      };

      const output = await metrics.evaluate(input);

      expect(output).toBeDefined();
      expect(output.faithfulness.score).toBe(0);
      expect(output.contextPrecision.score).toBe(0);
    });

    it('should handle missing ground truth', async () => {
      const input: RAGASInput = {
        question: 'What is Y?',
        answer: 'Y is a thing.',
        contexts: ['Y is defined as a thing in the code.'],
        // No groundTruth provided
      };

      const output = await metrics.evaluate(input);

      expect(output).toBeDefined();
      // Context recall should be 0 or skipped without ground truth
      expect(output.contextRecall.score).toBeDefined();
    });
  });

  // ==========================================================================
  // computeFaithfulness() Tests
  // ==========================================================================

  describe('computeFaithfulness', () => {
    it('should return FaithfulnessResult with score and claims', async () => {
      const result = await metrics.computeFaithfulness(sampleInput.answer, sampleInput.contexts);

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.claims)).toBe(true);
      expect(Array.isArray(result.unsupportedClaims)).toBe(true);
    });

    it('should score high when all claims are grounded in context', async () => {
      const answer = 'The UserService has a login method.';
      const contexts = ['class UserService { login() {} }'];

      const result = await metrics.computeFaithfulness(answer, contexts);

      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should score low when claims are not grounded', async () => {
      const answer = 'The application uses GraphQL for all queries and mutations.';
      const contexts = ['const app = express();', 'app.use(cors());'];

      const result = await metrics.computeFaithfulness(answer, contexts);

      expect(result.score).toBeLessThan(0.5);
      expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    });

    it('should identify individual claim support', async () => {
      const answer = 'The service uses PostgreSQL. It also uses Oracle for backups.';
      const contexts = ['const db = new PostgreSQLClient();'];

      const result = await metrics.computeFaithfulness(answer, contexts);

      // Should have claims array with support analysis
      expect(result.claims.length).toBeGreaterThan(0);
      const supportedClaims = result.claims.filter((c) => c.isSupported);
      const unsupportedClaims = result.claims.filter((c) => !c.isSupported);
      expect(supportedClaims.length).toBeGreaterThan(0);
      expect(unsupportedClaims.length).toBeGreaterThan(0);
    });

    it('should include confidence for each claim', async () => {
      const result = await metrics.computeFaithfulness(sampleInput.answer, sampleInput.contexts);

      for (const claim of result.claims) {
        expect(typeof claim.confidence).toBe('number');
        expect(claim.confidence).toBeGreaterThanOrEqual(0);
        expect(claim.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should handle empty answer', async () => {
      const result = await metrics.computeFaithfulness('', sampleInput.contexts);

      expect(result.score).toBe(1); // No claims = vacuously true
      expect(result.claims).toHaveLength(0);
    });

    it('should handle empty contexts', async () => {
      const result = await metrics.computeFaithfulness('Some claim about the code.', []);

      expect(result.score).toBe(0); // No context to ground claims
    });
  });

  // ==========================================================================
  // computeContextPrecision() Tests
  // ==========================================================================

  describe('computeContextPrecision', () => {
    it('should return ContextPrecisionResult with score and relevance details', async () => {
      const result = await metrics.computeContextPrecision(sampleInput.question, sampleInput.contexts);

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.contextRelevance)).toBe(true);
      expect(Array.isArray(result.averagePrecisionAtK)).toBe(true);
    });

    it('should score high when all contexts are relevant', async () => {
      const question = 'How does authentication work?';
      const contexts = [
        'Authentication uses JWT tokens.',
        'Users must provide username and password.',
        'Sessions expire after 24 hours.',
      ];

      const result = await metrics.computeContextPrecision(question, contexts);

      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should score low when contexts are irrelevant', async () => {
      const result = await metrics.computeContextPrecision(
        inputWithIrrelevantContext.question,
        inputWithIrrelevantContext.contexts
      );

      // 2 out of 4 contexts are irrelevant (color and font)
      expect(result.score).toBeLessThan(0.8);
    });

    it('should provide relevance score for each context', async () => {
      const result = await metrics.computeContextPrecision(sampleInput.question, sampleInput.contexts);

      expect(result.contextRelevance.length).toBe(sampleInput.contexts.length);
      for (const cr of result.contextRelevance) {
        expect(typeof cr.context).toBe('string');
        expect(typeof cr.relevance).toBe('number');
        expect(typeof cr.rank).toBe('number');
        expect(cr.relevance).toBeGreaterThanOrEqual(0);
        expect(cr.relevance).toBeLessThanOrEqual(1);
      }
    });

    it('should compute average precision at each k', async () => {
      const result = await metrics.computeContextPrecision(sampleInput.question, sampleInput.contexts);

      expect(result.averagePrecisionAtK.length).toBe(sampleInput.contexts.length);
      for (let k = 0; k < result.averagePrecisionAtK.length; k++) {
        expect(result.averagePrecisionAtK[k]).toBeGreaterThanOrEqual(0);
        expect(result.averagePrecisionAtK[k]).toBeLessThanOrEqual(1);
      }
    });

    it('should handle empty contexts', async () => {
      const result = await metrics.computeContextPrecision('Some question?', []);

      expect(result.score).toBe(0);
      expect(result.contextRelevance).toHaveLength(0);
    });

    it('should preserve rank order in results', async () => {
      const result = await metrics.computeContextPrecision(sampleInput.question, sampleInput.contexts);

      for (let i = 0; i < result.contextRelevance.length; i++) {
        expect(result.contextRelevance[i].rank).toBe(i + 1);
      }
    });
  });

  // ==========================================================================
  // computeContextRecall() Tests
  // ==========================================================================

  describe('computeContextRecall', () => {
    it('should return ContextRecallResult with score and attribution details', async () => {
      const result = await metrics.computeContextRecall(
        sampleInput.groundTruth!,
        sampleInput.contexts
      );

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.groundTruthClaims)).toBe(true);
      expect(Array.isArray(result.attributedClaims)).toBe(true);
    });

    it('should score high when all ground truth claims are covered', async () => {
      const groundTruth = 'UserService has a login method.';
      const contexts = ['class UserService { login(username, password) { } }'];

      const result = await metrics.computeContextRecall(groundTruth, contexts);

      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should score low when ground truth claims are missing', async () => {
      const result = await metrics.computeContextRecall(
        inputWithPoorRecall.groundTruth!,
        inputWithPoorRecall.contexts
      );

      // Only 1 of 6 endpoints is in context
      expect(result.score).toBeLessThan(0.5);
    });

    it('should extract claims from ground truth', async () => {
      const result = await metrics.computeContextRecall(
        sampleInput.groundTruth!,
        sampleInput.contexts
      );

      expect(result.groundTruthClaims.length).toBeGreaterThan(0);
    });

    it('should track attribution for each claim', async () => {
      const result = await metrics.computeContextRecall(
        sampleInput.groundTruth!,
        sampleInput.contexts
      );

      expect(result.attributedClaims.length).toBe(result.groundTruthClaims.length);
      for (const ac of result.attributedClaims) {
        expect(typeof ac.claim).toBe('string');
        expect(typeof ac.attributed).toBe('boolean');
        if (ac.attributed) {
          expect(typeof ac.context).toBe('string');
        }
      }
    });

    it('should handle empty ground truth', async () => {
      const result = await metrics.computeContextRecall('', sampleInput.contexts);

      expect(result.score).toBe(1); // No claims to attribute = perfect recall
      expect(result.groundTruthClaims).toHaveLength(0);
    });

    it('should handle empty contexts', async () => {
      const result = await metrics.computeContextRecall('Some ground truth claim.', []);

      expect(result.score).toBe(0); // No context to attribute to
    });
  });

  // ==========================================================================
  // computeAnswerRelevance() Tests
  // ==========================================================================

  describe('computeAnswerRelevance', () => {
    it('should return AnswerRelevanceResult with score and question analysis', async () => {
      const result = await metrics.computeAnswerRelevance(sampleInput.question, sampleInput.answer);

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.generatedQuestions)).toBe(true);
      expect(Array.isArray(result.questionSimilarities)).toBe(true);
    });

    it('should score high when answer directly addresses question', async () => {
      const question = 'What is the main function of UserService?';
      const answer = 'The main function of UserService is to handle user authentication and manage sessions.';

      const result = await metrics.computeAnswerRelevance(question, answer);

      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should score low when answer is irrelevant to question', async () => {
      const result = await metrics.computeAnswerRelevance(
        inputWithIrrelevantAnswer.question,
        inputWithIrrelevantAnswer.answer
      );

      expect(result.score).toBeLessThan(0.5);
    });

    it('should generate questions that could be answered by the answer', async () => {
      const result = await metrics.computeAnswerRelevance(sampleInput.question, sampleInput.answer);

      expect(result.generatedQuestions.length).toBeGreaterThan(0);
      for (const q of result.generatedQuestions) {
        expect(typeof q).toBe('string');
        expect(q.includes('?') || q.length > 0).toBe(true);
      }
    });

    it('should compute similarity between original and generated questions', async () => {
      const result = await metrics.computeAnswerRelevance(sampleInput.question, sampleInput.answer);

      expect(result.questionSimilarities.length).toBe(result.generatedQuestions.length);
      for (const sim of result.questionSimilarities) {
        expect(typeof sim).toBe('number');
        expect(sim).toBeGreaterThanOrEqual(0);
        expect(sim).toBeLessThanOrEqual(1);
      }
    });

    it('should handle empty answer', async () => {
      const result = await metrics.computeAnswerRelevance('What is X?', '');

      expect(result.score).toBe(0);
      expect(result.generatedQuestions).toHaveLength(0);
    });

    it('should handle empty question', async () => {
      const result = await metrics.computeAnswerRelevance('', 'Some answer.');

      expect(result.score).toBe(0);
    });
  });

  // ==========================================================================
  // extractClaims() Tests
  // ==========================================================================

  describe('extractClaims', () => {
    it('should extract claims from text', () => {
      const text = 'The service uses PostgreSQL. It handles authentication. Users can login.';
      const claims = metrics.extractClaims(text);

      expect(Array.isArray(claims)).toBe(true);
      expect(claims.length).toBeGreaterThan(0);
    });

    it('should extract multiple claims from complex text', () => {
      const text = 'UserService manages authentication. It validates credentials, creates sessions, and logs activity. The service uses JWT tokens for authorization.';
      const claims = metrics.extractClaims(text);

      expect(claims.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle single sentence', () => {
      const text = 'The database is PostgreSQL.';
      const claims = metrics.extractClaims(text);

      expect(claims.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty array for empty text', () => {
      const claims = metrics.extractClaims('');

      expect(claims).toHaveLength(0);
    });

    it('should handle text with only whitespace', () => {
      const claims = metrics.extractClaims('   \n\t  ');

      expect(claims).toHaveLength(0);
    });

    it('should extract claims from code-mixed text', () => {
      const text = 'The function `processData` returns a Promise. It accepts an array of objects.';
      const claims = metrics.extractClaims(text);

      expect(claims.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // ClaimAnalysis Interface Tests
  // ==========================================================================

  describe('ClaimAnalysis interface', () => {
    it('should have all required fields', async () => {
      const result = await metrics.computeFaithfulness(sampleInput.answer, sampleInput.contexts);

      if (result.claims.length > 0) {
        const claim = result.claims[0];
        expect(typeof claim.claim).toBe('string');
        expect(typeof claim.isSupported).toBe('boolean');
        expect(typeof claim.confidence).toBe('number');
        // supportingContext is optional
        if (claim.isSupported) {
          expect(typeof claim.supportingContext === 'string' || claim.supportingContext === undefined).toBe(true);
        }
      }
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle very long texts', async () => {
      const longAnswer = 'The system processes data. '.repeat(100);
      const longContext = 'Data processing module handles incoming requests. '.repeat(50);

      const result = await metrics.computeFaithfulness(longAnswer, [longContext]);

      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it('should handle special characters in text', async () => {
      const answer = 'The function returns <T extends Base>. It uses @decorator.';
      const contexts = ['<T extends Base> is a generic type constraint.'];

      const result = await metrics.computeFaithfulness(answer, contexts);

      expect(result).toBeDefined();
    });

    it('should handle unicode characters', async () => {
      const answer = 'The module handles unicode: \u00e9\u00e0\u00fc\u00f1.';
      const contexts = ['Unicode support is implemented.'];

      const result = await metrics.computeFaithfulness(answer, contexts);

      expect(result).toBeDefined();
    });

    it('should handle contexts with code blocks', async () => {
      const contexts = [
        '```typescript\nclass Service {\n  method() {}\n}\n```',
        'The Service class has a method.',
      ];

      const result = await metrics.computeContextPrecision('What methods does Service have?', contexts);

      expect(result).toBeDefined();
    });

    it('should handle questions without question marks', async () => {
      const question = 'Tell me about the UserService class';

      const result = await metrics.computeContextPrecision(question, sampleInput.contexts);

      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Integration-style Tests
  // ==========================================================================

  describe('integration', () => {
    it('should detect hallucination in answer', async () => {
      const output = await metrics.evaluate(inputWithHallucination);

      // MongoDB claim is not in context
      expect(output.faithfulness.unsupportedClaims.length).toBeGreaterThan(0);
      expect(output.faithfulness.score).toBeLessThan(1);
    });

    it('should measure poor context precision', async () => {
      const output = await metrics.evaluate(inputWithIrrelevantContext);

      // Color and font contexts are irrelevant
      expect(output.contextPrecision.score).toBeLessThan(1);
    });

    it('should measure poor context recall', async () => {
      const output = await metrics.evaluate(inputWithPoorRecall);

      // Missing most endpoints
      expect(output.contextRecall.score).toBeLessThan(0.5);
    });

    it('should measure poor answer relevance', async () => {
      const output = await metrics.evaluate(inputWithIrrelevantAnswer);

      // Answer about database pooling doesn't address logging question
      expect(output.answerRelevance.score).toBeLessThan(0.5);
    });

    it('should provide high scores for well-grounded responses', async () => {
      const wellGroundedInput: RAGASInput = {
        question: 'What is the login method signature?',
        answer: 'The login method accepts username and password as string parameters and returns a Promise of Session.',
        contexts: [
          'login(username: string, password: string): Promise<Session> { ... }',
        ],
        groundTruth: 'The login method takes username and password strings and returns a Promise<Session>.',
      };

      const output = await metrics.evaluate(wellGroundedInput);

      expect(output.faithfulness.score).toBeGreaterThan(0.7);
      expect(output.overallScore).toBeGreaterThan(0.6);
    });
  });
});

// ============================================================================
// TYPE INTERFACE TESTS
// ============================================================================

describe('RAGASInput interface', () => {
  it('should support all required fields', () => {
    const input: RAGASInput = {
      question: 'Test question?',
      answer: 'Test answer.',
      contexts: ['Context 1', 'Context 2'],
    };

    expect(input.question).toBe('Test question?');
    expect(input.answer).toBe('Test answer.');
    expect(input.contexts).toHaveLength(2);
  });

  it('should support optional groundTruth', () => {
    const inputWithGT: RAGASInput = {
      question: 'Test?',
      answer: 'Answer.',
      contexts: [],
      groundTruth: 'Expected answer.',
    };

    expect(inputWithGT.groundTruth).toBe('Expected answer.');

    const inputWithoutGT: RAGASInput = {
      question: 'Test?',
      answer: 'Answer.',
      contexts: [],
    };

    expect(inputWithoutGT.groundTruth).toBeUndefined();
  });
});

describe('RAGASOutput interface', () => {
  it('should have all required metric results', async () => {
    const metrics = createRAGASMetrics();
    const output = await metrics.evaluate(sampleInput);

    // Check structure
    expect(output.faithfulness).toHaveProperty('score');
    expect(output.faithfulness).toHaveProperty('claims');
    expect(output.faithfulness).toHaveProperty('unsupportedClaims');

    expect(output.contextPrecision).toHaveProperty('score');
    expect(output.contextPrecision).toHaveProperty('contextRelevance');
    expect(output.contextPrecision).toHaveProperty('averagePrecisionAtK');

    expect(output.contextRecall).toHaveProperty('score');
    expect(output.contextRecall).toHaveProperty('groundTruthClaims');
    expect(output.contextRecall).toHaveProperty('attributedClaims');

    expect(output.answerRelevance).toHaveProperty('score');
    expect(output.answerRelevance).toHaveProperty('generatedQuestions');
    expect(output.answerRelevance).toHaveProperty('questionSimilarities');

    expect(typeof output.overallScore).toBe('number');
    expect(typeof output.summary).toBe('string');
  });
});
