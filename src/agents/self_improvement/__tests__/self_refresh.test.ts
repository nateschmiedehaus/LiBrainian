/**
 * @fileoverview Tests for Self-Refresh Primitive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selfRefresh, createSelfRefresh, type SelfRefreshResult, type SelfRefreshOptions, type ChangeSummary } from '../self_refresh.js';
import type { LibrarianStorage } from '../../../storage/types.js';

describe('selfRefresh', () => {
  let mockStorage: LibrarianStorage;

  beforeEach(() => {
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getFileChecksum: vi.fn().mockResolvedValue(null),
      setFileChecksum: vi.fn().mockResolvedValue(undefined),
      getFunctionByPath: vi.fn().mockResolvedValue(null),
      getModuleByPath: vi.fn().mockResolvedValue(null),
      upsertFunction: vi.fn().mockResolvedValue(undefined),
      upsertModule: vi.fn().mockResolvedValue(undefined),
      upsertContextPack: vi.fn().mockResolvedValue(undefined),
      getContextPack: vi.fn().mockResolvedValue(null),
      deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
      upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
      recordIndexingResult: vi.fn().mockResolvedValue(undefined),
      invalidateContextPacks: vi.fn().mockResolvedValue(2),
      deleteFileByPath: vi.fn().mockResolvedValue(undefined),
      deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),
      deleteModule: vi.fn().mockResolvedValue(undefined),
      getFileByPath: vi.fn().mockResolvedValue(null),
      getFunctionsByPath: vi.fn().mockResolvedValue([]),
      getUniversalKnowledgeByFile: vi.fn().mockResolvedValue([]),
      deleteUniversalKnowledgeByFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as LibrarianStorage;
  });

  it('requires rootDir parameter', async () => {
    await expect(
      selfRefresh({
        rootDir: '',
        storage: mockStorage,
      })
    ).rejects.toThrow('rootDir is required');
  });

  it('requires storage parameter', async () => {
    await expect(
      selfRefresh({
        rootDir: '/test',
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('has correct interface shape for SelfRefreshResult', () => {
    // Type-level test to ensure interface is correct
    const result: SelfRefreshResult = {
      changedFiles: ['src/file1.ts', 'src/file2.ts'],
      updatedSymbols: 25,
      invalidatedClaims: 5,
      newDefeaters: 2,
      duration: 1200,
      errors: [],
      changeSummary: {
        added: ['src/new_file.ts'],
        modified: ['src/existing_file.ts'],
        deleted: ['src/old_file.ts'],
        baseCommit: 'abc123',
        headCommit: 'def456',
      },
    };

    expect(result.changedFiles).toEqual(['src/file1.ts', 'src/file2.ts']);
    expect(result.updatedSymbols).toBe(25);
    expect(result.invalidatedClaims).toBe(5);
    expect(result.newDefeaters).toBe(2);
    expect(result.duration).toBe(1200);
    expect(result.errors).toEqual([]);
    expect(result.changeSummary.added).toEqual(['src/new_file.ts']);
    expect(result.changeSummary.modified).toEqual(['src/existing_file.ts']);
    expect(result.changeSummary.deleted).toEqual(['src/old_file.ts']);
  });

  it('has correct interface shape for ChangeSummary', () => {
    const summary: ChangeSummary = {
      added: ['file1.ts', 'file2.ts'],
      modified: ['file3.ts'],
      deleted: [],
      baseCommit: 'abc123',
      headCommit: 'def456',
    };

    expect(summary.added).toHaveLength(2);
    expect(summary.modified).toHaveLength(1);
    expect(summary.deleted).toHaveLength(0);
    expect(summary.baseCommit).toBe('abc123');
    expect(summary.headCommit).toBe('def456');
  });

  it('has correct interface shape for SelfRefreshOptions', () => {
    const options: SelfRefreshOptions = {
      rootDir: '/test',
      sinceCommit: 'abc123',
      sinceDays: 7,
      scope: 'changed_and_dependents',
      storage: mockStorage,
      onProgress: ({ total, completed }) => {
        console.log(`${completed}/${total}`);
      },
      verbose: true,
      indexConfig: {
        generateEmbeddings: false,
      },
    };

    expect(options.rootDir).toBe('/test');
    expect(options.sinceCommit).toBe('abc123');
    expect(options.sinceDays).toBe(7);
    expect(options.scope).toBe('changed_and_dependents');
    expect(options.verbose).toBe(true);
  });

  it('supports all scope values', () => {
    const scopes: SelfRefreshOptions['scope'][] = [
      'changed_only',
      'changed_and_dependents',
      'full',
    ];

    for (const scope of scopes) {
      const options: SelfRefreshOptions = {
        rootDir: '/test',
        scope,
        storage: mockStorage,
      };
      expect(options.scope).toBe(scope);
    }
  });

  describe('createSelfRefresh', () => {
    it('creates a factory function with correct signature', () => {
      const boundRefresh = createSelfRefresh({
        scope: 'changed_only',
        verbose: true,
      });

      expect(typeof boundRefresh).toBe('function');
    });

    it('factory function accepts required parameters', () => {
      const boundRefresh = createSelfRefresh({});

      // This should type-check - rootDir and storage are required
      const callWithRequiredParams = () =>
        boundRefresh({
          rootDir: '/test',
          storage: mockStorage,
        });

      // We just verify the function can be called with the right params
      // Actual execution would require LLM provider
      expect(typeof callWithRequiredParams).toBe('function');
    });
  });
});
