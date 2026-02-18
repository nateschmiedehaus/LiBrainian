/**
 * @fileoverview Tier-0 Tests for Staleness Tracker
 *
 * Deterministic tests that verify the staleness tracking implementation.
 * Uses mock storage and temporary files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StalenessTracker, createStalenessTracker } from '../staleness.js';
import type { LibrarianStorage, FileKnowledge, IndexingResult } from '../types.js';
import { computeFileChecksum } from '../../utils/checksums.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

class MockStorage implements Partial<LibrarianStorage> {
  private checksums = new Map<string, string>();
  private files = new Map<string, FileKnowledge>();
  private lastIndexingResult: IndexingResult | null = null;

  async getFileChecksum(filePath: string): Promise<string | null> {
    return this.checksums.get(filePath) ?? null;
  }

  async setFileChecksum(filePath: string, checksum: string): Promise<void> {
    this.checksums.set(filePath, checksum);
  }

  async getFileByPath(filePath: string): Promise<FileKnowledge | null> {
    return this.files.get(filePath) ?? null;
  }

  async getFiles(): Promise<FileKnowledge[]> {
    return Array.from(this.files.values());
  }

  async getLastIndexingResult(): Promise<IndexingResult | null> {
    return this.lastIndexingResult;
  }

  // Test helpers
  addFile(file: FileKnowledge): void {
    this.files.set(file.path, file);
    this.checksums.set(file.path, file.checksum);
  }

  setLastIndexingResult(result: IndexingResult): void {
    this.lastIndexingResult = result;
  }
}

function createMockFileKnowledge(filePath: string, checksum: string): FileKnowledge {
  return {
    id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    path: filePath,
    relativePath: path.basename(filePath),
    name: path.basename(filePath),
    extension: path.extname(filePath),
    category: 'code',
    purpose: 'Test file',
    role: 'implementation',
    lineCount: 10,
    functionCount: 1,
    classCount: 0,
    importCount: 0,
    exportCount: 0,
    imports: [],
    importedBy: [],
    directory: path.dirname(filePath),
    complexity: 'low',
    hasTests: false,
    checksum,
    confidence: 0.8,
    lastIndexed: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('StalenessTracker', () => {
  let tracker: StalenessTracker;
  let mockStorage: MockStorage;
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-test-'));
    mockStorage = new MockStorage();
    tracker = createStalenessTracker(mockStorage as unknown as LibrarianStorage);
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('checkFile', () => {
    it('returns fresh status for unchanged file', async () => {
      // Create a test file
      const testFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(testFile, 'const x = 1;');

      // Compute checksum and store it
      const content = fs.readFileSync(testFile, 'utf-8');
      const checksum = computeFileChecksum(content);

      mockStorage.addFile(createMockFileKnowledge(testFile, checksum));

      const status = await tracker.checkFile(testFile);

      expect(status.status).toBe('fresh');
      expect(status.storedChecksum).toBe(checksum);
      expect(status.currentChecksum).toBe(checksum);
    });

    it('returns stale status for modified file', async () => {
      // Create a test file
      const testFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(testFile, 'const x = 1;');

      // Store an old checksum
      mockStorage.addFile(createMockFileKnowledge(testFile, 'old_checksum_12345'));

      const status = await tracker.checkFile(testFile);

      expect(status.status).toBe('stale');
      expect(status.storedChecksum).toBe('old_checksum_12345');
      expect(status.reason).toContain('Checksum mismatch');
    });

    it('returns new status for unindexed file', async () => {
      // Create a test file but don't index it
      const testFile = path.join(tempDir, 'new.ts');
      fs.writeFileSync(testFile, 'const y = 2;');

      const status = await tracker.checkFile(testFile);

      expect(status.status).toBe('new');
      expect(status.storedChecksum).toBeUndefined();
      expect(status.currentChecksum).toBeDefined();
    });

    it('returns missing status for deleted indexed file', async () => {
      // Store checksum for a file that doesn't exist
      const deletedFile = path.join(tempDir, 'deleted.ts');
      mockStorage.addFile(createMockFileKnowledge(deletedFile, 'stored_checksum'));

      const status = await tracker.checkFile(deletedFile);

      expect(status.status).toBe('missing');
      expect(status.storedChecksum).toBe('stored_checksum');
    });

    it('returns error status for non-existent unindexed file', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent.ts');

      const status = await tracker.checkFile(nonExistent);

      expect(status.status).toBe('error');
      expect(status.reason).toContain('does not exist');
    });
  });

  describe('checkFiles', () => {
    it('checks multiple files in parallel', async () => {
      // Create test files
      const file1 = path.join(tempDir, 'a.ts');
      const file2 = path.join(tempDir, 'b.ts');
      fs.writeFileSync(file1, 'const a = 1;');
      fs.writeFileSync(file2, 'const b = 2;');

      // Index file1 with correct checksum
      const checksum1 = computeFileChecksum('const a = 1;');
      mockStorage.addFile(createMockFileKnowledge(file1, checksum1));

      // Index file2 with old checksum
      mockStorage.addFile(createMockFileKnowledge(file2, 'old_checksum'));

      const statuses = await tracker.checkFiles([file1, file2]);

      expect(statuses).toHaveLength(2);
      expect(statuses.find((s) => s.filePath === file1)?.status).toBe('fresh');
      expect(statuses.find((s) => s.filePath === file2)?.status).toBe('stale');
    });
  });

  describe('getNewFiles', () => {
    it('finds unindexed files in directory', async () => {
      // Create test files
      const indexed = path.join(tempDir, 'indexed.ts');
      const newFile = path.join(tempDir, 'new.ts');
      fs.writeFileSync(indexed, 'const x = 1;');
      fs.writeFileSync(newFile, 'const y = 2;');

      // Only index one file
      mockStorage.addFile(createMockFileKnowledge(indexed, 'some_checksum'));

      const newFiles = await tracker.getNewFiles({
        rootDir: tempDir,
        extensions: ['.ts'],
      });

      expect(newFiles).toHaveLength(1);
      expect(newFiles[0]).toBe(newFile);
    });

    it('respects exclude directories', async () => {
      // Create a node_modules dir with a file
      const nodeModules = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nodeModules);
      fs.writeFileSync(path.join(nodeModules, 'lib.ts'), 'export const lib = 1;');

      // Create a regular file
      const regularFile = path.join(tempDir, 'main.ts');
      fs.writeFileSync(regularFile, 'const main = 1;');

      const newFiles = await tracker.getNewFiles({
        rootDir: tempDir,
        extensions: ['.ts'],
        excludeDirs: ['node_modules'],
      });

      expect(newFiles).toHaveLength(1);
      expect(newFiles[0]).toBe(regularFile);
    });

    it('respects limit option', async () => {
      // Create many files
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(tempDir, `file${i}.ts`), `const x${i} = ${i};`);
      }

      const newFiles = await tracker.getNewFiles({
        rootDir: tempDir,
        extensions: ['.ts'],
        limit: 3,
      });

      expect(newFiles.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getStats', () => {
    it('computes accurate staleness statistics', async () => {
      // Create files with various statuses
      const freshFile = path.join(tempDir, 'fresh.ts');
      const staleFile = path.join(tempDir, 'stale.ts');
      const newFile = path.join(tempDir, 'new.ts');

      fs.writeFileSync(freshFile, 'const fresh = 1;');
      fs.writeFileSync(staleFile, 'const stale = 2;');
      fs.writeFileSync(newFile, 'const neww = 3;');

      // Index fresh file with correct checksum
      const freshChecksum = computeFileChecksum('const fresh = 1;');
      mockStorage.addFile(createMockFileKnowledge(freshFile, freshChecksum));

      // Index stale file with old checksum
      mockStorage.addFile(createMockFileKnowledge(staleFile, 'old_checksum'));

      // Set last indexing result
      mockStorage.setLastIndexingResult({
        taskId: 'test-task',
        type: 'full',
        startedAt: new Date(Date.now() - 3600000),
        completedAt: new Date(Date.now() - 3500000),
        filesProcessed: 2,
        errors: [],
        duration: 100000,
      });

      const stats = await tracker.getStats({
        rootDir: tempDir,
        extensions: ['.ts'],
      });

      expect(stats.totalFiles).toBe(3); // 2 indexed + 1 new
      expect(stats.freshFiles).toBe(1);
      expect(stats.staleFiles).toBe(1);
      expect(stats.newFiles).toBe(1);
      expect(stats.missingFiles).toBe(0);
      expect(stats.freshnessPercent).toBe(50); // 1 fresh out of 2 indexed
      expect(stats.lastFullIndex).toBeDefined();
      expect(stats.computedAt).toBeInstanceOf(Date);
    });

    it('handles empty index gracefully', async () => {
      // Create a file but don't index anything
      fs.writeFileSync(path.join(tempDir, 'new.ts'), 'const x = 1;');

      const stats = await tracker.getStats({
        rootDir: tempDir,
        extensions: ['.ts'],
      });

      expect(stats.totalFiles).toBe(1);
      expect(stats.freshFiles).toBe(0);
      expect(stats.staleFiles).toBe(0);
      expect(stats.newFiles).toBe(1);
      expect(stats.freshnessPercent).toBe(100); // No indexed files, so 100%
    });
  });

  describe('factory', () => {
    it('createStalenessTracker creates tracker instance', () => {
      const tracker = createStalenessTracker(mockStorage as unknown as LibrarianStorage);
      expect(tracker).toBeInstanceOf(StalenessTracker);
    });
  });
});
