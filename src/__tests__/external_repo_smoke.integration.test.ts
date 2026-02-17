import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { runExternalRepoSmoke } from '../evaluation/external_repo_smoke.js';

const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && process.env.LIBRARIAN_TIER0 !== '1');
const EXTERNAL_REPOS_ROOT = path.join(process.cwd(), 'eval-corpus', 'external-repos');

describe('External repo smoke (integration)', () => {
  it('runs smoke checks against external repos', async (ctx) => {
    if (IS_UNIT_MODE) {
      ctx.skip(true, 'unverified_by_trace(test_tier): External repo smoke requires integration mode');
    }
    try {
      await access(path.join(EXTERNAL_REPOS_ROOT, 'manifest.json'));
    } catch {
      ctx.skip(true, 'unverified_by_trace(test_fixture_missing): External repos manifest missing');
    }

    const report = await runExternalRepoSmoke({
      reposRoot: EXTERNAL_REPOS_ROOT,
      maxRepos: 1,
    });

    expect(report.results.length).toBeGreaterThan(0);
    for (const result of report.results) {
      expect(result.errors).toEqual([]);
      expect(result.overviewOk || result.contextOk).toBe(true);
    }
  }, 120000);
});
