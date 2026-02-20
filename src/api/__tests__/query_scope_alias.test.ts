import { describe, expect, it } from 'vitest';
import { __testing } from '../query.js';
import type { LibrarianQuery } from '../../types.js';

const normalizeQueryScope = __testing.normalizeQueryScope;

describe('query scope alias', () => {
  it('maps query.scope to filter.pathPrefix when filter pathPrefix is absent', async () => {
    const query = {
      intent: 'How does auth work?',
      depth: 'L1',
      scope: 'apps/api',
    } as LibrarianQuery;

    const normalized = await normalizeQueryScope(query, '/repo');

    expect(normalized.query.filter?.pathPrefix).toBe('apps/api/');
    expect(normalized.disclosures).toContain('scope_explicit: apps/api/');
  });

  it('prefers existing filter.pathPrefix over query.scope', async () => {
    const query = {
      intent: 'How does auth work?',
      depth: 'L1',
      scope: 'apps/api',
      filter: {
        pathPrefix: 'shared/',
      },
    } as LibrarianQuery;

    const normalized = await normalizeQueryScope(query, '/repo');

    expect(normalized.query.filter?.pathPrefix).toBe('shared/');
    expect(normalized.disclosures).not.toContain('scope_explicit: apps/api/');
  });
});
