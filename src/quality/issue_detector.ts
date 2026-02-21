/**
 * @fileoverview Quality Issue Detector
 *
 * Detects quality issues from indexed data and populates the issue registry.
 * Called during bootstrap and incremental indexing.
 */

import type { LiBrainianStorage, FunctionKnowledge, FileKnowledge } from '../storage/types.js';
import type { QualityIssue, IssueCategory, IssueSeverity } from './issue_registry.js';

// ============================================================================
// DETECTOR INTERFACE
// ============================================================================

export interface DetectedIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  filePath: string;
  entityId?: string;
  entityName?: string;
  startLine?: number;
  endLine?: number;
  title: string;
  description: string;
  evidence: string[];
  impactScore: number;
  effortMinutes: number;
  suggestedFix?: string;
  automatable: boolean;
  autoFixCommand?: string;
  blockedBy: string[];
  blocks: string[];
}

export interface DetectionContext {
  storage: LiBrainianStorage;
  workspace: string;
}

// ============================================================================
// MAIN DETECTOR
// ============================================================================

/**
 * Run all detectors on the indexed data
 */
export async function detectAllIssues(ctx: DetectionContext): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  // Get all functions and files
  const functions = await ctx.storage.getFunctions({});
  const files = await ctx.storage.getFiles?.({}) || [];

  // Run function-level detectors
  for (const fn of functions) {
    issues.push(...detectFunctionIssues(fn));
  }

  // Run file-level detectors
  for (const file of files) {
    issues.push(...detectFileIssues(file));
  }

  // Run graph-based detectors
  issues.push(...await detectGraphIssues(ctx));

  // Calculate ROI for sorting
  for (const issue of issues) {
    (issue as any).roi = issue.impactScore / Math.max(1, issue.effortMinutes / 60);
  }

  return issues;
}

/**
 * Detect issues for a single file (for incremental updates)
 */
export async function detectFileIssuesIncremental(
  ctx: DetectionContext,
  filePath: string,
): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  // Get functions in this file
  const functions = await ctx.storage.getFunctionsByPath(filePath);
  for (const fn of functions) {
    issues.push(...detectFunctionIssues(fn));
  }

  // Get file record
  const file = await ctx.storage.getFileByPath?.(filePath);
  const files = file ? [file] : [];
  for (const file of files) {
    issues.push(...detectFileIssues(file));
  }

  return issues;
}

// ============================================================================
// FUNCTION-LEVEL DETECTORS
// ============================================================================

function detectFunctionIssues(fn: FunctionKnowledge): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const lines = fn.endLine - fn.startLine;

  // 1. Long Method
  if (lines > 100) {
    issues.push({
      category: 'size',
      severity: lines > 200 ? 'critical' : lines > 150 ? 'major' : 'minor',
      filePath: fn.filePath,
      entityId: fn.id,
      entityName: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      title: `Long method: ${fn.name} (${lines} lines)`,
      description: `This function is ${lines} lines long, exceeding the recommended threshold of 100 lines. Long methods are harder to understand, test, and maintain.`,
      evidence: [
        `Function spans lines ${fn.startLine}-${fn.endLine}`,
        `${lines} lines exceeds threshold of 100`,
      ],
      impactScore: Math.min(1, (lines - 100) / 200), // Scales 0-1 based on severity
      effortMinutes: Math.ceil(lines / 10), // ~6min per 60 lines to refactor
      suggestedFix: 'Extract cohesive blocks into separate functions with single responsibilities',
      automatable: true,
      autoFixCommand: `npx ts-morph-extract ${fn.filePath}:${fn.startLine}`,
      blockedBy: [],
      blocks: [],
    });
  }

  // 2. Too Many Parameters
  const paramMatch = (fn.signature || '').match(/\(([^)]*)\)/);
  const paramCount = paramMatch
    ? paramMatch[1].split(',').filter(p => p.trim()).length
    : 0;

  if (paramCount > 5) {
    issues.push({
      category: 'complexity',
      severity: paramCount > 7 ? 'major' : 'minor',
      filePath: fn.filePath,
      entityId: fn.id,
      entityName: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      title: `Too many parameters: ${fn.name} (${paramCount} params)`,
      description: `This function has ${paramCount} parameters, exceeding the recommended threshold of 5. Too many parameters make functions hard to call correctly and suggest the function may be doing too much.`,
      evidence: [
        `Signature: ${fn.signature}`,
        `${paramCount} parameters exceeds threshold of 5`,
      ],
      impactScore: Math.min(1, (paramCount - 5) / 5),
      effortMinutes: 30,
      suggestedFix: 'Introduce a parameter object or split into multiple functions',
      automatable: false,
      blockedBy: [],
      blocks: [],
    });
  }

  // 3. Low Confidence (understanding gap)
  if (fn.confidence < 0.5) {
    issues.push({
      category: 'documentation',
      severity: fn.confidence < 0.3 ? 'major' : 'minor',
      filePath: fn.filePath,
      entityId: fn.id,
      entityName: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      title: `Low understanding confidence: ${fn.name} (${(fn.confidence * 100).toFixed(0)}%)`,
      description: `The librainian has low confidence in its understanding of this function. This may indicate missing documentation, complex logic, or ambiguous purpose.`,
      evidence: [
        `Confidence score: ${(fn.confidence * 100).toFixed(0)}%`,
        `Threshold: 50%`,
        fn.purpose ? `Current purpose: "${fn.purpose}"` : 'No purpose documented',
      ],
      impactScore: 0.5,
      effortMinutes: 15,
      suggestedFix: 'Add JSDoc documentation explaining purpose, parameters, and return value',
      automatable: false,
      blockedBy: [],
      blocks: [],
    });
  }

  // 4. Missing Purpose (public API) - use heuristics since exported flag not available
  const isLikelyPublicAPI = fn.name[0] === fn.name[0].toUpperCase() ||
                           fn.name.startsWith('get') || fn.name.startsWith('set') ||
                           fn.name.startsWith('create') || fn.name.startsWith('use');
  if (isLikelyPublicAPI && (!fn.purpose || fn.purpose.length < 20)) {
    issues.push({
      category: 'documentation',
      severity: 'minor',
      filePath: fn.filePath,
      entityId: fn.id,
      entityName: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      title: `Missing documentation: ${fn.name}`,
      description: `This function appears to be a public API but lacks adequate documentation. Public APIs should have clear documentation explaining their purpose and usage.`,
      evidence: [
        'Function appears to be a public API based on naming conventions',
        fn.purpose ? `Current purpose: "${fn.purpose}" (${fn.purpose.length} chars)` : 'No purpose documented',
      ],
      impactScore: 0.3,
      effortMinutes: 10,
      suggestedFix: 'Add JSDoc comment with @param and @returns tags',
      automatable: false,
      blockedBy: [],
      blocks: [],
    });
  }

  return issues;
}

// ============================================================================
// FILE-LEVEL DETECTORS
// ============================================================================

function detectFileIssues(file: FileKnowledge): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  // 1. Large File
  if (file.lineCount && file.lineCount > 500) {
    issues.push({
      category: 'size',
      severity: file.lineCount > 1000 ? 'major' : 'minor',
      filePath: file.path,
      title: `Large file: ${file.path} (${file.lineCount} lines)`,
      description: `This file has ${file.lineCount} lines, exceeding the recommended threshold of 500. Large files are harder to navigate and understand.`,
      evidence: [
        `${file.lineCount} lines exceeds threshold of 500`,
      ],
      impactScore: Math.min(1, (file.lineCount - 500) / 1000),
      effortMinutes: Math.ceil(file.lineCount / 50), // ~2min per 100 lines
      suggestedFix: 'Split file into smaller, focused modules',
      automatable: false,
      blockedBy: [],
      blocks: [],
    });
  }

  return issues;
}

// ============================================================================
// GRAPH-BASED DETECTORS
// ============================================================================

async function detectGraphIssues(ctx: DetectionContext): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  try {
    // Get call graph edges
    const edges = await ctx.storage.getGraphEdges?.({ edgeTypes: ['calls'] }) || [];
    const functions = await ctx.storage.getFunctions({});

    // Build caller/callee maps
    const calledBy = new Map<string, string[]>();
    const calls = new Map<string, string[]>();

    for (const edge of edges) {
      if (!calledBy.has(edge.toId)) calledBy.set(edge.toId, []);
      calledBy.get(edge.toId)!.push(edge.fromId);

      if (!calls.has(edge.fromId)) calls.set(edge.fromId, []);
      calls.get(edge.fromId)!.push(edge.toId);
    }

    // 1. High Fan-In (many callers - fragile)
    for (const fn of functions) {
      const callers = calledBy.get(fn.id) || [];
      if (callers.length > 20) {
        issues.push({
          category: 'coupling',
          severity: callers.length > 50 ? 'major' : 'minor',
          filePath: fn.filePath,
          entityId: fn.id,
          entityName: fn.name,
          startLine: fn.startLine,
          endLine: fn.endLine,
          title: `High fan-in: ${fn.name} (${callers.length} callers)`,
          description: `This function is called by ${callers.length} other functions. High fan-in indicates a critical function where changes have wide impact.`,
          evidence: [
            `${callers.length} callers exceeds threshold of 20`,
            'Changes to this function affect many other parts of the codebase',
          ],
          impactScore: 0.7, // High impact if changed
          effortMinutes: 60, // Significant effort to safely modify
          suggestedFix: 'Consider adding a stable interface layer or splitting responsibilities',
          automatable: false,
          blockedBy: [],
          blocks: [],
        });
      }
    }

    // 2. High Fan-Out (calls many things - complex)
    for (const fn of functions) {
      const callees = calls.get(fn.id) || [];
      if (callees.length > 15) {
        issues.push({
          category: 'coupling',
          severity: callees.length > 30 ? 'major' : 'minor',
          filePath: fn.filePath,
          entityId: fn.id,
          entityName: fn.name,
          startLine: fn.startLine,
          endLine: fn.endLine,
          title: `High fan-out: ${fn.name} (calls ${callees.length} functions)`,
          description: `This function calls ${callees.length} other functions. High fan-out indicates a function that does too much or orchestrates too many things.`,
          evidence: [
            `${callees.length} callees exceeds threshold of 15`,
            'This function has too many dependencies',
          ],
          impactScore: 0.5,
          effortMinutes: 45,
          suggestedFix: 'Extract logical groups of calls into helper functions',
          automatable: false,
          blockedBy: [],
          blocks: [],
        });
      }
    }

    // 3. Dead Code Detection (unreachable from entry points)
    const entryPoints = new Set(
      functions
        .filter(fn => isEntryPoint(fn))
        .map(fn => fn.id)
    );

    // BFS from entry points
    const reachable = new Set<string>();
    const queue = [...entryPoints];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      const callees = calls.get(current) || [];
      for (const callee of callees) {
        if (!reachable.has(callee)) {
          queue.push(callee);
        }
      }
    }

    // Functions not reachable and not entry points
    for (const fn of functions) {
      if (!reachable.has(fn.id) && !entryPoints.has(fn.id)) {
        const callers = calledBy.get(fn.id) || [];
        issues.push({
          category: 'dead_code',
          severity: callers.length === 0 ? 'major' : 'minor',
          filePath: fn.filePath,
          entityId: fn.id,
          entityName: fn.name,
          startLine: fn.startLine,
          endLine: fn.endLine,
          title: `Potential dead code: ${fn.name}`,
          description: callers.length === 0
            ? `This function is never called anywhere in the codebase.`
            : `This function is not reachable from any entry point, though it has ${callers.length} internal caller(s).`,
          evidence: [
            callers.length === 0 ? 'No callers found' : `${callers.length} internal callers`,
            'Not reachable from entry points (main, handlers, exports, tests)',
          ],
          impactScore: 0.4,
          effortMinutes: 5, // Quick to delete
          suggestedFix: callers.length === 0
            ? 'Delete this function if truly unused'
            : 'Verify the call path is intentional or delete if obsolete',
          automatable: true,
          autoFixCommand: `# Verify then: git rm ${fn.filePath} # or remove function lines ${fn.startLine}-${fn.endLine}`,
          blockedBy: [],
          blocks: [],
        });
      }
    }

  } catch (error) {
    // Graph data not available, skip graph-based detection
  }

  return issues;
}

// ============================================================================
// HELPERS
// ============================================================================

function isEntryPoint(fn: FunctionKnowledge): boolean {
  // Likely exported functions (heuristic: uppercase first letter or common patterns)
  const isLikelyExported = fn.name[0] === fn.name[0].toUpperCase() ||
                           fn.name.startsWith('export') ||
                           fn.name.startsWith('get') || fn.name.startsWith('set');
  if (isLikelyExported) return true;

  // Main functions
  const mainNames = ['main', 'run', 'start', 'init', 'bootstrap', 'execute', 'handler'];
  if (mainNames.includes(fn.name.toLowerCase())) return true;

  // Event handlers
  if (fn.name.startsWith('on') || fn.name.startsWith('handle')) return true;

  // Test functions
  if (fn.name.includes('test') || fn.name.includes('spec') || fn.name.includes('Test')) return true;

  // CLI/bin paths
  if (fn.filePath.includes('/cli/') || fn.filePath.includes('/bin/')) return true;

  return false;
}
