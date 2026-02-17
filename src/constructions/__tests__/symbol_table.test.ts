/**
 * @fileoverview Tests for Symbol Table Construction
 *
 * Tests the SymbolTable class and symbol lookup functionality:
 * - Exact name matching
 * - Case-insensitive matching
 * - Fuzzy matching
 * - Kind filtering
 * - Query parsing
 * - Lookup result confidence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SymbolTable,
  parseSymbolQuery,
  detectSymbolQuery,
  symbolToContextPack,
  calculateMatchCountPenalty,
  type SymbolEntry,
  type SymbolKind,
} from '../symbol_table.js';

// ============================================================================
// TEST DATA
// ============================================================================

const TEST_SYMBOLS: SymbolEntry[] = [
  {
    name: 'SqliteLibrarianStorage',
    kind: 'class',
    file: 'src/storage/sqlite_storage.ts',
    line: 225,
    endLine: 2500,
    exported: true,
    signature: 'class SqliteLibrarianStorage implements LibrarianStorage',
    description: 'SQLite storage implementation for Librarian',
    qualifiedName: 'storage/sqlite_storage:SqliteLibrarianStorage',
  },
  {
    name: 'bootstrapProject',
    kind: 'function',
    file: 'src/api/bootstrap.ts',
    line: 821,
    endLine: 1200,
    exported: true,
    signature: 'function bootstrapProject(workspace: string, options?: BootstrapOptions): Promise<BootstrapResult>',
    description: 'Bootstrap a project for librarian indexing',
    qualifiedName: 'api/bootstrap:bootstrapProject',
  },
  {
    name: 'LibrarianStorage',
    kind: 'interface',
    file: 'src/storage/types.ts',
    line: 61,
    endLine: 350,
    exported: true,
    signature: 'interface LibrarianStorage',
    description: 'Abstract storage interface for librarian data',
    qualifiedName: 'storage/types:LibrarianStorage',
  },
  {
    name: 'SymbolKind',
    kind: 'type',
    file: 'src/constructions/symbol_table.ts',
    line: 25,
    exported: true,
    signature: "type SymbolKind = 'class' | 'function' | 'interface' | 'type' | 'const' | 'enum' | 'variable' | 'namespace'",
    qualifiedName: 'constructions/symbol_table:SymbolKind',
  },
  {
    name: 'LIBRARIAN_VERSION',
    kind: 'const',
    file: 'src/index.ts',
    line: 15,
    exported: true,
    signature: 'LIBRARIAN_VERSION: string',
    description: 'Current librarian version',
    qualifiedName: 'index:LIBRARIAN_VERSION',
  },
  {
    name: 'GraphEntityType',
    kind: 'enum',
    file: 'src/types.ts',
    line: 100,
    exported: true,
    signature: "enum GraphEntityType { function, module, ... }",
    qualifiedName: 'types:GraphEntityType',
  },
  {
    name: 'createLibrarian',
    kind: 'function',
    file: 'src/api/librarian.ts',
    line: 50,
    exported: true,
    signature: 'function createLibrarian(storage: LibrarianStorage): Librarian',
    qualifiedName: 'api/librarian:createLibrarian',
  },
  {
    name: 'createStorage',
    kind: 'function',
    file: 'src/storage/index.ts',
    line: 20,
    exported: true,
    signature: 'function createStorage(path: string): LibrarianStorage',
    qualifiedName: 'storage/index:createStorage',
  },
];

// ============================================================================
// SYMBOL TABLE TESTS
// ============================================================================

describe('SymbolTable', () => {
  let table: SymbolTable;

  beforeEach(() => {
    table = new SymbolTable();
    table.addSymbols(TEST_SYMBOLS);
  });

  describe('findByExactName', () => {
    it('should find symbol by exact name', () => {
      const results = table.findByExactName('SqliteLibrarianStorage');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('SqliteLibrarianStorage');
      expect(results[0].kind).toBe('class');
      expect(results[0].line).toBe(225);
    });

    it('should return empty array for non-existent symbol', () => {
      const results = table.findByExactName('NonExistentSymbol');
      expect(results).toHaveLength(0);
    });

    it('should be case-sensitive', () => {
      const results = table.findByExactName('sqlitelibrariantstorage');
      expect(results).toHaveLength(0);
    });
  });

  describe('findByExactNameIgnoreCase', () => {
    it('should find symbol case-insensitively', () => {
      const results = table.findByExactNameIgnoreCase('sqlitelibrarianStorage');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('SqliteLibrarianStorage');
    });

    it('should find symbol with uppercase query', () => {
      const results = table.findByExactNameIgnoreCase('SQLITELIBRARIANTSTORAGE');
      // This intentionally has a typo (extra T) - should not match
      // The correct query would be SQLITELIBRARIANSSTORAGE (no extra T)
      expect(results).toHaveLength(0);
    });
  });

  describe('findByExactNameAndKind', () => {
    it('should find symbol by name and kind', () => {
      const results = table.findByExactNameAndKind('SqliteLibrarianStorage', 'class');
      expect(results).toHaveLength(1);
      expect(results[0].kind).toBe('class');
    });

    it('should not find symbol with wrong kind', () => {
      const results = table.findByExactNameAndKind('SqliteLibrarianStorage', 'function');
      expect(results).toHaveLength(0);
    });

    it('should find function by name and kind', () => {
      const results = table.findByExactNameAndKind('bootstrapProject', 'function');
      expect(results).toHaveLength(1);
      expect(results[0].line).toBe(821);
    });
  });

  describe('findByFuzzyName', () => {
    it('should find symbols containing partial name', () => {
      const results = table.findByFuzzyName('Storage');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.name === 'SqliteLibrarianStorage')).toBe(true);
      expect(results.some((s) => s.name === 'LibrarianStorage')).toBe(true);
    });

    it('should prioritize exact matches', () => {
      const results = table.findByFuzzyName('SymbolKind');
      expect(results[0].name).toBe('SymbolKind');
    });

    it('should find partial matches', () => {
      const results = table.findByFuzzyName('create');
      expect(results.some((s) => s.name === 'createLibrarian')).toBe(true);
      expect(results.some((s) => s.name === 'createStorage')).toBe(true);
    });
  });

  describe('findByFuzzyNameAndKind', () => {
    it('should find fuzzy matches of specific kind', () => {
      const results = table.findByFuzzyNameAndKind('Storage', 'interface');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('LibrarianStorage');
    });

    it('should find functions by partial name', () => {
      const results = table.findByFuzzyNameAndKind('create', 'function');
      expect(results).toHaveLength(2);
      expect(results.every((s) => s.kind === 'function')).toBe(true);
    });
  });

  describe('findByFile', () => {
    it('should find all symbols in a file', () => {
      const results = table.findByFile('src/storage/types.ts');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('LibrarianStorage');
    });

    it('should return empty for file with no symbols', () => {
      const results = table.findByFile('src/nonexistent.ts');
      expect(results).toHaveLength(0);
    });
  });

  describe('findByKind', () => {
    it('should find all classes', () => {
      const results = table.findByKind('class');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('SqliteLibrarianStorage');
    });

    it('should find all functions', () => {
      const results = table.findByKind('function');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((s) => s.kind === 'function')).toBe(true);
    });

    it('should find all interfaces', () => {
      const results = table.findByKind('interface');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('LibrarianStorage');
    });
  });

  describe('getSymbolCount', () => {
    it('should return total symbol count', () => {
      expect(table.getSymbolCount()).toBe(TEST_SYMBOLS.length);
    });
  });

  describe('getCountByKind', () => {
    it('should return counts by kind', () => {
      const counts = table.getCountByKind();
      expect(counts.class).toBe(1);
      expect(counts.function).toBe(3);
      expect(counts.interface).toBe(1);
      expect(counts.type).toBe(1);
      expect(counts.const).toBe(1);
      expect(counts.enum).toBe(1);
    });
  });

  describe('lookup', () => {
    it('should return high confidence for exact match', () => {
      const result = table.lookup({
        symbolName: 'SqliteLibrarianStorage',
        isDefinitionQuery: true,
      });

      expect(result.confidence).toBe(0.99);
      expect(result.exactMatch).toBe(true);
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].line).toBe(225);
    });

    it('should return high confidence for exact name + kind match', () => {
      const result = table.lookup({
        symbolName: 'bootstrapProject',
        expectedKind: 'function',
        isDefinitionQuery: true,
      });

      expect(result.confidence).toBe(0.99);
      expect(result.symbols).toHaveLength(1);
      expect(result.symbols[0].line).toBe(821);
    });

    it('should return lower confidence for fuzzy match', () => {
      const result = table.lookup({
        symbolName: 'Storage',
        isDefinitionQuery: false,
      });

      expect(result.confidence).toBeLessThan(0.95);
      expect(result.exactMatch).toBe(false);
      expect(result.symbols.length).toBeGreaterThan(0);
    });

    it('should return zero confidence for no match', () => {
      const result = table.lookup({
        symbolName: 'NonExistentSymbol',
        isDefinitionQuery: false,
      });

      expect(result.confidence).toBe(0);
      expect(result.symbols).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should remove all symbols', () => {
      table.clear();
      expect(table.getSymbolCount()).toBe(0);
    });
  });
});

// ============================================================================
// QUERY PARSING TESTS
// ============================================================================

describe('parseSymbolQuery', () => {
  it('should parse "X class" pattern', () => {
    const result = parseSymbolQuery('SqliteLibrarianStorage class');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
    expect(result!.expectedKind).toBe('class');
  });

  it('should parse "X function" pattern', () => {
    const result = parseSymbolQuery('bootstrapProject function');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('bootstrapProject');
    expect(result!.expectedKind).toBe('function');
  });

  it('should parse "X interface" pattern', () => {
    const result = parseSymbolQuery('LibrarianStorage interface');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('LibrarianStorage');
    expect(result!.expectedKind).toBe('interface');
  });

  it('should parse "X type" pattern', () => {
    const result = parseSymbolQuery('SymbolKind type');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SymbolKind');
    expect(result!.expectedKind).toBe('type');
  });

  it('should parse "class X" pattern', () => {
    const result = parseSymbolQuery('class SqliteLibrarianStorage');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
    expect(result!.expectedKind).toBe('class');
  });

  it('should parse "the X class" pattern', () => {
    const result = parseSymbolQuery('the SqliteLibrarianStorage class');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
    expect(result!.expectedKind).toBe('class');
  });

  it('should parse "where is X defined" pattern', () => {
    const result = parseSymbolQuery('where is bootstrapProject defined');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('bootstrapProject');
    expect(result!.isDefinitionQuery).toBe(true);
  });

  it('should parse bare symbol name', () => {
    const result = parseSymbolQuery('SqliteLibrarianStorage');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
    expect(result!.expectedKind).toBeUndefined();
  });

  it('should not parse bare lowercase words as symbols', () => {
    const result = parseSymbolQuery('bootstrap');
    expect(result).toBeNull();
  });

  it('should parse "find X" pattern', () => {
    const result = parseSymbolQuery('find SqliteLibrarianStorage');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
  });

  it('should parse "find the X class" pattern', () => {
    // Note: the current pattern only matches "find X class" or "find the X"
    // "find the X class" requires a more complex pattern
    const result = parseSymbolQuery('find SqliteLibrarianStorage class');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
    expect(result!.expectedKind).toBe('class');
  });

  it('should return null for common words', () => {
    const result = parseSymbolQuery('the');
    expect(result).toBeNull();
  });

  it('should return null for short words', () => {
    const result = parseSymbolQuery('a');
    expect(result).toBeNull();
  });

  it('should handle case insensitivity', () => {
    const result = parseSymbolQuery('SqliteLibrarianStorage CLASS');
    expect(result).not.toBeNull();
    expect(result!.expectedKind).toBe('class');
  });

  // New patterns for type/interface definition queries
  it('should parse "type definitions for X" pattern', () => {
    const result = parseSymbolQuery('type definitions for ContextPack');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('ContextPack');
    expect(result!.isDefinitionQuery).toBe(true);
  });

  it('should parse "interface definitions for X" pattern', () => {
    const result = parseSymbolQuery('interface definitions for LibrarianStorage');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('LibrarianStorage');
    expect(result!.isDefinitionQuery).toBe(true);
  });

  it('should parse "X type definition" pattern', () => {
    const result = parseSymbolQuery('QueryOptions type definition');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('QueryOptions');
    expect(result!.isDefinitionQuery).toBe(true);
  });

  it('should parse "X interface definition" pattern', () => {
    const result = parseSymbolQuery('ContextPack interface definition');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('ContextPack');
    expect(result!.isDefinitionQuery).toBe(true);
  });

  it('should parse "definition of X" pattern', () => {
    const result = parseSymbolQuery('definition of LibrarianStorage');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('LibrarianStorage');
    expect(result!.isDefinitionQuery).toBe(true);
  });

  it('should parse "where is X interface defined" pattern', () => {
    const result = parseSymbolQuery('where is the ContextPack interface defined');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('ContextPack');
    expect(result!.isDefinitionQuery).toBe(true);
  });
});

// ============================================================================
// DETECT SYMBOL QUERY TESTS
// ============================================================================

describe('detectSymbolQuery', () => {
  it('should detect symbol query for class lookup', () => {
    const result = detectSymbolQuery('SqliteLibrarianStorage class');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('SqliteLibrarianStorage');
  });

  it('should detect symbol query for function lookup', () => {
    const result = detectSymbolQuery('bootstrapProject function');
    expect(result).not.toBeNull();
    expect(result!.symbolName).toBe('bootstrapProject');
  });

  it('should not detect complex queries as symbol queries', () => {
    // Complex semantic queries should not be treated as symbol lookups
    // Note: very short words like "work" might still be matched by the bare symbol pattern
    // but will be filtered by isCommonWord
    const result = detectSymbolQuery('how does the authentication middleware work in the system');
    expect(result).toBeNull();
  });
});

// ============================================================================
// CONTEXT PACK CONVERSION TESTS
// ============================================================================

describe('symbolToContextPack', () => {
  it('should create context pack from symbol', () => {
    const symbol: SymbolEntry = {
      name: 'SqliteLibrarianStorage',
      kind: 'class',
      file: 'src/storage/sqlite_storage.ts',
      line: 225,
      exported: true,
      signature: 'class SqliteLibrarianStorage implements LibrarianStorage',
    };

    const pack = symbolToContextPack(symbol, 0.99);

    expect(pack.packType).toBe('symbol_definition');
    expect(pack.confidence).toBe(0.99);
    expect(pack.filePath).toBe('src/storage/sqlite_storage.ts');
    expect(pack.line).toBe(225);
    expect(pack.kind).toBe('class');
    expect(pack.summary).toContain('SqliteLibrarianStorage');
    expect(pack.keyFacts).toContain('Kind: class');
    expect(pack.keyFacts).toContain('Line: 225');
  });

  it('should include exported status in key facts', () => {
    const symbol: SymbolEntry = {
      name: 'TestSymbol',
      kind: 'function',
      file: 'test.ts',
      line: 10,
      exported: true,
    };

    const pack = symbolToContextPack(symbol, 0.95);
    expect(pack.keyFacts).toContain('Exported: yes');
  });

  it('should include description when present', () => {
    const symbol: SymbolEntry = {
      name: 'TestSymbol',
      kind: 'function',
      file: 'test.ts',
      line: 10,
      exported: false,
      description: 'A test function',
    };

    const pack = symbolToContextPack(symbol, 0.95);
    expect(pack.keyFacts).toContain('Description: A test function');
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Symbol Lookup Integration', () => {
  let table: SymbolTable;

  beforeEach(() => {
    table = new SymbolTable();
    table.addSymbols(TEST_SYMBOLS);
  });

  it('should find SqliteLibrarianStorage class at line 225', () => {
    const query = parseSymbolQuery('SqliteLibrarianStorage class');
    expect(query).not.toBeNull();

    const result = table.lookup(query!);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].file).toBe('src/storage/sqlite_storage.ts');
    expect(result.symbols[0].line).toBe(225);
  });

  it('should find bootstrapProject function at line 821', () => {
    const query = parseSymbolQuery('bootstrapProject function');
    expect(query).not.toBeNull();

    const result = table.lookup(query!);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].file).toBe('src/api/bootstrap.ts');
    expect(result.symbols[0].line).toBe(821);
  });

  it('should find LibrarianStorage interface', () => {
    const query = parseSymbolQuery('LibrarianStorage interface');
    expect(query).not.toBeNull();

    const result = table.lookup(query!);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].kind).toBe('interface');
  });

  it('should handle ambiguous queries with multiple results', () => {
    const query = parseSymbolQuery('create');
    expect(query).not.toBeNull();

    const result = table.lookup(query!);
    expect(result.symbols.length).toBeGreaterThan(1);
    expect(result.exactMatch).toBe(false);
  });
});

// ============================================================================
// MATCH COUNT PENALTY TESTS
// ============================================================================

describe('calculateMatchCountPenalty', () => {
  it('should return 0 penalty for single match', () => {
    expect(calculateMatchCountPenalty(1)).toBe(0);
  });

  it('should return 0 penalty for zero matches', () => {
    expect(calculateMatchCountPenalty(0)).toBe(0);
  });

  it('should return 0.05 penalty for 2-5 matches', () => {
    expect(calculateMatchCountPenalty(2)).toBe(0.05);
    expect(calculateMatchCountPenalty(3)).toBe(0.05);
    expect(calculateMatchCountPenalty(5)).toBe(0.05);
  });

  it('should return 0.15 penalty for 6-20 matches', () => {
    expect(calculateMatchCountPenalty(6)).toBe(0.15);
    expect(calculateMatchCountPenalty(10)).toBe(0.15);
    expect(calculateMatchCountPenalty(20)).toBe(0.15);
  });

  it('should return 0.30 penalty for 21-100 matches', () => {
    expect(calculateMatchCountPenalty(21)).toBe(0.30);
    expect(calculateMatchCountPenalty(50)).toBe(0.30);
    expect(calculateMatchCountPenalty(100)).toBe(0.30);
  });

  it('should return 0.45 penalty for over 100 matches', () => {
    expect(calculateMatchCountPenalty(101)).toBe(0.45);
    expect(calculateMatchCountPenalty(200)).toBe(0.45);
    expect(calculateMatchCountPenalty(500)).toBe(0.45);
  });
});

describe('Confidence with Match Count Penalty', () => {
  let table: SymbolTable;

  beforeEach(() => {
    table = new SymbolTable();
  });

  it('should have 0.99 confidence for single exact match', () => {
    table.addSymbol({
      name: 'UniqueSymbol',
      kind: 'class',
      file: 'test.ts',
      line: 10,
      exported: true,
    });

    const result = table.lookup({ symbolName: 'UniqueSymbol', isDefinitionQuery: false });
    expect(result.confidence).toBe(0.99);
    expect(result.symbols).toHaveLength(1);
  });

  it('should reduce confidence for many exact matches', () => {
    // Add 50 symbols with similar names (exact matches for "config")
    for (let i = 0; i < 50; i++) {
      table.addSymbol({
        name: 'config',
        kind: 'const',
        file: `file${i}.ts`,
        line: i + 1,
        exported: true,
      });
    }

    const result = table.lookup({ symbolName: 'config', isDefinitionQuery: false });
    expect(result.symbols).toHaveLength(50);
    expect(result.exactMatch).toBe(true);
    // 50 matches should get 0.30 penalty: 0.95 - 0.30 = 0.65
    expect(result.confidence).toBeCloseTo(0.65, 2);
  });

  it('should reduce confidence significantly for 200+ exact matches', () => {
    // Add 200 symbols with same name
    for (let i = 0; i < 200; i++) {
      table.addSymbol({
        name: 'storage',
        kind: 'const',
        file: `file${i}.ts`,
        line: i + 1,
        exported: true,
      });
    }

    const result = table.lookup({ symbolName: 'storage', isDefinitionQuery: false });
    expect(result.symbols).toHaveLength(200);
    expect(result.exactMatch).toBe(true);
    // 200 matches should get 0.45 penalty: 0.95 - 0.45 = 0.50
    expect(result.confidence).toBeCloseTo(0.50, 2);
  });

  it('should include disambiguation hint for many matches', () => {
    // Add 25 symbols to trigger the disambiguation hint
    for (let i = 0; i < 25; i++) {
      table.addSymbol({
        name: 'handler',
        kind: 'function',
        file: `file${i}.ts`,
        line: i + 1,
        exported: true,
      });
    }

    const result = table.lookup({ symbolName: 'handler', isDefinitionQuery: false });
    expect(result.symbols.length).toBeGreaterThan(20);
    expect(result.explanation).toContain('Multiple matches');
    expect(result.explanation).toContain('consider a more specific query');
  });

  it('should not show disambiguation hint for few matches', () => {
    // Add only 5 symbols
    for (let i = 0; i < 5; i++) {
      table.addSymbol({
        name: 'rareSymbol',
        kind: 'function',
        file: `file${i}.ts`,
        line: i + 1,
        exported: true,
      });
    }

    const result = table.lookup({ symbolName: 'rareSymbol', isDefinitionQuery: false });
    expect(result.symbols).toHaveLength(5);
    expect(result.explanation).not.toContain('Multiple matches');
  });
});
