import { describe, it, expect, vi } from 'vitest';
import { __testing, getQueryPipelineStages, queryLibrarianWithObserver } from '../query.js';
import type { ContextPack, StageIssueSeverity, StageName } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { GovernorContext } from '../governor_context.js';

const baseVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp' as const,
  indexedAt: new Date('2026-01-19T00:00:00.000Z'),
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
  relatedFiles: ['src/auth.ts'],
  confidence: 0.6,
  createdAt: new Date('2026-01-19T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: baseVersion,
  invalidationTriggers: [],
  ...overrides,
});

describe('query pipeline definition', () => {
  it('exposes the expected stage order', () => {
    const stages = getQueryPipelineStages().map((stage) => stage.stage);
    expect(stages).toEqual([
      'adequacy_scan',
      'direct_packs',
      'semantic_retrieval',
      'graph_expansion',
      'multi_signal_scoring',
      'multi_vector_scoring',
      'fallback',
      'reranking',
      'defeater_check',
      'method_guidance',
      'synthesis',
      'post_processing',
    ]);
  });

  it('notifies observers when stages are finalized', () => {
    const seen: string[] = [];
    const tracker = __testing.createStageTracker((report) => {
      seen.push(report.stage);
    });
    const ctx = tracker.start('direct_packs', 1);
    tracker.finish(ctx, { outputCount: 1 });
    tracker.finalizeMissing(['synthesis']);
    expect(seen).toEqual(['direct_packs', 'synthesis']);
  });

  it('swallows observer errors and preserves internal reports', () => {
    const tracker = __testing.createStageTracker((report) => {
      report.status = 'failed';
      throw new Error('boom');
    });
    const ctx = tracker.start('direct_packs', 1);
    expect(() => tracker.finish(ctx, { outputCount: 1 })).not.toThrow();
    tracker.finalizeMissing(['synthesis']);
    const stored = tracker.report().find((stage) => stage.stage === 'direct_packs');
    expect(stored?.status).toBe('success');
  });

  it('rejects non-function observers early', async () => {
    const storage = {} as LibrarianStorage;
    await expect(
      queryLibrarianWithObserver({ intent: 'test', depth: 'L0' }, storage, {
        onStage: 'nope' as unknown as () => void,
      })
    ).rejects.toThrow(/onStage must be a function/);
  });

  it('falls back when rerank output is invalid', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const packs = [createPack({ packId: 'pack-a' }), createPack({ packId: 'pack-b', targetId: 'module-2' })];
    const reranked = await __testing.runRerankStage({
      query: { intent: 'test rerank', depth: 'L2' },
      finalPacks: packs,
      candidateScoreMap: new Map(),
      stageTracker,
      explanationParts: [],
      recordCoverageGap,
      forceRerank: true,
      rerank: vi.fn().mockResolvedValue([]),
    });

    expect(reranked).toEqual(packs);
    expect(coverageGaps[0]).toMatch(/invalid output/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.status).toBe('partial');
  });

  it('falls back when rerank returns mismatched pack IDs', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const packs = [createPack({ packId: 'pack-a' }), createPack({ packId: 'pack-b', targetId: 'module-2' })];
    const reranked = await __testing.runRerankStage({
      query: { intent: 'test rerank', depth: 'L2' },
      finalPacks: packs,
      candidateScoreMap: new Map(),
      stageTracker,
      explanationParts: [],
      recordCoverageGap,
      forceRerank: true,
      rerank: vi.fn().mockResolvedValue([createPack({ packId: 'pack-x' }), packs[1]]),
    });

    expect(reranked).toEqual(packs);
    expect(coverageGaps.join(' ')).toMatch(/mismatched packs/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.status).toBe('partial');
  });

  it('excludes packs when defeater checks fail', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const packs = [
      createPack({ packId: 'pack-a', targetId: 'module-a', relatedFiles: ['src/a.ts'] }),
      createPack({ packId: 'pack-b', targetId: 'module-b', relatedFiles: ['src/b.ts'] }),
    ];
    const checkDefeatersFn = vi.fn(async (_meta, context) => {
      if (context.entityId === 'module-a') {
        throw new Error('db offline');
      }
      return {
        totalDefeaters: 2,
        activeDefeaters: 0,
        results: [],
        knowledgeValid: true,
        confidenceAdjustment: 0,
      };
    });

    const result = await __testing.runDefeaterStage({
      storage: {} as LibrarianStorage,
      finalPacks: packs,
      stageTracker,
      recordCoverageGap,
      workspaceRoot: process.cwd(),
      checkDefeatersFn,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.packId).toBe('pack-b');
    expect(coverageGaps.join(' ')).toMatch(/defeater checks failed/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'defeater_check');
    expect(report?.status).toBe('partial');
  });

  it('resolves method guidance when config is present', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const resolveMethodGuidanceFn = vi.fn().mockResolvedValue({
      families: ['MF-01'],
      hints: ['Check the entry point'],
      source: 'llm',
    });
    const result = await __testing.runMethodGuidanceStage({
      query: { intent: 'test method guidance', depth: 'L1' },
      storage: {} as LibrarianStorage,
      governor: new GovernorContext({ phase: 'test' }),
      stageTracker,
      recordCoverageGap,
      synthesisEnabled: true,
      resolveMethodGuidanceFn,
      resolveLlmConfig: async () => ({ provider: 'claude', modelId: 'test-model' }),
    });

    expect(result?.hints).toEqual(['Check the entry point']);
    expect(resolveMethodGuidanceFn).toHaveBeenCalledTimes(1);
    const report = stageTracker.report().find((stage) => stage.stage === 'method_guidance');
    expect(report?.status).toBe('success');
    expect(coverageGaps).toHaveLength(0);
  });

  it('skips method guidance when config is missing', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const resolveMethodGuidanceFn = vi.fn();
    const result = await __testing.runMethodGuidanceStage({
      query: { intent: 'test method guidance', depth: 'L1' },
      storage: {} as LibrarianStorage,
      governor: new GovernorContext({ phase: 'test' }),
      stageTracker,
      recordCoverageGap,
      synthesisEnabled: true,
      resolveMethodGuidanceFn,
      resolveLlmConfig: async () => ({}),
    });

    expect(result).toBeNull();
    expect(resolveMethodGuidanceFn).not.toHaveBeenCalled();
    const report = stageTracker.report().find((stage) => stage.stage === 'method_guidance');
    expect(report?.status).toBe('partial');
  });

  it('skips method guidance when query disables it', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const resolveMethodGuidanceFn = vi.fn();
    const result = await __testing.runMethodGuidanceStage({
      query: { intent: 'test method guidance', depth: 'L1', disableMethodGuidance: true },
      storage: {} as LibrarianStorage,
      governor: new GovernorContext({ phase: 'test' }),
      stageTracker,
      recordCoverageGap,
      synthesisEnabled: true,
      resolveMethodGuidanceFn,
      resolveLlmConfig: async () => ({ provider: 'claude', modelId: 'test-model' }),
    });

    expect(result).toBeNull();
    expect(resolveMethodGuidanceFn).not.toHaveBeenCalled();
    const report = stageTracker.report().find((stage) => stage.stage === 'method_guidance');
    expect(report?.status).toBe('skipped');
  });

  it('records partial status when method guidance throws', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const resolveMethodGuidanceFn = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await __testing.runMethodGuidanceStage({
      query: { intent: 'test method guidance', depth: 'L1' },
      storage: {} as LibrarianStorage,
      governor: new GovernorContext({ phase: 'test' }),
      stageTracker,
      recordCoverageGap,
      synthesisEnabled: true,
      resolveMethodGuidanceFn,
      resolveLlmConfig: async () => ({ provider: 'claude', modelId: 'test-model' }),
    });

    expect(result).toBeNull();
    expect(coverageGaps[0]).toMatch(/boom/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'method_guidance');
    expect(report?.status).toBe('partial');
  });

  it('returns undefined when synthesis lacks a workspace root', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: ' ',
      resolveWorkspaceRootFn: async () => '',
    });

    expect(result).toBeUndefined();
    expect(coverageGaps.join(' ')).toMatch(/workspace root/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('failed');
  });

  it('uses quick synthesis when summaries are sufficient', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const createQuickAnswerFn = vi.fn().mockReturnValue({
      answer: 'quick',
      confidence: 0.8,
      citations: ['pack-1'],
      keyInsights: ['insight'],
      uncertainties: [],
    });
    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      canAnswerFromSummariesFn: () => true,
      createQuickAnswerFn,
      synthesizeQueryAnswerFn: vi.fn(),
    });

    expect(result?.answer).toBe('quick');
    expect(createQuickAnswerFn).toHaveBeenCalledTimes(1);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('success');
  });

  it('forces summary synthesis without full LLM call when requested', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const createQuickAnswerFn = vi.fn().mockReturnValue({
      answer: 'forced-quick',
      confidence: 0.7,
      citations: ['pack-1'],
      keyInsights: ['insight'],
      uncertainties: [],
    });
    const synthesizeQueryAnswerFn = vi.fn().mockResolvedValue({
      synthesized: true,
      answer: 'full',
      confidence: 0.5,
      citations: ['pack-1'],
      keyInsights: ['insight'],
      uncertainties: [],
    });
    const result = await __testing.runSynthesisStage({
      query: { intent: 'explain architecture map', depth: 'L1', forceSummarySynthesis: true },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      canAnswerFromSummariesFn: () => false,
      createQuickAnswerFn,
      synthesizeQueryAnswerFn,
    });

    expect(result?.answer).toBe('forced-quick');
    expect(createQuickAnswerFn).toHaveBeenCalledTimes(1);
    expect(synthesizeQueryAnswerFn).not.toHaveBeenCalled();
  });

  it('uses full synthesis when summaries are insufficient', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockResolvedValue({
      synthesized: true,
      answer: 'full',
      confidence: 0.7,
      citations: ['pack-1'],
      keyInsights: ['insight'],
      uncertainties: ['gap'],
    });
    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      canAnswerFromSummariesFn: () => false,
      synthesizeQueryAnswerFn,
    });

    expect(result?.answer).toBe('full');
    expect(synthesizeQueryAnswerFn).toHaveBeenCalledTimes(1);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('success');
  });

  it('falls back when synthesis returns unavailable', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockResolvedValue({
      synthesized: false,
      reason: 'provider_unavailable',
    });
    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      canAnswerFromSummariesFn: () => false,
      synthesizeQueryAnswerFn,
    });

    expect(result).toBeUndefined();
    expect(coverageGaps.join(' ')).toMatch(/synthesis unavailable/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('failed');
  });

  it('records coverage gap when synthesis throws', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockRejectedValue(new Error('kaboom'));
    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      canAnswerFromSummariesFn: () => false,
      synthesizeQueryAnswerFn,
    });

    expect(result).toBeUndefined();
    expect(coverageGaps.join(' ')).toMatch(/synthesis failed/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('failed');
  });
});
