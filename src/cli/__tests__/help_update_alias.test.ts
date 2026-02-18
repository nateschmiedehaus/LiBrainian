import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('help update alias', () => {
  it('documents the update alias for staged and changed-file indexing', () => {
    const help = getCommandHelp('update');
    expect(help).toContain('librarian update - Hook-friendly alias for incremental indexing');
    expect(help).toContain('librarian update --staged');
    expect(help).toContain('librarian update --since <ref>');
  });
});
