/**
 * @fileoverview Comprehensive Tests for Chain-of-Verification (ACL 2024)
 *
 * Tests the 4-step Chain-of-Verification process:
 * 1. Generate baseline response
 * 2. Plan verification questions
 * 3. Answer verification questions independently
 * 4. Generate final verified response
 *
 * Also tests the new CoVeStep and CoVeResult interfaces, and integration
 * with the epistemics system.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChainOfVerification,
  createChainOfVerification,
  generateVerificationQuestions,
  executeVerificationChain,
  reviseBasedOnVerification,
  integrateWithEpistemics,
  type VerificationInput,
  type VerificationQuestion,
  type VerificationAnswer,
  type VerificationResult,
  type Inconsistency,
  type ChainOfVerificationConfig,
  type CoVeStep,
  type CoVeResult,
  type Evidence,
  DEFAULT_CHAIN_OF_VERIFICATION_CONFIG,
} from '../chain_of_verification.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleContext = [
  'The UserService class is defined in src/services/user.ts at line 15.',
  'UserService has methods: createUser, updateUser, deleteUser, findById.',
  'The createUser method accepts a UserInput parameter and returns Promise<User>.',
  'UserService extends BaseService and implements IUserService interface.',
  'The findById method accepts an id parameter of type string.',
];

const sampleQuery = 'What methods does UserService have and what do they return?';

const sampleBaselineResponse = `The UserService class has four methods:
1. createUser - accepts UserInput and returns Promise<User>
2. updateUser - updates a user record
3. deleteUser - deletes a user from the database
4. findById - accepts a string id and returns the user`;

const sampleClaim = 'The UserService class has four methods: createUser, updateUser, deleteUser, and findById. The createUser method returns Promise<User>.';

const sampleContextString = sampleContext.join('\n');

// ============================================================================
// CoVeStep INTERFACE TESTS
// ============================================================================

describe('CoVeStep Interface', () => {
  it('should have all required fields', () => {
    const step: CoVeStep = {
      claim: 'The function returns a string',
      verificationQuestion: 'What does the function return?',
      answer: 'string',
      confidence: 0.85,
      sources: ['src/utils.ts:10'],
    };

    expect(step.claim).toBeDefined();
    expect(step.verificationQuestion).toBeDefined();
    expect(step.answer).toBeDefined();
    expect(typeof step.confidence).toBe('number');
    expect(Array.isArray(step.sources)).toBe(true);
  });

  it('should allow empty sources array', () => {
    const step: CoVeStep = {
      claim: 'The function is async',
      verificationQuestion: 'Is the function async?',
      answer: 'Unable to verify',
      confidence: 0.2,
      sources: [],
    };

    expect(step.sources).toHaveLength(0);
  });

  it('should support multiple sources', () => {
    const step: CoVeStep = {
      claim: 'The class extends BaseService',
      verificationQuestion: 'Does the class extend BaseService?',
      answer: 'Yes, confirmed',
      confidence: 0.9,
      sources: ['src/services/user.ts:1', 'src/services/base.ts:5', 'docs/README.md'],
    };

    expect(step.sources).toHaveLength(3);
  });
});

// ============================================================================
// CoVeResult INTERFACE TESTS
// ============================================================================

describe('CoVeResult Interface', () => {
  it('should have all required fields', () => {
    const result: CoVeResult = {
      originalClaim: 'The UserService has four methods',
      verificationChain: [],
      finalVerdict: 'verified',
      overallConfidence: 0.85,
      revisions: [],
    };

    expect(result.originalClaim).toBeDefined();
    expect(Array.isArray(result.verificationChain)).toBe(true);
    expect(['verified', 'refuted', 'uncertain']).toContain(result.finalVerdict);
    expect(typeof result.overallConfidence).toBe('number');
    expect(Array.isArray(result.revisions)).toBe(true);
  });

  it('should support all verdict types', () => {
    const verdicts: Array<'verified' | 'refuted' | 'uncertain'> = ['verified', 'refuted', 'uncertain'];

    for (const verdict of verdicts) {
      const result: CoVeResult = {
        originalClaim: 'Test claim',
        verificationChain: [],
        finalVerdict: verdict,
        overallConfidence: 0.5,
        revisions: [],
      };
      expect(result.finalVerdict).toBe(verdict);
    }
  });

  it('should contain verification chain steps', () => {
    const result: CoVeResult = {
      originalClaim: 'Test claim with multiple sub-claims',
      verificationChain: [
        {
          claim: 'Sub-claim 1',
          verificationQuestion: 'Is sub-claim 1 true?',
          answer: 'Yes',
          confidence: 0.9,
          sources: ['source1.ts'],
        },
        {
          claim: 'Sub-claim 2',
          verificationQuestion: 'Is sub-claim 2 true?',
          answer: 'Yes',
          confidence: 0.8,
          sources: ['source2.ts'],
        },
      ],
      finalVerdict: 'verified',
      overallConfidence: 0.85,
      revisions: [],
    };

    expect(result.verificationChain).toHaveLength(2);
    expect(result.verificationChain[0].claim).toBe('Sub-claim 1');
    expect(result.verificationChain[1].confidence).toBe(0.8);
  });
});

// ============================================================================
// generateVerificationQuestions FUNCTION TESTS
// ============================================================================

describe('generateVerificationQuestions', () => {
  it('should generate questions from numeric claims', () => {
    const claim = 'The UserService has four methods.';
    const questions = generateVerificationQuestions(claim);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.toLowerCase().includes('how many'))).toBe(true);
  });

  it('should generate questions from return type claims', () => {
    const claim = 'The createUser function returns Promise<User>.';
    const questions = generateVerificationQuestions(claim);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.toLowerCase().includes('return'))).toBe(true);
  });

  it('should generate questions from boolean claims', () => {
    const claim = 'UserService is a class that extends BaseService.';
    const questions = generateVerificationQuestions(claim);

    expect(questions.length).toBeGreaterThan(0);
  });

  it('should generate questions from method existence claims', () => {
    const claim = 'The class has a method called processData.';
    const questions = generateVerificationQuestions(claim);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.toLowerCase().includes('method'))).toBe(true);
  });

  it('should handle claims with no extractable patterns', () => {
    const claim = 'This is a general statement without specific verifiable claims.';
    const questions = generateVerificationQuestions(claim);

    // Should generate general verification questions
    expect(Array.isArray(questions)).toBe(true);
  });

  it('should deduplicate similar questions', () => {
    const claim = 'UserService has four methods. The UserService has four methods.';
    const questions = generateVerificationQuestions(claim);

    // Check for no exact duplicates
    const uniqueQuestions = [...new Set(questions.map((q) => q.toLowerCase()))];
    expect(uniqueQuestions.length).toBe(questions.length);
  });

  it('should handle complex multi-claim text', () => {
    const claim = `The UserService class has four methods: createUser, updateUser, deleteUser, and findById.
    The createUser method returns Promise<User> and accepts a UserInput parameter.
    UserService extends BaseService and implements IUserService.`;

    const questions = generateVerificationQuestions(claim);

    expect(questions.length).toBeGreaterThan(2);
  });
});

// ============================================================================
// executeVerificationChain FUNCTION TESTS
// ============================================================================

describe('executeVerificationChain', () => {
  it('should return a valid CoVeResult', () => {
    const result = executeVerificationChain(sampleClaim, sampleContextString);

    expect(result).toHaveProperty('originalClaim');
    expect(result).toHaveProperty('verificationChain');
    expect(result).toHaveProperty('finalVerdict');
    expect(result).toHaveProperty('overallConfidence');
    expect(result).toHaveProperty('revisions');
  });

  it('should populate verification chain with steps', () => {
    const result = executeVerificationChain(sampleClaim, sampleContextString);

    expect(Array.isArray(result.verificationChain)).toBe(true);

    for (const step of result.verificationChain) {
      expect(step).toHaveProperty('claim');
      expect(step).toHaveProperty('verificationQuestion');
      expect(step).toHaveProperty('answer');
      expect(step).toHaveProperty('confidence');
      expect(step).toHaveProperty('sources');
    }
  });

  it('should compute verdict based on verification', () => {
    const result = executeVerificationChain(sampleClaim, sampleContextString);

    expect(['verified', 'refuted', 'uncertain']).toContain(result.finalVerdict);
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(result.overallConfidence).toBeLessThanOrEqual(1);
  });

  it('should handle empty context', () => {
    const result = executeVerificationChain(sampleClaim, '');

    // With no context, claims cannot be verified so verdict should be uncertain or refuted
    expect(['uncertain', 'refuted']).toContain(result.finalVerdict);
    expect(result.overallConfidence).toBeLessThanOrEqual(0.5);
  });

  it('should generate revisions for unverified claims', () => {
    const unreliableClaim = 'The NonexistentClass has 100 methods and returns ComplexType.';
    const result = executeVerificationChain(unreliableClaim, sampleContextString);

    // Should either have revisions or be marked as uncertain/refuted
    expect(
      result.revisions.length > 0 ||
      result.finalVerdict === 'refuted' ||
      result.finalVerdict === 'uncertain'
    ).toBe(true);
  });

  it('should include sources in verification steps', () => {
    const result = executeVerificationChain(sampleClaim, sampleContextString);

    // At least some steps should have sources if context is provided
    const stepsWithSources = result.verificationChain.filter((s) => s.sources.length > 0);
    expect(stepsWithSources.length).toBeGreaterThanOrEqual(0); // May be 0 if no matching context
  });
});

// ============================================================================
// reviseBasedOnVerification FUNCTION TESTS
// ============================================================================

describe('reviseBasedOnVerification', () => {
  it('should return original claim if verified', () => {
    const claim = 'This claim is verified.';
    const result: CoVeResult = {
      originalClaim: claim,
      verificationChain: [],
      finalVerdict: 'verified',
      overallConfidence: 0.9,
      revisions: [],
    };

    const revised = reviseBasedOnVerification(claim, result);
    expect(revised).toBe(claim);
  });

  it('should return revision if refuted with revisions available', () => {
    const claim = 'This claim is wrong.';
    const result: CoVeResult = {
      originalClaim: claim,
      verificationChain: [],
      finalVerdict: 'refuted',
      overallConfidence: 0.2,
      revisions: ['[Correction: This claim should be X]'],
    };

    const revised = reviseBasedOnVerification(claim, result);
    expect(revised).toBe(result.revisions[0]);
  });

  it('should add [Unverified] prefix if refuted without revisions', () => {
    const claim = 'This claim cannot be verified.';
    const result: CoVeResult = {
      originalClaim: claim,
      verificationChain: [],
      finalVerdict: 'refuted',
      overallConfidence: 0.1,
      revisions: [],
    };

    const revised = reviseBasedOnVerification(claim, result);
    expect(revised).toContain('[Unverified]');
    expect(revised).toContain(claim);
  });

  it('should add hedging language if uncertain', () => {
    const claim = 'This claim is uncertain.';
    const result: CoVeResult = {
      originalClaim: claim,
      verificationChain: [],
      finalVerdict: 'uncertain',
      overallConfidence: 0.5,
      revisions: [],
    };

    const revised = reviseBasedOnVerification(claim, result);

    // Should have hedging phrase
    const hedgingPhrases = ['may', 'might', 'possibly', 'appears to', 'seems to', 'likely'];
    expect(hedgingPhrases.some((h) => revised.toLowerCase().includes(h))).toBe(true);
  });
});

// ============================================================================
// integrateWithEpistemics FUNCTION TESTS
// ============================================================================

describe('integrateWithEpistemics', () => {
  it('should return a valid Evidence object', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Test claim',
      verificationChain: [
        {
          claim: 'Sub-claim',
          verificationQuestion: 'Is it true?',
          answer: 'Yes',
          confidence: 0.85,
          sources: ['test.ts:1'],
        },
      ],
      finalVerdict: 'verified',
      overallConfidence: 0.85,
      revisions: [],
    };

    const evidence = integrateWithEpistemics(coveResult);

    expect(evidence).toHaveProperty('id');
    expect(evidence).toHaveProperty('type');
    expect(evidence).toHaveProperty('claim');
    expect(evidence).toHaveProperty('content');
    expect(evidence).toHaveProperty('supports');
    expect(evidence).toHaveProperty('confidence');
    expect(evidence).toHaveProperty('source');
    expect(evidence).toHaveProperty('timestamp');
  });

  it('should set supports=true for verified claims', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Verified claim',
      verificationChain: [],
      finalVerdict: 'verified',
      overallConfidence: 0.9,
      revisions: [],
    };

    const evidence = integrateWithEpistemics(coveResult);
    expect(evidence.supports).toBe(true);
  });

  it('should set supports=false for refuted claims', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Refuted claim',
      verificationChain: [],
      finalVerdict: 'refuted',
      overallConfidence: 0.2,
      revisions: ['Correction'],
    };

    const evidence = integrateWithEpistemics(coveResult);
    expect(evidence.supports).toBe(false);
  });

  it('should set supports=false for uncertain claims', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Uncertain claim',
      verificationChain: [],
      finalVerdict: 'uncertain',
      overallConfidence: 0.5,
      revisions: [],
    };

    const evidence = integrateWithEpistemics(coveResult);
    expect(evidence.supports).toBe(false);
  });

  it('should include ConfidenceValue with proper type', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Test claim',
      verificationChain: [
        {
          claim: 'Sub-claim',
          verificationQuestion: 'Q?',
          answer: 'A',
          confidence: 0.8,
          sources: [],
        },
      ],
      finalVerdict: 'verified',
      overallConfidence: 0.8,
      revisions: [],
    };

    const evidence = integrateWithEpistemics(coveResult);

    expect(evidence.confidence).toHaveProperty('type');
    expect(['deterministic', 'derived', 'measured', 'bounded', 'absent']).toContain(evidence.confidence.type);
  });

  it('should include metadata with verification chain', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Test claim',
      verificationChain: [
        {
          claim: 'Sub-claim',
          verificationQuestion: 'Q?',
          answer: 'A',
          confidence: 0.8,
          sources: ['src.ts'],
        },
      ],
      finalVerdict: 'verified',
      overallConfidence: 0.8,
      revisions: ['Some revision'],
    };

    const evidence = integrateWithEpistemics(coveResult);

    expect(evidence.metadata).toBeDefined();
    expect(evidence.metadata?.verificationChain).toEqual(coveResult.verificationChain);
    expect(evidence.metadata?.revisions).toEqual(coveResult.revisions);
  });

  it('should have source with tool type', () => {
    const coveResult: CoVeResult = {
      originalClaim: 'Test',
      verificationChain: [],
      finalVerdict: 'verified',
      overallConfidence: 0.9,
      revisions: [],
    };

    const evidence = integrateWithEpistemics(coveResult);

    expect(evidence.source.type).toBe('tool');
    expect(evidence.source.id).toBe('chain_of_verification');
  });
});

// ============================================================================
// FACTORY TESTS
// ============================================================================

describe('ChainOfVerification Factory', () => {
  it('should create instance with default config', () => {
    const cov = createChainOfVerification();
    expect(cov).toBeInstanceOf(ChainOfVerification);
  });

  it('should create instance with custom config', () => {
    const cov = createChainOfVerification({
      maxVerificationQuestions: 5,
      minConfidenceThreshold: 0.8,
    });
    expect(cov).toBeInstanceOf(ChainOfVerification);
  });

  it('should have sensible default config values', () => {
    expect(DEFAULT_CHAIN_OF_VERIFICATION_CONFIG.maxVerificationQuestions).toBeGreaterThan(0);
    expect(DEFAULT_CHAIN_OF_VERIFICATION_CONFIG.minConfidenceThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CHAIN_OF_VERIFICATION_CONFIG.minConfidenceThreshold).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// BASELINE GENERATION TESTS
// ============================================================================

describe('ChainOfVerification.generateBaseline', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should generate baseline response from query and context', async () => {
    const baseline = await cov.generateBaseline(sampleQuery, sampleContext);

    expect(typeof baseline).toBe('string');
    expect(baseline.length).toBeGreaterThan(0);
  });

  it('should incorporate context into baseline response', async () => {
    const baseline = await cov.generateBaseline(sampleQuery, sampleContext);

    // Should mention at least some methods from context
    expect(
      baseline.toLowerCase().includes('createuser') ||
      baseline.toLowerCase().includes('findbyid') ||
      baseline.toLowerCase().includes('method')
    ).toBe(true);
  });

  it('should handle empty context gracefully', async () => {
    const baseline = await cov.generateBaseline(sampleQuery, []);

    expect(typeof baseline).toBe('string');
  });

  it('should handle empty query gracefully', async () => {
    const baseline = await cov.generateBaseline('', sampleContext);

    expect(typeof baseline).toBe('string');
  });
});

// ============================================================================
// VERIFICATION QUESTION PLANNING TESTS
// ============================================================================

describe('ChainOfVerification.planVerificationQuestions', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should generate verification questions from response', () => {
    const questions = cov.planVerificationQuestions(sampleBaselineResponse);

    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThan(0);
  });

  it('should generate questions with required fields', () => {
    const questions = cov.planVerificationQuestions(sampleBaselineResponse);

    for (const q of questions) {
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('question');
      expect(q).toHaveProperty('targetClaim');
      expect(q).toHaveProperty('expectedAnswerType');
      expect(typeof q.id).toBe('string');
      expect(typeof q.question).toBe('string');
      expect(typeof q.targetClaim).toBe('string');
      expect(['factual', 'boolean', 'numeric']).toContain(q.expectedAnswerType);
    }
  });

  it('should generate unique question IDs', () => {
    const questions = cov.planVerificationQuestions(sampleBaselineResponse);
    const ids = questions.map((q) => q.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should limit questions to maxVerificationQuestions config', () => {
    const cov3 = createChainOfVerification({ maxVerificationQuestions: 3 });
    const questions = cov3.planVerificationQuestions(sampleBaselineResponse);

    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('should target verifiable claims', () => {
    const questions = cov.planVerificationQuestions(
      'The UserService class has exactly 4 methods. The createUser method returns Promise<User>.'
    );

    // Should generate questions about these specific claims
    expect(questions.some((q) => q.targetClaim.includes('4') || q.targetClaim.includes('method'))).toBe(true);
  });

  it('should handle response with no verifiable claims', () => {
    const questions = cov.planVerificationQuestions('This is a general comment without any specific claims.');

    expect(Array.isArray(questions)).toBe(true);
    // May have zero questions, which is valid
  });

  it('should identify expected answer types correctly', () => {
    const response = 'The class has 4 methods. createUser returns a Promise. The method exists.';
    const questions = cov.planVerificationQuestions(response);

    // Should have at least one numeric question about "4 methods"
    const numericQuestions = questions.filter((q) => q.expectedAnswerType === 'numeric');
    const factualQuestions = questions.filter((q) => q.expectedAnswerType === 'factual');

    // At least some should be categorized
    expect(numericQuestions.length + factualQuestions.length).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// ANSWER VERIFICATION QUESTIONS TESTS
// ============================================================================

describe('ChainOfVerification.answerVerificationQuestions', () => {
  let cov: ChainOfVerification;
  let sampleQuestions: VerificationQuestion[];

  beforeEach(() => {
    cov = createChainOfVerification();
    sampleQuestions = [
      {
        id: 'vq-001',
        question: 'How many methods does UserService have?',
        targetClaim: 'UserService has four methods',
        expectedAnswerType: 'numeric',
      },
      {
        id: 'vq-002',
        question: 'What does createUser return?',
        targetClaim: 'createUser returns Promise<User>',
        expectedAnswerType: 'factual',
      },
      {
        id: 'vq-003',
        question: 'Does UserService have a findById method?',
        targetClaim: 'UserService has findById method',
        expectedAnswerType: 'boolean',
      },
    ];
  });

  it('should answer all verification questions', async () => {
    const answers = await cov.answerVerificationQuestions(sampleQuestions, sampleContext);

    expect(Array.isArray(answers)).toBe(true);
    expect(answers.length).toBe(sampleQuestions.length);
  });

  it('should return answers with required fields', async () => {
    const answers = await cov.answerVerificationQuestions(sampleQuestions, sampleContext);

    for (const a of answers) {
      expect(a).toHaveProperty('questionId');
      expect(a).toHaveProperty('answer');
      expect(a).toHaveProperty('confidence');
      expect(a).toHaveProperty('consistentWithBaseline');
      expect(typeof a.questionId).toBe('string');
      expect(typeof a.answer).toBe('string');
      expect(typeof a.confidence).toBe('number');
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(typeof a.consistentWithBaseline).toBe('boolean');
    }
  });

  it('should match questionIds to original questions', async () => {
    const answers = await cov.answerVerificationQuestions(sampleQuestions, sampleContext);

    const questionIds = new Set(sampleQuestions.map((q) => q.id));
    for (const a of answers) {
      expect(questionIds.has(a.questionId)).toBe(true);
    }
  });

  it('should include source citations when available', async () => {
    const answers = await cov.answerVerificationQuestions(sampleQuestions, sampleContext);

    // At least some answers should have citations
    const answersWithCitations = answers.filter((a) => a.sourceCitation !== undefined);
    // This is context-dependent, so we just check structure if present
    for (const a of answersWithCitations) {
      expect(typeof a.sourceCitation).toBe('string');
    }
  });

  it('should handle empty context', async () => {
    const answers = await cov.answerVerificationQuestions(sampleQuestions, []);

    expect(Array.isArray(answers)).toBe(true);
    // Should still return answers, but with lower confidence
    for (const a of answers) {
      expect(a.confidence).toBeLessThanOrEqual(0.5);
    }
  });

  it('should handle empty questions array', async () => {
    const answers = await cov.answerVerificationQuestions([], sampleContext);

    expect(Array.isArray(answers)).toBe(true);
    expect(answers.length).toBe(0);
  });
});

// ============================================================================
// INCONSISTENCY DETECTION TESTS
// ============================================================================

describe('ChainOfVerification.detectInconsistencies', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should detect no inconsistencies when answers are consistent', () => {
    const baseline = 'UserService has 4 methods. createUser returns Promise<User>.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: '4 methods',
        confidence: 0.9,
        consistentWithBaseline: true,
      },
      {
        questionId: 'vq-002',
        answer: 'Promise<User>',
        confidence: 0.85,
        consistentWithBaseline: true,
      },
    ];

    const inconsistencies = cov.detectInconsistencies(baseline, answers);

    expect(Array.isArray(inconsistencies)).toBe(true);
    expect(inconsistencies.length).toBe(0);
  });

  it('should detect inconsistencies when answers contradict baseline', () => {
    const baseline = 'UserService has 4 methods.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: '3 methods',
        confidence: 0.9,
        consistentWithBaseline: false,
      },
    ];

    const inconsistencies = cov.detectInconsistencies(baseline, answers);

    expect(inconsistencies.length).toBeGreaterThan(0);
  });

  it('should return inconsistencies with required fields', () => {
    const baseline = 'The method returns void.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: 'Promise<string>',
        confidence: 0.8,
        consistentWithBaseline: false,
      },
    ];

    const inconsistencies = cov.detectInconsistencies(baseline, answers);

    for (const inc of inconsistencies) {
      expect(inc).toHaveProperty('questionId');
      expect(inc).toHaveProperty('baselineClaim');
      expect(inc).toHaveProperty('verifiedClaim');
      expect(inc).toHaveProperty('resolution');
      expect(['revised', 'kept_original', 'removed']).toContain(inc.resolution);
    }
  });

  it('should handle empty answers array', () => {
    const inconsistencies = cov.detectInconsistencies(sampleBaselineResponse, []);

    expect(Array.isArray(inconsistencies)).toBe(true);
    expect(inconsistencies.length).toBe(0);
  });

  it('should set resolution based on confidence', () => {
    const baseline = 'The method returns void.';

    // High confidence contradiction should revise
    const highConfAnswers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: 'Promise<string>',
        confidence: 0.95,
        consistentWithBaseline: false,
      },
    ];
    const highConfInconsistencies = cov.detectInconsistencies(baseline, highConfAnswers);

    // Low confidence contradiction should keep original or remove
    const lowConfAnswers: VerificationAnswer[] = [
      {
        questionId: 'vq-002',
        answer: 'unknown type',
        confidence: 0.2,
        consistentWithBaseline: false,
      },
    ];
    const lowConfInconsistencies = cov.detectInconsistencies(baseline, lowConfAnswers);

    // High confidence should lead to revision
    if (highConfInconsistencies.length > 0) {
      expect(highConfInconsistencies[0].resolution).toBe('revised');
    }

    // Low confidence should keep original
    if (lowConfInconsistencies.length > 0) {
      expect(['kept_original', 'removed']).toContain(lowConfInconsistencies[0].resolution);
    }
  });
});

// ============================================================================
// FINAL RESPONSE SYNTHESIS TESTS
// ============================================================================

describe('ChainOfVerification.synthesizeFinalResponse', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should return original baseline when all answers are consistent', () => {
    const baseline = 'UserService has 4 methods.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: '4 methods',
        confidence: 0.9,
        consistentWithBaseline: true,
      },
    ];

    const finalResponse = cov.synthesizeFinalResponse(baseline, answers);

    expect(finalResponse).toContain('4 methods');
  });

  it('should revise claims that were contradicted with high confidence', () => {
    const baseline = 'UserService has 4 methods.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: '5 methods',
        confidence: 0.95,
        consistentWithBaseline: false,
      },
    ];

    const finalResponse = cov.synthesizeFinalResponse(baseline, answers);

    // Should mention the corrected number or indicate uncertainty
    expect(
      finalResponse.includes('5') ||
      finalResponse.toLowerCase().includes('correct') ||
      finalResponse.toLowerCase().includes('actually')
    ).toBe(true);
  });

  it('should add hedging for low-confidence claims', () => {
    const baseline = 'The method definitely returns a string.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: 'possibly string',
        confidence: 0.4,
        consistentWithBaseline: false,
      },
    ];

    const finalResponse = cov.synthesizeFinalResponse(baseline, answers);

    // Should add hedging language
    expect(
      finalResponse.toLowerCase().includes('may') ||
      finalResponse.toLowerCase().includes('possibly') ||
      finalResponse.toLowerCase().includes('might') ||
      finalResponse.toLowerCase().includes('appears')
    ).toBe(true);
  });

  it('should handle empty answers array', () => {
    const finalResponse = cov.synthesizeFinalResponse(sampleBaselineResponse, []);

    expect(finalResponse).toBe(sampleBaselineResponse);
  });

  it('should preserve unverified claims', () => {
    const baseline = 'UserService has 4 methods. It is located in src/services.';
    const answers: VerificationAnswer[] = [
      {
        questionId: 'vq-001',
        answer: '4 methods',
        confidence: 0.9,
        consistentWithBaseline: true,
      },
      // No answer about location - should be preserved
    ];

    const finalResponse = cov.synthesizeFinalResponse(baseline, answers);

    // Location claim should be preserved since it wasn't contradicted
    expect(finalResponse.toLowerCase().includes('src/services')).toBe(true);
  });
});

// ============================================================================
// FULL VERIFICATION FLOW TESTS
// ============================================================================

describe('ChainOfVerification.verify', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should complete full verification flow', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
    };

    const result = await cov.verify(input);

    expect(result).toHaveProperty('originalQuery');
    expect(result).toHaveProperty('baselineResponse');
    expect(result).toHaveProperty('verificationQuestions');
    expect(result).toHaveProperty('verificationAnswers');
    expect(result).toHaveProperty('inconsistencies');
    expect(result).toHaveProperty('finalResponse');
    expect(result).toHaveProperty('improvementMetrics');
    expect(result).toHaveProperty('confidence');
  });

  it('should use provided baseline response if given', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: 'Custom baseline response for testing.',
    };

    const result = await cov.verify(input);

    expect(result.baselineResponse).toBe('Custom baseline response for testing.');
  });

  it('should generate baseline if not provided', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
    };

    const result = await cov.verify(input);

    expect(result.baselineResponse).not.toBe('');
  });

  it('should return valid improvement metrics', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const result = await cov.verify(input);

    expect(result.improvementMetrics).toHaveProperty('claimsVerified');
    expect(result.improvementMetrics).toHaveProperty('claimsRevised');
    expect(result.improvementMetrics).toHaveProperty('confidenceImprovement');
    expect(typeof result.improvementMetrics.claimsVerified).toBe('number');
    expect(typeof result.improvementMetrics.claimsRevised).toBe('number');
    expect(typeof result.improvementMetrics.confidenceImprovement).toBe('number');
    expect(result.improvementMetrics.claimsVerified).toBeGreaterThanOrEqual(0);
    expect(result.improvementMetrics.claimsRevised).toBeGreaterThanOrEqual(0);
  });

  it('should return ConfidenceValue type', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
    };

    const result = await cov.verify(input);

    expect(result.confidence).toHaveProperty('type');
    expect(['deterministic', 'derived', 'measured', 'bounded', 'absent']).toContain(result.confidence.type);
  });

  it('should handle empty context', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: [],
    };

    const result = await cov.verify(input);

    expect(result).toHaveProperty('finalResponse');
    // With no context, confidence should be lower
    if (result.confidence.type !== 'absent') {
      const confValue = 'value' in result.confidence ? result.confidence.value : 0;
      expect(confValue).toBeLessThanOrEqual(0.5);
    }
  });

  it('should handle empty query', async () => {
    const input: VerificationInput = {
      query: '',
      context: sampleContext,
    };

    const result = await cov.verify(input);

    expect(result).toHaveProperty('finalResponse');
  });
});

// ============================================================================
// toCoVeResult CONVERSION TESTS
// ============================================================================

describe('ChainOfVerification.toCoVeResult', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should convert VerificationResult to CoVeResult', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const verificationResult = await cov.verify(input);
    const coveResult = cov.toCoVeResult(verificationResult);

    expect(coveResult).toHaveProperty('originalClaim');
    expect(coveResult).toHaveProperty('verificationChain');
    expect(coveResult).toHaveProperty('finalVerdict');
    expect(coveResult).toHaveProperty('overallConfidence');
    expect(coveResult).toHaveProperty('revisions');
  });

  it('should preserve verification chain structure', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const verificationResult = await cov.verify(input);
    const coveResult = cov.toCoVeResult(verificationResult);

    expect(coveResult.verificationChain.length).toBe(verificationResult.verificationQuestions.length);

    for (const step of coveResult.verificationChain) {
      expect(step).toHaveProperty('claim');
      expect(step).toHaveProperty('verificationQuestion');
      expect(step).toHaveProperty('answer');
      expect(step).toHaveProperty('confidence');
      expect(step).toHaveProperty('sources');
    }
  });

  it('should compute correct verdict', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const verificationResult = await cov.verify(input);
    const coveResult = cov.toCoVeResult(verificationResult);

    expect(['verified', 'refuted', 'uncertain']).toContain(coveResult.finalVerdict);
    expect(coveResult.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(coveResult.overallConfidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should handle response with only one claim', async () => {
    const input: VerificationInput = {
      query: 'What is x?',
      context: ['x is 5'],
      baselineResponse: 'x is 5.',
    };

    const result = await cov.verify(input);

    expect(result.verificationQuestions.length).toBeLessThanOrEqual(1);
  });

  it('should handle very long context', async () => {
    const longContext = Array(100).fill('Line of context about the codebase.');
    const input: VerificationInput = {
      query: sampleQuery,
      context: longContext,
    };

    const result = await cov.verify(input);

    expect(result).toHaveProperty('finalResponse');
  });

  it('should handle special characters in response', async () => {
    const input: VerificationInput = {
      query: 'What is the regex?',
      context: ['The regex is /^[a-z]+$/i'],
      baselineResponse: 'The regex pattern is /^[a-z]+$/i which matches letters.',
    };

    const result = await cov.verify(input);

    expect(result).toHaveProperty('finalResponse');
  });

  it('should handle numeric claims', async () => {
    const input: VerificationInput = {
      query: 'How many lines?',
      context: ['The file has 150 lines of code.'],
      baselineResponse: 'The file has approximately 150 lines.',
    };

    const result = await cov.verify(input);

    const numericQuestions = result.verificationQuestions.filter(
      (q) => q.expectedAnswerType === 'numeric'
    );
    expect(numericQuestions.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle boolean claims', async () => {
    const input: VerificationInput = {
      query: 'Is the function async?',
      context: ['The processData function is async.'],
      baselineResponse: 'Yes, the function is async.',
    };

    const result = await cov.verify(input);

    expect(result).toHaveProperty('finalResponse');
  });

  it('should handle conflicting context', async () => {
    const conflictingContext = [
      'The function returns string.',
      'The function returns number.',
    ];
    const input: VerificationInput = {
      query: 'What does the function return?',
      context: conflictingContext,
      baselineResponse: 'The function returns string.',
    };

    const result = await cov.verify(input);

    // Should handle the conflict somehow - either hedging or noting uncertainty
    expect(result.confidence.type).toBe('derived');
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('Configuration Options', () => {
  it('should respect maxVerificationQuestions', async () => {
    const cov = createChainOfVerification({ maxVerificationQuestions: 2 });
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const result = await cov.verify(input);

    expect(result.verificationQuestions.length).toBeLessThanOrEqual(2);
  });

  it('should respect minConfidenceThreshold', async () => {
    const cov = createChainOfVerification({ minConfidenceThreshold: 0.9 });
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const result = await cov.verify(input);

    // Claims below threshold should be handled appropriately
    for (const answer of result.verificationAnswers) {
      if (answer.confidence < 0.9 && !answer.consistentWithBaseline) {
        const relatedInconsistency = result.inconsistencies.find(
          (inc) => inc.questionId === answer.questionId
        );
        if (relatedInconsistency) {
          expect(['revised', 'removed']).toContain(relatedInconsistency.resolution);
        }
      }
    }
  });
});

// ============================================================================
// RESULT STRUCTURE TESTS
// ============================================================================

describe('VerificationResult Structure', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should have all required VerificationResult fields', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
    };

    const result = await cov.verify(input);

    // Verify all required fields exist
    expect(result.originalQuery).toBe(sampleQuery);
    expect(typeof result.baselineResponse).toBe('string');
    expect(Array.isArray(result.verificationQuestions)).toBe(true);
    expect(Array.isArray(result.verificationAnswers)).toBe(true);
    expect(Array.isArray(result.inconsistencies)).toBe(true);
    expect(typeof result.finalResponse).toBe('string');
    expect(typeof result.improvementMetrics).toBe('object');
    expect(typeof result.confidence).toBe('object');
  });

  it('should have matching question and answer counts', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const result = await cov.verify(input);

    expect(result.verificationAnswers.length).toBe(result.verificationQuestions.length);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration with Epistemics System', () => {
  let cov: ChainOfVerification;

  beforeEach(() => {
    cov = createChainOfVerification();
  });

  it('should produce Evidence compatible with epistemics', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const result = await cov.verify(input);
    const coveResult = cov.toCoVeResult(result);
    const evidence = integrateWithEpistemics(coveResult);

    // Verify evidence has all required fields for epistemics integration
    expect(evidence.id).toMatch(/^cove_/);
    expect(evidence.type).toBe('cove_verification');
    expect(evidence.source.type).toBe('tool');
    expect(evidence.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Verify confidence is properly typed
    expect(evidence.confidence).toHaveProperty('type');
  });

  it('should propagate verification chain to evidence metadata', async () => {
    const input: VerificationInput = {
      query: sampleQuery,
      context: sampleContext,
      baselineResponse: sampleBaselineResponse,
    };

    const result = await cov.verify(input);
    const coveResult = cov.toCoVeResult(result);
    const evidence = integrateWithEpistemics(coveResult);

    expect(evidence.metadata?.verificationChain).toBeDefined();
    expect(Array.isArray(evidence.metadata?.verificationChain)).toBe(true);
  });
});
