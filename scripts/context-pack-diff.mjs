#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    before: null,
    after: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--before') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --before');
      }
      i += 1;
      options.before = path.resolve(value);
      continue;
    }
    if (arg === '--after') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --after');
      }
      i += 1;
      options.after = path.resolve(value);
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.before || !options.after) {
    throw new Error('Usage: node scripts/context-pack-diff.mjs --before <dir> --after <dir> [--json]');
  }

  return options;
}

async function listPackFiles(dir) {
  const names = await fs.readdir(dir);
  return names
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .sort((a, b) => a.localeCompare(b));
}

async function readFileMap(dir) {
  const files = await listPackFiles(dir);
  const map = new Map();
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = await fs.readFile(fullPath, 'utf8');
    map.set(file, content);
  }
  return map;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const beforeMap = await readFileMap(options.before);
  const afterMap = await readFileMap(options.after);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [file, content] of afterMap) {
    if (!beforeMap.has(file)) {
      added.push(file);
      continue;
    }
    if (beforeMap.get(file) !== content) {
      changed.push(file);
    }
  }
  for (const file of beforeMap.keys()) {
    if (!afterMap.has(file)) {
      removed.push(file);
    }
  }

  const report = {
    schema_version: 1,
    kind: 'ContextPackDiffReport.v1',
    before: options.before,
    after: options.after,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    },
    added,
    removed,
    changed,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('[packs:diff] summary');
    console.log(`  added:   ${report.summary.added}`);
    console.log(`  removed: ${report.summary.removed}`);
    console.log(`  changed: ${report.summary.changed}`);
    if (added.length) console.log(`  added files: ${added.join(', ')}`);
    if (removed.length) console.log(`  removed files: ${removed.join(', ')}`);
    if (changed.length) console.log(`  changed files: ${changed.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('[packs:diff] failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
