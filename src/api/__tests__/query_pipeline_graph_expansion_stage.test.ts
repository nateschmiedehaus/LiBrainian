import { describe, expect, it, vi } from 'vitest';

import { runGraphExpansionStage } from '../query_pipeline_graph_expansion_stage.js';
import { createStageTracker } from '../query_stage_reporting.js';
import type { LibrarianStorage } from '../../storage/types.js';

describe('query pipeline graph expansion stage', () => {
  it('expands graph neighbors, reapplies metrics after merge, and records co-change explanations', async () => {
    const storage = {
      getMetadata: vi.fn().mockResolvedValue({ workspace: '/tmp/workspace' }),
      getGraphMetrics: vi.fn().mockResolvedValue([
        {
          entityId: 'fn-1',
          entityType: 'function',
          pagerank: 0.8,
          betweenness: 0.9,
          closeness: 0.9,
          eigenvector: 0.9,
          communityId: 1,
          isBridge: false,
          computedAt: '2026-03-19T00:00:00.000Z',
        },
        {
          entityId: 'fn-2',
          entityType: 'function',
          pagerank: 0.7,
          betweenness: 0.9,
          closeness: 0.9,
          eigenvector: 0.9,
          communityId: 1,
          isBridge: false,
          computedAt: '2026-03-19T00:00:00.000Z',
        },
        {
          entityId: 'fn-3',
          entityType: 'function',
          pagerank: 0.6,
          betweenness: 0.9,
          closeness: 0.9,
          eigenvector: 0.9,
          communityId: 2,
          isBridge: true,
          computedAt: '2026-03-19T00:00:00.000Z',
        },
      ]),
      getFunction: vi.fn(async (entityId: string) => ({
        filePath: entityId === 'fn-2' ? 'src/expanded.ts' : entityId === 'fn-3' ? 'src/neighbor.ts' : 'src/root.ts',
        confidence: entityId === 'fn-1' ? 0.8 : 0.7,
        lastAccessed: new Date('2026-03-18T00:00:00.000Z'),
      })),
      getCochangeEdges: vi.fn(async ({ fileB }: { fileA: string; fileB: string; limit: number }) => (
        fileB === 'src/expanded.ts' || fileB === 'src/neighbor.ts'
          ? [{ strength: 0.55 }]
          : []
      )),
    } as unknown as LibrarianStorage;
    const tracker = createStageTracker();
    const explanationParts: string[] = [];

    const candidates = await runGraphExpansionStage({
      storage,
      query: { intent: 'expand graph', depth: 'L2' },
      candidates: [
        {
          entityId: 'fn-1',
          entityType: 'function',
          path: 'src/root.ts',
          semanticSimilarity: 0.95,
          confidence: 0.8,
          recency: 0.8,
          pagerank: 0,
          centrality: 0,
          communityId: null,
        },
      ],
      stageTracker: tracker,
      recordCoverageGap: vi.fn(),
      capabilities: {
        core: { getFunctions: true, getFiles: true, getContextPacks: true },
        optional: { graphMetrics: true, multiVectors: false, embeddings: true, episodes: true, verificationPlans: true },
      },
      explanationParts,
      directPacks: [
        {
          packId: 'pack-1',
          packType: 'module_context',
          targetId: 'mod-1',
          summary: 'direct pack',
          keyFacts: [],
          codeSnippets: [],
          relatedFiles: ['src/anchor.ts'],
          confidence: 0.7,
          createdAt: new Date('2026-03-19T00:00:00.000Z'),
          accessCount: 0,
          lastOutcome: 'unknown',
          successCount: 0,
          failureCount: 0,
          version: {
            major: 1,
            minor: 0,
            patch: 0,
            string: '1.0.0',
            qualityTier: 'mvp',
            indexedAt: new Date('2026-03-19T00:00:00.000Z'),
            indexerVersion: 'test',
            features: [],
          },
          invalidationTriggers: [],
        },
      ],
    });

    expect(candidates.map((candidate) => candidate.entityId)).toEqual(
      expect.arrayContaining(['fn-1', 'fn-2', 'fn-3'])
    );
    expect(candidates.find((candidate) => candidate.entityId === 'fn-2')?.pagerank).toBe(0.7);
    expect(candidates.find((candidate) => candidate.entityId === 'fn-2')?.cochange).toBe(0.55);
    expect(candidates.find((candidate) => candidate.entityId === 'fn-3')?.graphSimilarity).toBeGreaterThan(0.8);
    expect(explanationParts).toEqual(expect.arrayContaining([
      'Added 1 community neighbors.',
      'Added 1 graph-similar entities.',
      'Applied co-change boosts for 2 candidates.',
    ]));

    const graphStage = tracker.report().find((stage) => stage.stage === 'graph_expansion');
    expect(graphStage?.status).toBe('success');
    expect(graphStage?.results.outputCount).toBe(2);
  });

  it('skips cleanly and records a coverage gap when graph metrics are unavailable', async () => {
    const recordCoverageGap = vi.fn();
    const tracker = createStageTracker();

    const candidates = await runGraphExpansionStage({
      storage: {} as LibrarianStorage,
      query: { intent: 'expand graph', depth: 'L1' },
      candidates: [
        {
          entityId: 'fn-1',
          entityType: 'function',
          semanticSimilarity: 0.95,
          confidence: 0.8,
          recency: 0.8,
          pagerank: 0,
          centrality: 0,
          communityId: null,
        },
      ],
      stageTracker: tracker,
      recordCoverageGap,
      capabilities: {
        core: { getFunctions: true, getFiles: true, getContextPacks: true },
        optional: { graphMetrics: false, multiVectors: false, embeddings: true, episodes: true, verificationPlans: true },
      },
      explanationParts: [],
      directPacks: [],
    });

    expect(candidates).toHaveLength(1);
    expect(recordCoverageGap).toHaveBeenCalledWith(
      'graph_expansion',
      expect.stringContaining('Graph metrics unavailable'),
      'moderate',
      expect.stringContaining('Re-run bootstrap'),
    );
    const graphStage = tracker.report().find((stage) => stage.stage === 'graph_expansion');
    expect(graphStage?.status).toBe('skipped');
  });
});
