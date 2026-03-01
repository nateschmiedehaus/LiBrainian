import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { queryLibrarian } from '../src/api/query.js';
import { EmbeddingService } from '../src/api/embeddings.js';
import { createSqliteStorage } from '../src/storage/index.js';
import { summarizeLatencySamples, type QueryLatencySample } from '../src/evaluation/latency_summary.js';
import { parseProcessList, type ProcessEntry } from '../src/utils/process_guard.js';
import type { LibrarianQuery, LlmRequirement } from '../src/types.js';

type QueryPlan = {
  queryType: 'structural' | 'synthesis';
  intent: string;
  llmRequirement: LlmRequirement;
  depth: LibrarianQuery['depth'];
};

const DEFAULT_QUERY_PLAN: QueryPlan[] = [
  {
    queryType: 'structural',
    intent: 'Where is the CLI entry point and command registry?',
    llmRequirement: 'disabled',
    depth: 'L1',
  },
  {
    queryType: 'structural',
    intent: 'Show the storage sqlite implementation and initialization path.',
    llmRequirement: 'disabled',
    depth: 'L1',
  },
  {
    queryType: 'structural',
    intent: 'Find MCP server tool registration and dispatch flow.',
    llmRequirement: 'disabled',
    depth: 'L1',
  },
  {
    queryType: 'structural',
    intent: 'Locate evaluation runner and metric aggregation logic.',
    llmRequirement: 'disabled',
    depth: 'L1',
  },
  {
    queryType: 'synthesis',
    intent: 'Summarize how bootstrap, indexing, and query execution connect end to end.',
    llmRequirement: 'optional',
    depth: 'L2',
  },
  {
    queryType: 'synthesis',
    intent: 'What are the key reliability gates and where are they enforced?',
    llmRequirement: 'optional',
    depth: 'L2',
  },
  {
    queryType: 'synthesis',
    intent: 'Explain how evaluation evidence flows into status and gate reporting.',
    llmRequirement: 'optional',
    depth: 'L2',
  },
  {
    queryType: 'synthesis',
    intent: 'Describe major risk areas for release readiness in this codebase.',
    llmRequirement: 'optional',
    depth: 'L2',
  },
];

type BenchmarkSample = QueryLatencySample & {
  intent: string;
  runPhase: 'cold' | 'warm';
  ok: boolean;
  error?: string;
};

type ProcessHygieneSummary = {
  baselineCount: number;
  lingeringSpawnedCount: number;
  terminatedCount: number;
  failedToTerminateCount: number;
  lingering: ProcessEntry[];
  failedToTerminate: ProcessEntry[];
};

const execFileAsync = promisify(execFile);
const PROCESS_CLEANUP_SETTLE_MS = 250;
const WARM_QUERY_P50_SLO_MS = 500;
const COLD_QUERY_P95_SLO_MS = 2000;

type LatencySloSummary = {
  warmP50Passed: boolean;
  coldP95Passed: boolean;
  passed: boolean;
  targetsMs: {
    warmP50: number;
    coldP95: number;
  };
  actualMs: {
    warmP50: number;
    coldP95: number;
  };
};

function truncateErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isBootstrapOrQueryCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  const hasBootstrapOrQuery = normalized.includes(' bootstrap') || normalized.includes(' query');
  if (!hasBootstrapOrQuery) return false;
  return (
    normalized.includes('src/cli/index.ts')
    || normalized.includes('librainian')
    || normalized.includes('librarian')
  );
}

async function listBootstrapQueryProcesses(): Promise<ProcessEntry[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command=']);
  const entries = parseProcessList(stdout ?? '');
  return entries.filter((entry) => isBootstrapOrQueryCommand(entry.command));
}

async function cleanupLingeringBootstrapQueryProcesses(
  baselinePids: Set<number>,
): Promise<ProcessHygieneSummary> {
  await sleep(PROCESS_CLEANUP_SETTLE_MS);
  const active = await listBootstrapQueryProcesses();
  const lingering = active.filter((entry) => !baselinePids.has(entry.pid) && entry.pid !== process.pid);
  const failedToTerminate: ProcessEntry[] = [];

  for (const entry of lingering) {
    try {
      process.kill(entry.pid, 'SIGTERM');
    } catch {
      // Process likely already exited; verify below.
    }
  }

  await sleep(PROCESS_CLEANUP_SETTLE_MS);

  for (const entry of lingering) {
    if (!isPidAlive(entry.pid)) continue;
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch {
      // If this fails, verification below will record the failure.
    }
  }

  await sleep(PROCESS_CLEANUP_SETTLE_MS);

  for (const entry of lingering) {
    if (isPidAlive(entry.pid)) {
      failedToTerminate.push(entry);
    }
  }

  return {
    baselineCount: baselinePids.size,
    lingeringSpawnedCount: lingering.length,
    terminatedCount: lingering.length - failedToTerminate.length,
    failedToTerminateCount: failedToTerminate.length,
    lingering,
    failedToTerminate,
  };
}

async function runBenchmarkQuery(options: {
  query: QueryPlan;
  runPhase: 'cold' | 'warm';
  storage: ReturnType<typeof createSqliteStorage>;
  embeddingService: EmbeddingService;
  coldStartStructuralOnly?: boolean;
}): Promise<BenchmarkSample> {
  const {
    query,
    runPhase,
    storage,
    embeddingService,
    coldStartStructuralOnly = false,
  } = options;
  const started = performance.now();
  try {
    await queryLibrarian({
      intent: query.intent,
      depth: query.depth,
      llmRequirement: query.llmRequirement,
      deterministic: true,
      includeEngines: false,
      coldStartStructuralOnly,
    }, storage, embeddingService);
    const latencyMs = performance.now() - started;
    return {
      queryType: query.queryType,
      intent: query.intent,
      runPhase,
      latencyMs,
      ok: true,
    };
  } catch (error) {
    const latencyMs = performance.now() - started;
    return {
      queryType: query.queryType,
      intent: query.intent,
      runPhase,
      latencyMs,
      ok: false,
      error: truncateErrorMessage(error),
    };
  }
}

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      repetitions: { type: 'string', default: '2' },
      warmup: { type: 'boolean', default: true },
      failOnSlo: { type: 'boolean', default: false },
      coldStructuralOnly: { type: 'boolean', default: true },
    },
    strict: false,
  });

  const workspace = path.resolve(values.workspace ?? process.cwd());
  const repetitions = Math.max(1, Number(values.repetitions) || 2);
  const samples: BenchmarkSample[] = [];
  const baselineBootstrapQueryProcesses = await listBootstrapQueryProcesses();
  const baselineBootstrapQueryPids = new Set(
    baselineBootstrapQueryProcesses.map((entry) => entry.pid),
  );
  const dbPath = path.join(workspace, '.librarian', 'librarian.sqlite');
  let storage: ReturnType<typeof createSqliteStorage> | null = createSqliteStorage(dbPath, workspace);
  const embeddingService = new EmbeddingService();

  let cleanedUp = false;
  const cleanupStorage = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (!storage) return;
    try {
      await storage.close();
    } catch {
      // best-effort cleanup only
    }
    storage = null;
  };

  const attachSignalHandler = (signal: NodeJS.Signals): void => {
    process.once(signal, () => {
      void cleanupStorage().finally(() => process.exit(1));
    });
  };

  attachSignalHandler('SIGINT');
  attachSignalHandler('SIGTERM');

  process.once('uncaughtException', (error) => {
    process.stderr.write(`[benchmark-query-latency] uncaught exception: ${truncateErrorMessage(error)}\n`);
    void cleanupStorage().finally(() => process.exit(1));
  });

  process.once('unhandledRejection', (error) => {
    process.stderr.write(`[benchmark-query-latency] unhandled rejection: ${truncateErrorMessage(error)}\n`);
    void cleanupStorage().finally(() => process.exit(1));
  });

  await storage.initialize();

  try {
    if (!storage) {
      throw new Error('Storage unavailable for latency benchmark');
    }
    const stats = await storage.getStats();
    if ((stats.totalFunctions ?? 0) <= 0 && (stats.totalContextPacks ?? 0) <= 0) {
      throw new Error('Storage appears unindexed; run bootstrap/index update before latency benchmark.');
    }

    const coldQuery = DEFAULT_QUERY_PLAN[0];
    if (!coldQuery) {
      throw new Error('No query plan available for cold-start measurement.');
    }
    samples.push(await runBenchmarkQuery({
      query: coldQuery,
      runPhase: 'cold',
      storage,
      embeddingService,
      coldStartStructuralOnly: values.coldStructuralOnly !== false,
    }));

    if (values.warmup !== false) {
      await queryLibrarian({
        intent: 'Warm up query pipeline and caches',
        depth: 'L1',
        llmRequirement: 'disabled',
        deterministic: true,
        includeEngines: false,
      }, storage, embeddingService);
    }

    for (let round = 0; round < repetitions; round += 1) {
      for (const query of DEFAULT_QUERY_PLAN) {
        samples.push(await runBenchmarkQuery({
          query,
          runPhase: 'warm',
          storage,
          embeddingService,
        }));
      }
    }
  } finally {
    await cleanupStorage();
  }

  const successfulSamples = samples.filter((sample) => sample.ok);
  const coldSamples = successfulSamples.filter((sample) => sample.runPhase === 'cold');
  const warmSamples = successfulSamples.filter((sample) => sample.runPhase === 'warm');
  const latencySummary = summarizeLatencySamples(successfulSamples);
  const coldLatency = summarizeLatencySamples(coldSamples);
  const warmLatency = summarizeLatencySamples(warmSamples);
  const warmP50Passed = warmLatency.p50Ms <= WARM_QUERY_P50_SLO_MS;
  const coldP95Passed = coldLatency.p95Ms <= COLD_QUERY_P95_SLO_MS;
  const slo: LatencySloSummary = {
    warmP50Passed,
    coldP95Passed,
    passed: warmP50Passed && coldP95Passed,
    targetsMs: {
      warmP50: WARM_QUERY_P50_SLO_MS,
      coldP95: COLD_QUERY_P95_SLO_MS,
    },
    actualMs: {
      warmP50: warmLatency.p50Ms,
      coldP95: coldLatency.p95Ms,
    },
  };
  const processHygiene = await cleanupLingeringBootstrapQueryProcesses(
    baselineBootstrapQueryPids,
  );
  if (processHygiene.failedToTerminateCount > 0) {
    const failed = processHygiene.failedToTerminate
      .map((entry) => `${entry.pid}:${entry.command}`)
      .join('; ');
    throw new Error(`Failed to terminate lingering bootstrap/query process(es): ${failed}`);
  }
  if (values.failOnSlo === true && !slo.passed) {
    throw new Error(
      `Latency SLO regression: warm p50 ${warmLatency.p50Ms.toFixed(2)}ms (target <= ${WARM_QUERY_P50_SLO_MS}ms), `
      + `cold p95 ${coldLatency.p95Ms.toFixed(2)}ms (target <= ${COLD_QUERY_P95_SLO_MS}ms).`
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      workspace,
      generatedAt: new Date().toISOString(),
      queryCount: samples.length,
      successfulQueryCount: successfulSamples.length,
      failedQueryCount: samples.length - successfulSamples.length,
      latency: latencySummary,
      coldLatency,
      warmLatency,
      slo,
      processHygiene,
      samples,
    })}\n`
  );
}

run().catch((error) => {
  const message = truncateErrorMessage(error);
  process.stderr.write(`[benchmark-query-latency] failed: ${message}\n`);
  process.exitCode = 1;
});
