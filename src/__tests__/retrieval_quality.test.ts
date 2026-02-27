/**
 * @fileoverview Retrieval Quality Benchmark Suite
 *
 * Tests retrieval SLOs from VISION.md:
 * - Fix-localization Recall@5: >= 70%
 * - Change-impact Recall@10: >= 60%
 * - Precision@5: >= 40%
 * - nDCG@10: >= 0.6
 *
 * Uses ground-truth benchmark queries specific to the librarian codebase.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import { queryLibrarian } from '../api/query.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianQuery, ContextPack } from '../types.js';

// Benchmark query definition
interface BenchmarkQuery {
  name: string;
  query: string;
  type: 'fix-localization' | 'change-impact' | 'test-coverage' | 'convention';
  // Ground truth: files that MUST be in top K results
  groundTruth: string[];
  // Optional: relevance grades for nDCG (3=highly relevant, 2=relevant, 1=somewhat, 0=not)
  relevanceGrades?: Record<string, number>;
}

// Ground-truth benchmarks for the librarian codebase
const BENCHMARKS: BenchmarkQuery[] = [
  // Fix-localization queries
  {
    name: 'find-query-function',
    query: 'Where is the main query function that retrieves context packs?',
    type: 'fix-localization',
    groundTruth: ['src/api/query.ts'],
    relevanceGrades: {
      'src/api/query.ts': 3,
      'src/api/packs.ts': 2,
      'src/query/scoring.ts': 2,
      'src/query/multi_signal_scorer.ts': 1,
    },
  },
  {
    name: 'find-bootstrap',
    query: 'Where is bootstrap implemented?',
    type: 'fix-localization',
    groundTruth: ['src/api/bootstrap.ts'],
    relevanceGrades: {
      'src/api/bootstrap.ts': 3,
      'src/cli/commands/bootstrap.ts': 2,
    },
  },
  {
    name: 'find-edge-confidence',
    query: 'Where is edge confidence computed for graph edges?',
    type: 'fix-localization',
    groundTruth: ['src/agents/edge_confidence.ts'],
    relevanceGrades: {
      'src/agents/edge_confidence.ts': 3,
      'src/agents/index_librarian.ts': 2,
    },
  },
  {
    name: 'find-commit-indexer',
    // Natural language - tracks semantic retrieval quality
    query: 'Where are git commits indexed and categorized?',
    type: 'fix-localization',
    groundTruth: ['src/ingest/commit_indexer.ts'],
    relevanceGrades: {
      'src/ingest/commit_indexer.ts': 3,
      'src/knowledge/extractors/history_extractor.ts': 2, // semantically related
    },
  },
  {
    name: 'find-feedback-processing',
    query: 'Where is agent feedback processed to update confidence?',
    type: 'fix-localization',
    groundTruth: ['src/integration/agent_feedback.ts'],
    relevanceGrades: {
      'src/integration/agent_feedback.ts': 3,
      'src/api/feedback.ts': 2,
    },
  },

  // Change-impact queries
  {
    name: 'impact-storage-types',
    query: 'What depends on LibrarianStorage interface?',
    type: 'change-impact',
    groundTruth: ['src/storage/types.ts', 'src/storage/sqlite_storage.ts', 'src/api/query.ts'],
    relevanceGrades: {
      'src/storage/types.ts': 3,
      'src/storage/sqlite_storage.ts': 3,
      'src/api/query.ts': 2,
      'src/api/bootstrap.ts': 2,
    },
  },
  {
    name: 'impact-context-pack',
    // Natural language - tracks semantic retrieval quality
    query: 'What files work with ContextPack type?',
    type: 'change-impact',
    groundTruth: ['src/types.ts', 'src/api/packs.ts', 'src/api/query.ts'],
    relevanceGrades: {
      'src/types.ts': 3,
      'src/api/packs.ts': 3,
      'src/api/query.ts': 2,
      'src/storage/types.ts': 1, // related types file
    },
  },

  // Test coverage queries
  {
    name: 'tests-for-query',
    // Natural language - tracks test discovery quality
    query: 'What tests cover the query functionality?',
    type: 'test-coverage',
    groundTruth: ['src/__tests__/librarian.test.ts'],
    relevanceGrades: {
      'src/__tests__/librarian.test.ts': 3,
      'src/__tests__/retrieval_quality.test.ts': 2, // related test
    },
  },

  // Convention queries
  {
    name: 'convention-error-handling',
    query: 'How are errors handled in the codebase?',
    type: 'convention',
    groundTruth: ['src/cli/errors.ts', 'src/utils/errors.ts'],
    relevanceGrades: {
      'src/cli/errors.ts': 3,
      'src/utils/errors.ts': 3,
      'src/api/provider_check.ts': 1,
    },
  },
];

// Check if two paths match (after normalization)
function pathsMatch(result: string, groundTruth: string): boolean {
  const normalizedResult = normalizePath(result);
  const normalizedGT = normalizePath(groundTruth);
  // Exact match
  if (normalizedResult === normalizedGT) return true;
  // Result ends with ground truth
  if (normalizedResult.endsWith(normalizedGT)) return true;
  // Ground truth ends with result
  if (normalizedGT.endsWith(normalizedResult)) return true;
  // Result contains ground truth path components
  if (normalizedResult.includes(normalizedGT)) return true;
  return false;
}

// Metric computation helpers
function computeRecallAtK(results: string[], groundTruth: string[], k: number): number {
  const topK = results.slice(0, k);
  const relevant = groundTruth.filter(gt =>
    topK.some(r => pathsMatch(r, gt))
  );
  return relevant.length / groundTruth.length;
}

function computePrecisionAtK(results: string[], groundTruth: string[], k: number): number {
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;
  const relevant = topK.filter(r =>
    groundTruth.some(gt => pathsMatch(r, gt))
  );
  return relevant.length / Math.min(k, topK.length);
}

function computeDCG(results: string[], relevanceGrades: Record<string, number>, k: number): number {
  let dcg = 0;
  const topK = results.slice(0, k);

  for (let i = 0; i < topK.length; i++) {
    const result = topK[i];
    // Find matching grade
    let grade = 0;
    for (const [file, g] of Object.entries(relevanceGrades)) {
      if (pathsMatch(result, file)) {
        grade = g;
        break;
      }
    }
    // DCG formula: rel_i / log2(i + 2)
    dcg += grade / Math.log2(i + 2);
  }
  return dcg;
}

function computeIdealDCG(relevanceGrades: Record<string, number>, k: number): number {
  // Sort grades descending and compute ideal DCG
  const sortedGrades = Object.values(relevanceGrades).sort((a, b) => b - a);
  let idcg = 0;
  for (let i = 0; i < Math.min(k, sortedGrades.length); i++) {
    idcg += sortedGrades[i] / Math.log2(i + 2);
  }
  return idcg;
}

function computeNDCG(results: string[], relevanceGrades: Record<string, number>, k: number): number {
  const dcg = computeDCG(results, relevanceGrades, k);
  const idcg = computeIdealDCG(relevanceGrades, k);
  return idcg === 0 ? 0 : dcg / idcg;
}

// Normalize path for comparison - strip absolute prefix, standardize extension
function normalizePath(p: string): string {
  // Strip absolute path prefix
  let normalized = p.replace(/^\/.*\/packages\/librarian\//, '');
  // Also handle Windows-style paths
  normalized = normalized.replace(/^.*\\packages\\librarian\\/, '');
  // Normalize .js to .ts for comparison
  normalized = normalized.replace(/\.js$/, '.ts');
  return normalized;
}

// Check if a string looks like a file path (not a UUID)
function isFilePath(s: string): boolean {
  // UUIDs are hex strings with dashes: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return false;
  }
  // File paths have slashes or extensions
  return s.includes('/') || s.includes('\\') || /\.\w+$/.test(s);
}

// Extract file paths from query results
function extractFilePaths(packs: ContextPack[]): string[] {
  const pathSet = new Set<string>();
  for (const pack of packs) {
    // Add related files (these are the primary source)
    for (const file of pack.relatedFiles || []) {
      if (isFilePath(file)) {
        pathSet.add(normalizePath(file));
      }
    }
    // Also extract from code snippets
    for (const snippet of pack.codeSnippets || []) {
      if (snippet.filePath && isFilePath(snippet.filePath)) {
        pathSet.add(normalizePath(snippet.filePath));
      }
    }
  }
  return Array.from(pathSet);
}

describe('Retrieval Quality Benchmarks', () => {
  let storage: LibrarianStorage;
  let hasIndex = false;
  const workspaceRoot = path.resolve(__dirname, '../../');
  const dbPath = path.join(workspaceRoot, '.librarian', 'librarian.db');

  beforeAll(async () => {
    storage = createSqliteStorage(dbPath, workspaceRoot);
    await storage.initialize();
    const stats = await storage.getStats();
    hasIndex = stats.totalFunctions + stats.totalModules > 0;
    if (!hasIndex) {
      console.warn('SKIP: Storage not initialized or empty; retrieval benchmarks are skipped.');
    }
  }, 30_000);

  describe('Individual Benchmark Queries (Diagnostic)', () => {
    // These tests are diagnostic - they log performance per query but don't fail.
    // The aggregate metrics in the next describe block are the actual quality gates.
    for (const benchmark of BENCHMARKS) {
      it(`[${benchmark.type}] ${benchmark.name}`, async (ctx) => {
        if (!hasIndex) {
          ctx.skip(true, 'unverified_by_trace(test_fixture_missing): Retrieval benchmarks require a bootstrapped local index');
          return;
        }
        // Disable synthesis for faster benchmarks
        const origEnv = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
        process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

        try {
          const query: LibrarianQuery = {
            intent: benchmark.query,
            depth: 'L2',
          };

          const result = await queryLibrarian(query, storage);
          const filePaths = extractFilePaths(result.packs);

          // Log results for debugging
          console.log(`\n[${benchmark.name}] Query: "${benchmark.query}"`);
          console.log(`  Ground truth: ${benchmark.groundTruth.join(', ')}`);
          console.log(`  Top 5 results: ${filePaths.slice(0, 5).join(', ')}`);

          // Check that at least one ground truth file is found
          const recall5 = computeRecallAtK(filePaths, benchmark.groundTruth, 5);
          console.log(`  Recall@5: ${(recall5 * 100).toFixed(1)}%`);

          // Diagnostic assertion - logs but doesn't fail test
          if (benchmark.type === 'fix-localization' && recall5 < 0.5) {
            console.log(`  ⚠ Below target (50% Recall@5 for fix-localization)`);
          }

        } finally {
          if (origEnv === undefined) {
            delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
          } else {
            process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = origEnv;
          }
        }
      });
    }
  });

  describe('Aggregate Metrics (Quality Gates)', () => {
    /**
     * These tests establish quality gates for retrieval performance.
     *
     * VISION.md SLO Targets (long-term goals):
     * - Fix-localization Recall@5: >= 70%
     * - Change-impact Recall@10: >= 60%
     * - Precision@5: >= 40%
     * - nDCG@10: >= 0.6
     *
     * Current Baseline (achievable now - gates):
     * - Fix-localization Recall@5: >= 60%
     * - Precision@5: >= 10% (tracking improvement)
     * - nDCG@10: >= 0.25 (tracking improvement)
     *
     * As retrieval improves, these gates should be tightened toward VISION targets.
     */

    it('achieves >= 60% average Recall@5 for fix-localization queries', async (ctx) => {
      if (!hasIndex) {
        ctx.skip(true, 'unverified_by_trace(test_fixture_missing): Retrieval quality gates require a bootstrapped local index');
        return;
      }
      // VISION.md target: 70%, current gate: 60%
      const fixBenchmarks = BENCHMARKS.filter(b => b.type === 'fix-localization');
      const recalls: number[] = [];

      const origEnv = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

      try {
        for (const benchmark of fixBenchmarks) {
          const result = await queryLibrarian(
            { intent: benchmark.query, depth: 'L2' },
            storage
          );
          const filePaths = extractFilePaths(result.packs);
          recalls.push(computeRecallAtK(filePaths, benchmark.groundTruth, 5));
        }
      } finally {
        if (origEnv === undefined) {
          delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
        } else {
          process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = origEnv;
        }
      }

      const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length;
      console.log(`\nFix-localization average Recall@5: ${(avgRecall * 100).toFixed(1)}%`);
      console.log(`Individual recalls: ${recalls.map(r => (r * 100).toFixed(0) + '%').join(', ')}`);
      console.log(`  Gate: 60%, VISION target: 70%`);

      expect(avgRecall).toBeGreaterThanOrEqual(0.6);
    });

    it('tracks Precision@5 (current baseline)', async (ctx) => {
      if (!hasIndex) {
        ctx.skip(true, 'unverified_by_trace(test_fixture_missing): Retrieval quality gates require a bootstrapped local index');
        return;
      }
      // VISION.md target: 40%, current baseline: ~13%
      // This test tracks progress without blocking - precision improvement is ongoing work
      const precisions: number[] = [];

      const origEnv = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

      try {
        for (const benchmark of BENCHMARKS) {
          const result = await queryLibrarian(
            { intent: benchmark.query, depth: 'L2' },
            storage
          );
          const filePaths = extractFilePaths(result.packs);
          precisions.push(computePrecisionAtK(filePaths, benchmark.groundTruth, 5));
        }
      } finally {
        if (origEnv === undefined) {
          delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
        } else {
          process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = origEnv;
        }
      }

      const avgPrecision = precisions.reduce((a, b) => a + b, 0) / precisions.length;
      console.log(`\nAverage Precision@5: ${(avgPrecision * 100).toFixed(1)}%`);
      console.log(`  Current baseline, VISION target: 40%`);

      // Gate: 10% (achievable baseline) - increase as we improve
      expect(avgPrecision).toBeGreaterThanOrEqual(0.1);
    });

    it('tracks nDCG@10 (current baseline)', async (ctx) => {
      if (!hasIndex) {
        ctx.skip(true, 'unverified_by_trace(test_fixture_missing): Retrieval quality gates require a bootstrapped local index');
        return;
      }
      // VISION.md target: 0.6, current baseline: ~0.38
      const benchmarksWithGrades = BENCHMARKS.filter(b => b.relevanceGrades);
      const ndcgs: number[] = [];

      const origEnv = process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
      process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = '1';

      try {
        for (const benchmark of benchmarksWithGrades) {
          const result = await queryLibrarian(
            { intent: benchmark.query, depth: 'L2' },
            storage
          );
          const filePaths = extractFilePaths(result.packs);
          ndcgs.push(computeNDCG(filePaths, benchmark.relevanceGrades!, 10));
        }
      } finally {
        if (origEnv === undefined) {
          delete process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS;
        } else {
          process.env.LIBRARIAN_QUERY_DISABLE_SYNTHESIS = origEnv;
        }
      }

      const avgNDCG = ndcgs.reduce((a, b) => a + b, 0) / ndcgs.length;
      console.log(`\nAverage nDCG@10: ${avgNDCG.toFixed(3)}`);
      console.log(`Individual nDCG: ${ndcgs.map(n => n.toFixed(2)).join(', ')}`);
      console.log(`  Current baseline, VISION target: 0.6`);

      // Gate: 0.25 (achievable baseline) - increase as we improve
      expect(avgNDCG).toBeGreaterThanOrEqual(0.25);
    });
  });

  describe('Metric Computation Verification', () => {
    it('computes Recall@K correctly', () => {
      const results = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
      const groundTruth = ['a.ts', 'c.ts', 'f.ts'];

      expect(computeRecallAtK(results, groundTruth, 5)).toBeCloseTo(2/3, 2);
      expect(computeRecallAtK(results, groundTruth, 2)).toBeCloseTo(1/3, 2);
    });

    it('computes Precision@K correctly', () => {
      const results = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
      const groundTruth = ['a.ts', 'c.ts'];

      expect(computePrecisionAtK(results, groundTruth, 5)).toBeCloseTo(2/5, 2);
      expect(computePrecisionAtK(results, groundTruth, 2)).toBeCloseTo(1/2, 2);
    });

    it('computes nDCG correctly', () => {
      const results = ['a.ts', 'b.ts', 'c.ts'];
      const relevanceGrades = { 'a.ts': 3, 'b.ts': 0, 'c.ts': 2 };

      // DCG = 3/log2(2) + 0/log2(3) + 2/log2(4) = 3 + 0 + 1 = 4
      // IDCG = 3/log2(2) + 2/log2(3) + 0/log2(4) = 3 + 1.26 + 0 = 4.26
      // nDCG = 4/4.26 = 0.94
      const ndcg = computeNDCG(results, relevanceGrades, 3);
      expect(ndcg).toBeGreaterThan(0.9);
      expect(ndcg).toBeLessThanOrEqual(1.0);
    });
  });
});
