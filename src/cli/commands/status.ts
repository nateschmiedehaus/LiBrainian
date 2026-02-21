import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired, getBootstrapStatus } from '../../api/bootstrap.js';
import { SCHEMA_VERSION } from '../../api/migrations.js';
import { getIndexState } from '../../state/index_state.js';
import { getWatchState } from '../../state/watch_state.js';
import { deriveWatchHealth } from '../../state/watch_health.js';
import { checkAllProviders, type AllProviderStatus } from '../../api/provider_check.js';
import { computeEmbeddingCoverage, type EmbeddingCoverageSummary } from '../../api/embedding_coverage.js';
import { inspectWorkspaceLocks } from '../../storage/storage_recovery.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import { LIBRARIAN_VERSION } from '../../index.js';
import { printKeyValue, formatTimestamp, formatBytes, formatDuration } from '../progress.js';
import { safeJsonParse } from '../../utils/safe_json.js';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';
import { emitJsonOutput } from '../json_output.js';
import { collectVerificationProvenance, type VerificationProvenanceReport } from '../verification_provenance.js';
import { getGitStatusChanges, isGitRepo } from '../../utils/git.js';
import { isOfflineModeEnabled } from '../../utils/runtime_controls.js';
import { getTreeSitterLanguageConfigs } from '../../agents/parsers/tree_sitter_parser.js';
import { getMemoryStoreStats } from '../../memory/fact_store.js';
import { readQueryCostTelemetry, type QueryCostTelemetry } from '../../api/query_cost_telemetry.js';
import {
  buildWorkspaceSetDependencyGraph,
  loadWorkspaceSetConfig,
  readWorkspaceSetState,
  type WorkspaceSetPackageStatus,
} from '../workspace_set.js';

export interface StatusCommandOptions {
  workspace: string;
  verbose?: boolean;
  format?: 'text' | 'json';
  out?: string;
  rawArgs?: string[];
}

type ServerStatus = {
  pidFile: string;
  status: 'running' | 'stale_pid' | 'not_running';
  running: boolean;
  pid: number | null;
};

type ConfigStatus = {
  path: string | null;
  status: 'found' | 'not_found';
};

type StatusReport = {
  workspace: string;
  workspaceOriginal?: string;
  version: { cli: string };
  runtime?: {
    offlineMode: boolean;
    availableFeatures: string[];
    unavailableFeatures: string[];
  };
  storage: { status: 'ready' | 'not_initialized'; reason?: string };
  schema?: {
    current: number | null;
    expected: number;
    upToDate: boolean;
  };
  bootstrap?: {
    required: { mvp: boolean; full: boolean };
    reasons: { mvp: string; full: string };
    lastRun?: {
      status: 'success' | 'failed';
      startedAt: string | null;
      completedAt: string | null;
      durationMs: number | null;
      error?: string;
    } | null;
    currentRun?: {
      status: string;
      phase: string | null;
      progress: number;
      startedAt: string | null;
      completedAt: string | null;
    } | null;
  };
  index?: {
    phase: string;
    lastFullIndex: string | null;
    progress?: { completed: number; total: number } | null;
  };
  watch?: {
    state: ReturnType<typeof getWatchState> extends Promise<infer T> ? T : unknown;
    health: ReturnType<typeof deriveWatchHealth>;
  } | null;
  server?: ServerStatus;
  config?: ConfigStatus;
  locks?: {
    lockDirs: string[];
    scannedFiles: number;
    staleFiles: number;
    activePidFiles: number;
    unknownFreshFiles: number;
  };
  stats?: {
    totalFunctions: number;
    totalModules: number;
    totalContextPacks: number;
    totalEmbeddings: number;
    storageSizeBytes: number;
    averageConfidence: number;
    cacheHitRate: number;
  };
  embeddingCoverage?: EmbeddingCoverageSummary;
  languageCoverage?: {
    totalFunctions: number;
    byLanguage: Record<string, number>;
  };
  metadata?: {
    version: string;
    qualityTier: string;
    lastBootstrap: string | null;
    lastIndexing: string | null;
    totalFiles: number;
  } | null;
  memory?: {
    totalFacts: number;
    oldestFactAt: string | null;
    newestFactAt: string | null;
  };
  providers?: {
    storedDefaults: { provider: string | null; model: string | null };
    status: AllProviderStatus | null;
    error?: string;
  };
  freshness?: {
    totalIndexedFiles: number;
    freshFiles: number;
    staleFiles: number;
    missingFiles: number;
    newFiles: number;
    selector: 'git-status';
  } | null;
  costs?: QueryCostTelemetry | null;
  costsError?: string;
  provenance?: VerificationProvenanceReport;
  workspaceSet?: {
    root: string;
    configPath: string;
    sharedDb: string | null;
    graphEdges: number;
    generatedAt: string | null;
    packages: Array<{
      name: string;
      path: string;
      dbPath: string;
      status: WorkspaceSetPackageStatus;
      reason?: string;
    }>;
  };
};

const LANGUAGE_NAME_OVERRIDES: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  dart: 'Dart',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  lua: 'Lua',
  php: 'PHP',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  scala: 'Scala',
  sql: 'SQL',
  swift: 'Swift',
  typescript: 'TypeScript',
  yaml: 'YAML',
};

const EXTENSION_LANGUAGE_MAP = buildExtensionLanguageMap();

function toSafeDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toIsoTimestamp(value: unknown): string | null {
  const parsed = toSafeDate(value);
  return parsed ? parsed.toISOString() : null;
}

function computeDurationMs(startedAt: unknown, completedAt: unknown): number | null {
  const start = toSafeDate(startedAt);
  const end = toSafeDate(completedAt);
  if (!start || !end) return null;
  return end.getTime() - start.getTime();
}

export async function statusCommand(options: StatusCommandOptions): Promise<number> {
  const { workspace, verbose, format = 'text', out, rawArgs } = options;
  const costArgs = parseCostTelemetryArgs(rawArgs);
  let workspaceRoot = path.resolve(workspace);
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(workspaceRoot);
    if (resolution.changed) {
      workspaceRoot = resolution.workspace;
      if (format === 'text') {
        const detail = resolution.marker ? `marker ${resolution.marker}` : (resolution.reason ?? 'source discovery');
        console.log(`Auto-detected project root at ${workspaceRoot} (${detail}). Using it.\n`);
      }
    }
  }

  const workspaceSetPath = parseWorkspaceSetArg(rawArgs);
  if (workspaceSetPath) {
    return await statusWorkspaceSet({
      workspaceRoot,
      workspaceOriginal: workspace,
      format,
      out,
      workspaceSetPath,
    });
  }

  const runtime: NonNullable<StatusReport['runtime']> = {
    offlineMode: isOfflineModeEnabled(),
    availableFeatures: ['search', 'graph', 'symbols'],
    unavailableFeatures: [],
  };
  if (runtime.offlineMode) {
    runtime.unavailableFeatures = ['synthesis', 'llm_enrichment'];
  }

  const report: StatusReport = {
    workspace: workspaceRoot,
    workspaceOriginal: workspaceRoot !== workspace ? workspace : undefined,
    version: { cli: LIBRARIAN_VERSION.string },
    runtime,
    storage: { status: 'not_initialized' },
  };
  report.provenance = await collectVerificationProvenance(workspaceRoot);

  if (format === 'text') {
    console.log('LiBrainian Status');
    console.log('================\n');

    console.log('Version Information:');
    printKeyValue([{ key: 'CLI Version', value: LIBRARIAN_VERSION.string }, { key: 'Workspace', value: workspaceRoot }]);
    console.log();

    console.log('Runtime Mode:');
    printKeyValue([
      { key: 'Offline Mode', value: runtime.offlineMode },
      { key: 'Available Features', value: runtime.availableFeatures.join(', ') || 'none' },
      { key: 'Unavailable Features', value: runtime.unavailableFeatures.join(', ') || 'none' },
    ]);
    console.log();

    console.log('Verification Provenance:');
    printKeyValue([
      { key: 'Status', value: report.provenance.status },
      { key: 'Evidence Generated At', value: report.provenance.evidenceGeneratedAt ?? 'unknown' },
      { key: 'STATUS Unverified Markers', value: report.provenance.statusUnverifiedMarkers },
      {
        key: 'Gates Unverified',
        value: `${report.provenance.gatesUnverifiedTasks}/${report.provenance.gatesTotalTasks}`,
      },
      { key: 'Release Evidence Ready', value: report.provenance.evidencePrerequisitesSatisfied },
    ]);
    if (report.provenance.notes.length > 0) {
      printKeyValue([{ key: 'Notes', value: report.provenance.notes.join(' | ') }]);
    }
    console.log();
  }

  let storage;
  try {
    const dbPath = await resolveDbPath(workspaceRoot);
    storage = createSqliteStorage(dbPath, workspaceRoot);
    await storage.initialize();
    report.storage = { status: 'ready' };
  } catch (error) {
    report.storage = {
      status: 'not_initialized',
      reason: error instanceof Error ? error.message : 'Unknown error',
    };
    if (format === 'json') {
      await emitJsonOutput(report, out);
      return 2;
    }
    console.log('Storage Status:');
    printKeyValue([
      { key: 'Status', value: 'Not Initialized' },
      { key: 'Reason', value: error instanceof Error ? error.message : 'Unknown error' },
    ]);
    console.log();
    console.log('Run `librarian bootstrap` to initialize the knowledge index.');
    return 2;
  }

  try {
    // Run bootstrap checks sequentially to avoid duplicate side-effect logs when
    // recovery state cleanup happens during concurrent checks.
    const mvpBootstrapCheck = await isBootstrapRequired(workspaceRoot, storage, { targetQualityTier: 'mvp' });
    const fullBootstrapCheck = await isBootstrapRequired(workspaceRoot, storage, { targetQualityTier: 'full' });
    const [lastBootstrap, indexState, metadata, schemaVersionRaw, memoryStats] = await Promise.all([
      storage.getLastBootstrapReport(),
      getIndexState(storage),
      storage.getMetadata(),
      storage.getState('schema_version'),
      getMemoryStoreStats(workspaceRoot).catch(() => ({ totalFacts: 0, oldestFactAt: null, newestFactAt: null })),
    ]);
    const schemaVersion = Number.parseInt(String(schemaVersionRaw ?? ''), 10);
    report.schema = {
      current: Number.isFinite(schemaVersion) ? schemaVersion : null,
      expected: SCHEMA_VERSION,
      upToDate: Number.isFinite(schemaVersion) ? schemaVersion === SCHEMA_VERSION : false,
    };
    const bootstrapState = getBootstrapStatus(workspaceRoot);

    report.bootstrap = {
      required: { mvp: mvpBootstrapCheck.required, full: fullBootstrapCheck.required },
      reasons: { mvp: mvpBootstrapCheck.reason, full: fullBootstrapCheck.reason },
      lastRun: lastBootstrap
        ? {
            status: lastBootstrap.success ? 'success' : 'failed',
            startedAt: toIsoTimestamp(lastBootstrap.startedAt),
            completedAt: toIsoTimestamp(lastBootstrap.completedAt),
            durationMs: computeDurationMs(lastBootstrap.startedAt, lastBootstrap.completedAt),
            ...(lastBootstrap.success ? {} : { error: lastBootstrap.error ?? undefined }),
          }
        : null,
      currentRun: bootstrapState.status !== 'not_started'
        ? {
            status: bootstrapState.status,
            phase: bootstrapState.currentPhase?.name ?? null,
            progress: bootstrapState.progress,
            startedAt: bootstrapState.startedAt?.toISOString() ?? null,
            completedAt: bootstrapState.completedAt?.toISOString() ?? null,
          }
        : null,
    };
    report.index = {
      phase: indexState.phase,
      lastFullIndex: indexState.lastFullIndex ?? null,
      progress: indexState.progress
        ? { completed: indexState.progress.completed, total: indexState.progress.total }
        : null,
    };
    report.memory = memoryStats;

    if (format === 'text') {
      console.log('Bootstrap Status:');
      printKeyValue([
        { key: 'Required (fast/mvp)', value: mvpBootstrapCheck.required },
        { key: 'Reason (fast/mvp)', value: mvpBootstrapCheck.reason },
        { key: 'Required (full)', value: fullBootstrapCheck.required },
        { key: 'Reason (full)', value: fullBootstrapCheck.reason },
      ]);
      if (lastBootstrap) {
        const durationMs = computeDurationMs(lastBootstrap.startedAt, lastBootstrap.completedAt);
        printKeyValue([
          { key: 'Last Run', value: lastBootstrap.success ? 'success' : 'failed' },
          { key: 'Last Started', value: formatTimestamp(toSafeDate(lastBootstrap.startedAt)) },
          { key: 'Last Completed', value: formatTimestamp(toSafeDate(lastBootstrap.completedAt)) },
          { key: 'Last Duration', value: durationMs === null ? 'Unknown' : formatDuration(durationMs) },
        ]);
        if (!lastBootstrap.success && lastBootstrap.error) {
          printKeyValue([{ key: 'Last Error', value: lastBootstrap.error }]);
        }
      } else {
        printKeyValue([{ key: 'Last Run', value: 'Never' }]);
      }

      if (bootstrapState.status !== 'not_started') {
        console.log('\nCurrent Run:');
        printKeyValue([
          { key: 'Status', value: bootstrapState.status },
          { key: 'Current Phase', value: bootstrapState.currentPhase?.name || 'None' },
          { key: 'Progress', value: `${Math.round(bootstrapState.progress * 100)}%` },
          { key: 'Started At', value: formatTimestamp(bootstrapState.startedAt) },
          { key: 'Completed At', value: formatTimestamp(bootstrapState.completedAt) },
        ]);
      }
      console.log();

      console.log('Index Status:');
      printKeyValue([
        { key: 'Phase', value: indexState.phase },
        { key: 'Last Full Index', value: formatTimestamp(indexState.lastFullIndex || null) },
      ]);
      if (indexState.progress) {
        printKeyValue([
          { key: 'Progress', value: `${indexState.progress.completed}/${indexState.progress.total}` },
        ]);
      }
      console.log();

      console.log('Persistent Memory:');
      printKeyValue([
        { key: 'Memory Facts', value: memoryStats.totalFacts },
        { key: 'Oldest Fact', value: formatTimestamp(memoryStats.oldestFactAt) },
        { key: 'Newest Fact', value: formatTimestamp(memoryStats.newestFactAt) },
      ]);
      console.log();

      console.log('Schema Status:');
      printKeyValue([
        { key: 'Current Schema Version', value: report.schema.current ?? 'unknown' },
        { key: 'Expected Schema Version', value: report.schema.expected },
        { key: 'Up To Date', value: report.schema.upToDate },
      ]);
      console.log();
    }

    const watchState = await getWatchState(storage);
    const watchHealth = deriveWatchHealth(watchState);
    report.watch = { state: watchState, health: watchHealth };
    if (format === 'text') {
      console.log('Watch Status:');
      if (watchState) {
        printKeyValue([
          { key: 'Watch Started', value: formatTimestamp(watchState.watch_started_at ?? null) },
          { key: 'Last Heartbeat', value: formatTimestamp(watchState.watch_last_heartbeat_at ?? null) },
          { key: 'Last Event', value: formatTimestamp(watchState.watch_last_event_at ?? null) },
          { key: 'Last Reindex OK', value: formatTimestamp(watchState.watch_last_reindex_ok_at ?? null) },
          { key: 'Suspected Dead', value: watchState.suspected_dead ?? false },
          { key: 'Needs Catch-up', value: watchState.needs_catchup ?? false },
          { key: 'Storage Attached', value: watchState.storage_attached ?? false },
        ]);
        if (watchState.last_error) {
          printKeyValue([{ key: 'Last Error', value: watchState.last_error }]);
        }
        if (watchHealth) {
          printKeyValue([
            { key: 'Derived Suspected Dead', value: watchHealth.suspectedDead },
            { key: 'Heartbeat Age (ms)', value: watchHealth.heartbeatAgeMs ?? 'unknown' },
            { key: 'Event Age (ms)', value: watchHealth.eventAgeMs ?? 'unknown' },
            { key: 'Reindex Age (ms)', value: watchHealth.reindexAgeMs ?? 'unknown' },
            { key: 'Staleness Window (ms)', value: watchHealth.stalenessMs ?? 'unknown' },
          ]);
        }
        if (watchState.effective_config) {
          printKeyValue([
            { key: 'Watch Debounce (ms)', value: watchState.effective_config.debounceMs ?? 'unknown' },
            { key: 'Cascade Enabled', value: watchState.effective_config.cascadeReindex ?? false },
            { key: 'Cascade Delay (ms)', value: watchState.effective_config.cascadeDelayMs ?? 'unknown' },
            { key: 'Cascade Batch Size', value: watchState.effective_config.cascadeBatchSize ?? 'unknown' },
            { key: 'Watch Excludes', value: (watchState.effective_config.excludes ?? []).join(', ') || 'none' },
          ]);
        }
        if (watchHealth?.suspectedDead || watchState.needs_catchup) {
          console.log('\nTip: Run `librarian watch` to restart indexing and catch up on changes.');
        }
      } else {
        printKeyValue([{ key: 'Watch Status', value: 'No watch state recorded' }]);
        console.log('\nTip: Run `librarian watch` to keep the index up-to-date.');
      }
      console.log();
    }

    const [workspaceLocks, serverStatus, configStatus] = await Promise.all([
      inspectWorkspaceLocks(workspaceRoot),
      inspectServerPid(workspaceRoot),
      detectConfigPath(workspaceRoot),
    ]);
    report.locks = {
      lockDirs: workspaceLocks.lockDirs,
      scannedFiles: workspaceLocks.scannedFiles,
      staleFiles: workspaceLocks.staleFiles,
      activePidFiles: workspaceLocks.activePidFiles,
      unknownFreshFiles: workspaceLocks.unknownFreshFiles,
    };
    report.server = serverStatus;
    report.config = configStatus;
    if (format === 'text') {
      console.log('Lock Hygiene:');
      printKeyValue([
        { key: 'Lock Files Scanned', value: workspaceLocks.scannedFiles },
        { key: 'Stale Lock Files', value: workspaceLocks.staleFiles },
        { key: 'Active PID Locks', value: workspaceLocks.activePidFiles },
        { key: 'Fresh Unknown Locks', value: workspaceLocks.unknownFreshFiles },
      ]);
      if (workspaceLocks.staleFiles > 0) {
        console.log('\nTip: Run `librarian doctor --heal` to remove stale lock files.');
      }
      console.log();

      console.log('MCP Server:');
      printKeyValue([
        { key: 'Status', value: serverStatus.status },
        { key: 'Running', value: serverStatus.running },
        { key: 'PID', value: serverStatus.pid ?? 'none' },
        { key: 'PID File', value: serverStatus.pidFile },
      ]);
      console.log();

      console.log('Config:');
      printKeyValue([
        { key: 'Status', value: configStatus.status },
        { key: 'Path', value: configStatus.path ?? 'no config found' },
      ]);
      console.log();
    }

    const stats = await storage.getStats();
    report.stats = {
      totalFunctions: stats.totalFunctions,
      totalModules: stats.totalModules,
      totalContextPacks: stats.totalContextPacks,
      totalEmbeddings: stats.totalEmbeddings,
      storageSizeBytes: stats.storageSizeBytes,
      averageConfidence: stats.averageConfidence,
      cacheHitRate: stats.cacheHitRate,
    };
    report.embeddingCoverage = computeEmbeddingCoverage(stats.totalFunctions, stats.totalEmbeddings);
    report.languageCoverage = await collectLanguageCoverage(storage);
    report.metadata = metadata
      ? {
          version: metadata.version.string,
          qualityTier: String(metadata.qualityTier),
          lastBootstrap: toIsoTimestamp(metadata.lastBootstrap),
          lastIndexing: toIsoTimestamp(metadata.lastIndexing),
          totalFiles: metadata.totalFiles,
        }
      : null;
    report.freshness = await collectGitFreshnessSummary({
      workspaceRoot,
      storage,
      totalIndexedFiles: metadata?.totalFiles ?? 0,
    });

    try {
      const rawDefaults = await storage.getState('librarian.llm_defaults.v1');
      const parsedDefaults = rawDefaults ? safeJsonParse<Record<string, unknown>>(rawDefaults) : null;
      const storedProvider = parsedDefaults?.ok ? parsedDefaults.value.provider : null;
      const storedModel = parsedDefaults?.ok ? parsedDefaults.value.modelId : null;
      if ((storedProvider === 'claude' || storedProvider === 'codex') && typeof storedModel === 'string' && storedModel.trim()) {
        if (!process.env.LIBRARIAN_LLM_PROVIDER) process.env.LIBRARIAN_LLM_PROVIDER = storedProvider;
        if (!process.env.LIBRARIAN_LLM_MODEL) process.env.LIBRARIAN_LLM_MODEL = storedModel.trim();
      }
      const providers = await checkAllProviders({ workspaceRoot });
      report.providers = {
        storedDefaults: {
          provider: typeof storedProvider === 'string' ? storedProvider : null,
          model: typeof storedModel === 'string' ? storedModel : null,
        },
        status: providers,
      };
    } catch (error) {
      report.providers = {
        storedDefaults: { provider: null, model: null },
        status: null,
        error: error instanceof Error ? error.message : 'Unable to check providers',
      };
    }

    if (costArgs.includeCosts) {
      try {
        report.costs = await readQueryCostTelemetry({
          workspaceRoot,
          budgetUsd: costArgs.budgetUsd,
          lookbackDays: costArgs.lookbackDays,
          maxPerQuery: costArgs.maxPerQuery,
        });
      } catch (error) {
        report.costs = null;
        report.costsError = error instanceof Error ? error.message : String(error);
      }
    }

    if (format === 'json') {
      await emitJsonOutput(report, out);
      return deriveStatusExitCode(report);
    }

    console.log('Index Statistics:');
    printKeyValue([
      { key: 'Total Functions', value: stats.totalFunctions },
      { key: 'Total Modules', value: stats.totalModules },
      { key: 'Total Context Packs', value: stats.totalContextPacks },
      { key: 'Total Embeddings', value: stats.totalEmbeddings },
      { key: 'Embedding Coverage', value: `${report.embeddingCoverage.coverage_pct.toFixed(1)}%` },
      { key: 'Needs Embedding', value: report.embeddingCoverage.needs_embedding_count },
      { key: 'Storage Size', value: formatBytes(stats.storageSizeBytes) },
      { key: 'Average Confidence', value: stats.averageConfidence.toFixed(3) },
      { key: 'Cache Hit Rate', value: `${(stats.cacheHitRate * 100).toFixed(1)}%` },
    ]);
    console.log();

    if (Object.keys(report.languageCoverage.byLanguage).length > 0) {
      console.log('Language Coverage (Functions):');
      printKeyValue(
        Object.entries(report.languageCoverage.byLanguage).map(([language, count]) => ({
          key: language,
          value: count,
        })),
      );
      console.log();
    }

    if (metadata) {
      console.log('Metadata:');
      printKeyValue([
        { key: 'Version', value: metadata.version.string },
        { key: 'Quality Tier', value: metadata.qualityTier },
        { key: 'Last Bootstrap', value: formatTimestamp(toSafeDate(metadata.lastBootstrap)) },
        { key: 'Last Indexing', value: formatTimestamp(toSafeDate(metadata.lastIndexing)) },
        { key: 'Total Files', value: metadata.totalFiles },
      ]);
      console.log();
    }

    if (report.freshness) {
      console.log('Index Freshness:');
      printKeyValue([
        { key: 'Indexed Files', value: report.freshness.totalIndexedFiles },
        { key: 'Fresh', value: report.freshness.freshFiles },
        { key: 'Stale', value: report.freshness.staleFiles },
        { key: 'Missing', value: report.freshness.missingFiles },
        { key: 'New (Unindexed)', value: report.freshness.newFiles },
      ]);
      if (report.freshness.staleFiles + report.freshness.missingFiles + report.freshness.newFiles > 0) {
        printKeyValue([{ key: 'Suggested Command', value: 'librarian index --force --incremental' }]);
      }
      console.log();
    }

    console.log('Provider Status:');
    if (report.providers?.storedDefaults.provider && report.providers?.storedDefaults.model) {
      printKeyValue([
        { key: 'Stored LLM Provider', value: report.providers.storedDefaults.provider },
        { key: 'Stored LLM Model', value: report.providers.storedDefaults.model },
      ]);
    } else {
      printKeyValue([{ key: 'Stored LLM Defaults', value: 'None' }]);
    }
    if (report.providers?.status) {
      const providers = report.providers.status;
      printKeyValue([
        { key: 'LLM Available', value: providers.llm.available },
        { key: 'LLM Provider', value: providers.llm.provider },
        { key: 'LLM Model', value: providers.llm.model },
        { key: 'Embedding Available', value: providers.embedding.available },
        { key: 'Embedding Provider', value: providers.embedding.provider },
      ]);
      if (!providers.llm.available || !providers.embedding.available) {
        console.log('\nRun `librarian check-providers` for detailed diagnostics.');
      }
    } else {
      printKeyValue([{ key: 'Status', value: 'Unable to check providers' }]);
    }
    console.log();

    if (costArgs.includeCosts) {
      console.log('Cost Telemetry:');
      if (report.costsError) {
        printKeyValue([{ key: 'Status', value: `Unable to read telemetry (${report.costsError})` }]);
        console.log();
      } else if (!report.costs) {
        printKeyValue([{ key: 'Status', value: 'No evidence_ledger.db telemetry found yet' }]);
        console.log();
      } else {
        const sessionSummary = report.costs.session ?? report.costs.totals;
        printKeyValue([
          { key: 'Lookback (days)', value: report.costs.lookbackDays },
          { key: 'Query Samples', value: report.costs.totals.queriesCount },
          { key: 'Session', value: sessionSummary.sessionId ?? 'none' },
          { key: 'Session Queries', value: sessionSummary.queriesCount },
          { key: 'Session Tokens In/Out', value: `${sessionSummary.totalTokensIn}/${sessionSummary.totalTokensOut}` },
          { key: 'Session Total Tokens', value: sessionSummary.totalTokens },
          { key: 'Session LLM Calls', value: sessionSummary.llmCalls },
          { key: 'Session Avg Latency (ms)', value: sessionSummary.avgLatencyMs },
          { key: 'Session Cost (USD)', value: sessionSummary.totalCostUsd.toFixed(6) },
          { key: 'Budget (USD)', value: sessionSummary.budgetUsd.toFixed(6) },
          { key: 'Budget Exceeded', value: sessionSummary.budgetExceeded },
        ]);
        if (report.costs.alerts.length > 0) {
          printKeyValue([{ key: 'Alerts', value: report.costs.alerts.join(' | ') }]);
        }
        if (report.costs.perQuery.length > 0) {
          console.log('\nRecent Query Metrics:');
          for (const sample of report.costs.perQuery.slice(0, costArgs.maxPerQuery)) {
            console.log(
              `  - ${sample.timestamp} session=${sample.sessionId ?? 'none'} tokens=${sample.totalTokens} llmCalls=${sample.llmCalls} latencyMs=${sample.latencyMs} costUsd=${sample.estimatedCostUsd.toFixed(6)} cacheHit=${sample.cacheHit === null ? 'unknown' : sample.cacheHit}`
            );
          }
        }
        console.log();
      }
    }

    if (verbose) {
      const packs = await storage.getContextPacks({ limit: 5, orderBy: 'accessCount', orderDirection: 'desc' });
      if (packs.length > 0) {
        console.log('Most Accessed Context Packs:');
        for (const pack of packs) {
          console.log(`  - ${pack.packType}: ${pack.targetId} (accessed ${pack.accessCount} times, confidence ${pack.confidence.toFixed(2)})`);
        }
        console.log();
      }

      const functions = await storage.getFunctions({ limit: 5, orderBy: 'confidence', orderDirection: 'desc' });
      if (functions.length > 0) {
        console.log('High Confidence Functions:');
        for (const fn of functions) {
          console.log(`  - ${fn.name} in ${fn.filePath} (confidence ${fn.confidence.toFixed(2)})`);
        }
        console.log();
      }
    }

  } finally {
    await storage.close();
  }

  return deriveStatusExitCode(report);
}

async function statusWorkspaceSet(options: {
  workspaceRoot: string;
  workspaceOriginal: string;
  format: 'text' | 'json';
  out?: string;
  workspaceSetPath: string;
}): Promise<number> {
  const { workspaceRoot, workspaceOriginal, format, out, workspaceSetPath } = options;
  const workspaceSet = await loadWorkspaceSetConfig(workspaceSetPath, workspaceRoot);
  const persisted = await readWorkspaceSetState(workspaceSet.root);
  const graph = persisted?.graph ?? await buildWorkspaceSetDependencyGraph(workspaceSet);
  const persistedPackageMap = new Map((persisted?.packages ?? []).map((pkg) => [pkg.name, pkg]));
  const packages: NonNullable<StatusReport['workspaceSet']>['packages'] = [];

  for (const pkg of workspaceSet.packages) {
    const dbPath = await resolveDbPath(pkg.path);
    const persistedPkg = persistedPackageMap.get(pkg.name);
    let status: WorkspaceSetPackageStatus = persistedPkg?.status ?? 'missing';
    let reason = persistedPkg?.error;

    if (!persistedPkg) {
      try {
        await fs.access(dbPath);
        const storage = createSqliteStorage(dbPath, pkg.path);
        try {
          await storage.initialize();
          const bootstrapCheck = await isBootstrapRequired(pkg.path, storage, { targetQualityTier: 'full' });
          status = bootstrapCheck.required ? 'stale' : 'ready';
          reason = bootstrapCheck.required ? bootstrapCheck.reason : undefined;
        } finally {
          await storage.close();
        }
      } catch (error) {
        status = 'missing';
        reason = error instanceof Error ? error.message : 'workspace package not bootstrapped';
      }
    }

    packages.push({
      name: pkg.name,
      path: pkg.path,
      dbPath,
      status,
      reason,
    });
  }

  const report: StatusReport = {
    workspace: workspaceSet.root,
    workspaceOriginal: workspaceRoot !== workspaceOriginal ? workspaceOriginal : undefined,
    version: { cli: LIBRARIAN_VERSION.string },
    storage: { status: 'ready' },
    workspaceSet: {
      root: workspaceSet.root,
      configPath: workspaceSet.configPath,
      sharedDb: workspaceSet.shared.sharedDb ?? null,
      graphEdges: graph.edges.length,
      generatedAt: persisted?.generatedAt ?? null,
      packages,
    },
  };

  if (format === 'json') {
    await emitJsonOutput(report, out);
  } else {
    console.log('LiBrainian Workspace-Set Status');
    console.log('=============================\n');
    printKeyValue([
      { key: 'Workspace Root', value: workspaceSet.root },
      { key: 'Config Path', value: workspaceSet.configPath },
      { key: 'Shared Graph DB', value: workspaceSet.shared.sharedDb ?? 'disabled' },
      { key: 'Cross-package Edges', value: graph.edges.length },
      { key: 'State Generated', value: formatTimestamp(persisted?.generatedAt ?? null) },
    ]);
    console.log();
    console.log('Packages:');
    for (const pkg of packages) {
      printKeyValue([
        { key: pkg.name, value: `${pkg.status} (${pkg.path})` },
      ]);
      if (pkg.reason && pkg.status !== 'ready') {
        printKeyValue([{ key: `${pkg.name} Reason`, value: pkg.reason }]);
      }
    }
    console.log();
  }

  if (packages.some((pkg) => pkg.status === 'failed' || pkg.status === 'missing')) return 2;
  if (packages.some((pkg) => pkg.status === 'stale')) return 1;
  return 0;
}

function deriveStatusExitCode(report: StatusReport): number {
  if (report.storage.status !== 'ready') return 2;
  if (report.bootstrap?.required.full) return 1;
  if (report.watch?.health?.suspectedDead) return 1;
  return 0;
}

function parseWorkspaceSetArg(rawArgs: string[] | undefined): string | undefined {
  if (!rawArgs || rawArgs.length === 0) return undefined;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'workspace-set': { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });
  const candidate = typeof values['workspace-set'] === 'string' ? values['workspace-set'].trim() : '';
  return candidate.length > 0 ? candidate : undefined;
}

function parseCostTelemetryArgs(rawArgs: string[] | undefined): {
  includeCosts: boolean;
  budgetUsd?: number;
  lookbackDays: number;
  maxPerQuery: number;
} {
  if (!rawArgs || rawArgs.length === 0) {
    return { includeCosts: false, lookbackDays: 7, maxPerQuery: 10 };
  }
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      costs: { type: 'boolean', default: false },
      'cost-budget-usd': { type: 'string' },
      'cost-window-days': { type: 'string' },
      'cost-limit': { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });
  const lookbackDays = clampInteger(
    typeof values['cost-window-days'] === 'string' ? values['cost-window-days'] : undefined,
    7,
    1,
    365
  );
  const maxPerQuery = clampInteger(
    typeof values['cost-limit'] === 'string' ? values['cost-limit'] : undefined,
    10,
    1,
    20
  );
  const budgetRaw = typeof values['cost-budget-usd'] === 'string' ? values['cost-budget-usd'] : undefined;
  const parsedBudget = budgetRaw ? Number(budgetRaw) : undefined;
  return {
    includeCosts: Boolean(values.costs),
    budgetUsd: Number.isFinite(parsedBudget) && parsedBudget !== undefined && parsedBudget >= 0 ? parsedBudget : undefined,
    lookbackDays,
    maxPerQuery,
  };
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeExtension(ext: string): string {
  return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

function toLanguageDisplayName(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return 'Unknown';
  const mapped = LANGUAGE_NAME_OVERRIDES[normalized];
  if (mapped) return mapped;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildExtensionLanguageMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const config of getTreeSitterLanguageConfigs()) {
    for (const ext of config.extensions) {
      map.set(normalizeExtension(ext), config.language);
    }
  }
  return map;
}

async function collectLanguageCoverage(storage: LiBrainianStorage): Promise<NonNullable<StatusReport['languageCoverage']>> {
  const functions = await storage.getFunctions();
  const byLanguage = new Map<string, number>();
  for (const fn of functions) {
    const ext = path.extname(fn.filePath).toLowerCase();
    const language = ext ? EXTENSION_LANGUAGE_MAP.get(ext) ?? ext.slice(1) : 'unknown';
    const display = toLanguageDisplayName(language);
    byLanguage.set(display, (byLanguage.get(display) ?? 0) + 1);
  }
  const sorted = Array.from(byLanguage.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const byLanguageRecord: Record<string, number> = {};
  for (const [language, count] of sorted) {
    byLanguageRecord[language] = count;
  }
  return {
    totalFunctions: functions.length,
    byLanguage: byLanguageRecord,
  };
}

async function inspectServerPid(workspaceRoot: string): Promise<ServerStatus> {
  const pidFile = path.join(workspaceRoot, '.librarian', 'server.pid');
  let pidRaw: string;
  try {
    pidRaw = await fs.readFile(pidFile, 'utf8');
  } catch {
    return { pidFile, status: 'not_running', running: false, pid: null };
  }
  const parsedPid = Number.parseInt(pidRaw.trim(), 10);
  if (!Number.isFinite(parsedPid) || parsedPid <= 0) {
    return { pidFile, status: 'stale_pid', running: false, pid: null };
  }
  const running = isPidAlive(parsedPid);
  return {
    pidFile,
    status: running ? 'running' : 'not_running',
    running,
    pid: parsedPid,
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

async function detectConfigPath(workspaceRoot: string): Promise<ConfigStatus> {
  const candidates = [
    'librarian.config.ts',
    'librarian.config.js',
    'librarian.config.mjs',
    'librarian.config.cjs',
    'librarian.config.json',
  ].map((candidate) => path.join(workspaceRoot, candidate));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return { path: candidate, status: 'found' };
    } catch {
      continue;
    }
  }
  return { path: null, status: 'not_found' };
}

async function collectGitFreshnessSummary(params: {
  workspaceRoot: string;
  storage: LiBrainianStorage;
  totalIndexedFiles: number;
}): Promise<StatusReport['freshness']> {
  const { workspaceRoot, storage, totalIndexedFiles } = params;
  if (!isGitRepo(workspaceRoot)) return null;

  const changes = await getGitStatusChanges(workspaceRoot);
  if (!changes) {
    return {
      totalIndexedFiles,
      freshFiles: Math.max(totalIndexedFiles, 0),
      staleFiles: 0,
      missingFiles: 0,
      newFiles: 0,
      selector: 'git-status',
    };
  }

  const addedOrModified = dedupePaths([...changes.added, ...changes.modified])
    .map((relPath) => path.resolve(workspaceRoot, relPath));
  const deleted = dedupePaths(changes.deleted).map((relPath) => path.resolve(workspaceRoot, relPath));

  let staleFiles = 0;
  let newFiles = 0;
  let missingFiles = 0;

  for (const filePath of addedOrModified) {
    const indexed = await storage.getFileByPath(filePath);
    if (indexed) staleFiles += 1;
    else newFiles += 1;
  }
  for (const filePath of deleted) {
    const indexed = await storage.getFileByPath(filePath);
    if (indexed) missingFiles += 1;
  }

  const freshFiles = Math.max(totalIndexedFiles - staleFiles - missingFiles, 0);
  return {
    totalIndexedFiles,
    freshFiles,
    staleFiles,
    missingFiles,
    newFiles,
    selector: 'git-status',
  };
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of paths) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped;
}
