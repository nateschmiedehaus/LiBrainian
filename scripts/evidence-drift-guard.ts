import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeGatesEvidenceShape, analyzeStatusEvidenceDrift } from '../src/evidence/drift_guard.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      status: { type: 'string' },
      gates: { type: 'string' },
    },
  });

  const root = process.cwd();
  const statusPath = values.status
    ? path.resolve(String(values.status))
    : path.join(root, 'docs', 'librarian', 'STATUS.md');
  const gatesPath = values.gates
    ? path.resolve(String(values.gates))
    : path.join(root, 'docs', 'librarian', 'GATES.json');

  const findings: string[] = [];

  let statusContent = '';
  try {
    statusContent = await fs.readFile(statusPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings.push(`STATUS unreadable: ${message}`);
  }

  if (statusContent) {
    for (const finding of analyzeStatusEvidenceDrift(statusContent)) {
      findings.push(`${finding.code}${finding.line ? ` (line ${finding.line})` : ''}: ${finding.message}`);
    }
  }

  let gatesContent = '';
  try {
    gatesContent = await fs.readFile(gatesPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings.push(`GATES unreadable: ${message}`);
  }

  if (gatesContent) {
    for (const finding of analyzeGatesEvidenceShape(gatesContent)) {
      findings.push(`${finding.code}: ${finding.message}`);
    }
  }

  if (findings.length > 0) {
    console.error('[evidence:drift-check] failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    console.error('Remediation: run `npm run evidence:manifest && npm run evidence:reconcile` and mark non-evidence narrative claims as unverified when needed.');
    process.exitCode = 1;
    return;
  }

  console.log('[evidence:drift-check] ok');
}

main().catch((error) => {
  console.error('[evidence:drift-check] fatal:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
