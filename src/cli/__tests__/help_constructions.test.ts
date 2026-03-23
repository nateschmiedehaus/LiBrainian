import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('constructions help', () => {
  it('hides constructions from the public help surface', () => {
    const help = getCommandHelp('main');
    expect(help).not.toContain('constructions');
  });

  it('gates constructions command help behind maintainer mode', () => {
    const help = getCommandHelp('constructions');
    expect(help).toContain('Command unavailable in the public release surface: constructions');
  });
});
