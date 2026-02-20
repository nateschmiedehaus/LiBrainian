/**
 * @fileoverview Code Property Graph Construction
 *
 * Builds a combined AST + CFG + PDG representation for code analysis.
 * The Code Property Graph (CPG) enables powerful graph-based queries for:
 * - Security analysis (taint tracking, vulnerability detection)
 * - Code navigation (call graphs, data flow)
 * - Refactoring support (impact analysis)
 * - Code understanding (dependency tracking)
 *
 * This implementation uses ts-morph for TypeScript/JavaScript parsing
 * and builds a unified graph representation suitable for traversal and querying.
 *
 * @packageDocumentation
 */

import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of nodes in the Code Property Graph
 */
export type CPGNodeType =
  | 'function'
  | 'class'
  | 'variable'
  | 'parameter'
  | 'call'
  | 'statement'
  | 'expression';

/**
 * Types of edges in the Code Property Graph
 */
export type CPGEdgeType =
  | 'ast_child'
  | 'cfg_successor'
  | 'cfg_predecessor'
  | 'data_flow'
  | 'call'
  | 'return'
  | 'defines'
  | 'uses';

/**
 * A node in the Code Property Graph
 */
export interface CPGNode {
  /** Unique identifier for this node */
  id: string;
  /** The type of code element this node represents */
  type: CPGNodeType;
  /** Optional name (for named entities like functions, variables) */
  name?: string;
  /** Source code location */
  location: {
    file: string;
    line: number;
    column: number;
  };
  /** Additional properties specific to the node type */
  properties: Record<string, unknown>;
}

/**
 * An edge in the Code Property Graph
 */
export interface CPGEdge {
  /** Unique identifier for this edge */
  id: string;
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** The type of relationship this edge represents */
  type: CPGEdgeType;
  /** Optional additional properties */
  properties?: Record<string, unknown>;
}

/**
 * The complete Code Property Graph
 */
export interface CodePropertyGraph {
  /** Map of node ID to node */
  nodes: Map<string, CPGNode>;
  /** Map of edge ID to edge */
  edges: Map<string, CPGEdge>;
  /** Graph metadata */
  metadata: {
    /** Files included in this graph */
    files: string[];
    /** Primary language of the codebase */
    language: string;
    /** When the graph was created */
    createdAt: Date;
  };
}

/**
 * Query specification for graph traversal
 */
export interface GraphQuery {
  /** Filter nodes by type */
  nodeTypes?: string[];
  /** Filter edges by type */
  edgeTypes?: string[];
  /** Simple pattern matching on node names (case-insensitive contains) */
  pattern?: string;
  /** Maximum traversal depth for path finding */
  maxDepth?: number;
}

/**
 * Result of a graph query
 */
export interface QueryResult {
  /** Matching nodes */
  nodes: CPGNode[];
  /** Matching edges */
  edges: CPGEdge[];
  /** Optional paths found (for traversal queries) */
  paths?: CPGNode[][];
}

// ============================================================================
// CODE PROPERTY GRAPH BUILDER CLASS
// ============================================================================

/**
 * Builds Code Property Graphs from TypeScript/JavaScript source code
 */
export class CodePropertyGraphBuilder {
  private project: Project;
  private nodeCounter = 0;
  private edgeCounter = 0;

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
   * Build a Code Property Graph from a single file
   */
  async buildFromFile(filePath: string): Promise<CodePropertyGraph> {
    const graph = this.createEmptyGraph();

    try {
      if (!fs.existsSync(filePath)) {
        return graph;
      }

      // Create a fresh project for this build to avoid caching issues
      this.resetProject();

      const absolutePath = path.resolve(filePath);
      const sourceFile = this.getOrAddSourceFile(absolutePath);
      if (!sourceFile) {
        return graph;
      }

      graph.metadata.files.push(absolutePath);
      this.processSourceFile(sourceFile, graph);

      return graph;
    } catch {
      return graph;
    }
  }

  /**
   * Build a Code Property Graph from a directory
   */
  async buildFromDirectory(
    dirPath: string,
    patterns?: string[]
  ): Promise<CodePropertyGraph> {
    const graph = this.createEmptyGraph();

    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return graph;
      }

      // Create a fresh project for this build to avoid caching issues
      this.resetProject();

      const absoluteDir = path.resolve(dirPath);
      const files = await this.getTypeScriptFiles(absoluteDir, patterns);

      for (const file of files) {
        const sourceFile = this.getOrAddSourceFile(file);
        if (sourceFile) {
          graph.metadata.files.push(file);
          this.processSourceFile(sourceFile, graph);
        }
      }

      return graph;
    } catch {
      return graph;
    }
  }

  /**
   * Query the graph for matching nodes and edges
   */
  query(graph: CodePropertyGraph, query: GraphQuery): QueryResult {
    const result: QueryResult = {
      nodes: [],
      edges: [],
    };

    // Filter nodes
    let matchingNodes = Array.from(graph.nodes.values());

    if (query.nodeTypes && query.nodeTypes.length > 0) {
      matchingNodes = matchingNodes.filter((n) =>
        query.nodeTypes!.includes(n.type)
      );
    }

    if (query.pattern) {
      const pattern = query.pattern.toLowerCase();
      matchingNodes = matchingNodes.filter(
        (n) => n.name && n.name.toLowerCase().includes(pattern)
      );
    }

    result.nodes = matchingNodes;

    // Filter edges
    let matchingEdges = Array.from(graph.edges.values());

    if (query.edgeTypes && query.edgeTypes.length > 0) {
      matchingEdges = matchingEdges.filter((e) =>
        query.edgeTypes!.includes(e.type)
      );
    }

    // If we have matching nodes, also filter edges to only include those connected to matching nodes
    if (result.nodes.length > 0 && !query.edgeTypes) {
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      matchingEdges = matchingEdges.filter(
        (e) => nodeIds.has(e.from) || nodeIds.has(e.to)
      );
    }

    result.edges = matchingEdges;

    // Path finding with maxDepth
    if (query.maxDepth !== undefined && result.nodes.length > 0) {
      result.paths = this.findPaths(graph, result.nodes[0].id, query.maxDepth);
    }

    return result;
  }

  /**
   * Find all functions that call the given function
   */
  findCallers(graph: CodePropertyGraph, functionName: string): CPGNode[] {
    const callerIds = new Set<string>();
    const callers: CPGNode[] = [];

    // Find call nodes that reference the function name
    for (const node of graph.nodes.values()) {
      if (node.type === 'call' && node.properties.callee === functionName) {
        // Find the containing function
        const containingFuncId = node.properties.containingFunction as string;
        if (containingFuncId && !callerIds.has(containingFuncId)) {
          const containingFunc = graph.nodes.get(containingFuncId);
          if (containingFunc && containingFunc.type === 'function') {
            callerIds.add(containingFuncId);
            callers.push(containingFunc);
          }
        }
      }
    }

    // Also check for method calls like s.process()
    for (const node of graph.nodes.values()) {
      if (node.type === 'call') {
        const callee = node.properties.callee as string;
        // Check if callee ends with the function name (e.g., "s.process" matches "process")
        if (callee && callee.endsWith('.' + functionName)) {
          const containingFuncId = node.properties.containingFunction as string;
          if (containingFuncId && !callerIds.has(containingFuncId)) {
            const containingFunc = graph.nodes.get(containingFuncId);
            if (containingFunc && containingFunc.type === 'function') {
              callerIds.add(containingFuncId);
              callers.push(containingFunc);
            }
          }
        }
      }
    }

    return callers;
  }

  /**
   * Find data flow edges related to a variable
   */
  findDataFlow(graph: CodePropertyGraph, variableName: string): CPGEdge[] {
    const dataFlowEdges: CPGEdge[] = [];

    // Find variable nodes with this name
    const varNodes = Array.from(graph.nodes.values()).filter(
      (n) =>
        (n.type === 'variable' || n.type === 'parameter') &&
        n.name === variableName
    );

    const varIds = new Set(varNodes.map((n) => n.id));

    // Find all edges involving these variables
    for (const edge of graph.edges.values()) {
      if (
        (edge.type === 'defines' ||
          edge.type === 'uses' ||
          edge.type === 'data_flow') &&
        (varIds.has(edge.from) || varIds.has(edge.to))
      ) {
        dataFlowEdges.push(edge);
      }
    }

    return dataFlowEdges;
  }

  /**
   * Merge multiple graphs into one
   */
  merge(graphs: CodePropertyGraph[]): CodePropertyGraph {
    const merged = this.createEmptyGraph();

    for (const graph of graphs) {
      // Merge nodes
      for (const [id, node] of graph.nodes) {
        merged.nodes.set(id, node);
      }

      // Merge edges
      for (const [id, edge] of graph.edges) {
        merged.edges.set(id, edge);
      }

      // Merge metadata
      merged.metadata.files.push(...graph.metadata.files);
      if (graph.metadata.createdAt > merged.metadata.createdAt) {
        merged.metadata.createdAt = graph.metadata.createdAt;
      }
    }

    return merged;
  }

  // ============================================================================
  // PRIVATE METHODS - GRAPH CREATION
  // ============================================================================

  private createEmptyGraph(): CodePropertyGraph {
    return {
      nodes: new Map(),
      edges: new Map(),
      metadata: {
        files: [],
        language: 'typescript',
        createdAt: new Date(),
      },
    };
  }

  private generateNodeId(): string {
    return `node_${++this.nodeCounter}`;
  }

  private generateEdgeId(): string {
    return `edge_${++this.edgeCounter}`;
  }

  private resetProject(): void {
    // Create a fresh project instance to avoid caching issues between builds
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
    // Note: We do NOT reset counters here to ensure unique node/edge IDs across multiple builds
    // This is important for the merge operation to work correctly
  }

  private getOrAddSourceFile(filePath: string): SourceFile | undefined {
    try {
      let sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(filePath);
      }
      return sourceFile;
    } catch {
      return undefined;
    }
  }

  private async getTypeScriptFiles(
    dirPath: string,
    patterns?: string[]
  ): Promise<string[]> {
    try {
      // Use manual recursive directory walking for reliability
      const allFiles: string[] = [];

      const walk = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                walk(fullPath);
              }
            } else if (entry.isFile()) {
              if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
                  !entry.name.endsWith('.d.ts')) {
                // Check if file matches patterns (if specified)
                if (patterns && patterns.length > 0) {
                  const relativePath = path.relative(dirPath, fullPath);
                  const matches = patterns.some(pattern => {
                    // Simple pattern matching for src/**/*.ts style patterns
                    const parts = pattern.split('**');
                    if (parts.length === 2) {
                      const prefix = parts[0].replace(/\/$/, '');
                      const suffix = parts[1].replace(/^\//, '');
                      const relDir = path.dirname(relativePath);
                      return (prefix === '' || relativePath.startsWith(prefix) || relDir.startsWith(prefix)) &&
                             (suffix === '' || relativePath.endsWith(suffix.replace('*', '')));
                    }
                    return relativePath.includes(pattern);
                  });
                  if (matches) {
                    allFiles.push(fullPath);
                  }
                } else {
                  allFiles.push(fullPath);
                }
              }
            }
          }
        } catch {
          // Skip directories we can't read
        }
      };

      walk(dirPath);
      return allFiles;
    } catch {
      return [];
    }
  }

  // ============================================================================
  // PRIVATE METHODS - SOURCE FILE PROCESSING
  // ============================================================================

  private processSourceFile(
    sourceFile: SourceFile,
    graph: CodePropertyGraph
  ): void {
    const filePath = sourceFile.getFilePath();

    // Extract functions
    this.extractFunctions(sourceFile, filePath, graph);

    // Extract classes
    this.extractClasses(sourceFile, filePath, graph);

    // Extract top-level variables
    this.extractVariables(sourceFile, filePath, graph);

    // Build control flow edges
    this.buildControlFlowEdges(sourceFile, graph);

    // Build data flow edges
    this.buildDataFlowEdges(sourceFile, graph);
  }

  private extractFunctions(
    sourceFile: SourceFile,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    // Standalone functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (!name) continue;

      const nodeId = this.generateNodeId();
      const node: CPGNode = {
        id: nodeId,
        type: 'function',
        name,
        location: {
          file: filePath,
          line: func.getStartLineNumber(),
          column: func.getStart() - func.getStartLineNumber() + 1,
        },
        properties: {
          isAsync: func.isAsync(),
          isExported: func.isExported(),
          parameterCount: func.getParameters().length,
        },
      };
      graph.nodes.set(nodeId, node);

      // Extract parameters
      this.extractParameters(func, nodeId, filePath, graph);

      // Extract calls within function
      this.extractCalls(func, nodeId, filePath, graph);

      // Extract statements for CFG
      this.extractStatements(func, nodeId, filePath, graph);
    }

    // Arrow functions assigned to variables
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (initializer && Node.isArrowFunction(initializer)) {
        const name = varDecl.getName();
        const nodeId = this.generateNodeId();
        const node: CPGNode = {
          id: nodeId,
          type: 'function',
          name,
          location: {
            file: filePath,
            line: varDecl.getStartLineNumber(),
            column: varDecl.getStart() - varDecl.getStartLineNumber() + 1,
          },
          properties: {
            isAsync: initializer.isAsync(),
            isExported: varDecl.isExported(),
            isArrowFunction: true,
            parameterCount: initializer.getParameters().length,
          },
        };
        graph.nodes.set(nodeId, node);

        // Extract parameters
        this.extractArrowFunctionParameters(initializer, nodeId, filePath, graph);

        // Extract calls
        this.extractCalls(initializer, nodeId, filePath, graph);
      }
    }
  }

  private extractClasses(
    sourceFile: SourceFile,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;

      const classNodeId = this.generateNodeId();
      const classNode: CPGNode = {
        id: classNodeId,
        type: 'class',
        name,
        location: {
          file: filePath,
          line: cls.getStartLineNumber(),
          column: cls.getStart() - cls.getStartLineNumber() + 1,
        },
        properties: {
          isAbstract: cls.isAbstract(),
          isExported: cls.isExported(),
          extends: cls.getExtends()?.getText(),
          implements: cls.getImplements().map((i) => i.getText()),
        },
      };
      graph.nodes.set(classNodeId, classNode);

      // Extract methods
      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const methodNodeId = this.generateNodeId();
        const methodNode: CPGNode = {
          id: methodNodeId,
          type: 'function',
          name: methodName,
          location: {
            file: filePath,
            line: method.getStartLineNumber(),
            column: method.getStart() - method.getStartLineNumber() + 1,
          },
          properties: {
            isAsync: method.isAsync(),
            isStatic: method.isStatic(),
            className: name,
            parameterCount: method.getParameters().length,
          },
        };
        graph.nodes.set(methodNodeId, methodNode);

        // AST child edge from class to method
        const edgeId = this.generateEdgeId();
        graph.edges.set(edgeId, {
          id: edgeId,
          from: classNodeId,
          to: methodNodeId,
          type: 'ast_child',
        });

        // Extract parameters
        this.extractParameters(method, methodNodeId, filePath, graph);

        // Extract calls within method
        this.extractCalls(method, methodNodeId, filePath, graph);

        // Extract statements
        this.extractStatements(method, methodNodeId, filePath, graph);
      }
    }
  }

  private extractVariables(
    sourceFile: SourceFile,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    for (const varStmt of sourceFile.getVariableStatements()) {
      for (const decl of varStmt.getDeclarations()) {
        const name = decl.getName();
        const initializer = decl.getInitializer();

        // Skip arrow functions (handled separately)
        if (initializer && Node.isArrowFunction(initializer)) {
          continue;
        }

        const nodeId = this.generateNodeId();
        const node: CPGNode = {
          id: nodeId,
          type: 'variable',
          name,
          location: {
            file: filePath,
            line: decl.getStartLineNumber(),
            column: decl.getStart() - decl.getStartLineNumber() + 1,
          },
          properties: {
            kind: varStmt.getDeclarationKind().toString(),
            isExported: varStmt.isExported(),
            hasInitializer: !!initializer,
          },
        };
        graph.nodes.set(nodeId, node);
      }
    }
  }

  private extractParameters(
    funcLike: Node,
    parentNodeId: string,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    if (!Node.isFunctionDeclaration(funcLike) && !Node.isMethodDeclaration(funcLike)) {
      return;
    }

    for (const param of funcLike.getParameters()) {
      const name = param.getName();
      const nodeId = this.generateNodeId();
      const node: CPGNode = {
        id: nodeId,
        type: 'parameter',
        name,
        location: {
          file: filePath,
          line: param.getStartLineNumber(),
          column: param.getStart() - param.getStartLineNumber() + 1,
        },
        properties: {
          type: param.getType().getText(),
          isOptional: param.isOptional(),
          hasDefault: !!param.getInitializer(),
        },
      };
      graph.nodes.set(nodeId, node);

      // AST child edge from function to parameter
      const edgeId = this.generateEdgeId();
      graph.edges.set(edgeId, {
        id: edgeId,
        from: parentNodeId,
        to: nodeId,
        type: 'ast_child',
      });
    }
  }

  private extractArrowFunctionParameters(
    arrowFunc: Node,
    parentNodeId: string,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    if (!Node.isArrowFunction(arrowFunc)) return;

    for (const param of arrowFunc.getParameters()) {
      const name = param.getName();
      const nodeId = this.generateNodeId();
      const node: CPGNode = {
        id: nodeId,
        type: 'parameter',
        name,
        location: {
          file: filePath,
          line: param.getStartLineNumber(),
          column: param.getStart() - param.getStartLineNumber() + 1,
        },
        properties: {
          type: param.getType().getText(),
          isOptional: param.isOptional(),
        },
      };
      graph.nodes.set(nodeId, node);

      const edgeId = this.generateEdgeId();
      graph.edges.set(edgeId, {
        id: edgeId,
        from: parentNodeId,
        to: nodeId,
        type: 'ast_child',
      });
    }
  }

  private extractCalls(
    node: Node,
    containingFunctionId: string,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    const callExpressions = node.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const expression = call.getExpression();
      let callee: string;

      if (Node.isPropertyAccessExpression(expression)) {
        const propName = expression.getName();
        const objText = expression.getExpression().getText();
        callee = objText === 'this' ? propName : `${objText}.${propName}`;
      } else if (Node.isIdentifier(expression)) {
        callee = expression.getText();
      } else {
        callee = expression.getText().slice(0, 50);
      }

      const nodeId = this.generateNodeId();
      const callNode: CPGNode = {
        id: nodeId,
        type: 'call',
        name: callee,
        location: {
          file: filePath,
          line: call.getStartLineNumber(),
          column: call.getStart() - call.getStartLineNumber() + 1,
        },
        properties: {
          callee,
          argumentCount: call.getArguments().length,
          containingFunction: containingFunctionId,
        },
      };
      graph.nodes.set(nodeId, callNode);

      // Call edge from containing function to call site
      const callEdgeId = this.generateEdgeId();
      graph.edges.set(callEdgeId, {
        id: callEdgeId,
        from: containingFunctionId,
        to: nodeId,
        type: 'call',
        properties: { callee },
      });

      // Try to resolve the callee to a known function
      const calleeNode = Array.from(graph.nodes.values()).find(
        (n) => n.type === 'function' && n.name === callee.split('.').pop()
      );

      if (calleeNode) {
        // Create a call edge to the resolved function
        const resolvedCallEdgeId = this.generateEdgeId();
        graph.edges.set(resolvedCallEdgeId, {
          id: resolvedCallEdgeId,
          from: nodeId,
          to: calleeNode.id,
          type: 'call',
          properties: { resolved: true },
        });

        // Create a return edge
        const returnEdgeId = this.generateEdgeId();
        graph.edges.set(returnEdgeId, {
          id: returnEdgeId,
          from: calleeNode.id,
          to: nodeId,
          type: 'return',
        });
      }
    }
  }

  private extractStatements(
    node: Node,
    containingFunctionId: string,
    filePath: string,
    graph: CodePropertyGraph
  ): void {
    // Get direct statement children
    const statements = node.getDescendantsOfKind(SyntaxKind.ExpressionStatement);
    const varStatements = node.getDescendantsOfKind(SyntaxKind.VariableStatement);
    const returnStatements = node.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    const ifStatements = node.getDescendantsOfKind(SyntaxKind.IfStatement);

    const allStatements = [
      ...statements,
      ...varStatements,
      ...returnStatements,
      ...ifStatements,
    ].sort((a, b) => a.getStart() - b.getStart());

    let previousStmtId: string | null = null;

    for (const stmt of allStatements) {
      const nodeId = this.generateNodeId();
      const stmtNode: CPGNode = {
        id: nodeId,
        type: 'statement',
        location: {
          file: filePath,
          line: stmt.getStartLineNumber(),
          column: stmt.getStart() - stmt.getStartLineNumber() + 1,
        },
        properties: {
          kind: stmt.getKindName(),
          containingFunction: containingFunctionId,
        },
      };
      graph.nodes.set(nodeId, stmtNode);

      // CFG successor edge from previous statement
      if (previousStmtId) {
        const cfgEdgeId = this.generateEdgeId();
        graph.edges.set(cfgEdgeId, {
          id: cfgEdgeId,
          from: previousStmtId,
          to: nodeId,
          type: 'cfg_successor',
        });
      }

      previousStmtId = nodeId;
    }
  }

  private buildControlFlowEdges(
    sourceFile: SourceFile,
    graph: CodePropertyGraph
  ): void {
    const filePath = sourceFile.getFilePath();

    // Find for/while loops and create control flow edges
    const forStatements = sourceFile.getDescendantsOfKind(SyntaxKind.ForStatement);
    const whileStatements = sourceFile.getDescendantsOfKind(SyntaxKind.WhileStatement);
    const forOfStatements = sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement);
    const forInStatements = sourceFile.getDescendantsOfKind(SyntaxKind.ForInStatement);

    const allLoops = [...forStatements, ...whileStatements, ...forOfStatements, ...forInStatements];

    for (const loop of allLoops) {
      const loopLine = loop.getStartLineNumber();

      // Create a node for the loop itself
      const loopNodeId = this.generateNodeId();
      const loopNode: CPGNode = {
        id: loopNodeId,
        type: 'statement',
        location: {
          file: filePath,
          line: loopLine,
          column: loop.getStart() - loopLine + 1,
        },
        properties: {
          kind: loop.getKindName(),
          isLoop: true,
        },
      };
      graph.nodes.set(loopNodeId, loopNode);

      // Get loop body
      let loopBody: Node | undefined;
      if (Node.isForStatement(loop) || Node.isWhileStatement(loop)) {
        loopBody = loop.getStatement();
      } else if (Node.isForOfStatement(loop) || Node.isForInStatement(loop)) {
        loopBody = loop.getStatement();
      }

      if (loopBody) {
        // Find statement nodes within the body
        const bodyStmts = loopBody.getDescendantsOfKind(SyntaxKind.ExpressionStatement);

        if (bodyStmts.length > 0) {
          const firstStmt = bodyStmts[0];
          const lastStmt = bodyStmts[bodyStmts.length - 1];

          // Create a node for the first statement in loop body if not exists
          const firstStmtNodeId = this.generateNodeId();
          const firstStmtNode: CPGNode = {
            id: firstStmtNodeId,
            type: 'statement',
            location: {
              file: filePath,
              line: firstStmt.getStartLineNumber(),
              column: firstStmt.getStart() - firstStmt.getStartLineNumber() + 1,
            },
            properties: {
              kind: 'ExpressionStatement',
              inLoop: true,
            },
          };
          graph.nodes.set(firstStmtNodeId, firstStmtNode);

          // CFG edge from loop to first body statement
          const toBodyEdgeId = this.generateEdgeId();
          graph.edges.set(toBodyEdgeId, {
            id: toBodyEdgeId,
            from: loopNodeId,
            to: firstStmtNodeId,
            type: 'cfg_successor',
          });

          // Back-edge from last statement to loop (for loop continuation)
          const backEdgeId = this.generateEdgeId();
          graph.edges.set(backEdgeId, {
            id: backEdgeId,
            from: firstStmtNodeId,
            to: loopNodeId,
            type: 'cfg_predecessor',
            properties: { isBackEdge: true },
          });
        } else {
          // Even without statements, create a back-edge to represent loop
          const emptyLoopEdgeId = this.generateEdgeId();
          graph.edges.set(emptyLoopEdgeId, {
            id: emptyLoopEdgeId,
            from: loopNodeId,
            to: loopNodeId,
            type: 'cfg_predecessor',
            properties: { isBackEdge: true, emptyBody: true },
          });
        }
      }
    }

    // Find if statements and create CFG edges for branches
    const ifStatements = sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement);

    for (const ifStmt of ifStatements) {
      const ifLine = ifStmt.getStartLineNumber();
      const thenBlock = ifStmt.getThenStatement();
      const elseBlock = ifStmt.getElseStatement();

      // Create a node for the if condition
      const ifNodeId = this.generateNodeId();
      const ifNode: CPGNode = {
        id: ifNodeId,
        type: 'statement',
        location: {
          file: filePath,
          line: ifLine,
          column: ifStmt.getStart() - ifLine + 1,
        },
        properties: {
          kind: 'IfStatement',
          hasElse: !!elseBlock,
        },
      };
      graph.nodes.set(ifNodeId, ifNode);

      // Find statements in then block
      const thenStmts: Node[] = [
        ...thenBlock.getDescendantsOfKind(SyntaxKind.ExpressionStatement),
        ...thenBlock.getDescendantsOfKind(SyntaxKind.ReturnStatement),
      ];

      if (thenStmts.length > 0) {
        const firstThenLine = thenStmts[0].getStartLineNumber();
        const thenNodeId = this.generateNodeId();
        const thenNode: CPGNode = {
          id: thenNodeId,
          type: 'statement',
          location: {
            file: filePath,
            line: firstThenLine,
            column: thenStmts[0].getStart() - firstThenLine + 1,
          },
          properties: {
            kind: 'ThenBranch',
          },
        };
        graph.nodes.set(thenNodeId, thenNode);

        // Edge from if to then
        const thenEdgeId = this.generateEdgeId();
        graph.edges.set(thenEdgeId, {
          id: thenEdgeId,
          from: ifNodeId,
          to: thenNodeId,
          type: 'cfg_successor',
          properties: { branch: 'then' },
        });
      }

      // Find statements in else block
      if (elseBlock) {
        const elseStmts: Node[] = [
          ...elseBlock.getDescendantsOfKind(SyntaxKind.ExpressionStatement),
          ...elseBlock.getDescendantsOfKind(SyntaxKind.ReturnStatement),
        ];

        if (elseStmts.length > 0) {
          const firstElseLine = elseStmts[0].getStartLineNumber();
          const elseNodeId = this.generateNodeId();
          const elseNode: CPGNode = {
            id: elseNodeId,
            type: 'statement',
            location: {
              file: filePath,
              line: firstElseLine,
              column: elseStmts[0].getStart() - firstElseLine + 1,
            },
            properties: {
              kind: 'ElseBranch',
            },
          };
          graph.nodes.set(elseNodeId, elseNode);

          // Edge from if to else
          const elseEdgeId = this.generateEdgeId();
          graph.edges.set(elseEdgeId, {
            id: elseEdgeId,
            from: ifNodeId,
            to: elseNodeId,
            type: 'cfg_successor',
            properties: { branch: 'else' },
          });
        }
      }
    }
  }

  private buildDataFlowEdges(
    sourceFile: SourceFile,
    graph: CodePropertyGraph
  ): void {
    const filePath = sourceFile.getFilePath();

    // Track variable definitions by name -> list of (nodeId, line)
    const variableMap = new Map<string, Array<{id: string, line: number}>>();

    // First, collect all variable definitions (including inside functions)
    for (const varDecl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = varDecl.getName();
      const initializer = varDecl.getInitializer();
      const line = varDecl.getStartLineNumber();

      // Skip arrow functions (handled as functions)
      if (initializer && Node.isArrowFunction(initializer)) {
        continue;
      }

      // Check if we already have a variable node for this
      let varNode = Array.from(graph.nodes.values()).find(
        (n) => n.type === 'variable' && n.name === name && n.location.line === line
      );

      // If not (e.g., variable inside a function), create one
      if (!varNode) {
        const nodeId = this.generateNodeId();
        varNode = {
          id: nodeId,
          type: 'variable' as CPGNodeType,
          name,
          location: {
            file: filePath,
            line,
            column: varDecl.getStart() - line + 1,
          },
          properties: {
            hasInitializer: !!initializer,
          },
        };
        graph.nodes.set(nodeId, varNode);
      }

      if (!variableMap.has(name)) {
        variableMap.set(name, []);
      }
      variableMap.get(name)!.push({ id: varNode.id, line });

      // Create defines edge
      if (initializer) {
        const defEdgeId = this.generateEdgeId();
        graph.edges.set(defEdgeId, {
          id: defEdgeId,
          from: varNode.id,
          to: varNode.id,
          type: 'defines',
          properties: { hasInitializer: true, line },
        });
      }
    }

    // Also handle parameters
    for (const param of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
      const name = param.getName();
      const line = param.getStartLineNumber();
      const paramNode = Array.from(graph.nodes.values()).find(
        (n) => n.type === 'parameter' && n.name === name && n.location.line === line
      );

      if (paramNode) {
        if (!variableMap.has(name)) {
          variableMap.set(name, []);
        }
        variableMap.get(name)!.push({ id: paramNode.id, line });

        // Create defines edge for parameter (it's defined at function entry)
        const defEdgeId = this.generateEdgeId();
        graph.edges.set(defEdgeId, {
          id: defEdgeId,
          from: paramNode.id,
          to: paramNode.id,
          type: 'defines',
          properties: { isParameter: true, line },
        });
      }
    }

    // Second pass: find variable uses
    for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const name = identifier.getText();
      const parent = identifier.getParent();
      const useLine = identifier.getStartLineNumber();

      // Skip if this is a declaration or definition
      if (parent) {
        if (Node.isVariableDeclaration(parent) && parent.getNameNode() === identifier) {
          continue;
        }
        if (Node.isParameterDeclaration(parent)) {
          continue;
        }
        if (Node.isFunctionDeclaration(parent) || Node.isMethodDeclaration(parent)) {
          continue;
        }
        if (Node.isPropertyDeclaration(parent)) {
          continue;
        }
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) {
          // This is the property being accessed (e.g., 'x' in 'obj.x'), not a variable reference
          continue;
        }
      }

      // Find the closest definition of this variable (by line number)
      const varDefs = variableMap.get(name);
      if (varDefs && varDefs.length > 0) {
        // Find the most recent definition before this use
        const relevantDef = varDefs
          .filter(d => d.line <= useLine)
          .sort((a, b) => b.line - a.line)[0] || varDefs[0];

        // Create uses edge
        const usesEdgeId = this.generateEdgeId();
        graph.edges.set(usesEdgeId, {
          id: usesEdgeId,
          from: relevantDef.id,
          to: relevantDef.id,
          type: 'uses',
          properties: { useLine },
        });

        // Create data_flow edge
        const dataFlowEdgeId = this.generateEdgeId();
        graph.edges.set(dataFlowEdgeId, {
          id: dataFlowEdgeId,
          from: relevantDef.id,
          to: relevantDef.id,
          type: 'data_flow',
          properties: {
            fromLine: relevantDef.line,
            toLine: useLine,
          },
        });
      }
    }
  }

  // ============================================================================
  // PRIVATE METHODS - GRAPH TRAVERSAL
  // ============================================================================

  private findPaths(
    graph: CodePropertyGraph,
    startNodeId: string,
    maxDepth: number
  ): CPGNode[][] {
    const paths: CPGNode[][] = [];
    const visited = new Set<string>();

    const dfs = (nodeId: string, currentPath: CPGNode[], depth: number) => {
      if (depth > maxDepth) return;

      const node = graph.nodes.get(nodeId);
      if (!node) return;

      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      currentPath.push(node);

      // Find outgoing edges
      const outEdges = Array.from(graph.edges.values()).filter(
        (e) => e.from === nodeId
      );

      if (outEdges.length === 0 || depth === maxDepth) {
        // End of path or max depth reached
        paths.push([...currentPath]);
      } else {
        for (const edge of outEdges) {
          dfs(edge.to, currentPath, depth + 1);
        }
      }

      currentPath.pop();
      visited.delete(nodeId);
    };

    dfs(startNodeId, [], 0);
    return paths;
  }

  private findContainingFunction(
    graph: CodePropertyGraph,
    nodeId: string
  ): CPGNode | null {
    const node = graph.nodes.get(nodeId);
    if (!node) return null;

    const containingFuncId = node.properties.containingFunction as string;
    if (containingFuncId) {
      return graph.nodes.get(containingFuncId) || null;
    }

    // Search for function that has this node as a child
    for (const edge of graph.edges.values()) {
      if (edge.to === nodeId && edge.type === 'call') {
        const parentNode = graph.nodes.get(edge.from);
        if (parentNode && parentNode.type === 'function') {
          return parentNode;
        }
      }
    }

    return null;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CodePropertyGraphBuilder instance
 */
export function createCodePropertyGraphBuilder(): CodePropertyGraphBuilder {
  return new CodePropertyGraphBuilder();
}
