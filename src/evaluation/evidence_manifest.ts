/**
 * @fileoverview Evidence manifest generation for evaluation artifacts.
 */

import { createHash } from 'node:crypto';
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

export interface EvidenceArtifactMetadata {
  path: string;
  size: number;
  sha256: string;
  timestamp: string;
}

export interface EvidenceManifest {
  artifacts: EvidenceArtifactMetadata[];
  summary: EvidenceManifestSummary;
}

type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
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
    targetP50LatencyMs: requireNumber(t21.p50LatencyMs, 'targets.phase21.p50LatencyMs'),
    targetP99LatencyMs: requireNumber(t21.p99LatencyMs, 'targets.phase21.p99LatencyMs'),
    targetMemoryPerKLOC: requireNumber(t21.memoryPerKLOC, 'targets.phase21.memoryPerKLOC'),
    latencyByQueryType: (p21.latencyByQueryType && typeof p21.latencyByQueryType === 'object')
      ? p21.latencyByQueryType
      : {},
    latencyQueryCounts: (p21.latencyQueryCounts && typeof p21.latencyQueryCounts === 'object')
      ? p21.latencyQueryCounts
      : {},
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
}): Promise<EvidenceManifest> {
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
  return { artifacts: entries, summary };
}

export async function writeEvidenceManifest(options: {
  workspaceRoot: string;
  artifacts?: readonly string[];
  outputPath?: string;
}): Promise<{ manifest: EvidenceManifest; outputPath: string }> {
  const manifest = await buildEvidenceManifest({
    workspaceRoot: options.workspaceRoot,
    artifacts: options.artifacts,
  });

  const outputPath =
    options.outputPath ?? join(options.workspaceRoot, 'state', 'audits', 'librarian', 'manifest.json');

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return { manifest, outputPath };
}
