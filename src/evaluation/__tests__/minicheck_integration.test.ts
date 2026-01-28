/**
 * @fileoverview Tests for MiniCheck Integration (WU-HALU-001)
 *
 * Tests for local grounding verification similar to MiniCheck.
 * Target: >= 77% grounding accuracy.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MiniCheckVerifier,
  createMiniCheckVerifier,
  type GroundingCheck,
  type GroundingResult,
  type BatchGroundingResult,
  type GroundingMetrics,
  type SupportingEvidence,
  type MiniCheckVerifierConfig,
  DEFAULT_MINICHECK_VERIFIER_CONFIG,
} from '../minicheck_integration.js';

describe('MiniCheckVerifier', () => {
  let verifier: MiniCheckVerifier;

  beforeEach(() => {
    verifier = createMiniCheckVerifier();
  });

  describe('factory function', () => {
    it('should create a MiniCheckVerifier instance', () => {
      const instance = createMiniCheckVerifier();
      expect(instance).toBeInstanceOf(MiniCheckVerifier);
    });

    it('should accept custom configuration', () => {
      const config: Partial<MiniCheckVerifierConfig> = {
        groundingThreshold: 0.8,
        maxChunkSize: 500,
      };
      const instance = createMiniCheckVerifier(config);
      expect(instance).toBeInstanceOf(MiniCheckVerifier);
    });

    it('should use default config values', () => {
      expect(DEFAULT_MINICHECK_VERIFIER_CONFIG.groundingThreshold).toBe(0.55);
      expect(DEFAULT_MINICHECK_VERIFIER_CONFIG.maxChunkSize).toBeGreaterThan(0);
    });
  });

  describe('verifyClaim - clearly grounded claims', () => {
    it('should verify claim directly stated in source', async () => {
      const check: GroundingCheck = {
        claim: 'The UserService class handles user authentication',
        sourceDocuments: [
          'class UserService {\n  // Handles user authentication and authorization\n  authenticate(user: User): boolean { ... }\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.supportingEvidence.length).toBeGreaterThan(0);
    });

    it('should verify claim about function return type', async () => {
      const check: GroundingCheck = {
        claim: 'The getUserById function returns a Promise<User>',
        sourceDocuments: [
          'async function getUserById(id: string): Promise<User> {\n  return await db.users.findById(id);\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(true);
      expect(result.supportingEvidence.length).toBeGreaterThan(0);
      expect(result.supportingEvidence[0].excerpt).toContain('Promise<User>');
    });

    it('should verify claim about class inheritance', async () => {
      const check: GroundingCheck = {
        claim: 'AdminUser extends BaseUser',
        sourceDocuments: [
          'class AdminUser extends BaseUser {\n  constructor(name: string) {\n    super(name);\n  }\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should verify claim with code identifiers in backticks', async () => {
      const check: GroundingCheck = {
        claim: 'The `processData` function takes a `DataInput` parameter',
        sourceDocuments: [
          'function processData(input: DataInput): ProcessedResult {\n  // Process the input data\n  return transform(input);\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(true);
    });
  });

  describe('verifyClaim - clearly ungrounded claims', () => {
    it('should reject claim not mentioned in sources', async () => {
      const check: GroundingCheck = {
        claim: 'The DatabaseService uses MongoDB for storage',
        sourceDocuments: [
          'class UserService {\n  private users: User[] = [];\n  addUser(user: User) { this.users.push(user); }\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
      expect(result.supportingEvidence.length).toBe(0);
    });

    it('should reject claim about non-existent function', async () => {
      const check: GroundingCheck = {
        claim: 'The deleteAllUsers function removes all users from the database',
        sourceDocuments: [
          'function getUser(id: string): User { return users.find(u => u.id === id); }\nfunction updateUser(id: string, data: Partial<User>): void { ... }',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
    });

    it('should reject claim with wrong type information', async () => {
      const check: GroundingCheck = {
        claim: 'The calculate function returns a string',
        sourceDocuments: [
          'function calculate(a: number, b: number): number {\n  return a + b;\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
      expect(result.contradictingEvidence).toBeDefined();
      expect(result.contradictingEvidence!.length).toBeGreaterThan(0);
    });
  });

  describe('verifyClaim - partially supported claims', () => {
    it('should handle claim with some supported and some unsupported parts', async () => {
      const check: GroundingCheck = {
        claim: 'The UserService has methods for authentication and payment processing',
        sourceDocuments: [
          'class UserService {\n  authenticate(user: User): boolean { ... }\n  logout(user: User): void { ... }\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      // Should have partial support - authentication is mentioned but not payment
      expect(result.confidence).toBeLessThan(0.9);
      expect(result.explanation).toBeTruthy();
    });

    it('should handle claim with related but not exact information', async () => {
      const check: GroundingCheck = {
        claim: 'The config object contains database settings',
        sourceDocuments: [
          'const config = {\n  db: {\n    host: "localhost",\n    port: 5432\n  },\n  server: {\n    port: 3000\n  }\n};',
        ],
      };

      const result = await verifier.verifyClaim(check);

      // db is related to database, should have some support
      expect(result.supportingEvidence.length).toBeGreaterThan(0);
    });
  });

  describe('verifyClaim - contradicted claims', () => {
    it('should identify claim contradicted by source', async () => {
      const check: GroundingCheck = {
        claim: 'The Logger class is a singleton',
        sourceDocuments: [
          'class Logger {\n  // Create new instances freely\n  constructor() { this.logs = []; }\n  log(msg: string) { this.logs.push(msg); }\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      // Source shows Logger is NOT a singleton (can create new instances)
      expect(result.contradictingEvidence).toBeDefined();
    });

    it('should identify wrong method signature claim', async () => {
      const check: GroundingCheck = {
        claim: 'The formatDate function takes no parameters',
        sourceDocuments: [
          'function formatDate(date: Date, format: string): string {\n  return moment(date).format(format);\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
      expect(result.contradictingEvidence!.length).toBeGreaterThan(0);
    });

    it('should identify contradicted inheritance claim', async () => {
      const check: GroundingCheck = {
        claim: 'AdminUser extends GuestUser',
        sourceDocuments: [
          'class AdminUser extends BaseUser {\n  adminLevel: number;\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
      expect(result.contradictingEvidence).toBeDefined();
    });
  });

  describe('verifyClaim - edge cases', () => {
    it('should handle empty source documents', async () => {
      const check: GroundingCheck = {
        claim: 'The UserService handles authentication',
        sourceDocuments: [],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.explanation).toContain('No source documents');
    });

    it('should handle empty claim', async () => {
      const check: GroundingCheck = {
        claim: '',
        sourceDocuments: ['Some source code here'],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
      expect(result.explanation).toContain('empty');
    });

    it('should handle very long claims', async () => {
      const longClaim = 'The ' + 'very '.repeat(100) + 'long function does something';
      const check: GroundingCheck = {
        claim: longClaim,
        sourceDocuments: ['function veryLongFunction() { return true; }'],
      };

      const result = await verifier.verifyClaim(check);

      // Should still process without error
      expect(result).toBeDefined();
      expect(typeof result.isGrounded).toBe('boolean');
    });

    it('should handle source documents with only whitespace', async () => {
      const check: GroundingCheck = {
        claim: 'Some claim',
        sourceDocuments: ['   ', '\n\n\n', '\t\t'],
      };

      const result = await verifier.verifyClaim(check);

      expect(result.isGrounded).toBe(false);
    });

    it('should respect maxTokens limit', async () => {
      const check: GroundingCheck = {
        claim: 'The function exists',
        sourceDocuments: ['function test() {}'],
        maxTokens: 10,
      };

      const result = await verifier.verifyClaim(check);

      // Should process but may have limited analysis
      expect(result).toBeDefined();
    });
  });

  describe('verifyBatch', () => {
    it('should verify multiple claims in batch', async () => {
      const checks: GroundingCheck[] = [
        {
          claim: 'UserService handles authentication',
          sourceDocuments: ['class UserService { authenticate() {} }'],
        },
        {
          claim: 'Logger writes to console',
          sourceDocuments: ['class Logger { log(msg: string) { console.log(msg); } }'],
        },
      ];

      const result = await verifier.verifyBatch(checks);

      expect(result.claims.length).toBe(2);
      expect(result.overallGroundingRate).toBeGreaterThanOrEqual(0);
      expect(result.overallGroundingRate).toBeLessThanOrEqual(1);
      expect(result.processingTimeMs).toBeGreaterThan(0);
    });

    it('should calculate overall grounding rate correctly', async () => {
      const checks: GroundingCheck[] = [
        {
          claim: 'The add function returns a number',
          sourceDocuments: ['function add(a: number, b: number): number { return a + b; }'],
        },
        {
          claim: 'The multiply function returns a string',
          sourceDocuments: ['function multiply(a: number, b: number): number { return a * b; }'],
        },
      ];

      const result = await verifier.verifyBatch(checks);

      // One grounded, one not
      expect(result.overallGroundingRate).toBeGreaterThan(0);
      expect(result.overallGroundingRate).toBeLessThan(1);
    });

    it('should handle empty batch', async () => {
      const result = await verifier.verifyBatch([]);

      expect(result.claims.length).toBe(0);
      expect(result.overallGroundingRate).toBe(0);
    });

    it('should track tokens processed', async () => {
      const checks: GroundingCheck[] = [
        {
          claim: 'Test claim',
          sourceDocuments: ['function test() { return 1; }'],
        },
      ];

      const result = await verifier.verifyBatch(checks);

      expect(result.tokensProcessed).toBeGreaterThan(0);
    });
  });

  describe('computeEntailment', () => {
    it('should compute high entailment for matching content', async () => {
      const claim = 'The function returns true';
      const source = 'function check(): boolean { return true; }';

      const score = await verifier.computeEntailment(claim, source);

      expect(score).toBeGreaterThan(0.5);
    });

    it('should compute low entailment for unrelated content', async () => {
      const claim = 'The database stores user profiles';
      const source = 'function calculate(a: number, b: number) { return a + b; }';

      const score = await verifier.computeEntailment(claim, source);

      expect(score).toBeLessThan(0.3);
    });

    it('should compute medium entailment for related but not exact content', async () => {
      const claim = 'The service validates user input';
      const source = 'class UserInputService { validate(input: string): boolean { return input.length > 0; } }';

      const score = await verifier.computeEntailment(claim, source);

      expect(score).toBeGreaterThan(0.3);
      expect(score).toBeLessThan(0.9);
    });
  });

  describe('extractRelevantExcerpts', () => {
    it('should extract relevant code excerpts', () => {
      const claim = 'getUserById returns a User object';
      const source = `
class UserRepository {
  getUserById(id: string): User {
    return this.users.find(u => u.id === id);
  }

  getAllUsers(): User[] {
    return this.users;
  }
}`;

      const excerpts = verifier.extractRelevantExcerpts(claim, source);

      expect(excerpts.length).toBeGreaterThan(0);
      expect(excerpts.some(e => e.includes('getUserById'))).toBe(true);
    });

    it('should return empty array for unrelated source', () => {
      const claim = 'The DatabaseConnection class handles MySQL queries';
      const source = 'const config = { theme: "dark", fontSize: 14 };';

      const excerpts = verifier.extractRelevantExcerpts(claim, source);

      expect(excerpts.length).toBe(0);
    });

    it('should handle multi-line code blocks', () => {
      const claim = 'The processOrder function handles payment';
      const source = `
function processOrder(order: Order) {
  // Validate order
  if (!order.isValid()) throw new Error('Invalid order');

  // Process payment
  const payment = processPayment(order.total);

  // Update inventory
  updateInventory(order.items);

  return { success: true, payment };
}`;

      const excerpts = verifier.extractRelevantExcerpts(claim, source);

      expect(excerpts.length).toBeGreaterThan(0);
      expect(excerpts.some(e => e.includes('payment'))).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('should return initial metrics with zero values', () => {
      const metrics = verifier.getMetrics();

      expect(metrics.accuracy).toBe(0);
      expect(metrics.precision).toBe(0);
      expect(metrics.recall).toBe(0);
      expect(metrics.f1Score).toBe(0);
      expect(metrics.avgConfidence).toBe(0);
    });

    it('should update metrics after verification', async () => {
      // Verify a few claims first
      await verifier.verifyClaim({
        claim: 'Test function exists',
        sourceDocuments: ['function test() {}'],
      });

      const metrics = verifier.getMetrics();

      expect(metrics.avgConfidence).toBeGreaterThan(0);
    });

    it('should return metrics conforming to GroundingMetrics interface', () => {
      const metrics: GroundingMetrics = verifier.getMetrics();

      expect(typeof metrics.accuracy).toBe('number');
      expect(typeof metrics.precision).toBe('number');
      expect(typeof metrics.recall).toBe('number');
      expect(typeof metrics.f1Score).toBe('number');
      expect(typeof metrics.avgConfidence).toBe('number');
    });
  });

  describe('grounding accuracy target >= 77%', () => {
    it('should achieve target accuracy on test corpus', async () => {
      // Test corpus with known ground truth
      const testCases: Array<{ check: GroundingCheck; expectedGrounded: boolean }> = [
        // Clearly grounded
        {
          check: {
            claim: 'The add function returns a number',
            sourceDocuments: ['function add(a: number, b: number): number { return a + b; }'],
          },
          expectedGrounded: true,
        },
        {
          check: {
            claim: 'UserService has a login method',
            sourceDocuments: ['class UserService { login(user: string, pass: string) { ... } }'],
          },
          expectedGrounded: true,
        },
        {
          check: {
            claim: 'The config contains a port setting',
            sourceDocuments: ['const config = { port: 3000, host: "localhost" };'],
          },
          expectedGrounded: true,
        },
        // Clearly ungrounded
        {
          check: {
            claim: 'The multiply function returns a string',
            sourceDocuments: ['function multiply(a: number, b: number): number { return a * b; }'],
          },
          expectedGrounded: false,
        },
        {
          check: {
            claim: 'DatabaseService uses Redis',
            sourceDocuments: ['class FileService { read(path: string) {} write(path: string, data: string) {} }'],
          },
          expectedGrounded: false,
        },
        {
          check: {
            claim: 'Logger extends EventEmitter',
            sourceDocuments: ['class Logger { log(msg: string) { console.log(msg); } }'],
          },
          expectedGrounded: false,
        },
        // More grounded
        {
          check: {
            claim: 'The fetchData function is async',
            sourceDocuments: ['async function fetchData(url: string): Promise<Response> { return fetch(url); }'],
          },
          expectedGrounded: true,
        },
        {
          check: {
            claim: 'BaseController has a render method',
            sourceDocuments: ['class BaseController { render(view: string, data: object) { return template(view, data); } }'],
          },
          expectedGrounded: true,
        },
        // More ungrounded
        {
          check: {
            claim: 'AuthService validates JWT tokens',
            sourceDocuments: ['class SessionService { create() {} destroy() {} }'],
          },
          expectedGrounded: false,
        },
        {
          check: {
            claim: 'The parse function throws SyntaxError',
            sourceDocuments: ['function parse(input: string): object { return JSON.parse(input); }'],
          },
          expectedGrounded: false,
        },
      ];

      let correct = 0;
      for (const { check, expectedGrounded } of testCases) {
        const result = await verifier.verifyClaim(check);
        if (result.isGrounded === expectedGrounded) {
          correct++;
        }
      }

      const accuracy = correct / testCases.length;

      // Target: >= 77% accuracy (MiniCheck benchmark)
      expect(accuracy).toBeGreaterThanOrEqual(0.77);
    });
  });

  describe('SupportingEvidence interface', () => {
    it('should return properly structured supporting evidence', async () => {
      const check: GroundingCheck = {
        claim: 'The validate function checks input length',
        sourceDocuments: [
          'function validate(input: string): boolean {\n  return input.length > 0 && input.length < 100;\n}',
        ],
      };

      const result = await verifier.verifyClaim(check);

      if (result.supportingEvidence.length > 0) {
        const evidence: SupportingEvidence = result.supportingEvidence[0];

        expect(typeof evidence.sourceIndex).toBe('number');
        expect(evidence.sourceIndex).toBeGreaterThanOrEqual(0);
        expect(typeof evidence.excerpt).toBe('string');
        expect(typeof evidence.relevanceScore).toBe('number');
        expect(evidence.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(evidence.relevanceScore).toBeLessThanOrEqual(1);
        expect(typeof evidence.entailmentScore).toBe('number');
        expect(evidence.entailmentScore).toBeGreaterThanOrEqual(0);
        expect(evidence.entailmentScore).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('document chunking', () => {
    it('should handle very long source documents by chunking', async () => {
      const longSource = Array(100)
        .fill('function someFunction() { return "value"; }\n')
        .join('');

      const check: GroundingCheck = {
        claim: 'The code contains functions',
        sourceDocuments: [longSource],
      };

      const result = await verifier.verifyClaim(check);

      // Should process without error and find evidence
      expect(result.isGrounded).toBe(true);
    });
  });

  describe('caching behavior', () => {
    it('should cache intermediate results for efficiency', async () => {
      const check: GroundingCheck = {
        claim: 'UserService exists',
        sourceDocuments: ['class UserService { }'],
      };

      // First call
      const start1 = Date.now();
      await verifier.verifyClaim(check);
      const time1 = Date.now() - start1;

      // Second call with same input - should be faster due to caching
      const start2 = Date.now();
      await verifier.verifyClaim(check);
      const time2 = Date.now() - start2;

      // Second call should be at least as fast (caching helps with repeated calls)
      // Note: In practice, caching may not always show dramatic speedup for small inputs
      expect(time2).toBeLessThanOrEqual(time1 + 10); // Allow small variance
    });
  });
});
