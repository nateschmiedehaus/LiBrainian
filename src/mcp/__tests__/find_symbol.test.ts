import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP find_symbol tool', () => {
  it('discovers claim IDs for verify_claim', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getContextPacks: vi.fn().mockResolvedValue([
        {
          packId: 'claim-auth-1',
          packType: 'function_context',
          targetId: 'src/auth.ts::verifyToken',
          summary: 'Validate auth token signature and expiry',
          keyFacts: ['Token verification', 'JWT expiry check'],
          relatedFiles: ['src/auth.ts'],
        },
      ]),
      getFunctionsByName: vi.fn().mockResolvedValue([]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getModules: vi.fn().mockResolvedValue([]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeFindSymbol({
      workspace,
      query: 'auth token',
      kind: 'claim',
    });

    expect(result.success).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.id).toBe('claim-auth-1');
    expect(result.matches[0]?.kind).toBe('claim');
  });

  it('returns function, composition, and run matches when kind is omitted', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getContextPacks: vi.fn().mockResolvedValue([]),
      getFunctionsByName: vi.fn().mockResolvedValue([
        {
          id: 'fn-auth-1',
          name: 'authenticateUser',
          signature: 'authenticateUser(token: string): boolean',
          filePath: 'src/auth.ts',
          purpose: 'Authenticate session token',
        },
      ]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getModules: vi.fn().mockResolvedValue([]),
    };

    const mockLibrarian = {
      listTechniqueCompositions: vi.fn().mockResolvedValue([
        {
          id: 'tc_auth_review',
          name: 'Auth Review',
          description: 'Authentication review composition',
          primitiveIds: ['tp_verify_claim'],
        },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready', librarian: mockLibrarian as any });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);
    (server as any).getBootstrapRunHistory = vi.fn().mockResolvedValue([
      {
        runId: 'run-auth-1',
        workspace,
        startedAt: '2026-02-19T00:00:00.000Z',
        success: true,
        durationMs: 1000,
        stats: {
          filesProcessed: 1,
          functionsIndexed: 1,
          contextPacksCreated: 1,
          averageConfidence: 0.9,
        },
      },
    ]);

    const result = await (server as any).executeFindSymbol({
      workspace,
      query: 'auth',
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.matches.some((match: any) => match.id === 'fn-auth-1' && match.kind === 'function')).toBe(true);
    expect(result.matches.some((match: any) => match.id === 'tc_auth_review' && match.kind === 'composition')).toBe(true);
    expect(result.matches.some((match: any) => match.id === 'run-auth-1' && match.kind === 'run')).toBe(true);
    expect(result.matches[0]?.id).toBe('fn-auth-1');
  });
});
