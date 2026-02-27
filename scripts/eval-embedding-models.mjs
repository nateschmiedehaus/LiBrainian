#!/usr/bin/env node
/**
 * @fileoverview Embedding Model Evaluation for Code Retrieval (#865)
 *
 * Evaluates candidate embedding models against the current all-MiniLM-L6-v2
 * baseline for code retrieval quality in LiBrainian.
 *
 * Metrics:
 *   - Recall@5 and Recall@10 for code retrieval test cases
 *   - Mean Reciprocal Rank (MRR)
 *   - Embedding latency per function
 *   - Context window utilization (truncation rate)
 *   - Semantic differentiation between unrelated code files
 *
 * Usage:
 *   node scripts/eval-embedding-models.mjs
 *
 * The script uses @huggingface/transformers v3 for local inference.
 * No API keys required.
 */

import { pipeline } from '@huggingface/transformers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// CANDIDATE MODELS
// ============================================================================

/**
 * Models to evaluate. Each must be available via @huggingface/transformers v3.
 *
 * Selection rationale:
 *   - all-MiniLM-L6-v2: current baseline (NL-trained, 256 tokens)
 *   - bge-small-en-v1.5: same dimension (384), 2x context (512 tokens), MTEB-ranked
 *   - jina-embeddings-v2-base-en: 8K context, good for full functions
 *   - nomic-embed-text-v1.5: 8K context, strong code performance on MTEB
 */
const CANDIDATE_MODELS = [
  {
    id: 'all-MiniLM-L6-v2',
    huggingfaceId: 'Xenova/all-MiniLM-L6-v2',
    dimension: 384,
    contextWindow: 256,
    description: 'Current baseline - NL sentence pairs, 256 tokens',
    isBaseline: true,
    // Note: @huggingface/transformers v3 uses dtype strings, not boolean quantized.
    // Use 'q8' for quantized or 'fp32' for full precision.
    quantized: false,
  },
  {
    id: 'bge-small-en-v1.5',
    huggingfaceId: 'Xenova/bge-small-en-v1.5',
    dimension: 384,
    contextWindow: 512,
    description: 'BGE small - MTEB top-ranked, 512 tokens, same dimension',
    isBaseline: false,
    // BGE models recommend prepending "Represent this sentence: " for retrieval
    queryPrefix: 'Represent this sentence: ',
    quantized: false,
  },
  {
    id: 'jina-embeddings-v2-base-en',
    huggingfaceId: 'Xenova/jina-embeddings-v2-base-en',
    dimension: 768,
    contextWindow: 8192,
    description: 'Jina v2 - 8K context, good for full files',
    isBaseline: false,
    quantized: false,
  },
  {
    id: 'nomic-embed-text-v1.5',
    huggingfaceId: 'nomic-ai/nomic-embed-text-v1.5',
    dimension: 768,
    contextWindow: 8192,
    description: 'Nomic v1.5 - 8K context, strong code MTEB scores',
    isBaseline: false,
    // Nomic models use task prefixes
    queryPrefix: 'search_query: ',
    documentPrefix: 'search_document: ',
    quantized: false,
  },
];

// ============================================================================
// CODE CORPUS - Representative functions from LiBrainian
// ============================================================================

/**
 * We read real source files from the project to build the embedding corpus.
 * Each entry maps a conceptual label to a file path (relative to project root)
 * and an optional function/section name.
 */
const CORPUS_FILES = [
  // Storage layer
  { label: 'sqlite_storage_init', file: 'src/storage/sqlite_storage.ts', desc: 'SQLite storage initialization and schema setup' },
  { label: 'storage_recovery', file: 'src/storage/storage_recovery.ts', desc: 'Storage recovery and repair logic' },
  { label: 'vector_index', file: 'src/storage/vector_index.ts', desc: 'Vector similarity index for embeddings' },
  { label: 'content_cache', file: 'src/storage/content_cache.ts', desc: 'Content caching layer for storage' },

  // Embedding pipeline
  { label: 'real_embeddings', file: 'src/api/embedding_providers/real_embeddings.ts', desc: 'Real embedding provider with model management' },
  { label: 'embeddings_service', file: 'src/api/embeddings.ts', desc: 'Embedding service with batching and retry' },
  { label: 'embedding_coverage', file: 'src/api/embedding_coverage.ts', desc: 'Embedding coverage tracking and reporting' },

  // CLI layer
  { label: 'cli_index_command', file: 'src/cli/commands/index.ts', desc: 'CLI index command - incremental file indexing' },
  { label: 'cli_query_command', file: 'src/cli/commands/query.ts', desc: 'CLI query command - semantic search interface' },
  { label: 'cli_bootstrap', file: 'src/cli/commands/bootstrap.ts', desc: 'CLI bootstrap command - workspace initialization' },
  { label: 'cli_doctor', file: 'src/cli/commands/doctor.ts', desc: 'CLI doctor command - health diagnostics' },
  { label: 'cli_status', file: 'src/cli/commands/status.ts', desc: 'CLI status command - workspace status' },

  // Query pipeline
  { label: 'query_api', file: 'src/api/query.ts', desc: 'Main query API with stage pipeline' },
  { label: 'query_synthesis', file: 'src/api/query_synthesis.ts', desc: 'Query synthesis with LLM integration' },
  { label: 'query_intent_patterns', file: 'src/api/query_intent_patterns.ts', desc: 'Query intent classification patterns' },
  { label: 'query_intent_targets', file: 'src/api/query_intent_targets.ts', desc: 'Query intent target resolution' },
  { label: 'retrieval_escalation', file: 'src/api/retrieval_escalation.ts', desc: 'Retrieval escalation depth logic' },
  { label: 'structured_generation', file: 'src/api/structured_generation.ts', desc: 'Structured output generation with LLM' },

  // Ingestion / parsing
  { label: 'symbol_extractor', file: 'src/ingest/symbol_extractor.ts', desc: 'TypeScript AST symbol extraction' },
  { label: 'polyglot_symbol_extractor', file: 'src/ingest/polyglot_symbol_extractor.ts', desc: 'Multi-language symbol extraction' },
  { label: 'entry_point_indexer', file: 'src/ingest/entry_point_indexer.ts', desc: 'Entry point detection and indexing' },

  // Constructions
  { label: 'feature_location', file: 'src/constructions/feature_location_advisor.ts', desc: 'Feature location advisor construction' },
  { label: 'refactoring_checker', file: 'src/constructions/refactoring_safety_checker.ts', desc: 'Refactoring safety checker construction' },
  { label: 'construction_registry', file: 'src/constructions/registry.ts', desc: 'Construction registry and discovery' },

  // Core API
  { label: 'librarian_api', file: 'src/api/librarian.ts', desc: 'Main LiBrainian API class' },
  { label: 'provider_gate', file: 'src/api/provider_gate.ts', desc: 'Provider availability gate' },
  { label: 'migrations', file: 'src/api/migrations.ts', desc: 'Database migration management' },

  // Adapters
  { label: 'llm_service', file: 'src/adapters/llm_service.ts', desc: 'LLM service adapter interface and resolution' },
  { label: 'cli_llm_service', file: 'src/adapters/cli_llm_service.ts', desc: 'CLI-based LLM service adapter' },

  // Utils
  { label: 'workspace_resolver', file: 'src/utils/workspace_resolver.ts', desc: 'Workspace root detection and resolution' },
  { label: 'provider_failures', file: 'src/utils/provider_failures.ts', desc: 'Provider failure tracking and diagnostics' },
];

// ============================================================================
// TEST CASES - Code retrieval queries with expected relevant files
// ============================================================================

const TEST_CASES = [
  {
    query: 'SQLite storage initialization',
    expectedLabels: ['sqlite_storage_init', 'storage_recovery', 'migrations'],
    category: 'storage',
  },
  {
    query: 'embedding pipeline and model loading',
    expectedLabels: ['real_embeddings', 'embeddings_service', 'embedding_coverage'],
    category: 'embeddings',
  },
  {
    query: 'CLI command routing and dispatch',
    expectedLabels: ['cli_index_command', 'cli_query_command', 'cli_bootstrap', 'cli_doctor', 'cli_status'],
    category: 'cli',
  },
  {
    query: 'TypeScript AST parsing and symbol extraction',
    expectedLabels: ['symbol_extractor', 'polyglot_symbol_extractor', 'entry_point_indexer'],
    category: 'parsing',
  },
  {
    query: 'query synthesis with LLM',
    expectedLabels: ['query_synthesis', 'structured_generation', 'llm_service'],
    category: 'synthesis',
  },
  {
    query: 'vector similarity search for code retrieval',
    expectedLabels: ['vector_index', 'real_embeddings', 'embeddings_service'],
    category: 'search',
  },
  {
    query: 'retrieval escalation and depth logic',
    expectedLabels: ['retrieval_escalation', 'query_api', 'query_intent_patterns'],
    category: 'retrieval',
  },
  {
    query: 'refactoring safety check construction',
    expectedLabels: ['refactoring_checker', 'feature_location', 'construction_registry'],
    category: 'constructions',
  },
  {
    query: 'workspace detection and root resolution',
    expectedLabels: ['workspace_resolver', 'cli_bootstrap', 'provider_gate'],
    category: 'workspace',
  },
  {
    query: 'database migration schema versioning',
    expectedLabels: ['migrations', 'sqlite_storage_init', 'storage_recovery'],
    category: 'migrations',
  },
  {
    query: 'cosine similarity between embeddings',
    expectedLabels: ['real_embeddings', 'vector_index', 'embeddings_service'],
    category: 'similarity',
  },
  {
    query: 'LLM provider availability and fallback',
    expectedLabels: ['provider_gate', 'llm_service', 'provider_failures'],
    category: 'providers',
  },
  {
    query: 'query intent classification and routing',
    expectedLabels: ['query_intent_patterns', 'query_intent_targets', 'query_api'],
    category: 'intent',
  },
  {
    query: 'bootstrap workspace indexing flow',
    expectedLabels: ['cli_bootstrap', 'librarian_api', 'cli_index_command'],
    category: 'bootstrap',
  },
  {
    query: 'embedding batch processing and concurrency',
    expectedLabels: ['embeddings_service', 'real_embeddings', 'embedding_coverage'],
    category: 'batching',
  },
];

// ============================================================================
// UTILITIES
// ============================================================================

function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Estimate token count using ~4 chars per token heuristic */
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

/**
 * Read the first N lines of a source file to get a representative code snippet.
 * We cap at ~200 lines to keep corpus manageable while capturing meaningful code.
 */
function readCodeSnippet(filePath, maxLines = 200) {
  const fullPath = path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  return lines.slice(0, maxLines).join('\n');
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// ============================================================================
// EVALUATION ENGINE
// ============================================================================

async function loadModel(modelConfig) {
  const startTime = performance.now();
  console.log(`  Loading ${modelConfig.id} (${modelConfig.huggingfaceId})...`);

  try {
    const pipe = await pipeline('feature-extraction', modelConfig.huggingfaceId, {
      // @huggingface/transformers v3 dtype: 'fp32', 'fp16', 'q8', 'q4', etc.
      // Use 'q8' for quantized models, 'fp32' for full precision.
      dtype: modelConfig.quantized ? 'q8' : 'fp32',
    });
    const loadTimeMs = performance.now() - startTime;
    console.log(`  Loaded ${modelConfig.id} in ${formatDuration(loadTimeMs)}`);
    return { pipe, loadTimeMs };
  } catch (error) {
    console.error(`  FAILED to load ${modelConfig.id}: ${error.message}`);
    return null;
  }
}

async function embedText(pipe, text, modelConfig, isQuery = false) {
  let inputText = text;
  if (isQuery && modelConfig.queryPrefix) {
    inputText = modelConfig.queryPrefix + text;
  } else if (!isQuery && modelConfig.documentPrefix) {
    inputText = modelConfig.documentPrefix + text;
  }

  const output = await pipe(inputText, { pooling: 'mean', normalize: true });
  // output.data is a Float32Array (or TypedArray)
  return Array.from(output.data);
}

async function evaluateModel(modelConfig, corpus) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Evaluating: ${modelConfig.id}`);
  console.log(`  ${modelConfig.description}`);
  console.log(`  Dimension: ${modelConfig.dimension}, Context: ${modelConfig.contextWindow} tokens`);
  console.log(`${'='.repeat(70)}`);

  // Load model
  const loaded = await loadModel(modelConfig);
  if (!loaded) {
    return {
      modelId: modelConfig.id,
      error: 'Failed to load model',
      skipped: true,
    };
  }

  const { pipe, loadTimeMs } = loaded;

  // Embed corpus
  console.log(`  Embedding ${corpus.length} code functions...`);
  const corpusEmbeddings = [];
  let totalEmbedTimeMs = 0;
  let truncatedCount = 0;

  for (const entry of corpus) {
    const tokenEst = estimateTokens(entry.content);
    if (tokenEst > modelConfig.contextWindow) {
      truncatedCount++;
    }

    const startTime = performance.now();
    try {
      const embedding = await embedText(pipe, entry.content, modelConfig, false);
      const embedTimeMs = performance.now() - startTime;
      totalEmbedTimeMs += embedTimeMs;
      corpusEmbeddings.push({
        label: entry.label,
        embedding,
        tokenEstimate: tokenEst,
        embedTimeMs,
      });
    } catch (error) {
      console.error(`  Failed to embed ${entry.label}: ${error.message}`);
      corpusEmbeddings.push({
        label: entry.label,
        embedding: null,
        tokenEstimate: tokenEst,
        embedTimeMs: 0,
        error: error.message,
      });
    }
  }

  const avgEmbedTimeMs = totalEmbedTimeMs / corpus.length;
  const truncationRate = truncatedCount / corpus.length;
  console.log(`  Corpus embedded in ${formatDuration(totalEmbedTimeMs)} (avg ${formatDuration(avgEmbedTimeMs)}/function)`);
  console.log(`  Truncation: ${truncatedCount}/${corpus.length} functions exceed context window (${formatPercent(truncationRate)})`);

  // Evaluate retrieval on test cases
  console.log(`  Running ${TEST_CASES.length} retrieval test cases...`);
  const testResults = [];
  let totalQueryTimeMs = 0;

  for (const testCase of TEST_CASES) {
    const queryStart = performance.now();
    const queryEmbedding = await embedText(pipe, testCase.query, modelConfig, true);
    const queryTimeMs = performance.now() - queryStart;
    totalQueryTimeMs += queryTimeMs;

    // Compute similarities
    const similarities = corpusEmbeddings
      .filter((c) => c.embedding !== null)
      .map((c) => ({
        label: c.label,
        similarity: cosineSimilarity(queryEmbedding, c.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    // Compute metrics
    const top5Labels = similarities.slice(0, 5).map((s) => s.label);
    const top10Labels = similarities.slice(0, 10).map((s) => s.label);

    const recall5 = testCase.expectedLabels.filter((l) => top5Labels.includes(l)).length / testCase.expectedLabels.length;
    const recall10 = testCase.expectedLabels.filter((l) => top10Labels.includes(l)).length / testCase.expectedLabels.length;

    // MRR: reciprocal rank of first relevant result
    const allLabels = similarities.map((s) => s.label);
    let mrr = 0;
    for (let i = 0; i < allLabels.length; i++) {
      if (testCase.expectedLabels.includes(allLabels[i])) {
        mrr = 1 / (i + 1);
        break;
      }
    }

    testResults.push({
      query: testCase.query,
      category: testCase.category,
      recall5,
      recall10,
      mrr,
      top5: similarities.slice(0, 5).map((s) => ({ label: s.label, sim: s.similarity.toFixed(4) })),
      queryTimeMs,
    });
  }

  // Semantic differentiation: compute pairwise distance between unrelated file categories
  const categoryPairs = [
    ['sqlite_storage_init', 'symbol_extractor'],
    ['real_embeddings', 'cli_doctor'],
    ['query_synthesis', 'workspace_resolver'],
    ['retrieval_escalation', 'refactoring_checker'],
  ];

  const differentiationScores = [];
  for (const [labelA, labelB] of categoryPairs) {
    const embA = corpusEmbeddings.find((c) => c.label === labelA);
    const embB = corpusEmbeddings.find((c) => c.label === labelB);
    if (embA?.embedding && embB?.embedding) {
      const sim = cosineSimilarity(embA.embedding, embB.embedding);
      differentiationScores.push({
        pair: `${labelA} <-> ${labelB}`,
        similarity: sim,
        distance: 1 - sim,
      });
    }
  }

  const avgDifferentiation = differentiationScores.length > 0
    ? differentiationScores.reduce((sum, d) => sum + d.distance, 0) / differentiationScores.length
    : 0;

  // Aggregate metrics
  const avgRecall5 = testResults.reduce((sum, r) => sum + r.recall5, 0) / testResults.length;
  const avgRecall10 = testResults.reduce((sum, r) => sum + r.recall10, 0) / testResults.length;
  const avgMRR = testResults.reduce((sum, r) => sum + r.mrr, 0) / testResults.length;
  const avgQueryTimeMs = totalQueryTimeMs / TEST_CASES.length;

  // Print summary
  console.log(`\n  --- Results for ${modelConfig.id} ---`);
  console.log(`  Recall@5:  ${formatPercent(avgRecall5)}`);
  console.log(`  Recall@10: ${formatPercent(avgRecall10)}`);
  console.log(`  MRR:       ${avgMRR.toFixed(4)}`);
  console.log(`  Avg query time: ${formatDuration(avgQueryTimeMs)}`);
  console.log(`  Avg embed time: ${formatDuration(avgEmbedTimeMs)}`);
  console.log(`  Truncation rate: ${formatPercent(truncationRate)}`);
  console.log(`  Avg differentiation: ${avgDifferentiation.toFixed(4)}`);

  // Cleanup
  try {
    await pipe.dispose();
  } catch {
    // Disposal may not be supported on all versions
  }

  return {
    modelId: modelConfig.id,
    huggingfaceId: modelConfig.huggingfaceId,
    dimension: modelConfig.dimension,
    contextWindow: modelConfig.contextWindow,
    description: modelConfig.description,
    isBaseline: modelConfig.isBaseline || false,
    loadTimeMs,
    avgEmbedTimeMs,
    totalEmbedTimeMs,
    avgQueryTimeMs,
    truncationRate,
    truncatedCount,
    corpusSize: corpus.length,
    recall5: avgRecall5,
    recall10: avgRecall10,
    mrr: avgMRR,
    avgDifferentiation,
    differentiationScores,
    testResults,
    skipped: false,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('LiBrainian Embedding Model Evaluation (#865)');
  console.log('=============================================\n');
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Candidate models: ${CANDIDATE_MODELS.length}`);
  console.log(`Test cases: ${TEST_CASES.length}`);
  console.log(`Corpus files: ${CORPUS_FILES.length}`);

  // Build corpus from real source files
  console.log('\nBuilding code corpus from source files...');
  const corpus = [];
  for (const entry of CORPUS_FILES) {
    const content = readCodeSnippet(entry.file);
    if (content) {
      const tokens = estimateTokens(content);
      corpus.push({
        label: entry.label,
        file: entry.file,
        desc: entry.desc,
        content,
        tokenEstimate: tokens,
      });
      console.log(`  [ok] ${entry.label} (${entry.file}) ~${tokens} tokens`);
    } else {
      console.log(`  [skip] ${entry.label} (${entry.file}) - file not found`);
    }
  }

  if (corpus.length < 10) {
    console.error(`\nERROR: Only ${corpus.length} corpus files found. Need at least 10 for meaningful evaluation.`);
    process.exit(1);
  }

  console.log(`\nCorpus: ${corpus.length} code functions loaded`);

  // Token distribution analysis
  const tokenCounts = corpus.map((c) => c.tokenEstimate);
  tokenCounts.sort((a, b) => a - b);
  const medianTokens = tokenCounts[Math.floor(tokenCounts.length / 2)];
  const maxTokens = tokenCounts[tokenCounts.length - 1];
  const minTokens = tokenCounts[0];
  console.log(`Token distribution: min=${minTokens}, median=${medianTokens}, max=${maxTokens}`);

  // Evaluate each model
  const results = [];
  for (const model of CANDIDATE_MODELS) {
    try {
      const result = await evaluateModel(model, corpus);
      results.push(result);
    } catch (error) {
      console.error(`\nFATAL ERROR evaluating ${model.id}: ${error.message}`);
      console.error(error.stack);
      results.push({
        modelId: model.id,
        error: error.message,
        skipped: true,
      });
    }
  }

  // Print comparison table
  console.log('\n\n' + '='.repeat(90));
  console.log('COMPARISON TABLE');
  console.log('='.repeat(90));

  const activeResults = results.filter((r) => !r.skipped);
  if (activeResults.length === 0) {
    console.log('No models were successfully evaluated.');
    process.exit(1);
  }

  // Header
  const cols = ['Model', 'Dim', 'Ctx', 'Recall@5', 'Recall@10', 'MRR', 'Trunc%', 'Diff', 'Embed/fn', 'Load'];
  const widths = [30, 5, 6, 9, 10, 7, 7, 7, 10, 10];
  const header = cols.map((c, i) => c.padEnd(widths[i])).join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of activeResults) {
    const row = [
      (r.isBaseline ? '* ' : '  ') + r.modelId,
      String(r.dimension),
      String(r.contextWindow),
      formatPercent(r.recall5),
      formatPercent(r.recall10),
      r.mrr.toFixed(4),
      formatPercent(r.truncationRate),
      r.avgDifferentiation.toFixed(4),
      formatDuration(r.avgEmbedTimeMs),
      formatDuration(r.loadTimeMs),
    ];
    console.log(row.map((c, i) => c.padEnd(widths[i])).join(' | '));
  }

  console.log('\n* = current baseline');

  // Determine winner
  const bestByRecall5 = [...activeResults].sort((a, b) => b.recall5 - a.recall5)[0];
  const bestByRecall10 = [...activeResults].sort((a, b) => b.recall10 - a.recall10)[0];
  const bestByMRR = [...activeResults].sort((a, b) => b.mrr - a.mrr)[0];

  console.log('\n--- Winners ---');
  console.log(`Best Recall@5:  ${bestByRecall5.modelId} (${formatPercent(bestByRecall5.recall5)})`);
  console.log(`Best Recall@10: ${bestByRecall10.modelId} (${formatPercent(bestByRecall10.recall10)})`);
  console.log(`Best MRR:       ${bestByMRR.modelId} (${bestByMRR.mrr.toFixed(4)})`);

  // Overall recommendation: weighted score
  console.log('\n--- Overall Score (0.4*Recall@5 + 0.3*Recall@10 + 0.2*MRR + 0.1*(1-truncation)) ---');
  for (const r of activeResults) {
    r.overallScore = 0.4 * r.recall5 + 0.3 * r.recall10 + 0.2 * r.mrr + 0.1 * (1 - r.truncationRate);
  }
  activeResults.sort((a, b) => b.overallScore - a.overallScore);

  for (const r of activeResults) {
    console.log(`  ${r.modelId}: ${r.overallScore.toFixed(4)}${r.isBaseline ? ' (baseline)' : ''}`);
  }

  const recommended = activeResults[0];
  const baseline = activeResults.find((r) => r.isBaseline);

  console.log(`\n>>> RECOMMENDATION: ${recommended.modelId} <<<`);
  if (recommended.isBaseline) {
    console.log('The current baseline model is still the best choice.');
  } else if (baseline) {
    const improvement = ((recommended.overallScore - baseline.overallScore) / baseline.overallScore * 100).toFixed(1);
    console.log(`${improvement}% improvement over baseline (${baseline.modelId})`);
    if (recommended.dimension !== 384) {
      console.log(`NOTE: ${recommended.modelId} uses ${recommended.dimension}-dimensional embeddings.`);
      console.log('This requires a database migration (separate from this evaluation).');
    }
  }

  // Per-query breakdown for the top model
  console.log(`\n--- Per-query Results for ${recommended.modelId} ---`);
  for (const tr of recommended.testResults) {
    const status = tr.recall5 >= 0.5 ? 'PASS' : tr.recall5 > 0 ? 'PARTIAL' : 'MISS';
    console.log(`  [${status}] "${tr.query}" R@5=${formatPercent(tr.recall5)} MRR=${tr.mrr.toFixed(3)}`);
    if (tr.recall5 < 1.0) {
      console.log(`         Top 5: ${tr.top5.map((t) => `${t.label}(${t.sim})`).join(', ')}`);
    }
  }

  // Write results to JSON
  const outputPath = path.join(PROJECT_ROOT, 'state', 'eval-embedding-models-results.json');
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonOutput = {
    timestamp: new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    corpusSize: corpus.length,
    testCaseCount: TEST_CASES.length,
    tokenDistribution: { min: minTokens, median: medianTokens, max: maxTokens },
    results: results.map((r) => ({
      ...r,
      // Exclude the raw test result top5 embeddings from JSON (large)
      testResults: r.testResults?.map((tr) => ({
        query: tr.query,
        category: tr.category,
        recall5: tr.recall5,
        recall10: tr.recall10,
        mrr: tr.mrr,
        queryTimeMs: tr.queryTimeMs,
      })),
    })),
    recommendation: {
      modelId: recommended.modelId,
      overallScore: recommended.overallScore,
      recall5: recommended.recall5,
      recall10: recommended.recall10,
      mrr: recommended.mrr,
      dimension: recommended.dimension,
      contextWindow: recommended.contextWindow,
      isNewModel: !recommended.isBaseline,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`\nResults written to: ${outputPath}`);

  return recommended;
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
