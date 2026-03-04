import { describe, it, expect } from 'vitest';
import { loadRepoConfigs, loadCorpusForRepo } from '../evaluation/benchmark_corpus/schema.js';
import {
  summarizeRepoMetrics,
  percentile,
  normalizeRepoPath,
  type QueryBenchmarkResult,
} from '../evaluation/lcib.js';

describe('LCIB corpus', () => {
  it('loads repo configs and corpora for each target repo', async () => {
    const configs = await loadRepoConfigs();
    expect(configs.repos).toHaveLength(3);

    for (const repo of configs.repos) {
      expect(repo.groundTruthFile.endsWith('.json')).toBe(true);
      const corpus = await loadCorpusForRepo(repo.id, undefined, configs);
      expect(corpus.repoId).toBe(repo.id);
      expect(corpus.queries.length).toBeGreaterThanOrEqual(10);
      const firstQuery = corpus.queries[0];
      expect(firstQuery.relevantFiles.length).toBeGreaterThan(0);
    }
  });
});

describe('LCIB metric helpers', () => {
  const sampleQueries: QueryBenchmarkResult[] = [
    {
      queryId: 'a',
      queryType: 'nav',
      query: 'one',
      precisionAt5: 0.4,
      recallAt10: 0.5,
      mrr: 1,
      retrievedFiles: ['a'],
      relevantFiles: ['a'],
      latencyMs: 100,
    },
    {
      queryId: 'b',
      queryType: 'nav',
      query: 'two',
      precisionAt5: 0.2,
      recallAt10: 0.3,
      mrr: 0.5,
      retrievedFiles: ['b'],
      relevantFiles: ['b'],
      latencyMs: 200,
    },
  ];

  it('summarizes repo metrics across queries', () => {
    const metrics = summarizeRepoMetrics(sampleQueries, sampleQueries.map((q) => q.latencyMs));
    expect(metrics.precisionAt5).toBeCloseTo(0.3);
    expect(metrics.recallAt10).toBeCloseTo(0.4);
    expect(metrics.mrr).toBeCloseTo(0.75);
    expect(metrics.latencyP50Ms).toBe(200);
    expect(metrics.latencyP95Ms).toBe(200);
    expect(metrics.queryCount).toBe(2);
  });

  it('computes percentile with stable rounding', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(30);
    expect(percentile([5, 15, 25], 0.99)).toBe(25);
  });

  it('normalizes repo-relative paths', () => {
    const repoRoot = '/tmp/work/django';
    expect(normalizeRepoPath('django/app/models.py', repoRoot)).toBe('django/app/models.py');
    expect(normalizeRepoPath('/tmp/work/django/django/app/models.py', repoRoot)).toBe('django/app/models.py');
    expect(normalizeRepoPath('./django/app/models.py', repoRoot)).toBe('django/app/models.py');
  });
});
