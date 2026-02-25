import type { SimilarityResult } from '../storage/types.js';

/**
 * Re-ranks similarity results to boost documents for meta-queries.
 */
export function applyDocumentBias(
  results: SimilarityResult[],
  documentBias: number
): SimilarityResult[] {
  if (documentBias <= 0.3) {
    // No significant document bias, return as-is
    return results;
  }

  return results.map((result) => {
    if (result.entityType === 'document') {
      // Boost document similarity based on bias
      const boost = 1 + (documentBias - 0.3) * 0.5; // Up to 35% boost
      return {
        ...result,
        similarity: Math.min(1.0, result.similarity * boost),
      };
    }
    return result;
  }).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Checks if an entity name or content indicates an interface/type definition.
 * This helps prioritize abstract boundaries over concrete implementations.
 */
export function isDefinitionEntity(entityId: string, entityName?: string): boolean {
  const idLower = entityId.toLowerCase();

  // Check for common interface/type naming patterns
  if (idLower.includes('interface') || idLower.includes('type:')) {
    return true;
  }

  // Check for naming conventions that indicate types
  // e.g., IStorage, StorageInterface, StorageType, StorageContract
  if (/^I[A-Z]/.test(entityName ?? '') || // IStorage pattern
      /Interface$/.test(entityName ?? '') ||
      /Type$/.test(entityName ?? '') ||
      /Contract$/.test(entityName ?? '') ||
      /Schema$/.test(entityName ?? '') ||
      /Protocol$/.test(entityName ?? '')) {
    return true;
  }

  // Check entity ID for types file indicators
  if (idLower.includes('/types.') || idLower.includes('/types/')) {
    return true;
  }

  return false;
}

/**
 * Re-ranks similarity results to boost interface/type definitions for definition queries.
 * This ensures that queries about "storage interface" return the LibrarianStorage interface
 * rather than implementation functions like getStorage().
 *
 * @param results - The similarity results to re-rank
 * @param definitionBias - 0-1 value, higher = prefer definitions over implementations
 * @param entityNames - Optional map of entityId -> entityName for better detection
 * @returns Re-ranked results with definitions boosted
 */
export function applyDefinitionBias(
  results: SimilarityResult[],
  definitionBias: number,
  entityNames?: Map<string, string>
): SimilarityResult[] {
  if (definitionBias <= 0.1) {
    // No significant definition bias, return as-is
    return results;
  }

  return results.map((result) => {
    const entityName = entityNames?.get(result.entityId);
    const isDefinition = isDefinitionEntity(result.entityId, entityName);

    if (isDefinition) {
      // Strong boost for definitions when definition is sought
      // Up to 150% boost (2.5x multiplier) for strong definition queries
      // This ensures type/interface definitions appear at the top
      const boost = 1 + (definitionBias * 1.5);
      return {
        ...result,
        similarity: Math.min(1.0, result.similarity * boost),
      };
    }

    // Check if this looks like a usage rather than a definition
    // Usages should be heavily penalized when seeking definitions
    const idLower = result.entityId.toLowerCase();
    const nameIndicatesImpl = entityName &&
      (entityName.startsWith('get') ||
       entityName.startsWith('set') ||
       entityName.startsWith('create') ||
       entityName.startsWith('make') ||
       entityName.startsWith('build') ||
       entityName.startsWith('init') ||
       entityName.startsWith('use') ||
       entityName.startsWith('handle') ||
       entityName.startsWith('process'));

    // Heavy penalty for usages/implementations when definition sought
    if (definitionBias > 0.3) {
      const isUsage = nameIndicatesImpl ||
        idLower.includes('impl') ||
        idLower.includes('implementation') ||
        idLower.includes('usage') ||
        idLower.includes('handler') ||
        idLower.includes('controller') ||
        (idLower.includes('service') && !idLower.includes('interface'));

      if (isUsage) {
        // Apply heavy penalty to usages - up to 70% reduction
        const penalty = 1 - (definitionBias * 0.7);
        return {
          ...result,
          similarity: result.similarity * penalty,
        };
      }
    }

    return result;
  }).sort((a, b) => b.similarity - a.similarity);
}
