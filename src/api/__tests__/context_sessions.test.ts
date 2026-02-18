import { describe, it, expect, vi } from 'vitest';
import type { LibrarianQuery, LibrarianResponse, ContextPack, LibrarianVersion } from '../../types.js';
import { ContextAssemblySessionManager } from '../context_sessions.js';

const version: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp',
  indexedAt: new Date('2026-01-19T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

function makePack(packId: string, relatedFile: string, summary: string): ContextPack {
  return {
    packId,
    packType: 'module_context',
    targetId: relatedFile,
    summary,
    keyFacts: [summary],
    codeSnippets: [],
    relatedFiles: [relatedFile],
    confidence: 0.8,
    createdAt: new Date('2026-01-19T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };
}

function makeResponse(query: LibrarianQuery, packs: ContextPack[], hints: string[] = []): LibrarianResponse {
  return {
    query,
    packs,
    disclosures: [],
    traceId: 'unverified_by_trace(replay_unavailable)',
    constructionPlan: {
      id: 'cp_session',
      templateId: 'T1',
      ucIds: [],
      intent: query.intent ?? '',
      source: 'default',
      createdAt: new Date('2026-01-19T00:00:00.000Z').toISOString(),
    },
    totalConfidence: 0.8,
    cacheHit: false,
    latencyMs: 12,
    version,
    drillDownHints: hints,
  };
}

describe('context assembly sessions', () => {
  it('accumulates follow-ups and drill-downs in a session', async () => {
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      if (query.intent.includes('refresh')) {
        return makeResponse(query, [makePack('pack_refresh', 'src/auth_refresh.ts', 'Refresh flow')], [
          'Check refresh token rotation',
        ]);
      }
      if (query.intent.startsWith('Drill down')) {
        return makeResponse(query, [makePack('pack_drill', 'src/auth.ts', 'Auth module internals')], [
          'Review auth guard usage',
        ]);
      }
      return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')], [
        'Inspect token refresh',
      ]);
    });

    const manager = new ContextAssemblySessionManager({
      query: queryRunner,
      now: () => '2026-01-19T00:00:00.000Z',
    });
    const session = await manager.start({ intent: 'auth overview', depth: 'L1' });
    expect(session.context.packs).toHaveLength(1);
    expect(session.history).toHaveLength(1);

    const followUp = await manager.followUp(session.sessionId, 'token refresh');
    expect(followUp.newPacks).toHaveLength(1);
    expect(followUp.session.context.packs).toHaveLength(2);
    expect(followUp.suggestedFollowUps[0]).toMatch(/refresh/i);

    const drillDown = await manager.drillDown(session.sessionId, 'src/auth.ts');
    expect(drillDown.newPacks).toHaveLength(1);
    expect(drillDown.session.context.exploredEntities).toContain('src/auth.ts');
    expect(drillDown.session.context.focusArea?.id).toBe('src/auth.ts');

    const summary = await manager.summarize(session.sessionId);
    expect(summary.packCount).toBe(3);
    expect(summary.keyFacts.length).toBeGreaterThan(0);

    await manager.close(session.sessionId);
    await expect(manager.followUp(session.sessionId, 'another question'))
      .rejects.toThrow(/context_session_missing/);
  });

  it('keeps session state stable when follow-up query fails', async () => {
    let callCount = 0;
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      callCount += 1;
      if (callCount === 1) {
        return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')]);
      }
      if (callCount === 2) {
        throw new Error('query failed');
      }
      return makeResponse(query, [makePack('pack_follow', 'src/auth_extra.ts', 'Follow-up data')]);
    });
    const manager = new ContextAssemblySessionManager({ query: queryRunner });
    const session = await manager.start({ intent: 'auth overview', depth: 'L1' });

    await expect(manager.followUp(session.sessionId, 'token refresh'))
      .rejects.toThrow(/query failed/);

    const followUp = await manager.followUp(session.sessionId, 'token refresh');
    expect(followUp.newPacks).toHaveLength(1);
    expect(followUp.session.context.packs).toHaveLength(2);
  });

  it('expires sessions based on TTL', async () => {
    let now = new Date('2026-01-19T00:00:00.000Z');
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')]);
    });
    const manager = new ContextAssemblySessionManager({
      query: queryRunner,
      now: () => now.toISOString(),
      sessionTtlMs: 10,
    });
    const session = await manager.start({ intent: 'auth overview', depth: 'L1' });
    now = new Date(now.getTime() + 50);
    await expect(manager.followUp(session.sessionId, 'token refresh'))
      .rejects.toThrow(/context_session_missing/);
  });

  it('rejects empty follow-up questions', async () => {
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')]);
    });
    const manager = new ContextAssemblySessionManager({ query: queryRunner });
    const session = await manager.start({ intent: 'auth overview', depth: 'L1' });
    await expect(manager.followUp(session.sessionId, ' '))
      .rejects.toThrow(/context_session_question_invalid/);
  });

  it('serializes concurrent follow-up calls', async () => {
    let callCount = 0;
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      callCount += 1;
      if (callCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return makeResponse(query, [
        makePack(`pack_follow_${callCount}`, `src/auth_${callCount}.ts`, `Follow-up ${callCount}`),
      ]);
    });
    const manager = new ContextAssemblySessionManager({ query: queryRunner });
    const session = await manager.start({ intent: 'auth overview', depth: 'L1' });

    await Promise.all([
      manager.followUp(session.sessionId, 'token refresh'),
      manager.followUp(session.sessionId, 'session cookies'),
    ]);

    const summary = await manager.summarize(session.sessionId);
    expect(summary.packCount).toBe(3);
  });

  it('can restore and snapshot session state across manager instances', async () => {
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      if (query.intent === 'auth overview') {
        return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')]);
      }
      return makeResponse(query, [makePack('pack_follow', 'src/auth_follow.ts', 'Follow-up')]);
    });
    const first = new ContextAssemblySessionManager({ query: queryRunner });
    const started = await first.start({ intent: 'auth overview', depth: 'L1' });
    const follow = await first.followUp(started.sessionId, 'token refresh');

    const second = new ContextAssemblySessionManager({ query: queryRunner });
    second.restore(follow.session);
    const snapshot = second.snapshot(started.sessionId);
    expect(snapshot.context.packs).toHaveLength(2);

    const next = await second.followUp(started.sessionId, 'session cookies');
    expect(next.session.context.packs).toHaveLength(2);
    expect(next.newPacks).toHaveLength(0);
  });

  it('enforces pack limits on follow-ups', async () => {
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      if (query.intent === 'auth overview') {
        return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')]);
      }
      return makeResponse(query, [makePack('pack_follow', 'src/auth_follow.ts', 'Follow-up')]);
    });
    const manager = new ContextAssemblySessionManager({
      query: queryRunner,
      maxPacksPerSession: 1,
    });
    const session = await manager.start({ intent: 'auth overview', depth: 'L1' });

    await expect(manager.followUp(session.sessionId, 'token refresh'))
      .rejects.toThrow(/context_session_pack_limit_exceeded/);
  });

  it('enforces session limits under concurrent starts', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const queryRunner = vi.fn(async (query: LibrarianQuery) => {
      await gate;
      return makeResponse(query, [makePack('pack_auth', 'src/auth.ts', 'Auth overview')]);
    });
    const manager = new ContextAssemblySessionManager({
      query: queryRunner,
      maxSessions: 1,
    });

    const firstStart = manager.start({ intent: 'auth overview', depth: 'L1' });
    const secondStart = manager.start({ intent: 'auth follow-up', depth: 'L1' });
    release();

    const results = await Promise.allSettled([firstStart, secondStart]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason?.message ?? String(rejection.reason))
      .toMatch(/context_session_limit_exceeded/);
    expect(queryRunner).toHaveBeenCalledTimes(1);
  });
});
