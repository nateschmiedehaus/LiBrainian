/**
 * Tests for Knowledge Graph Builder and Query Engine
 *
 * Tests for:
 * - Edge building from various sources
 * - Clone cluster detection
 * - Debt hotspot identification
 * - Ownership mapping
 * - Impact analysis
 * - Evolution timeline
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildKnowledgeGraph,
  getCloneClusters,
  getDebtHotspots,
  getOwnershipMap,
  analyzeImpact,
  extractSubgraph,
} from '../knowledge_graph.js';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import type { LibrarianStorage, KnowledgeGraphEdge, CloneEntry, DebtMetrics, BlameEntry, GraphEdge, FunctionKnowledge } from '../../storage/types.js';

// Helper to create complete DebtMetrics with defaults
function createDebtMetrics(partial: Partial<DebtMetrics> & Pick<DebtMetrics, 'entityId' | 'entityType' | 'totalDebt' | 'trend'>): DebtMetrics {
  return {
    complexityDebt: 0,
    duplicationDebt: 0,
    couplingDebt: 0,
    coverageDebt: 0,
    architectureDebt: 0,
    churnDebt: 0,
    documentationDebt: 0,
    securityDebt: 0,
    trendDelta: 0,
    velocityPerDay: 0,
    estimatedFixHours: 0,
    priority: 'low',
    recommendations: [],
    confidenceAlpha: 1,
    confidenceBeta: 1,
    computedAt: new Date().toISOString(),
    ...partial,
  };
}

function createFunctionKnowledge(
  partial: Pick<FunctionKnowledge, 'id' | 'filePath' | 'name'> & Partial<FunctionKnowledge>
): FunctionKnowledge {
  return {
    signature: `function ${partial.name}()`,
    purpose: `${partial.name} purpose`,
    startLine: 1,
    endLine: 1,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: {
      successes: 0,
      failures: 0,
    },
    ...partial,
  };
}

describe('Knowledge Graph', () => {
  let storage: LibrarianStorage;
  let dbPath: string;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), 'knowledge-graph-test-' + Date.now());
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
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Knowledge Edge Storage', () => {
    it('should store and retrieve knowledge edges', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'edge-1',
          sourceId: 'module-a',
          targetId: 'module-b',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 0.95,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'edge-2',
          sourceId: 'func-a',
          targetId: 'func-b',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'calls',
          weight: 0.8,
          confidence: 0.9,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertKnowledgeEdges(edges);

      const retrieved = await storage.getKnowledgeEdges({});
      expect(retrieved).toHaveLength(2);
    });

    it('should filter edges by type', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'import-edge',
          sourceId: 'a',
          targetId: 'b',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'clone-edge',
          sourceId: 'c',
          targetId: 'd',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'clone_of',
          weight: 0.9,
          confidence: 0.85,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertKnowledgeEdges(edges);

      const imports = await storage.getKnowledgeEdges({ edgeType: 'imports' });
      expect(imports).toHaveLength(1);
      expect(imports[0].id).toBe('import-edge');

      const clones = await storage.getKnowledgeEdges({ edgeType: 'clone_of' });
      expect(clones).toHaveLength(1);
      expect(clones[0].id).toBe('clone-edge');
    });

    it('should filter edges by minimum weight', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'strong-edge',
          sourceId: 'a',
          targetId: 'b',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'co_changed',
          weight: 0.9,
          confidence: 0.95,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'weak-edge',
          sourceId: 'c',
          targetId: 'd',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'co_changed',
          weight: 0.2,
          confidence: 0.5,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertKnowledgeEdges(edges);

      const strongEdges = await storage.getKnowledgeEdges({ minWeight: 0.5 });
      expect(strongEdges).toHaveLength(1);
      expect(strongEdges[0].id).toBe('strong-edge');
    });

    it('should get edges from a specific source', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'edge-1',
          sourceId: 'node-a',
          targetId: 'node-b',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'edge-2',
          sourceId: 'node-a',
          targetId: 'node-c',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'edge-3',
          sourceId: 'node-x',
          targetId: 'node-y',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertKnowledgeEdges(edges);

      const fromA = await storage.getKnowledgeEdgesFrom('node-a');
      expect(fromA).toHaveLength(2);
    });

    it('should get edges to a specific target', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'edge-1',
          sourceId: 'a',
          targetId: 'target-node',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'depends_on',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
        {
          id: 'edge-2',
          sourceId: 'b',
          targetId: 'target-node',
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'depends_on',
          weight: 1.0,
          confidence: 1.0,
          metadata: {},
          computedAt: new Date().toISOString(),
        },
      ];

      await storage.upsertKnowledgeEdges(edges);

      const toTarget = await storage.getKnowledgeEdgesTo('target-node');
      expect(toTarget).toHaveLength(2);
    });
  });

  describe('Clone Clusters', () => {
    it('should find clone clusters from clone edges', async () => {
      // Set up clone entries
      const cloneEntries: CloneEntry[] = [
        { cloneGroupId: 1, entityId1: 'func-a', entityId2: 'func-b', entityType: 'function', similarity: 0.95, cloneType: 'type2', refactoringPotential: 0.8, computedAt: new Date().toISOString() },
        { cloneGroupId: 1, entityId1: 'func-a', entityId2: 'func-c', entityType: 'function', similarity: 0.90, cloneType: 'type2', refactoringPotential: 0.75, computedAt: new Date().toISOString() },
        { cloneGroupId: 1, entityId1: 'func-b', entityId2: 'func-c', entityType: 'function', similarity: 0.88, cloneType: 'type2', refactoringPotential: 0.7, computedAt: new Date().toISOString() },
      ];
      await storage.upsertCloneEntries(cloneEntries);

      // Create corresponding knowledge edges
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'clone-1',
          sourceId: 'func-a',
          targetId: 'func-b',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'clone_of',
          weight: 0.95,
          confidence: 0.85,
          metadata: { cloneType: 'type2', cloneGroupId: 1 },
          computedAt: new Date().toISOString(),
        },
        {
          id: 'clone-2',
          sourceId: 'func-a',
          targetId: 'func-c',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'clone_of',
          weight: 0.90,
          confidence: 0.85,
          metadata: { cloneType: 'type2', cloneGroupId: 1 },
          computedAt: new Date().toISOString(),
        },
        {
          id: 'clone-3',
          sourceId: 'func-b',
          targetId: 'func-c',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'clone_of',
          weight: 0.88,
          confidence: 0.85,
          metadata: { cloneType: 'type2', cloneGroupId: 1 },
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const clusters = await getCloneClusters(storage, { minClusterSize: 2, minSimilarity: 0.7 });

      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0].members.length).toBeGreaterThanOrEqual(2);
      expect(clusters[0].avgSimilarity).toBeGreaterThan(0.8);
    });

    it('should calculate refactoring potential', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'exact-clone',
          sourceId: 'a',
          targetId: 'b',
          sourceType: 'function',
          targetType: 'function',
          edgeType: 'clone_of',
          weight: 0.99,
          confidence: 0.95,
          metadata: { cloneType: 'exact', cloneGroupId: 1 },
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const clusters = await getCloneClusters(storage);

      if (clusters.length > 0) {
        expect(clusters[0].refactoringPotential).toBeGreaterThanOrEqual(0);
        expect(clusters[0].refactoringPotential).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Debt Hotspots', () => {
    it('should identify high-debt central nodes', async () => {
      // Create debt metrics
      const debtMetrics: DebtMetrics[] = [
        createDebtMetrics({
          entityId: 'central-module',
          entityType: 'module',
          totalDebt: 80,
          complexityDebt: 50,
          couplingDebt: 30,
          trend: 'degrading',
        }),
        createDebtMetrics({
          entityId: 'peripheral-module',
          entityType: 'module',
          totalDebt: 20,
          complexityDebt: 20,
          trend: 'stable',
        }),
      ];
      await storage.upsertDebtMetrics(debtMetrics);

      // Create graph edges showing central-module is highly connected
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'a', targetId: 'central-module', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'b', targetId: 'central-module', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'c', targetId: 'central-module', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e4', sourceId: 'central-module', targetId: 'd', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const hotspots = await getDebtHotspots(storage, { minDebt: 50, limit: 10 });

      expect(hotspots.length).toBeGreaterThan(0);
      expect(hotspots[0].entityId).toBe('central-module');
      expect(hotspots[0].totalDebt).toBe(80);
      expect(hotspots[0].recommendations.length).toBeGreaterThan(0);
    });

    it('should generate appropriate recommendations', async () => {
      const debtMetrics: DebtMetrics[] = [
        createDebtMetrics({
          entityId: 'complex-module',
          entityType: 'module',
          totalDebt: 70,
          complexityDebt: 60,
          duplicationDebt: 10,
          trend: 'stable',
        }),
      ];
      await storage.upsertDebtMetrics(debtMetrics);

      const hotspots = await getDebtHotspots(storage, { minDebt: 30 });

      if (hotspots.length > 0) {
        const complexHotspot = hotspots.find(h => h.entityId === 'complex-module');
        expect(complexHotspot).toBeDefined();
        // Should have complexity-related recommendation
        const hasComplexityRec = complexHotspot?.recommendations.some(r =>
          r.toLowerCase().includes('complex') || r.toLowerCase().includes('break')
        );
        expect(hasComplexityRec).toBe(true);
      }
    });
  });

  describe('Ownership Map', () => {
    it('should build ownership map from authorship edges', async () => {
      const edges: KnowledgeGraphEdge[] = [
        {
          id: 'auth-1',
          sourceId: 'src/module-a.ts',
          targetId: 'Alice',
          sourceType: 'file',
          targetType: 'author',
          edgeType: 'authored_by',
          weight: 0.7, // 70% ownership
          confidence: 0.95,
          metadata: { linesOwned: 70, totalLines: 100 },
          computedAt: new Date().toISOString(),
        },
        {
          id: 'auth-2',
          sourceId: 'src/module-a.ts',
          targetId: 'Bob',
          sourceType: 'file',
          targetType: 'author',
          edgeType: 'authored_by',
          weight: 0.3, // 30% ownership
          confidence: 0.95,
          metadata: { linesOwned: 30, totalLines: 100 },
          computedAt: new Date().toISOString(),
        },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const ownershipMap = await getOwnershipMap(storage);

      expect(ownershipMap.entities.length).toBeGreaterThan(0);
      const moduleA = ownershipMap.entities.find(e => e.entityId === 'src/module-a.ts');
      expect(moduleA).toBeDefined();
      expect(moduleA?.primaryAuthor).toBe('Alice');
      expect(moduleA?.ownership).toBe(0.7);
    });

    it('should aggregate author summary', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'a1', sourceId: 'file1', targetId: 'Alice', sourceType: 'file', targetType: 'author', edgeType: 'authored_by', weight: 0.8, confidence: 0.95, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'a2', sourceId: 'file2', targetId: 'Alice', sourceType: 'file', targetType: 'author', edgeType: 'authored_by', weight: 0.6, confidence: 0.95, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'a3', sourceId: 'file3', targetId: 'Bob', sourceType: 'file', targetType: 'author', edgeType: 'authored_by', weight: 0.9, confidence: 0.95, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const ownershipMap = await getOwnershipMap(storage);

      expect(ownershipMap.authorSummary['Alice']).toBeDefined();
      expect(ownershipMap.authorSummary['Alice'].totalEntities).toBe(2);
      expect(ownershipMap.authorSummary['Bob']).toBeDefined();
      expect(ownershipMap.authorSummary['Bob'].totalEntities).toBe(1);
    });
  });

  describe('Impact Analysis', () => {
    it('should calculate direct impact', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'target', targetId: 'dependent-1', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'target', targetId: 'dependent-2', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'target', targetId: 'dependent-3', sourceType: 'module', targetType: 'module', edgeType: 'calls', weight: 0.8, confidence: 0.9, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const impact = await analyzeImpact(storage, 'target');

      expect(impact.directImpact.length).toBe(3);
      expect(impact.targetId).toBe('target');
    });

    it('should calculate transitive impact', async () => {
      // target -> a -> b -> c (chain)
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'target', targetId: 'a', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'a', targetId: 'b', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'b', targetId: 'c', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const impact = await analyzeImpact(storage, 'target', { maxDepth: 3 });

      expect(impact.transitiveImpact.length).toBeGreaterThan(0);
      // Should find a, b, c at different depths
      const depths = impact.transitiveImpact.map(i => i.pathLength);
      expect(depths).toContain(1);
    });

    it('should calculate risk score', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'high-risk', targetId: 'dep1', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'high-risk', targetId: 'dep2', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'high-risk', targetId: 'dep3', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const impact = await analyzeImpact(storage, 'high-risk');

      expect(impact.riskScore).toBeGreaterThanOrEqual(0);
      expect(impact.riskScore).toBeLessThanOrEqual(1);
    });

    it('should generate recommendations for high-impact changes', async () => {
      // Create many dependencies
      const edges: KnowledgeGraphEdge[] = [];
      for (let i = 0; i < 15; i++) {
        edges.push({
          id: `e${i}`,
          sourceId: 'central-node',
          targetId: `dep-${i}`,
          sourceType: 'module',
          targetType: 'module',
          edgeType: 'imports',
          weight: 1,
          confidence: 1,
          metadata: {},
          computedAt: new Date().toISOString(),
        });
      }
      await storage.upsertKnowledgeEdges(edges);

      const impact = await analyzeImpact(storage, 'central-node');

      expect(impact.recommendations.length).toBeGreaterThan(0);
      expect(impact.recommendations.some(r => r.toLowerCase().includes('fan-out') || r.toLowerCase().includes('rollout'))).toBe(true);
    });
  });

  describe('Subgraph Extraction', () => {
    it('should extract subgraph around a root node', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'root', targetId: 'child1', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'root', targetId: 'child2', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e3', sourceId: 'child1', targetId: 'grandchild1', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e4', sourceId: 'other', targetId: 'unrelated', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const subgraph = await extractSubgraph(storage, 'root', 2);

      expect(subgraph.nodes.length).toBeGreaterThanOrEqual(3); // root, child1, child2
      expect(subgraph.edges.length).toBeGreaterThanOrEqual(2);
      // Nodes are objects with id property - check node IDs
      const nodeIds = subgraph.nodes.map(n => n.id);
      // Should not include 'other' or 'unrelated'
      expect(nodeIds).not.toContain('other');
      expect(nodeIds).not.toContain('unrelated');
    });

    it('should filter by edge types', async () => {
      const edges: KnowledgeGraphEdge[] = [
        { id: 'e1', sourceId: 'root', targetId: 'import-child', sourceType: 'module', targetType: 'module', edgeType: 'imports', weight: 1, confidence: 1, metadata: {}, computedAt: new Date().toISOString() },
        { id: 'e2', sourceId: 'root', targetId: 'clone-child', sourceType: 'function', targetType: 'function', edgeType: 'clone_of', weight: 0.9, confidence: 0.85, metadata: {}, computedAt: new Date().toISOString() },
      ];
      await storage.upsertKnowledgeEdges(edges);

      const importsOnly = await extractSubgraph(storage, 'root', 1, ['imports']);

      // Nodes are objects with id property - check node IDs
      const nodeIds = importsOnly.nodes.map(n => n.id);
      expect(nodeIds).toContain('import-child');
      expect(nodeIds).not.toContain('clone-child');
    });
  });

  describe('Build Knowledge Graph', () => {
    it('should build graph from clone entries', async () => {
      // Set up clone entries
      const cloneEntries: CloneEntry[] = [
        { cloneGroupId: 1, entityId1: 'func-a', entityId2: 'func-b', entityType: 'function', similarity: 0.95, cloneType: 'type2', refactoringPotential: 0.8, computedAt: new Date().toISOString() },
      ];
      await storage.upsertCloneEntries(cloneEntries);

      const result = await buildKnowledgeGraph({
        workspace: testDir,
        storage,
        includeClones: true,
        includeImports: false,
        includeCalls: false,
        includeCochange: false,
        includeAuthorship: false,
        includeDebt: false,
      });

      expect(result.edgesCreated).toBeGreaterThan(0);
      expect(result.edgesByType['clone_of']).toBeGreaterThan(0);
    });

    it('should track build statistics', async () => {
      const result = await buildKnowledgeGraph({
        workspace: testDir,
        storage,
        includeClones: false,
        includeImports: false,
        includeCalls: false,
        includeCochange: false,
        includeAuthorship: false,
        includeDebt: false,
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.edgesByType).toBeDefined();
      expect(typeof result.nodesDiscovered).toBe('number');
    });

    it('should preserve class and interface entity types for implements edges', async () => {
      const graphEdges: GraphEdge[] = [
        {
          fromId: 'class:PaymentService',
          fromType: 'class',
          toId: 'interface:IPaymentGateway',
          toType: 'interface',
          edgeType: 'implements',
          sourceFile: 'src/payment_service.ts',
          sourceLine: 8,
          confidence: 0.95,
          computedAt: new Date(),
        },
      ];
      await storage.upsertGraphEdges(graphEdges);

      await buildKnowledgeGraph({
        workspace: testDir,
        storage,
        includeClones: false,
        includeImports: true,
        includeCalls: true,
        includeCochange: false,
        includeAuthorship: false,
        includeDebt: false,
      });

      const implementsEdges = await storage.getKnowledgeEdges({ edgeType: 'implements' });
      expect(implementsEdges).toHaveLength(1);
      expect(implementsEdges[0].sourceType).toBe('class');
      expect(implementsEdges[0].targetType).toBe('interface');
    });

    it('builds API endpoint and GraphQL edges from api ingestion payloads', async () => {
      const handlerFunction = createFunctionKnowledge({
        id: 'fn:getUserHandler',
        filePath: 'src/routes/users.ts',
        name: 'getUserHandler',
      });
      const routerFunction = createFunctionKnowledge({
        id: 'fn:routerDispatch',
        filePath: 'src/routes/router.ts',
        name: 'routerDispatch',
      });
      const graphqlResolver = createFunctionKnowledge({
        id: 'fn:getUser',
        filePath: 'src/graphql/resolvers.ts',
        name: 'getUser',
      });

      await storage.upsertFunction(handlerFunction);
      await storage.upsertFunction(routerFunction);
      await storage.upsertFunction(graphqlResolver);

      await storage.upsertGraphEdges([
        {
          fromId: 'fn:routerDispatch',
          fromType: 'function',
          toId: 'fn:getUserHandler',
          toType: 'function',
          edgeType: 'calls',
          sourceFile: 'src/routes/router.ts',
          sourceLine: 12,
          confidence: 0.9,
          computedAt: new Date(),
        },
        {
          fromId: 'fn:getUserHandler',
          fromType: 'function',
          toId: 'fn:loadUserFromDb',
          toType: 'function',
          edgeType: 'calls',
          sourceFile: 'src/routes/users.ts',
          sourceLine: 42,
          confidence: 0.85,
          computedAt: new Date(),
        },
      ]);

      await storage.upsertIngestionItem({
        id: 'api:knowledge',
        sourceType: 'api',
        sourceVersion: 'v1',
        ingestedAt: new Date().toISOString(),
        payload: {
          endpoints: [
            {
              path: '/users/{id}',
              method: 'GET',
              summary: 'Get user',
              requestSchemas: ['GetUserRequest'],
              responseSchemas: ['UserResponse'],
            },
          ],
          graphql: [
            {
              name: 'getUser',
              type: 'query',
              returnType: 'User',
            },
          ],
          graphql_types: ['Query', 'User'],
          openapi_files: ['specs/openapi.yaml'],
          graphql_files: ['src/graphql/schema.graphql'],
          handler_map: {
            'GET /users/{id}': ['src/routes/users.ts'],
          },
        },
        metadata: {},
      });

      await buildKnowledgeGraph({
        workspace: testDir,
        storage,
        includeImports: false,
        includeCalls: true,
        includeClones: false,
        includeCochange: false,
        includeAuthorship: false,
        includeDebt: false,
      });

      const endpointEdges = await storage.getKnowledgeEdges({ targetType: 'endpoint' });
      expect(endpointEdges.some((edge) => edge.targetId === 'endpoint:GET /users/{id}')).toBe(true);

      const handlerEdges = await storage.getKnowledgeEdges({ edgeType: 'implements_endpoint' });
      expect(handlerEdges.some((edge) => edge.sourceId === 'fn:getUserHandler' && edge.targetId === 'endpoint:GET /users/{id}')).toBe(true);

      const callerEdges = await storage.getKnowledgeEdges({ edgeType: 'calls_endpoint' });
      expect(callerEdges.some((edge) => edge.sourceId === 'fn:routerDispatch' && edge.targetId === 'endpoint:GET /users/{id}')).toBe(true);

      const schemaEdges = await storage.getKnowledgeEdges({ edgeType: 'returns_schema' });
      expect(schemaEdges.some((edge) => edge.sourceId === 'endpoint:GET /users/{id}' && edge.targetId === 'schema:UserResponse')).toBe(true);

      const graphqlEdges = await storage.getKnowledgeEdges({ edgeType: 'graphql_resolves' });
      expect(graphqlEdges.some((edge) => edge.sourceId === 'fn:getUser' && edge.targetId === 'graphql_operation:query:getUser')).toBe(true);
    });
  });
});
