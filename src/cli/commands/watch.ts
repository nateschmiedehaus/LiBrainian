/**
 * @fileoverview Watch Command - Real-time file change monitoring and reindexing
 *
 * Starts a file watcher that automatically reindexes changed files,
 * keeping the librarian knowledge base up-to-date as you code.
 */

import { Librarian } from '../../api/librarian.js';
import { startFileWatcher, stopFileWatcher } from '../../integration/file_watcher.js';
import { globalEventBus, type LibrarianEvent } from '../../events.js';
import { CliError } from '../errors.js';
import { resolveWorkspaceRoot } from '../../utils/workspace_resolver.js';

const DEFAULT_WATCH_STORM_THRESHOLD = 200;

export interface WatchCommandOptions {
  workspace?: string;
  debounceMs?: number;
  batchWindowMs?: number;
  stormThreshold?: number;
  quiet?: boolean;
}

export interface WatchSession {
  shutdown: () => Promise<void>;
}

export async function startWatchSession(options: WatchCommandOptions): Promise<WatchSession> {
  let workspace = options.workspace || process.cwd();
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT !== '1') {
    const resolution = resolveWorkspaceRoot(workspace);
    if (resolution.changed) {
      const detail = resolution.marker ? `marker ${resolution.marker}` : (resolution.reason ?? 'source discovery');
      if (!options.quiet) {
        console.log(`Auto-detected project root at ${resolution.workspace} (${detail}). Using it.\n`);
      }
      workspace = resolution.workspace;
    }
  }
  const debounceMs = options.debounceMs ?? 200;
  const batchWindowMs = options.batchWindowMs ?? debounceMs;
  const stormThreshold = options.stormThreshold ?? DEFAULT_WATCH_STORM_THRESHOLD;
  const quiet = options.quiet ?? false;

  if (!quiet) {
    console.log('Librarian Watch Mode');
    console.log('====================');
    console.log(`Workspace: ${workspace}`);
    console.log(`Debounce: ${debounceMs}ms`);
    console.log('');
  }

  // Initialize librarian without auto-bootstrap
  const llmProviderEnv = process.env.LIBRARIAN_LLM_PROVIDER;
  const llmModelEnv = process.env.LIBRARIAN_LLM_MODEL;
  const llmProvider = llmProviderEnv === 'claude' || llmProviderEnv === 'codex' ? llmProviderEnv : undefined;
  const llmModelId = typeof llmModelEnv === 'string' && llmModelEnv.trim().length > 0 ? llmModelEnv : undefined;
  const hasLlmConfig = Boolean(llmProvider && llmModelId);
  const librarian = new Librarian({
    workspace,
    autoBootstrap: false,
    autoWatch: false,
    llmProvider: hasLlmConfig ? llmProvider : undefined,
    llmModelId: hasLlmConfig ? llmModelId : undefined,
  });

  await librarian.initialize();

  const status = await librarian.getStatus();
  if (!status.bootstrapped) {
    throw new CliError(
      'Librarian not bootstrapped. Run "librarian quickstart" or "librarian bootstrap" first.',
      'NOT_BOOTSTRAPPED'
    );
  }

  if (!quiet) {
    console.log(`Index loaded: ${status.stats.totalFunctions} functions, ${status.stats.totalModules} modules`);
    console.log('');
  }

  // Track reindex events
  let reindexCount = 0;
  let lastReindexTime = Date.now();

  // Subscribe to events for logging using globalEventBus.on('*', handler)
  const unsubscribe = globalEventBus.on('*', (event: LibrarianEvent) => {
    if (quiet) return;

    switch (event.type) {
      case 'file_modified':
        console.log(`[${timestamp()}] File changed: ${(event.data as { path?: string })?.path || 'unknown'}`);
        break;
      case 'indexing_started':
        console.log(`[${timestamp()}] Reindexing started...`);
        break;
      case 'indexing_complete': {
        reindexCount++;
        const elapsed = Date.now() - lastReindexTime;
        lastReindexTime = Date.now();
        console.log(`[${timestamp()}] Reindexing complete (${elapsed}ms) - Total reindexes: ${reindexCount}`);
        break;
      }
      case 'entity_created':
        console.log(`[${timestamp()}]   + Created: ${(event.data as { entityId?: string })?.entityId || 'unknown'}`);
        break;
      case 'entity_updated':
        console.log(`[${timestamp()}]   ~ Updated: ${(event.data as { entityId?: string })?.entityId || 'unknown'}`);
        break;
    }
  });

  let storage: ReturnType<typeof librarian.getStorage> | undefined;
  try {
    storage = librarian.getStorage() ?? undefined;
  } catch (error) {
    storage = undefined;
    if (!quiet) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[watch] Storage unavailable, starting without storage: ${message}`);
    }
  }

  // Start the file watcher
  const handle = startFileWatcher({
    workspaceRoot: workspace,
    librarian,
    storage,
    debounceMs,
    batchWindowMs,
    stormThreshold,
  });

  if (!quiet) {
    console.log('Watching for file changes...');
    console.log('Press Ctrl+C to stop.');
    console.log('');
    console.log('Activity:');
    console.log('---------');
  }

  // Handle shutdown
  const shutdown = async () => {
    if (!quiet) {
      console.log('\n\nStopping watcher...');
    }
    unsubscribe();
    await handle.stop();
    await stopFileWatcher(workspace);
    await librarian.shutdown();
    if (!quiet) {
      console.log(`Session complete. Total reindexes: ${reindexCount}`);
    }
  };

  return { shutdown };
}

export async function watchCommand(options: WatchCommandOptions): Promise<void> {
  const session = await startWatchSession(options);
  const shutdownAndExit = async () => {
    await session.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdownAndExit());
  process.on('SIGTERM', () => void shutdownAndExit());

  // Keep alive
  await new Promise<void>(() => {
    // Never resolves - keeps process running until signal
  });
}

function timestamp(): string {
  const now = new Date();
  return now.toTimeString().split(' ')[0] || '';
}
