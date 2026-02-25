import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeFileChecksum } from '../../utils/checksums.js';
import { getCurrentGitSha, getGitDiffNames, getGitStatusChanges } from '../../utils/git.js';

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
}));

let startFileWatcher: typeof import('../file_watcher.js').startFileWatcher;
let stopFileWatcher: typeof import('../file_watcher.js').stopFileWatcher;
let logger: typeof import('../../telemetry/logger.js');

vi.mock('../../utils/git.js', () => ({
  getCurrentGitSha: vi.fn(),
  getGitDiffNames: vi.fn(),
  getGitStatusChanges: vi.fn(),
}));

type StorageStub = {
  getFileChecksum(filePath: string): Promise<string | null>;
  getState(key: string): Promise<string | null>;
  setState(key: string, value: string): Promise<void>;
  getFiles?(): Promise<Array<{ path: string; lastModified: string }>>;
  getModuleByPath?(filePath: string): Promise<{ id: string; path: string } | null>;
  getGraphEdges?(options: { edgeTypes: string[]; toIds: string[]; fromTypes: string[] }): Promise<Array<{ fromId: string; toId: string }>>;
  getModule?(id: string): Promise<{ id: string; path: string } | null>;
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitForCondition = async (
  condition: () => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> => {
  const timeoutMs = options?.timeoutMs ?? 500;
  const intervalMs = options?.intervalMs ?? 20;
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

const createTempWorkspace = async (): Promise<string> => {
  return fs.mkdtemp(path.join(os.tmpdir(), 'librarian-file-watcher-'));
};

describe('file_watcher', () => {
  const workspaceRoots = new Set<string>();

  const registerWorkspace = (workspaceRoot: string): string => {
    workspaceRoots.add(workspaceRoot);
    return workspaceRoot;
  };

  beforeEach(async () => {
    ({ startFileWatcher, stopFileWatcher } = await import('../file_watcher.js'));
    logger = await import('../../telemetry/logger.js');
    vi.mocked(getCurrentGitSha).mockResolvedValue(null);
    vi.mocked(getGitDiffNames).mockResolvedValue(null);
    vi.mocked(getGitStatusChanges).mockResolvedValue(null);
    vi.mocked(logger.logWarning).mockClear();
  });

  afterEach(async () => {
    await flushPromises();
    for (const workspaceRoot of workspaceRoots) {
      await stopFileWatcher(workspaceRoot);
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
    workspaceRoots.clear();
  });

  it('does not spam reconcile warnings when storage lacks getFiles', async () => {
    const workspaceRoot = registerWorkspace(await createTempWorkspace());
    const filePath = path.join(workspaceRoot, 'src', 'a.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const a = 1;\n', 'utf8');

    const checksum = computeFileChecksum(await fs.readFile(filePath, 'utf8'));
    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum(fp) {
        return fp === filePath ? checksum : null;
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
    };

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as { reindexFiles: (paths: string[]) => Promise<void> };
    const handle = startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      watch: (_root, _options, _callback) => {
        return { close: () => {} } as any;
      },
    });

    // Force a second reconcile attempt. This should not emit a second warning.
    handle.attachStorage?.(storage as any);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    const reconcileWarnings = vi
      .mocked(logger.logWarning)
      .mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('Watch reconcile disabled'));
    expect(reconcileWarnings).toHaveLength(1);

  });

  it('skips reindex when file checksum unchanged', async () => {
    const workspaceRoot = registerWorkspace(await createTempWorkspace());
    const filePath = path.join(workspaceRoot, 'src', 'a.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const a = 1;\n', 'utf8');

    const checksum = computeFileChecksum(await fs.readFile(filePath, 'utf8'));
    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum(fp) {
        return fp === filePath ? checksum : null;
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
    };

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as { reindexFiles: (paths: string[]) => Promise<void> };
    let captured: ((event: string, filename: any) => void) | null = null;
    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      watch: (root, options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as unknown as (event: string, filename: string) => void)('change', 'src/a.ts');

    await new Promise((resolve) => setTimeout(resolve, 80));
    await flushPromises();

    expect(librarian.reindexFiles).not.toHaveBeenCalled();
  });

  it('reindexes when file checksum differs', async () => {
    const workspaceRoot = registerWorkspace(await createTempWorkspace());
    const filePath = path.join(workspaceRoot, 'src', 'b.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const b = 1;\n', 'utf8');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum(fp) {
        return fp === filePath ? 'deadbeefdeadbeef' : null;
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
    };

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as { reindexFiles: (paths: string[]) => Promise<void> };
    let captured: ((event: string, filename: any) => void) | null = null;
    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      watch: (root, options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as unknown as (event: string, filename: string) => void)('change', 'src/b.ts');

    await new Promise((resolve) => setTimeout(resolve, 80));
    // Regression guard: full-suite runs can delay debounce + async reindex work, so
    // assertions must wait for the call boundary instead of relying on fixed sleeps.
    await waitForCondition(
      () => vi.mocked(librarian.reindexFiles).mock.calls.length > 0,
      { timeoutMs: 1000 },
    );
    await flushPromises();

    expect(librarian.reindexFiles).toHaveBeenCalledTimes(1);
    expect(librarian.reindexFiles).toHaveBeenCalledWith([filePath]);
  });

  it('batches multiple changes within the batch window', async () => {
    const workspaceRoot = registerWorkspace(await createTempWorkspace());
    const fileA = path.join(workspaceRoot, 'src', 'a.ts');
    const fileB = path.join(workspaceRoot, 'src', 'b.ts');
    await fs.mkdir(path.dirname(fileA), { recursive: true });
    await fs.writeFile(fileA, 'export const a = 1;\n', 'utf8');
    await fs.writeFile(fileB, 'export const b = 2;\n', 'utf8');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum() {
        return 'mismatch';
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      async getFiles() {
        const timestamp = new Date().toISOString();
        return [
          { path: fileA, lastModified: timestamp },
          { path: fileB, lastModified: timestamp },
        ];
      },
    };

    const reindexFiles = vi.fn(async (_paths: string[]) => {});
    const librarian = { reindexFiles } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };
    let captured: ((event: string, filename: any) => void) | null = null;

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      batchWindowMs: 50,
      stormThreshold: 1000,
      watch: (_root, _options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as (event: string, filename: string) => void)('change', 'src/a.ts');
    (captured as (event: string, filename: string) => void)('change', 'src/b.ts');

    // Wait for debounce (50ms min) + batch window (50ms) + async operations
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    await flushPromises();

    expect(librarian.reindexFiles).toHaveBeenCalledTimes(1);
    const call = reindexFiles.mock.calls[0]?.[0] ?? [];
    expect(new Set(call)).toEqual(new Set([fileA, fileB]));

    stopFileWatcher(workspaceRoot);
  });

  it('flags watch state on event storms', async () => {
    const workspaceRoot = await createTempWorkspace();
    const fileA = path.join(workspaceRoot, 'src', 'storm-a.ts');
    const fileB = path.join(workspaceRoot, 'src', 'storm-b.ts');
    const fileC = path.join(workspaceRoot, 'src', 'storm-c.ts');
    await fs.mkdir(path.dirname(fileA), { recursive: true });
    await fs.writeFile(fileA, 'export const a = 1;\n', 'utf8');
    await fs.writeFile(fileB, 'export const b = 2;\n', 'utf8');
    await fs.writeFile(fileC, 'export const c = 3;\n', 'utf8');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum() {
        return 'mismatch';
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      async getFiles() {
        const timestamp = new Date().toISOString();
        return [
          { path: fileA, lastModified: timestamp },
          { path: fileB, lastModified: timestamp },
          { path: fileC, lastModified: timestamp },
        ];
      },
    };

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };
    let captured: ((event: string, filename: any) => void) | null = null;

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      batchWindowMs: 50,
      stormThreshold: 2,
      watch: (_root, _options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as (event: string, filename: string) => void)('change', 'src/storm-a.ts');
    (captured as (event: string, filename: string) => void)('change', 'src/storm-b.ts');
    (captured as (event: string, filename: string) => void)('change', 'src/storm-c.ts');

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    expect(librarian.reindexFiles).not.toHaveBeenCalled();
    const watchStateRaw = states.get('librarian.watch_state.v1');
    expect(watchStateRaw).toBeDefined();
    const watchState = JSON.parse(watchStateRaw ?? '{}') as { last_error?: string };
    expect(watchState.last_error).toBe('watch_event_storm');

    stopFileWatcher(workspaceRoot);
  });

  it('warns once and disables reconcile when storage lacks getFiles', async () => {
    const workspaceRoot = await createTempWorkspace();
    const fileA = path.join(workspaceRoot, 'src', 'storm-a.ts');
    const fileB = path.join(workspaceRoot, 'src', 'storm-b.ts');
    const fileC = path.join(workspaceRoot, 'src', 'storm-c.ts');
    await fs.mkdir(path.dirname(fileA), { recursive: true });
    await fs.writeFile(fileA, 'export const a = 1;\n', 'utf8');
    await fs.writeFile(fileB, 'export const b = 2;\n', 'utf8');
    await fs.writeFile(fileC, 'export const c = 3;\n', 'utf8');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum() {
        return 'mismatch';
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      // getFiles intentionally omitted
    };

    const warnSpy = vi.spyOn(logger, 'logWarning');
    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };
    let captured: ((event: string, filename: any) => void) | null = null;

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      batchWindowMs: 50,
      stormThreshold: 2,
      watch: (_root, _options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as (event: string, filename: string) => void)('change', 'src/storm-a.ts');
    (captured as (event: string, filename: string) => void)('change', 'src/storm-b.ts');
    (captured as (event: string, filename: string) => void)('change', 'src/storm-c.ts');

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    const reconcileWarnings = warnSpy.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('Watch reconcile disabled')
    );
    expect(reconcileWarnings).toHaveLength(1);

    stopFileWatcher(workspaceRoot);
    warnSpy.mockRestore();
  });

  it('warns once and disables cascade when storage lacks graph methods', async () => {
    const workspaceRoot = await createTempWorkspace();
    const filePath = path.join(workspaceRoot, 'src', 'cascade.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const cascade = 1;\n', 'utf8');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum() {
        return 'mismatch';
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      async getFiles() {
        return [{ path: filePath, lastModified: '3000-01-01T00:00:00.000Z' }];
      },
      // getModuleByPath/getGraphEdges/getModule intentionally omitted
    };

    const warnSpy = vi.spyOn(logger, 'logWarning');
    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };
    let captured: ((event: string, filename: any) => void) | null = null;

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      cascadeReindex: true,
      watch: (_root, _options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as (event: string, filename: string) => void)('change', 'src/cascade.ts');
    (captured as (event: string, filename: string) => void)('change', 'src/cascade.ts');

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    const cascadeWarnings = warnSpy.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('Cascade reindex disabled')
    );
    expect(cascadeWarnings).toHaveLength(1);

    stopFileWatcher(workspaceRoot);
    warnSpy.mockRestore();
  });

  it('updates git cursor after incremental reindex', async () => {
    const workspaceRoot = await createTempWorkspace();
    const filePath = path.join(workspaceRoot, 'src', 'cursor.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const cursor = true;\n', 'utf8');

    vi.mocked(getCurrentGitSha)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('abc123');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum() {
        return 'mismatch';
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      async getFiles() {
        return [];
      },
    };

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };
    let captured: ((event: string, filename: any) => void) | null = null;

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      watch: (_root, _options, callback) => {
        captured = callback;
        return { close: () => {} } as any;
      },
    });

    if (!captured) throw new Error('Expected file watcher callback to be registered');
    (captured as (event: string, filename: string) => void)('change', 'src/cursor.ts');

    await new Promise((resolve) => setTimeout(resolve, 120));
    await flushPromises();

    const watchStateRaw = states.get('librarian.watch_state.v1');
    expect(watchStateRaw).toBeDefined();
    const watchState = JSON.parse(watchStateRaw ?? '{}') as { cursor?: { kind?: string; lastIndexedCommitSha?: string } };
    expect(watchState.cursor?.kind).toBe('git');
    expect(watchState.cursor?.lastIndexedCommitSha).toBe('abc123');

    stopFileWatcher(workspaceRoot);
  });

  describe('cascade reindex', () => {
    it('queues dependent files for cascade reindex when a file changes', async () => {
      const workspaceRoot = await createTempWorkspace();
      const changedFile = path.join(workspaceRoot, 'src', 'utils.ts');
      const dependentFile = path.join(workspaceRoot, 'src', 'main.ts');
      await fs.mkdir(path.dirname(changedFile), { recursive: true });
      await fs.writeFile(changedFile, 'export const util = 1;\n', 'utf8');
      await fs.writeFile(dependentFile, 'import { util } from "./utils";\n', 'utf8');

      const states = new Map<string, string>();
      const storage: StorageStub = {
        async getFileChecksum() {
          return 'oldchecksum12345'; // Different checksum triggers reindex
        },
        async getState(key) {
          return states.get(key) ?? null;
        },
        async setState(key, value) {
          states.set(key, value);
        },
        async getModuleByPath(fp) {
          if (fp === changedFile) return { id: 'mod-utils', path: changedFile };
          if (fp === dependentFile) return { id: 'mod-main', path: dependentFile };
          return null;
        },
        async getGraphEdges(options) {
          // main.ts imports utils.ts
          if (options.toIds.includes('mod-utils')) {
            return [{ fromId: 'mod-main', toId: 'mod-utils' }];
          }
          return [];
        },
        async getModule(id) {
          if (id === 'mod-utils') return { id: 'mod-utils', path: changedFile };
          if (id === 'mod-main') return { id: 'mod-main', path: dependentFile };
          return null;
        },
      };

      const reindexCalls: string[][] = [];
      const librarian = {
        reindexFiles: vi.fn(async (paths: string[]) => {
          reindexCalls.push([...paths]);
        }),
      };

      let captured: ((event: string, filename: any) => void) | null = null;
      startFileWatcher({
        workspaceRoot,
        librarian: librarian as any,
        storage: storage as any,
        debounceMs: 10,
        cascadeReindex: true,
        cascadeDelayMs: 50, // Short delay for testing
        cascadeBatchSize: 5,
        watch: (root, options, callback) => {
          captured = callback;
          return { close: () => {} } as any;
        },
      });

      if (!captured) throw new Error('Expected file watcher callback to be registered');
      (captured as (event: string, filename: string) => void)('change', 'src/utils.ts');

      await waitForCondition(() => reindexCalls.length >= 1, { timeoutMs: 600 });
      expect(reindexCalls[0]).toContain(changedFile);

      await waitForCondition(() => reindexCalls.length >= 2, { timeoutMs: 800 });
      expect(reindexCalls[1]).toContain(dependentFile);

      stopFileWatcher(workspaceRoot);
    });

    it('does not cascade reindex when disabled', async () => {
      const workspaceRoot = await createTempWorkspace();
      const changedFile = path.join(workspaceRoot, 'src', 'lib.ts');
      const dependentFile = path.join(workspaceRoot, 'src', 'app.ts');
      await fs.mkdir(path.dirname(changedFile), { recursive: true });
      await fs.writeFile(changedFile, 'export const lib = 1;\n', 'utf8');
      await fs.writeFile(dependentFile, 'import { lib } from "./lib";\n', 'utf8');

      const states = new Map<string, string>();
      const storage: StorageStub = {
        async getFileChecksum() {
          return 'oldchecksum12345';
        },
        async getState(key) {
          return states.get(key) ?? null;
        },
        async setState(key, value) {
          states.set(key, value);
        },
        async getModuleByPath(fp) {
          if (fp === changedFile) return { id: 'mod-lib', path: changedFile };
          if (fp === dependentFile) return { id: 'mod-app', path: dependentFile };
          return null;
        },
        async getGraphEdges(options) {
          if (options.toIds.includes('mod-lib')) {
            return [{ fromId: 'mod-app', toId: 'mod-lib' }];
          }
          return [];
        },
        async getModule(id) {
          if (id === 'mod-lib') return { id: 'mod-lib', path: changedFile };
          if (id === 'mod-app') return { id: 'mod-app', path: dependentFile };
          return null;
        },
      };

      const reindexCalls: string[][] = [];
      const librarian = {
        reindexFiles: vi.fn(async (paths: string[]) => {
          reindexCalls.push([...paths]);
        }),
      };

      let captured: ((event: string, filename: any) => void) | null = null;
      startFileWatcher({
        workspaceRoot,
        librarian: librarian as any,
        storage: storage as any,
        debounceMs: 10,
        cascadeReindex: false, // Disabled
        watch: (root, options, callback) => {
          captured = callback;
          return { close: () => {} } as any;
        },
      });

      if (!captured) throw new Error('Expected file watcher callback to be registered');
      (captured as (event: string, filename: string) => void)('change', 'src/lib.ts');

      // Wait for initial reindex and potential cascade
      await new Promise((resolve) => setTimeout(resolve, 200));
      await flushPromises();

      // Only the changed file should be reindexed, not dependents
      expect(reindexCalls.length).toBe(1);
      expect(reindexCalls[0]).toContain(changedFile);

      stopFileWatcher(workspaceRoot);
    });

    it('handles files with no dependents gracefully', async () => {
      const workspaceRoot = await createTempWorkspace();
      const changedFile = path.join(workspaceRoot, 'src', 'standalone.ts');
      await fs.mkdir(path.dirname(changedFile), { recursive: true });
      await fs.writeFile(changedFile, 'export const standalone = 1;\n', 'utf8');

      const states = new Map<string, string>();
      const storage: StorageStub = {
        async getFileChecksum() {
          return 'oldchecksum12345';
        },
        async getState(key) {
          return states.get(key) ?? null;
        },
        async setState(key, value) {
          states.set(key, value);
        },
        async getModuleByPath(fp) {
          if (fp === changedFile) return { id: 'mod-standalone', path: changedFile };
          return null;
        },
        async getGraphEdges() {
          return []; // No dependents
        },
        async getModule(id) {
          if (id === 'mod-standalone') return { id: 'mod-standalone', path: changedFile };
          return null;
        },
      };

      const reindexCalls: string[][] = [];
      const librarian = {
        reindexFiles: vi.fn(async (paths: string[]) => {
          reindexCalls.push([...paths]);
        }),
      };

      let captured: ((event: string, filename: any) => void) | null = null;
      startFileWatcher({
        workspaceRoot,
        librarian: librarian as any,
        storage: storage as any,
        debounceMs: 10,
        cascadeReindex: true,
        cascadeDelayMs: 50,
        watch: (root, options, callback) => {
          captured = callback;
          return { close: () => {} } as any;
        },
      });

      if (!captured) throw new Error('Expected file watcher callback to be registered');
      (captured as (event: string, filename: string) => void)('change', 'src/standalone.ts');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));
      await flushPromises();

      // Only the changed file should be reindexed
      expect(reindexCalls.length).toBe(1);
      expect(reindexCalls[0]).toContain(changedFile);

      stopFileWatcher(workspaceRoot);
    });
  });

  it('reconciles workspace on start and reindexes newly discovered files', async () => {
    const workspaceRoot = await createTempWorkspace();
    const filePath = path.join(workspaceRoot, 'src', 'reconcile.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const reconcile = true;\n', 'utf8');

    const states = new Map<string, string>();
    const storage: StorageStub = {
      async getFileChecksum() {
        return null;
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      async getFiles() {
        return [];
      },
    };

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      watch: (_root, _options, _callback) => {
        return { close: () => {} } as any;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    expect(librarian.reindexFiles).toHaveBeenCalled();
    expect(librarian.reindexFiles).toHaveBeenCalledWith([filePath]);

    const watchStateRaw = states.get('librarian.watch_state.v1');
    expect(watchStateRaw).toBeDefined();
    const watchState = JSON.parse(watchStateRaw ?? '{}') as { needs_catchup?: boolean };
    expect(watchState.needs_catchup).toBe(false);

    await stopFileWatcher(workspaceRoot);
  });

  it('reconciles using git cursor when available', async () => {
    const workspaceRoot = await createTempWorkspace();
    const filePath = path.join(workspaceRoot, 'src', 'git-reconcile.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'export const git = true;\n', 'utf8');

    const states = new Map<string, string>();
    states.set('librarian.watch_state.v1', JSON.stringify({
      schema_version: 1,
      workspace_root: workspaceRoot,
      cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
    }));

    const storage: StorageStub = {
      async getFileChecksum() {
        return null;
      },
      async getState(key) {
        return states.get(key) ?? null;
      },
      async setState(key, value) {
        states.set(key, value);
      },
      async getFiles() {
        return [{ path: filePath, lastModified: '3000-01-01T00:00:00.000Z' }];
      },
    };

    vi.mocked(getGitDiffNames).mockResolvedValue({
      added: [],
      modified: ['src/git-reconcile.ts'],
      deleted: [],
      renamed: [],
    });
    vi.mocked(getGitStatusChanges).mockResolvedValue({
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
    });
    vi.mocked(getCurrentGitSha).mockResolvedValue('def456');

    const librarian = { reindexFiles: vi.fn(async () => {}) } as unknown as {
      reindexFiles: (paths: string[]) => Promise<void>;
    };

    startFileWatcher({
      workspaceRoot,
      librarian: librarian as any,
      storage: storage as any,
      debounceMs: 10,
      watch: (_root, _options, _callback) => {
        return { close: () => {} } as any;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();

    expect(librarian.reindexFiles).toHaveBeenCalledWith([filePath]);

    const watchStateRaw = states.get('librarian.watch_state.v1');
    expect(watchStateRaw).toBeDefined();
    const watchState = JSON.parse(watchStateRaw ?? '{}') as { cursor?: { kind?: string; lastIndexedCommitSha?: string } };
    expect(watchState.cursor?.kind).toBe('git');
    expect(watchState.cursor?.lastIndexedCommitSha).toBe('def456');

    await stopFileWatcher(workspaceRoot);
  });
});
