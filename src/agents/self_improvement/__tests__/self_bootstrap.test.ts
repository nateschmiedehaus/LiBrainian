/**
 * @fileoverview Tests for Self-Bootstrap Primitive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selfBootstrap, createSelfBootstrap, type SelfBootstrapResult, type SelfBootstrapOptions } from '../self_bootstrap.js';
import type { LibrarianStorage } from '../../../storage/types.js';

describe('selfBootstrap', () => {
  let mockStorage: LibrarianStorage;

  beforeEach(() => {
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'c' },
      ]),
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
    } as unknown as LibrarianStorage;
  });

  it('requires rootDir parameter', async () => {
    await expect(
      selfBootstrap({
        rootDir: '',
        storage: mockStorage,
      })
    ).rejects.toThrow('rootDir is required');
  });

  it('requires storage parameter', async () => {
    await expect(
      selfBootstrap({
        rootDir: '/test',
        storage: undefined as unknown as LibrarianStorage,
      })
    ).rejects.toThrow('storage is required');
  });

  it('has correct interface shape for SelfBootstrapResult', () => {
    // Type-level test to ensure interface is correct
    const result: SelfBootstrapResult = {
      indexedFiles: 10,
      extractedSymbols: 50,
      graphNodes: 45,
      graphEdges: 80,
      duration: 1500,
      errors: [],
      isSelfReferential: false,
      coverage: {
        functions: 0.85,
        classes: 0.7,
        modules: 0.95,
        relationships: 0.6,
      },
    };

    expect(result.indexedFiles).toBe(10);
    expect(result.extractedSymbols).toBe(50);
    expect(result.graphNodes).toBe(45);
    expect(result.graphEdges).toBe(80);
    expect(result.duration).toBe(1500);
    expect(result.errors).toEqual([]);
    expect(result.isSelfReferential).toBe(false);
    expect(result.coverage.functions).toBe(0.85);
    expect(result.coverage.classes).toBe(0.7);
    expect(result.coverage.modules).toBe(0.95);
    expect(result.coverage.relationships).toBe(0.6);
  });

  it('has correct interface shape for SelfBootstrapOptions', () => {
    // Type-level test to ensure interface is correct
    const options: SelfBootstrapOptions = {
      rootDir: '/test',
      excludePatterns: ['**/node_modules/**'],
      maxFiles: 100,
      storage: mockStorage,
      onProgress: ({ total, completed }) => {
        console.log(`${completed}/${total}`);
      },
      verbose: true,
      indexConfig: {
        generateEmbeddings: false,
        createContextPacks: true,
      },
    };

    expect(options.rootDir).toBe('/test');
    expect(options.excludePatterns).toEqual(['**/node_modules/**']);
    expect(options.maxFiles).toBe(100);
    expect(options.verbose).toBe(true);
  });

  describe('createSelfBootstrap', () => {
    it('creates a factory function with correct signature', () => {
      const boundBootstrap = createSelfBootstrap({
        verbose: true,
      });

      expect(typeof boundBootstrap).toBe('function');
    });

    it('factory function accepts required parameters', () => {
      const boundBootstrap = createSelfBootstrap({});

      // This should type-check - rootDir and storage are required
      const callWithRequiredParams = () =>
        boundBootstrap({
          rootDir: '/test',
          storage: mockStorage,
        });

      // We just verify the function can be called with the right params
      // Actual execution would require LLM provider
      expect(typeof callWithRequiredParams).toBe('function');
    });
  });
});
