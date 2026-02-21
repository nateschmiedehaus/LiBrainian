import path from 'node:path';
import { parseArgs } from 'node:util';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

type Metric = {
  mean: number;
  target: number;
  met: boolean;
};

type RefreshResult = {
  reposUsed: number;
  selectedRepos: string[];
  totalQueries: number;
  unanswerableQueries: number;
  metrics: {
    timestamp: string;
    corpus_size: number;
    metrics: {
      retrieval_recall_at_5: Metric;
      context_precision: Metric;
      hallucination_rate: Metric;
      faithfulness: Metric;
      answer_relevancy: Metric;
    };
    targets_met: boolean;
    summary: string[];
  };
};

type RepoManifest = {
  repos?: Array<{ name?: string }>;
};

const TARGETS = {
  retrieval_recall_at_5: 0.8,
  context_precision: 0.7,
  hallucination_rate: 0.05,
  faithfulness: 0.85,
  answer_relevancy: 0.75,
} as const;

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function createMetric(mean: number, target: number, isMaxTarget = false): Metric {
  return {
    mean,
    target,
    met: isMaxTarget ? mean <= target : mean >= target,
  };
}

async function existsDir(dirPath: string): Promise<boolean> {
  try {
    const directory = await stat(dirPath);
    return directory.isDirectory();
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspaceRoot: { type: 'string' },
      reposRoot: { type: 'string' },
      repoNames: { type: 'string' },
      minRepos: { type: 'string' },
      maxRepos: { type: 'string' },
      maxSourceFilesPerRepo: { type: 'string' },
      maxQueriesPerRepo: { type: 'string' },
      reportPath: { type: 'string' },
      evalOutputPath: { type: 'string' },
      gatesPath: { type: 'string' },
    },
  });

  const workspaceRoot = path.resolve(values.workspaceRoot ?? process.cwd());
  const reposRoot = path.resolve(values.reposRoot ?? path.join(workspaceRoot, 'eval-corpus', 'external-repos'));
  const minRepos = Math.max(1, values.minRepos ? Number(values.minRepos) : 10);
  const maxRepos = values.maxRepos ? Number(values.maxRepos) : minRepos;
  const maxSourceFilesPerRepo = values.maxSourceFilesPerRepo ? Number(values.maxSourceFilesPerRepo) : 20;
  const maxQueriesPerRepo = values.maxQueriesPerRepo ? Number(values.maxQueriesPerRepo) : 40;
  const reportPath = path.resolve(values.reportPath ?? path.join(workspaceRoot, 'eval-results', 'metrics-report.json'));
  const evalOutputPath = path.resolve(values.evalOutputPath ?? path.join(workspaceRoot, 'eval-results', 'external-corpus-results.json'));
  const gatesPath = path.resolve(values.gatesPath ?? path.join(workspaceRoot, 'docs', 'librarian', 'GATES.json'));

  const requestedNames = parseCsv(values.repoNames);
  let selectedNames: string[];

  if (requestedNames.length > 0) {
    selectedNames = requestedNames;
  } else {
    const manifestPath = path.join(reposRoot, 'manifest.json');
    const manifestRaw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as RepoManifest;
    selectedNames = (manifest.repos ?? [])
      .map((repo) => repo.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .slice(0, maxRepos);
  }

  selectedNames = selectedNames.slice(0, maxRepos);
  const existingNames: string[] = [];
  for (const repoName of selectedNames) {
    if (await existsDir(path.join(reposRoot, repoName))) {
      existingNames.push(repoName);
    }
  }

  if (existingNames.length < minRepos) {
    throw new Error(`Need at least ${minRepos} repos, but only ${existingNames.length} selected repos exist on disk.`);
  }

  const runRoot = path.join(workspaceRoot, 'state', 'eval', 'external-corpus-batch', 'runs');
  await mkdir(runRoot, { recursive: true });

  const perRepoResults: RefreshResult[] = [];
  for (const repoName of existingNames) {
    const resultPath = path.join(runRoot, `${repoName}.json`);
    const perRepoReportPath = path.join(runRoot, `${repoName}.metrics.json`);
    const perRepoEvalOutputPath = path.join(runRoot, `${repoName}.eval.json`);

    const args = [
      'scripts/run-with-tmpdir.mjs',
      '--',
      'tsx',
      'scripts/refresh-external-eval-corpus.ts',
      '--workspaceRoot', workspaceRoot,
      '--reposRoot', reposRoot,
      '--repoNames', repoName,
      '--minRepos', '1',
      '--maxRepos', '1',
      '--maxSourceFilesPerRepo', String(maxSourceFilesPerRepo),
      '--maxQueriesPerRepo', String(maxQueriesPerRepo),
      '--reportPath', perRepoReportPath,
      '--evalOutputPath', perRepoEvalOutputPath,
      '--resultPath', resultPath,
      '--skipGates',
    ];

    const child = spawnSync('node', args, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=6144',
      },
    });

    if (child.status !== 0) {
      const stderr = child.stderr?.trim() || child.stdout?.trim() || `child_exit_${child.status}`;
      throw new Error(`Batched refresh failed for ${repoName}: ${stderr}`);
    }

    const resultRaw = await readFile(resultPath, 'utf8');
    perRepoResults.push(JSON.parse(resultRaw) as RefreshResult);
  }

  const totalCorpusSize = perRepoResults.reduce((sum, result) => sum + result.metrics.corpus_size, 0);
  const weighted = (selector: (result: RefreshResult) => number): number => {
    if (totalCorpusSize <= 0) return 0;
    const weightedTotal = perRepoResults.reduce(
      (sum, result) => sum + (selector(result) * result.metrics.corpus_size),
      0
    );
    return weightedTotal / totalCorpusSize;
  };

  const now = new Date().toISOString();
  const aggregatedMetrics = {
    retrieval_recall_at_5: createMetric(weighted((result) => result.metrics.metrics.retrieval_recall_at_5.mean), TARGETS.retrieval_recall_at_5),
    context_precision: createMetric(weighted((result) => result.metrics.metrics.context_precision.mean), TARGETS.context_precision),
    hallucination_rate: createMetric(weighted((result) => result.metrics.metrics.hallucination_rate.mean), TARGETS.hallucination_rate, true),
    faithfulness: createMetric(weighted((result) => result.metrics.metrics.faithfulness.mean), TARGETS.faithfulness),
    answer_relevancy: createMetric(weighted((result) => result.metrics.metrics.answer_relevancy.mean), TARGETS.answer_relevancy),
  };

  const metricsReport = {
    timestamp: now,
    corpus_size: totalCorpusSize,
    metrics: {
      retrieval_recall_at_5: { ...aggregatedMetrics.retrieval_recall_at_5, ci_95: [aggregatedMetrics.retrieval_recall_at_5.mean, aggregatedMetrics.retrieval_recall_at_5.mean], samples: [aggregatedMetrics.retrieval_recall_at_5.mean] },
      context_precision: { ...aggregatedMetrics.context_precision, ci_95: [aggregatedMetrics.context_precision.mean, aggregatedMetrics.context_precision.mean], samples: [aggregatedMetrics.context_precision.mean] },
      hallucination_rate: { ...aggregatedMetrics.hallucination_rate, ci_95: [aggregatedMetrics.hallucination_rate.mean, aggregatedMetrics.hallucination_rate.mean], samples: [aggregatedMetrics.hallucination_rate.mean] },
      faithfulness: { ...aggregatedMetrics.faithfulness, ci_95: [aggregatedMetrics.faithfulness.mean, aggregatedMetrics.faithfulness.mean], samples: [aggregatedMetrics.faithfulness.mean] },
      answer_relevancy: { ...aggregatedMetrics.answer_relevancy, ci_95: [aggregatedMetrics.answer_relevancy.mean, aggregatedMetrics.answer_relevancy.mean], samples: [aggregatedMetrics.answer_relevancy.mean] },
    },
    targets_met: Object.values(aggregatedMetrics).every((metric) => metric.met),
    summary: [
      `Batched external-corpus refresh over ${existingNames.length} repos.`,
      `Total evaluated queries: ${totalCorpusSize}.`,
    ],
  };

  const totals = {
    totalQueries: perRepoResults.reduce((sum, result) => sum + result.totalQueries, 0),
    unanswerableQueries: perRepoResults.reduce((sum, result) => sum + result.unanswerableQueries, 0),
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(metricsReport, null, 2)}\n`, 'utf8');
  await mkdir(path.dirname(evalOutputPath), { recursive: true });
  await writeFile(
    evalOutputPath,
    `${JSON.stringify({ timestamp: now, repos: existingNames, totals, perRepoResults }, null, 2)}\n`,
    'utf8'
  );

  const gatesRaw = await readFile(gatesPath, 'utf8');
  const gates = JSON.parse(gatesRaw) as { lastUpdated?: string; tasks?: Record<string, Record<string, unknown>> };
  const tasks = gates.tasks ?? {};
  const day = now.slice(0, 10);
  const corpusPass = existingNames.length >= minRepos && totals.unanswerableQueries > 0;
  const upsertTask = (key: string, updates: Record<string, unknown>) => {
    const current = tasks[key] ?? {};
    tasks[key] = { ...current, ...updates };
  };

  upsertTask('layer5.evalCorpus', {
    status: corpusPass ? 'pass' : 'fail',
    lastRun: day,
    note: `Batched refresh across ${existingNames.length} real external repos; includes ${totals.unanswerableQueries} unanswerable queries.`,
    blocking: !corpusPass,
    currentState: `${existingNames.length} real repos, ${totals.totalQueries} queries, ${totals.unanswerableQueries} unanswerable`,
    measured: {
      repos: existingNames.length,
      totalQueries: totals.totalQueries,
      unanswerableQueries: totals.unanswerableQueries,
      metricsPath: 'eval-results/metrics-report.json',
    },
  });
  upsertTask('layer5.externalRepos', {
    status: existingNames.length >= minRepos ? 'pass' : 'fail',
    lastRun: day,
    measured: existingNames.length,
    note: `${existingNames.length} external repos processed via batched refresh.`,
  });
  upsertTask('layer5.astFactExtractor', {
    status: totals.totalQueries > 0 ? 'pass' : 'fail',
    lastRun: day,
    measured: totals.totalQueries,
    note: 'AST facts generated via bounded per-repo batch refresh.',
  });
  upsertTask('layer5.retrievalRecall', {
    status: aggregatedMetrics.retrieval_recall_at_5.met ? 'pass' : 'fail',
    lastRun: day,
    measured: aggregatedMetrics.retrieval_recall_at_5.mean,
  });
  upsertTask('layer5.retrievalPrecision', {
    status: aggregatedMetrics.context_precision.met ? 'pass' : 'fail',
    lastRun: day,
    measured: aggregatedMetrics.context_precision.mean,
  });
  upsertTask('layer5.hallucinationRate', {
    status: aggregatedMetrics.hallucination_rate.met ? 'pass' : 'fail',
    lastRun: day,
    measured: aggregatedMetrics.hallucination_rate.mean,
  });

  gates.lastUpdated = now;
  gates.tasks = tasks;
  await writeFile(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    reposUsed: existingNames.length,
    selectedRepos: existingNames,
    totalQueries: totals.totalQueries,
    unanswerableQueries: totals.unanswerableQueries,
    reportPath,
    evalOutputPath,
    gatesPath,
    metrics: metricsReport,
  }, null, 2));
}

await run();
