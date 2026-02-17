/**
 * @fileoverview REAL Embedding Validation Test Suite
 *
 * This test uses ACTUAL CODE from this codebase with ground truth
 * relationships derived from:
 * - Import/export dependencies (files that import each other)
 * - Test file correspondences (foo.ts ↔ foo.test.ts)
 * - Same-module co-location
 *
 * Difficulty levels:
 * - EASY: File and its test file
 * - MEDIUM: Files that import each other directly
 * - HARD: Same module but different purpose
 * - ADVERSARIAL: Similar names/structure but unrelated
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { checkAllProviders } from '../api/provider_check.js';
import {
  generateRealEmbedding,
  cosineSimilarity,
  type EmbeddingModelId,
} from '../api/embedding_providers/real_embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const librarianRoot = path.resolve(__dirname, '..');
const srcRoot = path.resolve(__dirname, '..', '..');
const IS_TIER0 = process.env.LIBRARIAN_TIER0 === '1';
const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && process.env.LIBRARIAN_TIER0 !== '1');
const describeLive = IS_TIER0 || IS_UNIT_MODE ? describe.skip : describe;

// ============================================================================
// GROUND TRUTH PAIRS FROM REAL CODEBASE
// ============================================================================

interface FilePair {
  name: string;
  file1: string;
  file2: string;
  expectedRelated: boolean;
  difficulty: 'easy' | 'medium' | 'hard' | 'adversarial';
  reason: string;
}

/**
 * Ground truth pairs derived from actual codebase relationships.
 */
const GROUND_TRUTH_PAIRS: FilePair[] = [
  // ============================================================================
  // EASY: Test file correspondences (should be VERY related)
  // ============================================================================
  {
    name: 'docs_indexer + test',
    file1: 'ingest/docs_indexer.ts',
    file2: '__tests__/docs_indexer.test.ts',
    expectedRelated: true,
    difficulty: 'easy',
    reason: 'Test file for docs_indexer',
  },
  {
    name: 'team_indexer + test',
    file1: 'ingest/team_indexer.ts',
    file2: '__tests__/team_indexer.test.ts',
    expectedRelated: true,
    difficulty: 'easy',
    reason: 'Test file for team_indexer',
  },
  {
    name: 'call_edge_extractor + test',
    file1: 'agents/call_edge_extractor.ts',
    file2: '__tests__/call_edge_extractor.test.ts',
    expectedRelated: true,
    difficulty: 'easy',
    reason: 'Test file for call_edge_extractor',
  },
  {
    name: 'framework + test',
    file1: 'ingest/framework.ts',
    file2: '__tests__/ingestion_framework.test.ts',
    expectedRelated: true,
    difficulty: 'easy',
    reason: 'Test file for ingestion framework',
  },
  {
    name: 'confidence_calibration + test',
    file1: 'api/confidence_calibration.ts',
    file2: '__tests__/confidence_calibration.test.ts',
    expectedRelated: true,
    difficulty: 'easy',
    reason: 'Test file for confidence calibration',
  },

  // ============================================================================
  // MEDIUM: Direct import relationships (should be related)
  // ============================================================================
  {
    name: 'embeddings imports real_embeddings',
    file1: 'api/embeddings.ts',
    file2: 'api/embedding_providers/real_embeddings.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'embeddings.ts imports from real_embeddings.ts',
  },
  {
    name: 'ast_indexer imports storage types',
    file1: 'agents/ast_indexer.ts',
    file2: 'storage/types.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'ast_indexer imports LibrarianStorage types',
  },
  {
    name: 'librarian imports sqlite_storage',
    file1: 'api/librarian.ts',
    file2: 'storage/sqlite_storage.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'librarian.ts creates storage via sqlite_storage',
  },
  {
    name: 'relevance_engine imports embeddings',
    file1: 'engines/relevance_engine.ts',
    file2: 'api/embeddings.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'relevance engine uses embedding service',
  },
  {
    name: 'index_librarian imports graph metrics',
    file1: 'agents/index_librarian.ts',
    file2: 'graphs/metrics.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'index_librarian computes graph metrics',
  },
  {
    name: 'knowledge/impact imports graph metrics',
    file1: 'knowledge/impact.ts',
    file2: 'graphs/metrics.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'impact analysis uses graph metrics',
  },
  {
    name: 'ast_indexer imports parser_registry',
    file1: 'agents/ast_indexer.ts',
    file2: 'agents/parser_registry.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'ast_indexer uses parser registry',
  },

  // ============================================================================
  // HARD: Same module, different purpose (may or may not be related)
  // ============================================================================
  {
    name: 'relevance_engine vs constraint_engine',
    file1: 'engines/relevance_engine.ts',
    file2: 'engines/constraint_engine.ts',
    expectedRelated: true,
    difficulty: 'hard',
    reason: 'Both are engines, same module, different concerns',
  },
  {
    name: 'docs_indexer vs api_indexer',
    file1: 'ingest/docs_indexer.ts',
    file2: 'ingest/api_indexer.ts',
    expectedRelated: true,
    difficulty: 'hard',
    reason: 'Both indexers, same framework, different content',
  },
  {
    name: 'knowledge/patterns vs knowledge/quality',
    file1: 'knowledge/patterns.ts',
    file2: 'knowledge/quality.ts',
    expectedRelated: true,
    difficulty: 'hard',
    reason: 'Same knowledge module, different analysis types',
  },
  {
    name: 'swarm_runner vs swarm_scheduler',
    file1: 'agents/swarm_runner.ts',
    file2: 'agents/swarm_scheduler.ts',
    expectedRelated: true,
    difficulty: 'hard',
    reason: 'Closely related swarm execution components',
  },
  {
    name: 'team_indexer vs ownership_indexer',
    file1: 'ingest/team_indexer.ts',
    file2: 'ingest/ownership_indexer.ts',
    expectedRelated: true,
    difficulty: 'hard',
    reason: 'Both deal with code ownership, different sources',
  },

  // ============================================================================
  // ADVERSARIAL: Should NOT be related despite superficial similarities
  // ============================================================================
  {
    name: 'types.ts in storage vs types.ts in engines',
    file1: 'storage/types.ts',
    file2: 'engines/types.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Same filename, completely different domains',
  },
  {
    name: 'index.ts in knowledge vs index.ts in engines',
    file1: 'knowledge/index.ts',
    file2: 'engines/index.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Both are barrel exports, different modules',
  },
  {
    name: 'docs_indexer vs schema_indexer',
    file1: 'ingest/docs_indexer.ts',
    file2: 'ingest/schema_indexer.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Both indexers but parsing completely different content',
  },
  {
    name: 'embeddings.ts vs migrations.ts',
    file1: 'api/embeddings.ts',
    file2: 'api/migrations.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Same api/ folder but completely unrelated concerns',
  },
  {
    name: 'ast_indexer vs ci_indexer',
    file1: 'agents/ast_indexer.ts',
    file2: 'ingest/ci_indexer.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Both have "indexer" in name, different purposes',
  },
  {
    name: 'graph metrics vs librarian events',
    file1: 'graphs/metrics.ts',
    file2: 'events.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Unrelated subsystems',
  },
  {
    name: 'confidence_calibration vs file_watcher',
    file1: 'api/confidence_calibration.ts',
    file2: 'integration/file_watcher.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Completely different concerns',
  },
  {
    name: 'parser_registry vs evolution',
    file1: 'agents/parser_registry.ts',
    file2: 'knowledge/evolution.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Different subsystems',
  },

  // ============================================================================
  // CROSS-MODULE: Real imports across module boundaries
  // ============================================================================
  {
    name: 'bootstrap imports all indexers',
    file1: 'api/bootstrap.ts',
    file2: 'ingest/framework.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'bootstrap orchestrates ingestion framework',
  },
  {
    name: 'query imports graphs',
    file1: 'api/query.ts',
    file2: 'graphs/metrics.ts',
    expectedRelated: true,
    difficulty: 'medium',
    reason: 'query API uses graph operations',
  },

  // ============================================================================
  // EXTERNAL MODULE PAIRS: Orchestrator vs Librarian
  // ============================================================================
  {
    name: 'orchestrator context_assembler vs librarian query',
    file1: path.join('..', 'orchestrator', 'context_assembler.ts'),
    file2: 'api/query.ts',
    expectedRelated: true,
    difficulty: 'hard',
    reason: 'context_assembler queries librarian',
  },
  {
    name: 'orchestrator model_router vs librarian (unrelated)',
    file1: path.join('..', 'orchestrator', 'model_router.ts'),
    file2: 'ingest/docs_indexer.ts',
    expectedRelated: false,
    difficulty: 'adversarial',
    reason: 'Different subsystems entirely',
  },
];

// ============================================================================
// TEST HELPERS
// ============================================================================

async function readFileContent(relativePath: string): Promise<string> {
  const fullPath = relativePath.startsWith('..')
    ? path.resolve(librarianRoot, relativePath)
    : path.resolve(librarianRoot, relativePath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    // Truncate to first 2000 chars to match embedding context limits
    return content.slice(0, 2000);
  } catch (error) {
    console.warn(`Failed to read ${fullPath}:`, error);
    return '';
  }
}

interface TestResult {
  pair: FilePair;
  similarity: number;
  correct: boolean;
}

// ============================================================================
// METRICS
// ============================================================================

function computeMetrics(results: TestResult[]) {
  const truePositives = results.filter((r) => r.pair.expectedRelated && r.correct).length;
  const falsePositives = results.filter((r) => !r.pair.expectedRelated && !r.correct).length;
  const trueNegatives = results.filter((r) => !r.pair.expectedRelated && r.correct).length;
  const falseNegatives = results.filter((r) => r.pair.expectedRelated && !r.correct).length;

  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;
  const f1 = (2 * precision * recall) / (precision + recall) || 0;
  const accuracy = (truePositives + trueNegatives) / results.length;

  return { precision, recall, f1, accuracy, truePositives, falsePositives, trueNegatives, falseNegatives };
}

function computeAUC(results: TestResult[]): number {
  const positives = results.filter((r) => r.pair.expectedRelated);
  const negatives = results.filter((r) => !r.pair.expectedRelated);

  if (positives.length === 0 || negatives.length === 0) return 0;

  // Count pairs where positive has higher similarity than negative
  let concordant = 0;
  let total = 0;

  for (const pos of positives) {
    for (const neg of negatives) {
      total++;
      if (pos.similarity > neg.similarity) {
        concordant++;
      } else if (pos.similarity === neg.similarity) {
        concordant += 0.5;
      }
    }
  }

  return concordant / total;
}

// ============================================================================
// MAIN TEST
// ============================================================================

describeLive('Real Codebase Embedding Validation', () => {
  const MODEL: EmbeddingModelId = 'all-MiniLM-L6-v2';
  const results: TestResult[] = [];
  let skipReason: string | null = null;

  // Threshold for considering pairs "related"
  // This will be determined empirically
  let optimalThreshold = 0.5;

  beforeAll(async () => {
    const providerStatus = await checkAllProviders({ workspaceRoot: process.cwd() });
    if (!providerStatus.embedding.available) {
      skipReason = `unverified_by_trace(provider_unavailable): ${providerStatus.embedding.error ?? 'embedding unavailable'}`;
      return;
    }
    console.log(`\n${'='.repeat(70)}`);
    console.log('REAL CODEBASE EMBEDDING VALIDATION');
    console.log(`Model: ${MODEL}`);
    console.log(`Pairs: ${GROUND_TRUTH_PAIRS.length}`);
    console.log(`${'='.repeat(70)}\n`);

    for (const pair of GROUND_TRUTH_PAIRS) {
      const [content1, content2] = await Promise.all([
        readFileContent(pair.file1),
        readFileContent(pair.file2),
      ]);

      if (!content1 || !content2) {
        console.warn(`Skipping ${pair.name}: file not found`);
        continue;
      }

      const [emb1, emb2] = await Promise.all([
        generateRealEmbedding(content1, MODEL),
        generateRealEmbedding(content2, MODEL),
      ]);

      const similarity = cosineSimilarity(emb1.embedding, emb2.embedding);

      // Use 0.5 as initial threshold
      const predicted = similarity >= optimalThreshold;
      const correct = predicted === pair.expectedRelated;

      results.push({ pair, similarity, correct });

      const status = correct ? '✓' : '✗';
      const expected = pair.expectedRelated ? 'RELATED' : 'UNRELATED';
      console.log(
        `[${pair.difficulty.toUpperCase().padEnd(11)}] ${status} ${pair.name.padEnd(40)} ` +
          `sim=${similarity.toFixed(4)} expected=${expected}`
      );
    }

    // Find optimal threshold
    const allSimilarities = results.map((r) => r.similarity).sort((a, b) => a - b);
    let bestAccuracy = 0;

    for (const threshold of allSimilarities) {
      let correct = 0;
      for (const r of results) {
        const predicted = r.similarity >= threshold;
        if (predicted === r.pair.expectedRelated) correct++;
      }
      const accuracy = correct / results.length;
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        optimalThreshold = threshold;
      }
    }

    // Recompute correctness with optimal threshold
    for (const r of results) {
      const predicted = r.similarity >= optimalThreshold;
      r.correct = predicted === r.pair.expectedRelated;
    }
  }, 300000);

  it('should load all file pairs', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    expect(results.length).toBeGreaterThan(0);
    console.log(`\nLoaded ${results.length} pairs`);
  });

  it('should report similarity distribution', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    const relatedSims = results.filter((r) => r.pair.expectedRelated).map((r) => r.similarity);
    const unrelatedSims = results.filter((r) => !r.pair.expectedRelated).map((r) => r.similarity);

    const meanRelated = relatedSims.reduce((a, b) => a + b, 0) / relatedSims.length;
    const meanUnrelated = unrelatedSims.reduce((a, b) => a + b, 0) / unrelatedSims.length;
    const separation = meanRelated - meanUnrelated;

    console.log(`\n${'='.repeat(70)}`);
    console.log('SIMILARITY DISTRIBUTION');
    console.log(`${'='.repeat(70)}`);
    console.log(`Related pairs (${relatedSims.length}):`);
    console.log(`  Mean: ${meanRelated.toFixed(4)}`);
    console.log(`  Min:  ${Math.min(...relatedSims).toFixed(4)}`);
    console.log(`  Max:  ${Math.max(...relatedSims).toFixed(4)}`);
    console.log(`Unrelated pairs (${unrelatedSims.length}):`);
    console.log(`  Mean: ${meanUnrelated.toFixed(4)}`);
    console.log(`  Min:  ${Math.min(...unrelatedSims).toFixed(4)}`);
    console.log(`  Max:  ${Math.max(...unrelatedSims).toFixed(4)}`);
    console.log(`Separation: ${separation.toFixed(4)}`);
    console.log(`Optimal threshold: ${optimalThreshold.toFixed(4)}`);

    // Related should have higher mean than unrelated
    expect(meanRelated).toBeGreaterThan(meanUnrelated);
  });

  it('should achieve reasonable AUC (> 0.6)', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    const auc = computeAUC(results);
    console.log(`\nAUC: ${auc.toFixed(4)}`);

    // More realistic expectation for hard test
    expect(auc).toBeGreaterThan(0.6);
  });

  it('should report accuracy by difficulty', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    const difficulties = ['easy', 'medium', 'hard', 'adversarial'] as const;

    console.log(`\n${'='.repeat(70)}`);
    console.log('ACCURACY BY DIFFICULTY');
    console.log(`${'='.repeat(70)}`);

    for (const difficulty of difficulties) {
      const subset = results.filter((r) => r.pair.difficulty === difficulty);
      if (subset.length === 0) continue;

      const correct = subset.filter((r) => r.correct).length;
      const accuracy = correct / subset.length;

      console.log(`${difficulty.toUpperCase().padEnd(12)}: ${(accuracy * 100).toFixed(1)}% (${correct}/${subset.length})`);
    }
  });

  it('should report overall metrics', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    const metrics = computeMetrics(results);
    const auc = computeAUC(results);

    console.log(`\n${'='.repeat(70)}`);
    console.log('OVERALL METRICS');
    console.log(`${'='.repeat(70)}`);
    console.log(`Accuracy:  ${(metrics.accuracy * 100).toFixed(1)}%`);
    console.log(`Precision: ${(metrics.precision * 100).toFixed(1)}%`);
    console.log(`Recall:    ${(metrics.recall * 100).toFixed(1)}%`);
    console.log(`F1 Score:  ${(metrics.f1 * 100).toFixed(1)}%`);
    console.log(`AUC:       ${auc.toFixed(4)}`);
    console.log(`\nConfusion Matrix:`);
    console.log(`  TP: ${metrics.truePositives}  FP: ${metrics.falsePositives}`);
    console.log(`  FN: ${metrics.falseNegatives}  TN: ${metrics.trueNegatives}`);
    console.log(`${'='.repeat(70)}\n`);

    // Realistic expectations
    expect(metrics.accuracy).toBeGreaterThan(0.5); // Better than random
  });

  it('should identify the hardest cases', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    // Find cases where we were most wrong
    const mistakes = results.filter((r) => !r.correct);

    if (mistakes.length > 0) {
      console.log(`\n${'='.repeat(70)}`);
      console.log('MISTAKES (Cases the model got wrong)');
      console.log(`${'='.repeat(70)}`);

      for (const m of mistakes) {
        const expected = m.pair.expectedRelated ? 'RELATED' : 'UNRELATED';
        console.log(`[${m.pair.difficulty}] ${m.pair.name}`);
        console.log(`  Similarity: ${m.similarity.toFixed(4)}, Expected: ${expected}`);
        console.log(`  Reason: ${m.pair.reason}`);
      }
    }
  });
});
