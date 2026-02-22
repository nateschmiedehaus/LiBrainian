#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_PRECOMMIT_BUDGET_MS = 45_000;
const REPORT_KIND = 'PrecommitSelfHostingBudgetReport.v1';
const SOFT_FAILURE_REASONS = [
  'Librarian not bootstrapped',
  'LiBrainian not bootstrapped',
  'No valid files to index',
  'No files specified',
  'ProviderUnavailable',
  'spawn tsx ENOENT',
  'llm_adapter_unavailable',
  'Default LLM service factory not registered',
  'no such column: cost_usd',
];

function parseInteger(input, fallback) {
  if (typeof input !== 'string' || input.trim().length === 0) return fallback;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(input, fallback) {
  if (typeof input !== 'string') return fallback;
  const normalized = input.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

export function runWithCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

export function printBufferedOutput(output) {
  if (output.stdout.trim().length > 0) process.stdout.write(output.stdout);
  if (output.stderr.trim().length > 0) process.stderr.write(output.stderr);
}

function resolveUpdateInvocation(env, stagedFiles) {
  const overrideRaw = env.LIBRARIAN_HOOK_UPDATE_CMD_JSON;
  if (typeof overrideRaw === 'string' && overrideRaw.trim().length > 0) {
    const parsed = JSON.parse(overrideRaw);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((value) => typeof value !== 'string')) {
      throw new Error(
        'LIBRARIAN_HOOK_UPDATE_CMD_JSON must be a JSON array of command tokens, for example ["npm","run","librainian:update","--"]'
      );
    }
    return {
      command: parsed[0],
      args: [...parsed.slice(1), ...stagedFiles],
    };
  }
  return {
    command: 'npm',
    args: ['run', 'librainian:update', '--', ...stagedFiles],
  };
}

export function classifyUpdateOutcome(update) {
  if (update.status === 0) {
    return { outcome: 'success', softReason: null };
  }
  const combined = `${update.stdout}\n${update.stderr}`;
  for (const reason of SOFT_FAILURE_REASONS) {
    if (combined.includes(reason)) {
      return { outcome: 'soft_failure', softReason: reason };
    }
  }
  return { outcome: 'hard_failure', softReason: null };
}

export function evaluateBudgetResult({ update, elapsedMs, budgetMs, strictReliability }) {
  const outcome = classifyUpdateOutcome(update);
  const latencyViolated = elapsedMs > budgetMs;
  const reliabilityViolated = strictReliability && outcome.outcome !== 'success';
  const hardFailure = outcome.outcome === 'hard_failure';
  const failed = hardFailure || latencyViolated || reliabilityViolated;

  return {
    kind: REPORT_KIND,
    status: failed ? 'fail' : 'pass',
    elapsedMs,
    budgetMs,
    strictReliability,
    latencyViolated,
    reliabilityViolated,
    outcome: outcome.outcome,
    softFailureReason: outcome.softReason,
    updateExitCode: update.status,
  };
}

function writeReport(report, reportPath) {
  if (typeof reportPath !== 'string' || reportPath.trim().length === 0) return;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function runHookUpdate({
  stagedFiles,
  env = process.env,
  runCommand = runWithCapture,
  now = () => Date.now(),
}) {
  if (stagedFiles.length === 0) {
    return {
      exitCode: 0,
      report: {
        kind: REPORT_KIND,
        status: 'pass',
        elapsedMs: 0,
        budgetMs: parseInteger(env.LIBRARIAN_PRECOMMIT_BUDGET_MS, DEFAULT_PRECOMMIT_BUDGET_MS),
        strictReliability: false,
        latencyViolated: false,
        reliabilityViolated: false,
        outcome: 'noop',
        softFailureReason: null,
        updateExitCode: 0,
      },
      update: { status: 0, stdout: '', stderr: '' },
    };
  }

  const budgetMs = parseInteger(env.LIBRARIAN_PRECOMMIT_BUDGET_MS, DEFAULT_PRECOMMIT_BUDGET_MS);
  const strictReliabilityDefault = env.CI === 'true';
  const strictReliability = parseBoolean(env.LIBRARIAN_PRECOMMIT_STRICT, strictReliabilityDefault);
  let updateInvocation;
  try {
    updateInvocation = resolveUpdateInvocation(env, stagedFiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      report: {
        kind: REPORT_KIND,
        status: 'fail',
        elapsedMs: 0,
        budgetMs,
        strictReliability,
        latencyViolated: false,
        reliabilityViolated: true,
        outcome: 'hard_failure',
        softFailureReason: null,
        updateExitCode: 1,
      },
      update: { status: 1, stdout: '', stderr: message },
    };
  }

  const startedAt = now();
  const update = runCommand(updateInvocation.command, updateInvocation.args);
  const elapsedMs = Math.max(0, now() - startedAt);
  const report = evaluateBudgetResult({ update, elapsedMs, budgetMs, strictReliability });
  const exitCode = report.status === 'fail' ? (update.status === 0 ? 1 : update.status) : 0;

  return { exitCode, report, update };
}

function printBudgetDiagnostics(result) {
  const { report } = result;
  console.log(
    `[hooks] pre-commit self-hosting budget outcome=${report.outcome} status=${report.status} elapsedMs=${report.elapsedMs} budgetMs=${report.budgetMs} strictReliability=${report.strictReliability}`
  );

  if (report.status === 'pass' && report.outcome === 'soft_failure') {
    console.warn(
      `[hooks] LiBrainian staged index update skipped under soft-failure policy (reason: ${report.softFailureReason ?? 'unknown'}).`
    );
    console.warn('[hooks] To enforce fail-closed reliability locally, set LIBRARIAN_PRECOMMIT_STRICT=1.');
    return;
  }

  if (report.status !== 'fail') return;
  if (report.latencyViolated) {
    console.error(
      `[hooks] pre-commit self-hosting budget exceeded: elapsed=${report.elapsedMs}ms budget=${report.budgetMs}ms.`
    );
    console.error(
      '[hooks] Remediation: reduce staged scope, run `npm run librainian:update -- <files>` manually, or raise LIBRARIAN_PRECOMMIT_BUDGET_MS if justified.'
    );
  }
  if (report.reliabilityViolated && report.outcome !== 'hard_failure') {
    console.error(
      `[hooks] strict reliability budget violated: outcome=${report.outcome} reason=${report.softFailureReason ?? 'unknown'}.`
    );
    console.error('[hooks] Remediation: resolve provider/bootstrap state; strict mode disallows non-success outcomes.');
  }
}

function main() {
  const stagedFiles = process.argv.slice(2).filter((value) => value.trim().length > 0);
  const result = runHookUpdate({ stagedFiles });
  printBufferedOutput(result.update);
  printBudgetDiagnostics(result);
  writeReport(result.report, process.env.LIBRARIAN_PRECOMMIT_BUDGET_REPORT);
  process.exit(result.exitCode);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main();
}
