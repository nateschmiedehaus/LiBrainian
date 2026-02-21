/**
 * @fileoverview Evidence manifest generation for evaluation artifacts.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { EvidenceManifestSummary } from './evidence_reconciliation.js';

export const DEFAULT_EVIDENCE_ARTIFACTS = [
  'eval-results/metrics-report.json',
  'eval-results/ab-results.json',
  'eval-results/final-verification.json',
  'scenario-report.json',
] as const;

const DISCOVERED_EVIDENCE_DIRS = ['eval-results', join('state', 'audits')];
const EXCLUDED_EVIDENCE_ARTIFACTS = new Set([
  'state/audits/librarian/manifest.json',
]);
const DEFAULT_GATE_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_GATE_COMMAND_TASK_KEYS = [
  'layer0.typecheck',
  'layer0.build',
  'layer1.noWave0Imports',
  'layer1.noDirectImports',
  'layer1.extractionPrereqs',
  'layer1.repoExtraction',
] as const;
const GATE_RUNS_DIR = join('state', 'audits', 'librarian', 'gate-runs');

export interface EvidenceArtifactMetadata {
  path: string;
  size: number;
  sha256: string;
  timestamp: string;
}

export interface EvidenceManifest {
  artifacts: EvidenceArtifactMetadata[];
  summary: EvidenceManifestSummary;
  gateRuns?: EvidenceGateRun[];
}

export interface EvidenceGateRun {
  taskKey: string;
  layer: number;
  command: string;
  status: 'pass' | 'fail' | 'skipped';
  exitCode: number | null;
  durationMs: number;
  ranAt: string;
  stdoutPath: string;
  stderrPath: string;
  reason?: string;
}

type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

type GateTaskConfig = {
  layer?: unknown;
  command?: unknown;
  dependsOn?: unknown;
};

type GatesDocument = {
  tasks?: Record<string, GateTaskConfig>;
};

const DEFAULT_AB_LIFT_TARGET = 0.2;

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Evidence summary missing number for ${label}`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Evidence summary missing boolean for ${label}`);
  }
  return value;
}

function maxTimestamp(values: string[]): string {
  if (values.length === 0) {
    return new Date(0).toISOString();
  }
  let max = new Date(values[0]).getTime();
  for (const value of values.slice(1)) {
    const timestamp = new Date(value).getTime();
    if (timestamp > max) max = timestamp;
  }
  return new Date(max).toISOString();
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

function normalizeArtifactPath(relativePath: string): string {
  return relativePath.split(sep).join('/');
}

function uniqueSortedArtifacts(paths: string[]): string[] {
  const unique = new Set<string>();
  for (const value of paths) {
    const normalized = normalizeArtifactPath(value);
    if (EXCLUDED_EVIDENCE_ARTIFACTS.has(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

async function listFilesRecursive(root: string, relativeDir: string): Promise<string[]> {
  const absoluteDir = join(root, relativeDir);
  let entries: DirectoryEntry[];

  try {
    entries = (await readdir(absoluteDir, { withFileTypes: true, encoding: 'utf8' })) as DirectoryEntry[];
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function discoverEvidenceArtifacts(workspaceRoot: string): Promise<string[]> {
  const discovered: string[] = [];

  for (const dir of DISCOVERED_EVIDENCE_DIRS) {
    discovered.push(...(await listFilesRecursive(workspaceRoot, dir)));
  }

  const scenarioPath = join(workspaceRoot, 'scenario-report.json');
  try {
    await stat(scenarioPath);
    discovered.push('scenario-report.json');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  return discovered;
}

function parseDependencyKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function sanitizeTaskKey(taskKey: string): string {
  return taskKey.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function writeGateRunLog(
  workspaceRoot: string,
  taskKey: string,
  timestamp: string,
  stream: 'stdout' | 'stderr',
  content: string,
): Promise<string> {
  const filename = `${timestamp}-${sanitizeTaskKey(taskKey)}.${stream}.log`;
  const relativePath = normalizeArtifactPath(join(GATE_RUNS_DIR, filename));
  const absolutePath = join(workspaceRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  return relativePath;
}

async function runGateCommands(options: {
  workspaceRoot: string;
  taskKeys?: readonly string[];
  timeoutMs?: number;
}): Promise<EvidenceGateRun[]> {
  const gatesPath = join(options.workspaceRoot, 'docs', 'librarian', 'GATES.json');
  let gates: GatesDocument;
  try {
    gates = await readJson<GatesDocument>(gatesPath);
  } catch {
    return [];
  }

  const tasks = gates.tasks ?? {};
  const selectedKeys = options.taskKeys && options.taskKeys.length > 0
    ? Array.from(new Set(options.taskKeys))
    : Array.from(DEFAULT_GATE_COMMAND_TASK_KEYS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_GATE_COMMAND_TIMEOUT_MS;
  const resultsByTask = new Map<string, EvidenceGateRun>();
  const runs: EvidenceGateRun[] = [];

  for (const taskKey of selectedKeys) {
    const task = tasks[taskKey];
    if (!task) continue;
    const layer = typeof task.layer === 'number' ? task.layer : -1;
    if (layer < 0 || layer > 1) continue;
    if (typeof task.command !== 'string' || task.command.trim().length === 0) continue;

    const dependencyKeys = parseDependencyKeys(task.dependsOn);
    const failedDependency = dependencyKeys.find((dependencyKey) => {
      const dependency = resultsByTask.get(dependencyKey);
      return dependency && dependency.status !== 'pass';
    });
    const ranAt = new Date().toISOString();
    const timestamp = ranAt.replace(/[:.]/g, '-');

    if (failedDependency) {
      const reason = `dependency_failed:${failedDependency}`;
      const stdoutPath = await writeGateRunLog(
        options.workspaceRoot,
        taskKey,
        timestamp,
        'stdout',
        '',
      );
      const stderrPath = await writeGateRunLog(
        options.workspaceRoot,
        taskKey,
        timestamp,
        'stderr',
        reason,
      );

      const skippedRun: EvidenceGateRun = {
        taskKey,
        layer,
        command: task.command,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
        ranAt,
        stdoutPath,
        stderrPath,
        reason,
      };
      runs.push(skippedRun);
      resultsByTask.set(taskKey, skippedRun);
      continue;
    }

    const started = Date.now();
    const commandResult = spawnSync(task.command, {
      cwd: options.workspaceRoot,
      encoding: 'utf8',
      shell: true,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    });
    const durationMs = Date.now() - started;
    const stdout = String(commandResult.stdout ?? '');
    const stderrRaw = String(commandResult.stderr ?? '');
    const timeoutReason = commandResult.error?.name === 'Error'
      && (commandResult.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
      ? `timeout_after_ms:${timeoutMs}`
      : null;
    const stderr = timeoutReason ? `${stderrRaw}\n${timeoutReason}`.trim() : stderrRaw;
    const stdoutPath = await writeGateRunLog(
      options.workspaceRoot,
      taskKey,
      timestamp,
      'stdout',
      stdout,
    );
    const stderrPath = await writeGateRunLog(
      options.workspaceRoot,
      taskKey,
      timestamp,
      'stderr',
      stderr,
    );
    const status: EvidenceGateRun['status'] = commandResult.status === 0 ? 'pass' : 'fail';
    const run: EvidenceGateRun = {
      taskKey,
      layer,
      command: task.command,
      status,
      exitCode: typeof commandResult.status === 'number' ? commandResult.status : null,
      durationMs,
      ranAt,
      stdoutPath,
      stderrPath,
      reason: timeoutReason ?? undefined,
    };

    runs.push(run);
    resultsByTask.set(taskKey, run);
  }

  return runs;
}

async function buildEvidenceSummary(workspaceRoot: string, artifacts: EvidenceArtifactMetadata[]): Promise<EvidenceManifestSummary> {
  const metricsPath = join(workspaceRoot, 'eval-results', 'metrics-report.json');
  const abPath = join(workspaceRoot, 'eval-results', 'ab-results.json');
  const finalVerificationPath = join(workspaceRoot, 'eval-results', 'final-verification.json');
  const scenarioPath = join(workspaceRoot, 'scenario-report.json');

  const metricsReport = await readJson<any>(metricsPath);
  const abReport = await readJson<any>(abPath);
  const finalVerification = await readJson<any>(finalVerificationPath);
  const scenarioReport = await readJson<any>(scenarioPath);

  const metrics = metricsReport.metrics ?? {};
  const summaryMetrics = {
    retrievalRecallAt5: {
      mean: requireNumber(metrics.retrieval_recall_at_5?.mean, 'metrics.retrieval_recall_at_5.mean'),
      target: requireNumber(metrics.retrieval_recall_at_5?.target, 'metrics.retrieval_recall_at_5.target'),
      met: requireBoolean(metrics.retrieval_recall_at_5?.met, 'metrics.retrieval_recall_at_5.met'),
    },
    contextPrecision: {
      mean: requireNumber(metrics.context_precision?.mean, 'metrics.context_precision.mean'),
      target: requireNumber(metrics.context_precision?.target, 'metrics.context_precision.target'),
      met: requireBoolean(metrics.context_precision?.met, 'metrics.context_precision.met'),
    },
    hallucinationRate: {
      mean: requireNumber(metrics.hallucination_rate?.mean, 'metrics.hallucination_rate.mean'),
      target: requireNumber(metrics.hallucination_rate?.target, 'metrics.hallucination_rate.target'),
      met: requireBoolean(metrics.hallucination_rate?.met, 'metrics.hallucination_rate.met'),
    },
    faithfulness: {
      mean: requireNumber(metrics.faithfulness?.mean, 'metrics.faithfulness.mean'),
      target: requireNumber(metrics.faithfulness?.target, 'metrics.faithfulness.target'),
      met: requireBoolean(metrics.faithfulness?.met, 'metrics.faithfulness.met'),
    },
    answerRelevancy: {
      mean: requireNumber(metrics.answer_relevancy?.mean, 'metrics.answer_relevancy.mean'),
      target: requireNumber(metrics.answer_relevancy?.target, 'metrics.answer_relevancy.target'),
      met: requireBoolean(metrics.answer_relevancy?.met, 'metrics.answer_relevancy.met'),
    },
  };

  const lift = requireNumber(abReport.lift?.success_rate_lift, 'ab.lift.success_rate_lift');
  const pValue = requireNumber(
    abReport.statistics?.t_p_value ?? abReport.statistics?.chi_p_value,
    'ab.statistics.t_p_value'
  );
  const significant = requireBoolean(abReport.statistics?.significant, 'ab.statistics.significant');

  const p21 = finalVerification.validation_results?.phase21 ?? {};
  const t21 = finalVerification.targets?.phase21 ?? {};

  const summaryPerformance = {
    p50LatencyMs: requireNumber(p21.p50LatencyMs, 'validation_results.phase21.p50LatencyMs'),
    p99LatencyMs: requireNumber(p21.p99LatencyMs, 'validation_results.phase21.p99LatencyMs'),
    memoryPerKLOC: requireNumber(p21.memoryPerKLOC, 'validation_results.phase21.memoryPerKLOC'),
    targetMemoryPerKLOC: requireNumber(t21.memoryPerKLOC, 'targets.phase21.memoryPerKLOC'),
  };

  const scenarioSummary = scenarioReport.summary ?? {};
  const summaryScenarios = {
    total: requireNumber(scenarioSummary.total, 'scenario.summary.total'),
    passing: requireNumber(scenarioSummary.passing, 'scenario.summary.passing'),
    failing: requireNumber(scenarioSummary.failing, 'scenario.summary.failing'),
  };

  return {
    generatedAt: maxTimestamp(artifacts.map((artifact) => artifact.timestamp)),
    metrics: summaryMetrics,
    ab: {
      lift,
      pValue,
      targetLift: DEFAULT_AB_LIFT_TARGET,
      significant,
    },
    performance: summaryPerformance,
    scenarios: summaryScenarios,
  };
}

export async function buildEvidenceManifest(options: {
  workspaceRoot: string;
  artifacts?: readonly string[];
  runGateCommands?: boolean;
  gateCommandTaskKeys?: readonly string[];
  gateCommandTimeoutMs?: number;
}): Promise<EvidenceManifest> {
  const gateRuns = options.runGateCommands
    ? await runGateCommands({
      workspaceRoot: options.workspaceRoot,
      taskKeys: options.gateCommandTaskKeys,
      timeoutMs: options.gateCommandTimeoutMs,
    })
    : [];
  const discovered = await discoverEvidenceArtifacts(options.workspaceRoot);
  const artifacts = uniqueSortedArtifacts([
    ...(options.artifacts ?? DEFAULT_EVIDENCE_ARTIFACTS),
    ...discovered,
  ]);
  const entries: EvidenceArtifactMetadata[] = [];

  for (const relativePath of artifacts) {
    const absolutePath = join(options.workspaceRoot, relativePath);
    let stats;
    try {
      stats = await stat(absolutePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Evidence artifact missing: ${relativePath} (${message})`);
    }

    const content = await readFile(absolutePath);
    const sha256 = createHash('sha256').update(content).digest('hex');

    entries.push({
      path: relativePath,
      size: stats.size,
      sha256,
      timestamp: stats.mtime.toISOString(),
    });
  }

  const summary = await buildEvidenceSummary(options.workspaceRoot, entries);
  return gateRuns.length > 0
    ? { artifacts: entries, summary, gateRuns }
    : { artifacts: entries, summary };
}

export async function writeEvidenceManifest(options: {
  workspaceRoot: string;
  artifacts?: readonly string[];
  outputPath?: string;
  runGateCommands?: boolean;
  gateCommandTaskKeys?: readonly string[];
  gateCommandTimeoutMs?: number;
}): Promise<{ manifest: EvidenceManifest; outputPath: string }> {
  const manifest = await buildEvidenceManifest({
    workspaceRoot: options.workspaceRoot,
    artifacts: options.artifacts,
    runGateCommands: options.runGateCommands,
    gateCommandTaskKeys: options.gateCommandTaskKeys,
    gateCommandTimeoutMs: options.gateCommandTimeoutMs,
  });

  const outputPath =
    options.outputPath ?? join(options.workspaceRoot, 'state', 'audits', 'librarian', 'manifest.json');

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { manifest, outputPath };
}
