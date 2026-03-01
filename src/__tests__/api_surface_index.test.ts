import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildApiSurfaceIndex,
  clearApiSurfaceIndexCache,
  validateImportReference,
} from '../evaluation/api_surface_index.js';

async function writeJson(target: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

async function createWorkspace(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const workspaces: string[] = [];

afterEach(async () => {
  clearApiSurfaceIndexCache();
  await Promise.all(
    workspaces.splice(0, workspaces.length).map(async (workspace) => {
      await fs.rm(workspace, { recursive: true, force: true });
    }),
  );
});

describe('api_surface_index', () => {
  it('indexes exports from local declaration files under node_modules', async () => {
    const workspace = await createWorkspace('librainian-api-surface-');
    workspaces.push(workspace);

    await writeJson(path.join(workspace, 'package.json'), {
      name: 'sample-workspace',
      version: '1.0.0',
      dependencies: {
        'demo-pkg': '^1.0.0',
      },
    });
    await writeJson(path.join(workspace, 'node_modules', 'demo-pkg', 'package.json'), {
      name: 'demo-pkg',
      version: '1.2.3',
      types: 'index.d.ts',
    });
    await writeText(
      path.join(workspace, 'node_modules', 'demo-pkg', 'index.d.ts'),
      [
        'export declare function fetchThing(id: string): Promise<string>;',
        'export declare class Widget {',
        '  start(): void;',
        '  stop(): void;',
        '}',
      ].join('\n'),
    );

    const snapshot = await buildApiSurfaceIndex(workspace);
    const pkg = snapshot.packages.find((entry) => entry.packageName === 'demo-pkg');

    expect(pkg).toBeDefined();
    expect(pkg?.exports.some((entry) => entry.name === 'fetchThing')).toBe(true);
    expect(pkg?.exports.some((entry) => entry.name === 'Widget')).toBe(true);
  });

  it('validates exports and members with actionable suggestions', async () => {
    const workspace = await createWorkspace('librainian-api-validate-');
    workspaces.push(workspace);

    await writeJson(path.join(workspace, 'package.json'), {
      name: 'sample-workspace',
      version: '1.0.0',
      dependencies: {
        'demo-pkg': '^1.0.0',
      },
    });
    await writeJson(path.join(workspace, 'node_modules', 'demo-pkg', 'package.json'), {
      name: 'demo-pkg',
      version: '1.2.3',
      types: 'index.d.ts',
    });
    await writeText(
      path.join(workspace, 'node_modules', 'demo-pkg', 'index.d.ts'),
      [
        'export declare class Widget {',
        '  start(): void;',
        '  stop(): void;',
        '}',
      ].join('\n'),
    );

    const valid = await validateImportReference(workspace, {
      packageName: 'demo-pkg',
      importName: 'Widget',
      memberName: 'start',
    });
    expect(valid.valid).toBe(true);
    expect(valid.reason).toBe('ok');

    const invalidSymbol = await validateImportReference(workspace, {
      packageName: 'demo-pkg',
      importName: 'Widgit',
    });
    expect(invalidSymbol.valid).toBe(false);
    expect(invalidSymbol.reason).toBe('unknown_import');
    expect(invalidSymbol.suggestions).toContain('Widget');

    const invalidMember = await validateImportReference(workspace, {
      packageName: 'demo-pkg',
      importName: 'Widget',
      memberName: 'strt',
    });
    expect(invalidMember.valid).toBe(false);
    expect(invalidMember.reason).toBe('unknown_member');
    expect(invalidMember.suggestions).toContain('start');
  });

  it('detects Next.js App Router mismatch for next/router imports', async () => {
    const workspace = await createWorkspace('librainian-api-next-');
    workspaces.push(workspace);

    await writeJson(path.join(workspace, 'package.json'), {
      name: 'sample-workspace',
      version: '1.0.0',
      dependencies: {
        next: '^14.1.0',
      },
    });
    await writeText(path.join(workspace, 'app', 'page.tsx'), 'export default function Page() { return null; }');
    await writeJson(path.join(workspace, 'node_modules', 'next', 'package.json'), {
      name: 'next',
      version: '14.1.0',
      types: 'index.d.ts',
    });
    await writeText(path.join(workspace, 'node_modules', 'next', 'index.d.ts'), 'export declare const nextVersion: string;');
    await writeText(path.join(workspace, 'node_modules', 'next', 'router.d.ts'), 'export declare function useRouter(): unknown;');

    const result = await validateImportReference(workspace, {
      packageName: 'next/router',
      importName: 'useRouter',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('framework_mismatch');
    expect(result.suggestions).toContain('next/navigation');
  });

  it('resolves subpath exports via package.json exports field when direct .d.ts is absent', async () => {
    const workspace = await createWorkspace('librainian-api-subpath-');
    workspaces.push(workspace);

    // Package uses exports field to point subpath "./utils" to "dist/utils.d.ts"
    // There is NO "utils.d.ts" or "utils/index.d.ts" at the root — only the exports field path works.
    await writeJson(path.join(workspace, 'package.json'), {
      name: 'sample-workspace',
      version: '1.0.0',
      dependencies: {
        'fancy-pkg': '^2.0.0',
      },
    });
    await writeJson(path.join(workspace, 'node_modules', 'fancy-pkg', 'package.json'), {
      name: 'fancy-pkg',
      version: '2.0.0',
      exports: {
        '.': { types: './index.d.ts', import: './index.js' },
        './utils': { types: './dist/utils.d.ts', import: './dist/utils.js' },
      },
    });
    await writeText(
      path.join(workspace, 'node_modules', 'fancy-pkg', 'index.d.ts'),
      'export declare function root(): void;',
    );
    // Only exists via exports field — NOT at utils.d.ts or utils/index.d.ts
    await writeText(
      path.join(workspace, 'node_modules', 'fancy-pkg', 'dist', 'utils.d.ts'),
      'export declare function parseUtil(input: string): number;',
    );

    const result = await validateImportReference(workspace, {
      packageName: 'fancy-pkg/utils',
      importName: 'parseUtil',
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('invalidates cache when package manifests change', async () => {
    const workspace = await createWorkspace('librainian-api-cache-');
    workspaces.push(workspace);

    await writeJson(path.join(workspace, 'package.json'), {
      name: 'sample-workspace',
      version: '1.0.0',
      dependencies: {
        'pkg-a': '^1.0.0',
      },
    });
    await writeJson(path.join(workspace, 'node_modules', 'pkg-a', 'package.json'), {
      name: 'pkg-a',
      version: '1.0.0',
      types: 'index.d.ts',
    });
    await writeText(path.join(workspace, 'node_modules', 'pkg-a', 'index.d.ts'), 'export declare const alpha: string;');

    const first = await buildApiSurfaceIndex(workspace);
    expect(first.packages.some((entry) => entry.packageName === 'pkg-a')).toBe(true);
    expect(first.packages.some((entry) => entry.packageName === 'pkg-b')).toBe(false);

    await writeJson(path.join(workspace, 'package.json'), {
      name: 'sample-workspace',
      version: '1.0.0',
      dependencies: {
        'pkg-a': '^1.0.0',
        'pkg-b': '^1.0.0',
      },
    });
    await writeJson(path.join(workspace, 'node_modules', 'pkg-b', 'package.json'), {
      name: 'pkg-b',
      version: '1.0.0',
      types: 'index.d.ts',
    });
    await writeText(path.join(workspace, 'node_modules', 'pkg-b', 'index.d.ts'), 'export declare const beta: string;');

    const second = await buildApiSurfaceIndex(workspace);
    expect(second.packages.some((entry) => entry.packageName === 'pkg-b')).toBe(true);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});
