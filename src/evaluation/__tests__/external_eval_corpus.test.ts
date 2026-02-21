import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runExternalEvalCorpusRefresh } from '../external_eval_corpus.js';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('runExternalEvalCorpusRefresh', () => {
  it('refreshes external corpus metrics and updates layer5 gates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'librarian-external-eval-'));
    const reposRoot = path.join(root, 'eval-corpus', 'external-repos');
    const gatesPath = path.join(root, 'docs', 'librarian', 'GATES.json');
    const reportPath = path.join(root, 'eval-results', 'metrics-report.json');

    await writeJson(path.join(reposRoot, 'manifest.json'), {
      repos: [
        {
          name: 'repo-one',
          remote: 'https://github.com/example/repo-one.git',
          language: 'javascript',
          verifiedAt: '2026-02-21',
        },
        {
          name: 'repo-two',
          remote: 'https://github.com/example/repo-two.git',
          language: 'javascript',
          verifiedAt: '2026-02-21',
        },
      ],
    });

    for (const repo of ['repo-one', 'repo-two']) {
      const repoRoot = path.join(reposRoot, repo);
      await mkdir(path.join(repoRoot, '.git'), { recursive: true });
      await writeFile(
        path.join(repoRoot, 'index.js'),
        `export function ${repo.replace('-', '_')}(name) { return \`hello ${repo} \${name}\`; }\n`,
        'utf8'
      );
    }

    await writeJson(gatesPath, {
      tasks: {
        'layer5.evalCorpus': { status: 'invalid' },
        'layer5.externalRepos': { status: 'queued' },
        'layer5.astFactExtractor': { status: 'not_started' },
        'layer5.retrievalRecall': { status: 'not_measured' },
        'layer5.retrievalPrecision': { status: 'not_measured' },
        'layer5.hallucinationRate': { status: 'not_measured' },
      },
    });

    const result = await runExternalEvalCorpusRefresh({
      workspaceRoot: root,
      reposRoot,
      minRepos: 2,
      maxRepos: 2,
      reportPath,
      gatesPath,
    });

    expect(result.reposUsed).toBe(2);
    expect(result.unanswerableQueries).toBeGreaterThan(0);
    expect(result.metrics.targets_met).toBeTypeOf('boolean');

    const metricsRaw = await readFile(reportPath, 'utf8');
    const metrics = JSON.parse(metricsRaw) as {
      metrics: {
        retrieval_recall_at_5: { mean: number };
        context_precision: { mean: number };
      };
    };
    expect(metrics.metrics.retrieval_recall_at_5.mean).toBeGreaterThanOrEqual(0);
    expect(metrics.metrics.context_precision.mean).toBeGreaterThanOrEqual(0);

    const gatesRaw = await readFile(gatesPath, 'utf8');
    const gates = JSON.parse(gatesRaw) as {
      tasks: Record<string, { status: string; note?: string; measured?: unknown }>;
    };
    expect(gates.tasks['layer5.evalCorpus']?.status).toBe('pass');
    expect(String(gates.tasks['layer5.evalCorpus']?.note ?? '')).toContain('unanswerable');
  });
});
