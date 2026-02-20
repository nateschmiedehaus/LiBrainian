import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireProviders } from '../provider_check.js';
import { resolveLibrarianModelConfigWithDiscovery } from '../llm_env.js';
import { resolveLlmServiceAdapter } from '../../adapters/llm_service.js';

vi.mock('../provider_check.js', () => ({
  requireProviders: vi.fn(),
}));

vi.mock('../llm_env.js', () => ({
  resolveLibrarianModelConfigWithDiscovery: vi.fn(),
  resolveLibrarianModelId: vi.fn(),
}));

vi.mock('../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: vi.fn(),
}));

describe('llm purpose extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to heuristic with disclosure when provider unavailable', async () => {
    vi.mocked(requireProviders).mockRejectedValue(new Error('no provider'));

    const { extractPurpose } = await import('../embedding_providers/llm_purpose_extractor.js');
    const result = await extractPurpose('src/example.ts', 'export const value = 1;', { allowHeuristics: true });

    expect(result.purpose.source).toBe('heuristic');
    expect(result.purpose.disclosures?.join(' ')).toMatch(/provider_unavailable/);
  });

  it('marks invalid LLM output and falls back when heuristics are allowed', async () => {
    vi.mocked(requireProviders).mockResolvedValue(undefined);
    vi.mocked(resolveLibrarianModelConfigWithDiscovery).mockResolvedValue({ provider: 'claude', modelId: 'test-model' });
    const chat = vi.fn().mockResolvedValue({ content: 'not json', provider: 'claude' });
    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const { extractPurpose } = await import('../embedding_providers/llm_purpose_extractor.js');
    const result = await extractPurpose('src/example.ts', 'export const value = 1;', { allowHeuristics: true });

    expect(result.purpose.source).toBe('heuristic');
    expect(result.purpose.disclosures?.join(' ')).toMatch(/provider_invalid_output/);
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it('throws on invalid LLM output when heuristics are not allowed', async () => {
    vi.mocked(requireProviders).mockResolvedValue(undefined);
    vi.mocked(resolveLibrarianModelConfigWithDiscovery).mockResolvedValue({ provider: 'claude', modelId: 'test-model' });
    const chat = vi.fn().mockResolvedValue({ content: 'not json', provider: 'claude' });
    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const { extractPurpose } = await import('../embedding_providers/llm_purpose_extractor.js');

    await expect(
      extractPurpose('src/example.ts', 'export const value = 1;', { allowHeuristics: false })
    ).rejects.toThrow(/provider_invalid_output/);
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it('retries malformed output and succeeds when provider returns valid structured JSON', async () => {
    vi.mocked(requireProviders).mockResolvedValue(undefined);
    vi.mocked(resolveLibrarianModelConfigWithDiscovery).mockResolvedValue({ provider: 'claude', modelId: 'test-model' });
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: 'definitely not json', provider: 'claude' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          purpose: 'Provides deterministic helpers for test assertions.',
          responsibilities: ['Generate fixtures', 'Normalize output'],
          domain: 'testing',
          complexity: 'simple',
          concepts: ['determinism'],
          relatedTo: ['unit-tests'],
        }),
        provider: 'claude',
      });
    vi.mocked(resolveLlmServiceAdapter).mockReturnValue({
      chat,
      checkClaudeHealth: vi.fn(),
      checkCodexHealth: vi.fn(),
    });

    const { extractPurpose } = await import('../embedding_providers/llm_purpose_extractor.js');
    const result = await extractPurpose('src/example.ts', 'export const value = 1;', { allowHeuristics: false });

    expect(result.purpose.source).toBe('llm');
    expect(result.purpose.purpose).toContain('deterministic helpers');
    expect(result.purpose.domain).toBe('testing');
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
