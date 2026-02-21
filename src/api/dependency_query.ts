/**
 * @fileoverview Dependency Query Handler
 *
 * Handles structural queries like "what imports X" and "what depends on Y"
 * by traversing the actual graph edges instead of relying on semantic search.
 *
 * This module addresses a critical gap: when agents ask about dependencies/imports,
 * the system should use the indexed import graph, not semantic similarity.
 *
 * Example queries this handles:
 * - "What imports utils.ts?" -> Find all files with 'imports' edges TO utils.ts
 * - "What depends on LiBrainianStorage?" -> Find all entities that import/call it
 * - "What does query.ts import?" -> Find all 'imports' edges FROM query.ts
 * - "What files call this function?" -> Find all 'calls' edges TO the function
 */

import type { LiBrainianStorage, GraphEdgeQueryOptions } from '../storage/types.js';
import type { GraphEdge, GraphEntityType, GraphEdgeType, FunctionKnowledge } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Direction of dependency traversal.
 * - 'dependents': What depends ON X? (find edges TO X)
 * - 'dependencies': What does X depend on? (find edges FROM X)
 */
export type DependencyDirection = 'dependents' | 'dependencies';

/**
 * Result of parsing a structural query.
 */
export interface StructuralQueryIntent {
  /** Whether this query is structural (dependency/import related) */
  isStructural: boolean;
  /** The direction of dependency traversal */
  direction: DependencyDirection;
  /** The target entity name/path extracted from the query */
  targetEntity: string | null;
  /** The types of edges to traverse */
  edgeTypes: GraphEdgeType[];
  /** Confidence in this classification (0-1) */
  confidence: number;
  /** The specific pattern that matched */
  matchedPattern: string | null;
}

/**
 * A resolved dependency from graph traversal.
 */
export interface ResolvedDependency {
  /** The entity ID (file path or function/module ID) */
  entityId: string;
  /** The entity type */
  entityType: GraphEntityType;
  /** The type of edge that connects them */
  edgeType: GraphEdgeType;
  /** The source file of the edge */
  sourceFile: string;
  /** Line number if available */
  sourceLine: number | null;
  /** Confidence from the edge */
  confidence: number;
  /** Depth from target (1 = direct, 2+ = transitive). Only present in exhaustive results. */
  depth?: number;
}

/**
 * Result of a dependency graph traversal.
 */
export interface DependencyQueryResult {
  /** The query intent that was parsed */
  intent: StructuralQueryIntent;
  /** The dependencies/dependents found */
  results: ResolvedDependency[];
  /** How the target was resolved */
  targetResolution: {
    originalQuery: string;
    resolvedPath: string | null;
    resolvedEntityId: string | null;
    alternativeMatches: string[];
  };
  /** Explanation for the user */
  explanation: string;
}

// ============================================================================
// QUERY INTENT PATTERNS
// ============================================================================

/**
 * Patterns that indicate a query about what DEPENDS ON something.
 * These look for edges pointing TO the target.
 */
const DEPENDENT_PATTERNS = [
  // "What imports X?"
  { pattern: /\bwhat\s+(?:files?\s+)?imports?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "What uses X?"
  { pattern: /\bwhat\s+(?:files?\s+)?uses?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports', 'calls'] as GraphEdgeType[] },
  // "What depends on X?"
  { pattern: /\bwhat\s+(?:files?\s+)?depends?\s+on\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports', 'calls'] as GraphEdgeType[] },
  // "What calls X?"
  { pattern: /\bwhat\s+(?:files?\s+|functions?\s+)?calls?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['calls'] as GraphEdgeType[] },
  // "What extends X?"
  { pattern: /\bwhat\s+(?:classes?\s+)?extends?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['extends'] as GraphEdgeType[] },
  // "What implements X?"
  { pattern: /\bwhat\s+(?:classes?\s+)?implements?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['implements'] as GraphEdgeType[] },
  // "Show dependents of X" / "List dependents of X"
  { pattern: /\b(?:show|list|find|get)\s+(?:all\s+)?dependents?\s+(?:of|for)\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports', 'calls'] as GraphEdgeType[] },
  // "Show me the callers of X" / "Show the callers of X"
  { pattern: /\b(?:show|list|find|get)\s+(?:me\s+)?(?:the\s+)?callers?\s+(?:of|for)\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['calls'] as GraphEdgeType[] },
  // "Files that import X"
  { pattern: /\b(?:files?|modules?)\s+that\s+imports?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "(All) files that depend on X"
  { pattern: /\b(?:all\s+)?(?:files?|modules?)\s+that\s+depends?\s+on\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports', 'calls'] as GraphEdgeType[] },
  // "Who imports X?" (informal)
  { pattern: /\bwho\s+imports?\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "Reverse dependencies of X"
  { pattern: /\breverse\s+dependenc(?:y|ies)\s+(?:of|for)\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports', 'calls'] as GraphEdgeType[] },
];

/**
 * Patterns that indicate a query about what something DEPENDS ON.
 * These look for edges pointing FROM the target.
 */
const DEPENDENCY_PATTERNS = [
  // "What does X import?"
  { pattern: /\bwhat\s+does\s+(.+?)\s+imports?\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "What does X depend on?"
  { pattern: /\bwhat\s+does\s+(.+?)\s+depend\s+on\s*\??$/i, edgeTypes: ['imports', 'calls'] as GraphEdgeType[] },
  // "What does X call?"
  { pattern: /\bwhat\s+does\s+(.+?)\s+calls?\s*\??$/i, edgeTypes: ['calls'] as GraphEdgeType[] },
  // "Dependencies of X" / "Show dependencies of X"
  { pattern: /\b(?:show|list|find|get)?\s*(?:all\s+)?dependenc(?:y|ies)\s+(?:of|for)\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "X's dependencies"
  { pattern: /\b(.+?)(?:'s|s')\s+dependenc(?:y|ies)\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "Imports in X" / "Imports of X"
  { pattern: /\bimports?\s+(?:in|of|for)\s+(?:the\s+)?(.+?)\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
  // "What X imports"
  { pattern: /\bwhat\s+(.+?)\s+imports?\s*\??$/i, edgeTypes: ['imports'] as GraphEdgeType[] },
];

// ============================================================================
// QUERY CLASSIFICATION
// ============================================================================

/**
 * Parse a query intent to determine if it's a structural dependency query.
 *
 * @param intent - The user's query string
 * @returns Parsed structural query intent
 *
 * @example
 * ```typescript
 * const parsed = parseStructuralQueryIntent("What imports utils.ts?");
 * // { isStructural: true, direction: 'dependents', targetEntity: 'utils.ts', ... }
 * ```
 */
export function parseStructuralQueryIntent(intent: string): StructuralQueryIntent {
  if (!intent || typeof intent !== 'string') {
    return {
      isStructural: false,
      direction: 'dependents',
      targetEntity: null,
      edgeTypes: [],
      confidence: 0,
      matchedPattern: null,
    };
  }

  const trimmedIntent = intent.trim();

  // Check dependent patterns first (more common: "what imports X?")
  for (const { pattern, edgeTypes } of DEPENDENT_PATTERNS) {
    const match = trimmedIntent.match(pattern);
    if (match && match[1]) {
      return {
        isStructural: true,
        direction: 'dependents',
        targetEntity: cleanTargetEntity(match[1]),
        edgeTypes,
        confidence: 0.9,
        matchedPattern: pattern.source,
      };
    }
  }

  // Check dependency patterns ("what does X import?")
  for (const { pattern, edgeTypes } of DEPENDENCY_PATTERNS) {
    const match = trimmedIntent.match(pattern);
    if (match && match[1]) {
      return {
        isStructural: true,
        direction: 'dependencies',
        targetEntity: cleanTargetEntity(match[1]),
        edgeTypes,
        confidence: 0.9,
        matchedPattern: pattern.source,
      };
    }
  }

  // Check for generic dependency keywords with lower confidence
  const lowerIntent = trimmedIntent.toLowerCase();
  const hasKeywords = /\b(import|depend|call|use|extend|implement)\b/i.test(lowerIntent) &&
                      /\b(what|which|who|show|list|find|get)\b/i.test(lowerIntent);

  if (hasKeywords) {
    // Try to extract a target from quotes or file extensions
    const quotedMatch = trimmedIntent.match(/["']([^"']+)["']/);
    const fileMatch = trimmedIntent.match(/\b(\w+\.\w+)\b/);
    const targetEntity = quotedMatch?.[1] || fileMatch?.[1] || null;

    return {
      isStructural: true,
      direction: 'dependents', // Default to more common case
      targetEntity,
      edgeTypes: ['imports', 'calls'],
      confidence: 0.6,
      matchedPattern: 'keyword_heuristic',
    };
  }

  return {
    isStructural: false,
    direction: 'dependents',
    targetEntity: null,
    edgeTypes: [],
    confidence: 0,
    matchedPattern: null,
  };
}

/**
 * Clean a target entity name extracted from a query.
 */
function cleanTargetEntity(target: string): string {
  return target
    .trim()
    .replace(/^["']|["']$/g, '') // Remove quotes
    .replace(/[?.!]+$/g, '') // Remove trailing punctuation
    .replace(/^(?:the|this|that|a|an)\s+/i, '') // Remove articles
    .trim();
}

// ============================================================================
// GRAPH TRAVERSAL
// ============================================================================

/**
 * Execute a dependency query by traversing the graph edges.
 *
 * @param storage - The storage backend with graph edges
 * @param intent - The parsed structural query intent
 * @param originalQuery - The original query string for reporting
 * @returns The dependency query result with resolved entities
 *
 * @example
 * ```typescript
 * const intent = parseStructuralQueryIntent("What imports utils.ts?");
 * const result = await executeDependencyQuery(storage, intent, "What imports utils.ts?");
 * // result.results contains all files that import utils.ts
 * ```
 */
export async function executeDependencyQuery(
  storage: LiBrainianStorage,
  intent: StructuralQueryIntent,
  originalQuery: string
): Promise<DependencyQueryResult> {
  const targetResolution = await resolveTargetEntity(storage, intent.targetEntity);

  if (!targetResolution.resolvedPath && !targetResolution.resolvedEntityId) {
    return {
      intent,
      results: [],
      targetResolution: {
        originalQuery,
        ...targetResolution,
      },
      explanation: intent.targetEntity
        ? `Could not resolve "${intent.targetEntity}" to a known entity in the codebase.`
        : 'No target entity specified in the query.',
    };
  }

  // Build the query options based on direction
  const queryOptions: GraphEdgeQueryOptions = {
    edgeTypes: intent.edgeTypes.length > 0 ? intent.edgeTypes : undefined,
    limit: 200, // Reasonable limit for most queries
  };

  if (intent.direction === 'dependents') {
    // Looking for edges pointing TO the target
    // If we have a resolved path, search by file path
    if (targetResolution.resolvedPath) {
      // For imports, the toId is usually the file path or module path
      queryOptions.toIds = [
        targetResolution.resolvedPath,
        // Also try common variations
        targetResolution.resolvedPath.replace(/\.ts$/, ''),
        targetResolution.resolvedPath.replace(/\.js$/, ''),
        `${targetResolution.resolvedPath}/index`,
        targetResolution.resolvedPath.replace(/\/index\.(ts|js)$/, ''),
      ].filter((v, i, a) => a.indexOf(v) === i); // Dedupe
    }
    if (targetResolution.resolvedEntityId) {
      queryOptions.toIds = [
        ...(queryOptions.toIds || []),
        targetResolution.resolvedEntityId,
      ];
    }
  } else {
    // Looking for edges pointing FROM the target
    if (targetResolution.resolvedPath) {
      queryOptions.sourceFiles = [targetResolution.resolvedPath];
      queryOptions.fromIds = [
        targetResolution.resolvedPath,
        targetResolution.resolvedPath.replace(/\.ts$/, ''),
        targetResolution.resolvedPath.replace(/\.js$/, ''),
      ].filter((v, i, a) => a.indexOf(v) === i);
    }
    if (targetResolution.resolvedEntityId) {
      queryOptions.fromIds = [
        ...(queryOptions.fromIds || []),
        targetResolution.resolvedEntityId,
      ];
    }
  }

  const edges = await storage.getGraphEdges(queryOptions);

  // Convert edges to resolved dependencies
  const results: ResolvedDependency[] = edges.map((edge) => ({
    entityId: intent.direction === 'dependents' ? edge.fromId : edge.toId,
    entityType: intent.direction === 'dependents' ? edge.fromType : edge.toType,
    edgeType: edge.edgeType,
    sourceFile: edge.sourceFile,
    sourceLine: edge.sourceLine ?? null,
    confidence: edge.confidence,
  }));

  // Deduplicate by entityId
  const seen = new Set<string>();
  const dedupedResults = results.filter((r) => {
    if (seen.has(r.entityId)) return false;
    seen.add(r.entityId);
    return true;
  });

  const explanation = buildExplanation(intent, dedupedResults.length, targetResolution);

  return {
    intent,
    results: dedupedResults,
    targetResolution: {
      originalQuery,
      ...targetResolution,
    },
    explanation,
  };
}

/**
 * Resolve a target entity name to a file path or entity ID.
 */
async function resolveTargetEntity(
  storage: LiBrainianStorage,
  targetEntity: string | null
): Promise<{
  resolvedPath: string | null;
  resolvedEntityId: string | null;
  alternativeMatches: string[];
}> {
  if (!targetEntity) {
    return { resolvedPath: null, resolvedEntityId: null, alternativeMatches: [] };
  }

  const cleanedTarget = targetEntity.toLowerCase();
  const alternativeMatches: string[] = [];

  // Try to find a direct function match by name first (most efficient)
  // This uses an indexed lookup rather than iterating through all functions
  const storageWithNameLookup = storage as typeof storage & {
    getFunctionsByName?: (name: string) => Promise<FunctionKnowledge[]>;
  };
  if (storageWithNameLookup.getFunctionsByName) {
    const functionsByName = await storageWithNameLookup.getFunctionsByName(targetEntity);
    if (functionsByName.length > 0) {
      // Return the first match (if multiple, they're overloads/duplicates)
      const fn = functionsByName[0];
      return { resolvedPath: fn.filePath, resolvedEntityId: fn.id, alternativeMatches };
    }
  }

  // Try to find an exact module match
  const modules = await storage.getModules({ limit: 500 });
  for (const mod of modules) {
    const modPath = mod.path.toLowerCase();
    const modName = modPath.split('/').pop() || '';

    // Exact match
    if (modPath === cleanedTarget || modPath.endsWith(`/${cleanedTarget}`)) {
      return { resolvedPath: mod.path, resolvedEntityId: mod.id, alternativeMatches };
    }

    // Name match (without extension)
    if (modName === cleanedTarget || modName.replace(/\.\w+$/, '') === cleanedTarget.replace(/\.\w+$/, '')) {
      return { resolvedPath: mod.path, resolvedEntityId: mod.id, alternativeMatches };
    }

    // Partial match for alternatives
    if (modPath.includes(cleanedTarget) || cleanedTarget.includes(modName.replace(/\.\w+$/, ''))) {
      alternativeMatches.push(mod.path);
    }
  }

  // Try to find a function match by iterating (fallback if getFunctionsByName not available)
  const functions = await storage.getFunctions({ limit: 500 });
  for (const fn of functions) {
    const fnName = fn.name.toLowerCase();
    const fnPath = fn.filePath.toLowerCase();

    if (fnName === cleanedTarget) {
      return { resolvedPath: fn.filePath, resolvedEntityId: fn.id, alternativeMatches };
    }

    if (fnPath.endsWith(`/${cleanedTarget}`) || fnPath.endsWith(`/${cleanedTarget}.ts`) || fnPath.endsWith(`/${cleanedTarget}.js`)) {
      return { resolvedPath: fn.filePath, resolvedEntityId: fn.id, alternativeMatches };
    }
  }

  // If we have alternatives, return the most specific one
  if (alternativeMatches.length > 0) {
    // Sort by specificity (shorter paths are more specific)
    alternativeMatches.sort((a, b) => a.length - b.length);
    const bestMatch = alternativeMatches[0];
    const matchingModule = modules.find((m) => m.path === bestMatch);
    return {
      resolvedPath: bestMatch,
      resolvedEntityId: matchingModule?.id ?? null,
      alternativeMatches: alternativeMatches.slice(1, 5),
    };
  }

  // Last resort: use the target as-is (might be a relative path)
  return {
    resolvedPath: targetEntity.includes('/') || targetEntity.includes('.') ? targetEntity : null,
    resolvedEntityId: null,
    alternativeMatches,
  };
}

/**
 * Build a human-readable explanation of the query results.
 */
function buildExplanation(
  intent: StructuralQueryIntent,
  resultCount: number,
  targetResolution: { resolvedPath: string | null; alternativeMatches: string[] }
): string {
  const directionText = intent.direction === 'dependents'
    ? 'depend on'
    : 'are depended on by';

  const edgeText = intent.edgeTypes.length === 1
    ? intent.edgeTypes[0]
    : intent.edgeTypes.join('/');

  if (resultCount === 0) {
    if (!targetResolution.resolvedPath) {
      return `Could not find "${intent.targetEntity}" in the codebase.${
        targetResolution.alternativeMatches.length > 0
          ? ` Did you mean: ${targetResolution.alternativeMatches.slice(0, 3).join(', ')}?`
          : ''
      }`;
    }
    return `No ${edgeText} edges found that ${directionText} "${targetResolution.resolvedPath}".`;
  }

  return `Found ${resultCount} ${edgeText} edge${resultCount !== 1 ? 's' : ''} ` +
    `${intent.direction === 'dependents' ? 'pointing to' : 'from'} "${targetResolution.resolvedPath ?? intent.targetEntity}".`;
}

// ============================================================================
// EXHAUSTIVE QUERY SUPPORT
// ============================================================================

/**
 * Execute an exhaustive dependency query that returns ALL dependents.
 *
 * Unlike the standard query which limits to 200 results, this traverses
 * the entire dependency graph. Critical for refactoring scenarios.
 *
 * @param storage - The storage backend with graph edges
 * @param intent - The parsed structural query intent
 * @param options - Exhaustive query options
 * @returns Complete list of all dependents
 *
 * @example
 * ```typescript
 * const intent = parseStructuralQueryIntent("What depends on SqliteLiBrainianStorage?");
 * const result = await executeExhaustiveDependencyQuery(storage, intent, {
 *   includeTransitive: true,
 *   maxDepth: 5,
 * });
 * // result.results contains ALL 208 files, not just top 200
 * ```
 */
export async function executeExhaustiveDependencyQuery(
  storage: LiBrainianStorage,
  intent: StructuralQueryIntent,
  options: {
    includeTransitive?: boolean;
    maxDepth?: number;
    onProgress?: (count: number) => void;
  } = {}
): Promise<DependencyQueryResult & { isExhaustive: true; transitiveCount: number }> {
  const { includeTransitive = false, maxDepth = 10, onProgress } = options;
  const targetResolution = await resolveTargetEntity(storage, intent.targetEntity);

  if (!targetResolution.resolvedPath && !targetResolution.resolvedEntityId) {
    return {
      intent,
      results: [],
      targetResolution: {
        originalQuery: intent.targetEntity ?? '',
        ...targetResolution,
      },
      explanation: intent.targetEntity
        ? `Could not resolve "${intent.targetEntity}" to a known entity in the codebase.`
        : 'No target entity specified in the query.',
      isExhaustive: true,
      transitiveCount: 0,
    };
  }

  // Track all visited entities for exhaustive traversal
  const visited = new Map<string, ResolvedDependency & { depth: number }>();
  const queue: Array<{ entityId: string; depth: number }> = [];

  // Initialize with target entity variations
  const targetIds: string[] = [];
  if (targetResolution.resolvedPath) {
    targetIds.push(
      targetResolution.resolvedPath,
      targetResolution.resolvedPath.replace(/\.ts$/, ''),
      targetResolution.resolvedPath.replace(/\.js$/, ''),
    );
  }
  if (targetResolution.resolvedEntityId) {
    targetIds.push(targetResolution.resolvedEntityId);
  }

  // Get ALL edges without limit for exhaustive mode
  const queryOptions: GraphEdgeQueryOptions = {
    edgeTypes: intent.edgeTypes.length > 0 ? intent.edgeTypes : undefined,
  };

  if (intent.direction === 'dependents') {
    queryOptions.toIds = targetIds;
  } else {
    queryOptions.fromIds = targetIds;
  }

  // Get initial direct edges
  const directEdges = await storage.getGraphEdges(queryOptions);

  // Add direct dependents to visited
  for (const edge of directEdges) {
    const entityId = intent.direction === 'dependents' ? edge.fromId : edge.toId;
    const entityType = intent.direction === 'dependents' ? edge.fromType : edge.toType;

    if (!visited.has(entityId)) {
      const dep: ResolvedDependency & { depth: number } = {
        entityId,
        entityType,
        edgeType: edge.edgeType,
        sourceFile: edge.sourceFile,
        sourceLine: edge.sourceLine ?? null,
        confidence: edge.confidence,
        depth: 1,
      };
      visited.set(entityId, dep);

      if (includeTransitive) {
        queue.push({ entityId, depth: 1 });
      }

      onProgress?.(visited.size);
    }
  }

  // BFS for transitive dependencies
  while (includeTransitive && queue.length > 0) {
    const { entityId, depth } = queue.shift()!;

    if (depth >= maxDepth) continue;

    // Get edges for this entity
    const nextQueryOptions: GraphEdgeQueryOptions = {
      edgeTypes: intent.edgeTypes.length > 0 ? intent.edgeTypes : undefined,
    };

    if (intent.direction === 'dependents') {
      nextQueryOptions.toIds = [entityId];
    } else {
      nextQueryOptions.fromIds = [entityId];
    }

    const nextEdges = await storage.getGraphEdges(nextQueryOptions);

    for (const edge of nextEdges) {
      const nextEntityId = intent.direction === 'dependents' ? edge.fromId : edge.toId;
      const nextEntityType = intent.direction === 'dependents' ? edge.fromType : edge.toType;

      if (!visited.has(nextEntityId)) {
        const dep: ResolvedDependency & { depth: number } = {
          entityId: nextEntityId,
          entityType: nextEntityType,
          edgeType: edge.edgeType,
          sourceFile: edge.sourceFile,
          sourceLine: edge.sourceLine ?? null,
          confidence: edge.confidence,
          depth: depth + 1,
        };
        visited.set(nextEntityId, dep);
        queue.push({ entityId: nextEntityId, depth: depth + 1 });

        onProgress?.(visited.size);
      }
    }
  }

  const results = Array.from(visited.values()).sort((a, b) => {
    // Sort by depth first, then by entityId
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.entityId.localeCompare(b.entityId);
  });

  const directCount = results.filter(r => r.depth === 1).length;
  const transitiveCount = results.filter(r => r.depth > 1).length;

  const explanation = buildExhaustiveExplanation(
    intent,
    results.length,
    directCount,
    transitiveCount,
    targetResolution,
    includeTransitive
  );

  return {
    intent,
    results,
    targetResolution: {
      originalQuery: intent.targetEntity ?? '',
      ...targetResolution,
    },
    explanation,
    isExhaustive: true,
    transitiveCount,
  };
}

/**
 * Build explanation for exhaustive query results.
 */
function buildExhaustiveExplanation(
  intent: StructuralQueryIntent,
  totalCount: number,
  directCount: number,
  transitiveCount: number,
  targetResolution: { resolvedPath: string | null },
  includeTransitive: boolean
): string {
  const targetName = targetResolution.resolvedPath ?? intent.targetEntity;

  if (totalCount === 0) {
    return `No entities found that ${intent.direction === 'dependents' ? 'depend on' : 'are depended on by'} "${targetName}".`;
  }

  const edgeText = intent.edgeTypes.length === 1
    ? intent.edgeTypes[0]
    : intent.edgeTypes.join('/');

  let explanation = `EXHAUSTIVE: Found ${totalCount} entities with ${edgeText} edges ` +
    `${intent.direction === 'dependents' ? 'depending on' : 'depended on by'} "${targetName}"`;

  if (includeTransitive && transitiveCount > 0) {
    explanation += ` (${directCount} direct, ${transitiveCount} transitive)`;
  }

  explanation += '.';
  return explanation;
}

// ============================================================================
// INTEGRATION WITH QUERY PIPELINE
// ============================================================================

/**
 * Check if a query should be handled by graph traversal instead of semantic search.
 *
 * @param intent - The user's query intent string
 * @returns True if this query should prioritize graph traversal
 */
export function shouldUseGraphTraversal(intent: string): boolean {
  const parsed = parseStructuralQueryIntent(intent);
  return parsed.isStructural && parsed.confidence >= 0.6;
}

/**
 * Check if a query requires exhaustive enumeration (all dependents, not just top-k).
 *
 * @param intent - The user's query intent string
 * @returns True if this query should use exhaustive mode
 */
export function shouldUseExhaustiveMode(intent: string): boolean {
  const lowerIntent = intent.toLowerCase();

  // Explicit exhaustive keywords
  // NOTE: "refactor" alone should NOT trigger exhaustive mode.
  // Only refactor queries that imply impact analysis or enumeration need exhaustive mode.
  // - "refactoring opportunities" -> semantic query, NOT exhaustive
  // - "how to refactor this code" -> how-to query, NOT exhaustive
  // - "what would break if I refactor X" -> impact analysis, EXHAUSTIVE
  // - "list all files to refactor" -> enumeration, EXHAUSTIVE
  const exhaustivePatterns = [
    /\ball\b.*\b(depend|import|use|call)/i,
    /\bevery\b.*\b(depend|import|use|call)/i,
    /\bcomplete\s+list/i,
    /\bfull\s+list/i,
    /\bexhaustive/i,
    /\btransitive/i,
    // Refactor with impact analysis context (break, affect, impact, change)
    /\b(break|affect|impact|change).*\brefactor/i,
    /\brefactor.*\b(break|affect|impact|what\s+would)/i,
    // Refactor with enumeration context (all, list, every, files to)
    /\b(all|list|every)\b.*\brefactor/i,
    /\brefactor.*\b(all|list|every)\b/i,
    /\bbreaking\s+change\s+analysis/i,             // "breaking change analysis"
    /\bbreaking\s+change.*\b(if|when|would)\b/i,  // "what would be breaking changes if..."
    /\bwhat\s+breaks\s+if/i,                       // "what breaks if I change X"
    /\bimpact\s+analysis/i,
    /\btotal\s+count/i,
    /\bhow\s+many\b.*\b(depend|import|use)/i,
  ];

  return exhaustivePatterns.some(pattern => pattern.test(lowerIntent));
}

/**
 * Merge graph traversal results into the candidate pool.
 * Graph results get a significant boost since they are structurally accurate.
 *
 * @param graphResults - Results from graph traversal
 * @param existingCandidates - Existing semantic search candidates
 * @returns Merged candidate array with graph results boosted
 */
export function mergeGraphResultsWithCandidates<T extends { entityId: string; score?: number }>(
  graphResults: ResolvedDependency[],
  existingCandidates: T[]
): T[] {
  const existingIds = new Set(existingCandidates.map((c) => c.entityId));

  // Create synthetic candidates from graph results
  // These get a high score since they are structurally accurate
  const graphCandidates = graphResults
    .filter((r) => !existingIds.has(r.entityId))
    .map((r) => ({
      entityId: r.entityId,
      entityType: r.entityType,
      path: r.sourceFile,
      semanticSimilarity: 0.5, // Neutral semantic score
      confidence: r.confidence,
      recency: 0.5,
      pagerank: 0.5,
      centrality: 0.5,
      communityId: null,
      // High score for structural matches
      score: 0.85 + (r.confidence * 0.1), // 0.85-0.95 range
    })) as unknown as T[];

  // Boost existing candidates that appear in graph results
  const graphEntityIds = new Set(graphResults.map((r) => r.entityId));
  const boostedExisting = existingCandidates.map((c) => {
    if (graphEntityIds.has(c.entityId)) {
      return {
        ...c,
        score: Math.min(1.0, (c.score ?? 0.5) + 0.3), // Significant boost
      };
    }
    return c;
  });

  // Combine: graph results first, then boosted existing
  return [...graphCandidates, ...boostedExisting];
}
