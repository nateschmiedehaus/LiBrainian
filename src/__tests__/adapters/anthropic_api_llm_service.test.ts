import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnthropicApiLlmService,
  ApiLlmService,
  isInsideClaudeCodeSession,
  createAutoLlmServiceFactory,
  createAnthropicApiLlmServiceFactory,
  createApiLlmServiceFactory,
} from '../../adapters/anthropic_api_llm_service.js';
import { CliLlmService } from '../../adapters/cli_llm_service.js';
import { getActiveProviderFailures } from '../../utils/provider_failures.js';

vi.mock('../../utils/provider_failures.js', () => ({
  classifyProviderFailure: vi.fn(() => ({ reason: 'unknown', ttlMs: 1000 })),
  getActiveProviderFailures: vi.fn(async () => ({})),
  recordProviderFailure: vi.fn(async () => undefined),
  recordProviderSuccess: vi.fn(async () => undefined),
  resolveProviderWorkspaceRoot: vi.fn(() => process.cwd()),
}));

vi.mock('../../security/privacy_audit.js', () => ({
  appendPrivacyAuditEvent: vi.fn(async () => undefined),
}));

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

const fetchMock = vi.fn<typeof globalThis.fetch>();

describe('AnthropicApiLlmService', () => {
  const savedEnv = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    CLAUDE_TIMEOUT_MS: process.env.CLAUDE_TIMEOUT_MS,
    CLAUDE_MAX_CONCURRENT: process.env.CLAUDE_MAX_CONCURRENT,
    LLM_HEALTH_CHECK_INTERVAL_MS: process.env.LLM_HEALTH_CHECK_INTERVAL_MS,
    LIBRARIAN_PRIVACY_MODE: process.env.LIBRARIAN_PRIVACY_MODE,
    CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
    CLAUDE_CODE: process.env.CLAUDE_CODE,
    SESSION_ID: process.env.SESSION_ID,
    CLAUDE_MODEL: process.env.CLAUDE_MODEL,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-1234';
    delete process.env.CLAUDE_TIMEOUT_MS;
    delete process.env.CLAUDE_MAX_CONCURRENT;
    delete process.env.LLM_HEALTH_CHECK_INTERVAL_MS;
    delete process.env.LIBRARIAN_PRIVACY_MODE;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    delete process.env.CLAUDE_CODE;
    delete process.env.SESSION_ID;
    delete process.env.CLAUDE_MODEL;
    vi.mocked(getActiveProviderFailures).mockResolvedValue({});
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  function makeApiResponse(content: string, model = 'claude-haiku-4-20250514') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: content }],
        model,
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    } as unknown as Response;
  }

  function makeApiError(status: number, errorType: string, errorMessage: string) {
    return {
      ok: false,
      status,
      json: async () => ({
        type: 'error',
        error: { type: errorType, message: errorMessage },
      }),
    } as unknown as Response;
  }

  describe('backward compatibility', () => {
    it('ApiLlmService is the same as AnthropicApiLlmService', () => {
      expect(ApiLlmService).toBe(AnthropicApiLlmService);
    });

    it('createApiLlmServiceFactory is the same as createAnthropicApiLlmServiceFactory', () => {
      expect(createApiLlmServiceFactory).toBe(createAnthropicApiLlmServiceFactory);
    });

    it('ApiLlmService instances pass instanceof AnthropicApiLlmService', () => {
      const service = new ApiLlmService();
      expect(service).toBeInstanceOf(AnthropicApiLlmService);
    });
  });

  describe('constructor', () => {
    it('throws when no API key is available', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => new AnthropicApiLlmService()).toThrow('ANTHROPIC_API_KEY is required');
    });

    it('accepts explicit API key parameter', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const service = new AnthropicApiLlmService('sk-ant-explicit-key');
      expect(service).toBeInstanceOf(AnthropicApiLlmService);
    });

    it('reads API key from environment', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';
      const service = new AnthropicApiLlmService();
      expect(service).toBeInstanceOf(AnthropicApiLlmService);
    });
  });

  describe('chat', () => {
    it('makes a successful API call and returns content', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('Hello from API'));

      const service = new AnthropicApiLlmService();
      const result = await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(result.provider).toBe('claude');
      expect(result.content).toBe('Hello from API');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-test-key-1234');
      expect(headers['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.model).toBe('claude-haiku-4-20250514');
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('extracts system messages from the message array', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('response'));

      const service = new AnthropicApiLlmService();
      await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'hello' },
        ],
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.system).toBe('You are a helpful assistant');
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('merges multiple system messages', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('response'));

      const service = new AnthropicApiLlmService();
      await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [
          { role: 'system', content: 'Rule 1' },
          { role: 'system', content: 'Rule 2' },
          { role: 'user', content: 'hello' },
        ],
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.system).toBe('Rule 1\n\nRule 2');
    });

    it('merges consecutive same-role messages', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('response'));

      const service = new AnthropicApiLlmService();
      await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [
          { role: 'user', content: 'part 1' },
          { role: 'user', content: 'part 2' },
        ],
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.messages).toEqual([{ role: 'user', content: 'part 1\n\npart 2' }]);
    });

    it('uses default model when none specified', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('response'));

      const service = new AnthropicApiLlmService();
      await service.chat({
        provider: 'claude',
        modelId: '',
        messages: [{ role: 'user', content: 'hello' }],
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.model).toBe('claude-haiku-4-20250514');
    });

    it('passes temperature when provided', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('response'));

      const service = new AnthropicApiLlmService();
      await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.temperature).toBe(0.7);
    });

    it('passes maxTokens when provided', async () => {
      fetchMock.mockResolvedValueOnce(makeApiResponse('response'));

      const service = new AnthropicApiLlmService();
      await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        maxTokens: 1024,
      });

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.max_tokens).toBe(1024);
    });

    it('throws on auth errors (401)', async () => {
      fetchMock.mockResolvedValueOnce(
        makeApiError(401, 'authentication_error', 'Invalid API key')
      );

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/llm_execution_failed.*auth_failed/);
    });

    it('throws on rate limit errors (429)', async () => {
      fetchMock.mockResolvedValueOnce(
        makeApiError(429, 'rate_limit_error', 'Rate limit exceeded')
      );

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/llm_execution_failed.*rate_limit/);
    });

    it('throws on server errors (500)', async () => {
      fetchMock.mockResolvedValueOnce(
        makeApiError(500, 'api_error', 'Internal server error')
      );

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/llm_execution_failed/);
    });

    it('throws on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/llm_execution_failed.*network error/);
    });

    it('throws on invalid JSON response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new Error('invalid json'); },
      } as unknown as Response);

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/llm_execution_failed.*invalid JSON/);
    });

    it('blocks requests in strict privacy mode', async () => {
      process.env.LIBRARIAN_PRIVACY_MODE = 'strict';

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/Privacy mode/);
    });

    it('blocks when sticky auth failure is recorded', async () => {
      vi.mocked(getActiveProviderFailures).mockResolvedValue({
        claude: {
          provider: 'claude',
          reason: 'auth_failed',
          message: 'previous auth failure',
          at: new Date().toISOString(),
          ttlMs: 60000,
        },
      });

      const service = new AnthropicApiLlmService();
      await expect(
        service.chat({
          provider: 'claude',
          modelId: 'claude-haiku-4-20250514',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow(/provider_unavailable.*auth_failed/);
    });

    it('allows requests with non-sticky failure records', async () => {
      vi.mocked(getActiveProviderFailures).mockResolvedValue({
        claude: {
          provider: 'claude',
          reason: 'timeout',
          message: 'transient timeout',
          at: new Date().toISOString(),
          ttlMs: 60000,
        },
      });
      fetchMock.mockResolvedValueOnce(makeApiResponse('ok'));

      const service = new AnthropicApiLlmService();
      const result = await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result.content).toBe('ok');
    });

    it('concatenates multiple text content blocks', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'World' },
          ],
          model: 'claude-haiku-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      } as unknown as Response);

      const service = new AnthropicApiLlmService();
      const result = await service.chat({
        provider: 'claude',
        modelId: 'claude-haiku-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result.content).toBe('Hello World');
    });
  });

  describe('checkClaudeHealth', () => {
    it('returns healthy status without forceCheck when key looks valid', async () => {
      const service = new AnthropicApiLlmService();
      const health = await service.checkClaudeHealth();
      expect(health.provider).toBe('claude');
      expect(health.available).toBe(true);
      expect(health.authenticated).toBe(true);
    });

    it('returns unauthenticated when key format is invalid', async () => {
      const service = new AnthropicApiLlmService('not-a-real-key');
      const health = await service.checkClaudeHealth();
      expect(health.available).toBe(true);
      expect(health.authenticated).toBe(false);
      expect(health.error).toMatch(/valid Anthropic key/);
    });

    it('uses cached result within interval', async () => {
      const service = new AnthropicApiLlmService();
      const first = await service.checkClaudeHealth();
      const second = await service.checkClaudeHealth();
      // Both should be the same reference (cached)
      expect(first.lastCheck).toBe(second.lastCheck);
    });

    it('makes API probe on forceCheck', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response);

      const service = new AnthropicApiLlmService();
      const health = await service.checkClaudeHealth(true);
      expect(health.available).toBe(true);
      expect(health.authenticated).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('detects auth failure on forceCheck with 401', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ type: 'error', error: { type: 'authentication_error', message: 'Invalid key' } }),
      } as unknown as Response);

      const service = new AnthropicApiLlmService();
      const health = await service.checkClaudeHealth(true);
      expect(health.authenticated).toBe(false);
      expect(health.error).toMatch(/authentication failed/);
    });
  });

  describe('checkCodexHealth', () => {
    it('always returns unavailable (codex not supported via API transport)', async () => {
      const service = new AnthropicApiLlmService();
      const health = await service.checkCodexHealth();
      expect(health.provider).toBe('codex');
      expect(health.available).toBe(false);
      expect(health.error).toMatch(/not available via Anthropic API/);
    });
  });
});

describe('isInsideClaudeCodeSession', () => {
  const saved = {
    CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
    CLAUDE_CODE: process.env.CLAUDE_CODE,
    SESSION_ID: process.env.SESSION_ID,
    CLAUDE_MODEL: process.env.CLAUDE_MODEL,
  };

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
    delete process.env.CLAUDE_CODE;
    delete process.env.SESSION_ID;
    delete process.env.CLAUDE_MODEL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns false with no env vars set', () => {
    expect(isInsideClaudeCodeSession()).toBe(false);
  });

  it('returns true when CLAUDE_CODE_ENTRYPOINT is set', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = '/usr/local/bin/claude';
    expect(isInsideClaudeCodeSession()).toBe(true);
  });

  it('returns true when CLAUDE_CODE is set', () => {
    process.env.CLAUDE_CODE = '1';
    expect(isInsideClaudeCodeSession()).toBe(true);
  });

  it('returns true when SESSION_ID + CLAUDE_MODEL are both set', () => {
    process.env.SESSION_ID = 'abc123';
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-20250514';
    expect(isInsideClaudeCodeSession()).toBe(true);
  });

  it('returns false when only SESSION_ID is set (no CLAUDE_MODEL)', () => {
    process.env.SESSION_ID = 'abc123';
    expect(isInsideClaudeCodeSession()).toBe(false);
  });
});

describe('createAutoLlmServiceFactory', () => {
  const saved = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns AnthropicApiLlmService when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const factory = createAutoLlmServiceFactory();
    const service = await factory();
    expect(service).toBeInstanceOf(AnthropicApiLlmService);
  });

  it('returns CliLlmService when OPENAI_API_KEY is set (no Anthropic key)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    const factory = createAutoLlmServiceFactory();
    const service = await factory();
    expect(service).not.toBeInstanceOf(AnthropicApiLlmService);
    expect(service).toBeInstanceOf(CliLlmService);
    expect(typeof service.chat).toBe('function');
    expect(typeof service.checkClaudeHealth).toBe('function');
    expect(typeof service.checkCodexHealth).toBe('function');
  });

  it('prefers ANTHROPIC_API_KEY over OPENAI_API_KEY when both are set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.OPENAI_API_KEY = 'sk-openai-test-key';
    const factory = createAutoLlmServiceFactory();
    const service = await factory();
    expect(service).toBeInstanceOf(AnthropicApiLlmService);
  });

  it('falls back to CliLlmService when neither API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const factory = createAutoLlmServiceFactory();
    const service = await factory();
    // Should not be AnthropicApiLlmService
    expect(service).not.toBeInstanceOf(AnthropicApiLlmService);
    expect(service).toBeInstanceOf(CliLlmService);
    // Check it has the right interface
    expect(typeof service.chat).toBe('function');
    expect(typeof service.checkClaudeHealth).toBe('function');
    expect(typeof service.checkCodexHealth).toBe('function');
  });
});
