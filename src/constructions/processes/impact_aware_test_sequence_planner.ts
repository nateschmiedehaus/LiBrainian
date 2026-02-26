import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FunctionKnowledge } from '../../types.js';
import type { GraphEdgeQueryOptions, LibrarianStorage } from '../../storage/types.js';
import { ConstructionError } from '../base/construction_base.js';
import { ok, type Construction, type Context } from '../types.js';

export type PlannedTestStage = 'smoke' | 'targeted' | 'regression' | 'fallback';
export type PlannedTestKind = 'unit' | 'integration' | 'regression' | 'e2e' | 'unknown';

export interface ImpactAwareTestSequencePlannerInput {
  intent?: string;
  changedFiles?: string[];
  changedFunctions?: string[];
  diff?: string;
  availableTests?: string[];
  workspaceRoot?: string;
  maxInitialTests?: number;
  includeFallbackSuite?: boolean;
  fallbackCommand?: string;
  confidenceThresholdForFallback?: number;
}

export interface PlannedTestSelection {
  testPath: string;
  stage: Exclude<PlannedTestStage, 'fallback'>;
  kind: PlannedTestKind;
  score: number;
  reason: string;
  impactedFiles: string[];
  impactedSymbols: string[];
}

export interface PlannedTestGroup {
  stage: PlannedTestStage;
  tests: string[];
  rationale: string;
  confidence: number;
  escalationTrigger?: string;
}

export interface PlannerEscalationPolicy {
  enabled: boolean;
  reason: 'low_confidence' | 'no_targeted_tests' | 'failure';
  trigger: string;
  fallbackCommand: string;
}

export interface ImpactAwareTestSequencePlannerOutput {
  groups: PlannedTestGroup[];
  selectedTests: PlannedTestSelection[];
  skippedTests: string[];
  impactedFiles: string[];
  impactedSymbols: string[];
  confidence: number;
  escalationPolicy: PlannerEscalationPolicy;
  agentSummary: string;
}

type StorageSlice = Pick<LibrarianStorage, 'getFunctions' | 'getGraphEdges'>;

interface ImpactSignals {
  impactedFiles: string[];
  impactedSymbols: string[];
  usedGraphSignals: boolean;
}

interface CandidateEvaluation {
  testPath: string;
  kind: PlannedTestKind;
  score: number;
  reason: string;
  impactedFiles: string[];
  impactedSymbols: string[];
  smokeHint: boolean;
  regressionHint: boolean;
}

const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__\/.*|tests?\/.*|.*(?:\.test|\.spec|\.integration|\.e2e)\.[cm]?[jt]sx?)$/i;
const TEST_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/i;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'users', 'after', 'before', 'when',
  'randomly', 'should', 'what', 'where', 'have', 'been', 'will', 'does', 'dont', 'your', 'you',
]);
const IGNORE_WALK_DIRS = new Set([
  '.git', '.librarian', '.librainian', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.cache',
]);

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function parseFunctionName(functionId: string): string {
  const hashIndex = functionId.lastIndexOf('#');
  if (hashIndex >= 0 && hashIndex < functionId.length - 1) {
    return functionId.slice(hashIndex + 1);
  }
  const colonIndex = functionId.lastIndexOf(':');
  if (colonIndex >= 0 && colonIndex < functionId.length - 1) {
    return functionId.slice(colonIndex + 1);
  }
  return functionId;
}

function stemFromPath(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  return base
    .replace(/\.[cm]?[jt]sx?$/i, '')
    .replace(/(\.test|\.spec|\.integration|\.e2e)$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .trim();
}

function splitPathTokens(filePath: string): string[] {
  return normalizePath(filePath)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function tokenizeIntent(intent: string | undefined): string[] {
  if (!intent) return [];
  return intent
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function classifyTestKind(testPath: string): PlannedTestKind {
  const lowered = testPath.toLowerCase();
  if (/(?:^|\/)(?:e2e|playwright|cypress)(?:\/|$)|\.e2e\./.test(lowered)) return 'e2e';
  if (/(?:^|\/)(?:integration|int)(?:\/|$)|\.integration\./.test(lowered)) return 'integration';
  if (/(?:^|\/)(?:regression|contract)(?:\/|$)|\.regression\./.test(lowered)) return 'regression';
  if (/(?:^|\/)(?:unit|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(lowered)) return 'unit';
  return 'unknown';
}

function isSmokeHint(testPath: string): boolean {
  return /(?:^|\/)(?:smoke|sanity|health|quick)(?:\/|\.|$)/i.test(testPath);
}

function isRegressionHint(testPath: string): boolean {
  return /(?:^|\/)(?:regression|contract)(?:\/|\.|$)/i.test(testPath);
}

function parseChangedFilesFromDiff(diff: string | undefined): string[] {
  if (!diff) return [];
  const discovered = new Set<string>();
  const lines = diff.split(/\r?\n/);
  for (const line of lines) {
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitMatch) {
      const candidate = gitMatch[2];
      if (candidate && candidate !== '/dev/null') {
        discovered.add(normalizePath(candidate));
      }
      continue;
    }
    const plusMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (plusMatch) {
      const candidate = plusMatch[1];
      if (candidate && candidate !== '/dev/null') {
        discovered.add(normalizePath(candidate));
      }
    }
  }
  return Array.from(discovered);
}

function toStorageSlice(value: unknown): StorageSlice | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.getFunctions !== 'function') return null;
  if (typeof record.getGraphEdges !== 'function') return null;
  return value as StorageSlice;
}

async function resolveStorage(context?: Context<unknown>): Promise<StorageSlice | null> {
  const deps = context?.deps as Record<string, unknown> | undefined;
  const librarian = deps?.librarian as { getStorage?: () => unknown } | undefined;
  if (!librarian || typeof librarian.getStorage !== 'function') return null;
  const storage = await Promise.resolve(librarian.getStorage());
  return toStorageSlice(storage);
}

function resolveWorkspaceRoot(
  inputWorkspaceRoot: string | undefined,
  context?: Context<unknown>,
): string {
  if (inputWorkspaceRoot && inputWorkspaceRoot.trim().length > 0) {
    return inputWorkspaceRoot;
  }
  const deps = context?.deps as Record<string, unknown> | undefined;
  const librarian = deps?.librarian as { workspaceRoot?: unknown; rootDir?: unknown } | undefined;
  if (typeof librarian?.workspaceRoot === 'string' && librarian.workspaceRoot.length > 0) {
    return librarian.workspaceRoot;
  }
  if (typeof librarian?.rootDir === 'string' && librarian.rootDir.length > 0) {
    return librarian.rootDir;
  }
  return process.cwd();
}

async function discoverTestFiles(workspaceRoot: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_WALK_DIRS.has(entry.name)) continue;
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!TEST_EXTENSION_PATTERN.test(entry.name)) continue;
      const relative = normalizePath(path.relative(workspaceRoot, absolute));
      if (TEST_FILE_PATTERN.test(relative)) {
        results.push(relative);
      }
    }
  }

  await walk(workspaceRoot);
  return uniqueSorted(results);
}

function normalizeInputTestPaths(
  availableTests: string[] | undefined,
  workspaceRoot: string,
): string[] {
  if (!availableTests || availableTests.length === 0) return [];
  return uniqueSorted(
    availableTests
      .map((entry) => {
        const trimmed = entry.trim();
        if (trimmed.length === 0) return '';
        const relative = path.isAbsolute(trimmed)
          ? path.relative(workspaceRoot, trimmed)
          : trimmed;
        return normalizePath(relative);
      })
      .filter((entry) => entry.length > 0),
  );
}

async function deriveImpactSignals(
  changedFunctions: string[],
  storage: StorageSlice | null,
): Promise<ImpactSignals> {
  const baseSymbols = uniqueSorted(changedFunctions.map(parseFunctionName));
  if (changedFunctions.length === 0 || !storage) {
    return {
      impactedFiles: [],
      impactedSymbols: baseSymbols,
      usedGraphSignals: false,
    };
  }

  const functions = await storage.getFunctions({ limit: 25_000 });
  const functionsById = new Map<string, FunctionKnowledge>(functions.map((fn) => [fn.id, fn]));

  const edgeQuery: GraphEdgeQueryOptions = {
    edgeTypes: ['calls'],
    limit: 10_000,
  };

  const [incoming, outgoing] = await Promise.all([
    storage.getGraphEdges({ ...edgeQuery, toIds: changedFunctions }),
    storage.getGraphEdges({ ...edgeQuery, fromIds: changedFunctions }),
  ]);

  const impactedFunctionIds = new Set<string>(changedFunctions);
  for (const edge of incoming) impactedFunctionIds.add(edge.fromId);
  for (const edge of outgoing) impactedFunctionIds.add(edge.toId);

  const impactedFiles = new Set<string>();
  const impactedSymbols = new Set<string>(baseSymbols);
  for (const functionId of impactedFunctionIds) {
    impactedSymbols.add(parseFunctionName(functionId));
    const fn = functionsById.get(functionId);
    if (fn?.filePath) {
      impactedFiles.add(normalizePath(fn.filePath));
    }
  }

  return {
    impactedFiles: uniqueSorted(impactedFiles),
    impactedSymbols: uniqueSorted(impactedSymbols),
    usedGraphSignals: incoming.length > 0 || outgoing.length > 0,
  };
}

function evaluateCandidate(
  testPath: string,
  changedFiles: string[],
  impactedFiles: string[],
  impactedSymbols: string[],
  intentTokens: string[],
): CandidateEvaluation {
  const normalized = normalizePath(testPath);
  const lowered = normalized.toLowerCase();
  const kind = classifyTestKind(normalized);
  const pathTokens = splitPathTokens(normalized);
  const pathTokenSet = new Set(pathTokens);

  let score = kind === 'unit' ? 0.2
    : kind === 'integration' ? 0.18
    : kind === 'regression' ? 0.16
    : kind === 'e2e' ? 0.1
    : 0.12;

  const reasons: string[] = [];
  const matchedFiles = new Set<string>();
  const matchedSymbols = new Set<string>();

  const candidateFiles = uniqueSorted([...changedFiles, ...impactedFiles]);
  for (const file of candidateFiles) {
    const normalizedFile = normalizePath(file);
    const stem = stemFromPath(normalizedFile);
    if (stem.length >= 3 && lowered.includes(stem.replace(/\s+/g, '_'))) {
      score += 0.48;
      reasons.push(`matches impacted file stem: ${normalizedFile}`);
      matchedFiles.add(normalizedFile);
      continue;
    }
    if (stem.length >= 3 && lowered.includes(stem.replace(/\s+/g, '-'))) {
      score += 0.45;
      reasons.push(`matches impacted file stem: ${normalizedFile}`);
      matchedFiles.add(normalizedFile);
      continue;
    }
    if (stem.length >= 3 && lowered.includes(stem.replace(/\s+/g, ''))) {
      score += 0.4;
      reasons.push(`matches impacted file stem: ${normalizedFile}`);
      matchedFiles.add(normalizedFile);
      continue;
    }

    const fileTokens = splitPathTokens(normalizedFile);
    const overlap = fileTokens.filter((token) => pathTokenSet.has(token));
    if (overlap.length >= 2) {
      score += 0.24;
      reasons.push(`shares impacted path context (${overlap.slice(0, 2).join(', ')})`);
      matchedFiles.add(normalizedFile);
    }
  }

  for (const symbol of impactedSymbols) {
    const loweredSymbol = symbol.toLowerCase();
    if (loweredSymbol.length < 3) continue;
    if (lowered.includes(loweredSymbol) || pathTokenSet.has(loweredSymbol)) {
      score += 0.2;
      reasons.push(`covers impacted symbol: ${symbol}`);
      matchedSymbols.add(symbol);
    }
  }

  const intentOverlap = intentTokens.filter((token) => pathTokenSet.has(token) || lowered.includes(token));
  if (intentOverlap.length > 0) {
    score += Math.min(0.24, 0.08 * intentOverlap.length);
    reasons.push(`aligned with intent tokens: ${intentOverlap.slice(0, 3).join(', ')}`);
  }

  const smokeHint = isSmokeHint(normalized);
  if (smokeHint) {
    score += 0.12;
    reasons.push('explicit smoke/sanity signal');
  }

  const regressionHint = isRegressionHint(normalized);
  if (regressionHint) {
    score += 0.1;
    reasons.push('explicit regression/contract signal');
  }

  if (matchedFiles.size === 0 && matchedSymbols.size === 0 && intentOverlap.length === 0 && !smokeHint && !regressionHint) {
    reasons.push('low direct impact signal; retained as low-priority candidate');
    score -= 0.1;
  }

  return {
    testPath: normalized,
    kind,
    score: clamp01(score),
    reason: reasons.join('; '),
    impactedFiles: uniqueSorted(matchedFiles),
    impactedSymbols: uniqueSorted(matchedSymbols),
    smokeHint,
    regressionHint,
  };
}

function buildSelection(
  evaluation: CandidateEvaluation,
  stage: Exclude<PlannedTestStage, 'fallback'>,
): PlannedTestSelection {
  return {
    testPath: evaluation.testPath,
    stage,
    kind: evaluation.kind,
    score: Number(evaluation.score.toFixed(3)),
    reason: evaluation.reason,
    impactedFiles: evaluation.impactedFiles,
    impactedSymbols: evaluation.impactedSymbols,
  };
}

function estimateConfidence(
  changedFiles: string[],
  selected: PlannedTestSelection[],
  candidateCount: number,
  usedGraphSignals: boolean,
): number {
  if (selected.length === 0) return 0.14;

  const changed = changedFiles.map(normalizePath);
  const coveredCount = changed.filter((changedFile) =>
    selected.some((entry) =>
      entry.impactedFiles.includes(changedFile)
      || entry.testPath.includes(stemFromPath(changedFile).replace(/\s+/g, '_'))
      || entry.testPath.includes(stemFromPath(changedFile).replace(/\s+/g, '-'))
      || entry.testPath.includes(stemFromPath(changedFile).replace(/\s+/g, ''))
    )).length;

  const coverage = changed.length > 0 ? coveredCount / changed.length : 0.65;
  const reasonDensity = selected.reduce((acc, entry) => acc + (entry.reason.split(';').length >= 2 ? 1 : 0), 0) / selected.length;
  const selectionDensity = selected.length / Math.max(1, Math.min(candidateCount, 8));

  let confidence = 0.24
    + 0.45 * clamp01(coverage)
    + 0.14 * clamp01(reasonDensity)
    + 0.12 * clamp01(selectionDensity);
  if (usedGraphSignals) {
    confidence += 0.06;
  }

  return Number(clamp01(confidence).toFixed(3));
}

function summarize(
  selected: PlannedTestSelection[],
  confidence: number,
  escalation: PlannerEscalationPolicy,
): string {
  if (selected.length === 0) {
    return `No high-signal tests were selected automatically; fallback escalation is ${escalation.enabled ? 'enabled' : 'disabled'}.`;
  }
  const smokeCount = selected.filter((entry) => entry.stage === 'smoke').length;
  const targetedCount = selected.filter((entry) => entry.stage === 'targeted').length;
  const regressionCount = selected.filter((entry) => entry.stage === 'regression').length;
  return [
    `Planned ${selected.length} test(s)`,
    `(smoke=${smokeCount}, targeted=${targetedCount}, regression=${regressionCount})`,
    `with confidence ${confidence.toFixed(2)}`,
    `${escalation.enabled ? 'and fallback escalation enabled' : 'and fallback escalation disabled'}.`,
  ].join(' ');
}

export function createImpactAwareTestSequencePlannerConstruction(): Construction<
  ImpactAwareTestSequencePlannerInput,
  ImpactAwareTestSequencePlannerOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'impact-aware-test-sequence-planner',
    name: 'Impact-Aware Test Sequence Planner',
    description: 'Plans a change-scoped, intent-aware test execution sequence with explainable rationale and fallback escalation.',
    async execute(input: ImpactAwareTestSequencePlannerInput, context?: Context<unknown>) {
      const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot, context);
      const changedFiles = uniqueSorted([
        ...(input.changedFiles ?? []).map(normalizePath),
        ...parseChangedFilesFromDiff(input.diff),
      ]);
      const changedFunctions = uniqueSorted((input.changedFunctions ?? []).map((id) => id.trim()).filter((id) => id.length > 0));
      const hasInputSignals = changedFiles.length > 0 || changedFunctions.length > 0 || Boolean(input.intent) || Boolean(input.diff);
      const includeFallback = input.includeFallbackSuite !== false;
      const fallbackCommand = input.fallbackCommand?.trim().length ? input.fallbackCommand.trim() : 'npm test -- --run';
      const threshold = clamp01(input.confidenceThresholdForFallback ?? 0.58);

      if (!hasInputSignals) {
        const fallbackGroups: PlannedTestGroup[] = includeFallback
          ? [{
            stage: 'fallback',
            tests: [fallbackCommand],
            rationale: 'No explicit change or intent signal provided; use fallback verification sequence.',
            confidence: 0.14,
            escalationTrigger: 'no change/intent signal provided',
          }]
          : [];
        return ok<ImpactAwareTestSequencePlannerOutput, ConstructionError>({
          groups: fallbackGroups,
          selectedTests: [],
          skippedTests: [],
          impactedFiles: [],
          impactedSymbols: [],
          confidence: 0.14,
          escalationPolicy: {
            enabled: includeFallback,
            reason: 'no_targeted_tests',
            trigger: 'no change/intent signal provided',
            fallbackCommand,
          },
          agentSummary: 'No change/intent signal provided; generated fallback-only test guidance.',
        });
      }

      const storage = await resolveStorage(context);
      const impactSignals = await deriveImpactSignals(changedFunctions, storage);
      const impactedFiles = uniqueSorted([...changedFiles, ...impactSignals.impactedFiles]);
      const impactedSymbols = uniqueSorted(impactSignals.impactedSymbols);
      const intentTokens = tokenizeIntent(input.intent);

      const explicitTests = normalizeInputTestPaths(input.availableTests, workspaceRoot);
      const candidateTests = explicitTests.length > 0
        ? explicitTests
        : await discoverTestFiles(workspaceRoot);

      const evaluations = candidateTests
        .map((testPath) => evaluateCandidate(testPath, changedFiles, impactedFiles, impactedSymbols, intentTokens))
        .sort((a, b) => b.score - a.score || a.testPath.localeCompare(b.testPath));

      const maxInitialTests = Math.max(1, Math.min(24, input.maxInitialTests ?? 8));
      const smokeLimit = Math.max(1, Math.min(4, Math.ceil(maxInitialTests / 3)));

      const selectedByPath = new Map<string, PlannedTestSelection>();

      const smokeCandidates = evaluations.filter((entry) =>
        entry.smokeHint || (entry.kind === 'unit' && entry.score >= 0.45));
      for (const entry of smokeCandidates.slice(0, smokeLimit)) {
        selectedByPath.set(entry.testPath, buildSelection(entry, 'smoke'));
      }

      const remainingAfterSmoke = evaluations.filter((entry) => !selectedByPath.has(entry.testPath));
      const targetedLimit = Math.max(1, maxInitialTests - selectedByPath.size);
      const targetedCandidates = remainingAfterSmoke.filter((entry) => entry.score >= 0.26);
      for (const entry of targetedCandidates.slice(0, targetedLimit)) {
        selectedByPath.set(entry.testPath, buildSelection(entry, 'targeted'));
      }

      const bugOrRegressionIntent = /\b(bug|fix|regress|incident|outage|contract)\b/i.test(input.intent ?? '');
      const remainingAfterTargeted = evaluations.filter((entry) => !selectedByPath.has(entry.testPath));
      const regressionCandidates = remainingAfterTargeted.filter((entry) =>
        entry.regressionHint || (bugOrRegressionIntent && (entry.kind === 'integration' || entry.kind === 'regression')),
      );
      for (const entry of regressionCandidates.slice(0, 3)) {
        selectedByPath.set(entry.testPath, buildSelection(entry, 'regression'));
      }

      const selected = Array.from(selectedByPath.values())
        .sort((a, b) => b.score - a.score || a.testPath.localeCompare(b.testPath));

      const confidence = estimateConfidence(changedFiles, selected, candidateTests.length, impactSignals.usedGraphSignals);

      const fallbackReason: PlannerEscalationPolicy['reason'] = selected.length === 0
        ? 'no_targeted_tests'
        : confidence < threshold
          ? 'low_confidence'
          : 'failure';

      const escalationEnabled = includeFallback;
      const escalationPolicy: PlannerEscalationPolicy = {
        enabled: escalationEnabled,
        reason: fallbackReason,
        trigger: fallbackReason === 'low_confidence'
          ? `confidence ${confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}`
          : fallbackReason === 'no_targeted_tests'
            ? 'no high-signal targeted tests selected'
            : 'run fallback suite if staged tests fail',
        fallbackCommand,
      };

      const groups: PlannedTestGroup[] = [];
      const smokeTests = selected.filter((entry) => entry.stage === 'smoke').map((entry) => entry.testPath);
      const targetedTests = selected.filter((entry) => entry.stage === 'targeted').map((entry) => entry.testPath);
      const regressionTests = selected.filter((entry) => entry.stage === 'regression').map((entry) => entry.testPath);

      if (smokeTests.length > 0) {
        groups.push({
          stage: 'smoke',
          tests: smokeTests,
          rationale: 'Fast, high-signal smoke checks first to detect immediate breakage in impacted surfaces.',
          confidence,
        });
      }
      if (targetedTests.length > 0) {
        groups.push({
          stage: 'targeted',
          tests: targetedTests,
          rationale: 'Impact-matched tests for changed files, symbols, and intent-driven coverage.',
          confidence,
        });
      }
      if (regressionTests.length > 0) {
        groups.push({
          stage: 'regression',
          tests: regressionTests,
          rationale: 'Regression/contract checks for bug-risk and behavior-drift containment.',
          confidence,
        });
      }

      if (includeFallback && (confidence < threshold || selected.length === 0)) {
        groups.push({
          stage: 'fallback',
          tests: [fallbackCommand],
          rationale: 'Escalate to broader suite because confidence is low or targeted coverage is sparse.',
          confidence,
          escalationTrigger: escalationPolicy.trigger,
        });
      }

      const selectedPaths = new Set(selected.map((entry) => entry.testPath));
      const skippedTests = candidateTests.filter((testPath) => !selectedPaths.has(testPath));

      return ok<ImpactAwareTestSequencePlannerOutput, ConstructionError>({
        groups,
        selectedTests: selected,
        skippedTests,
        impactedFiles,
        impactedSymbols,
        confidence,
        escalationPolicy,
        agentSummary: summarize(selected, confidence, escalationPolicy),
      });
    },
  };
}
