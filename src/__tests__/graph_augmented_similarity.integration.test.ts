/**
 * @fileoverview Test graph-augmented similarity on adversarial cases
 *
 * Tests whether adding structural signals (imports, modules) fixes
 * the false positive problem where structurally similar but
 * semantically different files have high embedding similarity.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { checkAllProviders } from '../api/provider_check.js';
import {
  DependencyGraph,
  computeGraphAugmentedSimilarity,
  isLikelyAdversarial,
  type FileNode,
} from '../api/embedding_providers/graph_augmented_similarity.js';
import {
  generateRealEmbedding,
  cosineSimilarity,
  type EmbeddingModelId,
} from '../api/embedding_providers/real_embeddings.js';
import { extractMetadata } from '../api/embedding_providers/enhanced_retrieval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const librainianRoot = path.resolve(__dirname, '..');

// ============================================================================
// ADVERSARIAL TEST CASES
// ============================================================================

interface AdversarialCase {
  name: string;
  file1: string;
  file2: string;
  expectedRelated: boolean;
  reason: string;
}

const ADVERSARIAL_CASES: AdversarialCase[] = [
  {
    name: 'types.ts in storage vs types.ts in engines',
    file1: 'storage/types.ts',
    file2: 'engines/types.ts',
    expectedRelated: false,
    reason: 'Same filename, completely different domains',
  },
  {
    name: 'index.ts in knowledge vs index.ts in engines',
    file1: 'knowledge/index.ts',
    file2: 'engines/index.ts',
    expectedRelated: false,
    reason: 'Both are barrel exports, different modules',
  },
  {
    name: 'docs_indexer vs schema_indexer',
    file1: 'ingest/docs_indexer.ts',
    file2: 'ingest/schema_indexer.ts',
    expectedRelated: false,
    reason: 'Both indexers but parsing completely different content',
  },
  {
    name: 'embeddings.ts vs migrations.ts',
    file1: 'api/embeddings.ts',
    file2: 'api/migrations.ts',
    expectedRelated: false,
    reason: 'Same api/ folder but completely unrelated concerns',
  },
  {
    name: 'ast_indexer vs ci_indexer',
    file1: 'agents/ast_indexer.ts',
    file2: 'ingest/ci_indexer.ts',
    expectedRelated: false,
    reason: 'Both have "indexer" in name, different purposes',
  },
  // TRUE POSITIVES - should remain high
  {
    name: 'embeddings.ts imports real_embeddings.ts',
    file1: 'api/embeddings.ts',
    file2: 'api/embedding_providers/real_embeddings.ts',
    expectedRelated: true,
    reason: 'Direct import relationship',
  },
  {
    name: 'relevance_engine vs constraint_engine',
    file1: 'engines/relevance_engine.ts',
    file2: 'engines/constraint_engine.ts',
    expectedRelated: true,
    reason: 'Same module, similar purpose',
  },
  {
    name: 'swarm_runner vs swarm_scheduler',
    file1: 'agents/swarm_runner.ts',
    file2: 'agents/swarm_scheduler.ts',
    expectedRelated: true,
    reason: 'Same module, related functionality',
  },
];

// ============================================================================
// HELPERS
// ============================================================================

async function loadFile(relativePath: string): Promise<string> {
  const fullPath = path.resolve(librainianRoot, relativePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return '';
  }
}

async function buildDependencyGraph(): Promise<DependencyGraph> {
  const graph = new DependencyGraph();

  const walkDir = async (dir: string, prefix: string = '') => {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('__')) {
          await walkDir(fullPath, relativePath);
        }
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const metadata = extractMetadata(relativePath, content);

          const node: FileNode = {
            filePath: relativePath,
            moduleName: metadata.moduleName,
            imports: metadata.imports,
            importedBy: [], // Will be computed by graph
            calls: [],
            calledBy: [],
          };

          graph.addNode(node);
        } catch {
          // Skip
        }
      }
    }
  };

  await walkDir(librainianRoot);
  return graph;
}

// ============================================================================
// TESTS
// ============================================================================

describe('Graph-Augmented Similarity', () => {
  let graph: DependencyGraph;
  let embeddings: Map<string, Float32Array>;
  const MODEL: EmbeddingModelId = 'all-MiniLM-L6-v2';
  let skipReason: string | null = null;

  beforeAll(async () => {
    const status = await checkAllProviders({ workspaceRoot: process.cwd() });
    if (!status.embedding.available) {
      skipReason = `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`;
      return;
    }

    console.log('\n' + '='.repeat(70));
    console.log('GRAPH-AUGMENTED SIMILARITY TEST');
    console.log('='.repeat(70) + '\n');

    // Build dependency graph
    console.log('Building dependency graph...');
    graph = await buildDependencyGraph();
    console.log(`Graph has ${graph.size} nodes\n`);

    // Generate embeddings for test files
    embeddings = new Map();
    const filesToEmbed = new Set<string>();

    for (const testCase of ADVERSARIAL_CASES) {
      filesToEmbed.add(testCase.file1);
      filesToEmbed.add(testCase.file2);
    }

    console.log(`Generating embeddings for ${filesToEmbed.size} files...`);
    for (const filePath of filesToEmbed) {
      const content = await loadFile(filePath);
      if (!content) throw new Error(`test_fixture_missing: ${filePath}`);
      const result = await generateRealEmbedding(content.slice(0, 2000), MODEL);
      embeddings.set(filePath, result.embedding);
    }
    console.log('Done\n');
  }, 300000);

  it('should detect adversarial cases', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    console.log('ADVERSARIAL DETECTION:');
    console.log('-'.repeat(70));

    let correctCount = 0;
    for (const testCase of ADVERSARIAL_CASES) {
      const emb1 = embeddings.get(testCase.file1);
      const emb2 = embeddings.get(testCase.file2);

      if (!emb1 || !emb2) {
        throw new Error(`test_fixture_missing_embedding: ${testCase.file1} or ${testCase.file2}`);
      }

      const semanticSim = cosineSimilarity(emb1, emb2);
      const graphProx = graph.computeGraphProximity(testCase.file1, testCase.file2);

      const detection = isLikelyAdversarial(
        testCase.file1,
        testCase.file2,
        semanticSim,
        graphProx
      );

      const expectedAdversarial = !testCase.expectedRelated;
      const correct = detection.isAdversarial === expectedAdversarial;
      const status = correct ? '✓' : '✗';
      if (correct) correctCount++;

      console.log(`[${status}] ${testCase.name}`);
      console.log(`    Semantic: ${semanticSim.toFixed(4)}, Graph: ${graphProx.toFixed(2)}`);
      console.log(`    Detected adversarial: ${detection.isAdversarial}`);
      if (detection.reason) {
        console.log(`    Reason: ${detection.reason}`);
      }
    }
    console.log();

    expect(correctCount).toBe(ADVERSARIAL_CASES.length);
  });

  it('should compute graph-augmented similarity', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    console.log('GRAPH-AUGMENTED SIMILARITY:');
    console.log('-'.repeat(70));
    console.log('File Pair                                    | Semantic | Graph | Module | Final | Expected');
    console.log('-'.repeat(100));

    let correct = 0;
    let total = 0;

    for (const testCase of ADVERSARIAL_CASES) {
      const emb1 = embeddings.get(testCase.file1);
      const emb2 = embeddings.get(testCase.file2);

      if (!emb1 || !emb2) {
        throw new Error(`test_fixture_missing_embedding: ${testCase.file1} or ${testCase.file2}`);
      }

      const semanticSim = cosineSimilarity(emb1, emb2);
      const graphProx = graph.computeGraphProximity(testCase.file1, testCase.file2);
      const moduleAff = graph.computeModuleAffinity(testCase.file1, testCase.file2);

      const result = computeGraphAugmentedSimilarity(semanticSim, graphProx, moduleAff, {
        fileA: testCase.file1,
        fileB: testCase.file2,
      });

      // Threshold: 0.4 for related
      const predictedRelated = result.finalSimilarity >= 0.4;
      const isCorrect = predictedRelated === testCase.expectedRelated;

      if (isCorrect) correct++;
      total++;

      const status = isCorrect ? '✓' : '✗';
      const expected = testCase.expectedRelated ? 'RELATED' : 'UNRELATED';

      console.log(
        `${status} ${testCase.name.slice(0, 42).padEnd(42)} | ` +
        `${semanticSim.toFixed(4)}   | ${graphProx.toFixed(2)}  | ${moduleAff.toFixed(2)}   | ` +
        `${result.finalSimilarity.toFixed(4)} | ${expected}`
      );
    }

    const accuracy = correct / total;
    console.log('-'.repeat(100));
    console.log(`ACCURACY: ${(accuracy * 100).toFixed(1)}% (${correct}/${total})`);
    console.log();

    expect(accuracy).toBeGreaterThan(0.7);
  });

  it('should show improvement over raw embeddings', (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    console.log('IMPROVEMENT ANALYSIS:');
    console.log('-'.repeat(70));

    let rawCorrect = 0;
    let graphCorrect = 0;
    let total = 0;

    for (const testCase of ADVERSARIAL_CASES) {
      const emb1 = embeddings.get(testCase.file1);
      const emb2 = embeddings.get(testCase.file2);

      if (!emb1 || !emb2) {
        throw new Error(`test_fixture_missing_embedding: ${testCase.file1} or ${testCase.file2}`);
      }

      const semanticSim = cosineSimilarity(emb1, emb2);
      const graphProx = graph.computeGraphProximity(testCase.file1, testCase.file2);
      const moduleAff = graph.computeModuleAffinity(testCase.file1, testCase.file2);

      const graphResult = computeGraphAugmentedSimilarity(semanticSim, graphProx, moduleAff, {
        fileA: testCase.file1,
        fileB: testCase.file2,
      });

      // Raw embedding prediction (threshold 0.5)
      const rawPrediction = semanticSim >= 0.5;
      const graphPrediction = graphResult.finalSimilarity >= 0.4;

      if (rawPrediction === testCase.expectedRelated) rawCorrect++;
      if (graphPrediction === testCase.expectedRelated) graphCorrect++;
      total++;
    }

    const rawAccuracy = rawCorrect / total;
    const graphAccuracy = graphCorrect / total;
    const improvement = graphAccuracy - rawAccuracy;

    console.log(`Raw Embedding Accuracy:     ${(rawAccuracy * 100).toFixed(1)}%`);
    console.log(`Graph-Augmented Accuracy:   ${(graphAccuracy * 100).toFixed(1)}%`);
    console.log(`Improvement:                +${(improvement * 100).toFixed(1)}%`);
    console.log();

    expect(graphAccuracy).toBeGreaterThan(rawAccuracy);
  });
});
