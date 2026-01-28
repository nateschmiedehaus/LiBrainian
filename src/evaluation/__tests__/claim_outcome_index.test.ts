/**
 * @fileoverview Tests for Claim-Outcome Index (WU-CALX-002)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The ClaimOutcomeIndex provides a unified index for tracking relationships
 * between claims and their outcomes, enabling calibration analysis queries.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ClaimOutcomeIndex,
  createClaimOutcomeIndex,
  type IndexedClaim,
  type IndexedOutcome,
  type ClaimOutcomeRelation,
  type CalibrationQuery,
  type CalibrationDataPoint,
} from '../claim_outcome_index.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestClaim(overrides: Partial<IndexedClaim> = {}): IndexedClaim {
  return {
    id: `claim-${Math.random().toString(36).substr(2, 9)}`,
    content: 'Test claim content',
    confidence: 0.8,
    claimType: 'structural',
    createdAt: new Date(),
    source: 'test-source',
    tags: ['test'],
    ...overrides,
  };
}

function createTestOutcome(overrides: Partial<IndexedOutcome> = {}): IndexedOutcome {
  return {
    id: `outcome-${Math.random().toString(36).substr(2, 9)}`,
    outcomeType: 'accept',
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

function createTestRelation(
  claimId: string,
  outcomeId: string,
  overrides: Partial<ClaimOutcomeRelation> = {}
): ClaimOutcomeRelation {
  return {
    claimId,
    outcomeId,
    relationshipType: 'caused',
    weight: 1.0,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createClaimOutcomeIndex', () => {
  it('should create an index instance', () => {
    const index = createClaimOutcomeIndex();
    expect(index).toBeInstanceOf(ClaimOutcomeIndex);
  });
});

// ============================================================================
// INDEX CLAIM TESTS
// ============================================================================

describe('ClaimOutcomeIndex - indexClaim', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
  });

  it('should index a claim successfully', () => {
    const claim = createTestClaim({ id: 'claim-1' });
    index.indexClaim(claim);

    const retrieved = index.getClaim('claim-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('claim-1');
  });

  it('should allow retrieving indexed claim by id', () => {
    const claim = createTestClaim({
      id: 'claim-test',
      content: 'Specific test content',
      confidence: 0.75,
    });
    index.indexClaim(claim);

    const retrieved = index.getClaim('claim-test');
    expect(retrieved?.content).toBe('Specific test content');
    expect(retrieved?.confidence).toBe(0.75);
  });

  it('should handle multiple claims with same type', () => {
    const claim1 = createTestClaim({ id: 'claim-1', claimType: 'structural' });
    const claim2 = createTestClaim({ id: 'claim-2', claimType: 'structural' });

    index.indexClaim(claim1);
    index.indexClaim(claim2);

    expect(index.getClaim('claim-1')).toBeDefined();
    expect(index.getClaim('claim-2')).toBeDefined();
  });

  it('should update existing claim if same id is indexed again', () => {
    const claim1 = createTestClaim({ id: 'claim-1', confidence: 0.5 });
    const claim2 = createTestClaim({ id: 'claim-1', confidence: 0.9 });

    index.indexClaim(claim1);
    index.indexClaim(claim2);

    const retrieved = index.getClaim('claim-1');
    expect(retrieved?.confidence).toBe(0.9);
  });

  it('should preserve all claim fields', () => {
    const claim = createTestClaim({
      id: 'full-claim',
      content: 'Full content',
      confidence: 0.85,
      claimType: 'behavioral',
      source: 'librarian',
      tags: ['api', 'function'],
    });
    index.indexClaim(claim);

    const retrieved = index.getClaim('full-claim');
    expect(retrieved?.content).toBe('Full content');
    expect(retrieved?.confidence).toBe(0.85);
    expect(retrieved?.claimType).toBe('behavioral');
    expect(retrieved?.source).toBe('librarian');
    expect(retrieved?.tags).toEqual(['api', 'function']);
  });
});

// ============================================================================
// INDEX OUTCOME TESTS
// ============================================================================

describe('ClaimOutcomeIndex - indexOutcome', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
  });

  it('should index an outcome successfully', () => {
    const outcome = createTestOutcome({ id: 'outcome-1' });
    index.indexOutcome(outcome);

    const retrieved = index.getOutcome('outcome-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('outcome-1');
  });

  it('should index outcomes with different types', () => {
    const accept = createTestOutcome({ id: 'outcome-accept', outcomeType: 'accept' });
    const reject = createTestOutcome({ id: 'outcome-reject', outcomeType: 'reject' });
    const error = createTestOutcome({ id: 'outcome-error', outcomeType: 'error' });

    index.indexOutcome(accept);
    index.indexOutcome(reject);
    index.indexOutcome(error);

    expect(index.getOutcome('outcome-accept')?.outcomeType).toBe('accept');
    expect(index.getOutcome('outcome-reject')?.outcomeType).toBe('reject');
    expect(index.getOutcome('outcome-error')?.outcomeType).toBe('error');
  });

  it('should preserve outcome metadata', () => {
    const outcome = createTestOutcome({
      id: 'outcome-meta',
      metadata: { verifier: 'test-verifier', score: 0.95 },
    });
    index.indexOutcome(outcome);

    const retrieved = index.getOutcome('outcome-meta');
    expect(retrieved?.metadata).toEqual({ verifier: 'test-verifier', score: 0.95 });
  });

  it('should handle timeout and partial outcome types', () => {
    const timeout = createTestOutcome({ id: 'outcome-timeout', outcomeType: 'timeout' });
    const partial = createTestOutcome({ id: 'outcome-partial', outcomeType: 'partial' });

    index.indexOutcome(timeout);
    index.indexOutcome(partial);

    expect(index.getOutcome('outcome-timeout')?.outcomeType).toBe('timeout');
    expect(index.getOutcome('outcome-partial')?.outcomeType).toBe('partial');
  });
});

// ============================================================================
// ADD RELATION TESTS
// ============================================================================

describe('ClaimOutcomeIndex - addRelation', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
    // Set up some claims and outcomes
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexClaim(createTestClaim({ id: 'claim-2' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-2' }));
  });

  it('should add a relation between claim and outcome', () => {
    const relation = createTestRelation('claim-1', 'outcome-1');
    index.addRelation(relation);

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations.length).toBe(1);
    expect(relations[0].outcomeId).toBe('outcome-1');
  });

  it('should support multiple relations for same claim', () => {
    index.addRelation(createTestRelation('claim-1', 'outcome-1'));
    index.addRelation(createTestRelation('claim-1', 'outcome-2'));

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations.length).toBe(2);
  });

  it('should support different relationship types', () => {
    index.addRelation(createTestRelation('claim-1', 'outcome-1', { relationshipType: 'caused' }));
    index.addRelation(createTestRelation('claim-2', 'outcome-1', { relationshipType: 'contributed' }));

    const relations1 = index.getRelationsForClaim('claim-1');
    const relations2 = index.getRelationsForClaim('claim-2');

    expect(relations1[0].relationshipType).toBe('caused');
    expect(relations2[0].relationshipType).toBe('contributed');
  });

  it('should store relation weight', () => {
    index.addRelation(createTestRelation('claim-1', 'outcome-1', { weight: 0.75 }));

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations[0].weight).toBe(0.75);
  });

  it('should allow adding relations for non-indexed claims (lazy indexing)', () => {
    // This tests that the index handles relations even if claim/outcome not pre-indexed
    const relation = createTestRelation('new-claim', 'new-outcome');
    index.addRelation(relation);

    const relations = index.getRelationsForClaim('new-claim');
    expect(relations.length).toBe(1);
  });
});

// ============================================================================
// QUERY BY CONFIDENCE TESTS
// ============================================================================

describe('ClaimOutcomeIndex - queryByConfidence', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
    // Add claims with varying confidence levels
    index.indexClaim(createTestClaim({ id: 'claim-low', confidence: 0.2 }));
    index.indexClaim(createTestClaim({ id: 'claim-med', confidence: 0.5 }));
    index.indexClaim(createTestClaim({ id: 'claim-high', confidence: 0.8 }));
    index.indexClaim(createTestClaim({ id: 'claim-very-high', confidence: 0.95 }));
  });

  it('should return claims within confidence range', () => {
    const claims = index.queryByConfidence([0.4, 0.6]);
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe('claim-med');
  });

  it('should include boundary values', () => {
    const claims = index.queryByConfidence([0.5, 0.8]);
    expect(claims.length).toBe(2);
    const ids = claims.map((c) => c.id);
    expect(ids).toContain('claim-med');
    expect(ids).toContain('claim-high');
  });

  it('should return empty array for range with no matches', () => {
    const claims = index.queryByConfidence([0.3, 0.4]);
    expect(claims).toEqual([]);
  });

  it('should return all claims for full range', () => {
    const claims = index.queryByConfidence([0.0, 1.0]);
    expect(claims.length).toBe(4);
  });

  it('should handle single-point range', () => {
    const claims = index.queryByConfidence([0.5, 0.5]);
    expect(claims.length).toBe(1);
    expect(claims[0].id).toBe('claim-med');
  });
});

// ============================================================================
// QUERY BY OUTCOME TESTS
// ============================================================================

describe('ClaimOutcomeIndex - queryByOutcome', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexClaim(createTestClaim({ id: 'claim-2' }));
    index.indexClaim(createTestClaim({ id: 'claim-3' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-2' }));

    // Create relations
    index.addRelation(createTestRelation('claim-1', 'outcome-1'));
    index.addRelation(createTestRelation('claim-2', 'outcome-1'));
    index.addRelation(createTestRelation('claim-3', 'outcome-2'));
  });

  it('should return claims related to an outcome', () => {
    const claims = index.queryByOutcome('outcome-1');
    expect(claims.length).toBe(2);
    const ids = claims.map((c) => c.id);
    expect(ids).toContain('claim-1');
    expect(ids).toContain('claim-2');
  });

  it('should return empty array for outcome with no relations', () => {
    index.indexOutcome(createTestOutcome({ id: 'outcome-no-relations' }));
    const claims = index.queryByOutcome('outcome-no-relations');
    expect(claims).toEqual([]);
  });

  it('should return empty array for non-existent outcome', () => {
    const claims = index.queryByOutcome('nonexistent-outcome');
    expect(claims).toEqual([]);
  });

  it('should not return duplicate claims for same outcome', () => {
    // Add duplicate relation
    index.addRelation(createTestRelation('claim-1', 'outcome-1'));
    const claims = index.queryByOutcome('outcome-1');

    // Should still only have 2 unique claims
    const uniqueIds = new Set(claims.map((c) => c.id));
    expect(uniqueIds.size).toBe(2);
  });
});

// ============================================================================
// GET CALIBRATION DATA TESTS
// ============================================================================

describe('ClaimOutcomeIndex - getCalibrationData', () => {
  let index: ClaimOutcomeIndex;
  const baseTime = new Date('2024-01-01T00:00:00Z');

  beforeEach(() => {
    index = createClaimOutcomeIndex();

    // Create claims across confidence spectrum with outcomes
    // Low confidence bin (0.0-0.2): 5 claims, 1 accepted = 20% accuracy
    for (let i = 0; i < 5; i++) {
      const claimId = `claim-low-${i}`;
      const outcomeId = `outcome-low-${i}`;
      index.indexClaim(
        createTestClaim({
          id: claimId,
          confidence: 0.1,
          claimType: 'structural',
          createdAt: new Date(baseTime.getTime() + i * 1000),
        })
      );
      index.indexOutcome(
        createTestOutcome({
          id: outcomeId,
          outcomeType: i === 0 ? 'accept' : 'reject',
          timestamp: new Date(baseTime.getTime() + i * 1000 + 100),
        })
      );
      index.addRelation(createTestRelation(claimId, outcomeId));
    }

    // High confidence bin (0.8-1.0): 5 claims, 4 accepted = 80% accuracy
    for (let i = 0; i < 5; i++) {
      const claimId = `claim-high-${i}`;
      const outcomeId = `outcome-high-${i}`;
      index.indexClaim(
        createTestClaim({
          id: claimId,
          confidence: 0.9,
          claimType: 'structural',
          createdAt: new Date(baseTime.getTime() + i * 1000),
        })
      );
      index.indexOutcome(
        createTestOutcome({
          id: outcomeId,
          outcomeType: i < 4 ? 'accept' : 'reject',
          timestamp: new Date(baseTime.getTime() + i * 1000 + 100),
        })
      );
      index.addRelation(createTestRelation(claimId, outcomeId));
    }
  });

  it('should return calibration data points', () => {
    const data = index.getCalibrationData({});
    expect(data.length).toBeGreaterThan(0);
  });

  it('should include bin boundaries in data points', () => {
    const data = index.getCalibrationData({});
    for (const point of data) {
      expect(point.binStart).toBeDefined();
      expect(point.binEnd).toBeDefined();
      expect(point.binStart).toBeLessThanOrEqual(point.binEnd);
    }
  });

  it('should calculate predicted probability as bin midpoint', () => {
    const data = index.getCalibrationData({});
    for (const point of data) {
      const expectedMidpoint = (point.binStart + point.binEnd) / 2;
      expect(point.predictedProbability).toBeCloseTo(expectedMidpoint, 1);
    }
  });

  it('should calculate actual frequency from outcomes', () => {
    const data = index.getCalibrationData({});
    // Find low confidence bin
    const lowBin = data.find((p) => p.binStart <= 0.1 && p.binEnd >= 0.1);
    expect(lowBin).toBeDefined();
    expect(lowBin?.actualFrequency).toBeCloseTo(0.2, 1); // 1/5 accepted

    // Find high confidence bin
    const highBin = data.find((p) => p.binStart <= 0.9 && p.binEnd >= 0.9);
    expect(highBin).toBeDefined();
    expect(highBin?.actualFrequency).toBeCloseTo(0.8, 1); // 4/5 accepted
  });

  it('should include sample count in data points', () => {
    const data = index.getCalibrationData({});
    for (const point of data) {
      expect(point.sampleCount).toBeGreaterThan(0);
    }
  });

  it('should include claim ids in data points', () => {
    const data = index.getCalibrationData({});
    for (const point of data) {
      expect(Array.isArray(point.claims)).toBe(true);
      expect(point.claims.length).toBe(point.sampleCount);
    }
  });

  it('should filter by confidence range', () => {
    const query: CalibrationQuery = { confidenceRange: [0.8, 1.0] };
    const data = index.getCalibrationData(query);

    // Should only have high confidence data
    for (const point of data) {
      expect(point.binStart).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('should filter by claim types', () => {
    // Add a claim with different type
    index.indexClaim(createTestClaim({ id: 'claim-behavioral', claimType: 'behavioral', confidence: 0.5 }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-behavioral', outcomeType: 'accept' }));
    index.addRelation(createTestRelation('claim-behavioral', 'outcome-behavioral'));

    const query: CalibrationQuery = { claimTypes: ['behavioral'] };
    const data = index.getCalibrationData(query);

    // Should only have behavioral claim data
    expect(data.length).toBeGreaterThan(0);
    const allClaims = data.flatMap((p) => p.claims);
    expect(allClaims).toContain('claim-behavioral');
  });

  it('should filter by time range', () => {
    const laterTime = new Date('2024-06-01T00:00:00Z');
    index.indexClaim(createTestClaim({ id: 'claim-later', confidence: 0.5, createdAt: laterTime }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-later', outcomeType: 'accept', timestamp: laterTime }));
    index.addRelation(createTestRelation('claim-later', 'outcome-later'));

    const query: CalibrationQuery = {
      timeRange: [new Date('2024-05-01'), new Date('2024-07-01')],
    };
    const data = index.getCalibrationData(query);

    const allClaims = data.flatMap((p) => p.claims);
    expect(allClaims).toContain('claim-later');
    expect(allClaims).not.toContain('claim-low-0');
  });

  it('should filter by outcome types', () => {
    index.indexClaim(createTestClaim({ id: 'claim-error', confidence: 0.5 }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-error', outcomeType: 'error' }));
    index.addRelation(createTestRelation('claim-error', 'outcome-error'));

    const query: CalibrationQuery = { outcomTypes: ['error'] };
    const data = index.getCalibrationData(query);

    const allClaims = data.flatMap((p) => p.claims);
    expect(allClaims).toContain('claim-error');
  });

  it('should handle empty index', () => {
    const emptyIndex = createClaimOutcomeIndex();
    const data = emptyIndex.getCalibrationData({});
    expect(data).toEqual([]);
  });

  it('should handle claims without outcomes', () => {
    const testIndex = createClaimOutcomeIndex();
    testIndex.indexClaim(createTestClaim({ id: 'orphan-claim', confidence: 0.5 }));
    const data = testIndex.getCalibrationData({});
    // Claim without outcome should not appear in calibration data
    expect(data.flatMap((p) => p.claims)).not.toContain('orphan-claim');
  });
});

// ============================================================================
// GET CLAIM ACCURACY TESTS
// ============================================================================

describe('ClaimOutcomeIndex - getClaimAccuracy', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
  });

  it('should return accuracy for a claim with outcomes', () => {
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1', outcomeType: 'accept' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-2', outcomeType: 'accept' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-3', outcomeType: 'reject' }));

    index.addRelation(createTestRelation('claim-1', 'outcome-1'));
    index.addRelation(createTestRelation('claim-1', 'outcome-2'));
    index.addRelation(createTestRelation('claim-1', 'outcome-3'));

    const accuracy = index.getClaimAccuracy('claim-1');

    expect(accuracy.correct).toBe(2);
    expect(accuracy.total).toBe(3);
    expect(accuracy.accuracy).toBeCloseTo(2 / 3, 2);
  });

  it('should return zero accuracy for claim with no outcomes', () => {
    index.indexClaim(createTestClaim({ id: 'claim-no-outcomes' }));

    const accuracy = index.getClaimAccuracy('claim-no-outcomes');

    expect(accuracy.correct).toBe(0);
    expect(accuracy.total).toBe(0);
    expect(accuracy.accuracy).toBe(0);
  });

  it('should return zero accuracy for non-existent claim', () => {
    const accuracy = index.getClaimAccuracy('nonexistent');

    expect(accuracy.correct).toBe(0);
    expect(accuracy.total).toBe(0);
    expect(accuracy.accuracy).toBe(0);
  });

  it('should handle all accepted outcomes', () => {
    index.indexClaim(createTestClaim({ id: 'claim-all-accept' }));
    for (let i = 0; i < 5; i++) {
      index.indexOutcome(createTestOutcome({ id: `outcome-${i}`, outcomeType: 'accept' }));
      index.addRelation(createTestRelation('claim-all-accept', `outcome-${i}`));
    }

    const accuracy = index.getClaimAccuracy('claim-all-accept');
    expect(accuracy.accuracy).toBe(1.0);
  });

  it('should handle all rejected outcomes', () => {
    index.indexClaim(createTestClaim({ id: 'claim-all-reject' }));
    for (let i = 0; i < 5; i++) {
      index.indexOutcome(createTestOutcome({ id: `outcome-${i}`, outcomeType: 'reject' }));
      index.addRelation(createTestRelation('claim-all-reject', `outcome-${i}`));
    }

    const accuracy = index.getClaimAccuracy('claim-all-reject');
    expect(accuracy.accuracy).toBe(0);
  });

  it('should treat partial as partially correct', () => {
    index.indexClaim(createTestClaim({ id: 'claim-partial' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-partial', outcomeType: 'partial' }));
    index.addRelation(createTestRelation('claim-partial', 'outcome-partial'));

    const accuracy = index.getClaimAccuracy('claim-partial');
    // Partial should contribute 0.5 to correct count
    expect(accuracy.correct).toBe(0.5);
    expect(accuracy.total).toBe(1);
    expect(accuracy.accuracy).toBe(0.5);
  });

  it('should ignore error and timeout outcomes in accuracy calculation', () => {
    index.indexClaim(createTestClaim({ id: 'claim-errors' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-accept', outcomeType: 'accept' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-error', outcomeType: 'error' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-timeout', outcomeType: 'timeout' }));

    index.addRelation(createTestRelation('claim-errors', 'outcome-accept'));
    index.addRelation(createTestRelation('claim-errors', 'outcome-error'));
    index.addRelation(createTestRelation('claim-errors', 'outcome-timeout'));

    const accuracy = index.getClaimAccuracy('claim-errors');
    // Only accept outcome should count
    expect(accuracy.correct).toBe(1);
    expect(accuracy.total).toBe(1);
    expect(accuracy.accuracy).toBe(1.0);
  });
});

// ============================================================================
// TEMPORAL RELATIONSHIP TESTS
// ============================================================================

describe('ClaimOutcomeIndex - Temporal Relationships', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
  });

  it('should track claim creation time', () => {
    const createdAt = new Date('2024-01-15T10:30:00Z');
    index.indexClaim(createTestClaim({ id: 'claim-timed', createdAt }));

    const claim = index.getClaim('claim-timed');
    expect(claim?.createdAt).toEqual(createdAt);
  });

  it('should track outcome timestamp', () => {
    const timestamp = new Date('2024-01-15T11:00:00Z');
    index.indexOutcome(createTestOutcome({ id: 'outcome-timed', timestamp }));

    const outcome = index.getOutcome('outcome-timed');
    expect(outcome?.timestamp).toEqual(timestamp);
  });

  it('should track relation creation time', () => {
    const createdAt = new Date('2024-01-15T11:30:00Z');
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.addRelation(createTestRelation('claim-1', 'outcome-1', { createdAt }));

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations[0].createdAt).toEqual(createdAt);
  });

  it('should query claims by time range', () => {
    const jan = new Date('2024-01-15T10:00:00Z');
    const feb = new Date('2024-02-15T10:00:00Z');
    const mar = new Date('2024-03-15T10:00:00Z');

    index.indexClaim(createTestClaim({ id: 'claim-jan', createdAt: jan }));
    index.indexClaim(createTestClaim({ id: 'claim-feb', createdAt: feb }));
    index.indexClaim(createTestClaim({ id: 'claim-mar', createdAt: mar }));

    const febClaims = index.queryByTimeRange(
      new Date('2024-02-01'),
      new Date('2024-02-28')
    );

    expect(febClaims.length).toBe(1);
    expect(febClaims[0].id).toBe('claim-feb');
  });
});

// ============================================================================
// INTERFACE TESTS
// ============================================================================

describe('IndexedClaim Interface', () => {
  it('should support all required fields', () => {
    const claim: IndexedClaim = {
      id: 'test-id',
      content: 'Test content',
      confidence: 0.75,
      claimType: 'structural',
      createdAt: new Date(),
      source: 'test-source',
      tags: ['tag1', 'tag2'],
    };

    expect(claim.id).toBe('test-id');
    expect(claim.content).toBe('Test content');
    expect(claim.confidence).toBe(0.75);
    expect(claim.claimType).toBe('structural');
    expect(claim.source).toBe('test-source');
    expect(claim.tags).toEqual(['tag1', 'tag2']);
  });
});

describe('IndexedOutcome Interface', () => {
  it('should support all outcome types', () => {
    const types: IndexedOutcome['outcomeType'][] = ['accept', 'reject', 'error', 'timeout', 'partial'];

    for (const type of types) {
      const outcome: IndexedOutcome = {
        id: `outcome-${type}`,
        outcomeType: type,
        timestamp: new Date(),
        metadata: {},
      };
      expect(outcome.outcomeType).toBe(type);
    }
  });
});

describe('ClaimOutcomeRelation Interface', () => {
  it('should support all relationship types', () => {
    const types: ClaimOutcomeRelation['relationshipType'][] = ['caused', 'contributed', 'correlated'];

    for (const type of types) {
      const relation: ClaimOutcomeRelation = {
        claimId: 'claim-1',
        outcomeId: 'outcome-1',
        relationshipType: type,
        weight: 0.5,
        createdAt: new Date(),
      };
      expect(relation.relationshipType).toBe(type);
    }
  });
});

describe('CalibrationQuery Interface', () => {
  it('should support all query parameters', () => {
    const query: CalibrationQuery = {
      confidenceRange: [0.2, 0.8],
      claimTypes: ['structural', 'behavioral'],
      timeRange: [new Date('2024-01-01'), new Date('2024-12-31')],
      outcomTypes: ['accept', 'reject'],
    };

    expect(query.confidenceRange).toEqual([0.2, 0.8]);
    expect(query.claimTypes).toEqual(['structural', 'behavioral']);
    expect(query.outcomTypes).toEqual(['accept', 'reject']);
  });

  it('should allow empty query', () => {
    const query: CalibrationQuery = {};
    expect(query.confidenceRange).toBeUndefined();
    expect(query.claimTypes).toBeUndefined();
    expect(query.timeRange).toBeUndefined();
    expect(query.outcomTypes).toBeUndefined();
  });
});

describe('CalibrationDataPoint Interface', () => {
  it('should have all required fields', () => {
    const point: CalibrationDataPoint = {
      binStart: 0.0,
      binEnd: 0.2,
      predictedProbability: 0.1,
      actualFrequency: 0.15,
      sampleCount: 100,
      claims: ['claim-1', 'claim-2'],
    };

    expect(point.binStart).toBe(0.0);
    expect(point.binEnd).toBe(0.2);
    expect(point.predictedProbability).toBe(0.1);
    expect(point.actualFrequency).toBe(0.15);
    expect(point.sampleCount).toBe(100);
    expect(point.claims).toEqual(['claim-1', 'claim-2']);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ClaimOutcomeIndex - Edge Cases', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
  });

  it('should handle confidence exactly at 0', () => {
    index.indexClaim(createTestClaim({ id: 'claim-zero', confidence: 0 }));
    const claims = index.queryByConfidence([0, 0.1]);
    expect(claims.map((c) => c.id)).toContain('claim-zero');
  });

  it('should handle confidence exactly at 1', () => {
    index.indexClaim(createTestClaim({ id: 'claim-one', confidence: 1.0 }));
    const claims = index.queryByConfidence([0.9, 1.0]);
    expect(claims.map((c) => c.id)).toContain('claim-one');
  });

  it('should handle empty tags array', () => {
    index.indexClaim(createTestClaim({ id: 'claim-no-tags', tags: [] }));
    const claim = index.getClaim('claim-no-tags');
    expect(claim?.tags).toEqual([]);
  });

  it('should handle very long claim content', () => {
    const longContent = 'x'.repeat(10000);
    index.indexClaim(createTestClaim({ id: 'claim-long', content: longContent }));
    const claim = index.getClaim('claim-long');
    expect(claim?.content.length).toBe(10000);
  });

  it('should handle special characters in ids', () => {
    index.indexClaim(createTestClaim({ id: 'claim-special-!@#$%' }));
    const claim = index.getClaim('claim-special-!@#$%');
    expect(claim).toBeDefined();
  });

  it('should handle relation with weight 0', () => {
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.addRelation(createTestRelation('claim-1', 'outcome-1', { weight: 0 }));

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations[0].weight).toBe(0);
  });

  it('should handle relation with weight greater than 1', () => {
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.addRelation(createTestRelation('claim-1', 'outcome-1', { weight: 2.5 }));

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations[0].weight).toBe(2.5);
  });

  it('should handle querying with inverted confidence range', () => {
    index.indexClaim(createTestClaim({ id: 'claim-mid', confidence: 0.5 }));
    // Inverted range [0.8, 0.2] should return empty (or be handled gracefully)
    const claims = index.queryByConfidence([0.8, 0.2]);
    expect(claims).toEqual([]);
  });

  it('should handle large number of claims efficiently', () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      index.indexClaim(createTestClaim({ id: `claim-${i}`, confidence: Math.random() }));
    }
    const indexTime = Date.now() - start;

    const queryStart = Date.now();
    const claims = index.queryByConfidence([0.4, 0.6]);
    const queryTime = Date.now() - queryStart;

    // Should complete in reasonable time
    expect(indexTime).toBeLessThan(5000);
    expect(queryTime).toBeLessThan(1000);
    expect(claims.length).toBeGreaterThan(0);
  });

  it('should maintain data integrity after multiple operations', () => {
    // Add claims
    index.indexClaim(createTestClaim({ id: 'claim-1', confidence: 0.5 }));
    index.indexClaim(createTestClaim({ id: 'claim-2', confidence: 0.7 }));

    // Add outcomes
    index.indexOutcome(createTestOutcome({ id: 'outcome-1', outcomeType: 'accept' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-2', outcomeType: 'reject' }));

    // Add relations
    index.addRelation(createTestRelation('claim-1', 'outcome-1'));
    index.addRelation(createTestRelation('claim-2', 'outcome-2'));

    // Update a claim
    index.indexClaim(createTestClaim({ id: 'claim-1', confidence: 0.6 }));

    // Verify integrity
    const claim1 = index.getClaim('claim-1');
    expect(claim1?.confidence).toBe(0.6);

    const relations = index.getRelationsForClaim('claim-1');
    expect(relations.length).toBe(1);

    const accuracy = index.getClaimAccuracy('claim-1');
    expect(accuracy.total).toBe(1);
    expect(accuracy.correct).toBe(1);
  });
});

// ============================================================================
// STATISTICS AND AGGREGATION TESTS
// ============================================================================

describe('ClaimOutcomeIndex - Statistics', () => {
  let index: ClaimOutcomeIndex;

  beforeEach(() => {
    index = createClaimOutcomeIndex();
  });

  it('should provide total claim count', () => {
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexClaim(createTestClaim({ id: 'claim-2' }));
    index.indexClaim(createTestClaim({ id: 'claim-3' }));

    expect(index.getClaimCount()).toBe(3);
  });

  it('should provide total outcome count', () => {
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-2' }));

    expect(index.getOutcomeCount()).toBe(2);
  });

  it('should provide total relation count', () => {
    index.indexClaim(createTestClaim({ id: 'claim-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-1' }));
    index.indexOutcome(createTestOutcome({ id: 'outcome-2' }));

    index.addRelation(createTestRelation('claim-1', 'outcome-1'));
    index.addRelation(createTestRelation('claim-1', 'outcome-2'));

    expect(index.getRelationCount()).toBe(2);
  });
});
