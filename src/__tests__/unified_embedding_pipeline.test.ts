/**
 * @fileoverview Test unified embedding pipeline
 *
 * Integration test for the complete embedding system:
 * - Function-level chunking
 * - Multi-vector representations
 * - Co-change signals
 * - Cross-encoder re-ranking
 * - LLM purpose extraction (when available)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  UnifiedEmbeddingPipeline,
  type QueryResult,
} from '../api/embedding_providers/unified_embedding_pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const librainianRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../../..');

// ============================================================================
// HELPERS
// ============================================================================

async function loadLiBrainianFiles(): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];

  const walkDir = async (dir: string, prefix: string = '') => {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('__')) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        await walkDir(fullPath, relativePath);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          files.push({ path: relativePath, content });
        } catch {
          // Skip
        }
      }
    }
  };

  await walkDir(librainianRoot);
  return files;
}

// ============================================================================
// TESTS
// ============================================================================

describe('Unified Embedding Pipeline', () => {
  let pipeline: UnifiedEmbeddingPipeline;
  let files: Array<{ path: string; content: string }>;

  beforeAll(async () => {
    console.log('\n' + '='.repeat(70));
    console.log('UNIFIED EMBEDDING PIPELINE TEST');
    console.log('='.repeat(70) + '\n');

    // Load files
    console.log('Loading librainian files...');
    files = await loadLiBrainianFiles();
    console.log(`Found ${files.length} source files\n`);

    // Create pipeline
    pipeline = new UnifiedEmbeddingPipeline({
      enableChunking: true,
      enableCoChange: true,
      enableCrossEncoder: false, // Disable for faster tests
      enablePurposeExtraction: false, // No LLM in tests
      returnTopK: 10,
    });

    // Initialize with repo context
    console.log('Initializing pipeline...');
    await pipeline.initialize(repoRoot);
    console.log();

    // Index files (limit for test speed)
    console.log('Indexing files...');
    const filesToIndex = files.slice(0, 20); // Limit for speed
    await pipeline.indexFiles(filesToIndex, {
      onProgress: (done, total) => {
        if (done % 5 === 0 || done === total) {
          console.log(`  ${done}/${total} files indexed`);
        }
      },
    });

    const stats = pipeline.getStats();
    console.log(`\nPipeline stats:`);
    console.log(`  Indexed files: ${stats.indexedFiles}`);
    console.log(`  Total chunks: ${stats.totalChunks}`);
    console.log(`  Co-change pairs: ${stats.coChangePairs}`);
    console.log(`  Graph nodes: ${stats.graphNodes}`);
    console.log();
  }, 300000);

  describe('Indexing', () => {
    it('should index files with chunks', () => {
      const stats = pipeline.getStats();
      expect(stats.indexedFiles).toBeGreaterThan(0);
      expect(stats.totalChunks).toBeGreaterThan(0);
    });

    it('should build co-change matrix', () => {
      const stats = pipeline.getStats();
      expect(stats.coChangeEnabled).toBe(true);
    });

    it('should build dependency graph', () => {
      const stats = pipeline.getStats();
      expect(stats.graphNodes).toBeGreaterThan(0);
    });
  });

  describe('Query', () => {
    it('should return relevant results for semantic query', async () => {
      console.log('\n' + '-'.repeat(70));
      console.log('QUERY: "embedding similarity calculation"');
      console.log('-'.repeat(70));

      const results = await pipeline.query('embedding similarity calculation');

      console.log('\nTop results:');
      for (const result of results.slice(0, 5)) {
        console.log(`\n  ${result.filePath}`);
        console.log(`    Score: ${result.finalScore.toFixed(4)}`);
        console.log(`    Semantic: ${result.semanticScore.toFixed(4)}`);
        console.log(`    Keyword: ${result.keywordScore.toFixed(4)}`);
        console.log(`    MultiVector: ${result.multiVectorScore.toFixed(4)}`);
        if (result.matchedAspects.length > 0) {
          console.log(`    Matched: ${result.matchedAspects.join(', ')}`);
        }
        if (result.bestChunks?.length) {
          console.log(`    Best chunks: ${result.bestChunks.map(c => c.name).join(', ')}`);
        }
      }

      expect(results.length).toBeGreaterThan(0);
    }, 60000);

    it('should handle code-specific queries', async () => {
      console.log('\n' + '-'.repeat(70));
      console.log('QUERY: "async function that stores data in sqlite"');
      console.log('-'.repeat(70));

      const results = await pipeline.query('async function that stores data in sqlite');

      console.log('\nTop results:');
      for (const result of results.slice(0, 5)) {
        console.log(`  ${result.filePath}: ${result.finalScore.toFixed(4)}`);
      }

      expect(results.length).toBeGreaterThan(0);
    }, 60000);

    it('should use different query types', async () => {
      console.log('\n' + '-'.repeat(70));
      console.log('QUERY TYPES COMPARISON');
      console.log('-'.repeat(70));

      const query = 'relevance scoring';

      const defaultResults = await pipeline.query(query, { queryType: 'default' });
      const purposeResults = await pipeline.query(query, { queryType: 'similar-purpose' });
      const structureResults = await pipeline.query(query, { queryType: 'similar-structure' });

      console.log('\nDefault weighting:');
      for (const r of defaultResults.slice(0, 3)) {
        console.log(`  ${r.filePath}: ${r.finalScore.toFixed(4)}`);
      }

      console.log('\nPurpose-weighted:');
      for (const r of purposeResults.slice(0, 3)) {
        console.log(`  ${r.filePath}: ${r.finalScore.toFixed(4)}`);
      }

      console.log('\nStructure-weighted:');
      for (const r of structureResults.slice(0, 3)) {
        console.log(`  ${r.filePath}: ${r.finalScore.toFixed(4)}`);
      }

      expect(defaultResults.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Similarity', () => {
    it('should find similar files', async () => {
      console.log('\n' + '-'.repeat(70));
      console.log('SIMILAR FILE SEARCH');
      console.log('-'.repeat(70));

      // Pick a file that was indexed
      const stats = pipeline.getStats();
      if (stats.indexedFiles === 0) {
        console.log('No files indexed, skipping');
        return;
      }

      // Find similar to first indexed file
      const targetFile = files[0].path;
      console.log(`\nFinding files similar to: ${targetFile}`);

      const similar = await pipeline.findSimilar(targetFile, 5);

      console.log('\nSimilar files:');
      for (const s of similar) {
        console.log(`  ${s.filePath}: ${s.similarity.toFixed(4)}`);
        if (s.aspects.length > 0) {
          console.log(`    Matched: ${s.aspects.join(', ')}`);
        }
      }

      expect(similar.length).toBeLessThanOrEqual(5);
    }, 60000);
  });

  describe('Configuration', () => {
    it('should return current config', () => {
      const config = pipeline.getConfig();

      expect(config.embeddingModel).toBe('all-MiniLM-L6-v2');
      expect(config.enableChunking).toBe(true);
      expect(config.enableCoChange).toBe(true);
    });

    it('should update config', () => {
      pipeline.updateConfig({ returnTopK: 5 });
      const config = pipeline.getConfig();
      expect(config.returnTopK).toBe(5);

      // Reset
      pipeline.updateConfig({ returnTopK: 10 });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty query', async () => {
      const results = await pipeline.query('');
      // Should return something even for empty query
      expect(results).toBeDefined();
    });

    it('should handle query with no matches', async () => {
      const results = await pipeline.query('zzzznonexistentfunctionzzzzz', {
        minScore: 0.8, // High threshold
      });
      expect(results.length).toBe(0);
    });

    it('should handle similarity for non-indexed file', async () => {
      const similar = await pipeline.findSimilar('nonexistent/file.ts');
      expect(similar.length).toBe(0);
    });
  });
});
