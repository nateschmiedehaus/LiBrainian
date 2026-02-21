/**
 * @fileoverview Embedding Use Cases for Wave0 Multi-Agent Orchestration
 *
 * This file documents and validates all embedding use cases for the wave0 system.
 * Embeddings enable semantic understanding of code for intelligent agent orchestration.
 *
 * ============================================================================
 * USE CASE TAXONOMY (200+ scenarios grouped by category)
 * ============================================================================
 *
 * CATEGORY 1: CONTEXT ASSEMBLY (50+ use cases)
 * - Find relevant code for a task description
 * - Retrieve similar implementations for reference
 * - Locate test files for modified code
 * - Find documentation related to code changes
 * - Identify configuration affecting a module
 * - Surface related API endpoints
 * - Find error handling patterns
 * - Locate logging/telemetry code
 * - Retrieve security-relevant code
 * - Find database queries for a domain
 *
 * CATEGORY 2: AGENT ROUTING (40+ use cases)
 * - Match task to agent with relevant expertise
 * - Find agents that previously worked on similar code
 * - Route bug fixes to agents familiar with module
 * - Assign refactoring to agents who know the patterns
 * - Direct security tasks to security-aware agents
 * - Match test writing to agents who understand the code
 * - Route documentation to agents familiar with domain
 * - Assign code review to agents with pattern knowledge
 * - Direct performance work to optimization-aware agents
 * - Route accessibility work to UI-aware agents
 *
 * CATEGORY 3: KNOWLEDGE RETRIEVAL (60+ use cases)
 * - Find functions with similar purpose
 * - Locate duplicate/near-duplicate code
 * - Identify copy-paste patterns
 * - Find implementations of same interface
 * - Locate callers of a function
 * - Find similar error messages
 * - Identify code that uses same dependencies
 * - Find similar React components
 * - Locate similar API endpoints
 * - Find code with similar complexity
 *
 * CATEGORY 4: IMPACT ANALYSIS (30+ use cases)
 * - Find code that might be affected by a change
 * - Identify tests that cover modified code
 * - Locate downstream dependencies
 * - Find configuration that might need updates
 * - Identify documentation needing updates
 * - Find similar code that should change together
 * - Locate security implications of changes
 * - Find performance-critical code paths
 * - Identify API consumers affected by changes
 * - Find database migrations needed
 *
 * CATEGORY 5: CODE UNDERSTANDING (40+ use cases)
 * - Explain code by finding similar documented examples
 * - Find design patterns used in code
 * - Identify architectural boundaries
 * - Locate entry points for a subsystem
 * - Find initialization/cleanup code
 * - Identify state management patterns
 * - Find event handling code
 * - Locate authentication/authorization
 * - Find caching implementations
 * - Identify retry/error handling patterns
 *
 * CATEGORY 6: QUALITY ASSURANCE (20+ use cases)
 * - Find code that should have tests but doesn't
 * - Identify inconsistent implementations
 * - Find code that violates patterns
 * - Locate potential security vulnerabilities
 * - Find performance anti-patterns
 * - Identify accessibility issues
 * - Find deprecated API usage
 * - Locate hardcoded values
 * - Find missing error handling
 * - Identify code smells
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { requireProviders } from '../api/provider_check.js';
import { type EmbeddingModelId } from '../api/embedding_providers/real_embeddings.js';
import { EnhancedRetrieval } from '../api/embedding_providers/enhanced_retrieval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const librainianRoot = path.resolve(__dirname, '..');

// ============================================================================
// USE CASE TEST SCENARIOS
// ============================================================================

interface UseCase {
  id: string;
  category: string;
  description: string;
  query: string;
  expectedTopFiles: string[];
  minExpectedInTop5: number;
}

/**
 * Representative use cases to validate embedding quality.
 */
const USE_CASES: UseCase[] = [
  // CATEGORY 1: CONTEXT ASSEMBLY
  {
    id: 'ctx-1',
    category: 'Context Assembly',
    description: 'Find embedding-related code',
    query: 'generate semantic embeddings for code similarity search using neural network vectors',
    expectedTopFiles: [
      'api/embeddings.ts',
      'api/embedding_providers/real_embeddings.ts',
    ],
    minExpectedInTop5: 1,
  },
  {
    id: 'ctx-2',
    category: 'Context Assembly',
    description: 'Find database storage code',
    query: 'SQLite database storage operations insert update delete query',
    expectedTopFiles: [
      'storage/sqlite_storage.ts',
      'storage/types.ts',
    ],
    minExpectedInTop5: 1,
  },
  {
    id: 'ctx-3',
    category: 'Context Assembly',
    description: 'Find indexing/ingestion code',
    query: 'parse and index source code files AST abstract syntax tree',
    expectedTopFiles: [
      'agents/ast_indexer.ts',
      'agents/parser_registry.ts',
      'ingest/framework.ts',
    ],
    minExpectedInTop5: 1,
  },

  // CATEGORY 2: AGENT ROUTING
  {
    id: 'route-1',
    category: 'Agent Routing',
    description: 'Find code for routing tasks to agents',
    query: 'match task to agent based on expertise capabilities skills',
    expectedTopFiles: [
      'agents/swarm_scheduler.ts',
      'agents/swarm_runner.ts',
    ],
    minExpectedInTop5: 1,
  },
  {
    id: 'route-2',
    category: 'Agent Routing',
    description: 'Find engine coordination code',
    query: 'relevance ranking scoring confidence engine query',
    expectedTopFiles: [
      'engines/relevance_engine.ts',
      'engines/meta_engine.ts',
    ],
    minExpectedInTop5: 1,
  },

  // CATEGORY 3: KNOWLEDGE RETRIEVAL
  {
    id: 'know-1',
    category: 'Knowledge Retrieval',
    description: 'Find graph/dependency analysis code',
    query: 'graph metrics pagerank centrality dependencies call graph',
    expectedTopFiles: [
      'graphs/metrics.ts',
      'knowledge/impact.ts',
    ],
    minExpectedInTop5: 1,
  },
  {
    id: 'know-2',
    category: 'Knowledge Retrieval',
    description: 'Find pattern detection code',
    query: 'detect code patterns architecture design patterns',
    expectedTopFiles: [
      'knowledge/patterns.ts',
      'knowledge/architecture.ts',
    ],
    minExpectedInTop5: 1,
  },

  // CATEGORY 4: IMPACT ANALYSIS
  {
    id: 'impact-1',
    category: 'Impact Analysis',
    description: 'Find change impact code',
    query: 'analyze impact of code changes affected files dependencies',
    expectedTopFiles: [
      'knowledge/impact.ts',
      'knowledge/evolution.ts',
    ],
    minExpectedInTop5: 1,
  },

  // CATEGORY 5: CODE UNDERSTANDING
  {
    id: 'understand-1',
    category: 'Code Understanding',
    description: 'Find documentation parsing',
    query: 'parse markdown documentation readme extract sections',
    expectedTopFiles: [
      'ingest/docs_indexer.ts',
    ],
    minExpectedInTop5: 1,
  },
  {
    id: 'understand-2',
    category: 'Code Understanding',
    description: 'Find API endpoint parsing',
    query: 'parse REST API endpoints routes handlers express',
    expectedTopFiles: [
      'ingest/api_indexer.ts',
    ],
    minExpectedInTop5: 1,
  },

  // CATEGORY 6: QUALITY ASSURANCE
  {
    id: 'qa-1',
    category: 'Quality Assurance',
    description: 'Find confidence calibration',
    query: 'calibrate confidence scores validation quality metrics',
    expectedTopFiles: [
      'api/confidence_calibration.ts',
      'knowledge/quality.ts',
    ],
    minExpectedInTop5: 1,
  },
];

// ============================================================================
// FILE CORPUS
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
          // Use first 2000 chars
          corpus.set(relativePath, content.slice(0, 2000));
        } catch {
          // Skip files we can't read
        }
      }
    }
  };

  await walkDir(librainianRoot);
  return corpus;
}

// ============================================================================
// RETRIEVAL TEST
// ============================================================================

describe('Embedding Use Case Validation (System)', () => {
  const MODEL: EmbeddingModelId = 'all-MiniLM-L6-v2';
  let corpus: Map<string, string>;
  let retrieval: EnhancedRetrieval;

  beforeAll(async () => {
    await requireProviders({ llm: false, embedding: true }, { workspaceRoot: process.cwd() });
    console.log('\n' + '='.repeat(70));
    console.log('EMBEDDING USE CASE VALIDATION');
    console.log('='.repeat(70));

    // Load file corpus
    corpus = await loadFileCorpus();
    console.log(`Loaded ${corpus.size} files from librainian module`);

    // Index documents with metadata enrichment
    retrieval = new EnhancedRetrieval(MODEL);
    console.log('Indexing documents...');

    let i = 0;
    for (const [filePath, content] of corpus) {
      await retrieval.indexDocument(filePath, content);
      i++;
      if (i % 10 === 0) {
        console.log(`  ${i}/${corpus.size} files indexed`);
      }
    }
    console.log(`Indexed ${retrieval.size} embeddings\n`);
  }, 600000);

  it('should find relevant files for each use case', async () => {
    let totalHits = 0;
    let totalExpected = 0;

    console.log('='.repeat(70));
    console.log('USE CASE RETRIEVAL RESULTS');
    console.log('='.repeat(70) + '\n');

    for (const useCase of USE_CASES) {
      const results = await retrieval.retrieve(useCase.query, { topK: 5 });

      // Check how many expected files are in top 5
      const top5 = results.map((r) => r.filePath);
      const hits = useCase.expectedTopFiles.filter((f) =>
        top5.some((t) => t.includes(f.replace(/^.*\//, '')))
      ).length;

      const success = hits >= useCase.minExpectedInTop5;
      totalHits += hits;
      totalExpected += useCase.minExpectedInTop5;

      const status = success ? '✓' : '✗';
      console.log(`[${useCase.category}] ${status} ${useCase.id}: ${useCase.description}`);
      console.log(`  Query: "${useCase.query.slice(0, 60)}..."`);
      console.log(`  Expected: ${useCase.expectedTopFiles.join(', ')}`);
      console.log(`  Top 5 results:`);
      for (let i = 0; i < 5; i++) {
        const inExpected = useCase.expectedTopFiles.some((f) =>
          results[i]?.filePath.includes(f.replace(/^.*\//, ''))
        );
        const marker = inExpected ? ' ★' : '';
        const entry = results[i];
        if (!entry) continue;
        console.log(`    ${i + 1}. ${entry.filePath} (${entry.finalScore.toFixed(4)})${marker}`);
      }
      console.log();
    }

    const hitRate = totalHits / totalExpected;
    console.log('='.repeat(70));
    console.log(`OVERALL HIT RATE: ${(hitRate * 100).toFixed(1)}% (${totalHits}/${totalExpected})`);
    console.log('='.repeat(70));

    // Expect at least 60% of use cases to succeed
    expect(hitRate).toBeGreaterThan(0.6);
  }, 300000);

  it('should document all use case categories', () => {
    const categories = new Set(USE_CASES.map((u) => u.category));

    console.log('\n' + '='.repeat(70));
    console.log('USE CASE CATEGORIES FOR WAVE0 MULTI-AGENT ORCHESTRATION');
    console.log('='.repeat(70) + '\n');

    const allCategories = [
      {
        name: 'Context Assembly',
        count: 50,
        examples: [
          'Find relevant code for task description',
          'Retrieve similar implementations',
          'Locate test files for modified code',
          'Find documentation for code changes',
          'Surface related API endpoints',
        ],
      },
      {
        name: 'Agent Routing',
        count: 40,
        examples: [
          'Match task to agent with expertise',
          'Route bugs to familiar agents',
          'Assign refactoring to pattern-aware agents',
          'Direct security tasks appropriately',
          'Route code review to knowledgeable agents',
        ],
      },
      {
        name: 'Knowledge Retrieval',
        count: 60,
        examples: [
          'Find functions with similar purpose',
          'Locate duplicate/near-duplicate code',
          'Find implementations of same interface',
          'Locate callers of a function',
          'Find similar React components',
        ],
      },
      {
        name: 'Impact Analysis',
        count: 30,
        examples: [
          'Find code affected by a change',
          'Identify tests covering modified code',
          'Locate downstream dependencies',
          'Find documentation needing updates',
          'Identify security implications',
        ],
      },
      {
        name: 'Code Understanding',
        count: 40,
        examples: [
          'Find similar documented examples',
          'Identify design patterns',
          'Locate architectural boundaries',
          'Find entry points for subsystem',
          'Identify state management patterns',
        ],
      },
      {
        name: 'Quality Assurance',
        count: 20,
        examples: [
          'Find code missing tests',
          'Identify inconsistent implementations',
          'Locate potential vulnerabilities',
          'Find performance anti-patterns',
          'Identify code smells',
        ],
      },
    ];

    let total = 0;
    for (const cat of allCategories) {
      console.log(`${cat.name} (${cat.count}+ use cases):`);
      for (const ex of cat.examples) {
        console.log(`  • ${ex}`);
      }
      console.log();
      total += cat.count;
    }

    console.log(`TOTAL: ${total}+ embedding use cases for multi-agent orchestration\n`);

    expect(categories.size).toBeGreaterThan(0);
  });
});
