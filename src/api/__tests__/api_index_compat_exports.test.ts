import { describe, expect, it } from 'vitest';

describe('api index compatibility exports', () => {
  it('keeps LiBrainian aliases wired to Librarian exports', async () => {
    const api = await import('../index.js') as Record<string, unknown>;

    expect(api.LiBrainian).toBe(api.Librarian);
    expect(api.createLiBrainian).toBe(api.createLibrarian);
    expect(api.createLiBrainianSync).toBe(api.createLibrarianSync);
    expect(api.queryLiBrainian).toBe(api.queryLibrarian);
    expect(api.queryLiBrainianWithObserver).toBe(api.queryLibrarianWithObserver);
  });
});
