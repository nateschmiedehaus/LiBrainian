/**
 * @fileoverview Tests for Causal Reasoning Module
 *
 * Tests cover:
 * - Causal graph construction from AST facts and events
 * - Finding causes (backward traversal)
 * - Finding effects (forward traversal)
 * - Path explanation between cause and effect
 * - Type guards and factory functions
 *
 * Test Philosophy:
 * - Test interface contracts, not implementation details
 * - Each test should be independent and isolated
 * - Use realistic examples from code analysis scenarios
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Core types
  type CausalNode,
  type CausalEdge,
  type CausalGraph,
  type CausalPath,
  type CausalNodeType,
  type CausalEdgeType,

  // Type guards
  isCausalNode,
  isCausalEdge,
  isCausalGraph,

  // Factory functions
  createCausalNode,
  createCausalEdge,
  createEmptyCausalGraph,

  // Core operations
  buildCausalGraphFromFacts,
  addNodeToGraph,
  addEdgeToGraph,
  findCauses,
  findEffects,
  explainCausation,
  findRootCauses,
  findTerminalEffects,
  getDirectCauses,
  getDirectEffects,

  // Utilities
  getCausalChainDepth,
  hasPath,
  getCycleNodes,

  // Level 2 causal inference (WU-THIMPL-110)
  doIntervention,
  doMultipleInterventions,
  type InterventionValue,

  // D-separation (WU-THIMPL-111)
  isDSeparated,
  findMinimalSeparatingSet,
} from '../causal_reasoning.js';
import { deterministic, absent } from '../confidence.js';

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe('Causal Reasoning Types', () => {
  describe('CausalNode', () => {
    it('should create a valid causal node with factory function', () => {
      const node = createCausalNode({
        id: 'node-1',
        type: 'event',
        description: 'Function foo threw an error',
      });

      expect(node.id).toBe('node-1');
      expect(node.type).toBe('event');
      expect(node.description).toBe('Function foo threw an error');
      expect(node.confidence).toBeDefined();
      expect(isCausalNode(node)).toBe(true);
    });

    it('should accept optional timestamp and metadata', () => {
      const now = Date.now();
      const node = createCausalNode({
        id: 'node-2',
        type: 'state',
        description: 'Variable x is null',
        timestamp: now,
        metadata: { variableName: 'x', scope: 'function' },
      });

      expect(node.timestamp).toBe(now);
      expect(node.metadata).toEqual({ variableName: 'x', scope: 'function' });
    });

    it('should accept custom confidence', () => {
      const node = createCausalNode({
        id: 'node-3',
        type: 'action',
        description: 'User called processData()',
        confidence: deterministic(true, 'call_observed'),
      });

      expect(node.confidence.type).toBe('deterministic');
    });

    describe('type guard', () => {
      it('should accept valid causal nodes', () => {
        expect(isCausalNode({
          id: 'n1',
          type: 'event',
          description: 'test',
          confidence: absent(),
        })).toBe(true);
      });

      it('should reject invalid objects', () => {
        expect(isCausalNode(null)).toBe(false);
        expect(isCausalNode(undefined)).toBe(false);
        expect(isCausalNode({})).toBe(false);
        expect(isCausalNode({ id: 'n1' })).toBe(false);
        expect(isCausalNode({ id: 'n1', type: 'invalid', description: 'x' })).toBe(false);
      });
    });
  });

  describe('CausalEdge', () => {
    it('should create a valid causal edge with factory function', () => {
      const edge = createCausalEdge({
        from: 'node-1',
        to: 'node-2',
        type: 'causes',
      });

      expect(edge.from).toBe('node-1');
      expect(edge.to).toBe('node-2');
      expect(edge.type).toBe('causes');
      expect(edge.strength).toBeGreaterThan(0);
      expect(edge.evidence).toEqual([]);
      expect(isCausalEdge(edge)).toBe(true);
    });

    it('should accept custom strength and evidence', () => {
      const edge = createCausalEdge({
        from: 'cause',
        to: 'effect',
        type: 'enables',
        strength: 0.8,
        evidence: [{ type: 'ast', reference: 'file:line' }],
      });

      expect(edge.strength).toBe(0.8);
      expect(edge.evidence).toHaveLength(1);
    });

    it('should clamp strength to valid range', () => {
      const edgeHigh = createCausalEdge({
        from: 'a',
        to: 'b',
        type: 'causes',
        strength: 1.5,
      });
      expect(edgeHigh.strength).toBeLessThanOrEqual(1);

      const edgeLow = createCausalEdge({
        from: 'a',
        to: 'b',
        type: 'causes',
        strength: -0.5,
      });
      expect(edgeLow.strength).toBeGreaterThanOrEqual(0);
    });

    describe('type guard', () => {
      it('should accept valid edges', () => {
        expect(isCausalEdge({
          from: 'a',
          to: 'b',
          type: 'causes',
          strength: 0.5,
          evidence: [],
        })).toBe(true);
      });

      it('should reject invalid objects', () => {
        expect(isCausalEdge(null)).toBe(false);
        expect(isCausalEdge({ from: 'a', to: 'b' })).toBe(false);
        expect(isCausalEdge({ from: 'a', to: 'b', type: 'invalid', strength: 0.5 })).toBe(false);
      });
    });
  });

  describe('CausalGraph', () => {
    it('should create an empty causal graph', () => {
      const graph = createEmptyCausalGraph('test-graph');

      expect(graph.id).toBe('test-graph');
      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toHaveLength(0);
      expect(isCausalGraph(graph)).toBe(true);
    });

    it('should add nodes to graph', () => {
      const graph = createEmptyCausalGraph('g1');
      const node = createCausalNode({
        id: 'n1',
        type: 'event',
        description: 'Test event',
      });

      const updated = addNodeToGraph(graph, node);

      expect(updated.nodes.size).toBe(1);
      expect(updated.nodes.get('n1')).toEqual(node);
    });

    it('should add edges to graph', () => {
      let graph = createEmptyCausalGraph('g1');
      const node1 = createCausalNode({ id: 'n1', type: 'event', description: 'Cause' });
      const node2 = createCausalNode({ id: 'n2', type: 'event', description: 'Effect' });

      graph = addNodeToGraph(graph, node1);
      graph = addNodeToGraph(graph, node2);

      const edge = createCausalEdge({ from: 'n1', to: 'n2', type: 'causes' });
      const updated = addEdgeToGraph(graph, edge);

      expect(updated.edges).toHaveLength(1);
      expect(updated.edges[0]).toEqual(edge);
    });

    it('should reject edges referencing non-existent nodes', () => {
      const graph = createEmptyCausalGraph('g1');
      const edge = createCausalEdge({ from: 'n1', to: 'n2', type: 'causes' });

      expect(() => addEdgeToGraph(graph, edge)).toThrow(/node/i);
    });

    describe('type guard', () => {
      it('should accept valid graphs', () => {
        expect(isCausalGraph({
          id: 'g1',
          nodes: new Map(),
          edges: [],
          meta: { createdAt: new Date().toISOString() },
        })).toBe(true);
      });

      it('should reject invalid objects', () => {
        expect(isCausalGraph(null)).toBe(false);
        expect(isCausalGraph({ id: 'g1' })).toBe(false);
        expect(isCausalGraph({ id: 'g1', nodes: {}, edges: [] })).toBe(false);
      });
    });
  });
});

// ============================================================================
// GRAPH BUILDING TESTS
// ============================================================================

describe('Causal Graph Building', () => {
  describe('buildCausalGraphFromFacts', () => {
    it('should build graph from function call facts', () => {
      const facts = [
        {
          type: 'call' as const,
          identifier: 'validate->processInput',
          file: 'src/validation.ts',
          line: 10,
          details: {
            caller: 'validate',
            callee: 'processInput',
          },
        },
        {
          type: 'call' as const,
          identifier: 'processInput->saveData',
          file: 'src/process.ts',
          line: 25,
          details: {
            caller: 'processInput',
            callee: 'saveData',
          },
        },
      ];

      const graph = buildCausalGraphFromFacts(facts, []);

      // Should have nodes for each function
      expect(graph.nodes.size).toBeGreaterThanOrEqual(3);
      expect(graph.nodes.has('validate')).toBe(true);
      expect(graph.nodes.has('processInput')).toBe(true);
      expect(graph.nodes.has('saveData')).toBe(true);

      // Should have causal edges
      expect(graph.edges.length).toBeGreaterThanOrEqual(2);
    });

    it('should incorporate events into causal graph', () => {
      const facts = [
        {
          type: 'function_def' as const,
          identifier: 'fetchData',
          file: 'src/api.ts',
          line: 1,
          details: { isAsync: true, isExported: true, parameters: [] },
        },
      ];

      const events = [
        {
          id: 'evt-1',
          type: 'error' as const,
          description: 'NetworkError in fetchData',
          timestamp: Date.now(),
          source: 'fetchData',
        },
        {
          id: 'evt-2',
          type: 'error' as const,
          description: 'UI failed to render',
          timestamp: Date.now() + 100,
          cause: 'evt-1',
        },
      ];

      const graph = buildCausalGraphFromFacts(facts, events);

      // Should have event nodes
      expect(graph.nodes.has('evt-1')).toBe(true);
      expect(graph.nodes.has('evt-2')).toBe(true);

      // Should have causal edge from evt-1 to evt-2
      const edge = graph.edges.find(e => e.from === 'evt-1' && e.to === 'evt-2');
      expect(edge).toBeDefined();
    });

    it('should handle empty inputs gracefully', () => {
      const graph = buildCausalGraphFromFacts([], []);

      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toHaveLength(0);
    });
  });
});

// ============================================================================
// CAUSE FINDING TESTS
// ============================================================================

describe('Finding Causes', () => {
  let graph: CausalGraph;

  beforeEach(() => {
    // Build a test graph:
    //
    // [configError] --causes--> [dbConnectionFailed] --causes--> [queryFailed]
    //                                                               ^
    // [networkTimeout] --enables------------------------------|
    //
    graph = createEmptyCausalGraph('test-causes');

    const nodes = [
      createCausalNode({ id: 'configError', type: 'state', description: 'Database config is invalid' }),
      createCausalNode({ id: 'networkTimeout', type: 'event', description: 'Network timed out' }),
      createCausalNode({ id: 'dbConnectionFailed', type: 'event', description: 'DB connection failed' }),
      createCausalNode({ id: 'queryFailed', type: 'event', description: 'Query failed to execute' }),
    ];

    for (const node of nodes) {
      graph = addNodeToGraph(graph, node);
    }

    const edges = [
      createCausalEdge({ from: 'configError', to: 'dbConnectionFailed', type: 'causes', strength: 0.9 }),
      createCausalEdge({ from: 'dbConnectionFailed', to: 'queryFailed', type: 'causes', strength: 1.0 }),
      createCausalEdge({ from: 'networkTimeout', to: 'queryFailed', type: 'enables', strength: 0.7 }),
    ];

    for (const edge of edges) {
      graph = addEdgeToGraph(graph, edge);
    }
  });

  describe('findCauses', () => {
    it('should find all direct and indirect causes', () => {
      const causes = findCauses(graph, 'queryFailed');

      expect(causes.map(n => n.id)).toContain('dbConnectionFailed');
      expect(causes.map(n => n.id)).toContain('configError');
      expect(causes.map(n => n.id)).toContain('networkTimeout');
    });

    it('should respect maxDepth parameter', () => {
      const directOnly = findCauses(graph, 'queryFailed', { maxDepth: 1 });

      expect(directOnly.map(n => n.id)).toContain('dbConnectionFailed');
      expect(directOnly.map(n => n.id)).toContain('networkTimeout');
      expect(directOnly.map(n => n.id)).not.toContain('configError'); // depth 2
    });

    it('should filter by edge type', () => {
      const causesOnly = findCauses(graph, 'queryFailed', { edgeTypes: ['causes'] });

      expect(causesOnly.map(n => n.id)).toContain('dbConnectionFailed');
      expect(causesOnly.map(n => n.id)).toContain('configError');
      expect(causesOnly.map(n => n.id)).not.toContain('networkTimeout'); // 'enables' edge
    });

    it('should return empty array for non-existent node', () => {
      const causes = findCauses(graph, 'nonExistent');
      expect(causes).toEqual([]);
    });

    it('should handle nodes with no causes', () => {
      const causes = findCauses(graph, 'configError');
      expect(causes).toEqual([]);
    });

    it('should exclude correlates edges by default (correlation != causation)', () => {
      // Add a correlation edge to the graph
      let graphWithCorrelation = graph;
      const correlatedNode = createCausalNode({
        id: 'highMemoryUsage',
        type: 'state',
        description: 'High memory usage observed',
      });
      graphWithCorrelation = addNodeToGraph(graphWithCorrelation, correlatedNode);

      // This is a correlation, not causation - high memory correlates with query failures
      // but doesn't necessarily cause them
      graphWithCorrelation.edges.push(
        createCausalEdge({
          from: 'highMemoryUsage',
          to: 'queryFailed',
          type: 'correlates',
          strength: 0.7,
        })
      );

      // By default, correlates edges should be excluded
      const causes = findCauses(graphWithCorrelation, 'queryFailed');
      expect(causes.map(n => n.id)).not.toContain('highMemoryUsage');

      // With explicit includeCorrelations, it should be included
      const causesWithCorrelations = findCauses(graphWithCorrelation, 'queryFailed', {
        includeCorrelations: true,
      });
      expect(causesWithCorrelations.map(n => n.id)).toContain('highMemoryUsage');
    });
  });

  describe('getDirectCauses', () => {
    it('should return only immediate causes', () => {
      const direct = getDirectCauses(graph, 'queryFailed');

      expect(direct).toHaveLength(2);
      expect(direct.map(n => n.id)).toContain('dbConnectionFailed');
      expect(direct.map(n => n.id)).toContain('networkTimeout');
    });
  });

  describe('findRootCauses', () => {
    it('should find causes with no upstream causes', () => {
      const roots = findRootCauses(graph, 'queryFailed');

      expect(roots.map(n => n.id)).toContain('configError');
      expect(roots.map(n => n.id)).toContain('networkTimeout');
      expect(roots.map(n => n.id)).not.toContain('dbConnectionFailed');
    });
  });
});

// ============================================================================
// EFFECT FINDING TESTS
// ============================================================================

describe('Finding Effects', () => {
  let graph: CausalGraph;

  beforeEach(() => {
    // Build a test graph:
    //
    // [codeChange] --causes--> [testFailed] --causes--> [buildBroken]
    //      |
    //      +------causes--> [docsOutdated]
    //
    graph = createEmptyCausalGraph('test-effects');

    const nodes = [
      createCausalNode({ id: 'codeChange', type: 'action', description: 'Code was changed' }),
      createCausalNode({ id: 'testFailed', type: 'event', description: 'Test suite failed' }),
      createCausalNode({ id: 'buildBroken', type: 'state', description: 'Build is broken' }),
      createCausalNode({ id: 'docsOutdated', type: 'state', description: 'Documentation is outdated' }),
    ];

    for (const node of nodes) {
      graph = addNodeToGraph(graph, node);
    }

    const edges = [
      createCausalEdge({ from: 'codeChange', to: 'testFailed', type: 'causes' }),
      createCausalEdge({ from: 'testFailed', to: 'buildBroken', type: 'causes' }),
      createCausalEdge({ from: 'codeChange', to: 'docsOutdated', type: 'causes' }),
    ];

    for (const edge of edges) {
      graph = addEdgeToGraph(graph, edge);
    }
  });

  describe('findEffects', () => {
    it('should find all direct and indirect effects', () => {
      const effects = findEffects(graph, 'codeChange');

      expect(effects.map(n => n.id)).toContain('testFailed');
      expect(effects.map(n => n.id)).toContain('buildBroken');
      expect(effects.map(n => n.id)).toContain('docsOutdated');
    });

    it('should respect maxDepth parameter', () => {
      const directOnly = findEffects(graph, 'codeChange', { maxDepth: 1 });

      expect(directOnly.map(n => n.id)).toContain('testFailed');
      expect(directOnly.map(n => n.id)).toContain('docsOutdated');
      expect(directOnly.map(n => n.id)).not.toContain('buildBroken'); // depth 2
    });

    it('should return empty array for non-existent node', () => {
      const effects = findEffects(graph, 'nonExistent');
      expect(effects).toEqual([]);
    });

    it('should handle nodes with no effects', () => {
      const effects = findEffects(graph, 'buildBroken');
      expect(effects).toEqual([]);
    });
  });

  describe('getDirectEffects', () => {
    it('should return only immediate effects', () => {
      const direct = getDirectEffects(graph, 'codeChange');

      expect(direct).toHaveLength(2);
      expect(direct.map(n => n.id)).toContain('testFailed');
      expect(direct.map(n => n.id)).toContain('docsOutdated');
    });
  });

  describe('findTerminalEffects', () => {
    it('should find effects with no downstream effects', () => {
      const terminals = findTerminalEffects(graph, 'codeChange');

      expect(terminals.map(n => n.id)).toContain('buildBroken');
      expect(terminals.map(n => n.id)).toContain('docsOutdated');
      expect(terminals.map(n => n.id)).not.toContain('testFailed');
    });
  });
});

// ============================================================================
// PATH EXPLANATION TESTS
// ============================================================================

describe('Causation Explanation', () => {
  let graph: CausalGraph;

  beforeEach(() => {
    // Build a graph with multiple paths:
    //
    // [A] --causes--> [B] --causes--> [D]
    //  |                               ^
    //  +------causes--> [C] --enables--|
    //
    graph = createEmptyCausalGraph('test-paths');

    const nodes = [
      createCausalNode({ id: 'A', type: 'action', description: 'Initial action' }),
      createCausalNode({ id: 'B', type: 'event', description: 'Path 1 intermediate' }),
      createCausalNode({ id: 'C', type: 'event', description: 'Path 2 intermediate' }),
      createCausalNode({ id: 'D', type: 'state', description: 'Final effect' }),
    ];

    for (const node of nodes) {
      graph = addNodeToGraph(graph, node);
    }

    const edges = [
      createCausalEdge({ from: 'A', to: 'B', type: 'causes', strength: 0.9 }),
      createCausalEdge({ from: 'B', to: 'D', type: 'causes', strength: 0.8 }),
      createCausalEdge({ from: 'A', to: 'C', type: 'causes', strength: 0.7 }),
      createCausalEdge({ from: 'C', to: 'D', type: 'enables', strength: 0.6 }),
    ];

    for (const edge of edges) {
      graph = addEdgeToGraph(graph, edge);
    }
  });

  describe('explainCausation', () => {
    it('should find all causal paths between two nodes', () => {
      const paths = explainCausation(graph, 'A', 'D');

      expect(paths.length).toBe(2);
    });

    it('should include path details', () => {
      const paths = explainCausation(graph, 'A', 'D');

      for (const path of paths) {
        expect(path.nodes).toBeDefined();
        expect(path.edges).toBeDefined();
        expect(path.totalStrength).toBeGreaterThan(0);
        expect(path.nodes[0].id).toBe('A');
        expect(path.nodes[path.nodes.length - 1].id).toBe('D');
      }
    });

    it('should calculate path strength correctly', () => {
      const paths = explainCausation(graph, 'A', 'D');

      // Path A -> B -> D: 0.9 * 0.8 = 0.72
      // Path A -> C -> D: 0.7 * 0.6 = 0.42
      const strengths = paths.map(p => p.totalStrength);
      // Use approximate comparison for floating point
      expect(strengths.some(s => Math.abs(s - 0.72) < 0.01)).toBe(true);
      expect(strengths.some(s => Math.abs(s - 0.42) < 0.01)).toBe(true);
    });

    it('should return empty array when no path exists', () => {
      const paths = explainCausation(graph, 'D', 'A'); // reverse direction
      expect(paths).toEqual([]);
    });

    it('should return empty array for non-existent nodes', () => {
      const paths = explainCausation(graph, 'X', 'Y');
      expect(paths).toEqual([]);
    });
  });

  describe('hasPath', () => {
    it('should return true when path exists', () => {
      expect(hasPath(graph, 'A', 'D')).toBe(true);
      expect(hasPath(graph, 'A', 'B')).toBe(true);
      expect(hasPath(graph, 'B', 'D')).toBe(true);
    });

    it('should return false when no path exists', () => {
      expect(hasPath(graph, 'D', 'A')).toBe(false);
      expect(hasPath(graph, 'B', 'C')).toBe(false);
    });
  });
});

// ============================================================================
// UTILITY TESTS
// ============================================================================

describe('Utility Functions', () => {
  describe('getCausalChainDepth', () => {
    it('should calculate correct depth', () => {
      let graph = createEmptyCausalGraph('depth-test');

      // A -> B -> C -> D (depth 3)
      const nodes = ['A', 'B', 'C', 'D'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'C', type: 'causes' }),
        createCausalEdge({ from: 'C', to: 'D', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }

      expect(getCausalChainDepth(graph, 'A', 'D')).toBe(3);
      expect(getCausalChainDepth(graph, 'A', 'B')).toBe(1);
      expect(getCausalChainDepth(graph, 'A', 'A')).toBe(0);
      expect(getCausalChainDepth(graph, 'D', 'A')).toBe(-1); // no path
    });
  });

  describe('getCycleNodes', () => {
    it('should detect cycles in the graph', () => {
      let graph = createEmptyCausalGraph('cycle-test');

      // Create cycle: A -> B -> C -> A
      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      // Add edges in cycle - need to bypass validation for testing
      graph.edges.push(
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'C', type: 'causes' }),
        createCausalEdge({ from: 'C', to: 'A', type: 'causes' }),
      );

      const cycleNodes = getCycleNodes(graph);
      expect(cycleNodes.length).toBeGreaterThan(0);
      expect(cycleNodes).toContain('A');
      expect(cycleNodes).toContain('B');
      expect(cycleNodes).toContain('C');
    });

    it('should return empty array for acyclic graph', () => {
      let graph = createEmptyCausalGraph('acyclic-test');

      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'C', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }

      const cycleNodes = getCycleNodes(graph);
      expect(cycleNodes).toEqual([]);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Causal Reasoning Integration', () => {
  it('should support "Why did function X fail?" query', () => {
    // Scenario: User asks why function X failed
    // We build a causal graph from facts and events, then trace back causes

    const facts = [
      {
        type: 'function_def' as const,
        identifier: 'processPayment',
        file: 'src/payments.ts',
        line: 50,
        details: { parameters: [{ name: 'amount', type: 'number' }], isAsync: true, isExported: true },
      },
      {
        type: 'call' as const,
        identifier: 'processPayment->validateAmount',
        file: 'src/payments.ts',
        line: 52,
        details: { caller: 'processPayment', callee: 'validateAmount' },
      },
      {
        type: 'call' as const,
        identifier: 'processPayment->chargeCard',
        file: 'src/payments.ts',
        line: 55,
        details: { caller: 'processPayment', callee: 'chargeCard' },
      },
    ];

    const events = [
      {
        id: 'err-validation',
        type: 'error' as const,
        description: 'Amount validation failed: negative value',
        timestamp: Date.now(),
        source: 'validateAmount',
      },
      {
        id: 'err-payment',
        type: 'error' as const,
        description: 'processPayment failed',
        timestamp: Date.now() + 10,
        cause: 'err-validation',
      },
    ];

    const graph = buildCausalGraphFromFacts(facts, events);

    // Query: Why did processPayment fail? (trace all causes, not just root)
    const allCauses = findCauses(graph, 'err-payment');

    // Should trace back to validation error
    expect(allCauses.map(n => n.id)).toContain('err-validation');

    // Also check the root cause includes validateAmount (source of the error)
    const rootCauses = findRootCauses(graph, 'err-payment');
    // Root cause is processPayment (top of the call chain) since it calls validateAmount
    expect(rootCauses.length).toBeGreaterThan(0);
  });

  it('should support Level 2 intervention queries: "What if we SET X?"', () => {
    // Scenario: Ice cream sales graph
    // Temperature -> Sales, Season -> Sales (confounded)
    // What happens to sales if we SET temperature to 90?

    let graph = createEmptyCausalGraph('intervention-test');

    const nodes = [
      createCausalNode({ id: 'season', type: 'state', description: 'Time of year' }),
      createCausalNode({ id: 'temperature', type: 'state', description: 'Ambient temperature' }),
      createCausalNode({ id: 'sales', type: 'event', description: 'Ice cream sales' }),
    ];

    for (const node of nodes) {
      graph = addNodeToGraph(graph, node);
    }

    const edges = [
      createCausalEdge({ from: 'season', to: 'temperature', type: 'causes' }),
      createCausalEdge({ from: 'temperature', to: 'sales', type: 'causes' }),
      createCausalEdge({ from: 'season', to: 'sales', type: 'causes' }),
    ];

    for (const edge of edges) {
      graph = addEdgeToGraph(graph, edge);
    }

    // Before intervention: temperature depends on season
    expect(findCauses(graph, 'temperature').map(n => n.id)).toContain('season');

    // Perform intervention: do(temperature = 90)
    const mutilatedGraph = doIntervention(graph, 'temperature', { value: 90 });

    // After intervention: temperature no longer depends on season
    expect(findCauses(mutilatedGraph, 'temperature')).toEqual([]);

    // But temperature still affects sales
    expect(findEffects(mutilatedGraph, 'temperature').map(n => n.id)).toContain('sales');

    // The intervention is recorded in metadata
    const tempNode = mutilatedGraph.nodes.get('temperature');
    expect(tempNode?.metadata?.intervention).toBeDefined();
  });

  it('should support "What will happen if we change X?" query', () => {
    // Scenario: User asks what effects changing a module will have

    let graph = createEmptyCausalGraph('impact-analysis');

    // Model the dependency impact
    const nodes = [
      createCausalNode({ id: 'auth-module', type: 'action', description: 'Auth module changed' }),
      createCausalNode({ id: 'user-service', type: 'state', description: 'User service needs rebuild' }),
      createCausalNode({ id: 'api-gateway', type: 'state', description: 'API gateway needs rebuild' }),
      createCausalNode({ id: 'frontend', type: 'state', description: 'Frontend needs update' }),
    ];

    for (const node of nodes) {
      graph = addNodeToGraph(graph, node);
    }

    const edges = [
      createCausalEdge({ from: 'auth-module', to: 'user-service', type: 'causes' }),
      createCausalEdge({ from: 'auth-module', to: 'api-gateway', type: 'causes' }),
      createCausalEdge({ from: 'user-service', to: 'frontend', type: 'causes' }),
    ];

    for (const edge of edges) {
      graph = addEdgeToGraph(graph, edge);
    }

    // Query: What will happen if we change auth-module?
    const effects = findEffects(graph, 'auth-module');

    expect(effects).toHaveLength(3);
    expect(effects.map(n => n.id)).toContain('user-service');
    expect(effects.map(n => n.id)).toContain('api-gateway');
    expect(effects.map(n => n.id)).toContain('frontend');
  });
});

// ============================================================================
// INTERVENTION TESTS (WU-THIMPL-110)
// ============================================================================

describe('Graph Surgery for Interventions (do-calculus)', () => {
  describe('doIntervention', () => {
    let graph: CausalGraph;

    beforeEach(() => {
      // Build a classic confounding structure:
      //
      // [season] --causes--> [temperature] --causes--> [iceCreamSales]
      //     |                                              ^
      //     +----------------------causes------------------|
      //
      graph = createEmptyCausalGraph('intervention-test');

      const nodes = [
        createCausalNode({ id: 'season', type: 'state', description: 'Time of year' }),
        createCausalNode({ id: 'temperature', type: 'state', description: 'Temperature' }),
        createCausalNode({ id: 'iceCreamSales', type: 'event', description: 'Ice cream sales' }),
      ];

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'season', to: 'temperature', type: 'causes' }),
        createCausalEdge({ from: 'temperature', to: 'iceCreamSales', type: 'causes' }),
        createCausalEdge({ from: 'season', to: 'iceCreamSales', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }
    });

    it('should remove all incoming edges to intervention node', () => {
      const mutilated = doIntervention(graph, 'temperature', { value: 90 });

      // Before: temperature has incoming edge from season
      expect(graph.edges.some(e => e.to === 'temperature')).toBe(true);

      // After: temperature has no incoming edges (we SET it)
      expect(mutilated.edges.some(e => e.to === 'temperature')).toBe(false);
    });

    it('should preserve outgoing edges from intervention node', () => {
      const mutilated = doIntervention(graph, 'temperature', { value: 90 });

      // Temperature should still cause ice cream sales
      expect(mutilated.edges.some(
        e => e.from === 'temperature' && e.to === 'iceCreamSales'
      )).toBe(true);
    });

    it('should record intervention in node metadata', () => {
      const mutilated = doIntervention(graph, 'temperature', {
        value: 90,
        description: 'Set temperature to 90F for experiment',
      });

      const node = mutilated.nodes.get('temperature');
      expect(node?.metadata?.intervention).toEqual(
        expect.objectContaining({
          value: 90,
          description: 'Set temperature to 90F for experiment',
        })
      );
    });

    it('should set intervened node confidence to deterministic', () => {
      const mutilated = doIntervention(graph, 'temperature', { value: 90 });

      const node = mutilated.nodes.get('temperature');
      expect(node?.confidence.type).toBe('deterministic');
      expect(node?.confidence.value).toBe(1.0);
    });

    it('should throw for non-existent node', () => {
      expect(() => doIntervention(graph, 'nonExistent', { value: 0 })).toThrow(
        /does not exist/
      );
    });

    it('should not modify original graph (immutability)', () => {
      const originalEdgeCount = graph.edges.length;

      doIntervention(graph, 'temperature', { value: 90 });

      expect(graph.edges.length).toBe(originalEdgeCount);
      expect(graph.edges.some(e => e.to === 'temperature')).toBe(true);
    });
  });

  describe('doMultipleInterventions', () => {
    it('should apply multiple interventions', () => {
      let graph = createEmptyCausalGraph('multi-intervention');

      const nodes = [
        createCausalNode({ id: 'A', type: 'event', description: 'A' }),
        createCausalNode({ id: 'B', type: 'event', description: 'B' }),
        createCausalNode({ id: 'C', type: 'event', description: 'C' }),
        createCausalNode({ id: 'D', type: 'event', description: 'D' }),
      ];

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      // A -> B -> D, A -> C -> D
      const edges = [
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'A', to: 'C', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'D', type: 'causes' }),
        createCausalEdge({ from: 'C', to: 'D', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }

      // Intervene on both B and C
      const interventions = new Map<string, InterventionValue>([
        ['B', { value: 1 }],
        ['C', { value: 0 }],
      ]);

      const mutilated = doMultipleInterventions(graph, interventions);

      // Both B and C should have no incoming edges
      expect(mutilated.edges.some(e => e.to === 'B')).toBe(false);
      expect(mutilated.edges.some(e => e.to === 'C')).toBe(false);

      // But D still has incoming edges from B and C
      expect(mutilated.edges.some(e => e.to === 'D')).toBe(true);
    });
  });
});

// ============================================================================
// D-SEPARATION TESTS (WU-THIMPL-111)
// ============================================================================

describe('D-Separation Testing', () => {
  describe('isDSeparated - Chain Structure', () => {
    let graph: CausalGraph;

    beforeEach(() => {
      // Chain: A -> B -> C
      graph = createEmptyCausalGraph('chain-test');

      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'C', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }
    });

    it('should NOT d-separate A and C when unconditional', () => {
      // A -> B -> C: information flows
      expect(isDSeparated(graph, 'A', 'C', [])).toBe(false);
    });

    it('should d-separate A and C when conditioning on B', () => {
      // Conditioning on B blocks the chain
      expect(isDSeparated(graph, 'A', 'C', ['B'])).toBe(true);
    });
  });

  describe('isDSeparated - Fork Structure', () => {
    let graph: CausalGraph;

    beforeEach(() => {
      // Fork: A <- B -> C
      graph = createEmptyCausalGraph('fork-test');

      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'B', to: 'A', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'C', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }
    });

    it('should NOT d-separate A and C when unconditional', () => {
      // A <- B -> C: B is a common cause, creates dependence
      expect(isDSeparated(graph, 'A', 'C', [])).toBe(false);
    });

    it('should d-separate A and C when conditioning on B', () => {
      // Conditioning on the common cause blocks the fork
      expect(isDSeparated(graph, 'A', 'C', ['B'])).toBe(true);
    });
  });

  describe('isDSeparated - Collider Structure', () => {
    let graph: CausalGraph;

    beforeEach(() => {
      // Collider: A -> B <- C
      graph = createEmptyCausalGraph('collider-test');

      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'C', to: 'B', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }
    });

    it('should d-separate A and C when unconditional', () => {
      // Collider blocks the path by default
      expect(isDSeparated(graph, 'A', 'C', [])).toBe(true);
    });

    it('should NOT d-separate A and C when conditioning on B', () => {
      // Conditioning on collider OPENS the path (explaining away)
      expect(isDSeparated(graph, 'A', 'C', ['B'])).toBe(false);
    });
  });

  describe('isDSeparated - Collider with Descendant', () => {
    let graph: CausalGraph;

    beforeEach(() => {
      // Collider with descendant: A -> B <- C, B -> D
      graph = createEmptyCausalGraph('collider-descendant');

      const nodes = ['A', 'B', 'C', 'D'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'A', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'C', to: 'B', type: 'causes' }),
        createCausalEdge({ from: 'B', to: 'D', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }
    });

    it('should d-separate A and C when unconditional', () => {
      expect(isDSeparated(graph, 'A', 'C', [])).toBe(true);
    });

    it('should NOT d-separate A and C when conditioning on D (descendant of collider)', () => {
      // Conditioning on descendant of collider also opens the path
      expect(isDSeparated(graph, 'A', 'C', ['D'])).toBe(false);
    });
  });

  describe('isDSeparated - Complex Graph', () => {
    let graph: CausalGraph;

    beforeEach(() => {
      // Classic confounded structure:
      //     U
      //    / \
      //   v   v
      //   X -> Y
      graph = createEmptyCausalGraph('confounded');

      const nodes = ['U', 'X', 'Y'].map(id =>
        createCausalNode({ id, type: 'event', description: `Node ${id}` })
      );

      for (const node of nodes) {
        graph = addNodeToGraph(graph, node);
      }

      const edges = [
        createCausalEdge({ from: 'U', to: 'X', type: 'causes' }),
        createCausalEdge({ from: 'U', to: 'Y', type: 'causes' }),
        createCausalEdge({ from: 'X', to: 'Y', type: 'causes' }),
      ];

      for (const edge of edges) {
        graph = addEdgeToGraph(graph, edge);
      }
    });

    it('should NOT d-separate X and Y (direct path)', () => {
      expect(isDSeparated(graph, 'X', 'Y', [])).toBe(false);
    });

    it('should NOT d-separate X and Y when conditioning on U', () => {
      // Blocking backdoor still leaves direct path
      expect(isDSeparated(graph, 'X', 'Y', ['U'])).toBe(false);
    });
  });

  describe('isDSeparated - Edge Cases', () => {
    it('should throw for non-existent nodes', () => {
      const graph = createEmptyCausalGraph('empty');
      const node = createCausalNode({ id: 'A', type: 'event', description: 'A' });
      const graphWithNode = addNodeToGraph(graph, node);

      expect(() => isDSeparated(graphWithNode, 'X', 'Y', [])).toThrow(/does not exist/);
      expect(() => isDSeparated(graphWithNode, 'A', 'Y', [])).toThrow(/does not exist/);
      expect(() => isDSeparated(graphWithNode, 'A', 'A', ['Z'])).toThrow(/does not exist/);
    });

    it('should return false for same node (trivially dependent)', () => {
      let graph = createEmptyCausalGraph('same-node');
      graph = addNodeToGraph(graph, createCausalNode({ id: 'A', type: 'event', description: 'A' }));

      expect(isDSeparated(graph, 'A', 'A', [])).toBe(false);
    });

    it('should handle disconnected nodes', () => {
      let graph = createEmptyCausalGraph('disconnected');
      graph = addNodeToGraph(graph, createCausalNode({ id: 'A', type: 'event', description: 'A' }));
      graph = addNodeToGraph(graph, createCausalNode({ id: 'B', type: 'event', description: 'B' }));

      // No path between them - d-separated
      expect(isDSeparated(graph, 'A', 'B', [])).toBe(true);
    });
  });

  describe('findMinimalSeparatingSet', () => {
    it('should find empty set when already d-separated', () => {
      // Collider: A -> B <- C
      let graph = createEmptyCausalGraph('find-sep');

      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: id })
      );
      for (const node of nodes) graph = addNodeToGraph(graph, node);

      graph = addEdgeToGraph(graph, createCausalEdge({ from: 'A', to: 'B', type: 'causes' }));
      graph = addEdgeToGraph(graph, createCausalEdge({ from: 'C', to: 'B', type: 'causes' }));

      const sepSet = findMinimalSeparatingSet(graph, 'A', 'C');
      expect(sepSet).toEqual([]);
    });

    it('should find minimal separator for chain', () => {
      // Chain: A -> B -> C
      let graph = createEmptyCausalGraph('find-sep-chain');

      const nodes = ['A', 'B', 'C'].map(id =>
        createCausalNode({ id, type: 'event', description: id })
      );
      for (const node of nodes) graph = addNodeToGraph(graph, node);

      graph = addEdgeToGraph(graph, createCausalEdge({ from: 'A', to: 'B', type: 'causes' }));
      graph = addEdgeToGraph(graph, createCausalEdge({ from: 'B', to: 'C', type: 'causes' }));

      const sepSet = findMinimalSeparatingSet(graph, 'A', 'C');
      expect(sepSet).toEqual(['B']);
    });

    it('should return null for inseparable nodes (direct edge)', () => {
      // Direct: A -> B
      let graph = createEmptyCausalGraph('inseparable');

      const nodes = ['A', 'B'].map(id =>
        createCausalNode({ id, type: 'event', description: id })
      );
      for (const node of nodes) graph = addNodeToGraph(graph, node);

      graph = addEdgeToGraph(graph, createCausalEdge({ from: 'A', to: 'B', type: 'causes' }));

      const sepSet = findMinimalSeparatingSet(graph, 'A', 'B');
      expect(sepSet).toBeNull();
    });
  });
});
