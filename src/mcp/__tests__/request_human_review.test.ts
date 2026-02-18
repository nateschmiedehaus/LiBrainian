import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';

describe('MCP request_human_review tool', () => {
  it('creates blocking review request and appends audit log event', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-human-review-'));

    try {
      const server = await createLibrarianMCPServer({
        authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
        audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
      });
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      const result = await (server as any).executeRequestHumanReview({
        reason: 'Ambiguous ownership between two auth modules',
        context_summary: 'Both modules look valid but confidence is low and behavior diverges.',
        proposed_action: 'Modify token invalidation flow before production deploy',
        confidence_tier: 'uncertain',
        risk_level: 'high',
        blocking: true,
      });

      expect(result.review_request_id).toMatch(/^rev_/);
      expect(result.status).toBe('pending');
      expect(result.blocking).toBe(true);
      expect(result.expires_in_seconds).toBe(300);
      expect(String(result.human_readable_summary)).toContain('Agent paused for review');

      const auditPath = path.join(workspace, '.librainian', 'audit-log.jsonl');
      const auditContent = await fs.readFile(auditPath, 'utf8');
      const lines = auditContent.trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
      const entry = JSON.parse(lines[lines.length - 1] ?? '{}');
      expect(entry.review_id).toBe(result.review_request_id);
      expect(entry.outcome).toBe('pending');
      expect(entry.reason).toContain('Ambiguous ownership');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('supports non-blocking advisory review requests', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
      audit: { enabled: false, logPath: '.librarian/audit/mcp', retentionDays: 1 },
    });

    const result = await (server as any).executeRequestHumanReview({
      reason: 'Non-critical uncertainty',
      context_summary: 'Retrieved context is partial but likely adequate.',
      proposed_action: 'Apply formatting change only',
      confidence_tier: 'low',
      risk_level: 'low',
      blocking: false,
    });

    expect(result.status).toBe('advisory');
    expect(result.blocking).toBe(false);
    expect(String(result.human_readable_summary)).toContain('Advisory human review');
  });
});
