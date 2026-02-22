import { describe, expect, it } from 'vitest';
import { evaluatePatrolPolicy } from '../patrol_policy.js';

describe('patrol policy enforcement', () => {
  it('allows quick dry-run mode with dry evidence requirement', () => {
    const result = evaluatePatrolPolicy({
      mode: 'quick',
      trigger: 'manual',
      dryRun: true,
      hasCommand: false,
      observationExtracted: true,
      timedOut: false,
    });

    expect(result.requiredEvidenceMode).toBe('dry');
    expect(result.observedEvidenceMode).toBe('dry');
    expect(result.enforcement).toBe('allowed');
  });

  it('blocks release dry-run bypass attempts when wet evidence is required', () => {
    const result = evaluatePatrolPolicy({
      mode: 'release',
      trigger: 'release',
      dryRun: true,
      hasCommand: false,
      observationExtracted: false,
      timedOut: false,
    });

    expect(result.requiredEvidenceMode).toBe('wet');
    expect(result.observedEvidenceMode).toBe('dry');
    expect(result.enforcement).toBe('blocked');
    expect(result.reason).toContain('fail-closed');
  });

  it('requires at least mixed evidence for full patrol mode', () => {
    const blocked = evaluatePatrolPolicy({
      mode: 'full',
      trigger: 'schedule',
      dryRun: false,
      hasCommand: true,
      observationExtracted: false,
      timedOut: true,
    });
    expect(blocked.requiredEvidenceMode).toBe('mixed');
    expect(blocked.enforcement).toBe('blocked');

    const allowed = evaluatePatrolPolicy({
      mode: 'full',
      trigger: 'schedule',
      dryRun: false,
      hasCommand: true,
      observationExtracted: true,
      timedOut: false,
    });
    expect(allowed.requiredEvidenceMode).toBe('mixed');
    expect(allowed.observedEvidenceMode).toBe('wet');
    expect(allowed.enforcement).toBe('allowed');
  });
});
