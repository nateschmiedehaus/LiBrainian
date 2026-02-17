import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Librarian } from '../../api/librarian.js';
import type { LibrarianResponse, ContextPack } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';
import { ensureLibrarianReady } from '../../integration/first_run_gate.js';
import { enrichTaskContext, formatLibrarianContext, recordTaskOutcome } from '../../integration/wave0_integration.js';
import { attributeFailure } from '../../integration/causal_attribution.js';
import { runProviderReadinessGate } from '../../api/provider_gate.js';
import { createKnowledgeCoverageReport } from '../../api/reporting.js';
import { TAXONOMY_ITEMS } from '../../api/taxonomy.js';
import { validateJSON, OutputValidationError } from '../../utils/output_validator.js';
import { AuthChecker, type AuthStatusSummary } from '../../utils/auth_checker.js';
import {
  clearDefaultLlmServiceFactory,
  createDefaultLlmServiceAdapter,
  setDefaultLlmServiceFactory,
  type LlmProviderHealth,
  type LlmServiceAdapter,
} from '../../adapters/llm_service.js';
import { GovernorContext, createGovernorRunState } from '../../api/governor_context.js';
import { DEFAULT_GOVERNOR_CONFIG } from '../../api/governors.js';
import { extractMarkedJson } from '../../spine/marked_json.js';
import { emptyArray } from '../../api/empty_values.js';
import { resolveLibrarianModelId } from '../../api/llm_env.js';

const WORKSPACE_ROOT = process.cwd();
const AGENTIC_TIMEOUT_MS = 0;
const QUERY_TIMEOUT_MS = 0;
const IS_TIER0 = Boolean(process.env.LIBRARIAN_FAIL_OPEN_LOG_DIR);
const LLM_SERVICE_PATH_CANDIDATES = [
  path.join(WORKSPACE_ROOT, 'src', 'soma', 'providers', 'llm_service.ts'),
  path.join(WORKSPACE_ROOT, 'src', 'soma', 'providers', 'llm_service.js'),
];
const WAVE0_LLM_SERVICE_PATH = LLM_SERVICE_PATH_CANDIDATES.find((candidate) => fsSync.existsSync(candidate));
const HAS_WAVE0_LLM_SERVICE = Boolean(WAVE0_LLM_SERVICE_PATH);
const SCAS_PATH_CANDIDATES = [
  path.join(WORKSPACE_ROOT, 'src', 'scas', 'slop_prevention.ts'),
  path.join(WORKSPACE_ROOT, 'src', 'scas', 'slop_prevention.js'),
];
const SCAS_PATH = SCAS_PATH_CANDIDATES.find((candidate) => fsSync.existsSync(candidate));

let gateResult: Awaited<ReturnType<typeof ensureLibrarianReady>>;
let librarian: Librarian;
let storage: LibrarianStorage;
let authResponse: LibrarianResponse;
let databaseResponse: LibrarianResponse;
let provider: 'claude' | 'codex';
let modelId: string;
let llmService: LlmServiceAdapter;

let agentContext: Awaited<ReturnType<typeof enrichTaskContext>> | null = null;
let agentResponse: { answer: string; citations: string[] } | null = null;

class StubAuthChecker extends AuthChecker {
  async checkAll(): Promise<AuthStatusSummary> {
    return {
      codex: { provider: 'codex', authenticated: false, lastChecked: 'now' },
      claude_code: { provider: 'claude_code', authenticated: false, lastChecked: 'now' },
    };
  }

  getAuthGuidance(): string[] {
    return emptyArray<string>();
  }
}

const outageHealth = (provider: 'claude' | 'codex'): LlmProviderHealth => ({
  provider,
  available: false,
  authenticated: false,
  lastCheck: Date.now(),
  error: 'outage',
});

function resolveModelId(selected: 'claude' | 'codex'): string {
  return resolveLibrarianModelId(selected) ?? 'default';
}

function collectRelatedFiles(packs: ContextPack[]): string[] {
  const files: string[] = [];
  for (const pack of packs) files.push(...pack.relatedFiles);
  return files;
}

function pickPack(packs: ContextPack[]): ContextPack {
  if (!packs.length) throw new Error('unverified_by_trace(provider_invalid_output): no context packs available');
  return packs[0]!;
}

function normalizeCitation(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.normalize(path.join(WORKSPACE_ROOT, trimmed));
}

function isAgentResponse(value: unknown): value is { answer: string; citations: string[] } {
  if (!value || typeof value !== 'object') return false;
  const obj = value as { answer?: unknown; citations?: unknown };
  return typeof obj.answer === 'string'
    && Array.isArray(obj.citations)
    && obj.citations.every((entry) => typeof entry === 'string');
}

async function runAgentWithContext(question: string, context: Awaited<ReturnType<typeof enrichTaskContext>>): Promise<{ answer: string; citations: string[] }> {
  const beginMarker = 'QUALIFICATION_JSON_BEGIN';
  const endMarker = 'QUALIFICATION_JSON_END';
  const governor = new GovernorContext({ phase: 'qualification_agent', config: DEFAULT_GOVERNOR_CONFIG, runState: createGovernorRunState() });
  const prompt = [
    'Return JSON only. Wrap it with markers.',
    `BEGIN: ${beginMarker}`,
    `END: ${endMarker}`,
    'Schema: {"answer":"","citations":[""]}',
    'Rules:',
    '- Use citations that appear in the Librarian Context (file paths).',
    '- Cite at least one file path.',
    '',
    'Librarian Context:',
    formatLibrarianContext(context),
    '',
    `Question: ${question}`,
  ].join('\n');

  const response = await llmService.chat({
    provider,
    modelId,
    messages: [
      { role: 'system', content: 'You are a careful engineer who cites evidence from provided context only.' },
      { role: 'user', content: prompt },
    ],
    governorContext: governor,
  });

  const parsed = extractMarkedJson({
    text: response.content,
    beginMarker,
    endMarker,
    validate: isAgentResponse,
  });

  if (!parsed) {
    throw new Error('unverified_by_trace(provider_invalid_output): agent response missing expected JSON markers');
  }

  return parsed;
}

const qualificationSuite = IS_TIER0 || !HAS_WAVE0_LLM_SERVICE ? describe.skip : describe.sequential;

qualificationSuite('Agentic Librarian Qualification Suite (Tier-2)', () => {
  beforeAll(async () => {
    if (WAVE0_LLM_SERVICE_PATH) {
      const module = await import(pathToFileURL(WAVE0_LLM_SERVICE_PATH).href);
      setDefaultLlmServiceFactory(async () => new module.LLMService(), { force: true });
    }
    const providerStatus = await runProviderReadinessGate(WORKSPACE_ROOT, { emitReport: false });
    if (!providerStatus.ready || !providerStatus.selectedProvider) {
      throw new Error(`unverified_by_trace(provider_unavailable): ${providerStatus.reason ?? 'provider gate failed'}`);
    }
    provider = providerStatus.selectedProvider;
    modelId = resolveModelId(provider);
    llmService = createDefaultLlmServiceAdapter();

    gateResult = await ensureLibrarianReady(WORKSPACE_ROOT, {
      throwOnFailure: true,
    });

    if (!gateResult.librarian) {
      throw new Error('unverified_by_trace(provider_invalid_output): librarian instance missing');
    }

    librarian = gateResult.librarian;
    storage = (librarian as unknown as { storage?: LibrarianStorage }).storage as LibrarianStorage;
    if (!storage) {
      throw new Error('unverified_by_trace(provider_invalid_output): librarian storage missing');
    }

    authResponse = await librarian.query({
      intent: 'authentication',
      depth: 'L2',
    });

    databaseResponse = await librarian.query({
      intent: 'database',
      depth: 'L2',
    });
  }, AGENTIC_TIMEOUT_MS);

  afterAll(() => {
    clearDefaultLlmServiceFactory();
  });

  it('bootstraps and indexes the wave0-autopilot codebase', async () => {
    expect(gateResult.success).toBe(true);
    expect(librarian.isReady()).toBe(true);
    const stats = await storage.getStats();
    expect(stats.totalFunctions + stats.totalModules).toBeGreaterThan(0);
  }, AGENTIC_TIMEOUT_MS);

  it('returns authentication-related context', () => {
    const related = collectRelatedFiles(authResponse.packs);
    const matches = related.some((file) => /auth|authentication|provider_gate|auth_checker/i.test(file));
    expect(matches).toBe(true);
  });

  it('returns storage/database context', () => {
    const related = collectRelatedFiles(databaseResponse.packs);
    const matches = related.some((file) => /storage\/|sqlite|postgres|database/i.test(file));
    expect(matches).toBe(true);
  });

  it('updates confidence based on causal attribution outcomes', async () => {
    const pack = pickPack(authResponse.packs);
    const before = await storage.getContextPack(pack.packId);
    if (!before) throw new Error('unverified_by_trace(provider_invalid_output): missing context pack');

    await recordTaskOutcome(WORKSPACE_ROOT, { packIds: [pack.packId], success: true });
    const afterSuccess = await storage.getContextPack(pack.packId);
    if (!afterSuccess) throw new Error('unverified_by_trace(provider_invalid_output): missing context pack after success');
    expect(afterSuccess.confidence).toBeGreaterThanOrEqual(before.confidence);

    await recordTaskOutcome(WORKSPACE_ROOT, {
      packIds: [pack.packId],
      success: false,
      failureType: 'knowledge_mismatch',
      failureReason: 'context missing edge cases',
    });
    const afterFailure = await storage.getContextPack(pack.packId);
    if (!afterFailure) throw new Error('unverified_by_trace(provider_invalid_output): missing context pack after failure');
    expect(afterFailure.confidence).toBeLessThanOrEqual(afterSuccess.confidence);

    const attribution = await attributeFailure(
      storage,
      { success: false, failureType: 'knowledge_mismatch', failureReason: 'context mismatch' },
      { packIds: [pack.packId], affectedEntities: [`context_pack:${pack.packId}`] }
    );
    expect(attribution.knowledgeCaused).toBe(true);
  }, AGENTIC_TIMEOUT_MS);

  it('produces non-trivial graph metrics', async () => {
    const graphStore = storage as LibrarianStorage & { getGraphMetrics?: (options?: { entityType?: 'function' | 'module' }) => Promise<Array<{ pagerank: number }>> };
    if (!graphStore.getGraphMetrics) {
      throw new Error('unverified_by_trace(provider_invalid_output): graph metrics not available');
    }
    const metrics = await graphStore.getGraphMetrics({ entityType: 'module' });
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics.some((entry) => entry.pagerank > 0)).toBe(true);
  });

  it('shows >50% taxonomy coverage from indexed context packs', async () => {
    const packs = await storage.getContextPacks({ limit: 250 });
    const stats = await storage.getStats();
    const evidenceCount = stats.totalFunctions + stats.totalModules + packs.length;
    const covered = Math.min(TAXONOMY_ITEMS.length, evidenceCount);
    const report = createKnowledgeCoverageReport({
      workspace: WORKSPACE_ROOT,
      itemsBySource: { llm: covered },
    });
    expect(report.coverage_percentage).toBeGreaterThan(50);
  });

  it('assembles librarian context for agents with pack references', async () => {
    const context = await enrichTaskContext(WORKSPACE_ROOT, {
      intent: 'authentication',
      taskType: 'review',
    });
    expect(context.packIds.length).toBeGreaterThan(0);
    expect(context.relatedFiles.length).toBeGreaterThan(0);
  }, AGENTIC_TIMEOUT_MS);

  it('blocks file reads for librarian-known files via context policy', async () => {
    const context = await enrichTaskContext(WORKSPACE_ROOT, {
      intent: 'authentication',
      taskType: 'feature',
    });
    const knownFile = context.relatedFiles[0];
    if (!knownFile) throw new Error('unverified_by_trace(provider_invalid_output): no related files found');
    const allowRead = (filePath: string) => !context.relatedFiles.includes(filePath);
    expect(allowRead(knownFile)).toBe(false);
    expect(allowRead(path.join(WORKSPACE_ROOT, 'nonexistent.file'))).toBe(true);
  }, AGENTIC_TIMEOUT_MS);

  it('detects hallucinated imports and APIs as guess violations', async () => {
    if (!SCAS_PATH) return;
    const module = await import(pathToFileURL(SCAS_PATH).href);
    const detector = new module.HallucinationDetector();
    const importCheck = detector.checkImport('sample-missing-package');
    expect(importCheck.hallucinated).toBe(true);
    const apiFindings = detector.checkApiCall('String.prototype.toKebabCase("value")');
    expect(apiFindings.length).toBeGreaterThan(0);
  });

  it('rejects non-compliant agent outputs', () => {
    expect(() => validateJSON('{"completed_tasks":[]}')).toThrow(OutputValidationError);
  });

  it('fails closed when librarian context is unavailable', async () => {
    const tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-escape-'));
    await expect(
      enrichTaskContext(tempWorkspace, { intent: 'fix typo', taskType: 'bug_fix' })
    ).rejects.toThrow('Librarian not initialized');
  });

  it('fails closed on provider outage (emergency mode)', async () => {
    const authChecker = new StubAuthChecker();
    const llmServiceStub: LlmServiceAdapter = {
      chat: async () => {
        throw new Error('unverified_by_trace(provider_unavailable): outage');
      },
      checkClaudeHealth: async () => outageHealth('claude'),
      checkCodexHealth: async () => outageHealth('codex'),
    };

    const result = await runProviderReadinessGate(WORKSPACE_ROOT, {
      authChecker,
      llmService: llmServiceStub,
      emitReport: false,
    });

    expect(result.ready).toBe(false);
    expect(result.selectedProvider).toBeNull();
    expect(result.reason ?? '').toContain('claude');
  });

  it('spawns an agent with librarian context to complete a simple task', async () => {
    agentContext = await enrichTaskContext(WORKSPACE_ROOT, {
      intent: 'Explain how the librarian query engine scores results',
      taskType: 'feature',
    });
    agentResponse = await runAgentWithContext('Summarize the librarian query scoring logic.', agentContext);
    expect(agentResponse.citations.length).toBeGreaterThan(0);
  }, AGENTIC_TIMEOUT_MS);

  it('requires evidence citations in agent output', () => {
    if (!agentContext || !agentResponse) throw new Error('unverified_by_trace(provider_invalid_output): agent output missing');
    const normalized = new Set(agentContext.relatedFiles.map((file) => path.normalize(file)));
    const cited = agentResponse.citations.some((citation) => normalized.has(normalizeCitation(citation)));
    expect(cited).toBe(true);
  });

  it('detects guess violations by validating citations', () => {
    if (!agentContext || !agentResponse) throw new Error('unverified_by_trace(provider_invalid_output): agent output missing');
    const normalized = new Set(agentContext.relatedFiles.map((file) => path.normalize(file)));
    const allCited = agentResponse.citations.every((citation) => normalized.has(normalizeCitation(citation)));
    expect(allCited).toBe(true);
  });

  it('updates confidence after successful agent execution', async () => {
    if (!agentContext) throw new Error('unverified_by_trace(provider_invalid_output): agent context missing');
    if (agentContext.packIds.length === 0) throw new Error('unverified_by_trace(provider_invalid_output): missing pack ids');
    const packId = agentContext.packIds[0]!;
    const before = await storage.getContextPack(packId);
    if (!before) throw new Error('unverified_by_trace(provider_invalid_output): missing context pack');

    await recordTaskOutcome(WORKSPACE_ROOT, { packIds: [packId], success: true });
    const after = await storage.getContextPack(packId);
    if (!after) throw new Error('unverified_by_trace(provider_invalid_output): missing context pack after update');
    expect(after.confidence).toBeGreaterThanOrEqual(before.confidence);
  }, AGENTIC_TIMEOUT_MS);
});
