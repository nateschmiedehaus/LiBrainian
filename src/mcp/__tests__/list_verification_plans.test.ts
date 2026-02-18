import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP list verification plans tool', () => {
  it('returns paginated verification plans', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const mockLibrarian: any = {
      listVerificationPlans: vi.fn().mockResolvedValue([
        { id: 'vp-1' },
        { id: 'vp-2' },
        { id: 'vp-3' },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: mockLibrarian, indexState: 'ready' });

    const result = await (
      server as unknown as {
        executeListVerificationPlans: (
          input: { workspace?: string; pageSize?: number; pageIdx?: number }
        ) => Promise<any>;
      }
    ).executeListVerificationPlans({ workspace, pageSize: 2, pageIdx: 1 });

    expect(result.success).toBe(true);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.id).toBe('vp-3');
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.pageIdx).toBe(1);
    expect(result.pagination.totalItems).toBe(3);
    expect(result.pagination.pageCount).toBe(2);
    expect(result.pagination.showing).toBe('Showing 3-3 of 3. Next: none. Total pages: 2.');
  });
});
