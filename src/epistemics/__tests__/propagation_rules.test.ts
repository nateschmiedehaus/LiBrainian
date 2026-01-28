/**
 * @fileoverview Tests for Configurable Confidence Propagation Rules (WU-THIMPL-108)
 *
 * Tests cover:
 * - All propagation rules: min, max, product, weighted_average, noisy_or
 * - Default behavior (min rule)
 * - Interaction with contradiction penalties
 * - Edge cases (empty inputs, single input)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SqliteEvidenceLedger,
  createEvidenceId,
  type ExtractionEvidence,
  type ClaimEvidence,
  type PropagationRule,
} from '../evidence_ledger.js';
import { deterministic, bounded } from '../confidence.js';

describe('Configurable Confidence Propagation Rules (WU-THIMPL-108)', () => {
  let ledger: SqliteEvidenceLedger;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-propagation-${Date.now()}.db`);
    ledger = new SqliteEvidenceLedger(dbPath);
    await ledger.initialize();
  });

  afterEach(async () => {
    await ledger.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  const createTestChain = async (confidenceValues: number[]) => {
    const entries = [];

    for (let i = 0; i < confidenceValues.length; i++) {
      const entry = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: `/test${i}.ts`,
          extractionType: 'function',
          entity: { name: `func${i}`, kind: 'function', location: { file: `/test${i}.ts` } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: i > 0 ? [entries[i - 1].id] : [],
        confidence: deterministic(true, `test_${i}`),
      });

      // Override the confidence value for testing
      (entry.confidence as any).value = confidenceValues[i];
      entries.push(entry);
    }

    // Create the root claim that references all entries
    const claim = await ledger.append({
      kind: 'claim',
      payload: {
        claim: 'Test claim',
        category: 'behavior',
        subject: { type: 'function', identifier: 'test' },
        supportingEvidence: entries.map(e => e.id),
        knownDefeaters: [],
        confidence: deterministic(true, 'claim'),
      } satisfies ClaimEvidence,
      provenance: { source: 'ast_parser', method: 'test' },
      relatedEntries: entries.map(e => e.id),
      confidence: deterministic(true, 'claim'),
    });

    return claim;
  };

  describe('min rule (default)', () => {
    it('should compute minimum of all confidences', async () => {
      // Create entries with different confidence values
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.9, reason: 'test' },
      });

      const e2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.7, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test claim',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id, e2.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 0.8, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id, e2.id],
        confidence: { type: 'deterministic', value: 0.8, reason: 'claim' },
      });

      // Default should use min rule
      const chain = await ledger.getChain(claim.id);

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        expect(chain.chainConfidence.value).toBe(0.7);
        expect(chain.chainConfidence.formula).toContain('min');
      }
    });

    it('should use min rule explicitly', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.9, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 0.6, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id],
        confidence: { type: 'deterministic', value: 0.6, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'min' });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        expect(chain.chainConfidence.value).toBe(0.6);
      }
    });
  });

  describe('max rule', () => {
    it('should compute maximum of all confidences', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.5, reason: 'test' },
      });

      const e2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.9, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id, e2.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 0.7, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id, e2.id],
        confidence: { type: 'deterministic', value: 0.7, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'max' });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        expect(chain.chainConfidence.value).toBe(0.9);
        expect(chain.chainConfidence.formula).toContain('max');
      }
    });
  });

  describe('product rule', () => {
    it('should compute product of all confidences', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.8, reason: 'test' },
      });

      const e2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.5, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id, e2.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id, e2.id],
        confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'product' });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // 0.8 * 0.5 * 1.0 = 0.4
        expect(chain.chainConfidence.value).toBeCloseTo(0.4, 5);
        expect(chain.chainConfidence.formula).toContain('product');
      }
    });
  });

  describe('weighted_average rule', () => {
    it('should compute weighted average with custom weights', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 1.0, reason: 'high_confidence' },
      });

      const e2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.5, reason: 'low_confidence' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id, e2.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 0.8, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id, e2.id],
        confidence: { type: 'deterministic', value: 0.8, reason: 'claim' },
      });

      // Weight e1 higher than e2
      const weights: Record<string, number> = {
        [e1.id]: 3,
        [e2.id]: 1,
        [claim.id]: 2,
      };

      const chain = await ledger.getChain(claim.id, {
        propagationRule: 'weighted_average',
        weights,
      });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // (1.0*3 + 0.5*1 + 0.8*2) / (3+1+2) = (3 + 0.5 + 1.6) / 6 = 5.1 / 6 = 0.85
        expect(chain.chainConfidence.value).toBeCloseTo(0.85, 2);
        expect(chain.chainConfidence.formula).toContain('weighted_average');
      }
    });

    it('should use equal weights when none provided', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.6, reason: 'test' },
      });

      const e2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.8, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id, e2.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id, e2.id],
        confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'weighted_average' });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // (0.6 + 0.8 + 1.0) / 3 = 0.8
        expect(chain.chainConfidence.value).toBeCloseTo(0.8, 2);
      }
    });
  });

  describe('noisy_or rule', () => {
    it('should compute noisy-or of all confidences', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.3, reason: 'test' },
      });

      const e2 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/b.ts',
          extractionType: 'function',
          entity: { name: 'b', kind: 'function', location: { file: '/b.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.4, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id, e2.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 0.5, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id, e2.id],
        confidence: { type: 'deterministic', value: 0.5, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'noisy_or' });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // noisy_or = 1 - (1-0.3)*(1-0.4)*(1-0.5) = 1 - 0.7*0.6*0.5 = 1 - 0.21 = 0.79
        expect(chain.chainConfidence.value).toBeCloseTo(0.79, 2);
        expect(chain.chainConfidence.formula).toContain('noisy_or');
      }
    });
  });

  describe('interaction with contradictions', () => {
    it('should apply contradiction penalty after propagation rule', async () => {
      // Create a contradiction entry
      const contradiction = await ledger.append({
        kind: 'contradiction',
        payload: {
          claimA: createEvidenceId('ev_a'),
          claimB: createEvidenceId('ev_b'),
          contradictionType: 'direct',
          explanation: 'Test contradiction',
          severity: 'minor',
        },
        provenance: { source: 'system_observation', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 1.0, reason: 'test' },
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [contradiction.id],
          confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [contradiction.id],
        confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'max' });

      expect(chain.contradictions).toHaveLength(1);
      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // max(1.0, 1.0) * 0.9 (minor penalty) = 0.9
        expect(chain.chainConfidence.value).toBeCloseTo(0.9, 2);
        expect(chain.chainConfidence.formula).toContain('contradiction_penalty');
      }
    });
  });

  describe('edge cases', () => {
    it('should return derived confidence when claim has confidence', async () => {
      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 1.0, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: { type: 'deterministic', value: 0.9, reason: 'test' },
      });

      const chain = await ledger.getChain(claim.id);

      // Should have confidence from the claim itself
      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        expect(chain.chainConfidence.value).toBe(0.9);
      }
    });

    it('should handle bounded confidence values', async () => {
      const e1 = await ledger.append({
        kind: 'extraction',
        payload: {
          filePath: '/a.ts',
          extractionType: 'function',
          entity: { name: 'a', kind: 'function', location: { file: '/a.ts' } },
          quality: 'ast_verified',
        } satisfies ExtractionEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [],
        confidence: bounded(0.6, 0.9, 'test_bounded'),
      });

      const claim = await ledger.append({
        kind: 'claim',
        payload: {
          claim: 'Test',
          category: 'behavior',
          subject: { type: 'function', identifier: 'test' },
          supportingEvidence: [e1.id],
          knownDefeaters: [],
          confidence: { type: 'deterministic', value: 0.8, reason: 'claim' },
        } satisfies ClaimEvidence,
        provenance: { source: 'ast_parser', method: 'test' },
        relatedEntries: [e1.id],
        confidence: { type: 'deterministic', value: 0.8, reason: 'claim' },
      });

      const chain = await ledger.getChain(claim.id, { propagationRule: 'min' });

      expect(chain.chainConfidence.type).toBe('derived');
      if (chain.chainConfidence.type === 'derived') {
        // Should use low bound (0.6) for bounded confidence in min rule
        expect(chain.chainConfidence.value).toBe(0.6);
      }
    });
  });
});
