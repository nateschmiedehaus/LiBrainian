import { describe, expect, it } from 'vitest';
import { findGateIntegrityFailures } from '../evidence/gate_integrity.js';

describe('gate integrity', () => {
  it('flags unverified statuses and evidence-manifest-missing notes', () => {
    const failures = findGateIntegrityFailures({
      tasks: {
        'layer0.typecheck': {
          status: 'unverified',
          note: 'unverified (evidence_manifest_missing): Status not backed by evidence manifest.',
          verified: false,
        },
      },
    });

    expect(failures).toEqual([
      expect.objectContaining({
        taskId: 'layer0.typecheck',
        code: 'status_unverified',
      }),
      expect.objectContaining({
        taskId: 'layer0.typecheck',
        code: 'evidence_manifest_missing',
      }),
      expect.objectContaining({
        taskId: 'layer0.typecheck',
        code: 'verified_false',
      }),
    ]);
  });

  it('flags verified false when task claims execution status', () => {
    const failures = findGateIntegrityFailures({
      tasks: {
        'layer7.metricsRAGAS': {
          status: 'pass',
          verified: false,
        },
      },
    });

    expect(failures).toEqual([
      expect.objectContaining({
        taskId: 'layer7.metricsRAGAS',
        code: 'verified_false',
      }),
    ]);
  });

  it('allows explicit not_started and not_implemented statuses', () => {
    const failures = findGateIntegrityFailures({
      tasks: {
        'layer3.Q4': {
          status: 'not_implemented',
        },
        'layer3.P9': {
          status: 'not_started',
          verified: false,
        },
      },
    });

    expect(failures).toEqual([]);
  });
});
