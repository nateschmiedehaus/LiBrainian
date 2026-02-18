import { describe, it, expect } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';
import type { LibrarianStorage } from '../../storage/types.js';

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

describe('MCP compile technique composition tool', () => {
  it('compiles a composition to a work template', async () => {
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
      executeCompileTechniqueComposition: (input: { workspace?: string; compositionId: string; includePrimitives?: boolean }) => Promise<any>;
    }).executeCompileTechniqueComposition({
      workspace,
      compositionId: 'tc_release_readiness',
      includePrimitives: true,
    });

    expect(result.success).toBe(true);
    expect(result.template?.id).toBe('wt_tc_release_readiness');
    expect(result.missingPrimitiveIds).toEqual([]);
    expect(result.primitives.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(['tp_release_plan'])
    );
    expect(result.runId).toEqual(expect.any(String));
    expect(result.constructionResult).toBeDefined();
    expect(result.constructionResult.schema).toBe('CompileTechniqueCompositionOutputSchema');
    expect(result.constructionResult.meta.constructionId).toBe('compile_technique_composition');
  });
});
