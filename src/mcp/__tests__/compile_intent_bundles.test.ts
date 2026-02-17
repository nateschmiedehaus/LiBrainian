import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';
import type { LibrarianStorage } from '../../storage/types.js';

// Mock provider checks to fail fast instead of timing out
vi.mock('../../api/provider_check.js', () => ({
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
vi.mock('../../api/llm_env.js', () => ({
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

describe('MCP compile intent bundles tool', () => {
  it('compiles bundles from intent', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      getStorage: () => new MockStorage(),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (server as unknown as {
      executeCompileIntentBundles: (input: { workspace?: string; intent: string; limit?: number }) => Promise<any>;
    }).executeCompileIntentBundles({ workspace, intent: 'Prepare a release plan' });

    expect(result.success).toBe(true);
    expect(result.bundles.map((bundle: { template: { id: string } | null }) => bundle.template?.id)).toEqual(
      expect.arrayContaining(['wt_tc_release_readiness'])
    );
  });

  it('limits bundles from intent', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      getStorage: () => new MockStorage(),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (server as unknown as {
      executeCompileIntentBundles: (input: { workspace?: string; intent: string; limit?: number }) => Promise<any>;
    }).executeCompileIntentBundles({ workspace, intent: 'release performance review', limit: 1 });

    expect(result.success).toBe(true);
    expect(result.bundles).toHaveLength(1);
    expect(result.total).toBeGreaterThan(1);
    expect(result.limited).toBe(1);
  });

  it('omits primitives when includePrimitives=false', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      getStorage: () => new MockStorage(),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (server as unknown as {
      executeCompileIntentBundles: (input: { workspace?: string; intent: string; includePrimitives?: boolean }) => Promise<any>;
    }).executeCompileIntentBundles({ workspace, intent: 'Prepare a release plan', includePrimitives: false });

    expect(result.success).toBe(true);
    expect(result.bundles[0]?.primitives).toBeUndefined();
  });
});
