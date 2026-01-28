/**
 * @fileoverview Tests for RepoGraph Integration
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * RepoGraph provides repository-wide navigation structure per the
 * RepoGraph (ICLR 2025) approach. It builds a graph representation
 * of the codebase that captures:
 * - File system structure (directories, files)
 * - Code entities (functions, classes, modules)
 * - Cross-file relationships (imports, exports, calls, extends, implements)
 *
 * This enables powerful navigation and exploration of codebases.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  createRepoGraph,
  type RepoNode,
  type RepoEdge,
  type RepoGraph,
} from '../repo_graph.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Librarian repo as the main test fixture
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// Use real files from the codebase
const EVALUATION_DIR = path.join(LIBRARIAN_ROOT, 'src/evaluation');
const AGENTS_DIR = path.join(LIBRARIAN_ROOT, 'src/agents');

// ============================================================================
// SYNTHETIC TEST FILE CREATION
// ============================================================================

/**
 * Creates a temporary TypeScript file for testing
 */
function createTestFile(code: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-graph-test-'));
  const filePath = path.join(tmpDir, 'test-file.ts');
  fs.writeFileSync(filePath, code);
  return filePath;
}

/**
 * Creates a temporary directory with multiple TypeScript files
 */
function createTestRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-graph-repo-'));
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

describe('createRepoGraph', () => {
  it('should create a RepoGraph instance', () => {
    const graph = createRepoGraph();
    expect(graph).toBeDefined();
    expect(typeof graph.addNode).toBe('function');
    expect(typeof graph.addEdge).toBe('function');
    expect(typeof graph.getNode).toBe('function');
    expect(typeof graph.getNeighbors).toBe('function');
    expect(typeof graph.findPath).toBe('function');
    expect(typeof graph.getSubgraph).toBe('function');
    expect(typeof graph.serialize).toBe('function');
    expect(typeof graph.deserialize).toBe('function');
  });
});

// ============================================================================
// NODE MANAGEMENT TESTS
// ============================================================================

describe('RepoGraph - Node Management', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();
  });

  it('should add a file node', () => {
    const node: RepoNode = {
      id: 'file-1',
      type: 'file',
      path: '/src/index.ts',
      name: 'index.ts',
      metadata: { language: 'typescript' },
    };

    graph.addNode(node);
    const retrieved = graph.getNode('file-1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('file-1');
    expect(retrieved?.type).toBe('file');
    expect(retrieved?.path).toBe('/src/index.ts');
    expect(retrieved?.name).toBe('index.ts');
  });

  it('should add a directory node', () => {
    const node: RepoNode = {
      id: 'dir-1',
      type: 'directory',
      path: '/src',
      name: 'src',
      metadata: {},
    };

    graph.addNode(node);
    const retrieved = graph.getNode('dir-1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe('directory');
  });

  it('should add a function node', () => {
    const node: RepoNode = {
      id: 'func-1',
      type: 'function',
      path: '/src/utils.ts',
      name: 'processData',
      metadata: { isAsync: true, paramCount: 2 },
    };

    graph.addNode(node);
    const retrieved = graph.getNode('func-1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe('function');
    expect(retrieved?.metadata.isAsync).toBe(true);
  });

  it('should add a class node', () => {
    const node: RepoNode = {
      id: 'class-1',
      type: 'class',
      path: '/src/models/User.ts',
      name: 'User',
      metadata: { isAbstract: false, methodCount: 5 },
    };

    graph.addNode(node);
    const retrieved = graph.getNode('class-1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe('class');
  });

  it('should add a module node', () => {
    const node: RepoNode = {
      id: 'module-1',
      type: 'module',
      path: '/src/utils',
      name: 'utils',
      metadata: { exportCount: 10 },
    };

    graph.addNode(node);
    const retrieved = graph.getNode('module-1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe('module');
  });

  it('should return undefined for non-existent node', () => {
    const retrieved = graph.getNode('non-existent');
    expect(retrieved).toBeUndefined();
  });

  it('should overwrite node with same id', () => {
    const node1: RepoNode = {
      id: 'file-1',
      type: 'file',
      path: '/src/old.ts',
      name: 'old.ts',
      metadata: {},
    };

    const node2: RepoNode = {
      id: 'file-1',
      type: 'file',
      path: '/src/new.ts',
      name: 'new.ts',
      metadata: {},
    };

    graph.addNode(node1);
    graph.addNode(node2);

    const retrieved = graph.getNode('file-1');
    expect(retrieved?.path).toBe('/src/new.ts');
    expect(retrieved?.name).toBe('new.ts');
  });
});

// ============================================================================
// EDGE MANAGEMENT TESTS
// ============================================================================

describe('RepoGraph - Edge Management', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();

    // Add some nodes for edge tests
    graph.addNode({
      id: 'file-a',
      type: 'file',
      path: '/src/a.ts',
      name: 'a.ts',
      metadata: {},
    });
    graph.addNode({
      id: 'file-b',
      type: 'file',
      path: '/src/b.ts',
      name: 'b.ts',
      metadata: {},
    });
    graph.addNode({
      id: 'func-a',
      type: 'function',
      path: '/src/a.ts',
      name: 'funcA',
      metadata: {},
    });
    graph.addNode({
      id: 'func-b',
      type: 'function',
      path: '/src/b.ts',
      name: 'funcB',
      metadata: {},
    });
  });

  it('should add an imports edge', () => {
    const edge: RepoEdge = {
      source: 'file-a',
      target: 'file-b',
      type: 'imports',
      weight: 1.0,
    };

    graph.addEdge(edge);
    const neighbors = graph.getNeighbors('file-a');

    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('file-b');
  });

  it('should add an exports edge', () => {
    const edge: RepoEdge = {
      source: 'file-a',
      target: 'func-a',
      type: 'exports',
      weight: 1.0,
    };

    graph.addEdge(edge);
    const neighbors = graph.getNeighbors('file-a');

    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('func-a');
  });

  it('should add a contains edge', () => {
    graph.addNode({
      id: 'dir-src',
      type: 'directory',
      path: '/src',
      name: 'src',
      metadata: {},
    });

    const edge: RepoEdge = {
      source: 'dir-src',
      target: 'file-a',
      type: 'contains',
      weight: 1.0,
    };

    graph.addEdge(edge);
    const neighbors = graph.getNeighbors('dir-src');

    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('file-a');
  });

  it('should add a calls edge', () => {
    const edge: RepoEdge = {
      source: 'func-a',
      target: 'func-b',
      type: 'calls',
      weight: 1.0,
    };

    graph.addEdge(edge);
    const neighbors = graph.getNeighbors('func-a');

    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('func-b');
  });

  it('should add an extends edge', () => {
    graph.addNode({
      id: 'class-base',
      type: 'class',
      path: '/src/base.ts',
      name: 'Base',
      metadata: {},
    });
    graph.addNode({
      id: 'class-derived',
      type: 'class',
      path: '/src/derived.ts',
      name: 'Derived',
      metadata: {},
    });

    const edge: RepoEdge = {
      source: 'class-derived',
      target: 'class-base',
      type: 'extends',
      weight: 1.0,
    };

    graph.addEdge(edge);
    const neighbors = graph.getNeighbors('class-derived');

    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('class-base');
  });

  it('should add an implements edge', () => {
    graph.addNode({
      id: 'interface-shape',
      type: 'class',
      path: '/src/shape.ts',
      name: 'Shape',
      metadata: { isInterface: true },
    });
    graph.addNode({
      id: 'class-circle',
      type: 'class',
      path: '/src/circle.ts',
      name: 'Circle',
      metadata: {},
    });

    const edge: RepoEdge = {
      source: 'class-circle',
      target: 'interface-shape',
      type: 'implements',
      weight: 1.0,
    };

    graph.addEdge(edge);
    const neighbors = graph.getNeighbors('class-circle');

    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('interface-shape');
  });

  it('should support multiple edges from same node', () => {
    graph.addEdge({
      source: 'file-a',
      target: 'file-b',
      type: 'imports',
      weight: 1.0,
    });
    graph.addEdge({
      source: 'file-a',
      target: 'func-a',
      type: 'contains',
      weight: 1.0,
    });

    const neighbors = graph.getNeighbors('file-a');
    expect(neighbors.length).toBe(2);
  });

  it('should filter neighbors by edge type', () => {
    graph.addEdge({
      source: 'file-a',
      target: 'file-b',
      type: 'imports',
      weight: 1.0,
    });
    graph.addEdge({
      source: 'file-a',
      target: 'func-a',
      type: 'contains',
      weight: 1.0,
    });

    const importNeighbors = graph.getNeighbors('file-a', 'imports');
    expect(importNeighbors.length).toBe(1);
    expect(importNeighbors[0].id).toBe('file-b');

    const containsNeighbors = graph.getNeighbors('file-a', 'contains');
    expect(containsNeighbors.length).toBe(1);
    expect(containsNeighbors[0].id).toBe('func-a');
  });

  it('should return empty array for node with no edges', () => {
    const neighbors = graph.getNeighbors('file-a');
    expect(neighbors).toEqual([]);
  });

  it('should return empty array for non-existent node', () => {
    const neighbors = graph.getNeighbors('non-existent');
    expect(neighbors).toEqual([]);
  });
});

// ============================================================================
// PATH FINDING TESTS
// ============================================================================

describe('RepoGraph - Path Finding', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();

    // Build a simple graph: A -> B -> C -> D
    graph.addNode({ id: 'A', type: 'file', path: '/a.ts', name: 'a.ts', metadata: {} });
    graph.addNode({ id: 'B', type: 'file', path: '/b.ts', name: 'b.ts', metadata: {} });
    graph.addNode({ id: 'C', type: 'file', path: '/c.ts', name: 'c.ts', metadata: {} });
    graph.addNode({ id: 'D', type: 'file', path: '/d.ts', name: 'd.ts', metadata: {} });

    graph.addEdge({ source: 'A', target: 'B', type: 'imports', weight: 1.0 });
    graph.addEdge({ source: 'B', target: 'C', type: 'imports', weight: 1.0 });
    graph.addEdge({ source: 'C', target: 'D', type: 'imports', weight: 1.0 });
  });

  it('should find direct path between adjacent nodes', () => {
    const path = graph.findPath('A', 'B');

    expect(path.length).toBe(2);
    expect(path[0].id).toBe('A');
    expect(path[1].id).toBe('B');
  });

  it('should find path through multiple nodes', () => {
    const path = graph.findPath('A', 'D');

    expect(path.length).toBe(4);
    expect(path[0].id).toBe('A');
    expect(path[1].id).toBe('B');
    expect(path[2].id).toBe('C');
    expect(path[3].id).toBe('D');
  });

  it('should return empty path for unreachable nodes', () => {
    graph.addNode({ id: 'E', type: 'file', path: '/e.ts', name: 'e.ts', metadata: {} });
    // E is not connected to any other node

    const path = graph.findPath('A', 'E');
    expect(path).toEqual([]);
  });

  it('should return path with single node when from equals to', () => {
    const path = graph.findPath('A', 'A');

    expect(path.length).toBe(1);
    expect(path[0].id).toBe('A');
  });

  it('should return empty path for non-existent source', () => {
    const path = graph.findPath('non-existent', 'A');
    expect(path).toEqual([]);
  });

  it('should return empty path for non-existent target', () => {
    const path = graph.findPath('A', 'non-existent');
    expect(path).toEqual([]);
  });

  it('should handle cycles in graph', () => {
    // Add a cycle: D -> A
    graph.addEdge({ source: 'D', target: 'A', type: 'imports', weight: 1.0 });

    // Should still find shortest path without infinite loop
    const path = graph.findPath('A', 'D');

    expect(path.length).toBeGreaterThan(0);
    expect(path[0].id).toBe('A');
    expect(path[path.length - 1].id).toBe('D');
  });
});

// ============================================================================
// SUBGRAPH EXTRACTION TESTS
// ============================================================================

describe('RepoGraph - Subgraph Extraction', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();

    // Build a tree-like structure
    // Root -> A, B
    // A -> A1, A2
    // B -> B1, B2
    graph.addNode({ id: 'root', type: 'directory', path: '/', name: 'root', metadata: {} });
    graph.addNode({ id: 'A', type: 'directory', path: '/A', name: 'A', metadata: {} });
    graph.addNode({ id: 'B', type: 'directory', path: '/B', name: 'B', metadata: {} });
    graph.addNode({ id: 'A1', type: 'file', path: '/A/a1.ts', name: 'a1.ts', metadata: {} });
    graph.addNode({ id: 'A2', type: 'file', path: '/A/a2.ts', name: 'a2.ts', metadata: {} });
    graph.addNode({ id: 'B1', type: 'file', path: '/B/b1.ts', name: 'b1.ts', metadata: {} });
    graph.addNode({ id: 'B2', type: 'file', path: '/B/b2.ts', name: 'b2.ts', metadata: {} });

    graph.addEdge({ source: 'root', target: 'A', type: 'contains', weight: 1.0 });
    graph.addEdge({ source: 'root', target: 'B', type: 'contains', weight: 1.0 });
    graph.addEdge({ source: 'A', target: 'A1', type: 'contains', weight: 1.0 });
    graph.addEdge({ source: 'A', target: 'A2', type: 'contains', weight: 1.0 });
    graph.addEdge({ source: 'B', target: 'B1', type: 'contains', weight: 1.0 });
    graph.addEdge({ source: 'B', target: 'B2', type: 'contains', weight: 1.0 });
  });

  it('should extract subgraph at depth 0 (root only)', () => {
    const subgraph = graph.getSubgraph('root', 0);

    expect(subgraph.nodes.length).toBe(1);
    expect(subgraph.nodes[0].id).toBe('root');
    expect(subgraph.edges.length).toBe(0);
  });

  it('should extract subgraph at depth 1', () => {
    const subgraph = graph.getSubgraph('root', 1);

    expect(subgraph.nodes.length).toBe(3); // root, A, B
    expect(subgraph.nodes.some(n => n.id === 'root')).toBe(true);
    expect(subgraph.nodes.some(n => n.id === 'A')).toBe(true);
    expect(subgraph.nodes.some(n => n.id === 'B')).toBe(true);
    expect(subgraph.edges.length).toBe(2); // root->A, root->B
  });

  it('should extract subgraph at depth 2', () => {
    const subgraph = graph.getSubgraph('root', 2);

    expect(subgraph.nodes.length).toBe(7); // all nodes
    expect(subgraph.edges.length).toBe(6); // all edges
  });

  it('should extract subgraph from non-root node', () => {
    const subgraph = graph.getSubgraph('A', 1);

    expect(subgraph.nodes.length).toBe(3); // A, A1, A2
    expect(subgraph.nodes.some(n => n.id === 'A')).toBe(true);
    expect(subgraph.nodes.some(n => n.id === 'A1')).toBe(true);
    expect(subgraph.nodes.some(n => n.id === 'A2')).toBe(true);
    expect(subgraph.nodes.every(n => !n.id.startsWith('B'))).toBe(true);
  });

  it('should return empty subgraph for non-existent node', () => {
    const subgraph = graph.getSubgraph('non-existent', 1);

    expect(subgraph.nodes).toEqual([]);
    expect(subgraph.edges).toEqual([]);
  });

  it('should handle cycles in subgraph extraction', () => {
    // Add a cycle: A2 -> root
    graph.addEdge({ source: 'A2', target: 'root', type: 'imports', weight: 1.0 });

    // Should not infinite loop
    const subgraph = graph.getSubgraph('root', 10);

    // Should still contain all nodes (no infinite additions)
    expect(subgraph.nodes.length).toBeLessThanOrEqual(7);
  });
});

// ============================================================================
// SERIALIZATION TESTS
// ============================================================================

describe('RepoGraph - Serialization', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();

    graph.addNode({ id: 'file-1', type: 'file', path: '/src/a.ts', name: 'a.ts', metadata: { size: 100 } });
    graph.addNode({ id: 'file-2', type: 'file', path: '/src/b.ts', name: 'b.ts', metadata: { size: 200 } });
    graph.addEdge({ source: 'file-1', target: 'file-2', type: 'imports', weight: 1.0 });
  });

  it('should serialize graph to JSON string', () => {
    const json = graph.serialize();

    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.nodes).toBeDefined();
    expect(parsed.edges).toBeDefined();
  });

  it('should deserialize graph from JSON string', () => {
    const json = graph.serialize();

    const newGraph = createRepoGraph();
    newGraph.deserialize(json);

    const node1 = newGraph.getNode('file-1');
    const node2 = newGraph.getNode('file-2');

    expect(node1).toBeDefined();
    expect(node1?.path).toBe('/src/a.ts');
    expect(node2).toBeDefined();
    expect(node2?.path).toBe('/src/b.ts');
  });

  it('should preserve edges after deserialization', () => {
    const json = graph.serialize();

    const newGraph = createRepoGraph();
    newGraph.deserialize(json);

    const neighbors = newGraph.getNeighbors('file-1');
    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('file-2');
  });

  it('should preserve metadata after round-trip', () => {
    const json = graph.serialize();

    const newGraph = createRepoGraph();
    newGraph.deserialize(json);

    const node = newGraph.getNode('file-1');
    expect(node?.metadata.size).toBe(100);
  });

  it('should handle empty graph serialization', () => {
    const emptyGraph = createRepoGraph();
    const json = emptyGraph.serialize();

    const parsed = JSON.parse(json);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  it('should handle invalid JSON gracefully', () => {
    const newGraph = createRepoGraph();

    // Should not throw
    expect(() => newGraph.deserialize('invalid json')).not.toThrow();

    // Graph should remain empty or unchanged
    expect(newGraph.getNode('anything')).toBeUndefined();
  });
});

// ============================================================================
// INTEGRATION WITH CODE PROPERTY GRAPH TESTS
// ============================================================================

describe('RepoGraph - CPG Integration Compatibility', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();
  });

  it('should support CPG-style node metadata', () => {
    // CPG nodes have location information
    const node: RepoNode = {
      id: 'func-process',
      type: 'function',
      path: '/src/processor.ts',
      name: 'process',
      metadata: {
        line: 42,
        column: 10,
        isAsync: true,
        parameterCount: 2,
        cpgNodeId: 'cpg_node_123',
      },
    };

    graph.addNode(node);
    const retrieved = graph.getNode('func-process');

    expect(retrieved?.metadata.line).toBe(42);
    expect(retrieved?.metadata.cpgNodeId).toBe('cpg_node_123');
  });

  it('should support weighted edges for importance ranking', () => {
    graph.addNode({ id: 'A', type: 'file', path: '/a.ts', name: 'a.ts', metadata: {} });
    graph.addNode({ id: 'B', type: 'file', path: '/b.ts', name: 'b.ts', metadata: {} });
    graph.addNode({ id: 'C', type: 'file', path: '/c.ts', name: 'c.ts', metadata: {} });

    // B is imported twice as often as C
    graph.addEdge({ source: 'A', target: 'B', type: 'imports', weight: 2.0 });
    graph.addEdge({ source: 'A', target: 'C', type: 'imports', weight: 1.0 });

    // Both should be neighbors
    const neighbors = graph.getNeighbors('A');
    expect(neighbors.length).toBe(2);
  });
});

// ============================================================================
// CROSS-FILE RELATIONSHIP TESTS
// ============================================================================

describe('RepoGraph - Cross-file Relationships', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();
  });

  it('should capture import/export relationships across files', () => {
    // File A exports funcA
    graph.addNode({ id: 'file-a', type: 'file', path: '/src/a.ts', name: 'a.ts', metadata: {} });
    graph.addNode({ id: 'func-a', type: 'function', path: '/src/a.ts', name: 'funcA', metadata: {} });
    graph.addEdge({ source: 'file-a', target: 'func-a', type: 'exports', weight: 1.0 });

    // File B imports from file A
    graph.addNode({ id: 'file-b', type: 'file', path: '/src/b.ts', name: 'b.ts', metadata: {} });
    graph.addEdge({ source: 'file-b', target: 'file-a', type: 'imports', weight: 1.0 });

    // Verify relationship
    const importTargets = graph.getNeighbors('file-b', 'imports');
    expect(importTargets.length).toBe(1);
    expect(importTargets[0].id).toBe('file-a');

    const exports = graph.getNeighbors('file-a', 'exports');
    expect(exports.length).toBe(1);
    expect(exports[0].name).toBe('funcA');
  });

  it('should capture class inheritance across files', () => {
    // Base class in one file
    graph.addNode({ id: 'base-class', type: 'class', path: '/src/base.ts', name: 'Base', metadata: {} });

    // Derived class in another file
    graph.addNode({ id: 'derived-class', type: 'class', path: '/src/derived.ts', name: 'Derived', metadata: {} });
    graph.addEdge({ source: 'derived-class', target: 'base-class', type: 'extends', weight: 1.0 });

    // Verify inheritance
    const baseClasses = graph.getNeighbors('derived-class', 'extends');
    expect(baseClasses.length).toBe(1);
    expect(baseClasses[0].name).toBe('Base');
  });

  it('should capture function calls across files', () => {
    // Utility function
    graph.addNode({ id: 'util-func', type: 'function', path: '/src/utils.ts', name: 'helper', metadata: {} });

    // Main function that calls utility
    graph.addNode({ id: 'main-func', type: 'function', path: '/src/main.ts', name: 'main', metadata: {} });
    graph.addEdge({ source: 'main-func', target: 'util-func', type: 'calls', weight: 1.0 });

    // Verify call relationship
    const callees = graph.getNeighbors('main-func', 'calls');
    expect(callees.length).toBe(1);
    expect(callees[0].name).toBe('helper');
  });

  it('should capture interface implementation across files', () => {
    // Interface in one file
    graph.addNode({ id: 'interface-repo', type: 'class', path: '/src/interfaces.ts', name: 'Repository', metadata: { isInterface: true } });

    // Implementation in another file
    graph.addNode({ id: 'impl-class', type: 'class', path: '/src/impl.ts', name: 'UserRepository', metadata: {} });
    graph.addEdge({ source: 'impl-class', target: 'interface-repo', type: 'implements', weight: 1.0 });

    // Verify implementation
    const interfaces = graph.getNeighbors('impl-class', 'implements');
    expect(interfaces.length).toBe(1);
    expect(interfaces[0].name).toBe('Repository');
  });
});

// ============================================================================
// REAL CODEBASE TESTS
// ============================================================================

describe('RepoGraph - Real Codebase', () => {
  it('should be compatible with librarian repo structure', () => {
    const graph = createRepoGraph();

    // Add real file structure
    graph.addNode({
      id: 'eval-dir',
      type: 'directory',
      path: EVALUATION_DIR,
      name: 'evaluation',
      metadata: {},
    });

    graph.addNode({
      id: 'harness-file',
      type: 'file',
      path: path.join(EVALUATION_DIR, 'harness.ts'),
      name: 'harness.ts',
      metadata: {},
    });

    graph.addEdge({
      source: 'eval-dir',
      target: 'harness-file',
      type: 'contains',
      weight: 1.0,
    });

    const children = graph.getNeighbors('eval-dir', 'contains');
    expect(children.length).toBe(1);
    expect(children[0].name).toBe('harness.ts');
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('RepoGraph - Edge Cases', () => {
  let graph: RepoGraph;

  beforeEach(() => {
    graph = createRepoGraph();
  });

  it('should handle nodes with special characters in path', () => {
    const node: RepoNode = {
      id: 'special-1',
      type: 'file',
      path: '/src/[name]/file.ts',
      name: 'file.ts',
      metadata: {},
    };

    graph.addNode(node);
    expect(graph.getNode('special-1')?.path).toBe('/src/[name]/file.ts');
  });

  it('should handle nodes with unicode names', () => {
    const node: RepoNode = {
      id: 'unicode-1',
      type: 'function',
      path: '/src/utils.ts',
      name: 'processData_',
      metadata: {},
    };

    graph.addNode(node);
    expect(graph.getNode('unicode-1')?.name).toBe('processData_');
  });

  it('should handle empty metadata', () => {
    const node: RepoNode = {
      id: 'empty-meta',
      type: 'file',
      path: '/src/a.ts',
      name: 'a.ts',
      metadata: {},
    };

    graph.addNode(node);
    expect(graph.getNode('empty-meta')?.metadata).toEqual({});
  });

  it('should handle large graphs', () => {
    // Create a graph with 1000 nodes
    for (let i = 0; i < 1000; i++) {
      graph.addNode({
        id: `node-${i}`,
        type: 'file',
        path: `/src/file${i}.ts`,
        name: `file${i}.ts`,
        metadata: {},
      });
    }

    // Create edges (linear chain)
    for (let i = 0; i < 999; i++) {
      graph.addEdge({
        source: `node-${i}`,
        target: `node-${i + 1}`,
        type: 'imports',
        weight: 1.0,
      });
    }

    // Should be able to get neighbors
    const neighbors = graph.getNeighbors('node-500');
    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('node-501');
  });

  it('should handle zero weight edges', () => {
    graph.addNode({ id: 'A', type: 'file', path: '/a.ts', name: 'a.ts', metadata: {} });
    graph.addNode({ id: 'B', type: 'file', path: '/b.ts', name: 'b.ts', metadata: {} });

    graph.addEdge({ source: 'A', target: 'B', type: 'imports', weight: 0 });

    const neighbors = graph.getNeighbors('A');
    expect(neighbors.length).toBe(1);
  });

  it('should handle self-referencing edges', () => {
    graph.addNode({ id: 'A', type: 'file', path: '/a.ts', name: 'a.ts', metadata: {} });

    graph.addEdge({ source: 'A', target: 'A', type: 'calls', weight: 1.0 });

    const neighbors = graph.getNeighbors('A');
    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('A');
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('RepoGraph - Performance', () => {
  it('should add 10000 nodes quickly', () => {
    const graph = createRepoGraph();
    const start = Date.now();

    for (let i = 0; i < 10000; i++) {
      graph.addNode({
        id: `node-${i}`,
        type: 'file',
        path: `/src/file${i}.ts`,
        name: `file${i}.ts`,
        metadata: {},
      });
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second
  });

  it('should add 10000 edges quickly', () => {
    const graph = createRepoGraph();

    // First add nodes
    for (let i = 0; i < 1000; i++) {
      graph.addNode({
        id: `node-${i}`,
        type: 'file',
        path: `/src/file${i}.ts`,
        name: `file${i}.ts`,
        metadata: {},
      });
    }

    const start = Date.now();

    // Add edges (each node connects to 10 others)
    for (let i = 0; i < 1000; i++) {
      for (let j = 0; j < 10; j++) {
        graph.addEdge({
          source: `node-${i}`,
          target: `node-${(i + j + 1) % 1000}`,
          type: 'imports',
          weight: 1.0,
        });
      }
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second
  });

  it('should serialize large graph quickly', () => {
    const graph = createRepoGraph();

    // Build a medium-sized graph
    for (let i = 0; i < 1000; i++) {
      graph.addNode({
        id: `node-${i}`,
        type: 'file',
        path: `/src/file${i}.ts`,
        name: `file${i}.ts`,
        metadata: { index: i },
      });
    }

    for (let i = 0; i < 999; i++) {
      graph.addEdge({
        source: `node-${i}`,
        target: `node-${i + 1}`,
        type: 'imports',
        weight: 1.0,
      });
    }

    const start = Date.now();
    const json = graph.serialize();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500); // Should complete in under 500ms
    expect(json.length).toBeGreaterThan(0);
  });
});
