import type { FileReadLogEntry } from '../integration/read_interceptor.js';
import type { KnowledgeGap } from '../api/context_assembly.js';
import { emptyArray } from '../api/empty_values.js';

export interface TrajectoryLocation { line: number; column?: number; }
export type GuessViolation = { type: 'uncited_claim'; claim: string; location: TrajectoryLocation } | { type: 'read_without_query'; file: string; librainianHadKnowledge: boolean } | { type: 'ignored_gap'; gap: KnowledgeGap; proceeded: boolean } | { type: 'assumption_cascade'; chainLength: number; rootAssumption: string };
export interface GuessDetectionInput { outputText?: string; readLogs?: FileReadLogEntry[]; gaps?: KnowledgeGap[]; }
const CITATION_REGEX = /\[[^\]]+:\d+(?:-\d+)?\]/;

function detectUncitedClaims(outputText?: string): GuessViolation[] {
  if (!outputText) return emptyArray<GuessViolation>();
  if (CITATION_REGEX.test(outputText)) return emptyArray<GuessViolation>();
  if (outputText.trim().length < 200) return emptyArray<GuessViolation>();
  const snippet = outputText.trim().split(/\r?\n/)[0] ?? outputText.trim();
  return [{ type: 'uncited_claim', claim: snippet.slice(0, 160), location: { line: 1, column: 1 } }];
}

function detectReadWithoutQuery(readLogs: FileReadLogEntry[] = []): GuessViolation[] {
  const violations: GuessViolation[] = [];
  for (const entry of readLogs) {
    if (entry.decision.allowed) continue;
    const reason = 'reason' in entry.decision ? entry.decision.reason : undefined;
    violations.push({
      type: 'read_without_query',
      file: entry.request.filePath,
      librainianHadKnowledge: reason === 'must_query_librainian',
    });
  }
  return violations;
}

function detectIgnoredGaps(gaps: KnowledgeGap[] = [], outputText?: string): GuessViolation[] {
  if (!gaps.length || !outputText) return emptyArray<GuessViolation>();
  const lower = outputText.toLowerCase();
  const acknowledgesGap = lower.includes('gap') || lower.includes('unknown') || lower.includes('missing');
  if (acknowledgesGap) return emptyArray<GuessViolation>();
  return gaps.map((gap) => ({ type: 'ignored_gap', gap, proceeded: true }));
}

function detectAssumptionCascade(outputText?: string): GuessViolation[] {
  if (!outputText) return emptyArray<GuessViolation>();
  const matches = outputText.match(/\bassum(e|ing|ption)\b/gi) ?? [];
  if (matches.length < 3) return emptyArray<GuessViolation>();
  const snippet = outputText.trim().split(/\r?\n/)[0] ?? outputText.trim();
  return [{ type: 'assumption_cascade', chainLength: matches.length, rootAssumption: snippet.slice(0, 120) }];
}

export function detectGuessViolations(input: GuessDetectionInput): GuessViolation[] {
  return [
    ...detectUncitedClaims(input.outputText),
    ...detectReadWithoutQuery(input.readLogs),
    ...detectIgnoredGaps(input.gaps, input.outputText),
    ...detectAssumptionCascade(input.outputText),
  ];
}
