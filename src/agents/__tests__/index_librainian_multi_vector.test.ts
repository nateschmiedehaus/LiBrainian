/**
 * Tests for storeMultiVectorEmbedding validation logic in IndexLiBrainian
 *
 * NOTE: These tests use mocks for embedding generation and AST indexing.
 * They focus on validating the embedding model ID validation logic.
 * For full integration testing, see the live provider tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexLiBrainian } from '../index_librainian.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { ModuleKnowledge } from '../../types.js';
import { randomUUID } from 'crypto';

// Mock AST indexer to allow testing embedding validation without real LLM
vi.mock('../ast_indexer.js', () => ({
  AstIndexer: vi.fn().mockImplementation(() => ({
    indexFile: vi.fn().mockResolvedValue({
      functions: [],
      module: null,
      callEdges: [],
      partiallyIndexed: false,
    }),
  })),
}));

// Mock embedding generation
vi.mock('../../api/embedding_providers/multi_vector_representations.js', () => ({
  generateMultiVector: vi.fn().mockResolvedValue({
    semantic: new Float32Array(384),
    structural: new Float32Array(384),
    dependency: new Float32Array(384),
    usage: new Float32Array(384),
  }),
  serializeMultiVector: vi.fn().mockReturnValue({
    semanticInput: 'semantic text',
    structuralInput: 'structural text',
    dependencyInput: 'dependency text',
    usageInput: 'usage text',
    modelId: 'all-MiniLM-L6-v2',
  }),
}));

describe('IndexLiBrainian - storeMultiVectorEmbedding validation', () => {
  let librainian: IndexLiBrainian;
  let mockStorage: LiBrainianStorage;

  beforeEach(() => {
    // Reset all mocks to ensure clean state between tests
    vi.clearAllMocks();

    // Create mock storage with all required methods
    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      isInitialized: vi.fn().mockReturnValue(true),
      getMultiVector: vi.fn().mockResolvedValue(null),
      upsertMultiVector: vi.fn().mockResolvedValue(undefined),
      getEmbedding: vi.fn().mockResolvedValue(null),
      setEmbedding: vi.fn().mockResolvedValue(undefined),
      getModuleByPath: vi.fn().mockResolvedValue(null),
      upsertModule: vi.fn().mockResolvedValue(undefined),
      getFileChecksum: vi.fn().mockResolvedValue(null),
      setFileChecksum: vi.fn().mockResolvedValue(undefined),
      getFunctionByPath: vi.fn().mockResolvedValue(null),
      upsertFunction: vi.fn().mockResolvedValue(undefined),
      getContextPack: vi.fn().mockResolvedValue(null),
      upsertContextPack: vi.fn().mockResolvedValue(undefined),
      recordIndexingResult: vi.fn().mockResolvedValue(undefined),
      deleteFileByPath: vi.fn().mockResolvedValue(undefined),
      deleteUniversalKnowledgeByFile: vi.fn().mockResolvedValue(undefined),
      deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),
      deleteModule: vi.fn().mockResolvedValue(undefined),
      invalidateContextPacks: vi.fn().mockResolvedValue(0),
      deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
      upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
      getFunctionsByPath: vi.fn().mockResolvedValue([]),
      getUniversalKnowledgeByFile: vi.fn().mockResolvedValue([]),
      getFileByPath: vi.fn().mockResolvedValue(null),
      getModules: vi.fn().mockResolvedValue([]),
    } as unknown as LiBrainianStorage;
  });

  describe('valid embedding models pass validation', () => {
    it('should accept all-MiniLM-L6-v2 (default model)', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'all-MiniLM-L6-v2',
        llmProvider: 'claude', // Required for AST indexer
        llmModelId: 'claude-sonnet-4-20250514', // Required for AST indexer
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: ['foo'],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'const foo = 1;', true)
      ).resolves.not.toThrow();

      expect(mockStorage.upsertMultiVector).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: module.id,
          entityType: 'module',
          modelId: 'all-MiniLM-L6-v2',
        })
      );
    });

    it('should accept jina-embeddings-v2-base-en model', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'jina-embeddings-v2-base-en',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: ['bar'],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'const bar = 2;', true)
      ).resolves.not.toThrow();

      expect(mockStorage.upsertMultiVector).toHaveBeenCalled();
    });

    it('should accept bge-small-en-v1.5 model', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'bge-small-en-v1.5',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: ['baz'],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'const baz = 3;', true)
      ).resolves.not.toThrow();

      expect(mockStorage.upsertMultiVector).toHaveBeenCalled();
    });
  });

  describe('undefined/default value works', () => {
    it('should use default all-MiniLM-L6-v2 when embeddingModelId is undefined', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: undefined,
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).resolves.not.toThrow();

      expect(mockStorage.upsertMultiVector).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'all-MiniLM-L6-v2',
        })
      );
    });

    it('should use default all-MiniLM-L6-v2 when embeddingModelId is not provided', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).resolves.not.toThrow();

      expect(mockStorage.upsertMultiVector).toHaveBeenCalled();
    });
  });

  describe('invalid model IDs are rejected with clear error message', () => {
    it('should reject text-embedding-ada-002 with clear error message', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'text-embedding-ada-002',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow('Invalid embedding model: text-embedding-ada-002');

      expect(mockStorage.upsertMultiVector).not.toHaveBeenCalled();
    });

    it('should reject voyage-2 with clear error message', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'voyage-2',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow('Invalid embedding model: voyage-2');
    });

    it('should reject completely invalid model with clear error message', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'invalid-model-xyz',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow('Invalid embedding model: invalid-model-xyz');
    });

    it('should reject empty string model with clear error message', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: '',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow('Invalid embedding model: ');
    });
  });

  describe('error message includes all allowed values', () => {
    it('should list all three allowed models in error message', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'wrong-model',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow(
        'Allowed: all-MiniLM-L6-v2, jina-embeddings-v2-base-en, bge-small-en-v1.5'
      );
    });

    it('should provide complete error message with both invalid model and allowed list', async () => {
      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'gpt-embedding',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      try {
        await librainian['storeMultiVectorEmbedding'](module, 'export {}', true);
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain('Invalid embedding model: gpt-embedding');
        expect(errorMessage).toContain('all-MiniLM-L6-v2');
        expect(errorMessage).toContain('jina-embeddings-v2-base-en');
        expect(errorMessage).toContain('bge-small-en-v1.5');
      }
    });
  });

  describe('edge cases and validation behavior', () => {
    it('should validate model even when multi-vector already exists but needs reindexing', async () => {
      // Setup storage to return existing multi-vector
      mockStorage.getMultiVector = vi.fn().mockResolvedValue({
        entityId: 'test-id',
        entityType: 'module',
        payload: {},
        modelId: 'all-MiniLM-L6-v2',
      });

      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'invalid-model',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      // Even with existing multi-vector, if needsModuleEmbedding is true, validation should fire
      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow('Invalid embedding model: invalid-model');
    });

    it('should skip validation when multi-vector exists and needsModuleEmbedding is false', async () => {
      mockStorage.getMultiVector = vi.fn().mockResolvedValue({
        entityId: 'test-id',
        entityType: 'module',
        payload: {},
        modelId: 'all-MiniLM-L6-v2',
      });

      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'invalid-model',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      // When needsModuleEmbedding is false and multi-vector exists, should skip everything
      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', false)
      ).resolves.not.toThrow();

      expect(mockStorage.upsertMultiVector).not.toHaveBeenCalled();
    });

    it('should validate before calling generateMultiVector', async () => {
      const { generateMultiVector } = await import(
        '../../api/embedding_providers/multi_vector_representations.js'
      );

      librainian = new IndexLiBrainian({
        generateEmbeddings: true,
        embeddingModelId: 'bad-model',
        llmProvider: 'claude',
        llmModelId: 'claude-sonnet-4-20250514',
      });

      await librainian.initialize(mockStorage);

      const module: ModuleKnowledge = {
        id: randomUUID(),
        path: '/test/module.ts',
        purpose: 'Test module',
        exports: [],
        dependencies: [],
        confidence: 1.0,
      };

      await expect(
        librainian['storeMultiVectorEmbedding'](module, 'export {}', true)
      ).rejects.toThrow();

      // generateMultiVector should never be called if validation fails
      expect(generateMultiVector).not.toHaveBeenCalled();
    });
  });
});
