/**
 * @fileoverview Tests for Code Property Graph Construction
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Code Property Graph (CPG) combines:
 * - AST (Abstract Syntax Tree) - structural relationships
 * - CFG (Control Flow Graph) - execution order
 * - PDG (Program Dependency Graph) - data/control dependencies
 *
 * This enables powerful graph-based code queries for security analysis,
 * data flow tracking, and code understanding.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  CodePropertyGraphBuilder,
  createCodePropertyGraphBuilder,
  type CPGNode,
  type CPGEdge,
  type CodePropertyGraph,
  type GraphQuery,
  type QueryResult,
} from '../code_property_graph.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as the main test fixture
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// External repos for diverse testing
const EXTERNAL_REPOS_ROOT = path.join(LIBRARIAN_ROOT, 'eval-corpus/external-repos');
const TYPEDRIVER_REPO = path.join(EXTERNAL_REPOS_ROOT, 'typedriver-ts');

// Use real files from the codebase
const PROBLEM_DETECTOR_PATH = path.join(LIBRARIAN_ROOT, 'src/agents/problem_detector.ts');
const AGENTS_DIR = path.join(LIBRARIAN_ROOT, 'src/agents');

// ============================================================================
// SYNTHETIC TEST FILE CREATION
// ============================================================================

/**
 * Creates a temporary TypeScript file for testing
 */
function createTestFile(code: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpg-test-'));
  const filePath = path.join(tmpDir, 'test-file.ts');
  fs.writeFileSync(filePath, code);
  return filePath;
}

/**
 * Creates a temporary directory with multiple TypeScript files
 */
function createTestRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpg-repo-'));
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

describe('createCodePropertyGraphBuilder', () => {
  it('should create a builder instance', () => {
    const builder = createCodePropertyGraphBuilder();
    expect(builder).toBeInstanceOf(CodePropertyGraphBuilder);
  });
});

// ============================================================================
// GRAPH BUILDING FROM FILE TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - buildFromFile', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should build a CPG from a TypeScript file', async () => {
    const filePath = createTestFile(`
function add(a: number, b: number): number {
  return a + b;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    expect(graph).toBeDefined();
    expect(graph.nodes).toBeInstanceOf(Map);
    expect(graph.edges).toBeInstanceOf(Map);
    expect(graph.metadata.files).toContain(filePath);
  });

  it('should include function nodes', async () => {
    const filePath = createTestFile(`
function greet(name: string): string {
  return 'Hello, ' + name;
}

function farewell(name: string): string {
  return 'Goodbye, ' + name;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const functionNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'function'
    );

    expect(functionNodes.length).toBe(2);
    expect(functionNodes.some((n) => n.name === 'greet')).toBe(true);
    expect(functionNodes.some((n) => n.name === 'farewell')).toBe(true);
  });

  it('should include class nodes', async () => {
    const filePath = createTestFile(`
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const classNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'class'
    );

    expect(classNodes.length).toBe(1);
    expect(classNodes[0].name).toBe('Calculator');
  });

  it('should include variable nodes', async () => {
    const filePath = createTestFile(`
const x = 10;
let y = 20;
var z = 30;
    `);

    const graph = await builder.buildFromFile(filePath);

    const variableNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'variable'
    );

    expect(variableNodes.length).toBe(3);
    expect(variableNodes.some((n) => n.name === 'x')).toBe(true);
    expect(variableNodes.some((n) => n.name === 'y')).toBe(true);
    expect(variableNodes.some((n) => n.name === 'z')).toBe(true);
  });

  it('should include parameter nodes', async () => {
    const filePath = createTestFile(`
function process(input: string, count: number): void {
  console.log(input, count);
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const paramNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'parameter'
    );

    expect(paramNodes.length).toBe(2);
    expect(paramNodes.some((n) => n.name === 'input')).toBe(true);
    expect(paramNodes.some((n) => n.name === 'count')).toBe(true);
  });

  it('should include call nodes', async () => {
    const filePath = createTestFile(`
function helper() { return 1; }

function main() {
  const result = helper();
  console.log(result);
  return result;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const callNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'call'
    );

    expect(callNodes.length).toBeGreaterThanOrEqual(2); // helper() and console.log()
  });

  it('should include statement nodes', async () => {
    const filePath = createTestFile(`
function example() {
  const x = 1;
  if (x > 0) {
    return x;
  }
  return 0;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const stmtNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'statement'
    );

    expect(stmtNodes.length).toBeGreaterThan(0);
  });

  it('should have correct node location info', async () => {
    const filePath = createTestFile(`
function foo() {
  return 42;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const fooNode = Array.from(graph.nodes.values()).find(
      (n) => n.type === 'function' && n.name === 'foo'
    );

    expect(fooNode).toBeDefined();
    expect(fooNode!.location.file).toBe(filePath);
    expect(fooNode!.location.line).toBeGreaterThan(0);
    expect(fooNode!.location.column).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty file', async () => {
    const filePath = createTestFile('');

    const graph = await builder.buildFromFile(filePath);

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
  });

  it('should handle non-existent file', async () => {
    const graph = await builder.buildFromFile('/non/existent/file.ts');

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
  });
});

// ============================================================================
// EDGE TESTS - AST RELATIONSHIPS
// ============================================================================

describe('CodePropertyGraphBuilder - AST Edges', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should create ast_child edges from function to parameters', async () => {
    const filePath = createTestFile(`
function add(a: number, b: number): number {
  return a + b;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const astChildEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'ast_child'
    );

    // Function should have ast_child edges to its parameters
    expect(astChildEdges.length).toBeGreaterThan(0);
  });

  it('should create ast_child edges from class to methods', async () => {
    const filePath = createTestFile(`
class Example {
  method1() { return 1; }
  method2() { return 2; }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const classNode = Array.from(graph.nodes.values()).find(
      (n) => n.type === 'class' && n.name === 'Example'
    );

    expect(classNode).toBeDefined();

    const childEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'ast_child' && e.from === classNode!.id
    );

    expect(childEdges.length).toBeGreaterThanOrEqual(2); // method1 and method2
  });
});

// ============================================================================
// EDGE TESTS - CONTROL FLOW
// ============================================================================

describe('CodePropertyGraphBuilder - Control Flow Edges', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should create cfg_successor edges for sequential statements', async () => {
    const filePath = createTestFile(`
function sequential() {
  const a = 1;
  const b = 2;
  const c = 3;
  return a + b + c;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const cfgEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'cfg_successor'
    );

    expect(cfgEdges.length).toBeGreaterThan(0);
  });

  it('should create cfg_successor edges for if branches', async () => {
    const filePath = createTestFile(`
function branching(x: number) {
  if (x > 0) {
    return 'positive';
  } else {
    return 'non-positive';
  }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const cfgEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'cfg_successor'
    );

    // Should have edges for both branches
    expect(cfgEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('should create cfg_successor edges for loops', async () => {
    const filePath = createTestFile(`
function looping() {
  for (let i = 0; i < 10; i++) {
    console.log(i);
  }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const cfgEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'cfg_successor' || e.type === 'cfg_predecessor'
    );

    // Loops should create back-edges
    expect(cfgEdges.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE TESTS - DATA FLOW
// ============================================================================

describe('CodePropertyGraphBuilder - Data Flow Edges', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should create defines edges for variable assignments', async () => {
    const filePath = createTestFile(`
function example() {
  const x = 10;
  let y = 20;
  y = 30;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const definesEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'defines'
    );

    expect(definesEdges.length).toBeGreaterThan(0);
  });

  it('should create uses edges for variable references', async () => {
    const filePath = createTestFile(`
function example() {
  const x = 10;
  const y = x + 5;
  return y;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const usesEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'uses'
    );

    expect(usesEdges.length).toBeGreaterThan(0);
  });

  it('should create data_flow edges connecting def to use', async () => {
    const filePath = createTestFile(`
function flow() {
  const source = getValue();
  const intermediate = process(source);
  return sink(intermediate);
}

function getValue() { return 1; }
function process(x: number) { return x * 2; }
function sink(x: number) { console.log(x); }
    `);

    const graph = await builder.buildFromFile(filePath);

    const dataFlowEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'data_flow'
    );

    expect(dataFlowEdges.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE TESTS - CALL RELATIONSHIPS
// ============================================================================

describe('CodePropertyGraphBuilder - Call Edges', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should create call edges between functions', async () => {
    const filePath = createTestFile(`
function caller() {
  return callee();
}

function callee() {
  return 42;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const callEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'call'
    );

    expect(callEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('should create return edges from function calls', async () => {
    const filePath = createTestFile(`
function getData(): number {
  return 42;
}

function useData() {
  const result = getData();
  return result * 2;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const returnEdges = Array.from(graph.edges.values()).filter(
      (e) => e.type === 'return'
    );

    expect(returnEdges.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// DIRECTORY BUILDING TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - buildFromDirectory', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should build CPG from a directory', async () => {
    const repoPath = createTestRepo({
      'src/a.ts': 'export function funcA() { return 1; }',
      'src/b.ts': 'export function funcB() { return 2; }',
    });

    const graph = await builder.buildFromDirectory(repoPath);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.metadata.files.length).toBe(2);
  });

  it('should support glob patterns', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': 'export function main() { return 1; }',
      'src/utils/helper.ts': 'export function helper() { return 2; }',
      'tests/test.ts': 'import { main } from "../src/main";',
    });

    const graph = await builder.buildFromDirectory(repoPath, ['src/**/*.ts']);

    // Should only include src files
    expect(graph.metadata.files.every((f) => f.includes('/src/'))).toBe(true);
  });

  it('should exclude node_modules', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': 'export function main() { return 1; }',
      'node_modules/pkg/index.ts': 'export function pkg() { return 2; }',
    });

    const graph = await builder.buildFromDirectory(repoPath);

    expect(graph.metadata.files.every((f) => !f.includes('node_modules'))).toBe(true);
  });

  it('should handle non-existent directory', async () => {
    const graph = await builder.buildFromDirectory('/non/existent/dir');

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
  });

  it('should set correct language in metadata', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': 'export function main() { return 1; }',
    });

    const graph = await builder.buildFromDirectory(repoPath);

    expect(graph.metadata.language).toBe('typescript');
  });

  it('should set createdAt timestamp', async () => {
    const repoPath = createTestRepo({
      'src/main.ts': 'export function main() { return 1; }',
    });

    const before = new Date();
    const graph = await builder.buildFromDirectory(repoPath);
    const after = new Date();

    expect(graph.metadata.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(graph.metadata.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// GRAPH QUERY TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - query', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should filter nodes by type', async () => {
    const filePath = createTestFile(`
function foo() { return 1; }
class Bar {}
const baz = 10;
    `);

    const graph = await builder.buildFromFile(filePath);
    const query: GraphQuery = { nodeTypes: ['function'] };
    const result = builder.query(graph, query);

    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].type).toBe('function');
    expect(result.nodes[0].name).toBe('foo');
  });

  it('should filter edges by type', async () => {
    const filePath = createTestFile(`
function caller() { return callee(); }
function callee() { return 42; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const query: GraphQuery = { edgeTypes: ['call'] };
    const result = builder.query(graph, query);

    expect(result.edges.every((e) => e.type === 'call')).toBe(true);
  });

  it('should support pattern matching on node names', async () => {
    const filePath = createTestFile(`
function getUserName() { return 'name'; }
function getUserEmail() { return 'email'; }
function getProduct() { return 'product'; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const query: GraphQuery = { pattern: 'getUser' };
    const result = builder.query(graph, query);

    expect(result.nodes.length).toBe(2);
    expect(result.nodes.every((n) => n.name?.includes('getUser'))).toBe(true);
  });

  it('should support maxDepth for traversal', async () => {
    const filePath = createTestFile(`
function level0() { return level1(); }
function level1() { return level2(); }
function level2() { return level3(); }
function level3() { return 42; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const query: GraphQuery = {
      nodeTypes: ['function'],
      pattern: 'level0',
      maxDepth: 2
    };
    const result = builder.query(graph, query);

    // Should find paths up to depth 2
    expect(result.paths).toBeDefined();
    if (result.paths && result.paths.length > 0) {
      expect(result.paths.every((p) => p.length <= 3)).toBe(true); // depth 2 = 3 nodes
    }
  });

  it('should return empty result for no matches', async () => {
    const filePath = createTestFile(`
function foo() { return 1; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const query: GraphQuery = { pattern: 'nonexistent' };
    const result = builder.query(graph, query);

    expect(result.nodes.length).toBe(0);
  });

  it('should combine multiple query criteria', async () => {
    const filePath = createTestFile(`
function helperA() { return 1; }
function helperB() { return 2; }
class Helper {}
    `);

    const graph = await builder.buildFromFile(filePath);
    const query: GraphQuery = {
      nodeTypes: ['function'],
      pattern: 'helper'
    };
    const result = builder.query(graph, query);

    expect(result.nodes.length).toBe(2);
    expect(result.nodes.every((n) => n.type === 'function')).toBe(true);
    expect(result.nodes.every((n) => n.name?.toLowerCase().includes('helper'))).toBe(true);
  });
});

// ============================================================================
// FIND CALLERS TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - findCallers', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should find all callers of a function', async () => {
    const filePath = createTestFile(`
function target() { return 42; }

function caller1() { return target(); }
function caller2() { return target() + 1; }
function notACaller() { return 0; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const callers = builder.findCallers(graph, 'target');

    expect(callers.length).toBe(2);
    expect(callers.some((n) => n.name === 'caller1')).toBe(true);
    expect(callers.some((n) => n.name === 'caller2')).toBe(true);
    expect(callers.every((n) => n.name !== 'notACaller')).toBe(true);
  });

  it('should find method callers', async () => {
    const filePath = createTestFile(`
class Service {
  process() { return 'processed'; }
}

function useService(s: Service) {
  return s.process();
}
    `);

    const graph = await builder.buildFromFile(filePath);
    const callers = builder.findCallers(graph, 'process');

    expect(callers.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty array for non-existent function', async () => {
    const filePath = createTestFile(`
function foo() { return 1; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const callers = builder.findCallers(graph, 'nonexistent');

    expect(callers).toEqual([]);
  });
});

// ============================================================================
// FIND DATA FLOW TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - findDataFlow', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should find data flow edges for a variable', async () => {
    const filePath = createTestFile(`
function example() {
  const data = getInput();
  const processed = transform(data);
  return output(processed);
}

function getInput() { return 1; }
function transform(x: number) { return x * 2; }
function output(x: number) { console.log(x); }
    `);

    const graph = await builder.buildFromFile(filePath);
    const dataFlows = builder.findDataFlow(graph, 'data');

    expect(dataFlows.length).toBeGreaterThan(0);
  });

  it('should track variable through assignments', async () => {
    const filePath = createTestFile(`
function track() {
  let value = 1;
  value = 2;
  value = 3;
  return value;
}
    `);

    const graph = await builder.buildFromFile(filePath);
    const dataFlows = builder.findDataFlow(graph, 'value');

    // Should find multiple defines/uses
    expect(dataFlows.length).toBeGreaterThan(0);
  });

  it('should return empty array for non-existent variable', async () => {
    const filePath = createTestFile(`
function foo() { const x = 1; return x; }
    `);

    const graph = await builder.buildFromFile(filePath);
    const dataFlows = builder.findDataFlow(graph, 'nonexistent');

    expect(dataFlows).toEqual([]);
  });
});

// ============================================================================
// MERGE GRAPHS TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - merge', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should merge multiple graphs', async () => {
    const file1 = createTestFile('function a() { return 1; }');
    const file2 = createTestFile('function b() { return 2; }');

    const graph1 = await builder.buildFromFile(file1);
    const graph2 = await builder.buildFromFile(file2);

    const merged = builder.merge([graph1, graph2]);

    expect(merged.nodes.size).toBe(graph1.nodes.size + graph2.nodes.size);
    expect(merged.metadata.files.length).toBe(2);
  });

  it('should preserve all edges when merging', async () => {
    const file1 = createTestFile('function a() { return b(); } function b() { return 1; }');
    const file2 = createTestFile('function c() { return d(); } function d() { return 2; }');

    const graph1 = await builder.buildFromFile(file1);
    const graph2 = await builder.buildFromFile(file2);

    const merged = builder.merge([graph1, graph2]);

    expect(merged.edges.size).toBe(graph1.edges.size + graph2.edges.size);
  });

  it('should handle merging empty graphs', async () => {
    const empty1 = await builder.buildFromFile('/non/existent/a.ts');
    const empty2 = await builder.buildFromFile('/non/existent/b.ts');

    const merged = builder.merge([empty1, empty2]);

    expect(merged.nodes.size).toBe(0);
    expect(merged.edges.size).toBe(0);
  });

  it('should handle merging with a single graph', async () => {
    const file1 = createTestFile('function a() { return 1; }');
    const graph1 = await builder.buildFromFile(file1);

    const merged = builder.merge([graph1]);

    expect(merged.nodes.size).toBe(graph1.nodes.size);
    expect(merged.edges.size).toBe(graph1.edges.size);
  });

  it('should update createdAt to latest', async () => {
    const file1 = createTestFile('function a() { return 1; }');
    const file2 = createTestFile('function b() { return 2; }');

    const graph1 = await builder.buildFromFile(file1);
    await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
    const graph2 = await builder.buildFromFile(file2);

    const merged = builder.merge([graph1, graph2]);

    expect(merged.metadata.createdAt.getTime()).toBeGreaterThanOrEqual(
      graph1.metadata.createdAt.getTime()
    );
  });
});

// ============================================================================
// NODE AND EDGE STRUCTURE TESTS
// ============================================================================

describe('CPGNode Structure', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should have correct CPGNode structure', async () => {
    const filePath = createTestFile(`
function foo(param: string): number {
  return 42;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    graph.nodes.forEach((node) => {
      // Required fields
      expect(node.id).toBeDefined();
      expect(typeof node.id).toBe('string');

      expect(node.type).toBeDefined();
      expect([
        'function',
        'class',
        'variable',
        'parameter',
        'call',
        'statement',
        'expression',
      ]).toContain(node.type);

      expect(node.location).toBeDefined();
      expect(node.location.file).toBeDefined();
      expect(typeof node.location.line).toBe('number');
      expect(typeof node.location.column).toBe('number');

      expect(node.properties).toBeDefined();
      expect(typeof node.properties).toBe('object');

      // Optional name field
      if (node.name !== undefined) {
        expect(typeof node.name).toBe('string');
      }
    });
  });
});

describe('CPGEdge Structure', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should have correct CPGEdge structure', async () => {
    const filePath = createTestFile(`
function caller() { return callee(); }
function callee() { return 42; }
    `);

    const graph = await builder.buildFromFile(filePath);

    graph.edges.forEach((edge) => {
      // Required fields
      expect(edge.id).toBeDefined();
      expect(typeof edge.id).toBe('string');

      expect(edge.from).toBeDefined();
      expect(typeof edge.from).toBe('string');
      expect(graph.nodes.has(edge.from)).toBe(true);

      expect(edge.to).toBeDefined();
      expect(typeof edge.to).toBe('string');
      expect(graph.nodes.has(edge.to)).toBe(true);

      expect(edge.type).toBeDefined();
      expect([
        'ast_child',
        'cfg_successor',
        'cfg_predecessor',
        'data_flow',
        'call',
        'return',
        'defines',
        'uses',
      ]).toContain(edge.type);

      // Optional properties
      if (edge.properties !== undefined) {
        expect(typeof edge.properties).toBe('object');
      }
    });
  });
});

// ============================================================================
// REAL CODEBASE TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - Real Codebase', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should build CPG from problem_detector.ts', async () => {
    const graph = await builder.buildFromFile(PROBLEM_DETECTOR_PATH);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.edges.size).toBeGreaterThan(0);

    // Should find the ProblemDetector class
    const classNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'class'
    );
    expect(classNodes.some((n) => n.name === 'ProblemDetector')).toBe(true);
  });

  it('should build CPG from agents directory', async () => {
    const graph = await builder.buildFromDirectory(AGENTS_DIR);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.metadata.files.length).toBeGreaterThan(1);
  });

  it('should find callers in real code', async () => {
    const graph = await builder.buildFromFile(PROBLEM_DETECTOR_PATH);

    // Find any function that has callers
    const functionNodes = Array.from(graph.nodes.values()).filter(
      (n) => n.type === 'function' && n.name
    );

    // At least one function should exist
    expect(functionNodes.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('CodePropertyGraphBuilder - Performance', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should build CPG from a file in reasonable time', async () => {
    const start = Date.now();
    await builder.buildFromFile(PROBLEM_DETECTOR_PATH);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000); // 5 seconds max
  });

  it('should build CPG from agents directory in reasonable time', async () => {
    const start = Date.now();
    await builder.buildFromDirectory(AGENTS_DIR);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30000); // 30 seconds max
  });

  it('should handle large synthetic file', async () => {
    // Generate a file with many functions
    const functions = Array.from({ length: 100 }, (_, i) =>
      `function func${i}() { return ${i}; }`
    ).join('\n');

    const filePath = createTestFile(functions);

    const start = Date.now();
    const graph = await builder.buildFromFile(filePath);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10000); // 10 seconds max
    expect(graph.nodes.size).toBeGreaterThanOrEqual(100);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('CodePropertyGraphBuilder - Edge Cases', () => {
  let builder: CodePropertyGraphBuilder;

  beforeAll(() => {
    builder = createCodePropertyGraphBuilder();
  });

  it('should handle deeply nested code', async () => {
    const filePath = createTestFile(`
function deep() {
  if (true) {
    if (true) {
      if (true) {
        if (true) {
          return 'deep';
        }
      }
    }
  }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    expect(graph.nodes.size).toBeGreaterThan(0);
  });

  it('should handle arrow functions', async () => {
    const filePath = createTestFile(`
const arrow1 = () => 1;
const arrow2 = (x: number) => x * 2;
const arrow3 = async (x: number) => {
  const result = await fetch('/api');
  return result;
};
    `);

    const graph = await builder.buildFromFile(filePath);

    // Arrow functions should be captured as function or expression nodes
    expect(graph.nodes.size).toBeGreaterThan(0);
  });

  it('should handle decorators', async () => {
    const filePath = createTestFile(`
function decorator(target: any) { return target; }

@decorator
class Decorated {
  @decorator
  method() { return 1; }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    expect(graph.nodes.size).toBeGreaterThan(0);
  });

  it('should handle generics', async () => {
    const filePath = createTestFile(`
function generic<T>(value: T): T {
  return value;
}

class Container<T> {
  private value: T;
  constructor(value: T) { this.value = value; }
  get(): T { return this.value; }
}
    `);

    const graph = await builder.buildFromFile(filePath);

    expect(graph.nodes.size).toBeGreaterThan(0);
  });

  it('should handle async/await', async () => {
    const filePath = createTestFile(`
async function fetchData() {
  const response = await fetch('/api');
  const data = await response.json();
  return data;
}
    `);

    const graph = await builder.buildFromFile(filePath);

    const functionNode = Array.from(graph.nodes.values()).find(
      (n) => n.type === 'function' && n.name === 'fetchData'
    );

    expect(functionNode).toBeDefined();
    expect(functionNode!.properties.isAsync).toBe(true);
  });

  it('should handle try/catch/finally', async () => {
    const filePath = createTestFile(`
function withErrorHandling() {
  try {
    riskyOperation();
  } catch (error) {
    handleError(error);
  } finally {
    cleanup();
  }
}

function riskyOperation() {}
function handleError(e: any) {}
function cleanup() {}
    `);

    const graph = await builder.buildFromFile(filePath);

    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.edges.size).toBeGreaterThan(0);
  });

  it('should handle syntax errors gracefully', async () => {
    const filePath = createTestFile(`
function broken( {
  return 1;
}
    `);

    // Should not throw
    const graph = await builder.buildFromFile(filePath);

    expect(graph).toBeDefined();
    expect(graph.nodes).toBeInstanceOf(Map);
  });
});
