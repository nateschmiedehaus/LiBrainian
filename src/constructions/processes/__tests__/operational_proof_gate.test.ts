import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperationalProofGateConstruction } from '../operational_proof_gate.js';
import { DEFAULT_WET_TESTING_POLICY_CONFIG } from '../wet_testing_policy.js';

describe('operational proof gate', () => {
  it('passes when command outputs and required artifacts satisfy proof contract', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'librainian-operational-proof-'));
    try {
      const artifactPath = join(tmp, 'proof-artifact.json');
      const script = [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(artifactPath)}, JSON.stringify({ ok: true }), "utf8");`,
        'console.log("PROOF_OK operational evidence captured");',
      ].join(' ');

      const gate = createOperationalProofGateConstruction();
      const result = await gate.execute({
        checks: [
          {
            id: 'proof-check',
            description: 'writes artifact and emits proof marker',
            command: process.execPath,
            args: ['-e', script],
            requiredOutputSubstrings: ['PROOF_OK'],
            requiredFilePaths: [artifactPath],
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.kind).toBe('OperationalProofGateResult.v1');
      expect(result.value.passed).toBe(true);
      expect(result.value.failureCount).toBe(0);
      expect(result.value.checkResults[0]?.passed).toBe(true);

      const artifact = await readFile(artifactPath, 'utf8');
      expect(artifact).toContain('"ok":true');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('fails closed when proof contract requirements are not met', async () => {
    const gate = createOperationalProofGateConstruction();
    const result = await gate.execute({
      checks: [
        {
          id: 'proof-fail',
          command: process.execPath,
          args: ['-e', 'console.log("different output")'],
          requiredOutputSubstrings: ['REQUIRED_MARKER'],
          requiredFilePaths: ['/tmp/does-not-exist-proof-artifact.txt'],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.failureCount).toBe(1);
    expect(result.value.checkResults[0]?.passed).toBe(false);
    expect(result.value.checkResults[0]?.missingOutputSubstrings).toContain('REQUIRED_MARKER');
    expect(result.value.checkResults[0]?.missingFilePaths).toContain('/tmp/does-not-exist-proof-artifact.txt');
  });

  it('fails closed when wet-testing policy requires artifact contracts but checks do not require files', async () => {
    const gate = createOperationalProofGateConstruction();
    const result = await gate.execute({
      checks: [
        {
          id: 'policy-check',
          command: process.execPath,
          args: ['-e', 'console.log("policy check output")'],
          requiredOutputSubstrings: ['policy check output'],
        },
      ],
      policyConfig: DEFAULT_WET_TESTING_POLICY_CONFIG,
      policyContext: {
        riskLevel: 'critical',
        blastRadius: 'repo',
        novelty: 'novel',
        providerDependence: 'mixed',
        trigger: 'release',
        executionSurface: 'publish',
        userImpact: 'blocker',
        releaseCritical: true,
        requiresExternalRepo: true,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.passed).toBe(false);
    expect(result.value.failureCount).toBe(1);
    expect(result.value.checkResults[0]?.id).toBe('policy.fail_closed');
    expect(result.value.policyDecisionArtifact?.decision.requiredEvidenceMode).toBe('wet');
    expect(result.value.policyDecisionArtifact?.decision.failClosed).toBe(true);
  });

  it('writes machine-readable policy decision artifact when output path is provided', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'librainian-operational-proof-policy-'));
    try {
      const artifactPath = join(tmp, 'proof-artifact.json');
      const policyPath = join(tmp, 'policy-decision.json');
      const script = [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(artifactPath)}, JSON.stringify({ ok: true }), "utf8");`,
        'console.log("PROOF_OK policy artifact path");',
      ].join(' ');
      const gate = createOperationalProofGateConstruction();
      const result = await gate.execute({
        checks: [
          {
            id: 'proof-check',
            command: process.execPath,
            args: ['-e', script],
            requiredOutputSubstrings: ['PROOF_OK'],
            requiredFilePaths: [artifactPath],
          },
        ],
        policyConfig: DEFAULT_WET_TESTING_POLICY_CONFIG,
        policyContext: {
          riskLevel: 'critical',
          blastRadius: 'repo',
          novelty: 'novel',
          providerDependence: 'mixed',
          trigger: 'release',
          executionSurface: 'publish',
          userImpact: 'blocker',
          releaseCritical: true,
          requiresExternalRepo: true,
        },
        policyDecisionOutputPath: policyPath,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.passed).toBe(true);
      expect(result.value.policyDecisionArtifact?.kind).toBe('WetTestingPolicyDecisionArtifact.v1');
      const raw = await readFile(policyPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        kind?: string;
        decision?: { requiredEvidenceMode?: string; matchedRuleId?: string | null };
      };
      expect(parsed.kind).toBe('WetTestingPolicyDecisionArtifact.v1');
      expect(parsed.decision?.requiredEvidenceMode).toBe('wet');
      expect(parsed.decision?.matchedRuleId).toBe('critical-release-wet');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
