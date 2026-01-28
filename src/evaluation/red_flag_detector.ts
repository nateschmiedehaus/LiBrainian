/**
 * @fileoverview Red Flag Detector
 *
 * Identifies code patterns that are commonly problematic or confusing
 * for code understanding systems:
 * - Naming confusion (similar names, misleading names, shadowed variables)
 * - Complexity (many parameters, deep nesting, long functions)
 * - Inconsistency (mixed naming conventions, inconsistent exports)
 * - Deprecated (@deprecated annotations, old TODOs)
 * - Security (hardcoded credentials, SQL injection, unsafe eval)
 * - Magic values (unexplained constants)
 *
 * This is a Tier-1 feature (pure static analysis, no LLM).
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
 * Types of red flags that can be detected
 */
export type RedFlagType =
  | 'naming_confusion'
  | 'complexity'
  | 'inconsistency'
  | 'deprecated'
  | 'security'
  | 'magic';

/**
 * Severity levels for red flags
 */
export type RedFlagSeverity = 'high' | 'medium' | 'low';

/**
 * A single red flag detected in code
 */
export interface RedFlag {
  /** The type of red flag */
  type: RedFlagType;
  /** Severity level */
  severity: RedFlagSeverity;
  /** The file path where this was detected */
  file: string;
  /** The line number (1-based) */
  line: number;
  /** Human-readable description of the issue */
  description: string;
  /** The identifier name (if applicable) */
  identifier?: string;
  /** Suggested fix or improvement */
  recommendation?: string;
}

/**
 * Summary statistics for a red flag report
 */
export interface RedFlagSummary {
  /** Total number of flags found */
  totalFlags: number;
  /** Count by type */
  byType: Record<string, number>;
  /** Count by severity */
  bySeverity: Record<string, number>;
  /** Overall risk score from 0.0 to 1.0 */
  riskScore: number;
}

/**
 * Full red flag detection report
 */
export interface RedFlagReport {
  /** The repository path analyzed */
  repoPath: string;
  /** ISO timestamp of analysis */
  analyzedAt: string;
  /** All red flags found */
  flags: RedFlag[];
  /** Summary statistics */
  summary: RedFlagSummary;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Common acceptable numeric values that should not be flagged */
const ACCEPTABLE_NUMBERS = new Set([
  0, 1, -1, 2, 10, 100, 1000,
  // HTTP status codes
  200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 500, 502, 503,
  // Common percentages
  50, 25, 75,
  // Time constants
  24, 60, 365, 1440,
]);

/** Patterns indicating hardcoded credentials */
const CREDENTIAL_PATTERNS = [
  /password\s*[:=]\s*['"`][^'"`]+['"`]/i,
  /api[_-]?key\s*[:=]\s*['"`][a-zA-Z0-9_-]{10,}['"`]/i,
  /secret\s*[:=]\s*['"`][^'"`]+['"`]/i,
  /token\s*[:=]\s*['"`][a-zA-Z0-9_-]{10,}['"`]/i,
  /auth[_-]?token\s*[:=]\s*['"`][^'"`]+['"`]/i,
  /private[_-]?key\s*[:=]\s*['"`][^'"`]+['"`]/i,
  /credentials?\s*[:=]\s*['"`][^'"`]+['"`]/i,
];

/** Deprecated API patterns */
const DEPRECATED_API_PATTERNS = [
  { pattern: /document\.write\s*\(/, name: 'document.write' },
  { pattern: /arguments\.callee/, name: 'arguments.callee' },
  { pattern: /arguments\.caller/, name: 'arguments.caller' },
  { pattern: /with\s*\(/, name: 'with statement' },
];

/** Security-sensitive function calls */
const UNSAFE_FUNCTIONS = new Set(['eval', 'Function', 'setTimeout', 'setInterval']);

// ============================================================================
// RED FLAG DETECTOR CLASS
// ============================================================================

/**
 * Detects red flag patterns in TypeScript/JavaScript codebases
 */
export class RedFlagDetector {
  private project: Project;
  private maxParams: number;
  private maxNesting: number;
  private maxFunctionLines: number;
  private oldTodoYearsThreshold: number;

  constructor(
    options: {
      maxParams?: number;
      maxNesting?: number;
      maxFunctionLines?: number;
      oldTodoYearsThreshold?: number;
    } = {}
  ) {
    this.maxParams = options.maxParams ?? 5;
    this.maxNesting = options.maxNesting ?? 4;
    this.maxFunctionLines = options.maxFunctionLines ?? 100;
    this.oldTodoYearsThreshold = options.oldTodoYearsThreshold ?? 2;

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
   * Detect all red flags in a repository
   */
  async detect(repoPath: string): Promise<RedFlagReport> {
    const flags: RedFlag[] = [];

    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
      return this.buildReport(repoPath, flags, 0);
    }

    const files = this.getTypeScriptFiles(repoPath);

    // Detect per-file issues
    for (const file of files) {
      flags.push(...(await this.detectComplexity(file)));
      flags.push(...(await this.detectDeprecated(file)));
      flags.push(...(await this.detectSecurityFlags(file)));
      flags.push(...(await this.detectMagicValues(file)));
    }

    // Detect repo-wide issues
    flags.push(...(await this.detectNamingConfusion(repoPath)));
    flags.push(...(await this.detectInconsistencies(repoPath)));

    return this.buildReport(repoPath, flags, files.length);
  }

  /**
   * Detect naming confusion patterns
   */
  async detectNamingConfusion(repoPath: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    try {
      if (!fs.existsSync(repoPath)) {
        return flags;
      }

      const isDirectory = fs.statSync(repoPath).isDirectory();
      const files = isDirectory ? this.getTypeScriptFiles(repoPath) : [repoPath];

      // Collect all identifiers per file
      for (const filePath of files) {
        const sourceFile = this.getOrAddSourceFile(filePath);
        if (!sourceFile) continue;

        // Check for similar names in the same file
        flags.push(...this.detectSimilarNames(sourceFile));

        // Check for misleading function names
        flags.push(...this.detectMisleadingNames(sourceFile));

        // Check for shadowed variables
        flags.push(...this.detectShadowedVariables(sourceFile));
      }
    } catch {
      // Gracefully handle errors
    }

    return flags;
  }

  /**
   * Detect complexity issues in a single file
   */
  async detectComplexity(filePath: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return flags;
      }

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return flags;
      }

      // Check function parameter count
      flags.push(...this.detectTooManyParameters(sourceFile));

      // Check nesting depth
      flags.push(...this.detectDeepNesting(sourceFile));

      // Check function length
      flags.push(...this.detectLongFunctions(sourceFile));

      // Check cyclomatic complexity
      flags.push(...this.detectHighComplexity(sourceFile));
    } catch {
      // Gracefully handle parse errors
    }

    return flags;
  }

  /**
   * Detect inconsistency patterns
   */
  async detectInconsistencies(repoPath: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    try {
      if (!fs.existsSync(repoPath)) {
        return flags;
      }

      const isDirectory = fs.statSync(repoPath).isDirectory();
      const files = isDirectory ? this.getTypeScriptFiles(repoPath) : [repoPath];

      // Track naming conventions across files
      const namingConventions: { camelCase: number; snake_case: number; files: Set<string> } = {
        camelCase: 0,
        snake_case: 0,
        files: new Set(),
      };

      // Track export patterns
      const exportPatterns: { named: string[]; default: string[]; mixed: string[] } = {
        named: [],
        default: [],
        mixed: [],
      };

      for (const filePath of files) {
        const sourceFile = this.getOrAddSourceFile(filePath);
        if (!sourceFile) continue;

        // Analyze naming conventions
        this.analyzeNamingConventions(sourceFile, namingConventions);

        // Analyze export patterns
        this.analyzeExportPatterns(sourceFile, exportPatterns);

        // Check for type vs any mixing
        flags.push(...this.detectAnyMixing(sourceFile));
      }

      // Flag mixed naming conventions
      if (namingConventions.camelCase > 0 && namingConventions.snake_case > 0) {
        const ratio = Math.min(namingConventions.camelCase, namingConventions.snake_case) /
          Math.max(namingConventions.camelCase, namingConventions.snake_case);

        if (ratio > 0.1) {
          // Significant mixing
          flags.push({
            type: 'inconsistency',
            severity: 'medium',
            file: repoPath,
            line: 1,
            description: `Mixed naming conventions: ${namingConventions.camelCase} camelCase, ${namingConventions.snake_case} snake_case identifiers`,
            recommendation: 'Standardize on one naming convention (camelCase is standard for TypeScript)',
          });
        }
      }

      // Flag inconsistent export patterns
      if (exportPatterns.named.length > 0 && exportPatterns.default.length > 0) {
        if (exportPatterns.mixed.length > 0) {
          for (const file of exportPatterns.mixed) {
            flags.push({
              type: 'inconsistency',
              severity: 'low',
              file,
              line: 1,
              description: 'File uses both named and default exports',
              recommendation: 'Prefer consistent export style (named exports are generally recommended)',
            });
          }
        }
      }
    } catch {
      // Gracefully handle errors
    }

    return flags;
  }

  /**
   * Detect deprecated patterns
   */
  async detectDeprecated(filePath: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return flags;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = this.getOrAddSourceFile(filePath);

      // Check for @deprecated JSDoc
      if (sourceFile) {
        flags.push(...this.detectDeprecatedAnnotations(sourceFile));
      }

      // Check for old TODO/FIXME comments
      flags.push(...this.detectOldTodos(filePath, content));

      // Check for deprecated API usage
      flags.push(...this.detectDeprecatedAPIs(filePath, content));
    } catch {
      // Gracefully handle errors
    }

    return flags;
  }

  /**
   * Detect security-related flags
   */
  async detectSecurityFlags(filePath: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return flags;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = this.getOrAddSourceFile(filePath);

      // Check for hardcoded credentials
      flags.push(...this.detectHardcodedCredentials(filePath, content));

      // Check for SQL injection patterns
      flags.push(...this.detectSQLInjection(filePath, content));

      // Check for unsafe eval/exec usage
      if (sourceFile) {
        flags.push(...this.detectUnsafeEval(sourceFile));
      }

      // Check for path traversal
      flags.push(...this.detectPathTraversal(filePath, content));
    } catch {
      // Gracefully handle errors
    }

    return flags;
  }

  /**
   * Detect magic values
   */
  async detectMagicValues(filePath: string): Promise<RedFlag[]> {
    const flags: RedFlag[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        return flags;
      }

      const sourceFile = this.getOrAddSourceFile(filePath);
      if (!sourceFile) {
        return flags;
      }

      // Check for magic numbers
      flags.push(...this.detectMagicNumbers(sourceFile));

      // Check for magic strings
      flags.push(...this.detectMagicStrings(sourceFile));

      // Check for unexplained bit operations
      flags.push(...this.detectMagicBitOps(sourceFile));
    } catch {
      // Gracefully handle errors
    }

    return flags;
  }

  // ============================================================================
  // PRIVATE: NAMING CONFUSION DETECTION
  // ============================================================================

  private detectSimilarNames(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    // Collect all identifiers with their locations
    const identifiers: Array<{ name: string; line: number; kind: string }> = [];

    // Functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (name) {
        identifiers.push({ name, line: func.getStartLineNumber(), kind: 'function' });
      }
    }

    // Variables
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        identifiers.push({
          name: decl.getName(),
          line: varStmt.getStartLineNumber(),
          kind: 'variable',
        });
      }
    }

    // Check for similar names
    for (let i = 0; i < identifiers.length; i++) {
      for (let j = i + 1; j < identifiers.length; j++) {
        const a = identifiers[i];
        const b = identifiers[j];

        // Check if names are similar (e.g., getData, data, _data)
        const similarity = this.calculateNameSimilarity(a.name, b.name);

        if (similarity > 0.7 && similarity < 1.0) {
          flags.push({
            type: 'naming_confusion',
            severity: similarity > 0.85 ? 'medium' : 'low',
            file: filePath,
            line: Math.min(a.line, b.line),
            description: `Similar names may cause confusion: '${a.name}' and '${b.name}'`,
            identifier: `${a.name}, ${b.name}`,
            recommendation: 'Use more distinct names or consolidate if they represent the same concept',
          });
        }
      }
    }

    return flags;
  }

  private detectMisleadingNames(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    // Check for functions with "is", "has", "can" prefixes that mutate state
    const predicatePrefixes = ['is', 'has', 'can', 'should', 'will'];

    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      const startsWithPredicate = predicatePrefixes.some(
        (prefix) => name.startsWith(prefix) && name[prefix.length]?.toUpperCase() === name[prefix.length]
      );

      if (startsWithPredicate) {
        const body = func.getBody();
        if (body && this.containsMutation(body)) {
          flags.push({
            type: 'naming_confusion',
            severity: 'medium',
            file: filePath,
            line: func.getStartLineNumber(),
            description: `Function '${name}' appears to be a predicate but contains mutations (misleading name)`,
            identifier: name,
            recommendation: 'Predicate functions (is*, has*, can*) should be pure and not mutate state',
          });
        }
      }
    }

    return flags;
  }

  private detectShadowedVariables(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    // Track variable declarations by scope
    const scopeVariables = new Map<Node, Set<string>>();

    // Collect top-level variables
    const topLevelVars = new Set<string>();
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        topLevelVars.add(decl.getName());
      }
    }

    // Check for shadowing in nested scopes
    sourceFile.forEachDescendant((node) => {
      if (Node.isBlock(node) || Node.isFunctionDeclaration(node) || Node.isArrowFunction(node)) {
        const localVars = new Set<string>();

        node.forEachDescendant((child) => {
          if (Node.isVariableDeclaration(child)) {
            const name = child.getName();

            // Check if this shadows a top-level variable
            if (topLevelVars.has(name)) {
              flags.push({
                type: 'naming_confusion',
                severity: 'medium',
                file: filePath,
                line: child.getStartLineNumber(),
                description: `Variable '${name}' shadows an outer-scope variable`,
                identifier: name,
                recommendation: 'Use a different name to avoid confusion with the outer variable',
              });
            }

            localVars.add(name);
          }
        });

        scopeVariables.set(node, localVars);
      }
    });

    return flags;
  }

  private calculateNameSimilarity(a: string, b: string): number {
    // Normalize: remove underscores, convert to lowercase
    const normalizeForComparison = (s: string) =>
      s.replace(/^_+|_+$/g, '').replace(/_/g, '').toLowerCase();

    const normA = normalizeForComparison(a);
    const normB = normalizeForComparison(b);

    // If one is a prefix/suffix of the other with "get", "set", etc.
    const commonPrefixes = ['get', 'set', 'is', 'has', 'on', 'handle'];
    for (const prefix of commonPrefixes) {
      if (normA === prefix + normB || normB === prefix + normA) {
        return 0.85;
      }
    }

    // Simple Levenshtein distance ratio
    const distance = this.levenshteinDistance(normA, normB);
    const maxLen = Math.max(normA.length, normB.length);
    if (maxLen === 0) return 1;

    return 1 - distance / maxLen;
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

  private containsMutation(node: Node): boolean {
    let hasMutation = false;

    node.forEachDescendant((child) => {
      // Check for assignment expressions outside of variable declarations
      if (Node.isBinaryExpression(child)) {
        const operator = child.getOperatorToken().getText();
        if (['=', '+=', '-=', '*=', '/=', '++', '--'].includes(operator)) {
          const left = child.getLeft();
          // Check if assigning to something other than a local variable declaration
          if (!Node.isVariableDeclaration(left.getParent())) {
            hasMutation = true;
          }
        }
      }

      // Check for increment/decrement
      if (Node.isPrefixUnaryExpression(child) || Node.isPostfixUnaryExpression(child)) {
        const operatorKind = child.getOperatorToken();
        if (
          operatorKind === SyntaxKind.PlusPlusToken ||
          operatorKind === SyntaxKind.MinusMinusToken
        ) {
          hasMutation = true;
        }
      }
    });

    return hasMutation;
  }

  // ============================================================================
  // PRIVATE: COMPLEXITY DETECTION
  // ============================================================================

  private detectTooManyParameters(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    const checkParams = (name: string, params: number, line: number) => {
      if (params > this.maxParams) {
        flags.push({
          type: 'complexity',
          severity: params > this.maxParams + 2 ? 'high' : 'medium',
          file: filePath,
          line,
          description: `Function '${name}' has ${params} parameters (max recommended: ${this.maxParams})`,
          identifier: name,
          recommendation: 'Consider using an options object or splitting the function',
        });
      }
    };

    // Check regular functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName() || 'anonymous';
      checkParams(name, func.getParameters().length, func.getStartLineNumber());
    }

    // Check methods
    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const name = `${cls.getName()}.${method.getName()}`;
        checkParams(name, method.getParameters().length, method.getStartLineNumber());
      }
    }

    // Check arrow functions
    sourceFile.forEachDescendant((node) => {
      if (Node.isArrowFunction(node)) {
        const params = node.getParameters().length;
        if (params > this.maxParams) {
          flags.push({
            type: 'complexity',
            severity: params > this.maxParams + 2 ? 'high' : 'medium',
            file: filePath,
            line: node.getStartLineNumber(),
            description: `Arrow function has ${params} parameters (max recommended: ${this.maxParams})`,
            recommendation: 'Consider using an options object or splitting the function',
          });
        }
      }
    });

    return flags;
  }

  private detectDeepNesting(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    const checkNesting = (node: Node, depth: number = 0) => {
      if (depth > this.maxNesting) {
        flags.push({
          type: 'complexity',
          severity: depth > this.maxNesting + 2 ? 'high' : 'medium',
          file: filePath,
          line: node.getStartLineNumber(),
          description: `Code has ${depth} levels of nesting (max recommended: ${this.maxNesting})`,
          recommendation: 'Extract nested logic into separate functions or use early returns',
        });
        return; // Don't keep flagging deeper levels
      }

      node.forEachChild((child) => {
        if (
          Node.isIfStatement(child) ||
          Node.isForStatement(child) ||
          Node.isForOfStatement(child) ||
          Node.isForInStatement(child) ||
          Node.isWhileStatement(child) ||
          Node.isDoStatement(child) ||
          Node.isTryStatement(child) ||
          Node.isSwitchStatement(child)
        ) {
          checkNesting(child, depth + 1);
        } else {
          checkNesting(child, depth);
        }
      });
    };

    // Start checking from functions
    for (const func of sourceFile.getFunctions()) {
      const body = func.getBody();
      if (body) checkNesting(body);
    }

    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const body = method.getBody();
        if (body) checkNesting(body);
      }
    }

    return flags;
  }

  private detectLongFunctions(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    const checkLength = (name: string, startLine: number, endLine: number) => {
      const lines = endLine - startLine;
      if (lines > this.maxFunctionLines) {
        flags.push({
          type: 'complexity',
          severity: lines > this.maxFunctionLines * 1.5 ? 'high' : 'medium',
          file: filePath,
          line: startLine,
          description: `Function '${name}' is ${lines} lines long (max recommended: ${this.maxFunctionLines})`,
          identifier: name,
          recommendation: 'Break the function into smaller, focused functions',
        });
      }
    };

    for (const func of sourceFile.getFunctions()) {
      const name = func.getName() || 'anonymous';
      checkLength(name, func.getStartLineNumber(), func.getEndLineNumber());
    }

    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const name = `${cls.getName()}.${method.getName()}`;
        checkLength(name, method.getStartLineNumber(), method.getEndLineNumber());
      }
    }

    return flags;
  }

  private detectHighComplexity(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    const countComplexity = (node: Node): number => {
      let complexity = 1; // Base complexity

      node.forEachDescendant((child) => {
        if (
          Node.isIfStatement(child) ||
          Node.isConditionalExpression(child) ||
          Node.isForStatement(child) ||
          Node.isForOfStatement(child) ||
          Node.isForInStatement(child) ||
          Node.isWhileStatement(child) ||
          Node.isDoStatement(child) ||
          Node.isCatchClause(child)
        ) {
          complexity++;
        }

        // Switch cases add complexity
        if (Node.isCaseClause(child)) {
          complexity++;
        }

        // Logical operators add complexity
        if (Node.isBinaryExpression(child)) {
          const op = child.getOperatorToken().getText();
          if (op === '&&' || op === '||' || op === '??') {
            complexity++;
          }
        }
      });

      return complexity;
    };

    const maxComplexity = 15;

    for (const func of sourceFile.getFunctions()) {
      const body = func.getBody();
      if (!body) continue;

      const complexity = countComplexity(body);
      if (complexity > maxComplexity) {
        flags.push({
          type: 'complexity',
          severity: complexity > maxComplexity * 1.5 ? 'high' : 'medium',
          file: filePath,
          line: func.getStartLineNumber(),
          description: `Function '${func.getName() || 'anonymous'}' has cyclomatic complexity of ${complexity} (max recommended: ${maxComplexity})`,
          identifier: func.getName(),
          recommendation: 'Simplify the function by extracting logic or using polymorphism',
        });
      }
    }

    return flags;
  }

  // ============================================================================
  // PRIVATE: INCONSISTENCY DETECTION
  // ============================================================================

  private analyzeNamingConventions(
    sourceFile: SourceFile,
    stats: { camelCase: number; snake_case: number; files: Set<string> }
  ): void {
    const filePath = sourceFile.getFilePath();

    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (name) {
        if (name.includes('_') && !name.startsWith('_')) {
          stats.snake_case++;
          stats.files.add(filePath);
        } else if (/^[a-z]/.test(name) && !name.includes('_')) {
          stats.camelCase++;
        }
      }
    }

    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();
        // Skip SCREAMING_SNAKE_CASE constants
        if (name === name.toUpperCase()) continue;

        if (name.includes('_') && !name.startsWith('_')) {
          stats.snake_case++;
          stats.files.add(filePath);
        } else if (/^[a-z]/.test(name) && !name.includes('_')) {
          stats.camelCase++;
        }
      }
    }
  }

  private analyzeExportPatterns(
    sourceFile: SourceFile,
    stats: { named: string[]; default: string[]; mixed: string[] }
  ): void {
    const filePath = sourceFile.getFilePath();
    let hasNamed = false;
    let hasDefault = false;

    // Check for named exports
    for (const func of sourceFile.getFunctions()) {
      if (func.isExported() && !func.isDefaultExport()) {
        hasNamed = true;
      }
      if (func.isDefaultExport()) {
        hasDefault = true;
      }
    }

    for (const cls of sourceFile.getClasses()) {
      if (cls.isExported() && !cls.isDefaultExport()) {
        hasNamed = true;
      }
      if (cls.isDefaultExport()) {
        hasDefault = true;
      }
    }

    for (const varStmt of sourceFile.getVariableStatements()) {
      if (varStmt.isExported()) {
        hasNamed = true;
      }
    }

    // Check for export default
    for (const exportAssign of sourceFile.getExportAssignments()) {
      if (!exportAssign.isExportEquals()) {
        hasDefault = true;
      }
    }

    if (hasNamed && !hasDefault) {
      stats.named.push(filePath);
    } else if (hasDefault && !hasNamed) {
      stats.default.push(filePath);
    } else if (hasNamed && hasDefault) {
      stats.mixed.push(filePath);
    }
  }

  private detectAnyMixing(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    let typedCount = 0;
    let anyCount = 0;

    sourceFile.forEachDescendant((node) => {
      if (Node.isTypeReference(node)) {
        typedCount++;
      }

      // Check for 'any' type
      if (node.getKind() === SyntaxKind.AnyKeyword) {
        anyCount++;

        // Get parent to understand context
        const parent = node.getParent();
        if (parent) {
          flags.push({
            type: 'inconsistency',
            severity: 'low',
            file: filePath,
            line: node.getStartLineNumber(),
            description: 'Usage of "any" type reduces type safety',
            recommendation: 'Use a more specific type or "unknown" for truly unknown values',
          });
        }
      }
    });

    return flags;
  }

  // ============================================================================
  // PRIVATE: DEPRECATED DETECTION
  // ============================================================================

  private detectDeprecatedAnnotations(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    const checkJsDoc = (node: Node, name: string) => {
      const jsDocTags = node.getChildrenOfKind(SyntaxKind.JSDoc);
      for (const jsDoc of jsDocTags) {
        const text = jsDoc.getText();
        if (text.includes('@deprecated')) {
          flags.push({
            type: 'deprecated',
            severity: 'medium',
            file: filePath,
            line: node.getStartLineNumber(),
            identifier: name,
            description: `'${name}' is marked as deprecated`,
            recommendation: 'Check the deprecation notice and update to the recommended alternative',
          });
        }
      }
    };

    // Also check comment above the node
    const checkComments = (node: Node, name: string) => {
      const leadingComments = node.getLeadingCommentRanges();
      for (const comment of leadingComments) {
        const text = comment.getText();
        if (text.includes('@deprecated')) {
          flags.push({
            type: 'deprecated',
            severity: 'medium',
            file: filePath,
            line: node.getStartLineNumber(),
            identifier: name,
            description: `'${name}' is marked as deprecated`,
            recommendation: 'Check the deprecation notice and update to the recommended alternative',
          });
        }
      }
    };

    for (const func of sourceFile.getFunctions()) {
      const name = func.getName() || 'anonymous';
      checkJsDoc(func, name);
      checkComments(func, name);
    }

    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() || 'anonymous';
      checkJsDoc(cls, name);
      checkComments(cls, name);
    }

    return flags;
  }

  private detectOldTodos(filePath: string, content: string): RedFlag[] {
    const flags: RedFlag[] = [];
    const lines = content.split('\n');

    // Pattern to match TODO/FIXME with dates
    const todoPattern = /(?:TODO|FIXME)[^\n]*(\d{4})[^\n]*(\d{1,2})[^\n]*(\d{1,2})/i;
    const currentYear = new Date().getFullYear();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = todoPattern.exec(line);

      if (match) {
        const year = parseInt(match[1], 10);
        if (currentYear - year >= this.oldTodoYearsThreshold) {
          flags.push({
            type: 'deprecated',
            severity: 'low',
            file: filePath,
            line: i + 1,
            description: `Old TODO/FIXME comment from ${year} (${currentYear - year} years old)`,
            recommendation: 'Address this issue or remove the outdated comment',
          });
        }
      }
    }

    return flags;
  }

  private detectDeprecatedAPIs(filePath: string, content: string): RedFlag[] {
    const flags: RedFlag[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const { pattern, name } of DEPRECATED_API_PATTERNS) {
        if (pattern.test(line)) {
          flags.push({
            type: 'deprecated',
            severity: 'medium',
            file: filePath,
            line: i + 1,
            description: `Usage of deprecated API: ${name}`,
            recommendation: `Avoid using ${name} - it's deprecated and may be removed`,
          });
        }
      }

      // Check for deprecated module imports
      if (/import\s+.*\s+from\s+['"]domain['"]/.test(line)) {
        flags.push({
          type: 'deprecated',
          severity: 'medium',
          file: filePath,
          line: i + 1,
          description: 'Import of deprecated Node.js "domain" module',
          recommendation: 'Use async_hooks or other error handling patterns instead',
        });
      }
    }

    return flags;
  }

  // ============================================================================
  // PRIVATE: SECURITY DETECTION
  // ============================================================================

  private detectHardcodedCredentials(filePath: string, content: string): RedFlag[] {
    const flags: RedFlag[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
        continue;
      }

      for (const pattern of CREDENTIAL_PATTERNS) {
        if (pattern.test(line)) {
          // Extract the variable name
          const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
          const identifier = varMatch?.[1];

          flags.push({
            type: 'security',
            severity: 'high',
            file: filePath,
            line: i + 1,
            description: 'Potential hardcoded credential or API key detected',
            identifier,
            recommendation: 'Use environment variables or a secrets manager instead',
          });
          break; // Only one flag per line
        }
      }
    }

    return flags;
  }

  private detectSQLInjection(filePath: string, content: string): RedFlag[] {
    const flags: RedFlag[] = [];
    const lines = content.split('\n');

    // Pattern for string concatenation in SQL-like contexts
    const sqlPattern = /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\$\{/i;
    const sqlConcatPattern = /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\+\s*\w+/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (sqlPattern.test(line) || sqlConcatPattern.test(line)) {
        flags.push({
          type: 'security',
          severity: 'high',
          file: filePath,
          line: i + 1,
          description: 'Potential SQL injection vulnerability - string interpolation in SQL query',
          recommendation: 'Use parameterized queries or prepared statements instead',
        });
      }
    }

    return flags;
  }

  private detectUnsafeEval(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        let funcName = '';

        if (Node.isIdentifier(expr)) {
          funcName = expr.getText();
        } else if (Node.isPropertyAccessExpression(expr)) {
          funcName = expr.getName();
        }

        if (UNSAFE_FUNCTIONS.has(funcName)) {
          // Check if it's eval or Function constructor
          if (funcName === 'eval' || funcName === 'Function') {
            flags.push({
              type: 'security',
              severity: 'high',
              file: filePath,
              line: node.getStartLineNumber(),
              description: `Unsafe use of ${funcName}() - can execute arbitrary code`,
              recommendation: 'Avoid eval/Function; use safer alternatives like JSON.parse for data',
            });
          }
        }
      }

      // Check for new Function(...)
      if (Node.isNewExpression(node)) {
        const expr = node.getExpression();
        if (Node.isIdentifier(expr) && expr.getText() === 'Function') {
          flags.push({
            type: 'security',
            severity: 'high',
            file: filePath,
            line: node.getStartLineNumber(),
            description: 'Unsafe use of new Function() - can execute arbitrary code',
            recommendation: 'Avoid Function constructor; use safer alternatives',
          });
        }
      }
    });

    // Check for child_process exec with variable input
    const content = sourceFile.getFullText();
    if (/exec\s*\(\s*[`'"]?\$?\{?\w/.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/exec\s*\(\s*[`'"]?\$?\{?\w/.test(lines[i]) && !/exec\s*\(\s*['"][^$]*['"]/.test(lines[i])) {
          flags.push({
            type: 'security',
            severity: 'high',
            file: filePath,
            line: i + 1,
            description: 'Potential command injection - exec() with variable input',
            recommendation: 'Validate and sanitize input, or use execFile with explicit arguments',
          });
        }
      }
    }

    return flags;
  }

  private detectPathTraversal(filePath: string, content: string): RedFlag[] {
    const flags: RedFlag[] = [];
    const lines = content.split('\n');

    // Pattern for path concatenation without sanitization
    const pathConcatPattern = /(?:readFileSync|readFile|writeFileSync|writeFile|access)\s*\(\s*['"`]?[^)]*\+\s*\w+/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (pathConcatPattern.test(line)) {
        flags.push({
          type: 'security',
          severity: 'medium',
          file: filePath,
          line: i + 1,
          description: 'Potential path traversal vulnerability - string concatenation in file path',
          recommendation: 'Use path.basename() or path.join() with validation',
        });
      }
    }

    return flags;
  }

  // ============================================================================
  // PRIVATE: MAGIC VALUES DETECTION
  // ============================================================================

  private detectMagicNumbers(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (Node.isNumericLiteral(node)) {
        const value = parseFloat(node.getText());

        // Skip acceptable values
        if (ACCEPTABLE_NUMBERS.has(value)) {
          return;
        }

        // Check context - is it in a const declaration at module level?
        const parent = node.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          const name = parent.getName();
          // SCREAMING_CASE suggests it's a named constant
          if (name === name.toUpperCase() && name.includes('_')) {
            return;
          }
        }

        // Check if it's in a comparison or calculation without context
        if (
          parent &&
          (Node.isBinaryExpression(parent) ||
            Node.isCallExpression(parent?.getParent() ?? parent))
        ) {
          const severity: RedFlagSeverity =
            !Number.isInteger(value) || Math.abs(value) > 100 ? 'medium' : 'low';

          flags.push({
            type: 'magic',
            severity,
            file: filePath,
            line: node.getStartLineNumber(),
            description: `Magic number ${value} - consider using a named constant`,
            recommendation: 'Extract to a named constant that explains its purpose',
          });
        }
      }
    });

    return flags;
  }

  private detectMagicStrings(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    // Common strings that are acceptable
    const acceptableStrings = new Set([
      '', ' ', '\n', '\t', '/', '.', ',', ':', ';', '-', '_',
      'utf-8', 'utf8', 'ascii', 'base64', 'hex',
      'GET', 'POST', 'PUT', 'DELETE', 'PATCH',
      'true', 'false', 'null', 'undefined',
    ]);

    sourceFile.forEachDescendant((node) => {
      if (Node.isStringLiteral(node)) {
        const value = node.getLiteralText();

        // Skip acceptable strings
        if (acceptableStrings.has(value) || value.length <= 2) {
          return;
        }

        // Skip if it's a const declaration
        const parent = node.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          return;
        }

        // Skip enum values
        if (parent && Node.isEnumMember(parent)) {
          return;
        }

        // Skip import/export paths
        if (parent && (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent))) {
          return;
        }

        // Check if it looks like a "magic" string (random-looking)
        if (/^[A-Za-z]{4,}$/.test(value) && !/^(error|warning|info|debug|message|default|loading|success)$/i.test(value)) {
          flags.push({
            type: 'magic',
            severity: 'low',
            file: filePath,
            line: node.getStartLineNumber(),
            description: `Magic string literal "${value.slice(0, 20)}${value.length > 20 ? '...' : ''}" - consider using a named constant`,
            recommendation: 'Extract to a named constant or enum',
          });
        }
      }
    });

    return flags;
  }

  private detectMagicBitOps(sourceFile: SourceFile): RedFlag[] {
    const flags: RedFlag[] = [];
    const filePath = sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (Node.isBinaryExpression(node)) {
        const operator = node.getOperatorToken().getText();

        if (['&', '|', '^', '<<', '>>', '>>>'].includes(operator)) {
          // Check if operands are magic numbers
          const right = node.getRight();
          if (Node.isNumericLiteral(right)) {
            const value = parseInt(right.getText(), 10);

            // Skip powers of 2 and common bit masks
            if (value > 0 && (value & (value - 1)) === 0) {
              // Power of 2, might be intentional
              return;
            }

            if (!ACCEPTABLE_NUMBERS.has(value)) {
              flags.push({
                type: 'magic',
                severity: 'medium',
                file: filePath,
                line: node.getStartLineNumber(),
                description: `Bit operation with magic number ${value} - consider using a named constant`,
                recommendation: 'Use named constants (e.g., FLAG_READ = 0b100) for bit masks',
              });
            }
          }
        }
      }
    });

    return flags;
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

  private buildReport(repoPath: string, flags: RedFlag[], totalFiles: number): RedFlagReport {
    const byType: Record<string, number> = {
      naming_confusion: 0,
      complexity: 0,
      inconsistency: 0,
      deprecated: 0,
      security: 0,
      magic: 0,
    };

    const bySeverity: Record<string, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const flag of flags) {
      byType[flag.type] = (byType[flag.type] || 0) + 1;
      bySeverity[flag.severity] = (bySeverity[flag.severity] || 0) + 1;
    }

    // Risk score calculation: (high*3 + medium*2 + low*1) / (totalFiles * 10)
    const rawScore =
      (bySeverity.high * 3 + bySeverity.medium * 2 + bySeverity.low) /
      Math.max(totalFiles * 10, 1);
    const riskScore = Math.min(Math.max(rawScore, 0), 1);

    return {
      repoPath,
      analyzedAt: new Date().toISOString(),
      flags,
      summary: {
        totalFlags: flags.length,
        byType,
        bySeverity,
        riskScore,
      },
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new RedFlagDetector instance
 */
export function createRedFlagDetector(
  options: {
    maxParams?: number;
    maxNesting?: number;
    maxFunctionLines?: number;
    oldTodoYearsThreshold?: number;
  } = {}
): RedFlagDetector {
  return new RedFlagDetector(options);
}
