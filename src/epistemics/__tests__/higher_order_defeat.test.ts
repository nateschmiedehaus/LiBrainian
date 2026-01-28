/**
 * @fileoverview Tests for Higher-Order Defeat Support (WU-THIMPL-102)
 *
 * Tests cover:
 * - isDefeaterActive function with meta-defeat chains
 * - Cycle detection in meta-defeat relationships
 * - getEffectivelyActiveDefeaters filtering
 * - addMetaDefeater and removeMetaDefeater helpers
 */

import { describe, it, expect } from 'vitest';
import {
  isDefeaterActive,
  getEffectivelyActiveDefeaters,
  addMetaDefeater,
  removeMetaDefeater,
} from '../defeaters.js';
import { createDefeater, type ExtendedDefeater, createClaimId } from '../types.js';

describe('Higher-Order Defeat Support (WU-THIMPL-102)', () => {
  // Test fixtures
  const createTestDefeater = (
    id: string,
    options: Partial<{
      status: 'pending' | 'active' | 'resolved' | 'ignored';
      defeatedBy: string[];
    }> = {}
  ): ExtendedDefeater => ({
    id,
    type: 'code_change',
    description: `Test defeater ${id}`,
    severity: 'partial',
    detectedAt: new Date().toISOString(),
    status: options.status ?? 'active',
    affectedClaimIds: [createClaimId('test-claim')],
    confidenceReduction: 0.2,
    autoResolvable: false,
    defeatedBy: options.defeatedBy,
  });

  describe('isDefeaterActive', () => {
    it('should return true for active defeater with no meta-defeaters', () => {
      const defeater = createTestDefeater('d1', { status: 'active' });
      const allDefeaters = [defeater];

      expect(isDefeaterActive(defeater, allDefeaters)).toBe(true);
    });

    it('should return false for non-active defeater', () => {
      const pendingDefeater = createTestDefeater('d1', { status: 'pending' });
      const resolvedDefeater = createTestDefeater('d2', { status: 'resolved' });
      const ignoredDefeater = createTestDefeater('d3', { status: 'ignored' });
      const allDefeaters = [pendingDefeater, resolvedDefeater, ignoredDefeater];

      expect(isDefeaterActive(pendingDefeater, allDefeaters)).toBe(false);
      expect(isDefeaterActive(resolvedDefeater, allDefeaters)).toBe(false);
      expect(isDefeaterActive(ignoredDefeater, allDefeaters)).toBe(false);
    });

    it('should return false when defeated by an active meta-defeater', () => {
      const metaDefeater = createTestDefeater('meta', { status: 'active' });
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta'],
      });
      const allDefeaters = [defeater, metaDefeater];

      expect(isDefeaterActive(defeater, allDefeaters)).toBe(false);
    });

    it('should return true when meta-defeater is not active', () => {
      const metaDefeater = createTestDefeater('meta', { status: 'resolved' });
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta'],
      });
      const allDefeaters = [defeater, metaDefeater];

      expect(isDefeaterActive(defeater, allDefeaters)).toBe(true);
    });

    it('should return true when meta-defeater does not exist', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['nonexistent'],
      });
      const allDefeaters = [defeater];

      expect(isDefeaterActive(defeater, allDefeaters)).toBe(true);
    });

    it('should handle multi-level meta-defeat chains', () => {
      // D1 is defeated by D2, D2 is defeated by D3 (D3 is active)
      // So D2 is not active, so D1 IS active (reinstated)
      const d3 = createTestDefeater('d3', { status: 'active' });
      const d2 = createTestDefeater('d2', { status: 'active', defeatedBy: ['d3'] });
      const d1 = createTestDefeater('d1', { status: 'active', defeatedBy: ['d2'] });
      const allDefeaters = [d1, d2, d3];

      // D3 is active (no meta-defeaters)
      expect(isDefeaterActive(d3, allDefeaters)).toBe(true);
      // D2 is defeated by active D3, so D2 is not active
      expect(isDefeaterActive(d2, allDefeaters)).toBe(false);
      // D1 is "defeated by" D2, but D2 is not active, so D1 is reinstated (active)
      expect(isDefeaterActive(d1, allDefeaters)).toBe(true);
    });

    it('should handle multiple meta-defeaters (any active defeats)', () => {
      const meta1 = createTestDefeater('meta1', { status: 'resolved' });
      const meta2 = createTestDefeater('meta2', { status: 'active' });
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1', 'meta2'],
      });
      const allDefeaters = [defeater, meta1, meta2];

      // meta2 is active, so defeater is defeated
      expect(isDefeaterActive(defeater, allDefeaters)).toBe(false);
    });

    it('should return true when all meta-defeaters are inactive', () => {
      const meta1 = createTestDefeater('meta1', { status: 'resolved' });
      const meta2 = createTestDefeater('meta2', { status: 'pending' });
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1', 'meta2'],
      });
      const allDefeaters = [defeater, meta1, meta2];

      expect(isDefeaterActive(defeater, allDefeaters)).toBe(true);
    });

    it('should handle cycle detection (direct self-reference)', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['d1'], // Self-referencing
      });
      const allDefeaters = [defeater];

      // A self-defeating defeater is not active (it defeats itself)
      // When checking if d1 is active, we see d1 defeats d1.
      // We recurse to check if d1 is active (as a meta-defeater).
      // Cycle detected: we treat the cyclic meta-defeater as inactive.
      // So d1 appears not defeated by its meta-defeater (which is inactive).
      // Therefore d1 is active.
      expect(isDefeaterActive(defeater, allDefeaters)).toBe(true);
    });

    it('should handle cycle detection (mutual defeat)', () => {
      const d1 = createTestDefeater('d1', { status: 'active', defeatedBy: ['d2'] });
      const d2 = createTestDefeater('d2', { status: 'active', defeatedBy: ['d1'] });
      const allDefeaters = [d1, d2];

      // Mutual defeat scenario: d1 defeats d2, d2 defeats d1
      // From d1's perspective: check if d2 is active (as meta-defeater of d1)
      //   - d2 is active status, check if d1 is active (as meta-defeater of d2)
      //   - Cycle detected: treat d1 as inactive in this context
      //   - So d2 appears active (not defeated by d1)
      //   - So d1 is defeated by active d2 -> d1 is NOT active
      // From d2's perspective: symmetric, d2 is also NOT active
      // This is consistent: mutual defeat results in both being suspended
      expect(isDefeaterActive(d1, allDefeaters)).toBe(false);
      expect(isDefeaterActive(d2, allDefeaters)).toBe(false);
    });

    it('should handle cycle detection (longer cycle)', () => {
      // d1 -> d2 -> d3 -> d1 (cycle)
      const d1 = createTestDefeater('d1', { status: 'active', defeatedBy: ['d2'] });
      const d2 = createTestDefeater('d2', { status: 'active', defeatedBy: ['d3'] });
      const d3 = createTestDefeater('d3', { status: 'active', defeatedBy: ['d1'] });
      const allDefeaters = [d1, d2, d3];

      // All form a cycle - each is defeated by the next in the chain
      // From d1's perspective: check d2 -> check d3 -> check d1 (cycle)
      //   - d1 detected as cycle, treated as inactive
      //   - d3 appears active (d1 inactive) -> d2 is defeated -> d2 inactive
      //   - But d2 is d1's meta-defeater, so d1 is not defeated
      // The actual behavior depends on traversal order and cycle detection
      // In our implementation, cycles cause the cyclic node to appear inactive,
      // which can lead to complex behaviors. All three end up active.
      expect(isDefeaterActive(d1, allDefeaters)).toBe(true);
      expect(isDefeaterActive(d2, allDefeaters)).toBe(true);
      expect(isDefeaterActive(d3, allDefeaters)).toBe(true);
    });
  });

  describe('getEffectivelyActiveDefeaters', () => {
    it('should return all active defeaters with no meta-defeat', () => {
      const d1 = createTestDefeater('d1', { status: 'active' });
      const d2 = createTestDefeater('d2', { status: 'active' });
      const d3 = createTestDefeater('d3', { status: 'resolved' });
      const allDefeaters = [d1, d2, d3];

      const result = getEffectivelyActiveDefeaters(allDefeaters);
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.id)).toContain('d1');
      expect(result.map((d) => d.id)).toContain('d2');
    });

    it('should exclude defeaters that are meta-defeated', () => {
      const meta = createTestDefeater('meta', { status: 'active' });
      const d1 = createTestDefeater('d1', { status: 'active', defeatedBy: ['meta'] });
      const d2 = createTestDefeater('d2', { status: 'active' });
      const allDefeaters = [d1, d2, meta];

      const result = getEffectivelyActiveDefeaters(allDefeaters);
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.id)).toContain('meta');
      expect(result.map((d) => d.id)).toContain('d2');
      expect(result.map((d) => d.id)).not.toContain('d1');
    });

    it('should handle reinstatement through chains', () => {
      const d3 = createTestDefeater('d3', { status: 'active' });
      const d2 = createTestDefeater('d2', { status: 'active', defeatedBy: ['d3'] });
      const d1 = createTestDefeater('d1', { status: 'active', defeatedBy: ['d2'] });
      const allDefeaters = [d1, d2, d3];

      const result = getEffectivelyActiveDefeaters(allDefeaters);
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.id)).toContain('d1'); // Reinstated
      expect(result.map((d) => d.id)).toContain('d3'); // Active
      expect(result.map((d) => d.id)).not.toContain('d2'); // Defeated by d3
    });

    it('should return empty array for no defeaters', () => {
      const result = getEffectivelyActiveDefeaters([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('addMetaDefeater', () => {
    it('should add a new meta-defeater to undefined defeatedBy', () => {
      const defeater = createTestDefeater('d1', { status: 'active' });
      const result = addMetaDefeater(defeater, 'meta1');

      expect(result.defeatedBy).toEqual(['meta1']);
      // Original should not be mutated
      expect(defeater.defeatedBy).toBeUndefined();
    });

    it('should add a new meta-defeater to existing defeatedBy', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1'],
      });
      const result = addMetaDefeater(defeater, 'meta2');

      expect(result.defeatedBy).toEqual(['meta1', 'meta2']);
    });

    it('should not duplicate existing meta-defeater', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1'],
      });
      const result = addMetaDefeater(defeater, 'meta1');

      expect(result.defeatedBy).toEqual(['meta1']);
      expect(result).toBe(defeater); // Should return same object
    });
  });

  describe('removeMetaDefeater', () => {
    it('should return unchanged defeater if defeatedBy is undefined', () => {
      const defeater = createTestDefeater('d1', { status: 'active' });
      const result = removeMetaDefeater(defeater, 'meta1');

      expect(result).toBe(defeater);
      expect(result.defeatedBy).toBeUndefined();
    });

    it('should remove existing meta-defeater', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1', 'meta2'],
      });
      const result = removeMetaDefeater(defeater, 'meta1');

      expect(result.defeatedBy).toEqual(['meta2']);
    });

    it('should set defeatedBy to undefined when removing last meta-defeater', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1'],
      });
      const result = removeMetaDefeater(defeater, 'meta1');

      expect(result.defeatedBy).toBeUndefined();
    });

    it('should return new object when removing meta-defeater', () => {
      const defeater = createTestDefeater('d1', {
        status: 'active',
        defeatedBy: ['meta1', 'meta2'],
      });
      const result = removeMetaDefeater(defeater, 'meta1');

      expect(result).not.toBe(defeater);
      // Original should not be mutated
      expect(defeater.defeatedBy).toEqual(['meta1', 'meta2']);
    });
  });

  describe('Integration: Pollock reinstatement example', () => {
    it('should correctly model Pollock reinstatement: A defeats B, C defeats A', () => {
      // Classic example:
      // - B is a claim that X is a bird
      // - A is a defeater: X is a penguin, so X doesn't fly (defeats "birds fly")
      // - C is a meta-defeater: X is a very special penguin that can fly (defeats A)
      // Result: B (birds fly) is reinstated because A is defeated by C

      const claimBId = createClaimId('claim-b');

      // Defeater A defeats claim B
      const defeaterA = createTestDefeater('defeater-a', {
        status: 'active',
        defeatedBy: ['meta-defeater-c'], // C defeats A
      });

      // Meta-defeater C defeats defeater A
      const metaDefeaterC = createTestDefeater('meta-defeater-c', {
        status: 'active',
      });

      const allDefeaters = [defeaterA, metaDefeaterC];

      // C is active
      expect(isDefeaterActive(metaDefeaterC, allDefeaters)).toBe(true);
      // A is not active (defeated by C)
      expect(isDefeaterActive(defeaterA, allDefeaters)).toBe(false);

      // So claim B is effectively reinstated (defeater A is not active)
      const activeDefeaters = getEffectivelyActiveDefeaters(allDefeaters);
      const claimBStillDefeated = activeDefeaters.some((d) =>
        d.affectedClaimIds.includes(claimBId) && d.id === 'defeater-a'
      );
      expect(claimBStillDefeated).toBe(false);
    });
  });
});
