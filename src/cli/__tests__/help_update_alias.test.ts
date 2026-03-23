import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('help update alias', () => {
  it.each(['update', 'watch', 'stats'])('hides %s from the public help surface', (command) => {
    const help = getCommandHelp(command);
    expect(help).toContain(`Command unavailable in the public release surface: ${command}`);
  });
});
