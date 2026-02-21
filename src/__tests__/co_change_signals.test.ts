/**
 * @fileoverview Test co-change signals from git history
 *
 * Validates that co-change analysis:
 * 1. Correctly extracts commit history
 * 2. Builds accurate co-change matrices
 * 3. Discovers meaningful file clusters
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fsSync from 'node:fs';
import {
  extractCommitHistory,
  buildCoChangeMatrix,
  computeCoChangeScore,
  discoverFileClusters,
  boostWithCoChange,
  serializeMatrix,
  deserializeMatrix,
  type CommitInfo,
  type CoChangeMatrix,
} from '../api/embedding_providers/co_change_signals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const HAS_GIT = fsSync.existsSync(path.join(repoRoot, '.git'));
const describeRepo = HAS_GIT ? describe : describe.skip;

// ============================================================================
// TESTS
// ============================================================================

describeRepo('Co-Change Signals', () => {
  let commits: CommitInfo[];
  let matrix: CoChangeMatrix;

  beforeAll(() => {
    console.log('\n' + '='.repeat(70));
    console.log('CO-CHANGE SIGNALS TEST');
    console.log('='.repeat(70) + '\n');

    // Extract history from current repo
    console.log('Extracting commit history...');
    commits = extractCommitHistory(repoRoot, {
      maxCommits: 500,
      daysBack: 180,
      minFilesPerCommit: 2,
      maxFilesPerCommit: 30,
    });

    console.log(`Found ${commits.length} qualifying commits\n`);

    // Build matrix
    console.log('Building co-change matrix...');
    matrix = buildCoChangeMatrix(commits);
    console.log(`Matrix has ${matrix.fileCounts.size} files and ${matrix.pairCounts.size} pairs\n`);
  }, 60000);

  describe('extractCommitHistory', () => {
    it('should extract commits from git', () => {
      expect(commits.length).toBeGreaterThan(0);
    });

    it('should filter by file count', () => {
      // All commits should have 2-30 files
      for (const commit of commits) {
        expect(commit.files.length).toBeGreaterThanOrEqual(2);
        expect(commit.files.length).toBeLessThanOrEqual(30);
      }
    });

    it('should exclude test files by default', () => {
      for (const commit of commits) {
        for (const file of commit.files) {
          expect(file).not.toMatch(/\.test\.(ts|js)$/);
          expect(file).not.toMatch(/__tests__/);
        }
      }
    });

    it('should include source files', () => {
      const hasSourceFiles = commits.some((c) =>
        c.files.some((f) =>
          f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs')
        )
      );
      expect(hasSourceFiles).toBe(true);
    });
  });

  describe('buildCoChangeMatrix', () => {
    it('should count file appearances', () => {
      expect(matrix.fileCounts.size).toBeGreaterThan(0);

      // All counts should be positive
      for (const [file, count] of matrix.fileCounts) {
        expect(count).toBeGreaterThan(0);
      }
    });

    it('should count pair co-occurrences', () => {
      // If we have multi-file commits, we should have pairs
      if (commits.some((c) => c.files.length >= 2)) {
        expect(matrix.pairCounts.size).toBeGreaterThan(0);
      }
    });

    it('should track total commits', () => {
      expect(matrix.totalCommits).toBe(commits.length);
    });
  });

  describe('computeCoChangeScore', () => {
    it('should return zero for unrelated files', () => {
      const score = computeCoChangeScore(
        'nonexistent/file1.ts',
        'nonexistent/file2.ts',
        matrix
      );

      expect(score.rawCount).toBe(0);
      expect(score.score).toBe(0);
    });

    it('should find co-change relationships in librainian', () => {
      console.log('\n' + '-'.repeat(70));
      console.log('CO-CHANGE RELATIONSHIPS:');
      console.log('-'.repeat(70));

      // Test some expected relationships in librainian
      const testPairs = [
        ['src/librainian/api/librainian.ts', 'src/librainian/types.ts'],
        ['src/librainian/engines/relevance_engine.ts', 'src/librainian/engines/constraint_engine.ts'],
        ['src/librainian/api/embeddings.ts', 'src/librainian/api/embedding_providers/real_embeddings.ts'],
        ['src/librainian/storage/sqlite_storage.ts', 'src/librainian/storage/types.ts'],
      ];

      for (const [fileA, fileB] of testPairs) {
        const score = computeCoChangeScore(fileA, fileB, matrix);
        console.log(`\n${path.basename(fileA)} ↔ ${path.basename(fileB)}:`);
        console.log(`  Raw count: ${score.rawCount}`);
        console.log(`  Jaccard: ${score.jaccard.toFixed(4)}`);
        console.log(`  P(B|A): ${score.conditionalAB.toFixed(4)}`);
        console.log(`  P(A|B): ${score.conditionalBA.toFixed(4)}`);
        console.log(`  Score: ${score.score.toFixed(4)}`);
      }
    });

    it('should compute valid scores', () => {
      // Find a pair with non-zero count
      let foundPair = false;

      for (const [pairKey, count] of matrix.pairCounts) {
        if (count >= 2) {
          const [fileA, fileB] = pairKey.split('|');
          const score = computeCoChangeScore(fileA, fileB, matrix);

          // Score should be non-zero for files in the matrix
          if (score.rawCount > 0) {
            expect(score.jaccard).toBeGreaterThan(0);
            expect(score.jaccard).toBeLessThanOrEqual(1);
            expect(score.score).toBeGreaterThan(0);
            expect(score.score).toBeLessThanOrEqual(1);
            foundPair = true;
            break;
          }
        }
      }

      if (!foundPair) {
        console.log('No frequent pairs found - skipping score validation');
      }
    });
  });

  describe('discoverFileClusters', () => {
    it('should discover file clusters', () => {
      console.log('\n' + '-'.repeat(70));
      console.log('FILE CLUSTERS:');
      console.log('-'.repeat(70));

      const clusters = discoverFileClusters(matrix, {
        minCoChange: 0.2,
        maxClusterSize: 8,
      });

      console.log(`\nFound ${clusters.length} clusters:\n`);

      for (const cluster of clusters.slice(0, 5)) {
        console.log(`[${cluster.name}] (avg co-change: ${cluster.avgCoChange.toFixed(3)})`);
        for (const file of cluster.files.slice(0, 5)) {
          console.log(`  - ${file}`);
        }
        if (cluster.files.length > 5) {
          console.log(`  ... and ${cluster.files.length - 5} more`);
        }
        console.log();
      }

      // If we have enough data, we should find clusters
      if (matrix.pairCounts.size > 10) {
        expect(clusters.length).toBeGreaterThan(0);
      }
    });

    it('should include multiple files per cluster', () => {
      const clusters = discoverFileClusters(matrix, { minCoChange: 0.15 });

      for (const cluster of clusters) {
        expect(cluster.files.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('boostWithCoChange', () => {
    it('should boost similarity when co-change is strong', () => {
      const result = boostWithCoChange(0.5, {
        rawCount: 10,
        jaccard: 0.5,
        conditionalAB: 0.7,
        conditionalBA: 0.6,
        score: 0.65,
      });

      expect(result.boostedSimilarity).toBeGreaterThan(0.5);
      expect(result.coChangeContribution).toBeGreaterThan(0);
    });

    it('should not boost when co-change is weak', () => {
      const result = boostWithCoChange(0.5, {
        rawCount: 1,
        jaccard: 0.05,
        conditionalAB: 0.05,
        conditionalBA: 0.03,
        score: 0.04,
      });

      expect(result.boostedSimilarity).toBe(0.5);
      expect(result.coChangeContribution).toBe(0);
    });

    it('should cap boosted similarity at 1.0', () => {
      const result = boostWithCoChange(0.9, {
        rawCount: 50,
        jaccard: 0.9,
        conditionalAB: 0.95,
        conditionalBA: 0.95,
        score: 0.95,
      });

      expect(result.boostedSimilarity).toBeLessThanOrEqual(1.0);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize matrix', () => {
      const serialized = serializeMatrix(matrix);

      expect(serialized.version).toBe(1);
      expect(serialized.totalCommits).toBe(matrix.totalCommits);
      expect(serialized.pairs.length).toBe(matrix.pairCounts.size);
      expect(serialized.files.length).toBe(matrix.fileCounts.size);

      const deserialized = deserializeMatrix(serialized);

      expect(deserialized.totalCommits).toBe(matrix.totalCommits);
      expect(deserialized.pairCounts.size).toBe(matrix.pairCounts.size);
      expect(deserialized.fileCounts.size).toBe(matrix.fileCounts.size);

      // Verify counts match
      for (const [key, count] of matrix.pairCounts) {
        expect(deserialized.pairCounts.get(key)).toBe(count);
      }
    });
  });

  describe('Real-world analysis', () => {
    it('should identify most frequently co-changed pairs', () => {
      console.log('\n' + '-'.repeat(70));
      console.log('TOP CO-CHANGED FILE PAIRS:');
      console.log('-'.repeat(70));

      // Sort pairs by count
      const sortedPairs = Array.from(matrix.pairCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

      for (const [pairKey, count] of sortedPairs) {
        const [fileA, fileB] = pairKey.split('|');
        const score = computeCoChangeScore(fileA, fileB, matrix);
        console.log(`\n${path.basename(fileA)} ↔ ${path.basename(fileB)}`);
        console.log(`  Commits together: ${count}`);
        console.log(`  Co-change score: ${score.score.toFixed(4)}`);
      }
    });

    it('should identify most active files', () => {
      console.log('\n' + '-'.repeat(70));
      console.log('MOST FREQUENTLY CHANGED FILES:');
      console.log('-'.repeat(70));

      const sortedFiles = Array.from(matrix.fileCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

      for (const [file, count] of sortedFiles) {
        console.log(`  ${count.toString().padStart(4)} commits: ${file}`);
      }
    });
  });
});
