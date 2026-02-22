#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

async function loadFreshnessChecker() {
  try {
    const mod = await import('../dist/evidence/evidence_manifest_freshness.js');
    return mod.checkEvidenceFreshness;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load dist build (${message}). Run: npm run build`);
  }
}

function parseWatchValues(raw) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveManifestPath(root, explicitPath) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  const candidates = [
    path.join(root, 'state', 'audits', 'librarian', 'manifest.json'),
    path.join(root, 'state', 'audits', 'LiBrainian', 'manifest.json'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function listDefaultWatchedPaths(root) {
  const args = [
    'ls-files',
    '-z',
    '--',
    'src/evaluation',
    'src/evidence',
    'scripts',
    'package.json',
    'package-lock.json',
    '.github/workflows',
  ];
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }

  return result.stdout
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(root, entry));
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string' },
      root: { type: 'string' },
      watch: { type: 'string', multiple: true },
    },
  });

  const checkEvidenceFreshness = await loadFreshnessChecker();
  const root = path.resolve(values.root ?? process.cwd());
  const manifestPath = resolveManifestPath(root, values.manifest);
  const explicitWatch = parseWatchValues(values.watch);
  const watchedPaths = explicitWatch.length > 0
    ? explicitWatch.map((entry) => path.resolve(root, entry))
    : listDefaultWatchedPaths(root).filter((candidate) => candidate !== manifestPath);

  const report = await checkEvidenceFreshness({
    manifestPath,
    watchedPaths,
  });

  if (!report.ok) {
    process.stderr.write(`[check-evidence-freshness] failed (${report.violations.length} issue${report.violations.length === 1 ? '' : 's'})\n`);
    for (const violation of report.violations) {
      process.stderr.write(`- ${violation.code}: ${violation.path ?? 'n/a'} (${violation.message})\n`);
    }
    process.stderr.write('Remediation: run `npm run evidence:manifest && npm run evidence:reconcile`.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[check-evidence-freshness] ok (${watchedPaths.length} watched paths)\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[check-evidence-freshness] fatal: ${message}\n`);
  process.exitCode = 1;
});
