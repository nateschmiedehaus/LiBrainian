/**
 * @fileoverview Tests for Fix Planning Primitive
 */

import { describe, it, expect } from 'vitest';
import {
  planFix,
  createPlanFix,
  type Issue,
  type PlanFixOptions,
} from '../plan_fix.js';

describe('planFix', () => {
  const mockBugIssue: Issue = {
    id: 'issue-1',
    type: 'bug',
    description: 'Function throws on null input',
    location: '/test/src/utils/parser.ts',
    severity: 'high',
    evidence: [
      {
        type: 'test',
        content: 'Test fails with TypeError',
        location: '/test/src/__tests__/parser.test.ts',
        confidence: { score: 0.9, tier: 'high', source: 'measured' },
      },
    ],
  };

  const mockArchitectureIssue: Issue = {
    id: 'issue-2',
    type: 'architecture',
    description: 'Circular dependency between modules',
    location: '/test/src/core/processor.ts',
    severity: 'medium',
    evidence: [],
  };

  const mockPerformanceIssue: Issue = {
    id: 'issue-3',
    type: 'performance',
    description: 'Slow database queries in hot path',
    location: '/test/src/api/handler.ts',
    severity: 'critical',
    evidence: [],
  };

  it('returns result structure with all required fields', async () => {
    const result = await planFix(mockBugIssue);

    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('affectedFiles');
    expect(result).toHaveProperty('riskAssessment');
    expect(result).toHaveProperty('verificationCriteria');
    expect(result).toHaveProperty('meetsConstraints');
    expect(result).toHaveProperty('constraintViolations');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(typeof result.duration).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('generates fix plan for bug issues', async () => {
    const result = await planFix(mockBugIssue);

    expect(result.plan.issue).toBe(mockBugIssue);
    expect(result.plan.summary).toContain('bug');
    expect(result.plan.proposedChanges.length).toBeGreaterThan(0);
  });

  it('generates fix plan for architecture issues', async () => {
    const result = await planFix(mockArchitectureIssue);

    expect(result.plan.issue).toBe(mockArchitectureIssue);
    expect(result.plan.summary).toContain('architecture');
    expect(result.plan.proposedChanges.length).toBeGreaterThan(0);
  });

  it('generates fix plan for performance issues', async () => {
    const result = await planFix(mockPerformanceIssue);

    expect(result.plan.issue).toBe(mockPerformanceIssue);
    expect(result.plan.summary).toContain('performance');
    expect(result.plan.proposedChanges.length).toBeGreaterThan(0);
  });

  describe('proposed changes', () => {
    it('includes change type for each change', async () => {
      const result = await planFix(mockBugIssue);

      for (const change of result.plan.proposedChanges) {
        expect(change).toHaveProperty('order');
        expect(change).toHaveProperty('description');
        expect(change).toHaveProperty('file');
        expect(change).toHaveProperty('changeType');
        expect(change).toHaveProperty('estimatedLoc');
        expect(['add', 'modify', 'delete', 'refactor']).toContain(change.changeType);
      }
    });

    it('changes are ordered sequentially', async () => {
      const result = await planFix(mockArchitectureIssue);

      for (let i = 1; i < result.plan.proposedChanges.length; i++) {
        expect(result.plan.proposedChanges[i].order).toBeGreaterThanOrEqual(
          result.plan.proposedChanges[i - 1].order
        );
      }
    });
  });

  describe('test plan', () => {
    it('includes test plan with required fields', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.plan.testPlan).toHaveProperty('unitTests');
      expect(result.plan.testPlan).toHaveProperty('integrationTests');
      expect(result.plan.testPlan).toHaveProperty('manualChecks');
      expect(Array.isArray(result.plan.testPlan.unitTests)).toBe(true);
      expect(Array.isArray(result.plan.testPlan.integrationTests)).toBe(true);
      expect(Array.isArray(result.plan.testPlan.manualChecks)).toBe(true);
    });

    it('generates unit tests for bug fixes', async () => {
      const result = await planFix(mockBugIssue);

      // Bug fixes should include regression and edge case tests
      expect(result.plan.testPlan.unitTests.length).toBeGreaterThan(0);
      expect(result.plan.testPlan.unitTests.some((t) =>
        t.toLowerCase().includes('regression') || t.toLowerCase().includes('edge case')
      )).toBe(true);
    });
  });

  describe('rollback plan', () => {
    it('includes rollback plan with required fields', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.plan.rollbackPlan).toHaveProperty('strategy');
      expect(result.plan.rollbackPlan).toHaveProperty('steps');
      expect(result.plan.rollbackPlan).toHaveProperty('revertibleFiles');
      expect(result.plan.rollbackPlan).toHaveProperty('estimatedTimeMinutes');
      expect(Array.isArray(result.plan.rollbackPlan.steps)).toBe(true);
    });

    it('rollback steps cover all changes', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.plan.rollbackPlan.steps.length).toBeGreaterThanOrEqual(
        result.plan.proposedChanges.length
      );
    });
  });

  describe('risk assessment', () => {
    it('includes risk assessment with required fields', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.riskAssessment).toHaveProperty('overallRisk');
      expect(result.riskAssessment).toHaveProperty('risks');
      expect(result.riskAssessment).toHaveProperty('totalRiskScore');
      expect(result.riskAssessment).toHaveProperty('prioritizedMitigations');
      expect(['low', 'medium', 'high', 'critical']).toContain(result.riskAssessment.overallRisk);
    });

    it('critical issues have higher risk assessment', async () => {
      const criticalIssue: Issue = { ...mockBugIssue, severity: 'critical' };
      const lowIssue: Issue = { ...mockBugIssue, severity: 'low' };

      const criticalResult = await planFix(criticalIssue);
      const lowResult = await planFix(lowIssue);

      // Critical should generally have higher risk
      const riskOrder = ['low', 'medium', 'high', 'critical'];
      const criticalRiskIndex = riskOrder.indexOf(criticalResult.riskAssessment.overallRisk);
      const lowRiskIndex = riskOrder.indexOf(lowResult.riskAssessment.overallRisk);

      expect(criticalRiskIndex).toBeGreaterThanOrEqual(lowRiskIndex);
    });

    it('each risk has required structure', async () => {
      const result = await planFix(mockBugIssue);

      for (const risk of result.riskAssessment.risks) {
        expect(risk).toHaveProperty('type');
        expect(risk).toHaveProperty('description');
        expect(risk).toHaveProperty('likelihood');
        expect(risk).toHaveProperty('impact');
        expect(risk).toHaveProperty('mitigation');
        expect(risk).toHaveProperty('score');
        expect(risk.likelihood).toBeGreaterThanOrEqual(0);
        expect(risk.likelihood).toBeLessThanOrEqual(1);
        expect(risk.impact).toBeGreaterThanOrEqual(0);
        expect(risk.impact).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('verification criteria', () => {
    it('includes verification criteria with required fields', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.verificationCriteria).toHaveProperty('assertions');
      expect(result.verificationCriteria).toHaveProperty('metricThresholds');
      expect(result.verificationCriteria).toHaveProperty('manualChecklist');
      expect(result.verificationCriteria).toHaveProperty('timeoutMs');
    });

    it('metric thresholds have correct structure', async () => {
      const result = await planFix(mockPerformanceIssue);

      for (const threshold of result.verificationCriteria.metricThresholds) {
        expect(threshold).toHaveProperty('metric');
        expect(threshold).toHaveProperty('operator');
        expect(threshold).toHaveProperty('value');
        expect(['gt', 'lt', 'eq', 'gte', 'lte']).toContain(threshold.operator);
      }
    });
  });

  describe('effort estimation', () => {
    it('includes effort estimation with required fields', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.plan.estimatedEffort).toHaveProperty('loc');
      expect(result.plan.estimatedEffort).toHaveProperty('hours');
      expect(result.plan.estimatedEffort).toHaveProperty('complexity');
      expect(result.plan.estimatedEffort).toHaveProperty('confidence');
    });

    it('LOC range is valid', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.plan.estimatedEffort.loc.min).toBeLessThanOrEqual(
        result.plan.estimatedEffort.loc.max
      );
      expect(result.plan.estimatedEffort.loc.min).toBeGreaterThanOrEqual(0);
    });

    it('hours range is valid', async () => {
      const result = await planFix(mockBugIssue);

      expect(result.plan.estimatedEffort.hours.min).toBeLessThanOrEqual(
        result.plan.estimatedEffort.hours.max
      );
      expect(result.plan.estimatedEffort.hours.min).toBeGreaterThanOrEqual(0);
    });

    it('complexity is valid enum value', async () => {
      const result = await planFix(mockBugIssue);

      expect(['trivial', 'simple', 'moderate', 'complex', 'very_complex']).toContain(
        result.plan.estimatedEffort.complexity
      );
    });
  });

  describe('constraint validation', () => {
    it('validates against default constraints', async () => {
      const result = await planFix(mockBugIssue);

      expect(typeof result.meetsConstraints).toBe('boolean');
      expect(Array.isArray(result.constraintViolations)).toBe(true);
    });

    it('respects maxChanges option', async () => {
      const result = await planFix(mockBugIssue, { maxChanges: 1 });

      expect(result.plan.proposedChanges.length).toBeLessThanOrEqual(1);
    });

    it('respects custom constraints', async () => {
      const options: PlanFixOptions = {
        constraints: {
          maxFilesChanged: 1,
          preservePublicApi: true,
          requireBackwardCompatibility: true,
        },
      };

      const result = await planFix(mockArchitectureIssue, options);

      // Architecture issues may need multiple files, so this might fail constraints
      if (!result.meetsConstraints) {
        expect(result.constraintViolations.length).toBeGreaterThan(0);
      }
    });
  });

  describe('affected files', () => {
    it('lists affected files', async () => {
      const result = await planFix(mockBugIssue);

      expect(Array.isArray(result.affectedFiles)).toBe(true);
      expect(result.affectedFiles.length).toBeGreaterThan(0);
      expect(result.affectedFiles).toContain(mockBugIssue.location);
    });

    it('affected files match proposed changes', async () => {
      const result = await planFix(mockBugIssue);

      const changedFiles = result.plan.proposedChanges.map((c) => c.file);
      for (const file of result.affectedFiles) {
        expect(changedFiles).toContain(file);
      }
    });
  });

  describe('createPlanFix', () => {
    it('creates a bound planning function with default options', async () => {
      const boundPlanFix = createPlanFix({
        requireTests: false,
        maxChanges: 5,
      });

      const result = await boundPlanFix(mockBugIssue);

      expect(result.plan.proposedChanges.length).toBeLessThanOrEqual(5);
    });

    it('allows overriding default options', async () => {
      const boundPlanFix = createPlanFix({
        maxChanges: 5,
      });

      const result = await boundPlanFix(mockBugIssue, { maxChanges: 2 });

      expect(result.plan.proposedChanges.length).toBeLessThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('handles issue with no evidence', async () => {
      const issueNoEvidence: Issue = {
        ...mockBugIssue,
        evidence: [],
      };

      const result = await planFix(issueNoEvidence);

      expect(result.plan).toBeDefined();
      expect(result.plan.proposedChanges.length).toBeGreaterThan(0);
    });

    it('handles consistency issues', async () => {
      const consistencyIssue: Issue = {
        id: 'issue-4',
        type: 'consistency',
        description: 'Documentation does not match code',
        location: '/test/src/api/handler.ts',
        severity: 'low',
        evidence: [],
      };

      const result = await planFix(consistencyIssue);

      expect(result.plan).toBeDefined();
      expect(result.plan.summary).toContain('consistency');
    });

    it('handles theoretical issues', async () => {
      const theoreticalIssue: Issue = {
        id: 'issue-5',
        type: 'theoretical',
        description: 'Confidence values not properly calibrated',
        location: '/test/src/epistemics/confidence.ts',
        severity: 'medium',
        evidence: [],
      };

      const result = await planFix(theoreticalIssue);

      expect(result.plan).toBeDefined();
      expect(result.plan.summary).toContain('theoretical');
    });
  });
});
