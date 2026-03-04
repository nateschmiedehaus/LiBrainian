import { parseArgs } from 'node:util';
import { runLcibBenchmark, writeBenchmarkReport } from '../src/evaluation/lcib.js';

const args = parseArgs({
  options: {
    repos: { type: 'string' },
    maxQueries: { type: 'string' },
    checkoutRoot: { type: 'string' },
    resultsRoot: { type: 'string' },
    skipGit: { type: 'boolean' },
    dryRun: { type: 'boolean' },
  },
});

const repoFilter = args.values.repos
  ? args.values.repos.split(',').map((value) => value.trim()).filter(Boolean)
  : undefined;
const maxQueries = args.values.maxQueries ? Number(args.values.maxQueries) : undefined;
const checkoutRoot = args.values.checkoutRoot ?? undefined;
const resultsRoot = args.values.resultsRoot ?? undefined;
const skipGitUpdates = Boolean(args.values.skipGit);
const dryRun = Boolean(args.values.dryRun);

const report = await runLcibBenchmark({
  repoFilter,
  maxQueriesPerRepo: maxQueries,
  checkoutRoot,
  resultsRoot,
  skipGitUpdates,
  dryRun,
  logger: (message, details) => {
    // eslint-disable-next-line no-console
    console.log(`[lcib:${message}]`, details ?? '');
  },
});

const { latestPath, versionedPath } = await writeBenchmarkReport(report, { resultsRoot });

const summary = report.repoResults.map((repo) => ({
  repoId: repo.repoId,
  status: repo.status,
  queryCount: repo.metrics?.queryCount ?? 0,
  precisionAt5: repo.metrics?.precisionAt5 ?? 0,
  recallAt10: repo.metrics?.recallAt10 ?? 0,
  mrr: repo.metrics?.mrr ?? 0,
}));

// eslint-disable-next-line no-console
console.log(JSON.stringify({
  latestPath,
  versionedPath,
  summary,
}, null, 2));
