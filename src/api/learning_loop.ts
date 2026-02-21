import type { LiBrainianStorage, MetadataStorage, StorageSlices } from '../storage/types.js';
import type { Episode } from '../strategic/building_blocks.js';
import { safeJsonParse } from '../utils/safe_json.js';

const LEARNING_STATE_KEY = 'librainian.learning_loop.v1';
const DEFAULT_MAX_INTENTS = 200;
const DEFAULT_MAX_WARNINGS = 50;
const DEFAULT_MIN_SIMILARITY = 0.2;
const DEFAULT_MAX_SUGGESTIONS = 5;
const DEFAULT_FALLBACK_MIN_SAMPLES = 3;
const DEFAULT_ANTI_PATTERN_MIN_SAMPLES = 5;
const DEFAULT_ANTI_PATTERN_MAX_SUCCESS_RATE = 0.2;
const DEFAULT_ANTI_PATTERN_SIMILARITY = 0.7;
const DEFAULT_SURPRISE_MULTIPLIER = 1.3;
const DEFAULT_CONSOLIDATION_MIN_SAMPLES = 5;
const DEFAULT_CONSOLIDATION_MIN_PREDICTIVE = 0.1;
const DEFAULT_INVARIANT_MIN_SAMPLES = 20;
const DEFAULT_INVARIANT_MIN_SUCCESS_RATE = 0.9;
const DEFAULT_SHIFT_THRESHOLD = 0.5;
const WORKING_TIER_MULTIPLIER = 0.7;
const RECENT_TIER_MULTIPLIER = 0.85;
const LEARNED_TIER_MULTIPLIER = 1;
const INVARIANT_TIER_MULTIPLIER = 1.1;
const ANTI_PATTERN_WARNING = 'This approach has failed consistently';
const SHIFT_WARNING = 'Distribution shift detected; patterns may not apply';

export interface LearningOutcome {
  success: boolean;
  intent?: string;
  compositionId?: string;
  primitiveIds?: string[];
  contextPackIds?: string[];
  warnings?: string[];
  error?: string;
  codebaseStats?: CodebaseStats;
  metadata?: Record<string, unknown>;
}

export interface LearningInsight {
  type: 'composition_effectiveness' | 'primitive_effectiveness' | 'context_pack_relevance' | 'failure_pattern';
  targetId?: string;
  success?: boolean;
  detail?: string;
}

export interface ModelUpdate {
  targetType: 'composition' | 'primitive' | 'context_pack';
  targetId: string;
  previousScore: number;
  newScore: number;
  delta: number;
  updatedAt: string;
}

export interface Recommendation {
  type: 'composition' | 'primitive' | 'context_source';
  id: string;
  score: number;
  reason: string;
}

export interface LearningUpdate {
  insights: LearningInsight[];
  modelUpdates: ModelUpdate[];
  recommendations: Recommendation[];
}

export type PatternTier = 'working' | 'recent' | 'learned' | 'invariant';

export interface ConsolidationOptions {
  minSampleCount?: number;
  minPredictiveValue?: number;
  invariantMinSamples?: number;
  invariantMinSuccessRate?: number;
}

export interface ConsolidationResult {
  merged: number;
  pruned: number;
  strengthened: number;
}

export interface CodebaseStats {
  embeddingMean: number[];
  embeddingVariance: number[];
  sampleCount: number;
  collectedAt: string;
}

export interface CompositionSuggestion {
  compositionId: string;
  score: number;
  successRate: number;
  examples: number;
}

export interface PrimitiveSuggestion {
  primitiveId: string;
  score: number;
  successRate: number;
  examples: number;
}

export interface ContextSourceSuggestion {
  sourceId: string;
  score: number;
  successRate: number;
  examples: number;
}

export interface HistoricalWarning {
  intent: string;
  failure: string;
  suggestion?: string;
  compositionId?: string;
  primitiveId?: string;
  contextSourceId?: string;
  timestamp: string;
}

export interface LearnedRecommendations {
  suggestedCompositions: CompositionSuggestion[];
  effectivePrimitives: PrimitiveSuggestion[];
  reliableContextSources: ContextSourceSuggestion[];
  warningsFromHistory: HistoricalWarning[];
}

export interface LearningQueryContext {
  maxSuggestions?: number;
  minSimilarity?: number;
  maxWarnings?: number;
  fallbackToGlobal?: boolean;
  codebaseStats?: CodebaseStats;
  requireShiftDetection?: boolean;
}

export interface LearningLoop {
  recordOutcome(episode: Episode, outcome: LearningOutcome): Promise<LearningUpdate>;
  getRecommendations(intent: string, context?: LearningQueryContext): Promise<LearnedRecommendations>;
  consolidate(options?: ConsolidationOptions): Promise<ConsolidationResult>;
}

export interface LearningLoopOptions {
  maxIntents?: number;
  maxWarningsPerIntent?: number;
  minSimilarity?: number;
  maxSuggestions?: number;
  fallbackMinSamples?: number;
}

interface LearningScoreEntry {
  successes: number;
  failures: number;
  lastUpdatedAt: string;
  lastOutcomeWasUnexpected?: boolean;
  tier?: PatternTier;
  promotedAt?: string;
}

interface LearningAggregate {
  compositions: Record<string, LearningScoreEntry>;
  primitives: Record<string, LearningScoreEntry>;
  contextSources: Record<string, LearningScoreEntry>;
  updatedAt?: string;
  warnings?: HistoricalWarning[];
  codebaseStats?: CodebaseStats;
}

interface LearningIntentRecord {
  intent: string;
  tokens: string[];
  updatedAt: string;
  compositions: Record<string, LearningScoreEntry>;
  primitives: Record<string, LearningScoreEntry>;
  contextSources: Record<string, LearningScoreEntry>;
  warnings: HistoricalWarning[];
}

interface LearningLoopState {
  schema_version: 1;
  intents: Record<string, LearningIntentRecord>;
  global: LearningAggregate;
  updated_at?: string;
}

const EMPTY_STATE: LearningLoopState = {
  schema_version: 1,
  intents: {},
  global: {
    compositions: {},
    primitives: {},
    contextSources: {},
  },
};

type LearningStorage = MetadataStorage | StorageSlices | LiBrainianStorage;

export class ClosedLoopLearner implements LearningLoop {
  private storage: MetadataStorage;
  private options: Required<LearningLoopOptions>;

  constructor(storage: LearningStorage, options: LearningLoopOptions = {}) {
    this.storage = resolveMetadataStorage(storage);
    this.options = {
      maxIntents: options.maxIntents ?? DEFAULT_MAX_INTENTS,
      maxWarningsPerIntent: options.maxWarningsPerIntent ?? DEFAULT_MAX_WARNINGS,
      minSimilarity: options.minSimilarity ?? DEFAULT_MIN_SIMILARITY,
      maxSuggestions: options.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS,
      fallbackMinSamples: options.fallbackMinSamples ?? DEFAULT_FALLBACK_MIN_SAMPLES,
    };
  }

  async recordOutcome(episode: Episode, outcome: LearningOutcome): Promise<LearningUpdate> {
    const now = new Date().toISOString();
    const state = await loadLearningState(this.storage);
    const intent = resolveIntent(episode, outcome);
    const intentKey = intent ? normalizeIntent(intent) : '';
    const record = intentKey
      ? ensureIntentRecord(state, intentKey, intent, now)
      : null;

    const insights: LearningInsight[] = [];
    const modelUpdates: ModelUpdate[] = [];

    const compositionId = outcome.compositionId;
    if (compositionId) {
      modelUpdates.push(...applyScoreUpdate({
        targetId: compositionId,
        targetType: 'composition',
        success: outcome.success,
        now,
        record,
        aggregate: state.global,
      }));
      insights.push({
        type: 'composition_effectiveness',
        targetId: compositionId,
        success: outcome.success,
      });
    }

    for (const primitiveId of outcome.primitiveIds ?? []) {
      modelUpdates.push(...applyScoreUpdate({
        targetId: primitiveId,
        targetType: 'primitive',
        success: outcome.success,
        now,
        record,
        aggregate: state.global,
      }));
      insights.push({
        type: 'primitive_effectiveness',
        targetId: primitiveId,
        success: outcome.success,
      });
    }

    for (const packId of outcome.contextPackIds ?? []) {
      modelUpdates.push(...applyScoreUpdate({
        targetId: packId,
        targetType: 'context_pack',
        success: outcome.success,
        now,
        record,
        aggregate: state.global,
      }));
      insights.push({
        type: 'context_pack_relevance',
        targetId: packId,
        success: outcome.success,
      });
    }

    const warnings = buildWarnings(intent, outcome, episode, now);
    if (warnings.length > 0) {
      insights.push(...warnings.map((warning): LearningInsight => ({
        type: 'failure_pattern',
        targetId: warning.compositionId ?? warning.primitiveId,
        detail: warning.failure,
      })));
      if (record) {
        record.warnings = trimWarnings([...record.warnings, ...warnings], this.options.maxWarningsPerIntent);
      }
      state.global.warnings = trimWarnings([...(state.global.warnings ?? []), ...warnings], this.options.maxWarningsPerIntent);
    }

    const normalizedStats = normalizeCodebaseStats(outcome.codebaseStats, now);
    if (normalizedStats) {
      state.global.codebaseStats = normalizedStats;
    }

    if (record) {
      record.updatedAt = now;
      pruneIntentRecords(state, this.options.maxIntents);
    }
    state.global.updatedAt = now;
    state.updated_at = now;
    await persistLearningState(this.storage, state);

    const recommendations = intent
      ? buildRecommendations(state, intent, {
          maxSuggestions: this.options.maxSuggestions,
          minSimilarity: this.options.minSimilarity,
          fallbackToGlobal: true,
        }, this.options)
      : emptyRecommendations();

    return {
      insights,
      modelUpdates,
      recommendations: flattenRecommendations(recommendations),
    };
  }

  async getRecommendations(intent: string, context: LearningQueryContext = {}): Promise<LearnedRecommendations> {
    const state = await loadLearningState(this.storage);
    return buildRecommendations(state, intent, context, this.options);
  }

  async consolidate(options: ConsolidationOptions = {}): Promise<ConsolidationResult> {
    const now = new Date().toISOString();
    const settings = resolveConsolidationSettings(options);
    const state = await loadLearningState(this.storage);
    let merged = 0;
    let pruned = 0;
    let strengthened = 0;

    for (const record of Object.values(state.intents)) {
      const result = consolidateRecord(record, settings, now);
      merged += result.merged;
      pruned += result.pruned;
      strengthened += result.strengthened;
      record.updatedAt = now;
    }

    const aggregateResult = consolidateAggregate(state.global, settings, now);
    merged += aggregateResult.merged;
    pruned += aggregateResult.pruned;
    strengthened += aggregateResult.strengthened;

    state.global.updatedAt = now;
    state.updated_at = now;
    await persistLearningState(this.storage, state);

    return { merged, pruned, strengthened };
  }
}

function emptyRecommendations(): LearnedRecommendations {
  return {
    suggestedCompositions: [],
    effectivePrimitives: [],
    reliableContextSources: [],
    warningsFromHistory: [],
  };
}

function flattenRecommendations(recommendations: LearnedRecommendations): Recommendation[] {
  const results: Recommendation[] = [];
  for (const suggestion of recommendations.suggestedCompositions) {
    results.push({
      type: 'composition',
      id: suggestion.compositionId,
      score: suggestion.score,
      reason: `Success rate ${suggestion.successRate.toFixed(2)} from ${suggestion.examples} examples`,
    });
  }
  for (const suggestion of recommendations.effectivePrimitives) {
    results.push({
      type: 'primitive',
      id: suggestion.primitiveId,
      score: suggestion.score,
      reason: `Success rate ${suggestion.successRate.toFixed(2)} from ${suggestion.examples} examples`,
    });
  }
  for (const suggestion of recommendations.reliableContextSources) {
    results.push({
      type: 'context_source',
      id: suggestion.sourceId,
      score: suggestion.score,
      reason: `Success rate ${suggestion.successRate.toFixed(2)} from ${suggestion.examples} examples`,
    });
  }
  return results;
}

function applyScoreUpdate(input: {
  targetId: string;
  targetType: ModelUpdate['targetType'];
  success: boolean;
  now: string;
  record: LearningIntentRecord | null;
  aggregate: LearningAggregate;
}): ModelUpdate[] {
  const updates: ModelUpdate[] = [];
  const { targetId, targetType, success, now } = input;
  const recordTarget = input.record
    ? getScoreMap(input.record, targetType)
    : null;
  const aggregateTarget = getScoreMap(input.aggregate, targetType);

  if (recordTarget) {
    const update = updateScoreEntry(recordTarget, targetId, success, now);
    updates.push({
      targetType,
      targetId,
      previousScore: update.previousScore,
      newScore: update.newScore,
      delta: update.newScore - update.previousScore,
      updatedAt: now,
    });
  }

  const aggregateUpdate = updateScoreEntry(aggregateTarget, targetId, success, now);
  updates.push({
    targetType,
    targetId,
    previousScore: aggregateUpdate.previousScore,
    newScore: aggregateUpdate.newScore,
    delta: aggregateUpdate.newScore - aggregateUpdate.previousScore,
    updatedAt: now,
  });

  return updates;
}

function getScoreMap(
  container: LearningIntentRecord | LearningAggregate,
  targetType: ModelUpdate['targetType']
): Record<string, LearningScoreEntry> {
  switch (targetType) {
    case 'composition':
      return container.compositions;
    case 'primitive':
      return container.primitives;
    case 'context_pack':
      return container.contextSources;
    default:
      return container.compositions;
  }
}

function updateScoreEntry(
  map: Record<string, LearningScoreEntry>,
  targetId: string,
  success: boolean,
  now: string
): { previousScore: number; newScore: number } {
  const entry = map[targetId] ?? { successes: 0, failures: 0, lastUpdatedAt: now };
  const previousScore = scoreEntry(entry);
  if (success) entry.successes += 1;
  else entry.failures += 1;
  entry.lastOutcomeWasUnexpected = Math.abs((success ? 1 : 0) - previousScore) > 0.5;
  entry.lastUpdatedAt = now;
  map[targetId] = entry;
  const newScore = scoreEntry(entry);
  return { previousScore, newScore };
}

function scoreEntry(entry: LearningScoreEntry | undefined): number {
  if (!entry) return 0.5;
  const total = entry.successes + entry.failures;
  return (entry.successes + 1) / (total + 2);
}

function buildWarnings(
  intent: string,
  outcome: LearningOutcome,
  episode: Episode,
  now: string
): HistoricalWarning[] {
  if (outcome.success) return [];
  const resolvedIntent = intent || 'unknown';
  const warnings: HistoricalWarning[] = [];
  const reasons = outcome.warnings?.length
    ? outcome.warnings
    : [outcome.error, episode.outcome?.error].filter((value): value is string => typeof value === 'string' && value.length > 0);
  for (const reason of reasons) {
    warnings.push({
      intent: resolvedIntent,
      failure: reason,
      suggestion: outcome.metadata?.suggestion
        ? String(outcome.metadata.suggestion)
        : undefined,
      compositionId: outcome.compositionId,
      primitiveId: outcome.primitiveIds?.[0],
      contextSourceId: outcome.contextPackIds?.[0],
      timestamp: now,
    });
  }
  return warnings;
}

function trimWarnings(warnings: HistoricalWarning[], limit: number): HistoricalWarning[] {
  if (warnings.length <= limit) return warnings;
  return warnings.slice(warnings.length - limit);
}

function buildRecommendations(
  state: LearningLoopState,
  intent: string,
  context: LearningQueryContext,
  options: Required<LearningLoopOptions>
): LearnedRecommendations {
  const tokens = tokenizeIntent(intent);
  if (!tokens.length) return emptyRecommendations();

  const minSimilarity = context.minSimilarity ?? options.minSimilarity;
  const maxSuggestions = context.maxSuggestions ?? options.maxSuggestions;
  const maxWarnings = context.maxWarnings ?? options.maxWarningsPerIntent;
  const now = Date.now();

  const compositionAggregate = new Map<string, AggregatedScore>();
  const primitiveAggregate = new Map<string, AggregatedScore>();
  const contextAggregate = new Map<string, AggregatedScore>();
  const warningCandidates: HistoricalWarning[] = [];
  const antiPatternWarnings: HistoricalWarning[] = [];
  const antiPatternSeen = new Set<string>();
  let totalMatches = 0;

  for (const record of Object.values(state.intents)) {
    const similarity = jaccard(tokens, record.tokens);
    if (similarity < minSimilarity) continue;
    totalMatches += 1;
    const recency = recencyWeight(record.updatedAt, now);
    const weight = similarity * recency;
    accumulateScores(compositionAggregate, record.compositions, weight);
    accumulateScores(primitiveAggregate, record.primitives, weight);
    accumulateScores(contextAggregate, record.contextSources, weight);
    collectAntiPatternWarnings({
      warnings: antiPatternWarnings,
      seen: antiPatternSeen,
      intent: record.intent,
      similarity,
      entries: record.compositions,
      targetType: 'composition',
      timestamp: record.updatedAt,
    });
    collectAntiPatternWarnings({
      warnings: antiPatternWarnings,
      seen: antiPatternSeen,
      intent: record.intent,
      similarity,
      entries: record.primitives,
      targetType: 'primitive',
      timestamp: record.updatedAt,
    });
    collectAntiPatternWarnings({
      warnings: antiPatternWarnings,
      seen: antiPatternSeen,
      intent: record.intent,
      similarity,
      entries: record.contextSources,
      targetType: 'context_pack',
      timestamp: record.updatedAt,
    });
    warningCandidates.push(...record.warnings);
  }

  const fallbackToGlobal = context.fallbackToGlobal ?? false;
  if (fallbackToGlobal && totalMatches === 0) {
    const aggregateSamples = sumSamples(state.global.compositions);
    if (aggregateSamples >= options.fallbackMinSamples) {
      accumulateScores(compositionAggregate, state.global.compositions, 0.15);
      accumulateScores(primitiveAggregate, state.global.primitives, 0.15);
      accumulateScores(contextAggregate, state.global.contextSources, 0.15);
      warningCandidates.push(...(state.global.warnings ?? []));
    }
  }

  warningCandidates.push(...antiPatternWarnings);
  const shiftResult = detectDistributionShift(state.global.codebaseStats, context.codebaseStats);
  const shiftPenalty = shiftResult.status === 'shifted'
    ? Math.exp(-shiftResult.magnitude)
    : 1;
  const shiftWarning = buildShiftWarning({
    intent,
    nowMs: now,
    result: shiftResult,
    requireShiftDetection: context.requireShiftDetection ?? false,
  });
  if (shiftWarning) {
    warningCandidates.push(shiftWarning);
  }

  const suggestedCompositions = rankAggregates(compositionAggregate)
    .filter((entry) => entry.score > 0)
    .slice(0, maxSuggestions)
    .map((entry) => ({
      compositionId: entry.id,
      score: entry.score * shiftPenalty,
      successRate: entry.successRate,
      examples: entry.examples,
    }));
  const effectivePrimitives = rankAggregates(primitiveAggregate)
    .filter((entry) => entry.score > 0)
    .slice(0, maxSuggestions)
    .map((entry) => ({
      primitiveId: entry.id,
      score: entry.score * shiftPenalty,
      successRate: entry.successRate,
      examples: entry.examples,
    }));
  const reliableContextSources = rankAggregates(contextAggregate)
    .filter((entry) => entry.score > 0)
    .slice(0, maxSuggestions)
    .map((entry) => ({
      sourceId: entry.id,
      score: entry.score * shiftPenalty,
      successRate: entry.successRate,
      examples: entry.examples,
    }));
  const warningsFromHistory = warningCandidates
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, maxWarnings);

  return {
    suggestedCompositions,
    effectivePrimitives,
    reliableContextSources,
    warningsFromHistory,
  };
}

type ConsolidationSettings = Required<ConsolidationOptions>;

function resolveConsolidationSettings(options: ConsolidationOptions): ConsolidationSettings {
  return {
    minSampleCount: options.minSampleCount ?? DEFAULT_CONSOLIDATION_MIN_SAMPLES,
    minPredictiveValue: options.minPredictiveValue ?? DEFAULT_CONSOLIDATION_MIN_PREDICTIVE,
    invariantMinSamples: options.invariantMinSamples ?? DEFAULT_INVARIANT_MIN_SAMPLES,
    invariantMinSuccessRate: options.invariantMinSuccessRate ?? DEFAULT_INVARIANT_MIN_SUCCESS_RATE,
  };
}

function consolidateRecord(
  record: LearningIntentRecord,
  settings: ConsolidationSettings,
  now: string
): ConsolidationResult {
  const compositionResult = consolidateScoreMap(record.compositions, settings, now);
  const primitiveResult = consolidateScoreMap(record.primitives, settings, now);
  const contextResult = consolidateScoreMap(record.contextSources, settings, now);
  return {
    merged: compositionResult.merged + primitiveResult.merged + contextResult.merged,
    pruned: compositionResult.pruned + primitiveResult.pruned + contextResult.pruned,
    strengthened: compositionResult.strengthened + primitiveResult.strengthened + contextResult.strengthened,
  };
}

function consolidateAggregate(
  aggregate: LearningAggregate,
  settings: ConsolidationSettings,
  now: string
): ConsolidationResult {
  const compositionResult = consolidateScoreMap(aggregate.compositions, settings, now);
  const primitiveResult = consolidateScoreMap(aggregate.primitives, settings, now);
  const contextResult = consolidateScoreMap(aggregate.contextSources, settings, now);
  return {
    merged: compositionResult.merged + primitiveResult.merged + contextResult.merged,
    pruned: compositionResult.pruned + primitiveResult.pruned + contextResult.pruned,
    strengthened: compositionResult.strengthened + primitiveResult.strengthened + contextResult.strengthened,
  };
}

function consolidateScoreMap(
  entries: Record<string, LearningScoreEntry>,
  settings: ConsolidationSettings,
  now: string
): ConsolidationResult {
  let merged = 0;
  let pruned = 0;
  let strengthened = 0;

  for (const [id, entry] of Object.entries(entries)) {
    const tier = ensureTier(entry, now);
    const samples = entry.successes + entry.failures;
    const successRate = scoreEntry(entry);
    const predictiveValue = Math.abs(successRate - 0.5);

    if (
      tier !== 'invariant' &&
      samples >= settings.minSampleCount &&
      predictiveValue < settings.minPredictiveValue
    ) {
      delete entries[id];
      pruned += 1;
      continue;
    }

    const nextTier = promoteTier({
      tier,
      samples,
      predictiveValue,
      successRate,
      settings,
    });
    if (nextTier !== entry.tier) {
      entry.tier = nextTier;
      entry.promotedAt = now;
    }

    if (successRate >= 0.7) {
      strengthened += 1;
    }
  }

  return { merged, pruned, strengthened };
}

type ShiftDetectionStatus = 'ok' | 'shifted' | 'unknown' | 'incompatible';

type ShiftDetectionResult = {
  status: ShiftDetectionStatus;
  magnitude: number;
};

function detectDistributionShift(
  learned: CodebaseStats | undefined,
  current: CodebaseStats | undefined
): ShiftDetectionResult {
  if (!learned || !current) return { status: 'unknown', magnitude: 0 };
  const mean = learned.embeddingMean;
  const variance = learned.embeddingVariance;
  const currentMean = current.embeddingMean;
  const currentVariance = current.embeddingVariance;
  if (!mean.length || !variance.length || !currentMean.length || !currentVariance.length) {
    return { status: 'unknown', magnitude: 0 };
  }
  if (
    mean.length !== variance.length ||
    currentMean.length !== currentVariance.length ||
    mean.length !== currentMean.length
  ) {
    return { status: 'incompatible', magnitude: 0 };
  }
  let sum = 0;
  for (let i = 0; i < mean.length; i += 1) {
    const diff = mean[i] - currentMean[i];
    const denom = variance[i] + 1e-8;
    sum += (diff * diff) / denom;
  }
  const magnitude = sum / mean.length;
  if (!Number.isFinite(magnitude)) return { status: 'unknown', magnitude: 0 };
  return {
    status: magnitude > DEFAULT_SHIFT_THRESHOLD ? 'shifted' : 'ok',
    magnitude,
  };
}

function buildShiftWarning(input: {
  intent: string;
  nowMs: number;
  result: ShiftDetectionResult;
  requireShiftDetection: boolean;
}): HistoricalWarning | null {
  const timestamp = new Date(input.nowMs).toISOString();
  if (input.result.status === 'shifted') {
    return {
      intent: input.intent,
      failure: SHIFT_WARNING,
      suggestion: 'Re-evaluate recommendations with updated context or new evidence',
      timestamp,
    };
  }
  if (input.result.status === 'incompatible') {
    return {
      intent: input.intent,
      failure: 'unverified_by_trace(distribution_shift_incompatible): stats mismatch',
      timestamp,
    };
  }
  if (input.requireShiftDetection && input.result.status === 'unknown') {
    return {
      intent: input.intent,
      failure: 'unverified_by_trace(distribution_shift_unverified): missing stats',
      timestamp,
    };
  }
  return null;
}

type AggregatedScore = {
  id: string;
  weightedScore: number;
  totalWeight: number;
  successes: number;
  failures: number;
};

function accumulateScores(
  aggregate: Map<string, AggregatedScore>,
  entries: Record<string, LearningScoreEntry>,
  weight: number
): void {
  if (weight <= 0) return;
  for (const [id, entry] of Object.entries(entries)) {
    const current = aggregate.get(id) ?? {
      id,
      weightedScore: 0,
      totalWeight: 0,
      successes: 0,
      failures: 0,
    };
    const scoreFactor = outcomeWeightedScoreFactor(entry);
    current.weightedScore += weight * scoreFactor;
    current.totalWeight += weight;
    current.successes += entry.successes;
    current.failures += entry.failures;
    aggregate.set(id, current);
  }
}

function outcomeWeightedScoreFactor(entry: LearningScoreEntry): number {
  if (isAntiPattern(entry)) return -0.5;
  const successRate = scoreEntry(entry);
  const outcomeWeight = successRate - 0.5;
  const surprise = entry.lastOutcomeWasUnexpected ? DEFAULT_SURPRISE_MULTIPLIER : 1;
  const tierBoost = tierMultiplier(entry.tier);
  return successRate * (1 + outcomeWeight) * surprise * tierBoost;
}

function isAntiPattern(entry: LearningScoreEntry): boolean {
  const total = entry.successes + entry.failures;
  if (total < DEFAULT_ANTI_PATTERN_MIN_SAMPLES) return false;
  return scoreEntry(entry) < DEFAULT_ANTI_PATTERN_MAX_SUCCESS_RATE;
}

function ensureTier(entry: LearningScoreEntry, now: string): PatternTier {
  if (entry.tier) return entry.tier;
  entry.tier = 'working';
  entry.promotedAt = now;
  return entry.tier;
}

function promoteTier(args: {
  tier: PatternTier;
  samples: number;
  predictiveValue: number;
  successRate: number;
  settings: ConsolidationSettings;
}): PatternTier {
  const { tier, samples, predictiveValue, successRate, settings } = args;
  if (tier === 'working') return 'recent';
  if (tier === 'recent') {
    if (samples >= settings.minSampleCount && predictiveValue >= settings.minPredictiveValue) {
      return 'learned';
    }
    return tier;
  }
  if (tier === 'learned') {
    if (samples >= settings.invariantMinSamples && successRate >= settings.invariantMinSuccessRate) {
      return 'invariant';
    }
    return tier;
  }
  return tier;
}

function tierMultiplier(tier: PatternTier | undefined): number {
  switch (tier) {
    case 'working':
      return WORKING_TIER_MULTIPLIER;
    case 'recent':
      return RECENT_TIER_MULTIPLIER;
    case 'invariant':
      return INVARIANT_TIER_MULTIPLIER;
    case 'learned':
    default:
      return LEARNED_TIER_MULTIPLIER;
  }
}

function collectAntiPatternWarnings(input: {
  warnings: HistoricalWarning[];
  seen: Set<string>;
  intent: string;
  similarity: number;
  entries: Record<string, LearningScoreEntry>;
  targetType: ModelUpdate['targetType'];
  timestamp: string;
}): void {
  if (input.similarity < DEFAULT_ANTI_PATTERN_SIMILARITY) return;
  for (const [id, entry] of Object.entries(input.entries)) {
    if (!isAntiPattern(entry)) continue;
    const key = `${input.targetType}:${id}`;
    if (input.seen.has(key)) continue;
    input.seen.add(key);
    const warning: HistoricalWarning = {
      intent: input.intent,
      failure: ANTI_PATTERN_WARNING,
      suggestion: 'Avoid repeating this approach without new evidence',
      timestamp: input.timestamp,
    };
    if (input.targetType === 'composition') {
      warning.compositionId = id;
    } else if (input.targetType === 'primitive') {
      warning.primitiveId = id;
    } else {
      warning.contextSourceId = id;
    }
    input.warnings.push(warning);
  }
}

function rankAggregates(aggregate: Map<string, AggregatedScore>): Array<{
  id: string;
  score: number;
  successRate: number;
  examples: number;
}> {
  const results = Array.from(aggregate.values()).map((entry) => {
    const examples = entry.successes + entry.failures;
    const score = entry.totalWeight > 0 ? entry.weightedScore / entry.totalWeight : 0;
    const successRate = examples > 0 ? entry.successes / examples : 0;
    return { id: entry.id, score, successRate, examples };
  });
  return results.sort((a, b) => b.score - a.score);
}

function sumSamples(entries: Record<string, LearningScoreEntry>): number {
  return Object.values(entries).reduce((sum, entry) => sum + entry.successes + entry.failures, 0);
}

function recencyWeight(updatedAt: string, nowMs: number): number {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return 1;
  const days = Math.max(0, nowMs - updatedMs) / (1000 * 60 * 60 * 24);
  return 1 / (1 + (days / 30));
}

function jaccard(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function normalizeIntent(intent: string): string {
  return intent.trim().toLowerCase();
}

function tokenizeIntent(intent: string): string[] {
  return intent
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function resolveIntent(episode: Episode, outcome: LearningOutcome): string {
  if (typeof outcome.intent === 'string' && outcome.intent.trim()) {
    return outcome.intent.trim();
  }
  const state = episode.context?.state as Record<string, unknown> | undefined;
  if (state && typeof state.intent === 'string' && state.intent.trim()) {
    return state.intent.trim();
  }
  const metaIntent = episode.metadata && typeof episode.metadata.intent === 'string'
    ? episode.metadata.intent
    : '';
  if (metaIntent && metaIntent.trim()) {
    return metaIntent.trim();
  }
  return '';
}

function ensureIntentRecord(
  state: LearningLoopState,
  key: string,
  intent: string,
  now: string
): LearningIntentRecord {
  const existing = state.intents[key];
  if (existing) return existing;
  const record: LearningIntentRecord = {
    intent,
    tokens: tokenizeIntent(intent),
    updatedAt: now,
    compositions: {},
    primitives: {},
    contextSources: {},
    warnings: [],
  };
  state.intents[key] = record;
  return record;
}

function pruneIntentRecords(state: LearningLoopState, maxIntents: number): void {
  const entries = Object.entries(state.intents);
  if (entries.length <= maxIntents) return;
  entries.sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
  const removeCount = entries.length - maxIntents;
  for (let i = 0; i < removeCount; i += 1) {
    delete state.intents[entries[i][0]];
  }
}

async function loadLearningState(storage: MetadataStorage): Promise<LearningLoopState> {
  const raw = await storage.getState(LEARNING_STATE_KEY);
  if (!raw) return { ...EMPTY_STATE };
  const parsed = safeJsonParse<unknown>(raw);
  if (!parsed.ok) return { ...EMPTY_STATE };
  return coerceLearningState(parsed.value);
}

async function persistLearningState(storage: MetadataStorage, state: LearningLoopState): Promise<void> {
  await storage.setState(LEARNING_STATE_KEY, JSON.stringify(state));
}

function resolveMetadataStorage(storage: LearningStorage): MetadataStorage {
  if (
    'metadata' in storage &&
    storage.metadata &&
    typeof storage.metadata.getState === 'function' &&
    typeof storage.metadata.setState === 'function'
  ) {
    return storage.metadata;
  }
  return storage as MetadataStorage;
}

function coerceLearningState(value: unknown): LearningLoopState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE };
  const record = value as Record<string, unknown>;
  const intentsRaw = record.intents && typeof record.intents === 'object'
    ? record.intents as Record<string, unknown>
    : {};
  const intents: Record<string, LearningIntentRecord> = {};
  for (const [key, entry] of Object.entries(intentsRaw)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    intents[key] = {
      intent: typeof item.intent === 'string' ? item.intent : key,
      tokens: Array.isArray(item.tokens) ? item.tokens.filter((token): token is string => typeof token === 'string') : [],
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      compositions: coerceScoreMap(item.compositions),
      primitives: coerceScoreMap(item.primitives),
      contextSources: coerceScoreMap(item.contextSources),
      warnings: coerceWarnings(item.warnings),
    };
  }
  const globalRecord = record.global && typeof record.global === 'object'
    ? record.global as Record<string, unknown>
    : {};
  const global: LearningAggregate = {
    compositions: coerceScoreMap(globalRecord.compositions),
    primitives: coerceScoreMap(globalRecord.primitives),
    contextSources: coerceScoreMap(globalRecord.contextSources),
    updatedAt: typeof globalRecord.updatedAt === 'string' ? globalRecord.updatedAt : undefined,
    warnings: coerceWarnings(globalRecord.warnings),
    codebaseStats: coerceCodebaseStats(globalRecord.codebaseStats),
  };
  return {
    schema_version: 1,
    intents,
    global,
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : undefined,
  };
}

function coerceScoreMap(value: unknown): Record<string, LearningScoreEntry> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const result: Record<string, LearningScoreEntry> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const successes = typeof item.successes === 'number' && Number.isFinite(item.successes)
      ? Math.max(0, Math.floor(item.successes))
      : 0;
    const failures = typeof item.failures === 'number' && Number.isFinite(item.failures)
      ? Math.max(0, Math.floor(item.failures))
      : 0;
    result[key] = {
      successes,
      failures,
      lastUpdatedAt: typeof item.lastUpdatedAt === 'string' ? item.lastUpdatedAt : new Date().toISOString(),
      lastOutcomeWasUnexpected: typeof item.lastOutcomeWasUnexpected === 'boolean'
        ? item.lastOutcomeWasUnexpected
        : undefined,
      tier: coerceTier(item.tier),
      promotedAt: typeof item.promotedAt === 'string' ? item.promotedAt : undefined,
    };
  }
  return result;
}

function normalizeCodebaseStats(stats: CodebaseStats | undefined, now: string): CodebaseStats | null {
  if (!stats || typeof stats !== 'object') return null;
  const mean = coerceNumberArray(stats.embeddingMean);
  const variance = coerceNumberArray(stats.embeddingVariance);
  if (!mean.length || mean.length !== variance.length) return null;
  const sampleCount = Number.isFinite(stats.sampleCount)
    ? Math.max(0, Math.floor(stats.sampleCount))
    : 0;
  if (sampleCount <= 0) return null;
  return {
    embeddingMean: mean,
    embeddingVariance: variance,
    sampleCount,
    collectedAt: typeof stats.collectedAt === 'string' ? stats.collectedAt : now,
  };
}

function coerceCodebaseStats(value: unknown): CodebaseStats | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const mean = coerceNumberArray(record.embeddingMean);
  const variance = coerceNumberArray(record.embeddingVariance);
  if (!mean.length || mean.length !== variance.length) return undefined;
  const sampleCount = typeof record.sampleCount === 'number' && Number.isFinite(record.sampleCount)
    ? Math.max(0, Math.floor(record.sampleCount))
    : 0;
  if (sampleCount <= 0) return undefined;
  return {
    embeddingMean: mean,
    embeddingVariance: variance,
    sampleCount,
    collectedAt: typeof record.collectedAt === 'string' ? record.collectedAt : new Date().toISOString(),
  };
}

function coerceNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null))
    .filter((item): item is number => item !== null);
}

function coerceTier(value: unknown): PatternTier | undefined {
  switch (value) {
    case 'working':
    case 'recent':
    case 'learned':
    case 'invariant':
      return value;
    default:
      return undefined;
  }
}

function coerceWarnings(value: unknown): HistoricalWarning[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HistoricalWarning => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      intent: typeof item.intent === 'string' ? item.intent : 'unknown',
      failure: typeof item.failure === 'string' ? item.failure : 'unknown',
      suggestion: typeof item.suggestion === 'string' ? item.suggestion : undefined,
      compositionId: typeof item.compositionId === 'string' ? item.compositionId : undefined,
      primitiveId: typeof item.primitiveId === 'string' ? item.primitiveId : undefined,
      contextSourceId: typeof item.contextSourceId === 'string' ? item.contextSourceId : undefined,
      timestamp: typeof item.timestamp === 'string' ? item.timestamp : new Date().toISOString(),
    }));
}

export const __testing = {
  LEARNING_STATE_KEY,
  loadLearningState,
  coerceLearningState,
};
