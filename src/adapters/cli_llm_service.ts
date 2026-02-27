import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logInfo, logWarning } from '../telemetry/logger.js';
import type { LlmChatOptions, LlmProviderHealth, LlmServiceFactory } from './llm_service.js';
import { resolveCodexCliOptions } from './codex_cli.js';
import {
  classifyProviderFailure,
  getActiveProviderFailures,
  recordProviderFailure,
  recordProviderSuccess,
  resolveProviderWorkspaceRoot,
} from '../utils/provider_failures.js';
import { isPrivacyModeStrict } from '../utils/runtime_controls.js';
import { appendPrivacyAuditEvent } from '../security/privacy_audit.js';
import {
  ProviderChaosMiddleware,
  createProviderChaosConfigFromEnv,
  type ProviderChaosResult,
  type ProviderExecResult,
} from './provider_chaos.js';

type GovernorContextLike = { checkBudget: () => void; recordTokens: (tokens: number) => void; recordRetry?: () => void };

type ChatResult = { content: string; provider: string };

type CliProvider = 'claude' | 'codex';
type ProviderTransport = 'auto' | 'cli' | 'api';

type HealthState = {
  claude: LlmProviderHealth;
  codex: LlmProviderHealth;
};

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

const claudeSemaphore = new AsyncSemaphore(Number.parseInt(process.env.CLAUDE_MAX_CONCURRENT || '2', 10));
const codexSemaphore = new AsyncSemaphore(Number.parseInt(process.env.CODEX_MAX_CONCURRENT || '2', 10));
const DEFAULT_CLAUDE_TIMEOUT_MS = 60_000;
const DEFAULT_CODEX_TIMEOUT_MS = 60_000;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_OPENAI_MODEL = 'gpt-5-codex';
const DEFAULT_API_MAX_TOKENS = 1024;

function coerceTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function coercePositiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveRequestScopedTimeout(defaultTimeoutMs: number, requestedTimeoutMs: number | undefined): number {
  const defaultBudget = Number.isFinite(defaultTimeoutMs) && defaultTimeoutMs > 0
    ? Math.floor(defaultTimeoutMs)
    : DEFAULT_CODEX_TIMEOUT_MS;
  const requestedBudget = Number.isFinite(requestedTimeoutMs ?? NaN) && (requestedTimeoutMs ?? 0) > 0
    ? Math.floor(requestedTimeoutMs as number)
    : null;
  const boundedBudget = requestedBudget !== null ? Math.min(defaultBudget, requestedBudget) : defaultBudget;
  return Math.max(1, boundedBudget);
}

function buildFullPrompt(messages: LlmChatOptions['messages']): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      parts.push(message.content);
    } else {
      parts.push(`[Previous Response]\n${message.content}`);
    }
  }
  return parts.join('\n\n');
}

function extractSystemPrompt(messages: LlmChatOptions['messages']): string | null {
  const systems = messages.filter((message) => message.role === 'system');
  if (systems.length === 0) return null;
  return systems.map((message) => message.content).join('\n\n');
}

function estimateTokenCount(text: string): number {
  const trimmed = String(text ?? '').trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 1;
}

function withCliPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = process.env.HOME || '';
  const prefix = home ? path.join(home, '.local', 'bin') : '';
  if (!prefix) return env;
  const currentPath = env.PATH ?? '';
  const parts = currentPath.split(path.delimiter).filter(Boolean);
  if (parts.includes(prefix)) return env;
  return { ...env, PATH: `${prefix}${path.delimiter}${currentPath}` };
}

function coerceGovernorContext(value: unknown): GovernorContextLike | null {
  const candidate = value as GovernorContextLike | null;
  return candidate && typeof candidate.checkBudget === 'function' && typeof candidate.recordTokens === 'function'
    ? candidate
    : null;
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNestedClaudeCodeSession(): boolean {
  return hasEnvValue(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS)
    || hasEnvValue(process.env.CLAUDE_CODE_SESSION_ID)
    || hasEnvValue(process.env.CLAUDECODE);
}

function parseTransport(value: string | undefined): ProviderTransport {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'cli' || normalized === 'api' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
}

function resolveClaudeTransportMode(): ProviderTransport {
  return parseTransport(process.env.LIBRARIAN_CLAUDE_TRANSPORT ?? process.env.LIBRARIAN_LLM_CLAUDE_TRANSPORT);
}

function resolveCodexTransportMode(): ProviderTransport {
  return parseTransport(process.env.LIBRARIAN_CODEX_TRANSPORT ?? process.env.LIBRARIAN_LLM_CODEX_TRANSPORT);
}

function shouldUseAnthropicApiTransport(): boolean {
  if (!hasEnvValue(process.env.ANTHROPIC_API_KEY)) return false;
  const mode = resolveClaudeTransportMode();
  if (mode === 'api') return true;
  if (mode === 'cli') return false;
  return true;
}

function shouldUseOpenAiApiTransport(): boolean {
  if (!hasEnvValue(process.env.OPENAI_API_KEY)) return false;
  const mode = resolveCodexTransportMode();
  if (mode === 'api') return true;
  if (mode === 'cli') return false;
  return true;
}

function buildNestedClaudeUnavailableMessage(): string {
  return 'Claude CLI cannot run inside nested Claude Code sessions; set ANTHROPIC_API_KEY for API transport or switch provider.';
}

function normalizeAnthropicModelId(modelId: string | undefined): string {
  const candidate = modelId?.trim() || process.env.CLAUDE_MODEL?.trim();
  return candidate || DEFAULT_ANTHROPIC_MODEL;
}

function normalizeOpenAiModelId(modelId: string | undefined): string {
  const requested = modelId?.trim() || process.env.CODEX_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const resolution = resolveCodexCliOptions(requested);
  return resolution.model?.trim() || requested;
}

function resolveForcedProvider(): CliProvider | null {
  const raw =
    process.env.LIBRARIAN_LLM_PROVIDER
    ?? process.env.WAVE0_LLM_PROVIDER
    ?? process.env.LLM_PROVIDER;
  if (raw === 'claude' || raw === 'codex') return raw;
  return null;
}

function isClaudeModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized.startsWith('claude') || normalized.includes('claude-');
}

function isCodexModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized.includes('codex')
    || normalized.startsWith('gpt-')
    || normalized.startsWith('o1')
    || normalized.startsWith('o3')
    || normalized.startsWith('o4');
}

function sanitizeModelIdForProvider(
  provider: CliProvider,
  modelId: string | undefined
): { modelId: string | undefined; repairedFrom?: string } {
  const requested = modelId?.trim();
  if (!requested) {
    return { modelId };
  }
  if (provider === 'codex' && isClaudeModelId(requested)) {
    return {
      modelId: process.env.CODEX_MODEL?.trim() ?? '',
      repairedFrom: requested,
    };
  }
  if (provider === 'claude' && isCodexModelId(requested)) {
    return {
      modelId: process.env.CLAUDE_MODEL?.trim() ?? '',
      repairedFrom: requested,
    };
  }
  return { modelId: requested };
}

function normalizeClaudeErrorMessage(raw: string): string {
  const lowered = raw.toLowerCase();
  const mentionsApiKey = lowered.includes('anthropic_api_key') || lowered.includes('api key');
  if (mentionsApiKey && !process.env.ANTHROPIC_API_KEY) {
    return 'ANTHROPIC_API_KEY not set - run `export ANTHROPIC_API_KEY=<key>` or set in ~/.claude/config';
  }
  return raw;
}

function sanitizeCliErrorMessage(raw: string, provider: CliProvider): string {
  const withoutAnsi = raw.replace(/\u001B\[[0-9;]*m/g, '');
  const normalizedRaw = withoutAnsi.trim();
  if (normalizedRaw.length > 0 && /^[-=_\s]+$/.test(normalizedRaw)) {
    return `${provider} CLI failed without diagnostic output (check auth, model access, and rate limits)`;
  }
  const lines = withoutAnsi
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 25);
  const isVersionBanner = (line: string): boolean => /^OpenAI Codex v[\d.]+/i.test(line)
    || /^Claude Code v[\d.]+/i.test(line)
    || /^claude version/i.test(line);
  const isSeparatorLine = (line: string): boolean => /^[-=_]{3,}$/.test(line);
  const meaningfulLines = lines.filter((line) => !isVersionBanner(line) && !isSeparatorLine(line));
  const preferred =
    meaningfulLines.find((line) => /\b(error|failed|unsupported|invalid|unavailable|timeout|quota|rate(?:[_ -])?limit|auth)\b/i.test(line))
    ?? meaningfulLines.find((line) => /\b(limit|denied|blocked)\b/i.test(line))
    ?? meaningfulLines[0]
    ?? lines[0]
    ?? `${provider} CLI error`;
  const compact = preferred.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
  return clipped || `${provider} CLI error`;
}

function classifyCorruptOutput(result: ProviderChaosResult): string | null {
  if (result.chaosMode === 'truncated_response') return 'provider_chaos_truncated_response';
  if (result.chaosMode === 'garbage_response') return 'provider_chaos_garbage_response';
  return null;
}

function isStickyFailureReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized === 'auth_failed'
    || normalized === 'quota_exceeded'
    || normalized === 'unavailable'
    || normalized === 'invalid_response';
}

function stickyFailureSeverity(reason: string | undefined): number {
  if (!reason) return 0;
  switch (reason.toLowerCase()) {
    case 'auth_failed':
    case 'quota_exceeded':
    case 'invalid_response':
    case 'unavailable':
      return 4;
    case 'rate_limit':
      return 2;
    case 'timeout':
    case 'network_error':
      return 1;
    default:
      return 0;
  }
}

function combineCliErrorStreams(stderr: string, stdout: string, fallback: string): string {
  const stderrValue = String(stderr ?? '').trim();
  const stdoutValue = String(stdout ?? '').trim();
  if (stderrValue && stdoutValue) {
    return `${stderrValue}\n${stdoutValue}`;
  }
  if (stderrValue) return stderrValue;
  if (stdoutValue) return stdoutValue;
  return fallback;
}

function buildInitialHealth(provider: CliProvider): LlmProviderHealth {
  return {
    provider,
    available: false,
    authenticated: false,
    lastCheck: 0,
  };
}

export class CliLlmService {
  private claudeTimeoutMs = coercePositiveTimeout(process.env.CLAUDE_TIMEOUT_MS, DEFAULT_CLAUDE_TIMEOUT_MS);
  private codexTimeoutMs = coercePositiveTimeout(process.env.CODEX_TIMEOUT_MS, DEFAULT_CODEX_TIMEOUT_MS);
  private claudeHealthCheckTimeoutMs = coercePositiveTimeout(process.env.CLAUDE_HEALTH_CHECK_TIMEOUT_MS, 60000);
  private codexHealthCheckTimeoutMs = coercePositiveTimeout(process.env.CODEX_HEALTH_CHECK_TIMEOUT_MS, 20000);
  private healthCheckIntervalMs = coerceTimeout(process.env.LLM_HEALTH_CHECK_INTERVAL_MS, 60000);
  private providerWorkspaceRoot = resolveProviderWorkspaceRoot();
  private providerChaos = new ProviderChaosMiddleware(createProviderChaosConfigFromEnv());

  private health: HealthState = {
    claude: buildInitialHealth('claude'),
    codex: buildInitialHealth('codex'),
  };

  private async resolveCandidateOrder(
    primary: CliProvider,
    fallback: CliProvider,
    forcedProvider: CliProvider | null,
  ): Promise<CliProvider[]> {
    try {
      const failures = await getActiveProviderFailures(this.providerWorkspaceRoot);
      const primaryFailure = failures[primary];
      const fallbackFailure = failures[fallback];
      const primarySticky = primaryFailure ? isStickyFailureReason(primaryFailure.reason) : false;
      const fallbackSticky = fallbackFailure ? isStickyFailureReason(fallbackFailure.reason) : false;
      const primarySeverity = stickyFailureSeverity(primaryFailure?.reason);
      const fallbackSeverity = stickyFailureSeverity(fallbackFailure?.reason);

      if (primarySticky && !fallbackSticky) {
        return [fallback, primary];
      }
      if (primarySticky && fallbackSticky && primarySeverity > fallbackSeverity) {
        return [fallback, primary];
      }
      if (forcedProvider && primarySticky && fallbackSticky && primarySeverity === fallbackSeverity) {
        return [primary, fallback];
      }
    } catch {
      // Failure-state reads should not block provider execution.
    }

    return [primary, fallback];
  }

  async chat(options: LlmChatOptions): Promise<ChatResult> {
    await this.assertPrivacyAllowsRemoteLlm(options);
    const forcedProvider = resolveForcedProvider();
    const provider: CliProvider = forcedProvider ?? (options.provider === 'codex' ? 'codex' : 'claude');
    const fallback: CliProvider = provider === 'codex' ? 'claude' : 'codex';
    const candidateOrder = await this.resolveCandidateOrder(provider, fallback, forcedProvider);
    const tried: CliProvider[] = [];
    let lastError: Error | null = null;

    for (const candidate of candidateOrder) {
      if (tried.includes(candidate)) continue;
      tried.push(candidate);
      try {
        const sanitizedModel = sanitizeModelIdForProvider(candidate, options.modelId);
        if (sanitizedModel.repairedFrom) {
          logWarning('CLI LLM: auto-repaired model/provider mismatch', {
            provider: candidate,
            fromModel: sanitizedModel.repairedFrom,
            toModel: sanitizedModel.modelId || '(provider-default)',
          });
        }
        const candidateOptions = { ...options, modelId: sanitizedModel.modelId ?? options.modelId };
        return candidate === 'codex'
          ? await this.callCodex(candidateOptions)
          : await this.callClaude(candidateOptions);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (candidate === fallback) break;
        logWarning('CLI LLM: falling back to alternate provider', {
          primary: candidate,
          fallback,
          error: lastError.message,
        });
      }
    }
    throw lastError ?? new Error('unverified_by_trace(llm_execution_failed): No LLM provider available');
  }

  async checkClaudeHealth(forceCheck = false): Promise<LlmProviderHealth> {
    const now = Date.now();
    const cached = this.health.claude;
    if (!forceCheck && cached.lastCheck && now - cached.lastCheck < this.healthCheckIntervalMs) {
      return cached;
    }

    if (shouldUseAnthropicApiTransport()) {
      this.health.claude = {
        provider: 'claude',
        available: true,
        authenticated: true,
        lastCheck: now,
      };
      return this.health.claude;
    }

    if (isNestedClaudeCodeSession()) {
      this.health.claude = {
        provider: 'claude',
        available: false,
        authenticated: false,
        lastCheck: now,
        error: buildNestedClaudeUnavailableMessage(),
      };
      return this.health.claude;
    }

    const env = withCliPath({ ...process.env });
    const version = await execa('claude', ['--version'], { env, timeout: 5000, reject: false });
    if (version.exitCode !== 0) {
      this.health.claude = {
        provider: 'claude',
        available: false,
        authenticated: false,
        lastCheck: now,
        error: 'Claude CLI not available',
      };
      return this.health.claude;
    }

    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const configPath = path.join(configDir, '.claude.json');
    const hasConfig = fs.existsSync(configPath);
    if (!hasConfig) {
      this.health.claude = {
        provider: 'claude',
        available: true,
        authenticated: false,
        lastCheck: now,
        error: 'Claude CLI not authenticated - run "claude setup-token" or start "claude" once',
      };
      return this.health.claude;
    }

    if (forceCheck) {
      // Use --version instead of --print to avoid conflicts with running Claude sessions
      // and to avoid consuming API credits during health checks
      const probe = await execa('claude', ['--version'], {
        env,
        timeout: 5000, // Version check should be fast
        reject: false,
      });
      if (probe.exitCode !== 0) {
        this.health.claude = {
          provider: 'claude',
          available: true,
          authenticated: false,
          lastCheck: now,
          error: String(probe.stderr || probe.stdout || 'Claude CLI probe failed'),
        };
        return this.health.claude;
      }
    }

    this.health.claude = {
      provider: 'claude',
      available: true,
      authenticated: true,
      lastCheck: now,
    };
    return this.health.claude;
  }

  async checkCodexHealth(forceCheck = false): Promise<LlmProviderHealth> {
    const now = Date.now();
    const cached = this.health.codex;
    if (!forceCheck && cached.lastCheck && now - cached.lastCheck < this.healthCheckIntervalMs) {
      return cached;
    }

    if (shouldUseOpenAiApiTransport()) {
      this.health.codex = {
        provider: 'codex',
        available: true,
        authenticated: true,
        lastCheck: now,
      };
      return this.health.codex;
    }

    const env = withCliPath({ ...process.env });
    const version = await execa('codex', ['--version'], { env, timeout: 5000, reject: false });
    if (version.exitCode !== 0) {
      this.health.codex = {
        provider: 'codex',
        available: false,
        authenticated: false,
        lastCheck: now,
        error: 'Codex CLI not available',
      };
      return this.health.codex;
    }

    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    if (!fs.existsSync(codexHome)) {
      this.health.codex = {
        provider: 'codex',
        available: true,
        authenticated: false,
        lastCheck: now,
        error: 'Codex CLI not authenticated - run "codex login"',
      };
      return this.health.codex;
    }

    const status = await execa('codex', ['login', 'status'], { env, timeout: 5000, reject: false });
    if (status.exitCode !== 0) {
      this.health.codex = {
        provider: 'codex',
        available: true,
        authenticated: false,
        lastCheck: now,
        error: String(status.stderr || status.stdout || 'Codex CLI not authenticated'),
      };
      return this.health.codex;
    }

    if (forceCheck) {
      const resolution = resolveCodexCliOptions(process.env.CODEX_MODEL);
      const args = ['exec'];
      if (resolution.model) args.push('--model', resolution.model);
      for (const override of resolution.configOverrides) {
        args.push('-c', override);
      }
      args.push('-');
      const probe = await execa('codex', args, {
        env,
        input: 'ok',
        timeout: this.codexHealthCheckTimeoutMs,
        reject: false,
      });
      if (probe.exitCode !== 0) {
        this.health.codex = {
          provider: 'codex',
          available: true,
          authenticated: false,
          lastCheck: now,
          error: String(probe.stderr || probe.stdout || 'Codex CLI probe failed'),
        };
        return this.health.codex;
      }
    }

    this.health.codex = {
      provider: 'codex',
      available: true,
      authenticated: true,
      lastCheck: now,
    };
    return this.health.codex;
  }

  private async fetchJsonWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        json,
        text,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractApiErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const directMessage = (payload as { message?: unknown }).message;
    if (typeof directMessage === 'string' && directMessage.trim().length > 0) {
      return directMessage.trim();
    }
    const errorMessage = (payload as { error?: { message?: unknown } }).error?.message;
    if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
      return errorMessage.trim();
    }
    return null;
  }

  private extractAnthropicText(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const content = (payload as { content?: unknown }).content;
    if (!Array.isArray(content)) return null;
    const parts = content
      .map((part) => (part && typeof part === 'object' ? (part as { text?: unknown }).text : null))
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (parts.length === 0) return null;
    return parts.join('\n');
  }

  private extractOpenAiText(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0];
    if (!first || typeof first !== 'object') return null;
    const content = (first as { message?: { content?: unknown } }).message?.content;
    if (typeof content === 'string' && content.trim().length > 0) {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => (part && typeof part === 'object' ? (part as { text?: unknown }).text : null))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (parts.length > 0) return parts.join('\n');
    }
    return null;
  }

  private async callClaudeApi(
    options: LlmChatOptions,
    timeoutMs: number,
  ): Promise<ChatResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('unverified_by_trace(provider_unavailable): ANTHROPIC_API_KEY missing for claude API transport');
    }
    const systemPrompt = extractSystemPrompt(options.messages);
    const messages = options.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }));
    if (messages.length === 0) {
      messages.push({ role: 'user', content: '' });
    }
    const model = normalizeAnthropicModelId(options.modelId);
    const payload: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? DEFAULT_API_MAX_TOKENS,
      messages,
    };
    if (typeof options.temperature === 'number') {
      payload.temperature = options.temperature;
    }
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    const response = await this.fetchJsonWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    if (!response.ok) {
      const apiError = this.extractApiErrorMessage(response.json)
        ?? sanitizeCliErrorMessage(response.text || `HTTP ${response.status}`, 'claude');
      throw new Error(apiError);
    }
    const content = this.extractAnthropicText(response.json);
    if (!content) {
      throw new Error('Anthropic API returned empty response content');
    }
    return { provider: 'claude', content };
  }

  private async callOpenAiApi(
    options: LlmChatOptions,
    timeoutMs: number,
  ): Promise<ChatResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('unverified_by_trace(provider_unavailable): OPENAI_API_KEY missing for codex API transport');
    }
    const model = normalizeOpenAiModelId(options.modelId);
    const payload: Record<string, unknown> = {
      model,
      messages: options.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_tokens: options.maxTokens ?? DEFAULT_API_MAX_TOKENS,
    };
    if (typeof options.temperature === 'number') {
      payload.temperature = options.temperature;
    }
    const response = await this.fetchJsonWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    if (!response.ok) {
      const apiError = this.extractApiErrorMessage(response.json)
        ?? sanitizeCliErrorMessage(response.text || `HTTP ${response.status}`, 'codex');
      throw new Error(apiError);
    }
    const content = this.extractOpenAiText(response.json);
    if (!content) {
      throw new Error('OpenAI API returned empty response content');
    }
    return { provider: 'codex', content };
  }

  private async callClaude(options: LlmChatOptions): Promise<ChatResult> {
    await this.assertProviderAvailable('claude');
    const fullPrompt = buildFullPrompt(options.messages);
    const systemPrompt = extractSystemPrompt(options.messages);
    const governor = coerceGovernorContext(options.governorContext);
    if (governor) {
      governor.checkBudget();
      governor.recordTokens(estimateTokenCount(fullPrompt) + estimateTokenCount(systemPrompt ?? ''));
    }

    return claudeSemaphore.run(async () => {
      const timeoutMs = resolveRequestScopedTimeout(this.claudeTimeoutMs, options.timeoutMs);
      if (shouldUseAnthropicApiTransport()) {
        try {
          const result = await this.callClaudeApi(options, timeoutMs);
          if (governor) {
            governor.recordTokens(estimateTokenCount(result.content));
          }
          await this.recordPrivacyAudit({
            op: 'synthesize',
            model: options.modelId || 'claude',
            local: false,
            contentSent: true,
            status: 'allowed',
          });
          await this.recordSuccess('claude');
          return result;
        } catch (error) {
          const rawError = normalizeClaudeErrorMessage(String(error instanceof Error ? error.message : error));
          const errorMsg = sanitizeCliErrorMessage(rawError, 'claude');
          await this.recordFailure('claude', errorMsg, rawError);
          throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
        }
      }

      if (isNestedClaudeCodeSession()) {
        const message = buildNestedClaudeUnavailableMessage();
        await this.recordFailure('claude', message, message);
        throw new Error(`unverified_by_trace(provider_unavailable): ${message}`);
      }

      const args = ['--print'];
      if (systemPrompt) {
        args.push('--system-prompt', systemPrompt);
      }
      const env = withCliPath({ ...process.env });
      if (options.modelId) {
        env.CLAUDE_MODEL = options.modelId;
      }
      logInfo('CLI LLM: claude call', { promptLength: fullPrompt.length });
      const result = await this.executeWithChaos(async () => {
        const output = await execa('claude', args, {
          input: fullPrompt,
          env,
          timeout: timeoutMs,
          reject: false,
        });
        return {
          exitCode: Number(output.exitCode ?? 1),
          stdout: String(output.stdout ?? ''),
          stderr: String(output.stderr ?? ''),
        };
      });
        if (result.exitCode !== 0) {
          const rawError = normalizeClaudeErrorMessage(
            combineCliErrorStreams(result.stderr, result.stdout, 'Claude CLI error')
          );
          const errorMsg = sanitizeCliErrorMessage(rawError, 'claude');
          logWarning('CLI LLM: Claude call failed', { error: errorMsg });
          await this.recordFailure('claude', errorMsg, rawError);
          throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
        }
      const corruptionReason = classifyCorruptOutput(result);
      if (corruptionReason) {
        await this.recordFailure('claude', corruptionReason, corruptionReason);
        throw new Error(`unverified_by_trace(llm_execution_failed): ${corruptionReason}`);
      }
      const content = String(result.stdout ?? '');
      if (governor) {
        governor.recordTokens(estimateTokenCount(content));
      }
      await this.recordPrivacyAudit({
        op: 'synthesize',
        model: options.modelId || 'claude',
        local: false,
        contentSent: true,
        status: 'allowed',
      });
      await this.recordSuccess('claude');
      return { provider: 'claude', content };
    });
  }

  private async callCodex(options: LlmChatOptions): Promise<ChatResult> {
    await this.assertProviderAvailable('codex');
    const fullPrompt = buildFullPrompt(options.messages);
    const governor = coerceGovernorContext(options.governorContext);
    if (governor) {
      governor.checkBudget();
      governor.recordTokens(estimateTokenCount(fullPrompt));
    }

    return codexSemaphore.run(async () => {
      const args = ['exec'];
      const timeoutMs = resolveRequestScopedTimeout(this.codexTimeoutMs, options.timeoutMs);
      if (shouldUseOpenAiApiTransport()) {
        try {
          const result = await this.callOpenAiApi(options, timeoutMs);
          if (governor) {
            governor.recordTokens(estimateTokenCount(result.content));
          }
          await this.recordPrivacyAudit({
            op: 'synthesize',
            model: options.modelId || 'codex',
            local: false,
            contentSent: true,
            status: 'allowed',
          });
          await this.recordSuccess('codex');
          return result;
        } catch (error) {
          const rawError = String(error instanceof Error ? error.message : error);
          const errorMsg = sanitizeCliErrorMessage(rawError, 'codex');
          await this.recordFailure('codex', errorMsg, rawError);
          throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
        }
      }

      const profile = process.env.CODEX_PROFILE || undefined;
      if (profile) {
        args.push('--profile', profile);
      }
      if (options.disableTools) {
        args.push('--disable', 'shell_tool', '--disable', 'shell_snapshot');
      }

      let tempDir: string | null = null;
      let outputPath: string | null = null;
      try {
        if (options.outputSchema) {
          tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'librarian-codex-'));
          const schemaPath = path.join(tempDir, 'output_schema.json');
          outputPath = path.join(tempDir, 'last_message.txt');
          await fs.promises.writeFile(schemaPath, options.outputSchema, 'utf8');
          args.push('--output-schema', schemaPath, '--output-last-message', outputPath);
        }

        const resolution = resolveCodexCliOptions(options.modelId);
        if (resolution.model) {
          args.push('--model', resolution.model);
        }
        for (const override of resolution.configOverrides) {
          args.push('-c', override);
        }

        args.push('-');
        logInfo('CLI LLM: codex call', { promptLength: fullPrompt.length });
        const result = await this.executeWithChaos(async () => {
          const output = await execa('codex', args, {
            input: fullPrompt,
            env: withCliPath({ ...process.env }),
            timeout: timeoutMs,
            reject: false,
          });
          return {
            exitCode: Number(output.exitCode ?? 1),
            stdout: String(output.stdout ?? ''),
            stderr: String(output.stderr ?? ''),
          };
        });

        if (result.exitCode !== 0) {
          const rawError = combineCliErrorStreams(result.stderr, result.stdout, 'Codex CLI error');
          const errorMsg = sanitizeCliErrorMessage(rawError, 'codex');
          logWarning('CLI LLM: Codex call failed', { error: errorMsg });
          await this.recordFailure('codex', errorMsg, rawError);
          throw new Error(`unverified_by_trace(llm_execution_failed): ${errorMsg}`);
        }

        let content = String(result.stdout ?? '');
        const corruptionReason = classifyCorruptOutput(result);
        if (corruptionReason) {
          await this.recordFailure('codex', corruptionReason, corruptionReason);
          throw new Error(`unverified_by_trace(llm_execution_failed): ${corruptionReason}`);
        }
        if (outputPath) {
          try {
            content = await fs.promises.readFile(outputPath, 'utf8');
          } catch (error) {
            logWarning('CLI LLM: Codex output file missing, using stdout', { error: String(error) });
          }
        }

        if (governor) {
          governor.recordTokens(estimateTokenCount(content));
        }

        await this.recordPrivacyAudit({
          op: 'synthesize',
          model: options.modelId || 'codex',
          local: false,
          contentSent: true,
          status: 'allowed',
        });
        await this.recordSuccess('codex');
        return { provider: 'codex', content };
      } finally {
        if (tempDir) {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
      }
    });
  }

  private async executeWithChaos(invoke: () => Promise<ProviderExecResult>): Promise<ProviderChaosResult> {
    try {
      return await this.providerChaos.execute(invoke);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('provider_chaos_timeout')) {
        return {
          chaosMode: 'timeout',
          exitCode: 1,
          stdout: '',
          stderr: message,
        };
      }
      throw error;
    }
  }

  private async recordFailure(provider: CliProvider, message: string, rawMessage?: string): Promise<void> {
    try {
      const classification = classifyProviderFailure(rawMessage ?? message);
      await recordProviderFailure(this.providerWorkspaceRoot, {
        provider,
        reason: classification.reason,
        message,
        ttlMs: classification.ttlMs,
        at: new Date().toISOString(),
      });
    } catch {
      // Provider failures should not block LLM calls.
    }
  }

  private async recordSuccess(provider: CliProvider): Promise<void> {
    try {
      await recordProviderSuccess(this.providerWorkspaceRoot, provider);
    } catch {
      // Ignore persistence failures.
    }
  }

  private async assertProviderAvailable(provider: CliProvider): Promise<void> {
    try {
      const failures = await getActiveProviderFailures(this.providerWorkspaceRoot);
      const failure = failures[provider];
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

export function createCliLlmServiceFactory(): LlmServiceFactory {
  return async () => new CliLlmService();
}
