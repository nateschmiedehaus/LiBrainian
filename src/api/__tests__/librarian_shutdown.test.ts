import { describe, expect, it, vi, beforeEach } from 'vitest';

const stopFileWatcherMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../integration/file_watcher.js', async () => {
  const actual = await vi.importActual<typeof import('../../integration/file_watcher.js')>('../../integration/file_watcher.js');
  return {
    ...actual,
    stopFileWatcher: stopFileWatcherMock,
  };
});

import { Librarian } from '../librarian.js';

describe('Librarian shutdown', () => {
  beforeEach(() => {
    stopFileWatcherMock.mockClear();
  });

  it('stops the file watcher before releasing owned resources', async () => {
    const shutdownIndexer = vi.fn().mockResolvedValue(undefined);
    const closeLedger = vi.fn().mockResolvedValue(undefined);
    const closeStorage = vi.fn().mockResolvedValue(undefined);
    const disposeEngines = vi.fn();

    const librarian = new Librarian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: true,
    });

    Object.assign(librarian as unknown as Record<string, unknown>, {
      fileWatcher: { stop: vi.fn() },
      indexer: { shutdown: shutdownIndexer },
      evidenceLedger: { close: closeLedger },
      storage: { close: closeStorage },
      engines: { dispose: disposeEngines },
      initialized: true,
      bootstrapped: true,
    });

    await librarian.shutdown();

    expect(stopFileWatcherMock).toHaveBeenCalledWith('/tmp/workspace');
    expect(shutdownIndexer).toHaveBeenCalledTimes(1);
    expect(closeLedger).toHaveBeenCalledTimes(1);
    expect(closeStorage).toHaveBeenCalledTimes(1);
    expect(disposeEngines).toHaveBeenCalledTimes(1);
    expect(librarian.isWatching()).toBe(false);
  });
});
