import * as fs from 'fs/promises';
import * as path from 'path';
import { computeCanonRef, computeEnvironmentRef } from '../spine/refs.js';
import type { ProviderGateResult, ProviderGateStatus, EmbeddingGateStatus } from './provider_gate.js';
import type { GovernorBudgetReportV1 } from './governors.js';
import type { GuessViolation } from '../analysis/guess_detector.js';
import { TAXONOMY_ITEMS, type TaxonomyItem, type TaxonomySource } from './taxonomy.js';
import { noResult } from './empty_values.js';
import { safeJsonParse } from '../utils/safe_json.js';
import type { BootstrapReport, OnboardingBaseline } from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import { checkProviderSnapshot } from './provider_check.js';
import { generateStateReport } from '../measurement/observability.js';
import { createSymbolStorage } from '../storage/symbol_storage.js';
import { getErrorMessage } from '../utils/errors.js';
import { logWarning } from '../telemetry/logger.js';
export type ProviderName = 'claude' | 'codex';
export interface ProviderStatusReportV1 { kind: 'ProviderStatusReport.v1'; schema_version: 1; created_at: string; canon: Awaited<ReturnType<typeof computeCanonRef>>; environment: ReturnType<typeof computeEnvironmentRef>; workspace: string; ready: boolean; reason?: string; providers: ProviderGateStatus[]; embedding?: EmbeddingGateStatus; llm_ready?: boolean; embedding_ready?: boolean; remediation_steps: string[]; fallback_chain: ProviderName[]; selected_provider: ProviderName | null; last_successful_provider: ProviderName | null; bypassed: boolean; guidance?: string[]; trace_refs: string[]; }
export interface LibrarianRunReportV1 { kind: 'LibrarianRunReport.v1'; schema_version: 1; run_id: string; started_at: string; completed_at: string; outcome: 'success' | 'failure'; files_processed: number; functions_indexed: number; packs_created: number; governor_budget_used: number; governor_budget_limit: number; errors: Array<{ file: string; error: string }>; trace_refs: string[]; }
export interface KnowledgeCoverageReportV1 { kind: 'KnowledgeCoverageReport.v1'; schema_version: 1; created_at: string; workspace: string; items_covered: number; items_by_source: Record<TaxonomySource, number>; coverage_percentage: number; gaps: TaxonomyItem[]; trace_refs: string[]; }
export interface TrajectoryAnalysisReportV1 { kind: 'TrajectoryAnalysisReport.v1'; schema_version: 1; created_at: string; workspace: string; task_id: string; violations: GuessViolation[]; recommendations: string[]; trace_refs: string[]; }
const resolveLibrarianAuditDir = (workspaceRoot: string): string => path.join(workspaceRoot, 'state', 'audits', 'librarian');
const resolveProviderAuditDir = (workspaceRoot: string): string => path.join(resolveLibrarianAuditDir(workspaceRoot), 'provider');
const resolveLastSuccessPath = (workspaceRoot: string): string => path.join(resolveProviderAuditDir(workspaceRoot), 'last_successful_provider.json');
export async function readLastSuccessfulProvider(workspaceRoot: string): Promise<ProviderName | null> {
  try {
    const raw = await fs.readFile(resolveLastSuccessPath(workspaceRoot), 'utf8');
    const parsed = safeJsonParse<{ provider?: string }>(raw);
    if (!parsed.ok) return noResult();
    return parsed.value?.provider === 'claude' || parsed.value?.provider === 'codex' ? parsed.value.provider : noResult();
  } catch {
    return noResult();
  }
}
export async function writeLastSuccessfulProvider(workspaceRoot: string, provider: ProviderName): Promise<void> {
  const dir = resolveProviderAuditDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const payload = { provider, recorded_at: new Date().toISOString() };
  await fs.writeFile(resolveLastSuccessPath(workspaceRoot), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}
export async function createProviderStatusReport(
  workspaceRoot: string,
  result: ProviderGateResult,
  extra: { remediationSteps: string[]; fallbackChain: ProviderName[]; lastSuccessfulProvider: ProviderName | null; traceRefs?: string[] }
): Promise<ProviderStatusReportV1> {
  const createdAt = new Date().toISOString();
  return {
    kind: 'ProviderStatusReport.v1',
    schema_version: 1,
    created_at: createdAt,
    canon: await computeCanonRef(workspaceRoot),
    environment: computeEnvironmentRef(),
    workspace: workspaceRoot,
    ready: result.ready,
    reason: result.reason,
    providers: result.providers,
    embedding: result.embedding,
    llm_ready: result.llmReady,
    embedding_ready: result.embeddingReady,
    remediation_steps: extra.remediationSteps,
    fallback_chain: extra.fallbackChain,
    selected_provider: result.selectedProvider,
    last_successful_provider: extra.lastSuccessfulProvider,
    bypassed: result.bypassed,
    guidance: result.guidance,
    trace_refs: extra.traceRefs ?? [],
  };
}
export async function writeProviderStatusReport(workspaceRoot: string, report: ProviderStatusReportV1): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-');
  const dir = path.join(resolveProviderAuditDir(workspaceRoot), timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'ProviderStatusReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}
export async function readLatestGovernorBudgetReport(workspaceRoot: string): Promise<GovernorBudgetReportV1 | null> {
  const base = path.join(resolveLibrarianAuditDir(workspaceRoot), 'governor');
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const latest = dirs.at(-1);
    if (!latest) return noResult();
    const raw = await fs.readFile(path.join(base, latest, 'GovernorBudgetReport.v1.json'), 'utf8');
    const parsed = safeJsonParse<GovernorBudgetReportV1>(raw);
    return parsed.ok ? parsed.value : noResult();
  } catch {
    return noResult();
  }
}
export function createLibrarianRunReport(input: {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  outcome: 'success' | 'failure';
  filesProcessed: number;
  functionsIndexed: number;
  packsCreated: number;
  governorBudgetUsed: number;
  governorBudgetLimit: number;
  errors: Array<{ file: string; error: string }>;
  traceRefs: string[];
}): LibrarianRunReportV1 {
  return {
    kind: 'LibrarianRunReport.v1',
    schema_version: 1,
    run_id: input.runId,
    started_at: input.startedAt.toISOString(),
    completed_at: input.completedAt.toISOString(),
    outcome: input.outcome,
    files_processed: input.filesProcessed,
    functions_indexed: input.functionsIndexed,
    packs_created: input.packsCreated,
    governor_budget_used: input.governorBudgetUsed,
    governor_budget_limit: input.governorBudgetLimit,
    errors: input.errors,
    trace_refs: input.traceRefs,
  };
}
export async function writeLibrarianRunReport(workspaceRoot: string, report: LibrarianRunReportV1): Promise<string> {
  const timestamp = report.completed_at.replace(/[:.]/g, '-');
  const dir = path.join(resolveLibrarianAuditDir(workspaceRoot), 'runs', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'LibrarianRunReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}
export function createKnowledgeCoverageReport(input: {
  workspace: string;
  itemsBySource?: Partial<Record<TaxonomySource, number>>;
  gaps?: TaxonomyItem[];
  traceRefs?: string[];
}): KnowledgeCoverageReportV1 {
  const createdAt = new Date().toISOString();
  const items_by_source: Record<TaxonomySource, number> = { ast: 0, llm: 0, docs: 0, gap: 0, ...input.itemsBySource };
  const total = TAXONOMY_ITEMS.length;
  const covered = items_by_source.ast + items_by_source.llm + items_by_source.docs;
  if (!items_by_source.gap) items_by_source.gap = Math.max(0, total - covered);
  const items_covered = Math.max(0, total - items_by_source.gap);
  const coverage_percentage = total ? (items_covered / total) * 100 : 0;
  const gaps = input.gaps ?? (items_by_source.gap > 0 ? Array.from(TAXONOMY_ITEMS) : []);
  return {
    kind: 'KnowledgeCoverageReport.v1',
    schema_version: 1,
    created_at: createdAt,
    workspace: input.workspace,
    items_covered,
    items_by_source,
    coverage_percentage,
    gaps,
    trace_refs: input.traceRefs ?? [],
  };
}
export async function writeKnowledgeCoverageReport(workspaceRoot: string, report: KnowledgeCoverageReportV1): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-');
  const dir = path.join(resolveLibrarianAuditDir(workspaceRoot), 'coverage', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'KnowledgeCoverageReport.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return reportPath;
}
export function createTrajectoryAnalysisReport(input: { workspace: string; taskId: string; violations: GuessViolation[]; recommendations: string[]; traceRefs?: string[] }): TrajectoryAnalysisReportV1 {
  return { kind: 'TrajectoryAnalysisReport.v1', schema_version: 1, created_at: new Date().toISOString(), workspace: input.workspace, task_id: input.taskId, violations: input.violations, recommendations: input.recommendations, trace_refs: input.traceRefs ?? [] };
}
export async function writeTrajectoryAnalysisReport(workspaceRoot: string, report: TrajectoryAnalysisReportV1): Promise<string> {
  const timestamp = report.created_at.replace(/[:.]/g, '-'); const dir = path.join(resolveLibrarianAuditDir(workspaceRoot), 'trajectory', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'TrajectoryAnalysisReport.v1.json'); await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8'); return reportPath;
}

function resolveBootstrapFileCoverage(report: BootstrapReport): { filesIndexed: number; totalFiles: number; coverage: number } {
  const semanticPhase = report.phases.find((phase) => phase.phase.name === 'semantic_indexing');
  const filesIndexed = semanticPhase?.metrics?.filesIndexed ?? report.totalFilesProcessed ?? 0;
  const totalFiles = semanticPhase?.metrics?.totalFiles ?? report.totalFilesProcessed ?? 0;
  const coverage = totalFiles > 0 ? filesIndexed / totalFiles : 0;
  return { filesIndexed, totalFiles, coverage };
}

async function resolveClassCount(workspaceRoot: string): Promise<number> {
  try {
    const storage = createSymbolStorage(workspaceRoot);
    await storage.initialize();
    const stats = storage.getStats();
    await storage.close();
    return stats.byKind.class ?? 0;
  } catch (error) {
    logWarning('[librarian] Failed to load symbol storage stats', {
      workspace: workspaceRoot,
      error: getErrorMessage(error),
    });
    return 0;
  }
}

async function resolveOwnershipGaps(storage: LibrarianStorage, filesIndexed: number): Promise<number> {
  try {
    const ownerships = await storage.getOwnerships();
    const ownedFiles = new Set(ownerships.map((ownership) => ownership.filePath));
    return Math.max(0, filesIndexed - ownedFiles.size);
  } catch {
    return 0;
  }
}

export async function createOnboardingBaseline(input: {
  workspaceRoot: string;
  report: BootstrapReport;
  storage: LibrarianStorage;
}): Promise<OnboardingBaseline> {
  const capturedAt = new Date().toISOString();
  const completedAt = input.report.completedAt ?? new Date();
  const bootstrapDurationMs = Math.max(0, completedAt.getTime() - input.report.startedAt.getTime());
  const coverage = resolveBootstrapFileCoverage(input.report);
  const stateReport = await generateStateReport(input.storage);
  const stats = await input.storage.getStats();
  const classCount = await resolveClassCount(input.workspaceRoot);
  const missingOwnership = await resolveOwnershipGaps(input.storage, coverage.filesIndexed);

  let providerAvailable = false;
  let modelId = 'unknown';
  let providerLatencyP50Ms = 0;
  try {
    const snapshot = await checkProviderSnapshot({ workspaceRoot: input.workspaceRoot });
    const llm = snapshot.status.llm;
    const embedding = snapshot.status.embedding;
    providerAvailable = Boolean(llm.available || embedding.available);
    modelId = llm.model ?? embedding.model ?? 'unknown';
    providerLatencyP50Ms = Math.max(llm.latencyMs ?? 0, embedding.latencyMs ?? 0);
  } catch {
    // Provider checks are best-effort for baseline metrics.
  }

  return {
    kind: 'OnboardingBaseline.v1',
    schemaVersion: 1,
    workspacePath: input.workspaceRoot,
    capturedAt,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      providerAvailable,
      modelId,
    },
    metrics: {
      bootstrapDurationMs,
      entityCoverage: coverage.coverage,
      confidenceMean: stateReport.confidenceState.meanConfidence,
      defeaterCount: stateReport.confidenceState.defeaterCount,
      providerLatencyP50Ms,
    },
    entities: {
      files: coverage.filesIndexed,
      functions: stats.totalFunctions,
      classes: classCount,
      modules: stats.totalModules,
    },
    quality: {
      orphanEntities: stateReport.codeGraphHealth.orphanEntities,
      lowConfidenceEntities: stateReport.confidenceState.lowConfidenceCount,
      missingOwnership,
    },
  };
}

export async function writeOnboardingBaseline(workspaceRoot: string, baseline: OnboardingBaseline): Promise<string> {
  const timestamp = baseline.capturedAt.replace(/[:.]/g, '-');
  const dir = path.join(resolveLibrarianAuditDir(workspaceRoot), 'baselines', timestamp);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'OnboardingBaseline.v1.json');
  await fs.writeFile(reportPath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  return reportPath;
}
