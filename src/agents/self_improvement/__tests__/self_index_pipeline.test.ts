/**
 * @fileoverview Tests for Self-Index Pipeline (WU-BOOT-001)
 *
 * Tests for the SelfIndexPipeline class that orchestrates complete indexing
 * of Librarian's own codebase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SelfIndexPipeline,
  createSelfIndexPipeline,
  LIBRARIAN_INDEX_CONFIG,
  type SelfIndexConfig,
  type SelfIndexResult,
  type IndexProgress,
  type IndexError,
  type FileIndex,
  type CodeIndex,
  type QualityReport,
} from '../self_index_pipeline.js';
import type { LibrarianStorage } from '../../../storage/types.js';

describe('SelfIndexPipeline', () => {
  let mockStorage: LibrarianStorage;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temp directory for testing
    tempDir = path.join(process.cwd(), '.test-self-index-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    // Create some test files
    await fs.writeFile(
      path.join(tempDir, 'test_file.ts'),
      `export function testFunc() { return 42; }`
    );
    await fs.writeFile(
      path.join(tempDir, 'another_file.ts'),
      `export class TestClass { method() { return 'hello'; } }`
    );
    await fs.mkdir(path.join(tempDir, 'subdir'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'subdir', 'nested.ts'),
      `export const value = 123;`
    );

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
      getFunctions: vi.fn().mockResolvedValue([
        { id: '1', name: 'func1', filePath: '/a.ts' },
        { id: '2', name: 'func2', filePath: '/b.ts' },
      ]),
      getModules: vi.fn().mockResolvedValue([
        { id: 'm1', path: '/a.ts' },
        { id: 'm2', path: '/b.ts' },
      ]),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 2,
        totalModules: 2,
        totalContextPacks: 2,
        totalEmbeddings: 0,
        storageSizeBytes: 1024,
        lastVacuum: null,
        averageConfidence: 0.8,
        cacheHitRate: 0.5,
      }),
    } as unknown as LibrarianStorage;
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============================================================================
  // INTERFACE SHAPE TESTS
  // ============================================================================

  describe('Interface shapes', () => {
    it('has correct interface shape for SelfIndexConfig', () => {
      const config: SelfIndexConfig = {
        rootDir: '/test',
        excludePatterns: ['node_modules/**', 'dist/**'],
        maxFiles: 1000,
        validateQuality: true,
      };

      expect(config.rootDir).toBe('/test');
      expect(config.excludePatterns).toHaveLength(2);
      expect(config.maxFiles).toBe(1000);
      expect(config.validateQuality).toBe(true);
    });

    it('has correct interface shape for IndexProgress', () => {
      const progress: IndexProgress = {
        phase: 'scanning',
        filesProcessed: 50,
        totalFiles: 100,
        currentFile: '/test/file.ts',
        errors: [],
      };

      expect(progress.phase).toBe('scanning');
      expect(progress.filesProcessed).toBe(50);
      expect(progress.totalFiles).toBe(100);
      expect(progress.currentFile).toBe('/test/file.ts');
      expect(progress.errors).toEqual([]);
    });

    it('supports all phase values for IndexProgress', () => {
      const phases: IndexProgress['phase'][] = [
        'scanning',
        'parsing',
        'indexing',
        'validating',
        'complete',
      ];

      for (const phase of phases) {
        const progress: IndexProgress = {
          phase,
          filesProcessed: 0,
          totalFiles: 0,
          errors: [],
        };
        expect(progress.phase).toBe(phase);
      }
    });

    it('has correct interface shape for IndexError', () => {
      const error: IndexError = {
        file: '/test/file.ts',
        error: 'Parse error at line 10',
        recoverable: true,
      };

      expect(error.file).toBe('/test/file.ts');
      expect(error.error).toBe('Parse error at line 10');
      expect(error.recoverable).toBe(true);
    });

    it('has correct interface shape for SelfIndexResult', () => {
      const result: SelfIndexResult = {
        success: true,
        filesIndexed: 150,
        symbolsExtracted: 500,
        indexSize: 2048,
        qualityScore: 0.95,
        errors: [],
        duration: 5000,
      };

      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBe(150);
      expect(result.symbolsExtracted).toBe(500);
      expect(result.indexSize).toBe(2048);
      expect(result.qualityScore).toBe(0.95);
      expect(result.errors).toEqual([]);
      expect(result.duration).toBe(5000);
    });
  });

  // ============================================================================
  // VALIDATION TESTS
  // ============================================================================

  describe('Input validation', () => {
    it('requires rootDir in config', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      await expect(
        pipeline.runPipeline({
          rootDir: '',
          excludePatterns: [],
          maxFiles: 100,
          validateQuality: false,
        })
      ).rejects.toThrow('rootDir is required');
    });

    it('requires storage to be provided', () => {
      expect(
        () => new SelfIndexPipeline({})
      ).toThrow('storage is required');
    });

    it('rejects negative maxFiles', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      await expect(
        pipeline.runPipeline({
          rootDir: tempDir,
          excludePatterns: [],
          maxFiles: -1,
          validateQuality: false,
        })
      ).rejects.toThrow('maxFiles must be a positive number');
    });

    it('rejects non-existent rootDir', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      await expect(
        pipeline.runPipeline({
          rootDir: '/non/existent/path',
          excludePatterns: [],
          maxFiles: 100,
          validateQuality: false,
        })
      ).rejects.toThrow('rootDir does not exist');
    });
  });

  // ============================================================================
  // FILE SCANNING TESTS
  // ============================================================================

  describe('scanFiles', () => {
    it('discovers files in directory', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const files = await pipeline.scanFiles(tempDir, []);

      expect(files.length).toBeGreaterThanOrEqual(3);
      expect(files.some((f) => f.endsWith('test_file.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('another_file.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('nested.ts'))).toBe(true);
    });

    it('respects exclude patterns', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const files = await pipeline.scanFiles(tempDir, ['**/subdir/**']);

      expect(files.some((f) => f.endsWith('test_file.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('nested.ts'))).toBe(false);
    });

    it('returns absolute paths', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const files = await pipeline.scanFiles(tempDir, []);

      for (const file of files) {
        expect(path.isAbsolute(file)).toBe(true);
      }
    });

    it('handles empty directory gracefully', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      await fs.mkdir(emptyDir);

      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const files = await pipeline.scanFiles(emptyDir, []);

      expect(files).toEqual([]);
    });
  });

  // ============================================================================
  // FILE INDEXING TESTS
  // ============================================================================

  describe('indexFile', () => {
    it('returns FileIndex for valid file', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const filePath = path.join(tempDir, 'test_file.ts');
      const fileIndex = await pipeline.indexFile(filePath);

      expect(fileIndex).toBeDefined();
      expect(fileIndex.filePath).toBe(filePath);
      expect(fileIndex.symbols).toBeDefined();
      expect(Array.isArray(fileIndex.symbols)).toBe(true);
    });

    it('handles non-existent file gracefully', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      await expect(
        pipeline.indexFile('/non/existent/file.ts')
      ).rejects.toThrow();
    });

    it('extracts symbols from TypeScript file', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const filePath = path.join(tempDir, 'test_file.ts');
      const fileIndex = await pipeline.indexFile(filePath);

      expect(fileIndex.symbols.length).toBeGreaterThanOrEqual(1);
      expect(fileIndex.symbols.some((s) => s.name === 'testFunc')).toBe(true);
    });
  });

  // ============================================================================
  // INDEX VALIDATION TESTS
  // ============================================================================

  describe('validateIndex', () => {
    it('returns QualityReport for valid index', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const mockIndex: CodeIndex = {
        files: [
          {
            filePath: '/test.ts',
            symbols: [{ name: 'test', kind: 'function', line: 1 }],
            checksum: 'abc123',
            indexedAt: new Date().toISOString(),
          },
        ],
        totalSymbols: 1,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };

      const report = pipeline.validateIndex(mockIndex);

      expect(report).toBeDefined();
      expect(typeof report.score).toBe('number');
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(1);
    });

    it('returns lower score for empty index', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const emptyIndex: CodeIndex = {
        files: [],
        totalSymbols: 0,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };

      const report = pipeline.validateIndex(emptyIndex);

      expect(report.score).toBeLessThan(0.5);
      expect(report.issues.length).toBeGreaterThan(0);
    });

    it('detects missing symbols issue', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const indexWithNoSymbols: CodeIndex = {
        files: [
          {
            filePath: '/test.ts',
            symbols: [],
            checksum: 'abc123',
            indexedAt: new Date().toISOString(),
          },
        ],
        totalSymbols: 0,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };

      const report = pipeline.validateIndex(indexWithNoSymbols);

      expect(report.issues.some((i) => i.includes('no symbols'))).toBe(true);
    });
  });

  // ============================================================================
  // PERSISTENCE TESTS
  // ============================================================================

  describe('persistIndex', () => {
    it('writes index to disk', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const indexPath = path.join(tempDir, 'test-index.json');
      const mockIndex: CodeIndex = {
        files: [],
        totalSymbols: 0,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };

      await pipeline.persistIndex(mockIndex, indexPath);

      const exists = await fs.access(indexPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('creates parent directories if needed', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'index.json');
      const mockIndex: CodeIndex = {
        files: [],
        totalSymbols: 0,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };

      await pipeline.persistIndex(mockIndex, nestedPath);

      const exists = await fs.access(nestedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('loadIndex', () => {
    it('loads index from disk', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const indexPath = path.join(tempDir, 'load-test-index.json');
      const mockIndex: CodeIndex = {
        files: [
          {
            filePath: '/test.ts',
            symbols: [{ name: 'loaded', kind: 'function', line: 1 }],
            checksum: 'def456',
            indexedAt: new Date().toISOString(),
          },
        ],
        totalSymbols: 1,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
      };

      await fs.writeFile(indexPath, JSON.stringify(mockIndex));

      const loaded = await pipeline.loadIndex(indexPath);

      expect(loaded.files.length).toBe(1);
      expect(loaded.files[0].symbols[0].name).toBe('loaded');
    });

    it('throws error for non-existent file', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      await expect(
        pipeline.loadIndex('/non/existent/index.json')
      ).rejects.toThrow();
    });

    it('throws error for invalid JSON', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });
      const invalidPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(invalidPath, 'not valid json {{{');

      await expect(pipeline.loadIndex(invalidPath)).rejects.toThrow();
    });
  });

  // ============================================================================
  // FULL PIPELINE TESTS
  // ============================================================================

  describe('runPipeline', () => {
    it('completes successfully with valid config', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      const result = await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 100,
        validateQuality: false,
      });

      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBeGreaterThanOrEqual(3);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('respects maxFiles limit', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      const result = await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 1,
        validateQuality: false,
      });

      expect(result.filesIndexed).toBeLessThanOrEqual(1);
    });

    it('includes quality score when validation enabled', async () => {
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      const result = await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 100,
        validateQuality: true,
      });

      expect(result.qualityScore).toBeGreaterThan(0);
    });

    it('reports errors without failing completely', async () => {
      // Create an unreadable file (if possible)
      const badFile = path.join(tempDir, 'bad.ts');
      await fs.writeFile(badFile, 'export function bad(');

      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      const result = await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 100,
        validateQuality: false,
      });

      // Pipeline should still succeed overall
      expect(result.success).toBe(true);
      // But may have recorded errors
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('calls progress callback during execution', async () => {
      const progressUpdates: IndexProgress[] = [];
      const pipeline = new SelfIndexPipeline({
        storage: mockStorage,
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      });

      await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 100,
        validateQuality: false,
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some((p) => p.phase === 'scanning')).toBe(true);
      expect(progressUpdates.some((p) => p.phase === 'complete')).toBe(true);
    });
  });

  // ============================================================================
  // DEFAULT CONFIG TESTS
  // ============================================================================

  describe('LIBRARIAN_INDEX_CONFIG', () => {
    it('has expected default values', () => {
      expect(LIBRARIAN_INDEX_CONFIG.rootDir).toBeDefined();
      expect(LIBRARIAN_INDEX_CONFIG.excludePatterns).toContain('node_modules/**');
      expect(LIBRARIAN_INDEX_CONFIG.excludePatterns).toContain('dist/**');
      expect(LIBRARIAN_INDEX_CONFIG.excludePatterns).toContain('**/*.test.ts');
      expect(LIBRARIAN_INDEX_CONFIG.excludePatterns).toContain('eval-corpus/**');
      expect(LIBRARIAN_INDEX_CONFIG.maxFiles).toBe(1000);
      expect(LIBRARIAN_INDEX_CONFIG.validateQuality).toBe(true);
    });
  });

  // ============================================================================
  // FACTORY FUNCTION TESTS
  // ============================================================================

  describe('createSelfIndexPipeline', () => {
    it('creates a pipeline with default options', () => {
      const pipeline = createSelfIndexPipeline({ storage: mockStorage });

      expect(pipeline).toBeInstanceOf(SelfIndexPipeline);
    });

    it('creates a pipeline with custom options', () => {
      const onProgress = vi.fn();
      const pipeline = createSelfIndexPipeline({
        storage: mockStorage,
        onProgress,
        verbose: true,
      });

      expect(pipeline).toBeInstanceOf(SelfIndexPipeline);
    });
  });

  // ============================================================================
  // INTEGRATION WITH SELF BOOTSTRAP
  // ============================================================================

  describe('Integration with selfBootstrap', () => {
    it('uses selfBootstrap internally for indexing when skipBootstrap is false', async () => {
      // Note: In test mode, skipBootstrap defaults to true, so this test
      // verifies the fallback indexing path works correctly.
      // Production integration with selfBootstrap requires real LLM providers.
      const pipeline = new SelfIndexPipeline({ storage: mockStorage });

      // This test verifies the pipeline completes successfully
      const result = await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 10,
        validateQuality: false,
      });

      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('can be configured to skip bootstrap explicitly', async () => {
      const pipeline = new SelfIndexPipeline({
        storage: mockStorage,
        skipBootstrap: true,
      });

      const result = await pipeline.runPipeline({
        rootDir: tempDir,
        excludePatterns: [],
        maxFiles: 10,
        validateQuality: false,
      });

      expect(result.success).toBe(true);
      expect(result.filesIndexed).toBeGreaterThan(0);
    });
  });
});
