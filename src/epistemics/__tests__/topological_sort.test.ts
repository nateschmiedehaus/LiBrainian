/**
 * @fileoverview Tests for Topological Sort in Evidence Chains (WU-THIMPL-204)
 *
 * Tests verify that getChain returns entries in topological order:
 * dependencies come before dependents.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SqliteEvidenceLedger,
  createEvidenceId,
  createSessionId,
  type EvidenceId,
  type EvidenceEntry,
  type EvidenceRelation,
} from '../evidence_ledger.js';
import { deterministic } from '../confidence.js';

describe('Topological Sort in Evidence Chains (WU-THIMPL-204)', () => {
  let ledger: SqliteEvidenceLedger;
  let testDbPath: string;

  beforeEach(async () => {
    // Create a temporary database for testing
    const tmpDir = os.tmpdir();
    testDbPath = path.join(tmpDir, `test-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    ledger = new SqliteEvidenceLedger(testDbPath);
    await ledger.initialize();
  });

  afterEach(async () => {
    await ledger.close();
    try {
      fs.unlinkSync(testDbPath);
      fs.unlinkSync(testDbPath + '-wal');
      fs.unlinkSync(testDbPath + '-shm');
    } catch {
      // Files may not exist
    }
  });

  /**
   * Helper to create a simple extraction evidence entry.
   */
  async function createEntry(
    relatedIds: EvidenceId[] = [],
    customId?: EvidenceId
  ): Promise<EvidenceEntry> {
    const entry = await ledger.append({
      kind: 'extraction',
      payload: {
        filePath: '/test/file.ts',
        extractionType: 'function',
        entity: {
          name: 'testFn',
          kind: 'function',
          location: { file: '/test/file.ts' },
        },
        quality: 'ast_verified',
      },
      provenance: {
        source: 'ast_parser',
        method: 'ts_parser',
      },
      confidence: deterministic(true, 'test'),
      relatedEntries: relatedIds,
    });
    return entry;
  }

  describe('getChain topological ordering', () => {
    it('should order entries so dependencies come first (linear chain)', async () => {
      // Create a linear chain: A -> B -> C (A depends on B, B depends on C)
      const entryC = await createEntry([]); // C has no dependencies (leaf)
      const entryB = await createEntry([entryC.id]); // B depends on C
      const entryA = await createEntry([entryB.id]); // A depends on B (root)

      const chain = await ledger.getChain(entryA.id);

      // Expected order: C first (leaf), then B, then A (root)
      expect(chain.evidence.length).toBe(3);

      const idOrder = chain.evidence.map((e) => e.id);
      const indexC = idOrder.indexOf(entryC.id);
      const indexB = idOrder.indexOf(entryB.id);
      const indexA = idOrder.indexOf(entryA.id);

      // Dependencies should come before dependents
      expect(indexC).toBeLessThan(indexB); // C before B
      expect(indexB).toBeLessThan(indexA); // B before A
    });

    it('should order entries correctly with diamond dependency', async () => {
      // Diamond: A depends on B and C, both B and C depend on D
      //       A
      //      / \
      //     B   C
      //      \ /
      //       D
      const entryD = await createEntry([]); // D is the leaf
      const entryB = await createEntry([entryD.id]);
      const entryC = await createEntry([entryD.id]);
      const entryA = await createEntry([entryB.id, entryC.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.evidence.length).toBe(4);

      const idOrder = chain.evidence.map((e) => e.id);
      const indexD = idOrder.indexOf(entryD.id);
      const indexB = idOrder.indexOf(entryB.id);
      const indexC = idOrder.indexOf(entryC.id);
      const indexA = idOrder.indexOf(entryA.id);

      // D should come before both B and C
      expect(indexD).toBeLessThan(indexB);
      expect(indexD).toBeLessThan(indexC);

      // B and C should both come before A
      expect(indexB).toBeLessThan(indexA);
      expect(indexC).toBeLessThan(indexA);
    });

    it('should handle entry with no dependencies', async () => {
      const entry = await createEntry([]);

      const chain = await ledger.getChain(entry.id);

      expect(chain.evidence.length).toBe(1);
      expect(chain.evidence[0].id).toBe(entry.id);
    });

    it('should handle multiple independent branches', async () => {
      // A depends on B and C, but B and C are independent
      //      A
      //     / \
      //    B   C
      const entryB = await createEntry([]);
      const entryC = await createEntry([]);
      const entryA = await createEntry([entryB.id, entryC.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.evidence.length).toBe(3);

      const idOrder = chain.evidence.map((e) => e.id);
      const indexB = idOrder.indexOf(entryB.id);
      const indexC = idOrder.indexOf(entryC.id);
      const indexA = idOrder.indexOf(entryA.id);

      // Both B and C should come before A (order between B and C doesn't matter)
      expect(indexB).toBeLessThan(indexA);
      expect(indexC).toBeLessThan(indexA);
    });

    it('should handle deep linear chain', async () => {
      // Create a chain: A -> B -> C -> D -> E
      const entryE = await createEntry([]);
      const entryD = await createEntry([entryE.id]);
      const entryC = await createEntry([entryD.id]);
      const entryB = await createEntry([entryC.id]);
      const entryA = await createEntry([entryB.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.evidence.length).toBe(5);

      const idOrder = chain.evidence.map((e) => e.id);

      // Verify strict ordering: E < D < C < B < A
      expect(idOrder.indexOf(entryE.id)).toBeLessThan(idOrder.indexOf(entryD.id));
      expect(idOrder.indexOf(entryD.id)).toBeLessThan(idOrder.indexOf(entryC.id));
      expect(idOrder.indexOf(entryC.id)).toBeLessThan(idOrder.indexOf(entryB.id));
      expect(idOrder.indexOf(entryB.id)).toBeLessThan(idOrder.indexOf(entryA.id));
    });

    it('should handle complex DAG', async () => {
      // Complex DAG:
      //      A
      //    / | \
      //   B  C  D
      //   |  |  |
      //   E  F  |
      //    \ | /
      //      G
      const entryG = await createEntry([]);
      const entryE = await createEntry([entryG.id]);
      const entryF = await createEntry([entryG.id]);
      const entryB = await createEntry([entryE.id]);
      const entryC = await createEntry([entryF.id]);
      const entryD = await createEntry([entryG.id]);
      const entryA = await createEntry([entryB.id, entryC.id, entryD.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.evidence.length).toBe(7);

      const idOrder = chain.evidence.map((e) => e.id);

      // G should come before E, F, D
      expect(idOrder.indexOf(entryG.id)).toBeLessThan(idOrder.indexOf(entryE.id));
      expect(idOrder.indexOf(entryG.id)).toBeLessThan(idOrder.indexOf(entryF.id));
      expect(idOrder.indexOf(entryG.id)).toBeLessThan(idOrder.indexOf(entryD.id));

      // E should come before B
      expect(idOrder.indexOf(entryE.id)).toBeLessThan(idOrder.indexOf(entryB.id));

      // F should come before C
      expect(idOrder.indexOf(entryF.id)).toBeLessThan(idOrder.indexOf(entryC.id));

      // B, C, D should all come before A
      expect(idOrder.indexOf(entryB.id)).toBeLessThan(idOrder.indexOf(entryA.id));
      expect(idOrder.indexOf(entryC.id)).toBeLessThan(idOrder.indexOf(entryA.id));
      expect(idOrder.indexOf(entryD.id)).toBeLessThan(idOrder.indexOf(entryA.id));
    });

    it('should handle typed relations', async () => {
      // Create entries with typed relations
      const entryC = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/test/file.ts',
          extractionType: 'function',
          entity: {
            name: 'testFn',
            kind: 'function',
            location: { file: '/test/file.ts' },
          },
          quality: 'ast_verified',
        },
        provenance: {
          source: 'ast_parser',
          method: 'ts_parser',
        },
        confidence: deterministic(true, 'test'),
        relatedEntries: [] as EvidenceRelation[],
      });

      const entryB = await ledger.append({
        kind: 'synthesis',
        payload: {
          request: 'test',
          output: 'output',
          model: { provider: 'test', modelId: 'test' },
          tokens: { input: 10, output: 20 },
          synthesisType: 'summary',
        },
        provenance: {
          source: 'llm_synthesis',
          method: 'test',
          agent: { type: 'llm', identifier: 'test-model' },
        },
        confidence: deterministic(true, 'test'),
        relatedEntries: [
          { id: entryC.id, type: 'derived_from' },
        ] as EvidenceRelation[],
      });

      const entryA = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'test claim',
          category: 'existence',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: deterministic(true, 'test'),
        },
        provenance: {
          source: 'llm_synthesis',
          method: 'test',
          agent: { type: 'llm', identifier: 'test-model' },
        },
        confidence: deterministic(true, 'test'),
        relatedEntries: [
          { id: entryB.id, type: 'derived_from' },
        ] as EvidenceRelation[],
      });

      const chain = await ledger.getChain(entryA.id);

      expect(chain.evidence.length).toBe(3);

      const idOrder = chain.evidence.map((e) => e.id);
      expect(idOrder.indexOf(entryC.id)).toBeLessThan(idOrder.indexOf(entryB.id));
      expect(idOrder.indexOf(entryB.id)).toBeLessThan(idOrder.indexOf(entryA.id));
    });

    it('should handle missing dependencies gracefully', async () => {
      // Create an entry that references a non-existent dependency
      const nonExistentId = createEvidenceId('ev_nonexistent');
      const entry = await createEntry([nonExistentId]);

      const chain = await ledger.getChain(entry.id);

      // Should still return the entry, just without the missing dependency
      expect(chain.evidence.length).toBe(1);
      expect(chain.evidence[0].id).toBe(entry.id);
    });
  });

  describe('getChain preserves other functionality', () => {
    it('should still compute chain confidence correctly', async () => {
      const entryB = await createEntry([]);
      const entryA = await createEntry([entryB.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.chainConfidence).toBeDefined();
      expect(chain.chainConfidence.type).toBe('derived');
    });

    it('should still build the graph correctly', async () => {
      const entryC = await createEntry([]);
      const entryB = await createEntry([entryC.id]);
      const entryA = await createEntry([entryB.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.graph.size).toBe(3);
      expect(chain.graph.get(entryA.id)).toContain(entryB.id);
      expect(chain.graph.get(entryB.id)).toContain(entryC.id);
      expect(chain.graph.get(entryC.id)).toEqual([]);
    });

    it('should still detect contradictions', async () => {
      const entryB = await createEntry([]);

      // Create a contradiction entry
      const contradictionEntry = await ledger.append({
        kind: 'contradiction',
        payload: {
          claimA: entryB.id,
          claimB: createEvidenceId('ev_other'),
          contradictionType: 'direct',
          explanation: 'Test contradiction',
          severity: 'significant',
        },
        provenance: {
          source: 'system_observation',
          method: 'contradiction_detector',
        },
        relatedEntries: [entryB.id],
      });

      const chain = await ledger.getChain(contradictionEntry.id);

      expect(chain.contradictions.length).toBe(1);
      expect(chain.contradictions[0].severity).toBe('significant');
    });

    it('should still set root correctly', async () => {
      const entryB = await createEntry([]);
      const entryA = await createEntry([entryB.id]);

      const chain = await ledger.getChain(entryA.id);

      expect(chain.root.id).toBe(entryA.id);
    });
  });
});
