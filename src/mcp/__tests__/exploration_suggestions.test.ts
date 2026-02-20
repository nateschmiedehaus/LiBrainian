import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP get_exploration_suggestions tool', () => {
  it('returns ranked exploration suggestions', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-exploration-'));
    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);

      const storage = await (server as any).getOrCreateStorage(workspace);
      const now = new Date().toISOString();
      await storage.setGraphMetrics([
        {
          entityId: 'moduleA',
          entityType: 'module',
          pagerank: 0.9,
          betweenness: 0.9,
          closeness: 0.9,
          eigenvector: 0.9,
          communityId: 1,
          isBridge: true,
          computedAt: now,
        },
        {
          entityId: 'moduleB',
          entityType: 'module',
          pagerank: 0.9,
          betweenness: 0.9,
          closeness: 0.9,
          eigenvector: 0.9,
          communityId: 1,
          isBridge: true,
          computedAt: now,
        },
      ]);
      await storage.upsertGraphEdges(
        Array.from({ length: 50 }, (_, index) => ({
          fromId: `dep_${index}`,
          fromType: 'function',
          toId: 'moduleA',
          toType: 'module',
          edgeType: 'imports',
          sourceFile: `src/dep_${index}.ts`,
          confidence: 1,
          computedAt: new Date(now),
        }))
      );
      await storage.recordQueryAccessLogs([
        { entityId: 'moduleB', entityType: 'module', lastQueriedAt: now, queryCount: 10 },
      ]);

      const result = await (server as any).callTool('get_exploration_suggestions', {
        workspace,
        limit: 5,
      });
      expect(result.isError).toBeFalsy();

      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(payload.success).toBe(true);
      expect(payload.tool).toBe('get_exploration_suggestions');
      expect(Array.isArray(payload.suggestions)).toBe(true);
      expect(payload.suggestions[0]?.entityId).toBe('moduleA');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
