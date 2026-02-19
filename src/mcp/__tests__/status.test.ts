import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP status tool', () => {
  it('includes persistent watch state when available', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace';
    const watchState = {
      schema_version: 1,
      workspace_root: workspace,
      watch_started_at: '2026-01-19T01:00:00.000Z',
      watch_last_heartbeat_at: '2026-01-19T01:05:00.000Z',
      watch_last_event_at: '2026-01-19T01:06:00.000Z',
      watch_last_reindex_ok_at: '2026-01-19T01:07:00.000Z',
      suspected_dead: false,
      needs_catchup: false,
      storage_attached: true,
      updated_at: '2026-01-19T01:07:30.000Z',
    };

    const mockLibrarian: any = {
      getStatus: vi.fn().mockResolvedValue({
        initialized: true,
        bootstrapped: true,
        version: null,
        stats: {
          totalFunctions: 0,
          totalModules: 0,
          totalContextPacks: 0,
          averageConfidence: 0,
        },
        lastBootstrap: null,
      }),
      isWatching: vi.fn().mockReturnValue(true),
      getWatchStatus: vi.fn().mockResolvedValue({
        active: true,
        storageAttached: true,
        state: watchState,
        health: { suspectedDead: false },
      }),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      librarian: mockLibrarian,
      watching: true,
      indexState: 'ready',
      indexedAt: '2026-01-19T00:00:00.000Z',
    });

    const result = await (server as unknown as { executeStatus: (input: { workspace?: string }) => Promise<any> })
      .executeStatus({ workspace });

    expect(result.autoWatch.state).toEqual(watchState);
    expect(result.autoWatch.storageAttached).toBe(true);
    expect(result.autoWatch.health).toEqual({ suspectedDead: false });
  });

  it('reports embedding coverage summary when storage stats are available', async () => {
    const server = await createLibrarianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace-coverage';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 100,
        totalEmbeddings: 75,
      }),
    });

    const result = await (server as unknown as { executeStatus: (input: { workspace?: string }) => Promise<any> })
      .executeStatus({ workspace });

    expect(result.embeddingCoverage?.total_functions).toBe(100);
    expect(result.embeddingCoverage?.embedded_functions).toBe(75);
    expect(result.embeddingCoverage?.coverage_pct).toBe(75);
    expect(result.embeddingCoverage?.needs_embedding_count).toBe(25);
  });
});
