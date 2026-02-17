import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { CliLlmService } from '../../adapters/cli_llm_service.js';

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
});
