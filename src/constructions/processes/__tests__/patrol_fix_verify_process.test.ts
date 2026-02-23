import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFixGeneratorConstruction,
  createFixVerifierConstruction,
  createIssueFilerConstruction,
  createPatrolFixVerifyProcessConstruction,
  createPatrolScanConstruction,
  createRegressionTestConstruction,
  type PatrolFixVerifyInput,
} from '../patrol_fix_verify_process.js';
import { createOperationalProofGateConstruction } from '../operational_proof_gate.js';

function makeState(input: PatrolFixVerifyInput = {}) {
  return {
    input,
    trigger: input.trigger ?? 'manual',
    startedAtMs: Date.now(),
  };
}

describe('patrol fix verify pipeline', () => {
  it('patrol scan step produces at least one finding in dry-run mode', async () => {
    const step = createPatrolScanConstruction();
    const result = await step.execute(makeState({ knownBugHint: 'axios.stream does not exist' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patrol?.findings.length).toBeGreaterThan(0);
    expect(result.value.patrol?.findings[0]?.title).toContain('Known bug');
  });

  it('issue filer step emits issue URL in dry-run mode', async () => {
    const step = createIssueFilerConstruction();
    const result = await step.execute({
      ...makeState(),
      patrol: {
        commandLine: 'synthetic:patrol-scan',
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
        stdout: '',
        stderr: '',
        findings: [
          {
            category: 'api',
            severity: 'high',
            title: 'Known bug: axios.stream',
            detail: 'axios.stream does not exist',
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issue?.issueUrl).toContain('/issues/');
  });

  it('fix generator step emits pull request URL in dry-run mode', async () => {
    const step = createFixGeneratorConstruction();
    const result = await step.execute({
      ...makeState(),
      issue: {
        issueUrl: 'https://github.com/example/LiBrainian/issues/42',
        commandLine: 'synthetic:issue-filer',
        exitCode: 0,
        durationMs: 0,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fix?.prUrl).toContain('/pull/');
  });

  it('regression test step returns deterministic generated tests in dry-run mode', async () => {
    const step = createRegressionTestConstruction();
    const result = await step.execute(makeState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.regression?.passed).toBe(true);
    expect(result.value.regression?.generatedTests.length).toBeGreaterThan(0);
  });

  it('fix verifier step marks failure when regression step failed', async () => {
    const step = createFixVerifierConstruction();
    const result = await step.execute({
      ...makeState(),
      regression: {
        passed: false,
        generatedTests: [],
        commandLine: 'synthetic:regression-test',
        exitCode: 1,
        durationMs: 0,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verifier?.passed).toBe(false);
  });

  it('runs end-to-end and outputs issue URL, PR URL, and test results', async () => {
    const pipeline = createPatrolFixVerifyProcessConstruction();
    const result = await pipeline.execute({
      trigger: 'manual',
      knownBugHint: 'fs.readFileAsync hallucination',
      patrolScan: { dryRun: true },
      issueFiler: { dryRun: true },
      fixGenerator: { dryRun: true },
      regressionTest: { dryRun: true },
      fixVerifier: { dryRun: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('PatrolFixVerifyResult.v1');
    expect(result.value.trigger).toBe('manual');
    expect(result.value.issueUrl).toContain('/issues/');
    expect(result.value.fixPrUrl).toContain('/pull/');
    expect(result.value.regressionTest.passed).toBe(true);
    expect(result.value.verification.passed).toBe(true);
    expect(result.value.exitReason).toBe('completed');
  });

  it('accepts scheduled trigger mode', async () => {
    const pipeline = createPatrolFixVerifyProcessConstruction();
    const result = await pipeline.execute({
      trigger: 'schedule',
      patrolScan: { dryRun: true },
      issueFiler: { dryRun: true },
      fixGenerator: { dryRun: true },
      regressionTest: { dryRun: true },
      fixVerifier: { dryRun: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trigger).toBe('schedule');
  });

  it('produces machine-verifiable operational proof for a non-dry-run patrol loop', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'librainian-patrol-proof-loop-'));
    try {
      const patrolScript = [
        'console.log("PATROL_OBSERVATION_JSON_START");',
        'console.log(JSON.stringify({',
        '  overallVerdict: { npsScore: 3, wouldRecommend: false },',
        '  negativeFindingsMandatory: [',
        '    { category: "api", severity: "high", title: "Known bug reproduced", detail: "non-dry-run loop finding" }',
        '  ]',
        '}));',
        'console.log("PATROL_OBSERVATION_JSON_END");',
      ].join(' ');

      const pipeline = createPatrolFixVerifyProcessConstruction();
      const result = await pipeline.execute({
        trigger: 'manual',
        knownBugHint: 'non-dry-run proof loop',
        patrolScan: { dryRun: false, command: process.execPath, args: ['-e', patrolScript] },
        issueFiler: {
          dryRun: false,
          command: process.execPath,
          args: ['-e', 'console.log("https://github.com/example/LiBrainian/issues/4242")'],
        },
        fixGenerator: {
          dryRun: false,
          command: process.execPath,
          args: ['-e', 'console.log("https://github.com/example/LiBrainian/pull/9898")'],
        },
        regressionTest: {
          dryRun: false,
          command: process.execPath,
          args: ['-e', 'console.log("GENERATED_TEST: src/__tests__/regressions/non_dry_run_proof.test.ts")'],
        },
        fixVerifier: {
          dryRun: false,
          command: process.execPath,
          args: ['-e', 'console.log("VERIFY_OK")'],
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.exitReason).toBe('completed');
      expect(result.value.issueUrl).toContain('/issues/');
      expect(result.value.fixPrUrl).toContain('/pull/');

      const loopArtifactPath = join(tmp, 'non-dry-run-loop.json');
      await writeFile(loopArtifactPath, JSON.stringify(result.value, null, 2), 'utf8');

      const proofReaderScript = [
        'const fs = require("node:fs");',
        `process.stdout.write(fs.readFileSync(${JSON.stringify(loopArtifactPath)}, "utf8"));`,
      ].join(' ');
      const gate = createOperationalProofGateConstruction();
      const proofResult = await gate.execute({
        checks: [
          {
            id: 'patrol-loop-proof',
            description: 'non-dry-run patrol loop emits issue/pr evidence and artifact',
            command: process.execPath,
            args: ['-e', proofReaderScript],
            requiredOutputSubstrings: ['PatrolFixVerifyResult.v1', result.value.issueUrl, result.value.fixPrUrl],
            requiredFilePaths: [loopArtifactPath],
          },
        ],
      });

      expect(proofResult.ok).toBe(true);
      if (!proofResult.ok) return;
      expect(proofResult.value.passed).toBe(true);
      expect(proofResult.value.failureCount).toBe(0);
      expect(proofResult.value.checkResults[0]?.passed).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
