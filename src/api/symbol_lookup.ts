/**
 * @fileoverview Symbol Lookup Integration for Query Pipeline
 *
 * Provides direct symbol lookup capability for the query pipeline.
 * When a query matches the pattern "X class/function/interface/type",
 * this module performs an exact symbol lookup and returns results
 * with 0.99 confidence, bypassing semantic search.
 *
 * This addresses the critical issue where queries like "SqliteLibrarianStorage class"
 * return factory functions instead of the actual class definition.
 *
 * @packageDocumentation
 */

import * as path from 'path';
import { getLanguageFromPath } from '../utils/language.js';
import {
  SymbolTable,
  detectSymbolQuery,
  symbolToContextPack,
  type SymbolEntry,
  type SymbolLookupResult,
  type SymbolQueryPattern,
} from '../constructions/symbol_table.js';
import { SymbolStorage, createSymbolStorage } from '../storage/symbol_storage.js';
import type { ContextPack, CodeSnippet } from '../types.js';
import type { LibrarianStorage } from '../storage/types.js';
import { getCurrentVersion } from './versioning.js';
import * as fs from 'fs/promises';

// ============================================================================
// TYPES
// ============================================================================

export interface SymbolLookupStageResult {
  /** Whether this was a symbol lookup query */
  isSymbolQuery: boolean;

  /** The symbol lookup result (if applicable) */
  lookupResult: SymbolLookupResult | null;

  /** Generated context packs from symbol lookup */
  symbolPacks: ContextPack[];

  /** Explanation of the symbol lookup */
  explanation: string;

  /** Whether to short-circuit and return symbol results */
  shouldShortCircuit: boolean;

  /** Query pattern that was detected (if applicable) */
  pattern: SymbolQueryPattern | null;
}

export interface SymbolLookupOptions {
  /** Workspace root for loading symbols */
  workspaceRoot: string;

  /** The query intent */
  intent: string;

  /** Optional pre-loaded symbol table */
  symbolTable?: SymbolTable;

  /** Minimum confidence to short-circuit */
  minShortCircuitConfidence?: number;

  /**
   * Whether this is a definition query (from query classification).
   * Definition queries should short-circuit even with lower confidence
   * to ensure definitions are returned instead of usages.
   */
  isDefinitionQuery?: boolean;
}

// ============================================================================
// SYMBOL LOOKUP CACHE
// ============================================================================

// In-memory cache for symbol tables to avoid reloading from disk
const symbolTableCache = new Map<string, { table: SymbolTable; loadedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load or get cached symbol table for a workspace.
 */
export async function getSymbolTable(workspaceRoot: string): Promise<SymbolTable | null> {
  const cacheKey = workspaceRoot;
  const cached = symbolTableCache.get(cacheKey);

  // Return cached if still valid
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.table;
  }

  // Try to load from storage
  try {
    const storage = createSymbolStorage(workspaceRoot);
    await storage.initialize();

    const stats = storage.getStats();
    if (stats.totalSymbols === 0) {
      await storage.close();
      return null;
    }

    const table = storage.loadIntoSymbolTable();
    await storage.close();

    // Cache the table
    symbolTableCache.set(cacheKey, { table, loadedAt: Date.now() });

    return table;
  } catch (error) {
    // Symbol storage not available
    return null;
  }
}

/**
 * Clear the symbol table cache for a workspace.
 */
export function clearSymbolTableCache(workspaceRoot?: string): void {
  if (workspaceRoot) {
    symbolTableCache.delete(workspaceRoot);
  } else {
    symbolTableCache.clear();
  }
}

// ============================================================================
// SYMBOL LOOKUP STAGE
// ============================================================================

/**
 * Run the symbol lookup stage of the query pipeline.
 *
 * This stage:
 * 1. Detects if the query is a symbol lookup query
 * 2. If so, performs direct symbol lookup
 * 3. Returns high-confidence results for exact matches
 * 4. Recommends short-circuiting if exact match found
 */
export async function runSymbolLookupStage(
  options: SymbolLookupOptions
): Promise<SymbolLookupStageResult> {
  const {
    workspaceRoot,
    intent,
    minShortCircuitConfidence = 0.95,
    isDefinitionQuery = false
  } = options;

  // Check if this is a symbol query
  const pattern = detectSymbolQuery(intent);
  if (!pattern) {
    return {
      isSymbolQuery: false,
      lookupResult: null,
      symbolPacks: [],
      explanation: '',
      shouldShortCircuit: false,
      pattern: null,
    };
  }

  // Get or load symbol table
  const symbolTable = options.symbolTable ?? (await getSymbolTable(workspaceRoot));
  if (!symbolTable) {
    return {
      isSymbolQuery: true,
      lookupResult: null,
      symbolPacks: [],
      explanation: 'Symbol lookup requested but symbol table not available. Run bootstrap to index symbols.',
      shouldShortCircuit: false,
      pattern,
    };
  }

  // Perform lookup
  const lookupResult = symbolTable.lookup(pattern);

  if (lookupResult.symbols.length === 0) {
    return {
      isSymbolQuery: true,
      lookupResult,
      symbolPacks: [],
      explanation: lookupResult.explanation,
      shouldShortCircuit: false,
      pattern,
    };
  }

  // Generate context packs from symbols
  const symbolPacks = await Promise.all(
    lookupResult.symbols.slice(0, 5).map((symbol) =>
      symbolToFullContextPack(symbol, lookupResult.confidence, workspaceRoot)
    )
  );

  // For definition queries, be more aggressive about short-circuiting.
  // Symbol table results are definitions by design, so if we found matches
  // and the query is asking for definitions, short-circuit even with lower confidence.
  // This ensures "type definitions for X" returns actual definitions, not usages.
  const effectiveMinConfidence = isDefinitionQuery || pattern.isDefinitionQuery
    ? Math.min(0.7, minShortCircuitConfidence) // Lower threshold for definition queries
    : minShortCircuitConfidence;

  const shouldShortCircuit =
    lookupResult.exactMatch && lookupResult.confidence >= effectiveMinConfidence;

  const explanation = shouldShortCircuit
    ? `Direct symbol lookup: ${lookupResult.explanation}`
    : `Symbol lookup (fuzzy): ${lookupResult.explanation}`;

  return {
    isSymbolQuery: true,
    lookupResult,
    symbolPacks,
    explanation,
    shouldShortCircuit,
    pattern,
  };
}

// ============================================================================
// CONTEXT PACK GENERATION
// ============================================================================

/**
 * Convert a symbol entry to a full context pack with code snippet.
 */
async function symbolToFullContextPack(
  symbol: SymbolEntry,
  confidence: number,
  workspaceRoot: string
): Promise<ContextPack> {
  const basicPack = symbolToContextPack(symbol, confidence);

  // Try to read the actual code snippet
  let codeSnippet: CodeSnippet | null = null;
  try {
    const filePath = path.isAbsolute(symbol.file)
      ? symbol.file
      : path.join(workspaceRoot, symbol.file);

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Extract lines around the symbol
    const startLine = Math.max(0, symbol.line - 1);
    const endLine = symbol.endLine
      ? Math.min(lines.length, symbol.endLine + 2)
      : Math.min(lines.length, symbol.line + 30);

    const snippetContent = lines.slice(startLine, endLine).join('\n');

    codeSnippet = {
      filePath: symbol.file,
      content: snippetContent,
      startLine: symbol.line,
      endLine: endLine,
      language: getLanguageFromPath(symbol.file, 'text'),
    };
  } catch (error) {
    // Could not read file, proceed without snippet
  }

  // Build the full context pack
  const pack: ContextPack = {
    packId: basicPack.packId,
    packType: 'symbol_definition',
    targetId: basicPack.targetId,
    summary: basicPack.summary,
    keyFacts: basicPack.keyFacts,
    codeSnippets: codeSnippet ? [codeSnippet] : [],
    confidence,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    relatedFiles: [symbol.file],
    invalidationTriggers: [symbol.file],
    version: getCurrentVersion(),
  };

  return pack;
}

// ============================================================================
// BOOTSTRAP INTEGRATION
// ============================================================================

/**
 * Index symbols during bootstrap.
 * This should be called after parsing TypeScript files.
 */
export async function indexSymbolsDuringBootstrap(
  workspaceRoot: string,
  symbols: SymbolEntry[]
): Promise<{ indexed: number; errors: string[] }> {
  const errors: string[] = [];

  try {
    const storage = createSymbolStorage(workspaceRoot);
    await storage.initialize();

    // Clear existing symbols and insert new ones
    storage.clearAll();
    storage.upsertSymbols(symbols);

    const stats = storage.getStats();
    await storage.close();

    // Clear cache to pick up new symbols
    clearSymbolTableCache(workspaceRoot);

    return {
      indexed: stats.totalSymbols,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Symbol indexing failed: ${message}`);
    return { indexed: 0, errors };
  }
}

/**
 * Get symbol storage stats for a workspace.
 */
export async function getSymbolStats(
  workspaceRoot: string
): Promise<{ available: boolean; totalSymbols: number; byKind: Record<string, number> }> {
  try {
    const storage = createSymbolStorage(workspaceRoot);
    await storage.initialize();

    const stats = storage.getStats();
    await storage.close();

    return {
      available: true,
      totalSymbols: stats.totalSymbols,
      byKind: stats.byKind,
    };
  } catch (error) {
    return {
      available: false,
      totalSymbols: 0,
      byKind: {},
    };
  }
}
