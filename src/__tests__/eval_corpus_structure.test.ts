import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const corpusRoot = resolve(process.cwd(), 'eval-corpus');

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
      const evalRoot = join(repoRoot, '.librainian-eval');
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
      '.librainian-eval',
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
      '.librainian-eval',
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
      '.librainian-eval',
      'ground-truth.json'
    );
    const mediumMixedPath = join(
      corpusRoot,
      'repos',
      'medium-mixed',
      '.librainian-eval',
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
      '.librainian-eval',
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
        '.librainian-eval',
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
