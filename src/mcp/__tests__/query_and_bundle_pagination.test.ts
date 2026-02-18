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
