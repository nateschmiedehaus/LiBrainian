import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { startWatchSession } from '../watch.js';
import { Librarian } from '../../../api/librarian.js';
import { startFileWatcher, stopFileWatcher } from '../../../integration/file_watcher.js';
import { globalEventBus } from '../../../events.js';
import { CliError } from '../../errors.js';
import { resolveWorkspaceRoot } from '../../../utils/workspace_resolver.js';

vi.mock('../../../api/librarian.js');
vi.mock('../../../integration/file_watcher.js', () => ({
  startFileWatcher: vi.fn(() => ({ stop: vi.fn() })),
  stopFileWatcher: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../events.js', async () => {
  const actual = await vi.importActual('../../../events.js');
  return {
    ...actual,
    globalEventBus: {
      on: vi.fn(() => vi.fn()),
      emit: vi.fn(),
      off: vi.fn(),
      clear: vi.fn(),
    },
  };
});
vi.mock('../../../utils/workspace_resolver.js', () => ({
  resolveWorkspaceRoot: vi.fn(),
}));

describe('startWatchSession', () => {
  const mockWorkspace = '/test/workspace';
  const mockStorage = { storageId: 'mock' };

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockLibrarian: {
    initialize: Mock;
    getStatus: Mock;
    getStorage: Mock;
    shutdown: Mock;
  };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Save original env
    originalEnv = { ...process.env };

    vi.mocked(startFileWatcher).mockImplementation(() => ({ stop: vi.fn() }));
    vi.mocked(stopFileWatcher).mockResolvedValue(undefined);

    mockLibrarian = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({
        bootstrapped: true,
        stats: {
          totalFunctions: 1,
          totalModules: 1,
        },
      }),
      getStorage: vi.fn().mockReturnValue(mockStorage),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    (Librarian as unknown as Mock).mockImplementation(() => mockLibrarian);
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: mockWorkspace,
      workspace: mockWorkspace,
      changed: false,
      sourceFileCount: 0,
      reason: 'no_candidate',
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    // Restore original env
    process.env = originalEnv;
  });

  it('passes librarian and storage to startFileWatcher when available', async () => {
    const session = await startWatchSession({
      workspace: mockWorkspace,
      quiet: true,
    });

    expect(startFileWatcher).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: mockWorkspace,
      librarian: mockLibrarian,
      storage: mockStorage,
    }));

    await session.shutdown();
    expect(stopFileWatcher).toHaveBeenCalledWith(mockWorkspace);
  });

  it('uses resolved workspace when auto-detect changes', async () => {
    vi.mocked(resolveWorkspaceRoot).mockReturnValue({
      original: mockWorkspace,
      workspace: '/resolved/workspace',
      changed: true,
      reason: 'marker:.git',
      confidence: 0.9,
      marker: '.git',
      sourceFileCount: 0,
      candidateFileCount: 12,
    });

    const session = await startWatchSession({
      workspace: mockWorkspace,
      quiet: true,
    });

    expect(startFileWatcher).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/resolved/workspace',
    }));

    await session.shutdown();
    expect(stopFileWatcher).toHaveBeenCalledWith('/resolved/workspace');
  });

  it('passes librarian without storage when storage is not available', async () => {
    mockLibrarian.getStorage.mockReturnValue(null);

    const session = await startWatchSession({
      workspace: mockWorkspace,
      quiet: true,
    });

    expect(startFileWatcher).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: mockWorkspace,
      librarian: mockLibrarian,
      storage: undefined,
    }));

    await session.shutdown();
  });

  it('passes debounceMs option to startFileWatcher', async () => {
    const session = await startWatchSession({
      workspace: mockWorkspace,
      debounceMs: 500,
      quiet: true,
    });

    expect(startFileWatcher).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: mockWorkspace,
      librarian: mockLibrarian,
      storage: mockStorage,
      debounceMs: 500,
      batchWindowMs: 500,
      stormThreshold: 200,
    }));

    await session.shutdown();
  });

  describe('LLM config resolution', () => {
    it('passes LLM provider/model from env when present', async () => {
      process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
      process.env.LIBRARIAN_LLM_MODEL = 'gpt-5.1-codex-mini';

      const session = await startWatchSession({ workspace: mockWorkspace, quiet: true });

      expect(Librarian).toHaveBeenCalledWith(expect.objectContaining({
        llmProvider: 'codex',
        llmModelId: 'gpt-5.1-codex-mini',
      }));

      await session.shutdown();
    });

    it('does not pass invalid LLM provider env value', async () => {
      process.env.LIBRARIAN_LLM_PROVIDER = 'not-a-provider';
      process.env.LIBRARIAN_LLM_MODEL = 'some-model';

      const session = await startWatchSession({ workspace: mockWorkspace, quiet: true });

      expect(Librarian).toHaveBeenCalledWith(expect.objectContaining({
        llmProvider: undefined,
        llmModelId: undefined,
      }));

      await session.shutdown();
    });
  });

  it('throws CliError when not bootstrapped', async () => {
    mockLibrarian.getStatus.mockResolvedValue({
      bootstrapped: false,
      stats: {
        totalFunctions: 0,
        totalModules: 0,
      },
    });

    await expect(startWatchSession({ workspace: mockWorkspace, quiet: true }))
      .rejects
      .toThrow(expect.objectContaining({
        code: 'NOT_BOOTSTRAPPED',
        message: expect.stringContaining('bootstrap'),
      }));
  });

  it('calls shutdown methods in correct order', async () => {
    const mockUnsubscribe = vi.fn();
    const mockHandleStop = vi.fn().mockResolvedValue(undefined);

    (globalEventBus.on as Mock).mockReturnValue(mockUnsubscribe);
    (startFileWatcher as Mock).mockReturnValue({ stop: mockHandleStop });

    const session = await startWatchSession({
      workspace: mockWorkspace,
      quiet: true,
    });

    await session.shutdown();

    // Verify shutdown sequence
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockHandleStop).toHaveBeenCalled();
    expect(stopFileWatcher).toHaveBeenCalledWith(mockWorkspace);
    expect(mockLibrarian.shutdown).toHaveBeenCalled();
  });

  describe('error handling', () => {
    it('throws when librarian.initialize() fails', async () => {
      const initError = new Error('Storage unavailable');
      mockLibrarian.initialize.mockRejectedValue(initError);

      await expect(startWatchSession({ workspace: mockWorkspace, quiet: true }))
        .rejects
        .toThrow('Storage unavailable');

      expect(mockLibrarian.initialize).toHaveBeenCalled();
      expect(startFileWatcher).not.toHaveBeenCalled();
    });

    it('throws when librarian.initialize() times out', async () => {
      const timeoutError = new Error('Initialization timeout');
      mockLibrarian.initialize.mockRejectedValue(timeoutError);

      await expect(startWatchSession({ workspace: mockWorkspace, quiet: true }))
        .rejects
        .toThrow('Initialization timeout');

      expect(mockLibrarian.initialize).toHaveBeenCalled();
      expect(startFileWatcher).not.toHaveBeenCalled();
    });

    it('throws when librarian.getStatus() fails', async () => {
      const statusError = new Error('Failed to retrieve status');
      mockLibrarian.getStatus.mockRejectedValue(statusError);

      await expect(startWatchSession({ workspace: mockWorkspace, quiet: true }))
        .rejects
        .toThrow('Failed to retrieve status');

      expect(mockLibrarian.initialize).toHaveBeenCalled();
      expect(mockLibrarian.getStatus).toHaveBeenCalled();
      expect(startFileWatcher).not.toHaveBeenCalled();
    });

    it('throws when startFileWatcher() fails', async () => {
      const watcherError = new Error('Failed to start file watcher');
      (startFileWatcher as Mock).mockImplementation(() => {
        throw watcherError;
      });

      await expect(startWatchSession({ workspace: mockWorkspace, quiet: true }))
        .rejects
        .toThrow('Failed to start file watcher');

      expect(mockLibrarian.initialize).toHaveBeenCalled();
      expect(mockLibrarian.getStatus).toHaveBeenCalled();
      expect(startFileWatcher).toHaveBeenCalled();
    });

    it('handles errors when storage.getStorage() throws', async () => {
      mockLibrarian.getStorage.mockImplementation(() => {
        throw new Error('Storage access error');
      });

      const session = await startWatchSession({
        workspace: mockWorkspace,
        quiet: true,
      });

      // Should continue without storage
      expect(startFileWatcher).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRoot: mockWorkspace,
        librarian: mockLibrarian,
        storage: undefined,
      }));

      await session.shutdown();
    });
  });
});
