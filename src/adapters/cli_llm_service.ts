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

function resolveForcedProvider(): CliProvider | null {
  const raw =
    process.env.LIBRARIAN_LLM_PROVIDER
    ?? process.env.WAVE0_LLM_PROVIDER
    ?? process.env.LLM_PROVIDER;
  if (raw === 'claude' || raw === 'codex') return raw;
  return null;
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
  const lines = withoutAnsi
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 25);
  const preferred =
    lines.find((line) => /\b(error|failed|unsupported|invalid|unavailable|timeout|quota|rate limit|auth)\b/i.test(line))
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
  return normalized === 'auth_failed' || normalized === 'quota_exceeded';
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
  private claudeTimeoutMs = coercePositiveTimeout(process.env.CLAUDE_TIMEOUT_MS, 180000);
  private codexTimeoutMs = coercePositiveTimeout(process.env.CODEX_TIMEOUT_MS, 180000);
  private claudeHealthCheckTimeoutMs = coercePositiveTimeout(process.env.CLAUDE_HEALTH_CHECK_TIMEOUT_MS, 60000);
  private codexHealthCheckTimeoutMs = coercePositiveTimeout(process.env.CODEX_HEALTH_CHECK_TIMEOUT_MS, 20000);
  private healthCheckIntervalMs = coerceTimeout(process.env.LLM_HEALTH_CHECK_INTERVAL_MS, 60000);
  private providerWorkspaceRoot = resolveProviderWorkspaceRoot();
  private providerChaos = new ProviderChaosMiddleware(createProviderChaosConfigFromEnv());

  private health: HealthState = {
    claude: buildInitialHealth('claude'),
    codex: buildInitialHealth('codex'),
  };

  async chat(options: LlmChatOptions): Promise<ChatResult> {
    await this.assertPrivacyAllowsRemoteLlm(options);
    const provider: CliProvider = resolveForcedProvider() ?? (options.provider === 'codex' ? 'codex' : 'claude');
    const fallback: CliProvider = provider === 'codex' ? 'claude' : 'codex';
    const tried: CliProvider[] = [];
    let lastError: Error | null = null;

    for (const candidate of [provider, fallback]) {
      if (tried.includes(candidate)) continue;
      tried.push(candidate);
      try {
        return candidate === 'codex'
          ? await this.callCodex(options)
          : await this.callClaude(options);
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
          timeout: this.claudeTimeoutMs > 0 ? this.claudeTimeoutMs : undefined,
          reject: false,
        });
        return {
          exitCode: Number(output.exitCode ?? 1),
          stdout: String(output.stdout ?? ''),
          stderr: String(output.stderr ?? ''),
        };
      });
        if (result.exitCode !== 0) {
          const rawError = normalizeClaudeErrorMessage(String(result.stderr || result.stdout || 'Claude CLI error'));
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
            timeout: this.codexTimeoutMs,
            reject: false,
          });
          return {
            exitCode: Number(output.exitCode ?? 1),
            stdout: String(output.stdout ?? ''),
            stderr: String(output.stderr ?? ''),
          };
        });

        if (result.exitCode !== 0) {
          const rawError = String(result.stderr || result.stdout || 'Codex CLI error');
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
