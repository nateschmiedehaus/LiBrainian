import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluatePatrolPolicyGate } from '../../scripts/agent-patrol.mjs';

describe('agent patrol policy gate', () => {
  it('blocks release mode when no wet evidence is present', () => {
    const gate = evaluatePatrolPolicyGate('release', [
      {
        agentExitCode: 0,
        timedOut: true,
        observations: null,
      },
    ]);

    expect(gate.kind).toBe('PatrolPolicyEnforcementArtifact.v1');
    expect(gate.requiredEvidenceMode).toBe('wet');
    expect(gate.observedEvidenceMode).toBe('none');
    expect(gate.enforcement).toBe('blocked');
  });

  it('allows full mode when mixed-or-better evidence is present', () => {
    const gate = evaluatePatrolPolicyGate('full', [
      {
        agentExitCode: 0,
        timedOut: false,
        observations: { overallVerdict: { npsScore: 7 } },
      },
    ]);

    expect(gate.requiredEvidenceMode).toBe('mixed');
    expect(gate.observedEvidenceMode).toBe('wet');
    expect(gate.enforcement).toBe('allowed');
  });

  it('wires policy gate enforcement step into the patrol workflow', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'agent-patrol.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('name: Enforce patrol policy gate');
    expect(workflow).toContain('node scripts/patrol-policy-ci-gate.mjs');
    expect(workflow).toContain('state/patrol/patrol-policy-gate.json');
  });
});
