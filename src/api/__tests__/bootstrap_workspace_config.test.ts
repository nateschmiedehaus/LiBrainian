import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { __testing } from '../bootstrap.js';

describe('bootstrap workspace ignore loading', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  async function createWorkspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-bootstrap-ignore-'));
    createdDirs.push(dir);
    return dir;
  }

  it('does not warn when .librainian.json is absent', async () => {
    const workspace = await createWorkspace();
    const loaded = await __testing.loadWorkspaceIgnorePatterns(workspace);
    expect(loaded.warnings).toEqual([]);
  });

  it('merges .gitignore and .librainian.json ignore patterns', async () => {
    const workspace = await createWorkspace();
    await fs.writeFile(
      path.join(workspace, '.gitignore'),
      [
        '# generated artifacts',
        'node_modules',
        '.next/',
        'logs/*.log',
        '!keep-me.txt',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(workspace, '.librainian.json'),
      JSON.stringify({
        version: 1,
        ignore: ['dist', 'coverage/**'],
      })
    );

    const loaded = await __testing.loadWorkspaceIgnorePatterns(workspace);

    expect(loaded.warnings).toEqual([]);
    expect(loaded.patterns).toContain('**/node_modules/**');
    expect(loaded.patterns).toContain('**/.next/**');
    expect(loaded.patterns).toContain('**/logs/*.log');
    expect(loaded.patterns.some((pattern) => pattern.endsWith('dist/**'))).toBe(true);
    expect(loaded.patterns).toContain('**/coverage/**');
  });

  it('reports invalid .librainian.json content as a warning', async () => {
    const workspace = await createWorkspace();
    await fs.writeFile(path.join(workspace, '.librainian.json'), '{invalid json');

    const loaded = await __testing.loadWorkspaceIgnorePatterns(workspace);

    expect(loaded.warnings.some((warning) => warning.includes('Failed to load .librainian.json ignore patterns'))).toBe(true);
  });
});
