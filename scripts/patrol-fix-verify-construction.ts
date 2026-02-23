#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPatrolFixVerifyProcessConstruction, type PatrolFixVerifyInput } from '../src/constructions/processes/patrol_fix_verify_process.js';
import { createOperationalProofGateConstruction } from '../src/constructions/processes/operational_proof_gate.js';

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      trigger: { type: 'string', default: 'manual' },
      'known-bug': { type: 'string' },
      dryRun: { type: 'string', default: 'true' },
      'patrol-command': { type: 'string' },
      'issue-command': { type: 'string' },
      'fix-command': { type: 'string' },
      'regression-command': { type: 'string' },
      'verify-command': { type: 'string' },
      'result-out': { type: 'string', default: 'state/patrol/patrol-fix-verify-result.json' },
      'proof-bundle-out': { type: 'string', default: 'state/patrol/patrol-fix-verify-proof.json' },
    },
    allowPositionals: false,
  });

  const dryRun = toBoolean(values.dryRun, true);
  const trigger = values.trigger === 'schedule' ? 'schedule' : 'manual';

  const input: PatrolFixVerifyInput = {
    trigger,
    knownBugHint: values['known-bug'],
    patrolScan: {
      dryRun,
      ...(values['patrol-command'] ? { command: values['patrol-command'] } : {}),
    },
    issueFiler: {
      dryRun,
      ...(values['issue-command'] ? { command: values['issue-command'] } : {}),
    },
    fixGenerator: {
      dryRun,
      ...(values['fix-command'] ? { command: values['fix-command'] } : {}),
    },
    regressionTest: {
      dryRun,
      ...(values['regression-command'] ? { command: values['regression-command'] } : {}),
    },
    fixVerifier: {
      dryRun,
      ...(values['verify-command'] ? { command: values['verify-command'] } : {}),
    },
  };

  const construction = createPatrolFixVerifyProcessConstruction();
  const result = await construction.execute(input);

  if (!result.ok) {
    console.error(JSON.stringify({
      ok: false,
      error: result.error.message,
      errorAt: result.errorAt,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    output: result.value,
  }, null, 2));

  if (result.value.exitReason !== 'completed') {
    process.exitCode = 1;
    return;
  }

  const resultOutPath = resolve(values['result-out']);
  const proofBundleOutPath = resolve(values['proof-bundle-out']);
  await mkdir(dirname(resultOutPath), { recursive: true });
  await writeFile(resultOutPath, JSON.stringify(result.value, null, 2), 'utf8');

  const proofReaderScript = [
    'const fs = require("node:fs");',
    `process.stdout.write(fs.readFileSync(${JSON.stringify(resultOutPath)}, "utf8"));`,
  ].join(' ');
  const proofGate = createOperationalProofGateConstruction();
  const proofResult = await proofGate.execute({
    checks: [
      {
        id: 'patrol-fix-verify-proof',
        description: 'validate patrol loop output and emitted artifact',
        command: process.execPath,
        args: ['-e', proofReaderScript],
        requiredOutputSubstrings: ['PatrolFixVerifyResult.v1', result.value.issueUrl, result.value.fixPrUrl],
        requiredFilePaths: [resultOutPath],
      },
    ],
    proofBundleOutputPath: proofBundleOutPath,
    proofBundleSource: 'patrol-fix-verify-construction',
  });

  if (!proofResult.ok) {
    console.error(JSON.stringify({
      ok: false,
      error: proofResult.error.message,
      errorAt: proofResult.errorAt,
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (!proofResult.value.passed) {
    console.error(JSON.stringify({
      ok: false,
      error: 'operational proof gate failed',
      proof: proofResult.value,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    resultPath: resultOutPath,
    proofBundlePath: proofBundleOutPath,
    proofBundle: proofResult.value.proofBundle,
  }, null, 2));
}

void main();
