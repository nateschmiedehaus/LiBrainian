/**
 * @fileoverview Code Clone Detection and Analysis
 *
 * Identifies duplicate and similar code for refactoring opportunities.
 * Uses embedding similarity and token-based comparison.
 *
 * Clone types (based on 2025-2026 research):
 * - Type-1 (exact): Identical code
 * - Type-2 (renamed): Syntactically identical, different identifiers
 * - Type-3 (modified): Similar with modifications
 * - Type-4 (semantic): Different syntax, same behavior
 *
 * Research basis:
 * - LLMs excel at same-language semantic clones
 * - Graph-based + neural embeddings = best for Type-4 clones
 * - Embedding similarity >0.85 indicates high clone probability
 */

import { createHash, randomUUID } from 'crypto';
import type { LiBrainianStorage, CloneEntry, CloneCluster, FunctionKnowledge, MultiVectorRecord } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CloneAnalysisOptions {
  storage: LiBrainianStorage;
  minSimilarity?: number;          // Minimum embedding similarity (default: 0.85)
  maxCandidates?: number;          // Max candidates per function (default: 100)
  includeSemanticClones?: boolean; // Detect Type-4 clones (default: true)
  batchSize?: number;              // Process functions in batches (default: 50)
}

export interface CloneAnalysisResult {
  functionsAnalyzed: number;
  clonesDetected: number;
  clusterCount: number;
  errors: string[];
  durationMs: number;
}

export interface ClonePair {
  entityId1: string;
  entityId2: string;
  similarity: number;
  cloneType: CloneEntry['cloneType'];
  confidence: number;
}

export interface TokenizedFunction {
  entityId: string;
  tokens: string[];
  normalizedTokens: string[];
}

// ============================================================================
// TOKENIZATION
// ============================================================================

/**
 * Keywords that are language-agnostic structural tokens.
 */
const STRUCTURAL_TOKENS = new Set([
  'function', 'class', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'const', 'let', 'var',
  'async', 'await', 'import', 'export', 'from', 'default', 'extends', 'implements',
  'interface', 'type', 'enum', 'public', 'private', 'protected', 'static',
  'abstract', 'override', 'readonly', 'this', 'super', 'null', 'undefined',
  'true', 'false', 'typeof', 'instanceof', 'in', 'of',
]);

/**
 * Tokenize a code string.
 */
export function tokenize(code: string): string[] {
  // Remove comments
  const noComments = code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
    .replace(/\/\/.*$/gm, '');        // Line comments

  // Split into tokens
  const tokens = noComments
    .split(/[\s\n\r\t]+/)
    .filter(t => t.length > 0)
    .flatMap(t => {
      // Split on punctuation but keep operators together
      return t.split(/([{}()\[\];,.:?!<>=+\-*/%&|^~@#])/g).filter(s => s.length > 0);
    });

  return tokens;
}

/**
 * Normalize tokens by replacing identifiers with placeholders.
 * This enables Type-2 clone detection.
 */
export function normalizeTokens(tokens: string[]): string[] {
  const identifierMap = new Map<string, string>();
  let identifierCounter = 0;

  return tokens.map(token => {
    // Keep structural tokens as-is
    if (STRUCTURAL_TOKENS.has(token)) {
      return token;
    }

    // Keep string literals as-is (with normalization)
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      return 'STRING_LITERAL';
    }

    // Keep number literals as-is
    if (/^\d+(\.\d+)?$/.test(token)) {
      return 'NUMBER_LITERAL';
    }

    // Normalize identifiers
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token)) {
      if (!identifierMap.has(token)) {
        identifierMap.set(token, `IDENT_${identifierCounter++}`);
      }
      return identifierMap.get(token)!;
    }

    return token;
  });
}

/**
 * Calculate Jaccard similarity between two token arrays.
 */
export function jaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Calculate longest common subsequence ratio.
 */
export function lcsRatio(tokens1: string[], tokens2: string[]): number {
  const m = tokens1.length;
  const n = tokens2.length;

  if (m === 0 || n === 0) return 0;

  // Use space-optimized LCS
  const dp = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (tokens1[i - 1] === tokens2[j - 1]) {
        dp[j] = prev + 1;
      } else {
        dp[j] = Math.max(dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }

  const lcsLength = dp[n];
  return (2 * lcsLength) / (m + n);
}

// ============================================================================
// CLONE TYPE CLASSIFICATION
// ============================================================================

/**
 * Classify the type of clone based on similarity metrics.
 */
export function classifyCloneType(
  originalTokens1: string[],
  originalTokens2: string[],
  normalizedTokens1: string[],
  normalizedTokens2: string[],
  embeddingSimilarity: number
): CloneEntry['cloneType'] {
  // Exact match on original tokens = Type-1
  const originalSimilarity = jaccardSimilarity(originalTokens1, originalTokens2);
  if (originalSimilarity > 0.95) {
    return 'exact';
  }

  // Match on normalized tokens = Type-2 (renamed identifiers)
  const normalizedSimilarity = jaccardSimilarity(normalizedTokens1, normalizedTokens2);
  if (normalizedSimilarity > 0.9 && originalSimilarity < 0.9) {
    return 'type2';
  }

  // High normalized similarity with structural changes = Type-3
  if (normalizedSimilarity > 0.7) {
    return 'type3';
  }

  // High embedding similarity but low token similarity = Type-4 (semantic)
  if (embeddingSimilarity > 0.85 && normalizedSimilarity < 0.7) {
    return 'semantic';
  }

  // Default to type1 for whitespace/comment differences
  return 'type1';
}

/**
 * Estimate refactoring potential based on clone characteristics.
 */
export function estimateRefactoringPotential(
  cloneType: CloneEntry['cloneType'],
  similarity: number,
  sharedLines: number
): number {
  let potential = 0.5; // Base potential

  // Higher similarity = easier refactoring
  potential += (similarity - 0.5) * 0.3;

  // More shared lines = more benefit
  if (sharedLines > 50) potential += 0.2;
  else if (sharedLines > 20) potential += 0.1;

  // Clone type affects difficulty
  switch (cloneType) {
    case 'exact':
    case 'type1':
      potential += 0.2; // Easy to extract
      break;
    case 'type2':
      potential += 0.1; // Need parameterization
      break;
    case 'type3':
      potential -= 0.1; // Structural changes needed
      break;
    case 'semantic':
      potential -= 0.2; // Complex refactoring
      break;
  }

  return Math.max(0, Math.min(1, potential));
}

// ============================================================================
// EMBEDDING-BASED CLONE DETECTION
// ============================================================================

/**
 * Calculate cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Find candidate clones using embedding similarity.
 */
export async function findCloneCandidates(
  storage: LiBrainianStorage,
  vectors: MultiVectorRecord[],
  minSimilarity: number,
  maxCandidates: number
): Promise<ClonePair[]> {
  const candidates: ClonePair[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < vectors.length; i++) {
    const vec1 = vectors[i];
    const emb1 = vec1.payload.semantic;
    if (!emb1) continue;

    for (let j = i + 1; j < vectors.length; j++) {
      const vec2 = vectors[j];
      const emb2 = vec2.payload.semantic;
      if (!emb2) continue;

      // Skip if already processed this pair
      const pairKey = [vec1.entityId, vec2.entityId].sort().join(':');
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);

      const similarity = cosineSimilarity(emb1, emb2);
      if (similarity >= minSimilarity) {
        candidates.push({
          entityId1: vec1.entityId,
          entityId2: vec2.entityId,
          similarity,
          cloneType: 'semantic', // Will be refined later
          confidence: similarity,
        });
      }

      if (candidates.length >= maxCandidates) break;
    }
    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

// ============================================================================
// CLONE ANALYSIS
// ============================================================================

/**
 * Analyze code clones in the codebase.
 */
export async function analyzeClones(options: CloneAnalysisOptions): Promise<CloneAnalysisResult> {
  const startTime = Date.now();
  const {
    storage,
    minSimilarity = 0.85,
    maxCandidates = 1000,
    includeSemanticClones = true,
    batchSize = 50,
  } = options;

  const result: CloneAnalysisResult = {
    functionsAnalyzed: 0,
    clonesDetected: 0,
    clusterCount: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    // Get all multi-vectors for functions
    const vectors = await storage.getMultiVectors({ entityType: 'function' });
    result.functionsAnalyzed = vectors.length;

    if (vectors.length < 2) {
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Find clone candidates using embedding similarity
    const candidates = await findCloneCandidates(storage, vectors, minSimilarity, maxCandidates);

    // Get function details for token-based analysis
    const functionCache = new Map<string, FunctionKnowledge>();

    // Process candidates to determine clone types
    const cloneEntries: CloneEntry[] = [];
    let cloneGroupId = 0;
    const entityToGroup = new Map<string, number>();

    for (const candidate of candidates) {
      try {
        // Get function details if not cached
        let fn1 = functionCache.get(candidate.entityId1);
        let fn2 = functionCache.get(candidate.entityId2);

        if (!fn1) {
          fn1 = await storage.getFunction(candidate.entityId1) ?? undefined;
          if (fn1) functionCache.set(candidate.entityId1, fn1);
        }
        if (!fn2) {
          fn2 = await storage.getFunction(candidate.entityId2) ?? undefined;
          if (fn2) functionCache.set(candidate.entityId2, fn2);
        }

        if (!fn1 || !fn2) continue;

        // Tokenize and normalize
        const tokens1 = tokenize(fn1.signature);
        const tokens2 = tokenize(fn2.signature);
        const normalizedTokens1 = normalizeTokens(tokens1);
        const normalizedTokens2 = normalizeTokens(tokens2);

        // Classify clone type
        const cloneType = classifyCloneType(
          tokens1, tokens2,
          normalizedTokens1, normalizedTokens2,
          candidate.similarity
        );

        // Skip non-semantic clones if not requested
        if (!includeSemanticClones && cloneType === 'semantic') {
          continue;
        }

        // Determine clone group
        const existingGroup1 = entityToGroup.get(candidate.entityId1);
        const existingGroup2 = entityToGroup.get(candidate.entityId2);

        let groupId: number;
        if (existingGroup1 !== undefined && existingGroup2 !== undefined) {
          groupId = Math.min(existingGroup1, existingGroup2);
        } else if (existingGroup1 !== undefined) {
          groupId = existingGroup1;
        } else if (existingGroup2 !== undefined) {
          groupId = existingGroup2;
        } else {
          groupId = cloneGroupId++;
        }

        entityToGroup.set(candidate.entityId1, groupId);
        entityToGroup.set(candidate.entityId2, groupId);

        // Estimate shared lines
        const sharedLines = Math.min(
          fn1.endLine - fn1.startLine + 1,
          fn2.endLine - fn2.startLine + 1
        );

        const refactoringPotential = estimateRefactoringPotential(
          cloneType, candidate.similarity, sharedLines
        );

        cloneEntries.push({
          cloneGroupId: groupId,
          entityId1: candidate.entityId1,
          entityId2: candidate.entityId2,
          entityType: 'function',
          similarity: candidate.similarity,
          cloneType,
          sharedLines,
          sharedTokens: Math.min(tokens1.length, tokens2.length),
          refactoringPotential,
          computedAt: new Date().toISOString(),
        });
      } catch (error) {
        result.errors.push(`Failed to analyze clone pair: ${error}`);
      }
    }

    // Store clone entries
    if (cloneEntries.length > 0) {
      await storage.deleteCloneEntries(); // Clear old data
      await storage.upsertCloneEntries(cloneEntries);
    }

    result.clonesDetected = cloneEntries.length;
    result.clusterCount = cloneGroupId;
  } catch (error) {
    result.errors.push(`Clone analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get all clones for a specific entity.
 */
export async function getClonesForEntity(
  storage: LiBrainianStorage,
  entityId: string
): Promise<CloneEntry[]> {
  return storage.getClonesByEntity(entityId);
}

/**
 * Get clone clusters with analysis.
 */
export async function getCloneClustersWithAnalysis(
  storage: LiBrainianStorage
): Promise<Array<CloneCluster & { entities: string[] }>> {
  const clusters = await storage.getCloneClusters();
  const entries = await storage.getCloneEntries({ limit: 10000 });

  // Group entries by cluster
  const clusterEntities = new Map<number, Set<string>>();
  for (const entry of entries) {
    const set = clusterEntities.get(entry.cloneGroupId) || new Set();
    set.add(entry.entityId1);
    set.add(entry.entityId2);
    clusterEntities.set(entry.cloneGroupId, set);
  }

  return clusters.map(cluster => ({
    ...cluster,
    entities: Array.from(clusterEntities.get(cluster.clusterId) || []),
  }));
}

/**
 * Get refactoring opportunities sorted by potential benefit.
 */
export async function getRefactoringOpportunities(
  storage: LiBrainianStorage,
  limit: number = 20
): Promise<CloneEntry[]> {
  return storage.getCloneEntries({
    minRefactoringPotential: 0.6,
    limit,
    orderBy: 'refactoring_potential',
    orderDirection: 'desc',
  });
}

/**
 * Get semantic clones (Type-4).
 */
export async function getSemanticClones(
  storage: LiBrainianStorage,
  limit: number = 50
): Promise<CloneEntry[]> {
  return storage.getCloneEntries({
    cloneType: 'semantic',
    limit,
    orderBy: 'similarity',
    orderDirection: 'desc',
  });
}

/**
 * Calculate duplication metrics for the codebase.
 */
export async function calculateDuplicationMetrics(
  storage: LiBrainianStorage
): Promise<{
  totalClones: number;
  totalDuplicatedLines: number;
  clonesByType: Record<CloneEntry['cloneType'], number>;
  avgSimilarity: number;
  avgRefactoringPotential: number;
}> {
  const entries = await storage.getCloneEntries({ limit: 10000 });

  const clonesByType: Record<CloneEntry['cloneType'], number> = {
    exact: 0,
    type1: 0,
    type2: 0,
    type3: 0,
    semantic: 0,
  };

  let totalDuplicatedLines = 0;
  let totalSimilarity = 0;
  let totalRefactoringPotential = 0;

  for (const entry of entries) {
    clonesByType[entry.cloneType]++;
    totalDuplicatedLines += entry.sharedLines || 0;
    totalSimilarity += entry.similarity;
    totalRefactoringPotential += entry.refactoringPotential;
  }

  return {
    totalClones: entries.length,
    totalDuplicatedLines,
    clonesByType,
    avgSimilarity: entries.length > 0 ? totalSimilarity / entries.length : 0,
    avgRefactoringPotential: entries.length > 0 ? totalRefactoringPotential / entries.length : 0,
  };
}
