import { describe, expect, it } from 'vitest';

describe('mcp server compatibility exports', () => {
  it('keeps Librarian aliases wired to LiBrainian server exports', async () => {
    const mod = await import('../server.js') as Record<string, unknown>;

    expect(mod.LibrarianMCPServer).toBe(mod.LiBrainianMCPServer);
    expect(mod.createLibrarianMCPServer).toBe(mod.createLiBrainianMCPServer);
  });
});
