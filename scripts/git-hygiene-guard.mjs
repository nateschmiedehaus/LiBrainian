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

  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function requireSuccess(command, args, label) {
  const result = run(command, args);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${label ?? `${command} ${args.join(' ')}`} failed${details ? `\n${details}` : ''}`);
  }
  return result.stdout;
}

function parseCounts(leftRightCounts) {
  const [leftRaw, rightRaw] = String(leftRightCounts ?? '').trim().split(/\s+/);
  return {
    ahead: Number.parseInt(leftRaw ?? '0', 10) || 0,
    behind: Number.parseInt(rightRaw ?? '0', 10) || 0,
  };
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function parseStatusPaths(statusOutput) {
  const lines = String(statusOutput ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const paths = [];
  for (const line of lines) {
    const match = line.match(/^(..)\s+(.+)$/);
    if (!match) continue;
    const path = match[2].replace(/^"|"$/g, '');
    paths.push(path);
  }
  return paths;
}

function checkConflictMarkers(violations) {
  const result = run('git', ['grep', '-nE', '^(<<<<<<< |>>>>>>> )', '--', '.']);
  if (result.status === 0 && result.stdout.length > 0) {
    const sample = result.stdout.split('\n').slice(0, 6).join('\n');
    violations.push(
      `Conflict markers detected in tracked files. Resolve all markers before push.\n${sample}`
    );
  }
}

function checkGeneratedArtifacts(violations) {
  const status = requireSuccess('git', ['status', '--porcelain'], 'git status');
  const suspicious = parseStatusPaths(status)
    .filter((filePath) => (
      (filePath.startsWith('src/') || filePath.startsWith('test/') || filePath.startsWith('tests/'))
      && (filePath.endsWith('.js') || filePath.endsWith('.d.ts') || filePath.endsWith('.map'))
    ));
  if (suspicious.length > 0) {
    const sample = suspicious.slice(0, 12).join(', ');
    violations.push(
      `Untracked/generated JS artifacts detected in source/test trees: ${sample}`
    );
  }
}

function checkBranchSync(branch, maxBehindMain, violations, warnings) {
  const hasOriginMain = run('git', ['rev-parse', '--verify', '--quiet', 'origin/main']);
  if (hasOriginMain.status !== 0) {
    warnings.push('origin/main is unavailable locally. Run `git fetch origin --prune`.');
    return;
  }

  const hasLocalMain = run('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main']);
  if (hasLocalMain.status === 0) {
    const localMainDelta = parseCounts(requireSuccess(
      'git',
      ['rev-list', '--left-right', '--count', 'main...origin/main'],
      'compute local main vs origin/main'
    ));
    if (localMainDelta.behind > 0) {
      warnings.push(
        `Local main is behind origin/main by ${localMainDelta.behind} commit(s). Run \`git fetch origin --prune && git checkout main && git pull --ff-only origin main\`.`
      );
    }
    if (localMainDelta.ahead > 0) {
      warnings.push(
        `Local main is ahead of origin/main by ${localMainDelta.ahead} commit(s). Consider publishing or reconciling local-only commits.`
      );
    }
  } else {
    warnings.push('Local main branch is missing. Run `git checkout -b main origin/main`.');
  }

  const mainDelta = parseCounts(requireSuccess(
    'git',
    ['rev-list', '--left-right', '--count', `HEAD...origin/main`],
    'compute HEAD vs origin/main'
  ));

  if (branch !== 'main' && mainDelta.behind > maxBehindMain) {
    violations.push(
      `Branch "${branch}" is behind origin/main by ${mainDelta.behind} commit(s). Merge or rebase main before pushing.`
    );
  }

  const upstreamRef = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstreamRef.status === 0 && upstreamRef.stdout.length > 0) {
    const upstreamDelta = parseCounts(requireSuccess(
      'git',
      ['rev-list', '--left-right', '--count', `HEAD...${upstreamRef.stdout}`],
      'compute HEAD vs upstream'
    ));
    if (upstreamDelta.behind > 0) {
      violations.push(
        `Branch "${branch}" is behind upstream (${upstreamRef.stdout}) by ${upstreamDelta.behind} commit(s). Pull/update before pushing.`
      );
    }
  } else {
    warnings.push(`Branch "${branch}" has no upstream configured.`);
  }
}

function ghAvailable() {
  const gh = run('gh', ['--version']);
  if (gh.status !== 0) return false;
  const auth = run('gh', ['auth', 'status', '-h', 'github.com']);
  return auth.status === 0;
}

function checkOpenPrState(branch, requireIssueLink, violations, warnings) {
  if (!ghAvailable()) {
    warnings.push('gh CLI is unavailable or unauthenticated; skipped PR merge-state checks.');
    return;
  }

  const prsRaw = requireSuccess(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,mergeStateStatus,baseRefName,title,url'],
    'list open PRs for branch'
  );
  const prs = JSON.parse(prsRaw);
  if (!Array.isArray(prs) || prs.length === 0) {
    warnings.push(`No open PR found for branch "${branch}".`);
    return;
  }

  const severeStates = new Set(['DIRTY', 'BEHIND', 'BLOCKED', 'UNKNOWN']);
  for (const pr of prs) {
    const number = Number(pr?.number ?? 0);
    const mergeStateStatus = String(pr?.mergeStateStatus ?? '').toUpperCase();
    const baseRef = String(pr?.baseRefName ?? '');
    if (baseRef !== 'main') continue;

    if (severeStates.has(mergeStateStatus)) {
      violations.push(
        `PR #${number} is in merge state ${mergeStateStatus}. Re-sync branch with main before push/merge.`
      );
      continue;
    }

    if (mergeStateStatus === 'UNSTABLE') {
      warnings.push(`PR #${number} is UNSTABLE (usually pending/failing checks).`);
    }

    if (requireIssueLink) {
      const viewRaw = requireSuccess(
        'gh',
        ['pr', 'view', String(number), '--json', 'body'],
        `read PR #${number} body`
      );
      const view = JSON.parse(viewRaw);
      const body = String(view?.body ?? '');
      if (!/\b(fixes|fixed|closes|closed|resolves|resolved)\s+#\d+\b/i.test(body)) {
        violations.push(
          `PR #${number} is missing an issue-closing keyword (e.g. "Fixes #123").`
        );
      }
    }
  }
}

function printSummary({ mode, branch, violations, warnings }) {
  console.log(`[hygiene] mode=${mode} branch=${branch}`);
  for (const warning of warnings) {
    console.warn(`[hygiene] warning: ${warning}`);
  }
  for (const violation of violations) {
    console.error(`[hygiene] violation: ${violation}`);
  }
  console.log(`[hygiene] warnings=${warnings.length} violations=${violations.length}`);
}

function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'warn' },
      fetch: { type: 'boolean', default: false },
      'max-behind-main': { type: 'string', default: '0' },
      'check-pr': { type: 'boolean', default: true },
      'require-issue-link': { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  const mode = String(values.mode ?? 'warn').trim().toLowerCase();
  if (mode !== 'warn' && mode !== 'enforce') {
    throw new Error(`Unsupported mode "${mode}". Use warn|enforce.`);
  }

  requireSuccess('git', ['rev-parse', '--show-toplevel'], 'detect git repository');
  if (values.fetch) {
    requireSuccess('git', ['fetch', 'origin', '--prune', '--tags'], 'git fetch');
  }

  const branch = requireSuccess('git', ['branch', '--show-current'], 'resolve current branch');
  const maxBehindMain = Math.max(
    0,
    Number.parseInt(String(values['max-behind-main'] ?? '0'), 10) || 0
  );

  const violations = [];
  const warnings = [];

  checkConflictMarkers(violations);
  checkGeneratedArtifacts(violations);
  checkBranchSync(branch, maxBehindMain, violations, warnings);
  if (parseBoolean(values['check-pr'], true)) {
    checkOpenPrState(
      branch,
      parseBoolean(values['require-issue-link'], false),
      violations,
      warnings
    );
  }

  printSummary({ mode, branch, violations, warnings });

  if (mode === 'enforce' && violations.length > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`[hygiene] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
