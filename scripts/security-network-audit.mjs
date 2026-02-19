#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const DOC_PATH = path.join(ROOT, 'docs', 'security.md');

const ALLOWED_FETCH_FILES = new Set([
  'src/integrations/github_issues.ts',
  'src/integrations/jira.ts',
  'src/integrations/pagerduty.ts',
  'src/evaluation/package_existence.ts',
]);

const REQUIRED_ENDPOINT_MARKERS = [
  'api.github.com',
  '/rest/api/3/search',
  'api.pagerduty.com',
  'registry.npmjs.org',
  'pypi.org',
  'crates.io',
];
const FETCH_PATTERN = /(?<!["'`])\bawait\s+fetch\s*\(/;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...await walk(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    files.push(full);
  }
  return files;
}

async function findFetchCallFiles() {
  const files = await walk(SRC_ROOT);
  const fetchFiles = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    if (FETCH_PATTERN.test(content)) {
      fetchFiles.push(path.relative(ROOT, file).replaceAll(path.sep, '/'));
    }
  }
  return fetchFiles.sort();
}

function printList(title, items) {
  console.log(`\n${title}`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

async function main() {
  const fetchFiles = await findFetchCallFiles();
  const unexpected = fetchFiles.filter((file) => !ALLOWED_FETCH_FILES.has(file));

  let docs = '';
  try {
    docs = await fs.readFile(DOC_PATH, 'utf8');
  } catch {
    console.error(`Missing required threat model doc: ${path.relative(ROOT, DOC_PATH)}`);
    process.exit(1);
  }

  const missingMarkers = REQUIRED_ENDPOINT_MARKERS.filter((marker) => !docs.includes(marker));

  printList('Detected production fetch() call sites', fetchFiles);

  if (unexpected.length > 0) {
    printList('Unexpected fetch() call sites (not allowlisted)', unexpected);
  }
  if (missingMarkers.length > 0) {
    printList('Missing endpoint markers in docs/security.md', missingMarkers);
  }

  if (unexpected.length > 0 || missingMarkers.length > 0) {
    process.exit(1);
  }

  console.log('\nsecurity-network-audit: PASS');
}

main().catch((error) => {
  console.error(`security-network-audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
