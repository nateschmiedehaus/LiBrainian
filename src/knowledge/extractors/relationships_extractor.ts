/**
 * @fileoverview Relationships Extractor with Cochange and Similarity
 *
 * Extracts temporal and semantic relationships:
 * - Cochange: Files that frequently change together (temporal coupling)
 * - Similarity: Semantically similar entities (embedding-based)
 *
 * These relationships are critical for:
 * - Impact analysis (what else might need to change?)
 * - Code understanding (what is this similar to?)
 * - Refactoring decisions (what is coupled and shouldn't be?)
 */

import type {
  Cochange,
  SimilarEntity,
  Reference,
} from '../universal_types.js';
import type { LiBrainianStorage, CochangeQueryOptions } from '../../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface RelationshipsExtraction {
  cochanges: Cochange[];
  similar: SimilarEntity[];
  confidence: number;
}

export interface RelationshipsInput {
  filePath: string;
  entityId: string;
  entityName: string;
  embedding?: Float32Array;
  storage?: LiBrainianStorage;
}

export interface SimilarityConfig {
  topK?: number;           // Number of similar entities to return
  minSimilarity?: number;  // Minimum cosine similarity threshold
}

// ============================================================================
// MAIN EXTRACTOR
// ============================================================================

/**
 * Extract cochange and similarity relationships for an entity.
 */
export async function extractRelationships(
  input: RelationshipsInput,
  config: SimilarityConfig = {}
): Promise<RelationshipsExtraction> {
  const { topK = 10, minSimilarity = 0.7 } = config;

  const cochanges: Cochange[] = [];
  const similar: SimilarEntity[] = [];

  // Extract cochange relationships from storage
  if (input.storage) {
    try {
      const cochangeEdges = await input.storage.getCochangeEdges({
        fileA: input.filePath,
        minStrength: 0.1,
        limit: 20,
      });

      for (const edge of cochangeEdges) {
        const otherFile = edge.fileA === input.filePath ? edge.fileB : edge.fileA;
        cochanges.push({
          id: `cochange:${otherFile}`,
          name: otherFile.split('/').pop() ?? otherFile,
          file: otherFile,
          line: 1,
          strength: edge.strength,
          commits: edge.changeCount,
        });
      }
    } catch {
      // Cochange data unavailable
    }

    // Extract similarity relationships from embeddings
    if (input.embedding && input.embedding.length > 0) {
      try {
        const similarEntities = await findSimilarByEmbedding(
          input.entityId,
          input.embedding,
          input.storage,
          topK,
          minSimilarity
        );
        similar.push(...similarEntities);
      } catch {
        // Similarity search unavailable
      }
    }
  }

  // Calculate confidence based on data availability
  const hasCochanges = cochanges.length > 0;
  const hasSimilar = similar.length > 0;
  const confidence = 0.3 + (hasCochanges ? 0.35 : 0) + (hasSimilar ? 0.35 : 0);

  return {
    cochanges,
    similar,
    confidence,
  };
}

// ============================================================================
// SIMILARITY COMPUTATION
// ============================================================================

/**
 * Find entities with similar embeddings using cosine similarity.
 */
async function findSimilarByEmbedding(
  entityId: string,
  embedding: Float32Array,
  storage: LiBrainianStorage,
  topK: number,
  minSimilarity: number
): Promise<SimilarEntity[]> {
  const similar: SimilarEntity[] = [];

  // Get all knowledge records with embeddings
  // In a production system, this would use a vector index
  const allKnowledge = await storage.queryUniversalKnowledge({
    limit: 1000, // Limit for performance
  });

  const similarities: Array<{
    entity: typeof allKnowledge[0];
    similarity: number;
  }> = [];

  for (const knowledge of allKnowledge) {
    if (knowledge.id === entityId) continue;
    if (!knowledge.embedding || knowledge.embedding.length === 0) continue;

    const similarity = cosineSimilarity(embedding, knowledge.embedding);
    if (similarity >= minSimilarity) {
      similarities.push({ entity: knowledge, similarity });
    }
  }

  // Sort by similarity and take top K
  similarities.sort((a, b) => b.similarity - a.similarity);
  const topSimilar = similarities.slice(0, topK);

  for (const { entity, similarity } of topSimilar) {
    similar.push({
      id: entity.id,
      name: entity.name,
      file: entity.file,
      line: entity.line,
      similarity,
      reason: inferSimilarityReason(entity, similarity),
    });
  }

  return similar;
}

/**
 * Compute cosine similarity between two embeddings.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i] ?? 0;
    const valB = b[i] ?? 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * Infer why two entities are similar.
 */
function inferSimilarityReason(
  entity: { name: string; kind: string; file: string; purposeSummary?: string },
  similarity: number
): string {
  const reasons: string[] = [];

  if (similarity > 0.95) {
    reasons.push('Nearly identical semantic meaning');
  } else if (similarity > 0.85) {
    reasons.push('Very similar purpose or functionality');
  } else if (similarity > 0.75) {
    reasons.push('Similar domain or implementation pattern');
  } else {
    reasons.push('Related functionality');
  }

  if (entity.purposeSummary) {
    reasons.push(`Purpose: ${entity.purposeSummary.slice(0, 50)}...`);
  }

  return reasons.join('. ');
}

// ============================================================================
// COCHANGE ANALYSIS
// ============================================================================

export interface CochangeAnalysis {
  highCoupling: Cochange[];      // Strong temporal coupling (potential design issue)
  moderate: Cochange[];          // Normal cochange
  transitive: Cochange[];        // Indirect coupling through shared changers
}

/**
 * Analyze cochange patterns to identify potential issues.
 */
export function analyzeCochangePatterns(cochanges: Cochange[]): CochangeAnalysis {
  const highCoupling = cochanges.filter(c => c.strength > 0.5);
  const moderate = cochanges.filter(c => c.strength > 0.2 && c.strength <= 0.5);
  const transitive: Cochange[] = []; // Would need additional graph traversal

  return {
    highCoupling,
    moderate,
    transitive,
  };
}

/**
 * Detect potential circular dependencies from cochange data.
 */
export function detectCircularDependencies(
  cochanges: Cochange[],
  imports: Reference[]
): { cycles: string[][] } {
  const cycles: string[][] = [];

  // Build adjacency from imports
  const importedFiles = new Set(imports.map(i => i.file));

  // Check if any cochange target is also an import (potential cycle indicator)
  for (const cochange of cochanges) {
    if (importedFiles.has(cochange.file) && cochange.strength > 0.3) {
      // High cochange + import = potential bidirectional dependency
      cycles.push([cochange.file]);
    }
  }

  return { cycles };
}

// ============================================================================
// INTEGRATION WITH GENERATOR
// ============================================================================

export interface EnrichedRelationships {
  cochanges: Cochange[];
  similar: SimilarEntity[];
  cochangeAnalysis: CochangeAnalysis;
  couplingScore: number;       // Overall coupling health (0-1, lower is better)
  clusterMembership?: string;  // Which cluster this entity belongs to
}

/**
 * Enrich relationships with full analysis.
 */
export async function enrichRelationships(
  input: RelationshipsInput,
  existingImports: Reference[] = [],
  config: SimilarityConfig = {}
): Promise<EnrichedRelationships> {
  const extraction = await extractRelationships(input, config);
  const cochangeAnalysis = analyzeCochangePatterns(extraction.cochanges);

  // Calculate coupling score (0 = good, 1 = bad)
  const highCouplingPenalty = cochangeAnalysis.highCoupling.length * 0.2;
  const moderatePenalty = cochangeAnalysis.moderate.length * 0.05;
  const couplingScore = Math.min(1, highCouplingPenalty + moderatePenalty);

  // Determine cluster membership from similarity
  let clusterMembership: string | undefined;
  if (extraction.similar.length > 0) {
    // Find the most common file prefix among similar entities
    const prefixes = extraction.similar
      .map(s => s.file.split('/').slice(0, -1).join('/'))
      .filter(p => p.length > 0);
    if (prefixes.length > 0) {
      clusterMembership = findMostCommon(prefixes);
    }
  }

  return {
    cochanges: extraction.cochanges,
    similar: extraction.similar,
    cochangeAnalysis,
    couplingScore,
    clusterMembership,
  };
}

function findMostCommon(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  let maxCount = 0;
  let maxItem = arr[0] ?? '';
  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxItem = item;
    }
  }
  return maxItem;
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Extract relationships for multiple entities efficiently.
 * Shares storage queries across entities.
 */
export async function extractRelationshipsBatch(
  inputs: RelationshipsInput[],
  config: SimilarityConfig = {}
): Promise<Map<string, RelationshipsExtraction>> {
  const results = new Map<string, RelationshipsExtraction>();

  // Pre-fetch all cochange data if storage is available
  const storage = inputs.find(i => i.storage)?.storage;
  let allCochanges: Map<string, Cochange[]> | undefined;

  if (storage) {
    try {
      const edges = await storage.getCochangeEdges({ limit: 10000 });
      allCochanges = new Map();

      for (const edge of edges) {
        // Index by both files
        const cochangeA: Cochange = {
          id: `cochange:${edge.fileB}`,
          name: edge.fileB.split('/').pop() ?? edge.fileB,
          file: edge.fileB,
          line: 1,
          strength: edge.strength,
          commits: edge.changeCount,
        };

        const cochangeB: Cochange = {
          id: `cochange:${edge.fileA}`,
          name: edge.fileA.split('/').pop() ?? edge.fileA,
          file: edge.fileA,
          line: 1,
          strength: edge.strength,
          commits: edge.changeCount,
        };

        if (!allCochanges.has(edge.fileA)) {
          allCochanges.set(edge.fileA, []);
        }
        allCochanges.get(edge.fileA)!.push(cochangeA);

        if (!allCochanges.has(edge.fileB)) {
          allCochanges.set(edge.fileB, []);
        }
        allCochanges.get(edge.fileB)!.push(cochangeB);
      }
    } catch {
      // Continue without cached cochange data
    }
  }

  // Process each input
  for (const input of inputs) {
    let cochanges: Cochange[] = [];
    let similar: SimilarEntity[] = [];

    // Use cached cochange data if available
    if (allCochanges) {
      cochanges = allCochanges.get(input.filePath) ?? [];
    } else if (input.storage) {
      const extraction = await extractRelationships(input, config);
      cochanges = extraction.cochanges;
      similar = extraction.similar;
    }

    // Similarity still needs per-entity computation
    if (input.embedding && input.storage && similar.length === 0) {
      try {
        similar = await findSimilarByEmbedding(
          input.entityId,
          input.embedding,
          input.storage,
          config.topK ?? 10,
          config.minSimilarity ?? 0.7
        );
      } catch {
        // Continue without similarity
      }
    }

    const confidence = 0.3 + (cochanges.length > 0 ? 0.35 : 0) + (similar.length > 0 ? 0.35 : 0);

    results.set(input.entityId, {
      cochanges,
      similar,
      confidence,
    });
  }

  return results;
}
