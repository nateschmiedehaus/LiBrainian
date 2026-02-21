/**
 * @fileoverview Tests for Strategic Constructions
 *
 * Tests the composed constructions that wrap strategic modules for:
 * - Correct output structure
 * - Confidence propagation
 * - Evidence trail
 * - Calibration integration
 * - Performance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QualityAssessmentConstruction } from '../strategic/quality_assessment_construction.js';
import { ArchitectureValidationConstruction } from '../strategic/architecture_validation_construction.js';
import { WorkflowValidationConstruction } from '../strategic/workflow_validation_construction.js';
import { ConstructionCalibrationTracker } from '../calibration_tracker.js';
import type { LiBrainian } from '../../api/librainian.js';
import type { ContextPack } from '../../types.js';

// ============================================================================
// MOCK LIBRARIAN
// ============================================================================

function createMockLiBrainian(): LiBrainian {
  const mockPacks: ContextPack[] = [
    {
      packId: 'test-pack-1',
      packType: 'function_context',
      targetId: 'testFunction',
      summary: 'Test function that does something',
      keyFacts: ['Takes a string parameter', 'Returns a number'],
      codeSnippets: [
        {
          filePath: 'src/test.ts',
          content: `function testFunction(input: string): number {
            if (input.length > 10) {
              return input.length;
            }
            return 0;
          }`,
          startLine: 10,
          endLine: 16,
          language: 'typescript',
        },
      ],
      confidence: 0.85,
      createdAt: new Date(),
      accessCount: 5,
      lastOutcome: 'success',
      successCount: 4,
      failureCount: 1,
      relatedFiles: ['src/test.ts'],
      invalidationTriggers: ['src/test.ts'],
    },
  ];

  return {
    queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
    queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
    query: vi.fn().mockResolvedValue({ packs: mockPacks }),
  } as unknown as LiBrainian;
}

function createMockLiBrainianWithImports(): LiBrainian {
  const mockPacks: ContextPack[] = [
    {
      packId: 'test-pack-1',
      packType: 'module_context',
      targetId: 'testModule',
      summary: 'Test module with imports',
      keyFacts: ['Imports from domain layer', 'Exports functions'],
      codeSnippets: [
        {
          filePath: 'src/application/service.ts',
          content: `import { Entity } from '../domain/entity';
import { Repository } from '../infrastructure/repository';

export class Service {
  constructor(private repo: Repository) {}
}`,
          startLine: 1,
          endLine: 6,
          language: 'typescript',
        },
      ],
      confidence: 0.9,
      createdAt: new Date(),
      accessCount: 3,
      lastOutcome: 'success',
      successCount: 3,
      failureCount: 0,
      relatedFiles: ['src/application/service.ts'],
      invalidationTriggers: ['src/application/service.ts'],
    },
  ];

  return {
    queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
    queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
    query: vi.fn().mockResolvedValue({ packs: mockPacks }),
  } as unknown as LiBrainian;
}

// ============================================================================
// QUALITY ASSESSMENT CONSTRUCTION TESTS
// ============================================================================

describe('QualityAssessmentConstruction', () => {
  let construction: QualityAssessmentConstruction;
  let mockLiBrainian: LiBrainian;

  beforeEach(() => {
    mockLiBrainian = createMockLiBrainian();
    construction = new QualityAssessmentConstruction(mockLiBrainian);
  });

  describe('assess()', () => {
    it('should return a complete assessment result', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result).toHaveProperty('compliance');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('analysisTimeMs');
      expect(result).toHaveProperty('predictionId');
      expect(result).toHaveProperty('analyzedFiles');
      expect(result).toHaveProperty('standardId');
      expect(result).toHaveProperty('collectedMetrics');
    });

    it('should include compliance details', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result.compliance).toHaveProperty('passed');
      expect(result.compliance).toHaveProperty('score');
      expect(result.compliance).toHaveProperty('violations');
      expect(result.compliance).toHaveProperty('dimensionScores');
    });

    it('should have valid confidence value', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should track evidence references', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.evidenceRefs).toContain('librainian_query:quality_metrics');
    });

    it('should use default world-class standards', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result.standardId).toBe('world-class');
    });

    it('should complete within performance budget', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result.analysisTimeMs).toBeLessThan(5000);
    });

    it('should collect metrics from code analysis', async () => {
      const result = await construction.assess(['src/test.ts']);

      expect(result.collectedMetrics).toBeDefined();
      // Should have some metrics extracted from the mock code
      expect(
        result.collectedMetrics.cyclomaticComplexity !== undefined ||
          result.collectedMetrics.maxFileLines !== undefined
      ).toBe(true);
    });
  });

  describe('calibration integration', () => {
    it('should implement CalibratedConstruction interface', () => {
      expect(construction.getConstructionId()).toBe('QualityAssessmentConstruction');
      expect(typeof construction.setCalibrationTracker).toBe('function');
      expect(typeof construction.recordOutcome).toBe('function');
    });

    it('should record predictions when tracker is set', async () => {
      const tracker = new ConstructionCalibrationTracker();
      construction.setCalibrationTracker(tracker);

      const result = await construction.assess(['src/test.ts']);

      expect(result.predictionId).toBeDefined();
      const counts = tracker.getPredictionCounts();
      expect(counts.get('QualityAssessmentConstruction')?.total).toBe(1);
    });

    it('should allow recording outcomes', async () => {
      const tracker = new ConstructionCalibrationTracker();
      construction.setCalibrationTracker(tracker);

      const result = await construction.assess(['src/test.ts']);
      expect(result.predictionId).toBeDefined();

      // Should not throw
      construction.recordOutcome(result.predictionId!, true, 'test_result');

      const counts = tracker.getPredictionCounts();
      expect(counts.get('QualityAssessmentConstruction')?.withOutcome).toBe(1);
    });
  });
});

// ============================================================================
// ARCHITECTURE VALIDATION CONSTRUCTION TESTS
// ============================================================================

describe('ArchitectureValidationConstruction', () => {
  let construction: ArchitectureValidationConstruction;
  let mockLiBrainian: LiBrainian;

  beforeEach(() => {
    mockLiBrainian = createMockLiBrainianWithImports();
    construction = new ArchitectureValidationConstruction(mockLiBrainian);
  });

  describe('validate()', () => {
    it('should return a complete validation result', async () => {
      const result = await construction.validate(['src/application/service.ts']);

      expect(result).toHaveProperty('driftReport');
      expect(result).toHaveProperty('compliant');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('validationTimeMs');
      expect(result).toHaveProperty('predictionId');
      expect(result).toHaveProperty('analyzedFiles');
      expect(result).toHaveProperty('dependencyMap');
    });

    it('should include drift report details', async () => {
      const result = await construction.validate(['src/test.ts']);

      expect(result.driftReport).toHaveProperty('constraints');
      expect(result.driftReport).toHaveProperty('violations');
      expect(result.driftReport).toHaveProperty('technicalDebtEstimate');
      expect(result.driftReport).toHaveProperty('recommendations');
      expect(result.driftReport).toHaveProperty('summary');
    });

    it('should have valid confidence value', async () => {
      const result = await construction.validate(['src/test.ts']);

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should track evidence references', async () => {
      const result = await construction.validate(['src/test.ts']);

      expect(result.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.evidenceRefs).toContain('librainian_query:dependencies');
    });

    it('should apply clean architecture constraints when enabled', async () => {
      const result = await construction.validate(['src/application/service.ts'], {
        useCleanArchitecture: true,
      });

      // Should have checked clean architecture constraints
      expect(
        result.evidenceRefs.some((ref) => ref.startsWith('constraint:CA-'))
      ).toBe(true);
    });

    it('should apply naming convention constraints when enabled', async () => {
      const result = await construction.validate(['src/test.ts'], {
        useNamingConventions: true,
      });

      // Should have checked naming convention constraints
      expect(
        result.evidenceRefs.some((ref) => ref.startsWith('constraint:NC-'))
      ).toBe(true);
    });

    it('should extract dependencies from code', async () => {
      const result = await construction.validate(['src/application/service.ts']);

      expect(result.dependencyMap.size).toBeGreaterThan(0);
    });

    it('should complete within performance budget', async () => {
      const result = await construction.validate(['src/test.ts']);

      expect(result.validationTimeMs).toBeLessThan(5000);
    });
  });

  describe('calibration integration', () => {
    it('should implement CalibratedConstruction interface', () => {
      expect(construction.getConstructionId()).toBe('ArchitectureValidationConstruction');
      expect(typeof construction.setCalibrationTracker).toBe('function');
      expect(typeof construction.recordOutcome).toBe('function');
    });

    it('should record predictions when tracker is set', async () => {
      const tracker = new ConstructionCalibrationTracker();
      construction.setCalibrationTracker(tracker);

      const result = await construction.validate(['src/test.ts']);

      expect(result.predictionId).toBeDefined();
      const counts = tracker.getPredictionCounts();
      expect(counts.get('ArchitectureValidationConstruction')?.total).toBe(1);
    });

    it('should allow recording outcomes', async () => {
      const tracker = new ConstructionCalibrationTracker();
      construction.setCalibrationTracker(tracker);

      const result = await construction.validate(['src/test.ts']);
      expect(result.predictionId).toBeDefined();

      // Should not throw
      construction.recordOutcome(result.predictionId!, true, 'user_feedback');

      const counts = tracker.getPredictionCounts();
      expect(counts.get('ArchitectureValidationConstruction')?.withOutcome).toBe(1);
    });
  });
});

// ============================================================================
// WORKFLOW VALIDATION CONSTRUCTION TESTS
// ============================================================================

describe('WorkflowValidationConstruction', () => {
  let construction: WorkflowValidationConstruction;
  let mockLiBrainian: LiBrainian;

  beforeEach(() => {
    mockLiBrainian = createMockLiBrainian();
    construction = new WorkflowValidationConstruction(mockLiBrainian);
  });

  describe('validatePhase()', () => {
    it('should return a complete validation result', async () => {
      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
        testCoverage: 0.85,
      });

      expect(result).toHaveProperty('presetId');
      expect(result).toHaveProperty('phase');
      expect(result).toHaveProperty('gateCheck');
      expect(result).toHaveProperty('peerReviewTriggered');
      expect(result).toHaveProperty('peerReviewReasons');
      expect(result).toHaveProperty('minReviewers');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('validationTimeMs');
      expect(result).toHaveProperty('predictionId');
      expect(result).toHaveProperty('recommendations');
    });

    it('should include gate check details', async () => {
      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
        testCoverage: 0.85,
      });

      expect(result.gateCheck).toHaveProperty('passed');
      expect(result.gateCheck).toHaveProperty('passedRequirements');
      expect(result.gateCheck).toHaveProperty('failedRequirements');
      expect(result.gateCheck).toHaveProperty('blocking');
    });

    it('should have valid confidence value', async () => {
      const result = await construction.validatePhase({
        phase: 'implementation',
        files: ['src/test.ts'],
      });

      expect(result.confidence).toHaveProperty('type');
      expect(['deterministic', 'measured', 'derived', 'bounded', 'absent']).toContain(
        result.confidence.type
      );
    });

    it('should track evidence references', async () => {
      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
      });

      expect(result.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.evidenceRefs).toContain('librainian_query:workflow_context');
    });

    it('should use standard preset by default', async () => {
      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
      });

      expect(result.presetId).toBe('standard');
    });

    it('should trigger peer review for security-sensitive changes', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'review',
          files: ['src/auth.ts'],
          isSecuritySensitive: true,
        },
        'standard'
      );

      expect(result.peerReviewTriggered).toBe(true);
      expect(result.peerReviewReasons.length).toBeGreaterThan(0);
    });

    it('should trigger peer review for breaking changes', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'review',
          files: ['src/api.ts'],
          isBreakingChange: true,
        },
        'standard'
      );

      expect(result.peerReviewTriggered).toBe(true);
    });

    it('should trigger peer review for large changes', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'review',
          files: ['src/big-refactor.ts'],
          linesChanged: 500,
        },
        'standard'
      );

      expect(result.peerReviewTriggered).toBe(true);
    });

    it('should fail gate with insufficient test coverage', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'testing',
          files: ['src/test.ts'],
          testCoverage: 0.5, // Below standard threshold of 70%
        },
        'standard'
      );

      expect(result.gateCheck.failedRequirements.length).toBeGreaterThan(0);
      expect(
        result.gateCheck.failedRequirements.some((r) => r.type === 'test_coverage')
      ).toBe(true);
    });

    it('should pass gate with sufficient test coverage', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'testing',
          files: ['src/test.ts'],
          testCoverage: 0.9, // Above standard threshold of 70%
        },
        'standard'
      );

      expect(
        result.gateCheck.passedRequirements.some((r) => r.type === 'test_coverage')
      ).toBe(true);
    });

    it('should generate recommendations', async () => {
      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
        testCoverage: 0.5,
      });

      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should complete within performance budget', async () => {
      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
      });

      expect(result.validationTimeMs).toBeLessThan(5000);
    });
  });

  describe('preset selection', () => {
    it('should use strict preset when specified', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'testing',
          files: ['src/test.ts'],
          testCoverage: 0.85,
        },
        'strict'
      );

      expect(result.presetId).toBe('strict');
      // Strict preset has 90% coverage requirement, so 85% should fail
      expect(
        result.gateCheck.failedRequirements.some((r) => r.type === 'test_coverage')
      ).toBe(true);
    });

    it('should use exploratory preset when specified', async () => {
      const result = await construction.validatePhase(
        {
          phase: 'testing',
          files: ['src/test.ts'],
          testCoverage: 0.35, // Above exploratory threshold of 30%
        },
        'exploratory'
      );

      expect(result.presetId).toBe('exploratory');
      // Exploratory preset is more lenient
      expect(
        result.gateCheck.passedRequirements.some((r) => r.type === 'test_coverage')
      ).toBe(true);
    });
  });

  describe('calibration integration', () => {
    it('should implement CalibratedConstruction interface', () => {
      expect(construction.getConstructionId()).toBe('WorkflowValidationConstruction');
      expect(typeof construction.setCalibrationTracker).toBe('function');
      expect(typeof construction.recordOutcome).toBe('function');
    });

    it('should record predictions when tracker is set', async () => {
      const tracker = new ConstructionCalibrationTracker();
      construction.setCalibrationTracker(tracker);

      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
      });

      expect(result.predictionId).toBeDefined();
      const counts = tracker.getPredictionCounts();
      expect(counts.get('WorkflowValidationConstruction')?.total).toBe(1);
    });

    it('should allow recording outcomes', async () => {
      const tracker = new ConstructionCalibrationTracker();
      construction.setCalibrationTracker(tracker);

      const result = await construction.validatePhase({
        phase: 'testing',
        files: ['src/test.ts'],
      });
      expect(result.predictionId).toBeDefined();

      // Should not throw
      construction.recordOutcome(result.predictionId!, true, 'system_observation');

      const counts = tracker.getPredictionCounts();
      expect(counts.get('WorkflowValidationConstruction')?.withOutcome).toBe(1);
    });
  });
});

// ============================================================================
// CONFIDENCE PROPAGATION TESTS
// ============================================================================

describe('Strategic Constructions Confidence Propagation', () => {
  it('should propagate confidence through QualityAssessmentConstruction', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new QualityAssessmentConstruction(mockLiBrainian);

    const result = await construction.assess(['src/test.ts']);

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.value).toBeLessThanOrEqual(1);
      expect(confidence.measurement).toHaveProperty('datasetId');
      expect(confidence.measurement.datasetId).toBe('quality_assessment');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });

  it('should propagate confidence through ArchitectureValidationConstruction', async () => {
    const mockLiBrainian = createMockLiBrainianWithImports();
    const construction = new ArchitectureValidationConstruction(mockLiBrainian);

    const result = await construction.validate(['src/application/service.ts']);

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.value).toBeLessThanOrEqual(1);
      expect(confidence.measurement).toHaveProperty('datasetId');
      expect(confidence.measurement.datasetId).toBe('architecture_validation');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });

  it('should propagate confidence through WorkflowValidationConstruction', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new WorkflowValidationConstruction(mockLiBrainian);

    const result = await construction.validatePhase({
      phase: 'testing',
      files: ['src/test.ts'],
      testCoverage: 0.85,
    });

    const confidence = result.confidence;
    if (confidence.type === 'measured') {
      expect(confidence.value).toBeGreaterThan(0);
      expect(confidence.value).toBeLessThanOrEqual(1);
      expect(confidence.measurement).toHaveProperty('datasetId');
      expect(confidence.measurement.datasetId).toBe('workflow_validation');
    } else if (confidence.type === 'bounded') {
      expect(confidence.low).toBeLessThanOrEqual(confidence.high);
    }
  });
});

// ============================================================================
// INTEGRATION WITH CALIBRATION TRACKER
// ============================================================================

describe('Strategic Constructions Calibration Integration', () => {
  it('should work with shared calibration tracker', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const tracker = new ConstructionCalibrationTracker();

    const qualityConstruction = new QualityAssessmentConstruction(mockLiBrainian);
    const workflowConstruction = new WorkflowValidationConstruction(mockLiBrainian);

    qualityConstruction.setCalibrationTracker(tracker);
    workflowConstruction.setCalibrationTracker(tracker);

    // Run both constructions
    await qualityConstruction.assess(['src/test.ts']);
    await workflowConstruction.validatePhase({
      phase: 'testing',
      files: ['src/test.ts'],
    });

    // Both should be tracked
    const counts = tracker.getPredictionCounts();
    expect(counts.get('QualityAssessmentConstruction')?.total).toBe(1);
    expect(counts.get('WorkflowValidationConstruction')?.total).toBe(1);

    // Should be able to get construction IDs
    const ids = tracker.getConstructionIds();
    expect(ids).toContain('QualityAssessmentConstruction');
    expect(ids).toContain('WorkflowValidationConstruction');
  });
});
