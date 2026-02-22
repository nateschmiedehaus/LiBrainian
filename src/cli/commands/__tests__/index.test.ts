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
import { LiBrainian } from '../../../api/librarian.js';
import { CliError } from '../../errors.js';
import { globalEventBus } from '../../../events.js';
import { acquireWorkspaceLock } from '../../../integration/workspace_lock.js';
import { getGitDiffNames, getGitFileContentAtRef, getGitStagedChanges, getGitStatusChanges, isGitRepo } from '../../../utils/git.js';
import { setDefaultLlmServiceFactory } from '../../../adapters/llm_service.js';
import { createCliLlmServiceFactory } from '../../../adapters/cli_llm_service.js';

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
  getGitFileContentAtRef: vi.fn(() => null),
}));
vi.mock('../../../integration/workspace_lock.js', () => ({
  acquireWorkspaceLock: vi.fn(async () => ({
    lockPath: '/test/workspace/.librarian/bootstrap.lock',
    state: { pid: 1234, startedAt: new Date().toISOString() },
    release: vi.fn(async () => undefined),
  })),
}));
vi.mock('../../../adapters/llm_service.js', () => ({
  setDefaultLlmServiceFactory: vi.fn(),
}));
vi.mock('../../../adapters/cli_llm_service.js', () => ({
  createCliLlmServiceFactory: vi.fn(() => vi.fn()),
}));

describe('indexCommand', () => {
  const mockWorkspace = '/test/workspace';
  const mockFile1 = '/test/workspace/src/file1.ts';
  const mockFile2 = '/test/workspace/src/file2.ts';

  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let mockLiBrainian: {
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
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockLiBrainian = {
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

    (LiBrainian as unknown as Mock).mockImplementation(() => mockLiBrainian);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p as string);
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
    } as fs.Stats);
    vi.mocked(isGitRepo).mockReturnValue(true);
    vi.mocked(getGitStatusChanges).mockResolvedValue(null);
    vi.mocked(getGitStagedChanges).mockResolvedValue(null);
    vi.mocked(getGitDiffNames).mockResolvedValue(null);
    vi.mocked(getGitFileContentAtRef).mockReturnValue(null);
    vi.mocked(setDefaultLlmServiceFactory).mockImplementation(() => undefined);
    vi.mocked(createCliLlmServiceFactory).mockImplementation(() => vi.fn());
    vi.mocked(acquireWorkspaceLock).mockResolvedValue({
      lockPath: '/test/workspace/.librarian/bootstrap.lock',
      state: { pid: 1234, startedAt: new Date().toISOString() },
      release: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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

    it('returns cleanly when no files are selected and allowLockSkip is true', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        allowLockSkip: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'No modified files found to index. Workspace is already up to date.'
      );
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
        renamed: [],
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        incremental: true,
      };

      await indexCommand(options);

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/new.ts'),
        path.resolve(mockWorkspace, 'src/changed.ts'),
      ]);
    });

    it('indexes staged files for --staged mode', async () => {
      vi.mocked(getGitStagedChanges).mockResolvedValue({
        added: ['src/staged-new.ts'],
        modified: ['src/staged-change.ts'],
        deleted: [],
        renamed: [],
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        staged: true,
      };

      await indexCommand(options);

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/staged-new.ts'),
        path.resolve(mockWorkspace, 'src/staged-change.ts'),
      ]);
    });

    it('indexes files changed since a ref for --since mode', async () => {
      vi.mocked(getGitDiffNames).mockResolvedValue({
        added: ['src/new-since.ts'],
        modified: [],
        deleted: [],
        renamed: [],
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        since: 'origin/main',
      };

      await indexCommand(options);

      expect(getGitDiffNames).toHaveBeenCalledWith(mockWorkspace, 'origin/main');
      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/new-since.ts'),
      ]);
    });

    it('processes rename metadata for --since mode without breaking file selection', async () => {
      vi.mocked(getGitDiffNames).mockResolvedValue({
        added: ['src/new-name.ts'],
        modified: [],
        deleted: ['src/old-name.ts'],
        renamed: [{ from: 'src/old-name.ts', to: 'src/new-name.ts' }],
      });
      vi.mocked(getGitFileContentAtRef).mockReturnValue(`
        function oldName(a, b) {
          return a + b;
        }
      `);
      vi.mocked(fs.readFileSync).mockReturnValue(`
        function newName(a, b) {
          return a + b;
        }
      ` as any);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        since: 'origin/main',
        verbose: true,
      };

      await indexCommand(options);

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([
        path.resolve(mockWorkspace, 'src/new-name.ts'),
      ]);
      expect(getGitFileContentAtRef).toHaveBeenCalledWith(
        mockWorkspace,
        'origin/main',
        'src/old-name.ts'
      );
    });

    it('treats empty selector result as no-op success', async () => {
      vi.mocked(getGitStatusChanges).mockResolvedValue(null);
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [],
        force: true,
        incremental: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(mockLiBrainian.reindexFiles).not.toHaveBeenCalled();
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
      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
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
      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile2]);
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
      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
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

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([subFile]);
    });
  });

  describe('Bootstrap Check', () => {
    it('should throw CliError when not bootstrapped', async () => {
      mockLiBrainian.getStatus.mockResolvedValue({
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
      await expect(indexCommand(options)).rejects.toThrow('LiBrainian not bootstrapped');
      await expect(indexCommand(options)).rejects.toThrow('Run "librarian bootstrap" first');
      await expect(indexCommand(options)).rejects.toMatchObject({
        code: 'NOT_BOOTSTRAPPED',
      });
    });

    it('should proceed when bootstrapped', async () => {
      mockLiBrainian.getStatus.mockResolvedValue({
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

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalled();
    });

    it('skips update when not bootstrapped and allowLockSkip is true', async () => {
      mockLiBrainian.getStatus.mockResolvedValue({
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
        allowLockSkip: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not bootstrapped')
      );
      expect(mockLiBrainian.reindexFiles).not.toHaveBeenCalled();
    });
  });

  describe('LiBrainian Initialization', () => {
    it('acquires and releases workspace mutation lock', async () => {
      const release = vi.fn().mockResolvedValue(undefined);
      vi.mocked(acquireWorkspaceLock).mockResolvedValueOnce({
        lockPath: '/test/workspace/.librarian/bootstrap.lock',
        state: { pid: 2345, startedAt: new Date().toISOString() },
        release,
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(acquireWorkspaceLock).toHaveBeenCalledWith(mockWorkspace, { timeoutMs: 30000 });
      expect(release).toHaveBeenCalled();
    });

    it('should initialize librarian with correct workspace', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(LiBrainian).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: mockWorkspace,
          autoBootstrap: false,
          autoWatch: false,
        })
      );
    });

    it('registers the CLI default LLM service factory before initialization', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(createCliLlmServiceFactory).toHaveBeenCalledTimes(1);
      expect(setDefaultLlmServiceFactory).toHaveBeenCalledTimes(1);
      expect(setDefaultLlmServiceFactory).toHaveBeenCalledWith(expect.any(Function));
      expect((setDefaultLlmServiceFactory as unknown as Mock).mock.invocationCallOrder[0]).toBeLessThan(
        mockLiBrainian.initialize.mock.invocationCallOrder[0]
      );
    });

    it('tolerates already-registered default LLM service factory', async () => {
      vi.mocked(setDefaultLlmServiceFactory).mockImplementation(() => {
        throw new Error('unverified_by_trace(llm_adapter_default_factory_already_registered)');
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(mockLiBrainian.initialize).toHaveBeenCalled();
    });

    it('fails when default LLM service factory registration throws unexpected errors', async () => {
      vi.mocked(setDefaultLlmServiceFactory).mockImplementation(() => {
        throw new Error('factory registration failed');
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow('Failed to initialize librarian: factory registration failed');
      expect(mockLiBrainian.initialize).not.toHaveBeenCalled();
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

      expect(LiBrainian).toHaveBeenCalledWith(
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
      expect(LiBrainian).toHaveBeenCalledWith(
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

      expect(LiBrainian).toHaveBeenCalledWith(
        expect.objectContaining({
          llmModelId: 'claude-3-opus-20240229',
        })
      );

      delete process.env.LIBRARIAN_LLM_MODEL;
    });

    it('skips update gracefully when index lock is active and allowLockSkip is true', async () => {
      vi.mocked(acquireWorkspaceLock).mockRejectedValueOnce(
        new Error('unverified_by_trace(lease_conflict): timed out waiting for librarian bootstrap lock')
      );

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
        allowLockSkip: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('workspace mutation is active')
      );
      expect(mockLiBrainian.initialize).not.toHaveBeenCalled();
    });

    it('fails when workspace lock is active and allowLockSkip is false', async () => {
      vi.mocked(acquireWorkspaceLock).mockRejectedValueOnce(
        new Error('unverified_by_trace(lease_conflict): timed out waiting for librarian bootstrap lock')
      );

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow('index lock unavailable');
      expect(mockLiBrainian.initialize).not.toHaveBeenCalled();
    });

    it('skips update gracefully when index storage lock is active and allowLockSkip is true', async () => {
      mockLiBrainian.initialize.mockRejectedValue(
        new Error('unverified_by_trace:storage_locked:indexing in progress (pid=1234, startedAt=2026-02-21T00:00:00.000Z)')
      );

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
        allowLockSkip: true,
      };

      await expect(indexCommand(options)).resolves.toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('index is busy')
      );
      expect(mockLiBrainian.getStatus).not.toHaveBeenCalled();
    });

    it('fails when index storage lock is active and allowLockSkip is false', async () => {
      mockLiBrainian.initialize.mockRejectedValue(
        new Error('unverified_by_trace:storage_locked:indexing in progress (pid=1234, startedAt=2026-02-21T00:00:00.000Z)')
      );

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);
      await expect(indexCommand(options)).rejects.toThrow('Failed to initialize librarian');
    });
  });

  describe('Reindex Failure Handling', () => {
    it('should handle reindexFiles failure and throw CliError', async () => {
      const error = new Error('Provider unavailable');
      mockLiBrainian.reindexFiles.mockRejectedValue(error);

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
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Indexing failed'));
    });

    it('should include provider guidance in thrown error message', async () => {
      const error = new Error('ProviderUnavailable: API key not configured');
      mockLiBrainian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(
        'Check provider credentials/network, then retry',
      );
    });

    it('should include lock guidance in thrown error message', async () => {
      const error = new Error('Database error: SQLITE_BUSY');
      mockLiBrainian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(
        'Another process may hold the database lock; wait and retry.',
      );
    });

    it('should include parse guidance in thrown error message', async () => {
      const error = new Error('Failed to extract function from source');
      mockLiBrainian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(
        'Check file syntax/support and retry after fixing parse issues.',
      );
    });

    it('captures stack trace in error details for debug rendering', async () => {
      const error = new Error('Test error with stack');
      error.stack = 'Error: Test error\n  at test.js:1:1';
      mockLiBrainian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        verbose: true,
        force: true,
      };

      await expect(indexCommand(options)).rejects.toMatchObject({
        code: 'INDEX_FAILED',
        details: expect.objectContaining({
          stack: expect.stringContaining('at test.js:1:1'),
        }),
      });
    });

    it('should ensure librarian.shutdown is called even on failure', async () => {
      const error = new Error('Indexing failed');
      mockLiBrainian.reindexFiles.mockRejectedValue(error);

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(CliError);

      expect(mockLiBrainian.shutdown).toHaveBeenCalled();
    });

    it('includes final status totals in failure guidance when available', async () => {
      const error = new Error('Partial failure');
      mockLiBrainian.reindexFiles.mockRejectedValue(error);
      mockLiBrainian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });
      mockLiBrainian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 105, totalModules: 11 },
      });

      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await expect(indexCommand(options)).rejects.toThrow(
        'Context packs were invalidated; current totals: 105 functions, 11 modules.',
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

      mockLiBrainian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });
      mockLiBrainian.getStatus.mockResolvedValueOnce({
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

    it('should preserve partial progress counts in error details', async () => {
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
      mockLiBrainian.reindexFiles.mockRejectedValue(error);
      mockLiBrainian.getStatus.mockResolvedValue({
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

      await expect(indexPromise).rejects.toMatchObject({
        code: 'INDEX_FAILED',
        details: expect.objectContaining({
          entitiesCreated: 1,
        }),
      });
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

      expect(mockLiBrainian.initialize).toHaveBeenCalled();
      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile1, mockFile2]);
      expect(mockLiBrainian.shutdown).toHaveBeenCalled();
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
      mockLiBrainian.getStatus.mockResolvedValueOnce({
        bootstrapped: true,
        stats: { totalFunctions: 100, totalModules: 10 },
      });
      mockLiBrainian.getStatus.mockResolvedValueOnce({
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

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
    });

    it('should handle absolute paths', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1],
        force: true,
      };

      await indexCommand(options);

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile1]);
    });

    it('should handle mixed absolute and relative paths', async () => {
      const options: IndexCommandOptions = {
        workspace: mockWorkspace,
        files: [mockFile1, 'src/file2.ts'],
        force: true,
      };

      await indexCommand(options);

      expect(mockLiBrainian.reindexFiles).toHaveBeenCalledWith([mockFile1, mockFile2]);
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

      expect(LiBrainian).toHaveBeenCalledWith(
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

      expect(LiBrainian).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: cwd,
        })
      );
    });
  });
});
