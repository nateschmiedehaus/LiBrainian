import { describe, expect, it } from 'vitest';

import { extractBootstrapDriftRelation } from '../../../scripts/dogfood-ci-gate.mjs';

describe('dogfood ci gate drift relation classification', () => {
  it('classifies indexed-ancestor drift reason', () => {
    const reason = 'Index is stale relative to git HEAD (abc -> def; new commits detected on current lineage). Run `librarian bootstrap` to refresh the self-index cursor before trusting query results.';
    expect(extractBootstrapDriftRelation(reason)).toBe('indexed_ancestor');
  });

  it('classifies head-ancestor drift reason', () => {
    const reason = 'Index is stale relative to git HEAD (abc -> def; branch/reset moved HEAD behind indexed commit). Run `librarian bootstrap --force` to rebuild index state for the current checkout before trusting query results.';
    expect(extractBootstrapDriftRelation(reason)).toBe('head_ancestor');
  });

  it('classifies diverged drift reason', () => {
    const reason = 'Index is stale relative to git HEAD (abc -> def; history diverged (rebase/rewrite/switch)). Run `librarian bootstrap --force` to rebuild index state for rewritten history before trusting query results.';
    expect(extractBootstrapDriftRelation(reason)).toBe('diverged');
  });

  it('returns unknown for non-drift text', () => {
    expect(extractBootstrapDriftRelation('Librarian data is up-to-date')).toBe('unknown');
  });
});
