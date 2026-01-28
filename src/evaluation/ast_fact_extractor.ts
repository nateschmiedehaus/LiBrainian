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
 * @packageDocumentation
 */

import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of facts that can be extracted from source code
 */
export type ASTFactType = 'function_def' | 'import' | 'export' | 'class' | 'call' | 'type';

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
