import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureLibrarianReady } from '../integration/first_run_gate.js';
import { runProviderReadinessGate } from '../api/provider_gate.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { withTimeout } from '../utils/async.js';
import type { LibrarianQuery, LibrarianResponse } from '../types.js';

export interface AgenticUseCase {
  id: string;
  domain: string;
  need: string;
  dependencies: string[];
}

export type AgenticUseCaseSelectionMode = 'balanced' | 'sequential' | 'uncertainty' | 'adaptive' | 'probabilistic';
export type AgenticUseCaseEvidenceProfile = 'release' | 'quick' | 'diagnostic' | 'custom';

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
  signal?: AbortSignal;
}

interface RepoManifest {
  repos?: Array<{ name: string }>;
}

const EMPTY_SUMMARIES = new Set(['No context available', 'No relevant context found']);
const NON_STRICT_UNVERIFIED_REASONS = new Set([
  'adequacy_missing',
  'multi_agent_conflict',
  'watch_state_missing',
  'watch_state_unavailable',
]);
const STRICT_FAILURE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'fallback', pattern: /\bverification_fallback\b/i },
  { label: 'fallback', pattern: /\bunverified_by_trace\([^)]*fallback[^)]*\)/i },
  { label: 'fallback', pattern: /\bfallback_(?:used|mode|path|applied|disallowed)\b/i },
  { label: 'retry', pattern: /\bretr(?:y|ied|ies)\b/i },
  { label: 'degraded', pattern: /\bdegrad(?:e|ed|ing)\b/i },
  { label: 'prerequisite_missing', pattern: /\bprerequisite_(?:not_satisfied|missing)\b/i },
  { label: 'provider_unavailable', pattern: /\bprovider_unavailable\b/i },
  { label: 'validation_unavailable', pattern: /\bvalidation_unavailable\b/i },
  { label: 'timeout', pattern: /\btimeout\b/i },
];
const DEFAULT_THRESHOLDS: AgenticUseCaseReviewThresholds = {
  minPassRate: 0.75,
  minEvidenceRate: 0.9,
  minUsefulSummaryRate: 0.8,
  maxStrictFailureShare: 0,
  minPrerequisitePassRate: 0.75,
  minTargetPassRate: 0.75,
  minTargetDependencyReadyShare: 1,
};

export interface AgenticUseCaseQueryOptions {
  intent: string;
  deterministicQueries: boolean;
  queryTimeoutMs: number;
}

export function createAgenticUseCaseQuery(options: AgenticUseCaseQueryOptions): LibrarianQuery {
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

function buildUseCaseIntent(useCase: Pick<AgenticUseCase, 'id' | 'need'>): string {
  return `What is the evidence-grounded implementation context for ${useCase.id}: ${useCase.need}? Include concrete file references.`;
}

function buildExplorationIntents(): string[] {
  return [
    'Explore this repository naturally and identify the top likely functional or reliability risks. Cite concrete files and why each risk matters.',
    'Identify areas that feel suboptimal for real agent productivity in this repository. Include concrete friction points and evidence-backed fixes.',
    'If you had to prioritize high-impact improvements next, what would they be and why? Cite concrete files, tests, or interfaces.',
    'Call out likely hidden failure modes or brittle assumptions not obvious from happy-path behavior. Include file-level evidence.',
  ];
}

function resolveExplorationIntentsPerRepo(
  requested: number | undefined,
  evidenceProfile: AgenticUseCaseEvidenceProfile
): number {
  if (typeof requested === 'number' && Number.isFinite(requested) && requested >= 0) {
    return Math.floor(requested);
  }
  switch (evidenceProfile) {
    case 'quick':
      return 1;
    case 'diagnostic':
      return 4;
    case 'release':
      return 3;
    default:
      return 1;
  }
}

export function resolveReviewThresholds(
  overrides?: Partial<AgenticUseCaseReviewThresholds>
): AgenticUseCaseReviewThresholds {
  const merged: AgenticUseCaseReviewThresholds = { ...DEFAULT_THRESHOLDS };
  if (!overrides) return merged;
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    switch (key) {
      case 'minPassRate':
        merged.minPassRate = value;
        break;
      case 'minEvidenceRate':
        merged.minEvidenceRate = value;
        break;
      case 'minUsefulSummaryRate':
        merged.minUsefulSummaryRate = value;
        break;
      case 'maxStrictFailureShare':
        merged.maxStrictFailureShare = value;
        break;
      case 'minPrerequisitePassRate':
        merged.minPrerequisitePassRate = value;
        break;
      case 'minTargetPassRate':
        merged.minTargetPassRate = value;
        break;
      case 'minTargetDependencyReadyShare':
        merged.minTargetDependencyReadyShare = value;
        break;
      default:
        break;
    }
  }
  return merged;
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (typeof reason === 'string' && reason.trim().length > 0) {
    throw new Error(reason);
  }
  throw new Error(`${label}_aborted`);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function resolveTimeoutMs(value: number | undefined, fallbackEnv: string, defaultMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const fromEnvRaw = process.env[fallbackEnv];
  if (typeof fromEnvRaw === 'string' && fromEnvRaw.trim().length > 0) {
    const parsed = Number(fromEnvRaw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return defaultMs;
}

function useCaseNumber(id: string): number {
  const match = id.match(/^UC-(\d{3})$/);
  if (!match) return Number.NaN;
  return Number.parseInt(match[1] ?? '0', 10);
}

function useCaseLayer(id: string): AgenticUseCaseLayer {
  const n = useCaseNumber(id);
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 1 && n <= 30) return 'L0';
  if (n >= 31 && n <= 60) return 'L1';
  if (n >= 61 && n <= 170) return 'L2';
  if (n >= 171 && n <= 260) return 'L3';
  if (n >= 261 && n <= 310) return 'L4';
  return 'unknown';
}

function parseDependencies(raw: string): string[] {
  const value = raw.trim();
  if (value.length === 0 || value.toLowerCase() === 'none') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^UC-\d{3}$/.test(entry));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function safeRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function parseUseCaseLine(line: string): AgenticUseCase | null {
  const match = line.match(/^\|\s*(UC-\d{3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
  if (!match) return null;
  const id = match[1]?.trim();
  const domain = match[2]?.trim();
  const need = match[3]?.trim();
  const dependenciesRaw = match[4]?.trim();
  if (!id || !domain || !need || !dependenciesRaw) return null;
  return {
    id,
    domain,
    need,
    dependencies: parseDependencies(dependenciesRaw),
  };
}

export function parseUseCaseMatrixMarkdown(markdown: string): AgenticUseCase[] {
  const useCases: AgenticUseCase[] = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const parsed = parseUseCaseLine(line);
    if (!parsed) continue;
    useCases.push(parsed);
  }
  return useCases;
}

function selectUseCasesSequential(
  useCases: AgenticUseCase[],
  maxUseCases: number
): AgenticUseCase[] {
  if (maxUseCases <= 0 || useCases.length <= maxUseCases) return useCases;
  return useCases.slice(0, maxUseCases);
}

function selectUseCasesBalanced(
  useCases: AgenticUseCase[],
  maxUseCases: number
): AgenticUseCase[] {
  if (maxUseCases <= 0 || useCases.length <= maxUseCases) return useCases;
  const byDomain = new Map<string, AgenticUseCase[]>();
  for (const uc of useCases) {
    const list = byDomain.get(uc.domain) ?? [];
    list.push(uc);
    byDomain.set(uc.domain, list);
  }
  const domains = Array.from(byDomain.keys()).sort();
  const selected: AgenticUseCase[] = [];
  while (selected.length < maxUseCases) {
    let madeProgress = false;
    for (const domain of domains) {
      if (selected.length >= maxUseCases) break;
      const queue = byDomain.get(domain) ?? [];
      const next = queue.shift();
      if (!next) continue;
      selected.push(next);
      madeProgress = true;
    }
    if (!madeProgress) break;
  }
  return selected;
}

function selectUseCasesAdaptive(
  useCases: AgenticUseCase[],
  maxUseCases: number,
  uncertaintyScores: Map<string, number> | undefined
): AgenticUseCase[] {
  if (maxUseCases <= 0 || useCases.length <= maxUseCases) return useCases;
  const scored = useCases.map((useCase) => ({
    useCase,
    score: uncertaintyScores?.get(useCase.id) ?? 1,
  }));
  const byUncertaintyDesc = [...scored].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return useCaseNumber(left.useCase.id) - useCaseNumber(right.useCase.id);
  });
  const byUncertaintyAsc = [...scored].sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    return useCaseNumber(left.useCase.id) - useCaseNumber(right.useCase.id);
  });

  const uncertainBudget = maxUseCases <= 2
    ? maxUseCases
    : Math.max(1, Math.floor(maxUseCases * 0.75));
  const stableBudget = Math.max(0, maxUseCases - uncertainBudget);
  const stablePool = byUncertaintyAsc.filter((entry) => entry.score <= 0.15);
  const stableCandidates = stablePool.length > 0 ? stablePool : byUncertaintyAsc;
  const selected: AgenticUseCase[] = [];
  const selectedIds = new Set<string>();

  for (const entry of byUncertaintyDesc) {
    if (selected.length >= uncertainBudget) break;
    selected.push(entry.useCase);
    selectedIds.add(entry.useCase.id);
  }

  for (const entry of stableCandidates) {
    if (selected.length >= uncertainBudget + stableBudget) break;
    if (selectedIds.has(entry.useCase.id)) continue;
    selected.push(entry.useCase);
    selectedIds.add(entry.useCase.id);
  }

  if (selected.length < maxUseCases) {
    for (const entry of byUncertaintyDesc) {
      if (selected.length >= maxUseCases) break;
      if (selectedIds.has(entry.useCase.id)) continue;
      selected.push(entry.useCase);
      selectedIds.add(entry.useCase.id);
    }
  }

  return selected;
}

function computeSelectionProbability(
  useCaseId: string,
  uncertaintyScores: Map<string, number> | undefined,
  historyStats: Map<string, UseCaseHistoryStats> | undefined
): number {
  const uncertainty = clamp01(uncertaintyScores?.get(useCaseId) ?? 1);
  const stats = historyStats?.get(useCaseId);
  if (!stats || stats.runs <= 0) {
    return clamp01(0.7 + (uncertainty * 0.3));
  }

  const runs = Math.max(1, stats.runs);
  const successRate = clamp01(stats.successes / runs);
  const failureRate = clamp01(stats.failures / runs);
  const strictRate = clamp01(stats.strictFailures / runs);
  const dependencyRate = clamp01(stats.dependencyNotReady / runs);
  const repeatedSuccessPenalty = Math.min(0.7, Math.max(0, stats.successes - stats.failures) * 0.08);
  const confidencePenalty = successRate > 0.85 ? Math.min(0.2, (successRate - 0.85) * 1.25) : 0;
  const riskBoost = (failureRate * 0.5) + (strictRate * 0.4) + (dependencyRate * 0.2);
  const uncertaintyBoost = uncertainty * 0.45;
  const noveltyBoost = stats.runs < 2 ? 0.1 : 0;
  const probability =
    0.05
    + uncertaintyBoost
    + riskBoost
    + noveltyBoost
    - repeatedSuccessPenalty
    - confidencePenalty;
  return clamp01(probability);
}

function selectUseCasesProbabilistic(
  useCases: AgenticUseCase[],
  maxUseCases: number,
  uncertaintyScores: Map<string, number> | undefined,
  historyStats: Map<string, UseCaseHistoryStats> | undefined
): AgenticUseCase[] {
  const candidates = useCases.map((useCase) => ({
    useCase,
    probability: computeSelectionProbability(useCase.id, uncertaintyScores, historyStats),
  }));
  candidates.sort((left, right) => {
    if (right.probability !== left.probability) return right.probability - left.probability;
    return useCaseNumber(left.useCase.id) - useCaseNumber(right.useCase.id);
  });
  if (maxUseCases <= 0 || candidates.length <= maxUseCases) {
    return candidates.map((entry) => entry.useCase);
  }

  const byDomain = new Map<string, Array<{ useCase: AgenticUseCase; probability: number }>>();
  for (const candidate of candidates) {
    const list = byDomain.get(candidate.useCase.domain) ?? [];
    list.push(candidate);
    byDomain.set(candidate.useCase.domain, list);
  }
  for (const list of byDomain.values()) {
    list.sort((left, right) => {
      if (right.probability !== left.probability) return right.probability - left.probability;
      return useCaseNumber(left.useCase.id) - useCaseNumber(right.useCase.id);
    });
  }

  const selected: AgenticUseCase[] = [];
  const selectedByDomain = new Map<string, number>();
  while (selected.length < maxUseCases) {
    let pickedDomain: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [domain, domainCandidates] of byDomain.entries()) {
      if (domainCandidates.length === 0) continue;
      const top = domainCandidates[0];
      if (!top) continue;
      const alreadySelected = selectedByDomain.get(domain) ?? 0;
      const domainScore = top.probability / (1 + (alreadySelected * 0.85));
      if (domainScore > bestScore) {
        bestScore = domainScore;
        pickedDomain = domain;
      }
    }
    if (!pickedDomain) break;
    const queue = byDomain.get(pickedDomain);
    if (!queue || queue.length === 0) break;
    const next = queue.shift();
    if (!next) continue;
    selected.push(next.useCase);
    selectedByDomain.set(pickedDomain, (selectedByDomain.get(pickedDomain) ?? 0) + 1);
  }

  return selected;
}

export function selectUseCases(
  useCases: AgenticUseCase[],
  options: {
    maxUseCases: number;
    selectionMode: AgenticUseCaseSelectionMode;
    uncertaintyScores?: Map<string, number>;
    historyStats?: Map<string, UseCaseHistoryStats>;
  }
): AgenticUseCase[] {
  if (options.selectionMode === 'sequential') {
    return selectUseCasesSequential(useCases, options.maxUseCases);
  }
  if (options.selectionMode === 'uncertainty') {
    const scored = useCases.map((useCase) => ({
      useCase,
      score: options.uncertaintyScores?.get(useCase.id) ?? 1,
    }));
    scored.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return useCaseNumber(left.useCase.id) - useCaseNumber(right.useCase.id);
    });
    if (options.maxUseCases <= 0 || scored.length <= options.maxUseCases) {
      return scored.map((entry) => entry.useCase);
    }
    return scored.slice(0, options.maxUseCases).map((entry) => entry.useCase);
  }
  if (options.selectionMode === 'adaptive') {
    return selectUseCasesAdaptive(useCases, options.maxUseCases, options.uncertaintyScores);
  }
  if (options.selectionMode === 'probabilistic') {
    return selectUseCasesProbabilistic(
      useCases,
      options.maxUseCases,
      options.uncertaintyScores,
      options.historyStats
    );
  }
  return selectUseCasesBalanced(useCases, options.maxUseCases);
}

export interface UseCaseHistoryStats {
  runs: number;
  successes: number;
  failures: number;
  strictFailures: number;
  dependencyNotReady: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function extractHistoryRuns(value: unknown): Array<{
  useCaseId: string;
  success: boolean;
  strictSignals: string[];
  dependencyReady: boolean;
}> {
  if (!value || typeof value !== 'object') return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const runs: Array<{
    useCaseId: string;
    success: boolean;
    strictSignals: string[];
    dependencyReady: boolean;
  }> = [];
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as {
      useCaseId?: unknown;
      success?: unknown;
      strictSignals?: unknown;
      dependencyReady?: unknown;
    };
    const useCaseId = typeof record.useCaseId === 'string' ? record.useCaseId : '';
    if (!/^UC-\d{3}$/.test(useCaseId)) continue;
    runs.push({
      useCaseId,
      success: record.success === true,
      strictSignals: Array.isArray(record.strictSignals)
        ? record.strictSignals.filter((signal): signal is string => typeof signal === 'string')
        : [],
      dependencyReady: record.dependencyReady !== false,
    });
  }
  return runs;
}

function scoreUncertainty(stats: UseCaseHistoryStats): number {
  if (stats.runs <= 0) return 1;
  const failureRate = stats.failures / stats.runs;
  const strictRate = stats.strictFailures / stats.runs;
  const dependencyRate = stats.dependencyNotReady / stats.runs;
  const recencyWeight = Math.max(0, 1 - Math.min(stats.runs, 12) / 12) * 0.15;
  return clamp01((failureRate * 0.55) + (strictRate * 0.3) + (dependencyRate * 0.15) + recencyWeight);
}

export function buildUncertaintyScoresFromHistory(history: unknown): Map<string, number> {
  const statsByUseCase = buildHistoryStatsFromRuns(extractHistoryRuns(history));
  const scores = new Map<string, number>();
  for (const [useCaseId, stats] of statsByUseCase.entries()) {
    scores.set(useCaseId, scoreUncertainty(stats));
  }
  return scores;
}

export function buildHistoryStatsFromHistory(history: unknown): Map<string, UseCaseHistoryStats> {
  return buildHistoryStatsFromRuns(extractHistoryRuns(history));
}

function buildHistoryStatsFromRuns(
  runs: Array<{
    useCaseId: string;
    success: boolean;
    strictSignals: string[];
    dependencyReady: boolean;
  }>
): Map<string, UseCaseHistoryStats> {
  const statsByUseCase = new Map<string, UseCaseHistoryStats>();
  for (const run of runs) {
    const stats = statsByUseCase.get(run.useCaseId) ?? {
      runs: 0,
      successes: 0,
      failures: 0,
      strictFailures: 0,
      dependencyNotReady: 0,
    };
    stats.runs += 1;
    if (run.success) stats.successes += 1;
    if (!run.success) stats.failures += 1;
    if (run.strictSignals.length > 0) stats.strictFailures += 1;
    if (!run.dependencyReady) stats.dependencyNotReady += 1;
    statsByUseCase.set(run.useCaseId, stats);
  }
  return statsByUseCase;
}

function buildDependencyClosureIndex(
  targetUseCases: AgenticUseCase[],
  useCaseById: Map<string, AgenticUseCase>
): Map<string, string[]> {
  const memo = new Map<string, string[]>();

  const visit = (id: string, stack: Set<string>): string[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    const current = useCaseById.get(id);
    if (!current) {
      memo.set(id, []);
      return [];
    }

    const closure: string[] = [];
    for (const dependency of current.dependencies) {
      if (!useCaseById.has(dependency)) continue;
      closure.push(dependency);
      if (stack.has(dependency)) continue;
      stack.add(dependency);
      closure.push(...visit(dependency, stack));
      stack.delete(dependency);
    }

    const deduped = uniqueStrings(closure)
      .filter((entry) => entry !== id)
      .sort((left, right) => useCaseNumber(left) - useCaseNumber(right));
    memo.set(id, deduped);
    return deduped;
  };

  for (const useCase of targetUseCases) {
    visit(useCase.id, new Set([useCase.id]));
  }

  return memo;
}

export function buildProgressiveUseCasePlan(
  allUseCases: AgenticUseCase[],
  targetUseCases: AgenticUseCase[],
  progressivePrerequisites: boolean
): AgenticUseCasePlanItem[] {
  const useCaseById = new Map<string, AgenticUseCase>(allUseCases.map((useCase) => [useCase.id, useCase]));
  const targetIds = new Set(targetUseCases.map((useCase) => useCase.id));
  const dependencyIndex = progressivePrerequisites
    ? buildDependencyClosureIndex(targetUseCases, useCaseById)
    : new Map<string, string[]>();

  const requiredByTargets = new Map<string, Set<string>>();
  for (const target of targetUseCases) {
    for (const dependency of dependencyIndex.get(target.id) ?? []) {
      const owners = requiredByTargets.get(dependency) ?? new Set<string>();
      owners.add(target.id);
      requiredByTargets.set(dependency, owners);
    }
  }

  const plannedIds = new Set<string>(targetUseCases.map((useCase) => useCase.id));
  if (progressivePrerequisites) {
    for (const dependencies of dependencyIndex.values()) {
      for (const dependency of dependencies) plannedIds.add(dependency);
    }
  }

  const plannedIdList = Array.from(plannedIds);
  const comparePlanIds = (left: string, right: string): number => {
    const leftIsTarget = targetIds.has(left);
    const rightIsTarget = targetIds.has(right);
    if (leftIsTarget !== rightIsTarget) return leftIsTarget ? 1 : -1;
    return useCaseNumber(left) - useCaseNumber(right);
  };
  const dependencyAdjacency = new Map<string, string[]>();
  const dependencyCount = new Map<string, number>();
  const plannedIdSet = new Set(plannedIdList);

  for (const id of plannedIdList) {
    const useCase = useCaseById.get(id);
    const dependencies = (useCase?.dependencies ?? []).filter((dependency) => plannedIdSet.has(dependency));
    dependencyCount.set(id, dependencies.length);
    for (const dependency of dependencies) {
      const dependents = dependencyAdjacency.get(dependency) ?? [];
      dependents.push(id);
      dependencyAdjacency.set(dependency, dependents);
    }
  }

  const topoQueue = plannedIdList
    .filter((id) => (dependencyCount.get(id) ?? 0) === 0)
    .sort(comparePlanIds);
  const orderedIds: string[] = [];
  const visited = new Set<string>();

  while (topoQueue.length > 0) {
    const id = topoQueue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    orderedIds.push(id);
    const dependents = dependencyAdjacency.get(id) ?? [];
    for (const dependentId of dependents) {
      const nextCount = (dependencyCount.get(dependentId) ?? 0) - 1;
      dependencyCount.set(dependentId, nextCount);
      if (nextCount === 0) {
        topoQueue.push(dependentId);
        topoQueue.sort(comparePlanIds);
      }
    }
  }

  if (orderedIds.length < plannedIdList.length) {
    const unresolved = plannedIdList
      .filter((id) => !visited.has(id))
      .sort(comparePlanIds);
    orderedIds.push(...unresolved);
  }

  return orderedIds.map((id) => {
      const useCase = useCaseById.get(id);
      if (!useCase) {
        return {
          id,
          domain: 'unknown',
          need: 'unknown',
          dependencies: [],
          stepKind: targetIds.has(id) ? 'target' : 'prerequisite',
          requiredByTargets: targetIds.has(id) ? [id] : [],
          layer: 'unknown' as const,
        };
      }

      const targetsForThis = requiredByTargets.get(id);
      return {
        ...useCase,
        stepKind: targetIds.has(id) ? 'target' : 'prerequisite',
        requiredByTargets: targetIds.has(id)
          ? [id]
          : Array.from(targetsForThis ?? []).sort((left, right) => useCaseNumber(left) - useCaseNumber(right)),
        layer: useCaseLayer(useCase.id),
      };
    });
}

export function selectRepoPlanWithinBudget(
  plannedUseCases: AgenticUseCasePlanItem[],
  maxRunsPerRepo: number
): AgenticUseCasePlanItem[] {
  if (maxRunsPerRepo <= 0 || plannedUseCases.length <= maxRunsPerRepo) {
    return [...plannedUseCases];
  }

  let limit = Math.min(maxRunsPerRepo, plannedUseCases.length);
  let selected = plannedUseCases.slice(0, limit);
  while (limit < plannedUseCases.length && !selected.some((item) => item.stepKind === 'target')) {
    limit += 1;
    selected = plannedUseCases.slice(0, limit);
  }
  return selected;
}

export function distributeUseCasesAcrossRepos(
  selectedUseCases: AgenticUseCase[],
  repoNames: string[],
  maxRunsPerRepo: number
): Map<string, AgenticUseCase[]> {
  const assignments = new Map<string, AgenticUseCase[]>();
  for (const repoName of repoNames) assignments.set(repoName, []);
  if (repoNames.length === 0 || selectedUseCases.length === 0) return assignments;

  const perRepoLimit = Math.max(1, maxRunsPerRepo);
  let cursor = 0;
  for (const useCase of selectedUseCases) {
    let assigned = false;
    for (let attempts = 0; attempts < repoNames.length; attempts += 1) {
      const repoIndex = (cursor + attempts) % repoNames.length;
      const repoName = repoNames[repoIndex];
      if (!repoName) continue;
      const bucket = assignments.get(repoName) ?? [];
      if (bucket.length >= perRepoLimit) continue;
      bucket.push(useCase);
      assignments.set(repoName, bucket);
      cursor = (repoIndex + 1) % repoNames.length;
      assigned = true;
      break;
    }
    if (!assigned) break;
  }

  return assignments;
}

interface RepoPlanBundle {
  plannedUseCases: AgenticUseCasePlanItem[];
  dependencyClosureByTarget: Map<string, string[]>;
  progressiveEnabled: boolean;
}

function buildRepoPlanBundle(
  allUseCases: AgenticUseCase[],
  repoTargets: AgenticUseCase[],
  maxRunsPerRepo: number,
  progressivePrerequisites: boolean
): RepoPlanBundle {
  if (repoTargets.length === 0) {
    return { plannedUseCases: [], dependencyClosureByTarget: new Map(), progressiveEnabled: false };
  }

  const useCaseById = new Map<string, AgenticUseCase>(allUseCases.map((useCase) => [useCase.id, useCase]));
  const progressivePlan = buildProgressiveUseCasePlan(allUseCases, repoTargets, progressivePrerequisites);
  const needsBreadthFallback = progressivePrerequisites && progressivePlan.length > maxRunsPerRepo;
  const sourcePlan = needsBreadthFallback
    ? buildProgressiveUseCasePlan(allUseCases, repoTargets, false)
    : progressivePlan;
  const boundedPlan = selectRepoPlanWithinBudget(sourcePlan, maxRunsPerRepo);
  const boundedIds = new Set(boundedPlan.map((item) => item.id));
  const targetUseCases = boundedPlan
    .filter((item) => item.stepKind === 'target')
    .map((item) => useCaseById.get(item.id))
    .filter((item): item is AgenticUseCase => Boolean(item));
  const rawClosure = (!needsBreadthFallback && progressivePrerequisites)
    ? buildDependencyClosureIndex(targetUseCases, useCaseById)
    : new Map<string, string[]>();
  const dependencyClosureByTarget = new Map<string, string[]>();
  for (const target of targetUseCases) {
    const closure = (rawClosure.get(target.id) ?? []).filter((dependency) => boundedIds.has(dependency));
    dependencyClosureByTarget.set(target.id, closure);
  }

  return {
    plannedUseCases: boundedPlan,
    dependencyClosureByTarget,
    progressiveEnabled: !needsBreadthFallback && progressivePrerequisites,
  };
}

function mergeRepoPlannedUseCases(repoPlans: Map<string, RepoPlanBundle>): AgenticUseCasePlanItem[] {
  const merged = new Map<string, AgenticUseCasePlanItem>();
  for (const plan of repoPlans.values()) {
    for (const item of plan.plannedUseCases) {
      const existing = merged.get(item.id);
      if (!existing) {
        merged.set(item.id, {
          ...item,
          requiredByTargets: [...item.requiredByTargets],
        });
        continue;
      }
      merged.set(item.id, {
        ...existing,
        stepKind: existing.stepKind === 'target' || item.stepKind === 'target' ? 'target' : 'prerequisite',
        requiredByTargets: uniqueStrings([...existing.requiredByTargets, ...item.requiredByTargets]),
      });
    }
  }
  return Array.from(merged.values()).sort((left, right) => {
    if (left.stepKind !== right.stepKind) return left.stepKind === 'prerequisite' ? -1 : 1;
    return useCaseNumber(left.id) - useCaseNumber(right.id);
  });
}

async function resolveRepoNames(
  reposRoot: string,
  repoNames: string[] | undefined,
  maxRepos: number | undefined
): Promise<string[]> {
  const manifestPath = path.join(reposRoot, 'manifest.json');
  let manifestRepos: string[] = [];
  try {
    const manifestRaw = await readFile(manifestPath, 'utf8');
    const manifestParsed = safeJsonParse<RepoManifest>(manifestRaw);
    if (manifestParsed.ok && Array.isArray(manifestParsed.value?.repos)) {
      manifestRepos = manifestParsed.value.repos
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
    }
  } catch {
    manifestRepos = [];
  }

  let selected = repoNames && repoNames.length > 0
    ? repoNames
    : manifestRepos;

  if (selected.length === 0) {
    const entries = await readdir(reposRoot, { withFileTypes: true });
    selected = entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'repos')
      .map((entry) => entry.name);
  }

  if (typeof maxRepos === 'number' && maxRepos > 0) {
    return selected.slice(0, maxRepos);
  }
  return selected;
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
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'boolean') {
      if (entry) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes('fallback')) out.push('fallback_used');
        else if (normalizedKey.includes('retry')) out.push('retry');
        else if (normalizedKey.includes('degrad')) out.push('degraded');
        else if (normalizedKey.includes('timeout')) out.push('timeout');
        else out.push(key);
      }
      continue;
    }
    collectStrictSignalTexts(entry, out);
  }
}

export function detectStrictSignals(value: unknown): string[] {
  const texts: string[] = [];
  collectStrictSignalTexts(value, texts);
  const serialized = texts.join('\n');
  const labels = STRICT_FAILURE_PATTERNS
    .filter((entry) => entry.pattern.test(serialized))
    .map((entry) => entry.label);
  const unverifiedMatches = Array.from(serialized.matchAll(/\bunverified_by_trace\(([^)]+)\)/gi));
  const hasStrictUnverified = unverifiedMatches.some((match) => {
    const reason = match[1]?.trim().toLowerCase() ?? '';
    return !NON_STRICT_UNVERIFIED_REASONS.has(reason);
  });
  if (hasStrictUnverified) {
    labels.push('unverified_by_trace');
  }
  return uniqueStrings(labels);
}

function shouldFailFastRepoAfterQueryError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('unverified_by_trace(timeout_query)')
    || normalized.includes('unverified_by_trace(provider_unavailable)')
    || normalized.includes('unverified_by_trace(model_policy_unavailable)')
    || normalized.includes('unverified_by_trace(initialization_failed)')
  );
}

function extractUnverifiedMarkers(value: unknown): string[] {
  const texts: string[] = [];
  collectStrictSignalTexts(value, texts);
  const serialized = texts.join('\n');
  return uniqueStrings(
    Array.from(serialized.matchAll(/\bunverified_by_trace\(([^)]+)\)/gi))
      .map((match) => match[1]?.trim().toLowerCase() ?? '')
      .filter((reason) => reason.length > 0)
  );
}

function summarizeResponseQuality(response: LibrarianResponse): {
  packCount: number;
  evidenceCount: number;
  hasUsefulSummary: boolean;
  strictSignals: string[];
  unverifiedMarkers: string[];
} {
  const packs = response.packs ?? [];
  const snippetCount = packs.reduce((sum, pack) => sum + (pack.codeSnippets?.length ?? 0), 0);
  const relatedFileCount = packs.reduce((sum, pack) => sum + (pack.relatedFiles?.length ?? 0), 0);
  const citationCount = response.synthesis?.citations?.length ?? 0;
  const evidenceCount = snippetCount + relatedFileCount + citationCount;
  const hasUsefulSummary = packs.some((pack) => {
    const summary = (pack.summary ?? '').trim();
    return summary.length > 0 && !EMPTY_SUMMARIES.has(summary);
  });
  const strictInput = {
    disclosures: response.disclosures,
    coverageGaps: response.coverageGaps,
    synthesisUncertainties: response.synthesis?.uncertainties,
    queryReasons: response.queryDiagnostics?.reasons,
  };
  const strictSignals = detectStrictSignals(strictInput);
  const unverifiedMarkers = extractUnverifiedMarkers(strictInput);
  return {
    packCount: packs.length,
    evidenceCount,
    hasUsefulSummary,
    strictSignals,
    unverifiedMarkers,
  };
}

function summarizeExplorationAnswer(response: LibrarianResponse): string | null {
  const synthesisAnswer = response.synthesis?.answer?.trim();
  if (synthesisAnswer && synthesisAnswer.length > 0) {
    return synthesisAnswer;
  }
  for (const pack of response.packs ?? []) {
    const summary = (pack.summary ?? '').trim();
    if (summary.length > 0 && !EMPTY_SUMMARIES.has(summary)) {
      return summary;
    }
  }
  return null;
}

function extractExplorationCitations(response: LibrarianResponse, limit = 6): AgenticUseCaseExplorationCitation[] {
  const out: AgenticUseCaseExplorationCitation[] = [];
  const seen = new Set<string>();
  const citations = response.synthesis?.citations ?? [];
  for (const citation of citations) {
    const file = typeof citation?.file === 'string' ? citation.file.trim() : '';
    if (!file) continue;
    const line = typeof citation?.line === 'number' && Number.isFinite(citation.line)
      ? citation.line
      : null;
    const key = `${file}:${line ?? 'null'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, line });
    if (out.length >= limit) break;
  }
  return out;
}

function summarizeExplorationFindings(
  findings: AgenticUseCaseExplorationFinding[],
  selectedRepos: string[],
  intentsPerRepo: number
): AgenticUseCaseExplorationSummary {
  const byRepo = new Map<string, AgenticUseCaseExplorationRepoMetrics>();
  for (const repo of selectedRepos) {
    byRepo.set(repo, {
      runs: 0,
      successes: 0,
      usefulSummaries: 0,
      evidenceBearing: 0,
      strictFailures: 0,
    });
  }
  for (const finding of findings) {
    const metrics = byRepo.get(finding.repo) ?? {
      runs: 0,
      successes: 0,
      usefulSummaries: 0,
      evidenceBearing: 0,
      strictFailures: 0,
    };
    metrics.runs += 1;
    if (finding.success) metrics.successes += 1;
    if (finding.hasUsefulSummary) metrics.usefulSummaries += 1;
    if (finding.evidenceCount > 0) metrics.evidenceBearing += 1;
    if (finding.strictSignals.length > 0) metrics.strictFailures += 1;
    byRepo.set(finding.repo, metrics);
  }

  const totalRuns = findings.length;
  const successfulRuns = findings.filter((finding) => finding.success).length;
  const usefulRuns = findings.filter((finding) => finding.hasUsefulSummary).length;
  const evidenceRuns = findings.filter((finding) => finding.evidenceCount > 0).length;
  const strictFailures = findings.filter((finding) => finding.strictSignals.length > 0).length;

  const byRepoObject: Record<string, AgenticUseCaseExplorationRepoMetrics> = {};
  for (const [repo, metrics] of byRepo.entries()) {
    byRepoObject[repo] = metrics;
  }

  return {
    enabled: intentsPerRepo > 0,
    intentsPerRepo,
    totalRuns,
    successRate: safeRate(successfulRuns, totalRuns),
    usefulSummaryRate: safeRate(usefulRuns, totalRuns),
    evidenceRate: safeRate(evidenceRuns, totalRuns),
    strictFailureShare: safeRate(strictFailures, totalRuns),
    uniqueReposCovered: new Set(findings.map((finding) => finding.repo).filter(Boolean)).size,
    byRepo: byRepoObject,
  };
}

function computeDomainMetrics(results: AgenticUseCaseRunResult[]): Record<string, AgenticUseCaseDomainMetrics> {
  const grouped = new Map<string, AgenticUseCaseRunResult[]>();
  for (const result of results) {
    const list = grouped.get(result.domain) ?? [];
    list.push(result);
    grouped.set(result.domain, list);
  }
  const metrics: Record<string, AgenticUseCaseDomainMetrics> = {};
  for (const [domain, runs] of grouped.entries()) {
    const total = runs.length;
    const passed = runs.filter((run) => run.success).length;
    const evidence = runs.filter((run) => run.evidenceCount > 0).length;
    const useful = runs.filter((run) => run.hasUsefulSummary).length;
    metrics[domain] = {
      runs: total,
      passRate: total > 0 ? passed / total : 0,
      evidenceRate: total > 0 ? evidence / total : 0,
      usefulSummaryRate: total > 0 ? useful / total : 0,
    };
  }
  return metrics;
}

function emptyProgressionLayerMetrics(): Record<AgenticUseCaseLayer, AgenticUseCaseProgressionLayerMetrics> {
  return {
    L0: { runs: 0, passRate: 0 },
    L1: { runs: 0, passRate: 0 },
    L2: { runs: 0, passRate: 0 },
    L3: { runs: 0, passRate: 0 },
    L4: { runs: 0, passRate: 0 },
    unknown: { runs: 0, passRate: 0 },
  };
}

function summarizeProgression(
  results: AgenticUseCaseRunResult[],
  selectedUseCases: AgenticUseCase[],
  plannedUseCases: AgenticUseCasePlanItem[],
  progressiveEnabled: boolean
): AgenticUseCaseProgressionSummary {
  const prerequisiteUseCases = plannedUseCases.filter((useCase) => useCase.stepKind === 'prerequisite').length;
  const targetUseCases = selectedUseCases.length;
  const prerequisiteRuns = results.filter((result) => result.stepKind === 'prerequisite');
  const targetRuns = results.filter((result) => result.stepKind === 'target');
  const prerequisitePassed = prerequisiteRuns.filter((result) => result.success).length;
  const targetPassed = targetRuns.filter((result) => result.success).length;
  const targetDependencyReady = targetRuns.filter((result) => result.dependencyReady).length;

  const layerByUseCase = new Map<string, AgenticUseCaseLayer>();
  for (const useCase of plannedUseCases) {
    layerByUseCase.set(useCase.id, useCase.layer);
  }

  const byLayer = emptyProgressionLayerMetrics();
  const layerCounts = new Map<AgenticUseCaseLayer, { total: number; passed: number }>();
  for (const result of results) {
    const layer = layerByUseCase.get(result.useCaseId) ?? useCaseLayer(result.useCaseId);
    const totals = layerCounts.get(layer) ?? { total: 0, passed: 0 };
    totals.total += 1;
    if (result.success) totals.passed += 1;
    layerCounts.set(layer, totals);
  }
  for (const [layer, totals] of layerCounts.entries()) {
    byLayer[layer] = {
      runs: totals.total,
      passRate: totals.total > 0 ? totals.passed / totals.total : 0,
    };
  }

  return {
    enabled: progressiveEnabled && prerequisiteUseCases > 0,
    prerequisiteUseCases,
    targetUseCases,
    totalPlannedUseCases: plannedUseCases.length,
    prerequisiteRuns: prerequisiteRuns.length,
    prerequisitePassRate: prerequisiteRuns.length > 0 ? prerequisitePassed / prerequisiteRuns.length : 0,
    targetRuns: targetRuns.length,
    targetPassRate: targetRuns.length > 0 ? targetPassed / targetRuns.length : 0,
    targetDependencyReadyShare: targetRuns.length > 0 ? targetDependencyReady / targetRuns.length : 0,
    byLayer,
  };
}

export function summarizeUseCaseReview(
  results: AgenticUseCaseRunResult[],
  selectedUseCases: AgenticUseCase[],
  selectedRepos: string[],
  options?: {
    plannedUseCases?: AgenticUseCasePlanItem[];
    progressiveEnabled?: boolean;
  }
): AgenticUseCaseReviewSummary {
  const totalRuns = results.length;
  const passedRuns = results.filter((result) => result.success).length;
  const evidenceRuns = results.filter((result) => result.evidenceCount > 0).length;
  const usefulRuns = results.filter((result) => result.hasUsefulSummary).length;
  const strictFailures = results.filter((result) => result.strictSignals.length > 0).length;
  const plannedUseCases = options?.plannedUseCases
    ?? selectedUseCases.map((useCase) => ({
      ...useCase,
      stepKind: 'target' as const,
      requiredByTargets: [useCase.id],
      layer: useCaseLayer(useCase.id),
    }));
  const progression = summarizeProgression(
    results,
    selectedUseCases,
    plannedUseCases,
    options?.progressiveEnabled ?? false
  );
  return {
    totalRuns,
    passedRuns,
    passRate: totalRuns > 0 ? passedRuns / totalRuns : 0,
    evidenceRate: totalRuns > 0 ? evidenceRuns / totalRuns : 0,
    usefulSummaryRate: totalRuns > 0 ? usefulRuns / totalRuns : 0,
    strictFailureShare: totalRuns > 0 ? strictFailures / totalRuns : 0,
    uniqueRepos: selectedRepos.length,
    uniqueUseCases: selectedUseCases.length,
    byDomain: computeDomainMetrics(results),
    progression,
  };
}

export function evaluateUseCaseReviewGate(
  summary: AgenticUseCaseReviewSummary,
  thresholds: AgenticUseCaseReviewThresholds
): AgenticUseCaseReviewGate {
  const minPrerequisitePassRate = thresholds.minPrerequisitePassRate ?? thresholds.minPassRate;
  const minTargetPassRate = thresholds.minTargetPassRate ?? thresholds.minPassRate;
  const minTargetDependencyReadyShare = thresholds.minTargetDependencyReadyShare ?? 1;
  const reasons: string[] = [];
  if (summary.totalRuns === 0) {
    reasons.push('no_runs_executed');
  }
  if (summary.passRate < thresholds.minPassRate) {
    reasons.push(`pass_rate_below_threshold:${summary.passRate.toFixed(3)}<${thresholds.minPassRate.toFixed(3)}`);
  }
  if (summary.evidenceRate < thresholds.minEvidenceRate) {
    reasons.push(`evidence_rate_below_threshold:${summary.evidenceRate.toFixed(3)}<${thresholds.minEvidenceRate.toFixed(3)}`);
  }
  if (summary.usefulSummaryRate < thresholds.minUsefulSummaryRate) {
    reasons.push(
      `useful_summary_rate_below_threshold:${summary.usefulSummaryRate.toFixed(3)}<${thresholds.minUsefulSummaryRate.toFixed(3)}`
    );
  }
  if (summary.strictFailureShare > thresholds.maxStrictFailureShare) {
    reasons.push(
      `strict_failure_share_above_threshold:${summary.strictFailureShare.toFixed(3)}>${thresholds.maxStrictFailureShare.toFixed(3)}`
    );
  }
  if (summary.progression.enabled) {
    if (summary.progression.prerequisiteRuns === 0) {
      reasons.push('progression_prerequisite_runs_missing');
    }
    if (summary.progression.targetRuns === 0) {
      reasons.push('progression_target_runs_missing');
    }
    if (summary.progression.prerequisitePassRate < minPrerequisitePassRate) {
      reasons.push(
        `prerequisite_pass_rate_below_threshold:${summary.progression.prerequisitePassRate.toFixed(3)}<${minPrerequisitePassRate.toFixed(3)}`
      );
    }
    if (summary.progression.targetPassRate < minTargetPassRate) {
      reasons.push(
        `target_pass_rate_below_threshold:${summary.progression.targetPassRate.toFixed(3)}<${minTargetPassRate.toFixed(3)}`
      );
    }
    if (summary.progression.targetDependencyReadyShare < minTargetDependencyReadyShare) {
      reasons.push(
        `target_dependency_ready_share_below_threshold:${summary.progression.targetDependencyReadyShare.toFixed(3)}<${minTargetDependencyReadyShare.toFixed(3)}`
      );
    }
  }
  return {
    passed: reasons.length === 0,
    reasons,
    thresholds,
  };
}

export async function runAgenticUseCaseReview(
  options: AgenticUseCaseReviewOptions
): Promise<AgenticUseCaseReviewReport> {
  throwIfAborted(options.signal, 'agentic_use_case_review');
  const reposRoot = path.resolve(options.reposRoot);
  const matrixPath = path.resolve(options.matrixPath ?? path.join(process.cwd(), 'docs', 'librarian', 'USE_CASE_MATRIX.md'));
  const ucStart = options.ucStart ?? 1;
  const ucEnd = options.ucEnd ?? 310;
  const selectionMode = options.selectionMode ?? 'probabilistic';
  const evidenceProfile = options.evidenceProfile ?? 'custom';
  const uncertaintyHistoryPath = options.uncertaintyHistoryPath
    ? path.resolve(options.uncertaintyHistoryPath)
    : path.resolve(process.cwd(), 'eval-results', 'agentic-use-case-review.json');
  const progressivePrerequisites = options.progressivePrerequisites ?? true;
  const deterministicQueries = options.deterministicQueries ?? false;
  const maxUseCases = options.maxUseCases ?? 120;
  const initTimeoutMs = resolveTimeoutMs(options.initTimeoutMs, 'LIBRARIAN_USE_CASE_INIT_TIMEOUT_MS', 300_000);
  const queryTimeoutMs = resolveTimeoutMs(options.queryTimeoutMs, 'LIBRARIAN_USE_CASE_QUERY_TIMEOUT_MS', 120_000);
  const explorationIntentsPerRepo = resolveExplorationIntentsPerRepo(
    options.explorationIntentsPerRepo,
    evidenceProfile
  );
  const explorationIntentTemplates = buildExplorationIntents();
  const thresholds = resolveReviewThresholds(options.thresholds);

  const matrixMarkdown = await readFile(matrixPath, 'utf8');
  const allUseCases = parseUseCaseMatrixMarkdown(matrixMarkdown)
    .filter((useCase) => {
      const num = useCaseNumber(useCase.id);
      return Number.isFinite(num) && num >= ucStart && num <= ucEnd;
    });
  let uncertaintyScores: Map<string, number> | undefined;
  let historyStats: Map<string, UseCaseHistoryStats> | undefined;
  if (selectionMode === 'uncertainty' || selectionMode === 'adaptive' || selectionMode === 'probabilistic') {
    try {
      const historyRaw = await readFile(uncertaintyHistoryPath, 'utf8');
      const historyParsed = safeJsonParse<unknown>(historyRaw);
      if (historyParsed.ok) {
        uncertaintyScores = buildUncertaintyScoresFromHistory(historyParsed.value);
        historyStats = buildHistoryStatsFromHistory(historyParsed.value);
      }
    } catch {
      uncertaintyScores = new Map();
      historyStats = new Map();
    }
  }
  const selectedUseCases = selectUseCases(allUseCases, {
    maxUseCases,
    selectionMode,
    uncertaintyScores,
    historyStats,
  });
  const selectedRepos = await resolveRepoNames(reposRoot, options.repoNames, options.maxRepos);
  const maxRunsPerRepo = Math.max(1, Math.ceil(maxUseCases / Math.max(1, selectedRepos.length)));
  const repoAssignments = distributeUseCasesAcrossRepos(selectedUseCases, selectedRepos, maxRunsPerRepo);
  const repoPlans = new Map<string, RepoPlanBundle>();
  for (const repoName of selectedRepos) {
    const assignedTargets = repoAssignments.get(repoName) ?? [];
    repoPlans.set(
      repoName,
      buildRepoPlanBundle(allUseCases, assignedTargets, maxRunsPerRepo, progressivePrerequisites)
    );
  }
  const plannedUseCases = mergeRepoPlannedUseCases(repoPlans);
  console.log(
    `[use-case-review] repos=${selectedRepos.length}, selectedUseCases=${selectedUseCases.length}, `
    + `plannedGlobal=${plannedUseCases.length}, perRepoBudget=${maxRunsPerRepo}`
  );

  const results: AgenticUseCaseRunResult[] = [];
  const explorationFindings: AgenticUseCaseExplorationFinding[] = [];
  const repoReportPaths: string[] = [];
  const runLabel = options.runLabel?.trim().length
    ? sanitizePathSegment(options.runLabel)
    : `agentic-use-cases-${Date.now()}`;
  const artifactsRoot = options.artifactRoot?.trim().length
    ? path.resolve(options.artifactRoot, runLabel)
    : null;
  const resolveRepoExplorationIntents = (): string[] =>
    Array.from({ length: explorationIntentsPerRepo }, (_, index) => {
      const template = explorationIntentTemplates[index];
      if (template) return template;
      return `Explore this repository from a fresh angle (#${index + 1}) and surface likely high-impact problems, root causes, and concrete fixes with file citations.`;
    });

  for (const repoName of selectedRepos) {
    throwIfAborted(options.signal, 'agentic_use_case_review');
    const repoRoot = path.join(reposRoot, repoName);
    const repoPlan = repoPlans.get(repoName) ?? {
      plannedUseCases: [],
      dependencyClosureByTarget: new Map<string, string[]>(),
      progressiveEnabled: false,
    };
    const repoPlannedUseCases = repoPlan.plannedUseCases;
    const dependencyClosureByTarget = repoPlan.dependencyClosureByTarget;
    let repoStats: Array<AgenticUseCaseRunResult> = [];
    const repoExplorationFindings: AgenticUseCaseExplorationFinding[] = [];
    let repoError: string | null = null;
    let providerSnapshot: unknown = null;
    let librarianForCleanup: { shutdown(): Promise<void> } | null = null;
    try {
      const providerGate = await withTimeout(
        runProviderReadinessGate(repoRoot, { emitReport: true }),
        initTimeoutMs,
        { context: `unverified_by_trace(timeout_provider_gate): ${repoName}` }
      );
      providerSnapshot = {
        ready: providerGate.ready,
        llmReady: providerGate.llmReady,
        embeddingReady: providerGate.embeddingReady,
        selectedProvider: providerGate.selectedProvider ?? null,
        reason: providerGate.reason ?? null,
      };
      const missing: string[] = [];
      if (!providerGate.llmReady) {
        missing.push(`LLM:${providerGate.reason ?? 'unavailable'}`);
      }
      if (!providerGate.embeddingReady) {
        missing.push(`EMBED:${providerGate.embedding.error ?? 'unavailable'}`);
      }
      if (missing.length > 0) {
        throw new Error(`unverified_by_trace(provider_unavailable): ${missing.join('; ')}`);
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
        { context: `unverified_by_trace(timeout_initialization): ${repoName}` }
      );
      if (!gateResult.librarian) {
        throw new Error('unverified_by_trace(initialization_failed): librarian unavailable');
      }
      librarianForCleanup = gateResult.librarian;

      const repoUseCaseSuccess = new Map<string, boolean>();
      let repoFailFastReason: string | null = null;

      console.log(
        `[use-case-review] repo=${repoName} start plannedRuns=${repoPlannedUseCases.length}`
        + ` targets=${(repoAssignments.get(repoName) ?? []).length}`
        + ` progressive=${repoPlan.progressiveEnabled ? 'yes' : 'breadth'}`
      );
      let repoRunIndex = 0;
      for (const useCase of repoPlannedUseCases) {
        throwIfAborted(options.signal, 'agentic_use_case_review');
        repoRunIndex += 1;
        const intent = buildUseCaseIntent(useCase);
        const dependencyClosure = useCase.stepKind === 'target'
          ? (dependencyClosureByTarget.get(useCase.id) ?? [])
          : [];
        const missingPrerequisites = dependencyClosure.filter((dependency) => repoUseCaseSuccess.get(dependency) !== true);
        const dependencyReady = missingPrerequisites.length === 0;
        if (repoFailFastReason) {
          const strictSignals = detectStrictSignals(repoFailFastReason);
          const errors = [repoFailFastReason];
          if (!dependencyReady) {
            strictSignals.push('prerequisite_missing');
            errors.push(`prerequisite_not_satisfied:${missingPrerequisites.join(',')}`);
          }
          const run: AgenticUseCaseRunResult = {
            repo: repoName,
            useCaseId: useCase.id,
            domain: useCase.domain,
            intent,
            stepKind: useCase.stepKind,
            success: false,
            dependencyReady,
            missingPrerequisites,
            packCount: 0,
            evidenceCount: 0,
            hasUsefulSummary: false,
            totalConfidence: 0,
            strictSignals: uniqueStrings(strictSignals),
            errors,
          };
          repoUseCaseSuccess.set(useCase.id, false);
          results.push(run);
          repoStats.push(run);
          if (repoRunIndex === 1 || repoRunIndex % 10 === 0 || repoRunIndex === repoPlannedUseCases.length) {
            console.log(
              `[use-case-review] repo=${repoName} run=${repoRunIndex}/${repoPlannedUseCases.length}`
              + ` uc=${useCase.id} success=false error=${run.errors[0] ?? 'unknown'}`
            );
          }
          continue;
        }
        try {
          const queryInput = createAgenticUseCaseQuery({
            intent,
            deterministicQueries,
            queryTimeoutMs,
          });
          const response = await withTimeout(
            gateResult.librarian.queryRequired(queryInput),
            queryTimeoutMs,
            { context: `unverified_by_trace(timeout_query): ${repoName}:${useCase.id}` }
          );
          const quality = summarizeResponseQuality(response);
          const strictSignals = [...quality.strictSignals];
          const errors: string[] = [];
          if (strictSignals.includes('unverified_by_trace') && quality.unverifiedMarkers.length > 0) {
            errors.push(`unverified_markers:${quality.unverifiedMarkers.join(',')}`);
          }
          if (!dependencyReady) {
            strictSignals.push('prerequisite_missing');
            errors.push(`prerequisite_not_satisfied:${missingPrerequisites.join(',')}`);
          }
          const success =
            quality.packCount > 0
            && quality.evidenceCount > 0
            && quality.hasUsefulSummary
            && strictSignals.length === 0;
          const run: AgenticUseCaseRunResult = {
            repo: repoName,
            useCaseId: useCase.id,
            domain: useCase.domain,
            intent,
            stepKind: useCase.stepKind,
            success,
            dependencyReady,
            missingPrerequisites,
            packCount: quality.packCount,
            evidenceCount: quality.evidenceCount,
            hasUsefulSummary: quality.hasUsefulSummary,
            totalConfidence: response.totalConfidence ?? 0,
            strictSignals: uniqueStrings(strictSignals),
            errors,
          };
          repoUseCaseSuccess.set(useCase.id, run.success);
          results.push(run);
          repoStats.push(run);
          if (repoRunIndex === 1 || repoRunIndex % 10 === 0 || repoRunIndex === repoPlannedUseCases.length) {
            console.log(
              `[use-case-review] repo=${repoName} run=${repoRunIndex}/${repoPlannedUseCases.length}`
              + ` uc=${useCase.id} success=${run.success ? 'true' : 'false'}`
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const strictSignals = detectStrictSignals(message);
          const errors = [message];
          if (!dependencyReady) {
            strictSignals.push('prerequisite_missing');
            errors.push(`prerequisite_not_satisfied:${missingPrerequisites.join(',')}`);
          }
          const run: AgenticUseCaseRunResult = {
            repo: repoName,
            useCaseId: useCase.id,
            domain: useCase.domain,
            intent,
            stepKind: useCase.stepKind,
            success: false,
            dependencyReady,
            missingPrerequisites,
            packCount: 0,
            evidenceCount: 0,
            hasUsefulSummary: false,
            totalConfidence: 0,
            strictSignals: uniqueStrings(strictSignals),
            errors,
          };
          repoUseCaseSuccess.set(useCase.id, false);
          results.push(run);
          repoStats.push(run);
          if (shouldFailFastRepoAfterQueryError(message)) {
            repoFailFastReason = message;
            console.log(`[use-case-review] repo=${repoName} fail-fast activated: ${message}`);
          }
          if (repoRunIndex === 1 || repoRunIndex % 10 === 0 || repoRunIndex === repoPlannedUseCases.length) {
            console.log(
              `[use-case-review] repo=${repoName} run=${repoRunIndex}/${repoPlannedUseCases.length}`
              + ` uc=${useCase.id} success=false error=${run.errors[0] ?? 'unknown'}`
            );
          }
        }
      }
      const repoExplorationIntents = resolveRepoExplorationIntents();
      for (const intent of repoExplorationIntents) {
        throwIfAborted(options.signal, 'agentic_use_case_review');
        try {
          const queryInput = createAgenticUseCaseQuery({
            intent,
            deterministicQueries,
            queryTimeoutMs,
          });
          const response = await withTimeout(
            gateResult.librarian.queryRequired(queryInput),
            queryTimeoutMs,
            { context: `unverified_by_trace(timeout_query): ${repoName}:exploration` }
          );
          const quality = summarizeResponseQuality(response);
          const strictSignals = uniqueStrings([...quality.strictSignals]);
          const success =
            quality.packCount > 0
            && quality.evidenceCount > 0
            && quality.hasUsefulSummary
            && strictSignals.length === 0;
          const finding: AgenticUseCaseExplorationFinding = {
            repo: repoName,
            intent,
            success,
            packCount: quality.packCount,
            evidenceCount: quality.evidenceCount,
            hasUsefulSummary: quality.hasUsefulSummary,
            totalConfidence: response.totalConfidence ?? 0,
            strictSignals,
            errors: [],
            summary: summarizeExplorationAnswer(response),
            citations: extractExplorationCitations(response),
          };
          explorationFindings.push(finding);
          repoExplorationFindings.push(finding);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const strictSignals = uniqueStrings(detectStrictSignals(message));
          const finding: AgenticUseCaseExplorationFinding = {
            repo: repoName,
            intent,
            success: false,
            packCount: 0,
            evidenceCount: 0,
            hasUsefulSummary: false,
            totalConfidence: 0,
            strictSignals,
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
      for (const useCase of repoPlannedUseCases) {
        const intent = buildUseCaseIntent(useCase);
        const dependencyClosure = useCase.stepKind === 'target'
          ? (dependencyClosureByTarget.get(useCase.id) ?? [])
          : [];
        const strictSignals = detectStrictSignals(repoError);
        const errors = [repoError];
        if (dependencyClosure.length > 0) {
          strictSignals.push('prerequisite_missing');
          errors.push(`prerequisite_not_satisfied:${dependencyClosure.join(',')}`);
        }
        const run: AgenticUseCaseRunResult = {
          repo: repoName,
          useCaseId: useCase.id,
          domain: useCase.domain,
          intent,
          stepKind: useCase.stepKind,
          success: false,
          dependencyReady: dependencyClosure.length === 0,
          missingPrerequisites: dependencyClosure,
          packCount: 0,
          evidenceCount: 0,
          hasUsefulSummary: false,
          totalConfidence: 0,
          strictSignals: uniqueStrings(strictSignals),
          errors,
        };
        results.push(run);
        repoStats.push(run);
      }
      for (const intent of resolveRepoExplorationIntents()) {
        const strictSignals = uniqueStrings(detectStrictSignals(repoError));
        const finding: AgenticUseCaseExplorationFinding = {
          repo: repoName,
          intent,
          success: false,
          packCount: 0,
          evidenceCount: 0,
          hasUsefulSummary: false,
          totalConfidence: 0,
          strictSignals,
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
      await writeFile(
        repoReportPath,
        JSON.stringify({
          schema: 'AgenticUseCaseRepoReport.v1',
          createdAt: new Date().toISOString(),
          repo: repoName,
          providerSnapshot,
          error: repoError,
          results: repoStats,
          explorationFindings: repoExplorationFindings,
        }, null, 2),
        'utf8'
      );
      repoReportPaths.push(repoReportPath);
    }
    console.log(
      `[use-case-review] repo=${repoName} complete runs=${repoStats.length}`
      + ` explorationRuns=${repoExplorationFindings.length} error=${repoError ?? 'none'}`
    );
  }

  const explorationSummary = summarizeExplorationFindings(
    explorationFindings,
    selectedRepos,
    explorationIntentsPerRepo
  );
  const summary = summarizeUseCaseReview(results, selectedUseCases, selectedRepos, {
    plannedUseCases,
    progressiveEnabled: progressivePrerequisites && plannedUseCases.some((useCase) => useCase.stepKind === 'prerequisite'),
  });
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
      uncertaintyHistoryPath:
        selectionMode === 'uncertainty' || selectionMode === 'adaptive' || selectionMode === 'probabilistic'
          ? uncertaintyHistoryPath
          : undefined,
      progressivePrerequisites,
      deterministicQueries,
      explorationIntentsPerRepo,
      initTimeoutMs,
      queryTimeoutMs,
      maxRunsPerRepo,
    },
    selectedUseCases,
    plannedUseCases,
    results,
    exploration: {
      findings: explorationFindings,
      summary: explorationSummary,
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
