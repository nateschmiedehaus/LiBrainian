#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

async function loadGateIntegrity() {
  try {
    const mod = await import('../dist/evidence/gate_integrity.js');
    return mod.findGateIntegrityFailures;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load dist build (${message}). Run: npm run build`);
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      gates: { type: 'string' },
    },
  });

  const findGateIntegrityFailures = await loadGateIntegrity();
  const root = process.cwd();
  const gatesPath = values.gates
    ? path.resolve(values.gates)
    : path.join(root, 'docs', 'librarian', 'GATES.json');
  const raw = await readFile(gatesPath, 'utf8');
  const gates = JSON.parse(raw);

  const failures = findGateIntegrityFailures(gates);
  if (failures.length > 0) {
    process.stderr.write(`[assert-gates-verified] failed (${failures.length} issue${failures.length === 1 ? '' : 's'})\n`);
    for (const failure of failures) {
      process.stderr.write(`- ${failure.taskId}: ${failure.code} (${failure.message})\n`);
    }
    process.stderr.write('Remediation: run `npm run evidence:sync` and commit reconciled GATES/STATUS updates.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write('[assert-gates-verified] ok (no unverified/evidence-missing gate entries)\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[assert-gates-verified] fatal: ${message}\n`);
  process.exitCode = 1;
});
