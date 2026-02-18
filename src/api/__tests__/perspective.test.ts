/**
 * @fileoverview Tests for perspective-aware query routing
 *
 * Tests the perspective parameter feature that maps to T-patterns
 * for multi-view retrieval.
 */

import { describe, it, expect } from 'vitest';
import {
  inferPerspective,
  getPerspectiveConfig,
  getRelevantTPatterns,
  getEntityTypeWeight,
  calculatePerspectiveBoost,
  applyPerspectiveWeights,
  isTPatternRelevant,
  PERSPECTIVE_CONFIGS,
  TASK_TYPE_TO_PERSPECTIVE,
  type PerspectiveConfig,
} from '../perspective.js';
import type { Perspective } from '../../types.js';
import { isPerspective, PERSPECTIVES } from '../../types.js';

describe('Perspective Type Validation', () => {
  it('should recognize all valid perspectives', () => {
    const validPerspectives: Perspective[] = [
      'navigation',
      'debugging',
      'security',
      'performance',
      'architecture',
      'modification',
      'testing',
      'understanding',
    ];

    for (const perspective of validPerspectives) {
      expect(isPerspective(perspective)).toBe(true);
    }
  });

  it('should reject invalid perspectives', () => {
    expect(isPerspective('invalid')).toBe(false);
    expect(isPerspective('')).toBe(false);
    expect(isPerspective(null)).toBe(false);
    expect(isPerspective(undefined)).toBe(false);
    expect(isPerspective(123)).toBe(false);
  });

  it('should have exactly 8 perspectives in PERSPECTIVES constant', () => {
    expect(PERSPECTIVES).toHaveLength(8);
  });
});

describe('Perspective Configuration', () => {
  it('should have configuration for all perspectives', () => {
    for (const perspective of PERSPECTIVES) {
      const config = getPerspectiveConfig(perspective);
      expect(config).toBeDefined();
      expect(config.id).toBe(perspective);
      expect(config.description).toBeTruthy();
      expect(config.tPatternIds.length).toBeGreaterThan(0);
      expect(config.tPatternCategories.length).toBeGreaterThan(0);
    }
  });

  it('should have valid entity type weights', () => {
    for (const perspective of PERSPECTIVES) {
      const config = getPerspectiveConfig(perspective);
      expect(config.entityTypeWeights.function).toBeGreaterThanOrEqual(0);
      expect(config.entityTypeWeights.function).toBeLessThanOrEqual(1);
      expect(config.entityTypeWeights.module).toBeGreaterThanOrEqual(0);
      expect(config.entityTypeWeights.module).toBeLessThanOrEqual(1);
      expect(config.entityTypeWeights.document).toBeGreaterThanOrEqual(0);
      expect(config.entityTypeWeights.document).toBeLessThanOrEqual(1);
    }
  });

  it('should have boost and penalty keywords for each perspective', () => {
    for (const perspective of PERSPECTIVES) {
      const config = getPerspectiveConfig(perspective);
      // Most perspectives should have boost keywords
      if (perspective !== 'modification' && perspective !== 'testing') {
        expect(config.boostKeywords.length).toBeGreaterThan(0);
      }
    }
  });

  it('should have a focus prompt for synthesis', () => {
    for (const perspective of PERSPECTIVES) {
      const config = getPerspectiveConfig(perspective);
      expect(config.focusPrompt).toBeTruthy();
      expect(config.focusPrompt.length).toBeGreaterThan(20);
    }
  });
});

describe('Perspective T-Pattern Mapping', () => {
  describe('debugging perspective', () => {
    it('should map to bug investigation T-patterns (T-19 to T-24)', () => {
      const patterns = getRelevantTPatterns('debugging');
      expect(patterns).toContain('T-19');
      expect(patterns).toContain('T-20');
      expect(patterns).toContain('T-21');
      expect(patterns).toContain('T-22');
      expect(patterns).toContain('T-23');
      expect(patterns).toContain('T-24');
    });

    it('should also include supporting patterns', () => {
      const patterns = getRelevantTPatterns('debugging');
      expect(patterns).toContain('T-03'); // Call graph
      expect(patterns).toContain('T-10'); // Error handling
      expect(patterns).toContain('T-06'); // Test mapping
    });

    it('should detect T-pattern relevance correctly', () => {
      expect(isTPatternRelevant('T-19', 'debugging')).toBe(true);
      expect(isTPatternRelevant('T-27', 'debugging')).toBe(false); // Security
    });
  });

  describe('security perspective', () => {
    it('should map to T-27 (security vulnerabilities)', () => {
      const patterns = getRelevantTPatterns('security');
      expect(patterns).toContain('T-27');
    });

    it('should include supporting understanding patterns', () => {
      const patterns = getRelevantTPatterns('security');
      expect(patterns).toContain('T-10'); // Error handling
      expect(patterns).toContain('T-11'); // Data flow
      expect(patterns).toContain('T-12'); // Side effects
    });
  });

  describe('performance perspective', () => {
    it('should map to T-28 (performance anti-patterns)', () => {
      const patterns = getRelevantTPatterns('performance');
      expect(patterns).toContain('T-28');
    });

    it('should include related patterns', () => {
      const patterns = getRelevantTPatterns('performance');
      expect(patterns).toContain('T-12'); // Side effects
      expect(patterns).toContain('T-11'); // Data flow
      expect(patterns).toContain('T-21'); // Race conditions
    });
  });

  describe('architecture perspective', () => {
    it('should map to architecture patterns (T-07, T-08, T-09, T-29)', () => {
      const patterns = getRelevantTPatterns('architecture');
      expect(patterns).toContain('T-07'); // Function purpose
      expect(patterns).toContain('T-08'); // Module architecture
      expect(patterns).toContain('T-09'); // Design patterns
      expect(patterns).toContain('T-29'); // Circular dependencies
    });

    it('should include navigation patterns', () => {
      const patterns = getRelevantTPatterns('architecture');
      expect(patterns).toContain('T-03'); // Call graph
      expect(patterns).toContain('T-04'); // Dependency graph
    });
  });

  describe('modification perspective', () => {
    it('should map to modification patterns (T-13 to T-18)', () => {
      const patterns = getRelevantTPatterns('modification');
      expect(patterns).toContain('T-13'); // Find all usages
      expect(patterns).toContain('T-14'); // Breaking changes
      expect(patterns).toContain('T-15'); // Similar patterns
      expect(patterns).toContain('T-16'); // Feature location
      expect(patterns).toContain('T-17'); // Test gaps
      expect(patterns).toContain('T-18'); // Configuration
    });
  });

  describe('testing perspective', () => {
    it('should map to test patterns (T-06, T-17)', () => {
      const patterns = getRelevantTPatterns('testing');
      expect(patterns).toContain('T-06'); // Test mapping
      expect(patterns).toContain('T-17'); // Test gaps
    });
  });

  describe('understanding perspective', () => {
    it('should map to navigation and understanding patterns (T-01 to T-12)', () => {
      const patterns = getRelevantTPatterns('understanding');
      for (let i = 1; i <= 12; i++) {
        const pattern = `T-${i.toString().padStart(2, '0')}`;
        expect(patterns).toContain(pattern);
      }
    });
  });
});

describe('Perspective Inference', () => {
  it('should return explicit perspective when provided', () => {
    const perspective = inferPerspective({
      perspective: 'security',
      taskType: 'debugging', // Should be ignored
    });
    expect(perspective).toBe('security');
  });

  it('should infer perspective from taskType when perspective not provided', () => {
    expect(inferPerspective({ taskType: 'security_audit' })).toBe('security');
    expect(inferPerspective({ taskType: 'debugging' })).toBe('debugging');
    expect(inferPerspective({ taskType: 'performance_audit' })).toBe('performance');
    expect(inferPerspective({ taskType: 'architecture_review' })).toBe('architecture');
    expect(inferPerspective({ taskType: 'code_review' })).toBe('modification');
    expect(inferPerspective({ taskType: 'test_coverage' })).toBe('testing');
  });

  it('should infer perspective from analysis task types', () => {
    expect(inferPerspective({ taskType: 'premortem' })).toBe('architecture');
    expect(inferPerspective({ taskType: 'complexity_audit' })).toBe('architecture');
    expect(inferPerspective({ taskType: 'integration_risk' })).toBe('modification');
    expect(inferPerspective({ taskType: 'slop_detection' })).toBe('modification');
  });

  it('should return undefined when no perspective can be inferred', () => {
    expect(inferPerspective({})).toBeUndefined();
    expect(inferPerspective({ taskType: 'unknown_task' })).toBeUndefined();
  });
});

describe('TASK_TYPE_TO_PERSPECTIVE Mapping', () => {
  it('should map all documented task types', () => {
    const expectedMappings: Record<string, Perspective> = {
      'security_audit': 'security',
      'debugging': 'debugging',
      'performance_audit': 'performance',
      'architecture_review': 'architecture',
      'code_review': 'modification',
      'test_coverage': 'testing',
      'premortem': 'architecture',
      'complexity_audit': 'architecture',
      'integration_risk': 'modification',
      'slop_detection': 'modification',
    };

    for (const [taskType, expectedPerspective] of Object.entries(expectedMappings)) {
      expect(TASK_TYPE_TO_PERSPECTIVE[taskType]).toBe(expectedPerspective);
    }
  });
});

describe('Entity Type Weights', () => {
  it('should return function weight 1.0 for debugging perspective', () => {
    expect(getEntityTypeWeight('function', 'debugging')).toBe(1.0);
    expect(getEntityTypeWeight('module', 'debugging')).toBe(0.7);
    expect(getEntityTypeWeight('document', 'debugging')).toBe(0.3);
  });

  it('should prefer modules for architecture perspective', () => {
    expect(getEntityTypeWeight('module', 'architecture')).toBe(1.0);
    expect(getEntityTypeWeight('function', 'architecture')).toBe(0.6);
  });

  it('should boost documents for understanding perspective', () => {
    const docWeight = getEntityTypeWeight('document', 'understanding');
    expect(docWeight).toBeGreaterThanOrEqual(0.9);
  });

  it('should return default weight for unknown entity type', () => {
    const weight = getEntityTypeWeight('unknown' as any, 'debugging');
    expect(weight).toBe(0.5);
  });
});

describe('Perspective Boost Calculation', () => {
  describe('security perspective', () => {
    it('should boost text containing security keywords', () => {
      const securityText = 'This function handles authentication and validates user tokens';
      const boost = calculatePerspectiveBoost(securityText, 'security');
      expect(boost).toBeGreaterThan(1.0);
    });

    it('should penalize test-related text', () => {
      const testText = 'This is a mock authentication for testing';
      const boost = calculatePerspectiveBoost(testText, 'security');
      // 'mock' and 'test' are penalty keywords
      expect(boost).toBeLessThan(1.15); // Some boost from 'auth' but penalty from 'mock' and 'test'
    });
  });

  describe('debugging perspective', () => {
    it('should boost error-related text', () => {
      const errorText = 'Handle exception when null pointer causes crash';
      const boost = calculatePerspectiveBoost(errorText, 'debugging');
      expect(boost).toBeGreaterThan(1.0);
    });
  });

  describe('performance perspective', () => {
    it('should boost async/cache related text', () => {
      const perfText = 'Async batch processing with cache memoization';
      const boost = calculatePerspectiveBoost(perfText, 'performance');
      expect(boost).toBeGreaterThan(1.0);
    });
  });

  it('should clamp boost to valid range [0.7, 1.5]', () => {
    // Even with many keywords, should not exceed 1.5
    const manyKeywords = 'auth password token secret credential encrypt decrypt hash validate sanitize';
    const boost = calculatePerspectiveBoost(manyKeywords, 'security');
    expect(boost).toBeLessThanOrEqual(1.5);
    expect(boost).toBeGreaterThanOrEqual(0.7);
  });

  it('should return base boost of 1.0 for neutral text', () => {
    const neutralText = 'This is a simple utility function';
    const boost = calculatePerspectiveBoost(neutralText, 'security');
    expect(boost).toBeCloseTo(1.0, 1);
  });
});

describe('Perspective Weight Application', () => {
  const baseWeights = {
    semantic: 0.25,
    structural: 0.10,
    history: 0.08,
    recency: 0.07,
    keyword: 0.15,
    domain: 0.10,
    entity_type: 0.08,
    ownership: 0.05,
    risk: 0.04,
    test: 0.04,
    dependency: 0.04,
  };

  it('should modify weights based on perspective', () => {
    const securityWeights = applyPerspectiveWeights(baseWeights, 'security');

    // Security perspective should boost risk signal
    const baseRiskRatio = baseWeights.risk / Object.values(baseWeights).reduce((a, b) => a + b, 0);
    const securityRiskRatio = securityWeights.risk;

    expect(securityRiskRatio).toBeGreaterThan(baseRiskRatio);
  });

  it('should normalize weights to sum to approximately 1', () => {
    for (const perspective of PERSPECTIVES) {
      const modifiedWeights = applyPerspectiveWeights(baseWeights, perspective);
      const sum = Object.values(modifiedWeights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });

  it('should boost test signal for testing perspective', () => {
    const testingWeights = applyPerspectiveWeights(baseWeights, 'testing');
    const baseTestWeight = baseWeights.test / Object.values(baseWeights).reduce((a, b) => a + b, 0);

    // Testing perspective has 2.0 modifier for test signal
    expect(testingWeights.test).toBeGreaterThan(baseTestWeight);
  });

  it('should boost history signal for debugging perspective', () => {
    const debuggingWeights = applyPerspectiveWeights(baseWeights, 'debugging');
    const baseHistoryWeight = baseWeights.history / Object.values(baseWeights).reduce((a, b) => a + b, 0);

    // Debugging perspective has 1.3 modifier for history signal
    expect(debuggingWeights.history).toBeGreaterThan(baseHistoryWeight);
  });
});

describe('Perspective Config Completeness', () => {
  it('should have all required fields for each perspective', () => {
    for (const [id, config] of Object.entries(PERSPECTIVE_CONFIGS)) {
      expect(config.id).toBe(id);
      expect(typeof config.description).toBe('string');
      expect(Array.isArray(config.tPatternIds)).toBe(true);
      expect(Array.isArray(config.tPatternCategories)).toBe(true);
      expect(typeof config.entityTypeWeights).toBe('object');
      expect(typeof config.signalModifiers).toBe('object');
      expect(Array.isArray(config.boostKeywords)).toBe(true);
      expect(Array.isArray(config.penaltyKeywords)).toBe(true);
      expect(typeof config.focusPrompt).toBe('string');
    }
  });

  it('should reference valid T-pattern categories', () => {
    const validCategories = ['navigation', 'understanding', 'modification', 'bug_investigation', 'hard_scenarios'];

    for (const config of Object.values(PERSPECTIVE_CONFIGS)) {
      for (const category of config.tPatternCategories) {
        expect(validCategories).toContain(category);
      }
    }
  });

  it('should have valid T-pattern ID format', () => {
    const tPatternIdRegex = /^T-\d{2}$/;

    for (const config of Object.values(PERSPECTIVE_CONFIGS)) {
      for (const patternId of config.tPatternIds) {
        expect(patternId).toMatch(tPatternIdRegex);
      }
    }
  });
});

describe('Integration: Query with Perspective', () => {
  it('should apply perspective to query context', () => {
    const query = {
      intent: 'find authentication vulnerabilities',
      perspective: 'security' as Perspective,
    };

    const perspective = inferPerspective(query);
    expect(perspective).toBe('security');

    const config = getPerspectiveConfig(perspective!);
    expect(config.tPatternIds).toContain('T-27');

    const boost = calculatePerspectiveBoost(query.intent, perspective!);
    expect(boost).toBeGreaterThan(1.0); // 'authentication' should boost
  });

  it('should handle debugging perspective queries', () => {
    const query = {
      intent: 'trace null pointer exception in user service',
      taskType: 'debugging',
    };

    const perspective = inferPerspective(query);
    expect(perspective).toBe('debugging');

    const config = getPerspectiveConfig(perspective!);
    expect(config.tPatternCategories).toContain('bug_investigation');

    const boost = calculatePerspectiveBoost(query.intent, perspective!);
    expect(boost).toBeGreaterThan(1.0); // 'null', 'exception' should boost
  });

  it('should handle architecture perspective queries', () => {
    const query = {
      intent: 'analyze circular dependencies in module structure',
      perspective: 'architecture' as Perspective,
    };

    const perspective = inferPerspective(query);
    expect(perspective).toBe('architecture');

    const patterns = getRelevantTPatterns(perspective!);
    expect(patterns).toContain('T-29'); // Circular dependencies
    expect(patterns).toContain('T-04'); // Dependency graph

    const entityWeight = getEntityTypeWeight('module', perspective!);
    expect(entityWeight).toBe(1.0); // Modules most important for architecture
  });
});
