/**
 * @fileoverview AST Fact Extractor
 *
 * Extracts machine-verifiable facts from TypeScript/JavaScript codebases
 * using the TypeScript Compiler API (via ts-morph).
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

import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

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
 * Extracts machine-verifiable facts from TypeScript source code
 */
export class ASTFactExtractor {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  }

  /**
   * Extract all facts from a single file
   */
  async extractFromFile(filePath: string): Promise<ASTFact[]> {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }

      const facts: ASTFact[] = [];

      facts.push(...this.extractFunctionsFromSource(sourceFile));
      facts.push(...this.extractImportsFromSource(sourceFile));
      facts.push(...this.extractExportsFromSource(sourceFile));
      facts.push(...this.extractClassesFromSource(sourceFile));
      facts.push(...this.extractCallsFromSource(sourceFile));
      facts.push(...this.extractTypesFromSource(sourceFile));

      return facts;
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
      const files = this.getTypeScriptFiles(dirPath);

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

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }

      return this.extractFunctionsFromSource(sourceFile);
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

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }

      return this.extractImportsFromSource(sourceFile);
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

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }

      return this.extractClassesFromSource(sourceFile);
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

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return [];
      }

      return this.extractExportsFromSource(sourceFile);
    } catch {
      return [];
    }
  }

  // ============================================================================
  // PRIVATE EXTRACTION METHODS
  // ============================================================================

  private getOrAddSourceFile(filePath: string): SourceFile | undefined {
    try {
      const absolutePath = path.resolve(filePath);
      let sourceFile = this.project.getSourceFile(absolutePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(absolutePath);
      }
      return sourceFile;
    } catch {
      return undefined;
    }
  }

  private getTypeScriptFiles(dirPath: string): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(fullPath);
          } else if (
            entry.isFile() &&
            (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
            !entry.name.endsWith('.d.ts')
          ) {
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

  private extractFunctionsFromSource(sourceFile: SourceFile): ASTFact[] {
    const facts: ASTFact[] = [];
    const filePath = sourceFile.getFilePath();

    // Extract standalone functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      const details: FunctionDefDetails = {
        parameters: func.getParameters().map((p) => ({
          name: p.getName(),
          type: p.getType().getText(),
        })),
        returnType: func.getReturnType().getText(),
        isAsync: func.isAsync(),
        isExported: func.isExported(),
      };

      facts.push({
        type: 'function_def',
        identifier: name,
        file: filePath,
        line: func.getStartLineNumber(),
        details,
      });
    }

    // Extract class methods
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();

      for (const method of cls.getMethods()) {
        const methodName = method.getName();

        const details: FunctionDefDetails = {
          parameters: method.getParameters().map((p) => ({
            name: p.getName(),
            type: p.getType().getText(),
          })),
          returnType: method.getReturnType().getText(),
          isAsync: method.isAsync(),
          isExported: cls.isExported(),
          className,
        };

        facts.push({
          type: 'function_def',
          identifier: methodName,
          file: filePath,
          line: method.getStartLineNumber(),
          details,
        });
      }
    }

    // Extract arrow functions assigned to variables
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (initializer && Node.isArrowFunction(initializer)) {
        const name = varDecl.getName();
        const isExported = varDecl.isExported();

        const details: FunctionDefDetails = {
          parameters: initializer.getParameters().map((p) => ({
            name: p.getName(),
            type: p.getType().getText(),
          })),
          returnType: initializer.getReturnType().getText(),
          isAsync: initializer.isAsync(),
          isExported,
        };

        facts.push({
          type: 'function_def',
          identifier: name,
          file: filePath,
          line: varDecl.getStartLineNumber(),
          details,
        });
      }
    }

    return facts;
  }

  private extractImportsFromSource(sourceFile: SourceFile): ASTFact[] {
    const facts: ASTFact[] = [];
    const filePath = sourceFile.getFilePath();

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const specifiers: Array<{ name: string; alias?: string }> = [];

      const defaultImport = importDecl.getDefaultImport();
      const namespaceImport = importDecl.getNamespaceImport();
      const namedImports = importDecl.getNamedImports();

      let isDefault = false;
      let isNamespace = false;
      let identifier = moduleSpecifier;

      if (defaultImport) {
        isDefault = true;
        identifier = defaultImport.getText();
        specifiers.push({ name: defaultImport.getText() });
      }

      if (namespaceImport) {
        isNamespace = true;
        identifier = namespaceImport.getText();
        specifiers.push({ name: namespaceImport.getText() });
      }

      for (const namedImport of namedImports) {
        const name = namedImport.getName();
        const alias = namedImport.getAliasNode()?.getText();
        specifiers.push({ name, alias });
        if (!identifier || identifier === moduleSpecifier) {
          identifier = name;
        }
      }

      const details: ImportDetails = {
        source: moduleSpecifier,
        specifiers,
        isDefault,
        isNamespace,
        isTypeOnly: importDecl.isTypeOnly(),
      };

      facts.push({
        type: 'import',
        identifier,
        file: filePath,
        line: importDecl.getStartLineNumber(),
        details,
      });
    }

    return facts;
  }

  private extractExportsFromSource(sourceFile: SourceFile): ASTFact[] {
    const facts: ASTFact[] = [];
    const filePath = sourceFile.getFilePath();

    // Export declarations (export { x, y })
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      for (const namedExport of exportDecl.getNamedExports()) {
        const name = namedExport.getName();
        const details: ExportDetails = {
          kind: 'variable',
          isDefault: false,
          isTypeOnly: exportDecl.isTypeOnly(),
        };

        facts.push({
          type: 'export',
          identifier: name,
          file: filePath,
          line: exportDecl.getStartLineNumber(),
          details,
        });
      }
    }

    // Exported functions
    for (const func of sourceFile.getFunctions()) {
      if (func.isExported()) {
        const name = func.getName();
        if (!name) continue;

        const details: ExportDetails = {
          kind: 'function',
          isDefault: func.isDefaultExport(),
          isTypeOnly: false,
        };

        facts.push({
          type: 'export',
          identifier: name,
          file: filePath,
          line: func.getStartLineNumber(),
          details,
        });
      }
    }

    // Exported classes
    for (const cls of sourceFile.getClasses()) {
      if (cls.isExported()) {
        const name = cls.getName();
        if (!name) continue;

        const details: ExportDetails = {
          kind: 'class',
          isDefault: cls.isDefaultExport(),
          isTypeOnly: false,
        };

        facts.push({
          type: 'export',
          identifier: name,
          file: filePath,
          line: cls.getStartLineNumber(),
          details,
        });
      }
    }

    // Exported interfaces
    for (const iface of sourceFile.getInterfaces()) {
      if (iface.isExported()) {
        const name = iface.getName();

        const details: ExportDetails = {
          kind: 'interface',
          isDefault: iface.isDefaultExport(),
          isTypeOnly: true,
        };

        facts.push({
          type: 'export',
          identifier: name,
          file: filePath,
          line: iface.getStartLineNumber(),
          details,
        });
      }
    }

    // Exported type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (typeAlias.isExported()) {
        const name = typeAlias.getName();

        const details: ExportDetails = {
          kind: 'type',
          isDefault: typeAlias.isDefaultExport(),
          isTypeOnly: true,
        };

        facts.push({
          type: 'export',
          identifier: name,
          file: filePath,
          line: typeAlias.getStartLineNumber(),
          details,
        });
      }
    }

    // Exported enums
    for (const enumDecl of sourceFile.getEnums()) {
      if (enumDecl.isExported()) {
        const name = enumDecl.getName();

        const details: ExportDetails = {
          kind: 'enum',
          isDefault: false,
          isTypeOnly: false,
        };

        facts.push({
          type: 'export',
          identifier: name,
          file: filePath,
          line: enumDecl.getStartLineNumber(),
          details,
        });
      }
    }

    // Exported variables/constants
    for (const varStmt of sourceFile.getVariableStatements()) {
      if (varStmt.isExported()) {
        for (const decl of varStmt.getDeclarations()) {
          const name = decl.getName();
          const kind = varStmt.getDeclarationKind().toString() === 'const' ? 'const' : 'variable';

          const details: ExportDetails = {
            kind: kind as 'const' | 'variable',
            isDefault: false,
            isTypeOnly: false,
          };

          facts.push({
            type: 'export',
            identifier: name,
            file: filePath,
            line: varStmt.getStartLineNumber(),
            details,
          });
        }
      }
    }

    return facts;
  }

  private extractClassesFromSource(sourceFile: SourceFile): ASTFact[] {
    const facts: ASTFact[] = [];
    const filePath = sourceFile.getFilePath();

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;

      const extendsClause = cls.getExtends();
      const implementsClauses = cls.getImplements();

      const methods = cls.getMethods().map((m) => m.getName());
      const properties = cls.getProperties().map((p) => p.getName());

      const details: ClassDetails = {
        extends: extendsClause?.getText(),
        implements: implementsClauses.map((i) => i.getText()),
        methods,
        properties,
        isAbstract: cls.isAbstract(),
      };

      facts.push({
        type: 'class',
        identifier: name,
        file: filePath,
        line: cls.getStartLineNumber(),
        details,
      });
    }

    return facts;
  }

  private extractCallsFromSource(sourceFile: SourceFile): ASTFact[] {
    const facts: ASTFact[] = [];
    const filePath = sourceFile.getFilePath();

    // Extract calls from functions
    for (const func of sourceFile.getFunctions()) {
      const callerName = func.getName() || '<anonymous>';
      this.extractCallsFromNode(func, callerName, undefined, filePath, facts);
    }

    // Extract calls from class methods
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();

      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        this.extractCallsFromNode(method, methodName, className, filePath, facts);
      }
    }

    return facts;
  }

  private extractCallsFromNode(
    node: Node,
    callerName: string,
    callerClass: string | undefined,
    filePath: string,
    facts: ASTFact[]
  ): void {
    const callExpressions = node.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const expression = call.getExpression();
      let callee: string;

      if (Node.isPropertyAccessExpression(expression)) {
        // Method call: obj.method() or this.method()
        const propName = expression.getName();
        const objText = expression.getExpression().getText();

        if (objText === 'this') {
          callee = propName;
        } else {
          callee = `${objText}.${propName}`;
        }
      } else if (Node.isIdentifier(expression)) {
        // Direct function call: fn()
        callee = expression.getText();
      } else {
        // Other call expressions (e.g., IIFE, computed property access)
        callee = expression.getText().slice(0, 50);
      }

      const details: CallDetails = {
        caller: callerName,
        callee,
        callerClass,
      };

      facts.push({
        type: 'call',
        identifier: `${callerName}->${callee}`,
        file: filePath,
        line: call.getStartLineNumber(),
        details,
      });
    }
  }

  private extractTypesFromSource(sourceFile: SourceFile): ASTFact[] {
    const facts: ASTFact[] = [];
    const filePath = sourceFile.getFilePath();

    // Extract interfaces
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      const properties = iface.getProperties().map((p) => p.getName());

      const details: TypeDetails = {
        kind: 'interface',
        properties,
      };

      facts.push({
        type: 'type',
        identifier: name,
        file: filePath,
        line: iface.getStartLineNumber(),
        details,
      });
    }

    // Extract type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      const name = typeAlias.getName();

      const details: TypeDetails = {
        kind: 'type_alias',
      };

      facts.push({
        type: 'type',
        identifier: name,
        file: filePath,
        line: typeAlias.getStartLineNumber(),
        details,
      });
    }

    // Extract enums
    for (const enumDecl of sourceFile.getEnums()) {
      const name = enumDecl.getName();
      const members = enumDecl.getMembers().map((m) => m.getName());

      const details: TypeDetails = {
        kind: 'enum',
        members,
      };

      facts.push({
        type: 'type',
        identifier: name,
        file: filePath,
        line: enumDecl.getStartLineNumber(),
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
export function createASTFactExtractor(): ASTFactExtractor {
  return new ASTFactExtractor();
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
      column: 1, // ts-morph provides line but not always column
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
 * @returns Array of VerifiableFact objects from all TypeScript files
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
