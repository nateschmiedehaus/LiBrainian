import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('install-openclaw-skill help', () => {
  it('documents the OpenClaw installer command', () => {
    const help = getCommandHelp('install-openclaw-skill');
    expect(help).toContain('librarian install-openclaw-skill');
    expect(help).toContain('--openclaw-root');
    expect(help).toContain('~/.openclaw/skills/librainian/SKILL.md');
  });
});
