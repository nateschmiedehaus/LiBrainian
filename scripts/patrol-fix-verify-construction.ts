#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { createPatrolFixVerifyProcessConstruction, type PatrolFixVerifyInput } from '../src/constructions/processes/patrol_fix_verify_process.js';

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
  }
}

void main();
