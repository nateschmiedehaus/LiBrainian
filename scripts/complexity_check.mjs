import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

function fail(message) {
  process.stderr.write(`[complexity_check] ${message}\n`);
  process.exit(1);
}

const root = process.cwd();
const canonPath = path.join(root, 'config', 'canon.json');
if (!fs.existsSync(canonPath)) {
  fail('Missing config/canon.json (required to determine complexity thresholds).');
}

let canon;
try {
  canon = JSON.parse(fs.readFileSync(canonPath, 'utf8'));
} catch (error) {
  fail(`Failed to parse config/canon.json (${error instanceof Error ? error.message : String(error)})`);
}

const threshold = Number(canon?.complexity?.threshold ?? 25);
const maxHigh = Number(canon?.complexity?.max_high_complexity ?? 0);

const cliPath = path.join(root, 'dist', 'cli', 'index.js');
const sourceCliPath = path.join(root, 'src', 'cli', 'index.ts');
const cliInvocation = fs.existsSync(cliPath)
  ? `node ${JSON.stringify(cliPath)}`
  : `npx tsx ${JSON.stringify(sourceCliPath)}`;

let output = '';
const tempJsonPath = path.join(
  os.tmpdir(),
  `librarian-complexity-${process.pid}-${Date.now()}.json`
);
try {
  execSync(
    `${cliInvocation} --workspace src analyze --complexity --format json --threshold ${threshold} > ${JSON.stringify(tempJsonPath)}`,
    {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error
    ? String(error.stderr ?? '').trim().replace(/\s+/g, ' ').slice(0, 240)
    : '';
  fail(`Complexity analysis failed (${message.slice(0, 240)}${stderr ? ` | stderr: ${stderr}` : ''})`);
}
try {
  output = fs.readFileSync(tempJsonPath, 'utf8').trim();
} catch (error) {
  fail(`Failed reading complexity output (${error instanceof Error ? error.message : String(error)})`);
} finally {
  if (fs.existsSync(tempJsonPath)) {
    try { fs.unlinkSync(tempJsonPath); } catch {}
  }
}

let report;
try {
  report = JSON.parse(output);
} catch {
  // Defensive: if noise appears, try to recover by trimming to the last JSON object.
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    fail('Complexity analysis did not emit JSON.');
  }
  try {
    report = JSON.parse(output.slice(start, end + 1));
  } catch (error) {
    fail(`Complexity analysis JSON parse failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

const high = Number(report?.summary?.highComplexityCount ?? NaN);
if (!Number.isFinite(high)) {
  fail('Complexity analysis JSON missing summary.highComplexityCount.');
}

if (high > maxHigh) {
  fail(`High complexity count ${high} exceeds max ${maxHigh} (threshold=${threshold}).`);
}

process.exit(0);
