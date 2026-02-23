import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RUNTIME_ACTIVE_LEASE_DIR, pruneRuntimeArtifacts } from './prune-runtime-artifacts.mjs';

function printUsageAndExit(code) {
  // eslint-disable-next-line no-console
  console.error(
    [
      'Usage:',
      '  node scripts/run-with-tmpdir.mjs [--tmpdir PATH] [--timeout-seconds N] [--set KEY=VALUE ...] -- <command> [args...]',
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
  let timeoutSeconds;
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
    if (arg === '--timeout-seconds') {
      const raw = argv[i + 1];
      const parsed = Number.parseInt(raw ?? '', 10);
      if (!Number.isFinite(parsed) || parsed <= 0) printUsageAndExit(2);
      timeoutSeconds = parsed;
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
  return { tmpdir, timeoutSeconds, sets, cmd, cmdArgs };
}

const { tmpdir: explicitTmpdir, timeoutSeconds, sets, cmd, cmdArgs } = parseArgs(process.argv.slice(2));

const fallbackTmpdir = path.resolve(process.cwd(), '..', '.tmp', 'librainian');
const localTmpdir = path.resolve(process.cwd(), '.tmp', 'librainian');
const osTmpdir = path.resolve(os.tmpdir(), 'librainian');
const legacyFallbackTmpdir = path.resolve(process.cwd(), '..', '.tmp', 'librarian');
const legacyLocalTmpdir = path.resolve(process.cwd(), '.tmp', 'librarian');
const legacyOsTmpdir = path.resolve(os.tmpdir(), 'librarian');
const configuredTmpdir =
  (explicitTmpdir && explicitTmpdir.trim().length > 0 ? explicitTmpdir : undefined) ??
  (process.env.LIBRAINIAN_TMPDIR && process.env.LIBRAINIAN_TMPDIR.trim().length > 0
    ? process.env.LIBRAINIAN_TMPDIR
    : undefined) ??
  (process.env.LIBRARIAN_TMPDIR && process.env.LIBRARIAN_TMPDIR.trim().length > 0
    ? process.env.LIBRARIAN_TMPDIR
    : undefined) ??
  fallbackTmpdir;
const tmpdirCandidates = [
  ...new Set([
    configuredTmpdir,
    localTmpdir,
    osTmpdir,
    legacyFallbackTmpdir,
    legacyLocalTmpdir,
    legacyOsTmpdir,
  ]),
];

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

const leaseDir = path.join(resolvedTmpdir, RUNTIME_ACTIVE_LEASE_DIR);
const leaseFile = path.join(leaseDir, `${process.pid}.lease`);
await mkdir(leaseDir, { recursive: true });
await writeFile(
  leaseFile,
  JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + '\n',
  'utf8',
);
const leaseHeartbeat = setInterval(() => {
  void utimes(leaseFile, new Date(), new Date()).catch(() => {});
}, 30_000);
leaseHeartbeat.unref();
let leaseCleaned = false;
async function cleanupLease() {
  if (leaseCleaned) return;
  leaseCleaned = true;
  clearInterval(leaseHeartbeat);
  await rm(leaseFile, { force: true });
}

await pruneRuntimeArtifacts({ quiet: true, enforceSizeBudget: false }).catch(() => {});

const env = { ...process.env, TMPDIR: resolvedTmpdir, TMP: resolvedTmpdir, TEMP: resolvedTmpdir };
env.LIBRAINIAN_TMPDIR = resolvedTmpdir;
env.LIBRARIAN_TMPDIR = resolvedTmpdir;
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

let finalized = false;
let timedOut = false;
let hardKillTimer;
let timeoutTimer;

function finalizeWith(code) {
  if (finalized) return;
  finalized = true;
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  void cleanupLease().finally(() => {
    process.exit(code);
  });
}

function terminateChild(signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // Ignore kill failures; close handler will determine final exit behavior.
  }
}

if (typeof timeoutSeconds === 'number') {
  timeoutTimer = setTimeout(() => {
    timedOut = true;
    // eslint-disable-next-line no-console
    console.error(`[run-with-tmpdir] Command timed out after ${timeoutSeconds}s: ${cmd} ${cmdArgs.join(' ')}`);
    terminateChild('SIGTERM');
    hardKillTimer = setTimeout(() => {
      terminateChild('SIGKILL');
    }, 5_000);
    hardKillTimer.unref();
  }, timeoutSeconds * 1_000);
  timeoutTimer.unref();
}

child.on('error', () => {
  finalizeWith(1);
});

child.on('close', (code, signal) => {
  if (timedOut) {
    finalizeWith(124);
    return;
  }
  if (typeof code === 'number') {
    finalizeWith(code);
    return;
  }
  finalizeWith(signal ? 1 : 0);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    terminateChild(signal);
  });
}

process.on('uncaughtException', () => {
  terminateChild('SIGTERM');
  void cleanupLease();
});
process.on('unhandledRejection', () => {
  terminateChild('SIGTERM');
  void cleanupLease();
});
