import { describe, it, expect, vi } from 'vitest';
import { Librarian } from '../librarian.js';
import type { LibrarianStorage } from '../../storage/types.js';

// Mock provider checks to fail fast instead of timing out
vi.mock('../provider_check.js', () => ({
  // Unit tests should behave as if providers are unavailable, forcing the
  // system onto its keyword-based fallback path.
  requireProviders: vi.fn().mockRejectedValue(
    Object.assign(new Error('unverified_by_trace(provider_unavailable): test mode'), {
      name: 'ProviderUnavailableError',
    })
  ),
  checkAllProviders: vi.fn().mockResolvedValue({
    llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
    embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
  }),
  ProviderUnavailableError: class ProviderUnavailableError extends Error {
    constructor(public details: { message: string; missing: string[]; suggestion: string }) {
      super(details.message);
      this.name = 'ProviderUnavailableError';
    }
  },
}));

// Mock LLM env to avoid provider discovery
vi.mock('../llm_env.js', () => ({
  resolveLibrarianModelConfigWithDiscovery: vi.fn().mockResolvedValue({
    provider: 'claude',
    modelId: 'claude-sonnet-4-20250514',
  }),
  resolveLibrarianModelId: vi.fn().mockReturnValue('claude-sonnet-4-20250514'),
}));

type StorageStub = Pick<LibrarianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('Librarian composition selection', () => {
  it('selects technique compositions from storage', async () => {
    const librarian = new Librarian({
      workspace: '/tmp',
      autoBootstrap: false,
    });
    (librarian as unknown as { storage: LibrarianStorage }).storage =
      new MockStorage() as unknown as LibrarianStorage;

    const selections = await librarian.selectTechniqueCompositions('Prepare a release plan');
    expect(selections.map((item) => item.id)).toContain('tc_release_readiness');
  });
});
