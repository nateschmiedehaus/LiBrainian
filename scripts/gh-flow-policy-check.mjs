#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const DEFAULT_MAX_MAIN_BEHIND_PULL = 20;
const DEFAULT_MAX_COMMITS_AHEAD_OF_NPM = 40;

function run(cmd, options = {}) {
  const output = execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  if (typeof output !== 'string') {
    return '';
  }
  return output.trim();
}

function runMaybe(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function fail(message, hints = []) {
  console.error(`[policy] ${message}`);
  for (const hint of hints) {
    console.error(`  - ${hint}`);
  }
  process.exit(1);
}

function info(message) {
  console.log(`[policy] ${message}`);
}

function parseLeftRightCounts(leftRef, rightRef) {
  const out = run(`git rev-list --left-right --count ${leftRef}...${rightRef}`);
  const [leftRaw, rightRaw] = out.split(/\s+/);
  return {
    left: Number.parseInt(leftRaw ?? '0', 10) || 0,
    right: Number.parseInt(rightRaw ?? '0', 10) || 0,
  };
}

function getCurrentBranch() {
  return run('git branch --show-current');
}

function ensureGitRepo() {
  const top = runMaybe('git rev-parse --show-toplevel');
  if (!top) {
    fail('Not inside a git repository.');
  }
  return top;
}

function ensureCleanWorktree(required) {
  if (!required) return;
  const status = run('git status --porcelain');
  if (status.length > 0) {
    fail('Working tree must be clean for this policy check.', [
      'Commit or stash local changes, then retry.',
    ]);
  }
}

function getPackageInfo(repoRoot) {
  const raw = readFileSync(`${repoRoot}/package.json`, 'utf8');
  const pkg = JSON.parse(raw);
  return {
    name: String(pkg.name ?? '').trim(),
    version: String(pkg.version ?? '').trim(),
  };
}

function getPublishedVersion(packageName) {
  const out = runMaybe(`npm view ${packageName} version --json`);
  if (!out) return null;
  try {
    const parsed = JSON.parse(out);
    if (typeof parsed === 'string') return parsed;
    return null;
  } catch {
    return out.replace(/^"|"$/g, '');
  }
}

function commitsSinceTag(tag, ref = 'HEAD') {
  const tagRef = runMaybe(`git rev-parse --verify refs/tags/${tag}`);
  if (!tagRef) return null;
  const out = runMaybe(`git rev-list --count ${tag}..${ref}`);
  if (!out) return null;
  return Number.parseInt(out, 10) || 0;
}

function checkPullMode(maxMainBehind) {
  const branch = getCurrentBranch();
  const upstream = runMaybe('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
  if (!upstream) {
    fail(`Branch "${branch}" has no upstream configured.`, [
      `Run: git push -u origin ${branch}`,
    ]);
  }

  const upstreamDelta = parseLeftRightCounts('HEAD', upstream);
  if (upstreamDelta.right > 0) {
    fail(`Branch "${branch}" is behind upstream by ${upstreamDelta.right} commit(s).`, [
      `Run: git pull --ff-only`,
    ]);
  }

  const mainDelta = parseLeftRightCounts('HEAD', 'origin/main');
  if (mainDelta.right > maxMainBehind) {
    fail(
      `Branch "${branch}" is ${mainDelta.right} commits behind origin/main (limit ${maxMainBehind}).`,
      [
        'Run: git fetch origin main',
        'Run: git rebase origin/main',
      ]
    );
  }

  info(`pull policy passed (behind upstream=${upstreamDelta.right}, behind main=${mainDelta.right}).`);
}

function checkMergeMode(maxCommitsAheadOfNpm, repoRoot) {
  const branch = getCurrentBranch();
  const mainDelta = parseLeftRightCounts('HEAD', 'origin/main');
  if (mainDelta.right > 0) {
    fail(`Branch "${branch}" is behind origin/main by ${mainDelta.right} commit(s).`, [
      'Run: git fetch origin main',
      'Run: git rebase origin/main',
    ]);
  }

  const { name } = getPackageInfo(repoRoot);
  const publishedVersion = getPublishedVersion(name);
  if (!publishedVersion) {
    info('Could not resolve npm published version; skipping package drift gate in merge mode.');
    info('merge policy passed.');
    return;
  }

  const sincePublished = commitsSinceTag(`v${publishedVersion}`, 'origin/main');
  if (sincePublished != null && sincePublished > maxCommitsAheadOfNpm) {
    fail(
      `Main is ${sincePublished} commits ahead of published npm version ${publishedVersion} (limit ${maxCommitsAheadOfNpm}).`,
      [
        'Cut a release before merging more feature PRs.',
        'If this is intentional, raise LIBRARIAN_MAX_COMMITS_AHEAD_OF_NPM for this run.',
      ]
    );
  }

  info(`merge policy passed (behind main=${mainDelta.right}, npm=${publishedVersion}).`);
}

function checkPublishMode(repoRoot) {
  const branch = getCurrentBranch();
  if (branch !== 'main') {
    fail(`Publish is only allowed from main (current: ${branch}).`, [
      'Run: git checkout main',
    ]);
  }

  ensureCleanWorktree(true);

  const delta = parseLeftRightCounts('HEAD', 'origin/main');
  if (delta.left > 0 || delta.right > 0) {
    fail('Local main must match origin/main exactly before publish.', [
      'Run: git pull --ff-only origin main',
      'Ensure no unpublished local commits remain on main.',
    ]);
  }

  const { name, version } = getPackageInfo(repoRoot);
  const publishedVersion = getPublishedVersion(name);
  if (!publishedVersion) {
    fail('Could not resolve npm published version for publish policy.', [
      'Verify npm registry access and retry.',
    ]);
  }

  if (version === publishedVersion) {
    fail(`package.json version (${version}) matches already-published npm version (${publishedVersion}).`, [
      'Bump package version before publish.',
    ]);
  }

  info(`publish policy passed (package=${name}, local=${version}, published=${publishedVersion}).`);
}

function main() {
  const { values } = parseArgs({
    options: {
      mode: {
        type: 'string',
        default: 'pull',
      },
      'skip-fetch': {
        type: 'boolean',
        default: false,
      },
      'require-clean': {
        type: 'boolean',
        default: false,
      },
    },
    strict: true,
    allowPositionals: false,
  });

  const mode = String(values.mode ?? 'pull').trim();
  if (mode !== 'pull' && mode !== 'merge' && mode !== 'publish') {
    fail(`Unsupported mode "${mode}". Use pull|merge|publish.`);
  }

  const repoRoot = ensureGitRepo();
  ensureCleanWorktree(Boolean(values['require-clean']));
  if (!values['skip-fetch']) {
    run('git fetch origin --prune --tags', { stdio: 'ignore' });
  }

  const maxMainBehind = Number.parseInt(
    String(process.env.LIBRARIAN_MAX_MAIN_BEHIND_PULL ?? DEFAULT_MAX_MAIN_BEHIND_PULL),
    10
  ) || DEFAULT_MAX_MAIN_BEHIND_PULL;
  const maxCommitsAheadOfNpm = Number.parseInt(
    String(process.env.LIBRARIAN_MAX_COMMITS_AHEAD_OF_NPM ?? DEFAULT_MAX_COMMITS_AHEAD_OF_NPM),
    10
  ) || DEFAULT_MAX_COMMITS_AHEAD_OF_NPM;

  if (mode === 'pull') {
    checkPullMode(maxMainBehind);
    return;
  }
  if (mode === 'merge') {
    checkMergeMode(maxCommitsAheadOfNpm, repoRoot);
    return;
  }
  checkPublishMode(repoRoot);
}

main();
