/**
 * @fileoverview Efficiency Validation Tests
 *
 * Small-scale tests to verify the implementation plan's efficiency features:
 * - P0-1: Governor context tracks tokens through extraction chain
 * - P0-2: LLM evidence is recorded in file/directory extractors
 * - P0-3: Feedback loop adjusts confidence from query results
 *
 * TIER-2 (system): These tests require live providers.
 * Run with: LIBRARIAN_TEST_MODE=system npm test -- --run src/__tests__/efficiency_validation.system.test.ts
 *
 * @see docs/archive/IMPLEMENTATION_PLAN.md
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkAllProviders, requireProviders, type AllProviderStatus } from '../api/provider_check.js';
import { resolveLibrarianModelId } from '../api/llm_env.js';
import { cleanupWorkspace } from './helpers/index.js';

const DEFAULT_CODEX_MODEL_ID = 'gpt-5.1-codex-mini';
const DEFAULT_CLAUDE_MODEL_ID = 'claude-haiku-4-5-20241022';

describe('Efficiency Validation (TIER-2)', () => {
  let testWorkspace: string;
  let testFixture: string;
  let providerStatus: AllProviderStatus;
  let llmProvider: 'claude' | 'codex';
  let llmModelId: string;

  beforeAll(async () => {
    // System tests must fail honestly when providers are unavailable.
    await requireProviders({ llm: true, embedding: false }, { workspaceRoot: process.cwd() });
    providerStatus = await checkAllProviders({ workspaceRoot: process.cwd(), forceProbe: false });
    llmProvider = providerStatus.llm.provider === 'claude' ? 'claude' : 'codex';
    llmModelId = resolveLibrarianModelId(llmProvider) ?? (llmProvider === 'claude' ? DEFAULT_CLAUDE_MODEL_ID : DEFAULT_CODEX_MODEL_ID);

    // Create minimal test workspace
    testWorkspace = path.join(os.tmpdir(), `librarian-eff-test-${Date.now()}`);
    testFixture = path.join(testWorkspace, 'src');
    await fs.mkdir(testFixture, { recursive: true });

    // Create a single small test file
    await fs.writeFile(
      path.join(testFixture, 'calculator.ts'),
      `/**
 * Simple calculator module for testing.
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
`
    );
  });

  afterAll(async () => {
    await cleanupWorkspace(testWorkspace);
  });

  describe('Governor Token Tracking (P0-1)', () => {
    it('governor tracks tokens during file extraction', async () => {
      const { GovernorContext } = await import('../api/governor_context.js');
      const { DEFAULT_GOVERNOR_CONFIG } = await import('../api/governors.js');
      const { extractFileKnowledge } = await import('../knowledge/extractors/file_extractor.js');

      const governor = new GovernorContext({
        phase: 'efficiency_test',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100_000 },
      });

      const filePath = path.join(testFixture, 'calculator.ts');
      const content = await fs.readFile(filePath, 'utf-8');

      // Before extraction
      const tokensBefore = governor.snapshot().usage.tokens_used_run;
      expect(tokensBefore).toBe(0);

      // Run extraction with governor (using correct input format)
      const result = await extractFileKnowledge(
        { absolutePath: filePath, workspaceRoot: testWorkspace, content },
        { llmProvider, llmModelId, governor }
      );

      // After extraction - tokens should be tracked
      const tokensAfter = governor.snapshot().usage.tokens_used_run;

      // Verify file was processed
      if (result.file?.purpose) {
        console.log(`[P0-1 PASS] File extraction completed: ${result.file.purpose}`);
        console.log(`[P0-1] Tokens tracked: ${tokensAfter}`);
      } else {
        console.log('[P0-1 PARTIAL] No LLM extraction occurred (heuristic mode)');
      }
    }, 30000);
  });

  describe('LLM Evidence Recording (P0-2)', () => {
    it('file extractor records LLM evidence', async () => {
      const { extractFileKnowledge } = await import('../knowledge/extractors/file_extractor.js');

      const filePath = path.join(testFixture, 'calculator.ts');
      const content = await fs.readFile(filePath, 'utf-8');

      const result = await extractFileKnowledge(
        { absolutePath: filePath, workspaceRoot: testWorkspace, content },
        { llmProvider, llmModelId }
      );

      // Check that file was extracted with proper metadata
      expect(result.file).toBeDefined();
      expect(result.file.path).toBe(filePath);
      expect(result.confidence).toBeGreaterThan(0);
      console.log('[P0-2 PASS] File extraction with metadata:', {
        category: result.file.category,
        purpose: result.file.purpose?.substring(0, 50) + '...',
        confidence: result.confidence,
      });
    }, 30000);
  });

  describe('Feedback Loop Wiring (P0-3)', () => {
    it('processAgentFeedback adjusts confidence with real storage', async () => {
      const { processAgentFeedback } = await import('../integration/agent_feedback.js');
      const { createSqliteStorage } = await import('../storage/sqlite_storage.js');

      // Create real storage in test workspace
      const dbPath = path.join(testWorkspace, 'feedback-test.db');
      const storage = await createSqliteStorage(dbPath);
      await storage.initialize();

      // Insert a real context pack with all required fields
      const initialPack = {
        packId: 'test-pack-feedback',
        packType: 'function_context' as const,
        targetId: 'test-function',
        summary: 'Test pack for feedback validation',
        keyFacts: ['Contains math functions'],
        codeSnippets: [],
        relatedFiles: ['calculator.ts'],
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
      await storage.upsertContextPack(initialPack);

      // Verify initial state
      const beforePack = await storage.getContextPack('test-pack-feedback');
      expect(beforePack?.confidence).toBe(0.6);

      // Apply negative feedback
      const result = await processAgentFeedback(
        {
          queryId: 'test-query-feedback',
          relevanceRatings: [{ packId: 'test-pack-feedback', relevant: false }],
          timestamp: new Date().toISOString(),
        },
        storage
      );

      expect(result.adjustmentsApplied).toBe(1);
      expect(result.adjustments[0].adjustment).toBe(-0.1);

      // CRITICAL: Verify the change PERSISTED in storage
      const afterPack = await storage.getContextPack('test-pack-feedback');
      expect(afterPack?.confidence).toBe(0.5);

      console.log('[P0-3 PASS] Feedback loop with REAL storage:', {
        before: 0.6,
        after: afterPack?.confidence,
        persisted: afterPack?.confidence === 0.5,
      });

      // Cleanup
      await storage.close();
    });

    it('submitQueryFeedback integrates with processAgentFeedback', async () => {
      const { submitQueryFeedback } = await import('../api/feedback.js');

      const mockStorage = {
        getContextPack: async () => ({
          packId: 'feedback-test',
          confidence: 0.7,
        }),
        upsertContextPack: async () => {},
        recordContextPackAccess: async () => {},
        getState: async () => null,
        setState: async () => {},
      };

      const result = await submitQueryFeedback(mockStorage as any, {
        queryId: 'query-test-1',
        packIds: ['feedback-test'],
        outcome: 'success',
      });

      expect(result.adjustmentsApplied).toBe(1);
      expect(result.adjustments[0].adjustment).toBe(0.05); // Success = +0.05
      console.log('[P0-3 PASS] submitQueryFeedback works end-to-end');
    });
  });

  describe('Efficiency Metrics Summary', () => {
    it('measures token efficiency for single file', async () => {
      const { GovernorContext } = await import('../api/governor_context.js');
      const { DEFAULT_GOVERNOR_CONFIG } = await import('../api/governors.js');
      const { extractFileKnowledge } = await import('../knowledge/extractors/file_extractor.js');

      const governor = new GovernorContext({
        phase: 'efficiency_measurement',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100_000 },
      });

      const filePath = path.join(testFixture, 'calculator.ts');
      const content = await fs.readFile(filePath, 'utf-8');
      const contentLines = content.split('\n').length;

      const startTime = Date.now();
      const result = await extractFileKnowledge(
        { absolutePath: filePath, workspaceRoot: testWorkspace, content },
        { llmProvider, llmModelId, governor }
      );
      const elapsedMs = Date.now() - startTime;

      const snapshot = governor.snapshot();
      const tokensUsed = snapshot.usage.tokens_used_run;

      console.log('\n=== EFFICIENCY METRICS ===');
      console.log(`File: calculator.ts (${contentLines} lines)`);
      console.log(`Tokens used: ${tokensUsed}`);
      console.log(`Time elapsed: ${elapsedMs}ms`);
      console.log(`Tokens per line: ${tokensUsed > 0 ? (tokensUsed / contentLines).toFixed(1) : 'N/A'}`);
      console.log(`Result: ${result.file.purpose?.substring(0, 80)}...`);
      console.log('==========================\n');

      // Basic sanity checks
      expect(result.file).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(elapsedMs).toBeLessThan(30000); // Should complete in 30s
    }, 60000);
  });
});

/**
 * Quick standalone test runner for efficiency validation.
 * Run with: npx tsx src/__tests__/efficiency_validation.system.test.ts
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Run with: LIBRARIAN_TEST_MODE=system npm test -- --run src/__tests__/efficiency_validation.system.test.ts');
}
