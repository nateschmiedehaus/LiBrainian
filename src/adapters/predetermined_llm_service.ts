/**
 * @fileoverview Predetermined LLM Service for deterministic testing.
 *
 * Provides an LlmServiceAdapter that returns preconfigured responses
 * in sequence, enabling tests to verify construction output quality
 * without requiring actual LLM calls.
 *
 * Usage:
 *   const service = new PredeterminedLlmService([
 *     { content: '{"safe": false, "blastRadius": 5}', provider: 'predetermined' },
 *   ]);
 *   registerLlmServiceAdapter(service);
 */

import type {
  LlmServiceAdapter,
  LlmChatOptions,
  LlmProviderHealth,
} from './llm_service.js';

export interface PredeterminedResponse {
  content: string;
  provider?: string;
}

export class PredeterminedLlmService implements LlmServiceAdapter {
  private readonly responses: PredeterminedResponse[];
  private callIndex = 0;
  private readonly callLog: LlmChatOptions[] = [];

  constructor(responses: PredeterminedResponse[]) {
    this.responses = responses;
  }

  async chat(options: LlmChatOptions): Promise<{ content: string; provider: string }> {
    this.callLog.push(options);
    if (this.callIndex >= this.responses.length) {
      // Cycle back to last response if exhausted
      const lastResponse = this.responses[this.responses.length - 1];
      if (!lastResponse) {
        throw new Error(
          'PredeterminedLlmService: No responses configured.'
        );
      }
      return {
        content: lastResponse.content,
        provider: lastResponse.provider ?? 'predetermined',
      };
    }
    const response = this.responses[this.callIndex]!;
    this.callIndex += 1;
    return {
      content: response.content,
      provider: response.provider ?? 'predetermined',
    };
  }

  async checkClaudeHealth(): Promise<LlmProviderHealth> {
    return {
      provider: 'claude',
      available: true,
      authenticated: true,
      lastCheck: Date.now(),
    };
  }

  async checkCodexHealth(): Promise<LlmProviderHealth> {
    return {
      provider: 'codex',
      available: false,
      authenticated: false,
      lastCheck: Date.now(),
    };
  }

  /**
   * Get the log of all chat calls made to this service.
   */
  getChatCallLog(): readonly LlmChatOptions[] {
    return this.callLog;
  }

  /**
   * Get how many chat calls have been made.
   */
  getChatCallCount(): number {
    return this.callLog.length;
  }

  /**
   * Reset the call index and log for reuse.
   */
  reset(): void {
    this.callIndex = 0;
    this.callLog.length = 0;
  }
}
