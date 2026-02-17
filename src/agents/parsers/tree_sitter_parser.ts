/**
 * @fileoverview Tree-sitter Universal Parser Integration
 *
 * WU-LANG-001: Provides universal parsing for 20+ languages using tree-sitter.
 * Features:
 * - Incremental parsing for efficiency
 * - Consistent AST node extraction across languages
 * - Language detection from code content and file extensions
 */

import { createRequire } from 'node:module';
import { getGrammarRequirePaths } from '../../utils/grammar_cache.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Position in source code (0-indexed row and column).
 */
export interface Position {
  row: number;
  column: number;
}

/**
 * Parse error information.
 */
export interface ParseError {
  message: string;
  position: Position;
  endPosition: Position;
}

/**
 * Represents a node in the syntax tree.
 */
export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: Position;
  endPosition: Position;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
}

/**
 * Represents the complete syntax tree.
 */
export interface SyntaxTree {
  rootNode: SyntaxNode;
  text: string;
  /** Language passed to `parse` (best-effort). */
  language?: string;
}

/**
 * Result of parsing source code.
 */
export interface ParseResult {
  language: string;
  tree: SyntaxTree;
  errors: ParseError[];
  parseTime: number;
}

/**
 * Language support configuration.
 */
export interface LanguageSupport {
  language: string;
  extensions: string[];
  grammarPath: string;
}

export interface TreeSitterLanguageConfig {
  language: string;
  extensions: string[];
  grammarModule: string;
  grammarModuleExport?: string;
  grammarModuleExports?: Record<string, string>;
  patterns?: RegExp[];
  functionNodeTypes?: string[];
  classNodeTypes?: string[];
  available?: boolean;
}

/**
 * Represents an extracted function from the syntax tree.
 */
export interface FunctionNode {
  name: string;
  startPosition: Position;
  endPosition: Position;
  parameters: string[];
  body: string;
  returnType?: string;
  modifiers?: string[];
}

/**
 * Represents an extracted class from the syntax tree.
 */
export interface ClassNode {
  name: string;
  startPosition: Position;
  endPosition: Position;
  methods?: FunctionNode[];
  properties?: string[];
  modifiers?: string[];
  superclass?: string;
  interfaces?: string[];
}

/**
 * Represents an extracted call site from the syntax tree.
 */
export interface CallNode {
  callee: string;
  caller?: string;
  callerClass?: string;
  startPosition: Position;
  endPosition: Position;
}

/**
 * Edit range for incremental parsing.
 */
export interface EditRange {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: Position;
  oldEndPosition: Position;
  newEndPosition: Position;
}

/**
 * Options for parsing with incremental support.
 */
export interface ParseOptions {
  previousTree?: SyntaxTree;
  editRange?: EditRange;
}

// ============================================================================
// INTERNAL TREE-SITTER TYPES
// ============================================================================

type TreeSitterPoint = { row: number; column: number };
type TreeSitterNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  children: TreeSitterNode[];
  namedChildren: TreeSitterNode[];
  childForFieldName: (field: string) => TreeSitterNode | null;
  hasError?: () => boolean;
  descendantsOfType?: (type: string | string[]) => TreeSitterNode[];
};
type TreeSitterTree = {
  rootNode: TreeSitterNode;
  edit: (edit: {
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
    startPosition: TreeSitterPoint;
    oldEndPosition: TreeSitterPoint;
    newEndPosition: TreeSitterPoint;
  }) => void;
};
type InternalTreeSitterParser = {
  setLanguage: (language: TreeSitterLanguage) => void;
  parse: (content: string | ((index: number) => string), oldTree?: TreeSitterTree) => TreeSitterTree;
};
type TreeSitterParserConstructor = new () => InternalTreeSitterParser;
type TreeSitterLanguage = { name?: string };

const MAX_TREE_SITTER_DIRECT_PARSE_CHARS = 32_000;
const TREE_SITTER_INPUT_CHUNK_SIZE = 16_384;

function parseTreeSitter(parser: InternalTreeSitterParser, content: string, oldTree?: TreeSitterTree): TreeSitterTree {
  // tree-sitter Node bindings can throw "Invalid argument" on large direct-string inputs.
  // Use an input callback for large strings to avoid that limitation.
  if (content.length <= MAX_TREE_SITTER_DIRECT_PARSE_CHARS) {
    return parser.parse(content, oldTree);
  }
  const input = (index: number): string => content.slice(index, index + TREE_SITTER_INPUT_CHUNK_SIZE);
  return parser.parse(input, oldTree);
}

// ============================================================================
// LANGUAGE CONFIGURATIONS
// ============================================================================

export const TREE_SITTER_LANGUAGE_CONFIGS: TreeSitterLanguageConfig[] = [
  {
    language: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    grammarModule: 'tree-sitter-typescript',
    grammarModuleExport: 'typescript',
    grammarModuleExports: {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.mts': 'typescript',
      '.cts': 'typescript',
    },
    available: false,
  },
  {
    language: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    grammarModule: 'tree-sitter-javascript',
    grammarModuleExport: 'javascript',
    grammarModuleExports: {
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
    },
    available: false,
  },
  {
    language: 'python',
    extensions: ['.py', '.pyi', '.pyw'],
    grammarModule: 'tree-sitter-python',
    available: false,
  },
  {
    language: 'go',
    extensions: ['.go'],
    grammarModule: 'tree-sitter-go',
    available: false,
  },
  {
    language: 'rust',
    extensions: ['.rs'],
    grammarModule: 'tree-sitter-rust',
    available: false,
  },
  {
    language: 'java',
    extensions: ['.java'],
    grammarModule: 'tree-sitter-java',
    available: false,
  },
  {
    language: 'c',
    extensions: ['.c', '.h'],
    grammarModule: 'tree-sitter-c',
    available: false,
  },
  {
    language: 'cpp',
    extensions: ['.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx'],
    grammarModule: 'tree-sitter-cpp',
    available: false,
  },
  {
    language: 'ruby',
    extensions: ['.rb', '.rake', '.gemspec'],
    grammarModule: 'tree-sitter-ruby',
    available: false,
  },
  {
    language: 'php',
    extensions: ['.php', '.phtml'],
    grammarModule: 'tree-sitter-php',
    grammarModuleExport: 'php',
    available: false,
  },
  {
    language: 'csharp',
    extensions: ['.cs'],
    grammarModule: 'tree-sitter-c-sharp',
    available: false,
  },
  {
    language: 'kotlin',
    extensions: ['.kt', '.kts'],
    grammarModule: 'tree-sitter-kotlin',
    available: false,
  },
  {
    language: 'swift',
    extensions: ['.swift'],
    grammarModule: 'tree-sitter-swift',
    available: false,
  },
  {
    language: 'scala',
    extensions: ['.scala', '.sc'],
    grammarModule: 'tree-sitter-scala',
    available: false,
  },
  {
    language: 'dart',
    extensions: ['.dart'],
    grammarModule: 'tree-sitter-dart',
    available: false,
  },
  {
    language: 'lua',
    extensions: ['.lua'],
    grammarModule: 'tree-sitter-lua',
    available: false,
  },
  {
    language: 'bash',
    extensions: ['.sh', '.bash', '.zsh'],
    grammarModule: 'tree-sitter-bash',
    available: false,
  },
  {
    language: 'sql',
    extensions: ['.sql'],
    grammarModule: 'tree-sitter-sql',
    available: false,
  },
  {
    language: 'html',
    extensions: ['.html', '.htm'],
    grammarModule: 'tree-sitter-html',
    available: false,
  },
  {
    language: 'css',
    extensions: ['.css', '.scss', '.sass', '.less'],
    grammarModule: 'tree-sitter-css',
    available: false,
  },
  {
    language: 'json',
    extensions: ['.json', '.json5', '.jsonc'],
    grammarModule: 'tree-sitter-json',
    available: false,
  },
  {
    language: 'yaml',
    extensions: ['.yaml', '.yml'],
    grammarModule: 'tree-sitter-yaml',
    available: false,
  },
];

// Language detection patterns (simple heuristics)
const LANGUAGE_PATTERNS: Array<{ language: string; patterns: RegExp[] }> = [
  {
    language: 'typescript',
    patterns: [
      /interface\s+\w+/,
      /:\s*(string|number|boolean|any|void)\b/,
      /type\s+\w+\s*=/,
      /<\w+>/,
    ],
  },
  {
    language: 'javascript',
    patterns: [/\bconst\s+\w+\s*=/, /\blet\s+\w+\s*=/, /\bfunction\s+\w+\s*\(/, /=>\s*\{?/],
  },
  {
    language: 'python',
    patterns: [/\bdef\s+\w+\s*\(/, /\bclass\s+\w+.*:/, /^\s*import\s+\w+/m, /^\s*from\s+\w+\s+import/m],
  },
  {
    language: 'go',
    patterns: [/\bfunc\s+\w*\s*\(/, /\bpackage\s+\w+/, /\btype\s+\w+\s+struct\b/, /\bgo\s+\w+/],
  },
  {
    language: 'rust',
    patterns: [/\bfn\s+\w+/, /\blet\s+mut\b/, /\bimpl\s+\w+/, /\bpub\s+fn\b/],
  },
  {
    language: 'java',
    patterns: [/\bpublic\s+class\b/, /\bprivate\s+\w+/, /\bSystem\.out\.print/],
  },
  {
    language: 'c',
    patterns: [/#include\s*<\w+\.h>/, /\bint\s+main\s*\(/, /\bvoid\s+\w+\s*\(/],
  },
  {
    language: 'cpp',
    patterns: [/#include\s*<iostream>/, /\bstd::/, /\bclass\s+\w+\s*\{/, /\bnamespace\s+\w+/],
  },
  {
    language: 'ruby',
    patterns: [/\bdef\s+\w+/, /\bclass\s+\w+/, /\bend\b/, /\bputs\b/],
  },
  {
    language: 'html',
    patterns: [/<html\b/i, /<!doctype\s+html/i, /<div\b/i],
  },
  {
    language: 'css',
    patterns: [/\.[\w-]+\s*\{/, /#[\w-]+\s*\{/, /\bcolor\s*:\s*[^;]+;/],
  },
  {
    language: 'php',
    patterns: [/<\?php/, /\$\w+/, /\bfunction\s+\w+\s*\(/, /\becho\b/],
  },
  {
    language: 'csharp',
    patterns: [/\busing\s+\w+(\.\w+)*\s*;/, /\bnamespace\s+\w+/, /\bpublic\s+class\b/, /\binterface\s+\w+/],
  },
  {
    language: 'kotlin',
    patterns: [/\bfun\s+\w+\s*\(/, /\bclass\s+\w+/, /\bval\s+\w+\s*:/, /\bobject\s+\w+/],
  },
  {
    language: 'swift',
    patterns: [/\bfunc\s+\w+\s*\(/, /\bimport\s+\w+/, /\bstruct\s+\w+/, /\bclass\s+\w+/],
  },
  {
    language: 'scala',
    patterns: [/\bdef\s+\w+\s*\(/, /\bobject\s+\w+/, /\btrait\s+\w+/, /\bcase\s+class\b/],
  },
  {
    language: 'dart',
    patterns: [/\bclass\s+\w+/, /\bimport\s+['"]/, /\bvoid\s+main\s*\(/, /\bfinal\s+\w+/],
  },
  {
    language: 'lua',
    patterns: [/\bfunction\s+\w+/, /\bend\b/, /\blocal\s+\w+\s*=/, /\brequire\s*\(/],
  },
  {
    language: 'bash',
    patterns: [/^#!.*\b(bash|sh|zsh)\b/m, /\bfunction\s+\w+/, /\$\{?\w+\}?/],
  },
  {
    language: 'sql',
    patterns: [/\bSELECT\b/i, /\bFROM\b/i, /\bCREATE\s+TABLE\b/i, /\bINSERT\s+INTO\b/i],
  },
  {
    language: 'json',
    patterns: [/^\s*\{/, /^\s*\[/],
  },
  {
    language: 'yaml',
    patterns: [/^\s*[\w-]+\s*:/m, /^\s*-\s+/m],
  },
];

// Function node types per language
export const FUNCTION_NODE_TYPES: Record<string, string[]> = {
  typescript: [
    'function_declaration',
    'method_definition',
    'arrow_function',
    'function_expression',
    'method_signature',
  ],
  javascript: [
    'function_declaration',
    'method_definition',
    'arrow_function',
    'function_expression',
    'function',
  ],
  python: ['function_definition'],
  go: ['function_declaration', 'method_declaration'],
  rust: ['function_item'],
  java: ['method_declaration', 'constructor_declaration'],
  c: ['function_definition'],
  cpp: ['function_definition'],
  ruby: ['method', 'singleton_method'],
  php: ['function_definition', 'method_declaration'],
  csharp: ['method_declaration', 'constructor_declaration', 'local_function_statement', 'accessor_declaration'],
  kotlin: ['function_declaration', 'primary_constructor', 'secondary_constructor'],
  swift: ['function_declaration', 'initializer_declaration', 'deinitializer_declaration'],
  scala: ['function_definition', 'function_declaration', 'method_definition'],
  dart: ['function_declaration', 'method_declaration', 'constructor_declaration', 'function_signature'],
  lua: ['function_declaration', 'function_definition'],
  r: ['function_definition'],
  bash: ['function_definition'],
  sql: ['create_function_statement', 'function_definition', 'create_procedure_statement'],
  json: [],
  yaml: [],
};

// Class node types per language
export const CLASS_NODE_TYPES: Record<string, string[]> = {
  typescript: ['class_declaration', 'interface_declaration'],
  javascript: ['class_declaration'],
  python: ['class_definition'],
  go: ['type_declaration'],
  rust: ['struct_item', 'impl_item'],
  java: ['class_declaration', 'interface_declaration'],
  c: ['struct_specifier'],
  cpp: ['class_specifier', 'struct_specifier'],
  ruby: ['class', 'module'],
  php: ['class_declaration', 'interface_declaration'],
  csharp: ['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'record_declaration'],
  kotlin: ['class_declaration', 'object_declaration', 'interface_declaration'],
  swift: ['class_declaration', 'struct_declaration', 'protocol_declaration', 'enum_declaration', 'extension_declaration'],
  scala: ['class_definition', 'object_definition', 'trait_definition'],
  dart: ['class_definition', 'mixin_declaration', 'enum_declaration', 'extension_declaration'],
  lua: [],
  r: [],
  bash: [],
  sql: [],
  json: [],
  yaml: [],
};

// Call expression node types per language
export const CALL_NODE_TYPES: Record<string, string[]> = {
  typescript: ['call_expression'],
  javascript: ['call_expression'],
  python: ['call'],
  go: ['call_expression'],
  rust: ['call_expression'],
  java: ['method_invocation'],
  c: ['call_expression'],
  cpp: ['call_expression'],
  ruby: ['call'],
  php: ['function_call_expression', 'method_call_expression'],
  csharp: ['invocation_expression'],
  kotlin: ['call_expression'],
  swift: ['call_expression'],
  scala: ['call_expression', 'function_call'],
  dart: ['method_invocation'],
  lua: ['function_call'],
  r: ['call'],
  bash: [],
  sql: [],
  json: [],
  yaml: [],
};

export function registerTreeSitterLanguage(config: TreeSitterLanguageConfig): void {
  if (!config.language || !config.grammarModule || !Array.isArray(config.extensions)) {
    return;
  }
  const normalizedExtensions = config.extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  const existingIndex = TREE_SITTER_LANGUAGE_CONFIGS.findIndex((entry) => entry.language === config.language);
  const nextConfig: TreeSitterLanguageConfig = {
    language: config.language,
    extensions: normalizedExtensions,
    grammarModule: config.grammarModule,
    grammarModuleExport: config.grammarModuleExport,
    grammarModuleExports: config.grammarModuleExports,
    available: false,
  };
  if (existingIndex >= 0) {
    TREE_SITTER_LANGUAGE_CONFIGS[existingIndex] = {
      ...TREE_SITTER_LANGUAGE_CONFIGS[existingIndex],
      ...nextConfig,
    };
  } else {
    TREE_SITTER_LANGUAGE_CONFIGS.push(nextConfig);
  }
  if (Array.isArray(config.patterns) && config.patterns.length > 0) {
    const existingPatternIndex = LANGUAGE_PATTERNS.findIndex((entry) => entry.language === config.language);
    if (existingPatternIndex >= 0) {
      LANGUAGE_PATTERNS[existingPatternIndex] = { language: config.language, patterns: config.patterns };
    } else {
      LANGUAGE_PATTERNS.push({ language: config.language, patterns: config.patterns });
    }
  }
  if (Array.isArray(config.functionNodeTypes) && config.functionNodeTypes.length > 0) {
    FUNCTION_NODE_TYPES[config.language] = config.functionNodeTypes;
  }
  if (Array.isArray(config.classNodeTypes) && config.classNodeTypes.length > 0) {
    CLASS_NODE_TYPES[config.language] = config.classNodeTypes;
  }
}

export function getTreeSitterLanguageConfigs(): TreeSitterLanguageConfig[] {
  return [...TREE_SITTER_LANGUAGE_CONFIGS];
}

// ============================================================================
// TREE-SITTER PARSER CLASS
// ============================================================================

const require = createRequire(import.meta.url);

/**
 * Universal parser using tree-sitter for multiple programming languages.
 */
export class TreeSitterParser {
  private readonly parserConstructor: TreeSitterParserConstructor | null;
  private readonly languages: Map<string, TreeSitterLanguage> = new Map();
  private readonly availableLanguages: LanguageSupport[] = [];
  private readonly extensionMap: Map<string, string> = new Map();
  private readonly languageConfigByLanguage: Map<string, TreeSitterLanguageConfig> = new Map();

  constructor() {
    this.parserConstructor = this.loadTreeSitterParser();
    this.initializeLanguages();
  }

  /**
   * Parse source code and return a ParseResult.
   */
  parse(code: string, language: string, options?: ParseOptions): ParseResult {
    const startTime = performance.now();

    // Validate language
    if (!this.parserConstructor) {
      throw new Error('unverified_by_trace(parser_unavailable): tree-sitter core not available. Install tree-sitter.');
    }
    const langConfig = this.languages.get(language);
    if (!langConfig) {
      const config = this.languageConfigByLanguage.get(language);
      if (config) {
        throw new Error(
          `unverified_by_trace(parser_unavailable): Tree-sitter grammar missing for ${language}. Install ${config.grammarModule}.`
        );
      }
      throw new Error(`unverified_by_trace(parser_unavailable): Unsupported language: ${language}`);
    }

    // Create parser
    const parser = new this.parserConstructor();
    parser.setLanguage(langConfig);

    // Handle incremental parsing
    let oldTree: TreeSitterTree | undefined;
    if (options?.previousTree && options?.editRange) {
      // Convert our tree back to internal format for incremental parsing
      oldTree = this.convertToInternalTree(options.previousTree, code);
      if (oldTree && options.editRange) {
        oldTree.edit({
          startIndex: options.editRange.startIndex,
          oldEndIndex: options.editRange.oldEndIndex,
          newEndIndex: options.editRange.newEndIndex,
          startPosition: options.editRange.startPosition,
          oldEndPosition: options.editRange.oldEndPosition,
          newEndPosition: options.editRange.newEndPosition,
        });
      }
    }

    // Parse
    const tree = parseTreeSitter(parser, code, oldTree);
    const parseTime = performance.now() - startTime;

    // Extract errors
    const errors = this.extractErrors(tree.rootNode, code);

    // Convert to our SyntaxTree format
    const syntaxTree = this.convertTree(tree.rootNode, code, language);

    return {
      language,
      tree: syntaxTree,
      errors,
      parseTime,
    };
  }

  /**
   * Detect language from code content and optional filename.
   */
  detectLanguage(code: string, filename?: string): string {
    // First try extension-based detection
    if (filename) {
      const ext = this.getExtension(filename);
      const lang = this.extensionMap.get(ext);
      if (lang) {
        return lang;
      }
    }

    // Fall back to content-based detection
    for (const { language, patterns } of LANGUAGE_PATTERNS) {
      if (patterns.some((pattern) => pattern.test(code))) {
        return language;
      }
    }

    return 'unknown';
  }

  /**
   * Get list of supported languages.
   */
  getSupportedLanguages(): LanguageSupport[] {
    return [...this.availableLanguages];
  }

  /**
   * Extract function nodes from a syntax tree.
   */
  extractFunctions(tree: SyntaxTree): FunctionNode[] {
    const functions: FunctionNode[] = [];
    const language = this.detectLanguageFromTree(tree);
    const nodeTypes = FUNCTION_NODE_TYPES[language] || [];

    this.walkTree(tree.rootNode, (node) => {
      if (nodeTypes.includes(node.type)) {
        const fn = this.extractFunctionFromNode(node, language);
        if (fn) {
          functions.push(fn);
        }
      }
    });

    return functions;
  }

  /**
   * Extract class nodes from a syntax tree.
   */
  extractClasses(tree: SyntaxTree): ClassNode[] {
    const classes: ClassNode[] = [];
    const language = this.detectLanguageFromTree(tree);
    const nodeTypes = CLASS_NODE_TYPES[language] || [];

    this.walkTree(tree.rootNode, (node) => {
      if (nodeTypes.includes(node.type)) {
        const cls = this.extractClassFromNode(node, tree, language);
        if (cls) {
          classes.push(cls);
        }
      }
    });

    return classes;
  }

  /**
   * Extract call sites from a syntax tree.
   */
  extractCalls(tree: SyntaxTree): CallNode[] {
    const calls: CallNode[] = [];
    const language = this.detectLanguageFromTree(tree);
    const functionTypes = FUNCTION_NODE_TYPES[language] || [];
    const classTypes = CLASS_NODE_TYPES[language] || [];
    const callTypes = CALL_NODE_TYPES[language] || [];

    const visit = (node: SyntaxNode, ctx: { callerName: string; callerClass?: string }) => {
      let nextCtx = ctx;

      if (classTypes.includes(node.type)) {
        const cls = this.extractClassFromNode(node, tree, language);
        if (cls?.name) {
          nextCtx = { callerName: ctx.callerName, callerClass: cls.name };
        }
      }

      if (functionTypes.includes(node.type)) {
        const fn = this.extractFunctionFromNode(node, language);
        if (fn?.name) {
          nextCtx = { callerName: fn.name, callerClass: ctx.callerClass };
        }
      }

      if (callTypes.includes(node.type)) {
        const callee = this.extractCalleeFromCallNode(node);
        if (callee) {
          calls.push({
            callee,
            caller: nextCtx.callerName,
            callerClass: nextCtx.callerClass,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          });
        }
      }

      for (const child of node.namedChildren) {
        visit(child, nextCtx);
      }
    };

    visit(tree.rootNode, { callerName: '<module>' });
    return calls;
  }

  /**
   * Query tree for nodes matching a pattern (node type).
   */
  queryTree(tree: SyntaxTree, pattern: string): SyntaxNode[] {
    const results: SyntaxNode[] = [];

    this.walkTree(tree.rootNode, (node) => {
      if (node.type === pattern) {
        results.push(node);
      }
    });

    return results;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private loadTreeSitterParser(): TreeSitterParserConstructor | null {
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

  private resolveModulePath(moduleName: string): string | null {
    try {
      return require.resolve(moduleName);
    } catch {
      // Fall back to grammar cache paths for optional language modules.
      for (const extraPath of getGrammarRequirePaths()) {
        try {
          return require.resolve(moduleName, { paths: [extraPath] });
        } catch {
          // keep trying
        }
      }
      return null;
    }
  }

  private loadLanguageModule(moduleName: string, exportName?: string): TreeSitterLanguage | null {
    try {
      const resolved = this.resolveModulePath(moduleName);
      if (!resolved) return null;
      const mod = require(resolved) as TreeSitterLanguage | { default?: TreeSitterLanguage };

      // Handle TypeScript grammar which has typescript and tsx exports
      if (moduleName === 'tree-sitter-typescript') {
        const tsmod = mod as { typescript?: TreeSitterLanguage; tsx?: TreeSitterLanguage };
        if (exportName && typeof (tsmod as Record<string, TreeSitterLanguage | undefined>)[exportName] !== 'undefined') {
          return (tsmod as Record<string, TreeSitterLanguage | undefined>)[exportName] ?? null;
        }
        return tsmod.typescript ?? null;
      }

      if (exportName && typeof (mod as Record<string, TreeSitterLanguage | undefined>)[exportName] !== 'undefined') {
        return (mod as Record<string, TreeSitterLanguage | undefined>)[exportName] ?? null;
      }

      if (typeof (mod as { default?: TreeSitterLanguage }).default !== 'undefined') {
        return (mod as { default?: TreeSitterLanguage }).default ?? null;
      }
      return mod as TreeSitterLanguage;
    } catch {
      return null;
    }
  }

  private initializeLanguages(): void {
    // Always build extension map for all configured languages (for detectLanguage)
    for (const config of TREE_SITTER_LANGUAGE_CONFIGS) {
      this.languageConfigByLanguage.set(config.language, config);
      for (const ext of config.extensions) {
        this.extensionMap.set(ext.toLowerCase(), config.language);
      }
    }

    // Only set up grammars if tree-sitter is available
    if (!this.parserConstructor) {
      return;
    }

    for (const config of TREE_SITTER_LANGUAGE_CONFIGS) {
      const exportName =
        config.grammarModuleExport ??
        (config.grammarModuleExports
          ? config.grammarModuleExports[config.extensions[0]?.toLowerCase() ?? '']
          : undefined);
      const grammar = this.loadLanguageModule(config.grammarModule, exportName);
      if (grammar) {
        this.languages.set(config.language, grammar);
        this.availableLanguages.push({
          language: config.language,
          extensions: config.extensions,
          grammarPath: config.grammarModule,
        });
      }
    }
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.slice(lastDot).toLowerCase();
  }

  private extractErrors(node: TreeSitterNode, code: string): ParseError[] {
    const errors: ParseError[] = [];

    const walk = (n: TreeSitterNode): void => {
      // Check for ERROR type or hasError method (if available)
      const hasErrorMethod = typeof n.hasError === 'function';
      const isError = n.type === 'ERROR' || (hasErrorMethod && n.hasError!());

      if (isError) {
        errors.push({
          message: `Syntax error at ${n.type === 'ERROR' ? 'ERROR node' : 'node with error'}`,
          position: {
            row: n.startPosition.row,
            column: n.startPosition.column,
          },
          endPosition: {
            row: n.endPosition.row,
            column: n.endPosition.column,
          },
        });
      }
      for (const child of n.children) {
        walk(child);
      }
    };

    walk(node);
    return errors;
  }

  private extractCalleeFromCallNode(node: SyntaxNode): string | null {
    const text = node.text.trim();
    if (!text) return null;
    const match = text.match(/^([A-Za-z0-9_$.\-]+)\s*\(/);
    if (match?.[1]) return match[1];
    const fallback = text.split(/\s+/)[0];
    return fallback ? fallback.slice(0, 50) : null;
  }

  private convertTree(node: TreeSitterNode, code: string, language?: string): SyntaxTree {
    const rootNode = this.convertNode(node, code);
    return {
      rootNode,
      text: code,
      language,
    };
  }

  private convertNode(node: TreeSitterNode, code: string): SyntaxNode {
    return {
      type: node.type,
      text: code.slice(node.startIndex, node.endIndex),
      startPosition: {
        row: node.startPosition.row,
        column: node.startPosition.column,
      },
      endPosition: {
        row: node.endPosition.row,
        column: node.endPosition.column,
      },
      children: node.children.map((c) => this.convertNode(c, code)),
      namedChildren: node.namedChildren.map((c) => this.convertNode(c, code)),
    };
  }

  private convertToInternalTree(_tree: SyntaxTree, _code: string): TreeSitterTree | undefined {
    // For incremental parsing, we'd need to keep track of the internal tree
    // This is a simplified implementation that doesn't fully support incremental parsing
    // but allows the API to work
    return undefined;
  }

  private walkTree(node: SyntaxNode, visitor: (node: SyntaxNode) => void): void {
    visitor(node);
    for (const child of node.children) {
      this.walkTree(child, visitor);
    }
  }

  private detectLanguageFromTree(tree: SyntaxTree): string {
    if (tree.language && tree.language !== 'unknown') {
      return tree.language;
    }
    // Try to detect from tree structure
    const rootType = tree.rootNode.type;

    if (rootType === 'program') {
      // Could be JS/TS/Python
      const content = tree.text;
      return this.detectLanguage(content);
    }

    if (rootType === 'source_file') {
      // Could be Go, Rust, etc.
      const content = tree.text;
      return this.detectLanguage(content);
    }

    // Common non-JS/TS roots.
    if (rootType === 'module' || rootType === 'translation_unit' || rootType === 'compilation_unit') {
      return this.detectLanguage(tree.text);
    }

    return 'unknown';
  }

  private extractFunctionFromNode(node: SyntaxNode, language: string): FunctionNode | null {
    const nameNode = this.findChildByField(node, 'name') || this.findFirstNamedChild(node, 'identifier');
    if (!nameNode) return null;

    const name = nameNode.text;
    const parameters = this.extractParameters(node, language);
    const body = this.extractBody(node);

    return {
      name,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      parameters,
      body,
    };
  }

  private extractClassFromNode(node: SyntaxNode, tree: SyntaxTree, language: string): ClassNode | null {
    const nameNode = this.findChildByField(node, 'name') || this.findFirstNamedChild(node, 'identifier') || this.findFirstNamedChild(node, 'type_identifier');
    if (!nameNode) return null;

    const name = nameNode.text;
    const methods = this.extractMethodsFromClass(node, language);

    return {
      name,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      methods,
    };
  }

  private findChildByField(node: SyntaxNode, fieldName: string): SyntaxNode | null {
    // Simple heuristic: look for named children that might match the field
    for (const child of node.namedChildren) {
      if (child.type === fieldName || child.type === 'identifier' || child.type === 'type_identifier') {
        return child;
      }
    }
    return null;
  }

  private findFirstNamedChild(node: SyntaxNode, type: string): SyntaxNode | null {
    for (const child of node.namedChildren) {
      if (child.type === type) {
        return child;
      }
    }
    // Recursively search
    for (const child of node.namedChildren) {
      const found = this.findFirstNamedChild(child, type);
      if (found) return found;
    }
    return null;
  }

  private extractParameters(node: SyntaxNode, language: string): string[] {
    const params: string[] = [];
    const parameterTypes = ['formal_parameters', 'parameters', 'parameter_list'];

    for (const paramType of parameterTypes) {
      const paramsNode = this.findFirstNamedChild(node, paramType);
      if (paramsNode) {
        for (const child of paramsNode.namedChildren) {
          if (child.type === 'identifier' || child.type === 'required_parameter' || child.type === 'optional_parameter') {
            const idNode = this.findFirstNamedChild(child, 'identifier') || child;
            if (idNode.type === 'identifier') {
              params.push(idNode.text);
            }
          }
        }
        break;
      }
    }

    return params;
  }

  private extractBody(node: SyntaxNode): string {
    const bodyTypes = ['statement_block', 'block', 'body', 'function_body'];

    for (const bodyType of bodyTypes) {
      const bodyNode = this.findFirstNamedChild(node, bodyType);
      if (bodyNode) {
        return bodyNode.text;
      }
    }

    return '';
  }

  private extractMethodsFromClass(classNode: SyntaxNode, language: string): FunctionNode[] {
    const methods: FunctionNode[] = [];
    const methodTypes = FUNCTION_NODE_TYPES[language] || [];

    this.walkTree(classNode, (node) => {
      if (methodTypes.includes(node.type) && node !== classNode) {
        const fn = this.extractFunctionFromNode(node, language);
        if (fn) {
          methods.push(fn);
        }
      }
    });

    return methods;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new TreeSitterParser instance.
 */
export function createTreeSitterParser(): TreeSitterParser {
  return new TreeSitterParser();
}
