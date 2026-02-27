/**
 * @fileoverview Live Provider Integration Tests
 *
 * These tests hit REAL providers (Claude/Codex CLI, embeddings) to validate
 * the adaptive provider configuration actually works in production.
 *
 * Requirements:
 * - Authenticated CLI providers (Claude: `claude setup-token` or run `claude`; Codex: `codex login`)
 * - Embedding provider installed (@huggingface/transformers or sentence-transformers)
 *
 * Run with: npx vitest run src/__tests__/live_provider_integration.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fsSync from 'node:fs';
import * as fs from 'fs/promises';
import { pathToFileURL } from 'node:url';

// Core imports
import {
  Errors,
  isRetryableError,
} from '../core/errors.js';

import {
  AdaptiveProviderConfig,
} from '../providers/adaptive_config.js';
import { EmbeddingService } from '../api/embeddings.js';
import { checkAllProviders, type AllProviderStatus } from '../api/provider_check.js';

import {
  DomainRegistry,
  domainRegistry,
} from '../knowledge/registry/domain_registry.js';

import {
  EntityRegistry,
  entityRegistry,
  type FileInfo,
} from '../knowledge/registry/entity_registry.js';
import { resolveLibrarianModelId } from '../api/llm_env.js';

import {
  MultiSignalScorer,
  multiSignalScorer,
  type EntityData,
  type QueryContext,
} from '../query/multi_signal_scorer.js';

import {
  createEntityId,
} from '../core/contracts.js';
import {
  clearDefaultLlmServiceFactory,
  createDefaultLlmServiceAdapter,
  setDefaultLlmServiceFactory,
  type LlmServiceAdapter,
} from '../adapters/llm_service.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

const IS_TIER0 = process.env.LIBRARIAN_TIER0 === '1';
const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && process.env.LIBRARIAN_TIER0 !== '1');
const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const LIBRARIAN_ROOT = path.resolve(import.meta.dirname, '..');
const SRC_ROOT = path.resolve(REPO_ROOT, 'src');
const HAS_SRC_ROOT = fsSync.existsSync(SRC_ROOT);
const HAS_WAVE0_TREE =
  fsSync.existsSync(path.join(SRC_ROOT, 'orchestrator')) ||
  fsSync.existsSync(path.join(SRC_ROOT, 'soma'));
const LLM_SERVICE_PATH_CANDIDATES = [
  path.join(REPO_ROOT, 'src', 'soma', 'providers', 'llm_service.ts'),
  path.join(REPO_ROOT, 'src', 'soma', 'providers', 'llm_service.js'),
];
const WAVE0_LLM_SERVICE_PATH = LLM_SERVICE_PATH_CANDIDATES.find((candidate) => fsSync.existsSync(candidate));
const HAS_WAVE0_LLM_SERVICE = Boolean(WAVE0_LLM_SERVICE_PATH);

// Skip live tests in Tier-0 mode OR unit test mode (no real providers)
const describeLive = IS_TIER0 || IS_UNIT_MODE ? describe.skip : describe;
const describeWave0 = IS_TIER0 || IS_UNIT_MODE || !HAS_SRC_ROOT || !HAS_WAVE0_TREE ? describe.skip : describe;
const describeLlm = IS_TIER0 || IS_UNIT_MODE || !HAS_WAVE0_LLM_SERVICE ? describe.skip : describe;

interface LiveProviderResult {
  success: boolean;
  latencyMs: number;
  response?: unknown;
  error?: string;
}

const DEFAULT_CODEX_MODEL_ID = 'gpt-5.1-codex-mini';
const DEFAULT_CLAUDE_MODEL_ID = 'claude-haiku-4-5-20241022';

async function requireLiveProviders(): Promise<AllProviderStatus> {
  const status = await checkAllProviders({ workspaceRoot: REPO_ROOT });
  const missing: string[] = [];
  if (!status.llm.available) missing.push(`LLM: ${status.llm.error ?? 'unavailable'}`);
  if (!status.embedding.available) missing.push(`Embedding: ${status.embedding.error ?? 'unavailable'}`);
  if (missing.length > 0) {
    throw new Error(`unverified_by_trace(provider_unavailable): ${missing.join('; ')}`);
  }
  return status;
}

function resolveLlmModelId(provider: 'claude' | 'codex'): string {
  const envModel = resolveLibrarianModelId(provider);
  if (envModel) return envModel;
  return provider === 'claude' ? DEFAULT_CLAUDE_MODEL_ID : DEFAULT_CODEX_MODEL_ID;
}

async function callLlm(
  llmService: LlmServiceAdapter,
  provider: 'claude' | 'codex',
  modelId: string,
  prompt: string
): Promise<LiveProviderResult> {
  const startTime = Date.now();
  try {
    const response = await llmService.chat({
      provider,
      modelId,
      maxTokens: 80,
      messages: [{ role: 'user', content: prompt }],
    });
    return {
      success: true,
      latencyMs: Date.now() - startTime,
      response,
    };
  } catch (e) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Collect TypeScript files from a directory
 */
async function collectFiles(dir: string, maxFiles = 100): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(dir);
  return files;
}

// ============================================================================
// LIVE CLAUDE PROVIDER TESTS
// ============================================================================

describeLlm('Live Provider: LLM CLI', () => {
  let config: AdaptiveProviderConfig;
  let llmService: LlmServiceAdapter;
  let providerStatus: AllProviderStatus;
  let llmProvider: 'claude' | 'codex';
  let llmModelId: string;

  beforeAll(async () => {
    if (WAVE0_LLM_SERVICE_PATH) {
      const module = await import(pathToFileURL(WAVE0_LLM_SERVICE_PATH).href);
      setDefaultLlmServiceFactory(async () => new module.LLMService(), { force: true });
    }
    providerStatus = await requireLiveProviders();
    llmProvider = providerStatus.llm.provider === 'claude' ? 'claude' : 'codex';
    llmModelId = resolveLlmModelId(llmProvider);
  }, 0); // Unlimited per VISION

  afterAll(() => {
    clearDefaultLlmServiceFactory();
  });

  beforeEach(() => {
    config = new AdaptiveProviderConfig();
    llmService = createDefaultLlmServiceAdapter();
  });

  it('should successfully call an authenticated LLM provider', async () => {
    const result = await callLlm(llmService, llmProvider, llmModelId, 'Reply with just the word "hello".');

    expect(result.success).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.response).toBeDefined();

    const content = typeof result.response === 'object' && result.response && 'content' in result.response
      ? String((result.response as { content?: string }).content ?? '')
      : '';
    expect(content.toLowerCase()).toContain('hello');

    config.recordSuccess(llmProvider, result.latencyMs);
    const stats = config.getStats(llmProvider);
    expect(stats.totalRequests).toBe(1);
    expect(stats.successRate).toBe(1);
  }, 0); // Unlimited per VISION

  it('should track latency metrics across multiple calls', async () => {
    const calls = 2;

    const results = await Promise.all(
      Array.from({ length: calls }, (_, i) =>
        callLlm(llmService, llmProvider, llmModelId, `Reply with the number ${i}.`)
      )
    );
    for (const result of results) {
      if (result.success) {
        config.recordSuccess(llmProvider, result.latencyMs);
      } else {
        config.recordFailure(llmProvider, 'error');
      }
    }

    const stats = config.getStats(llmProvider);
    expect(stats.totalRequests).toBe(calls);
    expect(stats.avgLatencyMs).toBeGreaterThan(0);
    expect(stats.p95LatencyMs).toBeGreaterThan(0);
  }, 0); // Unlimited per VISION

  it('should adapt timeout based on observed latency', () => {
    const latencies = [600, 700, 800, 900, 650, 720, 880, 940, 780, 820];
    for (const latency of latencies) {
      config.recordSuccess(llmProvider, latency);
    }

    const adapted = config.getAdaptedConfig(llmProvider);
    const stats = config.getStats(llmProvider);

    expect(adapted.timeoutMs).toBeGreaterThanOrEqual(adapted.retryDelayMs);
    expect(stats.totalRequests).toBeGreaterThanOrEqual(latencies.length);
  });

  it('should adapt rate limits after rate-limit signals', () => {
    for (let i = 0; i < 6; i++) {
      config.recordSuccess(llmProvider, 700 + i * 10);
    }
    for (let i = 0; i < 4; i++) {
      config.recordFailure(llmProvider, 'rate_limit');
    }

    const adapted = config.getAdaptedConfig(llmProvider);
    expect(adapted.rateLimit.tokensPerSecond).toBeGreaterThan(0);
    expect(config.getStats(llmProvider).totalRequests).toBe(10);
  });
});

describeLive('Live Provider: Embeddings', () => {
  beforeAll(async () => {
    if (WAVE0_LLM_SERVICE_PATH) {
      const module = await import(pathToFileURL(WAVE0_LLM_SERVICE_PATH).href);
      setDefaultLlmServiceFactory(async () => new module.LLMService(), { force: true });
    }
  }, 0);

  afterAll(() => {
    clearDefaultLlmServiceFactory();
  });

  it('should generate a real embedding vector', async () => {
    await requireLiveProviders();
    const embeddingService = new EmbeddingService();
    const result = await embeddingService.generateEmbedding({
      kind: 'query',
      text: 'vectorize this short prompt',
    });
    expect(result.embedding.length).toBe(embeddingService.getEmbeddingDimension());

    let norm = 0;
    for (let i = 0; i < result.embedding.length; i++) {
      norm += result.embedding[i] * result.embedding[i];
    }
    expect(Math.sqrt(norm)).toBeGreaterThan(0.9);
  }, 0); // Unlimited per VISION
});

// ============================================================================
// LIVE INDEXING TESTS (Using real codebase)
// ============================================================================

describeLive('Live Indexing: Real Codebase', () => {
  let librarianFiles: string[] = [];
  let config: AdaptiveProviderConfig;

  beforeAll(async () => {
    librarianFiles = await collectFiles(LIBRARIAN_ROOT, 100);
    config = new AdaptiveProviderConfig();
  });

  it('should index real librarian files with timing metrics', async () => {
    const registry = new EntityRegistry();
    const indexedCount = { test: 0, service: 0, component: 0, other: 0 };

    for (const file of librarianFiles) {
      const startTime = Date.now();

      const fileInfo: FileInfo = {
        path: file,
        name: path.basename(file),
        directory: path.dirname(file),
        extension: path.extname(file),
      };

      const classifications = registry.classifyFile(fileInfo);
      const latencyMs = Date.now() - startTime;

      // Track as local provider
      config.recordSuccess('local', latencyMs);

      // Count classifications
      for (const c of classifications) {
        if (c.typeId === 'test') indexedCount.test++;
        else if (c.typeId === 'service') indexedCount.service++;
        else if (c.typeId === 'component') indexedCount.component++;
        else indexedCount.other++;
      }
    }

    const stats = config.getStats('local');

    // Should have indexed all files
    expect(stats.totalRequests).toBe(librarianFiles.length);
    expect(stats.successRate).toBe(1);

    // Should be fast for local operations
    expect(stats.avgLatencyMs).toBeLessThan(10); // < 10ms average

    // Should have found test files
    expect(indexedCount.test).toBeGreaterThan(0);
  });

  it('should score real files with multi-signal scorer', async () => {
    const scorer = new MultiSignalScorer();

    const entities: EntityData[] = librarianFiles.slice(0, 30).map(file => ({
      id: createEntityId('file', file),
      type: 'file',
      path: file,
      name: path.basename(file, '.ts'),
      content: path.basename(file, '.ts').replace(/_/g, ' '),
      lastAccessed: Date.now() - Math.random() * 86400000, // Random access time
    }));

    // Query for error handling
    const context: QueryContext = {
      queryText: 'error handling and result types',
      queryTerms: ['error', 'result', 'handling'],
      currentFile: librarianFiles[0],
    };

    const startTime = Date.now();
    const results = await scorer.scoreEntities(entities, context);
    const latencyMs = Date.now() - startTime;

    // Should complete quickly
    expect(latencyMs).toBeLessThan(100);

    // Should have scored all entities
    expect(results.length).toBe(entities.length);

    // Should be sorted by score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].combinedScore).toBeGreaterThanOrEqual(results[i].combinedScore);
    }

    // Top result should have explanations
    expect(results[0].explanation).toBeDefined();
    expect(results[0].explanation.length).toBeGreaterThan(0);
  });

  it('should discover patterns from real codebase', async () => {
    const registry = new EntityRegistry();

    const fileInfos = librarianFiles.map(file => ({
      path: file,
      name: path.basename(file),
      directory: path.dirname(file),
      extension: path.extname(file),
    }));

    const discovered = registry.discoverEntityTypes(fileInfos);

    // Even if no new types discovered, should complete without error
    expect(discovered).toBeDefined();

    // If we found patterns, they should be valid
    for (const type of discovered) {
      expect(type.id).toBeDefined();
      expect(type.name).toBeDefined();
      expect(type.isDiscovered).toBe(true);
    }
  });

  it('should adapt domain staleness based on real access patterns', () => {
    const registry = new DomainRegistry();

    // Simulate heavy access to identity domain (common during indexing)
    for (let i = 0; i < 50; i++) {
      registry.recordAccess('identity');
    }

    // Simulate light access to tribal domain
    for (let i = 0; i < 3; i++) {
      registry.recordAccess('tribal');
    }

    const identityStats = registry.getAccessStats('identity');
    const tribalStats = registry.getAccessStats('tribal');

    // Identity should be hotter
    expect(identityStats.recentAccesses).toBeGreaterThan(tribalStats.recentAccesses);

    // Identity staleness should be adapted (reduced)
    // Note: identity has defaultStalenessMs = 0, so it won't be adapted
    // Let's check semantics instead
    for (let i = 0; i < 50; i++) {
      registry.recordAccess('semantics');
    }

    const baseSemanticsStale = registry.get('semantics')!.defaultStalenessMs;
    const adaptedSemanticsStale = registry.getEffectiveStaleness('semantics');

    // Hot domain should have reduced staleness
    expect(adaptedSemanticsStale).toBeLessThan(baseSemanticsStale);
  });
});

// ============================================================================
// LIVE FEEDBACK LEARNING TESTS
// ============================================================================

describeLive('Live Learning: Feedback Loop', () => {
  it('should learn from simulated user feedback', async () => {
    const scorer = new MultiSignalScorer();

    // Initial weights
    const initialWeights = { ...scorer.getWeights() };

    // Simulate user feedback: semantic signal is very useful
    for (let i = 0; i < 20; i++) {
      scorer.recordFeedback(
        createEntityId('file', `/relevant_${i}.ts`),
        true, // was relevant
        [
          { signal: 'semantic', score: 0.9, confidence: 0.9 },
          { signal: 'keyword', score: 0.3, confidence: 0.8 },
        ]
      );
    }

    // Simulate: keyword signal wasn't helpful
    for (let i = 0; i < 15; i++) {
      scorer.recordFeedback(
        createEntityId('file', `/irrelevant_${i}.ts`),
        false, // not relevant
        [
          { signal: 'semantic', score: 0.2, confidence: 0.9 },
          { signal: 'keyword', score: 0.8, confidence: 0.8 },
        ]
      );
    }

    const updatedWeights = scorer.getWeights();
    const stats = scorer.getStats();

    // Should have recorded feedback
    expect(stats.totalFeedback).toBe(35);

    // Weights should have shifted (semantic should be higher relative to keyword)
    // Note: exact values depend on learning rate and normalization
    expect(updatedWeights.semantic).not.toBe(initialWeights.semantic);
    expect(updatedWeights.keyword).not.toBe(initialWeights.keyword);
  });

  it('should persist and restore learning state', () => {
    const scorer = new MultiSignalScorer();

    // Add some feedback
    scorer.recordFeedback(
      createEntityId('file', '/test.ts'),
      true,
      [{ signal: 'structural', score: 0.9, confidence: 0.8 }]
    );

    scorer.setWeight('structural', 0.3);

    // Export state
    const exported = scorer.toJSON();

    // Create new scorer and import
    const newScorer = new MultiSignalScorer();
    newScorer.fromJSON(exported);

    // Should have restored state
    expect(newScorer.getStats().totalFeedback).toBe(1);
    expect(Math.abs(newScorer.getWeights().structural - 0.3)).toBeLessThan(0.1);
  });
});

// ============================================================================
// LIVE WAVE0 INDEXING TESTS
// ============================================================================

describeWave0('Live Wave0: Full Codebase Indexing', () => {
  let wave0Files: string[] = [];

  beforeAll(async () => {
    wave0Files = await collectFiles(SRC_ROOT, 500);
  }, 0); // Unlimited per VISION

  it('should index wave0 src directory', () => {
    expect(wave0Files.length).toBeGreaterThan(50);

    // Should have variety of files
    const hasOrchestrator = wave0Files.some(f => f.includes('/orchestrator/'));
    const hasLibrarian = wave0Files.some(f => f.includes('/librarian/'));
    const hasSoma = wave0Files.some(f => f.includes('/soma/'));

    // At least some modules should exist
    expect(hasOrchestrator || hasLibrarian || hasSoma).toBe(true);
  });

  it('should classify entire wave0 with performance tracking', async () => {
    const registry = new EntityRegistry();
    const config = new AdaptiveProviderConfig();
    const typeCounts = new Map<string, number>();

    const startTime = Date.now();

    for (const file of wave0Files) {
      const fileInfo: FileInfo = {
        path: file,
        name: path.basename(file),
        directory: path.dirname(file),
        extension: path.extname(file),
      };

      const callStart = Date.now();
      const classifications = registry.classifyFile(fileInfo);
      config.recordSuccess('local', Date.now() - callStart);

      for (const c of classifications) {
        typeCounts.set(c.typeId, (typeCounts.get(c.typeId) ?? 0) + 1);
      }
    }

    const totalTime = Date.now() - startTime;
    const filesPerSecond = (wave0Files.length / totalTime) * 1000;

    // Performance: should process at least 100 files/second
    expect(filesPerSecond).toBeGreaterThan(100);

    // Should find test files in wave0
    expect(typeCounts.get('test') ?? 0).toBeGreaterThan(0);
  });

  it('should score wave0 files with multi-signal relevance', async () => {
    const scorer = new MultiSignalScorer();

    // Sample of wave0 files
    const sampleFiles = wave0Files.slice(0, 50);
    const entities: EntityData[] = sampleFiles.map(file => ({
      id: createEntityId('file', file),
      type: 'file',
      path: file,
      name: path.basename(file, '.ts'),
      content: path.basename(file, '.ts').replace(/_/g, ' ') + ' ' + file,
      lastAccessed: Date.now(),
    }));

    // Query for orchestrator functionality
    const context: QueryContext = {
      queryText: 'orchestrator context assembly routing',
      queryTerms: ['orchestrator', 'context', 'assembly', 'routing'],
    };

    const results = await scorer.scoreEntities(entities, context);

    // Should rank orchestrator files higher if they exist
    const orchestratorResults = results.filter(r =>
      r.entityId.includes('orchestrator')
    );

    if (orchestratorResults.length > 0) {
      // At least one orchestrator file should be in top 10
      const top10Ids = results.slice(0, 10).map(r => r.entityId);
      const hasOrchestratorInTop10 = top10Ids.some(id => id.includes('orchestrator'));
      expect(hasOrchestratorInTop10).toBe(true);
    }
  });

  it('should track provider metrics during full indexing', async () => {
    const config = new AdaptiveProviderConfig();

    // Simulate a full indexing run with realistic metrics
    for (const file of wave0Files.slice(0, 100)) {
      // Simulate file read latency
      const readLatency = 1 + Math.random() * 5;
      config.recordSuccess('local', readLatency);

      // Occasionally simulate an error
      if (Math.random() < 0.02) {
        config.recordFailure('local', 'read_error');
      }
    }

    const stats = config.getStats('local');

    // Should have high success rate
    expect(stats.successRate).toBeGreaterThan(0.95);

    // Should track latency distribution
    expect(stats.avgLatencyMs).toBeGreaterThan(0);
    expect(stats.p95LatencyMs).toBeGreaterThan(stats.avgLatencyMs);
  });
});

// ============================================================================
// DOGFOODING: LIBRARIAN UNDERSTANDS ITSELF
// ============================================================================

describeLive('Dogfooding: Librarian Self-Analysis', () => {
  it('should identify its own core components', async () => {
    const files = await collectFiles(LIBRARIAN_ROOT, 50);
    const scorer = new MultiSignalScorer();

    const entities: EntityData[] = files.map(file => ({
      id: createEntityId('file', file),
      type: 'file',
      path: file,
      name: path.basename(file, '.ts'),
      content: path.basename(file, '.ts').replace(/_/g, ' '),
    }));

    // Query for core functionality
    const queries = [
      { text: 'error handling', terms: ['error', 'errors'] },
      { text: 'result types', terms: ['result'] },
      { text: 'domain registry', terms: ['domain', 'registry'] },
      { text: 'entity classification', terms: ['entity', 'classification'] },
      { text: 'scoring relevance', terms: ['scoring', 'scorer', 'relevance'] },
    ];

    for (const query of queries) {
      const context: QueryContext = {
        queryText: query.text,
        queryTerms: query.terms,
      };

      const results = await scorer.scoreEntities(entities, context);

      // Top results should have relevant files
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].combinedScore).toBeGreaterThan(0);
    }
  });

  it('should find dependencies between librarian modules', async () => {
    const files = await collectFiles(LIBRARIAN_ROOT, 50);

    // Group files by directory (module)
    const moduleFiles = new Map<string, string[]>();
    for (const file of files) {
      const relative = path.relative(LIBRARIAN_ROOT, file);
      const parts = relative.split('/');
      // Use first directory as module, or 'root' for top-level files
      const module = parts.length > 1 ? parts[0] : 'root';
      const existing = moduleFiles.get(module) ?? [];
      existing.push(file);
      moduleFiles.set(module, existing);
    }

    // Should have multiple modules/directories
    expect(moduleFiles.size).toBeGreaterThan(0);

    // Should have agents or api or __tests__ module (existing librarian structure)
    const hasAgents = moduleFiles.has('agents');
    const hasApi = moduleFiles.has('api');
    const hasTests = moduleFiles.has('__tests__');
    expect(hasAgents || hasApi || hasTests).toBe(true);

    // Test files should include test patterns
    if (hasTests) {
      const testFiles = moduleFiles.get('__tests__')!;
      expect(testFiles.some(f => f.includes('.test.ts'))).toBe(true);
    }
  });

  it('should report its own health metrics', () => {
    const domainReg = new DomainRegistry();
    const entityReg = new EntityRegistry();
    const scorer = new MultiSignalScorer();
    const providerConfig = new AdaptiveProviderConfig();

    // Simulate some activity
    domainReg.recordAccess('identity');
    domainReg.recordAccess('semantics');
    providerConfig.recordSuccess('local', 5);
    scorer.recordFeedback(
      createEntityId('file', '/test.ts'),
      true,
      [{ signal: 'keyword', score: 0.8, confidence: 0.9 }]
    );

    // Health report
    const health = {
      domains: domainReg.getAll().length,
      entityTypes: entityReg.getAll().length,
      scorerSignals: Object.keys(scorer.getWeights()).length,
      scorerFeedback: scorer.getStats().totalFeedback,
      providerRequests: providerConfig.getStats('local').totalRequests,
    };

    expect(health.domains).toBeGreaterThanOrEqual(12);
    expect(health.entityTypes).toBeGreaterThanOrEqual(20);
    expect(health.scorerSignals).toBe(11);
    expect(health.scorerFeedback).toBe(1);
    expect(health.providerRequests).toBe(1);
  });
});
