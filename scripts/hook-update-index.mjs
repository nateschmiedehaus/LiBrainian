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
  const softFailureReasons = [
    'Librarian not bootstrapped',
    'No valid files to index',
    'No files specified',
    'ProviderUnavailable',
    'spawn tsx ENOENT',
  ];
  const isSoftFailure = softFailureReasons.some((reason) => combined.includes(reason));

  if (isSoftFailure) {
    console.warn('[hooks] LiBrainian staged index update skipped (non-blocking):');
    printBufferedOutput(update);
    process.exit(0);
  }

  printBufferedOutput(update);
  process.exit(update.status);
}

main();
