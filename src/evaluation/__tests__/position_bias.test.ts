/**
 * @fileoverview Tests for Position Bias Mitigation (WU-CTX-001)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Position Bias Manager addresses the "lost in the middle" phenomenon where
 * LLMs tend to pay less attention to information in the middle of their context.
 * It provides strategies to reorder context chunks to optimize information retention.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PositionBiasManager,
  createPositionBiasManager,
  type ContextChunk,
  type ReorderingStrategy,
  type ReorderedContext,
  type PositionAnalysis,
} from '../position_bias.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createTestChunks = (): ContextChunk[] => [
  {
    id: 'chunk-1',
    content: 'This is the main function definition',
    importance: 0.9,
    type: 'code',
    tokens: 50,
  },
  {
    id: 'chunk-2',
    content: 'Some supporting documentation',
    importance: 0.5,
    type: 'documentation',
    tokens: 30,
  },
  {
    id: 'chunk-3',
    content: 'A helpful code comment',
    importance: 0.3,
    type: 'comment',
    tokens: 20,
  },
  {
    id: 'chunk-4',
    content: 'Usage example for the function',
    importance: 0.7,
    type: 'example',
    tokens: 40,
  },
  {
    id: 'chunk-5',
    content: 'Secondary function implementation',
    importance: 0.6,
    type: 'code',
    tokens: 45,
  },
];

const createManyChunks = (count: number): ContextChunk[] => {
  const types: ContextChunk['type'][] = ['code', 'documentation', 'comment', 'example'];
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i + 1}`,
    content: `Content for chunk ${i + 1}`,
    importance: Math.random(),
    type: types[i % types.length],
    tokens: 20 + Math.floor(Math.random() * 80),
  }));
};

const createImportantMiddleChunks = (): ContextChunk[] => [
  { id: 'c1', content: 'Low importance start', importance: 0.2, type: 'comment', tokens: 20 },
  { id: 'c2', content: 'Low importance', importance: 0.3, type: 'comment', tokens: 20 },
  { id: 'c3', content: 'HIGH IMPORTANCE MIDDLE', importance: 0.95, type: 'code', tokens: 50 },
  { id: 'c4', content: 'CRITICAL INFORMATION', importance: 0.98, type: 'code', tokens: 60 },
  { id: 'c5', content: 'Another high importance', importance: 0.85, type: 'code', tokens: 40 },
  { id: 'c6', content: 'Low importance', importance: 0.25, type: 'comment', tokens: 20 },
  { id: 'c7', content: 'Low importance end', importance: 0.15, type: 'comment', tokens: 20 },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createPositionBiasManager', () => {
  it('should create a manager instance', () => {
    const manager = createPositionBiasManager();
    expect(manager).toBeInstanceOf(PositionBiasManager);
  });
});

// ============================================================================
// POSITION ANALYSIS TESTS
// ============================================================================

describe('PositionBiasManager - analyzePositions', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should count total chunks correctly', () => {
    const chunks = createTestChunks();
    const analysis = manager.analyzePositions(chunks);

    expect(analysis.totalChunks).toBe(5);
  });

  it('should detect important chunks in the middle', () => {
    const chunks = createImportantMiddleChunks();
    const analysis = manager.analyzePositions(chunks);

    // Middle 60% of 7 chunks is approximately indices 1-5 (5 chunks)
    // Important chunks (>0.7) in middle: c3 (0.95), c4 (0.98), c5 (0.85) = 3 chunks
    expect(analysis.importantInMiddle).toBeGreaterThanOrEqual(2);
  });

  it('should calculate risk score based on important chunks in middle', () => {
    const chunks = createImportantMiddleChunks();
    const analysis = manager.analyzePositions(chunks);

    // High risk when important chunks are concentrated in the middle
    expect(analysis.riskScore).toBeGreaterThan(0.5);
  });

  it('should provide recommendations when risk is high', () => {
    const chunks = createImportantMiddleChunks();
    const analysis = manager.analyzePositions(chunks);

    expect(analysis.recommendations.length).toBeGreaterThan(0);
    expect(analysis.recommendations.some((r) => r.toLowerCase().includes('reorder'))).toBe(true);
  });

  it('should return low risk score when important chunks are at edges', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'Important at start', importance: 0.95, type: 'code', tokens: 50 },
      { id: 'c2', content: 'Low', importance: 0.2, type: 'comment', tokens: 20 },
      { id: 'c3', content: 'Low', importance: 0.3, type: 'comment', tokens: 20 },
      { id: 'c4', content: 'Low', importance: 0.25, type: 'comment', tokens: 20 },
      { id: 'c5', content: 'Important at end', importance: 0.9, type: 'code', tokens: 50 },
    ];
    const analysis = manager.analyzePositions(chunks);

    expect(analysis.riskScore).toBeLessThan(0.5);
  });

  it('should handle empty chunks array', () => {
    const analysis = manager.analyzePositions([]);

    expect(analysis.totalChunks).toBe(0);
    expect(analysis.importantInMiddle).toBe(0);
    expect(analysis.riskScore).toBe(0);
  });

  it('should handle single chunk', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'Only chunk', importance: 0.9, type: 'code', tokens: 50 },
    ];
    const analysis = manager.analyzePositions(chunks);

    expect(analysis.totalChunks).toBe(1);
    expect(analysis.riskScore).toBe(0); // No middle to lose information in
  });

  it('should handle two chunks', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'First', importance: 0.9, type: 'code', tokens: 50 },
      { id: 'c2', content: 'Second', importance: 0.8, type: 'code', tokens: 50 },
    ];
    const analysis = manager.analyzePositions(chunks);

    expect(analysis.totalChunks).toBe(2);
    expect(analysis.riskScore).toBe(0); // No middle with 2 chunks
  });
});

// ============================================================================
// REORDERING STRATEGY TESTS
// ============================================================================

describe('PositionBiasManager - reorder', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should apply importance_first strategy', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'importance_first',
      description: 'Sort chunks by importance descending',
    };

    const result = manager.reorder(chunks, strategy);

    expect(result.strategy).toBe('importance_first');
    expect(result.chunks[0].importance).toBeGreaterThanOrEqual(result.chunks[1].importance);
    expect(result.chunks[1].importance).toBeGreaterThanOrEqual(result.chunks[2].importance);
  });

  it('should apply importance_edges strategy', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'importance_edges',
      description: 'Place most important at start and end',
    };

    const result = manager.reorder(chunks, strategy);

    expect(result.strategy).toBe('importance_edges');
    // First and last should have higher importance than middle chunks
    const middleAvgImportance =
      result.chunks.slice(1, -1).reduce((sum, c) => sum + c.importance, 0) /
      (result.chunks.length - 2);
    expect(result.chunks[0].importance).toBeGreaterThanOrEqual(middleAvgImportance);
  });

  it('should apply round_robin strategy', () => {
    const chunks = createManyChunks(10);
    const strategy: ReorderingStrategy = {
      name: 'round_robin',
      description: 'Spread important chunks at regular intervals',
    };

    const result = manager.reorder(chunks, strategy);

    expect(result.strategy).toBe('round_robin');
    expect(result.chunks.length).toBe(10);
  });

  it('should preserve original order in result', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'importance_first',
      description: 'Sort by importance',
    };

    const result = manager.reorder(chunks, strategy);

    expect(result.originalOrder).toEqual(['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5']);
    expect(result.newOrder.length).toBe(5);
    expect(new Set(result.newOrder).size).toBe(5); // All unique
  });

  it('should track important chunk positions', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'importance_edges',
      description: 'Place important at edges',
    };

    const result = manager.reorder(chunks, strategy);

    expect(result.importantPositions.length).toBeGreaterThan(0);
    result.importantPositions.forEach((pos) => {
      expect(['start', 'middle', 'end']).toContain(pos.position);
      expect(typeof pos.id).toBe('string');
    });
  });

  it('should handle empty chunks array', () => {
    const strategy: ReorderingStrategy = {
      name: 'importance_first',
      description: 'Sort by importance',
    };

    const result = manager.reorder([], strategy);

    expect(result.chunks).toEqual([]);
    expect(result.originalOrder).toEqual([]);
    expect(result.newOrder).toEqual([]);
  });

  it('should handle custom strategy', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'custom',
      description: 'Custom reordering',
    };

    const result = manager.reorder(chunks, strategy);

    expect(result.strategy).toBe('custom');
    // Custom strategy should still return valid result
    expect(result.chunks.length).toBe(chunks.length);
  });
});

// ============================================================================
// IMPORTANCE FIRST STRATEGY TESTS
// ============================================================================

describe('PositionBiasManager - importanceFirst', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should sort chunks by importance descending', () => {
    const chunks = createTestChunks();
    const reordered = manager.importanceFirst(chunks);

    for (let i = 0; i < reordered.length - 1; i++) {
      expect(reordered[i].importance).toBeGreaterThanOrEqual(reordered[i + 1].importance);
    }
  });

  it('should not modify original array', () => {
    const chunks = createTestChunks();
    const originalIds = chunks.map((c) => c.id);

    manager.importanceFirst(chunks);

    expect(chunks.map((c) => c.id)).toEqual(originalIds);
  });

  it('should handle chunks with equal importance', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'First', importance: 0.5, type: 'code', tokens: 50 },
      { id: 'c2', content: 'Second', importance: 0.5, type: 'code', tokens: 50 },
      { id: 'c3', content: 'Third', importance: 0.5, type: 'code', tokens: 50 },
    ];

    const reordered = manager.importanceFirst(chunks);

    expect(reordered.length).toBe(3);
    // All should still be present
    expect(reordered.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('should place highest importance first', () => {
    const chunks = createTestChunks();
    const reordered = manager.importanceFirst(chunks);

    // chunk-1 has importance 0.9, should be first
    expect(reordered[0].id).toBe('chunk-1');
  });
});

// ============================================================================
// IMPORTANCE TO EDGES STRATEGY TESTS
// ============================================================================

describe('PositionBiasManager - importanceToEdges', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should place most important at start', () => {
    const chunks = createTestChunks();
    const reordered = manager.importanceToEdges(chunks);

    // Most important (0.9) should be at start
    expect(reordered[0].importance).toBe(0.9);
  });

  it('should place second most important at end', () => {
    const chunks = createTestChunks();
    const reordered = manager.importanceToEdges(chunks);

    // Second most important (0.7) should be at end
    expect(reordered[reordered.length - 1].importance).toBe(0.7);
  });

  it('should place less important chunks in middle', () => {
    const chunks = createTestChunks();
    const reordered = manager.importanceToEdges(chunks);

    // Middle chunks should have lower importance
    const middleChunks = reordered.slice(1, -1);
    const edgeAvg = (reordered[0].importance + reordered[reordered.length - 1].importance) / 2;
    const middleAvg =
      middleChunks.reduce((sum, c) => sum + c.importance, 0) / middleChunks.length;

    expect(edgeAvg).toBeGreaterThan(middleAvg);
  });

  it('should handle odd number of chunks', () => {
    const chunks = createTestChunks(); // 5 chunks
    const reordered = manager.importanceToEdges(chunks);

    expect(reordered.length).toBe(5);
    expect(new Set(reordered.map((c) => c.id)).size).toBe(5);
  });

  it('should handle even number of chunks', () => {
    const chunks = createManyChunks(6);
    const reordered = manager.importanceToEdges(chunks);

    expect(reordered.length).toBe(6);
    expect(new Set(reordered.map((c) => c.id)).size).toBe(6);
  });

  it('should not modify original array', () => {
    const chunks = createTestChunks();
    const originalIds = chunks.map((c) => c.id);

    manager.importanceToEdges(chunks);

    expect(chunks.map((c) => c.id)).toEqual(originalIds);
  });
});

// ============================================================================
// ROUND ROBIN STRATEGY TESTS
// ============================================================================

describe('PositionBiasManager - roundRobinImportant', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should spread important chunks at regular intervals', () => {
    const chunks = createManyChunks(10);
    // Make some chunks clearly important
    chunks[0].importance = 0.95;
    chunks[3].importance = 0.9;
    chunks[7].importance = 0.85;

    const reordered = manager.roundRobinImportant(chunks);

    // Important chunks should not all be adjacent
    const importantIndices: number[] = [];
    reordered.forEach((c, i) => {
      if (c.importance >= 0.85) {
        importantIndices.push(i);
      }
    });

    // Check that important chunks have some spacing
    if (importantIndices.length >= 2) {
      const gaps = importantIndices
        .slice(1)
        .map((idx, i) => idx - importantIndices[i]);
      // At least some gap should exist
      expect(gaps.some((g) => g > 1)).toBe(true);
    }
  });

  it('should preserve all chunks', () => {
    const chunks = createTestChunks();
    const reordered = manager.roundRobinImportant(chunks);

    expect(reordered.length).toBe(chunks.length);
    expect(new Set(reordered.map((c) => c.id))).toEqual(new Set(chunks.map((c) => c.id)));
  });

  it('should not modify original array', () => {
    const chunks = createTestChunks();
    const originalIds = chunks.map((c) => c.id);

    manager.roundRobinImportant(chunks);

    expect(chunks.map((c) => c.id)).toEqual(originalIds);
  });

  it('should handle all high importance chunks', () => {
    const chunks: ContextChunk[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      content: `Content ${i}`,
      importance: 0.9 + i * 0.01,
      type: 'code' as const,
      tokens: 50,
    }));

    const reordered = manager.roundRobinImportant(chunks);

    expect(reordered.length).toBe(5);
  });

  it('should handle all low importance chunks', () => {
    const chunks: ContextChunk[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      content: `Content ${i}`,
      importance: 0.1 + i * 0.05,
      type: 'comment' as const,
      tokens: 20,
    }));

    const reordered = manager.roundRobinImportant(chunks);

    expect(reordered.length).toBe(5);
  });
});

// ============================================================================
// IMPORTANCE SCORING TESTS
// ============================================================================

describe('PositionBiasManager - scoreImportance', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should increase score when chunk content matches query', () => {
    const chunk: ContextChunk = {
      id: 'c1',
      content: 'The function calculateTotal adds up all items',
      importance: 0.5,
      type: 'documentation',
      tokens: 30,
    };

    const score = manager.scoreImportance(chunk, 'calculateTotal function');

    expect(score).toBeGreaterThan(chunk.importance);
  });

  it('should return base importance when no query match', () => {
    const chunk: ContextChunk = {
      id: 'c1',
      content: 'Some unrelated content about databases',
      importance: 0.5,
      type: 'documentation',
      tokens: 30,
    };

    const score = manager.scoreImportance(chunk, 'calculateTotal function');

    expect(score).toBeLessThanOrEqual(chunk.importance + 0.1); // Small tolerance
  });

  it('should handle empty query', () => {
    const chunk: ContextChunk = {
      id: 'c1',
      content: 'Some content',
      importance: 0.5,
      type: 'code',
      tokens: 30,
    };

    const score = manager.scoreImportance(chunk, '');

    expect(score).toBe(chunk.importance);
  });

  it('should handle empty content', () => {
    const chunk: ContextChunk = {
      id: 'c1',
      content: '',
      importance: 0.5,
      type: 'code',
      tokens: 0,
    };

    const score = manager.scoreImportance(chunk, 'some query');

    expect(score).toBe(chunk.importance);
  });

  it('should boost code type chunks slightly', () => {
    const codeChunk: ContextChunk = {
      id: 'c1',
      content: 'function test() {}',
      importance: 0.5,
      type: 'code',
      tokens: 30,
    };

    const commentChunk: ContextChunk = {
      id: 'c2',
      content: 'function test() {}',
      importance: 0.5,
      type: 'comment',
      tokens: 30,
    };

    const codeScore = manager.scoreImportance(codeChunk, 'test function');
    const commentScore = manager.scoreImportance(commentChunk, 'test function');

    expect(codeScore).toBeGreaterThanOrEqual(commentScore);
  });

  it('should cap score at 1.0', () => {
    const chunk: ContextChunk = {
      id: 'c1',
      content: 'calculateTotal calculateTotal calculateTotal',
      importance: 0.95,
      type: 'code',
      tokens: 30,
    };

    const score = manager.scoreImportance(chunk, 'calculateTotal');

    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('should floor score at 0.0', () => {
    const chunk: ContextChunk = {
      id: 'c1',
      content: 'content',
      importance: 0,
      type: 'comment',
      tokens: 30,
    };

    const score = manager.scoreImportance(chunk, 'unrelated');

    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('ContextChunk Interface', () => {
  it('should support all required fields', () => {
    const chunk: ContextChunk = {
      id: 'test-chunk',
      content: 'function hello() { return "world"; }',
      importance: 0.85,
      type: 'code',
      tokens: 42,
    };

    expect(chunk.id).toBe('test-chunk');
    expect(chunk.content).toContain('function');
    expect(chunk.importance).toBe(0.85);
    expect(chunk.type).toBe('code');
    expect(chunk.tokens).toBe(42);
  });

  it('should support all type values', () => {
    const types: ContextChunk['type'][] = ['code', 'documentation', 'comment', 'example'];

    types.forEach((type) => {
      const chunk: ContextChunk = {
        id: 'test',
        content: 'content',
        importance: 0.5,
        type,
        tokens: 10,
      };
      expect(chunk.type).toBe(type);
    });
  });
});

describe('ReorderingStrategy Interface', () => {
  it('should support all strategy names', () => {
    const strategies: ReorderingStrategy['name'][] = [
      'importance_first',
      'importance_edges',
      'round_robin',
      'custom',
    ];

    strategies.forEach((name) => {
      const strategy: ReorderingStrategy = {
        name,
        description: `Strategy: ${name}`,
      };
      expect(strategy.name).toBe(name);
    });
  });
});

describe('ReorderedContext Interface', () => {
  it('should support all required fields', () => {
    const result: ReorderedContext = {
      chunks: [],
      originalOrder: ['a', 'b', 'c'],
      newOrder: ['b', 'a', 'c'],
      strategy: 'importance_first',
      importantPositions: [
        { id: 'b', position: 'start' },
        { id: 'c', position: 'end' },
      ],
    };

    expect(result.chunks).toEqual([]);
    expect(result.originalOrder).toEqual(['a', 'b', 'c']);
    expect(result.newOrder).toEqual(['b', 'a', 'c']);
    expect(result.strategy).toBe('importance_first');
    expect(result.importantPositions.length).toBe(2);
  });
});

describe('PositionAnalysis Interface', () => {
  it('should support all required fields', () => {
    const analysis: PositionAnalysis = {
      totalChunks: 10,
      importantInMiddle: 3,
      riskScore: 0.65,
      recommendations: ['Consider reordering chunks', 'Move important info to edges'],
    };

    expect(analysis.totalChunks).toBe(10);
    expect(analysis.importantInMiddle).toBe(3);
    expect(analysis.riskScore).toBe(0.65);
    expect(analysis.recommendations.length).toBe(2);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('PositionBiasManager - Edge Cases', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should handle chunks with importance 0', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'Zero importance', importance: 0, type: 'comment', tokens: 10 },
      { id: 'c2', content: 'Some importance', importance: 0.5, type: 'code', tokens: 20 },
    ];

    const reordered = manager.importanceFirst(chunks);

    expect(reordered[0].importance).toBe(0.5);
    expect(reordered[1].importance).toBe(0);
  });

  it('should handle chunks with importance 1', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'Max importance', importance: 1, type: 'code', tokens: 50 },
      { id: 'c2', content: 'Also max', importance: 1, type: 'code', tokens: 50 },
    ];

    const reordered = manager.importanceFirst(chunks);

    expect(reordered.length).toBe(2);
    expect(reordered[0].importance).toBe(1);
    expect(reordered[1].importance).toBe(1);
  });

  it('should handle very large token counts', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: 'Large', importance: 0.5, type: 'code', tokens: 100000 },
    ];

    const analysis = manager.analyzePositions(chunks);

    expect(analysis.totalChunks).toBe(1);
  });

  it('should handle special characters in content', () => {
    const chunks: ContextChunk[] = [
      {
        id: 'c1',
        content: 'function test<T extends Record<string, number>>() {}',
        importance: 0.8,
        type: 'code',
        tokens: 30,
      },
    ];

    const score = manager.scoreImportance(chunks[0], 'test<T>');

    expect(typeof score).toBe('number');
  });

  it('should handle unicode in content', () => {
    const chunks: ContextChunk[] = [
      {
        id: 'c1',
        content: 'const message = "Hello";',
        importance: 0.5,
        type: 'code',
        tokens: 20,
      },
    ];

    const reordered = manager.importanceFirst(chunks);

    expect(reordered[0].content).toContain('Hello');
  });

  it('should handle very long content', () => {
    const longContent = 'x'.repeat(10000);
    const chunks: ContextChunk[] = [
      { id: 'c1', content: longContent, importance: 0.5, type: 'documentation', tokens: 5000 },
    ];

    const analysis = manager.analyzePositions(chunks);

    expect(analysis.totalChunks).toBe(1);
  });

  it('should handle whitespace-only content', () => {
    const chunks: ContextChunk[] = [
      { id: 'c1', content: '   \n\t   ', importance: 0.5, type: 'comment', tokens: 1 },
    ];

    const score = manager.scoreImportance(chunks[0], 'test');

    expect(typeof score).toBe('number');
  });
});

// ============================================================================
// TOKEN POSITION TRACKING TESTS
// ============================================================================

describe('PositionBiasManager - Token Position Tracking', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should track token positions after reordering', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'importance_first',
      description: 'Sort by importance',
    };

    const result = manager.reorder(chunks, strategy);

    // Total tokens should be preserved
    const originalTotalTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);
    const reorderedTotalTokens = result.chunks.reduce((sum, c) => sum + c.tokens, 0);

    expect(reorderedTotalTokens).toBe(originalTotalTokens);
  });

  it('should identify position of important chunks', () => {
    const chunks = createTestChunks();
    const strategy: ReorderingStrategy = {
      name: 'importance_edges',
      description: 'Place important at edges',
    };

    const result = manager.reorder(chunks, strategy);

    // Most important chunk should be marked at start
    const startPositions = result.importantPositions.filter((p) => p.position === 'start');
    expect(startPositions.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('PositionBiasManager - Integration', () => {
  let manager: PositionBiasManager;

  beforeEach(() => {
    manager = createPositionBiasManager();
  });

  it('should reduce risk score after reordering with importance_edges', () => {
    const chunks = createImportantMiddleChunks();
    const originalAnalysis = manager.analyzePositions(chunks);

    const strategy: ReorderingStrategy = {
      name: 'importance_edges',
      description: 'Move important to edges',
    };
    const reordered = manager.reorder(chunks, strategy);
    const newAnalysis = manager.analyzePositions(reordered.chunks);

    expect(newAnalysis.riskScore).toBeLessThan(originalAnalysis.riskScore);
  });

  it('should maintain chunk integrity through full workflow', () => {
    const chunks = createTestChunks();

    // Analyze
    const analysis = manager.analyzePositions(chunks);
    expect(analysis.totalChunks).toBe(chunks.length);

    // Reorder
    const strategy: ReorderingStrategy = {
      name: 'importance_first',
      description: 'Sort by importance',
    };
    const result = manager.reorder(chunks, strategy);

    // Verify all chunks preserved
    expect(result.chunks.length).toBe(chunks.length);
    const originalIds = new Set(chunks.map((c) => c.id));
    const reorderedIds = new Set(result.chunks.map((c) => c.id));
    expect(reorderedIds).toEqual(originalIds);

    // Verify all content preserved
    const originalContent = new Set(chunks.map((c) => c.content));
    const reorderedContent = new Set(result.chunks.map((c) => c.content));
    expect(reorderedContent).toEqual(originalContent);
  });
});
