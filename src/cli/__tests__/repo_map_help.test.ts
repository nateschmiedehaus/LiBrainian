import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('repo-map help', () => {
  it('documents repo-map in main help and command-specific help', () => {
    const mainHelp = getCommandHelp('main');
    expect(mainHelp).toContain('repo-map');

    const commandHelp = getCommandHelp('repo-map');
    expect(commandHelp).toContain('librarian repo-map');
    expect(commandHelp).toContain('--max-tokens');
    expect(commandHelp).toContain('--focus');
  });
});
