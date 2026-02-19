import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { __testing } from '../query.js';
import type { LibrarianQuery } from '../../types.js';

describe('query scope filtering helpers', () => {
  let workspace = '';

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-query-scope-'));
    await fs.mkdir(path.join(workspace, 'packages', 'api', 'src', 'auth'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'packages', 'web', 'src'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
      name: 'repo',
      workspaces: ['packages/*'],
    }), 'utf8');
    await fs.writeFile(path.join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8');
    await fs.writeFile(path.join(workspace, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@repo/api' }), 'utf8');
    await fs.writeFile(path.join(workspace, 'packages', 'web', 'package.json'), JSON.stringify({ name: '@repo/web' }), 'utf8');
    await fs.writeFile(path.join(workspace, 'packages', 'api', 'src', 'auth', 'jwt.ts'), 'export const jwt = true;\n', 'utf8');
  });

  afterEach(async () => {
    if (workspace) {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('auto-derives monorepo package prefix from workingFile', async () => {
    const query: LibrarianQuery = {
      intent: 'authentication',
      depth: 'L1',
      workingFile: 'packages/api/src/auth/jwt.ts',
    };

    const normalized = await __testing.normalizeQueryScope(query, workspace);
    expect(normalized.query.filter?.pathPrefix).toBe('packages/api/');
    expect(normalized.disclosures.some((entry) => entry.includes('scope_auto_detected'))).toBe(true);
  });

  it('normalizes absolute pathPrefix filters to workspace-relative form', async () => {
    const query: LibrarianQuery = {
      intent: 'authentication',
      depth: 'L1',
      filter: {
        pathPrefix: path.join(workspace, 'packages', 'web'),
      },
    };

    const normalized = await __testing.normalizeQueryScope(query, workspace);
    expect(normalized.query.filter?.pathPrefix).toBe('packages/web/');
  });

  it('preserves caller-provided affectedFiles while normalizing scope metadata', async () => {
    const query: LibrarianQuery = {
      intent: 'authentication',
      depth: 'L1',
      affectedFiles: ['packages/api/src/auth/jwt.ts'],
      workingFile: 'packages/api/src/auth/jwt.ts',
    };

    const normalized = await __testing.normalizeQueryScope(query, workspace);
    expect(normalized.query.affectedFiles).toEqual(['packages/api/src/auth/jwt.ts']);
    expect(normalized.query.filter?.pathPrefix).toBe('packages/api/');
  });
});

