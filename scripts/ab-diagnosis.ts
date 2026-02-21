#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AbExperimentReport, AbTaskComplexity } from '../src/evaluation/ab_harness.js';
import {
  buildTaskMetadataMap,
  diagnoseAbReports,
  renderAbDiagnosisMarkdown,
  type AbTaskMetadata,
} from '../src/evaluation/ab_diagnosis.js';
import { safeJsonParse } from '../src/utils/safe_json.js';

interface RawTaskEntry {
  id?: unknown;
  queryType?: unknown;
  tags?: unknown;
  description?: unknown;
  complexity?: unknown;
}

interface RawTaskPack {
  tasks?: RawTaskEntry[];
}

function sanitizeJson(raw: string): string {
  // Historical A/B artifacts can contain raw control chars from tool stderr streams.
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function isAbExperimentReport(value: unknown): value is AbExperimentReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { runId?: unknown; results?: unknown; startedAt?: unknown; completedAt?: unknown };
  return typeof candidate.runId === 'string'
    && Array.isArray(candidate.results)
    && typeof candidate.startedAt === 'string'
    && typeof candidate.completedAt === 'string';
}

async function readJsonSafe<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = safeJsonParse<T>(sanitizeJson(raw));
  if (!parsed.ok) {
    throw new Error(`invalid_json:${filePath}`);
  }
  return parsed.value;
}

async function listJsonFiles(dirPath: string, filePrefix: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(filePrefix) && entry.name.endsWith('.json'))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function discoverDefaultReportPaths(root: string): Promise<string[]> {
  const evalResults = await listJsonFiles(path.join(root, 'eval-results'), 'ab-harness');
  const stateEval = await listJsonFiles(path.join(root, 'state', 'eval', 'ab'), 'ab-report');
  return Array.from(new Set([...evalResults, ...stateEval])).sort((left, right) => left.localeCompare(right));
}

function parseList(values: string[] | undefined): string[] {
  if (!values) return [];
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseQueryType(value: unknown): AbTaskMetadata['queryType'] {
  if (typeof value !== 'string') return undefined;
  if (value === 'structural' || value === 'explanation' || value === 'debugging' || value === 'architectural' || value === 'other') {
    return value;
  }
  return undefined;
}

function parseComplexity(value: unknown): AbTaskComplexity | undefined {
  if (value === 'T1' || value === 'T2' || value === 'T3' || value === 'T4' || value === 'T5') {
    return value;
  }
  return undefined;
}

async function loadTaskMetadata(taskFiles: string[]): Promise<Map<string, AbTaskMetadata>> {
  const entries: AbTaskMetadata[] = [];
  for (const taskFile of taskFiles) {
    const pack = await readJsonSafe<RawTaskPack>(taskFile);
    for (const rawTask of pack.tasks ?? []) {
      if (typeof rawTask.id !== 'string' || rawTask.id.length === 0) continue;
      entries.push({
        id: rawTask.id,
        queryType: parseQueryType(rawTask.queryType),
        tags: Array.isArray(rawTask.tags) ? rawTask.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
        description: typeof rawTask.description === 'string' ? rawTask.description : undefined,
        complexity: parseComplexity(rawTask.complexity),
      });
    }
  }
  return buildTaskMetadataMap(entries);
}

function dedupeReports(reports: AbExperimentReport[]): AbExperimentReport[] {
  const byRunId = new Map<string, AbExperimentReport>();
  for (const report of reports) {
    const existing = byRunId.get(report.runId);
    if (!existing) {
      byRunId.set(report.runId, report);
      continue;
    }
    if (report.completedAt > existing.completedAt) {
      byRunId.set(report.runId, report);
    }
  }
  return Array.from(byRunId.values()).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function summarizeCoverage(aggregateVsLatestMultiplier: number | null): string {
  if (aggregateVsLatestMultiplier === null) return 'n/a';
  if (aggregateVsLatestMultiplier >= 2) {
    return `${aggregateVsLatestMultiplier.toFixed(2)}x (meets >=2x sample coverage)`;
  }
  return `${aggregateVsLatestMultiplier.toFixed(2)}x (below >=2x sample coverage)`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      report: { type: 'string', multiple: true },
      taskFile: { type: 'string', multiple: true },
      out: { type: 'string', default: 'state/audits/librarian/ab-diagnosis.json' },
      markdown: { type: 'string', default: 'state/audits/librarian/ab-diagnosis.md' },
      alpha: { type: 'string' },
      targetPower: { type: 'string' },
      latestRunId: { type: 'string' },
      minPairs: { type: 'string', default: '1' },
    },
    strict: true,
    allowPositionals: false,
  });

  const root = process.cwd();
  const explicitReportPaths = parseList(values.report).map((value) => path.resolve(root, value));
  const defaultReportPaths = explicitReportPaths.length > 0 ? [] : await discoverDefaultReportPaths(root);
  const reportPaths = Array.from(new Set([...explicitReportPaths, ...defaultReportPaths]));
  if (reportPaths.length === 0) {
    throw new Error('no_ab_reports_found');
  }

  const reports: AbExperimentReport[] = [];
  for (const reportPath of reportPaths) {
    try {
      const parsed = await readJsonSafe<unknown>(reportPath);
      if (isAbExperimentReport(parsed)) {
        reports.push(parsed);
      }
    } catch {
      // Skip malformed or partial artifacts; diagnosis remains deterministic from valid reports.
    }
  }
  const dedupedReports = dedupeReports(reports);
  if (dedupedReports.length === 0) {
    throw new Error('no_valid_ab_reports_found');
  }

  const explicitTaskFiles = parseList(values.taskFile).map((value) => path.resolve(root, value));
  const defaultTaskFiles = explicitTaskFiles.length > 0
    ? []
    : await listJsonFiles(path.join(root, 'eval-corpus', 'ab-harness'), 'tasks');
  const taskMetadata = await loadTaskMetadata(Array.from(new Set([...explicitTaskFiles, ...defaultTaskFiles])));

  const alpha = typeof values.alpha === 'string' ? Number(values.alpha) : undefined;
  const targetPower = typeof values.targetPower === 'string' ? Number(values.targetPower) : undefined;
  const minPairs = Number(values.minPairs ?? '1');
  if (!Number.isFinite(minPairs) || minPairs <= 0) {
    throw new Error(`invalid_minPairs:${values.minPairs ?? ''}`);
  }

  const diagnosis = diagnoseAbReports({
    reports: dedupedReports,
    taskMetadataById: taskMetadata,
    alpha: Number.isFinite(alpha) ? alpha : undefined,
    targetPower: Number.isFinite(targetPower) ? targetPower : undefined,
    latestRunId: typeof values.latestRunId === 'string' ? values.latestRunId : undefined,
  });

  if (diagnosis.pairCount < minPairs) {
    throw new Error(`insufficient_pairs:${diagnosis.pairCount}<${minPairs}`);
  }

  const outPath = path.resolve(root, values.out ?? 'state/audits/librarian/ab-diagnosis.json');
  const markdownPath = path.resolve(root, values.markdown ?? 'state/audits/librarian/ab-diagnosis.md');
  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(diagnosis, null, 2) + '\n', 'utf8');
  await writeFile(markdownPath, renderAbDiagnosisMarkdown(diagnosis), 'utf8');

  console.log(`[ab-diagnosis] reports=${diagnosis.reportsAnalyzed} pairs=${diagnosis.pairCount} uniqueTasks=${diagnosis.uniqueTaskCount}`);
  console.log(`[ab-diagnosis] absolute_delta=${diagnosis.overall.absoluteSuccessRateDelta} p=${diagnosis.overall.significance.pValue ?? 'n/a'}`);
  console.log(`[ab-diagnosis] sample_coverage=${summarizeCoverage(diagnosis.power.aggregateVsLatestMultiplier)}`);
  console.log(`[ab-diagnosis] root_cause=${diagnosis.rootCause.category}`);
  console.log(`[ab-diagnosis] decision=${diagnosis.decision.recommendedFocus}`);
  console.log(`[ab-diagnosis] wrote_json=${outPath}`);
  console.log(`[ab-diagnosis] wrote_markdown=${markdownPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ab-diagnosis] failed: ${message}`);
  process.exit(1);
});
