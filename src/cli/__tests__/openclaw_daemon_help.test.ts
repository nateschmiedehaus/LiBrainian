import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('openclaw-daemon help', () => {
  it('documents daemon lifecycle actions and options', () => {
    const help = getCommandHelp('openclaw-daemon');
    expect(help).toContain('librarian openclaw-daemon <start|status|stop>');
    expect(help).toContain('--state-root');
    expect(help).toContain('~/.openclaw/config.yaml');
  });
});
