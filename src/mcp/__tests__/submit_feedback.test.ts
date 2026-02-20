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

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(payload.success).toBe(false);
      expect(payload.adjustmentsApplied).toBe(0);
      expect(payload.error).toBe(true);
      expect(payload.code).toBeTruthy();
      expect(Array.isArray(payload.nextSteps)).toBe(true);
      expect(String(payload.message ?? '')).toMatch(/Unknown feedbackToken/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('maps feedback_retrieval_result to submit feedback flow', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-feedback-'));

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);

      const result = await (server as any).callTool('feedback_retrieval_result', {
        workspace,
        feedbackToken: 'fbk_missing',
        wasHelpful: false,
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(payload.success).toBe(false);
      expect(payload.code).toBeTruthy();
      expect(String(payload.message ?? '')).toMatch(/Unknown feedbackToken/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('returns retrieval stats summary', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-feedback-'));

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);

      const result = await (server as any).callTool('get_retrieval_stats', {
        workspace,
        limit: 25,
      });

      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
      expect(payload.success).toBe(true);
      expect(payload.tool).toBe('get_retrieval_stats');
      expect(Array.isArray(payload.strategyStats)).toBe(true);
      expect(payload.summary.totalSelectionRows).toBe(0);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
