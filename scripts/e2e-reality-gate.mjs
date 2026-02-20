#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const options = {
    source: 'latest',
    artifact: 'state/e2e/reality-gate.json',
    outcomeArtifact: 'state/e2e/outcome-report.json',
    agenticReport: null,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --source (expected latest|tarball)');
      }
      i += 1;
      options.source = value;
      continue;
    }
    if (arg === '--artifact') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --artifact');
      }
      i += 1;
      options.artifact = value;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--agentic-report') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --agentic-report');
      }
      i += 1;
      options.agenticReport = value;
      continue;
    }
    if (arg === '--outcome-artifact') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --outcome-artifact');
      }
      i += 1;
      options.outcomeArtifact = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.source !== 'latest' && options.source !== 'tarball') {
    throw new Error(`Invalid --source value "${options.source}" (expected latest|tarball)`);
  }
  if (typeof options.agenticReport !== 'string' || options.agenticReport.trim().length === 0) {
    throw new Error('Missing required --agentic-report path');
  }

  return options;
}

async function writeArtifact(artifactPath, payload) {
  const absolutePath = path.resolve(process.cwd(), artifactPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function runRealityScript(options) {
  const args = ['scripts/npm-external-blackbox-e2e.mjs', '--source', options.source, '--artifact', options.artifact];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`External black-box E2E failed (source=${options.source})`);
  }
}

function runOutcomeHarness(options) {
  const markdownPath = options.outcomeArtifact.endsWith('.json')
    ? `${options.outcomeArtifact.slice(0, -5)}.md`
    : `${options.outcomeArtifact}.md`;
  const args = [
    'scripts/e2e-outcome-harness.mjs',
    '--agentic-report',
    options.agenticReport,
    '--artifact',
    options.outcomeArtifact,
    '--markdown',
    markdownPath,
  ];
  if (options.strict) {
    args.push('--strict');
  }
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Outcome harness failed strict thresholds (artifact=${options.outcomeArtifact})`);
  }
}

async function verifyOutcomeArtifact(options) {
  const absolutePath = path.resolve(process.cwd(), options.outcomeArtifact);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Outcome harness artifact missing or unreadable: ${absolutePath}`);
  }
  if (payload?.kind !== 'E2EOutcomeReport.v1') {
    throw new Error(`Outcome harness artifact has unexpected kind (expected E2EOutcomeReport.v1)`);
  }
  if (payload?.status !== 'passed') {
    throw new Error(`Outcome harness artifact status must be passed (received ${String(payload?.status ?? 'unknown')})`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const skipReason = String(process.env.LIBRARIAN_E2E_SKIP_REASON ?? '').trim();
  const now = new Date().toISOString();

  if (skipReason) {
    await writeArtifact(options.artifact, {
      schema_version: 1,
      kind: 'RealityGateReport.v1',
      status: 'skipped',
      source: options.source,
      strict: options.strict,
      skipReason,
      createdAt: now,
    });
    if (options.strict) {
      throw new Error(`Strict reality gate cannot skip (reason=${skipReason})`);
    }
    console.log(`[test:e2e:reality:gate] skipped (${skipReason})`);
    return;
  }

  runRealityScript(options);
  runOutcomeHarness(options);
  await verifyOutcomeArtifact(options);
  await writeArtifact(options.artifact, {
    schema_version: 1,
    kind: 'RealityGateReport.v1',
    status: 'passed',
    source: options.source,
    strict: options.strict,
    createdAt: now,
  });
  console.log(`[test:e2e:reality:gate] passed (source=${options.source})`);
}

main().catch(async (error) => {
  const options = (() => {
    try {
      return parseArgs(process.argv.slice(2));
    } catch {
      return { source: 'latest', artifact: 'state/e2e/reality-gate.json', strict: false };
    }
  })();
  await writeArtifact(options.artifact, {
    schema_version: 1,
    kind: 'RealityGateReport.v1',
    status: 'failed',
    source: options.source,
    strict: options.strict,
    createdAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => {});
  console.error('[test:e2e:reality:gate] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
