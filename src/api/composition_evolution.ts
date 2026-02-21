import crypto from 'node:crypto';
import type { LiBrainianStorage } from '../storage/types.js';
import type { TechniqueOperator } from '../strategic/techniques.js';
import { listTechniqueCompositionSummaries } from '../state/technique_compositions.js';
import { listTechniquePrimitiveIds } from '../state/technique_primitives.js';
import { listExecutionTraces, type ExecutionTrace } from '../state/execution_traces.js';

export interface DiscoveredPattern {
  primitiveSequence: string[];
  frequency: number;
  successRate: number;
  avgDurationMs: number;
  commonIntents: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface CompositionProposal {
  id: string;
  name: string;
  description: string;
  primitiveIds: string[];
  operators: TechniqueOperator[];
  basedOn: 'discovered_pattern' | 'mutation' | 'merge';
  evidence: {
    patternFrequency?: number;
    patternSuccessRate?: number;
    parentCompositions?: string[];
  };
  confidence: number;
}

export interface CompositionMutation {
  compositionId: string;
  mutationType: 'add_primitive' | 'remove_primitive' | 'reorder' | 'add_operator';
  description: string;
  expectedImprovement: string;
  evidence: string;
}

export interface EvolutionReport {
  discoveredPatterns: DiscoveredPattern[];
  proposedCompositions: CompositionProposal[];
  suggestedMutations: CompositionMutation[];
  deprecationCandidates: string[];
  timestamp: string;
  errors?: EvolutionError[];
}

export interface EvolutionError {
  stage: 'traces' | 'proposals' | 'mutations' | 'deprecations';
  message: string;
}

export interface CompositionEvolutionOptions {
  minPatternFrequency?: number;
  minSuccessRate?: number;
  minPatternLength?: number;
  maxPatternLength?: number;
  maxProposals?: number;
  maxIntentsPerPattern?: number;
  minMutationSamples?: number;
  maxMutationSuccessRate?: number;
  failurePredecessorWindow?: number;
  minDeprecationSamples?: number;
  maxDeprecationSuccessRate?: number;
  deprecationWindowDays?: number;
  traceLimit?: number;
}

const DEFAULT_MIN_PATTERN_FREQUENCY = 5;
const DEFAULT_MIN_SUCCESS_RATE = 0.7;
const DEFAULT_MIN_PATTERN_LENGTH = 2;
const DEFAULT_MAX_PATTERN_LENGTH = 6;
const DEFAULT_MAX_PROPOSALS = 10;
const DEFAULT_MAX_INTENTS = 5;
const DEFAULT_MIN_MUTATION_SAMPLES = 10;
const DEFAULT_MAX_MUTATION_SUCCESS = 0.8;
const DEFAULT_FAILURE_WINDOW = 3;
const DEFAULT_MIN_DEPRECATION_SAMPLES = 20;
const DEFAULT_MAX_DEPRECATION_SUCCESS = 0.3;
const DEFAULT_DEPRECATION_DAYS = 30;
const MAX_DEPRECATION_DAYS = 3650;
const MAX_INTENT_LENGTH = 200;
const INTENT_SAFE_PATTERN = /[^a-zA-Z0-9 _.,:;()'"\\\[\]\/!?-]/g;
const WHITESPACE_PATTERN = /\s+/g;

export class CompositionEvolutionEngine {
  private storage: LiBrainianStorage;
  private options: Required<CompositionEvolutionOptions>;

  constructor(storage: LiBrainianStorage, options: CompositionEvolutionOptions = {}) {
    this.storage = storage;
    this.options = {
      minPatternFrequency: clampNumber(options.minPatternFrequency, DEFAULT_MIN_PATTERN_FREQUENCY, 1),
      minSuccessRate: clampNumber(options.minSuccessRate, DEFAULT_MIN_SUCCESS_RATE, 0, 1),
      minPatternLength: clampNumber(options.minPatternLength, DEFAULT_MIN_PATTERN_LENGTH, 1),
      maxPatternLength: clampNumber(options.maxPatternLength, DEFAULT_MAX_PATTERN_LENGTH, 1),
      maxProposals: clampNumber(options.maxProposals, DEFAULT_MAX_PROPOSALS, 0),
      maxIntentsPerPattern: clampNumber(options.maxIntentsPerPattern, DEFAULT_MAX_INTENTS, 1),
      minMutationSamples: clampNumber(options.minMutationSamples, DEFAULT_MIN_MUTATION_SAMPLES, 1),
      maxMutationSuccessRate: clampNumber(options.maxMutationSuccessRate, DEFAULT_MAX_MUTATION_SUCCESS, 0, 1),
      failurePredecessorWindow: clampNumber(options.failurePredecessorWindow, DEFAULT_FAILURE_WINDOW, 1),
      minDeprecationSamples: clampNumber(options.minDeprecationSamples, DEFAULT_MIN_DEPRECATION_SAMPLES, 1),
      maxDeprecationSuccessRate: clampNumber(options.maxDeprecationSuccessRate, DEFAULT_MAX_DEPRECATION_SUCCESS, 0, 1),
      deprecationWindowDays: clampNumber(options.deprecationWindowDays, DEFAULT_DEPRECATION_DAYS, 1, MAX_DEPRECATION_DAYS),
      traceLimit: clampNumber(options.traceLimit, Number.POSITIVE_INFINITY, 0),
    };
    if (this.options.maxPatternLength < this.options.minPatternLength) {
      this.options.maxPatternLength = this.options.minPatternLength;
    }
  }

  async evolve(): Promise<EvolutionReport> {
    const errors: EvolutionError[] = [];
    let traces: ExecutionTrace[] = [];
    try {
      traces = await listExecutionTraces(this.storage, {
        limit: Number.isFinite(this.options.traceLimit) ? this.options.traceLimit : undefined,
      });
    } catch (error) {
      errors.push({ stage: 'traces', message: formatError(error) });
    }
    const patterns = traces.length > 0 ? this.minePatterns(traces) : [];
    let proposals: CompositionProposal[] = [];
    try {
      proposals = patterns.length > 0 ? await this.proposeFromPatterns(patterns) : [];
    } catch (error) {
      errors.push({ stage: 'proposals', message: formatError(error) });
    }
    let mutations: CompositionMutation[] = [];
    try {
      mutations = traces.length > 0 ? await this.suggestMutations(traces) : [];
    } catch (error) {
      errors.push({ stage: 'mutations', message: formatError(error) });
    }
    let deprecations: string[] = [];
    try {
      deprecations = traces.length > 0 ? await this.identifyDeprecations(traces) : [];
    } catch (error) {
      errors.push({ stage: 'deprecations', message: formatError(error) });
    }
    return {
      discoveredPatterns: patterns,
      proposedCompositions: proposals,
      suggestedMutations: mutations,
      deprecationCandidates: deprecations,
      timestamp: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private minePatterns(traces: ExecutionTrace[]): DiscoveredPattern[] {
    const counts = new Map<string, {
      count: number;
      successes: number;
      durationTotal: number;
      intents: Map<string, number>;
      firstSeen: string;
      lastSeen: string;
    }>();

    for (const trace of traces) {
      if (!Array.isArray(trace.primitiveSequence)) continue;
      const sequence = trace.primitiveSequence;
      if (!sequence.every((id) => typeof id === 'string' && id.length > 0)) continue;
      if (sequence.length < this.options.minPatternLength) continue;
      for (let len = this.options.minPatternLength; len <= Math.min(this.options.maxPatternLength, sequence.length); len++) {
        for (let start = 0; start <= sequence.length - len; start++) {
          const subseq = sequence.slice(start, start + len);
          const key = subseq.join('->');
          const existing = counts.get(key) ?? {
            count: 0,
            successes: 0,
            durationTotal: 0,
            intents: new Map<string, number>(),
            firstSeen: trace.timestamp,
            lastSeen: trace.timestamp,
          };
          existing.count += 1;
          if (trace.outcome === 'success') existing.successes += 1;
          existing.durationTotal += Math.max(0, trace.durationMs);
          const intent = normalizeIntent(trace.intent);
          if (intent) {
            existing.intents.set(intent, (existing.intents.get(intent) ?? 0) + 1);
          }
          if (trace.timestamp < existing.firstSeen) existing.firstSeen = trace.timestamp;
          if (trace.timestamp > existing.lastSeen) existing.lastSeen = trace.timestamp;
          counts.set(key, existing);
        }
      }
    }

    const patterns: DiscoveredPattern[] = [];
    for (const [key, data] of counts) {
      if (data.count < this.options.minPatternFrequency) continue;
      const successRate = data.successes / data.count;
      if (successRate < this.options.minSuccessRate) continue;
      patterns.push({
        primitiveSequence: key.split('->'),
        frequency: data.count,
        successRate,
        avgDurationMs: data.durationTotal / data.count,
        commonIntents: topIntents(data.intents, this.options.maxIntentsPerPattern),
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
      });
    }

    return patterns.sort((a, b) => (b.frequency * b.successRate) - (a.frequency * a.successRate));
  }

  private async proposeFromPatterns(patterns: DiscoveredPattern[]): Promise<CompositionProposal[]> {
    if (patterns.length === 0 || this.options.maxProposals === 0) {
      return [];
    }
    let summaries: { id: string; primitiveIds: string[] }[] = [];
    let primitiveIds: string[] = [];
    try {
      [summaries, primitiveIds] = await Promise.all([
        listTechniqueCompositionSummaries(this.storage),
        listTechniquePrimitiveIds(this.storage),
      ]);
    } catch (error) {
      throw new Error(`Failed to load composition metadata: ${formatError(error)}`);
    }
    const sequences = new Set(summaries.map((composition) => composition.primitiveIds.join('->')));
    const usedIds = new Set(summaries.map((composition) => composition.id));
    const primitiveIdSet = new Set(primitiveIds);
    const proposals: CompositionProposal[] = [];
    for (const pattern of patterns.slice(0, this.options.maxProposals)) {
      if (pattern.primitiveSequence.length === 0) continue;
      const sequenceKey = pattern.primitiveSequence.join('->');
      if (sequences.has(sequenceKey)) continue;
      if (!pattern.primitiveSequence.every((id) => primitiveIdSet.has(id))) continue;
      const baseId = `tc_evolved_${hashSequence(pattern.primitiveSequence)}`;
      const proposalId = uniqueProposalId(baseId, pattern.primitiveSequence, usedIds);
      usedIds.add(proposalId);
      proposals.push({
        id: proposalId,
        name: this.generateCompositionName(pattern),
        description: `Discovered pattern with ${(pattern.successRate * 100).toFixed(0)}% success rate ` +
          `across ${pattern.frequency} executions.`,
        primitiveIds: pattern.primitiveSequence,
        operators: this.inferOperators(pattern),
        basedOn: 'discovered_pattern',
        evidence: {
          patternFrequency: pattern.frequency,
          patternSuccessRate: pattern.successRate,
        },
        confidence: pattern.successRate * Math.min(1, pattern.frequency / 20),
      });
    }
    return proposals;
  }

  private async suggestMutations(traces: ExecutionTrace[]): Promise<CompositionMutation[]> {
    const byComposition = new Map<string, ExecutionTrace[]>();
    for (const trace of traces) {
      if (!trace.compositionId) continue;
      const existing = byComposition.get(trace.compositionId) ?? [];
      existing.push(trace);
      byComposition.set(trace.compositionId, existing);
    }

    const mutations: CompositionMutation[] = [];
    for (const [compositionId, compositionTraces] of byComposition) {
      if (compositionTraces.length < this.options.minMutationSamples) continue;
      const successes = compositionTraces.filter((trace) => trace.outcome === 'success').length;
      const successRate = successes / compositionTraces.length;
      if (successRate > this.options.maxMutationSuccessRate) continue;

      const failureTraces = compositionTraces.filter((trace) => trace.outcome === 'failure');
      const failurePredecessors = this.findFailurePredecessors(failureTraces);
      for (const [primitiveId, failureRate] of failurePredecessors) {
        if (failureRate <= 0.6) continue;
        mutations.push({
          compositionId,
          mutationType: 'add_primitive',
          description: `Add verification after ${primitiveId}`,
          expectedImprovement: `Reduce failures caused by ${primitiveId}`,
          evidence: `${primitiveId} precedes ${(failureRate * 100).toFixed(0)}% of failures`,
        });
      }
    }

    return mutations;
  }

  private async identifyDeprecations(traces: ExecutionTrace[]): Promise<string[]> {
    const byComposition = new Map<string, { successes: number; failures: number; lastUsed: string }>();
    for (const trace of traces) {
      if (!trace.compositionId) continue;
      const existing = byComposition.get(trace.compositionId) ?? {
        successes: 0,
        failures: 0,
        lastUsed: trace.timestamp,
      };
      if (trace.outcome === 'success') existing.successes += 1;
      else existing.failures += 1;
      if (trace.timestamp > existing.lastUsed) existing.lastUsed = trace.timestamp;
      byComposition.set(trace.compositionId, existing);
    }

    const deprecations: string[] = [];
    const cutoff = new Date(Date.now() - this.options.deprecationWindowDays * 24 * 60 * 60 * 1000).toISOString();
    for (const [compositionId, data] of byComposition) {
      const total = data.successes + data.failures;
      if (total < this.options.minDeprecationSamples) continue;
      const successRate = data.successes / total;
      if (successRate < this.options.maxDeprecationSuccessRate && data.lastUsed < cutoff) {
        deprecations.push(compositionId);
      }
    }
    return deprecations;
  }

  private generateCompositionName(pattern: DiscoveredPattern): string {
    if (pattern.commonIntents.length === 0) {
      return `Evolved ${pattern.primitiveSequence[0] ?? 'flow'}`;
    }
    const wordCounts = new Map<string, number>();
    for (const intent of pattern.commonIntents) {
      for (const word of intent.toLowerCase().split(/[^a-z0-9]+/)) {
        if (word.length < 3) continue;
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }
    const topWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([word]) => word);
    return topWords.length > 0 ? `Evolved ${topWords.join(' ')} pattern` : 'Evolved pattern';
  }

  private inferOperators(pattern: DiscoveredPattern): TechniqueOperator[] {
    if (
      pattern.primitiveSequence.includes('tp_hypothesis') &&
      pattern.primitiveSequence.includes('tp_verify_plan')
    ) {
      return [{
        id: `op_evolved_loop_${hashSequence(pattern.primitiveSequence)}`,
        type: 'loop',
        label: 'Iterate until verified',
        inputs: pattern.primitiveSequence.slice(0, -1),
        conditions: ['verification failed'],
      }];
    }
    return [];
  }

  private findFailurePredecessors(failureTraces: ExecutionTrace[]): Map<string, number> {
    const predecessorCounts = new Map<string, number>();
    const totalFailures = failureTraces.length;
    if (totalFailures === 0) return predecessorCounts;
    for (const trace of failureTraces) {
      if (!Array.isArray(trace.primitiveSequence)) continue;
      const lastPrimitives = trace.primitiveSequence
        .filter((id) => typeof id === 'string' && id.length > 0)
        .slice(-this.options.failurePredecessorWindow);
      for (const primitiveId of lastPrimitives) {
        predecessorCounts.set(primitiveId, (predecessorCounts.get(primitiveId) ?? 0) + 1);
      }
    }
    const failureRates = new Map<string, number>();
    for (const [primitiveId, count] of predecessorCounts) {
      failureRates.set(primitiveId, count / totalFailures);
    }
    return failureRates;
  }
}

function normalizeIntent(intent?: string): string {
  if (!intent) return '';
  return intent
    .replace(INTENT_SAFE_PATTERN, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\\+/g, '\\')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
    .slice(0, MAX_INTENT_LENGTH);
}

function topIntents(intents: Map<string, number>, limit: number): string[] {
  return Array.from(intents.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([intent]) => intent);
}

function uniqueProposalId(baseId: string, sequence: string[], usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;
  for (let attempt = 1; attempt <= 100; attempt++) {
    const candidate = `${baseId}_${hashSequenceStrong(sequence, String(attempt))}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  const overflowId = `${baseId}_${hashSequenceStrong(sequence, 'overflow')}`;
  if (usedIds.has(overflowId)) {
    throw new Error(`Failed to generate unique proposal id for ${baseId}`);
  }
  return overflowId;
}

function hashSequence(sequence: string[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(sequence)).digest('hex').slice(0, 8);
}

function hashSequenceStrong(sequence: string[], salt: string): string {
  return crypto.createHash('sha256').update(JSON.stringify([salt, sequence])).digest('hex').slice(0, 12);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function clampNumber(value: number | undefined, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
  const resolved = Number.isFinite(value) ? value as number : fallback;
  if (resolved < min) return min;
  if (resolved > max) return max;
  return resolved;
}
