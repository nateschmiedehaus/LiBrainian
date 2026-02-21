/**
 * @fileoverview Tests for bootstrap checkpoint recovery and concurrent access protection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  __testing,
  bootstrapWithRecovery,
  bootstrapSafe,
  type BootstrapCheckpoint,
} from '../bootstrap.js';

const {
  readBootstrapCheckpoint,
  writeBootstrapCheckpoint,
  clearBootstrapCheckpoint,
  bootstrapCheckpointPath,
} = __testing;

// Mock dependencies
vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../events.js', () => ({
  globalEventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
  },
  createBootstrapStartedEvent: vi.fn(),
  createBootstrapPhaseCompleteEvent: vi.fn(),
  createBootstrapCompleteEvent: vi.fn(),
  createBootstrapErrorEvent: vi.fn(),
}));

describe('Bootstrap Checkpoint Recovery', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-cp-'));
    await fs.mkdir(path.join(workspace, '.librainian'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  describe('bootstrapCheckpointPath', () => {
    it('returns correct path', () => {
      const result = bootstrapCheckpointPath('/test/workspace');
      expect(result).toBe('/test/workspace/.librainian/bootstrap-checkpoint.json');
    });
  });

  describe('writeBootstrapCheckpoint / readBootstrapCheckpoint', () => {
    it('writes and reads checkpoint correctly', async () => {
      const checkpoint: BootstrapCheckpoint = {
        phase: 'indexing',
        processedFiles: ['/test/a.ts', '/test/b.ts'],
        failedFiles: [{ path: '/test/c.ts', error: 'Parse error', attempts: 1 }],
        startTime: Date.now() - 1000,
        lastUpdateTime: Date.now(),
        totalFiles: 10,
        version: 1,
      };

      await writeBootstrapCheckpoint(workspace, checkpoint);
      const read = await readBootstrapCheckpoint(workspace);

      expect(read).toEqual(checkpoint);
    });

    it('returns null for non-existent checkpoint', async () => {
      const read = await readBootstrapCheckpoint(workspace);
      expect(read).toBeNull();
    });

    it('returns null for expired checkpoint', async () => {
      const checkpoint: BootstrapCheckpoint = {
        phase: 'indexing',
        processedFiles: [],
        failedFiles: [],
        startTime: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        lastUpdateTime: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        totalFiles: 0,
        version: 1,
      };

      await writeBootstrapCheckpoint(workspace, checkpoint);
      const read = await readBootstrapCheckpoint(workspace);

      expect(read).toBeNull();
    });

    it('returns null for invalid checkpoint structure', async () => {
      const invalidCheckpoint = { invalid: true };
      await fs.writeFile(
        bootstrapCheckpointPath(workspace),
        JSON.stringify(invalidCheckpoint),
        'utf8'
      );

      const read = await readBootstrapCheckpoint(workspace);
      expect(read).toBeNull();
    });
  });

  describe('clearBootstrapCheckpoint', () => {
    it('removes checkpoint file', async () => {
      const checkpoint: BootstrapCheckpoint = {
        phase: 'indexing',
        processedFiles: [],
        failedFiles: [],
        startTime: Date.now(),
        lastUpdateTime: Date.now(),
        totalFiles: 0,
        version: 1,
      };

      await writeBootstrapCheckpoint(workspace, checkpoint);
      expect(await readBootstrapCheckpoint(workspace)).not.toBeNull();

      await clearBootstrapCheckpoint(workspace);
      expect(await readBootstrapCheckpoint(workspace)).toBeNull();
    });

    it('handles non-existent file gracefully', async () => {
      // Should not throw
      await clearBootstrapCheckpoint(workspace);
    });
  });
});

describe('bootstrapWithRecovery', () => {
  let workspace: string;
  let mockStorage: any;
  let indexedFiles: string[];
  let indexErrors: Map<string, number>;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-bwr-'));
    await fs.mkdir(path.join(workspace, '.librainian'), { recursive: true });

    indexedFiles = [];
    indexErrors = new Map();

    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getMetadata: vi.fn().mockResolvedValue(null),
      setMetadata: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 0,
        totalModules: 0,
        totalContextPacks: 0,
        totalEmbeddings: 0,
      }),
    };
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('processes all files when starting fresh', async () => {
    const testFiles = ['/test/a.ts', '/test/b.ts', '/test/c.ts'];

    const result = await bootstrapWithRecovery(workspace, mockStorage, {
      force: true,
      scanWorkspace: async () => testFiles,
      indexFile: async (file) => {
        indexedFiles.push(file);
      },
    });

    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBe(3);
    expect(result.filesFailed).toBe(0);
    expect(result.resumedFromCheckpoint).toBe(false);
    expect(indexedFiles).toEqual(testFiles);
  });

  it('resumes from checkpoint', async () => {
    const testFiles = ['/test/a.ts', '/test/b.ts', '/test/c.ts', '/test/d.ts'];

    // Create a checkpoint with 2 files already processed
    const checkpoint: BootstrapCheckpoint = {
      phase: 'indexing',
      processedFiles: ['/test/a.ts', '/test/b.ts'],
      failedFiles: [],
      startTime: Date.now() - 1000,
      lastUpdateTime: Date.now(),
      totalFiles: 4,
      version: 1,
    };
    await writeBootstrapCheckpoint(workspace, checkpoint);

    const result = await bootstrapWithRecovery(workspace, mockStorage, {
      scanWorkspace: async () => testFiles,
      indexFile: async (file) => {
        indexedFiles.push(file);
      },
    });

    expect(result.success).toBe(true);
    expect(result.resumedFromCheckpoint).toBe(true);
    // Should only process c.ts and d.ts
    expect(indexedFiles).toEqual(['/test/c.ts', '/test/d.ts']);
    expect(result.filesIndexed).toBe(4); // Total including previously processed
  });

  it('retries failed files across multiple runs', async () => {
    const testFiles = ['/test/a.ts', '/test/b.ts'];
    let attemptCount = 0;

    // First run - b.ts fails
    const result1 = await bootstrapWithRecovery(workspace, mockStorage, {
      force: true,
      maxRetries: 3,
      scanWorkspace: async () => testFiles,
      indexFile: async (file) => {
        if (file === '/test/b.ts') {
          attemptCount++;
          throw new Error('Temporary failure');
        }
        indexedFiles.push(file);
      },
    });

    // First run completes but b.ts is marked as failed (1 attempt)
    expect(result1.filesIndexed).toBe(1); // Only a.ts succeeded
    expect(result1.filesFailed).toBe(0); // Not permanently failed yet (< maxRetries)

    // Second run - simulate recovery from checkpoint where b.ts succeeds
    indexedFiles = [];
    attemptCount = 0;

    // Create a checkpoint that includes the previous failure
    const checkpoint: BootstrapCheckpoint = {
      phase: 'indexing',
      processedFiles: ['/test/a.ts'],
      failedFiles: [{ path: '/test/b.ts', error: 'Temporary failure', attempts: 1 }],
      startTime: Date.now() - 1000,
      lastUpdateTime: Date.now(),
      totalFiles: 2,
      version: 1,
    };
    await writeBootstrapCheckpoint(workspace, checkpoint);

    const result2 = await bootstrapWithRecovery(workspace, mockStorage, {
      maxRetries: 3,
      scanWorkspace: async () => testFiles,
      indexFile: async (file) => {
        // b.ts now succeeds
        indexedFiles.push(file);
      },
    });

    expect(result2.resumedFromCheckpoint).toBe(true);
    expect(result2.success).toBe(true);
    expect(result2.filesIndexed).toBe(2); // Both files now indexed
    expect(result2.filesFailed).toBe(0);
  });

  it('marks permanently failed files after max retries across runs', async () => {
    const testFiles = ['/test/a.ts', '/test/b.ts'];

    // Create a checkpoint where b.ts has already failed once
    const checkpoint: BootstrapCheckpoint = {
      phase: 'indexing',
      processedFiles: ['/test/a.ts'],
      failedFiles: [{ path: '/test/b.ts', error: 'Previous failure', attempts: 1 }],
      startTime: Date.now() - 1000,
      lastUpdateTime: Date.now(),
      totalFiles: 2,
      version: 1,
    };
    await writeBootstrapCheckpoint(workspace, checkpoint);

    // Second run with maxRetries: 2 - b.ts will fail again (attempt 2 = max)
    const result = await bootstrapWithRecovery(workspace, mockStorage, {
      maxRetries: 2,
      scanWorkspace: async () => testFiles,
      indexFile: async (file) => {
        if (file === '/test/b.ts') {
          throw new Error('Permanent failure');
        }
        indexedFiles.push(file);
      },
    });

    expect(result.resumedFromCheckpoint).toBe(true);
    expect(result.success).toBe(false);
    expect(result.filesIndexed).toBe(1); // a.ts was already indexed
    expect(result.filesFailed).toBe(1);
    expect(result.failedFiles[0].path).toBe('/test/b.ts');
    expect(result.failedFiles[0].error).toBe('Permanent failure');
  });

  it('saves checkpoint after processing files', async () => {
    const testFiles = ['/test/a.ts', '/test/b.ts', '/test/c.ts'];

    // Use more files than batch size to ensure checkpoint is written
    const manyFiles = Array.from({ length: 15 }, (_, i) => `/test/file${i}.ts`);

    const result = await bootstrapWithRecovery(workspace, mockStorage, {
      force: true,
      scanWorkspace: async () => manyFiles,
      indexFile: async (file) => {
        indexedFiles.push(file);
      },
    });

    // All files should be processed
    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBe(15);

    // Checkpoint should be cleared after successful completion
    const checkpoint = await readBootstrapCheckpoint(workspace);
    expect(checkpoint).toBeNull();
  });

  it('calls progress callback', async () => {
    const testFiles = ['/test/a.ts', '/test/b.ts'];
    const progressCalls: Array<{ phase: string; processed: number; total: number }> = [];

    await bootstrapWithRecovery(workspace, mockStorage, {
      force: true,
      scanWorkspace: async () => testFiles,
      indexFile: async () => {},
      onProgress: (p) => progressCalls.push(p),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0].phase).toBe('scanning');
    expect(progressCalls.some((p) => p.phase === 'indexing')).toBe(true);
  });
});

describe('bootstrapSafe', () => {
  let workspace: string;
  let mockStorage: any;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-bs-'));
    await fs.mkdir(path.join(workspace, '.librainian'), { recursive: true });

    mockStorage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getMetadata: vi.fn().mockResolvedValue(null),
      setMetadata: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({
        totalFunctions: 0,
        totalModules: 0,
        totalContextPacks: 0,
        totalEmbeddings: 0,
      }),
    };
  });

  afterEach(async () => {
    // Clean up lock file if it exists
    try {
      await fs.unlink(path.join(workspace, '.librainian', 'bootstrap.lock'));
    } catch {
      // Ignore
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('acquires lock and runs bootstrap', async () => {
    const result = await bootstrapSafe(workspace, mockStorage, {
      force: true,
      scanWorkspace: async () => [],
      indexFile: async () => {},
    });

    expect(result.success).toBe(true);

    // Lock should be released after completion
    const lockPath = path.join(workspace, '.librainian', 'bootstrap.lock');
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it('fails if lock cannot be acquired', async () => {
    // Create a lock file manually
    const lockPath = path.join(workspace, '.librainian', 'bootstrap.lock');
    const lockState = { pid: process.pid + 1, startedAt: new Date().toISOString() };
    await fs.writeFile(lockPath, JSON.stringify(lockState), 'utf8');

    // Mock process.kill to return true (process is alive)
    const originalKill = process.kill;
    process.kill = vi.fn().mockImplementation((pid, signal) => {
      if (signal === 0) return true;
      return originalKill.call(process, pid, signal);
    });

    try {
      await expect(
        bootstrapSafe(workspace, mockStorage, {
          lockTimeoutMs: 500,
          scanWorkspace: async () => [],
          indexFile: async () => {},
        })
      ).rejects.toThrow('timed out');
    } finally {
      process.kill = originalKill;
    }
  });

  it('releases lock on error', async () => {
    const lockPath = path.join(workspace, '.librainian', 'bootstrap.lock');

    try {
      await bootstrapSafe(workspace, mockStorage, {
        force: true,
        scanWorkspace: async () => {
          throw new Error('Scan failed');
        },
        indexFile: async () => {},
      });
    } catch {
      // Expected
    }

    // Lock should be released
    await expect(fs.access(lockPath)).rejects.toThrow();
  });
});
