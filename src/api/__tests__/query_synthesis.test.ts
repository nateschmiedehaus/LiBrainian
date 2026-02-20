import { describe, expect, it, vi } from 'vitest';
import type { ContextPack, LibrarianVersion } from '../../types.js';
import { synthesizeQueryAnswer } from '../query_synthesis.js';

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
});
