/**
 * @fileoverview Tests for Embedding Model Configuration
 *
 * Tests the embedding model configuration system including:
 * - Default model selection
 * - Environment variable overrides
 * - Model listing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEmbeddingConfig,
  listEmbeddingModels,
  configureEmbeddingModel,
  DEFAULT_EMBEDDING_CONFIGS,
  type EmbeddingConfig,
} from '../embeddings.js';

describe('Embedding Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
    delete process.env.LIBRAINIAN_EMBEDDING_MODEL;
    delete process.env.LIBRAINIAN_EMBEDDING_PROVIDER;
    delete process.env.LIBRARIAN_EMBEDDING_MODEL;
    delete process.env.LIBRARIAN_EMBEDDING_PROVIDER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getEmbeddingConfig', () => {
    it('returns default config when no model specified', () => {
      const config = getEmbeddingConfig();

      // Default changed from all-MiniLM-L6-v2 to bge-small-en-v1.5 in #865
      expect(config.model).toBe('bge-small-en-v1.5');
      expect(config.dimensions).toBe(384);
      expect(config.provider).toBe('xenova');
    });

    it('returns config for specified model', () => {
      const config = getEmbeddingConfig('jina-embeddings-v2-base-en');

      expect(config.model).toBe('jina-embeddings-v2-base-en');
      expect(config.dimensions).toBe(768);
      expect(config.contextWindow).toBe(8192);
    });

    it('supports provider-prefixed model IDs', () => {
      const config = getEmbeddingConfig('xenova:bge-small-en-v1.5');

      expect(config.model).toBe('bge-small-en-v1.5');
      expect(config.dimensions).toBe(384);
    });

    it('uses LIBRARIAN_EMBEDDING_MODEL environment variable', () => {
      process.env.LIBRARIAN_EMBEDDING_MODEL = 'jina-embeddings-v2-base-en';

      const config = getEmbeddingConfig();

      expect(config.model).toBe('jina-embeddings-v2-base-en');
      expect(config.dimensions).toBe(768);
    });

    it('uses LIBRAINIAN_EMBEDDING_MODEL environment variable', () => {
      process.env.LIBRAINIAN_EMBEDDING_MODEL = 'jina-embeddings-v2-base-en';

      const config = getEmbeddingConfig();

      expect(config.model).toBe('jina-embeddings-v2-base-en');
      expect(config.dimensions).toBe(768);
    });

    it('explicit modelId overrides environment variable', () => {
      process.env.LIBRARIAN_EMBEDDING_MODEL = 'jina-embeddings-v2-base-en';

      const config = getEmbeddingConfig('all-MiniLM-L6-v2');

      expect(config.model).toBe('all-MiniLM-L6-v2');
      expect(config.dimensions).toBe(384);
    });

    it('applies LIBRARIAN_EMBEDDING_PROVIDER override', () => {
      process.env.LIBRARIAN_EMBEDDING_PROVIDER = 'sentence-transformers';

      const config = getEmbeddingConfig('all-MiniLM-L6-v2');

      expect(config.model).toBe('all-MiniLM-L6-v2');
      expect(config.provider).toBe('sentence-transformers');
    });

    it('applies LIBRAINIAN_EMBEDDING_PROVIDER override', () => {
      process.env.LIBRAINIAN_EMBEDDING_PROVIDER = 'sentence-transformers';

      const config = getEmbeddingConfig('all-MiniLM-L6-v2');

      expect(config.model).toBe('all-MiniLM-L6-v2');
      expect(config.provider).toBe('sentence-transformers');
    });

    it('throws for unknown model', () => {
      expect(() => getEmbeddingConfig('unknown-model-xyz')).toThrow(
        /Unknown embedding model.*unknown-model-xyz/
      );
    });

    it('error message includes available models', () => {
      expect(() => getEmbeddingConfig('unknown')).toThrow(
        /Available models:/
      );
    });
  });

  describe('listEmbeddingModels', () => {
    it('returns list of available models', () => {
      const models = listEmbeddingModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'all-MiniLM-L6-v2')).toBe(true);
    });

    it('includes model configuration details', () => {
      const models = listEmbeddingModels();
      const miniLM = models.find(m => m.id === 'all-MiniLM-L6-v2');

      expect(miniLM).toBeDefined();
      expect(miniLM?.config.dimensions).toBe(384);
      expect(miniLM?.config.provider).toBe('xenova');
    });

    it('does not include duplicate models', () => {
      const models = listEmbeddingModels();
      const ids = models.map(m => m.id);
      const uniqueIds = [...new Set(ids)];

      expect(ids.length).toBe(uniqueIds.length);
    });

    it('excludes provider-prefixed variants', () => {
      const models = listEmbeddingModels();
      const prefixedModels = models.filter(m => m.id.includes(':'));

      expect(prefixedModels.length).toBe(0);
    });
  });

  describe('configureEmbeddingModel', () => {
    it('returns configuration for model', () => {
      const config = configureEmbeddingModel('bge-small-en-v1.5');

      expect(config.model).toBe('bge-small-en-v1.5');
      expect(config.dimensions).toBe(384);
    });

    it('uses default when no model specified', () => {
      const config = configureEmbeddingModel();

      // Default changed from all-MiniLM-L6-v2 to bge-small-en-v1.5 in #865
      expect(config.model).toBe('bge-small-en-v1.5');
    });
  });

  describe('DEFAULT_EMBEDDING_CONFIGS', () => {
    it('all configs have required fields', () => {
      for (const [id, config] of Object.entries(DEFAULT_EMBEDDING_CONFIGS)) {
        expect(config.model).toBeDefined();
        expect(config.dimensions).toBeGreaterThan(0);
        expect(config.provider).toBeDefined();
        expect(config.contextWindow).toBeGreaterThan(0);
        expect(config.batchSize).toBeGreaterThan(0);
        expect(config.description).toBeDefined();
      }
    });

    it('has matching short and prefixed entries', () => {
      // Check that xenova:all-MiniLM-L6-v2 matches all-MiniLM-L6-v2
      const short = DEFAULT_EMBEDDING_CONFIGS['all-MiniLM-L6-v2'];
      const prefixed = DEFAULT_EMBEDDING_CONFIGS['xenova:all-MiniLM-L6-v2'];

      expect(short.model).toBe(prefixed.model);
      expect(short.dimensions).toBe(prefixed.dimensions);
    });
  });
});
