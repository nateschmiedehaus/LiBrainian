import type { WatchState } from './watch_state.js';

export interface WatchHealth {
  suspectedDead: boolean;
  heartbeatAgeMs: number | null;
  eventAgeMs: number | null;
  reindexAgeMs: number | null;
  stalenessMs: number | null;
}

const DEFAULT_STALENESS_MS = 60_000;

export function deriveWatchHealth(state: WatchState | null): WatchHealth | null {
  if (!state) return null;
  const heartbeatAgeMs = computeAgeMs(state.watch_last_heartbeat_at);
  const eventAgeMs = computeAgeMs(state.watch_last_event_at);
  const reindexAgeMs = computeAgeMs(state.watch_last_reindex_ok_at);
  const stalenessMs = resolveStalenessWindow(state);
  const suspectedDead = Boolean(state.suspected_dead) ||
    (heartbeatAgeMs !== null && stalenessMs !== null && heartbeatAgeMs > stalenessMs);

  return {
    suspectedDead,
    heartbeatAgeMs,
    eventAgeMs,
    reindexAgeMs,
    stalenessMs,
  };
}

function computeAgeMs(iso?: string): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
}

function resolveStalenessWindow(state: WatchState): number | null {
  if (typeof state.effective_config?.batchWindowMs === 'number' && state.effective_config.batchWindowMs > 0) {
    return Math.max(DEFAULT_STALENESS_MS, state.effective_config.batchWindowMs * 10);
  }
  return DEFAULT_STALENESS_MS;
}
