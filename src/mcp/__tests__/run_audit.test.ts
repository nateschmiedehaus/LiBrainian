import { describe, it, expect, vi } from 'vitest';
import { createLibrarianMCPServer } from '../server.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('MCP run_audit implementation', () => {
  it('returns actionable security findings for hardcoded secret patterns', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace-security-audit';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getContextPacks: vi.fn().mockResolvedValue([
        {
          packId: 'pack-1',
          targetId: 'AuthService',
          summary: "const API_KEY = 'sk_live_1234567890abcdef1234';",
          keyFacts: [],
          relatedFiles: ['src/auth/service.ts'],
        },
      ]),
    });

    const result = await (server as any).executeRunAudit({ type: 'security' });

    expect(result.status).toBe('completed');
    expect(result.findings.some((f: any) => f.category === 'security')).toBe(true);
    expect(result.findings.some((f: any) => String(f.message).includes('hardcoded secret pattern'))).toBe(true);
  });

  it('reports skipped-file coverage gaps from last indexing result', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace-coverage-audit';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 42,
        totalContextPacks: 12,
      }),
      getLastIndexingResult: vi.fn().mockResolvedValue({
        filesSkipped: 3,
        errors: [
          { path: 'src/legacy/old.ts' },
          { path: 'src/experimental/edge.ts' },
        ],
      }),
    });

    const result = await (server as any).executeRunAudit({ type: 'coverage' });

    expect(result.status).toBe('completed');
    expect(result.findings.some((f: any) => String(f.message).includes('files were skipped'))).toBe(true);
  });

  it('identifies file-level freshness drift when files changed after indexing', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-run-audit-'));
    const changedFile = path.join(workspace, 'changed.ts');
    await fs.writeFile(changedFile, 'export const changed = true;\n', 'utf8');

    try {
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
        getMetadata: vi.fn().mockResolvedValue({
          lastIndexing: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
        getFiles: vi.fn().mockResolvedValue([
          { path: changedFile },
        ]),
      });

      const result = await (server as any).executeRunAudit({ type: 'freshness' });

      expect(result.status).toBe('completed');
      expect(result.findings.some((f: any) => String(f.message).includes('newer than last indexing time'))).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('includes stale evidence metrics and emits EVIDENCE.md when report generation is requested', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-run-audit-evidence-'));
    try {
      server.registerWorkspace(workspace);
      server.updateWorkspaceState(workspace, { indexState: 'ready' });

      (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
        getContextPacks: vi.fn().mockResolvedValue([]),
        getEvidenceVerificationSummary: vi.fn().mockResolvedValue({
          totalEntries: 7,
          scannedEntries: 7,
          staleCount: 2,
          unverifiedCount: 1,
          oldestUnverifiedAt: '2026-02-18T12:00:00.000Z',
          verifiedAt: '2026-02-19T12:00:00.000Z',
        }),
        exportEvidenceMarkdown: vi.fn().mockResolvedValue(path.join(workspace, 'state', 'audits', 'librarian', 'EVIDENCE.md')),
      });

      const result = await (server as any).executeRunAudit({
        type: 'full',
        generateReport: true,
      });

      expect(result.status).toBe('completed');
      expect(result.findings.some((f: any) => f.category === 'evidence')).toBe(true);
      expect(result.summary?.evidence?.staleCount).toBe(2);
      expect(result.reports?.[0]?.path).toContain('EVIDENCE.md');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
