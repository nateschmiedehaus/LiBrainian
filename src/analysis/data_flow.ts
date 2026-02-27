/**
 * Data Flow Analysis Primitives
 *
 * Implements data lineage and state tracing for code analysis:
 * - tp_data_lineage: Track where data originates, transforms, and ends
 * - tp_state_trace: Track variable mutations and state changes
 *
 * These primitives support:
 * - Bug investigation (D01-K04): Trace data flow to undefined values
 * - Feature implementation (D02-K03, D02-K04): Track request flow and shared state
 * - Security auditing (D09-K03): Trace data from inputs to sensitive operations
 *
 * Based on specifications in:
 * - docs/archive/specs/use-case-capability-matrix.md
 * - docs/archive/specs/track-e-domain.md (D1)
 */

// ============================================================================
// DATA FLOW NODE TYPES
// ============================================================================

/**
 * A node in the data flow graph representing a point where data exists.
 */
export interface DataFlowNode {
  /** Unique identifier for this node */
  id: string;
  /** Type of data flow point */
  type: DataFlowNodeType;
  /** Location in source code */
  location: DataFlowLocation;
  /** Variable or expression name */
  name: string;
  /** TypeScript/JavaScript type if known */
  dataType?: string;
  /** Additional metadata about the node */
  metadata?: DataFlowNodeMetadata;
}

export type DataFlowNodeType =
  | 'source'      // Origin of data (literal, API call, user input)
  | 'transform'   // Data transformation (function call, operation)
  | 'sink'        // Data destination (return, API call, storage)
  | 'variable'    // Variable assignment or reference
  | 'parameter'   // Function parameter
  | 'return';     // Return statement

export interface DataFlowLocation {
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface DataFlowNodeMetadata {
  /** The actual code snippet */
  snippet?: string;
  /** Scope (function name, class, module) */
  scope?: string;
  /** Whether this is a potential taint source */
  isTaintSource?: boolean;
  /** Whether this is a security-sensitive sink */
  isSensitiveSink?: boolean;
  /** Confidence in the node identification */
  confidence?: number;
}

// ============================================================================
// DATA FLOW EDGE TYPES
// ============================================================================

/**
 * An edge in the data flow graph representing data movement.
 */
export interface DataFlowEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Type of transformation or transfer */
  transformType: DataFlowTransformType;
  /** Description of the transformation */
  description?: string;
  /** Confidence in this edge */
  confidence?: number;
}

export type DataFlowTransformType =
  | 'assign'           // Direct assignment (=)
  | 'call'             // Function call argument
  | 'return'           // Return value
  | 'parameter'        // Parameter passing
  | 'property_access'  // Property access (obj.prop)
  | 'destructure'      // Destructuring assignment
  | 'spread'           // Spread operator
  | 'await'            // Promise resolution
  | 'callback'         // Callback invocation
  | 'closure';         // Closure capture

// ============================================================================
// DATA LINEAGE TYPES
// ============================================================================

/**
 * Complete lineage information for a variable or expression.
 * Answers: "Where does this data come from, how is it transformed, where does it go?"
 */
export interface DataLineage {
  /** The variable or expression being traced */
  variable: string;
  /** All origin points of the data */
  origins: DataFlowNode[];
  /** All transformations applied to the data */
  transformations: DataFlowEdge[];
  /** All destination points where data flows */
  destinations: DataFlowNode[];
  /** Confidence in the lineage analysis */
  confidence: number;
  /** Warnings or limitations in the analysis */
  warnings?: string[];
}

// ============================================================================
// STATE TRACE TYPES
// ============================================================================

/**
 * A single mutation event in the state trace.
 */
export interface StateMutation {
  /** Location where the mutation occurs */
  location: DataFlowLocation;
  /** Type of operation (=, +=, .push, etc.) */
  operation: string;
  /** Value being assigned (if determinable) */
  value?: string;
  /** Scope where mutation occurs */
  scope?: string;
  /** Whether this is a conditional mutation */
  conditional?: boolean;
  /** Condition if conditional */
  condition?: string;
}

/**
 * Complete state trace for a variable.
 * Answers: "How does this variable's state change over time?"
 */
export interface StateTrace {
  /** The variable being traced */
  variable: string;
  /** Initial declaration location */
  declaration?: DataFlowLocation;
  /** All mutations to the variable */
  mutations: StateMutation[];
  /** Final state description (if determinable) */
  finalState: string;
  /** Whether the state is predictable or depends on runtime */
  deterministic: boolean;
  /** Confidence in the trace */
  confidence: number;
}

// ============================================================================
// DATA FLOW GRAPH
// ============================================================================

/**
 * Complete data flow graph for a file or scope.
 */
export interface DataFlowGraph {
  /** All nodes in the graph */
  nodes: DataFlowNode[];
  /** All edges in the graph */
  edges: DataFlowEdge[];
  /** File being analyzed */
  file: string;
  /** Analysis timestamp */
  analyzedAt: string;
  /** Confidence in the overall analysis */
  confidence: number;
}

// ============================================================================
// ANALYSIS PATTERNS
// ============================================================================

/**
 * Patterns for identifying data flow elements in code.
 */
const DATA_SOURCE_PATTERNS = [
  // Literals
  /^\s*(const|let|var)\s+\w+\s*=\s*(['"`]|[0-9]|true|false|null|\[|\{)/,
  // Function parameters
  /function\s*\w*\s*\([^)]*\)/,
  // Arrow function parameters
  /\([^)]*\)\s*=>/,
  /(\w+)\s*=>/,
  // API calls
  /\.(fetch|get|post|put|delete|request)\s*\(/,
  // User input
  /(req\.body|req\.params|req\.query|request\.|input\.|form\.|event\.)/,
  // Environment
  /process\.env\./,
];

const DATA_SINK_PATTERNS = [
  // Return statements
  /\breturn\b/,
  // Response methods
  /\.(send|json|render|redirect|write)\s*\(/,
  // Storage
  /\.(save|insert|update|delete|remove|set|put)\s*\(/,
  // Console/logging
  /console\.(log|error|warn|info)\s*\(/,
  // Database queries
  /\.(query|execute|run)\s*\(/,
];

const TRANSFORM_PATTERNS = [
  // Function calls
  /\w+\s*\([^)]*\)/,
  // Method calls
  /\.\w+\s*\([^)]*\)/,
  // Array operations
  /\.(map|filter|reduce|find|forEach|some|every)\s*\(/,
  // String operations
  /\.(split|join|replace|trim|slice|substring)\s*\(/,
  // Object spread
  /\{.*\.\.\./,
];

const ASSIGNMENT_PATTERNS = [
  // Simple assignment
  /(\w+)\s*=\s*([^=])/,
  // Compound assignment
  /(\w+)\s*(\+=|-=|\*=|\/=|&&=|\|\|=|\?\?=)/,
  // Destructuring
  /(?:const|let|var)\s*\{([^}]+)\}\s*=/,
  /(?:const|let|var)\s*\[([^\]]+)\]\s*=/,
];

// ============================================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Build a complete data flow graph for a file.
 *
 * This is the foundation for all data flow analysis. It identifies:
 * - All data sources (where data originates)
 * - All transformations (how data changes)
 * - All sinks (where data ends up)
 * - All edges connecting these nodes
 */
export function buildDataFlowGraph(
  file: string,
  content: string
): DataFlowGraph {
  const nodes: DataFlowNode[] = [];
  const edges: DataFlowEdge[] = [];
  const lines = content.split('\n');
  const nodeIdMap = new Map<string, string>(); // location -> nodeId
  let nodeCounter = 0;

  const generateNodeId = () => `node_${++nodeCounter}`;

  // First pass: identify all nodes
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum] ?? '';
    const lineNumber = lineNum + 1;

    // Identify sources
    for (const pattern of DATA_SOURCE_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const nodeId = generateNodeId();
        const name = extractNodeName(line, match);
        nodes.push({
          id: nodeId,
          type: 'source',
          location: { file, line: lineNumber },
          name,
          metadata: {
            snippet: line.trim(),
            confidence: 0.8,
            isTaintSource: isTaintSource(line),
          },
        });
        nodeIdMap.set(`${lineNumber}:source:${name}`, nodeId);
      }
    }

    // Identify sinks
    for (const pattern of DATA_SINK_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const nodeId = generateNodeId();
        const name = extractNodeName(line, match);
        nodes.push({
          id: nodeId,
          type: 'sink',
          location: { file, line: lineNumber },
          name,
          metadata: {
            snippet: line.trim(),
            confidence: 0.8,
            isSensitiveSink: isSensitiveSink(line),
          },
        });
        nodeIdMap.set(`${lineNumber}:sink:${name}`, nodeId);
      }
    }

    // Identify transforms
    for (const pattern of TRANSFORM_PATTERNS) {
      const match = line.match(pattern);
      if (match && !isSourceOrSink(line)) {
        const nodeId = generateNodeId();
        const name = extractNodeName(line, match);
        nodes.push({
          id: nodeId,
          type: 'transform',
          location: { file, line: lineNumber },
          name,
          metadata: {
            snippet: line.trim(),
            confidence: 0.7,
          },
        });
        nodeIdMap.set(`${lineNumber}:transform:${name}`, nodeId);
      }
    }

    // Identify variable declarations and assignments
    const varDeclMatch = line.match(/(?:const|let|var)\s+(\w+)\s*(?::\s*(\w+(?:<[^>]+>)?(?:\[\])?))?.*=/);
    if (varDeclMatch) {
      const varName = varDeclMatch[1]?.trim() ?? 'unknown';
      const explicitType = varDeclMatch[2];
      const nodeId = generateNodeId();
      nodes.push({
        id: nodeId,
        type: 'variable',
        location: { file, line: lineNumber },
        name: varName,
        dataType: explicitType ?? inferType(line),
        metadata: {
          snippet: line.trim(),
          confidence: 0.9,
        },
      });
      nodeIdMap.set(`${lineNumber}:variable:${varName}`, nodeId);
    }

    // Check for destructuring assignments
    const destructureObjMatch = line.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=/);
    if (destructureObjMatch) {
      const destructuredVars = destructureObjMatch[1]!.split(',');
      for (const v of destructuredVars) {
        const varName = v.trim().split(/[=:]/)[0]?.trim();
        if (varName && varName.length > 0) {
          const nodeId = generateNodeId();
          nodes.push({
            id: nodeId,
            type: 'variable',
            location: { file, line: lineNumber },
            name: varName,
            metadata: {
              snippet: line.trim(),
              confidence: 0.85,
            },
          });
          nodeIdMap.set(`${lineNumber}:variable:${varName}`, nodeId);
        }
      }
    }

    const destructureArrMatch = line.match(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/);
    if (destructureArrMatch) {
      const destructuredVars = destructureArrMatch[1]!.split(',');
      for (const v of destructuredVars) {
        const varName = v.trim().split(/[=]/)[0]?.trim();
        if (varName && varName.length > 0) {
          const nodeId = generateNodeId();
          nodes.push({
            id: nodeId,
            type: 'variable',
            location: { file, line: lineNumber },
            name: varName,
            metadata: {
              snippet: line.trim(),
              confidence: 0.85,
            },
          });
          nodeIdMap.set(`${lineNumber}:variable:${varName}`, nodeId);
        }
      }
    }

    // Check for reassignments (not declarations)
    if (!varDeclMatch && !destructureObjMatch && !destructureArrMatch) {
      for (const pattern of ASSIGNMENT_PATTERNS) {
        const match = line.match(pattern);
        if (match && !/^(?:const|let|var)\s/.test(line.trim())) {
          const varName = match[1]?.trim() ?? 'unknown';
          const nodeId = generateNodeId();
          nodes.push({
            id: nodeId,
            type: 'variable',
            location: { file, line: lineNumber },
            name: varName,
            dataType: inferType(line),
            metadata: {
              snippet: line.trim(),
              confidence: 0.9,
            },
          });
          nodeIdMap.set(`${lineNumber}:variable:${varName}`, nodeId);
          break; // Only add once per line
        }
      }
    }

    // Identify function parameters (including class methods)
    const paramMatch = line.match(/function\s+\w*\s*\(([^)]*)\)|(?:const|let|var)?\s*\w*\s*=?\s*\(([^)]*)\)\s*=>|^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/);
    if (paramMatch) {
      const params = (paramMatch[1] ?? paramMatch[2] ?? paramMatch[4] ?? '').split(',');
      for (const param of params) {
        const paramName = param.trim().split(/[=:]/)[0]?.trim();
        if (paramName && paramName.length > 0) {
          const nodeId = generateNodeId();
          nodes.push({
            id: nodeId,
            type: 'parameter',
            location: { file, line: lineNumber },
            name: paramName,
            metadata: {
              snippet: line.trim(),
              confidence: 0.95,
            },
          });
          nodeIdMap.set(`${lineNumber}:parameter:${paramName}`, nodeId);
        }
      }
    }

    // Identify return statements
    const returnMatch = line.match(/\breturn\s+(.+)/);
    if (returnMatch) {
      const nodeId = generateNodeId();
      const returnValue = returnMatch[1]?.replace(/;?\s*$/, '') ?? 'unknown';
      nodes.push({
        id: nodeId,
        type: 'return',
        location: { file, line: lineNumber },
        name: returnValue,
        metadata: {
          snippet: line.trim(),
          confidence: 0.9,
        },
      });
      nodeIdMap.set(`${lineNumber}:return:${returnValue}`, nodeId);
    }
  }

  // Second pass: identify edges based on variable usage
  const variableNodes = nodes.filter(n => n.type === 'variable');
  const variableNames = new Map<string, DataFlowNode[]>();

  for (const node of variableNodes) {
    const existing = variableNames.get(node.name) ?? [];
    existing.push(node);
    variableNames.set(node.name, existing);
  }

  // Create edges for variable reassignments
  variableNames.forEach((nodeList) => {
    if (nodeList.length > 1) {
      nodeList.sort((a, b) => a.location.line - b.location.line);
      for (let i = 0; i < nodeList.length - 1; i++) {
        edges.push({
          from: nodeList[i]!.id,
          to: nodeList[i + 1]!.id,
          transformType: 'assign',
          confidence: 0.8,
        });
      }
    }
  });

  // Create edges from parameters to uses and from uses to returns
  const parameterNodes = nodes.filter(n => n.type === 'parameter');
  const returnNodes = nodes.filter(n => n.type === 'return');

  for (const param of parameterNodes) {
    // Find uses of this parameter
    for (const node of nodes) {
      if (node.type !== 'parameter' && node.metadata?.snippet?.includes(param.name)) {
        if (node.location.line > param.location.line) {
          edges.push({
            from: param.id,
            to: node.id,
            transformType: 'parameter',
            confidence: 0.7,
          });
        }
      }
    }
  }

  // Create edges from transforms/variables to returns
  for (const returnNode of returnNodes) {
    const returnedVar = returnNode.name;
    for (const node of nodes) {
      if (node.id !== returnNode.id &&
          node.name === returnedVar &&
          node.location.line < returnNode.location.line) {
        edges.push({
          from: node.id,
          to: returnNode.id,
          transformType: 'return',
          confidence: 0.8,
        });
      }
    }
  }

  return {
    nodes,
    edges,
    file,
    analyzedAt: new Date().toISOString(),
    confidence: calculateGraphConfidence(nodes, edges),
  };
}

/**
 * Trace the complete lineage of a variable in a file.
 *
 * Answers: "Where does the data in this variable come from and where does it go?"
 */
export function traceDataLineage(
  variable: string,
  file: string,
  content: string
): DataLineage {
  const graph = buildDataFlowGraph(file, content);
  const origins: DataFlowNode[] = [];
  const destinations: DataFlowNode[] = [];
  const transformations: DataFlowEdge[] = [];
  const warnings: string[] = [];

  // Find all nodes related to this variable
  const relevantNodes = graph.nodes.filter(
    n => n.name === variable || n.metadata?.snippet?.includes(variable)
  );

  if (relevantNodes.length === 0) {
    warnings.push(`Variable "${variable}" not found in file`);
    return {
      variable,
      origins: [],
      transformations: [],
      destinations: [],
      confidence: 0,
      warnings,
    };
  }

  // Trace backwards to find origins
  const visited = new Set<string>();
  const queue = [...relevantNodes.map(n => n.id)];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    // Find incoming edges
    const incomingEdges = graph.edges.filter(e => e.to === nodeId);

    if (incomingEdges.length === 0 && node.type === 'source') {
      origins.push(node);
    } else if (incomingEdges.length === 0 && node.type === 'parameter') {
      origins.push(node);
    } else {
      for (const edge of incomingEdges) {
        transformations.push(edge);
        queue.push(edge.from);
      }
    }
  }

  // Trace forwards to find destinations
  visited.clear();
  queue.push(...relevantNodes.map(n => n.id));

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    // Find outgoing edges
    const outgoingEdges = graph.edges.filter(e => e.from === nodeId);

    if (outgoingEdges.length === 0 && (node.type === 'sink' || node.type === 'return')) {
      destinations.push(node);
    } else {
      for (const edge of outgoingEdges) {
        if (!transformations.some(t => t.from === edge.from && t.to === edge.to)) {
          transformations.push(edge);
        }
        queue.push(edge.to);
      }
    }
  }

  // Add last variable node as destination if no explicit sinks found
  if (destinations.length === 0) {
    const lastNode = relevantNodes.sort((a, b) => b.location.line - a.location.line)[0];
    if (lastNode) {
      destinations.push(lastNode);
    }
  }

  return {
    variable,
    origins,
    transformations,
    destinations,
    confidence: calculateLineageConfidence(origins, transformations, destinations),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Trace all state mutations for a variable.
 *
 * Answers: "How does this variable change throughout the code?"
 */
export function traceState(
  variable: string,
  file: string,
  content: string
): StateTrace {
  const lines = content.split('\n');
  const mutations: StateMutation[] = [];
  let declaration: DataFlowLocation | undefined;
  let isDeterministic = true;
  let currentScope: string | undefined;
  let nestingLevel = 0;
  let inConditional = false;
  let currentCondition: string | undefined;

  // Track scope and conditionals
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum] ?? '';
    const lineNumber = lineNum + 1;

    // Track nesting
    nestingLevel += (line.match(/\{/g) ?? []).length;
    nestingLevel -= (line.match(/\}/g) ?? []).length;

    // Track scope (function/method names)
    const functionMatch = line.match(/(?:function|async function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(|\()/);
    if (functionMatch) {
      currentScope = functionMatch[1];
    }

    // Track conditionals
    const conditionalMatch = line.match(/\b(if|else|switch|while|for)\s*\(/);
    if (conditionalMatch) {
      inConditional = true;
      currentCondition = line.trim();
    }

    // Check for declaration
    const declMatch = line.match(new RegExp(`(?:const|let|var)\\s+(${variable})\\s*(?::|=)`));
    if (declMatch) {
      declaration = { file, line: lineNumber };

      // Extract initial value
      const valueMatch = line.match(/=\s*(.+?)(?:;|$)/);
      mutations.push({
        location: { file, line: lineNumber },
        operation: 'declaration',
        value: valueMatch?.[1]?.trim(),
        scope: currentScope,
        conditional: false,
      });
    }

    // Check for assignments (excluding declarations)
    const assignMatch = line.match(new RegExp(`\\b(${variable})\\s*(=|\\+=|-=|\\*=|\\/=|&&=|\\|\\|=|\\?\\?=)\\s*(.+?)(?:;|$)`));
    if (assignMatch && !declMatch) {
      const operation = assignMatch[2] ?? '=';
      const value = assignMatch[3]?.trim();

      mutations.push({
        location: { file, line: lineNumber },
        operation,
        value,
        scope: currentScope,
        conditional: inConditional,
        condition: inConditional ? currentCondition : undefined,
      });

      if (inConditional) {
        isDeterministic = false;
      }
    }

    // Check for method mutations (push, pop, splice, etc.)
    const methodMatch = line.match(new RegExp(`\\b(${variable})\\.(push|pop|shift|unshift|splice|sort|reverse|fill)\\s*\\(`));
    if (methodMatch) {
      mutations.push({
        location: { file, line: lineNumber },
        operation: `.${methodMatch[2]}()`,
        value: extractMethodArgs(line, methodMatch[2] ?? ''),
        scope: currentScope,
        conditional: inConditional,
        condition: inConditional ? currentCondition : undefined,
      });

      if (inConditional) {
        isDeterministic = false;
      }
    }

    // Check for property assignments
    const propMatch = line.match(new RegExp(`\\b(${variable})\\.(\\w+)\\s*=\\s*(.+?)(?:;|$)`));
    if (propMatch) {
      mutations.push({
        location: { file, line: lineNumber },
        operation: `.${propMatch[2]} =`,
        value: propMatch[3]?.trim(),
        scope: currentScope,
        conditional: inConditional,
        condition: inConditional ? currentCondition : undefined,
      });

      if (inConditional) {
        isDeterministic = false;
      }
    }

    // Reset conditional tracking at end of block
    if (nestingLevel === 0) {
      inConditional = false;
      currentCondition = undefined;
    }
  }

  // Determine final state
  const finalState = determineFinalState(variable, mutations);

  return {
    variable,
    declaration,
    mutations,
    finalState,
    deterministic: isDeterministic,
    confidence: mutations.length > 0 ? 0.8 : 0.3,
  };
}

/**
 * Find all data sources for a variable.
 *
 * Answers: "Where does the data in this variable originally come from?"
 */
export function findDataSources(
  variable: string,
  file: string,
  content: string
): DataFlowNode[] {
  const lineage = traceDataLineage(variable, file, content);
  return lineage.origins;
}

/**
 * Find all data sinks for a variable.
 *
 * Answers: "Where does the data in this variable end up?"
 */
export function findDataSinks(
  variable: string,
  file: string,
  content: string
): DataFlowNode[] {
  const lineage = traceDataLineage(variable, file, content);
  return lineage.destinations;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractNodeName(line: string, match: RegExpMatchArray): string {
  // Try to extract a meaningful name from the matched line
  const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
  if (varMatch) return varMatch[1] ?? 'unknown';

  const funcMatch = line.match(/function\s+(\w+)/);
  if (funcMatch) return funcMatch[1] ?? 'unknown';

  const callMatch = line.match(/\.(\w+)\s*\(/);
  if (callMatch) return callMatch[1] ?? 'unknown';

  return match[0]?.trim().slice(0, 30) ?? 'unknown';
}

function isTaintSource(line: string): boolean {
  return /req\.(body|params|query)|process\.env|input\.|form\.|event\.target/.test(line);
}

function isSensitiveSink(line: string): boolean {
  return /\.(query|execute|eval|innerHTML|write|send)\s*\(/.test(line);
}

function isSourceOrSink(line: string): boolean {
  for (const pattern of [...DATA_SOURCE_PATTERNS, ...DATA_SINK_PATTERNS]) {
    if (pattern.test(line)) return true;
  }
  return false;
}

function inferType(line: string): string | undefined {
  // TypeScript type annotations
  const typeMatch = line.match(/:\s*(\w+(?:<[^>]+>)?(?:\[\])?)/);
  if (typeMatch) return typeMatch[1];

  // Infer from literals
  if (/=\s*['"`]/.test(line)) return 'string';
  if (/=\s*\d+(?:\.\d+)?(?!\w)/.test(line)) return 'number';
  if (/=\s*(?:true|false)/.test(line)) return 'boolean';
  if (/=\s*\[/.test(line)) return 'array';
  if (/=\s*\{/.test(line)) return 'object';
  if (/=\s*null/.test(line)) return 'null';
  if (/=\s*new\s+(\w+)/.test(line)) {
    const classMatch = line.match(/=\s*new\s+(\w+)/);
    return classMatch?.[1];
  }

  return undefined;
}

function extractMethodArgs(line: string, method: string): string | undefined {
  const match = line.match(new RegExp(`\\.${method}\\s*\\(([^)]*)`));
  return match?.[1]?.trim();
}

function determineFinalState(variable: string, mutations: StateMutation[]): string {
  if (mutations.length === 0) {
    return 'undefined';
  }

  const lastMutation = mutations[mutations.length - 1]!;

  if (lastMutation.conditional) {
    return `conditionally set to ${lastMutation.value ?? 'unknown'}`;
  }

  if (lastMutation.value) {
    return lastMutation.value;
  }

  return `modified via ${lastMutation.operation}`;
}

function calculateGraphConfidence(nodes: DataFlowNode[], edges: DataFlowEdge[]): number {
  if (nodes.length === 0) return 0;

  // Base confidence from node identification
  const nodeConfidence = nodes.reduce(
    (sum, n) => sum + (n.metadata?.confidence ?? 0.5),
    0
  ) / nodes.length;

  // Edge confidence
  const edgeConfidence = edges.length > 0
    ? edges.reduce((sum, e) => sum + (e.confidence ?? 0.5), 0) / edges.length
    : 0.5;

  // Completeness factor (more edges relative to nodes = more complete graph)
  const completeness = Math.min(1, edges.length / (nodes.length * 0.5));

  return nodeConfidence * 0.4 + edgeConfidence * 0.4 + completeness * 0.2;
}

function calculateLineageConfidence(
  origins: DataFlowNode[],
  transformations: DataFlowEdge[],
  destinations: DataFlowNode[]
): number {
  if (origins.length === 0 && destinations.length === 0) return 0;

  // More complete lineage = higher confidence
  const originConfidence = origins.length > 0 ? 0.3 : 0;
  const destConfidence = destinations.length > 0 ? 0.3 : 0;
  const pathConfidence = transformations.length > 0 ? 0.4 : 0.2;

  return originConfidence + destConfidence + pathConfidence;
}

// ============================================================================
// ADVANCED ANALYSIS
// ============================================================================

/**
 * Find tainted data paths from untrusted sources to sensitive sinks.
 * Critical for security analysis.
 */
export function findTaintedPaths(
  file: string,
  content: string
): Array<{ source: DataFlowNode; sink: DataFlowNode; path: DataFlowEdge[] }> {
  const graph = buildDataFlowGraph(file, content);
  const taintedPaths: Array<{ source: DataFlowNode; sink: DataFlowNode; path: DataFlowEdge[] }> = [];

  // Find all taint sources
  const taintSources = graph.nodes.filter(n => n.metadata?.isTaintSource);

  // Find all sensitive sinks
  const sensitiveSinks = graph.nodes.filter(n => n.metadata?.isSensitiveSink);

  // For each source, try to find a path to each sink
  for (const source of taintSources) {
    for (const sink of sensitiveSinks) {
      const path = findPath(graph, source.id, sink.id);
      if (path.length > 0) {
        taintedPaths.push({ source, sink, path });
      }
    }
  }

  return taintedPaths;
}

/**
 * Find a path between two nodes in the data flow graph using BFS.
 */
function findPath(
  graph: DataFlowGraph,
  fromId: string,
  toId: string
): DataFlowEdge[] {
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; path: DataFlowEdge[] }> = [
    { nodeId: fromId, path: [] },
  ];

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;

    if (nodeId === toId) {
      return path;
    }

    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const outgoing = graph.edges.filter(e => e.from === nodeId);
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        queue.push({ nodeId: edge.to, path: [...path, edge] });
      }
    }
  }

  return [];
}

/**
 * Analyze data flow for potential null/undefined issues.
 */
export function findNullFlowRisks(
  file: string,
  content: string
): Array<{ node: DataFlowNode; risk: string }> {
  const graph = buildDataFlowGraph(file, content);
  const risks: Array<{ node: DataFlowNode; risk: string }> = [];

  for (const node of graph.nodes) {
    const snippet = node.metadata?.snippet ?? '';

    // Check for potential null sources
    if (/\.find\(|\.get\(|\?\.|await\s+fetch/.test(snippet)) {
      const uses = graph.edges.filter(e => e.from === node.id);
      for (const use of uses) {
        const targetNode = graph.nodes.find(n => n.id === use.to);
        if (targetNode && !targetNode.metadata?.snippet?.includes('??') &&
            !targetNode.metadata?.snippet?.includes('?.')) {
          risks.push({
            node: targetNode,
            risk: `Potentially null value from "${node.name}" used without null check`,
          });
        }
      }
    }
  }

  return risks;
}

