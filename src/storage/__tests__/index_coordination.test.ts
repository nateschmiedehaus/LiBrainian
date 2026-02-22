import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { LibrarianStorage } from '../types.js';
import type { FunctionKnowledge } from '../../types.js';

function createTestFunction(id: string, name: string, filePath: string): FunctionKnowledge {
  return {
    id,
    name,
    filePath,
    startLine: 1,
    endLine: 10,
    signature: `function ${name}(): void`,
    purpose: `Test function ${name}`,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

describe('index coordination metadata', () => {
  let storage: LibrarianStorage;
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'librarian-index-coordination-'));
    dbPath = join(testDir, 'test.db');
    storage = createSqliteStorage(dbPath, testDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('increments index coordination version and persists change events on commit', async () => {
    const before = await storage.getIndexCoordinationVersion();
    await storage.transaction(async (tx) => {
      await tx.setFileChecksum('src/auth/middleware.ts', 'checksum-1');
      await tx.upsertFunction(
        createTestFunction('fn_auth_middleware', 'authMiddleware', 'src/auth/middleware.ts')
      );
    });

    const after = await storage.getIndexCoordinationVersion();
    expect(after).toBe(before + 1);

    const changes = await storage.getIndexChangeEvents({ sinceVersion: before });
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((event) => event.path === 'src/auth/middleware.ts')).toBe(true);
    expect(changes.some((event) => event.type === 'file_added')).toBe(true);
    expect(changes.some((event) => event.type === 'function_updated')).toBe(true);
  });

  it('does not write coordination version or change events for rolled-back transaction', async () => {
    const before = await storage.getIndexCoordinationVersion();

    await expect(storage.transaction(async (tx) => {
      await tx.setFileChecksum('src/auth/rollback.ts', 'checksum-rollback');
      throw new Error('boom');
    })).rejects.toThrow('boom');

    const after = await storage.getIndexCoordinationVersion();
    expect(after).toBe(before);

    const changes = await storage.getIndexChangeEvents({ sinceVersion: before });
    expect(changes).toHaveLength(0);
  });

  it('filters change events by path selector', async () => {
    await storage.transaction(async (tx) => {
      await tx.setFileChecksum('src/auth/middleware.ts', 'checksum-auth');
      await tx.setFileChecksum('src/payments/service.ts', 'checksum-payments');
    });

    const authChanges = await storage.getIndexChangeEvents({ paths: ['src/auth/**'] });
    expect(authChanges.length).toBeGreaterThan(0);
    expect(authChanges.every((event) => event.path.startsWith('src/auth/'))).toBe(true);
  });

  it('does not log rollback warnings when transaction rollback is skipped safely', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transactionalStorage = storage as unknown as {
      db: {
        exec: (statement: string) => unknown;
        inTransaction: boolean;
      };
    };
    const originalExec = transactionalStorage.db.exec;
    const rollbackError = new Error('cannot rollback - no transaction is active');

    const execSpy = vi.spyOn(transactionalStorage.db, 'exec').mockImplementation((statement: string) => {
      if (statement === 'BEGIN') {
        return undefined;
      }
      if (statement === 'ROLLBACK') {
        throw rollbackError;
      }
      return originalExec.call(transactionalStorage.db, statement);
    });

    await expect(
      storage.transaction(async () => {
        throw new Error('indexing conflict');
      })
    ).rejects.toThrow('indexing conflict');

    expect(execSpy).toHaveBeenCalledWith('BEGIN');
    expect(execSpy).not.toHaveBeenCalledWith('ROLLBACK');
    expect(warnSpy).not.toHaveBeenCalled();

    execSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
