import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  INSTALL_MANIFEST_FILENAME,
  detectInstallDirectories,
  readInstallManifest,
  writeInstallManifest,
} from '../install_manifest.js';

describe('install manifest', () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    while (workspaces.length > 0) {
      const workspace = workspaces.pop();
      if (workspace) {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  });

  it('writes and reads .librainian-manifest.json with deterministic relative paths', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librainian-manifest-'));
    workspaces.push(workspace);
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
    await mkdir(path.join(workspace, '.librarian'), { recursive: true });
    await mkdir(path.join(workspace, 'state'), { recursive: true });

    const written = await writeInstallManifest({
      workspaceRoot: workspace,
      packageVersion: '0.2.1',
      bootstrapMode: 'full',
      docsUpdatedFiles: ['AGENTS.md', 'docs/CLAUDE.md'],
    });

    expect(written.path).toBe(path.join(workspace, INSTALL_MANIFEST_FILENAME));
    expect(written.manifest.package_json).toBe('package.json');
    expect(written.manifest.directories_created).toEqual(['.librarian', 'state']);
    expect(written.manifest.injected_docs_files).toEqual(['AGENTS.md', 'docs/CLAUDE.md']);

    const loaded = await readInstallManifest(workspace);
    expect(loaded).not.toBeNull();
    expect(loaded?.kind).toBe('LibrainianInstallManifest.v1');
    expect(loaded?.files_modified).toEqual(['AGENTS.md', 'docs/CLAUDE.md']);
  });

  it('detects known install directories when present', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'librainian-dirs-'));
    workspaces.push(workspace);
    await mkdir(path.join(workspace, '.librarian', 'locks'), { recursive: true });
    await mkdir(path.join(workspace, 'state', 'audits'), { recursive: true });
    await mkdir(path.join(workspace, 'apps', 'web', 'state'), { recursive: true });

    const directories = await detectInstallDirectories(workspace);
    expect(directories).toEqual(['.librarian', 'apps/web/state', 'state']);
  });
});
