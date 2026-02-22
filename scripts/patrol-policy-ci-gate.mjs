#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

function parseArgs(argv) {
  const options = {
    report: 'state/patrol/patrol-run-*.json',
    artifact: 'state/patrol/patrol-policy-gate.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--report') {
      if (!next) throw new Error('--report requires a value');
      options.report = next;
      index += 1;
      continue;
    }
    if (arg === '--artifact') {
      if (!next) throw new Error('--artifact requires a value');
      options.artifact = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, payload) {
  const absolutePath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportPaths = (await glob(options.report)).sort();
  if (reportPaths.length === 0) {
    throw new Error(`no patrol reports found matching ${options.report}`);
  }

  const latestPath = reportPaths[reportPaths.length - 1];
  const report = await readJson(latestPath);
  if (report?.kind !== 'PatrolReport.v1') {
    throw new Error(`invalid patrol report kind in ${latestPath}: ${String(report?.kind)}`);
  }
  if (!report.policy || report.policy.kind !== 'PatrolPolicyEnforcementArtifact.v1') {
    throw new Error(`missing patrol policy artifact in ${latestPath}`);
  }

  const artifact = {
    kind: 'PatrolPolicyCiGateResult.v1',
    schemaVersion: 1,
    reportPath: latestPath,
    generatedAt: new Date().toISOString(),
    policy: report.policy,
    allowed: report.policy.enforcement !== 'blocked',
  };
  await writeJson(options.artifact, artifact);

  console.log(
    `[patrol-policy-gate] decision=${report.policy.requiredEvidenceMode} ` +
    `observed=${report.policy.observedEvidenceMode} enforcement=${report.policy.enforcement}`,
  );

  if (artifact.allowed !== true) {
    throw new Error(`patrol policy gate blocked: ${report.policy.reason}`);
  }
}

main().catch((error) => {
  console.error(`[patrol-policy-gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
