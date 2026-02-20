import type { ContextPack, RetrievalStatus } from '../types.js';

export type QueryDepth = 'L0' | 'L1' | 'L2' | 'L3';
type EscalatableDepth = Exclude<QueryDepth, 'L0'>;

export interface RetrievalEscalationInput {
  depth: QueryDepth;
  totalConfidence: number;
  retrievalEntropy: number;
  escalationAttempts: number;
  maxEscalationDepth: number;
  packCount?: number;
}

export interface RetrievalEscalationDecision {
  shouldEscalate: boolean;
  nextDepth: QueryDepth;
  expandQuery: boolean;
  reasons: string[];
  retrievalStatus: RetrievalStatus;
}

const SUFFICIENT_CONFIDENCE = 0.6;
const PARTIAL_CONFIDENCE = 0.3;
const LOW_CONFIDENCE = 0.4;
const CRITICAL_CONFIDENCE = 0.2;
const HIGH_ENTROPY = 1.5;
const VERY_HIGH_ENTROPY = 2.0;
const EMPTY_RESULT_ENTROPY_BASE = 10;

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'along', 'already', 'also', 'because', 'before', 'being',
  'between', 'could', 'does', 'doing', 'from', 'have', 'into', 'just', 'like', 'maybe',
  'might', 'more', 'most', 'only', 'other', 'over', 'really', 'should', 'that', 'their',
  'there', 'these', 'they', 'this', 'those', 'under', 'users', 'using', 'what', 'when',
  'where', 'which', 'while', 'with', 'without', 'work',
]);

export function computeRetrievalEntropy(packs: Array<Pick<ContextPack, 'confidence'>>): number {
  if (packs.length === 0) return Number(Math.log2(EMPTY_RESULT_ENTROPY_BASE).toFixed(4));
  const weights = packs
    .map((pack) => Number.isFinite(pack.confidence) ? Math.max(0.0001, pack.confidence) : 0.0001);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return 0;

  let entropy = 0;
  for (const value of weights) {
    const p = value / total;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(4));
}

export function categorizeRetrievalStatus(input: {
  totalConfidence: number;
  packCount: number;
}): RetrievalStatus {
  if (input.packCount <= 0) return 'insufficient';
  if (input.totalConfidence >= SUFFICIENT_CONFIDENCE) return 'sufficient';
  if (input.totalConfidence >= PARTIAL_CONFIDENCE) return 'partial';
  return 'insufficient';
}

export function decideRetrievalEscalation(input: RetrievalEscalationInput): RetrievalEscalationDecision {
  const status = categorizeRetrievalStatus({
    totalConfidence: input.totalConfidence,
    packCount: input.packCount ?? 1,
  });

  if (input.depth === 'L0' || input.maxEscalationDepth <= 0 || input.escalationAttempts >= input.maxEscalationDepth) {
    return {
      shouldEscalate: false,
      nextDepth: input.depth,
      expandQuery: false,
      reasons: [],
      retrievalStatus: status,
    };
  }

  const currentDepth = input.depth as EscalatableDepth;
  let nextDepth: EscalatableDepth = currentDepth;
  let expandQuery = false;
  const reasons: string[] = [];

  if (input.totalConfidence < CRITICAL_CONFIDENCE) {
    nextDepth = 'L3';
    expandQuery = true;
    reasons.push('confidence_below_0_2');
  } else if (input.totalConfidence < LOW_CONFIDENCE && input.retrievalEntropy > HIGH_ENTROPY) {
    nextDepth = increaseDepth(currentDepth);
    reasons.push('confidence_below_0_4_and_entropy_above_1_5');
  }

  if (input.retrievalEntropy > VERY_HIGH_ENTROPY) {
    expandQuery = true;
    reasons.push('entropy_above_2_0');
    if (nextDepth === currentDepth && currentDepth !== 'L3') {
      nextDepth = increaseDepth(currentDepth);
    }
  }

  const shouldEscalate = nextDepth !== currentDepth || expandQuery;
  return {
    shouldEscalate,
    nextDepth,
    expandQuery,
    reasons,
    retrievalStatus: status,
  };
}

export function expandEscalationIntent(intent: string, packs: ContextPack[]): string {
  const base = intent.trim();
  if (!base) return intent;
  const existing = new Set(base.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  const tokens: string[] = [];

  for (const pack of packs.slice(0, 4)) {
    const raw = `${pack.summary} ${(pack.keyFacts ?? []).join(' ')}`.toLowerCase();
    for (const token of raw.split(/[^a-z0-9_]+/)) {
      if (token.length < 4) continue;
      if (STOP_WORDS.has(token)) continue;
      if (existing.has(token)) continue;
      if (tokens.includes(token)) continue;
      tokens.push(token);
      if (tokens.length >= 4) break;
    }
    if (tokens.length >= 4) break;
  }

  if (!tokens.length) return intent;
  return `${base} ${tokens.join(' ')}`.trim();
}

export function buildClarifyingQuestions(intent: string): string[] {
  const trimmed = intent.trim() || 'this issue';
  return [
    `Which file or module should be prioritized for: "${trimmed}"?`,
    `What exact failing behavior or error message are you seeing for "${trimmed}"?`,
    `What changed recently (commit, dependency, or config) before "${trimmed}" started?`,
  ];
}

function increaseDepth(depth: EscalatableDepth): EscalatableDepth {
  if (depth === 'L1') return 'L2';
  if (depth === 'L2') return 'L3';
  return depth;
}
