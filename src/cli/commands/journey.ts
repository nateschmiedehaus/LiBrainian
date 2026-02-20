/**
 * @fileoverview Agentic Journey Command
 *
 * Runs a multi-step agent-style workflow against external repos.
 */

import { parseArgs } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createError } from '../errors.js';
import { printKeyValue } from '../progress.js';
import { loadEvaluationModule } from '../../utils/evaluation_loader.js';
import type { JourneyLlmMode, JourneyProtocol } from '../../evaluation/agentic_journey.js';

type AgenticJourneyModule = typeof import('../../evaluation/agentic_journey.js');

async function loadAgenticJourneyModule(): Promise<AgenticJourneyModule> {
  const externalModuleId = 'librainian-eval/agentic_journey.js';
  return loadEvaluationModule<AgenticJourneyModule>(
    'librarian journey',
    () => import('../../evaluation/agentic_journey.js'),
    () => import(externalModuleId) as Promise<AgenticJourneyModule>,
  );
}

export interface JourneyCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

function resolveLlmMode(raw?: string): JourneyLlmMode {
  if (!raw) return 'disabled';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'disabled' || normalized === 'optional') return normalized;
  throw createError('INVALID_ARGUMENT', 'llm mode must be "disabled" or "optional".');
}

function resolveProtocol(raw?: string, objectiveFlag?: boolean): JourneyProtocol {
  if (objectiveFlag) return 'objective';
  if (!raw) return 'objective';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'legacy' || normalized === 'objective') return normalized;
  throw createError('INVALID_ARGUMENT', 'protocol must be "legacy" or "objective".');
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

function countFailureReasons(results: Array<{ errors?: string[]; journeyOk?: boolean }>): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.journeyOk && (result.errors?.length ?? 0) === 0) continue;
    const reasons = result.errors && result.errors.length > 0 ? result.errors : ['journey_checks_failed'];
    for (const reason of reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({ reason, count }));
}

export async function journeyCommand(options: JourneyCommandOptions): Promise<void> {
  const { rawArgs } = options;

  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      'repos-root': { type: 'string' },
      'max-repos': { type: 'string' },
      json: { type: 'boolean', default: false },
      deterministic: { type: 'boolean', default: false },
      llm: { type: 'string' },
      protocol: { type: 'string' },
      objective: { type: 'boolean', default: false },
      'strict-objective': { type: 'boolean', default: false },
      'timeout-ms': { type: 'string' },
      'artifacts-dir': { type: 'string' },
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
      console.log('Agentic Journey');
      console.log('===============\n');
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

  const llmMode = resolveLlmMode(typeof values.llm === 'string' ? values.llm : undefined);
  const protocol = resolveProtocol(typeof values.protocol === 'string' ? values.protocol : undefined, values.objective as boolean);
  const deterministic = values.deterministic as boolean;
  const strictObjective = values['strict-objective'] as boolean;
  const artifactsDir = normalizeArtifactsDir(values['artifacts-dir']);

  const journeyOptions = {
    reposRoot,
    maxRepos,
    deterministic,
    llmMode,
    protocol,
    strictObjective,
    ...(artifactsDir ? { artifactRoot: artifactsDir } : {}),
  };
  const { runAgenticJourney } = await loadAgenticJourneyModule();
  let report: Awaited<ReturnType<AgenticJourneyModule['runAgenticJourney']>>;
  try {
    report = await withTimeout(timeoutMs, 'journey', (signal) => runAgenticJourney({
      ...journeyOptions,
      ...(signal ? { signal } : {}),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = message.includes('_timeout_after_');
    const errorPayload = {
      code: timeout ? 'TIMEOUT' : 'JOURNEY_EXECUTION_FAILED',
      message,
      hint: timeout
        ? 'Increase --timeout-ms or reduce scope with --max-repos.'
        : 'Run again with --json and inspect provider and storage diagnostics.',
    };
    const latestPointer = writeLatestPointer(artifactsDir, {
      schema: 'AgenticJourneyLatestPointer.v1',
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
      console.log('Agentic Journey');
      console.log('===============\n');
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

  const failures = report.results.filter((result) => result.errors.length > 0 || !result.journeyOk);
  const failureSummary = countFailureReasons(report.results);
  const latestPointer = writeLatestPointer(artifactsDir, {
    schema: 'AgenticJourneyLatestPointer.v1',
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
    console.log('Agentic Journey');
    console.log('===============\n');
    printKeyValue([
      { key: 'Repos Root', value: reposRoot },
      { key: 'Total', value: report.results.length },
      { key: 'Failures', value: failures.length },
      { key: 'LLM Mode', value: llmMode },
      { key: 'Protocol', value: protocol },
      { key: 'Deterministic', value: deterministic },
      { key: 'Strict Objective', value: strictObjective },
      { key: 'Timeout (ms)', value: timeoutMs ?? '(none)' },
      { key: 'Artifacts', value: report.artifacts?.root ?? '(disabled)' },
      { key: 'Latest Pointer', value: latestPointer ?? '(disabled)' },
    ]);
    if (failures.length > 0) {
      console.log('\nFailed Repos:');
      for (const failure of failures) {
        const errors = failure.errors.length > 0 ? failure.errors.join('; ') : 'journey checks failed';
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
