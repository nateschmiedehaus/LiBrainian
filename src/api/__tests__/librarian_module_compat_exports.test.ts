import { describe, expect, it } from 'vitest';

describe('librarian module compatibility exports', () => {
  it('keeps LiBrainian aliases wired to Librarian module exports', async () => {
    const mod = await import('../librarian.js') as Record<string, unknown>;

    expect(mod.LiBrainian).toBe(mod.Librarian);
    expect(mod.createLiBrainian).toBe(mod.createLibrarian);
    expect(mod.createLiBrainianSync).toBe(mod.createLibrarianSync);
  });
});
