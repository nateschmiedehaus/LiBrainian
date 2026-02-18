import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP list episodes tool', () => {
  it('returns paginated episodes', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      listEpisodes: vi.fn().mockResolvedValue([
        { id: 'ep-1' },
        { id: 'ep-2' },
        { id: 'ep-3' },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (
      server as unknown as {
        executeListEpisodes: (input: { workspace?: string; pageSize?: number; pageIdx?: number }) => Promise<any>;
      }
    ).executeListEpisodes({ workspace, pageSize: 2, pageIdx: 1 });

    expect(result.success).toBe(true);
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]?.id).toBe('ep-3');
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.pageIdx).toBe(1);
    expect(result.pagination.totalItems).toBe(3);
  });
});
