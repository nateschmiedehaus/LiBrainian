/**
 * @fileoverview Comparison Construction for Contrastive Queries
 *
 * Handles queries that ask for comparisons between two code entities:
 * - "difference between X and Y"
 * - "X vs Y"
 * - "compare X and Y"
 * - "X compared to Y"
 *
 * PROBLEM SOLVED:
 * - Queries like "difference between createSqliteStorage and createStorageFromBackend"
 *   previously returned both entities separately but no comparison analysis.
 * - Pass rate: 0%
 *
 * SOLUTION:
 * - Detect comparison intent from query patterns
 * - Retrieve both entities using existing storage/search
 * - Analyze similarities and differences
 * - Generate a comparison pack with structured analysis
 *
 * @example
 * ```typescript
 * const intent = detectComparisonIntent("difference between createSqliteStorage and createStorageFromBackend");
 * // { isComparison: true, entityA: "createSqliteStorage", entityB: "createStorageFromBackend" }
 *
 * const result = await compareEntities(intent, storage);
 * // Returns comparison pack with similarities, differences, recommendation
 * ```
 *
 * @packageDocumentation
 */

import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack, FunctionKnowledge, ModuleKnowledge, FileKnowledge } from '../types.js';
import type { UniversalKnowledgeRecord } from '../storage/types.js';
import * as path from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of detecting a comparison intent from a query.
 */
export interface ComparisonIntent {
  /** Whether this is a comparison query */
  isComparison: boolean;
  /** First entity name to compare */
  entityA: string | null;
  /** Second entity name to compare */
  entityB: string | null;
  /** Type of comparison requested */
  comparisonType: ComparisonType | null;
  /** Confidence in the detection (0-1) */
  confidence: number;
  /** The original query */
  originalQuery: string;
  /** Explanation of how the intent was detected */
  explanation: string;
}

/**
 * Types of comparison queries.
 */
export type ComparisonType =
  | 'difference'  // "difference between X and Y"
  | 'versus'      // "X vs Y"
  | 'compare'     // "compare X and Y"
  | 'similarity'  // "how similar are X and Y"
  | 'choice';     // "which should I use, X or Y"

/**
 * An analyzed entity for comparison.
 */
export interface AnalyzedEntity {
  /** Entity name */
  name: string;
  /** Entity kind (function, class, module, etc.) */
  kind: 'function' | 'class' | 'module' | 'interface' | 'type' | 'unknown';
  /** File path */
  filePath: string;
  /** Start line in file */
  startLine: number;
  /** End line in file */
  endLine?: number;
  /** Function/method signature if applicable */
  signature?: string;
  /** Purpose/summary */
  purpose?: string;
  /** Complexity level */
  complexity?: 'low' | 'medium' | 'high';
  /** Dependencies/imports */
  dependencies?: string[];
  /** What this entity exports or provides */
  exports?: string[];
  /** Is this async */
  isAsync?: boolean;
  /** Parameters (for functions) */
  parameters?: string[];
  /** Return type (for functions) */
  returnType?: string;
}

/**
 * A point of similarity between two entities.
 */
export interface SimilarityPoint {
  /** Aspect that is similar */
  aspect: string;
  /** Description of the similarity */
  description: string;
}

/**
 * A point of difference between two entities.
 */
export interface DifferencePoint {
  /** Aspect that differs */
  aspect: string;
  /** Description for entity A */
  entityADescription: string;
  /** Description for entity B */
  entityBDescription: string;
  /** Significance of this difference */
  significance: 'minor' | 'moderate' | 'significant';
}

/**
 * Complete comparison result between two entities.
 */
export interface ComparisonResult {
  /** First entity analyzed */
  entityA: AnalyzedEntity;
  /** Second entity analyzed */
  entityB: AnalyzedEntity;
  /** Points of similarity */
  similarities: SimilarityPoint[];
  /** Points of difference */
  differences: DifferencePoint[];
  /** Recommendation on when to use each */
  recommendation: string;
  /** Summary of the comparison */
  summary: string;
  /** Confidence in the analysis (0-1) */
  confidence: number;
}

// ============================================================================
// INTENT DETECTION PATTERNS
// ============================================================================

/**
 * Patterns for detecting comparison queries.
 * Each pattern extracts the two entity names being compared.
 */
const COMPARISON_PATTERNS: Array<{
  pattern: RegExp;
  type: ComparisonType;
  groupA: number;
  groupB: number;
}> = [
  // CHOICE patterns first (more specific, include "when to use" etc.)
  // "which should I use, X or Y" / "which is better, X or Y"
  {
    pattern: /\bwhich\s+(?:should\s+(?:I|we)\s+use|is\s+better)[,:]?\s+(\w+)\s+or\s+(\w+)/i,
    type: 'choice',
    groupA: 1,
    groupB: 2,
  },
  // "when to use X vs Y" / "when to use X instead of Y"
  {
    pattern: /\bwhen\s+to\s+use\s+(\w+)\s+(?:vs\.?|versus|or|instead\s+of)\s+(\w+)/i,
    type: 'choice',
    groupA: 1,
    groupB: 2,
  },
  // "X or Y - which one"
  {
    pattern: /\b(\w+)\s+or\s+(\w+)\s*[-:]\s*which/i,
    type: 'choice',
    groupA: 1,
    groupB: 2,
  },
  // DIFFERENCE patterns
  // "difference between X and Y"
  {
    pattern: /\bdifference(?:s)?\s+between\s+(\w+)\s+and\s+(\w+)/i,
    type: 'difference',
    groupA: 1,
    groupB: 2,
  },
  // "what is the difference between X and Y"
  {
    pattern: /\bwhat\s+(?:is|are)\s+the\s+difference(?:s)?\s+between\s+(\w+)\s+and\s+(\w+)/i,
    type: 'difference',
    groupA: 1,
    groupB: 2,
  },
  // VERSUS patterns (after choice patterns to avoid stealing "when to use X vs Y")
  // "X vs Y" / "X versus Y"
  {
    pattern: /\b(\w+)\s+(?:vs\.?|versus)\s+(\w+)/i,
    type: 'versus',
    groupA: 1,
    groupB: 2,
  },
  // COMPARE patterns
  // "compare X and Y" / "compare X with Y" / "compare X to Y"
  {
    pattern: /\bcompare\s+(\w+)\s+(?:and|with|to)\s+(\w+)/i,
    type: 'compare',
    groupA: 1,
    groupB: 2,
  },
  // "X compared to Y"
  {
    pattern: /\b(\w+)\s+compared\s+to\s+(\w+)/i,
    type: 'compare',
    groupA: 1,
    groupB: 2,
  },
  // SIMILARITY patterns
  // "how similar are X and Y"
  {
    pattern: /\bhow\s+(?:similar|different)\s+are\s+(\w+)\s+and\s+(\w+)/i,
    type: 'similarity',
    groupA: 1,
    groupB: 2,
  },
  // Simple/fallback patterns (lowest priority)
  // "difference X Y" (simple)
  {
    pattern: /\bdifference\s+(\w+)\s+(\w+)$/i,
    type: 'difference',
    groupA: 1,
    groupB: 2,
  },
];

// ============================================================================
// INTENT DETECTION
// ============================================================================

/**
 * Detect if a query is asking for a comparison between two entities.
 *
 * @param query - The user's query string
 * @returns Comparison intent with detected entities
 *
 * @example
 * ```typescript
 * const intent = detectComparisonIntent("difference between createSqliteStorage and createStorageFromBackend");
 * // {
 * //   isComparison: true,
 * //   entityA: "createSqliteStorage",
 * //   entityB: "createStorageFromBackend",
 * //   comparisonType: "difference",
 * //   confidence: 0.95
 * // }
 * ```
 */
export function detectComparisonIntent(query: string): ComparisonIntent {
  if (!query || typeof query !== 'string') {
    return {
      isComparison: false,
      entityA: null,
      entityB: null,
      comparisonType: null,
      confidence: 0,
      originalQuery: query || '',
      explanation: 'Invalid or empty query',
    };
  }

  const trimmed = query.trim();

  for (const { pattern, type, groupA, groupB } of COMPARISON_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const entityA = match[groupA];
      const entityB = match[groupB];

      // Validate that both entities look like identifiers
      if (isValidIdentifier(entityA) && isValidIdentifier(entityB)) {
        return {
          isComparison: true,
          entityA,
          entityB,
          comparisonType: type,
          confidence: 0.95,
          originalQuery: trimmed,
          explanation: `Detected '${type}' comparison between '${entityA}' and '${entityB}'.`,
        };
      }
    }
  }

  return {
    isComparison: false,
    entityA: null,
    entityB: null,
    comparisonType: null,
    confidence: 0,
    originalQuery: trimmed,
    explanation: 'No comparison pattern detected.',
  };
}

/**
 * Check if a string looks like a valid code identifier.
 */
function isValidIdentifier(name: string): boolean {
  if (!name || name.length < 2) return false;
  // Must start with letter or underscore, can contain letters, numbers, underscores
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Check if a query should use comparison mode.
 *
 * @param query - The user's query string
 * @returns True if comparison mode should be used
 */
export function shouldUseComparisonMode(query: string): boolean {
  const intent = detectComparisonIntent(query);
  return intent.isComparison && intent.confidence >= 0.7;
}

// ============================================================================
// ENTITY ANALYSIS
// ============================================================================

/**
 * Find and analyze an entity by name from storage.
 *
 * @param entityName - Name of the entity to find
 * @param storage - LiBrainian storage instance
 * @returns Analyzed entity or null if not found
 */
export async function findAndAnalyzeEntity(
  entityName: string,
  storage: LiBrainianStorage
): Promise<AnalyzedEntity | null> {
  const lowerName = entityName.toLowerCase();

  // Try to find as function first (with various matching strategies)
  try {
    const functions = await storage.getFunctions({ limit: 5000 });

    // Exact match first
    let matchingFunction = functions.find(
      (fn) => fn.name === entityName
    );

    // Case-insensitive exact match
    if (!matchingFunction) {
      matchingFunction = functions.find(
        (fn) => fn.name.toLowerCase() === lowerName
      );
    }

    // Partial match (entity name ends the function name - handles prefixes)
    if (!matchingFunction) {
      matchingFunction = functions.find(
        (fn) => fn.name.toLowerCase().endsWith(lowerName)
      );
    }

    // Partial match (entity name contains the core name)
    if (!matchingFunction) {
      matchingFunction = functions.find(
        (fn) => fn.name.toLowerCase().includes(lowerName) || lowerName.includes(fn.name.toLowerCase())
      );
    }

    if (matchingFunction) {
      return analyzeFunctionEntity(matchingFunction);
    }
  } catch {
    // Function storage might not be available
  }

  // Try universal knowledge (classes, interfaces, types)
  try {
    const universalRecords = await storage.queryUniversalKnowledge({
      limit: 1000,
    });

    // Exact match first
    let matchingRecord = universalRecords.find(
      (r) => r.name === entityName
    );

    // Case-insensitive match
    if (!matchingRecord) {
      matchingRecord = universalRecords.find(
        (r) => r.name.toLowerCase() === lowerName
      );
    }

    // Partial match
    if (!matchingRecord) {
      matchingRecord = universalRecords.find(
        (r) => r.name.toLowerCase().includes(lowerName) || lowerName.includes(r.name.toLowerCase())
      );
    }

    if (matchingRecord) {
      return analyzeUniversalKnowledgeEntity(matchingRecord);
    }
  } catch {
    // Universal knowledge might not be available
  }

  // Try modules
  try {
    const modules = await storage.getModules({ limit: 2000 });
    const matchingModule = modules.find(
      (m) =>
        path.basename(m.path, path.extname(m.path)) === entityName ||
        path.basename(m.path, path.extname(m.path)).toLowerCase() === lowerName
    );

    if (matchingModule) {
      return analyzeModuleEntity(matchingModule);
    }
  } catch {
    // Module storage might not be available
  }

  return null;
}

/**
 * Analyze a function entity.
 */
function analyzeFunctionEntity(fn: FunctionKnowledge): AnalyzedEntity {
  // Parse signature to extract info
  const isAsync = fn.signature?.includes('async') ?? false;
  const parameters = extractParameters(fn.signature);
  const returnType = extractReturnType(fn.signature);

  // Estimate complexity based on line count
  const lineCount = fn.endLine - fn.startLine + 1;
  let complexity: 'low' | 'medium' | 'high' = 'low';
  if (lineCount > 50) complexity = 'high';
  else if (lineCount > 20) complexity = 'medium';

  return {
    name: fn.name,
    kind: 'function',
    filePath: fn.filePath,
    startLine: fn.startLine,
    endLine: fn.endLine,
    signature: fn.signature,
    purpose: fn.purpose,
    complexity,
    isAsync,
    parameters,
    returnType,
  };
}

/**
 * Analyze a universal knowledge entity (class, interface, type).
 */
function analyzeUniversalKnowledgeEntity(record: UniversalKnowledgeRecord): AnalyzedEntity {
  const kind = (record.kind as AnalyzedEntity['kind']) || 'unknown';

  return {
    name: record.name,
    kind,
    filePath: record.file,
    startLine: record.line || 0,
    purpose: record.purposeSummary,
    complexity: record.cyclomaticComplexity && record.cyclomaticComplexity > 10 ? 'high' :
                record.cyclomaticComplexity && record.cyclomaticComplexity > 5 ? 'medium' : 'low',
  };
}

/**
 * Analyze a module entity.
 */
function analyzeModuleEntity(mod: ModuleKnowledge): AnalyzedEntity {
  return {
    name: path.basename(mod.path, path.extname(mod.path)),
    kind: 'module',
    filePath: mod.path,
    startLine: 1,
    purpose: mod.purpose,
    exports: mod.exports,
    dependencies: mod.dependencies,
  };
}

/**
 * Extract parameter names from a function signature.
 */
function extractParameters(signature?: string): string[] {
  if (!signature) return [];
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const paramsStr = match[1];
  if (!paramsStr.trim()) return [];
  // Split by comma, extract parameter names
  return paramsStr.split(',').map((p) => {
    const param = p.trim();
    const colonIndex = param.indexOf(':');
    if (colonIndex > 0) {
      return param.substring(0, colonIndex).trim();
    }
    return param.split('=')[0].trim();
  }).filter(Boolean);
}

/**
 * Extract return type from a function signature.
 */
function extractReturnType(signature?: string): string | undefined {
  if (!signature) return undefined;
  // Look for ): Type pattern
  const match = signature.match(/\)\s*:\s*([^{]+)/);
  if (match) {
    return match[1].trim();
  }
  return undefined;
}

// ============================================================================
// COMPARISON ANALYSIS
// ============================================================================

/**
 * Compare two entities and generate a structured comparison result.
 *
 * @param intent - The comparison intent with entity names
 * @param storage - LiBrainian storage instance
 * @returns Comparison result or null if entities not found
 */
export async function compareEntities(
  intent: ComparisonIntent,
  storage: LiBrainianStorage
): Promise<ComparisonResult | null> {
  if (!intent.isComparison || !intent.entityA || !intent.entityB) {
    return null;
  }

  // Find and analyze both entities
  const entityA = await findAndAnalyzeEntity(intent.entityA, storage);
  const entityB = await findAndAnalyzeEntity(intent.entityB, storage);

  if (!entityA || !entityB) {
    return null;
  }

  // Analyze similarities
  const similarities = findSimilarities(entityA, entityB);

  // Analyze differences
  const differences = findDifferences(entityA, entityB);

  // Generate recommendation
  const recommendation = generateRecommendation(entityA, entityB, differences);

  // Generate summary
  const summary = generateSummary(entityA, entityB, similarities, differences);

  // Calculate confidence based on how much info we have
  const confidence = calculateComparisonConfidence(entityA, entityB);

  return {
    entityA,
    entityB,
    similarities,
    differences,
    recommendation,
    summary,
    confidence,
  };
}

/**
 * Find similarities between two entities.
 */
function findSimilarities(entityA: AnalyzedEntity, entityB: AnalyzedEntity): SimilarityPoint[] {
  const similarities: SimilarityPoint[] = [];

  // Same file
  if (entityA.filePath === entityB.filePath) {
    similarities.push({
      aspect: 'Location',
      description: `Both are defined in the same file: ${entityA.filePath}`,
    });
  }

  // Same kind
  if (entityA.kind === entityB.kind) {
    similarities.push({
      aspect: 'Type',
      description: `Both are ${entityA.kind}s.`,
    });
  }

  // Both async or both sync
  if (entityA.isAsync !== undefined && entityB.isAsync !== undefined) {
    if (entityA.isAsync === entityB.isAsync) {
      similarities.push({
        aspect: 'Async behavior',
        description: entityA.isAsync
          ? 'Both are asynchronous functions.'
          : 'Both are synchronous functions.',
      });
    }
  }

  // Similar return types
  if (entityA.returnType && entityB.returnType) {
    // Check if return types are related (e.g., both return LiBrainianStorage)
    const returnA = entityA.returnType.toLowerCase();
    const returnB = entityB.returnType.toLowerCase();
    if (returnA.includes(returnB) || returnB.includes(returnA) || returnA === returnB) {
      similarities.push({
        aspect: 'Return type',
        description: `Both return similar types: ${entityA.returnType} / ${entityB.returnType}`,
      });
    }
  }

  // Similar complexity
  if (entityA.complexity === entityB.complexity) {
    similarities.push({
      aspect: 'Complexity',
      description: `Both have ${entityA.complexity} complexity.`,
    });
  }

  return similarities;
}

/**
 * Find differences between two entities.
 */
function findDifferences(entityA: AnalyzedEntity, entityB: AnalyzedEntity): DifferencePoint[] {
  const differences: DifferencePoint[] = [];

  // Different kinds
  if (entityA.kind !== entityB.kind) {
    differences.push({
      aspect: 'Type',
      entityADescription: `${entityA.name} is a ${entityA.kind}`,
      entityBDescription: `${entityB.name} is a ${entityB.kind}`,
      significance: 'significant',
    });
  }

  // Different files
  if (entityA.filePath !== entityB.filePath) {
    differences.push({
      aspect: 'Location',
      entityADescription: `Located in ${entityA.filePath}`,
      entityBDescription: `Located in ${entityB.filePath}`,
      significance: 'minor',
    });
  }

  // Async vs sync
  if (entityA.isAsync !== undefined && entityB.isAsync !== undefined && entityA.isAsync !== entityB.isAsync) {
    differences.push({
      aspect: 'Async behavior',
      entityADescription: entityA.isAsync ? 'Asynchronous function' : 'Synchronous function',
      entityBDescription: entityB.isAsync ? 'Asynchronous function' : 'Synchronous function',
      significance: 'significant',
    });
  }

  // Different parameter counts
  const paramsA = entityA.parameters?.length ?? 0;
  const paramsB = entityB.parameters?.length ?? 0;
  if (paramsA !== paramsB) {
    differences.push({
      aspect: 'Parameters',
      entityADescription: `Takes ${paramsA} parameter(s): ${entityA.parameters?.join(', ') || 'none'}`,
      entityBDescription: `Takes ${paramsB} parameter(s): ${entityB.parameters?.join(', ') || 'none'}`,
      significance: 'moderate',
    });
  }

  // Different return types
  if (entityA.returnType && entityB.returnType && entityA.returnType !== entityB.returnType) {
    differences.push({
      aspect: 'Return type',
      entityADescription: `Returns ${entityA.returnType}`,
      entityBDescription: `Returns ${entityB.returnType}`,
      significance: 'moderate',
    });
  }

  // Different complexity
  if (entityA.complexity && entityB.complexity && entityA.complexity !== entityB.complexity) {
    differences.push({
      aspect: 'Complexity',
      entityADescription: `${entityA.complexity} complexity`,
      entityBDescription: `${entityB.complexity} complexity`,
      significance: 'minor',
    });
  }

  // Different purposes (if we have them)
  if (entityA.purpose && entityB.purpose && entityA.purpose !== entityB.purpose) {
    differences.push({
      aspect: 'Purpose',
      entityADescription: entityA.purpose,
      entityBDescription: entityB.purpose,
      significance: 'significant',
    });
  }

  // Line count / size difference
  if (entityA.endLine && entityB.endLine) {
    const sizeA = entityA.endLine - entityA.startLine + 1;
    const sizeB = entityB.endLine - entityB.startLine + 1;
    if (Math.abs(sizeA - sizeB) > 10) {
      differences.push({
        aspect: 'Size',
        entityADescription: `${sizeA} lines (lines ${entityA.startLine}-${entityA.endLine})`,
        entityBDescription: `${sizeB} lines (lines ${entityB.startLine}-${entityB.endLine})`,
        significance: sizeA > sizeB * 2 || sizeB > sizeA * 2 ? 'moderate' : 'minor',
      });
    }
  }

  return differences;
}

/**
 * Generate a recommendation for when to use each entity.
 */
function generateRecommendation(
  entityA: AnalyzedEntity,
  entityB: AnalyzedEntity,
  differences: DifferencePoint[]
): string {
  const recommendations: string[] = [];

  // Check for sync vs async difference
  const asyncDiff = differences.find((d) => d.aspect === 'Async behavior');
  if (asyncDiff) {
    if (entityA.isAsync && !entityB.isAsync) {
      recommendations.push(
        `Use ${entityB.name} for simple synchronous cases.`,
        `Use ${entityA.name} when you need async/await support.`
      );
    } else if (!entityA.isAsync && entityB.isAsync) {
      recommendations.push(
        `Use ${entityA.name} for simple synchronous cases.`,
        `Use ${entityB.name} when you need async/await support.`
      );
    }
  }

  // Check for parameter complexity difference
  const paramDiff = differences.find((d) => d.aspect === 'Parameters');
  if (paramDiff) {
    const paramsA = entityA.parameters?.length ?? 0;
    const paramsB = entityB.parameters?.length ?? 0;
    if (paramsA < paramsB) {
      recommendations.push(
        `Use ${entityA.name} for simpler instantiation with fewer options.`,
        `Use ${entityB.name} when you need more configuration flexibility.`
      );
    } else if (paramsB < paramsA) {
      recommendations.push(
        `Use ${entityB.name} for simpler instantiation with fewer options.`,
        `Use ${entityA.name} when you need more configuration flexibility.`
      );
    }
  }

  // Check for complexity difference
  const complexityDiff = differences.find((d) => d.aspect === 'Complexity');
  if (complexityDiff && entityA.complexity !== entityB.complexity) {
    const simpler = entityA.complexity === 'low' || (entityA.complexity === 'medium' && entityB.complexity === 'high')
      ? entityA.name
      : entityB.name;
    const moreComplex = simpler === entityA.name ? entityB.name : entityA.name;
    recommendations.push(
      `${simpler} is simpler and may be easier to understand.`,
      `${moreComplex} may handle more edge cases.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      `Both ${entityA.name} and ${entityB.name} serve similar purposes.`,
      `Choose based on your specific use case and coding style preferences.`
    );
  }

  return recommendations.join(' ');
}

/**
 * Generate a summary of the comparison.
 */
function generateSummary(
  entityA: AnalyzedEntity,
  entityB: AnalyzedEntity,
  similarities: SimilarityPoint[],
  differences: DifferencePoint[]
): string {
  const sameFile = entityA.filePath === entityB.filePath;
  const sameKind = entityA.kind === entityB.kind;

  let summary = '';

  if (sameFile && sameKind) {
    summary = `${entityA.name} and ${entityB.name} are both ${entityA.kind}s in the same file (${entityA.filePath}).`;
  } else if (sameKind) {
    summary = `${entityA.name} and ${entityB.name} are both ${entityA.kind}s but in different locations.`;
  } else {
    summary = `${entityA.name} is a ${entityA.kind} while ${entityB.name} is a ${entityB.kind}.`;
  }

  if (similarities.length > 0 && differences.length > 0) {
    summary += ` They share ${similarities.length} similarities and have ${differences.length} key differences.`;
  } else if (differences.length > 0) {
    summary += ` They have ${differences.length} key differences.`;
  } else if (similarities.length > 0) {
    summary += ` They are very similar with ${similarities.length} common characteristics.`;
  }

  // Add the most significant difference
  const significantDiff = differences.find((d) => d.significance === 'significant');
  if (significantDiff) {
    summary += ` The most significant difference: ${significantDiff.aspect}.`;
  }

  return summary;
}

/**
 * Calculate confidence based on available information.
 */
function calculateComparisonConfidence(entityA: AnalyzedEntity, entityB: AnalyzedEntity): number {
  let confidence = 0.6; // Base confidence

  // Bonus for having purpose/summary
  if (entityA.purpose) confidence += 0.1;
  if (entityB.purpose) confidence += 0.1;

  // Bonus for having signature info
  if (entityA.signature) confidence += 0.05;
  if (entityB.signature) confidence += 0.05;

  // Bonus for same kind (easier to compare)
  if (entityA.kind === entityB.kind) confidence += 0.1;

  return Math.min(0.95, confidence);
}

// ============================================================================
// CONTEXT PACK GENERATION
// ============================================================================

/**
 * Create a comparison context pack from a comparison result.
 *
 * @param result - The comparison result
 * @param intent - The original comparison intent
 * @returns A context pack for the comparison
 */
export function createComparisonPack(result: ComparisonResult, intent: ComparisonIntent): ContextPack {
  const keyFacts: string[] = [];

  // Add location info
  if (result.entityA.filePath === result.entityB.filePath) {
    keyFacts.push(`Same file: ${result.entityA.filePath}`);
    keyFacts.push(
      `${result.entityA.name}: lines ${result.entityA.startLine}-${result.entityA.endLine || '?'}`
    );
    keyFacts.push(
      `${result.entityB.name}: lines ${result.entityB.startLine}-${result.entityB.endLine || '?'}`
    );
  } else {
    keyFacts.push(`${result.entityA.name}: ${result.entityA.filePath}:${result.entityA.startLine}`);
    keyFacts.push(`${result.entityB.name}: ${result.entityB.filePath}:${result.entityB.startLine}`);
  }

  // Add key differences
  for (const diff of result.differences.filter((d) => d.significance !== 'minor').slice(0, 5)) {
    keyFacts.push(`${diff.aspect}: ${diff.entityADescription} vs ${diff.entityBDescription}`);
  }

  // Add recommendation
  keyFacts.push(`Recommendation: ${result.recommendation}`);

  const packId = `comparison:${result.entityA.name}_vs_${result.entityB.name}`;

  const pack: ContextPack = {
    packId,
    packType: 'decision_context',
    targetId: packId,
    summary: result.summary,
    keyFacts,
    codeSnippets: [],
    relatedFiles: [result.entityA.filePath, result.entityB.filePath].filter(
      (f, i, arr) => arr.indexOf(f) === i
    ),
    confidence: result.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 0,
      minor: 1,
      patch: 0,
      string: '0.1.0',
      qualityTier: 'enhanced',
      indexedAt: new Date(),
      indexerVersion: '0.1.0',
      features: ['comparison'],
    },
    invalidationTriggers: [result.entityA.filePath, result.entityB.filePath],
  };

  return pack;
}

/**
 * Format a comparison result as a human-readable string.
 *
 * @param result - The comparison result
 * @returns Formatted string
 */
export function formatComparisonResult(result: ComparisonResult): string {
  const lines: string[] = [];

  lines.push(`\n=== Comparison: ${result.entityA.name} vs ${result.entityB.name} ===\n`);
  lines.push(result.summary);
  lines.push('');

  // Entity details
  lines.push(`--- ${result.entityA.name} ---`);
  lines.push(`Kind: ${result.entityA.kind}`);
  lines.push(`File: ${result.entityA.filePath}:${result.entityA.startLine}`);
  if (result.entityA.purpose) lines.push(`Purpose: ${result.entityA.purpose}`);
  if (result.entityA.signature) lines.push(`Signature: ${result.entityA.signature}`);
  lines.push('');

  lines.push(`--- ${result.entityB.name} ---`);
  lines.push(`Kind: ${result.entityB.kind}`);
  lines.push(`File: ${result.entityB.filePath}:${result.entityB.startLine}`);
  if (result.entityB.purpose) lines.push(`Purpose: ${result.entityB.purpose}`);
  if (result.entityB.signature) lines.push(`Signature: ${result.entityB.signature}`);
  lines.push('');

  // Similarities
  if (result.similarities.length > 0) {
    lines.push('--- Similarities ---');
    for (const sim of result.similarities) {
      lines.push(`- ${sim.aspect}: ${sim.description}`);
    }
    lines.push('');
  }

  // Differences
  if (result.differences.length > 0) {
    lines.push('--- Differences ---');
    for (const diff of result.differences) {
      lines.push(`- ${diff.aspect} [${diff.significance}]:`);
      lines.push(`  ${result.entityA.name}: ${diff.entityADescription}`);
      lines.push(`  ${result.entityB.name}: ${diff.entityBDescription}`);
    }
    lines.push('');
  }

  // Recommendation
  lines.push('--- Recommendation ---');
  lines.push(result.recommendation);
  lines.push('');

  lines.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);

  return lines.join('\n');
}

// ============================================================================
// SEMANTIC/BEHAVIORAL DIFFERENCE ANALYSIS
// ============================================================================

/**
 * Represents a behavioral/semantic difference between two code snippets.
 */
export interface BehavioralDifference {
  /** The aspect being compared (e.g., 'error_handling', 'caching') */
  aspect: string;
  /** Description of entity A's behavior */
  entityA: string;
  /** Description of entity B's behavior */
  entityB: string;
  /** Human-readable description of the difference */
  description: string;
}

/**
 * Analyze semantic/behavioral differences between two code snippets.
 *
 * This function examines code patterns to identify behavioral differences
 * that may not be apparent from structural comparison alone.
 *
 * @param codeA - First code snippet to analyze
 * @param codeB - Second code snippet to analyze
 * @returns Array of behavioral differences found
 *
 * @example
 * ```typescript
 * const diffs = analyzeSemanticDifferences(
 *   'async function fetchData() { try { await api.get(); } catch (e) { log(e); } }',
 *   'function getData() { return cache.get(); }'
 * );
 * // Returns differences in: error_handling, async, caching, logging
 * ```
 */
export function analyzeSemanticDifferences(
  codeA: string,
  codeB: string
): BehavioralDifference[] {
  const differences: BehavioralDifference[] = [];

  // Error handling detection
  const hasErrorHandlingA = /try\s*\{|\.catch\(|catch\s*\(/.test(codeA);
  const hasErrorHandlingB = /try\s*\{|\.catch\(|catch\s*\(/.test(codeB);
  if (hasErrorHandlingA !== hasErrorHandlingB) {
    differences.push({
      aspect: 'error_handling',
      entityA: hasErrorHandlingA ? 'has try/catch' : 'no error handling',
      entityB: hasErrorHandlingB ? 'has try/catch' : 'no error handling',
      description: `${hasErrorHandlingA ? 'A' : 'B'} handles errors, ${hasErrorHandlingA ? 'B' : 'A'} does not`,
    });
  }

  // Caching detection
  const hasCachingA = /cache|memoize|Map\(\)|WeakMap/.test(codeA);
  const hasCachingB = /cache|memoize|Map\(\)|WeakMap/.test(codeB);
  if (hasCachingA !== hasCachingB) {
    differences.push({
      aspect: 'caching',
      entityA: hasCachingA ? 'implements caching' : 'no caching',
      entityB: hasCachingB ? 'implements caching' : 'no caching',
      description: `${hasCachingA ? 'A' : 'B'} uses caching, ${hasCachingA ? 'B' : 'A'} does not`,
    });
  }

  // Validation detection
  const hasValidationA = /validate|check|assert|throw.*invalid|if\s*\(!\w+\)/.test(codeA);
  const hasValidationB = /validate|check|assert|throw.*invalid|if\s*\(!\w+\)/.test(codeB);
  if (hasValidationA !== hasValidationB) {
    differences.push({
      aspect: 'validation',
      entityA: hasValidationA ? 'validates input' : 'no validation',
      entityB: hasValidationB ? 'validates input' : 'no validation',
      description: `${hasValidationA ? 'A' : 'B'} validates input, ${hasValidationA ? 'B' : 'A'} does not`,
    });
  }

  // Logging detection
  const hasLoggingA = /console\.|logger\.|log\(/.test(codeA);
  const hasLoggingB = /console\.|logger\.|log\(/.test(codeB);
  if (hasLoggingA !== hasLoggingB) {
    differences.push({
      aspect: 'logging',
      entityA: hasLoggingA ? 'has logging' : 'no logging',
      entityB: hasLoggingB ? 'has logging' : 'no logging',
      description: `${hasLoggingA ? 'A' : 'B'} logs, ${hasLoggingA ? 'B' : 'A'} does not`,
    });
  }

  // Async handling detection
  const isAsyncA = /async\s|await\s|Promise|\.then\(/.test(codeA);
  const isAsyncB = /async\s|await\s|Promise|\.then\(/.test(codeB);
  if (isAsyncA !== isAsyncB) {
    differences.push({
      aspect: 'async',
      entityA: isAsyncA ? 'asynchronous' : 'synchronous',
      entityB: isAsyncB ? 'asynchronous' : 'synchronous',
      description: `A is ${isAsyncA ? 'async' : 'sync'}, B is ${isAsyncB ? 'async' : 'sync'}`,
    });
  }

  // Null safety detection
  const hasNullSafetyA = /\?\.|!= null|!== null|\?\?|Optional/.test(codeA);
  const hasNullSafetyB = /\?\.|!= null|!== null|\?\?|Optional/.test(codeB);
  if (hasNullSafetyA !== hasNullSafetyB) {
    differences.push({
      aspect: 'null_safety',
      entityA: hasNullSafetyA ? 'null-safe' : 'no null checks',
      entityB: hasNullSafetyB ? 'null-safe' : 'no null checks',
      description: `${hasNullSafetyA ? 'A' : 'B'} has null safety, ${hasNullSafetyA ? 'B' : 'A'} does not`,
    });
  }

  // Retry/resilience detection
  const hasRetryA = /retry|backoff|resilient|circuit.?breaker/i.test(codeA);
  const hasRetryB = /retry|backoff|resilient|circuit.?breaker/i.test(codeB);
  if (hasRetryA !== hasRetryB) {
    differences.push({
      aspect: 'resilience',
      entityA: hasRetryA ? 'has retry/resilience' : 'no retry logic',
      entityB: hasRetryB ? 'has retry/resilience' : 'no retry logic',
      description: `${hasRetryA ? 'A' : 'B'} has resilience patterns, ${hasRetryA ? 'B' : 'A'} does not`,
    });
  }

  // Timeout handling detection
  const hasTimeoutA = /timeout|setTimeout|AbortController|deadline/i.test(codeA);
  const hasTimeoutB = /timeout|setTimeout|AbortController|deadline/i.test(codeB);
  if (hasTimeoutA !== hasTimeoutB) {
    differences.push({
      aspect: 'timeout',
      entityA: hasTimeoutA ? 'has timeout handling' : 'no timeout',
      entityB: hasTimeoutB ? 'has timeout handling' : 'no timeout',
      description: `${hasTimeoutA ? 'A' : 'B'} handles timeouts, ${hasTimeoutA ? 'B' : 'A'} does not`,
    });
  }

  return differences;
}

// ============================================================================
// CODE DIFFING
// ============================================================================

/**
 * Represents a unified diff between two code snippets.
 */
export interface CodeDiff {
  /** Type of diff output */
  type: 'unified' | 'side-by-side';
  /** Array of diff hunks */
  hunks: DiffHunk[];
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
  /** Total number of changed lines */
  changes: number;
}

/**
 * Represents a contiguous section of changes in a diff.
 */
export interface DiffHunk {
  /** Starting line in the old file */
  oldStart: number;
  /** Number of lines from old file */
  oldLines: number;
  /** Starting line in the new file */
  newStart: number;
  /** Number of lines in new file */
  newLines: number;
  /** Individual diff lines */
  lines: DiffLine[];
}

/**
 * Represents a single line in a diff.
 */
export interface DiffLine {
  /** Type of change: add, delete, or context */
  type: 'add' | 'delete' | 'context';
  /** Line content */
  content: string;
  /** Line number in old file (for delete/context) */
  oldLineNumber?: number;
  /** Line number in new file (for add/context) */
  newLineNumber?: number;
}

/**
 * Compute the Longest Common Subsequence of two string arrays.
 * Uses dynamic programming for O(m*n) time complexity.
 *
 * @param a - First array of strings
 * @param b - Second array of strings
 * @returns Array of strings representing the LCS
 */
export function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Build LCS length table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the actual LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Generate a unified diff between two code snippets.
 *
 * Uses the Longest Common Subsequence algorithm to compute the diff.
 *
 * @param codeA - Original code (source)
 * @param codeB - Modified code (target)
 * @returns CodeDiff object with hunks and statistics
 *
 * @example
 * ```typescript
 * const diff = generateUnifiedDiff(
 *   'function foo() {\n  return 1;\n}',
 *   'function foo() {\n  return 2;\n}'
 * );
 * console.log(diff.changes); // 2 (1 deletion + 1 addition)
 * ```
 */
export function generateUnifiedDiff(codeA: string, codeB: string): CodeDiff {
  const linesA = codeA.split('\n');
  const linesB = codeB.split('\n');

  const diffLines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  // Compute LCS
  const lcs = longestCommonSubsequence(linesA, linesB);

  // Generate diff using LCS
  let ai = 0;
  let bi = 0;
  let li = 0;

  while (ai < linesA.length || bi < linesB.length) {
    if (li < lcs.length && ai < linesA.length && linesA[ai] === lcs[li]) {
      if (bi < linesB.length && linesB[bi] === lcs[li]) {
        // Context line - both match LCS
        diffLines.push({
          type: 'context',
          content: linesA[ai],
          oldLineNumber: ai + 1,
          newLineNumber: bi + 1,
        });
        ai++;
        bi++;
        li++;
      } else {
        // Addition in B
        diffLines.push({
          type: 'add',
          content: linesB[bi],
          newLineNumber: bi + 1,
        });
        additions++;
        bi++;
      }
    } else if (ai < linesA.length) {
      // Deletion from A
      diffLines.push({
        type: 'delete',
        content: linesA[ai],
        oldLineNumber: ai + 1,
      });
      deletions++;
      ai++;
    } else if (bi < linesB.length) {
      // Addition in B
      diffLines.push({
        type: 'add',
        content: linesB[bi],
        newLineNumber: bi + 1,
      });
      additions++;
      bi++;
    }
  }

  // Group into hunks (for now, single hunk)
  const hunks: DiffHunk[] = [];
  if (diffLines.length > 0) {
    hunks.push({
      oldStart: 1,
      oldLines: linesA.length,
      newStart: 1,
      newLines: linesB.length,
      lines: diffLines,
    });
  }

  return {
    type: 'unified',
    hunks,
    additions,
    deletions,
    changes: additions + deletions,
  };
}

/**
 * Format a CodeDiff as a unified diff string.
 *
 * @param diff - The CodeDiff to format
 * @param fileA - Name/path of the original file (optional)
 * @param fileB - Name/path of the modified file (optional)
 * @returns Unified diff string
 */
export function formatUnifiedDiff(
  diff: CodeDiff,
  fileA = 'a',
  fileB = 'b'
): string {
  const lines: string[] = [];

  lines.push(`--- ${fileA}`);
  lines.push(`+++ ${fileB}`);

  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
      lines.push(`${prefix}${line.content}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// MODULE-LEVEL COMPARISON
// ============================================================================

/**
 * Represents a comparison between two modules.
 */
export interface ModuleComparison {
  /** Path of the first module */
  moduleA: string;
  /** Path of the second module */
  moduleB: string;
  /** Exports that exist in both modules */
  commonExports: string[];
  /** Exports unique to module A */
  uniqueToA: string[];
  /** Exports unique to module B */
  uniqueToB: string[];
  /** Exports with changed signatures */
  changedSignatures: Array<{ name: string; signatureA?: string; signatureB?: string; diff: string }>;
  /** Structural similarity score (0-1) */
  structuralSimilarity: number;
  /** Detailed comparison summary */
  summary: string;
}

/**
 * Compare two modules at the API/export level.
 *
 * Analyzes the exported symbols from each module to identify:
 * - Common exports (same name in both)
 * - Unique exports (only in one module)
 * - Changed signatures (same name, different signature)
 *
 * @param storage - LiBrainian storage instance
 * @param moduleA - Path to the first module
 * @param moduleB - Path to the second module
 * @returns ModuleComparison with detailed analysis
 *
 * @example
 * ```typescript
 * const comparison = await compareModules(
 *   storage,
 *   'src/storage/sqlite_storage.ts',
 *   'src/storage/postgres_storage.ts'
 * );
 * console.log(comparison.commonExports); // ['createStorage', 'getConnection']
 * console.log(comparison.structuralSimilarity); // 0.75
 * ```
 */
export async function compareModules(
  storage: LiBrainianStorage,
  moduleA: string,
  moduleB: string
): Promise<ModuleComparison> {
  // Get functions in each module
  const functionsA = await storage.getFunctionsByPath(moduleA);
  const functionsB = await storage.getFunctionsByPath(moduleB);

  // Build maps of exported functions by name
  const exportsA = new Map<string, FunctionKnowledge>();
  const exportsB = new Map<string, FunctionKnowledge>();

  for (const fn of functionsA) {
    // Consider all top-level functions as exports for comparison
    // In a real implementation, we'd check actual export status
    exportsA.set(fn.name, fn);
  }

  for (const fn of functionsB) {
    exportsB.set(fn.name, fn);
  }

  // Find common, unique, and changed exports
  const commonExports: string[] = [];
  const uniqueToA: string[] = [];
  const uniqueToB: string[] = [];
  const changedSignatures: ModuleComparison['changedSignatures'] = [];

  for (const [name, fnA] of exportsA) {
    if (exportsB.has(name)) {
      commonExports.push(name);
      const fnB = exportsB.get(name)!;
      // Check for signature differences
      if (fnA.signature !== fnB.signature) {
        changedSignatures.push({
          name,
          signatureA: fnA.signature,
          signatureB: fnB.signature,
          diff: `A: ${fnA.signature || 'unknown'} vs B: ${fnB.signature || 'unknown'}`,
        });
      }
    } else {
      uniqueToA.push(name);
    }
  }

  for (const name of exportsB.keys()) {
    if (!exportsA.has(name)) {
      uniqueToB.push(name);
    }
  }

  // Calculate structural similarity
  const totalUnique = Math.max(exportsA.size, exportsB.size, 1);
  const similarity = commonExports.length / totalUnique;

  // Generate summary
  const summaryParts: string[] = [];
  summaryParts.push(`Module comparison: ${moduleA} vs ${moduleB}`);
  summaryParts.push(`Common exports: ${commonExports.length}`);
  if (uniqueToA.length > 0) {
    summaryParts.push(`Unique to A: ${uniqueToA.length} (${uniqueToA.slice(0, 3).join(', ')}${uniqueToA.length > 3 ? '...' : ''})`);
  }
  if (uniqueToB.length > 0) {
    summaryParts.push(`Unique to B: ${uniqueToB.length} (${uniqueToB.slice(0, 3).join(', ')}${uniqueToB.length > 3 ? '...' : ''})`);
  }
  if (changedSignatures.length > 0) {
    summaryParts.push(`Changed signatures: ${changedSignatures.length}`);
  }
  summaryParts.push(`Structural similarity: ${(similarity * 100).toFixed(1)}%`);

  return {
    moduleA,
    moduleB,
    commonExports,
    uniqueToA,
    uniqueToB,
    changedSignatures,
    structuralSimilarity: similarity,
    summary: summaryParts.join('. '),
  };
}

/**
 * Format a module comparison result as a human-readable string.
 *
 * @param comparison - The module comparison to format
 * @returns Formatted string
 */
export function formatModuleComparison(comparison: ModuleComparison): string {
  const lines: string[] = [];

  lines.push(`\n=== Module Comparison ===\n`);
  lines.push(`Module A: ${comparison.moduleA}`);
  lines.push(`Module B: ${comparison.moduleB}`);
  lines.push(`Structural Similarity: ${(comparison.structuralSimilarity * 100).toFixed(1)}%`);
  lines.push('');

  if (comparison.commonExports.length > 0) {
    lines.push('--- Common Exports ---');
    for (const name of comparison.commonExports) {
      lines.push(`  - ${name}`);
    }
    lines.push('');
  }

  if (comparison.uniqueToA.length > 0) {
    lines.push('--- Only in Module A ---');
    for (const name of comparison.uniqueToA) {
      lines.push(`  - ${name}`);
    }
    lines.push('');
  }

  if (comparison.uniqueToB.length > 0) {
    lines.push('--- Only in Module B ---');
    for (const name of comparison.uniqueToB) {
      lines.push(`  - ${name}`);
    }
    lines.push('');
  }

  if (comparison.changedSignatures.length > 0) {
    lines.push('--- Changed Signatures ---');
    for (const change of comparison.changedSignatures) {
      lines.push(`  ${change.name}:`);
      lines.push(`    A: ${change.signatureA || 'unknown'}`);
      lines.push(`    B: ${change.signatureB || 'unknown'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
