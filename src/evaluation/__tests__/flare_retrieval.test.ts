/**
 * @fileoverview Tests for FLARE-Style Active Retrieval (WU-RET-002)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The FLARE (Forward-Looking Active REtrieval) system monitors token-level
 * confidence during generation and triggers retrieval when confidence drops
 * below a threshold. This enables targeted, just-in-time retrieval.
 *
 * Research reference: "Active Retrieval Augmented Generation" (Jiang et al., EMNLP 2023)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  ActiveRetriever,
  createActiveRetriever,
  type ConfidenceSignal,
  type ActiveRetrievalConfig,
  DEFAULT_ACTIVE_RETRIEVAL_CONFIG,
} from '../flare_retrieval.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

// Sample token sequences with varying confidence levels
const sampleTokens = ['The', 'function', 'parseConfig', 'is', 'defined', 'in'];
const sampleConfidences = [0.95, 0.92, 0.45, 0.88, 0.35, 0.78];

// High confidence sequence (no retrieval needed)
const highConfidenceTokens = ['export', 'function', 'test', 'returns', 'true'];
const highConfidences = [0.95, 0.92, 0.88, 0.91, 0.89];

// Mixed confidence with retrieval trigger
const mixedTokens = ['The', 'class', 'inherits', 'from', 'BaseClass', 'and', 'implements'];
const mixedConfidences = [0.95, 0.88, 0.42, 0.35, 0.28, 0.85, 0.40];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createActiveRetriever', () => {
  it('should create an ActiveRetriever instance', () => {
    const retriever = createActiveRetriever();
    expect(retriever).toBeInstanceOf(ActiveRetriever);
  });

  it('should accept partial configuration', () => {
    const retriever = createActiveRetriever({ confidenceThreshold: 0.7 });
    expect(retriever).toBeInstanceOf(ActiveRetriever);
  });

  it('should use default configuration when none provided', () => {
    const retriever = createActiveRetriever();
    expect(retriever.getConfig()).toEqual(DEFAULT_ACTIVE_RETRIEVAL_CONFIG);
  });

  it('should merge partial config with defaults', () => {
    const retriever = createActiveRetriever({ confidenceThreshold: 0.7 });
    const config = retriever.getConfig();
    expect(config.confidenceThreshold).toBe(0.7);
    expect(config.windowSize).toBe(DEFAULT_ACTIVE_RETRIEVAL_CONFIG.windowSize);
    expect(config.minRetrievalGap).toBe(DEFAULT_ACTIVE_RETRIEVAL_CONFIG.minRetrievalGap);
  });
});

// ============================================================================
// ANALYZE CONFIDENCE TESTS
// ============================================================================

describe('ActiveRetriever - analyzeConfidence', () => {
  let retriever: ActiveRetriever;

  beforeAll(() => {
    retriever = createActiveRetriever({ confidenceThreshold: 0.5 });
  });

  it('should return ConfidenceSignal for each token', () => {
    const signals = retriever.analyzeConfidence(sampleTokens, sampleConfidences);

    expect(signals.length).toBe(sampleTokens.length);
    for (let i = 0; i < signals.length; i++) {
      expect(signals[i].position).toBe(i);
      expect(signals[i].token).toBe(sampleTokens[i]);
      expect(signals[i].confidence).toBe(sampleConfidences[i]);
    }
  });

  it('should mark tokens below threshold as needsRetrieval', () => {
    const signals = retriever.analyzeConfidence(sampleTokens, sampleConfidences);

    // Tokens at index 2 (0.45) and 4 (0.35) are below threshold 0.5
    expect(signals[2].needsRetrieval).toBe(true);
    expect(signals[4].needsRetrieval).toBe(true);

    // Others should not need retrieval
    expect(signals[0].needsRetrieval).toBe(false);
    expect(signals[1].needsRetrieval).toBe(false);
    expect(signals[3].needsRetrieval).toBe(false);
    expect(signals[5].needsRetrieval).toBe(false);
  });

  it('should not mark any tokens for high confidence sequence', () => {
    const signals = retriever.analyzeConfidence(highConfidenceTokens, highConfidences);

    for (const signal of signals) {
      expect(signal.needsRetrieval).toBe(false);
    }
  });

  it('should handle empty arrays', () => {
    const signals = retriever.analyzeConfidence([], []);
    expect(signals).toEqual([]);
  });

  it('should handle mismatched array lengths gracefully', () => {
    // Should use the minimum length
    const signals = retriever.analyzeConfidence(
      ['a', 'b', 'c'],
      [0.9, 0.3]
    );

    expect(signals.length).toBe(2);
  });

  it('should respect custom threshold from config', () => {
    const strictRetriever = createActiveRetriever({ confidenceThreshold: 0.9 });
    const signals = strictRetriever.analyzeConfidence(highConfidenceTokens, highConfidences);

    // At threshold 0.9, some tokens should need retrieval
    const needsRetrievalCount = signals.filter((s) => s.needsRetrieval).length;
    expect(needsRetrievalCount).toBeGreaterThan(0);
  });

  it('should handle confidence values at exactly the threshold', () => {
    const retriever = createActiveRetriever({ confidenceThreshold: 0.5 });
    const signals = retriever.analyzeConfidence(['a'], [0.5]);

    // At exactly threshold, should NOT need retrieval (>=)
    expect(signals[0].needsRetrieval).toBe(false);
  });
});

// ============================================================================
// SHOULD RETRIEVE TESTS
// ============================================================================

describe('ActiveRetriever - shouldRetrieve', () => {
  let retriever: ActiveRetriever;

  beforeAll(() => {
    retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 3,
      minRetrievalGap: 5,
    });
  });

  it('should return true when current position has low confidence', () => {
    const signals = retriever.analyzeConfidence(sampleTokens, sampleConfidences);
    // Position 2 has confidence 0.45 (below threshold)
    expect(retriever.shouldRetrieve(signals, 2)).toBe(true);
  });

  it('should return false when current and window positions all have high confidence', () => {
    const signals = retriever.analyzeConfidence(highConfidenceTokens, highConfidences);
    // All positions have high confidence - no retrieval needed
    expect(retriever.shouldRetrieve(signals, 0)).toBe(false);
  });

  it('should consider window ahead when deciding', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 3,
      minRetrievalGap: 0,
    });

    const signals = retriever.analyzeConfidence(mixedTokens, mixedConfidences);
    // Position 1 is high (0.88), but positions 2, 3, 4 ahead are low
    // Should trigger retrieval if looking ahead
    expect(retriever.shouldRetrieve(signals, 1)).toBe(true);
  });

  it('should respect minRetrievalGap', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 3,
      minRetrievalGap: 5,
    });

    const signals: ConfidenceSignal[] = [];
    for (let i = 0; i < 10; i++) {
      signals.push({
        position: i,
        token: `token${i}`,
        confidence: 0.3, // All low confidence
        needsRetrieval: true,
        lastRetrievalPosition: i === 2 ? 2 : undefined, // Retrieval happened at position 2
      });
    }

    // Position 3 is too close to last retrieval at 2 (gap of 1 < 5)
    signals[3].lastRetrievalPosition = 2;
    expect(retriever.shouldRetrieve(signals, 3, 2)).toBe(false);

    // Position 7 is far enough from last retrieval at 2 (gap of 5 >= 5)
    expect(retriever.shouldRetrieve(signals, 7, 2)).toBe(true);
  });

  it('should handle position out of bounds', () => {
    const signals = retriever.analyzeConfidence(sampleTokens, sampleConfidences);
    expect(retriever.shouldRetrieve(signals, -1)).toBe(false);
    expect(retriever.shouldRetrieve(signals, 100)).toBe(false);
  });

  it('should return false for empty signals array', () => {
    expect(retriever.shouldRetrieve([], 0)).toBe(false);
  });
});

// ============================================================================
// GENERATE QUERY TESTS
// ============================================================================

describe('ActiveRetriever - generateQuery', () => {
  let retriever: ActiveRetriever;

  beforeAll(() => {
    retriever = createActiveRetriever();
  });

  it('should generate a query from context and low-confidence span', () => {
    const context = 'The function parseConfig';
    const lowConfSpan = 'is defined in';

    const query = retriever.generateQuery(context, lowConfSpan);

    expect(query).toBeDefined();
    expect(query.length).toBeGreaterThan(0);
  });

  it('should include key terms from low-confidence span', () => {
    const context = 'The class UserService';
    const lowConfSpan = 'inherits from BaseRepository';

    const query = retriever.generateQuery(context, lowConfSpan);

    // Query should contain relevant terms
    expect(query.toLowerCase()).toMatch(/inherit|baserepository|userservice/i);
  });

  it('should extract identifiers from context', () => {
    const context = 'function calculateMetrics(input: Data)';
    const lowConfSpan = 'returns MetricsResult';

    const query = retriever.generateQuery(context, lowConfSpan);

    expect(query).toContain('MetricsResult');
  });

  it('should handle empty context', () => {
    const query = retriever.generateQuery('', 'unknown function');
    expect(query).toBeDefined();
    expect(query).toContain('function');
  });

  it('should handle empty low-confidence span', () => {
    const query = retriever.generateQuery('function test()', '');
    expect(query).toBeDefined();
    expect(query).toContain('test');
  });

  it('should limit query length', () => {
    const longContext = 'function '.repeat(100);
    const longSpan = 'variable '.repeat(100);

    const query = retriever.generateQuery(longContext, longSpan);

    // Query should be reasonably bounded
    expect(query.length).toBeLessThan(500);
  });

  it('should clean special characters from query', () => {
    const context = 'const result = await fetch("url");';
    const lowConfSpan = 'returns Promise<Response>';

    const query = retriever.generateQuery(context, lowConfSpan);

    // Should not have excessive special chars
    expect(query).not.toMatch(/[<>"=;]{2,}/);
  });
});

// ============================================================================
// INTEGRATE RETRIEVAL TESTS
// ============================================================================

describe('ActiveRetriever - integrateRetrieval', () => {
  let retriever: ActiveRetriever;

  beforeAll(() => {
    retriever = createActiveRetriever();
  });

  it('should integrate retrieved content at specified position', () => {
    const original = 'The function parseConfig is defined somewhere';
    const retrieved = 'in the config module (src/config.ts)';
    const position = 27; // Position of "is defined"

    const result = retriever.integrateRetrieval(original, retrieved, position);

    expect(result).toContain(retrieved);
    expect(result).toContain('The function parseConfig');
  });

  it('should preserve original content', () => {
    const original = 'function test() returns value';
    const retrieved = 'a boolean';
    const position = 24; // After "returns " (24 = len of "function test() returns ")

    const result = retriever.integrateRetrieval(original, retrieved, position);

    // Original key parts should still be present
    expect(result).toContain('function test()');
    expect(result).toContain('returns');
    expect(result).toContain('a boolean');
  });

  it('should handle position at start', () => {
    const original = 'Unknown class extends Base';
    const retrieved = 'MyClass is an';
    const position = 0;

    const result = retriever.integrateRetrieval(original, retrieved, position);

    expect(result).toContain(retrieved);
    expect(result).toContain('extends Base');
  });

  it('should handle position at end', () => {
    const original = 'The method is located in';
    const retrieved = 'src/services/auth.ts';
    const position = original.length;

    const result = retriever.integrateRetrieval(original, retrieved, position);

    expect(result).toContain('The method is located in');
    expect(result).toContain(retrieved);
  });

  it('should handle position beyond string length', () => {
    const original = 'short text';
    const retrieved = 'additional info';
    const position = 1000;

    const result = retriever.integrateRetrieval(original, retrieved, position);

    // Should append at end
    expect(result).toContain(original);
    expect(result).toContain(retrieved);
  });

  it('should handle empty original', () => {
    const result = retriever.integrateRetrieval('', 'new content', 0);
    expect(result).toContain('new content');
  });

  it('should handle empty retrieved', () => {
    const original = 'original text';
    const result = retriever.integrateRetrieval(original, '', 5);
    expect(result).toBe(original);
  });

  it('should format integrated content cleanly', () => {
    const original = 'The API endpoint';
    const retrieved = '/api/v1/users';
    const position = original.length;

    const result = retriever.integrateRetrieval(original, retrieved, position);

    // Should not have excessive whitespace or awkward formatting
    expect(result).not.toMatch(/\s{3,}/);
  });
});

// ============================================================================
// CONFIDENCE THRESHOLD TUNING TESTS
// ============================================================================

describe('ActiveRetriever - Domain-specific threshold tuning', () => {
  it('should support different thresholds for different domains', () => {
    // Code domain - lower threshold acceptable
    const codeRetriever = createActiveRetriever({
      confidenceThreshold: 0.4,
    });

    // Documentation domain - higher threshold needed
    const docRetriever = createActiveRetriever({
      confidenceThreshold: 0.7,
    });

    const tokens = ['function', 'name', 'is', 'defined'];
    const confidences = [0.9, 0.6, 0.5, 0.35];

    const codeSignals = codeRetriever.analyzeConfidence(tokens, confidences);
    const docSignals = docRetriever.analyzeConfidence(tokens, confidences);

    // Code retriever: only position 3 (0.35) is below 0.4 threshold
    expect(codeSignals.filter((s) => s.needsRetrieval).length).toBe(1);

    // Doc retriever: positions 1, 2, 3 are below 0.7 threshold
    expect(docSignals.filter((s) => s.needsRetrieval).length).toBe(3);
  });

  it('should allow threshold of 0 (always retrieve)', () => {
    const retriever = createActiveRetriever({ confidenceThreshold: 0 });
    const signals = retriever.analyzeConfidence(['a'], [0.0]);
    // At threshold 0, even 0.0 confidence should not need retrieval (>=)
    expect(signals[0].needsRetrieval).toBe(false);
  });

  it('should allow threshold of 1 (never retrieve based on confidence alone)', () => {
    const retriever = createActiveRetriever({ confidenceThreshold: 1 });
    const signals = retriever.analyzeConfidence(['a'], [0.99]);
    expect(signals[0].needsRetrieval).toBe(true);
  });
});

// ============================================================================
// WINDOW SIZE TESTS
// ============================================================================

describe('ActiveRetriever - Window size behavior', () => {
  it('should look ahead by windowSize tokens', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 2,
      minRetrievalGap: 0,
    });

    // Current position high, but 2 positions ahead is low
    const tokens = ['high', 'high', 'low', 'high'];
    const confidences = [0.9, 0.9, 0.3, 0.9];

    const signals = retriever.analyzeConfidence(tokens, confidences);

    // Position 0: looking ahead to 1, 2 - position 2 is low
    expect(retriever.shouldRetrieve(signals, 0)).toBe(true);
  });

  it('should not look beyond windowSize', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 1,
      minRetrievalGap: 0,
    });

    // Low confidence at position 2, but window is only 1
    const tokens = ['high', 'high', 'low'];
    const confidences = [0.9, 0.9, 0.3];

    const signals = retriever.analyzeConfidence(tokens, confidences);

    // Position 0: only looks at position 1, which is high
    expect(retriever.shouldRetrieve(signals, 0)).toBe(false);
  });

  it('should handle windowSize of 0', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 0,
      minRetrievalGap: 0,
    });

    const tokens = ['high', 'low'];
    const confidences = [0.9, 0.3];

    const signals = retriever.analyzeConfidence(tokens, confidences);

    // Window 0 means only look at current position
    expect(retriever.shouldRetrieve(signals, 0)).toBe(false);
    expect(retriever.shouldRetrieve(signals, 1)).toBe(true);
  });
});

// ============================================================================
// MIN RETRIEVAL GAP TESTS
// ============================================================================

describe('ActiveRetriever - Minimum retrieval gap', () => {
  it('should prevent retrieval within gap window', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 1,
      minRetrievalGap: 3,
    });

    const tokens = ['a', 'b', 'c', 'd', 'e'];
    const confidences = [0.3, 0.3, 0.3, 0.3, 0.3]; // All low

    const signals = retriever.analyzeConfidence(tokens, confidences);

    // After retrieval at position 0, positions 1, 2, 3 should be blocked
    expect(retriever.shouldRetrieve(signals, 1, 0)).toBe(false);
    expect(retriever.shouldRetrieve(signals, 2, 0)).toBe(false);
    expect(retriever.shouldRetrieve(signals, 3, 0)).toBe(true); // Gap of 3 is met
  });

  it('should allow first retrieval regardless of gap', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 1,
      minRetrievalGap: 10,
    });

    const signals: ConfidenceSignal[] = [{
      position: 0,
      token: 'test',
      confidence: 0.3,
      needsRetrieval: true,
    }];

    // No last retrieval position - should allow
    expect(retriever.shouldRetrieve(signals, 0)).toBe(true);
  });

  it('should handle gap of 0 (allow consecutive retrievals)', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 0,
      minRetrievalGap: 0,
    });

    const tokens = ['a', 'b', 'c'];
    const confidences = [0.3, 0.3, 0.3];

    const signals = retriever.analyzeConfidence(tokens, confidences);

    // Gap 0 means every position can retrieve
    expect(retriever.shouldRetrieve(signals, 0, undefined)).toBe(true);
    expect(retriever.shouldRetrieve(signals, 1, 0)).toBe(true);
    expect(retriever.shouldRetrieve(signals, 2, 1)).toBe(true);
  });
});

// ============================================================================
// INTERFACE TESTS
// ============================================================================

describe('ConfidenceSignal Interface', () => {
  it('should have all required fields', () => {
    const retriever = createActiveRetriever();
    const signals = retriever.analyzeConfidence(['test'], [0.5]);

    const signal = signals[0];
    expect(typeof signal.position).toBe('number');
    expect(typeof signal.token).toBe('string');
    expect(typeof signal.confidence).toBe('number');
    expect(typeof signal.needsRetrieval).toBe('boolean');
  });
});

describe('ActiveRetrievalConfig Interface', () => {
  it('should have all required fields in default config', () => {
    expect(typeof DEFAULT_ACTIVE_RETRIEVAL_CONFIG.confidenceThreshold).toBe('number');
    expect(typeof DEFAULT_ACTIVE_RETRIEVAL_CONFIG.windowSize).toBe('number');
    expect(typeof DEFAULT_ACTIVE_RETRIEVAL_CONFIG.minRetrievalGap).toBe('number');
  });

  it('should have reasonable default values', () => {
    expect(DEFAULT_ACTIVE_RETRIEVAL_CONFIG.confidenceThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_ACTIVE_RETRIEVAL_CONFIG.confidenceThreshold).toBeLessThanOrEqual(1);
    expect(DEFAULT_ACTIVE_RETRIEVAL_CONFIG.windowSize).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_ACTIVE_RETRIEVAL_CONFIG.minRetrievalGap).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ActiveRetriever - Edge Cases', () => {
  let retriever: ActiveRetriever;

  beforeAll(() => {
    retriever = createActiveRetriever();
  });

  it('should handle single token', () => {
    const signals = retriever.analyzeConfidence(['single'], [0.3]);
    expect(signals.length).toBe(1);
    expect(signals[0].needsRetrieval).toBe(true);
  });

  it('should handle all tokens at exactly threshold', () => {
    const threshold = 0.5;
    const retriever = createActiveRetriever({ confidenceThreshold: threshold });
    const signals = retriever.analyzeConfidence(['a', 'b', 'c'], [0.5, 0.5, 0.5]);

    // All at threshold - none should need retrieval
    for (const signal of signals) {
      expect(signal.needsRetrieval).toBe(false);
    }
  });

  it('should handle confidence values out of [0,1] range', () => {
    const signals = retriever.analyzeConfidence(['a', 'b'], [-0.5, 1.5]);

    // Should still work, treating values as-is
    expect(signals[0].confidence).toBe(-0.5);
    expect(signals[1].confidence).toBe(1.5);
  });

  it('should handle NaN confidence values', () => {
    const signals = retriever.analyzeConfidence(['a'], [NaN]);

    // NaN comparisons are always false, so it should need retrieval
    expect(signals[0].needsRetrieval).toBe(true);
  });

  it('should handle very long token sequences', () => {
    const longTokens = Array.from({ length: 10000 }, (_, i) => `token${i}`);
    const longConfidences = Array.from({ length: 10000 }, () => Math.random());

    const signals = retriever.analyzeConfidence(longTokens, longConfidences);
    expect(signals.length).toBe(10000);
  });

  it('should handle special characters in tokens', () => {
    const signals = retriever.analyzeConfidence(
      ['function<T>', '()', '=>', '{{', '}}'],
      [0.9, 0.3, 0.8, 0.2, 0.2]
    );

    expect(signals[0].token).toBe('function<T>');
    expect(signals[1].token).toBe('()');
  });

  it('should handle unicode tokens', () => {
    const signals = retriever.analyzeConfidence(
      ['emoji', '????', '????', '????'],
      [0.9, 0.8, 0.7, 0.6]
    );

    expect(signals.length).toBe(4);
    expect(signals[2].token).toBe('????');
  });
});

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('ActiveRetriever - Integration Scenarios', () => {
  it('should handle typical generation workflow', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.5,
      windowSize: 3,
      minRetrievalGap: 5,
    });

    // Simulate a generation where confidence drops mid-sentence
    const tokens = [
      'The', 'function', 'handleRequest', 'takes', 'a', 'RequestContext',
      'parameter', 'and', 'returns', 'a', 'ResponseObject', 'or', 'null'
    ];
    const confidences = [
      0.95, 0.92, 0.45, 0.88, 0.91, 0.38,
      0.85, 0.89, 0.42, 0.87, 0.35, 0.90, 0.93
    ];

    const signals = retriever.analyzeConfidence(tokens, confidences);

    // Low confidence at positions: 2 (handleRequest), 5 (RequestContext),
    // 8 (returns), 10 (ResponseObject)
    const lowConfPositions = signals
      .filter((s) => s.needsRetrieval)
      .map((s) => s.position);

    expect(lowConfPositions).toContain(2);
    expect(lowConfPositions).toContain(5);
    expect(lowConfPositions).toContain(8);
    expect(lowConfPositions).toContain(10);
  });

  it('should work with real-world code completion scenario', () => {
    const retriever = createActiveRetriever({
      confidenceThreshold: 0.6,
      windowSize: 2,
      minRetrievalGap: 3,
    });

    const codeTokens = ['export', 'class', 'MyService', 'extends', 'BaseService'];
    const codeConfidences = [0.98, 0.95, 0.55, 0.88, 0.42];

    const signals = retriever.analyzeConfidence(codeTokens, codeConfidences);

    // Position 2 (MyService, 0.55) and 4 (BaseService, 0.42) are low
    expect(signals[2].needsRetrieval).toBe(true);
    expect(signals[4].needsRetrieval).toBe(true);

    // Should retrieve at position 2
    expect(retriever.shouldRetrieve(signals, 2)).toBe(true);

    // Position 4 with last retrieval at 2: gap of 2 is less than minRetrievalGap 3
    expect(retriever.shouldRetrieve(signals, 4, 2)).toBe(false); // Gap 2 < 3

    // Position 4 with last retrieval at 0: gap of 4 >= minRetrievalGap 3
    expect(retriever.shouldRetrieve(signals, 4, 0)).toBe(true); // Gap 4 >= 3
  });

  it('should generate appropriate query for code context', () => {
    const retriever = createActiveRetriever();

    const context = 'class UserRepository extends';
    const lowConfSpan = 'BaseRepository implements CrudOperations';

    const query = retriever.generateQuery(context, lowConfSpan);

    // Should include relevant class/interface names
    expect(query).toMatch(/userrepository|baserepository|crudoperations/i);
  });

  it('should seamlessly integrate retrieved code documentation', () => {
    const retriever = createActiveRetriever();

    const original = 'The authenticate method in AuthService';
    const retrieved = 'verifies JWT tokens and returns a UserContext object';
    const position = original.length;

    const result = retriever.integrateRetrieval(original, retrieved, position);

    expect(result).toContain('authenticate');
    expect(result).toContain('AuthService');
    expect(result).toContain('JWT tokens');
    expect(result).toContain('UserContext');
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('ActiveRetriever - Performance', () => {
  it('should analyze confidence quickly for large sequences', () => {
    const retriever = createActiveRetriever();
    const tokens = Array.from({ length: 5000 }, (_, i) => `token${i}`);
    const confidences = Array.from({ length: 5000 }, () => Math.random());

    const start = Date.now();
    retriever.analyzeConfidence(tokens, confidences);
    const elapsed = Date.now() - start;

    // Should complete within 100ms for 5000 tokens
    expect(elapsed).toBeLessThan(100);
  });

  it('should make retrieval decisions quickly', () => {
    const retriever = createActiveRetriever();
    const tokens = Array.from({ length: 1000 }, (_, i) => `token${i}`);
    const confidences = Array.from({ length: 1000 }, () => Math.random());
    const signals = retriever.analyzeConfidence(tokens, confidences);

    const start = Date.now();
    for (let i = 0; i < signals.length; i++) {
      retriever.shouldRetrieve(signals, i);
    }
    const elapsed = Date.now() - start;

    // Should complete within 50ms for 1000 decisions
    expect(elapsed).toBeLessThan(50);
  });
});
