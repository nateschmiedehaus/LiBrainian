import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP harvest_session_knowledge memory bridge', () => {
  it('writes annotated MEMORY.md entries and appends memory-bridge evidence records', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-harvest-memory-'));
    const memoryFilePath = path.join(workspace, '.openclaw', 'memory', 'MEMORY.md');

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      await (server as any).executeAppendClaim({
        claim: 'UserRepository uses CockroachDB',
        workspace,
        sessionId: 'sess_mem_bridge',
        confidence: 0.91,
        tags: ['architecture'],
      });
      await (server as any).executeAppendClaim({
        claim: 'Auth middleware is in app/middleware/auth.ts',
        workspace,
        sessionId: 'sess_mem_bridge',
        confidence: 0.86,
        tags: ['auth'],
      });

      const result = await (server as any).executeHarvestSessionKnowledge({
        workspace,
        sessionId: 'sess_mem_bridge',
        minConfidence: 0.8,
        memoryFilePath,
      });

      expect(result.success).toBe(true);
      expect(result.memoryBridge).toBeTruthy();
      expect(result.memoryBridge.written).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(result.memoryBridge.entries)).toBe(true);
      expect(result.memoryBridge.entries[0].evidenceId).toMatch(/^ev_/);

      const memoryContent = await fs.readFile(memoryFilePath, 'utf8');
      expect(memoryContent).toContain('<!-- librainian:ev_');

      const state = (server as any).state;
      const ws = state.workspaces.get(path.resolve(workspace));
      expect(ws?.evidenceLedger).toBeTruthy();
      const claimEntries = await ws.evidenceLedger.query({ kinds: ['claim'] });
      expect(
        claimEntries.some((entry: any) => entry.provenance?.method === 'memory_bridge_harvest')
      ).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
