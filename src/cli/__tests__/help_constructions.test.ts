import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('constructions help', () => {
  it('documents constructions in main help', () => {
    const help = getCommandHelp('main');
    expect(help).toContain('constructions');
  });

  it('documents constructions subcommands', () => {
    const help = getCommandHelp('constructions');
    expect(help).toContain('librarian constructions');
    expect(help).toContain('list');
    expect(help).toContain('search');
    expect(help).toContain('describe');
    expect(help).toContain('install');
    expect(help).toContain('validate');
  });
});
