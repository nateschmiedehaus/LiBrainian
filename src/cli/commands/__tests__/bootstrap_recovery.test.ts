import { describe, it, expect } from 'vitest';
import { planBootstrapRecovery } from '../bootstrap_recovery.js';
import { INCLUDE_PATTERNS, EXCLUDE_PATTERNS } from '../../../universal_patterns.js';

describe('planBootstrapRecovery', () => {
  it('suggests workspace root retry when error includes detected root', () => {
    const plan = planBootstrapRecovery({
      workspaceRoot: '/tmp/subdir',
      scope: 'full',
      errorMessage: 'Structural scan found no files. Detected possible project root at /tmp/project.',
    });

    expect(plan?.workspaceRoot).toBe('/tmp/project');
    expect(plan?.reason).toMatch(/workspace root/i);
  });

  it('upgrades scope when librarian scope finds no files', () => {
    const plan = planBootstrapRecovery({
      workspaceRoot: '/tmp/project',
      scope: 'librarian',
      errorMessage: 'Include patterns matched no files in workspace.',
    });

    expect(plan?.scopeOverride).toBe('full');
  });

  it('resets patterns when include patterns match no files outside librarian scope', () => {
    const plan = planBootstrapRecovery({
      workspaceRoot: '/tmp/project',
      scope: 'full',
      errorMessage: 'Include patterns matched no files in workspace.',
    });

    expect(plan?.include).toEqual([...INCLUDE_PATTERNS]);
    expect(plan?.exclude).toEqual([...EXCLUDE_PATTERNS]);
  });

  it('relaxes exclude patterns when everything is excluded', () => {
    const plan = planBootstrapRecovery({
      workspaceRoot: '/tmp/project',
      scope: 'full',
      errorMessage: 'Structural scan found no files because include patterns matched 5 files that were excluded by exclude patterns.',
    });

    expect(plan?.include).toEqual([...INCLUDE_PATTERNS]);
    expect(plan?.exclude).toEqual([...EXCLUDE_PATTERNS]);
  });

  it('returns null when no recovery action applies', () => {
    const plan = planBootstrapRecovery({
      workspaceRoot: '/tmp/project',
      scope: 'full',
      errorMessage: 'unverified_by_trace(phase_fatal_failure): Bootstrap phase failed.',
    });

    expect(plan).toBeNull();
  });
});
