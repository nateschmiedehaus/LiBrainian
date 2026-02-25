#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const REMEDIATION_COMMANDS = [
  'npm run evidence:manifest',
  'npm run evidence:reconcile',
  'npm run evidence:refresh',
];

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

function emitRemediation() {
  process.stderr.write('Remediation:\n');
  for (const command of REMEDIATION_COMMANDS) {
    process.stderr.write(`- ${command}\n`);
  }
}

function fail(code, manifestPath, detail) {
  process.stderr.write(`[evidence:preflight] failed (${code})\n`);
  process.stderr.write(`Manifest: ${manifestPath}\n`);
  if (detail && detail.length > 0) {
    process.stderr.write(`${detail}\n`);
  }
  emitRemediation();
  process.exitCode = 1;
}

function runEvidenceRefresh(root) {
  const result = spawnSync('npm', ['run', 'evidence:refresh'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    const details = [stderr, stdout].filter((line) => line.length > 0).join('\n');
    const message = details.length > 0 ? details : 'npm run evidence:refresh failed';
    return {
      ok: false,
      message,
    };
  }
  return {
    ok: true,
    message: '[evidence:preflight] auto-recovered via evidence:refresh',
  };
}

function summarizeViolations(report) {
  const first = report.violations.slice(0, 3).map((violation) => `${violation.code}: ${violation.message}`);
  return first.join('; ');
}

async function checkFreshness(root, manifestPath, watchRaw) {
  const checkEvidenceFreshness = await loadFreshnessChecker();
  const explicitWatch = parseWatchValues(watchRaw);
  const watchedPaths = explicitWatch.length > 0
    ? explicitWatch.map((entry) => path.resolve(root, entry))
    : listDefaultWatchedPaths(root).filter((candidate) => candidate !== manifestPath);
  return checkEvidenceFreshness({
    manifestPath,
    watchedPaths,
  });
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string' },
      root: { type: 'string' },
      watch: { type: 'string', multiple: true },
      'auto-recover': { type: 'boolean', default: false },
    },
  });

  const root = path.resolve(values.root ?? process.cwd());
  const manifestPath = resolveManifestPath(root, values.manifest);
  const autoRecover = Boolean(values['auto-recover']) || process.env.LIBRAINIAN_EVIDENCE_PREFLIGHT_AUTO === '1';

  if (autoRecover && process.env.CI === 'true') {
    fail('auto_recover_disabled_in_ci', manifestPath, 'Auto-recovery is disabled in CI to keep strict qualification deterministic.');
    return;
  }

  if (!existsSync(manifestPath)) {
    if (!autoRecover) {
      fail('evidence_manifest_missing', manifestPath, 'Run remediation before strict qualification.');
      return;
    }
    const refreshResult = runEvidenceRefresh(root);
    if (!refreshResult.ok) {
      fail('evidence_refresh_failed', manifestPath, refreshResult.message);
      return;
    }
    if (!existsSync(manifestPath)) {
      fail('evidence_manifest_missing_after_refresh', manifestPath, 'Refresh completed but manifest is still missing.');
      return;
    }
    process.stdout.write(`${refreshResult.message}\n`);
    return;
  }

  const freshnessReport = await checkFreshness(root, manifestPath, values.watch);
  if (freshnessReport.ok) {
    process.stdout.write('[evidence:preflight] ok (manifest present and fresh)\n');
    return;
  }

  if (!autoRecover) {
    fail('evidence_manifest_stale', manifestPath, summarizeViolations(freshnessReport));
    return;
  }

  const refreshResult = runEvidenceRefresh(root);
  if (!refreshResult.ok) {
    fail('evidence_refresh_failed', manifestPath, refreshResult.message);
    return;
  }

  const refreshedReport = await checkFreshness(root, manifestPath, values.watch);
  if (!refreshedReport.ok) {
    fail('evidence_manifest_stale_after_refresh', manifestPath, summarizeViolations(refreshedReport));
    return;
  }

  process.stdout.write(`${refreshResult.message}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[evidence:preflight] fatal: ${message}\n`);
  process.exitCode = 1;
});
