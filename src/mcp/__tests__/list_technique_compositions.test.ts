import { describe, it, expect, vi } from 'vitest';
import { createLiBrainianMCPServer } from '../server.js';

describe('MCP list technique compositions tool', () => {
  it('returns paginated technique compositions', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLiBrainian: any = {
      listTechniqueCompositions: vi.fn().mockResolvedValue([
        { id: 'tc-1' },
        { id: 'tc-2' },
        { id: 'tc-3' },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librainian: mockLiBrainian, indexState: 'ready' });

    const result = await (server as unknown as {
      executeListTechniqueCompositions: (
        input: { workspace?: string; pageSize?: number; pageIdx?: number }
      ) => Promise<any>;
    }).executeListTechniqueCompositions({ workspace, pageSize: 2, pageIdx: 1 });

    expect(result.success).toBe(true);
    expect(result.compositions).toHaveLength(1);
    expect(result.compositions[0]?.id).toBe('tc-3');
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.pageIdx).toBe(1);
    expect(result.pagination.totalItems).toBe(3);
  });
});
