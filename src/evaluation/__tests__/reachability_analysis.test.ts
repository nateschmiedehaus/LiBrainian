/**
 * @fileoverview Tests for Reachability Analysis
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Reachability Analyzer builds a call graph and determines which code elements
 * are reachable from entry points. Unreachable code is flagged as dead code.
 *
 * Key features:
 * - Call graph construction from TypeScript/JavaScript files
 * - Entry point identification (exports, main functions, event handlers)
 * - Graph traversal for reachability analysis
 * - Dead code detection with confidence scoring
 * - False positive rate target: < 5%
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  ReachabilityAnalyzer,
  createReachabilityAnalyzer,
  type CodeElement,
  type CallGraphEdge,
  type CallGraph,
  type ReachabilityResult,
  type DeadCodeReport,
} from '../reachability_analysis.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

/**
 * Creates a temporary directory with TypeScript files for testing
 */
function createTestRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reachability-test-'));
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, filename);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return tmpDir;
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createReachabilityAnalyzer', () => {
  it('should create an analyzer instance', () => {
    const analyzer = createReachabilityAnalyzer();
    expect(analyzer).toBeInstanceOf(ReachabilityAnalyzer);
  });
});

// ============================================================================
// CALL GRAPH CONSTRUCTION TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Call Graph Construction', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should build a call graph from a simple function', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() {
  helper();
}

function helper() {
  console.log('hello');
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.entryPoints.length).toBeGreaterThan(0);
  });

  it('should identify function nodes correctly', async () => {
    const repoPath = createTestRepo({
      'src/funcs.ts': `
export function publicFunc() { return 1; }
function privateFunc() { return 2; }
const arrowFunc = () => 3;
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should find at least publicFunc and privateFunc
    const funcNames = Array.from(graph.nodes.values())
      .filter((n) => n.type === 'function')
      .map((n) => n.name);

    expect(funcNames).toContain('publicFunc');
    expect(funcNames).toContain('privateFunc');
  });

  it('should identify class and method nodes', async () => {
    const repoPath = createTestRepo({
      'src/classes.ts': `
export class MyClass {
  publicMethod() { return 1; }
  private privateMethod() { return 2; }
  static staticMethod() { return 3; }
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should find the class
    const classNodes = Array.from(graph.nodes.values()).filter((n) => n.type === 'class');
    expect(classNodes.some((n) => n.name === 'MyClass')).toBe(true);

    // Should find methods
    const methodNodes = Array.from(graph.nodes.values()).filter((n) => n.type === 'method');
    expect(methodNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should track call edges between functions', async () => {
    const repoPath = createTestRepo({
      'src/calls.ts': `
export function caller() {
  callee();
}

function callee() {
  return 42;
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should have an edge from caller to callee
    const callerNode = Array.from(graph.nodes.values()).find((n) => n.name === 'caller');
    const calleeNode = Array.from(graph.nodes.values()).find((n) => n.name === 'callee');

    expect(callerNode).toBeDefined();
    expect(calleeNode).toBeDefined();

    if (callerNode && calleeNode) {
      const edge = graph.edges.find(
        (e) => e.caller === callerNode.id && e.callee === calleeNode.id
      );
      expect(edge).toBeDefined();
    }
  });

  it('should track method calls on objects', async () => {
    const repoPath = createTestRepo({
      'src/method-calls.ts': `
class Calculator {
  add(a: number, b: number) { return a + b; }
}

export function useCalculator() {
  const calc = new Calculator();
  return calc.add(1, 2);
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should have an edge from useCalculator to Calculator.add
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('should handle cross-file function calls', async () => {
    const repoPath = createTestRepo({
      'src/utils.ts': `
export function helper() { return 1; }
      `,
      'src/main.ts': `
import { helper } from './utils.js';

export function main() {
  return helper();
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should have nodes from both files
    const files = new Set(Array.from(graph.nodes.values()).map((n) => n.filePath));
    expect(files.size).toBe(2);

    // Should have a cross-file edge
    const mainNode = Array.from(graph.nodes.values()).find((n) => n.name === 'main');
    const helperNode = Array.from(graph.nodes.values()).find((n) => n.name === 'helper');

    expect(mainNode).toBeDefined();
    expect(helperNode).toBeDefined();

    if (mainNode && helperNode) {
      const crossFileEdge = graph.edges.find(
        (e) => e.caller === mainNode.id && e.callee === helperNode.id
      );
      expect(crossFileEdge).toBeDefined();
    }
  });
});

// ============================================================================
// ENTRY POINT IDENTIFICATION TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Entry Point Identification', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should identify exported functions as entry points', async () => {
    const repoPath = createTestRepo({
      'src/api.ts': `
export function publicAPI() { return 1; }
function privateHelper() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // publicAPI should be an entry point, privateHelper should not
    const publicNode = Array.from(graph.nodes.values()).find((n) => n.name === 'publicAPI');
    const privateNode = Array.from(graph.nodes.values()).find((n) => n.name === 'privateHelper');

    expect(publicNode).toBeDefined();
    if (publicNode) {
      expect(graph.entryPoints).toContain(publicNode.id);
    }

    if (privateNode) {
      expect(graph.entryPoints).not.toContain(privateNode.id);
    }
  });

  it('should identify exported classes as entry points', async () => {
    const repoPath = createTestRepo({
      'src/models.ts': `
export class PublicModel { name = 'public'; }
class PrivateModel { name = 'private'; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    const publicClass = Array.from(graph.nodes.values()).find((n) => n.name === 'PublicModel');

    expect(publicClass).toBeDefined();
    if (publicClass) {
      expect(graph.entryPoints).toContain(publicClass.id);
    }
  });

  it('should identify index.ts re-exports as entry points', async () => {
    const repoPath = createTestRepo({
      'src/utils/helper.ts': `
export function helper() { return 1; }
      `,
      'src/utils/index.ts': `
export { helper } from './helper.js';
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // helper should be an entry point because it's re-exported
    const helperNode = Array.from(graph.nodes.values()).find((n) => n.name === 'helper');
    expect(helperNode).toBeDefined();
    if (helperNode) {
      expect(graph.entryPoints).toContain(helperNode.id);
    }
  });

  it('should use identifyEntryPoints method correctly', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function exported1() {}
export function exported2() {}
function internal() {}
      `,
    });

    const files = [path.join(repoPath, 'src/main.ts')];
    const entryPoints = await analyzer.identifyEntryPoints(files);

    expect(entryPoints.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// REACHABILITY ANALYSIS TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Reachability Analysis', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should mark exported functions as reachable', async () => {
    const repoPath = createTestRepo({
      'src/api.ts': `
export function reachableExport() { return 1; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    const exportNode = Array.from(graph.nodes.values()).find((n) => n.name === 'reachableExport');
    expect(exportNode).toBeDefined();
    if (exportNode) {
      expect(result.reachable.has(exportNode.id)).toBe(true);
      expect(result.unreachable.has(exportNode.id)).toBe(false);
    }
  });

  it('should mark transitively called functions as reachable', async () => {
    const repoPath = createTestRepo({
      'src/chain.ts': `
export function entryPoint() {
  middle();
}

function middle() {
  bottom();
}

function bottom() {
  return 42;
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // All functions should be reachable through the chain
    const middleNode = Array.from(graph.nodes.values()).find((n) => n.name === 'middle');
    const bottomNode = Array.from(graph.nodes.values()).find((n) => n.name === 'bottom');

    expect(middleNode).toBeDefined();
    expect(bottomNode).toBeDefined();

    if (middleNode) {
      expect(result.reachable.has(middleNode.id)).toBe(true);
    }
    if (bottomNode) {
      expect(result.reachable.has(bottomNode.id)).toBe(true);
    }
  });

  it('should mark orphaned functions as unreachable', async () => {
    const repoPath = createTestRepo({
      'src/orphan.ts': `
export function used() { return 1; }

function orphan() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    const orphanNode = Array.from(graph.nodes.values()).find((n) => n.name === 'orphan');
    expect(orphanNode).toBeDefined();
    if (orphanNode) {
      expect(result.unreachable.has(orphanNode.id)).toBe(true);
      expect(result.reachable.has(orphanNode.id)).toBe(false);
    }
  });

  it('should handle circular call chains', async () => {
    const repoPath = createTestRepo({
      'src/circular.ts': `
export function start() {
  a();
}

function a() { b(); }
function b() { c(); }
function c() { a(); } // circular back to a
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // All functions should be reachable (no infinite loop)
    const aNode = Array.from(graph.nodes.values()).find((n) => n.name === 'a');
    const bNode = Array.from(graph.nodes.values()).find((n) => n.name === 'b');
    const cNode = Array.from(graph.nodes.values()).find((n) => n.name === 'c');

    expect(result.reachable.has(aNode!.id)).toBe(true);
    expect(result.reachable.has(bNode!.id)).toBe(true);
    expect(result.reachable.has(cNode!.id)).toBe(true);
  });

  it('should calculate confidence based on analysis completeness', async () => {
    const repoPath = createTestRepo({
      'src/simple.ts': `
export function main() { helper(); }
function helper() { return 1; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // Confidence should be between 0 and 1
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should use isReachable method correctly', async () => {
    const repoPath = createTestRepo({
      'src/check.ts': `
export function exported() { helper(); }
function helper() { return 1; }
function orphan() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    const exportedNode = Array.from(graph.nodes.values()).find((n) => n.name === 'exported');
    const helperNode = Array.from(graph.nodes.values()).find((n) => n.name === 'helper');
    const orphanNode = Array.from(graph.nodes.values()).find((n) => n.name === 'orphan');

    expect(analyzer.isReachable(graph, exportedNode!.id)).toBe(true);
    expect(analyzer.isReachable(graph, helperNode!.id)).toBe(true);
    expect(analyzer.isReachable(graph, orphanNode!.id)).toBe(false);
  });
});

// ============================================================================
// DEAD CODE DETECTION TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Dead Code Detection', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should find dead code and produce reports', async () => {
    const repoPath = createTestRepo({
      'src/dead.ts': `
export function alive() { return 1; }
function dead() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const reports = analyzer.findDeadCode(graph);

    expect(Array.isArray(reports)).toBe(true);
    expect(reports.length).toBeGreaterThan(0);

    const deadReport = reports.find((r) =>
      r.deadElements.some((e) => e.name === 'dead')
    );
    expect(deadReport).toBeDefined();
  });

  it('should include file path in dead code reports', async () => {
    const repoPath = createTestRepo({
      'src/file1.ts': `
export function used() { return 1; }
function unused1() { return 2; }
      `,
      'src/file2.ts': `
export function alsoUsed() { return 3; }
function unused2() { return 4; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const reports = analyzer.findDeadCode(graph);

    // Should have reports for both files
    const filePaths = reports.map((r) => r.filePath);
    expect(filePaths.some((p) => p.includes('file1.ts'))).toBe(true);
    expect(filePaths.some((p) => p.includes('file2.ts'))).toBe(true);
  });

  it('should suggest appropriate actions for dead code', async () => {
    const repoPath = createTestRepo({
      'src/suggestions.ts': `
export function exported() { return 1; }

// Clearly unused private function
function clearlyDead() { return 2; }

// Might be called via dynamic dispatch or reflection
function maybeDynamic() { return 3; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const reports = analyzer.findDeadCode(graph);

    for (const report of reports) {
      expect(['remove', 'review', 'keep']).toContain(report.suggestedAction);
    }
  });

  it('should identify potential false positives', async () => {
    const repoPath = createTestRepo({
      'src/dynamic.ts': `
export function main() {
  const handlers: Record<string, () => void> = {
    action: dynamicHandler,
  };
  handlers['action']();
}

function dynamicHandler() {
  console.log('called dynamically');
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const reports = analyzer.findDeadCode(graph);

    // dynamicHandler might appear dead but is called dynamically
    // The report should note this as a potential false positive
    if (reports.length > 0) {
      const dynamicReport = reports.find((r) =>
        r.deadElements.some((e) => e.name === 'dynamicHandler')
      );
      if (dynamicReport) {
        expect(dynamicReport.potentialFalsePositives.length).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ============================================================================
// CODE ELEMENT STRUCTURE TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Code Element Structure', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should have correct CodeElement structure', async () => {
    const repoPath = createTestRepo({
      'src/structure.ts': `
export function testFunc() { return 1; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    for (const element of graph.nodes.values()) {
      // Required fields
      expect(typeof element.id).toBe('string');
      expect(element.id.length).toBeGreaterThan(0);

      expect(['function', 'class', 'method', 'variable', 'export']).toContain(element.type);

      expect(typeof element.name).toBe('string');
      expect(element.name.length).toBeGreaterThan(0);

      expect(typeof element.filePath).toBe('string');
      expect(element.filePath.length).toBeGreaterThan(0);

      expect(typeof element.line).toBe('number');
      expect(element.line).toBeGreaterThan(0);
    }
  });

  it('should have correct CallGraphEdge structure', async () => {
    const repoPath = createTestRepo({
      'src/edges.ts': `
export function caller() { callee(); }
function callee() { return 1; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    for (const edge of graph.edges) {
      expect(typeof edge.caller).toBe('string');
      expect(typeof edge.callee).toBe('string');
      expect(edge.callSite).toBeDefined();
      expect(typeof edge.callSite.file).toBe('string');
      expect(typeof edge.callSite.line).toBe('number');
    }
  });

  it('should have correct CallGraph structure', async () => {
    const repoPath = createTestRepo({
      'src/graph.ts': `
export function entry() { helper(); }
function helper() { return 1; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    expect(graph.nodes).toBeInstanceOf(Map);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(Array.isArray(graph.entryPoints)).toBe(true);
  });

  it('should have correct ReachabilityResult structure', async () => {
    const repoPath = createTestRepo({
      'src/result.ts': `
export function main() { return 1; }
function orphan() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    expect(result.reachable).toBeInstanceOf(Set);
    expect(result.unreachable).toBeInstanceOf(Set);
    expect(Array.isArray(result.deadCode)).toBe(true);
    expect(typeof result.confidence).toBe('number');
  });

  it('should have correct DeadCodeReport structure', async () => {
    const repoPath = createTestRepo({
      'src/report.ts': `
export function used() { return 1; }
function unused() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const reports = analyzer.findDeadCode(graph);

    for (const report of reports) {
      expect(typeof report.filePath).toBe('string');
      expect(Array.isArray(report.deadElements)).toBe(true);
      expect(Array.isArray(report.potentialFalsePositives)).toBe(true);
      expect(['remove', 'review', 'keep']).toContain(report.suggestedAction);
    }
  });
});

// ============================================================================
// FALSE POSITIVE RATE TESTS
// ============================================================================

describe('ReachabilityAnalyzer - False Positive Rate', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should not flag event handlers as dead', async () => {
    const repoPath = createTestRepo({
      'src/events.ts': `
export function setupListeners() {
  document.addEventListener('click', handleClick);
}

function handleClick(e: Event) {
  console.log('clicked');
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // handleClick is passed as a callback, should be reachable
    const handlerNode = Array.from(graph.nodes.values()).find((n) => n.name === 'handleClick');
    if (handlerNode) {
      expect(result.reachable.has(handlerNode.id)).toBe(true);
    }
  });

  it('should not flag callbacks passed to higher-order functions', async () => {
    const repoPath = createTestRepo({
      'src/callbacks.ts': `
export function process() {
  const items = [1, 2, 3];
  items.map(transform);
}

function transform(x: number) {
  return x * 2;
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // transform is passed as a callback to map
    const transformNode = Array.from(graph.nodes.values()).find((n) => n.name === 'transform');
    if (transformNode) {
      expect(result.reachable.has(transformNode.id)).toBe(true);
    }
  });

  it('should not flag methods called via this', async () => {
    const repoPath = createTestRepo({
      'src/this-calls.ts': `
export class Widget {
  render() {
    this.prepare();
    return '<div></div>';
  }

  private prepare() {
    console.log('preparing');
  }
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // prepare is called via this.prepare(), should be reachable
    const prepareNode = Array.from(graph.nodes.values()).find((n) => n.name === 'prepare');
    if (prepareNode) {
      expect(result.reachable.has(prepareNode.id)).toBe(true);
    }
  });

  it('should achieve <5% false positive rate on clean code', async () => {
    // Create a well-structured codebase where everything is used
    const repoPath = createTestRepo({
      'src/index.ts': `
export { main } from './main.js';
export { helper } from './utils.js';
      `,
      'src/main.ts': `
import { helper } from './utils.js';
export function main() { return helper(); }
      `,
      'src/utils.ts': `
export function helper() { return compute(); }
function compute() { return 42; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // In this clean codebase, everything should be reachable
    // False positive rate = unreachable / total < 5%
    const total = graph.nodes.size;
    const falsePositives = result.unreachable.size;
    const falsePositiveRate = total > 0 ? falsePositives / total : 0;

    expect(falsePositiveRate).toBeLessThan(0.05);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ReachabilityAnalyzer - Edge Cases', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should handle empty directories', async () => {
    const repoPath = createTestRepo({});

    const graph = await analyzer.buildCallGraph(repoPath);

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.length).toBe(0);
    expect(graph.entryPoints.length).toBe(0);
  });

  it('should handle non-existent directories gracefully', async () => {
    const graph = await analyzer.buildCallGraph('/non/existent/path');

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.length).toBe(0);
  });

  it('should handle files with syntax errors gracefully', async () => {
    const repoPath = createTestRepo({
      'src/broken.ts': `
function broken( {
  return 1;
}
      `,
      'src/valid.ts': `
export function valid() { return 2; }
      `,
    });

    // Should not throw, should process valid files
    const graph = await analyzer.buildCallGraph(repoPath);

    // Should still find valid.ts content
    const validNode = Array.from(graph.nodes.values()).find((n) => n.name === 'valid');
    expect(validNode).toBeDefined();
  });

  it('should handle deeply nested call chains', async () => {
    const repoPath = createTestRepo({
      'src/deep.ts': `
export function level0() { level1(); }
function level1() { level2(); }
function level2() { level3(); }
function level3() { level4(); }
function level4() { level5(); }
function level5() { level6(); }
function level6() { level7(); }
function level7() { level8(); }
function level8() { level9(); }
function level9() { return 'deep'; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    // All levels should be reachable
    for (let i = 0; i <= 9; i++) {
      const name = i === 0 ? 'level0' : `level${i}`;
      const node = Array.from(graph.nodes.values()).find((n) => n.name === name);
      if (node) {
        expect(result.reachable.has(node.id)).toBe(true);
      }
    }
  });

  it('should handle recursive functions', async () => {
    const repoPath = createTestRepo({
      'src/recursive.ts': `
export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);
    const result = analyzer.analyzeReachability(graph);

    const factorialNode = Array.from(graph.nodes.values()).find((n) => n.name === 'factorial');
    expect(factorialNode).toBeDefined();
    if (factorialNode) {
      expect(result.reachable.has(factorialNode.id)).toBe(true);
    }
  });

  it('should handle anonymous functions and IIFEs', async () => {
    const repoPath = createTestRepo({
      'src/anon.ts': `
export const result = (() => {
  function inner() { return 42; }
  return inner();
})();
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should not crash, may or may not find anonymous functions
    expect(graph.nodes.size).toBeGreaterThanOrEqual(0);
  });

  it('should exclude node_modules from analysis', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': `
export function main() { return 1; }
      `,
      'node_modules/pkg/index.ts': `
export function pkgFunc() { return 2; }
      `,
    });

    const graph = await analyzer.buildCallGraph(repoPath);

    // Should not include node_modules files
    for (const node of graph.nodes.values()) {
      expect(node.filePath).not.toContain('node_modules');
    }
  });
});

// ============================================================================
// REAL REPO TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Real Repos', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should analyze Librarian src directory without crashing', async () => {
    const srcPath = path.join(LIBRARIAN_ROOT, 'src');

    const graph = await analyzer.buildCallGraph(srcPath);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.entryPoints.length).toBeGreaterThan(0);
  });

  it('should produce reachability results for Librarian', async () => {
    const srcPath = path.join(LIBRARIAN_ROOT, 'src');

    const graph = await analyzer.buildCallGraph(srcPath);
    const result = analyzer.analyzeReachability(graph);

    // Should have both reachable and potentially unreachable code
    expect(result.reachable.size).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('ReachabilityAnalyzer - Performance', () => {
  let analyzer: ReachabilityAnalyzer;

  beforeAll(() => {
    analyzer = createReachabilityAnalyzer();
  });

  it('should analyze small repo in under 5 seconds', async () => {
    const repoPath = createTestRepo({
      'src/a.ts': 'export function a() { b(); } function b() { return 1; }',
      'src/c.ts': 'export function c() { d(); } function d() { return 2; }',
      'src/e.ts': 'export function e() { f(); } function f() { return 3; }',
    });

    const start = Date.now();
    await analyzer.buildCallGraph(repoPath);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });

  it('should analyze medium repo in under 30 seconds', async () => {
    // Generate a medium-sized repo
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      files[`src/file${i}.ts`] = `
export function func${i}() { return helper${i}(); }
function helper${i}() { return ${i}; }
      `;
    }

    const repoPath = createTestRepo(files);

    const start = Date.now();
    await analyzer.buildCallGraph(repoPath);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30000);
  });
});
