import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('memory-bridge help', () => {
  it('documents status action and memory-file override', () => {
    const help = getCommandHelp('memory-bridge');
    expect(help).toContain('librarian memory-bridge status');
    expect(help).toContain('librarian memory-bridge remember <key> <value>');
    expect(help).toContain('--memory-file');
    expect(help).toContain('active (non-defeated, non-expired) entries');
  });
});
