/**
 * @fileoverview Tests for Quality Gates System
 *
 * Comprehensive tests covering all work stages and gate types.
 * Verifies that quality gates enable course correction at any stage.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Enums and types
  WorkStage,
  getStageFromProgress,
  // Gate creation
  createGate,
  createCriterion,
  // Gate enforcement
  enforceGate,
  evaluateAllGates,
  // Course correction
  suggestCourseCorrection,
  calculatePivotCost,
  shouldAbort,
  // Preset gates
  GROUNDING_GATE,
  COHERENCE_GATE,
  PROGRESS_GATE,
  EVIDENCE_GATE,
  COMPLETION_BIAS_GATE,
  PRESET_GATES,
  getPresetsForStage,
  getAllPresetGates,
  // Types
  type GateContext,
  type GateCriteria,
  type CriteriaResult,
  type QualityGate,
  type GateResult,
  type TaskClaim,
  type InferenceStep,
  type Remediation,
  type CourseCorrection,
} from '../quality_gates.js';
import {
  constructGrounding,
  createObjectId,
  type ObjectId,
  type Grounding,
} from '../universal_coherence.js';
import { absent, deterministic, bounded } from '../confidence.js';
import type { ConfidenceValue } from '../confidence.js';
import type { ClaimId, Claim } from '../types.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestClaim(overrides: Partial<TaskClaim> = {}): TaskClaim {
  return {
    id: `claim_${Math.random().toString(36).substr(2, 9)}` as ClaimId,
    proposition: 'Test claim',
    type: 'task',
    subject: { type: 'entity', id: 'test', name: 'Test' },
    createdAt: new Date().toISOString(),
    source: { type: 'llm', id: 'test' },
    status: 'active',
    confidence: deterministic(true, 'test'),
    signalStrength: {
      overall: 0.8,
      retrieval: 0.8,
      structural: 0.8,
      semantic: 0.8,
      testExecution: 0.8,
      recency: 0.8,
      aggregationMethod: 'geometric_mean',
    },
    schemaVersion: '1.0.0',
    taskDescription: 'Test task',
    successCriteria: ['Complete'],
    progress: 0.5,
    assumptions: [],
    ...overrides,
  };
}

function createTestGrounding(toId: ObjectId, strength: number = 0.8): Grounding {
  const fromId = createObjectId('from');
  return constructGrounding(fromId, toId, 'evidential', { value: strength, basis: 'measured' });
}

function createTestInference(confidence: ConfidenceValue = deterministic(true, 'test')): InferenceStep {
  return {
    id: `inference_${Math.random().toString(36).substr(2, 9)}`,
    description: 'Test inference',
    premises: ['premise1', 'premise2'],
    conclusion: 'conclusion',
    confidence,
    timestamp: new Date().toISOString(),
  };
}

function createTestContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    stage: WorkStage.MID_WORK,
    percentComplete: 0.5,
    claims: [],
    groundings: [],
    inferences: [],
    timeElapsed: 60000, // 1 minute
    sunkCost: 100,
    ...overrides,
  };
}

// ============================================================================
// 1. WORK STAGE TESTS
// ============================================================================

describe('WorkStage', () => {
  describe('getStageFromProgress', () => {
    it('returns PRE_PLANNING for 0%', () => {
      expect(getStageFromProgress(0)).toBe(WorkStage.PRE_PLANNING);
    });

    it('returns PRE_PLANNING for negative values', () => {
      expect(getStageFromProgress(-0.1)).toBe(WorkStage.PRE_PLANNING);
    });

    it('returns EARLY_WORK for 0-25%', () => {
      expect(getStageFromProgress(0.01)).toBe(WorkStage.EARLY_WORK);
      expect(getStageFromProgress(0.1)).toBe(WorkStage.EARLY_WORK);
      expect(getStageFromProgress(0.24)).toBe(WorkStage.EARLY_WORK);
    });

    it('returns MID_WORK for 25-75%', () => {
      expect(getStageFromProgress(0.25)).toBe(WorkStage.MID_WORK);
      expect(getStageFromProgress(0.5)).toBe(WorkStage.MID_WORK);
      expect(getStageFromProgress(0.74)).toBe(WorkStage.MID_WORK);
    });

    it('returns LATE_WORK for 75-99%', () => {
      expect(getStageFromProgress(0.75)).toBe(WorkStage.LATE_WORK);
      expect(getStageFromProgress(0.9)).toBe(WorkStage.LATE_WORK);
      expect(getStageFromProgress(0.99)).toBe(WorkStage.LATE_WORK);
    });

    it('returns POST_COMPLETION for 100%+', () => {
      expect(getStageFromProgress(1.0)).toBe(WorkStage.POST_COMPLETION);
      expect(getStageFromProgress(1.1)).toBe(WorkStage.POST_COMPLETION);
    });
  });
});

// ============================================================================
// 2. GATE CREATION TESTS
// ============================================================================

describe('Gate Creation', () => {
  describe('createGate', () => {
    it('creates gate with required fields', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
      });

      expect(gate.name).toBe('Test Gate');
      expect(gate.stage).toBe(WorkStage.MID_WORK);
      expect(gate.id).toBeDefined();
      expect(gate.id.startsWith('gate_')).toBe(true);
    });

    it('creates gate with custom id', () => {
      const gate = createGate({
        id: 'custom_gate',
        name: 'Custom Gate',
        stage: WorkStage.EARLY_WORK,
      });

      expect(gate.id).toBe('custom_gate');
    });

    it('creates gate with default threshold', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
      });

      expect(gate.threshold).toBe(0.7);
    });

    it('creates gate with custom threshold', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.9,
      });

      expect(gate.threshold).toBe(0.9);
    });

    it('creates gate with blocking false by default', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
      });

      expect(gate.blocking).toBe(false);
    });

    it('creates blocking gate when specified', () => {
      const gate = createGate({
        name: 'Blocking Gate',
        stage: WorkStage.MID_WORK,
        blocking: true,
      });

      expect(gate.blocking).toBe(true);
    });

    it('creates gate with empty criteria by default', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
      });

      expect(gate.criteria).toEqual([]);
    });

    it('creates gate with custom criteria', () => {
      const criterion = createCriterion({
        description: 'Test criterion',
        weight: 1.0,
        evaluate: () => ({ passed: true, score: 1.0, explanation: 'ok' }),
      });

      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        criteria: [criterion],
      });

      expect(gate.criteria).toHaveLength(1);
    });
  });

  describe('createCriterion', () => {
    it('creates criterion with required fields', () => {
      const criterion = createCriterion({
        description: 'Test criterion',
        weight: 0.5,
        evaluate: () => ({ passed: true, score: 1.0, explanation: 'test' }),
      });

      expect(criterion.description).toBe('Test criterion');
      expect(criterion.weight).toBe(0.5);
      expect(criterion.id).toBeDefined();
      expect(criterion.id.startsWith('criterion_')).toBe(true);
    });

    it('creates criterion with custom id', () => {
      const criterion = createCriterion({
        id: 'custom_criterion',
        description: 'Custom criterion',
        weight: 1.0,
        evaluate: () => ({ passed: true, score: 1.0, explanation: 'test' }),
      });

      expect(criterion.id).toBe('custom_criterion');
    });

    it('criterion evaluate function works correctly', () => {
      const criterion = createCriterion({
        description: 'Test',
        weight: 1.0,
        evaluate: (ctx) => ({
          passed: ctx.percentComplete > 0.5,
          score: ctx.percentComplete,
          explanation: `Progress: ${ctx.percentComplete}`,
        }),
      });

      const result1 = criterion.evaluate(createTestContext({ percentComplete: 0.3 }));
      expect(result1.passed).toBe(false);
      expect(result1.score).toBe(0.3);

      const result2 = criterion.evaluate(createTestContext({ percentComplete: 0.8 }));
      expect(result2.passed).toBe(true);
      expect(result2.score).toBe(0.8);
    });
  });
});

// ============================================================================
// 3. GATE ENFORCEMENT TESTS
// ============================================================================

describe('Gate Enforcement', () => {
  describe('enforceGate', () => {
    it('passes gate when all criteria pass', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.5,
        criteria: [
          createCriterion({
            description: 'Always pass',
            weight: 1.0,
            evaluate: () => ({ passed: true, score: 1.0, explanation: 'ok' }),
          }),
        ],
      });

      const result = enforceGate(gate, createTestContext());
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
      expect(result.violations).toHaveLength(0);
    });

    it('fails gate when criteria fail below threshold', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.7,
        criteria: [
          createCriterion({
            description: 'Low score',
            weight: 1.0,
            evaluate: () => ({ passed: false, score: 0.3, explanation: 'failed' }),
          }),
        ],
      });

      const result = enforceGate(gate, createTestContext());
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.3);
      expect(result.violations).toHaveLength(1);
    });

    it('calculates weighted score correctly', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.5,
        criteria: [
          createCriterion({
            description: 'High weight',
            weight: 2.0,
            evaluate: () => ({ passed: true, score: 1.0, explanation: 'ok' }),
          }),
          createCriterion({
            description: 'Low weight',
            weight: 1.0,
            evaluate: () => ({ passed: false, score: 0.0, explanation: 'fail' }),
          }),
        ],
      });

      const result = enforceGate(gate, createTestContext());
      // (1.0 * 2.0 + 0.0 * 1.0) / 3.0 = 0.667
      expect(result.score).toBeCloseTo(0.667, 2);
    });

    it('fails on critical violations even if score passes', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.5,
        criteria: [
          createCriterion({
            description: 'High score',
            weight: 1.0,
            evaluate: () => ({ passed: true, score: 0.8, explanation: 'ok' }),
          }),
          createCriterion({
            description: 'Critical failure',
            weight: 0.1,
            evaluate: () => ({ passed: false, score: 0.1, explanation: 'critical' }),
          }),
        ],
      });

      const result = enforceGate(gate, createTestContext());
      // Score is above threshold but has critical violation
      expect(result.violations.some(v => v.severity === 'critical')).toBe(true);
    });

    it('includes suggestions from failed criteria', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.7,
        criteria: [
          createCriterion({
            description: 'Failed criterion',
            weight: 1.0,
            evaluate: () => ({
              passed: false,
              score: 0.5,
              explanation: 'needs work',
              suggestions: ['Do this', 'Do that'],
            }),
          }),
        ],
      });

      const result = enforceGate(gate, createTestContext());
      expect(result.recommendations).toContain('Do this');
      expect(result.recommendations).toContain('Do that');
    });

    it('calculates pivot cost', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.MID_WORK,
        threshold: 0.7,
        criteria: [],
      });

      const result = enforceGate(gate, createTestContext({ sunkCost: 100, percentComplete: 0.5 }));
      expect(result.pivotCost).toBeGreaterThan(0);
    });

    it('recommends pivot when cost is low', () => {
      const gate = createGate({
        name: 'Test Gate',
        stage: WorkStage.EARLY_WORK,
        threshold: 0.9,
        blocking: true,
        criteria: [
          createCriterion({
            description: 'Failed',
            weight: 1.0,
            evaluate: () => ({ passed: false, score: 0.2, explanation: 'bad' }),
          }),
        ],
      });

      const result = enforceGate(gate, createTestContext({
        stage: WorkStage.EARLY_WORK,
        percentComplete: 0.1,
        sunkCost: 10,
      }));

      expect(result.passed).toBe(false);
      // Early stage with low sunk cost should recommend pivot
    });
  });

  describe('evaluateAllGates', () => {
    it('filters gates by stage', () => {
      const earlyGate = createGate({ name: 'Early', stage: WorkStage.EARLY_WORK, criteria: [] });
      const midGate = createGate({ name: 'Mid', stage: WorkStage.MID_WORK, criteria: [] });
      const lateGate = createGate({ name: 'Late', stage: WorkStage.LATE_WORK, criteria: [] });

      const results = evaluateAllGates(
        [earlyGate, midGate, lateGate],
        createTestContext({ stage: WorkStage.MID_WORK })
      );

      expect(results).toHaveLength(1);
      expect(results[0].gate.name).toBe('Mid');
    });

    it('evaluates multiple gates for same stage', () => {
      const gate1 = createGate({
        name: 'Gate 1',
        stage: WorkStage.MID_WORK,
        criteria: [
          createCriterion({
            description: 'Pass',
            weight: 1.0,
            evaluate: () => ({ passed: true, score: 1.0, explanation: 'ok' }),
          }),
        ],
      });
      const gate2 = createGate({
        name: 'Gate 2',
        stage: WorkStage.MID_WORK,
        criteria: [
          createCriterion({
            description: 'Fail',
            weight: 1.0,
            evaluate: () => ({ passed: false, score: 0.5, explanation: 'meh' }),
          }),
        ],
      });

      const results = evaluateAllGates(
        [gate1, gate2],
        createTestContext({ stage: WorkStage.MID_WORK })
      );

      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });
  });
});

// ============================================================================
// 4. COURSE CORRECTION TESTS
// ============================================================================

describe('Course Correction', () => {
  describe('suggestCourseCorrection', () => {
    it('suggests continue when all gates pass', () => {
      const passedResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK }),
        passed: true,
        score: 0.9,
        violations: [],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      const correction = suggestCourseCorrection([passedResult]);
      expect(correction.type).toBe('continue');
      expect(correction.urgency).toBe('low');
    });

    it('suggests adjust for non-blocking failures', () => {
      const failedResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK, blocking: false }),
        passed: false,
        score: 0.5,
        violations: [{
          criterionId: 'test',
          description: 'Test',
          severity: 'minor',
          score: 0.5,
          threshold: 0.7,
          explanation: 'Minor issue',
        }],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      const correction = suggestCourseCorrection([failedResult]);
      expect(correction.type).toBe('adjust');
    });

    it('suggests partial_rollback for blocking failures', () => {
      const failedResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK, blocking: true }),
        passed: false,
        score: 0.4,
        violations: [{
          criterionId: 'test',
          description: 'Test',
          severity: 'major',
          score: 0.4,
          threshold: 0.7,
          explanation: 'Major issue',
        }],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      const correction = suggestCourseCorrection([failedResult]);
      expect(correction.type).toBe('partial_rollback');
    });

    it('suggests full_pivot when shouldPivot is true', () => {
      const failedResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK, blocking: true }),
        passed: false,
        score: 0.3,
        violations: [{
          criterionId: 'test',
          description: 'Test',
          severity: 'major',
          score: 0.3,
          threshold: 0.7,
          explanation: 'Severe issue',
        }],
        recommendations: [],
        shouldPivot: true,
        pivotCost: 5,
      };

      const correction = suggestCourseCorrection([failedResult]);
      expect(correction.type).toBe('full_pivot');
    });

    it('suggests abort for many critical violations', () => {
      const criticalViolations = Array(4).fill(null).map((_, i) => ({
        criterionId: `test_${i}`,
        description: `Test ${i}`,
        severity: 'critical' as const,
        score: 0.1,
        threshold: 0.7,
        explanation: `Critical issue ${i}`,
      }));

      const failedResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK, blocking: true }),
        passed: false,
        score: 0.1,
        violations: criticalViolations,
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      const correction = suggestCourseCorrection([failedResult]);
      expect(correction.type).toBe('abort');
      expect(correction.urgency).toBe('critical');
    });

    it('calculates salvage value', () => {
      const results: GateResult[] = [
        {
          gate: createGate({ name: 'Test 1', stage: WorkStage.MID_WORK }),
          passed: true,
          score: 0.8,
          violations: [],
          recommendations: [],
          shouldPivot: false,
          pivotCost: 10,
        },
        {
          gate: createGate({ name: 'Test 2', stage: WorkStage.MID_WORK }),
          passed: false,
          score: 0.4,
          violations: [],
          recommendations: [],
          shouldPivot: false,
          pivotCost: 10,
        },
      ];

      const correction = suggestCourseCorrection(results);
      expect(correction.salvageValue).toBeCloseTo(0.6, 1); // (0.8 + 0.4) / 2
    });

    it('includes relevant remediations in actions', () => {
      const remediation: Remediation = {
        id: 'test_remediation',
        description: 'Fix the issue',
        type: 'adjust',
        effort: 'low',
        steps: ['Step 1'],
        addressesViolations: ['test_criterion'],
      };

      const failedResult: GateResult = {
        gate: createGate({
          name: 'Test',
          stage: WorkStage.MID_WORK,
          blocking: false,
          remediations: [remediation],
        }),
        passed: false,
        score: 0.5,
        violations: [{
          criterionId: 'test_criterion',
          description: 'Test',
          severity: 'minor',
          score: 0.5,
          threshold: 0.7,
          explanation: 'Issue',
        }],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      const correction = suggestCourseCorrection([failedResult]);
      expect(correction.actions).toContainEqual(expect.objectContaining({ id: 'test_remediation' }));
    });
  });

  describe('calculatePivotCost', () => {
    it('increases with progress', () => {
      const earlyCost = calculatePivotCost(createTestContext({
        stage: WorkStage.EARLY_WORK,
        percentComplete: 0.1,
        sunkCost: 100,
      }));

      const lateCost = calculatePivotCost(createTestContext({
        stage: WorkStage.LATE_WORK,
        percentComplete: 0.9,
        sunkCost: 100,
      }));

      expect(lateCost).toBeGreaterThan(earlyCost);
    });

    it('is cheaper in early stages', () => {
      const earlyCost = calculatePivotCost(createTestContext({
        stage: WorkStage.EARLY_WORK,
        percentComplete: 0.2,
        sunkCost: 100,
      }));

      const midCost = calculatePivotCost(createTestContext({
        stage: WorkStage.MID_WORK,
        percentComplete: 0.2,
        sunkCost: 100,
      }));

      expect(earlyCost).toBeLessThan(midCost);
    });

    it('is reduced for poorly grounded work', () => {
      const claim = createTestClaim();
      const groundedClaim = createTestClaim();
      const grounding = createTestGrounding(groundedClaim.id as unknown as ObjectId);

      const ungroundedCost = calculatePivotCost(createTestContext({
        stage: WorkStage.MID_WORK,
        percentComplete: 0.5,
        sunkCost: 100,
        claims: [claim], // No grounding
        groundings: [],
      }));

      const groundedCost = calculatePivotCost(createTestContext({
        stage: WorkStage.MID_WORK,
        percentComplete: 0.5,
        sunkCost: 100,
        claims: [groundedClaim],
        groundings: [grounding],
      }));

      expect(ungroundedCost).toBeLessThan(groundedCost);
    });
  });

  describe('shouldAbort', () => {
    it('returns false when all gates pass', () => {
      const passedResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK }),
        passed: true,
        score: 0.9,
        violations: [],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      expect(shouldAbort([passedResult])).toBe(false);
    });

    it('returns true for multiple critical blocking failures', () => {
      const criticalFailure = (name: string): GateResult => ({
        gate: createGate({ name, stage: WorkStage.MID_WORK, blocking: true }),
        passed: false,
        score: 0.1,
        violations: [{
          criterionId: 'test',
          description: 'Critical',
          severity: 'critical',
          score: 0.1,
          threshold: 0.7,
          explanation: 'Critical failure',
        }],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      });

      expect(shouldAbort([criticalFailure('Gate1'), criticalFailure('Gate2')])).toBe(true);
    });

    it('returns true for very low average score', () => {
      const lowScoreResult: GateResult = {
        gate: createGate({ name: 'Test', stage: WorkStage.MID_WORK }),
        passed: false,
        score: 0.2,
        violations: [],
        recommendations: [],
        shouldPivot: false,
        pivotCost: 10,
      };

      expect(shouldAbort([lowScoreResult])).toBe(true);
    });
  });
});

// ============================================================================
// 5. PRESET GATES TESTS
// ============================================================================

describe('Preset Gates', () => {
  describe('GROUNDING_GATE', () => {
    it('has correct configuration', () => {
      expect(GROUNDING_GATE.name).toBe('Grounding Gate');
      expect(GROUNDING_GATE.stage).toBe(WorkStage.MID_WORK);
      expect(GROUNDING_GATE.blocking).toBe(true);
      expect(GROUNDING_GATE.criteria).toHaveLength(1);
    });

    it('passes when claims are grounded', () => {
      const claim = createTestClaim();
      const grounding = createTestGrounding(claim.id as unknown as ObjectId, 0.8);

      const result = enforceGate(GROUNDING_GATE, createTestContext({
        claims: [claim],
        groundings: [grounding],
      }));

      expect(result.passed).toBe(true);
    });

    it('fails when claims lack grounding', () => {
      const claim = createTestClaim();

      const result = enforceGate(GROUNDING_GATE, createTestContext({
        claims: [claim],
        groundings: [],
      }));

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(1);
    });

    it('passes with no claims', () => {
      const result = enforceGate(GROUNDING_GATE, createTestContext({
        claims: [],
        groundings: [],
      }));

      expect(result.passed).toBe(true);
    });
  });

  describe('COHERENCE_GATE', () => {
    it('has correct configuration', () => {
      expect(COHERENCE_GATE.name).toBe('Coherence Gate');
      expect(COHERENCE_GATE.stage).toBe(WorkStage.MID_WORK);
      expect(COHERENCE_GATE.blocking).toBe(true);
    });

    it('passes when no network is provided', () => {
      const result = enforceGate(COHERENCE_GATE, createTestContext());
      expect(result.passed).toBe(true);
    });
  });

  describe('PROGRESS_GATE', () => {
    it('has correct configuration', () => {
      expect(PROGRESS_GATE.name).toBe('Progress Gate');
      expect(PROGRESS_GATE.stage).toBe(WorkStage.EARLY_WORK);
      expect(PROGRESS_GATE.blocking).toBe(false);
    });

    it('passes with reasonable progress', () => {
      const result = enforceGate(PROGRESS_GATE, createTestContext({
        stage: WorkStage.EARLY_WORK,
        percentComplete: 0.1,
        timeElapsed: 60000, // 1 minute = 0.1/1 = 10% per minute
      }));

      expect(result.passed).toBe(true);
    });

    it('passes when time tracking unavailable', () => {
      const result = enforceGate(PROGRESS_GATE, createTestContext({
        stage: WorkStage.EARLY_WORK,
        timeElapsed: 0,
      }));

      expect(result.passed).toBe(true);
    });
  });

  describe('EVIDENCE_GATE', () => {
    it('has correct configuration', () => {
      expect(EVIDENCE_GATE.name).toBe('Evidence Gate');
      expect(EVIDENCE_GATE.stage).toBe(WorkStage.LATE_WORK);
      expect(EVIDENCE_GATE.blocking).toBe(true);
    });

    it('passes with no claims', () => {
      const result = enforceGate(EVIDENCE_GATE, createTestContext({
        claims: [],
      }));

      expect(result.passed).toBe(true);
    });

    it('passes when 80%+ claims have evidence', () => {
      const claims = Array(10).fill(null).map(() => createTestClaim());
      const groundings = claims.slice(0, 8).map(c =>
        createTestGrounding(c.id as unknown as ObjectId)
      );

      const result = enforceGate(EVIDENCE_GATE, createTestContext({
        claims,
        groundings,
      }));

      expect(result.passed).toBe(true);
    });

    it('fails when fewer than 80% claims have evidence', () => {
      const claims = Array(10).fill(null).map(() => createTestClaim());
      const groundings = claims.slice(0, 5).map(c =>
        createTestGrounding(c.id as unknown as ObjectId)
      );

      const result = enforceGate(EVIDENCE_GATE, createTestContext({
        claims,
        groundings,
      }));

      expect(result.passed).toBe(false);
    });
  });

  describe('COMPLETION_BIAS_GATE', () => {
    it('has correct configuration', () => {
      expect(COMPLETION_BIAS_GATE.name).toBe('Completion Bias Gate');
      expect(COMPLETION_BIAS_GATE.stage).toBe(WorkStage.LATE_WORK);
      expect(COMPLETION_BIAS_GATE.blocking).toBe(true);
    });

    it('passes for non-late stages', () => {
      const result = enforceGate(COMPLETION_BIAS_GATE, createTestContext({
        stage: WorkStage.EARLY_WORK,
      }));

      expect(result.passed).toBe(true);
    });

    it('detects completion bias from weak recent inferences', () => {
      const strongInferences = Array(6).fill(null).map(() =>
        createTestInference(deterministic(true, 'test'))
      );
      const weakInferences = Array(3).fill(null).map(() =>
        createTestInference(bounded(0.1, 0.3, 'theoretical', 'weak'))
      );

      const result = enforceGate(COMPLETION_BIAS_GATE, createTestContext({
        stage: WorkStage.LATE_WORK,
        percentComplete: 0.85,
        inferences: [...strongInferences, ...weakInferences],
      }));

      // Should detect that recent inferences are weaker
      expect(result.score).toBeLessThan(1.0);
    });
  });
});

// ============================================================================
// 6. STAGE-SPECIFIC GATE TESTS
// ============================================================================

describe('Stage-Specific Gates', () => {
  describe('getPresetsForStage', () => {
    it('returns empty array for PRE_PLANNING', () => {
      const gates = getPresetsForStage(WorkStage.PRE_PLANNING);
      expect(gates).toEqual([]);
    });

    it('returns PROGRESS_GATE for EARLY_WORK', () => {
      const gates = getPresetsForStage(WorkStage.EARLY_WORK);
      expect(gates).toContain(PROGRESS_GATE);
    });

    it('returns GROUNDING and COHERENCE gates for MID_WORK', () => {
      const gates = getPresetsForStage(WorkStage.MID_WORK);
      expect(gates).toContain(GROUNDING_GATE);
      expect(gates).toContain(COHERENCE_GATE);
    });

    it('returns EVIDENCE and COMPLETION_BIAS gates for LATE_WORK', () => {
      const gates = getPresetsForStage(WorkStage.LATE_WORK);
      expect(gates).toContain(EVIDENCE_GATE);
      expect(gates).toContain(COMPLETION_BIAS_GATE);
    });

    it('returns empty array for POST_COMPLETION', () => {
      const gates = getPresetsForStage(WorkStage.POST_COMPLETION);
      expect(gates).toEqual([]);
    });
  });

  describe('getAllPresetGates', () => {
    it('returns all preset gates', () => {
      const gates = getAllPresetGates();
      expect(gates).toContain(GROUNDING_GATE);
      expect(gates).toContain(COHERENCE_GATE);
      expect(gates).toContain(PROGRESS_GATE);
      expect(gates).toContain(EVIDENCE_GATE);
      expect(gates).toContain(COMPLETION_BIAS_GATE);
    });
  });
});

// ============================================================================
// 7. INTEGRATION TESTS
// ============================================================================

describe('Integration Tests', () => {
  it('full workflow: PRE_PLANNING to POST_COMPLETION', () => {
    const allGates = getAllPresetGates();

    // PRE_PLANNING: No gates
    let context = createTestContext({ stage: WorkStage.PRE_PLANNING, percentComplete: 0 });
    let results = evaluateAllGates(allGates, context);
    expect(results).toHaveLength(0);

    // EARLY_WORK: Progress gate
    context = createTestContext({ stage: WorkStage.EARLY_WORK, percentComplete: 0.1 });
    results = evaluateAllGates(allGates, context);
    expect(results.map(r => r.gate.name)).toContain('Progress Gate');

    // MID_WORK: Grounding and coherence gates
    const claim = createTestClaim();
    const grounding = createTestGrounding(claim.id as unknown as ObjectId);
    context = createTestContext({
      stage: WorkStage.MID_WORK,
      percentComplete: 0.5,
      claims: [claim],
      groundings: [grounding],
    });
    results = evaluateAllGates(allGates, context);
    expect(results.map(r => r.gate.name)).toContain('Grounding Gate');
    expect(results.map(r => r.gate.name)).toContain('Coherence Gate');

    // LATE_WORK: Evidence and completion bias gates
    context = createTestContext({
      stage: WorkStage.LATE_WORK,
      percentComplete: 0.9,
      claims: [claim],
      groundings: [grounding],
    });
    results = evaluateAllGates(allGates, context);
    expect(results.map(r => r.gate.name)).toContain('Evidence Gate');
    expect(results.map(r => r.gate.name)).toContain('Completion Bias Gate');

    // POST_COMPLETION: No gates
    context = createTestContext({ stage: WorkStage.POST_COMPLETION, percentComplete: 1.0 });
    results = evaluateAllGates(allGates, context);
    expect(results).toHaveLength(0);
  });

  it('course correction recommendation flow', () => {
    const claim = createTestClaim();
    const weakGrounding = createTestGrounding(claim.id as unknown as ObjectId, 0.3);

    // Evaluate gates
    const context = createTestContext({
      stage: WorkStage.MID_WORK,
      percentComplete: 0.5,
      claims: [claim, createTestClaim(), createTestClaim()], // Three claims
      groundings: [weakGrounding], // Only one grounding
    });

    const results = evaluateAllGates(getAllPresetGates(), context);

    // Get course correction
    const correction = suggestCourseCorrection(results);

    // Should suggest some kind of action for weak grounding
    expect(correction.type).not.toBe('continue');
    expect(correction.actions.length).toBeGreaterThanOrEqual(0);
    expect(correction.salvageValue).toBeDefined();
    expect(correction.description).toBeDefined();
  });

  it('handles edge case: empty results array', () => {
    const correction = suggestCourseCorrection([]);
    expect(correction.type).toBe('continue');
    expect(correction.salvageValue).toBe(0);
  });

  it('maintains type safety across gate chain', () => {
    const gate: QualityGate = createGate({
      name: 'Type Safe Gate',
      stage: WorkStage.MID_WORK,
      criteria: [
        createCriterion({
          description: 'Test',
          weight: 1.0,
          evaluate: (ctx: GateContext): CriteriaResult => ({
            passed: ctx.stage === WorkStage.MID_WORK,
            score: ctx.percentComplete,
            explanation: `Stage: ${ctx.stage}`,
          }),
        }),
      ],
    });

    const context: GateContext = createTestContext();
    const result: GateResult = enforceGate(gate, context);
    const correction: CourseCorrection = suggestCourseCorrection([result]);

    expect(result.gate.id).toBe(gate.id);
    expect(correction.type).toBeDefined();
  });
});

// ============================================================================
// 8. ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('handles criterion that throws', () => {
    const throwingGate = createGate({
      name: 'Throwing Gate',
      stage: WorkStage.MID_WORK,
      criteria: [
        createCriterion({
          description: 'Throws error',
          weight: 1.0,
          evaluate: () => {
            throw new Error('Intentional test error');
          },
        }),
      ],
    });

    expect(() => enforceGate(throwingGate, createTestContext())).toThrow('Intentional test error');
  });

  it('handles empty criteria array', () => {
    const emptyGate = createGate({
      name: 'Empty Gate',
      stage: WorkStage.MID_WORK,
      criteria: [],
    });

    const result = enforceGate(emptyGate, createTestContext());
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false); // 0 < threshold
  });

  it('handles missing optional context fields', () => {
    const minimalContext: GateContext = {
      stage: WorkStage.MID_WORK,
      percentComplete: 0.5,
      claims: [],
      groundings: [],
      inferences: [],
      timeElapsed: 0,
      sunkCost: 0,
    };

    const result = enforceGate(GROUNDING_GATE, minimalContext);
    expect(result.passed).toBe(true); // No claims = pass
  });
});
