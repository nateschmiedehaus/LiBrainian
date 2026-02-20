/**
 * @fileoverview Symbol Extractor for TypeScript AST Parsing
 *
 * Extracts ALL symbol declarations from TypeScript files:
 * - Classes
 * - Interfaces
 * - Type aliases
 * - Constants
 * - Enums
 * - Exported functions
 * - Variables
 *
 * This addresses the critical gap where the current system only indexes
 * functions, missing classes, interfaces, types, etc.
 *
 * @packageDocumentation
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { SymbolEntry, SymbolKind, MemberVisibility } from '../constructions/symbol_table.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SymbolExtractionResult {
  /** All extracted symbols */
  symbols: SymbolEntry[];

  /** Files that were processed */
  filesProcessed: number;

  /** Files that had errors */
  filesWithErrors: string[];

  /** Total extraction time in ms */
  extractionTimeMs: number;
}

export interface SymbolExtractionOptions {
  /** Only include exported symbols */
  exportedOnly?: boolean;

  /** Include function declarations */
  includeFunctions?: boolean;

  /** Include variable declarations */
  includeVariables?: boolean;

  /** Glob patterns to exclude */
  excludePatterns?: string[];

  /** Max files processed concurrently during batched extraction */
  batchSize?: number;
}

const DEFAULT_OPTIONS: SymbolExtractionOptions = {
  exportedOnly: false,
  includeFunctions: true,
  includeVariables: true,
  excludePatterns: ['node_modules', 'dist', 'build', '.git', '*.d.ts'],
  batchSize: 20,
};

// ============================================================================
// SYMBOL EXTRACTION
// ============================================================================

/**
 * Extract symbols from a single TypeScript source file.
 */
export function extractSymbolsFromSource(
  sourceFile: ts.SourceFile,
  filePath: string,
  options: SymbolExtractionOptions = DEFAULT_OPTIONS
): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];

  function visit(node: ts.Node): void {
    if (options.includeVariables && ts.isVariableStatement(node)) {
      symbols.push(...extractVariableStatementSymbols(node, sourceFile, filePath, options));
    } else {
      const entry = extractSymbolFromNode(node, sourceFile, filePath, options);
      if (entry) {
        symbols.push(entry);
      }
    }

    // Extract class members
    if (ts.isClassDeclaration(node)) {
      const classMembers = extractClassMembers(node, sourceFile, filePath);
      symbols.push(...classMembers);
    }

    // Extract interface members
    if (ts.isInterfaceDeclaration(node)) {
      const interfaceMembers = extractInterfaceMembers(node, sourceFile, filePath);
      symbols.push(...interfaceMembers);
    }

    // Extract namespace members
    if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const namespaceMembers = extractNamespaceMembers(node, sourceFile, filePath, options);
      symbols.push(...namespaceMembers);
    }

    // Visit children
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Extract re-exports (export { X } from './module' and export * from './module')
  const reExports = extractReExports(sourceFile, filePath);
  symbols.push(...reExports);

  // Extract default exports (export default X)
  const defaultExport = extractDefaultExports(sourceFile, filePath);
  symbols.push(...defaultExport);

  return symbols;
}

/**
 * Extract a symbol entry from a TypeScript AST node.
 * Returns null if the node is not a symbol declaration.
 */
function extractSymbolFromNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: SymbolExtractionOptions
): SymbolEntry | null {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const lineNumber = line + 1; // 1-indexed

  // Check if exported (for filtering)
  const isExported = hasExportModifier(node) || isExportedDeclaration(node);

  if (options.exportedOnly && !isExported) {
    return null;
  }

  // Class declaration
  if (ts.isClassDeclaration(node) && node.name) {
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    const decorators = extractDecorators(node, sourceFile);
    return {
      name: node.name.text,
      kind: 'class',
      file: filePath,
      line: lineNumber,
      endLine: endPos.line + 1,
      exported: isExported,
      signature: getClassSignature(node),
      description: getJSDocDescription(node, sourceFile),
      qualifiedName: buildQualifiedName(filePath, node.name.text),
      decorators: decorators.length > 0 ? decorators : undefined,
    };
  }

  // Interface declaration
  if (ts.isInterfaceDeclaration(node) && node.name) {
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      name: node.name.text,
      kind: 'interface',
      file: filePath,
      line: lineNumber,
      endLine: endPos.line + 1,
      exported: isExported,
      signature: getInterfaceSignature(node),
      description: getJSDocDescription(node, sourceFile),
      qualifiedName: buildQualifiedName(filePath, node.name.text),
    };
  }

  // Type alias declaration
  if (ts.isTypeAliasDeclaration(node) && node.name) {
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      name: node.name.text,
      kind: 'type',
      file: filePath,
      line: lineNumber,
      endLine: endPos.line + 1,
      exported: isExported,
      signature: getTypeAliasSignature(node),
      description: getJSDocDescription(node, sourceFile),
      qualifiedName: buildQualifiedName(filePath, node.name.text),
    };
  }

  // Enum declaration
  if (ts.isEnumDeclaration(node) && node.name) {
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      name: node.name.text,
      kind: 'enum',
      file: filePath,
      line: lineNumber,
      endLine: endPos.line + 1,
      exported: isExported,
      signature: getEnumSignature(node),
      description: getJSDocDescription(node, sourceFile),
      qualifiedName: buildQualifiedName(filePath, node.name.text),
    };
  }

  // Function declaration
  if (options.includeFunctions && ts.isFunctionDeclaration(node) && node.name) {
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      name: node.name.text,
      kind: 'function',
      file: filePath,
      line: lineNumber,
      endLine: endPos.line + 1,
      exported: isExported,
      signature: getFunctionSignature(node),
      description: getJSDocDescription(node, sourceFile),
      qualifiedName: buildQualifiedName(filePath, node.name.text),
    };
  }

  // Namespace/Module declaration
  if (ts.isModuleDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      name: node.name.text,
      kind: 'namespace',
      file: filePath,
      line: lineNumber,
      endLine: endPos.line + 1,
      exported: isExported,
      description: getJSDocDescription(node, sourceFile),
      qualifiedName: buildQualifiedName(filePath, node.name.text),
    };
  }

  return null;
}

// ============================================================================
// RE-EXPORT EXTRACTION
// ============================================================================

/**
 * Extract re-exports from a source file.
 * Handles:
 * - export { X, Y as Z } from './module'
 * - export * from './module'
 */
function extractReExports(sourceFile: ts.SourceFile, filePath: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        const fromModule = moduleSpecifier.text;
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          // export { X, Y as Z } from './module'
          for (const element of node.exportClause.elements) {
            const elementLine = sourceFile.getLineAndCharacterOfPosition(element.getStart()).line;
            symbols.push({
              name: element.name.text,
              kind: 're-export',
              file: filePath,
              line: elementLine + 1,
              originalName: element.propertyName?.text,
              fromModule,
              exported: true,
              qualifiedName: buildQualifiedName(filePath, element.name.text),
            });
          }
        } else if (!node.exportClause) {
          // export * from './module'
          symbols.push({
            name: `* from ${fromModule}`,
            kind: 'barrel-export',
            file: filePath,
            line: line + 1,
            fromModule,
            exported: true,
            qualifiedName: buildQualifiedName(filePath, `barrel:${fromModule}`),
          });
        }
      }
    }
  });

  return symbols;
}

// ============================================================================
// DECORATOR EXTRACTION
// ============================================================================

/**
 * Extract decorators from a node that can have decorators.
 * Returns an array of decorator names (e.g., ['Component', 'Injectable']).
 */
function extractDecorators(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const decorators: string[] = [];

  const modifiers = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
  if (modifiers) {
    for (const decorator of modifiers) {
      if (ts.isCallExpression(decorator.expression)) {
        // @Component({...}) - get the function name
        const expr = decorator.expression.expression;
        if (ts.isIdentifier(expr)) {
          decorators.push(expr.text);
        } else {
          decorators.push(expr.getText(sourceFile));
        }
      } else if (ts.isIdentifier(decorator.expression)) {
        // @Injectable - direct identifier
        decorators.push(decorator.expression.text);
      } else {
        // Fallback to getText for complex expressions
        decorators.push(decorator.expression.getText(sourceFile));
      }
    }
  }

  return decorators;
}

// ============================================================================
// DEFAULT EXPORT EXTRACTION
// ============================================================================

/**
 * Extract default exports from a source file.
 * Handles:
 * - export default class Foo {}
 * - export default function bar() {}
 * - export default X;
 * - export default () => {};
 */
function extractDefaultExports(sourceFile: ts.SourceFile, filePath: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];

  ts.forEachChild(sourceFile, (node) => {
    // Handle export default X
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const expr = node.expression;
      let name = 'default';

      if (ts.isIdentifier(expr)) {
        // export default SomeIdentifier
        name = `default:${expr.text}`;
      } else if (ts.isFunctionExpression(expr)) {
        // export default function() {} or export default function foo() {}
        if (expr.name) {
          name = `default:${expr.name.text}`;
        } else {
          name = `default:${getFilenameWithoutExt(filePath)}`;
        }
      } else if (ts.isArrowFunction(expr)) {
        // export default () => {}
        name = `default:${getFilenameWithoutExt(filePath)}`;
      } else if (ts.isClassExpression(expr)) {
        // export default class {} or export default class Foo {}
        if (expr.name) {
          name = `default:${expr.name.text}`;
        } else {
          name = `default:${getFilenameWithoutExt(filePath)}`;
        }
      } else if (ts.isObjectLiteralExpression(expr)) {
        // export default { ... }
        name = `default:${getFilenameWithoutExt(filePath)}`;
      }

      symbols.push({
        name,
        kind: 'default-export',
        file: filePath,
        line: line + 1,
        exported: true,
        qualifiedName: buildQualifiedName(filePath, name),
      });
    }

    // Handle export default class/function declarations (already handled in extractSymbolFromNode)
    // But we need to check if they have the default modifier and add a default-export entry
    if (ts.isClassDeclaration(node) && hasDefaultModifier(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const className = node.name?.text ?? getFilenameWithoutExt(filePath);
      symbols.push({
        name: `default:${className}`,
        kind: 'default-export',
        file: filePath,
        line: line + 1,
        exported: true,
        qualifiedName: buildQualifiedName(filePath, `default:${className}`),
      });
    }

    if (ts.isFunctionDeclaration(node) && hasDefaultModifier(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const funcName = node.name?.text ?? getFilenameWithoutExt(filePath);
      symbols.push({
        name: `default:${funcName}`,
        kind: 'default-export',
        file: filePath,
        line: line + 1,
        exported: true,
        qualifiedName: buildQualifiedName(filePath, `default:${funcName}`),
      });
    }
  });

  return symbols;
}

/**
 * Check if a node has the default export modifier.
 */
function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  if (!modifiers) {
    return false;
  }
  return modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/**
 * Get the filename without extension from a file path.
 */
function getFilenameWithoutExt(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/, '');
}

// ============================================================================
// NAMESPACE MEMBER EXTRACTION
// ============================================================================

/**
 * Extract members from a namespace/module declaration.
 * Namespace members are prefixed with the namespace name (e.g., 'MyNamespace.SomeType').
 */
function extractNamespaceMembers(
  node: ts.ModuleDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: SymbolExtractionOptions
): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const namespaceName = node.name.getText(sourceFile);

  // Extract members within namespace
  if (node.body && ts.isModuleBlock(node.body)) {
    for (const statement of node.body.statements) {
      const memberEntries =
        options.includeVariables && ts.isVariableStatement(statement)
          ? extractVariableStatementSymbols(statement, sourceFile, filePath, options)
          : (() => {
              const entry = extractSymbolFromNode(statement, sourceFile, filePath, options);
              return entry ? [entry] : [];
            })();

      for (const memberEntry of memberEntries) {
        // Prefix the member name with the namespace
        memberEntry.name = `${namespaceName}.${memberEntry.name}`;
        memberEntry.namespace = namespaceName;
        // Update qualified name to include namespace
        if (memberEntry.qualifiedName) {
          const baseName = memberEntry.qualifiedName.split(':').pop() ?? memberEntry.name;
          memberEntry.qualifiedName = buildQualifiedName(filePath, `${namespaceName}.${baseName}`);
        }
        symbols.push(memberEntry);
      }

      // Handle nested classes within namespace
      if (ts.isClassDeclaration(statement)) {
        const classMembers = extractClassMembers(statement, sourceFile, filePath);
        for (const member of classMembers) {
          // The class name is already in member.parent, but we need to add namespace prefix
          member.name = `${namespaceName}.${member.name}`;
          member.namespace = namespaceName;
          symbols.push(member);
        }
      }

      // Handle nested interfaces within namespace
      if (ts.isInterfaceDeclaration(statement)) {
        const interfaceMembers = extractInterfaceMembers(statement, sourceFile, filePath);
        for (const member of interfaceMembers) {
          member.name = `${namespaceName}.${member.name}`;
          member.namespace = namespaceName;
          symbols.push(member);
        }
      }
    }
  }

  return symbols;
}

// ============================================================================
// SIGNATURE HELPERS
// ============================================================================

function getClassSignature(node: ts.ClassDeclaration): string {
  const name = node.name?.text ?? 'anonymous';
  const heritage: string[] = [];

  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      const clauseType = clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
      const types = clause.types.map((t) => t.expression.getText()).join(', ');
      heritage.push(`${clauseType} ${types}`);
    }
  }

  return `class ${name}${heritage.length ? ' ' + heritage.join(' ') : ''}`;
}

function getInterfaceSignature(node: ts.InterfaceDeclaration): string {
  const name = node.name.text;
  const heritage: string[] = [];

  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      const types = clause.types.map((t) => t.expression.getText()).join(', ');
      heritage.push(`extends ${types}`);
    }
  }

  return `interface ${name}${heritage.length ? ' ' + heritage.join(' ') : ''}`;
}

function getTypeAliasSignature(node: ts.TypeAliasDeclaration): string {
  const name = node.name.text;
  const typeParams = node.typeParameters
    ? `<${node.typeParameters.map((p) => p.name.text).join(', ')}>`
    : '';
  return `type ${name}${typeParams}`;
}

function getEnumSignature(node: ts.EnumDeclaration): string {
  const name = node.name.text;
  const members = node.members.slice(0, 5).map((m) => {
    if (ts.isIdentifier(m.name)) {
      return m.name.text;
    }
    return '...';
  });
  const suffix = node.members.length > 5 ? ', ...' : '';
  return `enum ${name} { ${members.join(', ')}${suffix} }`;
}

function getFunctionSignature(node: ts.FunctionDeclaration): string {
  const name = node.name?.text ?? 'anonymous';
  const params = node.parameters
    .slice(0, 4)
    .map((p) => {
      const pName = ts.isIdentifier(p.name) ? p.name.text : '...';
      const pType = p.type ? `: ${p.type.getText().slice(0, 30)}` : '';
      return `${pName}${pType}`;
    })
    .join(', ');
  const suffix = node.parameters.length > 4 ? ', ...' : '';
  const returnType = node.type ? `: ${node.type.getText().slice(0, 30)}` : '';
  return `function ${name}(${params}${suffix})${returnType}`;
}

type FunctionInitializer = ts.ArrowFunction | ts.FunctionExpression;

interface NamedBindingIdentifier {
  name: string;
  node: ts.Identifier;
}

function extractVariableStatementSymbols(
  node: ts.VariableStatement,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: SymbolExtractionOptions
): SymbolEntry[] {
  const isExported = hasExportModifier(node) || isExportedDeclaration(node);
  if (options.exportedOnly && !isExported) {
    return [];
  }

  const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
  const defaultKind: SymbolKind = isConst ? 'const' : 'variable';
  const description = getJSDocDescription(node, sourceFile);
  const symbols: SymbolEntry[] = [];

  for (const declaration of node.declarationList.declarations) {
    const functionInitializer = isFunctionInitializer(declaration.initializer)
      ? declaration.initializer
      : null;
    const bindingIdentifiers = extractBindingIdentifiers(declaration.name);

    for (const binding of bindingIdentifiers) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(binding.node.getStart());
      const endLine = functionInitializer
        ? sourceFile.getLineAndCharacterOfPosition(functionInitializer.getEnd()).line + 1
        : undefined;

      symbols.push({
        name: binding.name,
        kind: functionInitializer ? 'function' : defaultKind,
        file: filePath,
        line: line + 1,
        endLine,
        exported: isExported,
        parameters: functionInitializer
          ? extractFunctionLikeParameters(functionInitializer)
          : undefined,
        signature: functionInitializer
          ? getVariableFunctionSignature(binding.name, functionInitializer)
          : getVariableSignature(declaration, binding.name),
        description,
        qualifiedName: buildQualifiedName(filePath, binding.name),
      });
    }
  }

  return symbols;
}

function isFunctionInitializer(
  initializer: ts.Expression | undefined
): initializer is FunctionInitializer {
  return !!initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
}

function extractBindingIdentifiers(name: ts.BindingName): NamedBindingIdentifier[] {
  if (ts.isIdentifier(name)) {
    return [{ name: name.text, node: name }];
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) => {
      if (ts.isOmittedExpression(element)) {
        return [];
      }
      return extractBindingIdentifiers(element.name);
    });
  }

  return [];
}

function extractFunctionLikeParameters(func: FunctionInitializer): string[] {
  return func.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : p.name.getText()));
}

function getVariableFunctionSignature(name: string, func: FunctionInitializer): string {
  const params = func.parameters
    .slice(0, 4)
    .map((p) => {
      const pName = ts.isIdentifier(p.name) ? p.name.text : p.name.getText();
      const pType = p.type ? `: ${p.type.getText().slice(0, 30)}` : '';
      return `${pName}${pType}`;
    })
    .join(', ');
  const suffix = func.parameters.length > 4 ? ', ...' : '';
  const returnType = func.type ? `: ${func.type.getText().slice(0, 30)}` : '';
  return `function ${name}(${params}${suffix})${returnType}`;
}

function getVariableSignature(
  declaration: ts.VariableDeclaration,
  bindingName?: string
): string | undefined {
  if (!ts.isIdentifier(declaration.name)) {
    return bindingName;
  }
  const name = bindingName ?? declaration.name.text;
  if (declaration.type) {
    return `${name}: ${declaration.type.getText().slice(0, 50)}`;
  }
  return name;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a node has an export modifier.
 */
function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  if (!modifiers) {
    return false;
  }
  return modifiers.some(
    (m) =>
      m.kind === ts.SyntaxKind.ExportKeyword ||
      m.kind === ts.SyntaxKind.DefaultKeyword
  );
}

/**
 * Check if a node is an exported declaration (export { X } or export default).
 */
function isExportedDeclaration(node: ts.Node): boolean {
  // Check if parent is an ExportDeclaration
  if (node.parent && ts.isExportAssignment(node.parent)) {
    return true;
  }
  return false;
}

/**
 * Extract JSDoc description from a node.
 */
function getJSDocDescription(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const jsDocs = ts.getJSDocCommentsAndTags(node);
  for (const doc of jsDocs) {
    if (ts.isJSDoc(doc) && doc.comment) {
      if (typeof doc.comment === 'string') {
        return doc.comment.slice(0, 200);
      }
      // Handle JSDocComment which is an array
      if (Array.isArray(doc.comment)) {
        return doc.comment
          .map((c) => (typeof c === 'string' ? c : c.text))
          .join('')
          .slice(0, 200);
      }
    }
  }
  return undefined;
}

/**
 * Build a qualified name for a symbol.
 */
function buildQualifiedName(filePath: string, symbolName: string): string {
  // Remove extension and use relative path
  const relativePath = filePath.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
  return `${relativePath}:${symbolName}`;
}

// ============================================================================
// CLASS MEMBER EXTRACTION
// ============================================================================

/**
 * Extract member symbols from a class declaration.
 */
function extractClassMembers(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string
): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const className = node.name?.getText(sourceFile) || 'anonymous';

  node.members.forEach((member) => {
    // Extract methods
    if (ts.isMethodDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(member.getStart());
      const endPos = sourceFile.getLineAndCharacterOfPosition(member.getEnd());
      const decorators = extractDecorators(member, sourceFile);

      symbols.push({
        name: `${className}.${name}`,
        kind: 'method',
        file: filePath,
        line: line + 1,
        endLine: endPos.line + 1,
        parent: className,
        exported: hasExportModifier(node),
        visibility: getVisibility(member),
        isAsync: hasAsyncModifier(member),
        isStatic: hasStaticModifier(member),
        parameters: extractParameters(member),
        signature: getMethodSignature(member, className),
        description: getJSDocDescription(member, sourceFile),
        qualifiedName: buildQualifiedName(filePath, `${className}.${name}`),
        decorators: decorators.length > 0 ? decorators : undefined,
      });
    }

    // Extract properties
    if (ts.isPropertyDeclaration(member)) {
      const name = member.name.getText(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(member.getStart());
      const decorators = extractDecorators(member, sourceFile);

      symbols.push({
        name: `${className}.${name}`,
        kind: 'property',
        file: filePath,
        line: line + 1,
        parent: className,
        exported: hasExportModifier(node),
        visibility: getVisibility(member),
        isStatic: hasStaticModifier(member),
        signature: getPropertySignature(member, className),
        description: getJSDocDescription(member, sourceFile),
        qualifiedName: buildQualifiedName(filePath, `${className}.${name}`),
        decorators: decorators.length > 0 ? decorators : undefined,
      });
    }

    // Extract getters and setters
    if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
      const name = member.name.getText(sourceFile);
      const kind: SymbolKind = ts.isGetAccessor(member) ? 'getter' : 'setter';
      const { line } = sourceFile.getLineAndCharacterOfPosition(member.getStart());
      const endPos = sourceFile.getLineAndCharacterOfPosition(member.getEnd());
      const decorators = extractDecorators(member, sourceFile);

      symbols.push({
        name: `${className}.${name}`,
        kind,
        file: filePath,
        line: line + 1,
        endLine: endPos.line + 1,
        parent: className,
        exported: hasExportModifier(node),
        visibility: getVisibility(member),
        description: getJSDocDescription(member, sourceFile),
        qualifiedName: buildQualifiedName(filePath, `${className}.${name}`),
        decorators: decorators.length > 0 ? decorators : undefined,
      });
    }
  });

  return symbols;
}

/**
 * Extract member symbols from an interface declaration.
 */
function extractInterfaceMembers(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string
): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const interfaceName = node.name.getText(sourceFile);

  node.members.forEach((member) => {
    // Extract property signatures
    if (ts.isPropertySignature(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(member.getStart());

      symbols.push({
        name: `${interfaceName}.${name}`,
        kind: 'property',
        file: filePath,
        line: line + 1,
        parent: interfaceName,
        exported: hasExportModifier(node),
        signature: getInterfacePropertySignature(member, interfaceName),
        description: getJSDocDescription(member, sourceFile),
        qualifiedName: buildQualifiedName(filePath, `${interfaceName}.${name}`),
      });
    }

    // Extract method signatures
    if (ts.isMethodSignature(member) && member.name) {
      const name = member.name.getText(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(member.getStart());

      symbols.push({
        name: `${interfaceName}.${name}`,
        kind: 'method',
        file: filePath,
        line: line + 1,
        parent: interfaceName,
        exported: hasExportModifier(node),
        parameters: extractSignatureParameters(member),
        signature: getInterfaceMethodSignature(member, interfaceName),
        description: getJSDocDescription(member, sourceFile),
        qualifiedName: buildQualifiedName(filePath, `${interfaceName}.${name}`),
      });
    }
  });

  return symbols;
}

/**
 * Get visibility modifier from a class member node.
 */
function getVisibility(node: ts.Node): MemberVisibility {
  if (!ts.canHaveModifiers(node)) {
    return 'public';
  }
  const modifiers = ts.getModifiers(node);
  if (!modifiers) {
    return 'public';
  }
  if (modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)) {
    return 'private';
  }
  if (modifiers.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword)) {
    return 'protected';
  }
  return 'public';
}

/**
 * Check if a node has the static modifier.
 */
function hasStaticModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  if (!modifiers) {
    return false;
  }
  return modifiers.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
}

/**
 * Check if a node has the async modifier.
 */
function hasAsyncModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  if (!modifiers) {
    return false;
  }
  return modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

/**
 * Extract parameters from a method declaration.
 */
function extractParameters(method: ts.MethodDeclaration): string[] {
  return method.parameters.map((p) => {
    const pName = ts.isIdentifier(p.name) ? p.name.text : '...';
    return pName;
  });
}

/**
 * Extract parameters from a method signature (interface).
 */
function extractSignatureParameters(method: ts.MethodSignature): string[] {
  return method.parameters.map((p) => {
    const pName = ts.isIdentifier(p.name) ? p.name.text : '...';
    return pName;
  });
}

/**
 * Get signature for a class method.
 */
function getMethodSignature(method: ts.MethodDeclaration, className: string): string {
  const name = ts.isIdentifier(method.name) ? method.name.text : method.name.getText();
  const params = method.parameters
    .slice(0, 4)
    .map((p) => {
      const pName = ts.isIdentifier(p.name) ? p.name.text : '...';
      const pType = p.type ? `: ${p.type.getText().slice(0, 30)}` : '';
      return `${pName}${pType}`;
    })
    .join(', ');
  const suffix = method.parameters.length > 4 ? ', ...' : '';
  const returnType = method.type ? `: ${method.type.getText().slice(0, 30)}` : '';
  const asyncPrefix = hasAsyncModifier(method) ? 'async ' : '';
  return `${className}.${asyncPrefix}${name}(${params}${suffix})${returnType}`;
}

/**
 * Get signature for a class property.
 */
function getPropertySignature(prop: ts.PropertyDeclaration, className: string): string {
  const name = prop.name.getText();
  const typeStr = prop.type ? `: ${prop.type.getText().slice(0, 50)}` : '';
  const staticPrefix = hasStaticModifier(prop) ? 'static ' : '';
  return `${className}.${staticPrefix}${name}${typeStr}`;
}

/**
 * Get signature for an interface property.
 */
function getInterfacePropertySignature(prop: ts.PropertySignature, interfaceName: string): string {
  const name = prop.name.getText();
  const typeStr = prop.type ? `: ${prop.type.getText().slice(0, 50)}` : '';
  const optional = prop.questionToken ? '?' : '';
  return `${interfaceName}.${name}${optional}${typeStr}`;
}

/**
 * Get signature for an interface method.
 */
function getInterfaceMethodSignature(method: ts.MethodSignature, interfaceName: string): string {
  const name = method.name.getText();
  const params = method.parameters
    .slice(0, 4)
    .map((p) => {
      const pName = ts.isIdentifier(p.name) ? p.name.text : '...';
      const pType = p.type ? `: ${p.type.getText().slice(0, 30)}` : '';
      return `${pName}${pType}`;
    })
    .join(', ');
  const suffix = method.parameters.length > 4 ? ', ...' : '';
  const returnType = method.type ? `: ${method.type.getText().slice(0, 30)}` : '';
  return `${interfaceName}.${name}(${params}${suffix})${returnType}`;
}

// ============================================================================
// FILE EXTRACTION
// ============================================================================

/**
 * Extract symbols from a TypeScript/JavaScript file.
 */
export async function extractSymbolsFromFile(
  filePath: string,
  options: SymbolExtractionOptions = DEFAULT_OPTIONS
): Promise<SymbolEntry[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKindForPath(filePath)
  );

  return extractSymbolsFromSource(sourceFile, filePath, options);
}

/**
 * Extract symbols from multiple TypeScript/JavaScript files.
 */
export async function extractSymbolsFromFiles(
  filePaths: string[],
  options: SymbolExtractionOptions = DEFAULT_OPTIONS
): Promise<SymbolExtractionResult> {
  const startTime = Date.now();
  const allSymbols: SymbolEntry[] = [];
  const filesWithErrors: string[] = [];
  let filesProcessed = 0;

  const batchSize = resolveBatchSize(options.batchSize);
  const candidateFiles = filePaths.filter((filePath) => !shouldExclude(filePath, options.excludePatterns));

  for (let index = 0; index < candidateFiles.length; index += batchSize) {
    const batch = candidateFiles.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const symbols = await extractSymbolsFromFile(filePath, options);
          return { filePath, symbols };
        } catch {
          return { filePath, symbols: null as SymbolEntry[] | null };
        }
      }),
    );

    for (const result of batchResults) {
      if (result.symbols) {
        allSymbols.push(...result.symbols);
        filesProcessed += 1;
      } else {
        filesWithErrors.push(result.filePath);
      }
    }
  }

  return {
    symbols: allSymbols,
    filesProcessed,
    filesWithErrors,
    extractionTimeMs: Date.now() - startTime,
  };
}

/**
 * Check if a file should be excluded based on patterns.
 */
function shouldExclude(filePath: string, patterns?: string[]): boolean {
  if (!patterns) {
    return false;
  }
  const normalizedPath = filePath.replace(/\\/g, '/');
  for (const pattern of patterns) {
    if (pattern.startsWith('*.')) {
      // Extension pattern
      if (normalizedPath.endsWith(pattern.slice(1))) {
        return true;
      }
    } else if (normalizedPath.includes(`/${pattern}/`) || normalizedPath.includes(`/${pattern}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract symbols from a directory recursively.
 */
export async function extractSymbolsFromDirectory(
  directory: string,
  options: SymbolExtractionOptions = DEFAULT_OPTIONS
): Promise<SymbolExtractionResult> {
  const startTime = Date.now();
  const discoveredFiles: string[] = [];

  async function collectDirectory(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const childDirectories: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldExclude(`${fullPath}/`, options.excludePatterns)) {
          childDirectories.push(fullPath);
        }
      } else if (entry.isFile() && isSupportedSourceFile(entry.name) && !shouldExclude(fullPath, options.excludePatterns)) {
        discoveredFiles.push(fullPath);
      }
    }

    await Promise.all(childDirectories.map((childDir) => collectDirectory(childDir)));
  }

  await collectDirectory(directory);

  const result = await extractSymbolsFromFiles(discoveredFiles, options);
  return {
    ...result,
    extractionTimeMs: Date.now() - startTime,
  };
}

/**
 * Check if a file is a supported source file for symbol extraction.
 */
function isSupportedSourceFile(filename: string): boolean {
  return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(filename) && !filename.endsWith('.d.ts');
}

function getScriptKindForPath(filePath: string): ts.ScriptKind {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (normalized.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (
    normalized.endsWith('.js')
    || normalized.endsWith('.mjs')
    || normalized.endsWith('.cjs')
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function resolveBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  const normalized = Math.trunc(value as number);
  if (normalized < 1) return 1;
  if (normalized > 200) return 200;
  return normalized;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  extractSymbolsFromSource as default,
};
