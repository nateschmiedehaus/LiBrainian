import { describe, it, expect, vi } from 'vitest';
import { createLiBrainianMCPServer } from '../server.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('MCP diagnose self tool', () => {
  it('returns diagnosis for workspace', async () => {
    const server = await createLiBrainianMCPServer({
      authorization: {
        enabledScopes: ['read'],
        requireConsent: false,
      },
    });

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-diagnose-self-'));
    const diagnosis = { status: 'ok', issues: [] };
    const mockLiBrainian: any = {
      diagnoseSelf: vi.fn().mockResolvedValue(diagnosis),
    };

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, {
      librainian: mockLiBrainian,
      indexState: 'ready',
    });

    try {
      // callTool is private; this tests the MCP path including schema validation
      const result = await (server as any).callTool('diagnose_self', { workspace });
      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');

      expect(payload.success).toBe(true);
      expect(payload.diagnosis).toEqual(diagnosis);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
