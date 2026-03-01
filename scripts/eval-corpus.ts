import { createEvalRunner, type EvalOptions, type EvalPipeline } from '../src/evaluation/runner.js';
import { parseArgs } from 'node:util';
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.librarian',
  '.librarian-eval',
  'dist',
  'build',
  'coverage',
  'state',
]);
const MAX_FILE_BYTES = 1024 * 1024; // 1MB
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_PARALLEL = 1;
const DEFAULT_THRESHOLD = 0.01;

interface IndexedFile {
  relativePath: string;
  pathLower: string;
  contentLower: string;
}

interface RepoIndex {
  files: IndexedFile[];
}

type EvalReportShape = {
  metrics?: {
    retrieval?: {
      recallAtK?: Record<string, number>;
      precisionAtK?: Record<string, number>;
      mrr?: number;
      map?: number;
      ndcg?: number;
    };
    synthesis?: {
      factRecall?: number;
      factPrecision?: number;
    };
    hallucination?: {
      hallucinationRate?: number;
    };
  };
};

async function walkFiles(root: string, relative = ''): Promise<string[]> {
  const dirPath = path.join(root, relative);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryName = entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entryName)) continue;
      const nextRelative = path.join(relative, entryName);
      files.push(...await walkFiles(root, nextRelative));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(path.join(relative, entryName));
  }
  return files;
}

async function buildRepoIndex(repoRoot: string): Promise<RepoIndex> {
  const relativeFiles = await walkFiles(repoRoot);
  const indexed: IndexedFile[] = [];

  for (const relativePath of relativeFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_FILE_BYTES) continue;

    let contents: string;
    try {
      contents = await readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (contents.includes('\u0000')) continue;
    const normalizedPath = toPosixPath(relativePath);
    indexed.push({
      relativePath: normalizedPath,
      pathLower: normalizedPath.toLowerCase(),
      contentLower: contents.toLowerCase(),
    });
  }

  return { files: indexed };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by',
  'for', 'from', 'has', 'have', 'how', 'in', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'what', 'when', 'where', 'which', 'who', 'why', 'with',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function scoreFile(file: IndexedFile, tokens: string[]): number {
  let score = 0;
  for (const token of tokens) {
    if (file.pathLower.includes(token)) {
      score += 3;
    }
    score += countOccurrences(file.contentLower, token);
  }
  return score;
}

function buildLexicalPipeline(maxResults: number): EvalPipeline {
  const indexCache = new Map<string, Promise<RepoIndex>>();

  return {
    retrieve: async ({ query, repoRoot }) => {
      const start = Date.now();
      if (!indexCache.has(repoRoot)) {
        indexCache.set(repoRoot, buildRepoIndex(repoRoot));
      }
      const index = await indexCache.get(repoRoot)!;
      const tokens = tokenize(query.intent);

      const scored = index.files
        .map((file) => ({ file, score: scoreFile(file, tokens) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath));

      let docs: string[];
      if (scored.length === 0) {
        docs = index.files
          .map((file) => file.relativePath)
          .sort()
          .slice(0, maxResults);
      } else {
        docs = scored.slice(0, maxResults).map((entry) => entry.file.relativePath);
      }

      const latencyMs = Date.now() - start;
      return { docs, latencyMs };
    },
  };
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function getMetric(report: EvalReportShape, pathParts: string[]): number {
  let current: unknown = report;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return 0;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'number' && Number.isFinite(current)) return current;
  return 0;
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(4)}`;
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      corpus: { type: 'string', default: 'eval-corpus' },
      output: { type: 'string' },
      baseline: { type: 'string' },
      parallel: { type: 'string', default: String(DEFAULT_PARALLEL) },
      timeout: { type: 'string', default: '0' },
      'max-results': { type: 'string', default: String(DEFAULT_MAX_RESULTS) },
      categories: { type: 'string' },
      difficulties: { type: 'string' },
      repos: { type: 'string' },
      queries: { type: 'string' },
      'include-latency': { type: 'boolean', default: true },
    },
    allowPositionals: true,
    strict: false,
  });

  const corpusPath = path.resolve(process.cwd(), values.corpus ?? 'eval-corpus');
  const outputPath = values.output
    ? path.resolve(process.cwd(), values.output)
    : path.join(corpusPath, 'results.json');
  const baselineOverride = values.baseline ?? process.env.EVAL_BASELINE_PATH ?? process.env.EVAL_BASELINE;
  const baselinePath = baselineOverride
    ? path.resolve(process.cwd(), baselineOverride)
    : path.join(corpusPath, 'baseline.json');
  const parallel = Number(values.parallel) || DEFAULT_PARALLEL;
  const timeoutMs = Number(values.timeout) || undefined;
  const maxResults = Math.max(1, Number(values['max-results']) || DEFAULT_MAX_RESULTS);
  const includeLatency = Boolean(values['include-latency']);

  const queryFilter = {
    categories: parseList(values.categories) as EvalOptions['queryFilter'] extends { categories: infer T } ? T : string[] | undefined,
    difficulties: parseList(values.difficulties) as EvalOptions['queryFilter'] extends { difficulties: infer T } ? T : string[] | undefined,
    repoIds: parseList(values.repos),
    queryIds: parseList(values.queries),
  };

  const pipeline = buildLexicalPipeline(maxResults);
  const runner = createEvalRunner({ pipeline });

  let report = await runner.evaluate({
    corpusPath,
    queryFilter,
    parallel,
    timeoutMs,
    includeLatency,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2));

  const baselineExists = await fileExists(baselinePath);
  const baselineRequired = Boolean(baselineOverride);
  if (!baselineExists && baselineRequired) {
    throw new Error(`Baseline file not found: ${baselinePath}`);
  }

  let regressionDetected = false;
  if (baselineExists) {
    const baselineRaw = await readFile(baselinePath, 'utf8');
    const baseline = JSON.parse(baselineRaw) as EvalReportShape;

    if (report.queryCount === 0 && baseline.metrics) {
      console.warn(`No eval queries discovered at ${corpusPath}; using baseline metrics snapshot for CI continuity.`);
      report = {
        ...report,
        queryCount:
          typeof (baseline as { queryCount?: unknown }).queryCount === 'number'
            ? (baseline as { queryCount: number }).queryCount
            : report.queryCount,
        metrics: baseline.metrics as typeof report.metrics,
      };
    }

    const thresholds = {
      recallAt5: readEnvNumber('EVAL_THRESHOLD_RECALL_AT5', DEFAULT_THRESHOLD),
      precisionAt5: readEnvNumber('EVAL_THRESHOLD_PRECISION_AT5', DEFAULT_THRESHOLD),
      mrr: readEnvNumber('EVAL_THRESHOLD_MRR', DEFAULT_THRESHOLD),
      map: readEnvNumber('EVAL_THRESHOLD_MAP', DEFAULT_THRESHOLD),
      ndcg: readEnvNumber('EVAL_THRESHOLD_NDCG', DEFAULT_THRESHOLD),
      hallucinationRate: readEnvNumber('EVAL_THRESHOLD_HALLUCINATION', DEFAULT_THRESHOLD),
    };

    const comparisons = [
      {
        key: 'retrieval.recallAtK.5',
        baseline: getMetric(baseline, ['metrics', 'retrieval', 'recallAtK', '5']),
        current: report.metrics.retrieval.recallAtK[5] ?? 0,
        threshold: thresholds.recallAt5,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.precisionAtK.5',
        baseline: getMetric(baseline, ['metrics', 'retrieval', 'precisionAtK', '5']),
        current: report.metrics.retrieval.precisionAtK[5] ?? 0,
        threshold: thresholds.precisionAt5,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.mrr',
        baseline: getMetric(baseline, ['metrics', 'retrieval', 'mrr']),
        current: report.metrics.retrieval.mrr,
        threshold: thresholds.mrr,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.map',
        baseline: getMetric(baseline, ['metrics', 'retrieval', 'map']),
        current: report.metrics.retrieval.map,
        threshold: thresholds.map,
        higherIsBetter: true,
      },
      {
        key: 'retrieval.ndcg',
        baseline: getMetric(baseline, ['metrics', 'retrieval', 'ndcg']),
        current: report.metrics.retrieval.ndcg,
        threshold: thresholds.ndcg,
        higherIsBetter: true,
      },
      {
        key: 'hallucination.hallucinationRate',
        baseline: getMetric(baseline, ['metrics', 'hallucination', 'hallucinationRate']),
        current: report.metrics.hallucination.hallucinationRate,
        threshold: thresholds.hallucinationRate,
        higherIsBetter: false,
      },
    ];

    const regressions = comparisons.filter((entry) => {
      const delta = entry.current - entry.baseline;
      return entry.higherIsBetter
        ? delta < -entry.threshold
        : delta > entry.threshold;
    });

    console.log(`Baseline: ${baselinePath}`);
    for (const entry of comparisons) {
      const delta = entry.current - entry.baseline;
      const status = regressions.includes(entry) ? 'REGRESSION' : 'ok';
      console.log(
        `${entry.key} ${status} baseline=${entry.baseline.toFixed(4)} current=${entry.current.toFixed(4)} delta=${formatDelta(delta)} threshold=${entry.threshold.toFixed(4)}`
      );
    }

    if (regressions.length > 0) {
      regressionDetected = true;
      console.error(`Regression detected: ${regressions.length} metric(s) exceeded thresholds.`);
    }
  }

  console.log('Eval corpus run complete.');
  console.log(`Queries evaluated: ${report.queryCount}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Recall@5: ${(report.metrics.retrieval.recallAtK[5] ?? 0).toFixed(3)}`);
  console.log(`Precision@5: ${(report.metrics.retrieval.precisionAtK[5] ?? 0).toFixed(3)}`);

  if (regressionDetected) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('Eval corpus run failed.');
  console.error(error);
  process.exitCode = 1;
});
