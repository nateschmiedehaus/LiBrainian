import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

function getInternalCommandHelp(command: string): string {
  const previous = process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;
  process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = '1';
  try {
    return getCommandHelp(command);
  } finally {
    if (previous === undefined) delete process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS;
    else process.env.LIBRAINIAN_ENABLE_INTERNAL_COMMANDS = previous;
  }
}

describe('audit-skill help', () => {
  it('documents audit-skill usage and JSON output', () => {
    const help = getInternalCommandHelp('audit-skill');
    expect(help).toContain('librainian audit-skill');
    expect(help).toContain('<path-to-SKILL.md>');
    expect(help).toContain('--json');
  });
});
