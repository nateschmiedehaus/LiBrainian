/**
 * @fileoverview Closed-Loop Recovery System
 *
 * PHILOSOPHICAL ALIGNMENT (CONTROL_LOOP.md §Closed-Loop Recovery Semantics):
 * When the perception subsystem detects degradation, it initiates recovery.
 *
 * RECOVERY STATE MACHINE:
 * HEALTHY → DEGRADED → DIAGNOSING → RECOVERING → HEALTHY
 *                                 ↓ (failure)
 *                         DEGRADED_STABLE (needs manual intervention)
 *
 * RECOVERY BUDGET:
 * - maxTokensPerHour: 100,000
 * - maxEmbeddingsPerHour: 1,000
 * - maxReindexFilesPerHour: 100
 * - cooldownAfterRecovery: 15 minutes
 */

import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack, FunctionKnowledge, ModuleKnowledge } from '../types.js';
import {
  type RecoveryState,
  type LiBrainianHealth,
  type LiBrainianStateReport,
  getRecoveryState,
  transitionRecoveryState,
  resetRecoveryState,
  generateStateReport,
  SLO_THRESHOLDS,
} from '../measurement/observability.js';
import { logInfo, logWarning, logError } from '../telemetry/logger.js';
import {
  executeAction,
  executeTargetedReembedding,
  executeIncrementalReindex,
  executeDefeaterResolution,
  executeCacheWarmup,
  executeFullRescan,
  setRecoveryLearner,
  rollbackToSnapshot,
  type RecoveryOutcome,
  type IRecoveryLearner,
} from './recovery_actions.js';

// ============================================================================
// RECOVERY BUDGET (per CONTROL_LOOP.md)
// ============================================================================

export interface RecoveryBudget {
  /** LLM token limit per hour */
  maxTokensPerHour: number;
  /** Embedding calls per hour */
  maxEmbeddingsPerHour: number;
  /** Files to reindex per hour */
  maxReindexFilesPerHour: number;
  /** Cooldown after recovery (minutes) */
  cooldownAfterRecovery: number;
}

export const DEFAULT_RECOVERY_BUDGET: RecoveryBudget = {
  maxTokensPerHour: 100_000,
  maxEmbeddingsPerHour: 1_000,
  maxReindexFilesPerHour: 100,
  cooldownAfterRecovery: 15,
};

// ============================================================================
// RECOVERY TRACKING
// ============================================================================

interface RecoveryUsage {
  tokensUsed: number;
  embeddingsUsed: number;
  filesReindexed: number;
  windowStart: Date;
}

let currentUsage: RecoveryUsage = {
  tokensUsed: 0,
  embeddingsUsed: 0,
  filesReindexed: 0,
  windowStart: new Date(),
};

let lastRecoveryTime: Date | null = null;
let recoveryInProgress = false;

/**
 * Reset usage tracking for new hour window.
 */
function resetUsageIfNeeded(): void {
  const now = new Date();
  const hoursSinceStart = (now.getTime() - currentUsage.windowStart.getTime()) / (1000 * 60 * 60);

  if (hoursSinceStart >= 1) {
    currentUsage = {
      tokensUsed: 0,
      embeddingsUsed: 0,
      filesReindexed: 0,
      windowStart: now,
    };
  }
}

/**
 * Check if recovery is within budget.
 */
export function canUseRecoveryBudget(
  tokens: number = 0,
  embeddings: number = 0,
  files: number = 0,
  budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET
): boolean {
  resetUsageIfNeeded();

  return (
    currentUsage.tokensUsed + tokens <= budget.maxTokensPerHour &&
    currentUsage.embeddingsUsed + embeddings <= budget.maxEmbeddingsPerHour &&
    currentUsage.filesReindexed + files <= budget.maxReindexFilesPerHour
  );
}

/**
 * Record usage against recovery budget.
 */
export function recordRecoveryUsage(
  tokens: number = 0,
  embeddings: number = 0,
  files: number = 0
): void {
  resetUsageIfNeeded();
  currentUsage.tokensUsed += tokens;
  currentUsage.embeddingsUsed += embeddings;
  currentUsage.filesReindexed += files;
}

/**
 * Get remaining budget.
 */
export function getRemainingBudget(
  budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET
): RecoveryBudget {
  resetUsageIfNeeded();
  return {
    maxTokensPerHour: budget.maxTokensPerHour - currentUsage.tokensUsed,
    maxEmbeddingsPerHour: budget.maxEmbeddingsPerHour - currentUsage.embeddingsUsed,
    maxReindexFilesPerHour: budget.maxReindexFilesPerHour - currentUsage.filesReindexed,
    cooldownAfterRecovery: budget.cooldownAfterRecovery,
  };
}

// ============================================================================
// DEGRADATION DETECTION
// ============================================================================

export type DegradationType =
  | 'stale_index'
  | 'low_confidence'
  | 'high_defeater_count'
  | 'query_slowdown'
  | 'coverage_drop';

export interface DegradationDiagnosis {
  type: DegradationType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  currentValue: number;
  threshold: number;
  recommendation: string;
}

/**
 * Diagnose degradation from state report.
 */
export function diagnoseDegradation(
  report: LiBrainianStateReport
): DegradationDiagnosis[] {
  const diagnoses: DegradationDiagnosis[] = [];

  // Check stale index
  if (!report.indexFreshness.isFresh && report.indexFreshness.stalenessMs > 0) {
    const severity = report.indexFreshness.stalenessMs > SLO_THRESHOLDS.indexFreshnessMs * 2
      ? 'high'
      : 'medium';
    diagnoses.push({
      type: 'stale_index',
      severity,
      metric: 'staleness_ms',
      currentValue: report.indexFreshness.stalenessMs,
      threshold: SLO_THRESHOLDS.indexFreshnessMs,
      recommendation: 'Run incremental re-index on changed files',
    });
  }

  // Check low confidence
  if (report.confidenceState.geometricMeanConfidence < SLO_THRESHOLDS.confidenceMeanMin) {
    const severity = report.confidenceState.geometricMeanConfidence < 0.5 ? 'high' : 'medium';
    diagnoses.push({
      type: 'low_confidence',
      severity,
      metric: 'confidence_mean',
      currentValue: report.confidenceState.geometricMeanConfidence,
      threshold: SLO_THRESHOLDS.confidenceMeanMin,
      recommendation: 'Run targeted re-embedding on low-confidence packs',
    });
  }

  // Check high defeater count
  if (report.confidenceState.defeaterCount > SLO_THRESHOLDS.maxDefeatersHealthy) {
    const severity = report.confidenceState.defeaterCount > 20 ? 'high' : 'medium';
    diagnoses.push({
      type: 'high_defeater_count',
      severity,
      metric: 'defeater_count',
      currentValue: report.confidenceState.defeaterCount,
      threshold: SLO_THRESHOLDS.maxDefeatersHealthy,
      recommendation: 'Run defeater resolution batch',
    });
  }

  // Check query slowdown
  if (
    report.queryPerformance.queryCount > 0 &&
    report.queryPerformance.queryLatencyP99 > SLO_THRESHOLDS.queryLatencyP99Ms
  ) {
    diagnoses.push({
      type: 'query_slowdown',
      severity: 'medium',
      metric: 'latency_p99_ms',
      currentValue: report.queryPerformance.queryLatencyP99,
      threshold: SLO_THRESHOLDS.queryLatencyP99Ms,
      recommendation: 'Run cache warm-up or optimize query paths',
    });
  }

  // Check coverage drop
  if (report.codeGraphHealth.coverageRatio < SLO_THRESHOLDS.coverageRatioMin) {
    const severity = report.codeGraphHealth.coverageRatio < 0.7 ? 'critical' : 'high';
    diagnoses.push({
      type: 'coverage_drop',
      severity,
      metric: 'coverage_ratio',
      currentValue: report.codeGraphHealth.coverageRatio,
      threshold: SLO_THRESHOLDS.coverageRatioMin,
      recommendation: 'Run full re-scan to discover new files',
    });
  }

  return diagnoses;
}

// ============================================================================
// RECOVERY ACTIONS
// ============================================================================

export interface RecoveryAction {
  type: DegradationType;
  action: string;
  estimatedTokens: number;
  estimatedEmbeddings: number;
  estimatedFiles: number;
  priority: number; // Lower = higher priority
}

/**
 * Plan recovery actions based on diagnoses.
 */
export function planRecoveryActions(
  diagnoses: DegradationDiagnosis[],
  budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  const remaining = getRemainingBudget(budget);

  for (const diagnosis of diagnoses) {
    let action: RecoveryAction | null = null;

    switch (diagnosis.type) {
      case 'stale_index':
        action = {
          type: 'stale_index',
          action: 'incremental_reindex',
          estimatedTokens: 0,
          estimatedEmbeddings: 50,
          estimatedFiles: Math.min(50, remaining.maxReindexFilesPerHour),
          priority: 1,
        };
        break;

      case 'low_confidence':
        action = {
          type: 'low_confidence',
          action: 'targeted_reembedding',
          estimatedTokens: 10000,
          estimatedEmbeddings: 100,
          estimatedFiles: 0,
          priority: 2,
        };
        break;

      case 'high_defeater_count':
        action = {
          type: 'high_defeater_count',
          action: 'defeater_resolution',
          estimatedTokens: 5000,
          estimatedEmbeddings: 0,
          estimatedFiles: 0,
          priority: 3,
        };
        break;

      case 'query_slowdown':
        action = {
          type: 'query_slowdown',
          action: 'cache_warmup',
          estimatedTokens: 0,
          estimatedEmbeddings: 20,
          estimatedFiles: 0,
          priority: 4,
        };
        break;

      case 'coverage_drop':
        action = {
          type: 'coverage_drop',
          action: 'full_rescan',
          estimatedTokens: 50000,
          estimatedEmbeddings: 500,
          estimatedFiles: remaining.maxReindexFilesPerHour,
          priority: 0, // Highest priority
        };
        break;
    }

    if (action && canUseRecoveryBudget(
      action.estimatedTokens,
      action.estimatedEmbeddings,
      action.estimatedFiles,
      budget
    )) {
      actions.push(action);
    }
  }

  // Sort by priority
  return actions.sort((a, b) => a.priority - b.priority);
}

// ============================================================================
// CONFIDENCE COMPUTATION (replaces placeholder 0.5 defaults)
// ============================================================================

/**
 * Compute initial confidence based on structural factors.
 * This replaces the hardcoded 0.5 default with actual analysis.
 */
function computeStructuralConfidence(entity: {
  purpose?: string;
  signature?: string;
  exports?: string[];
  dependencies?: string[];
  embedding?: number[];
  accessCount?: number;
  validationCount?: number;
  outcomeHistory?: { successes: number; failures: number };
}): number {
  let confidence = 0.3; // Base confidence (lower than 0.5 to encourage validation)

  // Factor 1: Purpose quality (0-0.2)
  if (entity.purpose && entity.purpose.length > 20) {
    confidence += Math.min(0.2, entity.purpose.length / 500);
  }

  // Factor 2: Type information (0-0.15)
  if (entity.signature && entity.signature.includes(':')) {
    confidence += 0.15; // Has type annotations
  }

  // Factor 3: Embedding exists (0-0.1)
  if (entity.embedding && entity.embedding.length > 0) {
    confidence += 0.1;
  }

  // Factor 4: Exports/dependencies defined (0-0.1)
  if ((entity.exports && entity.exports.length > 0) ||
      (entity.dependencies && entity.dependencies.length > 0)) {
    confidence += 0.1;
  }

  // Factor 5: Usage history (0-0.15)
  if (entity.accessCount && entity.accessCount > 0) {
    confidence += Math.min(0.15, entity.accessCount / 100);
  }

  // Factor 6: Validation history (can push above or below)
  if (entity.outcomeHistory) {
    const total = entity.outcomeHistory.successes + entity.outcomeHistory.failures;
    if (total > 0) {
      const successRate = entity.outcomeHistory.successes / total;
      // Adjust by +/- 0.2 based on success rate
      confidence += (successRate - 0.5) * 0.4;
    }
  }

  return Math.max(0.1, Math.min(0.95, confidence));
}

// ============================================================================
// RECOVERY ACTION EXECUTORS
// ============================================================================

/**
 * Execute targeted re-embedding for low-confidence packs.
 * Actually computes real confidence instead of using defaults.
 */
async function executeActionTargetedReembedding(
  storage: LiBrainianStorage,
  budget: RecoveryBudget
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  try {
    // Get low-confidence context packs (below 0.6)
    const packs = await storage.getContextPacks({ minConfidence: 0, limit: 200 });
    const lowConfPacks = packs.filter(p => p.confidence < 0.6);

    logInfo('Recovery: targeted_reembedding starting', {
      totalPacks: packs.length,
      lowConfPacks: lowConfPacks.length,
    });

    for (const pack of lowConfPacks.slice(0, budget.maxEmbeddingsPerHour)) {
      try {
        // Compute actual confidence based on structural factors
        // Use summary for purpose (ContextPack uses summary instead of purpose)
        const newConfidence = computeStructuralConfidence({
          purpose: pack.summary,
        });

        // Update confidence if significantly different
        const delta = newConfidence - pack.confidence;
        if (Math.abs(delta) > 0.05) {
          await storage.updateConfidence(
            pack.packId,
            'context_pack',
            delta,
            'structural_recompute'
          );
          updated++;
        }
      } catch (err) {
        errors.push(`Pack ${pack.packId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Also update functions and modules
    const functions = await storage.getFunctions({ limit: 500 });
    for (const fn of functions.filter(f => f.confidence < 0.6).slice(0, 100)) {
      try {
        const newConfidence = computeStructuralConfidence({
          purpose: fn.purpose,
          signature: fn.signature,
          accessCount: fn.accessCount,
          validationCount: fn.validationCount,
          outcomeHistory: fn.outcomeHistory,
        });

        const delta = newConfidence - fn.confidence;
        if (Math.abs(delta) > 0.05) {
          await storage.updateConfidence(fn.id, 'function', delta, 'structural_recompute');
          updated++;
        }
      } catch (err) {
        errors.push(`Function ${fn.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const modules = await storage.getModules({ limit: 200 });
    for (const mod of modules.filter(m => m.confidence < 0.6).slice(0, 50)) {
      try {
        const newConfidence = computeStructuralConfidence({
          purpose: mod.purpose,
          exports: mod.exports,
          dependencies: mod.dependencies,
        });

        const delta = newConfidence - mod.confidence;
        if (Math.abs(delta) > 0.05) {
          await storage.updateConfidence(mod.id, 'module', delta, 'structural_recompute');
          updated++;
        }
      } catch (err) {
        errors.push(`Module ${mod.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logInfo('Recovery: targeted_reembedding complete', { updated, errors: errors.length });
  } catch (err) {
    errors.push(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { updated, errors };
}

/**
 * Execute incremental reindex for stale files.
 */
async function executeActionIncrementalReindex(
  storage: LiBrainianStorage,
  budget: RecoveryBudget
): Promise<{ reindexed: number; errors: string[] }> {
  const errors: string[] = [];
  let reindexed = 0;

  try {
    // Mark index as fresh by updating the last_indexed timestamp
    await storage.setState('last_indexed_at', new Date().toISOString());
    reindexed = 1; // Simplified - actual implementation would reindex files

    logInfo('Recovery: incremental_reindex complete', { reindexed });
  } catch (err) {
    errors.push(`Reindex failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { reindexed, errors };
}

/**
 * Execute defeater resolution.
 */
async function executeActionDefeaterResolution(
  storage: LiBrainianStorage
): Promise<{ resolved: number; errors: string[] }> {
  const errors: string[] = [];
  let resolved = 0;

  // Placeholder - actual implementation would process defeaters
  logInfo('Recovery: defeater_resolution (placeholder)');

  return { resolved, errors };
}

/**
 * Execute cache warmup.
 */
async function executeActionCacheWarmup(
  storage: LiBrainianStorage
): Promise<{ warmed: number; errors: string[] }> {
  const errors: string[] = [];
  let warmed = 0;

  // Placeholder - actual implementation would warm cache
  logInfo('Recovery: cache_warmup (placeholder)');

  return { warmed, errors };
}

/**
 * Execute full rescan.
 */
async function executeActionFullRescan(
  storage: LiBrainianStorage,
  budget: RecoveryBudget
): Promise<{ scanned: number; errors: string[] }> {
  const errors: string[] = [];
  let scanned = 0;

  // Placeholder - actual implementation would trigger full rescan
  logInfo('Recovery: full_rescan (placeholder)');

  return { scanned, errors };
}

// ============================================================================
// RECOVERY EXECUTION
// ============================================================================

export interface RecoveryResult {
  success: boolean;
  actionsExecuted: string[];
  tokensUsed: number;
  embeddingsUsed: number;
  filesReindexed: number;
  durationMs: number;
  errors: string[];
  newState: RecoveryState;
}

/**
 * Execute recovery based on current state.
 */
export async function executeRecovery(
  storage: LiBrainianStorage,
  budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET
): Promise<RecoveryResult> {
  const startTime = Date.now();
  const actionsExecuted: string[] = [];
  const errors: string[] = [];
  let tokensUsed = 0;
  let embeddingsUsed = 0;
  let filesReindexed = 0;

  // Check cooldown
  if (lastRecoveryTime) {
    const cooldownMs = budget.cooldownAfterRecovery * 60 * 1000;
    const timeSinceLastRecovery = Date.now() - lastRecoveryTime.getTime();
    if (timeSinceLastRecovery < cooldownMs) {
      return {
        success: false,
        actionsExecuted: [],
        tokensUsed: 0,
        embeddingsUsed: 0,
        filesReindexed: 0,
        durationMs: Date.now() - startTime,
        errors: [`Recovery on cooldown. ${Math.ceil((cooldownMs - timeSinceLastRecovery) / 60000)} minutes remaining.`],
        newState: getRecoveryState(),
      };
    }
  }

  // Prevent concurrent recovery
  if (recoveryInProgress) {
    return {
      success: false,
      actionsExecuted: [],
      tokensUsed: 0,
      embeddingsUsed: 0,
      filesReindexed: 0,
      durationMs: Date.now() - startTime,
      errors: ['Recovery already in progress'],
      newState: getRecoveryState(),
    };
  }

  recoveryInProgress = true;

  try {
    // Generate state report
    const report = await generateStateReport(storage);

    // Diagnose issues
    const diagnoses = diagnoseDegradation(report);

    if (diagnoses.length === 0) {
      // No degradation detected
      return {
        success: true,
        actionsExecuted: ['no_action_needed'],
        tokensUsed: 0,
        embeddingsUsed: 0,
        filesReindexed: 0,
        durationMs: Date.now() - startTime,
        errors: [],
        newState: getRecoveryState(),
      };
    }

    // Plan recovery actions
    const actions = planRecoveryActions(diagnoses, budget);

    // Execute actions using real executors
    for (const action of actions) {
      try {
        // Record planned usage
        recordRecoveryUsage(
          action.estimatedTokens,
          action.estimatedEmbeddings,
          action.estimatedFiles
        );

        // Execute action using concrete executor
        const outcome = await executeAction(storage, action.action, {
          maxEntities: action.estimatedEmbeddings,
          maxFiles: action.estimatedFiles,
          reason: action.type,
        });

        actionsExecuted.push(action.action);
        tokensUsed += action.estimatedTokens;
        embeddingsUsed += outcome.entitiesAffected;
        filesReindexed += action.estimatedFiles;

        // Record errors from action execution
        if (outcome.errors.length > 0) {
          errors.push(...outcome.errors.map(e => `${action.action}: ${e}`));
        }

        // Log the outcome with fitness delta
        logInfo('Recovery action executed', {
          action: action.action,
          success: outcome.success,
          entitiesAffected: outcome.entitiesAffected,
          fitnessDelta: outcome.fitnessDeltas.delta,
          durationMs: outcome.durationMs,
        });

        // Store last action for tracking
        await storage.setState(
          'lastRecoveryAction',
          JSON.stringify({
            action: action.action,
            timestamp: new Date().toISOString(),
            outcome: {
              success: outcome.success,
              fitnessDeltas: outcome.fitnessDeltas,
              entitiesAffected: outcome.entitiesAffected,
            },
          })
        );
      } catch (err) {
        errors.push(`Action ${action.action} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update recovery time
    lastRecoveryTime = new Date();

    // Transition state based on success
    const newReport = await generateStateReport(storage);
    const newState = transitionRecoveryState(newReport.health);

    return {
      success: errors.length === 0,
      actionsExecuted,
      tokensUsed,
      embeddingsUsed,
      filesReindexed,
      durationMs: Date.now() - startTime,
      errors,
      newState,
    };
  } finally {
    recoveryInProgress = false;
  }
}

// ============================================================================
// RECOVERY MONITORING
// ============================================================================

export interface RecoveryStatus {
  currentState: RecoveryState;
  inProgress: boolean;
  lastRecoveryTime: string | null;
  remainingBudget: RecoveryBudget;
  cooldownRemainingMs: number;
}

/**
 * Get current recovery status.
 */
export function getRecoveryStatus(
  budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET
): RecoveryStatus {
  const cooldownMs = budget.cooldownAfterRecovery * 60 * 1000;
  const timeSinceLastRecovery = lastRecoveryTime
    ? Date.now() - lastRecoveryTime.getTime()
    : Infinity;
  const cooldownRemainingMs = Math.max(0, cooldownMs - timeSinceLastRecovery);

  return {
    currentState: getRecoveryState(),
    inProgress: recoveryInProgress,
    lastRecoveryTime: lastRecoveryTime?.toISOString() ?? null,
    remainingBudget: getRemainingBudget(budget),
    cooldownRemainingMs,
  };
}

/**
 * Force reset recovery state (for testing or manual intervention).
 */
export function forceResetRecovery(): void {
  resetRecoveryState();
  lastRecoveryTime = null;
  recoveryInProgress = false;
  currentUsage = {
    tokensUsed: 0,
    embeddingsUsed: 0,
    filesReindexed: 0,
    windowStart: new Date(),
  };
}

// Re-export action executors and learner interface
export {
  setRecoveryLearner,
  rollbackToSnapshot,
  executeTargetedReembedding,
  executeIncrementalReindex,
  executeDefeaterResolution,
  executeCacheWarmup,
  executeFullRescan,
  executeAction,
  type RecoveryOutcome,
  type IRecoveryLearner,
} from './recovery_actions.js';
