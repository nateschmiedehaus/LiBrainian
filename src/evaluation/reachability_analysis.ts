/**
 * @fileoverview Reachability Analysis for Dead Code Detection
 *
 * Builds a call graph and performs reachability analysis to identify dead code.
 * Uses static analysis to trace function calls from entry points (exports, main functions).
 *
 * Key features:
 * - Call graph construction from TypeScript/JavaScript files
 * - Entry point identification (exports, main functions, event handlers)
 * - Graph traversal for reachability analysis
 * - Dead code detection with confidence scoring
 * - False positive rate target: < 5%
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
 * A code element in the call graph (function, class, method, variable, export)
 */
export interface CodeElement {
  /** Unique identifier for this element */
  id: string;
  /** Type of code element */
  type: 'function' | 'class' | 'method' | 'variable' | 'export';
  /** Name of the element */
  name: string;
  /** Absolute file path */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Whether this element is exported */
  isExported?: boolean;
}

/**
 * An edge in the call graph representing a call from one element to another
 */
export interface CallGraphEdge {
  /** ID of the calling element */
  caller: string;
  /** ID of the called element */
  callee: string;
  /** Location of the call site */
  callSite: { file: string; line: number };
}

/**
 * The complete call graph for a codebase
 */
export interface CallGraph {
  /** Map of element IDs to code elements */
  nodes: Map<string, CodeElement>;
  /** List of call edges */
  edges: CallGraphEdge[];
  /** IDs of entry points (exports, main, etc.) */
  entryPoints: string[];
}

/**
 * Result of reachability analysis
 */
export interface ReachabilityResult {
  /** Set of reachable element IDs */
  reachable: Set<string>;
  /** Set of unreachable element IDs */
  unreachable: Set<string>;
  /** List of dead code elements */
  deadCode: CodeElement[];
  /** Confidence score (0-1) based on analysis completeness */
  confidence: number;
}

/**
 * Report of dead code in a file
 */
export interface DeadCodeReport {
  /** Path to the file */
  filePath: string;
  /** List of dead code elements in this file */
  deadElements: CodeElement[];
  /** Reasons why these might be false positives */
  potentialFalsePositives: string[];
  /** Suggested action: 'remove', 'review', or 'keep' */
  suggestedAction: 'remove' | 'review' | 'keep';
}

// ============================================================================
// REACHABILITY ANALYZER CLASS
// ============================================================================

/**
 * Analyzes code reachability to detect dead code
 */
export class ReachabilityAnalyzer {
  private project: Project;
  private nodeCounter: number = 0;

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
   * Build a call graph from all TypeScript/JavaScript files in a directory
   */
  async buildCallGraph(rootDir: string): Promise<CallGraph> {
    const graph: CallGraph = {
      nodes: new Map(),
      edges: [],
      entryPoints: [],
    };

    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
      return graph;
    }

    const files = this.getTypeScriptFiles(rootDir);

    // First pass: collect all function/class/method definitions
    const symbolMap = new Map<string, string>(); // symbol name -> node ID
    const sourceFiles = new Map<string, SourceFile>();

    for (const file of files) {
      try {
        const sourceFile = this.getOrAddSourceFile(file);
        if (!sourceFile) continue;

        sourceFiles.set(file, sourceFile);
        this.collectNodes(sourceFile, graph, symbolMap);
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Second pass: collect call edges (reuse the same sourceFile objects)
    for (const [file, sourceFile] of sourceFiles) {
      try {
        this.collectEdges(sourceFile, graph, symbolMap);
      } catch {
        // Skip files that can't be parsed
      }
    }

    // Identify entry points
    graph.entryPoints = this.findEntryPoints(graph);

    return graph;
  }

  /**
   * Analyze reachability from entry points
   */
  analyzeReachability(graph: CallGraph): ReachabilityResult {
    const reachable = new Set<string>();
    const visited = new Set<string>();

    // Build adjacency list for faster traversal
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.caller)) {
        adjacency.set(edge.caller, []);
      }
      adjacency.get(edge.caller)!.push(edge.callee);
    }

    // BFS/DFS from all entry points
    const queue = [...graph.entryPoints];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      reachable.add(nodeId);

      // Follow outgoing edges
      const callees = adjacency.get(nodeId) || [];
      for (const callee of callees) {
        if (!visited.has(callee)) {
          queue.push(callee);
        }
      }
    }

    // Find unreachable nodes
    const unreachable = new Set<string>();
    const deadCode: CodeElement[] = [];

    for (const [id, node] of graph.nodes) {
      if (!reachable.has(id)) {
        unreachable.add(id);
        deadCode.push(node);
      }
    }

    // Calculate confidence based on analysis completeness
    // Higher confidence if we have good entry point coverage
    const entryPointCoverage = graph.entryPoints.length / Math.max(graph.nodes.size, 1);
    const edgeCoverage = graph.edges.length / Math.max(graph.nodes.size, 1);
    const confidence = Math.min(0.95, 0.5 + entryPointCoverage * 0.3 + edgeCoverage * 0.2);

    return {
      reachable,
      unreachable,
      deadCode,
      confidence,
    };
  }

  /**
   * Find dead code and produce reports grouped by file
   */
  findDeadCode(graph: CallGraph): DeadCodeReport[] {
    const result = this.analyzeReachability(graph);
    const reportsByFile = new Map<string, DeadCodeReport>();

    for (const element of result.deadCode) {
      if (!reportsByFile.has(element.filePath)) {
        reportsByFile.set(element.filePath, {
          filePath: element.filePath,
          deadElements: [],
          potentialFalsePositives: [],
          suggestedAction: 'review',
        });
      }

      const report = reportsByFile.get(element.filePath)!;
      report.deadElements.push(element);
    }

    // Analyze each report for false positives and suggested actions
    for (const report of reportsByFile.values()) {
      this.analyzeReport(report, graph);
    }

    return Array.from(reportsByFile.values());
  }

  /**
   * Identify entry points from a list of files
   */
  async identifyEntryPoints(files: string[]): Promise<string[]> {
    const entryPoints: string[] = [];

    for (const file of files) {
      try {
        const sourceFile = this.getOrAddSourceFile(file);
        if (!sourceFile) continue;

        // Find exported functions, classes, and variables
        for (const func of sourceFile.getFunctions()) {
          if (func.isExported()) {
            const name = func.getName();
            if (name) {
              entryPoints.push(this.generateId(file, name, func.getStartLineNumber()));
            }
          }
        }

        for (const cls of sourceFile.getClasses()) {
          if (cls.isExported()) {
            const name = cls.getName();
            if (name) {
              entryPoints.push(this.generateId(file, name, cls.getStartLineNumber()));
            }
          }
        }

        for (const varStmt of sourceFile.getVariableStatements()) {
          if (varStmt.isExported()) {
            for (const decl of varStmt.getDeclarations()) {
              const name = decl.getName();
              entryPoints.push(this.generateId(file, name, varStmt.getStartLineNumber()));
            }
          }
        }
      } catch {
        // Skip files that can't be parsed
      }
    }

    return entryPoints;
  }

  /**
   * Check if a specific element is reachable from entry points
   */
  isReachable(graph: CallGraph, elementId: string): boolean {
    const result = this.analyzeReachability(graph);
    return result.reachable.has(elementId);
  }

  // ============================================================================
  // PRIVATE: NODE COLLECTION
  // ============================================================================

  private collectNodes(
    sourceFile: SourceFile,
    graph: CallGraph,
    symbolMap: Map<string, string>
  ): void {
    const filePath = sourceFile.getFilePath();

    // Collect functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (name) {
        const id = this.generateId(filePath, name, func.getStartLineNumber());
        const element: CodeElement = {
          id,
          type: 'function',
          name,
          filePath,
          line: func.getStartLineNumber(),
          isExported: func.isExported(),
        };
        graph.nodes.set(id, element);
        symbolMap.set(name, id);
      }
    }

    // Collect classes and their methods
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (className) {
        const classId = this.generateId(filePath, className, cls.getStartLineNumber());
        const classElement: CodeElement = {
          id: classId,
          type: 'class',
          name: className,
          filePath,
          line: cls.getStartLineNumber(),
          isExported: cls.isExported(),
        };
        graph.nodes.set(classId, classElement);
        symbolMap.set(className, classId);

        // Collect methods
        for (const method of cls.getMethods()) {
          const methodName = method.getName();
          const qualifiedName = `${className}.${methodName}`;
          const methodId = this.generateId(filePath, qualifiedName, method.getStartLineNumber());
          const methodElement: CodeElement = {
            id: methodId,
            type: 'method',
            name: methodName,
            filePath,
            line: method.getStartLineNumber(),
          };
          graph.nodes.set(methodId, methodElement);
          symbolMap.set(qualifiedName, methodId);
          symbolMap.set(methodName, methodId); // Also index by simple name

          // Add edge from class to its methods (methods are reachable if class is reachable)
          graph.edges.push({
            caller: classId,
            callee: methodId,
            callSite: { file: filePath, line: cls.getStartLineNumber() },
          });
        }

        // Collect constructor
        const ctor = cls.getConstructors()[0];
        if (ctor) {
          const ctorId = this.generateId(filePath, `${className}.constructor`, ctor.getStartLineNumber());
          const ctorElement: CodeElement = {
            id: ctorId,
            type: 'method',
            name: 'constructor',
            filePath,
            line: ctor.getStartLineNumber(),
          };
          graph.nodes.set(ctorId, ctorElement);

          // Constructor is reachable if class is reachable
          graph.edges.push({
            caller: classId,
            callee: ctorId,
            callSite: { file: filePath, line: cls.getStartLineNumber() },
          });
        }
      }
    }

    // Collect arrow functions and function expressions assigned to variables
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();
        const initializer = decl.getInitializer();

        if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
          const id = this.generateId(filePath, name, varStmt.getStartLineNumber());
          const element: CodeElement = {
            id,
            type: 'function',
            name,
            filePath,
            line: varStmt.getStartLineNumber(),
            isExported: varStmt.isExported(),
          };
          graph.nodes.set(id, element);
          symbolMap.set(name, id);
        }
      }
    }
  }

  private collectEdges(
    sourceFile: SourceFile,
    graph: CallGraph,
    symbolMap: Map<string, string>
  ): void {
    const filePath = sourceFile.getFilePath();

    // Build a map of local imports to their resolved symbol names
    const importMap = new Map<string, string>();
    for (const importDecl of sourceFile.getImportDeclarations()) {
      for (const namedImport of importDecl.getNamedImports()) {
        const localName = namedImport.getAliasNode()?.getText() || namedImport.getName();
        const originalName = namedImport.getName();
        importMap.set(localName, originalName);
      }
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        importMap.set(defaultImport.getText(), defaultImport.getText());
      }
    }

    // Track which function/method we're currently inside
    sourceFile.forEachDescendant((node) => {
      if (process.env.DEBUG_REACHABILITY === '2') {
        console.log(`[DEBUG] Visiting node kind=${node.getKindName()} at line ${node.getStartLineNumber()}`);
      }

      if (Node.isCallExpression(node)) {
        const callLine = node.getStartLineNumber();
        const expr = node.getExpression();

        // Get the containing function/method
        const containingFunc = this.findContainingFunction(node);
        if (!containingFunc) return;

        const containingName = this.getContainingFunctionName(containingFunc);
        // First try symbolMap lookup (most reliable for same-file functions)
        let callerId = symbolMap.get(containingName);

        // Debug - uncomment to troubleshoot
        if (process.env.DEBUG_REACHABILITY === '1') {
          console.log(`[DEBUG] Processing call at line ${callLine}, containingName=${containingName}, callerId=${callerId}`);
        }

        // Fallback to graph lookup
        if (!callerId) {
          callerId = this.getContainingFunctionId(containingFunc, filePath, graph);
        }
        if (!callerId) return;

        // Handle different call expression types
        let calleeName: string | undefined;

        if (Node.isIdentifier(expr)) {
          // Direct function call: func()
          const localName = expr.getText();
          // Resolve imported name to original
          calleeName = importMap.get(localName) || localName;
        } else if (Node.isPropertyAccessExpression(expr)) {
          // Method call: obj.method()
          const propertyName = expr.getName();
          const object = expr.getExpression();

          if (Node.isThisKeyword(object)) {
            // this.method()
            const containingClass = this.findContainingClass(node);
            if (containingClass) {
              const className = containingClass.getName();
              if (className) {
                calleeName = `${className}.${propertyName}`;
              }
            }
          } else if (Node.isIdentifier(object)) {
            // obj.method() - try to find the method
            calleeName = propertyName;
          }
        }

        if (calleeName) {
          const calleeId = symbolMap.get(calleeName);
          if (calleeId && callerId !== calleeId) {
            graph.edges.push({
              caller: callerId,
              callee: calleeId,
              callSite: { file: filePath, line: callLine },
            });
          }
        }
      }

      // Handle function references (callbacks, event handlers)
      if (Node.isIdentifier(node)) {
        const parent = node.getParent();

        // Skip if this is the function name being declared
        if (parent && (
          Node.isFunctionDeclaration(parent) ||
          Node.isVariableDeclaration(parent) ||
          Node.isMethodDeclaration(parent) ||
          Node.isParameter(parent)
        )) {
          return;
        }

        // Skip if this is the callee of a call expression (handled above)
        if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
          return;
        }

        const localName = node.getText();
        // Resolve imported name to original
        const resolvedName = importMap.get(localName) || localName;
        const calleeId = symbolMap.get(resolvedName);

        if (calleeId) {
          // This identifier references a function - find the containing function
          const containingFunc = this.findContainingFunction(node);
          if (!containingFunc) return;

          const callerId = this.getContainingFunctionId(containingFunc, filePath, graph);

          if (callerId && callerId !== calleeId) {
            // Check if this is a function reference (passed as callback, etc.)
            const calleeNode = graph.nodes.get(calleeId);
            if (calleeNode && (calleeNode.type === 'function' || calleeNode.type === 'method')) {
              graph.edges.push({
                caller: callerId,
                callee: calleeId,
                callSite: { file: filePath, line: node.getStartLineNumber() },
              });
            }
          }
        }
      }
    });
  }

  /**
   * Get the ID of the containing function from the graph
   */
  private getContainingFunctionId(funcNode: Node, filePath: string, graph: CallGraph): string | undefined {
    const name = this.getContainingFunctionName(funcNode);
    const line = funcNode.getStartLineNumber();

    // Try exact match first
    const exactId = this.generateId(filePath, name, line);
    if (graph.nodes.has(exactId)) {
      return exactId;
    }

    // Fallback: search for matching node by name and file
    for (const [id, node] of graph.nodes) {
      if (node.name === name && node.filePath === filePath) {
        return id;
      }
      // Also try qualified name match for methods
      if (node.type === 'method' && id.includes(name) && node.filePath === filePath) {
        return id;
      }
    }

    return undefined;
  }

  // ============================================================================
  // PRIVATE: ENTRY POINT IDENTIFICATION
  // ============================================================================

  private findEntryPoints(graph: CallGraph): string[] {
    const entryPoints: string[] = [];

    for (const [id, node] of graph.nodes) {
      if (node.isExported) {
        entryPoints.push(id);
      }
    }

    return entryPoints;
  }

  // ============================================================================
  // PRIVATE: REPORT ANALYSIS
  // ============================================================================

  private analyzeReport(report: DeadCodeReport, graph: CallGraph): void {
    const falsePositiveReasons: string[] = [];

    for (const element of report.deadElements) {
      // Check for potential dynamic invocation patterns
      if (element.name.startsWith('handle') || element.name.startsWith('on')) {
        falsePositiveReasons.push(
          `'${element.name}' may be an event handler called dynamically`
        );
      }

      if (element.name.includes('callback') || element.name.includes('Callback')) {
        falsePositiveReasons.push(
          `'${element.name}' may be a callback passed to external code`
        );
      }

      // Check for test-related functions
      if (element.name.includes('test') || element.name.includes('Test') ||
          element.name.includes('spec') || element.name.includes('Spec')) {
        falsePositiveReasons.push(
          `'${element.name}' may be a test function invoked by test framework`
        );
      }
    }

    report.potentialFalsePositives = [...new Set(falsePositiveReasons)];

    // Determine suggested action
    if (report.potentialFalsePositives.length > report.deadElements.length / 2) {
      report.suggestedAction = 'review';
    } else if (report.deadElements.every((e) => !e.isExported && e.type === 'function')) {
      report.suggestedAction = 'remove';
    } else {
      report.suggestedAction = 'review';
    }
  }

  // ============================================================================
  // PRIVATE: HELPER METHODS
  // ============================================================================

  private generateId(filePath: string, name: string, line: number): string {
    // Create a unique ID based on file path, name, and line number
    return `${filePath}:${name}:${line}`;
  }

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

  private findContainingFunction(node: Node): Node | undefined {
    let current = node.getParent();
    while (current) {
      if (
        Node.isFunctionDeclaration(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current) ||
        Node.isConstructorDeclaration(current)
      ) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  private findContainingClass(node: Node): import('ts-morph').ClassDeclaration | undefined {
    let current = node.getParent();
    while (current) {
      if (Node.isClassDeclaration(current)) {
        return current;
      }
      current = current.getParent();
    }
    return undefined;
  }

  private getContainingFunctionName(funcNode: Node): string {
    if (Node.isFunctionDeclaration(funcNode)) {
      return funcNode.getName() || 'anonymous';
    }

    if (Node.isMethodDeclaration(funcNode)) {
      const methodName = funcNode.getName();
      const cls = this.findContainingClass(funcNode);
      if (cls) {
        const className = cls.getName();
        if (className) {
          return `${className}.${methodName}`;
        }
      }
      return methodName;
    }

    if (Node.isConstructorDeclaration(funcNode)) {
      const cls = this.findContainingClass(funcNode);
      if (cls) {
        const className = cls.getName();
        if (className) {
          return `${className}.constructor`;
        }
      }
      return 'constructor';
    }

    if (Node.isArrowFunction(funcNode) || Node.isFunctionExpression(funcNode)) {
      // Try to find the variable it's assigned to
      const parent = funcNode.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
    }

    return 'anonymous';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ReachabilityAnalyzer instance
 */
export function createReachabilityAnalyzer(): ReachabilityAnalyzer {
  return new ReachabilityAnalyzer();
}
