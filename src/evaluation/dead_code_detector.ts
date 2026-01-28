/**
 * @fileoverview Dead Code Detector
 *
 * Identifies potentially unused or unreachable code using static analysis:
 * - Unreachable code (after return/throw/break/continue, always-false conditions)
 * - Unused exports (exported but never imported elsewhere)
 * - Unused variables (declared but never referenced)
 * - Unused functions/classes
 * - Commented-out code blocks
 *
 * This is a Tier-1 feature (pure static analysis, no LLM).
 *
 * @packageDocumentation
 */

import { Project, SourceFile, SyntaxKind, Node, ts } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of dead code that can be detected
 */
export type DeadCodeType =
  | 'unreachable'
  | 'unused_export'
  | 'unused_variable'
  | 'unused_function'
  | 'unused_class'
  | 'commented_code';

/**
 * A single dead code candidate
 */
export interface DeadCodeCandidate {
  /** The type of dead code */
  type: DeadCodeType;
  /** The file path where this was detected */
  file: string;
  /** The line number (1-based) */
  line: number;
  /** The identifier name (if applicable) */
  identifier?: string;
  /** Confidence score from 0.0 to 1.0 */
  confidence: number;
  /** Human-readable reason for flagging */
  reason: string;
  /** Code snippet (optional) */
  codeSnippet?: string;
}

/**
 * Summary of dead code detection results
 */
export interface DeadCodeSummary {
  /** Total number of candidates found */
  totalCandidates: number;
  /** Count by type */
  byType: Record<string, number>;
  /** Number of high confidence candidates (>0.8) */
  highConfidence: number;
}

/**
 * Full dead code detection report
 */
export interface DeadCodeReport {
  /** The repository path analyzed */
  repoPath: string;
  /** ISO timestamp of analysis */
  analyzedAt: string;
  /** All dead code candidates found */
  candidates: DeadCodeCandidate[];
  /** Summary statistics */
  summary: DeadCodeSummary;
}

// ============================================================================
// DEAD CODE DETECTOR CLASS
// ============================================================================

/**
 * Detects dead code patterns in TypeScript/JavaScript codebases
 */
export class DeadCodeDetector {
  private project: Project;
  private commentedCodeMinLines: number;

  constructor(options: { commentedCodeMinLines?: number } = {}) {
    this.commentedCodeMinLines = options.commentedCodeMinLines ?? 3;
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
   * Detect all dead code in a repository
   */
  async detect(repoPath: string): Promise<DeadCodeReport> {
    const candidates: DeadCodeCandidate[] = [];

    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      return this.buildReport(repoPath, candidates);
    }

    const files = this.getTypeScriptFiles(repoPath);

    // Detect unreachable code, unused variables, and commented code per file
    for (const file of files) {
      candidates.push(...(await this.detectUnreachable(file)));
      candidates.push(...(await this.detectUnusedVariables(file)));
      candidates.push(...(await this.detectCommentedCode(file)));
    }

    // Detect unused exports (requires scanning all files)
    candidates.push(...(await this.detectUnusedExports(repoPath)));

    return this.buildReport(repoPath, candidates);
  }

  /**
   * Detect unreachable code in a single file
   */
  async detectUnreachable(filePath: string): Promise<DeadCodeCandidate[]> {
    const candidates: DeadCodeCandidate[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return candidates;
      }

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return candidates;
      }

      // Check for code after return/throw/break/continue
      candidates.push(...this.detectCodeAfterTerminator(sourceFile));

      // Check for always-false conditions
      candidates.push(...this.detectAlwaysFalseConditions(sourceFile));
    } catch {
      // Gracefully handle parse errors
    }

    return candidates;
  }

  /**
   * Detect unused exports in a repository
   */
  async detectUnusedExports(repoPath: string): Promise<DeadCodeCandidate[]> {
    const candidates: DeadCodeCandidate[] = [];

    try {
      if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
        return candidates;
      }

      const files = this.getTypeScriptFiles(repoPath);

      // Build export map: identifier -> { file, line, kind }
      const exports = new Map<string, { file: string; line: number; kind: string }>();

      // Build import map: what identifiers are imported
      const imports = new Set<string>();

      for (const file of files) {
        const sourceFile = this.getOrAddSourceFile(file);
        if (!sourceFile) continue;

        // Collect exports
        this.collectExports(sourceFile, exports);

        // Collect imports
        this.collectImports(sourceFile, imports);
      }

      // Find exports that are never imported
      for (const [identifier, info] of exports) {
        if (!imports.has(identifier)) {
          // Lower confidence for index.ts files (public API)
          const isIndexFile =
            info.file.endsWith('index.ts') || info.file.endsWith('index.js');
          const confidence = isIndexFile ? 0.5 : 0.8;

          candidates.push({
            type: 'unused_export',
            file: info.file,
            line: info.line,
            identifier,
            confidence,
            reason: `Exported ${info.kind} '${identifier}' is not imported anywhere in the codebase`,
          });
        }
      }
    } catch {
      // Gracefully handle errors
    }

    return candidates;
  }

  /**
   * Detect unused variables in a single file
   */
  async detectUnusedVariables(filePath: string): Promise<DeadCodeCandidate[]> {
    const candidates: DeadCodeCandidate[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return candidates;
      }

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return candidates;
      }

      // Check for unused local variables
      candidates.push(...this.detectUnusedLocals(sourceFile));

      // Check for unused parameters
      candidates.push(...this.detectUnusedParameters(sourceFile));

      // Check for unused private functions
      candidates.push(...this.detectUnusedPrivateFunctions(sourceFile));
    } catch {
      // Gracefully handle parse errors
    }

    return candidates;
  }

  /**
   * Detect commented-out code blocks
   */
  async detectCommentedCode(filePath: string): Promise<DeadCodeCandidate[]> {
    const candidates: DeadCodeCandidate[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return candidates;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Detect single-line comment blocks with code patterns
      candidates.push(...this.detectSingleLineCommentedCode(filePath, lines));

      // Detect multi-line block comments with code
      candidates.push(...this.detectBlockCommentedCode(filePath, content));
    } catch {
      // Gracefully handle errors
    }

    return candidates;
  }

  // ============================================================================
  // PRIVATE: UNREACHABLE CODE DETECTION
  // ============================================================================

  private detectCodeAfterTerminator(sourceFile: SourceFile): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];
    const filePath = sourceFile.getFilePath();

    // Find all blocks (function bodies, if blocks, etc.)
    sourceFile.forEachDescendant((node) => {
      if (Node.isBlock(node)) {
        const statements = node.getStatements();
        let foundTerminator = false;
        let terminatorType = '';
        let terminatorLine = 0;

        for (const stmt of statements) {
          if (foundTerminator) {
            // This statement is after a terminator
            candidates.push({
              type: 'unreachable',
              file: filePath,
              line: stmt.getStartLineNumber(),
              confidence: 0.95,
              reason: `Code is unreachable after ${terminatorType} statement at line ${terminatorLine}`,
              codeSnippet: stmt.getText().slice(0, 100),
            });
          }

          // Check if this statement is a terminator
          if (Node.isReturnStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'return';
            terminatorLine = stmt.getStartLineNumber();
          } else if (Node.isThrowStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'throw';
            terminatorLine = stmt.getStartLineNumber();
          } else if (Node.isBreakStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'break';
            terminatorLine = stmt.getStartLineNumber();
          } else if (Node.isContinueStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'continue';
            terminatorLine = stmt.getStartLineNumber();
          }
        }
      }

      // Also check switch case clauses
      if (Node.isCaseClause(node) || Node.isDefaultClause(node)) {
        const statements = node.getStatements();
        let foundTerminator = false;
        let terminatorType = '';
        let terminatorLine = 0;

        for (const stmt of statements) {
          if (foundTerminator) {
            candidates.push({
              type: 'unreachable',
              file: filePath,
              line: stmt.getStartLineNumber(),
              confidence: 0.95,
              reason: `Code is unreachable after ${terminatorType} statement at line ${terminatorLine}`,
              codeSnippet: stmt.getText().slice(0, 100),
            });
          }

          if (Node.isReturnStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'return';
            terminatorLine = stmt.getStartLineNumber();
          } else if (Node.isThrowStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'throw';
            terminatorLine = stmt.getStartLineNumber();
          } else if (Node.isBreakStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'break';
            terminatorLine = stmt.getStartLineNumber();
          } else if (Node.isContinueStatement(stmt)) {
            foundTerminator = true;
            terminatorType = 'continue';
            terminatorLine = stmt.getStartLineNumber();
          }
        }
      }
    });

    return candidates;
  }

  private detectAlwaysFalseConditions(sourceFile: SourceFile): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (Node.isIfStatement(node)) {
        const condition = node.getExpression();

        // Check for literal false
        if (Node.isFalseLiteral(condition)) {
          const thenBlock = node.getThenStatement();
          candidates.push({
            type: 'unreachable',
            file: filePath,
            line: thenBlock.getStartLineNumber(),
            confidence: 1.0,
            reason: 'Code inside if(false) block is never executed',
            codeSnippet: thenBlock.getText().slice(0, 100),
          });
        }

        // Check for x && !x or similar patterns
        if (Node.isBinaryExpression(condition)) {
          const operator = condition.getOperatorToken().getText();
          if (operator === '&&') {
            const left = condition.getLeft().getText();
            const right = condition.getRight().getText();

            // Check for !x && x or x && !x
            if (right === `!${left}` || left === `!${right}`) {
              const thenBlock = node.getThenStatement();
              candidates.push({
                type: 'unreachable',
                file: filePath,
                line: thenBlock.getStartLineNumber(),
                confidence: 0.9,
                reason: 'Condition is always false (contradictory operands)',
                codeSnippet: thenBlock.getText().slice(0, 100),
              });
            }
          }
        }
      }
    });

    return candidates;
  }

  // ============================================================================
  // PRIVATE: UNUSED EXPORTS DETECTION
  // ============================================================================

  private collectExports(
    sourceFile: SourceFile,
    exports: Map<string, { file: string; line: number; kind: string }>
  ): void {
    const filePath = sourceFile.getFilePath();

    // Exported functions
    for (const func of sourceFile.getFunctions()) {
      if (func.isExported()) {
        const name = func.getName();
        if (name) {
          exports.set(name, { file: filePath, line: func.getStartLineNumber(), kind: 'function' });
        }
      }
    }

    // Exported classes
    for (const cls of sourceFile.getClasses()) {
      if (cls.isExported()) {
        const name = cls.getName();
        if (name) {
          exports.set(name, { file: filePath, line: cls.getStartLineNumber(), kind: 'class' });
        }
      }
    }

    // Exported interfaces
    for (const iface of sourceFile.getInterfaces()) {
      if (iface.isExported()) {
        const name = iface.getName();
        exports.set(name, { file: filePath, line: iface.getStartLineNumber(), kind: 'interface' });
      }
    }

    // Exported type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (typeAlias.isExported()) {
        const name = typeAlias.getName();
        exports.set(name, { file: filePath, line: typeAlias.getStartLineNumber(), kind: 'type' });
      }
    }

    // Exported variables/constants
    for (const varStmt of sourceFile.getVariableStatements()) {
      if (varStmt.isExported()) {
        for (const decl of varStmt.getDeclarations()) {
          const name = decl.getName();
          exports.set(name, { file: filePath, line: varStmt.getStartLineNumber(), kind: 'variable' });
        }
      }
    }

    // Exported enums
    for (const enumDecl of sourceFile.getEnums()) {
      if (enumDecl.isExported()) {
        const name = enumDecl.getName();
        exports.set(name, { file: filePath, line: enumDecl.getStartLineNumber(), kind: 'enum' });
      }
    }
  }

  private collectImports(sourceFile: SourceFile, imports: Set<string>): void {
    for (const importDecl of sourceFile.getImportDeclarations()) {
      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        imports.add(defaultImport.getText());
      }

      // Namespace import
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        imports.add(namespaceImport.getText());
      }

      // Named imports
      for (const namedImport of importDecl.getNamedImports()) {
        const name = namedImport.getName();
        imports.add(name);

        // Also track the alias if present
        const alias = namedImport.getAliasNode()?.getText();
        if (alias) {
          imports.add(alias);
        }
      }
    }

    // Also check export declarations that re-export
    for (const exportDecl of sourceFile.getExportDeclarations()) {
      for (const namedExport of exportDecl.getNamedExports()) {
        const name = namedExport.getName();
        imports.add(name); // Re-exports count as "used"
      }
    }
  }

  // ============================================================================
  // PRIVATE: UNUSED VARIABLES DETECTION
  // ============================================================================

  private detectUnusedLocals(sourceFile: SourceFile): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (Node.isVariableDeclaration(node)) {
        const nameNode = node.getNameNode();

        // Handle simple identifier names
        if (Node.isIdentifier(nameNode)) {
          const name = nameNode.getText();

          // Skip underscore-prefixed variables (intentionally unused)
          if (name.startsWith('_')) {
            return;
          }

          // Skip exported variables
          const varStmt = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
          if (varStmt?.isExported()) {
            return;
          }

          // Get the scope to search for references
          const scope = this.getContainingScope(node);
          if (!scope) {
            return;
          }

          // Check if the variable is used anywhere in its scope
          const isUsed = this.isIdentifierUsedInScope(name, scope, nameNode);

          if (!isUsed) {
            candidates.push({
              type: 'unused_variable',
              file: filePath,
              line: node.getStartLineNumber(),
              identifier: name,
              confidence: 0.85,
              reason: `Variable '${name}' is declared but never used`,
            });
          }
        }
        // Handle destructuring patterns
        else {
          const nameKind = nameNode.getKind();
          if (nameKind === SyntaxKind.ObjectBindingPattern || nameKind === SyntaxKind.ArrayBindingPattern) {
            const scope = this.getContainingScope(node);
            if (!scope) return;

            this.checkBindingPattern(nameNode, scope, filePath, candidates);
          }
        }
      }
    });

    return candidates;
  }

  private checkBindingPattern(
    pattern: Node,
    scope: Node,
    filePath: string,
    candidates: DeadCodeCandidate[]
  ): void {
    const bindingElements = pattern.getDescendantsOfKind(SyntaxKind.BindingElement);

    for (const child of bindingElements) {
      const nameNode = child.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        const name = nameNode.getText();

        // Skip underscore-prefixed
        if (name.startsWith('_')) {
          continue;
        }

        const isUsed = this.isIdentifierUsedInScope(name, scope, nameNode);

        if (!isUsed) {
          candidates.push({
            type: 'unused_variable',
            file: filePath,
            line: child.getStartLineNumber(),
            identifier: name,
            confidence: 0.85,
            reason: `Destructured variable '${name}' is declared but never used`,
          });
        }
      }
    }
  }

  private detectUnusedParameters(sourceFile: SourceFile): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];
    const filePath = sourceFile.getFilePath();

    // Check function parameters
    for (const func of sourceFile.getFunctions()) {
      const params = func.getParameters();
      const body = func.getBody();
      if (!body) continue;

      for (const param of params) {
        const nameNode = param.getNameNode();
        if (!Node.isIdentifier(nameNode)) continue;

        const name = nameNode.getText();

        // Skip underscore-prefixed parameters
        if (name.startsWith('_')) {
          continue;
        }

        // Check if parameter is used in the function body
        const isUsed = this.isIdentifierUsedInScope(name, body, nameNode);

        if (!isUsed) {
          candidates.push({
            type: 'unused_variable',
            file: filePath,
            line: param.getStartLineNumber(),
            identifier: name,
            confidence: 0.8,
            reason: `Parameter '${name}' is never used in function body`,
          });
        }
      }
    }

    // Check method parameters
    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const params = method.getParameters();
        const body = method.getBody();
        if (!body) continue;

        for (const param of params) {
          const nameNode = param.getNameNode();
          if (!Node.isIdentifier(nameNode)) continue;

          const name = nameNode.getText();

          if (name.startsWith('_')) {
            continue;
          }

          const isUsed = this.isIdentifierUsedInScope(name, body, nameNode);

          if (!isUsed) {
            candidates.push({
              type: 'unused_variable',
              file: filePath,
              line: param.getStartLineNumber(),
              identifier: name,
              confidence: 0.8,
              reason: `Parameter '${name}' is never used in method body`,
            });
          }
        }
      }
    }

    // Check arrow function parameters
    sourceFile.forEachDescendant((node) => {
      if (Node.isArrowFunction(node)) {
        const params = node.getParameters();
        const body = node.getBody();

        for (const param of params) {
          const nameNode = param.getNameNode();
          if (!Node.isIdentifier(nameNode)) continue;

          const name = nameNode.getText();

          if (name.startsWith('_')) {
            continue;
          }

          const isUsed = this.isIdentifierUsedInScope(name, body, nameNode);

          if (!isUsed) {
            candidates.push({
              type: 'unused_variable',
              file: filePath,
              line: param.getStartLineNumber(),
              identifier: name,
              confidence: 0.8,
              reason: `Parameter '${name}' is never used in arrow function body`,
            });
          }
        }
      }
    });

    // Check for-of loop variables
    sourceFile.forEachDescendant((node) => {
      if (Node.isForOfStatement(node)) {
        const initializer = node.getInitializer();
        if (Node.isVariableDeclarationList(initializer)) {
          const decls = initializer.getDeclarations();
          for (const decl of decls) {
            const nameNode = decl.getNameNode();
            if (Node.isIdentifier(nameNode)) {
              const name = nameNode.getText();

              if (name.startsWith('_')) {
                continue;
              }

              const body = node.getStatement();
              const isUsed = this.isIdentifierUsedInScope(name, body, nameNode);

              if (!isUsed) {
                candidates.push({
                  type: 'unused_variable',
                  file: filePath,
                  line: decl.getStartLineNumber(),
                  identifier: name,
                  confidence: 0.8,
                  reason: `Loop variable '${name}' is declared but never used in loop body`,
                });
              }
            }
          }
        }
      }
    });

    return candidates;
  }

  private detectUnusedPrivateFunctions(sourceFile: SourceFile): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];
    const filePath = sourceFile.getFilePath();

    // Build a map of function names and their usage
    const functionNames = new Map<string, { line: number; isExported: boolean }>();
    const calledFunctions = new Set<string>();

    // Collect all function declarations
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (name) {
        functionNames.set(name, {
          line: func.getStartLineNumber(),
          isExported: func.isExported(),
        });
      }
    }

    // Collect all function calls
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        if (Node.isIdentifier(expr)) {
          calledFunctions.add(expr.getText());
        }
      }
    });

    // Find functions that are never called
    for (const [name, info] of functionNames) {
      if (!info.isExported && !calledFunctions.has(name)) {
        candidates.push({
          type: 'unused_function',
          file: filePath,
          line: info.line,
          identifier: name,
          confidence: 0.85,
          reason: `Function '${name}' is defined but never called`,
        });
      }
    }

    return candidates;
  }

  private getContainingScope(node: Node): Node | undefined {
    // Walk up to find the containing function or file
    let current = node.getParent();
    while (current) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isSourceFile(current)
      ) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  private isIdentifierUsedInScope(name: string, scope: Node, declarationNode: Node): boolean {
    // Get the position of the declaration for comparison
    const declarationStart = declarationNode.getStart();
    const declarationEnd = declarationNode.getEnd();

    const descendants = scope.getDescendantsOfKind(SyntaxKind.Identifier);

    for (const node of descendants) {
      if (node.getText() !== name) {
        continue;
      }

      const nodeStart = node.getStart();
      const nodeEnd = node.getEnd();

      // Skip the declaration identifier itself (compare by position)
      if (nodeStart === declarationStart && nodeEnd === declarationEnd) {
        continue;
      }

      // Check the parent to understand the context
      const parent = node.getParent();
      if (!parent) {
        // No parent, this is a reference
        return true;
      }

      const parentKind = parent.getKind();

      // Skip if this is the name being declared in a variable declaration
      if (parentKind === SyntaxKind.VariableDeclaration) {
        const varDecl = parent as import('ts-morph').VariableDeclaration;
        const nameNode = varDecl.getNameNode();
        if (Node.isIdentifier(nameNode) && nameNode.getStart() === nodeStart) {
          continue; // This is a declaration, not a reference
        }
      }

      // Skip if this is a parameter declaration
      if (parentKind === SyntaxKind.Parameter) {
        const param = parent as import('ts-morph').ParameterDeclaration;
        const nameNode = param.getNameNode();
        if (Node.isIdentifier(nameNode) && nameNode.getStart() === nodeStart) {
          continue; // This is a parameter declaration, not a reference
        }
      }

      // Skip if this is a binding element name (the binding name in destructuring)
      if (parentKind === SyntaxKind.BindingElement) {
        const binding = parent as import('ts-morph').BindingElement;
        const nameNode = binding.getNameNode();
        if (Node.isIdentifier(nameNode) && nameNode.getStart() === nodeStart) {
          continue; // This is the binding element declaration, not a reference
        }
        // Also skip if this is the property name in destructuring like { prop: alias }
        const propertyName = binding.getPropertyNameNode();
        if (propertyName && propertyName.getStart() === nodeStart) {
          continue; // This is the property name, not a reference
        }
      }

      // Skip if this is a property assignment name (in object literal)
      if (parentKind === SyntaxKind.PropertyAssignment) {
        const propAssign = parent as import('ts-morph').PropertyAssignment;
        const propName = propAssign.getNameNode();
        if (propName && propName.getStart() === nodeStart) {
          continue; // This is a property name in object literal, not a reference
        }
      }

      // Skip if this is a shorthand property assignment name (in object literal like { foo })
      // Note: This case is special - the identifier IS the reference in shorthand
      // But if we're looking for unused variable detection, we need to not double count
      if (parentKind === SyntaxKind.ShorthandPropertyAssignment) {
        // In { foo }, foo appears as both property name and value reference
        // We should count this as a reference since it's using the variable
        return true;
      }

      // This is a genuine reference!
      return true;
    }

    return false;
  }

  // ============================================================================
  // PRIVATE: COMMENTED CODE DETECTION
  // ============================================================================

  private detectSingleLineCommentedCode(
    filePath: string,
    lines: string[]
  ): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];

    // Code patterns that indicate commented-out code
    const codePatterns = [
      /^\s*\/\/\s*(function|const|let|var|class|interface|type|export|import|if|for|while|return|throw)\b/,
      /^\s*\/\/\s*\w+\s*\(/,  // function calls
      /^\s*\/\/\s*\w+\s*=/,   // assignments
      /^\s*\/\/\s*}\s*$/,     // closing braces
      /^\s*\/\/\s*{\s*$/,     // opening braces
    ];

    // High-confidence patterns that should be flagged even as single lines
    const singleLineCodePatterns = [
      /^\s*\/\/\s*import\s+/,  // commented import
      /^\s*\/\/\s*export\s+/,  // commented export
    ];

    let consecutiveCodeComments: { start: number; lines: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isCodeComment = codePatterns.some((pattern) => pattern.test(line));
      const isSingleLineCode = singleLineCodePatterns.some((pattern) => pattern.test(line));

      // For single-line import/export comments, flag immediately
      if (isSingleLineCode) {
        let codeType = 'code';
        if (/import/.test(line)) codeType = 'import';
        else if (/export/.test(line)) codeType = 'export';

        candidates.push({
          type: 'commented_code',
          file: filePath,
          line: i + 1,
          confidence: 0.7,
          reason: `Commented-out ${codeType} statement`,
          codeSnippet: line.trim(),
        });
        continue;
      }

      if (isCodeComment) {
        if (!consecutiveCodeComments) {
          consecutiveCodeComments = { start: i + 1, lines: [line] };
        } else {
          consecutiveCodeComments.lines.push(line);
        }
      } else {
        if (
          consecutiveCodeComments &&
          consecutiveCodeComments.lines.length >= this.commentedCodeMinLines
        ) {
          // Determine what kind of code is commented
          const firstLine = consecutiveCodeComments.lines[0];
          let codeType = 'code';
          if (/function/.test(firstLine)) codeType = 'function';
          else if (/import/.test(firstLine)) codeType = 'import';
          else if (/class/.test(firstLine)) codeType = 'class';
          else if (/export/.test(firstLine)) codeType = 'export';

          candidates.push({
            type: 'commented_code',
            file: filePath,
            line: consecutiveCodeComments.start,
            confidence: 0.75,
            reason: `Commented-out ${codeType} block (${consecutiveCodeComments.lines.length} lines)`,
            codeSnippet: consecutiveCodeComments.lines.slice(0, 3).join('\n'),
          });
        }
        consecutiveCodeComments = null;
      }
    }

    // Check at end of file
    if (
      consecutiveCodeComments &&
      consecutiveCodeComments.lines.length >= this.commentedCodeMinLines
    ) {
      const firstLine = consecutiveCodeComments.lines[0];
      let codeType = 'code';
      if (/function/.test(firstLine)) codeType = 'function';
      else if (/import/.test(firstLine)) codeType = 'import';
      else if (/class/.test(firstLine)) codeType = 'class';
      else if (/export/.test(firstLine)) codeType = 'export';

      candidates.push({
        type: 'commented_code',
        file: filePath,
        line: consecutiveCodeComments.start,
        confidence: 0.75,
        reason: `Commented-out ${codeType} block (${consecutiveCodeComments.lines.length} lines)`,
        codeSnippet: consecutiveCodeComments.lines.slice(0, 3).join('\n'),
      });
    }

    return candidates;
  }

  private detectBlockCommentedCode(filePath: string, content: string): DeadCodeCandidate[] {
    const candidates: DeadCodeCandidate[] = [];

    // Match block comments
    const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
    let match;

    while ((match = blockCommentRegex.exec(content)) !== null) {
      const comment = match[0];

      // Skip JSDoc comments
      if (comment.startsWith('/**') && !comment.includes('function ') && !comment.includes('class ')) {
        continue;
      }

      // Check if the comment contains code-like patterns
      const codePatterns = [
        /\bfunction\s+\w+\s*\(/,
        /\bclass\s+\w+/,
        /\bif\s*\(/,
        /\bfor\s*\(/,
        /\bwhile\s*\(/,
        /\bconst\s+\w+\s*=/,
        /\blet\s+\w+\s*=/,
        /\breturn\s+/,
      ];

      const hasCodePattern = codePatterns.some((pattern) => pattern.test(comment));
      const lineCount = comment.split('\n').length;

      if (hasCodePattern && lineCount >= this.commentedCodeMinLines) {
        // Find line number
        const beforeComment = content.slice(0, match.index);
        const line = beforeComment.split('\n').length;

        candidates.push({
          type: 'commented_code',
          file: filePath,
          line,
          confidence: 0.8,
          reason: `Block comment contains code patterns (${lineCount} lines)`,
          codeSnippet: comment.slice(0, 150),
        });
      }
    }

    return candidates;
  }

  // ============================================================================
  // PRIVATE: UTILITIES
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

          // Skip hidden directories, node_modules, and .git
          if (
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            entry.name !== 'node_modules'
          ) {
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

  private buildReport(repoPath: string, candidates: DeadCodeCandidate[]): DeadCodeReport {
    const byType: Record<string, number> = {
      unreachable: 0,
      unused_export: 0,
      unused_variable: 0,
      unused_function: 0,
      unused_class: 0,
      commented_code: 0,
    };

    for (const candidate of candidates) {
      byType[candidate.type] = (byType[candidate.type] || 0) + 1;
    }

    const highConfidence = candidates.filter((c) => c.confidence > 0.8).length;

    return {
      repoPath,
      analyzedAt: new Date().toISOString(),
      candidates,
      summary: {
        totalCandidates: candidates.length,
        byType,
        highConfidence,
      },
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new DeadCodeDetector instance
 */
export function createDeadCodeDetector(
  options: { commentedCodeMinLines?: number } = {}
): DeadCodeDetector {
  return new DeadCodeDetector(options);
}
