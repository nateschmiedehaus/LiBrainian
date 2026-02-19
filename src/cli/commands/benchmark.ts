import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Librarian } from '../../api/librarian.js';
import { queryLibrarian } from '../../api/query.js';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { bootstrapProject, createBootstrapConfig, isBootstrapRequired } from '../../api/bootstrap.js';
import { detectLibrarianVersion } from '../../api/versioning.js';
import { createError } from '../errors.js';
import {
  PERFORMANCE_SLA,
  assessSlaMetric,
  classifyCodebaseSize,
  resolveFullIndexTargetMs,
  type SlaAssessment,
  type BenchmarkSlaStatus,
} from '../../performance/sla.js';

export type { BenchmarkSlaStatus };

export type BenchmarkFailOn = 'never' | 'alert' | 'block';

export interface BenchmarkCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface QueryBenchmarkStats {
  samples: number;
  coldStartMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface IndexBenchmarkStats {
  indexedFiles: number;
  sizeClass: 'small' | 'medium' | 'large';
  fullIndexDurationMs: number | null;
  incrementalFiles: number;
  incrementalDurationMs: number | null;
}

interface MemoryBenchmarkStats {
  peakIndexingRssMb: number | null;
  runtimeRssMb: number;
}

export interface PerformanceSlaReport {
  kind: 'PerformanceSLAReport.v1';
  generatedAt: string;
  workspace: string;
  budgets: {
    queryLatency: typeof PERFORMANCE_SLA.queryLatency;
    indexingThroughput: typeof PERFORMANCE_SLA.indexingThroughput;
    memoryBudget: typeof PERFORMANCE_SLA.memoryBudget;
    enforcement: typeof PERFORMANCE_SLA.enforcement;
  };
  measurements: {
    query: QueryBenchmarkStats;
    indexing: IndexBenchmarkStats;
    memory: MemoryBenchmarkStats;
  };
  assessments: SlaAssessment[];
  summary: {
    pass: number;
    alert: number;
    block: number;
    failOn: BenchmarkFailOn;
    failed: boolean;
  };
}

const BENCHMARK_INTENTS = [
  'authentication flow',
  'database schema and migrations',
  'mcp tool interfaces',
  'query pipeline',
  'indexing lifecycle',
  'provider readiness checks',
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

function toMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

function safeDurationMs(startedAt: Date | string | null, completedAt: Date | string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function buildMissingAssessment(metricId: string, target: number): SlaAssessment {
  return {
    metricId,
    status: 'alert',
    target,
    actual: target * 1.21,
    ratio: 1.21,
  };
}

function summarizeAssessments(assessments: SlaAssessment[]) {
  let pass = 0;
  let alert = 0;
  let block = 0;
  for (const assessment of assessments) {
    if (assessment.status === 'pass') pass += 1;
    if (assessment.status === 'alert') alert += 1;
    if (assessment.status === 'block') block += 1;
  }
  return { pass, alert, block };
}

export function shouldFailForThreshold(
  assessments: Array<{ status: BenchmarkSlaStatus }>,
  failOn: BenchmarkFailOn
): boolean {
  if (failOn === 'never') return false;
  if (failOn === 'alert') {
    return assessments.some((assessment) => assessment.status === 'alert' || assessment.status === 'block');
  }
  return assessments.some((assessment) => assessment.status === 'block');
}

async function ensureBootstrapForBenchmark(
  workspace: string,
  noBootstrap: boolean
): Promise<{
  dbPath: string;
  fullIndexDurationMs: number | null;
  indexedFiles: number;
}> {
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();
  try {
    const currentVersion = await detectLibrarianVersion(storage);
    const effectiveTier = currentVersion?.qualityTier ?? 'full';
    const bootstrapCheck = await isBootstrapRequired(workspace, storage, { targetQualityTier: effectiveTier });
    if (bootstrapCheck.required) {
      if (noBootstrap) {
        throw createError('NOT_BOOTSTRAPPED', bootstrapCheck.reason ?? 'Benchmark requires a bootstrapped index.');
      }
      const config = createBootstrapConfig(workspace, {
        bootstrapMode: 'fast',
        skipLlm: true,
        skipEmbeddings: true,
      });
      await bootstrapProject(config, storage);
    }

    const files = await storage.getFiles({});
    const report = await storage.getLastBootstrapReport();
    return {
      dbPath,
      fullIndexDurationMs: safeDurationMs(report?.startedAt ?? null, report?.completedAt ?? null),
      indexedFiles: files.length,
    };
  } finally {
    await storage.close();
  }
}

async function runQueryBenchmark(workspace: string, queryCount: number): Promise<QueryBenchmarkStats> {
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();
  try {
    const latencies: number[] = [];
    const samples = Math.max(1, queryCount);
    for (let i = 0; i < samples; i++) {
      const intent = BENCHMARK_INTENTS[i % BENCHMARK_INTENTS.length]!;
      const startedAt = Date.now();
      const response = await queryLibrarian(
        {
          intent,
          depth: 'L1',
          timeoutMs: 0,
          llmRequirement: 'disabled',
          disableMethodGuidance: true,
          disableCache: true,
          embeddingRequirement: 'optional',
        },
        storage,
      );
      const measured = response.latencyMs > 0 ? response.latencyMs : (Date.now() - startedAt);
      latencies.push(measured);
    }

    return {
      samples: latencies.length,
      coldStartMs: latencies[0] ?? 0,
      p50Ms: percentile(latencies, 0.50),
      p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99),
    };
  } finally {
    await storage.close();
  }
}

async function runIncrementalBenchmark(workspace: string, incrementalFiles: number): Promise<{
  durationMs: number | null;
  fileCount: number;
  peakRssMb: number | null;
}> {
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();
  let librarian: Librarian | null = null;
  try {
    const files = await storage.getFiles({ category: 'code', limit: Math.max(10, incrementalFiles * 5) });
    const samplePaths = files
      .map((file) => file.path)
      .filter((filePath) => typeof filePath === 'string' && filePath.length > 0)
      .slice(0, Math.max(1, incrementalFiles));

    if (samplePaths.length === 0) {
      return { durationMs: null, fileCount: 0, peakRssMb: null };
    }

    librarian = new Librarian({
      workspace,
      dbPath,
      autoBootstrap: false,
      autoWatch: false,
      disableLlmDiscovery: true,
      skipEmbeddings: true,
    });
    await librarian.initialize();

    let peakRssMb = toMb(process.memoryUsage().rss);
    const sampler = setInterval(() => {
      const rssMb = toMb(process.memoryUsage().rss);
      if (rssMb > peakRssMb) {
        peakRssMb = rssMb;
      }
    }, 25);

    const startedAt = Date.now();
    try {
      await librarian.reindexFiles(samplePaths);
    } finally {
      clearInterval(sampler);
    }

    return {
      durationMs: Date.now() - startedAt,
      fileCount: samplePaths.length,
      peakRssMb,
    };
  } finally {
    if (librarian) {
      await librarian.shutdown();
    }
    await storage.close();
  }
}

function printTextReport(report: PerformanceSlaReport): void {
  console.log('\n=== Performance SLA Benchmark ===\n');
  console.log(`Workspace: ${report.workspace}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Samples: query=${report.measurements.query.samples}, incrementalFiles=${report.measurements.indexing.incrementalFiles}`);
  console.log('');
  console.log('Query latency (ms):');
  console.log(`  cold-start: ${report.measurements.query.coldStartMs}`);
  console.log(`  p50: ${report.measurements.query.p50Ms}`);
  console.log(`  p95: ${report.measurements.query.p95Ms}`);
  console.log(`  p99: ${report.measurements.query.p99Ms}`);
  console.log('');
  console.log('Indexing throughput:');
  console.log(`  indexed files: ${report.measurements.indexing.indexedFiles} (${report.measurements.indexing.sizeClass})`);
  console.log(`  full index duration: ${report.measurements.indexing.fullIndexDurationMs ?? 'n/a'} ms`);
  console.log(`  incremental duration: ${report.measurements.indexing.incrementalDurationMs ?? 'n/a'} ms`);
  console.log('');
  console.log('Memory (RSS MB):');
  console.log(`  runtime: ${report.measurements.memory.runtimeRssMb.toFixed(1)}`);
  console.log(`  peak indexing: ${report.measurements.memory.peakIndexingRssMb?.toFixed(1) ?? 'n/a'}`);
  console.log('');
  console.log('SLA assessments:');
  for (const assessment of report.assessments) {
    console.log(`  [${assessment.status.toUpperCase()}] ${assessment.metricId}: actual=${assessment.actual.toFixed(2)} target=${assessment.target.toFixed(2)} ratio=${assessment.ratio.toFixed(2)}`);
  }
  console.log('');
}

function parseFailOn(raw: string | undefined): BenchmarkFailOn {
  if (raw === 'never' || raw === 'alert' || raw === 'block') {
    return raw;
  }
  return 'never';
}

export async function benchmarkCommand(options: BenchmarkCommandOptions): Promise<void> {
  const { workspace, args, rawArgs } = options;
  const commandArgs = args.length > 0 ? args : rawArgs.slice(1);
  const { values } = parseArgs({
    args: commandArgs,
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      queries: { type: 'string', default: '8' },
      'incremental-files': { type: 'string', default: '10' },
      'no-bootstrap': { type: 'boolean', default: false },
      'fail-on': { type: 'string', default: 'never' },
    },
    allowPositionals: true,
    strict: false,
  });

  const queryCount = Number.parseInt(String(values.queries ?? '8'), 10);
  const incrementalFiles = Number.parseInt(String(values['incremental-files'] ?? '10'), 10);
  if (!Number.isFinite(queryCount) || queryCount <= 0) {
    throw createError('INVALID_ARGUMENT', `Invalid --queries value "${String(values.queries ?? '')}"`);
  }
  if (!Number.isFinite(incrementalFiles) || incrementalFiles <= 0) {
    throw createError('INVALID_ARGUMENT', `Invalid --incremental-files value "${String(values['incremental-files'] ?? '')}"`);
  }

  const failOn = parseFailOn(typeof values['fail-on'] === 'string' ? values['fail-on'] : undefined);
  const outputJson = Boolean(values.json);
  const outputPath = typeof values.out === 'string' && values.out.trim().length > 0
    ? values.out.trim()
    : undefined;
  const noBootstrap = Boolean(values['no-bootstrap']);

  const bootstrap = await ensureBootstrapForBenchmark(workspace, noBootstrap);
  const query = await runQueryBenchmark(workspace, queryCount);
  const incremental = await runIncrementalBenchmark(workspace, incrementalFiles);
  const runtimeRssMb = toMb(process.memoryUsage().rss);

  const fullIndexTargetMs = resolveFullIndexTargetMs(bootstrap.indexedFiles);
  const assessments: SlaAssessment[] = [
    assessSlaMetric('query.p50', PERFORMANCE_SLA.queryLatency.p50Ms, query.p50Ms),
    assessSlaMetric('query.p95', PERFORMANCE_SLA.queryLatency.p95Ms, query.p95Ms),
    assessSlaMetric('query.p99', PERFORMANCE_SLA.queryLatency.p99Ms, query.p99Ms),
    assessSlaMetric('query.cold_start', PERFORMANCE_SLA.queryLatency.coldStartMs, query.coldStartMs),
    bootstrap.fullIndexDurationMs === null
      ? buildMissingAssessment('index.full', fullIndexTargetMs)
      : assessSlaMetric('index.full', fullIndexTargetMs, bootstrap.fullIndexDurationMs),
    incremental.durationMs === null
      ? buildMissingAssessment('index.incremental_10_files', PERFORMANCE_SLA.indexingThroughput.incremental10FilesMs)
      : assessSlaMetric('index.incremental_10_files', PERFORMANCE_SLA.indexingThroughput.incremental10FilesMs, incremental.durationMs),
    assessSlaMetric('memory.runtime_rss_mb', PERFORMANCE_SLA.memoryBudget.runtimeServingMb, runtimeRssMb),
    incremental.peakRssMb === null
      ? buildMissingAssessment('memory.peak_indexing_rss_mb', PERFORMANCE_SLA.memoryBudget.peakIndexingMb)
      : assessSlaMetric('memory.peak_indexing_rss_mb', PERFORMANCE_SLA.memoryBudget.peakIndexingMb, incremental.peakRssMb),
  ];

  const summary = summarizeAssessments(assessments);
  const failed = shouldFailForThreshold(assessments, failOn);
  const report: PerformanceSlaReport = {
    kind: 'PerformanceSLAReport.v1',
    generatedAt: new Date().toISOString(),
    workspace,
    budgets: {
      queryLatency: PERFORMANCE_SLA.queryLatency,
      indexingThroughput: PERFORMANCE_SLA.indexingThroughput,
      memoryBudget: PERFORMANCE_SLA.memoryBudget,
      enforcement: PERFORMANCE_SLA.enforcement,
    },
    measurements: {
      query,
      indexing: {
        indexedFiles: bootstrap.indexedFiles,
        sizeClass: classifyCodebaseSize(bootstrap.indexedFiles),
        fullIndexDurationMs: bootstrap.fullIndexDurationMs,
        incrementalFiles: incremental.fileCount,
        incrementalDurationMs: incremental.durationMs,
      },
      memory: {
        peakIndexingRssMb: incremental.peakRssMb,
        runtimeRssMb,
      },
    },
    assessments,
    summary: {
      ...summary,
      failOn,
      failed,
    },
  };

  if (outputJson) {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (!outputPath) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const resolvedOut = path.resolve(outputPath);
      await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
      await fs.writeFile(resolvedOut, json, 'utf8');
      process.stderr.write(`JSON written to ${resolvedOut}\n`);
    }
  } else {
    printTextReport(report);
  }

  if (failed) {
    throw createError(
      'QUERY_FAILED',
      `Performance SLA exceeded at fail-on=${failOn}. blocks=${summary.block}, alerts=${summary.alert}`
    );
  }
}
