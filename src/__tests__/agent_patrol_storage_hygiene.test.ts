import { describe, expect, it } from 'vitest';
import { selectStorageEntriesForDeletion } from '../../scripts/agent-patrol.mjs';

describe('agent patrol storage hygiene policy', () => {
  const nowMs = Date.now();
  const policy = {
    maxStorageBytes: 500,
    maxArtifactAgeMs: 1_000,
    maxEntries: 2,
  };

  it('deletes artifacts older than the configured age cap', () => {
    const entries = [
      {
        path: '/tmp/old-sandbox',
        kind: 'sandbox',
        mtimeMs: nowMs - 10_000,
        sizeBytes: 10,
        protected: false,
      },
      {
        path: '/tmp/fresh-sandbox',
        kind: 'sandbox',
        mtimeMs: nowMs - 100,
        sizeBytes: 10,
        protected: false,
      },
    ];

    const removals = selectStorageEntriesForDeletion(entries, policy, nowMs);
    expect(removals.map((entry) => entry.path)).toEqual(['/tmp/old-sandbox']);
  });

  it('enforces total-size cap by removing oldest unprotected entries first', () => {
    const entries = [
      {
        path: '/tmp/a',
        kind: 'sandbox',
        mtimeMs: nowMs - 900,
        sizeBytes: 300,
        protected: false,
      },
      {
        path: '/tmp/b',
        kind: 'sandbox',
        mtimeMs: nowMs - 800,
        sizeBytes: 300,
        protected: false,
      },
      {
        path: '/tmp/c',
        kind: 'sandbox',
        mtimeMs: nowMs - 700,
        sizeBytes: 100,
        protected: false,
      },
    ];

    const removals = selectStorageEntriesForDeletion(entries, policy, nowMs);
    expect(removals.map((entry) => entry.path)).toEqual(['/tmp/a']);
  });

  it('never selects protected active-run paths for deletion', () => {
    const entries = [
      {
        path: '/tmp/protected',
        kind: 'sandbox',
        mtimeMs: nowMs - 50_000,
        sizeBytes: 10_000,
        protected: true,
      },
      {
        path: '/tmp/unprotected',
        kind: 'sandbox',
        mtimeMs: nowMs - 50_000,
        sizeBytes: 10_000,
        protected: false,
      },
    ];

    const removals = selectStorageEntriesForDeletion(entries, policy, nowMs);
    expect(removals.map((entry) => entry.path)).toEqual(['/tmp/unprotected']);
  });
});
