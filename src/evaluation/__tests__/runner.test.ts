/**
 * @fileoverview Tests for EvalRunner
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import {
  createEvalRunner,
  type EvalPipeline,
  type GroundTruthQuery,
  type EvalReport,
  type EvalMetrics,
} from '../runner.js';

const corpusPath = resolve(process.cwd(), 'eval-corpus');
const fixedClock = () => new Date('2026-01-26T00:00:00.000Z');

function loadRepoQueries(repoId: string): GroundTruthQuery[] {
  const groundTruthPath = join(
    corpusPath,
    'repos',
    repoId,
    '.librarian-eval',
    'ground-truth.json'
  );
  const payload = JSON.parse(readFileSync(groundTruthPath, 'utf8')) as {
    queries?: GroundTruthQuery[];
  };
  return payload.queries ?? [];
}

describe('EvalRunner', () => {
  it('produces deterministic report structure', async () => {
    const pipeline: EvalPipeline = {
      retrieve: async ({ query }) => ({
        docs: [
          ...query.correctAnswer.mustIncludeFiles,
          ...query.correctAnswer.shouldIncludeFiles,
        ],
        latencyMs: 5,
      }),
      synthesize: async ({ query }) => ({
        answer: query.correctAnswer.summary,
        claims: [...query.correctAnswer.mustIncludeFacts],
        citations: query.correctAnswer.evidenceRefs.map((ref) => ({ refId: ref.refId })),
        latencyMs: 7,
      }),
    };

    const runner = createEvalRunner({
      pipeline,
      clock: fixedClock,
      runIdFactory: () => 'eval_test_run',
    });

    const report = await runner.evaluate({
      corpusPath,
      queryFilter: {
        repoIds: ['small-typescript'],
        categories: ['structural'],
      },
      includeLatency: true,
    });

    expect(report.runId).toBe('eval_test_run');
    expect(report.startedAt).toBe('2026-01-26T00:00:00.000Z');
    expect(report.queryResults.length).toBeGreaterThan(0);
    expect(report.metrics.retrieval.recallAtK[5]).toBeGreaterThanOrEqual(0);
    expect(report.metrics.synthesis.factRecall).toBe(1);
    expect(report.metrics.hallucination.hallucinationRate).toBe(0);
    expect(report.metrics.evidence.citationAccuracy).toBe(1);
    expect(report.metrics.byCategory).toHaveProperty('structural');
  });

  it('evaluates a single query with hallucination detection', async () => {
    const queries = loadRepoQueries('small-typescript');
    const query = queries.find((candidate) => candidate.correctAnswer.mustNotClaim.length > 0);
    expect(query).toBeDefined();
    if (!query) return;

    const pipeline: EvalPipeline = {
      retrieve: async () => ({
        docs: [...query.correctAnswer.mustIncludeFiles],
      }),
      synthesize: async () => ({
        answer: query.correctAnswer.mustNotClaim[0] ?? 'false claim',
        claims: [query.correctAnswer.mustNotClaim[0] ?? 'false claim'],
      }),
    };

    const runner = createEvalRunner({
      pipeline,
      clock: fixedClock,
      runIdFactory: () => 'eval_hallucination',
    });

    const result = await runner.evaluateQuery(query.queryId, { corpusPath });

    expect(result.synthesis?.hallucinationCount).toBe(1);
    expect(result.synthesis?.falseClaims.length).toBe(1);
  });

  it('compares runs for regressions', () => {
    const baseMetrics: EvalMetrics = {
      retrieval: {
        recallAtK: { 1: 0.9, 3: 0.9, 5: 0.9, 10: 0.9 },
        precisionAtK: { 1: 0.8, 3: 0.8, 5: 0.8, 10: 0.8 },
        mrr: 0.9,
        map: 0.9,
        ndcg: 0.9,
      },
      synthesis: {
        factPrecision: 0.9,
        factRecall: 0.9,
        summaryAccuracy: 0.9,
        consistencyScore: 0.9,
        structuralAccuracy: 0.9,
        behavioralAccuracy: 0.9,
      },
      hallucination: {
        hallucinationRate: 0.02,
        groundingRate: 0,
        fabricationRate: 0,
      },
      evidence: {
        citationAccuracy: 0,
        citationCompleteness: 0,
        evidenceRelevance: 0,
      },
      byCategory: {},
      byCodebaseType: {},
      byDifficulty: {},
    };

    const baseReport: EvalReport = {
      runId: 'baseline',
      startedAt: '2026-01-26T00:00:00.000Z',
      completedAt: '2026-01-26T00:00:00.000Z',
      corpusVersion: '0.1.0',
      options: { corpusPath },
      queryCount: 1,
      metrics: baseMetrics,
      queryResults: [],
    };

    const currentReport: EvalReport = {
      ...baseReport,
      runId: 'current',
      metrics: {
        ...baseMetrics,
        retrieval: {
          ...baseMetrics.retrieval,
          recallAtK: { ...baseMetrics.retrieval.recallAtK, 5: 0.6 },
        },
        hallucination: {
          ...baseMetrics.hallucination,
          hallucinationRate: 0.1,
        },
      },
    };

    const runner = createEvalRunner({
      pipeline: {
        retrieve: async () => ({ docs: [] }),
      },
    });

    const comparison = runner.compareRuns(baseReport, currentReport);

    expect(comparison.hasRegression).toBe(true);
    expect(comparison.recommendation).toBe('block');
  });

  it('loads eval corpus repos through directory symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runner-symlink-corpus-'));
    const corpusRoot = join(root, 'corpus');
    const reposRoot = join(corpusRoot, 'repos');
    const sourceRepoRoot = join(root, 'repo-source');
    const linkedRepoRoot = join(reposRoot, 'linked-repo');

    await mkdir(join(sourceRepoRoot, '.librarian-eval'), { recursive: true });
    await mkdir(join(sourceRepoRoot, 'src'), { recursive: true });
    await mkdir(reposRoot, { recursive: true });

    await writeFile(join(sourceRepoRoot, 'src', 'index.ts'), 'export const ok = true;\n', 'utf8');
    await writeFile(
      join(sourceRepoRoot, '.librarian-eval', 'manifest.json'),
      JSON.stringify({
        repoId: 'linked-repo',
        name: 'linked-repo',
        languages: ['typescript'],
        fileCount: 1,
        annotationLevel: 'sparse',
        characteristics: {
          documentationDensity: 'low',
          testCoverage: 'low',
          architecturalClarity: 'moderate',
          codeQuality: 'average',
        },
      }),
      'utf8'
    );
    await writeFile(
      join(sourceRepoRoot, '.librarian-eval', 'ground-truth.json'),
      JSON.stringify({
        version: '1.0.0',
        repoId: 'linked-repo',
        queries: [
          {
            queryId: 'q1',
            repoId: 'linked-repo',
            intent: 'What file defines ok?',
            category: 'structural',
            difficulty: 'trivial',
            correctAnswer: {
              summary: 'Expected answer: src/index.ts',
              mustIncludeFiles: ['src/index.ts'],
              shouldIncludeFiles: [],
              mustIncludeFacts: ['ok'],
              mustNotClaim: [],
              acceptableVariations: [],
              evidenceRefs: [],
            },
            lastVerified: '2026-02-21',
            verifiedBy: 'test',
          },
        ],
      }),
      'utf8'
    );

    await symlink(sourceRepoRoot, linkedRepoRoot, 'dir');

    const runner = createEvalRunner({
      pipeline: {
        retrieve: async () => ({ docs: ['src/index.ts'] }),
      },
      clock: fixedClock,
      runIdFactory: () => 'symlink_run',
    });

    const report = await runner.evaluate({
      corpusPath: corpusRoot,
      queryFilter: { repoIds: ['linked-repo'] },
    });

    expect(report.queryCount).toBe(1);
    expect(report.queryResults[0]?.repoId).toBe('linked-repo');
  });
});
