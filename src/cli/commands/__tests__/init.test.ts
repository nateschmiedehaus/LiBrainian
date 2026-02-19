import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../init.js';
import { quickstartCommand } from '../quickstart.js';

vi.mock('../quickstart.js', () => ({
  quickstartCommand: vi.fn().mockResolvedValue(undefined),
}));

describe('initCommand', () => {
  let workspace: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-init-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('delegates to quickstart when no scaffolding flags are provided', async () => {
    await initCommand({ workspace, args: [], rawArgs: ['init', '--depth', 'quick'] });

    expect(quickstartCommand).toHaveBeenCalledWith({
      workspace,
      args: [],
      rawArgs: ['init', '--depth', 'quick'],
    });
  });

  it('creates construction scaffolding files', async () => {
    await initCommand({ workspace, args: [], rawArgs: ['init', '--construction', 'SafeRefactorAdvisor'] });

    const constructionPath = path.join(workspace, '.librarian', 'constructions', 'safe-refactor-advisor.ts');
    const testPath = path.join(workspace, '.librarian', 'constructions', 'safe-refactor-advisor.test.ts');
    const docPath = path.join(workspace, 'docs', 'constructions', 'safe-refactor-advisor.md');

    const [construction, testFile, doc] = await Promise.all([
      fs.readFile(constructionPath, 'utf8'),
      fs.readFile(testPath, 'utf8'),
      fs.readFile(docPath, 'utf8'),
    ]);

    expect(construction).toContain("import { z } from 'zod';");
    expect(construction).toContain("import type { Construction, Context } from 'librainian/constructions';");
    expect(construction).toContain('export const safeRefactorAdvisor: Construction<');
    expect(testFile).toContain("describe('safeRefactorAdvisor'");
    expect(doc).toContain('# SafeRefactorAdvisor');
  });

  it('does not overwrite construction files without --force', async () => {
    await initCommand({ workspace, args: [], rawArgs: ['init', '--construction', 'SafeRefactorAdvisor'] });

    const constructionPath = path.join(workspace, '.librarian', 'constructions', 'safe-refactor-advisor.ts');
    await fs.writeFile(constructionPath, '// custom\n', 'utf8');

    await initCommand({ workspace, args: [], rawArgs: ['init', '--construction', 'SafeRefactorAdvisor'] });

    const after = await fs.readFile(constructionPath, 'utf8');
    expect(after).toBe('// custom\n');
  });

  it('overwrites construction files with --force', async () => {
    await initCommand({ workspace, args: [], rawArgs: ['init', '--construction', 'SafeRefactorAdvisor'] });

    const constructionPath = path.join(workspace, '.librarian', 'constructions', 'safe-refactor-advisor.ts');
    await fs.writeFile(constructionPath, '// custom\n', 'utf8');

    await initCommand({ workspace, args: [], rawArgs: ['init', '--construction', 'SafeRefactorAdvisor', '--force'] });

    const after = await fs.readFile(constructionPath, 'utf8');
    expect(after).toContain('export const safeRefactorAdvisor: Construction<');
  });

  it('creates and merges .mcp.json safely', async () => {
    const mcpPath = path.join(workspace, '.mcp.json');
    await fs.writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          existing: {
            command: 'node',
            args: ['tool.js'],
          },
        },
      }, null, 2),
      'utf8',
    );

    await initCommand({ workspace, args: [], rawArgs: ['init', '--mcp-config'] });

    const parsed = JSON.parse(await fs.readFile(mcpPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };

    expect(parsed.mcpServers.existing).toBeTruthy();
    expect(parsed.mcpServers.librarian.command).toBe('npx');
    expect(parsed.mcpServers.librarian.args).toEqual(['-y', 'librainian', 'mcp']);
    expect(parsed.mcpServers.librarian.env?.LIBRARIAN_WORKSPACE).toBe(workspace);
  });

  it('does not overwrite existing librarian MCP entry without --force', async () => {
    const mcpPath = path.join(workspace, '.mcp.json');
    await fs.writeFile(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          librarian: {
            command: 'custom',
            args: ['mcp'],
          },
        },
      }, null, 2),
      'utf8',
    );

    await initCommand({ workspace, args: [], rawArgs: ['init', '--mcp-config'] });

    const parsed = JSON.parse(await fs.readFile(mcpPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    expect(parsed.mcpServers.librarian.command).toBe('custom');
  });

  it('creates and idempotently updates CLAUDE.md section', async () => {
    const claudePath = path.join(workspace, 'CLAUDE.md');
    await fs.writeFile(claudePath, '# Local rules\n', 'utf8');

    await initCommand({ workspace, args: [], rawArgs: ['init', '--claude-md'] });

    const first = await fs.readFile(claudePath, 'utf8');
    expect(first).toContain('<!-- LIBRARIAN_DOCS_START -->');
    expect(first).toContain('claude mcp add librainian -- npx librainian mcp');

    await initCommand({ workspace, args: [], rawArgs: ['init', '--claude-md'] });
    const second = await fs.readFile(claudePath, 'utf8');
    expect(second).toBe(first);
  });

  it('delegates to quickstart when no scaffolding flags are provided (including --json)', async () => {
    await initCommand({ workspace, args: [], rawArgs: ['init', '--json'] });

    expect(quickstartCommand).toHaveBeenCalledWith({
      workspace,
      args: [],
      rawArgs: ['init', '--json'],
    });
  });

  it('throws when --construction is provided without a value', async () => {
    await expect(initCommand({ workspace, args: [], rawArgs: ['init', '--construction'] })).rejects.toThrow(
      /Missing required value: --construction <name>/,
    );
  });
});
