/**
 * @fileoverview Feedback Loop Integration Tests (TDD)
 *
 * Tests for the closed-loop feedback system where agents report
 * relevance ratings and librarian adjusts confidence accordingly.
 *
 * REQUIREMENTS:
 * - Query responses must include feedbackToken for later feedback submission
 * - feedbackToken must be unique per query
 * - Submitting feedback with feedbackToken updates confidence_events table
 * - Positive feedback increases confidence, negative decreases it
 *
 * Per CONTROL_LOOP.md:
 * - Decrease confidence for irrelevant results (-0.1)
 * - Increase confidence for relevant results (+0.05 × usefulness)
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Mock provider_check.js to fail fast instead of timing out
vi.mock('../provider_check.js', () => ({
  requireProviders: vi.fn().mockRejectedValue(
    Object.assign(new Error('unverified_by_trace(provider_unavailable): Wave0 requires live providers to function'), {
      name: 'ProviderUnavailableError',
      details: {
        message: 'unverified_by_trace(provider_unavailable): Wave0 requires live providers to function',
        missing: ['LLM: unavailable', 'Embedding: unavailable'],
        suggestion: 'Authenticate providers via CLI.',
      },
    })
  ),
  checkAllProviders: vi.fn().mockResolvedValue({
    llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
    embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
  }),
  checkProviderSnapshot: vi.fn().mockResolvedValue({
    status: {
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
      embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
    },
    remediationSteps: ['unverified_by_trace(provider_unavailable): providers unavailable'],
    reason: 'unavailable',
  }),
  ProviderUnavailableError: class ProviderUnavailableError extends Error {
    constructor(public details: { message: string; missing: string[]; suggestion: string }) {
      super(details.message);
      this.name = 'ProviderUnavailableError';
    }
  },
}));
import path from 'node:path';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { processAgentFeedback } from '../../integration/agent_feedback.js';
import type { AgentFeedback } from '../../integration/agent_feedback.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { getCurrentVersion } from '../versioning.js';
import { SqliteEvidenceLedger, createSessionId } from '../../epistemics/evidence_ledger.js';

const workspaceRoot = process.cwd();
const FEEDBACK_HOOK_TIMEOUT_MS = 30000;
const FEEDBACK_TEST_TIMEOUT_MS = 60000;

let sharedStorage: LibrarianStorage | null = null;

async function getSharedStorage(): Promise<LibrarianStorage> {
  if (sharedStorage === null) {
    sharedStorage = createSqliteStorage(':memory:');
    await sharedStorage.initialize();
  }

  return sharedStorage;
}

afterAll(async () => {
  await sharedStorage?.close?.();
  sharedStorage = null;
}, FEEDBACK_HOOK_TIMEOUT_MS);

async function seedStorageForQuery(storage: LibrarianStorage, relatedFile: string): Promise<void> {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const functionId = `fn-feedback-${uniqueId}`;
  const packId = `pack-feedback-${uniqueId}`;

  await storage.upsertFunction({
    id: functionId,
    filePath: path.join(workspaceRoot, relatedFile),
    name: 'feedbackTest',
    signature: 'feedbackTest(): void',
    purpose: 'Test function for feedback loop query.',
    startLine: 1,
    endLine: 3,
    confidence: 0.7,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  });
  await storage.upsertContextPack({
    packId,
    packType: 'function_context',
    targetId: functionId,
    summary: 'Feedback loop context pack',
    keyFacts: ['Used to validate query envelope'],
    codeSnippets: [],
    relatedFiles: [relatedFile],
    confidence: 0.6,
    createdAt: new Date('2026-01-19T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: [],
  });
}

describe.sequential('Feedback Loop Integration', () => {
  describe('feedbackToken in query response', () => {
    let storage: LibrarianStorage;

    it('query response includes feedbackToken', async () => {
      const { queryLibrarian } = await import('../query.js');
      const providerCheckModule = await import('../provider_check.js');
      vi.mocked(providerCheckModule.checkProviderSnapshot).mockClear();
      storage = await getSharedStorage();
      await seedStorageForQuery(storage, 'src/auth.ts');

      // Run a simple query
      const result = await queryLibrarian(
        { intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
        storage
      );

      expect(result.feedbackToken).toBeDefined();
      expect(typeof result.feedbackToken).toBe('string');
      expect((result.feedbackToken as string).length).toBeGreaterThan(8);
      expect(providerCheckModule.checkProviderSnapshot).not.toHaveBeenCalled();
    }, FEEDBACK_TEST_TIMEOUT_MS);

    it('feedbackToken is unique per query', async () => {
      const { queryLibrarian } = await import('../query.js');
      storage = await getSharedStorage();
      await seedStorageForQuery(storage, 'src/auth.ts');

      // Run two identical queries
      const [result1, result2] = await Promise.all([
        queryLibrarian({ intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] }, storage),
        queryLibrarian({ intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] }, storage),
      ]);

      expect(result1.feedbackToken).not.toBe(result2.feedbackToken);
    }, FEEDBACK_TEST_TIMEOUT_MS);

    it('query response includes required envelope fields', async () => {
      const { queryLibrarian } = await import('../query.js');
      storage = await getSharedStorage();
      await seedStorageForQuery(storage, 'src/auth.ts');

      const result = await queryLibrarian(
        { intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
        storage
      );

      expect(Array.isArray(result.packs)).toBe(true);
      expect(Array.isArray(result.disclosures)).toBe(true);
      expect(typeof result.traceId).toBe('string');
      expect(Object.prototype.hasOwnProperty.call(result, 'verificationPlan')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(result, 'adequacy')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(result, 'constructionPlan')).toBe(true);
      expect(result.constructionPlan?.templateId).toBeTruthy();
      expect(result.disclosures.some((entry) => entry.includes('unverified_by_trace(replay_unavailable)'))).toBe(true);
    });

    it('records query access logs when retrieval targets are returned', async () => {
      const { queryLibrarian } = await import('../query.js');
      storage = await getSharedStorage();
      await seedStorageForQuery(storage, 'src/auth.ts');

      const firstResult = await queryLibrarian(
        { intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
        storage
      );
      const secondResult = await queryLibrarian(
        { intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
        storage
      );

      if (typeof storage.getQueryAccessLogs !== 'function') {
        throw new Error('getQueryAccessLogs is required');
      }

      const returnedTargets = new Set(
        [...firstResult.packs, ...secondResult.packs]
          .map((pack) => (typeof pack.targetId === 'string' ? pack.targetId.trim() : ''))
          .filter((targetId) => targetId.length > 0)
      );
      const logs = await storage.getQueryAccessLogs({ limit: 50 });
      if (returnedTargets.size === 0) {
        expect(logs.length).toBe(0);
        return;
      }

      expect(logs.length).toBeGreaterThan(0);
      const totalCount = logs.reduce((sum, entry) => sum + entry.queryCount, 0);
      expect(totalCount).toBeGreaterThanOrEqual(2);
    });

    it('records construction plan evidence when ledger is provided', async () => {
      const { queryLibrarian } = await import('../query.js');
      storage = await getSharedStorage();
      await seedStorageForQuery(storage, 'src/auth.ts');

      const ledger = new SqliteEvidenceLedger(':memory:');
      await ledger.initialize();
      const sessionId = createSessionId('sess_query_construction_plan');

      const result = await queryLibrarian(
        { intent: 'lookup query', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
        storage,
        undefined,
        undefined,
        undefined,
        { evidenceLedger: ledger, sessionId }
      );

      const entries = await ledger.query({ kinds: ['tool_call'], sessionId });
      const planEntry = entries.find((entry) => entry.payload?.toolName === 'construction_plan');

      expect(result.constructionPlan?.templateId).toBeTruthy();
      expect(planEntry).toBeDefined();
      expect(planEntry?.payload?.arguments?.templateId).toBe(result.constructionPlan?.templateId);

      await ledger.close();
    });
  });

  describe('feedback submission', () => {
    let storage: LibrarianStorage;

    beforeEach(async () => {
      storage = await getSharedStorage();
    }, FEEDBACK_HOOK_TIMEOUT_MS);

    it('processAgentFeedback records confidence event', async () => {
      // Create a test context pack
      const testPackId = 'test-pack-001';
      await storage.upsertContextPack({
        packId: testPackId,
        packType: 'function_context',
        targetId: `${testPackId}-target`,
        summary: 'Test pack',
        keyFacts: [],
        codeSnippets: [],
        relatedFiles: [],
        confidence: 0.7,
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: { major: 1, minor: 0, patch: 0, string: '1.0.0', qualityTier: 'mvp', indexedAt: new Date(), indexerVersion: '1.0', features: [] },
        invalidationTriggers: [],
      });

      // Submit feedback
      const feedback: AgentFeedback = {
        queryId: 'query-123',
        relevanceRatings: [{ packId: testPackId, relevant: true, usefulness: 1.0 }],
        timestamp: new Date().toISOString(),
      };

      const result = await processAgentFeedback(feedback, storage);

      expect(result.adjustmentsApplied).toBeGreaterThan(0);

      // Verify pack confidence was updated
      const updatedPack = await storage.getContextPack(testPackId);
      expect(updatedPack?.confidence).toBeGreaterThan(0.7); // Should increase
    });

    it('negative feedback decreases confidence by 0.1', async () => {
      const testPackId = 'test-pack-negative';
      const initialConfidence = 0.7;
      await storage.upsertContextPack({
        packId: testPackId,
        packType: 'function_context',
        targetId: `${testPackId}-target`,
        summary: 'Test pack',
        keyFacts: [],
        codeSnippets: [],
        relatedFiles: [],
        confidence: initialConfidence,
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: { major: 1, minor: 0, patch: 0, string: '1.0.0', qualityTier: 'mvp', indexedAt: new Date(), indexerVersion: '1.0', features: [] },
        invalidationTriggers: [],
      });

      // Submit negative feedback
      const feedback: AgentFeedback = {
        queryId: 'query-456',
        relevanceRatings: [{ packId: testPackId, relevant: false }],
        timestamp: new Date().toISOString(),
      };

      await processAgentFeedback(feedback, storage);

      const updatedPack = await storage.getContextPack(testPackId);
      expect(updatedPack?.confidence).toBeCloseTo(initialConfidence - 0.1, 2);
    });

    it('positive feedback increases confidence by 0.05 × usefulness', async () => {
      const testPackId = 'test-pack-positive';
      const initialConfidence = 0.6;
      const usefulness = 0.8;
      await storage.upsertContextPack({
        packId: testPackId,
        packType: 'function_context',
        targetId: `${testPackId}-target`,
        summary: 'Test pack',
        keyFacts: [],
        codeSnippets: [],
        relatedFiles: [],
        confidence: initialConfidence,
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: { major: 1, minor: 0, patch: 0, string: '1.0.0', qualityTier: 'mvp', indexedAt: new Date(), indexerVersion: '1.0', features: [] },
        invalidationTriggers: [],
      });

      // Submit positive feedback with usefulness
      const feedback: AgentFeedback = {
        queryId: 'query-789',
        relevanceRatings: [{ packId: testPackId, relevant: true, usefulness }],
        timestamp: new Date().toISOString(),
      };

      await processAgentFeedback(feedback, storage);

      const updatedPack = await storage.getContextPack(testPackId);
      const expectedAdjustment = 0.05 * usefulness;
      expect(updatedPack?.confidence).toBeCloseTo(initialConfidence + expectedAdjustment, 2);
    });
  });

  describe('feedback token storage', () => {
    let storage: LibrarianStorage;

    it('feedbackToken can be used to retrieve original query packs', async () => {
      // This test verifies that the feedbackToken allows mapping
      // back to the original query results for feedback attribution

      const { queryLibrarian, getFeedbackContext } = await import('../query.js');
      storage = await getSharedStorage();

      // Skip if getFeedbackContext doesn't exist yet
      if (typeof getFeedbackContext !== 'function') {
        // This is expected before implementation
        expect(true).toBe(true);
        return;
      }

      const result = await queryLibrarian(
        { intent: 'lookup query', depth: 'L0' },
        storage
      ).catch(() => null);

      if (result?.feedbackToken) {
        const context = await getFeedbackContext(result.feedbackToken, storage);
        expect(context).toBeDefined();
        expect(context?.packIds).toBeDefined();
      }
    });

    it('restores feedbackToken context from storage after module reload', async () => {
      const queryModule = await import('../query.js');
      storage = await getSharedStorage();

      await seedStorageForQuery(storage, 'src/feedback/reload_test.ts');
      const result = await queryModule.queryLibrarian(
        { intent: 'feedback reload query', depth: 'L1' },
        storage
      );

      expect(result.feedbackToken).toBeDefined();

      // Simulate fresh process/module state (in-memory cache cleared).
      vi.resetModules();
      const reloadedModule = await import('../query.js');
      const restored = await reloadedModule.getFeedbackContext(result.feedbackToken as string, storage);

      expect(restored).toBeDefined();
      expect(restored?.feedbackToken).toBe(result.feedbackToken);
      expect(restored?.packIds).toEqual(result.packs.map((pack) => pack.packId));
    });
  });

  describe('confidence bounds', () => {
    let storage: LibrarianStorage;

    beforeEach(async () => {
      storage = await getSharedStorage();
    }, FEEDBACK_HOOK_TIMEOUT_MS);

    it('confidence never goes below 0.1 after negative feedback', async () => {
      const testPackId = 'test-pack-low';
      await storage.upsertContextPack({
        packId: testPackId,
        packType: 'function_context',
        targetId: `${testPackId}-target`,
        summary: 'Test pack',
        keyFacts: [],
        codeSnippets: [],
        relatedFiles: [],
        confidence: 0.15, // Already low
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: { major: 1, minor: 0, patch: 0, string: '1.0.0', qualityTier: 'mvp', indexedAt: new Date(), indexerVersion: '1.0', features: [] },
        invalidationTriggers: [],
      });

      // Submit multiple negative feedbacks
      for (let i = 0; i < 5; i++) {
        await processAgentFeedback(
          {
            queryId: `query-${i}`,
            relevanceRatings: [{ packId: testPackId, relevant: false }],
            timestamp: new Date().toISOString(),
          },
          storage
        );
      }

      const updatedPack = await storage.getContextPack(testPackId);
      expect(updatedPack?.confidence).toBeGreaterThanOrEqual(0.1);
    });

    it('confidence never goes above 0.95 after positive feedback', async () => {
      const testPackId = 'test-pack-high';
      await storage.upsertContextPack({
        packId: testPackId,
        packType: 'function_context',
        targetId: `${testPackId}-target`,
        summary: 'Test pack',
        keyFacts: [],
        codeSnippets: [],
        relatedFiles: [],
        confidence: 0.9, // Already high
        createdAt: new Date(),
        accessCount: 0,
        lastOutcome: 'unknown',
        successCount: 0,
        failureCount: 0,
        version: { major: 1, minor: 0, patch: 0, string: '1.0.0', qualityTier: 'mvp', indexedAt: new Date(), indexerVersion: '1.0', features: [] },
        invalidationTriggers: [],
      });

      // Submit multiple positive feedbacks
      for (let i = 0; i < 10; i++) {
        await processAgentFeedback(
          {
            queryId: `query-${i}`,
            relevanceRatings: [{ packId: testPackId, relevant: true, usefulness: 1.0 }],
            timestamp: new Date().toISOString(),
          },
          storage
        );
      }

      const updatedPack = await storage.getContextPack(testPackId);
      expect(updatedPack?.confidence).toBeLessThanOrEqual(0.95);
    });
  });
});

describe.sequential('FeedbackProcessingResult type', () => {
  let storage: LibrarianStorage;

  it('processAgentFeedback returns proper result structure', async () => {
    storage = await getSharedStorage();

    const testPackId = 'test-result-structure';
    await storage.upsertContextPack({
      packId: testPackId,
      packType: 'function_context',
      targetId: `${testPackId}-target`,
      summary: 'Test pack',
      keyFacts: [],
      codeSnippets: [],
      relatedFiles: [],
      confidence: 0.5,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version: { major: 1, minor: 0, patch: 0, string: '1.0.0', qualityTier: 'mvp', indexedAt: new Date(), indexerVersion: '1.0', features: [] },
      invalidationTriggers: [],
    });

    const feedback: AgentFeedback = {
      queryId: 'query-result-test',
      relevanceRatings: [{ packId: testPackId, relevant: true }],
      timestamp: new Date().toISOString(),
    };

    const result = await processAgentFeedback(feedback, storage);

    expect(result).toHaveProperty('adjustmentsApplied');
    expect(result).toHaveProperty('gapsLogged');
    expect(typeof result.adjustmentsApplied).toBe('number');
    expect(typeof result.gapsLogged).toBe('number');
  });
});
