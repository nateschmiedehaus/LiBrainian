import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { uninstallCommand } from '../uninstall.js';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('uninstallCommand', () => {
  let workspace: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'librainian-uninstall-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(workspace, { recursive: true, force: true });
  });

  it('supports dry-run without mutating files', async () => {
    const docsPath = path.join(workspace, 'AGENTS.md');
    const packageJsonPath = path.join(workspace, 'package.json');
    const manifestPath = path.join(workspace, '.librainian-manifest.json');
    const docsBefore = [
      '# AGENTS',
      '',
      '<!-- LIBRARIAN_DOCS_START -->',
      'managed content',
      '<!-- LIBRARIAN_DOCS_END -->',
      '',
    ].join('\n');
    await writeFile(docsPath, docsBefore, 'utf8');
    await writeJson(packageJsonPath, {
      name: 'fixture',
      version: '1.0.0',
      dependencies: {
        librainian: '^0.2.1',
      },
    });
    await mkdir(path.join(workspace, '.librarian'), { recursive: true });
    await mkdir(path.join(workspace, 'state'), { recursive: true });
    await writeJson(manifestPath, {
      kind: 'LibrainianInstallManifest.v1',
      schema_version: 1,
      generated_at: new Date().toISOString(),
      package_version: '0.2.1',
      workspace: workspace,
      bootstrap_mode: 'full',
      files_modified: ['AGENTS.md'],
      files_created: [],
      directories_created: ['.librarian', 'state'],
      package_json: 'package.json',
      injected_docs_files: ['AGENTS.md'],
    });

    await uninstallCommand({
      workspace,
      args: [],
      rawArgs: ['uninstall', '--dry-run', '--force', '--json', '--no-install'],
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('"dryRun": true');
    expect(await readFile(docsPath, 'utf8')).toBe(docsBefore);
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.librainian).toBe('^0.2.1');
  });

  it('removes docs injections, package dependency, manifest, and generated directories', async () => {
    const docsPath = path.join(workspace, 'CLAUDE.md');
    const packageJsonPath = path.join(workspace, 'package.json');
    const manifestPath = path.join(workspace, '.librainian-manifest.json');
    await writeFile(
      docsPath,
      [
        '# CLAUDE',
        '',
        '<!-- LIBRARIAN_DOCS_START -->',
        'managed content',
        '<!-- LIBRARIAN_DOCS_END -->',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeJson(packageJsonPath, {
      name: 'fixture',
      version: '1.0.0',
      dependencies: {
        librainian: '^0.2.1',
      },
    });
    await mkdir(path.join(workspace, '.librarian', 'locks'), { recursive: true });
    await mkdir(path.join(workspace, 'state', 'audits'), { recursive: true });
    await writeJson(manifestPath, {
      kind: 'LibrainianInstallManifest.v1',
      schema_version: 1,
      generated_at: new Date().toISOString(),
      package_version: '0.2.1',
      workspace: workspace,
      bootstrap_mode: 'full',
      files_modified: ['CLAUDE.md'],
      files_created: [],
      directories_created: ['.librarian', 'state'],
      package_json: 'package.json',
      injected_docs_files: ['CLAUDE.md'],
    });

    await uninstallCommand({
      workspace,
      args: [],
      rawArgs: ['uninstall', '--force', '--no-install'],
    });

    const docs = await readFile(docsPath, 'utf8');
    expect(docs).not.toContain('LIBRARIAN_DOCS_START');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.librainian).toBeUndefined();
    await expect(readFile(manifestPath, 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(workspace, '.librarian', 'locks'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(workspace, 'state', 'audits'), 'utf8')).rejects.toThrow();
  });
});
