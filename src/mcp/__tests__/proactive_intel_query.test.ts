import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LiBrainianStorage } from '../../storage/index.js';

const { queryLiBrainianMock, submitQueryFeedbackMock } = vi.hoisted(() => ({
  queryLiBrainianMock: vi.fn(),
  submitQueryFeedbackMock: vi.fn(),
}));

vi.mock('../../api/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../api/index.js')>('../../api/index.js');
  return {
    ...actual,
    queryLiBrainian: queryLiBrainianMock,
  };
});

vi.mock('../../integration/agent_protocol.js', async () => {
  const actual = await vi.importActual<typeof import('../../integration/agent_protocol.js')>('../../integration/agent_protocol.js');
  return {
    ...actual,
    submitQueryFeedback: submitQueryFeedbackMock,
  };
});

import { createLiBrainianMCPServer } from '../server.js';

interface ProactiveHarnessServer {
  registerWorkspace(workspacePath: string): void;
  updateWorkspaceState(
    workspacePath: string,
    state: { indexState: 'ready'; storage: LiBrainianStorage },
  ): void;
  executeQuery(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  executeSubmitFeedback(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  callTool(name: string, args: Record<string, unknown>): Promise<{
    isError?: boolean;
    content?: Array<{ text?: string }>;
  }>;
}

interface ProactiveIntelPayloadItem {
  type?: string;
  tokens?: number;
}

function makeStorageMock(state: Map<string, string>, options: {
  filePath: string;
  partnerPath: string;
  delayMs?: number;
}) {
  const delayMs = typeof options.delayMs === 'number' && options.delayMs > 0
    ? options.delayMs
    : 0;
  const delay = async (): Promise<void> => {
    if (delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  };
  return {
    getState: vi.fn(async (key: string) => state.get(key) ?? null),
    setState: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
    getUniversalKnowledgeByFile: vi.fn(async (file: string) => {
      await delay();
      if (path.resolve(file) !== path.resolve(options.filePath)) return [];
      return [
        {
          purposeSummary: 'Handles JWT verification and refresh token enforcement.',
          riskScore: 0.92,
          maintainabilityIndex: 42,
          knowledge: JSON.stringify({
            history: {
              churnHistory: {
                changesLast7Days: 6,
              },
            },
          }),
        },
      ];
    }),
    getOwnershipByFilePath: vi.fn(async (file: string) => {
      await delay();
      if (path.resolve(file) !== path.resolve(options.filePath)) return [];
      return [
        {
          author: '@sarah',
          score: 0.91,
          lastModified: new Date(Date.now() - (23 * 24 * 60 * 60 * 1000)),
        },
      ];
    }),
    getCochangeEdges: vi.fn(async ({ fileA }: { fileA?: string }) => {
      await delay();
      if (!fileA || path.resolve(fileA) !== path.resolve(options.filePath)) return [];
      return [
        {
          fileA: options.filePath,
          fileB: options.partnerPath,
          strength: 0.87,
          changeCount: 11,
          totalChanges: 20,
        },
      ];
    }),
    getAssessmentByPath: vi.fn(async (file: string) => {
      await delay();
      if (path.resolve(file) !== path.resolve(options.filePath)) return null;
      return {
        healthScore: 51,
        overallHealth: 'at-risk',
      };
    }),
  };
}

describe('MCP query proactive intel', () => {
  let workspace: string;
  let filePath: string;
  let partnerPath: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-mcp-proactive-query-'));
    filePath = path.join(workspace, 'src/auth.ts');
    partnerPath = path.join(workspace, 'src/config/auth.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.mkdir(path.dirname(partnerPath), { recursive: true });
    await fs.writeFile(filePath, 'export function verify() { return true; }\n', 'utf8');
    await fs.writeFile(partnerPath, 'export const AUTH_MODE = "jwt";\n', 'utf8');
    queryLiBrainianMock.mockReset();
    submitQueryFeedbackMock.mockReset();
    submitQueryFeedbackMock.mockResolvedValue({
      success: true,
      adjustmentsApplied: 2,
    });
    process.env = { ...originalEnv };
    delete process.env.LIBRARIAN_PROACTIVE_THRESHOLD;
    delete process.env.LIBRARIAN_PROACTIVE_TOKEN_BUDGET;
    delete process.env.LIBRARIAN_PROACTIVE_SECURITY_BYPASS;
    delete process.env.LIBRARIAN_PROACTIVE_INTEL_ENABLED;
    delete process.env.LIBRARIAN_PROACTIVE_MAX_ASSEMBLY_MS;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function createServerWithStorage(options?: { delayMs?: number }) {
    const server = await createLiBrainianMCPServer({
      authorization: { enabledScopes: ['read', 'write'], requireConsent: false },
    });
    const harness = server as unknown as ProactiveHarnessServer;
    const state = new Map<string, string>();
    const storage = makeStorageMock(state, { filePath, partnerPath, delayMs: options?.delayMs });
    harness.registerWorkspace(workspace);
    harness.updateWorkspaceState(workspace, {
      indexState: 'ready',
      storage: storage as unknown as LiBrainianStorage,
    });
    return { server: harness, state };
  }

  function mockQueryResponse(feedbackToken = 'fbk_query') {
    queryLiBrainianMock.mockResolvedValue({
      packs: [
        {
          packId: 'pack-auth',
          packType: 'function_context',
          targetId: 'fn-auth',
          summary: 'Auth module context.',
          keyFacts: ['Validates JWT payload and expiration.'],
          relatedFiles: [filePath],
          confidence: 0.91,
        },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-proactive',
      constructionPlan: undefined,
      totalConfidence: 0.91,
      cacheHit: false,
      latencyMs: 8,
      drillDownHints: [],
      synthesis: 'Auth summary',
      synthesisMode: 'heuristic',
      llmError: undefined,
      feedbackToken,
    });
  }

  it('injects proactiveIntel in query responses when indexed signals are relevant', async () => {
    const { server } = await createServerWithStorage();
    mockQueryResponse('fbk_proactive');

    const result = await server.executeQuery({
      workspace,
      intent: 'Explain auth changes',
      sessionId: 'sess-proactive',
      agentId: 'codex-cli',
      affectedFiles: [filePath],
    });
    expect(Array.isArray(result.proactiveIntel)).toBe(true);
    const proactiveIntel = result.proactiveIntel as ProactiveIntelPayloadItem[];
    expect(proactiveIntel.length).toBeGreaterThan(0);
    expect(proactiveIntel.some((item) => item.type === 'security-alert')).toBe(true);
    expect(result.proactive_intel).toEqual(result.proactiveIntel);
  });

  it('uses declared affectedFiles as proactive candidates when packs have no related files', async () => {
    const { server } = await createServerWithStorage();
    queryLiBrainianMock.mockResolvedValue({
      packs: [
        {
          packId: 'pack-auth-no-files',
          packType: 'function_context',
          targetId: 'fn-auth',
          summary: 'Auth module context.',
          keyFacts: ['Validates JWT payload and expiration.'],
          relatedFiles: [],
          confidence: 0.9,
        },
      ],
      disclosures: [],
      adequacy: undefined,
      verificationPlan: undefined,
      traceId: 'trace-proactive-fallback',
      constructionPlan: undefined,
      totalConfidence: 0.9,
      cacheHit: false,
      latencyMs: 7,
      drillDownHints: [],
      synthesis: 'Auth summary',
      synthesisMode: 'heuristic',
      llmError: undefined,
      feedbackToken: 'fbk_fallback',
    });

    const result = await server.executeQuery({
      workspace,
      intent: 'Explain auth changes',
      sessionId: 'sess-proactive-fallback',
      agentId: 'codex-cli',
      affectedFiles: [filePath],
    });
    expect(Array.isArray(result.proactiveIntel)).toBe(true);
    const proactiveIntel = result.proactiveIntel as ProactiveIntelPayloadItem[];
    expect(proactiveIntel.length).toBeGreaterThan(0);
    expect(proactiveIntel.some((item) => item.type === 'security-alert')).toBe(true);
  });

  it('always injects security alerts when security bypass is enabled, even above threshold', async () => {
    process.env.LIBRARIAN_PROACTIVE_THRESHOLD = '0.99';
    process.env.LIBRARIAN_PROACTIVE_SECURITY_BYPASS = 'true';
    const { server } = await createServerWithStorage();
    mockQueryResponse('fbk_security');

    const result = await server.executeQuery({
      workspace,
      intent: 'Auth risk review',
      sessionId: 'sess-security',
      affectedFiles: [filePath],
    });

    expect(Array.isArray(result.proactiveIntel)).toBe(true);
    const proactiveIntel = result.proactiveIntel as ProactiveIntelPayloadItem[];
    expect(proactiveIntel.length).toBeGreaterThan(0);
    expect(proactiveIntel.some((item) => item.type === 'security-alert')).toBe(true);
  });

  it('enforces proactive token budget by dropping lower-ranked items', async () => {
    process.env.LIBRARIAN_PROACTIVE_TOKEN_BUDGET = '60';
    const { server } = await createServerWithStorage();
    mockQueryResponse('fbk_budget');

    const result = await server.executeQuery({
      workspace,
      intent: 'Auth module impact',
      sessionId: 'sess-budget',
      affectedFiles: [filePath],
    });

    const proactive = Array.isArray(result.proactiveIntel) ? result.proactiveIntel as ProactiveIntelPayloadItem[] : [];
    const tokenTotal = proactive.reduce((sum: number, item) => sum + (item.tokens ?? 0), 0);
    expect(tokenTotal).toBeLessThanOrEqual(60);
    expect(proactive.length).toBeGreaterThan(0);
    expect(proactive.length).toBeLessThan(6);
  });

  it('supports per-request opt-out with proactiveIntel: false', async () => {
    const { server } = await createServerWithStorage();
    mockQueryResponse('fbk_optout');

    const result = await server.executeQuery({
      workspace,
      intent: 'Auth module impact',
      proactiveIntel: false,
      sessionId: 'sess-optout',
      affectedFiles: [filePath],
    });

    expect(result.proactiveIntel).toBeUndefined();
  });

  it('suppresses proactive intel and logs a timing violation when assembly exceeds max budget', async () => {
    process.env.LIBRARIAN_PROACTIVE_MAX_ASSEMBLY_MS = '1';
    const { server } = await createServerWithStorage({ delayMs: 4 });
    mockQueryResponse('fbk_timing');

    const result = await server.executeQuery({
      workspace,
      intent: 'Auth module impact',
      sessionId: 'sess-timing',
      affectedFiles: [filePath],
    });

    expect(result.proactiveIntel).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 30));
    const auditPath = path.join(workspace, '.librainian', 'audit-log.jsonl');
    const auditRaw = await fs.readFile(auditPath, 'utf8');
    const events = auditRaw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { event?: string });
    expect(events.some((entry) => entry.event === 'proactive_intel_timing_violation')).toBe(true);
  });

  it('delivers proactiveIntel through callTool query payload for MCP clients', async () => {
    const { server } = await createServerWithStorage();
    mockQueryResponse('fbk_calltool');

    const result = await server.callTool('query', {
      workspace,
      intent: 'Auth risk review',
      sessionId: 'sess-calltool',
      affectedFiles: [filePath],
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
    expect(Array.isArray(payload.proactiveIntel)).toBe(true);
    expect(payload.proactiveIntel.length).toBeGreaterThan(0);
  });

  it('auto-calibrates and persists category weights from feedback outcomes', async () => {
    const { server, state } = await createServerWithStorage();
    mockQueryResponse('fbk_calibration');

    const queryResult = await server.executeQuery({
      workspace,
      intent: 'Auth behavior summary',
      sessionId: 'sess-calibration',
      agentId: 'codex-cli',
      affectedFiles: [filePath],
    });
    expect(Array.isArray(queryResult.proactiveIntel)).toBe(true);
    expect(queryResult.proactiveIntel.length).toBeGreaterThan(0);

    const feedbackResult = await server.executeSubmitFeedback({
      workspace,
      feedbackToken: 'fbk_calibration',
      outcome: 'failure',
      agentId: 'codex-cli',
      missingContext: 'This proactive hint was irrelevant noise for the task.',
    });

    expect(feedbackResult.success).toBe(true);
    expect((feedbackResult.proactiveCalibration as { signal?: string } | undefined)?.signal).toBe('dismissed');

    const raw = state.get('librarian.mcp.proactive_intel_weights.v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw));
    expect(parsed.sessions['sess-calibration'].weights.security).toBeLessThan(1);
    expect(parsed.agents['codex-cli'].weights.security).toBeLessThan(1);
  });
});
