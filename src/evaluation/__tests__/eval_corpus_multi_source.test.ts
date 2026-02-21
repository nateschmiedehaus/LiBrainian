/**
 * @fileoverview Eval corpus multi-source merge tests.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createEvalRunner, type EvalPipeline } from '../runner.js';

const fixedClock = () => new Date('2026-01-26T00:00:00.000Z');

interface FixtureQueryInput {
  queryId: string;
  repoId: string;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function createCorpusFixture(
  baseRoot: string,
  corpusName: string,
  fixture: FixtureQueryInput
): Promise<string> {
  const corpusRoot = join(baseRoot, corpusName);
  const evalRoot = join(corpusRoot, 'repos', fixture.repoId, '.librainian-eval');
  await mkdir(evalRoot, { recursive: true });

  await writeJson(join(evalRoot, 'manifest.json'), {
    repoId: fixture.repoId,
    name: `${fixture.repoId} fixture`,
    languages: ['TypeScript'],
    fileCount: 1,
    annotationLevel: 'full',
    characteristics: {
      documentationDensity: 'low',
      testCoverage: 'low',
      architecturalClarity: 'clear',
      codeQuality: 'clean',
    },
  });

  await writeJson(join(evalRoot, 'ground-truth.json'), {
    version: '0.1.0',
    repoId: fixture.repoId,
    queries: [
      {
        queryId: fixture.queryId,
        repoId: fixture.repoId,
        intent: `Explain ${fixture.queryId}`,
        category: 'structural',
        difficulty: 'trivial',
        correctAnswer: {
          summary: 'Fixture summary',
          mustIncludeFiles: ['src/index.ts'],
          shouldIncludeFiles: [],
          mustIncludeFacts: ['Fixture fact'],
          mustNotClaim: [],
          acceptableVariations: [],
          evidenceRefs: [],
        },
        lastVerified: '2026-01-26',
        verifiedBy: 'fixture',
      },
    ],
  });

  return corpusRoot;
}

describe('EvalRunner multi-corpus support', () => {
  it('merges multiple corpora and keeps corpusId per query', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'eval-corpus-multi-'));

    try {
      const devCorpus = await createCorpusFixture(tmpRoot, 'dev-corpus', {
        repoId: 'repo-dev',
        queryId: 'query-dev',
      });
      const holdoutCorpus = await createCorpusFixture(tmpRoot, 'holdout-corpus', {
        repoId: 'repo-holdout',
        queryId: 'query-holdout',
      });

      const seen: Array<{ queryId: string; corpusId?: string; repoRoot: string }> = [];

      const pipeline: EvalPipeline = {
        retrieve: async ({ query, repoRoot }) => {
          seen.push({ queryId: query.queryId, corpusId: query.corpusId, repoRoot });
          return { docs: query.correctAnswer.mustIncludeFiles };
        },
      };

      const runner = createEvalRunner({
        pipeline,
        clock: fixedClock,
        runIdFactory: () => 'eval_multi',
      });

      const report = await runner.evaluate({
        corpusPath: devCorpus,
        corpusPaths: [devCorpus, holdoutCorpus],
      });

      expect(report.queryCount).toBe(2);
      expect(seen.map((entry) => entry.queryId).sort()).toEqual([
        'query-dev',
        'query-holdout',
      ]);

      const corpusIds = new Set(seen.map((entry) => entry.corpusId));
      expect(corpusIds).toEqual(new Set(['dev-corpus', 'holdout-corpus']));

      for (const entry of seen) {
        expect(entry.corpusId).toBeTruthy();
        expect(entry.repoRoot).toContain(entry.queryId.includes('dev') ? 'repo-dev' : 'repo-holdout');
      }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('uses corpusPath when corpusPaths are not provided', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'eval-corpus-single-'));

    try {
      const soloCorpus = await createCorpusFixture(tmpRoot, 'solo-corpus', {
        repoId: 'repo-solo',
        queryId: 'query-solo',
      });

      const seen: Array<{ corpusId?: string }> = [];

      const pipeline: EvalPipeline = {
        retrieve: async ({ query }) => {
          seen.push({ corpusId: query.corpusId });
          return { docs: query.correctAnswer.mustIncludeFiles };
        },
      };

      const runner = createEvalRunner({
        pipeline,
        clock: fixedClock,
        runIdFactory: () => 'eval_single',
      });

      const report = await runner.evaluate({ corpusPath: soloCorpus });

      expect(report.queryCount).toBe(1);
      expect(seen.length).toBe(1);
      expect(seen[0]?.corpusId).toBe(basename(soloCorpus));
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
