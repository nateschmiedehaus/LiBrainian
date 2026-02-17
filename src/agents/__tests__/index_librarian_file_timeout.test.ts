/**
 * File timeout behavior tests for IndexLibrarian.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexLibrarian } from '../index_librarian.js';
import { globalEventBus } from '../../events.js';
import { checkAllProviders } from '../../api/provider_check.js';

// Skip in unit test mode (no real providers)
const IS_UNIT_MODE = process.env.LIBRARIAN_TEST_MODE === 'unit' || (!process.env.LIBRARIAN_TEST_MODE && !process.env.LIBRARIAN_TIER0);
const describeWithProviders = IS_UNIT_MODE ? describe.skip : describe;
import type { LibrarianStorage } from '../../storage/types.js';
import type { IndexingTask } from '../../types.js';
import type { FileIndexResult } from '../types.js';

vi.mock('../ast_indexer.js', () => ({
  AstIndexer: vi.fn().mockImplementation(() => ({
    indexFile: vi.fn(),
    setGovernorContext: vi.fn(),
  })),
}));

function createMockStorage(): LibrarianStorage {
  return {
    initialize: vi.fn(async () => undefined),
    isInitialized: vi.fn(() => true),
    getModules: vi.fn(async () => []),
    recordIndexingResult: vi.fn(async () => undefined),
  } as unknown as LibrarianStorage;
}

function buildTask(paths: string[]): IndexingTask {
  return {
    type: 'full',
    paths,
    priority: 'high',
    reason: 'test',
    triggeredBy: 'manual',
  };
}

function buildResult(filePath: string): FileIndexResult {
  return {
    filePath,
    functionsFound: 0,
    functionsIndexed: 0,
    moduleIndexed: false,
    contextPacksCreated: 0,
    durationMs: 5,
    errors: [],
  };
}

describeWithProviders('IndexLibrarian file timeouts', () => {
  beforeAll(async () => {
    const status = await checkAllProviders({ workspaceRoot: process.cwd(), forceProbe: false });
    if (!status.embedding.available) {
      throw new Error(
        `unverified_by_trace(provider_unavailable): Embedding: ${status.embedding.error ?? 'unavailable'}`
      );
    }
  });

  beforeEach(() => {
    globalEventBus.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalEventBus.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips a file after timeout when policy is skip', async () => {
    const storage = createMockStorage();
    const onFileSkipped = vi.fn();
    const librarian = new IndexLibrarian({
      createContextPacks: false,
      computeGraphMetrics: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
      fileTimeoutMs: 10,
      fileTimeoutRetries: 0,
      fileTimeoutPolicy: 'skip',
      onFileSkipped,
    });
    await librarian.initialize(storage);

    vi.spyOn(librarian, 'indexFile').mockImplementation(() => new Promise(() => {}));

    const task = buildTask(['timeout.ts']);
    const resultPromise = librarian.processTask(task);
    await vi.advanceTimersByTimeAsync(15);
    const result = await resultPromise;

    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toContain('file_timeout');
    expect(onFileSkipped).toHaveBeenCalledWith('timeout.ts', expect.stringContaining('file_timeout'));
  });

  it('retries then succeeds when fileTimeoutRetries > 0', async () => {
    const storage = createMockStorage();
    const onFileSkipped = vi.fn();
    const librarian = new IndexLibrarian({
      createContextPacks: false,
      computeGraphMetrics: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
      fileTimeoutMs: 10,
      fileTimeoutRetries: 1,
      fileTimeoutPolicy: 'skip',
      onFileSkipped,
    });
    await librarian.initialize(storage);

    const filePath = 'retry.ts';
    const fileSpy = vi
      .spyOn(librarian, 'indexFile')
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(buildResult(filePath));

    const task = buildTask([filePath]);
    const resultPromise = librarian.processTask(task);
    await vi.advanceTimersByTimeAsync(15);
    const result = await resultPromise;

    expect(result.errors).toHaveLength(0);
    expect(result.filesSkipped).toBe(0);
    expect(onFileSkipped).not.toHaveBeenCalled();
    expect(fileSpy).toHaveBeenCalledTimes(2);
  });

  it('fails when policy is retry and all attempts time out', async () => {
    const storage = createMockStorage();
    const librarian = new IndexLibrarian({
      createContextPacks: false,
      computeGraphMetrics: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
      fileTimeoutMs: 10,
      fileTimeoutRetries: 1,
      fileTimeoutPolicy: 'retry',
    });
    await librarian.initialize(storage);

    const fileSpy = vi.spyOn(librarian, 'indexFile').mockImplementation(() => new Promise(() => {}));

    const task = buildTask(['timeout.ts']);
    const resultPromise = librarian.processTask(task);
    const expectation = expect(resultPromise).rejects.toThrow('file_timeout');
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    expect(fileSpy).toHaveBeenCalledTimes(2);
  });

  it('reports progress and emits index_file events for mixed outcomes', async () => {
    const storage = createMockStorage();
    const progressCalls: Array<{ total: number; completed: number; currentFile?: string }> = [];
    const librarian = new IndexLibrarian({
      createContextPacks: false,
      computeGraphMetrics: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
      fileTimeoutMs: 10,
      fileTimeoutRetries: 0,
      fileTimeoutPolicy: 'skip',
      progressCallback: (progress) => progressCalls.push(progress),
    });
    await librarian.initialize(storage);

    vi.spyOn(librarian, 'indexFile').mockImplementation((filePath) => {
      if (filePath.includes('ok')) {
        return Promise.resolve(buildResult(filePath));
      }
      return new Promise(() => {});
    });

    const events: Array<{ filePath: string }> = [];
    const off = globalEventBus.on('index_file', (event) => {
      events.push({ filePath: event.data.filePath as string });
    });

    const task = buildTask(['ok.ts', 'timeout.ts']);
    const resultPromise = librarian.processTask(task);
    await vi.advanceTimersByTimeAsync(15);
    const result = await resultPromise;
    await vi.runAllTimersAsync();
    off();

    expect(result.filesProcessed).toBe(2);
    expect(result.filesSkipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(progressCalls.at(-1)).toEqual({ total: 2, completed: 2, currentFile: 'timeout.ts' });
    expect(events.map((event) => event.filePath)).toEqual(expect.arrayContaining(['ok.ts', 'timeout.ts']));
  });

  it('fails when policy is fail', async () => {
    const storage = createMockStorage();
    const librarian = new IndexLibrarian({
      createContextPacks: false,
      computeGraphMetrics: false,
      llmProvider: 'claude',
      llmModelId: 'claude-sonnet-4-20250514',
      fileTimeoutMs: 10,
      fileTimeoutRetries: 0,
      fileTimeoutPolicy: 'fail',
    });
    await librarian.initialize(storage);

    vi.spyOn(librarian, 'indexFile').mockImplementation(() => new Promise(() => {}));

    const task = buildTask(['timeout.ts']);
    const resultPromise = librarian.processTask(task);
    const expectation = expect(resultPromise).rejects.toThrow('file_timeout');
    await vi.advanceTimersByTimeAsync(15);
    await expectation;
  });
});
