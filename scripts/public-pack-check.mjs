#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

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

  console.log(
    `[public:pack] ok files=${filePaths.length} tarball=${pack.filename ?? 'unknown'} size=${pack.size ?? 'unknown'}`
  );
}

main();
