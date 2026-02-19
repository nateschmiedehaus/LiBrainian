import type { IndexChangeEvent, LibrarianStorage } from '../storage/types.js';

export interface WatchPathsOptions {
  storage: LibrarianStorage;
  paths: string[];
  sinceVersion?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LIMIT = 200;

export async function* watchPaths(options: WatchPathsOptions): AsyncGenerator<IndexChangeEvent, void, void> {
  const pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS));
  let cursor =
    options.sinceVersion ??
    await options.storage.getIndexCoordinationVersion();

  while (!options.signal?.aborted) {
    const events = await options.storage.getIndexChangeEvents({
      sinceVersion: cursor,
      paths: options.paths,
      limit: DEFAULT_LIMIT,
    });

    if (events.length === 0) {
      await sleep(pollIntervalMs, options.signal);
      continue;
    }

    for (const event of events) {
      if (event.version > cursor) {
        cursor = event.version;
      }
      yield event;
    }
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
