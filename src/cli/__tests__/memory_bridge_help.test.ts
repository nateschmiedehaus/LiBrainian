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

describe('memory-bridge help', () => {
  it('documents status action and memory-file override', () => {
    const help = getInternalCommandHelp('memory-bridge');
    expect(help).toContain('librainian memory-bridge status');
    expect(help).toContain('librainian memory-bridge remember <key> <value>');
    expect(help).toContain('--memory-file');
    expect(help).toContain('active (non-defeated, non-expired) entries');
  });
});
