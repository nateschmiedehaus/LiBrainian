#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    bundle: 'state/patrol/patrol-fix-verify-proof.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--bundle') {
      if (!next) throw new Error('--bundle requires a value');
      options.bundle = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateProofBundle(bundle, bundlePath) {
  assert(bundle && typeof bundle === 'object', `invalid proof bundle at ${bundlePath}: expected object`);
  assert(bundle.kind === 'OperationalProofBundle.v1', `invalid proof bundle kind: ${String(bundle.kind)}`);
  assert(typeof bundle.generatedAt === 'string' && bundle.generatedAt.length > 0, 'proof bundle missing generatedAt');
  assert(typeof bundle.source === 'string' && bundle.source.length > 0, 'proof bundle missing source');
  assert(typeof bundle.passed === 'boolean', 'proof bundle missing passed');
  assert(Number.isInteger(bundle.failureCount) && bundle.failureCount >= 0, 'proof bundle missing failureCount');
  assert(Array.isArray(bundle.checks) && bundle.checks.length > 0, 'proof bundle requires at least one check');

  for (const [index, check] of bundle.checks.entries()) {
    assert(check && typeof check === 'object', `proof check ${index} is not an object`);
    assert(typeof check.id === 'string' && check.id.length > 0, `proof check ${index} missing id`);
    assert(typeof check.commandLine === 'string' && check.commandLine.length > 0, `proof check ${index} missing commandLine`);
    assert(check.exitCode === null || Number.isInteger(check.exitCode), `proof check ${index} invalid exitCode`);
    assert(typeof check.timedOut === 'boolean', `proof check ${index} missing timedOut`);
    assert(typeof check.durationMs === 'number' && Number.isFinite(check.durationMs) && check.durationMs >= 0, `proof check ${index} invalid durationMs`);
    assert(typeof check.passed === 'boolean', `proof check ${index} missing passed`);
    assert(isStringArray(check.missingOutputSubstrings), `proof check ${index} invalid missingOutputSubstrings`);
    assert(isStringArray(check.missingFilePaths), `proof check ${index} invalid missingFilePaths`);
    assert(typeof check.stdout === 'string', `proof check ${index} missing stdout`);
    assert(typeof check.stderr === 'string', `proof check ${index} missing stderr`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bundlePath = path.resolve(options.bundle);
  const raw = await fs.readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(raw);
  validateProofBundle(bundle, bundlePath);

  if (bundle.passed !== true) {
    throw new Error(`proof bundle failed: failureCount=${bundle.failureCount}`);
  }

  console.log(
    `[operational-proof-gate] bundle=${bundlePath} checks=${bundle.checks.length} ` +
    `failureCount=${bundle.failureCount} source=${bundle.source}`,
  );
}

main().catch((error) => {
  console.error(`[operational-proof-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
