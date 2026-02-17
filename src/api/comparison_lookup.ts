/**
 * @fileoverview Comparison Lookup Integration for Query Pipeline
 *
 * Provides comparison query capability for the query pipeline.
 * When a query matches comparison patterns like "difference between X and Y",
 * "X vs Y", or "compare X and Y", this module performs entity comparison
 * and returns a structured comparison pack.
 *
 * This addresses the critical issue where comparison queries return both
 * entities separately but no actual comparison analysis. Pass rate: 0%.
 *
 * @packageDocumentation
 */

import * as path from 'path';
import { getLanguageFromPath } from '../utils/language.js';
import {
  detectComparisonIntent,
  shouldUseComparisonMode,
  compareEntities,
  createComparisonPack,
  findAndAnalyzeEntity,
  formatComparisonResult,
  type ComparisonIntent,
  type ComparisonResult,
} from '../constructions/comparison.js';
import type { ContextPack, CodeSnippet } from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import { getCurrentVersion } from './versioning.js';
import * as fs from 'fs/promises';

// ============================================================================
// TYPES
// ============================================================================

export interface ComparisonLookupStageResult {
  /** Whether this was a comparison query */
  isComparisonQuery: boolean;

  /** The comparison intent (if detected) */
  intent: ComparisonIntent | null;

  /** The comparison result (if successful) */
  comparisonResult: ComparisonResult | null;

  /** Generated context pack from comparison */
  comparisonPack: ContextPack | null;

  /** Explanation of the comparison lookup */
  explanation: string;

  /** Whether to short-circuit and return comparison results */
  shouldShortCircuit: boolean;

  /** Additional packs for the compared entities (for context) */
  entityPacks: ContextPack[];
}

export interface ComparisonLookupOptions {
  /** Workspace root for loading files */
  workspaceRoot: string;

  /** The query intent */
  intent: string;

  /** Storage for entity lookup */
  storage: LibrarianStorage;

  /** Minimum confidence to short-circuit */
  minShortCircuitConfidence?: number;
}

// ============================================================================
// COMPARISON LOOKUP STAGE
// ============================================================================

/**
 * Run the comparison lookup stage of the query pipeline.
 *
 * This stage:
 * 1. Detects if the query is a comparison query
 * 2. If so, finds both entities being compared
 * 3. Performs structural comparison analysis
 * 4. Generates a comparison pack with similarities/differences
 * 5. Recommends short-circuiting if comparison successful
 */
export async function runComparisonLookupStage(
  options: ComparisonLookupOptions
): Promise<ComparisonLookupStageResult> {
  const { workspaceRoot, intent, storage, minShortCircuitConfidence = 0.7 } = options;

  // Check if this is a comparison query
  const comparisonIntent = detectComparisonIntent(intent);
  if (!comparisonIntent.isComparison) {
    return {
      isComparisonQuery: false,
      intent: null,
      comparisonResult: null,
      comparisonPack: null,
      explanation: '',
      shouldShortCircuit: false,
      entityPacks: [],
    };
  }

  // Perform comparison
  const comparisonResult = await compareEntities(comparisonIntent, storage);

  if (!comparisonResult) {
    return {
      isComparisonQuery: true,
      intent: comparisonIntent,
      comparisonResult: null,
      comparisonPack: null,
      explanation: `Comparison requested between '${comparisonIntent.entityA}' and '${comparisonIntent.entityB}', but one or both entities could not be found.`,
      shouldShortCircuit: false,
      entityPacks: [],
    };
  }

  // Generate the comparison pack
  const comparisonPack = createComparisonPack(comparisonResult, comparisonIntent);

  // Add code snippets for both entities
  const snippets = await loadEntitySnippets(comparisonResult, workspaceRoot);
  if (snippets.length > 0) {
    comparisonPack.codeSnippets = snippets;
  }

  // Generate entity context packs for additional context
  const entityPacks = await generateEntityPacks(comparisonResult, workspaceRoot);

  const shouldShortCircuit = comparisonResult.confidence >= minShortCircuitConfidence;

  const explanation = shouldShortCircuit
    ? `Comparison analysis: ${comparisonResult.summary}`
    : `Partial comparison: ${comparisonResult.summary}`;

  return {
    isComparisonQuery: true,
    intent: comparisonIntent,
    comparisonResult,
    comparisonPack,
    explanation,
    shouldShortCircuit,
    entityPacks,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Load code snippets for both compared entities.
 */
async function loadEntitySnippets(
  result: ComparisonResult,
  workspaceRoot: string
): Promise<CodeSnippet[]> {
  const snippets: CodeSnippet[] = [];

  // Load snippet for entity A
  const snippetA = await loadEntitySnippet(
    result.entityA.filePath,
    result.entityA.startLine,
    result.entityA.endLine,
    workspaceRoot
  );
  if (snippetA) {
    snippets.push(snippetA);
  }

  // Load snippet for entity B (only if in different location)
  if (
    result.entityA.filePath !== result.entityB.filePath ||
    result.entityA.startLine !== result.entityB.startLine
  ) {
    const snippetB = await loadEntitySnippet(
      result.entityB.filePath,
      result.entityB.startLine,
      result.entityB.endLine,
      workspaceRoot
    );
    if (snippetB) {
      snippets.push(snippetB);
    }
  }

  return snippets;
}

/**
 * Load a single code snippet.
 */
async function loadEntitySnippet(
  filePath: string,
  startLine: number,
  endLine: number | undefined,
  workspaceRoot: string
): Promise<CodeSnippet | null> {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);

    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');

    // Extract lines around the entity
    const start = Math.max(0, startLine - 1);
    const end = endLine
      ? Math.min(lines.length, endLine + 2)
      : Math.min(lines.length, startLine + 30);

    const snippetContent = lines.slice(start, end).join('\n');

    return {
      filePath,
      content: snippetContent,
      startLine,
      endLine: end,
      language: getLanguageFromPath(filePath, 'text'),
    };
  } catch {
    return null;
  }
}

/**
 * Generate context packs for the individual entities being compared.
 * These provide additional context beyond the comparison pack itself.
 */
async function generateEntityPacks(
  result: ComparisonResult,
  workspaceRoot: string
): Promise<ContextPack[]> {
  const packs: ContextPack[] = [];
  const version = getCurrentVersion();

  // Pack for entity A
  const packA: ContextPack = {
    packId: `entity:${result.entityA.name}`,
    packType: 'function_context',
    targetId: `${result.entityA.filePath}:${result.entityA.name}`,
    summary: result.entityA.purpose || `${result.entityA.kind} ${result.entityA.name}`,
    keyFacts: [
      `Kind: ${result.entityA.kind}`,
      `File: ${result.entityA.filePath}:${result.entityA.startLine}`,
    ],
    codeSnippets: [],
    confidence: 0.85,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    relatedFiles: [result.entityA.filePath],
    invalidationTriggers: [result.entityA.filePath],
    version,
  };

  if (result.entityA.signature) {
    packA.keyFacts.push(`Signature: ${result.entityA.signature}`);
  }

  packs.push(packA);

  // Pack for entity B
  const packB: ContextPack = {
    packId: `entity:${result.entityB.name}`,
    packType: 'function_context',
    targetId: `${result.entityB.filePath}:${result.entityB.name}`,
    summary: result.entityB.purpose || `${result.entityB.kind} ${result.entityB.name}`,
    keyFacts: [
      `Kind: ${result.entityB.kind}`,
      `File: ${result.entityB.filePath}:${result.entityB.startLine}`,
    ],
    codeSnippets: [],
    confidence: 0.85,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    relatedFiles: [result.entityB.filePath],
    invalidationTriggers: [result.entityB.filePath],
    version,
  };

  if (result.entityB.signature) {
    packB.keyFacts.push(`Signature: ${result.entityB.signature}`);
  }

  packs.push(packB);

  return packs;
}

// ============================================================================
// EXPORTS FOR QUERY PIPELINE INTEGRATION
// ============================================================================

export {
  detectComparisonIntent,
  shouldUseComparisonMode,
  formatComparisonResult,
} from '../constructions/comparison.js';
