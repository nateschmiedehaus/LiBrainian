import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const { queryLibrarianMock } = vi.hoisted(() => ({
  queryLibrarianMock: vi.fn(),
}));

vi.mock('../../api/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../api/index.js')>('../../api/index.js');
  return {
    ...actual,
    queryLibrarian: queryLibrarianMock,
  };
});

import { createLibrarianMCPServer } from '../server.js';

describe('MCP query and context bundle pagination', () => {
  beforeEach(() => {
    queryLibrarianMock.mockReset();
  });

  it('paginates query packs and returns pagination metadata', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 'a', summary: 'one', keyFacts: [], relatedFiles: [], confidence: 0.9 },
        { packId: 'p2', packType: 'module_context', targetId: 'b', summary: 'two', keyFacts: [], relatedFiles: [], confidence: 0.8 },
        { packId: 'p3', packType: 'function_context', targetId: 'c', summary: 'three', keyFacts: [], relatedFiles: [], confidence: 0.7 },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-1',
      constructionPlan: undefined,
      totalConfidence: 0.8,
      cacheHit: false,
      latencyMs: 12,
      drillDownHints: [],
      synthesis: 'answer',
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    const result = await (server as any).executeQuery({
      workspace,
      intent: 'test',
      pageSize: 2,
      pageIdx: 1,
    });

    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]?.packId).toBe('p3');
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.pageIdx).toBe(1);
    expect(result.pagination.totalItems).toBe(3);
    expect(result.pagination.pageCount).toBe(2);
    expect(result.pagination.showing).toBe('Showing 3-3 of 3. Next: none. Total pages: 2.');
  });

  it('writes query page payload to outputFile and returns reference metadata', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-query-'));
    const outputFile = path.join(tmpDir, 'query-page.json');

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 'a', summary: 'one', keyFacts: [], relatedFiles: [], confidence: 0.9 },
        { packId: 'p2', packType: 'module_context', targetId: 'b', summary: 'two', keyFacts: [], relatedFiles: [], confidence: 0.8 },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-2',
      constructionPlan: undefined,
      totalConfidence: 0.85,
      cacheHit: false,
      latencyMs: 11,
      drillDownHints: [],
      synthesis: 'answer',
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    const result = await (server as any).executeQuery({
      workspace,
      intent: 'test',
      pageSize: 1,
      pageIdx: 0,
      outputFile,
    });

    expect(result.filePath).toBe(outputFile);
    expect(result.totalItems).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(result.summary).toBe('Showing 1-1 of 2. Next: pageIdx=1. Total pages: 2.');
    expect(result.packs).toBeUndefined();

    const saved = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    expect(saved.packs).toHaveLength(1);
    expect(saved.pagination.totalItems).toBe(2);
  });

  it('sanitizes epistemic disclosures and traceId in query output', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 'a', summary: 'one', keyFacts: [], relatedFiles: [], confidence: 0.9 },
      ],
      disclosures: ['unverified_by_trace(storage_write_degraded): Session degraded due to lock contention.'],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'unverified_by_trace(replay_unavailable)',
      constructionPlan: undefined,
      totalConfidence: 0.7,
      cacheHit: false,
      latencyMs: 11,
      drillDownHints: [],
      synthesis: 'answer',
      synthesisMode: 'heuristic',
      llmError: 'unverified_by_trace(provider_unavailable): Embedding provider unavailable',
    });

    const result = await (server as any).executeQuery({
      workspace,
      intent: 'test',
    });

    expect(result.disclosures).toEqual(['Session degraded due to lock contention.']);
    expect(result.traceId).toBe('replay_unavailable');
    expect(result.llmError).toBe('Embedding provider unavailable');
    expect(result.epistemicsDebug).toEqual(
      expect.arrayContaining([
        'unverified_by_trace(storage_write_degraded): Session degraded due to lock contention.',
      ])
    );
    expect(result.disclosures.join(' ')).not.toContain('unverified_by_trace');
  });

  it('returns retrievalStatus even when query response omits it', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 'a', summary: 'one', keyFacts: [], relatedFiles: [], confidence: 0.2 },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-1',
      constructionPlan: undefined,
      totalConfidence: 0.2,
      cacheHit: false,
      latencyMs: 12,
      drillDownHints: [],
      synthesis: undefined,
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    const result = await (server as any).executeQuery({
      workspace,
      intent: 'users get logged out randomly',
    });

    expect(result.retrievalStatus).toBe('insufficient');
    expect(result.retrievalInsufficient).toBe(true);
  });

  it('detects futile repeated queries per session and escalates strategy', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const sessionId = 'sess-loop';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-loop',
      constructionPlan: undefined,
      totalConfidence: 0,
      cacheHit: false,
      latencyMs: 5,
      drillDownHints: [],
      synthesis: undefined,
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    const first = await (server as any).executeQuery({ workspace, intent: 'find jwt refresh token handler', sessionId });
    const second = await (server as any).executeQuery({ workspace, intent: 'find jwt refresh token handler', sessionId });
    const third = await (server as any).executeQuery({ workspace, intent: 'find jwt refresh token handler', sessionId });

    expect(first.loopDetection).toBeUndefined();
    expect(second.loopDetection?.detected).toBe(true);
    expect(second.loopDetection?.pattern).toBe('futile_repeat');
    expect(second.loop_detection?.detected).toBe(true);
    expect(third.loopDetection?.occurrences).toBeGreaterThanOrEqual(3);
    expect(queryLibrarianMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        depth: 'L2',
        minConfidence: 0.2,
      }),
      expect.anything(),
      undefined,
      undefined,
      undefined,
      expect.anything()
    );
  });

  it('resets loop detection state with reset_session_state', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const sessionId = 'sess-reset';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-reset',
      constructionPlan: undefined,
      totalConfidence: 0,
      cacheHit: false,
      latencyMs: 5,
      drillDownHints: [],
      synthesis: undefined,
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    await (server as any).executeQuery({ workspace, intent: 'missing symbol one', sessionId });
    await (server as any).executeQuery({ workspace, intent: 'missing symbol one', sessionId });

    const reset = await (server as any).executeResetSessionState({ sessionId });
    expect(reset.success).toBe(true);
    expect(reset.clearedQueries).toBeGreaterThanOrEqual(2);
  });

  it('adds human review recommendation when retrieval confidence is uncertain', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({});

    queryLibrarianMock.mockResolvedValue({
      packs: [
        { packId: 'p1', packType: 'function_context', targetId: 'a', summary: 'auth update', keyFacts: [], relatedFiles: [], confidence: 0.45 },
        { packId: 'p2', packType: 'function_context', targetId: 'b', summary: 'auth update alt', keyFacts: [], relatedFiles: [], confidence: 0.42 },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-review',
      constructionPlan: undefined,
      totalConfidence: 0.48,
      cacheHit: false,
      latencyMs: 7,
      drillDownHints: [],
      synthesis: undefined,
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    const result = await (server as any).executeQuery({
      workspace,
      intent: 'delete auth token refresh implementation',
      intentType: 'refactor',
    });

    expect(result.humanReviewRecommendation?.recommended).toBe(true);
    expect(result.humanReviewRecommendation?.tool).toBe('request_human_review');
    expect(result.humanReviewRecommendation?.riskLevel).toBe('high');
    expect(result.human_review_recommendation?.recommended).toBe(true);
  });

  it('returns actionable fixes when workspace is not registered', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const missingWorkspace = '/tmp/not-registered-workspace';
    const result = await (server as any).executeQuery({
      workspace: missingWorkspace,
      intent: 'test',
    });

    expect(result.error).toContain('Specified workspace not registered');
    expect(result.disclosures.join(' ')).not.toContain('unverified_by_trace');
    expect(result.fix).toEqual(
      expect.arrayContaining([
        `Run \`librarian bootstrap --workspace ${missingWorkspace}\` to register and index this workspace.`,
      ])
    );
    expect(result.epistemicsDebug.join(' ')).toContain('unverified_by_trace(workspace_unavailable)');
    expect(result.traceId).toBe('replay_unavailable');
  });

  it('paginates get_context_pack_bundle pack output', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getContextPackForTarget: vi.fn().mockImplementation(async (entityId: string, packType: string) => ({
        packId: `${entityId}-${packType}`,
        packType,
        targetId: entityId,
        summary: `summary:${entityId}:${packType}`,
        keyFacts: [],
        relatedFiles: [],
        confidence: 0.9,
      })),
    });

    const result = await (server as any).executeGetContextPackBundle({
      entityIds: ['entity-a', 'entity-b'],
      bundleType: 'standard',
      pageSize: 2,
      pageIdx: 1,
    });

    expect(result.packs).toHaveLength(2);
    expect(result.pagination.pageSize).toBe(2);
    expect(result.pagination.pageIdx).toBe(1);
    expect(result.pagination.totalItems).toBe(4);
    expect(result.pagination.pageCount).toBe(2);
  });

  it('uses token_budget estimator when enforcing get_context_pack_bundle maxTokens', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    const heavySummary = 'x'.repeat(360);
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getContextPackForTarget: vi.fn().mockResolvedValue({
        packId: 'entity-a-function_context',
        packType: 'function_context',
        targetId: 'entity-a',
        summary: heavySummary,
        keyFacts: ['const handler = async () => { return "token-heavy-code-path"; }'],
        relatedFiles: ['src/api/heavy.ts'],
        confidence: 0.9,
      }),
    });

    const projectedPack = {
      packId: 'entity-a-function_context',
      packType: 'function_context',
      targetId: 'entity-a',
      summary: heavySummary,
      keyFacts: ['const handler = async () => { return "token-heavy-code-path"; }'],
      relatedFiles: ['src/api/heavy.ts'],
      confidence: 0.9,
    };

    const legacyEstimate = Math.ceil(JSON.stringify(projectedPack).length / 4);
    const result = await (server as any).executeGetContextPackBundle({
      entityIds: ['entity-a'],
      bundleType: 'minimal',
      maxTokens: legacyEstimate,
    });

    // With the shared token_budget estimator (~chars/3.5), this pack no longer fits.
    expect(result.truncatedByTokens).toBe(true);
    expect(result.packs).toHaveLength(0);
    expect(result.estimatedTokens).toBe(0);
  });

  it('writes get_context_pack_bundle page payload to outputFile', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-mcp-bundle-'));
    const outputFile = path.join(tmpDir, 'bundle-page.json');

    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });

    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getContextPackForTarget: vi.fn().mockImplementation(async (entityId: string, packType: string) => ({
        packId: `${entityId}-${packType}`,
        packType,
        targetId: entityId,
        summary: `summary:${entityId}:${packType}`,
        keyFacts: [],
        relatedFiles: [],
        confidence: 0.9,
      })),
    });

    const result = await (server as any).executeGetContextPackBundle({
      entityIds: ['entity-a', 'entity-b'],
      bundleType: 'standard',
      pageSize: 1,
      pageIdx: 0,
      outputFile,
    });

    expect(result.filePath).toBe(outputFile);
    expect(result.totalItems).toBe(4);
    expect(result.pageCount).toBe(4);
    expect(result.summary).toBe('Showing 1-1 of 4. Next: pageIdx=1. Total pages: 4.');
    expect(result.packs).toBeUndefined();

    const saved = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    expect(saved.packs).toHaveLength(1);
    expect(saved.pagination.totalItems).toBe(4);
  });
});
