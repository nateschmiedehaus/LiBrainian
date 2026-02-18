import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLibrarianMCPServer } from '../server.js';
import { validateToolInput } from '../schema.js';

const BOOTSTRAP_RUN_HISTORY_KEY = 'librarian.mcp.bootstrap_runs.v1';

function parseToolPayload(result: unknown): Record<string, unknown> {
  const text = (result as { content?: Array<{ text?: string }> })?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`Expected JSON payload in tool response: ${JSON.stringify(result)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP diff_runs persistence and auth integration', () => {
  it('validates list_runs tool input in schema registry', () => {
    const validation = validateToolInput('list_runs', { workspace: '/tmp/workspace', limit: 10 });
    expect(validation.valid).toBe(true);
  });

  it('diff_runs can resolve historical run IDs from persisted workspace history', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-diff-runs-'));
    let serverA: Awaited<ReturnType<typeof createLibrarianMCPServer>> | null = null;
    let serverB: Awaited<ReturnType<typeof createLibrarianMCPServer>> | null = null;

    try {
      serverA = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      });
      const storageA = await (serverA as any).getOrCreateStorage(workspace);
      await storageA.setState(BOOTSTRAP_RUN_HISTORY_KEY, JSON.stringify([
        {
          runId: 'run-old',
          workspace,
          startedAt: '2026-02-18T00:00:00.000Z',
          completedAt: '2026-02-18T00:01:00.000Z',
          success: true,
          durationMs: 60_000,
          stats: {
            filesProcessed: 100,
            functionsIndexed: 200,
            contextPacksCreated: 50,
            averageConfidence: 0.4,
          },
        },
        {
          runId: 'run-new',
          workspace,
          startedAt: '2026-02-18T01:00:00.000Z',
          completedAt: '2026-02-18T01:01:00.000Z',
          success: true,
          durationMs: 60_000,
          stats: {
            filesProcessed: 130,
            functionsIndexed: 280,
            contextPacksCreated: 70,
            averageConfidence: 0.6,
          },
        },
      ]));
      await storageA.close();

      serverB = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      });
      const diff = await (serverB as any).executeDiffRuns({
        workspace,
        runIdA: 'run-old',
        runIdB: 'run-new',
        detailed: true,
      });

      expect(diff.error).toBeUndefined();
      expect(diff.runIdA).toBe('run-old');
      expect(diff.runIdB).toBe('run-new');
      expect(diff.diff.functions.before).toBe(200);
      expect(diff.diff.functions.after).toBe(280);
      expect(diff.diff.functions.delta).toBe(80);
      expect(diff.diff.contextPacks.delta).toBe(20);
    } finally {
      if (serverB) {
        await serverB.stop();
      }
      if (serverA) {
        await serverA.stop();
      }
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('enforces session-token scopes in callTool when __authToken is provided', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
    });

    const { token } = server.createAuthSession({
      clientId: 'scope-test',
      scopes: ['read'],
    });

    const result = await (server as any).callTool('bootstrap', {
      workspace: '/tmp/nonexistent-workspace',
      __authToken: token,
    });

    expect(result.isError).toBe(true);
    const payload = parseToolPayload(result);
    expect(payload.code).toBe('authorization_denied');
    expect(String(payload.message ?? payload.error ?? '')).toContain('Insufficient');

    await server.stop();
  });
});
