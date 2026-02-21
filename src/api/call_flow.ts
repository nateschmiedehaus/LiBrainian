/**
 * @fileoverview Call Flow Handler
 *
 * Provides call flow tracing for queries like "call flow for queryLiBrainian"
 * or "what happens when I call X". Returns proper execution sequences
 * instead of disconnected fragments.
 *
 * This module addresses a gap where call flow queries were returning
 * unordered results instead of the actual execution sequence.
 *
 * Example queries:
 * - "call flow for queryLiBrainian"
 * - "execution path for handleQuery"
 * - "what happens when I call runTests"
 * - "trace execution of bootstrap"
 */

import type { LiBrainianStorage, GraphEdgeQueryOptions } from '../storage/types.js';
import type { FunctionKnowledge, GraphEdge } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A node in the call flow sequence.
 */
export interface CallNode {
  /** Function name */
  function: string;
  /** File path where function is defined */
  file: string;
  /** Line number where function starts */
  line: number;
  /** Functions this node calls */
  callsTo: string[];
  /** Depth in the call tree (0 = entry point) */
  depth: number;
}

/**
 * Result of a call flow trace.
 */
export interface CallFlowResult {
  /** The entry point function */
  entryPoint: string;
  /** The call sequence in execution order */
  sequence: CallNode[];
  /** Human-readable summary of the call flow */
  summary: string;
  /** Maximum depth reached in traversal */
  maxDepth: number;
  /** Whether traversal was truncated due to limits */
  truncated: boolean;
}

/**
 * Result of detecting a call flow query.
 */
export interface CallFlowQueryDetection {
  /** Whether this is a call flow query */
  isCallFlow: boolean;
  /** Extracted entry point name (if detected) */
  entry?: string;
  /** Confidence in the detection (0-1) */
  confidence: number;
  /** The pattern that matched */
  matchedPattern?: string;
}

// ============================================================================
// CALL FLOW DETECTION PATTERNS
// ============================================================================

/**
 * Patterns that indicate a call flow query.
 * Each pattern includes a capture group for the entry point.
 */
const CALL_FLOW_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Direct call flow queries
  {
    pattern: /\bcall\s+flow\s+(?:for|from|of)\s+['"]?(\w+)['"]?/i,
    description: 'call flow for/from/of X',
  },
  {
    pattern: /\bcall\s+graph\s+(?:for|from|of)\s+['"]?(\w+)['"]?/i,
    description: 'call graph for/from/of X',
  },
  // Execution path queries
  {
    pattern: /\bexecution\s+(?:path|flow|trace)\s+(?:for|of|from)\s+['"]?(\w+)['"]?/i,
    description: 'execution path/flow/trace for/of/from X',
  },
  // "What happens when" queries
  {
    pattern: /\bwhat\s+happens\s+when\s+(?:I\s+)?(?:call|run|execute|invoke)\s+['"]?(\w+)['"]?/i,
    description: 'what happens when I call/run/execute X',
  },
  // Trace queries
  {
    pattern: /\btrace\s+(?:the\s+)?(?:execution|calls?)\s+(?:of\s+)?['"]?(\w+)['"]?/i,
    description: 'trace execution/calls of X',
  },
  // "How does X work" with call emphasis
  {
    pattern: /\bhow\s+does\s+['"]?(\w+)['"]?\s+(?:call|invoke|execute)/i,
    description: 'how does X call/invoke',
  },
  // Function call chain
  {
    pattern: /\b(?:function\s+)?call\s+chain\s+(?:for|from|of)\s+['"]?(\w+)['"]?/i,
    description: 'call chain for/from/of X',
  },
  // "What X calls" queries
  {
    pattern: /\bwhat\s+does\s+['"]?(\w+)['"]?\s+call/i,
    description: 'what does X call',
  },
  // "Functions called by X"
  {
    pattern: /\b(?:functions?|methods?)\s+called\s+by\s+['"]?(\w+)['"]?/i,
    description: 'functions called by X',
  },
  // "Show me the call flow"
  {
    pattern: /\bshow\s+(?:me\s+)?(?:the\s+)?call\s+(?:flow|graph|chain)\s+(?:for|of|from)\s+['"]?(\w+)['"]?/i,
    description: 'show call flow/graph/chain for X',
  },
];

// ============================================================================
// CALL FLOW DETECTION
// ============================================================================

/**
 * Detect if a query is asking for a call flow trace.
 *
 * @param intent - The user's query string
 * @returns Detection result with entry point if found
 *
 * @example
 * ```typescript
 * const detection = detectCallFlowQuery("call flow for queryLiBrainian");
 * // { isCallFlow: true, entry: "queryLiBrainian", confidence: 0.9 }
 *
 * const detection = detectCallFlowQuery("what is the purpose of foo");
 * // { isCallFlow: false, confidence: 0 }
 * ```
 */
export function detectCallFlowQuery(intent: string): CallFlowQueryDetection {
  if (!intent || typeof intent !== 'string') {
    return { isCallFlow: false, confidence: 0 };
  }

  const normalizedIntent = intent.trim();

  for (const { pattern, description } of CALL_FLOW_PATTERNS) {
    const match = normalizedIntent.match(pattern);
    if (match && match[1]) {
      return {
        isCallFlow: true,
        entry: cleanEntryPoint(match[1]),
        confidence: 0.9,
        matchedPattern: description,
      };
    }
  }

  // Check for weaker signals
  const hasCallKeyword = /\b(call|invoke|execute|trace|flow|chain)\b/i.test(normalizedIntent);
  const hasSequenceKeyword = /\b(sequence|order|step|path)\b/i.test(normalizedIntent);

  if (hasCallKeyword && hasSequenceKeyword) {
    // Try to extract any function name mentioned
    const funcMatch = normalizedIntent.match(/\b([A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/);
    if (funcMatch) {
      return {
        isCallFlow: true,
        entry: funcMatch[1],
        confidence: 0.6,
        matchedPattern: 'keyword_heuristic',
      };
    }
  }

  return { isCallFlow: false, confidence: 0 };
}

/**
 * Clean and normalize an entry point name.
 */
function cleanEntryPoint(entry: string): string {
  return entry
    .trim()
    .replace(/^["']|["']$/g, '') // Remove quotes
    .replace(/[()]/g, ''); // Remove parentheses
}

// ============================================================================
// CALL FLOW TRACING
// ============================================================================

/**
 * Trace the call flow starting from an entry point function.
 *
 * Performs a depth-first traversal of the call graph, building
 * a sequence of CallNodes that represents the execution order.
 *
 * @param storage - The storage backend with graph edges
 * @param entryPoint - The function name or ID to start from
 * @param maxDepth - Maximum call depth to trace (default: 5)
 * @param maxBreadth - Maximum calls to follow per function (default: 5)
 * @returns The call flow result with sequence
 *
 * @example
 * ```typescript
 * const result = await traceCallFlow(storage, "queryLiBrainian", 5);
 * console.log(result.summary);
 * // "queryLiBrainian -> classifyQueryIntent -> runSymbolLookupStage -> ..."
 * ```
 */
export async function traceCallFlow(
  storage: LiBrainianStorage,
  entryPoint: string,
  maxDepth: number = 5,
  maxBreadth: number = 5
): Promise<CallFlowResult> {
  const visited = new Set<string>();
  const sequence: CallNode[] = [];
  let truncated = false;
  let actualMaxDepth = 0;

  // First, resolve the entry point to a function
  const entryFunc = await resolveFunctionByName(storage, entryPoint);

  if (!entryFunc) {
    return {
      entryPoint,
      sequence: [],
      summary: `Could not find function "${entryPoint}" in the codebase.`,
      maxDepth: 0,
      truncated: false,
    };
  }

  /**
   * Recursively traverse the call graph in DFS order.
   */
  async function traverse(funcId: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      truncated = true;
      return;
    }

    if (visited.has(funcId)) {
      return; // Avoid cycles
    }

    visited.add(funcId);
    actualMaxDepth = Math.max(actualMaxDepth, depth);

    // Get function details
    const func = await storage.getFunction(funcId);
    if (!func) {
      return;
    }

    // Get outgoing call edges
    const callees = await storage.getGraphEdges({
      fromIds: [funcId],
      edgeTypes: ['calls'],
    });

    const calledFunctions = callees
      .slice(0, maxBreadth) // Limit breadth
      .map(e => extractFunctionName(e.toId));

    // Add to sequence
    sequence.push({
      function: func.name,
      file: func.filePath,
      line: func.startLine,
      callsTo: calledFunctions,
      depth,
    });

    // Traverse children (limited to maxBreadth)
    for (const callee of callees.slice(0, maxBreadth)) {
      await traverse(callee.toId, depth + 1);
    }
  }

  // Start traversal from entry point
  await traverse(entryFunc.id, 0);

  // Build summary
  const topLevel = sequence.filter(n => n.depth <= 2);
  const summaryPath = topLevel.map(n => n.function).join(' -> ');
  const summary = sequence.length > 0
    ? `Call flow from ${entryPoint}: ${summaryPath}${topLevel.length < sequence.length ? ' -> ...' : ''}`
    : `No call flow found from ${entryPoint}.`;

  return {
    entryPoint,
    sequence,
    summary,
    maxDepth: actualMaxDepth,
    truncated,
  };
}

/**
 * Resolve a function by name, trying multiple strategies.
 */
async function resolveFunctionByName(
  storage: LiBrainianStorage,
  name: string
): Promise<FunctionKnowledge | null> {
  // Try direct name lookup first
  const byName = await storage.getFunctionsByName(name);
  if (byName.length > 0) {
    return byName[0];
  }

  // Try partial match (for cases like "queryLiBrainian" matching "src/api/query.ts:queryLiBrainian")
  const functions = await storage.getFunctions({ limit: 500 });
  for (const func of functions) {
    if (func.name === name || func.name.toLowerCase() === name.toLowerCase()) {
      return func;
    }
    // Also check if the ID ends with the name
    if (func.id.endsWith(`:${name}`)) {
      return func;
    }
  }

  return null;
}

/**
 * Extract a readable function name from an entity ID.
 */
function extractFunctionName(entityId: string): string {
  // Handle format "file:function"
  if (entityId.includes(':')) {
    return entityId.split(':').pop() ?? entityId;
  }
  // Handle format "path/to/file.ts#function"
  if (entityId.includes('#')) {
    return entityId.split('#').pop() ?? entityId;
  }
  // Handle just a file path - return the filename
  if (entityId.includes('/')) {
    return entityId.split('/').pop()?.replace(/\.[^.]+$/, '') ?? entityId;
  }
  return entityId;
}

// ============================================================================
// CALL FLOW FORMATTING
// ============================================================================

/**
 * Format a call flow result for display.
 *
 * @param result - The call flow result to format
 * @returns Formatted string representation
 */
export function formatCallFlowResult(result: CallFlowResult): string {
  const lines: string[] = [];

  lines.push(`\n=== Call Flow: ${result.entryPoint} ===\n`);

  if (result.sequence.length === 0) {
    lines.push(result.summary);
    return lines.join('\n');
  }

  // Show tree structure
  for (const node of result.sequence) {
    const indent = '  '.repeat(node.depth);
    const callInfo = node.callsTo.length > 0
      ? ` -> [${node.callsTo.join(', ')}]`
      : '';
    lines.push(`${indent}${node.function}${callInfo}`);
    lines.push(`${indent}  @ ${node.file}:${node.line}`);
  }

  lines.push('');
  lines.push(`Max depth: ${result.maxDepth}`);
  lines.push(`Total functions: ${result.sequence.length}`);

  if (result.truncated) {
    lines.push('(Traversal truncated due to depth/breadth limits)');
  }

  return lines.join('\n');
}

/**
 * Convert call flow result to a simple chain string.
 *
 * @param result - The call flow result
 * @param maxItems - Maximum items to include in chain
 * @returns Simple chain like "A -> B -> C"
 */
export function toCallChain(result: CallFlowResult, maxItems: number = 10): string {
  if (result.sequence.length === 0) {
    return result.entryPoint;
  }

  const names = result.sequence.slice(0, maxItems).map(n => n.function);
  const chain = names.join(' -> ');

  if (result.sequence.length > maxItems) {
    return chain + ' -> ...';
  }

  return chain;
}

// ============================================================================
// INTEGRATION HELPERS
// ============================================================================

/**
 * Handle a call flow query and return formatted results.
 *
 * This is the main integration point for the query pipeline.
 *
 * @param storage - The storage backend
 * @param intent - The user's query string
 * @returns Call flow result if applicable, null otherwise
 *
 * @example
 * ```typescript
 * const result = await handleCallFlowQuery(storage, "call flow for queryLiBrainian");
 * if (result) {
 *   console.log(result.summary);
 * }
 * ```
 */
export async function handleCallFlowQuery(
  storage: LiBrainianStorage,
  intent: string
): Promise<CallFlowResult | null> {
  const detection = detectCallFlowQuery(intent);

  if (!detection.isCallFlow || !detection.entry) {
    return null;
  }

  return traceCallFlow(storage, detection.entry);
}

/**
 * Check if a query is a call flow query.
 * Convenience wrapper around detectCallFlowQuery.
 */
export function isCallFlowQuery(intent: string): boolean {
  return detectCallFlowQuery(intent).isCallFlow;
}
