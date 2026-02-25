import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { LibrarianStorage, StrategicContractRecord } from '../types.js';

describe('strategic contract storage', () => {
  let tempDir = '';
  let dbPath = '';
  let storage: LibrarianStorage | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-strategic-contracts-'));
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

  it('persists strategic contracts and preserves consumers across restart', async () => {
    const record: StrategicContractRecord = {
      id: 'strategic-contract:mod-provider:public-api',
      contractType: 'api',
      name: 'provider public API',
      version: '1.0.0',
      location: '/workspace/src/provider.ts',
      breaking: false,
      consumers: ['mod-consumer-a', 'mod-consumer-b'],
      producers: ['mod-provider'],
      evidence: ['module:/workspace/src/provider.ts', 'exports:1', 'dependencies:0'],
      updatedAt: '2026-02-25T00:00:00.000Z',
    };

    await storage!.upsertStrategicContracts([record]);
    const created = await storage!.getStrategicContract(record.id);
    expect(created).toBeTruthy();
    expect(created?.consumers).toEqual(['mod-consumer-a', 'mod-consumer-b']);

    await storage!.updateStrategicContractConsumers(record.id, ['mod-consumer-c']);
    const updated = await storage!.getStrategicContract(record.id);
    expect(updated?.consumers).toEqual(['mod-consumer-c']);

    await storage!.close();
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();

    const reloaded = await storage.getStrategicContracts();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.id).toBe(record.id);
    expect(reloaded[0]?.consumers).toEqual(['mod-consumer-c']);
  });
});

