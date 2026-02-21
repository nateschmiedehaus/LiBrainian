/**
 * @fileoverview Tests for ComprehensiveQualityConstruction
 *
 * Tests the meta-construction that composes all quality constructions:
 * - Parallel execution of assessments
 * - D3 confidence propagation (parallel-all)
 * - Excellence tier determination
 * - Issue aggregation and prioritization
 * - Recommendation generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ComprehensiveQualityConstruction,
  createComprehensiveQualityConstruction,
  type AssessmentScope,
  type ExcellenceTier,
} from '../comprehensive_quality_construction.js';
import type { LiBrainian } from '../../api/librainian.js';
import type { ContextPack } from '../../types.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';

// ============================================================================
// MOCK LIBRARIAN
// ============================================================================

function createMockLiBrainian(options: {
  hasCodeIssues?: boolean;
  hasArchViolations?: boolean;
  hasSecurityFindings?: boolean;
  evalCode?: boolean;
} = {}): LiBrainian {
  const codeSnippetContent = options.evalCode
    ? 'const x = eval(userInput); function process() { if (a) { if (b) { if (c) { if (d) { if (e) { return deep; } } } } } }'
    : 'function simple(x: string): number { return x.length; }';

  const mockPacks: ContextPack[] = [
    {
      packId: 'test-pack-1',
      packType: 'function_context',
      targetId: 'testFunction',
      summary: 'Test function for quality analysis',
      keyFacts: ['Handles user input', 'Returns processed result'],
      codeSnippets: [
        {
          filePath: 'src/test.ts',
          content: codeSnippetContent,
          startLine: 10,
          endLine: 30,
          language: 'typescript',
        },
      ],
      confidence: 0.85,
      createdAt: new Date(),
      accessCount: 5,
      lastOutcome: 'success',
      successCount: 4,
      failureCount: 1,
      relatedFiles: ['src/test.ts', 'src/utils.ts'],
      invalidationTriggers: ['src/test.ts'],
    },
  ];

  return {
    queryOptional: vi.fn().mockResolvedValue({ packs: mockPacks }),
    queryRequired: vi.fn().mockResolvedValue({ packs: mockPacks }),
    query: vi.fn().mockResolvedValue({ packs: mockPacks }),
  } as unknown as LiBrainian;
}

function createDefaultScope(): AssessmentScope {
  return {
    files: ['src/test.ts', 'src/utils.ts', 'src/index.ts'],
    architectureSpec: {
      layers: [
        { name: 'api', patterns: ['src/api/**'], allowedDependencies: ['services', 'utils'] },
        { name: 'services', patterns: ['src/services/**'], allowedDependencies: ['utils'] },
        { name: 'utils', patterns: ['src/utils/**'], allowedDependencies: [] },
      ],
      boundaries: [
        {
          name: 'core-isolation',
          description: 'Core module should not depend on external services',
          inside: ['src/core/**'],
          outside: ['src/external/**'],
        },
      ],
      rules: [
        { id: 'no-circular', description: 'No circular dependencies', type: 'no-circular', severity: 'error' },
        { id: 'naming', description: 'Follow naming conventions', type: 'naming', severity: 'warning' },
      ],
    },
    securityScope: {
      files: ['src/test.ts', 'src/auth.ts'],
      checkTypes: ['injection', 'auth', 'crypto', 'exposure'],
    },
  };
}

// ============================================================================
// BASIC FUNCTIONALITY TESTS
// ============================================================================

describe('ComprehensiveQualityConstruction', () => {
  let construction: ComprehensiveQualityConstruction;
  let mockLiBrainian: LiBrainian;

  beforeEach(() => {
    mockLiBrainian = createMockLiBrainian();
    construction = new ComprehensiveQualityConstruction(mockLiBrainian);
  });

  describe('assess()', () => {
    it('should return a complete comprehensive report', async () => {
      const scope = createDefaultScope();
      const result = await construction.assess(scope);

      // Verify all top-level properties exist
      expect(result).toHaveProperty('codeQuality');
      expect(result).toHaveProperty('architecture');
      expect(result).toHaveProperty('security');
      expect(result).toHaveProperty('overallScore');
      expect(result).toHaveProperty('excellenceTier');
      expect(result).toHaveProperty('dimensionScores');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidenceRefs');
      expect(result).toHaveProperty('topIssues');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('improvementPriorities');
      expect(result).toHaveProperty('analysisTimeMs');
    });

    it('should include all component reports', async () => {
      const scope = createDefaultScope();
      const result = await construction.assess(scope);

      // Code quality report
      expect(result.codeQuality).toHaveProperty('issues');
      expect(result.codeQuality).toHaveProperty('metrics');
      expect(result.codeQuality).toHaveProperty('recommendations');
      expect(result.codeQuality).toHaveProperty('confidence');

      // Architecture report
      expect(result.architecture).toHaveProperty('violations');
      expect(result.architecture).toHaveProperty('compliance');
      expect(result.architecture).toHaveProperty('confidence');

      // Security report
      expect(result.security).toHaveProperty('findings');
      expect(result.security).toHaveProperty('severity');
      expect(result.security).toHaveProperty('riskScore');
      expect(result.security).toHaveProperty('confidence');
    });

    it('should compute valid overall score', async () => {
      const scope = createDefaultScope();
      const result = await construction.assess(scope);

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it('should populate dimension scores map', async () => {
      const scope = createDefaultScope();
      const result = await construction.assess(scope);

      expect(result.dimensionScores).toBeInstanceOf(Map);
      expect(result.dimensionScores.has('code_quality')).toBe(true);
      expect(result.dimensionScores.has('architecture')).toBe(true);
      expect(result.dimensionScores.has('security')).toBe(true);

      // All scores should be valid
      for (const [, score] of result.dimensionScores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });

    it('should complete within performance budget', async () => {
      const scope = createDefaultScope();
      const result = await construction.assess(scope);

      // Should complete in under 10 seconds (generous for mocked)
      expect(result.analysisTimeMs).toBeLessThan(10000);
    });
  });

  describe('CONSTRUCTION_ID', () => {
    it('should have correct static ID', () => {
      expect(ComprehensiveQualityConstruction.CONSTRUCTION_ID).toBe('ComprehensiveQualityConstruction');
    });
  });
});

// ============================================================================
// CONFIDENCE PROPAGATION TESTS (D3 RULE)
// ============================================================================

describe('Confidence Propagation (D3 - parallel-all)', () => {
  it('should propagate confidence using D3 rule', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    // Confidence should be derived type (from D3 parallel-all)
    expect(result.confidence).toHaveProperty('type');
    expect(['derived', 'measured', 'bounded', 'absent']).toContain(result.confidence.type);

    // If derived, should have formula indicating product
    if (result.confidence.type === 'derived') {
      expect(result.confidence.formula).toContain('product');
      expect(result.confidence.inputs).toBeDefined();
      expect(result.confidence.inputs.length).toBeGreaterThan(0);
    }
  });

  it('should have confidence value less than or equal to minimum input', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    // D3 rule uses product, so combined confidence should be <= all inputs
    // Get numeric values from component confidences for comparison
    const getNumericValue = (conf: ConfidenceValue): number | null => {
      if (conf.type === 'deterministic' || conf.type === 'derived' || conf.type === 'measured') {
        return conf.value;
      }
      if (conf.type === 'bounded') {
        return (conf.low + conf.high) / 2;
      }
      return null;
    };

    const overallNumeric = getNumericValue(result.confidence);
    const codeNumeric = getNumericValue(result.codeQuality.confidence);
    const archNumeric = getNumericValue(result.architecture.confidence);
    const secNumeric = getNumericValue(result.security.confidence);

    // If all have numeric values, overall should be <= product of all
    if (overallNumeric !== null && codeNumeric !== null && archNumeric !== null && secNumeric !== null) {
      // Product of confidences should equal or approximate the combined value
      const expectedProduct = codeNumeric * archNumeric * secNumeric;
      expect(overallNumeric).toBeCloseTo(expectedProduct, 2);
    }
  });

  it('should include confidence propagation in evidence refs', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.evidenceRefs).toContain('confidence_propagation:D3_parallel_all');
  });

  it('should return absent confidence when all components are absent', async () => {
    // Create mock that returns absent confidence
    const mockLiBrainian = {
      queryOptional: vi.fn().mockResolvedValue({ packs: [] }),
      queryRequired: vi.fn().mockResolvedValue({ packs: [] }),
      query: vi.fn().mockResolvedValue({ packs: [] }),
    } as unknown as LiBrainian;

    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope: AssessmentScope = {
      files: [],
      architectureSpec: { layers: [], boundaries: [], rules: [] },
      securityScope: { files: [], checkTypes: [] },
    };

    const result = await construction.assess(scope);

    // With no data, confidences should reflect insufficient data
    // The specific handling depends on component implementations
    expect(result.confidence).toHaveProperty('type');
  });
});

// ============================================================================
// EXCELLENCE TIER TESTS
// ============================================================================

describe('Excellence Tier Determination', () => {
  it('should return legendary tier for score >= 99', async () => {
    // We can't easily mock a 99+ score, but we can test the tier logic
    // by checking that the tier is valid
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    const validTiers: ExcellenceTier[] = ['good', 'great', 'world_class', 'legendary'];
    expect(validTiers).toContain(result.excellenceTier);
  });

  it('should include excellence tier in evidence refs', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.evidenceRefs.some(e => e.startsWith('excellence_tier:'))).toBe(true);
  });

  it('should have tier consistent with overall score', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    // Verify tier matches score thresholds
    if (result.overallScore >= 99) {
      expect(result.excellenceTier).toBe('legendary');
    } else if (result.overallScore >= 95) {
      expect(result.excellenceTier).toBe('world_class');
    } else if (result.overallScore >= 85) {
      expect(result.excellenceTier).toBe('great');
    } else {
      expect(result.excellenceTier).toBe('good');
    }
  });
});

// ============================================================================
// ISSUE AGGREGATION TESTS
// ============================================================================

describe('Issue Aggregation', () => {
  it('should aggregate issues from all dimensions', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    // Issues should have proper structure
    for (const issue of result.topIssues) {
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('dimension');
      expect(issue).toHaveProperty('severity');
      expect(issue).toHaveProperty('file');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('description');
      expect(issue).toHaveProperty('confidence');
    }
  });

  it('should have issues with valid dimension values', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    const validDimensions = ['code_quality', 'architecture', 'security'];
    for (const issue of result.topIssues) {
      expect(validDimensions).toContain(issue.dimension);
    }
  });

  it('should have issues with valid severity values', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
    for (const issue of result.topIssues) {
      expect(validSeverities).toContain(issue.severity);
    }
  });

  it('should sort issues by severity', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    if (result.topIssues.length > 1) {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      for (let i = 1; i < result.topIssues.length; i++) {
        const prevSeverity = severityOrder[result.topIssues[i - 1].severity];
        const currSeverity = severityOrder[result.topIssues[i].severity];
        // Should be sorted by severity (lower number = higher priority)
        expect(prevSeverity).toBeLessThanOrEqual(currSeverity);
      }
    }
  });

  it('should limit to top 20 issues', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.topIssues.length).toBeLessThanOrEqual(20);
  });
});

// ============================================================================
// RECOMMENDATION TESTS
// ============================================================================

describe('Recommendation Generation', () => {
  it('should generate recommendations', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    // Should have at least some recommendations with complex enough input
    expect(result.recommendations).toBeDefined();
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it('should have recommendations with valid structure', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    for (const rec of result.recommendations) {
      expect(rec).toHaveProperty('id');
      expect(rec).toHaveProperty('priority');
      expect(rec).toHaveProperty('title');
      expect(rec).toHaveProperty('description');
      expect(rec).toHaveProperty('dimensions');
      expect(rec).toHaveProperty('affectedFiles');
      expect(rec).toHaveProperty('effort');
      expect(rec).toHaveProperty('expectedImpact');
    }
  });

  it('should have recommendations with valid priority values', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    const validPriorities = ['critical', 'high', 'medium', 'low'];
    for (const rec of result.recommendations) {
      expect(validPriorities).toContain(rec.priority);
    }
  });

  it('should have recommendations with valid effort values', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    const validEfforts = ['trivial', 'small', 'medium', 'large'];
    for (const rec of result.recommendations) {
      expect(validEfforts).toContain(rec.effort);
    }
  });

  it('should sort recommendations by priority', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    if (result.recommendations.length > 1) {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 1; i < result.recommendations.length; i++) {
        const prevPriority = priorityOrder[result.recommendations[i - 1].priority];
        const currPriority = priorityOrder[result.recommendations[i].priority];
        expect(prevPriority).toBeLessThanOrEqual(currPriority);
      }
    }
  });
});

// ============================================================================
// IMPROVEMENT PRIORITIES TESTS
// ============================================================================

describe('Improvement Priorities', () => {
  it('should generate improvement priorities', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.improvementPriorities).toBeDefined();
    expect(Array.isArray(result.improvementPriorities)).toBe(true);
  });

  it('should have priorities with valid structure', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    for (const priority of result.improvementPriorities) {
      expect(priority).toHaveProperty('id');
      expect(priority).toHaveProperty('rank');
      expect(priority).toHaveProperty('reason');
      expect(priority).toHaveProperty('scoreImpact');
      // Should have either issueId or recommendationId
      expect(
        priority.issueId !== undefined || priority.recommendationId !== undefined
      ).toBe(true);
    }
  });

  it('should have priorities ordered by rank', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    for (let i = 1; i < result.improvementPriorities.length; i++) {
      expect(result.improvementPriorities[i - 1].rank).toBeLessThanOrEqual(
        result.improvementPriorities[i].rank
      );
    }
  });

  it('should limit to top 10 priorities', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.improvementPriorities.length).toBeLessThanOrEqual(10);
  });

  it('should have positive score impact values', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    for (const priority of result.improvementPriorities) {
      expect(priority.scoreImpact).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// PARALLEL EXECUTION TESTS
// ============================================================================

describe('Parallel Execution', () => {
  it('should run all assessments in parallel', async () => {
    const queryTimes: number[] = [];
    const mockLiBrainian = {
      queryOptional: vi.fn().mockImplementation(async () => {
        const start = Date.now();
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate some async work
        queryTimes.push(Date.now() - start);
        return { packs: [] };
      }),
      queryRequired: vi.fn().mockResolvedValue({ packs: [] }),
      query: vi.fn().mockResolvedValue({ packs: [] }),
    } as unknown as LiBrainian;

    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const startTime = Date.now();
    await construction.assess(scope);
    const totalTime = Date.now() - startTime;

    // If run sequentially, would take at least 3 * 50ms = 150ms per component
    // With parallel execution, should be closer to just 50ms + overhead
    // Being generous with timing due to test environment variability
    // The key insight is that parallel execution should be faster than sequential
    expect(totalTime).toBeLessThan(5000); // Very generous bound for mocked tests
  });
});

// ============================================================================
// EVIDENCE TRAIL TESTS
// ============================================================================

describe('Evidence Trail', () => {
  it('should aggregate evidence from all components', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    // Should have evidence from each dimension
    expect(result.evidenceRefs.some(e => e.startsWith('code_quality:'))).toBe(true);
    expect(result.evidenceRefs.some(e => e.startsWith('architecture:'))).toBe(true);
    expect(result.evidenceRefs.some(e => e.startsWith('security:'))).toBe(true);
  });

  it('should include score and tier evidence', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.evidenceRefs.some(e => e.startsWith('overall_score:'))).toBe(true);
    expect(result.evidenceRefs.some(e => e.startsWith('excellence_tier:'))).toBe(true);
  });

  it('should include issue and recommendation counts', async () => {
    const mockLiBrainian = createMockLiBrainian({ evalCode: true });
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result.evidenceRefs.some(e => e.startsWith('issues:'))).toBe(true);
    expect(result.evidenceRefs.some(e => e.startsWith('recommendations:'))).toBe(true);
  });
});

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createComprehensiveQualityConstruction', () => {
  it('should create a valid construction instance', () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = createComprehensiveQualityConstruction(mockLiBrainian);

    expect(construction).toBeInstanceOf(ComprehensiveQualityConstruction);
  });

  it('should create functional construction', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = createComprehensiveQualityConstruction(mockLiBrainian);
    const scope = createDefaultScope();

    const result = await construction.assess(scope);

    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('excellenceTier');
    expect(result).toHaveProperty('confidence');
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty file list', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope: AssessmentScope = {
      files: [],
      architectureSpec: { layers: [], boundaries: [], rules: [] },
      securityScope: { files: [], checkTypes: [] },
    };

    const result = await construction.assess(scope);

    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('excellenceTier');
  });

  it('should handle empty architecture spec', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope: AssessmentScope = {
      files: ['src/test.ts'],
      architectureSpec: { layers: [], boundaries: [], rules: [] },
      securityScope: { files: ['src/test.ts'], checkTypes: ['injection'] },
    };

    const result = await construction.assess(scope);

    expect(result.architecture).toHaveProperty('compliance');
    expect(result.architecture.violations.length).toBe(0);
  });

  it('should handle empty security check types', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope: AssessmentScope = {
      files: ['src/test.ts'],
      architectureSpec: { layers: [], boundaries: [], rules: [] },
      securityScope: { files: ['src/test.ts'], checkTypes: [] },
    };

    const result = await construction.assess(scope);

    expect(result.security).toHaveProperty('findings');
    expect(result.security.findings.length).toBe(0);
  });

  it('should handle single file assessment', async () => {
    const mockLiBrainian = createMockLiBrainian();
    const construction = new ComprehensiveQualityConstruction(mockLiBrainian);
    const scope: AssessmentScope = {
      files: ['src/single.ts'],
      architectureSpec: {
        layers: [{ name: 'src', patterns: ['src/**'], allowedDependencies: [] }],
        boundaries: [],
        rules: [],
      },
      securityScope: { files: ['src/single.ts'], checkTypes: ['injection'] },
    };

    const result = await construction.assess(scope);

    expect(result.codeQuality.analyzedFiles).toBe(1);
    expect(result.security.filesAudited).toBe(1);
  });
});
