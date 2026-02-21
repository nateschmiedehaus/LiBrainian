import type { LiBrainianStorage } from '../storage/types.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

export type IndexPhase =
  | 'uninitialized'
  | 'discovering'
  | 'indexing'
  | 'computing_graph'
  | 'generating_knowledge'
  | 'ready'
  | 'incremental';

export interface IndexProgress {
  total: number;
  completed: number;
  currentFile?: string;
}

export interface IndexState {
  phase: IndexPhase;
  progress?: IndexProgress;
  lastFullIndex?: string;
  estimatedCompletion?: string;
  updatedAt?: string;
}

export interface IndexStateWriter {
  write: (state: IndexState, options?: { force?: boolean }) => Promise<void>;
  flush: () => Promise<void>;
}

const INDEX_STATE_KEY = 'index_state';
const DEFAULT_STATE: IndexState = { phase: 'uninitialized' };
const DEFAULT_WRITE_THROTTLE_MS = 500;

export async function getIndexState(storage: LiBrainianStorage): Promise<IndexState> {
  const raw = await storage.getState(INDEX_STATE_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  const parsed = safeJsonParseSimple<IndexState>(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.phase) return { ...DEFAULT_STATE };
  return {
    phase: parsed.phase,
    progress: parsed.progress ? { ...parsed.progress } : undefined,
    lastFullIndex: parsed.lastFullIndex,
    estimatedCompletion: parsed.estimatedCompletion,
    updatedAt: parsed.updatedAt,
  };
}

export async function setIndexState(storage: LiBrainianStorage, state: IndexState): Promise<void> {
  const next: IndexState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await storage.setState(INDEX_STATE_KEY, JSON.stringify(next));
}

export function createIndexStateWriter(
  storage: LiBrainianStorage,
  options: { throttleMs?: number } = {}
): IndexStateWriter {
  let lastWriteAt = 0;
  let pending: IndexState | null = null;
  const throttleMs = options.throttleMs ?? DEFAULT_WRITE_THROTTLE_MS;

  const write = async (state: IndexState, writeOptions: { force?: boolean } = {}): Promise<void> => {
    const now = Date.now();
    if (!writeOptions.force && now - lastWriteAt < throttleMs) {
      pending = state;
      return;
    }
    lastWriteAt = now;
    pending = null;
    await setIndexState(storage, state);
  };

  const flush = async (): Promise<void> => {
    if (!pending) return;
    const next = pending;
    pending = null;
    await write(next, { force: true });
  };

  return { write, flush };
}

export function isReadyPhase(phase: IndexPhase): boolean {
  return phase === 'ready' || phase === 'incremental';
}

/** Default timeout for waiting for index to become ready (30 seconds) */
export const DEFAULT_INDEX_READY_TIMEOUT_MS = 30_000;

/**
 * Error thrown when waiting for index ready times out
 */
export class IndexNotReadyError extends Error {
  readonly phase: IndexPhase;
  readonly elapsedMs: number;

  constructor(phase: IndexPhase, elapsedMs: number) {
    super(
      `Bootstrap incomplete. Index phase is '${phase}' after ${Math.round(elapsedMs / 1000)}s. ` +
      `Run \`librarian bootstrap\` first.`
    );
    this.name = 'IndexNotReadyError';
    this.phase = phase;
    this.elapsedMs = elapsedMs;
  }
}

export async function waitForIndexReady(
  storage: LiBrainianStorage,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<IndexState> {
  // Default to 30 seconds instead of infinite wait (0)
  const timeoutMs = options.timeoutMs ?? DEFAULT_INDEX_READY_TIMEOUT_MS;
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
  const startedAt = Date.now();
  let state = await getIndexState(storage);
  if (isReadyPhase(state.phase)) return state;

  // Only allow infinite wait if explicitly requested with timeoutMs <= 0
  while (timeoutMs <= 0 || Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    state = await getIndexState(storage);
    if (isReadyPhase(state.phase)) return state;
  }

  // Timeout occurred - throw error with clear message
  const elapsedMs = Date.now() - startedAt;
  throw new IndexNotReadyError(state.phase, elapsedMs);
}
