import { createRequire } from 'node:module';
import * as path from 'path';
import { Project, SyntaxKind, Node, type SourceFile } from 'ts-morph';
import { CoverageTracker, type CoverageReport } from '../api/coverage.js';
import { emptyArray } from '../api/empty_values.js';
import { FUNCTION_NODE_TYPES, getTreeSitterLanguageConfigs, type TreeSitterLanguageConfig } from './parsers/tree_sitter_parser.js';

export interface ParsedFunction {
  name: string;
  signature: string;
  startLine: number;
  endLine: number;
  purpose: string;
}

export interface ParsedModule {
  exports: string[];
  dependencies: string[];
}

export interface ParserResult {
  parser: string;
  functions: ParsedFunction[];
  module: ParsedModule;
}

export interface SourceParser {
  name: string;
  parse(filePath: string, content: string): Omit<ParserResult, 'parser'>;
}

type TreeSitterPoint = { row: number; column: number };
type TreeSitterNode = {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  namedChildren: TreeSitterNode[];
  childForFieldName: (field: string) => TreeSitterNode | null;
};
type TreeSitterTree = { rootNode: TreeSitterNode };
type TreeSitterInput = string | ((index: number) => string);
type TreeSitterParser = { setLanguage: (language: TreeSitterLanguage) => void; parse: (content: TreeSitterInput) => TreeSitterTree };
type TreeSitterParserConstructor = new () => TreeSitterParser;
type TreeSitterLanguage = { name?: string };
type TreeSitterLanguageLoadError = 'module_missing' | 'export_missing' | 'invalid_module';
type TreeSitterLanguageLoadResult = { language: TreeSitterLanguage | null; error?: TreeSitterLanguageLoadError };

const require = createRequire(import.meta.url);
const MAX_TREE_SITTER_DIRECT_PARSE_CHARS = 32_000;
const TREE_SITTER_INPUT_CHUNK_SIZE = 16_384;

function parseTreeSitter(parser: TreeSitterParser, content: string): TreeSitterTree {
  // tree-sitter Node bindings can throw "Invalid argument" on large direct-string inputs.
  // Use an input callback for large strings to avoid that limitation.
  if (content.length <= MAX_TREE_SITTER_DIRECT_PARSE_CHARS) {
    return parser.parse(content);
  }
  return parser.parse((index: number) => content.slice(index, index + TREE_SITTER_INPUT_CHUNK_SIZE));
}

function loadTreeSitterParser(): TreeSitterParserConstructor | null {
  try {
    // tree-sitter exports the Parser class directly as the default export
    const Parser = require('tree-sitter') as TreeSitterParserConstructor;
    // Verify it's a constructor function
    if (typeof Parser === 'function') {
      return Parser;
    }
    return null;
  } catch {
    return null;
  }
}

type TreeSitterModule = { Parser: TreeSitterParserConstructor };

function loadTreeSitterModule(): TreeSitterModule | null {
  const Parser = loadTreeSitterParser();
  if (!Parser) return null;
  return { Parser };
}

function loadTreeSitterLanguage(moduleName: string, exportName?: string): TreeSitterLanguageLoadResult {
  try {
    const mod = require(moduleName) as TreeSitterLanguage | { default?: TreeSitterLanguage };
    if (exportName) {
      const named = (mod as Record<string, TreeSitterLanguage | undefined>)[exportName];
      if (typeof named === 'undefined') {
        return { language: null, error: 'export_missing' };
      }
      return { language: named ?? null };
    }
    if (typeof (mod as { default?: TreeSitterLanguage }).default !== 'undefined') {
      return { language: (mod as { default?: TreeSitterLanguage }).default ?? null };
    }
    return { language: mod as TreeSitterLanguage };
  } catch {
    return { language: null, error: 'module_missing' };
  }
}

function walkTree(node: TreeSitterNode, visitor: (node: TreeSitterNode) => void): void {
  visitor(node);
  for (const child of node.namedChildren) {
    walkTree(child, visitor);
  }
}

function nodeText(content: string, node: TreeSitterNode): string {
  return content.slice(node.startIndex, node.endIndex);
}

function buildTreeSitterSignature(content: string, node: TreeSitterNode, bodyField: string | null): string {
  if (bodyField) {
    const body = node.childForFieldName(bodyField);
    if (body) {
      return content.slice(node.startIndex, body.startIndex).trim().replace(/\s+$/g, '');
    }
  }
  return nodeText(content, node).split('\n')[0]?.trim() ?? '';
}

function buildParsedFunctionFromNode(
  node: TreeSitterNode,
  content: string,
  nameNode: TreeSitterNode | null,
  signature: string
): ParsedFunction | null {
  const name = nameNode ? nodeText(content, nameNode).trim() : '';
  if (!name) return null;
  return {
    name,
    signature: signature || name,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    purpose: '',
  };
}

function findNamedChild(node: TreeSitterNode, types: string[]): TreeSitterNode | null {
  for (const child of node.namedChildren) {
    if (types.includes(child.type)) return child;
  }
  return null;
}

function extractDependenciesFromImportText(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  const dependencies: string[] = [];
  const includeMatch = cleaned.match(/#include\s+[<"]([^>"]+)[>"]/);
  if (includeMatch?.[1]) dependencies.push(includeMatch[1]);
  const usingMatch = cleaned.match(/\busing\s+([^\s;]+)\s*;/);
  if (usingMatch?.[1]) dependencies.push(usingMatch[1]);
  const importFromMatch = cleaned.match(/\bfrom\s+([^\s]+)\s+import\b/);
  if (importFromMatch?.[1]) dependencies.push(importFromMatch[1]);
  const importMatch = cleaned.match(/\bimport\s+([^\s'";]+)\s*;?/);
  if (importMatch?.[1]) dependencies.push(importMatch[1]);
  const importStringMatch = cleaned.match(/\bimport\s+['"]([^'"]+)['"]/);
  if (importStringMatch?.[1]) dependencies.push(importStringMatch[1]);
  const requireMatch = cleaned.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (requireMatch?.[1]) dependencies.push(requireMatch[1]);
  return dependencies;
}

function parseGenericModule(
  root: TreeSitterNode,
  content: string,
  functionNodeTypes: string[]
): Omit<ParserResult, 'parser'> {
  const functions: ParsedFunction[] = [];
  const dependencies = new Set<string>();
  const importNodeTypes = new Set([
    'import_statement',
    'import_declaration',
    'import_clause',
    'import_spec',
    'import_from_statement',
    'using_directive',
    'using_declaration',
    'namespace_use_declaration',
    'preproc_include',
    'include',
    'require_call',
  ]);

  walkTree(root, (node) => {
    if (functionNodeTypes.includes(node.type)) {
      const nameNode =
        node.childForFieldName('name') ??
        node.childForFieldName('identifier') ??
        findNamedChild(node, ['identifier', 'type_identifier', 'name']);
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    if (importNodeTypes.has(node.type)) {
      const text = nodeText(content, node);
      for (const dep of extractDependenciesFromImportText(text)) {
        if (dep) dependencies.add(dep);
      }
    }
  });

  return {
    functions,
    module: { exports: emptyArray<string>(), dependencies: Array.from(dependencies) },
  };
}

function parseDeterministicFallbackModule(language: string, content: string): Omit<ParserResult, 'parser'> {
  // Deterministic, provider-free fallback when full parsers are unavailable (e.g. missing tree-sitter grammars).
  // This prevents "0 files indexed" and keeps Librarian usable in constrained environments.
  const functions: ParsedFunction[] = [];
  const dependencies = new Set<string>();

  const lines = content.split(/\r?\n/);
  const addFunction = (name: string, signature: string, lineIndex: number): void => {
    const cleanedName = name.trim();
    if (!cleanedName) return;
    functions.push({
      name: cleanedName,
      signature: signature.trim() || cleanedName,
      startLine: lineIndex + 1,
      endLine: lineIndex + 1,
      purpose: '',
    });
  };

  const importLineRegexes: RegExp[] = [
    /^\s*import\s+.+/i,
    /^\s*from\s+\S+\s+import\s+.+/i,
    /^\s*#include\s+[<"].+[>"]/i,
    /^\s*using\s+\S+/i,
    /^\s*require\s*\(.+\)/i,
  ];

  // Language-specific, conservative definition regexes.
  const fnPatterns: Array<{ re: RegExp; nameIndex: number }> = [];
  switch (language) {
    case 'kotlin':
      fnPatterns.push({ re: /^\s*(?:[\w@\s]+\s+)?fun\s+(?:[A-Za-z0-9_<>,.?]+\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*object\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      break;
    case 'swift':
      fnPatterns.push({ re: /^\s*(?:@[\w.]+\s+)?(?:public|private|fileprivate|internal|open)?\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:public|private|fileprivate|internal|open)?\s*(?:class|struct|enum|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      break;
    case 'ruby':
      fnPatterns.push({ re: /^\s*def\s+([A-Za-z_][A-Za-z0-9_!?=]*)\b/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:class|module)\s+([A-Za-z_][A-Za-z0-9_:]*)\b/, nameIndex: 1 });
      break;
    case 'php':
      fnPatterns.push({ re: /^\s*(?:public|private|protected)?\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/i, nameIndex: 1 });
      break;
    case 'csharp':
      fnPatterns.push({ re: /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|virtual|override|async|sealed|extern|partial|new|unsafe|readonly)\s+)+[A-Za-z0-9_<>,\[\]?]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:public|private|protected|internal)?\s*(?:abstract\s+|sealed\s+|partial\s+)?(?:class|interface|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      break;
    case 'scala':
      fnPatterns.push({ re: /^\s*(?:def|val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:class|object|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      break;
    case 'dart':
      fnPatterns.push({ re: /^\s*(?:@[\w.]+\s+)?(?:[A-Za-z_][A-Za-z0-9_<>,\[\]\s?]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:async\s*)?(?:=>|\{)/, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*(?:abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/, nameIndex: 1 });
      break;
    case 'lua':
      fnPatterns.push({ re: /^\s*(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_\. :]*)\s*\(/, nameIndex: 1 });
      break;
    case 'c':
    case 'cpp':
      fnPatterns.push({ re: /^\s*[A-Za-z_][A-Za-z0-9_\s\*\:&<>]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{/, nameIndex: 1 });
      break;
    default:
      // Generic fallback: look for "function name(" and "def name".
      fnPatterns.push({ re: /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i, nameIndex: 1 });
      fnPatterns.push({ re: /^\s*def\s+([A-Za-z_][A-Za-z0-9_!?=]*)\b/i, nameIndex: 1 });
      break;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const re of importLineRegexes) {
      if (re.test(line)) {
        for (const dep of extractDependenciesFromImportText(line)) {
          if (dep) dependencies.add(dep);
        }
        break;
      }
    }
    for (const pattern of fnPatterns) {
      const match = line.match(pattern.re);
      if (match?.[pattern.nameIndex]) {
        addFunction(match[pattern.nameIndex], line, i);
        break;
      }
    }
  }

  return {
    functions,
    module: { exports: emptyArray<string>(), dependencies: Array.from(dependencies) },
  };
}

class DeterministicFallbackParser implements SourceParser {
  readonly name: string;
  private readonly language: string;

  constructor(language: string) {
    this.language = language;
    this.name = `deterministic-fallback:${language}`;
  }

  parse(_filePath: string, content: string): Omit<ParserResult, 'parser'> {
    return parseDeterministicFallbackModule(this.language, content);
  }
}

function parsePythonModule(root: TreeSitterNode, content: string): Omit<ParserResult, 'parser'> {
  const functions: ParsedFunction[] = [];
  const dependencies = new Set<string>();

  walkTree(root, (node) => {
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    if (node.type === 'import_statement') {
      const text = nodeText(content, node).trim().replace(/^import\s+/i, '');
      for (const entry of text.split(',')) {
        const token = entry.trim().split(/\s+/)[0];
        if (token) dependencies.add(token);
      }
    }

    if (node.type === 'import_from_statement') {
      const text = nodeText(content, node);
      const match = text.match(/from\s+([^\s]+)\s+import/i);
      if (match?.[1]) dependencies.add(match[1]);
    }
  });

  return {
    functions,
    module: { exports: emptyArray<string>(), dependencies: Array.from(dependencies) },
  };
}

function parseGoModule(root: TreeSitterNode, content: string): Omit<ParserResult, 'parser'> {
  const functions: ParsedFunction[] = [];
  const dependencies = new Set<string>();

  walkTree(root, (node) => {
    if (node.type === 'function_declaration' || node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    if (node.type === 'import_spec' || node.type === 'import_declaration') {
      const text = nodeText(content, node);
      const match = text.match(/"([^"]+)"/);
      if (match?.[1]) dependencies.add(match[1]);
    }
  });

  return {
    functions,
    module: { exports: emptyArray<string>(), dependencies: Array.from(dependencies) },
  };
}

function parseRustModule(root: TreeSitterNode, content: string): Omit<ParserResult, 'parser'> {
  const functions: ParsedFunction[] = [];
  const dependencies = new Set<string>();

  walkTree(root, (node) => {
    if (node.type === 'function_item') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    if (node.type === 'use_declaration') {
      const text = nodeText(content, node);
      const match = text.match(/use\s+([^;]+);/);
      if (match?.[1]) dependencies.add(match[1].trim());
    }
  });

  return {
    functions,
    module: { exports: emptyArray<string>(), dependencies: Array.from(dependencies) },
  };
}

function parseJavaModule(root: TreeSitterNode, content: string): Omit<ParserResult, 'parser'> {
  const functions: ParsedFunction[] = [];
  const dependencies = new Set<string>();

  walkTree(root, (node) => {
    // Extract class declarations
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    // Extract interface declarations
    if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    // Extract enum declarations
    if (node.type === 'enum_declaration') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    // Extract method declarations
    if (node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    // Extract constructor declarations
    if (node.type === 'constructor_declaration') {
      const nameNode = node.childForFieldName('name');
      const signature = buildTreeSitterSignature(content, node, 'body');
      const parsed = buildParsedFunctionFromNode(node, content, nameNode, signature);
      if (parsed) functions.push(parsed);
    }

    // Extract import declarations
    if (node.type === 'import_declaration') {
      const text = nodeText(content, node).trim();
      // Match: import com.example.Foo; or import com.example.*;
      const match = text.match(/import\s+(?:static\s+)?([^;]+);/);
      if (match?.[1]) {
        const importPath = match[1].trim();
        // Remove wildcard if present
        const cleanPath = importPath.replace(/\.\*$/, '');
        dependencies.add(cleanPath);
      }
    }
  });

  return {
    functions,
    module: { exports: emptyArray<string>(), dependencies: Array.from(dependencies) },
  };
}

class TreeSitterParserAdapter implements SourceParser {
  readonly name: string;
  private readonly parserCtor: new () => TreeSitterParser;
  private readonly language: TreeSitterLanguage;
  private readonly parseModule: (root: TreeSitterNode, content: string) => Omit<ParserResult, 'parser'>;

  constructor(
    name: string,
    parserCtor: new () => TreeSitterParser,
    language: TreeSitterLanguage,
    parseModule: (root: TreeSitterNode, content: string) => Omit<ParserResult, 'parser'>
  ) {
    this.name = name;
    this.parserCtor = parserCtor;
    this.language = language;
    this.parseModule = parseModule;
  }

  parse(_filePath: string, content: string): Omit<ParserResult, 'parser'> {
    const parser = new this.parserCtor();
    parser.setLanguage(this.language);
    const tree = parseTreeSitter(parser, content);
    return this.parseModule(tree.rootNode, content);
  }
}

export class ParserRegistry {
  private static instance: ParserRegistry | null = null;

  private readonly parsers = new Map<string, SourceParser>();
  private readonly coverage: CoverageTracker;
  private readonly treeSitterConfigs = getTreeSitterLanguageConfigs();
  private readonly treeSitterConfigByExtension = new Map<string, TreeSitterLanguageConfig>();
  private readonly treeSitterExportByExtension = new Map<string, string | undefined>();
  private readonly treeSitterMissingByExtension = new Map<string, { module: string; exportName?: string; language: string; reason: TreeSitterLanguageLoadError | 'core_missing' }>();
  private treeSitterCoreAvailable = false;

  private constructor() {
    this.coverage = new CoverageTracker();
    const tsParser = new TsMorphParser();
    this.registerParser(tsParser, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
    this.initializeTreeSitterConfigMaps();
    this.registerTreeSitterParsers();
  }

  static getInstance(): ParserRegistry {
    if (!ParserRegistry.instance) {
      ParserRegistry.instance = new ParserRegistry();
    }
    return ParserRegistry.instance;
  }

  registerParser(parser: SourceParser, extensions: string[]): void {
    if (parser.name === 'regex') {
      throw new Error('unverified_by_trace(regex_parser_disallowed): Regex parsing is forbidden');
    }
    for (const ext of extensions) {
      const normalized = normalizeExtension(ext);
      if (!normalized) continue;
      this.parsers.set(normalized, parser);
    }
  }

  parseFile(filePath: string, content: string): ParserResult {
    const ext = normalizeExtension(path.extname(filePath));
    const parser = ext ? this.parsers.get(ext) : undefined;
    if (!parser) {
      this.coverage.recordCoverageGap(ext);
      throw new Error(this.buildParserUnavailableMessage(ext, filePath));
    }
    if (parser.name === 'regex') {
      throw new Error(
        `unverified_by_trace(regex_parser_disallowed): Regex parsing is forbidden (${filePath})`
      );
    }

    let result: Omit<ParserResult, 'parser'>;
    try {
      result = parser.parse(filePath, content);
    } catch (error: unknown) {
      this.coverage.recordCoverageGap(ext);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`unverified_by_trace(parser_failed): ${message}`);
    }

    this.coverage.recordParser(parser.name);

    return {
      parser: parser.name,
      functions: result.functions,
      module: result.module,
    };
  }

  getCoverageReport(): CoverageReport {
    return this.coverage.buildReport();
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.parsers.keys());
  }

  resetCoverage(): void {
    this.coverage.reset();
  }

  /**
   * Clear cached state from all parsers to free memory.
   * Call this periodically during long-running batch operations.
   */
  clearCache(): void {
    for (const parser of this.parsers.values()) {
      const tsMorphParser = parser as { clearProjects?: () => void };
      if (typeof tsMorphParser.clearProjects === 'function') {
        tsMorphParser.clearProjects();
      }
    }
  }

  private registerTreeSitterParsers(): void {
    const treeSitter = loadTreeSitterModule();
    this.treeSitterCoreAvailable = Boolean(treeSitter?.Parser);
    if (!treeSitter?.Parser) {
      for (const [ext, config] of this.treeSitterConfigByExtension.entries()) {
        const exportName = this.treeSitterExportByExtension.get(ext);
        this.treeSitterMissingByExtension.set(ext, {
          module: config.grammarModule,
          exportName,
          language: config.language,
          reason: 'core_missing',
        });
      }
      return;
    }
    const specializedParsers: Record<string, (root: TreeSitterNode, content: string) => Omit<ParserResult, 'parser'>> = {
      python: parsePythonModule,
      go: parseGoModule,
      rust: parseRustModule,
      java: parseJavaModule,
    };

    for (const config of this.treeSitterConfigs) {
      const parserName = config.grammarModule;
      const parseModule =
        specializedParsers[config.language] ??
        ((root: TreeSitterNode, content: string) =>
          parseGenericModule(root, content, FUNCTION_NODE_TYPES[config.language] ?? []));
      const extensions = config.extensions.map((ext) => normalizeExtension(ext)).filter(Boolean) as string[];
      const extensionsByExport = new Map<string | undefined, string[]>();
      for (const ext of extensions) {
        if (this.parsers.has(ext)) continue;
        const exportName = this.treeSitterExportByExtension.get(ext);
        const existing = extensionsByExport.get(exportName);
        if (existing) {
          existing.push(ext);
        } else {
          extensionsByExport.set(exportName, [ext]);
        }
      }
      for (const [exportName, extGroup] of extensionsByExport.entries()) {
        const { language, error } = loadTreeSitterLanguage(config.grammarModule, exportName);
        if (!language) {
          for (const ext of extGroup) {
            this.treeSitterMissingByExtension.set(ext, {
              module: config.grammarModule,
              exportName,
              language: config.language,
              reason: error ?? 'invalid_module',
            });
          }
          const enableFallback = String(process.env.LIBRARIAN_ENABLE_DETERMINISTIC_FALLBACK ?? '1') !== '0';
          if (enableFallback && extGroup.length > 0) {
            const fallback = new DeterministicFallbackParser(config.language);
            this.registerParser(fallback, extGroup);
          }
          continue;
        }
        const adapter = new TreeSitterParserAdapter(parserName, treeSitter.Parser, language, parseModule);
        if (extGroup.length > 0) {
          this.registerParser(adapter, extGroup);
        }
      }
    }
  }

  private initializeTreeSitterConfigMaps(): void {
    for (const config of this.treeSitterConfigs) {
      const extensions = config.extensions.map((ext) => normalizeExtension(ext)).filter(Boolean) as string[];
      for (const ext of extensions) {
        if (!this.treeSitterConfigByExtension.has(ext)) {
          this.treeSitterConfigByExtension.set(ext, config);
        }
        const exportName = config.grammarModuleExports?.[ext] ?? config.grammarModuleExport;
        if (exportName) {
          this.treeSitterExportByExtension.set(ext, exportName);
        }
      }
    }
  }

  private buildParserUnavailableMessage(ext: string | null, filePath: string): string {
    const normalized = ext ? normalizeExtension(ext) : null;
    if (normalized) {
      const missing = this.treeSitterMissingByExtension.get(normalized);
      if (missing) {
        const base = `unverified_by_trace(parser_unavailable): Tree-sitter parser unavailable for ${normalized} (${filePath})`;
        if (missing.reason === 'core_missing') {
          return `${base}. Install tree-sitter (e.g., npm i -D tree-sitter) and ${missing.module}.`;
        }
        if (missing.reason === 'module_missing') {
          return `${base}. Install ${missing.module} (e.g., npm i -D ${missing.module}).`;
        }
        if (missing.reason === 'export_missing') {
          const exportHint = missing.exportName ? ` export "${missing.exportName}"` : ' expected export';
          return `${base}. Module ${missing.module} missing${exportHint}; upgrade or reinstall.`;
        }
        return `${base}. Verify ${missing.module} installation.`;
      }
      const config = this.treeSitterConfigByExtension.get(normalized);
      if (config) {
        const suggestion = this.treeSitterCoreAvailable
          ? `Install ${config.grammarModule} (e.g., npm i -D ${config.grammarModule}).`
          : `Install tree-sitter (e.g., npm i -D tree-sitter) and ${config.grammarModule}.`;
        return `unverified_by_trace(parser_unavailable): Tree-sitter parser unavailable for ${normalized} (${filePath}). ${suggestion}`;
      }
    }
    return `unverified_by_trace(parser_unavailable): No parser registered for extension ${ext ?? 'unknown'} (${filePath}). Consider adding a tree-sitter config or enable LLM fallback.`;
  }
}

class TsMorphParser implements SourceParser {
  readonly name = 'ts-morph';
  private readonly projectsByDir = new Map<string, Project>();
  private parseCount = 0;
  private static readonly CLEANUP_INTERVAL = 50; // Clean up after every 50 files

  parse(filePath: string, content: string): Omit<ParserResult, 'parser'> {
    const project = this.getProject(path.dirname(filePath));
    const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
    try {
      const functions = extractTsMorphFunctions(sourceFile);
      const module = extractTsMorphModule(sourceFile);
      return { functions, module };
    } finally {
      sourceFile.forget();
      this.parseCount++;
      // Periodically clear projects to prevent memory accumulation
      if (this.parseCount >= TsMorphParser.CLEANUP_INTERVAL) {
        this.clearProjects();
      }
    }
  }

  /**
   * Clear all cached Project instances to free memory.
   * Call this periodically during batch processing or when memory pressure is high.
   */
  clearProjects(): void {
    this.projectsByDir.clear();
    this.parseCount = 0;
  }

  private getProject(directory: string): Project {
    const existing = this.projectsByDir.get(directory);
    if (existing) return existing;
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noResolve: true,
        skipLibCheck: true,
      },
    });
    this.projectsByDir.set(directory, project);
    return project;
  }
}

function extractTsMorphFunctions(sourceFile: SourceFile): ParsedFunction[] {
  const functions: ParsedFunction[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    functions.push(buildParsedFunction(name, fn));
  }

  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    const name = method.getName();
    if (!name) continue;
    functions.push(buildParsedFunction(name, method));
  }

  for (const decl of sourceFile.getVariableDeclarations()) {
    const initializer = decl.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
    functions.push(buildParsedFunction(decl.getName(), initializer));
  }

  for (const prop of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
    const initializer = prop.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
    const name = prop.getName();
    if (!name) continue;
    functions.push(buildParsedFunction(name, initializer));
  }

  return functions;
}

function buildParsedFunction(name: string, node: Node): ParsedFunction {
  const startLine = node.getStartLineNumber();
  const endLine = node.getEndLineNumber();
  const purpose = extractJsDocDescription(node);
  const signature = buildSignature(name, node);
  return {
    name,
    signature,
    startLine,
    endLine,
    purpose,
  };
}

function extractJsDocDescription(node: Node): string {
  const docs = (node as { getJsDocs?: () => Array<{ getDescription(): string }> }).getJsDocs?.() ?? [];
  for (const doc of docs) {
    const description = doc.getDescription().trim();
    if (description) {
      return description.split('\n')[0].trim();
    }
  }
  return '';
}

function buildSignature(name: string, node: Node): string {
  const parameters = getNodeParameters(node).join(', ');
  const returnType = getReturnType(node);
  return `${name}(${parameters}): ${returnType}`;
}

function getNodeParameters(node: Node): string[] {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node)) {
    return node.getParameters().map((param) => param.getText());
  }
  if (Node.isFunctionExpression(node)) {
    return node.getParameters().map((param) => param.getText());
  }
  return emptyArray<string>();
}

function getReturnType(node: Node): string {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  ) {
    const returnNode = node.getReturnTypeNode();
    return returnNode ? returnNode.getText() : 'unknown';
  }
  return 'unknown';
}

function extractTsMorphModule(sourceFile: SourceFile): ParsedModule {
  const exports = new Set<string>();
  const dependencies = new Set<string>();

  for (const [name] of sourceFile.getExportedDeclarations()) {
    exports.add(name);
  }

  if (sourceFile.getExportAssignments().length > 0) {
    exports.add('default');
  }

  for (const decl of sourceFile.getImportDeclarations()) {
    dependencies.add(decl.getModuleSpecifierValue());
  }

  return {
    exports: Array.from(exports.values()),
    dependencies: Array.from(dependencies.values()),
  };
}

function normalizeExtension(ext: string): string {
  if (!ext) return '';
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
  return normalized.toLowerCase();
}
