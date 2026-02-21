#!/usr/bin/env node
/**
 * @fileoverview Generate evidence manifest from source and capture Layer 0/1 gate command evidence.
 */

import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeEvidenceManifest } from '../src/evaluation/evidence_manifest.js';

interface CliOptions {
  root: string;
  outputPath?: string;
  runGateCommands: boolean;
  gateTaskKeys?: string[];
  gateCommandTimeoutMs?: number;
}

function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', default: process.cwd() },
      output: { type: 'string' },
      'skip-gate-commands': { type: 'boolean', default: false },
      'gate-task': { type: 'string', multiple: true },
      'gate-timeout-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  const root = resolve(String(values.root ?? process.cwd()));
  const output = typeof values.output === 'string'
    ? (isAbsolute(values.output) ? values.output : join(root, values.output))
    : undefined;

  const timeoutRaw = values['gate-timeout-ms'];
  let gateCommandTimeoutMs: number | undefined;
  if (typeof timeoutRaw === 'string') {
    const parsed = Number.parseInt(timeoutRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid --gate-timeout-ms value: ${timeoutRaw}`);
    }
    gateCommandTimeoutMs = parsed;
  }

  const gateTaskKeys = Array.isArray(values['gate-task'])
    ? values['gate-task'].map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : undefined;

  return {
    root,
    outputPath: output,
    runGateCommands: !Boolean(values['skip-gate-commands']),
    gateTaskKeys: gateTaskKeys && gateTaskKeys.length > 0 ? gateTaskKeys : undefined,
    gateCommandTimeoutMs,
  };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const result = await writeEvidenceManifest({
    workspaceRoot: options.root,
    outputPath: options.outputPath,
    runGateCommands: options.runGateCommands,
    gateCommandTaskKeys: options.gateTaskKeys,
    gateCommandTimeoutMs: options.gateCommandTimeoutMs,
  });

  const gateRunCount = Array.isArray(result.manifest.gateRuns) ? result.manifest.gateRuns.length : 0;
  process.stdout.write(`[evidence-manifest] wrote ${result.outputPath} (gate_runs=${gateRunCount})\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[evidence-manifest] failed: ${message}\n`);
  process.exit(1);
});
