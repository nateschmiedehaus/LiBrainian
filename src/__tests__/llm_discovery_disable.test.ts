import { describe, it, expect, afterEach, vi } from 'vitest';
import { createWorkspaceWithFiles, cleanupWorkspace } from './helpers/index.js';

vi.mock('../api/llm_env.js', async () => {
  const actual = await vi.importActual<typeof import('../api/llm_env.js')>('../api/llm_env.js');
  return {
    ...actual,
    resolveLibrarianModelConfigWithDiscovery: vi.fn(async () => {
      throw new Error('llm_discovery_called');
    }),
  };
});

describe('Librarian LLM discovery control', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips LLM discovery when disableLlmDiscovery is true', async () => {
    const workspace = await createWorkspaceWithFiles({
      'config/canon.json': JSON.stringify({ schema_version: 1 }, null, 2),
      'package.json': JSON.stringify({ name: 'llm-disable-test' }, null, 2),
      'src/index.ts': 'export const ok = true;\n',
    }, 'librarian-llm-disable-');

    const { Librarian } = await import('../api/librarian.js');
    const { resolveLibrarianModelConfigWithDiscovery } = await import('../api/llm_env.js');

    const librarian = new Librarian({
      workspace,
      autoBootstrap: false,
      disableLlmDiscovery: true,
    } as unknown as { workspace: string; autoBootstrap: boolean; disableLlmDiscovery: boolean });

    try {
      await librarian.initialize();
      expect(vi.mocked(resolveLibrarianModelConfigWithDiscovery)).not.toHaveBeenCalled();
    } finally {
      await librarian.shutdown();
      await cleanupWorkspace(workspace);
    }
  });
});
