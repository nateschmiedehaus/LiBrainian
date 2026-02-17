import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { getCurrentVersion } from '../versioning.js';

const workspaceRoot = process.cwd();

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-watch-freshness-${randomUUID()}.db`);
}

async function seedStorageForQuery(storage: LibrarianStorage, relatedFile: string): Promise<void> {
  await storage.upsertFunction({
    id: 'fn-watch-1',
    filePath: path.join(workspaceRoot, relatedFile),
    name: 'watchTest',
    signature: 'watchTest(): void',
    purpose: 'Test function for watch freshness disclosure.',
    startLine: 1,
    endLine: 3,
    confidence: 0.7,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  });
  await storage.upsertContextPack({
    packId: 'pack-watch-1',
    packType: 'function_context',
    targetId: 'fn-watch-1',
    summary: 'Watch freshness context pack',
    keyFacts: ['Used to validate watch freshness disclosure'],
    codeSnippets: [],
    relatedFiles: [relatedFile],
    confidence: 0.6,
    createdAt: new Date('2026-01-19T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: [],
  });
}

describe('watch freshness disclosures', () => {
  let storage: LibrarianStorage;

  afterEach(async () => {
    vi.useRealTimers();
    await storage?.close?.();
  });

  it('adds disclosures when watcher is unhealthy or stale', async () => {
    const { queryLibrarian } = await import('../query.js');
    vi.useFakeTimers();
    const now = new Date('2026-01-26T01:00:00.000Z');
    vi.setSystemTime(now);

    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();
    await seedStorageForQuery(storage, 'src/auth.ts');

    const staleReconcileAt = new Date(now.getTime() - 120_000).toISOString();
    await storage.setState('librarian.watch_state.v1', JSON.stringify({
      schema_version: 1,
      workspace_root: workspaceRoot,
      watch_last_heartbeat_at: now.toISOString(),
      suspected_dead: true,
      needs_catchup: false,
      storage_attached: true,
      cursor: { kind: 'fs', lastReconcileCompletedAt: staleReconcileAt },
    }));

    const result = await queryLibrarian(
      { intent: 'watch freshness', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
      storage
    );

    expect(result.disclosures).toContain('unverified_by_trace(watch_suspected_dead): watcher heartbeat stale');
    expect(result.disclosures).toContain('unverified_by_trace(watch_reconcile_stale): filesystem reconcile is stale');
  });

  it('uses non-strict disclosures when watch state is unavailable', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();
    await seedStorageForQuery(storage, 'src/auth.ts');

    const result = await queryLibrarian(
      { intent: 'watch state', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
      storage
    );

    expect(result.disclosures).toContain('watch_state_missing: watch state unavailable');
    expect(result.disclosures.some((entry) => entry.includes('unverified_by_trace(watch_state_missing)'))).toBe(false);
  });
});
