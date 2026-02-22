#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

async function loadValidator() {
  try {
    const mod = await import('../dist/evidence/conversation_checkpoint_validation.js');
    return mod.validateConversationCheckpoint;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load dist build (${message}). Run: npm run build`);
  }
}

function gitResult(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return null;
  }

  const text = String(result.stdout ?? '').trim();
  if (!text) return null;
  const [sha, ...rest] = text.split('\n');
  const date = rest.join('\n');
  if (!sha || !/^[0-9a-f]{6,40}$/i.test(sha.trim())) return null;
  return {
    sha: sha.trim(),
    date: date.trim() || null,
  };
}

function resolveLatestReconcileCommit(root, gatesPath) {
  const gatesRelativePath = path.relative(root, gatesPath);
  const grepCommit = gitResult(root, [
    'log',
    '--pretty=%H%n%cI',
    '-n',
    '1',
    '--grep',
    'evidence:reconcile',
    '--',
    gatesRelativePath,
  ]);
  if (grepCommit) return grepCommit;

  return gitResult(root, [
    'log',
    '--pretty=%H%n%cI',
    '-n',
    '1',
    '--',
    gatesRelativePath,
  ]);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      workspace: { type: 'string' },
      gates: { type: 'string' },
      'conversation-insights': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const validateConversationCheckpoint = await loadValidator();
  const workspace = path.resolve(values.workspace ?? process.cwd());
  const gatesPath = values.gates
    ? path.resolve(values.gates)
    : path.join(workspace, 'docs', 'librarian', 'GATES.json');
  const insightsPath = values['conversation-insights']
    ? path.resolve(values['conversation-insights'])
    : path.join(workspace, 'docs', 'librarian', 'CONVERSATION_INSIGHTS.md');

  const reconcileCommit = resolveLatestReconcileCommit(workspace, gatesPath);
  if (!reconcileCommit) {
    process.stderr.write('[validate-checkpoint] failed (no-recent-reconcile-commit)\n');
    process.stderr.write('Remediation: run `npm run evidence:reconcile` and commit updated gates before validating checkpoints.\n');
    process.exitCode = 1;
    return;
  }

  const [gatesRaw, insightRaw] = await Promise.all([
    readFile(gatesPath, 'utf8'),
    readFile(insightsPath, 'utf8'),
  ]);
  const gatesJson = JSON.parse(gatesRaw);
  const report = validateConversationCheckpoint({
    conversationInsightsMarkdown: insightRaw,
    gatesJson,
    latestReconcileSha: reconcileCommit.sha,
    latestReconcileDate: reconcileCommit.date,
  });

  if (!report.ok) {
    process.stderr.write(`[validate-checkpoint] failed (${report.failures.length} issue${report.failures.length === 1 ? '' : 's'})\n`);
    for (const failure of report.failures) {
      process.stderr.write(`- [${failure.code}] ${failure.message}\n`);
    }
    process.stderr.write('Remediation: run `npm run evidence:reconcile` and update the latest CONVERSATION_INSIGHTS checkpoint.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write('[validate-checkpoint] ok (latest checkpoint aligns with evidence reconciliation state)\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[validate-checkpoint] fatal: ${message}\n`);
  process.exitCode = 1;
});
