import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { ContextPack } from '../../types.js';
import type { LibrarianStorage } from '../types.js';

function buildPack(targetId: string, filePath: string): ContextPack {
  return {
    packId: `pack-${targetId}`,
    packType: 'function_context',
    targetId,
    summary: `${targetId} summary`,
    keyFacts: ['fact-a', 'fact-b'],
    codeSnippets: [
      {
        filePath,
        startLine: 1,
        endLine: 3,
        language: 'ts',
        content: 'export const value = 1;',
      },
    ],
    relatedFiles: [filePath],
    confidence: 0.9,
    createdAt: new Date('2026-02-20T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 0,
      minor: 2,
      patch: 1,
      string: '0.2.1',
      qualityTier: 'full',
      indexedAt: new Date('2026-02-20T00:00:00.000Z'),
      indexerVersion: 'test',
      features: [],
    },
    invalidationTriggers: [filePath],
  };
}

describe('context pack versioning and path normalization', () => {
  let tempDir = '';
  let dbPath = '';
  let storage: LibrarianStorage | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-pack-versioning-'));
    dbPath = path.join(tempDir, 'librarian.sqlite');
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
      storage = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('stores schemaVersion/contentHash and normalizes workspace paths to relative', async () => {
    const absolutePath = path.join(tempDir, 'src', 'auth', 'token.ts');
    const pack = buildPack('fn-auth-token', absolutePath);
    await storage!.upsertContextPack(pack);

    const stored = await storage!.getContextPackForTarget('fn-auth-token', 'function_context');
    expect(stored).toBeTruthy();
    expect(stored?.schemaVersion).toBe(1);
    expect(typeof stored?.contentHash).toBe('string');
    expect(stored?.contentHash?.length).toBeGreaterThan(10);
    expect(stored?.relatedFiles[0]).toBe('src/auth/token.ts');
    expect(stored?.invalidationTriggers[0]).toBe('src/auth/token.ts');
    expect(stored?.codeSnippets[0]?.filePath).toBe('src/auth/token.ts');
  });

  it('keeps deterministic content hash when equivalent absolute/relative paths are upserted', async () => {
    const absolutePath = path.join(tempDir, 'src', 'api', 'user.ts');
    await storage!.upsertContextPack(buildPack('fn-user', absolutePath));
    const first = await storage!.getContextPackForTarget('fn-user', 'function_context');

    const relativePack = buildPack('fn-user', 'src/api/user.ts');
    await storage!.upsertContextPack(relativePack);
    const second = await storage!.getContextPackForTarget('fn-user', 'function_context');

    expect(first?.contentHash).toBeTruthy();
    expect(second?.contentHash).toBe(first?.contentHash);
    expect(second?.relatedFiles).toEqual(['src/api/user.ts']);
  });
});
