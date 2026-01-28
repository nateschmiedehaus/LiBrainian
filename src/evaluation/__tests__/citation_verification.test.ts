/**
 * @fileoverview Tests for Citation Verification Pipeline (WU-PROV-003)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Citation Verification Pipeline integrates MiniCheck-style verification
 * for claim grounding, supporting multiple verification methods:
 * - Exact match: Literal text matching
 * - Entailment: Logical deduction from evidence
 * - Semantic similarity: Term overlap and pattern matching
 *
 * Target: >= 77% grounding accuracy (matching MiniCheck research baseline)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createCitationVerificationPipeline,
  type Citation,
  type VerificationResult,
  type CitationVerificationPipeline,
  type CitationVerificationConfig,
  DEFAULT_CITATION_VERIFICATION_CONFIG,
} from '../citation_verification.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Sample source document content for testing
 */
const sampleDocument = `
/**
 * User service handles authentication and user management.
 */
export class UserService extends BaseService implements IUserService {
  private readonly userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    super();
    this.userRepository = userRepository;
  }

  /**
   * Find a user by their unique identifier.
   * @param id - The user's unique ID
   * @returns The user if found, undefined otherwise
   */
  async findById(id: string): Promise<User | undefined> {
    return this.userRepository.findById(id);
  }

  /**
   * Create a new user account.
   * @param userData - The user data for creating a new account
   * @returns The newly created user
   */
  async createUser(userData: CreateUserDTO): Promise<User> {
    const user = new User(userData);
    await this.userRepository.save(user);
    return user;
  }

  /**
   * Validate user credentials for authentication.
   */
  async validateCredentials(email: string, password: string): Promise<boolean> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) return false;
    return user.validatePassword(password);
  }
}
`;

/**
 * Sample citations for testing - grounded claims
 */
const groundedCitations: Citation[] = [
  {
    id: 'cit-1',
    claim: 'UserService extends BaseService',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 95, end: 145 },
    confidence: 0.9,
  },
  {
    id: 'cit-2',
    claim: 'UserService implements IUserService',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 95, end: 145 },
    confidence: 0.85,
  },
  {
    id: 'cit-3',
    claim: 'findById method returns Promise<User | undefined>',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 350, end: 500 },
    confidence: 0.88,
  },
  {
    id: 'cit-4',
    claim: 'createUser is an async method that creates a new user account',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 550, end: 750 },
    confidence: 0.82,
  },
  {
    id: 'cit-5',
    claim: 'validateCredentials takes email and password parameters',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 800, end: 1000 },
    confidence: 0.9,
  },
];

/**
 * Sample citations for testing - ungrounded claims
 */
const ungroundedCitations: Citation[] = [
  {
    id: 'cit-6',
    claim: 'UserService extends AuthenticationService',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 95, end: 145 },
    confidence: 0.7,
  },
  {
    id: 'cit-7',
    claim: 'deleteUser method removes a user from the database',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 0, end: 100 },
    confidence: 0.6,
  },
  {
    id: 'cit-8',
    claim: 'UserService is a singleton class',
    sourceDocument: 'user_service.ts',
    sourceSpan: { start: 0, end: 200 },
    confidence: 0.5,
  },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createCitationVerificationPipeline', () => {
  it('should create a CitationVerificationPipeline instance', () => {
    const pipeline = createCitationVerificationPipeline();
    expect(pipeline).toBeDefined();
    expect(typeof pipeline.verify).toBe('function');
    expect(typeof pipeline.verifyBatch).toBe('function');
    expect(typeof pipeline.getGroundingStats).toBe('function');
  });

  it('should accept custom configuration', () => {
    const customConfig: Partial<CitationVerificationConfig> = {
      groundingThreshold: 0.8,
      preferredMethod: 'entailment',
    };
    const pipeline = createCitationVerificationPipeline(customConfig);
    expect(pipeline).toBeDefined();
  });

  it('should use default configuration when none provided', () => {
    const pipeline = createCitationVerificationPipeline();
    expect(pipeline).toBeDefined();
  });
});

// ============================================================================
// DEFAULT CONFIGURATION TESTS
// ============================================================================

describe('DEFAULT_CITATION_VERIFICATION_CONFIG', () => {
  it('should have a grounding threshold', () => {
    expect(DEFAULT_CITATION_VERIFICATION_CONFIG.groundingThreshold).toBeDefined();
    expect(typeof DEFAULT_CITATION_VERIFICATION_CONFIG.groundingThreshold).toBe('number');
    expect(DEFAULT_CITATION_VERIFICATION_CONFIG.groundingThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CITATION_VERIFICATION_CONFIG.groundingThreshold).toBeLessThanOrEqual(1);
  });

  it('should have a preferred method', () => {
    expect(DEFAULT_CITATION_VERIFICATION_CONFIG.preferredMethod).toBeDefined();
    expect(['exact_match', 'entailment', 'semantic_similarity']).toContain(
      DEFAULT_CITATION_VERIFICATION_CONFIG.preferredMethod
    );
  });

  it('should have enableFallback option', () => {
    expect(typeof DEFAULT_CITATION_VERIFICATION_CONFIG.enableFallback).toBe('boolean');
  });
});

// ============================================================================
// CITATION INTERFACE TESTS
// ============================================================================

describe('Citation Interface', () => {
  it('should support all required fields', () => {
    const citation: Citation = {
      id: 'test-id',
      claim: 'Some claim about code',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 0, end: 100 },
      confidence: 0.8,
    };

    expect(citation.id).toBe('test-id');
    expect(citation.claim).toBe('Some claim about code');
    expect(citation.sourceDocument).toBe('file.ts');
    expect(citation.sourceSpan.start).toBe(0);
    expect(citation.sourceSpan.end).toBe(100);
    expect(citation.confidence).toBe(0.8);
  });

  it('should have valid source span (start < end)', () => {
    const citation: Citation = {
      id: 'span-test',
      claim: 'Test claim',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 50, end: 150 },
      confidence: 0.7,
    };

    expect(citation.sourceSpan.start).toBeLessThan(citation.sourceSpan.end);
  });

  it('should have confidence between 0 and 1', () => {
    const citation: Citation = {
      id: 'conf-test',
      claim: 'Test claim',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 0, end: 10 },
      confidence: 0.75,
    };

    expect(citation.confidence).toBeGreaterThanOrEqual(0);
    expect(citation.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// VERIFICATION RESULT INTERFACE TESTS
// ============================================================================

describe('VerificationResult Interface', () => {
  let pipeline: CitationVerificationPipeline;

  beforeAll(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should have all required fields', async () => {
    const result = await pipeline.verify(groundedCitations[0], sampleDocument);

    expect(result).toHaveProperty('citation');
    expect(result).toHaveProperty('isGrounded');
    expect(result).toHaveProperty('groundingScore');
    expect(result).toHaveProperty('evidence');
    expect(result).toHaveProperty('method');
  });

  it('should have groundingScore between 0 and 1', async () => {
    const result = await pipeline.verify(groundedCitations[0], sampleDocument);

    expect(result.groundingScore).toBeGreaterThanOrEqual(0);
    expect(result.groundingScore).toBeLessThanOrEqual(1);
  });

  it('should have valid method type', async () => {
    const result = await pipeline.verify(groundedCitations[0], sampleDocument);

    expect(['exact_match', 'entailment', 'semantic_similarity']).toContain(result.method);
  });

  it('should include evidence array', async () => {
    const result = await pipeline.verify(groundedCitations[0], sampleDocument);

    expect(Array.isArray(result.evidence)).toBe(true);
  });

  it('should preserve original citation', async () => {
    const result = await pipeline.verify(groundedCitations[0], sampleDocument);

    expect(result.citation).toEqual(groundedCitations[0]);
  });
});

// ============================================================================
// SINGLE CITATION VERIFICATION TESTS
// ============================================================================

describe('CitationVerificationPipeline - verify', () => {
  let pipeline: CitationVerificationPipeline;

  beforeAll(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should verify a grounded citation as true', async () => {
    const citation = groundedCitations[0]; // UserService extends BaseService
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(true);
    expect(result.groundingScore).toBeGreaterThanOrEqual(0.7);
  });

  it('should verify an ungrounded citation as false', async () => {
    const citation = ungroundedCitations[0]; // UserService extends AuthenticationService
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(false);
    expect(result.groundingScore).toBeLessThan(0.7);
  });

  it('should verify exact match claims', async () => {
    const exactCitation: Citation = {
      id: 'exact-1',
      claim: 'UserService extends BaseService implements IUserService',
      sourceDocument: 'user_service.ts',
      sourceSpan: { start: 95, end: 145 },
      confidence: 0.95,
    };
    const result = await pipeline.verify(exactCitation, sampleDocument);

    expect(result.isGrounded).toBe(true);
    expect(result.groundingScore).toBeGreaterThanOrEqual(0.8);
  });

  it('should verify method return type claims', async () => {
    const citation = groundedCitations[2]; // findById returns Promise<User | undefined>
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(true);
  });

  it('should verify parameter claims', async () => {
    const citation = groundedCitations[4]; // validateCredentials takes email and password
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(true);
  });

  it('should reject claims about non-existent methods', async () => {
    const citation = ungroundedCitations[1]; // deleteUser method
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(false);
  });

  it('should handle empty source document', async () => {
    const citation = groundedCitations[0];
    const result = await pipeline.verify(citation, '');

    expect(result.isGrounded).toBe(false);
    expect(result.groundingScore).toBe(0);
  });

  it('should handle whitespace-only claims', async () => {
    const citation: Citation = {
      id: 'whitespace',
      claim: '   \t\n   ',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 0, end: 10 },
      confidence: 0.5,
    };
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(false);
    expect(result.groundingScore).toBe(0);
  });

  it('should provide evidence for grounded claims', async () => {
    const citation = groundedCitations[0];
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.evidence.length).toBeGreaterThan(0);
    // Evidence should contain relevant text
    expect(result.evidence.some((e) => e.includes('BaseService') || e.includes('extends'))).toBe(true);
  });

  it('should use source span for targeted verification', async () => {
    // Citation with span pointing to class declaration
    const citation: Citation = {
      id: 'span-targeted',
      claim: 'UserService is a class',
      sourceDocument: 'user_service.ts',
      sourceSpan: { start: 60, end: 200 }, // Around class declaration
      confidence: 0.85,
    };
    const result = await pipeline.verify(citation, sampleDocument);

    expect(result.isGrounded).toBe(true);
  });
});

// ============================================================================
// BATCH VERIFICATION TESTS
// ============================================================================

describe('CitationVerificationPipeline - verifyBatch', () => {
  let pipeline: CitationVerificationPipeline;

  beforeAll(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should verify multiple citations at once', async () => {
    const citations = [...groundedCitations.slice(0, 3), ...ungroundedCitations.slice(0, 2)];
    const results = await pipeline.verifyBatch(citations, sampleDocument);

    expect(results.length).toBe(5);
  });

  it('should preserve order of results', async () => {
    const citations = [groundedCitations[0], ungroundedCitations[0], groundedCitations[1]];
    const results = await pipeline.verifyBatch(citations, sampleDocument);

    expect(results[0].citation.id).toBe(groundedCitations[0].id);
    expect(results[1].citation.id).toBe(ungroundedCitations[0].id);
    expect(results[2].citation.id).toBe(groundedCitations[1].id);
  });

  it('should handle empty citations array', async () => {
    const results = await pipeline.verifyBatch([], sampleDocument);

    expect(results).toEqual([]);
  });

  it('should process large batches efficiently', async () => {
    const largeBatch = Array(50).fill(groundedCitations[0]);
    const startTime = Date.now();
    const results = await pipeline.verifyBatch(largeBatch, sampleDocument);
    const duration = Date.now() - startTime;

    expect(results.length).toBe(50);
    expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
  });

  it('should have consistent results between single and batch verification', async () => {
    const citation = groundedCitations[0];

    const singleResult = await pipeline.verify(citation, sampleDocument);
    const batchResults = await pipeline.verifyBatch([citation], sampleDocument);

    expect(batchResults[0].isGrounded).toBe(singleResult.isGrounded);
    expect(batchResults[0].groundingScore).toBeCloseTo(singleResult.groundingScore, 2);
    expect(batchResults[0].method).toBe(singleResult.method);
  });
});

// ============================================================================
// GROUNDING STATS TESTS
// ============================================================================

describe('CitationVerificationPipeline - getGroundingStats', () => {
  let pipeline: CitationVerificationPipeline;

  beforeEach(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should return stats object with all required fields', () => {
    const stats = pipeline.getGroundingStats();

    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('grounded');
    expect(stats).toHaveProperty('accuracy');
  });

  it('should return zeros before any verification', () => {
    const stats = pipeline.getGroundingStats();

    expect(stats.total).toBe(0);
    expect(stats.grounded).toBe(0);
    expect(stats.accuracy).toBe(0);
  });

  it('should update stats after verification', async () => {
    await pipeline.verify(groundedCitations[0], sampleDocument);
    const stats = pipeline.getGroundingStats();

    expect(stats.total).toBe(1);
    expect(stats.grounded).toBeGreaterThanOrEqual(0);
    expect(stats.grounded).toBeLessThanOrEqual(1);
  });

  it('should accumulate stats across multiple verifications', async () => {
    await pipeline.verify(groundedCitations[0], sampleDocument);
    await pipeline.verify(groundedCitations[1], sampleDocument);
    await pipeline.verify(ungroundedCitations[0], sampleDocument);

    const stats = pipeline.getGroundingStats();

    expect(stats.total).toBe(3);
    expect(stats.grounded).toBeGreaterThanOrEqual(0);
    expect(stats.grounded).toBeLessThanOrEqual(3);
  });

  it('should calculate accuracy correctly', async () => {
    await pipeline.verifyBatch(groundedCitations, sampleDocument);
    await pipeline.verifyBatch(ungroundedCitations, sampleDocument);

    const stats = pipeline.getGroundingStats();
    const expectedAccuracy = stats.grounded / stats.total;

    expect(stats.accuracy).toBeCloseTo(expectedAccuracy, 2);
  });

  it('should handle edge case of 0 grounded', async () => {
    await pipeline.verifyBatch(ungroundedCitations, sampleDocument);
    const stats = pipeline.getGroundingStats();

    expect(stats.total).toBe(ungroundedCitations.length);
    expect(stats.accuracy).toBeGreaterThanOrEqual(0);
    expect(stats.accuracy).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// VERIFICATION METHOD TESTS
// ============================================================================

describe('CitationVerificationPipeline - Verification Methods', () => {
  it('should support exact_match method', async () => {
    const pipeline = createCitationVerificationPipeline({
      preferredMethod: 'exact_match',
    });

    const citation: Citation = {
      id: 'exact-test',
      claim: 'export class UserService extends BaseService',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 60, end: 200 },
      confidence: 0.9,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(result.method).toBe('exact_match');
  });

  it('should support entailment method', async () => {
    const pipeline = createCitationVerificationPipeline({
      preferredMethod: 'entailment',
    });

    const citation: Citation = {
      id: 'entail-test',
      claim: 'UserService is a subclass of BaseService',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 60, end: 200 },
      confidence: 0.85,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(result.method).toBe('entailment');
  });

  it('should support semantic_similarity method', async () => {
    const pipeline = createCitationVerificationPipeline({
      preferredMethod: 'semantic_similarity',
    });

    const citation: Citation = {
      id: 'sem-test',
      claim: 'The user service class inherits from base service',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 60, end: 200 },
      confidence: 0.8,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(result.method).toBe('semantic_similarity');
  });

  it('should fall back to alternative method when preferred fails', async () => {
    const pipeline = createCitationVerificationPipeline({
      preferredMethod: 'exact_match',
      enableFallback: true,
    });

    // Claim that won't match exactly but should match semantically
    const citation: Citation = {
      id: 'fallback-test',
      claim: 'UserService inherits from BaseService',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 60, end: 200 },
      confidence: 0.75,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    // Should fall back if exact match fails
    expect(['exact_match', 'entailment', 'semantic_similarity']).toContain(result.method);
  });

  it('should not fall back when disabled', async () => {
    const pipeline = createCitationVerificationPipeline({
      preferredMethod: 'exact_match',
      enableFallback: false,
    });

    // Claim that won't match exactly
    const citation: Citation = {
      id: 'no-fallback-test',
      claim: 'UserService inherits from BaseService class',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 60, end: 200 },
      confidence: 0.75,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(result.method).toBe('exact_match');
  });
});

// ============================================================================
// GROUNDING ACCURACY TESTS (Target: >= 77%)
// ============================================================================

describe('CitationVerificationPipeline - Grounding Accuracy', () => {
  let pipeline: CitationVerificationPipeline;

  beforeAll(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should achieve >= 77% accuracy on grounded claims', async () => {
    const results = await pipeline.verifyBatch(groundedCitations, sampleDocument);
    const groundedCount = results.filter((r) => r.isGrounded).length;
    const accuracy = groundedCount / groundedCitations.length;

    expect(accuracy).toBeGreaterThanOrEqual(0.77);
  });

  it('should correctly identify >= 60% of ungrounded claims', async () => {
    const results = await pipeline.verifyBatch(ungroundedCitations, sampleDocument);
    const ungroundedCount = results.filter((r) => !r.isGrounded).length;
    const accuracy = ungroundedCount / ungroundedCitations.length;

    expect(accuracy).toBeGreaterThanOrEqual(0.6);
  });

  it('should achieve overall accuracy >= 77% on mixed corpus', async () => {
    const allCitations = [...groundedCitations, ...ungroundedCitations];
    const results = await pipeline.verifyBatch(allCitations, sampleDocument);

    // True positives (grounded correctly identified)
    const truePositives = results
      .slice(0, groundedCitations.length)
      .filter((r) => r.isGrounded).length;

    // True negatives (ungrounded correctly identified)
    const trueNegatives = results
      .slice(groundedCitations.length)
      .filter((r) => !r.isGrounded).length;

    const totalCorrect = truePositives + trueNegatives;
    const accuracy = totalCorrect / allCitations.length;

    expect(accuracy).toBeGreaterThanOrEqual(0.77);
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('CitationVerificationPipeline - Edge Cases', () => {
  let pipeline: CitationVerificationPipeline;

  beforeAll(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should handle very long claims', async () => {
    const longClaim = 'The UserService class ' + 'which extends BaseService '.repeat(50) + 'is important.';
    const citation: Citation = {
      id: 'long-claim',
      claim: longClaim,
      sourceDocument: 'file.ts',
      sourceSpan: { start: 0, end: 100 },
      confidence: 0.5,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(typeof result.isGrounded).toBe('boolean');
    expect(typeof result.groundingScore).toBe('number');
  });

  it('should handle special characters in claims', async () => {
    const citation: Citation = {
      id: 'special-chars',
      claim: 'Promise<User | undefined> is the return type',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 0, end: 500 },
      confidence: 0.75,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(typeof result.isGrounded).toBe('boolean');
  });

  it('should handle unicode in claims', async () => {
    const citation: Citation = {
      id: 'unicode',
      claim: 'handles unicode strings',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 0, end: 100 },
      confidence: 0.6,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(typeof result.isGrounded).toBe('boolean');
  });

  it('should handle source span beyond document length', async () => {
    const citation: Citation = {
      id: 'bad-span',
      claim: 'UserService exists',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 10000, end: 20000 },
      confidence: 0.8,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    // Should still work by using full document or handle gracefully
    expect(typeof result.isGrounded).toBe('boolean');
    expect(typeof result.groundingScore).toBe('number');
  });

  it('should handle inverted source span (start > end)', async () => {
    const citation: Citation = {
      id: 'inverted-span',
      claim: 'UserService exists',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 200, end: 100 },
      confidence: 0.7,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    // Should handle gracefully
    expect(typeof result.isGrounded).toBe('boolean');
  });

  it('should handle document with only whitespace', async () => {
    const citation = groundedCitations[0];
    const result = await pipeline.verify(citation, '   \t\n   ');

    expect(result.isGrounded).toBe(false);
    expect(result.groundingScore).toBe(0);
  });

  it('should handle claims with code snippets', async () => {
    const citation: Citation = {
      id: 'code-snippet',
      claim: 'The method signature is `async findById(id: string): Promise<User | undefined>`',
      sourceDocument: 'file.ts',
      sourceSpan: { start: 300, end: 500 },
      confidence: 0.85,
    };

    const result = await pipeline.verify(citation, sampleDocument);
    expect(typeof result.isGrounded).toBe('boolean');
  });
});

// ============================================================================
// CONFIGURATION OPTION TESTS
// ============================================================================

describe('CitationVerificationPipeline - Configuration Options', () => {
  it('should respect custom grounding threshold', async () => {
    const strictPipeline = createCitationVerificationPipeline({
      groundingThreshold: 0.9,
    });
    const lenientPipeline = createCitationVerificationPipeline({
      groundingThreshold: 0.3,
    });

    const citation = groundedCitations[0];

    const strictResult = await strictPipeline.verify(citation, sampleDocument);
    const lenientResult = await lenientPipeline.verify(citation, sampleDocument);

    // Same score but potentially different grounding decision
    expect(strictResult.groundingScore).toBeCloseTo(lenientResult.groundingScore, 1);

    // Lenient should be more likely to mark as grounded
    if (strictResult.groundingScore >= 0.3 && strictResult.groundingScore < 0.9) {
      expect(lenientResult.isGrounded).toBe(true);
    }
  });

  it('should allow changing preferred method', async () => {
    const methods: Array<'exact_match' | 'entailment' | 'semantic_similarity'> = [
      'exact_match',
      'entailment',
      'semantic_similarity',
    ];

    for (const method of methods) {
      const pipeline = createCitationVerificationPipeline({
        preferredMethod: method,
      });

      const result = await pipeline.verify(groundedCitations[0], sampleDocument);
      expect(result.method).toBe(method);
    }
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('CitationVerificationPipeline - Integration', () => {
  let pipeline: CitationVerificationPipeline;

  beforeAll(() => {
    pipeline = createCitationVerificationPipeline();
  });

  it('should work with real-world TypeScript class definitions', async () => {
    const realWorldDoc = `
      export class DataProcessor {
        private cache: Map<string, any>;

        constructor() {
          this.cache = new Map();
        }

        async processData(input: string[]): Promise<ProcessedResult> {
          // Implementation
          return { success: true, data: input };
        }

        clearCache(): void {
          this.cache.clear();
        }
      }
    `;

    const citation: Citation = {
      id: 'real-world',
      claim: 'DataProcessor has a processData method that returns Promise<ProcessedResult>',
      sourceDocument: 'processor.ts',
      sourceSpan: { start: 0, end: 500 },
      confidence: 0.85,
    };

    const result = await pipeline.verify(citation, realWorldDoc);
    expect(result.isGrounded).toBe(true);
  });

  it('should work with interface definitions', async () => {
    const interfaceDoc = `
      export interface UserRepository {
        findById(id: string): Promise<User | undefined>;
        findByEmail(email: string): Promise<User | undefined>;
        save(user: User): Promise<void>;
        delete(id: string): Promise<boolean>;
      }
    `;

    const citation: Citation = {
      id: 'interface-test',
      claim: 'UserRepository interface has a findById method',
      sourceDocument: 'repository.ts',
      sourceSpan: { start: 0, end: 300 },
      confidence: 0.9,
    };

    const result = await pipeline.verify(citation, interfaceDoc);
    expect(result.isGrounded).toBe(true);
  });

  it('should work with function definitions', async () => {
    const functionDoc = `
      export function createUserService(
        repository: UserRepository,
        logger: Logger
      ): UserService {
        return new UserService(repository, logger);
      }
    `;

    const citation: Citation = {
      id: 'function-test',
      claim: 'createUserService function takes repository and logger parameters',
      sourceDocument: 'factory.ts',
      sourceSpan: { start: 0, end: 200 },
      confidence: 0.88,
    };

    const result = await pipeline.verify(citation, functionDoc);
    expect(result.isGrounded).toBe(true);
  });
});
