import type { SimilarityResult } from '../storage/types.js';
import {
  ENTRY_POINT_NAME_PATTERNS,
  ENTRY_POINT_PATH_PATTERNS,
} from './query_intent_patterns.js';

/**
 * Checks if an entity is likely an entry point based on its ID/name/path.
 */
export function isEntryPointEntity(entityId: string, entityName?: string): boolean {
  const idLower = entityId.toLowerCase();

  // Check path patterns
  if (ENTRY_POINT_PATH_PATTERNS.some((pattern) => pattern.test(entityId))) {
    return true;
  }

  // Check name patterns
  if (entityName && ENTRY_POINT_NAME_PATTERNS.some((pattern) => pattern.test(entityName))) {
    return true;
  }

  // Check for entry_point source type marker
  if (idLower.includes('entry_point:') || idLower.includes('entry-point')) {
    return true;
  }

  return false;
}

/**
 * Re-ranks similarity results to boost entry points for entry point queries.
 * This ensures that queries about "entry points", "main", "factory" return
 * actual entry points (src/index.ts, createLibrarian) rather than internal utilities.
 *
 * @param results - The similarity results to re-rank
 * @param entryPointBias - 0-1 value, higher = prefer entry points over internal utilities
 * @param entityNames - Optional map of entityId -> entityName for better detection
 * @returns Re-ranked results with entry points boosted
 */
export function applyEntryPointBias(
  results: SimilarityResult[],
  entryPointBias: number,
  entityNames?: Map<string, string>
): SimilarityResult[] {
  if (entryPointBias <= 0.1) {
    // No significant entry point bias, return as-is
    return results;
  }

  return results.map((result) => {
    const entityName = entityNames?.get(result.entityId);
    const isEntryPoint = isEntryPointEntity(result.entityId, entityName);

    if (isEntryPoint) {
      // Boost entry point similarity based on bias
      // Up to 60% boost for strong entry point queries
      const boost = 1 + (entryPointBias * 0.6);
      return {
        ...result,
        similarity: Math.min(1.0, result.similarity * boost),
      };
    }

    // Slightly penalize internal utility functions when seeking entry points
    if (entryPointBias > 0.5) {
      const idLower = result.entityId.toLowerCase();
      const isInternalUtil =
        idLower.includes('/utils/') ||
        idLower.includes('/helpers/') ||
        idLower.includes('/internal/') ||
        idLower.includes('/_') ||
        (entityName && entityName.startsWith('_'));

      if (isInternalUtil) {
        // Apply a penalty to internal utilities
        const penalty = 1 - (entryPointBias * 0.2); // Up to 20% penalty
        return {
          ...result,
          similarity: result.similarity * penalty,
        };
      }
    }

    return result;
  }).sort((a, b) => b.similarity - a.similarity);
}
