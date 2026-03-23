import { describe, expect, it, vi } from 'vitest';

import { runCandidatePackStage } from '../query_pipeline_candidate_pack_stage.js';
import { createStageTracker } from '../query_stage_reporting.js';
import type { ContextPack } from '../../types.js';
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

const createPack = (overrides: Partial<ContextPack>): ContextPack => ({
  packId: 'pack-1',
  packType: 'module_context',
  targetId: 'module-1',
  summary: 'Summary',
  keyFacts: [],
  codeSnippets: [],
  relatedFiles: ['src/api/query.ts'],
  confidence: 0.6,
  createdAt: new Date('2026-03-19T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: baseVersion,
  invalidationTriggers: [],
  ...overrides,
});

describe('query pipeline candidate pack stage', () => {
  it('uses filesystem fallback when candidate packs are unavailable', async () => {
    const tracker = createStageTracker();
    const explanationParts: string[] = [];

    const result = await runCandidatePackStage({
      storage: {
        getContextPacks: vi.fn().mockResolvedValue([]),
      } as unknown as LibrarianStorage,
      query: { intent: 'find seam files', depth: 'L1' },
      workspaceRoot: '/tmp/workspace',
      candidates: [],
      directPacks: [],
      candidateScoreMap: new Map(),
      stageTracker: tracker,
      recordCoverageGap: vi.fn(),
      explanationParts,
      version: baseVersion,
      collectCandidatePacksFn: vi.fn().mockResolvedValue([]),
      dedupePacksFn: (packs) => packs,
      collectFilesystemFallbackPacksFn: vi.fn().mockResolvedValue([
        createPack({ packId: 'fs-pack' }),
      ]),
      rankHeuristicFallbackPacksFn: (packs) => packs,
      scoreAnchoredDirectPackFn: vi.fn().mockReturnValue(0),
      filterPacksToWorkspaceFn: (packs) => ({ packs, dropped: 0 }),
    });

    expect(result.usedFilesystemFallback).toBe(true);
    expect(result.allPacks).toHaveLength(1);
    expect(explanationParts).toContain('Applied filesystem lexical fallback because indexed packs were unavailable.');
    const fallbackStage = tracker.report().find((stage) => stage.stage === 'fallback');
    expect(fallbackStage?.status).toBe('success');
  });

  it('records and explains workspace filtering after candidate selection', async () => {
    const tracker = createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = vi.fn();
    const candidateScoreMap = new Map<string, number>();
    const directPack = createPack({ packId: 'direct-pack', targetId: 'direct-target' });

    const result = await runCandidatePackStage({
      storage: {
        getContextPacks: vi.fn().mockResolvedValue([]),
      } as unknown as LibrarianStorage,
      query: { intent: 'find seam files', depth: 'L1' },
      workspaceRoot: '/tmp/workspace',
      candidates: [],
      directPacks: [directPack],
      candidateScoreMap,
      stageTracker: tracker,
      recordCoverageGap,
      explanationParts,
      version: baseVersion,
      collectCandidatePacksFn: vi.fn().mockResolvedValue([]),
      dedupePacksFn: (packs) => packs,
      collectFilesystemFallbackPacksFn: vi.fn().mockResolvedValue([]),
      rankHeuristicFallbackPacksFn: (packs) => packs,
      scoreAnchoredDirectPackFn: vi.fn().mockReturnValue(1.2),
      filterPacksToWorkspaceFn: () => ({ packs: [directPack], dropped: 2 }),
    });

    expect(result.allPacks).toEqual([directPack]);
    expect(candidateScoreMap.get('direct-target')).toBe(1.2);
    expect(recordCoverageGap).toHaveBeenCalledWith(
      'post_processing',
      expect.stringContaining('Filtered 2 context packs'),
      'significant',
      expect.stringContaining('bootstrap --force --mode fast'),
    );
    expect(explanationParts).toContain('Filtered 2 out-of-workspace packs.');
  });
});
