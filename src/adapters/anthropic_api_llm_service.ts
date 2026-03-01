import { logInfo, logWarning } from '../telemetry/logger.js';
import type { LlmChatMessage, LlmChatOptions, LlmProviderHealth, LlmServiceFactory } from './llm_service.js';
import {
  classifyProviderFailure,
  getActiveProviderFailures,
  recordProviderFailure,
  recordProviderSuccess,
  resolveProviderWorkspaceRoot,
} from '../utils/provider_failures.js';
import { isPrivacyModeStrict } from '../utils/runtime_controls.js';
import { appendPrivacyAuditEvent } from '../security/privacy_audit.js';

type GovernorContextLike = { checkBudget: () => void; recordTokens: (tokens: number) => void; recordRetry?: () => void };

type ChatResult = { content: string; provider: string };

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-20250514';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_TOKENS = 4096;

class AsyncSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {
    if (!Number.isFinite(this.max) || this.max <= 0) {
      this.max = 1;
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

function coercePositiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function coerceTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function estimateTokenCount(text: string): number {
  const trimmed = String(text ?? '').trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 1;
}

function coerceGovernorContext(value: unknown): GovernorContextLike | null {
  const candidate = value as GovernorContextLike | null;
  return candidate && typeof candidate.checkBudget === 'function' && typeof candidate.recordTokens === 'function'
    ? candidate
    : null;
}

function isStickyFailureReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized === 'auth_failed' || normalized === 'quota_exceeded';
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  temperature?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

function buildAnthropicMessages(messages: LlmChatMessage[]): { system: string | undefined; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const apiMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      apiMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }
  }

  // Ensure messages alternate user/assistant and start with user
  // Merge consecutive same-role messages
  const merged: AnthropicMessage[] = [];
  for (const msg of apiMessages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }

  // Ensure first message is from user
  if (merged.length === 0 || merged[0].role !== 'user') {
    merged.unshift({ role: 'user', content: '(continue)' });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: merged,
  };
}

function classifyHttpError(status: number, body: AnthropicErrorResponse | null): string {
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'auth_failed';
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'rate_limit';
  if (body?.error?.type === 'authentication_error') return 'auth_failed';
  if (body?.error?.type === 'rate_limit_error') return 'rate_limit';
  if (body?.error?.type === 'overloaded_error') return 'rate_limit';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

export class AnthropicApiLlmService {
  private apiKey: string;
  private timeoutMs: number;
  private healthCheckIntervalMs: number;
  private providerWorkspaceRoot: string;
  private semaphore: AsyncSemaphore;
  private lastHealthCheck: LlmProviderHealth = {
    provider: 'claude',
    available: false,
    authenticated: false,
    lastCheck: 0,
  };

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('unverified_by_trace(api_llm_no_key): ANTHROPIC_API_KEY is required for API transport');
    }
    this.apiKey = key;
    this.timeoutMs = coercePositiveTimeout(process.env.CLAUDE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.healthCheckIntervalMs = coerceTimeout(process.env.LLM_HEALTH_CHECK_INTERVAL_MS, 60_000);
    this.providerWorkspaceRoot = resolveProviderWorkspaceRoot();
    this.semaphore = new AsyncSemaphore(
      Number.parseInt(process.env.CLAUDE_MAX_CONCURRENT || '2', 10)
    );
  }

  async chat(options: LlmChatOptions): Promise<ChatResult> {
    await this.assertPrivacyAllowsRemoteLlm(options);
    await this.assertProviderAvailable();

    const { system, messages } = buildAnthropicMessages(options.messages);
    const governor = coerceGovernorContext(options.governorContext);

    const inputTokenEstimate = messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0)
      + estimateTokenCount(system ?? '');

    if (governor) {
      governor.checkBudget();
      governor.recordTokens(inputTokenEstimate);
    }

    return this.semaphore.run(async () => {
      const model = options.modelId || DEFAULT_MODEL;
      const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

      const requestBody: AnthropicRequest = {
        model,
        max_tokens: maxTokens,
        messages,
      };

      if (system) {
        requestBody.system = system;
      }

      if (options.temperature !== undefined) {
        requestBody.temperature = options.temperature;
      }

      logInfo('API LLM: anthropic call', {
        model,
        messageCount: messages.length,
        hasSystem: Boolean(system),
      });

      let response: Response;
      try {
        const controller = new AbortController();
        const timeoutId = this.timeoutMs > 0
          ? setTimeout(() => controller.abort(), this.timeoutMs)
          : undefined;

        try {
          response = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
              'anthropic-version': ANTHROPIC_API_VERSION,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } finally {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes('abort') || message.includes('timeout');
        const reason = isTimeout ? 'timeout' : 'network_error';
        const errorMsg = isTimeout
          ? `API transport timeout after ${this.timeoutMs}ms`
          : `API transport network error: ${message}`;

        logWarning('API LLM: request failed', { error: errorMsg });
        await this.recordFailure(reason, errorMsg);
        throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
      }

      if (!response.ok) {
        let errorBody: AnthropicErrorResponse | null = null;
        try {
          errorBody = await response.json() as AnthropicErrorResponse;
        } catch {
          // Ignore JSON parse failures on error responses
        }

        const reason = classifyHttpError(response.status, errorBody);
        const errorDetail = errorBody?.error?.message ?? `HTTP ${response.status}`;
        const errorMsg = `Anthropic API error (${reason}): ${errorDetail}`;

        logWarning('API LLM: Anthropic API error', {
          status: response.status,
          reason,
          detail: errorDetail,
        });
        await this.recordFailure(reason, errorMsg);
        throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
      }

      let responseBody: AnthropicResponse;
      try {
        responseBody = await response.json() as AnthropicResponse;
      } catch (error) {
        const errorMsg = 'API transport: invalid JSON response from Anthropic API';
        logWarning('API LLM: invalid response', { error: String(error) });
        await this.recordFailure('invalid_response', errorMsg);
        throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
      }

      const content = responseBody.content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text!)
        .join('');

      if (governor) {
        governor.recordTokens(estimateTokenCount(content));
      }

      await this.recordPrivacyAudit({
        op: 'synthesize',
        model,
        local: false,
        contentSent: true,
        status: 'allowed',
      });
      await this.recordSuccess();

      return { provider: 'claude', content };
    });
  }

  async checkClaudeHealth(forceCheck = false): Promise<LlmProviderHealth> {
    const now = Date.now();
    if (
      !forceCheck &&
      this.lastHealthCheck.lastCheck &&
      now - this.lastHealthCheck.lastCheck < this.healthCheckIntervalMs
    ) {
      return this.lastHealthCheck;
    }

    // With an API key, we can verify the key format without making an API call.
    // A real probe would consume credits, so we only do a lightweight check.
    if (!this.apiKey || !this.apiKey.startsWith('sk-ant-')) {
      this.lastHealthCheck = {
        provider: 'claude',
        available: true,
        authenticated: false,
        lastCheck: now,
        error: 'ANTHROPIC_API_KEY does not appear to be a valid Anthropic key',
      };
      return this.lastHealthCheck;
    }

    if (forceCheck) {
      // For a forced check, we make a minimal API call to verify credentials.
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        try {
          const probe = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
              'anthropic-version': ANTHROPIC_API_VERSION,
            },
            body: JSON.stringify({
              model: DEFAULT_MODEL,
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ok' }],
            }),
            signal: controller.signal,
          });

          if (probe.status === 401 || probe.status === 403) {
            this.lastHealthCheck = {
              provider: 'claude',
              available: true,
              authenticated: false,
              lastCheck: now,
              error: 'ANTHROPIC_API_KEY authentication failed',
            };
            return this.lastHealthCheck;
          }

          // Any 2xx or model-specific error (e.g., 400 for invalid model)
          // means the key is authenticated
          this.lastHealthCheck = {
            provider: 'claude',
            available: true,
            authenticated: true,
            lastCheck: now,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastHealthCheck = {
          provider: 'claude',
          available: true,
          authenticated: false,
          lastCheck: now,
          error: `API health check failed: ${message}`,
        };
      }
      return this.lastHealthCheck;
    }

    // Non-forced check: assume valid if key looks correct
    this.lastHealthCheck = {
      provider: 'claude',
      available: true,
      authenticated: true,
      lastCheck: now,
    };
    return this.lastHealthCheck;
  }

  async checkCodexHealth(_forceCheck = false): Promise<LlmProviderHealth> {
    // API transport only supports Anthropic/Claude; codex is not available via this adapter
    return {
      provider: 'codex',
      available: false,
      authenticated: false,
      lastCheck: Date.now(),
      error: 'Codex not available via Anthropic API transport',
    };
  }

  private async assertProviderAvailable(): Promise<void> {
    try {
      const failures = await getActiveProviderFailures(this.providerWorkspaceRoot);
      const failure = failures['claude'];
      if (failure) {
        if (!isStickyFailureReason(failure.reason)) {
          return;
        }
        throw new Error(`unverified_by_trace(provider_unavailable): recent ${failure.reason}: ${failure.message}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('provider_unavailable')) {
        throw error;
      }
    }
  }

  private async assertPrivacyAllowsRemoteLlm(options: LlmChatOptions): Promise<void> {
    if (!isPrivacyModeStrict()) return;
    await this.recordPrivacyAudit({
      op: 'synthesize',
      model: options.modelId || options.provider || 'unknown',
      local: false,
      contentSent: false,
      status: 'blocked',
      note: 'strict privacy mode blocks external LLM providers',
    });
    throw new Error(
      'Privacy mode is enabled. Configure a local embedding model: `LIBRARIAN_EMBEDDING_MODEL=onnx:all-MiniLM-L6-v2`.'
    );
  }

  private async recordFailure(reason: string, message: string): Promise<void> {
    try {
      const classification = classifyProviderFailure(message);
      await recordProviderFailure(this.providerWorkspaceRoot, {
        provider: 'claude',
        reason: classification.reason || reason,
        message,
        ttlMs: classification.ttlMs,
        at: new Date().toISOString(),
      });
    } catch {
      // Provider failure recording should not block LLM calls.
    }
  }

  private async recordSuccess(): Promise<void> {
    try {
      await recordProviderSuccess(this.providerWorkspaceRoot, 'claude');
    } catch {
      // Ignore persistence failures.
    }
  }

  private async recordPrivacyAudit(event: {
    op: string;
    model: string;
    local: boolean;
    contentSent: boolean;
    status: 'allowed' | 'blocked';
    note?: string;
  }): Promise<void> {
    await appendPrivacyAuditEvent(this.providerWorkspaceRoot, {
      ts: new Date().toISOString(),
      op: event.op,
      files: [],
      model: event.model,
      local: event.local,
      contentSent: event.contentSent,
      status: event.status,
      note: event.note,
    }).catch(() => {
      // Non-blocking audit writes.
    });
  }
}

/** @deprecated Use `AnthropicApiLlmService` instead. */
export const ApiLlmService = AnthropicApiLlmService;

/**
 * Returns true when the environment indicates we are running inside a Claude Code
 * session (or another nested Anthropic agent context) where spawning a `claude`
 * subprocess would be blocked by nested-session detection.
 */
export function isInsideClaudeCodeSession(): boolean {
  // CLAUDE_CODE_ENTRYPOINT is set by Claude Code when it launches
  if (process.env.CLAUDE_CODE_ENTRYPOINT) return true;
  // CLAUDE_CODE is a general marker for Claude Code sessions
  if (process.env.CLAUDE_CODE) return true;
  // SESSION_ID is set inside Claude Code conversations
  if (process.env.SESSION_ID && process.env.CLAUDE_MODEL) return true;
  return false;
}

function hasConfiguredClaudeBroker(): boolean {
  const candidate =
    process.env.LIBRARIAN_CLAUDE_BROKER_URL
    ?? process.env.LIBRARIAN_LLM_CLAUDE_BROKER_URL
    ?? process.env.CLAUDE_BROKER_URL;
  if (!candidate || candidate.trim().length === 0) return false;
  try {
    const parsed = new URL(candidate.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Creates a factory that always uses Anthropic API transport.
 * Requires ANTHROPIC_API_KEY to be set.
 */
export function createAnthropicApiLlmServiceFactory(): LlmServiceFactory {
  return async () => new AnthropicApiLlmService();
}

/** @deprecated Use `createAnthropicApiLlmServiceFactory` instead. */
export const createApiLlmServiceFactory = createAnthropicApiLlmServiceFactory;

/**
 * Universal auto-factory that picks the best transport based on environment:
 *  1. ANTHROPIC_API_KEY set -> Anthropic API transport (AnthropicApiLlmService)
 *  2. Otherwise -> CLI transport (CliLlmService), which auto-detects:
 *     - Claude broker transport via LIBRARIAN_CLAUDE_BROKER_URL
 *     - OpenAI API transport for codex via OPENAI_API_KEY
 *     - direct CLI execution fallback
 */
export function createAutoLlmServiceFactory(): LlmServiceFactory {
  return async () => {
    if (process.env.ANTHROPIC_API_KEY) {
      logInfo('LLM transport: using Anthropic API (ANTHROPIC_API_KEY set)');
      return new AnthropicApiLlmService();
    }

    // Lazy import to avoid circular dependency issues
    const { CliLlmService } = await import('./cli_llm_service.js');

    const brokerConfigured = hasConfiguredClaudeBroker();
    if (process.env.OPENAI_API_KEY) {
      logInfo('LLM transport: using CLI transport with codex (OPENAI_API_KEY set)');
      return new CliLlmService();
    }

    if (isInsideClaudeCodeSession()) {
      if (brokerConfigured) {
        logInfo(
          'LLM transport: inside Claude Code session with Claude broker configured; ' +
          'using CLI adapter auto-detect (broker preferred for claude).'
        );
      } else {
        logWarning(
          'LLM transport: inside Claude Code session without ANTHROPIC_API_KEY or LIBRARIAN_CLAUDE_BROKER_URL. ' +
          'Claude CLI subprocess may fail due to nested session detection.'
        );
      }
    }

    logInfo('LLM transport: using CLI transport (auto-detect)');
    return new CliLlmService();
  };
}
