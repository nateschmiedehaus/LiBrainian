/**
 * @fileoverview AST Fact Extractor
 *
 * Extracts machine-verifiable facts from multi-language codebases.
 * TypeScript/JavaScript uses the TypeScript Compiler API directly (no ts-morph).
 * Other languages use tree-sitter when grammars are available.
 *
 * Facts extracted:
 * 1. Function definitions: name, parameters, return type, file:line
 * 2. Import/export relationships: what imports what
 * 3. Class hierarchies: inheritance, implements
 * 4. Call graphs: what function calls what function (basic)
 * 5. Type information: from TypeScript (if available)
 *
 * Layer 5 Machine-Verifiable Evaluation:
 * - extractFacts: Extract all facts from a single file
 * - extractFactsFromProject: Extract all facts from a project root
 * - verifyFact: Verify a single fact against the source code
 * - compareFacts: Compare expected vs actual facts for evaluation
 *
 * @packageDocumentation
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { TreeSitterParser } from '../agents/parsers/tree_sitter_parser.js';
import { getLanguageFromPath, SUPPORTED_LANGUAGE_EXTENSIONS } from '../utils/language.js';

const EXCLUDED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'state',
  'eval-corpus',
  'external-repos',
  'tmp',
  'temp',
]);
const EXCLUDED_DIRECTORY_PREFIXES = ['.librarian.backup'];

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of facts that can be extracted from source code (internal format)
 */
export type ASTFactType = 'function_def' | 'import' | 'export' | 'class' | 'call' | 'type';

/**
 * Standardized fact types for machine-verifiable evaluation (Layer 5 spec)
 */
export type VerifiableFactType =
  | 'function_call'
  | 'import'
  | 'export'
  | 'type_def'
  | 'variable_def'
  | 'inheritance'
  | 'implementation';

/**
 * Location information for a verifiable fact
 */
export interface FactLocation {
  /** The file path where this fact is located */
  file: string;
  /** The line number where this fact is located (1-based) */
  line: number;
  /** The column number where this fact is located (1-based) */
  column: number;
}

/**
 * A machine-verifiable fact for Layer 5 evaluation (user-specified interface)
 */
export interface VerifiableFact {
  /** Unique identifier for this fact */
  factId: string;
  /** The standardized type of fact */
  factType: VerifiableFactType;
  /** Source code location */
  location: FactLocation;
  /** The actual source code content */
  content: string;
  /** Whether this fact can be machine-verified */
  verifiable: boolean;
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
}

/**
 * Result of comparing expected vs actual facts
 */
export interface FactComparisonResult {
  /** Total number of expected facts */
  totalExpected: number;
  /** Total number of actual facts found */
  totalActual: number;
  /** Number of facts that matched */
  matched: number;
  /** Number of expected facts not found */
  missing: number;
  /** Number of unexpected facts found */
  extra: number;
  /** Precision: matched / totalActual */
  precision: number;
  /** Recall: matched / totalExpected */
  recall: number;
  /** F1 score: harmonic mean of precision and recall */
  f1Score: number;
  /** Detailed match information */
  matches: FactMatch[];
  /** Facts that were expected but not found */
  missingFacts: VerifiableFact[];
  /** Facts that were found but not expected */
  extraFacts: VerifiableFact[];
}

/**
 * A single machine-verifiable fact extracted from source code
 */
export interface ASTFact {
  /** The type of fact */
  type: ASTFactType;
  /** The identifier (name) of the entity */
  identifier: string;
  /** The file path where this fact is located */
  file: string;
  /** The line number where this fact is located (1-based) */
  line: number;
  /** Additional details specific to the fact type */
  details: Record<string, unknown>;
}

/**
 * Details for a function definition fact
 */
export interface FunctionDefDetails {
  /** Function parameters */
  parameters: Array<{ name: string; type?: string }>;
  /** Return type (if available) */
  returnType?: string;
  /** Whether the function is async */
  isAsync: boolean;
  /** Whether the function is exported */
  isExported: boolean;
  /** For methods, the containing class name */
  className?: string;
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: unknown;
}

/**
 * Details for an import fact
 */
export interface ImportDetails {
  /** The module specifier (source) */
  source: string;
  /** The imported specifiers */
  specifiers: Array<{ name: string; alias?: string }>;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import */
  isNamespace: boolean;
  /** Whether this is a type-only import */
  isTypeOnly: boolean;
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: unknown;
}

/**
 * Details for an export fact
 */
export interface ExportDetails {
  /** The kind of export (function, class, interface, etc.) */
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'const' | 'enum';
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether this is a type-only export */
  isTypeOnly: boolean;
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: unknown;
}

/**
 * Details for a class fact
 */
export interface ClassDetails {
  /** The class this class extends (if any) */
  extends?: string;
  /** Interfaces this class implements */
  implements?: string[];
  /** Method names */
  methods: string[];
  /** Property names */
  properties: string[];
  /** Whether the class is abstract */
  isAbstract: boolean;
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: unknown;
}

/**
 * Details for a call fact
 */
export interface CallDetails {
  /** The name of the function/method making the call */
  caller: string;
  /** The name of the function/method being called */
  callee: string;
  /** For method calls, the containing class */
  callerClass?: string;
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: unknown;
}

/**
 * Details for a type fact
 */
export interface TypeDetails {
  /** The kind of type (interface, type alias, enum) */
  kind: 'interface' | 'type_alias' | 'enum';
  /** Properties for interfaces/type aliases */
  properties?: string[];
  /** Members for enums */
  members?: string[];
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: unknown;
}

/**
 * Match information for fact comparison
 */
export interface FactMatch {
  /** The expected fact */
  expected: VerifiableFact;
  /** The actual fact that matched */
  actual: VerifiableFact;
  /** Match confidence score */
  matchConfidence: number;
  /** Whether the location matched exactly */
  locationMatch: boolean;
  /** Whether the content matched exactly */
  contentMatch: boolean;
}

/**
 * Result of verifying a single fact
 */
export interface FactVerificationResult {
  /** The fact being verified */
  fact: VerifiableFact;
  /** Whether the fact was verified successfully */
  verified: boolean;
  /** Verification confidence */
  confidence: number;
  /** Reason for verification result */
  reason: string;
  /** The actual source content found (if any) */
  actualContent?: string;
}

// ============================================================================
// AST FACT EXTRACTOR CLASS
// ============================================================================

/**
 * Extracts machine-verifiable facts from source code
 */
export interface ASTFactExtractorOptions {
  /**
   * Restrict extraction to a specific set of file extensions (including the leading dot),
   * e.g. [".ts", ".js"]. When omitted, uses `SUPPORTED_LANGUAGE_EXTENSIONS`.
   */
  includeExtensions?: string[];
  /**
   * Optional hard cap for number of files scanned during directory extraction.
   * Helps prevent runaway memory usage on very large repositories.
   */
  maxFiles?: number;
}

export class ASTFactExtractor {
  private treeSitterParser: TreeSitterParser | null;
  private includeExtensionsLower?: Set<string>;
  private maxFiles?: number;

  constructor(options: ASTFactExtractorOptions = {}) {
    this.treeSitterParser = new TreeSitterParser();
    if (Array.isArray(options.includeExtensions) && options.includeExtensions.length > 0) {
      this.includeExtensionsLower = new Set(
        options.includeExtensions
          .map((ext) => ext.toLowerCase())
          .filter((ext) => ext.startsWith('.'))
      );
    }
    if (Number.isFinite(options.maxFiles) && Number(options.maxFiles) > 0) {
      this.maxFiles = Math.floor(Number(options.maxFiles));
    }
  }

  /**
   * Extract all facts from a single file
   */
  async extractFromFile(filePath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      if (this.isTsFamily(filePath)) {
        let sourceContent = '';
        try {
          sourceContent = fs.readFileSync(filePath, 'utf-8');
        } catch {
          return [];
        }
        const sourceFile = this.parseTypeScriptSourceFile(filePath, sourceContent);
        return this.extractFactsFromTypeScriptSource(sourceFile, filePath);
      }

      return this.extractFromFileWithTreeSitter(filePath);
    } catch {
      return [];
    }
  }

  /**
   * Extract all facts from a directory (recursive)
   */
  async extractFromDirectory(dirPath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return [];
      }

      const facts: ASTFact[] = [];
      const files = this.getSourceFiles(dirPath);

      for (const file of files) {
        const fileFacts = await this.extractFromFile(file);
        facts.push(...fileFacts);
      }

      return facts;
    } catch {
      return [];
    }
  }

  /**
   * Extract only function definitions
   */
  async extractFunctions(filePath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      if (this.isTsFamily(filePath)) {
        const sourceContent = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = this.parseTypeScriptSourceFile(filePath, sourceContent);
        return this.extractFunctionsFromTypeScriptSource(sourceFile, filePath);
      }
      const facts = this.extractFromFileWithTreeSitter(filePath);
      return facts.filter((fact) => fact.type === 'function_def');
    } catch {
      return [];
    }
  }

  /**
   * Extract only imports
   */
  async extractImports(filePath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      if (this.isTsFamily(filePath)) {
        const sourceContent = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = this.parseTypeScriptSourceFile(filePath, sourceContent);
        return this.extractImportsFromTypeScriptSource(sourceFile, filePath);
      }
      const facts = this.extractFromFileWithTreeSitter(filePath);
      return facts.filter((fact) => fact.type === 'import');
    } catch {
      return [];
    }
  }

  /**
   * Extract only class definitions
   */
  async extractClasses(filePath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      if (this.isTsFamily(filePath)) {
        const sourceContent = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = this.parseTypeScriptSourceFile(filePath, sourceContent);
        return this.extractClassesFromTypeScriptSource(sourceFile, filePath);
      }
      const facts = this.extractFromFileWithTreeSitter(filePath);
      return facts.filter((fact) => fact.type === 'class');
    } catch {
      return [];
    }
  }

  /**
   * Extract only exports
   */
  async extractExports(filePath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      if (this.isTsFamily(filePath)) {
        const sourceContent = fs.readFileSync(filePath, 'utf-8');
        const sourceFile = this.parseTypeScriptSourceFile(filePath, sourceContent);
        return this.extractExportsFromTypeScriptSource(sourceFile, filePath);
      }
      const facts = this.extractFromFileWithTreeSitter(filePath);
      return facts.filter((fact) => fact.type === 'export');
    } catch {
      return [];
    }
  }

  // ============================================================================
  // PRIVATE EXTRACTION METHODS
  // ============================================================================

  private getSourceFiles(dirPath: string): string[] {
    const files: string[] = [];
    const extensions = this.includeExtensionsLower ?? new Set(SUPPORTED_LANGUAGE_EXTENSIONS.map((ext) => ext.toLowerCase()));
    const maxFiles = this.maxFiles;

    const walk = (dir: string) => {
      if (maxFiles !== undefined && files.length >= maxFiles) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (maxFiles !== undefined && files.length >= maxFiles) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (
              entry.name.startsWith('.')
              || EXCLUDED_DIRECTORY_NAMES.has(entry.name)
              || EXCLUDED_DIRECTORY_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
            ) {
              continue;
            }
            walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!ext || !extensions.has(ext)) continue;
            if (entry.name.endsWith('.d.ts')) continue;
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    walk(dirPath);
    return files;
  }

  private parseTypeScriptSourceFile(filePath: string, sourceContent: string): ts.SourceFile {
    const ext = path.extname(filePath).toLowerCase();
    const scriptKind =
      ext === '.js' || ext === '.cjs' || ext === '.mjs' || ext === '.jsx'
        ? ts.ScriptKind.JS
        : ext === '.tsx'
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS;
    // Parent pointers are not needed for our extraction and add overhead.
    return ts.createSourceFile(filePath, sourceContent, ts.ScriptTarget.Latest, false, scriptKind);
  }

  private extractFactsFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];
    facts.push(...this.extractFunctionsFromTypeScriptSource(sourceFile, filePath));
    facts.push(...this.extractImportsFromTypeScriptSource(sourceFile, filePath));
    facts.push(...this.extractExportsFromTypeScriptSource(sourceFile, filePath));
    facts.push(...this.extractClassesFromTypeScriptSource(sourceFile, filePath));
    facts.push(...this.extractCallsFromTypeScriptSource(sourceFile, filePath));
    facts.push(...this.extractTypesFromTypeScriptSource(sourceFile, filePath));
    return facts;
  }

  private extractFunctionsFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];

    const recordFunction = (name: string, node: ts.SignatureDeclarationBase, isExported: boolean, className?: string) => {
      const details: FunctionDefDetails = {
        parameters: node.parameters.map((p) => ({
          name: p.name.getText(sourceFile),
          type: p.type?.getText(sourceFile),
        })),
        returnType: node.type?.getText(sourceFile),
        isAsync: this.hasModifier(node, ts.SyntaxKind.AsyncKeyword),
        isExported,
        className,
      };
      facts.push({
        type: 'function_def',
        identifier: name,
        file: filePath,
        line: this.getNodeLine(sourceFile, node),
        details,
      });
    };

    for (const stmt of sourceFile.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text) {
        recordFunction(stmt.name.text, stmt, this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword));
        continue;
      }

      if (ts.isVariableStatement(stmt)) {
        const isExported = this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            recordFunction(decl.name.text, decl.initializer, isExported);
          }
        }
        continue;
      }

      if (ts.isClassDeclaration(stmt) && stmt.name?.text) {
        const className = stmt.name.text;
        const classExported = this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
        for (const member of stmt.members) {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = this.getPropertyNameText(member.name, sourceFile);
            if (methodName) recordFunction(methodName, member, classExported, className);
          } else if (ts.isConstructorDeclaration(member)) {
            recordFunction('constructor', member, classExported, className);
          }
        }
      }
    }

    return facts;
  }

  private extractImportsFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];

    for (const stmt of sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const source = stmt.moduleSpecifier.text;
      const specifiers: Array<{ name: string; alias?: string }> = [];
      let isDefault = false;
      let isNamespace = false;
      let identifier = source;

      const clause = stmt.importClause;
      if (clause?.name) {
        isDefault = true;
        const name = clause.name.text;
        specifiers.push({ name });
        identifier = name;
      }
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        isNamespace = true;
        const name = bindings.name.text;
        specifiers.push({ name });
        identifier = name;
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = el.name.text;
          const alias = el.propertyName?.text;
          specifiers.push({ name, alias });
          if (!identifier || identifier === source) identifier = name;
        }
      }

      const details: ImportDetails = {
        source,
        specifiers,
        isDefault,
        isNamespace,
        isTypeOnly: Boolean(clause?.isTypeOnly),
      };
      facts.push({
        type: 'import',
        identifier,
        file: filePath,
        line: this.getNodeLine(sourceFile, stmt),
        details,
      });
    }

    return facts;
  }

  private extractExportsFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];

    for (const stmt of sourceFile.statements) {
      if (ts.isExportDeclaration(stmt)) {
        const isTypeOnly = Boolean(stmt.isTypeOnly);
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const name = el.name.text;
            const details: ExportDetails = { kind: 'variable', isDefault: false, isTypeOnly };
            facts.push({ type: 'export', identifier: name, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
          }
        }
        continue;
      }

      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text && this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
        const details: ExportDetails = { kind: 'function', isDefault: this.hasModifier(stmt, ts.SyntaxKind.DefaultKeyword), isTypeOnly: false };
        facts.push({ type: 'export', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
        continue;
      }

      if (ts.isClassDeclaration(stmt) && stmt.name?.text && this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
        const details: ExportDetails = { kind: 'class', isDefault: this.hasModifier(stmt, ts.SyntaxKind.DefaultKeyword), isTypeOnly: false };
        facts.push({ type: 'export', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
        continue;
      }

      if (ts.isInterfaceDeclaration(stmt) && this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
        const details: ExportDetails = { kind: 'interface', isDefault: this.hasModifier(stmt, ts.SyntaxKind.DefaultKeyword), isTypeOnly: true };
        facts.push({ type: 'export', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
        continue;
      }

      if (ts.isTypeAliasDeclaration(stmt) && this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
        const details: ExportDetails = { kind: 'type', isDefault: this.hasModifier(stmt, ts.SyntaxKind.DefaultKeyword), isTypeOnly: true };
        facts.push({ type: 'export', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
        continue;
      }

      if (ts.isEnumDeclaration(stmt) && this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
        const details: ExportDetails = { kind: 'enum', isDefault: false, isTypeOnly: false };
        facts.push({ type: 'export', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
        continue;
      }

      if (ts.isVariableStatement(stmt) && this.hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
        const declKind = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 ? 'const' : 'variable';
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          const details: ExportDetails = { kind: declKind, isDefault: false, isTypeOnly: false };
          facts.push({ type: 'export', identifier: decl.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
        }
      }
    }

    return facts;
  }

  private extractClassesFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];

    for (const stmt of sourceFile.statements) {
      if (!ts.isClassDeclaration(stmt) || !stmt.name?.text) continue;
      const name = stmt.name.text;
      let extendsText: string | undefined;
      let implementsTexts: string[] | undefined;
      if (stmt.heritageClauses) {
        for (const clause of stmt.heritageClauses) {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            const first = clause.types[0];
            extendsText = first?.expression.getText(sourceFile);
          } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
            implementsTexts = clause.types.map((t) => t.expression.getText(sourceFile));
          }
        }
      }
      const methods: string[] = [];
      const properties: string[] = [];
      for (const member of stmt.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = this.getPropertyNameText(member.name, sourceFile);
          if (methodName) methods.push(methodName);
        } else if (ts.isPropertyDeclaration(member) && member.name) {
          const propName = this.getPropertyNameText(member.name, sourceFile);
          if (propName) properties.push(propName);
        }
      }
      const details: ClassDetails = {
        extends: extendsText,
        implements: implementsTexts,
        methods,
        properties,
        isAbstract: this.hasModifier(stmt, ts.SyntaxKind.AbstractKeyword),
      };
      facts.push({ type: 'class', identifier: name, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
    }

    return facts;
  }

  private extractCallsFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];

    type Ctx = { callerName: string; callerClass?: string } | null;
    const mkCallee = (expr: ts.Expression): string => {
      if (ts.isPropertyAccessExpression(expr)) {
        const objText = expr.expression.getText(sourceFile);
        const propName = expr.name.text;
        if (objText === 'this') return propName;
        const left = objText.length > 40 ? objText.slice(0, 40) : objText;
        return `${left}.${propName}`;
      }
      if (ts.isIdentifier(expr)) return expr.text;
      const text = expr.getText(sourceFile);
      return text.length > 50 ? text.slice(0, 50) : text;
    };

    const visit = (node: ts.Node, ctx: Ctx) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text) {
        const next: Ctx = { callerName: node.name.text };
        ts.forEachChild(node, (child) => visit(child, next));
        return;
      }

      if (ts.isMethodDeclaration(node) && node.name) {
        const methodName = this.getPropertyNameText(node.name, sourceFile) ?? '<anonymous>';
        const next: Ctx = { callerName: methodName, callerClass: ctx?.callerClass };
        ts.forEachChild(node, (child) => visit(child, next));
        return;
      }

      if (ts.isConstructorDeclaration(node)) {
        const next: Ctx = { callerName: 'constructor', callerClass: ctx?.callerClass };
        ts.forEachChild(node, (child) => visit(child, next));
        return;
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        const next: Ctx = { callerName: node.name.text };
        ts.forEachChild(node.initializer, (child) => visit(child, next));
        return;
      }

      if (ts.isClassDeclaration(node) && node.name?.text) {
        const next: Ctx = { callerName: ctx?.callerName ?? '<module>', callerClass: node.name.text };
        ts.forEachChild(node, (child) => visit(child, next));
        return;
      }

      if (ctx && ts.isCallExpression(node)) {
        const callee = mkCallee(node.expression);
        const details: CallDetails = { caller: ctx.callerName, callee, callerClass: ctx.callerClass };
        facts.push({
          type: 'call',
          identifier: `${ctx.callerName}->${callee}`,
          file: filePath,
          line: this.getNodeLine(sourceFile, node),
          details,
        });
      }

      ts.forEachChild(node, (child) => visit(child, ctx));
    };

    visit(sourceFile, { callerName: '<module>' });
    return facts;
  }

  private extractTypesFromTypeScriptSource(sourceFile: ts.SourceFile, filePath: string): ASTFact[] {
    const facts: ASTFact[] = [];

    for (const stmt of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(stmt)) {
        const name = stmt.name.text;
        const properties = stmt.members
          .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
          .map((m) => (m.name ? m.name.getText(sourceFile) : ''))
          .filter(Boolean);
        const details: TypeDetails = { kind: 'interface', properties };
        facts.push({ type: 'type', identifier: name, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
      } else if (ts.isTypeAliasDeclaration(stmt)) {
        const details: TypeDetails = { kind: 'type_alias' };
        facts.push({ type: 'type', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
      } else if (ts.isEnumDeclaration(stmt)) {
        const members = stmt.members.map((m) => m.name.getText(sourceFile));
        const details: TypeDetails = { kind: 'enum', members };
        facts.push({ type: 'type', identifier: stmt.name.text, file: filePath, line: this.getNodeLine(sourceFile, stmt), details });
      }
    }

    return facts;
  }

  private getPropertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string | null {
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return name.expression.getText(sourceFile);
    return null;
  }

  private hasModifier(node: ts.Node, modifierKind: ts.SyntaxKind): boolean {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(mods?.some((m) => m.kind === modifierKind));
  }

  private getNodeLine(sourceFile: ts.SourceFile, node: ts.Node): number {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
    return line + 1;
  }

  private isTsFamily(filePath: string): boolean {
    const language = getLanguageFromPath(filePath, 'unknown');
    return language === 'typescript' || language === 'javascript';
  }

  private extractFromFileWithTreeSitter(filePath: string): ASTFact[] {
    if (!this.treeSitterParser) return [];
    let sourceContent = '';
    try {
      sourceContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }
    const language = this.treeSitterParser.detectLanguage(sourceContent, filePath);
    if (language === 'unknown') {
      return [];
    }
    let result: ReturnType<TreeSitterParser['parse']>;
    try {
      result = this.treeSitterParser.parse(sourceContent, language);
    } catch {
      return [];
    }

    const facts: ASTFact[] = [];
    const functions = this.treeSitterParser.extractFunctions(result.tree);
    for (const fn of functions) {
      const details: FunctionDefDetails = {
        parameters: fn.parameters.map((name) => ({ name })),
        isAsync: false,
        isExported: false,
      };
      facts.push({
        type: 'function_def',
        identifier: fn.name,
        file: filePath,
        line: fn.startPosition.row + 1,
        details,
      });
    }

    const classes = this.treeSitterParser.extractClasses(result.tree);
    for (const cls of classes) {
      const details: ClassDetails = {
        methods: (cls.methods ?? []).map((method) => method.name),
        properties: cls.properties ?? [],
        isAbstract: false,
      };
      facts.push({
        type: 'class',
        identifier: cls.name,
        file: filePath,
        line: cls.startPosition.row + 1,
        details,
      });
    }

    const importNodes = this.treeSitterParser.queryTree(result.tree, 'import_statement')
      .concat(this.treeSitterParser.queryTree(result.tree, 'import_declaration'))
      .concat(this.treeSitterParser.queryTree(result.tree, 'using_directive'))
      .concat(this.treeSitterParser.queryTree(result.tree, 'preproc_include'));

    for (const node of importNodes) {
      const text = node.text.trim();
      let source = '';
      const includeMatch = text.match(/#include\s+[<"]([^>"]+)[>"]/);
      const usingMatch = text.match(/\busing\s+([^\s;]+)\s*;/);
      const importFromMatch = text.match(/\bfrom\s+([^\s]+)\s+import\b/);
      const importMatch = text.match(/\bimport\s+([^\s'";]+)\s*;?/);
      const importStringMatch = text.match(/\bimport\s+['"]([^'"]+)['"]/);
      if (includeMatch?.[1]) source = includeMatch[1];
      else if (usingMatch?.[1]) source = usingMatch[1];
      else if (importFromMatch?.[1]) source = importFromMatch[1];
      else if (importStringMatch?.[1]) source = importStringMatch[1];
      else if (importMatch?.[1]) source = importMatch[1];
      if (!source) continue;

      const details: ImportDetails = {
        source,
        specifiers: [],
        isDefault: false,
        isNamespace: false,
        isTypeOnly: false,
      };
      facts.push({
        type: 'import',
        identifier: source,
        file: filePath,
        line: node.startPosition.row + 1,
        details,
      });
    }

    const callNodes = this.treeSitterParser.extractCalls(result.tree);
    for (const call of callNodes) {
      const caller = call.caller ?? '<module>';
      const details: CallDetails = {
        caller,
        callee: call.callee,
        callerClass: call.callerClass,
      };
      facts.push({
        type: 'call',
        identifier: `${caller}->${call.callee}`,
        file: filePath,
        line: call.startPosition.row + 1,
        details,
      });
    }

    return facts;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ASTFactExtractor instance
 */
export function createASTFactExtractor(options: ASTFactExtractorOptions = {}): ASTFactExtractor {
  return new ASTFactExtractor(options);
}

// ============================================================================
// LAYER 5 MACHINE-VERIFIABLE EVALUATION FUNCTIONS
// ============================================================================

/**
 * Convert internal ASTFact to VerifiableFact format
 */
function convertToVerifiableFact(fact: ASTFact, sourceContent: string): VerifiableFact {
  const factType = mapFactType(fact.type, fact.details);
  const content = extractFactContent(fact, sourceContent);
  const factId = generateFactId(fact);

  return {
    factId,
    factType,
    location: {
      file: fact.file,
      line: fact.line,
      column: 1, // column is not currently tracked in internal facts
    },
    content,
    verifiable: true,
    confidence: computeFactConfidence(fact),
  };
}

/**
 * Map internal fact type to VerifiableFactType
 */
function mapFactType(
  type: ASTFactType,
  details: Record<string, unknown>
): VerifiableFactType {
  switch (type) {
    case 'function_def':
      return 'function_call'; // Function definitions are verifiable as function_call facts
    case 'import':
      return 'import';
    case 'export':
      return 'export';
    case 'class': {
      // Check if it's inheritance or implementation
      if (details.extends) return 'inheritance';
      if (details.implements && Array.isArray(details.implements) && details.implements.length > 0) {
        return 'implementation';
      }
      return 'type_def';
    }
    case 'type':
      return 'type_def';
    case 'call':
      return 'function_call';
    default:
      return 'variable_def';
  }
}

/**
 * Extract the actual source code content for a fact
 */
function extractFactContent(fact: ASTFact, sourceContent: string): string {
  const lines = sourceContent.split('\n');
  const lineIndex = fact.line - 1;

  if (lineIndex >= 0 && lineIndex < lines.length) {
    // Get the line and a few surrounding lines for context
    const startLine = Math.max(0, lineIndex);
    const endLine = Math.min(lines.length, lineIndex + 3);
    return lines.slice(startLine, endLine).join('\n');
  }

  return `${fact.type}: ${fact.identifier}`;
}

/**
 * Generate a unique fact ID
 */
function generateFactId(fact: ASTFact): string {
  const fileHash = simpleHash(fact.file);
  const identifier = fact.identifier.replace(/[^a-zA-Z0-9]/g, '_');
  return `${fact.type}_${identifier}_${fact.line}_${fileHash}`;
}

/**
 * Simple hash function for generating IDs
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

/**
 * Compute confidence score for a fact based on its properties
 */
function computeFactConfidence(fact: ASTFact): number {
  let confidence = 0.8; // Base confidence for AST-extracted facts

  // Function definitions with full type information have higher confidence
  if (fact.type === 'function_def') {
    const details = fact.details as FunctionDefDetails;
    if (details.returnType && details.returnType !== 'void') confidence += 0.05;
    if (details.parameters && details.parameters.length > 0) confidence += 0.05;
    if (details.parameters?.some((p) => p.type)) confidence += 0.05;
  }

  // Class facts with inheritance/implementation have higher confidence
  if (fact.type === 'class') {
    const details = fact.details as ClassDetails;
    if (details.extends) confidence += 0.05;
    if (details.implements && details.implements.length > 0) confidence += 0.05;
    if (details.methods && details.methods.length > 0) confidence += 0.03;
  }

  // Import facts are highly verifiable
  if (fact.type === 'import') {
    confidence += 0.1;
  }

  return Math.min(1.0, confidence);
}

/**
 * Extract all machine-verifiable facts from a single file
 *
 * @param filePath - Path to the file to extract facts from
 * @returns Array of VerifiableFact objects
 */
export async function extractFacts(filePath: string): Promise<VerifiableFact[]> {
  const extractor = createASTFactExtractor();
  const internalFacts = await extractor.extractFromFile(filePath);

  if (internalFacts.length === 0) {
    return [];
  }

  // Read source content for extracting actual code
  let sourceContent = '';
  try {
    sourceContent = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Continue without source content
  }

  return internalFacts.map((fact) => convertToVerifiableFact(fact, sourceContent));
}

/**
 * Extract all machine-verifiable facts from a project root
 *
 * @param root - Root directory of the project
 * @returns Array of VerifiableFact objects from all supported source files
 */
export async function extractFactsFromProject(root: string): Promise<VerifiableFact[]> {
  const extractor = createASTFactExtractor();
  const internalFacts = await extractor.extractFromDirectory(root);

  if (internalFacts.length === 0) {
    return [];
  }

  // Group facts by file to batch read source content
  const factsByFile = new Map<string, ASTFact[]>();
  for (const fact of internalFacts) {
    const existing = factsByFile.get(fact.file) || [];
    existing.push(fact);
    factsByFile.set(fact.file, existing);
  }

  const verifiableFacts: VerifiableFact[] = [];

  for (const [filePath, facts] of factsByFile) {
    let sourceContent = '';
    try {
      sourceContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // Continue without source content
    }

    for (const fact of facts) {
      verifiableFacts.push(convertToVerifiableFact(fact, sourceContent));
    }
  }

  return verifiableFacts;
}

/**
 * Verify a single fact against the actual source code
 *
 * @param fact - The fact to verify
 * @returns FactVerificationResult indicating whether the fact is valid
 */
export async function verifyFact(fact: VerifiableFact): Promise<FactVerificationResult> {
  // Check if file exists
  if (!fs.existsSync(fact.location.file)) {
    return {
      fact,
      verified: false,
      confidence: 0,
      reason: 'file_not_found',
    };
  }

  // Read the source file
  let sourceContent: string;
  try {
    sourceContent = fs.readFileSync(fact.location.file, 'utf-8');
  } catch {
    return {
      fact,
      verified: false,
      confidence: 0,
      reason: 'file_read_error',
    };
  }

  const lines = sourceContent.split('\n');

  // Check if line number is valid
  if (fact.location.line < 1 || fact.location.line > lines.length) {
    return {
      fact,
      verified: false,
      confidence: 0.1,
      reason: 'line_out_of_range',
    };
  }

  // Extract the actual content at the specified location
  const lineIndex = fact.location.line - 1;
  const actualLine = lines[lineIndex] || '';

  // Re-extract facts from the file and check if our fact matches
  const extractor = createASTFactExtractor();
  const actualFacts = await extractor.extractFromFile(fact.location.file);

  // Look for a matching fact
  for (const actualFact of actualFacts) {
    const actualVerifiable = convertToVerifiableFact(actualFact, sourceContent);

    // Check if facts match (same type and close location)
    if (
      actualVerifiable.factType === fact.factType &&
      Math.abs(actualVerifiable.location.line - fact.location.line) <= 2
    ) {
      // Check content similarity
      const contentMatch = normalizeContent(actualVerifiable.content).includes(
        normalizeContent(fact.content).slice(0, 50)
      );

      if (contentMatch || actualVerifiable.location.line === fact.location.line) {
        return {
          fact,
          verified: true,
          confidence: contentMatch ? 0.95 : 0.8,
          reason: contentMatch ? 'content_match' : 'location_match',
          actualContent: actualLine,
        };
      }
    }
  }

  // Fact type and location didn't match any extracted facts
  return {
    fact,
    verified: false,
    confidence: 0.2,
    reason: 'fact_not_found_at_location',
    actualContent: actualLine,
  };
}

/**
 * Normalize content for comparison
 */
function normalizeContent(content: string): string {
  return content
    .replace(/\s+/g, ' ')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .toLowerCase();
}

/**
 * Compare expected facts against actual facts for evaluation
 *
 * @param expected - Array of expected VerifiableFact objects
 * @param actual - Array of actual VerifiableFact objects
 * @returns FactComparisonResult with precision, recall, and detailed matches
 */
export function compareFacts(
  expected: VerifiableFact[],
  actual: VerifiableFact[]
): FactComparisonResult {
  const matches: FactMatch[] = [];
  const matchedExpectedIds = new Set<string>();
  const matchedActualIds = new Set<string>();

  // For each expected fact, find the best matching actual fact
  for (const expectedFact of expected) {
    let bestMatch: { actual: VerifiableFact; confidence: number } | null = null;

    for (const actualFact of actual) {
      if (matchedActualIds.has(actualFact.factId)) continue;

      const matchScore = computeMatchScore(expectedFact, actualFact);

      if (matchScore > 0.5 && (!bestMatch || matchScore > bestMatch.confidence)) {
        bestMatch = { actual: actualFact, confidence: matchScore };
      }
    }

    if (bestMatch) {
      matchedExpectedIds.add(expectedFact.factId);
      matchedActualIds.add(bestMatch.actual.factId);

      const locationMatch =
        normalizeFilePath(expectedFact.location.file) ===
          normalizeFilePath(bestMatch.actual.location.file) &&
        Math.abs(expectedFact.location.line - bestMatch.actual.location.line) <= 2;

      const contentMatch =
        normalizeContent(expectedFact.content) === normalizeContent(bestMatch.actual.content);

      matches.push({
        expected: expectedFact,
        actual: bestMatch.actual,
        matchConfidence: bestMatch.confidence,
        locationMatch,
        contentMatch,
      });
    }
  }

  // Collect missing and extra facts
  const missingFacts = expected.filter((f) => !matchedExpectedIds.has(f.factId));
  const extraFacts = actual.filter((f) => !matchedActualIds.has(f.factId));

  // Calculate metrics
  const matched = matches.length;
  const totalExpected = expected.length;
  const totalActual = actual.length;
  const missing = missingFacts.length;
  const extra = extraFacts.length;

  const precision = totalActual > 0 ? matched / totalActual : 0;
  const recall = totalExpected > 0 ? matched / totalExpected : 0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    totalExpected,
    totalActual,
    matched,
    missing,
    extra,
    precision,
    recall,
    f1Score,
    matches,
    missingFacts,
    extraFacts,
  };
}

/**
 * Compute match score between two facts
 */
function computeMatchScore(expected: VerifiableFact, actual: VerifiableFact): number {
  let score = 0;

  // Type must match
  if (expected.factType !== actual.factType) {
    return 0;
  }
  score += 0.3;

  // File path matching (with normalization)
  const expectedFile = normalizeFilePath(expected.location.file);
  const actualFile = normalizeFilePath(actual.location.file);

  if (expectedFile === actualFile) {
    score += 0.25;
  } else if (expectedFile.endsWith(actualFile) || actualFile.endsWith(expectedFile)) {
    score += 0.15;
  } else {
    // Different files, unlikely to be the same fact
    return 0;
  }

  // Line proximity
  const lineDiff = Math.abs(expected.location.line - actual.location.line);
  if (lineDiff === 0) {
    score += 0.25;
  } else if (lineDiff <= 2) {
    score += 0.2;
  } else if (lineDiff <= 5) {
    score += 0.1;
  } else if (lineDiff <= 10) {
    score += 0.05;
  }

  // Content similarity
  const expectedContent = normalizeContent(expected.content);
  const actualContent = normalizeContent(actual.content);

  if (expectedContent === actualContent) {
    score += 0.2;
  } else if (expectedContent.includes(actualContent) || actualContent.includes(expectedContent)) {
    score += 0.1;
  }

  return Math.min(1.0, score);
}

/**
 * Normalize file path for comparison
 */
function normalizeFilePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}
