import { describe, it, expect } from 'vitest';
import type { LiBrainianStorage, TransactionContext } from '../../storage/types.js';
import type { IngestionItem } from '../../ingest/types.js';
import { __testing } from '../bootstrap.js';

const { applyIngestionResults, validateIngestionItem, MAX_INGESTION_JSON_CHARS } = __testing;

type StorageState = {
  ingestions: IngestionItem[];
  mappings: Array<{ testPath: string; sourcePath: string }>;
  commits: Array<{ sha: string }>;
  ownerships: Array<{ filePath: string; author: string }>;
};

class FakeStorage {
  state: StorageState = {
    ingestions: [],
    mappings: [],
    commits: [],
    ownerships: [],
  };
  rollbacks = 0;
  failIngestionIds = new Set<string>();
  failTestPaths = new Set<string>();
  failTransaction: Error | null = null;

  async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    if (this.failTransaction) {
      throw this.failTransaction;
    }
    const original = cloneState(this.state);
    const snapshot = cloneState(this.state);
    const txContext = createTxContext(snapshot, this);
    try {
      const result = await fn(txContext as TransactionContext);
      this.state = snapshot;
      return result;
    } catch (error) {
      this.state = original;
      this.rollbacks += 1;
      throw error;
    }
  }
}

function cloneState(state: StorageState): StorageState {
  return {
    ingestions: [...state.ingestions],
    mappings: [...state.mappings],
    commits: [...state.commits],
    ownerships: [...state.ownerships],
  };
}

function createTxContext(snapshot: StorageState, storage: FakeStorage) {
  return {
    async upsertIngestionItem(item: IngestionItem): Promise<void> {
      if (storage.failIngestionIds.has(item.id)) {
        throw new Error(`ingestion failed: ${item.id}`);
      }
      snapshot.ingestions.push(item);
    },
    async upsertTestMapping(mapping: {
      testPath: string;
      sourcePath: string;
      confidence: number;
    }): Promise<{
      id: string;
      testPath: string;
      sourcePath: string;
      confidence: number;
      createdAt: Date;
      updatedAt: Date;
    }> {
      if (storage.failTestPaths.has(mapping.testPath)) {
        throw new Error(`mapping failed: ${mapping.testPath}`);
      }
      const record = {
        id: `mapping_${snapshot.mappings.length + 1}`,
        testPath: mapping.testPath,
        sourcePath: mapping.sourcePath,
        confidence: mapping.confidence,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      snapshot.mappings.push({ testPath: record.testPath, sourcePath: record.sourcePath });
      return record;
    },
    async upsertCommit(commit: {
      sha: string;
      message: string;
      author: string;
      category: string;
      filesChanged: string[];
    }): Promise<{
      id: string;
      sha: string;
      message: string;
      author: string;
      category: string;
      filesChanged: string[];
      createdAt: Date;
    }> {
      const record = {
        id: `commit_${snapshot.commits.length + 1}`,
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        category: commit.category,
        filesChanged: commit.filesChanged,
        createdAt: new Date(),
      };
      snapshot.commits.push({ sha: record.sha });
      return record;
    },
    async upsertOwnership(ownership: {
      filePath: string;
      author: string;
      score: number;
      lastModified: Date;
    }): Promise<{
      id: string;
      filePath: string;
      author: string;
      score: number;
      lastModified: Date;
      createdAt: Date;
    }> {
      const record = {
        id: `ownership_${snapshot.ownerships.length + 1}`,
        filePath: ownership.filePath,
        author: ownership.author,
        score: ownership.score,
        lastModified: ownership.lastModified,
        createdAt: new Date(),
      };
      snapshot.ownerships.push({ filePath: record.filePath, author: record.author });
      return record;
    },
  };
}

function createItem(id: string, overrides: Partial<IngestionItem> = {}): IngestionItem {
  return {
    id,
    sourceType: 'config',
    sourceVersion: 'v1',
    ingestedAt: new Date().toISOString(),
    payload: {},
    metadata: {},
    ...overrides,
  };
}

describe('validateIngestionItem', () => {
  it('flags missing required fields', () => {
    const result = validateIngestionItem({
      id: '  ',
      sourceType: ' ',
      sourceVersion: '',
      ingestedAt: 'not-a-date',
      payload: null,
      metadata: {},
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'id_invalid',
        'source_type_invalid',
        'source_version_invalid',
        'ingested_at_invalid',
      ])
    );
  });

  it('rejects circular payloads', () => {
    const payload: { self?: unknown } = {};
    payload.self = payload;

    const result = validateIngestionItem({
      id: 'item-1',
      sourceType: 'config',
      sourceVersion: 'v1',
      ingestedAt: new Date().toISOString(),
      payload,
      metadata: {},
    });

    expect(result.errors).toEqual(expect.arrayContaining(['payload_circular']));
  });

  it('rejects forbidden keys in payload and metadata', () => {
    const payload = Object.create(null) as Record<string, unknown>;
    payload['__proto__'] = { compromised: true };
    const metadata = Object.create(null) as Record<string, unknown>;
    metadata['constructor'] = { unsafe: true };

    const result = validateIngestionItem({
      id: 'item-1',
      sourceType: 'config',
      sourceVersion: 'v1',
      ingestedAt: new Date().toISOString(),
      payload,
      metadata,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'payload_forbidden_key:__proto__',
        'metadata_forbidden_key:constructor',
      ])
    );
  });

  it('rejects non-plain objects', () => {
    const result = validateIngestionItem({
      id: 'item-1',
      sourceType: 'config',
      sourceVersion: 'v1',
      ingestedAt: new Date().toISOString(),
      payload: new Date(),
      metadata: new Map([['key', 'value']]) as unknown as Record<string, unknown>,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining(['payload_non_plain_object', 'metadata_non_plain_object'])
    );
  });

  it('rejects oversized payloads', () => {
    const payload = 'a'.repeat(MAX_INGESTION_JSON_CHARS + 10);

    const result = validateIngestionItem({
      id: 'item-1',
      sourceType: 'config',
      sourceVersion: 'v1',
      ingestedAt: new Date().toISOString(),
      payload,
      metadata: {},
    });

    expect(result.errors).toEqual(expect.arrayContaining(['payload_too_large']));
  });
});

describe('bootstrap ingestion transactions', () => {
  it('rolls back and aggregates errors when persist fails', async () => {
    const storage = new FakeStorage();
    storage.failIngestionIds.add('item-2');
    storage.failIngestionIds.add('item-3');

    const items = [
      createItem('item-1'),
      createItem('item-2'),
      createItem('item-3'),
    ];

    const result = await applyIngestionResults(
      storage as unknown as LiBrainianStorage,
      items,
      '/workspace'
    );

    expect(result.success).toBe(false);
    expect(result.stored).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/ingestion_item:item-2/);
    expect(result.errors[1]).toMatch(/ingestion_item:item-3/);
    expect(storage.state.ingestions).toHaveLength(0);
    expect(storage.rollbacks).toBe(1);
  });

  it('rolls back when materialization fails', async () => {
    const storage = new FakeStorage();
    storage.failTestPaths.add('tests/alpha.test.ts');

    const items = [
      createItem('item-1'),
      createItem('item-2', {
        sourceType: 'test',
        payload: {
          mappings: [{
            testFile: 'tests/alpha.test.ts',
            sourceFiles: ['src/alpha.ts'],
          }],
        },
      }),
    ];

    const result = await applyIngestionResults(
      storage as unknown as LiBrainianStorage,
      items,
      '/workspace'
    );

    expect(result.success).toBe(false);
    expect(result.stored).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/test_mapping:tests\/alpha\.test\.ts/);
    expect(storage.state.ingestions).toHaveLength(0);
    expect(storage.rollbacks).toBe(1);
  });

  it('rolls back when validation fails', async () => {
    const storage = new FakeStorage();
    const invalidItem = createItem('', {
      sourceType: '',
      sourceVersion: '',
      ingestedAt: 'not-a-date',
    });

    const result = await applyIngestionResults(
      storage as unknown as LiBrainianStorage,
      [createItem('item-1'), invalidItem],
      '/workspace'
    );

    expect(result.success).toBe(false);
    expect(result.stored).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/id_invalid/);
    expect(storage.state.ingestions).toHaveLength(0);
    expect(storage.rollbacks).toBe(1);
  });

  it('commits successfully when all ingestion steps succeed', async () => {
    const storage = new FakeStorage();

    const items = [
      createItem('item-1'),
      createItem('item-2', {
        sourceType: 'test',
        payload: {
          mappings: [{
            testFile: 'tests/beta.test.ts',
            sourceFiles: ['src/beta.ts'],
          }],
        },
      }),
    ];

    const result = await applyIngestionResults(
      storage as unknown as LiBrainianStorage,
      items,
      '/workspace'
    );

    expect(result.success).toBe(true);
    expect(result.stored).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(storage.state.ingestions).toHaveLength(2);
    expect(storage.state.mappings).toHaveLength(1);
    expect(storage.rollbacks).toBe(0);
  });

  it('rethrows unexpected transaction errors', async () => {
    const storage = new FakeStorage();
    storage.failTransaction = new Error('storage unavailable');

    await expect(
      applyIngestionResults(
        storage as unknown as LiBrainianStorage,
        [createItem('item-1')],
        '/workspace'
      )
    ).rejects.toThrow('storage unavailable');
  });
});
