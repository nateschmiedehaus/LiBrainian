import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP list technique primitives tool', () => {
  it('returns paginated technique primitives', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      listTechniquePrimitives: vi.fn().mockResolvedValue([
        { id: 'tp-1' },
        { id: 'tp-2' },
        { id: 'tp-3' },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (
      server as unknown as {
        executeListTechniquePrimitives: (
          input: { workspace?: string; pageSize?: number; pageIdx?: number }
        ) => Promise<any>;
      }
    ).executeListTechniquePrimitives({ workspace, pageSize: 2, pageIdx: 1 });

    expect(result.success).toBe(true);
    expect(result.primitives).toHaveLength(1);
    expect(result.primitives[0]?.id).toBe('tp-3');
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.pageIdx).toBe(1);
    expect(result.pagination.totalItems).toBe(3);
  });
});
