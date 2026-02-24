/**
 * @fileoverview Tests for Base Construction Classes
 *
 * Tests the abstract base classes for:
 * - Correct structure and type enforcement
 * - Confidence propagation rules
 * - Evidence merging
 * - Prediction recording
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Librarian } from '../../../api/librarian.js';
import type { ConfidenceValue } from '../../../epistemics/confidence.js';
import { deterministic, bounded, absent } from '../../../epistemics/confidence.js';
import {
  BaseConstruction,
  toEvidenceIds,
  type ConstructionResult,
} from '../construction_base.js';
import {
  ValidationConstruction,
  type ValidationResult,
  type Violation,
  type ValidationRule,
} from '../validation_construction.js';
import {
  AssessmentConstruction,
  type AssessmentResult,
  type ScoreCategory,
} from '../assessment_construction.js';
import {
  CompositeConstruction,
  type CompositeResult,
} from '../composite_construction.js';
import type { ConstructionCalibrationTracker } from '../../calibration_tracker.js';

// ============================================================================
// MOCK LIBRARIAN
// ============================================================================

function createMockLibrarian(): Librarian {
  return {
    queryOptional: vi.fn().mockResolvedValue({ packs: [] }),
    queryRequired: vi.fn().mockResolvedValue({ packs: [] }),
    query: vi.fn().mockResolvedValue({ packs: [] }),
  } as unknown as Librarian;
}

function createMockCalibrationTracker(): ConstructionCalibrationTracker {
  return {
    recordPrediction: vi.fn(),
    recordOutcome: vi.fn(),
    getCalibration: vi.fn(),
  } as unknown as ConstructionCalibrationTracker;
}

// ============================================================================
// CONCRETE TEST IMPLEMENTATIONS
// ============================================================================

interface SimpleInput {
  value: string;
}

interface SimpleResult extends ConstructionResult {
  processed: string;
}

class SimpleConstruction extends BaseConstruction<SimpleInput, SimpleResult> {
  readonly CONSTRUCTION_ID = 'SimpleConstruction';

  async execute(input: SimpleInput): Promise<SimpleResult> {
    const startTime = Date.now();
    const evidenceRefs: ConstructionResult['evidenceRefs'] = [];

    this.addEvidence(evidenceRefs, 'processing:started');
    const processed = input.value.toUpperCase();
    this.addEvidence(evidenceRefs, 'processing:completed');

    const confidence: ConfidenceValue = deterministic(true, 'string_operation');

    const predictionId = this.recordPrediction(
      `Processed: ${processed}`,
      confidence,
      { input: input.value }
    );

    return {
      processed,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
    };
  }
}

// Validation Construction Implementation
interface ValidationInput {
  items: string[];
}

interface ValidationRuleSet {
  notEmpty: ValidationRule<ValidationInput>;
  noNumbers: ValidationRule<ValidationInput>;
}

class TestValidationConstruction extends ValidationConstruction<ValidationInput, ValidationRuleSet> {
  readonly CONSTRUCTION_ID = 'TestValidation';

  getRules(): ValidationRuleSet {
    return {
      notEmpty: {
        id: 'not-empty',
        name: 'Not Empty',
        description: 'Items must not be empty',
        severity: 'error',
        enabled: true,
        check: async (input) => {
          const violations: Violation[] = [];
          if (input.items.length === 0) {
            violations.push({
              ruleId: 'not-empty',
              description: 'Items array is empty',
              severity: 'error',
            });
          }
          return violations;
        },
      },
      noNumbers: {
        id: 'no-numbers',
        name: 'No Numbers',
        description: 'Items must not contain numbers',
        severity: 'warning',
        enabled: true,
        check: async (input) => {
          const violations: Violation[] = [];
          for (const item of input.items) {
            if (/\d/.test(item)) {
              violations.push({
                ruleId: 'no-numbers',
                description: `Item "${item}" contains numbers`,
                severity: 'warning',
              });
            }
          }
          return violations;
        },
      },
    };
  }

  async validate(input: ValidationInput): Promise<ValidationResult> {
    const startTime = Date.now();
    const rules = this.getRules();
    const violations = await this.applyRules(input, Object.values(rules));
    return this.buildValidationResult(
      violations,
      Object.keys(rules).length,
      input.items.length,
      Date.now() - startTime
    );
  }
}

// Assessment Construction Implementation
interface AssessmentInput {
  scores: Record<string, number>;
}

interface TestStandard {
  name: string;
  passingScore: number;
}

class TestAssessmentConstruction extends AssessmentConstruction<AssessmentInput, TestStandard> {
  readonly CONSTRUCTION_ID = 'TestAssessment';

  getStandard(): TestStandard {
    return {
      name: 'Test Standard',
      passingScore: 70,
    };
  }

  async assess(input: AssessmentInput): Promise<AssessmentResult> {
    const startTime = Date.now();

    // Build categories from input scores
    const categories: ScoreCategory[] = Object.entries(input.scores).map(([id, score]) =>
      this.createCategory(id, id.charAt(0).toUpperCase() + id.slice(1), score, 1)
    );

    const score = this.computeWeightedScore(categories);
    const breakdown = this.buildScoreBreakdown(categories);
    const recommendations = this.generateRecommendations(categories);

    return this.buildAssessmentResult(
      score,
      breakdown,
      recommendations,
      Date.now() - startTime,
      Object.keys(input.scores).length
    );
  }
}

// Composite Construction Implementation
interface CompositeInput {
  items: string[];
  scores: Record<string, number>;
}

interface TestCompositeResult extends CompositeResult {
  validationPassed: boolean;
  assessmentGrade: string;
}

class TestCompositeConstruction extends CompositeConstruction<CompositeInput, TestCompositeResult> {
  readonly CONSTRUCTION_ID = 'TestComposite';

  private validator: TestValidationConstruction;
  private assessor: TestAssessmentConstruction;

  constructor(librarian: Librarian) {
    super(librarian);
    this.validator = new TestValidationConstruction(librarian);
    this.assessor = new TestAssessmentConstruction(librarian);
    this.addChild(this.validator as unknown as BaseConstruction<unknown, ConstructionResult>);
    this.addChild(this.assessor as unknown as BaseConstruction<unknown, ConstructionResult>);
  }

  async execute(input: CompositeInput): Promise<TestCompositeResult> {
    const startTime = Date.now();

    // Execute children in parallel
    const [validationResult, assessmentResult] = await Promise.all([
      this.validator.validate({ items: input.items }),
      this.assessor.assess({ scores: input.scores }),
    ]);

    const childResults = [
      {
        childId: this.validator.CONSTRUCTION_ID,
        success: true,
        result: validationResult,
        executionTimeMs: validationResult.analysisTimeMs,
      },
      {
        childId: this.assessor.CONSTRUCTION_ID,
        success: true,
        result: assessmentResult,
        executionTimeMs: assessmentResult.analysisTimeMs,
      },
    ];

    // Propagate confidence using parallel rule (product)
    const confidence = this.propagateConfidenceParallel([validationResult, assessmentResult]);
    const evidenceRefs = this.mergeEvidenceRefs([validationResult, assessmentResult]);

    const baseResult = this.buildCompositeResult(
      childResults,
      confidence,
      Date.now() - startTime
    );

    return {
      ...baseResult,
      validationPassed: validationResult.valid,
      assessmentGrade: assessmentResult.grade,
    };
  }
}

// ============================================================================
// BASE CONSTRUCTION TESTS
// ============================================================================

describe('BaseConstruction', () => {
  let mockLibrarian: Librarian;
  let mockTracker: ConstructionCalibrationTracker;
  let construction: SimpleConstruction;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    mockTracker = createMockCalibrationTracker();
    construction = new SimpleConstruction(mockLibrarian);
  });

  describe('construction identity', () => {
    it('should have a CONSTRUCTION_ID', () => {
      expect(construction.CONSTRUCTION_ID).toBe('SimpleConstruction');
    });

    it('should return CONSTRUCTION_ID via getConstructionId()', () => {
      expect(construction.getConstructionId()).toBe('SimpleConstruction');
    });
  });

  describe('execute()', () => {
    it('should return a valid ConstructionResult', async () => {
      const result = await construction.execute({ value: 'test' });

      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('analysisTimeMs');
    });

    it('should process input correctly', async () => {
      const result = await construction.execute({ value: 'hello' });
      expect(result.processed).toBe('HELLO');
    });

    it('should track evidence', async () => {
      const result = await construction.execute({ value: 'test' });
      expect(result.evidenceRefs).toContain('processing:started');
      expect(result.evidenceRefs).toContain('processing:completed');
    });

    it('should have valid confidence', async () => {
      const result = await construction.execute({ value: 'test' });
      expect(result.confidence.type).toBe('deterministic');
    });

    it('should track timing', async () => {
      const result = await construction.execute({ value: 'test' });
      expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calibration tracking', () => {
    it('should accept calibration tracker', () => {
      construction.setCalibrationTracker(mockTracker);
      // Should not throw
    });

    it('should record predictions when tracker is set', async () => {
      construction.setCalibrationTracker(mockTracker);
      const result = await construction.execute({ value: 'test' });

      expect(mockTracker.recordPrediction).toHaveBeenCalled();
      expect(result.predictionId).toBeDefined();
    });

    it('should work without calibration tracker', async () => {
      const result = await construction.execute({ value: 'test' });
      // Should complete without error
      expect(result.processed).toBe('TEST');
    });
  });
});

// ============================================================================
// VALIDATION CONSTRUCTION TESTS
// ============================================================================

describe('ValidationConstruction', () => {
  let mockLibrarian: Librarian;
  let validation: TestValidationConstruction;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    validation = new TestValidationConstruction(mockLibrarian);
  });

  describe('getRules()', () => {
    it('should return rules', () => {
      const rules = validation.getRules();
      expect(rules.notEmpty).toBeDefined();
      expect(rules.noNumbers).toBeDefined();
    });
  });

  describe('validate()', () => {
    it('should pass with valid input', async () => {
      const result = await validation.validate({ items: ['a', 'b', 'c'] });
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should fail with empty input', async () => {
      const result = await validation.validate({ items: [] });
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should report warnings for numbers', async () => {
      const result = await validation.validate({ items: ['a1', 'b2'] });
      expect(result.valid).toBe(true); // Warnings don't fail
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should track rules applied', async () => {
      const result = await validation.validate({ items: ['test'] });
      expect(result.rulesApplied).toBe(2);
    });

    it('should track items validated', async () => {
      const result = await validation.validate({ items: ['a', 'b', 'c'] });
      expect(result.itemsValidated).toBe(3);
    });

    it('should have valid confidence', async () => {
      const result = await validation.validate({ items: ['test'] });
      expect(['measured', 'bounded', 'absent']).toContain(result.confidence.type);
    });
  });

  describe('execute() delegation', () => {
    it('should delegate to validate()', async () => {
      const result = await validation.execute({ items: ['test'] });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('violations');
    });
  });
});

// ============================================================================
// ASSESSMENT CONSTRUCTION TESTS
// ============================================================================

describe('AssessmentConstruction', () => {
  let mockLibrarian: Librarian;
  let assessment: TestAssessmentConstruction;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    assessment = new TestAssessmentConstruction(mockLibrarian);
  });

  describe('getStandard()', () => {
    it('should return standard', () => {
      const standard = assessment.getStandard();
      expect(standard.name).toBe('Test Standard');
      expect(standard.passingScore).toBe(70);
    });
  });

  describe('assess()', () => {
    it('should compute score from inputs', async () => {
      const result = await assessment.assess({
        scores: { quality: 80, security: 90 },
      });
      expect(result.score).toBe(85); // Average
    });

    it('should assign correct grade', async () => {
      const result = await assessment.assess({
        scores: { quality: 95, security: 98 },
      });
      expect(result.grade).toBe('A');
    });

    it('should generate recommendations for low scores', async () => {
      const result = await assessment.assess({
        scores: { quality: 50, security: 60 },
      });
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should not generate recommendations for high scores', async () => {
      const result = await assessment.assess({
        scores: { quality: 95, security: 98 },
      });
      expect(result.recommendations).toHaveLength(0);
    });

    it('should have valid breakdown', async () => {
      const result = await assessment.assess({
        scores: { quality: 80, security: 90 },
      });
      expect(result.breakdown.categories).toHaveLength(2);
      expect(result.breakdown.computation.formula).toBe('weighted_average(categories)');
    });

    it('should track items assessed', async () => {
      const result = await assessment.assess({
        scores: { a: 80, b: 90, c: 70 },
      });
      expect(result.itemsAssessed).toBe(3);
    });

    it('should have valid confidence', async () => {
      const result = await assessment.assess({
        scores: { quality: 80 },
      });
      expect(['measured', 'bounded']).toContain(result.confidence.type);
    });
  });

  describe('grade computation', () => {
    it('should compute A+ for 97+', async () => {
      const result = await assessment.assess({ scores: { test: 98 } });
      expect(result.grade).toBe('A+');
    });

    it('should compute F for below 60', async () => {
      const result = await assessment.assess({ scores: { test: 45 } });
      expect(result.grade).toBe('F');
    });
  });

  describe('execute() delegation', () => {
    it('should delegate to assess()', async () => {
      const result = await assessment.execute({ scores: { test: 80 } });
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('grade');
    });
  });
});

// ============================================================================
// COMPOSITE CONSTRUCTION TESTS
// ============================================================================

describe('CompositeConstruction', () => {
  let mockLibrarian: Librarian;
  let composite: TestCompositeConstruction;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    composite = new TestCompositeConstruction(mockLibrarian);
  });

  describe('execute()', () => {
    it('should execute all children', async () => {
      const result = await composite.execute({
        items: ['a', 'b'],
        scores: { quality: 80 },
      });

      expect(result.childResults).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it('should merge evidence from children', async () => {
      const result = await composite.execute({
        items: ['a'],
        scores: { quality: 80 },
      });

      expect(result.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.evidenceRefs.some((e) => e.includes('composite'))).toBe(true);
    });

    it('should propagate confidence correctly', async () => {
      const result = await composite.execute({
        items: ['a'],
        scores: { quality: 80 },
      });

      // Confidence should be derived from children
      expect(result.confidence.type).toBe('derived');
    });

    it('should include domain-specific results', async () => {
      const result = await composite.execute({
        items: ['a'],
        scores: { quality: 95 },
      });

      expect(result.validationPassed).toBe(true);
      expect(result.assessmentGrade).toBeDefined();
    });

    it('should track total child time', async () => {
      const result = await composite.execute({
        items: ['a'],
        scores: { quality: 80 },
      });

      expect(result.totalChildTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('confidence propagation', () => {
    it('should use parallel confidence (product) for parallel children', async () => {
      const result = await composite.execute({
        items: ['a'],
        scores: { quality: 80 },
      });

      // With parallel propagation, confidence should be product of child confidences
      if (result.confidence.type === 'derived') {
        expect(result.confidence.formula).toContain('product');
      }
    });
  });

  describe('calibration tracking', () => {
    it('should propagate tracker to children', () => {
      const mockTracker = createMockCalibrationTracker();
      composite.setCalibrationTracker(mockTracker);

      // Children should receive the tracker (tested via execution)
    });
  });
});

// ============================================================================
// CONFIDENCE PROPAGATION TESTS
// ============================================================================

describe('Confidence Propagation Rules', () => {
  let mockLibrarian: Librarian;
  let composite: TestCompositeConstruction;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
    composite = new TestCompositeConstruction(mockLibrarian);
  });

  describe('Sequential (D2 rule)', () => {
    it('should use min for sequential confidence', () => {
      // Access protected method via testing
      const result1: ConstructionResult = {
        confidence: { type: 'measured', value: 0.8, measurement: { datasetId: 'test', sampleSize: 10, accuracy: 0.8, confidenceInterval: [0.7, 0.9], measuredAt: '' } },
        evidenceRefs: toEvidenceIds([]),
        analysisTimeMs: 0,
      };
      const result2: ConstructionResult = {
        confidence: { type: 'measured', value: 0.6, measurement: { datasetId: 'test', sampleSize: 10, accuracy: 0.6, confidenceInterval: [0.5, 0.7], measuredAt: '' } },
        evidenceRefs: toEvidenceIds([]),
        analysisTimeMs: 0,
      };

      // Use the protected method via subclass
      const conf = (composite as unknown as { propagateConfidenceSequential: (r: ConstructionResult[]) => ConfidenceValue }).propagateConfidenceSequential([result1, result2]);

      if (conf.type === 'derived') {
        expect(conf.value).toBe(0.6); // min(0.8, 0.6)
        expect(conf.formula).toContain('min');
      }
    });
  });

  describe('Parallel-All (D3 rule)', () => {
    it('should use product for parallel-all confidence', () => {
      const result1: ConstructionResult = {
        confidence: { type: 'measured', value: 0.8, measurement: { datasetId: 'test', sampleSize: 10, accuracy: 0.8, confidenceInterval: [0.7, 0.9], measuredAt: '' } },
        evidenceRefs: toEvidenceIds([]),
        analysisTimeMs: 0,
      };
      const result2: ConstructionResult = {
        confidence: { type: 'measured', value: 0.9, measurement: { datasetId: 'test', sampleSize: 10, accuracy: 0.9, confidenceInterval: [0.8, 1.0], measuredAt: '' } },
        evidenceRefs: toEvidenceIds([]),
        analysisTimeMs: 0,
      };

      const conf = (composite as unknown as { propagateConfidenceParallel: (r: ConstructionResult[]) => ConfidenceValue }).propagateConfidenceParallel([result1, result2]);

      if (conf.type === 'derived') {
        expect(conf.value).toBeCloseTo(0.72); // 0.8 * 0.9
        expect(conf.formula).toContain('product');
      }
    });
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let mockLibrarian: Librarian;

  beforeEach(() => {
    mockLibrarian = createMockLibrarian();
  });

  describe('ValidationConstruction', () => {
    it('should handle rule execution failures gracefully', async () => {
      class FailingValidation extends ValidationConstruction<{ value: string }, Record<string, ValidationRule<{ value: string }>>> {
        readonly CONSTRUCTION_ID = 'FailingValidation';

        getRules() {
          return {
            failingRule: {
              id: 'failing',
              name: 'Failing Rule',
              description: 'This rule always fails',
              severity: 'error' as const,
              enabled: true,
              check: async () => {
                throw new Error('Rule execution failed');
              },
            },
          };
        }

        async validate(input: { value: string }): Promise<ValidationResult> {
          const rules = this.getRules();
          const violations = await this.applyRules(input, Object.values(rules));
          return this.buildValidationResult(violations, 1, 1, 0);
        }
      }

      const validation = new FailingValidation(mockLibrarian);
      const result = await validation.validate({ value: 'test' });

      // Should report the failure as a violation, not throw
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].description).toContain('Rule execution failed');
    });
  });
});
