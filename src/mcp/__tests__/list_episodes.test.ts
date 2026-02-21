import { describe, it, expect, vi } from 'vitest';
import { createLiBrainianMCPServer } from '../server.js';

describe('MCP list episodes tool', () => {
  it('returns paginated episodes', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLiBrainian: any = {
      listEpisodes: vi.fn().mockResolvedValue([
        { id: 'ep-1' },
        { id: 'ep-2' },
        { id: 'ep-3' },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librainian: mockLiBrainian, indexState: 'ready' });

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
