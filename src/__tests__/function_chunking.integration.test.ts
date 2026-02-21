/**
 * @fileoverview Test function-level chunking for embeddings
 *
 * Validates that function-level chunking:
 * 1. Correctly parses TypeScript files into chunks
 * 2. Generates embeddings for each chunk
 * 3. Computes meaningful similarity at chunk level
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { checkAllProviders } from '../api/provider_check.js';
import {
  parseFileIntoChunks,
  buildChunkEmbeddingInput,
  embedFileChunks,
  computeChunkSimilarity,
  type CodeChunk,
  type FileChunks,
} from '../api/embedding_providers/function_chunking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const librainianRoot = path.resolve(__dirname, '..');

// ============================================================================
// TEST DATA
// ============================================================================

const SAMPLE_CODE = `
/**
 * Sample module for testing chunking.
 */

import { something } from './other.js';

export interface UserConfig {
  name: string;
  age: number;
  active: boolean;
}

export type UserId = string | number;

export class UserService {
  private users: Map<string, UserConfig> = new Map();

  async getUser(id: UserId): Promise<UserConfig | null> {
    return this.users.get(String(id)) || null;
  }

  async createUser(config: UserConfig): Promise<UserId> {
    const id = crypto.randomUUID();
    this.users.set(id, config);
    return id;
  }

  deleteUser(id: UserId): boolean {
    return this.users.delete(String(id));
  }
}

export function validateConfig(config: UserConfig): boolean {
  return config.name.length > 0 && config.age >= 0;
}

export const processUsers = async (users: UserConfig[]): Promise<void> => {
  for (const user of users) {
    console.log(user.name);
  }
};

const internalHelper = (x: number): number => x * 2;
`;

// ============================================================================
// TESTS
// ============================================================================

describe('Function Chunking', () => {
  let skipReason: string | null = null;

  beforeAll(async () => {
    const status = await checkAllProviders({ workspaceRoot: process.cwd() });
    if (!status.embedding.available) {
      skipReason = `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`;
    }
  });

  describe('parseFileIntoChunks', () => {
    it('should extract all code elements', () => {
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);

      console.log('\n' + '='.repeat(70));
      console.log('PARSED CHUNKS');
      console.log('='.repeat(70));

      for (const chunk of chunks) {
        console.log(`\n[${chunk.type.toUpperCase()}] ${chunk.name}`);
        console.log(`  Signature: ${chunk.signature}`);
        console.log(`  Lines: ${chunk.startLine}-${chunk.endLine}`);
        console.log(`  Exported: ${chunk.exports}, Async: ${chunk.async}`);
        if (chunk.parentClass) {
          console.log(`  Parent: ${chunk.parentClass}`);
        }
      }

      // Should find interface
      const interfaces = chunks.filter((c) => c.type === 'interface');
      expect(interfaces.length).toBe(1);
      expect(interfaces[0].name).toBe('UserConfig');

      // Should find type alias
      const types = chunks.filter((c) => c.type === 'type');
      expect(types.length).toBe(1);
      expect(types[0].name).toBe('UserId');

      // Should find class
      const classes = chunks.filter((c) => c.type === 'class');
      expect(classes.length).toBe(1);
      expect(classes[0].name).toBe('UserService');

      // Should find methods
      const methods = chunks.filter((c) => c.type === 'method');
      expect(methods.length).toBe(3);
      expect(methods.map((m) => m.name).sort()).toEqual(['createUser', 'deleteUser', 'getUser']);

      // Should find functions (including arrow functions)
      const functions = chunks.filter((c) => c.type === 'function');
      expect(functions.length).toBeGreaterThanOrEqual(2);
      expect(functions.some((f) => f.name === 'validateConfig')).toBe(true);
      expect(functions.some((f) => f.name === 'processUsers')).toBe(true);
    });

    it('should detect async functions', () => {
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);

      const getUser = chunks.find((c) => c.name === 'getUser');
      expect(getUser?.async).toBe(true);

      const createUser = chunks.find((c) => c.name === 'createUser');
      expect(createUser?.async).toBe(true);

      const deleteUser = chunks.find((c) => c.name === 'deleteUser');
      expect(deleteUser?.async).toBe(false);

      const processUsers = chunks.find((c) => c.name === 'processUsers');
      expect(processUsers?.async).toBe(true);
    });

    it('should detect exported functions', () => {
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);

      const validateConfig = chunks.find((c) => c.name === 'validateConfig');
      expect(validateConfig?.exports).toBe(true);

      const internalHelper = chunks.find((c) => c.name === 'internalHelper');
      expect(internalHelper?.exports).toBe(false);
    });

    it('should associate methods with parent class', () => {
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);

      const methods = chunks.filter((c) => c.type === 'method');
      for (const method of methods) {
        expect(method.parentClass).toBe('UserService');
      }
    });
  });

  describe('buildChunkEmbeddingInput', () => {
    it('should build rich embedding input', () => {
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);
      const validateConfig = chunks.find((c) => c.name === 'validateConfig')!;

      const input = buildChunkEmbeddingInput(validateConfig);

      console.log('\n' + '='.repeat(70));
      console.log('EMBEDDING INPUT FOR validateConfig');
      console.log('='.repeat(70));
      console.log(input);

      expect(input).toContain('function: validateConfig');
      expect(input).toContain('Signature:');
      expect(input).toContain('File: test.ts');
      expect(input).toContain('exported');
      expect(input).toContain('Code:');
    });

    it('should include method parent class', () => {
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);
      const getUser = chunks.find((c) => c.name === 'getUser')!;

      const input = buildChunkEmbeddingInput(getUser);

      expect(input).toContain('method: getUser');
      expect(input).toContain('member of UserService');
    });
  });

  describe('Real file parsing', () => {
    it('should parse a real librainian file', async (ctx) => {
      const filePath = 'engines/relevance_engine.ts';
      const fullPath = path.resolve(librainianRoot, filePath);

      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        ctx.skip(true, `unverified_by_trace(test_fixture_missing): ${filePath}`);
        return;
      }

      const chunks = parseFileIntoChunks(filePath, content);

      console.log('\n' + '='.repeat(70));
      console.log(`CHUNKS IN ${filePath}`);
      console.log('='.repeat(70));

      const byType: Record<string, number> = {};
      for (const chunk of chunks) {
        byType[chunk.type] = (byType[chunk.type] || 0) + 1;
      }

      console.log('\nChunk types:');
      for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`);
      }

      console.log(`\nTotal chunks: ${chunks.length}`);

      // Show first few chunks
      console.log('\nFirst 5 chunks:');
      for (const chunk of chunks.slice(0, 5)) {
        console.log(`  [${chunk.type}] ${chunk.name} (lines ${chunk.startLine}-${chunk.endLine})`);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Chunk embedding', () => {
    it('should generate embeddings for chunks', async (ctx) => {
      ctx.skip(skipReason !== null, skipReason ?? undefined);
      const chunks = parseFileIntoChunks('test.ts', SAMPLE_CODE);

      // Only embed first 3 chunks to keep test fast
      const fileChunks: FileChunks = {
        filePath: 'test.ts',
        chunks: chunks.slice(0, 3),
        embeddings: [],
      };

      console.log('\n' + '='.repeat(70));
      console.log('GENERATING CHUNK EMBEDDINGS');
      console.log('='.repeat(70));

      for (const chunk of fileChunks.chunks) {
        const input = buildChunkEmbeddingInput(chunk);
        console.log(`\nEmbedding ${chunk.type}:${chunk.name} (${input.length} chars)`);

        const { generateRealEmbedding } = await import('../api/embedding_providers/real_embeddings.js');
        const result = await generateRealEmbedding(input, 'all-MiniLM-L6-v2');

        fileChunks.embeddings!.push({
          chunk,
          embedding: result.embedding,
          embeddingInput: input,
        });

        console.log(`  Dimension: ${result.embedding.length}`);
        console.log(`  First 5 values: [${Array.from(result.embedding.slice(0, 5)).map(v => v.toFixed(4)).join(', ')}]`);
      }

      expect(fileChunks.embeddings!.length).toBe(3);
      expect(fileChunks.embeddings![0].embedding.length).toBe(384);
    }, 120000);
  });

  describe('Chunk similarity', () => {
    it('should compute meaningful chunk-level similarity', async (ctx) => {
      ctx.skip(skipReason !== null, skipReason ?? undefined);
      console.log('\n' + '='.repeat(70));
      console.log('CHUNK-LEVEL SIMILARITY TEST');
      console.log('='.repeat(70));

      // Two similar functions
      const codeA = `
        export async function fetchUser(userId: string): Promise<User> {
          const response = await api.get(\`/users/\${userId}\`);
          return response.data;
        }
      `;

      const codeB = `
        export async function getUser(id: string): Promise<User> {
          const result = await httpClient.get(\`/users/\${id}\`);
          return result.data;
        }
      `;

      // A different function
      const codeC = `
        export function calculateTotal(items: Item[]): number {
          return items.reduce((sum, item) => sum + item.price, 0);
        }
      `;

      const fileA = await embedFileChunks('a.ts', codeA);
      const fileB = await embedFileChunks('b.ts', codeB);
      const fileC = await embedFileChunks('c.ts', codeC);

      console.log(`\nFile A chunks: ${fileA.chunks.length}`);
      console.log(`File B chunks: ${fileB.chunks.length}`);
      console.log(`File C chunks: ${fileC.chunks.length}`);

      expect(fileA.embeddings?.length ?? 0).toBeGreaterThan(0);
      expect(fileB.embeddings?.length ?? 0).toBeGreaterThan(0);
      expect(fileC.embeddings?.length ?? 0).toBeGreaterThan(0);

      const simAB = computeChunkSimilarity(fileA, fileB);
      const simAC = computeChunkSimilarity(fileA, fileC);
      const simBC = computeChunkSimilarity(fileB, fileC);

      console.log('\nSimilarity results:');
      console.log(`  fetchUser vs getUser: ${simAB.similarity.toFixed(4)} (should be HIGH)`);
      console.log(`  fetchUser vs calculateTotal: ${simAC.similarity.toFixed(4)} (should be LOW)`);
      console.log(`  getUser vs calculateTotal: ${simBC.similarity.toFixed(4)} (should be LOW)`);

      // Similar functions should have higher similarity
      expect(simAB.similarity).toBeGreaterThan(simAC.similarity);
      expect(simAB.similarity).toBeGreaterThan(simBC.similarity);
    }, 120000);

    it('should find best matching chunk pairs', async (ctx) => {
      ctx.skip(skipReason !== null, skipReason ?? undefined);
      console.log('\n' + '='.repeat(70));
      console.log('BEST MATCHING CHUNKS');
      console.log('='.repeat(70));

      const codeA = `
        export class UserManager {
          async getUser(id: string): Promise<User> {
            return this.db.findUser(id);
          }

          async createUser(data: UserData): Promise<User> {
            return this.db.insertUser(data);
          }
        }
      `;

      const codeB = `
        export class AccountService {
          async findAccount(accountId: string): Promise<Account> {
            return this.repo.getById(accountId);
          }

          async addAccount(info: AccountInfo): Promise<Account> {
            return this.repo.create(info);
          }
        }
      `;

      const fileA = await embedFileChunks('user_manager.ts', codeA);
      const fileB = await embedFileChunks('account_service.ts', codeB);

      expect(fileA.embeddings?.length ?? 0).toBeGreaterThan(0);
      expect(fileB.embeddings?.length ?? 0).toBeGreaterThan(0);

      const result = computeChunkSimilarity(fileA, fileB);

      console.log(`\nOverall similarity: ${result.similarity.toFixed(4)}`);
      console.log('\nBest matching pairs:');
      for (const match of result.bestMatches) {
        console.log(`  ${match.chunkA.name} ↔ ${match.chunkB.name}: ${match.similarity.toFixed(4)}`);
      }

      expect(result.bestMatches.length).toBeGreaterThan(0);
    }, 120000);
  });

  describe('Aggregation strategies', () => {
    it('should support different aggregation methods', async (ctx) => {
      ctx.skip(skipReason !== null, skipReason ?? undefined);
      console.log('\n' + '='.repeat(70));
      console.log('AGGREGATION STRATEGIES');
      console.log('='.repeat(70));

      const codeA = `
        export function processItems(items: Item[]): void {
          items.forEach(item => console.log(item));
        }

        export function validateItem(item: Item): boolean {
          return item.id != null;
        }
      `;

      const codeB = `
        export function handleItems(list: Item[]): void {
          list.map(i => console.log(i));
        }

        export function checkValidity(obj: Item): boolean {
          return obj.id !== undefined;
        }

        export function unusedFunction(): void {
          // This is different
        }
      `;

      const fileA = await embedFileChunks('a.ts', codeA);
      const fileB = await embedFileChunks('b.ts', codeB);

      expect(fileA.embeddings?.length ?? 0).toBeGreaterThan(0);
      expect(fileB.embeddings?.length ?? 0).toBeGreaterThan(0);

      const maxResult = computeChunkSimilarity(fileA, fileB, { aggregation: 'max' });
      const meanResult = computeChunkSimilarity(fileA, fileB, { aggregation: 'mean' });
      const weightedResult = computeChunkSimilarity(fileA, fileB, { aggregation: 'weighted' });

      console.log('\nAggregation comparison:');
      console.log(`  max: ${maxResult.similarity.toFixed(4)} (best single match)`);
      console.log(`  mean: ${meanResult.similarity.toFixed(4)} (average of matches)`);
      console.log(`  weighted: ${weightedResult.similarity.toFixed(4)} (weighted by chunk type)`);

      // Max should be highest (best single pair)
      expect(maxResult.similarity).toBeGreaterThanOrEqual(meanResult.similarity);
    }, 120000);
  });
});
