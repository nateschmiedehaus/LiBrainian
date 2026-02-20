#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function run(cmd) {
  const out = execSync(cmd, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return typeof out === 'string' ? out.trim() : '';
}

function runMaybe(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function fail(message, hints = []) {
  console.error(`[policy:npm:fresh] ${message}`);
  for (const hint of hints) {
    console.error(`  - ${hint}`);
  }
  process.exit(1);
}

function parseVersion(raw) {
  const text = raw?.trim() ?? '';
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return text.replace(/^"|"$/g, '');
  }
}

function main() {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const packageName = String(packageJson.name ?? '').trim();
  const localVersion = String(packageJson.version ?? '').trim();

  if (!packageName || !localVersion) {
    fail('package.json is missing name/version fields.');
  }

  const publishedRaw = runMaybe(`npm view ${packageName} version --json`);
  if (!publishedRaw) {
    fail(`Could not resolve published npm version for "${packageName}".`, [
      'Check npm registry connectivity and auth, then retry.',
    ]);
  }

  const publishedVersion = parseVersion(publishedRaw);
  if (!publishedVersion) {
    fail(`Unable to parse npm version response for "${packageName}".`);
  }

  if (publishedVersion !== localVersion) {
    fail(
      `npm latest (${publishedVersion}) is not fully up to date with local package.json (${localVersion}).`,
      [
        'Publish the current package version before running strict E2E cadence.',
        'Keep npm latest synchronized with release-intended main state.',
      ]
    );
  }

  console.log(`[policy:npm:fresh] ok (${packageName}@${localVersion})`);
}

main();
