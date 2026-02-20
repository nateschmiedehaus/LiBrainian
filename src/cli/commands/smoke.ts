/**
 * @fileoverview External Repo Smoke Command
 *
 * Runs the external repo smoke harness against eval-corpus/external-repos.
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createError } from '../errors.js';
import { printKeyValue } from '../progress.js';
import { loadEvaluationModule } from '../../utils/evaluation_loader.js';

type ExternalRepoSmokeModule = typeof import('../../evaluation/external_repo_smoke.js');

async function loadExternalRepoSmokeModule(): Promise<ExternalRepoSmokeModule> {
  const externalModuleId = 'librainian-eval/external_repo_smoke.js';
  return loadEvaluationModule<ExternalRepoSmokeModule>(
    'librarian smoke',
    () => import('../../evaluation/external_repo_smoke.js'),
    () => import(externalModuleId) as Promise<ExternalRepoSmokeModule>,
  );
}

export interface SmokeCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function normalizeArtifactsDir(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  return path.resolve(raw.trim());
}

function parsePositiveInt(raw: string | undefined, name: string): number | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createError('INVALID_ARGUMENT', `${name} must be a positive integer.`);
  }
  return parsed;
}

async function withTimeout<T>(
  timeoutMs: number | undefined,
  label: string,
  run: (signal?: AbortSignal) => Promise<T>
): Promise<T> {
  if (!timeoutMs) {
    return run(undefined);
  }
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const timeoutError = new Error(`${label}_timeout_after_${timeoutMs}ms`);
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function writeLatestPointer(
  artifactsDir: string | undefined,
  payload: unknown
): string | undefined {
  if (!artifactsDir) {
    return undefined;
  }
  fs.mkdirSync(artifactsDir, { recursive: true });
  const latestPath = path.join(artifactsDir, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf8');
  return latestPath;
}

function countFailureReasons(results: Array<{ errors?: string[]; overviewOk?: boolean; contextOk?: boolean }>): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const result of results) {
    const failed = (result.errors?.length ?? 0) > 0 || (!result.overviewOk && !result.contextOk);
    if (!failed) continue;
    const reasons = result.errors && result.errors.length > 0 ? result.errors : ['no_useful_responses'];
    for (const reason of reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({ reason, count }));
}

export async function smokeCommand(options: SmokeCommandOptions): Promise<void> {
  const { rawArgs } = options;

  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'repos-root': { type: 'string' },
      'max-repos': { type: 'string' },
      repo: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'artifacts-dir': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const reposRoot = typeof values['repos-root'] === 'string' && values['repos-root']
    ? values['repos-root']
    : path.join(process.cwd(), 'eval-corpus', 'external-repos');

  const manifestPath = path.join(reposRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const error = {
      code: 'MISSING_MANIFEST',
      message: `External repo manifest not found at ${manifestPath}`,
      hint: 'Set --repos-root to a directory containing manifest.json (defaults to eval-corpus/external-repos).',
    };
    if (values.json) {
      console.log(JSON.stringify({
        summary: { total: 0, failures: 1 },
        error,
      }, null, 2));
    } else {
      console.log('External Repo Smoke');
      console.log('===================\n');
      printKeyValue([
        { key: 'Repos Root', value: reposRoot },
        { key: 'Status', value: 'manifest missing' },
      ]);
      console.log(`\nError: ${error.message}`);
      console.log(`Hint: ${error.hint}`);
    }
    process.exitCode = 1;
    return;
  }

  const maxRepos = parsePositiveInt(
    typeof values['max-repos'] === 'string' ? values['max-repos'] : undefined,
    'max-repos'
  );
  const timeoutMs = parsePositiveInt(
    typeof values['timeout-ms'] === 'string' ? values['timeout-ms'] : undefined,
    'timeout-ms'
  );

  const repoNames =
    typeof values.repo === 'string' && values.repo.trim().length > 0
      ? values.repo.split(',').map((entry) => entry.trim()).filter(Boolean)
      : undefined;
  const artifactsDir = normalizeArtifactsDir(values['artifacts-dir']);

  const smokeOptions = {
    reposRoot,
    maxRepos,
    repoNames,
    ...(artifactsDir ? { artifactRoot: artifactsDir } : {}),
  };
  const { runExternalRepoSmoke } = await loadExternalRepoSmokeModule();
  let report: Awaited<ReturnType<ExternalRepoSmokeModule['runExternalRepoSmoke']>>;
  try {
    report = await withTimeout(timeoutMs, 'smoke', (signal) => runExternalRepoSmoke({
      ...smokeOptions,
      ...(signal ? { signal } : {}),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = message.includes('_timeout_after_');
    const errorPayload = {
      code: timeout ? 'TIMEOUT' : 'SMOKE_EXECUTION_FAILED',
      message,
      hint: timeout
        ? 'Increase --timeout-ms or reduce scope with --max-repos/--repo.'
        : 'Run again with --json and inspect runtime environment and provider readiness.',
    };
    const latestPointer = writeLatestPointer(artifactsDir, {
      schema: 'ExternalRepoSmokeLatestPointer.v1',
      createdAt: new Date().toISOString(),
      artifacts: null,
      summary: { total: 0, failures: 1 },
      error: errorPayload,
    });
    if (values.json) {
      console.log(JSON.stringify({
        summary: { total: 0, failures: 1 },
        latestPointer,
        error: errorPayload,
      }, null, 2));
    } else {
      console.log('External Repo Smoke');
      console.log('===================\n');
      printKeyValue([
        { key: 'Repos Root', value: reposRoot },
        { key: 'Status', value: 'execution failed' },
        { key: 'Timeout (ms)', value: timeoutMs ?? '(none)' },
        { key: 'Latest Pointer', value: latestPointer ?? '(disabled)' },
      ]);
      console.log(`\nError: ${errorPayload.message}`);
      console.log(`Hint: ${errorPayload.hint}`);
    }
    process.exitCode = 1;
    return;
  }
  const failures = report.results.filter((result) => result.errors.length > 0 || (!result.overviewOk && !result.contextOk));
  const failureSummary = countFailureReasons(report.results);
  const latestPointer = writeLatestPointer(artifactsDir, {
    schema: 'ExternalRepoSmokeLatestPointer.v1',
    createdAt: new Date().toISOString(),
    artifacts: report.artifacts ?? null,
    summary: {
      total: report.results.length,
      failures: failures.length,
    },
  });

  if (values.json) {
    console.log(JSON.stringify({
      summary: {
        total: report.results.length,
        failures: failures.length,
      },
      failureSummary,
      artifacts: report.artifacts,
      latestPointer,
      results: report.results,
    }, null, 2));
  } else {
    console.log('External Repo Smoke');
    console.log('===================\n');
    printKeyValue([
      { key: 'Repos Root', value: reposRoot },
      { key: 'Total', value: report.results.length },
      { key: 'Failures', value: failures.length },
      { key: 'Timeout (ms)', value: timeoutMs ?? '(none)' },
      { key: 'Artifacts', value: report.artifacts?.root ?? '(disabled)' },
      { key: 'Latest Pointer', value: latestPointer ?? '(disabled)' },
    ]);
    if (failures.length > 0) {
      console.log('\nFailed Repos:');
      for (const failure of failures) {
        const errors = failure.errors.length > 0 ? failure.errors.join('; ') : 'no useful responses';
        console.log(`  - ${failure.repo}: ${errors}`);
      }
      if (failureSummary.length > 0) {
        console.log('\nFailure Summary:');
        for (const item of failureSummary) {
          console.log(`  - ${item.reason}: ${item.count}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
