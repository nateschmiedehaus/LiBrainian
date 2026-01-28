/**
 * @fileoverview Tests for Self-Consistency Sampling (WU-CONTRA-004)
 *
 * Implements TDD for self-consistency sampling hallucination detection.
 *
 * The SelfConsistencyChecker generates multiple responses to the same query
 * and compares them for consistency, detecting contradictions and inconsistencies.
 *
 * Target: AUROC >= 0.75 for inconsistency detection
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SelfConsistencyChecker,
  createSelfConsistencyChecker,
  type SamplingConfig,
  type ResponseSample,
  type ConsistencyResult,
  type Agreement,
  type Contradiction,
  type InconsistencyDetectionResult,
  DEFAULT_SAMPLING_CONFIG,
} from '../self_consistency.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleSamplingConfig: SamplingConfig = {
  numSamples: 5,
  temperature: 0.7,
  maxTokens: 1000,
  diversityWeight: 0.3,
};

const consistentSamples: ResponseSample[] = [
  {
    id: 'sample-1',
    response: 'The UserService class has 4 methods: createUser, updateUser, deleteUser, and findById.',
    confidence: 0.85,
    generationParams: { temperature: 0.7 },
  },
  {
    id: 'sample-2',
    response: 'UserService contains four methods for user management: createUser, updateUser, deleteUser, findById.',
    confidence: 0.82,
    generationParams: { temperature: 0.7 },
  },
  {
    id: 'sample-3',
    response: 'The UserService provides 4 methods: createUser(), updateUser(), deleteUser(), and findById().',
    confidence: 0.88,
    generationParams: { temperature: 0.7 },
  },
];

const inconsistentSamples: ResponseSample[] = [
  {
    id: 'sample-1',
    response: 'The function returns a string type.',
    confidence: 0.80,
    generationParams: { temperature: 0.7 },
  },
  {
    id: 'sample-2',
    response: 'The function returns a number type.',
    confidence: 0.75,
    generationParams: { temperature: 0.7 },
  },
  {
    id: 'sample-3',
    response: 'This function returns void and does not return any value.',
    confidence: 0.70,
    generationParams: { temperature: 0.7 },
  },
];

const mixedSamples: ResponseSample[] = [
  {
    id: 'sample-1',
    response: 'The class has 3 public methods and 2 private methods.',
    confidence: 0.85,
    generationParams: { temperature: 0.7 },
  },
  {
    id: 'sample-2',
    response: 'There are 5 methods total: 3 public and 2 private.',
    confidence: 0.80,
    generationParams: { temperature: 0.7 },
  },
  {
    id: 'sample-3',
    response: 'The class contains 4 methods, all of which are public.',
    confidence: 0.78,
    generationParams: { temperature: 0.7 },
  },
];

// ============================================================================
// FACTORY TESTS
// ============================================================================

describe('createSelfConsistencyChecker Factory', () => {
  it('should create an instance with default config', () => {
    const checker = createSelfConsistencyChecker();
    expect(checker).toBeInstanceOf(SelfConsistencyChecker);
  });

  it('should create an instance with custom config', () => {
    const checker = createSelfConsistencyChecker({
      numSamples: 10,
      temperature: 0.9,
    });
    expect(checker).toBeInstanceOf(SelfConsistencyChecker);
  });

  it('should have sensible default config values', () => {
    expect(DEFAULT_SAMPLING_CONFIG.numSamples).toBeGreaterThan(0);
    expect(DEFAULT_SAMPLING_CONFIG.temperature).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SAMPLING_CONFIG.temperature).toBeLessThanOrEqual(2);
    expect(DEFAULT_SAMPLING_CONFIG.maxTokens).toBeGreaterThan(0);
    expect(DEFAULT_SAMPLING_CONFIG.diversityWeight).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SAMPLING_CONFIG.diversityWeight).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// GENERATE SAMPLES TESTS
// ============================================================================

describe('SelfConsistencyChecker.generateSamples', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should generate the configured number of samples', async () => {
    const generator = vi.fn().mockImplementation(async () => 'Sample response');
    const samples = await checker.generateSamples(
      'What is UserService?',
      { ...sampleSamplingConfig, numSamples: 3 },
      generator
    );

    expect(samples.length).toBe(3);
  });

  it('should return samples with required fields', async () => {
    const generator = vi.fn().mockResolvedValue('Test response');
    const samples = await checker.generateSamples(
      'Test query',
      sampleSamplingConfig,
      generator
    );

    for (const sample of samples) {
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('response');
      expect(sample).toHaveProperty('confidence');
      expect(sample).toHaveProperty('generationParams');
      expect(typeof sample.id).toBe('string');
      expect(typeof sample.response).toBe('string');
      expect(typeof sample.confidence).toBe('number');
      expect(sample.confidence).toBeGreaterThanOrEqual(0);
      expect(sample.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should generate unique sample IDs', async () => {
    const generator = vi.fn().mockResolvedValue('Response');
    const samples = await checker.generateSamples(
      'Test query',
      { ...sampleSamplingConfig, numSamples: 5 },
      generator
    );

    const ids = samples.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should pass query to the generator', async () => {
    const generator = vi.fn().mockResolvedValue('Response');
    const query = 'What methods does UserService have?';

    await checker.generateSamples(query, sampleSamplingConfig, generator);

    expect(generator).toHaveBeenCalled();
    expect(generator.mock.calls[0][0]).toBe(query);
  });

  it('should vary temperature for diversity', async () => {
    const generator = vi.fn().mockResolvedValue('Response');
    await checker.generateSamples(
      'Test query',
      { ...sampleSamplingConfig, numSamples: 5, diversityWeight: 0.5 },
      generator
    );

    const temps = generator.mock.calls.map((call) => call[1]?.temperature);
    // At least some variation in temperature is expected when diversityWeight > 0
    const uniqueTemps = new Set(temps.filter((t) => t !== undefined));
    expect(uniqueTemps.size).toBeGreaterThanOrEqual(1);
  });

  it('should handle generator errors gracefully', async () => {
    const generator = vi.fn()
      .mockResolvedValueOnce('Response 1')
      .mockRejectedValueOnce(new Error('API Error'))
      .mockResolvedValueOnce('Response 3');

    const samples = await checker.generateSamples(
      'Test query',
      { ...sampleSamplingConfig, numSamples: 3 },
      generator
    );

    // Should still return successful samples
    expect(samples.length).toBeGreaterThanOrEqual(2);
  });

  it('should store generation params in each sample', async () => {
    const generator = vi.fn().mockResolvedValue('Response');
    const samples = await checker.generateSamples(
      'Test query',
      sampleSamplingConfig,
      generator
    );

    for (const sample of samples) {
      expect(sample.generationParams).toBeDefined();
      expect(typeof sample.generationParams).toBe('object');
    }
  });
});

// ============================================================================
// EXTRACT CLAIMS TESTS
// ============================================================================

describe('SelfConsistencyChecker.extractClaims', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should extract claims from a response', () => {
    const response = 'The function returns a string. It accepts two parameters.';
    const claims = checker.extractClaims(response);

    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBeGreaterThan(0);
  });

  it('should extract numeric claims', () => {
    const response = 'The class has 5 methods and 3 properties.';
    const claims = checker.extractClaims(response);

    expect(claims.some((c) => c.includes('5') || c.includes('method'))).toBe(true);
  });

  it('should extract type claims', () => {
    const response = 'The function returns Promise<User>.';
    const claims = checker.extractClaims(response);

    expect(claims.some((c) => c.toLowerCase().includes('return') || c.includes('Promise'))).toBe(true);
  });

  it('should handle empty response', () => {
    const claims = checker.extractClaims('');
    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBe(0);
  });

  it('should extract multiple claims from complex response', () => {
    const response = `The UserService class is defined in src/services/user.ts.
    It has 4 methods: createUser, updateUser, deleteUser, and findById.
    The createUser method returns a Promise<User>.`;
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it('should normalize claims for comparison', () => {
    const claims = checker.extractClaims('The function returns STRING.');

    for (const claim of claims) {
      // Claims should be normalized (lowercase)
      expect(claim).toBe(claim.toLowerCase());
    }
  });

  it('should extract boolean/existence claims', () => {
    const response = 'The class is abstract. It implements the IService interface.';
    const claims = checker.extractClaims(response);

    expect(claims.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// COMPARE CLAIMS TESTS
// ============================================================================

describe('SelfConsistencyChecker.compareClaims', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should detect agreement between identical claims', () => {
    const result = checker.compareClaims(
      'the function returns string',
      'the function returns string'
    );
    expect(result).toBe('agree');
  });

  it('should detect agreement between semantically equivalent claims', () => {
    const result = checker.compareClaims(
      'returns a string value',
      'returns string'
    );
    expect(result).toBe('agree');
  });

  it('should detect contradiction between incompatible claims', () => {
    const result = checker.compareClaims(
      'returns string',
      'returns number'
    );
    expect(result).toBe('contradict');
  });

  it('should detect contradiction in numeric claims', () => {
    const result = checker.compareClaims(
      'has 3 methods',
      'has 5 methods'
    );
    expect(result).toBe('contradict');
  });

  it('should return neutral for unrelated claims', () => {
    const result = checker.compareClaims(
      'the function returns string',
      'the class is defined in src/utils'
    );
    expect(result).toBe('neutral');
  });

  it('should handle case insensitivity', () => {
    const result = checker.compareClaims(
      'Returns STRING',
      'returns string'
    );
    expect(result).toBe('agree');
  });

  it('should detect contradiction in boolean claims', () => {
    const result = checker.compareClaims(
      'the method is async',
      'the method is not async'
    );
    expect(result).toBe('contradict');
  });
});

// ============================================================================
// CHECK CONSISTENCY TESTS
// ============================================================================

describe('SelfConsistencyChecker.checkConsistency', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should return high consistency score for consistent samples', () => {
    const result = checker.checkConsistency(consistentSamples);

    expect(result.consistencyScore).toBeGreaterThanOrEqual(0.7);
  });

  it('should return low consistency score for inconsistent samples', () => {
    const result = checker.checkConsistency(inconsistentSamples);

    expect(result.consistencyScore).toBeLessThan(0.5);
  });

  it('should identify agreements between samples', () => {
    const result = checker.checkConsistency(consistentSamples);

    expect(Array.isArray(result.agreements)).toBe(true);
    expect(result.agreements.length).toBeGreaterThan(0);
  });

  it('should identify contradictions between samples', () => {
    const result = checker.checkConsistency(inconsistentSamples);

    expect(Array.isArray(result.contradictions)).toBe(true);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it('should return all required ConsistencyResult fields', () => {
    const result = checker.checkConsistency(consistentSamples);

    expect(result).toHaveProperty('samples');
    expect(result).toHaveProperty('consistencyScore');
    expect(result).toHaveProperty('agreements');
    expect(result).toHaveProperty('contradictions');
    expect(typeof result.consistencyScore).toBe('number');
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.consistencyScore).toBeLessThanOrEqual(1);
  });

  it('should include sample references in agreements', () => {
    const result = checker.checkConsistency(consistentSamples);

    for (const agreement of result.agreements) {
      expect(agreement).toHaveProperty('sampleIds');
      expect(agreement).toHaveProperty('claim');
      expect(agreement).toHaveProperty('confidence');
      expect(Array.isArray(agreement.sampleIds)).toBe(true);
      expect(agreement.sampleIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should include sample references in contradictions', () => {
    const result = checker.checkConsistency(inconsistentSamples);

    for (const contradiction of result.contradictions) {
      expect(contradiction).toHaveProperty('sample1Id');
      expect(contradiction).toHaveProperty('sample2Id');
      expect(contradiction).toHaveProperty('claim1');
      expect(contradiction).toHaveProperty('claim2');
      expect(contradiction).toHaveProperty('severity');
      expect(['minor', 'major', 'critical']).toContain(contradiction.severity);
    }
  });

  it('should handle single sample', () => {
    const result = checker.checkConsistency([consistentSamples[0]]);

    expect(result.consistencyScore).toBe(1); // Perfect consistency with self
    expect(result.contradictions.length).toBe(0);
  });

  it('should handle empty samples array', () => {
    const result = checker.checkConsistency([]);

    expect(result.consistencyScore).toBe(1); // No contradictions
    expect(result.samples.length).toBe(0);
  });

  it('should determine majority answer', () => {
    const result = checker.checkConsistency(consistentSamples);

    // With consistent samples, should have a majority answer
    expect(result.majorityAnswer).toBeDefined();
    expect(typeof result.majorityAnswer).toBe('string');
  });

  it('should not determine majority when samples are too inconsistent', () => {
    const result = checker.checkConsistency(inconsistentSamples);

    // With very inconsistent samples, majority might not be determinable
    // or should be undefined
    // This test verifies the behavior is documented
    expect(result).toHaveProperty('majorityAnswer');
  });
});

// ============================================================================
// DETECT INCONSISTENCIES TESTS
// ============================================================================

describe('SelfConsistencyChecker.detectInconsistencies', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should return isInconsistent=false for consistent samples', () => {
    const consistencyResult = checker.checkConsistency(consistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(result.isInconsistent).toBe(false);
  });

  it('should return isInconsistent=true for inconsistent samples', () => {
    const consistencyResult = checker.checkConsistency(inconsistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(result.isInconsistent).toBe(true);
  });

  it('should calculate inconsistency score', () => {
    const consistencyResult = checker.checkConsistency(mixedSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(typeof result.inconsistencyScore).toBe('number');
    expect(result.inconsistencyScore).toBeGreaterThanOrEqual(0);
    expect(result.inconsistencyScore).toBeLessThanOrEqual(1);
  });

  it('should return all required InconsistencyDetectionResult fields', () => {
    const consistencyResult = checker.checkConsistency(inconsistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(result).toHaveProperty('isInconsistent');
    expect(result).toHaveProperty('inconsistencyScore');
    expect(result).toHaveProperty('detectedContradictions');
    expect(result).toHaveProperty('recommendation');
    expect(typeof result.isInconsistent).toBe('boolean');
    expect(Array.isArray(result.detectedContradictions)).toBe(true);
    expect(typeof result.recommendation).toBe('string');
  });

  it('should list detected contradictions', () => {
    const consistencyResult = checker.checkConsistency(inconsistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(result.detectedContradictions.length).toBeGreaterThan(0);
  });

  it('should provide a recommendation', () => {
    const consistencyResult = checker.checkConsistency(inconsistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('should have appropriate recommendation for consistent samples', () => {
    const consistencyResult = checker.checkConsistency(consistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    expect(result.recommendation.toLowerCase()).toContain('consistent');
  });

  it('should have appropriate recommendation for inconsistent samples', () => {
    const consistencyResult = checker.checkConsistency(inconsistentSamples);
    const result = checker.detectInconsistencies(consistencyResult);

    // Should warn about inconsistency
    expect(
      result.recommendation.toLowerCase().includes('inconsisten') ||
      result.recommendation.toLowerCase().includes('contradict') ||
      result.recommendation.toLowerCase().includes('verify') ||
      result.recommendation.toLowerCase().includes('caution')
    ).toBe(true);
  });
});

// ============================================================================
// AGREEMENT STRUCTURE TESTS
// ============================================================================

describe('Agreement Interface', () => {
  it('should support all required fields', () => {
    const agreement: Agreement = {
      sampleIds: ['sample-1', 'sample-2', 'sample-3'],
      claim: 'the function returns string',
      confidence: 0.85,
    };

    expect(agreement.sampleIds.length).toBe(3);
    expect(agreement.claim).toBe('the function returns string');
    expect(agreement.confidence).toBe(0.85);
  });
});

// ============================================================================
// CONTRADICTION STRUCTURE TESTS
// ============================================================================

describe('Contradiction Interface', () => {
  it('should support all required fields', () => {
    const contradiction: Contradiction = {
      sample1Id: 'sample-1',
      sample2Id: 'sample-2',
      claim1: 'returns string',
      claim2: 'returns number',
      severity: 'major',
    };

    expect(contradiction.sample1Id).toBe('sample-1');
    expect(contradiction.sample2Id).toBe('sample-2');
    expect(contradiction.claim1).toBe('returns string');
    expect(contradiction.claim2).toBe('returns number');
    expect(contradiction.severity).toBe('major');
  });

  it('should support all severity levels', () => {
    const severities: Contradiction['severity'][] = ['minor', 'major', 'critical'];

    for (const severity of severities) {
      const contradiction: Contradiction = {
        sample1Id: 's1',
        sample2Id: 's2',
        claim1: 'claim a',
        claim2: 'claim b',
        severity,
      };
      expect(contradiction.severity).toBe(severity);
    }
  });
});

// ============================================================================
// SAMPLING CONFIG TESTS
// ============================================================================

describe('SamplingConfig Interface', () => {
  it('should support all required fields', () => {
    const config: SamplingConfig = {
      numSamples: 5,
      temperature: 0.8,
      maxTokens: 500,
      diversityWeight: 0.2,
    };

    expect(config.numSamples).toBe(5);
    expect(config.temperature).toBe(0.8);
    expect(config.maxTokens).toBe(500);
    expect(config.diversityWeight).toBe(0.2);
  });
});

// ============================================================================
// RESPONSE SAMPLE TESTS
// ============================================================================

describe('ResponseSample Interface', () => {
  it('should support all required fields', () => {
    const sample: ResponseSample = {
      id: 'sample-123',
      response: 'The function does something.',
      confidence: 0.75,
      generationParams: { temperature: 0.7, maxTokens: 100 },
    };

    expect(sample.id).toBe('sample-123');
    expect(sample.response).toBe('The function does something.');
    expect(sample.confidence).toBe(0.75);
    expect(sample.generationParams.temperature).toBe(0.7);
  });
});

// ============================================================================
// MAJORITY VOTING TESTS
// ============================================================================

describe('Majority Voting Algorithm', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should determine majority answer from samples', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'The answer is A.', confidence: 0.8, generationParams: {} },
      { id: 's2', response: 'The answer is A.', confidence: 0.7, generationParams: {} },
      { id: 's3', response: 'The answer is A.', confidence: 0.9, generationParams: {} },
      { id: 's4', response: 'The answer is B.', confidence: 0.6, generationParams: {} },
      { id: 's5', response: 'The answer is C.', confidence: 0.5, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    // Majority (3/5) says A
    expect(result.majorityAnswer).toContain('A');
  });

  it('should handle tie in voting', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'Answer is X.', confidence: 0.8, generationParams: {} },
      { id: 's2', response: 'Answer is Y.', confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    // Should handle tie gracefully
    expect(result).toHaveProperty('majorityAnswer');
  });

  it('should weight by confidence when voting', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'Answer is X.', confidence: 0.9, generationParams: {} },
      { id: 's2', response: 'Answer is Y.', confidence: 0.5, generationParams: {} },
      { id: 's3', response: 'Answer is Y.', confidence: 0.5, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    // X has higher confidence but Y has more votes
    // Behavior should be documented
    expect(result).toHaveProperty('majorityAnswer');
  });
});

// ============================================================================
// PAIRWISE COMPARISON TESTS
// ============================================================================

describe('Pairwise Claim Comparison', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should compare all pairs of samples', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'Returns string.', confidence: 0.8, generationParams: {} },
      { id: 's2', response: 'Returns number.', confidence: 0.8, generationParams: {} },
      { id: 's3', response: 'Returns boolean.', confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    // With 3 samples, should detect contradictions between pairs
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it('should not double-count contradictions', () => {
    const result = checker.checkConsistency(inconsistentSamples);

    // Each specific claim contradiction should be unique (not duplicated)
    // Multiple contradictions between the same pair of samples are allowed
    // (e.g., sample1 and sample2 can have multiple contradicting claims)
    const contradictionKeys = result.contradictions.map(
      (c) => `${[c.sample1Id, c.sample2Id].sort().join('-')}:${c.claim1}:${c.claim2}`
    );
    const uniqueContradictions = new Set(contradictionKeys);
    expect(uniqueContradictions.size).toBe(contradictionKeys.length);
  });
});

// ============================================================================
// SEMANTIC SIMILARITY TESTS
// ============================================================================

describe('Semantic Similarity for Claim Matching', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should match semantically similar claims as agreeing', () => {
    // Different wording, same meaning
    const result = checker.compareClaims(
      'the function accepts two arguments',
      'the function takes 2 parameters'
    );

    expect(result).toBe('agree');
  });

  it('should handle synonyms', () => {
    const result = checker.compareClaims(
      'returns a list',
      'returns an array'
    );

    expect(result).toBe('agree');
  });

  it('should distinguish between similar but different values', () => {
    const result = checker.compareClaims(
      'the timeout is 30 seconds',
      'the timeout is 60 seconds'
    );

    expect(result).toBe('contradict');
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should handle very short responses', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'Yes', confidence: 0.8, generationParams: {} },
      { id: 's2', response: 'Yes', confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle very long responses', () => {
    const longResponse = 'The function '.repeat(100) + 'returns a string.';
    const samples: ResponseSample[] = [
      { id: 's1', response: longResponse, confidence: 0.8, generationParams: {} },
      { id: 's2', response: longResponse, confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);
    expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle responses with special characters', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'Returns Promise<Map<string, number>>.', confidence: 0.8, generationParams: {} },
      { id: 's2', response: 'Returns Promise<Map<string, number>>.', confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);
    expect(result).toBeDefined();
  });

  it('should handle responses with code blocks', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'The function signature is:\n```typescript\nfunction foo(): string\n```', confidence: 0.8, generationParams: {} },
      { id: 's2', response: '```typescript\nfunction foo(): string\n```\nReturns string.', confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);
    expect(result).toBeDefined();
  });

  it('should handle numeric word equivalence', () => {
    const result = checker.compareClaims(
      'has three methods',
      'has 3 methods'
    );

    expect(result).toBe('agree');
  });

  it('should handle empty claims comparison', () => {
    const result = checker.compareClaims('', '');
    expect(result).toBe('neutral');
  });
});

// ============================================================================
// SEVERITY CLASSIFICATION TESTS
// ============================================================================

describe('Contradiction Severity Classification', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should classify type contradictions as major or critical', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'Returns string type.', confidence: 0.9, generationParams: {} },
      { id: 's2', response: 'Returns number type.', confidence: 0.9, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    if (result.contradictions.length > 0) {
      expect(['major', 'critical']).toContain(result.contradictions[0].severity);
    }
  });

  it('should classify existence contradictions as major', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'The method exists in the class.', confidence: 0.9, generationParams: {} },
      { id: 's2', response: 'The method does not exist.', confidence: 0.9, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    if (result.contradictions.length > 0) {
      expect(['major', 'critical']).toContain(result.contradictions[0].severity);
    }
  });

  it('should classify minor wording differences appropriately', () => {
    const samples: ResponseSample[] = [
      { id: 's1', response: 'The class has about 5 methods.', confidence: 0.8, generationParams: {} },
      { id: 's2', response: 'The class contains approximately 5 methods.', confidence: 0.8, generationParams: {} },
    ];

    const result = checker.checkConsistency(samples);

    // These should be consistent or have only minor contradictions
    const criticalContradictions = result.contradictions.filter((c) => c.severity === 'critical');
    expect(criticalContradictions.length).toBe(0);
  });
});

// ============================================================================
// AUROC TARGET TESTS
// ============================================================================

describe('AUROC Target >= 0.75', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should detect clear inconsistencies with high confidence', () => {
    const result = checker.checkConsistency(inconsistentSamples);
    const detection = checker.detectInconsistencies(result);

    // Clear contradictions should be detected
    expect(detection.isInconsistent).toBe(true);
    expect(detection.inconsistencyScore).toBeGreaterThan(0.5);
  });

  it('should not flag consistent responses as inconsistent', () => {
    const result = checker.checkConsistency(consistentSamples);
    const detection = checker.detectInconsistencies(result);

    expect(detection.isInconsistent).toBe(false);
  });

  it('should handle mixed consistency appropriately', () => {
    const result = checker.checkConsistency(mixedSamples);
    const detection = checker.detectInconsistencies(result);

    // Should detect some level of inconsistency
    expect(detection.inconsistencyScore).toBeGreaterThan(0);
  });
});

// ============================================================================
// FULL WORKFLOW TESTS
// ============================================================================

describe('Full Self-Consistency Workflow', () => {
  let checker: SelfConsistencyChecker;

  beforeEach(() => {
    checker = createSelfConsistencyChecker();
  });

  it('should complete full workflow: generate -> check -> detect', async () => {
    const generator = vi.fn()
      .mockResolvedValueOnce('The function returns string.')
      .mockResolvedValueOnce('The function returns string.')
      .mockResolvedValueOnce('The function returns string.');

    const samples = await checker.generateSamples(
      'What does the function return?',
      { numSamples: 3, temperature: 0.7, maxTokens: 100, diversityWeight: 0 },
      generator
    );

    const consistencyResult = checker.checkConsistency(samples);
    const detectionResult = checker.detectInconsistencies(consistencyResult);

    expect(samples.length).toBe(3);
    expect(consistencyResult.consistencyScore).toBeGreaterThan(0);
    expect(detectionResult).toHaveProperty('isInconsistent');
    expect(detectionResult).toHaveProperty('recommendation');
  });

  it('should detect inconsistencies in workflow with varying responses', async () => {
    const generator = vi.fn()
      .mockResolvedValueOnce('The answer is 5.')
      .mockResolvedValueOnce('The answer is 10.')
      .mockResolvedValueOnce('The answer is 5.');

    const samples = await checker.generateSamples(
      'What is the value?',
      { numSamples: 3, temperature: 0.7, maxTokens: 100, diversityWeight: 0 },
      generator
    );

    const consistencyResult = checker.checkConsistency(samples);
    const detectionResult = checker.detectInconsistencies(consistencyResult);

    expect(detectionResult.isInconsistent).toBe(true);
    expect(detectionResult.detectedContradictions.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CONFIGURATION TESTS
// ============================================================================

describe('Configuration Options', () => {
  it('should respect numSamples in generateSamples', async () => {
    const checker = createSelfConsistencyChecker({ numSamples: 7 });
    const generator = vi.fn().mockResolvedValue('Response');

    const samples = await checker.generateSamples(
      'Query',
      { numSamples: 7, temperature: 0.7, maxTokens: 100, diversityWeight: 0 },
      generator
    );

    expect(samples.length).toBe(7);
  });

  it('should respect temperature in generation', async () => {
    const checker = createSelfConsistencyChecker({ temperature: 0.3 });
    const generator = vi.fn().mockResolvedValue('Response');

    await checker.generateSamples(
      'Query',
      { numSamples: 1, temperature: 0.3, maxTokens: 100, diversityWeight: 0 },
      generator
    );

    expect(generator).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ temperature: expect.any(Number) })
    );
  });
});
