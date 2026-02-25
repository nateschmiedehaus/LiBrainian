import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('MCP strategic contract tools', () => {
  beforeEach(() => {
    queryLibrarianMock.mockReset();
  });

  it('lists strategic contracts with consumers, producers, and evidence', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: {} as any, indexState: 'ready' });

    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getStrategicContracts: vi.fn().mockResolvedValue([
        {
          id: 'strategic-contract:provider:api',
          contractType: 'api',
          name: 'provider api',
          version: '1.2.0',
          location: '/tmp/workspace/src/provider.ts',
          breaking: false,
          consumers: ['module-consumer-a'],
          producers: ['module-provider'],
          evidence: ['exports:4', 'callers:12'],
          updatedAt: '2026-02-25T00:00:00.000Z',
        },
      ]),
    });

    const result = await (server as any).executeListStrategicContracts({ workspace });
    expect(result.success).toBe(true);
    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0]?.consumers).toEqual(['module-consumer-a']);
    expect(result.contracts[0]?.producers).toEqual(['module-provider']);
    expect(result.contracts[0]?.evidence).toEqual(['exports:4', 'callers:12']);
  });

  it('gets a single strategic contract by id', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { librarian: {} as any, indexState: 'ready' });

    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getStrategicContract: vi.fn().mockResolvedValue({
        id: 'strategic-contract:provider:api',
        contractType: 'api',
        name: 'provider api',
        version: '1.2.0',
        location: '/tmp/workspace/src/provider.ts',
        breaking: true,
        consumers: ['module-consumer-a'],
        producers: ['module-provider'],
        evidence: ['exports:4', 'callers:12'],
        updatedAt: '2026-02-25T00:00:00.000Z',
      }),
    });

    const result = await (server as any).executeGetStrategicContract({
      workspace,
      contractId: 'strategic-contract:provider:api',
    });
    expect(result.success).toBe(true);
    expect(result.contract?.id).toBe('strategic-contract:provider:api');
    expect(result.contract?.breaking).toBe(true);
  });

  it('injects relevant strategic contract context into query responses', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getState: vi.fn(async () => null),
      setState: vi.fn(async () => undefined),
      getStrategicContracts: vi.fn().mockResolvedValue([
        {
          id: 'strategic-contract:provider:api',
          contractType: 'api',
          name: 'provider api',
          version: '1.2.0',
          location: '/tmp/workspace/src/provider.ts',
          breaking: false,
          consumers: ['module-consumer-a'],
          producers: ['module-provider-a'],
          evidence: ['exports:4', 'callers:12'],
          updatedAt: '2026-02-25T00:00:00.000Z',
        },
      ]),
    });

    queryLibrarianMock.mockResolvedValue({
      packs: [
        {
          packId: 'pack-1',
          packType: 'module_context',
          targetId: 'module-provider-a',
          summary: 'provider module',
          keyFacts: [],
          relatedFiles: ['/tmp/workspace/src/provider.ts'],
          confidence: 0.87,
        },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-strategic-contracts',
      constructionPlan: undefined,
      totalConfidence: 0.87,
      cacheHit: false,
      latencyMs: 6,
      drillDownHints: [],
      synthesis: 'answer',
      synthesisMode: 'heuristic',
      llmError: undefined,
    });

    const result = await (server as any).executeQuery({
      workspace,
      intent: 'how does provider contract affect consumers',
    });

    expect(result.strategic_contract_status).toBe('included');
    expect(result.strategic_contracts).toHaveLength(1);
    expect(result.strategic_contracts[0]?.id).toBe('strategic-contract:provider:api');
    expect(result.strategic_contracts[0]?.consumers).toContain('module-consumer-a');
    expect(result.strategic_contracts[0]?.producers).toContain('module-provider-a');
  });

  it('fails closed with unavailable strategic contract context in context-pack bundles', async () => {
    const server = await createLibrarianMCPServer({
      authorization: { enabledScopes: ['read'], requireConsent: false },
    });

    const workspace = '/tmp/workspace';
    server.registerWorkspace(workspace);
    server.updateWorkspaceState(workspace, { indexState: 'ready' });
    (server as any).getOrCreateStorage = vi.fn().mockResolvedValue({
      getContextPackForTarget: vi.fn().mockResolvedValue({
        packId: 'module-provider-a-module_context',
        packType: 'module_context',
        targetId: 'module-provider-a',
        summary: 'provider module',
        keyFacts: [],
        relatedFiles: ['/tmp/workspace/src/provider.ts'],
        confidence: 0.9,
      }),
      getStrategicContracts: vi.fn().mockRejectedValue(new Error('strategic contract storage unavailable')),
    });

    const result = await (server as any).executeGetContextPackBundle({
      entityIds: ['module-provider-a'],
      bundleType: 'minimal',
    });

    expect(result.packs).toHaveLength(1);
    expect(result.strategic_contract_status).toBe('unavailable');
    expect(result.strategic_contracts).toHaveLength(0);
    expect(typeof result.strategic_contract_unavailable_reason).toBe('string');
  });
});
