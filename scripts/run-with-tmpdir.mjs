import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function printUsageAndExit(code) {
  // eslint-disable-next-line no-console
  console.error(
    [
      'Usage:',
      '  node scripts/run-with-tmpdir.mjs [--tmpdir PATH] [--set KEY=VALUE ...] -- <command> [args...]',
      '',
      'Example:',
      '  node scripts/run-with-tmpdir.mjs --set LIBRARIAN_TEST_MODE=unit -- vitest --run',
    ].join('\n')
  );
  process.exit(code);
}

function parseArgs(argv) {
  const sets = [];
  let tmpdir;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') break;
    if (arg === '--tmpdir') {
      tmpdir = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg === '--set') {
      const kv = argv[i + 1];
      if (!kv || !kv.includes('=')) printUsageAndExit(2);
      sets.push(kv);
      i += 2;
      continue;
    }
    printUsageAndExit(2);
  }

  const sep = argv.indexOf('--');
  if (sep === -1) printUsageAndExit(2);
  const cmd = argv[sep + 1];
  if (!cmd) printUsageAndExit(2);
  const cmdArgs = argv.slice(sep + 2);
  return { tmpdir, sets, cmd, cmdArgs };
}

const { tmpdir: explicitTmpdir, sets, cmd, cmdArgs } = parseArgs(process.argv.slice(2));

const fallbackTmpdir = path.resolve(process.cwd(), '..', '.tmp', 'librarian');
const localTmpdir = path.resolve(process.cwd(), '.tmp', 'librarian');
const osTmpdir = path.resolve(os.tmpdir(), 'librarian');
const configuredTmpdir =
  (explicitTmpdir && explicitTmpdir.trim().length > 0 ? explicitTmpdir : undefined) ??
  (process.env.LIBRARIAN_TMPDIR && process.env.LIBRARIAN_TMPDIR.trim().length > 0
    ? process.env.LIBRARIAN_TMPDIR
    : undefined) ??
  fallbackTmpdir;
const tmpdirCandidates = [...new Set([configuredTmpdir, localTmpdir, osTmpdir])];

let resolvedTmpdir;
let lastError;
for (const candidate of tmpdirCandidates) {
  try {
    await mkdir(candidate, { recursive: true });
    const probe = await mkdtemp(path.join(candidate, 'writable-'));
    await rm(probe, { recursive: true, force: true });
    resolvedTmpdir = candidate;
    break;
  } catch (error) {
    lastError = error;
  }
}
if (!resolvedTmpdir) {
  throw lastError ?? new Error('Unable to create any writable temp directory');
}

const env = { ...process.env, TMPDIR: resolvedTmpdir, TMP: resolvedTmpdir, TEMP: resolvedTmpdir };
for (const kv of sets) {
  const idx = kv.indexOf('=');
  const key = kv.slice(0, idx);
  const value = kv.slice(idx + 1);
  env[key] = value;
}

const child = spawn(cmd, cmdArgs, {
  stdio: 'inherit',
  env,
  // Needed for `.cmd` resolution on Windows.
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') process.exit(code);
  process.exit(signal ? 1 : 0);
});
