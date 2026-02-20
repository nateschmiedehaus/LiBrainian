#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const DEFAULT_MAX_UNPACKED_SIZE_MB = 15;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? '';
    const stdout = result.stdout?.trim() ?? '';
    const output = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return result.stdout?.trim() ?? '';
}

function isAllowedPackPath(filePath) {
  if (filePath === 'package.json') return true;
  if (filePath === 'README.md') return true;
  if (filePath === 'CHANGELOG.md') return true;
  if (filePath === 'LICENSE') return true;
  if (filePath.startsWith('dist/')) return true;
  return false;
}

function parsePackOutput(rawOutput) {
  const output = rawOutput.trim();
  if (!output) {
    throw new Error('npm pack --dry-run --json returned empty output');
  }

  try {
    return JSON.parse(output);
  } catch {
    // npm lifecycle hooks (for example prepare) may emit plain text before JSON.
    // Recover by slicing from the first JSON delimiter to the final matching terminator.
    const firstArray = output.indexOf('[');
    const firstObject = output.indexOf('{');
    const startCandidates = [firstArray, firstObject].filter((index) => index >= 0);
    if (startCandidates.length === 0) {
      throw new Error(`Unable to locate JSON payload in npm pack output:\n${output}`);
    }

    const start = Math.min(...startCandidates);
    const endArray = output.lastIndexOf(']');
    const endObject = output.lastIndexOf('}');
    const end = Math.max(endArray, endObject);
    if (end < start) {
      throw new Error(`Unable to locate JSON terminator in npm pack output:\n${output}`);
    }

    const candidate = output.slice(start, end + 1).trim();
    return JSON.parse(candidate);
  }
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function resolveMaxUnpackedSizeBytes() {
  const raw = process.env.LIBRARIAN_MAX_UNPACKED_SIZE_MB;
  if (!raw) {
    return DEFAULT_MAX_UNPACKED_SIZE_MB * 1024 * 1024;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid LIBRARIAN_MAX_UNPACKED_SIZE_MB value: ${raw}`);
  }
  return Math.round(parsed * 1024 * 1024);
}

function main() {
  const raw = run('npm', ['pack', '--dry-run', '--json']);
  const parsed = parsePackOutput(raw);
  const pack = Array.isArray(parsed) ? parsed[0] : null;
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error('Unable to parse npm pack --dry-run --json output');
  }

  const filePaths = pack.files.map((entry) => String(entry.path));
  const disallowed = filePaths.filter((filePath) => !isAllowedPackPath(filePath));
  const sourcemaps = filePaths.filter((filePath) => filePath.endsWith('.map'));
  const evaluationFiles = filePaths.filter((filePath) => filePath.startsWith('dist/evaluation/'));

  if (disallowed.length > 0) {
    throw new Error(
      `Package contains non-public files:\n${disallowed
        .slice(0, 25)
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`
    );
  }

  if (sourcemaps.length > 0) {
    throw new Error(
      `Package contains source maps unexpectedly:\n${sourcemaps
        .slice(0, 25)
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`
    );
  }

  if (evaluationFiles.length > 0) {
    throw new Error(
      `Package contains internal evaluation harness files:\n${evaluationFiles
        .slice(0, 25)
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`
    );
  }

  const maxUnpackedSizeBytes = resolveMaxUnpackedSizeBytes();
  const unpackedSize = Number(pack.unpackedSize ?? 0);
  if (Number.isFinite(unpackedSize) && unpackedSize > maxUnpackedSizeBytes) {
    throw new Error(
      `Package unpacked size exceeds budget: actual=${formatMiB(unpackedSize)} budget=${formatMiB(maxUnpackedSizeBytes)}`
    );
  }

  console.log(
    `[public:pack] ok files=${filePaths.length} tarball=${pack.filename ?? 'unknown'} size=${pack.size ?? 'unknown'} unpacked=${pack.unpackedSize ?? 'unknown'} budget=${maxUnpackedSizeBytes}`
  );
}

main();
