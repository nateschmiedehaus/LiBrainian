import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

async function loadReconciler() {
  try {
    const mod = await import('../dist/evaluation/evidence_reconciliation.js');
    return mod;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load dist build (${message}). Run: npm run build`);
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
    },
  });

  const {
    buildEvidenceSummary,
    renderValidationBlock,
    reconcileGates,
    reconcileStatusContents,
    reconcileImplementationStatusContents,
  } = await loadReconciler();

  const root = process.cwd();
  const manifestCandidates = [
    path.join(root, 'state', 'audits', 'librarian', 'manifest.json'),
    path.join(root, 'state', 'audits', 'LiBrainian', 'manifest.json'),
  ];
  const manifestPath = values.manifest
    ? path.resolve(values.manifest)
    : manifestCandidates.find((candidate) => existsSync(candidate)) ?? manifestCandidates[0];

  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  if (!manifest.summary) {
    throw new Error('manifest.summary is required for reconciliation');
  }

  const summary = buildEvidenceSummary(manifest.summary);
  const evidencePaths = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.map((artifact) => artifact.path).filter(Boolean)
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
  const gatesUpdated =
    JSON.stringify(
      reconcileGates(JSON.parse(gatesContents), summary, { evidencePaths }),
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
  console.log(`Validation summary (not written):\\n${validationBlock}`);
  if (values.dryRun) {
    console.log('Dry run: no files written.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
