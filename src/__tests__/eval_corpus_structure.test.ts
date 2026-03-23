import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const corpusRoot = resolve(process.cwd(), 'eval-corpus');
const externalReposRoot = join(corpusRoot, 'external-repos');
const manifestPath = join(externalReposRoot, 'manifest.json');
const MIN_REAL_REPOS = 10;
const MIN_UNANSWERABLE_RATIO = 0.2;
const SYNTHETIC_FIXTURE_IDS = new Set([
  'small-typescript',
  'medium-python',
  'medium-mixed',
  'large-monorepo',
  'adversarial',
]);

type ExternalRepoEntry = {
  name?: string;
  remote?: string;
  source?: string;
  commit?: string;
  verifiedAt?: string;
  language?: string;
};

type ExternalRepoManifest = {
  repos?: ExternalRepoEntry[];
};

type GroundTruthQuery = {
  verificationNotes?: string;
  verifiedBy?: string;
  tags?: string[];
  correctAnswer?: {
    evidenceRefs?: Array<{ path?: string }>;
  };
};

type RepoManifest = {
  repoId?: string;
  name?: string;
  languages?: string[];
  fileCount?: number;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function loadExternalManifest(): ExternalRepoManifest {
  expect(existsSync(manifestPath)).toBe(true);
  return readJson<ExternalRepoManifest>(manifestPath);
}

function collectAuthoritativeRepos() {
  const manifest = loadExternalManifest();
  const repos = Array.isArray(manifest.repos) ? manifest.repos : [];

  return repos
    .filter((repo): repo is Required<Pick<ExternalRepoEntry, 'name'>> & ExternalRepoEntry => typeof repo.name === 'string' && repo.name.length > 0)
    .map((repo) => {
      const repoRoot = join(externalReposRoot, repo.name);
      const evalRoot = join(repoRoot, '.librarian-eval');
      const repoManifestPath = join(evalRoot, 'manifest.json');
      const groundTruthPath = join(evalRoot, 'ground-truth.json');

      return {
        entry: repo,
        repoRoot,
        repoManifestPath,
        groundTruthPath,
        hasCheckout: existsSync(repoRoot) && existsSync(join(repoRoot, '.git')),
        hasEvalArtifacts: existsSync(repoManifestPath) && existsSync(groundTruthPath),
      };
    });
}

describe('eval corpus structure', () => {
  it('tracks at least ten real external repos pinned to commits', () => {
    expect(existsSync(corpusRoot)).toBe(true);
    expect(existsSync(join(corpusRoot, 'README.md'))).toBe(true);
    expect(existsSync(join(corpusRoot, 'schema', 'ground_truth.schema.json'))).toBe(true);

    const manifest = loadExternalManifest();
    const repos = Array.isArray(manifest.repos) ? manifest.repos : [];
    expect(repos.length).toBeGreaterThanOrEqual(MIN_REAL_REPOS);

    for (const repo of repos) {
      expect(typeof repo.name).toBe('string');
      expect(repo.name?.length ?? 0).toBeGreaterThan(0);
      expect(SYNTHETIC_FIXTURE_IDS.has(repo.name ?? '')).toBe(false);
      expect(typeof repo.remote).toBe('string');
      expect(repo.remote).toContain('github.com');
      expect(typeof repo.source).toBe('string');
      expect(repo.source).toContain('github.com');
      expect(typeof repo.commit).toBe('string');
      expect(repo.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof repo.verifiedAt).toBe('string');
      expect(repo.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps at least ten external repos checked out with git metadata', () => {
    const repos = collectAuthoritativeRepos();
    const checkedOut = repos.filter((repo) => repo.hasCheckout);
    expect(checkedOut.length).toBeGreaterThanOrEqual(MIN_REAL_REPOS);
  });

  it('stores AST-generated ground truth for at least ten authoritative repos', () => {
    const repos = collectAuthoritativeRepos()
      .filter((repo) => repo.hasEvalArtifacts)
      .map((repo) => {
        const groundTruth = readJson<{ repoId?: string; queries?: GroundTruthQuery[] }>(repo.groundTruthPath);
        return {
          ...repo,
          groundTruth,
          queries: Array.isArray(groundTruth.queries) ? groundTruth.queries : [],
        };
      });
    expect(repos.length).toBeGreaterThanOrEqual(MIN_REAL_REPOS);

    const reposWithQueries = repos.filter((repo) => repo.queries.length > 0);
    expect(reposWithQueries.length).toBeGreaterThan(0);

    for (const repo of repos.slice(0, MIN_REAL_REPOS)) {
      const repoManifest = readJson<RepoManifest>(repo.repoManifestPath);

      expect(repoManifest.repoId).toBe(repo.entry.name);
      expect(repoManifest.name).toBe(repo.entry.name);
      expect(Array.isArray(repoManifest.languages)).toBe(true);
      expect((repoManifest.fileCount ?? 0)).toBeGreaterThan(0);
    }

    for (const repo of reposWithQueries) {
      const queries = repo.queries;
      expect(queries.length).toBeGreaterThan(0);

      for (const query of queries) {
        expect(query.verificationNotes).toContain('AST facts');
        expect(query.verifiedBy).toContain('external');
        expect(query.tags).toEqual(expect.arrayContaining(['structural_ground_truth']));
        expect(query.correctAnswer?.evidenceRefs?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('maintains at least twenty percent unanswerable coverage across the authoritative corpus', () => {
    const repos = collectAuthoritativeRepos().filter((repo) => repo.hasEvalArtifacts);
    let totalQueries = 0;
    let unanswerableQueries = 0;

    for (const repo of repos) {
      const groundTruth = readJson<{ queries?: GroundTruthQuery[] }>(repo.groundTruthPath);
      const queries = Array.isArray(groundTruth.queries) ? groundTruth.queries : [];
      totalQueries += queries.length;
      unanswerableQueries += queries.filter((query) => query.tags?.includes('unanswerable')).length;
    }

    expect(totalQueries).toBeGreaterThan(0);
    expect(unanswerableQueries / totalQueries).toBeGreaterThanOrEqual(MIN_UNANSWERABLE_RATIO);
  });
});
