/**
 * A test adapter that returns predetermined responses in sequence.
 * Enables T1-tier testing: real pipeline flow, deterministic output.
 * Inspired by SWE-agent's PredeterminedTestModel pattern.
 *
 * Usage:
 *   const llm = new PredeterminedLlmService([
 *     '{"intent": "code_location"}',
 *     'The auth module is in src/auth/...',
 *   ]);
 *   registerLlmServiceAdapter(llm);
 *   // Pipeline calls -> get deterministic responses in order
 *
 * Dynamic matching:
 *   const llm = new PredeterminedLlmService([], {
 *     dynamicMatcher: (prompt) => {
 *       if (prompt.includes('intent')) return '{"intent": "code_location"}';
 *       return null; // fall through to sequential responses
 *     },
 *   });
 *
 * Recording mode:
 *   const recorder = PredeterminedLlmService.recording(realAdapter);
 *   // ... run pipeline ...
 *   const fixture = recorder.exportFixture();
 *   // Save fixture to disk, replay later with PredeterminedLlmService.fromFixture()
 */

import type { LlmChatOptions, LlmProviderHealth, LlmServiceAdapter } from './llm_service.js';

/** A single recorded call, capturing both the request and response. */
export interface PredeterminedCallRecord {
  /** The full prompt text sent (user messages concatenated). */
  prompt: string;
  /** The full LlmChatOptions passed to chat(). */
  options: LlmChatOptions;
  /** The response content returned. */
  response: string;
  /** The provider string returned. */
  provider: string;
  /** Timestamp (ms since epoch) when the call was made. */
  timestamp: number;
}

/** A fixture entry for serialization: prompt+response pairs. */
export interface PredeterminedFixtureEntry {
  prompt: string;
  response: string;
  provider?: string;
}

/** Options for constructing a PredeterminedLlmService. */
export interface PredeterminedLlmServiceOptions {
  /**
   * Optional dynamic matcher. Called before consuming from the sequential
   * response list. If it returns a non-null string, that string is used as
   * the response and no sequential response is consumed.
   */
  dynamicMatcher?: (prompt: string, options: LlmChatOptions) => string | null;

  /**
   * The provider string to return in chat results.
   * Defaults to 'predetermined'.
   */
  provider?: string;
}

/**
 * Extracts the user-visible prompt text from LlmChatOptions messages.
 * System messages are excluded; assistant messages are prefixed.
 */
function extractPromptText(options: LlmChatOptions): string {
  const parts: string[] = [];
  for (const message of options.messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      parts.push(message.content);
    } else {
      parts.push(`[assistant] ${message.content}`);
    }
  }
  return parts.join('\n\n');
}

export class PredeterminedLlmService implements LlmServiceAdapter {
  private responses: string[];
  private callIndex = 0;
  private calls: PredeterminedCallRecord[] = [];
  private dynamicMatcher: ((prompt: string, options: LlmChatOptions) => string | null) | null;
  private providerName: string;

  constructor(responses: string[], options?: PredeterminedLlmServiceOptions) {
    this.responses = [...responses];
    this.dynamicMatcher = options?.dynamicMatcher ?? null;
    this.providerName = options?.provider ?? 'predetermined';
  }

  /**
   * Create a PredeterminedLlmService from a fixture (array of prompt/response pairs).
   * Only the response field is used for sequential delivery.
   */
  static fromFixture(
    fixture: PredeterminedFixtureEntry[],
    options?: PredeterminedLlmServiceOptions,
  ): PredeterminedLlmService {
    const responses = fixture.map((entry) => entry.response);
    return new PredeterminedLlmService(responses, options);
  }

  /**
   * Create a recording wrapper around a real adapter.
   * All calls are forwarded to the delegate; responses are captured for export.
   */
  static recording(delegate: LlmServiceAdapter): RecordingLlmService {
    return new RecordingLlmService(delegate);
  }

  async chat(options: LlmChatOptions): Promise<{ content: string; provider: string }> {
    const prompt = extractPromptText(options);
    const timestamp = Date.now();

    // Try dynamic matcher first
    if (this.dynamicMatcher) {
      const dynamicResponse = this.dynamicMatcher(prompt, options);
      if (dynamicResponse !== null) {
        const record: PredeterminedCallRecord = {
          prompt,
          options,
          response: dynamicResponse,
          provider: this.providerName,
          timestamp,
        };
        this.calls.push(record);
        return { content: dynamicResponse, provider: this.providerName };
      }
    }

    // Fall through to sequential responses
    if (this.callIndex >= this.responses.length) {
      throw new Error(
        `PredeterminedLlmService exhausted: ${this.callIndex} calls made, ` +
        `only ${this.responses.length} responses provided. ` +
        `Last prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`,
      );
    }

    const response = this.responses[this.callIndex++];
    const record: PredeterminedCallRecord = {
      prompt,
      options,
      response,
      provider: this.providerName,
      timestamp,
    };
    this.calls.push(record);
    return { content: response, provider: this.providerName };
  }

  async checkClaudeHealth(_forceCheck?: boolean): Promise<LlmProviderHealth> {
    return {
      provider: 'claude',
      available: true,
      authenticated: true,
      lastCheck: Date.now(),
    };
  }

  async checkCodexHealth(_forceCheck?: boolean): Promise<LlmProviderHealth> {
    return {
      provider: 'codex',
      available: true,
      authenticated: true,
      lastCheck: Date.now(),
    };
  }

  // --- Inspection API for test assertions ---

  /** Number of calls that have been made so far. */
  get callCount(): number {
    return this.calls.length;
  }

  /** Number of sequential responses remaining (excludes dynamic matches). */
  get remainingResponses(): number {
    return Math.max(0, this.responses.length - this.callIndex);
  }

  /** Whether all sequential responses have been consumed. */
  get exhausted(): boolean {
    return this.callIndex >= this.responses.length;
  }

  /** Full history of all calls made (both sequential and dynamic). */
  get callHistory(): readonly PredeterminedCallRecord[] {
    return this.calls;
  }

  /** Get the Nth call record (0-indexed). Returns undefined if index is out of range. */
  getCall(index: number): PredeterminedCallRecord | undefined {
    return this.calls[index];
  }

  /** Get the prompt text from the Nth call (0-indexed). */
  getPrompt(index: number): string | undefined {
    return this.calls[index]?.prompt;
  }

  /** Reset state so the adapter can be reused (e.g., in a test afterEach). */
  reset(): void {
    this.callIndex = 0;
    this.calls = [];
  }

  /**
   * Assert that all sequential responses were consumed.
   * Throws if there are remaining responses.
   */
  assertExhausted(): void {
    if (!this.exhausted) {
      throw new Error(
        `PredeterminedLlmService: expected all responses to be consumed, ` +
        `but ${this.remainingResponses} of ${this.responses.length} remain ` +
        `(${this.callIndex} calls made).`,
      );
    }
  }

  /**
   * Export the call history as a fixture array suitable for JSON serialization.
   * Can be loaded later with PredeterminedLlmService.fromFixture().
   */
  exportFixture(): PredeterminedFixtureEntry[] {
    return this.calls.map((call) => ({
      prompt: call.prompt,
      response: call.response,
      provider: call.provider,
    }));
  }
}

/**
 * A recording adapter that wraps a real LlmServiceAdapter, forwarding all calls
 * while capturing prompts and responses. Use exportFixture() to extract the
 * recorded session as a replayable fixture.
 */
export class RecordingLlmService implements LlmServiceAdapter {
  private delegate: LlmServiceAdapter;
  private recorded: PredeterminedCallRecord[] = [];

  constructor(delegate: LlmServiceAdapter) {
    this.delegate = delegate;
  }

  async chat(options: LlmChatOptions): Promise<{ content: string; provider: string }> {
    const prompt = extractPromptText(options);
    const timestamp = Date.now();
    const result = await this.delegate.chat(options);
    this.recorded.push({
      prompt,
      options,
      response: result.content,
      provider: result.provider,
      timestamp,
    });
    return result;
  }

  async checkClaudeHealth(forceCheck?: boolean): Promise<LlmProviderHealth> {
    return this.delegate.checkClaudeHealth(forceCheck);
  }

  async checkCodexHealth(forceCheck?: boolean): Promise<LlmProviderHealth> {
    return this.delegate.checkCodexHealth(forceCheck);
  }

  /** Number of calls recorded so far. */
  get callCount(): number {
    return this.recorded.length;
  }

  /** Full history of recorded calls. */
  get callHistory(): readonly PredeterminedCallRecord[] {
    return this.recorded;
  }

  /**
   * Export recorded calls as a fixture array.
   * This can be written to disk and loaded via PredeterminedLlmService.fromFixture().
   */
  exportFixture(): PredeterminedFixtureEntry[] {
    return this.recorded.map((call) => ({
      prompt: call.prompt,
      response: call.response,
      provider: call.provider,
    }));
  }

  /**
   * Export recorded calls as a JSON string suitable for writing to a fixture file.
   */
  toFixtureJson(indent = 2): string {
    return JSON.stringify(this.exportFixture(), null, indent);
  }

  /** Reset recorded history. */
  reset(): void {
    this.recorded = [];
  }
}
