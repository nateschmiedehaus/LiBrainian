import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP submit_feedback tool', () => {
  it('returns actionable failure for unknown feedback token', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-feedback-'));

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);

      const result = await (server as any).callTool('submit_feedback', {
        workspace,
        feedbackToken: 'fbk_missing',
        outcome: 'failure',
      });

      expect(result.isError).not.toBe(true);
      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(payload.success).toBe(false);
      expect(payload.adjustmentsApplied).toBe(0);
      expect(String(payload.error ?? '')).toMatch(/Unknown feedbackToken/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
