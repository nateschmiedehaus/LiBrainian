/**
 * @fileoverview AST-Aligned Chunking (WU-LANG-002)
 *
 * Implements cAST-style chunk boundaries that align with syntactic units
 * per CMU 2025 research. This module provides intelligent code chunking
 * that respects AST boundaries for better retrieval and embedding quality.
 *
 * Features:
 * - Chunks align with syntactic units (functions, classes, methods)
 * - Handles incomplete syntax gracefully
 * - Supports multiple languages (TypeScript, Python)
 * - Provides chunk merging and splitting utilities
 *
 * @packageDocumentation
 */

import { Project, SyntaxKind, Node, type SourceFile } from 'ts-morph';
import { createRequire } from 'node:module';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of syntactic units that can be chunked
 */
export type ASTChunkType = 'function' | 'class' | 'method' | 'module' | 'block' | 'statement';

/**
 * A chunk of code aligned with AST boundaries
 */
export interface ASTChunk {
  /** The actual code content of the chunk */
  content: string;
  /** The type of syntactic unit */
  type: ASTChunkType;
  /** Starting line number (1-based) */
  startLine: number;
  /** Ending line number (1-based) */
  endLine: number;
  /** True if the chunk is syntactically complete */
  syntaxComplete: boolean;
  /** For methods/nested items, the parent type name */
  parentType?: string;
  /** Additional metadata about the chunk */
  metadata: {
    /** Name of the function/class/method */
    name?: string;
    /** Function/method signature */
    signature?: string;
    /** Cyclomatic complexity estimate */
    complexity?: number;
  };
}

/**
 * Configuration for the AST chunker
 */
export interface ASTChunkerConfig {
  /** Default minimum tokens for merging small chunks */
  defaultMinTokens?: number;
  /** Default maximum tokens for splitting large chunks */
  defaultMaxTokens?: number;
}

/**
 * Interface for the AST chunker
 */
export interface ASTChunker {
  /** Chunk a file into AST-aligned units */
  chunkFile(content: string, language: string): Promise<ASTChunk[]>;
  /** Chunk with overlapping context lines */
  chunkWithOverlap(content: string, language: string, overlapLines: number): Promise<ASTChunk[]>;
  /** Merge chunks that are too small */
  mergeSmallChunks(chunks: ASTChunk[], minTokens: number): ASTChunk[];
  /** Split chunks that are too large */
  splitLargeChunks(chunks: ASTChunk[], maxTokens: number): ASTChunk[];
}

// ============================================================================
// TREE-SITTER TYPES
// ============================================================================

type TreeSitterPoint = { row: number; column: number };
type TreeSitterNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  namedChildren: TreeSitterNode[];
  childForFieldName: (field: string) => TreeSitterNode | null;
  children: TreeSitterNode[];
};
type TreeSitterTree = { rootNode: TreeSitterNode };
type TreeSitterParser = {
  setLanguage: (language: TreeSitterLanguage) => void;
  parse: (content: string) => TreeSitterTree;
};
type TreeSitterParserConstructor = new () => TreeSitterParser;
type TreeSitterLanguage = { name?: string };

// ============================================================================
// TREE-SITTER LOADER
// ============================================================================

const require = createRequire(import.meta.url);

function loadTreeSitterParser(): TreeSitterParserConstructor | null {
  try {
    const Parser = require('tree-sitter') as TreeSitterParserConstructor;
    if (typeof Parser === 'function') {
      return Parser;
    }
    return null;
  } catch {
    return null;
  }
}

function loadTreeSitterLanguage(moduleName: string): TreeSitterLanguage | null {
  try {
    const mod = require(moduleName) as TreeSitterLanguage | { default?: TreeSitterLanguage };
    if (typeof (mod as { default?: TreeSitterLanguage }).default !== 'undefined') {
      return (mod as { default?: TreeSitterLanguage }).default ?? null;
    }
    return mod as TreeSitterLanguage;
  } catch {
    return null;
  }
}

// ============================================================================
// AST CHUNKER IMPLEMENTATION
// ============================================================================

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<ASTChunkerConfig> = {
  defaultMinTokens: 50,
  defaultMaxTokens: 1000,
};

/**
 * AST Chunker implementation
 */
class ASTChunkerImpl implements ASTChunker {
  private readonly config: Required<ASTChunkerConfig>;
  private readonly tsMorphProject: Project;
  private readonly treeSitterParser: TreeSitterParserConstructor | null;
  private readonly pythonLanguage: TreeSitterLanguage | null;

  constructor(config?: ASTChunkerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize ts-morph for TypeScript/JavaScript
    this.tsMorphProject = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
        jsx: 2, // React JSX
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });

    // Try to load tree-sitter for Python
    this.treeSitterParser = loadTreeSitterParser();
    this.pythonLanguage = loadTreeSitterLanguage('tree-sitter-python');
  }

  /**
   * Chunk a file into AST-aligned units
   */
  async chunkFile(content: string, language: string): Promise<ASTChunk[]> {
    if (!content || content.trim().length === 0) {
      return [];
    }

    const normalizedLanguage = language.toLowerCase();

    if (normalizedLanguage === 'typescript' || normalizedLanguage === 'javascript' || normalizedLanguage === 'tsx' || normalizedLanguage === 'jsx') {
      return this.chunkTypeScript(content);
    }

    if (normalizedLanguage === 'python') {
      return this.chunkPython(content);
    }

    // Unsupported language - return empty or a single module chunk
    return [];
  }

  /**
   * Chunk with overlapping context lines
   */
  async chunkWithOverlap(content: string, language: string, overlapLines: number): Promise<ASTChunk[]> {
    const chunks = await this.chunkFile(content, language);

    if (chunks.length === 0 || overlapLines <= 0) {
      return chunks;
    }

    const lines = content.split('\n');
    const result: ASTChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Calculate overlap start line
      const overlapStartLine = Math.max(1, chunk.startLine - overlapLines);

      // Get the overlap content
      const overlapContent = lines.slice(overlapStartLine - 1, chunk.startLine - 1).join('\n');
      const newContent = overlapContent ? overlapContent + '\n' + chunk.content : chunk.content;

      result.push({
        ...chunk,
        content: newContent,
        startLine: overlapStartLine,
      });
    }

    return result;
  }

  /**
   * Merge chunks that are too small
   */
  mergeSmallChunks(chunks: ASTChunk[], minTokens: number): ASTChunk[] {
    if (chunks.length <= 1) {
      return chunks;
    }

    const result: ASTChunk[] = [];
    let currentMerge: ASTChunk | null = null;

    for (const chunk of chunks) {
      const tokenCount = this.estimateTokens(chunk.content);

      if (tokenCount >= minTokens) {
        // Chunk is big enough, flush any pending merge
        if (currentMerge) {
          result.push(currentMerge);
          currentMerge = null;
        }
        result.push(chunk);
      } else {
        // Chunk is too small, merge with current or start new merge
        if (!currentMerge) {
          currentMerge = { ...chunk };
        } else {
          // Merge into current
          currentMerge = this.mergeTwoChunks(currentMerge, chunk);

          // If merged chunk is now big enough, flush it
          if (this.estimateTokens(currentMerge.content) >= minTokens) {
            result.push(currentMerge);
            currentMerge = null;
          }
        }
      }
    }

    // Flush any remaining merge
    if (currentMerge) {
      result.push(currentMerge);
    }

    return result;
  }

  /**
   * Split chunks that are too large
   */
  splitLargeChunks(chunks: ASTChunk[], maxTokens: number): ASTChunk[] {
    const result: ASTChunk[] = [];

    for (const chunk of chunks) {
      const tokenCount = this.estimateTokens(chunk.content);

      if (tokenCount <= maxTokens) {
        result.push(chunk);
      } else {
        // Split the chunk
        const splitChunks = this.splitChunk(chunk, maxTokens);
        result.push(...splitChunks);
      }
    }

    return result;
  }

  // ============================================================================
  // PRIVATE METHODS - TYPESCRIPT CHUNKING
  // ============================================================================

  private chunkTypeScript(content: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];

    try {
      const sourceFile = this.tsMorphProject.createSourceFile('temp.tsx', content, { overwrite: true });

      try {
        // Extract classes (including methods)
        this.extractClassesTS(sourceFile, content, chunks);

        // Extract standalone functions
        this.extractFunctionsTS(sourceFile, content, chunks);

        // Extract arrow functions assigned to variables
        this.extractArrowFunctionsTS(sourceFile, content, chunks);
      } finally {
        sourceFile.forget();
      }
    } catch {
      // If parsing fails, return empty array
      return [];
    }

    // Sort by start line
    chunks.sort((a, b) => a.startLine - b.startLine);

    return chunks;
  }

  private extractClassesTS(sourceFile: SourceFile, content: string, chunks: ASTChunk[]): void {
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;

      const startLine = cls.getStartLineNumber();
      const endLine = cls.getEndLineNumber();
      const classContent = content.split('\n').slice(startLine - 1, endLine).join('\n');

      // Add class chunk
      chunks.push({
        content: classContent,
        type: 'class',
        startLine,
        endLine,
        syntaxComplete: true,
        metadata: {
          name,
          signature: this.buildClassSignature(cls),
          complexity: this.estimateComplexity(classContent),
        },
      });

      // Extract methods
      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const methodStartLine = method.getStartLineNumber();
        const methodEndLine = method.getEndLineNumber();
        const methodContent = content.split('\n').slice(methodStartLine - 1, methodEndLine).join('\n');

        chunks.push({
          content: methodContent,
          type: 'method',
          startLine: methodStartLine,
          endLine: methodEndLine,
          syntaxComplete: true,
          parentType: name,
          metadata: {
            name: methodName,
            signature: this.buildMethodSignature(method),
            complexity: this.estimateComplexity(methodContent),
          },
        });
      }
    }
  }

  private extractFunctionsTS(sourceFile: SourceFile, content: string, chunks: ASTChunk[]): void {
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      const startLine = func.getStartLineNumber();
      const endLine = func.getEndLineNumber();
      const funcContent = content.split('\n').slice(startLine - 1, endLine).join('\n');

      chunks.push({
        content: funcContent,
        type: 'function',
        startLine,
        endLine,
        syntaxComplete: true,
        metadata: {
          name,
          signature: this.buildFunctionSignature(func),
          complexity: this.estimateComplexity(funcContent),
        },
      });
    }
  }

  private extractArrowFunctionsTS(sourceFile: SourceFile, content: string, chunks: ASTChunk[]): void {
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (initializer && Node.isArrowFunction(initializer)) {
        const name = varDecl.getName();
        const stmt = varDecl.getVariableStatement();
        if (!stmt) continue;

        const startLine = stmt.getStartLineNumber();
        const endLine = stmt.getEndLineNumber();
        const funcContent = content.split('\n').slice(startLine - 1, endLine).join('\n');

        chunks.push({
          content: funcContent,
          type: 'function',
          startLine,
          endLine,
          syntaxComplete: true,
          metadata: {
            name,
            signature: `const ${name} = () => ...`,
            complexity: this.estimateComplexity(funcContent),
          },
        });
      }
    }
  }

  private buildClassSignature(cls: Node): string {
    if (!Node.isClassDeclaration(cls)) return '';
    const name = cls.getName() || 'AnonymousClass';
    const heritage = cls.getHeritageClauses().map(h => h.getText()).join(' ');
    return `class ${name}${heritage ? ' ' + heritage : ''}`;
  }

  private buildMethodSignature(method: Node): string {
    if (!Node.isMethodDeclaration(method)) return '';
    const name = method.getName();
    const params = method.getParameters().map(p => p.getText()).join(', ');
    const returnType = method.getReturnTypeNode()?.getText() || '';
    return `${name}(${params})${returnType ? ': ' + returnType : ''}`;
  }

  private buildFunctionSignature(func: Node): string {
    if (!Node.isFunctionDeclaration(func)) return '';
    const name = func.getName() || 'anonymous';
    const params = func.getParameters().map(p => p.getText()).join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || '';
    return `function ${name}(${params})${returnType ? ': ' + returnType : ''}`;
  }

  // ============================================================================
  // PRIVATE METHODS - PYTHON CHUNKING
  // ============================================================================

  private chunkPython(content: string): ASTChunk[] {
    if (!this.treeSitterParser || !this.pythonLanguage) {
      // Fall back to regex-based parsing if tree-sitter not available
      return this.chunkPythonRegex(content);
    }

    const chunks: ASTChunk[] = [];

    try {
      const parser = new this.treeSitterParser();
      parser.setLanguage(this.pythonLanguage);
      const tree = parser.parse(content);

      this.extractPythonChunks(tree.rootNode, content, chunks, undefined);
    } catch {
      // Fall back to regex-based parsing
      return this.chunkPythonRegex(content);
    }

    // Sort by start line
    chunks.sort((a, b) => a.startLine - b.startLine);

    return chunks;
  }

  private extractPythonChunks(
    node: TreeSitterNode,
    content: string,
    chunks: ASTChunk[],
    parentClass: string | undefined
  ): void {
    for (const child of node.namedChildren) {
      if (child.type === 'class_definition') {
        const nameNode = child.childForFieldName('name');
        const name = nameNode?.text || 'AnonymousClass';

        const startLine = child.startPosition.row + 1;
        const endLine = child.endPosition.row + 1;
        const classContent = content.split('\n').slice(startLine - 1, endLine).join('\n');

        chunks.push({
          content: classContent,
          type: 'class',
          startLine,
          endLine,
          syntaxComplete: true,
          metadata: {
            name,
            signature: `class ${name}`,
            complexity: this.estimateComplexity(classContent),
          },
        });

        // Recursively extract methods within the class
        this.extractPythonChunks(child, content, chunks, name);
      } else if (child.type === 'function_definition') {
        const nameNode = child.childForFieldName('name');
        const name = nameNode?.text || 'anonymous';

        const startLine = child.startPosition.row + 1;
        const endLine = child.endPosition.row + 1;
        const funcContent = content.split('\n').slice(startLine - 1, endLine).join('\n');

        const isMethod = parentClass !== undefined;

        chunks.push({
          content: funcContent,
          type: isMethod ? 'method' : 'function',
          startLine,
          endLine,
          syntaxComplete: true,
          parentType: parentClass,
          metadata: {
            name,
            signature: this.buildPythonFunctionSignature(child, content),
            complexity: this.estimateComplexity(funcContent),
          },
        });
      } else {
        // Recursively process other nodes
        this.extractPythonChunks(child, content, chunks, parentClass);
      }
    }
  }

  private buildPythonFunctionSignature(node: TreeSitterNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'anonymous';

    const parametersNode = node.childForFieldName('parameters');
    const params = parametersNode?.text || '()';

    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text || '';

    return `def ${name}${params}${returnType ? ' -> ' + returnType : ''}`;
  }

  private chunkPythonRegex(content: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];
    const lines = content.split('\n');

    // Simple regex-based extraction for fallback
    const classRegex = /^class\s+(\w+)/;
    const funcRegex = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;

    // Track class blocks with their indentation levels and ranges
    const classBlocks: Array<{ name: string; startLine: number; endLine: number; indent: number }> = [];

    // First pass: find all class blocks
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const classMatch = line.match(classRegex);
      if (classMatch) {
        const className = classMatch[1];
        const classIndent = line.search(/\S/);
        const endLine = this.findPythonBlockEnd(lines, i);
        const classContent = lines.slice(i, endLine).join('\n');

        chunks.push({
          content: classContent,
          type: 'class',
          startLine: i + 1,
          endLine,
          syntaxComplete: true,
          metadata: {
            name: className,
            signature: `class ${className}`,
            complexity: this.estimateComplexity(classContent),
          },
        });

        classBlocks.push({
          name: className,
          startLine: i + 1,
          endLine,
          indent: classIndent,
        });
      }
    }

    // Second pass: find all functions/methods
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const funcMatch = line.match(funcRegex);
      if (funcMatch) {
        const indent = funcMatch[1].length;
        const funcName = funcMatch[2];
        const lineNum = i + 1;

        // Check if this function is inside a class
        let parentClass: string | undefined;
        for (const classBlock of classBlocks) {
          if (lineNum > classBlock.startLine && lineNum <= classBlock.endLine && indent > classBlock.indent) {
            parentClass = classBlock.name;
            break;
          }
        }

        const isMethod = parentClass !== undefined;
        const endLine = this.findPythonBlockEnd(lines, i);
        const funcContent = lines.slice(i, endLine).join('\n');

        chunks.push({
          content: funcContent,
          type: isMethod ? 'method' : 'function',
          startLine: lineNum,
          endLine,
          syntaxComplete: true,
          parentType: parentClass,
          metadata: {
            name: funcName,
            signature: `def ${funcName}(...)`,
            complexity: this.estimateComplexity(funcContent),
          },
        });
      }
    }

    return chunks;
  }

  private findPythonBlockEnd(lines: string[], startIndex: number): number {
    const startLine = lines[startIndex];
    const startIndent = startLine.search(/\S/);

    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue; // Skip empty lines

      const currentIndent = line.search(/\S/);
      if (currentIndent <= startIndent && line.trim().length > 0) {
        return i;
      }
    }

    return lines.length;
  }

  // ============================================================================
  // PRIVATE METHODS - UTILITIES
  // ============================================================================

  private estimateTokens(content: string): number {
    // Simple token estimation: ~4 characters per token
    return Math.ceil(content.length / 4);
  }

  private estimateComplexity(content: string): number {
    // Simple cyclomatic complexity estimate based on control flow keywords
    let complexity = 1; // Base complexity

    const controlFlowPatterns = [
      /\bif\b/g,
      /\belse\s+if\b/g,
      /\belif\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\bexcept\b/g,
      /\b&&\b/g,
      /\b\|\|\b/g,
      /\?.*:/g, // Ternary operator
    ];

    for (const pattern of controlFlowPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private mergeTwoChunks(a: ASTChunk, b: ASTChunk): ASTChunk {
    return {
      content: a.content + '\n' + b.content,
      type: this.getMergedType(a.type, b.type),
      startLine: Math.min(a.startLine, b.startLine),
      endLine: Math.max(a.endLine, b.endLine),
      syntaxComplete: a.syntaxComplete && b.syntaxComplete,
      parentType: a.parentType || b.parentType,
      metadata: {
        name: a.metadata.name || b.metadata.name,
        complexity: (a.metadata.complexity || 0) + (b.metadata.complexity || 0),
      },
    };
  }

  private getMergedType(a: ASTChunkType, b: ASTChunkType): ASTChunkType {
    // When merging, prefer more specific types
    const priority: Record<ASTChunkType, number> = {
      class: 5,
      function: 4,
      method: 3,
      module: 2,
      block: 1,
      statement: 0,
    };

    return priority[a] >= priority[b] ? a : b;
  }

  private splitChunk(chunk: ASTChunk, maxTokens: number): ASTChunk[] {
    const lines = chunk.content.split('\n');
    const result: ASTChunk[] = [];

    let currentLines: string[] = [];
    let currentStartLine = chunk.startLine;

    for (let i = 0; i < lines.length; i++) {
      currentLines.push(lines[i]);
      const currentContent = currentLines.join('\n');
      const tokens = this.estimateTokens(currentContent);

      if (tokens >= maxTokens && currentLines.length > 1) {
        // Create a chunk with all but the last line
        const splitContent = currentLines.slice(0, -1).join('\n');
        result.push({
          content: splitContent,
          type: result.length === 0 ? chunk.type : 'block',
          startLine: currentStartLine,
          endLine: currentStartLine + currentLines.length - 2,
          syntaxComplete: false, // Split chunks may not be complete
          parentType: chunk.parentType,
          metadata: {
            name: chunk.metadata.name,
            complexity: this.estimateComplexity(splitContent),
          },
        });

        // Start new chunk with the last line
        currentStartLine = chunk.startLine + i;
        currentLines = [lines[i]];
      }
    }

    // Add remaining content
    if (currentLines.length > 0) {
      const remainingContent = currentLines.join('\n');
      result.push({
        content: remainingContent,
        type: result.length === 0 ? chunk.type : 'block',
        startLine: currentStartLine,
        endLine: chunk.endLine,
        syntaxComplete: result.length === 0, // Only first chunk might be complete
        parentType: chunk.parentType,
        metadata: {
          name: chunk.metadata.name,
          complexity: this.estimateComplexity(remainingContent),
        },
      });
    }

    return result;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new AST chunker instance
 */
export function createASTChunker(config?: ASTChunkerConfig): ASTChunker {
  return new ASTChunkerImpl(config);
}
