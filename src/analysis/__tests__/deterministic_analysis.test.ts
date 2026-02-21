/**
 * Tests for Deterministic Analysis Module
 *
 * TDD tests for:
 * - Tarjan's SCC algorithm
 * - Graph adjacency analysis
 * - Control flow graph construction
 * - Graph metrics computation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findSCCs,
  computeAdjacencyAnalysis,
  findShortestPath,
  buildControlFlowGraph,
  computeGraphMetrics,
  storeSCCAnalysis,
} from '../deterministic_analysis.js';
import type { ModuleGraph } from '../../knowledge/module_graph.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LiBrainianStorage } from '../../storage/types.js';

describe('Deterministic Analysis', () => {
  let storage: LiBrainianStorage;
  let dbPath: string;
  const testDir = join(tmpdir(), 'deterministic-analysis-test-' + Date.now());

  beforeEach(async () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `test-${Date.now()}.db`);
    storage = createSqliteStorage(dbPath, testDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
        unlinkSync(dbPath + '-wal');
        unlinkSync(dbPath + '-shm');
        unlinkSync(dbPath + '.lock');
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Tarjan SCC Algorithm', () => {
    it('should find no cycles in a DAG', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['d'])],
        ['c', new Set(['d'])],
        ['d', new Set()],
      ]);

      const sccs = findSCCs(graph);

      // Each node is its own SCC (no cycles)
      expect(sccs.length).toBe(4);
      expect(sccs.every(scc => scc.length === 1)).toBe(true);
    });

    it('should find a simple cycle', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['a'])],
      ]);

      const sccs = findSCCs(graph);

      // One SCC with all three nodes
      expect(sccs.length).toBe(1);
      expect(sccs[0].length).toBe(3);
      expect(sccs[0]).toContain('a');
      expect(sccs[0]).toContain('b');
      expect(sccs[0]).toContain('c');
    });

    it('should find multiple independent cycles', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
        ['c', new Set(['d'])],
        ['d', new Set(['c'])],
        ['e', new Set()],
      ]);

      const sccs = findSCCs(graph);
      const cyclicSccs = sccs.filter(scc => scc.length > 1);

      expect(cyclicSccs.length).toBe(2);
      expect(cyclicSccs.some(scc => scc.includes('a') && scc.includes('b'))).toBe(true);
      expect(cyclicSccs.some(scc => scc.includes('c') && scc.includes('d'))).toBe(true);
    });

    it('should handle a complex graph with nested cycles', () => {
      // Graph: a -> b -> c -> d -> b (cycle), e -> c
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['d'])],
        ['d', new Set(['b'])],
        ['e', new Set(['c'])],
      ]);

      const sccs = findSCCs(graph);
      const cyclicSccs = sccs.filter(scc => scc.length > 1);

      expect(cyclicSccs.length).toBe(1);
      expect(cyclicSccs[0].length).toBe(3); // b, c, d form a cycle
      expect(cyclicSccs[0]).toContain('b');
      expect(cyclicSccs[0]).toContain('c');
      expect(cyclicSccs[0]).toContain('d');
    });

    it('should handle self-loops', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['a', 'b'])],
        ['b', new Set()],
      ]);

      const sccs = findSCCs(graph);
      const selfLoopScc = sccs.find(scc => scc.includes('a'));

      expect(selfLoopScc).toBeDefined();
      expect(selfLoopScc!.length).toBe(1); // Self-loop is still a single-node SCC
    });

    it('should handle disconnected graph', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set()],
        ['c', new Set()],
      ]);

      const sccs = findSCCs(graph);

      expect(sccs.length).toBe(3);
      expect(sccs.every(scc => scc.length === 1)).toBe(true);
    });
  });

  describe('SCC Storage Integration', () => {
    it('should store SCC analysis results', async () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['a'])],
        ['d', new Set()],
      ]);

      const result = await storeSCCAnalysis(storage, graph);

      expect(result.totalComponents).toBe(2); // One cycle + one isolated
      expect(result.cyclicComponents).toBe(1);

      // Verify storage
      const sccA = await storage.getSCCByEntity('a', 'module');
      expect(sccA).not.toBeNull();
      expect(sccA!.componentSize).toBe(3);
    });
  });

  describe('Adjacency Analysis', () => {
    it('should compute direct neighbors', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['d'])],
        ['c', new Set()],
        ['d', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['a'])],
        ['d', new Set(['b'])],
      ]);

      const analysis = computeAdjacencyAnalysis(graph, reverse);

      expect(analysis.directNeighbors.get('a')).toEqual(new Set(['b', 'c']));
      expect(analysis.directNeighbors.get('b')).toEqual(new Set(['d']));
    });

    it('should compute transitive reach', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['d'])],
        ['d', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['b'])],
        ['d', new Set(['c'])],
      ]);

      const analysis = computeAdjacencyAnalysis(graph, reverse);

      expect(analysis.transitiveReach.get('a')).toEqual(new Set(['b', 'c', 'd']));
      expect(analysis.transitiveReach.get('c')).toEqual(new Set(['d']));
      expect(analysis.transitiveReach.get('d')).toEqual(new Set());
    });

    it('should compute in-degree and out-degree', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c', 'd'])],
        ['b', new Set(['d'])],
        ['c', new Set(['d'])],
        ['d', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['a'])],
        ['d', new Set(['a', 'b', 'c'])],
      ]);

      const analysis = computeAdjacencyAnalysis(graph, reverse);

      expect(analysis.outDegree.get('a')).toBe(3);
      expect(analysis.outDegree.get('d')).toBe(0);
      expect(analysis.inDegree.get('d')).toBe(3);
      expect(analysis.inDegree.get('a')).toBe(0);
    });
  });

  describe('Shortest Path', () => {
    it('should find direct path', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set()],
      ]);

      const path = findShortestPath(graph, 'a', 'b');

      expect(path).toEqual(['a', 'b']);
    });

    it('should find multi-hop path', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['c'])],
        ['c', new Set(['d'])],
        ['d', new Set()],
      ]);

      const path = findShortestPath(graph, 'a', 'd');

      expect(path).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should return null when no path exists', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set()],
        ['c', new Set()],
      ]);

      const path = findShortestPath(graph, 'a', 'c');

      expect(path).toBeNull();
    });

    it('should find shortest of multiple paths', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['d'])],
        ['c', new Set(['e'])],
        ['d', new Set(['f'])],
        ['e', new Set(['f'])],
        ['f', new Set()],
      ]);

      const path = findShortestPath(graph, 'a', 'f');

      expect(path?.length).toBe(4); // a -> b -> d -> f or a -> c -> e -> f
    });

    it('should handle same source and target', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b'])],
        ['b', new Set()],
      ]);

      const path = findShortestPath(graph, 'a', 'a');

      expect(path).toEqual(['a']);
    });
  });

  describe('Control Flow Graph', () => {
    it('should create single block for simple function', () => {
      const content = `
function simple() {
  const x = 1;
  return x;
}`;

      const result = buildControlFlowGraph('func-1', 2, 5, content);

      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.blocks[0].isEntry).toBe(true);
      expect(result.blocks[result.blocks.length - 1].isExit).toBe(true);
    });

    it('should detect conditional blocks', () => {
      const content = `
function conditional(x) {
  if (x > 0) {
    return 1;
  } else {
    return -1;
  }
}`;

      const result = buildControlFlowGraph('func-2', 2, 8, content);

      // Should have multiple blocks due to if/else
      expect(result.blocks.length).toBeGreaterThan(1);

      // Should have branch edges
      const branchEdges = result.edges.filter(e => e.edgeType === 'branch_true');
      expect(branchEdges.length).toBeGreaterThan(0);
    });

    it('should detect loop blocks', () => {
      const content = `
function loop(items) {
  for (const item of items) {
    process(item);
  }
  return done;
}`;

      const result = buildControlFlowGraph('func-3', 2, 7, content);

      // Should have loop back edge
      const loopEdges = result.edges.filter(e => e.edgeType === 'loop_back');
      expect(loopEdges.length).toBeGreaterThan(0);
    });
  });

  describe('Graph Metrics', () => {
    it('should compute basic metrics', () => {
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['c'])],
        ['c', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set()],
        ['b', new Set(['a'])],
        ['c', new Set(['a', 'b'])],
      ]);

      const metrics = computeGraphMetrics(graph, reverse);

      expect(metrics.nodeCount).toBe(3);
      expect(metrics.edgeCount).toBe(3);
      expect(metrics.averageOutDegree).toBe(1);
    });

    it('should identify special nodes', () => {
      const graph: ModuleGraph = new Map([
        ['root1', new Set(['middle'])],
        ['root2', new Set(['middle'])],
        ['middle', new Set(['leaf'])],
        ['leaf', new Set()],
        ['isolated', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['root1', new Set()],
        ['root2', new Set()],
        ['middle', new Set(['root1', 'root2'])],
        ['leaf', new Set(['middle'])],
        ['isolated', new Set()],
      ]);

      const metrics = computeGraphMetrics(graph, reverse);

      expect(metrics.rootNodes).toContain('root1');
      expect(metrics.rootNodes).toContain('root2');
      expect(metrics.leafNodes).toContain('leaf');
      expect(metrics.isolatedNodes).toContain('isolated');
    });

    it('should find max degree nodes', () => {
      const graph: ModuleGraph = new Map([
        ['hub', new Set(['a', 'b', 'c', 'd'])],
        ['a', new Set()],
        ['b', new Set()],
        ['c', new Set()],
        ['d', new Set()],
      ]);
      const reverse: ModuleGraph = new Map([
        ['hub', new Set()],
        ['a', new Set(['hub'])],
        ['b', new Set(['hub'])],
        ['c', new Set(['hub'])],
        ['d', new Set(['hub'])],
      ]);

      const metrics = computeGraphMetrics(graph, reverse);

      expect(metrics.maxOutDegree?.node).toBe('hub');
      expect(metrics.maxOutDegree?.degree).toBe(4);
    });

    it('should compute density correctly', () => {
      // Complete graph on 3 nodes has 6 edges and density 1.0
      const graph: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['a', 'c'])],
        ['c', new Set(['a', 'b'])],
      ]);
      const reverse: ModuleGraph = new Map([
        ['a', new Set(['b', 'c'])],
        ['b', new Set(['a', 'c'])],
        ['c', new Set(['a', 'b'])],
      ]);

      const metrics = computeGraphMetrics(graph, reverse);

      expect(metrics.edgeCount).toBe(6);
      expect(metrics.density).toBe(1.0);
    });
  });
});
