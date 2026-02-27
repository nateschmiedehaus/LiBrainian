import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('context command alias', () => {
  it('is documented in main help output', () => {
    const help = getCommandHelp('main');
    expect(help).toContain('context');
  });

  it('has dedicated help text describing it as a query --depth L3 alias', () => {
    const help = getCommandHelp('context');
    expect(help).toContain('librarian context');
    expect(help).toContain('query');
    expect(help).toContain('L3');
  });

  it('help text includes usage examples', () => {
    const help = getCommandHelp('context');
    expect(help).toContain('librarian context "error handling"');
    expect(help).toContain('--json');
  });

  it('help text documents the --depth override', () => {
    const help = getCommandHelp('context');
    expect(help).toContain('--depth');
    expect(help).toContain('L3');
  });
});
