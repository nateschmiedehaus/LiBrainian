import { AuthChecker } from '../utils/auth_checker.js';
import {
  createDefaultLlmServiceAdapter,
  getLlmServiceAdapter,
  setDefaultLlmServiceFactory,
  type LlmServiceAdapter,
} from '../adapters/llm_service.js';
import { createCliLlmServiceFactory } from '../adapters/cli_llm_service.js';
import { createProviderStatusReport, readLastSuccessfulProvider, writeLastSuccessfulProvider, writeProviderStatusReport, type ProviderName } from './reporting.js';
import { generateRealEmbedding, getCurrentModel } from './embedding_providers/real_embeddings.js';
import { toErrorMessage } from '../utils/errors.js';
import { logWarning } from '../telemetry/logger.js';
import { resolveLibrarianProvider } from './llm_env.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';
import { createSessionId } from '../epistemics/evidence_ledger.js';
import { createHash } from 'node:crypto';
import { getActiveProviderFailures } from '../utils/provider_failures.js';
import { isNetworkAccessDisabled, isPrivacyModeStrict } from '../utils/runtime_controls.js';
import { appendPrivacyAuditEvent } from '../security/privacy_audit.js';

type AuthStatusSummary = Awaited<ReturnType<AuthChecker['checkAll']>>;
const PROVIDER_FALLBACK_CHAIN: ProviderName[] = ['claude', 'codex'];

export interface ProviderGateStatus {
  provider: ProviderName;
  available: boolean;
  authenticated: boolean;
  lastCheck: number;
  error?: string;
  guidance?: string;
  source?: string;
}

export interface EmbeddingGateStatus {
  provider: 'xenova' | 'sentence-transformers' | 'unknown';
  available: boolean;
  lastCheck: number;
  modelId?: string;
  dimension?: number;
  error?: string;
}

export interface ProviderGateResult {
  ready: boolean;
  providers: ProviderGateStatus[];
  embedding: EmbeddingGateStatus;
  llmReady: boolean;
  embeddingReady: boolean;
  reason?: string;
  guidance?: string[];
  selectedProvider: ProviderName | null;
  bypassed: boolean;
  remediationSteps?: string[];
  fallbackChain?: ProviderName[];
  lastSuccessfulProvider?: ProviderName | null;
  reportPath?: string;
}

export type ProviderGateRunner = (workspaceRoot: string) => Promise<ProviderGateResult>;

export interface ProviderGateOptions {
  llmService?: LlmServiceAdapter;
  authChecker?: AuthChecker;
  embeddingHealthCheck?: () => Promise<EmbeddingGateStatus>;
  emitReport?: boolean;
  forceProbe?: boolean;
  ledger?: IEvidenceLedger;
  sessionId?: SessionId;
}

function isLlmServiceAdapter(value: unknown): value is LlmServiceAdapter {
  return Boolean(
    value &&
      typeof (value as LlmServiceAdapter).chat === 'function' &&
      typeof (value as LlmServiceAdapter).checkClaudeHealth === 'function' &&
      typeof (value as LlmServiceAdapter).checkCodexHealth === 'function'
  );
}

function ensureDefaultLlmFactoryRegistered(): void {
  try {
    setDefaultLlmServiceFactory(createCliLlmServiceFactory());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('llm_adapter_default_factory_already_registered')) {
      return;
    }
    throw error;
  }
}

export async function runProviderReadinessGate(
  workspaceRoot: string,
  options: ProviderGateOptions = {}
): Promise<ProviderGateResult> {
  const startedAt = Date.now();
  const authChecker = options.authChecker ?? new AuthChecker(workspaceRoot);
  const authStatus = await authChecker.checkAll();
  const guidance = authChecker.getAuthGuidance(authStatus);
  const remediationSteps = buildRemediationSteps(authStatus);
  const fallbackChain = PROVIDER_FALLBACK_CHAIN.slice();
  const networkDisabled = isNetworkAccessDisabled();
  const privacyStrict = isPrivacyModeStrict();
  let lastSuccessfulProvider = await readLastSuccessfulProvider(workspaceRoot);
  const emitReport = options.emitReport ?? true;

  if (privacyStrict) {
    await appendPrivacyAuditEvent(workspaceRoot, {
      ts: new Date().toISOString(),
      op: 'provider_check',
      files: [],
      model: 'n/a',
      local: true,
      contentSent: false,
      status: 'allowed',
      note: 'strict privacy mode active',
    }).catch(() => {
      // Non-blocking audit write.
    });
  }

  let llmService: LlmServiceAdapter | null = null;
  let llmServiceError: string | null = null;
  if (networkDisabled) {
    remediationSteps.push('Network-disabled runtime mode active; skipping remote LLM provider checks.');
  } else {
    try {
      ensureDefaultLlmFactoryRegistered();
      const candidate = options.llmService ?? getLlmServiceAdapter();
      if (candidate) {
        if (!isLlmServiceAdapter(candidate)) {
          throw new Error('unverified_by_trace(llm_adapter_invalid): Adapter missing health checks.');
        }
        llmService = candidate;
      } else {
        const created = createDefaultLlmServiceAdapter();
        if (!isLlmServiceAdapter(created)) {
          throw new Error('unverified_by_trace(llm_adapter_invalid): Default adapter missing health checks.');
        }
        llmService = created;
      }
    } catch (error) {
      llmServiceError = toErrorMessage(error);
      remediationSteps.push(`LLM adapter init failed: ${llmServiceError}`);
    }
  }
  const embeddingHealthCheck = options.embeddingHealthCheck ?? checkEmbeddingHealth;
  const forceProbe = options.forceProbe ?? false;

  const now = Date.now();
  const [claude, codex] = networkDisabled
    ? [
        {
          provider: 'claude' as const,
          available: false,
          authenticated: false,
          lastCheck: now,
          error: 'disabled by runtime mode (--offline/--local-only)',
        },
        {
          provider: 'codex' as const,
          available: false,
          authenticated: false,
          lastCheck: now,
          error: 'disabled by runtime mode (--offline/--local-only)',
        },
      ]
    : llmService
    ? await (async () => {
        const [claudeResult, codexResult] = await Promise.allSettled([
          llmService.checkClaudeHealth(forceProbe),
          llmService.checkCodexHealth(forceProbe),
        ]);
        const fallback = (provider: 'claude' | 'codex', reason?: unknown) => ({
          provider,
          available: false,
          authenticated: false,
          lastCheck: now,
          error: toErrorMessage(reason ?? 'unverified_by_trace(llm_health_check_failed)'),
        });
        return [
          claudeResult.status === 'fulfilled' ? claudeResult.value : fallback('claude', claudeResult.reason),
          codexResult.status === 'fulfilled' ? codexResult.value : fallback('codex', codexResult.reason),
        ];
      })()
    : [
        {
          provider: 'claude',
          available: false,
          authenticated: false,
          lastCheck: now,
          error: llmServiceError ?? 'unverified_by_trace(llm_adapter_unavailable)',
        },
        {
          provider: 'codex',
          available: false,
          authenticated: false,
          lastCheck: now,
          error: llmServiceError ?? 'unverified_by_trace(llm_adapter_unavailable)',
        },
      ];

  const claudeAuth = authStatus.claude_code ?? authStatus.claude;
  const codexAuth = authStatus.codex;
  const providers: ProviderGateStatus[] = [
    {
      provider: 'claude',
      available: claude.available,
      authenticated: claude.authenticated,
      lastCheck: claude.lastCheck,
      error: claude.error,
      guidance: claudeAuth?.guidance,
      source: claudeAuth?.source,
    },
    {
      provider: 'codex',
      available: codex.available,
      authenticated: codex.authenticated,
      lastCheck: codex.lastCheck,
      error: codex.error,
      guidance: codexAuth?.guidance,
      source: codexAuth?.source,
    },
  ];

  if (!networkDisabled) {
    const recentFailures = await getActiveProviderFailures(workspaceRoot, now);
    for (const [providerName, failure] of Object.entries(recentFailures)) {
      const provider = providers.find((entry) => entry.provider === providerName);
      if (!provider || !failure) continue;
      if (provider.available && provider.authenticated) {
        provider.available = false;
        provider.error = `recent ${failure.reason}: ${failure.message}`;
        switch (failure.reason) {
          case 'rate_limit':
            remediationSteps.push('LLM provider rate limited; wait before retrying or reduce request volume.');
            break;
          case 'quota_exceeded':
            remediationSteps.push('LLM provider quota exceeded; check billing or wait for quota reset.');
            break;
          case 'auth_failed':
            remediationSteps.push('LLM provider auth failed; re-authenticate CLI credentials.');
            break;
          case 'timeout':
            remediationSteps.push('LLM provider timed out; retry after cooldown or improve connectivity.');
            break;
          case 'network_error':
            remediationSteps.push('LLM provider network error; check connectivity before retrying.');
            break;
          case 'invalid_response':
            remediationSteps.push('LLM provider returned invalid output; retry or switch provider.');
            break;
          default:
            remediationSteps.push('LLM provider unavailable; retry after cooldown or switch provider.');
        }
      }
    }
  }

  const preferred = resolveLibrarianProvider();
  const isReady = (name: ProviderName | null | undefined) => Boolean(name && providers.some((p) => p.provider === name && p.available && p.authenticated));
  const pick = (name: ProviderName | null | undefined): ProviderName | null => (isReady(name) ? (name as ProviderName) : null);
  const selectedProvider = networkDisabled
    ? null
    : (pick(preferred) ?? pick(lastSuccessfulProvider) ?? pick('claude') ?? pick('codex'));

  const llmReady = networkDisabled ? false : selectedProvider !== null;
  const embedding = await embeddingHealthCheck();
  const embeddingReady = embedding.available;
  if (!embeddingReady) {
    remediationSteps.push('Embeddings: install @xenova/transformers (npm) or sentence-transformers (python)');
  }
  const ready = networkDisabled ? embeddingReady : llmReady && embeddingReady;
  const reason = ready
    ? undefined
    : (networkDisabled
      ? `offline/local-only mode requires local embeddings: ${embedding.error ?? 'embedding provider unavailable'}`
      : buildReason(providers, guidance, embedding));
  if (ready && selectedProvider) {
    try {
      await writeLastSuccessfulProvider(workspaceRoot, selectedProvider);
    } catch (error) {
      logWarning('[provider_gate] Failed to persist last successful provider', {
        workspace: workspaceRoot,
        provider: selectedProvider,
        error: toErrorMessage(error),
      });
    }
    lastSuccessfulProvider = selectedProvider;
  }

  const result: ProviderGateResult = {
    ready,
    providers,
    embedding,
    llmReady,
    embeddingReady,
    reason,
    guidance,
    selectedProvider,
    bypassed: networkDisabled,
    remediationSteps,
    fallbackChain,
    lastSuccessfulProvider,
  };
  if (emitReport) {
    const report = await createProviderStatusReport(workspaceRoot, result, {
      remediationSteps,
      fallbackChain,
      lastSuccessfulProvider,
    });
    try {
      result.reportPath = await writeProviderStatusReport(workspaceRoot, report);
    } catch (error) {
      logWarning('[provider_gate] Failed to write provider status report', {
        workspace: workspaceRoot,
        error: toErrorMessage(error),
      });
    }
  }

  if (options.ledger) {
    await appendProviderGateEvidence(options.ledger, {
      workspaceRoot,
      sessionId: options.sessionId,
      startedAt,
      result,
      forceProbe,
      preferredProvider: preferred ?? null,
      lastSuccessfulProvider: lastSuccessfulProvider ?? null,
    });
  }
  return result;
}

async function appendProviderGateEvidence(
  ledger: IEvidenceLedger,
  options: {
    workspaceRoot: string;
    sessionId?: SessionId;
    startedAt: number;
    result: ProviderGateResult;
    forceProbe: boolean;
    preferredProvider: string | null;
    lastSuccessfulProvider: ProviderName | null;
  }
): Promise<void> {
  try {
    const input = {
      workspaceRoot: options.workspaceRoot,
      forceProbe: options.forceProbe,
      preferredProvider: options.preferredProvider,
      lastSuccessfulProvider: options.lastSuccessfulProvider,
    };
    const output = {
      ready: options.result.ready,
      selectedProvider: options.result.selectedProvider,
      llmReady: options.result.llmReady,
      embeddingReady: options.result.embeddingReady,
      providers: options.result.providers,
      embedding: options.result.embedding,
      reason: options.result.reason ?? null,
      bypassed: options.result.bypassed,
    };
    const inputHash = createHash('sha256')
      .update(JSON.stringify({ input, output }))
      .digest('hex')
      .slice(0, 16);

    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: 'provider_gate',
        arguments: input,
        result: output,
        success: options.result.ready,
        durationMs: Date.now() - options.startedAt,
        errorMessage: options.result.ready ? undefined : options.result.reason,
      },
      provenance: {
        source: 'system_observation',
        method: 'provider_gate',
        agent: {
          type: 'tool',
          identifier: 'librarian',
        },
        inputHash,
      },
      relatedEntries: [],
      sessionId: options.sessionId ?? createSessionId(),
    });
  } catch {
    // Provider gate must remain usable even if the ledger is unavailable.
  }
}

function buildReason(
  providers: ProviderGateStatus[],
  guidance: string[],
  embedding: EmbeddingGateStatus
): string {
  const failureDetails = providers.map((provider) => {
    if (provider.available && provider.authenticated) {
      return `${provider.provider}:ready`;
    }
    const detail = provider.error ?? (provider.available ? 'unauthenticated' : 'unavailable');
    return `${provider.provider}:${detail}`;
  });

  const details = failureDetails.slice();
  if (!embedding.available) {
    details.push(`embedding:${embedding.error ?? 'unavailable'}`);
  }

  if (guidance.length === 0) {
    return details.join('; ');
  }

  return `${details.join('; ')}. ${guidance.join(' ')}`;
}

function buildRemediationSteps(authStatus: AuthStatusSummary): string[] {
  const steps = new Set<string>();
  const claudeStatus = authStatus.claude_code ?? authStatus.claude;
  const codexStatus = authStatus.codex;
  if (!claudeStatus?.authenticated) {
    steps.add('Claude: run `claude setup-token` or start `claude` once to authenticate (CLI-only; no API keys)');
  }
  if (!codexStatus?.authenticated) {
    steps.add('Codex: run `codex login` to authenticate (CLI-only; no API keys)');
  }
  if (claudeStatus?.guidance) {
    steps.add(`Claude: ${claudeStatus.guidance}`);
  }
  if (codexStatus?.guidance) {
    steps.add(`Codex: ${codexStatus.guidance}`);
  }
  return Array.from(steps);
}

async function checkEmbeddingHealth(): Promise<EmbeddingGateStatus> {
  const modelId = getCurrentModel();
  try {
    const result = await generateRealEmbedding('embedding health check', modelId);
    const embeddingOk = result.embedding instanceof Float32Array && result.embedding.length > 0;
    if (!embeddingOk) {
      throw new Error('Embedding provider returned empty vector');
    }
    return {
      provider: result.provider,
      available: true,
      lastCheck: Date.now(),
      modelId,
      dimension: result.dimension,
    };
  } catch (error) {
    return {
      provider: 'unknown',
      available: false,
      lastCheck: Date.now(),
      modelId,
      error: toErrorMessage(error),
    };
  }
}
