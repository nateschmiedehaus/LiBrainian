import { describe, it, expect, vi } from 'vitest';
import { __testing, getQueryPipelineStages, queryLibrarianWithObserver } from '../query.js';
import type { ContextPack, StageIssueSeverity, StageName } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { GovernorContext } from '../governor_context.js';
import type { QuerySynthesisResult } from '../query_synthesis.js';

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

  it('anchors direct-pack retrieval from file paths mentioned in intent text', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([
      createPack({
        packId: 'pack-path',
        relatedFiles: ['reccmp/compare/core.py'],
      }),
    ]);
    const storage = { getContextPacks } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      { intent: 'What does reccmp/compare/core.py do?', depth: 'L1' },
      '/tmp/workspace',
    );

    expect(packs).toHaveLength(1);
    expect(getContextPacks).toHaveBeenCalledTimes(1);
    const queryOptions = getContextPacks.mock.calls[0]?.[0] as { relatedFilesAny?: string[] };
    expect(queryOptions.relatedFilesAny).toContain('reccmp/compare/core.py');
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

  it('applies bounded rerank windows by depth profile and preserves tail ordering', async () => {
    const stageTracker = __testing.createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const packs = Array.from({ length: 12 }, (_, index) => createPack({
      packId: `pack-${index + 1}`,
      targetId: `module-${index + 1}`,
    }));
    const rerank = vi.fn().mockImplementation(async (_query, input: ContextPack[]) => [...input].reverse());

    const reranked = await __testing.runRerankStage({
      query: { intent: 'test rerank', depth: 'L2' },
      finalPacks: packs,
      candidateScoreMap: new Map(),
      stageTracker,
      explanationParts,
      recordCoverageGap,
      forceRerank: true,
      rerank,
    });

    expect(rerank).toHaveBeenCalledTimes(1);
    const rerankInput = rerank.mock.calls[0]?.[1] as ContextPack[];
    expect(rerankInput).toHaveLength(10);
    expect(reranked.map((pack) => pack.packId)).toEqual([
      'pack-10',
      'pack-9',
      'pack-8',
      'pack-7',
      'pack-6',
      'pack-5',
      'pack-4',
      'pack-3',
      'pack-2',
      'pack-1',
      'pack-11',
      'pack-12',
    ]);
    expect(explanationParts.some((entry) => entry.includes('Bounded rerank window to top 10 packs'))).toBe(true);
    const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.results.telemetry?.rerankWindow).toBe(10);
    expect(report?.results.telemetry?.rerankInputCount).toBe(10);
    expect(report?.results.telemetry?.rerankAppliedCount).toBe(10);
    expect(report?.results.telemetry?.rerankSkipReason).toBeUndefined();
  });

  it('emits rerank skip rationale and telemetry when depth profile disables reranking', async () => {
    const stageTracker = __testing.createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const rerank = vi.fn();

    // Use L0 which has rerank window = 0 (depth profile disabled)
    const result = await __testing.runRerankStage({
      query: { intent: 'test rerank', depth: 'L0' },
      finalPacks: [
        createPack({ packId: 'pack-a', targetId: 'module-a' }),
        createPack({ packId: 'pack-b', targetId: 'module-b' }),
      ],
      candidateScoreMap: new Map(),
      stageTracker,
      explanationParts,
      recordCoverageGap,
      forceRerank: false,
      rerank,
    });

    expect(result.map((pack) => pack.packId)).toEqual(['pack-a', 'pack-b']);
    expect(rerank).not.toHaveBeenCalled();
    expect(explanationParts.join(' ')).toContain('Skipped cross-encoder rerank: depth profile disables cross-encoder rerank.');
    const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.status).toBe('skipped');
    expect(report?.results.telemetry?.rerankWindow).toBe(0);
    expect(report?.results.telemetry?.rerankInputCount).toBe(0);
    expect(report?.results.telemetry?.rerankAppliedCount).toBe(0);
    expect(report?.results.telemetry?.rerankSkipReason).toBe('depth_profile_disabled');
  });

  it('applies MMR diversification when query.diversify is enabled', async () => {
    const stageTracker = __testing.createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };

    const packA = createPack({
      packId: 'pack-a',
      targetId: 'auth-a',
      summary: 'JWT refresh token validation and rotation flow',
      keyFacts: ['JWT', 'refresh token', 'rotation'],
    });
    const packB = createPack({
      packId: 'pack-b',
      targetId: 'auth-b',
      summary: 'JWT refresh token validation and signature checks',
      keyFacts: ['JWT', 'refresh token', 'signature'],
    });
    const packC = createPack({
      packId: 'pack-c',
      targetId: 'auth-c',
      summary: 'Password hashing with bcrypt salt rounds and timing-safe compare',
      keyFacts: ['bcrypt', 'password hashing', 'timing safe compare'],
    });

    const reranked = await __testing.runRerankStage({
      query: {
        intent: 'authentication',
        depth: 'L1',
        diversify: true,
        diversityLambda: 0.2,
      },
      finalPacks: [packA, packB, packC],
      candidateScoreMap: new Map([
        ['auth-a', 0.95],
        ['auth-b', 0.9],
        ['auth-c', 0.7],
      ]),
      stageTracker,
      explanationParts,
      recordCoverageGap,
      forceRerank: false,
      rerank: vi.fn(),
    });

    expect(reranked.map((pack) => pack.packId)).toEqual(['pack-a', 'pack-c', 'pack-b']);
    expect(explanationParts.some((entry) => entry.includes('MMR diversification'))).toBe(true);
    const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.status).toBe('success');
  });

  it('clamps MMR lambda when callers provide out-of-range values', async () => {
    const stageTracker = __testing.createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };

    const reranked = await __testing.runRerankStage({
      query: {
        intent: 'auth',
        depth: 'L1',
        diversify: true,
        diversityLambda: 9,
      },
      finalPacks: [
        createPack({ packId: 'pack-a', targetId: 'a', summary: 'jwt auth flow' }),
        createPack({ packId: 'pack-b', targetId: 'b', summary: 'password hashing flow' }),
      ],
      candidateScoreMap: new Map([
        ['a', 0.8],
        ['b', 0.6],
      ]),
      stageTracker,
      explanationParts,
      recordCoverageGap,
      forceRerank: false,
      rerank: vi.fn(),
    });

    expect(reranked).toHaveLength(2);
    expect(explanationParts.some((entry) => entry.includes('lambda=1.00'))).toBe(true);
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
    const methodGuidanceCall = resolveMethodGuidanceFn.mock.calls[0]?.[0] as { llmTimeoutMs?: number } | undefined;
    expect((methodGuidanceCall?.llmTimeoutMs ?? 0)).toBeGreaterThan(0);
    expect((methodGuidanceCall?.llmTimeoutMs ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(10_000);
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

  it('returns empty synthesis payload when workspace root is unavailable', async () => {
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

    expect(result.synthesis).toBeUndefined();
    expect(result.synthesisMode).toBe('heuristic');
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

    expect(result.synthesis?.answer).toBe('quick');
    expect(result.synthesisMode).toBe('heuristic');
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

    expect(result.synthesis?.answer).toBe('forced-quick');
    expect(result.synthesisMode).toBe('heuristic');
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

    expect(result.synthesis?.answer).toBe('full');
    expect(result.synthesisMode).toBe('llm');
    expect(synthesizeQueryAnswerFn).toHaveBeenCalledTimes(1);
    const synthesisCall = synthesizeQueryAnswerFn.mock.calls[0]?.[0] as { llmTimeoutMs?: number } | undefined;
    expect((synthesisCall?.llmTimeoutMs ?? 0)).toBeGreaterThan(0);
    expect((synthesisCall?.llmTimeoutMs ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(60_000);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('success');
  });

  it('falls back when full synthesis exceeds the stage timeout budget', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockImplementation(
      () => new Promise<QuerySynthesisResult>(() => {})
    );

    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis timeout', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      synthesisTimeoutMs: 25,
      canAnswerFromSummariesFn: () => false,
      synthesizeQueryAnswerFn,
    });

    expect(result.synthesis).toBeUndefined();
    expect(result.synthesisMode).toBe('heuristic');
    expect(result.llmError).toMatch(/timed out/i);
    expect(coverageGaps.join(' ')).toMatch(/timed out/i);
  });

  it('uses a 60s default synthesis timeout budget when query timeout is larger', async () => {
    vi.useFakeTimers();
    try {
      const stageTracker = __testing.createStageTracker();
      const coverageGaps: string[] = [];
      const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
        coverageGaps.push(message);
        stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
      };
      const synthesizeQueryAnswerFn = vi.fn().mockImplementation(
        () => new Promise<QuerySynthesisResult>(() => {})
      );

      const runPromise = __testing.runSynthesisStage({
        query: { intent: 'test default synthesis timeout', depth: 'L1', timeoutMs: 120_000 },
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

      await vi.advanceTimersByTimeAsync(60_000);
      const result = await runPromise;
      expect(result.llmError).toContain('60000ms');
      expect(coverageGaps.join(' ')).toContain('60000ms');
    } finally {
      vi.useRealTimers();
    }
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

    expect(result.synthesis).toBeUndefined();
    expect(result.synthesisMode).toBe('heuristic');
    expect(result.llmError).toBe('provider_unavailable');
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

    expect(result.synthesis).toBeUndefined();
    expect(result.synthesisMode).toBe('heuristic');
    expect(result.llmError).toBe('kaboom');
    expect(coverageGaps.join(' ')).toMatch(/synthesis failed/i);
    const report = stageTracker.report().find((stage) => stage.stage === 'synthesis');
    expect(report?.status).toBe('failed');
  });

  it('ranks heuristic fallback packs by query relevance', () => {
    const authPack = createPack({
      packId: 'auth-pack',
      summary: 'Session token refresh and authentication middleware flow',
      keyFacts: ['auth token lifecycle', 'session refresh'],
      successCount: 3,
      failureCount: 0,
    });
    const buildPack = createPack({
      packId: 'build-pack',
      summary: 'Build pipeline and deployment release process',
      keyFacts: ['ci workflow', 'release pipeline'],
      successCount: 3,
      failureCount: 0,
    });

    const authRanked = __testing.rankHeuristicFallbackPacks([authPack, buildPack], 'auth session refresh token');
    const buildRanked = __testing.rankHeuristicFallbackPacks([authPack, buildPack], 'deployment pipeline release');

    expect(authRanked[0]?.packId).toBe('auth-pack');
    expect(buildRanked[0]?.packId).toBe('build-pack');
  });

  it('matches compound identifiers across camelCase and snake_case query forms', () => {
    const sessionPack = createPack({
      packId: 'session-pack',
      summary: 'Handles userSessionRefreshToken lifecycle and retry policy',
      keyFacts: ['userSessionRefreshToken is rotated on auth boundary'],
      successCount: 2,
      failureCount: 0,
    });
    const unrelatedPack = createPack({
      packId: 'invoice-pack',
      summary: 'Generates invoice totals and taxation reports',
      keyFacts: ['invoice generation pipeline'],
      successCount: 2,
      failureCount: 0,
    });

    const snakeCaseRanked = __testing.rankHeuristicFallbackPacks(
      [sessionPack, unrelatedPack],
      'session_refresh_token'
    );
    const spacedRanked = __testing.rankHeuristicFallbackPacks(
      [sessionPack, unrelatedPack],
      'user session refresh token'
    );

    expect(snakeCaseRanked[0]?.packId).toBe('session-pack');
    expect(spacedRanked[0]?.packId).toBe('session-pack');
  });

  it('supports hiding llm errors with showLlmErrors=false', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockResolvedValue({
      synthesized: false,
      reason: 'provider_unavailable',
    });

    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1', showLlmErrors: false },
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

    expect(result.synthesis).toBeUndefined();
    expect(result.synthesisMode).toBe('heuristic');
    expect(result.llmError).toBeUndefined();
  });
});
