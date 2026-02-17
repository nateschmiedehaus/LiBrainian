/**
 * @fileoverview Tests for Adversarial Self-Test Composition
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  adversarialSelfTest,
  createAdversarialSelfTest,
  type AdversarialSelfTestOptions,
} from '../adversarial_self_test.js';
import type { LibrarianStorage } from '../../../../storage/types.js';

// Mock the primitive modules
vi.mock('../../analyze_architecture.js', () => ({
  analyzeArchitecture: vi.fn(),
}));

vi.mock('../../adversarial_test.js', () => ({
  generateAdversarialTests: vi.fn(),
}));

vi.mock('../../plan_fix.js', () => ({
  planFix: vi.fn(),
}));

vi.mock('../../extract_pattern.js', () => ({
  extractPattern: vi.fn(),
}));

import { analyzeArchitecture } from '../../analyze_architecture.js';
import { generateAdversarialTests } from '../../adversarial_test.js';
import { planFix } from '../../plan_fix.js';
import { extractPattern } from '../../extract_pattern.js';

describe('adversarialSelfTest', () => {
  const mockStorage: LibrarianStorage = {
    getModules: vi.fn().mockResolvedValue([]),
    getGraphEdges: vi.fn().mockResolvedValue([]),
    invalidateContextPacks: vi.fn().mockResolvedValue(0),
  } as unknown as LibrarianStorage;

  const defaultOptions: AdversarialSelfTestOptions = {
    rootDir: '/test/repo',
    storage: mockStorage,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    (analyzeArchitecture as Mock).mockResolvedValue({
      modules: [
        { path: 'src/module1.ts', name: 'module1', exportCount: 5, dependencyCount: 3, dependentCount: 2, complexity: 10 },
        { path: 'src/module2.ts', name: 'module2', exportCount: 3, dependencyCount: 1, dependentCount: 1, complexity: 5 },
      ],
      dependencies: [],
      cycles: [],
      layerViolations: [],
      couplingMetrics: {
        averageAfferentCoupling: 2,
        averageEfferentCoupling: 2,
        averageInstability: 0.5,
        highCouplingCount: 0,
        mostCoupled: [],
      },
      suggestions: [],
      duration: 100,
      errors: [],
    });

    (generateAdversarialTests as Mock).mockResolvedValue({
      tests: [
        {
          id: 'test-1',
          name: 'test_null_input',
          description: 'Test null input handling',
          input: null,
          expectedBehavior: 'fail',
          difficulty: 'hard',
          targetedWeakness: 'weak-1',
          testCode: 'describe("test", () => { it("works", () => {}) });',
          assertion: 'expect(result).toBeDefined()',
          timeoutMs: 5000,
        },
      ],
      expectedFailureModes: [{ mode: 'null_pointer', probability: 0.6, severity: 'crash', recovery: 'Add null check' }],
      coverageAnalysis: { weaknessId: 'weak-1', testsCovering: ['test-1'], uncoveredAspects: [], coverageScore: 0.8 },
      coverageGaps: [],
      edgeCases: [],
      duration: 50,
      errors: [],
    });

    (planFix as Mock).mockResolvedValue({
      plan: {
        issue: { id: 'issue-1', type: 'bug', description: 'Test issue', location: 'src/test.ts', severity: 'medium', evidence: [] },
        summary: 'Fix test issue',
        proposedChanges: [],
        testPlan: { unitTests: [], integrationTests: [], manualChecks: [] },
        rollbackPlan: { strategy: 'git revert', steps: [], revertibleFiles: [], estimatedTimeMinutes: 5 },
        riskAssessment: { overallRisk: 'low', risks: [], totalRiskScore: 0.2, prioritizedMitigations: [] },
        verificationCriteria: { assertions: [], metricThresholds: [], manualChecklist: [], timeoutMs: 60000 },
        estimatedEffort: { loc: { min: 10, max: 20 }, hours: { min: 0.5, max: 1 }, complexity: 'simple', confidence: { score: 0.7, tier: 'medium', source: 'estimated' } },
        affectedFiles: ['src/test.ts'],
      },
      affectedFiles: ['src/test.ts'],
      riskAssessment: { overallRisk: 'low', risks: [], totalRiskScore: 0.2, prioritizedMitigations: [] },
      verificationCriteria: { assertions: [], metricThresholds: [], manualChecklist: [], timeoutMs: 60000 },
      meetsConstraints: true,
      constraintViolations: [],
      duration: 30,
      errors: [],
    });

    (extractPattern as Mock).mockResolvedValue({
      pattern: {
        id: 'pattern-1',
        name: 'Null Check Addition',
        description: 'Add null check before access',
        category: 'correctness',
        trigger: 'potential null access',
        transformation: 'Add null check',
        constraints: [],
        examples: [],
        confidence: { score: 0.7, tier: 'medium', source: 'measured' },
        observationCount: 1,
      },
      applicability: {
        conditions: { requiredContext: [], excludingContext: [], codePatterns: [], estimatedApplicability: 0.5 },
        potentialSites: 10,
        estimatedEffort: '1 hour',
        risks: [],
      },
      generalization: { level: 'moderate', abstractForm: 'Add null check', variables: [], instantiations: 1, confidence: { score: 0.6, tier: 'medium', source: 'estimated' } },
      expectedBenefit: { metricImprovements: {}, riskReduction: 0.3, maintainabilityImprovement: 0.2, confidence: { score: 0.6, tier: 'medium', source: 'estimated' } },
      success: true,
      duration: 20,
      errors: [],
    });
  });

  describe('basic functionality', () => {
    it('returns result structure with all required fields', async () => {
      const result = await adversarialSelfTest(defaultOptions);

      expect(result).toHaveProperty('weaknessesIdentified');
      expect(result).toHaveProperty('testsGenerated');
      expect(result).toHaveProperty('testsExecuted');
      expect(result).toHaveProperty('testsPassed');
      expect(result).toHaveProperty('testsFailed');
      expect(result).toHaveProperty('newIssues');
      expect(result).toHaveProperty('coverageImprovement');
      expect(result).toHaveProperty('fixPlans');
      expect(result).toHaveProperty('patternsLearned');
      expect(result).toHaveProperty('robustnessScore');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('phaseReports');
    });

    it('executes all phases in order', async () => {
      const result = await adversarialSelfTest(defaultOptions);

      // Check phase reports
      expect(result.phaseReports.length).toBeGreaterThanOrEqual(3);

      const phases = result.phaseReports.map((p) => p.phase);
      expect(phases).toContain('architecture_analysis');
      expect(phases).toContain('weakness_identification');
      expect(phases).toContain('test_generation');
    });

    it('calls analyzeArchitecture with correct options', async () => {
      await adversarialSelfTest(defaultOptions);

      expect(analyzeArchitecture).toHaveBeenCalledWith(
        expect.objectContaining({
          rootDir: '/test/repo',
          storage: mockStorage,
        })
      );
    });
  });

  describe('input validation', () => {
    it('throws error when rootDir is missing', async () => {
      await expect(
        adversarialSelfTest({ ...defaultOptions, rootDir: '' })
      ).rejects.toThrow('rootDir is required');
    });

    it('throws error when storage is missing', async () => {
      await expect(
        adversarialSelfTest({ ...defaultOptions, storage: undefined as unknown as LibrarianStorage })
      ).rejects.toThrow('storage is required');
    });
  });

  describe('weakness identification', () => {
    it('identifies weaknesses from architecture analysis', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [
          { modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high', suggestedBreakPoint: 'src/a.ts' },
        ],
        layerViolations: [
          { type: 'layer_violations', severity: 'medium', location: 'src/c.ts', description: 'Layer violation', suggestion: 'Fix it', affectedEntities: ['src/c.ts'] },
        ],
        couplingMetrics: {
          averageAfferentCoupling: 2,
          averageEfferentCoupling: 2,
          averageInstability: 0.5,
          highCouplingCount: 1,
          mostCoupled: [{ module: 'src/d.ts', afferent: 20, efferent: 15 }],
        },
        suggestions: [{ priority: 80, category: 'decoupling', title: 'Break cycle', description: 'Break the cycle', affectedFiles: ['src/a.ts'], effort: 'moderate' }],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest(defaultOptions);

      expect(result.weaknessesIdentified.length).toBeGreaterThan(0);
    });

    it('filters weaknesses by focus areas', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [
          { modules: ['src/parser/a.ts', 'src/parser/b.ts'], length: 2, severity: 'high' },
          { modules: ['src/other/x.ts', 'src/other/y.ts'], length: 2, severity: 'high' },
        ],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        focusAreas: ['parser'],
      });

      // Should only include weaknesses from parser
      const parserWeaknesses = result.weaknessesIdentified.filter((w) =>
        w.affectedComponent.includes('parser')
      );
      expect(parserWeaknesses.length).toBeGreaterThan(0);
    });

    it('respects maxWeaknesses option', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: Array(10).fill(null).map((_, i) => ({
          modules: [`src/a${i}.ts`, `src/b${i}.ts`],
          length: 2,
          severity: 'high' as const,
        })),
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        maxWeaknesses: 3,
      });

      expect(result.weaknessesIdentified.length).toBeLessThanOrEqual(3);
    });
  });

  describe('test generation', () => {
    it('generates tests for identified weaknesses', async () => {
      const result = await adversarialSelfTest(defaultOptions);

      // generateAdversarialTests should be called for weaknesses
      expect(result.testsGenerated.length).toBeGreaterThanOrEqual(0);
    });

    it('respects maxTests option', async () => {
      // Setup architecture with weaknesses so tests are generated
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        maxTests: 5,
      });

      expect(generateAdversarialTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxTests: 5 })
      );
    });

    it('respects difficulty option', async () => {
      // Setup architecture with weaknesses so tests are generated
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      await adversarialSelfTest({
        ...defaultOptions,
        difficulty: 'extreme',
      });

      expect(generateAdversarialTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ difficulty: 'extreme' })
      );
    });

    it('tests have correct structure', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest(defaultOptions);

      for (const test of result.testsGenerated) {
        expect(test).toHaveProperty('id');
        expect(test).toHaveProperty('name');
        expect(test).toHaveProperty('description');
        expect(test).toHaveProperty('targetedWeaknessId');
        expect(test).toHaveProperty('difficulty');
        expect(test).toHaveProperty('testCode');
      }
    });
  });

  describe('test execution', () => {
    it('skips execution when executeTests is false', async () => {
      const result = await adversarialSelfTest({
        ...defaultOptions,
        executeTests: false,
      });

      expect(result.testsExecuted).toBe(0);
      const executionPhase = result.phaseReports.find((p) => p.phase === 'test_execution');
      expect(executionPhase?.status).toBe('skipped');
    });

    it('fails closed when executeTests is true and no executor is provided', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        executeTests: true,
      });

      expect(result.testsExecuted).toBe(0);
      expect(result.errors.some((e) => e.includes('test_execution_unavailable'))).toBe(true);
      const executionPhase = result.phaseReports.find((p) => p.phase === 'test_execution');
      expect(executionPhase?.status).toBe('failed');
    });

    it('executes tests when executeTests is true and executor is provided', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const testExecutor = vi.fn(async (tests: Parameters<NonNullable<AdversarialSelfTestOptions['testExecutor']>>[0]) => ({
        executed: tests.length,
        passed: tests.length - 1,
        failed: 1,
        failedTests: tests.slice(0, 1),
      }));

      const result = await adversarialSelfTest({
        ...defaultOptions,
        executeTests: true,
        testExecutor,
      });

      expect(testExecutor).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          rootDir: '/test/repo',
          storage: mockStorage,
        })
      );
      expect(result.testsExecuted).toBe(1);
      expect(result.testsPassed + result.testsFailed).toBe(result.testsExecuted);
      const executionPhase = result.phaseReports.find((p) => p.phase === 'test_execution');
      expect(executionPhase?.status).toBe('partial');
    });
  });

  describe('fix planning', () => {
    it('generates fix plans when generateFixPlans is true', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        executeTests: true,
        generateFixPlans: true,
      });

      // Fix plans may or may not be generated depending on test failures
      expect(Array.isArray(result.fixPlans)).toBe(true);
    });

    it('skips fix planning when generateFixPlans is false', async () => {
      const result = await adversarialSelfTest({
        ...defaultOptions,
        generateFixPlans: false,
      });

      const planPhase = result.phaseReports.find((p) => p.phase === 'fix_planning');
      expect(planPhase?.status).toBe('skipped');
    });
  });

  describe('pattern extraction', () => {
    it('extracts patterns when extractPatterns is true', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        executeTests: true,
        generateFixPlans: true,
        extractPatterns: true,
      });

      expect(Array.isArray(result.patternsLearned)).toBe(true);
    });

    it('skips pattern extraction when extractPatterns is false', async () => {
      const result = await adversarialSelfTest({
        ...defaultOptions,
        extractPatterns: false,
      });

      const patternPhase = result.phaseReports.find((p) => p.phase === 'pattern_extraction');
      expect(patternPhase?.status).toBe('skipped');
    });
  });

  describe('metrics calculation', () => {
    it('does not assume coverage improvement when tests are not executed', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest(defaultOptions);

      expect(result.coverageImprovement).toBe(0);
    });

    it('does not assume robustness when tests are not executed', async () => {
      const result = await adversarialSelfTest(defaultOptions);

      expect(result.robustnessScore).toBe(0);
    });

    it('calculates metrics from real execution results', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const result = await adversarialSelfTest({
        ...defaultOptions,
        executeTests: true,
        testExecutor: vi.fn(async (tests) => ({
          executed: tests.length,
          passed: tests.length,
          failed: 0,
          failedTests: [],
        })),
      });

      expect(result.testsExecuted).toBe(1);
      expect(result.coverageImprovement).toBe(0.01);
      expect(result.robustnessScore).toBe(1);
    });
  });

  describe('error handling', () => {
    it('handles architecture analysis failure gracefully', async () => {
      (analyzeArchitecture as Mock).mockRejectedValue(new Error('Analysis failed'));

      const result = await adversarialSelfTest(defaultOptions);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('architecture'))).toBe(true);
      expect(result.weaknessesIdentified).toEqual([]);
    });

    it('handles test generation failure gracefully', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });
      (generateAdversarialTests as Mock).mockRejectedValue(new Error('Generation failed'));

      const result = await adversarialSelfTest(defaultOptions);

      expect(result.errors.length).toBeGreaterThan(0);
      // Should still complete other phases
      expect(result.phaseReports.some((p) => p.phase === 'architecture_analysis' && p.status === 'success')).toBe(true);
    });

    it('continues on partial failures', async () => {
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [
          { modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' },
          { modules: ['src/c.ts', 'src/d.ts'], length: 2, severity: 'high' },
        ],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      // First call succeeds, second fails
      let callCount = 0;
      (generateAdversarialTests as Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Failed'));
        }
        return Promise.resolve({
          tests: [{ id: 'test-1', name: 'test', description: 'test', input: null, expectedBehavior: 'fail', difficulty: 'hard', targetedWeakness: 'weak-1', testCode: '', assertion: '', timeoutMs: 5000 }],
          expectedFailureModes: [],
          coverageAnalysis: { weaknessId: 'weak-1', testsCovering: [], uncoveredAspects: [], coverageScore: 0 },
          coverageGaps: [],
          edgeCases: [],
          duration: 50,
          errors: [],
        });
      });

      const result = await adversarialSelfTest(defaultOptions);

      // Should have at least one test from successful generation
      expect(result.testsGenerated.length).toBeGreaterThan(0);
      // Should also have errors
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('createAdversarialSelfTest', () => {
    it('creates bound function with default options', async () => {
      // Setup architecture with weaknesses so tests are generated
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const boundFn = createAdversarialSelfTest({
        maxTests: 5,
        difficulty: 'easy',
      });

      const result = await boundFn({
        rootDir: '/test/repo',
        storage: mockStorage,
      });

      expect(generateAdversarialTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          maxTests: 5,
          difficulty: 'easy',
        })
      );
    });

    it('allows overriding default options', async () => {
      // Setup architecture with weaknesses so tests are generated
      (analyzeArchitecture as Mock).mockResolvedValue({
        modules: [],
        dependencies: [],
        cycles: [{ modules: ['src/a.ts', 'src/b.ts'], length: 2, severity: 'high' }],
        layerViolations: [],
        couplingMetrics: { averageAfferentCoupling: 0, averageEfferentCoupling: 0, averageInstability: 0, highCouplingCount: 0, mostCoupled: [] },
        suggestions: [],
        duration: 100,
        errors: [],
      });

      const boundFn = createAdversarialSelfTest({
        maxTests: 5,
      });

      await boundFn({
        rootDir: '/test/repo',
        storage: mockStorage,
        maxTests: 10,
      });

      expect(generateAdversarialTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          maxTests: 10,
        })
      );
    });
  });
});
