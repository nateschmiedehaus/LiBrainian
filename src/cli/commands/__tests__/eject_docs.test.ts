import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ejectDocsCommand } from '../eject_docs.js';
import { ejectInjectedDocs } from '../../../ingest/docs_update.js';

vi.mock('../../../ingest/docs_update.js', () => ({
  ejectInjectedDocs: vi.fn(),
}));

describe('ejectDocsCommand', () => {
  const workspace = '/tmp/librarian-eject-docs';
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(ejectInjectedDocs).mockResolvedValue({
      filesUpdated: ['CLAUDE.md'],
      filesSkipped: [],
      warnings: [],
      errors: [],
      success: true,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('runs ejection and prints summary in text mode', async () => {
    await ejectDocsCommand({
      workspace,
      args: [],
      rawArgs: ['eject-docs'],
    });

    expect(ejectInjectedDocs).toHaveBeenCalledWith(
      expect.objectContaining({ workspace, dryRun: false })
    );
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Eject Docs');
    expect(output).toContain('CLAUDE.md');
  });

  it('supports --dry-run', async () => {
    await ejectDocsCommand({
      workspace,
      args: [],
      rawArgs: ['eject-docs', '--dry-run'],
    });

    expect(ejectInjectedDocs).toHaveBeenCalledWith(
      expect.objectContaining({ workspace, dryRun: true })
    );
  });

  it('supports --json output', async () => {
    await ejectDocsCommand({
      workspace,
      args: [],
      rawArgs: ['eject-docs', '--json'],
    });

    const payload = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((value) => value.includes('"success"'));
    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.success).toBe(true);
    expect(parsed.filesUpdated).toEqual(['CLAUDE.md']);
  });
});
