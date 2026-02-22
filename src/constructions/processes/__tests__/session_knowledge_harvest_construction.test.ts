import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteStorage } from '../../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../../storage/types.js';
import { createSessionKnowledgeHarvestConstruction } from '../session_knowledge_harvest_construction.js';

describe('SessionKnowledgeHarvestConstruction', () => {
  let tempDir = '';
  let storage: LiBrainianStorage | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-session-harvest-'));
    storage = createSqliteStorage(path.join(tempDir, 'librarian.sqlite'), tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
      storage = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('seeds high-confidence claims at session end and skips low-confidence claims', async () => {
    const harvest = createSessionKnowledgeHarvestConstruction(storage!, {
      minConfidenceThreshold: 0.8,
      maxPacksPerSession: 10,
    });

    const outcome = await harvest.execute({
      sessionId: 'session-harvest-1',
      claims: [
        {
          intentType: 'query_relevance',
          scope: 'src/auth',
          confidence: 0.92,
          summary: 'Authentication query pipeline and session handling',
          keyFacts: ['fact:auth:1', 'fact:auth:2'],
          relatedFiles: ['src/auth/session.ts'],
        },
        {
          intentType: 'query_relevance',
          scope: 'src/auth',
          confidence: 0.95,
          summary: 'Duplicate scope should be deduplicated by intent+scope',
          keyFacts: ['fact:auth:duplicate'],
          relatedFiles: ['src/auth/session.ts'],
        },
        {
          intentType: 'query_relevance',
          scope: 'src/cache',
          confidence: 0.72,
          summary: 'Low confidence should not be seeded',
          keyFacts: ['fact:cache:low'],
          relatedFiles: ['src/cache/layer.ts'],
        },
      ],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw outcome.error;
    expect(outcome.value.kind).toBe('SessionKnowledgeHarvestResult.v1');
    expect(outcome.value.claimsAnalyzed).toBe(3);
    expect(outcome.value.newPacksSeeded).toHaveLength(1);

    const seeded = await storage!.findByIntentAndScope('query_relevance', 'src/auth');
    expect(seeded).toHaveLength(1);
    expect(seeded[0]?.provenance).toBe('seeded_from_construction');
  });
});
