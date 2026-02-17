/**
 * @fileoverview Tests for Evidence Graph Storage Layer
 *
 * Tests cover:
 * - Storage initialization and lifecycle
 * - Claims CRUD operations
 * - Edges CRUD operations
 * - Defeaters CRUD and state transitions
 * - Contradictions CRUD and resolution
 * - Graph traversal and path finding
 * - Statistics computation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createEvidenceGraphStorage,
  SqliteEvidenceGraphStorage,
  type EvidenceGraphStorage,
} from '../storage.js';
import {
  createClaim,
  createClaimId,
  createDefeater,
  createContradiction,
  createEmptyEvidenceGraph,
  type Claim,
  type EvidenceEdge,
  type ExtendedDefeater,
  type Contradiction,
} from '../types.js';
import { deterministic } from '../confidence.js';

describe('Evidence Graph Storage', () => {
  let storage: EvidenceGraphStorage;
  let dbPath: string;
  let testDir: string;
  const workspace = '/test/workspace';

  beforeEach(async () => {
    // Use a unique directory per test to avoid cross-worker collisions (SQLite WAL files, cleanup races).
    testDir = mkdtempSync(join(tmpdir(), 'librarian-test-'));
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, `test-${randomUUID()}.db`);
    storage = createEvidenceGraphStorage(dbPath, workspace);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    // Clean up test database
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
        unlinkSync(dbPath + '-wal');
        unlinkSync(dbPath + '-shm');
      } catch {
        // Ignore cleanup errors
      }
    }
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Initialization', () => {
    it('should initialize storage', async () => {
      expect(storage.isInitialized()).toBe(true);
    });

    it('should handle multiple initialization calls', async () => {
      await storage.initialize();
      await storage.initialize();
      expect(storage.isInitialized()).toBe(true);
    });

    it('should close and reopen', async () => {
      await storage.close();
      expect(storage.isInitialized()).toBe(false);

      await storage.initialize();
      expect(storage.isInitialized()).toBe(true);
    });
  });

  describe('Claims CRUD', () => {
    const createTestClaim = (id: string, proposition: string): Claim =>
      createClaim({
        id,
        proposition,
        type: 'semantic',
        subject: {
          type: 'function',
          id: 'test-func',
          name: 'testFunction',
          location: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
        source: { type: 'llm', id: 'test-model', version: '1.0' },
        confidence: deterministic(true, 'test_claim'),
        signalStrength: {
          retrieval: 0.8,
          structural: 0.9,
          semantic: 0.7,
          testExecution: 0.6,
          recency: 0.95,
        },
      });

    it('should insert and retrieve a claim', async () => {
      const claim = createTestClaim('claim-1', 'Test proposition');

      await storage.upsertClaim(claim);
      const retrieved = await storage.getClaim(claim.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(claim.id);
      expect(retrieved!.proposition).toBe(claim.proposition);
      expect(retrieved!.type).toBe(claim.type);
      expect(retrieved!.status).toBe('active');
    });

    it('should update an existing claim', async () => {
      const claim = createTestClaim('claim-2', 'Original proposition');
      await storage.upsertClaim(claim);

      const updated = { ...claim, proposition: 'Updated proposition' };
      await storage.upsertClaim(updated);

      const retrieved = await storage.getClaim(claim.id);
      expect(retrieved!.proposition).toBe('Updated proposition');
    });

    it('should delete a claim', async () => {
      const claim = createTestClaim('claim-3', 'To be deleted');
      await storage.upsertClaim(claim);

      await storage.deleteClaim(claim.id);
      const retrieved = await storage.getClaim(claim.id);

      expect(retrieved).toBeNull();
    });

    it('should query claims with filters', async () => {
      const claim1 = createTestClaim('claim-4', 'First claim');
      const claim2 = { ...createTestClaim('claim-5', 'Second claim'), type: 'structural' as const };

      await storage.upsertClaims([claim1, claim2]);

      const semanticClaims = await storage.getClaims({ type: 'semantic' });
      expect(semanticClaims.length).toBe(1);
      expect(semanticClaims[0].id).toBe('claim-4');
    });

    it('should query claims by subject', async () => {
      const claim = createTestClaim('claim-6', 'Subject test');
      await storage.upsertClaim(claim);

      const claims = await storage.getClaimsBySubject('test-func');
      expect(claims.length).toBe(1);
    });

    it('should update claim status', async () => {
      const claim = createTestClaim('claim-7', 'Status test');
      await storage.upsertClaim(claim);

      await storage.updateClaimStatus(claim.id, 'defeated');
      const retrieved = await storage.getClaim(claim.id);

      expect(retrieved!.status).toBe('defeated');
    });

    it('should update claim signal strength', async () => {
      const claim = createTestClaim('claim-8', 'Signal strength test');
      await storage.upsertClaim(claim);

      const newSignalStrength = {
        overall: 0.9,
        retrieval: 0.95,
        structural: 0.9,
        semantic: 0.85,
        testExecution: 0.9,
        recency: 0.95,
        aggregationMethod: 'geometric_mean' as const,
      };

      await storage.updateClaimSignalStrength(claim.id, newSignalStrength);
      const retrieved = await storage.getClaim(claim.id);

      expect(retrieved!.signalStrength.overall).toBeCloseTo(0.9, 2);
      expect(retrieved!.signalStrength.retrieval).toBeCloseTo(0.95, 2);
    });

    it('should filter claims by minimum signal strength', async () => {
      const highSignalClaim = createTestClaim('claim-9', 'High signal');
      const lowSignalClaim = createClaim({
        id: 'claim-10',
        proposition: 'Low signal',
        type: 'semantic',
        subject: { type: 'function', id: 'func', name: 'fn' },
        source: { type: 'llm', id: 'model' },
        confidence: deterministic(true, 'test_claim'),
        signalStrength: {
          retrieval: 0.2,
          structural: 0.2,
          semantic: 0.2,
          testExecution: 0.2,
          recency: 0.2,
        },
      });

      await storage.upsertClaims([highSignalClaim, lowSignalClaim]);

      const highSignalClaims = await storage.getClaims({ minSignalStrength: 0.5 });
      expect(highSignalClaims.length).toBe(1);
      expect(highSignalClaims[0].id).toBe('claim-9');
    });

    it('should paginate claims', async () => {
      const claims = Array.from({ length: 10 }, (_, i) =>
        createTestClaim(`claim-page-${i}`, `Claim ${i}`)
      );
      await storage.upsertClaims(claims);

      const page1 = await storage.getClaims({ limit: 3, offset: 0 });
      const page2 = await storage.getClaims({ limit: 3, offset: 3 });

      expect(page1.length).toBe(3);
      expect(page2.length).toBe(3);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('Edges CRUD', () => {
    const createTestEdge = (id: string, from: string, to: string): EvidenceEdge => ({
      id,
      fromClaimId: createClaimId(from),
      toClaimId: createClaimId(to),
      type: 'supports',
      strength: 0.8,
      createdAt: new Date().toISOString(),
    });

    beforeEach(async () => {
      // Create some claims first
      const claim1 = createClaim({
        id: 'edge-claim-1',
        proposition: 'Claim 1',
        type: 'semantic',
        subject: { type: 'function', id: 'f1', name: 'f1' },
        source: { type: 'llm', id: 'model' },
      });
      const claim2 = createClaim({
        id: 'edge-claim-2',
        proposition: 'Claim 2',
        type: 'semantic',
        subject: { type: 'function', id: 'f2', name: 'f2' },
        source: { type: 'llm', id: 'model' },
      });
      await storage.upsertClaims([claim1, claim2]);
    });

    it('should insert and retrieve an edge', async () => {
      const edge = createTestEdge('edge-1', 'edge-claim-1', 'edge-claim-2');

      await storage.upsertEdge(edge);
      const retrieved = await storage.getEdge(edge.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(edge.id);
      expect(retrieved!.type).toBe('supports');
      expect(retrieved!.strength).toBeCloseTo(0.8, 2);
    });

    it('should get edges from a claim', async () => {
      const edge = createTestEdge('edge-2', 'edge-claim-1', 'edge-claim-2');
      await storage.upsertEdge(edge);

      const edges = await storage.getEdgesFrom(createClaimId('edge-claim-1'));
      expect(edges.length).toBe(1);
      expect(edges[0].toClaimId).toBe('edge-claim-2');
    });

    it('should get edges to a claim', async () => {
      const edge = createTestEdge('edge-3', 'edge-claim-1', 'edge-claim-2');
      await storage.upsertEdge(edge);

      const edges = await storage.getEdgesTo(createClaimId('edge-claim-2'));
      expect(edges.length).toBe(1);
      expect(edges[0].fromClaimId).toBe('edge-claim-1');
    });

    it('should delete an edge', async () => {
      const edge = createTestEdge('edge-4', 'edge-claim-1', 'edge-claim-2');
      await storage.upsertEdge(edge);

      await storage.deleteEdge(edge.id);
      const retrieved = await storage.getEdge(edge.id);

      expect(retrieved).toBeNull();
    });

    it('should delete all edges for a claim', async () => {
      const edge1 = createTestEdge('edge-5', 'edge-claim-1', 'edge-claim-2');
      const edge2 = createTestEdge('edge-6', 'edge-claim-2', 'edge-claim-1');
      await storage.upsertEdges([edge1, edge2]);

      await storage.deleteEdgesForClaim(createClaimId('edge-claim-1'));

      const fromEdges = await storage.getEdgesFrom(createClaimId('edge-claim-1'));
      const toEdges = await storage.getEdgesTo(createClaimId('edge-claim-1'));

      expect(fromEdges.length).toBe(0);
      expect(toEdges.length).toBe(0);
    });

    it('should filter edges by type', async () => {
      const supportsEdge = createTestEdge('edge-7', 'edge-claim-1', 'edge-claim-2');
      const opposesEdge = { ...createTestEdge('edge-8', 'edge-claim-2', 'edge-claim-1'), type: 'opposes' as const };
      await storage.upsertEdges([supportsEdge, opposesEdge]);

      const supports = await storage.getEdges({ type: 'supports' });
      expect(supports.length).toBe(1);
      expect(supports[0].id).toBe('edge-7');
    });

    it('should filter edges by minimum strength', async () => {
      const strongEdge = createTestEdge('edge-9', 'edge-claim-1', 'edge-claim-2');
      const weakEdge = { ...createTestEdge('edge-10', 'edge-claim-2', 'edge-claim-1'), strength: 0.3 };
      await storage.upsertEdges([strongEdge, weakEdge]);

      const strong = await storage.getEdges({ minStrength: 0.5 });
      expect(strong.length).toBe(1);
      expect(strong[0].strength).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('Defeaters CRUD', () => {
    const createTestDefeater = (id: string): ExtendedDefeater =>
      createDefeater({
        type: 'code_change',
        description: 'Test defeater',
        severity: 'partial',
        affectedClaimIds: [createClaimId('claim-1')],
        confidenceReduction: 0.3,
        autoResolvable: false,
      });

    it('should insert and retrieve a defeater', async () => {
      const defeater = createTestDefeater('defeater-1');

      await storage.upsertDefeater(defeater);
      const retrieved = await storage.getDefeater(defeater.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.type).toBe('code_change');
      expect(retrieved!.status).toBe('pending');
    });

    it('should activate a defeater', async () => {
      const defeater = createTestDefeater('defeater-2');
      await storage.upsertDefeater(defeater);

      await storage.activateDefeater(defeater.id);
      const retrieved = await storage.getDefeater(defeater.id);

      expect(retrieved!.status).toBe('active');
      expect(retrieved!.activatedAt).toBeDefined();
    });

    it('should resolve a defeater', async () => {
      const defeater = createTestDefeater('defeater-3');
      await storage.upsertDefeater(defeater);
      await storage.activateDefeater(defeater.id);

      await storage.resolveDefeater(defeater.id);
      const retrieved = await storage.getDefeater(defeater.id);

      expect(retrieved!.status).toBe('resolved');
    });

    it('should get active defeaters', async () => {
      const defeater1 = createTestDefeater('defeater-4');
      const defeater2 = createTestDefeater('defeater-5');
      await storage.upsertDefeaters([defeater1, defeater2]);

      await storage.activateDefeater(defeater1.id);

      const active = await storage.getActiveDefeaters();
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(defeater1.id);
    });

    it('should get defeaters for a claim', async () => {
      const defeater = createDefeater({
        type: 'test_failure',
        description: 'Test failed',
        severity: 'full',
        affectedClaimIds: [createClaimId('target-claim')],
        confidenceReduction: 1.0,
        autoResolvable: false,
      });
      await storage.upsertDefeater(defeater);

      const defeaters = await storage.getDefeatersForClaim(createClaimId('target-claim'));
      expect(defeaters.length).toBe(1);
    });

    it('should filter defeaters by severity', async () => {
      const partialDefeater = createDefeater({
        type: 'staleness',
        description: 'Stale',
        severity: 'partial',
        affectedClaimIds: [createClaimId('c1')],
        confidenceReduction: 0.3,
        autoResolvable: true,
      });
      const fullDefeater = createDefeater({
        type: 'test_failure',
        description: 'Failed',
        severity: 'full',
        affectedClaimIds: [createClaimId('c2')],
        confidenceReduction: 1.0,
        autoResolvable: false,
      });
      await storage.upsertDefeaters([partialDefeater, fullDefeater]);

      const full = await storage.getDefeaters({ severity: 'full' });
      expect(full.length).toBe(1);
      expect(full[0].severity).toBe('full');
    });
  });

  describe('Contradictions CRUD', () => {
    // Helper to create claims needed for contradiction tests
    const createContradictionClaims = async (...ids: string[]) => {
      const claims = ids.map((id) =>
        createClaim({
          id,
          proposition: `Claim ${id}`,
          type: 'semantic',
          subject: { type: 'function', id, name: id },
          source: { type: 'llm', id: 'model' },
        })
      );
      await storage.upsertClaims(claims);
    };

    it('should insert and retrieve a contradiction', async () => {
      await createContradictionClaims('claim-a', 'claim-b');

      const contradiction = createContradiction(
        createClaimId('claim-a'),
        createClaimId('claim-b'),
        'direct',
        'Claims directly contradict each other',
        'significant'
      );

      await storage.upsertContradiction(contradiction);
      const retrieved = await storage.getContradiction(contradiction.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.claimA).toBe('claim-a');
      expect(retrieved!.claimB).toBe('claim-b');
      expect(retrieved!.status).toBe('unresolved');
    });

    it('should resolve a contradiction', async () => {
      await createContradictionClaims('claim-c', 'claim-d');

      const contradiction = createContradiction(
        createClaimId('claim-c'),
        createClaimId('claim-d'),
        'temporal',
        'Time-based conflict'
      );
      await storage.upsertContradiction(contradiction);

      const resolution = {
        method: 'prefer_a' as const,
        explanation: 'Claim A has more recent evidence',
        resolver: 'human',
        resolvedAt: new Date().toISOString(),
        tradeoff: 'May lose older context',
      };

      await storage.resolveContradiction(contradiction.id, resolution);
      const retrieved = await storage.getContradiction(contradiction.id);

      expect(retrieved!.status).toBe('resolved');
      expect(retrieved!.resolution).toBeDefined();
      expect(retrieved!.resolution!.method).toBe('prefer_a');
    });

    it('should get unresolved contradictions', async () => {
      await createContradictionClaims('claim-e', 'claim-f', 'claim-g', 'claim-h');

      const unresolved = createContradiction(
        createClaimId('claim-e'),
        createClaimId('claim-f'),
        'direct',
        'Unresolved'
      );
      const resolved = createContradiction(
        createClaimId('claim-g'),
        createClaimId('claim-h'),
        'direct',
        'Resolved'
      );

      await storage.upsertContradiction(unresolved);
      await storage.upsertContradiction(resolved);
      await storage.resolveContradiction(resolved.id, {
        method: 'both_valid',
        explanation: 'Context dependent',
        resolver: 'system',
        resolvedAt: new Date().toISOString(),
        tradeoff: 'None',
      });

      const unresolvedList = await storage.getUnresolvedContradictions();
      expect(unresolvedList.length).toBe(1);
      expect(unresolvedList[0].id).toBe(unresolved.id);
    });

    it('should get contradictions for a claim', async () => {
      await createContradictionClaims('target-claim', 'other-claim');

      const contradiction = createContradiction(
        createClaimId('target-claim'),
        createClaimId('other-claim'),
        'implicational',
        'Implication conflict'
      );
      await storage.upsertContradiction(contradiction);

      const contradictions = await storage.getContradictionsForClaim(createClaimId('target-claim'));
      expect(contradictions.length).toBe(1);
    });

    it('should filter contradictions by severity', async () => {
      await createContradictionClaims('c1', 'c2', 'c3', 'c4');

      const blocking = createContradiction(
        createClaimId('c1'),
        createClaimId('c2'),
        'direct',
        'Blocking',
        'blocking'
      );
      const minor = createContradiction(
        createClaimId('c3'),
        createClaimId('c4'),
        'scope',
        'Minor',
        'minor'
      );
      await storage.upsertContradiction(blocking);
      await storage.upsertContradiction(minor);

      const blockingList = await storage.getContradictions({ severity: 'blocking' });
      expect(blockingList.length).toBe(1);
      expect(blockingList[0].severity).toBe('blocking');
    });
  });

  describe('Graph Operations', () => {
    beforeEach(async () => {
      // Create a small graph: A -> B -> C, A -> D
      const claims = [
        createClaim({
          id: 'graph-a',
          proposition: 'A',
          type: 'semantic',
          subject: { type: 'function', id: 'a', name: 'a' },
          source: { type: 'llm', id: 'model' },
        }),
        createClaim({
          id: 'graph-b',
          proposition: 'B',
          type: 'semantic',
          subject: { type: 'function', id: 'b', name: 'b' },
          source: { type: 'llm', id: 'model' },
        }),
        createClaim({
          id: 'graph-c',
          proposition: 'C',
          type: 'semantic',
          subject: { type: 'function', id: 'c', name: 'c' },
          source: { type: 'llm', id: 'model' },
        }),
        createClaim({
          id: 'graph-d',
          proposition: 'D',
          type: 'semantic',
          subject: { type: 'function', id: 'd', name: 'd' },
          source: { type: 'llm', id: 'model' },
        }),
      ];
      await storage.upsertClaims(claims);

      const edges: EvidenceEdge[] = [
        {
          id: 'edge-ab',
          fromClaimId: createClaimId('graph-a'),
          toClaimId: createClaimId('graph-b'),
          type: 'supports',
          strength: 0.9,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'edge-bc',
          fromClaimId: createClaimId('graph-b'),
          toClaimId: createClaimId('graph-c'),
          type: 'supports',
          strength: 0.8,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'edge-ad',
          fromClaimId: createClaimId('graph-a'),
          toClaimId: createClaimId('graph-d'),
          type: 'opposes',
          strength: 0.7,
          createdAt: new Date().toISOString(),
        },
      ];
      await storage.upsertEdges(edges);
    });

    it('should traverse from a claim', async () => {
      const result = await storage.traverseFrom(createClaimId('graph-a'), 3);

      expect(result.claims.length).toBe(4);
      expect(result.edges.length).toBe(3);
      expect(result.maxDepth).toBeGreaterThanOrEqual(2);
    });

    it('should respect max depth in traversal', async () => {
      const result = await storage.traverseFrom(createClaimId('graph-a'), 1);

      // At depth 1, we should get A, B, D but not C
      expect(result.claims.length).toBe(3);
      expect(result.maxDepth).toBe(1);
    });

    it('should find path between claims', async () => {
      const path = await storage.findPath(
        createClaimId('graph-a'),
        createClaimId('graph-c')
      );

      expect(path.length).toBe(2);
      expect(path[0].fromClaimId).toBe('graph-a');
      expect(path[0].toClaimId).toBe('graph-b');
      expect(path[1].fromClaimId).toBe('graph-b');
      expect(path[1].toClaimId).toBe('graph-c');
    });

    it('should return empty path when no connection exists', async () => {
      const path = await storage.findPath(
        createClaimId('graph-c'),
        createClaimId('graph-a')
      );

      expect(path.length).toBe(0);
    });

    it('should get and save full graph', async () => {
      const graph = await storage.getFullGraph(workspace);

      expect(graph.claims.size).toBe(4);
      expect(graph.edges.length).toBe(3);
      expect(graph.meta.claimCount).toBe(4);

      // Modify and save
      const newClaim = createClaim({
        id: 'graph-e',
        proposition: 'E',
        type: 'semantic',
        subject: { type: 'function', id: 'e', name: 'e' },
        source: { type: 'llm', id: 'model' },
      });
      graph.claims.set(newClaim.id, newClaim);
      graph.meta.claimCount = 5;

      await storage.saveFullGraph(graph);

      const reloaded = await storage.getFullGraph(workspace);
      expect(reloaded.claims.size).toBe(5);
    });
  });

  describe('Graph Statistics', () => {
    it('should compute correct statistics', async () => {
      // Create test data
      const claims = [
        createClaim({
          id: 'stats-1',
          proposition: 'Stats 1',
          type: 'semantic',
          subject: { type: 'function', id: 's1', name: 's1' },
          source: { type: 'llm', id: 'model' },
        }),
        createClaim({
          id: 'stats-2',
          proposition: 'Stats 2',
          type: 'semantic',
          subject: { type: 'function', id: 's2', name: 's2' },
          source: { type: 'llm', id: 'model' },
        }),
      ];
      await storage.upsertClaims(claims);

      const edge: EvidenceEdge = {
        id: 'stats-edge',
        fromClaimId: createClaimId('stats-1'),
        toClaimId: createClaimId('stats-2'),
        type: 'supports',
        strength: 0.9,
        createdAt: new Date().toISOString(),
      };
      await storage.upsertEdge(edge);

      const defeater = createDefeater({
        type: 'staleness',
        description: 'Stale',
        severity: 'warning',
        affectedClaimIds: [createClaimId('stats-1')],
        confidenceReduction: 0.1,
        autoResolvable: true,
      });
      await storage.upsertDefeater(defeater);
      await storage.activateDefeater(defeater.id);

      const contradiction = createContradiction(
        createClaimId('stats-1'),
        createClaimId('stats-2'),
        'direct',
        'Test contradiction'
      );
      await storage.upsertContradiction(contradiction);

      const stats = await storage.getGraphStats();

      expect(stats.claimCount).toBe(2);
      expect(stats.edgeCount).toBe(1);
      expect(stats.activeDefeaterCount).toBe(1);
      expect(stats.unresolvedContradictionCount).toBe(1);
      expect(stats.avgSignalStrength).toBeGreaterThan(0);
    });

    it('should count stale claims', async () => {
      const activeClaim = createClaim({
        id: 'active-claim',
        proposition: 'Active',
        type: 'semantic',
        subject: { type: 'function', id: 'a', name: 'a' },
        source: { type: 'llm', id: 'model' },
      });
      const staleClaim = createClaim({
        id: 'stale-claim',
        proposition: 'Stale',
        type: 'semantic',
        subject: { type: 'function', id: 's', name: 's' },
        source: { type: 'llm', id: 'model' },
      });
      await storage.upsertClaims([activeClaim, staleClaim]);
      await storage.updateClaimStatus(staleClaim.id, 'stale');

      const stats = await storage.getGraphStats();
      expect(stats.staleClaims).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should throw when not initialized', async () => {
      await storage.close();

      await expect(storage.getClaim(createClaimId('any'))).rejects.toThrow(
        'Storage not initialized'
      );
    });

    it('should require resolution for resolveContradiction', async () => {
      // Create claims first to satisfy foreign key constraint
      const claims = [
        createClaim({
          id: 'err-c1',
          proposition: 'C1',
          type: 'semantic',
          subject: { type: 'function', id: 'c1', name: 'c1' },
          source: { type: 'llm', id: 'model' },
        }),
        createClaim({
          id: 'err-c2',
          proposition: 'C2',
          type: 'semantic',
          subject: { type: 'function', id: 'c2', name: 'c2' },
          source: { type: 'llm', id: 'model' },
        }),
      ];
      await storage.upsertClaims(claims);

      const contradiction = createContradiction(
        createClaimId('err-c1'),
        createClaimId('err-c2'),
        'direct',
        'Test'
      );
      await storage.upsertContradiction(contradiction);

      await expect(
        storage.resolveContradiction(contradiction.id, undefined as any)
      ).rejects.toThrow('Resolution required');
    });
  });

  describe('Edge Cases', () => {
    it('should handle claims with null location', async () => {
      const claim = createClaim({
        id: 'no-location',
        proposition: 'No location',
        type: 'semantic',
        subject: { type: 'module', id: 'm1', name: 'module1' },
        source: { type: 'llm', id: 'model' },
      });
      await storage.upsertClaim(claim);

      const retrieved = await storage.getClaim(claim.id);
      expect(retrieved!.subject.location).toBeUndefined();
    });

    it('should handle edge with metadata', async () => {
      const claim1 = createClaim({
        id: 'meta-1',
        proposition: 'Meta 1',
        type: 'semantic',
        subject: { type: 'function', id: 'f1', name: 'f1' },
        source: { type: 'llm', id: 'model' },
      });
      const claim2 = createClaim({
        id: 'meta-2',
        proposition: 'Meta 2',
        type: 'semantic',
        subject: { type: 'function', id: 'f2', name: 'f2' },
        source: { type: 'llm', id: 'model' },
      });
      await storage.upsertClaims([claim1, claim2]);

      const edge: EvidenceEdge = {
        id: 'meta-edge',
        fromClaimId: createClaimId('meta-1'),
        toClaimId: createClaimId('meta-2'),
        type: 'supports',
        strength: 0.9,
        createdAt: new Date().toISOString(),
        metadata: { reason: 'test', count: 5 },
      };
      await storage.upsertEdge(edge);

      const retrieved = await storage.getEdge(edge.id);
      expect(retrieved!.metadata).toEqual({ reason: 'test', count: 5 });
    });

    it('should handle defeaters with multiple affected claims', async () => {
      const defeater = createDefeater({
        type: 'code_change',
        description: 'Multi-claim defeater',
        severity: 'partial',
        affectedClaimIds: [
          createClaimId('c1'),
          createClaimId('c2'),
          createClaimId('c3'),
        ],
        confidenceReduction: 0.2,
        autoResolvable: false,
      });
      await storage.upsertDefeater(defeater);

      const retrieved = await storage.getDefeater(defeater.id);
      expect(retrieved!.affectedClaimIds.length).toBe(3);
    });

    it('should calculate graph health based on defeaters and contradictions', async () => {
      // Empty graph should have health 1.0
      const emptyGraph = await storage.getFullGraph(workspace);
      expect(emptyGraph.meta.health).toBe(1);

      // Add many defeaters and contradictions
      const claims = Array.from({ length: 10 }, (_, i) =>
        createClaim({
          id: `health-${i}`,
          proposition: `Health ${i}`,
          type: 'semantic',
          subject: { type: 'function', id: `h${i}`, name: `h${i}` },
          source: { type: 'llm', id: 'model' },
        })
      );
      await storage.upsertClaims(claims);

      // Add active defeaters
      for (let i = 0; i < 5; i++) {
        const defeater = createDefeater({
          type: 'staleness',
          description: `Defeater ${i}`,
          severity: 'partial',
          affectedClaimIds: [createClaimId(`health-${i}`)],
          confidenceReduction: 0.2,
          autoResolvable: false,
        });
        await storage.upsertDefeater(defeater);
        await storage.activateDefeater(defeater.id);
      }

      // Add contradictions
      for (let i = 0; i < 3; i++) {
        const contradiction = createContradiction(
          createClaimId(`health-${i * 2}`),
          createClaimId(`health-${i * 2 + 1}`),
          'direct',
          'Test'
        );
        await storage.upsertContradiction(contradiction);
      }

      const graph = await storage.getFullGraph(workspace);
      expect(graph.meta.health).toBeLessThan(1);
    });
  });
});
