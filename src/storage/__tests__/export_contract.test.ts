import { describe, expect, it } from 'vitest';

describe('storage export contract', () => {
  it('sqlite_storage exports SqliteLibrarianStorage alias', async () => {
    const storageModule = await import('../sqlite_storage.js');
    expect(typeof storageModule.SqliteLiBrainianStorage).toBe('function');
    expect(typeof storageModule.SqliteLibrarianStorage).toBe('function');
    expect(storageModule.SqliteLibrarianStorage).toBe(storageModule.SqliteLiBrainianStorage);
  });

  it('storage index re-exports SqliteLibrarianStorage', async () => {
    const indexModule = await import('../index.js');
    expect(typeof indexModule.SqliteLibrarianStorage).toBe('function');
    expect(indexModule.SqliteLibrarianStorage).toBe(indexModule.SqliteLiBrainianStorage);
  });
});
