import { describe, expect, it } from 'vitest';

describe('prune-github-action-runs', () => {
  it('deletes runs for workflows no longer active in the repo and stale non-success public runs while keeping current public runs and other active workflows', async () => {
    const { selectRunIdsForDeletion } = await import('../../scripts/prune-github-action-runs.mjs');

    const deletions = selectRunIdsForDeletion(
      [
        { databaseId: 1, workflowName: 'ci', status: 'completed', conclusion: 'success', headSha: 'current' },
        { databaseId: 2, workflowName: 'ci', status: 'completed', conclusion: 'failure', headSha: 'old' },
        { databaseId: 3, workflowName: 'npm-publish', status: 'completed', conclusion: 'cancelled', headSha: 'older' },
        { databaseId: 4, workflowName: 'Agent Patrol', status: 'completed', conclusion: 'success', headSha: 'old' },
        { databaseId: 5, workflowName: 'ci', status: 'in_progress', conclusion: '', headSha: 'current' },
        { databaseId: 6, workflowName: 'nightly-eval', status: 'completed', conclusion: 'failure', headSha: 'old' },
        { databaseId: 7, workflowName: 'Lifecycle Automation', status: 'completed', conclusion: 'success', headSha: 'old' },
      ],
      {
        keepWorkflows: new Set(['ci', 'npm-publish']),
        activeWorkflowNames: new Set(['ci', 'npm-publish', 'nightly-eval']),
        currentSha: 'current',
      },
    );

    expect(deletions).toEqual([2, 3, 4, 7]);
  });
});
