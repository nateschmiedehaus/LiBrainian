#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

function run(command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function fail(message, details = []) {
  console.error(`[policy:e2e:mainline] ${message}`);
  for (const detail of details) {
    console.error(`  - ${detail}`);
  }
  process.exit(1);
}

function listRemoteBranches(prefix) {
  const output = run(`git for-each-ref --format=%(refname:short) refs/remotes/origin/${prefix}*`);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^origin\//, ''));
}

function isAncestor(ancestorRef, descendantRef) {
  try {
    execSync(`git merge-base --is-ancestor ${ancestorRef} ${descendantRef}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'main' },
      prefix: { type: 'string', default: 'codex/' },
      'skip-fetch': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const baseBranch = String(values.base ?? 'main').trim() || 'main';
  const prefix = String(values.prefix ?? 'codex/');
  const skipFetch = Boolean(values['skip-fetch']);

  if (!skipFetch) {
    run('git fetch origin --prune');
  }

  const currentBranch = run('git branch --show-current');
  if (currentBranch !== baseBranch) {
    fail(`Authoritative E2E must run from ${baseBranch} (current: ${currentBranch}).`, [
      `Run: git checkout ${baseBranch}`,
      `Run: git pull --ff-only origin ${baseBranch}`,
    ]);
  }

  const aheadBehind = run(`git rev-list --left-right --count HEAD...origin/${baseBranch}`);
  const [aheadRaw, behindRaw] = aheadBehind.split(/\s+/);
  const ahead = Number.parseInt(aheadRaw ?? '0', 10) || 0;
  const behind = Number.parseInt(behindRaw ?? '0', 10) || 0;
  if (ahead !== 0 || behind !== 0) {
    fail(`Local ${baseBranch} must match origin/${baseBranch} before E2E.`, [
      `ahead=${ahead}`,
      `behind=${behind}`,
      `Run: git pull --ff-only origin ${baseBranch}`,
    ]);
  }

  const remoteBranches = listRemoteBranches(prefix);
  const unmerged = remoteBranches.filter((branch) => !isAncestor(`origin/${branch}`, `origin/${baseBranch}`));
  if (unmerged.length > 0) {
    fail(`Unmerged developmental branches remain for prefix "${prefix}".`, [
      ...unmerged.map((branch) => `unmerged: ${branch}`),
      'Merge/close these branches before authoritative developmental-truth E2E.',
    ]);
  }

  console.log(
    `[policy:e2e:mainline] passed (base=${baseBranch}, checked_prefix=${prefix}, branches_checked=${remoteBranches.length})`
  );
}

main();
