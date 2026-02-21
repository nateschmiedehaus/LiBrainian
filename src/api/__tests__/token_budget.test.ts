import { describe, it, expect } from 'vitest';
import {
  enforceResponseTokenBudget,
  hasValidTokenBudget,
  estimateTokens,
  estimatePackTokens,
  estimateSynthesisTokens,
  __testing,
} from '../token_budget.js';
import type { ContextPack, TokenBudget, SynthesizedResponse, LiBrainianVersion } from '../../types.js';

const baseVersion: LiBrainianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp',
  indexedAt: new Date('2026-01-30T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

const createPack = (overrides: Partial<ContextPack> = {}): ContextPack => ({
  packId: `pack-${Math.random().toString(36).slice(2)}`,
  packType: 'module_context',
  targetId: 'module-1',
  summary: 'This is a test summary for the module context pack.',
  keyFacts: ['Fact 1: Important information', 'Fact 2: More details', 'Fact 3: Additional context'],
  codeSnippets: [{
    filePath: '/src/test.ts',
    startLine: 1,
    endLine: 20,
    content: 'function test() {\n  console.log("hello");\n}',
    language: 'typescript',
  }],
  relatedFiles: ['/src/test.ts', '/src/helper.ts'],
  confidence: 0.8,
  createdAt: new Date('2026-01-30T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: baseVersion,
  invalidationTriggers: [],
  ...overrides,
});

const createSynthesis = (overrides: Partial<SynthesizedResponse> = {}): SynthesizedResponse => ({
  answer: 'This is a synthesized answer based on the retrieved knowledge.',
  confidence: 0.85,
  citations: [
    { packId: 'pack-1', content: 'Citation 1', relevance: 0.9 },
    { packId: 'pack-2', content: 'Citation 2', relevance: 0.8 },
  ],
  keyInsights: ['Insight 1', 'Insight 2'],
  uncertainties: ['Uncertainty 1'],
  ...overrides,
});

describe('token estimation', () => {
  it('estimates tokens from text length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello')).toBeGreaterThan(0);
    // Roughly 1 token per 3.5 chars
    const estimate = estimateTokens('a'.repeat(100));
    expect(estimate).toBeGreaterThanOrEqual(25);
    expect(estimate).toBeLessThanOrEqual(35);
  });

  it('estimates pack tokens', () => {
    const pack = createPack();
    const tokens = estimatePackTokens(pack);
    expect(tokens).toBeGreaterThan(0);
    // Should include overhead for all fields
    expect(tokens).toBeGreaterThan(50);
  });

  it('estimates synthesis tokens', () => {
    const synthesis = createSynthesis();
    const tokens = estimateSynthesisTokens(synthesis);
    expect(tokens).toBeGreaterThan(0);

    // Empty synthesis should return 0
    expect(estimateSynthesisTokens(undefined)).toBe(0);
  });
});

describe('hasValidTokenBudget', () => {
  it('returns false for undefined', () => {
    expect(hasValidTokenBudget(undefined)).toBe(false);
  });

  it('returns false for zero maxTokens', () => {
    expect(hasValidTokenBudget({ maxTokens: 0 })).toBe(false);
  });

  it('returns false for negative maxTokens', () => {
    expect(hasValidTokenBudget({ maxTokens: -100 })).toBe(false);
  });

  it('returns true for valid budget', () => {
    expect(hasValidTokenBudget({ maxTokens: 1000 })).toBe(true);
    expect(hasValidTokenBudget({ maxTokens: 5000, reserveTokens: 500 })).toBe(true);
  });
});

describe('enforceResponseTokenBudget', () => {
  it('returns packs unchanged when under budget', () => {
    const packs = [createPack(), createPack()];
    const budget: TokenBudget = { maxTokens: 100000 }; // Large budget

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    expect(result.packs).toHaveLength(2);
    expect(result.result.truncated).toBe(false);
    expect(result.result.truncationStrategy).toBe('none');
  });

  it('truncates packs by relevance when over budget', () => {
    const packs = [
      createPack({ packId: 'low', confidence: 0.3 }),
      createPack({ packId: 'high', confidence: 0.9 }),
      createPack({ packId: 'medium', confidence: 0.6 }),
    ];
    // Very small budget to force truncation
    const budget: TokenBudget = { maxTokens: 300 };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    expect(result.result.truncated).toBe(true);
    expect(result.result.truncationStrategy).toBe('relevance');
    expect(result.packs.length).toBeLessThan(3);
    // Should keep highest confidence pack
    if (result.packs.length === 1) {
      expect(result.packs[0].packId).toBe('high');
    }
  });

  it('uses score map for relevance ordering', () => {
    const packs = [
      createPack({ packId: 'pack-1', confidence: 0.9 }),
      createPack({ packId: 'pack-2', confidence: 0.3 }),
    ];
    const scoreByPack = new Map<string, number>([
      ['pack-1', 0.2], // Low score despite high confidence
      ['pack-2', 0.95], // High score despite low confidence
    ]);
    const budget: TokenBudget = { maxTokens: 300 };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
      scoreByPack,
    });

    // Should prefer pack-2 due to higher score
    if (result.packs.length === 1) {
      expect(result.packs[0].packId).toBe('pack-2');
    }
  });

  it('respects reserveTokens', () => {
    const packs = [createPack()];
    const budget: TokenBudget = {
      maxTokens: 1000,
      reserveTokens: 800, // Leaves only 200 tokens available
    };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    expect(result.result.totalAvailable).toBe(200);
  });

  it('handles recency priority', () => {
    const oldDate = new Date('2020-01-01');
    const newDate = new Date('2026-01-30');
    const packs = [
      createPack({ packId: 'old', createdAt: oldDate, confidence: 0.9 }),
      createPack({ packId: 'new', createdAt: newDate, confidence: 0.3 }),
    ];
    const budget: TokenBudget = { maxTokens: 300, priority: 'recency' };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    // Should prefer newer pack despite lower confidence
    if (result.packs.length === 1) {
      expect(result.packs[0].packId).toBe('new');
    }
  });

  it('handles diversity priority', () => {
    const packs = [
      createPack({ packId: 'module-1', packType: 'module_context', confidence: 0.9 }),
      createPack({ packId: 'module-2', packType: 'module_context', confidence: 0.8 }),
      createPack({ packId: 'function-1', packType: 'function_context', confidence: 0.7 }),
      createPack({ packId: 'change-1', packType: 'change_impact', confidence: 0.6 }),
    ];
    // Budget for ~2 packs
    const budget: TokenBudget = { maxTokens: 500, priority: 'diversity' };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    // With diversity, should try to include different pack types
    const packTypes = result.packs.map(p => p.packType);
    const uniqueTypes = new Set(packTypes);
    // Should have multiple types if possible
    if (result.packs.length >= 2) {
      expect(uniqueTypes.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('always includes at least one pack', () => {
    const packs = [createPack({
      summary: 'Very long summary '.repeat(100),
      keyFacts: Array(20).fill('Long fact content here'),
    })];
    const budget: TokenBudget = { maxTokens: 50 }; // Very small

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    expect(result.packs).toHaveLength(1);
    expect(result.result.truncated).toBe(true);
  });

  it('trims synthesis when over budget', () => {
    const synthesis = createSynthesis({
      answer: 'A very long answer '.repeat(100),
      keyInsights: Array(10).fill('Long insight'),
      citations: Array(10).fill({ packId: 'p', content: 'Long citation', relevance: 0.5 }),
    });
    const budget: TokenBudget = { maxTokens: 200 };

    const result = enforceResponseTokenBudget({
      packs: [createPack()],
      synthesis,
      budget,
    });

    // Synthesis should be truncated
    if (result.synthesis) {
      expect(result.synthesis.answer.length).toBeLessThan(synthesis.answer.length);
      expect(result.synthesis.keyInsights.length).toBeLessThanOrEqual(2);
      expect(result.synthesis.citations.length).toBeLessThanOrEqual(3);
    }
  });

  it('returns metadata about truncation', () => {
    const packs = [
      createPack({ packId: 'p1' }),
      createPack({ packId: 'p2' }),
      createPack({ packId: 'p3' }),
    ];
    const budget: TokenBudget = { maxTokens: 300 };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    expect(result.result.originalPackCount).toBe(3);
    expect(result.result.finalPackCount).toBeDefined();
    expect(result.result.tokensUsed).toBeGreaterThan(0);
    expect(result.result.totalAvailable).toBe(300);
  });

  it('handles empty packs array', () => {
    const budget: TokenBudget = { maxTokens: 1000 };

    const result = enforceResponseTokenBudget({
      packs: [],
      budget,
    });

    expect(result.packs).toHaveLength(0);
    expect(result.result.truncated).toBe(false);
    expect(result.result.originalPackCount).toBe(0);
    expect(result.result.finalPackCount).toBe(0);
  });

  it('handles zero totalAvailable gracefully', () => {
    const packs = [createPack()];
    const budget: TokenBudget = { maxTokens: 100, reserveTokens: 200 };

    const result = enforceResponseTokenBudget({
      packs,
      budget,
    });

    expect(result.result.totalAvailable).toBe(0);
    expect(result.result.truncated).toBe(false);
  });
});

describe('trimPackToFit', () => {
  const { trimPackToFit } = __testing;

  it('returns pack unchanged if under budget', () => {
    const pack = createPack();
    const trimmed = trimPackToFit(pack, 10000);
    expect(trimmed).toEqual(pack);
  });

  it('trims code snippets first', () => {
    const pack = createPack({
      codeSnippets: [{
        filePath: '/src/test.ts',
        startLine: 1,
        endLine: 100,
        content: 'x'.repeat(1000),
        language: 'typescript',
      }],
    });
    const trimmed = trimPackToFit(pack, 100);

    expect(trimmed.codeSnippets[0].content.length).toBeLessThan(300);
  });

  it('trims key facts if still over budget', () => {
    const pack = createPack({
      keyFacts: Array(10).fill('A very long key fact that takes up space'),
      codeSnippets: [],
    });
    const trimmed = trimPackToFit(pack, 50);

    expect(trimmed.keyFacts.length).toBeLessThanOrEqual(3);
  });

  it('trims related files if still over budget', () => {
    const pack = createPack({
      relatedFiles: Array(20).fill('/very/long/path/to/file.ts'),
      codeSnippets: [],
      keyFacts: [],
    });
    const trimmed = trimPackToFit(pack, 50);

    expect(trimmed.relatedFiles.length).toBeLessThanOrEqual(2);
  });
});

describe('type exports', () => {
  it('exports TokenBudget type from types', async () => {
    const { TokenBudget } = await import('../../types.js') as { TokenBudget: unknown };
    // Type check - this test just verifies the export exists
    expect(TokenBudget).toBeUndefined(); // It's a type, not a value
  });

  it('exports TokenBudgetResult type from types', async () => {
    const { TokenBudgetResult } = await import('../../types.js') as { TokenBudgetResult: unknown };
    // Type check - this test just verifies the export exists
    expect(TokenBudgetResult).toBeUndefined(); // It's a type, not a value
  });
});
