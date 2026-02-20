import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { generateDocsCommand } from '../generate_docs.js';
import { generatePromptDocs } from '../generate_docs_content.js';

vi.mock('../generate_docs_content.js', () => ({
  generatePromptDocs: vi.fn(),
}));

describe('generateDocsCommand', () => {
  const workspace = '/tmp/librainian-generate-docs-command';
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(generatePromptDocs).mockResolvedValue({
      outputDir: workspace,
      generatedAt: '2026-02-20T00:00:00.000Z',
      include: ['tools', 'context', 'rules'],
      filesWritten: [
        `${workspace}/LIBRAINIAN_TOOLS.md`,
        `${workspace}/LIBRAINIAN_CONTEXT.md`,
        `${workspace}/LIBRAINIAN_RULES.md`,
      ],
      tokenEstimates: {
        'LIBRAINIAN_TOOLS.md': 1100,
        'LIBRAINIAN_CONTEXT.md': 600,
        'LIBRAINIAN_RULES.md': 420,
      },
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints text summary output by default', async () => {
    await generateDocsCommand({
      workspace,
      args: [],
      rawArgs: ['generate-docs'],
    });

    expect(generatePromptDocs).toHaveBeenCalledWith(
      expect.objectContaining({ workspace, include: ['tools', 'context', 'rules'] })
    );

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Generate Docs');
    expect(output).toContain('Files written: 3');
    expect(output).toContain('LIBRAINIAN_TOOLS.md');
  });

  it('supports include filters and --json', async () => {
    await generateDocsCommand({
      workspace,
      args: [],
      rawArgs: ['generate-docs', '--include', 'tools,context', '--json'],
    });

    expect(generatePromptDocs).toHaveBeenCalledWith(
      expect.objectContaining({ workspace, include: ['tools', 'context'] })
    );

    const payload = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('"outputDir"'));
    expect(payload).toBeTruthy();
  });
});
