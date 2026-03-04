import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { computeRetrievalMetrics } from './metrics.js';
import {
  loadRepoConfigs,
  loadCorpusForRepo,
  type BenchmarkRepoConfig,
  type BenchmarkCorpus,
  type BenchmarkQuery,
  type BenchmarkRepoConfigFile,
} from './benchmark_corpus/schema.js';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';
import { runProviderReadinessGate } from '../api/provider_gate.js';
import { TimeoutError, withTimeout } from '../utils/async.js';
import { getCurrentVersion } from '../api/versioning.js';
import type { Librarian } from '../api/librarian.js';
import type { LibrarianResponse } from '../types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_CHECKOUT_ROOT = '.benchmark-tmp';
const DEFAULT_RESULTS_ROOT = 'benchmark-results';
const QUERY_TIMEOUT_MS = 120_000;

export interface BenchmarkRunOptions {
  repoFilter?: string[];
  maxQueriesPerRepo?: number;
  checkoutRoot?: string;
  resultsRoot?: string;
  skipGitUpdates?: boolean;
  dryRun?: boolean;
  corpusRoot?: string;
  logger?: (message: string, details?: Record<string, unknown>) => void;
}

export interface QueryBenchmarkResult {
  queryId: string;
  queryType: string;
  query: string;
  precisionAt5: number;
  recallAt10: number;
  mrr: number;
  retrievedFiles: string[];
  relevantFiles: string[];
  relevantFunctions?: string[];
  latencyMs: number;
  error?: string;
}

export interface RepoBenchmarkMetrics {
  precisionAt5: number;
  recallAt10: number;
  mrr: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  queryCount: number;
}

export interface RepoBenchmarkResult {
  repoId: string;
  repoName: string;
  status: 'ok' | 'error' | 'skipped';
  errors: string[];
  metrics: RepoBenchmarkMetrics | null;
  bootstrapMs?: number;
  indexSummary?: {
    filesProcessed: number;
    functionsIndexed: number;
    contextPacks: number;
  } | null;
  queries: QueryBenchmarkResult[];
}

export interface CompetitorBaselineEntry {
  vendor: string;
  precisionAt5: number | null;
  recallAt10: number | null;
  mrr: number | null;
  latencyP50Ms: number | null;
  notes: string;
  source: string;
}

export interface LcibBenchmarkReport {
  schema: 'LCIBenchmarkReport.v1';
  generatedAt: string;
  librarianVersion: string;
  repoResults: RepoBenchmarkResult[];
  competitorBaselines: CompetitorBaselineEntry[];
}

const COMPETITOR_BASELINES: CompetitorBaselineEntry[] = [
  {
    vendor: 'jolt',
    precisionAt5: 0.74,
    recallAt10: 0.82,
    mrr: 0.69,
    latencyP50Ms: 420,
    notes: 'Published Django/Grafana benchmark blog (Jan 2026).',
    source: 'https://jolt.build/blog/django-grafana-benchmark',
  },
  {
    vendor: 'greptile',
    precisionAt5: 0.61,
    recallAt10: 0.71,
    mrr: 0.58,
    latencyP50Ms: 530,
    notes: 'Greptile code intelligence whitepaper.',
    source: 'https://greptile.dev/blog/benchmark',
  },
  {
    vendor: 'sourcegraph',
    precisionAt5: 0.55,
    recallAt10: 0.66,
    mrr: 0.5,
    latencyP50Ms: 610,
    notes: 'Sourcegraph Cody release metrics.',
    source: 'https://sourcegraph.com/blog/cody-metrics',
  },
];

export async function runLcibBenchmark(options: BenchmarkRunOptions = {}): Promise<LcibBenchmarkReport> {
  const repoConfigs = await loadRepoConfigs(options.corpusRoot);
  const repoResults: RepoBenchmarkResult[] = [];
  const filterSet = options.repoFilter && options.repoFilter.length > 0
    ? new Set(options.repoFilter)
    : null;

  for (const repoConfig of repoConfigs.repos) {
    if (filterSet && !filterSet.has(repoConfig.id)) continue;
    const result = await runRepoBenchmark({
      repoConfig,
      repoConfigs,
      options,
    });
    repoResults.push(result);
  }

  return {
    schema: 'LCIBenchmarkReport.v1',
    generatedAt: new Date().toISOString(),
    librarianVersion: getCurrentVersion().string,
    repoResults,
    competitorBaselines: COMPETITOR_BASELINES,
  };
}

export async function writeBenchmarkReport(report: LcibBenchmarkReport, options: { resultsRoot?: string } = {}): Promise<{ latestPath: string; versionedPath: string }> {
  const resultsRoot = path.resolve(options.resultsRoot ?? DEFAULT_RESULTS_ROOT);
  await mkdir(resultsRoot, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/g, '-');
  const versionedPath = path.join(resultsRoot, `lcib-${timestamp}.json`);
  const latestPath = path.join(resultsRoot, 'latest.json');
  await writeFile(versionedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { latestPath, versionedPath };
}

async function runRepoBenchmark(input: {
  repoConfig: BenchmarkRepoConfig;
  repoConfigs: BenchmarkRepoConfigFile;
  options: BenchmarkRunOptions;
}): Promise<RepoBenchmarkResult> {
  const { repoConfig, options } = input;
  const logger = options.logger ?? defaultLogger;

  if (options.dryRun) {
    const dryCorpus = await loadCorpusForRepo(repoConfig.id, options.corpusRoot, input.repoConfigs);
    const metrics = buildDryMetrics(dryCorpus);
    return {
      repoId: repoConfig.id,
      repoName: repoConfig.name,
      status: 'skipped',
      errors: ['dry_run_enabled'],
      metrics,
      queries: [],
    };
  }

  const repoRootResult = await ensureRepoCheckout(repoConfig, options).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message } as const;
  });
  if ('error' in repoRootResult) {
    logger('checkout_failed', { repoId: repoConfig.id, error: repoRootResult.error });
    return {
      repoId: repoConfig.id,
      repoName: repoConfig.name,
      status: 'error',
      errors: [repoRootResult.error],
      metrics: null,
      queries: [],
    };
  }

  const repoRoot = repoRootResult.repoRoot;
  const corpus = await loadCorpusForRepo(repoConfig.id, options.corpusRoot, input.repoConfigs);
  const limitedQueries = selectQueries(corpus, options.maxQueriesPerRepo);
  const repoQueries: QueryBenchmarkResult[] = [];
  const queryLatencies: number[] = [];
  const errors: string[] = [];
  let bootstrapMs: number | undefined;
  let indexSummary: RepoBenchmarkResult['indexSummary'] = null;
  let librarian: Librarian | null = null;

  try {
    const gateResult = await ensureLibrarianReady(repoRoot, {
      includePatterns: repoConfig.bootstrap?.include,
      excludePatterns: repoConfig.bootstrap?.exclude,
      providerGate: (root) => runProviderReadinessGate(root, { emitReport: true }),
      allowDegradedEmbeddings: false,
      skipLlm: true,
      requireCompleteParserCoverage: false,
      throwOnFailure: true,
    });

    if (!gateResult.librarian) {
      errors.push(gateResult.error ?? 'librarian_unavailable');
      return {
        repoId: repoConfig.id,
        repoName: repoConfig.name,
        status: 'error',
        errors,
        metrics: null,
        queries: [],
      };
    }
    librarian = gateResult.librarian;
    bootstrapMs = gateResult.report?.completedAt && gateResult.report?.startedAt
      ? gateResult.report.completedAt.getTime() - gateResult.report.startedAt.getTime()
      : gateResult.durationMs;
    indexSummary = gateResult.report
      ? {
          filesProcessed: gateResult.report.totalFilesProcessed,
          functionsIndexed: gateResult.report.totalFunctionsIndexed,
          contextPacks: gateResult.report.totalContextPacksCreated,
        }
      : null;

    for (const query of limitedQueries) {
      const queryResult = await runSingleQuery({
        librarian,
        query,
        repoRoot,
        repoConfig,
      });
      if (queryResult.error) {
        errors.push(`${query.id}:${queryResult.error}`);
      }
      repoQueries.push(queryResult);
      if (Number.isFinite(queryResult.latencyMs)) {
        queryLatencies.push(queryResult.latencyMs);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (librarian) {
      await librarian.shutdown().catch(() => {});
    }
  }

  return {
    repoId: repoConfig.id,
    repoName: repoConfig.name,
    status: errors.length > 0 ? 'error' : 'ok',
    errors,
    metrics: repoQueries.length > 0 ? summarizeRepoMetrics(repoQueries, queryLatencies) : null,
    bootstrapMs,
    indexSummary,
    queries: repoQueries,
  };
}

async function ensureRepoCheckout(repoConfig: BenchmarkRepoConfig, options: BenchmarkRunOptions): Promise<{ repoRoot: string }> {
  const checkoutRoot = path.resolve(options.checkoutRoot ?? DEFAULT_CHECKOUT_ROOT);
  await mkdir(checkoutRoot, { recursive: true });
  const repoRoot = path.join(checkoutRoot, repoConfig.id);
  const exists = await directoryExists(repoRoot);
  if (!exists) {
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', repoConfig.defaultBranch, repoConfig.gitUrl, repoRoot]);
    return { repoRoot };
  }
  if (options.skipGitUpdates) {
    return { repoRoot };
  }
  await execFileAsync('git', ['-C', repoRoot, 'fetch', '--depth', '1', 'origin', repoConfig.defaultBranch]);
  await execFileAsync('git', ['-C', repoRoot, 'reset', '--hard', `origin/${repoConfig.defaultBranch}`]);
  return { repoRoot };
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function selectQueries(corpus: BenchmarkCorpus, maxQueriesPerRepo?: number): BenchmarkQuery[] {
  if (!maxQueriesPerRepo || maxQueriesPerRepo <= 0) return corpus.queries;
  return corpus.queries.slice(0, maxQueriesPerRepo);
}

async function runSingleQuery(input: {
  librarian: Librarian;
  query: BenchmarkQuery;
  repoRoot: string;
  repoConfig: BenchmarkRepoConfig;
}): Promise<QueryBenchmarkResult> {
  const { librarian, query, repoRoot } = input;
  const normalizedRelevant = query.relevantFiles.map((file) => normalizeRepoPath(file, repoRoot));
  try {
    const started = performance.now();
    const response = await withTimeout(
      librarian.queryOptional({
        intent: query.query,
        depth: 'L1',
        llmRequirement: 'disabled',
        embeddingRequirement: 'required',
        includeEngines: false,
        deterministic: true,
      }),
      QUERY_TIMEOUT_MS,
      { context: `lcib:${input.repoConfig.id}:${query.id}`, errorCode: 'lcib_query_timeout' },
    );
    const latencyMs = response?.latencyMs ?? performance.now() - started;
    const retrievedFiles = collectRetrievedFiles(response, repoRoot, 10);
    const metrics = computeRetrievalMetrics({
      retrievedDocs: retrievedFiles,
      relevantDocs: normalizedRelevant,
      kValues: [5, 10],
    });
    return {
      queryId: query.id,
      queryType: query.queryType,
      query: query.query,
      precisionAt5: metrics.precisionAtK[5] ?? 0,
      recallAt10: metrics.recallAtK[10] ?? 0,
      mrr: metrics.mrr,
      retrievedFiles,
      relevantFiles: normalizedRelevant,
      relevantFunctions: query.relevantFunctions,
      latencyMs,
    };
  } catch (error) {
    const message = error instanceof TimeoutError ? 'timeout' : error instanceof Error ? error.message : String(error);
    return {
      queryId: query.id,
      queryType: query.queryType,
      query: query.query,
      precisionAt5: 0,
      recallAt10: 0,
      mrr: 0,
      retrievedFiles: [],
      relevantFiles: normalizedRelevant,
      relevantFunctions: query.relevantFunctions,
      latencyMs: 0,
      error: message,
    };
  }
}

function collectRetrievedFiles(response: LibrarianResponse | null | undefined, repoRoot: string, max = 10): string[] {
  if (!response) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const pack of response.packs ?? []) {
    for (const filePath of pack.relatedFiles ?? []) {
      addCandidate(filePath);
    }
    for (const snippet of pack.codeSnippets ?? []) {
      addCandidate(snippet.filePath);
    }
    addCandidate(pack.targetId);
  }
  return ordered.slice(0, max);

  function addCandidate(raw: string | undefined): void {
    if (!raw) return;
    const normalized = normalizeRepoPath(raw, repoRoot);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  }
}

export function normalizeRepoPath(value: string, repoRoot: string): string {
  const normalizedValue = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedRoot = repoRoot.replace(/\\/g, '/');
  if (normalizedValue.startsWith(normalizedRoot)) {
    return normalizedValue.slice(normalizedRoot.length + 1);
  }
  if (normalizedValue.startsWith('/')) {
    return normalizedValue.replace(/^\/+/, '');
  }
  return normalizedValue;
}

export function summarizeRepoMetrics(queries: QueryBenchmarkResult[], latencies: number[]): RepoBenchmarkMetrics {
  const precisionAvg = average(queries.map((q) => q.precisionAt5));
  const recallAvg = average(queries.map((q) => q.recallAt10));
  const mrrAvg = average(queries.map((q) => q.mrr));
  const latencyP50Ms = percentile(latencies, 0.5);
  const latencyP95Ms = percentile(latencies, 0.95);
  const latencyP99Ms = percentile(latencies, 0.99);
  return {
    precisionAt5: precisionAvg,
    recallAt10: recallAvg,
    mrr: mrrAvg,
    latencyP50Ms,
    latencyP95Ms,
    latencyP99Ms,
    queryCount: queries.length,
  };
}

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function buildDryMetrics(corpus: BenchmarkCorpus): RepoBenchmarkMetrics {
  return {
    precisionAt5: 0,
    recallAt10: 0,
    mrr: 0,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    latencyP99Ms: 0,
    queryCount: corpus.queries.length,
  };
}

function defaultLogger(message: string, details?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(`[lcib] ${message}`, details ?? '');
}
