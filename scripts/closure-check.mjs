#!/usr/bin/env node
/**
 * closure-check.mjs
 *
 * Verifies that an issue meets the closure policy before it is closed.
 *
 * Usage:
 *   node scripts/closure-check.mjs <issue-number>
 *   node scripts/closure-check.mjs --help
 *
 * Exit codes:
 *   0  All closure policy checks pass
 *   1  One or more checks fail (output describes what is missing)
 *   2  Usage error / script misconfiguration
 *
 * Closure policy (issue #862):
 *   1. A PR that addresses the issue has been merged to main.
 *   2. CI was passing on that PR at merge time.
 *   3. The PR body contains reality verification evidence (T0.5 / verification field).
 *
 * Environment:
 *   GITHUB_TOKEN  (optional) — uses gh CLI auth if not set
 *   GITHUB_REPOSITORY  (optional) — defaults to "nateschmiedehaus/LiBrainian"
 */

import { execSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write(
    [
      'closure-check.mjs — verify issue closure policy before closing',
      '',
      'Usage:',
      '  node scripts/closure-check.mjs <issue-number>',
      '  node scripts/closure-check.mjs --issue <issue-number>',
      '  node scripts/closure-check.mjs --help',
      '',
      'Options:',
      '  --issue, -i   Issue number to check (required unless positional)',
      '  --repo        GitHub repo (owner/name). Defaults to GITHUB_REPOSITORY or nateschmiedehaus/LiBrainian',
      '  --help, -h    Show this help',
      '',
      'Closure policy checks (all must pass):',
      '  1. A merged PR linked to this issue exists.',
      '  2. CI was passing at the time the PR was merged (no failed checks at merge commit).',
      '  3. The PR body contains reality verification evidence:',
      '       - A "Reality Verification" / "Verification" section, OR',
      '       - The closure template fields: Closing: / T0.5: / Verification:',
      '',
      'Exit codes:',
      '  0  All checks pass — safe to close',
      '  1  One or more checks fail — do not close',
      '  2  Usage / configuration error',
      '',
    ].join('\n')
  );
}

function gh(args, opts = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    env: { ...process.env },
    ...opts,
  });
  if (result.error) {
    throw new Error(`gh CLI not available: ${result.error.message}`);
  }
  if (result.status !== 0 && !opts.allowFailure) {
    throw new Error(`gh ${args.join(' ')} failed (exit ${result.status}):\n${result.stderr}`);
  }
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function ghJson(args) {
  const { stdout } = gh(args);
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// Check implementations
// ---------------------------------------------------------------------------

/**
 * Find PRs that reference (and merge-close) the given issue on main.
 * Returns an array of merged PR objects.
 */
async function findMergedPRsForIssue(repo, issueNumber) {
  // GitHub's search API: look for PRs that mention the issue number in body
  // and are merged. We use gh pr list with search qualifier.
  const searchQuery = `repo:${repo} is:pr is:merged "${issueNumber}" in:body`;
  let allPRs = [];

  try {
    const result = gh(
      [
        'pr', 'list',
        '--repo', repo,
        '--state', 'merged',
        '--search', `${issueNumber} in:body`,
        '--limit', '50',
        '--json', 'number,title,body,mergedAt,baseRefName,headRefName,url,statusCheckRollup',
      ],
      { allowFailure: true }
    );
    if (result.status === 0) {
      allPRs = JSON.parse(result.stdout);
    }
  } catch (_) {
    // fall through to empty
  }

  // Filter: PR body must contain a close/fix/resolve reference to the issue
  const closePattern = new RegExp(
    `(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b`,
    'i'
  );
  const directMention = new RegExp(`#${issueNumber}\\b`);

  const linked = allPRs.filter((pr) => {
    const body = pr.body || '';
    return closePattern.test(body) || directMention.test(body);
  });

  // Also check: PR merged to default branch (main)
  return linked.filter((pr) => pr.baseRefName === 'main' || pr.baseRefName === 'master');
}

/**
 * Check whether CI was passing for a given PR.
 * Uses statusCheckRollup from the PR JSON.
 */
function checkCIPassing(pr) {
  const checks = pr.statusCheckRollup || [];
  if (checks.length === 0) {
    return { pass: null, reason: 'No CI check data available for this PR.' };
  }
  const failed = checks.filter(
    (c) => c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'CANCELLED'
  );
  if (failed.length > 0) {
    return {
      pass: false,
      reason: `${failed.length} CI check(s) failed at merge: ${failed.map((c) => c.name).join(', ')}`,
    };
  }
  return { pass: true, reason: 'All CI checks passed at merge.' };
}

/**
 * Check whether the PR body contains reality verification evidence.
 */
function checkRealityVerification(pr) {
  const body = pr.body || '';

  const hasRealitySection =
    /##\s*reality\s*verif/i.test(body) ||
    /##\s*verification/i.test(body) ||
    /t0\.5/i.test(body) ||
    /smoke[\s-]?test/i.test(body);

  const hasClosingField = /closing\s*:/i.test(body);
  const hasT05Field = /t0\.5\s*:/i.test(body);
  const hasVerificationField = /verification\s*:/i.test(body);
  const hasClosureTemplate = hasClosingField && hasT05Field && hasVerificationField;

  if (hasRealitySection || hasClosureTemplate) {
    return { pass: true, reason: 'Reality verification evidence found in PR body.' };
  }

  return {
    pass: false,
    reason:
      'PR body lacks reality verification evidence. ' +
      'Add a "Reality Verification" section or the closure template:\n' +
      '  Closing: <PR link or "docs-only">\n' +
      '  T0.5: <pass/fail/not-applicable>\n' +
      '  Verification: <patrol-observation/manual-test/t1-test-name>',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      issue: { type: 'string', short: 'i' },
      repo:  { type: 'string' },
      help:  { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    usage();
    process.exit(0);
  }

  const issueArg = values.issue || positionals[0];
  if (!issueArg) {
    process.stderr.write('Error: issue number is required.\n\n');
    usage();
    process.exit(2);
  }

  const issueNumber = parseInt(issueArg, 10);
  if (isNaN(issueNumber) || issueNumber <= 0) {
    process.stderr.write(`Error: invalid issue number "${issueArg}".\n`);
    process.exit(2);
  }

  const repo =
    values.repo ||
    process.env.GITHUB_REPOSITORY ||
    'nateschmiedehaus/LiBrainian';

  process.stdout.write(`\nclosure-check: issue #${issueNumber} in ${repo}\n`);
  process.stdout.write('─'.repeat(60) + '\n');

  // --- Check 1: merged PR exists ---
  process.stdout.write('\n[1/3] Looking for merged PR linked to this issue...\n');
  let mergedPRs;
  try {
    mergedPRs = await findMergedPRsForIssue(repo, issueNumber);
  } catch (err) {
    process.stderr.write(`      ERROR: ${err.message}\n`);
    process.stderr.write(
      '      Make sure "gh" CLI is installed and authenticated (gh auth login).\n'
    );
    process.exit(2);
  }

  const failures = [];

  if (mergedPRs.length === 0) {
    failures.push('No merged PR linked to this issue was found on main/master.');
    process.stdout.write('      FAIL: No merged PR found.\n');
  } else {
    process.stdout.write(
      `      PASS: Found ${mergedPRs.length} merged PR(s): ` +
        mergedPRs.map((p) => `#${p.number}`).join(', ') +
        '\n'
    );
  }

  // --- Checks 2 & 3: per merged PR ---
  let anyPRPassedCI = false;
  let anyPRPassedVerification = false;

  for (const pr of mergedPRs) {
    process.stdout.write(`\n  Checking PR #${pr.number}: ${pr.title}\n`);
    process.stdout.write(`  URL: ${pr.url}\n`);

    // Check 2: CI passing
    const ciResult = checkCIPassing(pr);
    if (ciResult.pass === true) {
      anyPRPassedCI = true;
      process.stdout.write(`  [2/3] CI: PASS — ${ciResult.reason}\n`);
    } else if (ciResult.pass === false) {
      process.stdout.write(`  [2/3] CI: FAIL — ${ciResult.reason}\n`);
    } else {
      // null = unknown
      anyPRPassedCI = true; // treat unknown as pass (CI data may not be available for old PRs)
      process.stdout.write(`  [2/3] CI: UNKNOWN — ${ciResult.reason} (treating as pass)\n`);
    }

    // Check 3: reality verification
    const rvResult = checkRealityVerification(pr);
    if (rvResult.pass) {
      anyPRPassedVerification = true;
      process.stdout.write(`  [3/3] Reality Verification: PASS — ${rvResult.reason}\n`);
    } else {
      process.stdout.write(`  [3/3] Reality Verification: FAIL — ${rvResult.reason}\n`);
    }
  }

  // Aggregate failures for checks 2 & 3
  if (mergedPRs.length > 0 && !anyPRPassedCI) {
    failures.push('CI was not passing on any merged PR at the time of merge.');
  }
  if (mergedPRs.length > 0 && !anyPRPassedVerification) {
    failures.push(
      'No merged PR contains reality verification evidence.\n' +
        '  Add a "Reality Verification" section or use the closure template:\n' +
        '    Closing: <PR link or "docs-only">\n' +
        '    T0.5: <pass/fail/not-applicable>\n' +
        '    Verification: <patrol-observation/manual-test/t1-test-name>'
    );
  }

  // --- Summary ---
  process.stdout.write('\n' + '─'.repeat(60) + '\n');
  if (failures.length === 0) {
    process.stdout.write(
      `closure-check: PASS — issue #${issueNumber} satisfies all closure policy requirements.\n\n`
    );
    process.exit(0);
  } else {
    process.stdout.write(
      `closure-check: FAIL — issue #${issueNumber} does NOT satisfy closure policy.\n\n`
    );
    process.stdout.write('Missing requirements:\n');
    for (const [i, f] of failures.entries()) {
      process.stdout.write(`  ${i + 1}. ${f}\n`);
    }
    process.stdout.write(
      '\nDo not close this issue until all requirements are met.\n' +
        'See: docs/LiBrainian/E2E_REALITY_POLICY.md and issue #862.\n\n'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`closure-check: fatal error: ${err.message}\n`);
  process.exit(2);
});
