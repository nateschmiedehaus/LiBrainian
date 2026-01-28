import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGraphRetriever,
  createVectorRetriever,
  createLSPRetriever,
} from '../specialized_retrievers.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  RetrieverAgent,
  GraphRetriever,
  VectorRetriever,
  LSPRetriever,
  RetrievalResult,
  RetrievalOptions,
} from '../specialized_retrievers.js';

/**
 * @fileoverview Tests for Specialized Retrieval Agents (WU-AGENT-002)
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 */

// ============================================================================
// GRAPH RETRIEVER TESTS
// ============================================================================

describe('GraphRetriever', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct name', () => {
      const retriever = createGraphRetriever();
      expect(retriever.name).toBe('Graph Retriever');
    });

    it('returns agent with type "graph"', () => {
      const retriever = createGraphRetriever();
      expect(retriever.type).toBe('graph');
    });

    it('returns capabilities including graph traversal', () => {
      const retriever = createGraphRetriever();
      const capabilities = retriever.getCapabilities();
      expect(capabilities).toContain('graph_traversal');
      expect(capabilities).toContain('symbol_connection');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const retriever = createGraphRetriever();
      expect(retriever.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const retriever = createGraphRetriever();
      await retriever.initialize({} as LibrarianStorage);
      expect(retriever.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const retriever = createGraphRetriever();
      await retriever.initialize({} as LibrarianStorage);
      await retriever.shutdown();
      expect(retriever.isReady()).toBe(false);
    });
  });

  describe('retrieve', () => {
    let retriever: GraphRetriever;

    beforeEach(async () => {
      retriever = createGraphRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns array of RetrievalResult', async () => {
      const results = await retriever.retrieve('find function dependencies');
      expect(Array.isArray(results)).toBe(true);
    });

    it('each result has required fields', async () => {
      const results = await retriever.retrieve('find function dependencies');
      for (const result of results) {
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('metadata');
      }
    });

    it('result scores are between 0 and 1', async () => {
      const results = await retriever.retrieve('find function dependencies');
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('accepts optional RetrievalOptions', async () => {
      const options: RetrievalOptions = { maxResults: 5, minScore: 0.5 };
      const results = await retriever.retrieve('find function dependencies', options);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('traverseFromNode', () => {
    let retriever: GraphRetriever;

    beforeEach(async () => {
      retriever = createGraphRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns results for valid node ID', async () => {
      const results = await retriever.traverseFromNode('node-123', 2);
      expect(Array.isArray(results)).toBe(true);
    });

    it('respects depth parameter', async () => {
      const shallowResults = await retriever.traverseFromNode('node-123', 1);
      const deepResults = await retriever.traverseFromNode('node-123', 3);
      // Deep traversal should potentially return more results
      expect(deepResults.length).toBeGreaterThanOrEqual(shallowResults.length);
    });

    it('returns empty array for non-existent node', async () => {
      const results = await retriever.traverseFromNode('non-existent-node', 2);
      expect(results).toEqual([]);
    });
  });

  describe('findConnectedSymbols', () => {
    let retriever: GraphRetriever;

    beforeEach(async () => {
      retriever = createGraphRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns results for symbol name', async () => {
      const results = await retriever.findConnectedSymbols('MyClass');
      expect(Array.isArray(results)).toBe(true);
    });

    it('each result includes connection metadata', async () => {
      const results = await retriever.findConnectedSymbols('MyClass');
      for (const result of results) {
        expect(result.metadata).toBeDefined();
      }
    });

    it('returns empty array for unknown symbol', async () => {
      const results = await retriever.findConnectedSymbols('UnknownSymbol12345');
      expect(results).toEqual([]);
    });
  });
});

// ============================================================================
// VECTOR RETRIEVER TESTS
// ============================================================================

describe('VectorRetriever', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct name', () => {
      const retriever = createVectorRetriever();
      expect(retriever.name).toBe('Vector Retriever');
    });

    it('returns agent with type "vector"', () => {
      const retriever = createVectorRetriever();
      expect(retriever.type).toBe('vector');
    });

    it('returns capabilities including semantic search', () => {
      const retriever = createVectorRetriever();
      const capabilities = retriever.getCapabilities();
      expect(capabilities).toContain('semantic_search');
      expect(capabilities).toContain('similarity_matching');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const retriever = createVectorRetriever();
      expect(retriever.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const retriever = createVectorRetriever();
      await retriever.initialize({} as LibrarianStorage);
      expect(retriever.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const retriever = createVectorRetriever();
      await retriever.initialize({} as LibrarianStorage);
      await retriever.shutdown();
      expect(retriever.isReady()).toBe(false);
    });
  });

  describe('retrieve', () => {
    let retriever: VectorRetriever;

    beforeEach(async () => {
      retriever = createVectorRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns array of RetrievalResult', async () => {
      const results = await retriever.retrieve('functions that handle authentication');
      expect(Array.isArray(results)).toBe(true);
    });

    it('each result has required fields', async () => {
      const results = await retriever.retrieve('functions that handle authentication');
      for (const result of results) {
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('metadata');
      }
    });

    it('result scores are between 0 and 1', async () => {
      const results = await retriever.retrieve('functions that handle authentication');
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('accepts optional RetrievalOptions', async () => {
      const options: RetrievalOptions = { maxResults: 10, minScore: 0.7 };
      const results = await retriever.retrieve('authentication', options);
      expect(results.length).toBeLessThanOrEqual(10);
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe('searchSimilar', () => {
    let retriever: VectorRetriever;

    beforeEach(async () => {
      retriever = createVectorRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns results for embedding vector', async () => {
      const embedding = new Array(384).fill(0.1); // Sample embedding
      const results = await retriever.searchSimilar(embedding);
      expect(Array.isArray(results)).toBe(true);
    });

    it('results are ordered by similarity (highest first)', async () => {
      const embedding = new Array(384).fill(0.1);
      const results = await retriever.searchSimilar(embedding);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('handles empty embedding vector gracefully', async () => {
      const results = await retriever.searchSimilar([]);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });

  describe('searchByExample', () => {
    let retriever: VectorRetriever;

    beforeEach(async () => {
      retriever = createVectorRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns results for example code', async () => {
      const exampleCode = `
        function authenticate(user: string, password: string) {
          return validateCredentials(user, password);
        }
      `;
      const results = await retriever.searchByExample(exampleCode);
      expect(Array.isArray(results)).toBe(true);
    });

    it('results include similarity metadata', async () => {
      const exampleCode = 'const x = 1;';
      const results = await retriever.searchByExample(exampleCode);
      for (const result of results) {
        expect(result.metadata).toBeDefined();
      }
    });

    it('handles empty example gracefully', async () => {
      const results = await retriever.searchByExample('');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });
});

// ============================================================================
// LSP RETRIEVER TESTS
// ============================================================================

describe('LSPRetriever', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct name', () => {
      const retriever = createLSPRetriever();
      expect(retriever.name).toBe('LSP Retriever');
    });

    it('returns agent with type "lsp"', () => {
      const retriever = createLSPRetriever();
      expect(retriever.type).toBe('lsp');
    });

    it('returns capabilities including reference finding', () => {
      const retriever = createLSPRetriever();
      const capabilities = retriever.getCapabilities();
      expect(capabilities).toContain('find_references');
      expect(capabilities).toContain('find_definition');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const retriever = createLSPRetriever();
      expect(retriever.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const retriever = createLSPRetriever();
      await retriever.initialize({} as LibrarianStorage);
      expect(retriever.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const retriever = createLSPRetriever();
      await retriever.initialize({} as LibrarianStorage);
      await retriever.shutdown();
      expect(retriever.isReady()).toBe(false);
    });
  });

  describe('retrieve', () => {
    let retriever: LSPRetriever;

    beforeEach(async () => {
      retriever = createLSPRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns array of RetrievalResult', async () => {
      const results = await retriever.retrieve('find symbol MyClass');
      expect(Array.isArray(results)).toBe(true);
    });

    it('each result has required fields', async () => {
      const results = await retriever.retrieve('find symbol MyClass');
      for (const result of results) {
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('metadata');
      }
    });

    it('result scores are between 0 and 1', async () => {
      const results = await retriever.retrieve('find symbol MyClass');
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('accepts optional RetrievalOptions', async () => {
      const options: RetrievalOptions = { maxResults: 3 };
      const results = await retriever.retrieve('find symbol', options);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('findReferences', () => {
    let retriever: LSPRetriever;

    beforeEach(async () => {
      retriever = createLSPRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns results for valid symbol and file', async () => {
      const results = await retriever.findReferences('authenticate', '/src/auth.ts');
      expect(Array.isArray(results)).toBe(true);
    });

    it('results include location metadata', async () => {
      const results = await retriever.findReferences('authenticate', '/src/auth.ts');
      for (const result of results) {
        expect(result.metadata).toBeDefined();
      }
    });

    it('returns empty array for non-existent symbol', async () => {
      const results = await retriever.findReferences('NonExistentSymbol12345', '/src/file.ts');
      expect(results).toEqual([]);
    });
  });

  describe('findDefinition', () => {
    let retriever: LSPRetriever;

    beforeEach(async () => {
      retriever = createLSPRetriever();
      await retriever.initialize({} as LibrarianStorage);
    });

    it('returns results for valid symbol and file', async () => {
      const results = await retriever.findDefinition('authenticate', '/src/auth.ts');
      expect(Array.isArray(results)).toBe(true);
    });

    it('result includes definition location', async () => {
      const results = await retriever.findDefinition('authenticate', '/src/auth.ts');
      for (const result of results) {
        expect(result.metadata).toBeDefined();
      }
    });

    it('returns empty array for non-existent symbol', async () => {
      const results = await retriever.findDefinition('NonExistentSymbol12345', '/src/file.ts');
      expect(results).toEqual([]);
    });
  });
});

// ============================================================================
// INTEGRATION / COMBINED TESTS
// ============================================================================

describe('Specialized Retrievers Integration', () => {
  describe('Type compatibility', () => {
    it('all retrievers implement RetrieverAgent interface', async () => {
      const graphRetriever: RetrieverAgent = createGraphRetriever();
      const vectorRetriever: RetrieverAgent = createVectorRetriever();
      const lspRetriever: RetrieverAgent = createLSPRetriever();

      // All should have the base interface methods
      expect(typeof graphRetriever.retrieve).toBe('function');
      expect(typeof vectorRetriever.retrieve).toBe('function');
      expect(typeof lspRetriever.retrieve).toBe('function');

      expect(typeof graphRetriever.getCapabilities).toBe('function');
      expect(typeof vectorRetriever.getCapabilities).toBe('function');
      expect(typeof lspRetriever.getCapabilities).toBe('function');
    });

    it('each retriever has distinct type', () => {
      const graphRetriever = createGraphRetriever();
      const vectorRetriever = createVectorRetriever();
      const lspRetriever = createLSPRetriever();

      const types = new Set([graphRetriever.type, vectorRetriever.type, lspRetriever.type]);
      expect(types.size).toBe(3);
    });
  });

  describe('Configuration', () => {
    it('GraphRetriever accepts optional config', () => {
      const config = { maxDepth: 5, defaultNodeLimit: 100 };
      const retriever = createGraphRetriever(config);
      expect(retriever).toBeDefined();
    });

    it('VectorRetriever accepts optional config', () => {
      const config = { embeddingDimension: 384, defaultTopK: 10 };
      const retriever = createVectorRetriever(config);
      expect(retriever).toBeDefined();
    });

    it('LSPRetriever accepts optional config', () => {
      const config = { supportedLanguages: ['typescript', 'javascript'] };
      const retriever = createLSPRetriever(config);
      expect(retriever).toBeDefined();
    });
  });

  describe('Concurrent usage', () => {
    it('multiple retrievers can be used concurrently', async () => {
      const graphRetriever = createGraphRetriever();
      const vectorRetriever = createVectorRetriever();
      const lspRetriever = createLSPRetriever();

      await Promise.all([
        graphRetriever.initialize({} as LibrarianStorage),
        vectorRetriever.initialize({} as LibrarianStorage),
        lspRetriever.initialize({} as LibrarianStorage),
      ]);

      const [graphResults, vectorResults, lspResults] = await Promise.all([
        graphRetriever.retrieve('test query'),
        vectorRetriever.retrieve('test query'),
        lspRetriever.retrieve('test query'),
      ]);

      expect(Array.isArray(graphResults)).toBe(true);
      expect(Array.isArray(vectorResults)).toBe(true);
      expect(Array.isArray(lspResults)).toBe(true);

      await Promise.all([
        graphRetriever.shutdown(),
        vectorRetriever.shutdown(),
        lspRetriever.shutdown(),
      ]);
    });
  });
});
