import { describe, expect, it } from 'vitest';
import { __testing } from '../query.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { LibrarianVersion } from '../../types.js';

const TEST_VERSION: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0-test',
  qualityTier: 'full',
  indexedAt: new Date('2026-03-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

describe('query filename candidate injection', () => {
  it('injects module candidates for strong multi-word filename matches', async () => {
    const storage = {
      getFiles: async () => ([
        { path: 'src/api/query.ts' },
        { path: 'src/query/scoring.ts' },
        { path: 'src/constructions/processes/hallucinated_api_detector.ts' },
      ]),
      getModuleByPath: async (filePath: string) => ({
        id: `mod:${filePath}`,
        path: filePath,
        purpose: `Module ${filePath}`,
        exports: [],
        dependencies: [],
        confidence: 0.8,
      }),
      getFunctionsByPath: async () => [],
    } as unknown as LibrarianStorage;

    const result = await __testing.injectFilenameCandidates(
      'Where is the query pipeline implemented and what are its stages?',
      [],
      storage,
    );

    expect(result.added).toBeGreaterThan(0);
    expect(result.candidates.some((candidate) =>
      candidate.entityType === 'module' && candidate.path === 'src/api/query.ts'
    )).toBe(true);
  });

  it('scores the main query pipeline above sibling embedding pipelines for query-pipeline intents', async () => {
    const queryScore = __testing.scoreFeatureLocationMatch(
      'query pipeline',
      'src/api/query.ts',
      'queryLibrarian',
      'Main query pipeline that exposes getQueryPipelineStages and queryLibrarian.',
      'module',
    );
    const embeddingPipelineScore = __testing.scoreFeatureLocationMatch(
      'query pipeline',
      'src/api/embedding_providers/unified_embedding_pipeline.ts',
      'unified_embedding_pipeline',
      'Embedding pipeline for vector generation and provider orchestration.',
      'module',
    );

    expect(queryScore.relevance).toBeGreaterThan(embeddingPipelineScore.relevance);
  });

  it('adds pipeline stage facts for the main query pipeline module', async () => {
    const keyFacts: string[] = [];
    __testing.appendPipelineStageFacts(keyFacts, 'src/api/query.ts', ['queryLibrarian', 'getQueryPipelineStages']);
    expect(keyFacts.some((fact) => fact.startsWith('Pipeline stages: adequacy_scan'))).toBe(true);
  });

  it('injects explicit anchor paths even when lexical filename matching is weak', async () => {
    const storage = {
      getFiles: async () => ([
        { path: 'src/mcp/server.ts' },
        { path: 'src/cli/commands/mcp.ts' },
        { path: 'src/adapters/tool_adapter.ts' },
      ]),
      getModuleByPath: async (filePath: string) => ({
        id: `mod:${filePath}`,
        path: filePath,
        purpose: `Module ${filePath}`,
        exports: [],
        dependencies: [],
        confidence: 0.8,
      }),
      getFunctionsByPath: async () => [],
    } as unknown as LibrarianStorage;

    const result = await __testing.injectFilenameCandidates(
      'Where are MCP tool errors normalized into actionable retry/fallback guidance?',
      [],
      storage,
      ['src/mcp/server.ts', 'src/cli/commands/mcp.ts'],
    );

    expect(result.candidates.some((candidate) =>
      candidate.entityType === 'module' && candidate.path === 'src/mcp/server.ts'
    )).toBe(true);
    expect(result.candidates.some((candidate) =>
      candidate.entityType === 'module' && candidate.path === 'src/cli/commands/mcp.ts'
    )).toBe(true);
  });

  it('materializes a JIT module pack when a module candidate has no prebuilt pack', async () => {
    const storage = {
      getContextPackForTarget: async () => null,
      getContextPacks: async () => [],
      getModule: async (id: string) => ({
        id,
        path: 'src/api/query.ts',
        purpose: 'Main query pipeline that orchestrates retrieval stages',
        exports: ['queryLibrarian', 'getQueryPipelineDefinition'],
        dependencies: ['src/query/scoring.ts'],
        confidence: 0.8,
      }),
      getFunctionsByPath: async () => ([
        {
          id: 'fn:queryLibrarian',
          name: 'queryLibrarian',
          startLine: 1,
          endLine: 200,
        },
      ]),
      getMetadata: async () => ({ workspace: process.cwd() }),
      getVersion: async () => TEST_VERSION,
    } as unknown as LibrarianStorage;

    const packs = await __testing.collectCandidatePacks(storage, [{
      entityId: 'mod:src/api/query.ts',
      entityType: 'module',
      path: 'src/api/query.ts',
      semanticSimilarity: 0.5,
      confidence: 0.8,
      recency: 0.5,
      pagerank: 0,
      centrality: 0,
      communityId: null,
    }], 'L3');

    expect(packs).toHaveLength(1);
    expect(packs[0]?.packType).toBe('module_context');
    expect(packs[0]?.relatedFiles).toContain('src/api/query.ts');
    expect(packs[0]?.codeSnippets.length).toBeGreaterThan(0);
  });
});
