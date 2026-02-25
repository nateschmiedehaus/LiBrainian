#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function runWithCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function printBufferedOutput(output) {
  if (output.stdout.trim().length > 0) process.stdout.write(output.stdout);
  if (output.stderr.trim().length > 0) process.stderr.write(output.stderr);
}

const SOFT_FAILURE_CLASSES = [
  {
    code: 'unbootstrapped',
    patterns: [
      'librarian not bootstrapped',
      'librainian not bootstrapped',
      'no valid files to index',
      'no files specified',
    ],
    remediation: 'Run "npx tsx src/cli/index.ts bootstrap" once for this workspace.',
  },
  {
    code: 'adapter_unavailable',
    patterns: [
      'ebootstrap_failed',
      'model policy provider not registered',
      'llm adapter is not registered',
      'llm_adapter_unregistered',
      'providerunavailable',
    ],
    remediation:
      'Register an LLM adapter/provider, then run "npx tsx src/cli/index.ts bootstrap" to initialize.',
  },
  {
    code: 'runtime_missing',
    patterns: ['spawn tsx enoent'],
    remediation: 'Install project dev dependencies and rerun commit.',
  },
];

function classifySoftFailure(outputText) {
  const lower = outputText.toLowerCase();
  for (const failureClass of SOFT_FAILURE_CLASSES) {
    if (failureClass.patterns.some((pattern) => lower.includes(pattern))) {
      return failureClass;
    }
  }
  return null;
}

function summarizeFailure(outputText) {
  const firstLine = outputText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return 'no diagnostics available';
  return firstLine.length > 220 ? `${firstLine.slice(0, 217)}...` : firstLine;
}

function main() {
  const stagedFiles = process.argv.slice(2).filter((value) => value.trim().length > 0);
  if (stagedFiles.length === 0) {
    process.exit(0);
  }

  const update = runWithCapture('npm', ['run', 'librainian:update', '--', ...stagedFiles]);
  if (update.status === 0) {
    printBufferedOutput(update);
    process.exit(0);
  }

  const combined = `${update.stdout}\n${update.stderr}`;
  const failureClass = classifySoftFailure(combined);
  if (failureClass) {
    const summary = summarizeFailure(combined);
    console.warn(
      `[hooks] LiBrainian staged index update skipped (non-blocking:${failureClass.code}). ${failureClass.remediation}`,
    );
    console.warn(`[hooks] update diagnostics: ${summary}`);
    process.exit(0);
  }

  printBufferedOutput(update);
  process.exit(update.status);
}

main();
