import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureEditorMcpForInit } from '../init_editor_mcp.js';

async function createTempWorkspace(prefix: string): Promise<{ root: string; workspace: string; home: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  return { root, workspace, home };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('configureEditorMcpForInit', () => {
  const originalHome = process.env.HOME;
  const originalAppData = process.env.APPDATA;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
  });

  it('writes workspace editor MCP configs for detected editors', async () => {
    const { workspace, home } = await createTempWorkspace('librainian-init-mcp-');
    process.env.HOME = home;
    delete process.env.APPDATA;

    await Promise.all([
      fs.mkdir(path.join(workspace, '.vscode'), { recursive: true }),
      fs.mkdir(path.join(workspace, '.cursor'), { recursive: true }),
      fs.mkdir(path.join(workspace, '.continue'), { recursive: true }),
    ]);

    const report = await configureEditorMcpForInit({
      workspace,
      dryRun: false,
      globalConfig: false,
    });

    expect(report.written).toBeGreaterThanOrEqual(3);
    expect(await fileExists(path.join(workspace, '.vscode', 'mcp.json'))).toBe(true);
    expect(await fileExists(path.join(workspace, '.cursor', 'mcp.json'))).toBe(true);
    expect(await fileExists(path.join(workspace, '.continue', 'mcpServers', 'librainian.yaml'))).toBe(true);

    const vscodeConfigRaw = await fs.readFile(path.join(workspace, '.vscode', 'mcp.json'), 'utf8');
    const cursorConfigRaw = await fs.readFile(path.join(workspace, '.cursor', 'mcp.json'), 'utf8');
    const continueConfigRaw = await fs.readFile(path.join(workspace, '.continue', 'mcpServers', 'librainian.yaml'), 'utf8');

    const vscodeConfig = JSON.parse(vscodeConfigRaw) as { servers?: Record<string, unknown> };
    const cursorConfig = JSON.parse(cursorConfigRaw) as { mcpServers?: Record<string, unknown> };

    expect(Object.keys(vscodeConfig.servers ?? {}).some(key => key.includes('librain'))).toBe(true);
    expect(Object.keys(cursorConfig.mcpServers ?? {}).some(key => key.includes('librain'))).toBe(true);
    expect(continueConfigRaw).toContain('librainian');
    expect(continueConfigRaw).toContain('LIBRARIAN_WORKSPACE');
  });

  it('supports dry-run mode without writing files', async () => {
    const { workspace, home } = await createTempWorkspace('librainian-init-mcp-dryrun-');
    process.env.HOME = home;
    delete process.env.APPDATA;

    await fs.mkdir(path.join(workspace, '.vscode'), { recursive: true });

    const report = await configureEditorMcpForInit({
      workspace,
      editor: 'vscode',
      dryRun: true,
      globalConfig: false,
    });

    expect(report.wouldWrite).toBe(1);
    expect(report.written).toBe(0);
    expect(await fileExists(path.join(workspace, '.vscode', 'mcp.json'))).toBe(false);
    expect(report.actions[0]?.status).toBe('would_write');
    expect(report.actions[0]?.diff?.length).toBeGreaterThan(0);
  });

  it('is idempotent and does not duplicate server entries', async () => {
    const { workspace, home } = await createTempWorkspace('librainian-init-mcp-idempotent-');
    process.env.HOME = home;
    delete process.env.APPDATA;

    await fs.mkdir(path.join(workspace, '.cursor'), { recursive: true });

    const first = await configureEditorMcpForInit({
      workspace,
      editor: 'cursor',
      dryRun: false,
      globalConfig: false,
    });
    expect(first.written).toBe(1);

    const second = await configureEditorMcpForInit({
      workspace,
      editor: 'cursor',
      dryRun: false,
      globalConfig: false,
    });
    expect(second.written).toBe(0);
    expect(second.alreadyConfigured).toBe(1);

    const cursorConfigRaw = await fs.readFile(path.join(workspace, '.cursor', 'mcp.json'), 'utf8');
    const cursorConfig = JSON.parse(cursorConfigRaw) as { mcpServers?: Record<string, unknown> };
    const matchingKeys = Object.keys(cursorConfig.mcpServers ?? {}).filter(
      (key) => key.includes('librarian') || key.includes('librainian'),
    );
    expect(matchingKeys).toHaveLength(1);
  });

  it('preserves invalid existing JSON config files and reports an error', async () => {
    const { workspace, home } = await createTempWorkspace('librainian-init-mcp-invalid-json-');
    process.env.HOME = home;
    delete process.env.APPDATA;

    await fs.mkdir(path.join(workspace, '.cursor'), { recursive: true });
    const cursorConfigPath = path.join(workspace, '.cursor', 'mcp.json');
    await fs.writeFile(cursorConfigPath, '{"mcpServers":', 'utf8');

    const report = await configureEditorMcpForInit({
      workspace,
      editor: 'cursor',
      dryRun: false,
      globalConfig: false,
    });

    expect(report.errors).toBe(1);
    expect(report.actions[0]?.status).toBe('error');
    expect(await fs.readFile(cursorConfigPath, 'utf8')).toBe('{"mcpServers":');
  });
});
