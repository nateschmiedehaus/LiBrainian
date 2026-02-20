import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendPrivacyAuditEvent, generatePrivacyReport, resolvePrivacyAuditLogPath } from '../privacy_audit.js';

describe('privacy_audit', () => {
  it('records events and summarizes compliance signals', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-privacy-audit-'));
    try {
      await appendPrivacyAuditEvent(workspace, {
        ts: '2026-02-20T00:00:00.000Z',
        op: 'embed',
        files: ['src/a.ts'],
        model: 'xenova/all-MiniLM-L6-v2',
        local: true,
        contentSent: false,
        status: 'allowed',
      });
      await appendPrivacyAuditEvent(workspace, {
        ts: '2026-02-20T00:10:00.000Z',
        op: 'synthesize',
        files: [],
        model: 'claude-sonnet',
        local: false,
        contentSent: false,
        status: 'blocked',
      });
      await appendPrivacyAuditEvent(workspace, {
        ts: '2026-02-20T00:20:00.000Z',
        op: 'synthesize',
        files: ['src/b.ts'],
        model: 'claude-sonnet',
        local: false,
        contentSent: true,
        status: 'allowed',
      });

      const report = await generatePrivacyReport(workspace);
      expect(report.totalEvents).toBe(3);
      expect(report.blockedEvents).toBe(1);
      expect(report.localOnlyEvents).toBe(1);
      expect(report.externalContentSentEvents).toBe(1);
      expect(report.operations.embed).toBe(1);
      expect(report.operations.synthesize).toBe(2);
      expect(report.logPath).toBe(resolvePrivacyAuditLogPath(workspace));
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('applies since filtering to report generation', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-privacy-since-'));
    try {
      await appendPrivacyAuditEvent(workspace, {
        ts: '2026-02-01T00:00:00.000Z',
        op: 'embed',
        files: [],
        model: 'xenova/all-MiniLM-L6-v2',
        local: true,
        contentSent: false,
      });
      await appendPrivacyAuditEvent(workspace, {
        ts: '2026-02-15T00:00:00.000Z',
        op: 'embed',
        files: [],
        model: 'xenova/all-MiniLM-L6-v2',
        local: true,
        contentSent: false,
      });

      const report = await generatePrivacyReport(workspace, { since: '2026-02-10T00:00:00.000Z' });
      expect(report.totalEvents).toBe(1);
      expect(report.since).toBe('2026-02-15T00:00:00.000Z');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
