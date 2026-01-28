/**
 * @fileoverview Symbol Existence Verifier (WU-HALU-006)
 *
 * Verifies that cited functions, classes, and variables exist in the codebase.
 * Uses AST parsing for accurate symbol extraction.
 * Detects hallucinated symbols in LLM outputs.
 *
 * Target: 100% symbol verification accuracy
 *
 * @packageDocumentation
 */

import { ASTFactExtractor, createASTFactExtractor, type ASTFact } from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Type of symbol being referenced
 */
export type SymbolType = 'function' | 'class' | 'method' | 'variable' | 'type' | 'interface';

/**
 * A reference to a symbol extracted from text
 */
export interface SymbolReference {
  /** The name of the symbol */
  name: string;
  /** The type of symbol */
  type: SymbolType;
  /** Optional file path where the symbol is claimed to exist */
  filePath?: string;
  /** Optional line number where the symbol is claimed to exist */
  lineNumber?: number;
  /** The original text context containing the reference */
  context: string;
}

/**
 * Result of verifying a single symbol reference
 */
export interface SymbolVerificationResult {
  /** The symbol that was verified */
  symbol: SymbolReference;
  /** Whether the symbol exists in the codebase */
  exists: boolean;
  /** Location where the symbol was found (if it exists) */
  foundAt?: { file: string; line: number };
  /** Confidence score from 0.0 to 1.0 */
  confidence: number;
  /** Similar symbol names if the symbol was not found */
  alternatives?: string[];
  /** Method used for verification */
  verificationMethod: 'ast' | 'grep' | 'lsp';
}

/**
 * Report summarizing verification of all references in a text
 */
export interface VerificationReport {
  /** Total number of symbol references found */
  totalReferences: number;
  /** Number of verified (existing) symbols */
  verified: number;
  /** Number of symbols not found (potential hallucinations) */
  notFound: number;
  /** Accuracy ratio (verified / totalReferences) */
  accuracy: number;
  /** Detailed results for each symbol */
  results: SymbolVerificationResult[];
  /** Symbols that were not found (hallucinated) */
  hallucinatedSymbols: SymbolReference[];
}

/**
 * Index of all symbols in a codebase
 */
export interface CodebaseIndex {
  /** Function names to their locations */
  functions: Map<string, { file: string; line: number }[]>;
  /** Class names to their locations */
  classes: Map<string, { file: string; line: number }[]>;
  /** Variable/constant names to their locations */
  variables: Map<string, { file: string; line: number }[]>;
  /** Type/interface names to their locations */
  types: Map<string, { file: string; line: number }[]>;
}

// ============================================================================
// SYMBOL VERIFIER CLASS
// ============================================================================

/**
 * Verifies symbol references against a codebase
 */
export class SymbolVerifier {
  private astExtractor: ASTFactExtractor;

  /** Line tolerance for approximate matching */
  private static readonly LINE_TOLERANCE = 20;

  /** Maximum number of similar symbol suggestions */
  private static readonly MAX_ALTERNATIVES = 5;

  constructor() {
    this.astExtractor = createASTFactExtractor();
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Extract symbol references from text (e.g., LLM output)
   */
  extractSymbolReferences(text: string): SymbolReference[] {
    const refs: SymbolReference[] = [];
    const seen = new Set<string>();

    // Pattern 1: Function calls - `functionName()`
    this.extractFunctionCalls(text, refs, seen);

    // Pattern 2: Class instantiation - `new ClassName()`
    this.extractClassInstantiations(text, refs, seen);

    // Pattern 3: Static method calls - `ClassName.method()`
    this.extractStaticMethodCalls(text, refs, seen);

    // Pattern 4: Import references - `import { X } from`
    this.extractImportReferences(text, refs, seen);

    // Pattern 5: Type annotations - `: TypeName`
    this.extractTypeAnnotations(text, refs, seen);

    // Pattern 6: Interface references - `implements Interface` or `interface X`
    this.extractInterfaceReferences(text, refs, seen);

    // Pattern 7: Variable/constant references - `CONSTANT_NAME`
    this.extractVariableReferences(text, refs, seen);

    // Pattern 8: Generic backtick references with file/line context
    this.extractBacktickReferencesWithContext(text, refs, seen);

    return refs;
  }

  /**
   * Build a codebase index from a directory
   */
  async buildCodebaseIndex(rootDir: string): Promise<CodebaseIndex> {
    const index: CodebaseIndex = {
      functions: new Map(),
      classes: new Map(),
      variables: new Map(),
      types: new Map(),
    };

    try {
      const facts = await this.astExtractor.extractFromDirectory(rootDir);

      for (const fact of facts) {
        const location = { file: fact.file, line: fact.line };

        switch (fact.type) {
          case 'function_def':
            this.addToIndex(index.functions, fact.identifier, location);
            break;

          case 'class':
            this.addToIndex(index.classes, fact.identifier, location);
            // Also add class methods to functions index
            const classDetails = fact.details as { methods?: string[] };
            if (classDetails.methods) {
              for (const method of classDetails.methods) {
                this.addToIndex(index.functions, method, location);
              }
            }
            break;

          case 'type':
            this.addToIndex(index.types, fact.identifier, location);
            break;

          case 'export': {
            const exportDetails = fact.details as { kind?: string };
            if (exportDetails.kind === 'const' || exportDetails.kind === 'variable') {
              this.addToIndex(index.variables, fact.identifier, location);
            } else if (exportDetails.kind === 'function') {
              this.addToIndex(index.functions, fact.identifier, location);
            } else if (exportDetails.kind === 'class') {
              this.addToIndex(index.classes, fact.identifier, location);
            } else if (exportDetails.kind === 'interface' || exportDetails.kind === 'type') {
              this.addToIndex(index.types, fact.identifier, location);
            }
            break;
          }
        }
      }
    } catch {
      // Return empty index on error
    }

    return index;
  }

  /**
   * Verify a single symbol reference against the codebase index
   */
  verifySymbol(ref: SymbolReference, index: CodebaseIndex): SymbolVerificationResult {
    // Get the appropriate index based on symbol type
    const targetMaps = this.getMapsForSymbolType(ref.type, index);

    for (const map of targetMaps) {
      const locations = map.get(ref.name);

      if (locations && locations.length > 0) {
        // Symbol found - calculate confidence based on file/line match
        const bestMatch = this.findBestMatch(ref, locations);
        const confidence = this.calculateConfidence(ref, bestMatch);

        return {
          symbol: ref,
          exists: true,
          foundAt: bestMatch,
          confidence,
          verificationMethod: 'ast',
        };
      }
    }

    // Symbol not found - search for alternatives
    const alternatives = this.findSimilarSymbols(ref.name, index);

    return {
      symbol: ref,
      exists: false,
      confidence: 0.0,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      verificationMethod: 'ast',
    };
  }

  /**
   * Verify all symbol references in a text
   */
  verifyAllReferences(text: string, index: CodebaseIndex): VerificationReport {
    const refs = this.extractSymbolReferences(text);

    if (refs.length === 0) {
      return {
        totalReferences: 0,
        verified: 0,
        notFound: 0,
        accuracy: 1, // Perfect accuracy when no references
        results: [],
        hallucinatedSymbols: [],
      };
    }

    const results: SymbolVerificationResult[] = [];
    const hallucinatedSymbols: SymbolReference[] = [];

    for (const ref of refs) {
      const result = this.verifySymbol(ref, index);
      results.push(result);

      if (!result.exists) {
        hallucinatedSymbols.push(ref);
      }
    }

    const verified = results.filter((r) => r.exists).length;
    const notFound = results.filter((r) => !r.exists).length;

    return {
      totalReferences: refs.length,
      verified,
      notFound,
      accuracy: verified / refs.length,
      results,
      hallucinatedSymbols,
    };
  }

  /**
   * Find symbols similar to the given name
   */
  findSimilarSymbols(name: string, index: CodebaseIndex): string[] {
    const allSymbols = this.getAllSymbolNames(index);
    const scored: { name: string; score: number }[] = [];

    const nameLower = name.toLowerCase();

    for (const symbol of allSymbols) {
      const symbolLower = symbol.toLowerCase();
      let score = 0;

      // Exact case-insensitive match
      if (symbolLower === nameLower) {
        score = 100;
      }
      // Substring match
      else if (symbolLower.includes(nameLower) || nameLower.includes(symbolLower)) {
        score = 70 + Math.min(30, (30 * Math.min(name.length, symbol.length)) / Math.max(name.length, symbol.length));
      }
      // Levenshtein distance for typo detection
      else {
        const distance = this.levenshteinDistance(nameLower, symbolLower);
        const maxLen = Math.max(name.length, symbol.length);
        const similarity = 1 - distance / maxLen;

        if (similarity > 0.5) {
          score = similarity * 60;
        }
      }

      if (score > 30) {
        scored.push({ name: symbol, score });
      }
    }

    // Sort by score descending and return top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, SymbolVerifier.MAX_ALTERNATIVES).map((s) => s.name);
  }

  // ============================================================================
  // PRIVATE EXTRACTION METHODS
  // ============================================================================

  private extractFunctionCalls(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match `functionName()` but not `new ClassName()` or `Class.method()`
    const pattern = /`([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(\s*\)`/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      const key = `function:${name}`;

      // Skip if it looks like it's preceded by 'new' (class instantiation)
      const before = text.slice(Math.max(0, match.index - 10), match.index);
      if (/new\s*$/.test(before)) {
        continue;
      }

      if (!seen.has(key) && this.isValidIdentifier(name)) {
        seen.add(key);
        refs.push({
          name,
          type: 'function',
          context: this.extractContext(text, match.index),
        });
      }
    }
  }

  private extractClassInstantiations(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match `new ClassName()` or `new ClassName(`
    const pattern = /`new\s+([A-Z][a-zA-Z0-9_$]*)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      const key = `class:${name}`;

      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          name,
          type: 'class',
          context: this.extractContext(text, match.index),
        });
      }
    }
  }

  private extractStaticMethodCalls(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match `ClassName.methodName()` or `ClassName.methodName(`
    const pattern = /`([A-Z][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const className = match[1];
      const methodName = match[2];

      // Add the method reference
      const methodKey = `method:${methodName}`;
      if (!seen.has(methodKey)) {
        seen.add(methodKey);
        refs.push({
          name: methodName,
          type: 'method',
          context: this.extractContext(text, match.index),
        });
      }

      // Also add the class reference if not already seen
      const classKey = `class:${className}`;
      if (!seen.has(classKey)) {
        seen.add(classKey);
        refs.push({
          name: className,
          type: 'class',
          context: this.extractContext(text, match.index),
        });
      }
    }
  }

  private extractImportReferences(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match `import { X, Y } from "module"`
    const pattern = /`import\s*\{\s*([^}]+)\s*\}\s*from/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const imports = match[1].split(',');

      for (const imp of imports) {
        const name = imp.trim().split(/\s+as\s+/)[0].trim();
        const key = `import:${name}`;

        if (!seen.has(key) && this.isValidIdentifier(name)) {
          seen.add(key);
          // Determine type based on naming convention
          const type = this.inferTypeFromName(name);
          refs.push({
            name,
            type,
            context: this.extractContext(text, match.index),
          });
        }
      }
    }
  }

  private extractTypeAnnotations(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match `: TypeName` or `: TypeName<`
    const pattern = /:\s*`?([A-Z][a-zA-Z0-9_$]*)(?:<[^>]*>)?`?(?:\s|,|;|\)|])/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      const key = `type:${name}`;

      // Skip built-in types
      if (this.isBuiltInType(name)) {
        continue;
      }

      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          name,
          type: 'type',
          context: this.extractContext(text, match.index),
        });
      }
    }
  }

  private extractInterfaceReferences(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match references to interfaces - `interface X` or `implements X`
    const patterns = [
      /`([A-Z][a-zA-Z0-9_$]*)`\s+interface/gi,
      /implements\s+(?:the\s+)?`([A-Z][a-zA-Z0-9_$]*)`/gi,
      /`([A-Z][a-zA-Z0-9_$]*)`\s+interface/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        const key = `interface:${name}`;

        if (!seen.has(key) && !this.isBuiltInType(name)) {
          seen.add(key);
          refs.push({
            name,
            type: 'interface',
            context: this.extractContext(text, match.index),
          });
        }
      }
    }
  }

  private extractVariableReferences(text: string, refs: SymbolReference[], seen: Set<string>): void {
    // Match CONSTANT_CASE variables in backticks
    const pattern = /`([A-Z][A-Z0-9_]+)`/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      const key = `variable:${name}`;

      // Must have at least one underscore to be a constant
      if (!seen.has(key) && name.includes('_')) {
        seen.add(key);
        refs.push({
          name,
          type: 'variable',
          context: this.extractContext(text, match.index),
        });
      }
    }
  }

  private extractBacktickReferencesWithContext(
    text: string,
    refs: SymbolReference[],
    seen: Set<string>
  ): void {
    let match: RegExpExecArray | null;

    // Match `identifier` with file context: `identifier` in `file.ts` (function/method form)
    const funcInFilePattern = /`([a-zA-Z_$][a-zA-Z0-9_$]*)\(\)`\s+(?:function\s+)?(?:in|from)\s+`([^`]+\.tsx?)`/g;
    while ((match = funcInFilePattern.exec(text)) !== null) {
      const name = match[1];
      const filePath = match[2];
      const type = 'function' as SymbolType;
      const key = `${type}:${name}:${filePath}`;

      if (!seen.has(key) && this.isValidIdentifier(name)) {
        seen.add(key);
        refs.push({
          name,
          type,
          filePath,
          context: this.extractContext(text, match.index),
        });
      }
    }

    // Match "The `identifier` function in `file.ts`"
    const theFuncInFilePattern = /[Tt]he\s+`([a-zA-Z_$][a-zA-Z0-9_$]*)`\s+(?:function|method)\s+in\s+`([^`]+\.tsx?)`/g;
    while ((match = theFuncInFilePattern.exec(text)) !== null) {
      const name = match[1];
      const filePath = match[2];
      const type = 'function' as SymbolType;
      const key = `${type}:${name}:${filePath}`;

      if (!seen.has(key) && this.isValidIdentifier(name)) {
        seen.add(key);
        refs.push({
          name,
          type,
          filePath,
          context: this.extractContext(text, match.index),
        });
      }
    }

    // Match `identifier` with file context: `identifier` in `file.ts`
    const withFilePattern = /`([a-zA-Z_$][a-zA-Z0-9_$]*)`\s+(?:in|from)\s+`([^`]+\.tsx?)`/g;
    while ((match = withFilePattern.exec(text)) !== null) {
      const name = match[1];
      const filePath = match[2];
      const type = this.inferTypeFromName(name);
      const key = `${type}:${name}:${filePath}`;

      if (!seen.has(key) && this.isValidIdentifier(name)) {
        seen.add(key);
        refs.push({
          name,
          type,
          filePath,
          context: this.extractContext(text, match.index),
        });
      }
    }

    // Match `identifier` at `file.ts:line`
    const withLinePattern = /`([a-zA-Z_$][a-zA-Z0-9_$]*)`\s+(?:at|in)\s+`([^`]+\.tsx?):(\d+)`/g;

    while ((match = withLinePattern.exec(text)) !== null) {
      const name = match[1];
      const filePath = match[2];
      const lineNumber = parseInt(match[3], 10);
      const type = this.inferTypeFromName(name);
      const key = `${type}:${name}:${filePath}:${lineNumber}`;

      if (!seen.has(key) && this.isValidIdentifier(name)) {
        seen.add(key);
        refs.push({
          name,
          type,
          filePath,
          lineNumber,
          context: this.extractContext(text, match.index),
        });
      }
    }

    // Match generic types like `Map<string, number>` or `Array<T>`
    const genericTypePattern = /`([A-Z][a-zA-Z0-9_$]*)<[^`]*>`/g;
    while ((match = genericTypePattern.exec(text)) !== null) {
      const name = match[1];
      const type = 'type' as SymbolType;
      const key = `${type}:${name}`;

      if (!seen.has(key) && !this.isBuiltInType(name)) {
        seen.add(key);
        refs.push({
          name,
          type,
          context: this.extractContext(text, match.index),
        });
      }
    }

    // Match method chains like `obj.method().anotherMethod()`
    const methodChainPattern = /`[a-zA-Z_$][a-zA-Z0-9_$]*\.([a-zA-Z_$][a-zA-Z0-9_$]*)\(\)(?:\.([a-zA-Z_$][a-zA-Z0-9_$]*)\(\))*`/g;
    while ((match = methodChainPattern.exec(text)) !== null) {
      // Extract all method names from the chain
      const fullMatch = match[0];
      const methodPattern = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)\(\)/g;
      let methodMatch: RegExpExecArray | null;
      while ((methodMatch = methodPattern.exec(fullMatch)) !== null) {
        const methodName = methodMatch[1];
        const key = `method:${methodName}`;
        if (!seen.has(key) && this.isValidIdentifier(methodName)) {
          seen.add(key);
          refs.push({
            name: methodName,
            type: 'method',
            context: this.extractContext(text, match.index),
          });
        }
      }
    }

    // Generic backtick identifiers that look like symbols
    const genericPattern = /`([a-zA-Z_$][a-zA-Z0-9_$]*)`/g;

    while ((match = genericPattern.exec(text)) !== null) {
      const name = match[1];

      // Skip if already captured or doesn't look like a code symbol
      if (!this.isValidIdentifier(name) || this.looksLikeCommand(name)) {
        continue;
      }

      const type = this.inferTypeFromName(name);
      const key = `${type}:${name}`;

      // Only add if not seen and looks like a symbol
      if (!seen.has(key) && name.length > 1) {
        // Check context to avoid false positives
        const before = text.slice(Math.max(0, match.index - 30), match.index);
        const after = text.slice(match.index + match[0].length, match.index + match[0].length + 30);

        // Skip likely non-symbol contexts
        if (this.looksLikeCodeContext(before, after, name)) {
          seen.add(key);
          refs.push({
            name,
            type,
            context: this.extractContext(text, match.index),
          });
        }
      }
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private addToIndex(
    map: Map<string, { file: string; line: number }[]>,
    name: string,
    location: { file: string; line: number }
  ): void {
    const existing = map.get(name);
    if (existing) {
      // Avoid duplicates
      if (!existing.some((l) => l.file === location.file && l.line === location.line)) {
        existing.push(location);
      }
    } else {
      map.set(name, [location]);
    }
  }

  private getMapsForSymbolType(
    type: SymbolType,
    index: CodebaseIndex
  ): Map<string, { file: string; line: number }[]>[] {
    switch (type) {
      case 'function':
        return [index.functions];
      case 'method':
        return [index.functions];
      case 'class':
        return [index.classes];
      case 'variable':
        return [index.variables, index.functions]; // Constants can also be exported functions
      case 'type':
        return [index.types, index.classes]; // Types can be interfaces or classes
      case 'interface':
        return [index.types];
      default:
        return [index.functions, index.classes, index.types, index.variables];
    }
  }

  private findBestMatch(
    ref: SymbolReference,
    locations: { file: string; line: number }[]
  ): { file: string; line: number } {
    if (locations.length === 1) {
      return locations[0];
    }

    // If file path is specified, prefer matching file
    if (ref.filePath) {
      const fileMatch = locations.find(
        (loc) =>
          loc.file.endsWith(ref.filePath!) || ref.filePath!.endsWith(loc.file.split('/').pop()!)
      );
      if (fileMatch) {
        // If line is also specified, check for close match
        if (ref.lineNumber !== undefined) {
          const lineMatch = locations.find(
            (loc) =>
              (loc.file.endsWith(ref.filePath!) || ref.filePath!.endsWith(loc.file.split('/').pop()!)) &&
              Math.abs(loc.line - ref.lineNumber!) <= SymbolVerifier.LINE_TOLERANCE
          );
          if (lineMatch) return lineMatch;
        }
        return fileMatch;
      }
    }

    // Return first location as default
    return locations[0];
  }

  private calculateConfidence(
    ref: SymbolReference,
    location: { file: string; line: number }
  ): number {
    let confidence = 0.9; // Base confidence for finding the symbol

    // Boost for matching file path
    if (ref.filePath) {
      if (location.file.endsWith(ref.filePath) || ref.filePath.endsWith(location.file.split('/').pop()!)) {
        confidence = Math.min(1.0, confidence + 0.05);
      } else {
        confidence = Math.max(0.5, confidence - 0.2);
      }
    }

    // Boost for matching line number
    if (ref.lineNumber !== undefined) {
      const lineDiff = Math.abs(location.line - ref.lineNumber);
      if (lineDiff === 0) {
        confidence = Math.min(1.0, confidence + 0.05);
      } else if (lineDiff <= 5) {
        confidence = Math.min(1.0, confidence + 0.02);
      } else if (lineDiff > SymbolVerifier.LINE_TOLERANCE) {
        confidence = Math.max(0.5, confidence - 0.1);
      }
    }

    return confidence;
  }

  private getAllSymbolNames(index: CodebaseIndex): Set<string> {
    const all = new Set<string>();

    for (const name of index.functions.keys()) all.add(name);
    for (const name of index.classes.keys()) all.add(name);
    for (const name of index.variables.keys()) all.add(name);
    for (const name of index.types.keys()) all.add(name);

    return all;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private extractContext(text: string, index: number): string {
    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + 60);
    let context = text.slice(start, end).trim();

    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    return context.replace(/\s+/g, ' ');
  }

  private isValidIdentifier(name: string): boolean {
    // Must start with letter, underscore, or $
    // Must be a valid JS identifier
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && name.length > 0;
  }

  private isBuiltInType(name: string): boolean {
    const builtIns = new Set([
      'String',
      'Number',
      'Boolean',
      'Object',
      'Array',
      'Function',
      'Symbol',
      'BigInt',
      'Date',
      'RegExp',
      'Error',
      'Promise',
      'Map',
      'Set',
      'WeakMap',
      'WeakSet',
      'Proxy',
      'Reflect',
      'JSON',
      'Math',
      'Intl',
      'ArrayBuffer',
      'DataView',
      'Int8Array',
      'Uint8Array',
      'Uint8ClampedArray',
      'Int16Array',
      'Uint16Array',
      'Int32Array',
      'Uint32Array',
      'Float32Array',
      'Float64Array',
      'BigInt64Array',
      'BigUint64Array',
    ]);
    return builtIns.has(name);
  }

  private looksLikeCommand(name: string): boolean {
    const commands = new Set([
      'npm',
      'yarn',
      'pnpm',
      'npx',
      'node',
      'git',
      'cd',
      'ls',
      'mkdir',
      'rm',
      'mv',
      'cp',
      'cat',
      'echo',
      'grep',
      'sed',
      'awk',
      'curl',
      'wget',
    ]);
    return commands.has(name.toLowerCase());
  }

  private inferTypeFromName(name: string): SymbolType {
    // PascalCase usually indicates a class or type
    if (/^[A-Z][a-z]/.test(name)) {
      // If ends with common interface/type suffixes
      if (/(?:Props|State|Config|Options|Result|Response|Request|Input|Output|Type|Interface)$/.test(name)) {
        return 'type';
      }
      return 'class';
    }

    // CONSTANT_CASE indicates a variable/constant
    if (/^[A-Z][A-Z0-9_]+$/.test(name) && name.includes('_')) {
      return 'variable';
    }

    // camelCase starting with verb suggests function
    if (/^(?:get|set|is|has|can|should|create|build|make|do|handle|on|process|parse|validate|check|compute|calculate|find|fetch|load|save|update|delete|remove|add|insert)/.test(name)) {
      return 'function';
    }

    // Default to function for camelCase
    return 'function';
  }

  private looksLikeCodeContext(before: string, after: string, name: string): boolean {
    // Check if the context suggests this is a code reference
    const codeIndicators = [
      /function/i,
      /class/i,
      /method/i,
      /variable/i,
      /constant/i,
      /type/i,
      /interface/i,
      /import/i,
      /export/i,
      /call/i,
      /use/i,
      /invoke/i,
      /create/i,
      /define/i,
      /return/i,
      /parameter/i,
      /argument/i,
      /instance/i,
      /object/i,
      /array/i,
      /\(\)/,
      /\./,
      /=>/,
      /:/,
    ];

    const combined = before + after;

    // Check for code-like context
    if (codeIndicators.some((pattern) => pattern.test(combined))) {
      return true;
    }

    // If name looks like a function call (has parens after)
    if (/\s*\(/.test(after)) {
      return true;
    }

    // If name starts with uppercase (likely class/type)
    if (/^[A-Z]/.test(name)) {
      return true;
    }

    // If it's camelCase with multiple words
    if (/^[a-z]+[A-Z]/.test(name)) {
      return true;
    }

    return false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new SymbolVerifier instance
 */
export function createSymbolVerifier(): SymbolVerifier {
  return new SymbolVerifier();
}
