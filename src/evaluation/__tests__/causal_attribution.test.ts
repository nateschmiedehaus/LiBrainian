/**
 * @fileoverview Tests for Causal Attribution for Outcomes (WU-CALX-001)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The CausalAttributor determines which claims/decisions caused specific outcomes
 * using counterfactual analysis. This helps identify which claims led to
 * successful or failed outcomes.
 *
 * Key concepts:
 * - Claims are statements with confidence and source information
 * - Outcomes are results (accept, reject, error, success) linked to claims
 * - Attribution scores measure how much each claim contributed to an outcome
 * - Counterfactual delta estimates outcome change if the claim were different
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CausalAttributor,
  createCausalAttributor,
  type Claim,
  type Outcome,
  type AttributionResult,
  type AttributionReport,
  type ClaimImpact,
} from '../causal_attribution.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createTestClaim = (
  id: string,
  content: string,
  confidence: number = 0.8,
  minutesAgo: number = 0
): Claim => ({
  id,
  content,
  confidence,
  timestamp: new Date(Date.now() - minutesAgo * 60 * 1000),
  source: `test-source-${id}`,
});

const createTestOutcome = (
  id: string,
  type: Outcome['type'],
  relatedClaimIds: string[],
  minutesAgo: number = 0
): Outcome => ({
  id,
  type,
  description: `${type} outcome for ${id}`,
  timestamp: new Date(Date.now() - minutesAgo * 60 * 1000),
  relatedClaimIds,
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createCausalAttributor', () => {
  it('should create a CausalAttributor instance', () => {
    const attributor = createCausalAttributor();
    expect(attributor).toBeInstanceOf(CausalAttributor);
  });

  it('should create a fresh instance with no claims or outcomes', () => {
    const attributor = createCausalAttributor();
    const claims = attributor.getClaims();
    const outcomes = attributor.getOutcomes();
    expect(claims).toEqual([]);
    expect(outcomes).toEqual([]);
  });
});

// ============================================================================
// CLAIM RECORDING TESTS
// ============================================================================

describe('CausalAttributor - recordClaim', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should record a single claim', () => {
    const claim = createTestClaim('claim-1', 'Function X returns string');
    attributor.recordClaim(claim);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toEqual(claim);
  });

  it('should record multiple claims', () => {
    const claim1 = createTestClaim('claim-1', 'Function X returns string');
    const claim2 = createTestClaim('claim-2', 'Class Y has method Z');
    const claim3 = createTestClaim('claim-3', 'File A imports B');

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordClaim(claim3);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(3);
  });

  it('should preserve claim order', () => {
    const claim1 = createTestClaim('claim-1', 'First claim');
    const claim2 = createTestClaim('claim-2', 'Second claim');
    const claim3 = createTestClaim('claim-3', 'Third claim');

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordClaim(claim3);

    const claims = attributor.getClaims();
    expect(claims[0].id).toBe('claim-1');
    expect(claims[1].id).toBe('claim-2');
    expect(claims[2].id).toBe('claim-3');
  });

  it('should allow duplicate claim IDs (tracking evolving claims)', () => {
    const claim1 = createTestClaim('claim-1', 'Initial content', 0.5);
    const claim2 = createTestClaim('claim-1', 'Updated content', 0.9);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(2);
  });

  it('should handle claims with zero confidence', () => {
    const claim = createTestClaim('claim-1', 'Low confidence claim', 0);
    attributor.recordClaim(claim);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].confidence).toBe(0);
  });

  it('should handle claims with confidence of 1.0', () => {
    const claim = createTestClaim('claim-1', 'High confidence claim', 1.0);
    attributor.recordClaim(claim);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].confidence).toBe(1.0);
  });
});

// ============================================================================
// OUTCOME RECORDING TESTS
// ============================================================================

describe('CausalAttributor - recordOutcome', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should record a single outcome', () => {
    const outcome = createTestOutcome('outcome-1', 'success', ['claim-1']);
    attributor.recordOutcome(outcome);

    const outcomes = attributor.getOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(outcome);
  });

  it('should record multiple outcomes', () => {
    const outcome1 = createTestOutcome('outcome-1', 'success', ['claim-1']);
    const outcome2 = createTestOutcome('outcome-2', 'error', ['claim-2']);
    const outcome3 = createTestOutcome('outcome-3', 'reject', ['claim-3']);

    attributor.recordOutcome(outcome1);
    attributor.recordOutcome(outcome2);
    attributor.recordOutcome(outcome3);

    const outcomes = attributor.getOutcomes();
    expect(outcomes).toHaveLength(3);
  });

  it('should handle outcomes with multiple related claims', () => {
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
      'claim-3',
    ]);
    attributor.recordOutcome(outcome);

    const outcomes = attributor.getOutcomes();
    expect(outcomes[0].relatedClaimIds).toHaveLength(3);
  });

  it('should handle outcomes with no related claims', () => {
    const outcome = createTestOutcome('outcome-1', 'error', []);
    attributor.recordOutcome(outcome);

    const outcomes = attributor.getOutcomes();
    expect(outcomes[0].relatedClaimIds).toHaveLength(0);
  });

  it('should handle all outcome types', () => {
    const types: Outcome['type'][] = ['accept', 'reject', 'error', 'success'];

    types.forEach((type) => {
      const outcome = createTestOutcome(`outcome-${type}`, type, ['claim-1']);
      attributor.recordOutcome(outcome);
    });

    const outcomes = attributor.getOutcomes();
    expect(outcomes).toHaveLength(4);
    expect(outcomes.map((o) => o.type)).toEqual(types);
  });
});

// ============================================================================
// ATTRIBUTION COMPUTATION TESTS
// ============================================================================

describe('CausalAttributor - computeAttribution', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should compute attribution for an outcome with single claim', () => {
    const claim = createTestClaim('claim-1', 'Function X returns string', 0.9);
    const outcome = createTestOutcome('outcome-1', 'success', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    expect(report.outcomeId).toBe('outcome-1');
    expect(report.attributions).toHaveLength(1);
    expect(report.attributions[0].claimId).toBe('claim-1');
    expect(report.attributions[0].attributionScore).toBe(1.0); // Sole contributor
  });

  it('should compute attribution for an outcome with multiple claims', () => {
    const claim1 = createTestClaim('claim-1', 'Function X returns string', 0.9);
    const claim2 = createTestClaim('claim-2', 'Function X is async', 0.8);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    expect(report.attributions).toHaveLength(2);
    // Attributions should sum to 1.0 (or close to it)
    const totalAttribution = report.attributions.reduce(
      (sum, a) => sum + a.attributionScore,
      0
    );
    expect(totalAttribution).toBeCloseTo(1.0, 2);
  });

  it('should return empty attributions for non-existent outcome', () => {
    const report = attributor.computeAttribution('non-existent');

    expect(report.outcomeId).toBe('non-existent');
    expect(report.attributions).toEqual([]);
    expect(report.uncertaintyLevel).toBe('high');
  });

  it('should weight by claim confidence', () => {
    const highConfClaim = createTestClaim('high', 'High confidence', 0.95);
    const lowConfClaim = createTestClaim('low', 'Low confidence', 0.3);
    const outcome = createTestOutcome('outcome-1', 'success', ['high', 'low']);

    attributor.recordClaim(highConfClaim);
    attributor.recordClaim(lowConfClaim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    const highAttribution = report.attributions.find(
      (a) => a.claimId === 'high'
    );
    const lowAttribution = report.attributions.find((a) => a.claimId === 'low');

    expect(highAttribution!.attributionScore).toBeGreaterThan(
      lowAttribution!.attributionScore
    );
  });

  it('should weight by temporal proximity', () => {
    // Older claim (10 minutes ago)
    const oldClaim = createTestClaim('old', 'Old claim', 0.8, 10);
    // Recent claim (1 minute ago)
    const recentClaim = createTestClaim('recent', 'Recent claim', 0.8, 1);
    // Outcome happened now
    const outcome = createTestOutcome('outcome-1', 'success', [
      'old',
      'recent',
    ]);

    attributor.recordClaim(oldClaim);
    attributor.recordClaim(recentClaim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    const oldAttribution = report.attributions.find((a) => a.claimId === 'old');
    const recentAttribution = report.attributions.find(
      (a) => a.claimId === 'recent'
    );

    // Recent claim should have higher attribution due to temporal proximity
    expect(recentAttribution!.attributionScore).toBeGreaterThan(
      oldAttribution!.attributionScore
    );
  });

  it('should identify dominant claim when one clearly dominates', () => {
    const dominant = createTestClaim('dominant', 'Dominant claim', 0.99);
    const minor1 = createTestClaim('minor1', 'Minor claim 1', 0.1);
    const minor2 = createTestClaim('minor2', 'Minor claim 2', 0.1);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'dominant',
      'minor1',
      'minor2',
    ]);

    attributor.recordClaim(dominant);
    attributor.recordClaim(minor1);
    attributor.recordClaim(minor2);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    expect(report.dominantClaim).toBe('dominant');
  });

  it('should not identify dominant claim when contributions are balanced', () => {
    const claim1 = createTestClaim('claim-1', 'Claim 1', 0.7);
    const claim2 = createTestClaim('claim-2', 'Claim 2', 0.7);
    const claim3 = createTestClaim('claim-3', 'Claim 3', 0.7);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
      'claim-3',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordClaim(claim3);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    // With balanced contributions, no single claim should dominate
    expect(report.dominantClaim).toBeUndefined();
  });

  it('should compute counterfactual delta', () => {
    const claim1 = createTestClaim('claim-1', 'Critical claim', 0.95);
    const claim2 = createTestClaim('claim-2', 'Minor claim', 0.3);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    // Each attribution should have counterfactual delta
    report.attributions.forEach((attribution) => {
      expect(typeof attribution.counterfactualDelta).toBe('number');
      expect(attribution.counterfactualDelta).toBeGreaterThanOrEqual(0);
      expect(attribution.counterfactualDelta).toBeLessThanOrEqual(1);
    });
  });

  it('should include confidence in attribution results', () => {
    const claim = createTestClaim('claim-1', 'Test claim', 0.8);
    const outcome = createTestOutcome('outcome-1', 'success', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    expect(report.attributions[0].confidence).toBeGreaterThanOrEqual(0);
    expect(report.attributions[0].confidence).toBeLessThanOrEqual(1);
  });

  it('should include explanation in attribution results', () => {
    const claim = createTestClaim('claim-1', 'Test claim', 0.8);
    const outcome = createTestOutcome('outcome-1', 'success', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    expect(report.attributions[0].explanation).toBeDefined();
    expect(report.attributions[0].explanation.length).toBeGreaterThan(0);
  });

  it('should determine appropriate uncertainty level', () => {
    // Low uncertainty: single high-confidence claim
    const highConfClaim = createTestClaim('high', 'High confidence', 0.95);
    const outcome1 = createTestOutcome('outcome-low', 'success', ['high']);

    attributor.recordClaim(highConfClaim);
    attributor.recordOutcome(outcome1);

    const reportLow = attributor.computeAttribution('outcome-low');
    expect(reportLow.uncertaintyLevel).toBe('low');

    // High uncertainty: multiple low-confidence claims
    const lowConf1 = createTestClaim('low1', 'Low conf 1', 0.3);
    const lowConf2 = createTestClaim('low2', 'Low conf 2', 0.3);
    const lowConf3 = createTestClaim('low3', 'Low conf 3', 0.3);
    const outcome2 = createTestOutcome('outcome-high', 'success', [
      'low1',
      'low2',
      'low3',
    ]);

    attributor.recordClaim(lowConf1);
    attributor.recordClaim(lowConf2);
    attributor.recordClaim(lowConf3);
    attributor.recordOutcome(outcome2);

    const reportHigh = attributor.computeAttribution('outcome-high');
    expect(['medium', 'high']).toContain(reportHigh.uncertaintyLevel);
  });
});

// ============================================================================
// CLAIM IMPACT TESTS
// ============================================================================

describe('CausalAttributor - getClaimImpact', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should return zero impact for claim with no outcomes', () => {
    const claim = createTestClaim('claim-1', 'Isolated claim', 0.8);
    attributor.recordClaim(claim);

    const impact = attributor.getClaimImpact('claim-1');

    expect(impact.positiveOutcomes).toBe(0);
    expect(impact.negativeOutcomes).toBe(0);
    expect(impact.avgAttribution).toBe(0);
  });

  it('should count positive outcomes correctly', () => {
    const claim = createTestClaim('claim-1', 'Test claim', 0.8);
    const success1 = createTestOutcome('success-1', 'success', ['claim-1']);
    const success2 = createTestOutcome('success-2', 'success', ['claim-1']);
    const accept = createTestOutcome('accept-1', 'accept', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(success1);
    attributor.recordOutcome(success2);
    attributor.recordOutcome(accept);

    const impact = attributor.getClaimImpact('claim-1');

    expect(impact.positiveOutcomes).toBe(3);
  });

  it('should count negative outcomes correctly', () => {
    const claim = createTestClaim('claim-1', 'Test claim', 0.8);
    const error1 = createTestOutcome('error-1', 'error', ['claim-1']);
    const error2 = createTestOutcome('error-2', 'error', ['claim-1']);
    const reject = createTestOutcome('reject-1', 'reject', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(error1);
    attributor.recordOutcome(error2);
    attributor.recordOutcome(reject);

    const impact = attributor.getClaimImpact('claim-1');

    expect(impact.negativeOutcomes).toBe(3);
  });

  it('should compute average attribution across outcomes', () => {
    const claim = createTestClaim('claim-1', 'Test claim', 0.9);
    const outcome1 = createTestOutcome('outcome-1', 'success', ['claim-1']);
    const outcome2 = createTestOutcome('outcome-2', 'success', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome1);
    attributor.recordOutcome(outcome2);

    const impact = attributor.getClaimImpact('claim-1');

    // Sole contributor in both outcomes, should have avg close to 1.0
    expect(impact.avgAttribution).toBeCloseTo(1.0, 1);
  });

  it('should return zero for non-existent claim', () => {
    const impact = attributor.getClaimImpact('non-existent');

    expect(impact.positiveOutcomes).toBe(0);
    expect(impact.negativeOutcomes).toBe(0);
    expect(impact.avgAttribution).toBe(0);
  });

  it('should track mixed positive and negative outcomes', () => {
    const claim = createTestClaim('claim-1', 'Test claim', 0.8);
    const success = createTestOutcome('success-1', 'success', ['claim-1']);
    const error = createTestOutcome('error-1', 'error', ['claim-1']);
    const accept = createTestOutcome('accept-1', 'accept', ['claim-1']);
    const reject = createTestOutcome('reject-1', 'reject', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(success);
    attributor.recordOutcome(error);
    attributor.recordOutcome(accept);
    attributor.recordOutcome(reject);

    const impact = attributor.getClaimImpact('claim-1');

    expect(impact.positiveOutcomes).toBe(2); // success + accept
    expect(impact.negativeOutcomes).toBe(2); // error + reject
  });
});

// ============================================================================
// FIND HIGH IMPACT CLAIMS TESTS
// ============================================================================

describe('CausalAttributor - findHighImpactClaims', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should return empty array when no claims exist', () => {
    const highImpact = attributor.findHighImpactClaims(0.5);
    expect(highImpact).toEqual([]);
  });

  it('should return empty array when no claims meet threshold', () => {
    const claim1 = createTestClaim('claim-1', 'Low impact claim', 0.2);
    const claim2 = createTestClaim('claim-2', 'Another low impact', 0.3);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordOutcome(outcome);

    const highImpact = attributor.findHighImpactClaims(0.9);
    expect(highImpact).toEqual([]);
  });

  it('should return claims above attribution threshold', () => {
    const highImpact = createTestClaim('high', 'High impact', 0.95);
    const lowImpact = createTestClaim('low', 'Low impact', 0.2);
    const outcome = createTestOutcome('outcome-1', 'success', ['high', 'low']);

    attributor.recordClaim(highImpact);
    attributor.recordClaim(lowImpact);
    attributor.recordOutcome(outcome);

    const results = attributor.findHighImpactClaims(0.6);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('high');
  });

  it('should return multiple high impact claims', () => {
    const high1 = createTestClaim('high1', 'High impact 1', 0.9);
    const high2 = createTestClaim('high2', 'High impact 2', 0.85);
    const outcome1 = createTestOutcome('outcome-1', 'success', ['high1']);
    const outcome2 = createTestOutcome('outcome-2', 'success', ['high2']);

    attributor.recordClaim(high1);
    attributor.recordClaim(high2);
    attributor.recordOutcome(outcome1);
    attributor.recordOutcome(outcome2);

    const results = attributor.findHighImpactClaims(0.7);

    expect(results).toHaveLength(2);
  });

  it('should handle threshold of 0 (returns all claims with outcomes)', () => {
    const claim1 = createTestClaim('claim-1', 'Claim 1', 0.5);
    const claim2 = createTestClaim('claim-2', 'Claim 2', 0.5);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordOutcome(outcome);

    const results = attributor.findHighImpactClaims(0);
    expect(results).toHaveLength(2);
  });

  it('should handle threshold of 1.0 (only perfect attribution)', () => {
    // Only a sole contributor can have attribution of 1.0
    const sole = createTestClaim('sole', 'Sole contributor', 0.9);
    const shared1 = createTestClaim('shared1', 'Shared 1', 0.8);
    const shared2 = createTestClaim('shared2', 'Shared 2', 0.8);
    const outcomeSole = createTestOutcome('sole-outcome', 'success', ['sole']);
    const outcomeShared = createTestOutcome('shared-outcome', 'success', [
      'shared1',
      'shared2',
    ]);

    attributor.recordClaim(sole);
    attributor.recordClaim(shared1);
    attributor.recordClaim(shared2);
    attributor.recordOutcome(outcomeSole);
    attributor.recordOutcome(outcomeShared);

    const results = attributor.findHighImpactClaims(1.0);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('sole');
  });

  it('should not include claims without outcomes', () => {
    const withOutcome = createTestClaim('with', 'Has outcome', 0.9);
    const withoutOutcome = createTestClaim('without', 'No outcome', 0.95);
    const outcome = createTestOutcome('outcome-1', 'success', ['with']);

    attributor.recordClaim(withOutcome);
    attributor.recordClaim(withoutOutcome);
    attributor.recordOutcome(outcome);

    const results = attributor.findHighImpactClaims(0.5);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('with');
  });
});

// ============================================================================
// SHAPLEY VALUE TESTS
// ============================================================================

describe('CausalAttributor - Shapley Value Attribution', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should satisfy efficiency property (attributions sum to 1)', () => {
    const claim1 = createTestClaim('claim-1', 'Claim 1', 0.8);
    const claim2 = createTestClaim('claim-2', 'Claim 2', 0.7);
    const claim3 = createTestClaim('claim-3', 'Claim 3', 0.6);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
      'claim-3',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordClaim(claim3);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');
    const totalAttribution = report.attributions.reduce(
      (sum, a) => sum + a.attributionScore,
      0
    );

    expect(totalAttribution).toBeCloseTo(1.0, 2);
  });

  it('should satisfy symmetry property (equal claims get equal attribution)', () => {
    // Two claims with identical properties should get equal attribution
    const claim1 = createTestClaim('claim-1', 'Same content', 0.8, 5);
    const claim2 = createTestClaim('claim-2', 'Same content', 0.8, 5);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');
    const attr1 = report.attributions.find((a) => a.claimId === 'claim-1');
    const attr2 = report.attributions.find((a) => a.claimId === 'claim-2');

    expect(attr1!.attributionScore).toBeCloseTo(attr2!.attributionScore, 2);
  });

  it('should give zero attribution to claims not related to outcome', () => {
    const related = createTestClaim('related', 'Related claim', 0.8);
    const unrelated = createTestClaim('unrelated', 'Unrelated claim', 0.9);
    const outcome = createTestOutcome('outcome-1', 'success', ['related']);

    attributor.recordClaim(related);
    attributor.recordClaim(unrelated);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    // Unrelated claim should not appear in attributions
    const unrelatedAttr = report.attributions.find(
      (a) => a.claimId === 'unrelated'
    );
    expect(unrelatedAttr).toBeUndefined();
  });

  it('should handle large number of claims (performance)', () => {
    const numClaims = 20;
    const claimIds: string[] = [];

    for (let i = 0; i < numClaims; i++) {
      const claim = createTestClaim(
        `claim-${i}`,
        `Claim ${i}`,
        Math.random() * 0.5 + 0.5
      );
      attributor.recordClaim(claim);
      claimIds.push(`claim-${i}`);
    }

    const outcome = createTestOutcome('outcome-1', 'success', claimIds);
    attributor.recordOutcome(outcome);

    const startTime = Date.now();
    const report = attributor.computeAttribution('outcome-1');
    const endTime = Date.now();

    // Should complete in reasonable time (< 1 second)
    expect(endTime - startTime).toBeLessThan(1000);
    expect(report.attributions).toHaveLength(numClaims);
  });
});

// ============================================================================
// COUNTERFACTUAL ANALYSIS TESTS
// ============================================================================

describe('CausalAttributor - Counterfactual Analysis', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should estimate high delta for sole contributor', () => {
    const sole = createTestClaim('sole', 'Only claim', 0.9);
    const outcome = createTestOutcome('outcome-1', 'success', ['sole']);

    attributor.recordClaim(sole);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    // Removing the sole contributor would change outcome completely
    expect(report.attributions[0].counterfactualDelta).toBeGreaterThan(0.8);
  });

  it('should estimate lower delta for one of many contributors', () => {
    const claim1 = createTestClaim('claim-1', 'Claim 1', 0.8);
    const claim2 = createTestClaim('claim-2', 'Claim 2', 0.8);
    const claim3 = createTestClaim('claim-3', 'Claim 3', 0.8);
    const claim4 = createTestClaim('claim-4', 'Claim 4', 0.8);
    const outcome = createTestOutcome('outcome-1', 'success', [
      'claim-1',
      'claim-2',
      'claim-3',
      'claim-4',
    ]);

    attributor.recordClaim(claim1);
    attributor.recordClaim(claim2);
    attributor.recordClaim(claim3);
    attributor.recordClaim(claim4);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    // Each claim should have moderate delta (removing one might not change outcome)
    report.attributions.forEach((attr) => {
      expect(attr.counterfactualDelta).toBeLessThan(0.5);
    });
  });

  it('should have higher delta for high confidence claims', () => {
    const highConf = createTestClaim('high', 'High confidence', 0.95);
    const lowConf = createTestClaim('low', 'Low confidence', 0.3);
    const outcome = createTestOutcome('outcome-1', 'success', ['high', 'low']);

    attributor.recordClaim(highConf);
    attributor.recordClaim(lowConf);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');
    const highAttr = report.attributions.find((a) => a.claimId === 'high');
    const lowAttr = report.attributions.find((a) => a.claimId === 'low');

    expect(highAttr!.counterfactualDelta).toBeGreaterThan(
      lowAttr!.counterfactualDelta
    );
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('CausalAttributor - Edge Cases', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should handle outcome with claim that was never recorded', () => {
    const outcome = createTestOutcome('outcome-1', 'success', ['unknown-claim']);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');

    // Should handle gracefully - either empty or with neutral attributions
    expect(report.outcomeId).toBe('outcome-1');
    expect(report.uncertaintyLevel).toBe('high');
  });

  it('should handle claim with empty content', () => {
    const claim = createTestClaim('empty', '', 0.5);
    attributor.recordClaim(claim);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].content).toBe('');
  });

  it('should handle outcome with empty description', () => {
    const outcome: Outcome = {
      id: 'outcome-1',
      type: 'success',
      description: '',
      timestamp: new Date(),
      relatedClaimIds: ['claim-1'],
    };

    const claim = createTestClaim('claim-1', 'Test', 0.8);
    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');
    expect(report.attributions).toHaveLength(1);
  });

  it('should handle claims with timestamps in the future', () => {
    const futureClaim: Claim = {
      id: 'future',
      content: 'Future claim',
      confidence: 0.8,
      timestamp: new Date(Date.now() + 1000 * 60 * 60), // 1 hour in future
      source: 'test',
    };

    attributor.recordClaim(futureClaim);
    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
  });

  it('should handle very old claims', () => {
    const oldClaim = createTestClaim('old', 'Very old claim', 0.8, 60 * 24 * 30); // 30 days ago
    attributor.recordClaim(oldClaim);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
  });

  it('should handle claim and outcome with same timestamp', () => {
    const now = new Date();
    const claim: Claim = {
      id: 'claim-1',
      content: 'Test claim',
      confidence: 0.8,
      timestamp: now,
      source: 'test',
    };
    const outcome: Outcome = {
      id: 'outcome-1',
      type: 'success',
      description: 'Test outcome',
      timestamp: now,
      relatedClaimIds: ['claim-1'],
    };

    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome);

    const report = attributor.computeAttribution('outcome-1');
    expect(report.attributions).toHaveLength(1);
  });

  it('should handle very long claim content', () => {
    const longContent = 'A'.repeat(10000);
    const claim = createTestClaim('long', longContent, 0.8);
    attributor.recordClaim(claim);

    const claims = attributor.getClaims();
    expect(claims[0].content.length).toBe(10000);
  });

  it('should handle special characters in claim content', () => {
    const specialContent =
      'Function<T, U> returns Promise<Map<string, Array<number>>>';
    const claim = createTestClaim('special', specialContent, 0.8);
    attributor.recordClaim(claim);

    const claims = attributor.getClaims();
    expect(claims[0].content).toBe(specialContent);
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('Claim Interface', () => {
  it('should support all required fields', () => {
    const claim: Claim = {
      id: 'claim-1',
      content: 'Function X returns string',
      confidence: 0.85,
      timestamp: new Date(),
      source: 'entailment_checker',
    };

    expect(claim.id).toBe('claim-1');
    expect(claim.content).toBe('Function X returns string');
    expect(claim.confidence).toBe(0.85);
    expect(claim.timestamp).toBeInstanceOf(Date);
    expect(claim.source).toBe('entailment_checker');
  });

  it('should validate confidence range', () => {
    const validClaims: Claim[] = [
      {
        id: 'c1',
        content: 'Test',
        confidence: 0,
        timestamp: new Date(),
        source: 's',
      },
      {
        id: 'c2',
        content: 'Test',
        confidence: 0.5,
        timestamp: new Date(),
        source: 's',
      },
      {
        id: 'c3',
        content: 'Test',
        confidence: 1.0,
        timestamp: new Date(),
        source: 's',
      },
    ];

    validClaims.forEach((claim) => {
      expect(claim.confidence).toBeGreaterThanOrEqual(0);
      expect(claim.confidence).toBeLessThanOrEqual(1);
    });
  });
});

describe('Outcome Interface', () => {
  it('should support all required fields', () => {
    const outcome: Outcome = {
      id: 'outcome-1',
      type: 'success',
      description: 'Query answered successfully',
      timestamp: new Date(),
      relatedClaimIds: ['claim-1', 'claim-2'],
    };

    expect(outcome.id).toBe('outcome-1');
    expect(outcome.type).toBe('success');
    expect(outcome.description).toBe('Query answered successfully');
    expect(outcome.timestamp).toBeInstanceOf(Date);
    expect(outcome.relatedClaimIds).toEqual(['claim-1', 'claim-2']);
  });

  it('should support all outcome types', () => {
    const types: Outcome['type'][] = ['accept', 'reject', 'error', 'success'];

    types.forEach((type) => {
      const outcome: Outcome = {
        id: 'test',
        type,
        description: 'test',
        timestamp: new Date(),
        relatedClaimIds: [],
      };
      expect(outcome.type).toBe(type);
    });
  });
});

describe('AttributionResult Interface', () => {
  it('should support all required fields', () => {
    const result: AttributionResult = {
      claimId: 'claim-1',
      outcomeId: 'outcome-1',
      attributionScore: 0.75,
      counterfactualDelta: 0.6,
      confidence: 0.9,
      explanation: 'Primary contributor due to high confidence and recency',
    };

    expect(result.claimId).toBe('claim-1');
    expect(result.outcomeId).toBe('outcome-1');
    expect(result.attributionScore).toBe(0.75);
    expect(result.counterfactualDelta).toBe(0.6);
    expect(result.confidence).toBe(0.9);
    expect(result.explanation).toContain('Primary contributor');
  });

  it('should have scores in valid ranges', () => {
    const result: AttributionResult = {
      claimId: 'c1',
      outcomeId: 'o1',
      attributionScore: 0.5,
      counterfactualDelta: 0.3,
      confidence: 0.8,
      explanation: 'test',
    };

    expect(result.attributionScore).toBeGreaterThanOrEqual(0);
    expect(result.attributionScore).toBeLessThanOrEqual(1);
    expect(result.counterfactualDelta).toBeGreaterThanOrEqual(0);
    expect(result.counterfactualDelta).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('AttributionReport Interface', () => {
  it('should support all required fields', () => {
    const report: AttributionReport = {
      outcomeId: 'outcome-1',
      attributions: [
        {
          claimId: 'claim-1',
          outcomeId: 'outcome-1',
          attributionScore: 0.6,
          counterfactualDelta: 0.5,
          confidence: 0.85,
          explanation: 'Major contributor',
        },
        {
          claimId: 'claim-2',
          outcomeId: 'outcome-1',
          attributionScore: 0.4,
          counterfactualDelta: 0.3,
          confidence: 0.7,
          explanation: 'Minor contributor',
        },
      ],
      dominantClaim: 'claim-1',
      uncertaintyLevel: 'low',
    };

    expect(report.outcomeId).toBe('outcome-1');
    expect(report.attributions).toHaveLength(2);
    expect(report.dominantClaim).toBe('claim-1');
    expect(report.uncertaintyLevel).toBe('low');
  });

  it('should support all uncertainty levels', () => {
    const levels: AttributionReport['uncertaintyLevel'][] = [
      'low',
      'medium',
      'high',
    ];

    levels.forEach((level) => {
      const report: AttributionReport = {
        outcomeId: 'test',
        attributions: [],
        uncertaintyLevel: level,
      };
      expect(report.uncertaintyLevel).toBe(level);
    });
  });

  it('should allow undefined dominantClaim', () => {
    const report: AttributionReport = {
      outcomeId: 'test',
      attributions: [],
      uncertaintyLevel: 'high',
    };

    expect(report.dominantClaim).toBeUndefined();
  });
});

describe('ClaimImpact Interface', () => {
  it('should support all required fields', () => {
    const impact: ClaimImpact = {
      positiveOutcomes: 5,
      negativeOutcomes: 2,
      avgAttribution: 0.75,
    };

    expect(impact.positiveOutcomes).toBe(5);
    expect(impact.negativeOutcomes).toBe(2);
    expect(impact.avgAttribution).toBe(0.75);
  });

  it('should allow zero values', () => {
    const impact: ClaimImpact = {
      positiveOutcomes: 0,
      negativeOutcomes: 0,
      avgAttribution: 0,
    };

    expect(impact.positiveOutcomes).toBe(0);
    expect(impact.negativeOutcomes).toBe(0);
    expect(impact.avgAttribution).toBe(0);
  });
});

// ============================================================================
// CLEAR/RESET TESTS
// ============================================================================

describe('CausalAttributor - clear', () => {
  let attributor: CausalAttributor;

  beforeEach(() => {
    attributor = createCausalAttributor();
  });

  it('should clear all claims and outcomes', () => {
    const claim = createTestClaim('claim-1', 'Test', 0.8);
    const outcome = createTestOutcome('outcome-1', 'success', ['claim-1']);

    attributor.recordClaim(claim);
    attributor.recordOutcome(outcome);

    attributor.clear();

    expect(attributor.getClaims()).toEqual([]);
    expect(attributor.getOutcomes()).toEqual([]);
  });

  it('should allow recording after clear', () => {
    const claim1 = createTestClaim('claim-1', 'First', 0.8);
    attributor.recordClaim(claim1);
    attributor.clear();

    const claim2 = createTestClaim('claim-2', 'Second', 0.9);
    attributor.recordClaim(claim2);

    const claims = attributor.getClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe('claim-2');
  });
});
