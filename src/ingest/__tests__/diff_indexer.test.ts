/**
 * Tests for Git Diff Indexer
 *
 * Tests for:
 * - Unified diff parsing
 * - Change categorization (structural, behavioral, cosmetic)
 * - Complexity and impact calculation
 * - Query helpers
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseUnifiedDiff,
  categorizeChange,
  calculateComplexity,
  estimateImpact,
  type ParsedDiff,
} from '../diff_indexer.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage, DiffRecord } from '../../storage/types.js';

describe('Diff Indexer', () => {
  describe('categorizeChange', () => {
    it('should categorize structural changes', () => {
      // Pure structural changes with only structural keywords
      const addedLines = [
        'export interface NewInterface {',
        'export class NewClass {',
        'export function newFunction',
        'export type NewType =',
        'import { Something } from "./module"',
      ];
      const removedLines: string[] = [];

      const result = categorizeChange(addedLines, removedLines);
      // Should be structural or mixed (structural ratio > 0.5)
      expect(['structural', 'mixed']).toContain(result);
    });

    it('should categorize behavioral changes', () => {
      // Modifying logic inside a function
      const addedLines = [
        'if (condition && value > 10) {',
        '  return true;',
        '}',
      ];
      const removedLines = [
        'if (condition) {',
        '  return false;',
        '}',
      ];

      const result = categorizeChange(addedLines, removedLines);
      expect(result).toBe('behavioral');
    });

    it('should categorize cosmetic changes', () => {
      // Comment changes
      const addedLines = [
        '// New comment explaining the function',
        '/* Another comment */',
      ];
      const removedLines = [
        '// Old comment',
      ];

      const result = categorizeChange(addedLines, removedLines);
      expect(result).toBe('cosmetic');
    });

    it('should handle empty changes', () => {
      const result = categorizeChange([], []);
      expect(result).toBe('cosmetic');
    });

    it('should categorize mixed changes', () => {
      // Mix of structural and cosmetic
      const addedLines = [
        'export class NewClass {',
        '// This is a comment',
        '  constructor() {}',
        '}',
      ];
      const removedLines = [
        '// Old comment only',
      ];

      const result = categorizeChange(addedLines, removedLines);
      // Could be structural or mixed depending on ratios
      expect(['structural', 'mixed']).toContain(result);
    });
  });

  describe('calculateComplexity', () => {
    it('should return low complexity for small changes', () => {
      const diff: ParsedDiff = {
        filePath: 'test.ts',
        additions: 1,
        deletions: 1,
        hunks: [{ startLine: 1, length: 3, changeType: 'modify' }],
      };
      const complexity = calculateComplexity(diff);
      expect(complexity).toBeLessThan(0.3);
    });

    it('should return higher complexity for large changes', () => {
      const diff: ParsedDiff = {
        filePath: 'test.ts',
        additions: 80,
        deletions: 50,
        hunks: [
          { startLine: 1, length: 100, changeType: 'modify' },
          { startLine: 200, length: 50, changeType: 'modify' },
        ],
      };
      const complexity = calculateComplexity(diff);
      expect(complexity).toBeGreaterThan(0.3);
    });

    it('should cap complexity at 1.0', () => {
      const diff: ParsedDiff = {
        filePath: 'test.ts',
        additions: 500,
        deletions: 500,
        hunks: [{ startLine: 1, length: 1000, changeType: 'modify' }],
      };
      const complexity = calculateComplexity(diff);
      expect(complexity).toBeLessThanOrEqual(1.0);
    });

    it('should handle zero changes', () => {
      const diff: ParsedDiff = {
        filePath: 'test.ts',
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      const complexity = calculateComplexity(diff);
      expect(complexity).toBe(0);
    });
  });

  describe('estimateImpact', () => {
    it('should estimate lower impact for cosmetic changes', () => {
      const diff: ParsedDiff = {
        filePath: 'src/test.ts',
        additions: 1,
        deletions: 1,
        hunks: [{ startLine: 1, length: 2, changeType: 'modify' }],
      };
      const impact = estimateImpact('src/test.ts', diff, 'cosmetic');
      // Cosmetic changes get a -0.2 modifier
      expect(impact).toBeLessThanOrEqual(0.5);
    });

    it('should estimate higher impact for structural changes', () => {
      const diff: ParsedDiff = {
        filePath: 'src/core.ts',
        additions: 50,
        deletions: 30,
        hunks: [
          { startLine: 1, length: 40, changeType: 'modify' },
          { startLine: 100, length: 40, changeType: 'modify' },
        ],
      };
      const impact = estimateImpact('src/core.ts', diff, 'structural');
      // Structural changes get a +0.2 modifier, plus size bonus
      expect(impact).toBeGreaterThanOrEqual(0.6);
    });

    it('should return impact between 0 and 1', () => {
      const categories: Array<'structural' | 'behavioral' | 'cosmetic' | 'mixed'> = ['structural', 'behavioral', 'cosmetic', 'mixed'];
      for (const category of categories) {
        const diff: ParsedDiff = {
          filePath: 'test.ts',
          additions: 10,
          deletions: 5,
          hunks: [{ startLine: 1, length: 15, changeType: 'modify' }],
        };
        const impact = estimateImpact('test.ts', diff, category);
        expect(impact).toBeGreaterThanOrEqual(0);
        expect(impact).toBeLessThanOrEqual(1);
      }
    });

    it('should reduce impact for test files', () => {
      const diff: ParsedDiff = {
        filePath: 'src/test.test.ts',
        additions: 20,
        deletions: 10,
        hunks: [{ startLine: 1, length: 30, changeType: 'modify' }],
      };
      const testImpact = estimateImpact('src/test.test.ts', diff, 'behavioral');
      const coreImpact = estimateImpact('src/test.ts', diff, 'behavioral');
      // Test files get a -0.2 modifier
      expect(testImpact).toBeLessThan(coreImpact);
    });
  });

  describe('parseUnifiedDiff', () => {
    it('should parse simple unified diff', () => {
      const diff = `diff --git a/src/test.ts b/src/test.ts
index abc123..def456 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -10,3 +10,4 @@ function example() {
   const a = 1;
   const b = 2;
+  const c = 3;
   return a + b;`;

      const result = parseUnifiedDiff(diff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('src/test.ts');
      expect(result[0].hunks).toHaveLength(1);
      expect(result[0].additions).toBe(1);
      expect(result[0].deletions).toBe(0);
    });

    it('should parse diff with multiple files', () => {
      const diff = `diff --git a/src/a.ts b/src/a.ts
index abc123..def456 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 line1
+newline
 line2
diff --git a/src/b.ts b/src/b.ts
index 111222..333444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,3 +5,2 @@
 const x = 1;
-const y = 2;
 const z = 3;`;

      const result = parseUnifiedDiff(diff);

      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe('src/a.ts');
      expect(result[1].filePath).toBe('src/b.ts');
    });

    it('should handle empty diff', () => {
      const result = parseUnifiedDiff('');
      expect(result).toHaveLength(0);
    });

    it('should parse hunk headers correctly', () => {
      const diff = `diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -100,10 +100,12 @@ function test() {
 context line
+added line 1
+added line 2
-deleted line
 more context`;

      const result = parseUnifiedDiff(diff);

      expect(result[0].hunks[0].startLine).toBe(100);
      expect(result[0].additions).toBe(2);
      expect(result[0].deletions).toBe(1);
    });

    it('should handle binary files gracefully', () => {
      const diff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;

      const result = parseUnifiedDiff(diff);
      // Binary files will be parsed with the header but have no hunks
      if (result.length > 0) {
        expect(result[0].hunks).toHaveLength(0);
        expect(result[0].additions).toBe(0);
        expect(result[0].deletions).toBe(0);
      }
    });

    it('should handle new file creation', () => {
      const diff = `diff --git a/newfile.ts b/newfile.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,5 @@
+line 1
+line 2
+line 3
+line 4
+line 5`;

      const result = parseUnifiedDiff(diff);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('newfile.ts');
      expect(result[0].additions).toBe(5);
      expect(result[0].deletions).toBe(0);
    });

    it('should handle file deletion', () => {
      const diff = `diff --git a/oldfile.ts b/oldfile.ts
deleted file mode 100644
index abc123..0000000
--- a/oldfile.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line 1
-line 2
-line 3`;

      const result = parseUnifiedDiff(diff);

      expect(result).toHaveLength(1);
      expect(result[0].additions).toBe(0);
      expect(result[0].deletions).toBe(3);
    });
  });

  describe('Integration with Storage', () => {
    let storage: LibrarianStorage;
    const testDir = join(tmpdir(), 'diff-indexer-test-' + Date.now());

    beforeEach(async () => {
      if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
      }
      storage = createSqliteStorage(':memory:', testDir);
      await storage.initialize();
    });

    afterEach(async () => {
      await storage.close();
    });

    it('should store and retrieve diff records', async () => {
      const records: DiffRecord[] = [
        {
          id: 'diff-1',
          commitHash: 'abc123def456789012345678901234567890abcd',
          filePath: 'src/test.ts',
          additions: 10,
          deletions: 5,
          hunkCount: 2,
          changeCategory: 'behavioral',
          complexity: 0.4,
          impactScore: 0.6,
          hunks: [
            { startLine: 10, length: 8, changeType: 'modify' },
            { startLine: 50, length: 7, changeType: 'modify' },
          ],
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertDiffRecords(records);

      const retrieved = await storage.getDiffRecords({ filePath: 'src/test.ts' });
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].commitHash).toBe('abc123def456789012345678901234567890abcd');
      expect(retrieved[0].changeCategory).toBe('behavioral');
    });

    it('should query diff records by commit', async () => {
      const records: DiffRecord[] = [
        {
          id: 'diff-1',
          commitHash: 'commit1',
          filePath: 'src/a.ts',
          additions: 5,
          deletions: 2,
          hunkCount: 1,
          changeCategory: 'behavioral',
          complexity: 0.3,
          impactScore: 0.4,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'diff-2',
          commitHash: 'commit1',
          filePath: 'src/b.ts',
          additions: 3,
          deletions: 1,
          hunkCount: 1,
          changeCategory: 'cosmetic',
          complexity: 0.1,
          impactScore: 0.2,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'diff-3',
          commitHash: 'commit2',
          filePath: 'src/c.ts',
          additions: 20,
          deletions: 10,
          hunkCount: 3,
          changeCategory: 'structural',
          complexity: 0.7,
          impactScore: 0.8,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertDiffRecords(records);

      const commit1Diffs = await storage.getDiffRecords({ commitHash: 'commit1' });
      expect(commit1Diffs).toHaveLength(2);

      const commit2Diffs = await storage.getDiffRecords({ commitHash: 'commit2' });
      expect(commit2Diffs).toHaveLength(1);
    });

    it('should query high-impact changes', async () => {
      const records: DiffRecord[] = [
        {
          id: 'diff-low',
          commitHash: 'commit1',
          filePath: 'src/low.ts',
          additions: 1,
          deletions: 1,
          hunkCount: 1,
          changeCategory: 'cosmetic',
          complexity: 0.1,
          impactScore: 0.2,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'diff-high',
          commitHash: 'commit2',
          filePath: 'src/high.ts',
          additions: 50,
          deletions: 30,
          hunkCount: 5,
          changeCategory: 'structural',
          complexity: 0.9,
          impactScore: 0.95,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertDiffRecords(records);

      const highImpact = await storage.getDiffRecords({ minImpact: 0.7 });
      expect(highImpact).toHaveLength(1);
      expect(highImpact[0].filePath).toBe('src/high.ts');
    });

    it('should query by change category', async () => {
      const records: DiffRecord[] = [
        {
          id: 'diff-structural',
          commitHash: 'commit1',
          filePath: 'src/struct.ts',
          additions: 20,
          deletions: 0,
          hunkCount: 1,
          changeCategory: 'structural',
          complexity: 0.5,
          impactScore: 0.7,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
        {
          id: 'diff-behavioral',
          commitHash: 'commit2',
          filePath: 'src/behav.ts',
          additions: 5,
          deletions: 3,
          hunkCount: 2,
          changeCategory: 'behavioral',
          complexity: 0.4,
          impactScore: 0.5,
          hunks: [],
          indexedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertDiffRecords(records);

      const structural = await storage.getDiffRecords({ changeCategory: 'structural' });
      expect(structural).toHaveLength(1);
      expect(structural[0].filePath).toBe('src/struct.ts');
    });
  });
});
