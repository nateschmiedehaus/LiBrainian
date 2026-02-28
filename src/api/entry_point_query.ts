/**
 * @fileoverview Entry Point Query Handler
 *
 * Handles queries specifically asking about entry points in the codebase.
 * Entry points include:
 * - Package.json declared entries (main, bin, exports)
 * - Dependency tree roots (modules not imported by anything)
 * - Factory functions (createX, makeX patterns)
 * - CLI entry points
 *
 * This module retrieves indexed entry point data from storage and creates
 * context packs for the query response.
 */

import type { LibrarianStorage } from '../storage/types.js';
import type { ContextPack, LibrarianVersion } from '../types.js';
import {
  ENTRY_POINT_SOURCE_TYPE,
  filterEntryPointItems,
  getEntryPointSummary,
  type EntryPointPayload,
} from '../ingest/entry_point_indexer.js';

// ============================================================================
// TYPES
// ============================================================================

export interface EntryPointQueryStageResult {
  /** Whether any entry point data was found */
  found: boolean;
  /** Context packs containing entry point information */
  packs: ContextPack[];
  /** Human-readable explanation of results */
  explanation: string;
}

// ============================================================================
// ENTRY POINT QUERY STAGE
// ============================================================================

/**
 * Run the entry point query stage.
 *
 * This stage:
 * 1. Retrieves entry point ingestion items from storage
 * 2. Creates context packs from the entry point data
 * 3. Returns packs prioritizing summary and high-confidence entries
 *
 * @param options - Stage options including storage and version
 * @returns Stage result with found flag, packs, and explanation
 */
export async function runEntryPointQueryStage(options: {
  storage: LibrarianStorage;
  version: LibrarianVersion;
}): Promise<EntryPointQueryStageResult> {
  const { storage, version } = options;

  // Retrieve entry point ingestion items
  const items = await storage.getIngestionItems({
    sourceType: ENTRY_POINT_SOURCE_TYPE,
  });

  if (items.length === 0) {
    return {
      found: false,
      packs: [],
      explanation: 'No entry points indexed. Run bootstrap to detect entry points.',
    };
  }

  const packs: ContextPack[] = [];

  // First, add the summary pack if available (highest priority)
  const summaryPayload = getEntryPointSummary(items);
  if (summaryPayload) {
    packs.push(createEntryPointSummaryPack(summaryPayload, version));
  }

  // Then add individual entry point packs, excluding test files.
  // Test file entry points (e.g., src/cli/__tests__/*.test.ts) are indexed as entry
  // points but rarely useful for implementation-seeking queries like "how does X work".
  const entryPoints = filterEntryPointItems(items).filter(ep => {
    const p = (ep.relativePath ?? '').toLowerCase();
    return !p.includes('__tests__') && !p.includes('.test.') && !p.includes('.spec.');
  });

  // Sort by confidence (highest first) and limit to top entries
  const sortedEntryPoints = entryPoints
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  for (const entryPoint of sortedEntryPoints) {
    packs.push(createEntryPointPack(entryPoint, version));
  }

  const kindCounts = countByKind(entryPoints);
  const kindSummary = Object.entries(kindCounts)
    .map(([kind, count]) => `${count} ${kind.replace(/_/g, ' ')}`)
    .join(', ');

  return {
    found: true,
    packs,
    explanation: `Found ${entryPoints.length} entry points: ${kindSummary}.`,
  };
}

// ============================================================================
// CONTEXT PACK BUILDERS
// ============================================================================

/**
 * Create a context pack from the entry points summary.
 */
function createEntryPointSummaryPack(
  payload: EntryPointPayload,
  version: LibrarianVersion
): ContextPack {
  return {
    packId: `entry_point_summary`,
    packType: 'project_understanding',
    targetId: 'entry_points:summary',
    summary: payload.searchText,
    keyFacts: [
      payload.description,
      `Keywords: ${payload.keywords.slice(0, 10).join(', ')}`,
    ],
    codeSnippets: [],
    relatedFiles: [],
    confidence: 0.95, // High confidence for summary
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: ['package.json'],
  };
}

/**
 * Create a context pack from an individual entry point.
 */
function createEntryPointPack(
  payload: EntryPointPayload,
  version: LibrarianVersion
): ContextPack {
  const keyFacts: string[] = [
    `Kind: ${payload.kind.replace(/_/g, ' ')}`,
    `Path: ${payload.relativePath}`,
    payload.description,
  ];

  if (payload.exports.length > 0) {
    keyFacts.push(`Exports: ${payload.exports.slice(0, 5).join(', ')}`);
  }

  return {
    packId: `entry_point:${payload.id}`,
    packType: 'module_context',
    targetId: `entry_point:${payload.path}`,
    summary: `Entry point: ${payload.name} (${payload.kind.replace(/_/g, ' ')})`,
    keyFacts,
    codeSnippets: [],
    relatedFiles: [payload.path],
    confidence: payload.confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [payload.path, 'package.json'],
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Count entry points by kind.
 */
function countByKind(entryPoints: EntryPointPayload[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ep of entryPoints) {
    counts[ep.kind] = (counts[ep.kind] || 0) + 1;
  }
  return counts;
}
