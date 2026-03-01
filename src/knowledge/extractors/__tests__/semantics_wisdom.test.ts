import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();

vi.mock('../../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: () => ({
    chat: chatMock,
  }),
}));

vi.mock('../../../api/llm_env.js', () => ({
  resolveLibrarianModelId: () => 'test-model',
}));

vi.mock('../llm_evidence.js', () => ({
  buildLlmEvidence: vi.fn(async () => ({
    provider: 'codex',
    modelId: 'test-model',
    promptDigest: 'digest',
    timestamp: '2026-01-01T00:00:00.000Z',
  })),
}));

describe('semantics extractor wisdom', () => {
  beforeEach(() => {
    chatMock.mockReset();
  });

  it('parses optional wisdom fields from LLM output', async () => {
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        purpose: {
          summary: 'Normalizes workspace paths before indexing.',
          explanation: 'Ensures platform-independent key stability.',
          problemSolved: 'Path separator variance across environments.',
          valueProp: 'Stable joins for cache and retrieval maps.',
        },
        domain: {
          concepts: ['path canonicalization'],
          boundedContext: 'indexing',
          businessRules: ['all keys must use normalized separators'],
        },
        intent: {
          primaryUseCase: 'Normalize paths before persistence.',
          secondaryUseCases: [],
          antiUseCases: [],
        },
        mechanism: {
          explanation: 'Applies canonical separators and trims redundant prefixes.',
          algorithm: 'string normalization',
          approach: 'deterministic rewrite',
          patterns: ['normalization'],
        },
        complexity: {
          time: 'O(n)',
          space: 'O(n)',
          cognitive: 'simple',
        },
        wisdom: {
          gotchas: ['Mixed separators can produce cache misses.'],
          tips: ['Normalize once at boundaries, not repeatedly in loops.'],
          tribal: ['Historical incidents came from Windows/Linux path drift.'],
          learningPath: [{ order: 1, description: 'Understand canonical path format.' }],
        },
      }),
    });

    const { extractSemanticsWithLLM } = await import('../semantics.js');
    const result = await extractSemanticsWithLLM(
      {
        name: 'normalizePath',
        filePath: '/tmp/example.ts',
        content: 'export function normalizePath(v: string) { return v; }',
      },
      {
        llmProvider: 'codex',
      },
    );

    expect(result.semantics.purpose.summary).toContain('Normalizes workspace paths');
    expect(result.wisdom?.gotchas.map((item) => item.description)).toContain(
      'Mixed separators can produce cache misses.',
    );
    expect(result.wisdom?.tips.map((item) => item.description)).toContain(
      'Normalize once at boundaries, not repeatedly in loops.',
    );
    expect(result.wisdom?.tribal.map((item) => item.knowledge)).toContain(
      'Historical incidents came from Windows/Linux path drift.',
    );
    expect(result.wisdom?.learningPath.map((item) => item.description)).toContain(
      'Understand canonical path format.',
    );
  });
});
