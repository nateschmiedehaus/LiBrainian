import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkProvidersCommand } from '../check_providers.js';
import { checkAllProviders } from '../../../api/provider_check.js';
import { runProviderReadinessGate } from '../../../api/provider_gate.js';

vi.mock('../../../api/provider_check.js', () => ({
  checkAllProviders: vi.fn(),
}));
vi.mock('../../../api/provider_gate.js', () => ({
  runProviderReadinessGate: vi.fn(),
}));

describe('checkProvidersCommand', () => {
  const workspace = '/test/workspace';
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(checkAllProviders).mockResolvedValue({
      llm: { available: true, provider: 'claude', model: 'test-model', latencyMs: 120 },
      embedding: { available: true, provider: 'xenova', model: 'test-embed', latencyMs: 50 },
    });
    vi.mocked(runProviderReadinessGate).mockResolvedValue({
      ready: true,
      selectedProvider: 'claude',
      reason: null,
      remediationSteps: [],
      providers: [
        { provider: 'claude', available: true, authenticated: true, error: null },
      ],
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('emits JSON when format is json', async () => {
    await checkProvidersCommand({ workspace, format: 'json' });

    const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
    expect(typeof output).toBe('string');
    const parsed = JSON.parse(output ?? '{}') as { workspace?: string; gate?: { ready?: boolean } };
    expect(parsed.workspace).toBe(workspace);
    expect(parsed.gate?.ready).toBe(true);
  });
});
