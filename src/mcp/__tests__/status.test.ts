import { describe, it, expect, vi } from 'vitest';
import { createLiBrainianMCPServer } from '../server.js';
import { readQueryCostTelemetry } from '../../api/query_cost_telemetry.js';

vi.mock('../../api/query_cost_telemetry.js', () => ({
  readQueryCostTelemetry: vi.fn().mockResolvedValue(null),
}));

describe('MCP status tool', () => {
  it('includes persistent watch state when available', async () => {
    const server = await createLiBrainianMCPServer({
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

    const mockLiBrainian: any = {
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
      librarian: mockLiBrainian,
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
    const server = await createLiBrainianMCPServer({
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

  it('includes cost telemetry in status output', async () => {
    vi.mocked(readQueryCostTelemetry).mockResolvedValue({
      kind: 'QueryCostTelemetry.v1',
      generatedAt: '2026-02-21T00:00:00.000Z',
      workspace: '/tmp/workspace-costs',
      dataSource: 'evidence_ledger',
      lookbackDays: 7,
      budgetUsd: 0.25,
      totals: {
        sessionId: null,
        queriesCount: 1,
        totalTokensIn: 100,
        totalTokensOut: 50,
        totalTokens: 150,
        llmCalls: 1,
        totalCostUsd: 0.02,
        avgLatencyMs: 80,
        budgetUsd: 0.25,
        budgetExceeded: false,
      },
      session: {
        sessionId: 'sess-cost',
        queriesCount: 1,
        totalTokensIn: 100,
        totalTokensOut: 50,
        totalTokens: 150,
        llmCalls: 1,
        totalCostUsd: 0.02,
        avgLatencyMs: 80,
        budgetUsd: 0.25,
        budgetExceeded: false,
      },
      perQuery: [],
      sessionDistribution: [],
      alerts: [],
    });

    const server = await createLiBrainianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = '/tmp/workspace-costs';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    const result = await (server as unknown as {
      executeStatus: (input: { workspace?: string; sessionId?: string }) => Promise<any>;
    }).executeStatus({ workspace, sessionId: 'sess-cost' });

    expect(result.costMetrics?.session?.sessionId).toBe('sess-cost');
    expect(result.cost_metrics?.totals?.queriesCount).toBe(1);
    expect(readQueryCostTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: workspace,
      sessionId: 'sess-cost',
      lookbackDays: 7,
      maxPerQuery: 10,
    }));
  });
});
