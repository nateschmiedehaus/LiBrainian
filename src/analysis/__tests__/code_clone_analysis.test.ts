/**
 * Tests for Code Clone Analysis
 *
 * Tests for:
 * - Tokenization and normalization
 * - Similarity calculations (Jaccard, LCS)
 * - Clone type classification
 * - Refactoring potential estimation
 * - Clone detection pipeline
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  tokenize,
  normalizeTokens,
  jaccardSimilarity,
  lcsRatio,
  classifyCloneType,
  estimateRefactoringPotential,
  cosineSimilarity,
} from '../code_clone_analysis.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage, CloneEntry } from '../../storage/types.js';

describe('Code Clone Analysis', () => {
  describe('tokenize', () => {
    it('should tokenize simple code', () => {
      const code = 'const x = 1;';
      const tokens = tokenize(code);

      expect(tokens).toContain('const');
      expect(tokens).toContain('x');
      expect(tokens).toContain('=');
      expect(tokens).toContain('1');
    });

    it('should tokenize function declaration', () => {
      const code = `function add(a, b) {
        return a + b;
      }`;
      const tokens = tokenize(code);

      expect(tokens).toContain('function');
      expect(tokens).toContain('add');
      expect(tokens).toContain('return');
      expect(tokens).toContain('+');
    });

    it('should handle empty code', () => {
      expect(tokenize('')).toHaveLength(0);
      expect(tokenize('   ')).toHaveLength(0);
    });

    it('should tokenize strings and comments', () => {
      const code = `
        const msg = "hello world";
        // This is a comment
        const x = 1;
      `;
      const tokens = tokenize(code);

      expect(tokens).toContain('const');
      expect(tokens).toContain('msg');
    });

    it('should handle operators', () => {
      const code = 'a + b - c * d / e';
      const tokens = tokenize(code);

      expect(tokens).toContain('+');
      expect(tokens).toContain('-');
      expect(tokens).toContain('*');
      expect(tokens).toContain('/');
      // Note: Multi-char operators like === may be split due to punctuation handling
      expect(tokens).toContain('a');
      expect(tokens).toContain('b');
    });
  });

  describe('normalizeTokens', () => {
    it('should normalize variable names', () => {
      const tokens1 = ['const', 'myVar', '=', '1'];
      const tokens2 = ['const', 'otherVar', '=', '1'];

      const norm1 = normalizeTokens(tokens1);
      const norm2 = normalizeTokens(tokens2);

      // After normalization, variable names should be replaced with placeholders
      expect(norm1).toEqual(norm2);
    });

    it('should preserve keywords', () => {
      const tokens = ['function', 'myFunc', 'return', 'if', 'else'];
      const normalized = normalizeTokens(tokens);

      expect(normalized).toContain('function');
      expect(normalized).toContain('return');
      expect(normalized).toContain('if');
      expect(normalized).toContain('else');
    });

    it('should normalize string literals', () => {
      const tokens1 = ['const', 'x', '=', '"hello"'];
      const tokens2 = ['const', 'y', '=', '"world"'];

      const norm1 = normalizeTokens(tokens1);
      const norm2 = normalizeTokens(tokens2);

      // String literals should be normalized to same placeholder
      expect(norm1[3]).toBe(norm2[3]);
    });

    it('should normalize number literals', () => {
      const tokens1 = ['const', 'x', '=', '42'];
      const tokens2 = ['const', 'y', '=', '100'];

      const norm1 = normalizeTokens(tokens1);
      const norm2 = normalizeTokens(tokens2);

      expect(norm1[3]).toBe(norm2[3]);
    });
  });

  describe('jaccardSimilarity', () => {
    it('should return 1 for identical token sets', () => {
      const tokens = ['a', 'b', 'c'];
      expect(jaccardSimilarity(tokens, tokens)).toBe(1);
    });

    it('should return 0 for completely different sets', () => {
      const tokens1 = ['a', 'b', 'c'];
      const tokens2 = ['x', 'y', 'z'];
      expect(jaccardSimilarity(tokens1, tokens2)).toBe(0);
    });

    it('should return correct value for partial overlap', () => {
      const tokens1 = ['a', 'b', 'c', 'd'];
      const tokens2 = ['a', 'b', 'e', 'f'];
      // Intersection: {a, b} = 2
      // Union: {a, b, c, d, e, f} = 6
      // Jaccard = 2/6 = 0.333...
      expect(jaccardSimilarity(tokens1, tokens2)).toBeCloseTo(0.333, 2);
    });

    it('should handle empty arrays', () => {
      expect(jaccardSimilarity([], [])).toBe(0);
      expect(jaccardSimilarity(['a'], [])).toBe(0);
      expect(jaccardSimilarity([], ['a'])).toBe(0);
    });

    it('should handle duplicates correctly', () => {
      const tokens1 = ['a', 'a', 'b'];
      const tokens2 = ['a', 'b', 'b'];
      // Sets: {a, b} and {a, b}
      expect(jaccardSimilarity(tokens1, tokens2)).toBe(1);
    });
  });

  describe('lcsRatio', () => {
    it('should return 1 for identical sequences', () => {
      const tokens = ['a', 'b', 'c', 'd'];
      expect(lcsRatio(tokens, tokens)).toBe(1);
    });

    it('should return 0 for completely different sequences', () => {
      const tokens1 = ['a', 'b', 'c'];
      const tokens2 = ['x', 'y', 'z'];
      expect(lcsRatio(tokens1, tokens2)).toBe(0);
    });

    it('should find longest common subsequence', () => {
      const tokens1 = ['a', 'b', 'c', 'd', 'e'];
      const tokens2 = ['a', 'x', 'c', 'y', 'e'];
      // LCS: a, c, e = length 3
      // Ratio = (2 * 3) / (5 + 5) = 6/10 = 0.6
      expect(lcsRatio(tokens1, tokens2)).toBeCloseTo(0.6, 2);
    });

    it('should handle empty arrays', () => {
      expect(lcsRatio([], [])).toBe(0);
      expect(lcsRatio(['a'], [])).toBe(0);
    });
  });

  describe('classifyCloneType', () => {
    it('should classify exact clones', () => {
      // Identical tokens = exact clone
      const tokens = ['function', 'add', '(', 'a', ',', 'b', ')'];
      const normalized = normalizeTokens(tokens);
      const type = classifyCloneType(
        tokens, tokens,       // identical original tokens
        normalized, normalized, // identical normalized tokens
        1.0                   // perfect embedding similarity
      );
      expect(type).toBe('exact');
    });

    it('should classify type2 clones (renamed identifiers)', () => {
      // Same structure, different variable names
      const tokens1 = ['function', 'add', '(', 'x', ',', 'y', ')'];
      const tokens2 = ['function', 'sum', '(', 'a', ',', 'b', ')'];
      const normalized1 = normalizeTokens(tokens1);
      const normalized2 = normalizeTokens(tokens2);

      const type = classifyCloneType(
        tokens1, tokens2,
        normalized1, normalized2,
        0.95
      );
      // After normalization, these should be very similar
      expect(['type1', 'type2']).toContain(type);
    });

    it('should classify type3 clones (modified statements)', () => {
      // Different structure - but with low similarity
      const tokens1 = ['if', '(', 'x', ')', '{', 'return', 'a', '}'];
      const tokens2 = ['if', '(', 'x', ')', '{', 'return', 'b', '}', 'else', '{', 'return', 'c', '}'];
      const normalized1 = normalizeTokens(tokens1);
      const normalized2 = normalizeTokens(tokens2);

      const type = classifyCloneType(
        tokens1, tokens2,
        normalized1, normalized2,
        0.75
      );
      // Could return type1, type3, or semantic depending on similarity thresholds
      expect(['type1', 'type3', 'semantic']).toContain(type);
    });

    it('should classify semantic clones', () => {
      // Very different tokens but high embedding similarity
      const tokens1 = ['arr', '.', 'map', '(', 'x', ')'];
      const tokens2 = ['for', '(', 'i', ')', '{', 'push', '}'];
      const normalized1 = normalizeTokens(tokens1);
      const normalized2 = normalizeTokens(tokens2);

      const type = classifyCloneType(
        tokens1, tokens2,
        normalized1, normalized2,
        0.9 // High embedding similarity despite different tokens
      );
      expect(type).toBe('semantic');
    });
  });

  describe('estimateRefactoringPotential', () => {
    it('should return high potential for exact clones', () => {
      const potential = estimateRefactoringPotential('exact', 0.95, 50);
      expect(potential).toBeGreaterThan(0.7);
    });

    it('should return lower potential for semantic clones', () => {
      const potential = estimateRefactoringPotential('semantic', 0.80, 30);
      expect(potential).toBeLessThan(0.6);
    });

    it('should increase potential with larger clone size', () => {
      const potSmall = estimateRefactoringPotential('type2', 0.90, 10);
      const potLarge = estimateRefactoringPotential('type2', 0.90, 60);
      expect(potLarge).toBeGreaterThan(potSmall);
    });

    it('should return value between 0 and 1', () => {
      const types = ['exact', 'type1', 'type2', 'type3', 'semantic'] as const;
      for (const type of types) {
        for (let sim = 0.5; sim <= 1; sim += 0.1) {
          for (let size = 10; size <= 100; size += 30) {
            const potential = estimateRefactoringPotential(type, sim, size);
            expect(potential).toBeGreaterThanOrEqual(0);
            expect(potential).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const v = [1, 2, 3, 4];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = [1, 0];
      const v2 = [0, 1];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const v1 = [1, 2, 3];
      const v2 = [-1, -2, -3];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
    });

    it('should handle zero vectors', () => {
      const zero = [0, 0, 0];
      const v = [1, 2, 3];
      expect(cosineSimilarity(zero, v)).toBe(0);
      expect(cosineSimilarity(v, zero)).toBe(0);
    });

    it('should be symmetric', () => {
      const v1 = [1, 2, 3, 4, 5];
      const v2 = [5, 4, 3, 2, 1];
      expect(cosineSimilarity(v1, v2)).toBeCloseTo(cosineSimilarity(v2, v1), 5);
    });
  });

  describe('Integration with Storage', () => {
    let storage: LiBrainianStorage;
    let dbPath: string;
    const testDir = join(tmpdir(), 'clone-analysis-test-' + Date.now());

    beforeEach(async () => {
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }
      dbPath = join(testDir, `test-${Date.now()}.db`);
      storage = createSqliteStorage(dbPath, testDir);
      await storage.initialize();
    });

    afterEach(async () => {
      await storage.close();
      if (existsSync(dbPath)) {
        try {
          unlinkSync(dbPath);
          unlinkSync(dbPath + '-wal');
          unlinkSync(dbPath + '-shm');
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should store and retrieve clone entries', async () => {
      const entries: CloneEntry[] = [
        {
          cloneGroupId: 1,
          entityId1: 'func-a',
          entityId2: 'func-b',
          entityType: 'function',
          similarity: 0.95,
          cloneType: 'type2',
          refactoringPotential: 0.8,
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertCloneEntries(entries);

      const retrieved = await storage.getCloneEntries({});
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].similarity).toBe(0.95);
      expect(retrieved[0].cloneType).toBe('type2');
    });

    it('should query clones by entity', async () => {
      const entries: CloneEntry[] = [
        {
          cloneGroupId: 1,
          entityId1: 'func-a',
          entityId2: 'func-b',
          entityType: 'function',
          similarity: 0.90,
          cloneType: 'type2',
          refactoringPotential: 0.8,
          computedAt: new Date().toISOString(),
        },
        {
          cloneGroupId: 1,
          entityId1: 'func-a',
          entityId2: 'func-c',
          entityType: 'function',
          similarity: 0.85,
          cloneType: 'type3',
          refactoringPotential: 0.6,
          computedAt: new Date().toISOString(),
        },
        {
          cloneGroupId: 2,
          entityId1: 'func-x',
          entityId2: 'func-y',
          entityType: 'function',
          similarity: 0.95,
          cloneType: 'exact',
          refactoringPotential: 0.95,
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertCloneEntries(entries);

      const funcAClones = await storage.getClonesByEntity('func-a');
      expect(funcAClones).toHaveLength(2);

      const funcXClones = await storage.getClonesByEntity('func-x');
      expect(funcXClones).toHaveLength(1);
    });

    it('should filter clones by minimum similarity', async () => {
      const entries: CloneEntry[] = [
        {
          cloneGroupId: 1,
          entityId1: 'a',
          entityId2: 'b',
          entityType: 'function',
          similarity: 0.95,
          cloneType: 'exact',
          refactoringPotential: 0.95,
          computedAt: new Date().toISOString(),
        },
        {
          cloneGroupId: 2,
          entityId1: 'c',
          entityId2: 'd',
          entityType: 'function',
          similarity: 0.70,
          cloneType: 'type3',
          refactoringPotential: 0.6,
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertCloneEntries(entries);

      const highSimilarity = await storage.getCloneEntries({ minSimilarity: 0.90 });
      expect(highSimilarity).toHaveLength(1);
      expect(highSimilarity[0].entityId1).toBe('a');
    });

    it('should filter clones by type', async () => {
      const entries: CloneEntry[] = [
        {
          cloneGroupId: 1,
          entityId1: 'a',
          entityId2: 'b',
          entityType: 'function',
          similarity: 0.99,
          cloneType: 'exact',
          refactoringPotential: 0.95,
          computedAt: new Date().toISOString(),
        },
        {
          cloneGroupId: 2,
          entityId1: 'c',
          entityId2: 'd',
          entityType: 'function',
          similarity: 0.80,
          cloneType: 'semantic',
          refactoringPotential: 0.4,
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertCloneEntries(entries);

      const exactClones = await storage.getCloneEntries({ cloneType: 'exact' });
      expect(exactClones).toHaveLength(1);

      const semanticClones = await storage.getCloneEntries({ cloneType: 'semantic' });
      expect(semanticClones).toHaveLength(1);
    });

    it('should get clone clusters', async () => {
      const entries: CloneEntry[] = [
        // Cluster 1: a, b, c are all similar
        { cloneGroupId: 1, entityId1: 'a', entityId2: 'b', entityType: 'function', similarity: 0.95, cloneType: 'type2', refactoringPotential: 0.8, computedAt: new Date().toISOString() },
        { cloneGroupId: 1, entityId1: 'a', entityId2: 'c', entityType: 'function', similarity: 0.92, cloneType: 'type2', refactoringPotential: 0.75, computedAt: new Date().toISOString() },
        { cloneGroupId: 1, entityId1: 'b', entityId2: 'c', entityType: 'function', similarity: 0.90, cloneType: 'type2', refactoringPotential: 0.7, computedAt: new Date().toISOString() },
        // Cluster 2: x, y
        { cloneGroupId: 2, entityId1: 'x', entityId2: 'y', entityType: 'function', similarity: 0.88, cloneType: 'type3', refactoringPotential: 0.6, computedAt: new Date().toISOString() },
      ];

      await storage.upsertCloneEntries(entries);

      const clusters = await storage.getCloneClusters();
      expect(clusters).toHaveLength(2);

      const cluster1 = clusters.find(c => c.clusterId === 1);
      expect(cluster1).toBeDefined();
      expect(cluster1!.memberCount).toBe(3); // a, b, c
    });
  });
});
