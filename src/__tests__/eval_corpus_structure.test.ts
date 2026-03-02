import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const corpusRoot = resolve(process.cwd(), 'eval-corpus');
const externalCorpusPath = resolve(process.cwd(), 'state/benchmarks/corpus/external-repos.json');

const repoIds = [
  'small-typescript',
  'medium-python',
  'medium-mixed',
  'large-monorepo',
  'adversarial',
];

const queryCategories = [
  'structural',
  'behavioral',
  'architectural',
  'impact',
  'security',
];

describe('eval corpus structure', () => {
  it('creates top-level corpus directories and README', () => {
    expect(existsSync(corpusRoot)).toBe(true);
    expect(existsSync(join(corpusRoot, 'README.md'))).toBe(true);
    expect(existsSync(join(corpusRoot, 'schema'))).toBe(true);
    expect(existsSync(join(corpusRoot, 'repos'))).toBe(true);
    expect(existsSync(join(corpusRoot, 'queries'))).toBe(true);
  });

  it('provides a ground truth schema placeholder', () => {
    const schemaPath = join(corpusRoot, 'schema', 'ground_truth.schema.json');
    expect(existsSync(schemaPath)).toBe(true);

    const raw = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(raw) as {
      title?: string;
      type?: string;
      required?: string[];
      definitions?: Record<string, unknown>;
    };

    expect(schema.title).toBe('GroundTruthCorpus');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['version', 'repos', 'queries'])
    );
    expect(schema.definitions && typeof schema.definitions).toBe('object');
    expect(schema.definitions).toHaveProperty('RepoManifest');
    expect(schema.definitions).toHaveProperty('GroundTruthQuery');
    expect(schema.definitions).toHaveProperty('CorrectAnswer');
    expect(schema.definitions).toHaveProperty('EvidenceRef');
    expect(schema.definitions).toHaveProperty('EvidenceLink');
    expect(schema.definitions).toHaveProperty('EvidenceLocation');

    const correctAnswer = schema.definitions?.CorrectAnswer as {
      required?: string[];
    };
    expect(correctAnswer?.required).toEqual(
      expect.arrayContaining(['evidenceRefs'])
    );
  });

  it('creates repo fixtures with manifests and ground-truth placeholders', () => {
    const requiredManifestKeys = [
      'repoId',
      'name',
      'languages',
      'fileCount',
      'annotationLevel',
      'characteristics',
    ];

    repoIds.forEach((repoId) => {
      const repoRoot = join(corpusRoot, 'repos', repoId);
      const evalRoot = join(repoRoot, '.librarian-eval');
      const manifestPath = join(evalRoot, 'manifest.json');
      const groundTruthPath = join(evalRoot, 'ground-truth.json');

      expect(existsSync(repoRoot)).toBe(true);
      expect(existsSync(evalRoot)).toBe(true);
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(groundTruthPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      requiredManifestKeys.forEach((key) => {
        expect(manifest).toHaveProperty(key);
      });
    });

    const annotationsRoot = join(
      corpusRoot,
      'repos',
      'small-typescript',
      '.librarian-eval',
      'annotations'
    );

    expect(existsSync(annotationsRoot)).toBe(true);
    expect(existsSync(join(annotationsRoot, 'architecture.md'))).toBe(true);
    expect(existsSync(join(annotationsRoot, 'auth-flow.md'))).toBe(true);
    expect(existsSync(join(annotationsRoot, 'impact-matrix.json'))).toBe(true);
  });

  it('populates the small-typescript ground truth with minimum QA pairs', () => {
    const groundTruthPath = join(
      corpusRoot,
      'repos',
      'small-typescript',
      '.librarian-eval',
      'ground-truth.json'
    );

    const payload = JSON.parse(readFileSync(groundTruthPath, 'utf8')) as {
      queries?: unknown[];
    };

    expect(Array.isArray(payload.queries)).toBe(true);
    expect(payload.queries?.length ?? 0).toBeGreaterThanOrEqual(20);
  });

  it('populates medium repo ground truth with minimum QA pairs', () => {
    const mediumPythonPath = join(
      corpusRoot,
      'repos',
      'medium-python',
      '.librarian-eval',
      'ground-truth.json'
    );
    const mediumMixedPath = join(
      corpusRoot,
      'repos',
      'medium-mixed',
      '.librarian-eval',
      'ground-truth.json'
    );

    const pythonPayload = JSON.parse(readFileSync(mediumPythonPath, 'utf8')) as {
      queries?: unknown[];
    };
    const mixedPayload = JSON.parse(readFileSync(mediumMixedPath, 'utf8')) as {
      queries?: unknown[];
    };

    expect(Array.isArray(pythonPayload.queries)).toBe(true);
    expect(Array.isArray(mixedPayload.queries)).toBe(true);
    expect(pythonPayload.queries?.length ?? 0).toBeGreaterThanOrEqual(15);
    expect(mixedPayload.queries?.length ?? 0).toBeGreaterThanOrEqual(15);
  });

  it('populates adversarial ground truth with minimum QA pairs', () => {
    const groundTruthPath = join(
      corpusRoot,
      'repos',
      'adversarial',
      '.librarian-eval',
      'ground-truth.json'
    );

    const payload = JSON.parse(readFileSync(groundTruthPath, 'utf8')) as {
      queries?: unknown[];
    };

    expect(Array.isArray(payload.queries)).toBe(true);
    expect(payload.queries?.length ?? 0).toBeGreaterThanOrEqual(15);
  });

  it('tracks total QA coverage across repos', () => {
    const total = repoIds.reduce((sum, repoId) => {
      const groundTruthPath = join(
        corpusRoot,
        'repos',
        repoId,
        '.librarian-eval',
        'ground-truth.json'
      );
      const payload = JSON.parse(readFileSync(groundTruthPath, 'utf8')) as {
        queries?: unknown[];
      };
      return sum + (payload.queries?.length ?? 0);
    }, 0);

    expect(total).toBeGreaterThanOrEqual(200);
  });

  it('includes query category placeholders', () => {
    queryCategories.forEach((category) => {
      const queryPath = join(corpusRoot, 'queries', `${category}.json`);
      expect(existsSync(queryPath)).toBe(true);

      const payload = JSON.parse(readFileSync(queryPath, 'utf8')) as {
        category?: string;
        queries?: unknown[];
      };

      expect(payload.category).toBe(category);
      expect(Array.isArray(payload.queries)).toBe(true);
    });
  });
});

type ExternalCorpusQuery = {
  id: string;
  answerable: boolean;
  [key: string]: unknown;
};

type ExternalCorpusRepoGroundTruth = {
  methodology: string;
  llmGenerated: boolean;
  queries: ExternalCorpusQuery[];
};

type ExternalCorpusRepo = {
  repoId: string;
  source: string;
  language: string;
  commitSha: string;
  groundTruth: ExternalCorpusRepoGroundTruth;
};

type ExternalCorpus = {
  version: string;
  methodology: string;
  llmGenerated: boolean;
  repos: ExternalCorpusRepo[];
  aggregate: {
    totalRepos: number;
    totalQueries: number;
    unanswerableQueries: number;
    unanswerableRatio: number;
    allCommitShasPinned: boolean;
    allGroundTruthAstOnly: boolean;
  };
};

describe('external real repos corpus validity', () => {
  it('external corpus manifest exists at state/benchmarks/corpus/external-repos.json', () => {
    expect(existsSync(externalCorpusPath)).toBe(true);
  });

  it('external corpus has ≥10 real repos', () => {
    const corpus = JSON.parse(readFileSync(externalCorpusPath, 'utf8')) as ExternalCorpus;
    expect(Array.isArray(corpus.repos)).toBe(true);
    expect(corpus.repos.length).toBeGreaterThanOrEqual(10);
  });

  it('all repos have non-empty pinned commit SHAs for reproducibility', () => {
    const corpus = JSON.parse(readFileSync(externalCorpusPath, 'utf8')) as ExternalCorpus;
    for (const repo of corpus.repos) {
      expect(typeof repo.commitSha).toBe('string');
      expect(repo.commitSha.length).toBeGreaterThan(0);
      // SHA should look like a git commit hash (hex characters, at least 7)
      expect(repo.commitSha).toMatch(/^[0-9a-f]{7,}/);
    }
  });

  it('corpus methodology is ast_only — no LLM-generated facts', () => {
    const corpus = JSON.parse(readFileSync(externalCorpusPath, 'utf8')) as ExternalCorpus;
    expect(corpus.methodology).toBe('ast_only');
    expect(corpus.llmGenerated).toBe(false);
    for (const repo of corpus.repos) {
      expect(repo.groundTruth.methodology).toContain('ast');
      expect(repo.groundTruth.llmGenerated).toBe(false);
    }
  });

  it('all repos reference real GitHub sources (not synthetic)', () => {
    const corpus = JSON.parse(readFileSync(externalCorpusPath, 'utf8')) as ExternalCorpus;
    for (const repo of corpus.repos) {
      expect(typeof repo.source).toBe('string');
      expect(repo.source).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('corpus includes ≥20% unanswerable questions for calibration', () => {
    const corpus = JSON.parse(readFileSync(externalCorpusPath, 'utf8')) as ExternalCorpus;
    let totalQueries = 0;
    let unanswerableQueries = 0;
    for (const repo of corpus.repos) {
      for (const query of repo.groundTruth.queries) {
        totalQueries++;
        if (query.answerable === false) {
          unanswerableQueries++;
        }
      }
    }
    expect(totalQueries).toBeGreaterThan(0);
    const ratio = unanswerableQueries / totalQueries;
    expect(ratio).toBeGreaterThanOrEqual(0.2);
  });

  it('aggregate stats are consistent with per-repo data', () => {
    const corpus = JSON.parse(readFileSync(externalCorpusPath, 'utf8')) as ExternalCorpus;
    expect(corpus.aggregate.totalRepos).toBe(corpus.repos.length);
    expect(corpus.aggregate.allCommitShasPinned).toBe(true);
    expect(corpus.aggregate.allGroundTruthAstOnly).toBe(true);
    expect(corpus.aggregate.unanswerableRatio).toBeGreaterThanOrEqual(0.2);
  });

  it('external repos manifest also exists at eval-corpus/external-repos/manifest.json', () => {
    const manifestPath = join(resolve(process.cwd(), 'eval-corpus'), 'external-repos', 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { repos?: unknown[] };
    expect(Array.isArray(manifest.repos)).toBe(true);
    expect((manifest.repos ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
