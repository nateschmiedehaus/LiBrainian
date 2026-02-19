import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP synthesize_plan tool', () => {
  it('creates a plan entry and appends audit log event', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-synthesize-plan-'));

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      const result = await (server as any).executeSynthesizePlan({
        task: 'Stabilize auth token refresh race conditions',
        context_pack_ids: ['pack-auth-1', 'pack-auth-2'],
        workspace,
        sessionId: 'sess-plan-1',
      });

      expect(result.plan_id).toMatch(/^plan_/);
      expect(result.context_used).toEqual(['pack-auth-1', 'pack-auth-2']);
      expect(String(result.plan)).toContain('Stabilize auth token refresh race conditions');

      const auditPath = path.join(workspace, '.librainian', 'audit-log.jsonl');
      const auditContent = await fs.readFile(auditPath, 'utf8');
      const lines = auditContent.trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
      const entry = JSON.parse(lines[lines.length - 1] ?? '{}');
      expect(entry.event).toBe('synthesize_plan');
      expect(entry.plan_id).toBe(result.plan_id);
      expect(entry.task).toContain('Stabilize auth token refresh');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('retrieves a stored plan by plan_id via status', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-synthesize-status-'));

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      const planResult = await (server as any).executeSynthesizePlan({
        task: 'Plan API-safe session refactor',
        context_pack_ids: ['pack-api-1'],
        workspace,
        sessionId: 'sess-plan-lookup',
      });

      const statusResult = await (server as any).executeStatus({
        workspace,
        sessionId: 'sess-plan-lookup',
        planId: planResult.plan_id,
      });

      expect(statusResult.planTracking?.planById?.plan_id).toBe(planResult.plan_id);
      expect(statusResult.planTracking?.planById?.task).toBe('Plan API-safe session refactor');
      expect(statusResult.planTracking?.planById?.context_used).toEqual(['pack-api-1']);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
