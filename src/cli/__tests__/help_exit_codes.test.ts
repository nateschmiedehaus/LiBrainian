import { describe, expect, it } from 'vitest';
import { getCommandHelp } from '../help.js';

describe('help exit code documentation', () => {
  it('documents status-specific and default exit codes', () => {
    const help = getCommandHelp('status');
    expect(help).toContain('STATUS EXIT CODES:');
    expect(help).toContain('EXIT CODES (DEFAULT):');
    expect(help).toContain('10-13  Storage/index failures');
  });

  it('documents default exit codes for regular commands', () => {
    const help = getCommandHelp('query');
    expect(help).toContain('EXIT CODES (DEFAULT):');
  });

  it('does not duplicate command-defined exit code sections', () => {
    const help = getCommandHelp('doctor');
    const matches = help.match(/exit codes:/gi) ?? [];
    expect(matches.length).toBe(1);
  });
});
