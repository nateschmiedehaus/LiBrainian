import { describe, expect, it, vi } from 'vitest';
import type { ContextPack, LibrarianVersion } from '../../types.js';
import { canAnswerFromSummaries, createQuickAnswer, synthesizeQueryAnswer } from '../query_synthesis.js';

const chatMock = vi.hoisted(() => vi.fn());

vi.mock('../../adapters/llm_service.js', () => ({
  resolveLlmServiceAdapter: () => ({ chat: chatMock }),
}));

vi.mock('../llm_env.js', () => ({
  resolveLibrarianModelConfigWithDiscovery: vi.fn(async () => ({
    provider: 'codex',
    modelId: 'gpt-5-codex',
  })),
}));

vi.mock('../provider_check.js', () => ({
  requireProviders: vi.fn(async () => undefined),
}));

const baseVersion: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp',
  indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

const samplePack: ContextPack = {
  packId: 'pack-1',
  packType: 'module_context',
  targetId: 'src/example.ts',
  summary: 'Example module summary.',
  keyFacts: ['Fact one'],
  codeSnippets: [],
  relatedFiles: ['src/example.ts'],
  confidence: 0.8,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: baseVersion,
  invalidationTriggers: [],
};

describe('synthesizeQueryAnswer', () => {
  it('coerces plain-text synthesis after retries without unverified markers', async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue({
      content: '**Architecture Overview**\n- Boundary A\n- Boundary B',
    });

    const result = await synthesizeQueryAnswer({
      query: { intent: 'Map architecture boundaries', depth: 'L1' },
      packs: [samplePack],
      storage: {} as never,
      workspace: process.cwd(),
    });

    expect(result.synthesized).toBe(true);
    if (result.synthesized) {
      expect(result.answer).toContain('Architecture Overview');
      expect(result.uncertainties.some((entry) => entry.includes('unverified_by_trace'))).toBe(false);
      expect(result.uncertainties[0]).toContain('synthesis_format_non_json');
    }
    expect(chatMock).toHaveBeenCalledTimes(3);
  });

  it('sanitizes uncertainty text from JSON synthesis payload', async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        answer: 'Architecture is layered.',
        keyInsights: ['Layered boundaries'],
        citations: [],
        uncertainties: [
          'unverified_by_trace(synthesis_missing_answer): structure uncertain',
        ],
        confidence: 0.7,
      }),
    });

    const result = await synthesizeQueryAnswer({
      query: { intent: 'Describe architecture', depth: 'L1' },
      packs: [samplePack],
      storage: {} as never,
      workspace: process.cwd(),
    });

    expect(result.synthesized).toBe(true);
    if (result.synthesized) {
      expect(result.uncertainties.some((entry) => entry.includes('unverified_by_trace'))).toBe(false);
      expect(result.uncertainties[0]).toContain('structure uncertain');
    }
  });

  it('retries malformed synthesis output and accepts valid JSON on subsequent attempt', async () => {
    chatMock.mockReset();
    chatMock
      .mockResolvedValueOnce({ content: 'not-json' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          answer: 'Layered architecture with explicit module boundaries.',
          keyInsights: ['Layered boundaries', 'Module contracts'],
          citations: [{ packId: 'pack-1', content: 'Example module summary.', relevance: 0.91 }],
          uncertainties: [],
          confidence: 0.91,
        }),
      });

    const result = await synthesizeQueryAnswer({
      query: { intent: 'Explain architecture with confidence', depth: 'L1' },
      packs: [samplePack],
      storage: {} as never,
      workspace: process.cwd(),
    });

    expect(result.synthesized).toBe(true);
    if (result.synthesized) {
      expect(result.answer).toContain('Layered architecture');
      expect(result.citations).toHaveLength(1);
      expect(result.confidence).toBeGreaterThan(0.8);
    }
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('passes per-query LLM timeout budget to adapter calls', async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        answer: 'Layered architecture with explicit module boundaries.',
        keyInsights: ['Layered boundaries', 'Module contracts'],
        citations: [{ packId: 'pack-1', content: 'Example module summary.', relevance: 0.91 }],
        uncertainties: [],
        confidence: 0.91,
      }),
    });

    const result = await synthesizeQueryAnswer({
      query: { intent: 'Explain architecture with confidence', depth: 'L1' },
      packs: [samplePack],
      storage: {} as never,
      workspace: process.cwd(),
      llmTimeoutMs: 1_234,
    });

    expect(result.synthesized).toBe(true);
    const firstCall = chatMock.mock.calls[0]?.[0] as { timeoutMs?: number } | undefined;
    expect(firstCall?.timeoutMs).toBe(1_234);
  });
});

describe('quick synthesis heuristics', () => {
  it('allows summary-only answers for location queries when packs are confident', () => {
    const result = canAnswerFromSummaries(
      { intent: 'Where is query synthesis executed?', depth: 'L1' },
      [samplePack]
    );
    expect(result).toBe(true);
  });

  it('allows summary-only answers for broad codebase queries when packs are confident', () => {
    const result = canAnswerFromSummaries(
      { intent: 'How are errors handled across the codebase?', depth: 'L1' },
      [samplePack]
    );
    expect(result).toBe(true);
  });

  it('allows summary-only answers for broad codebase queries with distributed moderate-confidence packs', () => {
    const result = canAnswerFromSummaries(
      { intent: 'How are errors handled across the codebase?', depth: 'L1' },
      [
        {
          ...samplePack,
          packId: 'pack-a',
          relatedFiles: ['src/cli/errors.ts'],
          confidence: 0.34,
          summary: 'CLI commands normalize operational failures into structured user-facing errors.',
          keyFacts: ['CLI errors are rendered through a structured envelope.'],
        },
        {
          ...samplePack,
          packId: 'pack-b',
          relatedFiles: ['src/core/errors.ts'],
          confidence: 0.31,
          summary: 'Core services define the shared typed error hierarchy used across modules.',
          keyFacts: ['Core errors define typed domain failures.'],
        },
      ]
    );

    expect(result).toBe(true);
  });

  it('emits a location-focused quick answer for where-is intents', () => {
    const answer = createQuickAnswer(
      { intent: 'Where is query synthesis executed?', depth: 'L1' },
      [
        {
          ...samplePack,
          packId: 'pack-distractor',
          targetId: 'src/api/query_cache_response_utils.ts',
          relatedFiles: ['src/api/query_cache_response_utils.ts'],
          summary: 'Cache response helpers for query output serialization.',
          confidence: 0.97,
        },
        samplePack,
        {
          ...samplePack,
          packId: 'pack-2',
          targetId: 'src/api/query.ts',
          relatedFiles: ['src/api/query.ts'],
          confidence: 0.95,
          summary: 'Query synthesis execution and stage orchestration live in query.ts.',
          keyFacts: ['query.ts runs the synthesis stage for query responses.'],
        },
      ]
    );
    expect(answer.answer.toLowerCase()).toContain('query synthesis executed');
    expect(answer.answer).toContain('src/api/query.ts');
    expect(answer.synthesized).toBe(true);
  });

  it('prefers snippet and target source files over transitive related files in location answers', () => {
    const answer = createQuickAnswer(
      { intent: 'Where is the query pipeline implemented?', depth: 'L1' },
      [
        {
          ...samplePack,
          targetId: '/tmp/workspace/src/api/query.ts',
          relatedFiles: [
            'src/storage/types.js',
            'src/types.js',
          ],
          codeSnippets: [
            {
              filePath: '/tmp/workspace/src/api/query.ts',
              startLine: 1,
              endLine: 5,
              content: 'export function queryLibrarian() {}',
              language: 'typescript',
            },
          ],
        },
      ]
    );

    expect(answer.answer).toContain('src/api/query.ts');
    expect(answer.answer).not.toContain('src/storage/types.js');
  });

  it('emits a multi-file summary for generic quick answers', () => {
    const answer = createQuickAnswer(
      { intent: 'How are errors handled across the codebase?', depth: 'L1' },
      [
        {
          ...samplePack,
          relatedFiles: ['src/cli/errors.ts'],
          keyFacts: ['Structured error envelope for agents'],
        },
        {
          ...samplePack,
          packId: 'pack-2',
          relatedFiles: ['src/core/errors.ts'],
          keyFacts: ['Typed error hierarchy'],
          confidence: 0.79,
        },
      ]
    );

    expect(answer.answer).toContain('src/cli/errors.ts');
    expect(answer.answer).toContain('Structured error envelope for agents');
    expect(answer.synthesized).toBe(true);
  });

  it('emits a distributed cross-cutting summary for broad codebase queries', () => {
    const answer = createQuickAnswer(
      { intent: 'How are errors handled across the codebase?', depth: 'L1' },
      [
        {
          ...samplePack,
          packId: 'pack-a',
          relatedFiles: ['src/cli/errors.ts'],
          confidence: 0.34,
          keyFacts: ['CLI errors are rendered through a structured envelope.'],
        },
        {
          ...samplePack,
          packId: 'pack-b',
          relatedFiles: ['src/core/errors.ts'],
          confidence: 0.31,
          keyFacts: ['Core errors define typed domain failures.'],
        },
      ]
    );

    expect(answer.answer).toContain('errors are handled across');
    expect(answer.answer).toContain('src/cli/errors.ts');
    expect(answer.answer).toContain('CLI errors are rendered through a structured envelope.');
  });
});
