#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const workspaceRoot = process.cwd();
const scannedExtensions = ['.js', '.js.map', '.d.ts', '.d.ts.map'];
const allowedPrefixes = [
  'dist/',
  'test/fixtures/',
  'eval-corpus/external-repos/',
];

function listRepositoryFiles() {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(path.sep).join('/'));
}

function isCandidate(filePath) {
  if (!scannedExtensions.some((extension) => filePath.endsWith(extension))) return false;
  if (filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return false;
  return !allowedPrefixes.some((prefix) => filePath.startsWith(prefix));
}

function sourceCandidates(filePath) {
  let base = filePath;
  if (base.endsWith('.js.map')) base = base.slice(0, -'.js.map'.length);
  else if (base.endsWith('.d.ts.map')) base = base.slice(0, -'.d.ts.map'.length);
  else if (base.endsWith('.d.ts')) base = base.slice(0, -'.d.ts'.length);
  else if (base.endsWith('.js')) base = base.slice(0, -'.js'.length);

  return [`${base}.ts`, `${base}.tsx`];
}

function pathExists(relativePath) {
  return fs.existsSync(path.join(workspaceRoot, relativePath));
}

function main() {
  const files = listRepositoryFiles();
  const violations = [];

  for (const filePath of files) {
    if (!isCandidate(filePath)) continue;
    const sourcePath = sourceCandidates(filePath).find((candidate) => pathExists(candidate));
    if (!sourcePath) continue;
    violations.push({ generatedPath: filePath, sourcePath });
  }

  if (violations.length === 0) {
    process.exit(0);
  }

  process.stderr.write('[generated-artifacts] Detected likely TypeScript emit artifacts in source-controlled paths.\n');
  for (const violation of violations) {
    process.stderr.write(` - ${violation.generatedPath} (source sibling: ${violation.sourcePath})\n`);
  }
  process.stderr.write(
    '[generated-artifacts] Remove these files and run `npm run typecheck` (uses `tsc --noEmit`) for type validation.\n'
  );
  process.exit(1);
}

main();
