import { runProviderReadinessGate, type ProviderGateResult, type ProviderGateStatus } from './provider_gate.js';
import { resolveLibrarianModelId } from './llm_env.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';

export interface ProviderStatus {
  available: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
}

export interface AllProviderStatus {
  llm: ProviderStatus;
  embedding: ProviderStatus;
}

export interface ProviderRequirement {
  llm: boolean;
  embedding: boolean;
}

export interface ProviderCheckOptions {
  workspaceRoot?: string;
  forceProbe?: boolean;
  ledger?: IEvidenceLedger;
  sessionId?: SessionId;
}

export class ProviderUnavailableError extends Error {
  constructor(public details: { message: string; missing: string[]; suggestion: string }) {
    super(details.message);
    this.name = 'ProviderUnavailableError';
  }
}

export type ProviderGateSnapshot = {
  status: AllProviderStatus;
  remediationSteps: string[];
  reason?: string;
};

export async function requireProviders(
  needs: ProviderRequirement,
  options: ProviderCheckOptions = {}
): Promise<void> {
  const snapshot = await checkProviderSnapshot(options);
  const missing: string[] = [];

  if (needs.llm && !snapshot.status.llm.available) {
    missing.push(`LLM: ${snapshot.status.llm.error ?? 'unavailable'}`);
  }
  if (needs.embedding && !snapshot.status.embedding.available) {
    missing.push(`Embedding: ${snapshot.status.embedding.error ?? 'unavailable'}`);
  }

  if (missing.length > 0) {
    const suggestion =
      snapshot.remediationSteps.join(' ') ||
      snapshot.reason ||
      'Authenticate providers via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`).';
    throw new ProviderUnavailableError({
      message: 'unverified_by_trace(provider_unavailable): Wave0 requires live providers to function',
      missing,
      suggestion,
    });
  }
}

export async function checkAllProviders(options: ProviderCheckOptions = {}): Promise<AllProviderStatus> {
  const snapshot = await checkProviderSnapshot(options);
  return snapshot.status;
}

export async function checkProviderSnapshot(options: ProviderCheckOptions = {}): Promise<ProviderGateSnapshot> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const startedAt = Date.now();
  const result = await runProviderReadinessGate(workspaceRoot, {
    emitReport: true,
    forceProbe: options.forceProbe ?? false,
    ledger: options.ledger,
    sessionId: options.sessionId,
  });
  const latencyMs = Date.now() - startedAt;

  const llmStatus = buildProviderStatus(result, latencyMs, 'llm');
  const embeddingStatus = buildProviderStatus(result, latencyMs, 'embedding');

  return {
    status: { llm: llmStatus, embedding: embeddingStatus },
    remediationSteps: result.remediationSteps ?? [],
    reason: result.reason,
  };
}

function buildProviderStatus(
  result: ProviderGateResult,
  latencyMs: number,
  kind: 'llm' | 'embedding'
): ProviderStatus {
  if (kind === 'embedding') {
    const provider = result.embedding.provider ?? 'none';
    const model = resolveModelId(provider, kind);
    if (result.embeddingReady) {
      return { available: true, provider, model, latencyMs };
    }
    const error = result.embedding.error ?? result.reason ?? 'Embedding unavailable';
    return { available: false, provider, model, latencyMs, error };
  }

  const provider = result.selectedProvider ?? 'none';
  const model = resolveModelId(provider, kind);
  if (result.llmReady) {
    return { available: true, provider, model, latencyMs };
  }
  const error = result.reason ?? summarizeProviderFailures(result.providers);
  return {
    available: false,
    provider,
    model,
    latencyMs,
    error: error || 'Provider unavailable',
  };
}

function summarizeProviderFailures(providers: ProviderGateStatus[]): string {
  if (providers.length === 0) return '';
  return providers
    .map((provider) => {
      if (provider.available && provider.authenticated) {
        return `${provider.provider}:ready`;
      }
      const detail = provider.error ?? (provider.available ? 'unauthenticated' : 'unavailable');
      return `${provider.provider}:${detail}`;
    })
    .join('; ');
}

function resolveModelId(provider: string, kind: 'llm' | 'embedding'): string {
  if (kind === 'embedding') {
    return (
      process.env.LIBRARIAN_EMBED_MODEL ??
      process.env.WAVE0_EMBED_MODEL ??
      process.env.LIBRARIAN_EMBED_MODEL ??
      process.env.CLAUDE_MODEL ??
      process.env.CODEX_MODEL ??
      'unknown'
    );
  }

  if (provider === 'claude') {
    return resolveLibrarianModelId('claude') ?? 'unknown';
  }
  if (provider === 'codex') {
    return resolveLibrarianModelId('codex') ?? 'unknown';
  }
  return (
    resolveLibrarianModelId() ??
    'unknown'
  );
}
