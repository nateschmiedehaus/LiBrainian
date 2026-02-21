/**
 * @fileoverview Enhanced Retrieval Validation
 *
 * Tests the hybrid retrieval system that combines:
 * - Semantic embeddings (neural network)
 * - Keyword matching (exact terms)
 * - Structural signals (imports, exports, modules)
 *
 * Compares against basic embedding retrieval to measure improvement.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { checkAllProviders } from '../api/provider_check.js';
import {
  EnhancedRetrieval,
  expandQuery,
  extractMetadata,
  computeKeywordScore,
} from '../api/embedding_providers/enhanced_retrieval.js';
import {
  generateRealEmbedding,
  cosineSimilarity,
  type EmbeddingModelId,
} from '../api/embedding_providers/real_embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const librainianRoot = path.resolve(__dirname, '..');

// ============================================================================
// TEST CASES (same as before, to measure improvement)
// ============================================================================

interface TestCase {
  id: string;
  category: string;
  description: string;
  query: string;
  expectedTopFiles: string[];
}

const TEST_CASES: TestCase[] = [
  // Cases that PASSED with basic embeddings
  {
    id: 'ctx-1',
    category: 'Context Assembly',
    description: 'Find embedding-related code',
    query: 'generate semantic embeddings for code similarity search',
    expectedTopFiles: ['real_embeddings.ts', 'embeddings.ts'],
  },
  {
    id: 'ctx-2',
    category: 'Context Assembly',
    description: 'Find database storage code',
    query: 'SQLite database storage operations insert update delete query',
    expectedTopFiles: ['sqlite_storage.ts', 'types.ts'],
  },
  {
    id: 'know-1',
    category: 'Knowledge Retrieval',
    description: 'Find graph/dependency analysis code',
    query: 'graph metrics pagerank centrality dependencies call graph',
    expectedTopFiles: ['metrics.ts', 'pagerank.ts'],
  },

  // Cases that FAILED with basic embeddings - should improve
  {
    id: 'route-1',
    category: 'Agent Routing',
    description: 'Find code for routing tasks to agents',
    query: 'match task to agent based on expertise capabilities skills',
    expectedTopFiles: ['swarm_scheduler.ts', 'swarm_runner.ts'],
  },
  {
    id: 'route-2',
    category: 'Agent Routing',
    description: 'Find engine coordination code',
    query: 'relevance ranking scoring confidence engine query',
    expectedTopFiles: ['relevance_engine.ts', 'meta_engine.ts'],
  },
  {
    id: 'understand-1',
    category: 'Code Understanding',
    description: 'Find documentation parsing',
    query: 'parse markdown documentation readme extract sections',
    expectedTopFiles: ['docs_indexer.ts'],
  },

  // ADVERSARIAL cases - disambiguation needed
  {
    id: 'adv-1',
    category: 'Adversarial',
    description: 'Find storage types specifically',
    query: 'storage types LiBrainianStorage SQLite database interface',
    expectedTopFiles: ['storage/types.ts'],
  },
  {
    id: 'adv-2',
    category: 'Adversarial',
    description: 'Find engine types specifically',
    query: 'engine types RelevanceEngine ConstraintEngine interface',
    expectedTopFiles: ['engines/types.ts'],
  },
];

// ============================================================================
// FILE LOADING
// ============================================================================

async function loadFileCorpus(): Promise<Map<string, string>> {
  const corpus = new Map<string, string>();

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
          corpus.set(relativePath, content);
        } catch {
          // Skip
        }
      }
    }
  };

  await walkDir(librainianRoot);
  return corpus;
}

// ============================================================================
// TESTS
// ============================================================================

describe('Enhanced Retrieval Validation', () => {
  let corpus: Map<string, string>;
  let enhancedRetrieval: EnhancedRetrieval;
  let basicEmbeddings: Map<string, Float32Array>;
  let skipReason: string | null = null;

  const MODEL: EmbeddingModelId = 'all-MiniLM-L6-v2';

  beforeAll(async () => {
    const status = await checkAllProviders({ workspaceRoot: process.cwd() });
    if (!status.embedding.available) {
      skipReason = `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`;
      return;
    }

    console.log('\n' + '='.repeat(70));
    console.log('ENHANCED vs BASIC RETRIEVAL COMPARISON');
    console.log('='.repeat(70) + '\n');

    // Load corpus
    corpus = await loadFileCorpus();
    console.log(`Loaded ${corpus.size} files`);

    // Index with enhanced retrieval
    enhancedRetrieval = new EnhancedRetrieval(MODEL);
    console.log('Indexing with enhanced retrieval...');

    let i = 0;
    for (const [filePath, content] of corpus) {
      await enhancedRetrieval.indexDocument(filePath, content);
      i++;
      if (i % 20 === 0) {
        console.log(`  ${i}/${corpus.size} files indexed`);
      }
    }

    // Also generate basic embeddings for comparison
    console.log('Generating basic embeddings for comparison...');
    basicEmbeddings = new Map();

    for (const [filePath, content] of corpus) {
      const result = await generateRealEmbedding(content.slice(0, 2000), MODEL);
      basicEmbeddings.set(filePath, result.embedding);
    }

    console.log('Indexing complete\n');
  }, 600000);

  it('should demonstrate query expansion', () => {
    const testQueries = [
      'agent routing',
      'ast parser',
      'database query',
      'ml embedding',
    ];

    console.log('QUERY EXPANSION EXAMPLES:');
    console.log('-'.repeat(50));

    for (const query of testQueries) {
      const expanded = expandQuery(query);
      console.log(`"${query}" → "${expanded}"`);
    }
    console.log();

    expect(expandQuery('agent')).toContain('swarm');
    expect(expandQuery('ast')).toContain('abstract syntax tree');
  });

  it('should extract metadata correctly', () => {
    const testContent = `
import { foo } from './foo.js';
import { bar } from '../bar.js';

export class MyClass {
  async myMethod() {}
}

export function myFunction() {}

const myArrow = () => {};
`;

    const metadata = extractMetadata('test/example.ts', testContent);

    expect(metadata.moduleName).toBe('test');
    expect(metadata.imports).toContain('./foo.js');
    expect(metadata.exports).toContain('MyClass');
    expect(metadata.exports).toContain('myFunction');
    expect(metadata.classes).toContain('MyClass');
  });

  it('should compare enhanced vs basic retrieval', async (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    let enhancedHits = 0;
    let basicHits = 0;
    const totalExpected = TEST_CASES.length;

    console.log('='.repeat(70));
    console.log('RETRIEVAL COMPARISON');
    console.log('='.repeat(70) + '\n');

    for (const testCase of TEST_CASES) {
      // Enhanced retrieval
      const enhancedResults = await enhancedRetrieval.retrieve(testCase.query, { topK: 5 });
      const enhancedTop5 = enhancedResults.map((r) => r.filePath);

      // Basic retrieval
      const queryResult = await generateRealEmbedding(testCase.query, MODEL);
      const similarities: Array<{ file: string; score: number }> = [];

      for (const [filePath, embedding] of basicEmbeddings) {
        const score = cosineSimilarity(queryResult.embedding, embedding);
        similarities.push({ file: filePath, score });
      }
      similarities.sort((a, b) => b.score - a.score);
      const basicTop5 = similarities.slice(0, 5).map((s) => s.file);

      // Check hits
      const enhancedHit = testCase.expectedTopFiles.some((expected) =>
        enhancedTop5.some((f) => f.includes(expected.replace(/^.*\//, '')))
      );
      const basicHit = testCase.expectedTopFiles.some((expected) =>
        basicTop5.some((f) => f.includes(expected.replace(/^.*\//, '')))
      );

      if (enhancedHit) enhancedHits++;
      if (basicHit) basicHits++;

      const enhancedStatus = enhancedHit ? '✓' : '✗';
      const basicStatus = basicHit ? '✓' : '✗';

      console.log(`[${testCase.category}] ${testCase.id}: ${testCase.description}`);
      console.log(`  Expected: ${testCase.expectedTopFiles.join(', ')}`);
      console.log(`  Basic [${basicStatus}]:    ${basicTop5.slice(0, 3).join(', ')}`);
      console.log(`  Enhanced [${enhancedStatus}]: ${enhancedTop5.slice(0, 3).join(', ')}`);

      if (enhancedHit && !basicHit) {
        console.log(`  → IMPROVED by enhanced retrieval`);
      } else if (!enhancedHit && basicHit) {
        console.log(`  → REGRESSION in enhanced retrieval`);
      }
      console.log();
    }

    console.log('='.repeat(70));
    console.log(`BASIC HIT RATE:    ${(basicHits / totalExpected * 100).toFixed(1)}% (${basicHits}/${totalExpected})`);
    console.log(`ENHANCED HIT RATE: ${(enhancedHits / totalExpected * 100).toFixed(1)}% (${enhancedHits}/${totalExpected})`);

    const improvement = enhancedHits - basicHits;
    if (improvement > 0) {
      console.log(`IMPROVEMENT: +${improvement} cases`);
    } else if (improvement < 0) {
      console.log(`REGRESSION: ${improvement} cases`);
    } else {
      console.log(`NO CHANGE`);
    }
    console.log('='.repeat(70) + '\n');

    // Enhanced should be at least as good as basic
    expect(enhancedHits).toBeGreaterThanOrEqual(basicHits);
  }, 300000);

  it('should show detailed scoring breakdown', async (ctx) => {
    ctx.skip(skipReason !== null, skipReason ?? undefined);
    const query = 'match task to agent based on expertise skills';

    console.log('DETAILED SCORING BREAKDOWN');
    console.log(`Query: "${query}"`);
    console.log('-'.repeat(70));

    const results = await enhancedRetrieval.retrieve(query, { topK: 10 });

    console.log(
      'Rank | File                              | Semantic | Keyword | Struct | Final'
    );
    console.log('-'.repeat(85));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const fileName = r.filePath.slice(-35).padStart(35);
      console.log(
        `${String(i + 1).padStart(4)} | ${fileName} | ${r.semanticScore.toFixed(4)}   | ${r.keywordScore.toFixed(4)}  | ${r.structuralBoost.toFixed(4)} | ${r.finalScore.toFixed(4)}`
      );
    }
    console.log();

    expect(results.length).toBeGreaterThan(0);
  }, 60000);
});
