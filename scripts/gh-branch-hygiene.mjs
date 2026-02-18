#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    const output = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return String(result.stdout ?? '').trim();
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function parseRepoFromRemoteUrl(remoteUrl) {
  const trimmed = String(remoteUrl ?? '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match?.[1] ?? null;
}

function resolveRepo(defaultRepo) {
  if (typeof defaultRepo === 'string' && defaultRepo.trim().length > 0) {
    return defaultRepo.trim();
  }
  const remote = run('git', ['remote', 'get-url', 'origin']);
  const parsed = parseRepoFromRemoteUrl(remote);
  if (!parsed) {
    throw new Error('Unable to infer GitHub repo from git remote. Pass --repo owner/name.');
  }
  return parsed;
}

function isAncestor(ancestorRef, descendantRef) {
  const result = tryRun('git', ['merge-base', '--is-ancestor', ancestorRef, descendantRef]);
  return result.status === 0;
}

function localBranchExists(branchName) {
  return tryRun('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]).status === 0;
}

async function fetchBranchPr(repo, branch) {
  const owner = repo.split('/')[0];
  const head = `${owner}:${branch}`;
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&head=${encodeURIComponent(head)}&per_page=10`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'librainian-gh-branch-hygiene',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}) for ${branch}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) return null;
  return payload[0];
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: 'string' },
      base: { type: 'string', default: 'main' },
      prefix: { type: 'string', default: 'codex/' },
      'dry-run': { type: 'boolean', default: false },
      'include-closed-unmerged': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: false,
  });

  if (values.help) {
    console.log('Usage: node scripts/gh-branch-hygiene.mjs [--repo owner/name] [--base main] [--prefix codex/] [--dry-run] [--include-closed-unmerged]');
    return;
  }

  const repo = resolveRepo(values.repo);
  const baseBranch = typeof values.base === 'string' && values.base.trim().length > 0 ? values.base.trim() : 'main';
  const prefix = typeof values.prefix === 'string' ? values.prefix : 'codex/';
  const includeClosedUnmerged = Boolean(values['include-closed-unmerged']);
  const dryRun = Boolean(values['dry-run']);

  run('git', ['fetch', 'origin', '--prune'], { stdio: 'inherit' });
  const remoteBranches = run('git', ['for-each-ref', '--format=%(refname:short)', `refs/remotes/origin/${prefix}*`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((ref) => ref.replace(/^origin\//, ''));

  if (remoteBranches.length === 0) {
    console.log(`[gh-branch-hygiene] No remote branches found for prefix "${prefix}".`);
    return;
  }

  const currentBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const baseRef = `origin/${baseBranch}`;

  let deletedRemote = 0;
  let deletedLocal = 0;
  let skipped = 0;

  for (const branch of remoteBranches) {
    const remoteRef = `origin/${branch}`;
    const mergedIntoBase = isAncestor(remoteRef, baseRef);
    let pr = null;
    try {
      pr = await fetchBranchPr(repo, branch);
    } catch (error) {
      console.warn(`[gh-branch-hygiene] Skipping ${branch}: ${(error instanceof Error ? error.message : String(error))}`);
      skipped += 1;
      continue;
    }

    const mergedPr = Boolean(pr?.merged_at);
    const closedUnmergedPr = pr?.state === 'closed' && !mergedPr;
    const canDeleteByPolicy = mergedPr || (includeClosedUnmerged && closedUnmergedPr && mergedIntoBase);

    if (!canDeleteByPolicy) {
      const reason = pr
        ? `pr_state=${pr.state} merged_at=${pr.merged_at ?? 'null'} merged_into_${baseBranch}=${mergedIntoBase}`
        : 'no_pr_found';
      console.log(`[gh-branch-hygiene] Keep ${branch} (${reason})`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[gh-branch-hygiene] Dry run: delete remote ${branch}`);
    } else {
      run('git', ['push', 'origin', '--delete', branch], { stdio: 'inherit' });
      deletedRemote += 1;
    }

    if (localBranchExists(branch) && branch !== currentBranch && isAncestor(branch, baseRef)) {
      if (dryRun) {
        console.log(`[gh-branch-hygiene] Dry run: delete local ${branch}`);
      } else {
        run('git', ['branch', '-d', branch], { stdio: 'inherit' });
        deletedLocal += 1;
      }
    }
  }

  console.log(`[gh-branch-hygiene] complete repo=${repo} prefix=${prefix} deleted_remote=${deletedRemote} deleted_local=${deletedLocal} skipped=${skipped} dry_run=${dryRun}`);
}

main();
