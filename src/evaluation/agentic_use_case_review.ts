import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runProviderReadinessGate } from '../api/provider_gate.js';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';
import type { LibrarianQuery, LibrarianResponse } from '../types.js';
import { withTimeout } from '../utils/async.js';
import { safeJsonParse } from '../utils/safe_json.js';

export interface AgenticUseCase {
  id: string;
  domain: string;
  need: string;
  dependencies: string[];
}

export type AgenticUseCaseSelectionMode =
  | 'balanced'
  | 'sequential'
  | 'uncertainty'
  | 'adaptive'
  | 'probabilistic';

export type AgenticUseCaseEvidenceProfile =
  | 'release'
  | 'quick'
  | 'diagnostic'
  | 'custom';

export type AgenticUseCaseStepKind = 'prerequisite' | 'target';
export type AgenticUseCaseLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'unknown';

export interface AgenticUseCasePlanItem extends AgenticUseCase {
  stepKind: AgenticUseCaseStepKind;
  requiredByTargets: string[];
  layer: AgenticUseCaseLayer;
}

export interface AgenticUseCaseRunResult {
  repo: string;
  useCaseId: string;
  domain: string;
  intent: string;
  stepKind: AgenticUseCaseStepKind;
  success: boolean;
  dependencyReady: boolean;
  missingPrerequisites: string[];
  packCount: number;
  evidenceCount: number;
  hasUsefulSummary: boolean;
  totalConfidence: number;
  strictSignals: string[];
  errors: string[];
}

export interface AgenticUseCaseExplorationCitation {
  file: string;
  line: number | null;
}

export interface AgenticUseCaseExplorationFinding {
  repo: string;
  intent: string;
  success: boolean;
  packCount: number;
  evidenceCount: number;
  hasUsefulSummary: boolean;
  totalConfidence: number;
  strictSignals: string[];
  errors: string[];
  summary: string | null;
  citations: AgenticUseCaseExplorationCitation[];
}

export interface AgenticUseCaseExplorationRepoMetrics {
  runs: number;
  successes: number;
  usefulSummaries: number;
  evidenceBearing: number;
  strictFailures: number;
}

export interface AgenticUseCaseExplorationSummary {
  enabled: boolean;
  intentsPerRepo: number;
  totalRuns: number;
  successRate: number;
  usefulSummaryRate: number;
  evidenceRate: number;
  strictFailureShare: number;
  uniqueReposCovered: number;
  byRepo: Record<string, AgenticUseCaseExplorationRepoMetrics>;
}

export interface AgenticUseCaseDomainMetrics {
  runs: number;
  passRate: number;
  evidenceRate: number;
  usefulSummaryRate: number;
}

export interface AgenticUseCaseReviewThresholds {
  minPassRate: number;
  minEvidenceRate: number;
  minUsefulSummaryRate: number;
  maxStrictFailureShare: number;
  minPrerequisitePassRate?: number;
  minTargetPassRate?: number;
  minTargetDependencyReadyShare?: number;
}

export interface AgenticUseCaseProgressionLayerMetrics {
  runs: number;
  passRate: number;
}

export interface AgenticUseCaseProgressionSummary {
  enabled: boolean;
  prerequisiteUseCases: number;
  targetUseCases: number;
  totalPlannedUseCases: number;
  prerequisiteRuns: number;
  prerequisitePassRate: number;
  targetRuns: number;
  targetPassRate: number;
  targetDependencyReadyShare: number;
  byLayer: Record<AgenticUseCaseLayer, AgenticUseCaseProgressionLayerMetrics>;
}

export interface AgenticUseCaseReviewSummary {
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  evidenceRate: number;
  usefulSummaryRate: number;
  strictFailureShare: number;
  uniqueRepos: number;
  uniqueUseCases: number;
  byDomain: Record<string, AgenticUseCaseDomainMetrics>;
  progression: AgenticUseCaseProgressionSummary;
}

export interface AgenticUseCaseReviewGate {
  passed: boolean;
  reasons: string[];
  thresholds: AgenticUseCaseReviewThresholds;
}

export interface AgenticUseCaseReviewReport {
  schema: 'AgenticUseCaseReviewReport.v1';
  createdAt: string;
  options: {
    reposRoot: string;
    matrixPath: string;
    maxRepos?: number;
    maxUseCases?: number;
    ucStart: number;
    ucEnd: number;
    repoNames?: string[];
    selectionMode: AgenticUseCaseSelectionMode;
    evidenceProfile: AgenticUseCaseEvidenceProfile;
    uncertaintyHistoryPath?: string;
    progressivePrerequisites: boolean;
    deterministicQueries: boolean;
    explorationIntentsPerRepo: number;
    initTimeoutMs: number;
    queryTimeoutMs: number;
    maxRunsPerRepo: number;
    forceProviderProbe: boolean;
  };
  selectedUseCases: AgenticUseCase[];
  plannedUseCases: AgenticUseCasePlanItem[];
  results: AgenticUseCaseRunResult[];
  exploration: {
    findings: AgenticUseCaseExplorationFinding[];
    summary: AgenticUseCaseExplorationSummary;
  };
  summary: AgenticUseCaseReviewSummary;
  gate: AgenticUseCaseReviewGate;
  artifacts?: {
    root: string;
    reportPath: string;
    repoReportPaths: string[];
  };
}

export interface AgenticUseCaseReviewOptions {
  reposRoot: string;
  matrixPath?: string;
  maxRepos?: number;
  maxUseCases?: number;
  ucStart?: number;
  ucEnd?: number;
  repoNames?: string[];
  selectionMode?: AgenticUseCaseSelectionMode;
  evidenceProfile?: AgenticUseCaseEvidenceProfile;
  uncertaintyHistoryPath?: string;
  progressivePrerequisites?: boolean;
  deterministicQueries?: boolean;
  explorationIntentsPerRepo?: number;
  thresholds?: Partial<AgenticUseCaseReviewThresholds>;
  artifactRoot?: string;
  runLabel?: string;
  initTimeoutMs?: number;
  queryTimeoutMs?: number;
  forceProviderProbe?: boolean;
  signal?: AbortSignal;
}

interface RepoManifest {
  repos?: Array<{ name: string }>;
}

interface UseCaseHistoryStats {
  runs: number;
  failures: number;
}

const DEFAULT_THRESHOLDS: AgenticUseCaseReviewThresholds = {
  minPassRate: 0.75,
  minEvidenceRate: 0.9,
  minUsefulSummaryRate: 0.8,
  maxStrictFailureShare: 0,
  minPrerequisitePassRate: 0.75,
  minTargetPassRate: 0.75,
  minTargetDependencyReadyShare: 1,
};

const EMPTY_SUMMARIES = new Set(['No context available', 'No relevant context found']);
const STRICT_FAILURE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'fallback', pattern: /\bfallback\b/i },
  { label: 'retry', pattern: /\bretr(?:y|ied|ies)\b/i },
  { label: 'degraded', pattern: /\bdegrad(?:e|ed|ing)\b/i },
  { label: 'provider_unavailable', pattern: /\bprovider_unavailable\b/i },
  { label: 'timeout', pattern: /\btimeout\b/i },
  { label: 'unverified_by_trace', pattern: /\bunverified_by_trace\(/i },
];

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (typeof reason === 'string' && reason.trim().length > 0) {
    throw new Error(reason);
  }
  throw new Error(`${label}_aborted`);
}

function resolveTimeoutMs(value: number | undefined, envName: string, fallbackMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const fromEnv = process.env[envName];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallbackMs;
}

function safeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function useCaseNumber(id: string): number {
  const match = id.match(/^UC-(\d{3})$/);
  if (!match?.[1]) return Number.NaN;
  return Number.parseInt(match[1], 10);
}

function useCaseLayer(id: string): AgenticUseCaseLayer {
  const n = useCaseNumber(id);
  if (!Number.isFinite(n)) return 'unknown';
  if (n <= 30) return 'L0';
  if (n <= 60) return 'L1';
  if (n <= 170) return 'L2';
  if (n <= 260) return 'L3';
  if (n <= 310) return 'L4';
  return 'unknown';
}

function parseDependencies(raw: string): string[] {
  const value = raw.trim();
  if (!value || value.toLowerCase() === 'none') return [];
  return uniqueStrings(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => /^UC-\d{3}$/.test(entry))
  );
}

function parseUseCaseLine(line: string): AgenticUseCase | null {
  const match = line.match(/^\|\s*(UC-\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
  if (!match) return null;
  const [id, domain, need, dependenciesRaw] = match.slice(1).map((part) => part?.trim() ?? '');
  if (!id || !domain || !need) return null;
  return { id, domain, need, dependencies: parseDependencies(dependenciesRaw) };
}

export function parseUseCaseMatrixMarkdown(markdown: string): AgenticUseCase[] {
  const useCases: AgenticUseCase[] = [];
  for (const line of markdown.split('\n')) {
    const parsed = parseUseCaseLine(line);
    if (parsed) useCases.push(parsed);
  }
  return useCases;
}

function createHistoryStats(history: unknown): Map<string, UseCaseHistoryStats> {
  const stats = new Map<string, UseCaseHistoryStats>();
  const parsed = history as { results?: Array<{ useCaseId?: string; success?: boolean }> } | null;
  for (const result of parsed?.results ?? []) {
    if (!result?.useCaseId || !/^UC-\d{3}$/.test(result.useCaseId)) continue;
    const current = stats.get(result.useCaseId) ?? { runs: 0, failures: 0 };
    current.runs += 1;
    if (result.success !== true) current.failures += 1;
    stats.set(result.useCaseId, current);
  }
  return stats;
}

function selectUseCases(
  useCases: AgenticUseCase[],
  maxUseCases: number,
  mode: AgenticUseCaseSelectionMode,
  historyStats?: Map<string, UseCaseHistoryStats>,
): AgenticUseCase[] {
  const ranked = [...useCases];
  if (mode === 'uncertainty' || mode === 'adaptive' || mode === 'probabilistic') {
    ranked.sort((left, right) => {
      const leftFailures = historyStats?.get(left.id)?.failures ?? 0;
      const rightFailures = historyStats?.get(right.id)?.failures ?? 0;
      if (rightFailures !== leftFailures) return rightFailures - leftFailures;
      return useCaseNumber(left.id) - useCaseNumber(right.id);
    });
  } else if (mode === 'balanced') {
    ranked.sort((left, right) => left.domain.localeCompare(right.domain) || useCaseNumber(left.id) - useCaseNumber(right.id));
  } else {
    ranked.sort((left, right) => useCaseNumber(left.id) - useCaseNumber(right.id));
  }
  if (maxUseCases <= 0 || ranked.length <= maxUseCases) return ranked;
  return ranked.slice(0, maxUseCases);
}

async function resolveRepoNames(
  reposRoot: string,
  repoNames: string[] | undefined,
  maxRepos: number | undefined,
): Promise<string[]> {
  let names = repoNames?.filter((name) => name.trim().length > 0) ?? [];
  if (names.length === 0) {
    try {
      const manifestRaw = await readFile(path.join(reposRoot, 'manifest.json'), 'utf8');
      const parsed = safeJsonParse<RepoManifest>(manifestRaw);
      names = parsed.ok
        ? (parsed.value.repos ?? []).map((entry) => entry.name).filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        : [];
    } catch {
      names = [];
    }
  }
  if (names.length === 0) {
    const entries = await readdir(reposRoot, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
  if (typeof maxRepos === 'number' && maxRepos > 0) {
    return names.slice(0, maxRepos);
  }
  return names;
}

function buildUseCaseIntent(useCase: Pick<AgenticUseCase, 'id' | 'need'>): string {
  return `What is the evidence-grounded implementation context for ${useCase.id}: ${useCase.need}? Include concrete file references.`;
}

function buildExplorationIntents(count: number): string[] {
  const base = [
    'Explore this repository naturally and identify the top likely functional or reliability risks. Cite concrete files and why each risk matters.',
    'Identify areas that feel suboptimal for real agent productivity in this repository. Include concrete friction points and evidence-backed fixes.',
    'If you had to prioritize high-impact improvements next, what would they be and why? Cite concrete files, tests, or interfaces.',
    'Call out likely hidden failure modes or brittle assumptions not obvious from happy-path behavior. Include file-level evidence.',
  ];
  return Array.from({ length: count }, (_, index) => base[index] ?? `Explore this repository and surface high-impact issues (#${index + 1}).`);
}

export function createAgenticUseCaseQuery(options: {
  intent: string;
  deterministicQueries: boolean;
  queryTimeoutMs: number;
}): LibrarianQuery {
  return {
    intent: options.intent,
    depth: 'L1',
    llmRequirement: 'required',
    embeddingRequirement: 'required',
    disableCache: true,
    includeEngines: false,
    deterministic: options.deterministicQueries,
    timeoutMs: options.queryTimeoutMs,
    disableMethodGuidance: true,
    forceSummarySynthesis: true,
  };
}

function collectStrictSignalTexts(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrictSignalTexts(entry, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectStrictSignalTexts(entry, out);
  }
}

function detectStrictSignals(value: unknown): string[] {
  const texts: string[] = [];
  collectStrictSignalTexts(value, texts);
  const joined = texts.join('\n');
  return uniqueStrings(
    STRICT_FAILURE_PATTERNS
      .filter((entry) => entry.pattern.test(joined))
      .map((entry) => entry.label)
  );
}

function summarizeResponseQuality(response: LibrarianResponse): {
  packCount: number;
  evidenceCount: number;
  hasUsefulSummary: boolean;
  strictSignals: string[];
} {
  const packs = response.packs ?? [];
  const snippetCount = packs.reduce((sum, pack) => sum + (pack.codeSnippets?.length ?? 0), 0);
  const relatedFileCount = packs.reduce((sum, pack) => sum + (pack.relatedFiles?.length ?? 0), 0);
  const citationCount = response.synthesis?.citations?.length ?? 0;
  const evidenceCount = snippetCount + relatedFileCount + citationCount;
  const hasUsefulSummary = packs.some((pack) => {
    const summary = (pack.summary ?? '').trim();
    return summary.length > 0 && !EMPTY_SUMMARIES.has(summary);
  }) || Boolean(response.synthesis?.answer?.trim());
  const strictSignals = detectStrictSignals({
    disclosures: response.disclosures,
    coverageGaps: response.coverageGaps,
    synthesisUncertainties: response.synthesis?.uncertainties,
    queryReasons: response.queryDiagnostics?.reasons,
  });
  return {
    packCount: packs.length,
    evidenceCount,
    hasUsefulSummary,
    strictSignals,
  };
}

function summarizeExplorationAnswer(response: LibrarianResponse): string | null {
  const answer = response.synthesis?.answer?.trim();
  if (answer) return answer.replace(/\s+/g, ' ').trim();
  const summary = response.packs?.map((pack) => pack.summary?.trim() ?? '').find((value) => value.length > 0 && !EMPTY_SUMMARIES.has(value));
  return summary ? summary.replace(/\s+/g, ' ').trim() : null;
}

function extractExplorationCitations(response: LibrarianResponse, limit = 6): AgenticUseCaseExplorationCitation[] {
  const out: AgenticUseCaseExplorationCitation[] = [];
  const seen = new Set<string>();
  for (const citation of response.synthesis?.citations ?? []) {
    const file = typeof citation?.file === 'string' ? citation.file.trim() : '';
    if (!file) continue;
    const line = typeof citation?.line === 'number' && Number.isFinite(citation.line) ? citation.line : null;
    const key = `${file}:${line ?? 'null'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, line });
    if (out.length >= limit) break;
  }
  return out;
}

function resolveReviewThresholds(overrides?: Partial<AgenticUseCaseReviewThresholds>): AgenticUseCaseReviewThresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    ),
  };
}

function summarizeExplorationFindings(
  findings: AgenticUseCaseExplorationFinding[],
  selectedRepos: string[],
  intentsPerRepo: number,
): AgenticUseCaseExplorationSummary {
  const byRepo = Object.fromEntries(
    selectedRepos.map((repo) => [repo, {
      runs: 0,
      successes: 0,
      usefulSummaries: 0,
      evidenceBearing: 0,
      strictFailures: 0,
    } satisfies AgenticUseCaseExplorationRepoMetrics])
  ) as Record<string, AgenticUseCaseExplorationRepoMetrics>;

  for (const finding of findings) {
    const repo = byRepo[finding.repo] ?? (byRepo[finding.repo] = {
      runs: 0,
      successes: 0,
      usefulSummaries: 0,
      evidenceBearing: 0,
      strictFailures: 0,
    });
    repo.runs += 1;
    if (finding.success) repo.successes += 1;
    if (finding.hasUsefulSummary) repo.usefulSummaries += 1;
    if (finding.evidenceCount > 0) repo.evidenceBearing += 1;
    if (finding.strictSignals.length > 0) repo.strictFailures += 1;
  }

  return {
    enabled: intentsPerRepo > 0,
    intentsPerRepo,
    totalRuns: findings.length,
    successRate: safeRate(findings.filter((item) => item.success).length, findings.length),
    usefulSummaryRate: safeRate(findings.filter((item) => item.hasUsefulSummary).length, findings.length),
    evidenceRate: safeRate(findings.filter((item) => item.evidenceCount > 0).length, findings.length),
    strictFailureShare: safeRate(findings.filter((item) => item.strictSignals.length > 0).length, findings.length),
    uniqueReposCovered: new Set(findings.map((item) => item.repo)).size,
    byRepo,
  };
}

function summarizeProgression(
  results: AgenticUseCaseRunResult[],
  plannedUseCases: AgenticUseCasePlanItem[],
  progressiveEnabled: boolean,
): AgenticUseCaseProgressionSummary {
  const emptyLayers: Record<AgenticUseCaseLayer, AgenticUseCaseProgressionLayerMetrics> = {
    L0: { runs: 0, passRate: 0 },
    L1: { runs: 0, passRate: 0 },
    L2: { runs: 0, passRate: 0 },
    L3: { runs: 0, passRate: 0 },
    L4: { runs: 0, passRate: 0 },
    unknown: { runs: 0, passRate: 0 },
  };

  const prerequisiteRuns = results.filter((result) => result.stepKind === 'prerequisite');
  const targetRuns = results.filter((result) => result.stepKind === 'target');
  const layerCounts = new Map<AgenticUseCaseLayer, { runs: number; passed: number }>();
  for (const result of results) {
    const layer = plannedUseCases.find((item) => item.id === result.useCaseId)?.layer ?? useCaseLayer(result.useCaseId);
    const current = layerCounts.get(layer) ?? { runs: 0, passed: 0 };
    current.runs += 1;
    if (result.success) current.passed += 1;
    layerCounts.set(layer, current);
  }
  for (const [layer, current] of layerCounts.entries()) {
    emptyLayers[layer] = {
      runs: current.runs,
      passRate: safeRate(current.passed, current.runs),
    };
  }

  return {
    enabled: progressiveEnabled && plannedUseCases.some((item) => item.stepKind === 'prerequisite'),
    prerequisiteUseCases: plannedUseCases.filter((item) => item.stepKind === 'prerequisite').length,
    targetUseCases: plannedUseCases.filter((item) => item.stepKind === 'target').length,
    totalPlannedUseCases: plannedUseCases.length,
    prerequisiteRuns: prerequisiteRuns.length,
    prerequisitePassRate: safeRate(prerequisiteRuns.filter((result) => result.success).length, prerequisiteRuns.length),
    targetRuns: targetRuns.length,
    targetPassRate: safeRate(targetRuns.filter((result) => result.success).length, targetRuns.length),
    targetDependencyReadyShare: safeRate(targetRuns.filter((result) => result.dependencyReady).length, targetRuns.length),
    byLayer: emptyLayers,
  };
}

function summarizeUseCaseReview(
  results: AgenticUseCaseRunResult[],
  selectedUseCases: AgenticUseCase[],
  selectedRepos: string[],
  plannedUseCases: AgenticUseCasePlanItem[],
  progressiveEnabled: boolean,
): AgenticUseCaseReviewSummary {
  const byDomain = new Map<string, AgenticUseCaseRunResult[]>();
  for (const result of results) {
    const bucket = byDomain.get(result.domain) ?? [];
    bucket.push(result);
    byDomain.set(result.domain, bucket);
  }
  const domainMetrics = Object.fromEntries(
    Array.from(byDomain.entries()).map(([domain, runs]) => [
      domain,
      {
        runs: runs.length,
        passRate: safeRate(runs.filter((item) => item.success).length, runs.length),
        evidenceRate: safeRate(runs.filter((item) => item.evidenceCount > 0).length, runs.length),
        usefulSummaryRate: safeRate(runs.filter((item) => item.hasUsefulSummary).length, runs.length),
      } satisfies AgenticUseCaseDomainMetrics,
    ])
  );

  return {
    totalRuns: results.length,
    passedRuns: results.filter((item) => item.success).length,
    passRate: safeRate(results.filter((item) => item.success).length, results.length),
    evidenceRate: safeRate(results.filter((item) => item.evidenceCount > 0).length, results.length),
    usefulSummaryRate: safeRate(results.filter((item) => item.hasUsefulSummary).length, results.length),
    strictFailureShare: safeRate(results.filter((item) => item.strictSignals.length > 0).length, results.length),
    uniqueRepos: selectedRepos.length,
    uniqueUseCases: selectedUseCases.length,
    byDomain: domainMetrics,
    progression: summarizeProgression(results, plannedUseCases, progressiveEnabled),
  };
}

function evaluateUseCaseReviewGate(
  summary: AgenticUseCaseReviewSummary,
  thresholds: AgenticUseCaseReviewThresholds,
): AgenticUseCaseReviewGate {
  const reasons: string[] = [];
  if (summary.totalRuns === 0) reasons.push('no_runs_executed');
  if (summary.passRate < thresholds.minPassRate) reasons.push('pass_rate_below_threshold');
  if (summary.evidenceRate < thresholds.minEvidenceRate) reasons.push('evidence_rate_below_threshold');
  if (summary.usefulSummaryRate < thresholds.minUsefulSummaryRate) reasons.push('useful_summary_rate_below_threshold');
  if (summary.strictFailureShare > thresholds.maxStrictFailureShare) reasons.push('strict_failure_share_above_threshold');
  if (summary.progression.enabled) {
    if (summary.progression.prerequisitePassRate < (thresholds.minPrerequisitePassRate ?? thresholds.minPassRate)) {
      reasons.push('prerequisite_pass_rate_below_threshold');
    }
    if (summary.progression.targetPassRate < (thresholds.minTargetPassRate ?? thresholds.minPassRate)) {
      reasons.push('target_pass_rate_below_threshold');
    }
    if (summary.progression.targetDependencyReadyShare < (thresholds.minTargetDependencyReadyShare ?? 1)) {
      reasons.push('target_dependency_ready_share_below_threshold');
    }
  }
  return { passed: reasons.length === 0, reasons, thresholds };
}

function buildPlannedUseCases(selectedUseCases: AgenticUseCase[], progressivePrerequisites: boolean): AgenticUseCasePlanItem[] {
  const selectedIds = new Set(selectedUseCases.map((useCase) => useCase.id));
  const prerequisites = new Map<string, AgenticUseCasePlanItem>();
  const targets: AgenticUseCasePlanItem[] = [];

  for (const useCase of selectedUseCases) {
    for (const dependency of useCase.dependencies) {
      if (!progressivePrerequisites || selectedIds.has(dependency)) continue;
      prerequisites.set(dependency, {
        id: dependency,
        domain: useCase.domain,
        need: `Prerequisite for ${useCase.id}`,
        dependencies: [],
        stepKind: 'prerequisite',
        requiredByTargets: [useCase.id],
        layer: useCaseLayer(dependency),
      });
    }
    targets.push({
      ...useCase,
      stepKind: 'target',
      requiredByTargets: [useCase.id],
      layer: useCaseLayer(useCase.id),
    });
  }

  return [
    ...Array.from(prerequisites.values()).sort((left, right) => useCaseNumber(left.id) - useCaseNumber(right.id)),
    ...targets.sort((left, right) => useCaseNumber(left.id) - useCaseNumber(right.id)),
  ];
}

export async function runAgenticUseCaseReview(
  options: AgenticUseCaseReviewOptions,
): Promise<AgenticUseCaseReviewReport> {
  throwIfAborted(options.signal, 'agentic_use_case_review');

  const reposRoot = path.resolve(options.reposRoot);
  const matrixPath = path.resolve(options.matrixPath ?? path.join(process.cwd(), 'docs', 'librarian', 'USE_CASE_MATRIX.md'));
  const ucStart = options.ucStart ?? 1;
  const ucEnd = options.ucEnd ?? 310;
  const selectionMode = options.selectionMode ?? 'probabilistic';
  const evidenceProfile = options.evidenceProfile ?? 'custom';
  const progressivePrerequisites = options.progressivePrerequisites ?? true;
  const deterministicQueries = options.deterministicQueries ?? false;
  const maxUseCases = options.maxUseCases ?? 120;
  const initTimeoutMs = resolveTimeoutMs(options.initTimeoutMs, 'LIBRARIAN_USE_CASE_INIT_TIMEOUT_MS', 300_000);
  const queryTimeoutMs = resolveTimeoutMs(options.queryTimeoutMs, 'LIBRARIAN_USE_CASE_QUERY_TIMEOUT_MS', 120_000);
  const explorationIntentsPerRepo = options.explorationIntentsPerRepo ?? (evidenceProfile === 'release' ? 3 : evidenceProfile === 'diagnostic' ? 4 : 1);
  const thresholds = resolveReviewThresholds(options.thresholds);
  const uncertaintyHistoryPath = options.uncertaintyHistoryPath
    ? path.resolve(options.uncertaintyHistoryPath)
    : path.resolve(process.cwd(), 'eval-results', 'agentic-use-case-review.json');
  const forceProviderProbe = options.forceProviderProbe ?? evidenceProfile === 'release';

  const matrixMarkdown = await readFile(matrixPath, 'utf8');
  const allUseCases = parseUseCaseMatrixMarkdown(matrixMarkdown).filter((useCase) => {
    const number = useCaseNumber(useCase.id);
    return Number.isFinite(number) && number >= ucStart && number <= ucEnd;
  });

  let historyStats: Map<string, UseCaseHistoryStats> | undefined;
  try {
    const historyRaw = await readFile(uncertaintyHistoryPath, 'utf8');
    const history = safeJsonParse<unknown>(historyRaw);
    if (history.ok) {
      historyStats = createHistoryStats(history.value);
    }
  } catch {
    historyStats = undefined;
  }

  const selectedUseCases = selectUseCases(allUseCases, maxUseCases, selectionMode, historyStats);
  const selectedRepos = await resolveRepoNames(reposRoot, options.repoNames, options.maxRepos);
  const maxRunsPerRepo = Math.max(1, Math.ceil(Math.max(1, selectedUseCases.length) / Math.max(1, selectedRepos.length || 1)));
  const plannedUseCases = buildPlannedUseCases(selectedUseCases, progressivePrerequisites);
  const explorationIntents = buildExplorationIntents(explorationIntentsPerRepo);
  const results: AgenticUseCaseRunResult[] = [];
  const explorationFindings: AgenticUseCaseExplorationFinding[] = [];
  const repoReportPaths: string[] = [];
  const runLabel = options.runLabel?.trim().length ? sanitizePathSegment(options.runLabel) : `agentic-use-cases-${Date.now()}`;
  const artifactsRoot = options.artifactRoot?.trim().length ? path.resolve(options.artifactRoot, runLabel) : null;

  for (const repoName of selectedRepos) {
    throwIfAborted(options.signal, 'agentic_use_case_review');
    const repoRoot = path.join(reposRoot, repoName);
    let providerSnapshot: unknown = null;
    let repoError: string | null = null;
    let librarianForCleanup: { shutdown(): Promise<void> } | null = null;
    const repoResults: AgenticUseCaseRunResult[] = [];
    const repoExplorationFindings: AgenticUseCaseExplorationFinding[] = [];

    try {
      const providerGate = await withTimeout(
        runProviderReadinessGate(repoRoot, { emitReport: true, forceProbe: forceProviderProbe }),
        initTimeoutMs,
        { context: `unverified_by_trace(timeout_provider_gate): ${repoName}` },
      );
      providerSnapshot = {
        ready: providerGate.ready,
        llmReady: providerGate.llmReady,
        embeddingReady: providerGate.embeddingReady,
        selectedProvider: providerGate.selectedProvider ?? null,
        reason: providerGate.reason ?? null,
      };
      if (!providerGate.ready || !providerGate.llmReady || !providerGate.embeddingReady) {
        throw new Error(`unverified_by_trace(provider_unavailable): ${providerGate.reason ?? 'provider gate not ready'}`);
      }

      const gateResult = await withTimeout(
        ensureLibrarianReady(repoRoot, {
          allowDegradedEmbeddings: false,
          skipLlm: true,
          requireCompleteParserCoverage: true,
          throwOnFailure: true,
          timeoutMs: initTimeoutMs,
          maxWaitForBootstrapMs: initTimeoutMs,
          providerGate: async () => providerGate,
        }),
        initTimeoutMs,
        { context: `unverified_by_trace(timeout_initialization): ${repoName}` },
      );
      if (!gateResult.librarian) {
        throw new Error('unverified_by_trace(initialization_failed): librarian unavailable');
      }
      librarianForCleanup = gateResult.librarian;

      for (const useCase of plannedUseCases) {
        throwIfAborted(options.signal, 'agentic_use_case_review');
        const intent = buildUseCaseIntent(useCase);
        const missingPrerequisites = useCase.stepKind === 'target'
          ? useCase.dependencies.filter((dependency) => !repoResults.some((result) => result.useCaseId === dependency && result.success))
          : [];
        try {
          const response = await withTimeout(
            gateResult.librarian.queryRequired(createAgenticUseCaseQuery({
              intent,
              deterministicQueries,
              queryTimeoutMs,
            })),
            queryTimeoutMs,
            { context: `unverified_by_trace(timeout_query): ${repoName}:${useCase.id}` },
          );
          const quality = summarizeResponseQuality(response);
          const strictSignals = uniqueStrings([
            ...quality.strictSignals,
            ...(missingPrerequisites.length > 0 ? ['prerequisite_missing'] : []),
          ]);
          const run: AgenticUseCaseRunResult = {
            repo: repoName,
            useCaseId: useCase.id,
            domain: useCase.domain,
            intent,
            stepKind: useCase.stepKind,
            success: quality.packCount > 0 && quality.evidenceCount > 0 && quality.hasUsefulSummary && strictSignals.length === 0,
            dependencyReady: missingPrerequisites.length === 0,
            missingPrerequisites,
            packCount: quality.packCount,
            evidenceCount: quality.evidenceCount,
            hasUsefulSummary: quality.hasUsefulSummary,
            totalConfidence: response.totalConfidence ?? 0,
            strictSignals,
            errors: [],
          };
          results.push(run);
          repoResults.push(run);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const run: AgenticUseCaseRunResult = {
            repo: repoName,
            useCaseId: useCase.id,
            domain: useCase.domain,
            intent,
            stepKind: useCase.stepKind,
            success: false,
            dependencyReady: missingPrerequisites.length === 0,
            missingPrerequisites,
            packCount: 0,
            evidenceCount: 0,
            hasUsefulSummary: false,
            totalConfidence: 0,
            strictSignals: uniqueStrings([...detectStrictSignals(message), ...(missingPrerequisites.length > 0 ? ['prerequisite_missing'] : [])]),
            errors: [message],
          };
          results.push(run);
          repoResults.push(run);
        }
      }

      for (const intent of explorationIntents) {
        throwIfAborted(options.signal, 'agentic_use_case_review');
        try {
          const response = await withTimeout(
            gateResult.librarian.queryRequired(createAgenticUseCaseQuery({
              intent,
              deterministicQueries,
              queryTimeoutMs,
            })),
            queryTimeoutMs,
            { context: `unverified_by_trace(timeout_query): ${repoName}:exploration` },
          );
          const quality = summarizeResponseQuality(response);
          const finding: AgenticUseCaseExplorationFinding = {
            repo: repoName,
            intent,
            success: quality.packCount > 0 && quality.evidenceCount > 0 && quality.hasUsefulSummary && quality.strictSignals.length === 0,
            packCount: quality.packCount,
            evidenceCount: quality.evidenceCount,
            hasUsefulSummary: quality.hasUsefulSummary,
            totalConfidence: response.totalConfidence ?? 0,
            strictSignals: quality.strictSignals,
            errors: [],
            summary: summarizeExplorationAnswer(response),
            citations: extractExplorationCitations(response),
          };
          explorationFindings.push(finding);
          repoExplorationFindings.push(finding);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const finding: AgenticUseCaseExplorationFinding = {
            repo: repoName,
            intent,
            success: false,
            packCount: 0,
            evidenceCount: 0,
            hasUsefulSummary: false,
            totalConfidence: 0,
            strictSignals: detectStrictSignals(message),
            errors: [message],
            summary: null,
            citations: [],
          };
          explorationFindings.push(finding);
          repoExplorationFindings.push(finding);
        }
      }
    } catch (error) {
      repoError = error instanceof Error ? error.message : String(error);
      for (const useCase of plannedUseCases) {
        const intent = buildUseCaseIntent(useCase);
        const run: AgenticUseCaseRunResult = {
          repo: repoName,
          useCaseId: useCase.id,
          domain: useCase.domain,
          intent,
          stepKind: useCase.stepKind,
          success: false,
          dependencyReady: false,
          missingPrerequisites: useCase.dependencies,
          packCount: 0,
          evidenceCount: 0,
          hasUsefulSummary: false,
          totalConfidence: 0,
          strictSignals: detectStrictSignals(repoError),
          errors: [repoError],
        };
        results.push(run);
        repoResults.push(run);
      }
      for (const intent of explorationIntents) {
        const finding: AgenticUseCaseExplorationFinding = {
          repo: repoName,
          intent,
          success: false,
          packCount: 0,
          evidenceCount: 0,
          hasUsefulSummary: false,
          totalConfidence: 0,
          strictSignals: detectStrictSignals(repoError),
          errors: [repoError],
          summary: null,
          citations: [],
        };
        explorationFindings.push(finding);
        repoExplorationFindings.push(finding);
      }
    } finally {
      if (librarianForCleanup) {
        await librarianForCleanup.shutdown().catch(() => {});
      }
    }

    if (artifactsRoot) {
      const repoReportPath = path.join(artifactsRoot, 'repos', `${sanitizePathSegment(repoName)}.json`);
      await mkdir(path.dirname(repoReportPath), { recursive: true });
      await writeFile(repoReportPath, JSON.stringify({
        schema: 'AgenticUseCaseRepoReport.v1',
        createdAt: new Date().toISOString(),
        repo: repoName,
        providerSnapshot,
        error: repoError,
        results: repoResults,
        explorationFindings: repoExplorationFindings,
      }, null, 2), 'utf8');
      repoReportPaths.push(repoReportPath);
    }
  }

  const summary = summarizeUseCaseReview(
    results,
    selectedUseCases,
    selectedRepos,
    plannedUseCases,
    progressivePrerequisites,
  );
  const gate = evaluateUseCaseReviewGate(summary, thresholds);
  const report: AgenticUseCaseReviewReport = {
    schema: 'AgenticUseCaseReviewReport.v1',
    createdAt: new Date().toISOString(),
    options: {
      reposRoot,
      matrixPath,
      maxRepos: options.maxRepos,
      maxUseCases,
      ucStart,
      ucEnd,
      repoNames: options.repoNames,
      selectionMode,
      evidenceProfile,
      uncertaintyHistoryPath: selectionMode === 'adaptive' || selectionMode === 'probabilistic' || selectionMode === 'uncertainty'
        ? uncertaintyHistoryPath
        : undefined,
      progressivePrerequisites,
      deterministicQueries,
      explorationIntentsPerRepo,
      initTimeoutMs,
      queryTimeoutMs,
      maxRunsPerRepo,
      forceProviderProbe,
    },
    selectedUseCases,
    plannedUseCases,
    results,
    exploration: {
      findings: explorationFindings,
      summary: summarizeExplorationFindings(explorationFindings, selectedRepos, explorationIntentsPerRepo),
    },
    summary,
    gate,
  };

  if (artifactsRoot) {
    const reportPath = path.join(artifactsRoot, 'report.json');
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    report.artifacts = {
      root: artifactsRoot,
      reportPath,
      repoReportPaths,
    };
  }

  return report;
}
