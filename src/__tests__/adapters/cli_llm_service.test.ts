import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { CliLlmService } from '../../adapters/cli_llm_service.js';
import { getActiveProviderFailures } from '../../utils/provider_failures.js';

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

  beforeEach(() => {
    execaMock.mockReset();
    delete process.env.LIBRARIAN_LLM_PROVIDER;
    delete process.env.WAVE0_LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
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
});
