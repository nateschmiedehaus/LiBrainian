import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('uninstall help', () => {
  it('documents uninstall flags and manifest behavior', () => {
    const help = getCommandHelp('uninstall');
    expect(help).toContain('librarian uninstall - Remove LiBrainian bootstrap artifacts');
    expect(help).toContain('--dry-run');
    expect(help).toContain('--keep-index');
    expect(help).toContain('.librainian-manifest.json');
  });
});
