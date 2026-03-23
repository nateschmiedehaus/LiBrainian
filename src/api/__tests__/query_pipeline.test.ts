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

  it('bypasses query cache when watch freshness requires catch-up', async () => {
    const eligibility = await __testing.resolveQueryCacheEligibility({
      storage: {} as LibrarianStorage,
      query: { intent: 'cache bypass', depth: 'L1' },
      indexState: { phase: 'ready' },
      workspaceRoot: '/tmp/workspace',
      deps: {
        getWatchStateFn: vi.fn().mockResolvedValue({
          needs_catchup: true,
          cursor: { kind: 'git', lastIndexedCommitSha: 'abc123' },
        }),
      },
    });

    expect(eligibility.allowCache).toBe(false);
    expect(eligibility.reason).toContain('watch freshness');
  });

  it('bypasses query cache when git drift shows stale or new files', async () => {
    const checkFiles = vi.fn().mockResolvedValue([
      { filePath: '/tmp/workspace/src/api/query.ts', status: 'stale' },
      { filePath: '/tmp/workspace/src/api/new.ts', status: 'new' },
    ]);
    const eligibility = await __testing.resolveQueryCacheEligibility({
      storage: {} as LibrarianStorage,
      query: { intent: 'cache bypass', depth: 'L1' },
      indexState: { phase: 'ready' },
      workspaceRoot: '/tmp/workspace',
      deps: {
        getWatchStateFn: vi.fn().mockResolvedValue(null),
        isGitRepoFn: vi.fn().mockReturnValue(true),
        getGitStatusChangesFn: vi.fn().mockResolvedValue({
          added: ['src/api/new.ts'],
          modified: ['src/api/query.ts'],
          deleted: [],
          renamed: [],
        }),
        createStalenessTrackerFn: vi.fn().mockReturnValue({
          checkFiles,
        }),
      },
    });

    expect(eligibility.allowCache).toBe(false);
    expect(eligibility.reason).toContain('workspace drift detected');
    expect(checkFiles).toHaveBeenCalledWith([
      '/tmp/workspace/src/api/new.ts',
      '/tmp/workspace/src/api/query.ts',
    ]);
  });

  it('keeps query cache eligible when the workspace is clean', async () => {
    const eligibility = await __testing.resolveQueryCacheEligibility({
      storage: {} as LibrarianStorage,
      query: { intent: 'cache bypass', depth: 'L1' },
      indexState: { phase: 'ready' },
      workspaceRoot: '/tmp/workspace',
      deps: {
        getWatchStateFn: vi.fn().mockResolvedValue(null),
        isGitRepoFn: vi.fn().mockReturnValue(true),
        getGitStatusChangesFn: vi.fn().mockResolvedValue(null),
      },
    });

    expect(eligibility.allowCache).toBe(true);
    expect(eligibility.reason).toBeUndefined();
  });

  it('ignores non-indexable git artifacts when deciding query cache drift', async () => {
    const checkFiles = vi.fn().mockResolvedValue([]);
    const eligibility = await __testing.resolveQueryCacheEligibility({
      storage: {} as LibrarianStorage,
      query: { intent: 'cache bypass', depth: 'L1' },
      indexState: { phase: 'ready' },
      workspaceRoot: '/tmp/workspace',
      deps: {
        getWatchStateFn: vi.fn().mockResolvedValue(null),
        isGitRepoFn: vi.fn().mockReturnValue(true),
        getGitStatusChangesFn: vi.fn().mockResolvedValue({
          added: ['.claude/session.log', 'librainian-0.2.1.tgz', 'tmp-claude'],
          modified: [],
          deleted: [],
          renamed: [],
        }),
        createStalenessTrackerFn: vi.fn().mockReturnValue({
          checkFiles,
        }),
      },
    });

    expect(eligibility.allowCache).toBe(true);
    expect(checkFiles).not.toHaveBeenCalled();
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

  it('anchors bare filename mentions to indexed file paths for direct-pack retrieval', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([
      createPack({
        packId: 'pack-query-file',
        relatedFiles: ['src/api/query.ts'],
      }),
    ]);
    const getFiles = vi.fn().mockResolvedValue([
      { path: 'src/api/query.ts' },
      { path: 'src/api/query_synthesis.ts' },
    ]);
    const storage = { getContextPacks, getFiles } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      { intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?', depth: 'L2' },
      '/tmp/workspace',
    );

    expect(packs).toHaveLength(1);
    expect(getFiles).toHaveBeenCalledTimes(1);
    const queryOptions = getContextPacks.mock.calls[0]?.[0] as { relatedFilesAny?: string[] };
    expect(queryOptions.relatedFilesAny).toContain('src/api/query.ts');
    expect(queryOptions.relatedFilesAny).toContain('/tmp/workspace/src/api/query.ts');
  });

  it('prunes bare filename collisions for seam-planning intents to the strongest API anchor', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([
      createPack({
        packId: 'pack-query-file',
        relatedFiles: ['src/api/query.ts'],
      }),
    ]);
    const getFiles = vi.fn().mockResolvedValue([
      { path: 'src/api/query.ts' },
      { path: 'src/api/query_synthesis.ts' },
      { path: 'src/api/query_intent_bias_profile.ts' },
      { path: 'src/cli/commands/query.ts' },
    ]);
    const storage = { getContextPacks, getFiles } as unknown as LibrarianStorage;

    await __testing.collectDirectPacks(
      storage,
      { intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?', depth: 'L2' },
      '/tmp/workspace',
    );

    const queryOptions = getContextPacks.mock.calls[0]?.[0] as { relatedFilesAny?: string[] };
    expect(queryOptions.relatedFilesAny).toContain('src/api/query.ts');
    expect(queryOptions.relatedFilesAny).not.toContain('src/cli/commands/query.ts');
  });

  it('skips semantic retrieval for anchored planning queries when direct packs already cover the referenced file', () => {
    const shouldSkip = __testing.shouldSkipSemanticRetrievalForAnchoredPlanning(
      { intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?', depth: 'L2' },
      [
        createPack({
          packId: 'pack-query-file',
          summary: 'Query pipeline orchestration seam for routing, retrieval, and synthesis.',
          keyFacts: ['Coordinates routing, retrieval, and synthesis stages.'],
          relatedFiles: ['src/api/query.ts'],
          codeSnippets: [{ filePath: 'src/api/query.ts', startLine: 1, endLine: 10, content: '...', language: 'typescript' }],
        }),
      ],
    );

    expect(shouldSkip).toBe(true);
  });

  it('keeps semantic retrieval enabled when direct packs do not cover the referenced planning file', () => {
    const shouldSkip = __testing.shouldSkipSemanticRetrievalForAnchoredPlanning(
      { intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?', depth: 'L2' },
      [
        createPack({
          packId: 'pack-other-file',
          relatedFiles: ['src/cli/commands/query.ts'],
        }),
      ],
    );

    expect(shouldSkip).toBe(false);
  });

  it('uses anchored planning direct mode for file-anchored seam-planning intents', () => {
    expect(
      __testing.shouldUseAnchoredPlanningDirectMode({
        intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?',
        depth: 'L2',
      }),
    ).toBe(true);
  });

  it('does not use anchored planning direct mode when no file is referenced', () => {
    expect(
      __testing.shouldUseAnchoredPlanningDirectMode({
        intent: 'What should I touch to split the query pipeline into routing, retrieval, and synthesis seams?',
        depth: 'L2',
      }),
    ).toBe(false);
  });

  it('does not use anchored planning direct mode for test-targeting split queries', () => {
    expect(
      __testing.shouldUseAnchoredPlanningDirectMode({
        intent: 'What tests should I update if I split src/api/query.ts into routing, retrieval, and synthesis modules?',
        depth: 'L2',
      }),
    ).toBe(false);
  });

  it('synthesizes anchored file fallback packs when direct context packs are missing for a basename collision', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([]);
    const getFiles = vi.fn().mockResolvedValue([
      { path: 'src/api/query.ts' },
      { path: 'src/cli/commands/query.ts' },
    ]);
    const getModuleByPath = vi.fn().mockImplementation(async (filePath: string) => {
      if (filePath === 'src/api/query.ts') {
        return {
          id: 'mod-api-query',
          path: 'src/api/query.ts',
          purpose: 'Query pipeline orchestration coordinates routing, retrieval, and synthesis stages.',
          exports: ['queryLibrarian'],
          dependencies: ['src/api/query_synthesis.ts'],
          confidence: 0.86,
        };
      }
      if (filePath === 'src/cli/commands/query.ts') {
        return {
          id: 'mod-cli-query',
          path: 'src/cli/commands/query.ts',
          purpose: 'CLI command for parsing query flags and printing results.',
          exports: ['queryCommand'],
          dependencies: ['src/cli/db_path.js'],
          confidence: 0.88,
        };
      }
      return null;
    });
    const getFunctionsByPath = vi.fn().mockImplementation(async (filePath: string) => {
      if (filePath === 'src/api/query.ts') {
        return [
          {
            id: 'fn-api-synthesis',
            filePath,
            name: 'runSynthesisStage',
            signature: 'runSynthesisStage(options)',
            purpose: 'Coordinates synthesis for retrieved query packs.',
            startLine: 6013,
            endLine: 6190,
            confidence: 0.84,
            accessCount: 0,
            lastAccessed: null,
            validationCount: 0,
            outcomeHistory: { successes: 0, failures: 0 },
          },
        ];
      }
      if (filePath === 'src/cli/commands/query.ts') {
        return [
          {
            id: 'fn-cli-query',
            filePath,
            name: 'queryCommand',
            signature: 'queryCommand(options)',
            purpose: 'Parses CLI flags and formats output.',
            startLine: 1,
            endLine: 400,
            confidence: 0.9,
            accessCount: 0,
            lastAccessed: null,
            validationCount: 0,
            outcomeHistory: { successes: 0, failures: 0 },
          },
        ];
      }
      return [];
    });
    const storage = {
      getContextPacks,
      getFiles,
      getModuleByPath,
      getFunctionsByPath,
    } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      { intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?', depth: 'L2' },
      '/tmp/workspace',
    );

    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]?.relatedFiles[0]).toBe('src/api/query.ts');
    expect(packs.some((pack) => pack.relatedFiles[0] === 'src/cli/commands/query.ts')).toBe(false);
  });

  it('binds storage path lookup methods when synthesizing anchored fallback packs', async () => {
    const storage = {
      marker: 'bound-storage',
      async getContextPacks() { return []; },
      async getFiles() {
        return [{ path: 'src/api/query.ts' }];
      },
      async getModuleByPath(this: { marker?: string }, filePath: string) {
        if (this.marker !== 'bound-storage') throw new Error('unbound');
        if (filePath !== 'src/api/query.ts') return null;
        return {
          id: 'mod-api-query',
          path: filePath,
          purpose: 'Query pipeline orchestration coordinates routing, retrieval, and synthesis stages.',
          exports: ['queryLibrarian'],
          dependencies: ['src/api/query_synthesis.ts'],
          confidence: 0.86,
        };
      },
      async getFunctionsByPath(this: { marker?: string }, filePath: string) {
        if (this.marker !== 'bound-storage') throw new Error('unbound');
        if (filePath !== 'src/api/query.ts') return [];
        return [
          {
            id: 'fn-api-synthesis',
            filePath,
            name: 'runSynthesisStage',
            signature: 'runSynthesisStage(options)',
            purpose: 'Coordinates synthesis for retrieved query packs.',
            startLine: 6013,
            endLine: 6190,
            confidence: 0.84,
            accessCount: 0,
            lastAccessed: null,
            validationCount: 0,
            outcomeHistory: { successes: 0, failures: 0 },
          },
        ];
      },
    } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      { intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?', depth: 'L2' },
      '/tmp/workspace',
    );

    expect(packs.some((pack) => pack.relatedFiles[0] === 'src/api/query.ts')).toBe(true);
  });

  it('anchors direct-pack retrieval from identifier mentions in location intents', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([
      createPack({
        packId: 'pack-symbol',
        relatedFiles: ['src/api/query.ts'],
      }),
    ]);
    const getFunctionsByName = vi.fn().mockResolvedValue([
      { filePath: 'src/api/query.ts' },
    ]);
    const storage = { getContextPacks, getFunctionsByName } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      { intent: 'Where is function runSynthesisStage implemented?', depth: 'L1' },
      '/tmp/workspace',
    );

    expect(packs).toHaveLength(1);
    expect(getFunctionsByName).toHaveBeenCalledWith('runSynthesisStage');
    const queryOptions = getContextPacks.mock.calls[0]?.[0] as { relatedFilesAny?: string[]; limit?: number };
    expect(queryOptions.relatedFilesAny).toContain('src/api/query.ts');
    expect(queryOptions.limit).toBe(24);
  });

  it('does not trigger direct-pack retrieval for excludeTests-only filters without anchors', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([createPack({ packId: 'pack-unexpected' })]);
    const storage = { getContextPacks } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      {
        intent: 'where is query synthesis executed?',
        depth: 'L1',
        filter: { excludeTests: true },
      },
      '/tmp/workspace',
    );

    expect(packs).toHaveLength(0);
    expect(getContextPacks).not.toHaveBeenCalled();
  });

  it('anchors direct-pack retrieval from MCP runtime recovery intents', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([
      createPack({
        packId: 'pack-mcp',
        relatedFiles: ['src/mcp/server.ts'],
      }),
    ]);
    const storage = { getContextPacks } as unknown as LibrarianStorage;

    const packs = await __testing.collectDirectPacks(
      storage,
      {
        intent: 'Where are MCP tool errors normalized into actionable retry/fallback guidance?',
        depth: 'L2',
      },
      '/tmp/workspace',
    );

    expect(packs).toHaveLength(1);
    const queryOptions = getContextPacks.mock.calls[0]?.[0] as { relatedFilesAny?: string[]; limit?: number };
    expect(queryOptions.relatedFilesAny).toContain('src/mcp/server.ts');
    expect(queryOptions.relatedFilesAny).toContain('src/cli/commands/mcp.ts');
    expect(queryOptions.limit).toBe(80);
  });

  it('uses the feature-location stage as an early direct answer and ignores fixture noise', async () => {
    const getIngestionItems = vi.fn().mockImplementation(async ({ sourceType }: { sourceType: string }) => {
      if (sourceType === 'function') {
        return [
          {
            id: 'fn-auth',
            payload: {
              path: 'src/mcp/authentication.ts',
              name: 'createAuthenticationManager',
              content: 'Creates authentication manager and session token handling for MCP server.',
            },
          },
          {
            id: 'fn-fixture',
            payload: {
              path: 'tests/fixtures/index-correctness-fixture/src/auth/session.ts',
              name: 'createSessionToken',
              content: 'Fixture auth session helper.',
            },
          },
        ];
      }
      if (sourceType === 'module') {
        return [
          {
            id: 'mod-auth',
            payload: {
              path: 'src/mcp/authentication.ts',
              content: 'Authentication module with token and authorization routing helpers.',
            },
          },
        ];
      }
      return [];
    });
    const storage = { getIngestionItems } as unknown as LibrarianStorage;

    const result = await __testing.runFeatureLocationStage({
      storage,
      intent: 'Where does auth routing live?',
      featureTarget: 'auth routing',
      version: baseVersion,
    });

    expect(result.analyzed).toBe(true);
    expect(result.shouldShortCircuit).toBe(true);
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]?.relatedFiles).toContain('src/mcp/authentication.ts');
    expect(result.packs[0]?.relatedFiles.some((file) => file.includes('tests/fixtures'))).toBe(false);
    expect(result.packs[0]?.summary).toContain('auth routing');
  });

  it('uses the path lookup stage as an early direct answer for explicit file queries', async () => {
    const getContextPacks = vi.fn().mockResolvedValue([
      createPack({
        packId: 'pack-query-file',
        relatedFiles: ['src/api/query.ts'],
        summary: 'Primary query pipeline implementation',
      }),
      createPack({
        packId: 'pack-generic',
        relatedFiles: ['src/constructions/strategic/work_presets_construction.ts'],
        summary: 'Unrelated strategic helper',
      }),
    ]);
    const storage = { getContextPacks } as unknown as LibrarianStorage;

    const result = await __testing.runPathLookupStage({
      storage,
      intent: 'Show me src/api/query.ts',
      pathTarget: 'src/api/query.ts',
      workspaceRoot: '/tmp/workspace',
      depth: 'L2',
    });

    expect(result.analyzed).toBe(true);
    expect(result.shouldShortCircuit).toBe(true);
    expect(result.packs[0]?.relatedFiles).toContain('src/api/query.ts');
    expect(result.explanation).toContain('exact context pack');
  });

  it('replaces low-coherence heuristic synthesis with a bounded fallback', () => {
    const synthesis = {
      answer: 'path-like query routing implemented in LiBrainian is primarily implemented in src/constructions/strategic/operational_excellence_construction.ts.',
      confidence: 0.7,
      citations: [],
      keyInsights: ['Wrong confident claim'],
      uncertainties: [],
    };
    const guarded = __testing.applyHeuristicSynthesisGuardrail({
      synthesis,
      synthesisMode: 'heuristic',
      queryIntent: 'Where is path-like query routing implemented in LiBrainian?',
      finalPacks: [
        createPack({ relatedFiles: ['src/api/query.ts'] }),
        createPack({ packId: 'pack-2', relatedFiles: ['src/api/query_intent.ts'] }),
      ],
      coherenceAnalysis: {
        overallCoherence: 0.2,
        explanation: 'Results appear scattered/incoherent (20%).',
      },
      lowRelevanceTriggered: true,
      lowRelevanceReason: 'Top relevance score 0.41 below 0.60 threshold.',
    });

    expect(guarded?.answer).toContain('Results are too scattered');
    expect(guarded?.answer).toContain('src/api/query.ts');
    expect(guarded?.confidence).toBeLessThanOrEqual(0.35);
    expect(guarded?.uncertainties.some((entry) => entry.includes('Heuristic answer guardrail applied'))).toBe(true);
  });

  it('scores anchored direct packs by lexical relevance so recovery helpers outrank generic server startup helpers', () => {
    const relevant = createPack({
      packId: 'pack-relevant',
      packType: 'function_context',
      summary: 'Function normalizeToolErrorResult in server.ts',
      keyFacts: [
        'Signature: normalizeToolErrorResult(toolName: string, args: unknown, result: unknown): Record<string, unknown> | null',
        'File: src/mcp/server.ts',
      ],
      relatedFiles: ['src/mcp/server.ts'],
    });
    const generic = createPack({
      packId: 'pack-generic',
      packType: 'function_context',
      summary: 'Create and start a LiBrainian MCP server.',
      keyFacts: [
        'Signature: createLiBrainianMCPServer(config: Partial<LiBrainianMCPServerConfig> = {}): Promise<LiBrainianMCPServer>',
        'File: src/mcp/server.ts',
      ],
      relatedFiles: ['src/mcp/server.ts'],
    });

    const relevantScore = __testing.scoreAnchoredDirectPack(
      relevant,
      'Where are MCP tool errors normalized into actionable retry/fallback guidance?'
    );
    const genericScore = __testing.scoreAnchoredDirectPack(
      generic,
      'Where are MCP tool errors normalized into actionable retry/fallback guidance?'
    );

    expect(relevantScore).toBeGreaterThan(genericScore);
    expect(relevantScore).toBeGreaterThan(0.9);
  });

  it('preserves the best anchor-priority direct packs per file', () => {
    const serverRelevant = createPack({
      packId: 'server-relevant',
      packType: 'function_context',
      summary: 'Function normalizeToolErrorResult in server.ts',
      keyFacts: [
        'Signature: normalizeToolErrorResult(toolName: string, args: unknown, result: unknown): Record<string, unknown> | null',
        'File: src/mcp/server.ts',
      ],
      relatedFiles: ['src/mcp/server.ts'],
    });
    const serverGeneric = createPack({
      packId: 'server-generic',
      packType: 'function_context',
      summary: 'Create and start a LiBrainian MCP server.',
      keyFacts: [
        'Signature: createLiBrainianMCPServer(config: Partial<LiBrainianMCPServerConfig> = {}): Promise<LiBrainianMCPServer>',
        'File: src/mcp/server.ts',
      ],
      relatedFiles: ['src/mcp/server.ts'],
    });
    const mcpCli = createPack({
      packId: 'mcp-cli',
      packType: 'module_context',
      summary: 'Module mcp exporting mcpCommand, McpCommandOptions',
      keyFacts: ['Top-level routines: buildServerEntry, buildClientBundles, mcpCommand'],
      relatedFiles: ['src/cli/commands/mcp.ts'],
    });

    const selected = __testing.selectPriorityDirectPacks(
      [serverGeneric, serverRelevant, mcpCli],
      'Where are MCP tool errors normalized into actionable retry/fallback guidance?',
      10,
    );

    expect(selected.map((pack) => pack.packId)).toEqual(['server-relevant', 'mcp-cli']);
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

  it('skips cross-encoder reranking in deterministic mode even when depth would allow it', async () => {
    const stageTracker = __testing.createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const rerank = vi.fn();

    const result = await __testing.runRerankStage({
      query: { intent: 'test rerank', depth: 'L1', deterministic: true },
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
    expect(explanationParts.join(' ')).toContain('Skipped cross-encoder rerank: deterministic mode disables cross-encoder rerank.');
    const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
    expect(report?.status).toBe('skipped');
    expect(report?.results.telemetry?.rerankWindow).toBe(5);
    expect(report?.results.telemetry?.rerankInputCount).toBe(2);
    expect(report?.results.telemetry?.rerankAppliedCount).toBe(0);
    expect(report?.results.telemetry?.rerankSkipReason).toBe('deterministic_mode_disabled');
  });

  it('skips cross-encoder reranking by default unless explicitly opted in', async () => {
    const previousFlag = process.env.LIBRARIAN_CROSS_ENCODER;
    delete process.env.LIBRARIAN_CROSS_ENCODER;
    const stageTracker = __testing.createStageTracker();
    const explanationParts: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const rerank = vi.fn();

    try {
      const result = await __testing.runRerankStage({
        query: { intent: 'test rerank', depth: 'L1' },
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
      expect(explanationParts.join(' ')).toContain('Skipped cross-encoder rerank: cross-encoder is disabled.');
      const report = stageTracker.report().find((stage) => stage.stage === 'reranking');
      expect(report?.status).toBe('skipped');
      expect(report?.results.telemetry?.rerankSkipReason).toBe('cross_encoder_disabled');
    } finally {
      if (typeof previousFlag === 'string') process.env.LIBRARIAN_CROSS_ENCODER = previousFlag;
      else delete process.env.LIBRARIAN_CROSS_ENCODER;
    }
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

  it('uses storage metadata when no synthesis workspace override is provided', async () => {
    const stageTracker = __testing.createStageTracker();
    const storage = {
      getMetadata: vi.fn().mockResolvedValue({ workspace: '/tmp/workspace-from-storage' }),
    } as unknown as LibrarianStorage;
    const synthesizeQueryAnswerFn = vi.fn().mockResolvedValue({
      synthesized: true,
      answer: 'synthetic answer',
      confidence: 0.7,
      citations: [],
      keyInsights: [],
      uncertainties: [],
    });

    const result = await __testing.runSynthesisStage({
      query: { intent: 'test synthesis', depth: 'L1' },
      storage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap: () => {},
      explanationParts: [],
      synthesisEnabled: true,
      canAnswerFromSummariesFn: () => false,
      synthesizeQueryAnswerFn,
    });

    expect(result.synthesis?.answer).toBe('synthetic answer');
    expect(synthesizeQueryAnswerFn).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/tmp/workspace-from-storage',
    }));
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

  it('prefers quick synthesis when retrieval is degraded even for non-summary intents', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const createQuickAnswerFn = vi.fn().mockReturnValue({
      answer: 'degraded-quick',
      confidence: 0.65,
      citations: ['pack-1'],
      keyInsights: ['insight'],
      uncertainties: [],
    });
    const synthesizeQueryAnswerFn = vi.fn();

    const explanationParts: string[] = [];
    const result = await __testing.runSynthesisStage({
      query: { intent: 'How are errors handled across the codebase?', depth: 'L1' },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts,
      synthesisEnabled: true,
      preferQuickSynthesis: true,
      workspaceRoot: process.cwd(),
      canAnswerFromSummariesFn: () => false,
      createQuickAnswerFn,
      synthesizeQueryAnswerFn,
    });

    expect(result.synthesis?.answer).toBe('degraded-quick');
    expect(result.synthesisMode).toBe('heuristic');
    expect(createQuickAnswerFn).toHaveBeenCalledTimes(1);
    expect(synthesizeQueryAnswerFn).not.toHaveBeenCalled();
    expect(explanationParts.join(' ')).toContain('degraded retrieval state');
  });

  it('uses quick synthesis for file-anchored seam-planning queries', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockResolvedValue({
      synthesized: true,
      answer: 'slow-llm-answer',
      confidence: 0.7,
      citations: ['pack-query'],
      keyInsights: ['insight'],
      uncertainties: [],
    });

    const result = await __testing.runSynthesisStage({
      query: {
        intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?',
        depth: 'L2',
        forceSummarySynthesis: true,
      },
      storage: {} as LibrarianStorage,
      finalPacks: [
        createPack({
          packId: 'pack-cli-query',
          summary: 'CLI query command parses flags and prints formatted results for the query command.',
          relatedFiles: ['src/cli/commands/query.ts'],
          confidence: 0.91,
          keyFacts: ['Formats query command output.'],
        }),
        createPack({
          packId: 'pack-synth',
          summary: 'Module query_synthesis exporting synthesizeQueryAnswer, canAnswerFromSummaries, createQuickAnswer...',
          relatedFiles: ['src/api/query_synthesis.ts'],
          confidence: 0.9,
          keyFacts: ['Exports quick and full synthesis helpers.'],
        }),
        createPack({
          packId: 'pack-query',
          summary: 'Query pipeline orchestration in src/api/query.ts coordinates routing, retrieval, and synthesis stages.',
          relatedFiles: ['src/api/query.ts'],
          confidence: 0.84,
          keyFacts: ['Coordinates routing, retrieval, and synthesis stages.'],
        }),
        createPack({
          packId: 'pack-intent',
          summary: 'Intent bias and routing helpers live in src/api/query_intent_bias_profile.ts.',
          relatedFiles: ['src/api/query_intent_bias_profile.ts'],
          confidence: 0.72,
          keyFacts: ['Derives retrieval biases from classified query intent.'],
        }),
      ],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      synthesizeQueryAnswerFn,
    });

    expect(result.synthesisMode).toBe('heuristic');
    expect(result.synthesis?.answer).toContain('src/api/query.ts');
    expect(result.synthesis?.answer).not.toContain('Start with src/cli/commands/query.ts');
    expect(result.synthesis?.answer).toContain('src/api/query_synthesis.ts');
    expect(result.synthesis?.answer).not.toContain('Supporting logic already lives in src/cli/commands/query.ts');
    expect(result.synthesis?.answer).toContain('routing, retrieval, synthesis');
    expect(synthesizeQueryAnswerFn).not.toHaveBeenCalled();
  });

  it('includes pipeline stages in quick location answers when the pack provides them', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };

    const result = await __testing.runSynthesisStage({
      query: {
        intent: 'Where is the query pipeline implemented and what are its stages?',
        depth: 'L1',
        forceSummarySynthesis: true,
      },
      storage: {} as LibrarianStorage,
      finalPacks: [
        createPack({
          packId: 'pack-query-pipeline',
          summary: 'Main query pipeline orchestration module.',
          relatedFiles: ['src/api/query.ts'],
          confidence: 0.88,
          keyFacts: [
            'Purpose: Main query pipeline orchestration module.',
            'Pipeline stages: adequacy_scan, direct_packs, semantic_retrieval, graph_expansion, multi_signal_scoring, multi_vector_scoring, fallback, reranking, defeater_check, method_guidance, synthesis, post_processing',
          ],
        }),
      ],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
    });

    expect(result.synthesis?.answer).toContain('src/api/query.ts');
    expect(result.synthesis?.answer).toContain('Pipeline stages: adequacy_scan');
    expect(result.synthesis?.answer).toContain('post_processing');
  });

  it('augments final synthesis with pipeline stages for query-pipeline stage questions', () => {
    const synthesis = __testing.applyQueryPipelineStageAnswerAugmentation({
      query: {
        intent: 'Where is the query pipeline implemented and what are its stages?',
        depth: 'L1',
      },
      synthesis: {
        answer: 'the query pipeline implemented and what are its stages is primarily implemented in src/api/query.ts.',
        confidence: 0.8,
        citations: [],
        keyInsights: [],
        uncertainties: [],
      },
      finalPacks: [
        createPack({
          relatedFiles: ['src/api/query.ts'],
        }),
      ],
    });

    expect(synthesis?.answer).toContain('src/api/query.ts');
    expect(synthesis?.answer).toContain('Pipeline stages: adequacy_scan');
    expect(synthesis?.answer).toContain('post_processing');
  });

  it('surfaces dependency files as supporting seam modules when only the anchored module pack is present', async () => {
    const stageTracker = __testing.createStageTracker();
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      stageTracker.issue(stage, { message, severity: severity ?? 'minor' });
    };

    const result = await __testing.runSynthesisStage({
      query: {
        intent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?',
        depth: 'L2',
        forceSummarySynthesis: true,
      },
      storage: {} as LibrarianStorage,
      finalPacks: [
        createPack({
          packId: 'pack-query',
          summary: 'Query pipeline orchestration in src/api/query.ts coordinates routing, retrieval, and synthesis stages.',
          relatedFiles: ['src/api/query.ts'],
          confidence: 0.9,
          keyFacts: [
            'Coordinates routing, retrieval, and synthesis stages.',
            'Adjacent modules: src/api/query_synthesis.ts, src/api/query_intent_bias_profile.ts',
            'Dependencies: ../storage/types.js, ../types.js',
          ],
        }),
      ],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
    });

    expect(result.synthesis?.answer).toContain('src/api/query_synthesis.ts');
    expect(result.synthesis?.answer).toContain('src/api/query_intent_bias_profile.ts');
  });

  it('prioritizes synthesis, routing, and retrieval adjacent modules for mixed seam-planning queries', () => {
    const adjacentModules = __testing.findAdjacentImplementationModules(
      'src/api/query.ts',
      [
        { path: 'src/api/query.ts' },
        { path: 'src/api/query_synthesis.ts' },
        { path: 'src/api/query_intent_routing_overrides.ts' },
        { path: 'src/api/query_result_biasing.ts' },
        { path: 'src/api/query_candidate_merge.ts' },
        { path: 'src/api/query_intent_patterns.ts' },
        { path: 'src/api/query_intent_targets.ts' },
        { path: 'src/api/query_intent_bias_profile.ts' },
      ],
      'What should I touch to split query.ts into routing, retrieval, and synthesis seams?',
    );

    expect(adjacentModules.slice(0, 3)).toEqual([
      'src/api/query_synthesis.ts',
      'src/api/query_intent_routing_overrides.ts',
      'src/api/query_result_biasing.ts',
    ]);
  });

  it('preserves anchored seam-planning heuristic answers instead of replacing them with scatter fallback', () => {
    const result = __testing.applyHeuristicSynthesisGuardrail({
      synthesis: {
        answer: 'Start with src/api/query.ts as the orchestration seam for routing, retrieval, synthesis. Supporting logic already lives in src/api/query_synthesis.ts, src/api/query_intent_bias_profile.ts.',
        confidence: 0.7,
        citations: [],
        keyInsights: ['query.ts is the orchestration seam'],
        uncertainties: ['Answer derived from pack summary without full LLM synthesis'],
      },
      synthesisMode: 'heuristic',
      queryIntent: 'What should I touch to split query.ts into routing, retrieval, and synthesis seams?',
      finalPacks: [
        createPack({
          relatedFiles: ['src/api/query.ts'],
          confidence: 0.84,
        }),
        createPack({
          relatedFiles: ['src/api/query_synthesis.ts'],
          confidence: 0.8,
        }),
      ],
      coherenceAnalysis: {
        overallCoherence: 0.2,
        explanation: 'Result files span multiple adjacent modules.',
      },
      lowRelevanceTriggered: false,
      lowRelevanceReason: undefined,
    });

    expect(result?.answer).toContain('Start with src/api/query.ts');
    expect(result?.answer).not.toContain('Results are too scattered');
    expect(result?.confidence).toBe(0.55);
    expect(result?.uncertainties.join(' ')).toContain('guardrail applied');
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

  it('degrades to a quick recovery answer after synthesis timeout for recovery guidance queries', async () => {
    const stageTracker = __testing.createStageTracker();
    const coverageGaps: string[] = [];
    const recordCoverageGap = (stage: StageName, message: string, severity?: StageIssueSeverity) => {
      coverageGaps.push(message);
      stageTracker.issue(stage, { message, severity: severity ?? 'moderate' });
    };
    const synthesizeQueryAnswerFn = vi.fn().mockImplementation(
      () => new Promise<QuerySynthesisResult>(() => {})
    );
    const createQuickAnswerFn = vi.fn().mockReturnValue({
      answer: 'Agents should follow the structured recovery path in src/mcp/server.ts, src/cli/errors.ts.',
      confidence: 0.66,
      citations: ['pack-1'],
      keyInsights: ['retry guidance'],
      uncertainties: ['Answer derived from pack summary without full LLM synthesis'],
    });

    const result = await __testing.runSynthesisStage({
      query: {
        intent: 'How should agents recover from MCP tool timeouts, provider failures, or storage errors?',
        depth: 'L1',
      },
      storage: {} as LibrarianStorage,
      finalPacks: [createPack({})],
      stageTracker,
      recordCoverageGap,
      explanationParts: [],
      synthesisEnabled: true,
      workspaceRoot: process.cwd(),
      synthesisTimeoutMs: 25,
      canAnswerFromSummariesFn: () => false,
      createQuickAnswerFn,
      synthesizeQueryAnswerFn,
    });

    expect(result.synthesis?.answer).toContain('structured recovery path');
    expect(result.synthesisMode).toBe('heuristic');
    expect(result.llmError).toMatch(/timed out/i);
    expect(createQuickAnswerFn).toHaveBeenCalledTimes(1);
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
