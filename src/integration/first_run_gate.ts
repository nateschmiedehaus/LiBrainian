import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createLibrarian, Librarian } from '../api/librarian.js';
import { runProviderReadinessGate, type ProviderGateRunner } from '../api/provider_gate.js';
import { ProviderUnavailableError } from '../api/provider_check.js';
import { getCurrentVersion } from '../api/versioning.js';
import type { EmbeddingService } from '../api/embeddings.js';
import type { BootstrapReport } from '../types.js';
import { globalEventBus, createBootstrapStartedEvent, createBootstrapCompleteEvent, createBootstrapPhaseCompleteEvent } from '../events.js';
import { createKnowledgeCoverageReport, createLibrarianRunReport, readLatestGovernorBudgetReport, writeKnowledgeCoverageReport, writeLibrarianRunReport } from '../api/reporting.js';
import { acquireWorkspaceLock, cleanupWorkspaceLock, type WorkspaceLockHandle } from './workspace_lock.js';
import { noResult } from '../api/empty_values.js';
import { createLibrarianTraceContext, getLibrarianTraceRefs, recordLibrarianTrace } from '../observability/librarian_traces.js';
import { logInfo, logWarning } from '../telemetry/logger.js';
import { ensureDailyModelSelection } from '../adapters/model_policy.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { resolveLibrarianModelId } from '../api/llm_env.js';
import { INCLUDE_PATTERNS, EXCLUDE_PATTERNS } from '../universal_patterns.js';

interface GateState {
  workspace: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  librarian: Librarian | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error?: string;
  report?: BootstrapReport;
  version?: string;
  providerUsed?: 'claude' | 'codex' | null;
}

const gateStates = new Map<string, GateState>();

interface GateStateFile {
  status: 'ready' | 'failed' | 'running';
  completedAt: string;
  version: string;
  providerUsed: 'claude' | 'codex' | null;
  error?: string;
}

const GATE_STATE_FILENAME = 'gate_state.json';
const isTestMode = (): boolean => process.env.NODE_ENV === 'test' || process.env.WAVE0_TEST_MODE === 'true';
const resolveGateStatePath = (workspace: string): string => path.join(workspace, '.librarian', GATE_STATE_FILENAME);
const resolveLlmModelId = (): string | undefined => resolveLibrarianModelId();

async function readGateState(workspace: string): Promise<GateStateFile | null> {
  const gatePath = resolveGateStatePath(workspace);
  try {
    const raw = await fs.readFile(gatePath, 'utf8');
    const parsed = safeJsonParse<GateStateFile>(raw);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return noResult();
    if (typeof parsed.value.status !== 'string' || typeof parsed.value.version !== 'string' || typeof parsed.value.completedAt !== 'string') {
      return noResult();
    }
    return parsed.value;
  } catch {
    return noResult();
  }
}

function readGateStateSync(workspace: string): GateStateFile | null {
  const gatePath = resolveGateStatePath(workspace);
  try {
    if (!fsSync.existsSync(gatePath)) return noResult();
    const raw = fsSync.readFileSync(gatePath, 'utf8');
    const parsed = safeJsonParse<GateStateFile>(raw);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return noResult();
    if (typeof parsed.value.status !== 'string' || typeof parsed.value.version !== 'string' || typeof parsed.value.completedAt !== 'string') {
      return noResult();
    }
    return parsed.value;
  } catch {
    return noResult();
  }
}

function isGateStateReady(state: GateStateFile | null, version: string): boolean {
  return Boolean(state && state.status === 'ready' && state.version === version);
}

async function writeGateState(workspace: string, state: GateStateFile): Promise<void> {
  const gatePath = resolveGateStatePath(workspace);
  await fs.mkdir(path.dirname(gatePath), { recursive: true });
  await fs.writeFile(gatePath, JSON.stringify(state, null, 2), 'utf8');
}

async function clearGateState(workspace: string): Promise<void> {
  const gatePath = resolveGateStatePath(workspace);
  try {
    await fs.unlink(gatePath);
  } catch (error) {
    // ENOENT is expected if gate state doesn't exist - don't log
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logWarning('FirstRunGate: Failed to clear gate state', {
        gatePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export interface FirstRunGateOptions {
  onProgress?: (phase: string, progress: number, message: string) => void;
  onStart?: () => void;
  onComplete?: (success: boolean, report?: BootstrapReport) => void;
  timeoutMs?: number;
  maxWaitForBootstrapMs?: number;
  throwOnFailure?: boolean;
  dbPath?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  providerGate?: ProviderGateRunner;
  embeddingService?: EmbeddingService;
}

export interface FirstRunGateResult {
  success: boolean;
  librarian: Librarian | null;
  wasBootstrapped: boolean;
  wasUpgraded: boolean;
  durationMs: number;
  error?: string;
  report?: BootstrapReport;
}

export async function ensureLibrarianReady(
  workspace: string,
  options: FirstRunGateOptions = {}
): Promise<FirstRunGateResult> {
  const startTime = Date.now();
  const {
    onProgress,
    onStart,
    onComplete,
    timeoutMs = 0,
    maxWaitForBootstrapMs,
    throwOnFailure = true,
    dbPath,
    includePatterns,
    excludePatterns,
    providerGate,
    embeddingService,
  } = options;
  const currentVersion = getCurrentVersion().string;
  const normalizeTimeout = (value?: number): number => (value && value > 0 ? value : 0);
  const lockTimeoutMs = normalizeTimeout(maxWaitForBootstrapMs ?? timeoutMs);
  const waitTimeoutMs = normalizeTimeout(maxWaitForBootstrapMs ?? timeoutMs);

  const existingState = gateStates.get(workspace);
  if (existingState?.status === 'failed') gateStates.delete(workspace);
  if (existingState?.status === 'ready' && existingState.librarian) {
    return { success: true, librarian: existingState.librarian, wasBootstrapped: false, wasUpgraded: false, durationMs: 0, report: existingState.report };
  }

  if (existingState?.status === 'running') {
    const elapsed = Date.now() - startTime;
    const remaining = waitTimeoutMs > 0 ? Math.max(0, waitTimeoutMs - elapsed) : 0;
    const result = await waitForGate(workspace, remaining);
    if (!result.success) gateStates.delete(workspace);
    return result;
  }

  const persistedGateState = await readGateState(workspace);
  if (persistedGateState?.status === 'failed') await clearGateState(workspace);

  const state: GateState = {
    workspace,
    status: 'running',
    librarian: null,
    startedAt: new Date(),
    completedAt: null,
  };
  gateStates.set(workspace, state);

  const traceContext = createLibrarianTraceContext(workspace);
  const runId = traceContext.traceId;
  recordLibrarianTrace(traceContext, 'bootstrap_started');
  const emitReports = async (outcome: 'success' | 'failure', errorMessage?: string): Promise<void> => {
    const startedAt = state.startedAt ?? new Date(startTime);
    const completedAt = state.completedAt ?? new Date();
    const governorReport = await readLatestGovernorBudgetReport(workspace);
    const runReport = createLibrarianRunReport({
      runId,
      startedAt,
      completedAt,
      outcome,
      filesProcessed: state.report?.totalFilesProcessed ?? 0,
      functionsIndexed: state.report?.totalFunctionsIndexed ?? 0,
      packsCreated: state.report?.totalContextPacksCreated ?? 0,
      governorBudgetUsed: governorReport?.usage?.tokens_used_run ?? 0,
      governorBudgetLimit: governorReport?.budget_limits?.maxTokensPerRun ?? 0,
      errors: outcome === 'success' ? [] : [{ file: 'bootstrap', error: errorMessage ?? state.report?.error ?? 'unknown' }],
      traceRefs: getLibrarianTraceRefs(traceContext),
    });
    await writeLibrarianRunReport(workspace, runReport);
    const coverageReport = createKnowledgeCoverageReport({ workspace, traceRefs: getLibrarianTraceRefs(traceContext) });
    await writeKnowledgeCoverageReport(workspace, coverageReport);
  };

  globalEventBus.emit(createBootstrapStartedEvent(workspace)); onStart?.(); onProgress?.('initializing', 0, 'Starting librarian initialization...');

  let wasBootstrapped = false; let wasUpgraded = false; let providerUsed: 'claude' | 'codex' | null = null; let lockHandle: WorkspaceLockHandle | null = null;

  try {
    const gateRunner = providerGate ?? runProviderReadinessGate;
    const providerStatus = await gateRunner(workspace);
    providerUsed = providerStatus.selectedProvider ?? null;
    logInfo('[librarian] Provider gate status', {
      ready: providerStatus.ready,
      selectedProvider: providerStatus.selectedProvider,
      reason: providerStatus.reason,
      providers: providerStatus.providers.map((provider) => ({
        provider: provider.provider,
        available: provider.available,
        authenticated: provider.authenticated,
        error: provider.error,
      })),
    });
    if (!providerStatus.ready) {
      const missing = providerStatus.providers
        .filter((provider) => !(provider.available && provider.authenticated))
        .map((provider) => `${provider.provider}: ${provider.error ?? (provider.available ? 'unauthenticated' : 'unavailable')}`);
      if (!providerStatus.embeddingReady) {
        missing.push(`embedding: ${providerStatus.embedding.error ?? 'unavailable'}`);
      }
      const suggestion = (providerStatus.remediationSteps ?? []).join(' ')
        || providerStatus.reason
        || 'Authenticate providers via CLI (Claude: `claude setup-token` or run `claude`; Codex: `codex login`).';
      throw new ProviderUnavailableError({
        message: 'unverified_by_trace(provider_unavailable): Wave0 requires live providers to function',
        missing: missing.length ? missing : ['providers unavailable'],
        suggestion,
      });
    }
    recordLibrarianTrace(traceContext, 'provider_gate_ready');

    if (!isTestMode()) {
      const selection = await ensureDailyModelSelection(path.resolve(workspace), {
        defaultProvider: providerStatus.selectedProvider ?? undefined,
        respectExistingEnv: false,
        applyEnv: false,
      });
      const selectedProvider = providerStatus.selectedProvider === 'claude' || providerStatus.selectedProvider === 'codex'
        ? providerStatus.selectedProvider
        : null;
      if (selectedProvider && selection) {
        const selectedModel = selection.providers[selectedProvider]?.model_id;
        if (selectedModel) {
          process.env.LIBRARIAN_LLM_PROVIDER = selectedProvider;
          process.env.LIBRARIAN_LLM_MODEL = selectedModel;
        }
      }
      recordLibrarianTrace(traceContext, 'model_selection_ready');
    }

    const elapsed = Date.now() - startTime;
    const remainingTimeoutMs = lockTimeoutMs > 0 ? Math.max(0, lockTimeoutMs - elapsed) : 0;
    if (lockTimeoutMs > 0 && remainingTimeoutMs <= 0) {
      throw new Error('unverified_by_trace(lease_conflict): timeout waiting for librarian lock');
    }
    lockHandle = await acquireWorkspaceLock(workspace, { timeoutMs: remainingTimeoutMs });

    const llmProvider = providerStatus.selectedProvider ?? undefined;
    const llmModelId = resolveLlmModelId();
    const librarian = await createLibrarian({
      workspace,
      dbPath,
      autoBootstrap: true,
      bootstrapTimeoutMs: timeoutMs,
      llmProvider,
      llmModelId,
      embeddingService,
      bootstrapConfig: {
        include: includePatterns || [...INCLUDE_PATTERNS],
        exclude: excludePatterns || [...EXCLUDE_PATTERNS],
        llmProvider,
        llmModelId,
      },
      onProgress: (phase, progress, message) => { onProgress?.(phase, progress, message); },
      onBootstrapStart: () => { wasBootstrapped = true; onProgress?.('bootstrap', 0.1, 'Bootstrap started...'); },
      onBootstrapComplete: (report) => { state.report = report; onProgress?.('bootstrap', 1, 'Bootstrap complete'); },
    });

    if (!librarian.isReady()) throw new Error('Librarian failed to initialize');

    const status = await librarian.getStatus();
    wasUpgraded = status.upgradeAvailable === false && wasBootstrapped;

    state.status = 'ready';
    state.librarian = librarian;
    state.completedAt = new Date();
    state.version = currentVersion;
    state.providerUsed = providerUsed;
    gateStates.set(workspace, state);
    await writeGateState(workspace, {
      status: 'ready',
      completedAt: state.completedAt.toISOString(),
      version: currentVersion,
      providerUsed,
    });
    if (isTestMode()) {
      const persisted = readGateStateSync(workspace);
      if (!isGateStateReady(persisted, currentVersion)) throw new Error('Tier-0: gate state not persisted');
      const snapshot = gateStates.get(workspace); gateStates.delete(workspace);
      const reloaded = isLibrarianReady(workspace); if (snapshot) gateStates.set(workspace, snapshot);
      if (!reloaded) throw new Error('Tier-0: gate state reload failed');
    }

    if (state.report?.phases?.length) {
      for (const phaseResult of state.report.phases) {
        globalEventBus.emit(createBootstrapPhaseCompleteEvent(workspace, phaseResult.phase.name, phaseResult.durationMs, phaseResult.itemsProcessed));
        recordLibrarianTrace(traceContext, `bootstrap_phase_${phaseResult.phase.name}`);
      }
    }
    recordLibrarianTrace(traceContext, 'bootstrap_complete');
    await emitReports('success');

    const durationMs = Date.now() - startTime;
    globalEventBus.emit(createBootstrapCompleteEvent(workspace, true, durationMs));
    onComplete?.(true, state.report);

    return { success: true, librarian, wasBootstrapped, wasUpgraded, durationMs, report: state.report };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    state.status = 'failed';
    state.error = errorMessage;
    state.completedAt = new Date();
    state.version = currentVersion;
    state.providerUsed = providerUsed;
    gateStates.set(workspace, state);
    await writeGateState(workspace, {
      status: 'failed',
      completedAt: state.completedAt.toISOString(),
      version: currentVersion,
      providerUsed,
      error: errorMessage,
    });

    recordLibrarianTrace(traceContext, 'bootstrap_failed');
    await emitReports('failure', errorMessage);

    const durationMs = Date.now() - startTime;
    globalEventBus.emit(createBootstrapCompleteEvent(workspace, false, durationMs, errorMessage));
    onComplete?.(false);

    if (throwOnFailure) {
      throw error;
    }

    return { success: false, librarian: null, wasBootstrapped, wasUpgraded: false, durationMs, error: errorMessage };
  } finally {
    if (state.status === 'failed') gateStates.delete(workspace);
    if (lockHandle) await lockHandle.release();
  }
}

async function waitForGate(
  workspace: string,
  remainingTimeoutMs: number
): Promise<FirstRunGateResult> {
  const startTime = Date.now(); const pollInterval = 100;
  const deadline = remainingTimeoutMs > 0 ? startTime + remainingTimeoutMs : Number.POSITIVE_INFINITY;
  while (Date.now() < deadline) {
    const state = gateStates.get(workspace);
    if (state?.status === 'ready' && state.librarian) return { success: true, librarian: state.librarian, wasBootstrapped: true, wasUpgraded: false, durationMs: Date.now() - startTime, report: state.report };
    if (state?.status === 'failed') return { success: false, librarian: null, wasBootstrapped: false, wasUpgraded: false, durationMs: Date.now() - startTime, error: state.error };
    if (!state) {
      const persisted = readGateStateSync(workspace);
      if (persisted?.status === 'failed') return { success: false, librarian: null, wasBootstrapped: false, wasUpgraded: false, durationMs: Date.now() - startTime, error: persisted.error };
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  return { success: false, librarian: null, wasBootstrapped: false, wasUpgraded: false, durationMs: remainingTimeoutMs, error: 'Timeout waiting for librarian gate' };
}

export function isLibrarianReady(workspace: string): boolean {
  const state = gateStates.get(workspace);
  if (state?.status === 'ready' && state.librarian !== null) {
    return true;
  }
  const persisted = readGateStateSync(workspace);
  return isGateStateReady(persisted, getCurrentVersion().string);
}

export function getLibrarian(workspace: string): Librarian | null {
  const state = gateStates.get(workspace);
  return state?.status === 'ready' ? state.librarian : null;
}

export function getGateStatus(workspace: string): {
  status: 'pending' | 'running' | 'ready' | 'failed';
  error?: string;
} {
  const state = gateStates.get(workspace);
  if (state) return { status: state.status, error: state.error };
  const persisted = readGateStateSync(workspace);
  if (persisted) return { status: persisted.status, error: persisted.error };
  return { status: 'pending' };
}

export async function resetGate(workspace: string): Promise<void> {
  const state = gateStates.get(workspace);
  if (state?.librarian) {
    await state.librarian.shutdown();
  }
  gateStates.delete(workspace);
  await cleanupWorkspaceLock(workspace);
  await clearGateState(workspace);
}

export async function shutdownAll(): Promise<void> {
  for (const [workspace, state] of gateStates) {
    if (state.librarian) {
      await state.librarian.shutdown();
    }
  }
  gateStates.clear();
}

export function createLibrarianPreTaskHook(
  options: FirstRunGateOptions = {}
): (workspace: string) => Promise<Librarian> {
  return async (workspace: string): Promise<Librarian> => (await ensureLibrarianReady(workspace, { ...options, throwOnFailure: true })).librarian!;
}

export function withLibrarian<T extends unknown[], R>(
  workspace: string,
  fn: (librarian: Librarian, ...args: T) => Promise<R>,
  options: FirstRunGateOptions = {}
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const { librarian } = await ensureLibrarianReady(workspace, options);
    if (!librarian) throw new Error('Librarian not available');
    return fn(librarian, ...args);
  };
}
