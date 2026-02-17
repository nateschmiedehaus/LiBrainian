import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../integration/first_run_gate.js', () => ({
  ensureLibrarianReady: vi.fn(),
}));

import { ensureLibrarianReady } from '../../integration/first_run_gate.js';
import { runExternalRepoSmoke } from '../external_repo_smoke.js';

async function createSmokeFixture(repoName = 'repo-a'): Promise<{ root: string; repoRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'librarian-external-smoke-'));
  const reposRoot = path.join(root, 'external-repos');
  const repoRoot = path.join(reposRoot, repoName);
  await mkdir(repoRoot, { recursive: true });
  await writeFile(path.join(repoRoot, 'README.md'), '# Fixture repo\n');
  await writeFile(path.join(reposRoot, 'manifest.json'), JSON.stringify({
    repos: [{ name: repoName }],
  }, null, 2));
  return { root: reposRoot, repoRoot };
}

describe('runExternalRepoSmoke', () => {
  let fixtureRoot: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (fixtureRoot) {
      await rm(path.dirname(fixtureRoot), { recursive: true, force: true });
      fixtureRoot = null;
    }
  });

  it('fails closed when a repo smoke execution exceeds repoTimeoutMs', async () => {
    const fixture = await createSmokeFixture();
    fixtureRoot = fixture.root;

    vi.mocked(ensureLibrarianReady).mockImplementation(() => new Promise(() => {}));

    const report = await runExternalRepoSmoke({
      reposRoot: fixture.root,
      maxRepos: 1,
      repoTimeoutMs: 5,
    });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.errors.some((error) => error.includes('unverified_by_trace(smoke_repo_timeout)'))).toBe(true);
  });

  it('emits progress artifact updates when artifactRoot is configured', async () => {
    const fixture = await createSmokeFixture();
    fixtureRoot = fixture.root;

    const queryOptional = vi.fn().mockResolvedValue({
      packs: [{ summary: 'Useful context', keyFacts: [], codeSnippets: [] }],
    });
    const shutdown = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ensureLibrarianReady).mockResolvedValue({
      librarian: {
        queryOptional,
        shutdown,
      },
    } as any);

    const report = await runExternalRepoSmoke({
      reposRoot: fixture.root,
      maxRepos: 1,
      artifactRoot: path.join(path.dirname(fixture.root), 'artifacts'),
      runLabel: 'unit-test',
      repoTimeoutMs: 1000,
    });

    expect(report.results).toHaveLength(1);
    expect(report.artifacts?.progressPath).toBeDefined();

    const progressRaw = await readFile(report.artifacts!.progressPath, 'utf8');
    const progress = JSON.parse(progressRaw) as {
      completedRepos: number;
      totalRepos: number;
      activeRepo: string | null;
      failedRepos: string[];
    };
    expect(progress.totalRepos).toBe(1);
    expect(progress.completedRepos).toBe(1);
    expect(progress.activeRepo).toBeNull();
    expect(progress.failedRepos).toHaveLength(0);
  });

  it('runs in strict embedding mode (no degraded fallback)', async () => {
    const fixture = await createSmokeFixture();
    fixtureRoot = fixture.root;

    const queryOptional = vi.fn().mockResolvedValue({
      packs: [{ summary: 'Useful context', keyFacts: [], codeSnippets: [] }],
    });
    const shutdown = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ensureLibrarianReady).mockResolvedValue({
      librarian: {
        queryOptional,
        shutdown,
      },
    } as any);

    await runExternalRepoSmoke({
      reposRoot: fixture.root,
      maxRepos: 1,
      repoTimeoutMs: 1000,
    });

    expect(ensureLibrarianReady).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      allowDegradedEmbeddings: false,
      requireCompleteParserCoverage: true,
      throwOnFailure: true,
    }));
    const calls = queryOptional.mock.calls.map((call) => call[0]);
    expect(calls.every((call) => call.embeddingRequirement === 'required')).toBe(true);
  });

  it('accepts requested repos present on disk even when missing from manifest', async () => {
    const fixture = await createSmokeFixture('manifested-repo');
    fixtureRoot = fixture.root;

    const extraRepoRoot = path.join(fixture.root, 'ad-hoc-repo');
    await mkdir(extraRepoRoot, { recursive: true });
    await writeFile(path.join(extraRepoRoot, 'README.md'), '# Ad-hoc repo\n');

    const queryOptional = vi.fn().mockResolvedValue({
      packs: [{ summary: 'Useful context', keyFacts: [], codeSnippets: [] }],
    });
    const shutdown = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ensureLibrarianReady).mockResolvedValue({
      librarian: {
        queryOptional,
        shutdown,
      },
    } as any);

    const report = await runExternalRepoSmoke({
      reposRoot: fixture.root,
      repoNames: ['ad-hoc-repo'],
      repoTimeoutMs: 1000,
    });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.repo).toBe('ad-hoc-repo');
    expect(report.results[0]?.errors).toHaveLength(0);
  });

  it('fails closed when bootstrap reports semantic/parsing degradation warnings', async () => {
    const fixture = await createSmokeFixture();
    fixtureRoot = fixture.root;

    const queryOptional = vi.fn().mockResolvedValue({
      packs: [{ summary: 'Useful context', keyFacts: [], codeSnippets: [] }],
    });
    const shutdown = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ensureLibrarianReady).mockResolvedValue({
      librarian: {
        queryOptional,
        shutdown,
      },
      report: {
        warnings: ['No functions extracted from files. AST parsing may not support your languages or files may not contain parseable code.'],
      },
    } as any);

    const report = await runExternalRepoSmoke({
      reposRoot: fixture.root,
      maxRepos: 1,
      repoTimeoutMs: 1000,
    });

    expect(report.results[0]?.errors.some((error) => error.includes('unverified_by_trace(bootstrap_warning)'))).toBe(true);
    expect(queryOptional).not.toHaveBeenCalled();
  });
});
