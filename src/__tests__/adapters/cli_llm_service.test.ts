import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { CliLlmService } from '../../adapters/cli_llm_service.js';
import { getActiveProviderFailures, recordProviderFailure } from '../../utils/provider_failures.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('../../utils/provider_failures.js', () => ({
  classifyProviderFailure: vi.fn(() => ({ reason: 'unknown', ttlMs: 1000 })),
  getActiveProviderFailures: vi.fn(async () => ({})),
  recordProviderFailure: vi.fn(async () => undefined),
  recordProviderSuccess: vi.fn(async () => undefined),
  resolveProviderWorkspaceRoot: vi.fn(() => process.cwd()),
}));

const execaMock = vi.mocked(execa);

describe('CliLlmService provider routing', () => {
  const previousProvider = process.env.LIBRARIAN_LLM_PROVIDER;
  const previousWave0Provider = process.env.WAVE0_LLM_PROVIDER;
  const previousGenericProvider = process.env.LLM_PROVIDER;
  const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
  const previousClaudeCodeMaxOutputTokens = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  const previousClaudeTransport = process.env.LIBRARIAN_CLAUDE_TRANSPORT;
  const previousCodexTransport = process.env.LIBRARIAN_CODEX_TRANSPORT;
  const previousClaudeBrokerUrl = process.env.LIBRARIAN_CLAUDE_BROKER_URL;
  const previousChaosEnabled = process.env.LIBRARIAN_PROVIDER_CHAOS_ENABLED;
  const previousChaosMode = process.env.LIBRARIAN_PROVIDER_CHAOS_MODE;
  const previousChaosRate = process.env.LIBRARIAN_PROVIDER_CHAOS_RATE;
  const previousChaosSequence = process.env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE;
  const previousFetch = globalThis.fetch;

  beforeEach(() => {
    execaMock.mockReset();
    vi.mocked(getActiveProviderFailures).mockReset();
    vi.mocked(getActiveProviderFailures).mockResolvedValue({});
    vi.mocked(recordProviderFailure).mockReset();
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.WAVE0_LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
    delete process.env.LIBRARIAN_CLAUDE_TRANSPORT;
    delete process.env.LIBRARIAN_CODEX_TRANSPORT;
    delete process.env.LIBRARIAN_CLAUDE_BROKER_URL;
    delete process.env.LIBRARIAN_PROVIDER_CHAOS_ENABLED;
    delete process.env.LIBRARIAN_PROVIDER_CHAOS_MODE;
    delete process.env.LIBRARIAN_PROVIDER_CHAOS_RATE;
    delete process.env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE;
    globalThis.fetch = previousFetch;
  });

  afterEach(() => {
    if (previousProvider === undefined) delete process.env.LIBRARIAN_LLM_PROVIDER;
    else process.env.LIBRARIAN_LLM_PROVIDER = previousProvider;
    if (previousWave0Provider === undefined) delete process.env.WAVE0_LLM_PROVIDER;
    else process.env.WAVE0_LLM_PROVIDER = previousWave0Provider;
    if (previousGenericProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousGenericProvider;
    if (previousAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey;
    if (previousOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    if (previousClaudeCodeMaxOutputTokens === undefined) delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
    else process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = previousClaudeCodeMaxOutputTokens;
    if (previousClaudeTransport === undefined) delete process.env.LIBRARIAN_CLAUDE_TRANSPORT;
    else process.env.LIBRARIAN_CLAUDE_TRANSPORT = previousClaudeTransport;
    if (previousCodexTransport === undefined) delete process.env.LIBRARIAN_CODEX_TRANSPORT;
    else process.env.LIBRARIAN_CODEX_TRANSPORT = previousCodexTransport;
    if (previousClaudeBrokerUrl === undefined) delete process.env.LIBRARIAN_CLAUDE_BROKER_URL;
    else process.env.LIBRARIAN_CLAUDE_BROKER_URL = previousClaudeBrokerUrl;
    if (previousChaosEnabled === undefined) delete process.env.LIBRARIAN_PROVIDER_CHAOS_ENABLED;
    else process.env.LIBRARIAN_PROVIDER_CHAOS_ENABLED = previousChaosEnabled;
    if (previousChaosMode === undefined) delete process.env.LIBRARIAN_PROVIDER_CHAOS_MODE;
    else process.env.LIBRARIAN_PROVIDER_CHAOS_MODE = previousChaosMode;
    if (previousChaosRate === undefined) delete process.env.LIBRARIAN_PROVIDER_CHAOS_RATE;
    else process.env.LIBRARIAN_PROVIDER_CHAOS_RATE = previousChaosRate;
    if (previousChaosSequence === undefined) delete process.env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE;
    else process.env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE = previousChaosSequence;
    globalThis.fetch = previousFetch;
  });

  it('uses requested provider when no override is configured', async () => {
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('claude');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0]?.[0]).toBe('claude');
  });

  it('forces codex when LIBRARIAN_LLM_PROVIDER=codex', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('codex');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0]?.[0]).toBe('codex');
  });

  it('reports claude unavailable in nested sessions when no ANTHROPIC_API_KEY is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';

    const service = new CliLlmService();
    const health = await service.checkClaudeHealth();

    expect(health.available).toBe(false);
    expect(health.authenticated).toBe(false);
    expect(health.error).toContain('nested Claude Code sessions');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('reports claude available via API transport in nested sessions when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';

    const service = new CliLlmService();
    const health = await service.checkClaudeHealth();

    expect(health.available).toBe(true);
    expect(health.authenticated).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('reports claude available via broker transport in nested sessions when broker URL is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
    process.env.LIBRARIAN_CLAUDE_BROKER_URL = 'http://127.0.0.1:8787';

    const service = new CliLlmService();
    const health = await service.checkClaudeHealth();

    expect(health.available).toBe(true);
    expect(health.authenticated).toBe(true);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('probes broker health endpoint when force-checking claude broker transport', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
    process.env.LIBRARIAN_CLAUDE_BROKER_URL = 'http://127.0.0.1:8787';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    })) as unknown as typeof fetch;

    const service = new CliLlmService();
    const health = await service.checkClaudeHealth(true);

    expect(health.available).toBe(true);
    expect(health.authenticated).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('applies a bounded timeout to codex execution by default', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    delete process.env.CODEX_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'codex',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'codex');
    expect(call).toBeDefined();
    const options = call?.[2] as { timeout?: number } | undefined;
    expect(Number.isFinite(options?.timeout)).toBe(true);
    expect((options?.timeout ?? 0)).toBeGreaterThan(0);
  });

  it('uses a latency-safe timeout budget for codex by default', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    delete process.env.CODEX_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'codex',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'codex');
    const options = call?.[2] as { timeout?: number } | undefined;
    expect((options?.timeout ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(60_000);
  });

  it('uses a 60s default timeout budget for codex when unset', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    delete process.env.CODEX_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'codex',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'codex');
    const options = call?.[2] as { timeout?: number } | undefined;
    expect(options?.timeout).toBe(60_000);
  });

  it('honors tighter per-request timeout budget for codex execution', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    delete process.env.CODEX_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'codex',
      timeoutMs: 1_500,
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'codex');
    const options = call?.[2] as { timeout?: number } | undefined;
    expect(options?.timeout).toBe(1_500);
  });

  it('uses a latency-safe timeout budget for claude by default', async () => {
    delete process.env.CLAUDE_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'claude');
    const options = call?.[2] as { timeout?: number } | undefined;
    expect((options?.timeout ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(60_000);
  });

  it('uses a 60s default timeout budget for claude when unset', async () => {
    delete process.env.CLAUDE_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'claude');
    const options = call?.[2] as { timeout?: number } | undefined;
    expect(options?.timeout).toBe(60_000);
  });

  it('honors tighter per-request timeout budget for claude execution', async () => {
    delete process.env.CLAUDE_TIMEOUT_MS;
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    await service.chat({
      provider: 'claude',
      timeoutMs: 2_000,
      messages: [{ role: 'user', content: 'hello' }],
    });

    const call = execaMock.mock.calls.find((entry) => entry[0] === 'claude');
    const options = call?.[2] as { timeout?: number } | undefined;
    expect(options?.timeout).toBe(2_000);
  });

  it('maps missing ANTHROPIC_API_KEY failures and falls back to codex', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    execaMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: ANTHROPIC_API_KEY is required',
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('codex');
    expect(execaMock.mock.calls[0]?.[0]).toBe('claude');
    expect(execaMock.mock.calls[1]?.[0]).toBe('codex');
  });

  it('uses Anthropic API transport in nested Claude sessions when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: 'anthropic-api-answer' }],
      }),
    })) as unknown as typeof fetch;

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('claude');
    expect(result.content).toContain('anthropic-api-answer');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('uses Claude broker transport in nested Claude sessions when broker URL is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
    process.env.LIBRARIAN_CLAUDE_BROKER_URL = 'http://127.0.0.1:8787';
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: 'broker-answer', provider: 'claude' }),
    })) as unknown as typeof fetch;

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('claude');
    expect(result.content).toContain('broker-answer');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('uses Anthropic API transport outside nested sessions when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: 'text', text: 'anthropic-api-answer' }],
      }),
    })) as unknown as typeof fetch;

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('claude');
    expect(result.content).toContain('anthropic-api-answer');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('allows forcing Claude CLI transport even when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.LIBRARIAN_CLAUDE_TRANSPORT = 'cli';
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'cli-answer',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('claude');
    expect(result.content).toContain('cli-answer');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0]?.[0]).toBe('claude');
  });

  it('skips Claude CLI in nested sessions without API key and falls back to codex', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'codex-answer',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('codex');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0]?.[0]).toBe('codex');
  });

  it('falls back to codex when claude fails', async () => {
    execaMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Claude CLI error: temporary outage',
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'codex-answer',
        stderr: '',
      } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('codex');
    expect(execaMock.mock.calls[0]?.[0]).toBe('claude');
    expect(execaMock.mock.calls[1]?.[0]).toBe('codex');
  });

  it('drops incompatible claude model IDs when falling back to codex', async () => {
    execaMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Cannot run Claude in this nested session',
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'codex-answer',
        stderr: '',
      } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      modelId: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('codex');
    const codexCall = execaMock.mock.calls.find((call) => call[0] === 'codex');
    expect(codexCall).toBeDefined();
    const codexArgs = (codexCall?.[1] ?? []) as string[];
    expect(codexArgs).not.toContain('claude-sonnet-4-20250514');
  });

  it('sanitizes multiline codex stderr in thrown errors', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    execaMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: [
        'Codex startup banner',
        'Database rollout error: sqlite busy',
        'Model X is not supported',
        'internal debug line 1',
      ].join('\n'),
    } as never);

    const service = new CliLlmService();
    try {
      await service.chat({
        provider: 'codex',
        messages: [{ role: 'user', content: 'hello' }],
      });
      throw new Error('expected chat to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/llm_execution_failed/);
      expect(message.includes('\n')).toBe(false);
      expect(message.length).toBeLessThan(280);
    }
  });

  it('prefers actionable codex error lines over version banners', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    execaMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: [
        'OpenAI Codex v0.104.0 (research preview)',
        'Error: recent rate_limit from codex provider',
      ].join('\n'),
    } as never);

    const service = new CliLlmService();
    try {
      await service.chat({
        provider: 'codex',
        messages: [{ role: 'user', content: 'hello' }],
      });
      throw new Error('expected chat to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('rate_limit');
      expect(message).not.toContain('OpenAI Codex v0.104.0');
    }
  });

  it('ignores codex metadata banners like workdir when actionable errors are present', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    execaMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: [
        'OpenAI Codex v0.104.0 (research preview)',
        '--------',
        'workdir: /tmp/repo',
        'model: gpt-5.3-codex',
        'provider: openai',
        'Error: rate_limit exceeded for current account',
      ].join('\n'),
    } as never);

    const service = new CliLlmService();
    try {
      await service.chat({
        provider: 'codex',
        messages: [{ role: 'user', content: 'hello' }],
      });
      throw new Error('expected chat to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('rate_limit');
      expect(message).not.toContain('workdir: /tmp/repo');
    }
  });

  it('maps codex state-db migration failures to actionable output', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    execaMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: [
          'OpenAI Codex v0.104.0 (research preview)',
          'workdir: /tmp/repo',
          '2026-02-28T20:00:00.000000Z  WARN codex_state::runtime: failed to open state db at /tmp/.codex/state_5.sqlite: migration 11 was previously applied but is missing in the resolved migrations',
        ].join('\n'),
      } as never)
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Claude CLI error: fallback provider unavailable',
      } as never);

    const service = new CliLlmService();
    try {
      await service.chat({
        provider: 'codex',
        messages: [{ role: 'user', content: 'hello' }],
      });
      throw new Error('expected chat to fail');
    } catch (error) {
      const codexFailureCall = vi.mocked(recordProviderFailure).mock.calls
        .find(([, failure]) => failure.provider === 'codex');
      expect(codexFailureCall).toBeDefined();
      const failure = codexFailureCall?.[1];
      expect(failure?.message).toContain('state DB migration mismatch');
      expect(failure?.message).not.toContain('workdir: /tmp/repo');
      const finalMessage = error instanceof Error ? error.message : String(error);
      expect(finalMessage).toContain('fallback provider unavailable');
    }
  });

  it('maps opaque separator-only codex failures to actionable diagnostics', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
    execaMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: '--------',
    } as never);

    const service = new CliLlmService();
    try {
      await service.chat({
        provider: 'codex',
        messages: [{ role: 'user', content: 'hello' }],
      });
      throw new Error('expected chat to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('failed without diagnostic output');
      expect(message).not.toContain('--------');
    }
  });

  it('does not hard-block retries for non-sticky provider failure records', async () => {
    vi.mocked(getActiveProviderFailures).mockResolvedValue({
      claude: {
        provider: 'claude',
        reason: 'unknown',
        message: 'transient test',
        at: new Date().toISOString(),
        ttlMs: 60000,
      },
    });
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.provider).toBe('claude');
  });

  it('prefers fallback provider when primary has sticky unavailable failure record', async () => {
    vi.mocked(getActiveProviderFailures).mockResolvedValue({
      claude: {
        provider: 'claude',
        reason: 'unavailable',
        message: 'cannot be launched inside another claude code session',
        at: new Date().toISOString(),
        ttlMs: 60000,
      },
    });
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.provider).toBe('codex');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0]?.[0]).toBe('codex');
  });

  it('reorders forced provider when its sticky failure is harder than fallback sticky failure', async () => {
    process.env.LIBRARIAN_LLM_PROVIDER = 'claude';
    vi.mocked(getActiveProviderFailures).mockResolvedValue({
      claude: {
        provider: 'claude',
        reason: 'unavailable',
        message: 'cannot be launched inside another claude code session',
        at: new Date().toISOString(),
        ttlMs: 600000,
      },
      codex: {
        provider: 'codex',
        reason: 'rate_limit',
        message: 'recent rate_limit from codex provider',
        at: new Date().toISOString(),
        ttlMs: 900000,
      },
    });
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as never);

    const service = new CliLlmService();
    const result = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.provider).toBe('codex');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0]?.[0]).toBe('codex');
  });

  it('recovers from chaos-injected corruption and succeeds on subsequent calls', async () => {
    process.env.LIBRARIAN_PROVIDER_CHAOS_ENABLED = '1';
    process.env.LIBRARIAN_PROVIDER_CHAOS_RATE = '1';
    process.env.LIBRARIAN_PROVIDER_CHAOS_SEQUENCE = 'truncated_response,slow_response,slow_response';
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'healthy provider response payload',
      stderr: '',
    } as never);

    const service = new CliLlmService();

    const first = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(first.provider).toBe('codex');

    const second = await service.chat({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hello again' }],
    });
    expect(second.provider).toBe('claude');
    expect(second.content.includes('provider_chaos')).toBe(false);
  });
});
