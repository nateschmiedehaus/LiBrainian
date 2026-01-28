/**
 * @fileoverview Tests for Transitive Defeat Propagation (WU-THIMPL-103)
 *
 * Tests cover:
 * - propagateDefeat function finding transitively affected claims
 * - applyTransitiveDefeat marking claims as stale
 * - getDependencyGraph for visualization
 * - Edge cases: cycles, missing claims, deep graphs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  propagateDefeat,
  applyTransitiveDefeat,
  getDependencyGraph,
  type AffectedClaim,
} from '../defeaters.js';
import { createEvidenceGraphStorage, type EvidenceGraphStorage } from '../storage.js';
import {
  createClaim,
  createClaimId,
  type Claim,
  type EvidenceEdge,
} from '../types.js';
import { deterministic } from '../confidence.js';

describe('Transitive Defeat Propagation (WU-THIMPL-103)', () => {
  let storage: EvidenceGraphStorage;
  let dbPath: string;
  const testDir = join(tmpdir(), 'librarian-transitive-defeat-test-' + Date.now());
  const workspace = '/test/workspace';

  beforeEach(async () => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `test-${Date.now()}.db`);
    storage = createEvidenceGraphStorage(dbPath, workspace);
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

  const createTestClaim = (id: string, proposition: string): Claim =>
    createClaim({
      id,
      proposition,
      type: 'semantic',
      subject: {
        type: 'function',
        id,
        name: id,
      },
      source: {
        type: 'static_analysis',
        id: 'test-analyzer',
      },
      confidence: deterministic(true, 'test_claim'),
      signalStrength: {
        retrieval: 0.8,
        structural: 0.9,
        semantic: 0.7,
        testExecution: 0.6,
        recency: 0.95,
      },
    });

  const createDependsOnEdge = (fromId: string, toId: string): EvidenceEdge => ({
    id: `edge_${fromId}_${toId}`,
    fromClaimId: createClaimId(fromId),
    toClaimId: createClaimId(toId),
    type: 'depends_on',
    strength: 1.0,
    createdAt: new Date().toISOString(),
  });

  const createAssumesEdge = (fromId: string, toId: string): EvidenceEdge => ({
    id: `edge_${fromId}_${toId}`,
    fromClaimId: createClaimId(fromId),
    toClaimId: createClaimId(toId),
    type: 'assumes',
    strength: 0.8,
    createdAt: new Date().toISOString(),
  });

  const createSupportsEdge = (fromId: string, toId: string): EvidenceEdge => ({
    id: `edge_${fromId}_${toId}`,
    fromClaimId: createClaimId(fromId),
    toClaimId: createClaimId(toId),
    type: 'supports',
    strength: 0.9,
    createdAt: new Date().toISOString(),
  });

  describe('propagateDefeat', () => {
    it('should return empty array when no claims depend on defeated claim', async () => {
      const claim = createTestClaim('isolated', 'Isolated claim');
      await storage.upsertClaim(claim);

      const affected = await propagateDefeat(storage, createClaimId('isolated'));

      expect(affected).toHaveLength(0);
    });

    it('should find directly dependent claims', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B depends on A');
      await storage.upsertClaims([claimA, claimB]);

      // B depends on A
      const edge = createDependsOnEdge('B', 'A');
      await storage.upsertEdge(edge);

      const affected = await propagateDefeat(storage, createClaimId('A'));

      expect(affected).toHaveLength(1);
      expect(affected[0].claimId).toBe('B');
      expect(affected[0].depth).toBe(0);
      expect(affected[0].dependencyType).toBe('depends_on');
      expect(affected[0].suggestedAction).toBe('mark_stale');
    });

    it('should find transitively dependent claims', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B depends on A');
      const claimC = createTestClaim('C', 'Claim C depends on B');
      await storage.upsertClaims([claimA, claimB, claimC]);

      // B depends on A, C depends on B
      await storage.upsertEdges([
        createDependsOnEdge('B', 'A'),
        createDependsOnEdge('C', 'B'),
      ]);

      const affected = await propagateDefeat(storage, createClaimId('A'));

      expect(affected).toHaveLength(2);
      const claimB_affected = affected.find((a) => a.claimId === 'B');
      const claimC_affected = affected.find((a) => a.claimId === 'C');

      expect(claimB_affected).toBeDefined();
      expect(claimB_affected!.depth).toBe(0);

      expect(claimC_affected).toBeDefined();
      expect(claimC_affected!.depth).toBe(1);
      expect(claimC_affected!.dependencyPath).toContain('A');
      expect(claimC_affected!.dependencyPath).toContain('B');
    });

    it('should handle assumes edges with investigate action', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B assumes A');
      await storage.upsertClaims([claimA, claimB]);

      // B assumes A
      await storage.upsertEdge(createAssumesEdge('B', 'A'));

      const affected = await propagateDefeat(storage, createClaimId('A'));

      expect(affected).toHaveLength(1);
      expect(affected[0].claimId).toBe('B');
      expect(affected[0].dependencyType).toBe('assumes');
      expect(affected[0].suggestedAction).toBe('investigate');
    });

    it('should handle supports edges (reverse direction)', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B is supported by A');
      await storage.upsertClaims([claimA, claimB]);

      // A supports B
      await storage.upsertEdge(createSupportsEdge('A', 'B'));

      const affected = await propagateDefeat(storage, createClaimId('A'));

      expect(affected).toHaveLength(1);
      expect(affected[0].claimId).toBe('B');
      expect(affected[0].dependencyType).toBe('supports');
      expect(affected[0].suggestedAction).toBe('revalidate');
    });

    it('should respect maxDepth limit', async () => {
      // Create a chain: A <- B <- C <- D <- E
      const claims = ['A', 'B', 'C', 'D', 'E'].map((id) =>
        createTestClaim(id, `Claim ${id}`)
      );
      await storage.upsertClaims(claims);

      await storage.upsertEdges([
        createDependsOnEdge('B', 'A'),
        createDependsOnEdge('C', 'B'),
        createDependsOnEdge('D', 'C'),
        createDependsOnEdge('E', 'D'),
      ]);

      // maxDepth=2 means we stop when depth >= 2
      // B is at depth 0, C is at depth 1, D would be at depth 2 (excluded)
      const affected = await propagateDefeat(storage, createClaimId('A'), 2);

      // Should find B (depth 0) and C (depth 1)
      // D at depth 2 should be excluded since depth >= maxDepth
      expect(affected).toHaveLength(2);
      expect(affected.map((a) => a.claimId)).toContain('B');
      expect(affected.map((a) => a.claimId)).toContain('C');
      expect(affected.map((a) => a.claimId)).not.toContain('D');
      expect(affected.map((a) => a.claimId)).not.toContain('E');
    });

    it('should handle diamond dependencies', async () => {
      // A <- B, A <- C, B <- D, C <- D (diamond)
      const claims = ['A', 'B', 'C', 'D'].map((id) =>
        createTestClaim(id, `Claim ${id}`)
      );
      await storage.upsertClaims(claims);

      await storage.upsertEdges([
        createDependsOnEdge('B', 'A'),
        createDependsOnEdge('C', 'A'),
        createDependsOnEdge('D', 'B'),
        createDependsOnEdge('D', 'C'),
      ]);

      const affected = await propagateDefeat(storage, createClaimId('A'));

      // B, C at depth 0; D at depth 1 (only counted once)
      expect(affected).toHaveLength(3);
      const claimIds = affected.map((a) => a.claimId);
      expect(claimIds).toContain('B');
      expect(claimIds).toContain('C');
      expect(claimIds).toContain('D');

      // D should only appear once
      expect(claimIds.filter((id) => id === 'D')).toHaveLength(1);
    });

    it('should handle cycles without infinite loop', async () => {
      // A <- B <- C <- A (cycle)
      const claims = ['A', 'B', 'C'].map((id) =>
        createTestClaim(id, `Claim ${id}`)
      );
      await storage.upsertClaims(claims);

      await storage.upsertEdges([
        createDependsOnEdge('B', 'A'),
        createDependsOnEdge('C', 'B'),
        createDependsOnEdge('A', 'C'), // Cycle back to A
      ]);

      // Should complete without hanging
      const affected = await propagateDefeat(storage, createClaimId('A'));

      // B and C should be found (A won't be re-added since it's the source)
      expect(affected.length).toBeGreaterThanOrEqual(2);
      expect(affected.map((a) => a.claimId)).toContain('B');
      expect(affected.map((a) => a.claimId)).toContain('C');
    });
  });

  describe('applyTransitiveDefeat', () => {
    it('should mark affected claims as stale', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B depends on A');
      await storage.upsertClaims([claimA, claimB]);
      await storage.upsertEdge(createDependsOnEdge('B', 'A'));

      const affected = await propagateDefeat(storage, createClaimId('A'));
      const staleCount = await applyTransitiveDefeat(
        storage,
        createClaimId('A'),
        affected,
        false
      );

      expect(staleCount).toBe(1);

      const updatedB = await storage.getClaim(createClaimId('B'));
      expect(updatedB!.status).toBe('stale');
    });

    it('should create defeaters when enabled', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B depends on A');
      await storage.upsertClaims([claimA, claimB]);
      await storage.upsertEdge(createDependsOnEdge('B', 'A'));

      const affected = await propagateDefeat(storage, createClaimId('A'));
      await applyTransitiveDefeat(storage, createClaimId('A'), affected, true);

      const defeaters = await storage.getDefeatersForClaim(createClaimId('B'));
      expect(defeaters.length).toBeGreaterThan(0);
      expect(defeaters[0].type).toBe('new_info');
      expect(defeaters[0].description).toContain('A');
    });

    it('should not mark already defeated claims', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = { ...createTestClaim('B', 'Claim B'), status: 'defeated' as const };
      await storage.upsertClaims([claimA, claimB]);
      await storage.upsertEdge(createDependsOnEdge('B', 'A'));

      const affected = await propagateDefeat(storage, createClaimId('A'));
      const staleCount = await applyTransitiveDefeat(
        storage,
        createClaimId('A'),
        affected,
        false
      );

      // B was already defeated, so no new stale claims
      expect(staleCount).toBe(0);
    });

    it('should handle empty affected claims', async () => {
      const staleCount = await applyTransitiveDefeat(
        storage,
        createClaimId('nonexistent'),
        [],
        false
      );

      expect(staleCount).toBe(0);
    });
  });

  describe('getDependencyGraph', () => {
    it('should build downstream dependency graph', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B depends on A');
      const claimC = createTestClaim('C', 'Claim C depends on A');
      await storage.upsertClaims([claimA, claimB, claimC]);

      await storage.upsertEdges([
        createDependsOnEdge('B', 'A'),
        createDependsOnEdge('C', 'A'),
      ]);

      const graph = await getDependencyGraph(storage, createClaimId('A'), 'downstream');

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.nodes.find((n) => n.id === 'A')!.depth).toBe(0);
      expect(graph.nodes.find((n) => n.id === 'B')!.depth).toBe(1);
      expect(graph.nodes.find((n) => n.id === 'C')!.depth).toBe(1);
    });

    it('should build upstream dependency graph', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = createTestClaim('B', 'Claim B');
      const claimC = createTestClaim('C', 'Claim C depends on A and B');
      await storage.upsertClaims([claimA, claimB, claimC]);

      await storage.upsertEdges([
        createDependsOnEdge('C', 'A'),
        createDependsOnEdge('C', 'B'),
      ]);

      const graph = await getDependencyGraph(storage, createClaimId('C'), 'upstream');

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges).toHaveLength(2);
      expect(graph.nodes.find((n) => n.id === 'C')!.depth).toBe(0);
      expect(graph.nodes.find((n) => n.id === 'A')!.depth).toBe(1);
      expect(graph.nodes.find((n) => n.id === 'B')!.depth).toBe(1);
    });

    it('should respect maxDepth', async () => {
      const claims = ['A', 'B', 'C', 'D'].map((id) =>
        createTestClaim(id, `Claim ${id}`)
      );
      await storage.upsertClaims(claims);

      await storage.upsertEdges([
        createDependsOnEdge('B', 'A'),
        createDependsOnEdge('C', 'B'),
        createDependsOnEdge('D', 'C'),
      ]);

      const graph = await getDependencyGraph(storage, createClaimId('A'), 'downstream', 1);

      // Should only include A (depth 0) and B (depth 1)
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.map((n) => n.id)).toContain('A');
      expect(graph.nodes.map((n) => n.id)).toContain('B');
    });

    it('should include claim status in nodes', async () => {
      const claimA = createTestClaim('A', 'Claim A');
      const claimB = { ...createTestClaim('B', 'Claim B'), status: 'stale' as const };
      await storage.upsertClaims([claimA, claimB]);
      await storage.upsertEdge(createDependsOnEdge('B', 'A'));

      const graph = await getDependencyGraph(storage, createClaimId('A'), 'downstream');

      expect(graph.nodes.find((n) => n.id === 'A')!.status).toBe('active');
      expect(graph.nodes.find((n) => n.id === 'B')!.status).toBe('stale');
    });
  });
});
