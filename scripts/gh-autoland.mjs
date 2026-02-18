#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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

function parseJson(command, args) {
  const output = run(command, args);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`Failed to parse JSON from: ${command} ${args.join(' ')}\n${output}\n${String(error)}`);
  }
}

function parsePrNumberFromUrl(url) {
  const match = String(url).trim().match(/\/pull\/(\d+)(?:\/|$)/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function getCurrentBranch() {
  return run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function sleepSeconds(seconds) {
  spawnSync('sleep', [String(seconds)], { stdio: 'ignore' });
}

function summarizeFailingChecks(checks) {
  const failures = [];
  for (const check of checks) {
    const name = check.name ?? check.context ?? 'unknown-check';
    const url = check.detailsUrl ?? check.targetUrl ?? '';
    const status = String(check.status ?? '').toLowerCase();
    const conclusion = String(check.conclusion ?? check.state ?? '').toLowerCase();
    const completed = status === 'completed' || status === 'complete' || status === 'success' || status === 'failure' || status === 'error';
    const failedConclusions = new Set(['failure', 'failed', 'timed_out', 'cancelled', 'action_required', 'error']);
    if (completed && failedConclusions.has(conclusion)) {
      failures.push({ name, url, conclusion });
    }
  }
  return failures;
}

function canFallbackFromAutoMergeError(message) {
  const normalized = String(message).toLowerCase();
  return normalized.includes('enablepullrequestautomerge')
    || normalized.includes('auto merge')
    || normalized.includes('auto-merge')
    || normalized.includes('protected branch rules not configured');
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: 'string', default: 'main' },
      title: { type: 'string' },
      'body-file': { type: 'string' },
      'no-watch': { type: 'boolean', default: false },
      'watch-timeout-minutes': { type: 'string', default: '45' },
      'preflight-npm-script': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: false,
  });

  if (values.help) {
    console.log('Usage: node scripts/gh-autoland.mjs [--base main] [--title "..."] [--body-file path] [--preflight-npm-script validate:fast] [--no-watch]');
    return;
  }

  const watchTimeoutMinutes = Number.parseInt(String(values['watch-timeout-minutes'] ?? '45'), 10);
  if (!Number.isFinite(watchTimeoutMinutes) || watchTimeoutMinutes <= 0) {
    throw new Error(`Invalid --watch-timeout-minutes value: ${String(values['watch-timeout-minutes'])}`);
  }

  run('gh', ['auth', 'status']);

  if (typeof values['preflight-npm-script'] === 'string' && values['preflight-npm-script'].trim().length > 0) {
    run('npm', ['run', values['preflight-npm-script'].trim()], { stdio: 'inherit' });
  }

  const branch = getCurrentBranch();
  if (branch === 'main' || branch === 'master') {
    throw new Error(`Refusing to autoland from protected branch: ${branch}`);
  }

  const dirtyCount = Number.parseInt(run('bash', ['-lc', 'git status --porcelain | wc -l']), 10);
  if (Number.isFinite(dirtyCount) && dirtyCount > 0) {
    console.warn(`[gh:autoland] Warning: working tree has ${dirtyCount} uncommitted change(s). Continuing with remote PR operations.`);
  }

  run('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' });

  const existingPrs = parseJson('gh', [
    'pr', 'list',
    '--state', 'open',
    '--head', branch,
    '--json', 'number,url,title',
  ]);

  const baseBranch = typeof values.base === 'string' && values.base.trim().length > 0 ? values.base.trim() : 'main';
  let prNumber;
  let prUrl;

  if (Array.isArray(existingPrs) && existingPrs.length > 0) {
    prNumber = existingPrs[0].number;
    prUrl = existingPrs[0].url;
    console.log(`[gh:autoland] Reusing open PR #${prNumber}: ${prUrl}`);
  } else {
    const title = typeof values.title === 'string' && values.title.trim().length > 0
      ? values.title.trim()
      : run('git', ['log', '-1', '--pretty=%s']);
    const body = typeof values['body-file'] === 'string' && values['body-file'].trim().length > 0
      ? readFileSync(values['body-file'].trim(), 'utf8')
      : [
          'Automated PR opened by `npm run gh:autoland`.',
          '',
          '- Enables squash auto-merge',
          '- Watches checks and reports failure details',
        ].join('\n');

    prUrl = run('gh', [
      'pr', 'create',
      '--base', baseBranch,
      '--head', branch,
      '--title', title,
      '--body', body,
    ]);
    prNumber = parsePrNumberFromUrl(prUrl);
    if (!prNumber) {
      const prView = parseJson('gh', ['pr', 'view', '--json', 'number,url']);
      prNumber = prView.number;
      prUrl = prView.url;
    }
    console.log(`[gh:autoland] Created PR #${prNumber}: ${prUrl}`);
  }

  let autoMergeEnabled = false;
  try {
    run('gh', ['pr', 'merge', String(prNumber), '--squash', '--auto']);
    autoMergeEnabled = true;
    console.log(`[gh:autoland] Auto-merge enabled for PR #${prNumber}`);
  } catch (error) {
    const message = String(error);
    if (!canFallbackFromAutoMergeError(message)) {
      throw error;
    }
    console.warn('[gh:autoland] Auto-merge not available in repository settings. Falling back to wait-then-merge mode.');
  }

  if (values['no-watch']) {
    if (!autoMergeEnabled) {
      run('gh', ['pr', 'merge', String(prNumber), '--squash']);
      console.log(`[gh:autoland] PR #${prNumber} merged with squash.`);
      return;
    }
    console.log(`[gh:autoland] Not watching checks. Track progress at: ${prUrl}`);
    return;
  }

  const deadlineMs = Date.now() + watchTimeoutMinutes * 60_000;
  while (Date.now() < deadlineMs) {
    const pr = parseJson('gh', [
      'pr', 'view', String(prNumber),
      '--json', 'state,mergeStateStatus,statusCheckRollup,url',
    ]);

    if (pr.state === 'MERGED') {
      console.log(`[gh:autoland] PR #${prNumber} merged successfully.`);
      console.log(pr.url);
      return;
    }

    if (pr.state === 'CLOSED') {
      throw new Error(`PR #${prNumber} closed without merge: ${pr.url}`);
    }

    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    const failures = summarizeFailingChecks(checks);
    if (failures.length > 0) {
      const lines = failures.map((check) => `- ${check.name} (${check.conclusion}) ${check.url}`.trim());
      throw new Error(`PR #${prNumber} has failing checks:\n${lines.join('\n')}`);
    }

    const pending = checks.filter((check) => String(check.status ?? '').toLowerCase() !== 'completed');
    const mergeState = String(pr.mergeStateStatus ?? 'unknown');
    if (!autoMergeEnabled && pending.length === 0) {
      run('gh', ['pr', 'merge', String(prNumber), '--squash']);
      console.log(`[gh:autoland] PR #${prNumber} merged with squash.`);
      console.log(pr.url);
      return;
    }
    console.log(`[gh:autoland] Waiting... mergeState=${mergeState} pendingChecks=${pending.length} url=${pr.url}`);
    sleepSeconds(15);
  }

  throw new Error(`Timed out waiting for PR checks/merge after ${watchTimeoutMinutes} minutes.`);
}

main();
