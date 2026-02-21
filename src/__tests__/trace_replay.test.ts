/**
 * @fileoverview Tier-0 Tests for trace replay anchors.
 *
 * Validates that traceId binds to evidence ledger sessions when available
 * and discloses replay unavailability otherwise.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../storage/types.js';
import { getCurrentVersion } from '../api/versioning.js';
import {
  SqliteEvidenceLedger,
  createSessionId,
  REPLAY_UNAVAILABLE_TRACE,
  resolveReplaySessionId,
} from '../epistemics/evidence_ledger.js';

vi.mock('../api/provider_check.js', () => ({
  checkProviderSnapshot: vi.fn().mockResolvedValue({
    status: {
      llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
      embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
    },
    remediationSteps: ['unverified_by_trace(provider_unavailable): providers unavailable'],
    reason: 'unavailable',
  }),
  ProviderUnavailableError: class ProviderUnavailableError extends Error {
    constructor(public details: { message: string; missing: string[]; suggestion: string }) {
      super(details.message);
      this.name = 'ProviderUnavailableError';
    }
  },
}));

const workspaceRoot = process.cwd();

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librainian-replay-test-${randomUUID()}.db`);
}

async function seedStorageForQuery(storage: LiBrainianStorage, relatedFile: string): Promise<void> {
  await storage.upsertFunction({
    id: 'fn-replay-1',
    filePath: path.join(workspaceRoot, relatedFile),
    name: 'replayTest',
    signature: 'replayTest(): void',
    purpose: 'Test function for replay trace anchor.',
    startLine: 1,
    endLine: 3,
    confidence: 0.7,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  });
  await storage.upsertContextPack({
    packId: 'pack-replay-1',
    packType: 'function_context',
    targetId: 'fn-replay-1',
    summary: 'Replay trace anchor context pack',
    keyFacts: ['Used to validate replay trace anchor'],
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

describe('Trace replay anchors', () => {
  let storage: LiBrainianStorage;

  afterEach(async () => {
    await storage?.close?.();
  });

  it('anchors traceId to evidence ledger sessions for replay queries', async () => {
    const { queryLiBrainian } = await import('../api/query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();
    await seedStorageForQuery(storage, 'src/auth.ts');

    const ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
    const sessionId = createSessionId('sess_replay_anchor');

    const response = await queryLiBrainian(
      { intent: 'trace replay anchor', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
      storage,
      undefined,
      undefined,
      undefined,
      { evidenceLedger: ledger, sessionId }
    );

    expect(response.traceId).toBe(sessionId);
    expect(resolveReplaySessionId(response.traceId)).toBe(sessionId);

    const sessionEntries = await ledger.getSessionEntries(sessionId);
    expect(sessionEntries.length).toBeGreaterThan(0);

    await ledger.close();
  });

  it('discloses replay unavailability when no ledger exists', async () => {
    const { queryLiBrainian } = await import('../api/query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();
    await seedStorageForQuery(storage, 'src/auth.ts');

    const response = await queryLiBrainian(
      { intent: 'trace replay unavailable', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
      storage
    );

    expect(response.traceId).toBe(REPLAY_UNAVAILABLE_TRACE);
    expect(resolveReplaySessionId(response.traceId)).toBeNull();
    expect(response.disclosures).toContain(`${REPLAY_UNAVAILABLE_TRACE}: Evidence ledger unavailable for this query.`);
  });
});
