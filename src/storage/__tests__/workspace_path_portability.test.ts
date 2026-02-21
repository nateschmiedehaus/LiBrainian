import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { ContextPack } from '../../types.js';

const cleanupDirs: string[] = [];

async function makeTemp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function buildPack(filePath: string): ContextPack {
  return {
    packId: 'pack-portability',
    packType: 'module_context',
    targetId: 'module:src/auth/session.ts',
    summary: 'Session handling module',
    keyFacts: ['uses token refresh'],
    codeSnippets: [
      {
        filePath,
        startLine: 1,
        endLine: 3,
        language: 'ts',
        content: 'export const session = true;',
      },
    ],
    relatedFiles: [filePath],
    confidence: 0.9,
    createdAt: new Date('2026-02-21T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 0,
      minor: 3,
      patch: 0,
      string: '0.3.0',
      qualityTier: 'full',
      indexedAt: new Date('2026-02-21T00:00:00.000Z'),
      indexerVersion: 'test',
      features: [],
    },
    invalidationTriggers: [filePath],
  };
}

describe('workspace path portability', () => {
  afterEach(async () => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rebinds legacy absolute workspace references when index is opened from a new workspace root', async () => {
    const workspaceA = await makeTemp('librarian-portability-a-');
    const workspaceB = await makeTemp('librarian-portability-b-');

    const aDbPath = path.join(workspaceA, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(aDbPath), { recursive: true });

    const storageA = createSqliteStorage(aDbPath, workspaceA);
    await storageA.initialize();

    const absolutePathA = path.join(workspaceA, 'src', 'auth', 'session.ts');
    await storageA.upsertContextPack(buildPack(absolutePathA));
    await storageA.setState(
      'watch_state',
      JSON.stringify({ schema_version: 1, workspace_root: workspaceA, needs_catchup: false }),
    );

    await storageA.close();

    const db = new Database(aDbPath);
    db.prepare('UPDATE librarian_context_packs SET related_files = ?, code_snippets = ?, invalidation_triggers = ?').run(
      JSON.stringify([absolutePathA]),
      JSON.stringify([
        {
          filePath: absolutePathA,
          startLine: 1,
          endLine: 3,
          language: 'ts',
          content: 'export const session = true;',
        },
      ]),
      JSON.stringify([absolutePathA]),
    );

    const metadataRow = db.prepare('SELECT value FROM librarian_metadata WHERE key = ?').get('metadata') as
      | { value: string }
      | undefined;
    const metadata = metadataRow ? (JSON.parse(metadataRow.value) as Record<string, unknown>) : {};
    metadata.workspace = workspaceA;
    db.prepare('INSERT OR REPLACE INTO librarian_metadata (key, value) VALUES (?, ?)').run(
      'metadata',
      JSON.stringify(metadata),
    );
    db.close();

    const bDbPath = path.join(workspaceB, '.librarian', 'librarian.sqlite');
    await fs.mkdir(path.dirname(bDbPath), { recursive: true });
    await fs.copyFile(aDbPath, bDbPath);

    const storageB = createSqliteStorage(bDbPath, workspaceB);
    await storageB.initialize();

    const pack = await storageB.getContextPackForTarget('module:src/auth/session.ts', 'module_context');
    expect(pack).toBeTruthy();
    expect(pack?.relatedFiles).toEqual(['src/auth/session.ts']);
    expect(pack?.invalidationTriggers).toEqual(['src/auth/session.ts']);
    expect(pack?.codeSnippets[0]?.filePath).toBe('src/auth/session.ts');

    const metadataAfter = await storageB.getMetadata();
    expect(metadataAfter?.workspace).toBe(workspaceB);

    const watchStateRaw = await storageB.getState('watch_state');
    expect(watchStateRaw).toBeTruthy();
    const watchState = JSON.parse(String(watchStateRaw)) as { workspace_root?: string };
    expect(watchState.workspace_root).toBe(workspaceB);

    await storageB.close();
  });
});
