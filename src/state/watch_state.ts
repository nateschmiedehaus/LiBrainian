import type { LibrarianStorage } from '../storage/types.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

export type WatchCursor =
  | { kind: 'git'; lastIndexedCommitSha: string }
  | { kind: 'fs'; lastReconcileCompletedAt: string };

export interface WatchStateConfig {
  debounceMs?: number;
  batchWindowMs?: number;
  stormThreshold?: number;
  cascadeReindex?: boolean;
  cascadeDelayMs?: number;
  cascadeBatchSize?: number;
  excludes?: string[];
}

export interface WatchState {
  schema_version: 1;
  workspace_root: string;
  watch_started_at?: string;
  watch_last_heartbeat_at?: string;
  watch_last_event_at?: string;
  watch_last_reindex_ok_at?: string;
  suspected_dead?: boolean;
  needs_catchup?: boolean;
  storage_attached?: boolean;
  effective_config?: WatchStateConfig;
  cursor?: WatchCursor;
  last_error?: string;
  updated_at?: string;
}

const WATCH_STATE_KEY = 'librarian.watch_state.v1';

export async function getWatchState(storage: LibrarianStorage): Promise<WatchState | null> {
  const raw = await storage.getState(WATCH_STATE_KEY);
  if (!raw) return null;
  const parsed = safeJsonParseSimple<WatchState>(raw);
  if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== 1) return null;
  const workspaceRoot = typeof parsed.workspace_root === 'string' ? parsed.workspace_root : '';
  const cursor = normalizeCursor(parsed.cursor);
  const config = normalizeConfig(parsed.effective_config);
  return {
    schema_version: 1,
    workspace_root: workspaceRoot,
    watch_started_at: typeof parsed.watch_started_at === 'string' ? parsed.watch_started_at : undefined,
    watch_last_heartbeat_at: typeof parsed.watch_last_heartbeat_at === 'string' ? parsed.watch_last_heartbeat_at : undefined,
    watch_last_event_at: typeof parsed.watch_last_event_at === 'string' ? parsed.watch_last_event_at : undefined,
    watch_last_reindex_ok_at: typeof parsed.watch_last_reindex_ok_at === 'string' ? parsed.watch_last_reindex_ok_at : undefined,
    suspected_dead: typeof parsed.suspected_dead === 'boolean' ? parsed.suspected_dead : undefined,
    needs_catchup: typeof parsed.needs_catchup === 'boolean' ? parsed.needs_catchup : undefined,
    storage_attached: typeof parsed.storage_attached === 'boolean' ? parsed.storage_attached : undefined,
    effective_config: config,
    cursor,
    last_error: typeof parsed.last_error === 'string' ? parsed.last_error : undefined,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined,
  };
}

export async function updateWatchState(
  storage: LibrarianStorage,
  updater: (prev: WatchState | null) => WatchState
): Promise<WatchState> {
  const prev = await getWatchState(storage);
  const next = updater(prev);
  const workspaceRoot = next.workspace_root || prev?.workspace_root || '';
  const payload: WatchState = {
    ...next,
    schema_version: 1,
    workspace_root: workspaceRoot,
    updated_at: new Date().toISOString(),
  };
  await storage.setState(WATCH_STATE_KEY, JSON.stringify(payload));
  return payload;
}

function normalizeCursor(cursor?: WatchCursor): WatchCursor | undefined {
  if (!cursor || typeof cursor !== 'object') return undefined;
  if (cursor.kind === 'git' && typeof cursor.lastIndexedCommitSha === 'string') {
    return { kind: 'git', lastIndexedCommitSha: cursor.lastIndexedCommitSha };
  }
  if (cursor.kind === 'fs' && typeof cursor.lastReconcileCompletedAt === 'string') {
    return { kind: 'fs', lastReconcileCompletedAt: cursor.lastReconcileCompletedAt };
  }
  return undefined;
}

function normalizeConfig(config?: WatchStateConfig): WatchStateConfig | undefined {
  if (!config || typeof config !== 'object') return undefined;
  return {
    debounceMs: typeof config.debounceMs === 'number' ? config.debounceMs : undefined,
    batchWindowMs: typeof config.batchWindowMs === 'number' ? config.batchWindowMs : undefined,
    stormThreshold: typeof config.stormThreshold === 'number' ? config.stormThreshold : undefined,
    cascadeReindex: typeof config.cascadeReindex === 'boolean' ? config.cascadeReindex : undefined,
    cascadeDelayMs: typeof config.cascadeDelayMs === 'number' ? config.cascadeDelayMs : undefined,
    cascadeBatchSize: typeof config.cascadeBatchSize === 'number' ? config.cascadeBatchSize : undefined,
    excludes: Array.isArray(config.excludes)
      ? config.excludes.filter((entry) => typeof entry === 'string')
      : undefined,
  };
}
