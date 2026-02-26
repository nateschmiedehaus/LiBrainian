import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP symbol lookup tools', () => {
  it('explain_function returns function details with callers and callees', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getFunctionsByName: vi.fn().mockResolvedValue([
        {
          id: 'fn-query',
          name: 'queryLibrarian',
          signature: 'queryLibrarian(query, storage)',
          filePath: 'src/api/query.ts',
          purpose: 'Run ranked context retrieval',
          confidence: 0.91,
        },
      ]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockImplementation(async (options: any) => {
        if (Array.isArray(options?.fromIds) && options.fromIds.includes('fn-query')) {
          return [{ fromId: 'fn-query', toId: 'fn-score', sourceFile: 'src/api/query.ts', edgeType: 'calls' }];
        }
        if (Array.isArray(options?.toIds) && options.toIds.includes('fn-query')) {
          return [{ fromId: 'fn-entry', toId: 'fn-query', sourceFile: 'src/api/index.ts', edgeType: 'calls' }];
        }
        return [];
      }),
      getFunction: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'fn-score') {
          return { id, name: 'scorePacks', filePath: 'src/api/scoring.ts' };
        }
        if (id === 'fn-entry') {
          return { id, name: 'query', filePath: 'src/cli/index.ts' };
        }
        return null;
      }),
      getContextPackForTarget: vi.fn().mockResolvedValue({
        summary: 'Retrieves and ranks context packs for an intent',
      }),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeExplainFunction({
      workspace,
      name: 'queryLibrarian',
    });

    expect(result.found).toBe(true);
    expect(result.function?.id).toBe('fn-query');
    expect(result.function?.callers).toHaveLength(1);
    expect(result.function?.callees).toHaveLength(1);
    expect(result.function?.callers[0]?.name).toBe('query');
    expect(result.function?.callees[0]?.name).toBe('scorePacks');
  });

  it('find_usages returns callsites for matching symbols', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getFunctionsByName: vi.fn().mockResolvedValue([
        {
          id: 'fn-create',
          name: 'createLibrarian',
          signature: 'createLibrarian(config)',
          filePath: 'src/api/index.ts',
          purpose: 'Factory for librarian instances',
        },
      ]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockResolvedValue([
        { fromId: 'fn-a', toId: 'fn-create', sourceFile: 'src/cli/index.ts', edgeType: 'calls' },
        { fromId: 'fn-b', toId: 'fn-create', sourceFile: 'src/mcp/server.ts', edgeType: 'calls' },
      ]),
      getFunction: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'fn-a') return { id, name: 'bootstrapCommand', filePath: 'src/cli/index.ts' };
        if (id === 'fn-b') return { id, name: 'executeBootstrap', filePath: 'src/mcp/server.ts' };
        return null;
      }),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeFindUsages({
      workspace,
      symbol: 'createLibrarian',
    });

    expect(result.success).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.usageCount).toBe(2);
    expect(result.matches[0]?.files).toEqual(
      expect.arrayContaining(['src/cli/index.ts', 'src/mcp/server.ts'])
    );
  });

  it('find_callers returns direct and transitive callers', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getFunctionsByName: vi.fn().mockResolvedValue([
        {
          id: 'fn-target',
          name: 'targetFunction',
          signature: 'targetFunction()',
          filePath: 'src/core/target.ts',
        },
      ]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockImplementation(async (options: any) => {
        if (Array.isArray(options?.toIds) && options.toIds.includes('fn-target')) {
          return [{ fromId: 'fn-a', toId: 'fn-target', sourceFile: 'src/a.ts', sourceLine: 10, edgeType: 'calls', confidence: 0.9 }];
        }
        if (Array.isArray(options?.toIds) && options.toIds.includes('fn-a')) {
          return [{ fromId: 'fn-b', toId: 'fn-a', sourceFile: 'src/b.ts', sourceLine: 20, edgeType: 'calls', confidence: 0.85 }];
        }
        return [];
      }),
      getFunction: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'fn-a') return { id, name: 'callerA', filePath: 'src/a.ts' };
        if (id === 'fn-b') return { id, name: 'callerB', filePath: 'src/b.ts' };
        if (id === 'fn-target') return { id, name: 'targetFunction', filePath: 'src/core/target.ts' };
        return null;
      }),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeFindCallers({
      workspace,
      functionId: 'targetFunction',
      transitive: true,
      maxDepth: 2,
    });

    expect(result.success).toBe(true);
    expect(result.totalCallSites).toBe(2);
    expect(result.callSites.map((site: { callerFunctionId: string }) => site.callerFunctionId)).toEqual(
      expect.arrayContaining(['fn-a', 'fn-b']),
    );
  });

  it('find_callees returns direct callees for a function', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getFunctionsByName: vi.fn().mockResolvedValue([
        {
          id: 'fn-query',
          name: 'queryLibrarian',
          signature: 'queryLibrarian()',
          filePath: 'src/api/query.ts',
        },
      ]),
      getFunctions: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockResolvedValue([
        { fromId: 'fn-query', toId: 'fn-score', sourceFile: 'src/api/query.ts', sourceLine: 50, edgeType: 'calls', confidence: 0.95 },
        { fromId: 'fn-query', toId: 'fn-rank', sourceFile: 'src/api/query.ts', sourceLine: 60, edgeType: 'calls', confidence: 0.9 },
      ]),
      getFunction: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'fn-score') return { id, name: 'scorePacks', filePath: 'src/api/scoring.ts', purpose: 'Scores ranked candidates' };
        if (id === 'fn-rank') return { id, name: 'rankPacks', filePath: 'src/api/ranking.ts', purpose: 'Ranks candidates for response assembly' };
        return null;
      }),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeFindCallees({
      workspace,
      functionId: 'queryLibrarian',
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.totalCallees).toBe(2);
    expect(result.callees.map((callee: { functionId: string }) => callee.functionId)).toEqual(
      expect.arrayContaining(['fn-score', 'fn-rank']),
    );
  });

  it('trace_imports returns import and importedBy graph up to depth', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const storage = {
      getFiles: vi.fn().mockResolvedValue([
        {
          path: '/tmp/workspace/src/a.ts',
          relativePath: 'src/a.ts',
          imports: ['src/b.ts'],
          importedBy: ['src/d.ts'],
        },
        {
          path: '/tmp/workspace/src/b.ts',
          relativePath: 'src/b.ts',
          imports: ['src/c.ts'],
          importedBy: ['src/a.ts'],
        },
        {
          path: '/tmp/workspace/src/c.ts',
          relativePath: 'src/c.ts',
          imports: [],
          importedBy: ['src/b.ts'],
        },
        {
          path: '/tmp/workspace/src/d.ts',
          relativePath: 'src/d.ts',
          imports: ['src/a.ts'],
          importedBy: [],
        },
      ]),
      getFileByPath: vi.fn().mockResolvedValue(null),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeTraceImports({
      workspace,
      filePath: 'src/a.ts',
      direction: 'both',
      depth: 2,
    });

    expect(result.success).toBe(true);
    expect(result.imports).toEqual(expect.arrayContaining(['src/b.ts', 'src/c.ts']));
    expect(result.importedBy).toEqual(expect.arrayContaining(['src/d.ts']));
  });

  it('trace_control_flow returns basic blocks and cfg edges for a function', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const tmpRoot = path.join(process.cwd(), '.tmp');
    await fs.mkdir(tmpRoot, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(tmpRoot, 'symbol-lookup-'));
    const userFile = path.join(workspace, 'src', 'user.ts');
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(
      userFile,
      [
        'export async function getUserById(req: any, db: any) {',
        '  if (!req?.params?.userId) {',
        "    return null;",
        '  }',
        "  return db.query('select * from users where id = ?', [req.params.userId]);",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const storage = {
      getFunction: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'fn-target') {
          return {
            id: 'fn-target',
            name: 'getUserById',
            signature: 'getUserById(req, db)',
            filePath: userFile,
          };
        }
        return null;
      }),
      getFunctionsByName: vi.fn().mockImplementation(async (name: string) => {
        if (name === 'getUserById') {
          return [{
            id: 'fn-target',
            name: 'getUserById',
            signature: 'getUserById(req, db)',
            filePath: userFile,
          }];
        }
        return [];
      }),
      getFunctions: vi.fn().mockResolvedValue([]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeTraceControlFlow({
      workspace,
      functionId: 'getUserById',
      maxBlocks: 30,
    });

    expect(result.success).toBe(true);
    expect(result.resolvedFunctionName).toBe('getUserById');
    expect(Array.isArray(result.basicBlocks)).toBe(true);
    expect(result.totalBlocks).toBeGreaterThan(0);
    expect(Array.isArray(result.edges)).toBe(true);
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('trace_data_flow finds source-to-sink evidence for request params into db.query', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const tmpRoot = path.join(process.cwd(), '.tmp');
    await fs.mkdir(tmpRoot, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(tmpRoot, 'symbol-lookup-'));
    const userFile = path.join(workspace, 'src', 'user.ts');
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(
      userFile,
      [
        'export async function getUserById(req: any, db: any) {',
        '  const userId = req.params.userId;',
        "  return db.query('select * from users where id = ?', [userId]);",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const storage = {
      getFunctionsByName: vi.fn().mockImplementation(async (name: string) => {
        if (name === 'getUserById') {
          return [{
            id: 'fn-target',
            name: 'getUserById',
            signature: 'getUserById(req, db)',
            filePath: userFile,
          }];
        }
        if (name === 'query') {
          return [{
            id: 'fn-query',
            name: 'query',
            signature: 'query(sql, params)',
            filePath: userFile,
          }];
        }
        return [];
      }),
      getFunction: vi.fn().mockResolvedValue(null),
      getFunctions: vi.fn().mockResolvedValue([]),
      getFiles: vi.fn().mockResolvedValue([
        {
          path: userFile,
          relativePath: 'src/user.ts',
          imports: [],
          importedBy: [],
        },
      ]),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue(storage);

    const result = await (server as any).executeTraceDataFlow({
      workspace,
      source: 'req.params.userId',
      sink: 'db.query',
      functionId: 'getUserById',
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    await fs.rm(workspace, { recursive: true, force: true });
  });
});
