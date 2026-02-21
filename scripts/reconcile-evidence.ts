#!/usr/bin/env node
/**
 * @fileoverview Reconcile STATUS/GATES docs from source evidence manifest.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildEvidenceSummary,
  renderValidationBlock,
  reconcileGates,
  reconcileStatusContents,
  reconcileImplementationStatusContents,
  type EvidenceGateRun,
} from '../src/evaluation/evidence_reconciliation.js';

interface EvidenceManifestPayload {
  summary?: unknown;
  artifacts?: Array<{ path?: unknown }>;
  gateRuns?: EvidenceGateRun[];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const root = process.cwd();
  const manifestPath = typeof values.manifest === 'string'
    ? path.resolve(values.manifest)
    : path.join(root, 'state', 'audits', 'librarian', 'manifest.json');

  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as EvidenceManifestPayload;
  if (!manifest.summary || typeof manifest.summary !== 'object') {
    throw new Error('manifest.summary is required for reconciliation');
  }

  const summary = buildEvidenceSummary(manifest.summary as Parameters<typeof buildEvidenceSummary>[0]);
  const evidencePaths = Array.isArray(manifest.artifacts)
    ? manifest.artifacts
      .map((artifact) => (typeof artifact.path === 'string' ? artifact.path : ''))
      .filter((artifactPath) => artifactPath.length > 0)
    : [];

  const gateRuns = Array.isArray(manifest.gateRuns)
    ? manifest.gateRuns
    : [];

  const statusPath = path.join(root, 'docs', 'librarian', 'STATUS.md');
  const gatesPath = path.join(root, 'docs', 'librarian', 'GATES.json');
  const implementationStatusPath = path.join(
    root,
    'docs',
    'librarian',
    'specs',
    'IMPLEMENTATION_STATUS.md',
  );

  const statusContents = await readFile(statusPath, 'utf8');
  const gatesContents = await readFile(gatesPath, 'utf8');
  const implementationContents = await readFile(implementationStatusPath, 'utf8');

  const statusUpdated = reconcileStatusContents(statusContents, summary);
  const validationBlock = renderValidationBlock(summary);
  const gatesUpdated = JSON.stringify(
    reconcileGates(JSON.parse(gatesContents), summary, { evidencePaths, gateRuns }),
    null,
    2,
  ) + '\n';
  const implementationUpdated = reconcileImplementationStatusContents(implementationContents, summary);

  if (!values.dryRun) {
    await writeFile(statusPath, statusUpdated);
    await writeFile(gatesPath, gatesUpdated);
    await writeFile(implementationStatusPath, implementationUpdated);
  }

  console.log('Reconciliation complete.');
  console.log(`Validation summary (not written):\n${validationBlock}`);
  if (values.dryRun) {
    console.log('Dry run: no files written.');
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[evidence-reconcile] failed: ${message}`);
  process.exit(1);
});
