import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveWorkspaceRoot } from '../workspace_resolver.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'librarian-workspace-'));
}

async function writeFile(root: string, relativePath: string): Promise<void> {
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, 'export const x = 1;\n');
}

describe('resolveWorkspaceRoot', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('returns the same workspace when source files are present', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await writeFile(root, 'src/index.ts');

    const result = resolveWorkspaceRoot(root);

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(path.resolve(root));
  });

  it('auto-detects parent workspace when subdir is empty but parent has marker and sources', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await fs.mkdir(path.join(root, '.git'));
    await writeFile(root, 'src/app.ts');
    const subdir = path.join(root, 'docs');
    await fs.mkdir(subdir, { recursive: true });

    const result = resolveWorkspaceRoot(subdir);

    expect(result.changed).toBe(true);
    expect(result.workspace).toBe(path.resolve(root));
  });

  it('does not change when subdir contains source files', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    const subdir = path.join(root, 'pkg');
    await writeFile(subdir, 'index.ts');

    const result = resolveWorkspaceRoot(subdir);

    expect(result.changed).toBe(false);
    expect(result.workspace).toBe(path.resolve(subdir));
  });

  it('does not auto-detect outside configured tmp boundary', async () => {
    const root = await createTempDir();
    tempDirs.push(root);
    await fs.mkdir(path.join(root, '.git'));
    await writeFile(root, 'src/index.ts');

    const tmpBoundary = path.join(root, '.tmp', 'librainian');
    await fs.mkdir(tmpBoundary, { recursive: true });
    const isolatedWorkspace = path.join(tmpBoundary, 'isolated');
    await fs.mkdir(isolatedWorkspace, { recursive: true });

    const previousBoundary = process.env.LIBRAINIAN_TMPDIR;
    process.env.LIBRAINIAN_TMPDIR = tmpBoundary;
    try {
      const result = resolveWorkspaceRoot(isolatedWorkspace);
      expect(result.changed).toBe(false);
      expect(result.workspace).toBe(path.resolve(isolatedWorkspace));
    } finally {
      if (previousBoundary === undefined) {
        delete process.env.LIBRAINIAN_TMPDIR;
      } else {
        process.env.LIBRAINIAN_TMPDIR = previousBoundary;
      }
    }
  });
});
