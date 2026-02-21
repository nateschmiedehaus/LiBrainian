/**
 * @fileoverview LLM Service Stub
 *
 * Provides a minimal LLM service interface for standalone librainian.
 * In Wave0 context, the real LLMService is injected.
 *
 * @packageDocumentation
 */

import { getProviderRegistry, type LLMProvider, type LLMRequest, type LLMResponse } from '../providers/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ProviderHealth {
  available: boolean;
  authenticated: boolean;
  reason?: string;
  error?: string;
  lastCheck?: number;
}

export interface LLMServiceOptions {
  provider?: 'anthropic' | 'openai' | 'google' | 'mistral' | 'custom';
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// ============================================================================
// LLM SERVICE
// ============================================================================

/**
 * Minimal LLM service for standalone librainian
 */
export class LLMService {
  private provider?: LLMProvider;

  constructor(private options: LLMServiceOptions = {}) {
    // Try to get provider from registry
    const registry = getProviderRegistry();
    this.provider = registry.getLLM();
  }

  /**
   * Check if LLM is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.provider) return false;
    const status = await this.provider.checkAvailability();
    return status.available;
  }

  /**
   * Get provider health status
   */
  async getHealth(): Promise<ProviderHealth> {
    if (!this.provider) {
      return { available: false, authenticated: false, reason: 'No LLM provider configured' };
    }
    const status = await this.provider.checkAvailability();
    return {
      available: status.available,
      authenticated: status.available,
      reason: status.reason,
      lastCheck: status.lastCheck,
    };
  }

  /**
   * Complete a prompt
   */
  async complete(
    prompt: string,
    options: { maxTokens?: number; temperature?: number; model?: string } = {}
  ): Promise<LLMResponse> {
    if (!this.provider) {
      throw new Error('No LLM provider configured');
    }

    const request: LLMRequest = {
      model: options.model ?? this.options.model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: options.maxTokens ?? this.options.maxTokens ?? 4096,
      temperature: options.temperature ?? this.options.temperature ?? 0,
    };

    return this.provider.complete(request);
  }

  /**
   * Complete with system prompt
   */
  async completeWithSystem(
    systemPrompt: string,
    userPrompt: string,
    options: { maxTokens?: number; temperature?: number; model?: string } = {}
  ): Promise<LLMResponse> {
    if (!this.provider) {
      throw new Error('No LLM provider configured');
    }

    const request: LLMRequest = {
      model: options.model ?? this.options.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: options.maxTokens ?? this.options.maxTokens ?? 4096,
      temperature: options.temperature ?? this.options.temperature ?? 0,
    };

    return this.provider.complete(request);
  }

  /**
   * Check Claude/Anthropic provider health
   */
  async checkClaudeHealth(forceProbe = false): Promise<ProviderHealth> {
    const registry = getProviderRegistry();
    const claude = registry.getLLM('anthropic');

    if (!claude) {
      return {
        available: false,
        authenticated: false,
        reason: 'Anthropic provider not configured',
        lastCheck: Date.now(),
      };
    }

    const status = await claude.checkAvailability();
    return {
      available: status.available,
      authenticated: status.available,
      reason: status.reason,
      lastCheck: status.lastCheck ?? Date.now(),
    };
  }

  /**
   * Check OpenAI/Codex provider health
   */
  async checkCodexHealth(forceProbe = false): Promise<ProviderHealth> {
    const registry = getProviderRegistry();
    const openai = registry.getLLM('openai');

    if (!openai) {
      return {
        available: false,
        authenticated: false,
        reason: 'OpenAI provider not configured',
        lastCheck: Date.now(),
      };
    }

    const status = await openai.checkAvailability();
    return {
      available: status.available,
      authenticated: status.available,
      reason: status.reason,
      lastCheck: status.lastCheck ?? Date.now(),
    };
  }

  /**
   * Chat with messages (Wave0 compatibility)
   */
  async chat(options: {
    provider?: string;
    modelId?: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    governorContext?: unknown;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    if (!this.provider) {
      throw new Error('No LLM provider configured');
    }

    const request: LLMRequest = {
      model: options.modelId ?? this.options.model,
      messages: options.messages,
      maxTokens: options.maxTokens ?? this.options.maxTokens ?? 4096,
      temperature: options.temperature ?? this.options.temperature ?? 0,
    };

    const response = await this.provider.complete(request);
    return {
      content: response.content,
      usage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultService: LLMService | undefined;

/**
 * Get injected default LLM service.
 *
 * This module is a legacy compatibility shim. New code must route all LLM usage
 * through the adapter layer (`src/adapters/llm_service.ts`).
 */
export function getLLMService(): LLMService {
  if (!defaultService) {
    throw new Error(
      'unverified_by_trace(llm_service_unconfigured): LLMService must be injected via setLLMService() or accessed via adapters'
    );
  }
  return defaultService;
}

/**
 * Set default LLM service (for dependency injection)
 */
export function setLLMService(service: LLMService): void {
  defaultService = service;
}
