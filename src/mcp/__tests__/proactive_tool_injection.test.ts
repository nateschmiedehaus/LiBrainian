import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { estimateTokens } from '../../api/token_budget.js';
import { createLibrarianMCPServer, type LibrarianMCPServer } from '../server.js';

function makeStorageMock(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    getContextPacks: async () => [],
    getFunctionsByPath: async () => [],
    getGraphEdges: async () => [],
    getFunction: async () => null,
    ...overrides,
  };
}

describe('MCP proactive tool injection', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-mcp-injection-'));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('is opt-in and returns null by default', async () => {
    const server = await createLibrarianMCPServer();
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      indexState: 'ready',
      storage: makeStorageMock() as any,
    });

    const injected = await (server as any).onToolCall('read_file', {
      workspace,
      path: 'src/auth/login.ts',
    });

    expect(injected).toBeNull();
  });

  it('injects read_file context when enabled and coverage is at least 50%', async () => {
    const filePath = path.join(workspace, 'src/auth/login.ts');
    const server = await createLibrarianMCPServer({
      proactiveInjection: {
        enabled: true,
        maxTokens: 2000,
        minCoverage: 0.5,
      },
    } as any);
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      indexState: 'ready',
      storage: makeStorageMock({
        getContextPacks: async () => [
          {
            packId: 'pack-login',
            packType: 'function_context',
            targetId: 'fn-login',
            summary: 'Handles login validation, session issuance, and redirect decisions.',
            keyFacts: [
              'Calls validateCredentials before issuing a session token.',
              'Imports rate-limit utility for brute-force defense.',
            ],
            relatedFiles: [filePath, path.join(workspace, 'src/auth/session.ts')],
            confidence: 0.92,
          },
        ],
        getFunctionsByPath: async () => [
          { id: 'fn-login', name: 'login' },
          { id: 'fn-session', name: 'createSession' },
        ],
      }) as any,
    });

    const injected = await (server as any).onToolCall('read_file', {
      workspace,
      path: 'src/auth/login.ts',
    });

    expect(injected).toContain('LiBrainian Proactive Context');
    expect(injected).toContain('Tool: read_file');
    expect(injected).toContain('Coverage: 50.0%');
    expect(injected).toContain('Handles login validation');
    expect(estimateTokens(String(injected))).toBeLessThanOrEqual(2000);
  });

  it('skips injection when coverage is below threshold', async () => {
    const filePath = path.join(workspace, 'src/auth/login.ts');
    const server = await createLibrarianMCPServer({
      proactiveInjection: {
        enabled: true,
        maxTokens: 2000,
        minCoverage: 0.5,
      },
    } as any);
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      indexState: 'ready',
      storage: makeStorageMock({
        getContextPacks: async () => [
          {
            packId: 'pack-login',
            packType: 'function_context',
            targetId: 'fn-login',
            summary: 'Login behavior summary',
            keyFacts: [],
            relatedFiles: [filePath],
            confidence: 0.82,
          },
        ],
        getFunctionsByPath: async () => [
          { id: 'fn-login' },
          { id: 'fn-session' },
          { id: 'fn-logout' },
          { id: 'fn-refresh' },
        ],
      }) as any,
    });

    const injected = await (server as any).onToolCall('read_file', {
      workspace,
      path: 'src/auth/login.ts',
    });

    expect(injected).toBeNull();
  });

  it('adds refactor safety summary for write/edit tool calls', async () => {
    const filePath = path.join(workspace, 'src/auth/login.ts');
    const callerPath = path.join(workspace, 'src/http/routes.ts');
    const server = await createLibrarianMCPServer({
      proactiveInjection: {
        enabled: true,
        maxTokens: 2000,
        minCoverage: 0.5,
      },
    } as any);
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      indexState: 'ready',
      storage: makeStorageMock({
        getContextPacks: async () => [
          {
            packId: 'pack-login',
            packType: 'function_context',
            targetId: 'fn-login',
            summary: 'Login function summary',
            keyFacts: [],
            relatedFiles: [filePath],
            confidence: 0.9,
          },
        ],
        getFunctionsByPath: async () => [{ id: 'fn-login' }],
        getGraphEdges: async () => [
          {
            fromId: 'fn-route-login',
            toId: 'fn-login',
            sourceFile: callerPath,
          },
        ],
        getFunction: async (id: string) => (id === 'fn-route-login' ? { name: 'routeLoginHandler' } : null),
      }) as any,
    });

    const injected = await (server as any).onToolCall('edit_file', {
      workspace,
      path: 'src/auth/login.ts',
    });

    expect(injected).toContain('Refactor Safety');
    expect(injected).toContain('external caller');
    expect(injected).toContain('routeLoginHandler');
  });

  it('allows workspace .librainian.json to enable proactive injection', async () => {
    await fs.writeFile(
      path.join(workspace, '.librainian.json'),
      JSON.stringify({ librainian: { proactiveInjection: true } }, null, 2),
      'utf8',
    );
    const server = await createLibrarianMCPServer();
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      indexState: 'ready',
      storage: makeStorageMock({
        getContextPacks: async () => [
          {
            packId: 'pack-login',
            packType: 'function_context',
            targetId: 'fn-login',
            summary: 'Login behavior summary',
            keyFacts: [],
            relatedFiles: [path.join(workspace, 'src/auth/login.ts')],
            confidence: 0.85,
          },
        ],
        getFunctionsByPath: async () => [{ id: 'fn-login' }],
      }) as any,
    });

    const injected = await (server as any).onToolCall('read_file', {
      workspace,
      path: 'src/auth/login.ts',
    });

    expect(injected).toContain('LiBrainian Proactive Context');
  });
});
