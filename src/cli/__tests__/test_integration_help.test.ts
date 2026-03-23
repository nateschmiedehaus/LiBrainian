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

describe('test-integration help', () => {
  it('documents suite runner options', () => {
    const help = getInternalCommandHelp('test-integration');
    expect(help).toContain('librainian test-integration --suite openclaw');
    expect(help).toContain('--scenario');
    expect(help).toContain('--fixtures-root');
  });
});
