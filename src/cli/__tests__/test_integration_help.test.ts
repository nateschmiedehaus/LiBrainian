import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('test-integration help', () => {
  it('documents suite runner options', () => {
    const help = getCommandHelp('test-integration');
    expect(help).toContain('librarian test-integration --suite openclaw');
    expect(help).toContain('--scenario');
    expect(help).toContain('--fixtures-root');
  });
});
