#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });

  if (result.status !== 0) {
    const stdout = String(result.stdout ?? '').trim();
    const stderr = String(result.stderr ?? '').trim();
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
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

function parseJson(command, args) {
  const out = run(command, args);
  try {
    return JSON.parse(out);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${command} ${args.join(' ')}\n${out}\n${String(error)}`);
  }
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

function checksOf(pr) {
  return Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
}

function hasPendingChecks(pr) {
  return checksOf(pr).some((check) => String(check?.status ?? '').toLowerCase() !== 'completed');
}

function hasFailedChecks(pr) {
  const failedConclusions = new Set(['failure', 'failed', 'timed_out', 'cancelled', 'action_required', 'error']);
  return checksOf(pr).some((check) => {
    const status = String(check?.status ?? '').toLowerCase();
    const conclusion = String(check?.conclusion ?? '').toLowerCase();
    return status === 'completed' && failedConclusions.has(conclusion);
  });
}

function parseIntOption(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: 'string' },
      prefix: { type: 'string', default: 'codex/' },
      'base-main': { type: 'string', default: 'main' },
      'max-prs': { type: 'string', default: '100' },
      'update-limit': { type: 'string', default: '12' },
      'merge-limit': { type: 'string', default: '6' },
      'include-drafts': { type: 'boolean', default: false },
      'no-update': { type: 'boolean', default: false },
      'no-merge': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: false,
  });

  if (values.help) {
    console.log('Usage: node scripts/gh-pr-stabilize.mjs [--repo owner/name] [--prefix codex/] [--base-main main] [--max-prs 100] [--update-limit 12] [--merge-limit 6] [--include-drafts] [--no-update] [--no-merge] [--dry-run]');
    return;
  }

  const repo = resolveRepo(values.repo);
  const prefix = typeof values.prefix === 'string' ? values.prefix : 'codex/';
  const baseMain = typeof values['base-main'] === 'string' ? values['base-main'] : 'main';
  const maxPrs = parseIntOption(values['max-prs'], 100);
  const updateLimit = parseIntOption(values['update-limit'], 12);
  const mergeLimit = parseIntOption(values['merge-limit'], 6);
  const includeDrafts = Boolean(values['include-drafts']);
  const dryRun = Boolean(values['dry-run']);
  const noUpdate = Boolean(values['no-update']);
  const noMerge = Boolean(values['no-merge']);

  const prs = parseJson('gh', [
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--limit',
    String(maxPrs),
    '--json',
    'number,title,headRefName,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,url',
  ]);

  const tracked = (Array.isArray(prs) ? prs : [])
    .filter((pr) => String(pr?.headRefName ?? '').startsWith(prefix))
    .filter((pr) => includeDrafts || !pr?.isDraft);

  if (tracked.length === 0) {
    console.log(`[gh-pr-stabilize] No open PRs matched prefix "${prefix}".`);
    return;
  }

  const byHead = new Map(tracked.map((pr) => [String(pr.headRefName), pr]));
  const depthMemo = new Map();

  function depthFor(pr, seen = new Set()) {
    if (!pr) return 0;
    if (depthMemo.has(pr.number)) return depthMemo.get(pr.number);
    const base = String(pr.baseRefName ?? '');
    if (!base || base === baseMain) {
      depthMemo.set(pr.number, 0);
      return 0;
    }
    if (seen.has(pr.number)) {
      depthMemo.set(pr.number, 99);
      return 99;
    }
    const parent = byHead.get(base);
    const nextSeen = new Set(seen);
    nextSeen.add(pr.number);
    const depth = parent ? depthFor(parent, nextSeen) + 1 : 1;
    depthMemo.set(pr.number, depth);
    return depth;
  }

  const ranked = [...tracked].sort((a, b) => {
    const depthA = depthFor(a);
    const depthB = depthFor(b);
    if (depthA !== depthB) return depthA - depthB;
    return Number(a.number) - Number(b.number);
  });

  const updateStates = new Set(['UNSTABLE', 'DIRTY', 'BEHIND', 'BLOCKED', 'UNKNOWN', 'HAS_HOOKS']);
  const updateCandidates = ranked
    .filter((pr) => updateStates.has(String(pr.mergeStateStatus ?? '').toUpperCase()))
    .filter((pr) => !hasPendingChecks(pr))
    .slice(0, updateLimit);

  let updated = 0;
  let updateSkipped = 0;
  let updateFailed = 0;

  if (!noUpdate) {
    for (const pr of updateCandidates) {
      const info = `#${pr.number} ${pr.headRefName}->${pr.baseRefName} state=${pr.mergeStateStatus}`;
      if (dryRun) {
        console.log(`[gh-pr-stabilize] Dry run: update-branch ${info}`);
        continue;
      }
      const result = tryRun('gh', ['pr', 'update-branch', String(pr.number), '--repo', repo]);
      if (result.status === 0) {
        console.log(`[gh-pr-stabilize] Updated ${info}`);
        updated += 1;
      } else if (String(result.stderr).includes('already up to date')) {
        console.log(`[gh-pr-stabilize] Skip (already up to date) ${info}`);
        updateSkipped += 1;
      } else {
        console.warn(`[gh-pr-stabilize] Update failed ${info}\n${result.stderr || result.stdout}`);
        updateFailed += 1;
      }
    }
  }

  const mergeCandidates = ranked
    .filter((pr) => String(pr.mergeStateStatus ?? '').toUpperCase() === 'CLEAN')
    .filter((pr) => !hasPendingChecks(pr))
    .filter((pr) => !hasFailedChecks(pr))
    .slice(0, mergeLimit);

  let merged = 0;
  let mergeFailed = 0;

  if (!noMerge) {
    for (const pr of mergeCandidates) {
      const info = `#${pr.number} ${pr.headRefName}->${pr.baseRefName}`;
      if (dryRun) {
        console.log(`[gh-pr-stabilize] Dry run: merge ${info}`);
        continue;
      }
      const result = tryRun('gh', ['pr', 'merge', String(pr.number), '--squash', '--delete-branch', '--repo', repo]);
      if (result.status === 0) {
        console.log(`[gh-pr-stabilize] Merged ${info}`);
        merged += 1;
      } else {
        console.warn(`[gh-pr-stabilize] Merge failed ${info}\n${result.stderr || result.stdout}`);
        mergeFailed += 1;
      }
    }
  }

  console.log(
    `[gh-pr-stabilize] complete repo=${repo} tracked=${tracked.length} ` +
      `updates=${updated}/${updateCandidates.length} update_skipped=${updateSkipped} update_failed=${updateFailed} ` +
      `merged=${merged}/${mergeCandidates.length} merge_failed=${mergeFailed} dry_run=${dryRun}`
  );
}

main();
