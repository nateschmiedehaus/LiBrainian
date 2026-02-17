import * as path from 'node:path';
import { resolveDbPath } from '../db_path.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { isBootstrapRequired, getBootstrapStatus } from '../../api/bootstrap.js';
import { getIndexState } from '../../state/index_state.js';
import { getWatchState } from '../../state/watch_state.js';
import { deriveWatchHealth } from '../../state/watch_health.js';
import { checkAllProviders, type AllProviderStatus } from '../../api/provider_check.js';
import { LIBRARIAN_VERSION } from '../../index.js';
import { printKeyValue, formatTimestamp, formatBytes, formatDuration } from '../progress.js';
import { safeJsonParse } from '../../utils/safe_json.js';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';

export interface StatusCommandOptions {
  workspace: string;
  verbose?: boolean;
  format?: 'text' | 'json';
}

type StatusReport = {
  workspace: string;
  workspaceOriginal?: string;
  version: { cli: string };
  storage: { status: 'ready' | 'not_initialized'; reason?: string };
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
  stats?: {
    totalFunctions: number;
    totalModules: number;
    totalContextPacks: number;
    totalEmbeddings: number;
    storageSizeBytes: number;
    averageConfidence: number;
    cacheHitRate: number;
  };
  metadata?: {
    version: string;
    qualityTier: string;
    lastBootstrap: string | null;
    lastIndexing: string | null;
    totalFiles: number;
  } | null;
  providers?: {
    storedDefaults: { provider: string | null; model: string | null };
    status: AllProviderStatus | null;
    error?: string;
  };
};

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

export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  const { workspace, verbose, format = 'text' } = options;
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
  const report: StatusReport = {
    workspace: workspaceRoot,
    workspaceOriginal: workspaceRoot !== workspace ? workspace : undefined,
    version: { cli: LIBRARIAN_VERSION.string },
    storage: { status: 'not_initialized' },
  };

  if (format === 'text') {
    console.log('Librarian Status');
    console.log('================\n');

    console.log('Version Information:');
    printKeyValue([{ key: 'CLI Version', value: LIBRARIAN_VERSION.string }, { key: 'Workspace', value: workspaceRoot }]);
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
      console.log(JSON.stringify(report));
      return;
    }
    console.log('Storage Status:');
    printKeyValue([
      { key: 'Status', value: 'Not Initialized' },
      { key: 'Reason', value: error instanceof Error ? error.message : 'Unknown error' },
    ]);
    console.log();
    console.log('Run `librarian bootstrap` to initialize the knowledge index.');
    return;
  }

  try {
    const [mvpBootstrapCheck, fullBootstrapCheck, lastBootstrap, indexState, metadata] = await Promise.all([
      isBootstrapRequired(workspaceRoot, storage, { targetQualityTier: 'mvp' }),
      isBootstrapRequired(workspaceRoot, storage, { targetQualityTier: 'full' }),
      storage.getLastBootstrapReport(),
      getIndexState(storage),
      storage.getMetadata(),
    ]);
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
    report.metadata = metadata
      ? {
          version: metadata.version.string,
          qualityTier: String(metadata.qualityTier),
          lastBootstrap: toIsoTimestamp(metadata.lastBootstrap),
          lastIndexing: toIsoTimestamp(metadata.lastIndexing),
          totalFiles: metadata.totalFiles,
        }
      : null;

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

    if (format === 'json') {
      console.log(JSON.stringify(report));
      return;
    }

    console.log('Index Statistics:');
    printKeyValue([
      { key: 'Total Functions', value: stats.totalFunctions },
      { key: 'Total Modules', value: stats.totalModules },
      { key: 'Total Context Packs', value: stats.totalContextPacks },
      { key: 'Total Embeddings', value: stats.totalEmbeddings },
      { key: 'Storage Size', value: formatBytes(stats.storageSizeBytes) },
      { key: 'Average Confidence', value: stats.averageConfidence.toFixed(3) },
      { key: 'Cache Hit Rate', value: `${(stats.cacheHitRate * 100).toFixed(1)}%` },
    ]);
    console.log();

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
}
