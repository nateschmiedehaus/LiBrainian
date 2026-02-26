import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import type { LibrarianQuery } from '../../types.js';
import {
  expandPathCandidates,
  normalizeQueryScope,
  resolveWorkspacePath,
  toRelativePath,
} from '../query_scope_utils.js';

describe('query scope utils', () => {
  it('expands path candidates with absolute and relative variants', () => {
    const workspace = '/repo';
    const candidates = expandPathCandidates('apps/api/src/index.ts', workspace);
    const absolute = path.resolve(workspace, 'apps/api/src/index.ts');

    expect(candidates).toContain(absolute);
    expect(candidates).toContain('apps/api/src/index.ts');
    expect(candidates).toContain('./apps/api/src/index.ts');
  });

  it('normalizes scope and filter to workspace-relative pathPrefix', async () => {
    const workspace = '/repo';
    const query: LibrarianQuery = {
      intent: 'auth',
      depth: 'L1',
      scope: '/repo/apps/api',
    };

    const normalized = await normalizeQueryScope(query, workspace);
    expect(normalized.query.filter?.pathPrefix).toBe('apps/api/');
  });

  it('converts workspace paths consistently', () => {
    const workspace = '/repo';
    expect(toRelativePath(workspace, '/repo/apps/api/src/index.ts')).toBe('apps/api/src/index.ts');
    expect(resolveWorkspacePath(workspace, 'apps/api/src/index.ts')).toBe('/repo/apps/api/src/index.ts');
  });
});
