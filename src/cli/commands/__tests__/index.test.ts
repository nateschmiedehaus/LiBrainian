/**
 * @fileoverview Tests for index command
 *
 * Covers:
 * 1. File validation (outside workspace, non-existent)
 * 2. Bootstrap check
 * 3. Provider validation
 * 4. Partial reindex failure
 * 5. Verbose output
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { indexCommand, type IndexCommandOptions } from '../index.js';
import { Librarian } from '../../../api/librarian.js';
import { CliError } from '../../errors.js';
import { globalEventBus } from '../../../events.js';
import { getGitDiffNames, getGitStagedChanges, getGitStatusChanges, isGitRepo } from '../../../utils/git.js';

vi.mock('node:fs');
vi.mock('../../../api/librarian.js');
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
vi.mock('../../../utils/git.js', () => ({
  isGitRepo: vi.fn(() => true),
  getGitStatusChanges: vi.fn(async () => null),
  getGitStagedChanges: vi.fn(async () => null),
  getGitDiffNames: vi.fn(async () => null),
}));

describe('indexCommand', () => {
  const mockWorkspace = '/test/workspace';
  const mockFile1 = '/test/workspace/src/file1.ts';
  const mockFile2 = '/test/workspace/src/file2.ts';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockLibrarian: {
    initialize: Mock;
    getStatus: Mock;
    reindexFiles: Mock;
    shutdown: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set default environment variables for LLM provider
    process.env.LIBRARIAN_LLM_PROVIDER = 'claude';
    process.env.LIBRARIAN_LLM_MODEL = 'claude-3-haiku-20240307';
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockLibrarian = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({
        bootstrapped: true,
        stats: {
          totalFunctions: 100,
          totalModules: 10,
        },
      }),
      reindexFiles: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    (Librarian as unknown as Mock).mockImplementation(() => mockLibrarian);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p as string);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
    } as fs.Stats);
    vi.mocked(isGitRepo).mockReturnValue(true);
    vi.mocked(getGitStatusChanges).mockResolvedValue(null);
    vi.mocked(getGitStagedChanges).mockResolvedValue(null);
    vi.mocked(getGitDiffNames).mockResolvedValue(null);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    // Restore default environment variables
    process.env.LIBRARIAN_LLM_PROVIDER = 'claude';
    process.env.LIBRARIAN_LLM_MODEL = 'claude-3-haiku-20240307';
  });

  describe('Argument Validation', () => {
    it('should throw CliError when no files specified', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('No files specified');
      await expect(indexCommand(options)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    });

    it('should throw CliError when files array is empty', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
    });

    it('should reject multiple git selectors at once', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        incremental: true,
        staged: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('Use only one selector');
    });

    it('should reject incremental selectors outside git repositories', async () => {
      vi.mocked(isGitRepo).mockReturnValue(false);
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        incremental: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('require a git repository');
    });
  });

  describe('Git selectors', () => {
    it('indexes modified and added files for --incremental mode', async () => {
      vi.mocked(getGitStatusChanges).mockResolvedValue({
        added: ['src/new.ts'],
        modified: ['src/changed.ts'],
        deleted: ['src/deleted.ts'],
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        incremental: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/new.ts'),
        path.resolve(mockWorkspace, 'src/changed.ts'),
      ]);
    });

    it('indexes staged files for --staged mode', async () => {
      vi.mocked(getGitStagedChanges).mockResolvedValue({
        added: ['src/staged-new.ts'],
        modified: ['src/staged-change.ts'],
        deleted: [],
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        staged: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/staged-new.ts'),
        path.resolve(mockWorkspace, 'src/staged-change.ts'),
      ]);
    });

    it('indexes files changed since a ref for --since mode', async () => {
      vi.mocked(getGitDiffNames).mockResolvedValue({
        added: ['src/new-since.ts'],
        modified: [],
        deleted: [],
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        since: 'origin/main',
      };

      await indexCommand(options);

      expect(getGitDiffNames).toHaveBeenCalledWith(mockWorkspace, 'origin/main');
      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/new-since.ts'),
      ]);
    });

    it('fails when selector resolves no candidate files', async () => {
      vi.mocked(getGitStatusChanges).mockResolvedValue(null);
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        incremental: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('No modified files found to index');
    });
  });

  describe('File Validation - Non-existent Files', () => {
    it('should skip non-existent files and warn', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        return filePath === mockFile1;
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        force: true,
      };

      await indexCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('File not found'));
      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
    });

    it('should throw CliError when all files are non-existent', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('No valid files to index');
      await expect(indexCommand(options)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    });
  });

  describe('File Validation - Not a File', () => {
    it('should skip directories and warn', async () => {
      vi.mocked(fs.statSync).mockImplementation((filePath) => {
        if (filePath === mockFile1) {
          return { isFile: () => false } as fs.Stats;
        }
        return { isFile: () => true } as fs.Stats;
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        force: true,
      };

      await indexCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not a file'));
      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile2]);
    });
  });

  describe('File Validation - Outside Workspace', () => {
    it('should skip files outside workspace and warn', async () => {
      const outsideFile = '/other/location/file.ts';

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, outsideFile],
        force: true,
      };

      await indexCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('File outside workspace'));
      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
    });

    it('should handle relative paths that escape workspace', async () => {
      const escapingFile = '../../../etc/passwd';

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [escapingFile],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('No valid files to index');
    });

    it('should allow files within workspace subdirectories', async () => {
      const subFile = path.join(mockWorkspace, 'src/deep/nested/file.ts');

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [subFile],
        force: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([subFile]);
    });
  });

  describe('Bootstrap Check', () => {
    it('should throw CliError when not bootstrapped', async () => {
      mockLibrarian.getStatus.mockResolvedValue({
        bootstrapped: false,
        stats: {
          totalFunctions: 0,
          totalModules: 0,
        },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('Librarian not bootstrapped');
      await expect(indexCommand(options)).rejects.toThrow('Run "librarian bootstrap" first');
      await expect(indexCommand(options)).rejects.toMatchObject({
        code: 'NOT_BOOTSTRAPPED',
      });
    });

    it('should proceed when bootstrapped', async () => {
      mockLibrarian.getStatus.mockResolvedValue({
        bootstrapped: true,
        stats: {
          totalFunctions: 50,
          totalModules: 5,
        },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalled();
    });
  });

  describe('Librarian Initialization', () => {
    it('should initialize librarian with correct workspace', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(Librarian).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: mockWorkspace,
          autoBootstrap: false,
          autoWatch: false,
        })
      );
    });

    it('should use environment variable for LLM provider', async () => {
      process.env.LIBRARIAN_LLM_PROVIDER = 'codex';
      process.env.LIBRARIAN_LLM_MODEL = 'gpt-5.1-codex-mini';

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(Librarian).toHaveBeenCalledWith(
        expect.objectContaining({
          llmProvider: 'codex',
        })
      );

      delete process.env.LIBRARIAN_LLM_PROVIDER;
      delete process.env.LIBRARIAN_LLM_MODEL;
    });

    it('should proceed without LLM config when env vars are missing', async () => {
      delete process.env.LIBRARIAN_LLM_PROVIDER;
      delete process.env.LIBRARIAN_LLM_MODEL;

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(Librarian).toHaveBeenCalledWith(
        expect.objectContaining({
          llmProvider: undefined,
          llmModelId: undefined,
        })
      );
    });

    it('should use environment variable for LLM model ID', async () => {
      process.env.LIBRARIAN_LLM_MODEL = 'claude-3-opus-20240229';

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(Librarian).toHaveBeenCalledWith(
        expect.objectContaining({
          llmModelId: 'claude-3-opus-20240229',
        })
      );

      delete process.env.LIBRARIAN_LLM_MODEL;
    });
  });

  describe('Reindex Failure Handling', () => {
    it('should handle reindexFiles failure and throw CliError', async () => {
      const error = new Error('Provider unavailable');
      mockLibrarian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('Failed to index files');
      await expect(indexCommand(options)).rejects.toMatchObject({
        code: 'INDEX_FAILED',
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Indexing failed'));
    });

    it('should provide detailed error message for provider unavailable', async () => {
      const error = new Error('ProviderUnavailable: API key not configured');
      mockLibrarian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('LLM provider is unavailable')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('API credentials')
      );
    });

    it('should provide detailed error message for database lock', async () => {
      const error = new Error('Database error: SQLITE_BUSY');
      mockLibrarian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Database lock conflict')
      );
    });

    it('should provide detailed error message for parse errors', async () => {
      const error = new Error('Failed to extract function from source');
      mockLibrarian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to extract or parse')
      );
    });

    it('should show stack trace in verbose mode on error', async () => {
      const error = new Error('Test error with stack');
      error.stack = 'Error: Test error\n  at test.js:1:1';
      mockLibrarian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Stack trace:'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('at test.js:1:1'));
    });

    it('should ensure librarian.shutdown is called even on failure', async () => {
      const error = new Error('Indexing failed');
      mockLibrarian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(mockLibrarian.shutdown).toHaveBeenCalled();
    });

    it('should show final status on partial failure', async () => {
      const error = new Error('Partial failure');
      mockLibrarian.reindexFiles.mockRejectedValue(error);
      mockLibrarian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });
      mockLibrarian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 105, totalModules: 11 },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context packs for indexed files have been invalidated')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('105 functions, 11 modules')
      );
    });
  });

  describe('Verbose Output', () => {
    it('should list files when verbose is true', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        verbose: true,
        force: true,
      };

      await indexCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('file1.ts'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('file2.ts'));
    });

    it('should not list files when verbose is false', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        verbose: false,
        force: true,
      };

      await indexCommand(options);

      const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
      expect(logCalls).not.toContain('  - ');
    });

    it('should track entity events when verbose is true', async () => {
      const mockUnsubscribe = vi.fn();
      vi.mocked(globalEventBus.on).mockReturnValue(mockUnsubscribe);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      await indexCommand(options);

      expect(globalEventBus.on).toHaveBeenCalledWith('*', expect.any(Function));
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('should not track entity events when verbose is false', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: false,
        force: true,
      };

      await indexCommand(options);

      expect(globalEventBus.on).not.toHaveBeenCalled();
    });

    it('should show created entities in verbose mode', async () => {
      let eventHandler: ((event: any) => void) | null = null;
      let handlerResolve: () => void;
      const handlerReady = new Promise<void>((resolve) => {
        handlerResolve = resolve;
      });
      vi.mocked(globalEventBus.on).mockImplementation((eventType, handler) => {
        eventHandler = handler as (event: any) => void;
        handlerResolve();
        return vi.fn();
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      const indexPromise = indexCommand(options);
      await handlerReady;

      eventHandler!({
        type: 'entity_created',
        timestamp: new Date(),
        data: { entityId: 'test-entity-1' },
      });

      await indexPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created: test-entity-1'));
    });

    it('should show updated entities in verbose mode', async () => {
      let eventHandler: ((event: any) => void) | null = null;
      let handlerResolve: () => void;
      const handlerReady = new Promise<void>((resolve) => {
        handlerResolve = resolve;
      });
      vi.mocked(globalEventBus.on).mockImplementation((eventType, handler) => {
        eventHandler = handler as (event: any) => void;
        handlerResolve();
        return vi.fn();
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      const indexPromise = indexCommand(options);
      await handlerReady;

      eventHandler!({
        type: 'entity_updated',
        timestamp: new Date(),
        data: { entityId: 'test-entity-2' },
      });

      await indexPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated: test-entity-2'));
    });

    it('should show entity counts in verbose mode on success', async () => {
      let eventHandler: ((event: any) => void) | null = null;
      let handlerResolve: () => void;
      const handlerReady = new Promise<void>((resolve) => {
        handlerResolve = resolve;
      });
      vi.mocked(globalEventBus.on).mockImplementation((eventType, handler) => {
        eventHandler = handler as (event: any) => void;
        handlerResolve();
        return vi.fn();
      });

      mockLibrarian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });
      mockLibrarian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 105, totalModules: 11 },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      const indexPromise = indexCommand(options);
      await handlerReady;

      eventHandler!({
        type: 'entity_created',
        timestamp: new Date(),
        data: { entityId: 'entity-1' },
      });
      eventHandler!({
        type: 'entity_created',
        timestamp: new Date(),
        data: { entityId: 'entity-2' },
      });
      eventHandler!({
        type: 'entity_updated',
        timestamp: new Date(),
        data: { entityId: 'entity-3' },
      });

      await indexPromise;

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Entities created: 2'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Entities updated: 1'));
    });

    it('should show entity counts on partial failure in verbose mode', async () => {
      let eventHandler: ((event: any) => void) | null = null;
      let handlerResolve: () => void;
      const handlerReady = new Promise<void>((resolve) => {
        handlerResolve = resolve;
      });
      vi.mocked(globalEventBus.on).mockImplementation((eventType, handler) => {
        eventHandler = handler as (event: any) => void;
        handlerResolve();
        return vi.fn();
      });

      const error = new Error('Partial failure');
      mockLibrarian.reindexFiles.mockRejectedValue(error);
      mockLibrarian.getStatus.mockResolvedValue({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      const indexPromise = indexCommand(options);
      await handlerReady;

      eventHandler!({
        type: 'entity_created',
        timestamp: new Date(),
        data: { entityId: 'entity-1' },
      });

      await expect(indexPromise).rejects.toThrow(CliError);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Partial progress before failure')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Entities created: 1'));
    });
  });

  describe('Successful Indexing', () => {
    it('should complete successfully with valid files', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        force: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.initialize).toHaveBeenCalled();
      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile1, mockFile2]);
      expect(mockLibrarian.shutdown).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Indexing successful'));
    });

    it('should show duration and file count on success', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, mockFile2],
        force: true,
      };

      await indexCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Duration:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Files indexed: 2'));
    });

    it('should show updated totals on success', async () => {
      mockLibrarian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });
      mockLibrarian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 110, totalModules: 12 },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('New totals: 110 functions, 12 modules')
      );
    });
  });

  describe('Relative Path Handling', () => {
    it('should resolve relative paths from workspace', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: ['src/file1.ts'],
        force: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
    });

    it('should handle absolute paths', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
    });

    it('should handle mixed absolute and relative paths', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, 'src/file2.ts'],
        force: true,
      };

      await indexCommand(options);

      expect(mockLibrarian.reindexFiles).toHaveBeenCalledWith([mockFile1, mockFile2]);
    });
  });

  describe('Workspace Handling', () => {
    it('should use provided workspace', async () => {
      const customWorkspace = '/custom/workspace';
      const customFile = '/custom/workspace/test.ts';

      const options: IndexCommandOptions = {
        workspace: customWorkspace,
        files: [customFile],
        force: true,
      };

      await indexCommand(options);

      expect(Librarian).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: customWorkspace,
        })
      );
    });

    it('should use process.cwd() when workspace not provided', async () => {
      const cwd = process.cwd();
      const cwdFile = path.join(cwd, 'test.ts');

      const options: IndexCommandOptions = {
        files: [cwdFile],
        force: true,
      };

      await indexCommand(options);

      expect(Librarian).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: cwd,
        })
      );
    });
  });
});
