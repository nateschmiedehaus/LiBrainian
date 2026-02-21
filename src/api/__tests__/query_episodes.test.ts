import { describe, it, expect } from 'vitest';
import type { ContextPack, LiBrainianQuery, LiBrainianResponse } from '../../types.js';
import { buildQueryEpisode } from '../query_episodes.js';

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

describe('buildQueryEpisode', () => {
  it('builds a discovery episode from a query response', () => {
    const query: LiBrainianQuery = {
      intent: 'How does auth flow work?',
      depth: 'L1',
      taskType: 'bugfix',
      affectedFiles: ['src/auth.ts'],
    };
    const packs = [createPack({ relatedFiles: ['src/auth.ts'] })];
    const response: LiBrainianResponse = {
      query,
      packs,
      disclosures: [],
      traceId: 'unverified_by_trace(replay_unavailable)',
      constructionPlan: {
        id: 'cp_episode',
        templateId: 'T1',
        ucIds: [],
        intent: query.intent ?? '',
        source: 'default',
        createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
      },
      totalConfidence: 0.5,
      cacheHit: false,
      latencyMs: 120,
      version: baseVersion,
      drillDownHints: [],
      synthesis: {
        answer: 'Answer',
        confidence: 0.4,
        citations: [],
        keyInsights: [],
        uncertainties: ['Missing tests'],
      },
      feedbackToken: 'fbk_test',
    };
    const timestamp = new Date('2026-01-19T01:00:00.000Z');

    const episode = buildQueryEpisode({
      query,
      response,
      timestamp,
      durationMs: 120,
      episodeId: 'episode-1',
    });

    expect(episode).not.toBeNull();
    expect(episode?.id).toBe('episode-1');
    expect(episode?.type).toBe('discovery');
    expect(episode?.context.environment).toBe('librainian.query');
    expect(episode?.context.state.intent).toBe(query.intent);
    expect(episode?.outcome.success).toBe(true);
    expect(episode?.outcome.duration).toBe(120);
    expect(episode?.metadata.feedbackToken).toBe('fbk_test');
    expect(episode?.events[0]?.type).toBe('query_completed');
  });

  it('returns null when intent is missing', () => {
    const query: LiBrainianQuery = { intent: '', depth: 'L0' };
    const episode = buildQueryEpisode({ query });
    expect(episode).toBeNull();
  });

  it('records a failed outcome when error is provided', () => {
    const query: LiBrainianQuery = { intent: 'Query', depth: 'L1' };
    const episode = buildQueryEpisode({
      query,
      error: 'boom',
      episodeId: 'episode-err',
    });
    expect(episode?.outcome.success).toBe(false);
    expect(episode?.outcome.error).toBe('boom');
    expect(episode?.events[0]?.type).toBe('query_failed');
  });
});
