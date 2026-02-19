import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanCommand } from '../scan.js';

describe('scanCommand', () => {
  let workspace: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-scan-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('emits JSON summary for latest redaction audit report', async () => {
    const reportDir = path.join(
      workspace,
      'state',
      'audits',
      'librarian',
      'redaction',
      '2026-02-20T12-00-00-000Z'
    );
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(
      path.join(reportDir, 'RedactionAuditReport.v1.json'),
      JSON.stringify({
        kind: 'RedactionAuditReport.v1',
        schema_version: 1,
        created_at: '2026-02-20T12:00:00.000Z',
        workspace,
        redactions: {
          total: 4,
          by_type: {
            api_key: 0,
            password: 1,
            token: 2,
            aws_key: 0,
            private_key: 1,
          },
        },
      }),
      'utf8'
    );

    await scanCommand({
      workspace,
      args: ['--secrets'],
      rawArgs: ['scan', '--secrets', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"kind"')) as string | undefined;
    expect(payload).toBeTruthy();

    const parsed = JSON.parse(payload ?? '{}') as {
      reportFound?: boolean;
      redactions?: { total?: number; by_type?: { token?: number; private_key?: number } };
    };
    expect(parsed.reportFound).toBe(true);
    expect(parsed.redactions?.total).toBe(4);
    expect(parsed.redactions?.by_type?.token).toBe(2);
    expect(parsed.redactions?.by_type?.private_key).toBe(1);
  });

  it('emits zero redaction summary when no report exists', async () => {
    await scanCommand({
      workspace,
      args: ['--secrets'],
      rawArgs: ['scan', '--secrets', '--json'],
    });

    const payload = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((value) => typeof value === 'string' && value.includes('"kind"')) as string | undefined;
    expect(payload).toBeTruthy();

    const parsed = JSON.parse(payload ?? '{}') as {
      reportFound?: boolean;
      redactions?: { total?: number };
    };
    expect(parsed.reportFound).toBe(false);
    expect(parsed.redactions?.total).toBe(0);
  });

  it('fails closed when scan mode is missing', async () => {
    await expect(
      scanCommand({
        workspace,
        args: [],
        rawArgs: ['scan'],
      })
    ).rejects.toThrow('Use --secrets');
  });
});
