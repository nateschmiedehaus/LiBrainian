import { describe, expect, it, vi } from 'vitest';

import { runSemanticRetrievalStage } from '../query_pipeline_semantic_retrieval_stage.js';
import { createStageTracker } from '../query_stage_reporting.js';
import type { LibrarianStorage } from '../../storage/types.js';

const baseVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp' as const,
  indexedAt: new Date('2026-03-19T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

describe('query pipeline semantic retrieval stage', () => {
  it('records a prewarm gap and skips retrieval when cold-start structural mode is active', async () => {
    const recordCoverageGap = vi.fn();
    const tracker = createStageTracker();
    const preloadEmbeddingModelFn = vi.fn().mockResolvedValue(undefined);

    const result = await runSemanticRetrievalStage({
      storage: {} as LibrarianStorage,
      query: { intent: 'find query flow', depth: 'L1', coldStartStructuralOnly: true },
      embeddingService: {} as never,
      governor: {} as never,
      stageTracker: tracker,
      recordCoverageGap,
      capabilities: {
        core: { getFunctions: true, getFiles: true, getContextPacks: true },
        optional: { graphMetrics: true, multiVectors: false, embeddings: true, episodes: true, verificationPlans: true },
      },
      version: baseVersion,
      embeddingAvailable: true,
      isModelLoadedFn: () => false,
      preloadEmbeddingModelFn,
      logWarningFn: vi.fn(),
      resolveQueryEmbeddingsFn: vi.fn(),
      classifyQueryIntentFn: vi.fn(),
      applyIntentTypeRoutingOverridesFn: vi.fn(),
      fuseSimilarityResultListsWithRrfFn: vi.fn(),
      applyDocumentBiasFn: vi.fn(),
      applyDefinitionBiasFn: vi.fn(),
      hydrateCandidatesFn: vi.fn(),
      injectFilenameCandidatesFn: vi.fn(),
      extractIntentAnchorPathsFn: vi.fn(),
    });

    expect(preloadEmbeddingModelFn).toHaveBeenCalledTimes(1);
    expect(recordCoverageGap).toHaveBeenCalledWith(
      'semantic_retrieval',
      expect.stringContaining('prewarms'),
      'minor',
      expect.stringContaining('Retry query after prewarm'),
    );
    expect(result.candidates).toEqual([]);
    const semanticStage = tracker.report().find((stage) => stage.stage === 'semantic_retrieval');
    expect(semanticStage?.status).toBe('partial');
  });

  it('surfaces embedding-unavailable diagnostics without attempting retrieval', async () => {
    const recordCoverageGap = vi.fn();
    const tracker = createStageTracker();

    const result = await runSemanticRetrievalStage({
      storage: {} as LibrarianStorage,
      query: { intent: 'find query flow', depth: 'L1' },
      embeddingService: {} as never,
      governor: {} as never,
      stageTracker: tracker,
      recordCoverageGap,
      capabilities: {
        core: { getFunctions: true, getFiles: true, getContextPacks: true },
        optional: { graphMetrics: true, multiVectors: false, embeddings: true, episodes: true, verificationPlans: true },
      },
      version: baseVersion,
      embeddingAvailable: false,
      isModelLoadedFn: () => true,
      preloadEmbeddingModelFn: vi.fn(),
      logWarningFn: vi.fn(),
      resolveQueryEmbeddingsFn: vi.fn(),
      classifyQueryIntentFn: vi.fn(),
      applyIntentTypeRoutingOverridesFn: vi.fn(),
      fuseSimilarityResultListsWithRrfFn: vi.fn(),
      applyDocumentBiasFn: vi.fn(),
      applyDefinitionBiasFn: vi.fn(),
      hydrateCandidatesFn: vi.fn(),
      injectFilenameCandidatesFn: vi.fn().mockResolvedValue({ candidates: [], added: 0 }),
      extractIntentAnchorPathsFn: vi.fn().mockReturnValue([]),
    });

    expect(result.diagnostics.embeddingUnavailable).toBe(true);
    expect(recordCoverageGap).toHaveBeenCalledWith(
      'semantic_retrieval',
      'Embedding provider unavailable.',
      'significant',
      'Authenticate a live embedding provider.',
    );
    expect(result.candidates).toEqual([]);
    const semanticStage = tracker.report().find((stage) => stage.stage === 'semantic_retrieval');
    expect(semanticStage?.status).toBe('partial');
  });
});
