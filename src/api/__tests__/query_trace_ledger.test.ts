import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import { getCurrentVersion } from '../versioning.js';
import { SqliteEvidenceLedger, createSessionId } from '../../epistemics/evidence_ledger.js';

vi.mock('../provider_check.js', () => ({
  requireProviders: vi.fn().mockRejectedValue(
    Object.assign(new Error('unverified_by_trace(provider_unavailable): Wave0 requires live providers to function'), {
      name: 'ProviderUnavailableError',
      details: {
        message: 'unverified_by_trace(provider_unavailable): Wave0 requires live providers to function',
        missing: ['LLM: unavailable', 'Embedding: unavailable'],
        suggestion: 'Authenticate providers via CLI.',
      },
    })
  ),
  checkAllProviders: vi.fn().mockResolvedValue({
    llm: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
    embedding: { available: false, provider: 'none', model: 'unknown', latencyMs: 0, error: 'unavailable' },
  }),
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
  return path.join(os.tmpdir(), `librainian-trace-test-${randomUUID()}.db`);
}

async function seedStorageForQuery(storage: LiBrainianStorage, relatedFile: string): Promise<void> {
  await storage.upsertFunction({
    id: 'fn-trace-1',
    filePath: path.join(workspaceRoot, relatedFile),
    name: 'traceTest',
    signature: 'traceTest(): void',
    purpose: 'Test function for trace ledger query.',
    startLine: 1,
    endLine: 3,
    confidence: 0.7,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  });
  await storage.upsertContextPack({
    packId: 'pack-trace-1',
    packType: 'function_context',
    targetId: 'fn-trace-1',
    summary: 'Trace ledger context pack',
    keyFacts: ['Used to validate query ledger evidence'],
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

describe('Query trace ledger', () => {
  let storage: LiBrainianStorage;

  afterEach(async () => {
    await storage?.close?.();
  });

  it('records query lifecycle and stage evidence', async () => {
    const { queryLiBrainian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), workspaceRoot);
    await storage.initialize();
    await seedStorageForQuery(storage, 'src/auth.ts');

    const ledger = new SqliteEvidenceLedger(':memory:');
    await ledger.initialize();
    const sessionId = createSessionId('sess_query_trace');

    const response = await queryLiBrainian(
      { intent: 'trace evidence', depth: 'L0', llmRequirement: 'disabled', affectedFiles: ['src/auth.ts'] },
      storage,
      undefined,
      undefined,
      undefined,
      { evidenceLedger: ledger, sessionId }
    );

    const entries = await ledger.query({ sessionId, orderDirection: 'asc' });
    await ledger.close();

    const toolNames = entries
      .map((entry) => (entry.payload as { toolName?: string } | null | undefined)?.toolName)
      .filter((value): value is string => Boolean(value));

    expect(response.traceId).toBe(sessionId);
    expect(toolNames).toContain('librainian_query_query_start');
    expect(toolNames).toContain('librainian_query_query_complete');
    expect(toolNames).toContain('librainian_query_stage');
  });
});
