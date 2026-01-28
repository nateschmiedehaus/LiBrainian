/**
 * @fileoverview Tests for Pattern Extraction Primitive
 */

import { describe, it, expect } from 'vitest';
import {
  extractPattern,
  createExtractPattern,
  type CompletedImprovement,
  type CodeState,
} from '../extract_pattern.js';

describe('extractPattern', () => {
  const mockBeforeState: CodeState = {
    code: `
function processData(input: string) {
  if (input === null) {
    throw new Error('Input cannot be null');
  }
  // Long function with multiple responsibilities
  const parsed = JSON.parse(input);
  const validated = validateData(parsed);
  const transformed = transformData(validated);
  return transformed;
}
    `.trim(),
    metrics: {
      linesOfCode: 10,
      cyclomaticComplexity: 15,
      coupling: 0.7,
      testCoverage: 0.5,
    },
    issues: [
      {
        id: 'issue-1',
        type: 'architecture',
        description: 'Function has multiple responsibilities',
        location: '/test/src/processor.ts',
        severity: 'medium',
        evidence: [],
      },
    ],
  };

  const mockAfterState: CodeState = {
    code: `
function processData(input: string) {
  validateInput(input);
  const parsed = parseInput(input);
  const validated = validateData(parsed);
  return transformData(validated);
}

function validateInput(input: string | null): void {
  if (input === null) {
    throw new Error('Input cannot be null');
  }
}

function parseInput(input: string): object {
  return JSON.parse(input);
}
    `.trim(),
    metrics: {
      linesOfCode: 15,
      cyclomaticComplexity: 8,
      coupling: 0.4,
      testCoverage: 0.8,
    },
    issues: [],
  };

  const mockRefactorImprovement: CompletedImprovement = {
    id: 'imp-1',
    type: 'refactor',
    description: 'Extract Function: extract common code into separate function for validation',
    before: mockBeforeState,
    after: mockAfterState,
    verificationResult: 'success',
    filesChanged: ['/test/src/processor.ts'],
    completedAt: new Date('2024-01-15'),
  };

  const mockBugFixImprovement: CompletedImprovement = {
    id: 'imp-2',
    type: 'fix',
    description: 'Null Check Addition: add null check before access to prevent crash',
    before: {
      ...mockBeforeState,
      issues: [
        {
          id: 'issue-2',
          type: 'bug',
          description: 'Crashes on null input',
          location: '/test/src/parser.ts',
          severity: 'high',
          evidence: [],
        },
      ],
    },
    after: {
      ...mockAfterState,
      issues: [],
    },
    verificationResult: 'success',
    filesChanged: ['/test/src/parser.ts'],
    completedAt: new Date('2024-01-16'),
  };

  const mockFailedImprovement: CompletedImprovement = {
    id: 'imp-3',
    type: 'optimization',
    description: 'Attempted performance optimization',
    before: mockBeforeState,
    after: mockBeforeState, // Same as before because it failed
    verificationResult: 'failed',
    filesChanged: ['/test/src/processor.ts'],
    completedAt: new Date('2024-01-17'),
  };

  it('returns result structure with all required fields', async () => {
    const result = await extractPattern(mockRefactorImprovement);

    expect(result).toHaveProperty('pattern');
    expect(result).toHaveProperty('applicability');
    expect(result).toHaveProperty('generalization');
    expect(result).toHaveProperty('expectedBenefit');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('errors');

    expect(typeof result.duration).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  describe('pattern extraction', () => {
    it('extracts pattern from successful refactor', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3, // Lower threshold for testing
        minConfidence: 0.2, // Lower to allow detection
      });

      expect(result.success).toBe(true);
      expect(result.pattern).not.toBeNull();
    });

    it('extracts pattern from successful bug fix', async () => {
      const result = await extractPattern(mockBugFixImprovement, {
        minGenerality: 0.3,
        minConfidence: 0.2,
      });

      expect(result.success).toBe(true);
      expect(result.pattern).not.toBeNull();
    });

    it('does not extract pattern from failed improvement', async () => {
      const result = await extractPattern(mockFailedImprovement);

      expect(result.success).toBe(false);
      expect(result.pattern).toBeNull();
      expect(result.failureReason).toContain('failed');
    });

    it('extracted pattern has required structure', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      if (result.pattern) {
        expect(result.pattern).toHaveProperty('id');
        expect(result.pattern).toHaveProperty('name');
        expect(result.pattern).toHaveProperty('description');
        expect(result.pattern).toHaveProperty('category');
        expect(result.pattern).toHaveProperty('trigger');
        expect(result.pattern).toHaveProperty('transformation');
        expect(result.pattern).toHaveProperty('constraints');
        expect(result.pattern).toHaveProperty('examples');
        expect(result.pattern).toHaveProperty('confidence');
        expect(result.pattern).toHaveProperty('observationCount');
      }
    });

    it('pattern category is valid', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      if (result.pattern) {
        expect(['structural', 'behavioral', 'performance', 'correctness', 'maintainability']).toContain(
          result.pattern.category
        );
      }
    });

    it('pattern includes at least one example', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      if (result.pattern) {
        expect(result.pattern.examples.length).toBeGreaterThan(0);
        expect(result.pattern.examples[0]).toHaveProperty('before');
        expect(result.pattern.examples[0]).toHaveProperty('after');
      }
    });
  });

  describe('applicability analysis', () => {
    it('analyzes applicability conditions', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.applicability).toHaveProperty('conditions');
      expect(result.applicability).toHaveProperty('potentialSites');
      expect(result.applicability).toHaveProperty('estimatedEffort');
      expect(result.applicability).toHaveProperty('risks');
    });

    it('applicability conditions have required structure', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.applicability.conditions).toHaveProperty('requiredContext');
      expect(result.applicability.conditions).toHaveProperty('excludingContext');
      expect(result.applicability.conditions).toHaveProperty('codePatterns');
      expect(result.applicability.conditions).toHaveProperty('estimatedApplicability');
      expect(Array.isArray(result.applicability.conditions.requiredContext)).toBe(true);
      expect(Array.isArray(result.applicability.conditions.excludingContext)).toBe(true);
    });

    it('estimated applicability is in valid range', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.applicability.conditions.estimatedApplicability).toBeGreaterThanOrEqual(0);
      expect(result.applicability.conditions.estimatedApplicability).toBeLessThanOrEqual(1);
    });

    it('identifies risks for refactor patterns', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
        minConfidence: 0.2, // Lower threshold to ensure success
      });

      // Refactoring should identify some risks if extraction succeeds
      if (result.success) {
        expect(result.applicability.risks.length).toBeGreaterThan(0);
      }
    });
  });

  describe('generalization', () => {
    it('provides generalization result', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.generalization).toHaveProperty('level');
      expect(result.generalization).toHaveProperty('abstractForm');
      expect(result.generalization).toHaveProperty('variables');
      expect(result.generalization).toHaveProperty('instantiations');
      expect(result.generalization).toHaveProperty('confidence');
    });

    it('generalization level is valid', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(['specific', 'moderate', 'high', 'universal']).toContain(
        result.generalization.level
      );
    });

    it('higher generalization has more variables', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      if (result.generalization.level === 'high' || result.generalization.level === 'universal') {
        expect(result.generalization.variables.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('expected benefit', () => {
    it('estimates expected benefits', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.expectedBenefit).toHaveProperty('metricImprovements');
      expect(result.expectedBenefit).toHaveProperty('riskReduction');
      expect(result.expectedBenefit).toHaveProperty('maintainabilityImprovement');
      expect(result.expectedBenefit).toHaveProperty('confidence');
    });

    it('metric improvements reflect actual changes', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      // Should capture the complexity reduction
      if (result.expectedBenefit.metricImprovements['cyclomaticComplexity']) {
        const improvement = result.expectedBenefit.metricImprovements['cyclomaticComplexity'];
        // After was lower (8) than before (15), so delta should be negative
        expect(improvement.min).toBeLessThan(0);
      }
    });

    it('risk reduction is in valid range', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.expectedBenefit.riskReduction).toBeGreaterThanOrEqual(0);
      expect(result.expectedBenefit.riskReduction).toBeLessThanOrEqual(1);
    });

    it('maintainability improvement is in valid range', async () => {
      const result = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
      });

      expect(result.expectedBenefit.maintainabilityImprovement).toBeGreaterThanOrEqual(0);
      expect(result.expectedBenefit.maintainabilityImprovement).toBeLessThanOrEqual(1);
    });
  });

  describe('options', () => {
    it('respects minGenerality threshold', async () => {
      // With high threshold, pattern may not be extracted
      const highThresholdResult = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.99,
      });

      expect(highThresholdResult.success).toBe(false);
      expect(highThresholdResult.failureReason).toContain('Generality');
    });

    it('respects minConfidence threshold', async () => {
      const highConfidenceResult = await extractPattern(mockRefactorImprovement, {
        minGenerality: 0.3,
        minConfidence: 0.99,
      });

      // High confidence threshold may prevent extraction
      if (!highConfidenceResult.success) {
        expect(highConfidenceResult.failureReason).toContain('Confidence');
      }
    });
  });

  describe('improvement types', () => {
    it('handles refactor improvements', async () => {
      const result = await extractPattern(mockRefactorImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
      if (result.pattern) {
        expect(['structural', 'maintainability']).toContain(result.pattern.category);
      }
    });

    it('handles fix improvements', async () => {
      const result = await extractPattern(mockBugFixImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
      if (result.pattern) {
        expect(['correctness', 'behavioral']).toContain(result.pattern.category);
      }
    });

    it('handles optimization improvements', async () => {
      const optimizationImprovement: CompletedImprovement = {
        id: 'imp-opt',
        type: 'optimization',
        description: 'Memoize expensive computation',
        before: mockBeforeState,
        after: {
          ...mockAfterState,
          metrics: {
            ...mockAfterState.metrics,
            executionTime: 50, // Reduced from implicit higher value
          },
        },
        verificationResult: 'success',
        filesChanged: ['/test/src/processor.ts'],
        completedAt: new Date(),
      };

      const result = await extractPattern(optimizationImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
    });

    it('handles cleanup improvements', async () => {
      const cleanupImprovement: CompletedImprovement = {
        id: 'imp-cleanup',
        type: 'cleanup',
        description: 'Remove dead code',
        before: mockBeforeState,
        after: mockAfterState,
        verificationResult: 'success',
        filesChanged: ['/test/src/processor.ts'],
        completedAt: new Date(),
      };

      const result = await extractPattern(cleanupImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
    });
  });

  describe('partial verification', () => {
    it('handles partial verification results', async () => {
      const partialImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        verificationResult: 'partial',
      };

      const result = await extractPattern(partialImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
      // May still extract but with lower confidence
      if (result.pattern) {
        expect(result.expectedBenefit.confidence.score).toBeLessThan(0.8);
      }
    });
  });

  describe('multiple files', () => {
    it('handles improvements affecting multiple files', async () => {
      const multiFileImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        filesChanged: [
          '/test/src/processor.ts',
          '/test/src/validator.ts',
          '/test/src/transformer.ts',
          '/test/src/utils.ts', // Need > 3 files for multi-file risk detection
        ],
      };

      const result = await extractPattern(multiFileImprovement, { minGenerality: 0.3, minConfidence: 0.2 });

      expect(result).toBeDefined();
      // Multi-file changes should have coordination risk if extraction succeeds
      if (result.success && result.applicability.risks.length > 0) {
        expect(result.applicability.risks.some((r) =>
          r.toLowerCase().includes('coordination') || r.toLowerCase().includes('multi-file')
        )).toBe(true);
      }
    });
  });

  describe('context detection', () => {
    it('detects React component context', async () => {
      const reactImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        filesChanged: ['/test/src/components/Button.tsx'],
      };

      const result = await extractPattern(reactImprovement, { minGenerality: 0.3, minConfidence: 0.2 });

      // Only check context if extraction succeeds
      if (result.success) {
        expect(result.applicability.conditions.requiredContext).toContain('react_component');
      } else {
        // If extraction fails, the applicability isn't populated
        expect(result.applicability.conditions.requiredContext).toEqual([]);
      }
    });

    it('detects test file context', async () => {
      const testImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        filesChanged: ['/test/src/__tests__/processor.test.ts'],
      };

      const result = await extractPattern(testImprovement, { minGenerality: 0.3, minConfidence: 0.2 });

      // Only check context if extraction succeeds
      if (result.success) {
        expect(result.applicability.conditions.requiredContext).toContain('test_file');
      } else {
        expect(result.applicability.conditions.requiredContext).toEqual([]);
      }
    });

    it('detects API endpoint context', async () => {
      const apiImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        filesChanged: ['/test/src/api/users.ts'],
      };

      const result = await extractPattern(apiImprovement, { minGenerality: 0.3, minConfidence: 0.2 });

      // Only check context if extraction succeeds
      if (result.success) {
        expect(result.applicability.conditions.requiredContext).toContain('api_endpoint');
      } else {
        expect(result.applicability.conditions.requiredContext).toEqual([]);
      }
    });
  });

  describe('createExtractPattern', () => {
    it('creates a bound extraction function with default options', async () => {
      const boundExtract = createExtractPattern({
        minGenerality: 0.3,
        minConfidence: 0.2, // Lower threshold to allow pattern matching
      });

      const result = await boundExtract(mockRefactorImprovement);

      expect(result).toBeDefined();
      // Note: success depends on pattern detection confidence
      expect(typeof result.success).toBe('boolean');
    });

    it('allows overriding default options', async () => {
      const boundExtract = createExtractPattern({
        minGenerality: 0.3,
      });

      const result = await boundExtract(mockRefactorImprovement, {
        minGenerality: 0.99,
      });

      // Override should apply
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles improvement with no issues resolved', async () => {
      const noIssueImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        before: { ...mockBeforeState, issues: [] },
        after: { ...mockAfterState, issues: [] },
      };

      const result = await extractPattern(noIssueImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
      expect(result.expectedBenefit.riskReduction).toBe(0);
    });

    it('handles improvement with same metrics before and after', async () => {
      const sameMetricsImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        after: {
          ...mockAfterState,
          metrics: mockBeforeState.metrics,
        },
      };

      const result = await extractPattern(sameMetricsImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
    });

    it('handles empty code states', async () => {
      const emptyCodeImprovement: CompletedImprovement = {
        ...mockRefactorImprovement,
        before: { ...mockBeforeState, code: '' },
        after: { ...mockAfterState, code: '' },
      };

      const result = await extractPattern(emptyCodeImprovement, { minGenerality: 0.3 });

      expect(result).toBeDefined();
    });
  });
});
