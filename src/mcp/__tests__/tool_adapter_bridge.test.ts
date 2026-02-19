import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('MCP Server tool adapter wiring', () => {
  it('does not initialize evidence instrumentation for read-only tools', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-'));

    try {
      const server = await createLibrarianMCPServer({
        name: 'tool-adapter-test-server',
        authorization: { enabledScopes: ['read'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });

      server.registerWorkspace(workspace);

      // callTool is private; this is an intentional integration test of the wiring
      await (server as any).callTool('status', { workspace });

      const state = (server as any).state;
      const ws = state.workspaces.get(path.resolve(workspace));
      expect(ws).toBeTruthy();
      expect(ws?.toolAdapter).toBeUndefined();
      expect(ws?.auditLogger).toBeUndefined();
      expect(ws?.evidenceLedger).toBeUndefined();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('records tool calls to the workspace evidence ledger for write tools', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-'));

    try {
      const server = await createLibrarianMCPServer({
        name: 'tool-adapter-test-server',
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });

      server.registerWorkspace(workspace);

      // submit_feedback writes state and should initialize persistent instrumentation.
      await (server as any).callTool('submit_feedback', {
        workspace,
        feedbackToken: 'tok-write-test',
        outcome: 'partial',
      });

      const state = (server as any).state;
      const ws = state.workspaces.get(path.resolve(workspace));
      expect(ws).toBeTruthy();
      if (!ws?.evidenceLedger) {
        const auditLog = server.getAuditLog();
        throw new Error(`Expected workspace evidence ledger. auditLog=${JSON.stringify(auditLog, null, 2)}`);
      }

      const entries = await ws.evidenceLedger.query({ kinds: ['tool_call'] });
      expect(entries.some((entry: any) => entry.payload?.toolName === 'submit_feedback')).toBe(true);

      await ws.evidenceLedger.close();
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
