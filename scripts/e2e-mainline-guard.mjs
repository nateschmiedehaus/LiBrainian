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

function parseRepoFromRemoteUrl(remoteUrl) {
  const trimmed = String(remoteUrl ?? '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match?.[1] ?? null;
}

function resolveRepo() {
  const remote = run('git remote get-url origin');
  const parsed = parseRepoFromRemoteUrl(remote);
  if (!parsed) {
    fail('Unable to infer GitHub repository from origin remote URL.');
  }
  return parsed;
}

async function fetchBranchPr(repo, branch) {
  const owner = repo.split('/')[0];
  const head = `${owner}:${branch}`;
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&head=${encodeURIComponent(head)}&per_page=10`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'librainian-e2e-mainline-guard',
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) return null;
  return payload[0];
}

function listRemoteBranches(prefix) {
  const output = run(`git for-each-ref --format='%(refname:short)' refs/remotes/origin/${prefix}*`);
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

async function main() {
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
  const repo = resolveRepo();
  const activeUnmerged = [];
  const staleUnmerged = [];
  const unresolved = [];
  for (const branch of remoteBranches) {
    if (isAncestor(`origin/${branch}`, `origin/${baseBranch}`)) {
      continue;
    }
    try {
      const pr = await fetchBranchPr(repo, branch);
      if (pr?.state === 'open') {
        activeUnmerged.push(branch);
      } else {
        const reason = pr ? `pr_state=${pr.state} merged_at=${pr.merged_at ?? 'null'}` : 'no_pr_found';
        staleUnmerged.push(`${branch} (${reason})`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      unresolved.push(`${branch} (${reason})`);
    }
  }

  if (activeUnmerged.length > 0 || unresolved.length > 0) {
    fail(`Unmerged developmental branches remain for prefix "${prefix}".`, [
      ...activeUnmerged.map((branch) => `active_unmerged: ${branch}`),
      ...unresolved.map((branch) => `unresolved_state: ${branch}`),
      'Merge/close active branches before authoritative developmental-truth E2E.',
    ]);
  }

  if (staleUnmerged.length > 0) {
    console.warn(`[policy:e2e:mainline] Non-blocking stale branch debt detected (${staleUnmerged.length}).`);
    for (const branch of staleUnmerged) {
      console.warn(`  - stale_unmerged: ${branch}`);
    }
    console.warn('  - Run `npm run gh:branches:cleanup` after any needed archival/cherry-picks.');
  }

  console.log(
    `[policy:e2e:mainline] passed (base=${baseBranch}, checked_prefix=${prefix}, branches_checked=${remoteBranches.length})`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail('Unexpected guard failure.', [message]);
});
