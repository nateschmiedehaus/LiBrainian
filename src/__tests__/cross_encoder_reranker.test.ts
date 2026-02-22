/**
 * @fileoverview Test cross-encoder re-ranking
 *
 * Validates that cross-encoder re-ranking:
 * 1. Correctly scores query-document pairs
 * 2. Re-orders documents by relevance
 * 3. Improves over bi-encoder ordering
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  rerank,
  rerankBatch,
  hybridRerank,
  preloadReranker,
  getAvailableModels,
  type RerankerResult,
} from '../api/embedding_providers/cross_encoder_reranker.js';

// ============================================================================
// TEST DATA
// ============================================================================

const QUERY = 'How to implement user authentication in TypeScript?';

const DOCUMENTS = [
  // Highly relevant
  `
  export async function authenticateUser(email: string, password: string): Promise<User> {
    const user = await UserRepository.findByEmail(email);
    if (!user) throw new AuthError('User not found');
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw new AuthError('Invalid password');
    return user;
  }
  `,

  // Somewhat relevant
  `
  export interface AuthConfig {
    jwtSecret: string;
    tokenExpiry: number;
    refreshTokenExpiry: number;
    passwordMinLength: number;
  }
  `,

  // Tangentially relevant
  `
  export class UserService {
    async getUser(id: string): Promise<User | null> {
      return this.db.users.findById(id);
    }

    async updateUser(id: string, data: Partial<User>): Promise<User> {
      return this.db.users.update(id, data);
    }
  }
  `,

  // Not relevant
  `
  export function calculateTax(amount: number, rate: number): number {
    return amount * rate;
  }

  export function formatCurrency(value: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  }
  `,

  // Not relevant at all
  `
  const COLORS = {
    primary: '#007bff',
    secondary: '#6c757d',
    success: '#28a745',
    danger: '#dc3545',
  };

  export function getColor(name: keyof typeof COLORS): string {
    return COLORS[name];
  }
  `,

  // Another relevant one
  `
  export async function verifyJwtToken(token: string): Promise<JwtPayload> {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      return decoded as JwtPayload;
    } catch (error) {
      throw new AuthError('Invalid token');
    }
  }

  export async function generateJwtToken(user: User): Promise<string> {
    return jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!, {
      expiresIn: '1h',
    });
  }
  `,

  // Another somewhat relevant
  `
  export async function hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  export async function validatePassword(password: string): Promise<boolean> {
    const minLength = 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return password.length >= minLength && hasUppercase && hasLowercase && hasNumber;
  }
  `,
];

// ============================================================================
// TESTS
// ============================================================================

describe('Cross-Encoder Re-ranking', () => {
  beforeAll(async () => {
    console.log('\n' + '='.repeat(70));
    console.log('CROSS-ENCODER RE-RANKING TEST');
    console.log('='.repeat(70) + '\n');

    console.log('Available models:');
    for (const model of getAvailableModels()) {
      console.log(`  - ${model.id}: ${model.description}`);
    }
    console.log();

    console.log('Preloading cross-encoder...');
    await preloadReranker();
    console.log('Done\n');
  }, 120000);

  describe('rerank', () => {
    it('should score and re-rank documents', async () => {
      console.log('Query:', QUERY);
      console.log('\nRe-ranking documents...\n');

      const results = await rerank(QUERY, DOCUMENTS, {
        topK: DOCUMENTS.length,
        returnTopN: DOCUMENTS.length,
      });

      console.log('Results:');
      console.log('-'.repeat(70));

      for (const result of results) {
        const preview = result.document.trim().slice(0, 60).replace(/\n/g, ' ');
        console.log(
          `  Rank ${result.newRank} (was ${result.originalRank}): ` +
          `score=${result.score.toFixed(4)} | ${preview}...`
        );
      }

      expect(results.length).toBe(DOCUMENTS.length);

      // First result should be the authentication function
      expect(results[0].document).toContain('authenticateUser');
    }, 60000);

    it('should respect topK and returnTopN', async () => {
      const results = await rerank(QUERY, DOCUMENTS, {
        topK: 5,
        returnTopN: 3,
      });

      expect(results.length).toBeLessThanOrEqual(3);
    }, 60000);

    it('should filter by minScore', async () => {
      const results = await rerank(QUERY, DOCUMENTS, {
        topK: DOCUMENTS.length,
        returnTopN: DOCUMENTS.length,
        minScore: 0.5,
      });

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      }
    }, 60000);
  });

  describe('model registry', () => {
    it('includes the mixedbread mxbai reranker and retains historical ms-marco options', () => {
      const models = getAvailableModels().map((item) => item.id);
      expect(models).toContain('cross-encoder/mixedbread-ai/mxbai-rerank-xsmall-v1');
      expect(models).toContain('cross-encoder/ms-marco-MiniLM-L-6-v2');
      expect(models).toContain('cross-encoder/ms-marco-MiniLM-L-12-v2');
    });
  });

  describe('rerankBatch', () => {
    it('should re-rank with batching', async () => {
      console.log('\nBatch re-ranking...');

      const results = await rerankBatch(QUERY, DOCUMENTS, {
        topK: DOCUMENTS.length,
        returnTopN: DOCUMENTS.length,
        batchSize: 4,
      });

      console.log(`Processed ${results.length} documents in batches\n`);

      expect(results.length).toBe(DOCUMENTS.length);
    }, 60000);
  });

  describe('hybridRerank', () => {
    it('should combine bi-encoder and cross-encoder scores', async () => {
      console.log('\nHybrid re-ranking...');

      // Simulate bi-encoder scores (in wrong order)
      const inputs = DOCUMENTS.map((doc, i) => ({
        document: doc,
        biEncoderScore: (DOCUMENTS.length - i) / DOCUMENTS.length, // Reverse order
        metadata: { originalIndex: i },
      }));

      const results = await hybridRerank(QUERY, inputs, {
        topK: DOCUMENTS.length,
        returnTopN: DOCUMENTS.length,
        biEncoderWeight: 0.3,
        crossEncoderWeight: 0.7,
      });

      console.log('\nHybrid results:');
      console.log('-'.repeat(70));

      for (const result of results) {
        console.log(
          `  Rank ${result.newRank}: ` +
          `biEncoder=${result.biEncoderScore.toFixed(4)}, ` +
          `crossEncoder=${result.score.toFixed(4)}, ` +
          `hybrid=${result.hybridScore.toFixed(4)}`
        );
      }

      expect(results.length).toBe(DOCUMENTS.length);

      // Hybrid score should be weighted combination
      for (const result of results) {
        const expected = 0.3 * result.biEncoderScore + 0.7 * result.score;
        expect(Math.abs(result.hybridScore - expected)).toBeLessThan(0.001);
      }
    }, 60000);
  });

  describe('Comparison: Bi-encoder vs Cross-encoder ordering', () => {
    it('should improve ordering over random/wrong bi-encoder ranks', async () => {
      console.log('\n' + '-'.repeat(70));
      console.log('BI-ENCODER VS CROSS-ENCODER COMPARISON');
      console.log('-'.repeat(70));

      // Intentionally wrong bi-encoder ordering (irrelevant docs first)
      const wrongOrder = [
        DOCUMENTS[4], // colors (not relevant)
        DOCUMENTS[3], // tax (not relevant)
        DOCUMENTS[2], // user service (tangential)
        DOCUMENTS[1], // auth config (somewhat)
        DOCUMENTS[6], // password (relevant)
        DOCUMENTS[5], // jwt (relevant)
        DOCUMENTS[0], // authenticate (most relevant)
      ];

      const results = await rerank(QUERY, wrongOrder, {
        topK: wrongOrder.length,
        returnTopN: wrongOrder.length,
      });

      console.log('\nStarting order (simulated bad bi-encoder):');
      for (let i = 0; i < wrongOrder.length; i++) {
        const preview = wrongOrder[i].trim().slice(0, 50).replace(/\n/g, ' ');
        console.log(`  ${i + 1}. ${preview}...`);
      }

      console.log('\nCross-encoder re-ordered:');
      for (const result of results) {
        const preview = result.document.trim().slice(0, 50).replace(/\n/g, ' ');
        console.log(
          `  ${result.newRank}. (was ${result.originalRank}) ${preview}... ` +
          `[score: ${result.score.toFixed(4)}]`
        );
      }

      // The authentication function should be ranked higher after re-ranking
      const authResult = results.find((r) => r.document.includes('authenticateUser'));
      expect(authResult).toBeDefined();
      expect(authResult!.newRank).toBeLessThan(authResult!.originalRank);

      // Colors should be ranked lower
      const colorsResult = results.find((r) => r.document.includes('COLORS'));
      expect(colorsResult).toBeDefined();
      expect(colorsResult!.newRank).toBeGreaterThan(colorsResult!.originalRank);
    }, 60000);
  });

  describe('Code-specific queries', () => {
    it('should handle TypeScript-specific queries', async () => {
      const codeQuery = 'async function that returns Promise<User>';

      const results = await rerank(codeQuery, DOCUMENTS, {
        returnTopN: 3,
      });

      console.log(`\nQuery: "${codeQuery}"`);
      console.log('Top 3 results:');
      for (const result of results) {
        const preview = result.document.trim().slice(0, 60).replace(/\n/g, ' ');
        console.log(`  ${result.newRank}. ${preview}... [${result.score.toFixed(4)}]`);
      }

      // Should find async functions that return Promises
      // (Cross-encoder matches semantic pattern, not exact types)
      expect(results[0].document).toContain('async function');
      expect(results[0].document).toContain('Promise<');
    }, 60000);

    it('should handle technical concept queries', async () => {
      const conceptQuery = 'JWT token verification and generation';

      const results = await rerank(conceptQuery, DOCUMENTS, {
        returnTopN: 3,
      });

      console.log(`\nQuery: "${conceptQuery}"`);
      console.log('Top 3 results:');
      for (const result of results) {
        const preview = result.document.trim().slice(0, 60).replace(/\n/g, ' ');
        console.log(`  ${result.newRank}. ${preview}... [${result.score.toFixed(4)}]`);
      }

      // Should find the JWT functions
      expect(results[0].document.toLowerCase()).toContain('jwt');
    }, 60000);
  });
});
