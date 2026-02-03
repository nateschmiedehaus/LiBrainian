/**
 * @fileoverview Tier-0 Tests for Provider Registry
 *
 * Deterministic tests that verify the Provider Registry implementation.
 * These tests use mock providers and require no external APIs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ProviderRegistry,
  getProviderRegistry,
  resetProviderRegistry,
  NoOpLLMProvider,
  type LLMProvider,
  type EmbeddingProvider,
  type ProviderStatus,
  type ProviderId,
  type LLMRequest,
  type LLMResponse,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ProviderConfig,
  type ModelInfo,
} from '../types.js';

// ============================================================================
// MOCK PROVIDERS
// ============================================================================

class MockLLMProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly type = 'llm' as const;
  readonly models: ModelInfo[] = [];
  readonly defaultModel = 'mock-model';

  private available: boolean;
  private latencyMs: number;

  constructor(
    id: ProviderId,
    name: string,
    options: { available?: boolean; latencyMs?: number } = {}
  ) {
    this.id = id;
    this.name = name;
    this.available = options.available ?? true;
    this.latencyMs = options.latencyMs ?? 10;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    await this.delay(this.latencyMs);
    return {
      available: this.available,
      reason: this.available ? 'Provider healthy' : 'Provider unavailable',
      latencyMs: this.latencyMs,
    };
  }

  getConfig(): ProviderConfig {
    return {};
  }

  async complete(_request: LLMRequest): Promise<LLMResponse> {
    return {
      id: 'mock-response',
      model: this.defaultModel,
      content: 'Mock response',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      latencyMs: this.latencyMs,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly type = 'embedding' as const;
  readonly models: ModelInfo[] = [];
  readonly defaultModel = 'mock-embedding';
  readonly dimensions = 384;

  private available: boolean;
  private latencyMs: number;

  constructor(
    id: ProviderId,
    name: string,
    options: { available?: boolean; latencyMs?: number } = {}
  ) {
    this.id = id;
    this.name = name;
    this.available = options.available ?? true;
    this.latencyMs = options.latencyMs ?? 5;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    await this.delay(this.latencyMs);
    return {
      available: this.available,
      reason: this.available ? 'Provider healthy' : 'Provider unavailable',
      latencyMs: this.latencyMs,
    };
  }

  getConfig(): ProviderConfig {
    return {};
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return {
      model: this.defaultModel,
      embeddings: [{ embedding: new Array(384).fill(0), index: 0 }],
      usage: { totalTokens: 10 },
      latencyMs: this.latencyMs,
    };
  }

  async embedOne(_text: string): Promise<number[]> {
    return new Array(384).fill(0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    resetProviderRegistry();
    registry = new ProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
  });

  describe('registration', () => {
    it('registers and retrieves LLM provider', () => {
      const provider = new MockLLMProvider('anthropic', 'Anthropic');
      registry.registerLLM(provider);

      expect(registry.hasLLM()).toBe(true);
      expect(registry.getLLM()).toBe(provider);
      expect(registry.getLLM('anthropic')).toBe(provider);
    });

    it('registers and retrieves embedding provider', () => {
      const provider = new MockEmbeddingProvider('openai', 'OpenAI');
      registry.registerEmbedding(provider);

      expect(registry.hasEmbedding()).toBe(true);
      expect(registry.getEmbedding()).toBe(provider);
      expect(registry.getEmbedding('openai')).toBe(provider);
    });

    it('sets default provider correctly', () => {
      const provider1 = new MockLLMProvider('anthropic', 'Anthropic');
      const provider2 = new MockLLMProvider('openai', 'OpenAI');

      registry.registerLLM(provider1);
      registry.registerLLM(provider2, true); // Set as default

      expect(registry.getLLM()).toBe(provider2);
    });

    it('first registered provider becomes default', () => {
      const provider1 = new MockLLMProvider('anthropic', 'Anthropic');
      const provider2 = new MockLLMProvider('openai', 'OpenAI');

      registry.registerLLM(provider1);
      registry.registerLLM(provider2);

      expect(registry.getLLM()).toBe(provider1);
    });

    it('lists registered providers', () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic'));
      registry.registerEmbedding(new MockEmbeddingProvider('openai', 'OpenAI'));

      const providers = registry.getRegisteredProviders();
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
    });

    it('clears all providers', () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic'));
      registry.registerEmbedding(new MockEmbeddingProvider('openai', 'OpenAI'));

      registry.clear();

      expect(registry.hasLLM()).toBe(false);
      expect(registry.hasEmbedding()).toBe(false);
      expect(registry.getRegisteredProviders()).toHaveLength(0);
    });
  });

  describe('status', () => {
    it('returns status for all providers', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic'));
      registry.registerEmbedding(new MockEmbeddingProvider('openai', 'OpenAI'));

      const status = await registry.getStatus();

      expect(status.anthropic).toBeDefined();
      expect(status.anthropic.available).toBe(true);
      expect(status.openai).toBeDefined();
      expect(status.openai.available).toBe(true);
    });

    it('reports unavailable providers', async () => {
      registry.registerLLM(
        new MockLLMProvider('anthropic', 'Anthropic', { available: false })
      );

      const status = await registry.getStatus();

      expect(status.anthropic.available).toBe(false);
    });
  });

  describe('getHealthy', () => {
    it('returns only healthy providers', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic', { available: true }));
      registry.registerLLM(new MockLLMProvider('openai', 'OpenAI', { available: false }));
      registry.registerEmbedding(new MockEmbeddingProvider('openai', 'OpenAI', { available: true }));

      const healthy = await registry.getHealthy({ timeout: 1000 });

      expect(healthy.length).toBe(2);
      expect(healthy.some((h) => h.id === 'anthropic' && h.type === 'llm')).toBe(true);
      expect(healthy.some((h) => h.id === 'openai' && h.type === 'embedding')).toBe(true);
    });

    it('filters by provider type', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic'));
      registry.registerEmbedding(new MockEmbeddingProvider('openai', 'OpenAI'));

      const healthy = await registry.getHealthy({
        timeout: 1000,
        includeTypes: ['llm'],
      });

      expect(healthy.length).toBe(1);
      expect(healthy[0].type).toBe('llm');
    });

    it('sorts by latency (fastest first)', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic', { latencyMs: 50 }));
      registry.registerLLM(new MockLLMProvider('openai', 'OpenAI', { latencyMs: 10 }));

      const healthy = await registry.getHealthy({ timeout: 1000 });

      // Both should be healthy but OpenAI should be first (lower latency)
      expect(healthy[0].id).toBe('openai');
      expect(healthy[1].id).toBe('anthropic');
    });

    it('times out slow providers', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic', { latencyMs: 100 }));

      const healthy = await registry.getHealthy({ timeout: 10 });

      expect(healthy.length).toBe(0);
    });

    it('includes latency and timestamp in results', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic', { latencyMs: 20 }));

      const healthy = await registry.getHealthy({ timeout: 1000 });

      expect(healthy.length).toBe(1);
      // Allow minor timer jitter in constrained environments.
      expect(healthy[0].latencyMs).toBeGreaterThanOrEqual(15);
      expect(healthy[0].checkedAt).toBeInstanceOf(Date);
    });
  });

  describe('getBest', () => {
    it('returns best LLM provider', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic', { latencyMs: 50 }));
      registry.registerLLM(new MockLLMProvider('openai', 'OpenAI', { latencyMs: 10 }));

      const best = await registry.getBest('llm', { timeout: 1000 });

      expect(best).not.toBeNull();
      expect(best?.id).toBe('openai'); // Fastest
    });

    it('returns null when no healthy provider', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic', { available: false }));

      const best = await registry.getBest('llm', { timeout: 1000 });

      expect(best).toBeNull();
    });

    it('returns null when no provider of requested type', async () => {
      registry.registerLLM(new MockLLMProvider('anthropic', 'Anthropic'));

      const best = await registry.getBest('embedding', { timeout: 1000 });

      expect(best).toBeNull();
    });
  });

  describe('global registry', () => {
    it('provides singleton access', () => {
      const registry1 = getProviderRegistry();
      const registry2 = getProviderRegistry();

      expect(registry1).toBe(registry2);
    });

    it('resets global registry', () => {
      const registry1 = getProviderRegistry();
      registry1.registerLLM(new MockLLMProvider('anthropic', 'Anthropic'));

      resetProviderRegistry();
      const registry2 = getProviderRegistry();

      expect(registry2).not.toBe(registry1);
      expect(registry2.hasLLM()).toBe(false);
    });
  });

  describe('NoOpLLMProvider', () => {
    it('is always available', async () => {
      const provider = new NoOpLLMProvider();
      const status = await provider.checkAvailability();

      expect(status.available).toBe(true);
    });

    it('returns empty response', async () => {
      const provider = new NoOpLLMProvider();
      const response = await provider.complete({
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(response.content).toBe('');
      expect(response.usage.totalTokens).toBe(0);
    });
  });
});
