import { describe, expect, it } from 'vitest';
import {
  SqliteLiBrainianStorage,
  SqliteLibrarianStorage,
  SqliteStorage,
} from '../sqlite_storage.js';

describe('sqlite storage compatibility exports', () => {
  it('keeps legacy class aliases for clean-clone runtime compatibility', () => {
    expect(SqliteLibrarianStorage).toBe(SqliteLiBrainianStorage);
    expect(SqliteStorage).toBe(SqliteLiBrainianStorage);
  });
});
