/**
 * @fileoverview Symbol Table Construction for Direct Symbol Lookup
 *
 * This construction provides direct symbol -> location lookup capability,
 * enabling queries like "SqliteLibrarianStorage class" to return the exact
 * class definition at the correct line number with 0.99 confidence.
 *
 * PROBLEM SOLVED:
 * - Queries for classes, interfaces, types, constants return factory functions
 * - Current system only indexes functions, not other symbol types
 * - Symbol lookup pass rate: 0%
 *
 * SOLUTION:
 * - SymbolTable with exact and fuzzy name matching
 * - Indexes ALL TypeScript symbols: classes, interfaces, types, constants, enums
 * - Direct integration with query pipeline for high-confidence results
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * The kind of symbol being indexed.
 * Covers all major TypeScript declaration types.
 */
export type SymbolKind =
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'const'
  | 'enum'
  | 'variable'
  | 'namespace'
  | 'method'
  | 'property'
  | 'getter'
  | 'setter'
  | 're-export'
  | 'barrel-export'
  | 'default-export';

/**
 * Visibility modifier for class members.
 */
export type MemberVisibility = 'public' | 'protected' | 'private';

/**
 * An entry in the symbol table representing a single code symbol.
 */
export interface SymbolEntry {
  /** The symbol name (e.g., "SqliteLibrarianStorage") */
  name: string;

  /** The kind of symbol */
  kind: SymbolKind;

  /** Absolute path to the file containing the symbol */
  file: string;

  /** Line number where the symbol is defined (1-indexed) */
  line: number;

  /** End line number for multi-line definitions */
  endLine?: number;

  /** Optional signature for functions/methods */
  signature?: string;

  /** Whether the symbol is exported */
  exported: boolean;

  /** Optional JSDoc summary or description */
  description?: string;

  /** Qualified name including module path (e.g., "storage/sqlite_storage:SqliteLibrarianStorage") */
  qualifiedName?: string;

  /** Parent class or interface name for members (methods, properties) */
  parent?: string;

  /** Visibility modifier for class members */
  visibility?: MemberVisibility;

  /** Whether the member is static */
  isStatic?: boolean;

  /** Whether the function/method is async */
  isAsync?: boolean;

  /** Parameters for methods/functions */
  parameters?: string[];

  // ============================================================================
  // RE-EXPORT AND MODULE FIELDS
  // ============================================================================

  /** Original name before aliasing (for re-exports like `export { X as Y }`) */
  originalName?: string;

  /** Source module for re-exports (e.g., './module' in `export { X } from './module'`) */
  fromModule?: string;

  // ============================================================================
  // NAMESPACE FIELDS
  // ============================================================================

  /** Namespace containing this symbol (for namespace members like `MyNamespace.SomeType`) */
  namespace?: string;

  // ============================================================================
  // DECORATOR FIELDS
  // ============================================================================

  /** Decorators applied to this symbol (e.g., ['Component', 'Injectable']) */
  decorators?: string[];
}

/**
 * Result from a symbol lookup query.
 */
export interface SymbolLookupResult {
  /** The matching symbols */
  symbols: SymbolEntry[];

  /** Confidence in the result (0.99 for exact match) */
  confidence: number;

  /** Whether this was an exact name match */
  exactMatch: boolean;

  /** Explanation of how the match was found */
  explanation: string;
}

/**
 * Query patterns that indicate a symbol lookup request.
 */
export interface SymbolQueryPattern {
  /** The symbol name to look up */
  symbolName: string;

  /** The expected symbol kind (if specified in query) */
  expectedKind?: SymbolKind;

  /** Whether the query explicitly mentions definition/declaration */
  isDefinitionQuery: boolean;
}

// ============================================================================
// SYMBOL QUERY DETECTION
// ============================================================================

/**
 * Patterns for detecting symbol lookup queries.
 * These match queries like:
 * - "SqliteLibrarianStorage class"
 * - "bootstrapProject function"
 * - "LibrarianStorage interface"
 * - "Where is the SymbolEntry type defined?"
 */
const SYMBOL_QUERY_PATTERNS: Array<{
  pattern: RegExp;
  kindExtractor?: (match: RegExpMatchArray) => SymbolKind | undefined;
  nameGroup: number;
  isBare?: boolean;
}> = [
  // "X class/function/interface/type/const/enum"
  {
    pattern: /^(\w+)\s+(class|function|interface|type|const|enum|constant)$/i,
    kindExtractor: (m) => normalizeKind(m[2]),
    nameGroup: 1,
  },
  // "class/function/interface X"
  {
    pattern: /^(class|function|interface|type|const|enum)\s+(\w+)$/i,
    kindExtractor: (m) => normalizeKind(m[1]),
    nameGroup: 2,
  },
  // "the X class/function/interface"
  {
    pattern: /^the\s+(\w+)\s+(class|function|interface|type|const|enum)$/i,
    kindExtractor: (m) => normalizeKind(m[2]),
    nameGroup: 1,
  },
  // "where is X defined" / "X definition" (requires explicit definition keyword)
  {
    pattern: /^where\s+is\s+(?:the\s+)?(\w+)(?:\s+defined)?$/i,
    nameGroup: 1,
  },
  // "X definition" or "X class/function/interface definition"
  {
    pattern: /^(\w+)\s+(?:(class|function|interface|type|const|enum)\s+)?definition$/i,
    kindExtractor: (m) => (m[2] ? normalizeKind(m[2]) : undefined),
    nameGroup: 1,
  },
  // "find X" / "locate X" / "show X"
  {
    pattern: /^(?:find|locate|show|get)\s+(?:the\s+)?(\w+)(?:\s+(class|function|interface|type))?$/i,
    kindExtractor: (m) => (m[2] ? normalizeKind(m[2]) : undefined),
    nameGroup: 1,
  },
  // "type/interface definitions for X" / "type definitions of X"
  {
    pattern: /^(?:type|interface)\s+definitions?\s+(?:for|of)\s+(\w+)$/i,
    nameGroup: 1,
    // Will search all kinds (interface and type)
  },
  // "X type/interface definition"
  {
    pattern: /^(\w+)\s+(?:type|interface)\s+definition$/i,
    nameGroup: 1,
  },
  // "ContextPack interface" / "LibrarianStorage type"
  {
    pattern: /^(\w+)\s+(interface|type)$/i,
    kindExtractor: (m) => normalizeKind(m[2]),
    nameGroup: 1,
  },
  // "definition of X" / "definition for X"
  {
    pattern: /^definition\s+(?:of|for)\s+(\w+)$/i,
    nameGroup: 1,
  },
  // "where is X interface/type defined"
  {
    pattern: /^where\s+is\s+(?:the\s+)?(\w+)\s+(?:interface|type)(?:\s+defined)?$/i,
    nameGroup: 1,
	  },
	  // Bare symbol name (for fuzzy matching as fallback)
	  // This is intentionally permissive for quick lookups like "SqliteLibrarianStorage"
	  // but we apply extra heuristics in parseSymbolQuery() to avoid routing generic
	  // single-word intents (e.g., "bootstrap") into symbol lookup.
	  {
	    pattern: /^(\w+)$/,
	    nameGroup: 1,
	    isBare: true,
	  },
	];

/**
 * Normalize kind string from query to SymbolKind.
 */
function normalizeKind(kind: string): SymbolKind | undefined {
  const lower = kind.toLowerCase();
  switch (lower) {
    case 'class':
      return 'class';
    case 'function':
    case 'func':
    case 'fn':
      return 'function';
    case 'interface':
      return 'interface';
    case 'type':
    case 'typedef':
      return 'type';
    case 'const':
    case 'constant':
      return 'const';
    case 'enum':
    case 'enumeration':
      return 'enum';
    case 'var':
    case 'variable':
      return 'variable';
    case 'namespace':
    case 'module':
      return 'namespace';
    case 'method':
      return 'method';
    case 'property':
    case 'prop':
      return 'property';
    case 'getter':
    case 'get':
      return 'getter';
    case 'setter':
    case 'set':
      return 'setter';
    case 're-export':
    case 'reexport':
      return 're-export';
    case 'barrel-export':
    case 'barrel':
      return 'barrel-export';
    case 'default-export':
    case 'default':
      return 'default-export';
    default:
      return undefined;
  }
}

/**
 * Parse a query string to extract symbol lookup parameters.
 * Returns null if the query is not a symbol lookup query.
 */
export function parseSymbolQuery(query: string): SymbolQueryPattern | null {
  const trimmed = query.trim();

  // Reject queries that are too long (likely semantic queries)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 6) {
    return null;
  }

  // Check for definition-related keywords
  const isDefinitionQuery =
    /\bdefinitions?\b|\bdefined\b|\bdeclared\b|\bwhere\s+is\b/i.test(trimmed);

  for (const { pattern, kindExtractor, nameGroup, isBare } of SYMBOL_QUERY_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const symbolName = match[nameGroup];
      // Skip if the symbol name is too short or is a common word
      if (symbolName.length < 2 || isCommonWord(symbolName)) {
        continue;
      }
      // Bare one-word queries are often intents rather than symbol lookups.
      // Allow bare symbols, but block "command-like" verbs that create noisy routing.
      if (isBare && isBareSymbolStopWord(symbolName)) {
        continue;
      }
      return {
        symbolName,
        expectedKind: kindExtractor?.(match),
        isDefinitionQuery,
      };
    }
  }

  return null;
}

/**
 * Check if a word is too common to be a symbol name.
 */
function isCommonWord(word: string): boolean {
  const common = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'or',
    'and',
    'not',
    'this',
    'that',
    'it',
    'as',
    'if',
    'when',
    'what',
    'how',
    'why',
    'where',
    'which',
    'who',
    'all',
    'each',
    'every',
    'both',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'nor',
    'only',
    'own',
    'same',
    'so',
    'than',
    'too',
    'very',
    'just',
    'also',
    'now',
    'here',
    'there',
    'then',
    'once',
    'any',
    'get',
    'find',
    'show',
    'locate',
    'work',
    'works',
    'system',
    'middleware',
    'authentication',
    'about',
    'use',
    'used',
    'using',
    'make',
    'made',
    'does',
    'done',
  ]);
  return common.has(word.toLowerCase());
}

/**
 * Stopwords for bare single-token queries.
 *
 * These are common in agent intents ("bootstrap", "watch", "query") but rarely
 * indicate a request to locate a symbol definition by name.
 *
 * IMPORTANT: This should only be applied to the "bare symbol" pattern.
 * Explicit symbol queries like "bootstrap function" must still work.
 */
function isBareSymbolStopWord(word: string): boolean {
  const stop = new Set([
    'bootstrap',
    'initialize',
    'init',
    'start',
    'run',
    'watch',
    'query',
    'index',
    'status',
    'health',
    'compose',
    'contract',
  ]);
  return stop.has(word.toLowerCase());
}

// ============================================================================
// MATCH COUNT PENALTY
// ============================================================================

/**
 * Calculate confidence penalty based on the number of symbol matches.
 * High match counts indicate ambiguous queries that should have lower confidence.
 *
 * @param matchCount - Number of symbols matching the query
 * @returns Penalty to subtract from base confidence [0, 0.45]
 */
export function calculateMatchCountPenalty(matchCount: number): number {
  if (matchCount <= 1) return 0;        // Single match: no penalty
  if (matchCount <= 5) return 0.05;     // Few matches: small penalty
  if (matchCount <= 20) return 0.15;    // Moderate: medium penalty
  if (matchCount <= 100) return 0.30;   // Many: significant penalty
  return 0.45;                          // Very many (>100): large penalty
}

// ============================================================================
// SYMBOL TABLE CLASS
// ============================================================================

/**
 * SymbolTable provides direct symbol -> location lookup.
 *
 * The symbol table is populated during bootstrap by the SymbolExtractor,
 * which parses TypeScript ASTs to extract all symbol declarations.
 *
 * @example
 * ```typescript
 * const table = new SymbolTable();
 * table.addSymbol({
 *   name: 'SqliteLibrarianStorage',
 *   kind: 'class',
 *   file: 'src/storage/sqlite_storage.ts',
 *   line: 225,
 *   exported: true,
 * });
 *
 * const result = table.findByExactName('SqliteLibrarianStorage');
 * // [{ name: 'SqliteLibrarianStorage', kind: 'class', line: 225, ... }]
 * ```
 */
export class SymbolTable {
  /** Primary index: exact name -> entries */
  private readonly byName: Map<string, SymbolEntry[]> = new Map();

  /** Secondary index: lowercase name -> entries (for case-insensitive lookup) */
  private readonly byNameLower: Map<string, SymbolEntry[]> = new Map();

  /** Index by file path for efficient file-scoped queries */
  private readonly byFile: Map<string, SymbolEntry[]> = new Map();

  /** Index by kind for type-filtered queries */
  private readonly byKind: Map<SymbolKind, SymbolEntry[]> = new Map();

  /**
   * Add a symbol to the table.
   * Creates indices for efficient lookup.
   */
  addSymbol(entry: SymbolEntry): void {
    // By exact name
    const existing = this.byName.get(entry.name) ?? [];
    existing.push(entry);
    this.byName.set(entry.name, existing);

    // By lowercase name (case-insensitive)
    const lower = entry.name.toLowerCase();
    const existingLower = this.byNameLower.get(lower) ?? [];
    existingLower.push(entry);
    this.byNameLower.set(lower, existingLower);

    // By file
    const byFileEntries = this.byFile.get(entry.file) ?? [];
    byFileEntries.push(entry);
    this.byFile.set(entry.file, byFileEntries);

    // By kind
    const byKindEntries = this.byKind.get(entry.kind) ?? [];
    byKindEntries.push(entry);
    this.byKind.set(entry.kind, byKindEntries);
  }

  /**
   * Add multiple symbols to the table.
   */
  addSymbols(entries: SymbolEntry[]): void {
    for (const entry of entries) {
      this.addSymbol(entry);
    }
  }

  /**
   * Find symbols by exact name match.
   * Returns all symbols with the given name (there may be duplicates across files).
   */
  findByExactName(name: string): SymbolEntry[] {
    return this.byName.get(name) ?? [];
  }

  /**
   * Find symbols by case-insensitive exact name match.
   */
  findByExactNameIgnoreCase(name: string): SymbolEntry[] {
    return this.byNameLower.get(name.toLowerCase()) ?? [];
  }

  /**
   * Find symbols by exact name and kind.
   * Most precise lookup for queries like "SqliteLibrarianStorage class".
   */
  findByExactNameAndKind(name: string, kind: SymbolKind): SymbolEntry[] {
    const byName = this.byName.get(name) ?? [];
    return byName.filter((e) => e.kind === kind);
  }

  /**
   * Find symbols by fuzzy name match.
   * Uses substring matching for partial queries.
   */
  findByFuzzyName(partial: string): SymbolEntry[] {
    const lower = partial.toLowerCase();
    const results: SymbolEntry[] = [];

    for (const [name, entries] of this.byNameLower) {
      // Check if the name contains the partial string
      if (name.includes(lower)) {
        results.push(...entries);
      }
    }

    // Sort by relevance: exact match first, then by name length (shorter = more relevant)
    return results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === lower ? 0 : 1;
      const bExact = b.name.toLowerCase() === lower ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.name.length - b.name.length;
    });
  }

  /**
   * Find symbols by fuzzy name and kind.
   */
  findByFuzzyNameAndKind(partial: string, kind: SymbolKind): SymbolEntry[] {
    const fuzzy = this.findByFuzzyName(partial);
    return fuzzy.filter((e) => e.kind === kind);
  }

  /**
   * Find all symbols in a file.
   */
  findByFile(filePath: string): SymbolEntry[] {
    return this.byFile.get(filePath) ?? [];
  }

  /**
   * Find all symbols of a specific kind.
   */
  findByKind(kind: SymbolKind): SymbolEntry[] {
    return this.byKind.get(kind) ?? [];
  }

  /**
   * Get all symbols in the table.
   */
  getAllSymbols(): SymbolEntry[] {
    const all: SymbolEntry[] = [];
    for (const entries of this.byName.values()) {
      all.push(...entries);
    }
    return all;
  }

  /**
   * Get the total count of symbols.
   */
  getSymbolCount(): number {
    let count = 0;
    for (const entries of this.byName.values()) {
      count += entries.length;
    }
    return count;
  }

  /**
   * Get count by kind for statistics.
   */
  getCountByKind(): Record<SymbolKind, number> {
    const counts: Record<SymbolKind, number> = {
      class: 0,
      function: 0,
      interface: 0,
      type: 0,
      const: 0,
      enum: 0,
      variable: 0,
      namespace: 0,
      method: 0,
      property: 0,
      getter: 0,
      setter: 0,
      're-export': 0,
      'barrel-export': 0,
      'default-export': 0,
    };

    for (const [kind, entries] of this.byKind) {
      counts[kind] = entries.length;
    }

    return counts;
  }

  /**
   * Clear all symbols from the table.
   */
  clear(): void {
    this.byName.clear();
    this.byNameLower.clear();
    this.byFile.clear();
    this.byKind.clear();
  }

  /**
   * Perform a symbol lookup based on a parsed query pattern.
   * Returns a lookup result with confidence and explanation.
   *
   * Confidence is now penalized based on match count:
   * - Single exact match: 0.99 (no penalty)
   * - Few matches (2-5): small penalty
   * - Many matches (>100): large penalty (up to 0.45)
   *
   * This addresses the issue where ambiguous queries like "config" or "storage"
   * with hundreds of matches were incorrectly reported with 0.95 confidence.
   */
  lookup(pattern: SymbolQueryPattern): SymbolLookupResult {
    const { symbolName, expectedKind } = pattern;

    // Try exact match first
    let symbols: SymbolEntry[];
    let exactMatch = true;

    if (expectedKind) {
      // Exact name + kind
      symbols = this.findByExactNameAndKind(symbolName, expectedKind);
      if (symbols.length === 0) {
        // Try case-insensitive
        symbols = this.findByExactNameIgnoreCase(symbolName).filter(
          (e) => e.kind === expectedKind
        );
      }
      if (symbols.length === 0) {
        // Fallback to fuzzy
        symbols = this.findByFuzzyNameAndKind(symbolName, expectedKind);
        exactMatch = false;
      }
    } else {
      // Exact name only
      symbols = this.findByExactName(symbolName);
      if (symbols.length === 0) {
        // Try case-insensitive
        symbols = this.findByExactNameIgnoreCase(symbolName);
      }
      if (symbols.length === 0) {
        // Fallback to fuzzy
        symbols = this.findByFuzzyName(symbolName);
        exactMatch = false;
      }
    }

    // Calculate confidence with match count penalty
    let confidence: number;
    let explanation: string;

    if (symbols.length === 0) {
      confidence = 0;
      explanation = `No symbol found matching '${symbolName}'${expectedKind ? ` of kind '${expectedKind}'` : ''}.`;
    } else if (exactMatch && symbols.length === 1) {
      confidence = 0.99;
      explanation = `Exact match: ${symbols[0].kind} '${symbols[0].name}' at ${symbols[0].file}:${symbols[0].line}.`;
    } else if (exactMatch) {
      // Apply match count penalty for multiple exact matches
      const baseConfidence = 0.95;
      const penalty = calculateMatchCountPenalty(symbols.length);
      confidence = Math.max(0.3, baseConfidence - penalty);
      explanation = `Found ${symbols.length} exact matches for '${symbolName}'.`;
    } else {
      // Fuzzy match - apply both fuzzy penalty and match count penalty
      const baseConfidence = 0.75;
      const penalty = calculateMatchCountPenalty(symbols.length);
      confidence = Math.max(0.2, baseConfidence - penalty);
      explanation = `Found ${symbols.length} fuzzy matches for '${symbolName}'.`;
    }

    // Add disambiguation hint for queries with many matches
    if (symbols.length > 20) {
      explanation += ` Multiple matches (${symbols.length}) - consider a more specific query like "${symbolName} class" or "${symbolName} in <filename>".`;
    }

    return {
      symbols,
      confidence,
      exactMatch,
      explanation,
    };
  }
}

// ============================================================================
// QUERY PIPELINE INTEGRATION
// ============================================================================

/**
 * Check if a query should use direct symbol lookup.
 * Returns the parsed pattern if it's a symbol query, null otherwise.
 */
export function detectSymbolQuery(intent: string): SymbolQueryPattern | null {
  return parseSymbolQuery(intent);
}

/**
 * Create a ContextPack from a symbol lookup result.
 * Used to integrate symbol results into the query pipeline.
 */
export function symbolToContextPack(
  symbol: SymbolEntry,
  confidence: number
): {
  packId: string;
  packType: string;
  targetId: string;
  summary: string;
  keyFacts: string[];
  confidence: number;
  filePath: string;
  line: number;
  kind: SymbolKind;
} {
  const packId = `symbol:${symbol.kind}:${symbol.name}:${symbol.file}:${symbol.line}`;
  const summary = `${symbol.kind} ${symbol.name}${symbol.signature ? ` ${symbol.signature}` : ''}`;
  const keyFacts: string[] = [
    `Kind: ${symbol.kind}`,
    `File: ${symbol.file}`,
    `Line: ${symbol.line}`,
  ];
  if (symbol.exported) {
    keyFacts.push('Exported: yes');
  }
  if (symbol.description) {
    keyFacts.push(`Description: ${symbol.description}`);
  }

  return {
    packId,
    packType: 'symbol_definition',
    targetId: symbol.qualifiedName ?? `${symbol.file}:${symbol.name}`,
    summary,
    keyFacts,
    confidence,
    filePath: symbol.file,
    line: symbol.line,
    kind: symbol.kind,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export { SymbolTable as default };
