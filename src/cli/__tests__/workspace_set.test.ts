import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadWorkspaceSetConfig,
  buildWorkspaceSetDependencyGraph,
  readWorkspaceSetState,
  writeWorkspaceSetState,
} from '../workspace_set.js';

const tmpDirs: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

describe('workspace_set', () => {
  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('loads and resolves workspace-set package paths', async () => {
    const root = await makeTemp('librarian-workspace-set-');

    await writeJson(path.join(root, 'apps', 'web', 'package.json'), {
      name: '@acme/web',
      version: '1.0.0',
      dependencies: {
        '@acme/shared': '^1.0.0',
      },
    });
    await writeJson(path.join(root, 'apps', 'api', 'package.json'), {
      name: '@acme/api',
      version: '1.0.0',
      dependencies: {
        '@acme/shared': '^1.0.0',
      },
    });
    await writeJson(path.join(root, 'shared', 'package.json'), {
      name: '@acme/shared',
      version: '1.0.0',
    });

    const workspaceSetPath = path.join(root, 'monorepo.json');
    await writeJson(workspaceSetPath, {
      root: '.',
      packages: [
        { name: 'apps/web', path: 'apps/web' },
        { name: 'apps/api', path: 'apps/api' },
        { name: 'shared', path: 'shared' },
      ],
      shared: {
        crossPackageGraph: true,
      },
    });

    const loaded = await loadWorkspaceSetConfig(workspaceSetPath, root);
    expect(loaded.root).toBe(root);
    expect(loaded.packages.map((pkg) => pkg.name)).toEqual(['apps/web', 'apps/api', 'shared']);
    expect(loaded.packages.every((pkg) => path.isAbsolute(pkg.path))).toBe(true);
    expect(loaded.packages.find((pkg) => pkg.name === 'apps/web')?.packageName).toBe('@acme/web');
  });

  it('builds dependency graph from explicit dependsOn and package.json dependencies', async () => {
    const root = await makeTemp('librarian-workspace-graph-');

    await writeJson(path.join(root, 'apps', 'web', 'package.json'), {
      name: '@acme/web',
      dependencies: {
        '@acme/shared': '^1.0.0',
      },
    });
    await writeJson(path.join(root, 'apps', 'api', 'package.json'), {
      name: '@acme/api',
    });
    await writeJson(path.join(root, 'shared', 'package.json'), {
      name: '@acme/shared',
    });

    const workspaceSetPath = path.join(root, 'monorepo.json');
    await writeJson(workspaceSetPath, {
      root: '.',
      packages: [
        { name: 'apps/web', path: 'apps/web' },
        { name: 'apps/api', path: 'apps/api', dependsOn: ['shared'] },
        { name: 'shared', path: 'shared' },
      ],
    });

    const loaded = await loadWorkspaceSetConfig(workspaceSetPath, root);
    const graph = await buildWorkspaceSetDependencyGraph(loaded);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'apps/web', to: 'shared', reason: 'package_json_dependency' }),
        expect.objectContaining({ from: 'apps/api', to: 'shared', reason: 'explicit_depends_on' }),
      ])
    );
  });

  it('persists and loads workspace-set state in .librarian', async () => {
    const root = await makeTemp('librarian-workspace-state-');

    await writeWorkspaceSetState(root, {
      kind: 'WorkspaceSetState.v1',
      schemaVersion: 1,
      generatedAt: '2026-02-20T00:00:00.000Z',
      root,
      configPath: path.join(root, 'monorepo.json'),
      packages: [
        {
          name: 'apps/web',
          path: path.join(root, 'apps', 'web'),
          dbPath: path.join(root, 'apps', 'web', '.librarian', 'librarian.sqlite'),
          status: 'ready',
        },
      ],
      graph: {
        edges: [
          { from: 'apps/web', to: 'shared', reason: 'package_json_dependency' },
        ],
      },
    });

    const loaded = await readWorkspaceSetState(root);
    expect(loaded).toBeTruthy();
    expect(loaded?.packages[0]?.name).toBe('apps/web');
    expect(loaded?.graph.edges[0]).toEqual(
      expect.objectContaining({ from: 'apps/web', to: 'shared' })
    );
  });
});
