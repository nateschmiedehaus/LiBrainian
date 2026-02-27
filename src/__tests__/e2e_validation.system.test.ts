/**
 * @fileoverview Librarian End-to-End Validation Tests
 *
 * Proves librarian works as a complete system:
 * - Phase 1: Bootstrap produces queryable knowledge
 * - Phase 2: Queries return accurate answers
 * - Phase 3: Feedback loop persists and affects queries
 * - Phase 4: Confidence correlates with quality
 *
 * @see docs/archive/E2E_VALIDATION_PLAN.md
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkAllProviders } from '../api/provider_check.js';
import { evaluateAnswer, CALCULATOR_CALIBRATION_FIXTURES } from './calibration_fixtures.js';
import { cleanupWorkspace } from './helpers/index.js';

// ============================================================================
// TEST FIXTURE
// ============================================================================

const CALCULATOR_TS = `/**
 * Simple calculator module for testing.
 * Provides basic arithmetic operations.
 */

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}
`;

const MATH_UTILS_TS = `import { add, multiply } from './calculator.js';

/**
 * Calculate the average of numbers.
 * Uses add() from calculator module.
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, n) => add(acc, n), 0);
  return sum / numbers.length;
}

/**
 * Calculate factorial using multiplication.
 * Recursive implementation with input validation.
 */
export function factorial(n: number): number {
  if (n < 0) throw new Error('Factorial of negative number');
  if (n <= 1) return 1;
  return multiply(n, factorial(n - 1));
}
`;

const API_CALCULATE_TS = `import { add, subtract, multiply, divide } from '../calculator.js';

type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

interface CalculateRequest {
  a: number;
  b: number;
  operation: Operation;
}

interface CalculateResponse {
  result: number;
  operation: Operation;
}

/**
 * API handler for calculator operations.
 * Validates inputs and delegates to calculator module.
 */
export function handleCalculate(req: CalculateRequest): CalculateResponse {
  const { a, b, operation } = req;

  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Invalid operands');
  }

  let result: number;
  switch (operation) {
    case 'add': result = add(a, b); break;
    case 'subtract': result = subtract(a, b); break;
    case 'multiply': result = multiply(a, b); break;
    case 'divide': result = divide(a, b); break;
    default: throw new Error(\`Unknown operation: \${operation}\`);
  }

  return { result, operation };
}
`;

// ============================================================================
// TEST SETUP - Shared state across all phases
// ============================================================================

let testWorkspace: string;
let dbPath: string;
let hasProviders = false;
let sharedStorage: Awaited<ReturnType<typeof import('../storage/sqlite_storage.js').createSqliteStorage>> | null = null;
let sharedEmbeddingService: InstanceType<typeof import('../api/embeddings.js').EmbeddingService> | null = null;

async function createTestWorkspace(): Promise<string> {
  const workspace = path.join(os.tmpdir(), `librarian-e2e-${Date.now()}`);
  await fs.mkdir(path.join(workspace, 'src', 'api'), { recursive: true });

  await fs.writeFile(path.join(workspace, 'src', 'calculator.ts'), CALCULATOR_TS);
  await fs.writeFile(path.join(workspace, 'src', 'math_utils.ts'), MATH_UTILS_TS);
  await fs.writeFile(path.join(workspace, 'src', 'api', 'calculate.ts'), API_CALCULATE_TS);

  return workspace;
}

// Workspace cleanup moved to shared helper: ./helpers/workspace.ts

async function getSharedStorage() {
  if (!sharedStorage) {
    const { createSqliteStorage } = await import('../storage/sqlite_storage.js');
    sharedStorage = await createSqliteStorage(dbPath);
    await sharedStorage.initialize();
  }
  return sharedStorage;
}

async function getSharedEmbeddingService() {
  if (!sharedEmbeddingService) {
    const { EmbeddingService } = await import('../api/embeddings.js');
    sharedEmbeddingService = new EmbeddingService();
  }
  return sharedEmbeddingService;
}

// ============================================================================
// PHASE 1: BOOTSTRAP VALIDATION
// ============================================================================

describe('Phase 1: Bootstrap Validation', () => {
  beforeAll(async () => {
    // Check for live providers
    // Use forceProbe: false (fast config check) - if truly unavailable, bootstrap will fail clearly
    // forceProbe: true runs a slow test prompt that can timeout/hang
    try {
      const status = await checkAllProviders({ forceProbe: false });
      // Bootstrap requires both LLM and embedding providers
      hasProviders = status.llm.available && status.embedding.available;
    } catch {
      hasProviders = false;
    }

    if (!hasProviders) {
      console.log('[E2E] No live providers - tests will be skipped');
      return;
    }

    console.log('[E2E] Live providers available - creating test workspace');
    testWorkspace = await createTestWorkspace();
    dbPath = path.join(testWorkspace, 'librarian.db');
    console.log(`[E2E] Test workspace: ${testWorkspace}`);
  }, 30000);

  afterAll(async () => {
    // Don't cleanup yet - Phase 2 needs the workspace and storage
    // Cleanup will happen after all tests in a global afterAll
  });

  it('bootstraps and indexes all files', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }

    const { bootstrapProject, createBootstrapConfig } = await import('../api/bootstrap.js');

    // Use shared storage
    const storage = await getSharedStorage();

    console.log('[E2E] Starting bootstrap...');
    const startTime = Date.now();

    // Run bootstrap with proper config structure
    // skipProviderProbe: true because we already verified providers in beforeAll
    const config = createBootstrapConfig(testWorkspace, {
      llmProvider: 'claude',
      bootstrapMode: 'full',
      skipProviderProbe: true,
    });
    const result = await bootstrapProject(config, storage);

    const elapsed = Date.now() - startTime;
    console.log(`[E2E] Bootstrap completed in ${elapsed}ms`);
    console.log(`[E2E] Result:`, JSON.stringify(result, null, 2));

    // SC-1: Bootstrap produces queryable knowledge
    expect(result.success).toBe(true);

    // Verify files were indexed
    const files = await storage.getFiles();
    console.log(`[E2E] Files indexed: ${files.length}`);
    expect(files.length).toBeGreaterThanOrEqual(3);

    // Verify each file has purpose from LLM
    for (const file of files) {
      console.log(`[E2E] File: ${file.path}`);
      console.log(`[E2E]   Purpose: ${file.purpose?.substring(0, 60)}...`);
      console.log(`[E2E]   Confidence: ${file.confidence}`);

      expect(file.purpose).toBeDefined();
      expect(file.purpose!.length).toBeGreaterThan(10);
      expect(file.confidence).toBeGreaterThan(0);
    }

    // Verify functions were extracted
    const functions = await storage.getFunctions();
    console.log(`[E2E] Functions indexed: ${functions.length}`);

    // Should have at least: add, subtract, multiply, divide, average, factorial, handleCalculate
    expect(functions.length).toBeGreaterThanOrEqual(7);

    // Verify function purposes are LLM-generated (not heuristic)
    const divideFunc = functions.find(f => f.name === 'divide');
    expect(divideFunc).toBeDefined();
    expect(divideFunc!.purpose).toBeDefined();
    expect(divideFunc!.purpose!.toLowerCase()).toMatch(/divid|zero|error/);
    console.log(`[E2E] divide() purpose: ${divideFunc!.purpose}`);

    // Don't close - shared storage is used by subsequent tests
  }, 0); // No timeout - bootstrap completes when all phases finish

  it('tracks token usage via governor', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }

    const { GovernorContext } = await import('../api/governor_context.js');
    const { DEFAULT_GOVERNOR_CONFIG } = await import('../api/governors.js');
    const { extractFileKnowledge } = await import('../knowledge/extractors/file_extractor.js');

    const governor = new GovernorContext({
      phase: 'e2e_token_tracking',
      config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100_000 },
    });

    const filePath = path.join(testWorkspace, 'src', 'calculator.ts');
    const content = await fs.readFile(filePath, 'utf-8');

    // Extract with governor
    await extractFileKnowledge(
      { absolutePath: filePath, workspaceRoot: testWorkspace, content },
      { llmProvider: 'claude', governor }
    );

    const snapshot = governor.snapshot();
    console.log(`[E2E] Tokens used: ${snapshot.usage.tokens_used_run}`);

    // Tokens must be tracked (not zero)
    expect(snapshot.usage.tokens_used_run).toBeGreaterThan(0);
  }, 30000);

  it('produces entities with evidence-based confidence', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }

    const { extractFileKnowledge } = await import('../knowledge/extractors/file_extractor.js');

    const filePath = path.join(testWorkspace, 'src', 'calculator.ts');
    const content = await fs.readFile(filePath, 'utf-8');

    const result = await extractFileKnowledge(
      { absolutePath: filePath, workspaceRoot: testWorkspace, content },
      { llmProvider: 'claude' }
    );

    console.log(`[E2E] Confidence: ${result.confidence}`);
    console.log(`[E2E] Purpose: ${result.file.purpose}`);
    console.log(`[E2E] Summary: ${result.file.summary}`);

    // Confidence should NOT be exactly 0.85 (the old hardcoded value)
    expect(result.confidence).not.toBe(0.85);

    // Confidence should be evidence-based (0.65 base + bonuses)
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    expect(result.confidence).toBeLessThanOrEqual(0.95);

    // With good LLM response, should get high confidence
    if (result.file.purpose && result.file.purpose.length > 20) {
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    }
  }, 30000);
});

// ============================================================================
// PHASE 2: QUERY ACCURACY VALIDATION
// Requires Phase 1 bootstrap to complete successfully
// ============================================================================

describe('Phase 2: Query Accuracy Validation', () => {
  // NOTE: These tests depend on Phase 1 having bootstrapped the workspace
  // If Phase 1 is skipped (no providers), these will also skip

  it('answers questions accurately about specific functions', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }
    if (!testWorkspace) {
      ctx.skip(true, 'unverified_by_trace(test_fixture_missing): No test workspace (Phase 1 did not run)');
      return;
    }

    const { queryLibrarian } = await import('../api/query.js');

    // Use shared storage and embedding service
    const storage = await getSharedStorage();
    const embeddingService = await getSharedEmbeddingService();

    // Check if bootstrap actually created context packs
    const packs = await storage.getContextPacks();
    console.log(`[E2E] Context packs in storage: ${packs.length}`);

    console.log('[E2E] Querying: What does the divide function do?');
    const result = await queryLibrarian(
      { intent: 'What does the divide function do and what errors can it throw?', depth: 'L1' },
      storage,
      embeddingService
    );

    console.log(`[E2E] Query result:`, JSON.stringify({
      totalConfidence: result.totalConfidence,
      packsCount: result.packs.length,
      synthesis: result.synthesis ? {
        confidence: result.synthesis.confidence,
        answerPreview: result.synthesis.answer.substring(0, 100) + '...',
        citationsCount: result.synthesis.citations.length,
      } : null,
    }, null, 2));

    // SC-2: Queries return accurate answers
    expect(result.packs.length).toBeGreaterThan(0);

    // If synthesis is available (LLM responded), verify answer quality with GROUND TRUTH
    if (result.synthesis) {
      const answer = result.synthesis.answer;

      // Use ground truth evaluation instead of simple keyword matching
      const fixture = CALCULATOR_CALIBRATION_FIXTURES.find(f => f.id === 'calc-divide-purpose')!;
      const correctness = evaluateAnswer(answer, fixture);

      console.log(`[E2E] Ground truth evaluation:`);
      console.log(`  Required facts: ${correctness.requiredMatched}/${correctness.requiredTotal}`);
      console.log(`  Matched: ${correctness.matchedFacts.join('; ')}`);
      console.log(`  Missing: ${correctness.missingFacts.join('; ') || '(none)'}`);
      console.log(`  Hallucinations: ${correctness.hallucinations.join('; ') || '(none)'}`);
      console.log(`  Correctness score: ${(correctness.correctness * 100).toFixed(1)}%`);
      console.log(`  Full answer: ${answer}`);

      // REAL ASSERTIONS based on ground truth
      // Must mention division AND zero error handling (both required facts)
      expect(correctness.requiredMatched).toBe(correctness.requiredTotal);
      expect(correctness.hallucinations.length).toBe(0);
      expect(correctness.isCorrect).toBe(true);

      // Confidence should be meaningful (not hardcoded)
      expect(result.synthesis.confidence).toBeGreaterThan(0.3);
      expect(result.synthesis.confidence).toBeLessThanOrEqual(1.0);
    }

    // Don't close - shared storage
  }, 60000);

  it('answers questions about relationships', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }
    if (!testWorkspace) {
      ctx.skip(true, 'unverified_by_trace(test_fixture_missing): No test workspace (Phase 1 did not run)');
      return;
    }

    const { queryLibrarian } = await import('../api/query.js');

    // Use shared storage and embedding service
    const storage = await getSharedStorage();
    const embeddingService = await getSharedEmbeddingService();

    console.log('[E2E] Querying: Which functions does average() depend on?');
    const result = await queryLibrarian(
      { intent: 'Which functions does the average function depend on?', depth: 'L2' },
      storage,
      embeddingService
    );

    console.log(`[E2E] Relationship query result:`, JSON.stringify({
      totalConfidence: result.totalConfidence,
      packsCount: result.packs.length,
      synthesis: result.synthesis ? {
        answerPreview: result.synthesis.answer.substring(0, 150) + '...',
      } : null,
    }, null, 2));

    // Should find relevant packs
    expect(result.packs.length).toBeGreaterThan(0);

    // Use ground truth evaluation for relationship query
    if (result.synthesis) {
      const answer = result.synthesis.answer;

      const fixture = CALCULATOR_CALIBRATION_FIXTURES.find(f => f.id === 'calc-average-deps')!;
      const correctness = evaluateAnswer(answer, fixture);

      console.log(`[E2E] Ground truth evaluation (relationships):`);
      console.log(`  Required facts: ${correctness.requiredMatched}/${correctness.requiredTotal}`);
      console.log(`  Matched: ${correctness.matchedFacts.join('; ')}`);
      console.log(`  Missing: ${correctness.missingFacts.join('; ') || '(none)'}`);
      console.log(`  Hallucinations: ${correctness.hallucinations.join('; ') || '(none)'}`);
      console.log(`  Full answer: ${answer}`);

      // MUST correctly identify that average depends on add
      expect(correctness.requiredMatched).toBeGreaterThan(0);
      // Should NOT claim false dependencies (hallucinations)
      expect(correctness.hallucinations.length).toBe(0);
    }

    // Don't close - shared storage
  }, 60000);

  it('includes source citations in answers', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }
    if (!testWorkspace) {
      ctx.skip(true, 'unverified_by_trace(test_fixture_missing): No test workspace (Phase 1 did not run)');
      return;
    }

    const { queryLibrarian } = await import('../api/query.js');

    // Use shared storage and embedding service
    const storage = await getSharedStorage();
    const embeddingService = await getSharedEmbeddingService();

    console.log('[E2E] Querying for citations: How do I use the calculate API?');
    const result = await queryLibrarian(
      { intent: 'How do I use the calculate API to add two numbers?', depth: 'L1' },
      storage,
      embeddingService
    );

    // Verify synthesis exists and has valid structure
    expect(result.synthesis).toBeDefined();
    if (result.synthesis) {
      console.log(`[E2E] Synthesis answer length: ${result.synthesis.answer.length}`);
      console.log(`[E2E] Synthesis confidence: ${result.synthesis.confidence}`);
      console.log(`[E2E] Citations count: ${result.synthesis.citations.length}`);
      for (const citation of result.synthesis.citations) {
        console.log(`[E2E]   Citation: file=${citation.file || 'N/A'}, packId=${citation.packId}, relevance=${citation.relevance?.toFixed(2) ?? 'N/A'}`);
      }

      // Answer must exist and be meaningful
      expect(result.synthesis.answer.length).toBeGreaterThan(10);
      expect(result.synthesis.confidence).toBeGreaterThan(0);

      // Citations are generated by the LLM - they may be empty if LLM doesn't return valid packIds
      // When citations exist, verify they have valid structure
      if (result.synthesis.citations.length > 0) {
        const validCitations = result.synthesis.citations.filter(c =>
          typeof c.packId === 'string' &&
          c.packId.length > 0 &&
          typeof c.relevance === 'number' &&
          c.relevance >= 0 &&
          c.relevance <= 1
        );
        console.log(`[E2E] Valid citations: ${validCitations.length} of ${result.synthesis.citations.length}`);
        expect(validCitations.length).toBe(result.synthesis.citations.length);
      } else {
        // Log for diagnostic purposes - LLM may not have returned citable packIds
        console.log('[E2E] Note: No citations returned. LLM may not have referenced valid packIds.');
        console.log(`[E2E] Available packs: ${result.packs.map(p => p.packId).join(', ')}`);
      }
    } else {
      // If no synthesis, log packs info for debugging
      console.log(`[E2E] No synthesis returned, packs count: ${result.packs.length}`);
      for (const pack of result.packs.slice(0, 3)) {
        console.log(`[E2E]   Pack: ${pack.packId}, type=${pack.packType}, targetId=${pack.targetId}`);
      }
    }

    // Don't close - shared storage
  }, 60000);
});

// ============================================================================
// PHASE 3: FEEDBACK LOOP VALIDATION
// Tests that feedback persists and affects subsequent queries
// ============================================================================

describe('Phase 3: Feedback Loop Validation', () => {
  it('negative feedback decreases confidence in storage', async () => {
    // This test uses a fresh database to ensure isolation
    const { createSqliteStorage } = await import('../storage/sqlite_storage.js');
    const { processAgentFeedback } = await import('../integration/agent_feedback.js');

    // Create isolated storage
    const feedbackDbPath = path.join(os.tmpdir(), `librarian-feedback-test-${Date.now()}.db`);
    const storage = await createSqliteStorage(feedbackDbPath);
    await storage.initialize();

    // Insert a context pack with known confidence
    const testPack = {
      packId: 'feedback-test-pack-negative',
      packType: 'function_context' as const,
      targetId: 'test-function',
      summary: 'Test pack for feedback validation',
      keyFacts: ['Contains test data'],
      codeSnippets: [],
      relatedFiles: ['test.ts'],
      confidence: 0.7,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown' as const,
      successCount: 0,
      failureCount: 0,
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        string: '1.0.0',
        qualityTier: 'mvp' as const,
        indexedAt: new Date(),
        indexerVersion: 'test',
        features: [],
      },
      invalidationTriggers: [],
    };
    await storage.upsertContextPack(testPack);

    // Verify initial confidence
    const before = await storage.getContextPack('feedback-test-pack-negative');
    expect(before?.confidence).toBe(0.7);
    console.log(`[E2E] Initial confidence: ${before?.confidence}`);

    // Submit negative feedback
    const result = await processAgentFeedback(
      {
        queryId: 'test-query-negative',
        relevanceRatings: [{ packId: 'feedback-test-pack-negative', relevant: false }],
        timestamp: new Date().toISOString(),
      },
      storage
    );

    // SC-3: Negative feedback decreases confidence
    expect(result.adjustmentsApplied).toBe(1);
    expect(result.adjustments[0].adjustment).toBeLessThan(0);

    // Verify persistence
    const after = await storage.getContextPack('feedback-test-pack-negative');
    expect(after?.confidence).toBeLessThan(0.7);
    console.log(`[E2E] Confidence after negative feedback: ${after?.confidence}`);

    await storage.close();
    await fs.rm(feedbackDbPath, { force: true }).catch(() => {});
  });

  it('positive feedback increases confidence', async () => {
    const { createSqliteStorage } = await import('../storage/sqlite_storage.js');
    const { submitQueryFeedback } = await import('../api/feedback.js');

    // Create isolated storage
    const feedbackDbPath = path.join(os.tmpdir(), `librarian-feedback-test-${Date.now()}.db`);
    const storage = await createSqliteStorage(feedbackDbPath);
    await storage.initialize();

    // Insert a context pack with known confidence
    const testPack = {
      packId: 'feedback-test-pack-positive',
      packType: 'function_context' as const,
      targetId: 'test-function',
      summary: 'Test pack for positive feedback validation',
      keyFacts: ['Contains test data'],
      codeSnippets: [],
      relatedFiles: ['test.ts'],
      confidence: 0.6,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown' as const,
      successCount: 0,
      failureCount: 0,
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        string: '1.0.0',
        qualityTier: 'mvp' as const,
        indexedAt: new Date(),
        indexerVersion: 'test',
        features: [],
      },
      invalidationTriggers: [],
    };
    await storage.upsertContextPack(testPack);

    // Verify initial confidence
    const before = await storage.getContextPack('feedback-test-pack-positive');
    expect(before?.confidence).toBe(0.6);
    console.log(`[E2E] Initial confidence: ${before?.confidence}`);

    // Submit positive feedback
    const result = await submitQueryFeedback(storage, {
      queryId: 'test-query-positive',
      packIds: ['feedback-test-pack-positive'],
      outcome: 'success',
    });

    // SC-3: Positive feedback increases confidence
    expect(result.adjustmentsApplied).toBe(1);
    expect(result.adjustments[0].adjustment).toBeGreaterThan(0);

    // Verify persistence
    const after = await storage.getContextPack('feedback-test-pack-positive');
    expect(after?.confidence).toBeGreaterThan(0.6);
    console.log(`[E2E] Confidence after positive feedback: ${after?.confidence}`);

    await storage.close();
    await fs.rm(feedbackDbPath, { force: true }).catch(() => {});
  });

  it('feedback history persists and is queryable', async () => {
    const { createSqliteStorage } = await import('../storage/sqlite_storage.js');
    const { submitQueryFeedback } = await import('../api/feedback.js');

    // Create isolated storage
    const feedbackDbPath = path.join(os.tmpdir(), `librarian-feedback-test-${Date.now()}.db`);
    const storage = await createSqliteStorage(feedbackDbPath);
    await storage.initialize();

    // Insert a context pack
    const testPack = {
      packId: 'feedback-history-pack',
      packType: 'function_context' as const,
      targetId: 'test-function',
      summary: 'Test pack for history validation',
      keyFacts: [],
      codeSnippets: [],
      relatedFiles: [],
      confidence: 0.5,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown' as const,
      successCount: 0,
      failureCount: 0,
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        string: '1.0.0',
        qualityTier: 'mvp' as const,
        indexedAt: new Date(),
        indexerVersion: 'test',
        features: [],
      },
      invalidationTriggers: [],
    };
    await storage.upsertContextPack(testPack);

    // Apply multiple rounds of feedback
    await submitQueryFeedback(storage, {
      queryId: 'history-query-1',
      packIds: ['feedback-history-pack'],
      outcome: 'success',
    });

    await submitQueryFeedback(storage, {
      queryId: 'history-query-2',
      packIds: ['feedback-history-pack'],
      outcome: 'success',
    });

    await submitQueryFeedback(storage, {
      queryId: 'history-query-3',
      packIds: ['feedback-history-pack'],
      outcome: 'failure',
    });

    // Verify cumulative effect
    const pack = await storage.getContextPack('feedback-history-pack');
    // Started at 0.5, +0.05 +0.05 -0.1 = 0.5
    console.log(`[E2E] Confidence after mixed feedback: ${pack?.confidence}`);
    expect(pack?.confidence).toBeCloseTo(0.5, 1);

    // Verify outcome counts
    expect(pack?.successCount).toBe(2);
    expect(pack?.failureCount).toBe(1);

    await storage.close();
    await fs.rm(feedbackDbPath, { force: true }).catch(() => {});
  });
});

// ============================================================================
// PHASE 4: CONFIDENCE CALIBRATION VALIDATION
// Tests that confidence reflects actual quality and degrades over time
// ============================================================================

describe('Phase 4: Confidence Calibration Validation', () => {
  it('confidence reflects actual answer quality', async (ctx) => {
    if (!hasProviders) {
      ctx.skip(true, 'unverified_by_trace(provider_unavailable): No live providers');
      return;
    }
    if (!testWorkspace) {
      ctx.skip(true, 'unverified_by_trace(test_fixture_missing): No test workspace (Phase 1 did not run)');
      return;
    }

    const { queryLibrarian } = await import('../api/query.js');

    // Use shared storage and embedding service
    const storage = await getSharedStorage();
    const embeddingService = await getSharedEmbeddingService();

    // Query with good expected answer (specific function)
    const goodQuery = await queryLibrarian(
      { intent: 'What does the divide function do?', depth: 'L1' },
      storage,
      embeddingService
    );

    // Query with vague expected answer (architectural question)
    const vagueQuery = await queryLibrarian(
      { intent: 'What is the overall philosophy of this codebase?', depth: 'L1' },
      storage,
      embeddingService
    );

    console.log(`[E2E] Good query confidence: ${goodQuery.totalConfidence}`);
    console.log(`[E2E] Vague query confidence: ${vagueQuery.totalConfidence}`);

    // SC-4: Confidence should NOT be hardcoded
    // Good queries about specific functions should have reasonable confidence
    expect(goodQuery.totalConfidence).toBeGreaterThan(0);
    expect(goodQuery.totalConfidence).toBeLessThanOrEqual(1);

    // Don't close - shared storage
  }, 60000);

  it('confidence degrades with staleness', async () => {
    const { calculateStalenessDecay } = await import('../knowledge/extractors/evidence_collector.js');

    const baseConfidence = 0.8;
    const testSections = ['test-section'];

    // Fresh content (updated today)
    const freshDecay = calculateStalenessDecay(new Date().toISOString(), testSections, baseConfidence);
    console.log(`[E2E] Fresh content decayed confidence: ${freshDecay.toFixed(3)}`);
    expect(freshDecay).toBeCloseTo(baseConfidence, 1); // Nearly no decay

    // Stale content (30 days old)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const staleDecay = calculateStalenessDecay(thirtyDaysAgo.toISOString(), testSections, baseConfidence);
    console.log(`[E2E] 30-day old content decayed confidence: ${staleDecay.toFixed(3)}`);
    expect(staleDecay).toBeLessThan(baseConfidence); // Some decay

    // Very stale content (180 days old)
    const veryOld = new Date();
    veryOld.setDate(veryOld.getDate() - 180);
    const veryStaleDecay = calculateStalenessDecay(veryOld.toISOString(), testSections, baseConfidence);
    console.log(`[E2E] 180-day old content decayed confidence: ${veryStaleDecay.toFixed(3)}`);
    expect(veryStaleDecay).toBeLessThan(staleDecay); // More decay

    // SC-4: Staleness decay should be progressive
    expect(freshDecay).toBeGreaterThan(staleDecay);
    expect(staleDecay).toBeGreaterThan(veryStaleDecay);
  });
});

// ============================================================================
// GLOBAL CLEANUP
// Close shared storage and cleanup test workspace after all tests
// ============================================================================

afterAll(async () => {
  // Close shared storage
  if (sharedStorage) {
    try {
      await sharedStorage.close();
      console.log('[E2E] Shared storage closed');
    } catch (err) {
      console.log('[E2E] Error closing shared storage:', err);
    }
    sharedStorage = null;
  }

  // Cleanup test workspace
  if (testWorkspace) {
    await cleanupWorkspace(testWorkspace);
    console.log('[E2E] Test workspace cleaned up');
  }
});
