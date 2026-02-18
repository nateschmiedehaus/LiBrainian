import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP select technique compositions tool', () => {
  it('selects compositions based on intent', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      ensureTechniqueCompositions: vi.fn().mockResolvedValue([
        { id: 'tc_agentic_review_v1', name: 'Review', description: '', primitiveIds: [] },
        { id: 'tc_release_readiness', name: 'Release', description: '', primitiveIds: [] },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (server as unknown as {
      executeSelectTechniqueCompositions: (input: { workspace?: string; intent: string; limit?: number }) => Promise<any>;
    }).executeSelectTechniqueCompositions({ workspace, intent: 'Prepare a release plan' });

    expect(result.success).toBe(true);
    expect(result.compositions.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(['tc_release_readiness'])
    );
    expect(result.runId).toEqual(expect.any(String));
    expect(result.constructionResult).toBeDefined();
    expect(result.constructionResult.schema).toBe('SelectTechniqueCompositionsOutputSchema');
    expect(result.constructionResult.output.intent).toBe('Prepare a release plan');
    expect(result.constructionResult.meta.constructionId).toBe('select_technique_compositions');
  });
});
