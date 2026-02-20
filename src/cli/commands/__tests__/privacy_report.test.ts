import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privacyReportCommand } from '../privacy_report.js';
import { resolvePrivacyAuditLogPath } from '../../../security/privacy_audit.js';

describe('privacyReportCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('returns zero when no external content was sent', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-privacy-report-'));
    const logPath = resolvePrivacyAuditLogPath(workspace);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(
      logPath,
      `${JSON.stringify({
        ts: '2026-02-20T00:00:00.000Z',
        op: 'embed',
        files: ['src/a.ts'],
        model: 'xenova/all-MiniLM-L6-v2',
        local: true,
        contentSent: false,
        status: 'allowed',
      })}\n`,
      'utf8',
    );

    try {
      const exitCode = await privacyReportCommand({ workspace, format: 'json' });
      expect(exitCode).toBe(0);
      const output = consoleLogSpy.mock.calls[0]?.[0] as string | undefined;
      const parsed = JSON.parse(output ?? '{}') as { externalContentSentEvents?: number; totalEvents?: number };
      expect(parsed.totalEvents).toBe(1);
      expect(parsed.externalContentSentEvents).toBe(0);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('returns non-zero when external content transmission is present', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-privacy-report-external-'));
    const logPath = resolvePrivacyAuditLogPath(workspace);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(
      logPath,
      `${JSON.stringify({
        ts: '2026-02-20T00:00:00.000Z',
        op: 'synthesize',
        files: ['src/a.ts'],
        model: 'claude-sonnet',
        local: false,
        contentSent: true,
        status: 'allowed',
      })}\n`,
      'utf8',
    );

    try {
      const exitCode = await privacyReportCommand({ workspace, format: 'json' });
      expect(exitCode).toBe(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
