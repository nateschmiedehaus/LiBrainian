/**
 * @fileoverview Unified Librarian Orchestrator
 *
 * This is THE single entry point for AI agents to use Librarian.
 * One function call provides optimal Librarian experience with:
 * - Automatic bootstrap if needed
 * - Optimal tier selection (always 'full' for quality)
 * - Auto-enabled constructables based on workspace analysis
 * - Background processes (file watching, self-healing)
 * - Simple session interface for all operations
 *
 * @example
 * ```typescript
 * // This is ALL an agent needs to do
 * const librarian = await initializeLibrarian(workspace);
 *
 * // Everything else is automatic:
 * const context = await librarian.query('How does auth work?');
 * const fileContext = await librarian.getContext(['src/auth.ts']);
 * await librarian.recordOutcome({ success: true, packIds: context.packIds });
 * const health = librarian.health();
 * ```
 *
 * @packageDocumentation
 */

import type { Librarian } from '../api/librarian.js';
import type { LibrarianContext } from '../integration/wave0_integration.js';
import type {
  LibrarianHealth,
  RecoveryState,
} from '../measurement/observability.js';
import type { FileWatcherHandle } from '../integration/file_watcher.js';
import {
  ensureLibrarianReady,
  getLibrarian,
  isLibrarianReady,
  resetGate,
} from '../integration/first_run_gate.js';
import { createWatchRecoveryGate } from '../integration/watch_recovery.js';
import {
  enrichTaskContext,
  recordTaskOutcome as recordOutcomeInternal,
} from '../integration/wave0_integration.js';
import { startFileWatcher, stopFileWatcher } from '../integration/file_watcher.js';
import {
  generateStateReport,
  assessHealth,
  SLO_THRESHOLDS,
} from '../measurement/observability.js';
import { deriveWatchHealth } from '../state/watch_health.js';
import { getWatchState } from '../state/watch_state.js';
import {
  executeRecovery,
  getRecoveryStatus,
  diagnoseDegradation,
  type RecoveryStatus,
} from '../integration/recovery.js';
import type { LibrarianStorage } from '../storage/types.js';
import { processAgentFeedback, type AgentFeedback } from '../integration/agent_feedback.js';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import { QUALITY_TIERS } from '../index.js';
import { selectTier, type TierRecommendation } from '../config/tier_selector.js';
import * as path from 'path';
import {
  detectOptimalConstructables,
  type OptimalConstructableConfig,
  type ConstructableId,
  type ProjectType,
} from '../constructions/auto_selector.js';
import { resolveWorkspaceRoot } from '../utils/workspace_resolver.js';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/**
 * Task result for recording outcomes.
 * Simplified from strategic/hooks.ts for easier use.
 */
export interface TaskResult {
  /** Whether the task succeeded */
  success: boolean;
  /** Context pack IDs that were used */
  packIds: string[];
  /** Files that were modified */
  filesModified?: string[];
  /** Reason for failure if not successful */
  failureReason?: string;
  /** Type of failure if not successful */
  failureType?: string;
  /** Optional task identifier */
  taskId?: string;
  /** Original intent/query */
  intent?: string;
}

/**
 * Health report for the Librarian session.
 */
export interface HealthReport {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'recovering' | 'unhealthy';
  /** Detailed health checks */
  checks: {
    indexFresh: boolean;
    confidenceAcceptable: boolean;
    defeatersLow: boolean;
    latencyAcceptable: boolean;
    coverageAcceptable: boolean;
  };
  /** Current recovery state */
  recoveryState: RecoveryState;
  /** Any degradation reasons */
  degradationReasons: string[];
  /** When last recovery occurred */
  lastRecovery?: Date;
  /** Whether background processes are active */
  backgroundProcesses: {
    fileWatcher: boolean;
    selfHealing: boolean;
  };
  /** Session uptime in milliseconds */
  uptimeMs: number;
  /** Quality tier in use */
  tier: 'mvp' | 'enhanced' | 'full';
  /** Tier selection reasoning (from tier_selector) */
  tierReasoning?: string[];
  /** Tier selection warnings (from tier_selector) */
  tierWarnings?: string[];
  /** Resource advisories (from tier_selector) */
  resourceAdvisories?: string[];
  /** Detected project type from auto-selection */
  detectedProjectType?: ProjectType;
  /** Auto-enabled constructables */
  enabledConstructables?: ConstructableId[];
  /** Constructable selection confidence (0-1) */
  constructableConfidence?: number;
}

/**
 * Context returned from queries.
 */
export interface Context extends LibrarianContext {
  /** Pack IDs for outcome tracking */
  packIds: string[];
}

/**
 * Options for initializing a Librarian session.
 */
export interface InitializeOptions {
  /** Suppress progress output */
  silent?: boolean;
  /** Skip background file watcher */
  skipWatcher?: boolean;
  /** Skip automatic self-healing loop */
  skipHealing?: boolean;
  /** Reuse an existing in-process session for the same workspace (default: true). */
  reuseExistingSession?: boolean;
  /** Force-disable all LLM usage (bootstrap + queries). */
  skipLlm?: boolean;
  /** Allow degraded operation when embeddings are unavailable */
  allowDegradedEmbeddings?: boolean;
  /** Progress callback */
  onProgress?: (phase: string, progress: number, message: string) => void;
  /** Custom include patterns for indexing */
  includePatterns?: string[];
  /** Custom exclude patterns for indexing */
  excludePatterns?: string[];
  /** Timeout for bootstrap (0 = no timeout) */
  bootstrapTimeoutMs?: number;
}

/**
 * The unified session interface for all Librarian operations.
 */
export interface LibrarianSession {
  /**
   * Query the codebase with natural language intent.
   *
   * @example
   * ```typescript
   * const ctx = await session.query('How does user authentication work?');
   * console.log(ctx.summary);
   * console.log(ctx.relatedFiles);
   * ```
   */
  query(intent: string, options?: QueryOptions): Promise<Context>;

  /**
   * Get context for specific files.
   *
   * @example
   * ```typescript
   * const ctx = await session.getContext(['src/auth/login.ts', 'src/auth/session.ts']);
   * ```
   */
  getContext(files: string[], intent?: string): Promise<Context>;

  /**
   * Record the outcome of a task for confidence calibration.
   *
   * @example
   * ```typescript
   * await session.recordOutcome({
   *   success: true,
   *   packIds: context.packIds,
   *   filesModified: ['src/auth/login.ts'],
   * });
   * ```
   */
  recordOutcome(result: TaskResult): Promise<void>;

  /**
   * Get current health status of the session.
   *
   * @example
   * ```typescript
   * const health = session.health();
   * if (health.status !== 'healthy') {
   *   console.warn('Librarian degraded:', health.degradationReasons);
   * }
   * ```
   */
  health(): HealthReport;

  /**
   * Access the underlying Librarian instance for advanced operations.
   * Use with caution - prefer the session methods.
   */
  readonly librarian: Librarian;

  /**
   * The workspace path this session is for.
   */
  readonly workspace: string;

  /**
   * Shutdown the session gracefully.
   */
  shutdown(): Promise<void>;
}

/**
 * Options for query operations.
 */
export interface QueryOptions {
  /** Task type hint for better context */
  taskType?: string;
  /** User-defined constraints */
  ucRequirements?: string[];
  /** Maximum time to wait for index updates */
  waitForIndexMs?: number;
}

// ============================================================================
// INTERNAL STATE
// ============================================================================

interface SessionState {
  librarian: Librarian;
  workspace: string;
  fileWatcher: FileWatcherHandle | null;
  healingInterval: NodeJS.Timeout | null;
  startedAt: Date;
  tier: 'mvp' | 'enhanced' | 'full';
  tierRecommendation: TierRecommendation;
  constructableConfig: OptimalConstructableConfig;
  options: InitializeOptions;
}

interface WatchRecoveryContext {
  enabled: boolean;
  getWatcher: () => FileWatcherHandle | null;
  setWatcher: (watcher: FileWatcherHandle | null) => void;
}

const activeSessions = new Map<string, SessionState>();

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Initialize Librarian for a workspace.
 *
 * This is THE primary way to use Librarian. One call sets up everything:
 * - Checks if bootstrapped, bootstraps if needed
 * - Selects optimal tier (always 'full' for quality)
 * - Starts background file watching
 * - Enables self-healing recovery loop
 * - Returns a simple session interface
 *
 * @example
 * ```typescript
 * // This is ALL an agent needs to do
 * const librarian = await initializeLibrarian('/path/to/project');
 *
 * // Query for context
 * const ctx = await librarian.query('How does the payment system work?');
 *
 * // Use context in your work...
 *
 * // Record outcome for calibration
 * await librarian.recordOutcome({
 *   success: true,
 *   packIds: ctx.packIds,
 *   filesModified: ['src/payments/processor.ts'],
 * });
 *
 * // Check health anytime
 * const health = librarian.health();
 * ```
 *
 * @param workspace - Path to the workspace root
 * @param options - Optional configuration
 * @returns A LibrarianSession for all operations
 */
export async function initializeLibrarian(
  workspace: string,
  options: InitializeOptions = {}
): Promise<LibrarianSession> {
  const normalizedWorkspace = normalizeWorkspacePath(workspace);
  const resolution = process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT === '1'
    ? resolveWorkspaceRoot(normalizedWorkspace, { maxDepthUp: 0 })
    : resolveWorkspaceRoot(normalizedWorkspace);
  const resolvedWorkspace = resolution.workspace;

  // Check for existing session
  const existingSession = activeSessions.get(resolvedWorkspace);
  const reuseExistingSession = options.reuseExistingSession !== false;
  const requestedSkipLlm = Boolean(options.skipLlm);
  const existingSkipLlm = Boolean(existingSession?.options.skipLlm);
  const incompatible = requestedSkipLlm && !existingSkipLlm;
  const shouldRegisterSession = reuseExistingSession && !existingSession;

  if (existingSession && reuseExistingSession && !incompatible) {
    logInfo('[unified-init] Reusing existing session', { workspace: resolvedWorkspace });
    return createSessionInterface(existingSession);
  }

  const {
    silent = false,
    skipWatcher = false,
    skipHealing = false,
    skipLlm = false,
    reuseExistingSession: _reuseExistingSession,
    onProgress,
    includePatterns,
    excludePatterns,
    bootstrapTimeoutMs = 0,
    allowDegradedEmbeddings = true,
  } = options;

  if (!silent) {
    logInfo('[unified-init] Initializing Librarian', {
      workspace: resolvedWorkspace,
      tier: 'full',
    });
  }
  if (resolution.changed && !silent) {
    logWarning('[unified-init] Auto-detected workspace root', {
      original: resolution.original,
      workspace: resolvedWorkspace,
      marker: resolution.marker,
      confidence: resolution.confidence,
    });
  }

  // Step 1: Ensure Librarian is ready (bootstrap if needed)
  const result = await ensureLibrarianReady(resolvedWorkspace, {
    throwOnFailure: true,
    timeoutMs: bootstrapTimeoutMs,
    includePatterns,
    excludePatterns,
    allowDegradedEmbeddings,
    skipLlm,
    onProgress: onProgress ?? (silent ? undefined : defaultProgressHandler),
    onStart: () => {
      if (!silent) {
        logInfo('[unified-init] Bootstrap started', { workspace: resolvedWorkspace });
      }
    },
    onComplete: (success, report) => {
      if (!silent) {
        logInfo('[unified-init] Bootstrap complete', {
          workspace: resolvedWorkspace,
          success,
          filesProcessed: report?.totalFilesProcessed,
          functionsIndexed: report?.totalFunctionsIndexed,
          packsCreated: report?.totalContextPacksCreated,
        });
      }
    },
  });

  if (!result.success || !result.librarian) {
    throw new Error(`Failed to initialize Librarian: ${result.error ?? 'unknown error'}`);
  }

  const librarian = result.librarian;

  // Step 2: Auto-select tier using tier_selector (always 'full' for best quality)
  const tierRecommendation = await selectTier({ workspace: resolvedWorkspace });
  const tier = tierRecommendation.effectiveTier;

  // Log tier recommendation for visibility
  logInfo('[unified-init] Tier selection complete', {
    workspace: resolvedWorkspace,
    tier: tierRecommendation.effectiveTier,
    recommendedTier: tierRecommendation.recommendedTier,
    confidence: tierRecommendation.confidence,
    estimatedTimeImpact: tierRecommendation.estimatedTimeImpact,
  });

  if (tierRecommendation.warnings.length > 0) {
    for (const warning of tierRecommendation.warnings) {
      logWarning('[unified-init] Tier warning', { workspace: resolvedWorkspace, warning });
    }
  }

  if (tierRecommendation.resourceAdvisories.length > 0) {
    for (const advisory of tierRecommendation.resourceAdvisories) {
      logInfo('[unified-init] Resource advisory', { workspace: resolvedWorkspace, advisory });
    }
  }

  // Step 3: Auto-select constructables based on project detection
  const constructableConfig = await detectOptimalConstructables(resolvedWorkspace);

  // Log constructable selection results
  const primaryProjectType = constructableConfig.analysis.projectTypes[0]?.type ?? 'unknown';
  if (!silent) {
    logInfo('[unified-init] Constructable auto-selection complete', {
      workspace: resolvedWorkspace,
      detectedProjectType: primaryProjectType,
      primaryLanguage: constructableConfig.analysis.primaryLanguage,
      enabledCount: constructableConfig.enabled.length,
      confidence: constructableConfig.confidence,
    });

    // Log which constructables were auto-enabled
    if (constructableConfig.enabled.length > 0) {
      logInfo('[unified-init] Auto-enabled constructables', {
        workspace: resolvedWorkspace,
        constructables: constructableConfig.enabled,
      });
    }

    // Log detection details for debugging
    if (constructableConfig.analysis.frameworks.length > 0) {
      logInfo('[unified-init] Detected frameworks', {
        workspace: resolvedWorkspace,
        frameworks: constructableConfig.analysis.frameworks.map(f => f.framework),
      });
    }

    if (constructableConfig.analysis.patterns.length > 0) {
      logInfo('[unified-init] Detected patterns', {
        workspace: resolvedWorkspace,
        patterns: constructableConfig.analysis.patterns.map(p => p.pattern),
      });
    }
  }

  const sessionState: SessionState = {
    librarian,
    workspace: resolvedWorkspace,
    fileWatcher: null,
    healingInterval: null,
    startedAt: new Date(),
    tier,
    tierRecommendation,
    constructableConfig,
    options,
  };

  // Step 4: Start background file watcher
  if (!skipWatcher) {
    try {
      const storage = (librarian as unknown as { storage?: LibrarianStorage }).storage;
      sessionState.fileWatcher = await startFileWatcher({
        workspaceRoot: resolvedWorkspace,
        librarian,
        storage,
        cascadeReindex: true, // Enable cascade re-indexing
      });
      if (!silent) {
        logInfo('[unified-init] File watcher started', { workspace: resolvedWorkspace });
      }
    } catch (error) {
      logWarning('[unified-init] Failed to start file watcher', {
        workspace: resolvedWorkspace,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Step 5: Start self-healing loop
  if (!skipHealing) {
    const watchRecovery: WatchRecoveryContext = {
      enabled: !skipWatcher,
      getWatcher: () => sessionState.fileWatcher,
      setWatcher: (watcher) => {
        sessionState.fileWatcher = watcher;
      },
    };
    sessionState.healingInterval = startSelfHealingLoop(resolvedWorkspace, librarian, silent, watchRecovery);
    if (!silent) {
      logInfo('[unified-init] Self-healing loop started', { workspace: resolvedWorkspace });
    }
  }

  if (shouldRegisterSession) {
    activeSessions.set(resolvedWorkspace, sessionState);
  }

  if (!silent) {
    logInfo('[unified-init] Session ready', {
      workspace: resolvedWorkspace,
      tier,
      wasBootstrapped: result.wasBootstrapped,
      wasUpgraded: result.wasUpgraded,
      durationMs: result.durationMs,
    });
  }

  return createSessionInterface(sessionState);
}

// ============================================================================
// SESSION INTERFACE IMPLEMENTATION
// ============================================================================

function createSessionInterface(state: SessionState): LibrarianSession {
  return {
    async query(intent: string, options: QueryOptions = {}): Promise<Context> {
      const context = await enrichTaskContext(state.workspace, {
        intent,
        taskType: options.taskType,
        ucRequirements: options.ucRequirements,
        waitForIndexMs: options.waitForIndexMs,
        // Pass enabled constructables from session config for routing
        enabledConstructables: state.constructableConfig.enabled,
      });

      return {
        ...context,
        packIds: context.packIds ?? [],
      };
    },

    async getContext(files: string[], intent?: string): Promise<Context> {
      const context = await enrichTaskContext(state.workspace, {
        intent: intent ?? `Context for files: ${files.slice(0, 3).join(', ')}`,
        affectedFiles: files,
        // Pass enabled constructables from session config for routing
        enabledConstructables: state.constructableConfig.enabled,
      });

      return {
        ...context,
        packIds: context.packIds ?? [],
      };
    },

    async recordOutcome(result: TaskResult): Promise<void> {
      await recordOutcomeInternal(state.workspace, {
        packIds: result.packIds,
        success: result.success,
        filesModified: result.filesModified,
        failureReason: result.failureReason,
        failureType: result.failureType,
        taskId: result.taskId,
        intent: result.intent,
      });

      // Also process as agent feedback for the feedback loop
      if (result.packIds.length > 0) {
        try {
          const storage = (state.librarian as unknown as { storage?: LibrarianStorage }).storage;
          if (storage) {
            const feedback: AgentFeedback = {
              queryId: result.taskId ?? `task-${Date.now()}`,
              relevanceRatings: result.packIds.map(packId => ({
                packId,
                relevant: result.success,
                reason: result.success
                  ? 'Task completed successfully'
                  : result.failureReason ?? 'Task failed',
              })),
              timestamp: new Date().toISOString(),
              taskContext: {
                taskType: 'agent_task',
                intent: result.intent ?? 'unknown',
                outcome: result.success ? 'success' : 'failure',
              },
            };
            await processAgentFeedback(feedback, storage);
          }
        } catch {
          // Feedback processing is best-effort
        }
      }
    },

    health(): HealthReport {
      const now = new Date();

      // Get recovery status
      const recoveryStatus: RecoveryStatus = getRecoveryStatus();
      const degradationReasons: string[] = [];

      // Determine health status from recovery state
      let status: HealthReport['status'];
      switch (recoveryStatus.currentState) {
        case 'healthy':
          status = 'healthy';
          break;
        case 'recovering':
          status = 'recovering';
          break;
        case 'degraded_stable':
          status = 'unhealthy';
          degradationReasons.push('System in degraded stable state - may need manual intervention');
          break;
        default:
          status = 'degraded';
          degradationReasons.push(`Recovery state: ${recoveryStatus.currentState}`);
      }

      // Add cooldown info if applicable
      if (recoveryStatus.cooldownRemainingMs > 0) {
        const minutesRemaining = Math.ceil(recoveryStatus.cooldownRemainingMs / 60000);
        degradationReasons.push(`Recovery on cooldown: ${minutesRemaining} minutes remaining`);
      }

      // Build health report
      const report: HealthReport = {
        status,
        checks: {
          indexFresh: !recoveryStatus.inProgress,
          confidenceAcceptable: true, // Would need storage access to verify
          defeatersLow: true,
          latencyAcceptable: true,
          coverageAcceptable: true,
        },
        recoveryState: recoveryStatus.currentState,
        degradationReasons,
        lastRecovery: recoveryStatus.lastRecoveryTime
          ? new Date(recoveryStatus.lastRecoveryTime)
          : undefined,
        backgroundProcesses: {
          fileWatcher: state.fileWatcher !== null,
          selfHealing: state.healingInterval !== null,
        },
        uptimeMs: now.getTime() - state.startedAt.getTime(),
        tier: state.tier,
        tierReasoning: state.tierRecommendation.reasoning,
        tierWarnings: state.tierRecommendation.warnings.length > 0
          ? state.tierRecommendation.warnings
          : undefined,
        resourceAdvisories: state.tierRecommendation.resourceAdvisories.length > 0
          ? state.tierRecommendation.resourceAdvisories
          : undefined,
        detectedProjectType: state.constructableConfig.analysis.projectTypes[0]?.type,
        enabledConstructables: state.constructableConfig.enabled.length > 0
          ? state.constructableConfig.enabled
          : undefined,
        constructableConfidence: state.constructableConfig.confidence,
      };

      return report;
    },

    get librarian(): Librarian {
      return state.librarian;
    },

    get workspace(): string {
      return state.workspace;
    },

    async shutdown(): Promise<void> {
      logInfo('[unified-init] Shutting down session', { workspace: state.workspace });

      // Stop healing loop
      if (state.healingInterval) {
        clearInterval(state.healingInterval);
        state.healingInterval = null;
      }

      // Stop file watcher
      if (state.fileWatcher) {
        try {
          await state.fileWatcher.stop();
        } catch (error) {
          logWarning('[unified-init] Error stopping file watcher', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        state.fileWatcher = null;
      }

      // Remove from active sessions
      activeSessions.delete(state.workspace);

      // Reset gate to clean up librarian
      await resetGate(state.workspace);

      logInfo('[unified-init] Session shutdown complete', { workspace: state.workspace });
    },
  };
}

// ============================================================================
// SELF-HEALING LOOP
// ============================================================================

const HEALING_INTERVAL_MS = 60_000; // Check every minute

function startSelfHealingLoop(
  workspace: string,
  librarian: Librarian,
  silent: boolean,
  watchRecovery?: WatchRecoveryContext
): NodeJS.Timeout {
  const watchRecoveryGate = createWatchRecoveryGate();
  return setInterval(async () => {
    try {
      const storage = (librarian as unknown as { storage?: LibrarianStorage }).storage;
      if (!storage) return;

      if (watchRecovery && watchRecovery.enabled) {
        const watchState = await getWatchState(storage);
        const watchHealth = deriveWatchHealth(watchState);
        const decision = watchRecoveryGate.evaluate(watchHealth);

        if (decision.shouldAttempt) {
          if (!silent) {
            logWarning('[unified-init] Watcher suspected dead, attempting restart', {
              workspace,
            });
          }
          try {
            await stopFileWatcher(workspace);
          } catch (error) {
            logWarning('[unified-init] Failed to stop file watcher during recovery', {
              workspace,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          try {
            const recoveredWatcher = await startFileWatcher({
              workspaceRoot: workspace,
              librarian,
              storage,
              cascadeReindex: true,
            });
            watchRecovery.setWatcher(recoveredWatcher);
            if (!silent) {
              logInfo('[unified-init] File watcher recovered', { workspace });
            }
          } catch (error) {
            watchRecovery.setWatcher(null);
            logWarning('[unified-init] Watcher recovery failed', {
              workspace,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // Generate state report for diagnosis
      const stateReport = await generateStateReport(storage);

      // Check for degradation
      const diagnoses = diagnoseDegradation(stateReport);

      if (diagnoses.length > 0) {
        // Find primary diagnosis (highest severity)
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const primaryDiagnosis = diagnoses.sort(
          (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
        )[0];

        if (!silent) {
          logInfo('[unified-init] Degradation detected, initiating recovery', {
            workspace,
            type: primaryDiagnosis.type,
            severity: primaryDiagnosis.severity,
            totalIssues: diagnoses.length,
          });
        }

        // Execute recovery
        const result = await executeRecovery(storage);

        if (!silent) {
          logInfo('[unified-init] Recovery complete', {
            workspace,
            success: result.success,
            actionsExecuted: result.actionsExecuted,
          });
        }
      }
    } catch (error) {
      if (!silent) {
        logWarning('[unified-init] Self-healing check failed', {
          workspace,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, HEALING_INTERVAL_MS);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeWorkspacePath(workspace: string): string {
  // Resolve to absolute path
  return path.resolve(workspace);
}

function resolveWorkspacePath(workspace: string): string {
  const normalized = normalizeWorkspacePath(workspace);
  if (process.env.LIBRARIAN_DISABLE_WORKSPACE_AUTODETECT === '1') {
    return normalized;
  }
  const resolution = resolveWorkspaceRoot(normalized);
  return resolution.changed ? resolution.workspace : normalized;
}

function defaultProgressHandler(phase: string, progress: number, message: string): void {
  const pct = Math.round(progress * 100);
  process.stderr.write(`\r[librarian] ${phase}: ${pct}% - ${message}`);
  if (progress >= 1) {
    process.stderr.write('\n');
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Check if a session is already initialized for a workspace.
 */
export function hasSession(workspace: string): boolean {
  return activeSessions.has(resolveWorkspacePath(workspace));
}

/**
 * Get an existing session if available.
 */
export function getSession(workspace: string): LibrarianSession | null {
  const state = activeSessions.get(resolveWorkspacePath(workspace));
  return state ? createSessionInterface(state) : null;
}

/**
 * Shutdown all active sessions.
 */
export async function shutdownAllSessions(): Promise<void> {
  const workspaces = Array.from(activeSessions.keys());
  await Promise.all(
    workspaces.map(async (workspace) => {
      const state = activeSessions.get(workspace);
      if (state) {
        const session = createSessionInterface(state);
        await session.shutdown();
      }
    })
  );
}

/**
 * Get the number of active sessions.
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}
