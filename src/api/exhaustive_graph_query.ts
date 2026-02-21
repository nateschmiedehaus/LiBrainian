/**
 * @fileoverview Exhaustive Graph Query Module
 *
 * Provides complete dependency enumeration for refactoring scenarios.
 * Unlike semantic search which returns top-k matches, this module
 * traverses the entire dependency graph to find ALL dependents.
 *
 * Use cases:
 * - "What depends on SqliteLiBrainianStorage" -> Returns ALL 208 files
 * - "Everything that imports src/storage/types.ts" -> Complete list
 * - "Transitive dependents of the auth module" -> Full dependency tree
 *
 * @example
 * ```typescript
 * const result = await queryExhaustiveDependents(storage, {
 *   targetId: 'src/storage/types.ts',
 *   targetName: 'SqliteLiBrainianStorage',
 *   includeTransitive: true,
 *   edgeTypes: ['imports', 'calls'],
 * });
 * console.log(`Found ${result.totalCount} dependents`);
 * ```
 */

import type { LiBrainianStorage, GraphEdgeQueryOptions } from '../storage/types.js';
import type { GraphEdge, GraphEdgeType, GraphEntityType } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for exhaustive dependency queries.
 */
export interface ExhaustiveQueryOptions {
  /**
   * Target entity ID (file path, module ID, or function ID).
   * This is what we're finding dependents OF.
   */
  targetId: string;

  /**
   * Optional target name for symbol-level queries.
   * When specified, filters edges to only those referencing this symbol.
   * Example: 'SqliteLiBrainianStorage' within 'src/storage/sqlite_storage.ts'
   */
  targetName?: string;

  /**
   * Include transitive dependents (A imports B imports C -> A depends on C).
   * Default: false (direct dependents only)
   */
  includeTransitive?: boolean;

  /**
   * Maximum depth for transitive traversal.
   * Default: 10 (prevents runaway traversal on cyclic graphs)
   */
  maxDepth?: number;

  /**
   * Edge types to follow during traversal.
   * Default: ['imports', 'calls'] (most common for refactoring)
   */
  edgeTypes?: GraphEdgeType[];

  /**
   * Entity types to include in results.
   * Default: all types
   */
  entityTypes?: GraphEntityType[];

  /**
   * Direction of dependency traversal.
   * - 'dependents': Find entities that depend ON the target (who imports this?)
   * - 'dependencies': Find entities the target depends ON (what does this import?)
   * Default: 'dependents'
   */
  direction?: 'dependents' | 'dependencies';

  /**
   * Include cycle detection and reporting.
   * Default: true
   */
  detectCycles?: boolean;

  /**
   * Progress callback for long-running queries.
   */
  onProgress?: (progress: ExhaustiveQueryProgress) => void;
}

/**
 * Progress information for long-running exhaustive queries.
 */
export interface ExhaustiveQueryProgress {
  /** Current traversal depth */
  currentDepth: number;
  /** Entities discovered so far */
  entitiesFound: number;
  /** Entities remaining in queue */
  queueSize: number;
  /** Current entity being processed */
  currentEntity?: string;
}

/**
 * A single dependent entity in the result set.
 */
export interface DependentEntity {
  /** Entity ID (file path or entity identifier) */
  entityId: string;
  /** Entity type (file, module, function) */
  entityType: GraphEntityType;
  /** File path if available */
  filePath?: string;
  /** Depth from target (1 = direct, 2+ = transitive) */
  depth: number;
  /** Edge type that creates this dependency */
  edgeType: GraphEdgeType;
  /** Confidence of this edge */
  confidence: number;
  /** Path from target to this entity (for transitive) */
  path: string[];
  /** Source line where dependency occurs */
  sourceLine?: number | null;
}

/**
 * Cycle detected during traversal.
 */
export interface DependencyCycle {
  /** Entities involved in the cycle */
  entities: string[];
  /** Edge types in the cycle */
  edgeTypes: GraphEdgeType[];
  /** Cycle length */
  length: number;
}

/**
 * Result of an exhaustive dependency query.
 */
export interface ExhaustiveQueryResult {
  /** Target entity that was queried */
  targetId: string;
  /** Target name if specified */
  targetName?: string;
  /** Query direction */
  direction: 'dependents' | 'dependencies';
  /** All discovered dependent entities */
  dependents: DependentEntity[];
  /** Total count of dependents */
  totalCount: number;
  /** Count of direct dependents (depth=1) */
  directCount: number;
  /** Count of transitive dependents (depth>1) */
  transitiveCount: number;
  /** Maximum depth reached */
  maxDepthReached: number;
  /** Cycles detected during traversal */
  cycles: DependencyCycle[];
  /** Files grouped by directory for easier navigation */
  byDirectory: Map<string, DependentEntity[]>;
  /** Statistics about the query */
  stats: {
    /** Total edges traversed */
    edgesTraversed: number;
    /** Query duration in milliseconds */
    durationMs: number;
    /** Whether the query was truncated due to limits */
    truncated: boolean;
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_EDGE_TYPES: GraphEdgeType[] = ['imports', 'calls'];
const MAX_ENTITIES_LIMIT = 10000; // Safety limit to prevent OOM

// ============================================================================
// MAIN QUERY FUNCTION
// ============================================================================

/**
 * Query all entities that depend on (or are depended on by) a target entity.
 *
 * This performs a complete graph traversal, returning ALL dependents rather
 * than a semantic sample. Critical for refactoring scenarios where missing
 * even one dependent can cause breakage.
 *
 * @param storage - Storage backend with graph edge data
 * @param options - Query options
 * @returns Complete list of dependent entities with metadata
 */
export async function queryExhaustiveDependents(
  storage: LiBrainianStorage,
  options: ExhaustiveQueryOptions
): Promise<ExhaustiveQueryResult> {
  const startTime = Date.now();

  const {
    targetId,
    targetName,
    includeTransitive = false,
    maxDepth = DEFAULT_MAX_DEPTH,
    edgeTypes = DEFAULT_EDGE_TYPES,
    entityTypes,
    direction = 'dependents',
    detectCycles = true,
    onProgress,
  } = options;

  // Track visited entities to avoid duplicates and detect cycles
  const visited = new Map<string, DependentEntity>();
  const cycles: DependencyCycle[] = [];
  let edgesTraversed = 0;
  let truncated = false;

  // BFS queue: [entityId, depth, path]
  const queue: Array<{ id: string; depth: number; path: string[]; edgeType: GraphEdgeType }> = [];

  // Initialize with direct edges from/to target
  const initialEdges = await getEdgesForDirection(storage, targetId, direction, {
    edgeTypes,
    targetName,
  });

  edgesTraversed += initialEdges.length;

  for (const edge of initialEdges) {
    const entityId = direction === 'dependents' ? edge.fromId : edge.toId;
    queue.push({
      id: entityId,
      depth: 1,
      path: [targetId, entityId],
      edgeType: edge.edgeType,
    });
  }

  // BFS traversal
  while (queue.length > 0) {
    // Safety check
    if (visited.size >= MAX_ENTITIES_LIMIT) {
      truncated = true;
      break;
    }

    const { id, depth, path, edgeType } = queue.shift()!;

    // Skip if already visited
    if (visited.has(id)) {
      // Cycle detection
      if (detectCycles && path.includes(id)) {
        const cycleStart = path.indexOf(id);
        cycles.push({
          entities: path.slice(cycleStart),
          edgeTypes: [edgeType], // Simplified; could track full edge path
          length: path.length - cycleStart,
        });
      }
      continue;
    }

    // Get edge info for this entity
    const edge = initialEdges.find(e =>
      (direction === 'dependents' ? e.fromId : e.toId) === id
    ) || await findEdgeForEntity(storage, targetId, id, direction, edgeTypes);

    // Create dependent entity record
    const dependent: DependentEntity = {
      entityId: id,
      entityType: edge?.fromType || 'file',
      filePath: extractFilePath(id, edge),
      depth,
      edgeType: edgeType,
      confidence: edge?.confidence ?? 0.5,
      path,
      sourceLine: edge?.sourceLine,
    };

    // Filter by entity type if specified
    if (entityTypes && !entityTypes.includes(dependent.entityType)) {
      continue;
    }

    visited.set(id, dependent);

    // Report progress
    if (onProgress) {
      onProgress({
        currentDepth: depth,
        entitiesFound: visited.size,
        queueSize: queue.length,
        currentEntity: id,
      });
    }

    // Continue traversal if transitive is enabled and within depth limit
    if (includeTransitive && depth < maxDepth) {
      const nextEdges = await getEdgesForDirection(storage, id, direction, {
        edgeTypes,
      });

      edgesTraversed += nextEdges.length;

      for (const nextEdge of nextEdges) {
        const nextId = direction === 'dependents' ? nextEdge.fromId : nextEdge.toId;
        if (!visited.has(nextId)) {
          queue.push({
            id: nextId,
            depth: depth + 1,
            path: [...path, nextId],
            edgeType: nextEdge.edgeType,
          });
        }
      }
    }
  }

  // Build result
  const dependents = Array.from(visited.values());
  const directCount = dependents.filter(d => d.depth === 1).length;
  const transitiveCount = dependents.filter(d => d.depth > 1).length;
  const maxDepthReached = Math.max(0, ...dependents.map(d => d.depth));

  // Group by directory
  const byDirectory = new Map<string, DependentEntity[]>();
  for (const dep of dependents) {
    const dir = extractDirectory(dep.filePath || dep.entityId);
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, []);
    }
    byDirectory.get(dir)!.push(dep);
  }

  // Sort dependents by depth then by path
  dependents.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.entityId.localeCompare(b.entityId);
  });

  return {
    targetId,
    targetName,
    direction,
    dependents,
    totalCount: dependents.length,
    directCount,
    transitiveCount,
    maxDepthReached,
    cycles,
    byDirectory,
    stats: {
      edgesTraversed,
      durationMs: Date.now() - startTime,
      truncated,
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get edges for a given direction (dependents = who imports this, dependencies = what this imports).
 */
async function getEdgesForDirection(
  storage: LiBrainianStorage,
  entityId: string,
  direction: 'dependents' | 'dependencies',
  options: { edgeTypes?: GraphEdgeType[]; targetName?: string }
): Promise<GraphEdge[]> {
  const { edgeTypes, targetName } = options;

  const queryOptions: GraphEdgeQueryOptions = {
    edgeTypes,
  };

  if (direction === 'dependents') {
    // Find edges where this entity is the TARGET (someone imports/calls this)
    queryOptions.toIds = [entityId];
  } else {
    // Find edges where this entity is the SOURCE (this imports/calls something)
    queryOptions.fromIds = [entityId];
  }

  // Also search by file path since edges might reference file paths
  const edges = await storage.getGraphEdges(queryOptions);

  // If we have a file path, also search for edges referencing the file
  if (!entityId.includes(':')) {
    const fileQueryOptions: GraphEdgeQueryOptions = {
      ...queryOptions,
      sourceFiles: [entityId],
    };
    delete fileQueryOptions.toIds;
    delete fileQueryOptions.fromIds;

    const fileEdges = await storage.getGraphEdges(fileQueryOptions);
    const seen = new Set(edges.map(e => `${e.fromId}->${e.toId}`));
    for (const edge of fileEdges) {
      const key = `${edge.fromId}->${edge.toId}`;
      if (!seen.has(key)) {
        edges.push(edge);
        seen.add(key);
      }
    }
  }

  // Filter by target name if specified (for symbol-level queries)
  if (targetName) {
    return edges.filter(edge => {
      const targetEntity = direction === 'dependents' ? edge.toId : edge.fromId;
      return targetEntity.includes(targetName) ||
             edge.sourceFile?.includes(targetName) ||
             entityId.includes(targetName);
    });
  }

  return edges;
}

/**
 * Find the specific edge connecting source and target.
 */
async function findEdgeForEntity(
  storage: LiBrainianStorage,
  targetId: string,
  entityId: string,
  direction: 'dependents' | 'dependencies',
  edgeTypes?: GraphEdgeType[]
): Promise<GraphEdge | undefined> {
  const queryOptions: GraphEdgeQueryOptions = {
    edgeTypes,
    limit: 1,
  };

  if (direction === 'dependents') {
    queryOptions.fromIds = [entityId];
    queryOptions.toIds = [targetId];
  } else {
    queryOptions.fromIds = [targetId];
    queryOptions.toIds = [entityId];
  }

  const edges = await storage.getGraphEdges(queryOptions);
  return edges[0];
}

/**
 * Extract file path from entity ID or edge.
 */
function extractFilePath(entityId: string, edge?: GraphEdge): string | undefined {
  if (edge?.sourceFile) {
    return edge.sourceFile;
  }

  // If entityId looks like a file path, use it
  if (entityId.includes('/') && (entityId.endsWith('.ts') || entityId.endsWith('.js') || entityId.includes('.'))) {
    return entityId;
  }

  // If entityId is in format "file:function", extract file
  if (entityId.includes(':')) {
    return entityId.split(':')[0];
  }

  return undefined;
}

/**
 * Extract directory from file path.
 */
function extractDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) return '.';
  return filePath.substring(0, lastSlash);
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Find all files that import a given file or module.
 *
 * @example
 * ```typescript
 * const importers = await findAllImporters(storage, 'src/storage/types.ts');
 * console.log(`${importers.length} files import types.ts`);
 * ```
 */
export async function findAllImporters(
  storage: LiBrainianStorage,
  targetPath: string,
  options?: { includeTransitive?: boolean; maxDepth?: number }
): Promise<ExhaustiveQueryResult> {
  return queryExhaustiveDependents(storage, {
    targetId: targetPath,
    direction: 'dependents',
    edgeTypes: ['imports'],
    includeTransitive: options?.includeTransitive ?? false,
    maxDepth: options?.maxDepth,
  });
}

/**
 * Find all files that call functions from a given module.
 *
 * @example
 * ```typescript
 * const callers = await findAllCallers(storage, 'src/api/query.ts', 'queryLiBrainian');
 * console.log(`${callers.length} files call queryLiBrainian`);
 * ```
 */
export async function findAllCallers(
  storage: LiBrainianStorage,
  targetPath: string,
  functionName?: string,
  options?: { includeTransitive?: boolean; maxDepth?: number }
): Promise<ExhaustiveQueryResult> {
  return queryExhaustiveDependents(storage, {
    targetId: targetPath,
    targetName: functionName,
    direction: 'dependents',
    edgeTypes: ['calls'],
    includeTransitive: options?.includeTransitive ?? false,
    maxDepth: options?.maxDepth,
  });
}

/**
 * Find all dependencies of a given file (what it imports/uses).
 *
 * @example
 * ```typescript
 * const deps = await findAllDependencies(storage, 'src/api/librainian.ts');
 * console.log(`librainian.ts depends on ${deps.length} other files`);
 * ```
 */
export async function findAllDependencies(
  storage: LiBrainianStorage,
  sourcePath: string,
  options?: { includeTransitive?: boolean; maxDepth?: number }
): Promise<ExhaustiveQueryResult> {
  return queryExhaustiveDependents(storage, {
    targetId: sourcePath,
    direction: 'dependencies',
    edgeTypes: ['imports', 'calls'],
    includeTransitive: options?.includeTransitive ?? false,
    maxDepth: options?.maxDepth,
  });
}

/**
 * Get complete transitive closure of dependencies (all files that would be
 * affected by changing the target).
 *
 * @example
 * ```typescript
 * const affected = await getTransitiveClosure(storage, 'src/core/types.ts');
 * console.log(`Changing types.ts affects ${affected.length} files transitively`);
 * ```
 */
export async function getTransitiveClosure(
  storage: LiBrainianStorage,
  targetPath: string,
  options?: { maxDepth?: number; edgeTypes?: GraphEdgeType[] }
): Promise<ExhaustiveQueryResult> {
  return queryExhaustiveDependents(storage, {
    targetId: targetPath,
    direction: 'dependents',
    edgeTypes: options?.edgeTypes ?? ['imports', 'calls', 'extends', 'implements'],
    includeTransitive: true,
    maxDepth: options?.maxDepth ?? 10,
    detectCycles: true,
  });
}

// ============================================================================
// INTENT DETECTION
// ============================================================================

/**
 * Patterns that indicate an exhaustive dependency query is needed.
 *
 * NOTE: "refactor" alone should NOT trigger exhaustive mode.
 * Only refactor queries that imply impact analysis or enumeration need exhaustive mode.
 * - "refactoring opportunities" -> semantic query, NOT exhaustive
 * - "how to refactor this code" -> how-to query, NOT exhaustive
 * - "what would break if I refactor X" -> impact analysis, EXHAUSTIVE
 * - "list all files to refactor" -> enumeration, EXHAUSTIVE
 */
const EXHAUSTIVE_INTENT_PATTERNS = [
  // "all/every/complete/full" + file/module patterns
  /\b(all|every)\s+\w*\s*(that\s+)?(depend|import|use|call)/i,
  /\b(complete|full)\s+(list|set)/i,
  // "what/who depends/imports" patterns
  /\bwhat\s+(depends|imports|uses|calls)\s+/i,
  /\bwho\s+(depends|imports|uses|calls)\s+/i,
  // "everything that" patterns
  /\beverything\s+that\s+(depends|imports|uses|calls)/i,
  // List commands
  /\blist\s+(all\s+)?(dependencies|dependents|importers|callers)/i,
  /\bfind\s+(all\s+)?(files|modules)\s+(that\s+)?(depend|import)/i,
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
  // Transitive/exhaustive keywords
  /\btransitive/i,
  /\bexhaustive/i,
  // Count queries
  /\bhow\s+many\b.*\b(depend|import|use|call)/i,
  /\btotal\s+count/i,
];

/**
 * Detect if a query intent requires exhaustive enumeration.
 *
 * @param intent - User query string
 * @returns true if exhaustive mode should be used
 */
export function detectExhaustiveIntent(intent: string): boolean {
  return EXHAUSTIVE_INTENT_PATTERNS.some(pattern => pattern.test(intent));
}

/**
 * Extract target entity from exhaustive query intent.
 *
 * @example
 * ```typescript
 * const target = extractTargetFromIntent('What depends on SqliteLiBrainianStorage');
 * // Returns: { name: 'SqliteLiBrainianStorage', type: 'symbol' }
 * ```
 */
export function extractTargetFromIntent(intent: string): {
  name?: string;
  path?: string;
  type: 'symbol' | 'file' | 'module' | 'unknown';
} {
  // Pattern: "depends on <target>"
  const dependsOnMatch = intent.match(/depends?\s+on\s+['"]?([^\s'"]+)['"]?/i);
  if (dependsOnMatch) {
    return categorizeTarget(dependsOnMatch[1]);
  }

  // Pattern: "imports <target>"
  const importsMatch = intent.match(/imports?\s+['"]?([^\s'"]+)['"]?/i);
  if (importsMatch) {
    return categorizeTarget(importsMatch[1]);
  }

  // Pattern: "uses <target>"
  const usesMatch = intent.match(/uses?\s+['"]?([^\s'"]+)['"]?/i);
  if (usesMatch) {
    return categorizeTarget(usesMatch[1]);
  }

  // Pattern: file path
  const pathMatch = intent.match(/(['"]?[a-zA-Z0-9_\-./]+\.(ts|js|tsx|jsx)['"]?)/);
  if (pathMatch) {
    return { path: pathMatch[1].replace(/['"]/g, ''), type: 'file' };
  }

  return { type: 'unknown' };
}

function categorizeTarget(target: string): {
  name?: string;
  path?: string;
  type: 'symbol' | 'file' | 'module' | 'unknown';
} {
  // File path
  if (target.includes('/') || target.match(/\.(ts|js|tsx|jsx)$/)) {
    return { path: target, type: 'file' };
  }

  // PascalCase = likely a class/type name
  if (/^[A-Z][a-zA-Z0-9]*$/.test(target)) {
    return { name: target, type: 'symbol' };
  }

  // camelCase with multiple parts = likely a function
  if (/^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(target)) {
    return { name: target, type: 'symbol' };
  }

  // Module-like path (no extension but has slashes)
  if (target.includes('/') && !target.includes('.')) {
    return { path: target, type: 'module' };
  }

  return { name: target, type: 'unknown' };
}

// ============================================================================
// RESULT FORMATTING
// ============================================================================

/**
 * Format exhaustive query result for display.
 */
export function formatExhaustiveResult(result: ExhaustiveQueryResult): string {
  const lines: string[] = [];

  lines.push(`\n=== Exhaustive Dependency Query ===`);
  lines.push(`Target: ${result.targetId}${result.targetName ? ` (${result.targetName})` : ''}`);
  lines.push(`Direction: ${result.direction === 'dependents' ? 'What depends on this' : 'What this depends on'}`);
  lines.push(`\nFound ${result.totalCount} ${result.direction}:`);
  lines.push(`  - Direct: ${result.directCount}`);
  lines.push(`  - Transitive: ${result.transitiveCount}`);
  lines.push(`  - Max depth: ${result.maxDepthReached}`);

  if (result.cycles.length > 0) {
    lines.push(`\n⚠️  ${result.cycles.length} dependency cycle(s) detected`);
  }

  if (result.stats.truncated) {
    lines.push(`\n⚠️  Results truncated (limit: ${MAX_ENTITIES_LIMIT})`);
  }

  lines.push(`\nBy Directory:`);
  const sortedDirs = Array.from(result.byDirectory.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [dir, deps] of sortedDirs.slice(0, 20)) {
    lines.push(`  ${dir}/ (${deps.length} files)`);
    for (const dep of deps.slice(0, 5)) {
      const depthIndicator = dep.depth > 1 ? ` [depth=${dep.depth}]` : '';
      lines.push(`    - ${dep.filePath || dep.entityId}${depthIndicator}`);
    }
    if (deps.length > 5) {
      lines.push(`    ... and ${deps.length - 5} more`);
    }
  }

  if (sortedDirs.length > 20) {
    lines.push(`  ... and ${sortedDirs.length - 20} more directories`);
  }

  lines.push(`\nStats:`);
  lines.push(`  - Edges traversed: ${result.stats.edgesTraversed}`);
  lines.push(`  - Duration: ${result.stats.durationMs}ms`);

  return lines.join('\n');
}

/**
 * Convert result to a simple list of file paths (for tool integration).
 */
export function toFileList(result: ExhaustiveQueryResult): string[] {
  return result.dependents
    .map(d => d.filePath || d.entityId)
    .filter((path): path is string => !!path);
}
