import { describe, expect, it } from 'vitest';
import { shouldForceCliExit } from '../cli/exit_policy.js';

describe('shouldForceCliExit', () => {
  it('does not force exit by default for one-shot commands', () => {
    expect(shouldForceCliExit('status', {})).toBe(false);
    expect(shouldForceCliExit('check-providers', {})).toBe(false);
  });

  it('never forces exit for long-running commands', () => {
    expect(shouldForceCliExit('watch', { LIBRARIAN_FORCE_PROCESS_EXIT: '1' })).toBe(false);
    expect(shouldForceCliExit('mcp', { LIBRARIAN_FORCE_PROCESS_EXIT: 'true' })).toBe(false);
  });

  it('allows opt-in force exit via environment flags', () => {
    expect(shouldForceCliExit('status', { LIBRARIAN_FORCE_PROCESS_EXIT: '1' })).toBe(true);
    expect(shouldForceCliExit('status', { LIBRARIAN_FORCE_EXIT: 'true' })).toBe(true);
    expect(shouldForceCliExit('status', { LIBRARIAN_FORCE_PROCESS_EXIT: 'off' })).toBe(false);
  });
});

