import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { getCurrentVersion } from '../versioning.js';

function getTempDbPath(): string {
  return path.join(os.tmpdir(), `librarian-query-embed-${randomUUID()}.db`);
}

async function seedStorage(storage: LibrarianStorage): Promise<string> {
  const modulePath = path.join(process.cwd(), 'src', 'example.ts');
  await storage.upsertModule({
    id: 'module-1',
    path: modulePath,
    purpose: 'Example module',
    exports: [],
    dependencies: [],
    confidence: 0.6,
  });

  const version = getCurrentVersion();
  await storage.setVersion(version);
  await storage.upsertContextPack({
    packId: 'pack-1',
    packType: 'module_context',
    targetId: 'module-1',
    summary: 'Example summary',
    keyFacts: [],
    codeSnippets: [],
    relatedFiles: [modulePath],
    confidence: 0.8,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  });

  return modulePath;
}

describe('queryLibrarian embedding requirement', () => {
  let storage: LibrarianStorage | null = null;

  afterEach(async () => {
    await storage?.close?.();
    storage = null;
  });

  it('throws when embeddings are required but unavailable', async () => {
    const { queryLibrarian } = await import('../query.js');
    const { ProviderUnavailableError } = await import('../provider_check.js');
    storage = createSqliteStorage(getTempDbPath(), process.cwd());
    await storage.initialize();
    await seedStorage(storage);

    await expect(
      queryLibrarian(
        { intent: 'how does auth work', depth: 'L1', llmRequirement: 'disabled', embeddingRequirement: 'required' },
        storage
      )
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('auto-degrades when embeddings are unavailable and no requirement is specified', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), process.cwd());
    await storage.initialize();
    await seedStorage(storage);

    const response = await queryLibrarian(
      {
        intent: 'how does auth work',
        depth: 'L1',
        llmRequirement: 'disabled',
      },
      storage
    );

    expect(response.disclosures.join(' ')).toMatch(/embedding_unavailable/);
  });

  it('degrades gracefully when embeddings are optional and unavailable', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), process.cwd());
    await storage.initialize();
    await seedStorage(storage);

    const response = await queryLibrarian(
      {
        intent: 'how does auth work',
        depth: 'L1',
        llmRequirement: 'disabled',
        embeddingRequirement: 'optional',
      },
      storage
    );

    expect(response.disclosures.join(' ')).toMatch(/embedding_unavailable/);
  });

  it('bypasses query cache when disableCache is true', async () => {
    const { queryLibrarian } = await import('../query.js');
    storage = createSqliteStorage(getTempDbPath(), process.cwd());
    await storage.initialize();
    await seedStorage(storage);

    const query = {
      intent: 'cache bypass check',
      depth: 'L0' as const,
      llmRequirement: 'disabled' as const,
      embeddingRequirement: 'disabled' as const,
      disableCache: true,
    };

    const first = await queryLibrarian(query, storage);
    const second = await queryLibrarian(query, storage);

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(false);
  });
});
