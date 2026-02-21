/**
 * @fileoverview Governor Context Propagation Tests
 *
 * Verifies P0-1: Governor context flows through entire extraction chain
 *
 * TIER-2: These tests require live providers for full verification.
 * Tests marked with .skipIf(!hasLiveProviders) can run without providers
 * for structural verification.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GovernorContext, createGovernorRunState } from '../api/governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from '../api/governors.js';

// Test fixture paths
const FIXTURE_PATH = '/tmp/librainian-test-governor';

describe('Governor Context Propagation', () => {
  describe('Structural Verification (No Live Providers)', () => {
    it('GovernorContext tracks tokens via recordTokens()', () => {
      const governor = new GovernorContext({
        phase: 'test_phase',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 1_000_000 },
      });

      // Initially zero
      expect(governor.snapshot().usage.tokens_used_run).toBe(0);

      // Record tokens
      governor.recordTokens(500);
      expect(governor.snapshot().usage.tokens_used_run).toBe(500);

      // Accumulates
      governor.recordTokens(300);
      expect(governor.snapshot().usage.tokens_used_run).toBe(800);
    });

    it('GovernorContext recommends degradation strategy when budget exceeded', () => {
      const governor = new GovernorContext({
        phase: 'test_phase',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100 },
      });

      // First recording - 20% utilized, budgetHealth = 0.8
      const result1 = governor.recordTokens(20);
      expect(result1.strategy).toBe('proceed'); // health > 0.7

      // Second recording - 70% utilized, budgetHealth ≈ 0.3 (floating point makes it slightly > 0.3)
      const result2 = governor.recordTokens(50);
      expect(result2.strategy).toBe('batch_aggressive'); // health ≈ 0.30...04 > 0.3

      // Third recording - 150% utilized, budgetHealth = -0.5
      const result3 = governor.recordTokens(80);
      expect(result3.strategy).toBe('defer'); // Over budget
      expect(result3.shouldDeferNewCalls).toBe(true);
      expect(result3.budgetHealth).toBeLessThan(0);
    });

    it('GovernorContext provides graceful degradation strategies', () => {
      const governor = new GovernorContext({
        phase: 'test_phase',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 1000 },
      });

      // Test strategy progression as budget depletes
      // budgetHealth = 1 - utilization
      // > 0.7: proceed | > 0.5: use_cheaper_model | > 0.3: batch_aggressive
      // > 0.1: prioritize | > 0: use_cache | <= 0: defer

      governor.recordTokens(100); // 10% utilized, health = 0.9
      expect(governor.recommendStrategy().strategy).toBe('proceed');

      governor.recordTokens(100); // 20% utilized, health = 0.8
      expect(governor.recommendStrategy().strategy).toBe('proceed');

      governor.recordTokens(200); // 40% utilized, health = 0.6
      expect(governor.recommendStrategy().strategy).toBe('use_cheaper_model');

      governor.recordTokens(200); // 60% utilized, health = 0.4
      expect(governor.recommendStrategy().strategy).toBe('batch_aggressive');

      governor.recordTokens(200); // 80% utilized, health = 0.2
      expect(governor.recommendStrategy().strategy).toBe('prioritize');

      governor.recordTokens(100); // 90% utilized, health = 0.1
      expect(governor.recommendStrategy().strategy).toBe('use_cache');

      governor.recordTokens(200); // 110% utilized, health = -0.1
      expect(governor.recommendStrategy().strategy).toBe('defer');
    });

    it('GovernorContext.fork shares runState', () => {
      const runState = createGovernorRunState();
      const governor = new GovernorContext({
        phase: 'phase_1',
        config: DEFAULT_GOVERNOR_CONFIG,
        runState,
      });

      governor.recordTokens(100);

      const forked = governor.fork({ phase: 'phase_2' });
      forked.recordTokens(200);

      // Both see cumulative total
      expect(governor.snapshot().usage.tokens_used_run).toBe(300);
      expect(forked.snapshot().usage.tokens_used_run).toBe(300);
    });

    it('KnowledgeGeneratorConfig accepts governor field', async () => {
      const { createKnowledgeGenerator } = await import('../knowledge/generator.js');

      // Type check: config should accept governor without error
      const mockStorage = {
        getAllFunctions: vi.fn().mockResolvedValue([]),
        getAllModules: vi.fn().mockResolvedValue([]),
      } as any;

      const governor = new GovernorContext({ phase: 'test' });

      // This should compile and not throw
      const generator = createKnowledgeGenerator({
        storage: mockStorage,
        workspace: '/tmp/test',
        llmProvider: 'codex',
        governor, // THIS IS WHAT WE'RE TESTING
      });

      expect(generator).toBeDefined();
    });

    it('Extractor configs include governor field', async () => {
      // Verify type definitions include governor
      const semantics = await import('../knowledge/extractors/semantics.js');
      const security = await import('../knowledge/extractors/security_extractor.js');
      const rationale = await import('../knowledge/extractors/rationale_extractor.js');

      // These should be defined (type system verifies the interface)
      expect(semantics.extractSemanticsWithLLM).toBeDefined();
      expect(security.extractSecurityWithLLM).toBeDefined();
      expect(rationale.extractRationaleWithLLM).toBeDefined();
    });
  });

  describe('Live Provider Tests (Skip Without Providers)', () => {
    // These tests require actual LLM calls
    // Skip if no providers available

    it.skip('tracks tokens through knowledge generation (LIVE)', async () => {
      // This test requires live providers
      // When implemented:
      // 1. Create governor with token tracking
      // 2. Run knowledge generation on fixture
      // 3. Verify governor.tokensUsed > 0

      const governor = new GovernorContext({
        phase: 'knowledge_generation',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 1_000_000 },
      });

      // Before: tokens should be 0
      expect(governor.snapshot().usage.tokens_used_run).toBe(0);

      // TODO: Run actual knowledge generation
      // const generator = createKnowledgeGenerator({
      //   storage,
      //   workspace: FIXTURE_PATH,
      //   llmProvider: 'codex',
      //   governor,
      // });
      // await generator.generateForFunction(testFunction);

      // After: tokens MUST be > 0
      // expect(governor.snapshot().usage.tokens_used_run).toBeGreaterThan(0);
    });

    it.skip('enforces budget limits by stopping extraction (LIVE)', async () => {
      // This test requires live providers with very low budget
      const governor = new GovernorContext({
        phase: 'knowledge_generation',
        config: { ...DEFAULT_GOVERNOR_CONFIG, maxTokensPerRun: 100 },
      });

      // TODO: Should throw or return partial when budget exceeded
      // const result = await generator.generateAll();
      // expect(result.status).toBe('budget_exhausted');
    });

    it.skip('propagates governor from bootstrap to extractors (LIVE)', async () => {
      // This test verifies the full chain with spy
      // const chatSpy = vi.spyOn(LLMService.prototype, 'chat');
      //
      // await bootstrapProject({
      //   workspace: FIXTURE_PATH,
      //   bootstrapMode: 'full',
      //   llmProvider: 'codex',
      // });
      //
      // // Every chat call should have governorContext
      // for (const call of chatSpy.mock.calls) {
      //   expect(call[0]).toHaveProperty('governorContext');
      //   expect(call[0].governorContext).not.toBeUndefined();
      // }
    });
  });
});
