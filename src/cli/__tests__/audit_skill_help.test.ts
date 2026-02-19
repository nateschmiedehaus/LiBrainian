import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('audit-skill help', () => {
  it('documents audit-skill usage and JSON output', () => {
    const help = getCommandHelp('audit-skill');
    expect(help).toContain('librarian audit-skill');
    expect(help).toContain('<path-to-SKILL.md>');
    expect(help).toContain('--json');
  });
});
