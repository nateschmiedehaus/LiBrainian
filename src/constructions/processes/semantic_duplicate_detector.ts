import type { FunctionId } from '../../core/function_range_mapper.js';
import type { FunctionKnowledge } from '../../types.js';
import type { GraphEdgeQueryOptions, LibrarianStorage } from '../../storage/types.js';
import { ConstructionError } from '../base/construction_base.js';
import { tokenizeForIntentBehavior } from '../intent_behavior_coherence.js';
import { ok, type Construction, type Context } from '../types.js';

export interface SemanticDuplicateDetectorInput {
  intendedDescription: string;
  targetModule?: string;
  anticipatedCallers?: FunctionId[];
  threshold?: number;
  maxResults?: number;
}

export interface DuplicateMatch {
  functionId: FunctionId;
  filePath: string;
  functionName: string;
  semanticDescription: string;
  similarityScore: number;
  hasCallGraphOverlap: boolean;
  recommendation: 'use_existing' | 'extend_existing' | 'probably_different' | 'review';
}

export interface SemanticDuplicateDetectorOutput {
  matches: DuplicateMatch[];
  hasDuplicates: boolean;
  topMatch: DuplicateMatch | null;
  agentSummary: string;
}

type StorageSlice = Pick<LibrarianStorage, 'getFunctions' | 'getGraphEdges'>;

interface ScoredCandidate {
  fn: FunctionKnowledge;
  semanticDescription: string;
  similarityScore: number;
  sameModule: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/gu, '/').trim();
}

function normalizeIdentifierLike(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
      .replace(/[_\-./:]+/gu, ' ')
      .toLowerCase(),
  );
}

function toTokenSet(value: string): Set<string> {
  return tokenizeForIntentBehavior(normalizeIdentifierLike(value));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  if (intersection === 0) return 0;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function overlapRatio(reference: Set<string>, candidate: Set<string>): number {
  if (reference.size === 0 || candidate.size === 0) return 0;
  let overlap = 0;
  for (const token of reference) {
    if (candidate.has(token)) overlap += 1;
  }
  return overlap / reference.size;
}

function computeCandidateSimilarity(
  intendedTokens: Set<string>,
  semanticDescription: string,
  fn: FunctionKnowledge,
  targetModule?: string,
): { score: number; sameModule: boolean } {
  const purposeTokens = toTokenSet(semanticDescription);
  const nameTokens = toTokenSet(fn.name);
  const signatureTokens = toTokenSet(fn.signature);
  const purposeCoverage = overlapRatio(intendedTokens, purposeTokens);
  const purposeJaccard = jaccardSimilarity(intendedTokens, purposeTokens);
  const purposeScore = (purposeCoverage * 0.8) + (purposeJaccard * 0.2);
  const nameScore = jaccardSimilarity(intendedTokens, nameTokens);
  const signatureScore = jaccardSimilarity(intendedTokens, signatureTokens);
  const blendedScore = (purposeScore * 0.7) + (nameScore * 0.2) + (signatureScore * 0.1);
  let score = Math.max(purposeScore, blendedScore);
  const sameModule = Boolean(
    targetModule &&
      normalizePathLike(fn.filePath).endsWith(normalizePathLike(targetModule)),
  );
  if (sameModule) {
    score -= 0.04;
  }
  return { score: clamp01(score), sameModule };
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
  const resolved = await Promise.resolve(librarian.getStorage());
  return toStorageSlice(resolved);
}

async function buildCallGraphOverlap(
  storage: StorageSlice,
  anticipatedCallers: FunctionId[],
  candidateIds: string[],
): Promise<Set<string>> {
  if (anticipatedCallers.length === 0 || candidateIds.length === 0) {
    return new Set<string>();
  }
  const query: GraphEdgeQueryOptions = {
    edgeTypes: ['calls'],
    fromIds: anticipatedCallers,
    toIds: candidateIds,
    limit: Math.max(100, anticipatedCallers.length * candidateIds.length),
  };
  const edges = await storage.getGraphEdges(query);
  const overlap = new Set<string>();
  for (const edge of edges) {
    if (edge.edgeType === 'calls' && edge.toType === 'function') {
      overlap.add(edge.toId);
    }
  }
  return overlap;
}

function chooseRecommendation(params: {
  similarityScore: number;
  thresholdUsed: number;
  hasCallGraphOverlap: boolean;
  sameModule: boolean;
}): DuplicateMatch['recommendation'] {
  if (params.similarityScore < params.thresholdUsed) {
    return 'probably_different';
  }
  if (params.sameModule) {
    return 'extend_existing';
  }
  return params.hasCallGraphOverlap ? 'use_existing' : 'use_existing';
}

function buildAgentSummary(matches: DuplicateMatch[], threshold: number): string {
  if (matches.length === 0) {
    return `No semantic duplicates detected above threshold ${threshold.toFixed(2)}. Proceed with implementation.`;
  }
  const top = matches[0]!;
  const overlapCount = matches.filter((match) => match.hasCallGraphOverlap).length;
  return [
    `${matches.length} semantically similar function(s) found above threshold ${threshold.toFixed(2)}.`,
    `Top match: ${top.functionName} in ${top.filePath} (similarity ${top.similarityScore.toFixed(2)}, recommendation: ${top.recommendation}).`,
    overlapCount > 0
      ? `${overlapCount} match(es) share anticipated caller overlap; prioritize reuse before generating new logic.`
      : 'No anticipated caller overlap detected.',
  ].join(' ');
}

export function createSemanticDuplicateDetectorConstruction(): Construction<
  SemanticDuplicateDetectorInput,
  SemanticDuplicateDetectorOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'semantic-duplicate-detector',
    name: 'Semantic Duplicate Detector',
    description: 'Detects semantically equivalent functions before generation so agents can reuse existing logic.',
    async execute(input: SemanticDuplicateDetectorInput, context?: Context<unknown>) {
      const intendedDescription = normalizeWhitespace(input.intendedDescription ?? '');
      if (!intendedDescription) {
        throw new ConstructionError(
          'intendedDescription is required and must be non-empty.',
          'semantic-duplicate-detector',
        );
      }

      const threshold = clamp01(input.threshold ?? 0.82);
      const maxResults = Math.max(1, Math.min(25, Math.trunc(input.maxResults ?? 10)));
      const intendedTokens = toTokenSet(intendedDescription);
      if (intendedTokens.size === 0) {
        return ok<SemanticDuplicateDetectorOutput, ConstructionError>({
          matches: [],
          hasDuplicates: false,
          topMatch: null,
          agentSummary: `No semantic duplicates detected above threshold ${threshold.toFixed(2)}. Proceed with implementation.`,
        });
      }

      const storage = await resolveStorage(context);
      if (!storage) {
        return ok<SemanticDuplicateDetectorOutput, ConstructionError>({
          matches: [],
          hasDuplicates: false,
          topMatch: null,
          agentSummary:
            'Semantic duplicate detection unavailable: runtime storage context is missing. Re-run through registry invocation with active librarian context.',
        });
      }

      const functions = await storage.getFunctions({ limit: 25_000 });
      const scored: ScoredCandidate[] = [];
      for (const fn of functions) {
        const semanticDescription = normalizeWhitespace(fn.purpose || `${fn.name} ${fn.signature}`);
        if (!semanticDescription) continue;
        const similarity = computeCandidateSimilarity(
          intendedTokens,
          semanticDescription,
          fn,
          input.targetModule,
        );
        if (similarity.score < Math.max(0.1, threshold - 0.35)) continue;
        scored.push({
          fn,
          semanticDescription,
          similarityScore: similarity.score,
          sameModule: similarity.sameModule,
        });
      }
      scored.sort((left, right) => right.similarityScore - left.similarityScore);

      const candidateIds = scored.map((entry) => entry.fn.id);
      const anticipatedCallers = input.anticipatedCallers ?? [];
      const overlapIds = await buildCallGraphOverlap(storage, anticipatedCallers, candidateIds);

      const matches: DuplicateMatch[] = [];
      for (const candidate of scored) {
        const hasCallGraphOverlap = overlapIds.has(candidate.fn.id);
        const thresholdUsed = hasCallGraphOverlap ? Math.min(threshold, 0.75) : threshold;
        if (candidate.similarityScore < thresholdUsed) continue;
        matches.push({
          functionId: candidate.fn.id,
          filePath: candidate.fn.filePath,
          functionName: candidate.fn.name,
          semanticDescription: candidate.semanticDescription,
          similarityScore: candidate.similarityScore,
          hasCallGraphOverlap,
          recommendation: chooseRecommendation({
            similarityScore: candidate.similarityScore,
            thresholdUsed,
            hasCallGraphOverlap,
            sameModule: candidate.sameModule,
          }),
        });
        if (matches.length >= maxResults) break;
      }

      const output: SemanticDuplicateDetectorOutput = {
        matches,
        hasDuplicates: matches.length > 0,
        topMatch: matches[0] ?? null,
        agentSummary: buildAgentSummary(matches, threshold),
      };
      return ok<SemanticDuplicateDetectorOutput, ConstructionError>(output);
    },
  };
}
