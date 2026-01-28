import { createRequire } from 'node:module';
import * as path from 'path';
import { Project, SyntaxKind, Node, type SourceFile } from 'ts-morph';
import { CoverageTracker, type CoverageReport } from '../api/coverage.js';
import { emptyArray } from '../api/empty_values.js';

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
type TreeSitterParser = { setLanguage: (language: TreeSitterLanguage) => void; parse: (content: string) => TreeSitterTree };
type TreeSitterParserConstructor = new () => TreeSitterParser;
type TreeSitterLanguage = { name?: string };

const require = createRequire(import.meta.url);

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
    const tree = parser.parse(content);
    return this.parseModule(tree.rootNode, content);
  }
}

export class ParserRegistry {
  private static instance: ParserRegistry | null = null;

  private readonly parsers = new Map<string, SourceParser>();
  private readonly coverage: CoverageTracker;

  private constructor() {
    this.coverage = new CoverageTracker();
    const tsParser = new TsMorphParser();
    this.registerParser(tsParser, ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
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
      throw new Error(
        `unverified_by_trace(parser_unavailable): No parser registered for extension ${ext ?? 'unknown'} (${filePath})`
      );
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
    if (!treeSitter?.Parser) return;

    const python = loadTreeSitterLanguage('tree-sitter-python');
    if (python) {
      this.registerParser(
        new TreeSitterParserAdapter('tree-sitter-python', treeSitter.Parser, python, parsePythonModule),
        ['.py', '.pyi', '.pyw']
      );
    }

    const go = loadTreeSitterLanguage('tree-sitter-go');
    if (go) {
      this.registerParser(
        new TreeSitterParserAdapter('tree-sitter-go', treeSitter.Parser, go, parseGoModule),
        ['.go']
      );
    }

    const rust = loadTreeSitterLanguage('tree-sitter-rust');
    if (rust) {
      this.registerParser(
        new TreeSitterParserAdapter('tree-sitter-rust', treeSitter.Parser, rust, parseRustModule),
        ['.rs']
      );
    }

    const java = loadTreeSitterLanguage('tree-sitter-java');
    if (java) {
      this.registerParser(
        new TreeSitterParserAdapter('tree-sitter-java', treeSitter.Parser, java, parseJavaModule),
        ['.java']
      );
    }
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
